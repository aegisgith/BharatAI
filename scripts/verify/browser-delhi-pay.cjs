// End to end: a person on a phone, and one on a laptop, buying a Delhi pass in a real
// browser: /delhi, the passes, /delhi-register, the checkout page, the gateway (played:
// its page answers the way CCAvenue's does), the result page. Real worker, real SQLite,
// through delhi-harness.mjs. Run by run-all.mjs.
const { chromium } = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8801);
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

// CCAvenue's page, played: whatever is posted to it, it posts the answer back to our return address.
async function playGateway(ctx, status) {
  await ctx.route('https://*.ccavenue.com/**', async (route) => {
    const enc = await (await ctx.request.get(BASE + '/__answer?status=' + status)).text();
    await route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>CCAvenue</title><p id="gw">CCAvenue</p><form id="b" method="post" action="${BASE}/pay/ccavenue/return"><input type="hidden" name="encResp" value="${enc}"></form><script>setTimeout(function(){document.getElementById("b").submit()},150)</script>` });
  });
}
const fill = async (p, v) => {
  await p.fill('#dr-name', v.name);
  await p.fill('#dr-email', v.email);
  await p.fill('#dr-phone', v.phone);
  await p.fill('#dr-org', v.org);
  if (v.job) await p.fill('#dr-job', v.job);
  await p.fill('#dr-city', v.city);
  await p.selectOption('#dr-industry', v.industry);
};

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    // ======== a phone, animations off: from /delhi to confirmed ========
    {
      const ctx = await browser.newContext({ ...PHONE, reducedMotion: 'reduce' });
      await playGateway(ctx, 'Success');
      const page = await ctx.newPage();
      const errors = [];
      const lost = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(BASE)) lost.push(r.status() + ' ' + r.url()); });
      await page.goto(BASE + '/delhi', { waitUntil: 'load' });
      await page.click('.dl-hero-actions .btn-primary');
      await page.waitForTimeout(700);
      await page.locator('.dl-pass:has(h3:text-is("Premium Delegate Pass")) a').click();
      await page.waitForURL('**/delhi-register#premium');
      await page.waitForLoadState('load');
      check('the card opens the form on that pass, with what it costs', await page.locator('input[value="Premium Delegate Pass"]').isChecked() && (await page.textContent('#dr-total')).includes('₹11,798.82'), await page.textContent('#dr-total'));
      const geo = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - innerWidth, tap: [...document.querySelectorAll('.dr-field input:not(#dr-website), .dr-field select, .dr-submit, .dr-pass > span')].filter((e) => e.getBoundingClientRect().height < 44).map((e) => e.id || e.textContent.slice(0, 20)) }));
      check('390px: no sideways scroll, and every box is big enough to tap', geo.over <= 0 && geo.tap.length === 0, JSON.stringify(geo));
      await page.click('#dr-submit');
      check('empty: asks for the name, on screen, and goes nowhere', (await page.textContent('#dr-error')).includes('name') && await page.locator('#dr-error').isVisible() && page.url().includes('/delhi-register'));
      await page.locator('label.dr-pass', { hasText: 'Academic Pass' }).click();
      check('tapping Academic asks for the college and puts away designation', (await page.textContent('#dr-org-label')) === 'College name' && !(await page.locator('#dr-job').isVisible()));
      await page.locator('label.dr-pass', { hasText: 'Premium Delegate Pass' }).click();
      await fill(page, { name: 'Priya Sharma', email: 'priya.buyer@example.com', phone: '98765 43210', org: 'Example Ltd', job: 'CTO', city: 'New Delhi', industry: 'Insurance' });
      await page.locator('#dr-gst summary').click();
      await page.fill('#dr-gst-name', 'Example Ltd');
      await page.fill('#dr-gstin', '07AAACA1234B1Z5');
      await page.click('#dr-submit');
      check('a GSTIN with no address: says so, in the open section', (await page.textContent('#dr-error')).includes('billing address') && await page.locator('#dr-gst-address').isVisible());
      await page.fill('#dr-gst-address', 'Connaught Place, New Delhi');
      await page.click('#dr-submit');
      await page.waitForURL('**/pay/result**', { timeout: 15000 });
      const words = await page.textContent('body');
      check('through checkout and the gateway to the result page', words.includes('Payment received') && words.includes('Premium Delegate Pass') && words.includes('Bharat AI Innovation Delhi 2027') && words.includes('11,798.82'), words.slice(0, 200));
      check('it says what happens next, on a phone, without sideways scroll', words.includes('closer to the event') && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      check('no way from there into Mumbai\'s app', await page.locator('a[href*="/app"]').count() === 0);
      const rows = await (await ctx.request.get(BASE + '/__rows')).json();
      const a = rows.attendees.find((x) => x.email === 'priya.buyer@example.com');
      check('really saved: event 2, paid, and the order and the receipt are Delhi\'s', a && a.event_id === 2 && a.badge_type === 'Premium Delegate Pass' && a.payment_status === 'paid' && rows.orders[rows.orders.length - 1].event_id === 2 && rows.invoices[rows.invoices.length - 1].item_desc.includes('Delhi 2027') && rows.invoices[rows.invoices.length - 1].buyer_gstin === '07AAACA1234B1Z5', JSON.stringify(a));
      const mail = await (await ctx.request.get(BASE + '/__mail')).json();
      check('the buyer and the team were emailed', mail.filter((m) => (m.Recipients.To || []).includes('priya.buyer@example.com')).length === 2 && mail.some((m) => m.Content.Subject.startsWith('Paid online, Delhi 2027')), mail.map((m) => m.Content.Subject).join(' | '));
      check('no browser session was left behind', !(await ctx.cookies()).some((c) => c.name === 'bai_session'));
      check('no page errors, no missing files', errors.length === 0 && lost.length === 0, errors.concat(lost).join('; '));
      await ctx.close();
    }
    // ======== cancelled on the gateway, then Try again ========
    {
      const ctx = await browser.newContext({ ...PHONE });
      await playGateway(ctx, 'Aborted');
      const page = await ctx.newPage();
      await page.goto(BASE + '/delhi-register#vip', { waitUntil: 'load' });
      await fill(page, { name: 'Rahul Verma', email: 'rahul.buyer@example.com', phone: '98200 55555', org: 'Acme AI', job: 'CEO', city: 'Gurugram', industry: 'Software & SaaS' });
      await page.click('#dr-submit');
      await page.waitForURL('**/pay/result**', { timeout: 15000 });
      check('cancelled: told so, nothing charged, Try again on the page', (await page.textContent('body')).includes('You cancelled the payment') && await page.locator('#again').isVisible());
      await ctx.unroute('https://*.ccavenue.com/**');
      await playGateway(ctx, 'Success');
      await page.click('#again');
      await page.waitForURL('**/pay/result**', { waitUntil: 'load', timeout: 15000 });
      await page.waitForFunction(() => document.body.textContent.includes('Payment received'), null, { timeout: 15000 });
      const rows = await (await ctx.request.get(BASE + '/__rows')).json();
      const a = rows.attendees.find((x) => x.email === 'rahul.buyer@example.com');
      check('Try again: pays the same pass, and it is confirmed', a.badge_type === 'VIP Pass' && a.payment_status === 'paid' && rows.orders.filter((o) => o.attendee_id === a.id).length === 2, JSON.stringify(a));
      // Coming back to buy the same pass.
      await page.goto(BASE + '/delhi-register#vip', { waitUntil: 'load' });
      await fill(page, { name: 'Rahul Verma', email: 'rahul.buyer@example.com', phone: '98200 55555', org: 'Acme AI', job: 'CEO', city: 'Gurugram', industry: 'Software & SaaS' });
      await page.click('#dr-submit');
      await page.waitForFunction(() => !document.getElementById('dr-error').hidden, null, { timeout: 10000 });
      check('the same pass again: told it is confirmed, stays on the page, button back', (await page.textContent('#dr-error')).includes('already confirmed') && page.url().includes('/delhi-register') && !(await page.locator('#dr-submit').isDisabled()));
      await ctx.close();
    }
    // ======== a booth application on a phone, from /delhi ========
    {
      const ctx = await browser.newContext({ ...PHONE, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(BASE + '/delhi#booths', { waitUntil: 'load' });
      await page.locator('.dl-sale-row', { hasText: 'Innovator Booth' }).locator('a').click();
      await page.waitForURL('**/delhi-exhibit?booth=Innovator%20Booth');
      await page.waitForLoadState('load');
      check('booth: the row opens the application on that booth', (await page.inputValue('#da-booth')) === 'Innovator Booth');
      await page.click('#da-submit');
      check('booth: empty, it asks for the company first, on screen', (await page.textContent('#da-error')).includes('company name') && await page.locator('#da-error').isVisible());
      await page.fill('#da-company', 'Acme AI');
      await page.fill('#da-website', 'acme.example');
      await page.selectOption('#da-type', 'Startup');
      await page.selectOption('#da-revenue', 'No revenue yet');
      await page.fill('#da-product', 'Acme Vision');
      await page.selectOption('#da-stage', 'Working prototype or MVP');
      await page.fill('#da-what', 'Spots defects on a production line');
      await page.selectOption('#da-users', 'We sell it to other organisations');
      await page.selectOption('#da-market', 'India');
      await page.selectOption('#da-industry', 'Manufacturing');
      await page.fill('#da-name', 'Kavya Iyer');
      await page.fill('#da-designation', 'Founder');
      await page.fill('#da-email', 'kavya.booth@example.com');
      await page.fill('#da-phone', '98450 12345');
      await page.fill('#da-city', 'Bengaluru');
      check('booth: 390px, no sideways scroll, every box big enough to tap', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.da-field input:not(#da-website2), .da-field select, .da-submit')].every((e) => e.getBoundingClientRect().height >= 44)));
      await page.click('#da-submit');
      await page.waitForSelector('#da-done:not([hidden])', { timeout: 10000 });
      check('booth: the thank-you, with 2 working days and a reference', (await page.textContent('#da-done-text')).includes('2 working days') && /^BHAI-INQ-\d{5}$/.test(await page.textContent('#da-ref')));
      const saved = (await (await ctx.request.get(BASE + '/__inquiries')).json()).filter((r) => r.email === 'kavya.booth@example.com');
      check('booth: one booth enquiry landed, for Delhi, with its answers', saved.length === 1 && saved[0].inquiry_type === 'booth_inquiry' && saved[0].subject === 'Delhi 2027 · Booth application · Innovator Booth' && JSON.parse(saved[0].metadata).how_far_along === 'Working prototype or MVP', JSON.stringify(saved[0]));
      const mail = (await (await ctx.request.get(BASE + '/__mail')).json()).filter((m) => JSON.stringify(m).includes('kavya.booth@example.com'));
      check('booth: the team and the applicant were each emailed once', mail.length === 2, mail.length);
      check('booth: no page errors', errors.length === 0, errors.join('; '));
      await ctx.close();
    }

    // ======== sizes, and the new sections of /delhi ========
    for (const [w, h, m] of [[360, 740, true], [390, 844, true], [820, 1180, false], [1280, 720, false], [1920, 1080, false]]) {
      const c = await browser.newContext({ viewport: { width: w, height: h }, isMobile: m, hasTouch: m, deviceScaleFactor: m ? 2 : 1 });
      const p = await c.newPage();
      for (const u of ['/delhi-register', '/delhi-exhibit', '/delhi']) {
        await p.goto(BASE + u, { waitUntil: 'load' });
        await p.waitForTimeout(400);
        const r = await p.evaluate(() => ({
          over: document.documentElement.scrollWidth - innerWidth,
          bad: [...document.querySelectorAll('h1,h2,h3,p,li,a.btn,button,label,.dl-sale-row *')].filter((e) => !e.closest('.dl-hp, .dr-hp, .da-hp')).filter((e) => { const x = e.getBoundingClientRect(); return x.width && (x.right > innerWidth + 1 || x.left < -1); }).map((e) => e.textContent.trim().slice(0, 30)),
          short: [...document.querySelectorAll('.dl-sale-row .btn, .dl-pass .btn')].filter((e) => e.getBoundingClientRect().height < 44).length,
        }));
        check(`${w}px ${u}: nothing runs off the screen, every button big enough`, r.over <= 0 && r.bad.length === 0 && r.short === 0, JSON.stringify(r));
      }
      await c.close();
    }
    // ======== with animations on ========
    {
      const c = await browser.newContext({ ...PHONE, reducedMotion: 'no-preference' });
      const p = await c.newPage();
      const errs = [];
      p.on('pageerror', (e) => errs.push(e.message));
      await p.goto(BASE + '/delhi', { waitUntil: 'load' });
      for (const sel of ['#passes .dl-pass', '#booths .dl-sale-row', '#partner .dl-sale-row']) {
        await p.locator(sel).first().scrollIntoViewIfNeeded();
        await p.waitForTimeout(900);
      }
      check('animations on: the price lists appear', await p.evaluate(() => ['#passes .dl-pass', '#booths .dl-sale-row', '#partner .dl-sale-row'].every((s) => getComputedStyle(document.querySelector(s)).opacity === '1')));
      check('no errors', errs.length === 0, errs.join(' | '));
      await c.close();
    }
  } finally {
    await browser.close();
  }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('crashed: ' + e.message); process.exit(1); });
