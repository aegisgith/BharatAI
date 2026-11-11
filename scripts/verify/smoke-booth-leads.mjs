// Built-worker checks of booth leads by badge scan (migration 0051, 11 Nov 2026) and of
// the exhibitor list in the app, on real SQLite (sql.js) with the production schema.
//  - a lead is a visitor's pass QR scanned by someone on the exhibitor's team (0050) or
//    by its booth contact in the dashboard; it carries their rating and note;
//  - everyone on the team sees the leads, not only the one linked booth contact;
//  - a stranger, a plain attendee and another exhibitor see and change nothing;
//  - the list in the app shows real exhibitors only and never an internal booking note.
// Run after `npm run build`:  node scripts/verify/smoke-booth-leads.mjs
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
db.exec(readFileSync(new URL('../../migrations/0050_exhibitor_team.sql', import.meta.url), 'utf8'));
const MIGRATION = readFileSync(new URL('../../migrations/0051_leads_and_daily_checkins.sql', import.meta.url), 'utf8');
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
globalThis.fetch = async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
const SESSION = 'smoke-session', ADMIN = 'smoke-admin', MP = 'smoke-mp';
const env = new Proxy({ ADMIN_SECRET: ADMIN, SESSION_SECRET: SESSION, MP_SESSION_SECRET: MP, DB: D1 }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };
const hit = async (method, path, body, headers = {}) => {
  const req = new Request('https://bharataiinnovation.com' + path, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await worker.fetch(req, env, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json, h: Object.fromEntries(res.headers) };
};
const as = (id) => ({ Cookie: sessionCookie(SESSION, id) });
const mpAs = (companyId) => ({ Cookie: 'mp_session=' + companyId + '.' + crypto.createHmac('sha256', MP).update(String(companyId)).digest('hex') });
const admin = { Authorization: 'Bearer ' + ADMIN };
// A pass QR's token, made the way the server makes it (signPassToken).
const pass = (id) => id + '.' + crypto.createHmac('sha256', SESSION).update('pass:' + id).digest('hex').slice(0, 24);
const q = (sql, ...a) => rows(sql, clean(a));
const one = (sql, ...a) => q(sql, ...a)[0] || null;
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 300))); if (!ok) fails++; };

// ---- seed ----
db.run("INSERT INTO events (id, title, start_date, end_date) VALUES (1, 'Bharat AI', '2026-11-20', '2026-11-21')");
db.run("INSERT INTO events (id, title, start_date, end_date) VALUES (2, 'Delhi', '2027-07-29', '2027-07-30')");
const person = (id, name, extra = {}) => {
  const row = { id, event_id: 1, name, email: 'p' + id + '@example.test', mobile: '', company: 'Co ' + id, job_title: 'Director', badge_type: 'Visitor Pass', payment_status: '', main_event: 1, ...extra };
  const cols = Object.keys(row);
  db.run(`INSERT INTO attendees (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, clean(cols.map(k => row[k])));
};
// Exhibitor 1: a confirmed stand, a team member (10), the linked booth contact (11), a dashboard login.
db.run("INSERT INTO exhibitors (id, event_id, company_name, contact_email, booth_number, description, attendee_id) VALUES (1, 1, 'Alpha AI', 'spoc@alpha.test', '21', 'Imported from the Confirmed Booth sheet. Owner: Tushar', 11)");
db.run("INSERT INTO booths (id, event_id, code, type_key, name, dim) VALUES (1, 1, '21', 'explorer', 'Explorer Booth', '2m x 2m')");
db.run("INSERT INTO booth_allocations (event_id, booth_id, exhibitor_id, company_name, status) VALUES (1, 1, 1, 'Alpha AI', 'confirmed')");
db.run("INSERT INTO mp_companies (id, company_name, email, password_hash, exhibitor_id) VALUES (1, 'Alpha AI', 'spoc@alpha.test', '', 1)");
// Exhibitor 2: known from the sheet only, with a real description.
db.run("INSERT INTO exhibitors (id, event_id, company_name, contact_email, booth_number, description) VALUES (2, 1, 'Beta Robotics', 'spoc@beta.test', '40', 'Robots for warehouses.')");
db.run("INSERT INTO exhibitor_team_settings (exhibitor_id, booth_type, booth_name) VALUES (2, 'pod', 'Startup Pod')");
db.run("INSERT INTO mp_companies (id, company_name, email, password_hash, exhibitor_id) VALUES (2, 'Beta Robotics', 'spoc@beta.test', '', 2)");
// Exhibitor 3: a leftover second row (no stand, not on the sheet), linked to attendee 10.
db.run("INSERT INTO exhibitors (id, event_id, company_name, contact_email, description, attendee_id) VALUES (3, 1, 'ALPHA', '', '', 10)");
person(10, 'Tara Team', { badge_type: 'Exhibitor', payment_status: 'waived' });
person(11, 'Booth Contact', { badge_type: 'Exhibitor', payment_status: 'waived' });
person(12, 'Beta Staff', { badge_type: 'Exhibitor', payment_status: 'waived' });
person(20, 'Vik Visitor', { company: 'Buyer Bank', job_title: 'CTO', mobile: '9820011111' });
person(21, 'Dee Delegate', { badge_type: 'Delegate Pass', payment_status: 'paid' });
person(22, 'Una Unpaid', { badge_type: 'VIP Pass', payment_status: 'pending' });
person(23, 'Plain Attendee');
person(30, 'Delhi Person', { event_id: 2 });
db.run("INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, email, attendee_id, pass, pass_given) VALUES (1, 1, 'Tara', 'Team', 'p10@example.test', 10, 'Exhibitor', 'Exhibitor')");
db.run("INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, email, attendee_id, pass, pass_given) VALUES (1, 2, 'Beta', 'Staff', 'p12@example.test', 12, 'Exhibitor', 'Exhibitor')");
// A visitor who tapped Visit Booth in the app, with their own note.
db.run("INSERT INTO booth_visits (exhibitor_id, attendee_id, event_id, interested, notes) VALUES (1, 21, 1, 1, 'Please send pricing')");
db.run('UPDATE exhibitors SET visitor_count = 1 WHERE id = 1');

// ---- before 0051 ----
let r = await hit('GET', '/api/exhibitor/leads', undefined, as(10));
check('before 0051: the team sees the app visits, and scanning is not offered', r.status === 200 && r.json.leads.length === 1 && r.json.leads[0].source === 'visit' && r.json.can_scan === false, r.text);
r = await hit('POST', '/api/exhibitor/leads/scan', { token: pass(20) }, as(10));
check('before 0051: a scan is refused, in words', r.status === 503 && /switched on/.test(r.json.error), r.text);
r = await hit('GET', '/verify/' + pass(20), undefined, as(10));
check('before 0051: the pass QR still opens the desk page for everyone', /Badge desk staff only/.test(r.text) && !/Booth lead/.test(r.text), r.text.slice(0, 200));
db.exec(MIGRATION); db.exec(MIGRATION);
check('0051 runs twice without error', q("SELECT name FROM sqlite_master WHERE name IN ('exhibitor_leads', 'checkins')").length === 2, '');

// ---- who may scan ----
r = await hit('POST', '/api/exhibitor/leads/scan', { token: pass(20) });
check('signed out: no scan', r.status === 401 && q('SELECT id FROM exhibitor_leads').length === 0, r.status);
r = await hit('POST', '/api/exhibitor/leads/scan', { token: pass(20) }, as(23));
check('an ordinary attendee cannot scan anyone', r.status === 401 && q('SELECT id FROM exhibitor_leads').length === 0, r.status);
r = await hit('GET', '/api/exhibitor/leads', undefined, as(23));
check('nor read any leads', r.status === 401, r.status);
r = await hit('POST', '/api/exhibitor/leads/scan', { token: '20.' + 'a'.repeat(24) }, as(10));
check('a forged pass is refused', r.status === 400 && /not a Bharat AI Innovation pass/.test(r.json.error), r.text);
r = await hit('POST', '/api/exhibitor/leads/scan', { token: pass(10) }, as(10));
check('their own pass is refused', r.status === 400 && /your own pass/.test(r.json.error), r.text);
r = await hit('POST', '/api/exhibitor/leads/scan', { token: pass(30) }, as(10));
check('a pass for another event is refused', r.status === 400, r.text);
r = await hit('POST', '/api/exhibitor/leads/scan', { token: pass(20), rating: 'boiling' }, as(10));
check('an unknown rating is refused, nothing saved', r.status === 400 && q('SELECT id FROM exhibitor_leads').length === 0, r.text);

// ---- a team member scans ----
r = await hit('POST', '/api/exhibitor/leads/scan', { token: pass(20) }, as(10));
check('a team member scans a visitor: saved for the company on the team list, not the leftover row', r.status === 200 && r.json.again === false && r.json.visitor.name === 'Vik Visitor' && one('SELECT exhibitor_id, scanned_by, rating FROM exhibitor_leads WHERE attendee_id = 20')?.exhibitor_id === 1, r.text);
check('the lead records who scanned', one('SELECT scanned_by FROM exhibitor_leads WHERE attendee_id = 20').scanned_by === 'Tara Team', '');
check('the reply carries no email or mobile', !/example\.test|9820011111/.test(r.text), r.text);
check('the booth visitor count moves by one', one('SELECT visitor_count FROM exhibitors WHERE id = 1').visitor_count === 2, '');
r = await hit('POST', '/api/exhibitor/leads/scan', { token: pass(20), rating: 'hot' }, as(10));
check('scanned again with a rating: the same lead, rated', r.status === 200 && r.json.again === true && r.json.lead.rating === 'hot' && q('SELECT id FROM exhibitor_leads').length === 1 && one('SELECT visitor_count FROM exhibitors WHERE id = 1').visitor_count === 2, r.text);
r = await hit('POST', '/api/exhibitor/leads/scan', { token: pass(20), note: 'Wants a demo on Monday <b>x</b>' }, as(10));
check('a note added later keeps the rating', r.json.lead.rating === 'hot' && r.json.lead.note === 'Wants a demo on Monday <b>x</b>', r.text);
r = await hit('POST', '/api/exhibitor/leads/scan', { token: pass(20) }, as(10));
check('a plain re-scan changes nothing', r.json.lead.rating === 'hot' && /Monday/.test(r.json.lead.note), r.text);
r = await hit('POST', '/api/exhibitor/leads/scan', { token: pass(21), rating: 'warm' }, as(11));
check('the linked booth contact scans too; someone who also visited in the app is not counted twice', r.status === 200 && one('SELECT visitor_count FROM exhibitors WHERE id = 1').visitor_count === 2, r.text);
r = await hit('POST', '/api/exhibitor/leads/scan', { token: pass(22), rating: 'cold' }, mpAs(1));
check('the booth contact in the dashboard scans, recorded under their email', r.status === 200 && one('SELECT scanned_by FROM exhibitor_leads WHERE attendee_id = 22').scanned_by === 'spoc@alpha.test', r.text);
check('an unpaid VIP reads as a Visitor Pass to the exhibitor', r.json.visitor.badge_type === 'Visitor Pass', r.json.visitor);

// ---- the list ----
r = await hit('GET', '/api/exhibitor/leads', undefined, as(10));
const L = r.json.leads, dee = L.find(l => l.name === 'Dee Delegate'), vik = L.find(l => l.name === 'Vik Visitor');
check('everyone on the team sees every lead, one row per person', r.status === 200 && L.length === 3 && r.json.exhibitor.company_name === 'Alpha AI' && r.json.can_scan === true, r.text.slice(0, 300));
check('a scanned visitor who also tapped Visit Booth is one lead with both notes', dee.source === 'scan' && dee.rating === 'warm' && dee.notes === 'Please send pricing' && dee.interested === 1, dee);
check('the summary counts scans and ratings, by day', r.json.summary.total === 3 && r.json.summary.scanned === 3 && r.json.summary.hot === 1 && r.json.summary.warm === 1 && r.json.summary.cold === 1 && r.json.summary.by_day.length === 1 && r.json.summary.by_day[0].n === 3, r.json.summary);
check('leads carry email and LinkedIn, never a mobile', vik.email === 'p20@example.test' && !('mobile' in vik) && !/9820011111/.test(r.text), vik);
r = await hit('GET', '/api/attendees/10/exhibitor/leads', undefined, as(10));
check("the app's own leads route gives a team member the same list", r.status === 200 && r.json.leads.length === 3 && r.json.summary.scanned === 3, r.text.slice(0, 200));
r = await hit('GET', '/api/attendees/10/exhibitor', undefined, as(10));
check("the app shows a team member the company's booth, without the contact email or the internal note", r.json?.company_name === 'Alpha AI' && r.json.team_member === true && !('contact_email' in r.json) && r.json.description === '', r.text);
r = await hit('GET', '/api/exhibitor/leads', undefined, mpAs(1));
check('the dashboard sees the same leads', r.status === 200 && r.json.leads.length === 3, r.status);
r = await hit('GET', '/api/exhibitor/leads', undefined, mpAs(2));
check('another exhibitor sees none of them', r.status === 200 && r.json.leads.length === 0 && r.json.exhibitor.company_name === 'Beta Robotics', r.text);

// ---- editing ----
const vikLead = one('SELECT id FROM exhibitor_leads WHERE attendee_id = 20').id;
r = await hit('PATCH', '/api/exhibitor/leads/' + vikLead, { rating: 'cold' }, as(12));
check("another exhibitor's team cannot change a lead", r.status === 404 && one('SELECT rating FROM exhibitor_leads WHERE id = ?', vikLead).rating === 'hot', r.status);
r = await hit('PATCH', '/api/exhibitor/leads/' + vikLead, { rating: '', note: '' }, mpAs(1));
check('the rating and the note can be cleared', r.status === 200 && one('SELECT rating, note FROM exhibitor_leads WHERE id = ?', vikLead).rating === '' && one('SELECT note FROM exhibitor_leads WHERE id = ?', vikLead).note === '', r.text);
r = await hit('PATCH', '/api/exhibitor/leads/' + vikLead, { rating: 'x' }, mpAs(1));
check('a bad rating is refused there too', r.status === 400, r.status);

// ---- the pass QR, by who opens it ----
r = await hit('GET', '/verify/' + pass(20), undefined, as(10));
check('a team member opening a pass QR gets the lead screen for their company', r.status === 200 && /Booth lead/.test(r.text) && /Alpha AI/.test(r.text) && /Vik Visitor/.test(r.text) && /Buyer Bank/.test(r.text) && /Scan next badge/.test(r.text), r.text.slice(0, 300));
check('the lead screen shows no email or mobile, and no check-in button', !/p20@example\.test|9820011111/.test(r.text) && !/Check in/.test(r.text), '');
r = await hit('GET', '/verify/' + pass(22), undefined, mpAs(1));
check('the booth contact in the dashboard gets it too; an unpaid tier shows as a Visitor Pass', /Booth lead/.test(r.text) && /Visitor Pass/.test(r.text) && !/VIP Pass/.test(r.text) && /marketplace\/dashboard#leads/.test(r.text), r.text.slice(0, 200));
r = await hit('GET', '/verify/' + pass(10), undefined, as(10));
check('their own pass says so', /your own pass/.test(r.text), r.text.slice(0, 200));
r = await hit('GET', '/verify/' + pass(20));
check('a stranger still sees nothing personal', /Badge desk staff only/.test(r.text) && !/Vik Visitor/.test(r.text), r.text.slice(0, 200));
r = await hit('GET', '/verify/' + pass(20), undefined, as(23));
check('an ordinary attendee still sees nothing personal', /Badge desk staff only/.test(r.text) && !/Vik Visitor/.test(r.text), '');
r = await hit('GET', '/verify/' + pass(20), undefined, admin);
check('the desk still gets the desk screen', /Vik Visitor/.test(r.text) && !/Booth lead/.test(r.text), r.text.slice(0, 200));
r = await hit('GET', '/verify/' + pass(20), undefined, as(10));
const script = (r.text.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';
let parses = true; try { new Function(script); } catch (e) { parses = String(e); }
check("the lead screen's script parses", parses === true && script.length > 200, parses);
db.run("UPDATE attendees SET name = 'Evil </script><img src=x onerror=1>' WHERE id = 23");
r = await hit('GET', '/verify/' + pass(23), undefined, as(10));
check('a hostile name cannot break out of the lead screen', !/<img src=x/.test(r.text) && /&lt;\/script&gt;/.test(r.text), r.text.slice(0, 400));

// ---- the scanner page ----
r = await hit('GET', '/exhibitor/scan');
check('the scanner page, signed out: how to sign in, no camera', r.status === 200 && /Open the event app/.test(r.text) && /exhibitor dashboard/.test(r.text) && !/getUserMedia/.test(r.text), r.text.slice(0, 200));
r = await hit('GET', '/exhibitor/scan', undefined, as(23));
check('an ordinary attendee gets the same', !/getUserMedia/.test(r.text), '');
r = await hit('GET', '/exhibitor/scan', undefined, as(10));
const scanScript = [...r.text.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
let scanParses = true; try { new Function(scanScript); } catch (e) { scanParses = String(e); }
check('a team member gets the scanner, both readers, for their company', /Alpha AI/.test(r.text) && /getUserMedia/.test(r.text) && /BarcodeDetector/.test(r.text) && /jsQR\.js/.test(r.text) && scanParses === true, scanParses);
check('a scanned code can only go to /verify/ on this site', /location\.href='\/verify\/'\+m\[1\]/.test(r.text), '');

// ---- the exhibitor list in the app ----
r = await hit('GET', '/api/events/1/exhibitors');
check('off: attendees get an empty list, and the reason in a header', r.status === 200 && Array.isArray(r.json) && r.json.length === 0 && r.h['x-directory-hidden'] === '1', r.text);
r = await hit('GET', '/api/mp/admin/directory');
check('the switch is for admins', r.status === 403, r.status);
r = await hit('PUT', '/api/mp/admin/directory', { on: true }, mpAs(1));
check('an exhibitor cannot flip it', r.status === 403, r.status);
r = await hit('GET', '/api/mp/admin/directory', undefined, admin);
check('admin sees what turning it on would show, and what never shows', r.status === 200 && r.json.on === false && r.json.showing === 2 && r.json.not_shown.join() === 'ALPHA', r.text);
r = await hit('PUT', '/api/mp/admin/directory', { on: true }, admin);
check('admin turns it on, in the audit log', r.status === 200 && r.json.on === true && !!one("SELECT id FROM admin_audit WHERE action = 'marketplace.directory-on'"), r.text);
r = await hit('GET', '/api/events/1/exhibitors');
check('on: real exhibitors only (a confirmed stand, or on the sheet)', r.json.length === 2 && r.json.map(e => e.company_name).sort().join() === 'Alpha AI,Beta Robotics', r.json.map(e => e.company_name));
check('an internal booking note is never shown; a real description is', r.json.find(e => e.id === 1).description === '' && r.json.find(e => e.id === 2).description === 'Robots for warehouses.' && !/Tushar|Imported from/.test(r.text), r.text);
check('no contact email reaches an attendee', !/spoc@/.test(r.text) && !('contact_email' in r.json[0]), '');
r = await hit('GET', '/api/events/1/exhibitors?search=Tushar');
check('searching a staff name finds nothing', r.json.length === 0, r.text);
r = await hit('GET', '/api/exhibitors/1');
check('one exhibitor: the note is blank there too', r.json.description === '' && !/Tushar/.test(r.text), r.text);
r = await hit('GET', '/api/events/1/exhibitors', undefined, admin);
check('admin still sees every row and the notes', r.json.length === 3 && /Tushar/.test(r.text), r.json.length);
r = await hit('PUT', '/api/mp/admin/directory', { on: false }, admin);
r = await hit('GET', '/api/events/1/exhibitors');
check('off again: empty again', r.json.length === 0, r.text);

// ---- the pages ----
r = await hit('GET', '/marketplace/dashboard');
check('the dashboard has the Leads screen', ['data-section="leads"', 'id="leads-list"', 'id="leads-csv"', 'href="/exhibitor/scan"', 'marketplace-dashboard.js?v=9'].every(m => r.text.includes(m)), '');
r = await hit('GET', '/marketplace/admin');
check('the admin page has the exhibitor-list switch', ['id="directory-card"', 'marketplace-admin.js?v=12'].every(m => r.text.includes(m)), '');
r = await hit('GET', '/app.js');
check('the app: Scan a badge in the Lead Console, 8-minute talks, no dead floor-plan button', /action === 'leads'|act === 'leads'/.test(r.text) && /8-minute presentations/.test(r.text) && !/10-minute presentations/.test(r.text) && !/showBoothPackages/.test(r.text), '');
r = await hit('GET', '/app');
check('the Lead Console has the scan button', /href="\/exhibitor\/scan"/.test(r.text), '');

console.log(fails ? `\n${fails} FAILED` : '\nAll booth lead checks passed');
process.exit(fails ? 1 : 0);
