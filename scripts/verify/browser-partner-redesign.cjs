// End to end: the redesigned /partner on a phone and a laptop in a real browser, through
// delhi-harness.mjs (the real worker on real SQLite, email played). No price or sentence of the older
// page lost by accident, each Enquire button carried into the form, an enquiry saved and the team told,
// every effect, animations off, and without the motion files. Run by run-all.mjs.
const fs = require('fs');
const path = require('path');
const { chromium } = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8817);
const ROOT = path.join(__dirname, '..', '..');
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const LAPTOP = { viewport: { width: 1366, height: 800 } };
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&rsquo;/g, '’').replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&rarr;/g, '→').replace(/&#8377;/g, '₹').replace(/&times;/g, '×').replace(/&copy;/g, '©');
const bodyOf = (html) => html.slice(html.indexOf('<body')).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');
const chunks = (html) => bodyOf(html).split(/<[^>]+>/).map((t) => decode(t).replace(/\s+/g, ' ').trim()).filter((t) => t.length > 1);
const flat = (html) => decode(bodyOf(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');

const open = async (ctx) => {
  const p = await ctx.newPage();
  p.errs = [];
  p.on('pageerror', (e) => p.errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/40\d|500/.test(m.text())) p.errs.push(m.text()); });
  await p.goto(BASE + '/partner', { waitUntil: 'networkidle' });
  await p.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; return document.fonts.ready; });
  await p.waitForTimeout(1200);
  return p;
};
const box = (p, sel) => p.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height }; }, sel);
const toEl = async (p, sel, gap = 60) => { await p.evaluate(([s, g]) => window.scrollTo(0, document.querySelector(s).getBoundingClientRect().top + scrollY - g), [sel, gap]); await p.waitForTimeout(650); };
const fits = (p) => p.evaluate(() => document.documentElement.scrollWidth <= 391);
// A section opens with an animation, and the machine may be busy: wait for its words, up to 5 s.
const opened = (p, sel, re) => p.waitForFunction(([s, r]) => new RegExp(r).test(document.querySelector(s).innerText), [sel, re.source], { timeout: 5000 }).then(() => true, () => false);
const barUp = (p) => p.locator('#pr-bar').evaluate((b) => b.classList.contains('is-up') && getComputedStyle(b).visibility === 'visible');
// Measured every frame: a moving effect is not an element, so it shows up in no list of elements.
const widest = (p, ms) => p.evaluate((t) => new Promise((done) => { let most = 0; const end = performance.now() + t; const tick = () => { most = Math.max(most, document.documentElement.scrollWidth); if (performance.now() < end) requestAnimationFrame(tick); else done(most); }; requestAnimationFrame(tick); }), ms);

(async () => {
  // ======== the source ========
  const old = read('docs/page-backups/partner-before-redesign-2026-11-06.html');
  const now = read('public/partner.html');
  const nowText = flat(now);
  // Each of these is a deliberate change, and the organiser is told about them.
  const meant = new Set([
    // Made shorter or corrected.
    'Sponsor', 'Bharat AI', 'Sponsor Bharat AI',
    'A true B2B business networking and business-outcome platform. Position your organisation at the forefront of India’s AI revolution — engage decision-makers directly, shape industry narratives, and drive real business outcomes.',
    'Ministers, CIOs, CTOs, and funded founders — the people who approve enterprise AI spending, in one room, for two days.',
    'Two ways in', 'Priced individually', 'Every option on this page is priced and listed on its own. Start from where you are.',
    'For companies selling AI, cloud, data or consulting into Indian enterprises and government — and for enterprises that want to be seen leading their sector’s AI shift.',
    'Partnership tiers', '— Title, Powered, Associate: ₹25 L to ₹1.2 Cr, with exclusivity',
    'AI Leadership Panel', '— curate your own CXO panel, ₹10 L',
    'Branding & activations', '— Leaders’ Evening, lanyards, launches, roundtables',
    'Your buyers in the room', '— complimentary VIP and delegate passes for the clients you want to close',
    'Buyers, investors and a stage — without a ₹25 L budget.',
    'Startup Pod', '— from', 'Innovation Stage', '— 8-minute main-stage slot, bundled with select booth packages',
    'Startup Pitch', '— pitch to VCs, angels and corporate venture arms',
    'Bharat AI Connect', '— AI matchmaking and 1:1 meetings with enterprise buyers, with a Delegate or VIP pass',
    'Innovation Partner', '— a custom package for accelerators and ecosystem players',
    'Title, Powered and Knowledge Partner are exclusive — one brand each. Associate Partner has 4 slots across sectors.',
    '1 Slot — Exclusive', '4 Slots — Sector-Specific',
    'Cloud, infrastructure, data-platform and AI-tooling companies — the technology the event visibly runs on.',
    'account-based marketing — ten named accounts, one room, ninety minutes.',
    'Non-cash and in-kind partnerships that extend the event’s reach — for technology providers, associations, incubators and publishers.',
    // Each button now names what it asks about.
    'Enquire — Title Partner', 'Enquire — Powered Partner', 'Enquire — Knowledge Partner', 'Enquire — Associate Partner', 'Enquire — Innovation Partner',
    'Enquire →', 'Enquire — Leaders Round Table →', 'Enquire — Leaders’ Evening Partner →', 'Enquire — Networking Lunch Partner →', 'Enquire — AI Partner →', 'Enquire — Lanyard →', 'Enquire — Conference Bag →', 'Enquire — Trophy Partner →', 'Enquire — Round Table →',
    // The numbers were not a sequence, and "B:" was a leftover.
    '01', '02', '03', '04', '05', '06', 'B: Open Stage',
    // Wrong: said the photos are of an event that has not happened yet.
    'A glimpse into the energy, conversations, and connections at Bharat AI Innovation',
    // The panel's section header, merged into one.
    'Lead the conversation. Own the stage. Drive real business outcomes.', 'Sponsorship Opportunity', 'AI Leadership Panel Discussion',
    'Position your organisation at the forefront of AI-led transformation. Engage directly with decision-makers, shape industry narratives, and drive real business outcomes.',
    // This block only repeated the two above it.
    'Panel Branding & Format', 'Leadership Panel Slot — alongside CXOs and policymakers', 'Curated by Your Organisation — define theme and lead conversations', 'Moderation Opportunity — your leadership team steers discussion', 'Powered by Your Brand — stage, agenda, and all communications',
    // Stale prices and the wrong address.
    '₹15,000 per pass', '₹5,000 per pass', 'partner@bharataiinnovation.com |', 'info@bharataiinnovation.com | Response within 24 hours',
    // Rewritten without a dash.
    'Existing clients — showcase success, unlock upsell opportunities', 'Prospective clients — initiate and accelerate sales conversations', 'Strategic partners — explore alliances and joint offerings', 'Policymakers — align with regulatory priorities', 'Media and analysts — build credibility and inbound interest',
    'CXOs — CTO, CIO, CMO, Chief Innovation & Product Officers',
    'Key Themes Include — or design your own custom panel',
    'Send us one message. We\'ll come back with a clear recommendation based on your goals — stage access, booth, branding, or a combination. Title and Powered Partner slots fill early; enterprise-tier decisions take time. Start the conversation now.',
    // Replaced by the form's own button, and the number is still on the page.
    '+91 89765 80367', 'Enquire About AI Leadership Panel',
  ]);
  const lost = [...new Set(chunks(old))].filter((c) => !nowText.includes(c) && !meant.has(c));
  check('every sentence of the older page is still on the page, or was meant to go', lost.length === 0, lost.join(' || '));
  for (const s of ['+91 89765 80367', 'Enquire About AI Leadership Panel', 'Lead the conversation. Own the stage. Drive real business outcomes.', 'Innovators’ Round Table', 'Registration & badge', 'Response within 24 hours']) check('the page still says: ' + s, nowText.includes(s));

  const tiers = (h) => [...h.matchAll(/<h3>([^<]+)<\/h3>[\s\S]{0,700}?<div class="tier-price">(.*?)<\/div>/g)].map((m) => m[1] + ' = ' + m[2]);
  const options = (h) => [...h.matchAll(/<h3>([^<]+)<\/h3>\s*<div class="option-price">(.*?)<\/div>/g)].map((m) => m[1] + ' = ' + m[2]);
  check('all five tiers keep their name and price', tiers(now).length === 5 && tiers(now).join('|') === tiers(old).join('|'), tiers(now).join('|'));
  check('all ten options keep their name and price', options(now).length === 10 && options(now).join('|') === options(old).join('|'), options(now).join('|'));
  check('the Startup Pod still shows its old price struck through', /&#8377;38,000<\/s> &#8377;48,000/.test(now));
  const llms = read('public/llms.txt');
  const priceOf = (name) => (llms.match(new RegExp('\\*\\*' + name + ' Pass\\*\\* — ₹([\\d,]+)')) || [])[1];
  check('the VIP pass worth matches the site\'s price list', !!priceOf('VIP') && now.includes('&#8377;' + priceOf('VIP') + ' + GST per pass'), priceOf('VIP'));
  check('the Delegate pass worth matches the site\'s price list', !!priceOf('Delegate') && now.includes('&#8377;' + priceOf('Delegate') + ' + GST per pass'), priceOf('Delegate'));
  check('no old tier names in what search engines read', !/Platinum|\bGold\b|\bSilver\b/.test(now.slice(0, now.indexOf('<body'))));
  check('no leftover "B: Open Stage"', !now.includes('B: Open Stage'));
  check('no photo is said to be from Bharat AI Innovation', !/alt="Bharat AI Innovation Conference"/.test(now) && !/alt="AI Leadership Panel"/.test(now) && /Data Science Congress, the predecessor to Bharat AI Innovation/.test(now));
  check('no government backing claim', !/backed by|supported by|government partner|endorsed by|under the aegis/i.test(flat(now)));
  check('sponsors write to the sponsorship address', /mailto:partner@bharataiinnovation\.com/.test(now));
  const chosen = [...now.matchAll(/data-enquire="([^"]+)"/g)].map((m) => m[1]);
  const offered = [...now.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
  check('every Enquire button has its line in the form', chosen.length >= 18 && chosen.every((c) => offered.includes(c)), chosen.filter((c) => !offered.includes(c)).join(','));
  check('every tier and option has an Enquire button', [...now.matchAll(/<h3>([^<]+)<\/h3>\s*(?:<p class="tier-subtitle"|<div class="option-price")/g)].every((m) => chosen.includes(decode(m[1]))));
  check('without the script, each button still reaches the sponsorship form', [...now.matchAll(/<a href="([^"]+)"[^>]*data-enquire=/g)].every((m) => m[1] === '/contact#sponsorship'));
  const strip = (h) => { const s = h.replace(/\r\n/g, '\n'); return s.slice(s.indexOf('<!-- exhibitors:start'), s.indexOf('<!-- exhibitors:end -->')); };
  check('the exhibitor strip is the same block the home page carries', strip(now).length > 1000 && strip(now) === strip(read('public/index.html')));
  check('the logo generator keeps this copy up to date', read('scripts/gen-exhibitor-logos.mjs').includes("fill('public/partner.html', home)"));
  check('the motion file carries the MIT notice', read('public/css/partner-motion.css').includes('Permission is hereby granted, free of charge'));
  check('the footer credits both libraries, which the free Skiper UI licence asks for', /pr-credit[\s\S]{0,120}skiper-ui\.com[\s\S]{0,160}VengeanceUI/.test(now));
  check('the older page is kept, with no motion in it', !old.includes('partner-motion') && !fs.existsSync(path.join(ROOT, 'public', 'docs')));
  check('no gradient text and no side stripe in the design', !/background-clip:\s*text/.test(read('public/css/partner-design.css')) && !/border-left:\s*[2-9]px/.test(read('public/css/partner-design.css')));

  const browser = await chromium.launch({ channel: 'msedge', headless: true });

  // ======== on a phone ========
  const phone = await browser.newContext(PHONE);
  let p = await open(phone);
  check('phone: the title reads whole', (await p.locator('h1').innerText()).replace(/\s+/g, ' ').trim() === 'Sponsor Bharat AI', await p.locator('h1').innerText());
  check('phone: the title is big and in the heading font', await p.evaluate(() => { const s = getComputedStyle(document.querySelector('h1 .pr-w > span')); return parseFloat(s.fontSize) >= 44 && /Bricolage/.test(s.fontFamily); }));
  check('phone: the heading font really loaded', await p.evaluate(() => document.fonts.check('800 40px "Bricolage Grotesque"')));
  check('phone: card names are not forced small', (await p.locator('.tier-card h3').first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize))) >= 24);
  check('phone: the date and place show at once', (await box(p, '.pr-hero-when')).bottom < 844);
  check('phone: the main button shows at once', (await box(p, '.pr-hero-actions .btn')).bottom < 844);
  check('phone: no broken pictures in view', await p.evaluate(() => [...document.querySelectorAll('.pr-hero img')].every((i) => i.complete && i.naturalWidth > 0)));
  const most = await widest(p, 1500);
  check('phone: no sideways scroll at the top', most <= 391, most);
  check('phone: the moving light in the hero runs', await p.evaluate(() => getComputedStyle(document.querySelector('.pr-aurora i')).animationName) !== 'none');
  check('phone: the exhibitor logos are on the page', (await p.locator('#exhibitors .exh-chip').count()) > 10);
  check('phone: no bar over the hero', !(await barUp(p)));

  // Cards
  check('phone: only the top tier starts open', (await p.locator('.tier-card details').evaluateAll((d) => d.map((x) => x.open).join(','))) === 'true,false,false,false,false');
  check('phone: each tier shows its price while closed', (await p.locator('.tier-card .tier-price').evaluateAll((e) => e.every((x) => x.getBoundingClientRect().height > 0))));
  const closedCard = (await box(p, '.tier-card:nth-child(2)')).h;
  check('phone: a closed tier is short', closedCard < 460, closedCard);
  await toEl(p, '.tier-card:nth-child(2)');
  await p.locator('.tier-card:nth-child(2) summary').tap();
  check('phone: tapping shows what is included', await opened(p, '.tier-card:nth-child(2)', /Keynote address, 15 min/));
  check('phone: each option shows its price while closed', await p.locator('.option-card .option-price').evaluateAll((e) => e.length === 10 && e.every((x) => x.getBoundingClientRect().height > 0)));
  check('phone: an option is short while closed', (await box(p, '.option-card:nth-child(2)')).h < 280, (await box(p, '.option-card:nth-child(2)')).h);
  await toEl(p, '.option-card:nth-child(3)');
  await p.locator('.option-card:nth-child(3) summary').tap();
  check('phone: an option opens to its deliverables and Best for', await opened(p, '.option-card:nth-child(3)', /Welcome toast[\s\S]*Best for:/));

  // Sub-menu and bar
  check('phone: the bar comes up after the hero', await barUp(p));
  const nav = await box(p, '#confSubnav');
  check('phone: the sub-menu stays at the top', Math.abs(nav.top) <= 2, nav.top);
  check('phone: it lights the section you are in', /Options/.test(await p.locator('.conf-subnav-link.active').innerText()));
  await toEl(p, '#ecosystem', 100);
  check('phone: and moves on with you', /Ecosystem/.test(await p.locator('.conf-subnav-link.active').innerText()), await p.locator('.conf-subnav-link.active').innerText());
  check('phone: its light sits under that link', await p.evaluate(() => { const l = document.querySelector('.conf-subnav-links'); const a = l.querySelector('.active'); return l.style.getPropertyValue('--pr-x') === a.offsetLeft + 'px'; }));

  // Stacked cards, the rows, the last heading
  await toEl(p, '.beyond-grid--stack', -500);
  await p.waitForTimeout(500);
  const stuck = await p.locator('.beyond-grid--stack .beyond-card').first().evaluate((e) => ({ pos: getComputedStyle(e).position, t: e.style.transform }));
  check('phone: the activations stack, and the one beneath shrinks', stuck.pos === 'sticky' && /scale/.test(stuck.t), JSON.stringify(stuck));
  check('phone: the numbers are gone from them', !(await p.locator('.beyond-number').count()));
  check('phone: the first panel row is open and the rest closed', (await p.locator('.pr-row').evaluateAll((d) => d.map((x) => x.open).join(','))) === 'true,false,false,false,false');
  await toEl(p, '.pr-row:nth-child(2)');
  await p.locator('.pr-row:nth-child(2) summary').tap();
  check('phone: a panel row opens', await opened(p, '.pr-row:nth-child(2)', /Logo across event agenda/));
  await toEl(p, '#enquire', 60);
  const last = await p.evaluate(() => { const h = document.querySelector('.pr-enquire h2'); return { label: h.getAttribute('aria-label'), text: h.textContent.replace(/\s+/g, ' ').trim(), p: h.style.getPropertyValue('--p') }; });
  check('phone: the last heading reads whole, to eye and screen reader', last.label === 'Not sure which tier fits?' && last.text === last.label, JSON.stringify(last));
  check('phone: its letters have gathered by the time it is read', last.p === '1.000', last.p);
  check('phone: the bar leaves at the form', !(await barUp(p)));
  const lapped = await widest(p, 5400);
  check('phone: the page never widens, frame by frame, for a lap of the button\'s light', lapped <= 391, lapped);
  check('phone: the light is drawn inside its own box', await p.evaluate(() => { const b = document.querySelector('.pr-submit .pr-beam'); return b && getComputedStyle(b).overflow === 'hidden'; }));
  const small = await p.evaluate(() => [...document.querySelectorAll('.pr-page .btn, .option-enquire, .pr-more > summary, .pr-row > summary, .pr-eco-item a, .pr-reach a, .pr-herolink, .pr-bar a, .conf-subnav-link, .pr-field input, .pr-field select')].filter((e) => { const r = e.getBoundingClientRect(); return r.height && r.height < 40; }).map((e) => e.textContent.trim().slice(0, 24)));
  check('phone: everything to tap is big enough', small.length === 0, small.join(','));
  await p.close();

  // An Enquire button, then the form, on the real worker
  p = await open(phone);
  await toEl(p, '.tier-card:nth-child(3)');
  await p.locator('.tier-card:nth-child(3) [data-enquire]').tap();
  await p.waitForTimeout(1200);
  check('phone: Enquire on a tier stays on this page', p.url().endsWith('/partner'), p.url());
  check('phone: the form already says which tier', (await p.inputValue('#pr-interest')) === 'Knowledge Partner', await p.inputValue('#pr-interest'));
  const sec = await box(p, '#enquire');
  check('phone: and is on the screen', sec.top < 200 && sec.bottom > 400, JSON.stringify(sec));
  await toEl(p, '.option-card:nth-child(7)');
  await p.locator('.option-card:nth-child(7) [data-enquire]').tap();
  await p.waitForTimeout(1200);
  check('phone: Enquire on an option does the same', (await p.inputValue('#pr-interest')) === 'Conference Bag', await p.inputValue('#pr-interest'));

  const send = () => p.locator('#pr-submit').tap();
  const says = async () => { await p.waitForTimeout(150); return p.locator('#pr-error').innerText(); };
  await send();
  check('form: no name is named, under the box', /your name/.test(await says()) && (await p.locator('#pr-name').getAttribute('aria-invalid')) === 'true');
  await p.fill('#pr-name', 'Test Sponsor');
  await send();
  check('form: no company is named', /your company/.test(await says()));
  await p.fill('#pr-company', 'Test Bank');
  await p.fill('#pr-email', 'not-an-email');
  await send();
  check('form: a bad email is named', /work email/.test(await says()));
  await p.fill('#pr-email', 'head@testbank.example');
  await p.fill('#pr-mobile', '12345');
  await send();
  check('form: a short mobile is named', /10 digits/.test(await says()));
  await p.fill('#pr-mobile', '+91 90000 00000');
  await p.fill('#pr-message', 'Reach CIOs in banking');
  const before = (await (await fetch(BASE + '/__inquiries')).json()).length;
  await send();
  await p.waitForSelector('#pr-done:not([hidden])', { timeout: 8000 }).catch(() => {});
  check('form: it thanks them and says where the reply goes', /Thank you, Test Sponsor/.test(await p.locator('#pr-done').innerText()) && /head@testbank\.example/.test(await p.locator('#pr-done').innerText()));
  check('form: the form is gone once sent', !(await p.locator('#pr-form').isVisible()));
  const rows = await (await fetch(BASE + '/__inquiries')).json();
  const row = rows[rows.length - 1] || {};
  check('form: one enquiry reached the database', rows.length === before + 1, rows.length - before);
  check('form: as a sponsorship enquiry', row.inquiry_type === 'sponsorship', row.inquiry_type);
  check('form: its subject names what they chose', row.subject === 'Sponsorship · Conference Bag', row.subject);
  check('form: with their details', row.name === 'Test Sponsor' && row.email === 'head@testbank.example' && row.organization === 'Test Bank' && row.phone === '+91 90000 00000', JSON.stringify(row));
  check('form: and their goals', /Interested in: Conference Bag/.test(row.message) && /Reach CIOs in banking/.test(row.message), row.message);
  const mail = await (await fetch(BASE + '/__mail')).json();
  check('form: the team is emailed', JSON.stringify(mail).includes('Conference Bag') || JSON.stringify(mail).includes('Test Sponsor'), JSON.stringify(mail).slice(0, 200));
  check('phone: no script errors', p.errs.length === 0, p.errs.join(' | '));
  await p.close();

  // A robot fills the hidden box; a failed send
  p = await open(phone);
  const countA = (await (await fetch(BASE + '/__inquiries')).json()).length;
  await p.fill('#pr-name', 'Robot'); await p.fill('#pr-company', 'Robot Co'); await p.fill('#pr-email', 'r@example.org'); await p.fill('#pr-mobile', '9000000000');
  await p.evaluate(() => { document.getElementById('pr-website').value = 'spam'; });
  await p.locator('#pr-submit').tap();
  await p.waitForTimeout(500);
  check('form: a robot sees thanks and nothing is saved', (await p.locator('#pr-done').isVisible()) && (await (await fetch(BASE + '/__inquiries')).json()).length === countA);
  await p.close();
  const down = await browser.newContext(PHONE);
  await down.route('**/api/inquiries', (r) => r.abort());
  p = await open(down);
  await p.fill('#pr-name', 'Test'); await p.fill('#pr-company', 'Co'); await p.fill('#pr-email', 't@example.org'); await p.fill('#pr-mobile', '9000000000');
  await p.locator('#pr-submit').tap();
  await p.waitForTimeout(600);
  const txt = await p.locator('#pr-error').innerText();
  check('form: no connection says so, with the number to call', /check your internet/.test(txt) && /89765 80367/.test(txt) && !/Failed to fetch/.test(txt), txt);
  check('form: what they typed stays, and the button works again', (await p.inputValue('#pr-name')) === 'Test' && !(await p.locator('#pr-submit').isDisabled()) && /Start the Conversation/.test(await p.locator('#pr-submit').innerText()));
  await p.close();
  await down.close();
  await phone.close();

  // ======== on a laptop ========
  const laptop = await browser.newContext(LAPTOP);
  p = await open(laptop);
  check('laptop: every card is open', await p.locator('details[data-fold]').evaluateAll((d) => d.length === 15 && d.every((x) => x.open)), await p.locator('details[data-fold]').count());
  check('laptop: with no button to open it', !(await p.locator('.tier-card summary').first().isVisible()));
  check('laptop: words and photo sit side by side in the hero', (await box(p, '.pr-hero-photo')).left > (await box(p, '.pr-hero h1')).left + 200);
  check('laptop: the top tier spreads across', (await box(p, '.tier-card.exclusive')).w > 1000);
  check('laptop: its pill keeps its own size', (await box(p, '.tier-badge')).w < 250, (await box(p, '.tier-badge')).w);
  check('laptop: its edge is turning', await p.evaluate(() => getComputedStyle(document.querySelector('.tier-card.exclusive'), '::before').animationName) !== 'none');
  check('laptop: three options in a row', await p.evaluate(() => { const c = [...document.querySelectorAll('.option-card')]; return c[0].getBoundingClientRect().top === c[2].getBoundingClientRect().top && c[0].getBoundingClientRect().top !== c[3].getBoundingClientRect().top; }));
  await toEl(p, '#options', 130);
  check('laptop: the sub-menu sits under the main menu', (await box(p, '#confSubnav')).top >= 55 && (await box(p, '#confSubnav')).top <= 90, (await box(p, '#confSubnav')).top);
  check('laptop: no bar', !(await p.locator('#pr-bar').isVisible()));
  await toEl(p, '.beyond-grid--stack', -200);
  check('laptop: the activations heading stays beside the cards', (await box(p, '.pr-stack-intro')).top < 200 && (await box(p, '.pr-stack-intro')).top > 60, (await box(p, '.pr-stack-intro')).top);
  check('laptop: no script errors', p.errs.length === 0, p.errs.join(' | '));
  await p.locator('.option-card:nth-child(1) a[href="#leadership-panel"]').click();
  await p.waitForTimeout(900);
  check('laptop: Full Deliverables goes to the panel\'s section', (await box(p, '#leadership-panel')).top < 400 && (await box(p, '#leadership-panel')).bottom > 400);
  await p.close();
  await laptop.close();

  // ======== animations off ========
  const calm = await browser.newContext({ ...PHONE, reducedMotion: 'reduce' });
  p = await open(calm);
  const still = await p.evaluate(() => ({
    title: getComputedStyle(document.querySelector('h1 .pr-w > span')).animationName,
    aurora: getComputedStyle(document.querySelector('.pr-aurora i')).animationName,
    split: document.querySelectorAll('.pr-split').length,
    letters: document.querySelectorAll('.pr-ch').length,
    beams: document.querySelectorAll('.pr-beam').length,
    sticky: getComputedStyle(document.querySelector('.beyond-card')).position,
  }));
  check('animations off: nothing moves', still.title === 'none' && still.aurora === 'none' && still.sticky === 'static', JSON.stringify(still));
  check('animations off: the script added nothing', still.split === 0 && still.letters === 0 && still.beams === 0, JSON.stringify(still));
  await toEl(p, '.tier-card:nth-child(2)');
  await p.locator('.tier-card:nth-child(2) [data-enquire]').tap();
  await p.waitForTimeout(500);
  check('animations off: Enquire still carries the choice', (await p.inputValue('#pr-interest')) === 'Powered Partner');
  check('animations off: no sideways scroll', await fits(p));
  await p.close();
  await calm.close();

  // ======== without the motion files ========
  const bare = await browser.newContext(PHONE);
  await bare.route(/partner-motion/, (r) => r.abort());
  p = await open(bare);
  check('without the motion files: every word stays', /Sponsor/.test(await p.locator('h1').innerText()) && /Not sure which tier fits\?/.test(await p.locator('#enquire').innerText()));
  await toEl(p, '.tier-card:nth-child(2)');
  await p.locator('.tier-card:nth-child(2) [data-enquire]').tap();
  await p.waitForTimeout(600);
  check('without the motion files: Enquire still carries the choice', (await p.inputValue('#pr-interest')) === 'Powered Partner');
  check('without the motion files: no sideways scroll', await fits(p));
  await p.close();
  await bare.close();

  await browser.close();
  console.log(fails ? `\n${fails} check(s) failed` : '\nall partner page checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
