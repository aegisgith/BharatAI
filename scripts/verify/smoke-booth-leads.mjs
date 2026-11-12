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
db.run("INSERT INTO events (id, title, start_date, end_date) VALUES (2, 'Delhi', '2027-07-28', '2027-07-29')");
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

// ---- partners and sponsors in the app ----
r = await hit('GET', '/api/app-partners');
check('partners: nothing is shown until the organisers add someone', r.status === 200 && Array.isArray(r.json.partners) && r.json.partners.length === 0, r.text);
const JADE = { name: 'Jade Global', label: 'Panel Host Partner', logo: '/images/exhibitors/jade-global.webp', url: 'jadeglobal.com' };
r = await hit('PUT', '/api/mp/admin/partners', { partners: [JADE] });
check('partners: signed out cannot change the list', r.status === 403, r.status);
r = await hit('PUT', '/api/mp/admin/partners', { partners: [JADE] }, mpAs(1));
check('partners: an exhibitor cannot add itself', r.status === 403, r.status);
const badPartner = async (name, p, want) => { const x = await hit('PUT', '/api/mp/admin/partners', { partners: [p] }, admin); check('partners refused: ' + name, x.status === 400 && want.test(x.json?.error || ''), x.status + ' ' + x.text); };
await badPartner('no name', { ...JADE, name: ' ' }, /Row 1: please enter the name/);
await badPartner('a logo from another site', { ...JADE, logo: 'https://evil.example/x.png' }, /logo must be a picture on this site/);
await badPartner('a logo path that climbs out of /images', { ...JADE, logo: '/images/../api/x.png' }, /logo must be a picture on this site/);
await badPartner('a script link as the website', { ...JADE, url: 'javascript:alert(1)' }, /website must be a web address/);
r = await hit('GET', '/api/app-partners');
check('partners: no refusal saved anything', r.json.partners.length === 0, r.text);
r = await hit('PUT', '/api/mp/admin/partners', { partners: [JADE, { name: 'Dun & Bradstreet', label: 'Data Partner', logo: '', url: '' }] }, admin);
check('partners: admin saves the list, a plain domain becomes https, in the audit log', r.status === 200 && r.json.partners.length === 2 && r.json.partners[0].url === 'https://jadeglobal.com' && !!one("SELECT id FROM admin_audit WHERE action = 'marketplace.app-partners'"), r.text);
r = await hit('GET', '/api/app-partners');
check('partners: the app gets them in order, name, label and logo', r.json.partners.map(p => p.name).join('|') === 'Jade Global|Dun & Bradstreet' && r.json.partners[0].label === 'Panel Host Partner' && r.json.partners[0].logo === '/images/exhibitors/jade-global.webp' && r.json.partners[1].logo === '', r.text);
r = await hit('PUT', '/api/mp/admin/partners', { partners: [] }, admin);
check('partners: the list can be emptied again', r.status === 200 && (await hit('GET', '/api/app-partners')).json.partners.length === 0, r.text);

// ---- the Delhi edition, shown in the app and on the exhibitor dashboard ----
const DELHI_AUDIT = "SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'delhi_promo.open'";
r = await hit('GET', '/api/app-partners');
const dl0 = r.json.delhi;
check('delhi: shown to everyone until the organisers say otherwise, in the words of the Delhi page', !!dl0 && /Delhi 2027/.test(dl0.title) && /28.29 July 2027 at Bharat Mandapam, New Delhi/.test(dl0.text) && /Booths and partnerships are open now/.test(dl0.ex_text) && !!dl0.cta && !!dl0.ex_cta, r.text);
check('delhi: the links are the Delhi page and its booths, nothing else', dl0.url === '/delhi?from=app' && dl0.ex_url === '/delhi?from=exhibitor#booths', JSON.stringify(dl0));
check('delhi: it claims no government backing and gives no headcount', !/ministry|government|meity|\d,\d{3}/i.test(JSON.stringify(dl0)), JSON.stringify(dl0));
r = await hit('GET', '/api/mp/admin/delhi-promo');
check('delhi: signed out cannot read the settings', r.status === 403, r.status);
r = await hit('PUT', '/api/mp/admin/delhi-promo', { on: false });
check('delhi: signed out cannot switch it off', r.status === 403 && !!(await hit('GET', '/api/app-partners')).json.delhi, r.status);
r = await hit('PUT', '/api/mp/admin/delhi-promo', { on: false }, mpAs(1));
check('delhi: an exhibitor cannot switch it off', r.status === 403 && !!(await hit('GET', '/api/app-partners')).json.delhi, r.status);
r = await hit('PUT', '/api/mp/admin/delhi-promo', { on: false }, as(21));
check('delhi: an attendee cannot switch it off', r.status === 403 && !!(await hit('GET', '/api/app-partners')).json.delhi, r.status);
r = await hit('GET', '/api/mp/admin/delhi-promo', undefined, admin);
check('delhi: admin sees it on, nothing typed, our wording to fall back on, nobody counted', r.status === 200 && r.json.on === true && Object.values(r.json.typed).join('') === '' && r.json.defaults.title === dl0.title && r.json.opened.attendees === 0 && r.json.opened.exhibitors === 0, r.text);
r = await hit('PUT', '/api/mp/admin/delhi-promo', { on: true, title: 'x'.repeat(81) }, admin);
check('delhi: a heading that is too long is refused in words, and nothing is saved', r.status === 400 && /heading for attendees is too long/.test(r.json.error) && (await hit('GET', '/api/app-partners')).json.delhi.title === dl0.title, r.text);
r = await hit('PUT', '/api/mp/admin/delhi-promo', { on: true, title: '  Delhi   is next:  <b>29 July</b> ', ex_cta: 'Book a Delhi booth', url: 'https://evil.example/', ex_url: 'javascript:alert(1)' }, admin);
check('delhi: admin rewords it, spaces tidied, in the audit log', r.status === 200 && r.json.typed.title === 'Delhi is next: <b>29 July</b>' && !!one("SELECT id FROM admin_audit WHERE action = 'marketplace.delhi-promo'"), r.text);
r = await hit('GET', '/api/app-partners');
check('delhi: the new words are served, an empty box keeps our wording', r.json.delhi.title === 'Delhi is next: <b>29 July</b>' && r.json.delhi.text === dl0.text && r.json.delhi.ex_cta === 'Book a Delhi booth' && r.json.delhi.ex_title === dl0.ex_title, r.text);
check('delhi: a link sent with the words is ignored, the links stay ours', r.json.delhi.url === '/delhi?from=app' && r.json.delhi.ex_url === '/delhi?from=exhibitor#booths', JSON.stringify(r.json.delhi));
check('delhi: the partners list is still served beside it', Array.isArray(r.json.partners), r.text);
// who pressed it
r = await hit('POST', '/api/app-promo/delhi-open', { from: 'app' });
check('delhi press: signed out is answered and nothing is written', r.status === 200 && r.json.counted === false && one(DELHI_AUDIT).n === 0, r.text);
r = await hit('POST', '/api/app-promo/delhi-open', { from: 'exhibitor' }, as(21));
check('delhi press: an attendee cannot count as an exhibitor', r.json.counted === false && one(DELHI_AUDIT).n === 0, r.text);
r = await hit('POST', '/api/app-promo/delhi-open', { from: 'app' }, as(21));
await hit('POST', '/api/app-promo/delhi-open', { from: 'app' }, as(21));
check('delhi press: an attendee is counted once however often they press', r.json.counted === true && one(DELHI_AUDIT + " AND entity = 'attendee' AND entity_id = '21'").n === 1 && one(DELHI_AUDIT).n === 1, JSON.stringify(q("SELECT entity, entity_id FROM admin_audit WHERE action = 'delhi_promo.open'")));
await hit('POST', '/api/app-promo/delhi-open', { from: 'app' }, as(20));
r = await hit('POST', '/api/app-promo/delhi-open', { from: 'exhibitor' }, mpAs(1));
await hit('POST', '/api/app-promo/delhi-open', { from: 'exhibitor' }, mpAs(1));
check('delhi press: an exhibitor account is counted once', r.json.counted === true && one(DELHI_AUDIT + " AND entity = 'mp_company' AND entity_id = '1'").n === 1, r.text);
r = await hit('POST', '/api/app-promo/delhi-open', null, as(10));
check('delhi press: a press with nothing in it is still counted for the person signed in', r.status === 200 && r.json.counted === true, r.text);
r = await hit('GET', '/api/mp/admin/delhi-promo', undefined, admin);
check('delhi: admin sees how many opened it, people and exhibitor accounts apart', r.json.opened.attendees === 3 && r.json.opened.exhibitors === 1, JSON.stringify(r.json.opened));
// off
r = await hit('PUT', '/api/mp/admin/delhi-promo', { on: false, title: 'Delhi is next' }, admin);
check('delhi: admin switches it off', r.status === 200 && r.json.on === false && r.json.shown === null, r.text);
r = await hit('GET', '/api/app-partners');
check('delhi: switched off, nothing is served, and the partners still are', r.status === 200 && r.json.delhi === null && Array.isArray(r.json.partners), r.text);
r = await hit('GET', '/api/mp/admin/delhi-promo', undefined, admin);
check('delhi: the words typed are kept while it is off', r.json.on === false && r.json.typed.title === 'Delhi is next', r.text);
r = await hit('PUT', '/api/mp/admin/delhi-promo', { on: true }, admin);
check('delhi: switched on again with every box empty, it is our wording again', r.status === 200 && (await hit('GET', '/api/app-partners')).json.delhi.title === dl0.title, r.text);
db.run("UPDATE app_settings SET value = 'not json {' WHERE key = 'app_delhi_promo'");
r = await hit('GET', '/api/app-partners');
check('delhi: a damaged setting falls back to our wording, it does not break the app', r.status === 200 && r.json.delhi.title === dl0.title, r.text);
db.run("DELETE FROM app_settings WHERE key = 'app_delhi_promo'");

r = await hit('GET', '/app');
check('delhi: the app has the card on Home, for signed-in people, hidden until filled', /<div class="hidden signed-in-only">\s*<div class="[^"]*hidden" id="app-delhi">/.test(r.text) && /id="app-delhi-link" href="\/delhi\?from=app" target="_blank" rel="noopener"/.test(r.text), '');
check('the app has the Our partners strip on Home, hidden until filled', /id="app-partners"/.test(r.text) && /Our partners/.test(r.text), '');
r = await hit('GET', '/app.js');
check('delhi: the app fills the card from the partners answer and counts a press', /showDelhiPromo\(d && d\.delhi\)/.test(r.text) && /function delhiPromoOpened\(\)/.test(r.text) && /\/api\/app-promo\/delhi-open/.test(r.text), '');
check('the app has the workshop certificate button and loads the partners', /loadAppPartners\(\)/.test(r.text) && /id="ws-cert-btn"/.test(r.text) && /BHAI-WS-/.test(r.text), '');

// ---- the pages ----
r = await hit('GET', '/marketplace/dashboard');
check('the dashboard has the Leads screen', ['data-section="leads"', 'id="leads-list"', 'id="leads-csv"', 'href="/exhibitor/scan"', 'marketplace-dashboard.js?v=10', 'id="dash-delhi"'].every(m => r.text.includes(m)), '');
r = await hit('GET', '/marketplace/admin');
check('the admin page has the exhibitor-list switch', ['id="directory-card"', 'marketplace-admin.js?v=14', 'data-section="partners"', 'id="partners-rows"', 'id="delhi-on"', 'id="delhi-ex-cta"', 'id="delhi-save"', 'Shown in the app'].every(m => r.text.includes(m)), '');
r = await hit('GET', '/app.js');
check('the app: Scan a badge in the Lead Console, 8-minute talks, no dead floor-plan button', /action === 'leads'|act === 'leads'/.test(r.text) && /8-minute presentations/.test(r.text) && !/10-minute presentations/.test(r.text) && !/showBoothPackages/.test(r.text), '');
r = await hit('GET', '/app');
check('the Lead Console has the scan button', /href="\/exhibitor\/scan"/.test(r.text), '');

console.log(fails ? `\n${fails} FAILED` : '\nAll booth lead checks passed');
process.exit(fails ? 1 : 0);
