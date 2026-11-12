// Unit and integration: the people on the /conference schedule (12 Nov 2026). Each
// keynote, talk, workshop and panel shows its people as a small photo, the name, the
// designation and the department or organisation with its logo; the organisation in
// words alone when there is no logo; initials when there is no photo.
//
// Unit: the rules of scripts/data/schedule-people.json and of the markup the generator
// writes, read from the shipped files. Integration: scripts/gen-schedule.mjs --check,
// which rebuilds the page, the app's SQL and every small picture in memory and says
// whether the files on disk are still what the JSON gives. No browser, no server.
// Run:  node scripts/verify/unit-schedule-people.mjs
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };

// ---- the list of people ----
const raw = read('scripts/data/schedule-people.json');
const people = JSON.parse(raw).people;
const norm = (n) => String(n).toLowerCase().replace(/\((ias|ifs|ips|retd\.?)\)/g, ' ').replace(/hon[’']ble/g, ' ').replace(/\b(shri|smt|mr|mrs|ms|dr|prof|cmde)\b\.?/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
check('the list holds people', people.length >= 60, String(people.length));
check('everyone has a name, and a designation or an organisation', people.every((p) => p.name && typeof p.role === 'string' && typeof p.org === 'string' && (p.role || p.org)), JSON.stringify(people.find((p) => !(p.name && (p.role || p.org)))));
check('nobody is listed twice, however the name is written', new Set(people.map((p) => norm(p.name))).size === people.length);
check('no email address and no phone number is in the list', !/@/.test(raw) && !/\d[\d\s-]{8,}\d/.test(raw));
const lost = people.flatMap((p) => [p.photo, p.logo]).filter((f) => f && !existsSync(join(ROOT, 'public', f)));
check('every photo and logo the list names is in public/', lost.length === 0, lost.join(', '));
check('a crop is three fractions of the picture', people.filter((p) => p.crop).every((p) => ['left', 'top', 'size'].every((k) => p.crop[k] >= 0 && p.crop[k] <= 1)));

// ---- the page the generator wrote ----
const page = read('public/conference.html');
const a = page.indexOf('<!-- schedule:start'), b = page.indexOf('<!-- schedule:end -->');
const block = page.slice(a, b);
check('the schedule sits between its two markers', a > 0 && b > a);
const cards = block.split(/<(?:li|div) class="sch-person(?: sch-lead)?">/).slice(1).map((c) => c.split(/<\/li>|(?<=<\/div><\/div>)<\/div>/)[0]);
check('people are shown in the schedule', cards.length >= 150, String(cards.length));
check('every person shown has a name', cards.every((c) => /<(h4|div class="sch-name")>[^<]{3,}/.test(c)));
check('every person shown has a photo or initials', cards.every((c) => /class="sch-photo"[^>]*src="images\/sched\//.test(c) || /class="sch-photo sch-initials" aria-hidden="true">[A-Z]{1,2}</.test(c)));
check('nothing unfinished is printed', !/undefined|NaN|\[object|null</.test(block));
const srcs = [...block.matchAll(/src="(images\/sched\/[^"?]+)\?v=([0-9a-f]{8})"/g)].map((m) => m[1]);
const gone = [...new Set(srcs)].filter((f) => !existsSync(join(ROOT, 'public', f)));
check('every small picture the page asks for is in public/images/sched', srcs.length > 100 && gone.length === 0, gone.join(', '));
check('every picture carries a version, so a new photo is not held back by a cached one', (block.match(/src="images\/sched\//g) || []).length === srcs.length);
check('pictures say nothing twice to a screen reader, wait until wanted and keep their place', [...block.matchAll(/<img class="sch-(photo|logo)"[^>]*>/g)].every((m) => / alt=""/.test(m[0]) && /loading="lazy"/.test(m[0]) && / width="\d+" height="\d+"/.test(m[0])));
check('every logo carries its size on the page', [...block.matchAll(/<img class="sch-logo"[^>]*>/g)].every((m) => /style="--lw:\d+;--lh:\d+"/.test(m[0])));
const dims = [...block.matchAll(/--lw:(\d+);--lh:(\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
check('no logo is drawn taller than 40px or wider than 92px', dims.length > 40 && dims.every(([w, h]) => h <= 40 && h >= 12 && w <= 92), JSON.stringify(dims.find(([w, h]) => h > 40 || w > 92 || h < 12)));
const files = readdirSync(join(ROOT, 'public/images/sched'));
const heavy = files.filter((f) => statSync(join(ROOT, 'public/images/sched', f)).size > 12000);
check('each small picture is small (under 12 KB), so a phone can open a panel of ten', files.length > 80 && heavy.length === 0, heavy.join(', '));

// One panel, read closely: the first hall's Governance panel.
const hall0 = block.slice(block.indexOf('id="hall-0"'), block.indexOf('id="hall-1"'));
const item = (src, title) => { const i = src.indexOf(title); return i < 0 ? '' : src.slice(src.lastIndexOf('<div', src.lastIndexOf('class="schedule-item', i)), src.indexOf('<span class="schedule-badge', i)); };
const gov = item(hall0, 'AI for Viksit Bharat');
const govCards = gov.split('<li class="sch-person">').slice(1);
check('the Governance panel lists its ten panellists and the moderator', govCards.length === 11, String(govCards.length));
check('the moderator is marked, once, and comes last', (gov.match(/class="sch-tag">Moderator</g) || []).length === 1 && /sch-tag">Moderator/.test(govCards[10] || ''));
const card = (name) => cards.find((c) => c.includes('>' + name + '<') || c.includes('>' + name + ' <')) || '';
const kk = card('Shri K.K. Singh');
check('a government speaker: photo, designation, department, and the Ministry logo', /images\/sched\/k-k-singh\.webp/.test(kk) && /sch-role">Joint Secretary</.test(kk) && /sch-org">Ministry of Electronics &amp; IT \(MeitY\), Government of India</.test(kk) && /images\/sched\/logo-meity\.webp/.test(kk), kk.slice(0, 300));
const ay = card('Shri Akshay Yadava');
check('no logo on file: the organisation is named in words, and no logo is drawn', /sch-org">Unique Identification Authority of India \(UIDAI\)</.test(ay) && !/sch-logo/.test(ay), ay.slice(0, 300));
const sa = card('Sarosh Amaria');
check('no photo on file: initials, with the designation and organisation', /sch-initials" aria-hidden="true">SA</.test(sa) && /sch-role">MD</.test(sa) && /sch-org">Tata Capital</.test(sa), sa.slice(0, 300));
const kkAll = [...hall0.matchAll(/images\/sched\/k-k-singh\.webp\?v=([0-9a-f]{8})/g)].map((m) => m[1]);
check('the same person is the same picture in a keynote and in a panel', kkAll.length === 2 && kkAll[0] === kkAll[1], kkAll.join(','));
const minister = item(hall0, 'Chandrakant Dada Patil');
check('a keynote with no title: the speaker is the heading, with designation, government and its seal', /has-lead/.test(minister) && /<h4>Hon’ble Shri Chandrakant Dada Patil<\/h4>/.test(minister) && /sch-role">Minister of Higher and Technical Education</.test(minister) && /sch-org">Government of Maharashtra</.test(minister) && /logo-maharashtra\.webp/.test(minister), minister.slice(0, 300));
const expo = block.slice(block.indexOf('id="hall-1"'), block.indexOf('id="hall-2"'));
const talk = item(expo, 'Innovation Talk: RedFerns Tech');
check("an exhibitor's talk: the speaker's photo, title, company and the company's logo from the talks list", /images\/sched\/shashank-kp\.webp/.test(talk) && /sch-role">Chief Technology Officer</.test(talk) && /sch-org">RedFerns Tech</.test(talk) && /logo-redferns-tech\.webp/.test(talk), talk.slice(0, 300));
check('a break has no people and keeps its plain line', /<h4>Networking Lunch<\/h4><p>The exhibition floor stays open\.<\/p>/.test(hall0));
const full = block.slice(block.indexOf('id="hall-4"'));
check('the Full Schedule shows the same people, each row with its hall', /hall-label hl-bhabha">Homi J\. Bhabha Hall<\/span>Panel: Governance\./.test(full) && item(full, 'AI for Viksit Bharat').split('<li class="sch-person">').length === 12);
check('the page carries the styles for people, and the phone rules', ['.sch-people {', '.sch-photo {', '.sch-logo {', '.sch-lead {', '--sch-logo: 0.85'].every((s) => page.includes(s)));

// ---- Tracks: every real session by track (12 Nov 2026) ----
const S = JSON.parse(read('scripts/data/schedule.json'));
const T = JSON.parse(read('scripts/data/tracks.json')).tracks;
const ta = page.indexOf('<!-- tracks:start'), tb = page.indexOf('<!-- tracks:end -->');
const tracks = page.slice(ta, tb);
check('the Tracks section sits between its two markers, above the schedule', ta > 0 && tb > ta && tb < a);
const used = new Set(S.sessions.map((s) => s.track).filter(Boolean));
check('every track in the agenda has its words in tracks.json', [...used].every((k) => T.some((t) => t.key === k)), [...used].filter((k) => !T.some((t) => t.key === k)).join(', '));
const rows = tracks.split('<div class="conf-track-row trk">').slice(1);
const subject = T.filter((t) => t.key !== '@keynotes' && (used.has(t.key) || (t.key === 'Innovation Talks')));
check('one row per track plus the keynotes, in the order of tracks.json', rows.length === subject.length + 1 && rows.every((r, i) => r.includes(`<h3 class="ctr-name">${[T[0], ...subject][i].name.replace(/&/g, '&amp;')}</h3>`)), String(rows.length));
check('the heading counts the real tracks', tracks.includes(`<span class="accent">${subject.length}</span> Specialised Tracks`) && !tracks.includes('10+'));
const ids = new Set([...page.matchAll(/<div id="(sch-[^"]+)" class="schedule-item/g)].map((m) => m[1]));
const hrefs = [...tracks.matchAll(/href="#(sch-[^"]+)"/g)].map((m) => m[1]);
check('every session in Tracks opens a session that is in the schedule', hrefs.length >= 40 && hrefs.every((h) => ids.has(h)), hrefs.filter((h) => !ids.has(h)).join(', '));
check('every session of the agenda has its own place in the schedule (ids unique)', ids.size === S.sessions.length, `${ids.size} of ${S.sessions.length}`);
const listed = new Set(hrefs);
const missed = S.sessions.filter((s) => s.track && !listed.has(`sch-${s.hall}-${s.day}-${s.start ? s.start.replace(':', '') : 'tba'}`) && !s.company);
check('every session with a track is listed under it', missed.length === 0, missed.map((s) => s.title).join(', '));
check('the made-up tracks are gone (Manufacturing, Mobility, Ethics, Retail, five halls)', !/Manufacturing &amp; Industry 4\.0|Mobility &amp; Smart Transport|AI Ethics &amp; Responsible AI|parallel halls|AI for Retail|5 parallel/i.test(page));
const faqText = (page.match(/"How many conference tracks[^"]*",\s*"acceptedAnswer": \{ "@type": "Answer", "text": "([^"]*)"/) || [])[1] || '';
check('what search engines are told matches: the count, four halls and every track by name', faqText.startsWith(`There are ${subject.length} tracks across four halls`) && subject.every((t) => faqText.includes(t.name)), faqText);
check('the words about tracks use no dashes as punctuation', !/ [–—-] |—/.test(JSON.stringify(T.map((t) => [t.about, t.for]))));
check('the page has the script that opens a session from Tracks', /function showSession\(id\)/.test(page) && /a\[href\^="#sch-"\]/.test(page) && /location\.hash\.indexOf\('#sch-'\)/.test(page));

// ---- the app is untouched: its SQL still has the names in the form the app reads ----
const sql = read('scripts/sql/schedule.sql');
check("the app's SQL keeps its own form (Name (Organisation), ..., Name (Moderator)) and none of the page's markup", sql.includes("'Shri Prakash Kumar (IndiaAI Mission), Shri Akshay Yadava (UIDAI)") && sql.includes('Mr. Bhupesh Daheria (Moderator)') && !/sch-|<img|images\/sched/.test(sql));

// ---- integration: the JSON, the page, the SQL and the pictures agree ----
const run = spawnSync(process.execPath, ['scripts/gen-schedule.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
check('the generator, run again, would change nothing (page, SQL, every picture)', run.status === 0 && /In step/.test(run.stdout), (run.stdout + run.stderr).split('\n').filter((l) => /Out of step|Error/.test(l)).join(' ').slice(0, 400));
check('the check wrote nothing', read('public/conference.html') === page && read('scripts/sql/schedule.sql') === sql);
const unknown = (run.stdout.match(/^Not in schedule-people\.json.*$/m) || [''])[0];
check('everyone named in the agenda is in the list (designation and organisation known)', !unknown, unknown.slice(0, 300));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
