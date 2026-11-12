// Integration and system: the Delhi 2027 form (free pass, and enquiries) against the built worker
// on real SQLite with the production schema (5 Nov 2026). The page's own script sends
// the request (delhi-world.mjs), the real route saves it, the real admin route lists it,
// and the email service is played here. Then the build: Cloudflare must serve /delhi as
// a page, not hand it to the worker.
// Run after `npm run build`:  node scripts/verify/smoke-delhi.mjs
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { openPage } from './delhi-world.mjs';
const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');
const worker = (await import(new URL('../../dist/_worker.js?' + Date.now(), import.meta.url).href)).default;

const SQL = await initSqlJs();
const db = new SQL.Database();
db.exec(readFileSync(new URL('./prod-schema.sql', import.meta.url), 'utf8'));
db.run("INSERT INTO events (id, title, start_date, end_date) VALUES (1, 'Bharat AI Innovation 2026', '2026-11-20', '2026-11-21')");
const clean = (a) => a.map(v => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
const rows = (sql, args = []) => { const st = db.prepare(sql); st.bind(args); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; };
const D1 = {
  prepare(sql) {
    let args = [];
    const s = {
      bind(...a) { args = clean(a); return s; },
      async first() { return rows(sql, args)[0] || null; },
      async all() { return { results: rows(sql, args) }; },
      async run() { db.run(sql, args); return { meta: { last_row_id: db.exec('SELECT last_insert_rowid()')[0].values[0][0], changes: db.getRowsModified() } }; },
    };
    return s;
  },
  async batch(list) { return Promise.all(list.map(s => s.all())); },
};
const env = new Proxy({ ADMIN_SECRET: 'smoke-admin', SESSION_SECRET: 'smoke-session', ELASTIC_EMAIL_API_KEY: 'test-key', DB: D1 }, { get: (t, k) => (k in t ? t[k] : undefined) });
const waits = [];
const ctx = { waitUntil(p) { waits.push(p); }, passThroughOnException() {} };
const settled = async () => { await Promise.allSettled(waits.splice(0)); };
const ADMIN = { Authorization: 'Bearer smoke-admin' };

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };

// The email service, played. Worker requests go to the worker, in this process.
let mail = [];
let mailDown = false;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('elasticemail.com')) {
    if (mailDown) throw new Error('email service down');
    mail.push(JSON.parse(init.body));
    return new Response('{}', { status: 200 });
  }
  throw new Error('no outside calls in this test: ' + url);
};
const toWorker = (url, init) => worker.fetch(new Request('https://bharataiinnovation.com' + url, init), env, ctx);
const api = async (path, init) => { const r = await toWorker(path, init); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {} return { status: r.status, json, text }; };
const lastRow = () => rows('SELECT * FROM inquiries ORDER BY id DESC LIMIT 1')[0];
const count = () => rows('SELECT COUNT(*) AS n FROM inquiries')[0].n;

// ======== integration: page -> route -> table -> email ========
const filed = { exhibit: 'exhibition', sponsor: 'sponsorship', speak: 'speaking' };
for (const [interest, type] of Object.entries(filed)) {
  mail = [];
  const before = count();
  const p = openPage({ fetch: toWorker });
  p.choose(interest);
  const r = await p.submit({ name: 'Asha ' + interest, email: `Asha.${interest}@Example.com`, phone: '98200 12345', org: 'Example Ltd' });
  await settled();
  const row = lastRow();
  check(`${interest}: the real route takes what the page sends, one row`, r.done && !r.error && count() === before + 1, JSON.stringify(r));
  check(`${interest}: saved as ${type} on the conference's list, email lowercased`, row.inquiry_type === type && row.event_id === 1 && row.email === `asha.${interest}@example.com` && row.organization === 'Example Ltd', JSON.stringify(row));
  check(`${interest}: the subject tells the team it is Delhi`, row.subject.startsWith('Delhi 2027 · ') && row.message.includes('28–29 July 2027') && JSON.parse(row.metadata).edition === 'delhi-2027', row.subject);
  check(`${interest}: one email to the team, a reply reaches the person`, mail.length === 1 && mail[0].Content.ReplyTo.includes(`Asha.${interest}@Example.com`) && mail[0].Content.Body[0].Content.includes('Delhi 2027'), JSON.stringify(mail[0]?.Content?.Subject));
}

{
  mailDown = true;
  const before = count();
  const p = openPage({ fetch: toWorker });
  p.choose('speak');
  const r = await p.submit({ name: 'Mail Down', email: 'down@example.com' });
  await settled();
  mailDown = false;
  check('the email service failing loses nothing: the person is told yes and the row is there', r.done && count() === before + 1 && lastRow().email === 'down@example.com', JSON.stringify(r));
}
{
  const before = count();
  const r = await api('/api/inquiries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inquiry_type: 'general', name: 'No Email' }) });
  check('someone skipping the page without an email is refused, no row', r.status === 400 && count() === before, r.status);
  const r2 = await api('/api/inquiries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inquiry_type: 'delhi', name: 'A', email: 'a@example.com' }) });
  check('an unknown type is refused, no row', r2.status === 400 && count() === before, r2.status);
}
{
  const nasty = '<img src=x onerror=alert(1)>';
  mail = [];
  const p = openPage({ fetch: toWorker });
  p.choose('speak');
  await p.submit({ name: nasty, email: 'x@example.com', org: nasty });
  await settled();
  const html = mail[0].Content.Body[0].Content;
  check('a script typed into a box reaches the team email harmless', !html.includes('<img src=x') && html.includes('&lt;img'), html.slice(0, 80));
}

// ======== system: one exhibitor, from an advert to the organiser's screen ========
{
  mail = [];
  const p = openPage({ search: '?interest=exhibit&utm_source=linkedin&utm_campaign=delhi-launch', fetch: toWorker });
  check('the advert\'s link opens the form on Exhibit and asks for the mobile', p.interest() === 'exhibit' && p.els['dl-phone-hint'].textContent.includes('call you'));
  const first = await p.submit({ name: 'Rahul Verma', email: 'rahul@acme.example' });
  check('no mobile: told so, nothing saved yet', first.error.includes('mobile') && rows("SELECT * FROM inquiries WHERE email = 'rahul@acme.example'").length === 0, first.error);
  const r = await p.submit({ name: 'Rahul Verma', email: 'rahul@acme.example', phone: '+91 98200 55555', org: 'Acme AI' });
  await settled();
  check('with it: the thank-you names them', r.done && p.els['dl-done-text'].textContent.includes('Rahul') && p.els['dl-done-text'].textContent.includes('rahul@acme.example'));
  check('the team is told once, by email, with the mobile', mail.length === 1 && mail[0].Content.Body[0].Content.includes('+91 98200 55555'), mail.length);
  const list = await api('/api/admin/inquiries?type=exhibition', { headers: ADMIN });
  const shown = (list.json?.inquiries || list.json?.results || list.json || []).find?.((i) => i.email === 'rahul@acme.example');
  check('the organiser finds it in Admin, Enquiries, under Exhibition, marked Delhi', list.status === 200 && shown && shown.subject === 'Delhi 2027 · Exhibit' && shown.phone === '+91 98200 55555', list.text.slice(0, 200));
  check('and can see where it came from', JSON.parse(shown.metadata).utm_source === 'linkedin' && JSON.parse(shown.metadata).utm_campaign === 'delhi-launch' && JSON.parse(shown.metadata).page === '/delhi', shown.metadata);
  const stranger = await api('/api/admin/inquiries');
  check('a stranger cannot read the list', stranger.status === 401 || stranger.status === 403, stranger.status);
}

// ======== the free pass: a real registration, kept apart from Mumbai ========
const passes = () => rows("SELECT * FROM inquiries WHERE inquiry_type = 'delhi_pass' ORDER BY id");
const attendees = () => rows('SELECT COUNT(*) AS n FROM attendees')[0].n;
const PASS = { name: 'Asha Rao', email: 'Asha.Rao@Example.com', phone: '98200 77777', org: 'Example Ltd', job: 'CIO', city: 'New Delhi' };
const postPass = (o, headers = {}) => api('/api/delhi/register', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(o) });
{
  mail = [];
  const beforeAttendees = attendees();
  const p = openPage({ search: '?utm_source=instagram', fetch: toWorker });
  const r = await p.submit(PASS);
  await settled();
  const row = passes()[0];
  check('free pass: the page and the real route agree, one row', r.done && !r.error && passes().length === 1, JSON.stringify(r));
  check('free pass: says waitlisted on the screen', p.els['dl-done-title'].textContent === 'You are waitlisted', p.els['dl-done-title'].textContent);
  check('free pass: saved with every box, email lowercased, status waitlisted', row.status === 'waitlisted' && row.email === 'asha.rao@example.com' && row.name === 'Asha Rao' && row.phone === '98200 77777' && row.organization === 'Example Ltd' && row.subject === 'Delhi 2027 · Free Visitor Pass', JSON.stringify(row));
  const m = JSON.parse(row.metadata);
  check('free pass: designation, city, edition and where they came from are kept', m.designation === 'CIO' && m.city === 'New Delhi' && m.edition === 'delhi-2027' && m.utm_source === 'instagram', row.metadata);
  check('free pass: NOT on the Mumbai attendee list', attendees() === beforeAttendees, attendees());
  check('free pass: one email, to the person only, none to the team', mail.length === 1 && mail[0].Recipients.To.length === 1 && mail[0].Recipients.To[0] === 'asha.rao@example.com', JSON.stringify(mail.map((x) => x.Recipients)));
  const em = mail[0].Content.Body[0].Content;
  check('the email is from the official address', mail[0].Content.From.includes('register@bharataiinnovation.com'), mail[0].Content.From);
  check('the email says Delhi, the dates, the venue and the pass', mail[0].Content.Subject.includes('Delhi') && em.includes('Wednesday 28 and Thursday 29 July 2027') && em.includes('Bharat Mandapam, Pragati Maidan') && em.includes('Free Visitor Pass (exhibition only, entry by time slot)') && em.includes('delhi-2027.ics'), mail[0].Content.Subject);
  check('the email says waitlisted and promises no entry pass', mail[0].Content.Subject.startsWith('You are waitlisted') && em.includes('You are waitlisted for a free Visitor Pass') && em.includes('when your pass is confirmed') && !/entry pass|You are registered/i.test(em), mail[0].Content.Subject);
  check('the email sells nothing and carries no sign-in link to the Mumbai app', !/₹|upgrade|\/app|token=/i.test(em), (em.match(/₹|upgrade|\/app|token=/i) || [])[0]);
  check('the email does not imply Mumbai is included', em.includes('This waitlist is for Delhi only'));
}
{
  const r = await postPass({ name: 'A', email: 'a1@example.com', mobile: '9000000001', company: 'X', job_title: 'Y', city: 'Z' });
  check('the answer holds no number that would say how many have registered', r.status === 201 && !('id' in r.json), r.text);
  const res = await toWorker('/api/delhi/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'B', email: 'a2@example.com', mobile: '9000000002', company: 'X', job_title: 'Y', city: 'Z' }) });
  check('no sign-in session is handed out', !res.headers.get('set-cookie'), res.headers.get('set-cookie'));
  await settled();
}
{
  mail = [];
  const before = passes().length;
  const p = openPage({ fetch: toWorker });
  const r = await p.submit({ ...PASS, email: 'asha.rao@example.com', phone: '98200 88888' });
  await settled();
  check('the same email again: told already waitlisted, no second row, no second email', r.done && p.els['dl-done-title'].textContent === 'You are already waitlisted' && passes().length === before && mail.length === 0, JSON.stringify(r));
}
{
  const before = passes().length;
  const p = openPage({ fetch: toWorker });
  const r = await p.submit({ ...PASS, email: 'someone.else@example.com', phone: '+91-98200-77777' });
  check('someone else with that mobile, however typed: refused in plain words, masked email, no row', !r.done && r.error.includes('already registered for Delhi') && r.error.includes('•••@example.com') && !r.error.includes('asha.rao') && passes().length === before, r.error);
}
{
  const before = passes().length;
  for (const [what, o, word] of [
    ['no mobile', { mobile: '' }, 'mobile'], ['a short mobile', { mobile: '12345' }, '10 digits'], ['no organisation', { company: '' }, 'organisation'],
    ['no designation', { job_title: '' }, 'designation'], ['no city', { city: '  ' }, 'city'], ['no name', { name: '' }, 'name'], ['a bad email', { email: 'nope' }, 'email'],
    ['a mistyped email', { email: 'r@gmail.con' }, 'gmail.com'],
  ]) {
    const r = await postPass({ name: 'N', email: 'n@example.com', mobile: '9000000003', company: 'X', job_title: 'Y', city: 'Z', ...o });
    check(`someone skipping the page with ${what} is refused, no row`, r.status === 400 && String(r.json?.error).includes(word) && passes().length === before, r.text);
  }
}
{
  mail = [];
  const nasty = '<img src=x onerror=alert(1)>';
  await postPass({ name: nasty, email: 'nasty@example.com', mobile: '9000000004', company: nasty, job_title: nasty, city: 'Z' });
  await settled();
  const html = mail[0].Content.Body[0].Content;
  check('a script typed into a box reaches the email harmless', !html.includes('<img src=x') && html.includes('&lt;img'), html.slice(0, 80));
}
{
  mailDown = true;
  const r = await postPass({ name: 'Down', email: 'passdown@example.com', mobile: '9000000005', company: 'X', job_title: 'Y', city: 'Z' });
  await settled();
  mailDown = false;
  check('the email service failing loses no pass, and the failure is written down', r.status === 201 && passes().some((x) => x.email === 'passdown@example.com') && rows("SELECT * FROM admin_audit WHERE action = 'delhi.mail_failed'").length === 1, r.text);
}
{
  // One connection cannot send confirmation emails without limit.
  const ip = { 'CF-Connecting-IP': '203.0.113.9' };
  let last = null;
  for (let i = 0; i < 61; i++) last = await postPass({ name: 'Flood', email: `flood${i}@example.com`, mobile: String(7000000000 + i), company: 'X', job_title: 'Y', city: 'Z' }, ip);
  await settled();
  check('the 61st from one connection in an hour is refused, in plain words', last.status === 429 && last.json.error.includes('try again') && !passes().some((x) => x.email === 'flood60@example.com'), last.text);
  const other = await postPass({ name: 'Other', email: 'other.conn@example.com', mobile: '9000000006', company: 'X', job_title: 'Y', city: 'Z' }, { 'CF-Connecting-IP': '203.0.113.10' });
  check('another connection is not affected', other.status === 201, other.text);
  await settled();
}

// ---- where the organiser sees them, and that Mumbai does not ----
{
  const n = passes().length;
  const board = await api('/api/admin/events/1/board', { headers: ADMIN });
  check('Overview: the board counts the Delhi passes', board.status === 200 && Number(board.json.todo.delhi_passes.total) === n, JSON.stringify(board.json?.todo?.delhi_passes));
  check('Overview: and they are not enquiries waiting on anyone', !(board.json.todo.inquiries || []).some((r) => r.type === 'delhi_pass'), JSON.stringify(board.json.todo.inquiries));
  const pill = await api('/api/admin/inquiries?type=delhi_pass', { headers: ADMIN });
  check('Admin, Enquiries: all of them under their own pill', pill.status === 200 && pill.json.inquiries.length === n && pill.json.typeCounts.some((t) => t.inquiry_type === 'delhi_pass' && t.count === n), pill.text.slice(0, 120));
  const all = await api('/api/admin/inquiries', { headers: ADMIN });
  check('Admin, Enquiries: the default list keeps real enquiries in view', all.status === 200 && all.json.inquiries.length > 0 && !all.json.inquiries.some((i) => i.inquiry_type === 'delhi_pass'), all.json?.inquiries?.length);
  const stranger = await api('/api/admin/inquiries?type=delhi_pass');
  check('a stranger cannot read the list', stranger.status === 401 || stranger.status === 403, stranger.status);
  const admin = await api('/admin.js', {});
  check('the admin script knows the new pill and the Overview line', admin.text.includes('Delhi Free Pass') && admin.text.includes('people waitlisted for a free Delhi 2027 pass'), admin.status);
}

// ---- the page's Mumbai buttons lead somewhere real ----
{
  const r = await api('/register?source=delhi-page');
  check('Before Delhi: /register opens from the page\'s button', r.status === 200 && r.text.includes('Passes'), r.status);
}

// ---- the build: Pages serves the page, the worker never sees it ----
const routes = JSON.parse(readFileSync(new URL('../../dist/_routes.json', import.meta.url), 'utf8'));
for (const p of ['/delhi', '/delhi.html', '/delhi-register', '/delhi-register.html', '/delhi-exhibit', '/delhi-exhibit.html', '/delhi-2027.ics', '/images/*']) check(`${p} is served by Cloudflare Pages, not the worker`, routes.exclude.includes(p), JSON.stringify(routes.exclude.slice(0, 5)));
check('still inside Cloudflare\'s 100-rule limit', routes.exclude.length + routes.include.length <= 100, routes.exclude.length);
check('/api/* still reaches the worker, so the form can post', !routes.exclude.some((x) => x.startsWith('/api')) && routes.include.includes('/*'));
for (const f of ['delhi.html', 'delhi-register.html', 'delhi-2027.ics', 'images/delhi/mandapam-dusk-phone.webp', 'images/delhi/mandapam-dusk-1600.webp', 'images/delhi/mandapam-dusk-2400.webp', 'images/delhi/mandapam-day.webp', 'images/delhi/mandapam-gate.webp', 'images/og/delhi.jpg']) {
  check(`the build carries ${f}`, existsSync(new URL('../../dist/' + f, import.meta.url)));
}

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
