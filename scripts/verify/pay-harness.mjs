// Harness on :8776 for pay-test.cjs: buying a pass, end to end, in a real browser.
// Started automatically by run-all.mjs.
// - /app, /admin, /register, /finance, /pay/*, /api/payments/*, the payments queues:
//   the REAL built worker, with the stand-in D1 from pay-db.mjs.
// - registration and the rest of /api/*: canned answers over the same state.
// - the gateway itself is played by the test (it intercepts secure.ccavenue.com,
//   and counts any request to municampus.com, which must stay at zero).
// - everything else: public/.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SECRETS, makePayDb, sessionCookie } from './pay-db.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const worker = (await import(pathToFileURL(join(ROOT, 'dist', '_worker.js')).href + '?' + Date.now())).default;
const PORT = 8776, BASE = 'http://localhost:' + PORT, SESSION = 'h-secret';
const PAID = ['Delegate Pass', 'VIP Pass', 'Academic Pass'];

let db;
const fresh = () => {
  db = makePayDb();
  db.state.settings.app_url = BASE + '/app';   // so the gateway is told to come back here
  db.state.inquiries = [];
  db.state.nextId = 100;
  db.state.staff[3] = { id: 3, name: 'Finance Person', username: 'fin', active: 1, role: 'finance' };
};
fresh();
const env = () => new Proxy({ ADMIN_SECRET: 'h-admin', SESSION_SECRET: SESSION, DB: db.DB, ...SECRETS }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };

const REAL = (p) => p === '/app' || p === '/admin' || p === '/register' || p === '/finance' || p.startsWith('/pay/') || p.startsWith('/api/payments/')
  || p === '/api/admin/payments-pending' || p === '/api/admin/invoices' || p === '/api/finance/payments-pending' || p === '/api/finance/invoices';

const sessionId = (cookie) => { const m = /bai_session=(\d+)\./.exec(cookie || ''); return m ? Number(m[1]) : null; };

const api = (method, p, body, req) => {
  const s = db.state;
  if (p === '/api/__state') {
    if (method === 'POST') {
      if (body.reset) fresh();
      Object.assign(db.state.settings, body.settings || {});
      for (const k of body.unset || []) delete db.state.settings[k];
      for (const a of body.people || []) db.person(a.id, a);
    }
    return { orders: db.state.orders, attendees: db.state.attendees, inquiries: db.state.inquiries, settings: db.state.settings, audits: db.state.audits };
  }
  if (method === 'POST' && p === '/api/events/1/attendees/register') {
    const email = String(body.email || '').trim().toLowerCase();
    let a = Object.values(s.attendees).find(x => x.email === email);
    let status = 200;
    if (a && sessionId(req.headers.cookie) !== a.id) {
      return { __status: 403, body: { error: 'verification_required', message: 'That email is already registered. Please sign in with the link or code we email you.' } };
    }
    if (!a) {
      const badge = body.badge_type || 'Visitor Pass';
      a = db.person(s.nextId++, { name: body.name, email, company: body.company || '', job_title: body.job_title || '', mobile: body.mobile || '', city: body.city || '',
        badge_type: badge, payment_status: PAID.includes(badge) ? 'pending' : 'paid', main_event: 1 });
      status = 201;
    }
    return { __status: status, __headers: { 'Set-Cookie': sessionCookie(SESSION, a.id) + '; Path=/; HttpOnly; SameSite=Lax' }, body: a };
  }
  if (method === 'POST' && p === '/api/inquiries') { s.inquiries.push(body); return { success: true, id: s.inquiries.length }; }
  const who = /^\/api\/attendees\/(\d+)(\/.*)?$/.exec(p);
  if (who) {
    const a = s.attendees[Number(who[1])] || null, rest = who[2] || '';
    if (!rest) return a || { __status: 404, body: { error: 'Attendee not found' } };
    if (rest === '/dashboard') return { profile: a, stats: { connectionsAccepted: 0, connectionsPending: 0, meetingsUpcoming: 0, meetingsPending: 0, totalMessages: 0, boothVisits: 0 }, recentConnections: [], upcomingMeetings: [], visitedBooths: [] };
    if (rest === '/unread') return { count: 0 };
    if (rest === '/main-event') return { main_event: 1, answered_at: null };
    if (rest === '/certificate-eligibility') return { eligible: false, reason: 'Later' };
    if (method === 'GET') return [];
    return { success: true };
  }
  if (p === '/api/events/1') return { id: 1, title: 'Bharat AI Innovation 2026', description: 'Conference and exhibition.', event_type: 'conference', venue: 'World Trade Center, Mumbai', start_date: '2026-11-20', end_date: '2026-11-21', banner_url: null, status: 'upcoming', max_attendees: 5000, created_at: '2026-03-05 11:50:17' };
  if (p === '/api/events/1/stats') return { attendees: null, attendees_withheld: true, online: 1, checkedIn: null, sessions: 85, exhibitors: 21, connections: 17, categories: 15, passDownloaded: null, cardDownloaded: null };
  if (p === '/api/events/1/sessions') return [{ id: 1, title: 'Keynote', start_time: '2099-11-20 10:00', end_time: '2099-11-20 11:00', hall: 'Homi J. Bhabha Hall', session_type: 'keynote' }];
  if (p === '/api/events/1/attendees') return { __headers: { 'X-Has-More': '0' }, body: [] };
  if (p === '/api/events/1/attendee-filters') return { industries: [], cities: [], roles: [], interests: [] };
  if (p === '/api/admin/verify') return { ok: true };
  if (p === '/api/admin/whoami') return { authenticated: true, name: 'Harness Admin', username: 'harness', role: 'admin' };
  if (p === '/api/admin/events/1/analytics') return { attendeesByRole: [], attendeesByBadge: [], sessionsByType: [], sessionsByTrack: [], connectionsByStatus: [], meetingsByStatus: [], topExhibitors: [], topNominees: [], messageCount: 0, boothVisitCount: 0, exhibitorsByCategory: [], recentRegistrations: [] };
  if (p === '/api/admin/events/1/lunch-stats') return { totalAttendees: 0, totalLunchEligible: 0, withArrivalTime: 0, arrivingBeforeLunch: 0, arrivingAfterLunch: 0, noArrivalTimeLunch: 0, estimatedLunchPacks: 0, notifiedCount: 0, loggedInCount: 0, loggedInAfterNotifyCount: 0, passDownloadedCount: 0, timeSlots: [], rsvpConfirmed: 0, rsvpDeclined: 0, rsvpMaybe: 0, rsvpNoResponse: 0 };
  if (p === '/api/admin/analytics/audience') return { total: 0, seniority: [], industries: [], companies: [], cities: [], sources: [], campus_total: 0 };
  if (method === 'GET') return [];
  return { success: true };
};

const TYPES = { '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, BASE);
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    if (REAL(url.pathname)) {
      const headers = {};
      for (const k of ['cookie', 'content-type', 'authorization', 'user-agent']) if (req.headers[k]) headers[k] = req.headers[k];
      const r = await worker.fetch(new Request(BASE + url.pathname + url.search, {
        method: req.method, headers, redirect: 'manual', body: ['GET', 'HEAD'].includes(req.method) ? undefined : raw,
      }), env(), ctx);
      const out = {};
      r.headers.forEach((v, k) => { out[k] = v; });
      res.writeHead(r.status, out);
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    if (url.pathname.startsWith('/api/')) {
      let body = {};
      try { body = raw.length ? JSON.parse(raw.toString('utf8')) : {}; } catch { body = {}; }
      const out = api(req.method, url.pathname, body, req);
      const wrapped = out && (out.__headers || out.__status);
      res.writeHead((out && out.__status) || 200, { 'Content-Type': 'application/json', ...(out && out.__headers ? out.__headers : {}) });
      return res.end(JSON.stringify(wrapped ? out.body : out));
    }
    const file = join(ROOT, 'public', decodeURIComponent(url.pathname));
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    return res.end(data);
  } catch (e) {
    res.writeHead(404); res.end('not found');
  }
}).listen(PORT, () => console.log('harness on ' + BASE));
