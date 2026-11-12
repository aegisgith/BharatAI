// UNIT for the hand-written pages after the price rise (6 Nov 2026). The worker's pages
// read the price tables and change by themselves; these pages do not, and on the morning
// of 6 Nov three of them still promised 4,999 while checkout charged 8,999.
// Each page must carry today's price beside the old one struck through, and none may
// still offer the old price or count down to a day that has gone.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const struck = (html, was, now) => new RegExp('&#8377;' + was + '</s> &#8377;' + now).test(html);
// Every old figure on a page must be inside the <s> that strikes it through.
const plainOld = (html, figure) => (html.replace(/<s\b[^>]*>[\s\S]*?<\/s>/g, '').match(new RegExp('(&#8377;|₹)' + figure + '(?![0-9,])', 'g')) || []).length;

const conference = read('conference.html');
check('/conference: Delegate struck through beside today\'s price, twice', (conference.match(/&#8377;4,999<\/s> &#8377;8,999/g) || []).length === 2);
check('/conference: nothing offers the old price plainly', plainOld(conference, '4,999') === 0);
check('/conference: no countdown to a day that has gone', !conference.includes('data-days-left'));

const networking = read('networking.html');
check('/networking: Delegate struck through beside today\'s price', struck(networking, '4,999', '8,999'));
check('/networking: nothing offers the old price plainly', plainOld(networking, '4,999') === 0);
check('/networking: says it may go up again, and no countdown', networking.includes('Prices went up on 6 Nov and may go up again.') && !networking.includes('data-days-left'));

const workshops = read('training-workshop.html');
check('/training-workshop: Premium and VIP struck through in both places', (workshops.match(/&#8377;9,999<\/s> &#8377;14,999/g) || []).length === 2 && (workshops.match(/&#8377;19,999<\/s> &#8377;24,999/g) || []).length === 2);
check('/training-workshop: Delegate too', struck(workshops, '4,999', '8,999'));
for (const old of ['4,999', '9,999', '19,999']) check('/training-workshop: ' + old + ' is never offered plainly', plainOld(workshops, old) === 0);

for (const f of ['index.html', 'conference.html']) {
  check(f + ': what search engines are told is the top price is today\'s', read(f).includes('"highPrice": "24999"') && !read(f).includes('"highPrice": "19999"'));
}
for (const f of ['conference.html', 'networking.html', 'training-workshop.html', 'delegation.html']) {
  check(f + ': does not say a price holds until 5 Nov', !/until 5 Nov/.test(read(f)));
}
check('/delegation link previews say the prices went up', (read('delegation.html').match(/Prices went up on 6 Nov 2026\./g) || []).length === 2);

const terms = read('terms.html');
check('terms: the standard price is in the past, an order keeps its price', terms.includes('the standard price applied to orders') && terms.includes('An order keeps the price it was placed at.'));
const llms = read('llms.txt');
check('llms.txt: lists today\'s prices', ['Academic Pass** — ₹3,999', 'Delegate Pass** — ₹8,999', 'Premium Delegate Pass** — ₹14,999', 'VIP Pass** — ₹24,999'].every(s => llms.includes(s)));
check('llms.txt: says what they were, in the past', llms.includes('Until 5 November they were Academic ₹999, Delegate ₹4,999, Premium Delegate ₹9,999, VIP ₹19,999'));

// The Startup Pod, struck through on the pages that choose a booth (6 Nov 2026). The figure
// search engines and link previews read stays plain.
const exhibition = read('exhibition.html');
check('/exhibition: the Startup Pod struck through on its card and in the table', (exhibition.match(/₹38,000<\/s> ₹48,000/g) || []).length === 2);
check('/exhibition: what search engines read is the plain price', exhibition.includes('"name": "Startup Pod", "price": "48000"'));
const fpVersion = (exhibition.match(/js\/floor-plan\.js\?v=([0-9a-z-]+)/) || [])[1] || '';
check('/exhibition: the floor plan script is a new version, so nobody keeps the old file', fpVersion >= '2026-11-06b', fpVersion);
check('floor plan: the panel strikes the old price for a pod only', read('js/floor-plan.js').includes("it.type==='pod'") && read('js/floor-plan.js').includes('inr(38000)'));
check('/partner and the home page show it struck through too', /&#8377;38,000<\/s> &#8377;48,000/.test(read('partner.html')) && /<s>₹38,000<\/s> ₹48,000/.test(read('index.html')));
check('/delhi, a different event, is not touched', !read('delhi.html').includes('38,000'));

console.log(fails ? `\n${fails} FAILED` : '\nall unit checks passed');
process.exit(fails ? 1 : 0);
