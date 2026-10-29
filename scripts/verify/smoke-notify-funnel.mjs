// Built-worker checks for what came of the account-ready email (29 Oct 2026), on
// real SQLite (sql.js) loaded with the production schema: the open picture, the
// button tag, the profile mark, the yes / maybe / no links, and the counts the
// Notification Status card shows. Elastic Email is stubbed; nothing is sent.
// Run after `npm run build`:  node scripts/verify/smoke-notify-funnel.mjs
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
  const res = await worker.fetch(new Request(path.startsWith('http') ? path : 'https://bharataiinnovation.com' + path, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
  const type = res.headers.get('Content-Type') || '';
  const text = type.startsWith('image/') ? '' : await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, type, text, json, location: res.headers.get('Location') || '' };
};
const ADMIN = { Authorization: 'Bearer smoke-admin' };
const q = (sql, ...a) => { const st = db.prepare(sql); st.bind(clean(a)); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; };
const marks = (action) => q("SELECT entity_id FROM admin_audit WHERE entity = 'attendee' AND action = ? ORDER BY entity_id", action).map(r => r.entity_id).join(',');
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };

// Elastic Email answers yes; the payload is kept to read the email.
const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('elasticemail.com')) { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ MessageID: 'm' + sent.length }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
  return realFetch(url, init);
};

db.run("INSERT INTO events (id, title, start_date, end_date) VALUES (1, 'Bharat AI', '2026-11-20', '2026-11-21')");
db.run("INSERT INTO app_settings (key, value) VALUES ('app_url', 'https://bharataiinnovation.com/app')");
const person = (id, name, email, extra = {}) => {
  const row = { id, event_id: 1, name, email, mobile: '98200' + String(id).padStart(5, '0'), badge_type: 'Visitor Pass', payment_status: 'paid', company: '', ...extra };
  const cols = Object.keys(row);
  db.run(`INSERT INTO attendees (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, clean(cols.map(k => row[k])));
};
person(1, 'Early Bird', 'early@example.com', { notified_at: '2020-01-01 00:00:00' });   // emailed before the marks
person(2, 'Asha Rao', 'asha@example.com');
person(3, 'Ravi Shah', 'ravi@example.com');
person(4, 'Panel Only', 'panel@example.com', { main_event: 0 });

// ---- before any marked email ----
let s = await hit('GET', '/api/admin/events/1/lunch-stats', undefined, ADMIN);
check('lunch-stats answers with notifyMail', s.status === 200 && s.json?.notifyMail, s.status + ' ' + s.text.slice(0, 200));
check('before the first marked email: one sent, no marks_from', s.json?.notifyMail?.sent === 1 && s.json.notifyMail.marks_from === '', JSON.stringify(s.json?.notifyMail));

// ---- the email ----
let r = await hit('POST', '/api/admin/attendees/2/notify', {}, ADMIN);
check('notify sends through Elastic Email', r.status === 200 && r.json?.method === 'elastic_email' && sent.length === 1, r.status + ' ' + r.text.slice(0, 200));
const html = sent[0]?.Content?.Body?.[0]?.Content || '';
const pix = /src="https:\/\/bharataiinnovation\.com\/api\/notify-open\?a=2&amp;s=([0-9a-f]{20})"/.exec(html);
check('the email carries the open picture on the site root', !!pix, html.slice(-600));
const sig = pix ? pix[1] : '';
// Since 29 Oct 2026 every button into the app carries the tag, last, so any click counts.
const appLinks = html.match(/href="https:\/\/bharataiinnovation\.com\/app\?[^"]*"/g) || [];
const tags = html.match(/[?&]ne=2\.([0-9a-f]{20})"/g) || [];
check('every app button carries ne=<id>.<sig>', appLinks.length >= 4 && tags.length === appLinks.length && tags.every(t => t.includes(sig)), appLinks.length + ' links, ' + tags.length + ' tags');
check('and a sign-in token, so the buttons do not end at the sign-in form', appLinks.every(h => /[?&]token=[0-9a-f]+/.test(h)), appLinks[0] || '');
check('the picture sits before the unsubscribe footer and </body>', html.indexOf('/api/notify-open') < html.lastIndexOf('</body>'), '');
const rsvpLinks = html.match(/href="[^"]*\/api\/rsvp\?[^"]*"/g) || [];
check('yes / maybe / no go to /api/rsvp on the site root, not /app/api/rsvp', rsvpLinks.length === 3 && rsvpLinks.every(h => h.startsWith('href="https://bharataiinnovation.com/api/rsvp?')), rsvpLinks.join(' | '));
check('notified_at is set and notify_marks_from stamped', q('SELECT notified_at FROM attendees WHERE id = 2')[0].notified_at && q("SELECT value FROM app_settings WHERE key = 'notify_marks_from'").length === 1, '');
const from1 = q("SELECT value FROM app_settings WHERE key = 'notify_marks_from'")[0]?.value;
await hit('POST', '/api/admin/attendees/3/notify', {}, ADMIN);
check('a second send leaves notify_marks_from as it was', q("SELECT value FROM app_settings WHERE key = 'notify_marks_from'")[0]?.value === from1, '');

// ---- opened ----
r = await hit('GET', `/api/notify-open?a=2&s=${sig}`);
check('the open picture answers with a gif', r.status === 200 && r.type === 'image/gif', r.status + ' ' + r.type);
await hit('GET', `/api/notify-open?a=2&s=${sig}`);
check('an open is written once per person', marks('notify.open') === '2', marks('notify.open'));
await hit('GET', `/api/notify-open?a=3&s=${sig}`);
check("someone else's signature counts nothing", marks('notify.open') === '2', marks('notify.open'));
const upSig = crypto.createHmac('sha256', SESSION).update('upgrade-mail:3').digest('hex').slice(0, 20);
await hit('GET', `/api/notify-open?a=3&s=${upSig}`);
check("the upgrade email's signature does not open this one", marks('notify.open') === '2', marks('notify.open'));
r = await hit('GET', `/api/upgrade-open?a=3&s=${upSig}`);
check('upgrade emails already sent still count their opens', r.type === 'image/gif' && marks('upgrade.open') === '3', marks('upgrade.open'));

// ---- clicked ----
r = await hit('POST', '/api/notify-click', { a: '2', s: sig });
check('a click from the app is written as notify.click', r.status === 200 && marks('notify.click') === '2', marks('notify.click'));

// ---- profile ----
r = await hit('PUT', '/api/attendees/2/profile', { arrival_time: '10:00' }, { Cookie: sessionCookie(SESSION, 2) });
check('a profile save by its owner after the email is written once', r.status === 200 && marks('notify.profile') === '2', r.status + ' ' + marks('notify.profile'));
await hit('PUT', '/api/attendees/2/profile', { city: 'Pune' }, { Cookie: sessionCookie(SESSION, 2) });
check('a second save adds nothing', q("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'notify.profile'")[0].n === 1, '');
await hit('PUT', '/api/attendees/4/profile', { city: 'Pune' }, { Cookie: sessionCookie(SESSION, 4) });
check('someone never emailed is not counted', marks('notify.profile') === '2', marks('notify.profile'));
await hit('PUT', '/api/attendees/3/profile', { city: 'Pune' }, ADMIN);
check('an admin editing someone is not counted', marks('notify.profile') === '2', marks('notify.profile'));

// ---- said if coming, through the email's own link ----
const yes = /href="(https:\/\/bharataiinnovation\.com\/api\/rsvp\?[^"]*status=confirmed[^"]*)"/.exec(html);
r = await hit('GET', yes ? yes[1].replace(/&amp;/g, '&') : '/api/rsvp');
check("the email's yes link records the answer", r.status === 302 && q('SELECT rsvp_status FROM attendees WHERE id = 2')[0].rsvp_status === 'confirmed', r.status + ' ' + r.location);
db.run("UPDATE attendees SET last_login_at = datetime('now', '+1 minute') WHERE id = 2");
db.run("UPDATE attendees SET last_login_at = '2019-01-01 00:00:00' WHERE id = 3");

// ---- the counts ----
s = await hit('GET', '/api/admin/events/1/lunch-stats', undefined, ADMIN);
const m = s.json?.notifyMail || {};
const want = { sent: 3, tracked: 2, opened: 1, clicked: 1, profile: 1, signed_in: 1, pass: 0, answered: 1 };
check('the card counts: ' + JSON.stringify(want), Object.entries(want).every(([k, v]) => m[k] === v), JSON.stringify(m));
check('marks_from comes back as a readable time', typeof m.marks_from === 'string' && m.marks_from.length > 0, JSON.stringify(m.marks_from));

// ---- the pages ----
const appJs = (await hit('GET', '/app.js')).text;
check('/app.js sends the ne= tag to /api/notify-click', appJs.includes("urlParams.get('ne')") && appJs.includes('/api/notify-click'), '');
const adminJs = (await hit('GET', '/admin.js', undefined, ADMIN)).text;
const fn = /function notifyFunnelHTML\(m\) \{[\s\S]*?\n    \}\r?\n/.exec(adminJs);
check('/admin.js has notifyFunnelHTML and the card calls it', !!fn && adminJs.includes('notifyFunnelHTML(lunchStats.notifyMail)'), '');
if (fn) {
  const escH = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const render = new Function('escH', fn[0] + '; return notifyFunnelHTML;')(escH);
  const out = render(m);
  const text = out.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  check('the card shows each step with its count', ['Opened the email 1 of 2 50%', 'Clicked into the app 1 of 2', 'Saved profile or photo 1 of 2', 'Signed in to the app 1 of 3 33%', 'Downloaded their pass 0 of 3 0%', 'Said if they are coming 1 of 3'].every(t => text.includes(t)), text);
  check('and says the earlier email carried no marks', text.includes('the 1 sent before carried no marks'), text);
  const before = render({ sent: 1, tracked: 0, opened: 0, clicked: 0, profile: 0, signed_in: 0, pass: 0, answered: 0, marks_from: '' }).replace(/<[^>]+>/g, ' ');
  check('before any marked email it says opens count from the next one', before.includes('counted from the next email on') && !before.includes('Opened the email'), before);
  check('nobody emailed: nothing shown', render({ sent: 0 }) === '', '');
}

// ---- the mail names the pass the person holds (29 Oct 2026) ----
// It told every free Visitor "Your Delegate Pass" until then.
const subj = (i) => sent[i]?.Content?.Subject || '';
const body = (i) => sent[i]?.Content?.Body?.[0]?.Content || '';
check('a Visitor is told Free Visitor Pass, never Delegate', subj(0) === 'Asha, your Free Visitor Pass is ready' && body(0).includes('Free Visitor Pass') && !/official <strong>Delegate|Download Delegate Pass|Your Delegate Pass/.test(body(0)), subj(0));
check('the free email asks for the badge before it mentions the upgrade', body(0).indexOf('action=social-card') > 0 && body(0).indexOf('action=social-card') < body(0).indexOf('Make it the full conference'), '');
check('the free email says entry is not guaranteed', body(0).includes('Entry on a free Visitor Pass is not guaranteed'), '');
check('nothing no pass includes is offered (CXO Innovation Night)', !/CXO Innovation Night/i.test(body(0)), '');
person(5, 'DR. MEERA IYER', 'meera@example.com', { badge_type: 'Delegate Pass', payment_status: 'paid', company: 'Acme', job_title: 'CTO' });
person(6, 'Kiran Pai', 'kiran@example.com', { badge_type: 'Delegate Pass', payment_status: 'pending' });
person(7, 'Sam Rao', 'sam@example.com', { badge_type: 'Speaker', payment_status: 'waived' });
let n0 = sent.length;
await hit('POST', '/api/admin/attendees/5/notify', {}, ADMIN);
check('a paid Delegate: "Meera, your Delegate Pass is ready", the gold badge, no upgrade block', subj(n0) === 'Meera, your Delegate Pass is ready' && body(n0).includes('gold Delegate badge') && !body(n0).includes('Make it the full conference'), subj(n0));
check('and one line to move up to Premium for the difference', body(n0).includes('pass=premium') && body(n0).includes('for the difference'), '');
n0 = sent.length;
await hit('POST', '/api/admin/attendees/6/notify', {}, ADMIN);
check('an unpaid Delegate holds a Free Visitor Pass until it is paid, and gets a pay button', /one payment away$/.test(subj(n0)) && body(n0).includes('Free Visitor Pass') && body(n0).includes('action=pay&pass=delegate'), subj(n0));
n0 = sent.length;
await hit('POST', '/api/admin/attendees/7/notify', {}, ADMIN);
check('a Speaker: "Sam, your Speaker Pass is ready"', subj(n0) === 'Sam, your Speaker Pass is ready', subj(n0));

// ---- the preview Notify All opens first ----
person(8, 'Lata Shenoy', 'lata@example.com');
person(9, 'Vik Mehta', 'vik@example.com', { badge_type: 'VIP Pass', payment_status: 'paid' });
const before = { sent: sent.length, audit: q('SELECT COUNT(*) AS n FROM admin_audit')[0].n, tokens: q('SELECT COUNT(*) AS n FROM login_tokens')[0].n };
let p = await hit('GET', '/api/admin/notify-preview', undefined, ADMIN);
check('the preview counts the run by pass', p.status === 200 && JSON.stringify(p.json?.counts) === JSON.stringify({ free: 1, paid: 1, unpaid: 0, total: 2 }), p.status + ' ' + JSON.stringify(p.json?.counts));
check('unasked, it shows a Free Visitor Pass', p.json?.kind === 'free' && p.json.sample?.id === 8 && p.json.subject === 'Lata, your Free Visitor Pass is ready', JSON.stringify(p.json?.sample) + ' ' + p.json?.subject);
const ph = p.json?.html || '';
check('the preview has no open picture, no ne= tag and no sign-in token', ph.includes('</html>') && !ph.includes('notify-open') && !/[?&]ne=/.test(ph) && !/[?&]token=/.test(ph), '');
p = await hit('GET', '/api/admin/notify-preview?kind=paid', undefined, ADMIN);
check('?kind=paid shows the VIP', p.json?.sample?.id === 9 && p.json.subject === 'Vik, your VIP Pass is ready', JSON.stringify(p.json?.sample));
p = await hit('GET', '/api/admin/notify-preview?id=6', undefined, ADMIN);
check('?id= previews that one attendee', p.json?.sample?.id === 6 && p.json.kind === 'unpaid', JSON.stringify(p.json?.sample));
check('previewing sent nothing, marked nothing and minted no token',
  sent.length === before.sent && q('SELECT COUNT(*) AS n FROM admin_audit')[0].n === before.audit && q('SELECT COUNT(*) AS n FROM login_tokens')[0].n === before.tokens && !q('SELECT notified_at FROM attendees WHERE id = 8')[0].notified_at,
  JSON.stringify(before));
r = await hit('GET', '/api/admin/notify-preview');
check('the preview is for admins only', r.status === 401 || r.status === 403, String(r.status));
check('/admin.js: Notify All and the RSVP chase open the preview; a running campaign has Pause in the list',
  adminJs.includes('function notifyAllAttendees() { return openNotifyPreview(') && adminJs.includes("openNotifyPreview({ audience: 'non-responders' })") && adminJs.includes('pauseCampaignFromList(') && adminJs.includes("'/api/admin/notify-preview?'"), '');
check('/admin.js: the Notification Status card has Preview email and the run strip; the list has Preview',
  adminJs.includes('Preview email</button>') && adminJs.includes('id="notify-run-strip"') && adminJs.includes('loadNotifyRunStrip();') && adminJs.includes('previewCampaignFromList('), '');

// ---- an open run is resumed, never doubled; a run already made can be previewed ----
r = await hit('POST', '/api/admin/campaigns', { kind: 'notify', audience: 'un-notified' }, ADMIN);
const runId = r.json?.id;
check('Notify All makes a run of the two not yet notified', r.status === 201 && r.json.total === 2, r.status + ' ' + r.text.slice(0, 200));
await hit('POST', `/api/admin/campaigns/${runId}/pause`, {}, ADMIN);
r = await hit('POST', '/api/admin/campaigns', { kind: 'notify', audience: 'un-notified' }, ADMIN);
check('a second run while one is paused is refused (it would email the same people twice)', r.status === 409 && r.json?.open_run?.id === runId, r.status + ' ' + r.text.slice(0, 200));
p = await hit('GET', '/api/admin/notify-preview', undefined, ADMIN);
check('the Notify All preview names the open run', p.json?.open_run?.id === runId && p.json.open_run.status === 'paused', JSON.stringify(p.json?.open_run));
p = await hit('GET', `/api/admin/notify-preview?campaign=${runId}&kind=paid`, undefined, ADMIN);
check('?campaign= previews what that run still has to send', p.json?.counts?.total === 2 && p.json.sample?.id === 9 && !p.json.open_run, JSON.stringify(p.json?.counts));
r = await hit('GET', '/api/admin/campaigns', undefined, ADMIN);
check('the campaign list carries each run\'s audience (the upgrade preview needs it)', (r.json?.campaigns || []).some(x => x.id === runId && x.audience === 'un-notified'), '');
r = await hit('POST', '/api/admin/campaigns', { kind: 'notify', audience: 'non-responders' }, ADMIN);
check('a run for another audience is not blocked by it', r.status !== 409, r.status + ' ' + r.text.slice(0, 120));

console.log(fails ? `\n${fails} check(s) failed` : '\nall notify-funnel checks passed');
process.exit(fails ? 1 : 0);
