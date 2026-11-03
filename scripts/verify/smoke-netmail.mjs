// Built-worker checks for the networking app email (3 Nov 2026), on real SQLite
// (sql.js) loaded with the production schema: one subject for every pass, the body
// by the pass held, the phone of real people (only those /networking may name,
// never the reader), the preview that sends and marks nothing, the campaign's
// audience and order, the pump, the skips, the open and click marks, the counts,
// the send by itself 10 minutes after registering (or paying), and the app's
// ?action=network. Elastic Email is stubbed; nothing is sent.
// Run after `npm run build`:  node scripts/verify/smoke-netmail.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');

// Inside the 9am-9pm IST window, before the 5 Nov price deadline: 4 Nov, 10:30 IST.
const RealDate = Date;
const FAKE_NOW = RealDate.parse('2026-11-04T05:00:00Z');
globalThis.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [FAKE_NOW])); }
  static now() { return FAKE_NOW; }
};

const worker = (await import(new URL('../../dist/_worker.js?' + RealDate.now(), import.meta.url).href)).default;
const SQL = await initSqlJs();
const db = new SQL.Database();
db.exec(readFileSync(new URL('./prod-schema.sql', import.meta.url), 'utf8'));

const clean = (a) => a.map(v => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
const D1 = {
  prepare(sql) {
    let args = [];
    const s = {
      bind(...a) { args = clean(a); return s; },
      async first() { const st = db.prepare(sql); st.bind(args); const r = st.step() ? st.getAsObject() : null; st.free(); return r; },
      async all() { const st = db.prepare(sql); st.bind(args); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return { results: out }; },
      async run() { db.run(sql, args); return { meta: { last_row_id: db.exec('SELECT last_insert_rowid()')[0].values[0][0], changes: db.getRowsModified() } }; },
    };
    return s;
  },
  async batch(list) { for (const s of list) await s.run(); return list.map(() => ({ results: [], meta: {} })); },
  async exec(sql) { db.exec(sql); return { count: 1 }; },
};
const SESSION = 'smoke-session';
const env = new Proxy({ ADMIN_SECRET: 'smoke-admin', SESSION_SECRET: SESSION, ELASTIC_EMAIL_API_KEY: 'smoke-key', DB: D1 }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };
const hit = async (method, path, body, headers = {}) => {
  const res = await worker.fetch(new Request('https://bharataiinnovation.com' + path, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
  const type = res.headers.get('Content-Type') || '';
  const text = type.startsWith('image/') ? '' : await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, type, text, json };
};
const ADMIN = { Authorization: 'Bearer smoke-admin' };
const q = (sql, ...a) => { const st = db.prepare(sql); st.bind(clean(a)); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; };
const marks = (action) => q("SELECT entity_id FROM admin_audit WHERE entity = 'attendee' AND action = ? ORDER BY entity_id", action).map(r => r.entity_id).join(',');
const count = (table) => q(`SELECT COUNT(*) AS n FROM ${table}`)[0].n;
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };

const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('elasticemail.com')) { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ MessageID: 'm' + sent.length }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
  return realFetch(url, init);
};
const subj = (i) => sent[i]?.Content?.Subject || '';
const body = (i) => sent[i]?.Content?.Body?.[0]?.Content || '';

// ---- seed ----
db.run("INSERT INTO events (id, title, start_date, end_date) VALUES (1, 'Bharat AI', '2026-11-20', '2026-11-21')");
db.run("INSERT INTO app_settings (key, value) VALUES ('app_url', 'https://bharataiinnovation.com/app')");
const OLD = "datetime('now', '-10 days')";
const person = (id, name, extra = {}, notified = OLD) => {
  const row = { id, event_id: 1, name, email: name.toLowerCase().replace(/[^a-z]+/g, '.') + '@example.com', mobile: '98200' + String(id).padStart(5, '0'),
    badge_type: 'Visitor Pass', payment_status: 'paid', company: '', job_title: '', main_event: 1, role: 'attendee', ...extra };
  const cols = Object.keys(row);
  db.run(`INSERT INTO attendees (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, clean(cols.map(k => row[k])));
  if (notified) db.run(`UPDATE attendees SET notified_at = ${notified} WHERE id = ?`, [id]);
};
const SHARED = { social_card_downloaded_at: '2026-10-30 10:00:00' };
const photo = (id) => ({ avatar_url: '/api/uploads/avatars/' + id + '-1.jpg' });
person(1, 'Ratan Kesh', { ...SHARED, ...photo(1), badge_type: 'Delegate Pass', job_title: 'Executive Director & COO at Bandhan Bank', company: 'Bandhan Bank', industry: 'Banking & Financial Services', city: 'Kolkata' });
person(2, 'Meera Iyer', { ...SHARED, ...photo(2), job_title: 'Head of AI', company: 'Bosch India' });
person(3, 'Asked Off', { ...SHARED, ...photo(3), job_title: 'Chief Executive Officer', company: 'Hiddenco' });
person(4, 'Neha Quiet', { ...photo(4), job_title: 'Director', company: 'Quietco' });
person(5, 'Asha Rao', { job_title: 'Product Manager', company: 'Smallco' });
person(6, 'Kiran Pai', { badge_type: 'Delegate Pass', payment_status: 'pending', job_title: 'Analyst' });
person(7, 'Recent Person', { job_title: 'Director' }, "datetime('now', '-1 hours')");
person(8, 'Not Yet', { job_title: 'CEO' }, null);
person(9, 'Panel Only', { job_title: 'Director', main_event: 0 });
person(10, 'Unsub Person', { job_title: 'Director', unsubscribed_at: '2026-10-01 10:00:00' });
person(11, 'Third Sharer', { ...SHARED, ...photo(11), job_title: 'Founder', company: 'Startco' });
db.run("INSERT INTO app_settings (key, value) VALUES ('glimpse_hide', '3')");

// ---- the preview ----
const before = { sent: sent.length, audit: count('admin_audit'), tokens: count('login_tokens'), camps: count('campaigns') };
let p = await hit('GET', '/api/admin/netmail-preview', undefined, ADMIN);
check('the preview counts conference registrants by pass (not panel-only, not unsubscribed)', p.status === 200 && JSON.stringify(p.json?.counts) === JSON.stringify({ free: 7, paid: 1, unpaid: 1, total: 9 }), p.status + ' ' + p.text.slice(0, 200));
check('unasked, it shows the first Free Visitor Pass in the queue', p.json?.kind === 'free' && p.json.sample?.id === 2, JSON.stringify(p.json?.sample));
check('an even registration number gets the organiser\'s first subject', p.json?.subject === 'Meera, book meetings before you arrive with Bharat AI Connect', p.json?.subject);
check('the preview names both subjects, in the reader\'s name', p.json?.subjects?.A === 'Meera, book meetings before you arrive with Bharat AI Connect' &&
  p.json.subjects.B === 'Meera, find out who you would like to meet at Bharat AI Innovation', JSON.stringify(p.json?.subjects));
const free = p.json?.html || '';
check('the phone shows what people who shared their card do: title, then sector and city', free.includes('Networking Hub') &&
  free.includes('>Executive Director &amp; COO</p>') && free.includes('>Founder</p>') && free.includes('Banking &amp; Financial Services &middot; Kolkata'), '');
check('and never who they are: a stand-in picture and a grey bar, no name, no company, no photo of theirs',
  free.includes('/images/email/person-hidden-1.png') && free.includes('/images/email/person-hidden-2.png') &&
  !/Ratan|Kesh|Third Sharer|Bandhan|Startco|\/api\/uploads\//.test(free), '');
check('never the reader, nobody in glimpse_hide, nobody who did not share their card', !/Head of AI|Chief Executive Officer|Hiddenco|Quietco/.test(free), '');
check('the five steps, as on /networking', ['Find the right people', 'Connect in one tap', 'Book a meeting', 'Message before you arrive', 'Share your card on LinkedIn'].every(t => free.includes(t)), '');
check('free: what it cannot start is marked Delegate Pass, and nothing is offered for sale (they find it in the app)',
  (free.match(/>Delegate Pass<\/span>/g) || []).length === 3 && !free.includes('Want to be the one who asks') && !free.includes('Get a Delegate Pass') &&
  !free.includes('action=pay') && !free.includes('5 Nov 2026') && !free.includes('download-pass'), '');
check('the main button opens the Network tab; the card and goals links are there', free.includes('action=network') && free.includes('action=social-card') && free.includes('action=goals'), '');
check('the preview has no open picture, no nw= tag and no sign-in token', free.includes('</html>') && !free.includes('netmail-open') && !/[?&]nw=/.test(free) && !/[?&]token=/.test(free), '');
check('and carries the unsubscribe footer the email will', /unsubscribe/i.test(free), '');
p = await hit('GET', '/api/admin/netmail-preview?kind=paid', undefined, ADMIN);
const paid = p.json?.html || '';
check('paid, an odd number: the second subject, "includes all of it", nothing to buy, no step marked', p.json?.sample?.id === 1 && p.json.subject === 'Ratan, find out who you would like to meet at Bharat AI Innovation'
  && paid.includes('Your <strong>Delegate Pass</strong> includes all of it') && !paid.includes('Want to be the one who asks') && !/>(Delegate Pass|Once paid)<\/span>/.test(paid), p.json?.subject);
check('a paid reader is not on their own phone, the others are', !paid.includes('Executive Director &amp; COO') && paid.includes('>Head of AI</p>') && paid.includes('>Founder</p>') && !paid.includes('Meera Iyer'), '');
check('a paid pass not downloaded yet is given the way to it', paid.includes('Your pass is not downloaded yet') && paid.includes('action=download-pass'), '');
p = await hit('GET', '/api/admin/netmail-preview?kind=unpaid', undefined, ADMIN);
const unpaid = p.json?.html || '';
check('unpaid: steps marked "Once paid" and a Finish paying button on its pass', p.json?.sample?.id === 6 && (unpaid.match(/>Once paid<\/span>/g) || []).length === 3 && unpaid.includes('Finish paying') && unpaid.includes('action=pay&pass=delegate') && !unpaid.includes('Get a Delegate Pass to meet them'), '');
check('previewing sent nothing, marked nothing, minted no token and started no run',
  sent.length === before.sent && count('admin_audit') === before.audit && count('login_tokens') === before.tokens && count('campaigns') === before.camps, '');
let r = await hit('GET', '/api/admin/netmail-preview');
check('the preview is for admins only', r.status === 401 || r.status === 403, String(r.status));
r = await hit('GET', '/api/admin/netmail-status', undefined, ADMIN);
check('status before any run: nine still to get it, nothing sent', r.status === 200 && r.json?.left === 9 && r.json.open_run === null && r.json.stats?.sent === 0, r.text.slice(0, 200));

// ---- the run ----
r = await hit('POST', '/api/admin/campaigns', { kind: 'networking', audience: 'all', title: 'Networking app email' }, ADMIN);
const runId = r.json?.id;
check('a networking run is made of the nine', r.status === 201 && r.json.total === 9 && r.json.kind === 'networking', r.status + ' ' + r.text.slice(0, 200));
const order = q('SELECT attendee_id FROM campaign_recipients WHERE campaign_id = ? ORDER BY id', runId).map(x => x.attendee_id).join(',');
check('paid passes first, then senior titles, and anyone whose account-ready email is recent or still to go, last', order === '1,6,2,3,4,11,5,7,8', order);
r = await hit('POST', '/api/admin/campaigns', { kind: 'networking', audience: 'all' }, ADMIN);
check('a second run finds nobody: no one is sent it twice', r.status === 400, r.status + ' ' + r.text.slice(0, 120));
p = await hit('GET', '/api/admin/netmail-preview', undefined, ADMIN);
check('the preview names the open run', p.json?.open_run?.id === runId && p.json.open_run.status === 'running', JSON.stringify(p.json?.open_run));
const resetSlot = () => db.run("UPDATE app_settings SET value = '1970-01-01T00:00:00.000Z' WHERE key = 'profile_reminder_last_sent_at'");
const pump = async () => { resetSlot(); return hit('POST', `/api/admin/campaigns/${runId}/pump`, { batch: 1 }, ADMIN); };

r = await pump();
check('the pump sends the first one through send-networking', r.status === 200 && sent.length === 1 && subj(0) === 'Ratan, find out who you would like to meet at Bharat AI Innovation', r.status + ' ' + r.text.slice(0, 200) + ' ' + subj(0));
const html = body(0);
const sig = crypto.createHmac('sha256', SESSION).update('networking-mail:1').digest('hex').slice(0, 20);
check('it carries the open picture on the site root', html.includes(`src="https://bharataiinnovation.com/api/netmail-open?a=1&amp;s=${sig}"`), html.slice(-500));
const appLinks = html.match(/href="https:\/\/bharataiinnovation\.com\/app\?[^"]*"/g) || [];
check('every app button carries nw=<id>.<sig> and a sign-in token', appLinks.length >= 4 && appLinks.every(h => h.includes(`nw=1.${sig}`) && /[?&]token=[0-9a-f]+/.test(h)), appLinks.length + ' ' + (appLinks[0] || ''));
check('the sent email has the unsubscribe footer and header', /unsubscribe/i.test(html) && !!sent[0]?.Content?.Headers?.['List-Unsubscribe'], '');
check('the first send stamps networking_marks_from', q("SELECT value FROM app_settings WHERE key = 'networking_marks_from'").length === 1, '');
r = await pump();
check('the second goes to the unpaid Delegate, with Finish paying', sent.length === 2 && body(1).includes('Finish paying') && subj(1).startsWith('Kiran, book meetings'), subj(1));
db.run("UPDATE attendees SET unsubscribed_at = '2026-11-04 10:00:00' WHERE id = 2");
r = await pump();
check('someone who unsubscribed after the run was made is skipped, not sent', sent.length === 2 && q('SELECT status FROM campaign_recipients WHERE campaign_id = ? AND attendee_id = 2', runId)[0]?.status !== 'sent', r.text.slice(0, 200));
r = await pump();
check('the next one goes on (glimpse_hide keeps them off the phone, not off the email)', sent.length === 3 && subj(2) === 'Asked, find out who you would like to meet at Bharat AI Innovation', subj(2));
r = await hit('POST', '/api/admin/attendees/9/send-networking?force=1', {}, ADMIN);
check('a campus-panel-only registrant is skipped', r.json?.skipped === true && sent.length === 3, r.text.slice(0, 160));

// ---- opens, clicks, what came of it ----
r = await hit('GET', `/api/netmail-open?a=1&s=${sig}`);
await hit('GET', `/api/netmail-open?a=1&s=${sig}`);
check('the open picture answers a gif and writes networking.open once', r.status === 200 && r.type === 'image/gif' && marks('networking.open') === '1', marks('networking.open'));
const notifySig = crypto.createHmac('sha256', SESSION).update('notify-mail:6').digest('hex').slice(0, 20);
await hit('GET', `/api/netmail-open?a=6&s=${notifySig}`);
check("the account-ready email's signature does not open this one", marks('networking.open') === '1', marks('networking.open'));
r = await hit('POST', '/api/netmail-click', { a: '1', s: sig });
check('a click from the app is written as networking.click', r.status === 200 && marks('networking.click') === '1', marks('networking.click'));
db.run("INSERT INTO connections (event_id, from_attendee_id, to_attendee_id, status, created_at) VALUES (1, 1, 5, 'pending', datetime('now', '+1 minute'))");
db.run("INSERT INTO connections (event_id, from_attendee_id, to_attendee_id, status, created_at) VALUES (1, 6, 5, 'pending', datetime('now', '-30 days'))");
r = await hit('GET', '/api/admin/netmail-status', undefined, ADMIN);
const st = r.json?.stats || {};
check('status counts: 3 sent, 1 opened, 1 clicked, 1 asked after their email (not before), 0 paid',
  st.sent === 3 && st.tracked === 3 && st.opened === 1 && st.clicked === 1 && st.asked === 1 && st.paid === 0, JSON.stringify(st));
check('and each subject on its own: "book meetings" 1 sent, "find out who" 2 sent with the open and the click',
  st.by_subject?.A?.sent === 1 && st.by_subject.A.opened === 0 && st.by_subject?.B?.sent === 2 && st.by_subject.B.opened === 1 && st.by_subject.B.clicked === 1, JSON.stringify(st.by_subject));
check('and the open run, with nobody new left to add', r.json?.open_run?.id === runId && r.json.left === 0, JSON.stringify(r.json?.open_run) + ' left ' + r.json?.left);

// ---- /networking is unchanged by the shared query ----
r = await hit('GET', '/api/events/1/glimpse');
const names = (r.json?.people || []).map(x => x.name);
check('/networking still names the sharers, without ids, and keeps glimpse_hide and the unsubscribe (Meera, above)', names.join(',') === 'Ratan Kesh,Third Sharer' && !/"id"/.test(r.text), names.join(' | '));

// ---- by itself, 10 minutes after registering ----
// The run is paused and the clock's other jobs are off, so a tick sends this email alone.
await hit('POST', `/api/admin/campaigns/${runId}/pause`, {}, ADMIN);
db.run("INSERT INTO app_settings (key, value) VALUES ('pay_remind_auto', 'off'), ('help_mail_auto', 'off')");
const settle = () => new Promise(res => setTimeout(res, 60));
const tick = async () => { const t = await hit('POST', '/api/cron/tick', {}, ADMIN); await settle(); return t; };
let mob = 0;
const reg = async (name, extra = {}) => {
  const t = await hit('POST', '/api/events/1/attendees/register', { name, email: name.toLowerCase().replace(/[^a-z]+/g, '.') + '@gmail.com',
    mobile: '97000' + String(++mob).padStart(5, '0'), company: 'Selfco', job_title: 'Director', city: 'Mumbai', industry: 'Insurance', badge_type: 'Visitor Pass', ...extra });
  return t.json?.id;
};
const to = (i) => JSON.stringify(sent[i]?.Recipients || '');
const farah = await reg('Farah Self');
const pavan = await reg('Pavan Paid', { badge_type: 'Delegate Pass' });
const olga = await reg('Olga Late');
const omar = await reg('Omar Off');
const pia = await reg('Pia Panel', { registration_source: 'campus:jnu-30sep' });
r = await hit('POST', '/api/admin/attendees', { event_id: 1, name: 'Adil Added', email: 'adil.added@gmail.com', badge_type: 'Visitor Pass', mobile: '9700099999', company: 'X', job_title: 'Y' }, ADMIN);
const adil = r.json?.id;
await settle();
check('registering yourself is marked register.self; a campus panel and someone the team adds are not',
  farah && pavan && olga && omar && pia && adil && marks('register.self') === [farah, pavan, olga, omar].map(String).sort().join(','), marks('register.self') + ' ' + [farah, pavan, olga, omar, pia, adil]);
let base = sent.length;
r = await tick();
check('the clock right after registering sends nothing: ten minutes have not passed', r.status === 200 && r.json?.networking_mail?.due === 0 && sent.length === base, r.status + ' ' + JSON.stringify(r.json?.networking_mail));
const ago = (id, mins) => db.run(`UPDATE admin_audit SET created_at = datetime('now', '-${mins} minutes') WHERE action = 'register.self' AND entity_id = ?`, [String(id)]);
ago(farah, 11); ago(pavan, 11); ago(olga, 25 * 60);
r = await tick();
const farahSubject = farah % 2 ? 'Farah, find out who you would like to meet at Bharat AI Innovation' : 'Farah, book meetings before you arrive with Bharat AI Connect';
check('ten minutes on, the free registrant is sent it, and only they', sent.length === base + 1 && to(base).includes('farah.self@gmail.com') && subj(base) === farahSubject, sent.length - base + ' ' + to(base) + ' ' + subj(base));
check('the free version: steps marked, nothing for sale, signed-in buttons with the nw= tag',
  (body(base).match(/>Delegate Pass<\/span>/g) || []).length === 3 && !body(base).includes('Get a Delegate Pass') && /action=network[^"]*token=[0-9a-f]+/.test(body(base)) && body(base).includes('nw=' + farah + '.'), '');
check('the send is claimed as networking.auto', marks('networking.auto') === String(farah), marks('networking.auto'));
r = await tick();
check('once only: the next tick sends nothing more', sent.length === base + 1, String(sent.length - base));
check('a paid pass not paid for is left to the pay reminder', !JSON.stringify(sent.slice(base)).includes('pavan.paid'), '');
check('a registration more than a day old is left to a run', !JSON.stringify(sent.slice(base)).includes('olga.late'), '');
db.run("INSERT INTO payment_orders (order_id, attendee_id, pass_type, base_paise, gst_paise, amount_paise, status, paid_at) VALUES ('BAI-smoke', ?, 'Delegate Pass', 499900, 89982, 589882, 'paid', datetime('now', '-2 minutes'))", [pavan]);
db.run("UPDATE attendees SET payment_status = 'paid' WHERE id = ?", [pavan]);
await tick();
check('paid two minutes ago: not yet', sent.length === base + 1, String(sent.length - base));
db.run("UPDATE payment_orders SET paid_at = datetime('now', '-11 minutes') WHERE order_id = 'BAI-smoke'");
await tick();
check('ten minutes after the payment, the paid version goes, with the way to the pass',
  sent.length === base + 2 && to(base + 1).includes('pavan.paid') && body(base + 1).includes('Your <strong>Delegate Pass</strong> includes all of it') && body(base + 1).includes('action=download-pass'), subj(base + 1));
r = await hit('POST', '/api/admin/netmail-auto', { on: false }, ADMIN);
ago(omar, 11);
await tick();
check('switched off, nothing goes by itself', r.json?.on === false && sent.length === base + 2, String(sent.length - base));
await hit('POST', '/api/admin/netmail-auto', { on: true }, ADMIN);
await tick();
check('switched back on, it goes', sent.length === base + 3 && to(base + 2).includes('omar.off'), to(base + 2));
r = await hit('POST', `/api/admin/attendees/${farah}/send-networking?force=1`, {}, ADMIN);
check('a run skips anyone sent it by itself', r.json?.skipped === true && /by itself/.test(r.json.reason || '') && sent.length === base + 3, r.text.slice(0, 160));
r = await hit('GET', '/api/admin/netmail-status', undefined, ADMIN);
check('status: on, 3 sent by itself and counted with the run\'s 3; still to get it, only Olga and the one the team added',
  r.json?.auto?.on === true && r.json.auto.sent === 3 && r.json.auto.cron_alive === true && r.json.stats?.sent === 6 && r.json.left === 2, JSON.stringify(r.json?.auto) + ' sent ' + r.json?.stats?.sent + ' left ' + r.json?.left);

// ---- the pages ----
const appJs = (await hit('GET', '/app.js')).text;
check("/app.js: ?action=network opens the Network tab once signed in", appJs.includes("act === 'network'") && appJs.includes("switchTab('networking')"), '');
check('/app.js: the nw= tag goes to /api/netmail-click', appJs.includes("urlParams.get('nw')") && appJs.includes('/api/netmail-click'), '');
const adminJs = (await hit('GET', '/admin.js', undefined, ADMIN)).text;
check('/admin.js: the strip on Notification Status, Preview & send, the run from the list',
  adminJs.includes('id="netmail-strip"') && adminJs.includes('function loadNetMailStrip') && adminJs.includes("startCampaign('networking'") && adminJs.includes("c.kind === 'networking') return openNetMailPreview("), '');
check('/admin.js: the switch for the one that goes by itself', adminJs.includes('function setNetMailAuto') && adminJs.includes('/api/admin/netmail-auto'), '');

console.log(fails ? `\n${fails} check(s) failed` : '\nall networking-email checks passed');
process.exit(fails ? 1 : 0);
