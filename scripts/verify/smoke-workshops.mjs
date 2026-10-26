// Built-worker checks for workshop seats (0049): a Premium Delegate or VIP Pass
// includes one workshop, chosen in the app after paying, first come, first served.
// Run after `npm run build`:  node scripts/verify/smoke-workshops.mjs
//
// The database is a stand-in that keeps the seat limit the way the SQL does
// (everyone but the chooser is counted). check-workshop-sql.py runs the worker's
// actual statements on a real SQLite engine: DUMP_SQL=ws.json writes them down.
import crypto from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { sessionCookie } from './pay-db.mjs';
const worker = (await import(new URL('../../dist/_worker.js?' + Date.now(), import.meta.url).href)).default;

const SESSION = 'smoke-session', ADMIN = 'smoke-admin';
const state = { ready: false, settings: {}, attendees: {}, workshops: [], seats: [], audits: [], sqls: [] };
const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const person = (id, over = {}) => (state.attendees[id] = { id, event_id: 1, name: 'Person ' + id, email: `p${id}@example.com`, mobile: '9820000000',
  company: 'Acme', job_title: 'CTO', badge_type: 'Visitor Pass', payment_status: 'paid', avatar_url: '', main_event: 1, ...over });
const seed = () => {
  state.workshops = [
    { id: 1, event_id: 1, slug: 'cxo-guide', title: 'Data Science to Agentic AI', speaker: 'Dr. Vinay Kulkarni', summary: '', starts_at: null, ends_at: null, room: null, capacity: 100, is_open: 1, sort_order: 1 },
    { id: 2, event_id: 1, slug: 'fde-workshop', title: 'From Prototype to Production', speaker: 'Dr. Ashish Tendulkar', summary: '', starts_at: null, ends_at: null, room: null, capacity: 100, is_open: 1, sort_order: 2 },
  ];
};
const taken = (wid, except) => state.seats.filter(s => s.workshop_id === wid && s.attendee_id !== except).length;

const DB = {
  prepare(sql) {
    let args = [];
    const flat = sql.replace(/\s+/g, ' ').trim();
    const stmt = {
      bind(...a) { args = a; return stmt; },
      async first() {
        state.sqls.push({ sql, args });
        if (/^SELECT id FROM workshops? ?(_seats)? LIMIT 1$/.test(flat) || /^SELECT id FROM workshop_seats LIMIT 1$/.test(flat)) { if (!state.ready) throw new Error('no such table'); return null; }
        if (/^SELECT value FROM app_settings WHERE key = \?$/.test(flat)) return args[0] in state.settings ? { value: state.settings[args[0]] } : null;
        if (/^SELECT workshop_id FROM workshop_seats WHERE event_id = 1 AND attendee_id = \?$/.test(flat)) { const s = state.seats.find(x => x.attendee_id === args[0]); return s ? { workshop_id: s.workshop_id } : null; }
        if (/^SELECT w\.title FROM workshop_seats s JOIN workshops w/.test(flat)) { const s = state.seats.find(x => x.attendee_id === Number(args[0])); const w = s && state.workshops.find(x => x.id === s.workshop_id); return w ? { title: w.title } : null; }
        if (/FROM attendees WHERE id = \?$/.test(flat)) { const a = state.attendees[Number(args[0])]; return a ? { ...a } : null; }
        return null;
      },
      async all() {
        state.sqls.push({ sql, args });
        if (/FROM workshops w WHERE w\.event_id = 1 ORDER BY/.test(flat)) {
          return { results: state.workshops.map(w => ({ ...w, taken: taken(w.id, -1) })).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id) };
        }
        if (/FROM workshop_seats s JOIN attendees a ON a\.id = s\.attendee_id/.test(flat)) {
          return { results: state.seats.map(s => ({ ...state.attendees[s.attendee_id], workshop_id: s.workshop_id, chosen_by: s.chosen_by, updated_at: s.updated_at })) };
        }
        if (/AND a\.id NOT IN \(SELECT attendee_id FROM workshop_seats/.test(flat)) {
          return { results: Object.values(state.attendees).filter(a => a.event_id === 1 && args.includes(a.badge_type)
            && !['pending', 'refunded'].includes(String(a.payment_status || '').toLowerCase()) && !state.seats.some(s => s.attendee_id === a.id))
            .sort((x, y) => x.name.localeCompare(y.name)) };
        }
        return { results: [] };
      },
      async run() {
        state.sqls.push({ sql, args });
        if (/^INSERT INTO workshop_seats/.test(flat)) {
          const [aid, wid, by] = args;
          const w = state.workshops.find(x => x.id === wid && x.event_id === 1);
          if (!w || taken(wid, aid) >= w.capacity) return { meta: { changes: 0 } };
          const mine = state.seats.find(s => s.attendee_id === aid);
          if (mine) Object.assign(mine, { workshop_id: wid, chosen_by: by, updated_at: nowSql() });
          else state.seats.push({ attendee_id: aid, workshop_id: wid, chosen_by: by, updated_at: nowSql() });
          return { meta: { changes: 1 } };
        }
        if (/^DELETE FROM workshop_seats WHERE event_id = 1 AND attendee_id = \?$/.test(flat)) {
          const n = state.seats.length; state.seats = state.seats.filter(s => s.attendee_id !== args[0]); return { meta: { changes: n - state.seats.length } };
        }
        if (/^UPDATE workshops SET starts_at = \?/.test(flat)) {
          const w = state.workshops.find(x => x.id === args[5]);
          if (w) Object.assign(w, { starts_at: args[0], ends_at: args[1], room: args[2], capacity: args[3], is_open: args[4] });
          return { meta: { changes: w ? 1 : 0 } };
        }
        if (/^INSERT INTO app_settings .*'workshop_choice_closes'/.test(flat)) { state.settings.workshop_choice_closes = args[0]; return { meta: { changes: 1 } }; }
        if (/^INSERT INTO admin_audit/.test(flat)) { state.audits.push({ actor: args[0], action: args[2], entity_id: args[4], detail: args[5] }); return { meta: { changes: 1 } }; }
        return { meta: { changes: 0 } };
      },
    };
    return stmt;
  },
  async batch(list) { return Promise.all(list.map(s => s.run())); },
};

const env = new Proxy({ ADMIN_SECRET: ADMIN, SESSION_SECRET: SESSION, DB }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };
const hit = async (path, init = {}) => {
  const res = await worker.fetch(new Request('https://bharataiinnovation.com' + path, { redirect: 'manual', ...init }), env, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
};
const as = (id) => ({ headers: { Cookie: sessionCookie(SESSION, id) } });
const choose = (id, wid) => hit('/api/workshops/choose', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(id ? { Cookie: sessionCookie(SESSION, id) } : {}) }, body: JSON.stringify({ workshop_id: wid }) });
const admin = (path, body) => hit(path, body === undefined
  ? { headers: { Authorization: 'Bearer ' + ADMIN } }
  : { method: 'POST', headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const passToken = (id) => id + '.' + crypto.createHmac('sha256', SESSION).update('pass:' + id).digest('hex').slice(0, 24);
const seatOf = (id) => (state.seats.find(s => s.attendee_id === id) || {}).workshop_id ?? null;
const istStamp = (ms) => { const d = new Date(ms + 5.5 * 3600e3); return d.toISOString().slice(0, 16).replace('T', ' '); };

let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };

person(1);                                                                   // Visitor
person(2, { badge_type: 'Premium Delegate Pass', payment_status: 'pending' }); // chose Premium, not paid
person(3, { badge_type: 'Premium Delegate Pass', name: 'Asha Rao' });
person(4, { badge_type: 'VIP Pass', name: 'Bela Shah' });
person(5, { badge_type: 'Premium Delegate Pass', name: 'Chitra Iyer' });
person(6, { badge_type: 'Delegate Pass' });
person(7, { badge_type: 'VIP Pass', name: 'Dev Mehta', payment_status: 'waived' });
person(8, { badge_type: 'Premium Delegate Pass', name: 'Esha Nair', event_id: 2 });

// ---- before 0049 ----
let r = await hit('/api/workshops');
check('before 0049: the app is told it is not ready, and shown nothing', r.status === 200 && r.json?.ready === false && Array.isArray(r.json?.workshops) && r.json.workshops.length === 0, r.text);
r = await choose(3, 1);
check('before 0049: choosing answers 503 with a sentence', r.status === 503 && /open soon/.test(r.json?.error || ''), r.status + ' ' + r.text);
r = await admin('/api/admin/workshops');
check('before 0049: admin is told the migration is missing', r.status === 200 && r.json?.ready === false, r.text);

// ---- the list ----
state.ready = true; seed();
r = await hit('/api/workshops');
check('signed out: both workshops, not entitled, asked to sign in', r.json?.ready === true && r.json.workshops.length === 2 && r.json.entitled === false && r.json.why === 'signin' && r.json.mine === null, r.text);
check('the public answer never carries seat counts', !/"taken"|"capacity"|"left"/.test(r.text) && r.json.workshops.every(w => w.full === false && w.few_left === null), r.text);
check('times not fixed yet come back empty (the app says to be announced)', r.json.workshops.every(w => w.starts_at === null && w.room === ''), r.text);
r = await hit('/api/workshops', as(1));
check('a Visitor is not entitled: the reason is the pass', r.json?.entitled === false && r.json.why === 'tier', r.text);
r = await choose(1, 1);
check('a Visitor cannot take a seat', r.status === 403 && /Premium Delegate and VIP/.test(r.json?.error || '') && seatOf(1) === null, r.status + ' ' + r.text);
r = await choose(6, 1);
check('a Delegate cannot take a seat', r.status === 403 && seatOf(6) === null, r.status + ' ' + r.text);
r = await hit('/api/workshops', as(2));
check('an unpaid Premium Delegate is told to pay first', r.json?.entitled === false && r.json.why === 'unpaid', r.text);
r = await choose(2, 1);
check('and cannot take a seat until the payment lands', r.status === 403 && /not paid yet/.test(r.json?.error || '') && seatOf(2) === null, r.status + ' ' + r.text);
r = await choose(null, 1);
check('choosing needs a session', r.status === 401, r.status);

// ---- taking and switching ----
r = await choose(3, 1);
check('a paid Premium Delegate takes a seat', r.status === 200 && r.json?.mine === 1 && seatOf(3) === 1 && r.json.entitled === true, r.status + ' ' + r.text);
check('and it is written to the audit log', state.audits.some(a => a.action === 'workshop.seat-taken' && a.entity_id === '3'), JSON.stringify(state.audits));
r = await choose(3, 1);
check('choosing the same workshop again changes nothing', r.status === 200 && state.seats.filter(s => s.attendee_id === 3).length === 1, r.text);
r = await choose(3, 2);
check('before the cut-off a seat can be switched, still one seat', r.status === 200 && r.json?.mine === 2 && seatOf(3) === 2 && state.seats.length === 1 && state.audits.some(a => a.action === 'workshop.seat-switched'), r.text);
r = await choose(7, 1);
check('a waived VIP (set by the organisers) holds a seat too', r.status === 200 && seatOf(7) === 1, r.status + ' ' + r.text);
r = await choose(3, 99);
check('a workshop that does not exist is refused', r.status === 400 && seatOf(3) === 2, r.status);

// ---- the seat limit ----
r = await admin('/api/admin/workshops/1', { starts_at: '', ends_at: '', room: '', capacity: 2, is_open: true });
check('admin sets a workshop to 2 seats', r.status === 200 && state.workshops[0].capacity === 2, r.text);
r = await choose(4, 1);
check('the second seat goes', r.status === 200 && seatOf(4) === 1, r.text);
r = await choose(5, 1);
check('the third person is told it filled up, and given the state to choose again', r.status === 409 && /filled up/.test(r.json?.error || '') && r.json?.workshops?.[0]?.full === true && seatOf(5) === null, r.status + ' ' + r.text);
r = await choose(4, 1);
check('someone already in a full workshop is not pushed out by choosing it again', r.status === 200 && seatOf(4) === 1, r.text);
r = await choose(3, 1);
check('nobody can switch into a full workshop', r.status === 409 && seatOf(3) === 2, r.status + ' ' + r.text);
r = await admin('/api/admin/workshops/2', { starts_at: '', ends_at: '', room: '', capacity: 21, is_open: true });
r = await hit('/api/workshops', as(5));
check('with 20 or fewer seats left, the count is shown, and only then', r.json?.workshops?.[1]?.few_left === 20 && r.json.workshops[1].full === false, r.text);
r = await admin('/api/admin/workshops/2', { starts_at: '', ends_at: '', room: '', capacity: 100, is_open: true });

// ---- closing ----
r = await admin('/api/admin/workshops/2', { starts_at: '', ends_at: '', room: '', capacity: 100, is_open: false });
r = await choose(5, 2);
check('a workshop closed in admin cannot be chosen', r.status === 409 && /closed/.test(r.json?.error || '') && seatOf(5) === null, r.status + ' ' + r.text);
r = await admin('/api/admin/workshops/2', { starts_at: istStamp(Date.now() - 3600e3), ends_at: '', room: 'Kalam Theatre', capacity: 100, is_open: true });
r = await choose(5, 2);
check('a workshop that has started cannot be chosen', r.status === 409 && seatOf(5) === null, r.status + ' ' + r.text);
r = await admin('/api/admin/workshops/2', { starts_at: '2026-11-21 14:00', ends_at: '2026-11-21 15:00', room: 'Kalam Theatre', capacity: 100, is_open: true });
r = await hit('/api/workshops', as(5));
check('a fixed slot and room reach the app', r.json?.workshops?.[1]?.starts_at === '2026-11-21 14:00' && r.json.workshops[1].room === 'Kalam Theatre', r.text);
r = await admin('/api/admin/workshop-settings', { switch_closes: istStamp(Date.now() - 60e3) });
check('admin sets the switching cut-off', r.status === 200 && state.settings.workshop_choice_closes, r.text);
r = await choose(4, 2);
check('after the cut-off a seat is fixed', r.status === 409 && /fixed now/.test(r.json?.error || '') && seatOf(4) === 1, r.status + ' ' + r.text);
r = await choose(5, 2);
check('but someone without a seat may still take one while seats last', r.status === 200 && seatOf(5) === 2, r.status + ' ' + r.text);
r = await hit('/api/workshops', as(4));
check('the app is told switching is closed', r.json?.can_switch === false, r.text);

// ---- admin ----
r = await hit('/api/admin/workshops');
check('the admin list needs the admin secret', r.status === 401, r.status);
r = await admin('/api/admin/workshops');
const W = r.json || {};
check('admin sees exact numbers per workshop', W.ready && W.workshops[0].taken === 2 && W.workshops[0].capacity === 2 && W.workshops[1].taken === 2, r.text);
check('admin sees who sits where', W.seats.length === 4 && W.seats.some(s => s.name === 'Bela Shah' && s.workshop_id === 1), JSON.stringify(W.seats));
person(9, { badge_type: 'VIP Pass', name: 'Farah Khan' });
r = await admin('/api/admin/workshops');
check('paid for a seat and not chosen: listed; unpaid, other passes and other events: not', r.json.unchosen.map(p => p.name).join() === 'Farah Khan', JSON.stringify(r.json.unchosen));
r = await admin('/api/admin/workshops/1', { starts_at: 'next tuesday', ends_at: '', room: '', capacity: 50, is_open: true });
check('a time that is not a time is refused', r.status === 400 && /2026-11-21 14:00/.test(r.json?.error || ''), r.text);
r = await admin('/api/admin/workshops/1', { starts_at: '', ends_at: '', room: '', capacity: 1, is_open: true });
check('the seats cannot go below the seats already taken', r.status === 400 && state.workshops[0].capacity === 2, r.text);
r = await admin('/api/admin/workshop-seat', { attendee_id: 9, workshop_id: 1 });
check('admin cannot place someone in a full workshop', r.status === 409 && seatOf(9) === null, r.status + ' ' + r.text);
r = await admin('/api/admin/workshop-seat', { attendee_id: 9, workshop_id: 2 });
check('admin places someone, past the cut-off', r.status === 200 && seatOf(9) === 2 && /^admin:/.test(state.seats.find(s => s.attendee_id === 9).chosen_by), r.text);
r = await admin('/api/admin/workshop-seat', { attendee_id: 4, workshop_id: null });
check('admin removes a seat', r.status === 200 && seatOf(4) === null, r.text);
r = await admin('/api/admin/workshop-settings', { switch_closes: 'soon' });
check('a cut-off that is not a time is refused', r.status === 400, r.status);

// ---- the door scan ----
// The details on a scanned pass are for badge staff only; admin counts as staff.
const staffView = { headers: { Authorization: 'Bearer ' + ADMIN } };
r = await hit('/verify/' + passToken(3), staffView);
check('scanned by staff, the pass names the workshop of a seat holder (the one they switched to)', r.status === 200 && /Workshop:<\/strong> From Prototype to Production/.test(r.text), r.status + ' ' + (r.text.match(/<div class="card">[\s\S]{0,200}/) || [''])[0]);
r = await hit('/verify/' + passToken(1), staffView);
check('and says nothing about workshops for someone without one', r.status === 200 && /Person 1/.test(r.text) && !/Workshop:<\/strong>/.test(r.text), r.status);
r = await hit('/verify/' + passToken(3));
check('scanned by anyone else, it shows no workshop or other detail', r.status === 200 && !/Workshop:<\/strong>/.test(r.text), r.status);

// ---- the pages ----
r = await hit('/app');
for (const m of ['id="ws-panel"', 'id="pcc-workshop"', 'function loadWorkshopSeat', 'function wsTake', 'function openWorkshopChoice', "act === 'workshop'", "case 'workshops': loadWorkshopSeat(true)", 'More workshops, coming soon'])
  check('/app carries ' + m, r.text.includes(m), 'missing');
check('/app no longer sends the coming-soon workshops to a register page', !/fa-ticket-alt"><\/i>Register Now/.test(r.text), 'a Register Now is left');
r = await hit('/admin');
for (const m of ['data-section="workshops"', 'id="section-workshops"', 'function loadAdminWorkshops', 'function adminWsCsv', "case 'workshops': loadAdminWorkshops()"])
  check('/admin carries ' + m, r.text.includes(m), 'missing');
r = await hit('/register');
check('/register says the seat is chosen in the app, not by email', r.text.includes('you choose your seat in the app') && !/we email you the workshops/.test(r.text), 'old promise');

if (process.env.DUMP_SQL) writeFileSync(process.env.DUMP_SQL, JSON.stringify(state.sqls.map(s => s.sql).filter((v, i, a) => a.indexOf(v) === i), null, 1));
console.log(fails ? `\n${fails} workshop check(s) failed` : '\nall workshop checks passed');
process.exit(fails ? 1 : 0);
