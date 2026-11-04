// The admin Overview board in a real browser (Edge), on the real built worker and
// real SQLite (board-harness.mjs): the organiser's questions of 4 Nov 2026 - how
// many hold each pass, how much the paid ones brought in, what is waiting - with
// every figure on the page checked against the API, and the API against the seed.
// Also the page's own pure helpers (days to go, rupees) as unit checks, run inside
// the page because they live in the admin script. Desktop, then a phone.
// Needs board-harness.mjs (HARNESS_PORT, default 8782). Started by run-all.mjs.
const pw = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8782);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const until = async (fn, ms) => { const t = Date.now() + ms; while (Date.now() < t) { if (await fn()) return true; await sleep(300); } return false; };
const rs = (paise) => '₹' + Math.round(paise / 100).toLocaleString('en-IN');

(async () => {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { const r = await fetch(BASE + '/api/events/1'); up = r.ok; } catch {} if (!up) await sleep(1000); }
  if (!up) { console.log('FAIL the harness never came up'); process.exit(1); }

  // ---- the API against the seed ----
  const api = await (await fetch(BASE + '/api/admin/events/1/board', { headers: { Authorization: 'Bearer h-admin' } })).json();
  const pass = Object.fromEntries((api.passes || []).map(p => [p.pass, p]));
  check('api: Visitor 2,600 (300 panel-only left out), Delegate 27 paid + 16 not paid, VIP 7 paid + 2 given + 8 not paid, Premium 3 given',
    pass['Visitor Pass']?.total === 2600 && pass['Delegate Pass']?.total === 43 && pass['Delegate Pass']?.not_paid === 16 &&
    pass['VIP Pass']?.total === 17 && pass['VIP Pass']?.complimentary === 2 && pass['VIP Pass']?.not_paid === 8 && pass['Premium Delegate Pass']?.complimentary === 3,
    JSON.stringify(api.passes));
  const sold = Object.fromEntries((api.money?.sold || []).map(s => [s.pass, s]));
  check('api: paid on this site = 27 Delegates and 7 VIPs at the gateway amounts', sold['Delegate Pass']?.n === 27 && sold['Delegate Pass']?.total === 27 * 1061882 && sold['VIP Pass']?.n === 7 && sold['VIP Pass']?.total === 7 * 2359882, JSON.stringify(api.money?.sold));
  const hand = Object.fromEntries((api.money?.by_hand || []).map(h => [h.pass, h]));
  check('api: by hand = 11 Academic, 8 amounts typed in, 3 without', hand['Academic Pass']?.n === 11 && hand['Academic Pass']?.recorded_paise === Math.round(8 * 471882) && hand['Academic Pass']?.no_amount === 3, JSON.stringify(api.money?.by_hand));
  check('api: waiting = 24 not paid, 32 invoices due, 3 enquiries, 2 booths, 1 listing, 1 room, 8 without a seat, 0 photos',
    api.todo?.not_paid === 24 && api.todo?.invoice_due === 32 && api.todo?.inquiries_new === 3 && api.todo?.booths_submitted === 2 && api.todo?.listings_pending === 1 && api.todo?.rooms_held === 1 && api.todo?.workshop_unchosen === 8 && api.todo?.photos_flagged === 0,
    JSON.stringify(api.todo));
  const onlineTotal = (api.money?.sold || []).reduce((s, x) => s + x.total, 0);
  const onlineGst = (api.money?.sold || []).reduce((s, x) => s + x.gst, 0);
  const handTotal = (api.money?.by_hand || []).reduce((s, x) => s + x.recorded_paise, 0);

  const browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await ctx.addInitScript(() => { sessionStorage.setItem('tc_admin_token', 'h-admin'); localStorage.setItem('tc_admin', '1'); localStorage.setItem('tc_admin_operator', 'Harness'); });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    const drawn = await until(() => page.evaluate(() => /Waiting on you/.test((document.getElementById('ov-board') || {}).innerText || '')), 30000);
    check('the board is drawn on the Overview', drawn, 'ov-board never filled');
    check('no script error on the page', errors.length === 0, JSON.stringify(errors));
    const text = await page.evaluate(() => document.getElementById('ov-board').innerText);
    const line = (re) => (text.match(re) || [''])[0];

    // ---- who holds which pass: the page says what the API says ----
    check('Free Visitor Pass row: 2,600 hold it', /Free Visitor Pass\s+2,600\s+0\s+0\s+0/.test(text), line(/Free Visitor Pass[^\n]*/));
    check('Delegate Pass row: 27 hold it, 0 given, 16 not paid, with today\'s price before GST', /Delegate Pass ₹[\d,]+ \+ GST\s+27\s+0\s+16\s+0/.test(text), line(/Delegate Pass[^\n]*/));
    check('VIP Pass row: 7 hold it, 2 given free, 8 not paid', /VIP Pass ₹[\d,]+ \+ GST\s+7\s+2\s+8\s+0/.test(text), line(/VIP Pass[^\n]*/));
    check('Premium Delegate Pass shows even with nothing sold: 0 hold it, 3 given free', /Premium Delegate Pass ₹[\d,]+ \+ GST\s+0\s+3\s+0\s+0/.test(text), line(/Premium Delegate Pass[^\n]*/));
    check('Speaker, Exhibitor, Organiser and Media Pass each have a row', /Speaker\s+60\s/.test(text) && /Exhibitor\s+38\s/.test(text) && /Organiser\s+12\s/.test(text) && /Media Pass\s+9\s/.test(text), text.slice(0, 900));
    check('the five passes on sale come first, in selling order, before the others', text.indexOf('Free Visitor Pass') < text.indexOf('Academic Pass') && text.indexOf('Academic Pass') < text.indexOf('Delegate Pass ₹') && text.indexOf('VIP Pass ₹') < text.indexOf('Speaker'), text.slice(0, 600));
    check('Everyone: 2,764 hold it, 5 given free, 24 not paid, and the sum is 2,793 registered', /Everyone\s+2,764\s+5\s+24\s+0/.test(text) && /= 2,793 registered/.test(text), line(/Everyone[^\n]*/) + ' | ' + line(/=[^\n]*registered/));
    const tile = await page.evaluate(() => { const t = [...document.querySelectorAll('#section-overview .card-hover')].find(x => /Total Attendees/.test(x.innerText)); return t ? t.innerText : ''; });
    check('the Total Attendees tile and the board count the same people (2,793)', /2793|2,793/.test(tile), tile);
    check('a pace line: today, the last 7 days, and about how many by the first day', /\+\d+ today/.test(text) && /\+\d+ in the last 7 days, about [\d.]+ a day/.test(text) && /about [\d,]+ by the first day/.test(text), line(/\+\d+ today[^\n]*/));
    check('as of is stamped once, in IST', /as of \d+ \w+ 2026, \d+:\d\d [ap]m IST\b/.test(text) && !/IST IST/.test(text), line(/as of[^\n]*/));

    // ---- money from passes ----
    check('received so far = paid on this site + typed-in amounts', text.includes(rs(onlineTotal + handTotal)) && /RECEIVED SO FAR, WITH GST/.test(text), rs(onlineTotal + handTotal) + ' not in ' + line(/[^\n]*RECEIVED[^\n]*/));
    check('paid on this site with its GST and the number of passes', text.includes(rs(onlineTotal)) && text.includes('of which GST ' + rs(onlineGst)) && /PAID ON THIS SITE · 34 PASSES/.test(text), rs(onlineTotal) + ' / ' + rs(onlineGst));
    check('chose a pass, not paid: 24 people and what they would pay today', /CHOSE A PASS, NOT PAID · 24/.test(text) && text.includes(rs(api.money.not_paid_value)) && /if they all pay today/.test(text), rs(api.money.not_paid_value));
    check('the money table: Delegate 27 sold here, Academic 11 by hand with the typed amount', new RegExp('Delegate Pass\\s+27\\s+' + rs(27 * 1061882).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+0').test(text) && new RegExp('Academic Pass\\s+0\\s+-\\s+11\\s+' + rs(handTotal).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(text), line(/Academic Pass\s+0[^\n]*/) + ' | ' + line(/Delegate Pass\s+27[^\n]*/));
    check('invoices: 2 raised, 32 paid online still need one; 12 tried online and did not get through; 3 by hand with no amount', /2 GST invoices raised/.test(text) && /32 paid online still need one/.test(text) && /12 tried to pay online/.test(text) && /3 with no amount on record/.test(text), text.slice(text.indexOf('GST invoice') - 20, text.indexOf('GST invoice') + 300));

    // ---- waiting on you, and that each line goes somewhere ----
    check('waiting on you: the eight lines with their counts and 71 in all', /71 in all/.test(text) && /24\s+chose a paid pass/.test(text) && /32\s+paid online, GST invoice/.test(text) && /3\s+new enquiries to answer \(1 sponsorship, 1 speaking, 1 general\)/.test(text) && /2\s+booth requests/.test(text) && /1\s+AI Marketplace listings/.test(text) && /1\s+boardroom bookings/.test(text) && /8\s+Premium or VIP holders/.test(text) && /0\s+photos the desk flagged/.test(text), text.slice(text.indexOf('Waiting on you')));
    const mpHref = await page.evaluate(() => { const a = [...document.querySelectorAll('#ov-board a')].find(x => /Marketplace listings/.test(x.innerText)); return a ? a.getAttribute('href') : ''; });
    check('the Marketplace line opens /marketplace/admin', mpHref === '/marketplace/admin', mpHref);
    await page.evaluate(() => { const a = [...document.querySelectorAll('#ov-board a')].find(x => /booth requests/.test(x.innerText)); a.click(); });
    const went = await until(() => page.evaluate(() => !document.getElementById('section-booth-requests').classList.contains('hidden') && document.getElementById('section-overview').classList.contains('hidden')), 5000);
    check('the booth requests line opens the Booth Requests section', went, 'section did not switch');
    await page.evaluate(() => switchSection('overview'));
    await until(() => page.evaluate(() => /Waiting on you/.test((document.getElementById('ov-board') || {}).innerText || '')), 20000);

    // ---- where it sits: under the Pass & badge card, above the seniority chart ----
    const place = await page.evaluate(() => {
      const y = (el) => el ? el.getBoundingClientRect().top + window.scrollY : -1;
      const sen = [...document.querySelectorAll('h3')].find(h => /by seniority/.test(h.textContent));
      return { help: y(document.getElementById('help-funnel')), board: y(document.getElementById('ov-board')), seniority: y(sen) };
    });
    check('the board sits under the Pass & badge card and above everything else', place.board > place.help && place.board < place.seniority, JSON.stringify(place));
    const header = await page.evaluate(() => (document.querySelector('#section-overview .glow p') || {}).innerText || '');
    check('the event header says how many days to go', /\d+ days to go|Tomorrow|Today is day \d|The event has ended/.test(header), header);

    // ---- unit checks of the page's helpers, inside the page ----
    const u = await page.evaluate(() => {
      var now = new Date(Date.now() + 330 * 60000);
      var d = function (off) { var t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + off)); return t.toISOString().slice(0, 10); };
      return {
        rs1: rupeesFromPaise(1061882), rs0: rupeesFromPaise(0), rsBig: rupeesFromPaise(45189988), rsNull: rupeesFromPaise(null),
        ten: daysToGoLabel({ start_date: d(10), end_date: d(11) }), tomorrow: daysToGoLabel({ start_date: d(1), end_date: d(2) }),
        today: daysToGoLabel({ start_date: d(0), end_date: d(1) }), day2: daysToGoLabel({ start_date: d(-1), end_date: d(0) }),
        ended: daysToGoLabel({ start_date: d(-5), end_date: d(-4) }), bad: daysToGoLabel({ start_date: 'soon' }), none: daysToGoLabel(null),
        n10: daysUntilEvent({ start_date: d(10) }), nBad: daysUntilEvent({ start_date: '2026-13-45' }),
      };
    });
    // It returns markup (the rupee as an entity) because every caller puts it in innerHTML.
    check('rupeesFromPaise: whole rupees, Indian grouping, 0 and null safe', u.rs1 === '&#8377;10,619' && u.rs0 === '&#8377;0' && u.rsBig === '&#8377;4,51,900' && u.rsNull === '&#8377;0', JSON.stringify(u));
    check('daysToGoLabel: 10 days, tomorrow, day 1, day 2, ended, bad date, no event', u.ten === '10 days to go' && u.tomorrow === 'Tomorrow' && u.today === 'Today is day 1' && u.day2 === 'Today is day 2' && u.ended === 'The event has ended' && u.bad === '' && u.none === '', JSON.stringify(u));
    check('daysUntilEvent: 10 for ten days out, null for a bad date', u.n10 === 10 && u.nBad === null, JSON.stringify(u));

    // ---- a phone ----
    await page.setViewportSize({ width: 390, height: 844 });
    // The Overview redraws itself on its live refresh, and the board is empty for
    // a moment each time; measure only once it is back.
    await until(() => page.evaluate(() => !!document.querySelector('#ov-board .overflow-x-auto') && /Waiting on you/.test(document.getElementById('ov-board').innerText)), 20000);
    await sleep(400);
    const phone = await page.evaluate(() => {
      const inner = window.innerWidth;
      // Whatever else on the Overview pokes past the screen edge, named, so a
      // wider page is a finding and not a mystery.
      const wide = [...document.querySelectorAll('#section-overview *')].filter(el => el.getBoundingClientRect().right > inner + 1 && el.children.length === 0)
        .slice(0, 4).map(el => el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ').slice(0, 3).join('.') : '') + ' ' + (el.innerText || '').slice(0, 40).replace(/\s+/g, ' '));
      return { board: document.getElementById('ov-board').scrollWidth, page: document.documentElement.scrollWidth, inner, wide };
    });
    check('on a 390px phone the board fits the screen', phone.board <= phone.inner, JSON.stringify(phone));
    if (phone.page > phone.inner) console.log('note: the Overview page is ' + phone.page + 'px wide on a ' + phone.inner + 'px phone; past the edge: ' + JSON.stringify(phone.wide));
    const fits = await page.evaluate(() => { const card = document.querySelector('#ov-board .overflow-x-auto'); return card && card.scrollWidth > card.clientWidth; });
    check('the pass table scrolls inside its own card on a phone', fits === true, String(fits));
  } finally {
    await browser.close();
  }
  console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll board browser checks passed.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL suite crashed: ' + (e.stack || e.message)); process.exit(1); });
