// INTEGRATION level for the redesigned /register and /inquiry (6 Nov 2026): each page's own script, as
// served, runs in node:vm against a small stand-in for the page and talks to the real routes of the built
// worker on real SQLite with the production schema. The email service is played here. Whatever the design
// changed, the same row must reach the same table.
// Run after `npm run build`:  node scripts/verify/smoke-booking-pages.mjs
import vm from 'node:vm';
import { makeWorld, ADMIN, settle } from './login-world.mjs';

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };

const W = await makeWorld();
const { worker, env, ctx, q, sent } = W;
const toWorker = (url, init) => worker.fetch(new Request('https://bharataiinnovation.com' + url, init), env, ctx);
const text = async (p) => (await toWorker(p)).text();

// The page's last inline script, which is the one holding `needle`.
const scriptOf = (html, needle) => {
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const hit = blocks.filter((b) => b.includes(needle));
  if (hit.length !== 1) throw new Error('expected one script with ' + needle + ', found ' + hit.length);
  return hit[0];
};

function openPage(html, needle, { search = '', fetchTo = toWorker } = {}) {
  const els = {};
  const classes = (start = []) => { const s = new Set(start); return { add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c), toggle: (c, on) => (on ? s.add(c) : s.delete(c)) }; };
  const make = () => ({ value: '', textContent: '', innerHTML: '', disabled: false, required: true, checked: false, open: false, style: { setProperty() {} }, classList: classes(), listeners: {}, addEventListener(t, f) { this.listeners[t] = f; }, scrollIntoView() { this.scrolled = true; }, getBoundingClientRect() { return { top: 900 }; }, appendChild() {}, remove() {}, setAttribute() {}, getAttribute() { return null; }, reset() { this.wasReset = true; } });
  const get = (id) => (els[id] = els[id] || make());
  for (const id of ['iq-notice', 'iq-success', 'iq-price-summary', 'rf-notice', 'reg-success', 'reg-paid-pass-modal']) els[id] = Object.assign(make(), { classList: classes(['hidden']) });
  const ready = [];
  const store = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } }; };
  const said = [];
  const sandbox = {
    document: { getElementById: get, querySelectorAll: () => [], querySelector: () => null, createElement: () => make(), body: make(), addEventListener: (t, f) => { if (t === 'DOMContentLoaded') ready.push(f); } },
    location: { search, hash: '', pathname: '/x' }, history: { replaceState() {} },
    sessionStorage: store(), localStorage: store(), URLSearchParams, JSON, Object, Number, String, Date, Promise, Event: class {},
    setTimeout: () => 0, clearTimeout: () => {}, console, alert: (m) => said.push(m),
    matchMedia: () => ({ matches: false }), addEventListener() {},
    fetch: fetchTo,
  };
  sandbox.window = sandbox; sandbox.window.innerHeight = 800;
  vm.runInNewContext(scriptOf(html, needle), sandbox);
  ready.forEach((f) => { try { f(); } catch (e) { /* a part of the page this stand-in leaves out */ } });
  return { els, get, sandbox, said, settle: async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); } };
}

// ======== /inquiry: page -> route -> table -> email ========
const inquiryHtml = await text('/inquiry');
const send = async (p, boxes) => {
  for (const [id, v] of Object.entries(boxes)) p.get(id).value = v;
  await p.sandbox.submitBoothInquiry({ preventDefault() {} });
  await p.settle();
};
const GOOD = { 'iq-name': 'Meera Nair', 'iq-email': 'Meera@Example.com', 'iq-phone': '9820011111', 'iq-company': 'Nair Analytics', 'iq-designation': 'CTO', 'iq-website': 'www.nair.example', 'iq-industry': 'FinTech', 'iq-products': 'A fraud model', 'iq-message': 'Near the stage, please', 'iq-zone': 'FinTech AI' };
const lastInquiry = () => q('SELECT * FROM inquiries ORDER BY id DESC LIMIT 1')[0];
{
  sent.length = 0;
  const p = openPage(inquiryHtml, 'BOOTH_PRICES');
  const key = 'Accelerator Booth - 3x3m - Rs.2,91,000';
  await send(p, { ...GOOD, 'iq-booth-type': key });
  const row = lastInquiry();
  const meta = JSON.parse(row.metadata);
  check('one row, as a booth enquiry, on Mumbai\'s list, email lowercased', row.inquiry_type === 'booth_inquiry' && row.event_id === 1 && row.email === 'meera@example.com' && row.status === 'new', JSON.stringify(row));
  check('with the person', row.name === 'Meera Nair' && row.phone === '9820011111' && row.organization === 'Nair Analytics' && row.message === 'Near the stage, please', JSON.stringify(row));
  check('the subject names the booth, in the spelling the team has always had', row.subject === 'Booth Inquiry: ' + key, row.subject);
  check('the details as before: booth, one of them, zone, estimate, role, industry, products', meta.booth_type === key && meta.booth_quantity === 1 && meta.preferred_zone === 'FinTech AI' && meta.estimated_total === 291000 && meta.designation === 'CTO' && meta.industry === 'FinTech' && meta.products_to_showcase === 'A fraud model', row.metadata);
  check('a website typed as www.nair.example is kept as a working link', meta.website === 'https://www.nair.example', meta.website);
  check('the thank-you shows, with the reference, and the form goes', !p.get('iq-success').classList.contains('hidden') && p.get('inquiry-form').classList.contains('hidden') && p.get('iq-ref').textContent === 'BHAI-INQ-' + String(row.id).padStart(5, '0'), p.get('iq-ref').textContent);
  check('the page comes back to the thank-you', p.get('inquiry-form-card').scrolled === true);
  await settle();
  check('one email to the team, naming the booth, with a way to reply', sent.length === 1 && /booth inquiry/i.test(sent[0].Content.Subject + sent[0].Content.Body[0].Content) && sent[0].Content.Body[0].Content.includes(key) && String(sent[0].Content.ReplyTo || '').includes('Meera@Example.com'), JSON.stringify(sent[0]?.Content?.Subject));
  p.sandbox.resetInquiryForm();
  check('Submit Another: the form is back, its button says what it did, the summary has gone', p.get('inquiry-form').wasReset && !p.get('inquiry-form').classList.contains('hidden') && p.get('iq-success').classList.contains('hidden') && /Send Booth Enquiry/.test(p.get('iq-submit').innerHTML) && p.get('iq-submit').disabled === false);
}
{
  const p = openPage(inquiryHtml, 'BOOTH_PRICES');
  await send(p, { ...GOOD, 'iq-booth-type': 'Undecided', 'iq-website': '', 'iq-zone': '', 'iq-designation': '', 'iq-industry': '', 'iq-products': '', 'iq-message': '', 'iq-email': 'unsure@example.com' });
  const row = lastInquiry();
  const meta = JSON.parse(row.metadata);
  check('Not sure yet, and every optional box left empty: still one row, no estimate', row.email === 'unsure@example.com' && row.subject === 'Booth Inquiry: Undecided' && meta.estimated_total === null && meta.website === '' && row.message === '', row.metadata);
}
{
  const p = openPage(inquiryHtml, 'BOOTH_PRICES');
  p.sandbox.chooseUndecided();
  check('"Ask us which size fits" chooses Not sure yet and goes to the form', p.get('iq-booth-type').value === 'Undecided' && p.get('inquiry-form-card').scrolled === true);
}
{
  const p = openPage(inquiryHtml, 'BOOTH_PRICES', { search: '?booth=mega' });
  check('a link with ?booth=mega opens with it chosen and priced', p.get('iq-booth-type').value === 'Mega Pavilion - 7x7.7m - Rs.17,40,000' && /17,40,000/.test(p.get('iq-summary-price').textContent), p.get('iq-booth-type').value);
}
{
  const before = q('SELECT COUNT(*) AS n FROM inquiries')[0].n;
  const p = openPage(inquiryHtml, 'BOOTH_PRICES');
  await send(p, { ...GOOD, 'iq-booth-type': 'Undecided', 'iq-email': '' });
  check('the server refusing: its words stay on the screen, not only in a toast', !p.get('iq-notice').classList.contains('hidden') && /required/i.test(p.get('iq-notice').textContent), p.get('iq-notice').textContent);
  check('nothing saved, nothing lost: the form stays and the button comes back', q('SELECT COUNT(*) AS n FROM inquiries')[0].n === before && !p.get('inquiry-form').classList.contains('hidden') && /Send Booth Enquiry/.test(p.get('iq-submit').innerHTML) && p.get('iq-submit').disabled === false);
  p.get('iq-email').value = 'second@example.com';
  await p.sandbox.submitBoothInquiry({ preventDefault() {} });
  await p.settle();
  check('the next press clears the notice and goes through', p.get('iq-notice').classList.contains('hidden') && lastInquiry().email === 'second@example.com');
}
{
  const p = openPage(inquiryHtml, 'BOOTH_PRICES', { fetchTo: async () => { throw new Error('offline'); } });
  await send(p, { ...GOOD, 'iq-booth-type': 'Undecided' });
  check('no signal: told so on the screen, and the form is still there to press again', /Network error/.test(p.get('iq-notice').textContent) && !p.get('iq-notice').classList.contains('hidden') && p.get('iq-submit').disabled === false);
}
{
  const p = openPage(inquiryHtml, 'BOOTH_PRICES', { fetchTo: async () => new Response('<html>Bad gateway</html>', { status: 502 }) });
  await send(p, { ...GOOD, 'iq-booth-type': 'Undecided' });
  check('an answer that is not JSON: a sentence, not a crash', /could not send/.test(p.get('iq-notice').textContent) && p.get('iq-submit').disabled === false, p.get('iq-notice').textContent);
}
{
  sent.length = 0;
  const nasty = '<img src=x onerror=alert(1)>';
  const p = openPage(inquiryHtml, 'BOOTH_PRICES');
  await send(p, { ...GOOD, 'iq-booth-type': 'Undecided', 'iq-name': nasty, 'iq-company': nasty, 'iq-message': nasty, 'iq-email': 'nasty@example.com' });
  await settle();
  const html = sent[0].Content.Body[0].Content;
  check('a script typed into a box reaches the team email harmless', !html.includes('<img src=x') && html.includes('&lt;img'), html.slice(0, 160));
}
{
  const list = await toWorker('/api/admin/inquiries?type=booth_inquiry', { headers: ADMIN });
  const j = await list.json();
  const shown = (j.inquiries || []).find((i) => i.email === 'meera@example.com');
  check('the organiser finds it in Admin, Enquiries, under Booth Inquiry, with what the form asked', list.status === 200 && shown && JSON.parse(shown.metadata).products_to_showcase === 'A fraud model' && (j.inquiries || []).every((i) => i.inquiry_type === 'booth_inquiry'), String(list.status));
}

// ======== /register: the free form ========
const registerHtml = await text('/register');
const fill = (p, boxes) => { for (const [id, v] of Object.entries(boxes)) p.get(id).value = v; };
const FREE = { 'rf-name': 'Asha Rao', 'rf-email': 'asha@example.com', 'rf-phone': '9820022222', 'rf-company': 'Rao Labs', 'rf-title': 'Founder', 'rf-city': 'Pune', 'rf-industry': 'Software & SaaS' };
const row = (email) => q('SELECT * FROM attendees WHERE email = ?', email)[0];
{
  const p = openPage(registerHtml, 'submitRegistration', { search: '?source=passes-visitor' });
  fill(p, FREE);
  await p.sandbox.submitRegistration({ preventDefault() {} });
  await p.settle();
  const a = row('asha@example.com');
  check('the free form, with the folded boxes never opened: one Visitor Pass', a && a.badge_type === 'Visitor Pass' && a.event_id === 1 && a.main_event === 1, JSON.stringify(a));
  check('with what was typed, and the folded boxes empty', a.name === 'Asha Rao' && a.mobile === '9820022222' && a.company === 'Rao Labs' && a.job_title === 'Founder' && a.city === 'Pune' && a.industry === 'Software & SaaS' && !a.linkedin_url && !a.interests, JSON.stringify(a));
  check('the button that brought them is kept', a.registration_source === 'passes-visitor', a.registration_source);
  check('the success screen shows, the form and the words above it go', !p.get('reg-success').classList.contains('hidden') && p.get('reg-form').classList.contains('hidden') && p.get('reg-intro').classList.contains('hidden') && p.get('reg-signin-note').classList.contains('hidden'));
  check('with the name and the reference', p.get('rs-name').textContent === 'Welcome, Asha Rao' && p.get('rs-ref').textContent === 'BHAI-2026-' + String(a.id).padStart(5, '0'), p.get('rs-ref').textContent);
  check('and the app will know them', /asha@example.com/.test(p.sandbox.localStorage.getItem('agba_user') || ''));
}
{
  const p = openPage(registerHtml, 'submitRegistration');
  fill(p, { ...FREE, 'rf-email': 'linked@example.com', 'rf-phone': '9820033333', 'rf-linkedin': 'linkedin.com/in/x', 'rf-interests': 'Vision' });
  await p.sandbox.submitRegistration({ preventDefault() {} });
  await p.settle();
  const a = row('linked@example.com');
  check('the folded boxes, when filled, are saved, the link working, the page recorded as the source', a.linkedin_url === 'https://linkedin.com/in/x' && a.interests === 'Vision' && a.registration_source === 'website', JSON.stringify(a));
}
{
  const p = openPage(registerHtml, 'submitRegistration');
  fill(p, { ...FREE, 'rf-phone': '9820044444' });
  await p.sandbox.submitRegistration({ preventDefault() {} });
  await p.settle();
  check('the same email again: a lasting notice with a way to sign in, and the button back in its new words', !p.get('rf-notice').classList.contains('hidden') && /app#login/.test(p.get('rf-notice').innerHTML) && /Register free/.test(p.get('rf-submit').innerHTML) && p.get('rf-submit').disabled === false, p.get('rf-notice').innerHTML);
  check('and nothing added', q("SELECT COUNT(*) AS n FROM attendees WHERE email = 'asha@example.com'")[0].n === 1);
}
{
  const p = openPage(registerHtml, 'submitRegistration', { fetchTo: async () => { throw new Error('offline'); } });
  fill(p, { ...FREE, 'rf-email': 'off@example.com' });
  await p.sandbox.submitRegistration({ preventDefault() {} });
  await p.settle();
  check('no signal: the button comes back in the new words', /Register free/.test(p.get('rf-submit').innerHTML) && p.get('rf-submit').disabled === false);
}

// ======== /register: the paid form's checks, in its new markup ========
{
  const p = openPage(registerHtml, 'submitRegistration');
  p.get('rpp-pass-type').value = 'Delegate Pass';
  await p.sandbox.submitRegisterPaidPassForm({ preventDefault() {} });
  await p.settle();
  check('an empty paid form says what is missing and saves nothing', /Please fill in: name, email, mobile, organisation, designation, city, industry\./.test(p.said[0] || ''), p.said[0]);
  p.said.length = 0;
  p.get('rpp-pass-type').value = 'Academic Pass';
  await p.sandbox.submitRegisterPaidPassForm({ preventDefault() {} });
  await p.settle();
  check('on Academic it asks for a college and no designation', /college name/.test(p.said[0] || '') && !/designation/.test(p.said[0] || ''), p.said[0]);
}
{
  const p = openPage(registerHtml, 'submitRegistration');
  fill(p, { 'rf-name': 'Ravi', 'rf-email': 'ravi@example.com', 'rf-phone': '9820055555', 'rf-company': 'Co', 'rf-title': 'CTO', 'rf-city': 'Mumbai', 'rf-industry': 'Telecom' });
  const r = p.sandbox.upgradeFromSuccess('VIP Pass');
  check('a paid row beside the free form carries over what has been typed, and stays on the page', r === false && p.get('rpp-name').value === 'Ravi' && p.get('rpp-email').value === 'ravi@example.com' && p.get('rpp-phone').value === '9820055555' && p.get('rpp-company').value === 'Co' && p.get('rpp-designation').value === 'CTO' && p.get('rpp-city').value === 'Mumbai' && p.get('rpp-industry').value === 'Telecom' && !p.get('reg-paid-pass-modal').classList.contains('hidden'));
}

console.log(fails ? `\n${fails} FAILED` : '\nall booking page checks passed');
process.exit(fails ? 1 : 0);
