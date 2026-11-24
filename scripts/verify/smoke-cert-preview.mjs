// Certificate preview in Admin (23 Nov 2026), on the built worker with real SQLite (sql.js),
// the production schema and this process's clock moved to the event days:
//  - Admin -> Workshop Seats marks every seat holder: "ready" (the app gives them the
//    workshop certificate), "not_there" (no check-in at the venue on the workshop day) or
//    "not_over" (the workshop has not ended);
//  - each mark agrees with the attendee's own GET /api/attendees/:id/certificate-eligibility,
//    which Admin's preview also reads (with the admin token);
//  - the marks are for Admin only;
//  - the drawing lives in /js/cert-render.js, loaded by /app and /admin, and the app no
//    longer carries its own copy.
// Run after `npm run build`:  node scripts/verify/smoke-cert-preview.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const Real = Date;
let off = 0;
globalThis.Date = class extends Real {
  constructor(...a) { if (a.length) super(...a); else super(Real.now() + off); }
  static now() { return Real.now() + off; }
};
const at = (day, hhmm) => { off = Real.parse(`${day}T${hhmm}:00+05:30`) - Real.now(); };
at('2026-11-21', '11:00');

const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');
const worker = (await import(new URL('../../dist/_worker.js?' + Real.now(), import.meta.url).href)).default;
const SQL = await initSqlJs();
const db = new SQL.Database();
db.exec(readFileSync(new URL('./prod-schema.sql', import.meta.url), 'utf8'));
db.exec(readFileSync(new URL('../../migrations/0051_leads_and_daily_checkins.sql', import.meta.url), 'utf8'));
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
const SESSION = 'smoke-session', ADMIN = 'smoke-admin';
const env = new Proxy({ ADMIN_SECRET: ADMIN, SESSION_SECRET: SESSION, DB: D1 }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };
const hit = async (method, path, body, headers = {}) => {
  const req = new Request('https://bharataiinnovation.com' + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await worker.fetch(req, env, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
};
const admin = { Authorization: 'Bearer ' + ADMIN };
const { sessionCookie } = await import('./pay-db.mjs');
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 300))); if (!ok) fails++; };

// Mumbai's three workshops: two on Friday, one on Saturday.
db.run("INSERT INTO events (id, title, start_date, end_date) VALUES (1, 'Bharat AI', '2026-11-20', '2026-11-21')");
db.run(`INSERT INTO workshops (id, event_id, slug, title, speaker, starts_at, ends_at) VALUES
  (2, 1, 'fde', 'From Prototype to Production', 'Dr. Ashish Tendulkar', '2026-11-20 14:00', '2026-11-20 15:30'),
  (3, 1, 'llm', 'LLM Fine-Tuning, Hands-On', 'Virendra Pal', '2026-11-21 10:30', '2026-11-21 12:00'),
  (5, 1, 'ibm', 'AI, Trust and Evolving Skills using IBM Bob', 'KrishnaKanth Naik', '2026-11-20 11:30', '2026-11-20 13:00')`);
// id, seat, check-in days (checkins rows), first arrival (attendees.checked_in_at, UTC)
const people = [
  [1, 3, ['2026-11-20', '2026-11-21'], '2026-11-20 04:30:00'],  // Saturday seat, in both days
  [2, 3, ['2026-11-20'], '2026-11-20 04:30:00'],                // Saturday seat, Friday only
  [3, 2, ['2026-11-20'], '2026-11-20 04:30:00'],                // Friday seat, in Friday
  [4, 5, [], null],                                            // never came
  [5, null, ['2026-11-21'], '2026-11-21 04:30:00'],             // no seat
  [6, 3, [], '2026-11-21 04:30:00'],                            // admitted before the day table: first arrival on Saturday
  [7, 2, [], '2026-11-19 20:00:00'],                            // 1:30 am Friday in India, a UTC Thursday
];
for (const [id, seat, days, first] of people) {
  db.run("INSERT INTO attendees (id, event_id, name, email, badge_type, payment_status, main_event, checked_in_at) VALUES (?, 1, ?, ?, 'VIP Pass', 'paid', 1, ?)", [id, 'Person ' + id, 'p' + id + '@example.test', first]);
  if (seat) db.run('INSERT INTO workshop_seats (event_id, attendee_id, workshop_id) VALUES (1, ?, ?)', [id, seat]);
  for (const d of days) db.run('INSERT INTO checkins (event_id, attendee_id, day, checked_in_at) VALUES (1, ?, ?, ?)', [id, d, d + ' 04:30:00']);
}
const marks = async () => {
  const r = await hit('GET', '/api/admin/workshops', undefined, admin);
  return Object.fromEntries((r.json?.seats || []).map(s => [s.id, s.cert]));
};
const mine = async (id) => (await hit('GET', '/api/attendees/' + id + '/certificate-eligibility', undefined, { Cookie: sessionCookie(SESSION, id) })).json;

// ---- Saturday 11:00, the Saturday workshop still running ----
let m = await marks();
check('Saturday 11:00: the Saturday workshop is "not_over" for its seat holders', m[1] === 'not_over' && m[2] === 'not_over' && m[6] === 'not_over', m);
check('Saturday 11:00: Friday workshops are over: in on Friday "ready", never came "not_there"', m[3] === 'ready' && m[4] === 'not_there', m);
check('a first arrival at 1:30 am Friday India time (a UTC Thursday) counts as Friday', m[7] === 'ready', m);
check('no seat, no mark', !(5 in m), m);

// ---- Saturday 12:30, everything over ----
at('2026-11-21', '12:30');
m = await marks();
check('Saturday 12:30: in on Saturday "ready", in on Friday only "not_there"', m[1] === 'ready' && m[2] === 'not_there', m);
check('admitted before the day table, first arrival on Saturday: "ready"', m[6] === 'ready', m);
let agree = true; const seen = [];
for (const id of [1, 2, 3, 4, 6, 7]) {
  const own = await mine(id);
  const viaAdmin = (await hit('GET', '/api/attendees/' + id + '/certificate-eligibility', undefined, admin)).json;
  const same = !!own?.workshop && own.workshop.eligible === (m[id] === 'ready') && JSON.stringify(own) === JSON.stringify(viaAdmin);
  seen.push(id + ':' + m[id] + '/' + own?.workshop?.eligible + (same ? '' : ' DIFFERS'));
  if (!same) agree = false;
}
check("every mark agrees with the attendee's own answer, and Admin's preview reads that same answer", agree, seen.join(', '));
const s2 = await mine(2);
check('the person not there is told why (the words the preview quotes)', /checked in at the venue on the day of the workshop/.test(s2.workshop.reason || ''), s2.workshop);
const s5 = await mine(5);
check('no seat: the conference certificate only (workshop null)', s5.eligible === true && s5.workshop === null, s5);

// ---- Admin only ----
let r = await hit('GET', '/api/admin/workshops');
check('the marks need the admin token', r.status === 401 || r.status === 403, r.status);
r = await hit('GET', '/api/attendees/1/certificate-eligibility', undefined, { Cookie: sessionCookie(SESSION, 2) });
check("an attendee cannot read another person's certificate", r.status === 401 || r.status === 403, r.status);

// ---- one drawing, loaded by both pages ----
const page = async (p) => (await hit('GET', p, undefined, p.startsWith('/admin') ? admin : {})).text;
const appHtml = await page('/app'), adminHtml = await page('/admin');
const appJs = await page('/app.js' + ((appHtml.match(/\/app\.js(\?v=[a-z0-9]+)/) || [])[1] || ''));
const adminJs = await page('/admin.js' + ((adminHtml.match(/\/admin\.js(\?v=[a-z0-9]+)/) || [])[1] || ''));
check('/app and /admin both load /js/cert-render.js', /src="\/js\/cert-render\.js\?v=\w+"/.test(appHtml) && /src="\/js\/cert-render\.js\?v=\w+"/.test(adminHtml), '');
// (The campus-panel certificate, generatePanelCertificate, is a different drawing and stays.)
check('the app draws with BhaiCert and keeps no copy of its own', /BhaiCert\.draw\(/.test(appJs) && !/for taking part in the workshop/.test(appJs) && !/BHAI-WS-/.test(appJs), '');
check('Admin has the sample, the person view and the Workshop Seats marks', /function adminCertSample/.test(adminJs) && /function adminCertFor/.test(adminJs) && /Gets it in the app/.test(adminJs) && /onclick="adminCertFor\(/.test(adminJs) && /Preview certificate/.test(adminJs), '');
const renderer = readFileSync(new URL('../../public/js/cert-render.js', import.meta.url), 'utf8');
const sandbox = { window: {} }; sandbox.window.window = sandbox.window;
vm.runInNewContext(renderer, sandbox);
check('cert-render.js defines BhaiCert.draw and BhaiCert.filename', typeof sandbox.window.BhaiCert?.draw === 'function' && sandbox.window.BhaiCert.filename(true) === 'BharatAI-2026-Workshop-Certificate.png' && sandbox.window.BhaiCert.filename(false) === 'BharatAI-2026-Certificate.png', '');
// 24 Nov 2026, the organiser: every certificate carries the Aegis School of Data Science and AI
// logo and is signed by two people, the facilitator and the Dean.
const BC = sandbox.window.BhaiCert || {};
const fac = BC.facilitator ? BC.facilitator('Dr. Ashish Tendulkar, PhD, IIT Bombay; Google AI') : null;
check('signed by the facilitator (the workshop speaker, name before the first comma) and the Dean', BC.DEAN?.name === 'Dr. Abhijit Gangopadhyay' && BC.DEAN?.role === 'Dean' && BC.DEAN?.org === 'Aegis School of Data Science and AI' && fac?.name === 'Dr. Ashish Tendulkar' && fac?.role === 'Workshop Facilitator' && fac?.org === 'PhD, IIT Bombay · Google AI' && BC.facilitator('') === null && BC.COMMITTEE?.name === 'Organizing Committee' && /signoff\(ctx, W, 905, \[\(ws && facilitator\(ws\.speaker\)\) \|\| COMMITTEE, DEAN\]\)/.test(renderer), JSON.stringify(fac));
check('the Aegis logo is on the workshop, conference and campus-panel certificates, and the panel one is signed twice', /images\/passes\/aegis\.png/.test(renderer) && /loadImage\('\/images\/passes\/aegis\.png'\)/.test(appJs) && /BhaiCert\.signoff\(ctx, W, 890, \[BhaiCert\.COMMITTEE, BhaiCert\.DEAN\]/.test(appJs), '');

console.log(fails ? `\n${fails} FAILED` : '\nAll certificate preview checks passed');
process.exit(fails ? 1 : 0);
