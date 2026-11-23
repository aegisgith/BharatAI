// "My photos" on the app's home screen (23 Nov 2026) in real Edge on an Android phone
// (390px, touch) against login-harness.mjs (the built worker on real SQLite):
// - someone with an album, signed in from the emailed link: the card at the top of the
//   home screen, their count, four photos, "See all my photos" opening their own photos
//   page, buttons a thumb can hit, no sideways scroll;
// - someone the face match has not found: "Are you in the event photos?" and Add my photo.
// The small photos are not drawn here (the harness has no R2 bucket); the store's own
// links are checked by smoke-photo-store.mjs and smoke-my-photos.mjs.
// Needs login-harness.mjs (HARNESS_PORT, default 8780).
const { chromium } = require('./playwright.cjs');
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8780);
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
const ROOT = path.join(__dirname, '..', '..');
const SHOTS = path.join(__dirname, '.out');
const ATT = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/attendee-photos.json'), 'utf8'));
const [KEY, ALBUM] = Object.entries(ATT.albums).find(([, v]) => v.photos.length >= 6);
const ID = Number(KEY.slice(1));
const FOUND = 'my.photos.found.' + Date.now() + '@example.com';
const NOBODY = 'my.photos.nobody.' + Date.now() + '@example.com';
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const post = async (p, body) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => null) }; };
const sql = async (s, args = []) => (await post('/__sql', { sql: s, args })).json;
const mail = async () => (await fetch(BASE + '/__mail')).json();
const to = (p) => (p?.Recipients?.To || [])[0] || '';
const linkIn = (p) => (((p?.Content?.Body?.[0]?.Content || '').match(/href="([^"]*token=[0-9a-f]{64}[^"]*)"/) || [])[1] || '').replace(/&amp;/g, '&');

(async () => {
  // Migration 0064 (event_photos), one statement at a time, and their photos in it.
  for (const st of fs.readFileSync(path.join(ROOT, 'migrations/0064_event_photos.sql'), 'utf8').replace(/--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)) await sql(st);
  await sql('DELETE FROM attendees WHERE id = ? OR email IN (?, ?)', [ID, FOUND, NOBODY]);
  await sql("INSERT INTO attendees (id, event_id, name, email, mobile, badge_type, payment_status, company) VALUES (?, 1, 'Asha Photos', ?, '9820055611', 'Delegate Pass', 'paid', 'Photo Labs')", [ID, FOUND]);
  await sql("INSERT INTO attendees (event_id, name, email, mobile, badge_type, payment_status, company) VALUES (1, 'Ravi Nobody', ?, '9820055612', 'Visitor Pass', 'paid', 'Nobody Labs')", [NOBODY]);
  let k = 0;
  for (const d of ALBUM.photos) await sql("INSERT OR IGNORE INTO event_photos (event_id, pid, drive_id, title, day, taken_at, camera, hall, width, height, bytes, raw) VALUES (1, ?, ?, 'x.JPG', '2026-11-20', '', 'D1 Cam 1', '', 6000, 4000, 4, 0)", ['B' + String(++k).padStart(11, '0'), d]);
  const signIn = async (email) => {
    await post('/__mail/clear', {});
    await post('/api/events/1/attendees/send-magic-link', { email });
    await sleep(200);
    const p = (await mail()).filter(m => to(m) === email).pop();
    await sql("UPDATE login_tokens SET created_at = datetime('now', '-3 minutes') WHERE email = ?", [email]);
    return linkIn(p);
  };

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const open = async (email) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: ANDROID, serviceWorkers: 'block' });
    await ctx.addInitScript(() => { try { localStorage.setItem('agba_social_card_offered', '1'); localStorage.setItem('bhai_upsell_5', '1'); } catch (e) {} });
    // The links name the real site; nothing here may reach it. Its photos pages come from
    // the harness (signed with the harness's secret), everything else of it is refused.
    await ctx.route(/^https:\/\/bharataiinnovation\.com\//, async (route) => {
      const u = new URL(route.request().url());
      if (!u.pathname.startsWith('/photos/')) return route.abort();
      const r = await fetch(BASE + u.pathname + u.search);
      return route.fulfill({ status: r.status, contentType: r.headers.get('content-type') || 'text/html', body: Buffer.from(await r.arrayBuffer()) });
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const href = await signIn(email);
    await page.goto(href.replace('https://bharataiinnovation.com', BASE), { waitUntil: 'domcontentloaded' });
    return { ctx, page, errors };
  };

  // ---- found ----
  let { ctx, page, errors } = await open(FOUND);
  const card = page.locator('#my-photos-card');
  await card.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  check('signed in: the card shows on the home screen', await card.isVisible(), 'hidden');
  const text = await card.innerText().catch(() => '');
  check('"Your photos from Mumbai" with their count', text.includes('Your photos from Mumbai') && text.includes(ALBUM.photos.length + ' photos of you'), text.slice(0, 200));
  check('four small photos', (await card.locator('img').count()) === 4, await card.locator('img').count());
  const order = await page.evaluate(() => { const a = document.getElementById('my-photos-card'), b = document.getElementById('share-moment-card'); return a && b ? !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) : null; });
  check('it comes first, above "Share your Bharat AI moment"', order === true, order);
  const btn = card.getByText('See all my photos');
  const box = await btn.boundingBox();
  check('the button is big enough for a thumb (44px)', !!box && box.height >= 44, JSON.stringify(box));
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  check('no sideways scroll at 390px', wide <= 390, wide);
  await card.scrollIntoViewIfNeeded();
  fs.mkdirSync(SHOTS, { recursive: true });
  await card.screenshot({ path: path.join(SHOTS, 'my-photos-found.png') });
  const [tab] = await Promise.all([ctx.waitForEvent('page', { timeout: 15000 }).catch(() => null), btn.tap()]);
  if (tab) await tab.waitForLoadState('domcontentloaded').catch(() => {});
  // A noopener tab may not report its address to Playwright; the button's own link does.
  const url = (tab && tab.url()) || (await card.locator('a', { hasText: 'See all my photos' }).getAttribute('href')) || '';
  check('it goes to their own photos page, signed, in a new tab', !!tab && /\/photos\/a\d+\?k=[0-9a-f]{32}$/.test(url) && url.includes('/photos/' + KEY + '?'), url);
  const html = tab ? await tab.content().catch(() => '') : '';
  check('the photos page opens (not "link not complete")', !!tab && html.length > 500 && !/not complete/i.test(html), html.slice(0, 200));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();

  // ---- not found ----
  ({ ctx, page, errors } = await open(NOBODY));
  await card.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  const c2 = page.locator('#my-photos-card');
  await c2.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  const t2 = await c2.innerText().catch(() => '');
  check('not found: "Are you in the event photos?" with Add my photo', t2.includes('Are you in the event photos?') && t2.includes('Add my photo'), t2.slice(0, 200));
  const b2 = await c2.getByText('Add my photo').boundingBox();
  check('its button is big enough for a thumb (44px)', !!b2 && b2.height >= 44, JSON.stringify(b2));
  await c2.scrollIntoViewIfNeeded();
  await c2.screenshot({ path: path.join(SHOTS, 'my-photos-notfound.png') });
  check('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();

  await browser.close();
  console.log(`\n${fails ? fails + ' failed' : 'all passed'}`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
