// End to end: Admin, Inquiries in a real browser (Edge) on the real built worker and
// real SQLite (inquiry-harness.mjs), 12 Nov 2026. A laptop: the desk drawn with its
// numbers matching the server, smart views, search by phone, the keys, one enquiry
// open (a change saved without losing a reply being typed, a saved reply previewed and
// sent, a note), many ticked (an owner, one reply to all with each name), a wrong type
// moved, the Pipeline by dragging, Insights with its hover and table, Automation's
// switch, preview and owners, the export made safe for Excel, a link from an email
// opening one enquiry, the Delhi waitlist. Then a phone: no sideways scroll, the panel
// full width. Needs inquiry-harness.mjs (HARNESS_PORT, default 8861).
const pw = require('./playwright.cjs');
const fs = require('node:fs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8861);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 500))); if (!ok) fails++; };
const until = async (fn, ms = 15000) => { const t = Date.now() + ms; while (Date.now() < t) { try { if (await fn()) return true; } catch { /* not yet */ } await sleep(200); } return false; };
const H = { Authorization: 'Bearer iq-admin' };
const api = async (p, init = {}) => (await fetch(BASE + p, { ...init, headers: { ...H, ...(init.headers || {}) } })).json();
const all = async () => (await api('/api/admin/inquiries')).inquiries;
const byName = async (name) => (await all()).find((r) => r.name === name);
const mails = async () => (await fetch(BASE + '/__mail')).json();

(async () => {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(BASE + '/app')).ok; } catch { /* starting */ } if (!up) await sleep(500); }
  if (!up) { console.log('FAIL the harness never came up'); process.exit(1); }

  const browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
    await ctx.addInitScript(() => { if (window.top !== window) return; sessionStorage.setItem('tc_admin_token', 'iq-admin'); localStorage.setItem('tc_admin', '1'); localStorage.setItem('tc_admin_operator', 'Priya'); });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto(BASE + '/admin#inquiries', { waitUntil: 'domcontentloaded' });
    check('the desk loads its own script and style and draws itself', await until(() => page.locator('.iqd .iq-kpis').isVisible(), 30000), 'no .iq-kpis');
    check('four tabs: Inbox, Pipeline, Insights, Automation', (await page.locator('.iq-tab').count()) === 4);
    const rowsNow = await all();
    const newCount = rowsNow.filter((r) => r.status === 'new').length;
    const kpiNeeds = await page.locator('[data-kpi="needs_reply"] .iq-kpi-value').innerText();
    check('Needs a reply on screen is what the server counts', Number(kpiNeeds) === newCount, kpiNeeds + ' vs ' + newCount);
    check('What to do now leads with the hot leads', /hot lead/.test(await page.locator('.iq-advice li').first().innerText()), await page.locator('.iq-advice').innerText());
    check('the stylesheet is applied (a KPI tile is a white card with a border)', await page.locator('.iq-kpi').first().evaluate((el) => getComputedStyle(el).borderTopStyle === 'solid' && getComputedStyle(el).backgroundColor === 'rgb(255, 255, 255)'));

    // ---- views ----
    await page.click('[data-view="hot"]');
    const bands = await page.locator('.iq-row .iq-band').allInnerTexts();
    check('Hot shows only hot ones', bands.length > 0 && bands.every((b) => b === 'Hot'), bands);
    await page.click('[data-view="needs_reply"]');

    // ---- search ----
    await page.fill('[data-f="q"]', '99204 32519');
    check('search finds a phone number typed with a space', await until(async () => (await page.locator('.iq-row').count()) === 1 && /Rida Dange/.test(await page.locator('.iq-row').first().innerText())));
    await page.press('[data-f="q"]', 'Escape');
    check('Esc empties the search and the list comes back', await until(async () => (await page.locator('.iq-row').count()) > 5));

    // ---- keys ----
    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    const focused = await page.locator('.iq-row.is-focus').count();
    const secondSubject = await page.locator('.iq-row').nth(1).locator('.iq-subject').innerText();
    check('j moves down the list', focused === 1 && await page.locator('.iq-row').nth(1).evaluate((el) => el.classList.contains('is-focus')));
    await page.keyboard.press('Enter');
    check('Enter opens that enquiry', await until(async () => (await page.locator('.iq-drawer h2').innerText()) === secondSubject), secondSubject);
    await page.keyboard.press('Escape');
    check('Esc closes it', await until(async () => (await page.locator('.iq-drawer').count()) === 0));

    // ---- one enquiry ----
    await page.fill('[data-f="q"]', 'Ravi');
    await until(async () => (await page.locator('.iq-row').count()) === 1);
    await page.locator('.iq-row .iq-subject').first().click();
    await until(() => page.locator('.iq-drawer').isVisible());
    check('the open enquiry shows the booth form details and the Rs estimate', /estimated total/i.test(await page.locator('.iq-drawer').innerText()) && /1\.5 L before GST/.test(await page.locator('.iq-drawer').innerText()));
    await page.fill('[data-f="reply-body"]', 'half typed');
    await page.selectOption('[data-dr="status"]', 'in_progress');
    check('a change in Decide is saved', await until(async () => (await page.locator('[data-part="dr-saved"]').innerText()) === 'Saved.' && (await byName('Ravi Kumar')).status === 'in_progress'));
    check('and the reply being typed is still there', (await page.inputValue('[data-f="reply-body"]')) === 'half typed');
    await page.fill('[data-dr="deal_value_inr"]', '1,80,000');
    await page.press('[data-dr="deal_value_inr"]', 'Tab');
    check('a deal value typed with Indian commas is kept in rupees', await until(async () => (await byName('Ravi Kumar')).deal_value_inr === 180000));
    await page.selectOption('[data-f="reply-tpl"]', 'booth');
    check('a saved reply fills the message (after asking to replace the typing)', await until(async () => /floor plan/.test(await page.inputValue('[data-f="reply-body"]'))));
    await page.click('[data-act="preview-reply"]');
    const pv = await page.locator('[data-part="reply-preview"]').innerText();
    check('Preview shows it as Ravi will read it, his company filled in', /Dear Ravi Kumar/.test(pv) && /Acme Robotics/.test(pv) && !/\{organisation\}/.test(pv), pv.slice(0, 300));
    const before = (await mails()).length;
    await page.click('[data-act="send-reply"]');
    check('Send emails Ravi with his company in it', await until(async () => { const m = await mails(); return m.length === before + 1 && m[m.length - 1].Recipients.To[0] === 'ravi@acme.in' && m[m.length - 1].Content.Body[0].Content.includes('Acme Robotics'); }));
    check('a reply leaves In talks as it was', (await byName('Ravi Kumar')).status === 'in_progress');
    await until(() => page.locator('[data-f="note"]').isVisible());
    await page.fill('[data-f="note"]', 'Called Ravi, wants a corner');
    await page.click('[data-act="add-note"]');
    check('a note is added and shown with the others', await until(async () => /Called Ravi, wants a corner/.test(await page.locator('[data-part="dr-notes"]').innerText())));
    check('the history lists the reply and the changes', await until(async () => /Reply emailed/.test(await page.locator('[data-part="dr-history"]').innerText()) && /Changed status to In talks/.test(await page.locator('[data-part="dr-history"]').innerText())));
    await page.keyboard.press('Escape');
    await page.press('[data-f="q"]', 'Escape').catch(() => {});
    await page.fill('[data-f="q"]', '');
    await page.dispatchEvent('[data-f="q"]', 'input');

    // ---- many at once ----
    await page.selectOption('[data-f="type"]', 'speaking');
    await until(async () => (await page.locator('.iq-row').count()) > 3);
    const names = [], ids = [];
    for (let i = 0; i < 3; i++) {
      names.push(await page.locator('.iq-row').nth(i).locator('.iq-from-name').innerText());
      ids.push(Number(await page.locator('.iq-row').nth(i).getAttribute('data-row')));
      await page.locator('.iq-row').nth(i).locator('[data-act="tick"]').check();
    }
    check('ticking shows the bar for many', /3 ticked/.test(await page.locator('[data-part="bulk"]').innerText()));
    await page.selectOption('[data-act="bulk-owner"]', 'Anita Ram');
    check('Give to: three get an owner at once', await until(async () => { const r = await all(); return ids.every((id) => r.find((x) => x.id === id)?.assigned_to === 'Anita Ram'); }));
    const m0 = (await mails()).length;
    await page.click('[data-act="bulk-reply"]');
    await until(() => page.locator('.iq-drawer').isVisible());
    await page.selectOption('.iq-drawer [data-f="reply-tpl"]', 'speaking');
    await page.fill('.iq-drawer [data-f="reply-body"]', 'Dear {first_name}, thank you for offering to speak.');
    await page.click('[data-act="send-bulk"]');
    check('Reply to all: one email each, each with their own first name', await until(async () => { const m = (await mails()).slice(m0); return m.length === 3 && names.every((n) => m.some((x) => x.Content.Body[0].Content.includes('Dear ' + n.split(' ')[0] + ', thank you'))); }, 20000));
    check('and they are Replied', await until(async () => { const r = await all(); return ids.every((id) => r.find((x) => x.id === id)?.status === 'responded'); }));
    await page.selectOption('[data-f="type"]', '');

    // ---- a wrong type ----
    await page.click('[data-view="suggested"]');
    const target = page.locator('.iq-row', { hasText: 'Looking for speaker opportunity' }).locator('[data-act="move"]');
    const found = await until(async () => (await target.count()) === 1);
    if (!found) console.log('DEBUG view:', await page.locator('.iq-views').innerText(), '| result:', await page.locator('[data-part="result"]').innerText().catch(() => '-'), '| rows:', (await page.locator('.iq-row .iq-subject').allInnerTexts()).slice(0, 8), '| drawer:', await page.locator('.iq-drawer').count(), '| type:', await page.inputValue('[data-f="type"]'), '| api:', JSON.stringify((await all()).filter((r) => r.suggested_type).map((r) => [r.id, r.subject, r.status])));
    await target.click({ timeout: 5000 });
    check('"Looks like Speaking: move" moves it', await until(async () => (await all()).find((r) => r.subject === 'Looking for speaker opportunity')?.inquiry_type === 'speaking'));

    // ---- pipeline ----
    await page.click('[data-tab="pipeline"]');
    check('Pipeline has five columns', (await page.locator('.iq-col').count()) === 5);
    const card = page.locator('.iq-col[data-col="new"] .iq-deal', { hasText: 'Tata AI' });
    await card.dragTo(page.locator('.iq-col[data-col="responded"] .iq-col-body'));
    check('dragging a card to Replied changes its status', await until(async () => (await byName('Asha Paid')).status === 'responded'));
    await page.locator('.iq-col .iq-deal', { hasText: 'Acme Robotics' }).locator('select').selectOption('won');
    check('or choose Won on the card', await until(async () => (await byName('Ravi Kumar')).status === 'won'));

    // ---- a name typed to attack the admin ----
    await page.locator('.iq-col .iq-deal', { hasText: 'Evil' }).locator('select').selectOption('in_progress');
    await until(async () => (await all()).find((r) => r.email === 'mallory@evil.example')?.status === 'in_progress');
    await sleep(400);
    await page.click('[data-tab="inbox"]');
    await page.click('[data-view="all"]');
    await page.fill('[data-f="q"]', 'mallory');
    await until(async () => (await page.locator('.iq-row').count()) === 1);
    await page.locator('.iq-row .iq-subject').first().click();
    await until(() => page.locator('.iq-drawer').isVisible());
    await page.locator('.iq-drawer').hover();
    await sleep(400);
    check('a name, company, subject or message carrying markup is shown as text and never runs (list, open panel, Pipeline, the toast)',
      (await page.evaluate(() => window.__iqXss)) === undefined && /<img src=x onerror/.test(await page.locator('.iq-drawer h2, .iq-drawer .iq-msg').allInnerTexts().then((t) => t.join(' '))), await page.evaluate(() => window.__iqXss));
    await page.keyboard.press('Escape');
    await page.fill('[data-f="q"]', '');
    await page.dispatchEvent('[data-f="q"]', 'input');

    // ---- insights ----
    await page.click('[data-tab="insights"]');
    check('Insights: ten weeks on the chart', (await page.locator('.iq-colw').count()) === 10);
    await page.locator('.iq-colw').last().hover();
    check('hovering a week tells its numbers', await until(async () => /Week of/.test(await page.locator('[data-part="tip"]').innerText()) && await page.locator('[data-part="tip"]').isVisible()));
    await page.click('[data-act="ins-table"]');
    check('and the same as a table', (await page.locator('.iq-ins table').first().locator('tbody tr').count()) === 10);
    check('Won counts the sale', /Won\s*\n?\s*[1-9]/.test(await page.locator('.iq-kpis').innerText()));

    // ---- automation ----
    await page.click('[data-tab="automation"]');
    await page.locator('[data-key="autoack"]').check();
    check('switching on the automatic email asks first, then saves', await until(async () => (await api('/api/admin/inquiry-settings')).autoack === true));
    await page.click('[data-act="ack-preview"]');
    check('See the email shows it', await until(async () => (await page.locator('[data-part="ack-preview"] iframe').getAttribute('srcdoc') || '').includes('We have your enquiry')) || await until(async () => /We have your enquiry/.test(await page.locator('[data-part="ack-preview"] iframe').evaluate((f) => f.srcdoc))));
    await page.fill('[data-route="booth_inquiry"]', 'Anita Ram');
    await page.click('[data-act="save-routing"]');
    check('owners by type are saved', await until(async () => (await api('/api/admin/inquiry-settings')).routing.booth_inquiry === 'Anita Ram'));

    // ---- export ----
    await page.click('[data-tab="inbox"]');
    await page.click('[data-view="all"]');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="export"]')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    check('Export: a spreadsheet that opens as Unicode, a formula typed into the form made harmless', csv.charCodeAt(0) === 0xfeff && csv.includes('"Ref"') && csv.includes('"\'=HYPERLINK(""http://evil"",""click"")"'), csv.slice(0, 200));

    // ---- Delhi ----
    await page.click('[data-view="delhi"]');
    check('the Delhi waitlist has its own view', await until(async () => (await page.locator('.iq-row').count()) === 1 && /Delhi Visitor/.test(await page.locator('.iq-row').first().innerText())));

    // ---- a link from an email ----
    const rida = await byName('Rida Dange');
    const p2 = await ctx.newPage();
    p2.on('pageerror', (e) => errors.push(e.message));
    await p2.goto(BASE + '/admin?inq=' + rida.id + '#inquiries', { waitUntil: 'domcontentloaded' });
    check('a link from the team email opens that enquiry', await until(async () => (await p2.locator('.iq-drawer h2').innerText()) === 'Rida Dange', 30000));
    check('and the address bar is tidied', !/inq=/.test(p2.url()) && /#inquiries$/.test(p2.url()), p2.url());
    await p2.close();
    check('no script error on the laptop', errors.length === 0, errors);

    // ---- a phone ----
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await phone.addInitScript(() => { if (window.top !== window) return; sessionStorage.setItem('tc_admin_token', 'iq-admin'); localStorage.setItem('tc_admin', '1'); localStorage.setItem('tc_admin_operator', 'Priya'); });
    const ph = await phone.newPage();
    ph.on('pageerror', (e) => errors.push('phone: ' + e.message));
    await ph.goto(BASE + '/admin#inquiries', { waitUntil: 'domcontentloaded' });
    check('phone: the desk draws', await until(() => ph.locator('.iqd .iq-kpis').isVisible(), 30000));
    const wide = await ph.evaluate(() => { const s = document.getElementById('section-inquiries'); return { page: document.documentElement.scrollWidth, sec: s.scrollWidth, secw: s.clientWidth }; });
    check('phone: nothing pushes the page sideways', wide.page <= 391 && wide.sec <= wide.secw + 1, wide);
    check('phone: two numbers a row', await ph.locator('.iq-kpis').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length === 2));
    await ph.locator('.iq-row .iq-subject').first().tap();
    check('phone: an enquiry opens across the whole screen', await until(async () => (await ph.locator('.iq-drawer').evaluate((el) => el.getBoundingClientRect().width)) >= 389));
    check('no script error on the phone', errors.length === 0, errors);
  } catch (e) {
    console.log('FAIL crashed: ' + (e && e.stack || e));
    fails++;
  } finally {
    await browser.close();
  }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
