// Built-worker checks of exhibitor teams (migration 0050, 11 Nov 2026), on real
// SQLite (sql.js) loaded with the production schema. The organiser's rules first:
//  - the booth contact (SPOC) has the dashboard login and gets a pass only by adding
//    themselves; the invitation emails no longer hand them one;
//  - a booth includes a fixed number of exhibitor passes by its type, and that is how
//    many people it may add; the next one is asked to buy a Delegate Pass;
//  - only the organisers make an exception to the number;
//  - one person can be at the booth, on stage, or both, and whoever is on stage
//    becomes the stage talk's speaker;
//  - a pass of their own is kept and costs the booth nothing; a free pass is raised;
//    a pass the list gave is taken back when the list can no longer give it.
// Then every refusal the form relies on, the "add your team" email, and the CSV.
// Run after `npm run build`:  node scripts/verify/smoke-exhibitor-team.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { sessionCookie } from './pay-db.mjs';
const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');
const worker = (await import(new URL('../../dist/_worker.js?' + Date.now(), import.meta.url).href)).default;

const SQL = await initSqlJs();
const db = new SQL.Database();
db.exec(readFileSync(new URL('./prod-schema.sql', import.meta.url), 'utf8'));
const MIGRATION = readFileSync(new URL('../../migrations/0050_exhibitor_team.sql', import.meta.url), 'utf8');
const clean = (a) => a.map(v => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
const rows = (sql, args) => { const st = db.prepare(sql); st.bind(args); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; };
const D1 = {
  prepare(sql) {
    let args = [];
    const s = {
      bind(...a) { args = clean(a); return s; },
      async first() { return rows(sql, args)[0] || null; },
      async all() { return { results: rows(sql, args) }; },
      async run() { db.run(sql, args); return { meta: { last_row_id: db.exec('SELECT last_insert_rowid()')[0].values[0][0], changes: db.getRowsModified() } }; },
      _rows() { return rows(sql, args); },
    };
    return s;
  },
  async batch(list) { return list.map(s => ({ results: s._rows(), meta: {} })); },
  async exec(sql) { db.exec(sql); return { count: 1 }; },
};
// No email goes anywhere: the mail service is answered here, and what it was sent is kept.
const sent = [];
globalThis.fetch = async (url, init) => {
  if (String(url).includes('elasticemail.com')) { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ MessageID: 'm' + sent.length }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
  return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const SESSION = 'smoke-session', ADMIN = 'smoke-admin', MP = 'smoke-mp';
const env = new Proxy({ ADMIN_SECRET: ADMIN, SESSION_SECRET: SESSION, MP_SESSION_SECRET: MP, DB: D1 }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };
const hit = async (method, path, body, headers = {}) => {
  const req = new Request('https://bharataiinnovation.com' + path, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await worker.fetch(req, env, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json, h: Object.fromEntries(res.headers) };
};
const mpAs = (companyId) => ({ Cookie: 'mp_session=' + companyId + '.' + crypto.createHmac('sha256', MP).update(String(companyId)).digest('hex') });
const admin = { Authorization: 'Bearer ' + ADMIN };
const q = (sql, ...a) => rows(sql, clean(a));
const one = (sql, ...a) => q(sql, ...a)[0] || null;
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 300))); if (!ok) fails++; };

// ---- seed ----
db.run("INSERT INTO events (id, title, start_date, end_date) VALUES (1, 'Bharat AI', '2026-11-20', '2026-11-21')");
db.run("INSERT INTO app_settings (key, value) VALUES ('elastic_email_api_key', 'test-key')");
const exhibitor = (id, name, email) => db.run('INSERT INTO exhibitors (id, event_id, company_name, contact_email, booth_number) VALUES (?, 1, ?, ?, ?)', [id, name, email, '']);
const stand = (exId, code, type, name, dim) => {
  db.run('INSERT INTO booths (event_id, code, type_key, name, dim) VALUES (1, ?, ?, ?, ?)', [code, type, name, dim]);
  const boothId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
  db.run("INSERT INTO booth_allocations (event_id, booth_id, exhibitor_id, company_name, contact_name, status) VALUES (1, ?, ?, 'x', 'Contact', 'confirmed')", [boothId, exId]);
};
const account = (id, name, email, exId) => db.run("INSERT INTO mp_companies (id, company_name, email, password_hash, exhibitor_id) VALUES (?, ?, ?, '', ?)", [id, name, email, exId]);
exhibitor(1, 'Explorer Co', 'spoc@explorer.test'); stand(1, '21', 'explorer', 'Explorer Booth', '2m x 2m'); account(1, 'Explorer Co', 'spoc@explorer.test', 1);
exhibitor(2, 'Accel Co', 'spoc@accel.test'); stand(2, '12', 'standard', 'Accelerator Booth', '3m x 3m'); account(2, 'Accel Co', 'spoc@accel.test', 2);
exhibitor(3, 'Sheet Pods', 'richa@sheet.test'); account(3, 'Sheet Pods', 'richa@sheet.test', 3);
exhibitor(4, 'Premium Co', 'spoc@premium.test'); stand(4, '1', 'premium', 'Premium Booth', '5m x 2m'); account(4, 'Premium Co', 'spoc@premium.test', 4);
exhibitor(5, 'No Contact Co', '');
account(9, 'Just A Company', 'nobooth@company.test', null);
const person = (id, email, extra = {}) => {
  const row = { id, event_id: 1, name: 'Person ' + id, email, mobile: '', company: '', job_title: '', badge_type: 'Visitor Pass', payment_status: '', main_event: 1, ...extra };
  const cols = Object.keys(row);
  db.run(`INSERT INTO attendees (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, clean(cols.map(k => row[k])));
};
person(101, 'visitor@accel.test', { company: 'Accel Old Name' });
person(102, 'delegate@accel.test', { badge_type: 'Delegate Pass', payment_status: 'paid', job_title: 'Chief Buyer' });
person(103, 'unpaidvip@accel.test', { badge_type: 'VIP Pass', payment_status: 'pending' });
person(104, 'stranger@else.test', { mobile: '+91 98200 12345' });
person(105, 'gone@unsub.test', {});
const P = (o) => ({ first_name: 'Asha', last_name: 'Rao', designation: 'Sales Manager', company: '', email: 'asha@explorer.test', mobile: '', linkedin_url: '', photo_url: '', at_booth: true, speaker: false, ...o });

// ---- before the migration: the feature is simply absent ----
let r = await hit('GET', '/api/mp/dashboard/team', undefined, mpAs(1));
check('before 0050: the dashboard has no team screen', r.status === 200 && r.json.ready === false && r.json.eligible === false, r.text);
r = await hit('GET', '/api/mp/admin/teams', undefined, admin);
check('before 0050: the admin screen says not ready', r.status === 200 && r.json.ready === false, r.text);
r = await hit('POST', '/api/mp/admin/teams/1/ask', {}, admin);
check('before 0050: no email can be sent', r.status === 503 && sent.length === 0, r.status + ' ' + r.text);
db.exec(MIGRATION); db.exec(MIGRATION);
check('0050 runs twice without error', q("SELECT name FROM sqlite_master WHERE name IN ('exhibitor_team', 'exhibitor_team_settings')").length === 2, '');

// ---- who may call what ----
for (const [m, p] of [['GET', '/api/mp/dashboard/team'], ['POST', '/api/mp/dashboard/team'], ['PUT', '/api/mp/dashboard/team/1'], ['DELETE', '/api/mp/dashboard/team/1']]) {
  r = await hit(m, p, m === 'GET' || m === 'DELETE' ? undefined : P({}));
  check('signed out is refused: ' + m + ' ' + p, r.status === 401, r.status);
}
for (const [m, p] of [['GET', '/api/mp/admin/teams'], ['GET', '/api/mp/admin/teams.csv'], ['PUT', '/api/mp/admin/teams/1/passes'], ['POST', '/api/mp/admin/teams/1/ask'], ['POST', '/api/mp/admin/teams/1/settle'], ['DELETE', '/api/mp/admin/teams/member/1'], ['PUT', '/api/mp/admin/teams/settings']]) {
  r = await hit(m, p, m === 'GET' || m === 'DELETE' ? undefined : {});
  check('not an admin is refused: ' + m + ' ' + p, r.status === 403, r.status);
  r = await hit(m, p, m === 'GET' || m === 'DELETE' ? undefined : {}, mpAs(1));
  check('an exhibitor is not an admin: ' + m + ' ' + p, r.status === 403, r.status);
}
r = await hit('GET', '/api/mp/admin/teams?token=' + ADMIN);
check('the admin secret in the URL is refused', r.status === 403, r.status);
r = await hit('GET', '/api/mp/dashboard/team', undefined, mpAs(9));
check('a company without a booth has no team screen', r.status === 200 && r.json.eligible === false, r.text);
r = await hit('POST', '/api/mp/dashboard/team', P({}), mpAs(9));
check('a company without a booth cannot add anyone', r.json?.eligible === false && q('SELECT id FROM exhibitor_team').length === 0, r.text);

// ---- the number of passes comes from the booth type ----
r = await hit('GET', '/api/mp/dashboard/team', undefined, mpAs(1));
check('Explorer Booth: 1 pass', r.json.passes === 1 && r.json.passes_source === 'booth' && r.json.used === 0 && r.json.can_add === true, r.text);
check('Explorer Booth: its branding sizes, fascia 1800 x 300', r.json.branding?.booth === 'Explorer Booth (2m × 2m)' && r.json.branding.rows.some(x => x[0] === 'Fascia Name' && x[1] === '1800mm (W) × 300mm (H)') && r.json.branding.rows.some(x => x[0] === 'Back Wall' && x[1] === '1940mm (W) × 2440mm (H)'), r.json.branding);
r = await hit('GET', '/api/mp/dashboard/team', undefined, mpAs(2));
check('Accelerator Booth: 5 passes, walls 2900', r.json.passes === 5 && r.json.branding.rows.filter(x => x[1] === '2900mm (W) × 2440mm (H)').length === 3, r.text);
r = await hit('GET', '/api/mp/dashboard/team', undefined, mpAs(4));
check('Premium Booth: no number until the organisers set one; back wall 4910', r.json.passes === null && r.json.can_add === true && r.json.branding.rows.some(x => x[0] === 'Back Wall' && x[1].startsWith('4910mm')), r.text);
r = await hit('GET', '/api/mp/dashboard/team', undefined, mpAs(3));
check('known only from the sheet, nothing recorded yet: no number', r.json.eligible === true && r.json.passes === null && r.json.branding === null, r.text);
db.run("INSERT INTO exhibitor_team_settings (exhibitor_id, booth_type, booth_name, booth_dim, booths, contact_name) VALUES (3, 'pod', 'Startup Pod', '1.5m x 1.5m', 2, 'Richa Roy')");
r = await hit('GET', '/api/mp/dashboard/team', undefined, mpAs(3));
check('two Startup Pods from the sheet: 2 passes, no side walls', r.json.passes === 2 && r.json.branding.rows[0][1] === 'None' && r.json.branding.rows.some(x => x[1].startsWith('1500mm')), r.text);

// ---- what the form refuses, in words ----
const bad = async (name, patch, want) => {
  const x = await hit('POST', '/api/mp/dashboard/team', P(patch), mpAs(1));
  check('refused: ' + name, x.status === 400 && want.test(x.json?.error || ''), x.status + ' ' + x.text);
};
await bad('no first name', { first_name: ' ' }, /first name/i);
await bad('no designation', { designation: '' }, /designation/i);
await bad('no email', { email: 'asha at explorer' }, /email/i);
await bad('no role', { at_booth: false, speaker: false }, /role/i);
await bad('a mobile that is too short', { mobile: '98200' }, /mobile/i);
await bad('a LinkedIn link that is not LinkedIn', { linkedin_url: 'https://evil.example/in/asha' }, /linkedin/i);
await bad('a script link', { linkedin_url: 'javascript:alert(1)' }, /linkedin/i);
await bad('a photo that was not uploaded here', { photo_url: 'https://evil.example/x.png' }, /photo/i);
await bad('a name that is too long', { first_name: 'A'.repeat(61) }, /too long/i);
r = await hit('POST', '/api/mp/dashboard/team', P({ mobile: '9820012345' }), mpAs(1));
check('refused: a mobile that belongs to someone else, their email masked', r.status === 409 && /st•••@else\.test/.test(r.json.error) && !/stranger@/.test(r.json.error), r.text);
check('nothing was saved by any refusal', q('SELECT id FROM exhibitor_team').length === 0 && !one("SELECT id FROM attendees WHERE email = 'asha@explorer.test'"), '');

// ---- the first person: on stage and at the booth ----
r = await hit('POST', '/api/mp/dashboard/team', P({ speaker: true, mobile: '98201 55555', linkedin_url: 'linkedin.com/in/asha-rao', company: '' }), mpAs(1));
let asha = one("SELECT * FROM attendees WHERE email = 'asha@explorer.test'");
check('a new person is saved and gets a speaker pass', r.status === 200 && r.json.members.length === 1 && r.json.members[0].pass === 'Exhibition Speaker' && r.json.issued === 1 && r.json.used === 1, r.text);
check('their pass: waived, lunch, conference registrant, from the team list', !!asha && asha.badge_type === 'Exhibition Speaker' && asha.payment_status === 'waived' && asha.lunch_inclusion === 'Yes' && asha.main_event === 1 && asha.registration_source === 'exhibitor_team', asha);
check('their details are on the pass: name, role, designation, company, mobile, LinkedIn', asha.name === 'Asha Rao' && asha.role === 'Exhibitor & Speaker' && asha.job_title === 'Sales Manager' && asha.company === 'Explorer Co' && asha.mobile === '98201 55555' && asha.linkedin_url === 'https://linkedin.com/in/asha-rao', asha);
check('the booth contact has no pass: they did not add themselves', !one("SELECT id FROM attendees WHERE email = 'spoc@explorer.test'"), '');
let talk = one('SELECT * FROM innovation_talks WHERE exhibitor_id = 1');
check('whoever is on stage is the stage talk speaker', talk?.speaker_name === 'Asha Rao' && talk.speaker_title === 'Sales Manager', talk);
r = await hit('PUT', '/api/mp/dashboard/stage-talk', { topic: 'AI at work', speaker_name: 'Someone Else' }, mpAs(1));
talk = one('SELECT * FROM innovation_talks WHERE exhibitor_id = 1');
check('the stage form keeps the topic and leaves the speaker to the team list', r.status === 200 && talk.topic === 'AI at work' && talk.speaker_name === 'Asha Rao' && r.json.team_speakers === 1, r.text);

// ---- past the booth's passes: a Delegate Pass ----
r = await hit('POST', '/api/mp/dashboard/team', P({ first_name: 'Binod', email: 'binod@explorer.test' }), mpAs(1));
check('a second person on a 1-pass booth is refused and told to buy a Delegate Pass', r.status === 409 && r.json.code === 'team_full' && /Delegate Pass/.test(r.json.error) && q('SELECT id FROM exhibitor_team').length === 1 && !one("SELECT id FROM attendees WHERE email = 'binod@explorer.test'"), r.text);
r = await hit('GET', '/api/mp/dashboard/team', undefined, mpAs(1));
check('the screen knows it is full', r.json.can_add === false, r.text);
r = await hit('POST', '/api/mp/dashboard/team', P({ first_name: 'Asha', email: 'ASHA@explorer.test' }), mpAs(1));
check('the same person twice is refused', r.status === 409 && q('SELECT id FROM exhibitor_team').length === 1, r.text);

// ---- Accel Co, 5 passes: every kind of person ----
r = await hit('POST', '/api/mp/dashboard/team', P({ first_name: 'Vee', last_name: 'Visitor', email: 'visitor@accel.test', designation: 'Engineer' }), mpAs(2));
let v = one('SELECT * FROM attendees WHERE id = 101');
check('a free Visitor Pass is raised to an exhibitor pass', r.status === 200 && v.badge_type === 'Exhibitor' && v.payment_status === 'waived' && v.lunch_inclusion === 'Yes' && v.role === 'Exhibitor', v);
check('blank details are filled in, their own are kept', v.job_title === 'Engineer' && v.company === 'Accel Old Name' && v.name === 'Person 101', v);
check('the change is in the audit log', !!one("SELECT id FROM admin_audit WHERE action = 'attendee.exhibitor-team-pass' AND entity_id = '101'"), '');
r = await hit('POST', '/api/mp/dashboard/team', P({ first_name: 'Dee', email: 'delegate@accel.test' }), mpAs(2));
let d = one('SELECT * FROM attendees WHERE id = 102');
let dm = r.json.members.find(m => m.email === 'delegate@accel.test');
check('a paid Delegate keeps their pass and costs the booth nothing', r.status === 200 && d.badge_type === 'Delegate Pass' && d.payment_status === 'paid' && d.job_title === 'Chief Buyer' && dm.own_pass === true && r.json.used === 1, { d, used: r.json.used });
r = await hit('POST', '/api/mp/dashboard/team', P({ first_name: 'Una', email: 'unpaidvip@accel.test' }), mpAs(2));
check('a VIP Pass nobody paid for is raised like a Visitor Pass', one('SELECT badge_type FROM attendees WHERE id = 103').badge_type === 'Exhibitor' && r.json.used === 2, r.text);
r = await hit('POST', '/api/mp/dashboard/team', P({ email: 'asha@explorer.test' }), mpAs(2));
check('someone on another exhibitor team is refused, and told whose', r.status === 409 && /Explorer Co/.test(r.json.error), r.text);
for (const n of ['c', 'd', 'e']) await hit('POST', '/api/mp/dashboard/team', P({ first_name: 'New' + n, email: n + '@accel.test' }), mpAs(2));
r = await hit('GET', '/api/mp/dashboard/team', undefined, mpAs(2));
check('5 passes: five people hold the booth passes, the Delegate apart', r.json.used === 5 && r.json.issued === 5 && r.json.members.length === 6 && r.json.can_add === false, { used: r.json.used, issued: r.json.issued, n: r.json.members.length });
r = await hit('POST', '/api/mp/dashboard/team', P({ first_name: 'Sixth', email: 'f@accel.test' }), mpAs(2));
check('the sixth is asked to buy a Delegate Pass', r.status === 409 && r.json.code === 'team_full' && !one("SELECT id FROM attendees WHERE email = 'f@accel.test'"), r.text);
person(110, 'bought@accel.test', { badge_type: 'Delegate Pass', payment_status: 'paid' });
r = await hit('POST', '/api/mp/dashboard/team', P({ first_name: 'Bought', email: 'bought@accel.test' }), mpAs(2));
check('once they have bought it, they can be added to the full team', r.status === 200 && r.json.members.find(m => m.email === 'bought@accel.test')?.own_pass === true && r.json.used === 5, r.text);
person(111, 'pendingbuy@accel.test', { badge_type: 'Delegate Pass', payment_status: 'pending' });
r = await hit('POST', '/api/mp/dashboard/team', P({ first_name: 'Pending', email: 'pendingbuy@accel.test' }), mpAs(2));
check('a Delegate Pass not paid for does not open the full team', r.status === 409 && r.json.code === 'team_full', r.text);

// ---- the organisers' exception ----
r = await hit('PUT', '/api/mp/admin/teams/2/passes', { passes: 2.5 }, admin);
check('half a pass is refused', r.status === 400, r.status);
r = await hit('PUT', '/api/mp/admin/teams/2/passes', { passes: 6 }, admin);
check('the organisers raise Accel Co to 6', r.status === 200 && r.json.passes === 6 && r.json.passes_source === 'set', r.text);
r = await hit('POST', '/api/mp/dashboard/team', P({ first_name: 'Sixth', email: 'f@accel.test' }), mpAs(2));
check('and the sixth person now gets a pass', r.status === 200 && one("SELECT badge_type FROM attendees WHERE email = 'f@accel.test'")?.badge_type === 'Exhibitor', r.text);
r = await hit('PUT', '/api/mp/admin/teams/2/passes', { passes: 2 }, admin);
const badgeOf = (email) => one('SELECT badge_type FROM attendees WHERE email = ?', email)?.badge_type;
check('lowered to 2: the first two keep theirs, the rest go back to a free Visitor Pass', badgeOf('visitor@accel.test') === 'Exhibitor' && badgeOf('unpaidvip@accel.test') === 'Exhibitor' && badgeOf('c@accel.test') === 'Visitor Pass' && badgeOf('f@accel.test') === 'Visitor Pass', q("SELECT email, badge_type FROM attendees WHERE email LIKE '%@accel.test'"));
check('lowered to 2: nobody is deleted, and paid passes are untouched', q("SELECT id FROM attendees WHERE email LIKE '%@accel.test'").length === 9 && badgeOf('delegate@accel.test') === 'Delegate Pass' && badgeOf('bought@accel.test') === 'Delegate Pass', '');
r = await hit('GET', '/api/mp/dashboard/team', undefined, mpAs(2));
check('the exhibitor is told why someone has no pass', /2 passes/.test(r.json.members.find(m => m.email === 'c@accel.test').pass_note) && r.json.issued === 2, r.text);
r = await hit('PUT', '/api/mp/admin/teams/2/passes', { passes: null }, admin);
check('cleared: back to the booth own 5, and the passes come back', r.json.passes === 5 && r.json.passes_source === 'booth' && badgeOf('c@accel.test') === 'Exhibitor' && badgeOf('e@accel.test') === 'Exhibitor' && badgeOf('f@accel.test') === 'Visitor Pass', r.text);
check('every change of number is in the audit log', q("SELECT id FROM admin_audit WHERE action = 'marketplace.team-passes'").length === 3, '');

// ---- Premium Booth: people can be listed, passes wait for a number ----
r = await hit('POST', '/api/mp/dashboard/team', P({ first_name: 'Pia', email: 'pia@premium.test' }), mpAs(4));
check('no number yet: the person is listed and no pass is made', r.status === 200 && r.json.members[0].pass === '' && /organisers/.test(r.json.members[0].pass_note) && !one("SELECT id FROM attendees WHERE email = 'pia@premium.test'"), r.text);
r = await hit('PUT', '/api/mp/admin/teams/4/passes', { passes: 5 }, admin);
check('the organisers set 5: the pass is issued straight away', badgeOf('pia@premium.test') === 'Exhibitor', r.text);

// ---- edit and remove ----
const ashaRow = one("SELECT id FROM exhibitor_team WHERE email = 'asha@explorer.test'");
r = await hit('PUT', '/api/mp/dashboard/team/' + ashaRow.id, P({ speaker: false, at_booth: true, mobile: '98201 55555', linkedin_url: 'https://linkedin.com/in/asha-rao' }), mpAs(1));
asha = one("SELECT * FROM attendees WHERE email = 'asha@explorer.test'");
check('off the stage: the pass becomes an exhibitor pass', r.status === 200 && asha.badge_type === 'Exhibitor' && asha.role === 'Exhibitor', asha);
r = await hit('PUT', '/api/mp/dashboard/team/' + ashaRow.id, P({ email: 'asha@accel.test' }), mpAs(2));
check('another exhibitor cannot edit this person', r.status === 404, r.status);
r = await hit('DELETE', '/api/mp/dashboard/team/' + ashaRow.id, undefined, mpAs(2));
check('another exhibitor cannot remove this person', r.status === 404 && !!one('SELECT id FROM exhibitor_team WHERE id = ?', ashaRow.id), r.status);
r = await hit('PUT', '/api/mp/dashboard/team/' + ashaRow.id, P({ first_name: 'Asha', email: 'asha.new@explorer.test', speaker: true }), mpAs(1));
check('a changed email: the old address gives the pass back, the new one gets it', badgeOf('asha@explorer.test') === 'Visitor Pass' && badgeOf('asha.new@explorer.test') === 'Exhibition Speaker' && r.json.used === 1, r.text);
r = await hit('DELETE', '/api/mp/dashboard/team/' + ashaRow.id, undefined, mpAs(1));
check('removed: the pass is taken back, the person is not deleted', r.status === 200 && r.json.members.length === 0 && badgeOf('asha.new@explorer.test') === 'Visitor Pass' && one("SELECT role FROM attendees WHERE email = 'asha.new@explorer.test'").role === 'attendee', r.text);
r = await hit('POST', '/api/mp/dashboard/team', P({ first_name: 'Sam', last_name: 'Spoc', email: 'spoc@explorer.test' }), mpAs(1));
check('the booth contact adds themselves and gets a pass', r.status === 200 && badgeOf('spoc@explorer.test') === 'Exhibitor', r.text);

// ---- a team member cannot open a second booth card in the app ----
const spocAttendee = one("SELECT id FROM attendees WHERE email = 'spoc@explorer.test'").id;
r = await hit('PUT', '/api/attendees/' + spocAttendee + '/exhibitor', { company_name: 'Explorer Co Duplicate' }, { Cookie: sessionCookie(SESSION, spocAttendee) });
check('an exhibitor pass from a team does not make a second exhibitor card', r.status === 409 && q('SELECT id FROM exhibitors').length === 5, r.status + ' ' + r.text);

// ---- the invitation emails no longer hand the contact a pass ----
sent.length = 0;
r = await hit('POST', '/api/mp/admin/exhibitors/4/invite', {}, admin);
check('the marketplace invitation is sent', r.status === 200 && sent.length === 1, r.text);
check('it gives the contact no pass and points at the team list', !one("SELECT id FROM attendees WHERE email = 'spoc@premium.test'") && /add the people coming from your company/.test(sent[0].Content.Body[0].Content) && !/delegate pass for the event app/i.test(sent[0].Content.Body[0].Content), sent[0]?.Content.Body[0].Content.slice(0, 200));

// ---- the "add your team" email ----
sent.length = 0;
r = await hit('PUT', '/api/mp/admin/teams/settings', { deadline: '15 November 2026' }, admin);
check('the organisers set the deadline', r.status === 200 && r.json.deadline === '15 November 2026', r.text);
r = await hit('POST', '/api/mp/admin/teams/3/ask', {}, admin);
const mail = sent[0], html = mail?.Content.Body[0].Content || '';
check('the email goes to the booth contact, once', r.status === 200 && sent.length === 1 && mail.Recipients.To[0] === 'richa@sheet.test', r.text);
check('from the official address', /register@bharataiinnovation\.com/.test(mail.Content.From), mail.Content.From);
check('subject names the company', mail.Content.Subject === 'Booth Representative and Speaker Details: Sheet Pods | Bharat AI Innovation 2026', mail.Content.Subject);
check('in the team format: Dear <first name>, Greetings, Warm regards', /Dear Richa,/.test(html) && /Greetings from Bharat AI Innovation!/.test(html) && /Warm regards,/.test(html) && /Team Bharat AI Innovation/.test(html), html.slice(0, 400));
check('it names the booth and its passes', /Startup Pod \(1\.5m × 1\.5m\)/.test(html) && /<strong>2 exhibitor passes<\/strong>/.test(html) && /Delegate Pass/.test(html), '');
check('it asks for every detail', ['First name and last name', 'Designation', 'Organisation name', 'Official email address', 'Contact number', 'LinkedIn profile', 'photo'].every(w => html.includes(w)) && /Exhibitor<\/strong>: present at your booth/.test(html) && /Speaker<\/strong>: presents/.test(html) && /Both<\/strong>/.test(html), '');
check('it says the contact gets a pass only by adding themselves', /you receive a pass only if you add yourself/.test(html), '');
check('it gives the deadline and points at the branding sizes', /Deadline: 15 November 2026/.test(html) && /Booth Branding/.test(html), '');
check('no government backing claim, no registration count', !/MeitY|Government of|supported by/i.test(html) && !/\d[\d,]{2,}\s+(registr|attend|delegat)/i.test(html), '');
const link = (html.match(/href="(https:\/\/bharataiinnovation\.com\/marketplace\/signin\?t=[^"]+)"/) || [])[1] || '';
check('its button is a sign-in link that opens the Team screen', /&amp;go=team$/.test(link), link);
r = await hit('GET', link.replace('https://bharataiinnovation.com', '').replace(/&amp;/g, '&'));
check('the link signs the contact in and lands on Your Team', r.status === 302 && r.h.location === '/marketplace/dashboard#team' && /mp_session=3\./.test(r.h['set-cookie'] || ''), r.status + ' ' + r.h.location);
r = await hit('GET', link.replace('https://bharataiinnovation.com', '').replace(/&amp;/g, '&').replace(/t=3\./, 't=1.'));
check('a link altered to another company is refused', r.status === 302 && /signin=expired/.test(r.h.location || '') && !r.h['set-cookie'], r.h.location);
r = await hit('POST', '/api/mp/admin/teams/3/ask', {}, admin);
check('asked today: not asked again', r.status === 409 && /today/i.test(r.json.error) && sent.length === 1, r.text);
r = await hit('POST', '/api/mp/admin/teams/5/ask', {}, admin);
check('no contact email: nothing sent', r.status === 409 && sent.length === 1, r.text);
db.run("UPDATE attendees SET unsubscribed_at = datetime('now'), email = 'spoc@premium.test' WHERE id = 105");
r = await hit('POST', '/api/mp/admin/teams/4/ask', {}, admin);
check('an unsubscribed contact is never emailed', r.status === 409 && /unsubscribed/i.test(r.json.error) && sent.length === 1, r.text);
sent.length = 0;
r = await hit('POST', '/api/mp/admin/teams/2/ask', {}, admin);
const html2 = sent[0]?.Content.Body[0].Content || '';
check('with no contact name: Dear <company> team; people the contact added are not called ours', /Dear Accel Co team,/.test(html2) && /Your team list has 8 people so far/.test(html2) && !/We have already added/.test(html2) && /photos that are\s+missing/.test(html2), html2.slice(0, 300));
check('a company name cannot inject markup into the email', (() => { db.run("UPDATE exhibitors SET company_name = '<img src=x onerror=1>' WHERE id = 5"); return true; })(), '');

// ---- the admin screen and the CSV ----
r = await hit('GET', '/api/mp/admin/teams', undefined, admin);
const t2 = r.json.teams.find(t => t.exhibitor_id === 2), t5 = r.json.teams.find(t => t.exhibitor_id === 5);
check('the admin screen lists each team with its passes, contacts and when it was asked', r.status === 200 && t2.passes === 5 && t2.used === 6 && t2.members.length === 8 && t2.contacts[0] === 'spoc@accel.test' && !!t2.last_asked && t2.can_ask === false, t2 && { passes: t2.passes, used: t2.used, n: t2.members.length });
check('an exhibitor with nothing at all is not listed; the summary counts', !t5 && r.json.summary.people === q('SELECT id FROM exhibitor_team').length && r.json.deadline === '15 November 2026', r.json.summary);
check('never the internal booking notes', !/description/.test(JSON.stringify(r.json.teams[0])), '');
db.run("UPDATE exhibitor_team SET first_name = '=HYPERLINK(\"http://evil\")' WHERE email = 'c@accel.test'");
r = await hit('GET', '/api/mp/admin/teams.csv', undefined, admin);
check('the CSV downloads with every person', r.status === 200 && /text\/csv/.test(r.h['content-type']) && r.text.split('\r\n').length === q('SELECT id FROM exhibitor_team').length + 1 && /Exhibitor,Booth,First name,Last name,Designation/.test(r.text), r.status + ' ' + r.text.slice(0, 120));
check('a cell that starts like a formula is defused', r.text.includes('"\'=HYPERLINK(""http://evil"")"'), r.text.split('\r\n').find(l => l.includes('HYPERLINK')));
const memberId = one("SELECT id FROM exhibitor_team WHERE email = 'f@accel.test'").id;
r = await hit('DELETE', '/api/mp/admin/teams/member/' + memberId, undefined, admin);
check('the organisers can remove a person', r.status === 200 && !one('SELECT id FROM exhibitor_team WHERE id = ?', memberId) && !!one("SELECT id FROM attendees WHERE email = 'f@accel.test'"), r.text);
r = await hit('POST', '/api/mp/admin/teams/2/settle', {}, admin);
check('"Issue passes now" settles a team', r.status === 200 && r.json.members.length === 7, r.text);

// ---- an imported row with no email, and a speaker photo from the site ----
db.run("INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, added_by) VALUES (1, 3, 'Dipak', 'Zope', 'CEO', 'Sheet Pods', '', '/images/talks/dipak-zope.webp', 1, 1, 'sheet')");
db.run("INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, added_by) VALUES (1, 3, 'Archana', 'Ambekar', '', 'Sheet Pods', 'archana@sheet.test', '', 1, 0, 'sheet')");
r = await hit('POST', '/api/mp/admin/teams/3/settle', {}, admin);
const dip = r.json.members.find(m => m.first_name === 'Dipak'), arc = r.json.members.find(m => m.first_name === 'Archana');
check('imported without an email: no pass, and the exhibitor is told what to add', dip.pass === '' && /email/i.test(dip.pass_note) && dip.missing.includes('Email'), dip);
check('imported with an email: pass issued, what is missing is listed', arc.pass === 'Exhibitor' && arc.missing.join() === 'Photo,Designation,Mobile,LinkedIn', arc);
r = await hit('PUT', '/api/mp/dashboard/team/' + dip.id, P({ first_name: 'Dipak', last_name: 'Zope', designation: 'CEO', email: 'dipak@sheet.test', speaker: true, photo_url: '/images/talks/dipak-zope.webp' }), mpAs(3));
const dz = one("SELECT * FROM attendees WHERE email = 'dipak@sheet.test'");
check('the contact adds the email: pass issued, the site photo kept and put on the pass', r.status === 200 && dz?.badge_type === 'Exhibition Speaker' && dz.avatar_url === 'https://bharataiinnovation.com/images/talks/dipak-zope.webp', dz);
r = await hit('PUT', '/api/mp/dashboard/team/' + arc.id, P({ first_name: 'Archana', email: 'archana@sheet.test', photo_url: '/images/talks/dipak-zope.webp' }), mpAs(3));
check('a site photo cannot be typed onto someone else', r.status === 400 && /photo/i.test(r.json.error), r.text);

db.run("DELETE FROM admin_audit WHERE action = 'marketplace.team-asked' AND entity_id = '3'");
sent.length = 0;
r = await hit('POST', '/api/mp/admin/teams/3/ask', {}, admin);
const html3 = sent[0]?.Content.Body[0].Content || '';
check('people from the sheet are called ours', r.status === 200 && /We have already added the 2 people you shared with our team\./.test(html3), html3.slice(0, 200));

// ---- someone imported from the sheet gets their pass when the contact opens the screen ----
db.run("INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, at_booth, speaker, added_by) VALUES (1, 4, 'Imran', 'Shaikh', 'Engineer', 'Premium Co', 'imran@premium.test', 1, 0, 'sheet')");
r = await hit('GET', '/api/mp/dashboard/team', undefined, mpAs(4));
check('an imported person is given their pass when the contact opens Your Team, never "No pass yet" without a reason', r.json.members.find(m => m.email === 'imran@premium.test')?.pass === 'Exhibitor' && badgeOf('imran@premium.test') === 'Exhibitor' && r.json.members.every(m => m.pass || m.pass_note), r.text);
db.run("INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, designation, company, email, at_booth, speaker, added_by) VALUES (1, 1, 'Late', 'Engineer', 'Explorer Co', 'late@explorer.test', 1, 0, 'sheet')");
db.run("DELETE FROM admin_audit WHERE action = 'marketplace.team-asked' AND entity_id = '1'");
sent.length = 0;
r = await hit('POST', '/api/mp/admin/teams/1/ask', {}, admin);
const lateRow = one("SELECT pass, pass_note FROM exhibitor_team WHERE email = 'late@explorer.test'");
check('asking settles the imported people first: past the booth passes they are told why', r.status === 200 && lateRow.pass === '' && /all in use/.test(lateRow.pass_note), lateRow);

// ---- the company's own page: booth, payment, passes to download, the app ----
db.run("UPDATE booth_allocations SET amount_inr = 291000, gst_inr = 52380, grand_total_inr = 343380, amount_paid_inr = 200000, invoice_number = 'BAI/26-27/7' WHERE exhibitor_id = 2");
r = await hit('GET', '/api/mp/dashboard/booth', undefined, mpAs(2));
check('the booth card: which event, the booth and its size, passes', r.status === 200 && r.json.event?.title === 'Bharat AI' && r.json.event.start_date === '2026-11-20' && r.json.booth === '12' && r.json.label === 'Accelerator Booth (3m × 3m)' && r.json.passes === 5, r.text);
check('the booth card: paid and pending, from the booth record, with the invoice', r.json.payment?.total === 343380 && r.json.payment.paid === 200000 && r.json.payment.pending === 143380 && r.json.payment.booths[0].invoice === 'BAI/26-27/7', r.json.payment);
r = await hit('GET', '/api/mp/dashboard/booth', undefined, mpAs(3));
check('known only from the sheet: no payment shown (the sheet is not a record)', r.status === 200 && r.json.payment === null && r.json.label === 'Startup Pod (1.5m × 1.5m)', r.text);
r = await hit('GET', '/api/mp/dashboard/booth');
check('the booth card needs a sign-in', r.status === 401, r.status);
const vRow = one("SELECT id FROM exhibitor_team WHERE email = 'visitor@accel.test'"), dRow = one("SELECT id FROM exhibitor_team WHERE email = 'delegate@accel.test'");
r = await hit('GET', `/api/mp/dashboard/team/${vRow.id}/pass`, undefined, mpAs(2));
check('a pass the booth gave can be downloaded: the person and a signed QR token', r.status === 200 && r.json.user.badge_type === 'Exhibitor' && r.json.user.id === 101 && /^101\.[0-9a-f]{24}$/.test(r.json.token) && r.json.variant === 'exhibitor' && r.json.booth === '12' && !('email' in r.json.user), r.text);
r = await hit('GET', `/api/mp/dashboard/team/${dRow.id}/pass`, undefined, mpAs(2));
check('a pass of their own is theirs to download in the app', r.status === 409 && /of their own/.test(r.json.error), r.text);
r = await hit('GET', `/api/mp/dashboard/team/${vRow.id}/pass`, undefined, mpAs(1));
check("another company cannot download this team's passes", r.status === 404, r.status);
db.run("UPDATE attendees SET last_login_at = datetime('now') WHERE id = 101");
r = await hit('GET', '/api/mp/dashboard/team', undefined, mpAs(2));
check('Bharat AI Connect: who on the team has signed in', r.json.members.find(m => m.email === 'visitor@accel.test')?.app_signed_in === true && r.json.members.find(m => m.email === 'c@accel.test')?.app_signed_in === false, r.json.members.map(m => [m.email, m.app_signed_in]));
db.run("UPDATE exhibitor_team_settings SET owner_name = 'Tushar' WHERE exhibitor_id = 3");
db.run("DELETE FROM admin_audit WHERE action = 'marketplace.team-asked' AND entity_id = '3'");
sent.length = 0;
await hit('POST', '/api/mp/admin/teams/3/ask', {}, admin);
check('the email: artwork to their Bharat AI contact by name, register@ in CC', /Please email your final artwork to Tushar, your contact at Bharat AI Innovation, and mark <strong>register@bharataiinnovation\.com<\/strong> in CC\./.test(sent[0]?.Content.Body[0].Content || ''), (sent[0]?.Content.Body[0].Content || '').match(/Please email your final artwork[^.]*\./)?.[0]);
db.run("UPDATE exhibitor_team_settings SET owner_email = 'tushar@bharataiinnovation.com' WHERE exhibitor_id = 3");
r = await hit('GET', '/api/mp/dashboard/team', undefined, mpAs(3));
check('the Booth Branding screen knows where the artwork goes', r.json.branding?.artwork?.name === 'Tushar' && r.json.branding.artwork.email === 'tushar@bharataiinnovation.com' && r.json.branding.artwork.cc === 'register@bharataiinnovation.com', r.json.branding);

// ---- Report a problem ----
r = await hit('POST', '/api/mp/dashboard/reports', { topic: 'booth', message: 'Our booth number is wrong here.' });
check('reporting needs a sign-in', r.status === 401, r.status);
r = await hit('POST', '/api/mp/dashboard/reports', { topic: 'booth', message: 'Our booth number is wrong here.' }, mpAs(9));
check('a company without a booth cannot report here', r.status === 403, r.status);
r = await hit('POST', '/api/mp/dashboard/reports', { topic: '', message: 'Our booth number is wrong here.' }, mpAs(2));
check('a report needs a topic', r.status === 400 && /about/.test(r.json.error), r.text);
r = await hit('POST', '/api/mp/dashboard/reports', { topic: 'booth', message: 'wrong' }, mpAs(2));
check('a report needs a sentence', r.status === 400, r.text);
sent.length = 0;
r = await hit('POST', '/api/mp/dashboard/reports', { topic: 'payment', message: 'We paid in full on 5 Nov but this shows pending <script>x</script>.' }, mpAs(2));
await new Promise(res => setTimeout(res, 100)); // the email goes out after the reply
check('a report is saved as an enquiry of its own type, open', r.status === 200 && r.json.reports.length === 1 && r.json.reports[0].status === 'open' && r.json.reports[0].topic === 'Payment or invoice' && one("SELECT inquiry_type, organization FROM inquiries WHERE id = ?", r.json.id)?.inquiry_type === 'exhibitor_issue', r.text);
check('with no contact named on our side, the team address is emailed, the message escaped', sent.length === 1 && /Exhibitor report: Payment or invoice \(Accel Co\)/.test(sent[0].Content.Subject) && /&lt;script&gt;/.test(sent[0].Content.Body[0].Content) && !/<script>x/.test(sent[0].Content.Body[0].Content), sent[0]?.Content.Subject);
sent.length = 0;
r = await hit('POST', '/api/mp/dashboard/reports', { topic: 'branding', message: 'The fascia size looks different from the email.' }, mpAs(3));
await new Promise(res => setTimeout(res, 100));
check("the report goes to the exhibitor's own contact on our side", r.status === 200 && sent[0]?.Recipients.To[0] === 'tushar@bharataiinnovation.com', sent[0]?.Recipients);
r = await hit('GET', '/api/mp/dashboard/reports', undefined, mpAs(1));
check("one company never sees another's reports", r.status === 200 && r.json.reports.length === 0, r.text);
r = await hit('GET', '/api/mp/admin/reports');
check('the reports list is for admins only', r.status === 403, r.status);
r = await hit('GET', '/api/mp/admin/reports', undefined, admin);
check('admin: every report, open first, with the company', r.status === 200 && r.json.reports.length === 2 && r.json.open === 2 && r.json.reports.some(x => x.company === 'Accel Co'), r.text);
const rid = r.json.reports.find(x => x.company === 'Accel Co').id;
r = await hit('PATCH', '/api/mp/admin/reports/' + rid, { status: 'resolved', reply: 'Recorded your payment, thank you.' }, admin);
r = await hit('GET', '/api/mp/dashboard/reports', undefined, mpAs(2));
check('resolved with a reply: the exhibitor sees both', r.json.reports[0].status === 'resolved' && r.json.reports[0].reply === 'Recorded your payment, thank you.', r.text);
check('resolving is in the audit log', !!one("SELECT id FROM admin_audit WHERE action = 'marketplace.report-resolved'"), '');
for (let i = 0; i < 4; i++) await hit('POST', '/api/mp/dashboard/reports', { topic: 'other', message: 'Another thing to look at, number ' + i }, mpAs(2));
r = await hit('POST', '/api/mp/dashboard/reports', { topic: 'other', message: 'One more thing to look at please.' }, mpAs(2));
check('at most five reports a day from one contact', r.status === 429, r.status);

// ---- the pages ----
r = await hit('GET', '/marketplace/dashboard');
check('the dashboard has the Team screen, the branding screen and the new script', ['data-section="team"', 'id="team-form"', 'id="team-add-btn"', 'data-section="branding"', 'marketplace-dashboard.js?v=10', 'marketplace.css?v=9', 'data-section="connect"', 'id="connect-team"', 'id="dash-booth"', 'data-section="report"', 'id="report-form"'].every(m => r.text.includes(m)), '');
check('the team form asks for every detail the organiser listed', ['team-first', 'team-last', 'team-designation', 'team-company', 'team-email', 'team-mobile', 'team-linkedin', 'team-photo-file', 'team-at-booth', 'team-speaker'].every(id => r.text.includes('id="' + id + '"')), '');
r = await hit('GET', '/marketplace/admin');
check('the admin page has Teams & Passes', ['data-section="teams"', 'id="admin-teams"', 'id="team-ask-all"', 'id="team-csv"', 'id="team-deadline"', 'marketplace-admin.js?v=13', 'data-section="reports"', 'id="admin-reports"'].every(m => r.text.includes(m)), '');

console.log(fails ? `\n${fails} FAILED` : '\nAll exhibitor team checks passed');
process.exit(fails ? 1 : 0);
