// Badge Desk as an app, in a real browser with the real service worker (12 Nov 2026):
// the manifest and its icons, the scanner page opening when the network is cut, a pass
// check and the sign-in page never served from a copy, and signing out forgetting the copy.
// Needs team-harness.mjs (HARNESS_PORT, default 8853). Started by run-all.mjs.
// The network is cut for real (/__down on the harness drops every connection), not by
// the browser's offline switch alone, so what is seen is what a phone with no signal sees.
const crypto = require('crypto');
const pw = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8853);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 300))); if (!ok) fails++; };
const until = async (fn, ms = 10000) => { const t = Date.now() + ms; while (Date.now() < t) { try { if (await fn()) return true; } catch {} await sleep(200); } return false; };
// A desk session made the way the server makes it (harness secret 'h'), good for an hour.
const deskCookie = (id) => { const exp = Math.floor(Date.now() / 1000) + 3600; const b = id + '.' + exp; return b + '.' + crypto.createHmac('sha256', 'h').update('staff:' + b).digest('hex'); };
const cut = async (on) => { await fetch(BASE + '/__down?on=' + (on ? 1 : 0)); };
const kept = (page) => page.evaluate(async () => { for (const k of await caches.keys()) { if (k.indexOf('desk-') === 0 && await (await caches.open(k)).match('/staff/scan')) return true; } return false; });

(async () => {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(BASE + '/api/payments/config')).ok; } catch {} if (!up) await sleep(1000); }
  if (!up) { console.log('FAIL the harness never came up'); process.exit(1); }
  const browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
  try {
    // ---- the app the phone is offered ----
    const mr = await fetch(BASE + '/staff.webmanifest');
    const man = await mr.json();
    check('the manifest is served and opens on the scanner under the name Badge Desk', mr.ok && man.start_url === '/staff/scan' && man.short_name === 'Badge Desk' && man.display === 'standalone', JSON.stringify(man).slice(0, 200));
    let iconsOk = true; const sizes = [];
    for (const i of man.icons) { const r = await fetch(BASE + i.src); const b = Buffer.from(await r.arrayBuffer()); const s = b.slice(1, 4).toString() === 'PNG' ? b.readUInt32BE(16) + 'x' + b.readUInt32BE(20) : 'not a png'; sizes.push(i.src + ' ' + s); if (!r.ok || s !== i.sizes) iconsOk = false; }
    check('each icon loads and is the size the manifest says', iconsOk && man.icons.length === 3, sizes.join(', '));

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await ctx.addCookies([{ name: 'bhai_staff', value: deskCookie(1), url: BASE }]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('dialog', d => d.accept());

    // ---- signed in, online: the page is kept ----
    await page.goto(BASE + '/staff/scan', { waitUntil: 'domcontentloaded' });
    check('the scanner opens for the desk account and says until when it stays signed in', /Signed in as Desk One until \d{1,2} [A-Z][a-z]{2}\./.test(await page.locator('#who').innerText()), await page.locator('#who').innerText().catch(() => ''));
    const linked = await page.evaluate(() => document.querySelector('link[rel=manifest]').href);
    check('the page points the phone at the Badge Desk manifest', /\/staff\.webmanifest$/.test(linked), linked);
    check('a copy of the scanner is kept after opening it once', await until(() => kept(page), 20000), 'no copy in a desk- cache');
    const jar = (await ctx.cookies(BASE)).find(c => c.name === 'bhai_staff');
    check('the sign-in cookie is still there, and cannot be read by page script', !!jar && jar.httpOnly === true, JSON.stringify(jar || {}));

    // ---- the network is cut ----
    await cut(true); await ctx.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    check('no internet: the scanner still opens, from its copy', await until(() => page.locator('h1').innerText().then(t => t === 'Scan a pass'), 8000) && /Signed in as Desk One/.test(await page.locator('#who').innerText()), await page.title());
    check('and says there is no internet', await until(async () => await page.locator('#net').innerText() === 'No internet'), await page.locator('#net').innerText().catch(() => ''));
    check('its controls are there: the search box, the count, the sound button', await page.locator('#q').isVisible() && /Checked in on this phone today: 0/.test(await page.locator('#cnt').innerText()) && await page.locator('#snd').isVisible(), '');
    await page.goto(BASE + '/verify/1.abcdefabcdefabcdefabcdef', { waitUntil: 'domcontentloaded' }).catch(() => {});
    const red = await page.locator('body').innerText().catch(() => '');
    check('no internet: a pass check is never answered from a copy; it says NOT checked, in red', /No internet/.test(red) && /This pass was NOT checked\./.test(red), red.slice(0, 160));
    await page.goto(BASE + '/staff', { waitUntil: 'domcontentloaded' }).catch(() => {});
    const red2 = await page.locator('body').innerText().catch(() => '');
    check('no internet: the sign-in page is not served from a copy either', /The badge desk needs internet\./.test(red2) && !/Badge desk sign in/.test(red2), red2.slice(0, 160));
    await page.goto(BASE + '/staff/scan', { waitUntil: 'domcontentloaded' }).catch(() => {});
    check('and the scanner opens again from the home-screen address', await until(() => page.locator('h1').innerText().then(t => t === 'Scan a pass'), 8000), await page.title());

    // ---- back online: signing out forgets the copy ----
    await cut(false); await ctx.setOffline(false);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.bar a').tap();
    check('signing out goes to the sign-in page', await until(() => /\/staff$/.test(page.url())) && /Badge desk sign in/.test(await page.locator('body').innerText()), page.url());
    check('the sign-in page says the phone stays signed in', /You sign in once\. This phone then stays signed in until the event is over\./.test(await page.locator('body').innerText()), '');
    check('signing out throws the kept copy away', !(await kept(page)), 'copy still there');
    await cut(true); await ctx.setOffline(true);
    await page.goto(BASE + '/staff/scan', { waitUntil: 'domcontentloaded' }).catch(() => {});
    const red3 = await page.locator('body').innerText().catch(() => '');
    check('signed out and no internet: no scanner, the red page', /The badge desk needs internet\./.test(red3) && !/Signed in as/.test(red3), red3.slice(0, 160));
    await cut(false); await ctx.setOffline(false);

    // ---- signed out and online: sent to sign in, and nothing kept ----
    await page.goto(BASE + '/staff/scan', { waitUntil: 'domcontentloaded' });
    check('signed out and online: the scanner sends the phone to the sign-in page and keeps no copy', /\/staff$/.test(page.url()) && !(await kept(page)), page.url());
    check('no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  } catch (e) {
    check('suite crashed', false, String(e && e.message || e).split('\n')[0]);
  } finally {
    await cut(false).catch(() => {});
    await browser.close();
  }
  console.log(fails ? `\n${fails} FAILED` : '\nAll Badge Desk app checks passed');
  process.exit(fails ? 1 : 0);
})();
