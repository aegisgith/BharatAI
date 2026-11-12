// Admin -> Conference (12 Nov 2026), the world its tests run in: the WHOLE built
// worker (dist/_worker.js) on real SQLite (sql.js) with the production schema, an
// in-memory photo bucket, and the mail service answered here so nothing leaves.
// Migration 0054 is NOT applied until applyMigration() is called, so the tests see
// both sides of it. Used by smoke-conference.mjs and conference-harness.mjs.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(import.meta.url);

export async function makeWorld({ seed = 'small', migrated = false } = {}) {
  const initSqlJs = require('sql.js');
  const worker = (await import(pathToFileURL(join(ROOT, 'dist', '_worker.js')).href + '?' + Date.now() + Math.random())).default;
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.exec(readFileSync(join(ROOT, 'scripts', 'verify', 'prod-schema.sql'), 'utf8'));

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
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('elasticemail.com')) {
      const body = init && init.body;
      let parsed = {};
      try { parsed = typeof body === 'string' ? JSON.parse(body) : Object.fromEntries(new URLSearchParams(String(body))); } catch { parsed = { raw: String(body) }; }
      sent.push(parsed);
      return new Response(JSON.stringify({ success: true, data: { messageid: 'm' + sent.length }, MessageID: 'm' + sent.length }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  // An R2 stand-in: what was put, and what was deleted.
  const bucket = new Map();
  const UPLOADS = {
    async put(key, bytes, opts) { bucket.set(key, { bytes, type: opts?.httpMetadata?.contentType }); },
    async get(key) {
      const o = bucket.get(key); if (!o) return null;
      return { body: o.bytes, httpEtag: '"e"', writeHttpMetadata(h) { h.set('content-type', o.type || 'application/octet-stream'); } };
    },
    async delete(key) { bucket.delete(key); },
  };
  const envBase = { ADMIN_SECRET: 'h-admin', SESSION_SECRET: 'h', MP_SESSION_SECRET: 'h-mp', DB: D1, UPLOADS };
  const env = new Proxy(envBase, { get: (t, k) => (k in t ? t[k] : undefined) });
  const ctx = { waitUntil() {}, passThroughOnException() {} };

  const applyMigration = () => db.exec(readFileSync(join(ROOT, 'migrations', '0054_conference_manager.sql'), 'utf8'));

  // ---- the seed ----
  db.run("INSERT INTO events (id, title, venue, start_date, end_date, status) VALUES (1, 'Bharat AI Innovation 2026', 'World Trade Center, Mumbai', '2026-11-20', '2026-11-21', 'upcoming')");
  db.run("INSERT INTO app_settings (key, value) VALUES ('elastic_email_api_key', 'test-key')");
  if (seed === 'real') {
    // The real line-up and the real agenda, as the organiser's SQL files write them.
    db.exec(readFileSync(join(ROOT, 'migrations', '0033_speakers.sql'), 'utf8'));
    db.exec(readFileSync(join(ROOT, 'scripts', 'sql', 'schedule.sql'), 'utf8'));
  } else {
    const sp = (id, slug, name, role, org, extra = {}) => db.run(
      'INSERT INTO speakers (id, event_id, slug, name, role, organisation, email, is_published, sort_order) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)',
      [id, slug, name, role, org, extra.email || null, extra.pub === 0 ? 0 : 1, id]);
    sp(1, 'k-k-singh', 'Shri. K.K. Singh', 'Joint Secretary, MeitY', 'Ministry of Electronics & Information Technology, Govt of India', { email: 'kk@example.test' });
    sp(2, 'tarun-chugh', 'Tarun Chugh', 'MD & CEO', 'Bajaj Life Insurance');
    sp(3, 'shailesh-dhuri', 'Shailesh Dhuri', 'Chief Executive Officer', 'Decimal Point Analytics', { email: 'shailesh@example.test' });
    sp(4, 'saurabh-n-mehta', 'Dr. Saurabh N. Mehta', 'Director', 'Somewhere Institute');
    sp(5, 'nilesh-shah', 'Nilesh Shah', 'Managing Director', 'Kotak Mahindra Asset Management Co. Ltd', { pub: 0 });
    const ss = (title, speaker, title2, type, room, start, end) => db.run(
      'INSERT INTO sessions (event_id, title, speaker_name, speaker_title, session_type, room, start_time, end_time, capacity) VALUES (1, ?, ?, ?, ?, ?, ?, ?, 1000)',
      [title, speaker, title2, type, room, start, end]);
    ss('Keynote', 'Shri K.K. Singh', 'Joint Secretary, MeitY, Government of India', 'keynote', 'Homi J. Bhabha Hall', '2026-11-20 10:50', '2026-11-20 11:00');
    ss('AI Democratizing and Driving Financial Inclusion', 'Tarun Chugh (Bajaj Life Insurance), Ratan Kumar Kesh (Bandhan Bank), Shailesh Dhuri (Moderator)', null, 'panel', 'Homi J. Bhabha Hall', '2026-11-20 14:00', '2026-11-20 15:00');
    ss('Networking Lunch', null, null, 'break', 'Homi J. Bhabha Hall', '2026-11-20 13:00', '2026-11-20 14:00');
    ss('AI in Education', 'Dr. Saurabh N. Mehta (Somewhere Institute)', null, 'talk', 'Aryabhata Theatre', '2026-11-21 11:00', '2026-11-21 11:30');
    // A delegate registered under a speaker's email: their pass.
    db.run("INSERT INTO attendees (event_id, name, email, badge_type, payment_status, main_event) VALUES (1, 'Shailesh Dhuri', 'shailesh@example.test', 'Speaker', 'waived', 1)");
  }
  if (migrated) applyMigration();

  async function call(method, path, body, { admin = true, headers = {} } = {}) {
    const h = { ...(admin ? { Authorization: 'Bearer h-admin', 'X-Admin-Actor': 'Harness' } : {}), ...headers };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const r = await worker.fetch(new Request('https://bharataiinnovation.com' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text, headers: r.headers };
  }
  return { worker, db, env, ctx, rows, sent, bucket, applyMigration, call, D1 };
}
