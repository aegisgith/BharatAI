// Built-worker checks for campus panel "Are you coming?" (/panel-rsvp, app route, admin pump, CSVs).
// Run after `npm run build`:  node scripts/verify/smoke-panel-answers.mjs
// "Are you coming?" routes against the built worker with a fake D1.
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
const worker = (await import(new URL('../../dist/_worker.js?' + Date.now(), import.meta.url).href)).default;
const SECRET = 'smoke-session';
const state = { rsvpColumns: true, updateThrows: false, updates: [], sqls: [] };
const DB = {
  prepare(sql) {
    let args = [];
    const stmt = {
      bind(...a) { args = a; return stmt; },
      async first() {
        state.sqls.push(sql);
        if (/SELECT company, email FROM attendees WHERE id = \?/.test(sql)) return PEOPLE[Number(args[0])] || null;
        if (/SELECT value FROM app_settings/.test(sql)) return null;
        if (/COUNT\(\*\) AS n FROM panel_registrations/.test(sql)) return { n: 0 };
        if (/FROM panel_registrations pr JOIN attendees a ON a.id = pr.attendee_id\s+WHERE pr.panel_slug = \?`?$/m.test(sql) || /AS registered/.test(sql)) return { registered: 2, rsvp_yes: 1, rsvp_no: 0 };
        return null;
      },
      async all() {
        state.sqls.push(sql);
        if (/PRAGMA table_info\(panel_registrations\)/.test(sql)) return { results: ['id', 'attendee_id', 'panel_slug'].concat(state.rsvpColumns ? ['rsvp_status', 'rsvp_at', 'reminder_sent_at', 'reminder_error'] : []).map(name => ({ name })) };
        if (/PRAGMA table_info\(attendees\)/.test(sql)) return { results: ['id', 'main_event', 'unsubscribed_at'].map(name => ({ name })) };
        if (/SELECT pr.id AS pr_id, a\.\*/.test(sql)) return { results: [{ pr_id: 1, ...PEOPLE[5] }, { pr_id: 2, ...PEOPLE[6] }] };
        if (/SELECT a.name, a.email, a.mobile/.test(sql)) return { results: [
          { name: 'Guest Person', email: 'guest@tm.com', mobile: '1', company: 'Tech Mahindra', job_title: 'Engineer', source: 'linkedin', registered_at: 'x', rsvp_status: 'yes', rsvp_at: 'y' },
          { name: 'Host, Student', email: HOST_EMAIL, mobile: '2', company: HOST_TOKEN, job_title: 'Student', source: 'muni', registered_at: 'x', rsvp_status: 'yes', rsvp_at: 'y' },
          { name: 'Undecided', email: 'u@x.com', mobile: '3', company: 'Other', job_title: '', source: 'linkedin', registered_at: 'x', rsvp_status: null, rsvp_at: null } ] };
        return { results: [] };
      },
      async run() {
        state.sqls.push(sql);
        if (/UPDATE panel_registrations SET rsvp_status/.test(sql)) {
          if (state.updateThrows) throw new Error('no such column: rsvp_status');
          state.updates.push(args);
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 1 } };
      },
    };
    return stmt;
  },
  async batch(list) { return Promise.all(list.map(s => s.all())); },
};
const env = new Proxy({ ADMIN_SECRET: 'smoke-admin', SESSION_SECRET: SECRET, DB }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };
const sig = (a, p, r) => crypto.createHmac('sha256', SECRET).update(`panel-rsvp:${a}:${p}:${r}`).digest('hex').slice(0, 32);
const cookie = (id) => { const exp = Math.floor(Date.now() / 1000) + 3600; const b = `${id}.${exp}`; return 'bai_session=' + b + '.' + crypto.createHmac('sha256', SECRET).update(b).digest('hex'); };
const hit = async (path, init = {}) => { const res = await worker.fetch(new Request('https://bharataiinnovation.com' + path, init), env, ctx); const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {} return { status: res.status, h: Object.fromEntries(res.headers), text, json }; };
const form = (o) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString() });
const admin = (method = 'GET', body) => ({ method, headers: { Authorization: 'Bearer smoke-admin', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
// A panel stops taking answers once it starts, so pin the test to one that is still
// ahead of today rather than a slug that quietly ages out (21 Sep aged out on 21 Sep).
const PANEL_SRC = readFileSync(new URL('../../src/index.tsx', import.meta.url), 'utf8');
const panelField = (slug, field) => {
  const block = PANEL_SRC.slice(PANEL_SRC.indexOf("'" + slug + "': {"));
  const m = block.match(new RegExp(field + ": '([^']+)'"));
  return m && m[1];
};
const panelHostToken = (slug) => {
  const block = PANEL_SRC.slice(PANEL_SRC.indexOf("'" + slug + "': {"));
  const m = block.match(/hostLike: \[([^\]]*)\]/);
  if (!m) return 'host';
  const words = m[1].split(',').map(t => t.trim().replace(/'/g, '')).filter(Boolean);
  // one word only: the fixture puts it in an email address, and hostLike matches on
  // substrings, so a two-word phrase like 'jawaharlal nehru' would never match back.
  return words.find(w => /^[a-z0-9]+$/.test(w)) || words[0].replace(/\s+/g, '');
};
const SLUG = (() => {
  const src = PANEL_SRC;
  const now = Date.now();
  const found = [...src.matchAll(/'([a-z0-9-]+)':\s*\{[\s\S]{0,80}?slug: '\1'[\s\S]*?startsAt: '([^']+)'/g)]
    .map(m => ({ slug: m[1], at: Date.parse(m[2]) }))
    .filter(p => p.at > now).sort((a, b) => a.at - b.at)[0];
  if (!found) throw new Error('every campus panel in CAMPUS_PANELS has already started - add a future one or this suite cannot run');
  return found.slug;
})();

const HOST_TOKEN = panelHostToken(SLUG);                 // e.g. 'djsce' or 'jnu'
const HOST_EMAIL = 'host@' + HOST_TOKEN + '.ac.in';
const PEOPLE = { 5: { id: 5, name: 'Guest Person', email: 'guest@tm.com', company: 'Tech Mahindra', event_id: 1 },
                 6: { id: 6, name: 'Host Student', email: HOST_EMAIL, company: HOST_TOKEN, event_id: 1 } };

// Email link: confirm page only
let r = await hit(`/panel-rsvp?a=5&p=${SLUG}&r=yes&s=${'0'.repeat(32)}`);
check('forged link is refused with a plain page', r.status === 400 && r.text.includes('not valid'), r.status);
state.updates = [];
r = await hit(`/panel-rsvp?a=5&p=${SLUG}&r=yes&s=${sig(5, SLUG, 'yes')}`);
check('genuine link shows a self-submitting confirm page', r.status === 200 && /method="post"/.test(r.text) && /\.submit\(\)/.test(r.text), r.status);
check('opening the link records nothing (safe from mail scanners)', state.updates.length === 0, JSON.stringify(state.updates));
check('the page has a phone viewport', /name="viewport"/.test(r.text), 'no viewport meta');
check('the page never says RSVP to the student', !/\bRSVP\b/i.test(r.text.replace(/panel-rsvp/g, '')), 'RSVP wording present');

// Posting the answer
r = await hit('/panel-rsvp', form({ a: '5', p: SLUG, r: 'yes', s: sig(5, SLUG, 'yes') }));
check('yes is saved', r.status === 200 && state.updates.length === 1 && state.updates[0][0] === 'yes', JSON.stringify(state.updates));
check('guest from outside the college gets the photo ID note', r.text.includes('See you there') && r.text.includes('photo ID'), r.text.slice(0, 120));
check('the page offers a signed link to change the answer', /r=no&amp;s=|r=no&s=/.test(r.text), 'no change link');
r = await hit('/panel-rsvp', form({ a: '6', p: SLUG, r: 'yes', s: sig(6, SLUG, 'yes') }));
check('a host student gets no ID note', r.text.includes('See you there') && !r.text.includes('photo ID'), 'ID note shown to host student');
r = await hit('/panel-rsvp', form({ a: '5', p: SLUG, r: 'no', s: sig(5, SLUG, 'no') }));
check('no is saved and frees the seat', r.status === 200 && r.text.includes('free your seat') && state.updates.at(-1)[0] === 'no', r.text.slice(0, 120));
r = await hit('/panel-rsvp', form({ a: '5', p: SLUG, r: 'yes', s: sig(5, SLUG, 'no') }));
check('a signature for "no" cannot post "yes"', r.status === 400, r.status);
state.updateThrows = true;
r = await hit('/panel-rsvp', form({ a: '5', p: SLUG, r: 'yes', s: sig(5, SLUG, 'yes') }));
check('before migration 0043 the page says try again, not success', r.text.includes('could not save'), r.text.slice(0, 120));
state.updateThrows = false;

// The app route
r = await hit(`/api/attendees/5/panels/${SLUG}/rsvp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answer: 'yes' }) });
check('app answer needs a session', r.status === 401, r.status);
r = await hit(`/api/attendees/5/panels/${SLUG}/rsvp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie(5) }, body: JSON.stringify({ answer: 'no' }) });
check('app answer saves for the signed-in person', r.status === 200 && r.json.success && state.updates.at(-1)[1] === '5', r.status + ' ' + r.text);
r = await hit(`/api/attendees/6/panels/${SLUG}/rsvp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie(5) }, body: JSON.stringify({ answer: 'no' }) });
check("cannot answer for someone else", r.status === 403, r.status);

// Admin
r = await hit(`/api/admin/panels/${SLUG}/send-next-reminders`, { method: 'POST', body: '{}' });
check('reminder pump needs admin', r.status === 401, r.status);
state.rsvpColumns = false;
r = await hit(`/api/admin/panels/${SLUG}/send-next-reminders`, admin('POST', { batch: 5 }));
check('without migration 0043 the pump says so plainly', r.status === 409 && /0043/.test(r.json.error), r.status + ' ' + r.text);
state.rsvpColumns = true;
r = await hit(`/api/admin/panels/${SLUG}/send-next-reminders`, admin('POST', { batch: 5 }));
check('pump tries each pending person and records failures (no email key here)', r.status === 200 && r.json.sent === 0 && r.json.failed.length === 2 && state.sqls.some(q => /SET reminder_error = \?/.test(q)), r.status + ' ' + r.text);
r = await hit(`/api/admin/panels/${SLUG}/reminder-preview?guest=1`, admin());
check('preview for a guest: both buttons and the ID note', r.status === 200 && r.text.includes('Yes, I&rsquo;m coming') && r.text.includes('I can&rsquo;t make it') && r.text.includes('photo ID'), r.status);
check('preview never says RSVP', !/\bRSVP\b/i.test(r.text), 'RSVP wording in email');
r = await hit(`/api/admin/panels/${SLUG}/reminder-preview`, admin());
check('preview for a host student has no ID note', r.status === 200 && !r.text.includes('photo ID'), 'ID note in host preview');
r = await hit(`/api/admin/panels/${SLUG}/answers.csv?who=guests-coming`, admin());
const lines = r.text.replace(/^\ufeff/, '').split('\r\n');
check('guests-coming CSV lists only the outside guest who said yes', r.status === 200 && /text\/csv/.test(r.h['content-type']) && lines.length === 2 && lines[1].startsWith('Guest Person'), JSON.stringify(lines));
r = await hit(`/api/admin/panels/${SLUG}/answers.csv?who=all`, admin());
check('full CSV quotes commas in names', r.text.includes('"Host, Student"') && r.text.split('\r\n')[0].includes('coming'), r.text.slice(0, 120));
r = await hit('/api/admin/panels', admin());
check('overview stats report answers are enabled', r.status === 200 && Array.isArray(r.json) && r.json[0].rsvp_enabled === true && typeof r.json[0].rsvp_open === 'boolean', r.text.slice(0, 160));

// After the panel starts
const realNow = Date.now;
Date.now = () => Date.parse(panelField(SLUG, 'startsAt')) + 5 * 60 * 1000;
r = await hit('/panel-rsvp', form({ a: '5', p: SLUG, r: 'yes', s: sig(5, SLUG, 'yes') }));
check('after the start, answers are closed', r.text.includes('already started'), r.text.slice(0, 120));
Date.now = realNow;

// Someone already registered (here a conference registrant) fills in a panel page.
// The page tells them "you are set for this panel", so they must land on its list,
// and nothing about their own record may change. Found on production, 26 Sep.
const regWrites = [];
const EXISTING = { id: 85, event_id: 1, email: 'known@example.com', company: 'Their Company', job_title: 'Their Title', main_event: 1, registration_source: 'website' };
const regDB = {
  prepare(sql) {
    let args = [];
    const stmt = {
      bind(...a) { args = a; return stmt; },
      async first() { return /FROM attendees WHERE event_id = \? AND email = \?/.test(sql) ? EXISTING : null; },
      async all() { return { results: [] }; },
      async run() {
        regWrites.push({ sql, args });
        if (/INSERT INTO attendees/.test(sql)) throw new Error('D1_ERROR: UNIQUE constraint failed: attendees.event_id, attendees.email');
        return { meta: { changes: 1 } };
      },
    };
    return stmt;
  },
  async batch(list) { return Promise.all(list.map(s => s.all())); },
};
const regEnv = new Proxy({ SESSION_SECRET: SECRET, DB: regDB }, { get: (t, k) => (k in t ? t[k] : undefined) });
const register = async (source) => {
  regWrites.length = 0;
  const res = await worker.fetch(new Request('https://bharataiinnovation.com/api/events/1/attendees/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Someone Else', email: 'Known@Example.com', mobile: '1', company: 'Typed By A Stranger', job_title: 'Typed', city: 'Delhi', industry: 'Other', badge_type: 'Visitor Pass', registration_source: source }),
  }), regEnv, ctx);
  return res.status;
};
let st = await register('campus:' + SLUG);
const panelRow = regWrites.find(w => /INSERT OR IGNORE INTO panel_registrations/.test(w.sql));
check('an existing registrant who uses the panel page goes on that panel\'s list', !!panelRow && panelRow.args[0] === 85 && panelRow.args[1] === SLUG, st + ' ' + JSON.stringify(regWrites.map(w => w.sql.slice(0, 60))));
check('...without their profile, pass or conference place changing', !regWrites.some(w => /UPDATE attendees SET (?!is_online = 1, last_login_at)/.test(w.sql)), JSON.stringify(regWrites.map(w => w.sql.slice(0, 60))));
st = await register('website');
check('an existing registrant on a non-panel form joins no panel', !regWrites.some(w => /panel_registrations/.test(w.sql)), JSON.stringify(regWrites.map(w => w.sql.slice(0, 60))));

console.log(fails ? `\n${fails} FAILED` : '\nall "are you coming?" checks passed');
process.exit(fails ? 1 : 0);
