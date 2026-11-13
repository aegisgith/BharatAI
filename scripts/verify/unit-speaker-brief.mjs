// Unit: the speaker brief's rules, each on its own, no server and no database
// (12 Nov 2026). src/routes/speaker-brief.ts is compiled in memory with esbuild and
// its pure helpers are called directly: who is a minister, the hall in a sentence,
// the other people on a panel (never the speaker themselves, never an email), the
// fingerprint that notices a change, the status words, IST to UTC for calendars, the
// email (both hall names, panel, calendar links, pass button, escaping, "Updated:"),
// and the WhatsApp text (no sign-in link).
// Run:  node scripts/verify/unit-speaker-brief.mjs
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../../src/routes/speaker-brief.ts', import.meta.url));
const out = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent', mainFields: ['module', 'main'] });
const B = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 400))); if (!ok) fails++; };
const WORDS = { name: 'Bharat AI Innovation 2026', when: '20-21 November 2026', venue: 'World Trade Center, Mumbai', line: '20-21 November 2026 · World Trade Center, Mumbai' };

// ---- ministers ----
check('Hon’ble (curly) is a minister', B.isProtocol({ name: 'Hon’ble Shri Chandrakant Dada Patil', role: 'Minister of Higher & Technical Education' }));
check("Hon'ble (straight) is a minister", B.isProtocol({ name: "Hon'ble Smt. Aditi Tatkare", role: '' }));
check('a role naming a minister is a minister', B.isProtocol({ name: 'Shri Someone', role: 'Union Minister of Food Processing Industries' }));
check('a Joint Secretary is not', !B.isProtocol({ name: 'Shri. K.K. Singh', role: 'Joint Secretary, MeitY' }));
check('"Administer" in a role is not a minister', !B.isProtocol({ name: 'Asha Rao', role: 'Administers the AI lab' }));

// ---- halls by both names ----
check('a hall in a sentence carries both names', B.hallSentence('Homi J. Bhabha Hall', 'Peacock Hall') === 'Homi J. Bhabha Hall (Peacock Hall)');
check('no venue room: just the hall', B.hallSentence('Raman Theatre', '') === 'Raman Theatre');
check('the same name twice is said once', B.hallSentence('Expo Hall', 'Expo Hall') === 'Expo Hall');

// ---- the panel ----
const speakers = new Map([
  [1, { id: 1, name: 'Saurabh Kushwah', organisation: 'BULLET Microdrama · ZEEL', email: 'saurabh@example.test' }],
  [2, { id: 2, name: 'Simon David Hunter', organisation: 'Asian Screen Institute, Singapore', email: 'simon@example.test' }],
  [3, { id: 3, name: 'Mukesh Jain', organisation: 'Capgemini', email: 'mukesh@example.test' }],
]);
const panel = { id: 143, title: 'Content, Creativity & AI', session_type: 'panel', start_time: '2026-11-21 15:15', end_time: '2026-11-21 16:15', room: 'Homi J. Bhabha Hall',
  speaker_name: 'Rajat Nigam (JioStar India), Simon David Hunter (Asian Screen Institute Singapore), Saurabh Kushwah (BULLET Microdrama · ZEEL), Mukesh Jain (Moderator)',
  links: [{ speaker_id: 2, role: 'panellist' }, { speaker_id: 1, role: 'panellist' }, { speaker_id: 3, role: 'moderator' }], others: 'Rajat Nigam (JioStar India)' };
const p = B.peopleOf(panel, 1, speakers);
check('the moderator is named with their organisation', p.moderators.length === 1 && p.moderators[0].name === 'Mukesh Jain' && p.moderators[0].org === 'Capgemini', p);
check('the other panellists: linked ones and the one typed by hand', p.others.map(x => x.name).join() === 'Simon David Hunter,Rajat Nigam', p.others);
check('the speaker is never listed as their own co-panellist', !JSON.stringify(p).includes('Kushwah'));
check('no email of anyone is in the panel list', !JSON.stringify(p).includes('@'));
const typedMod = B.peopleOf({ links: [], others: 'Asha Rao (Moderator), Ravi Kumar (Tata Capital)' }, 9, speakers);
check('a moderator typed by hand is still the moderator, with no "Moderator" as their organisation', typedMod.moderators[0]?.name === 'Asha Rao' && typedMod.moderators[0]?.org === '' && typedMod.others[0]?.org === 'Tata Capital', typedMod);

const slot = B.slotOf(panel, 1, speakers, { venue_room: 'Peacock Hall', location: 'Ground Floor, Centre One' });
check('a slot carries their role, the venue room and the directions', slot.my_role === 'panellist' && slot.venue_room === 'Peacock Hall' && slot.location === 'Ground Floor, Centre One', slot);
check('a slot has no internal note in it', !('note' in slot));

// ---- fingerprint ----
const fp = B.briefFingerprint([slot]);
check('the fingerprint is stable', fp === B.briefFingerprint([{ ...slot }]) && /^[0-9a-f]{8}$/.test(fp), fp);
check('a new time changes it', fp !== B.briefFingerprint([{ ...slot, start_time: '2026-11-21 15:30' }]));
check('a new hall changes it', fp !== B.briefFingerprint([{ ...slot, room: 'Kalam Theatre' }]));
check('a new panellist changes it', fp !== B.briefFingerprint([{ ...slot, others: [...slot.others, { name: 'Asha Rao', org: '' }] }]));
check('a new role changes it', fp !== B.briefFingerprint([{ ...slot, my_role: 'moderator' }]));
check('a co-panellist’s organisation typed differently does not', fp === B.briefFingerprint([{ ...slot, others: slot.others.map(o => ({ ...o, org: o.org + ' Ltd' })) }]));
const two = [slot, { ...slot, id: 150, start_time: '2026-11-20 10:00', end_time: '2026-11-20 10:30' }];
check('the order sessions come in does not matter', B.briefFingerprint(two) === B.briefFingerprint([two[1], two[0]]));

// ---- status ----
const st = (x) => B.briefStatus({ slots: [slot], email: 'a@b.test', protocol: false, last: null, fp, ...x });
check('no session', st({ slots: [] }) === 'no-session');
check('a minister', st({ protocol: true }) === 'protocol');
check('no email', st({ email: '  ' }) === 'no-email');
check('never sent: ready', st({}) === 'ready');
check('sent, nothing moved: sent', st({ last: { fp } }) === 'sent');
check('sent, then the slot moved: changed', st({ last: { fp: 'deadbeef' } }) === 'changed');

// ---- calendar ----
check('IST wall clock to UTC (15:15 IST is 09:45 UTC)', B.utcStamp('2026-11-21 15:15') === '20261121T094500Z', B.utcStamp('2026-11-21 15:15'));
check('an early IST time crosses back a day (02:00 IST is 20:30 UTC the day before)', B.utcStamp('2026-11-21 02:00') === '20261120T203000Z');
check('a bad time gives nothing', B.utcStamp('soon') === '');
const g = new URL(B.googleCalendarUrl(slot, WORDS));
check('Google Calendar link: the time in UTC and the hall by both names', g.hostname === 'calendar.google.com' && g.searchParams.get('dates') === '20261121T094500Z/20261121T104500Z' && /Homi J\. Bhabha Hall \(Peacock Hall\)/.test(g.searchParams.get('location')), g.toString());
const ics = B.icsText(slot, WORDS, '2026-11-12T10:00:00.000Z');
check('the calendar file has CRLF line ends and one event', ics.includes('\r\nBEGIN:VEVENT\r\n') && (ics.match(/BEGIN:VEVENT/g) || []).length === 1);
check('the calendar file escapes commas and semicolons', /LOCATION:Homi J\. Bhabha Hall \(Peacock Hall\)\\, Ground Floor\\, Centre One\\, World Trade Center\\, Mumbai/.test(ics), ics);
check('the calendar file names the session and the time', ics.includes('DTSTART:20261121T094500Z') && ics.includes('SUMMARY:Content\\, Creativity & AI (Bharat AI Innovation 2026)'));

// ---- the email ----
const sp = { id: 1, name: 'Mr. Saurabh Kushwah', email: 'saurabh@example.test' };
const m = B.briefEmailHTML({ sp, slots: [slot], note: 'Please reach the hall 30 minutes early.\nSlides: 16:9.', header: '<div>HEAD</div>', words: WORDS, update: false, passHref: 'https://bharataiinnovation.com/app?email=x&action=download-pass&token=t1', passName: 'Speaker' });
check('subject: day, time and the hall by both names', m.subject === 'Your session at Bharat AI Innovation 2026: Saturday 21 November, 3:15 pm, Homi J. Bhabha Hall (Peacock Hall)', m.subject);
check('greets them by first name without the title', m.html.includes('Dear Saurabh,'));
check('says their role, time and the hall card with both names', m.html.includes('Panellist') && m.html.includes('Saturday 21 November, 3:15 pm to 4:15 pm') && m.html.includes('Homi J. Bhabha Hall · Peacock Hall'));
check('names the moderator and the other panellists with organisations', m.html.includes('Mukesh Jain (Capgemini)') && m.html.includes('Simon David Hunter (Asian Screen Institute, Singapore)') && m.html.includes('Rajat Nigam (JioStar India)'));
check('no co-panellist’s email is in it', !m.html.includes('simon@example.test') && !m.html.includes('mukesh@example.test'));
check('the pass button links to their pass', m.html.includes('Show my Speaker pass') && m.html.includes('action=download-pass&amp;token=t1'));
check('both calendar links are there', m.html.includes('calendar.google.com') && m.html.includes('https://bharataiinnovation.com/api/sessions/143/calendar.ics'));
check('the note is in it, line breaks kept', m.html.includes('Please reach the hall 30 minutes early.\nSlides: 16:9.') && m.html.includes('white-space:pre-wrap'));
check('the header goes at the top', m.html.indexOf('<div>HEAD</div>') < m.html.indexOf('Dear'));
const noPass = B.briefEmailHTML({ sp, slots: [slot], note: '', header: '', words: WORDS, update: false, passHref: '', passName: 'Speaker' });
check('no address to sign in with: no pass block', !noPass.html.includes('Show my'));
const upd = B.briefEmailHTML({ sp, slots: [slot], note: '', header: '', words: WORDS, update: true, passHref: '#preview', passName: 'VIP' });
check('an update says so in the subject and the opening line', upd.subject.startsWith('Updated: Your session') && upd.html.includes('have changed') && upd.html.includes('not the earlier email'));
check('a pass of their own is named as theirs (VIP)', upd.html.includes('Show my VIP pass'));
const evil = B.briefEmailHTML({ sp: { name: '<img src=x onerror=alert(1)>' }, slots: [{ ...slot, title: '<script>alert(1)</script>', others: [{ name: '"><b>x</b>', org: '' }] }], note: '<iframe>', header: '', words: WORDS, update: false, passHref: 'javascript:alert(1)"', passName: 'Speaker' });
check('names, titles and notes are escaped', !/<script>|<img src=x|<iframe>|"><b>/.test(evil.html), evil.html.slice(0, 300));
check('a quote in the pass link cannot break out of its attribute', !evil.html.includes('alert(1)"'));
const many = B.briefEmailHTML({ sp, slots: two, note: '', header: '', words: WORDS, update: false, passHref: '', passName: 'Speaker' });
check('two sessions: the subject counts them and both cards are there', many.subject === 'Your 2 sessions at Bharat AI Innovation 2026' && (many.html.match(/Add to your calendar/g) || []).length === 2);
const talk = B.briefEmailHTML({ sp, slots: [{ ...slot, session_type: 'keynote', my_role: 'keynote', moderators: [], others: [] }], note: '', header: '', words: WORDS, update: false, passHref: '', passName: 'Speaker' });
check('a keynote alone has no panel lines', !talk.html.includes('On the panel') && !talk.html.includes('Moderator') && talk.html.includes('Keynote speaker'));

// ---- the organiser's own words for one email (13 Nov 2026) ----
check('the usual greeting and opening', B.briefGreeting(sp) === 'Dear Saurabh,' && B.briefOpening([slot], WORDS, false).startsWith('Thank you for speaking at Bharat AI Innovation 2026.') && B.briefOpening(two, WORDS, true).includes('are your sessions'));
check('a subject is one line: line breaks and tabs cannot reach the mail header', B.cleanLine('Hello\r\nBcc: x@y.test\tthere', 200) === 'Hello Bcc: x@y.test there' && B.cleanLine('a'.repeat(300), 200).length === 200);
check('an opening keeps its line breaks, trims, and has no runs of blank lines', B.cleanBlock('  One\r\n\r\n\r\n\r\nTwo  ', 1500) === 'One\n\nTwo');
const own = B.briefEmailHTML({ sp, slots: [slot], note: '', header: '', words: WORDS, update: false, passHref: '#preview', passName: 'Speaker',
  subject: 'Your panel on 21 November', greeting: 'Dear Mr. Kushwah,', opening: 'Thank you for joining the Media panel.\nWe are delighted.' });
check('their subject replaces the usual one', own.subject === 'Your panel on 21 November', own.subject);
check('their greeting and opening replace the usual ones, line breaks kept', own.html.includes('Dear Mr. Kushwah,') && !own.html.includes('Dear Saurabh,') && own.html.includes('Thank you for joining the Media panel.\nWe are delighted.') && !own.html.includes('Here is everything for your day'));
check('edited words never drop the programme: session, hall, panel and pass are still there', own.html.includes('Homi J. Bhabha Hall · Peacock Hall') && own.html.includes('Rajat Nigam (JioStar India)') && own.html.includes('Show my Speaker pass'));
const blank = B.briefEmailHTML({ sp, slots: [slot], note: '', header: '', words: WORDS, update: false, passHref: '', passName: 'Speaker', subject: '   ', greeting: '', opening: '\n\n' });
check('an empty box means the usual words', blank.subject === m.subject && blank.html.includes('Dear Saurabh,') && blank.html.includes('Here is everything for your day'));
const evilOwn = B.briefEmailHTML({ sp, slots: [slot], note: '', header: '', words: WORDS, update: false, passHref: '', passName: 'Speaker', greeting: '<b onmouseover=x>Hi</b>', opening: '<script>alert(1)</script><a href="javascript:x">y</a>' });
check('their words are escaped like everything else', !/<script>|<b onmouseover|<a href="javascript/.test(evilOwn.html) && evilOwn.html.includes('&lt;script&gt;'));

// ---- WhatsApp text ----
const t = B.briefText(sp, [slot], 'Reach 30 minutes early.', WORDS);
check('the text has the session, time and hall by both names', t.includes('*Content, Creativity & AI*') && t.includes('When: Saturday 21 November, 3:15 pm to 4:15 pm') && t.includes('Where: Homi J. Bhabha Hall (Peacock Hall), Ground Floor, Centre One, World Trade Center, Mumbai'), t);
check('the text names the moderator and panel', t.includes('Moderator: Mukesh Jain (Capgemini)') && t.includes('On the panel: Simon David Hunter (Asian Screen Institute, Singapore), Rajat Nigam (JioStar India)'));
check('the text carries no link at all (the pass link signs in)', !/https?:\/\//.test(t) && !t.includes('token'));
check('the text carries the note', t.includes('Reach 30 minutes early.'));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
