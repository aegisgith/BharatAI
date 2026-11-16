// Unit: the website from the app's programme (16 Nov 2026), each rule alone, on a small
// made-up programme: the kind of each item, who is on a panel and who moderates, an
// exhibitor's talk found by company, a draft left out, the "everyone gathers in the main
// hall" rows, the schedule markup and its anchors, the Full Schedule run of short talks,
// the speaker grids (ministers first), the JSON-LD performers, the llms lines, and the
// marker filling. No files written, no server.
// Run:  node scripts/verify/unit-programme.mjs
import { programmeFromApp, peopleOf, labelFor, splitSpeakerLine, norm, hallKey, eventDays, makeDirectory, resolvePeople, renderConference, renderSpeakers, fillBlock, fillFaq, fillPerformers, hasBlock, isMinister } from '../lib/programme.mjs';

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 300))); if (!ok) fails++; };

// ---- names and lines ----
check('one name however it is written', norm('Shri. K.K. Singh') === norm('Shri K.K. Singh (IAS)') && norm('Hon’ble Smt. Aditi Tatkare') === norm('Aditi Tatkare') && norm('Mr. Bhupesh Daheria') === 'bhupesh daheria');
check('the typed line splits on commas outside brackets, and reads the part', JSON.stringify(splitSpeakerLine('A (Org, with comma), B (Moderator), C')) === JSON.stringify([{ name: 'A', info: 'Org, with comma', role: '' }, { name: 'B', info: 'Moderator', role: 'moderator' }, { name: 'C', info: '', role: '' }]));
check('(IAS) stays part of the name', splitSpeakerLine('Shri Virendra Singh (IAS)')[0].name === 'Shri Virendra Singh (IAS)');
check('hall keys name the venue rooms, kept for the #sch- anchors; a new hall gets a key from its name', hallKey('Aryabhata Theatre') === 'kalam' && hallKey('Kalam Theatre') === 'aryabhata' && hallKey('Homi J. Bhabha Hall') === 'bhabha' && hallKey('Tata Auditorium') === 'tata-auditorium');
check('the days of the event', eventDays({ start_date: '2026-11-20', end_date: '2026-11-21' }).join() === '2026-11-20,2026-11-21');
check('the kind of a break is read from its title', labelFor({ title: 'Networking Lunch' }, 'break', '') === 'Lunch' && labelFor({ title: 'Hi-Tea Break' }, 'break', '') === 'Tea' && labelFor({ title: 'Registration' }, 'break', '') === 'Registration');
check('a panel keeps its subject from the description; a talk its kind', labelFor({ title: 'X' }, 'panel', 'Panel: BFSI. More to come.') === 'Panel: BFSI' && labelFor({ title: 'X' }, 'talk', 'Leadership Talk') === 'Leadership Talk' && labelFor({ title: 'Product Demonstration and Talk' }, 'talk', 'By Pramaan.') === 'Product Demonstration');
check('a keynote is Welcome, Inauguration, Closing or Keynote by its title', labelFor({ title: 'Welcome Note' }, 'keynote', '') === 'Welcome' && labelFor({ title: 'Closing Note' }, 'keynote', '') === 'Closing' && labelFor({ title: 'Keynote' }, 'keynote', '') === 'Keynote');

// ---- a small programme, as the app answers it ----
const speakers = [
  { id: 1, slug: 'k-k-singh', name: 'Shri. K.K. Singh', role: 'Joint Secretary, MeitY', organisation: 'Ministry of Electronics & IT, Govt of India', photo_url: '/images/speaker-kk-singh-v2.jpg', topic: 'National AI Policy', sort_order: 2, is_published: 1 },
  { id: 2, slug: 'tarun-chugh', name: 'Tarun Chugh', role: 'MD & CEO', organisation: 'Bajaj Life Insurance', photo_url: '', topic: 'AI in Insurance', sort_order: 3, is_published: 1 },
  { id: 3, slug: 'shailesh-dhuri', name: 'Shailesh Dhuri', role: 'CEO', organisation: 'Decimal Point Analytics', photo_url: '/api/uploads/speakers/3-1.jpg', topic: '', sort_order: 4, is_published: 1 },
  { id: 4, slug: 'aditi-tatkare', name: 'Hon’ble Smt. Aditi Tatkare', role: 'Minister, Women & Child Development', organisation: 'Government of Maharashtra', photo_url: '/images/aditi-tatkare.jpg', topic: 'Keynote Address', sort_order: 9, is_published: 1 },
];
const programme = {
  generated_at: '2026-11-16T12:00:00Z', live: true,
  event: { id: 1, title: 'Bharat AI Innovation 2026', start_date: '2026-11-20', end_date: '2026-11-21', venue: 'WTC Mumbai' },
  halls: [{ name: 'Homi J. Bhabha Hall', sort_order: 1 }, { name: 'Kalam Theatre', sort_order: 2, purpose: 'Panels' }, { name: 'Aryabhata Theatre', sort_order: 4, purpose: 'Innovation Talks' }],
  sessions: [
    { id: 10, title: 'Registration', description: 'Show your pass.', session_type: 'break', room: 'Homi J. Bhabha Hall', start_time: '2026-11-20 08:30', end_time: '2026-11-20 09:30', speaker_name: '', links: [] },
    { id: 11, title: 'Keynote', description: '', session_type: 'keynote', room: 'Homi J. Bhabha Hall', start_time: '2026-11-20 10:30', end_time: '2026-11-20 10:40', speaker_name: 'Hon’ble Smt. Aditi Tatkare', speaker_title: 'Minister', links: [] },
    { id: 12, title: 'Keynote', description: '', session_type: 'keynote', room: 'Homi J. Bhabha Hall', start_time: '2026-11-20 10:50', end_time: '2026-11-20 11:00', speaker_name: 'Shri K.K. Singh', speaker_title: 'Joint Secretary, MeitY, Government of India', links: [] },
    { id: 13, title: 'AI Democratizing and Driving Financial Inclusion', description: 'Panel: BFSI. More panellists to be announced.', session_type: 'panel', track: 'BFSI & FinTech AI', room: 'Homi J. Bhabha Hall', start_time: '2026-11-20 14:00', end_time: '2026-11-20 15:00', speaker_name: 'Tarun Chugh (Bajaj Life Insurance), Mayur Kapur (TransUnion), Shailesh Dhuri (Moderator)', links: [{ speaker_id: 2, role: 'panellist' }, { speaker_id: 3, role: 'moderator' }] },
    { id: 14, title: 'Innovation Talk: RedFerns Tech', description: 'Speaker to be announced.', session_type: 'talk', room: 'Aryabhata Theatre', start_time: '2026-11-20 11:40', end_time: '2026-11-20 11:48', speaker_name: '', links: [] },
    { id: 15, title: 'Innovation Talk: Oranje AI', description: '', session_type: 'talk', room: 'Aryabhata Theatre', start_time: '2026-11-20 12:00', end_time: '2026-11-20 12:08', speaker_name: 'Shivendra Singh', speaker_title: 'CEO, Oranje AI', links: [] },
    { id: 16, title: 'Held slot', description: '', session_type: 'talk', room: 'Kalam Theatre', start_time: '2026-11-20 16:00', end_time: '2026-11-20 16:10', speaker_name: '', links: [], status: 'draft' },
    { id: 17, title: 'Workshop with Dr. A', description: 'Topic to be announced.', session_type: 'workshop', track: 'Training Workshop', room: 'Kalam Theatre', start_time: '2026-11-21 14:00', end_time: '2026-11-21 15:30', speaker_name: 'Dr. A', speaker_title: 'Lead AI, Google', links: [] },
    { id: 18, title: 'Welcome Note', description: '', session_type: 'keynote', room: 'Homi J. Bhabha Hall', start_time: '2026-11-21 09:00', end_time: '2026-11-21 09:05', speaker_name: 'Dr. Dean', speaker_title: 'Dean, Aegis', links: [] },
  ],
  speakers,
  talks: [{ id: 2, company: 'RedFerns Tech', speaker_name: 'Shashank KP', speaker_title: 'Chief Technology Officer', topic: 'From Intelligence to Innovation', starts_at: '2026-11-20 11:40', duration_min: 8, hall: 'Aryabhata Theatre', photo_url: '/images/talks/shashank-kp.webp', status: 'confirmed' }],
};
const byNorm = new Map(speakers.map((s) => [norm(s.name), s]));
const ppl = peopleOf(programme.sessions[3], byNorm);
check('the people of a panel, in the order of the line: listed ones with their details, a typed one as typed, the moderator marked', ppl.length === 3 && ppl[0].speaker_id === 2 && ppl[0].role === 'MD & CEO' && ppl[1].speaker_id === null && ppl[1].info === 'TransUnion' && ppl[2].part === 'moderator', ppl);
check('a name typed differently still finds the listed speaker', peopleOf(programme.sessions[2], byNorm)[0].speaker_id === 1);

const S = programmeFromApp(programme);
check('the halls, in the app’s order, with their keys', S.halls.map((h) => h.key).join() === 'bhabha,aryabhata,kalam' && S.halls[2].about === 'Innovation Talks by exhibitors');
check('a draft is not on the website', !S.sessions.some((s) => s.title === 'Held slot'));
const by = (id) => S.sessions.find((s) => s.id === id);
check('a break: day, hall, times, kind and note', by(10).day === 1 && by(10).hall === 'bhabha' && by(10).start === '08:30' && by(10).type === 'break' && by(10).label === 'Registration' && by(10).note === 'Show your pass.' && by(10).title === 'Registration');
check('a keynote titled "Keynote" has no title of its own: the speaker is the heading, with the app’s designation and organisation', !by(11).title && by(11).speaker.name === 'Hon’ble Smt. Aditi Tatkare' && by(11).speaker.role === 'Minister, Women & Child Development' && by(11).speaker.org === 'Government of Maharashtra' && by(11).speaker.listed === true, by(11));
check('a panel: its subject, its note, its panellists and its moderator', by(13).label === 'Panel: BFSI' && by(13).note === 'More panellists to be announced.' && by(13).panel.map((p) => p.name).join() === 'Tarun Chugh,Mayur Kapur' && by(13).panel[1].org === 'TransUnion' && by(13).moderator.name === 'Shailesh Dhuri' && by(13).track === 'BFSI & FinTech AI', by(13));
check('an Expo Hall row names the company and finds the app’s talk: speaker, title, topic, photo', by(14).company === 'RedFerns Tech' && by(14).talk && by(14).talk.name === 'Shashank KP' && by(14).talk.topic === 'From Intelligence to Innovation' && !by(14).note, by(14));
check('an Expo Hall row with no talk on the list keeps the speaker typed on it', by(15).company === 'Oranje AI' && !by(15).talk && by(15).speaker.name === 'Shivendra Singh' && by(15).speaker.role === 'CEO, Oranje AI', by(15));
check('a workshop', by(17).type === 'workshop' && by(17).day === 2 && by(17).title === 'Workshop with Dr. A' && by(17).note === 'Topic to be announced.' && by(17).speaker.role === 'Lead AI, Google');
const elsewhere = S.sessions.filter((s) => s.type === 'elsewhere');
check('the other halls say everyone gathers in the main hall during the opening keynotes, both days', elsewhere.length === 4 && elsewhere.every((s) => s.note === 'Everyone gathers in Homi J. Bhabha Hall.') && elsewhere.some((s) => s.hall === 'kalam' && s.day === 1 && s.start === '10:30' && s.end === '11:00') && elsewhere.some((s) => s.day === 2 && s.label === 'Welcome'), elsewhere);

// ---- rendering ----
const directory = makeDirectory([{ name: 'Shri K.K. Singh', role: 'Joint Secretary', org: 'Ministry of Electronics & IT (MeitY), Government of India', photo: 'images/speaker-kk-singh-v2.jpg', logo: 'images/logo-meity.webp' }, { name: 'Mayur Kapur', role: 'Asia Chief Strategy Officer', org: 'TransUnion' }]);
resolvePeople(S, { directory, talkFiles: (t) => ({ photo: 'images/talks/shashank-kp.webp', logo: 'images/exhibitors/redferns-tech.webp' }), onDisk: () => true });
const kk = by(12).people[0], mk = by(13).people[1], sd = by(13).people[2];
check('a listed speaker shows the app’s words, with the directory’s logo', kk.role === 'Joint Secretary, MeitY' && kk.org === 'Ministry of Electronics & IT, Govt of India' && kk.logo === 'images/logo-meity.webp' && kk.photo === 'images/speaker-kk-singh-v2.jpg', kk);
check('someone typed on a panel shows the directory’s designation and organisation', mk.role === 'Asia Chief Strategy Officer' && mk.org === 'TransUnion' && !mk.photo, mk);
check('an uploaded photo (chosen in Admin) is used as it is, and the moderator is tagged', sd.photo === '/api/uploads/speakers/3-1.jpg' && sd.tag === 'Moderator', sd);
const pictures = (p) => ({ thumb: p.photo ? { src: p.photo.startsWith('/') ? p.photo : 'images/sched/' + p.slug + '.webp?v=12345678', w: 144, h: 144 } : null, mark: p.logo ? { src: 'images/sched/logo-meity.webp?v=1', w: 184, h: 60, lw: 92, lh: 30 } : null });
const r = renderConference(S, { tracks: [{ key: '@keynotes', name: 'Keynotes' }, { key: 'BFSI & FinTech AI', name: 'BFSI & FinTech AI', about: 'Money.' }], pictures });
check('a tab per hall and the Full Schedule', (r.schedule.match(/class="hall-tab[" ]/g) || []).length === 4 && r.schedule.includes('>Homi J. Bhabha Hall<') && r.schedule.includes('>Aryabhata Theatre<'));
check('each session has its anchor: #sch-<hall key>-<day>-<hhmm>', r.schedule.includes('id="sch-bhabha-1-1400"') && r.schedule.includes('id="sch-kalam-1-1140"') && r.schedule.includes('id="sch-bhabha-2-0900"'));
check('the panel shows its people as cards, the moderator last and marked, the typed one with initials', /Tarun Chugh[\s\S]*sch-initials" aria-hidden="true">MK<[\s\S]*Shailesh Dhuri <span class="sch-tag">Moderator<\/span>/.test(r.schedule));
check('a keynote with no title: the speaker is the heading', /class="schedule-item has-lead"[\s\S]*?<h4>Hon’ble Smt\. Aditi Tatkare<\/h4>/.test(r.schedule));
check('the exhibitor’s talk: the company in the heading, the topic in quotes, the speaker’s title and company', /<h4>Innovation Talk: RedFerns Tech<\/h4><p>&ldquo;From Intelligence to Innovation&rdquo;\.<\/p><ul class="sch-people"><li class="sch-person">[\s\S]*?Shashank KP[\s\S]*?sch-role">Chief Technology Officer<\/div><div class="sch-org">RedFerns Tech</.test(r.schedule), r.schedule.slice(r.schedule.indexOf('RedFerns'), r.schedule.indexOf('RedFerns') + 500));
check('the Full Schedule merges the two short Expo Hall talks into one block', /<h4>Innovation Talks<\/h4><p><span class="hall-label hl-kalam">Aryabhata Theatre<\/span>RedFerns Tech, Oranje AI\.<\/p>/.test(r.schedule));
check('the draft is nowhere, the uploaded photo is drawn as it is', !r.schedule.includes('Held slot') && r.schedule.includes('src="/api/uploads/speakers/3-1.jpg"'));
check('Tracks: keynotes first, then the BFSI track with its words and its session', /ctr-name">Keynotes<\/h3>[\s\S]*ctr-name">BFSI &amp; FinTech AI<\/h3>[\s\S]*Money\.[\s\S]*href="#sch-bhabha-1-1400"/.test(r.tracks) && r.tracks.includes('<span class="accent">3</span> Specialised Tracks') && /ctr-name">Innovation Talks<\/h3>[\s\S]*ctr-name">Training Workshop<\/h3>/.test(r.tracks));
check('the FAQ sentence counts the tracks and the halls', r.faq === 'There are 3 tracks across three halls over two days: BFSI & FinTech AI, Innovation Talks and Training Workshop. The conference opens with keynotes in Homi J. Bhabha Hall.', r.faq);
check('nothing unfinished is printed', !/undefined|NaN|\[object|null</.test(r.schedule + r.tracks));

const g = renderSpeakers(speakers, { photoOf: (sp) => (sp.photo_url ? { src: sp.photo_url.replace(/^\//, ''), w: 400, h: 400 } : null), logoOf: (sp) => (sp.id === 1 ? { src: 'images/logo-meity.webp', w: 292, h: 96 } : null) });
check('a minister is anyone whose role says Minister or whose name opens Hon’ble', isMinister(speakers[3]) && !isMinister(speakers[0]) && isMinister({ name: 'Hon’ble Shri X', role: '' }));
check('/conference: the ministers’ grid first, then the speakers in the app’s order, each with photo, designation, organisation, logo and topic', /ministers-grid[\s\S]*Aditi Tatkare[\s\S]*<h3[^>]*>Speakers<\/h3>[\s\S]*Shri\. K\.K\. Singh[\s\S]*Tarun Chugh[\s\S]*Shailesh Dhuri/.test(g.conference) && g.conference.includes('<img class="speaker-logo" width="292" height="96" loading="lazy" decoding="async" src="images/logo-meity.webp" alt="">') && g.conference.includes('<span class="speaker-topic topic-policy">National AI Policy</span>'), g.conference.slice(0, 600));
check('a speaker with no photo shows initials; an uploaded one its address', g.conference.includes('speaker-initials" aria-hidden="true">TC<') && g.home.includes('src="api/uploads/speakers/3-1.jpg"'));
check('the home grid leaves the ministers out and names each card in a comment', !g.home.includes('Aditi Tatkare') && g.home.includes('<!-- Shri. K.K. Singh -->') && (g.home.match(/class="speaker-card reveal/g) || []).length === 3);
check('the performers: every shown speaker, a government body typed as one, the photo as a full address', g.performers.length === 4 && g.performers[0].name === 'Shri. K.K. Singh' && g.performers[0].worksFor['@type'] === 'GovernmentOrganization' && g.performers[0].image === 'https://bharataiinnovation.com/images/speaker-kk-singh-v2.jpg' && g.performers[3].worksFor['@type'] === 'GovernmentOrganization', g.performers);
check('llms.txt: one line a person', g.llms.split('\n').length === 4 && g.llms.includes('- **Tarun Chugh** — MD & CEO, Bajaj Life Insurance (AI in Insurance)'), g.llms);

// ---- filling a page ----
const page = '<html>\n    <!-- schedule:start (x) -->\n    <p>old</p>\n    <!-- schedule:end -->\n  "name": "How many conference tracks are there?", "acceptedAnswer": { "@type": "Answer", "text": "old" }\n      "performer": [\n        { "@type": "Person", "name": "Old" }\n      ],\n</html>';
let out = fillBlock(page, 'schedule', '<p>new</p>\n<p>two</p>');
check('fillBlock keeps the markers and the indentation', out.includes('    <!-- schedule:start (x) -->\n    <p>new</p>\n    <p>two</p>\n    <!-- schedule:end -->') && !out.includes('<p>old</p>') && hasBlock(out, 'schedule') && !hasBlock(out, 'speakers'));
out = fillFaq(out, 'There are 2 tracks, "quoted".');
check('fillFaq writes the sentence without double quotes', out.includes('"text": "There are 2 tracks, \'quoted\'." }'));
out = fillPerformers(out, g.performers.slice(0, 1));
check('fillPerformers replaces the list', out.includes('"performer": [\n        { "@type": "Person", "name": "Shri. K.K. Singh", "jobTitle": "Joint Secretary, MeitY", "worksFor": { "@type": "GovernmentOrganization", "name": "Ministry of Electronics & IT, Govt of India" }, "image": "https://bharataiinnovation.com/images/speaker-kk-singh-v2.jpg" }\n      ],') && !out.includes('"Old"'), out.slice(out.indexOf('"performer"'), out.indexOf('"performer"') + 300));
let threw = false; try { fillBlock('<p>no markers</p>', 'schedule', 'x'); } catch { threw = true; }
check('missing markers throw rather than write nothing', threw);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
