// Integration checks for the Innovation Talks tab (12 Nov 2026), on the real built
// worker and real SQLite with the production schema, the 49 real talks and the real
// time SQL:
//  - scripts/sql/innovation-talk-times.sql gives 21 talks their day, time and hall, and
//    leaves the talks the agenda puts elsewhere without the Expo Hall;
//  - the public list carries hall and time but never the speaker's email, mobile or the
//    team's notes; the admin list carries everything;
//  - add and edit, with every refusal; before migration 0052 everything else is still
//    saved and the reply says what was not;
//  - where an email comes from (the speaker, the team list, the booth contact, nothing);
//  - the missing-details email: preview, send, what it says, what is recorded;
//  - none of it without the admin password.
// Run after `npm run build`:  node scripts/verify/smoke-innovation-talks.mjs
import { talksWorld, checker } from './talks-world.mjs';
const { check, done } = checker();

// ================= with migration 0052 =================
const W = await talksWorld({ times: true });
const all = W.rows('SELECT * FROM innovation_talks WHERE event_id = 1');
check('the 49 real talks are loaded from scripts/sql/innovation-talks.sql', all.length === 49, all.length);
const timed = all.filter(t => t.starts_at);
check('the time SQL gives 21 talks a day and a time', timed.length === 21, timed.length);
check('every timed talk has words and a hall', timed.every(t => / · /.test(t.time_slot) && t.hall), timed.filter(t => !t.hall || !/ · /.test(t.time_slot)).map(t => t.speaker_name));
const amr = W.talk("speaker_name = 'Amritesh Kumar'");
check('Phoebetal: Fri 20 Nov · 1:10 – 1:18 PM in Aryabhata Theatre', amr.time_slot === 'Fri 20 Nov · 1:10 – 1:18 PM' && amr.hall === 'Aryabhata Theatre' && amr.starts_at === '2026-11-20 13:10' && amr.duration_min === 8, amr);
const cgi = W.talk("company = 'CGI'");
check('CGI is in Kalam Theatre at 3:20 PM, not the Expo Hall', cgi.hall === 'Kalam Theatre' && cgi.time_slot === 'Fri 20 Nov · 3:20 – 3:40 PM', [cgi.hall, cgi.time_slot]);
check('NoBroker and the Forest Department are left without a hall (the agenda puts them in the main halls)', !W.talk("company = 'NoBroker'").hall && !W.talk("company = 'Maharashtra Forest Department'").hall);
check('every other talk is in Aryabhata Theatre', all.filter(t => !['CGI', 'NoBroker', 'Maharashtra Forest Department'].includes(t.company)).every(t => W.talk('id = ?', t.id).hall === 'Aryabhata Theatre'));
// Production spells one company differently from the list ("Origin AI" vs "Origins AI").
const gaurav = W.talk("speaker_name = 'Gaurav Jha'");
W.db.run("UPDATE innovation_talks SET company = 'Origin AI', starts_at = NULL, time_slot = 'To be announced' WHERE id = ?", [gaurav.id]);
W.db.exec(W.read('scripts/sql/innovation-talk-times.sql'));
check('a talk whose company is spelt differently in the app still gets its time (by the speaker)', W.talk('id = ?', gaurav.id).time_slot === 'Fri 20 Nov · 12:40 – 12:48 PM', W.talk('id = ?', gaurav.id).time_slot);
const hallBefore = W.rows('SELECT id, hall FROM innovation_talks ORDER BY id');
W.db.exec(W.read('scripts/sql/innovation-talk-times.sql'));
check('running the time SQL twice changes nothing', JSON.stringify(W.rows('SELECT id, hall FROM innovation_talks ORDER BY id')) === JSON.stringify(hallBefore));

// ---- the lists ----
W.db.run("UPDATE innovation_talks SET speaker_email = 'amritesh@phoebetal.test', speaker_phone = '98200 11111', notes = 'internal: call Kitty' WHERE id = ?", [amr.id]);
let r = await W.hit('GET', '/api/events/1/innovation-talks');
const pub = r.json;
check('public list: 200 and all 49 talks', r.status === 200 && Array.isArray(pub) && pub.length === 49, r.status);
const pa = pub.find(t => t.id === amr.id);
check('public list carries hall, start and length', pa.hall === 'Aryabhata Theatre' && pa.starts_at === '2026-11-20 13:10' && pa.duration_min === 8, pa);
check("public list never carries the speaker's email or mobile, the notes or who was asked", pub.every(t => !('speaker_email' in t) && !('speaker_phone' in t) && !('notes' in t) && !('details_requested_to' in t)) && !/amritesh@phoebetal|98200 11111|Kitty/.test(r.text));
check('public list: talks with a time come first, in time order', pub.slice(0, 21).every(t => t.starts_at) && pub.slice(0, 21).every((t, i, a) => !i || a[i - 1].starts_at <= t.starts_at));
r = await W.as('GET', '/api/events/1/innovation-talks');
check('admin list carries the email, mobile and notes', r.json.find(t => t.id === amr.id).speaker_email === 'amritesh@phoebetal.test' && r.json.find(t => t.id === amr.id).speaker_phone === '98200 11111');
// An exhibitor's own draft (0044) stays out until the organisers give it a time.
W.db.run("INSERT INTO innovation_talks (event_id, exhibitor_id, company, speaker_name, topic) VALUES (1, 77, 'Draft Co', 'Drafty', 'A draft')");
r = await W.hit('GET', '/api/events/1/innovation-talks');
check("an exhibitor's draft without a time stays off the public list", !r.json.some(t => t.company === 'Draft Co'));

// ---- add and edit ----
r = await W.as('POST', '/api/admin/innovation-talks', { event_id: 1, speaker_name: '' });
check('add: no speaker name is refused', r.status === 400 && /speaker/.test(r.json.error), r.json);
r = await W.as('POST', '/api/admin/innovation-talks', { event_id: 1, speaker_name: 'New Person', company: 'New Co', topic: 'New topic', hall: 'Raman Theatre', speaker_email: 'BAD' });
check('add: a wrong email is refused', r.status === 400 && /email/.test(r.json.error));
r = await W.as('POST', '/api/admin/innovation-talks', { event_id: 1, speaker_name: 'New Person', company: 'New Co', topic: 'New topic', hall: 'Raman Theatre', speaker_email: 'new@co.test', starts_at: '2026-11-21 12:30', duration_min: 12 });
let nt = W.talk('id = ?', r.json?.id);
check('add: saved with hall, email and the time in words', r.status === 200 && nt && nt.hall === 'Raman Theatre' && nt.speaker_email === 'new@co.test' && nt.time_slot === 'Sat 21 Nov · 12:30 – 12:42 PM' && nt.session_type === 'Afternoon' && nt.status === 'confirmed', nt);
r = await W.as('POST', '/api/admin/innovation-talks', { event_id: 1, speaker_name: 'No Time Yet' });
check('add: without a time it reads "To be announced"', W.talk('id = ?', r.json.id).time_slot === 'To be announced');
r = await W.as('PATCH', '/api/admin/innovation-talks/' + nt.id, { hall: 'Aryabhata Theatre', speaker_phone: '+91 98200 22222', speaker_bio: 'Builds things.', showcase: 'A demo' });
nt = W.talk('id = ?', nt.id);
check('edit: hall, mobile, bio and showcase are saved', r.status === 200 && nt.hall === 'Aryabhata Theatre' && nt.speaker_phone === '+91 98200 22222' && nt.speaker_bio === 'Builds things.' && nt.showcase === 'A demo', nt);
check('edit: what was not sent is untouched', nt.topic === 'New topic' && nt.speaker_email === 'new@co.test');

// ---- where the email comes from ----
W.db.run("INSERT INTO exhibitors (id, event_id, company_name, contact_email, booth_number) VALUES (11, 1, 'Phoebetal Technologies Pvt Ltd', 'spoc@phoebetal.test', '49')");
W.db.run("INSERT INTO exhibitors (id, event_id, company_name, contact_email, booth_number) VALUES (12, 1, 'Joget INC', 'spoc@joget.test', '10')");
W.db.run("INSERT INTO exhibitors (id, event_id, company_name, contact_email, booth_number) VALUES (13, 1, 'Xtant Tech', '', '39')");
W.db.run("INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, email, speaker) VALUES (1, 12, 'Raveesh', 'Dewan', 'raveesh@joget.test', 1)");
W.db.run("INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, email, speaker) VALUES (1, 12, 'Someone', 'Else', 'someone@joget.test', 0)");
W.db.run("UPDATE innovation_talks SET speaker_email = '' WHERE id = ?", [amr.id]);
r = await W.as('GET', '/api/admin/innovation-talks/contacts?event_id=1');
const C = r.json.contacts;
const idOf = (name) => W.talk('speaker_name = ?', name).id;
check('contacts: Phoebetal (no own email) gets its booth contact, matched past "Pvt Ltd"', C[idOf('Amritesh Kumar')].email === 'spoc@phoebetal.test' && C[idOf('Amritesh Kumar')].source === 'booth' && /booth contact for Phoebetal Technologies Pvt Ltd/.test(C[idOf('Amritesh Kumar')].note), C[idOf('Amritesh Kumar')]);
check("contacts: Joget's speaker is found by name on the team list", C[idOf('Raveesh Dewan')].email === 'raveesh@joget.test' && C[idOf('Raveesh Dewan')].source === 'team', C[idOf('Raveesh Dewan')]);
check('contacts: an exhibitor with no contact email gives nothing', C[idOf('Ankit Kumar')].email === '' && C[idOf('Ankit Kumar')].source === 'none', C[idOf('Ankit Kumar')]);
check("contacts: the speaker's own email comes first", C[nt.id].email === 'new@co.test' && C[nt.id].source === 'speaker');
check('contacts: a company not on the exhibitor list gives nothing', C[idOf('Vineet Upadhayay')].source === 'none');

// ---- the missing-details email ----
const url = '/api/admin/innovation-talks/' + amr.id + '/request-details';
r = await W.as('POST', url, { to: 'spoc@phoebetal.test', items: [] });
check('email: nothing ticked is refused', r.status === 400 && /at least one/.test(r.json.error));
r = await W.as('POST', url, { to: 'spoc@phoebetal', items: ['topic'] });
check('email: a wrong address is refused', r.status === 400 && /email address/.test(r.json.error));
r = await W.as('POST', url, { to: 'spoc@phoebetal.test', items: ['topic', 'time', 'hall', 'notes'] });
check('email: only things a speaker can send may be asked for (time, hall, notes are dropped)', r.status === 200 && W.sent.length === 1 && !/time of your talk|Notes/.test(W.sent[0].Content.Body[0].Content), r.json);
W.sent.length = 0;
r = await W.as('POST', url, { to: 'spoc@phoebetal.test', items: ['speaker_bio', 'speaker_phone'], note: 'Please send your slides by 18 Nov.', to_speaker: false, preview: true });
check('preview: answers with the email and sends nothing', r.status === 200 && r.json.preview && /two or three lines about you/i.test(r.json.html) && W.sent.length === 0, r.json && r.json.subject);
check('preview: the subject names the speaker for a booth contact', r.json.subject === 'Innovation Talk by Amritesh Kumar: a few details we need', r.json.subject);
r = await W.as('POST', url, { to: 'SPOC@phoebetal.test', items: ['speaker_bio', 'speaker_phone'], note: 'Please send your slides by 18 Nov.', to_speaker: false, save_email: false });
const m = W.sent[0], html = m && m.Content.Body[0].Content;
check('send: one email, to the address typed (lower case)', r.status === 200 && W.sent.length === 1 && m.Recipients.To[0] === 'spoc@phoebetal.test', r.json);
check('send: from register@bharataiinnovation.com', /register@bharataiinnovation\.com/.test(m.Content.From), m.Content.From);
check('send: no unsubscribe footer on an email about their own talk', !/Unsubscribe/i.test(html) && !(m.Content.Headers && m.Content.Headers['List-Unsubscribe']));
check('send: to a booth contact it says "Hello" and asks them to pass it on', /Hello,/.test(html) && /pass this on to them/.test(html) && !/Dear Amritesh/.test(html));
check('send: it tells them the time and BOTH hall names', html.includes('Fri 20 Nov · 1:10 – 1:18 PM') && html.includes('Aryabhata Theatre (Expo Hall, on the exhibition floor)'));
check('send: it lists only what was ticked, with the reason, and the extra note', /Two or three lines about you/.test(html) && /Your mobile number/.test(html) && !/A clear photo of you/.test(html) && html.includes('Please send your slides by 18 Nov.'));
check('send: it never blames anyone and asks for a reply', /Just reply to this email/.test(html) && !/(our|the) (app|system|website) (had|has) (a )?(problem|error)/i.test(html));
let a2 = W.talk('id = ?', amr.id);
check('send: recorded on the talk (when, and to whom)', !!a2.details_requested_at && a2.details_requested_to === 'spoc@phoebetal.test', [a2.details_requested_at, a2.details_requested_to]);
check("send: a booth contact's address is not kept as the speaker's email", a2.speaker_email === '');
const auditRows = W.rows("SELECT * FROM admin_audit WHERE action = 'innovation_talk.request_details'");
check('send: an audit line names the address and what was asked', auditRows.some(x => /spoc@phoebetal\.test/.test(x.detail) && /speaker_bio/.test(x.detail) && x.entity === 'innovation_talk'), auditRows);
W.sent.length = 0;
r = await W.as('POST', url, { to: 'amritesh@phoebetal.test', items: ['speaker_photo_url'], to_speaker: true, save_email: true });
a2 = W.talk('id = ?', amr.id);
check("to the speaker: \"Dear <name>\", and the address is kept on the talk", /Dear Amritesh Kumar,/.test(W.sent[0].Content.Body[0].Content) && a2.speaker_email === 'amritesh@phoebetal.test' && W.sent[0].Content.Subject === 'Your Innovation Talk at Bharat AI Innovation 2026: a few details we need');
r = await W.as('POST', url, { to: 'other@phoebetal.test', items: ['topic'], save_email: true });
check("save_email never replaces an email already on the talk", W.talk('id = ?', amr.id).speaker_email === 'amritesh@phoebetal.test');
// A talk with nothing set: the email says the time and stage will follow.
const vin = W.talk("speaker_name = 'Vineet Upadhayay'");
W.db.run("UPDATE innovation_talks SET topic = '<img src=x onerror=alert(1)>', hall = '' WHERE id = ?", [vin.id]);
W.sent.length = 0;
r = await W.as('POST', '/api/admin/innovation-talks/' + vin.id + '/request-details', { to: 'v@p99.test', items: ['topic'] });
const vh = W.sent[0].Content.Body[0].Content;
check('no time or hall yet: the email says they will follow', /We will send you the time soon/.test(vh) && /We will confirm the stage soon/.test(vh));
check('text from the talk is escaped in the email', !vh.includes('<img src=x') && vh.includes('&lt;img src=x'));
W.setMailDown(true);
r = await W.as('POST', '/api/admin/innovation-talks/' + vin.id + '/request-details', { to: 'v2@p99.test', items: ['topic'] });
check('mail service down: a clear error, and nothing recorded as asked', r.status === 502 && W.talk('id = ?', vin.id).details_requested_to === 'v@p99.test', [r.status, r.json]);
W.setMailDown(false);
r = await W.as('POST', '/api/admin/innovation-talks/999999/request-details', { to: 'x@y.test', items: ['topic'] });
check('a talk that is gone: 404 with a sentence', r.status === 404 && /not there any more/.test(r.json.error));

// ---- not without the password ----
for (const [method, path, body] of [['GET', '/api/admin/innovation-talks/contacts'], ['POST', url, { to: 'x@y.test', items: ['topic'] }], ['PATCH', '/api/admin/innovation-talks/' + amr.id, { hall: 'X' }], ['POST', '/api/admin/innovation-talks', { speaker_name: 'X' }]]) {
  r = await W.hit(method, path, body);
  check('no password: ' + method + ' ' + path.replace(/\d+/, ':id') + ' is refused', r.status === 401, r.status);
}
check('nothing was sent or changed without the password', W.talk('id = ?', amr.id).hall === 'Aryabhata Theatre');

// ================= before migration 0052 =================
const O = await talksWorld({ with0052: false });
const oid = O.talk("speaker_name = 'Amritesh Kumar'").id;
r = await O.hit('GET', '/api/events/1/innovation-talks');
check('before 0052: the public list still works (no hall)', r.status === 200 && r.json.length === 49 && !('hall' in r.json[0]) && 'speaker_title' in r.json[0], r.status);
r = await O.as('PATCH', '/api/admin/innovation-talks/' + oid, { hall: 'Aryabhata Theatre', topic: 'Changed', starts_at: '2026-11-20 13:10', duration_min: 8 });
check('before 0052: an edit saves the rest and says hall was not saved', r.status === 200 && JSON.stringify(r.json.not_saved) === '["hall"]' && O.talk('id = ?', oid).topic === 'Changed' && O.talk('id = ?', oid).time_slot === 'Fri 20 Nov · 1:10 – 1:18 PM', r.json);
r = await O.as('PATCH', '/api/admin/innovation-talks/' + oid, { speaker_email: 'a@b.test' });
check('before 0052: an edit of only the new boxes says to run 0052', r.status === 409 && /0052/.test(r.json.error), r.json);
r = await O.as('POST', '/api/admin/innovation-talks', { speaker_name: 'Old DB', hall: 'Aryabhata Theatre', speaker_phone: '1' });
check('before 0052: add still works and names what was not saved', r.status === 200 && r.json.not_saved.includes('hall') && r.json.not_saved.includes('speaker_phone') && O.talk('id = ?', r.json.id).speaker_name === 'Old DB', r.json);
r = await O.as('POST', '/api/admin/innovation-talks/' + oid + '/request-details', { to: 'x@y.test', items: ['topic'] });
check('before 0052: the email still goes, and says it could not be recorded', r.status === 200 && r.json.recorded === false && O.sent.length === 1, r.json);
r = await O.as('GET', '/api/admin/innovation-talks/contacts');
check('before 0052: contacts still answer', r.status === 200 && r.json.contacts && Object.keys(r.json.contacts).length >= 49);
done();
