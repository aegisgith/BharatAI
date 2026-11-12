// The world the enquiry-desk suites run in (12 Nov 2026): the built worker on real
// SQLite (sql.js) with the production schema, with or without 0053, the email service
// played and recorded, the clock movable, and the desk's own page script
// (public/js/admin-inquiries.js) loaded in node:vm for its pure parts.
// Import this before anything reads the clock.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const Real = Date;
let off = 0;
globalThis.Date = class extends Real {
  constructor(...a) { if (a.length) super(...a); else super(Real.now() + off); }
  static now() { return Real.now() + off; }
};
// at('2026-11-12', '10:00') is that time in India.
export const at = (day, hhmm) => { off = Real.parse(`${day}T${hhmm}:00+05:30`) - Real.now(); };
export const RealDate = Real;
at('2026-11-12', '10:00');

const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');
const worker = (await import(new URL('../../dist/_worker.js?' + Real.now(), import.meta.url).href)).default;
const SQL = await initSqlJs();

// The email service, played. One list for the process; suites empty it as they go.
export const mail = [];
let mailDown = false;
export const setMailDown = (v) => { mailDown = !!v; };
globalThis.fetch = async (url, init) => {
  if (String(url).includes('elasticemail.com')) {
    if (mailDown) return new Response(JSON.stringify({ Error: 'played: the email service is down' }), { status: 500 });
    mail.push(JSON.parse(init.body));
    return new Response('{}', { status: 200 });
  }
  throw new Error('no outside calls in this test: ' + url);
};
export const mailTo = (addr) => mail.filter((m) => (m.Recipients?.To || []).some((t) => String(t).toLowerCase().includes(String(addr).toLowerCase())));
export const bodyOf = (m) => m?.Content?.Body?.[0]?.Content || '';

const clean = (a) => a.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));

export function makeWorld({ pipeline = false } = {}) {
  const db = new SQL.Database();
  db.exec(readFileSync(new URL('./prod-schema.sql', import.meta.url), 'utf8'));
  if (pipeline) db.exec(readFileSync(new URL('../../migrations/0053_inquiry_pipeline.sql', import.meta.url), 'utf8'));
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
    async batch(list) { return list.map((s) => ({ results: s._rows(), meta: {} })); },
    async exec(sql) { db.exec(sql); return { count: 1 }; },
  };
  const env = new Proxy({ ADMIN_SECRET: 'iq-admin', SESSION_SECRET: 'iq-session', ELASTIC_EMAIL_API_KEY: 'played', DB: D1 }, { get: (t, k) => (k in t ? t[k] : undefined) });
  const pending = [];
  const ctx = { waitUntil(p) { pending.push(Promise.resolve(p).catch(() => {})); }, passThroughOnException() {} };
  const settle = async () => { while (pending.length) await pending.shift(); };
  db.run("INSERT INTO events (id, title, start_date, end_date) VALUES (1, 'Bharat AI Innovation 2026', '2026-11-20', '2026-11-21')");
  db.run("INSERT INTO app_settings (key, value) VALUES ('inquiry_notify_email', 'team@bharataiinnovation.com')");

  // One call to the worker. admin: true sends the shared password; actor names the
  // operator the way the panel does (X-Admin-Actor).
  const call = async (path, { method = 'GET', body, admin = false, actor, ip, headers = {} } = {}) => {
    const h = { ...headers };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (admin) h.Authorization = 'Bearer iq-admin';
    if (actor) h['X-Admin-Actor'] = actor;
    if (ip) h['CF-Connecting-IP'] = ip;
    const res = await worker.fetch(new Request('https://bharataiinnovation.com' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
    await settle();
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text };
  };
  const insert = (table, row) => {
    const cols = Object.keys(row);
    db.run(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, clean(cols.map((k) => row[k])));
    return db.exec('SELECT last_insert_rowid()')[0].values[0][0];
  };
  // SQLite's own clock format, for created_at in the past.
  const ago = (hours) => new Real(Date.now() - hours * 3600000).toISOString().slice(0, 19).replace('T', ' ');
  return { db, rows, call, insert, ago, env, ctx, settle, D1, worker };
}

// The desk's page script, run as the browser would, without a browser.
export function deskFunctions() {
  const code = readFileSync(new URL('../../public/js/admin-inquiries.js', import.meta.url), 'utf8');
  const sandbox = { URL, URLSearchParams, setTimeout, clearTimeout, console, Blob: class {} };
  sandbox.window = sandbox;
  sandbox.document = {};
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'admin-inquiries.js' });
  return sandbox.InqDesk._t;
}

let fails = 0, passes = 0;
export const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 600))); if (ok) passes++; else fails++; };
export const done = () => { console.log(`\n${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0); };
