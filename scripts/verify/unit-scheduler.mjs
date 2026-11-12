// Unit: the scheduler's checks in Admin -> Conference (12 Nov 2026), each rule on its
// own, no server and no database. src/routes/conference.ts is compiled in memory and
// its pure helpers are called directly: the hours a day spans, free time in a hall,
// where a session fits, which session is which Innovation Talk, every kind of note on
// the "Needs attention" list, and an event's own dates and venue in words.
// Run:  node scripts/verify/unit-scheduler.mjs
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../../src/routes/conference.ts', import.meta.url));
const out = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent', mainFields: ['module', 'main'] });
const C = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

let fails = 0, passes = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 400))); if (ok) passes++; else fails++; };

const D1 = '2026-11-20', D2 = '2026-11-21';
const A = 'Hall A', B = 'Hall B', X = 'Expo';
const halls = [{ name: A }, { name: B }, { name: X, purpose: 'Innovation Talks' }];
let nextId = 1;
const ses = (title, type, room, day, start, end, extra = {}) => ({ id: nextId++, title, session_type: type, room, start_time: `${day} ${start}`, end_time: `${day} ${end}`, links: [], others: '', status: 'published', ...extra });
const link = (...ids) => ids.map(id => (typeof id === 'object' ? id : { speaker_id: id, role: 'speaker' }));
const sp = (id, name, extra = {}) => ({ id, name, role: 'CEO', organisation: 'Acme', photo_url: '/p.webp', email: 'x@y.test', bio: 'Bio', is_published: 1, ...extra });
const kinds = (list) => list.map(i => i.kind);
const of = (list, kind) => list.filter(i => i.kind === kind);
const run = (sessions, speakers = [], extra = {}) => C.findIssues({ sessions, speakers, halls, days: [D1, D2], eventDays: [D1, D2], ...extra });

// ---- the hours a day spans ----
let s = [ses('Open', 'keynote', A, D1, '09:30', '10:00'), ses('Close', 'ceremony', B, D1, '17:30', '18:10')];
check('a day spans its first start to its last end', JSON.stringify(C.dayWindow(s, D1)) === JSON.stringify({ from: 570, to: 1090, empty: false }), C.dayWindow(s, D1));
check('a day with nothing on it is planned 9:30 to 6:00, and says it is empty', C.dayWindow(s, D2).empty === true && C.dayWindow(s, D2).from === 570 && C.dayWindow(s, D2).to === 1080);
check('a session with no proper times is not counted', C.dayWindow([{ id: 9, start_time: `${D1} 10:00`, end_time: `${D1} 10:00`, room: A }], D1).empty === true);

// ---- free time in a hall ----
s = [ses('Reg', 'break', A, D1, '08:30', '09:30'), ses('Key', 'keynote', A, D1, '09:35', '10:00'), ses('Panel', 'panel', A, D1, '11:00', '12:00'), ses('Late', 'talk', B, D1, '15:00', '16:00')];
let f = C.freeSlots(s, halls, [D1]);
const fa = f.filter(x => x.hall === A);
check('a gap of an hour between two sessions is free time', fa.some(x => x.start === '10:00' && x.end === '11:00' && x.minutes === 60 && !x.whole), fa);
check('a five-minute changeover is not', !fa.some(x => x.start === '09:30'), fa);
check('the hall is free from its last session to the end of the day', fa.some(x => x.start === '12:00' && x.end === '16:00' && x.minutes === 240), fa);
check('another hall is free from the start of the day until its first session', f.some(x => x.hall === B && x.start === '08:30' && x.end === '15:00' && x.minutes === 390), f.filter(x => x.hall === B));
check('a hall with nothing all day is one stretch, marked whole', f.filter(x => x.hall === X).length === 1 && f.find(x => x.hall === X).whole === true && f.find(x => x.hall === X).minutes === 450, f.filter(x => x.hall === X));
check('a gap of exactly 15 minutes counts; 14 does not', C.freeSlots([ses('a', 'talk', A, D1, '10:00', '10:30'), ses('b', 'talk', A, D1, '10:45', '11:00'), ses('c', 'talk', A, D1, '11:14', '11:30')], [{ name: A }], [D1]).map(x => x.start).join() === '10:30');
check('an exhibition-type session shares its hall, so the hall stays free', C.freeSlots([ses('Floor open', 'exhibition', A, D1, '10:00', '18:00')], [{ name: A }], [D1])[0].minutes === 480);
check('a hall switched off is left out', C.freeSlots(s, [{ name: A, is_active: 0 }], [D1]).length === 0);
check('overlapping sessions do not make free time appear twice', C.freeSlots([ses('a', 'talk', A, D1, '10:00', '12:00'), ses('b', 'talk', A, D1, '10:30', '11:00'), ses('c', 'talk', A, D1, '13:00', '13:30')], [{ name: A }], [D1]).map(x => x.start + '-' + x.end).join() === '12:00-13:00');

// ---- where a session fits ----
nextId = 1;
s = [ses('Reg', 'break', A, D1, '09:00', '09:30'), ses('Key', 'keynote', A, D1, '09:30', '10:02', { links: link(1) }), ses('Panel', 'panel', A, D1, '11:00', '12:00'),
  ses('Talk B', 'talk', B, D1, '10:05', '10:45', { links: link(1) }), ses('End', 'ceremony', B, D1, '17:00', '17:30')];
let g = C.suggestSlots(s, halls, { day: D1, minutes: 30, hall: A, speakerIds: [] });
check('the asked-for hall comes first, earliest first, starting on five minutes', g[0].hall === A && g[0].start === '10:05' && g[0].end === '10:35' && g[0].free_until === '11:00', g[0]);
g = C.suggestSlots(s, halls, { day: D1, minutes: 30, hall: A, speakerIds: [1] });
check('a slot is moved past the time its speaker is on stage elsewhere', g[0].hall === A && g[0].start === '12:00', g.slice(0, 2));
g = C.suggestSlots(s, halls, { day: D1, minutes: 120, hall: A, speakerIds: [] });
check('a length that does not fit a gap skips that gap', g.every(x => !(x.hall === A && x.start === '10:05')) && g.some(x => x.hall === A && x.start === '12:00'), g);
g = C.suggestSlots(s, halls, { day: D1, minutes: 30, hall: A, speakerIds: [], exceptId: 3 });
check('the session being moved does not block its own slot', g[0].start === '10:05' && g[0].free_until === '17:30', g[0]);
check('the session being moved keeps the day it opens: its own early slot is still offered', C.suggestSlots([ses('First', 'talk', A, D1, '09:00', '09:30'), ses('Later', 'talk', A, D1, '12:00', '13:00')], [{ name: A }], { day: D1, minutes: 30, exceptId: nextId - 2 })[0].start === '09:00');
check('a blank day offers 9:30 in the first hall', C.suggestSlots([], halls, { day: D2, minutes: 45 })[0].start === '09:30' && C.suggestSlots([], halls, { day: D2, minutes: 45 })[0].hall === A);
check('nothing fits: an empty list, not an error', C.suggestSlots(s, [{ name: A }], { day: D1, minutes: 600 }).length === 0);
check('at most the number asked for', C.suggestSlots(s, halls, { day: D1, minutes: 5, limit: 2 }).length === 2);

// ---- which session is which Innovation Talk ----
nextId = 1;
const talkSessions = [ses('Innovation Talk: Paisani Technology Services', 'talk', X, D1, '11:30', '11:38', { speaker_name: 'Dipak Zope' }),
  ses('Innovation Talk: Seem Fintech & Sustainability', 'talk', X, D1, '17:56', '18:06', { speaker_name: 'Seema Sutradhar' }),
  ses('Innovation Talk', 'talk', X, D1, '12:00', '12:08', { speaker_name: 'Dr. Raja N. Moorthy' }),
  ses('AI in Banking', 'panel', A, D1, '12:00', '13:00', { speaker_name: 'Dipak Zope' })];
const talks = [{ id: 11, company: 'Paisani Technology Services Pvt. Ltd.', speaker_name: 'Dipak Zope' }, { id: 12, company: 'Seem Fintech and Sustainability', speaker_name: 'Seema Sutradhar' },
  { id: 13, company: 'Kirusa', speaker_name: 'Raja N. Moorthy' }, { id: 14, company: 'Nobody Co', speaker_name: 'No One' }];
let L = C.linkTalks(talkSessions, talks);
check('"Innovation Talk: <company>" is matched to the company, past "Pvt. Ltd." and "&"', L.get(11) === 1 && L.get(12) === 2, [...L]);
check('a plain "Innovation Talk" is matched by the speaker it names, titles of address aside', L.get(13) === 3, [...L]);
check('a talk with no session is not linked, and a panel is never taken for a talk', !L.has(14) && ![...L.values()].includes(4));
L = C.linkTalks([talkSessions[0]], [{ id: 21, company: 'Paisani Technology Services', speaker_name: 'A' }, { id: 22, company: 'Paisani Technology Services', speaker_name: 'B' }]);
check('two people of one company presenting together share the one session', L.get(21) === 1 && L.get(22) === 1);

// ---- needs attention: it cannot run as written ----
nextId = 1;
let list = run([ses('One', 'talk', A, D1, '10:00', '10:30', { links: link(1) }), ses('Two', 'talk', A, D1, '10:15', '10:45', { links: link(2) })], [sp(1, 'Asha'), sp(2, 'Ravi')]);
check('two sessions at once in a hall: "cannot run"', of(list, 'hall-clash').length === 1 && of(list, 'hall-clash')[0].level === 'bad' && of(list, 'hall-clash')[0].session_id === 1 && of(list, 'hall-clash')[0].other_id === 2 && /Two sessions at once in Hall A/.test(of(list, 'hall-clash')[0].what), list);
check('the worst come first', list[0].level === 'bad');
nextId = 1;
list = run([ses('One', 'talk', A, D1, '10:00', '10:30', { links: link(1) }), ses('Two', 'talk', B, D1, '10:15', '10:45', { links: link(1) })], [sp(1, 'Asha Rao')]);
check('one person in two places: "cannot run", naming them and both halls', of(list, 'speaker-clash').length === 1 && /Asha Rao is in two places at once/.test(of(list, 'speaker-clash')[0].what) && /Hall A/.test(of(list, 'speaker-clash')[0].what) && /Hall B/.test(of(list, 'speaker-clash')[0].what));
nextId = 1;
list = run([ses('One', 'talk', A, D1, '10:00', '10:30', { links: link(1) }), ses('Two', 'talk', B, D1, '10:35', '11:00', { links: link(1) }), ses('Three', 'talk', B, D1, '11:00', '11:20', { links: link(1) })], [sp(1, 'Asha Rao')]);
check('five minutes to cross from one hall to another is flagged; the same hall back to back is not', of(list, 'tight-move').length === 1 && /only 5 minutes to get from Hall A to Hall B/.test(of(list, 'tight-move')[0].what) && of(list, 'tight-move')[0].level === 'warn', of(list, 'tight-move'));
nextId = 1;
list = run([ses('One', 'talk', A, D1, '10:00', '10:30', { links: link(1) }), ses('Two', 'talk', B, D1, '10:40', '11:00', { links: link(1) })], [sp(1, 'Asha Rao')]);
check('ten minutes is enough', of(list, 'tight-move').length === 0);

// ---- needs attention: each session ----
nextId = 1;
list = run([ses('No hall', 'talk', '', D1, '10:00', '10:30', { links: link(1) }), ses('Odd hall', 'talk', 'Tent', D1, '11:00', '11:30', { links: link(1) }),
  ses('Off day', 'talk', A, '2026-11-25', '10:00', '10:30', { links: link(1) }), ses('Blink', 'talk', A, D1, '12:00', '12:03', { links: link(1) }),
  ses('Marathon', 'workshop', B, D1, '09:00', '14:00', { links: link(1) }), ses('Lunch', 'break', B, D1, '14:00', '14:02')], [sp(1, 'Asha')]);
check('no hall yet', of(list, 'no-hall').length === 1 && of(list, 'no-hall')[0].session_id === 1);
check('a hall that is not on the halls list', of(list, 'unknown-hall').length === 1 && /"Tent"/.test(of(list, 'unknown-hall')[0].what));
check("a session outside the event's days", of(list, 'off-day').length === 1 && of(list, 'off-day')[0].day === '2026-11-25');
check('three minutes long is flagged; a two-minute break is not', of(list, 'too-short').length === 1 && of(list, 'too-short')[0].session_id === 4);
check('five hours without a break', of(list, 'too-long').length === 1 && /5 hours/.test(of(list, 'too-long')[0].what));
nextId = 1;
list = run([ses('AI talk', 'talk', A, D1, '10:00', '10:30'), ses('Lunch', 'break', A, D1, '13:00', '14:00'), ses('Typed', 'talk', A, D1, '11:00', '11:30', { others: 'Asha Rao (Tata)' }), ses('Bad times', 'talk', A, D1, '15:00', '15:00')]);
check('a talk with no speaker is flagged; a break never is', of(list, 'no-speaker').length === 1 && of(list, 'no-speaker')[0].session_id === 1);
check('someone typed by hand counts as a speaker, and is noted as having no profile', !of(list, 'no-speaker').some(i => i.session_id === 3) && of(list, 'typed-people').length === 1 && /Asha Rao is typed by hand/.test(of(list, 'typed-people')[0].what) && of(list, 'typed-people')[0].level === 'info');
check('a session whose times make no sense', of(list, 'no-time').length === 1 && of(list, 'no-time')[0].session_id === 4);
nextId = 1;
list = run([ses('Panel one', 'panel', A, D1, '10:00', '11:00', { links: link(1, 2) }), ses('Panel two', 'panel', A, D1, '11:00', '12:00', { links: link(1, { speaker_id: 2, role: 'moderator' }) }),
  ses('Panel three', 'panel', A, D1, '12:00', '13:00', { links: link(1), others: 'B (Org), C (Moderator)' }), ses('Panel four', 'panel', A, D1, '14:00', '15:00')], [sp(1, 'Asha'), sp(2, 'Ravi')]);
check('a panel with no moderator', of(list, 'no-moderator').map(i => i.session_id).join() === '1', of(list, 'no-moderator'));
check('a panel with one panellist beside its moderator', of(list, 'thin-panel').map(i => i.session_id).join() === '2' && /only one panellist/.test(of(list, 'thin-panel')[0].what));
check('a moderator typed by hand counts as the moderator', !of(list, 'no-moderator').some(i => i.session_id === 3) && !of(list, 'thin-panel').some(i => i.session_id === 3));
check('an empty panel is "no speaker yet", not three notes', of(list, 'no-speaker').map(i => i.session_id).join() === '4' && !of(list, 'no-moderator').some(i => i.session_id === 4));
nextId = 1;
list = run([ses('Keynote', 'keynote', A, D1, '10:00', '10:10', { links: link(1) }), ses('Keynote 2', 'keynote', A, D1, '10:10', '10:20', { links: link(1) }), ses('AI for Bharat', 'keynote', A, D1, '10:20', '10:30', { links: link(1) }),
  ses('Session', 'break', A, D1, '13:00', '14:00'), ses('Draft one', 'talk', B, D1, '10:00', '10:30', { links: link(1), status: 'draft' })], [sp(1, 'Asha')]);
check('a keynote titled only "Keynote" has no topic yet (a note, not an alarm)', of(list, 'no-topic').map(i => i.session_id).join() === '1,2' && of(list, 'no-topic')[0].level === 'info', of(list, 'no-topic'));
check('a draft is noted: attendees do not see it', of(list, 'draft').length === 1 && of(list, 'draft')[0].group === 'draft');

// ---- needs attention: each speaker ----
nextId = 1;
list = run([ses('T', 'talk', A, D1, '10:00', '10:30', { links: link(1, 2, 3, 5) })], [sp(1, 'Complete'), sp(2, 'No Photo', { photo_url: '', email: '' }), sp(3, 'Hidden One', { is_published: 0 }), sp(4, 'No Slot'), sp(5, 'Only Bio Missing', { bio: '' }), sp(6, 'Hidden And Idle', { is_published: 0 })]);
const spk = list.filter(i => i.group === 'speaker');
check('a complete speaker on the programme raises nothing', !spk.some(i => i.speaker_id === 1));
check('no photo is a "check", and the missing email is named with it', spk.some(i => i.speaker_id === 2 && i.level === 'warn' && /no photo/.test(i.what) && /no email/.test(i.what)), spk);
check('on the programme but hidden from attendees', spk.some(i => i.speaker_id === 3 && i.kind === 'hidden-speaker' && i.level === 'warn'));
check('shown to attendees with no session yet: a note', spk.some(i => i.speaker_id === 4 && i.kind === 'speaker-no-session' && i.level === 'info'));
check('only a bio missing is a note, not a "check"', spk.some(i => i.speaker_id === 5 && i.level === 'info' && /no bio/.test(i.what)));
check('hidden and not on the programme: nothing to say', !spk.some(i => i.speaker_id === 6));

// ---- needs attention: Innovation Talks ----
nextId = 1;
const ts = [ses('Innovation Talk: Alpha', 'talk', X, D1, '11:30', '11:38', { speaker_name: 'Al' }), ses('Innovation Talk: Beta', 'talk', X, D1, '11:40', '11:48', { speaker_name: 'Be' }),
  ses('Innovation Talk: Gamma', 'talk', X, D1, '11:50', '11:58', { speaker_name: 'Ga' }), ses('Innovation Talk: Delta', 'talk', X, D1, '12:00', '12:08', { speaker_name: 'De' })];
const tk = [{ id: 1, company: 'Alpha', speaker_name: 'Al', topic: 'T', starts_at: `${D1} 11:30`, duration_min: 8, hall: X, time_slot: 'Fri 11:30' },
  { id: 2, company: 'Beta', speaker_name: 'Be', topic: '', starts_at: `${D1} 13:00`, duration_min: 8, hall: X, time_slot: 'Fri 1:00' },
  { id: 3, company: 'Gamma', speaker_name: 'Ga', topic: 'T', starts_at: null, time_slot: 'To be announced' },
  { id: 4, company: 'Delta', speaker_name: 'De', topic: 'T', status: 'cancelled', starts_at: `${D1} 12:00`, duration_min: 8, hall: X },
  { id: 5, company: 'Epsilon', speaker_name: 'Ep', topic: 'T', starts_at: `${D2} 10:00`, duration_min: 10, hall: X, time_slot: 'Sat 21 Nov · 10:00 – 10:10 AM' },
  { id: 6, company: 'Zeta', speaker_name: 'Ze', topic: 'T', starts_at: null }, { id: 7, company: 'Eta', speaker_name: 'Et', topic: 'T', starts_at: null }];
list = run(ts, [], { talks: tk });
const tl = list.filter(i => i.group === 'talk');
check('a talk whose list and programme agree raises nothing', !tl.some(i => i.talk_id === 1));
check('the programme and the talks list give different times: both are quoted', tl.some(i => i.talk_id === 2 && i.kind === 'talk-differs' && /programme says 11:40 to 11:48/.test(i.what) && /list says 13:00 to 13:08/.test(i.what)), tl);
check('a talk with no topic is noted', tl.some(i => i.talk_id === 2 && i.kind === 'talk-no-topic' && i.level === 'info'));
check('on the programme, but the talks list has no time for it', tl.some(i => i.talk_id === 3 && i.kind === 'talk-differs' && /has no time for it/.test(i.what)));
check('cancelled on the talks list but still on the programme', tl.some(i => i.talk_id === 4 && i.kind === 'talk-cancelled'));
check('has a time on the talks list but is not on the programme', tl.some(i => i.talk_id === 5 && i.kind === 'talk-not-on-programme' && i.day === D2 && i.start === '10:00' && i.end === '10:10'));
check('talks with no time and no session are counted in one line', of(list, 'talks-unplaced').length === 1 && /^2 Innovation Talks have no time yet/.test(of(list, 'talks-unplaced')[0].what));
check("a talk's session is not said to have a hand-typed speaker or no speaker", !list.some(i => (i.kind === 'typed-people' || i.kind === 'no-speaker') && i.session_id <= 4));

// ---- needs attention: free time ----
nextId = 1;
list = run([ses('Key', 'keynote', A, D1, '09:30', '10:00', { links: link(1) }), ses('Panel', 'panel', A, D1, '11:00', '12:00', { links: link(1, { speaker_id: 2, role: 'moderator' }, 3) })], [sp(1, 'A'), sp(2, 'B'), sp(3, 'C')]);
const fr = list.filter(i => i.group === 'free');
check('a free hour is a note with its hall, day and times', fr.some(i => i.kind === 'free' && i.hall === A && i.day === D1 && i.start === '10:00' && i.end === '11:00' && /free for 1 h/.test(i.what) && i.level === 'info'), fr);
check('a hall with nothing all day is one line, not one per gap', fr.filter(i => i.kind === 'empty-hall' && i.hall === B).length === 1);
check('a day with nothing planned is one line, with no hall lines under it', fr.filter(i => i.kind === 'empty-day' && i.day === D2).length === 1 && !fr.some(i => i.day === D2 && i.kind !== 'empty-day'));
check('every note has a key of its own', new Set(list.map(i => i.key)).size === list.length);
check('free time never counts as something to fix', fr.every(i => i.level === 'info'));

// ---- an event in words ----
check('two days in one month', C.eventWords({ title: 'Bharat AI Innovation Delhi 2027', venue: 'Bharat Mandapam, New Delhi', start_date: '2027-07-28', end_date: '2027-07-29' }).line === '28-29 July 2027 · Bharat Mandapam, New Delhi');
check('one day', C.eventWords({ title: 'X', venue: 'V', start_date: '2027-03-05', end_date: '2027-03-05' }).when === '5 March 2027');
check('across two months', C.eventWords({ title: 'X', venue: '', start_date: '2027-06-30', end_date: '2027-07-01' }).line === '30 June to 1 July 2027');
check("Mumbai keeps the words its first emails carried", C.MUMBAI_WORDS.line === '20-21 November 2026 · World Trade Center, Mumbai');
const slot = [{ id: 1, title: 'AI & <b>Bharat</b>', start_time: '2027-07-28 10:00', end_time: '2027-07-28 10:30', room: 'Hall 1', my_role: 'keynote', hall: { venue_room: 'Plenary', location: 'Level 2' } }];
const delhi = C.eventWords({ title: 'Bharat AI Innovation Delhi 2027', venue: 'Bharat Mandapam, New Delhi', start_date: '2027-07-28', end_date: '2027-07-29' });
const mail = C.slotEmailHTML({ name: 'Dr. Asha Rao' }, slot, '', '', delhi);
check("a Delhi speaker's email names Delhi, its dates and its venue, and never Mumbai", /Bharat AI Innovation Delhi 2027/.test(mail.subject) && mail.html.includes('28-29 July 2027 &middot; Bharat Mandapam, New Delhi') && !/Mumbai|World Trade|November/.test(mail.html), mail.subject);
const mum = C.slotEmailHTML({ name: 'Asha' }, slot, '', '');
check("with no event given, the email is Mumbai's, word for word as before", /Your session at Bharat AI Innovation 2026: /.test(mum.subject) && mum.html.includes('20-21 November 2026 &middot; World Trade Center, Mumbai') && mum.html.includes('Thank you for speaking at Bharat AI Innovation 2026.'));

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
