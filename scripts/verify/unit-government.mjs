// Unit: the /government page's rules, each on its own, no browser and no server (5 Nov
// 2026). The nomination form's own script runs in node:vm (government-world.mjs); the
// page's words, the people it names and the menu are read from the shipped files.
// Run:  node scripts/verify/unit-government.mjs
import { existsSync, readdirSync, statSync } from 'node:fs';
import { GOOD, openPage, read } from './government-world.mjs';

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };

// ---- what the form refuses, with the words the person sees, under the box ----
const refusals = [
  ['no Ministry', { org: '  ' }, 'Ministry', 'gv-org'],
  ['no initiative', { initiative: '' }, 'name of the initiative', 'gv-initiative'],
  ['no description', { about: '   ' }, 'describe', 'gv-about'],
  ['no officer', { name: '' }, 'officer’s name', 'gv-name'],
  ['no designation', { designation: '' }, 'designation', 'gv-designation'],
  ['no email', { email: '' }, 'email address', 'gv-email'],
  ['email without a domain', { email: 'asha@' }, 'email address', 'gv-email'],
  ['email with a space', { email: 'as ha@example.gov.in' }, 'email address', 'gv-email'],
  ['no contact number', { phone: '' }, 'contact number', 'gv-phone'],
  ['a short contact number', { phone: '12345' }, 'at least 10 digits', 'gv-phone'],
];
for (const [what, change, words, box] of refusals) {
  const p = openPage();
  const r = await p.submit({ ...GOOD, ...change });
  check(`refused, ${what}: says so, marks the box, sends nothing`, r.error.includes(words) && !r.done && p.sent.length === 0 && p.focused.id === box && p.els[box].attrs['aria-invalid'] === 'true', JSON.stringify(r));
  check(`refused, ${what}: the message stands under that box`, p.moved()?.under === box, JSON.stringify(p.moved()));
}
{
  const p = openPage();
  await p.submit({ ...GOOD, name: '' });
  const r = await p.submit(GOOD);
  check('fixing the box clears the mark and sends', r.done && !('aria-invalid' in p.els['gv-name'].attrs) && p.sent.length === 1, JSON.stringify(r));
}

// ---- what it sends ----
{
  const p = openPage();
  const r = await p.submit({ ...GOOD, email: ' asha.rao@example.gov.in ', org: ' Ministry of Tribal Affairs ' }, ['Live Demonstration', 'Exhibition Pavilion']);
  const b = r.body;
  check('filed as a government enquiry', r.done && b.inquiry_type === 'government', JSON.stringify(b));
  check('the subject names the initiative', b.subject === 'Govt AI · Adi Vaani', b.subject);
  check('the officer is the person, the Ministry the organisation, spaces trimmed', b.name === 'Asha Rao' && b.email === 'asha.rao@example.gov.in' && b.organization === 'Ministry of Tribal Affairs' && b.phone === GOOD.phone, JSON.stringify(b));
  for (const [what, words] of [['the initiative', 'Initiative: Adi Vaani'], ['the description', 'Translates tribal languages'], ['the officer and designation', 'Asha Rao, Deputy Secretary'], ['every format chosen', 'Live Demonstration, Exhibition Pavilion']]) {
    check(`the message carries ${what}`, b.message.includes(words), b.message);
  }
  check('Admin can read the details beside it', b.metadata.initiative === 'Adi Vaani' && b.metadata.designation === 'Deputy Secretary' && b.metadata.formats === 'Live Demonstration, Exhibition Pavilion' && b.metadata.page === '/government', JSON.stringify(b.metadata));
  check('the thank-you names the officer and the email', p.els['gv-done-text'].textContent.includes('Asha Rao') && p.els['gv-done-text'].textContent.includes('asha.rao@example.gov.in') && p.els['gv-form'].hidden === true, p.els['gv-done-text'].textContent);
}
{
  const r = await openPage().submit(GOOD);
  check('no format chosen is fine, and says so', r.done && r.body.metadata.formats === 'Not chosen' && r.body.message.includes('Preferred format: Not chosen'), JSON.stringify(r.body));
}
{
  const p = openPage();
  const r = await p.submit({ ...GOOD, website: 'http://spam.example' });
  check('a bot filling the hidden box sees success and nothing is sent', r.done && p.sent.length === 0, JSON.stringify(r));
}
{
  const p = openPage({ search: '?utm_source=mail&utm_medium=email&utm_campaign=ministries&source=letter&junk=1' });
  const m = (await p.submit(GOOD)).body.metadata;
  check('where the visitor came from travels with it, and nothing else', m.utm_source === 'mail' && m.utm_medium === 'email' && m.utm_campaign === 'ministries' && m.source === 'letter' && !('junk' in m), JSON.stringify(m));
}

// ---- it never fails silently ----
{
  const p = openPage({ fetch: async () => ({ ok: false, json: async () => ({ error: 'Invalid inquiry type' }) }) });
  const r = await p.submit(GOOD);
  check('a server refusal is shown in its words, the form stays, the button comes back', r.error === 'Invalid inquiry type' && !r.done && p.els['gv-submit'].disabled === false && p.els['gv-submit'].innerHTML.includes('Send the nomination') && p.moved()?.under === 'the button', JSON.stringify(r));
}
{
  const p = openPage({ fetch: async () => { throw new TypeError('Failed to fetch'); } });
  const r = await p.submit(GOOD);
  check('no internet: says so in plain words, nothing lost', r.error.includes('check your internet') && !r.done && p.els['gv-about'].value === GOOD.about && p.els['gv-submit'].disabled === false, JSON.stringify(r));
}
{
  const p = openPage({ fetch: async () => ({ ok: false, json: async () => { throw new Error('not json'); } }) });
  const r = await p.submit(GOOD);
  check('a broken answer from the server still gives a message', r.error.includes('try again') && !r.done, JSON.stringify(r));
}

// ---- the page's words ----
const html = read('public/government.html');
const body = html.slice(html.indexOf('<body>')).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const has = (words) => body.includes(words);
check('20 November 2026 really is a Friday, 21 a Saturday (the page gives the dates only)', new Date('2026-11-20T12:00:00Z').getUTCDay() === 5 && new Date('2026-11-21T12:00:00Z').getUTCDay() === 6);
check('the dates and the venue', has('20–21 November 2026') && has('World Trade Center, Mumbai'));
check('the 1.4 billion line, in English and Hindi', has('1.4 billion') && body.includes('1.4 अरब') && body.includes('भारतवासियों'));
for (const theme of ['Better governance', 'Public policy', 'Citizens’ daily lives', 'Fighting corruption', 'Safety and security', 'Health', 'Women and child safety']) check(`names what the organiser asked for: ${theme}`, has(theme));
for (const f of ['Innovation Talk & Showcase', 'Keynote & Panel Discussion', 'Closed-Door Roundtable', 'Live Demonstration', 'Launch of a New Initiative', 'Government Pavilion', 'Government-Incubated Startups']) check(`offers: ${f}`, has(f));
check('the talk is 10 minutes', has('10 minutes on stage'));
check('the pavilion is for Ministries and Departments', has('For Ministries and Departments') && has('A dedicated space in the exhibition area during both days') && read('public/exhibition.html').includes('A dedicated space in the exhibition area for Ministries'));
check('the startups come from incubation centres under Ministries', has('For incubation centres under Ministries') && has('incubation centres'));
const formats = [...html.matchAll(/name="format" value="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
check('the form offers both exhibition choices', formats.includes('Government Pavilion') && formats.includes('Incubated Startups Showcase'), formats.join(', '));
const links = [...html.matchAll(/data-format="([^"]+)"/g)].map((m) => m[1]);
check('each exhibition link names a box that exists', links.length >= 2 && links.every((l) => formats.includes(l)), links.join(', '));
const exh = read('public/exhibition.html');
check('/exhibition shows both, and sends people to the details', exh.includes('Government Pavilion') && exh.includes('Government-Incubated Startups') && (exh.match(/href="\/government#exhibition"/g) || []).length === 2 && html.includes('id="exhibition"'));
check('/exhibition still says 8 zones: the two are not counted as zones', exh.includes('8 Industry <span class="accent">Exhibition Zones') && (exh.match(/class="zone-card/g) || []).length === 8);
check('complimentary means only what the organiser wrote', has('Complimentary for Secretary-level officers') && has('Complimentary · 60–90 minutes') && (body.match(/[Cc]omplimentary/g) || []).length === 3, (body.match(/[Cc]omplimentary/g) || []).length);
for (const s of ['Governance and Public Services', 'Agriculture and Rural Development', 'Healthcare and Social Welfare', 'Education, Skills and Science', 'Industry and Economic Development', 'Infrastructure and Environment', 'Digital Public Infrastructure and AI']) check(`names the sector: ${s}`, has(s));
for (const a of ['e-Courts', 'land records', 'AYUSH', 'atomic energy', 'MSMEs', 'renewable energy', 'responsible AI']) check(`keeps the organiser's detail: ${a}`, has(a));
check('the mail-merge placeholder from the letter did not come along', !/\{\{|\}\}|company\}/.test(html));
check('says plainly it is not a government event, and who runs it', has('Is this a government event?') && has('No. Bharat AI Innovation is organised by Aegis Knowledge Trust'));
for (const [what, re] of [['no government backing claim', /supported by|in association with|backed by|government partner|endorsed by|under the aegis/i], ['no price', /₹|\bINR\b|\bRs\b/], ['no "RSVP"', /RSVP/i], ['no "largest"', /largest/i], ['no attendance figure', /\d,\d{3}\+?|\d+\+ (attendees|delegates|visitors)/i], ['no long dash in the words', /—/]]) {
  check(what, !re.test(body), (body.match(re) || [])[0]);
}
const graph = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
const faq = graph.find((g) => g['@type'] === 'FAQPage').mainEntity;
const shownQs = [...html.matchAll(/<summary>([^<]+?) <i/g)].map((m) => m[1]);
check('each question on the page has its answer in the search data', faq.length === shownQs.length && shownQs.every((q) => faq.some((f) => f.name === q)), shownQs.join(' | '));
check('no search-engine event or price of its own', !graph.some((g) => g['@type'] === 'Event' || 'offers' in g));

// ---- the people it names are still on the site, as what the page says they are ----
const home = read('public/index.html');
const llms = read('public/llms.txt');
for (const [name, words] of [['Chirag Paswan', 'Union Minister of Food Processing Industries'], ['Chandrakant Dada Patil', 'Minister of Higher and Technical Education'], ['Dattatray Bharane', 'Minister of Agriculture'], ['K.K. Singh', 'Joint Secretary, MeitY'], ['Virendra Singh', 'Secretary'], ['Akshay Yadava', 'Director, Unique Identification Authority'], ['Prakash Kumar', 'Additional Director'], ['K. Mahesh', 'Secretary, Art, Culture'], ['Vivek Khandekar', 'Principal Chief Conservator of Forests'], ['Aditi Tatkare', 'Minister of Women and Child Development'], ['Sanjay Rathod', 'Minister of Soil and Water Conservation'], ['Ashish Nandkishore Jaiswal', 'Minister of State for Finance'], ['Kunal Khemnar', 'Joint Chief Executive Officer'], ['Praveen Pardeshi', 'MITRA'], ['Suhas Mapari', 'Joint Secretary'], ['Kaustubh Dhavse', 'Chief Advisor'], ['Rajkumar Upadhyay', 'CEO'], ['Shrikant Patil', 'CEO'], ['Parag Dabhade', 'CTO'], ['Sudeep Shrivastava', 'Joint Secretary, MeitY; COO, IndiaAI Mission']]) {
  check(`${name} is on the page and still on the home page`, has(name) && new RegExp(`alt="[^"]*${name.replace(/\./g, '\\.')}[^"]*${words.replace(/[.,;]/g, '.')}`).test(home), name);
}
const count = (cls) => (html.split('<ul class="' + cls)[1] || '').split('</ul>')[0].split('<li>').length - 1;
check('six Ministers, so two rows of three', count('gv-mins') === 6, count('gv-mins'));
check('the government speakers fill three rows of four on a laptop', count('gv-offs') >= 9 && count('gv-offs') <= 16, count('gv-offs'));
check('the talks are the organiser\'s five', (html.match(/<article class="gv-talk/g) || []).length === 5);
for (const w of ['Prashant Mehra', 'Srinivas Kancharla', 'Office of the Principal Scientific Adviser to the Government of India', 'MANTHAN–UTTHAN', 'GeoAI Forest Encroachment Monitoring & Ganesh Kavach App']) check(`the talks name: ${w}`, has(w));
for (const l of ['logo-psa.webp', 'logo-midc.webp', 'logo-delhi-govt.webp', 'logo-maharashtra-forest.webp', 'exhibitors/ministry-of-tribal-affairs.webp', 'logo-meity.webp']) check(`shows the department's logo: ${l}`, html.includes('src="images/' + l + '"'));
check('Ganesh Nagarajan and Adi Vaani are in the talks list', has('Ganesh Nagarajan') && has('Adi Vaani') && /Ganesh Nagarajan.*Adi Vaani/.test(llms));
const hidden = read('scripts/data/hidden-speakers.md');
for (const gone of ['Rajiv Kumar', 'Nilesh Shah']) check(`${gone} (off the site) is not named here`, !has(gone) && (gone !== 'Nilesh Shah' || hidden.includes(gone)));

// ---- nothing it names is missing ----
const local = [...html.matchAll(/(?:src|href)="((?:\/|images\/|css\/|js\/)[^"#?]*)/g)].map((m) => m[1]).filter((u) => /\.[a-z0-9]+$/.test(u));
const missing = [...new Set(local)].filter((u) => !existsSync(new URL('../../public/' + u.replace(/^\//, ''), import.meta.url)));
check('every local file the page names exists', missing.length === 0, missing.join(', '));
const icons = [...new Set([...html.matchAll(/\bfa[sb]? (fa-[a-z0-9-]+)/g)].map((m) => m[1]))];
const subset = read('public/css/fa-subset.css');
const blank = icons.filter((i) => !subset.includes('.' + i + ':') && i !== 'fa-spin');
check('every icon used is in the icon font (a missing one shows blank)', blank.length === 0, blank.join(', '));
for (const f of ['governance-panel-820', 'governance-panel-1400']) {
  const kb = statSync(new URL(`../../public/images/government/${f}.webp`, import.meta.url)).size / 1024;
  check(`${f} is light enough for a phone (${Math.round(kb)} KB)`, kb < 150, kb);
}
check('the share card is under WhatsApp\'s 300 KB', statSync(new URL('../../public/images/og/government.jpg', import.meta.url)).size < 300 * 1024);
check('past photographs are named as past', (body.match(/Data Science Congress, the predecessor to Bharat AI Innovation/g) || []).length === 2);

// ---- the tab on every page ----
const pages = readdirSync(new URL('../../public/', import.meta.url)).filter((f) => f.endsWith('.html'));
const withMenu = pages.filter((f) => read('public/' + f).includes('class="nav-menu"'));
check('at least 22 pages carry the menu', withMenu.length >= 22, withMenu.length);
const badMenu = withMenu.filter((f) => {
  const s = read('public/' + f);
  const menu = s.slice(s.indexOf('class="nav-menu"'), s.indexOf('nav-toggle'));
  const order = [...menu.matchAll(/href="([^"]+)" (?:target="_blank" rel="noopener noreferrer" )?class="nav-link/g)].map((m) => m[1]);
  const at = order.indexOf('/government');
  return order.filter((h) => h === '/government').length !== 1 || order[at - 1] !== '/partner' || order[at + 1] !== '/training-workshop' || !/href="\/government" class="nav-link[^"]*">Govt</.test(menu);
});
check('every menu has Govt once, after Partner, before Workshops', badMenu.length === 0, badMenu.join(', '));
check('Govt is the current tab only on its own page', html.includes('href="/government" class="nav-link active"') && withMenu.filter((f) => f !== 'government.html' && read('public/' + f).includes('href="/government" class="nav-link active"')).length === 0);
const versions = new Set(withMenu.map((f) => (read('public/' + f).match(/style\.css\?v=(\w+)/) || [])[1]));
check('one stylesheet version on every page, the new menu\'s', versions.size === 1 && !versions.has('20261105'), [...versions].join(', '));
check('the service worker stores that same version', read('public/sw.js').includes(`'/css/style.css?v=${[...versions][0]}'`));

// ---- found by search engines and AI crawlers, and Admin knows the type ----
check('in the sitemap', read('public/sitemap.xml').includes('<loc>https://bharataiinnovation.com/government</loc>'));
check('in llms.txt, not called a government event', /\[Government\]\(https:\/\/bharataiinnovation\.com\/government\).*not a government event/.test(llms));
const src = read('src/index.tsx');
check('the worker accepts the type', /validTypes = \[[^\]]*'government'/.test(src));
check('Admin labels the type', src.includes("government: { icon: 'fa-building-columns', color: 'green', label: 'Government' }"));

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
