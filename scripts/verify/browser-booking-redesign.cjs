// END TO END: the redesigned /register and /inquiry on a phone, a small phone and a laptop in a real
// browser, on the built worker on real SQLite (login-harness.mjs, email played). No wording of the older
// pages lost by accident, the first box on the first screen, the sliding choice with no script, every
// paid row reaching the paid form on the right pass, the amount and the button staying on the screen, a
// real free registration and a real booth enquiry, sizes drawn to scale, every effect, nothing widening a
// page frame by frame, animations off, without the motion files, and without any script at all.
// Run by run-all.mjs. pay-test.cjs, browser-already-registered.cjs and browser-price-rise.cjs also read
// /register; system-booking-journey.cjs carries a buyer and an exhibitor through to the organiser.
const fs = require('fs');
const path = require('path');
const { chromium } = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8844);
const ROOT = path.join(__dirname, '..', '..');
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const SMALL = { viewport: { width: 320, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const LAPTOP = { viewport: { width: 1366, height: 800 } };

const decode = (s) => s.replace(/&#x1[0-9a-f]{4};|&#x26A1;/gi, (m) => String.fromCodePoint(parseInt(m.slice(3, -1), 16))).replace(/&#160;/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&rsquo;/g, '’').replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&#x2014;/g, '—').replace(/&middot;/g, '·').replace(/&#8377;/g, '₹').replace(/&#x20B9;/g, '₹').replace(/&#10003;/g, '✓').replace(/&copy;/g, '©');
const bodyOf = (html) => html.slice(html.indexOf('<body')).replace(/\son\w+="[^"]*"/g, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '');
const chunks = (html) => bodyOf(html).split(/<[^>]+>/).map((t) => decode(t).replace(/\s+/g, ' ').trim()).filter((t) => t.length > 1);
const flat = (html) => decode(bodyOf(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');

const newCtx = async (browser, opts) => {
  const ctx = await browser.newContext({ ...opts, serviceWorkers: 'block' });
  await ctx.route((u) => !String(u).startsWith(BASE), (r) => r.abort());
  return ctx;
};
const open = async (ctx, url) => {
  const p = await ctx.newPage();
  p.errs = [];
  p.on('pageerror', (e) => p.errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/40\d|Failed to load|ERR_/.test(m.text())) p.errs.push(m.text()); });
  await p.goto(BASE + url, { waitUntil: 'load', timeout: 60000 });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(1100);
  return p;
};
const box = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height }; }, sel);
const shown = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && e.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true }); }, sel);
const toEl = async (p, sel, gap = 40) => { await p.evaluate(([s, g]) => { document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, document.querySelector(s).getBoundingClientRect().top + scrollY - g); }, [sel, gap]); await p.waitForTimeout(400); };
const widestFor = (p, ms = 5400) => p.evaluate((end) => new Promise((done) => { let most = 0; const stop = performance.now() + end; const tick = () => { most = Math.max(most, document.documentElement.scrollWidth); if (performance.now() < stop) requestAnimationFrame(tick); else done(most); }; requestAnimationFrame(tick); }), ms);
const lum = (rgb) => { const a = rgb.match(/[\d.]+/g).slice(0, 3).map((v) => { const c = Number(v) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const post = async (u, body) => (await fetch(BASE + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
const sql = (s, args = []) => post('/__sql', { sql: s, args });
// No visible words under 13px and nothing that can be pressed under 44px tall, apart from links inside a sentence.
const smallWords = (p, scope) => p.evaluate((sc) => [...document.querySelectorAll(sc + ' *')].filter((e) => {
  if (!e.getClientRects().length || getComputedStyle(e).visibility === 'hidden') return false;
  if (![...e.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim())) return false;
  return parseFloat(getComputedStyle(e).fontSize) < 12.9;
}).map((e) => e.tagName + ':' + e.textContent.trim().slice(0, 30)), scope);
const smallTargets = (p, scope) => p.evaluate((sc) => [...document.querySelectorAll(sc + ' button, ' + sc + ' input:not(.rg-sr), ' + sc + ' select, ' + sc + ' textarea, ' + sc + ' summary, ' + sc + ' label[for^="rg-view"]')].filter((e) => {
  if (!e.getClientRects().length) return false;
  return e.getBoundingClientRect().height < 43.5 && !e.closest('.bk-unsure');
}).map((e) => (e.id || e.tagName) + ':' + Math.round(e.getBoundingClientRect().height)), scope);
const fillFree = async (p, email, mobile) => {
  // Paid passes come first (13 Nov 2026): on a phone the free form is one tap away.
  if (!(await shown(p, '#rf-name')) && await shown(p, '.rg-switch')) { await p.tap('.rg-switch label[for="rg-view-free"]'); await p.waitForTimeout(400); }
  await p.fill('#rf-name', 'Asha Rao');
  await p.fill('#rf-email', email);
  await p.fill('#rf-phone', mobile);
  await p.fill('#rf-company', 'Rao Labs');
  await p.fill('#rf-title', 'Founder');
  await p.fill('#rf-city', 'Pune');
  await p.selectOption('#rf-industry', 'Software & SaaS');
};

(async () => {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(BASE + '/api/events/1')).ok; } catch {} if (!up) await sleep(500); }
  if (!up) { console.log('FAIL the harness never came up'); process.exit(1); }
  const cfg = await (await fetch(BASE + '/api/payments/config')).json();
  if (!cfg.late) { console.log('FAIL this suite needs the clock past 5 Nov 2026'); process.exit(1); }

  // ======== nothing lost from the older pages, except what was meant to go ========
  const read = (f) => fs.readFileSync(path.join(ROOT, 'docs', 'page-backups', f), 'utf8');
  const oldReg = read('register-before-redesign-2026-11-06.html');
  const oldInq = read('inquiry-before-redesign-2026-11-06.html');
  const nowReg = await (await fetch(BASE + '/register')).text();
  const nowInq = await (await fetch(BASE + '/inquiry')).text();
  // Each of these is a deliberate change, and the organiser is told about them.
  const APP_BAR = ['Home', 'Conference Schedule', 'Passes', 'Register', 'Book Booth', 'AI Market', 'Contact', 'Main Site', 'Log In'];
  const STAR_LABELS_REG = ['Full Name *', 'Email Address *', 'Mobile Number *', 'Organization *', 'Designation / Job Title *', 'City *', 'Industry *', 'Email', 'Mobile *', 'Designation *', 'Full Name', '*'];
  const meantReg = new Set([
    ...APP_BAR, ...STAR_LABELS_REG,
    // The h1 now says what to do; the title of the page still says Passes & Registration.
    'Passes and registration for Bharat AI Innovation 2026',
    // Plainer words on the free button.
    'Register — It\'s Free!',
    // A heading without the dash, with the words kept.
    'Visitor Pass — FREE',
    // Each row is a button of its own now, which opens the form on that pass.
    'Get Paid Pass', '🎟️ Delegate Pass', '🛠️ Premium Delegate', '⭐ VIP Pass', '🎓 Academic Pass',
    // On a pass card, the price and "+ GST" are now two parts.
    '+ GST',
    // 13 Nov 2026, the organiser: stop promoting the free pass. The hero line leads with the Delegate Pass.
    'Take a free Visitor Pass for the exhibition floor, or a Delegate Pass for every session, the networking lunch, the networking app and guaranteed entry on both days.',
  ]);
  // 12 Nov 2026: workshops come with the Student Pass too, so these two sentences name it.
  const meantRegRe = [/Included in the Premium Delegate and VIP passes\./, /A workshop comes only with Premium Delegate and VIP/, /Conference \+ student zone, with a student or faculty ID/, /^Exhibition floor and product demos$/, /five passes for the price of four/i, /^Ask for a group rate$/, /Delegation discounts/, /The Academic Pass needs a valid student or faculty ID/];
  const lostReg = [...new Set(chunks(oldReg))].filter((c) => !flat(nowReg).includes(c) && !meantReg.has(c) && !meantRegRe.some((re) => re.test(c)));
  check('/register: every sentence of the older page is still on the page, or was meant to go', lostReg.length === 0, lostReg.join(' || '));
  const meantInq = new Set([
    ...APP_BAR, 'Full Name',
    // Labels without the star; optional ones say so.
    'Booth Type *', 'Preferred Zone', 'Contact Person *', 'Email Address *', 'Phone Number *', 'Company / Organization *', 'Designation', 'Website', 'Industry / Domain', 'Products / Solutions to Showcase', 'Special Requirements / Questions',
    // Zones that are nowhere else on the site; the list is now /exhibition's eight.
    'Main Hall', 'Innovation Hub', 'Startup Alley', 'Enterprise Zone',
    // Claims nothing on the site supports, and exhibitor counts the organiser does not want printed.
    '10,000+', 'Expected Visitors', '200+', 'Exhibitors', '50+', 'Countries', '2 Days', 'Full Access', 'Why Exhibit at BHAI 2026?',
    // /exhibition gives each size its own number; Wi-Fi is promised nowhere else, and the organiser is asked.
    '2 exhibitor badges per booth', 'Electricity & Wi-Fi access',
    // "Enquiry", as on /exhibition and /partner.
    'Booth Inquiry Form', 'Submit Booth Inquiry', 'Booth Inquiry Submitted!',
    // Headline and hero in new words; the facts stay in the sentence.
    'Book Your Exhibition Booth', 'Showcase your AI products & solutions on the exhibition floor — World Trade Center, Mumbai | 20-21 Nov 2026',
    // The site itself: the menu's Home goes there now.
    'bharataiinnovation.com',
    // How Cloudflare hides the address in the copy of the live page; the address is still on the page.
    '[email protected]',
    // Emoji went from the package names, and the sizes moved beside each other.
    '🚀 Startup Pod', '🔍 Explorer Booth', '💡 Innovator Booth', '⚡ Accelerator Booth', '🏢 Enterprise Booth', '🏛 Flagship Pavilion', '👑 Mega Pavilion',
    '1.5 x 1.5 m (2.25 sqm)', '2 x 2 m (4 sqm)', '3 x 2 m (6 sqm)', '3 x 3 m (9 sqm)', '4 x 2 m (8 sqm)', '6 x 2 m (12 sqm)', '7 x 7.7 m (53.90 sqm)',
    '₹38,000', '₹48,000', '₹1,29,000', '₹1,95,000', '₹2,91,000', '₹2,58,000', '₹3,87,000', '₹17,40,000',
    // 12 Nov 2026: the booth form became an application (the organiser's words); the industry
    // asked is the one they sell to, from the passes' list; the reply is promised in 2 working days.
    'Select a booth package or fill in details below', 'Select industry',
    'Artificial Intelligence / Machine Learning', 'IT / Software', 'Healthcare / MedTech', 'FinTech / Banking', 'EdTech / Education', 'Manufacturing / Industry 4.0',
    'AgriTech / Agriculture', 'Defense / Aerospace', 'Retail / E-commerce', 'Government / Public Sector', 'Telecom / IoT', 'Automotive / EV', 'Energy / CleanTech', 'Logistics / Supply Chain',
    'Our team will respond within 24 hours with booth availability and next steps.',
    'Thank you for your interest in exhibiting at Bharat AI Innovation 2026. Our exhibition team will review your request and contact you within 24 hours.',
  ]);
  const lostInq = [...new Set(chunks(oldInq))].filter((c) => !flat(nowInq).includes(c) && !meantInq.has(c));
  check('/inquiry: every sentence of the older page is still on the page, or was meant to go', lostInq.length === 0, lostInq.join(' || '));
  check('the copies of the older pages are kept', oldReg.includes('Passes and registration for Bharat AI Innovation 2026') && oldInq.includes('Why Exhibit at BHAI 2026?'));
  for (const size of ['1.5 x 1.5 m', '2 x 2 m', '3 x 2 m', '3 x 3 m', '4 x 2 m', '6 x 2 m', '7 x 7.7 m']) check('/inquiry still prints the size ' + size, flat(nowInq).includes(size));
  for (const price of ['₹38,000', '₹48,000', '₹1,29,000', '₹1,95,000', '₹2,91,000', '₹2,58,000', '₹3,87,000', '₹17,40,000']) check('/inquiry still prints the price ' + price, flat(nowInq).includes(price));
  const strip = (h) => flat(h.replace(/<div class="pcmp">[\s\S]*?<\/table>\s*<\/div>/, '').replace(/<footer[\s\S]*?<\/footer>/, '').replace(/<select[\s\S]*?<\/select>/g, ''));
  check('no em dash in what the two pages say, outside the shared chart and the lists', !strip(nowReg).includes('—') && !strip(nowInq).includes('—'), 'em dash');

  const browser = await chromium.launch({ channel: 'msedge', headless: true });

  // ======== /register on a phone ========
  const phone = await newCtx(browser, PHONE);
  let p = await open(phone, '/register');
  check('phone: the title reads whole, the only h1, big and in the heading font', (await p.getAttribute('h1', 'aria-label')) === 'Register for Bharat AI Innovation 2026' && (await p.locator('h1').innerText()).replace(/\s+/g, ' ').trim() === 'Register for Bharat AI Innovation 2026' && (await p.locator('h1').count()) === 1 && await p.evaluate(() => { const s = getComputedStyle(document.querySelector('.ps-w--big > span')); return parseFloat(s.fontSize) >= 56 && /Bricolage/.test(s.fontFamily); }));
  check('phone: says prices went up', /PRICES WENT UP ON 6 NOV/.test(await p.locator('.ps-tag').innerText()));
  check('phone: the paid passes start on the first screen', (await box(p, '.rg-offer')).top < 700, JSON.stringify(await box(p, '.rg-offer')));
  check('phone: Log In and the site\'s menu', (await box(p, '.ps-login')).right <= 390 && (await p.locator('.ps-nav a').count()) === 14 && (await p.locator('.ps-nav a[aria-current="page"]').innerText()) === 'Passes');
  check('phone: paid is chosen, the free form waits behind the switch', await shown(p, '.rg-switch') && await shown(p, '.rg-tier') && !(await shown(p, '#rf-name')));
  check('phone: the switch says the difference in two words each', /Free Visitor Pass\s*Entry by time slot/.test(await p.locator('.rg-switch label[for="rg-view-free"]').innerText()) && /Paid pass\s*Guaranteed entry/.test(await p.locator('.rg-switch label[for="rg-view-paid"]').innerText()));
  const glider = () => p.evaluate(() => { const g = document.querySelector('.rg-glider').getBoundingClientRect(); const c = document.querySelector('.rg-switch').getBoundingClientRect(); return (g.left + g.width / 2 - c.left) / c.width; });
  check('phone: the glider sits on the paid side, which comes first', (await glider()) < 0.5 && await p.evaluate(() => document.querySelector('.rg-switch label').htmlFor === 'rg-view-paid'), await glider());
  await p.waitForTimeout(600);
  check('phone: all five paid passes are there', (await p.locator('.rg-tier').count()) === 5);
  check('phone: every row has settled, nothing left half faded', await p.evaluate(() => [...document.querySelectorAll('.rg-tiers li')].every((l) => getComputedStyle(l).opacity === '1')));
  for (const [hash, pass, was, is] of [['delegate', 'Delegate Pass', '₹4,999', '₹8,999'], ['premium', 'Premium Delegate Pass', '₹9,999', '₹14,999'], ['vip', 'VIP Pass', '₹19,999', '₹24,999'], ['academic', 'Academic Pass', '₹999', '₹3,999']]) {
    const row = p.locator(`.rg-tier[href="#${hash}"]`);
    const r = await row.evaluate((a) => { const s = a.querySelector('s'); return { was: s.textContent.trim(), line: getComputedStyle(s).textDecorationLine, text: a.querySelector('.rg-tier-price').textContent.replace(/\s+/g, ' ').trim() }; });
    check('phone: ' + pass + ' shows ' + was + ' struck through and ' + is + ' + GST', r.was === was && r.line.includes('line-through') && r.text === `${was} ${is} + GST`, JSON.stringify(r));
    await row.tap();
    await p.waitForTimeout(450);
    const f = await p.evaluate(() => ({ shown: !document.getElementById('reg-paid-pass-modal').classList.contains('hidden'), pass: document.getElementById('rpp-pass-type').value, hash: location.hash, ticked: document.querySelector('input[name="rpp-pass"]:checked')?.value }));
    check('phone: pressing it opens the paid form on ' + pass, f.shown && f.pass === pass && f.ticked === pass, JSON.stringify(f));
    await p.waitForFunction((want) => (document.getElementById('rpp-total').textContent || '').includes(want), is.slice(1), { timeout: 5000 }).catch(() => {});
    check('phone: and says the whole amount with GST, on the screen, before anything else', (await p.textContent('#rpp-total')).includes(is.replace('₹', '')) && (await box(p, '#rpp-total')).bottom < 844, await p.textContent('#rpp-total'));
    await p.tap('.rg-sheet-x');
    await p.waitForTimeout(150);
    check('phone: the close button closes it, and the page is scrollable again', await p.evaluate(() => document.getElementById('reg-paid-pass-modal').classList.contains('hidden') && document.body.style.overflow === ''));
  }
  await p.tap('.rg-switch label[for="rg-view-free"]');
  await p.waitForTimeout(900);
  check('phone: tapping Free slides the glider across', (await glider()) > 0.5, await glider());
  check('phone: and swaps the paid passes for the form', await shown(p, '#rf-name') && !(await shown(p, '.rg-tier')));

  // The badge
  check('phone: the form wears the badge\'s slot and says how long it takes', await shown(p, '.rg-badge .ps-slot') && (await p.textContent('#rg-who')) === 'Register in 30 seconds');
  await p.fill('#rf-name', 'Asha Rao');
  check('phone: the name goes on the badge as it is typed', (await p.textContent('#rg-who')) === 'Asha Rao');
  await p.fill('#rf-name', 'Bhagyalakshmi Venkatasubramanian Raghunathan Iyengar of Thiruvananthapuram');
  const long = await p.evaluate(() => { const w = document.getElementById('rg-who'); const c = document.querySelector('.rg-badge'); return { in: w.getBoundingClientRect().right <= c.getBoundingClientRect().right, h: w.getBoundingClientRect().height, page: document.documentElement.scrollWidth }; });
  check('phone: a very long name stays on one line and on the badge', long.in && long.h < 26 && long.page <= 390, JSON.stringify(long));
  await p.fill('#rf-name', '<img src=x onerror=window.__bad=1>');
  check('phone: a script typed as a name stays words', (await p.textContent('#rg-who')).includes('<img') && !(await p.evaluate(() => window.__bad)));
  await p.fill('#rf-name', '');
  check('phone: emptied, the badge goes back to its first words', (await p.textContent('#rg-who')) === 'Register in 30 seconds');

  // The boxes
  const looks = await p.evaluate(() => {
    const s = getComputedStyle(document.getElementById('rf-industry'));
    const i = getComputedStyle(document.getElementById('rf-email'));
    return { arrow: s.backgroundImage, size: i.fontSize, border: i.borderTopWidth, placeholder: getComputedStyle(document.getElementById('rf-email'), '::placeholder').color };
  });
  check('phone: a list looks like a list again (the theme wiped its arrow)', /svg/.test(looks.arrow), looks.arrow);
  check('phone: boxes are 16px, so an iPhone does not zoom in, with a real edge', looks.size === '16px' && parseFloat(looks.border) >= 1, JSON.stringify(looks));
  check('phone: the hint in a box can be read', contrast(looks.placeholder, 'rgb(255,255,255)') >= 4.5, looks.placeholder);
  await p.tap('#rf-email');
  await p.keyboard.type('not-an-email');
  await p.locator('#rf-phone').focus();
  await p.waitForTimeout(300);
  check('phone: a wrong email gets a red edge once they leave the box', await p.evaluate(() => getComputedStyle(document.getElementById('rf-email')).borderTopColor === 'rgb(179, 38, 30)'), await p.evaluate(() => getComputedStyle(document.getElementById('rf-email')).borderTopColor));
  await p.fill('#rf-email', 'asha.phone@example.com');
  await p.locator('#rf-phone').focus();
  await p.waitForTimeout(100);
  check('phone: a right one gets a tick', /svg/.test(await p.evaluate(() => getComputedStyle(document.getElementById('rf-email')).backgroundImage)));
  check('phone: LinkedIn and interests are folded, and it says they are optional', !(await shown(p, '#rf-linkedin')) && /optional/.test(await p.textContent('#rf-more summary')));
  await p.tap('#rf-more summary');
  await p.waitForTimeout(450);
  check('phone: tapped, they open', await shown(p, '#rf-linkedin') && (await box(p, '#rf-linkedin')).h >= 44);
  await p.tap('#rf-more summary');
  await p.waitForTimeout(450);
  check('phone: no small words in the form', (await smallWords(p, '.rg-free')).length === 0, (await smallWords(p, '.rg-free')).join());
  check('phone: every box and button can be tapped', (await smallTargets(p, '.rg-book')).length === 0, (await smallTargets(p, '.rg-book')).join());
  const cta = await p.evaluate(() => { const s = getComputedStyle(document.getElementById('rf-submit')); return { bg: s.backgroundColor, color: s.color }; });
  check('phone: the button can be read', contrast(cta.bg, cta.color) >= 4.5, JSON.stringify(cta));
  // Typed in the free form, then chooses a paid pass.
  await p.fill('#rf-name', 'Asha Rao');
  await p.fill('#rf-company', 'Rao Labs');
  await p.tap('.rg-switch label[for="rg-view-paid"]');
  await p.waitForTimeout(300);
  await p.tap('.rg-tier[href="#vip"]');
  await p.waitForTimeout(400);
  check('phone: what was typed comes with them to the paid form', (await p.inputValue('#rpp-name')) === 'Asha Rao' && (await p.inputValue('#rpp-company')) === 'Rao Labs' && (await p.inputValue('#rpp-pass-type')) === 'VIP Pass');
  // The sheet
  const sheet = await p.evaluate(() => { const b = document.querySelector('.rg-sheet-body'); const pay = document.querySelector('.rg-pay').getBoundingClientRect(); const s = document.querySelector('.rg-sheet').getBoundingClientRect(); return { payBottom: pay.bottom, sheetBottom: s.bottom, sheetTop: s.top, scrolls: b.scrollHeight > b.clientHeight }; });
  check('phone: the paid form is a sheet from the foot of the screen, on the screen', Math.abs(sheet.sheetBottom - 844) < 2 && sheet.sheetTop >= 0, JSON.stringify(sheet));
  check('phone: the amount and the button sit at the very foot, with nothing showing under them', Math.abs(sheet.payBottom - sheet.sheetBottom) < 2, JSON.stringify(sheet));
  await p.evaluate(() => { const b = document.querySelector('.rg-sheet-body'); b.scrollTop = 260; });
  await p.waitForTimeout(150);
  const still = await box(p, '#rpp-submit-btn');
  check('phone: scrolling the boxes, the button stays on the screen', still.bottom < 844 && still.top > 500, JSON.stringify(still));
  await p.tap('input[name="rpp-pass"][value="Academic Pass"] + div', { force: true }).catch(async () => { await p.evaluate(() => document.querySelector('input[name="rpp-pass"][value="Academic Pass"]').click()); });
  await p.waitForTimeout(150);
  check('phone: Academic asks for a college, no designation, and City takes the row', (await p.textContent('#rpp-company-label')) === 'College name' && !(await shown(p, '#rpp-designation')) && (await box(p, '#rpp-city')).w > 300);
  await p.evaluate(() => document.querySelector('input[name="rpp-pass"][value="Delegate Pass"]').click());
  await p.waitForTimeout(150);
  check('phone: back on Delegate, the designation returns', (await p.textContent('#rpp-company-label')) === 'Organization' && await shown(p, '#rpp-designation'));
  await p.keyboard.press('Escape');
  check('phone: Escape closes it', await p.evaluate(() => document.getElementById('reg-paid-pass-modal').classList.contains('hidden')));
  await p.evaluate(() => openRegisterPaidPassModal());
  await p.mouse.click(195, 5);
  check('phone: a press outside closes it, and what was typed stays', await p.evaluate(() => document.getElementById('reg-paid-pass-modal').classList.contains('hidden') && document.getElementById('rpp-name').value === 'Asha Rao'));
  check('phone: no page errors so far', p.errs.length === 0, p.errs.join(' | '));
  await p.close();

  // A link straight to a pass
  p = await open(phone, '/register#premium');
  check('phone: /register#premium opens the paid form on it', await p.evaluate(() => !document.getElementById('reg-paid-pass-modal').classList.contains('hidden')) && (await p.inputValue('#rpp-pass-type')) === 'Premium Delegate Pass');
  await p.tap('.rg-sheet-x');
  await p.waitForTimeout(200);
  check('phone: closing it leaves them among the paid passes, which is what they came for', await shown(p, '.rg-tier') && !(await shown(p, '#rf-name')));
  await p.close();

  // A free-pass link opens on the free form
  p = await open(phone, '/register?source=home-hero-free');
  check('phone: a link that asked for the free pass opens on the free form', await shown(p, '#rf-name') && !(await shown(p, '.rg-tier')));
  await p.close();

  // A real free registration
  p = await open(phone, '/register?source=browser-booking');
  await fillFree(p, 'asha.free@example.com', '9820066666');
  await p.tap('#rf-submit');
  await p.waitForFunction(() => { const s = document.getElementById('reg-success'); return s && !s.classList.contains('hidden'); }, null, { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(700);
  const free = (await sql('SELECT * FROM attendees WHERE email = ?', ['asha.free@example.com']))[0];
  check('phone: a real registration, with the folded boxes never opened', free && free.badge_type === 'Visitor Pass' && free.registration_source === 'browser-booking', JSON.stringify(free));
  const afterFree = await p.evaluate(() => { const vis = (s) => document.querySelector(s).checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true }); return { success: vis('#reg-success'), sw: vis('.rg-switch'), tier: vis('.rg-tier'), visitor: vis('.rg-visitor'), form: vis('#reg-form'), paidChosen: document.getElementById('rg-view-paid').checked, modal: !document.getElementById('reg-paid-pass-modal').classList.contains('hidden'), hidden: document.getElementById('reg-success').className, url: location.href, width: innerWidth }; });
  check('phone: the success screen, with nothing else competing', afterFree.success && !afterFree.sw && !afterFree.tier && !afterFree.visitor && !afterFree.form, JSON.stringify(afterFree));
  const after = await p.evaluate(() => { const hero = getComputedStyle(document.querySelector('.rs-hero')); const main = getComputedStyle(document.querySelector('.rs-btn-main')); return { hero: hero.backgroundColor, heroText: hero.color, main: main.backgroundColor, mainText: main.color }; });
  check('phone: its orange blocks can be read', contrast(after.hero, after.heroText) >= 4.5 && contrast(after.main, after.mainText) >= 4.5, JSON.stringify(after));
  await p.locator('#reg-success a:has-text("Upgrade to Delegate")').tap();
  await p.waitForTimeout(400);
  check('phone: Upgrade to Delegate opens the paid form, filled in', await p.evaluate(() => !document.getElementById('reg-paid-pass-modal').classList.contains('hidden')) && (await p.inputValue('#rpp-email')) === 'asha.free@example.com');
  check('phone: no page errors there', p.errs.length === 0, p.errs.join(' | '));
  await p.close();

  // The same email again, on another phone: the first is signed in as this person by now.
  const other = await newCtx(browser, PHONE);
  p = await open(other, '/register');
  await fillFree(p, 'asha.free@example.com', '9820077777');
  await p.tap('#rf-submit');
  await p.waitForFunction(() => !document.getElementById('rf-notice').classList.contains('hidden'), null, { timeout: 15000 }).catch(() => {});
  check('phone: the same email again: a lasting notice with the way to sign in, button in its new words', /Sign in here/.test(await p.textContent('#rf-notice')) && /Register free/.test(await p.textContent('#rf-submit')) && await shown(p, '#rf-notice'));
  await p.close();
  await other.close();

  // The rest of the page
  p = await open(phone, '/register');
  await toEl(p, '#compare', 40);
  await p.waitForTimeout(800);
  const split = await p.evaluate(() => { const h = document.querySelector('#compare .ps-h2'); return { split: h.classList.contains('ps-split'), text: h.textContent.replace(/\s+/g, ' ').trim(), span: getComputedStyle(h.querySelector('.ps-word-mask > span')).transform }; });
  check('phone: the heading\'s words rise in, and read whole', split.split && split.text === 'Compare passes' && (split.span === 'none' || split.span === 'matrix(1, 0, 0, 1, 0, 0)'), JSON.stringify(split));
  const bar = await box(p, '.ps-bar');
  check('phone: the Delegate bar comes up among the comparison, on the screen', bar && bar.bottom <= 845 && bar.top > 700, JSON.stringify(bar));
  await p.tap('.ps-bar .ps-buy');
  await p.waitForTimeout(300);
  check('phone: and its button opens the paid form on Delegate', (await p.inputValue('#rpp-pass-type')) === 'Delegate Pass' && await p.evaluate(() => !document.getElementById('reg-paid-pass-modal').classList.contains('hidden')));
  await p.tap('.rg-sheet-x');
  await toEl(p, '.ps-end-title', 400);
  await p.waitForTimeout(300);
  const barEnd = await box(p, '.ps-bar');
  check('phone: the bar has gone by the last button', !barEnd || barEnd.top > 844 || barEnd.bottom < (await box(p, '.ps-end')).top + 2, JSON.stringify(barEnd));
  await toEl(p, '.ps-end-title', 200);
  await p.waitForTimeout(300);
  const gathered = await p.evaluate(() => ({ p: getComputedStyle(document.querySelector('.ps-end-title')).getPropertyValue('--p').trim(), label: document.querySelector('.ps-end-title').getAttribute('aria-label') }));
  check('phone: Skiper 31: the last heading\'s letters have gathered by the time it is read', Number(gathered.p) === 1 && gathered.label === 'See you at WTC Mumbai', JSON.stringify(gathered));
  check('phone: Border Beam on the last button, which still takes a press', await p.evaluate(() => { const b = document.querySelector('.ps-end .ps-buy'), r = b.getBoundingClientRect(); return !!b.querySelector('.ps-beam') && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2).closest('.ps-buy') === b; }));
  check('phone: Visitor link in the last section goes back to the free form', await p.evaluate(() => { const a = document.querySelector('.ps-end a[href="#rg-book"]'); document.getElementById('rg-view-paid').checked = true; a.click(); return document.getElementById('rg-view-free').checked; }));
  check('phone: the credit is in the open', /Motion effects from Skiper UI and Vengeance UI, and small details after Uiverse\./.test(await p.locator('.ps-credit').innerText()));
  await p.evaluate(() => window.scrollTo(0, 0));
  check('phone: nothing widens the page, frame by frame, for a whole lap of the moving light', (await widestFor(p)) <= 390, 'wider');
  await p.close();

  // ======== /inquiry on a phone ========
  p = await open(phone, '/inquiry');
  check('phone, /inquiry: the title reads whole, the only h1', (await p.locator('h1').innerText()).replace(/\s+/g, ' ').trim() === 'Book your exhibition booth' && (await p.locator('h1').count()) === 1);
  check('phone, /inquiry: Exhibition is marked in the site\'s menu', (await p.locator('.ps-nav a[aria-current="page"]').innerText()) === 'Exhibition');
  check('phone, /inquiry: says the lowest price at once', /Booths from ₹48,000 \+ GST\./.test(await p.locator('.ps-sub').innerText()) && (await box(p, '.ps-sub strong')).bottom < 844);
  check('phone, /inquiry: all seven in the hero and seven cards', (await p.locator('.bk-foot').count()) === 7 && (await p.locator('.bk-pkg').count()) === 7);
  // Drawn to scale: measure the real thing.
  const scale = await p.evaluate(() => {
    const m = (sel) => [...document.querySelectorAll(sel)].map((e) => { const r = e.getBoundingClientRect(); return [r.width, r.height]; });
    return { feet: m('.bk-foot'), plans: m('.bk-pkg .bk-plan i') };
  });
  const METRES = [[1.5, 1.5], [2, 2], [3, 2], [3, 3], [4, 2], [6, 2], [7, 7.7]];
  const scaled = (list) => { const u = list[0][0] / 1.5; return list.every(([w, h], i) => Math.abs(w / u - METRES[i][0]) < 0.08 && Math.abs(h / u - METRES[i][1]) < 0.08); };
  check('phone, /inquiry: the hero\'s drawings are really to scale', scaled(scale.feet), JSON.stringify(scale.feet));
  check('phone, /inquiry: and so are the cards\', at one scale across them', scaled(scale.plans), JSON.stringify(scale.plans));
  check('phone, /inquiry: the biggest drawing stays inside its square', await p.evaluate(() => { const plan = [...document.querySelectorAll('.bk-pkg .bk-plan')].pop().getBoundingClientRect(), i = [...document.querySelectorAll('.bk-pkg .bk-plan i')].pop().getBoundingClientRect(); return i.top >= plan.top && i.right <= plan.right; }));
  check('phone, /inquiry: Accelerator is marked Popular, as on /exhibition', (await p.locator('.bk-pkg .bk-pkg-pop').count()) === 1 && /Accelerator/.test(await p.locator('.bk-pkg:has(.bk-pkg-pop)').innerText()));
  check('phone, /inquiry: each card can be read at a glance', /1 exhibitor pass · 8-min talk/.test(await p.locator('.bk-pkg').first().innerText()));
  check('phone, /inquiry: nothing chosen yet', (await p.locator('.bk-pkg.is-on').count()) === 0 && !(await shown(p, '#iq-price-summary')));
  await p.locator('.bk-pkg').nth(3).tap();
  await p.waitForTimeout(900);
  check('phone, /inquiry: tapping a size chooses it in the form', (await p.inputValue('#iq-booth-type')) === 'Accelerator Booth - 3x3m - Rs.2,91,000');
  check('phone, /inquiry: its card and its drawing are lit, and no other', (await p.locator('.bk-pkg.is-on').count()) === 1 && (await p.locator('.bk-foot.is-on').count()) === 1 && (await p.locator('.bk-pkg').nth(3).getAttribute('aria-pressed')) === 'true');
  const form = await box(p, '#inquiry-form-card');
  check('phone, /inquiry: the page goes to the form', form.top >= -2 && form.top < 120, JSON.stringify(form));
  check('phone, /inquiry: the summary says the booth, what comes with it and the price', /Accelerator Booth \(3 x 3 m\)/.test(await p.textContent('#iq-summary-type')) && /9 sqm · 5 exhibitor passes · 20-minute talk on stage/.test(await p.textContent('#iq-summary-more')) && /₹2,91,000 \+ GST/.test(await p.textContent('#iq-summary-price')) && await shown(p, '#iq-price-summary'));
  await p.selectOption('#iq-booth-type', 'Mega Pavilion - 7x7.7m - Rs.17,40,000');
  await p.waitForTimeout(200);
  check('phone, /inquiry: changing the list moves the card, the drawing and the summary too', (await p.locator('.bk-pkg').nth(6).getAttribute('aria-pressed')) === 'true' && /Mega/.test(await p.textContent('#iq-summary-type')) && (await p.locator('.bk-foot.is-on').getAttribute('data-booth')).startsWith('Mega'));
  await p.selectOption('#iq-zone', 'FinTech AI');
  await p.fill('#iq-name', 'Meera Nair');
  await p.fill('#iq-email', 'meera.booth@example.com');
  await p.fill('#iq-phone', '9820088888');
  await p.fill('#iq-company', 'Nair Analytics');
  await p.fill('#iq-products', 'A fraud model');
  check('phone, /inquiry: only the extra note is folded', !(await shown(p, '#iq-message')) && await shown(p, '#iq-website'));
  await p.fill('#iq-website', 'www.nair.example');
  await p.fill('#iq-designation', 'CTO');
  await p.selectOption('#iq-company-type', 'Startup');
  await p.selectOption('#iq-revenue', '₹1 to 10 crore');
  await p.fill('#iq-product', 'FraudGuard');
  await p.selectOption('#iq-stage', 'Live, with paying customers');
  await p.selectOption('#iq-users', 'We sell it to other organisations');
  await p.selectOption('#iq-market', 'India');
  await p.selectOption('#iq-industry', 'Banking & Financial Services');
  await p.fill('#iq-city', 'Mumbai');
  check('phone, /inquiry: no small words, every box can be tapped', (await smallWords(p, '#inquiry-form-card')).length === 0 && (await smallTargets(p, '#inquiry-form-card')).length === 0, (await smallWords(p, '#inquiry-form-card')).join() + ' ' + (await smallTargets(p, '#inquiry-form-card')).join());
  await p.tap('#iq-submit');
  await p.waitForFunction(() => !document.getElementById('iq-success').classList.contains('hidden'), null, { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(800);
  const enq = (await sql("SELECT * FROM inquiries WHERE email = 'meera.booth@example.com'"))[0];
  const em = enq ? JSON.parse(enq.metadata) : {};
  check('phone, /inquiry: a real enquiry saved, with the booth, zone, estimate, products and a working link', enq && enq.inquiry_type === 'booth_inquiry' && em.booth_type.startsWith('Mega') && em.preferred_zone === 'FinTech AI' && em.estimated_total === 1740000 && em.what_it_does === 'A fraud model' && em.product === 'FraudGuard' && em.website === 'https://www.nair.example' && em.designation === 'CTO', JSON.stringify(enq));
  check('phone, /inquiry: the thank-you on the screen, with the reference', await shown(p, '#iq-success') && (await p.textContent('#iq-ref')) === 'BHAI-INQ-' + String(enq.id).padStart(5, '0') && (await box(p, '#iq-success')).top < 500, JSON.stringify(await box(p, '#iq-success')));
  const mails = await (await fetch(BASE + '/__mail')).json();
  check('phone, /inquiry: the team was told', mails.some((m) => /booth/i.test(m.Content.Subject + m.Content.Body[0].Content) && m.Content.Body[0].Content.includes('Nair Analytics')));
  await p.locator('#iq-success button').tap();
  await p.waitForTimeout(300);
  check('phone, /inquiry: Submit Another: an empty form, nothing lit', await shown(p, '#iq-name') && (await p.inputValue('#iq-name')) === '' && (await p.locator('.bk-pkg.is-on').count()) === 0 && (await p.locator('.bk-foot.is-on').count()) === 0);
  check('phone, /inquiry: no page errors', p.errs.length === 0, p.errs.join(' | '));
  await p.close();

  // Refused
  p = await open(phone, '/inquiry');
  await p.route('**/api/booth-application', (r) => r.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"Please add website. It is required."}' }));
  await p.selectOption('#iq-booth-type', 'Undecided');
  for (const [id, v] of [['#iq-name', 'A'], ['#iq-email', 'a@example.com'], ['#iq-phone', '9820000000'], ['#iq-company', 'C'], ['#iq-website', 'c.example'], ['#iq-product', 'P'], ['#iq-products', 'It does a thing'], ['#iq-designation', 'CEO'], ['#iq-city', 'Pune']]) await p.fill(id, v);
  for (const [id, v] of [['#iq-company-type', 'Startup'], ['#iq-revenue', 'No revenue yet'], ['#iq-stage', 'Idea'], ['#iq-users', 'Both'], ['#iq-market', 'India'], ['#iq-industry', 'Other']]) await p.selectOption(id, v);
  await p.tap('#iq-submit');
  await p.waitForFunction(() => !document.getElementById('iq-notice').classList.contains('hidden'), null, { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(4500);
  check('phone, /inquiry: a refusal is still on the screen after the toast has gone, and the button is back', await shown(p, '#iq-notice') && /required/.test(await p.textContent('#iq-notice')) && await p.isEnabled('#iq-submit') && /Send my application/.test(await p.textContent('#iq-submit')));
  await p.close();

  // An empty form
  p = await open(phone, '/inquiry');
  const valid = await p.evaluate(() => { const f = document.getElementById('inquiry-form'); const bad = [...f.querySelectorAll(':invalid')].filter((e) => e.tagName !== 'FORM').map((e) => e.id); return bad; });
  check('phone, /inquiry: an empty form cannot be sent, and every box it asks for is in the open', valid.length === 16 && await p.evaluate((ids) => ids.every((id) => document.getElementById(id).getClientRects().length > 0), valid), valid.join());
  await p.tap('.bk-unsure button');
  await p.waitForTimeout(800);
  check('phone, /inquiry: Ask us which size fits chooses Not sure yet and goes to the form', (await p.inputValue('#iq-booth-type')) === 'Undecided' && (await box(p, '#inquiry-form-card')).top < 120);
  await p.evaluate(() => window.scrollTo(0, 0));
  check('phone, /inquiry: nothing widens the page, frame by frame', (await widestFor(p)) <= 390, 'wider');
  await p.close();
  p = await open(phone, '/inquiry?booth=explorer');
  check('phone, /inquiry: a link with ?booth= opens with it chosen and lit', (await p.locator('.bk-pkg.is-on').count()) === 1 && /Explorer/.test(await p.textContent('#iq-summary-type')));
  await p.close();
  await phone.close();

  // ======== a small phone ========
  const small = await newCtx(browser, SMALL);
  for (const url of ['/register', '/inquiry']) {
    p = await open(small, url);
    check('320px, ' + url + ': nothing widens the page, frame by frame', (await widestFor(p, 2500)) <= 320, 'wider');
    check('320px, ' + url + ': the title fits', await p.evaluate(() => [...document.querySelectorAll('h1 .ps-w')].every((w) => w.getBoundingClientRect().right <= innerWidth + 0.5)));
    if (url === '/register') {
      check('320px, /register: the paid passes start on the first screen', (await box(p, '.rg-offer')).top < 600, JSON.stringify(await box(p, '.rg-offer')));
      await p.tap('.rg-switch label[for="rg-view-paid"]');
      await p.waitForTimeout(400);
      check('320px, /register: a paid row fits, nothing is cut off', await p.evaluate(() => [...document.querySelectorAll('.rg-tier')].every((t) => t.scrollWidth <= t.clientWidth + 2 && t.getBoundingClientRect().right <= innerWidth) && document.querySelector('.rg-offer').scrollWidth <= document.querySelector('.rg-offer').clientWidth));
      await p.tap('.rg-tier[href="#premium"]');
      await p.waitForTimeout(400);
      const r = await p.evaluate(() => { const b = document.getElementById('rpp-submit-btn').getBoundingClientRect(); const c = [...document.querySelectorAll('.rg-choice > div')]; return { btn: b.bottom, cut: c.some((d) => d.scrollWidth > d.clientWidth + 1), page: document.documentElement.scrollWidth }; });
      check('320px, /register: the paid form fits, its button on the screen', r.btn <= 640 && !r.cut && r.page <= 320, JSON.stringify(r));
    } else {
      check('320px, /inquiry: the hero\'s drawing fits', (await box(p, '.bk-floor')).right <= 320 && await p.evaluate(() => [...document.querySelectorAll('.bk-foot')].every((f) => f.getBoundingClientRect().right <= document.querySelector('.bk-floor').getBoundingClientRect().right)));
      check('320px, /inquiry: a card fits, its price on the card', await p.evaluate(() => [...document.querySelectorAll('.bk-pkg')].every((c) => c.scrollWidth <= c.clientWidth + 1 && c.querySelector('.bk-pkg-price').getBoundingClientRect().right <= c.getBoundingClientRect().right)));
    }
    check('320px, ' + url + ': no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.close();
  }
  await small.close();

  // ======== a laptop ========
  const laptop = await newCtx(browser, LAPTOP);
  p = await open(laptop, '/register');
  const col = await p.evaluate(() => { const a = document.querySelector('.rg-offer').getBoundingClientRect(), b = document.querySelector('.rg-card').getBoundingClientRect(); return { aRight: a.right, bLeft: b.left, sameTop: Math.abs(a.top - b.top) < 2, top: a.top }; });
  check('laptop: the paid passes first, the free form beside them, level', col.aRight < col.bLeft && col.sameTop, JSON.stringify(col));
  check('laptop: the paid passes come up the screen, the Delegate Pass in view', (await box(p, '.rg-tier')).bottom < 800 && col.top < 400, JSON.stringify(col));
  check('laptop: no switch: both are there', !(await shown(p, '.rg-switch')) && await shown(p, '#rf-name') && await shown(p, '.rg-tier'));
  check('laptop: the menu is one row and the line rests on Passes', await p.evaluate(() => { const l = document.querySelector('.ps-light'), a = document.querySelector('.ps-nav [aria-current]'); const r = l.getBoundingClientRect(), s = a.getBoundingClientRect(); return Math.abs(r.left - s.left) < 2 && Math.abs(r.width - s.width) < 2; }));
  await p.hover('.ps-nav a[href="/contact"]');
  await p.waitForTimeout(550);
  check('laptop: Spotlight Navbar: the line goes to the link under the mouse', await p.evaluate(() => { const r = document.querySelector('.ps-light').getBoundingClientRect(), s = document.querySelector('.ps-nav a[href="/contact"]').getBoundingClientRect(); return Math.abs(r.left - s.left) < 3; }));
  const turn = await p.evaluate(() => { const t = document.querySelector('.rg-tier--lead'); const a = t.getAnimations({ subtree: true }).map((x) => x.animationName); return { a, before: getComputedStyle(t, '::before').backgroundImage }; });
  check('laptop: Glow Border Card turns round the Delegate Pass', turn.a.includes('ps-turn') && /conic/.test(turn.before), JSON.stringify(turn));
  check('laptop: the row under it still takes a press', await p.evaluate(() => { const b = document.querySelector('.rg-tier--lead'), r = b.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2).closest('.rg-tier') === b; }));
  await p.hover('.rg-tier[href="#vip"]');
  await p.waitForTimeout(350);
  check('laptop: the arrow on a row slides under a mouse', await p.evaluate(() => getComputedStyle(document.querySelector('.rg-tier[href="#vip"] .rg-tier-go i')).transform !== 'none'));
  await p.locator('.rg-tier[href="#vip"]').click();
  await p.waitForTimeout(450);
  const dlg = await box(p, '.rg-sheet');
  check('laptop: the paid form is in the middle of the screen, all on it', Math.abs((dlg.left + dlg.right) / 2 - 683) < 2 && dlg.top >= 0 && dlg.bottom <= 800, JSON.stringify(dlg));
  check('laptop: and is labelled for a screen reader', await p.evaluate(() => { const m = document.getElementById('reg-paid-pass-modal'); return m.getAttribute('role') === 'dialog' && m.getAttribute('aria-modal') === 'true' && document.getElementById(m.getAttribute('aria-labelledby')).textContent === 'Get Your Paid Pass'; }));
  await p.keyboard.press('Escape');
  // Keyboard: a real choice of pass without a mouse.
  await p.evaluate(() => { openRegisterPaidPassModal(); document.querySelector('input[name="rpp-pass"][value="Delegate Pass"]').focus(); });
  await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(100);
  check('laptop: the pass can be changed with the arrow keys', (await p.inputValue('#rpp-pass-type')) === 'Premium Delegate Pass', await p.inputValue('#rpp-pass-type'));
  await p.keyboard.press('Escape');
  await toEl(p, '#compare', 90);
  await p.hover('.pcmp-row td:nth-of-type(3)');
  await p.waitForTimeout(150);
  check('laptop: the chart lights the column under the mouse', await p.evaluate(() => document.querySelectorAll('.pcmp .ps-col').length > 3));
  check('laptop: no sideways scroll, no page errors', (await widestFor(p, 1500)) <= 1366 && p.errs.length === 0, p.errs.join(' | '));
  await p.close();

  p = await open(laptop, '/inquiry');
  const ig = await p.evaluate(() => { const a = document.querySelector('.bk-list').getBoundingClientRect(), b = document.getElementById('inquiry-form-card').getBoundingClientRect(), z = document.getElementById('iq-zone').getBoundingClientRect(), t = document.getElementById('iq-booth-type').getBoundingClientRect(); return { side: a.right < b.left, rowLevel: Math.abs(z.top - t.top) < 2, wider: t.width > z.width, gap: z.left - t.right }; });
  check('laptop, /inquiry: the sizes and the form side by side', ig.side, JSON.stringify(ig));
  check('laptop, /inquiry: the hole in the old form has gone: booth and zone share a row, no empty space', ig.rowLevel && ig.gap < 20 && ig.wider, JSON.stringify(ig));
  check('laptop, /inquiry: the booth\'s list is wide enough to show its price', await p.evaluate(() => { const s = document.getElementById('iq-booth-type'); const c = document.createElement('canvas').getContext('2d'); const st = getComputedStyle(s); c.font = st.fontWeight + ' ' + st.fontSize + ' ' + st.fontFamily; return c.measureText('Accelerator Booth — 3 x 3 m — ₹2,91,000').width <= s.clientWidth - 54; }));
  check('laptop, /inquiry: the hero\'s drawing is beside the title', await p.evaluate(() => document.querySelector('.bk-floor').getBoundingClientRect().left > document.querySelector('h1').getBoundingClientRect().right - 20));
  await p.locator('.bk-pkg').nth(1).scrollIntoViewIfNeeded();
  const y0 = await p.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; const c = document.getElementById('inquiry-form-card').getBoundingClientRect(); window.scrollTo(0, c.top + scrollY - 100); return window.scrollY; });
  await p.waitForTimeout(100);
  await p.locator('.bk-pkg').nth(1).click();
  await p.waitForTimeout(500);
  check('laptop, /inquiry: choosing a size with the form already in view does not move the page', Math.abs((await p.evaluate(() => window.scrollY)) - y0) < 3, 'moved');
  await p.hover('.bk-pkg >> nth=2');
  await p.waitForTimeout(300);
  check('laptop, /inquiry: a soft light follows the mouse over a size', await p.evaluate(() => { const c = document.querySelectorAll('.bk-pkg')[2]; return !!c.style.getPropertyValue('--mx') && getComputedStyle(c, '::before').opacity !== '0'; }));
  await toEl(p, '.bk-why', 60);
  await p.waitForTimeout(800);
  const why = await p.evaluate(() => ({ h: document.getElementById('bk-why-title').textContent.replace(/\s+/g, ' ').trim(), imgs: [...document.querySelectorAll('.bk-why-list img')].map((i) => i.alt).filter((a) => /Data Science Congress/.test(a)).length, text: document.querySelector('.bk-why').innerText }));
  check('laptop, /inquiry: why exhibit: three reasons with pictures, honest about which event they show', why.h === 'Why exhibit at Bharat AI Innovation 2026?' && why.imgs === 3 && /Moments from Data Science Congress, the predecessor to Bharat AI Innovation\./.test(why.text), JSON.stringify(why));
  check('laptop, /inquiry: no sideways scroll, no page errors', (await widestFor(p, 1500)) <= 1366 && p.errs.length === 0, p.errs.join(' | '));
  await p.close();
  await laptop.close();

  // ======== animations off ========
  const still2 = await newCtx(browser, { ...PHONE, reducedMotion: 'reduce' });
  for (const url of ['/register', '/inquiry']) {
    p = await open(still2, url);
    const a = await p.evaluate(() => ({ moving: document.getAnimations().map((x) => x.animationName || x.transitionProperty), h1: document.querySelector('h1').innerText.replace(/\s+/g, ' ').trim(), split: !!document.querySelector('.ps-split, .ps-ch'), beam: !!document.querySelector('.ps-beam'), light: !!document.querySelector('.ps-light') }));
    check('animations off, ' + url + ': nothing moves', a.moving.length === 0, a.moving.join());
    check('animations off, ' + url + ': the page reads in full, nothing split up', !a.split && !a.beam && !a.light && a.h1.length > 10, JSON.stringify(a));
    if (url === '/register') {
      await p.tap('.rg-switch label[for="rg-view-free"]');
      await p.waitForTimeout(80);
      const freeUp = await shown(p, '#rf-name') && !(await shown(p, '.rg-tier'));
      await p.tap('.rg-switch label[for="rg-view-paid"]');
      await p.waitForTimeout(80);
      check('animations off, /register: the switch still works', freeUp && !(await shown(p, '#rf-name')) && await shown(p, '.rg-tier') && await p.evaluate(() => [...document.querySelectorAll('.rg-tiers li')].every((l) => getComputedStyle(l).opacity === '1')));
      await p.tap('.rg-tier[href="#vip"]');
      await p.waitForTimeout(80);
      check('animations off, /register: and the paid form opens at once', (await p.inputValue('#rpp-pass-type')) === 'VIP Pass' && await shown(p, '#rpp-submit-btn'));
    } else {
      await p.locator('.bk-pkg').nth(0).tap();
      await p.waitForTimeout(150);
      check('animations off, /inquiry: a size is chosen, and the page jumps straight to the form', (await p.inputValue('#iq-booth-type')).startsWith('Startup') && (await box(p, '#inquiry-form-card')).top < 120);
    }
    check('animations off, ' + url + ': no page errors', p.errs.length === 0, p.errs.join(' | '));
    await p.close();
  }
  await still2.close();

  // ======== without the motion files ========
  const noMotion = await newCtx(browser, PHONE);
  await noMotion.route(/(passes|booking)-motion\.(css|js)/, (r) => r.abort());
  for (const url of ['/register', '/inquiry']) {
    p = await open(noMotion, url);
    const t = await p.evaluate(() => ({ h1: document.querySelector('h1').innerText.replace(/\s+/g, ' ').trim(), wide: document.documentElement.scrollWidth, h2: [...document.querySelectorAll('.ps-h2')].every((h) => h.getBoundingClientRect().height > 10 && getComputedStyle(h).opacity === '1') }));
    check('without the motion files, ' + url + ': every word stays, nothing widens', t.h1.length > 10 && t.wide <= 390 && t.h2, JSON.stringify(t));
    if (url === '/register') {
      await fillFree(p, 'nomotion@example.com', '9820099911');
      await p.tap('#rf-submit');
      await p.waitForFunction(() => !document.getElementById('reg-success').classList.contains('hidden'), null, { timeout: 15000 }).catch(() => {});
      check('without the motion files, /register: the form still registers', await shown(p, '#reg-success') && (await sql("SELECT COUNT(*) AS n FROM attendees WHERE email = 'nomotion@example.com'"))[0].n === 1);
    } else {
      await p.locator('.bk-pkg').nth(2).tap();
      await p.waitForTimeout(800);
      check('without the motion files, /inquiry: a size can still be chosen', (await p.inputValue('#iq-booth-type')).startsWith('Innovator') && (await p.locator('.bk-pkg.is-on').count()) === 1);
    }
    await p.close();
  }
  await noMotion.close();

  // ======== with no script at all: an in-app browser having a bad day ========
  const noJs = await newCtx(browser, { ...PHONE, javaScriptEnabled: false });
  p = await noJs.newPage();
  await p.goto(BASE + '/register', { waitUntil: 'load' });
  check('no script, /register: the paid passes and their prices are there to read', await p.locator('.rg-tier').first().isVisible() && /₹8,999/.test(await p.locator('.rg-offer').evaluate((e) => e.textContent)));
  await p.locator('.rg-switch label[for="rg-view-free"]').click();
  check('no script, /register: the switch needs no script', await p.locator('#rf-name').isVisible() && !(await p.locator('.rg-tier').first().isVisible()));
  await p.close();
  p = await noJs.newPage();
  await p.goto(BASE + '/inquiry', { waitUntil: 'load' });
  check('no script, /inquiry: every size and price is there to read', (await p.locator('.bk-pkg').count()) === 7 && await p.locator('.bk-pkg').nth(6).isVisible() && /₹17,40,000/.test(await p.locator('.bk-pkg').nth(6).innerText()));
  await p.close();
  await noJs.close();

  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL crashed: ' + (e && e.stack || e)); process.exit(1); });
