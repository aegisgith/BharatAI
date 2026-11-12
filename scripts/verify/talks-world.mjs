// A world for the Innovation Talks checks (12 Nov 2026): the WHOLE built worker on real
// SQLite (sql.js) with the production schema, migration 0050 (exhibitor teams) and,
// unless asked not to, migration 0052 (hall, speaker email and mobile). The 48 talks
// come from the repo's own scripts/sql/innovation-talks.sql, exactly as production got
// them. No email leaves: the mail service is answered here and kept in `sent`.
// Used by unit-, smoke-, and system-innovation-talks.mjs, and talks-harness.mjs.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');
const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

export const ADMIN = 'talks-admin';

export async function talksWorld({ with0052 = true, seedTalks = true, times = false } = {}) {
  const worker = (await import(new URL('dist/_worker.js?' + Date.now() + Math.random(), ROOT).href)).default;
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.exec(read('scripts/verify/prod-schema.sql'));
  db.exec(read('migrations/0050_exhibitor_team.sql'));
  if (with0052) db.exec(read('migrations/0052_innovation_talk_details.sql'));
  const clean = (a) => a.map(v => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
  const rows = (sql, args = []) => { const st = db.prepare(sql); st.bind(clean(args)); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; };
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
  const sent = [];
  let mailDown = false;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('elasticemail.com')) {
      if (mailDown) return new Response(JSON.stringify({ Error: 'service unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ MessageID: 'm' + sent.length }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const env = new Proxy({ ADMIN_SECRET: ADMIN, SESSION_SECRET: 'talks-session', MP_SESSION_SECRET: 'talks-mp', DB: D1 }, { get: (t, k) => (k in t ? t[k] : undefined) });
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const hit = async (method, path, body, headers = {}) => {
    const req = new Request('https://bharataiinnovation.com' + path, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const res = await worker.fetch(req, env, ctx);
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
    return { status: res.status, text, json };
  };
  const admin = { Authorization: 'Bearer ' + ADMIN };
  const as = (method, path, body) => hit(method, path, body, admin);

  db.run("INSERT INTO events (id, title, venue, start_date, end_date, status) VALUES (1, 'Bharat AI Innovation 2026', 'World Trade Center, Mumbai', '2026-11-20', '2026-11-21', 'upcoming')");
  db.run("INSERT INTO app_settings (key, value) VALUES ('elastic_email_api_key', 'test-key')");
  if (seedTalks) db.exec(read('scripts/sql/innovation-talks.sql'));
  if (times) db.exec(read('scripts/sql/innovation-talk-times.sql'));
  const talk = (where, ...a) => rows('SELECT * FROM innovation_talks WHERE ' + where, a)[0] || null;

  // Functions lifted from the page script this build serves (/admin.js or /app.js), run
  // on their own in a sandbox with the page's other names stubbed.
  const pageBlock = async (path, startMark, endMark) => {
    const js = (await hit('GET', path, undefined, path === '/admin.js' ? admin : {})).text;
    const a = js.indexOf(startMark), b = js.indexOf(endMark, a + 1);
    if (a < 0 || b < 0) throw new Error(path + ' has no block ' + startMark);
    return js.slice(a, b);
  };
  const adminTalkFunctions = async (extra = {}) => {
    const src = await pageBlock('/admin.js', '// ============ INNOVATION TALKS ============', '// ============ ADMIN STARTUP PITCH ============');
    const escH = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const box = vm.createContext({ Number, Math, String, Array, Object, JSON, Date, Promise, isNaN, escH, EID: 1, toast() {}, confirm: () => true, ...extra });
    vm.runInContext(src, box);
    return box;
  };

  const fetchRaw = (req) => worker.fetch(req, env, ctx);
  return { db, rows, talk, sent, hit, as, admin, env, fetchRaw, setMailDown: (v) => { mailDown = v; }, adminTalkFunctions, pageBlock, read };
}

// Checks, printed the way every suite in run-all.mjs prints them.
export function checker() {
  let fails = 0, passes = 0;
  const check = (n, ok, d) => {
    console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 400)));
    if (ok) passes++; else fails++;
  };
  const done = () => { console.log(`\n${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0); };
  return { check, done };
}
