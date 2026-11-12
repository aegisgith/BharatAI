// System: one exhibitor from "please add our logo" to the app, with nobody retyping
// anything (12 Nov 2026). Built worker, real SQLite, the uploads bucket played. Ravi,
// the booth contact, emails the logo; the team opens Submissions, sees it already
// matched and presses Use it; the app serves the file. He emails the people coming to
// the booth; they are added and their passes issued. The speaker emails her photo; the
// app's talks list shows it. The website script's list has both files. The people just
// added are now known senders. Then "without asking" is switched on, a newer logo is
// used on arrival, and Undo brings the first one back.
// Run after `npm run build`:  node scripts/verify/system-submissions.mjs
import { makeWorld, check, done, png, jpeg, file, SECRET } from './submissions-world.mjs';

const W = makeWorld();
const { push, admin, rows, ids } = W;
const ORIGIN = 'https://bharataiinnovation.com';
const waiting = async () => (await admin('/api/admin/inbox-submissions')).json;
const logoOf = () => rows('SELECT logo_url FROM exhibitors WHERE id = ?', [ids.acme])[0].logo_url;

// ---- 1. the logo ----
await push({ source_id: 'sys-logo', subject: 'RE: Exhibitor details for Bharat AI Innovation', text: 'Hi Puja,\nWhile the logos of the other exhibitors are on the website, ours has not been added.\nCan you please add our logo.\n\nRegards,\nRavi Kumar', attachments: [file('acme-logo.png', png(800, 240, 1), 'image/png')] });
let list = await waiting();
const first = list.rows[0];
check('the email is waiting in Admin, counted in the sidebar', list.rows.length === 1 && list.counts.new === 1 && (await admin('/api/admin/inbox-submissions/count')).json.new === 1);
check('it is already matched: a logo, from the booth contact of Acme', first.kind === 'logo' && first.matches.exhibitors[0].id === ids.acme && first.matches.exhibitors[0].sure && first.attachments[0].use === 'logo');
let r = await admin(`/api/admin/inbox-submissions/${first.id}/apply`, { method: 'POST', body: { what: 'logo', exhibitor_id: first.matches.exhibitors[0].id, file: 0 } });
const firstLogo = logoOf();
check('one press: the exhibitor has its logo', r.status === 200 && firstLogo === ORIGIN + '/api/uploads/' + first.attachments[0].key);
const served = await W.worker.fetch(new Request(firstLogo), W.env, W.ctx);
check('the app can show it: the address answers with the picture', served.status === 200 && served.headers.get('content-type') === 'image/png' && (await served.arrayBuffer()).byteLength === 600);
check('nothing is waiting any more', (await waiting()).rows.length === 0 && (await admin('/api/admin/inbox-submissions?status=applied')).json.rows.length === 1);

// ---- 2. the people ----
await push({ source_id: 'sys-team', subject: 'Our team for the booth', text: 'Hi Puja,\nThe people at our booth:\n1. Priya Nair - Marketing Head - priya.nair@acmerobotics.in - 98200 12345\n2. Arjun Mehta - Sales Manager - arjun@acmerobotics.in - 98200 98200\n\nRegards,\nRavi' });
list = await waiting();
const team = list.rows[0];
check('the team email waits with both people read out of it', team.kind === 'team' && team.matches.people.length === 2 && team.matches.exhibitors[0].id === ids.acme);
r = await admin(`/api/admin/inbox-submissions/${team.id}/apply`, { method: 'POST', body: { what: 'team', exhibitor_id: ids.acme, people: [team.matches.people[0]] } });
const priya = rows("SELECT * FROM exhibitor_team WHERE email = 'priya.nair@acmerobotics.in'")[0];
const pass = rows("SELECT id, name, badge_type, company, job_title, mobile FROM attendees WHERE email = 'priya.nair@acmerobotics.in'")[0];
check('one press: she is on the team', r.status === 200 && priya?.designation === 'Marketing Head' && priya.exhibitor_id === ids.acme);
check('and holds an exhibitor pass in her own name, with her company and designation', !!pass && /exhibit/i.test(pass.badge_type) && pass.name === 'Priya Nair' && pass.job_title === 'Marketing Head' && /Acme/.test(pass.company) && priya.attendee_id === pass.id, pass);

// ---- 3. the speaker's photo ----
await push({ source_id: 'sys-photo', from_email: 'asha.rao@acmerobotics.in', from_name: 'Dr. Asha Rao', subject: 'Photo for my talk', text: 'Please find my photo attached.', attachments: [file('asha.jpg', jpeg(900, 1200, 2), 'image/jpeg')] });
list = await waiting();
const photo = list.rows[0];
check('the photo waits, matched to her own talk for certain', photo.kind === 'photo' && photo.matches.talks[0].id === ids.talk && photo.matches.talks[0].sure);
await admin(`/api/admin/inbox-submissions/${photo.id}/apply`, { method: 'POST', body: { what: 'talk_photo', talk_id: ids.talk, file: 0 } });
const talks = (await W.call('/api/events/1/innovation-talks')).json;
check('one press: the app\'s Innovation Talks list shows her photo', talks.find((t) => t.id === ids.talk)?.speaker_photo_url === '/api/uploads/' + photo.attachments[0].key);

// ---- 4. what follows from it ----
const ex = (await admin('/api/admin/inbox-submissions/export')).json.files;
check('the website script is told of both files, each with who it is for', ex.length === 2 && ex.some((f) => f.what === 'logo' && /Acme/.test(f.target)) && ex.some((f) => f.what === 'talk_photo' && /Asha/.test(f.target)), ex);
const senders = (await W.call('/api/external/submission-senders', { headers: { Authorization: 'Bearer ' + SECRET } })).json;
check('the person just added is a known sender from now on', senders.emails.includes('priya.nair@acmerobotics.in'));
const history = rows("SELECT action, actor FROM admin_audit WHERE entity = 'submission' ORDER BY id").map((a) => a.action);
check('every step is in the history: three received, three used', history.filter((a) => a === 'submission.received').length === 3 && history.filter((a) => a === 'submission.apply').length === 3, history);

// ---- 5. without asking ----
await admin('/api/admin/inbox-submissions/settings', { method: 'PUT', body: { auto: { logo: true } } });
const auto = await push({ source_id: 'sys-logo-2', subject: 'New logo', text: 'Please use this new logo instead.', attachments: [file('acme-logo-2026.png', png(1000, 300, 3), 'image/png')] });
check('a newer logo from the same contact is used the moment it arrives', auto.json.status === 'applied' && logoOf() !== firstLogo && logoOf().includes('acme-logo-2026'));
check('and nothing waits for it', (await waiting()).rows.length === 0);
r = await admin(`/api/admin/inbox-submissions/${auto.json.id}/undo`, { method: 'POST', body: { index: 0 } });
check('Undo brings the first logo back', r.status === 200 && logoOf() === firstLogo);

done();
