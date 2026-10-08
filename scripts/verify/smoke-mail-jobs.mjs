// Built-worker checks for panel email as server jobs: the scheduler's door, start,
// the tick that sends what is due and waits for the next, two tickers at once,
// Stop, Resume, done, five failures in a row, a missing migration, a panel that
// has started. The reports email is the one sent for real (through a played
// Elastic Email); the other two share the same job code.
// Run after `npm run build`:  node scripts/verify/smoke-mail-jobs.mjs
import { readFileSync } from 'node:fs';
const worker = (await import(new URL('../../dist/_worker.js?' + Date.now(), import.meta.url).href)).default;
const settings = new Map();
const state = { table: true, mailFail: false, pending: {}, mails: [], sqls: [], binds: [] };
const person = (id, email) => ({ id, name: 'Person ' + id, email, mobile: '9', company: 'Acme', job_title: 'T', city: 'C', industry: 'I', event_id: 1, main_event: 0, marketing_consent: null });
const stmt = (sql) => {
  let args = [];
  const s = {
    bind(...a) { args = a; return s; },
    async first() {
      state.sqls.push(sql); state.binds.push(args);
      if (/SELECT value FROM app_settings WHERE key = \?/.test(sql)) return settings.has(args[0]) ? { value: settings.get(args[0]) } : null;
      if (/SELECT id FROM report_downloads LIMIT 1/.test(sql)) { if (!state.table) throw new Error('no such table: report_downloads'); return null; }
      if (/SELECT id FROM report_events LIMIT 1/.test(sql)) throw new Error('no such table: report_events');
      if (/COUNT\(\*\) AS n FROM panel_registrations pr JOIN attendees a ON a.id = pr.attendee_id\s+LEFT JOIN report_downloads/.test(sql)) return { n: (state.pending[args[0]] || []).length };
      if (/COUNT\(\*\) AS n FROM panel_registrations pr JOIN attendees a ON a.id = pr.attendee_id WHERE/.test(sql)) return { n: 0 };
      if (/AS reports_sent/.test(sql)) return { reports_sent: 0, reports_failed: 0, reports_paused: 0, reports_opened: 0, reports_left: (state.pending[args[0]] || []).length, reports_suppressed: 0 };
      if (/AS registered/.test(sql)) return { registered: 2 };
      return null;
    },
    async all() {
      state.sqls.push(sql); state.binds.push(args);
      if (/SELECT value FROM app_settings WHERE key LIKE 'mail_job:%'/.test(sql)) return { results: [...settings].filter(([k]) => k.startsWith('mail_job:')).map(([, value]) => ({ value })) };
      if (/PRAGMA table_info\(attendees\)/.test(sql)) return { results: ['id', 'email', 'name', 'main_event', 'unsubscribed_at', 'marketing_consent'].map(name => ({ name })) };
      if (/PRAGMA table_info\(panel_registrations\)/.test(sql)) return { results: ['id', 'attendee_id', 'panel_slug', 'rsvp_status'].map(name => ({ name })) };
      if (/SELECT a\.\* FROM panel_registrations pr JOIN attendees a ON a.id = pr.attendee_id\s+LEFT JOIN report_downloads rd/.test(sql)) {
        const list = state.pending[args[0]] || []; const out = list.slice(0, args[1]); state.pending[args[0]] = list.slice(out.length); return { results: out };
      }
      return { results: [] };
    },
    async run() {
      state.sqls.push(sql); state.binds.push(args);
      if (/INSERT INTO app_settings \(key, value, updated_at\)/.test(sql)) { settings.set(args[0], args[1]); return { meta: { changes: 1 } }; }
      if (/UPDATE app_settings SET value = \?, updated_at = datetime\('now'\) WHERE key = \? AND value = \?/.test(sql)) {
        if (settings.get(args[1]) === args[2]) { settings.set(args[1], args[0]); return { meta: { changes: 1 } }; }
        return { meta: { changes: 0 } };
      }
      return { meta: { changes: 1 } };
    },
  };
  return s;
};
const DB = { prepare: stmt, async batch(list) { return Promise.all(list.map(s => s.all())); } };
const base = { ADMIN_SECRET: 'smoke-admin', SESSION_SECRET: 'smoke-session', ELASTIC_EMAIL_API_KEY: 'smoke-key', DB };
const env = new Proxy(base, { get: (t, k) => (k in t ? t[k] : undefined) });
const envCron = new Proxy({ ...base, CRON_SECRET: 'smoke-cron' }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (/api\.elasticemail\.com/.test(url)) {
    const body = JSON.parse(init.body);
    state.mails.push({ to: body.Recipients.To[0], subject: body.Content.Subject, at: Date.now() });
    if (state.mailFail) return new Response(JSON.stringify({ Error: 'played outage' }), { status: 500, headers: { 'content-type': 'application/json' } });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }
  throw new Error('unexpected network call: ' + url);
};
const hit = async (path, init = {}, e = env) => {
  const res = await worker.fetch(new Request('https://bharataiinnovation.com' + path, init), e, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, h: Object.fromEntries(res.headers), text, json };
};
const post = (body, bearer) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}) }, body: JSON.stringify(body) });
const admin = { headers: { Authorization: 'Bearer smoke-admin' } };
const A = 'smoke-admin';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const job = (kind, slug) => { const v = settings.get('mail_job:' + kind + ':' + slug); return v ? JSON.parse(v) : null; };
const lastSql = (re) => state.sqls.filter(s => re.test(s)).at(-1);
const bindsFor = (re) => { const i = state.sqls.map((s, k) => (re.test(s) ? k : -1)).filter(k => k >= 0).at(-1); return i == null || i < 0 ? null : state.binds[i]; };
const reset = () => { state.sqls = []; state.binds = []; };

// ---- the doors ----
let r = await hit('/api/cron/tick', post({}));
check('the scheduler door needs a secret', r.status === 401, r.status);
r = await hit('/api/cron/tick', post({}, 'wrong'));
check('a wrong secret is refused', r.status === 401, r.status);
r = await hit('/api/cron/tick', { method: 'GET', headers: { Authorization: 'Bearer ' + A } });
check('the scheduler door is POST only', r.status === 404 || r.status === 405, r.status);
r = await hit('/api/admin/mail-jobs');
check('the jobs view needs admin', r.status === 401, r.status);
r = await hit('/api/admin/mail-jobs/reports/jnu-30sep/start', post({ gap_seconds: 1 }));
check('starting needs admin', r.status === 401, r.status);
r = await hit('/api/admin/mail-jobs/tick', post({}));
check('the page tick needs admin', r.status === 401, r.status);
r = await hit('/api/admin/mail-jobs', admin);
check('with nothing started: no jobs and no scheduler seen', r.status === 200 && Object.keys(r.json.jobs).length === 0 && r.json.cron_alive === false, r.text);
r = await hit('/api/cron/tick', post({ max_seconds: 0 }, A));
check('without a CRON_SECRET the admin secret opens the scheduler door', r.status === 200 && r.json.ok && r.json.cron_alive === true && Array.isArray(r.json.acted) && r.json.acted.length === 0, r.text.slice(0, 160));
check('the scheduler is recorded as seen', Number(settings.get('cron_last_tick')) > Date.now() - 5000, settings.get('cron_last_tick'));
r = await hit('/api/cron/tick', post({ max_seconds: 0 }, A), envCron);
check('with a CRON_SECRET set the admin secret no longer opens that door', r.status === 401, r.status);
r = await hit('/api/cron/tick', post({ max_seconds: 0 }, 'smoke-cron'), envCron);
check('and the CRON_SECRET does', r.status === 200 && r.json.ok, r.status);
r = await hit('/api/admin/mail-jobs/tick', post({ max_seconds: 0 }, A));
check('a page tick does not count as the scheduler', r.status === 200, r.status);

// ---- before migration 0047 (first, because the worker remembers a table once it has seen it) ----
state.table = false;
r = await hit('/api/admin/mail-jobs/reports/jnu-30sep/start', post({ gap_seconds: 0 }, A));
check('a job can be started before its migration (the first send says so)', r.status === 200 && job('reports', 'jnu-30sep').status === 'running', r.text.slice(0, 120));
r = await hit('/api/cron/tick', post({ max_seconds: 1 }, A));
let j = job('reports', 'jnu-30sep');
check('the reports job before 0047 stops naming the migration and the command', j.status === 'failed' && /0047/.test(j.last_error) && /d1 execute/.test(j.last_error), JSON.stringify(j));
state.table = true;

// ---- start ----
r = await hit('/api/admin/mail-jobs/nope/jnu-30sep/start', post({ gap_seconds: 1 }, A));
check('an unknown email is refused', r.status === 400, r.status);
r = await hit('/api/admin/mail-jobs/reports/nope/start', post({ gap_seconds: 1 }, A));
check('an unknown panel is refused', r.status === 404, r.status);
state.pending['jnu-30sep'] = [person(11, 'One@x.com'), person(12, 'two@x.com'), person(13, 'three@x.com'), person(14, 'four@x.com'), person(15, 'five@x.com'), person(16, 'six@x.com')];
reset();
r = await hit('/api/admin/mail-jobs/reports/jnu-30sep/start', post({ gap_seconds: 1 }, A));
j = job('reports', 'jnu-30sep');
check('Send writes a running job with the chosen gap, due at once', r.status === 200 && r.json.ok && j && j.status === 'running' && j.gap === 1 && j.sent === 0 && j.next_at <= Date.now() && j.started_by === 'unnamed operator', JSON.stringify(j));
check('Send frees rows a Stop had parked, nothing else', /email_error LIKE 'paused:%'/.test(lastSql(/UPDATE report_downloads SET email_error = NULL/) || ''), lastSql(/UPDATE report_downloads SET email_error = NULL/));
check('the start is audited', bindsFor(/INSERT INTO admin_audit/) && bindsFor(/INSERT INTO admin_audit/).includes('panel.mail.start'), 'no audit');
check('the answer carries the jobs view', r.json.jobs && r.json.jobs['reports:jnu-30sep'] && 'cron_alive' in r.json, r.text.slice(0, 120));
r = await hit('/api/admin/mail-jobs/reports/jnu-30sep/start', post({ gap_seconds: 30 }, A));
check('Send on a running job starts nothing new', r.json.already === true && job('reports', 'jnu-30sep').gap === 1, r.text.slice(0, 120));

// ---- the tick ----
state.mails = [];
r = await hit('/api/admin/mail-jobs/tick', post({ max_seconds: 0 }, A));
j = job('reports', 'jnu-30sep');
check('a tick sends the one email that is due', r.json.ok && state.mails.length === 1 && state.mails[0].to === 'one@x.com' && r.json.acted.length === 1 && r.json.acted[0].sent === 1, JSON.stringify([state.mails, r.json.acted]));
check('the job moves on: 1 sent, 5 to go, next due a gap away', j.sent === 1 && j.remaining === 5 && j.status === 'running' && j.next_at > Date.now() && j.next_at <= Date.now() + 1100, JSON.stringify(j));
r = await hit('/api/admin/mail-jobs/tick', post({ max_seconds: 0 }, A));
check('a tick before the next is due sends nothing', state.mails.length === 1 && r.json.acted.length === 0, state.mails.length);
const t0 = Date.now();
r = await hit('/api/cron/tick', post({ max_seconds: 3 }, A));
const took = Date.now() - t0;
check('a scheduler tick waits for the next email inside its window and keeps going', state.mails.length >= 3 && took >= 1000 && took <= 4500 && r.json.acted[0].sent >= 2, state.mails.length + ' mails in ' + took + ' ms');
check('every email a gap apart, not in a burst', state.mails.slice(1).every((m, i) => m.at - state.mails[i].at >= 900), JSON.stringify(state.mails.map(m => m.at - state.mails[0].at)));
j = job('reports', 'jnu-30sep');
check('the counts follow', j.sent === state.mails.length && j.remaining === 6 - state.mails.length, JSON.stringify(j));

// ---- two tickers at once ----
const beforeRace = state.mails.length;
await sleep(Math.max(0, job('reports', 'jnu-30sep').next_at - Date.now() + 50));
await Promise.all([hit('/api/admin/mail-jobs/tick', post({ max_seconds: 0 }, A)), hit('/api/cron/tick', post({ max_seconds: 0 }, A))]);
check('two tickers at once send one email, not two', state.mails.length === beforeRace + 1, state.mails.length - beforeRace);
check('nobody was mailed twice', new Set(state.mails.map(m => m.to)).size === state.mails.length, JSON.stringify(state.mails.map(m => m.to)));

// ---- Stop and Resume ----
reset();
r = await hit('/api/admin/mail-jobs/reports/jnu-30sep/stop', post({}, A));
j = job('reports', 'jnu-30sep');
check('Stop pauses the job on the server', r.json.ok && j.status === 'paused', JSON.stringify(j));
check('and parks the rows, as before', /INSERT OR IGNORE INTO report_downloads/.test(lastSql(/INSERT OR IGNORE/) || '') && /'paused: by admin'/.test(lastSql(/UPDATE report_downloads SET email_error = 'paused/) || ''), 'rows not parked');
check('the stop is audited', bindsFor(/INSERT INTO admin_audit/) && bindsFor(/INSERT INTO admin_audit/).includes('panel.mail.stop'), 'no audit');
const beforeStop = state.mails.length;
await sleep(1100);
r = await hit('/api/cron/tick', post({ max_seconds: 1 }, A));
check('a paused job is left alone by every ticker', state.mails.length === beforeStop && r.json.acted.length === 0, state.mails.length - beforeStop);
r = await hit('/api/admin/mail-jobs/reports/jnu-30sep/stop', post({}, A));
check('Stop twice is harmless', r.status === 200 && job('reports', 'jnu-30sep').status === 'paused', r.status);
reset();
r = await hit('/api/admin/mail-jobs/reports/jnu-30sep/start', post({ gap_seconds: 0 }, A));
j = job('reports', 'jnu-30sep');
check('Resume carries on with the counts kept and the new pace', j.status === 'running' && j.sent === beforeStop && j.gap === 0 && j.next_at <= Date.now(), JSON.stringify(j));
check('Resume frees only the parked rows', /email_error LIKE 'paused:%'/.test(lastSql(/UPDATE report_downloads SET email_error = NULL/) || ''), 'wrong unpark');
check('and is audited as a resume', String((bindsFor(/INSERT INTO admin_audit/) || [])[5]).includes('"resumed":true'), JSON.stringify(bindsFor(/INSERT INTO admin_audit/)));

// ---- pace, done ----
r = await hit('/api/admin/mail-jobs/reports/jnu-30sep/pace', post({ gap_seconds: 7000 }, A));
check('an impossible pace is refused', r.status === 400, r.status);
r = await hit('/api/admin/mail-jobs/reports/jnu-30sep/pace', post({ gap_seconds: 120 }, A));
check('a new pace is written on the job', r.json.ok && job('reports', 'jnu-30sep').gap === 120, r.text.slice(0, 120));
r = await hit('/api/admin/mail-jobs/reports/jnu-30sep/pace', post({ gap_seconds: 0 }, A));
check('a shorter pace makes the next email due now', job('reports', 'jnu-30sep').next_at <= Date.now(), JSON.stringify(job('reports', 'jnu-30sep')));
r = await hit('/api/cron/tick', post({ max_seconds: 2 }, A));
j = job('reports', 'jnu-30sep');
check('with no gap one tick works through the rest and the job is done', state.mails.length === 6 && j.status === 'done' && j.remaining === 0 && j.finished_at > 0 && j.sent === 6, JSON.stringify([state.mails.length, j]));
r = await hit('/api/cron/tick', post({ max_seconds: 1 }, A));
check('a done job is never touched again', state.mails.length === 6 && r.json.acted.length === 0, state.mails.length);
r = await hit('/api/admin/mail-jobs', admin);
check('the jobs view shows it done', r.json.jobs['reports:jnu-30sep'].status === 'done', r.text.slice(0, 160));

// ---- an outage: five failures in a row stop the run ----
state.pending['djsanghvi-21sep'] = [21, 22, 23, 24, 25, 26, 27, 28].map(i => person(i, 'p' + i + '@x.com'));
state.mails = []; state.mailFail = true;
r = await hit('/api/admin/mail-jobs/reports/djsanghvi-21sep/start', post({ gap_seconds: 0 }, A));
r = await hit('/api/cron/tick', post({ max_seconds: 3 }, A));
j = job('reports', 'djsanghvi-21sep');
check('five failed sends in a row stop the job with the reason, not the whole list', j.status === 'failed' && j.failed === 5 && state.mails.length === 5 && /5 emails in a row/.test(j.last_error) && /played outage/.test(j.last_error), JSON.stringify(j));
check('the three left are still to send', state.pending['djsanghvi-21sep'].length === 3, state.pending['djsanghvi-21sep'].length);
state.mailFail = false; state.mails = [];
r = await hit('/api/admin/mail-jobs/reports/djsanghvi-21sep/start', post({ gap_seconds: 0 }, A));
j = job('reports', 'djsanghvi-21sep');
check('Try again starts afresh', j.status === 'running' && j.sent === 0 && j.failed === 0 && j.last_error === null, JSON.stringify(j));
r = await hit('/api/cron/tick', post({ max_seconds: 2 }, A));
j = job('reports', 'djsanghvi-21sep');
check('and finishes the list', j.status === 'done' && state.mails.length === 3, JSON.stringify([state.mails.length, j]));

// ---- a panel that has started, a migration that is missing ----
r = await hit('/api/admin/mail-jobs/reminders/jnu-30sep/start', post({ gap_seconds: 0 }, A));
r = await hit('/api/cron/tick', post({ max_seconds: 1 }, A));
j = job('reminders', 'jnu-30sep');
check('"Are you coming?" for a panel that has started stops with the reason', j.status === 'failed' && /has started/.test(j.last_error), JSON.stringify(j));

// ---- the old routes still answer the same (a page on the old script keeps working) ----
r = await hit('/api/admin/panels/jnu-30sep/send-next-confirmations', post({ batch: 1 }, A));
check('send-next-confirmations answers as before with an empty queue', r.status === 200 && r.json.done === true && r.json.sent === 0 && r.json.remaining === 0, r.text);
reset();
r = await hit('/api/admin/panels/jnu-30sep/pause', post({}, A));
check('pause parks confirmations as before', r.json.success && /confirmation_error = 'paused: by admin'/.test(lastSql(/UPDATE panel_registrations SET confirmation_error = 'paused/) || ''), r.text);
r = await hit('/api/admin/panels/jnu-30sep/reset-email-errors', post({ paused_only: true }, A));
check('reset-email-errors frees paused confirmations as before', r.json.success && /confirmation_error LIKE 'paused:%'/.test(lastSql(/UPDATE panel_registrations SET confirmation_error = NULL/) || ''), r.text);
r = await hit('/api/admin/panels/jnu-30sep/pause-reminders', post({}, A));
check('pause-reminders parks as before', r.json.success && /reminder_error = 'paused: by admin'/.test(lastSql(/UPDATE panel_registrations SET reminder_error = 'paused/) || ''), r.text);
r = await hit('/api/admin/panels/jnu-30sep/resume-reminders', post({}, A));
check('resume-reminders frees paused reminders as before', r.json.success && /reminder_error LIKE 'paused:%'/.test(lastSql(/UPDATE panel_registrations SET reminder_error = NULL/) || ''), r.text);

// ---- the page and the scheduler Worker ----
r = await hit('/admin');
for (const m of ['function startMailJob', 'function stopMailJob', 'mail-jobs/tick', 'function mailJobsNote', 'section 17', 'you can close this page', 'function setMailJobPace']) check('/admin carries ' + m, r.text.includes(m), 'missing');
for (const gone of ['pumpPanelReports', 'pumpPanelConfirmations', 'pumpPanelReminders', '_panelPump']) check('/admin no longer carries ' + gone, !r.text.includes(gone), 'still there');
const cfg = readFileSync(new URL('../../cron/wrangler.jsonc', import.meta.url), 'utf8');
const cron = readFileSync(new URL('../../cron/src/index.js', import.meta.url), 'utf8');
check('the scheduler Worker runs every minute', /"crons":\s*\["\* \* \* \* \*"\]/.test(cfg) && /"name":\s*"bharatai-mail-cron"/.test(cfg), 'config');
check('and knocks on the right door with its secret and a window', /\/api\/cron\/tick/.test(cron) && /Bearer ' \+ env\.CRON_SECRET/.test(cron) && /max_seconds: 50/.test(cron) && /async scheduled\(/.test(cron), 'worker');

console.log(fails ? `\n${fails} FAILED` : '\nall mail-job checks passed');
process.exit(fails ? 1 : 0);
