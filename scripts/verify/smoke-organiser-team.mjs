// Integration: the organising team as owners (12 Nov 2026), through the WHOLE built
// worker on real SQLite with the production schema, 0054 and 0050 applied
// (conference-world.mjs + organiser-team-seed.mjs). The organiser's request: the team
// hold the Organiser pass and look after enquiries, exhibitors, speakers and panels.
//   - Conference: the team in the screen's one read, an owner on every speaker and
//     session, set from the list's box or with a save, kept by a save or a drag that
//     does not carry one, gone with the speaker or session, in the audit log;
//   - Inquiries: the team on the Owner list;
//   - Teams & Passes: the team for the box, the owner's work address found from the
//     booking sheet, nothing else on the row touched;
//   - who may call each, and the refusals.
// Run after `npm run build`:  node scripts/verify/smoke-organiser-team.mjs
import { makeWorld } from './conference-world.mjs';
import { seedTeam, TEAM } from './organiser-team-seed.mjs';

const W = await makeWorld({ migrated: true });
seedTeam(W);
const { call, rows } = W;
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 400))); if (!ok) fails++; };
const conf = async () => (await call('GET', '/api/admin/events/1/conference')).json;
const ownerRow = (kind, id) => rows("SELECT value FROM app_settings WHERE key = ?", ['owner:' + kind + ':' + id])[0];
const audits = (action) => rows('SELECT * FROM admin_audit WHERE action = ? ORDER BY id', [action]);

// ---- who may call ----
check('the Conference read needs the admin password', (await call('GET', '/api/admin/events/1/conference', undefined, { admin: false })).status === 401);
check('setting an owner needs it too', (await call('PUT', '/api/admin/conference/owner', { kind: 'speaker', id: 2, owner: TEAM.ujwala }, { admin: false })).status === 401 && !ownerRow('speaker', 2));
check('Teams & Passes refuses a stranger', (await call('GET', '/api/mp/admin/teams', undefined, { admin: false })).status === 403);
check('...and so does its Owner box', (await call('PUT', '/api/mp/admin/teams/51/owner', { owner_name: TEAM.ujwala }, { admin: false })).status === 403);

// ---- Conference: the team and no owners yet ----
let d = await conf();
check('the screen gets the team: Organiser pass holders of this event, by name, once', JSON.stringify((d.team || []).map(m => m.name)) === JSON.stringify(['Aswin Kumar', 'Ujwala Jangam']), d.team);
check('...names only: no team member’s email goes to the page', (d.team || []).every(m => Object.keys(m).join() === 'name'));
check('a Visitor, the Delhi organiser and a name with tags are not on it', !JSON.stringify(d.team).match(/Puja|Delhi|Bold/));
check('every speaker and session says nobody yet', d.speakers.every(s => s.owner === '') && d.sessions.every(s => s.owner === ''));

// ---- from the list's box ----
let r = await call('PUT', '/api/admin/conference/owner', { kind: 'speaker', id: 2, owner: 'ujwala  jangam' });
check('a speaker given to a team member', r.status === 200 && r.json.owner === TEAM.ujwala && r.json.changed === true, r);
check('...kept with her email', JSON.parse(ownerRow('speaker', 2).value).email === 'ujwala@team.example.test');
check('...and the screen shows it', (await conf()).speakers.find(s => s.id === 2).owner === TEAM.ujwala);
check('the audit log says who, from whom, to whom', (() => { const a = audits('speaker.owner'); const x = a.length && JSON.parse(a[0].detail); return a.length === 1 && a[0].entity === 'speaker' && a[0].entity_id === '2' && x.from === '(nobody)' && x.to === TEAM.ujwala && x.name === 'Tarun Chugh' && a[0].actor === 'Harness'; })(), audits('speaker.owner'));
r = await call('PUT', '/api/admin/conference/owner', { kind: 'speaker', id: 2, owner: TEAM.ujwala });
check('the same owner again changes nothing and logs nothing', r.json.changed === false && audits('speaker.owner').length === 1);
check('a kind it does not know is refused', (await call('PUT', '/api/admin/conference/owner', { kind: 'exhibitor', id: 2, owner: TEAM.ujwala })).status === 400);
check('no id is refused', (await call('PUT', '/api/admin/conference/owner', { kind: 'speaker', owner: TEAM.ujwala })).status === 400);
check('a speaker who is not there is a 404, and nothing is stored', (await call('PUT', '/api/admin/conference/owner', { kind: 'speaker', id: 999, owner: TEAM.ujwala })).status === 404 && !ownerRow('speaker', 999));
const panel = d.sessions.find(s => s.session_type === 'panel');
r = await call('PUT', '/api/admin/conference/owner', { kind: 'session', id: panel.id, owner: TEAM.aswin });
check('a panel discussion given to a team member', r.status === 200 && (await conf()).sessions.find(s => s.id === panel.id).owner === TEAM.aswin);
r = await call('PUT', '/api/admin/conference/owner', { kind: 'session', id: panel.id, owner: '' });
check('...and to nobody again: the row goes', r.json.owner === '' && r.json.changed && !ownerRow('session', panel.id));

// ---- with a save ----
const body = (s, extra = {}) => ({ event_id: 1, title: s.title, session_type: s.session_type, room: s.room, start_time: s.start_time, end_time: s.end_time,
  speakers: (s.links || []).map(l => ({ speaker_id: l.speaker_id, role: l.role })), others: s.others || '', description: s.description || '', track: s.track || '', capacity: s.capacity || 100, status: s.status, note: s.note || '', ...extra });
r = await call('PUT', '/api/admin/sessions/' + panel.id, body(panel, { owner: TEAM.aswin, force: true }));
check('a session saved with an owner keeps it', r.status === 200 && (await conf()).sessions.find(s => s.id === panel.id).owner === TEAM.aswin, r);
r = await call('PUT', '/api/admin/sessions/' + panel.id, body(panel, { note: 'Second panellist to confirm', force: true }));
check('a save without the box (another screen) keeps the owner', r.status === 200 && (await conf()).sessions.find(s => s.id === panel.id).owner === TEAM.aswin);
r = await call('POST', '/api/admin/sessions/' + panel.id + '/move', { start_time: '2026-11-20 15:00', end_time: '2026-11-20 16:00', force: true });
check('a drag to another time keeps the owner', r.status === 200 && (await conf()).sessions.find(s => s.id === panel.id).owner === TEAM.aswin, r);
r = await call('POST', '/api/admin/sessions', { event_id: 1, title: 'Women in AI', session_type: 'panel', room: 'Kalam Theatre', start_time: '2026-11-21 15:00', end_time: '2026-11-21 16:00', speakers: [], others: '', status: 'published', owner: TEAM.ujwala });
const newSession = r.json && r.json.id;
check('a new session added with an owner has one', r.status === 201 && (await conf()).sessions.find(s => s.id === newSession).owner === TEAM.ujwala, r);
const clash = await call('POST', '/api/admin/sessions', { event_id: 1, title: 'Clashing', session_type: 'talk', room: 'Kalam Theatre', start_time: '2026-11-21 15:00', end_time: '2026-11-21 15:30', speakers: [], status: 'published', owner: TEAM.ujwala });
check('a session refused for a clash leaves no owner behind', clash.status === 409 && rows("SELECT COUNT(*) AS n FROM app_settings WHERE key LIKE 'owner:session:%'")[0].n === 2);
r = await call('PUT', '/api/admin/speakers/3', { owner: TEAM.aswin });
check('a speaker saved with only the owner changed gets it', r.status === 200 && (await conf()).speakers.find(s => s.id === 3).owner === TEAM.aswin, r);
r = await call('PUT', '/api/admin/speakers/3', { topic: 'Agentic AI' });
check('a speaker saved without the box keeps the owner', r.status === 200 && (await conf()).speakers.find(s => s.id === 3).owner === TEAM.aswin);
r = await call('POST', '/api/admin/speakers', { event_id: 1, name: 'Asha Rao', organisation: 'Tata Capital', owner: 'A Volunteer' });
const asha = r.json && r.json.id;
check('a new speaker added with an owner who is not on the team keeps the name, no email', r.status === 201 && (await conf()).speakers.find(s => s.id === asha).owner === 'A Volunteer' && JSON.parse(ownerRow('speaker', asha).value).email === '', r);
check('every change is in the audit log', audits('speaker.owner').length === 3 && audits('session.owner').length === 4, [audits('speaker.owner').length, audits('session.owner').length]);

// ---- gone with what it belonged to ----
check('deleting a speaker removes their owner', (await call('DELETE', '/api/admin/speakers/' + asha)).status === 200 && !ownerRow('speaker', asha));
check('deleting a session removes its owner', (await call('DELETE', '/api/admin/sessions/' + newSession)).status === 200 && !ownerRow('session', newSession) && !!ownerRow('session', panel.id));

// ---- Inquiries ----
const inq = (await call('GET', '/api/admin/inquiries')).json;
check('the enquiry Owner list has the team', (inq.owners || []).includes('Aswin Kumar') && (inq.owners || []).includes(TEAM.ujwala), inq.owners);
check('...and still the owner already on an enquiry', (inq.owners || []).includes('Someone Else'));
check('...but not a Visitor or the Delhi organiser, and each name once', !(inq.owners || []).some(n => /Puja|Delhi/.test(n)) && (inq.owners || []).filter(n => /ujwala/i.test(n)).length === 1, inq.owners);
r = await call('PATCH', '/api/admin/inquiries/901', { assigned_to: TEAM.aswin });
check('an enquiry given to a team member', r.status === 200 && rows('SELECT assigned_to FROM inquiries WHERE id = 901')[0].assigned_to === TEAM.aswin, r);

// ---- Teams & Passes ----
let t = (await call('GET', '/api/mp/admin/teams')).json;
check('Teams & Passes gets the team for the Owner box', JSON.stringify((t.team || []).map(m => m.name)) === JSON.stringify(['Aswin Kumar', 'Ujwala Jangam']), t.team);
const ex = (id) => t.teams.find(x => x.exhibitor_id === id);
check('each exhibitor carries its owner and their address from the sheet', ex(51).owner_name === 'Aswin Krishna Kumar' && ex(51).owner_email === 'aswin.k@work.example.test' && ex(53).owner_name === '', [ex(51), ex(53)]);
r = await call('PUT', '/api/mp/admin/teams/53/owner', { owner_name: TEAM.ujwala });
check('an exhibitor with no row given to Ujwala: her work address from the sheet, not her login', r.status === 200 && r.json.owner_email === 'ujwala.j@work.example.test' && rows('SELECT owner_name, owner_email FROM exhibitor_team_settings WHERE exhibitor_id = 53')[0].owner_name === TEAM.ujwala, r);
r = await call('PUT', '/api/mp/admin/teams/52/owner', { owner_name: 'Aswin Kumar' });
check('"Aswin Kumar" finds the sheet’s "Aswin Krishna Kumar" by first and last name', r.json.owner_email === 'aswin.k@work.example.test', r.json);
r = await call('PUT', '/api/mp/admin/teams/51/owner', { owner_name: 'Ujwala   Jangam' });
check('a changed owner leaves the number of passes and the contact as they were', r.json.changed && (() => { const x = rows('SELECT passes, contact_name, owner_name FROM exhibitor_team_settings WHERE exhibitor_id = 51')[0]; return x.passes === 3 && x.contact_name === 'Riya' && x.owner_name === TEAM.ujwala; })());
r = await call('PUT', '/api/mp/admin/teams/51/owner', { owner_name: TEAM.ujwala });
check('the same owner again changes nothing', r.json.changed === false);
r = await call('PUT', '/api/mp/admin/teams/51/owner', { owner_name: 'Meera Nobody' });
check('a name with no address anywhere is kept, with no address (the team inbox is used)', r.json.owner_name === 'Meera Nobody' && r.json.owner_email === '');
r = await call('PUT', '/api/mp/admin/teams/51/owner', { owner_name: '' });
check('nobody: the name and address are cleared', r.json.owner_name === '' && rows('SELECT owner_name, owner_email FROM exhibitor_team_settings WHERE exhibitor_id = 51')[0].owner_email === '');
check('an exhibitor that is not there is a 404', (await call('PUT', '/api/mp/admin/teams/999/owner', { owner_name: TEAM.ujwala })).status === 404);
check('each of the five changes is in the audit log, the unchanged one is not', audits('marketplace.team-owner').length === 5 && JSON.parse(audits('marketplace.team-owner')[0].detail).to === TEAM.ujwala && JSON.parse(audits('marketplace.team-owner')[4].detail).to === '(nobody)', audits('marketplace.team-owner').map(a => a.detail));
t = (await call('GET', '/api/mp/admin/teams')).json;
check('Teams & Passes now reads the new owners', ex(53).owner_name === TEAM.ujwala && ex(52).owner_name === 'Aswin Kumar' && ex(51).owner_name === '');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
