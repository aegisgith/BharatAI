// Unit: the /delhi-register page's rules, each alone. Its own script runs in node:vm
// against a small stand-in for the page; its printed figures are checked against the
// server's table and against each other. No browser, no server.
// Run:  node scripts/verify/unit-delhi-pay.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };

const html = read('public/delhi-register.html');
const src = read('src/index.tsx');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
check('the page has one script of its own', script.length === 1, script.length);

const PASSES = [...html.matchAll(/<input type="radio" name="pass" value="([^"]+)" data-key="([^"]+)" data-total="([^"]+)"/g)].map((m) => ({ value: m[1], key: m[2], total: m[3] }));
const IDS = ['dr-form', 'dr-error', 'dr-submit', 'dr-total', 'dr-org-label', 'dr-job-box', 'dr-name', 'dr-email', 'dr-phone', 'dr-org', 'dr-job', 'dr-city', 'dr-industry', 'dr-website', 'dr-gst', 'dr-gst-name', 'dr-gstin', 'dr-gst-address', 'dr-code', 'dr-code-msg', 'dr-code-apply'];
function openPage({ hash = '', search = '', fetch } = {}) {
  const focused = { id: null };
  const el = (id) => { const attrs = {}; const listeners = {}; return { id, value: '', hidden: false, textContent: '', innerHTML: '', disabled: false, open: false, attrs, listeners, setAttribute(k, v) { attrs[k] = v; }, removeAttribute(k) { delete attrs[k]; }, getAttribute(k) { return attrs[k]; }, focus() { focused.id = id; }, addEventListener(t, f) { listeners[t] = f; } }; };
  const els = Object.fromEntries(IDS.map((id) => [id, el(id)]));
  els['dr-error'].hidden = true;
  let chosen = PASSES[0];
  const radio = (p) => ({ name: 'pass', value: p.value, getAttribute: (k) => ({ 'data-total': p.total, 'data-key': p.key }[k]), get checked() { return chosen === p; }, set checked(on) { if (on) chosen = p; } });
  const form = els['dr-form'];
  form.querySelector = (sel) => {
    if (sel === 'input[name="pass"]:checked') return radio(chosen);
    const m = sel.match(/data-key="(.*)"\]$/);
    const p = m && PASSES.find((x) => x.key === m[1]);
    return p ? radio(p) : null;
  };
  form.querySelectorAll = (sel) => (sel === '[aria-invalid]' ? Object.values(els).filter((e) => 'aria-invalid' in e.attrs) : []);
  const sent = [];
  const location = { search, hash, href: '' };
  const windowListeners = {};
  const sandbox = { document: { getElementById: (id) => els[id] || null }, location, URLSearchParams, JSON, Error, Array, console, window: { addEventListener: (t, f) => { windowListeners[t] = f; } },
    fetch: (url, init) => { sent.push({ url, body: init && init.body ? JSON.parse(init.body) : null }); return (fetch || (async () => ({ ok: true, json: async () => ({ pay_url: '/pay/ccavenue/T' }) })))(url, init); } };
  vm.runInNewContext(script[0][1], sandbox);
  const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
  return {
    els, sent, focused, location, settle,
    passNow: () => chosen.value,
    choose(v) { chosen = PASSES.find((p) => p.value === v); form.listeners.change({ target: { name: 'pass' } }); },
    hashTo(h) { location.hash = h; windowListeners.hashchange(); },
    async submit(v = {}) {
      for (const [k, id] of [['name', 'dr-name'], ['email', 'dr-email'], ['phone', 'dr-phone'], ['org', 'dr-org'], ['job', 'dr-job'], ['city', 'dr-city'], ['industry', 'dr-industry'], ['website', 'dr-website'], ['gstName', 'dr-gst-name'], ['gstin', 'dr-gstin'], ['address', 'dr-gst-address']]) els[id].value = v[k] || '';
      form.listeners.submit({ preventDefault() {} });
      await settle();
      return { error: els['dr-error'].hidden ? '' : els['dr-error'].textContent, body: sent[sent.length - 1]?.body, url: sent[sent.length - 1]?.url };
    },
  };
}
const GOOD = { name: 'Priya Sharma', email: 'priya@example.com', phone: '98765 43210', org: 'Example Ltd', job: 'CTO', city: 'New Delhi', industry: 'Insurance' };

// ---- what it refuses ----
for (const [what, input, words, box] of [
  ['no name', { ...GOOD, name: ' ' }, 'your name', 'dr-name'], ['no email', { ...GOOD, email: '' }, 'check your email', 'dr-email'], ['a bad email', { ...GOOD, email: 'priya@' }, 'check your email', 'dr-email'],
  ['no mobile', { ...GOOD, phone: '' }, 'mobile number', 'dr-phone'], ['a short mobile', { ...GOOD, phone: '12345' }, '10 digits', 'dr-phone'], ['no organisation', { ...GOOD, org: '' }, 'organisation', 'dr-org'],
  ['no designation', { ...GOOD, job: '' }, 'designation', 'dr-job'], ['no city', { ...GOOD, city: '' }, 'city', 'dr-city'], ['no industry', { ...GOOD, industry: '' }, 'industry', 'dr-industry'],
  ['a GSTIN with no address', { ...GOOD, gstin: '27AAATA1234B1Z5' }, 'billing address', 'dr-gst-address'],
]) {
  const p = openPage();
  const r = await p.submit(input);
  check(`refused, ${what}: says so, marks the box, sends nothing`, r.error.includes(words) && p.sent.length === 0 && p.focused.id === box && p.els[box].attrs['aria-invalid'] === 'true', JSON.stringify(r));
}
{
  const p = openPage();
  await p.submit({ ...GOOD, gstin: '27AAATA1234B1Z5' });
  check('a GST problem opens the GST section, so the message is not hidden', p.els['dr-gst'].open === true);
}

// ---- what it sends ----
{
  const p = openPage();
  const r = await p.submit({ ...GOOD, name: '  Priya Sharma ', email: ' priya@example.com ' });
  check('every box goes to the Delhi route, spaces trimmed, on the pass chosen', r.url === '/api/delhi/pay' && r.body.pass_type === 'Delegate Pass' && r.body.name === 'Priya Sharma' && r.body.email === 'priya@example.com' && r.body.mobile === '98765 43210' && r.body.company === 'Example Ltd' && r.body.job_title === 'CTO' && r.body.city === 'New Delhi' && r.body.industry === 'Insurance', JSON.stringify(r.body));
  check('it sends no price: the server decides', !('amount' in r.body) && !('price' in r.body));
  check('then it goes to checkout in the same tab', p.location.href === '/pay/ccavenue/T', p.location.href);
  check('the button shows it is working and stays off, so nobody pays twice', p.els['dr-submit'].disabled === true);
}
{
  const r = await openPage({ search: '?source=linkedin' }).submit(GOOD);
  check('where they came from travels with them', r.body.registration_source === 'delhi-linkedin', r.body.registration_source);
  const none = await openPage().submit(GOOD);
  check('and with nothing to say, it is the Delhi page', none.body.registration_source === 'delhi-page', none.body.registration_source);
}
{
  const r = await openPage().submit({ ...GOOD, gstName: 'Acme Pvt Ltd', gstin: '27aaata1234b1z5', address: 'Mumbai' });
  check('GST details travel, the GSTIN in capitals', r.body.billing.legal_name === 'Acme Pvt Ltd' && r.body.billing.gstin === '27AAATA1234B1Z5' && r.body.billing.address === 'Mumbai', JSON.stringify(r.body.billing));
}
{
  const p = openPage();
  await p.submit({ ...GOOD, website: 'http://spam.example' });
  check('a bot filling the hidden box sends nothing', p.sent.length === 0);
}

// ---- the Academic Pass ----
{
  const p = openPage();
  check('it opens on the Delegate Pass, with its total', p.passNow() === 'Delegate Pass' && p.els['dr-total'].innerHTML.includes('₹5,898.82'), p.els['dr-total'].innerHTML);
  p.choose('Academic Pass');
  check('Academic: asks for the college, no designation', p.els['dr-org-label'].textContent === 'College name' && p.els['dr-job-box'].hidden === true && p.els['dr-total'].innerHTML.includes('₹1,178.82'));
  const missing = await p.submit({ ...GOOD, org: '', job: '' });
  check('Academic with no college: asked by that name', missing.error.includes('college name'), missing.error);
  const r = await p.submit({ ...GOOD, org: 'A College', job: 'left over' });
  check('Academic sends no designation', r.body.pass_type === 'Academic Pass' && r.body.job_title === '' && r.body.company === 'A College', JSON.stringify(r.body));
  p.choose('VIP Pass');
  check('back on another pass the box returns', p.els['dr-org-label'].textContent === 'Organisation' && p.els['dr-job-box'].hidden === false);
}

// ---- a link chooses the pass ----
for (const p of PASSES) check(`#${p.key} opens on the ${p.value}`, openPage({ hash: '#' + p.key }).passNow() === p.value);
check('an unknown # is ignored', openPage({ hash: '#nonsense"]' }).passNow() === 'Delegate Pass');
{
  const p = openPage();
  p.hashTo('#vip');
  check('a link followed while on the page changes it too', p.passNow() === 'VIP Pass' && p.els['dr-total'].innerHTML.includes('₹23,598.82'));
}

// ---- it never fails silently ----
{
  const p = openPage({ fetch: async () => ({ ok: false, json: async () => ({ error: 'This mobile number is already registered for Delhi.' }) }) });
  const r = await p.submit(GOOD);
  check('a refusal is shown in the server\'s words, the details stay, the button returns', r.error.includes('already registered') && p.els['dr-name'].value === GOOD.name && p.els['dr-submit'].disabled === false && p.location.href === '', JSON.stringify(r));
}
{
  const p = openPage({ fetch: async () => { throw new TypeError('Failed to fetch'); } });
  const r = await p.submit(GOOD);
  check('no internet: says nothing was charged', r.error.includes('Nothing was charged') && p.els['dr-submit'].disabled === false, r.error);
}
{
  const p = openPage({ fetch: async () => ({ ok: true, json: async () => ({}) }) });
  const r = await p.submit(GOOD);
  check('an answer with no link is not treated as success', r.error.includes('try again') && p.location.href === '', r.error);
}

// ---- a partner or discount code (12 Nov 2026) ----
{
  const answer = async (url) => (String(url).startsWith('/api/delhi/code')
    ? { ok: true, json: async () => ({ code: 'PARTNER20', percent: 20, total: 4718.82 }) }
    : { ok: true, json: async () => ({ pay_url: '/pay/ccavenue/T' }) });
  const p = openPage({ search: '?code=partner20', fetch: answer });
  await p.settle();
  check("a partner's link fills the code in, in capitals, and asks the server", p.els['dr-code'].value === 'PARTNER20' && p.sent[0]?.url === '/api/delhi/code?code=PARTNER20&pass=Delegate%20Pass', JSON.stringify(p.sent[0]));
  check('the total strikes the old price and shows the new one', p.els['dr-total'].innerHTML.includes('<s>₹5,898.82</s>') && p.els['dr-total'].innerHTML.includes('₹4,718.82') && p.els['dr-code-msg'].textContent === 'Code PARTNER20: 20% off this pass.', p.els['dr-total'].innerHTML);
  const r = await p.submit(GOOD);
  check('the code goes with the order; the price still does not', r.body.code === 'PARTNER20' && !('amount' in r.body), JSON.stringify(r.body));
}
{
  const p = openPage();
  const r = await p.submit(GOOD);
  check('with no code nothing is asked and the code is empty', r.body.code === '' && p.sent.length === 1, JSON.stringify(p.sent.map((x) => x.url)));
}
{
  const p = openPage({ fetch: async () => ({ ok: false, json: async () => ({ error: 'That code has expired.', field: 'code' }) }) });
  p.els['dr-code'].value = 'oldcode';
  const r = await p.submit(GOOD);
  check('a code refused at checkout: the server\'s words, the code box marked', r.error === 'That code has expired.' && p.focused.id === 'dr-code' && p.els['dr-submit'].disabled === false, JSON.stringify(r));
}

// ---- the figures agree ----
const table = Object.fromEntries([...src.match(/const DELHI_PASS_PRICES_INR[^{]*\{([^}]*)\}/)[1].matchAll(/'([^']+)':\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]));
// Only the four passes Delhi sells: Mumbai's Student Pass (12 Nov 2026) is not one of them.
check('the earlier Mumbai prices are the ones charged', JSON.stringify(table) === JSON.stringify(Object.fromEntries([...src.match(/const PASS_PRICES_INR[^{]*\{([^}]*)\}/)[1].matchAll(/'([^']+)':\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]).filter(([k]) => k in table))), JSON.stringify(table));
const inr = (n) => n.toLocaleString('en-IN');
const money = (n) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const delhi = read('public/delhi.html');
for (const p of PASSES) {
  const base = table[p.value];
  const total = base + Math.round(base * 18) / 100;
  check(`${p.value}: the total printed is the price plus 18% GST (₹${money(total)})`, p.total === money(total), p.total);
  check(`${p.value}: the price on this page matches the server (₹${inr(base)})`, html.includes(`value="${p.value}"`) && new RegExp(`${p.value}</b><i>₹${inr(base)} \\+ GST`).test(html));
  const card = delhi.match(new RegExp(`<h3>${p.value}</h3>\\s*<p class="dl-price">₹([\\d,]+)`));
  check(`${p.value}: the price on /delhi matches too`, card && card[1] === inr(base), card && card[1]);
  check(`${p.value}: the /delhi button opens this pass`, delhi.includes(`/delhi-register#${p.key}`));
}
const industries = [...src.match(/const INDUSTRIES = \[([\s\S]*?)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
const offered = [...html.matchAll(/<option>([^<]+)<\/option>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
check('the industry list is exactly the server\'s', JSON.stringify(industries) === JSON.stringify(offered), offered.length + ' / ' + industries.length);

// ---- the page's words ----
const body = html.slice(html.indexOf('<body>')).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
check('it says Delhi, the dates and the venue', body.includes('28–29 July 2027') && body.includes('Bharat Mandapam'));
check('it never says Mumbai or WTC', !/Mumbai|WTC/.test(html));
check('it points at the refund policy and terms before paying', html.includes('href="/refund"') && html.includes('href="/terms"'));
check('it says the pass and the app come later', body.includes('closer to the event'));
check('no long dash, no "RSVP"', !/—|RSVP/i.test(body));
const subset = read('public/css/fa-subset.css');
const icons = [...new Set([...html.matchAll(/\bfa[sb]? (fa-[a-z0-9-]+)/g)].map((m) => m[1]))].filter((i) => i !== 'fa-spin');
check('every icon is in the icon font', icons.every((i) => subset.includes('.' + i + ':')), icons.join(', '));
check('the stylesheet version is the site\'s', (html.match(/style\.css\?v=(\w+)/) || [])[1] === (delhi.match(/style\.css\?v=(\w+)/) || [])[1]);

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
