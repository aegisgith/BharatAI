// Panel email as a job on the server, seen from the admin page: Send starts it
// with the chosen gap and the page ticks it; the line counts down; a redraw
// keeps the run; the note says whether the scheduler is alive; the pace can be
// changed mid-run; Stop pauses on the server; Resume carries on; with no gap it
// runs through; the choice is remembered. Drives the admin page on
// pace-harness.mjs (:8774), whose job endpoints mirror the worker's and record
// every "send" with its time. Needs pace-harness.mjs running.
const { chromium } = require('./playwright.cjs');

const BASE = 'http://localhost:8774';
const SLUG = 'djsanghvi-21sep';
let fails = 0;
const check = (label, ok, detail = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (ok ? '' : '   ' + detail)); if (!ok) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const harness = async () => (await (await fetch(BASE + '/api/__state')).json());
const sends = async () => (await harness()).sendCalls || [];
const setHarness = (set) => fetch(BASE + '/api/__state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ set }) });
const resetHarness = () => fetch(BASE + '/api/__state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reset: true }) });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.addInitScript(() => {
    sessionStorage.setItem('tc_admin_token', 'h-admin');
    localStorage.setItem('tc_admin', '1');
    localStorage.setItem('tc_admin_operator', 'Harness');
  });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  const BTN = '#mail-btn-confirmations-' + SLUG;
  const GAP = '#panel-gap-confirmations-' + SLUG;
  const open = async () => {
    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    await sleep(2500);
    await page.waitForFunction(() => !!document.getElementById('campus-panels'), null, { timeout: 20000 });
    await page.evaluate(() => renderCampusPanels());
    await page.waitForSelector(BTN, { timeout: 20000 });
    await page.evaluate(() => document.getElementById('campus-panels').scrollIntoView());
  };
  const progress = () => page.textContent('#mail-progress-confirmations-' + SLUG);
  const note = () => page.textContent('#mail-jobs-note');
  const button = () => page.locator(BTN).innerText();

  // 1. The control is there, and one minute is what it starts on.
  await resetHarness();
  await open();
  const sel = await page.$(GAP);
  check('the pace control sits next to the Send button', !!sel);
  check('it starts at one minute', sel && (await sel.inputValue()) === '60', sel && await sel.inputValue());
  const label = await page.textContent('label:has(' + GAP + ')');
  check('it says what it does in words', /one email every/i.test(label || ''), label);
  check('"Are you coming?" has its own control', !!(await page.$('#panel-gap-reminders-' + SLUG)));
  check('the reports email has its own control', !!(await page.$('#panel-gap-reports-' + SLUG)));
  check('nothing running: no scheduler note', !((await note()) || '').trim(), await note());

  // 2. Send with a 30 second gap: the job starts on the server, the first email goes, the next waits.
  await page.selectOption(GAP, '30');
  await page.click(BTN);
  await sleep(2500);
  let h = await harness();
  check('Send starts a job on the server with the chosen gap', (h.startCalls || []).length === 1 && h.startCalls[0].gap_seconds === 30 && h.startCalls[0].kind === 'confirmations', JSON.stringify(h.startCalls));
  let c = await sends();
  check('the first email goes straight away', c.length === 1, JSON.stringify(c));
  check('the button is now Stop', /Stop/.test(await button()), await button());
  const p1 = await progress();
  check('the line counts down to the next one', /Next in \d+s/.test(p1 || ''), p1);
  check('it shows how many are sent, how many are left and when it will end', /1 sent/.test(p1 || '') && /3 to go/.test(p1 || '') && /ending about/.test(p1 || ''), p1);
  await sleep(4000);
  check('no second email inside the gap', (await sends()).length === 1, JSON.stringify(await sends()));
  check('the countdown moves', parseInt(((await progress()) || '').match(/Next in (\d+)s/)?.[1] || '99', 10) < 29, await progress());

  // 3. The Overview redraws itself every minute. The redraw shows the run, because the run is on the server.
  await page.evaluate(() => renderCampusPanels());
  await sleep(600);
  check('a redraw during a run still shows Stop, not Send', /Stop/.test(await button()), await button());
  check('a redraw keeps the progress line', /to go/.test((await progress()) || ''), await progress());
  check('a second page would see the same run', (await page.evaluate(() => mailJob('confirmations', 'djsanghvi-21sep').status)) === 'running');
  await page.evaluate(() => startMailJob('confirmations', 'djsanghvi-21sep'));
  await sleep(800);
  check('Send on a running job starts nothing', ((await harness()).startCalls || []).length === 1, JSON.stringify((await harness()).startCalls));

  // 4. The note: whether the scheduler is alive decides what the organiser is told.
  check('without the scheduler the page says it must stay open', /scheduler is not running/.test((await note()) || '') && /section 17/.test((await note()) || ''), await note());
  await setHarness({ cronAlive: true });
  await page.evaluate(() => renderCampusPanels());
  await sleep(600);
  check('with the scheduler alive the page says it can be closed', /you can close this page/.test((await note()) || '') && /scheduler seen/.test((await note()) || ''), await note());

  // 5. The pace can be changed while it runs; the control shows the run's own gap.
  check('the control shows the gap the run is on', (await page.inputValue(GAP)) === '30', await page.inputValue(GAP));
  await page.selectOption(GAP, '120');
  await sleep(800);
  h = await harness();
  check('changing the pace mid-run changes the job on the server', h.mailJobs['confirmations:' + SLUG].gap === 120, JSON.stringify(h.mailJobs));
  check('and is remembered for next time', (await page.evaluate(() => localStorage.getItem('panel_gap_seconds'))) === '120');

  // 6. Stop means stop, on the server: nothing more goes, from any page.
  await page.click(BTN);
  await sleep(1200);
  h = await harness();
  check('Stop pauses the job on the server', h.mailJobs['confirmations:' + SLUG].status === 'paused' && (h.stopCalls || []).length === 1, JSON.stringify(h.mailJobs));
  check('stopping says so', /Stopped - 1 sent/.test((await progress()) || ''), await progress());
  check('the button offers Resume', /Resume/.test(await button()), await button());
  const afterStop = (await sends()).length;
  await setHarness({ due: true });
  await sleep(11000);
  check('nothing more is sent while paused, even when the page ticks', (await sends()).length === afterStop, JSON.stringify(await sends()));

  // 7. Resume carries on from where it stopped, and the page keeps ticking on its own.
  await page.selectOption(GAP, '0');
  await page.click(BTN);
  await sleep(2500);
  h = await harness();
  check('Resume is a start that keeps the count', (h.startCalls || []).length === 2 && h.mailJobs['confirmations:' + SLUG].sent >= 1, JSON.stringify(h.mailJobs));
  await sleep(11000);
  c = await sends();
  check('with no gap the rest goes through, driven by the page ticking', c.length === 4, JSON.stringify(c.map(x => x.at - c[0].at)));
  check('it says when it has finished', /Done - 4 sent/.test((await progress()) || ''), await progress());
  await page.evaluate(() => renderCampusPanels());
  await sleep(600);
  check('a finished run stays finished after a redraw', /Done - 4 sent/.test((await progress()) || ''), await progress());
  check('nothing running: the note is gone again', !((await note()) || '').trim(), await note());

  // 8. The choice is remembered for the next send, and a new run uses it.
  await resetHarness();
  await open();
  check('the pace chosen last time is still selected', (await page.inputValue(GAP)) === '0', await page.inputValue(GAP));
  await page.click(BTN);
  await sleep(2500);
  h = await harness();
  check('a new run starts with the remembered pace', (h.startCalls || []).length === 1 && h.startCalls[0].gap_seconds === 0, JSON.stringify(h.startCalls));

  check('no script errors on the page', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
  console.log('\n' + (fails ? fails + ' FAILED' : 'all mail-job page checks passed'));
  process.exit(fails ? 1 : 0);
})();
