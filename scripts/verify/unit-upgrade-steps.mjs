// UNIT level of the pass upgrade (5 Nov 2026): the price rule on its own, on both
// sides of it, and the agreement between them.
//   A. The app's arithmetic, lifted out of the /app.js this build serves and run
//      with no browser: which passes are above the one held, the difference, what
//      each adds, the rupee format.
//   B. The server's rule through its one door (POST /api/payments/ccavenue/start),
//      for every holder against every pass, on the last day of the standard price
//      and the first day of the late one: the amount, or the refusal.
//   C. The agreement: for every paid pass, the figure the sheet would show is the
//      figure the server orders.
// The built worker on real SQLite with the production schema.
// Run after `npm run build`:  node scripts/verify/unit-upgrade-steps.mjs
import { makeUpgradeWorld, checker, STANDARD, LATE, LIST, LADDER, GST, paise } from './upgrade-world.mjs';

const W = await makeUpgradeWorld();
const { check, fails } = checker();
const { at, realClock, person, order, start, hit } = W;
const short = (p) => p.replace(' Pass', '');
const day = (iso) => (iso === STANDARD ? 'standard price' : 'late price');
let r;

// ---- A. the app's arithmetic ----
const app = await W.appFunctions(['inr', 'upgradePrice', 'upgradeStepsFor', 'upgradeAdds', 'upgradeTargetFor']);
const steps = (from) => JSON.parse(JSON.stringify(app.upgradeStepsFor(from)));
const names = (from) => steps(from).map(s => s.pass).join();

check('the ladder in the app: the Expo Pass (14 Nov 2026), then the four paid passes, cheapest first', JSON.stringify(app.UPGRADE_LADDER) === JSON.stringify(['Expo Pass', ...LADDER]), JSON.stringify(app.UPGRADE_LADDER));
// Before the prices arrive every pass above is listed, with no figure.
check('before the prices load: a Delegate is offered Premium Delegate and VIP, without a figure', names('Delegate Pass') === 'Premium Delegate Pass,VIP Pass' && steps('Delegate Pass').every(s => s.up === null), JSON.stringify(steps('Delegate Pass')));
check('before the prices load: an Academic is offered the three above it', names('Academic Pass') === 'Delegate Pass,Premium Delegate Pass,VIP Pass', names('Academic Pass'));
check('before the prices load: a Premium Delegate is offered VIP only', names('Premium Delegate Pass') === 'VIP Pass', names('Premium Delegate Pass'));
check('a VIP has nothing above it', names('VIP Pass') === '', names('VIP Pass'));
for (const none of ['', 'Visitor Pass', 'Speaker', 'Exhibitor', 'general', undefined, null]) {
  check('no steps for ' + JSON.stringify(none) + ' (not a paid pass)', steps(none).length === 0, JSON.stringify(steps(none)));
}

// With the prices: each difference, and its total with GST, on both days.
const cfg = {};
for (const iso of [STANDARD, LATE]) {
  at(iso);
  r = await hit('GET', '/api/payments/config');
  cfg[iso] = r.json;
  const L = LIST[iso];
  check(day(iso) + ': the server lists the organiser\'s four prices', r.status === 200 && r.json?.late === (iso === LATE) && LADDER.every(p => r.json.passes?.[p]?.base === L[p] && r.json.passes[p].total === paise(L[p]).total / 100), JSON.stringify(r.json?.passes));
  app._ppPrices = r.json.passes; app._ppGst = r.json.gst_rate;
  for (const from of LADDER) {
    const above = LADDER.slice(LADDER.indexOf(from) + 1);
    const got = steps(from);
    check(day(iso) + ': ' + short(from) + ' is offered ' + (above.map(short).join(', ') || 'nothing'), got.map(s => s.pass).join() === above.join(), JSON.stringify(got));
    for (const s of got) {
      const diff = L[s.pass] - L[from];
      check(day(iso) + ': ' + short(from) + ' to ' + short(s.pass) + ' is ' + diff.toLocaleString('en-IN') + ' + GST = ' + (paise(diff).total / 100).toLocaleString('en-IN'),
        s.up && s.up.base === diff && s.up.total === paise(diff).total / 100, JSON.stringify(s.up));
    }
  }
  // Never down, never sideways, never from or to something that is not a pass.
  const no = [['VIP Pass', 'Delegate Pass'], ['VIP Pass', 'VIP Pass'], ['Delegate Pass', 'Delegate Pass'], ['Delegate Pass', 'Academic Pass'], ['Premium Delegate Pass', 'Delegate Pass'], ['Delegate Pass', 'Speaker'], ['Delegate Pass', '']];
  check(day(iso) + ': no price for a move down, sideways or to something that is not a pass', no.every(([f, t]) => app.upgradePrice(f, t) === null), JSON.stringify(no.map(([f, t]) => app.upgradePrice(f, t))));
  // With no pass held, the "difference" is the whole price (the Visitor's forms use this).
  check(day(iso) + ': with no paid pass held the price is the whole pass', LADDER.every(p => app.upgradePrice('', p).base === L[p] && app.upgradePrice('Visitor Pass', p).base === L[p]), JSON.stringify(LADDER.map(p => app.upgradePrice('', p))));
}
realClock();

// The figures the organiser will recognise, spelled out once.
app._ppPrices = cfg[STANDARD].passes;
check('standard: Delegate to Premium Delegate is 5,000 + GST = 5,900', app.upgradePrice('Delegate Pass', 'Premium Delegate Pass').base === 5000 && app.upgradePrice('Delegate Pass', 'Premium Delegate Pass').total === 5900);
check('standard: Delegate to VIP is 15,000 + GST = 17,700', app.upgradePrice('Delegate Pass', 'VIP Pass').base === 15000 && app.upgradePrice('Delegate Pass', 'VIP Pass').total === 17700);
check('standard: Premium Delegate to VIP is 10,000 + GST = 11,800', app.upgradePrice('Premium Delegate Pass', 'VIP Pass').total === 11800);
check('standard: Academic to Delegate is 4,000 + GST = 4,720', app.upgradePrice('Academic Pass', 'Delegate Pass').base === 4000 && app.upgradePrice('Academic Pass', 'Delegate Pass').total === 4720);
app._ppPrices = cfg[LATE].passes;
check('late: Delegate to Premium Delegate is 6,000 + GST = 7,080', app.upgradePrice('Delegate Pass', 'Premium Delegate Pass').base === 6000 && app.upgradePrice('Delegate Pass', 'Premium Delegate Pass').total === 7080);
check('late: Delegate to VIP is 16,000 + GST = 18,880', app.upgradePrice('Delegate Pass', 'VIP Pass').base === 16000 && app.upgradePrice('Delegate Pass', 'VIP Pass').total === 18880);
check('late: Academic to VIP is 21,000 + GST = 24,780', app.upgradePrice('Academic Pass', 'VIP Pass').base === 21000 && app.upgradePrice('Academic Pass', 'VIP Pass').total === 24780);

// What each pass adds to the one held: nothing they already have, nothing missing.
const adds = (f, t) => app.upgradeAdds(f, t);
check('Delegate to Premium Delegate adds the workshop, and only that', adds('Delegate Pass', 'Premium Delegate Pass') === 'Adds one hands-on workshop', adds('Delegate Pass', 'Premium Delegate Pass'));
check('Delegate to VIP adds the workshop, the evening, the lounge, the seating and the meet & greet', /one hands-on workshop/.test(adds('Delegate Pass', 'VIP Pass')) && /Leaders’ Evening on Day 1/.test(adds('Delegate Pass', 'VIP Pass')) && /VIP lounge/.test(adds('Delegate Pass', 'VIP Pass')) && /priority seating/.test(adds('Delegate Pass', 'VIP Pass')) && /meet &amp; greet/.test(adds('Delegate Pass', 'VIP Pass')) && !/lunch/.test(adds('Delegate Pass', 'VIP Pass')), adds('Delegate Pass', 'VIP Pass'));
check('Premium Delegate to VIP does not sell the workshop again', !/workshop/.test(adds('Premium Delegate Pass', 'VIP Pass')) && /Leaders’ Evening/.test(adds('Premium Delegate Pass', 'VIP Pass')), adds('Premium Delegate Pass', 'VIP Pass'));
check('Academic to Delegate adds the lunch and the kit, no workshop', /networking lunch/.test(adds('Academic Pass', 'Delegate Pass')) && /conference kit/.test(adds('Academic Pass', 'Delegate Pass')) && !/workshop/.test(adds('Academic Pass', 'Delegate Pass')), adds('Academic Pass', 'Delegate Pass'));
check('Academic to Premium Delegate adds the lunch, the kit and the workshop', /networking lunch/.test(adds('Academic Pass', 'Premium Delegate Pass')) && /workshop/.test(adds('Academic Pass', 'Premium Delegate Pass')), adds('Academic Pass', 'Premium Delegate Pass'));
check('Academic to VIP adds the lunch, the workshop and the VIP things', /networking lunch/.test(adds('Academic Pass', 'VIP Pass')) && /workshop/.test(adds('Academic Pass', 'VIP Pass')) && /VIP lounge/.test(adds('Academic Pass', 'VIP Pass')), adds('Academic Pass', 'VIP Pass'));
check('no line promises a dinner (no pass includes one)', LADDER.every(f => LADDER.every(t => !/dinner/i.test(adds(f, t)))));

// The pass a prompt leads to, and the rupee format.
check('a speaker prompt leads to VIP; a workshop prompt to Premium Delegate, or VIP for a Premium Delegate', app.upgradeTargetFor('vip', 'Delegate Pass') === 'VIP Pass' && app.upgradeTargetFor('workshop', 'Delegate Pass') === 'Premium Delegate Pass' && app.upgradeTargetFor('workshop', 'Premium Delegate Pass') === 'VIP Pass' && app.upgradeTargetFor('agenda', 'Academic Pass') === 'Premium Delegate Pass');
check('rupees are written the Indian way, with paise only when there are any', app.inr(5000) === '5,000' && app.inr(17700) === '17,700' && app.inr(100000) === '1,00,000' && app.inr(5898.82) === '5,898.82', [app.inr(5000), app.inr(17700), app.inr(100000), app.inr(5898.82)].join(' '));

// ---- B. the server's rule, for every holder against every pass, on both days ----
// Each holder is a fresh person per day, so nobody meets the ten-orders-an-hour limit.
const HOLDERS = [
  { label: 'a free Visitor', badge: 'Visitor Pass', status: 'paid', credit: null },
  { label: 'a Delegate who has not paid yet', badge: 'Delegate Pass', status: 'pending', credit: null },
  { label: 'a Delegate whose payment was refunded', badge: 'Delegate Pass', status: 'refunded', credit: null },
  { label: 'a paid Academic', badge: 'Academic Pass', status: 'paid', credit: 'Academic Pass' },
  { label: 'a paid Delegate', badge: 'Delegate Pass', status: 'paid', credit: 'Delegate Pass' },
  { label: 'a paid Premium Delegate', badge: 'Premium Delegate Pass', status: 'paid', credit: 'Premium Delegate Pass' },
  { label: 'a paid VIP', badge: 'VIP Pass', status: 'paid', credit: 'VIP Pass' },
  { label: 'a complimentary Delegate', badge: 'Delegate Pass', status: 'waived', credit: 'none' },
  { label: 'a Speaker', badge: 'Speaker', status: 'waived', credit: 'none' },
];
let nextId = 1000;
const served = {};   // served[iso][holder label][pass] = total in rupees, or null when refused
for (const iso of [STANDARD, LATE]) {
  at(iso);
  const L = LIST[iso];
  served[iso] = {};
  for (const h of HOLDERS) {
    const id = person(nextId++, { badge_type: h.badge, payment_status: h.status });
    served[iso][h.label] = {};
    for (const pass of LADDER) {
      r = await start(id, pass);
      // What the rule says: no credit means the whole price; a paid pass pays the
      // difference to a dearer one and is refused the rest; 'none' is refused all.
      const want = h.credit === null ? L[pass] : h.credit === 'none' ? 0 : Math.max(0, L[pass] - L[h.credit]);
      const o = r.json?.order_id ? order(r.json.order_id) : null;
      served[iso][h.label][pass] = r.status === 201 ? r.json.amount : null;
      if (want > 0) {
        const p = paise(want);
        check(day(iso) + ': ' + h.label + ' asking for ' + short(pass) + ' is charged ' + want.toLocaleString('en-IN') + ' + GST',
          r.status === 201 && r.json.amount === p.total / 100 && !!o && o.base_paise === p.base && o.gst_paise === p.gst && o.amount_paise === p.total && o.pass_type === pass && o.previous_badge === h.badge && o.status === 'created',
          r.status + ' ' + r.text.slice(0, 160) + ' ' + JSON.stringify(o && { b: o.base_paise, g: o.gst_paise, a: o.amount_paise, prev: o.previous_badge }));
      } else {
        check(day(iso) + ': ' + h.label + ' asking for ' + short(pass) + ' is refused with a sentence, and no order is made',
          r.status === 409 && typeof r.json?.error === 'string' && r.json.error.length > 20 && !r.json.order_id, r.status + ' ' + r.text.slice(0, 200));
      }
    }
    // The sentence itself, once per holder (the last answer is for VIP).
    if (h.label === 'a paid VIP') check(day(iso) + ': a paid VIP is told it is confirmed and where to write', /VIP Pass is already confirmed/.test(r.json?.error || '') && /info@bharataiinnovation\.com/.test(r.json?.error || '') && !/move up/.test(r.json?.error || ''), r.text);
    if (h.label === 'a complimentary Delegate') check(day(iso) + ': a complimentary Delegate is not promised a step up it cannot buy', /already confirmed/.test(r.json?.error || '') && !/move up/i.test(r.json?.error || '') && /info@bharataiinnovation\.com/.test(r.json?.error || ''), r.text);
    if (h.label === 'a Speaker') check(day(iso) + ': a pass the organisers arrange is told so', /arranged by the organisers/.test(r.json?.error || ''), r.text);
  }
  const paidDelegate = person(nextId++, { badge_type: 'Delegate Pass', payment_status: 'paid' });
  r = await start(paidDelegate, 'Delegate Pass');
  check(day(iso) + ': a paid Delegate asking for the same pass is told which passes it can move up to', r.status === 409 && /move up to Premium Delegate Pass or VIP Pass for the difference/.test(r.json?.error || ''), r.text);
}
realClock();

// ---- C. the sheet and the server agree, pass for pass ----
for (const iso of [STANDARD, LATE]) {
  app._ppPrices = cfg[iso].passes; app._ppGst = cfg[iso].gst_rate;
  for (const h of HOLDERS.filter(x => x.status === 'paid' && x.badge !== 'Visitor Pass')) {
    const shown = Object.fromEntries(steps(h.badge).map(s => [s.pass, s.up.total]));
    const charged = Object.fromEntries(Object.entries(served[iso][h.label]).filter(([, v]) => v !== null));
    check(day(iso) + ': for ' + h.label + ' the sheet shows exactly what the server charges (' + (Object.keys(charged).map(short).join(', ') || 'nothing to move up to') + ')',
      JSON.stringify(shown) === JSON.stringify(charged), 'shown ' + JSON.stringify(shown) + ' charged ' + JSON.stringify(charged));
  }
}
check('GST is ' + GST + '% on both sides', cfg[STANDARD].gst_rate === GST && cfg[LATE].gst_rate === GST);

console.log(fails() ? `\n${fails()} FAILED` : '\nall pass-upgrade unit checks passed');
process.exit(fails() ? 1 : 0);
