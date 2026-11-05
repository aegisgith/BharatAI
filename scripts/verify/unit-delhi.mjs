// Unit: the Delhi 2027 page's rules, each on its own, no browser and no server (5 Nov
// 2026). The form's own script runs in node:vm (delhi-world.mjs); the page's facts, the
// calendar file and the menu are read from the shipped files.
// Run:  node scripts/verify/unit-delhi.mjs
import { existsSync, readdirSync, statSync } from 'node:fs';
import { openPage, read } from './delhi-world.mjs';

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const GOOD = { name: 'Priya Sharma', email: 'priya@example.com', phone: '98765 43210', org: 'Example Ltd' };

// ---- what the form refuses, with the words the person sees ----
const refusals = [
  ['no name', 'attend', { ...GOOD, name: '   ' }, 'your name', 'dl-name'],
  ['no email', 'attend', { ...GOOD, email: '' }, 'check your email', 'dl-email'],
  ['email without a domain', 'attend', { ...GOOD, email: 'priya@' }, 'check your email', 'dl-email'],
  ['email with a space', 'attend', { ...GOOD, email: 'pri ya@example.com' }, 'check your email', 'dl-email'],
  ['Exhibit with no mobile', 'exhibit', { ...GOOD, phone: '' }, 'mobile number', 'dl-phone'],
  ['Sponsor with no mobile', 'sponsor', { ...GOOD, phone: '' }, 'mobile number', 'dl-phone'],
  ['Exhibit with a short mobile', 'exhibit', { ...GOOD, phone: '12345' }, 'mobile number', 'dl-phone'],
  ['Attend with a short mobile typed', 'attend', { ...GOOD, phone: '12345' }, 'at least 10 digits', 'dl-phone'],
  ['Speak with a short mobile typed', 'speak', { ...GOOD, phone: '123' }, 'at least 10 digits', 'dl-phone'],
];
for (const [what, interest, input, words, box] of refusals) {
  const p = openPage();
  p.choose(interest);
  const r = await p.submit(input);
  check(`refused, ${what}: says so, marks the box, sends nothing`, r.error.includes(words) && !r.done && p.sent.length === 0 && p.focused.id === box && p.els[box].attrs['aria-invalid'] === 'true', JSON.stringify(r));
}

// ---- what it accepts, and how each choice is filed ----
const filed = { attend: ['general', 'Attend'], exhibit: ['exhibition', 'Exhibit'], sponsor: ['sponsorship', 'Sponsor'], speak: ['speaking', 'Speak'] };
for (const [interest, [type, label]] of Object.entries(filed)) {
  const p = openPage();
  p.choose(interest);
  const r = await p.submit(GOOD);
  check(`${label}: filed as ${type}, subject "Delhi 2027 · ${label}"`, r.done && r.body?.inquiry_type === type && r.body.subject === 'Delhi 2027 · ' + label && r.body.metadata.interest === interest && r.body.metadata.edition === 'delhi-2027' && r.body.message.includes('Bharat Mandapam'), JSON.stringify(r.body));
}
{
  const p = openPage();
  const r = await p.submit({ name: 'Priya Sharma', email: ' priya@example.com ', phone: '', org: '' });
  check('Attend with no mobile or organisation is fine, spaces trimmed', r.done && r.body.email === 'priya@example.com' && r.body.phone === '', JSON.stringify(r));
  check('the thank-you uses the first name and the email given', p.els['dl-done-text'].textContent.includes('Priya.') && p.els['dl-done-text'].textContent.includes('priya@example.com') && p.els['dl-form'].hidden === true, p.els['dl-done-text'].textContent);
}
{
  const p = openPage();
  const r = await p.submit({ ...GOOD, website: 'http://spam.example' });
  check('a bot filling the hidden box sees success and nothing is sent', r.done && p.sent.length === 0, JSON.stringify(r));
}

// ---- the mobile's hint, the choice carried in by a link ----
{
  const p = openPage();
  check('mobile is "(optional)" for Attend', p.els['dl-phone-hint'].textContent === '(optional)', p.els['dl-phone-hint'].textContent);
  p.choose('sponsor');
  check('mobile says the team will call for Sponsor', p.els['dl-phone-hint'].textContent.includes('call you'), p.els['dl-phone-hint'].textContent);
  p.choose('speak');
  check('and is optional again for Speak', p.els['dl-phone-hint'].textContent === '(optional)', p.els['dl-phone-hint'].textContent);
}
check('?interest=exhibit opens on Exhibit', openPage({ search: '?interest=exhibit' }).interest() === 'exhibit');
check('an unknown ?interest= is ignored', openPage({ search: '?interest=<b>x' }).interest() === 'attend');
{
  const p = openPage({ links: ['sponsor'] });
  p.links[0].listeners.click();
  check('a link marked data-interest chooses it', p.interest() === 'sponsor', p.interest());
}
{
  const p = openPage({ search: '?utm_source=linkedin&utm_medium=post&utm_campaign=delhi&source=mail&junk=1' });
  const r = await p.submit(GOOD);
  check('where the visitor came from travels with the enquiry, and nothing else', r.body.metadata.utm_source === 'linkedin' && r.body.metadata.utm_medium === 'post' && r.body.metadata.utm_campaign === 'delhi' && r.body.metadata.source === 'mail' && !('junk' in r.body.metadata), JSON.stringify(r.body.metadata));
}

// ---- it never fails silently ----
{
  const p = openPage({ fetch: async () => ({ ok: false, json: async () => ({ error: 'Name and email are required' }) }) });
  const r = await p.submit(GOOD);
  check('a server refusal is shown in its words, the form stays, the button comes back', r.error === 'Name and email are required' && !r.done && p.els['dl-submit'].disabled === false && p.els['dl-submit'].innerHTML.includes('Tell me first'), JSON.stringify(r));
}
{
  const p = openPage({ fetch: async () => { throw new TypeError('Failed to fetch'); } });
  const r = await p.submit(GOOD);
  check('no internet: says so in plain words, nothing lost', r.error.includes('check your internet') && !r.done && p.els['dl-name'].value === GOOD.name && p.els['dl-submit'].disabled === false, JSON.stringify(r));
}
{
  const p = openPage({ fetch: async () => ({ ok: false, json: async () => { throw new Error('not json'); } }) });
  const r = await p.submit(GOOD);
  check('a broken answer from the server still gives a message', r.error.includes('try again') && !r.done, JSON.stringify(r));
}

// ---- Save the date ----
{
  const a = openPage({ userAgent: 'Mozilla/5.0 (Linux; Android 14)' });
  const href = a.els['dl-save-date'].href;
  check('Android opens Google Calendar on the right days and place', href.startsWith('https://calendar.google.com/') && href.includes('dates=20270729/20270731') && decodeURIComponent(href).includes('Bharat Mandapam') && !('download' in a.els['dl-save-date'].attrs), href);
  check('the thank-you button does the same', a.els['dl-save-date-2'].href === href);
  check('an iPhone keeps the calendar file', openPage().els['dl-save-date'].href === '/delhi-2027.ics');
}
{
  const ics = read('public/delhi-2027.ics');
  check('calendar file: CRLF line ends, as the format needs', ics.split('\n').every((l, i, all) => i === all.length - 1 || l.endsWith('\r')));
  check('calendar file: 29 and 30 July 2027 (the end date is the day after)', ics.includes('DTSTART;VALUE=DATE:20270729\r\n') && ics.includes('DTEND;VALUE=DATE:20270731\r\n'));
  check('calendar file: the venue, commas escaped', ics.includes('LOCATION:Bharat Mandapam\\, Pragati Maidan\\, New Delhi\r\n'));
}

// ---- the page's facts ----
const html = read('public/delhi.html');
const body = html.slice(html.indexOf('<body>')).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ');
check('29 July 2027 really is a Thursday, 30 July a Friday', new Date('2027-07-29T12:00:00Z').getUTCDay() === 4 && new Date('2027-07-30T12:00:00Z').getUTCDay() === 5);
check('the page says Thursday 29 and Friday 30 July 2027', body.includes('Thursday 29 and Friday 30 July 2027'));
check('the venue is named, nothing is left "to be announced"', body.includes('Bharat Mandapam') && !/to be announced|\bTBA\b/i.test(html));
for (const [what, re] of [['no price', /₹|\bINR\b/], ['no "RSVP"', /RSVP/i], ['no "largest"', /largest/i], ['no attendance figure', /\d,\d{3}\+?|\d+\+ (attendees|delegates|visitors)/i], ['no government backing claim', /MeitY|supported by|in association with|backed by/i], ['no long dash in the words', /—/]]) {
  check(what, !re.test(body), (body.match(re) || [])[0]);
}
const graph = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
const ev = graph.find((g) => g['@type'] === 'Event');
check('search-engine event data: dates and venue', ev.startDate === '2027-07-29' && ev.endDate === '2027-07-30' && ev.location.name === 'Bharat Mandapam' && ev.location.address.addressLocality === 'New Delhi');
check('search-engine event data offers nothing for sale yet', !('offers' in ev));
const faq = graph.find((g) => g['@type'] === 'FAQPage').mainEntity;
const visibleQs = (html.match(/<summary>/g) || []).length;
check('one answer in the search data for each question on the page', faq.length === visibleQs, faq.length + ' / ' + visibleQs);

// ---- the programme the organiser listed, every box with a picture ----
const tiles = [...html.matchAll(/<li class="dl-tile[^"]*">([\s\S]*?)<\/li>/g)].map((m) => m[1]);
const titled = tiles.map((t) => (t.match(/<b>(.*?)<\/b>/) || [])[1]);
for (const item of ['Keynotes', 'Panel discussions', 'AI workshops', 'Hackathons', 'Closed-door roundtables', 'Exhibition', 'Cross-border dialogue', 'B2B networking']) {
  check(`the programme lists ${item}`, titled.includes(item), titled.join(', '));
}
check('Innovation Talks & Showcase twice: by startups and corporates, by government', titled.filter((t) => t === 'Innovation Talks &amp; Showcase').length === 2 && html.includes('By startups and corporates') && html.includes('By government departments, ministries and state governments'));
check('all ten boxes, and every one has a picture with words for screen readers', tiles.length === 10 && tiles.every((t) => /<img [^>]*src="[^"]+"/.test(t) && /alt="[^"]{10,}"/.test(t)), tiles.length);
check('no two boxes share a picture', new Set(tiles.map((t) => t.match(/src="([^"]+)"/)[1])).size === 10);
check('the programme comes straight after the hero', html.indexOf('id="programme"') > html.indexOf('class="dl-hero"') && html.indexOf('id="programme"') < html.indexOf('id="venue"'));
check('the form comes after the programme, the venue and who it is for', html.indexOf('id="updates"') > html.indexOf('id="who"'));
check('the rest of the Mumbai format is named', ['CXO AI Leadership Panels', 'Startup Pitch', 'Bharat AI Leaders’ Evening', 'Private boardrooms', 'AI Marketplace', 'Bharat AI Connect app'].every((x) => body.includes(x)));
check('llms.txt names the programme', /\[Delhi 2027\].*hackathons.*cross-border dialogue/.test(read('public/llms.txt')));

// ---- nothing it names is missing ----
const local = [...html.matchAll(/(?:src|href)="((?:\/|images\/|css\/|js\/)[^"#?]*)/g)].map((m) => m[1]).filter((u) => /\.[a-z0-9]+$/.test(u));
const missing = [...new Set(local)].filter((u) => !existsSync(new URL('../../public/' + u.replace(/^\//, ''), import.meta.url)));
check('every local file the page names exists', missing.length === 0, missing.join(', '));
const icons = [...new Set([...html.matchAll(/\bfa[sb]? (fa-[a-z0-9-]+)/g)].map((m) => m[1]))];
const subset = read('public/css/fa-subset.css');
const blank = icons.filter((i) => !subset.includes('.' + i + ':') && i !== 'fa-spin');
check('every icon used is in the icon font (a missing one shows blank)', blank.length === 0, blank.join(', '));
for (const f of ['mandapam-dusk-1600', 'mandapam-dusk-2400', 'mandapam-dusk-phone', 'mandapam-day', 'mandapam-gate']) {
  const kb = statSync(new URL(`../../public/images/delhi/${f}.webp`, import.meta.url)).size / 1024;
  check(`${f} is light enough for a phone (${Math.round(kb)} KB)`, kb < 200, kb);
}
check('the share card is under WhatsApp\'s 300 KB', statSync(new URL('../../public/images/og/delhi.jpg', import.meta.url)).size < 300 * 1024);

// ---- the tab on every page, and one version of the stylesheet everywhere ----
const pages = readdirSync(new URL('../../public/', import.meta.url)).filter((f) => f.endsWith('.html'));
const withMenu = pages.filter((f) => read('public/' + f).includes('class="nav-menu"'));
check('at least 21 pages carry the menu', withMenu.length >= 21, withMenu.length);
const badMenu = withMenu.filter((f) => {
  const s = read('public/' + f);
  const menu = s.slice(s.indexOf('class="nav-menu"'), s.indexOf('nav-toggle'));
  const order = [...menu.matchAll(/href="([^"]+)" (?:target="_blank" rel="noopener noreferrer" )?class="nav-link/g)].map((m) => m[1]);
  const at = order.indexOf('/delhi');
  return order.filter((h) => h === '/delhi').length !== 1 || order[at - 1] !== '/campus-series' || order[at + 1] !== '/ai-readiness';
});
check('every menu has Delhi 2027 once, after Campus Series, before AI Readiness', badMenu.length === 0, badMenu.join(', '));
check('Delhi 2027 is the current tab only on its own page', read('public/delhi.html').includes('href="/delhi" class="nav-link active"') && withMenu.filter((f) => f !== 'delhi.html' && read('public/' + f).includes('href="/delhi" class="nav-link active"')).length === 0);
const versions = new Set(withMenu.map((f) => (read('public/' + f).match(/style\.css\?v=([\w]+)/) || [])[1]));
check('one stylesheet version on every page', versions.size === 1, [...versions].join(', '));
const v = [...versions][0];
check('the service worker stores that same version', read('public/sw.js').includes(`'/css/style.css?v=${v}'`), v);

// ---- found by search engines and AI crawlers ----
check('in the sitemap', read('public/sitemap.xml').includes('<loc>https://bharataiinnovation.com/delhi</loc>'));
check('in llms.txt, as a separate event at Bharat Mandapam', /\[Delhi 2027\]\(https:\/\/bharataiinnovation\.com\/delhi\).*separate event.*Bharat Mandapam/.test(read('public/llms.txt')));

// ---- the home page's heading font and the bar's line ----
const home = read('public/index.html');
check('home: loads the brand heading font', home.includes("font-family: 'Bricolage Grotesque'") && home.includes('rel="preload" href="/fonts/bricolage-grotesque-latin-400-800.woff2"'));
check('the bar over a photograph does not repeat its fade into its border', /nav-over-hero:not\(\.scrolled\) \{[^}]*background-repeat: no-repeat/.test(read('public/css/style.css')));

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
