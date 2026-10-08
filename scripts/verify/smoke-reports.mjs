// Built-worker checks for the Campus Series insights reports: the gated PDF, the
// /insights form, the "your reports" email, the admin pump and the numbers.
// Run after `npm run build`:  node scripts/verify/smoke-reports.mjs
// D1, Pages' static files and Elastic Email are all played by this file.
import crypto from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
const worker = (await import(new URL('../../dist/_worker.js?' + Date.now(), import.meta.url).href)).default;
const SECRET = 'smoke-session';
const DJ = 'djsce-ai-and-employability-insights-report.pdf';
const JNU = 'jnu-ai-and-employability-insights-report.pdf';
const state = { table: true, ipCount: 0, rowId: 42, rowSent: null, sqls: [], binds: [], pending: [], assets: [], mails: [], waits: [] };
const stmt = (sql) => {
  let args = [];
  const s = {
    bind(...a) { args = a; return s; },
    async first() {
      state.sqls.push(sql); state.binds.push(args);
      if (/SELECT id FROM report_downloads LIMIT 1/.test(sql)) { if (!state.table) throw new Error('no such table: report_downloads'); return null; }
      if (/COUNT\(\*\) AS n FROM report_downloads WHERE ip/.test(sql)) return { n: state.ipCount };
      if (/SELECT id, main_event FROM attendees/.test(sql)) return args[0] === 'reg@example.com' ? { id: 7, main_event: 1 } : null;
      if (/SELECT id, email_sent_at FROM report_downloads/.test(sql)) return { id: state.rowId, email_sent_at: state.rowSent };
      if (/COUNT\(\*\) AS n FROM panel_registrations pr JOIN attendees a ON a.id = pr.attendee_id\s+LEFT JOIN report_downloads/.test(sql)) return { n: state.pending.length };
      if (/AS reports_sent/.test(sql)) return { reports_sent: 3, reports_failed: 1, reports_paused: 0, reports_opened: 2, reports_left: state.pending.length, reports_suppressed: 1 };
      if (/AS asked_on_page/.test(sql)) return { people: 5, asked_on_page: 3, emailed: 4, email_failed: 1, opened: 2, downloads: 6, said_yes_to_updates: 2 };
      if (/SELECT value FROM app_settings/.test(sql)) return null;
      if (/AS registered/.test(sql)) return { registered: 2 };
      return null;
    },
    async all() {
      state.sqls.push(sql); state.binds.push(args);
      if (/PRAGMA table_info\(attendees\)/.test(sql)) return { results: ['id', 'email', 'name', 'main_event', 'unsubscribed_at', 'marketing_consent'].map(name => ({ name })) };
      if (/PRAGMA table_info\(panel_registrations\)/.test(sql)) return { results: ['id', 'attendee_id', 'panel_slug', 'rsvp_status'].map(name => ({ name })) };
      if (/SELECT a\.\* FROM panel_registrations pr JOIN attendees a ON a.id = pr.attendee_id\s+LEFT JOIN report_downloads rd/.test(sql)) {
        const out = state.pending.slice(0, args[1]); state.pending = state.pending.slice(out.length); return { results: out };
      }
      if (/FROM report_downloads WHERE event_id = 1 ORDER BY created_at DESC/.test(sql)) return { results: [
        { name: 'Lead, One', email: 'one@x.com', mobile: '1', company: 'C', job_title: 'T', city: 'M', industry: 'I', who: 'student', source: 'page', marketing_consent: 1, created_at: 'x', email_sent_at: 'y', email_error: null, downloads: 2, last_download_at: 'z', last_report: 'jnu' } ] };
      return { results: [] };
    },
    async run() { state.sqls.push(sql); state.binds.push(args); return { meta: { changes: 1 } }; },
  };
  return s;
};
const DB = { prepare: stmt, async batch(list) { return Promise.all(list.map(s => s.all())); } };
const ASSETS = { async fetch(req) {
  const u = new URL(typeof req === 'string' ? req : req.url);
  state.assets.push(u.pathname);
  if (!/\.pdf$/.test(u.pathname)) return new Response('no', { status: 404 });
  return new Response('%PDF-1.4 smoke', { status: 200, headers: { 'content-type': 'application/pdf', 'content-length': '14' } });
} };
const bindings = { ADMIN_SECRET: 'smoke-admin', SESSION_SECRET: SECRET, ELASTIC_EMAIL_API_KEY: 'smoke-key', DB, ASSETS };
const env = new Proxy(bindings, { get: (t, k) => (k in t ? t[k] : undefined) });
const envNoAssets = new Proxy({ ...bindings, ASSETS: undefined }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil(p) { state.waits.push(p); }, passThroughOnException() {} };
// Elastic Email is played by the test; nothing else may leave the process.
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (/api\.elasticemail\.com/.test(url)) {
    const body = JSON.parse(init.body);
    state.mails.push({ to: body.Recipients.To[0], subject: body.Content.Subject, html: body.Content.Body[0].Content, headers: body.Content.Headers || {} });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }
  throw new Error('unexpected network call: ' + url);
};
const settle = async () => { await Promise.all(state.waits); state.waits = []; };
const hit = async (path, init = {}, e = env) => {
  const res = await worker.fetch(new Request('https://bharataiinnovation.com' + path, init), e, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, h: Object.fromEntries(res.headers), text, json };
};
const post = (body, auth) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer smoke-admin' } : {}) }, body: JSON.stringify(body) });
const admin = { headers: { Authorization: 'Bearer smoke-admin' } };
const tok = (slug, subject, exp) => subject + '.' + exp + '.' + crypto.createHmac('sha256', SECRET).update(`report:${slug}:${subject}:${exp}`).digest('hex').slice(0, 24);
const future = Math.floor(Date.now() / 1000) + 3600;
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const lastSql = (re) => state.sqls.filter(s => re.test(s)).at(-1);
const bindsFor = (re) => { const i = state.sqls.map((s, k) => (re.test(s) ? k : -1)).filter(k => k >= 0).at(-1); return i == null ? null : state.binds[i]; };

const lead = { name: 'Priya Sharma', email: 'Priya@Example.com', mobile: '+91 98765 43210', who: 'professional', company: 'Acme Analytics', job_title: 'Data Scientist', city: 'Pune', industry: 'Software & SaaS', consent: true };

// ---- before migration 0047: links still work, nothing is recorded, the admin is told ----
// The worker remembers that the table exists once it has seen it (as it does the
// other optional tables), so this runs before anything can have seen it.
state.table = false; state.mails = []; state.sqls = [];
let r = await hit('/api/reports/request', post(lead));
await settle();
check('before migration 0047 the form still hands out links and keeps nothing', r.status === 200 && r.json.ok && r.json.reports.every(x => /\?t=l0\./.test(x.url)) && r.json.emailed === false && state.mails.length === 0 && !state.sqls.some(s => /INSERT INTO report_downloads/.test(s)), r.text.slice(0, 120));
r = await hit(r.json.reports[1].url);
check('and those links open the PDF', r.status === 200 && r.h['content-type'] === 'application/pdf', r.status);
r = await hit('/api/admin/panels/djsanghvi-21sep/send-next-reports', post({ batch: 1 }, true));
check('before 0047 the pump says which migration to run', r.status === 409 && /0047/.test(r.text), r.status + ' ' + r.text);
r = await hit('/api/admin/panels', admin);
check('and the block is told the table is missing', r.json.every(p => p.reports_ready === false), r.text.slice(0, 200));
state.table = true; state.assets = [];

// ---- the gate ----
r = await hit('/reports/' + DJ);
check('a report without a link is not served: 302 to the form', r.status === 302 && /\/insights\?link=expired/.test(r.h.location || ''), r.status + ' ' + r.h.location);
r = await hit('/reports/' + DJ + '?t=l1.' + future + '.' + '0'.repeat(24));
check('a forged link is refused the same way', r.status === 302, r.status);
r = await hit('/reports/' + DJ + '?t=' + tok('jnu', 'l1', future));
check('a link for the other report does not open this one', r.status === 302, r.status);
r = await hit('/reports/' + DJ + '?t=' + tok('djsce', 'l1', Math.floor(Date.now() / 1000) - 10));
check('an expired link is refused', r.status === 302, r.status);
r = await hit('/reports/nothing-here.pdf?t=' + tok('djsce', 'l1', future));
check('an unknown file answers like a bad link (no oracle)', r.status === 302, r.status);
check('nothing was read from Pages for any of those', state.assets.length === 0, JSON.stringify(state.assets));
r = await hit('/reports/' + DJ + '?t=' + tok('djsce', 'a7', future));
await settle();
check('a genuine link streams the PDF', r.status === 200 && r.h['content-type'] === 'application/pdf' && r.text.startsWith('%PDF'), r.status + ' ' + r.h['content-type']);
check('the PDF is read from Pages\' own copy', state.assets.at(-1) === '/reports/' + DJ, JSON.stringify(state.assets));
check('the PDF is never cached and never indexed', /no-store/.test(r.h['cache-control'] || '') && r.h['x-robots-tag'] === 'noindex' && /inline; filename=/.test(r.h['content-disposition'] || ''), JSON.stringify([r.h['cache-control'], r.h['x-robots-tag'], r.h['content-disposition']]));
check('the open is written to the registrant\'s row', /downloads = downloads \+ 1/.test(lastSql(/UPDATE report_downloads SET downloads/) || '') && /attendee_id = \?/.test(lastSql(/UPDATE report_downloads SET downloads/)) && String(bindsFor(/UPDATE report_downloads SET downloads/)).includes('djsce,7'), lastSql(/UPDATE report_downloads SET downloads/));
r = await hit('/reports/' + JNU + '?t=' + tok('jnu', 'l42', future), {}, envNoAssets);
check('without the Pages binding the worker says so instead of crashing', r.status === 404, r.status);

// ---- the form ----
r = await hit('/api/reports/request', post({}));
check('an empty form is refused and told what is missing', r.status === 400 && Array.isArray(r.json.missing) && r.json.missing.includes('name') && r.json.missing.includes('email') && r.json.missing.includes('who'), r.status + ' ' + r.text.slice(0, 120));
r = await hit('/api/reports/request', post({ name: 'A', email: 'not-an-email', mobile: '12', who: 'alien', company: 'X' }));
check('a bad email, a short phone and an unknown role are all named', r.status === 400 && ['email', 'mobile', 'who'].every(k => r.json.missing.includes(k)), r.text.slice(0, 120));
state.sqls = []; state.binds = []; state.mails = [];
r = await hit('/api/reports/request', post(lead), env);
await settle();
check('a complete form gets both links at once', r.status === 200 && r.json.ok && r.json.reports.length === 2 && r.json.reports.every(x => /^\/reports\/.+\.pdf\?t=l42\.\d+\.[0-9a-f]{24}$/.test(x.url)), r.status + ' ' + r.text.slice(0, 200));
check('the person is kept once, lower-cased, as a page lead', /INSERT INTO report_downloads/.test(lastSql(/INSERT INTO report_downloads/) || '') && bindsFor(/INSERT INTO report_downloads/)[0] === 'priya@example.com' && bindsFor(/INSERT INTO report_downloads/).includes('page') && bindsFor(/INSERT INTO report_downloads/).includes(1), JSON.stringify(bindsFor(/INSERT INTO report_downloads/)));
check('the form never wipes a detail given earlier', /COALESCE\(NULLIF\(excluded\.name, ''\), report_downloads\.name\)/.test(lastSql(/INSERT INTO report_downloads/)), 'no COALESCE on conflict');
check('the links are emailed to the address as well', state.mails.length === 1 && state.mails[0].to === 'priya@example.com' && /insights reports/i.test(state.mails[0].subject), JSON.stringify(state.mails.map(m => [m.to, m.subject])));
const mail = state.mails[0] || { html: '' };
check('the email carries a signed, absolute link to each report', [DJ, JNU].every(f => new RegExp('https://bharataiinnovation\\.com/reports/' + f.replace(/\./g, '\\.') + '\\?t=l42\\.\\d+\\.[0-9a-f]{24}').test(mail.html)), mail.html.slice(0, 100));
check('the email links both recordings', /youtube\.com\/watch\?v=fIPXB3mTNOM/.test(mail.html) && /youtube\.com\/watch\?v=6tlYBxAPw3g/.test(mail.html), 'video links');
check('the email asks about November and can be unsubscribed from', /Register free for November/.test(mail.html) && /unsubscribe\?e=/.test(mail.html) && !!mail.headers['List-Unsubscribe'], JSON.stringify(Object.keys(mail.headers)));
check('the email never says RSVP', !/\bRSVP\b/i.test(mail.html), 'RSVP wording present');
check('the send is recorded on the row', /SET email_sent_at = datetime\('now'\)/.test(lastSql(/UPDATE report_downloads SET email_sent_at/) || '') && bindsFor(/UPDATE report_downloads SET email_sent_at/)[0] === 'priya@example.com', lastSql(/UPDATE report_downloads SET email_sent_at/));
const pageLink = r.json.reports.find(x => x.slug === 'djsce').url;
state.assets = []; state.sqls = []; state.binds = [];
r = await hit(pageLink);
await settle();
check('the link the form gave opens the PDF', r.status === 200 && r.h['content-type'] === 'application/pdf', r.status);
check('that open is written to the lead\'s row', /WHERE id = \?/.test(lastSql(/UPDATE report_downloads SET downloads/) || '') && String(bindsFor(/UPDATE report_downloads SET downloads/)) === 'djsce,42', String(bindsFor(/UPDATE report_downloads SET downloads/)));
state.mails = []; state.rowSent = '2026-10-08 10:00:00';
r = await hit('/api/reports/request', post(lead));
await settle();
check('asking again shows the links but does not mail twice', r.status === 200 && r.json.ok && r.json.emailed === false && state.mails.length === 0, r.text.slice(0, 120) + ' mails=' + state.mails.length);
state.rowSent = null;
state.mails = [];
r = await hit('/api/reports/request', post({ ...lead, email: 'reg@example.com' }));
await settle();
check('a registered conference attendee is not asked to register again', state.mails.length === 1 && /You are registered for/.test(state.mails[0].html) && !/Register free for November/.test(state.mails[0].html), state.mails.length);
check('their row carries their attendee id', bindsFor(/INSERT INTO report_downloads/).includes(7), JSON.stringify(bindsFor(/INSERT INTO report_downloads/)));
state.ipCount = 30;
r = await hit('/api/reports/request', { ...post(lead), headers: { ...post(lead).headers, 'CF-Connecting-IP': '203.0.113.9' } });
check('thirty from one address in an hour is enough', r.status === 429, r.status + ' ' + r.text.slice(0, 80));
state.ipCount = 0;

// ---- the admin side ----
r = await hit('/api/admin/panels/djsanghvi-21sep/send-next-reports', post({ batch: 1 }));
check('the pump needs admin', r.status === 401, r.status);
r = await hit('/api/admin/panels/nope/send-next-reports', post({ batch: 1 }, true));
check('an unknown panel is refused', r.status === 404, r.status);
state.pending = [
  { id: 5, name: 'Guest Person', email: 'Guest@TM.com', mobile: '1', company: 'Tech Mahindra', job_title: 'Engineer', city: 'Mumbai', industry: 'IT Services & Consulting', event_id: 1, main_event: 0 },
  { id: 6, name: 'Host Student', email: 'host@djsce.ac.in', company: 'DJSCE', event_id: 1, main_event: 0 },
];
state.mails = []; state.sqls = []; state.binds = [];
r = await hit('/api/admin/panels/djsanghvi-21sep/send-next-reports', post({ batch: 1 }, true));
check('one email per call at batch 1, with the rest counted', r.status === 200 && r.json.sent === 1 && r.json.remaining === 1 && r.json.done === false, r.text);
check('the registrant is mailed, lower-cased, with a link signed for their attendee id', state.mails.length === 1 && state.mails[0].to === 'guest@tm.com' && /\?t=a5\.\d+\.[0-9a-f]{24}/.test(state.mails[0].html), JSON.stringify(state.mails.map(m => m.to)));
check('the email names the panel they registered for', /Dwarkadas J\. Sanghvi College of Engineering/.test(state.mails[0].html) && /companion panel at Jawaharlal Nehru University/.test(state.mails[0].html), 'panel wording');
check('the queue honours unsubscribes and a "no" to updates', /a\.unsubscribed_at IS NULL AND \(a\.marketing_consent IS NULL OR a\.marketing_consent = 1\)/.test(lastSql(/SELECT a\.\* FROM panel_registrations/) || ''), lastSql(/SELECT a\.\* FROM panel_registrations/));
check('the row is kept as an email lead with the attendee id', bindsFor(/INSERT INTO report_downloads/).includes('email') && bindsFor(/INSERT INTO report_downloads/).includes(5) && bindsFor(/INSERT INTO report_downloads/)[0] === 'guest@tm.com', JSON.stringify(bindsFor(/INSERT INTO report_downloads/)));
check('the send is audited', state.sqls.some(s => /INSERT INTO admin_audit/.test(s)) && bindsFor(/INSERT INTO admin_audit/).includes('panel.reports'), 'no audit row');
r = await hit('/api/admin/panels/djsanghvi-21sep/send-next-reports', post({ batch: 5 }, true));
check('the next call finishes the list', r.json.sent === 1 && r.json.done === true && r.json.remaining === 0, r.text);
r = await hit('/api/admin/panels/djsanghvi-21sep/send-next-reports', post({ batch: 5 }, true));
check('an empty queue is done with nothing sent', r.json.done === true && r.json.sent === 0, r.text);
state.sqls = []; state.binds = [];
r = await hit('/api/admin/panels/jnu-30sep/pause-reports', post({}, true));
check('Stop parks the rest on the server, people without a row included', r.json.success && /INSERT OR IGNORE INTO report_downloads/.test(lastSql(/INSERT OR IGNORE/) || '') && /'paused: by admin'/.test(lastSql(/INSERT OR IGNORE/)) && /UPDATE report_downloads SET email_error = 'paused: by admin'/.test(lastSql(/UPDATE report_downloads SET email_error = 'paused/) || ''), r.text);
check('the parked rows are the panel\'s own', /pr\.panel_slug = \?/.test(lastSql(/UPDATE report_downloads SET email_error = 'paused/)), lastSql(/UPDATE report_downloads SET email_error = 'paused/));
r = await hit('/api/admin/panels/jnu-30sep/resume-reports', post({ paused_only: true }, true));
check('Resume un-parks only paused rows', r.json.success && /email_error LIKE 'paused:%'/.test(lastSql(/UPDATE report_downloads SET email_error = NULL/) || ''), lastSql(/UPDATE report_downloads SET email_error = NULL/));
r = await hit('/api/admin/panels/jnu-30sep/resume-reports', post({}, true));
check('Retry failed clears every error', /email_error IS NOT NULL/.test(lastSql(/UPDATE report_downloads SET email_error = NULL/) || ''), lastSql(/UPDATE report_downloads SET email_error = NULL/));
r = await hit('/api/admin/panels/jnu-30sep/reports-preview', admin);
check('the preview renders the email for the panel with dead links', r.status === 200 && /Jawaharlal Nehru University/.test(r.text) && /#preview-djsce/.test(r.text) && /#preview-jnu/.test(r.text) && !/\?t=a0\./.test(r.text), r.status);
r = await hit('/api/admin/panels', admin);
check('the panels list carries the report numbers', r.status === 200 && r.json.every(p => p.reports_ready === true && 'reports_left' in p && 'reports_sent' in p), r.text.slice(0, 200));
r = await hit('/api/admin/reports/summary', admin);
check('the website numbers', r.status === 200 && r.json.ready && r.json.asked_on_page === 3 && r.json.downloads === 6, r.text);
r = await hit('/api/admin/reports/summary');
check('the numbers need admin', r.status === 401, r.status);
r = await hit('/api/admin/reports/leads.csv', admin);
// (the text decoder eats the BOM the route writes, so the header is matched without it)
check('the CSV of everyone who has the reports', r.status === 200 && /text\/csv/.test(r.h['content-type']) && /^﻿?name,email,mobile/.test(r.text) && /"Lead, One",one@x\.com/.test(r.text) && /said_yes_to_updates/.test(r.text) && /,yes,/.test(r.text), r.text.slice(0, 160));
r = await hit('/admin');
for (const m of ['startPanelReports', 'send-next-reports', 'Send the reports', 'renderReportSummary', 'reports-preview', 'insights-report-leads.csv']) check('/admin carries ' + m, r.text.includes(m), 'missing');

// ---- what is built and what is served ----
const routes = JSON.parse(readFileSync(new URL('../../dist/_routes.json', import.meta.url), 'utf8'));
check('_routes.json keeps /reports/* with the worker', !routes.exclude.includes('/reports/*') && routes.include.includes('/*'), JSON.stringify(routes.exclude.filter(x => /report/.test(x))));
check('both PDFs are in the build', [DJ, JNU].every(f => existsSync(new URL('../../dist/reports/' + f, import.meta.url))), 'missing from dist/reports');
const page = existsSync(new URL('../../public/insights.html', import.meta.url)) ? readFileSync(new URL('../../public/insights.html', import.meta.url), 'utf8') : '';
check('/insights has the form that posts to the worker', /id="ir-form"/.test(page) && /\/api\/reports\/request/.test(page) && /name="viewport"/.test(page), 'form or viewport missing');
check('/insights embeds both recordings, cookie-free', /youtube-nocookie\.com\/embed\/fIPXB3mTNOM/.test(page) && /youtube-nocookie\.com\/embed\/6tlYBxAPw3g/.test(page), 'embeds');
check('/insights never says RSVP and never links a PDF directly', !/\bRSVP\b/.test(page) && !/href="\/reports\//.test(page), 'wording or a direct PDF link');
const sw = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
check('the service worker never caches /reports/', /startsWith\('\/reports\/'\)/.test(sw), 'no exclusion in sw.js');
for (const [f, id] of [['campus-djsanghvi.html', 'fIPXB3mTNOM'], ['campus-jnu.html', '6tlYBxAPw3g']]) {
  const html = readFileSync(new URL('../../public/' + f, import.meta.url), 'utf8');
  check(f + ' embeds its recording and points at the report', html.includes('youtube-nocookie.com/embed/' + id) && /\/insights/.test(html), 'embed or link missing');
}

console.log(fails ? `\n${fails} FAILED` : '\nall insights-report checks passed');
process.exit(fails ? 1 : 0);
