// Built-worker checks for the account-ready email going by itself 5 minutes after
// someone registers (4 Nov 2026), on real SQLite (sql.js) loaded with the production
// schema: not before 5 minutes, once, only those who registered themselves, not an
// unpaid paid pass (5 minutes after paying instead), not after a day, not anyone
// already sent it or held by an account-ready run, a failed send left for Notify
// All, the switch, the card's counts, and the networking email still following at
// 10 minutes, in that order. Elastic Email is stubbed; nothing is sent.
// Run after `npm run build`:  node scripts/verify/smoke-notify-auto.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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
const env = new Proxy({ ADMIN_SECRET: 'smoke-admin', SESSION_SECRET: 'smoke-session', ELASTIC_EMAIL_API_KEY: 'smoke-key', DB: D1 }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };
const hit = async (method, path, body, headers = {}) => {
  const res = await worker.fetch(new Request('https://bharataiinnovation.com' + path, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
};
const ADMIN = { Authorization: 'Bearer smoke-admin' };
const q = (sql, ...a) => { const st = db.prepare(sql); st.bind(clean(a)); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; };
const marks = (action) => q("SELECT entity_id FROM admin_audit WHERE entity = 'attendee' AND action = ? ORDER BY CAST(entity_id AS INTEGER)", action).map(r => r.entity_id).join(',');
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };

// Elastic Email answers yes, except for one address it refuses.
const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('elasticemail.com')) {
    const p = JSON.parse(init.body);
    if (JSON.stringify(p.Recipients).includes('fiona.fail')) return new Response(JSON.stringify({ Error: 'Mailbox refused' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    sent.push(p);
    return new Response(JSON.stringify({ MessageID: 'm' + sent.length }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return realFetch(url, init);
};
const subj = (i) => sent[i]?.Content?.Subject || '';
const body = (i) => sent[i]?.Content?.Body?.[0]?.Content || '';
const to = (i) => JSON.stringify(sent[i]?.Recipients || '');
const settle = () => new Promise(res => setTimeout(res, 60));
const tick = async () => { const t = await hit('POST', '/api/cron/tick', {}, ADMIN); await settle(); return t; };
const notifiedAt = (id) => q('SELECT notified_at FROM attendees WHERE id = ?', id)[0]?.notified_at || null;
const ago = (id, mins) => db.run(`UPDATE admin_audit SET created_at = datetime('now', '-${mins} minutes') WHERE action = 'register.self' AND entity_id = ?`, [String(id)]);

db.run("INSERT INTO events (id, title, start_date, end_date) VALUES (1, 'Bharat AI', '2026-11-20', '2026-11-21')");
db.run("INSERT INTO app_settings (key, value) VALUES ('app_url', 'https://bharataiinnovation.com/app')");
// The clock's other jobs are off, so a tick sends these emails alone.
db.run("INSERT INTO app_settings (key, value) VALUES ('pay_remind_auto', 'off'), ('help_mail_auto', 'off')");

let mob = 0;
const reg = async (name, extra = {}) => {
  const t = await hit('POST', '/api/events/1/attendees/register', { name, email: name.toLowerCase().replace(/[^a-z]+/g, '.') + '@gmail.com',
    mobile: '97000' + String(++mob).padStart(5, '0'), company: 'Selfco', job_title: 'Director', city: 'Mumbai', industry: 'Insurance', badge_type: 'Visitor Pass', ...extra });
  return t.json?.id;
};
const farah = await reg('Farah Self');
const pavan = await reg('Pavan Paid', { badge_type: 'Delegate Pass' });
const olga = await reg('Olga Late');
const omar = await reg('Omar Off');
const nadia = await reg('Nadia Hand');
const rita = await reg('Rita Run');
const fiona = await reg('Fiona Fail');
const uma = await reg('Uma Unsub');
const pia = await reg('Pia Panel', { registration_source: 'campus:jnu-30sep' });
let r = await hit('POST', '/api/admin/attendees', { event_id: 1, name: 'Adil Added', email: 'adil.added@gmail.com', badge_type: 'Visitor Pass', mobile: '9700099999', company: 'X', job_title: 'Y' }, ADMIN);
const adil = r.json?.id;
await settle();
check('ten people in: nine registered themselves (one for a campus panel), one added by the team',
  [farah, pavan, olga, omar, nadia, rita, fiona, uma, pia, adil].every(Boolean), [farah, pavan, olga, omar, nadia, rita, fiona, uma, pia, adil].join(','));

let base = sent.length;
r = await tick();
check('the clock right after registering sends nothing: five minutes have not passed',
  r.status === 200 && r.json?.notify_mail?.on === true && r.json.notify_mail.due === 0 && sent.length === base, r.status + ' ' + JSON.stringify(r.json?.notify_mail));

// ---- five minutes on ----
// Pia (campus panel) and Adil (added by the team) have no register.self to age.
for (const id of [farah, pavan, nadia, rita, fiona, uma]) ago(id, 6);
ago(olga, 25 * 60);
// Nadia was sent it by hand before the clock got to her.
r = await hit('POST', `/api/admin/attendees/${nadia}/notify`, {}, ADMIN);
check('Nadia is sent it by hand first', r.json?.method === 'elastic_email' && sent.length === base + 1 && to(base).includes('nadia.hand'), r.text.slice(0, 160));
// Rita is held by an account-ready run that is paused.
r = await hit('POST', '/api/admin/campaigns', { kind: 'notify', ids: [rita], title: 'Account-ready email' }, ADMIN);
const runId = r.json?.id;
await hit('POST', `/api/admin/campaigns/${runId}/pause`, {}, ADMIN);
check('Rita is on a paused account-ready run', runId && q('SELECT status FROM campaigns WHERE id = ?', runId)[0]?.status === 'paused', r.text.slice(0, 160));
// Uma unsubscribed.
db.run("UPDATE attendees SET unsubscribed_at = datetime('now') WHERE id = ?", [uma]);
base = sent.length;
r = await tick();
check('five minutes on, the free registrant is sent it, and only they', sent.length === base + 1 && to(base).includes('farah.self@gmail.com') && r.json?.notify_mail?.sent === 1,
  (sent.length - base) + ' ' + to(base) + ' ' + JSON.stringify(r.json?.notify_mail));
check('it is the account-ready email for a Free Visitor Pass', subj(base) === 'Farah, your Free Visitor Pass is ready' && body(base).includes('Your Free Visitor Pass'), subj(base));
check('with the open picture, signed-in buttons carrying the ne= tag, and the unsubscribe footer and header',
  body(base).includes('/api/notify-open?a=' + farah + '&amp;s=') && /action=social-card[^"]*token=[0-9a-f]+[^"]*&ne=/.test(body(base)) &&
  /unsubscribe/i.test(body(base)) && !!sent[base]?.Content?.Headers?.['List-Unsubscribe'], '');
check('Farah is marked notified, the send is claimed as notify.auto, and the marks begin', !!notifiedAt(farah) && marks('notify.auto') === String(farah) &&
  q("SELECT value FROM app_settings WHERE key = 'notify_marks_from'").length === 1, notifiedAt(farah) + ' ' + marks('notify.auto'));
check('a failed send is left as notify.auto_error, not notified, for Notify All', marks('notify.auto_error') === String(fiona) && !notifiedAt(fiona), marks('notify.auto_error'));
check('nobody already sent it by hand, held by a run, unsubscribed, on a campus panel or added by the team',
  !JSON.stringify(sent.slice(base)).match(/nadia|rita|uma\.|pia\.|adil/), '');
check('a paid pass not paid for is left to the pay reminder; a registration over a day old to Notify All',
  !JSON.stringify(sent.slice(base)).match(/pavan|olga/) && !notifiedAt(pavan) && !notifiedAt(olga), '');

r = await tick();
check('once only: the next tick sends nothing more, and the failed one is not retried', sent.length === base + 1 && marks('notify.auto_error') === String(fiona), String(sent.length - base));

// ---- a paid pass, 5 minutes after paying ----
db.run("INSERT INTO payment_orders (order_id, attendee_id, pass_type, base_paise, gst_paise, amount_paise, status, paid_at) VALUES ('BAI-smoke', ?, 'Delegate Pass', 499900, 89982, 589882, 'paid', datetime('now', '-2 minutes'))", [pavan]);
db.run("UPDATE attendees SET payment_status = 'paid' WHERE id = ?", [pavan]);
await tick();
check('paid two minutes ago: not yet', sent.length === base + 1, String(sent.length - base));
db.run("UPDATE payment_orders SET paid_at = datetime('now', '-6 minutes') WHERE order_id = 'BAI-smoke'");
await tick();
check('five minutes after the payment, the paid version goes', sent.length === base + 2 && to(base + 1).includes('pavan.paid') &&
  subj(base + 1) === 'Pavan, your Delegate Pass is ready' && body(base + 1).includes('Download my pass'), subj(base + 1));

// ---- the switch ----
r = await hit('POST', '/api/admin/notify-auto', { on: false }, ADMIN);
ago(omar, 6);
await tick();
check('switched off, nothing goes by itself', r.json?.on === false && sent.length === base + 2 && !notifiedAt(omar), String(sent.length - base));
let s = await hit('GET', '/api/admin/events/1/lunch-stats', undefined, ADMIN);
check('the card says it is off', s.json?.notifyAuto?.on === false, JSON.stringify(s.json?.notifyAuto));
r = await hit('POST', '/api/admin/notify-auto', { on: true }, ADMIN);
await tick();
check('switched back on, it goes', r.json?.on === true && sent.length === base + 3 && to(base + 2).includes('omar.off'), to(base + 2));
r = await hit('POST', '/api/admin/notify-auto', { on: false });
check('the switch is for admins only', r.status === 401 || r.status === 403, String(r.status));

// ---- the card ----
s = await hit('GET', '/api/admin/events/1/lunch-stats', undefined, ADMIN);
const au = s.json?.notifyAuto || {};
check('the card: on, 5 minutes, 3 sent by itself, 1 failed, the clock alive', au.on === true && au.after_minutes === 5 && au.sent === 3 && au.failed === 1 && au.cron_alive === true, JSON.stringify(au));
check('and the account-ready counts include them (Nadia by hand + Farah, Pavan, Omar)', s.json?.notifyMail?.sent === 4, JSON.stringify(s.json?.notifyMail));

// ---- the networking email still follows at 10 minutes, after this one ----
base = sent.length;
ago(farah, 11);
await tick();
check('ten minutes on, Farah is sent the networking email, and not the account-ready one again',
  sent.length === base + 1 && to(base).includes('farah.self') && /Bharat AI (Connect|Innovation)$/.test(subj(base)) && !/is ready/.test(subj(base)), (sent.length - base) + ' ' + subj(base));
const zed = await reg('Zed Late');
await settle();
ago(zed, 11);
base = sent.length;
await tick();
check('a clock that was late sends both, the account-ready email first',
  sent.length === base + 2 && to(base).includes('zed.late') && subj(base) === 'Zed, your Free Visitor Pass is ready' && to(base + 1).includes('zed.late') && !/is ready/.test(subj(base + 1)),
  (sent.length - base) + ' ' + subj(base) + ' | ' + subj(base + 1));

// ---- the page ----
const adminJs = (await hit('GET', '/admin.js', undefined, ADMIN)).text;
check('/admin.js: the line and the switch on Notification Status', adminJs.includes('notifyAutoHTML(lunchStats.notifyAuto)') &&
  adminJs.includes('function setNotifyAuto') && adminJs.includes('/api/admin/notify-auto'), '');

console.log(fails ? `\n${fails} check(s) failed` : '\nall account-ready-by-itself checks passed');
process.exit(fails ? 1 : 0);
