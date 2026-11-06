// END TO END for the price rise (6 Nov 2026): a real browser on a phone and a laptop,
// on the built worker (login-harness.mjs) with the real clock, which is past the
// deadline. The old price must really look struck through, fit the screen, and the
// amount to pay must be today's.
// Needs login-harness.mjs (HARNESS_PORT, default 8796). Started by run-all.mjs.
const pw = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8796);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';

// What the reader sees of each struck price: the line through it, its figure, and what follows it.
const strikes = (page) => page.evaluate(() => Array.from(document.querySelectorAll('s')).filter(s => s.offsetParent !== null).map(s => {
  const cs = getComputedStyle(s);
  return { was: s.textContent.trim(), line: cs.textDecorationLine.includes('line-through'), next: (s.nextSibling && s.nextSibling.textContent || '').trim().slice(0, 12), w: s.getBoundingClientRect().width };
}));
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const NOW = { '₹999': '₹3,999', '₹4,999': '₹8,999', '₹9,999': '₹14,999', '₹19,999': '₹24,999' };
const allRight = (list) => list.length > 0 && list.every(s => s.line && s.w > 0 && NOW[s.was] && s.next.startsWith(NOW[s.was]));

(async () => {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(BASE + '/api/events/1')).ok; } catch {} if (!up) await sleep(500); }
  if (!up) { console.log('FAIL the harness never came up'); process.exit(1); }
  const cfg = await (await fetch(BASE + '/api/payments/config')).json();
  if (!cfg.late) { console.log('FAIL this suite needs the clock past 5 Nov 2026'); process.exit(1); }

  const browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const [label, opts] of [
      ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: UA }],
      ['small phone', { viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true, userAgent: UA }],
      ['laptop', { viewport: { width: 1366, height: 900 } }],
    ]) {
      const ctx = await browser.newContext({ ...opts, serviceWorkers: 'block' });
      await ctx.route((u) => !String(u).startsWith(BASE), (r) => r.abort());
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));

      await page.goto(BASE + '/passes', { waitUntil: 'domcontentloaded', timeout: 60000 });
      let s = await strikes(page);
      check(label + ', /passes: every old price has a line through it, with today\'s beside it', allRight(s), JSON.stringify(s.slice(0, 5)));
      check(label + ', /passes: all four old prices are there', ['₹999', '₹4,999', '₹9,999', '₹19,999'].every(v => s.some(x => x.was === v)), JSON.stringify(s.map(x => x.was)));
      const body = await page.textContent('body');
      check(label + ', /passes: says they went up and may go up again', /PRICES WENT UP ON 6 NOV/.test(body) && /Prices went up on 6 Nov and may go up again\./.test(body));
      check(label + ', /passes: no sideways scroll', await fits(page));
      const btn = await page.evaluate(() => { const l = Array.from(document.querySelectorAll('a')).find(x => /^Get the Delegate/.test(x.textContent.trim())); return l ? getComputedStyle(l).color : ''; });
      check(label + ', /passes: the buy button text can be read (white on the colour)', btn === 'rgb(255, 255, 255)', btn);
      if (label === 'phone') await page.screenshot({ path: process.env.PRICE_SHOT || require('os').tmpdir() + '/price-passes-phone.png', fullPage: false });

      await page.goto(BASE + '/register', { waitUntil: 'domcontentloaded', timeout: 60000 });
      s = await strikes(page);
      check(label + ', /register: every visible old price has a line through it', allRight(s), JSON.stringify(s.slice(0, 5)));
      check(label + ', /register: no sideways scroll', await fits(page));
      await page.goto(BASE + '/app', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(() => typeof loadPassPrices === 'function', null, { timeout: 30000 });
      const line = await page.evaluate(async () => { await loadPassPrices(); return priceDeadlineLine('Delegate Pass'); });
      check(label + ', /app: its own line strikes the old price through and says it may go up again', line.includes('<s>&#8377;4,999</s> until 5 Nov 2026') && line.includes('Prices may go up again.'), line);
      check(label + ': no script error', errors.length === 0, errors.slice(0, 2).join(' | '));
      await ctx.close();
    }
  } finally { await browser.close(); }

  // The charge itself is today's price, whatever the page strikes through.
  check('the amount charged for a Delegate Pass is today\'s: 8,999 + 18% GST', cfg.passes['Delegate Pass'].base === 8999 && cfg.passes['Delegate Pass'].total === 10618.82, JSON.stringify(cfg.passes['Delegate Pass']));

  console.log(fails ? `\n${fails} FAILED` : '\nall browser checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL crashed: ' + e.message); process.exit(1); });
