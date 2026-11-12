// A speaker's own talk page (12 Nov 2026), the world its tests run in: the WHOLE built
// worker on real SQLite with the production schema and, unless asked not to, 0052;
// an in-memory photo bucket; mail answered here. Two talks: an exhibitor's speaker
// with nothing filled in, and an organisers' talk with a time and a hall.
// Used by smoke-talk-self.mjs and talk-self-harness.mjs.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(import.meta.url);

// The module's own signer, so a test makes links exactly as the server does.
export async function tokenMaker() {
  const out = await build({ entryPoints: [join(ROOT, 'src', 'routes', 'talk-self.ts')], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent', mainFields: ['module', 'main'] });
  return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
}

export async function makeWorld({ with0052 = true } = {}) {
  const initSqlJs = require('sql.js');
  const worker = (await import(pathToFileURL(join(ROOT, 'dist', '_worker.js')).href + '?' + Date.now() + Math.random())).default;
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.exec(readFileSync(join(ROOT, 'scripts', 'verify', 'prod-schema.sql'), 'utf8'));
  if (with0052) db.exec(readFileSync(join(ROOT, 'migrations', '0052_innovation_talk_details.sql'), 'utf8'));
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
    if (String(url).includes('elasticemail.com')) { try { sent.push(JSON.parse(init.body)); } catch { sent.push({ raw: String(init && init.body) }); } return new Response(JSON.stringify({ MessageID: 'm' + sent.length }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const bucket = new Map();
  const UPLOADS = {
    async put(key, bytes, opts) { bucket.set(key, { bytes, type: opts?.httpMetadata?.contentType }); },
    async get(key) { const o = bucket.get(key); if (!o) return null; return { body: o.bytes, httpEtag: '"e"', writeHttpMetadata(h) { h.set('content-type', o.type || 'application/octet-stream'); } }; },
    async delete(key) { bucket.delete(key); },
  };
  const env = new Proxy({ ADMIN_SECRET: 'h-admin', SESSION_SECRET: 'h', MP_SESSION_SECRET: 'h-mp', DB: D1, UPLOADS }, { get: (t, k) => (k in t ? t[k] : undefined) });
  const ctx = { waitUntil() {}, passThroughOnException() {} };

  db.run("INSERT INTO events (id, title, venue, start_date, end_date, status) VALUES (1, 'Bharat AI Innovation 2026', 'World Trade Center, Mumbai', '2026-11-20', '2026-11-21', 'upcoming')");
  db.run("INSERT INTO app_settings (key, value) VALUES ('elastic_email_api_key', 'test-key')");
  db.run("INSERT INTO innovation_talks (id, event_id, speaker_name, company, topic, time_slot, status, notes) VALUES (7, 1, 'Sushil Sani', 'Trust3 AI', 'Trust3AI Security Governance', 'To be announced', 'confirmed', 'Team only: chase via Sandeep')");
  db.run("INSERT INTO innovation_talks (id, event_id, speaker_name, company, topic, speaker_title, time_slot, starts_at, status) VALUES (8, 1, 'Dr. Vishal Deo', 'ICMR-NIRDH', 'PrAImaan', 'Scientist-C', 'Fri 20 Nov · 17:30 – 17:45', '2026-11-20 17:30', 'confirmed')");
  if (with0052) {
    db.run("UPDATE innovation_talks SET speaker_email = 'sushil@trust3.ai', details_requested_to = 'ashwini@trust3.ai' WHERE id = 7");
    db.run("UPDATE innovation_talks SET hall = 'Homi J. Bhabha Hall' WHERE id = 8");
    // A third speaker with an address and nothing sent yet: the next automatic email.
    db.run("INSERT INTO innovation_talks (id, event_id, speaker_name, company, topic, time_slot, status, speaker_email) VALUES (9, 1, 'Asha Rao', 'Example Labs', '', 'To be announced', 'confirmed', 'asha@example.test')");
  }

  async function call(method, path, body, { headers = {} } = {}) {
    const h = { ...headers };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const r = await worker.fetch(new Request('https://bharataiinnovation.com' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text, headers: r.headers };
  }
  return { worker, db, env, ctx, rows, sent, bucket, call };
}
