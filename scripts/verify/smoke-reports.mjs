// Built-worker checks for the Campus Series insights reports: the gated PDF, the
// counted link pages (/r/ and /w/), plays on the site, the /insights form, the
// "your reports" email, the admin pump, the numbers and the people lists.
// Run after `npm run build`:  node scripts/verify/smoke-reports.mjs
// D1, Pages' static files and Elastic Email are all played by this file.
import crypto from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
const worker = (await import(new URL('../../dist/_worker.js?' + Date.now(), import.meta.url).href)).default;
const SECRET = 'smoke-session';
const DJ = 'djsce-ai-and-employability-insights-report.pdf';
const JNU = 'jnu-ai-and-employability-insights-report.pdf';
const state = { table: true, events: true, ipCount: 0, evIpCount: 0, dupe: false, rowId: 42, rowSent: null, sqls: [], binds: [], pending: [], assets: [], mails: [], waits: [] };
const stmt = (sql) => {
  let args = [];
  const s = {
    bind(...a) { args = a; return s; },
    async first() {
      state.sqls.push(sql); state.binds.push(args);
      if (/SELECT id FROM report_downloads LIMIT 1/.test(sql)) { if (!state.table) throw new Error('no such table: report_downloads'); return null; }
      if (/SELECT id FROM report_events LIMIT 1/.test(sql)) { if (!state.events) throw new Error('no such table: report_events'); return null; }
      if (/COUNT\(\*\) AS n FROM report_downloads WHERE ip/.test(sql)) return { n: state.ipCount };
      if (/COUNT\(\*\) AS n FROM report_events WHERE ip/.test(sql)) return { n: state.evIpCount };
      if (/SELECT id FROM report_events WHERE kind = \?/.test(sql)) return state.dupe ? { id: 1 } : null;
      if (/SELECT email FROM report_downloads WHERE id = \?/.test(sql)) return { email: 'priya@example.com' };
      if (/SELECT email FROM attendees WHERE id = \?/.test(sql)) return { email: 'Guest@TM.com' };
      if (/SELECT \* FROM attendees WHERE event_id = 1 AND LOWER\(email\) = \?/.test(sql)) return args[0] === 'reg@example.com' ? { id: 7, main_event: 1, marketing_consent: null } : null;
      if (/SELECT id, email_sent_at FROM report_downloads/.test(sql)) return { id: state.rowId, email_sent_at: state.rowSent };
      if (/COUNT\(\*\) AS n FROM panel_registrations pr JOIN attendees a ON a.id = pr.attendee_id\s+LEFT JOIN report_downloads/.test(sql)) return { n: state.pending.length };
      if (/AS reports_sent/.test(sql)) return { reports_sent: 3, reports_failed: 1, reports_paused: 0, reports_opened: 2, reports_watched: 1, reports_left: state.pending.length, reports_suppressed: 1 };
      if (/AS asked_on_page/.test(sql)) return { people: 5, asked_on_page: 3, emailed: 4, email_failed: 1, opened: 2, downloads: 6, said_yes_to_updates: 2 };
      if (/AS watched_people/.test(sql)) return { watched_people: 2, watch_from_email: 1, plays_on_site: 3, watch_djsce: 2, watch_jnu: 2 };
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
        { name: 'Lead, One', email: 'one@x.com', mobile: '1', company: 'C', job_title: 'T', city: 'M', industry: 'I', who: 'student', source: 'page', marketing_consent: 1, created_at: 'x', email_sent_at: 'y', email_error: null, downloads: 2, last_download_at: 'z', last_report: 'jnu', reports_opened: 'jnu', videos_watched: 'djsce,jnu' } ] };
      if (/FROM report_downloads rd WHERE rd.event_id = 1 AND rd.downloads > 0/.test(sql)) return { results: [
        { name: 'Opener', email: 'open@x.com', mobile: '9', company: 'Acme', source: 'email', which: 'djsce,jnu', times: 3, last_at: '2026-10-08 10:00:00' } ] };
      if (/FROM report_events e LEFT JOIN report_downloads rd/.test(sql)) return { results: [
        { name: 'Watcher', email: 'watch@x.com', mobile: '8', company: 'Beta', source: 'email,site', which: 'jnu', times: 2, last_at: '2026-10-08 11:00:00' } ] };
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
const post = (body, auth, extra = {}) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer smoke-admin' } : {}), ...extra }, body: JSON.stringify(body) });
const form = (o, extra = {}) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...extra }, body: new URLSearchParams(o).toString() });
const admin = { headers: { Authorization: 'Bearer smoke-admin' } };
const tok = (slug, subject, exp) => subject + '.' + exp + '.' + crypto.createHmac('sha256', SECRET).update(`report:${slug}:${subject}:${exp}`).digest('hex').slice(0, 24);
const future = Math.floor(Date.now() / 1000) + 3600;
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const lastSql = (re) => state.sqls.filter(s => re.test(s)).at(-1);
const bindsFor = (re) => { const i = state.sqls.map((s, k) => (re.test(s) ? k : -1)).filter(k => k >= 0).at(-1); return i == null || i < 0 ? null : state.binds[i]; };
const reset = () => { state.sqls = []; state.binds = []; state.assets = []; };
const OPENED = /UPDATE report_downloads SET downloads/;
const EVENT = /INSERT INTO report_events/;
const lead = { name: 'Priya Sharma', email: 'Priya@Example.com', mobile: '+91 98765 43210', who: 'professional', company: 'Acme Analytics', job_title: 'Data Scientist', city: 'Pune', industry: 'Software & SaaS', consent: true };

// ---- before migrations 0047 and 0048: links still work, nothing is recorded, the admin is told ----
// The worker remembers that a table exists once it has seen it, so this runs first.
state.table = false; state.events = false; state.mails = []; reset();
let r = await hit('/api/reports/request', post(lead));
await settle();
check('before 0047 the form still hands out links and keeps nothing', r.status === 200 && r.json.ok && r.json.reports.every(x => /^\/r\/(djsce|jnu)\?t=l0\./.test(x.url)) && r.json.emailed === false && state.mails.length === 0 && !state.sqls.some(s => /INSERT INTO report_downloads/.test(s)), r.text.slice(0, 160));
const t0 = new URL('https://x' + r.json.reports[1].url).searchParams.get('t');
r = await hit('/r/jnu', form({ t: t0, from: 'site' }));
check('and those links lead on to the PDF', r.status === 303 && r.h.location === '/reports/' + JNU + '?t=' + encodeURIComponent(t0) + '&via=1', r.status + ' ' + r.h.location);
r = await hit(r.h.location);
check('which opens', r.status === 200 && r.h['content-type'] === 'application/pdf', r.status);
r = await hit('/w/jnu', form({ t: t0 }));
check('before 0048 a recording link still plays and records nothing', r.status === 303 && /youtube\.com\/watch\?v=6tlYBxAPw3g/.test(r.h.location) && !state.sqls.some(s => EVENT.test(s)), r.status + ' ' + r.h.location);
r = await hit('/api/admin/panels/djsanghvi-21sep/send-next-reports', post({ batch: 1 }, true));
check('before 0047 the pump names the migration and the command that works', r.status === 409 && /0047/.test(r.text) && /d1 execute/.test(r.text), r.status + ' ' + r.text);
r = await hit('/api/admin/panels', admin);
check('and the block is told the table is missing', r.json.every(p => p.reports_ready === false), r.text.slice(0, 200));
state.table = true;
r = await hit('/api/admin/reports/people?what=watched', admin);
check('before 0048 the list of who watched says why it is empty', r.status === 409 && /0048/.test(r.text), r.status + ' ' + r.text);
r = await hit('/api/admin/panels', admin);
check('before 0048 the block shows no watch numbers', r.json.every(p => p.reports_ready === true && p.reports_watch_ready === false), r.text.slice(0, 200));
reset();
r = await hit('/r/djsce', form({ t: tok('djsce', 'l42', future) }));
check('before 0048 an open is still counted on the row', r.status === 303 && OPENED.test(lastSql(OPENED) || '') && !state.sqls.some(s => EVENT.test(s)), r.status);
state.events = true; reset();

// ---- the file itself ----
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
reset();
r = await hit('/reports/' + DJ + '?t=' + tok('djsce', 'a7', future) + '&via=1');
await settle();
check('a genuine link streams the PDF', r.status === 200 && r.h['content-type'] === 'application/pdf' && r.text.startsWith('%PDF'), r.status + ' ' + r.h['content-type']);
check('the PDF is read from Pages\' own copy', state.assets.at(-1) === '/reports/' + DJ, JSON.stringify(state.assets));
check('the PDF is never cached and never indexed', /no-store/.test(r.h['cache-control'] || '') && r.h['x-robots-tag'] === 'noindex' && /inline; filename=/.test(r.h['content-disposition'] || ''), JSON.stringify([r.h['cache-control'], r.h['x-robots-tag'], r.h['content-disposition']]));
check('a file reached through /r/ is not counted twice', !OPENED.test(state.sqls.join('\n')) && !state.sqls.some(s => EVENT.test(s)), state.sqls.filter(s => /report_/.test(s)).join(' | ').slice(0, 200));
reset();
r = await hit('/reports/' + DJ + '?t=' + tok('djsce', 'a7', future));
await settle();
check('a direct link from the first emails is counted on the registrant\'s row', r.status === 200 && /attendee_id = \?/.test(lastSql(OPENED) || '') && String(bindsFor(OPENED)) === 'djsce,7', String(bindsFor(OPENED)));
check('and as an act marked as such', EVENT.test(lastSql(EVENT) || '') && bindsFor(EVENT)[0] === 'open' && bindsFor(EVENT)[1] === 'djsce' && bindsFor(EVENT)[2] === 'a7' && bindsFor(EVENT)[3] === 'guest@tm.com' && bindsFor(EVENT)[4] === 'link', JSON.stringify(bindsFor(EVENT)));
r = await hit('/reports/' + JNU + '?t=' + tok('jnu', 'l42', future), {}, envNoAssets);
check('without the Pages binding the worker says so instead of crashing', r.status === 404, r.status);

// ---- the form ----
r = await hit('/api/reports/request', post({}));
check('an empty form is refused and told what is missing', r.status === 400 && Array.isArray(r.json.missing) && r.json.missing.includes('name') && r.json.missing.includes('email') && r.json.missing.includes('who'), r.status + ' ' + r.text.slice(0, 120));
r = await hit('/api/reports/request', post({ name: 'A', email: 'not-an-email', mobile: '12', who: 'alien', company: 'X' }));
check('a bad email, a short phone and an unknown role are all named', r.status === 400 && ['email', 'mobile', 'who'].every(k => r.json.missing.includes(k)), r.text.slice(0, 120));
reset(); state.mails = [];
r = await hit('/api/reports/request', post(lead));
await settle();
check('a complete form gets both links at once, each a counted link from the site', r.status === 200 && r.json.ok && r.json.reports.length === 2 && r.json.reports.every(x => /^\/r\/(djsce|jnu)\?t=l42\.\d+\.[0-9a-f]{24}&from=site$/.test(x.url)), r.status + ' ' + r.text.slice(0, 220));
check('the person is kept once, lower-cased, as a page lead', bindsFor(/INSERT INTO report_downloads/)[0] === 'priya@example.com' && bindsFor(/INSERT INTO report_downloads/).includes('page') && bindsFor(/INSERT INTO report_downloads/).includes(1), JSON.stringify(bindsFor(/INSERT INTO report_downloads/)));
check('the form never wipes a detail given earlier', /COALESCE\(NULLIF\(excluded\.name, ''\), report_downloads\.name\)/.test(lastSql(/INSERT INTO report_downloads/)), 'no COALESCE on conflict');
check('the links are emailed to the address as well', state.mails.length === 1 && state.mails[0].to === 'priya@example.com' && /insights reports/i.test(state.mails[0].subject), JSON.stringify(state.mails.map(m => [m.to, m.subject])));
const mail = state.mails[0] || { html: '' };
check('the email carries a counted link to each report', ['djsce', 'jnu'].every(s => new RegExp('https://bharataiinnovation\\.com/r/' + s + '\\?t=l42\\.\\d+\\.[0-9a-f]{24}"').test(mail.html)), mail.html.slice(0, 100));
check('the email carries a counted link to each recording', ['djsce', 'jnu'].every(s => new RegExp('https://bharataiinnovation\\.com/w/' + s + '\\?t=l42\\.\\d+\\.[0-9a-f]{24}"').test(mail.html)), 'watch links');
check('no link in the email goes round the count', !/youtube\.com\/watch/.test(mail.html) && !/\/reports\/[a-z-]+\.pdf/.test(mail.html), 'a direct link is still in the email');
check('the email asks about November and can be unsubscribed from', /Register free for November/.test(mail.html) && /unsubscribe\?e=/.test(mail.html) && !!mail.headers['List-Unsubscribe'], JSON.stringify(Object.keys(mail.headers)));
check('the email never says RSVP', !/\bRSVP\b/i.test(mail.html), 'RSVP wording present');
check('the send is recorded on the row', bindsFor(/UPDATE report_downloads SET email_sent_at/)[0] === 'priya@example.com', lastSql(/UPDATE report_downloads SET email_sent_at/));

// ---- a report link: the page, the post, the file ----
const pageLink = r.json.reports.find(x => x.slug === 'djsce').url;
const pageT = new URL('https://x' + pageLink).searchParams.get('t');
reset();
r = await hit(pageLink);
check('a report link opens a page that posts itself', r.status === 200 && /<form method="post" action="\/r\/djsce">/.test(r.text) && /document\.forms\[0\]\.submit\(\)/.test(r.text) && /name="from" value="site"/.test(r.text), r.status + ' ' + r.text.slice(0, 160));
check('opening the link records nothing (safe from mail scanners)', !OPENED.test(state.sqls.join('\n')) && !state.sqls.some(s => EVENT.test(s)), 'recorded on GET');
check('that page has a phone viewport, is not indexed and never says RSVP', /name="viewport"/.test(r.text) && /noindex/.test(r.h['x-robots-tag'] || '') && !/\bRSVP\b/.test(r.text), 'viewport, robots or wording');
r = await hit('/r/djsce?t=l42.' + future + '.' + '0'.repeat(24));
check('a forged report link goes to the form', r.status === 302 && /link=expired/.test(r.h.location), r.status);
r = await hit('/r/nope?t=' + pageT);
check('an unknown report goes to the form', r.status === 302 && /link=expired/.test(r.h.location), r.status);
reset();
r = await hit('/r/djsce', form({ t: pageT, from: 'site' }));
check('the post sends the browser on to the file', r.status === 303 && r.h.location === '/reports/' + DJ + '?t=' + encodeURIComponent(pageT) + '&via=1', r.status + ' ' + r.h.location);
check('and counts the open on the lead\'s row', /WHERE id = \?/.test(lastSql(OPENED) || '') && String(bindsFor(OPENED)) === 'djsce,42', String(bindsFor(OPENED)));
check('as an act with the person\'s email, from the site', JSON.stringify(bindsFor(EVENT)) === JSON.stringify(['open', 'djsce', 'l42', 'priya@example.com', 'site', null, null]), JSON.stringify(bindsFor(EVENT)));
r = await hit('/r/djsce', form({ t: 'l42.' + future + '.' + '0'.repeat(24) }));
check('a forged post records nothing and goes to the form', r.status === 303 && /link=expired/.test(r.h.location), r.status + ' ' + r.h.location);

// ---- a recording link from the email ----
const a5 = tok('jnu', 'a5', future);
reset();
r = await hit('/w/jnu?t=' + a5);
check('a recording link opens a page that posts itself, with YouTube as the way out', r.status === 200 && /action="\/w\/jnu"/.test(r.text) && /youtube\.com\/watch\?v=6tlYBxAPw3g/.test(r.text) && !state.sqls.some(s => EVENT.test(s)), r.status);
r = await hit('/w/jnu?t=bad');
check('a broken recording link still plays the video', r.status === 302 && r.h.location === 'https://www.youtube.com/watch?v=6tlYBxAPw3g', r.status + ' ' + r.h.location);
reset();
r = await hit('/w/jnu', form({ t: a5 }, { 'CF-Connecting-IP': '203.0.113.5' }));
check('the post plays the recording', r.status === 303 && r.h.location === 'https://www.youtube.com/watch?v=6tlYBxAPw3g', r.status + ' ' + r.h.location);
check('and records who watched which, from the email', JSON.stringify(bindsFor(EVENT)) === JSON.stringify(['watch', 'jnu', 'a5', 'guest@tm.com', 'email', null, '203.0.113.5']), JSON.stringify(bindsFor(EVENT)));
state.dupe = true; reset();
await hit('/w/jnu', form({ t: a5 }, { 'CF-Connecting-IP': '203.0.113.5' }));
check('the same tap again within half an hour is one act', !state.sqls.some(s => EVENT.test(s)), 'inserted twice');
state.dupe = false; state.evIpCount = 120; reset();
await hit('/w/jnu', form({ t: a5 }, { 'CF-Connecting-IP': '203.0.113.5' }));
check('one address cannot write more than its share an hour', !state.sqls.some(s => EVENT.test(s)), 'cap not applied');
state.evIpCount = 0;

// ---- a play on the website ----
reset();
r = await hit('/api/reports/watch', post({ report: 'djsce', t: '', source: 'site', page: '/campus-djsanghvi' }));
check('a play on a campus page is counted with nobody\'s name', r.status === 204 && JSON.stringify(bindsFor(EVENT)) === JSON.stringify(['watch', 'djsce', '', null, 'site', '/campus-djsanghvi', null]), r.status + ' ' + JSON.stringify(bindsFor(EVENT)));
reset();
r = await hit('/api/reports/watch', post({ report: 'jnu', t: tok('jnu', 'l42', future), page: '/insights' }));
check('a play by someone who asked on /insights carries their name', r.status === 204 && JSON.stringify(bindsFor(EVENT)) === JSON.stringify(['watch', 'jnu', 'l42', 'priya@example.com', 'site', '/insights', null]), JSON.stringify(bindsFor(EVENT)));
reset();
r = await hit('/api/reports/watch', post({ report: 'jnu', t: tok('djsce', 'l42', future), page: '/<script>' }));
check('a token for the other report names nobody, and a strange page is not kept', r.status === 204 && bindsFor(EVENT)[2] === '' && bindsFor(EVENT)[5] === null, JSON.stringify(bindsFor(EVENT)));
reset();
r = await hit('/api/reports/watch', post({ report: 'nope' }));
check('an unknown recording answers the same and writes nothing', r.status === 204 && !state.sqls.some(s => EVENT.test(s)), r.status);

// ---- repeats, registered attendees, the cap ----
state.mails = []; state.rowSent = '2026-10-08 10:00:00';
r = await hit('/api/reports/request', post(lead));
await settle();
check('asking again shows the links but does not mail twice', r.status === 200 && r.json.ok && r.json.emailed === false && state.mails.length === 0, r.text.slice(0, 120) + ' mails=' + state.mails.length);
state.rowSent = null; state.mails = [];
r = await hit('/api/reports/request', post({ ...lead, email: 'reg@example.com' }));
await settle();
check('a registered conference attendee is not asked to register again', state.mails.length === 1 && /You are registered for/.test(state.mails[0].html) && !/Register free for November/.test(state.mails[0].html), state.mails.length);
check('their row carries their attendee id', bindsFor(/INSERT INTO report_downloads/).includes(7), JSON.stringify(bindsFor(/INSERT INTO report_downloads/)));
state.ipCount = 30;
r = await hit('/api/reports/request', post(lead, false, { 'CF-Connecting-IP': '203.0.113.9' }));
check('thirty from one address in an hour is enough', r.status === 429, r.status + ' ' + r.text.slice(0, 80));
state.ipCount = 0;

// ---- the admin pump ----
r = await hit('/api/admin/panels/djsanghvi-21sep/send-next-reports', post({ batch: 1 }));
check('the pump needs admin', r.status === 401, r.status);
r = await hit('/api/admin/panels/nope/send-next-reports', post({ batch: 1 }, true));
check('an unknown panel is refused', r.status === 404, r.status);
state.pending = [
  { id: 5, name: 'Guest Person', email: 'Guest@TM.com', mobile: '1', company: 'Tech Mahindra', job_title: 'Engineer', city: 'Mumbai', industry: 'IT Services & Consulting', event_id: 1, main_event: 0, marketing_consent: null },
  { id: 6, name: 'Said No', email: 'no@djsce.ac.in', company: 'DJSCE', event_id: 1, main_event: 0, marketing_consent: 0 },
];
state.mails = []; reset();
r = await hit('/api/admin/panels/djsanghvi-21sep/send-next-reports', post({ batch: 1 }, true));
check('one email per call at batch 1, with the rest counted', r.status === 200 && r.json.sent === 1 && r.json.remaining === 1 && r.json.done === false, r.text);
check('the registrant is mailed, lower-cased, with links signed for their attendee id', state.mails.length === 1 && state.mails[0].to === 'guest@tm.com' && /\/r\/djsce\?t=a5\.\d+\.[0-9a-f]{24}/.test(state.mails[0].html) && /\/w\/jnu\?t=a5\./.test(state.mails[0].html), JSON.stringify(state.mails.map(m => m.to)));
check('the email names the panel they registered for', /Dwarkadas J\. Sanghvi College of Engineering/.test(state.mails[0].html) && /companion panel at Jawaharlal Nehru University/.test(state.mails[0].html), 'panel wording');
check('the queue leaves out unsubscribes, not a "no" to marketing', /a\.unsubscribed_at IS NULL/.test(lastSql(/SELECT a\.\* FROM panel_registrations/) || '') && !/marketing_consent/.test(lastSql(/SELECT a\.\* FROM panel_registrations/) || ''), lastSql(/SELECT a\.\* FROM panel_registrations/));
check('the row is kept as an email lead with the attendee id', bindsFor(/INSERT INTO report_downloads/).includes('email') && bindsFor(/INSERT INTO report_downloads/).includes(5) && bindsFor(/INSERT INTO report_downloads/)[0] === 'guest@tm.com', JSON.stringify(bindsFor(/INSERT INTO report_downloads/)));
check('the send is audited', bindsFor(/INSERT INTO admin_audit/) && bindsFor(/INSERT INTO admin_audit/).includes('panel.reports'), 'no audit row');
state.mails = [];
r = await hit('/api/admin/panels/djsanghvi-21sep/send-next-reports', post({ batch: 5 }, true));
check('the next call finishes the list', r.json.sent === 1 && r.json.done === true && r.json.remaining === 0, r.text);
check('someone who said no to marketing gets the reports without the November ask', state.mails.length === 1 && state.mails[0].to === 'no@djsce.ac.in' && /\/r\/djsce\?t=a6\./.test(state.mails[0].html) && !/Register free for November/.test(state.mails[0].html) && !/You are registered for/.test(state.mails[0].html) && /unsubscribe\?e=/.test(state.mails[0].html), state.mails.length ? state.mails[0].html.slice(-400) : 'no mail');
r = await hit('/api/admin/panels/djsanghvi-21sep/send-next-reports', post({ batch: 5 }, true));
check('an empty queue is done with nothing sent', r.json.done === true && r.json.sent === 0, r.text);
reset();
r = await hit('/api/admin/panels/jnu-30sep/pause-reports', post({}, true));
check('Stop parks the rest on the server, people without a row included', r.json.success && /'paused: by admin'/.test(lastSql(/INSERT OR IGNORE/) || '') && /UPDATE report_downloads SET email_error = 'paused: by admin'/.test(lastSql(/UPDATE report_downloads SET email_error = 'paused/) || ''), r.text);
check('Stop parks the same people the pump would mail', /a\.unsubscribed_at IS NULL/.test(lastSql(/INSERT OR IGNORE/) || '') && !/marketing_consent/.test(lastSql(/INSERT OR IGNORE/) || ''), lastSql(/INSERT OR IGNORE/));
r = await hit('/api/admin/panels/jnu-30sep/resume-reports', post({ paused_only: true }, true));
check('Resume un-parks only paused rows', r.json.success && /email_error LIKE 'paused:%'/.test(lastSql(/UPDATE report_downloads SET email_error = NULL/) || ''), lastSql(/UPDATE report_downloads SET email_error = NULL/));
r = await hit('/api/admin/panels/jnu-30sep/resume-reports', post({}, true));
check('Retry failed clears every error', /email_error IS NOT NULL/.test(lastSql(/UPDATE report_downloads SET email_error = NULL/) || ''), lastSql(/UPDATE report_downloads SET email_error = NULL/));
r = await hit('/api/admin/panels/jnu-30sep/reports-preview', admin);
check('the preview renders the email for the panel with dead links', r.status === 200 && /Jawaharlal Nehru University/.test(r.text) && /#preview-djsce/.test(r.text) && /#preview-watch-jnu/.test(r.text) && !/\?t=a0\./.test(r.text), r.status);

// ---- the numbers and the people ----
r = await hit('/api/admin/panels', admin);
check('the panels list carries the report and watch numbers', r.status === 200 && r.json.every(p => p.reports_ready === true && p.reports_watch_ready === true && p.reports_watched === 1 && 'reports_left' in p), r.text.slice(0, 200));
check('the panel numbers count watchers by their email', /EXISTS \(SELECT 1 FROM report_events e WHERE e\.kind = 'watch' AND e\.email = LOWER\(a\.email\)\)/.test(lastSql(/AS reports_sent/) || ''), 'no watch count');
r = await hit('/api/admin/reports/summary', admin);
check('the summary counts opens, watchers and plays', r.status === 200 && r.json.ready && r.json.asked_on_page === 3 && r.json.downloads === 6 && r.json.watch_ready === true && r.json.watched_people === 2 && r.json.plays_on_site === 3 && r.json.watch_jnu === 2, r.text);
r = await hit('/api/admin/reports/summary');
check('the numbers need admin', r.status === 401, r.status);
r = await hit('/api/admin/reports/people?what=opened');
check('the people lists need admin', r.status === 401, r.status);
r = await hit('/api/admin/reports/people?what=opened', admin);
check('who opened a report, by name, with which reports', r.status === 200 && r.json.label === 'Opened a report' && r.json.rows[0].email === 'open@x.com' && r.json.rows[0].which === 'DJ Sanghvi + JNU' && r.json.rows[0].times === 3, r.text.slice(0, 200));
reset();
r = await hit('/api/admin/reports/people?what=watched&panel=jnu-30sep', admin);
check('who watched, for one panel\'s registrants', r.status === 200 && r.json.rows[0].email === 'watch@x.com' && r.json.rows[0].which === 'JNU' && r.json.rows[0].via === 'from the email + on the website' && /e\.email IN \(SELECT LOWER\(a\.email\)/.test(lastSql(/FROM report_events e LEFT JOIN/) || '') && String(bindsFor(/FROM report_events e LEFT JOIN/)) === 'jnu-30sep', r.text.slice(0, 200));
r = await hit('/api/admin/reports/people?what=watched&format=csv', admin);
check('the list as CSV', r.status === 200 && /text\/csv/.test(r.h['content-type']) && /^﻿?name,email,mobile,company,recordings,how,times,last/.test(r.text) && /watch@x\.com/.test(r.text), r.text.slice(0, 120));
r = await hit('/api/admin/reports/people?what=everything', admin);
check('an unknown list is refused', r.status === 400, r.status);
r = await hit('/api/admin/reports/people?what=opened&panel=nope', admin);
check('an unknown panel is refused', r.status === 404, r.status);
r = await hit('/api/admin/reports/leads.csv', admin);
// (the text decoder eats the BOM the route writes, so the header is matched without it)
check('the CSV of everyone says what each person opened and watched', r.status === 200 && /text\/csv/.test(r.h['content-type']) && /^﻿?name,email,mobile/.test(r.text) && /reports_opened,videos_watched/.test(r.text) && /"Lead, One",one@x\.com/.test(r.text) && /,yes,/.test(r.text) && /"djsce,jnu"/.test(r.text), r.text.slice(0, 220));
r = await hit('/admin');
for (const m of ['startMailJob', 'mail-jobs/tick', 'Send the reports', 'renderReportSummary', 'reports-preview', 'insights-report-leads.csv', 'function reportPeople', 'function reportStat', 'watched a recording', 'Who watched']) check('/admin carries ' + m, r.text.includes(m), 'missing');
check('/admin no longer says "or said no"', !r.text.includes('unsubscribed or said no'), 'old wording');

// ---- what is built and what is served ----
const routes = JSON.parse(readFileSync(new URL('../../dist/_routes.json', import.meta.url), 'utf8'));
check('_routes.json keeps /reports/* with the worker', !routes.exclude.includes('/reports/*') && routes.include.includes('/*'), JSON.stringify(routes.exclude.filter(x => /report/.test(x))));
check('both PDFs are in the build', [DJ, JNU].every(f => existsSync(new URL('../../dist/reports/' + f, import.meta.url))), 'missing from dist/reports');
const page = readFileSync(new URL('../../public/insights.html', import.meta.url), 'utf8');
check('/insights has the form that posts to the worker', /id="ir-form"/.test(page) && /\/api\/reports\/request/.test(page) && /name="viewport"/.test(page), 'form or viewport missing');
check('/insights never says RSVP and never links a PDF directly', !/\bRSVP\b/.test(page) && !/href="\/reports\//.test(page), 'wording or a direct PDF link');
const sw = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
check('the service worker never caches /reports/', /startsWith\('\/reports\/'\)/.test(sw), 'no exclusion in sw.js');
const tracker = readFileSync(new URL('../../public/js/watch-track.js', import.meta.url), 'utf8');
check('the play tracker listens for the player\'s own "playing" signal', /YT\.PlayerState\.PLAYING/.test(tracker) && /\/api\/reports\/watch/.test(tracker) && /youtube\.com\/iframe_api/.test(tracker), 'tracker');
for (const [f, ids] of [['insights.html', [['fIPXB3mTNOM', 'djsce'], ['6tlYBxAPw3g', 'jnu']]], ['campus-series.html', [['fIPXB3mTNOM', 'djsce'], ['6tlYBxAPw3g', 'jnu']]], ['campus-djsanghvi.html', [['fIPXB3mTNOM', 'djsce']]], ['campus-jnu.html', [['6tlYBxAPw3g', 'jnu']]]]) {
  const html = readFileSync(new URL('../../public/' + f, import.meta.url), 'utf8');
  check(f + ': each player can be heard and is tagged with its report, and the tracker loads', ids.every(([id, slug]) => html.includes('youtube-nocookie.com/embed/' + id + '?enablejsapi=1" data-report="' + slug + '"')) && /js\/watch-track\.js/.test(html) && /\/insights/.test(html), 'player, tag or tracker missing');
}

console.log(fails ? `\n${fails} FAILED` : '\nall insights-report checks passed');
process.exit(fails ? 1 : 0);
