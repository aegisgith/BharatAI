// Built-worker checks for duplicates and merging (28 Oct 2026), run against real
// SQLite (sql.js) loaded with the production schema, so the merge's SQL - the
// OR IGNORE moves, the unique keys, the one-batch rollback - is tested for real.
// Run after `npm run build`:  node scripts/verify/smoke-merge-dupes.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { sessionCookie } from './pay-db.mjs';
const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');
const worker = (await import(new URL('../../dist/_worker.js?' + Date.now(), import.meta.url).href)).default;

const SQL = await initSqlJs();
const db = new SQL.Database();
db.exec(readFileSync(new URL('./prod-schema.sql', import.meta.url), 'utf8'));

// A D1 binding over sql.js: prepare/bind/first/all/run, and batch as one transaction.
const clean = (a) => a.map(v => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
const D1 = {
  prepare(sql) {
    let args = [];
    const s = {
      bind(...a) { args = clean(a); return s; },
      async first() { const st = db.prepare(sql); st.bind(args); const r = st.step() ? st.getAsObject() : null; st.free(); return r; },
      async all() { const st = db.prepare(sql); st.bind(args); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return { results: out }; },
      async run() { s._run(); return { meta: { last_row_id: db.exec('SELECT last_insert_rowid()')[0].values[0][0], changes: db.getRowsModified() } }; },
      _run() { db.run(sql, args); },
    };
    return s;
  },
  async batch(list) {
    db.exec('SAVEPOINT d1batch');
    try { for (const s of list) s._run(); db.exec('RELEASE d1batch'); }
    catch (e) { db.exec('ROLLBACK TO d1batch'); db.exec('RELEASE d1batch'); throw e; }
    return list.map(() => ({ results: [], meta: {} }));
  },
  async exec(sql) { db.exec(sql); return { count: 1 }; },
};
const SESSION = 'smoke-session';
const env = new Proxy({ ADMIN_SECRET: 'smoke-admin', SESSION_SECRET: SESSION, DB: D1 }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };
const hit = async (method, path, body, headers = {}) => {
  const res = await worker.fetch(new Request('https://bharataiinnovation.com' + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
};
const ADMIN = { Authorization: 'Bearer smoke-admin' };
const q = (sql, ...a) => { const st = db.prepare(sql); st.bind(clean(a)); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; };
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };

// ---- seed: the shapes production actually has ----
db.run("INSERT INTO events (id, title, start_date, end_date) VALUES (1, 'Bharat AI', '2026-11-20', '2026-11-21'), (2, 'Other', '2027-01-01', '2027-01-01')");
const person = (id, name, email, mobile, extra = {}) => {
  const row = { id, event_id: 1, name, email, mobile, badge_type: 'Visitor Pass', payment_status: 'paid', company: '', ...extra };
  const cols = Object.keys(row);
  db.run(`INSERT INTO attendees (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, clean(cols.map(k => row[k])));
};
person(1, 'Imad Jaweed', 'imad@gmail.com', '9820011111', { pass_downloaded_at: '2026-10-01 10:00:00', last_login_at: '2026-10-02' });
person(2, 'Imaad Jaweed', 'imaad@work.in', '+91 98200 11111', { company: 'Acme AI', linkedin_url: 'https://linkedin.com/in/imaad', last_login_at: '2026-10-05' });
person(3, 'Ritesh Parekh', 'ritesh@gmail.com', '9820022222');
person(4, 'Ritesh D Parekh', 'ritesh@proton.me', '09820022222', { badge_type: 'Delegate Pass', payment_status: 'paid' });
person(5, 'Jitendra Jagtap', 'jitendra@optimizt.com', '9820033333');
person(6, 'Archana Jitendra Jagtap', 'archana@optimizt.com', '9820033333');
person(7, 'Tushar', 'tushar@aegis.edu.in', '9820044444', { badge_type: 'VIP Pass' });
person(8, 'Tushar Waghmode', 'tushar@bellaward.com', '9820044444', { badge_type: 'Organiser' });
person(9, 'Ajay Rao', 'ajay@a.in', '9820055555', { badge_type: 'Delegate Pass' });
person(10, 'Ajay Rao', 'ajay@b.in', '9820055555', { badge_type: 'VIP Pass' });
person(11, 'Rahul Kumar', 'rahul@k.in', '9000000011');
person(12, 'Rahul Kumar Singh', 'rahul@s.in', '9000000012');
person(13, 'Meera Iyer', 'meera@i.in', '9000000013');
person(14, 'Other Event Imad', 'imad@other.in', '9820011111', { event_id: 2 });
db.run("INSERT INTO payment_orders (order_id, attendee_id, event_id, pass_type, base_paise, gst_paise, amount_paise, status) VALUES ('BAI-1', 4, 1, 'Delegate Pass', 499900, 89982, 589882, 'paid')");
db.run("INSERT INTO invoices (invoice_no, attendee_id, buyer_name, buyer_email, item_desc, taxable_paise, total_paise) VALUES ('AKT-1', 4, 'Ritesh D Parekh', 'ritesh@proton.me', 'Delegate Pass', 499900, 589882)");
db.run("INSERT INTO connections (event_id, from_attendee_id, to_attendee_id, status) VALUES (1, 2, 13, 'accepted'), (1, 1, 13, 'accepted'), (1, 1, 2, 'pending'), (1, 13, 2, 'accepted')");
db.run("INSERT INTO messages (event_id, sender_id, receiver_id, content) VALUES (1, 13, 2, 'hello')");
db.run("INSERT INTO panel_registrations (attendee_id, panel_slug) VALUES (1, 'djsanghvi-21sep'), (2, 'djsanghvi-21sep'), (2, 'jnu-30sep')");
db.run("INSERT INTO campaign_recipients (campaign_id, attendee_id, email) VALUES (1, 2, 'imaad@work.in')");

// ---- the finder ----
let r = await hit('GET', '/api/admin/events/1/attendees/duplicates', undefined, ADMIN);
const g = r.json || {};
const groupOf = (id) => (g.groups || []).find(x => [x.primary.id, ...x.duplicates.map(d => d.id)].includes(id));
check('the finder answers', r.status === 200, r.status + ' ' + r.text.slice(0, 200));
check('it counts same-mobile groups apart from similar names', g.mobileGroups === 5 && g.nameGroups === 1, JSON.stringify({ m: g.mobileGroups, n: g.nameGroups }));
check('only the two one-person groups are certain', g.certainGroups === 2 && groupOf(1)?.certain && groupOf(3)?.certain, JSON.stringify((g.groups || []).map(x => [x.primary.id, x.certain, x.review])));
check('a typo in a name (Imad / Imaad) is the same person; the row with the downloaded pass is kept', groupOf(1)?.primary.id === 1, JSON.stringify(groupOf(1)));
check('the paid row is kept even though it is newer (Ritesh D Parekh)', groupOf(3)?.primary.id === 4, JSON.stringify(groupOf(3)?.primary));
check('family on one phone waits for a person', groupOf(5)?.certain === false && /Different names/.test(groupOf(5)?.review || ''), JSON.stringify(groupOf(5)));
check('a team pass waits for a person', groupOf(7)?.certain === false && /team or special/.test(groupOf(7)?.review || ''), JSON.stringify(groupOf(7)));
check('two paid rows wait for a person', groupOf(9)?.certain === false && /More than one/.test(groupOf(9)?.review || ''), JSON.stringify(groupOf(9)));
check('similar names on different mobiles are a hint, never certain', groupOf(11)?.reason === 'name' && groupOf(11)?.certain === false, JSON.stringify(groupOf(11)));
check('another event is never grouped in', !groupOf(14), JSON.stringify(groupOf(14)));

// ---- guards ----
r = await hit('POST', '/api/admin/attendees/4/merge-into/3', {}, ADMIN);
check('folding the paid row into an unpaid one is refused, and says which to keep', r.status === 409 && /#4 holds the paid pass/.test(r.json?.error || '') && q('SELECT id FROM attendees WHERE id IN (3,4)').length === 2, r.status + ' ' + r.text);
r = await hit('POST', '/api/admin/attendees/14/merge-into/1', {}, ADMIN);
check('rows from two events are never merged', r.status === 400 && q('SELECT id FROM attendees WHERE id = 14').length === 1, r.status + ' ' + r.text);
r = await hit('POST', '/api/admin/attendees/2/merge-into/1', {});
check('merging needs the admin key', r.status === 401, r.status + '');

// ---- merge all certain ----
r = await hit('POST', '/api/admin/events/1/attendees/merge-certain', {}, ADMIN);
check('merge all folds exactly the two certain duplicates', r.status === 200 && r.json?.merged === 2 && !(r.json?.failed || []).length, r.status + ' ' + r.text);
check('the folded rows are gone and the kept rows stay', q('SELECT id FROM attendees WHERE id IN (1,2,3,4) ORDER BY id').map(x => x.id).join() === '1,4', JSON.stringify(q('SELECT id FROM attendees WHERE id IN (1,2,3,4)')));
const one = q('SELECT * FROM attendees WHERE id = 1')[0] || {};
check('empty fields on the kept row are filled from the other', one.company === 'Acme AI' && one.linkedin_url === 'https://linkedin.com/in/imaad' && one.email === 'imad@gmail.com', JSON.stringify({ c: one.company, l: one.linkedin_url, e: one.email }));
check('the paid order and invoice stay with the paid row', q("SELECT attendee_id FROM payment_orders WHERE order_id = 'BAI-1'")[0]?.attendee_id === 4 && q("SELECT attendee_id FROM invoices WHERE invoice_no = 'AKT-1'")[0]?.attendee_id === 4, JSON.stringify(q('SELECT order_id, attendee_id FROM payment_orders')));
const conns = q('SELECT from_attendee_id f, to_attendee_id t FROM connections ORDER BY f, t').map(x => x.f + '>' + x.t).join(' ');
check('connections move, a repeat collapses to one, and a connection between the two rows disappears', conns === '1>13 13>1', conns);
check('messages move to the kept row', q('SELECT receiver_id FROM messages')[0]?.receiver_id === 1, JSON.stringify(q('SELECT * FROM messages')));
const panels = q('SELECT attendee_id a, panel_slug p FROM panel_registrations ORDER BY p').map(x => x.a + ':' + x.p).join(' ');
check('panel sign-ups move; the one both rows had is kept once', panels === '1:djsanghvi-21sep 1:jnu-30sep', panels);
check('campaign history moves too', q('SELECT attendee_id FROM campaign_recipients')[0]?.attendee_id === 1, JSON.stringify(q('SELECT * FROM campaign_recipients')));
const merges = q("SELECT entity_id, detail FROM admin_audit WHERE action = 'attendee.merge' ORDER BY id");
check('each merge is in the audit log with the folded row in full', merges.length === 2 && /imaad@work\.in/.test(merges[0].detail) && /ritesh@gmail\.com/.test(merges[1].detail), JSON.stringify(merges));
check('nothing points at a deleted row', ['payment_orders', 'invoices', 'panel_registrations', 'campaign_recipients'].every(t => q(`SELECT count(*) n FROM ${t} WHERE attendee_id IN (2,3)`)[0].n === 0) && q('SELECT count(*) n FROM connections WHERE from_attendee_id IN (2,3) OR to_attendee_id IN (2,3)')[0].n === 0, 'orphans left');

r = await hit('GET', '/api/admin/events/1/attendees/duplicates', undefined, ADMIN);
check('afterwards only the groups that need a person remain', r.json?.mobileGroups === 3 && r.json?.certainGroups === 0, JSON.stringify({ m: r.json?.mobileGroups, c: r.json?.certainGroups }));
r = await hit('POST', '/api/admin/events/1/attendees/merge-certain', {}, ADMIN);
check('running merge all again changes nothing', r.json?.merged === 0, r.text);
r = await hit('POST', '/api/admin/attendees/6/merge-into/5', {}, ADMIN);
check('an admin can still merge a group by hand', r.status === 200 && q('SELECT id FROM attendees WHERE id = 6').length === 0, r.status + ' ' + r.text);

// ---- a rolled-back merge leaves everything as it was ----
db.run("CREATE TRIGGER no_delete_13 BEFORE DELETE ON attendees WHEN old.id = 13 BEGIN SELECT RAISE(ABORT, 'held'); END");
r = await hit('POST', '/api/admin/attendees/13/merge-into/1', {}, ADMIN);
check('a merge that fails half-way changes nothing', r.status === 500 && /Nothing was changed/.test(r.json?.error || '') && q('SELECT count(*) n FROM connections WHERE from_attendee_id = 13 OR to_attendee_id = 13')[0].n === 2, r.status + ' ' + r.text);
db.run('DROP TRIGGER no_delete_13');

// ---- every way in refuses a number already on the list ----
const reg = (over) => hit('POST', '/api/events/1/attendees/register', { name: 'New Person', company: 'Co', job_title: 'Head', city: 'Pune', industry: 'Software & SaaS', badge_type: 'Visitor Pass', ...over });
r = await reg({ email: 'someone@new.in', mobile: '98200 11111' });
check('registration: a held mobile is refused (real SQL)', r.status === 409 && r.json?.code === 'mobile_registered' && /im•••@gmail\.com/.test(r.json?.error || ''), r.status + ' ' + r.text);
r = await reg({ email: 'someone@new.in', mobile: '9811100001' });
check('registration: a new mobile goes through (real SQL)', r.status === 201, r.status + ' ' + r.text);
const newId = r.json?.id;

const me = (id) => ({ Cookie: sessionCookie(SESSION, id) });
r = await hit('PUT', '/api/attendees/' + newId + '/profile', { name: 'New Person', mobile: '+91 98200 11111' }, me(newId));
check('own profile: changing to a held mobile is refused, and nothing is saved', r.status === 409 && r.json?.code === 'mobile_registered' && q('SELECT mobile FROM attendees WHERE id = ?', newId)[0].mobile === '9811100001', r.status + ' ' + r.text);
r = await hit('PUT', '/api/attendees/9/profile', { name: 'Ajay Rao', mobile: '9820055555', company: 'Rao & Co' }, me(9));
check('own profile: a row that already shared a number before today can still save', r.status === 200 && r.json?.company === 'Rao & Co', r.status + ' ' + r.text);

r = await hit('PUT', '/api/admin/attendees/11', { name: 'Rahul Kumar', mobile: '9000000012' }, ADMIN);
check('admin edit: moving a mobile onto another attendee is refused and names them', r.status === 409 && /Rahul Kumar Singh/.test(r.json?.error || ''), r.status + ' ' + r.text);
r = await hit('PATCH', '/api/admin/attendees/11', { mobile: '9000000012' }, ADMIN);
check('admin inline edit: the same', r.status === 409 && q('SELECT mobile FROM attendees WHERE id = 11')[0].mobile === '9000000011', r.status + ' ' + r.text);
r = await hit('PUT', '/api/admin/attendees/11', { name: 'Rahul K', mobile: '9000000011' }, ADMIN);
check('admin edit: keeping the same mobile saves', r.status === 200, r.status + ' ' + r.text);
r = await hit('POST', '/api/admin/attendees', { event_id: 1, name: 'Dup', email: 'dup@x.in', mobile: '9000000013' }, ADMIN);
check('admin add: a held mobile is refused', r.status === 409 && /Meera Iyer/.test(r.json?.error || ''), r.status + ' ' + r.text);
r = await hit('POST', '/api/admin/attendees/bulk', { event_id: 1, attendees: [
  { name: 'Bulk One', email: 'b1@x.in', mobile: '9000000013' },
  { name: 'Bulk Two', email: 'b2@x.in', mobile: '9777700001' },
  { name: 'Bulk Three', email: 'b3@x.in', mobile: '+91 97777 00001' },
] }, ADMIN);
check('bulk upload: held numbers and repeats within the sheet are skipped and named', r.json?.imported === 1 && r.json?.skipped === 2 && (r.json?.errors || []).every(e => /^Duplicate mobile/.test(e)), r.status + ' ' + r.text);
r = await hit('POST', '/api/desk/walkin', { name: 'Walk In', email: 'walk@in.in', mobile: '9000000013', company: 'X' }, ADMIN);
check('desk walk-in: a held mobile hands back that person\'s pass instead of a second row', r.status === 409 && r.json?.id === 13 && !!r.json?.token && q("SELECT id FROM attendees WHERE email = 'walk@in.in'").length === 0, r.status + ' ' + r.text);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
