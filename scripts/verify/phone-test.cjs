// Playwright on an emulated Android phone (390px, touch): photo upload, creative share sheet, in-app
// browser fallback, "Are you coming?", panel certificate, pass, November question, email answers through
// the real /panel-rsvp routes, free-pass directory, admin Campus panels block. Needs phone-harness.mjs on :8772.
// Playwright on an emulated Android phone: the student journey, end to end.
const { chromium } = require('./playwright.cjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const BASE = 'http://localhost:8772';
const SHOTS = path.join(__dirname, '.out', 'phone-shots');
const PHOTO = path.join(__dirname, '..', '..', 'public', 'images', 'speaker-virendra-pal.webp');
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const setState = (page, body) => page.evaluate((b) => fetch('/api/__state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json()), body);
const getState = (page) => page.evaluate(() => fetch('/api/__state').then(r => r.json()));

async function phone(browser, { canShare }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: UA });
  await ctx.addInitScript(({ canShare }) => {
    window.__shares = []; window.__clip = [];
    try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { window.__clip.push(t); return Promise.resolve(); } } }); } catch (e) {}
    if (canShare) {
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: (d) => !!(d && d.files && d.files.length) });
      Object.defineProperty(navigator, 'share', { configurable: true, value: (d) => { window.__shares.push({ files: (d.files || []).map(f => ({ name: f.name, type: f.type, size: f.size })), text: d.text || '' }); return Promise.resolve(); } });
    } else {
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined });
      Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    }
    try { Object.defineProperty(screen, 'width', { configurable: true, get: () => 390 }); Object.defineProperty(screen, 'height', { configurable: true, get: () => 844 }); } catch (e) {}
    localStorage.setItem('agba_social_card_offered', '1');
    localStorage.setItem('bhai_upsell_5', '1');
  }, { canShare });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource|net::|404/i.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  return { ctx, page, errors };
}
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const tall = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return 0; return e.getBoundingClientRect().height; }, sel);

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });

  // ---------- 1. From the email: photo, then the panel creative, shared to the share sheet ----------
  {
    const { ctx, page, errors } = await phone(browser, { canShare: true });
    await page.goto(BASE + '/app', { waitUntil: 'domcontentloaded' });
    await setState(page, { reset: true });
    await page.evaluate(() => localStorage.setItem('agba_user', JSON.stringify({ id: 5, event_id: 1, name: 'Riya Shah', email: 'riya@gmail.com', badge_type: 'Visitor Pass', company: 'Dwarkadas J. Sanghvi College of Engineering', job_title: 'Student' })));
    await page.goto(BASE + '/app?action=social-card', { waitUntil: 'domcontentloaded' });
    await sleep(3500);
    const ask = await page.locator('#pass-photo-pick').count();
    check('1. email link lands on the photo ask (no photo yet)', ask === 1, 'photo ask not shown');
    check('1. photo buttons are thumb-sized (>= 40px)', (await tall(page, '#pass-photo-pick')) >= 40 && (await tall(page, '#pass-photo-shoot')) >= 40, 'buttons too small');
    check('1. the camera button opens the camera directly', (await page.getAttribute('#pass-photo-camera', 'capture')) === 'user', 'no capture attribute');
    await page.screenshot({ path: SHOTS + '/1-photo-ask.png' });
    await page.setInputFiles('#pass-photo-input', PHOTO);
    await sleep(4000);
    const st = await getState(page);
    check('1. the photo uploads from the phone', st.records.some(r => r.what === 'avatar'), JSON.stringify(st.records.map(r => r.what)));
    const modalOpen = await page.evaluate(() => { const m = document.getElementById('social-card-modal'); return !!m && !m.classList.contains('hidden'); });
    check('1. the creative opens right after the photo', modalOpen, 'social card modal not open');
    await page.waitForFunction(() => { const i = document.getElementById('sc-preview'); return i && i.style.display === 'block' && i.naturalWidth > 0; }, null, { timeout: 20000 }).catch(() => {});
    await page.waitForFunction(() => !document.getElementById('sc-share-primary').classList.contains('hidden'), null, { timeout: 10000 }).catch(() => {});
    check('1. it is the panel creative, with the conference one a tap away', await page.evaluate(() => !document.getElementById('sc-mode-row').classList.contains('hidden')), 'mode row hidden');
    check('1. the share button is shown on a phone that can share', await page.evaluate(() => !document.getElementById('sc-share-primary').classList.contains('hidden')), 'share hidden');
    check('1. the share button is thumb-sized', (await tall(page, '#sc-share-primary')) >= 40, 'too small');
    check('1. nothing overflows sideways at 390px', await noOverflow(page), 'horizontal overflow');
    await page.screenshot({ path: SHOTS + '/1-creative.png' });
    await page.locator('#sc-share-primary').click();
    await sleep(1200);
    const shares = await page.evaluate(() => window.__shares), clip = await page.evaluate(() => window.__clip);
    check('1. one tap opens the share sheet with the picture file', shares.length === 1 && shares[0].files.length === 1 && /CampusSeries.*\.png$/.test(shares[0].files[0].name) && shares[0].files[0].type === 'image/png' && shares[0].files[0].size > 50000, JSON.stringify(shares));
    check('1. the caption goes with it (WhatsApp) and is copied for LinkedIn', shares[0] && /Pre-Event Panel Discussion/.test(shares[0].text) && clip.some(t => /Pre-Event Panel Discussion/.test(t)), JSON.stringify({ text: shares[0] && shares[0].text.slice(0, 60), clip: clip.length }));
    check('1. no JavaScript errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ---------- 2. In-app browser (LinkedIn / Instagram): no share sheet, no downloads ----------
  {
    const { ctx, page, errors } = await phone(browser, { canShare: false });
    await page.goto(BASE + '/app', { waitUntil: 'domcontentloaded' });
    await setState(page, { reset: true, set: {} });
    await page.evaluate(() => fetch('/api/__state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ set: { user: { id: 5, event_id: 1, name: 'Riya Shah', email: 'riya@gmail.com', company: 'Dwarkadas J. Sanghvi College of Engineering', job_title: 'Student', badge_type: 'Visitor Pass', avatar_url: '/api/uploads/avatars/5.webp', industry: 'Education & Academia', interests: 'ml' } } }) }));
    await page.evaluate(() => localStorage.setItem('agba_user', JSON.stringify({ id: 5, event_id: 1, name: 'Riya Shah', email: 'riya@gmail.com', badge_type: 'Visitor Pass', avatar_url: '/api/uploads/avatars/5.webp' })));
    await page.goto(BASE + '/app?action=social-card', { waitUntil: 'domcontentloaded' });
    await sleep(3000);
    await page.waitForFunction(() => { const i = document.getElementById('sc-preview'); return i && i.style.display === 'block'; }, null, { timeout: 20000 }).catch(() => {});
    await sleep(800);
    check('2. no share button where sharing is impossible', await page.evaluate(() => document.getElementById('sc-share-primary').classList.contains('hidden')), 'share button shown');
    check('2. a plain hint explains what to do', await page.evaluate(() => !document.getElementById('sc-phone-hint').classList.contains('hidden')), 'hint hidden');
    check('2. the button says Save picture', (await page.textContent('#sc-download-label')) === 'Save picture', await page.textContent('#sc-download-label'));
    await page.locator('#sc-download-label').click();
    await sleep(900);
    const ov = await page.evaluate(() => { const o = document.getElementById('image-to-save'); if (!o) return null; const wa = o.querySelector('a[href^="https://wa.me/?text="]'); return { img: !!o.querySelector('img[src^="data:image/png"]'), wa: wa ? decodeURIComponent(wa.getAttribute('href')).slice(0, 200) : '', copy: !!document.getElementById('its-copy'), share: document.getElementById('its-share').style.display }; });
    check('2. Save picture shows the picture full screen to press and hold', !!ov && ov.img, JSON.stringify(ov));
    check('2. WhatsApp opens with the caption filled in', !!ov && /Pre-Event Panel Discussion/.test(ov.wa), JSON.stringify(ov));
    check('2. copy caption is offered, share hidden', !!ov && ov.copy && ov.share === 'none', JSON.stringify(ov));
    check('2. the viewer fits a 390px phone', await noOverflow(page), 'overflow');
    await page.screenshot({ path: SHOTS + '/2-save-picture.png' });
    await page.click('#its-close');
    await sleep(300);
    check('2. the viewer closes', await page.evaluate(() => !document.getElementById('image-to-save')), 'still open');
    check('2. no JavaScript errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ---------- 3. "Are you coming?" on the panel card, and 4. the certificate ----------
  {
    const { ctx, page, errors } = await phone(browser, { canShare: true });
    await page.goto(BASE + '/app', { waitUntil: 'domcontentloaded' });
    await setState(page, { reset: true });
    await page.evaluate(() => fetch('/api/__state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ set: { user: { id: 5, event_id: 1, name: 'Riya Shah', email: 'riya@gmail.com', company: 'Dwarkadas J. Sanghvi College of Engineering', job_title: 'Student', badge_type: 'Visitor Pass', avatar_url: '/api/uploads/avatars/5.webp', industry: 'Education & Academia', interests: 'ml' } } }) }));
    await page.evaluate(() => localStorage.setItem('agba_user', JSON.stringify({ id: 5, event_id: 1, name: 'Riya Shah', email: 'riya@gmail.com', badge_type: 'Visitor Pass', avatar_url: '/api/uploads/avatars/5.webp' })));
    await page.goto(BASE + '/app?from=email#myprofile', { waitUntil: 'domcontentloaded' });
    await sleep(3500);
    await page.evaluate(() => { if (typeof switchTab === 'function') switchTab('myprofile'); });
    await page.waitForFunction(() => /Are you coming|You told us/.test((document.getElementById('my-panels') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
    const block = await page.evaluate(() => (document.getElementById('my-panels') || {}).innerText || '');
    check('3. the panel card asks "Are you coming?" in plain words', /Are you coming\?/.test(block) && !/RSVP/i.test(block), block.slice(0, 120));
    const yesBtn = page.locator('#my-panels button:has-text("I’m coming")').first();
    check('3. the answer buttons are thumb-sized', (await yesBtn.boundingBox() || { height: 0 }).height >= 36, JSON.stringify(await yesBtn.boundingBox()));
    await page.screenshot({ path: SHOTS + '/3-are-you-coming.png' });
    await yesBtn.click();
    await sleep(2000);
    const st = await getState(page);
    check('3. tapping I’m coming saves yes', st.records.some(r => r.what === 'panel-answer' && r.body && r.body.answer === 'yes'), JSON.stringify(st.records.map(r => r.what)));
    const after = await page.evaluate(() => (document.getElementById('my-panels') || {}).innerText || '');
    check('3. the card now confirms it', /You told us you are coming/.test(after), after.slice(0, 120));
    check('3. My Profile fits a 390px phone', await noOverflow(page), 'overflow');

    // certificate after claiming
    await setState(page, { set: { panels: [{ ...(st.panels[0]), claimed_at: '2026-09-21 06:50:00', claim_state: 'open', rsvp_open: false }] } });
    await page.evaluate(() => { myPanels = null; renderMyPanels(); });
    await sleep(1500);
    await page.locator('#my-panels button:has-text("Download certificate")').first().click();
    await sleep(3500);
    const cert = await page.evaluate(() => { const o = document.getElementById('image-to-save'); return o ? { img: !!o.querySelector('img[src^="data:image/png"]'), title: o.innerText.slice(0, 40), share: document.getElementById('its-share').style.display } : null; });
    check('4. on a phone the certificate opens to share or save, not a lost download', !!cert && cert.img && /certificate/i.test(cert.title), JSON.stringify(cert));
    check('4. share is offered for the certificate', !!cert && cert.share === 'block', JSON.stringify(cert));
    await page.screenshot({ path: SHOTS + '/4-certificate.png' });
    await page.click('#its-share');
    await sleep(800);
    const certShares = await page.evaluate(() => window.__shares);
    check('4. sharing the certificate sends the PNG', certShares.length >= 1 && /Certificate\.png$/.test(certShares.at(-1).files[0].name), JSON.stringify(certShares));
    check('3-4. no JavaScript errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ---------- 5. The event pass on a phone ----------
  {
    const { ctx, page, errors } = await phone(browser, { canShare: true });
    await page.goto(BASE + '/app', { waitUntil: 'domcontentloaded' });
    await setState(page, { reset: true });
    await page.evaluate(() => fetch('/api/__state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ set: { mainEvent: 1, user: { id: 5, event_id: 1, name: 'Riya Shah', email: 'riya@gmail.com', company: 'Acme', job_title: 'Engineer', badge_type: 'Delegate Pass', payment_status: 'paid', avatar_url: '/api/uploads/avatars/5.webp', industry: 'Software & SaaS', interests: 'ml' } } }) }));
    await page.evaluate(() => localStorage.setItem('agba_user', JSON.stringify({ id: 5, event_id: 1, name: 'Riya Shah', email: 'riya@gmail.com', badge_type: 'Delegate Pass', payment_status: 'paid', avatar_url: '/api/uploads/avatars/5.webp' })));
    await page.goto(BASE + '/app', { waitUntil: 'domcontentloaded' });
    await sleep(3500);
    await page.evaluate(() => generateEventPass());
    await sleep(6000);
    const pass = await page.evaluate(() => { const o = document.getElementById('image-to-save'); return o ? { img: !!o.querySelector('img[src^="data:image/png"]'), title: o.innerText.slice(0, 30) } : null; });
    check('5. the pass opens to share or save on a phone', !!pass && pass.img && /pass/i.test(pass.title), JSON.stringify(pass));
    await page.screenshot({ path: SHOTS + '/5-pass.png' });
    check('5. no JavaScript errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ---------- 6. The November question for a panel-only student ----------
  {
    const { ctx, page, errors } = await phone(browser, { canShare: true });
    await page.goto(BASE + '/app', { waitUntil: 'domcontentloaded' });
    await setState(page, { reset: true });
    await page.evaluate(() => fetch('/api/__state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ set: { mainEvent: 0 } }) }));
    await page.evaluate(() => localStorage.setItem('agba_user', JSON.stringify({ id: 5, event_id: 1, name: 'Riya Shah', email: 'riya@gmail.com', badge_type: 'Visitor Pass' })));
    await page.goto(BASE + '/app', { waitUntil: 'domcontentloaded' });
    await sleep(3000);
    await page.evaluate(() => switchTab('myprofile'));
    await page.waitForFunction(() => /count me in/.test((document.getElementById('my-panels') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
    const q = page.locator('#my-panels button:has-text("Yes, count me in")').first();
    check('6. the November question shows for a panel-only student', (await q.count()) === 1, 'not shown');
    await q.click();
    await sleep(1500);
    const st = await getState(page);
    check('6. one tap answers it', st.records.some(r => r.what === 'main-event' && r.body.answer === 'yes'), JSON.stringify(st.records.map(r => r.what)));
    check('6. no JavaScript errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ---------- 7. The email buttons, through the real server routes, on a phone ----------
  {
    const { ctx, page, errors } = await phone(browser, { canShare: true });
    await page.goto(BASE + '/app', { waitUntil: 'domcontentloaded' });
    await setState(page, { reset: true });
    const sig = (a, p, r) => crypto.createHmac('sha256', 'h-secret').update(`panel-rsvp:${a}:${p}:${r}`).digest('hex').slice(0, 32);
    await page.goto(`${BASE}/panel-rsvp?a=5&p=djsanghvi-21sep&r=yes&s=${sig(5, 'djsanghvi-21sep', 'yes')}`, { waitUntil: 'load' });
    await page.waitForLoadState('load');
    await sleep(1500);
    const text = await page.evaluate(() => document.body.innerText);
    check('7. tapping "Yes, I’m coming" in the email saves and says See you there', /See you there/.test(text), text.slice(0, 120));
    check('7. a guest is told to carry photo ID', /photo ID/.test(text), text.slice(0, 200));
    check('7. the page fits the phone', await noOverflow(page), 'overflow');
    check('7. the page never says RSVP', !/RSVP/i.test(text), 'RSVP wording');
    await page.screenshot({ path: SHOTS + '/7-see-you-there.png' });
    await page.locator('a:has-text("Plans changed")').click();
    await page.waitForLoadState('load');
    await sleep(1500);
    const text2 = await page.evaluate(() => document.body.innerText);
    check('7. "Plans changed?" switches the answer to no', /Thanks for letting us know/.test(text2), text2.slice(0, 120));
    const st = await getState(page);
    check('7. both answers reached the database in order', st.dbWrites.length === 2 && st.dbWrites[0].answer === 'yes' && st.dbWrites[1].answer === 'no', JSON.stringify(st.dbWrites));
    check('7. no JavaScript errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ---------- 8. Free-pass directory on a phone ----------
  {
    const { ctx, page, errors } = await phone(browser, { canShare: true });
    await page.goto(BASE + '/app', { waitUntil: 'domcontentloaded' });
    await setState(page, { reset: true });
    await page.evaluate(() => fetch('/api/__state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ set: { user: { id: 5, event_id: 1, name: 'Riya Shah', email: 'riya@gmail.com', company: 'DJ Sanghvi', job_title: 'Student', badge_type: 'Visitor Pass', avatar_url: '/api/uploads/avatars/5.webp', industry: 'Education & Academia', interests: 'ml' } } }) }));
    await page.evaluate(() => localStorage.setItem('agba_user', JSON.stringify({ id: 5, event_id: 1, name: 'Riya Shah', email: 'riya@gmail.com', badge_type: 'Visitor Pass' })));
    await page.goto(BASE + '/app', { waitUntil: 'domcontentloaded' });
    await sleep(3000);
    await page.evaluate(() => switchTab('networking'));
    await sleep(2500);
    check('8. locked cards render on a phone', (await page.locator('text=See who this is').count()) === 2, 'locked cards');
    check('8. the directory fits a 390px phone', await noOverflow(page), 'overflow');
    await page.screenshot({ path: SHOTS + '/8-directory.png', fullPage: false });
    check('8. no JavaScript errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ---------- 9. Admin: the Campus panels block (organiser, desktop) ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await ctx.addInitScript(() => { sessionStorage.setItem('tc_admin_token', 'h-admin'); localStorage.setItem('tc_admin', '1'); localStorage.setItem('tc_admin_operator', 'Harness'); });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('dialog', d => d.accept());
    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    await sleep(3000);
    await setState(page, { reset: true });
    await page.waitForFunction(() => !!document.getElementById('campus-panels'), null, { timeout: 20000 }).catch(() => {});
    await page.evaluate(() => renderCampusPanels());
    await page.waitForFunction(() => /Are you coming/.test((document.getElementById('campus-panels') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => document.getElementById('campus-panels').scrollIntoView());
    const html = await page.evaluate(() => (document.getElementById('campus-panels') || {}).innerText || '');
    check('9. admin shows the answers: coming, can’t make it, no answer, guests', /12\s*coming/.test(html) && /3\s*can’t make it/.test(html) && /416\s*no answer yet/.test(html) && /4\s*coming from outside DJ Sanghvi/.test(html), html.slice(0, 400));
    const sendBtn = page.locator('#panel-remind-djsanghvi-21sep');
    check('9. the send button reads in plain words with the count', /Send “Are you coming\?” \(416 to send\)/.test(await sendBtn.innerText()), await sendBtn.innerText());
    await sendBtn.click();
    await sleep(2500);
    let st = await getState(page);
    check('9. Send pumps the reminder route', st.records.some(r => r.what === 'send-reminders'), JSON.stringify(st.records.map(r => r.what)));
    await page.evaluate(() => renderCampusPanels());
    await sleep(800);
    await page.locator('button:has-text("Guests coming (for the college)")').click();
    await sleep(1500);
    st = await getState(page);
    check('9. Guests coming downloads through the authenticated route', st.records.some(r => r.what === 'answers-csv'), JSON.stringify(st.records.map(r => r.what)));
    await page.screenshot({ path: SHOTS + '/9-admin-block.png', clip: await page.evaluate(() => { const r = document.getElementById('campus-panels').getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top - 10), width: 1366, height: Math.min(900, r.height + 20) }; }) }).catch(() => {});
    check('9. no JavaScript errors in admin', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall phone and admin checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('crashed:', e); process.exit(2); });
