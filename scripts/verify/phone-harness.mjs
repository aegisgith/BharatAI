// Local harness on :8772 for phone-test.cjs. Started automatically by run-all.mjs.
// Phone verification harness on :8772.
// - /app, /admin: rendered by the built worker.
// - /panel-rsvp: the REAL worker routes, with a stand-in D1 that records writes.
// - /api/*: canned answers driven by a mutable state (POST /api/__state).
// - everything else: public/.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const worker = (await import(pathToFileURL(join(ROOT, 'dist', '_worker.js')).href + '?' + Date.now())).default;

const PANEL = {
  slug: 'djsanghvi-21sep', title: 'AI and Employability — Opportunities, Challenges and the Future of Work', titleShort: 'AI and Employability',
  subtitle: 'Opportunities, Challenges & the Future of Work', host: 'Dwarkadas J. Sanghvi College of Engineering', hostShort: 'DJ Sanghvi', city: 'Mumbai',
  dateLabel: 'Monday, 21 September 2026', dateShort: 'Monday, 21 Sep 2026', timeLabel: '11:00 AM – 12:30 PM IST', venue: 'On campus, Vile Parle (West), Mumbai',
  pageUrl: 'https://bharataiinnovation.com/campus-djsanghvi', hostLogo: '/images/campus/djsanghvi-logo.png',
  speakers: [{ name: 'Dr. Hari Vasudevan' }, { name: 'Dr. Ashish Tendulkar' }, { name: 'Bhupesh Daheria' }, { name: 'Nida Parkar' }, { name: 'Virendra Pal' }],
  hashtags: '#BharatAIInnovation #CampusSeries', source: 'muni', claim_state: 'before', ended: false,
  rsvp_enabled: true, rsvp_open: true, rsvp_status: null, claimed_at: null,
};
const freshState = () => ({
  user: { id: 5, event_id: 1, name: 'Riya Shah', email: 'riya@gmail.com', company: 'Dwarkadas J. Sanghvi College of Engineering', job_title: 'Student',
    badge_type: 'Visitor Pass', payment_status: 'paid', avatar_url: '', industry: 'Education & Academia', interests: 'ml', networking_goals: 'learn', city: 'Mumbai', mobile: '9876543210' },
  panels: [{ ...PANEL }], mainEvent: 1, records: [], dbWrites: [],
});
let state = freshState();

// Stand-in D1 for the real /panel-rsvp routes.
const DB = {
  prepare(sql) {
    let args = [];
    const st = {
      bind(...a) { args = a; return st; },
      async first() {
        if (/SELECT company, email FROM attendees WHERE id = \?/.test(sql)) return { company: 'Tech Mahindra', email: 'guest@techm.com' };
        if (/SELECT value FROM app_settings/.test(sql)) return args[0] === 'app_url' ? { value: 'http://localhost:8772/app' } : null;
        return null;
      },
      async all() { return { results: [] }; },
      async run() {
        if (/UPDATE panel_registrations SET rsvp_status/.test(sql)) state.dbWrites.push({ answer: args[0], attendee: args[1], panel: args[2] });
        return { meta: { changes: 1 } };
      },
    };
    return st;
  },
  async batch(l) { return Promise.all(l.map(s => s.all())); },
};
const env = new Proxy({ ADMIN_SECRET: 'h-admin', SESSION_SECRET: 'h-secret', DB }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };

const api = (method, p, body) => {
  const rec = (what) => state.records.push({ method, path: p, body, what });
  if (p === '/api/__state') { if (method === 'POST') { if (body && body.reset) state = freshState(); Object.assign(state, body && body.set || {}); } return state; }
  if (method === 'POST' && p === '/api/events/1/attendees/register') return state.user;
  if (p === '/api/events/1') return {"id": 1, "title": "Bharat AI Innovation 2026", "description": "India's largest AI conference and exhibition bringing together 60+ speakers, 100+ exhibitors, and thousands of AI professionals. Two days of intensive learning, networking, and collaboration across 10+ focused tracks covering Generative AI, Healthcare AI, FinTech AI, Manufacturing AI, AgriTech, and more.", "event_type": "conference", "venue": "World Trade Center, Mumbai", "start_date": "2026-11-20", "end_date": "2026-11-21", "banner_url": null, "status": "upcoming", "max_attendees": 5000, "created_at": "2026-03-05 11:50:17"};
  if (p === '/api/events/1/sessions') return [{ id: 1, title: 'Keynote', start_time: '2099-11-20 10:00', end_time: '2099-11-20 11:00', hall: 'Homi J. Bhabha Hall', session_type: 'keynote' }];
  if (p === '/api/events/1/attendees') {
    if (/visitor/i.test(state.user.badge_type)) return { __headers: { 'X-Has-More': '0', 'X-Directory-Limited': '1' }, body: [
      { id: 9, name: 'Arjun Mehta', company: 'Fintech Co', job_title: 'Founder & CEO', badge_type: 'Delegate Pass', interests: 'fintech', limited: 1, view_token: 'tok9tok9tok9tok9tok9tok9' },
      { locked: 1, job_title: 'Director', industry: 'Healthcare' }, { locked: 1, job_title: 'CTO', industry: 'Software & SaaS' }] };
    return { __headers: { 'X-Has-More': '0' }, body: [{ id: 9, name: 'Arjun Mehta', company: 'Fintech Co', job_title: 'Founder & CEO', badge_type: 'Delegate Pass', interests: 'fintech', linkedin_url: 'https://linkedin.com/in/a' }] };
  }
  if (p === '/api/events/1/attendee-filters') return { industries: ['Fintech'], cities: ['Mumbai'], roles: [], interests: [] };
  if (p === '/api/attendees/5') return state.user;
  if (p === '/api/attendees/5/dashboard') return { profile: state.user, stats: { connectionsAccepted: 0, connectionsPending: 0, meetingsUpcoming: 0, meetingsPending: 0, totalMessages: 0, boothVisits: 0 }, recentConnections: [], upcomingMeetings: [], visitedBooths: [] };
  if (p === '/api/attendees/5/unread') return { count: 0 };
  if (p === '/api/attendees/5/panels') return state.panels;
  if (p === '/api/attendees/5/main-event') { if (method === 'POST') { rec('main-event'); state.mainEvent = body.answer === 'yes' ? 1 : 0; return { main_event: state.mainEvent }; } return { main_event: state.mainEvent, answered_at: null }; }
  if (method === 'POST' && /^\/api\/attendees\/5\/panels\/[^/]+\/rsvp$/.test(p)) { rec('panel-answer'); state.panels[0].rsvp_status = body.answer; return { success: true, rsvp_status: body.answer }; }
  if (method === 'POST' && /^\/api\/attendees\/5\/panels\/[^/]+\/track$/.test(p)) { rec('panel-track'); return { success: true }; }
  if (method === 'POST' && p === '/api/attendees/5/avatar') { rec('avatar'); state.user.avatar_url = '/api/uploads/avatars/5.webp'; return { success: true, avatar_url: state.user.avatar_url }; }
  if (p === '/api/attendees/5/certificate-eligibility') return { eligible: false, reason: 'Later' };
  if (p === '/api/my-pass-token') return { token: 'passtoken' };
  if (method === 'POST' && /track-(social-card|pass-download)$/.test(p)) { rec('track'); return { success: true }; }
  if (p === '/api/admin/verify') return { ok: true };
  if (p === '/api/events/1/stats') return {"attendees": 1601, "attendees_withheld": true, "online": 1, "checkedIn": null, "sessions": 85, "exhibitors": 21, "connections": 17, "categories": 15, "passDownloaded": null, "cardDownloaded": null};
  if (p === '/api/admin/events/1/analytics') return { attendeesByRole: [], attendeesByBadge: [], sessionsByType: [], sessionsByTrack: [], connectionsByStatus: [], meetingsByStatus: [], topExhibitors: [], topNominees: [], messageCount: 0, boothVisitCount: 0, exhibitorsByCategory: [], recentRegistrations: [] };
  if (p === '/api/admin/events/1/lunch-stats') return { totalAttendees: 1601, totalLunchEligible: 54, withArrivalTime: 47, arrivingBeforeLunch: 40, arrivingAfterLunch: 7, noArrivalTimeLunch: 14, estimatedLunchPacks: 54, notifiedCount: 3, loggedInCount: 521, loggedInAfterNotifyCount: 1, passDownloadedCount: 510, timeSlots: [], rsvpConfirmed: 0, rsvpDeclined: 0, rsvpMaybe: 0, rsvpNoResponse: 1601 };
  if (p === '/api/admin/analytics/audience') return { total: 1601, seniority: [], industries: [], companies: [], cities: [], sources: [], campus_total: 413 };
  if (p === '/api/admin/whoami') return { authenticated: true, name: 'Harness Admin', username: 'harness', role: 'admin' };
  if (p === '/api/admin/panels') return [{ slug: 'djsanghvi-21sep', hostShort: 'DJ Sanghvi', title: 'AI and Employability', dateLabel: 'Monday, 21 September 2026', claim_state: 'before', claim_code_set: true,
    rsvp_enabled: true, rsvp_open: true, registered: 431, via_muni: 270, via_page: 3, emailed: 431, email_failed: 0, email_paused: 0, with_photo: 10, signed_in: 37, card_taken: 3, claimed: 0, certificate_taken: 0,
    rsvp_yes: 12, rsvp_no: 3, rsvp_yes_outside: 4, reminded: 0, reminder_failed: 0, reminder_paused: 0, reminder_left: 416 }];
  if (method === 'POST' && p === '/api/admin/panels/djsanghvi-21sep/send-next-reminders') { rec('send-reminders'); return { done: true, sent: 5, failed: [], remaining: 0 }; }
  if (p === '/api/admin/panels/djsanghvi-21sep/answers.csv') { rec('answers-csv'); return { __csv: 'name,email,coming\r\nGuest,g@x.com,yes' }; }
  if (method === 'GET') return p.startsWith('/api/admin/') ? {} : [];
  return { success: true };
};

const TYPES = { '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:8772');
  try {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    if (url.pathname === '/app' || url.pathname === '/admin' || url.pathname === '/panel-rsvp') {
      const init = { method: req.method, headers: { 'Content-Type': req.headers['content-type'] || '' } };
      if (req.method === 'POST') init.body = raw;
      const r = await worker.fetch(new Request('https://bharataiinnovation.com' + url.pathname + url.search, init), env, ctx);
      res.writeHead(r.status, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(await r.text());
    }
    if (url.pathname.startsWith('/api/uploads/')) {
      const img = await readFile(join(ROOT, 'public', 'images', 'speaker-nida-parkar.webp'));
      res.writeHead(200, { 'Content-Type': 'image/webp' });
      return res.end(img);
    }
    if (url.pathname.startsWith('/api/')) {
      let body = null; try { body = raw ? JSON.parse(raw) : null; } catch {}
      const out = api(req.method, url.pathname, body);
      if (out && out.__csv) { res.writeHead(200, { 'Content-Type': 'text/csv' }); return res.end(out.__csv); }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Expose-Headers': 'X-Has-More, X-Directory-Limited', ...(out && out.__headers ? out.__headers : {}) });
      return res.end(JSON.stringify(out && out.__headers ? out.body : out));
    }
    const file = join(ROOT, 'public', decodeURIComponent(url.pathname));
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    return res.end(data);
  } catch (e) {
    res.writeHead(404); res.end('not found');
  }
}).listen(8772, () => console.log('phone harness on http://localhost:8772'));
