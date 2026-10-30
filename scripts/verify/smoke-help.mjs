// Built-worker checks for the help email and the counts behind Admin's "Pass &
// badge" card (29 Oct 2026), on real SQLite (sql.js) loaded with the production
// schema: the steps the app reports (track-step), the startup report (app-boot),
// a sign-in link that no longer works, who the minute clock sends the steps to and
// who it must not, the email itself (bullet points, a sign-in link, not a word
// about anything going wrong), sending by hand, the switch, and /app.js?v= caching.
// Elastic Email is stubbed; nothing is sent.
// Run after `npm run build`:  node scripts/verify/smoke-help.mjs
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
const env = new Proxy({ ADMIN_SECRET: 'smoke-admin', SESSION_SECRET: SESSION, CRON_SECRET: 'smoke-cron', ELASTIC_EMAIL_API_KEY: 'smoke-key', DB: D1 }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
// cf: what Cloudflare puts on a request (asn, asOrganization) - a scanner's network.
const hit = async (method, path, body, headers = {}, cf) => {
  const req = new Request('https://bharataiinnovation.com' + path, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', 'User-Agent': ANDROID, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (cf) Object.defineProperty(req, 'cf', { value: cf });
  const res = await worker.fetch(req, env, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json, cache: res.headers.get('Cache-Control') || '' };
};
const ADMIN = { Authorization: 'Bearer smoke-admin' };
const CRON = { Authorization: 'Bearer smoke-cron' };
const as = (id) => ({ Cookie: sessionCookie(SESSION, id) });
const q = (sql, ...a) => { const st = db.prepare(sql); st.bind(clean(a)); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; };
const rows = (action, id) => q("SELECT * FROM admin_audit WHERE action = ?" + (id == null ? '' : " AND entity_id = '" + id + "'") + ' ORDER BY id', action);
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };

// Elastic Email answers yes, except for one address that bounces.
const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('elasticemail.com')) {
    const p = JSON.parse(init.body);
    if ((p.Recipients?.To || []).some(t => t.includes('bounce@'))) return new Response(JSON.stringify({ Error: 'Mailbox does not exist' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    sent.push(p);
    return new Response(JSON.stringify({ MessageID: 'm' + sent.length }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return realFetch(url, init);
};
const to = (p) => (p.Recipients?.To || [])[0] || '';
const html = (p) => p?.Content?.Body?.[0]?.Content || '';
const sentTo = () => sent.map(to).sort().join(',');

db.run("INSERT INTO events (id, title, start_date, end_date) VALUES (1, 'Bharat AI', '2026-11-20', '2026-11-21')");
db.run("INSERT INTO app_settings (key, value) VALUES ('app_url', 'https://bharataiinnovation.com/app')");
const person = (id, name, email, extra = {}) => {
  const row = { id, event_id: 1, name, email, mobile: '98200' + String(id).padStart(5, '0'), badge_type: 'Visitor Pass', payment_status: 'paid', company: '', ...extra };
  const cols = Object.keys(row);
  db.run(`INSERT INTO attendees (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, clean(cols.map(k => row[k])));
};
const trouble = (id, action, ago, detail = null) =>
  db.run("INSERT INTO admin_audit (actor, actor_kind, action, entity, entity_id, detail, created_at) VALUES ('attendee', 'attendee', ?, 'attendee', ?, ?, datetime('now', ?))",
    [action, String(id), detail, ago]);

person(1, 'Asha Rao', 'asha@example.com');
person(2, 'Ravi Shah', 'ravi@example.com');
person(3, 'Meera Iyer', 'meera@example.com', { social_card_downloaded_at: "2030-01-01 00:00:00" });
person(4, 'Kiran Rao', 'kiran@example.com');
person(5, 'Unsub Person', 'unsub@example.com', { unsubscribed_at: '2026-10-01 00:00:00' });
person(6, 'Old Trouble', 'old@example.com');
person(7, 'Signed In', 'signedin@example.com');
person(8, 'Got There', 'recovered@example.com');
person(9, 'Bounce Person', 'bounce@example.com');
person(10, 'Token Holder', 'token@example.com');
person(11, 'Old Link', 'oldlink@example.com');
person(12, 'Rajib Test', 'rajib-test@example.com', { badge_type: 'VIP Pass', payment_status: 'waived' });
person(13, 'Later One', 'later@example.com');
person(14, 'Tapper', 'tapper@example.com');
person(16, 'Scanned Link', 'scanned@example.com');
person(17, 'Old Scan', 'oldscan@example.com');

trouble(1, 'app.boot_fail', '-20 minutes', JSON.stringify({ what: 'did not load /app.js?v=1', action: 'social-card' }));
trouble(2, 'card.photo_fail', '-20 minutes', JSON.stringify({ reason: 'There is no face in this photo' }));
trouble(3, 'card.fail', '-20 minutes', JSON.stringify({ reason: 'photo did not load' }));
trouble(4, 'pass.fail', '-3 minutes', JSON.stringify({ reason: 'QR not drawn' }));
trouble(5, 'pass.fail', '-20 minutes', JSON.stringify({ reason: 'QR not drawn' }));
trouble(6, 'card.fail', '-3 days', JSON.stringify({ reason: 'photo did not load' }));
trouble(7, 'app.boot_fail', '-20 minutes', JSON.stringify({ what: 'page code did not start' }));
db.run("UPDATE attendees SET last_login_at = datetime('now', '-5 minutes') WHERE id = 7");
trouble(8, 'app.boot_fail', '-20 minutes', JSON.stringify({ what: 'page code did not start' }));
trouble(8, 'app.boot_ok', '-15 minutes', JSON.stringify({ what: 'started' }));
trouble(9, 'card.fail', '-20 minutes', JSON.stringify({ reason: 'card not drawn' }));
// 17: what an email scanner left before scan rows existed - a "slow" report two
// seconds in, its start, and the badge it opened, all in the same minute.
trouble(17, 'app.boot_slow', '-20 minutes', JSON.stringify({ what: 'still loading after 15 s', ms: 2300, browser: 'Chrome 155 on Windows' }));
trouble(17, 'app.boot_ok', '-20 minutes', JSON.stringify({ what: 'started', ms: 3000 }));
trouble(17, 'card.open', '-20 minutes');
trouble(17, 'card.photo_asked', '-20 minutes');

// ---- the steps the app reports ----
let r = await hit('POST', '/api/attendees/14/track-step', { kind: 'card', step: 'open' });
check('track-step: no session is refused', r.status === 401, r.status + ' ' + r.text);
r = await hit('POST', '/api/attendees/14/track-step', { kind: 'card', step: 'open' }, as(1));
check('track-step: someone else is refused', r.status === 403, r.status + ' ' + r.text);
r = await hit('POST', '/api/attendees/14/track-step', { kind: 'banner', step: 'open' }, as(14));
check('track-step: an unknown kind is refused', r.status === 400, r.status + ' ' + r.text);
r = await hit('POST', '/api/attendees/14/track-step', { kind: 'card', step: 'dance' }, as(14));
check('track-step: an unknown step is refused', r.status === 400, r.status + ' ' + r.text);
r = await hit('POST', '/api/attendees/14/track-step', { kind: 'card', step: 'open' }, as(14));
await hit('POST', '/api/attendees/14/track-step', { kind: 'card', step: 'open' }, as(14));
check('track-step: card.open recorded once for two taps', r.status === 200 && rows('card.open', 14).length === 1, r.status + ' rows=' + rows('card.open', 14).length);
await hit('POST', '/api/attendees/14/track-step', { kind: 'card', step: 'photo_fail', reason: 'There is no face <script>x</script> in this photo' }, as(14));
const pf = rows('card.photo_fail', 14).map(x => x.detail).join(' | ');
check('track-step: the reason is kept as text without markup', rows('card.photo_fail', 14).length === 1 && !pf.includes('<') && pf.includes('There is no face'), pf);
await hit('POST', '/api/attendees/14/track-step', { kind: 'card', step: 'photo_fail', reason: 'photo too large' }, as(14));
check('track-step: a new reason is a new row', rows('card.photo_fail', 14).length === 2, 'rows=' + rows('card.photo_fail', 14).length);
r = await hit('POST', '/api/attendees/14/track-step', { kind: 'pass', step: 'open' }, ADMIN);
check('track-step: an admin is not counted as the person', r.status === 200 && r.json?.counted === false && rows('pass.open', 14).length === 0, r.status + ' ' + r.text);

// ---- the startup report ----
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const AZURE = { asn: 8075, asOrganization: 'Microsoft Corporation' };
const TOKEN = crypto.randomBytes(32).toString('hex');
db.run("INSERT INTO login_tokens (event_id, email, token_hash, code_hash, expires_at, max_uses) VALUES (1, 'token@example.com', ?, 'x', datetime('now', '+1 day'), 4)",
  [sha(TOKEN)]);
r = await hit('POST', '/api/app-boot', { stage: 'dance' });
check('app-boot: an unknown stage is refused', r.status === 400, r.status + ' ' + r.text);
r = await hit('POST', '/api/app-boot', { stage: 'fail', email: 'Token@Example.com', token: TOKEN, action: 'social-card', retried: true, ms: 4100,
  errs: [{ kind: 'load', src: '/app.js?v=1de3727a' }, { kind: 'error', msg: "Unexpected token '<'", src: '/js/x.js', line: 3 }] });
const bf = rows('app.boot_fail', 10);
const bd = bf[0] ? JSON.parse(bf[0].detail) : {};
check('app-boot: a link token this site issued names the person', r.status === 200 && bf.length === 1, r.status + ' rows=' + bf.length);
check('app-boot: the detail says what happened, in which browser, for which link', bd.what?.includes('did not load /app.js?v=1de3727a') && bd.browser === 'Chrome 128 on Android 14' && bd.action === 'social-card' && bd.retried === true, JSON.stringify(bd));
check('app-boot: the sign-in token is never stored', !bf[0]?.detail?.includes(TOKEN) && !q('SELECT detail FROM admin_audit').some(x => String(x.detail || '').includes(TOKEN)), bf[0]?.detail);
await hit('POST', '/api/app-boot', { stage: 'fail', email: 'token@example.com', token: TOKEN });
check('app-boot: a second report within ten minutes is the same row', rows('app.boot_fail', 10).length === 1, 'rows=' + rows('app.boot_fail', 10).length);
r = await hit('POST', '/api/app-boot', { stage: 'slow', ms: 16000 }, as(4));
check('app-boot: the session cookie names the person', rows('app.boot_slow', 4).length === 1, r.status + ' ' + r.text);
const before = rows('app.boot_fail').length;
for (let i = 0; i < 7; i++) await hit('POST', '/api/app-boot', { stage: 'fail', email: 'token@example.com', token: 'ab'.repeat(32) }, { 'CF-Connecting-IP': '203.0.113.9' });
const vis = q("SELECT COUNT(*) AS n FROM admin_audit WHERE entity = 'visitor' AND action = 'app.boot_fail'")[0].n;
check('app-boot: a token nobody issued is a visitor, five an hour from one address', vis === 5 && rows('app.boot_fail').length === before + 5, 'visitor rows=' + vis);
await hit('POST', '/api/app-boot', { stage: 'ok' }, { 'CF-Connecting-IP': '203.0.113.10' });
check('app-boot: an unknown visitor who got in leaves no row', q("SELECT COUNT(*) AS n FROM admin_audit WHERE entity = 'visitor' AND action = 'app.boot_ok'")[0].n === 0, '');

// ---- an email scanner running the page ----
r = await hit('POST', '/api/app-boot', { stage: 'slow', ms: 2300 }, as(16));
const sc = rows('app.boot_scan', 16);
check('app-boot: a 15-second timer that fired after two seconds is a scanner, not a slow start', r.status === 200 && sc.length === 1 && rows('app.boot_slow', 16).length === 0 && JSON.parse(sc[0].detail).what === 'opened by an email scanner', r.status + ' ' + JSON.stringify(sc.map(x => x.detail)));
r = await hit('POST', '/api/app-boot', { stage: 'scan', ms: 40 }, as(16));
await hit('POST', '/api/app-boot', { stage: 'fail', ms: 16000 }, as(16), AZURE);
check('app-boot: the page saying so, or a scanner network, is the same one row', r.status === 200 && rows('app.boot_scan', 16).length === 1 && rows('app.boot_fail', 16).length === 0, 'scan=' + rows('app.boot_scan', 16).length + ' fail=' + rows('app.boot_fail', 16).length);
r = await hit('POST', '/api/app-boot', { stage: 'ok', ms: 3000 }, as(16), AZURE);
check('app-boot: a scanner that got in leaves no row', r.status === 200 && rows('app.boot_ok', 16).length === 0, r.status + ' ' + r.text);
r = await hit('POST', '/api/app-boot', { stage: 'slow', ms: 2900, email: 'token@example.com', token: 'cd'.repeat(32) }, { 'CF-Connecting-IP': '203.0.113.11' });
check('app-boot: an unknown scanner is a visitor scan row, not a visitor stuck', q("SELECT action FROM admin_audit WHERE entity = 'visitor' AND ip = '203.0.113.11'").map(x => x.action).join() === 'app.boot_scan', '');
r = await hit('POST', '/api/attendees/16/track-step', { kind: 'card', step: 'open' }, as(16), AZURE);
check("track-step: what a scanner did with the page is not the person's step", r.status === 200 && r.json?.counted === false && rows('card.open', 16).length === 0, r.status + ' ' + r.text);

// ---- a sign-in link that no longer works ----
r = await hit('POST', '/api/events/1/attendees/login', { email: 'oldlink@example.com', token: 'f'.repeat(64) });
const lr = rows('login.link_refused', 11);
check('login: a dead link is refused and counted against its owner', r.status === 401 && lr.length === 1 && JSON.parse(lr[0].detail).reason.length > 0, r.status + ' rows=' + lr.length);
r = await hit('POST', '/api/events/1/attendees/login', { email: 'oldlink@example.com' });
check('login: a link without a token is refused and counted', r.status === 403 && rows('login.link_refused', 11).length === 2, r.status + ' rows=' + rows('login.link_refused', 11).length);
r = await hit('POST', '/api/events/1/attendees/login', { email: 'oldlink@example.com', code: '123456' });
check('login: a mistyped code is not counted', r.status === 401 && rows('login.link_refused', 11).length === 2, r.status + ' rows=' + rows('login.link_refused', 11).length);
await hit('POST', '/api/events/1/attendees/login', { email: 'nobody@example.com', token: 'f'.repeat(64) });
check('login: an address with no account leaves no row', q("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'login.link_refused'")[0].n === 2, '');
r = await hit('POST', '/api/events/1/attendees/login', { email: 'oldlink@example.com', token: 'f'.repeat(64) }, {}, AZURE);
check('login: a scanner re-opening a dead link is not a person shut out', r.status === 401 && rows('login.link_refused', 11).length === 2, r.status + ' rows=' + rows('login.link_refused', 11).length);

// ---- a link opened by a scanner spends nothing ----
const LINK = crypto.randomBytes(32).toString('hex');
db.run("INSERT INTO login_tokens (event_id, email, token_hash, code_hash, expires_at, max_uses, created_at) VALUES (1, 'scanned@example.com', ?, 'x', datetime('now', '+1 day'), 6, datetime('now', '-5 minutes'))", [sha(LINK)]);
const latest = () => q("SELECT uses, used_at FROM login_tokens WHERE email = 'scanned@example.com' ORDER BY id DESC LIMIT 1")[0];
const lastLogin = () => q('SELECT last_login_at FROM attendees WHERE id = 16')[0].last_login_at;
r = await hit('POST', '/api/events/1/attendees/login', { email: 'scanned@example.com', token: LINK }, {}, AZURE);
check('login: a scanner opening the link is signed in and spends no use', r.status === 200 && r.json?.id === 16 && latest().uses === 0 && !latest().used_at, r.status + ' ' + JSON.stringify(latest()));
check("login: a scanner's sign-in is not the person's last sign-in", lastLogin() == null, String(lastLogin()));
r = await hit('POST', '/api/events/1/attendees/login', { email: 'scanned@example.com', token: LINK });
check('login: the person opening the same link spends one, and is signed in', r.status === 200 && latest().uses === 1 && lastLogin() != null, JSON.stringify(latest()) + ' ' + lastLogin());
const FRESH = crypto.randomBytes(32).toString('hex');
db.run("INSERT INTO login_tokens (event_id, email, token_hash, code_hash, expires_at, max_uses) VALUES (1, 'scanned@example.com', ?, 'x', datetime('now', '+1 day'), 6)", [sha(FRESH)]);
r = await hit('POST', '/api/events/1/attendees/login', { email: 'scanned@example.com', token: FRESH });
check('login: a link opened within two minutes of being issued spends nothing (scanners open on arrival)', r.status === 200 && latest().uses === 0 && !latest().used_at, JSON.stringify(latest()));
db.run("INSERT INTO login_tokens (event_id, email, token_hash, code_hash, expires_at, max_uses) VALUES (1, 'scanned@example.com', 'y', ?, datetime('now', '+1 day'), 1)", [sha('424242')]);
r = await hit('POST', '/api/events/1/attendees/login', { email: 'scanned@example.com', code: '424242' }, {}, AZURE);
check('login: a one-use code is spent on first use, fresh or not, whatever the network', r.status === 200 && !!latest().used_at, r.status + ' ' + JSON.stringify(latest()));

// ---- the minute clock ----
const tokensBefore = q('SELECT COUNT(*) AS n FROM login_tokens')[0].n;
r = await hit('POST', '/api/cron/tick', { max_seconds: 0 }, CRON);
check('tick: answers with the help email part', r.status === 200 && r.json?.help_mail?.on === true, r.status + ' ' + r.text.slice(0, 300));
check('tick: the steps go to the two people who are due, and only them', sentTo() === 'asha@example.com,ravi@example.com', sentTo());
check('tick: the bounce is recorded as not delivered, not as sent', rows('help.error.card', 9).length === 1 && rows('help.sent.card', 9).length === 0 && r.json?.help_mail?.failed === 1, JSON.stringify(r.json?.help_mail));
check('tick: each email carries a fresh four-use sign-in link', q("SELECT COUNT(*) AS n FROM login_tokens WHERE max_uses = 4 AND email IN ('asha@example.com', 'ravi@example.com')")[0].n === 2 && q('SELECT COUNT(*) AS n FROM login_tokens')[0].n === tokensBefore + 3, 'one each, and one for the address that bounced');
const app = sent.find(p => to(p) === 'asha@example.com'), card = sent.find(p => to(p) === 'ravi@example.com');
const words = (h) => h.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ');
const BLAME = /\b(error|errors|problem|problems|issue|issues|fail|failed|failure|bug|bugs|broken|sorry|apolog\w*|wrong|glitch|outage|crash\w*)\b/i;
for (const [name, p, path] of [['app', app, 'action=social-card'], ['card', card, 'action=social-card']]) {
  const h = html(p);
  check(`email (${name}): the steps are bullet points`, (h.match(/<li /g) || []).length >= 4 && h.includes('<ul '), h.slice(0, 200));
  check(`email (${name}): the button signs them in and opens the right place`, new RegExp('href="https://bharataiinnovation.com/app\\?email=[a-z]+%40example\\.com&amp;' + path + '&amp;token=[0-9a-f]{64}"').test(h), (h.match(/href="[^"]*app\?[^"]*"/) || [''])[0]);
  check(`email (${name}): not a word about anything going wrong`, !BLAME.test(words(h)) && !BLAME.test(p.Content.Subject), (words(h).match(BLAME) || [''])[0] + ' / ' + p.Content.Subject);
}
check('email (app): the way-in subject and the in-app-browser step', app?.Content?.Subject === 'Your Bharat AI Innovation account: the quickest way in' && html(app).includes('Open in Chrome'), app?.Content?.Subject);
check('email (card): the badge subject and the photo step', card?.Content?.Subject?.includes('badge') && html(card).includes('Take a photo'), card?.Content?.Subject);
check('email: a Free Visitor Pass is named as one', html(app).includes('Free Visitor Pass'), '');
const n1 = sent.length;
r = await hit('POST', '/api/cron/tick', { max_seconds: 0 }, CRON);
check('tick again: nobody is sent the steps twice, and a bounce is not retried every minute', sent.length === n1 && rows('help.error.card', 9).length === 1, sentTo());

// Someone due later, the switch off, then on.
trouble(13, 'pass.photo_fail', '-11 minutes', JSON.stringify({ reason: 'upload did not finish' }));
r = await hit('POST', '/api/admin/help-mail/auto', { on: false }, ADMIN);
await hit('POST', '/api/cron/tick', { max_seconds: 0 }, CRON);
check('switch off: nothing goes by itself', r.status === 200 && sent.length === n1, sentTo());
await hit('POST', '/api/admin/help-mail/auto', { on: true }, ADMIN);
await hit('POST', '/api/cron/tick', { max_seconds: 0 }, CRON);
const pass = sent.find(p => to(p) === 'later@example.com');
check('switch on: the pass steps go, with a link that opens the pass', !!pass && /action=download-pass&amp;token=/.test(html(pass)) && pass.Content.Subject === 'Your Free Visitor Pass: quick steps to get it', pass?.Content?.Subject);

// ---- by hand ----
r = await hit('POST', '/api/admin/help-mail/send', { email: 'rajib-test@example.com', topic: 'app' });
check('send by hand: needs the admin', r.status === 401, r.status + ' ' + r.text);
r = await hit('POST', '/api/admin/help-mail/send', { email: 'Rajib-Test@example.com', topic: 'app' }, ADMIN);
const rj = sent.find(p => to(p) === 'rajib-test@example.com');
check('send by hand: someone stuck before any of this was counted gets the way-in steps', r.status === 200 && r.json?.sent === true && !!rj, r.status + ' ' + r.text);
check('send by hand: the way in opens on the badge for someone without one, and names a paid pass', /app\?email=rajib-test%40example\.com&amp;action=social-card&amp;token=/.test(html(rj)) && html(rj).includes('VIP Pass'), (html(rj).match(/href="[^"]*app\?[^"]*"/) || [''])[0]);
check('send by hand: recorded with who pressed it', rows('help.sent.app', 12).length === 1 && rows('help.sent.app', 12)[0].actor_kind !== 'system', JSON.stringify(rows('help.sent.app', 12)[0] || {}));
r = await hit('POST', '/api/admin/help-mail/send', { email: 'asha@example.com', topic: 'app' }, ADMIN);
check('send by hand: goes even when the clock sent one before', r.status === 200 && r.json?.sent === true && rows('help.sent.app', 1).length === 2, r.status + ' ' + r.text);
r = await hit('POST', '/api/admin/help-mail/send', { email: 'unsub@example.com', topic: 'pass' }, ADMIN);
check('send by hand: an unsubscribed person is not sent anything', r.status === 409, r.status + ' ' + r.text);
r = await hit('POST', '/api/admin/help-mail/send', { email: 'nobody@example.com', topic: 'card' }, ADMIN);
check('send by hand: an unknown address is said so', r.status === 404, r.status + ' ' + r.text);

// ---- preview ----
r = await hit('GET', '/api/admin/help-mail/preview?topic=pass', undefined, ADMIN);
check('preview: the exact email with no sign-in link', r.status === 200 && r.json?.html?.includes('href="#preview"') && !/token=/.test(r.json.html) && r.json.subject === 'Your Free Visitor Pass: quick steps to get it', r.status + ' ' + (r.json?.subject || r.text.slice(0, 120)));
r = await hit('GET', '/api/admin/help-mail/preview?topic=card&email=rajib-test@example.com', undefined, ADMIN);
check('preview: for a named person, their name', r.status === 200 && r.json?.to === 'rajib-test@example.com' && r.json.html.includes('Rajib'), r.status + ' ' + r.text.slice(0, 120));
const tokensNow = q('SELECT COUNT(*) AS n FROM login_tokens')[0].n;
await hit('GET', '/api/admin/help-mail/preview?topic=app&email=asha@example.com', undefined, ADMIN);
check('preview: mints no sign-in link (it would cancel theirs)', q('SELECT COUNT(*) AS n FROM login_tokens')[0].n === tokensNow, '');

// ---- the admin card ----
r = await hit('GET', '/api/admin/help-stats');
check('help-stats: needs the admin', r.status === 401, r.status + '');
r = await hit('GET', '/api/admin/help-stats', undefined, ADMIN);
const st = r.json || {};
const by = Object.fromEntries((st.steps || []).map(s => [s.action, s.people]));
check('help-stats: people per step', r.status === 200 && by['card.open'] === 1 && by['card.photo_fail'] === 2 && by['app.boot_fail'] === 4 && by['login.link_refused'] === 1, JSON.stringify(by));
check('help-stats: still stuck leaves out the one who made it', (st.stuck || []).find(x => x.kind === 'card')?.n === 4, JSON.stringify(st.stuck));
check('help-stats: the reasons and the browsers', (st.reasons || []).some(x => x.why === 'There is no face in this photo') && (st.browsers || []).some(x => x.browser === 'Chrome 128 on Android 14'), JSON.stringify({ reasons: st.reasons, browsers: st.browsers }).slice(0, 300));
check('help-stats: unknown visitors, the people list and the switch', (st.visitors || []).some(x => x.action === 'app.boot_fail' && x.people === 1) && (st.recent || []).some(x => x.email === 'asha@example.com' && x.helped) && st.help?.on === true && !!st.since, JSON.stringify(st.help));
check('help-stats: what scanners did is left out of every count, and counted apart', by['app.boot_scan'] === undefined && by['app.boot_slow'] === 1 && by['app.boot_ok'] === 1 && by['card.open'] === 1 && st.scanners?.people === 3 && st.scanners?.visits === 3 && !!st.scanners?.last
  && !(st.recent || []).some(x => x.email === 'oldscan@example.com') && !(st.visitors || []).some(x => x.action === 'app.boot_scan') && !(st.reasons || []).some(x => x.why === 'opened by an email scanner'),
  JSON.stringify({ slow: by['app.boot_slow'], ok: by['app.boot_ok'], open: by['card.open'], scan: by['app.boot_scan'], scanners: st.scanners, visitors: st.visitors }));

// ---- the page ----
r = await hit('GET', '/app');
const v = (/\/app\.js\?v=([0-9a-f]{8})/.exec(r.text) || [])[1];
check('/app: carries the startup check, before the page code', r.text.includes('window.__bhaiBoot') && r.text.indexOf('window.__bhaiBoot') < r.text.indexOf('/app.js?v=') && r.text.includes('id="signin-note"'), '');
r = await hit('GET', '/app.js?v=' + v);
check('/app.js?v=<this version>: kept for a year', r.status === 200 && r.cache.includes('immutable') && r.text.includes('window.__bhaiBoot.start()'), r.cache);
r = await hit('GET', '/app.js?v=00000000');
check('/app.js?v=<another version>: answered, never kept', r.status === 200 && r.cache === 'no-store', r.cache);
r = await hit('GET', '/app.js');
check('/app.js bare: ten minutes, as before', r.cache.includes('max-age=600'), r.cache);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
