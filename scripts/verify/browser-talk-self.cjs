// A speaker's own talk page (12 Nov 2026) in a real browser (Edge) on a phone, on the
// real built worker and real SQLite (talk-self-harness.mjs). The link from the email
// opens their talk; what is needed is marked; a wrong mobile is named under its box;
// a photo is chosen and shown; Save puts it all in the programme and says what is left;
// coming back shows it saved; an expired and an altered link each say what to do;
// nothing wider than the screen; no page errors. Then a laptop width.
// Needs talk-self-harness.mjs (HARNESS_PORT, default 8881). Started by run-all.mjs.
const path = require('path');
const pw = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8881);
const PHOTO = path.join(__dirname, '..', '..', 'public', 'images', 'talks', 'aditi-saini.webp');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 300))); if (!ok) fails++; };
const until = async (fn, ms = 8000) => { const t = Date.now() + ms; while (Date.now() < t) { try { if (await fn()) return true; } catch {} await sleep(150); } return false; };
const dbq = async (q) => (await fetch(BASE + '/__db?q=' + encodeURIComponent(q))).json();
const linkFor = async (id, exp) => (await fetch(BASE + '/__link?id=' + id + (exp ? '&exp=' + exp : ''))).text();

(async () => {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(BASE + '/app/my-talk')).ok; } catch {} if (!up) await sleep(1000); }
  if (!up) { console.log('FAIL the harness never came up'); process.exit(1); }
  const browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await ctx.route(u => !u.hostname.startsWith('localhost'), r => r.abort());
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    const wide = async (where) => { const w = await page.evaluate(() => document.documentElement.scrollWidth); check('phone: nothing wider than the screen ' + where, w <= 391, 'scrollWidth ' + w); };

    const tok = await linkFor(7);
    await page.goto(BASE + '/app/my-talk?t=' + tok, { waitUntil: 'domcontentloaded' });
    check('the link from the email opens their talk', await until(async () => ((await page.locator('h1').textContent()) || '').includes('Sushil Sani')));
    check('it says the talk, and that the time and stage will follow', ((await page.locator('.ts-facts').textContent()) || '').includes('Trust3AI Security Governance') && ((await page.locator('.ts-facts').textContent()) || '').includes('We will send you the time soon'));
    check('how far along they are, in words', ((await page.locator('.ts-progress').textContent()) || '').includes('2 of 6 details in'), await page.locator('.ts-progress').textContent());
    check('what is needed is marked Needed, what is in is marked In', (await page.locator('.ts-need').count()) === 4 && (await page.locator('.ts-have').count()) === 2);
    check('every box says why it is asked', (await page.locator('.ts-why').count()) === 7);
    check('the boxes are big enough for a thumb', (await page.locator('#ts-speaker_title').evaluate(e => e.getBoundingClientRect().height)) >= 44);
    await wide('on opening');

    await page.fill('#ts-speaker_title', 'Engineering Manager');
    await page.fill('#ts-speaker_bio', 'Sushil leads engineering at Trust3 AI, building security governance for enterprise AI.');
    await page.fill('#ts-speaker_phone', '98200');
    await page.click('#ts-save');
    check('a short mobile is named under its own box, and nothing is sent', await until(async () => ((await page.locator('#ts-m-speaker_phone').textContent()) || '').includes('at least 10 digits')) && (await dbq('SELECT speaker_title FROM innovation_talks WHERE id = 7'))[0].speaker_title === '');
    check('...and the box is marked wrong for screen readers', (await page.locator('#ts-speaker_phone').getAttribute('aria-invalid')) === 'true');
    await page.fill('#ts-speaker_phone', '+91 98200 12345');
    await page.setInputFiles('#ts-file', PHOTO);
    check('a chosen photo shows at once, cropped square', await until(async () => ((await page.locator('#ts-ava img').getAttribute('src')) || '').startsWith('data:image/jpeg')));
    await page.click('#ts-save');
    check('Save says thank you and that it is in the programme', await until(async () => ((await page.locator('.ts-done').textContent().catch(() => '')) || '').includes('Thank you, it is saved')));
    const row = (await dbq('SELECT speaker_title, speaker_bio, speaker_phone, speaker_photo_url, hall, starts_at FROM innovation_talks WHERE id = 7'))[0];
    check('everything they typed is in the programme, the photo too', row.speaker_title === 'Engineering Manager' && /Sushil leads/.test(row.speaker_bio) && row.speaker_phone === '+919820012345' && /^\/api\/uploads\/talks\/7-/.test(row.speaker_photo_url), row);
    check('...and the time and hall were not touched', row.hall === '' && row.starts_at === null, row);
    check('now 6 of 6 details in', ((await page.locator('.ts-progress').textContent()) || '').includes('6 of 6'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    check('coming back later shows it all saved, photo included', await until(async () => ((await page.locator('#ts-speaker_title').inputValue().catch(() => '')) === 'Engineering Manager') && ((await page.locator('#ts-ava img').getAttribute('src').catch(() => '')) || '').startsWith('/api/uploads/talks/')));
    check('the photo loads', await page.evaluate(async () => { const i = document.querySelector('#ts-ava img'); return !!i && (await fetch(i.src)).ok; }));
    await wide('after saving');

    await page.goto(BASE + '/app/my-talk?t=' + (await linkFor(7, Math.floor(Date.now() / 1000) - 60)), { waitUntil: 'domcontentloaded' });
    check('an expired link says so and how to get a new one', await until(async () => ((await page.locator('#ts-root').textContent()) || '').includes('expired')));
    await page.goto(BASE + '/app/my-talk?t=' + tok.replace(/^7\./, '8.'), { waitUntil: 'domcontentloaded' });
    check('a link changed by hand opens nothing and says what to do', await until(async () => ((await page.locator('#ts-root').textContent()) || '').includes('Open it again from the email')) && !((await page.content()).includes('Vishal')));
    await page.goto(BASE + '/app/my-talk', { waitUntil: 'domcontentloaded' });
    check('no link at all: says the link is not complete', await until(async () => ((await page.locator('#ts-root').textContent()) || '').includes('not complete')));
    check('phone: no page errors', errors.length === 0, errors);
    await ctx.close();

    const lctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, serviceWorkers: 'block' });
    await lctx.route(u => !u.hostname.startsWith('localhost'), r => r.abort());
    const lp = await lctx.newPage();
    const lerr = []; lp.on('pageerror', e => lerr.push(String(e)));
    await lp.goto(BASE + '/app/my-talk?t=' + (await linkFor(8)), { waitUntil: 'domcontentloaded' });
    check('laptop: the other talk, with its time and both hall names', await until(async () => { const t = (await lp.locator('.ts-facts').textContent()) || ''; return t.includes('Fri 20 Nov') && t.includes('Homi J. Bhabha Hall (Peacock Hall'); }));
    check('laptop: the form sits in a readable column', (await lp.locator('#ts-form').evaluate(e => e.getBoundingClientRect().width)) <= 620);
    check('laptop: no page errors', lerr.length === 0, lerr);
    await lctx.close();

    // ---- Admin: the automatic email, previewed before it is turned on ----
    const actx = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' });
    await actx.route(u => !u.hostname.startsWith('localhost'), r => r.abort());
    await actx.addInitScript(() => { if (window.top !== window) return; sessionStorage.setItem('tc_admin_token', 'h-admin'); localStorage.setItem('tc_admin', '1'); localStorage.setItem('tc_admin_operator', 'Harness'); });
    const ap = await actx.newPage();
    const aerr = []; ap.on('pageerror', e => { if (!/sandboxed/.test(String(e))) aerr.push(String(e)); });
    await ap.goto(BASE + '/admin#innovation', { waitUntil: 'domcontentloaded' });
    check('admin: the Innovation Talks tab has "Preview the email" beside the switch', await until(() => ap.locator('#italk-auto button', { hasText: 'Preview the email' }).isVisible(), 20000));
    await ap.locator('#italk-auto button', { hasText: 'Preview the email' }).click();
    check('admin: it shows the next automatic email, who it goes to, and that nothing was sent', await until(async () => {
      const t = (await ap.locator('#modal-box').textContent()) || '';
      const doc = (await ap.locator('#italk-auto-pv').getAttribute('srcdoc')) || '';
      return /Nothing has been sent/.test(t) && /please add/.test(t) && /Add my details|Add the details/.test(doc) && /my-talk\?t=/.test(doc);
    }, 10000));
    check('admin: the switch is still off', ((await ap.locator('#italk-auto').textContent()) || '').includes('Off'));
    check('admin: no page errors', aerr.length === 0, aerr);
    await actx.close();
  } finally { await browser.close(); }
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
