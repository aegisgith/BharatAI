// Integration: who an admin email may be sent from (13 Nov 2026), through the WHOLE
// built worker on real SQLite. Only an admin may ask; the event's own address first;
// the organising team (Organiser pass) on our domain; team members on other domains
// listed apart with the reason; another event's team is not this event's.
// Run after `npm run build`:  node scripts/verify/smoke-senders.mjs
import { makeWorld } from './talk-self-world.mjs';

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 400))); if (!ok) fails++; };
const admin = { headers: { Authorization: 'Bearer h-admin', 'X-Admin-Actor': 'Harness' } };

const W = await makeWorld();
const add = (id, name, email, badge, event = 1) =>
  W.db.run('INSERT INTO attendees (id, event_id, name, email, badge_type) VALUES (?, ?, ?, ?, ?)', [id, event, name, email, badge]);
add(108, 'Anita Ram', 'anita.r@bharataiinnovation.com', 'Organiser');
add(368, 'Ayesha Ahmed', 'Ayesha.A@BharatAIInnovation.com', 'Organiser');
add(531, 'Rohit Outside', 'rohit@gmail.com', 'Organiser');
add(600, 'A Delegate', 'someone@bharataiinnovation.com', 'Delegate');
add(700, 'Delhi Organiser', 'delhi.o@bharataiinnovation.com', 'Organiser', 2);

let r = await W.call('GET', '/api/admin/events/1/senders');
check('nobody but an admin may see the list', r.status === 401 || r.status === 403, r.status);

r = await W.call('GET', '/api/admin/events/1/senders', undefined, admin);
const S = (r.json && r.json.senders) || [];
check('the answer names our domain', r.status === 200 && r.json.domain === 'bharataiinnovation.com', r.json);
check('the event’s own address comes first, as the default, with its sender name', S[0] && S[0].email === 'register@bharataiinnovation.com' && S[0].default === true && /Bharat AI Innovation/.test(S[0].name), S[0]);
check('team members on our domain follow, by name, as "<Name>, Bharat AI Innovation"', S.some(s => s.email === 'anita.r@bharataiinnovation.com' && s.name === 'Anita Ram, Bharat AI Innovation') && S.some(s => s.email === 'ayesha.a@bharataiinnovation.com'), S);
check('someone without the Organiser pass is not a sender, even on our domain', !S.some(s => s.email === 'someone@bharataiinnovation.com'), S);
check('another event’s team is not this event’s', !S.some(s => s.email === 'delhi.o@bharataiinnovation.com'), S);
check('a team member on another domain is listed apart, with the reason', (r.json.outside || []).some(o => o.name === 'Rohit Outside' && /cannot be sent as them/.test(o.reason)) && !S.some(s => s.email === 'rohit@gmail.com'), r.json.outside);

W.db.run("INSERT INTO app_settings (key, value) VALUES ('sender_email', 'Events@BharatAIInnovation.com'), ('sender_name', 'Bharat AI Innovation 2026')");
r = await W.call('GET', '/api/admin/events/1/senders', undefined, admin);
check('the default follows the sender set in Settings', r.json.senders[0].email === 'events@bharataiinnovation.com' && r.json.senders[0].name === 'Bharat AI Innovation 2026', r.json.senders[0]);

r = await W.call('GET', '/api/admin/events/abc/senders', undefined, admin);
check('a nonsense event is refused', r.status === 400, r.status);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
