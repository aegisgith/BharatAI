// The built worker on real SQLite (sql.js) loaded with the production schema,
// with Elastic Email played here and every message kept, for the sign-in link
// suites (4 Nov 2026): unit-login-tokens.mjs, system-email-links.mjs and
// login-harness.mjs. The same stand-in D1 the other smoke suites carry inline.
// Run after `npm run build`.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { sessionCookie } from './pay-db.mjs';

const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');

export const ADMIN_SECRET = 'smoke-admin', SESSION_SECRET = 'smoke-session', CRON_SECRET = 'smoke-cron';
export const ADMIN = { Authorization: 'Bearer ' + ADMIN_SECRET };
export const CRON = { Authorization: 'Bearer ' + CRON_SECRET };
export const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
export const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const hex = () => crypto.randomBytes(32).toString('hex');
export const settle = (ms = 60) => new Promise(r => setTimeout(r, ms));

export async function makeWorld({ appUrl = 'https://bharataiinnovation.com/app' } = {}) {
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
  const env = new Proxy({ ADMIN_SECRET, SESSION_SECRET, CRON_SECRET, ELASTIC_EMAIL_API_KEY: 'smoke-key', DB: D1 }, { get: (t, k) => (k in t ? t[k] : undefined) });
  const ctx = { waitUntil() {}, passThroughOnException() {} };

  // Elastic Email answers yes; every message is kept for the test to read.
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('elasticemail.com')) {
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ MessageID: 'm' + sent.length }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(url, init);
  };

  const hit = async (method, path, body, headers = {}, cf) => {
    const req = new Request('https://bharataiinnovation.com' + path, {
      method, redirect: 'manual', headers: { 'Content-Type': 'application/json', 'User-Agent': ANDROID, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (cf) Object.defineProperty(req, 'cf', { value: cf });
    const res = await worker.fetch(req, env, ctx);
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
    return { status: res.status, text, json, headers: res.headers };
  };
  const q = (sql, ...a) => { const st = db.prepare(sql); st.bind(clean(a)); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; };
  const rows = (action, id) => q("SELECT * FROM admin_audit WHERE action = ?" + (id == null ? '' : " AND entity_id = '" + id + "'") + ' ORDER BY id', action);
  const as = (id) => ({ Cookie: sessionCookie(SESSION_SECRET, id) });

  db.run("INSERT INTO events (id, title, start_date, end_date) VALUES (1, 'Bharat AI', '2026-11-20', '2026-11-21')");
  db.run("INSERT INTO app_settings (key, value) VALUES ('app_url', ?)", [appUrl]);
  // The clock's other jobs are off, so a tick sends the two automatic emails alone.
  db.run("INSERT INTO app_settings (key, value) VALUES ('pay_remind_auto', 'off'), ('help_mail_auto', 'off')");

  // What an email carries: its sign-in tokens (one per email, every button the
  // same), and a 6-digit code when it shows one.
  const to = (p) => (p?.Recipients?.To || [])[0] || '';
  const html = (p) => p?.Content?.Body?.[0]?.Content || '';
  const tokensIn = (p) => [...new Set([...html(p).matchAll(/token=([0-9a-f]{64})/g)].map(m => m[1]))];
  const codeIn = (p) => (html(p).match(/>\s*(\d{6})\s*</) || [])[1] || '';
  const subject = (p) => p?.Content?.Subject || '';

  return { worker, db, D1, env, ctx, sent, hit, q, rows, as, to, html, tokensIn, codeIn, subject };
}

export function checker() {
  let fails = 0;
  const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
  return { check, fails: () => fails };
}
