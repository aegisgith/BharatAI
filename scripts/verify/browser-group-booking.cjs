// End to end: a buyer on a phone booking passes for their team on /group, in a real
// browser: the form at 360px (no sideways scroll, every box big enough to tap), every
// refusal said next to its field (an empty form, too few people, the same email twice,
// someone who already holds a pass, refused by the server and shown on their row),
// "I am attending too", adding and removing people, the live total, the list kept over
// a reload, then the checkout page, the gateway (played), the result page, and what
// really landed. Real worker, real SQLite, through group-harness.mjs. Run by run-all.mjs.
const { chromium } = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8883);
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const SMALL = { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const inr = (paise) => '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 });
const withGst = (p) => p + Math.round(p * 18 / 100);

async function playGateway(ctx, status) {
  await ctx.route('https://*.ccavenue.com/**', async (route) => {
    const enc = await (await ctx.request.get(BASE + '/__answer?status=' + status)).text();
    await route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>CCAvenue</title><p id="gw">CCAvenue</p><form id="b" method="post" action="${BASE}/pay/ccavenue/return"><input type="hidden" name="encResp" value="${enc}"></form><script>setTimeout(function(){document.getElementById("b").submit()},150)</script>` });
  });
}
const row = (page, n) => page.locator('#gb-people .gb-person').nth(n - 1);
const fillRow = async (page, n, v) => {
  const r = row(page, n);
  await r.locator('input[name="name"]').fill(v.name);
  await r.locator('input[name="email"]').fill(v.email);
  if (v.mobile) await r.locator('input[name="mobile"]').fill(v.mobile);
  if (v.designation) await r.locator('input[name="designation"]').fill(v.designation);
};

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const ctx = await browser.newContext({ ...SMALL, reducedMotion: 'reduce' });
    await playGateway(ctx, 'Success');
    const page = await ctx.newPage();
    const errors = [], lost = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(BASE) && !r.url().includes('/api/group/start')) lost.push(r.status() + ' ' + r.url()); });
    await page.goto(BASE + '/group', { waitUntil: 'load' });

    // ---- the form at 360px ----
    // Two tiers (13 Nov 2026): 3 or 4 passes 15% off each, 5 or more 30% off each.
    const was = Number(await page.getAttribute('input[value="Delegate Pass"]', 'data-list'));
    const unit = Math.round(was * 0.7), unit15 = Math.round(was * 0.85);
    const three = withGst(3 * unit15 * 100);
    const six = withGst(6 * unit * 100);
    const shown = await page.textContent('label.gb-opt:first-of-type');
    check('the Delegate Pass shows 30% off for 5 or more and 15% off for 3 or 4, to the rupee', was > 0 && shown.includes(inr(unit * 100)) && shown.includes(inr(unit15 * 100)), shown);
    const geo = await page.evaluate(() => ({
      over: document.documentElement.scrollWidth - innerWidth,
      out: [...document.querySelectorAll('h1,h2,p,label,button,input,summary,.gb-opt-in')].filter((e) => { const x = e.getBoundingClientRect(); return x.width && (x.right > innerWidth + 1 || x.left < -1); }).map((e) => e.id || e.textContent.trim().slice(0, 24)),
      short: [...document.querySelectorAll('#gb-form input:not([type="radio"]):not([type="checkbox"]), #gb-form button, #gb-form summary, .gb-opt-in, .gb-check')].filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44).map((e) => e.id || e.className || e.textContent.slice(0, 20)),
      font: [...document.querySelectorAll('#gb-form input, #gb-form textarea')].filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).length,
      people: document.querySelectorAll('#gb-people .gb-person').length,
    }));
    check('360px: no sideways scroll, nothing off the screen, every box at least 44px, inputs at 16px', geo.over <= 0 && geo.out.length === 0 && geo.short.length === 0 && geo.font === 0, JSON.stringify(geo));
    check('it starts with 3 people and the price for 3, at 15% off', geo.people === 3 && (await page.textContent('#gb-total')).includes('3 × ' + inr(unit15 * 100) + ' + 18% GST = ' + inr(three)) && (await page.textContent('#gb-go')).trim() === 'Pay ' + inr(three) + ' and book 3 passes', await page.textContent('#gb-total'));

    // ---- refusals, on screen, next to the field ----
    await page.click('#gb-go');
    check('empty: asks for the buyer\'s name, next to it, and goes nowhere', (await page.textContent('#gb-err-buyer-name')).includes('Please add your name') && await page.locator('#gb-err-buyer-name').isVisible() && await page.evaluate(() => document.activeElement.id) === 'gb-buyer-name' && page.url().endsWith('/group'));
    await page.fill('#gb-buyer-name', 'Asha Buyer');
    await page.fill('#gb-buyer-email', 'asha.buyer@acme.example');
    await page.fill('#gb-buyer-mobile', '98200 12345');
    await page.fill('#gb-buyer-company', 'Acme AI');
    await page.check('#gb-me');
    check('I am attending too: person 1 is the buyer', (await row(page, 1).locator('input[name="name"]').inputValue()) === 'Asha Buyer' && (await row(page, 1).locator('input[name="email"]').inputValue()) === 'asha.buyer@acme.example');
    await page.click('#gb-go');
    check('the buyer alone: says to add 2 more, on the first empty person', (await row(page, 2).locator('.gb-row-err').textContent()).includes('You have 1 on the list: add 2 more') && (await row(page, 2).locator('input[name="name"]').getAttribute('aria-invalid')) === 'true');
    check('the total says 1 of at least 3', (await page.textContent('#gb-count')).includes('1 of at least 3'));
    await fillRow(page, 2, { name: 'Ravi Kumar', email: 'ravi@acme.example', designation: 'Data Lead' });
    await fillRow(page, 3, { name: 'Meera Iyer', email: 'meera@acme.example' });
    await page.click('#gb-add');
    await fillRow(page, 4, { name: 'Kabir Shah', email: 'kabir@acme.example', mobile: '98200 44444' });
    check('4 people: 15% off, and it says one more makes every pass 30% off', (await page.textContent('#gb-total')).includes('4 × ' + inr(unit15 * 100)) && (await page.textContent('#gb-save')).includes('(15% off). Add 1 more and every pass is 30% off.'), await page.textContent('#gb-save'));
    await page.click('#gb-add');
    await page.click('#gb-add');
    await fillRow(page, 5, { name: 'Ravi Again', email: 'ravi@acme.example' });
    await fillRow(page, 6, { name: 'Has A Pass', email: 'holder@paid.example' });
    check('6 people: every pass 30% off', (await page.textContent('#gb-total')).includes('6 × ' + inr(unit * 100)) && (await page.textContent('#gb-save')).includes('(30% off)'), await page.textContent('#gb-total'));
    await page.click('#gb-go');
    check('the same email twice: said on person 5, naming person 2', (await row(page, 5).locator('.gb-row-err').textContent()).includes('same email as person 2'));
    await row(page, 5).locator('input[name="email"]').fill('nisha@acme.example');
    await row(page, 5).locator('input[name="name"]').fill('Nisha Rao');
    // Add and take away a person: the numbers and the total follow.
    await page.click('#gb-add');
    await fillRow(page, 7, { name: 'Extra Person', email: 'extra@acme.example' });
    const seven = withGst(7 * unit * 100);
    check('a seventh person: the total and the button follow', (await page.textContent('#gb-total')).includes('7 ×') && (await page.textContent('#gb-go')).includes(inr(seven) + ' and book 7 passes') && (await page.textContent('#gb-save')).includes(inr(withGst(7 * (was - unit) * 100))));
    await row(page, 7).locator('.gb-remove').click();
    check('removed again: 6 people, Person 1 to Person 6', await page.locator('#gb-people .gb-person').count() === 6 && (await row(page, 6).locator('.gb-person-no').textContent()) === 'Person 6' && (await page.textContent('#gb-go')).includes('book 6 passes'));
    await page.locator('label.gb-opt', { hasText: 'Premium Delegate Pass' }).click();
    const pu = Math.round(Number(await page.getAttribute('input[value="Premium Delegate Pass"]', 'data-list')) * 0.7);
    check('Premium Delegate: the total changes with it', (await page.textContent('#gb-go')).includes(inr(withGst(6 * pu * 100))));
    await page.locator('label.gb-opt', { hasText: 'Delegate Pass' }).first().click();
    await page.waitForTimeout(400);   // the list is kept a moment after the last keystroke
    await page.reload({ waitUntil: 'load' });
    check('a reload keeps the whole list in this tab', (await row(page, 6).locator('input[name="email"]').inputValue()) === 'holder@paid.example' && (await page.inputValue('#gb-buyer-company')) === 'Acme AI' && await page.isChecked('#gb-me') && await page.isChecked('input[value="Delegate Pass"]'));
    await page.click('#gb-go');
    await page.waitForFunction(() => document.querySelector('#gb-people .gb-person:nth-child(6) .gb-row-err').textContent.length > 0, null, { timeout: 10000 });
    check('someone who already holds a pass: the server says so on their row, and the button is back', (await row(page, 6).locator('.gb-row-err').textContent()).includes('already has a pass') && (await row(page, 6).locator('input[name="email"]').getAttribute('aria-invalid')) === 'true' && !(await page.locator('#gb-go').isDisabled()) && page.url().endsWith('/group'));
    await row(page, 6).locator('input[name="name"]').fill('Dev Patel');
    await row(page, 6).locator('input[name="email"]').fill('dev@acme.example');

    // ---- pay ----
    await page.click('#gb-go');
    await page.waitForURL('**/pay/result**', { timeout: 20000 });
    const words = await page.textContent('body');
    check('through checkout and the gateway to the result page', words.includes('Your group is booked') && words.includes('6 Delegate Passes for Bharat AI Innovation 2026 are confirmed') && words.includes(inr(six).replace('₹', '')), words.slice(0, 240));
    check('the result page fits the phone, and opens the app for a buyer who is coming', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth) && await page.locator('a[href="/app"]').count() === 1);
    const rows = await (await ctx.request.get(BASE + '/__rows')).json();
    const team = ['asha.buyer@acme.example', 'ravi@acme.example', 'meera@acme.example', 'kabir@acme.example', 'nisha@acme.example', 'dev@acme.example'].map((e) => rows.attendees.find((a) => a.email === e));
    check('really saved: six Delegate Passes, paid, each their share, the buyer one of them', team.every((a) => a && a.badge_type === 'Delegate Pass' && a.payment_status === 'paid' && Number(a.payment_amount) === withGst(unit * 100) / 100) && rows.orders[rows.orders.length - 1].pass_type === 'Group: 6 x Delegate Pass' && rows.groups[rows.groups.length - 1].status === 'paid', JSON.stringify(team.map((a) => a && [a.email, a.badge_type, a.payment_amount])));
    check('Ravi\'s designation and Kabir\'s mobile were kept', team[1].job_title === 'Data Lead' && team[3].mobile === '9820044444', JSON.stringify([team[1].job_title, team[3].mobile]));
    check('the one who held a pass already was never touched', rows.attendees.find((a) => a.email === 'holder@paid.example').payment_amount === '10618.82');
    const mail = await (await ctx.request.get(BASE + '/__mail')).json();
    const subj = mail.map((m) => m.Content.Subject);
    check('six pass emails, the buyer\'s summary and the team\'s note', subj.filter((s) => s === 'Your Delegate Pass for Bharat AI Innovation 2026 is confirmed').length === 6 && subj.some((s) => s.startsWith('Booked: 6 Delegate Passes')) && subj.some((s) => s.startsWith('Group booking paid: Asha Buyer, Acme AI, 6 x Delegate Pass')), subj.join(' | '));
    await page.goto(BASE + '/group', { waitUntil: 'load' });
    check('back on /group after paying: a fresh form (the kept list was cleared)', (await row(page, 2).locator('input[name="email"]').inputValue()) === '' && !(await page.isChecked('#gb-me')));
    check('no page errors, no missing files', errors.length === 0 && lost.length === 0, errors.concat(lost).join('; '));
    await ctx.close();

    // ---- sizes ----
    for (const [w, h, m] of [[360, 740, true], [390, 844, true], [820, 1180, false], [1280, 800, false]]) {
      const c = await browser.newContext({ viewport: { width: w, height: h }, isMobile: m, hasTouch: m, deviceScaleFactor: m ? 2 : 1 });
      const p = await c.newPage();
      await p.goto(BASE + '/group', { waitUntil: 'load' });
      await p.click('#gb-add');
      const g = await p.evaluate(() => ({
        over: document.documentElement.scrollWidth - innerWidth,
        cols: getComputedStyle(document.querySelector('.gb-grid')).gridTemplateColumns.split(' ').length,
      }));
      check(`${w}px: nothing runs off the screen${w >= 640 ? ', two columns per person' : ', one column per person'}`, g.over <= 0 && (w >= 640 ? g.cols === 2 : true), JSON.stringify(g));
      await c.close();
    }
  } finally {
    await browser.close();
  }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('crashed: ' + e.message); process.exit(1); });
