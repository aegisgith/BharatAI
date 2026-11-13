// Unit: the Delhi 2027 page's rules, each on its own, no browser and no server (5 Nov
// 2026). The form's own script runs in node:vm (delhi-world.mjs); the page's facts, the
// calendar file and the menu are read from the shipped files.
// Run:  node scripts/verify/unit-delhi.mjs
import { existsSync, readdirSync, statSync } from 'node:fs';
import { openPage, read } from './delhi-world.mjs';

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const GOOD = { name: 'Priya Sharma', email: 'priya@example.com', phone: '98765 43210', org: 'Example Ltd', job: 'CTO', city: 'New Delhi' };

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
  ['free pass with no mobile', 'attend', { ...GOOD, phone: '' }, 'mobile number', 'dl-phone'],
  ['free pass with no organisation', 'attend', { ...GOOD, org: ' ' }, 'organisation', 'dl-org'],
  ['free pass with no designation', 'attend', { ...GOOD, job: '' }, 'designation', 'dl-job'],
  ['free pass with no city', 'attend', { ...GOOD, city: '' }, 'city', 'dl-city'],
  ['Speak with a short mobile typed', 'speak', { ...GOOD, phone: '123' }, 'at least 10 digits', 'dl-phone'],
];
for (const [what, interest, input, words, box] of refusals) {
  const p = openPage();
  p.choose(interest);
  const r = await p.submit(input);
  check(`refused, ${what}: says so, marks the box, sends nothing`, r.error.includes(words) && !r.done && p.sent.length === 0 && p.focused.id === box && p.els[box].attrs['aria-invalid'] === 'true', JSON.stringify(r));
}

// ---- what it accepts, and how each choice is filed ----
const filed = { exhibit: ['exhibition', 'Exhibit'], sponsor: ['sponsorship', 'Sponsor'], speak: ['speaking', 'Speak'] };
for (const [interest, [type, label]] of Object.entries(filed)) {
  const p = openPage();
  p.choose(interest);
  const r = await p.submit(GOOD);
  check(`${label}: filed as ${type}, subject "Delhi 2027 · ${label}"`, r.done && r.url === '/api/inquiries' && r.body?.inquiry_type === type && r.body.subject === 'Delhi 2027 · ' + label && r.body.metadata.interest === interest && r.body.metadata.edition === 'delhi-2027' && r.body.message.includes('Bharat Mandapam'), JSON.stringify(r.body));
}
{
  const p = openPage();
  p.choose('speak');
  const r = await p.submit({ name: 'Priya Sharma', email: ' priya@example.com ', phone: '', org: '' });
  check('Speak with no mobile or organisation is fine, spaces trimmed', r.done && r.body.email === 'priya@example.com' && r.body.phone === '', JSON.stringify(r));
  check('the thank-you for a Speak enquiry promises a call back, not a pass', p.els['dl-done-title'].textContent === 'We have your details' && p.els['dl-done-text'].textContent.includes('Priya.') && p.els['dl-done-text'].textContent.includes('priya@example.com') && !/pass/i.test(p.els['dl-done-text'].textContent) && p.els['dl-form'].hidden === true, p.els['dl-done-text'].textContent);
}
{
  const p = openPage();
  const r = await p.submit({ ...GOOD, name: '  Priya Sharma ', email: ' priya@example.com ', phone: ' 98765 43210 ', city: ' New Delhi ' });
  check('Attend is a registration: the free pass route, every box sent, spaces trimmed', r.done && r.url === '/api/delhi/register' && r.body.name === 'Priya Sharma' && r.body.email === 'priya@example.com' && r.body.mobile === '98765 43210' && r.body.company === 'Example Ltd' && r.body.job_title === 'CTO' && r.body.city === 'New Delhi', JSON.stringify(r));
  check('the thank-you says waitlisted, names the pass and the email, and promises no pass yet', p.els['dl-done-title'].textContent === 'You are waitlisted' && p.els['dl-done-text'].textContent.includes('Priya.') && p.els['dl-done-text'].textContent.includes('You are waitlisted for a free Visitor Pass') && p.els['dl-done-text'].textContent.includes('priya@example.com') && p.els['dl-done-text'].textContent.includes('when your pass is confirmed') && !p.els['dl-done-text'].textContent.includes('is confirmed,'), p.els['dl-done-text'].textContent);
}
{
  const p = openPage({ fetch: async () => ({ ok: true, json: async () => ({ success: true, already: true }) }) });
  const r = await p.submit(GOOD);
  check('already on the list: told so kindly, not an error', r.done && !r.error && p.els['dl-done-title'].textContent === 'You are already waitlisted', JSON.stringify(r));
}
{
  const p = openPage();
  const r = await p.submit({ ...GOOD, website: 'http://spam.example' });
  check('a bot filling the hidden box sees success and nothing is sent', r.done && p.sent.length === 0, JSON.stringify(r));
}

// ---- the mobile's hint, the choice carried in by a link ----
{
  const p = openPage();
  check('a free pass asks for the mobile, with no "(optional)" beside it', p.els['dl-phone-hint'].textContent === '' && p.els['dl-org-hint'].textContent === '', p.els['dl-phone-hint'].textContent);
  check('the page opens on the free pass, with designation and city showing', p.els['dl-form-title'].innerHTML.includes('free pass') && p.els['dl-submit'].innerHTML.includes('Register free') && p.els['dl-job-box'].hidden === false && p.els['dl-city-box'].hidden === false);
  p.choose('sponsor');
  check('mobile says the team will call for Sponsor', p.els['dl-phone-hint'].textContent.includes('call you'), p.els['dl-phone-hint'].textContent);
  check('Sponsor is a talk with the team: no pass words, designation and city put away', !p.els['dl-form-title'].innerHTML.includes('free pass') && p.els['dl-submit'].innerHTML.includes('Send') && p.els['dl-job-box'].hidden === true && p.els['dl-city-box'].hidden === true && p.els['dl-org-hint'].textContent === '(optional)');
  p.choose('speak');
  check('and is optional for Speak', p.els['dl-phone-hint'].textContent === '(optional)', p.els['dl-phone-hint'].textContent);
  p.choose('attend');
  check('and back to the pass, the boxes return', p.els['dl-submit'].innerHTML.includes('Register free') && p.els['dl-job-box'].hidden === false);
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
  check('a server refusal is shown in its words, the form stays, the button comes back', r.error === 'Name and email are required' && !r.done && p.els['dl-submit'].disabled === false && p.els['dl-submit'].innerHTML.includes('Register free'), JSON.stringify(r));
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
  check('Android opens Google Calendar on the right days and place', href.startsWith('https://calendar.google.com/') && href.includes('dates=20270728/20270730') && decodeURIComponent(href).includes('Bharat Mandapam') && !('download' in a.els['dl-save-date'].attrs), href);
  check('the thank-you button does the same', a.els['dl-save-date-2'].href === href);
  check('an iPhone keeps the calendar file', openPage().els['dl-save-date'].href === '/delhi-2027.ics');
}
{
  const ics = read('public/delhi-2027.ics');
  check('calendar file: CRLF line ends, as the format needs', ics.split('\n').every((l, i, all) => i === all.length - 1 || l.endsWith('\r')));
  check('calendar file: 28 and 29 July 2027 (the end date is the day after)', ics.includes('DTSTART;VALUE=DATE:20270728\r\n') && ics.includes('DTEND;VALUE=DATE:20270730\r\n'));
  check('calendar file: the venue, commas escaped', ics.includes('LOCATION:Bharat Mandapam\\, Pragati Maidan\\, New Delhi\r\n'));
}

// ---- the page's facts ----
const html = read('public/delhi.html');
const body = html.slice(html.indexOf('<body>')).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ');
check('28 July 2027 really is a Wednesday, 29 July a Thursday', new Date('2027-07-28T12:00:00Z').getUTCDay() === 3 && new Date('2027-07-29T12:00:00Z').getUTCDay() === 4);
check('the page says Wednesday 28 and Thursday 29 July 2027', body.includes('Wednesday 28 and Thursday 29 July 2027'));
check('the venue is named, nothing is left "to be announced"', body.includes('Bharat Mandapam') && !/to be announced|\bTBA\b/i.test(html));
// Prices are on the page now (6 Nov 2026), so they are left out before looking for a crowd figure.
const unpriced = body.replace(/₹[\d,.]+/g, '');
for (const [what, re] of [['no "RSVP"', /RSVP/i], ['no "largest"', /largest/i], ['no attendance figure', /\d,\d{3}\+?|\d+\+ (attendees|delegates|visitors)/i], ['no government backing claim', /MeitY|supported by|in association with|backed by/i], ['no long dash in the words', /—/]]) {
  check(what, !re.test(unpriced), (unpriced.match(re) || [])[0]);
}
const graph = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
const ev = graph.find((g) => g['@type'] === 'Event');
check('search-engine event data: dates and venue', ev.startDate === '2027-07-28' && ev.endDate === '2027-07-29' && ev.location.name === 'Bharat Mandapam' && ev.location.address.addressLocality === 'New Delhi');
check('search-engine event data offers the paid passes, cheapest to dearest', ev.offers.priceCurrency === 'INR' && ev.offers.lowPrice === '999' && ev.offers.highPrice === '19999' && ev.offers.url.endsWith('/delhi-register'), JSON.stringify(ev.offers));
check('"Tell me first" and "first to know" are gone from the page', !/tell me first|first to know/i.test(html));
check('every Get your pass button goes to the passes', [...html.matchAll(/<a ([^>]*)>Get your pass/g)].length === 3 && [...html.matchAll(/<a ([^>]*)>Get your pass/g)].every((m) => m[1].includes('href="#passes"')));
check('the free pass is still offered, and still goes to the form on Attend', /<a href="#updates" data-interest="attend">Register to join the waitlist<\/a>/.test(html));
check('the page gives Mumbai\'s rule for the free pass, says waitlist, and that the two events are separate', body.includes('Exhibition only, entry by time slot') && body.includes('join the waitlist') && body.includes('A pass for one does not cover the other'));
check('the form asks for all six: name, email, mobile, organisation, designation, city', ['dl-name', 'dl-email', 'dl-phone', 'dl-org', 'dl-job', 'dl-city'].every((id) => html.includes('id="' + id + '"')));
check('search data no longer says passes are closed', !JSON.stringify(graph).includes('Not yet.') && JSON.stringify(graph).includes('free Visitor Pass'));
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
check('the rest of the format is named, the Startup Pitch included (Delhi keeps it; Mumbai cancelled its own, 13 Nov 2026)', !body.includes('as in Mumbai') && ['CXO AI Leadership Panels', 'Startup Pitch', 'Bharat AI Leaders’ Evening', 'Private boardrooms', 'AI Marketplace', 'Bharat AI Connect app'].every((x) => body.includes(x)));
check('llms.txt says the paid passes are on sale, with their prices', /\[Delhi 2027\].*Rs 4,999.*delhi-register/.test(read('public/llms.txt')) && !read('public/llms.txt').includes('paid passes and booths open later'));
check('the passes page is in the sitemap', read('public/sitemap.xml').includes('<loc>https://bharataiinnovation.com/delhi-register</loc>'));
check('llms.txt says the free pass is open', /\[Delhi 2027\].*free Visitor Pass.*open on the page/.test(read('public/llms.txt')) && !read('public/llms.txt').includes('leave your details on the page to hear first'));
check('llms.txt names the programme', /\[Delhi 2027\].*hackathons.*cross-border dialogue/.test(read('public/llms.txt')));

// ---- nothing it names is missing ----
const local = [...html.matchAll(/(?:src|href)="((?:\/|images\/|css\/|js\/)[^"#?]*)/g)].map((m) => m[1]).filter((u) => /\.[a-z0-9]+$/.test(u));
const missing = [...new Set(local)].filter((u) => !existsSync(new URL('../../public/' + u.replace(/^\//, ''), import.meta.url)));
check('every local file the page names exists', missing.length === 0, missing.join(', '));

// ---- on sale: the same names, sizes and prices as Mumbai's own pages ----
const expo = read('public/exhibition.html');
const expoBody = expo.slice(expo.indexOf('<body>'));
const saleRows = [...html.matchAll(/<li class="dl-sale-row[^"]*"><div><b>(.*?)<\/b><span>(.*?)<\/span><\/div><p>(.*?)<\/p>/g)].map((m) => ({ name: m[1], line: m[2], price: m[3].replace(/<[^>]+>/g, '').trim() }));
const packages = [...expoBody.matchAll(/<div class="package-name">(.*?)<\/div>\s*<div class="package-size">(.*?)<\/div>\s*<div class="package-price"[^>]*>(.*?)<span>/g)].map((m) => ({ name: m[1], size: m[2], price: m[3].replace(/<s[ >].*?<\/s>/, '').trim() }));
check('Mumbai lists seven booths', packages.length === 7, packages.length);
for (const b of packages) {
  const d = saleRows.find((r) => r.name === b.name);
  check(`${b.name}: same price as Mumbai (${b.price})`, d && d.price === b.price + ' + GST', JSON.stringify(d));
  check(`${b.name}: same size as Mumbai (${b.size.split(' (')[0]})`, d && d.line.startsWith(b.size.split(' (')[0]), JSON.stringify(d));
}
const partner = read('public/partner.html');
const tiers = [...partner.matchAll(/<h3>([^<]+)<\/h3>[\s\S]{0,700}?<div class="tier-price">(.*?)<\/div>/g)].map((m) => ({ name: m[1], price: m[2] }));
check('Mumbai lists five partnership tiers', tiers.length === 5, JSON.stringify(tiers));
for (const t of tiers) check(`${t.name}: same title and price as Mumbai (${t.price})`, saleRows.some((r) => r.name === t.name && r.price === t.price), JSON.stringify(saleRows.find((r) => r.name === t.name)));
const clean = (v) => v.replace(/&amp;/g, '&').replace(/&rsquo;/g, '’').replace(/&#8377;/g, '₹').replace(/<span>/g, '').replace(/<\/span>/g, '').trim();
const options = [...partner.matchAll(/<h3>([^<]+)<\/h3>\s*<div class="option-price">(.*?)<\/div>/g)].map((m) => ({ name: clean(m[1]), price: clean(m[2]) }));
check('Mumbai lists ten sponsorship options', options.length === 10, options.length);
for (const o of options) check(`${o.name}: same title and price as Mumbai (${o.price})`, saleRows.some((r) => r.name === o.name && r.price === o.price), JSON.stringify(saleRows.find((r) => r.name === o.name)));
check('nothing on Delhi\'s list is missing from Mumbai\'s', saleRows.length === packages.length + tiers.length + options.length, saleRows.length);
check('every row\'s button names the same thing and price', [...html.matchAll(/<li class="dl-sale-row[^"]*"><div><b>(.*?)<\/b>.*?<p>(.*?)<\/p><a [^>]*data-item="([^"]+)"/g)].every((m) => m[3].startsWith(m[1] + ', ')));
{
  const p = openPage({ links: ['exhibit|Explorer Booth, ₹1,29,000 + GST'] });
  p.links[0].listeners.click();
  check('Book this booth: chooses Exhibit and shows what was chosen', p.interest() === 'exhibit' && p.els['dl-chosen'].textContent === 'You chose: Explorer Booth, ₹1,29,000 + GST' && p.els['dl-chosen'].hidden === false, p.els['dl-chosen'].textContent);
  const r = await p.submit(GOOD);
  check('the enquiry says which booth, and so does the thank-you', r.body.subject === 'Delhi 2027 · Exhibit · Explorer Booth, ₹1,29,000 + GST' && r.body.message.includes('Explorer Booth') && p.els['dl-done-text'].textContent.includes('Explorer Booth') && p.els['dl-done-text'].textContent.includes('call you'), JSON.stringify(r.body));
}
{
  const p = openPage({ links: ['exhibit|Explorer Booth, ₹1,29,000 + GST'] });
  p.links[0].listeners.click();
  p.choose('speak');
  check('choosing something else in the form lets go of the booth', p.els['dl-chosen'].hidden === true && p.els['dl-chosen'].textContent === '');
}
check('the effects name where they came from, and no library is loaded', html.includes('Uiverse.io (MIT, (c) 2023 Uiverse.io)') && html.includes('React Bits (MIT + Commons Clause, (c) 2026 David Haz)') && ![...html.matchAll(/<script[^>]* src="([^"]+)"/g)].some((m) => !m[1].startsWith('js/main.js')));
check('the page says the floor plan comes later', body.includes('We will publish the floor plan later'));
check('the refund policy now names Delhi and its date', read('public/refund.html').includes('<strong>28 July 2027</strong>'));
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
check('Delhi 2027 is the current tab only on its own page', read('public/delhi.html').includes('href="/delhi" class="nav-link active"') && withMenu.filter((f) => f !== 'delhi.html' && f !== 'delhi-hi.html' && read('public/' + f).includes('href="/delhi" class="nav-link active"')).length === 0);
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
