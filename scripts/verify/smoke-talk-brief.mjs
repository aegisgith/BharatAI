// Built-worker checks for the Innovation Talk briefs (16 Nov 2026) on the talks world
// (real SQLite, the production schema, 0050 and 0052, the repo's 48 talks at the 13 Nov
// agenda times): the list and its statuses, a preview that mints nothing, a send with the
// pass button and its audit row, "changed since sent" after the hall moves, the booth
// contact asked to pass it on, a typed address, an official held back, the saved note,
// and the calendar file. Nothing is sent: the mail service is answered here.
// Run after `npm run build`:  node scripts/verify/smoke-talk-brief.mjs
import { talksWorld, checker } from './talks-world.mjs';

const { db, rows, talk, sent, hit, as, admin, read } = await talksWorld({ times: true });
const { check, done } = checker();
const count = (t) => rows(`SELECT COUNT(*) AS n FROM ${t}`)[0].n;
const body = (i) => sent[i]?.Content?.Body?.[0]?.Content || '';
const subj = (i) => sent[i]?.Content?.Subject || '';
const toOf = (i) => JSON.stringify(sent[i]?.Recipients || '');

// ---- the list ----
let l = await as('GET', '/api/admin/events/1/talk-briefs');
const talks = l.json?.talks || [];
const timed = talks.filter(t => t.starts_at && t.hall);
check('the list: every talk, most with a time and a hall, none sent yet', l.status === 200 && talks.length >= 40 && timed.length >= 30 && !talks.some(t => t.status === 'sent' || t.status === 'changed'), `${talks.length} talks, ${timed.length} timed, ${JSON.stringify(l.json?.counts)}`);
check('a talk with no time is "no-time"; a timed talk with no email on file is "no-email"', talks.some(t => !t.starts_at && t.status === 'no-time') && timed.some(t => !t.email && t.status === 'no-email'), JSON.stringify(l.json?.counts));
check('a government official (IFS / a department) is held for their office', timed.some(t => t.protocol && t.status === 'protocol'), talks.filter(t => t.protocol).map(t => t.speaker).join(', '));
check('without admin the list is refused', (await hit('GET', '/api/admin/events/1/talk-briefs')).status === 401, '');

// Dipak Zope's talk: Fri 20 Nov 11:31, 7 minutes, Aryabhata Theatre. Give it a speaker email.
const dz = talk("speaker_name = 'Dipak Zope'");
check('Dipak Zope is timed in the Aryabhata Theatre', !!dz && dz.starts_at === '2026-11-20 11:31' && Number(dz.duration_min) === 7 && dz.hall === 'Aryabhata Theatre', JSON.stringify(dz));
db.run("UPDATE innovation_talks SET speaker_email = 'dipak@paisani.example.com' WHERE id = ?", [dz.id]);
l = await as('GET', '/api/admin/events/1/talk-briefs');
let row = (l.json.talks || []).find(t => t.id === dz.id);
check('with an email the talk is "ready", from the speaker’s own address, no pass yet', row?.status === 'ready' && row.email === 'dipak@paisani.example.com' && row.source === 'speaker' && row.pass === null, JSON.stringify(row));

// ---- preview ----
const before = { sent: sent.length, audit: count('admin_audit'), tokens: count('login_tokens') };
let pv = await as('POST', `/api/admin/innovation-talks/${dz.id}/brief`, { preview: true });
check('preview: the subject names the day, time and hall', pv.status === 200 && pv.json.subject === 'Your Innovation Talk at Bharat AI Innovation 2026: Friday 20 Nov, 11:31 am, Aryabhata Theatre', pv.json?.subject);
check('preview: "Dear Dipak", the slot from 11:31 am to 11:38 am, 7 minutes on stage, the hall and where it is, the venue', !!pv.json?.html && pv.json.html.includes('Dear Dipak,') && pv.json.html.includes('Friday 20 Nov, 11:31 am to 11:38 am') && pv.json.html.includes('7 minutes') && pv.json.html.includes('Aryabhata Theatre</strong>, On the exhibition floor, World Trade Center, Mumbai'), pv.json?.html?.slice(0, 200));
check('preview: calendar links (Google and the .ics), the pass block says how to get a pass, "reply if wrong"', pv.json.html.includes('calendar.google.com') && pv.json.html.includes(`/api/innovation-talks/${dz.id}/calendar.ics`) && pv.json.html.includes('Teams &amp; Passes') && pv.json.html.includes('If anything here is wrong'), '');
check('preview: never the venue’s own room name', !/Expo Hall|Peacock|Centrum/.test(pv.json.html), '');
check('preview: the WhatsApp text has the slot and no link', pv.json.text.includes('When: Friday 20 Nov, 11:31 am to 11:38 am') && pv.json.text.includes('Aryabhata Theatre') && !/https?:\/\//.test(pv.json.text), pv.json.text);
check('the preview sent nothing, minted no token and wrote no audit row', sent.length === before.sent && count('login_tokens') === before.tokens && count('admin_audit') === before.audit, '');

// ---- send, with the pass ----
db.run("INSERT INTO attendees (id, event_id, name, email, badge_type, payment_status, role, main_event) VALUES (901, 1, 'Dipak Zope', 'dipak@paisani.example.com', 'Exhibition Speaker', 'paid', 'Exhibitor', 1)");
pv = await as('POST', `/api/admin/innovation-talks/${dz.id}/brief`, { preview: true });
check('with an attendee under that address the preview shows the pass', pv.json.pass?.badge_type === 'Exhibition Speaker' && pv.json.html.includes('Your Exhibition Speaker pass') && pv.json.html.includes('Show my pass'), JSON.stringify(pv.json?.pass));
let r = await as('POST', `/api/admin/innovation-talks/${dz.id}/brief`, {});
check('send: one email to the speaker, kind first', r.status === 200 && r.json.success && r.json.kind === 'first' && sent.length === before.sent + 1 && toOf(before.sent).includes('dipak@paisani.example.com'), r.status + ' ' + JSON.stringify(r.json));
check('the pass button signs them in at their pass', /app\?email=dipak%40paisani\.example\.com&(amp;)?action=download-pass&(amp;)?token=[0-9a-f]+/.test(body(before.sent)) && count('login_tokens') === before.tokens + 1, (body(before.sent).match(/href="[^"]*download-pass[^"]*"/) || [''])[0] + ' tokens ' + count('login_tokens'));
const auditRows = rows("SELECT detail FROM admin_audit WHERE entity = 'innovation_talk' AND action = 'innovation_talk.brief' AND entity_id = ?", [String(dz.id)]);
check('the send is an audit row with the fingerprint and address', auditRows.length === 1 && JSON.parse(auditRows[0].detail).fp === r.json.fp && JSON.parse(auditRows[0].detail).to === 'dipak@paisani.example.com', JSON.stringify(auditRows));
l = await as('GET', '/api/admin/events/1/talk-briefs');
row = (l.json.talks || []).find(t => t.id === dz.id);
check('the list now says sent, with when and to whom', row?.status === 'sent' && row.last?.to === 'dipak@paisani.example.com' && row.last.n === 1, JSON.stringify(row?.last));

// ---- the slot moves ----
db.run("UPDATE innovation_talks SET hall = 'Kalam Theatre' WHERE id = ?", [dz.id]);
l = await as('GET', '/api/admin/events/1/talk-briefs');
row = (l.json.talks || []).find(t => t.id === dz.id);
check('a moved hall makes it "changed since sent"', row?.status === 'changed', row?.status);
r = await as('POST', `/api/admin/innovation-talks/${dz.id}/brief`, {});
check('the next send is an update: "Updated:" subject, the new hall, "please use these and not the earlier email"', r.json.kind === 'update' && subj(before.sent + 1).startsWith('Updated: Your Innovation Talk') && subj(before.sent + 1).includes('Kalam Theatre') && body(before.sent + 1).includes('not the earlier email'), subj(before.sent + 1));
l = await as('GET', '/api/admin/events/1/talk-briefs');
row = (l.json.talks || []).find(t => t.id === dz.id);
check('and the list is back to sent, twice', row?.status === 'sent' && row.last.n === 2, JSON.stringify(row?.last));

// ---- the booth contact is asked to pass it on ----
const other = talks.find(t => t.id !== dz.id && t.starts_at && t.hall && !t.email && !t.protocol && t.company);
db.run("INSERT INTO exhibitors (id, event_id, company_name, contact_email) VALUES (700, 1, ?, 'spoc@example.com')", [other.company]);
pv = await as('POST', `/api/admin/innovation-talks/${other.id}/brief`, { preview: true });
check(`${other.speaker}’s brief goes to the booth contact, who is asked to pass it on, with no pass button`, pv.status === 200 && pv.json.to === 'spoc@example.com' && pv.json.source === 'booth' && pv.json.to_speaker === false && pv.json.subject.startsWith(`Innovation Talk by ${other.speaker}:`) && pv.json.html.includes('Please pass it on to') && !pv.json.html.includes('Show my pass'), JSON.stringify({ to: pv.json?.to, source: pv.json?.source, subject: pv.json?.subject }));
r = await as('POST', `/api/admin/innovation-talks/${other.id}/brief`, { to: 'speaker.direct@example.com' });
check('a typed address sends to the speaker instead and is remembered on the talk', r.status === 200 && r.json.to === 'speaker.direct@example.com' && subj(sent.length - 1).startsWith('Your Innovation Talk') && talk('id = ?', other.id).speaker_email === 'speaker.direct@example.com', JSON.stringify(r.json));
r = await as('POST', `/api/admin/innovation-talks/${other.id}/brief`, { to: 'not an address' });
check('a typed address that is not one is refused', r.status === 400, r.status);

// ---- an official, a talk with no time, a note ----
const official = talks.find(t => t.protocol && t.starts_at && t.hall);
if (official) {
  db.run("UPDATE innovation_talks SET speaker_email = 'office@gov.example.in' WHERE id = ?", [official.id]);
  const n = sent.length;
  r = await as('POST', `/api/admin/innovation-talks/${official.id}/brief`, {});
  check(`${official.speaker}: not emailed without "anyway"`, r.status === 409 && /office handles protocol/.test(r.json.error) && sent.length === n, r.status + ' ' + JSON.stringify(r.json));
  r = await as('POST', `/api/admin/innovation-talks/${official.id}/brief`, { anyway: true });
  check('and sent on purpose', r.status === 200 && sent.length === n + 1, r.status);
} else check('an official with a time exists in the seed', false, 'none');
const untimed = talks.find(t => !t.starts_at);
r = await as('POST', `/api/admin/innovation-talks/${untimed.id}/brief`, {});
check('a talk with no time cannot be briefed', r.status === 409 && /no time or hall/.test(r.json.error), r.status + ' ' + JSON.stringify(r.json));
r = await as('PUT', '/api/admin/talk-briefs/note', { note: 'Please be at the stage 15 minutes before your slot.\r\nBring your slides as a PDF on a USB drive.' });
check('the note saves (CRLF made LF)', r.status === 200 && r.json.note === 'Please be at the stage 15 minutes before your slot.\nBring your slides as a PDF on a USB drive.', JSON.stringify(r.json));
pv = await as('POST', `/api/admin/innovation-talks/${dz.id}/brief`, { preview: true });
l = await as('GET', '/api/admin/events/1/talk-briefs');
check('every brief and the list carry the saved note', pv.json.html.includes('Please be at the stage 15 minutes before your slot.') && pv.json.text.includes('Bring your slides') && l.json.note.includes('USB drive'), '');
check('a missing talk is 404', (await as('POST', '/api/admin/innovation-talks/99999/brief', { preview: true })).status === 404, '');

// ---- the calendar file ----
const ics = await hit('GET', `/api/innovation-talks/${dz.id}/calendar.ics`);
check('the calendar file: public, 11:31 IST as 06:01 UTC, 7 minutes long, the hall in the location', ics.status === 200 && ics.text.includes('DTSTART:20261120T060100Z') && ics.text.includes('DTEND:20261120T060800Z') && ics.text.includes('LOCATION:Kalam Theatre') && ics.text.includes('Innovation Talk:'), ics.status + ' ' + ics.text.slice(0, 300));
check('no calendar file for a talk with no time', (await hit('GET', `/api/innovation-talks/${untimed.id}/calendar.ics`)).status === 404, '');

// ---- the page ----
const adminHtml = (await hit('GET', '/admin', undefined, admin)).text;
check('/admin loads talk-brief.js', adminHtml.includes('/static/talk-brief.js?v='), '');
check('the screen exposes TalkBrief.openList', read('public/static/talk-brief.js').includes('global.TalkBrief = { openList: openList'), '');

done();
