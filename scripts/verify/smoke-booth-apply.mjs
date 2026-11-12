// Booth applications, Mumbai and Delhi (12 Nov 2026), at three levels.
//  unit: /delhi-exhibit's own script in node:vm, each rule alone; the choices on both forms
//        are the server's lists.
//  integration: POST /api/booth-application on the built worker, real SQLite with the
//        production schema: every answer kept, both emails, refusals, limits, the saved replies.
// Run after `npm run build`:  node scripts/verify/smoke-booth-apply.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { makeWorld, ADMIN, settle } from './login-world.mjs';

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const src = read('src/index.tsx');
const page = read('public/delhi-exhibit.html');

// ======== the lists: one set of words, the server's ========
const list = (name) => [...src.match(new RegExp('const ' + name + ' = \\[([^\\]]*)\\]'))[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
const optionsOf = (html, id) => {
  const sel = html.match(new RegExp('<select id="' + id + '"[^>]*>([\\s\\S]*?)</select>'));
  return sel ? [...sel[1].matchAll(/<option(?: value="([^"]*)")?>([^<]*)<\/option>/g)].map((m) => (m[1] !== undefined ? m[1] : m[2]).replace(/&amp;/g, '&')).filter(Boolean) : null;
};
const LISTS = { 'da-type': 'BOOTH_APP_COMPANY_TYPES', 'da-revenue': 'BOOTH_APP_REVENUES', 'da-stage': 'BOOTH_APP_STAGES', 'da-users': 'BOOTH_APP_USERS', 'da-market': 'BOOTH_APP_MARKETS', 'da-industry': 'INDUSTRIES' };
for (const [id, name] of Object.entries(LISTS)) check(`/delhi-exhibit: ${id} offers exactly the server's ${name}`, JSON.stringify(optionsOf(page, id)) === JSON.stringify(list(name)), JSON.stringify(optionsOf(page, id)));
const boothPrices = Object.fromEntries([...src.match(/const BOOTH_APP_BOOTHS[^{]*\{([\s\S]*?)\n\}/)[1].matchAll(/'([^']+)':\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]));
const boothOpts = [...page.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)].filter((m) => m[1] in boothPrices);
check('/delhi-exhibit: all seven booths, each at the server\'s price', boothOpts.length === 7 && boothOpts.every((m) => m[2].includes('₹' + boothPrices[m[1]].toLocaleString('en-IN') + ' + GST')), boothOpts.map((m) => m[2]).join(' | '));
check('/delhi-exhibit: the seven prices are /exhibition\'s', Object.entries(boothPrices).every(([n, p]) => read('public/exhibition.html').includes('₹' + p.toLocaleString('en-IN'))));
check('/delhi-exhibit: the organiser\'s words, the dates, no Mumbai', page.includes('Tell us what you will show. We review every application so the floor stays relevant for the people who come to buy. We reply within 2 working days.') && page.includes('28–29 July 2027') && !/Mumbai|WTC/.test(page));

// ======== unit: the Delhi page's own script ========
const IDS = ['da-form', 'da-error', 'da-submit', 'da-done', 'da-done-text', 'da-ref', 'da-booth', 'da-company', 'da-website', 'da-type', 'da-revenue', 'da-product', 'da-stage', 'da-what', 'da-users', 'da-market', 'da-industry', 'da-talk', 'da-name', 'da-designation', 'da-email', 'da-phone', 'da-city', 'da-message', 'da-website2'];
function openForm({ search = '', fetch } = {}) {
  const focused = { id: null };
  const el = (id) => { const attrs = {}; const L = {}; return { id, value: '', hidden: false, textContent: '', innerHTML: '', disabled: false, attrs, L, setAttribute(k, v) { attrs[k] = v; }, removeAttribute(k) { delete attrs[k]; }, focus() { focused.id = id; }, addEventListener(t, f) { L[t] = f; } }; };
  const els = Object.fromEntries(IDS.map((id) => [id, el(id)]));
  els['da-error'].hidden = true; els['da-done'].hidden = true;
  els['da-booth'].value = 'Startup Pod';
  els['da-booth'].options = [...page.matchAll(/<select id="da-booth">([\s\S]*?)<\/select>/g)][0][1].match(/value="[^"]+"/g).map((v) => ({ value: v.slice(7, -1) }));
  els['da-form'].querySelectorAll = () => Object.values(els).filter((e) => 'aria-invalid' in e.attrs);
  const sent = [];
  const loc = { search, href: '' };
  const sandbox = { document: { getElementById: (id) => els[id] || null }, location: loc, URLSearchParams, JSON, Error, Array, String,
    fetch: (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return (fetch || (async () => ({ ok: true, json: async () => ({ success: true, id: 7, ref: 'BHAI-INQ-00007' }) })))(url, init); } };
  vm.runInNewContext([...page.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1], sandbox);
  const settleUp = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
  return {
    els, sent, focused,
    async submit(v = {}) {
      for (const [k, val] of Object.entries(v)) els[k].value = val;
      els['da-form'].L.submit({ preventDefault() {} });
      await settleUp();
      return { error: els['da-error'].hidden ? '' : els['da-error'].textContent, body: sent[sent.length - 1]?.body };
    },
  };
}
const GOOD = { 'da-company': 'Acme AI', 'da-website': 'acme.example', 'da-type': 'Startup', 'da-revenue': '₹1 to 10 crore', 'da-product': 'Acme Vision', 'da-stage': 'Live, with paying customers',
  'da-what': 'Spots defects on a production line', 'da-users': 'We sell it to other organisations', 'da-market': 'India and overseas', 'da-industry': 'Manufacturing',
  'da-name': 'Kavya Iyer', 'da-designation': 'Founder', 'da-email': 'kavya@acme.example', 'da-phone': '98450 12345', 'da-city': 'Bengaluru' };
for (const [box, words] of [['da-company', 'company name'], ['da-website', 'website'], ['da-type', 'describes you'], ['da-revenue', 'annual revenue'], ['da-product', 'product or solution'],
  ['da-stage', 'how far along'], ['da-what', 'what it does'], ['da-users', 'who uses it'], ['da-market', 'market'], ['da-industry', 'industry'], ['da-name', 'your name'], ['da-designation', 'designation'],
  ['da-email', 'check your email'], ['da-phone', 'mobile number'], ['da-city', 'city']]) {
  const f = openForm();
  const r = await f.submit({ ...GOOD, [box]: '' });
  check(`unit: no ${box.slice(3)}: asked for it, the box marked, nothing sent`, r.error.includes(words) && f.sent.length === 0 && f.focused.id === box && f.els[box].attrs['aria-invalid'] === 'true', r.error);
}
{
  const f = openForm();
  const r = await f.submit({ ...GOOD, 'da-phone': '12345' });
  check('unit: a short mobile is refused in plain words', r.error.includes('10 digits') && f.sent.length === 0, r.error);
}
{
  const f = openForm({ search: '?booth=Explorer%20Booth&utm_source=linkedin' });
  check('unit: ?booth=Explorer Booth opens on it', f.els['da-booth'].value === 'Explorer Booth', f.els['da-booth'].value);
  const r = await f.submit({ ...GOOD, 'da-talk': 'Live defect detection', 'da-message': 'Near the stage' });
  check('unit: every answer goes to the application route, for Delhi', f.sent[0].url === '/api/booth-application' && r.body.event === 'delhi' && r.body.booth === 'Explorer Booth' && r.body.company === 'Acme AI' && r.body.revenue === '₹1 to 10 crore' && r.body.industry === 'Manufacturing' && r.body.talk === 'Live defect detection' && r.body.city === 'Bengaluru' && r.body.source === 'linkedin', JSON.stringify(r.body));
  check('unit: the thank-you names them, the email, 2 working days and the reference', f.els['da-done'].hidden === false && f.els['da-form'].hidden === true && f.els['da-done-text'].textContent.includes('Kavya') && f.els['da-done-text'].textContent.includes('kavya@acme.example') && f.els['da-done-text'].textContent.includes('2 working days') && f.els['da-ref'].textContent === 'BHAI-INQ-00007');
}
check('unit: ?booth=mega opens on the Mega Pavilion', openForm({ search: '?booth=mega' }).els['da-booth'].value === 'Mega Pavilion');
check('unit: an unknown ?booth= leaves the first', openForm({ search: '?booth=<b>' }).els['da-booth'].value === 'Startup Pod');
{
  const f = openForm();
  await f.submit({ ...GOOD, 'da-website2': 'http://spam.example' });
  check('unit: a bot filling the hidden box sends nothing', f.sent.length === 0);
}
{
  const f = openForm({ fetch: async () => ({ ok: false, json: async () => ({ error: 'Please check your website. It should look like yourcompany.com.' }) }) });
  const r = await f.submit(GOOD);
  check('unit: a refusal from the server is shown in its words, the button comes back', r.error.includes('check your website') && f.els['da-submit'].disabled === false && f.els['da-done'].hidden === true, r.error);
}
{
  const f = openForm({ fetch: async () => { throw new TypeError('Failed to fetch'); } });
  const r = await f.submit(GOOD);
  check('unit: no internet: said plainly, nothing lost', r.error.includes('check your internet') && f.els['da-company'].value === 'Acme AI');
}

// ======== integration: the route on the built worker ========
const W = await makeWorld();
const { hit, q, sent } = W;
const APPLY = { event: 'delhi', booth: 'Explorer Booth', company: 'Acme AI', website: 'www.acme.example', company_type: 'Startup', revenue: '₹1 to 10 crore', product: 'Acme Vision',
  what: 'Spots defects on a production line', stage: 'Live, with paying customers', users: 'We sell it to other organisations', market: 'India and overseas', industry: 'Manufacturing',
  talk: 'Live defect detection', name: 'Kavya Iyer', designation: 'Founder', email: 'Kavya@Acme.example', mobile: '98450 12345', city: 'Bengaluru', message: 'Near the stage, please', source: 'linkedin' };
const apply = (o, headers) => hit('POST', '/api/booth-application', o, headers);
const last = () => q('SELECT * FROM inquiries ORDER BY id DESC LIMIT 1')[0];
const count = () => q('SELECT COUNT(*) AS n FROM inquiries')[0].n;
{
  sent.length = 0;
  const r = await apply(APPLY);
  await settle(120);
  const row = last();
  const m = JSON.parse(row.metadata);
  check('Delhi: accepted, with a reference, and no sign-in cookie', r.status === 201 && r.json.ref === 'BHAI-INQ-' + String(row.id).padStart(5, '0') && !r.headers.get('set-cookie'), r.text);
  check('Delhi: one booth enquiry on the desk, email lowercased, Delhi in the subject', row.inquiry_type === 'booth_inquiry' && row.event_id === 1 && row.status === 'new' && row.email === 'kavya@acme.example' && row.organization === 'Acme AI' && row.phone === '98450 12345' && row.subject === 'Delhi 2027 · Booth application · Explorer Booth' && row.message === 'Near the stage, please', JSON.stringify(row));
  check('Delhi: every answer is kept, in words the desk can show', m.application === 'Booth application, Delhi 2027' && m.edition === 'delhi-2027' && m.booth_type === 'Explorer Booth' && m.estimated_total === 129000 && m.website === 'https://www.acme.example' && m.company_type === 'Startup' && m.annual_revenue === '₹1 to 10 crore' && m.product === 'Acme Vision' && m.what_it_does === 'Spots defects on a production line' && m.how_far_along === 'Live, with paying customers' && m.who_uses_it === 'We sell it to other organisations' && m.market === 'India and overseas' && m.sells_to === 'Manufacturing' && m.stage_talk === 'Live defect detection' && m.designation === 'Founder' && m.city === 'Bengaluru' && m.page === '/delhi-exhibit' && m.source === 'linkedin', row.metadata);
  const team = sent.find((p) => /booth inquiry enquiry/i.test(p.Content.Subject));
  const body = team ? team.Content.Body[0].Content : '';
  check('Delhi: the team is emailed every answer, with a way to reply', !!team && body.includes('Booth application, Delhi 2027') && body.includes('Explorer Booth (₹1,29,000 + GST)') && body.includes('Spots defects on a production line') && body.includes('Annual revenue: ₹1 to 10 crore') && body.includes('Sells to: Manufacturing') && body.includes('2 working days') && String(team.Content.ReplyTo).includes('Kavya@Acme.example'), team && team.Content.Subject);
  const mine = sent.find((p) => (p.Recipients.To || []).includes('kavya@acme.example'));
  const mb = mine ? mine.Content.Body[0].Content : '';
  check('Delhi: the applicant gets one email: Delhi, the dates, the booth, the reference, 2 working days', !!mine && /booth application/i.test(mine.Content.Subject) && mine.Content.Subject.includes('Delhi 2027') && mb.includes('28&ndash;29 July 2027') && mb.includes('Explorer Booth') && mb.includes(r.json.ref) && mb.includes('We reply within 2 working days') && mine.Content.From.includes('register@bharataiinnovation.com'), mine && mine.Content.Subject);
  check('Delhi: it promises no booth and sells nothing', !/confirmed|invoice|₹|token=|\/app/i.test(mb.replace(/₹1,29,000 \+ GST/, '')), (mb.match(/confirmed|invoice|token=|\/app/i) || [])[0]);
}
{
  sent.length = 0;
  const key = 'Flagship Pavilion - 6x2m - Rs.3,87,000';
  const r = await apply({ ...APPLY, event: 'mumbai', booth: key, email: 'ravi@cloud.example', mobile: '9820011003', zone: 'Cloud & Infra' });
  await settle(120);
  const row = last();
  const m = JSON.parse(row.metadata);
  check('Mumbai: the subject keeps the spelling the team has always had', r.status === 201 && row.subject === 'Booth Inquiry: ' + key && m.application === 'Booth application, Mumbai 2026' && !('edition' in m) && m.booth_type === key && m.estimated_total === 387000 && m.preferred_zone === 'Cloud & Infra' && m.page === '/inquiry', row.metadata);
  const mine = sent.find((p) => (p.Recipients.To || []).includes('ravi@cloud.example'));
  check('Mumbai: the applicant\'s email is Mumbai\'s', !!mine && mine.Content.Subject.includes('Bharat AI Innovation 2026') && mine.Content.Body[0].Content.includes('World Trade Center, Mumbai'), mine && mine.Content.Subject);
}
{
  const r = await apply({ ...APPLY, booth: 'Undecided', email: 'unsure@acme.example', mobile: '9000000011', talk: '', message: '', zone: '' });
  const m = JSON.parse(last().metadata);
  check('Not sure yet is fine: no estimate, and the subject says so', r.status === 201 && last().subject === 'Delhi 2027 · Booth application · Not sure yet' && m.estimated_total === null && m.booth_type === 'Undecided' && m.stage_talk === '', last().metadata);
}
{
  const before = count();
  for (const [what, o, words] of [
    ['no event', { event: '' }, 'Mumbai or Delhi'], ['an event that is not one', { event: 'goa' }, 'Mumbai or Delhi'], ['a booth that is not one', { booth: 'Palace' }, 'choose a booth'],
    ['no company', { company: '' }, 'company name'], ['no website', { website: '' }, 'website'], ['a website that is not one', { website: 'not a site' }, 'check your website'],
    ['a description not on the list', { company_type: 'Big' }, 'what best describes you'], ['no revenue', { revenue: '' }, 'annual revenue'], ['no product', { product: '' }, 'product or solution name'],
    ['no description', { what: '  ' }, 'what it does'], ['no stage', { stage: '' }, 'how far along'], ['no users', { users: '' }, 'who uses it'], ['no market', { market: '' }, 'market'],
    ['an industry not on the list', { industry: 'AI/ML' }, 'industry you sell to'], ['no name', { name: '' }, 'name'], ['no designation', { designation: '' }, 'designation'],
    ['no city', { city: '' }, 'city'], ['a bad email', { email: 'kavya@' }, 'check your email'], ['a mistyped email', { email: 'k@gmail.con' }, 'gmail.com'], ['a short mobile', { mobile: '12345' }, '10 digits'],
  ]) {
    const r = await apply({ ...APPLY, ...o });
    check(`refused, ${what}: in plain words, nothing saved`, r.status === 400 && String(r.json?.error).includes(words) && count() === before, r.text);
  }
  const all = await apply({ event: 'delhi', booth: 'Startup Pod' });
  check('refused with everything missing: one sentence naming them all', all.status === 400 && all.json.missing.length === 15 && /^Please add company name, website, .* and city\.$/.test(all.json.error), all.json?.error);
}
{
  sent.length = 0;
  await apply({ ...APPLY, booth: 'Mega Pavilion' });
  await settle(120);
  check('the same person again the same day: the team hears, the person is not emailed twice', sent.length === 1 && /booth inquiry enquiry/i.test(sent[0].Content.Subject), JSON.stringify(sent.map((p) => p.Content.Subject)));
}
{
  sent.length = 0;
  const nasty = '<img src=x onerror=alert(1)>';
  await apply({ ...APPLY, email: 'nasty@acme.example', mobile: '9000000022', company: nasty, product: nasty, what: nasty, name: nasty + ' X' });
  await settle(120);
  const all = sent.map((p) => p.Content.Body[0].Content).join('');
  check('a script typed into a box reaches both emails harmless', sent.length === 2 && !all.includes('<img src=x') && all.includes('&lt;img'), String(sent.length));
}
{
  const ip = { 'CF-Connecting-IP': '203.0.113.44' };
  let lastR = null;
  for (let i = 0; i < 31; i++) lastR = await apply({ ...APPLY, email: `flood${i}@acme.example`, mobile: String(9100000000 + i) }, ip);
  check('the 31st from one connection in an hour is refused, in plain words', lastR.status === 429 && lastR.json.error.includes('try again') && q("SELECT COUNT(*) AS n FROM inquiries WHERE email = 'flood30@acme.example'")[0].n === 0, lastR.text);
  const other = await apply({ ...APPLY, email: 'other@acme.example', mobile: '9100000099' }, { 'CF-Connecting-IP': '203.0.113.45' });
  check('another connection is not affected', other.status === 201, other.text);
  await settle(200);
}

// ======== where the organisers act on it ========
{
  const list = await hit('GET', '/api/admin/inquiries?type=booth_inquiry', undefined, ADMIN);
  const items = list.json?.inquiries || list.json?.results || [];
  const found = items.find((i) => i.email === 'kavya@acme.example');
  check('Admin, Inquiries: the application is a Booth enquiry with its answers', list.status === 200 && !!found && JSON.parse(found.metadata).application === 'Booth application, Delhi 2027', list.status);
  const s = await hit('GET', '/api/admin/inquiry-settings', undefined, ADMIN);
  const t = (s.json?.templates || s.json?.settings?.templates || []);
  const ids = t.map((x) => x.id);
  check('the three saved replies are there: approved for Mumbai, approved for Delhi, not this time', ['booth-approved-mumbai', 'booth-approved-delhi', 'booth-declined'].every((id) => ids.includes(id)), ids.join());
  const yes = t.find((x) => x.id === 'booth-approved-delhi');
  const no = t.find((x) => x.id === 'booth-declined');
  check('approved (Delhi) gives the next step and the right dates; not this time is polite and offers a pass', yes.body.includes('approved to exhibit') && yes.body.includes('28 and 29 July 2027') && yes.body.includes('{organisation}') && no.body.includes('not able to offer {organisation} a booth') && no.body.includes('/passes'), yes.body.slice(0, 80));
  check('a stranger cannot read the applications', [401, 403].includes((await hit('GET', '/api/admin/inquiries?type=booth_inquiry')).status));
}
{
  const html = (await hit('GET', '/inquiry')).text;
  for (const [id, name] of Object.entries({ 'iq-company-type': 'BOOTH_APP_COMPANY_TYPES', 'iq-revenue': 'BOOTH_APP_REVENUES', 'iq-stage': 'BOOTH_APP_STAGES', 'iq-users': 'BOOTH_APP_USERS', 'iq-market': 'BOOTH_APP_MARKETS', 'iq-industry': 'INDUSTRIES' })) {
    check(`/inquiry: ${id} offers exactly the server's ${name}`, JSON.stringify(optionsOf(html, id)) === JSON.stringify(list(name)), JSON.stringify(optionsOf(html, id)));
  }
  check('/inquiry: the organiser\'s words and the button', html.includes('Tell us what you will show. We review every application so the floor stays relevant for the people who come to buy. We reply within 2 working days.') && html.includes('Send my application'));
  const ex = read('public/exhibition.html');
  check('/exhibition: each package\'s button opens the application on that booth', ['startup', 'explorer', 'innovator', 'accelerator', 'enterprise', 'flagship', 'mega'].every((k) => ex.includes(`href="/inquiry?booth=${k}#inquiry-form-card"`)) && !ex.includes('>Enquire Now <'));
}

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
