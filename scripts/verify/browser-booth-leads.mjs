// The booth lead scanner (/exhibitor/scan, 13 Nov 2026) on a phone, end to end with the
// built worker and a real database (sql.js, production schema, 0050 + 0051 + 0062):
// the camera is a canvas showing a pass QR, read by jsQR as on an iPhone. One badge after
// another without leaving the page, the card over the camera, Hot and an interest saved
// as they are tapped, the same badge not reopened, a scan with no signal kept on the phone
// and sent when the signal returns, a colleague's pass saving nothing, and the list of
// this phone's scans surviving a reload. Run after `npm run build`:
//   node scripts/verify/browser-booth-leads.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sessionCookie } from './pay-db.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('./playwright.cjs');
const initSqlJs = require('sql.js');
const ROOT = new URL('../../', import.meta.url);
const worker = (await import(new URL('dist/_worker.js?' + Date.now(), ROOT).href)).default;

const SQL = await initSqlJs();
const db = new SQL.Database();
db.exec(readFileSync(new URL('scripts/verify/prod-schema.sql', ROOT), 'utf8'));
for (const m of ['0050_exhibitor_team.sql', '0051_leads_and_daily_checkins.sql', '0062_lead_tags.sql']) db.exec(readFileSync(new URL('migrations/' + m, ROOT), 'utf8'));
const clean = (a) => a.map(v => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
const rows = (sql, args) => { const st = db.prepare(sql); st.bind(args); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; };
const D1 = {
  prepare(sql) { let args = []; const s = {
    bind(...a) { args = clean(a); return s; },
    async first() { return rows(sql, args)[0] || null; },
    async all() { return { results: rows(sql, args) }; },
    async run() { db.run(sql, args); return { meta: { last_row_id: db.exec('SELECT last_insert_rowid()')[0].values[0][0], changes: db.getRowsModified() } }; },
  }; return s; },
  async batch(list) { return list.map(() => ({ results: [], meta: {} })); },
  async exec(sql) { db.exec(sql); return { count: 1 }; },
};
const SESSION = 'leads-session';
const env = new Proxy({ ADMIN_SECRET: 'leads-admin', SESSION_SECRET: SESSION, MP_SESSION_SECRET: 'leads-mp', DB: D1 }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctxw = { waitUntil() {}, passThroughOnException() {} };
const pass = (id) => id + '.' + crypto.createHmac('sha256', SESSION).update('pass:' + id).digest('hex').slice(0, 24);
const one = (sql, ...a) => rows(sql, clean(a))[0] || null;

db.run("INSERT INTO events (id, title, start_date, end_date) VALUES (1, 'Bharat AI', '2026-11-20', '2026-11-21')");
const person = (id, name, extra = {}) => {
  const row = { id, event_id: 1, name, email: 'p' + id + '@example.test', company: 'Co ' + id, job_title: 'Director', badge_type: 'Visitor Pass', payment_status: '', main_event: 1, ...extra };
  const cols = Object.keys(row);
  db.run(`INSERT INTO attendees (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, clean(cols.map(k => row[k])));
};
db.run("INSERT INTO exhibitors (id, event_id, company_name, contact_email, booth_number) VALUES (1, 1, 'Alpha AI', 'spoc@alpha.test', '21')");
person(10, 'Tara Team', { badge_type: 'Exhibitor', payment_status: 'waived' });
person(11, 'Colin Colleague', { badge_type: 'Exhibitor', payment_status: 'waived' });
person(20, 'Vik Visitor', { company: 'Buyer Bank', job_title: 'CTO' });
person(21, 'Dee Delegate', { company: 'Delta Labs', badge_type: 'Delegate Pass', payment_status: 'paid' });
db.run("INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, email, attendee_id, pass, pass_given) VALUES (1, 1, 'Tara', 'Team', 'p10@example.test', 10, 'Exhibitor', 'Exhibitor')");
db.run("INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, email, attendee_id, pass, pass_given) VALUES (1, 1, 'Colin', 'Colleague', 'p11@example.test', 11, 'Exhibitor', 'Exhibitor')");

let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const qrSrc = readFileSync(new URL('public/js/vendor/qrcode-generator.js', ROOT), 'utf8');
const ORIGIN = 'https://bharataiinnovation.com';
let noSignal = false;

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.route('**/*', async route => {
  const req = route.request(), u = new URL(req.url());
  if (u.origin !== ORIGIN) return route.fulfill({ status: 404, body: '' });
  if (u.pathname.startsWith('/js/')) return route.fulfill({ contentType: 'application/javascript', body: readFileSync(new URL('public' + u.pathname, ROOT), 'utf8') });
  if (u.pathname.startsWith('/api/') && noSignal) return route.abort('internetdisconnected');
  if (u.pathname === '/exhibitor/scan' || u.pathname.startsWith('/api/')) {
    const r = await worker.fetch(new Request(ORIGIN + u.pathname + u.search, { method: req.method(), headers: { 'Content-Type': 'application/json', Cookie: sessionCookie(SESSION, 10) }, body: req.method() === 'GET' ? undefined : req.postData() }), env, ctxw);
    return route.fulfill({ status: r.status, contentType: r.headers.get('content-type') || 'text/html', body: await r.text() });
  }
  return route.fulfill({ status: 404, body: '' });
});
// The camera: a canvas showing whichever QR window.__qr() was last given, as a stream.
await page.addInitScript(({ qrSrc }) => {
  eval(qrSrc);
  delete window.BarcodeDetector;
  const c = document.createElement('canvas'); c.width = 640; c.height = 480;
  const g = c.getContext('2d');
  let payload = '';
  const paint = () => {
    g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, 640, 480);
    if (payload) {
      const q = qrcode(0, 'M'); q.addData(payload); q.make();
      const n = q.getModuleCount(), cell = 7, margin = 4, size = (n + 2 * margin) * cell;
      const ox = Math.round((640 - size) / 2), oy = Math.round((480 - size) / 2);
      g.fillStyle = '#fff'; g.fillRect(ox, oy, size, size); g.fillStyle = '#000';
      for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) g.fillRect(ox + (k + margin) * cell, oy + (r + margin) * cell, cell, cell);
    }
    g.fillStyle = 'rgba(0,0,0,0.01)'; g.fillRect(0, 0, 2, 2);
  };
  window.__qr = (p) => { payload = p; paint(); };
  paint(); setInterval(paint, 100);
  const stream = c.captureStream(10);
  navigator.mediaDevices.getUserMedia = async () => stream;
}, { qrSrc });

const cardText = () => page.evaluate(() => { const c = document.getElementById('card'); return c && !c.hidden ? c.innerText : ''; });
const showQr = (id) => page.evaluate((p) => window.__qr(p), ORIGIN + '/verify/' + pass(id));
const blankQr = () => page.evaluate(() => window.__qr(''));

await page.goto(ORIGIN + '/exhibitor/scan', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.BhaiLeadScan, null, { timeout: 8000 });

// 1. A visitor's badge: the card comes up with their name, and the lead is saved.
await showQr(20);
await page.waitForFunction(() => /Saved to your leads/.test((document.getElementById('st') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
let t = await cardText();
check('a badge in front of the camera brings up the card with the visitor, saved at once', /Vik Visitor/.test(t) && /CTO · Buyer Bank/.test(t) && /Saved to your leads/.test(t) && !!one('SELECT id FROM exhibitor_leads WHERE attendee_id = 20'), t.slice(0, 200));
// A picture of the card, outside the repo, for a person to look at.
await page.screenshot({ path: join(tmpdir(), 'booth-leads-card.png') }).catch(() => {});

// 2. Hot and an interest are saved as they are tapped; the note when Done is tapped.
await page.tap('#card [data-r="hot"]');
await page.tap('#card [data-t="demo"]');
await page.fill('#n', 'Wants a pilot in January');
await page.waitForTimeout(600);
await page.tap('#next');
await page.waitForTimeout(800);
let lead = one('SELECT rating, tags, note FROM exhibitor_leads WHERE attendee_id = 20');
check('Hot, "Wants a demo" and the note are saved, and Done closes the card', lead && lead.rating === 'hot' && lead.tags === 'demo' && lead.note === 'Wants a pilot in January' && !(await cardText()), JSON.stringify(lead));

// 3. The same badge still in front of the camera does not open the card again at once.
await page.waitForTimeout(1500);
check('the badge just closed does not reopen the card', !(await cardText()), await cardText());

// 4. No signal: the next badge is kept on the phone and marked waiting.
await blankQr(); await page.waitForTimeout(400);
noSignal = true;
await showQr(21);
await page.waitForFunction(() => /kept on this phone/.test((document.getElementById('st') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
t = await cardText();
await page.tap('#card [data-r="warm"]');
await page.waitForTimeout(300);
const queued = await page.evaluate(() => window.BhaiLeadScan.queue());
const qText = await page.evaluate(() => document.getElementById('queue').innerText);
check('with no signal the scan is kept on the phone, the rating with it, and nothing reaches the server', /kept on this phone/.test(t) && queued.length === 1 && queued[0].fields.rating === 'warm' && /1 scan is waiting to send/.test(qText) && !one('SELECT id FROM exhibitor_leads WHERE attendee_id = 21'), JSON.stringify(queued) + ' ' + qText);
await page.tap('#next');
await blankQr();
const waitingRow = await page.evaluate(() => document.getElementById('recent').innerText);
check("this phone's list shows it waiting", /Waiting/.test(waitingRow), waitingRow);

// 5. The signal returns: it is sent, with the rating, and the name appears.
noSignal = false;
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await page.waitForFunction(() => /Dee Delegate/.test(document.getElementById('recent').innerText), null, { timeout: 8000 }).catch(() => {});
lead = one('SELECT rating FROM exhibitor_leads WHERE attendee_id = 21');
const after = await page.evaluate(() => ({ q: window.BhaiLeadScan.queue().length, list: document.getElementById('recent').innerText, box: document.getElementById('queue').hidden }));
check('when the signal returns the kept scan is sent with its rating and the name appears', lead && lead.rating === 'warm' && after.q === 0 && after.box === true && /Dee Delegate/.test(after.list), JSON.stringify(after) + ' ' + JSON.stringify(lead));

// 6. A colleague's pass: said so, nothing saved, no rating buttons.
await showQr(11);
await page.waitForFunction(() => /own team/.test((document.getElementById('st') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
t = await cardText();
const editHidden = await page.evaluate(() => document.getElementById('edit').hidden);
check("a colleague's pass says so and saves nothing", /own team/.test(t) && editHidden && !one('SELECT id FROM exhibitor_leads WHERE attendee_id = 11'), t.slice(0, 200));
await page.tap('#next');
await blankQr();

// 7. Fits a phone, and the list of this phone's scans survives a reload.
const wide = await page.evaluate(() => document.documentElement.scrollWidth);
check('no sideways scroll on a 390px phone', wide <= 390, wide);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.BhaiLeadScan, null, { timeout: 8000 });
const kept = await page.evaluate(() => document.getElementById('recent').innerText);
check("this phone's scans are still listed after a reload", /Vik Visitor/.test(kept) && /Dee Delegate/.test(kept) && /Hot/.test(kept), kept);
check('no script errors on the page', !errors.length, errors.join(' | '));

await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nAll booth lead scanner checks passed');
process.exit(fails ? 1 : 0);
