// The app's front screen after Mumbai (organiser, 23 Nov 2026: "change app to Delhi
// 2027 and say Mumbai is over"), on the built worker: the date line thanks Mumbai
// and names Delhi, the words and buttons sell Delhi, the photo is Bharat Mandapam,
// Register shows the Delhi note instead of a Mumbai form, Book Booth goes to the
// Delhi booths, and the page script no longer writes the Mumbai description back.
// With MUMBAI_SALES_OPEN=1 (the pre-event suites) the old screen is untouched.
// Run after `npm run build`:  node scripts/verify/unit-app-after-mumbai.mjs
const ROOT = new URL('../../', import.meta.url);
const worker = (await import(new URL('dist/_worker.js?' + Date.now(), ROOT).href)).default;
const empty = { prepare() { const s = { bind() { return s; }, async first() { return null; }, async all() { return { results: [] }; }, async run() { return { meta: {} }; } }; return s; } };
const env = new Proxy({ SESSION_SECRET: 'x', DB: empty }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };
const get = async (path) => (await worker.fetch(new Request('https://bharataiinnovation.com' + path, { headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/128.0 Mobile' } }), env, ctx)).text();
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };

const saved = process.env.MUMBAI_SALES_OPEN;
delete process.env.MUMBAI_SALES_OPEN;
const app = await get('/app');
const hero = app.slice(app.indexOf('id="hero-band"'), app.indexOf('id="stats-section"'));
check('the date line thanks Mumbai and names Delhi', hero.includes('Thank you, Mumbai &middot; Next: Delhi, 28&ndash;29 July 2027') && !hero.includes('20&ndash;21 November 2026, World Trade Center Mumbai'), hero.slice(0, 600));
check('the words say Mumbai is over and where Delhi is', hero.includes('Mumbai 2026 is over.') && hero.includes('Bharat Mandapam, New Delhi, on 28 and 29 July 2027') && !hero.includes('Two days at WTC Mumbai'), 'desc');
check('the main button is a Delhi pass, the second Delhi 2027', hero.includes('href="/delhi-register?source=app-hero"') && hero.includes('Get your Delhi pass') && hero.includes('href="/delhi?from=app-hero"') && !hero.includes('/register?source=app-hero'), 'buttons');
check('someone from Mumbai is pointed to Log in', /Were you in Mumbai\? <button type="button" onclick="showRegistration\(\)"/.test(hero), 'log in line');
check('the photo is Bharat Mandapam, not the Data Science Congress stage', hero.includes('/images/delhi/mandapam-day.webp') && !hero.includes('earlier Data Science Congress'), 'photo');
check('the front screen is marked, so the script keeps these words', hero.includes('data-after="mumbai"'), 'data-after');
check('Register shows the Delhi note and hides the Mumbai form', app.includes('class="space-y-4 hidden reg-over"') && app.includes('#register-form.reg-over > :not(.reg-over-note)') && app.includes('href="/delhi-register?source=app-register"'), 'register');
check('Book Booth goes to the Delhi booths, in the menu and the footer', (app.match(/href="\/delhi-exhibit"[^>]*>Book Booth|<a href="\/delhi-exhibit">Book Booth/g) || []).length === 2 && !/href="\/inquiry"[^>]*>Book Booth/.test(app), 'book booth');
const passes = app.slice(app.indexOf('id="pass-comparison-section"'), app.indexOf('<!-- Exhibition & Inquiry Section -->'));
check('the pass section sells Delhi at its prices', passes.includes('Passes for Delhi 2027') && ['Rs 4,999', 'Rs 9,999', 'Rs 19,999', 'Rs 999'].every(p => passes.includes(p)) && passes.includes('href="/delhi-register?source=app-passes"'), passes.slice(0, 400));
check('no Mumbai pass, price rise or Mumbai checkout is left in it', !/Choose Your Pass|Prices went up|\/register\?source=app-passes|openPaidPassForm/.test(passes), 'old pass section');
check('Exhibit With Us names Delhi and opens the Delhi booths', app.includes('Show your AI on the floor at Bharat Mandapam, New Delhi') && app.includes('href="/delhi-exhibit?from=app"') && !app.includes('exhibition floor at WTC Mumbai'), 'exhibit card');
const js = await get('/app.js');
check('/app.js leaves the Delhi words alone', js.includes("!document.getElementById('hero-band').hasAttribute('data-after')) document.getElementById('event-desc').textContent = event.description"), 'script');

process.env.MUMBAI_SALES_OPEN = '1';
const before = await get('/app');
check('pre-event suites (MUMBAI_SALES_OPEN=1) still get the Mumbai screen', before.includes('20&ndash;21 November 2026, World Trade Center Mumbai') && before.includes('/register?source=app-hero') && !before.includes('reg-over-note') && !before.includes('data-after="mumbai"'), 'before');
check('... and the Mumbai passes and booths', before.includes('Choose Your Pass') && before.includes('/register?source=app-passes') && before.includes('exhibition floor at WTC Mumbai') && !before.includes('Passes for Delhi 2027'), 'before passes');
if (saved === undefined) delete process.env.MUMBAI_SALES_OPEN; else process.env.MUMBAI_SALES_OPEN = saved;

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
