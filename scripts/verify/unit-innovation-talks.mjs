// Unit checks for the Innovation Talks tab (12 Nov 2026), each rule on its own:
//  1. the server's time rule, through its one route, as a table: a start and a length
//     become the words people read ("Fri 20 Nov · 11:30 – 11:38 AM") and Morning or
//     Afternoon; every wrong input is refused with a sentence;
//  2. scripts/gen-talk-times.mjs writes the same words as the server, for every slot;
//  3. the admin page's own functions, lifted from the /admin.js this build serves:
//     what counts as missing, where an email comes from, the form's time arithmetic
//     and its clash warning, and the announcement text with both hall names.
// Run after `npm run build`:  node scripts/verify/unit-innovation-talks.mjs
import { readFileSync } from 'node:fs';
import { talksWorld, checker } from './talks-world.mjs';
import { slotLabel } from '../gen-talk-times.mjs';
const { check, done } = checker();
const W = await talksWorld();
const id = W.talk("speaker_name = 'Vineet Upadhayay'").id;

// ---- 1. the server's time rule, as a table ----
const TABLE = [
  ['2026-11-20 11:30', 8, 'Fri 20 Nov · 11:30 – 11:38 AM', 'Morning'],
  ['2026-11-20 11:55', 10, 'Fri 20 Nov · 11:55 AM – 12:05 PM', 'Morning'],
  ['2026-11-20 12:00', 8, 'Fri 20 Nov · 12:00 – 12:08 PM', 'Afternoon'],
  ['2026-11-20 13:10', 8, 'Fri 20 Nov · 1:10 – 1:18 PM', 'Afternoon'],
  ['2026-11-21 09:05', 40, 'Sat 21 Nov · 9:05 – 9:45 AM', 'Morning'],
  ['2026-11-21 17:56', 10, 'Sat 21 Nov · 5:56 – 6:06 PM', 'Afternoon'],
  ['2027-07-29 10:00', 20, 'Thu 29 Jul · 10:00 – 10:20 AM', 'Morning'],
];
for (const [startsAt, dur, words, session] of TABLE) {
  const r = await W.as('PATCH', '/api/admin/innovation-talks/' + id, { starts_at: startsAt, duration_min: dur });
  const t = W.talk('id = ?', id);
  check(`time rule: ${startsAt} for ${dur} min reads "${words}" (${session})`, r.status === 200 && t.time_slot === words && t.session_type === session && t.starts_at === startsAt && t.duration_min === dur, { status: r.status, t: [t.time_slot, t.session_type, t.starts_at, t.duration_min] });
}
const REFUSED = [
  [{ starts_at: '20-11-2026 11:30', duration_min: 8 }, /day and the start time/],
  [{ starts_at: '2026-11-20 25:00', duration_min: 8 }, /day and the start time/],
  [{ starts_at: '2026-11-20 11:30', duration_min: 0 }, /end time must be after/],
  [{ starts_at: '2026-11-20 11:30', duration_min: 241 }, /within 4 hours/],
  [{ starts_at: '2026-11-20 11:30' }, /end time must be after/],
  [{ speaker_email: 'not-an-email' }, /email address does not look right/],
  [{ status: 'maybe' }, /confirmed, tentative or cancelled/],
  [{ session_type: 'Evening' }, /Morning or Afternoon/],
  [{ speaker_name: '   ' }, /speaker/],
  [{ topic: 'x'.repeat(201) }, /Topic is too long/],
  [{ speaker_bio: 'x'.repeat(801) }, /Short bio is too long/],
  [{ slot_no: 'abc' }, /Order must be a number/],
  [{ nothing_we_know: 1 }, /No valid fields/],
];
const before = JSON.stringify(W.talk('id = ?', id));
for (const [body, re] of REFUSED) {
  const r = await W.as('PATCH', '/api/admin/innovation-talks/' + id, body);
  check('refused with a sentence: ' + JSON.stringify(body).slice(0, 60), r.status === 400 && re.test(r.json?.error || ''), { status: r.status, error: r.json?.error });
}
check('nothing refused changed the talk', JSON.stringify(W.talk('id = ?', id)) === before);
let r = await W.as('PATCH', '/api/admin/innovation-talks/' + id, { starts_at: null });
let t = W.talk('id = ?', id);
check('clearing the time: no start, and the words go back to "To be announced"', r.status === 200 && t.starts_at === null && t.time_slot === 'To be announced', [t.starts_at, t.time_slot]);
r = await W.as('PATCH', '/api/admin/innovation-talks/' + id, { speaker_email: '  Vineet@P99Soft.COM ' });
check('an email is kept trimmed and in lower case', W.talk('id = ?', id).speaker_email === 'vineet@p99soft.com', W.talk('id = ?', id).speaker_email);
r = await W.as('PATCH', '/api/admin/innovation-talks/' + id, { speaker_email: '' });
check('an email can be removed again', r.status === 200 && W.talk('id = ?', id).speaker_email === '');

// ---- 2. the time generator writes the server's words ----
const S = JSON.parse(readFileSync(new URL('../data/schedule.json', import.meta.url), 'utf8'));
let agree = 0, disagree = [];
for (const s of S.sessions.filter(x => x.type === 'talk' && x.start && x.end)) {
  const date = { 1: '2026-11-20', 2: '2026-11-21' }[s.day];
  const [h1, m1] = s.start.split(':').map(Number), [h2, m2] = s.end.split(':').map(Number);
  await W.as('PATCH', '/api/admin/innovation-talks/' + id, { starts_at: date + ' ' + s.start, duration_min: h2 * 60 + m2 - h1 * 60 - m1 });
  const server = W.talk('id = ?', id).time_slot, gen = slotLabel(date, s.start, s.end);
  if (server === gen) agree++; else disagree.push([gen, server]);
}
check(`gen-talk-times.mjs and the server agree on every talk slot in the agenda (${agree})`, agree > 15 && !disagree.length, disagree);

// ---- 3. the admin page's own functions ----
const F = await W.adminTalkFunctions();
const full = { id: 1, time_slot: 'Fri 20 Nov · 11:30 – 11:38 AM', starts_at: '2026-11-20 11:30', hall: 'Aryabhata Theatre', speaker_email: 'a@b.co', topic: 'T', speaker_title: 'CEO', speaker_photo_url: '/images/talks/x.webp', speaker_bio: 'Bio', speaker_phone: '98200 12345' };
check('a complete talk is missing nothing', F.italkMissing(full).length === 0, F.italkMissing(full));
check('"To be announced" is not a time', !F.italkTimed({ time_slot: 'To be announced' }) && !F.italkTimed({ time_slot: '' }) && F.italkTimed({ time_slot: '10:00 AM' }));
const bare = { id: 2, time_slot: 'To be announced', speaker_name: 'X', company: 'Y' };
check('a bare talk misses time, hall, email and the five speaker details, in that order', JSON.stringify(F.italkMissing(bare)) === JSON.stringify(['time', 'hall', 'email', 'topic', 'speaker_title', 'speaker_photo_url', 'speaker_bio', 'speaker_phone']), F.italkMissing(bare));
check('what the speaker is asked for never includes time, hall or email', JSON.stringify(F.italkSpeakerGaps(bare)) === JSON.stringify(['topic', 'speaker_title', 'speaker_photo_url', 'speaker_bio', 'speaker_phone']));
check('"What they will show" is never counted missing on its own', F.italkSpeakerGaps({ ...full, showcase: '' }).length === 0);
check('blank-looking text is missing', F.italkSpeakerGaps({ ...full, topic: '   ' })[0] === 'topic');
F.italkContacts = { 2: { email: 'spoc@co.test', source: 'booth', note: 'The booth contact for Y' } };
check('no email on the talk: the booth contact is offered, and says so', F.italkEmailFor(bare).email === 'spoc@co.test' && F.italkEmailFor(bare).source === 'booth');
check('a booth contact on file means "email" is not missing', F.italkMissing(bare).indexOf('email') < 0);
check("the speaker's own email wins over any suggestion", F.italkEmailFor({ ...bare, speaker_email: 'own@x.test' }).source === 'speaker');
F.italkContacts = {};
check('nothing on file: no email, and the note asks for one', F.italkEmailFor(bare).email === '' && /Type one/.test(F.italkEmailFor(bare).note));
check('clock: 12:00 is PM, 0:05 is AM, 13:10 is 1:10 PM', F.italkClock(720) === '12:00 PM' && F.italkClock(5) === '12:05 AM' && F.italkClock(790) === '1:10 PM');
check('the form shows an end time from start + length (24-hour for the time box)', F.italkClock24(F.italkMins('11:30') + 8) === '11:38' && F.italkClock24(F.italkMins('23:50') + 20) === '00:10');

// The form's reading: fake form fields, the list it checks clashes against.
const form = (v) => ({ elements: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, { value: x }])) });
const base = { speaker_name: 'Amritesh Kumar', speaker_title: 'Product Head', company: 'Phoebetal Technologies', topic: 'AVISA One', hall: 'Aryabhata Theatre', status: 'confirmed', speaker_email: '', speaker_phone: '', speaker_bio: '', showcase: '', notes: '', day: '', start: '', end: '' };
const row = { id: 9, ...base, starts_at: null, time_slot: 'To be announced' };
F.italkList = [row, { id: 10, speaker_name: 'Other', hall: 'Aryabhata Theatre', starts_at: '2026-11-20 13:05', duration_min: 10, time_slot: 'Fri 20 Nov · 1:05 – 1:15 PM', status: 'confirmed' }];
let d = F.italkReadForm(form(base), row);
check('nothing changed: nothing is sent', d && Object.keys(d).length === 0, d);
let asked = '';
F.confirm = (m) => { asked = m; return false; };
d = F.italkReadForm(form({ ...base, day: '2026-11-20', start: '13:10', end: '13:18' }), row);
check('a time that overlaps another talk in the same hall asks first, and "no" saves nothing', d === null && /overlaps Other/.test(asked), asked);
F.confirm = () => true;
d = F.italkReadForm(form({ ...base, day: '2026-11-20', start: '13:10', end: '13:18' }), row);
check('a start and an end become starts_at and a length in minutes', d && d.starts_at === '2026-11-20 13:10' && d.duration_min === 8, d);
asked = ''; F.confirm = (m) => { asked = m; return true; };
F.italkReadForm(form({ ...base, hall: 'Raman Theatre', day: '2026-11-20', start: '13:10', end: '13:18' }), row);
check('the same time in another hall is not a clash', asked === '', asked);
let said = '';
F.toast = (m) => { said = m; };
check('a day without times is refused', F.italkReadForm(form({ ...base, day: '2026-11-20' }), row) === null && /start and the end/.test(said), said);
check('an end before the start is refused', F.italkReadForm(form({ ...base, day: '2026-11-20', start: '13:10', end: '13:00' }), row) === null && /after the start/.test(said), said);
check('no speaker name is refused', F.italkReadForm(form({ ...base, speaker_name: ' ' }), row) === null && /name of the speaker/.test(said), said);
d = F.italkReadForm(form(base), { ...row, starts_at: '2026-11-20 13:10', duration_min: 8 });
check('emptying day and times on a timed talk clears its time', d && d.starts_at === null, d);
d = F.italkReadForm(form({ ...base, topic: 'New topic' }), row);
check('only what changed is sent', d && JSON.stringify(d) === JSON.stringify({ topic: 'New topic' }), d);

// The announcement: the Announcements form, filled in.
const fields = { 'af-title': { value: '' }, 'af-content': { value: '' }, 'af-type': { value: 'urgent' } };
let opened = 0;
const A = await W.adminTalkFunctions({ openCreateAnnouncement: () => { opened++; }, document: { getElementById: (x) => fields[x] || null } });
A.italkList = [{ id: 5, speaker_name: 'Amritesh Kumar', speaker_title: 'Product Head', company: 'Phoebetal Technologies', topic: 'AVISA One: From Health Signals to Connected Care', time_slot: 'Fri 20 Nov · 1:10 – 1:18 PM', hall: 'Aryabhata Theatre' },
  { id: 6, speaker_name: 'Shashi Bhushan', company: 'Gupshup.ai', topic: '', time_slot: 'To be announced', hall: '' }];
A.italkAnnounce(5);
check('Announce opens the Announcements form', opened === 1);
check('the title is the topic', fields['af-title'].value === 'Innovation Talk: AVISA One: From Health Signals to Connected Care', fields['af-title'].value);
check('the text names the speaker, the topic, the time and BOTH hall names', fields['af-content'].value === 'Amritesh Kumar, Product Head, Phoebetal Technologies on "AVISA One: From Health Signals to Connected Care". Fri 20 Nov · 1:10 – 1:18 PM, Aryabhata Theatre (Expo Hall).', fields['af-content'].value);
check('the type is set back to general', fields['af-type'].value === 'general');
A.italkAnnounce(6);
check('a talk with no topic or time says so instead of inventing one', fields['af-title'].value === 'Innovation Talk: Shashi Bhushan' && fields['af-content'].value === 'Shashi Bhushan, Gupshup.ai. Time to be announced.', fields['af-content'].value);
check('every hall has its real room name beside it', JSON.stringify(A.italkHallRooms) === JSON.stringify({ 'Aryabhata Theatre': 'Expo Hall', 'Homi J. Bhabha Hall': 'Peacock Hall', 'Kalam Theatre': 'Centrum Hall A', 'Raman Theatre': 'Centrum Hall B' }), A.italkHallRooms);
done();
