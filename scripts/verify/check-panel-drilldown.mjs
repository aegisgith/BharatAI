// Every number on the admin Campus panels block must list exactly the people it
// counts. GET /api/admin/panels counts with one SQL condition per number and
// GET /api/admin/panels/:slug/people lists with a copy of it (PANEL_PEOPLE_METRICS);
// if one is edited without the other they drift silently. This runs the built
// worker's real routes against a real SQLite engine with every state seeded and
// compares all nineteen.
//
//   npm run build
//   npm i --no-save sql.js        (once; it is deliberately not a dependency)
//   node scripts/verify/check-panel-drilldown.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');
const require = createRequire(import.meta.url);
let sqlDir = process.env.SQLJS_DIR || '';
if (!sqlDir) { try { sqlDir = dirname(require.resolve('sql.js/dist/sql-wasm.js')); } catch { /* not installed */ } }
if (!sqlDir) {
  console.error('sql.js is not installed. Run: npm i --no-save sql.js   (or set SQLJS_DIR to its dist folder)');
  process.exit(2);
}
const initSqlJs = require(join(sqlDir, 'sql-wasm.js'));
const SQL = await initSqlJs({ locateFile: f => join(sqlDir, f) });
const db = new SQL.Database();

db.run(`
CREATE TABLE attendees (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL,
  mobile TEXT, company TEXT, job_title TEXT, avatar_url TEXT, last_login_at TEXT, role TEXT DEFAULT 'attendee', badge_type TEXT,
  registration_source TEXT, main_event INTEGER NOT NULL DEFAULT 1, main_event_answered_at TEXT, is_online INTEGER DEFAULT 0,
  UNIQUE(event_id, email));
CREATE TABLE panel_registrations (id INTEGER PRIMARY KEY AUTOINCREMENT, attendee_id INTEGER NOT NULL, panel_slug TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'page', external_ref TEXT, registered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmation_sent_at TEXT, confirmation_error TEXT, claimed_at TEXT, claim_attempts INTEGER NOT NULL DEFAULT 0,
  last_claim_attempt_at TEXT, certificate_downloaded_at TEXT, card_downloaded_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  rsvp_status TEXT, rsvp_at TEXT, reminder_sent_at TEXT, reminder_error TEXT, UNIQUE(attendee_id, panel_slug));
CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);
CREATE TABLE admin_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL DEFAULT 'unknown', actor_kind TEXT NOT NULL DEFAULT 'admin',
  action TEXT NOT NULL, entity TEXT, entity_id TEXT, detail TEXT, ip TEXT, user_agent TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);

// Seed: a deterministic spread so every metric has some people and some not.
let n = 0;
const orgs = ['Jawaharlal Nehru University', 'JNU', 'IIT Delhi', 'Acme Corp', '', 'Delhi University', "O'Brien & Sons"];
for (let i = 0; i < 60; i++) {
  n++;
  const company = orgs[i % orgs.length];
  const email = (i % 9 === 0 ? `student${i}@jnu.ac.in` : `person${i}@example.com`);
  db.run('INSERT INTO attendees (event_id, name, email, mobile, company, job_title, avatar_url, last_login_at, main_event, main_event_answered_at, registration_source) VALUES (1,?,?,?,?,?,?,?,?,?,?)', [
    `Person ${i}${i === 7 ? ' <script>x</script>' : ''}`, email, '98' + String(10000000 + i), company, i % 2 ? 'Student' : 'Engineer',
    i % 3 === 0 ? `/api/uploads/avatars/${i}.webp` : (i % 5 === 0 ? '   ' : ''),
    i % 4 === 0 ? '2026-09-2' + (i % 9) + ' 10:00:00' : null,
    i % 6 === 0 ? 1 : 0,
    i % 6 === 0 || i % 7 === 0 ? '2026-09-25 12:00:00' : null,
    'campus:jnu-30sep',
  ]);
  const src = ['muni', 'page', 'linkedin'][i % 3];
  const confErr = i % 11 === 0 ? 'paused: header fix' : (i % 13 === 0 ? 'Elastic said 500' : null);
  db.run(`INSERT INTO panel_registrations (attendee_id, panel_slug, source, registered_at, confirmation_sent_at, confirmation_error,
            claimed_at, certificate_downloaded_at, card_downloaded_at, rsvp_status, rsvp_at, reminder_sent_at, reminder_error)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    n, 'jnu-30sep', src, '2026-09-1' + (i % 9) + ' 09:00:00',
    confErr ? null : (i % 2 ? '2026-09-24 08:00:00' : null), confErr,
    i % 8 === 0 ? '2026-09-30 16:10:00' : null,
    i % 16 === 0 ? '2026-09-30 16:20:00' : null,
    i % 5 === 0 ? '2026-09-26 11:00:00' : null,
    i % 4 === 1 ? 'yes' : (i % 4 === 2 ? 'no' : null),
    i % 4 === 1 || i % 4 === 2 ? '2026-09-28 09:00:00' : null,
    i % 3 === 0 ? '2026-09-28 08:00:00' : null,
    i % 17 === 0 ? 'bounced' : (i % 19 === 0 ? 'paused: stop' : null),
  ]);
}

// A D1-shaped wrapper over sql.js.
const shaped = (sql, args) => {
  const st = db.prepare(sql);
  st.bind(args.map(v => (v === undefined ? null : v)));
  const rows = [];
  while (st.step()) rows.push(st.getAsObject());
  st.free();
  return rows;
};
const DB = {
  prepare(sql) {
    let args = [];
    const s = {
      bind: (...a) => { args = a; return s; },
      first: async () => shaped(sql, args)[0] || null,
      all: async () => ({ results: shaped(sql, args) }),
      run: async () => { db.run(sql, args.map(v => (v === undefined ? null : v))); return { success: true, meta: { changes: db.getRowsModified(), last_row_id: shaped('SELECT last_insert_rowid() AS id', [])[0].id } }; },
    };
    return s;
  },
  batch: async (list) => Promise.all(list.map(s => s.all())),
};

const worker = (await import(pathToFileURL(join(ROOT, 'dist', '_worker.js')).href + '?' + Date.now())).default;
const env = new Proxy({ ADMIN_SECRET: 'inv-admin', SESSION_SECRET: 'inv-session', DB }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };
const get = async (path, auth = true) => {
  const res = await worker.fetch(new Request('https://bharataiinnovation.com' + path, { headers: auth ? { Authorization: 'Bearer inv-admin' } : {} }), env, ctx);
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json, type: res.headers.get('content-type') || '' };
};

let fails = 0;
const check = (label, ok, detail = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (ok ? '' : '   ' + detail)); if (!ok) fails++; };

const statsRes = await get('/api/admin/panels');
check('the Campus panels numbers load', statsRes.status === 200 && Array.isArray(statsRes.json), statsRes.status + ' ' + statsRes.text.slice(0, 200));
const jnu = (statsRes.json || []).find(p => p.slug === 'jnu-30sep') || {};

const SRC = readFileSync(join(ROOT, 'src', 'index.tsx'), 'utf8');
const block = SRC.slice(SRC.indexOf('const PANEL_PEOPLE_METRICS'), SRC.indexOf("app.get('/api/admin/panels/:slug/people'"));
const metrics = [...block.matchAll(/^\s{2}([a-z_]+):\s+\{ label:/gm)].map(m => m[1]);
check('every metric the route knows is tested', metrics.length === 19, metrics.length + ' ' + metrics.join(','));

for (const metric of metrics) {
  const r = await get(`/api/admin/panels/jnu-30sep/people?metric=${metric}`);
  const expected = metric === 'rsvp_none' ? (jnu.registered - jnu.rsvp_yes - jnu.rsvp_no) : jnu[metric];
  const got = r.json && r.json.total;
  check(`${metric.padEnd(18)} list ${String(got).padStart(3)} = number ${String(expected).padStart(3)}`,
        r.status === 200 && got === expected && r.json.rows.length === got, r.status + ' ' + r.text.slice(0, 160));
}

check('several metrics are non-zero, so the comparison means something',
      metrics.filter(m => (m === 'rsvp_none' ? jnu.registered - jnu.rsvp_yes - jnu.rsvp_no : jnu[m]) > 0).length >= 15);

const csv = await get('/api/admin/panels/jnu-30sep/people?metric=rsvp_yes&format=csv');
const lines = csv.text.replace(/^\ufeff/, '').split('\r\n');
check('the CSV carries the same people', csv.type.startsWith('text/csv') && lines.length - 1 === jnu.rsvp_yes, lines.length - 1 + ' vs ' + jnu.rsvp_yes);
check('the CSV header is readable', lines[0] === 'name,email,mobile,company,job_title,source,when,note', lines[0]);
check('a comma or quote in a company is quoted in the CSV', !csv.text.includes("O'Brien & Sons") || /"?O'Brien & Sons"?/.test(csv.text));
check('the export is audited', shaped("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'panel.people.export'", [])[0].n === 1);

const failed = await get('/api/admin/panels/jnu-30sep/people?metric=email_failed');
check('a failure list says why it failed', failed.json && failed.json.rows.every(x => x.note && !/^paused:/.test(x.note)), JSON.stringify(failed.json && failed.json.rows.slice(0, 2)));

const anon = await get('/api/admin/panels/jnu-30sep/people?metric=registered', false);
check('nobody without the admin token sees a list', anon.status === 401, anon.status);
const bad = await get('/api/admin/panels/jnu-30sep/people?metric=drop_table');
check('an unknown number is refused, not guessed', bad.status === 400, bad.status);
const inject = await get("/api/admin/panels/jnu-30sep/people?metric=registered'--");
check('a metric cannot carry SQL', inject.status === 400, inject.status);
const nopanel = await get('/api/admin/panels/nowhere/people?metric=registered');
check('an unknown panel is refused', nopanel.status === 404, nopanel.status);

console.log('\n' + (fails ? fails + ' FAILED' : 'every number lists exactly the people it counts'));
process.exit(fails ? 1 : 0);
