// Unit: Admin -> Conference's rules, each on its own, no server and no database
// (12 Nov 2026). src/routes/conference.ts is compiled in memory with esbuild and its
// pure helpers are called directly: names matched across the agenda's spelling and
// the speakers table's, the typed speaker line read and written the way the app's
// cards split it, clashes, times, slugs, and the slot email's words and escaping.
// Run:  node scripts/verify/unit-conference.mjs
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../../src/routes/conference.ts', import.meta.url));
const out = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent', mainFields: ['module', 'main'] });
const C = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + (typeof d === 'string' ? d : JSON.stringify(d)))); if (!ok) fails++; };

// ---- one person, however the agenda and the speakers table write them ----
const same = [
  ['Shri K.K. Singh', 'Shri. K.K. Singh'], ['Mr. Bhupesh Daheria', 'Bhupesh Daheria'], ['Rajesh Dhuddu (PhD)', 'Rajesh Dhuddu'],
  ['Hon’ble Smt. Aditi Tatkare', "Hon'ble Smt. Aditi Tatkare"], ['Shri Virendra Singh (IAS)', 'Shri Virendra Singh'], ['Dr. Saurabh N. Mehta', 'Saurabh N. Mehta'],
  ['  dr   ashish  tendulkar ', 'Dr. Ashish Tendulkar'], ['Prof. Asha Rao', 'Asha Rao'], ['Shri Vivek Khandekar (IFS)', 'Shri Vivek Khandekar'],
];
for (const [a, b] of same) check(`same person: "${a}" and "${b}"`, C.normName(a) === C.normName(b) && C.normName(a).length > 3, [C.normName(a), C.normName(b)]);
check('different people stay different (K.K. Singh, Virendra Singh)', C.normName('Shri K.K. Singh') !== C.normName('Shri Virendra Singh (IAS)'));
check('a title is taken off only as a whole word: Shrikant, Drishti and Smita keep their names',
  C.normName('Dr. Shrikant Patil') === 'shrikant patil' && C.normName('Drishti Kapoor') === 'drishti kapoor' && C.normName('Smita Rao') === 'smita rao', [C.normName('Dr. Shrikant Patil'), C.normName('Drishti Kapoor')]);

// ---- the typed line, as the app's panel cards read it ----
const line = 'Tarun Chugh (Bajaj Life Insurance), Ratan Kumar Kesh (Bandhan Bank), Shailesh Dhuri (Moderator)';
const parts = C.splitSpeakerLine(line);
check('a panel line splits into its three people', parts.length === 3 && parts[0].name === 'Tarun Chugh' && parts[0].info === 'Bajaj Life Insurance', parts);
check('the moderator is read as the moderator', parts[2].name === 'Shailesh Dhuri' && parts[2].role === 'moderator', parts[2]);
check('a comma inside brackets does not split a person', C.splitSpeakerLine('Asha Rao (Tata, Capital), B').length === 2);
check('(IAS) is part of the name, not an organisation', C.splitSpeakerLine('Shri Virendra Singh (IAS)')[0].info === '' && C.splitSpeakerLine('Shri Virendra Singh (IAS)')[0].name === 'Shri Virendra Singh (IAS)');
check('an empty line has nobody', C.splitSpeakerLine('').length === 0 && C.splitSpeakerLine(null).length === 0);

const speakers = [{ id: 2, name: 'Tarun Chugh' }, { id: 3, name: 'Shailesh Dhuri' }, { id: 1, name: 'Shri. K.K. Singh' }];
const d = C.deriveLinks(line, speakers, 'panel');
check('the speakers a line names are found by name', d.links.map(l => l.speaker_id).join() === '2,3', d.links);
check('their parts come from the line and the type (panellist, moderator)', d.links[0].role === 'panellist' && d.links[1].role === 'moderator', d.links);
check('someone not on the speakers list is kept as typed, organisation and all', d.others === 'Ratan Kumar Kesh (Bandhan Bank)', d.others);
check('a keynote line makes a keynote speaker', C.deriveLinks('Shri K.K. Singh', speakers, 'keynote').links[0]?.role === 'keynote');
check('a name twice on a line is one link', C.deriveLinks('Tarun Chugh, Tarun Chugh (Bajaj)', speakers).links.length === 1);
check('typedOthers keeps only the people not on the list', C.typedOthers(line, speakers) === 'Ratan Kumar Kesh (Bandhan Bank)');

// ---- writing the line back ----
const one = C.composeSpeakerLine([{ name: 'Shri. K.K. Singh', role_title: 'Joint Secretary, MeitY', organisation: 'Govt of India', role: 'keynote' }]);
check('one speaker: their name, and role with organisation as the title line', one.speaker_name === 'Shri. K.K. Singh' && one.speaker_title === 'Joint Secretary, MeitY, Govt of India', one);
const panel = C.composeSpeakerLine([
  { name: 'Tarun Chugh', organisation: 'Bajaj Life Insurance', role: 'panellist' },
  { name: 'Shri Virendra Singh (IAS)', organisation: 'Electronics, IT & AI Dept; Government of Maharashtra', role: 'panellist' },
  { name: 'Shailesh Dhuri', organisation: 'Decimal Point Analytics', role: 'moderator' },
], 'Ratan Kumar Kesh (Bandhan Bank)');
check('a panel line in the app’s format, moderator named as such, typed people kept',
  panel.speaker_name === 'Tarun Chugh (Bajaj Life Insurance), Shri Virendra Singh (Electronics), Shailesh Dhuri (Moderator), Ratan Kumar Kesh (Bandhan Bank)', panel.speaker_name);
check('no comma inside a person and no stray brackets, so the app splits it right',
  panel.speaker_name.split(',').length === 4 && panel.speaker_name.split(',').every(p => /^[^()]+( \([^()]+\))?$/.test(p.trim())), panel.speaker_name);
check('the line written reads back as the same people', C.deriveLinks(panel.speaker_name, [{ id: 9, name: 'Shri Virendra Singh (IAS)' }, { id: 2, name: 'Tarun Chugh' }], 'panel').links.length === 2);
check('nobody chosen and nothing typed: no line', C.composeSpeakerLine([], '').speaker_name === null);
check('nobody chosen, a name typed: that name and its typed title', JSON.stringify(C.composeSpeakerLine([], 'Guest of Honour', 'To be announced')) === JSON.stringify({ speaker_name: 'Guest of Honour', speaker_title: 'To be announced' }));
check('a lone moderator is still written as the moderator', C.composeSpeakerLine([{ name: 'A B', role: 'moderator' }]).speaker_name === 'A B (Moderator)');

// ---- times ----
check('a time from the form is the database’s wall clock', C.cleanTime('2026-11-20T14:05') === '2026-11-20 14:05' && C.cleanTime('2026-11-20 14:05:00') === '2026-11-20 14:05');
check('a time that is not one is refused', C.cleanTime('tomorrow') === null && C.cleanTime('') === null && C.cleanTime('2026-11-20') === null);
check('the day is said in words', C.dayLabel('2026-11-20 10:00') === 'Friday 20 November' && C.dayLabel('2026-11-21') === 'Saturday 21 November');
check('the time is said the way people say it', C.clock('2026-11-20 14:05') === '2:05 pm' && C.clock('2026-11-20 00:30') === '12:30 am' && C.clock('2026-11-20 12:00') === '12:00 pm' && C.clock('x') === '');

// ---- clashes ----
const S = (id, room, a, b, sp = [], type = 'talk') => ({ id, title: 'S' + id, room, session_type: type, start_time: '2026-11-20 ' + a, end_time: '2026-11-20 ' + b, speakers: sp.map(x => ({ id: x, name: 'P' + x })) });
let c = C.findClashes([S(1, 'Hall A', '10:00', '11:00'), S(2, 'Hall A', '10:30', '11:30')]);
check('two sessions in one hall at once: a hall clash', c.room.length === 1 && c.speaker.length === 0, c);
c = C.findClashes([S(1, 'Hall A', '10:00', '11:00'), S(2, 'Hall A', '11:00', '12:00')]);
check('one ending as the next starts is not a clash', c.room.length === 0, c);
c = C.findClashes([S(1, 'Hall A', '10:00', '11:00', [7]), S(2, 'Hall B', '10:30', '10:45', [7])]);
check('one speaker in two halls at once: a speaker clash', c.speaker.length === 1 && c.speaker[0].speaker_id === 7 && c.room.length === 0, c);
c = C.findClashes([S(1, 'Expo', '10:00', '18:00', [], 'exhibition'), S(2, 'Expo', '11:00', '11:10')]);
check('the exhibition being open is not a clash with a talk on its stage', c.room.length === 0, c);
c = C.findClashes([S(1, 'Hall A', '10:00', '11:00'), { ...S(2, 'Hall A', '10:30', '11:30'), start_time: '2026-11-21 10:30', end_time: '2026-11-21 11:30' }]);
check('the same hours on another day are not a clash', c.room.length === 0, c);
c = C.findClashes([S(1, '', '10:00', '11:00'), S(2, '', '10:00', '11:00')]);
check('two sessions with no hall yet do not clash with each other', c.room.length === 0, c);

// ---- slugs ----
check('a slug leaves out the title of address', C.slugFor('Dr. Ashish Tendulkar') === 'ashish-tendulkar' && C.slugFor('Hon’ble Shri Sanjay Rathod') === 'sanjay-rathod');
check('a name of only symbols still has a slug', C.slugFor('***') === 'speaker');

// ---- the slot email ----
const mail = C.slotEmailHTML({ name: 'Dr. Asha <b>Rao</b>', email: 'a@b.c' }, [
  { title: 'AI & <script>alert(1)</script>', start_time: '2026-11-20 14:00', end_time: '2026-11-20 15:00', room: 'Homi J. Bhabha Hall', my_role: 'moderator', hall: { venue_room: 'Peacock Hall', location: 'Ground Floor, Centre One' } },
], 'Please reach 30 minutes early.', '<div>HEADER</div>');
check('the subject names the day, the time and the hall', mail.subject === 'Your session at Bharat AI Innovation 2026: Friday 20 November, 2:00 pm, Homi J. Bhabha Hall', mail.subject);
check('the email names the hall and the room at the venue, and how to find it', mail.html.includes('Homi J. Bhabha Hall · Peacock Hall') && mail.html.includes('Ground Floor, Centre One'));
check('the email says their part and both times', mail.html.includes('Moderator') && mail.html.includes('2:00 pm') && mail.html.includes('3:00 pm'));
check('the email greets them by first name, without the title', mail.html.includes('Dear Asha'));
check('nothing typed in Admin can run in the email', !mail.html.includes('<script>') && mail.html.includes('&lt;script&gt;') && !mail.html.includes('<b>Rao</b>'));
check('the organiser’s line goes in, and the brand header', mail.html.includes('Please reach 30 minutes early.') && mail.html.includes('<div>HEADER</div>'));
check('the email never blames anyone and asks for a reply if wrong', /reply to this email/i.test(mail.html) && !/(our side|the app had a problem|sorry for the)/i.test(mail.html));
const two = C.slotEmailHTML({ name: 'X' }, [mail && { title: 'A', start_time: '2026-11-20 10:00', end_time: '2026-11-20 10:30', room: '' }, { title: 'B', start_time: '2026-11-21 10:00', end_time: '2026-11-21 10:30', room: 'R' }], '', '');
check('two sessions: the subject says two, and a missing hall says so plainly', two.subject === 'Your 2 sessions at Bharat AI Innovation 2026' && two.html.includes('Hall to be confirmed'), two.subject);

// ---- both names of a hall (organiser, 12 Nov 2026) ----
check('a hall is shown by both names, the event’s first', C.hallLabel('Aryabhata Theatre', 'Expo Hall') === 'Aryabhata Theatre · Expo Hall');
check('a hall with no venue name, or the same name twice, is shown once', C.hallLabel('Board Room', '') === 'Board Room' && C.hallLabel('Expo Hall', 'expo hall') === 'Expo Hall' && C.hallLabel('', 'Peacock Hall') === 'Peacock Hall');
const filled = C.fillVenues([{ room: 'Raman Theatre' }, { room: 'Elsewhere' }, { room: 'Aryabhata Theatre', venue_room: 'Kept' }]);
check('a session list without the halls table still gets each venue name', filled[0].venue_room === 'Centrum Hall B' && !filled[1].venue_room && filled[2].venue_room === 'Kept', filled);
check('Aryabhata is the Expo Hall and Kalam is Centrum Hall A (organiser, 12 Nov: swapped; "Expo Hall", not "Expo Stage")', C.DEFAULT_HALLS.find(h => h.name === 'Aryabhata Theatre').venue_room === 'Expo Hall' && C.DEFAULT_HALLS.find(h => h.name === 'Kalam Theatre').venue_room === 'Centrum Hall A');

// ---- the lists the screen offers ----
check('every session type the app already knows, and no new one', C.SESSION_TYPES.join() === 'keynote,talk,panel,workshop,ceremony,exhibition,networking,break');
check('the four halls of 20-21 Nov with their venue rooms', C.DEFAULT_HALLS.map(h => h.name + '=' + h.venue_room).join('; ') === 'Homi J. Bhabha Hall=Peacock Hall; Kalam Theatre=Centrum Hall A; Raman Theatre=Centrum Hall B; Aryabhata Theatre=Expo Hall');
check('the migration command names the file and the production database', C.MIGRATION_COMMAND.includes('bharatai-production --remote') && C.MIGRATION_COMMAND.includes('0054_conference_manager.sql'));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
