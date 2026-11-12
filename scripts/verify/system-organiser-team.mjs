// System: one person joins the organising team and leaves it again (12 Nov 2026),
// through the routes the admin panel itself calls, on the WHOLE built worker and
// real SQLite (conference-world.mjs + organiser-team-seed.mjs).
//   1. Admin sets Puja's pass to Organiser, as the Attendees grid does.
//   2. She is on every owner list: Conference, Inquiries, Teams & Passes.
//   3. She is given a speaker, a panel, an exhibitor and an enquiry.
//   4. Her pass prints ORGANISER in black and saffron, and the badge desk's check page
//      shows the same colours.
//   5. Her pass goes back to Visitor: she leaves the lists, and what she looks after
//      stays in her name until someone changes it.
// Run after `npm run build`:  node scripts/verify/system-organiser-team.mjs
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { makeWorld } from './conference-world.mjs';
import { seedTeam, TEAM } from './organiser-team-seed.mjs';

const W = await makeWorld({ migrated: true });
seedTeam(W);
const { call, rows } = W;
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 400))); if (!ok) fails++; };
const PUJA = 704;
const lists = async () => {
  const conf = (await call('GET', '/api/admin/events/1/conference')).json;
  const inq = (await call('GET', '/api/admin/inquiries')).json;
  const teams = (await call('GET', '/api/mp/admin/teams')).json;
  return { conf, inq, teams, names: { conference: conf.team.map(m => m.name), inquiries: inq.owners, exhibitors: teams.team.map(m => m.name) } };
};
const sandbox = { console }; sandbox.window = sandbox; sandbox.document = {};
vm.runInNewContext(readFileSync(fileURLToPath(new URL('../../public/js/pass-render.js', import.meta.url)), 'utf8'), sandbox);
const passOf = (id) => { const a = rows('SELECT badge_type, role FROM attendees WHERE id = ?', [id])[0]; return sandbox.BhaiPass.TIERS[sandbox.BhaiPass.tierFor(a)]; };
const verifyToken = (id) => id + '.' + crypto.createHmac('sha256', 'h').update('pass:' + id).digest('hex').slice(0, 24);

// ---- before ----
let L = await lists();
check('before: Puja, on a Visitor Pass, is on no team list', !L.names.conference.includes(TEAM.puja) && !L.names.inquiries.includes(TEAM.puja) && !L.names.exhibitors.includes(TEAM.puja), L.names);
check('before: her pass prints VISITOR PASS', passOf(PUJA).label === 'VISITOR PASS');

// ---- 1. the Organiser pass, as the Attendees grid sets it ----
let r = await call('PATCH', '/api/admin/attendees/' + PUJA, { badge_type: 'Organiser' });
check('Admin sets her pass to Organiser', r.status === 200 && rows('SELECT badge_type FROM attendees WHERE id = ?', [PUJA])[0].badge_type === 'Organiser', r);
check('...and it is in the audit log', rows("SELECT detail FROM admin_audit WHERE action = 'attendee.update' AND entity_id = ?", [String(PUJA)]).some(a => /Organiser/.test(a.detail)));

// ---- 2. on every list ----
L = await lists();
check('she is on the Conference owner list', L.names.conference.includes(TEAM.puja), L.names.conference);
check('she is on the enquiry Owner list', L.names.inquiries.includes(TEAM.puja), L.names.inquiries);
check('she is on the Teams & Passes owner list', L.names.exhibitors.includes(TEAM.puja), L.names.exhibitors);
check('the three lists name the same team', JSON.stringify(L.names.conference) === JSON.stringify(L.names.exhibitors) && L.names.conference.every(n => L.names.inquiries.includes(n)), L.names);

// ---- 3. she looks after a speaker, a panel, an exhibitor and an enquiry ----
const panel = L.conf.sessions.find(s => s.session_type === 'panel');
r = await call('PUT', '/api/admin/conference/owner', { kind: 'speaker', id: 1, owner: TEAM.puja });
check('a speaker given to her', r.json && r.json.owner === TEAM.puja, r);
r = await call('PUT', '/api/admin/conference/owner', { kind: 'session', id: panel.id, owner: TEAM.puja });
check('a panel discussion given to her', r.json && r.json.owner === TEAM.puja, r);
r = await call('PUT', '/api/mp/admin/teams/53/owner', { owner_name: TEAM.puja });
check('an exhibitor given to her, its emails to her own address (the sheet has none for her)', r.json && r.json.owner_name === TEAM.puja && r.json.owner_email === 'puja@team.example.test', r.json);
r = await call('PATCH', '/api/admin/inquiries/901', { assigned_to: TEAM.puja });
check('an enquiry given to her', r.status === 200 && rows('SELECT assigned_to FROM inquiries WHERE id = 901')[0].assigned_to === TEAM.puja);
L = await lists();
check('each screen now says she looks after it', L.conf.speakers.find(s => s.id === 1).owner === TEAM.puja && L.conf.sessions.find(s => s.id === panel.id).owner === TEAM.puja &&
  L.teams.teams.find(t => t.exhibitor_id === 53).owner_name === TEAM.puja && L.inq.inquiries.find(i => i.id === 901).assigned_to === TEAM.puja);

// ---- 4. her pass ----
const T = passOf(PUJA);
check('her pass prints ORGANISER, black with a saffron edge', T.label === 'ORGANISER' && T.ink === true && T.edge === '#FF7A00', T);
r = await call('GET', '/verify/' + verifyToken(PUJA), undefined, { admin: true });
check('the badge desk’s check page opens on her pass', r.status === 200 && r.text.includes(TEAM.puja) && r.text.includes('Organiser'), r.status);
check('...in the same black and saffron', /class="tier" style="background:#111114;color:#FFB066;"/.test(r.text), (r.text.match(/class="tier"[^>]*>/) || [''])[0]);
r = await call('GET', '/verify/' + verifyToken(706), undefined, { admin: true });
check('a Visitor’s check page keeps the blue, and a name with tags shows as text', r.status === 200 && /class="tier" style="background:#2B8CFF;color:#ffffff;"/.test(r.text) && r.text.includes('&lt;b&gt;Bold&lt;/b&gt;') && !r.text.includes('<b>Bold</b>'), (r.text.match(/class="tier"[^>]*>/) || [''])[0]);

// ---- 5. back to Visitor ----
r = await call('PATCH', '/api/admin/attendees/' + PUJA, { badge_type: 'Visitor Pass' });
L = await lists();
check('back on a Visitor Pass, she leaves the Conference and Teams lists', r.status === 200 && !L.names.conference.includes(TEAM.puja) && !L.names.exhibitors.includes(TEAM.puja), L.names);
check('what she looked after is still in her name, for someone to hand on', L.conf.speakers.find(s => s.id === 1).owner === TEAM.puja && L.conf.sessions.find(s => s.id === panel.id).owner === TEAM.puja &&
  L.teams.teams.find(t => t.exhibitor_id === 53).owner_name === TEAM.puja && rows('SELECT assigned_to FROM inquiries WHERE id = 901')[0].assigned_to === TEAM.puja);
check('the enquiry list still offers her name, because an enquiry carries it', L.names.inquiries.includes(TEAM.puja));
check('her pass prints VISITOR PASS again', passOf(PUJA).label === 'VISITOR PASS');
r = await call('PUT', '/api/admin/conference/owner', { kind: 'speaker', id: 1, owner: TEAM.ujwala });
check('handing her speaker on to Ujwala works as any change does', r.json && r.json.owner === TEAM.ujwala && r.json.changed === true);

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
