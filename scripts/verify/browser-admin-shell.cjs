// The admin frame of 24 Nov 2026 in a real browser (Edge) on the real built worker and
// real SQLite (board-harness.mjs): the sidebar in groups that fold, Ask (Ctrl+K) going
// to a screen and answering a question, the Overview's "Today at a glance" and "Jump
// to", the phone's bottom bar, drawer and bottom-sheet forms, and every screen still
// opening on a laptop and a phone with nothing wider than the screen and no page error.
// Workers AI is not in the harness, so the route answers { ai: false } and the page
// answers from the dashboard's own totals; an AI answer is played once by intercepting
// /api/admin/assist, to check what the page sends and how it shows the reply.
// Needs board-harness.mjs (HARNESS_PORT, default 8782). Started by run-all.mjs.
const pw = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8782);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0, passes = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 400))); if (ok) passes++; else fails++; };
const until = async (fn, ms) => { const t = Date.now() + ms; while (Date.now() < t) { try { if (await fn()) return true; } catch {} await sleep(250); } return false; };
const signIn = (ctx) => ctx.addInitScript(() => { sessionStorage.setItem('tc_admin_token', 'h-admin'); localStorage.setItem('tc_admin', '1'); localStorage.setItem('tc_admin_autorefresh', '0'); });

(async () => {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { const r = await fetch(BASE + '/api/events/1'); up = r.ok; } catch {} if (!up) await sleep(1000); }
  if (!up) { console.log('FAIL the harness never came up'); process.exit(1); }
  const browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
  try {
    // ================= a laptop =================
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
    await signIn(ctx);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    await until(() => page.evaluate(() => /Waiting on you/.test((document.getElementById('ov-board') || {}).innerText || '')), 30000);

    // ---- the sidebar ----
    const nav = await page.evaluate(() => ({
      groups: [...document.querySelectorAll('#sidebar .as-group-label span')].map(s => s.textContent.trim()),
      ids: [...document.querySelectorAll('#sidebar .sidebar-btn[data-section]')].map(b => b.getAttribute('data-section')),
      firstMatchInSidebar: [...document.querySelectorAll('#sidebar .sidebar-btn[data-section]')].every(b => document.querySelector('[data-section="' + b.getAttribute('data-section') + '"]') === b),
      after: document.querySelector('[data-section="after"]').textContent.trim(),
      conf: document.querySelector('[data-section="sessions"] .sidebar-label').textContent.trim(),
      tabbar: getComputedStyle(document.getElementById('as-tabbar')).display,
      ask: getComputedStyle(document.getElementById('as-ask-btn')).display,
    }));
    check('six groups in the sidebar, by name', JSON.stringify(nav.groups) === JSON.stringify(['People', 'Programme', 'Exhibition & sponsors', 'Inbox', 'Money & reports', 'Next events']), nav.groups);
    check('all 26 screens in the sidebar, Overview first and Settings last', nav.ids.length === 26 && nav.ids[0] === 'overview' && nav.ids[25] === 'settings', nav.ids);
    check('each sidebar button is still the first [data-section] on the page', nav.firstMatchInSidebar);
    check('the buttons say what they said: After the Event, Conference', nav.after === 'After the Event' && nav.conf === 'Conference', nav.after + ' / ' + nav.conf);
    check('a laptop: no bottom bar, the Ask button in the top bar', nav.tabbar === 'none' && nav.ask !== 'none', nav);

    // A group folds, stays folded after a reload, and opens when one of its screens is opened.
    await page.click('#sidebar .as-nav-group[data-group="programme"] .as-group-label');
    let folded = await page.evaluate(() => ({ hidden: !document.querySelector('[data-section="liveqa"]').offsetParent, exp: document.querySelector('[data-group="programme"] .as-group-label').getAttribute('aria-expanded') }));
    check('Programme folds: Live Q&A hidden, aria-expanded false', folded.hidden && folded.exp === 'false', folded);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await until(() => page.evaluate(() => typeof AdminShell === 'object'), 20000);
    check('...and is still folded after a reload', await page.evaluate(() => document.querySelector('[data-group="programme"]').classList.contains('as-closed')));
    await page.evaluate(() => switchSection('liveqa'));
    check('...and opens when Live Q&A is opened from elsewhere', await until(() => page.evaluate(() => !!document.querySelector('[data-section="liveqa"]').offsetParent), 3000));
    await page.click('#sidebar .as-nav-group[data-group="programme"] .as-group-label');
    await page.click('#sidebar .as-nav-group[data-group="programme"] .as-group-label');
    await page.evaluate(() => localStorage.removeItem('as_nav_closed'));

    // ---- Booth Leads has a title ----
    await page.click('[data-section="boothleads"]');
    check('Booth Leads has its own title (it read "boothleads")', await until(() => page.evaluate(() => document.getElementById('page-title').textContent === 'Booth Leads'), 5000), await page.evaluate(() => document.getElementById('page-title').textContent));

    // ---- Ask: going to a screen ----
    await page.click('[data-section="overview"]');
    await page.keyboard.press('Control+k');
    check('Ctrl+K opens Ask with the cursor in it', await until(() => page.evaluate(() => !document.getElementById('as-palette').hidden && document.activeElement && document.activeElement.id === 'as-pal-input'), 3000));
    const empty = await page.evaluate(() => document.getElementById('as-pal-list').innerText);
    // The headings are upper-cased by CSS, and innerText reads them that way.
    check('empty, it offers questions, what is waiting and every screen', /What needs me today\?/.test(empty) && /Waiting on you/i.test(empty) && /All screens/i.test(empty) && /Workshop Seats/.test(empty), empty.slice(0, 300));
    await page.keyboard.press('Enter');
    check('Enter on the empty box goes nowhere', await page.evaluate(() => !document.getElementById('as-palette').hidden && currentSection === 'overview'));
    await page.keyboard.type('pay');
    const first = await page.evaluate(() => (document.querySelector('#as-pal-list .as-opt.is-on') || {}).innerText || '');
    check('typing "pay": Payments is the first line', /^Payments/.test(first.trim()), first);
    await page.keyboard.press('Enter');
    check('Enter opens Payments and closes Ask', await until(() => page.evaluate(() => document.getElementById('page-title').textContent === 'Payments & Invoices' && document.getElementById('as-palette').hidden), 5000));
    await page.keyboard.press('Control+k');
    await page.keyboard.type('check in');
    const ci = await page.evaluate(() => [...document.querySelectorAll('#as-pal-list .as-opt')].map(o => o.innerText.split('\n')[0]));
    check('"check in" finds the Badge Desk', ci.some(t => /Badge Desk/.test(t)), ci);
    await page.keyboard.press('Escape');
    check('Esc closes Ask', await page.evaluate(() => document.getElementById('as-palette').hidden));

    // ---- Ask: a question, without the AI ----
    await page.click('#as-ask-btn');
    await page.keyboard.type('How many have checked in?');
    const q1 = await page.evaluate(() => (document.querySelector('#as-pal-list .as-opt.is-on') || {}).innerText || '');
    check('a question: asking the AI is the first line', /Ask AI/.test(q1), q1);
    await page.keyboard.press('Enter');
    const ans = await until(() => page.evaluate(() => /dashboard’s own numbers/.test(document.getElementById('as-pal-answer').innerText)), 15000);
    const ansText = await page.evaluate(() => document.getElementById('as-pal-answer').innerText);
    check('no AI here: the dashboard\'s own lines answer it, with the check-in line', ans && /Checked in at the badge desk/.test(ansText) && /not reachable/.test(ansText), ansText.slice(0, 400));
    check('...and a button to the Badge Desk', /Open Badge Desk/.test(ansText), ansText);
    await page.click('#as-pal-answer .as-open-btn[data-as-go="badge-desk"]');
    check('...which opens it', await until(() => page.evaluate(() => currentSection === 'badge-desk' && document.getElementById('as-palette').hidden), 5000));

    // ---- Ask: an AI answer, played ----
    let sent = null;
    await page.route('**/api/admin/assist', async (route) => {
      sent = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ai: true, answer: '24 people chose a paid pass and have not paid.\n<img src=x onerror=window.__xss=1>', open: ['payments'] }) });
    });
    await page.keyboard.press('Control+k');
    await page.keyboard.type('Who has not paid?');
    await page.keyboard.press('Enter');
    await until(() => page.evaluate(() => /Written by AI/.test(document.getElementById('as-pal-answer').innerText)), 10000);
    const ai = await page.evaluate(() => ({ text: document.getElementById('as-pal-answer').innerText, img: !!document.querySelector('#as-pal-answer img'), xss: !!window.__xss }));
    check('an AI answer is shown, marked as written by AI and checked', /24 people chose a paid pass/.test(ai.text) && /Every number in it was checked/.test(ai.text), ai.text);
    check('...as text: markup in it is never run', !ai.img && !ai.xss && /<img src=x/.test(ai.text), ai);
    check('...with its screen to open', /Open Payments/.test(ai.text));
    const lines = (sent && sent.facts && sent.facts.lines) || [];
    const line = (k) => (lines.find(l => l.k === k) || {}).v;
    check('the page sent the question and the totals', sent && sent.mode === 'ask' && sent.q === 'Who has not paid?' && lines.length > 20, sent && { mode: sent.mode, q: sent.q, n: lines.length });
    check('...the same "in all" as the board\'s Waiting on you (72), and 2,793 registered', line('Waiting on you, in all') === 72 && line('Registered for the conference, everyone') === 2793, { inAll: line('Waiting on you, in all'), reg: line('Registered for the conference, everyone') });
    check('...and no address, name or mobile of anyone', !JSON.stringify(sent).includes('@') && !/example\.com|Visitor \d|98200/.test(JSON.stringify(sent)), JSON.stringify(sent).slice(0, 300));
    await page.keyboard.press('Escape');
    await page.unroute('**/api/admin/assist');

    // ---- the Overview ----
    await page.click('[data-section="overview"]');
    const glance = await until(() => page.evaluate(() => /72 things are waiting on you/.test((document.getElementById('ov-brief') || {}).innerText || '')), 15000);
    const brief = await page.evaluate(() => document.getElementById('ov-brief').innerText);
    check('Today at a glance: the board\'s 72 waiting and the biggest two', glance && /Today at a glance/.test(brief) && /The biggest: 32 GST invoices to raise and 24 to remind to pay/.test(brief), brief.slice(0, 300));
    check('...from the numbers below when there is no AI', /From the numbers below/.test(brief), brief);
    const order = await page.evaluate(() => {
      const y = (el) => el ? el.getBoundingClientRect().top + window.scrollY : -1;
      const tiles = [...document.querySelectorAll('#section-overview .card-hover')];
      const sen = [...document.querySelectorAll('h3')].find(h => /by seniority/.test(h.textContent));
      return { brief: y(document.getElementById('ov-brief')), header: y(document.querySelector('#section-overview .glow')), tilesEnd: tiles.length ? tiles[tiles.length - 1].getBoundingClientRect().bottom + window.scrollY : -1, help: y(document.getElementById('help-funnel')), board: y(document.getElementById('ov-board')), sen: y(sen), tiles: tiles.length };
    });
    check('the order the organiser decided is kept: briefing, event, 8 tiles, Pass & badge, board, charts', order.brief < order.header && order.header < order.tilesEnd && order.tilesEnd < order.help && order.help < order.board && order.board < order.sen && order.tiles === 8, order);
    await page.click('#ov-brief .as-brief-chip[data-as-go="payments"]');
    check('a chip in the briefing opens its screen', await until(() => page.evaluate(() => currentSection === 'payments'), 5000));
    await page.click('[data-section="overview"]');
    await until(() => page.evaluate(() => /Waiting on you/.test((document.getElementById('ov-board') || {}).innerText || '')), 15000);
    await page.click('#ov-jump [data-as-jump="0"]');
    await sleep(900);
    const jumped = await page.evaluate(() => {
      const h = [...document.querySelectorAll('#ov-board h3')].find(x => /Waiting on you/.test(x.textContent));
      const card = h.closest('.glass').getBoundingClientRect();
      const bar = document.getElementById('ov-jump').getBoundingClientRect();
      return { top: Math.round(card.top), barBottom: Math.round(bar.bottom), inner: innerHeight };
    });
    check('Jump to "Waiting on you" brings it up, under the sticky bar, not behind it', jumped.top >= jumped.barBottom - 2 && jumped.top < jumped.inner / 2, jumped);
    // Typing into the briefing and pressing Ask opens Ask with the question asked.
    await page.fill('#ov-brief .as-brief-ask input', 'How many have checked in?');
    await page.press('#ov-brief .as-brief-ask input', 'Enter');
    check('asking from the briefing opens Ask with the answer', await until(() => page.evaluate(() => !document.getElementById('as-palette').hidden && /Checked in at the badge desk/.test(document.getElementById('as-pal-answer').innerText)), 15000));
    await page.keyboard.press('Escape');
    // The page's own rules.
    const u = await page.evaluate(() => {
      const t = AdminShell._test;
      return { q1: t.looksLikeQuestion('How many paid?'), q2: t.looksLikeQuestion('payments'), q3: t.looksLikeQuestion('who'), q4: t.looksLikeQuestion('show me unpaid vip passes'),
        m1: t.matchScreens('invoice')[0], m2: t.matchScreens('qa')[0], m3: t.matchScreens('delhi')[0], m4: t.matchScreens('enquiries')[0], m5: t.matchScreens('zzzz').length };
    });
    check('a question is told from a screen name', u.q1 && !u.q2 && u.q3 && u.q4, u);
    check('words people use find the screen: invoice, qa, delhi, enquiries; nonsense finds nothing', u.m1 === 'payments' && u.m2 === 'liveqa' && u.m3 === 'delhi2027' && u.m4 === 'inquiries' && u.m5 === 0, u);
    check('no script error on the laptop', errors.length === 0, errors);
    await ctx.close();

    // ================= a phone =================
    const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await signIn(pctx);
    const ph = await pctx.newPage();
    const perrors = [];
    ph.on('pageerror', e => perrors.push(e.message));
    await ph.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    await until(() => ph.evaluate(() => /Waiting on you/.test((document.getElementById('ov-board') || {}).innerText || '')), 30000);
    const bar = await ph.evaluate(() => {
      const b = document.getElementById('as-tabbar');
      const btns = [...b.querySelectorAll('button')];
      return { shown: getComputedStyle(b).display !== 'none', labels: btns.map(x => [...x.querySelectorAll('span')].filter(s => !s.className).map(s => s.textContent.trim()).join('')), minH: Math.min.apply(null, btns.map(x => x.getBoundingClientRect().height)),
        bottom: Math.round(b.getBoundingClientRect().bottom), inner: innerHeight, home: b.querySelector('[data-as-tab="overview"]').classList.contains('is-active'),
        pad: parseFloat(getComputedStyle(document.getElementById('main-content')).paddingBottom), barH: b.getBoundingClientRect().height, ask: getComputedStyle(document.getElementById('as-ask-btn')).display };
    });
    check('a phone: the bottom bar, Home Attendees Ask Inbox Menu, Home lit', bar.shown && JSON.stringify(bar.labels) === JSON.stringify(['Home', 'Attendees', 'Ask', 'Inbox', 'Menu']) && bar.home, bar);
    check('...each button at least 44px tall, at the foot of the screen', bar.minH >= 44 && bar.bottom === bar.inner, bar);
    check('...the page leaves room under the last card for the bar', bar.pad >= bar.barH, bar);
    check('...and the top bar has no Ask button of its own (the bar has it)', bar.ask === 'none', bar.ask);
    const inbox = await ph.evaluate(() => { const n = document.getElementById('as-tab-inbox-n'); return n && !n.hidden ? n.textContent : ''; });
    check('Inbox shows the new enquiries (4)', inbox === '4', inbox);
    await ph.tap('#as-tabbar [data-as-tab="attendees"]');
    check('Attendees from the bar: the screen, and its button lit', await until(() => ph.evaluate(() => currentSection === 'attendees' && document.querySelector('[data-as-tab="attendees"]').classList.contains('is-active')), 5000));
    await ph.tap('#as-tabbar .as-tab-ask');
    const sheet = await until(() => ph.evaluate(() => !document.getElementById('as-palette').hidden), 3000);
    const box = await ph.evaluate(() => { const r = document.querySelector('.as-pal-box').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), font: parseFloat(getComputedStyle(document.getElementById('as-pal-input')).fontSize) }; });
    check('Ask on a phone fills the screen, and its box is 16px or more (no zoom on iPhone)', sheet && box.w === 390 && box.h >= 800 && box.font >= 16, box);
    await ph.tap('.as-pal-x');
    await ph.tap('#as-tabbar [data-as-tab="menu"]');
    check('Menu opens the sidebar as a drawer', await until(() => ph.evaluate(() => document.getElementById('sidebar').classList.contains('mobile-open')), 3000));
    const rows = await ph.evaluate(() => Math.min.apply(null, [...document.querySelectorAll('#sidebar .sidebar-btn')].filter(b => b.offsetParent).map(b => b.getBoundingClientRect().height)));
    check('...every row in it at least 44px tall', rows >= 44, rows);
    await ph.tap('#sidebar [data-section="payments"]');
    check('...a screen chosen in it opens and the drawer closes; Menu lit', await until(() => ph.evaluate(() => currentSection === 'payments' && !document.getElementById('sidebar').classList.contains('mobile-open') && document.querySelector('[data-as-tab="menu"]').classList.contains('is-active')), 5000));
    await ph.evaluate(() => switchSection('attendees'));
    await until(() => ph.evaluate(() => typeof openAddAttendee === 'function' && !!document.getElementById('admin-att-search')), 15000);
    await ph.evaluate(() => openAddAttendee());
    await sleep(500);
    const modal = await ph.evaluate(() => { const r = document.getElementById('modal-box').getBoundingClientRect(); return { w: Math.round(r.width), bottom: Math.round(r.bottom), inner: innerHeight, open: !document.getElementById('modal-container').classList.contains('hidden') }; });
    check('a form on a phone rises from the bottom, full width', modal.open && modal.w === 390 && Math.abs(modal.bottom - modal.inner) <= 1, modal);
    await ph.evaluate(() => { if (typeof closeModal === 'function') closeModal(); else document.getElementById('modal-container').classList.add('hidden'); });

    // Every screen opens on the phone, nothing wider than it, no page error.
    const ids = await ph.evaluate(() => [...document.querySelectorAll('#sidebar .sidebar-btn[data-section]')].map(b => b.getAttribute('data-section')));
    const wide = [];
    for (const id of ids) {
      await ph.evaluate((s) => switchSection(s), id);
      await sleep(1200);
      const w = await ph.evaluate((s) => ({ shown: !document.getElementById('section-' + s).classList.contains('hidden'), page: document.documentElement.scrollWidth, title: document.getElementById('page-title').textContent }), id);
      if (!w.shown || w.page > 390 || !w.title || w.title === id) wide.push(id + ':' + JSON.stringify(w));
    }
    check('all 26 screens open on a phone with a title and nothing wider than 390px', wide.length === 0, wide);
    check('no script error on the phone', perrors.length === 0, perrors);
    await pctx.close();
  } finally {
    await browser.close();
  }
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL suite crashed: ' + (e.stack || e.message)); process.exit(1); });
