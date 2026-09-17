// Local harness on :8770 for browser-delegate.cjs: /app rendered by the built worker, canned /api with
// injection payloads (window.__xss* flags). Started automatically by run-all.mjs.
// Local harness: the real built /app page, static assets from public/, and a
// canned API. Payload strings carry script-injection attempts that set
// window.__xss* flags if they ever execute.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const worker = (await import(pathToFileURL(join(ROOT, 'dist', '_worker.js')).href + '?' + Date.now())).default;
const env = new Proxy({ ADMIN_SECRET: 'h', SESSION_SECRET: 'h' }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };

const USER = { id: 5, event_id: 1, name: 'Asha Rao', email: 'asha@example.com', company: 'Acme AI', job_title: 'CTO',
  badge_type: 'Delegate Pass', payment_status: 'paid', avatar_url: '', city: 'Mumbai', industry: 'Software & SaaS',
  mobile: '9999999999', networking_goals: 'hire', main_event: 1, bio: '', interests: 'ml,fintech' };
const PEOPLE = [
  { id: 9, event_id: 1, name: 'Ravi <img src=x onerror="window.__xss1=1">', company: 'Beta "Corp"', job_title: 'VP <b>Eng</b>',
    interests: 'ml,<img src=x onerror="window.__xss2=1">', bio: '<img src=x onerror="window.__xss6=1">bio', badge_type: 'Delegate Pass',
    linkedin_url: 'javascript:window.__xss7=1', avatar_url: '', city: 'Mumbai', industry: 'Software & SaaS' },
  { id: 10, event_id: 1, name: "Kiran O'Brien", company: 'Gamma', job_title: 'Founder', interests: 'fintech', bio: '', badge_type: 'VIP Pass', avatar_url: '' },
];
const THREADS = [{ id: 9, name: 'Ravi <img src=x onerror="window.__xss3=1">', company: 'Beta', avatar_url: '',
  last_content: 'hi <img src=x onerror="window.__xss4=1">', last_at: '2026-09-17 10:00:00', unread: 2 }];
const MSGS = [{ id: 1, sender_id: 9, receiver_id: 5, content: '<img src=x onerror="window.__xss5=1">hello there', created_at: '2026-09-17 10:00:00', is_read: 0 }];

const api = (method, path, url) => {
  const p = path;
  if (method === 'POST' && p === '/api/events/1/attendees/register') return USER;
  if (p === '/api/events/1') return { id: 1, name: 'Bharat AI Innovation 2026', start_date: '2026-11-20', end_date: '2026-11-21', venue: 'WTC Mumbai' };
  if (p === '/api/events/1/stats') return { attendees: null, sessions: 1 };
  if (p === '/api/events/1/sessions') return [{ id: 1, title: 'Keynote', start_time: '2099-11-20 10:00', end_time: '2099-11-20 11:00', hall: 'Homi J. Bhabha Hall', session_type: 'keynote' }];
  if (p === '/api/events/1/announcements') return [{ id: 1, title: 'Welcome <img src=x onerror="window.__xss8=1">', content: 'Doors open', created_at: '2026-09-17 10:00:00', pinned: 1 }];
  if (p === '/api/events/1/attendees') return { __headers: { 'X-Has-More': '0' }, body: PEOPLE };
  if (p === '/api/events/1/attendee-filters') return { industries: ['Software & SaaS'], cities: ['Mumbai'], roles: [], interests: [] };
  if (p === '/api/events/1/suggested-attendees') return [];
  if (p === '/api/attendees/5') return USER;
  if (p === '/api/attendees/9') return PEOPLE[0];
  if (p === '/api/attendees/10') return PEOPLE[1];
  if (p === '/api/attendees/5/dashboard') return { profile: USER, stats: { connectionsAccepted: 0, connectionsPending: 0, meetings: 0, messages: 0 }, connections: [], meetings: [], visitedBooths: [] };
  if (p === '/api/attendees/5/unread') return { count: 2 };
  if (p === '/api/attendees/5/threads') return THREADS;
  if (p === '/api/messages/5/9') return MSGS;
  if (method === 'POST' && p === '/api/messages') return { id: 2, success: true };
  if (p === '/api/attendees/5/main-event') return { main_event: 1, answered_at: null };
  if (p === '/api/attendees/5/certificate-eligibility') return { eligible: false, reason: 'Later' };
  if (p === '/api/attendees/5/panels') return [];
  if (method === 'GET') return [];
  return { success: true };
};

const TYPES = { '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:8770');
  try {
    if (url.pathname === '/app' || url.pathname === '/admin') {
      const r = await worker.fetch(new Request('https://bharataiinnovation.com' + url.pathname), env, ctx);
      res.writeHead(r.status, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(await r.text());
    }
    if (url.pathname.startsWith('/api/')) {
      let body = '';
      for await (const chunk of req) body += chunk;
      const out = api(req.method, url.pathname, url);
      const headers = { 'Content-Type': 'application/json', ...(out && out.__headers ? out.__headers : {}) };
      res.writeHead(200, headers);
      return res.end(JSON.stringify(out && out.__headers ? out.body : out));
    }
    const file = join(ROOT, 'public', decodeURIComponent(url.pathname));
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    return res.end(data);
  } catch (e) {
    res.writeHead(404); res.end('not found');
  }
}).listen(8770, () => console.log('harness on http://localhost:8770'));
