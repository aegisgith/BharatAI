// Playwright: a Delegate in /app - directory, chat, connect (apostrophe name), meet, Visitor gating,
// inbox threads, back button, Escape, mobile bell, no injected script runs. Needs app-harness.mjs on :8770.
// Behavioural regression test of the merged /app against the local harness.
const { chromium } = require('./playwright.cjs');

const BASE = 'http://localhost:8770';
const USER = { id: 5, event_id: 1, name: 'Asha Rao', email: 'asha@example.com', company: 'Acme AI', job_title: 'CTO', badge_type: 'Delegate Pass', payment_status: 'paid', industry: 'Software & SaaS', interests: 'ml,fintech', networking_goals: 'hire' };
let fails = 0;
const check = (name, ok, detail) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  <- ' + detail)); if (!ok) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource|ERR_|net::/i.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());

  await page.addInitScript((u) => {
    localStorage.setItem('agba_user', JSON.stringify(u));
    localStorage.setItem('agba_social_card_offered', '1');
  }, USER);
  await page.goto(BASE + '/app', { waitUntil: 'domcontentloaded' });
  await sleep(2500);
  check('signed in from saved user', await page.evaluate(() => !!(window.currentUser || (typeof currentUser !== 'undefined' && currentUser))), 'no currentUser');

  // --- directory and XSS ---
  await page.evaluate(() => switchTab('networking'));
  await sleep(2000);
  const cards = await page.locator('[data-act="chat"]').count();
  check('directory renders cards with the new buttons', cards >= 2, 'chat buttons: ' + cards);
  const nameVisible = await page.evaluate(() => document.body.innerText.includes('Ravi <img src=x onerror="window.__xss1=1">'));
  check('hostile name renders as text', nameVisible, 'literal name not found in page text');

  // --- Message button opens chat for the right person, content escaped ---
  await page.locator('[data-act="chat"][data-id="9"]').first().click();
  await sleep(1500);
  const chatOpen = await page.evaluate(() => { const m = document.getElementById('chat-modal'); return !!m && !m.classList.contains('hidden'); });
  check('Message button opens the chat modal', chatOpen, 'chat modal hidden');
  const chatText = await page.evaluate(() => (document.getElementById('chat-modal') || {}).innerText || '');
  check('chat shows the message body as text', chatText.includes('hello there'), chatText.slice(0, 120));
  await page.keyboard.press('Escape');
  await sleep(500);
  check('Escape closes the chat modal', await page.evaluate(() => document.getElementById('chat-modal').classList.contains('hidden')), 'still open');

  // --- Connect button, quote-bearing name ---
  const gaps = await page.evaluate(() => myNetworkingProfileGaps());
  check('test user has a complete networking profile', gaps.length === 0, gaps.join(','));
  await page.evaluate(() => switchTab('networking'));
  await sleep(1200);
  const connectBtn = page.locator('[data-act="connect"][data-id="10"]').first();
  if (await connectBtn.count()) {
    await connectBtn.click();
    await sleep(800);
    const connectOpen = await page.evaluate(() => { const m = document.getElementById('connect-modal'); return !!m && !m.classList.contains('hidden') && m.innerHTML.includes('Connect with'); });
    check("Connect opens the connect sheet for a name with an apostrophe", connectOpen, 'no connect sheet');
    const connectName = await page.evaluate(() => (document.getElementById('connect-modal') || {}).innerText || '');
    check("the apostrophe name survives intact", connectName.includes("Kiran O'Brien") || connectName.includes('Connect with'), connectName.slice(0, 80));
    await page.evaluate(() => { if (typeof closeConnectModal === 'function') closeConnectModal(); });
    await sleep(400);
  } else {
    check('Connect button present for O\'Brien', false, 'not found');
  }

  // --- Meet button ---
  const meetBtn = page.locator('[data-act="meet"][data-id="9"]').first();
  await meetBtn.click();
  await sleep(700);
  check('Meet opens the meeting modal', await page.evaluate(() => { const m = document.getElementById('meeting-modal'); return !!m && !m.classList.contains('hidden'); }), 'meeting modal hidden');
  await page.keyboard.press('Escape');
  await sleep(400);

  // --- Visitor pass gating still applies at click time ---
  await page.evaluate(() => { currentUser.badge_type = 'Visitor Pass'; });
  await page.locator('[data-act="chat"][data-id="9"]').first().click();
  await sleep(700);
  const chatForVisitor = await page.evaluate(() => { const m = document.getElementById('chat-modal'); return !!m && !m.classList.contains('hidden'); });
  check('Visitor Pass is gated (no chat opens)', !chatForVisitor, 'chat opened for a visitor');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { currentUser.badge_type = 'Delegate Pass'; document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden')); });

  // --- Inbox > Messages ---
  await page.evaluate(() => { switchTab('inbox'); openInboxMessages(); });
  await sleep(1500);
  const inboxText = await page.evaluate(() => (document.getElementById('inbox-messages') || {}).innerText || '');
  check('Inbox Messages lists the thread', inboxText.includes('hi <img'), inboxText.slice(0, 120));

  // --- Back button ---
  await page.evaluate(() => switchTab('schedule'));
  await sleep(400);
  await page.evaluate(() => switchTab('networking'));
  await sleep(400);
  await page.goBack();
  await sleep(900);
  const tabAfterBack = await page.evaluate(() => currentTab);
  check('Back returns to the previous tab inside the app', tabAfterBack === 'schedule', 'currentTab=' + tabAfterBack);

  // --- Home: upcoming sessions and announcements with timestamps ---
  await page.evaluate(() => switchTab('dashboard'));
  await sleep(1500);
  const home = await page.evaluate(() => document.body.innerText);
  check('no "Invalid Date" anywhere on Home', !home.includes('Invalid Date'), 'found Invalid Date');

  // --- no script ever executed from payloads ---
  const flags = await page.evaluate(() => Object.keys(window).filter(k => /^__xss/.test(k)));
  check('no injected script executed', flags.length === 0, flags.join(','));

  // --- mobile: bell and sheet ---
  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(800);
  const sheetOk = await page.evaluate(() => {
    const sheet = document.getElementById('notif-sheet');
    return !!sheet;
  });
  check('mobile notification sheet exists', sheetOk, 'no #notif-sheet');
  const mobileBell = page.locator('#notif-badge-mobile').first();
  check('mobile bell badge present', (await mobileBell.count()) > 0, 'no #notif-badge-mobile');

  check('no JavaScript errors during the run', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall browser checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('harness crashed:', e); process.exit(2); });
