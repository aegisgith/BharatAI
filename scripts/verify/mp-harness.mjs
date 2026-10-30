// Harness on :8779 for mp-test.cjs: an exhibitor listing a product on the AI
// Marketplace, end to end, in a real browser. Started automatically by run-all.mjs.
// - /marketplace*, /api/mp/*, /app: the REAL built worker, with the stand-in D1 below.
// - the email service is played here; every message is kept for the test to read.
// - /api/__state, /api/__signin, /api/__session: the test's view of the state, a
//   sign-in link and a session cookie signed the way the worker signs them.
// - everything else: public/.
import http from 'node:http';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const worker = (await import(pathToFileURL(join(ROOT, 'dist', '_worker.js')).href + '?' + Date.now())).default;
// run-all.mjs hands over another port when :8779 is taken (another session's run).
const PORT = Number(process.env.HARNESS_PORT || 8779), BASE = 'http://localhost:' + PORT;
const MP_SECRET = 'h-mp-secret', ADMIN_SECRET = 'h-admin';

const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const hmac = (msg) => crypto.createHmac('sha256', MP_SECRET).update(msg).digest('hex');

// Company 7 is an exhibitor whose account was made from the booth record (no
// password), the way the invitation emails make them; booth B12 is confirmed.
const fresh = () => ({
  settings: {},
  companies: { 7: { id: 7, company_name: 'Daten Intelligenz', email: 'shishir@example.com', role: 'company', password_hash: '', exhibitor_id: 42, attendee_id: null, created_at: now() } },
  exhibitors: { 42: { id: 42, company_name: 'Daten Intelligenz', contact_email: 'shishir@example.com', booth_number: 'B12' } },
  listings: [], uploads: [], inquiries: [], audits: [], mail: [], sqls: [], nextId: 1,
});
let s = fresh();

const columnsOf = (sql) => { const m = /INSERT INTO \w+\s*\(([^)]+)\)/i.exec(sql); return m ? m[1].split(',').map(x => x.trim()) : []; };
const rowFrom = (sql, args) => Object.fromEntries(columnsOf(sql).map((c, i) => [c, args[i]]));
const meta = (last_row_id = 0, changes = 0) => ({ meta: { last_row_id, changes }, success: true, results: [] });
// The public catalogue joins the exhibitor row for the live booth number.
const pub = (l) => { const e = s.exhibitors[l.exhibitor_id]; return { ...l, exhibitor_company: e ? e.company_name : null, exhibitor_booth: e ? e.booth_number : null }; };
const withAccount = (l) => { const co = s.companies[l.company_id]; return { ...l, account_email: co ? co.email : null }; };

const DB = {
  prepare(sql) {
    let args = [];
    const q = sql.replace(/\s+/g, ' ').trim();
    const st = {
      bind(...a) { args = a; return st; },
      async first() {
        s.sqls.push(q);
        if (/FROM mp_companies WHERE id = \?/.test(q)) { const c = s.companies[args[0]]; return c ? { ...c } : null; }
        if (/FROM mp_companies WHERE lower\(email\) = /.test(q)) { const c = Object.values(s.companies).find(c => c.email.toLowerCase() === String(args[0]).toLowerCase()); return c ? { ...c } : null; }
        if (/SELECT value FROM app_settings WHERE key = \?/.test(q)) return args[0] in s.settings ? { value: s.settings[args[0]] } : null;
        if (/SELECT 1 AS hit FROM mp_listings WHERE company_id = \?/.test(q)) return s.listings.some(l => l.company_id === args[0]) ? { hit: 1 } : null;
        if (/SELECT company_id FROM mp_uploads WHERE id = \?/.test(q)) { const u = s.uploads.find(u => u.id === args[0]); return u ? { company_id: u.company_id } : null; }
        if (/SELECT data, content_type FROM mp_uploads WHERE id = \?/.test(q)) { const u = s.uploads.find(u => u.id === args[0]); return u ? { data: u.data, content_type: u.content_type } : null; }
        if (/SELECT id FROM mp_listings WHERE company_id = \? AND lower\(trim\(product_name\)\) = lower\(\?\)/.test(q)) { const l = s.listings.find(l => l.company_id === args[0] && String(l.product_name).trim().toLowerCase() === String(args[1]).toLowerCase()); return l ? { id: l.id } : null; }
        if (/SELECT id FROM mp_listings WHERE company_slug = \? AND product_slug = \? AND id != \?/.test(q)) { const l = s.listings.find(l => l.company_slug === args[0] && l.product_slug === args[1] && l.id !== args[2]); return l ? { id: l.id } : null; }
        if (/FROM exhibitors WHERE id = \?/.test(q)) { const e = s.exhibitors[args[0]]; return e ? { ...e } : null; }
        if (/FROM exhibitors WHERE trim\(ifnull\(contact_email/.test(q)) { const e = Object.values(s.exhibitors).find(e => e.contact_email.toLowerCase() === String(args[0]).trim().toLowerCase()); return e ? { ...e } : null; }
        if (/SELECT COUNT\(\*\) AS n FROM mp_listings WHERE status = 'pending'/.test(q)) return { n: s.listings.filter(l => l.status === 'pending').length };
        if (/SELECT COUNT\(\*\) as cnt FROM mp_listings WHERE company_id = \? AND status = \?/.test(q)) return { cnt: s.listings.filter(l => l.company_id === args[0] && l.status === args[1]).length };
        if (/SELECT COUNT\(\*\) as cnt FROM mp_listings WHERE company_id = \?/.test(q)) return { cnt: s.listings.filter(l => l.company_id === args[0]).length };
        if (/SELECT COALESCE\(SUM\(view_count\), 0\) as cnt FROM mp_listings/.test(q)) return { cnt: s.listings.filter(l => l.company_id === args[0]).reduce((a, l) => a + (l.view_count || 0), 0) };
        if (/SELECT COUNT\(\*\) as cnt FROM mp_inquiries/.test(q)) return { cnt: s.inquiries.length };
        if (/FROM mp_listings l LEFT JOIN exhibitors e .*WHERE l\.company_slug = \? AND l\.product_slug = \? AND l\.status = \?/.test(q)) { const l = s.listings.find(l => l.company_slug === args[0] && l.product_slug === args[1] && l.status === args[2]); return l ? pub(l) : null; }
        if (/FROM mp_listings l LEFT JOIN exhibitors e .*WHERE l\.id = \? AND l\.status = \?/.test(q)) { const l = s.listings.find(l => l.id === args[0] && l.status === args[1]); return l ? pub(l) : null; }
        if (/SELECT \* FROM mp_listings WHERE id = \? AND company_id = \?/.test(q)) { const l = s.listings.find(l => l.id === args[0] && l.company_id === args[1]); return l ? { ...l } : null; }
        if (/SELECT id, company_id, product_name FROM mp_listings WHERE id = \? AND status = \?/.test(q)) { const l = s.listings.find(l => l.id === args[0] && l.status === args[1]); return l ? { id: l.id, company_id: l.company_id, product_name: l.product_name } : null; }
        if (/SELECT l\.id, l\.status, l\.exhibitor_id, co\.id AS company_id/.test(q)) { const l = s.listings.find(l => l.id === args[0]); if (!l) return null; const co = s.companies[l.company_id]; return { id: l.id, status: l.status, exhibitor_id: l.exhibitor_id, company_id: co ? co.id : null, email: co ? co.email : null, company_exhibitor_id: co ? co.exhibitor_id : null }; }
        if (/SELECT l\.\*, co\.email AS account_email FROM mp_listings l JOIN mp_companies co/.test(q)) { const l = s.listings.find(l => l.id === args[0]); return l ? withAccount(l) : null; }
        if (/SELECT id FROM mp_inquiries WHERE listing_id = \?/.test(q)) return null;
        return null;
      },
      async all() {
        s.sqls.push(q);
        if (/FROM innovation_talks LIMIT 0/.test(q)) throw new Error('no such table: innovation_talks');   // no stage programme here
        if (/FROM mp_listings l LEFT JOIN exhibitors e .*WHERE l\.status = \?/.test(q)) return { results: s.listings.filter(l => l.status === args[0]).map(pub) };
        if (/FROM mp_listings l WHERE l\.company_id = \?/.test(q)) return { results: s.listings.filter(l => l.company_id === args[0]).map(l => ({ ...l, inquiry_count: s.inquiries.filter(i => i.listing_id === l.id).length, avg_rating: null })) };
        if (/FROM mp_listings l LEFT JOIN mp_companies co/.test(q)) return { results: s.listings.filter(l => !/WHERE l\.status = \?/.test(q) || l.status === args[0]).map(withAccount) };
        return { results: [] };
      },
      async run() {
        s.sqls.push(q);
        if (/^INSERT INTO mp_uploads/.test(q)) { const row = rowFrom(q, args); row.id = s.nextId++; row.created_at = now(); s.uploads.push(row); return meta(row.id, 1); }
        if (/^INSERT INTO mp_listings/.test(q)) { const row = rowFrom(q, args); row.id = s.nextId++; row.view_count = 0; row.created_at = now(); row.updated_at = now(); s.listings.push(row); return meta(row.id, 1); }
        if (/^INSERT INTO mp_inquiries/.test(q)) { const row = rowFrom(q, args); row.id = s.nextId++; row.created_at = now(); s.inquiries.push(row); return meta(row.id, 1); }
        if (/^INSERT INTO admin_audit/.test(q)) { s.audits.push({ actor: args[0], action: args[2], entity: args[3], entity_id: args[4], detail: args[5] }); return meta(s.audits.length, 1); }
        if (/^UPDATE mp_listings SET view_count = view_count \+ 1 WHERE id = \?/.test(q)) { const l = s.listings.find(l => l.id === args[0]); if (l) l.view_count = (l.view_count || 0) + 1; return meta(0, l ? 1 : 0); }
        const up = /^UPDATE mp_listings SET (.+) WHERE id = \?$/.exec(q);
        if (up) {
          let i = 0; const sets = up[1].split(', ').map(p => p.split(' = '));
          const id = args[sets.filter(([, v]) => v === '?').length];
          const l = s.listings.find(l => l.id === id); if (!l) return meta(0, 0);
          for (const [col, v] of sets) { if (v === '?') l[col] = args[i++]; else if (v === 'CURRENT_TIMESTAMP') l[col] = now(); }
          return meta(0, 1);
        }
        if (/^UPDATE mp_companies SET exhibitor_id = \? WHERE id = \?/.test(q)) { const c = s.companies[args[1]]; if (c) c.exhibitor_id = args[0]; return meta(0, c ? 1 : 0); }
        return meta(0, 0);
      },
    };
    return st;
  },
  batch: (stmts) => Promise.all(stmts.map(st => st.run())),
};

const env = () => new Proxy({ ADMIN_SECRET, SESSION_SECRET: 'h-session', MP_SESSION_SECRET: MP_SECRET, DB, ELASTIC_EMAIL_API_KEY: 'h-mail' }, { get: (t, k) => (k in t ? t[k] : undefined) });

// The email service, played here: every message the worker sends is kept for the test.
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, init) => {
  if (String(u).includes('api.elasticemail.com')) {
    const b = JSON.parse(init.body);
    s.mail.push({ to: b.Recipients.To[0], subject: b.Content.Subject, html: b.Content.Body[0].Content });
    return new Response(JSON.stringify({ TransactionID: 'h' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return realFetch(u, init);
};
// Mail goes out through waitUntil after the response; the test waits for it.
const pending = new Set();
const ctx = { waitUntil(p) { const t = Promise.resolve(p).catch(() => {}).finally(() => pending.delete(t)); pending.add(t); }, passThroughOnException() {} };

// A sign-in link and a session cookie, signed as routes/marketplace.ts signs them.
const signInLink = (id) => {
  const co = s.companies[id];
  const exp = Math.floor(Date.now() / 1000) + 7 * 86400;
  const fp = hmac('mplink-pw:' + String(co.password_hash || '')).slice(0, 16);
  return `${BASE}/marketplace/signin?t=${id}.${exp}.${fp}.${hmac(`mplink:${id}.${exp}.${fp}`)}`;
};
const sessionCookie = (id) => `${id}.${hmac(String(id))}`;

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain' };
const WORKER = (p) => p === '/app' || p === '/marketplace' || p.startsWith('/marketplace/') || p.startsWith('/api/mp/');

http.createServer(async (req, res) => {
  const url = new URL(req.url, BASE);
  const p = url.pathname;
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  try {
    if (p === '/api/__state') {
      if (req.method === 'POST') { const b = JSON.parse(raw.toString() || '{}'); if (b.reset) s = fresh(); Object.assign(s.settings, b.settings || {}); }
      await Promise.all([...pending]);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ listings: s.listings, uploads: s.uploads.map(u => ({ id: u.id, company_id: u.company_id, content_type: u.content_type, size: u.size })), inquiries: s.inquiries, audits: s.audits, mail: s.mail, companies: s.companies }));
    }
    if (p === '/api/__signin') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ url: signInLink(Number(url.searchParams.get('company') || 7)) })); }
    if (p === '/api/__session') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ cookie: sessionCookie(Number(url.searchParams.get('company') || 7)) })); }
    if (WORKER(p)) {
      const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
      const r = await worker.fetch(new Request(BASE + req.url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : raw, redirect: 'manual' }), env(), ctx);
      const out = {}; r.headers.forEach((v, k) => { if (k !== 'content-encoding') out[k] = v; });
      const setCookie = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
      if (setCookie.length) out['set-cookie'] = setCookie.map(c => c.replace(/;\s*Secure/i, ''));   // http://localhost
      res.writeHead(r.status, out);
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    const file = join(ROOT, 'public', p === '/' ? 'index.html' : p.replace(/\?.*$/, ''));
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    if (e && e.code === 'ENOENT') { res.writeHead(404); return res.end('not found'); }
    res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end(String(e && e.stack || e));
  }
}).listen(PORT, () => console.log('mp-harness on ' + BASE));
