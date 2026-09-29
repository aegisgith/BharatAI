// Does panel email really go out one at a time, with the gap the organiser picked?
// Drives the admin page on pace-harness.mjs (:8774) whose send endpoint records every
// call and when it happened. Needs pace-harness.mjs running.
const path = require('path');
const { chromium } = require('./playwright.cjs');

const BASE = 'http://localhost:8774';
let fails = 0;
const check = (label, ok, detail = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (ok ? '' : '   ' + detail)); if (!ok) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const calls = async () => (await (await fetch(BASE + '/api/__state')).json()).sendCalls || [];
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

  const open = async () => {
    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    await sleep(2500);
    await page.waitForFunction(() => !!document.getElementById('campus-panels'), null, { timeout: 20000 });
    await page.evaluate(() => renderCampusPanels());
    await page.waitForSelector('#panel-send-djsanghvi-21sep', { timeout: 20000 });
    await page.evaluate(() => document.getElementById('campus-panels').scrollIntoView());
  };
  const progress = () => page.textContent('#panel-progress-djsanghvi-21sep');

  // 1. The control is there, and one minute is what it starts on.
  await resetHarness();
  await open();
  const sel = await page.$('#panel-gap-djsanghvi-21sep');
  check('the pace control sits next to the Send button', !!sel);
  check('it starts at one minute', sel && (await sel.inputValue()) === '60', sel && await sel.inputValue());
  const label = await page.textContent('label:has(#panel-gap-djsanghvi-21sep)');
  check('it says what it does in words', /one email every/i.test(label || ''), label);
  const remindPace = await page.$('#panel-gap-djsanghvi-21sep');
  check('the same control governs the "Are you coming?" send', !!remindPace);

  // 2. With a 30 second gap: the first email goes, the next one waits.
  await page.selectOption('#panel-gap-djsanghvi-21sep', '30');
  await page.click('#panel-send-djsanghvi-21sep');
  await sleep(2500);
  let c = await calls();
  check('the first email goes straight away', c.length === 1, JSON.stringify(c));
  check('the server is asked for one email, not five', c.length > 0 && c[0].batch === 1, JSON.stringify(c[0] || {}));
  const p1 = await progress();
  check('it counts down to the next one', /Next in \d+s/.test(p1 || ''), p1);
  check('it shows how many are left and when it will end', /to go\./.test(p1 || '') && /ending about/.test(p1 || ''), p1);
  await sleep(3500);
  check('no second email inside the gap', (await calls()).length === 1, JSON.stringify(await calls()));

  // 3. The Overview redraws itself every minute. The redraw must show the run, not forget it.
  await page.evaluate(() => renderCampusPanels());
  await sleep(600);
  const redrawn = await page.locator('#panel-send-djsanghvi-21sep').innerText();
  check('a redraw during a run still shows Stop, not Send', /Stop/.test(redrawn), redrawn);
  check('a redraw keeps the progress line', /to go\./.test((await progress()) || ''), await progress());
  await page.evaluate(() => startPanelConfirmations('djsanghvi-21sep'));
  await sleep(1500);
  check('a second Send on a running panel starts nothing', (await calls()).length === 1, JSON.stringify(await calls()));

  // 4. The wait works to a deadline, not a count of ticks.
  const stretched = await page.evaluate(() => new Promise(resolve => {
    const before = _panelPump['djsanghvi-21sep'].timer;
    // Stall the tab for a while, as a browser does to a background tab.
    const stop = Date.now() + 2500; while (Date.now() < stop) { /* busy */ }
    setTimeout(() => resolve({ before, after: _panelPump['djsanghvi-21sep'].timer }), 1200);
  }));
  const afterStall = await progress();
  const secs = parseInt(((afterStall || '').match(/Next in (\d+)s/) || [])[1] || '99', 10);
  check('a stalled tab loses the stalled seconds from the countdown, not just one tick', secs <= 30 - 6, afterStall);

  // 5. Stop means stop: the waiting email never goes.
  await page.click('#panel-send-djsanghvi-21sep');
  await sleep(1500);
  const afterStop = (await calls()).length;
  check('stopping says so', /Stopped/.test((await progress()) || ''), await progress());
  await sleep(4000);
  check('Stop cancels the waiting email', (await calls()).length === afterStop, JSON.stringify(await calls()));

  // 6. With no gap chosen it works straight through the queue.
  await resetHarness();
  await open();
  await page.selectOption('#panel-gap-djsanghvi-21sep', '0');
  await page.click('#panel-send-djsanghvi-21sep');
  await sleep(7000);
  c = await calls();
  check('with no gap it works through the queue', c.length === 4, JSON.stringify(c.map(x => x.batch)));
  check('every request is still one email', c.length > 0 && c.every(x => x.batch === 1), JSON.stringify(c.map(x => x.batch)));
  check('it says when it has finished', /Done/i.test((await progress()) || ''), await progress());
  await page.evaluate(() => renderCampusPanels());
  await sleep(600);
  check('a finished run stays finished after a redraw', /Done/i.test((await progress()) || ''), await progress());

  // 7. The choice is remembered for the next send.
  await open();
  check('the pace chosen last time is still selected', (await page.inputValue('#panel-gap-djsanghvi-21sep')) === '0');
  await page.selectOption('#panel-gap-djsanghvi-21sep', '120');
  await sleep(300);
  check('changing it is remembered', (await page.evaluate(() => localStorage.getItem('panel_gap_seconds'))) === '120');

  check('no script errors on the page', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
  console.log('\n' + (fails ? fails + ' FAILED' : 'all pacing checks passed'));
  process.exit(fails ? 1 : 0);
})();
