// Integration: speaker briefs through the WHOLE built worker on real SQLite
// (conference-world.mjs, migration 0054 applied), 12 Nov 2026. Who may call it; the
// list's statuses (ready, no email, no session, minister, sent, changed); a preview
// that mints no sign-in link and sends nothing; the saved note; a send that makes or
// raises their pass, signs them in at it, and is logged; an update after the slot
// moves; ministers only with "anyway"; drafts kept out; the public calendar file.
// Run after `npm run build`:  node scripts/verify/smoke-speaker-brief.mjs
import { makeWorld } from './conference-world.mjs';

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 500))); if (!ok) fails++; };

const W = await makeWorld({ migrated: true });
const list = async () => (await W.call('GET', '/api/admin/events/1/speaker-briefs')).json;
const by = (d, id) => d.speakers.find(s => s.id === id);
const mail = (i) => JSON.stringify(W.sent[i] || {});
const tokens = () => { try { return W.rows('SELECT COUNT(*) AS n FROM login_tokens')[0].n; } catch { return -1; } };

// A minister with an email and a keynote; a speaker with a free Visitor Pass; a
// speaker whose only session is a draft; a Delhi speaker.
W.db.run("INSERT INTO speakers (id, event_id, slug, name, role, organisation, email, is_published, sort_order) VALUES (20, 1, 'aditi-tatkare', 'Hon’ble Smt. Aditi Tatkare', 'Minister of Women & Child Development', 'Government of Maharashtra', 'office@example.test', 1, 20)");
W.db.run("INSERT INTO sessions (event_id, title, speaker_name, session_type, room, start_time, end_time, capacity) VALUES (1, 'Special Address', 'Hon’ble Smt. Aditi Tatkare', 'keynote', 'Homi J. Bhabha Hall', '2026-11-20 10:00', '2026-11-20 10:15', 1000)");
W.db.run("INSERT INTO speakers (id, event_id, slug, name, role, organisation, email, is_published, sort_order) VALUES (21, 1, 'ravi-menon', 'Ravi Menon', 'CTO', 'Example Labs', 'Ravi@Example.test', 1, 21)");
W.db.run("INSERT INTO sessions (event_id, title, speaker_name, session_type, room, start_time, end_time, capacity) VALUES (1, 'AI at the Edge', 'Ravi Menon', 'talk', 'Kalam Theatre', '2026-11-21 12:00', '2026-11-21 12:20', 1000)");
W.db.run("INSERT INTO attendees (event_id, name, email, badge_type, payment_status, main_event) VALUES (1, 'Ravi Menon', 'ravi@example.test', 'Visitor Pass', 'free', 0)");
W.db.run("INSERT INTO speakers (id, event_id, slug, name, role, organisation, email, is_published, sort_order) VALUES (22, 1, 'draft-only', 'Meera Draft', 'Head', 'Draft Co', 'meera@example.test', 1, 22)");
W.db.run("INSERT INTO sessions (event_id, title, speaker_name, session_type, room, start_time, end_time, capacity) VALUES (1, 'Not Yet Public', 'Meera Draft', 'talk', 'Raman Theatre', '2026-11-21 14:00', '2026-11-21 14:20', 1000)");
const draftId = W.rows("SELECT id FROM sessions WHERE title = 'Not Yet Public'")[0].id;
W.db.run("INSERT INTO session_admin (session_id, status) VALUES (?, 'draft')", [draftId]);
W.db.run("INSERT INTO events (id, title, venue, start_date, end_date, status) VALUES (2, 'Bharat AI Innovation Delhi 2027', 'Bharat Mandapam, New Delhi', '2027-07-28', '2027-07-29', 'upcoming')");
W.db.run("INSERT INTO speakers (id, event_id, slug, name, role, organisation, email, is_published, sort_order) VALUES (30, 2, 'delhi-person', 'Delhi Person', 'Head', 'Somewhere', 'delhi@example.test', 1, 1)");

const panelId = W.rows("SELECT id FROM sessions WHERE session_type = 'panel'")[0].id;

// ---- who may call it ----
let r = await W.call('GET', '/api/admin/events/1/speaker-briefs', undefined, { admin: false });
check('nobody but an admin reads the list', r.status === 401 || r.status === 403, r.status);
r = await W.call('POST', '/api/admin/speakers/3/brief', {}, { admin: false });
check('nobody but an admin sends a brief', (r.status === 401 || r.status === 403) && W.sent.length === 0, r.status);
r = await W.call('PUT', '/api/admin/speaker-briefs/note', { note: 'x' }, { admin: false });
check('nobody but an admin changes the note', r.status === 401 || r.status === 403, r.status);

// ---- the list ----
let d = await list();
check('the list loads with every speaker of the event', d && d.speakers.length === 8 && !d.speakers.some(s => s.id === 30), d && d.speakers.map(s => s.id));
check('a Joint Secretary with an email and a keynote: ready', by(d, 1).status === 'ready', by(d, 1));
check('a panellist with no email: no email', by(d, 2).status === 'no-email', by(d, 2));
check('the moderator with an email and a Speaker pass: ready, pass shown', by(d, 3).status === 'ready' && by(d, 3).pass && by(d, 3).pass.badge_type === 'Speaker', by(d, 3));
check('a speaker with no session: no session', by(d, 5).status === 'no-session');
check('a minister: through their office', by(d, 20).status === 'protocol' && by(d, 20).protocol === true, by(d, 20));
check('a speaker whose only session is a draft: no session (drafts are not told)', by(d, 22).status === 'no-session' && by(d, 22).slots.length === 0, by(d, 22));
check('their slot shows the hall by both names', by(d, 3).slots[0].room === 'Homi J. Bhabha Hall' && by(d, 3).slots[0].venue_room === 'Peacock Hall' && by(d, 3).slots[0].my_role === 'moderator', by(d, 3).slots);
check('a Visitor Pass under a speaker’s email shows as that pass', /visitor/i.test(by(d, 21).pass?.badge_type || ''), by(d, 21));
check('counts by status', d.counts.ready === 3 && d.counts['no-email'] === 2 && d.counts.protocol === 1, d.counts);

// ---- a preview ----
const t0 = tokens();
r = await W.call('POST', '/api/admin/speakers/3/brief', { preview: true });
check('a preview comes back with subject, email and WhatsApp text', r.status === 200 && /^Your session at Bharat AI Innovation 2026: Friday 20 November, 2:00 pm, Homi J\. Bhabha Hall \(Peacock Hall\)$/.test(r.json.subject) && r.json.html.includes('Dear Shailesh,'), r.json && r.json.subject);
check('the moderator’s brief lists the panellists (the speaker and the one typed by hand)', r.json.html.includes('Tarun Chugh (Bajaj Life Insurance)') && r.json.html.includes('Ratan Kumar Kesh (Bandhan Bank)') && !r.json.html.includes('Shailesh Dhuri (Moderator)'));
check('a preview sends nothing and mints no sign-in link', W.sent.length === 0 && tokens() === t0 && r.json.html.includes('href="#preview"'), [W.sent.length, t0, tokens()]);
check('the WhatsApp text has no link', !/https?:/.test(r.json.text) && r.json.text.includes('On the panel: Tarun Chugh'), r.json.text);
r = await W.call('POST', '/api/admin/speakers/3/brief', { preview: true, note: 'Come by 1:30 pm.' });
check('a note typed for this email shows in the preview', r.json.html.includes('Come by 1:30 pm.'));
r = await W.call('POST', '/api/admin/speakers/2/brief', { preview: true });
check('no email: the preview still works and has no pass block', r.status === 200 && r.json.to === '' && !r.json.html.includes('Show my'), r.json && r.json.to);
r = await W.call('POST', '/api/admin/speakers/5/brief', { preview: true });
check('no session: refused in plain words', r.status === 409 && /no published session/i.test(r.json.error), r.json);
r = await W.call('POST', '/api/admin/speakers/30/brief', { preview: true });
check('a Delhi speaker: not yet, said plainly', r.status === 409 && /Mumbai/.test(r.json.error), r.json);

// ---- the saved note ----
r = await W.call('PUT', '/api/admin/speaker-briefs/note', { note: '  Please reach the hall 30 minutes before your session.\r\nSlides in 16:9 by 18 Nov.  ' });
check('the note is saved, trimmed, with plain line ends', r.status === 200 && r.json.note === 'Please reach the hall 30 minutes before your session.\nSlides in 16:9 by 18 Nov.', r.json);
d = await list();
check('the list gives the saved note back', d.note.startsWith('Please reach the hall'));
r = await W.call('POST', '/api/admin/speakers/3/brief', { preview: true });
check('a brief with no note of its own carries the saved one', r.json.html.includes('Slides in 16:9 by 18 Nov.') && r.json.note.startsWith('Please reach'));

// ---- sending ----
r = await W.call('POST', '/api/admin/speakers/3/brief', {});
check('sent to the speaker’s own address, once', r.status === 200 && r.json.to === 'shailesh@example.test' && W.sent.length === 1 && mail(0).includes('shailesh@example.test'), r.json);
check('the email has the pass button signing them in at their pass', /Show my Speaker pass/.test(mail(0)) && /action=download-pass/.test(mail(0)) && /email=shailesh%40example\.test/.test(mail(0)), mail(0).slice(0, 300));
check('a sign-in link was made for it (the button works)', tokens() === -1 || tokens() === t0 + 1, [t0, tokens()]);
check('the saved note went with it', mail(0).includes('Slides in 16:9 by 18 Nov.'));
check('their existing Speaker pass was kept, not duplicated', W.rows("SELECT COUNT(*) AS n FROM attendees WHERE lower(email) = 'shailesh@example.test'")[0].n === 1);
const log = W.rows("SELECT entity_id, detail FROM admin_audit WHERE action = 'speaker.brief'");
check('it is logged with the fingerprint of what they were told', log.length === 1 && log[0].entity_id === '3' && /"fp":"[0-9a-f]{8}"/.test(log[0].detail) && /"kind":"first"/.test(log[0].detail), log);
d = await list();
check('the list now says sent', by(d, 3).status === 'sent' && by(d, 3).last && by(d, 3).last.kind === 'first', by(d, 3));

// ---- the slot moves ----
W.db.run("UPDATE sessions SET start_time = '2026-11-20 14:15', end_time = '2026-11-20 15:15' WHERE id = ?", [panelId]);
d = await list();
check('the panel moved: changed since sent', by(d, 3).status === 'changed', by(d, 3));
r = await W.call('POST', '/api/admin/speakers/3/brief', { preview: true });
check('the preview is an update with the new time', r.json.update === true && r.json.subject.startsWith('Updated: Your session') && r.json.subject.includes('2:15 pm'), r.json.subject);
r = await W.call('POST', '/api/admin/speakers/3/brief', {});
check('the update goes, marked as an update', r.status === 200 && r.json.kind === 'update' && W.sent.length === 2 && mail(1).includes('Updated: Your session'), r.json);
d = await list();
check('and the list says sent again', by(d, 3).status === 'sent' && by(d, 3).last.kind === 'update');

// ---- a pass made, a Visitor Pass raised ----
r = await W.call('POST', '/api/admin/speakers/1/brief', {});
const kk = W.rows("SELECT badge_type, payment_status, main_event FROM attendees WHERE lower(email) = 'kk@example.test'");
check('no pass yet: one is made under their email, as Speaker', r.status === 200 && r.json.pass && r.json.pass.created === true && kk.length === 1 && kk[0].badge_type === 'Speaker' && kk[0].payment_status === 'waived', [r.json, kk]);
r = await W.call('POST', '/api/admin/speakers/21/brief', { preview: true });
check('a Visitor Pass: the preview says it becomes a Speaker pass', r.json.pass && r.json.pass.will_change === true, r.json.pass);
r = await W.call('POST', '/api/admin/speakers/21/brief', {});
const ravi = W.rows("SELECT badge_type FROM attendees WHERE lower(email) = 'ravi@example.test'");
check('sending raises it to Speaker, no second row', r.status === 200 && ravi.length === 1 && ravi[0].badge_type === 'Speaker' && /Show my Speaker pass/.test(mail(W.sent.length - 1)), ravi);
check('the Kalam talk says Centrum Hall A too', mail(W.sent.length - 1).includes('Kalam Theatre') && mail(W.sent.length - 1).includes('Centrum Hall A'));

// ---- the organiser's own words for one email (13 Nov 2026) ----
r = await W.call('POST', '/api/admin/speakers/1/brief', { preview: true });
check('a preview gives the usual subject, greeting and opening to start from', r.json.usual && r.json.usual.subject === r.json.subject && /^Dear /.test(r.json.usual.greeting) && /Thank you for speaking/.test(r.json.usual.opening) && r.json.edited.length === 0, r.json.usual);
const usualSubject = r.json.usual.subject;
r = await W.call('POST', '/api/admin/speakers/1/brief', { preview: true, subject: 'Your keynote on 20 November', greeting: 'Respected Sir,', opening: 'Thank you for the keynote.\nWe look forward to it.' });
check('the preview shows their words', r.json.subject === 'Your keynote on 20 November' && r.json.html.includes('Respected Sir,') && r.json.html.includes('Thank you for the keynote.\nWe look forward to it.') && r.json.edited.join() === 'subject,greeting,opening', [r.json.subject, r.json.edited]);
const n1 = W.sent.length;
r = await W.call('POST', '/api/admin/speakers/1/brief', { preview: true, subject: usualSubject });
check('a box sent back unchanged is not an edit', r.json.edited.length === 0 && r.json.subject === usualSubject, r.json.edited);
r = await W.call('POST', '/api/admin/speakers/1/brief', { subject: 'Your keynote on 20 November\r\nBcc: someone@example.test', opening: 'Thank you for the keynote.' });
const own = W.sent[W.sent.length - 1] || {};
check('it goes with their subject on one line (no line break reaches the header)', r.status === 200 && W.sent.length === n1 + 1 && JSON.stringify(own).includes('Your keynote on 20 November Bcc: someone@example.test') && !/\r|\n/.test(r.json.subject), r.json);
check('their opening is in it, and the programme and pass still are', JSON.stringify(own).includes('Thank you for the keynote.') && !JSON.stringify(own).includes('Here is everything for your day') && /Show my Speaker pass/.test(JSON.stringify(own)) && /action=download-pass/.test(JSON.stringify(own)));
const ownLog = W.rows("SELECT detail FROM admin_audit WHERE action = 'speaker.brief' AND entity_id = '1' ORDER BY id DESC LIMIT 1")[0];
check('the log says which words were edited and the subject that went', ownLog && /"edited":\["subject","opening"\]/.test(ownLog.detail) && ownLog.detail.includes('Your keynote on 20 November'), ownLog);
d = await list();
check('editing the words does not change what they were told: still sent, not changed', by(d, 1).status === 'sent', by(d, 1));

// ---- refusals ----
const n0 = W.sent.length;
r = await W.call('POST', '/api/admin/speakers/2/brief', {});
check('no email: not sent, says why', r.status === 409 && /no email address/i.test(r.json.error) && W.sent.length === n0, r.json);
r = await W.call('POST', '/api/admin/speakers/20/brief', {});
check('a minister: not sent without "anyway", and says why', r.status === 409 && /minister/i.test(r.json.error) && W.sent.length === n0, r.json);
r = await W.call('POST', '/api/admin/speakers/20/brief', { anyway: true });
check('a minister with "anyway": sent', r.status === 200 && W.sent.length === n0 + 1, r.json);
r = await W.call('POST', '/api/admin/speakers/22/brief', {});
check('only a draft session: not sent', r.status === 409 && W.sent.length === n0 + 1, r.json);
r = await W.call('POST', '/api/admin/speakers/999/brief', { preview: true });
check('a speaker who is gone: 404 in plain words', r.status === 404 && /not on the list/i.test(r.json.error));

// ---- the calendar file ----
r = await W.call('GET', '/api/sessions/' + panelId + '/calendar.ics', undefined, { admin: false });
check('anyone can get a published session’s calendar file', r.status === 200 && /text\/calendar/.test(r.headers.get('content-type')) && r.text.includes('BEGIN:VEVENT') && r.text.includes('DTSTART:20261120T084500Z'), [r.status, r.text.slice(0, 200)]);
check('it names the hall by both names', r.text.includes('Homi J. Bhabha Hall (Peacock Hall)'));
r = await W.call('GET', '/api/sessions/' + draftId + '/calendar.ics', undefined, { admin: false });
check('a draft session has none', r.status === 404);
r = await W.call('GET', '/api/sessions/99999/calendar.ics', undefined, { admin: false });
check('a missing session has none', r.status === 404);

// ---- the admin page loads the screen ----
r = await W.call('GET', '/admin', undefined, { admin: false });
check('the admin page loads speaker-brief.js after conference-admin.js and BEFORE admin.js', r.status === 200 && /conference-admin\.js\?v=[^"]+"><\/script>\s*<script src="\/static\/speaker-brief\.js\?v=\d+"><\/script>\s*<script src="\/admin\.js\?v=/.test(r.text), r.status);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
