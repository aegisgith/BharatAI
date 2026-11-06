// SYSTEM level for a pass set by hand (5 Nov 2026): the whole worker on real SQLite,
// each answer followed through to what the person can then do and how the organiser's
// Overview counts them. The gateway is played as in the upgrade suites.
import { makeUpgradeWorld, checker, ADMIN, STANDARD, LATE, LIST, paise } from './upgrade-world.mjs';

const { check, fails } = checker();
const W = await makeUpgradeWorld();
W.at(STANDARD);
const put = (id, body) => W.hit('PUT', '/api/admin/attendees/' + id, body, ADMIN);
const token = (id) => W.hit('GET', '/api/my-pass-token', undefined, W.as(id));
const board = async () => (await W.hit('GET', '/api/admin/events/1/board', undefined, ADMIN)).json;
// A pass nobody holds yet may have no row: every count starts at 0.
const row = (b, pass) => ({ complimentary: 0, not_paid: 0, ...((b.passes || []).find(p => p.pass === pass) || {}) });
const byHand = (b) => (b.money?.by_hand || []).reduce((s, x) => s + (x.recorded_paise || 0), 0);
const rupees = (p) => p / 100;

const start = await board();

// ---- Complimentary: the pass works, nothing is for sale, it is not a sale ----
{
  const id = W.person(1);
  await put(id, { badge_type: 'Delegate Pass', payment_status: 'waived' });
  const t = await token(id);
  check('Complimentary: their pass can be issued at once', t.status === 200 && !!t.json?.token, t.text.slice(0, 120));
  const up = await W.start(id, 'Premium Delegate Pass');
  check('Complimentary: they cannot be charged for a move up', up.status === 409 && W.ordersOf(id).length === 0, up.status + ' ' + up.text.slice(0, 140));
  const b = await board();
  check('Complimentary: the Overview counts them as given, not sold', row(b, 'Delegate Pass').complimentary === row(start, 'Delegate Pass').complimentary + 1, JSON.stringify(row(b, 'Delegate Pass')));
  check('Complimentary: no money appears', byHand(b) === byHand(start), byHand(b) + ' ' + byHand(start));
}

// ---- Paid another way: the pass works, a move up costs the difference, the money adds up ----
{
  const id = W.person(2);
  const paidElsewhere = rupees(paise(LIST[STANDARD]['Delegate Pass']).total).toFixed(2);
  await put(id, { badge_type: 'Delegate Pass', payment_status: 'paid', payment_amount: paidElsewhere });
  const t = await token(id);
  check('Paid another way: their pass can be issued at once', t.status === 200 && !!t.json?.token, t.text.slice(0, 120));
  const b = await board();
  check('Paid another way: the Overview shows the money, typed by hand', byHand(b) === byHand(start) + Math.round(Number(paidElsewhere) * 100), byHand(b) + ' ' + byHand(start));
  check('Paid another way: they are not counted as given or as unpaid', row(b, 'Delegate Pass').complimentary === row(start, 'Delegate Pass').complimentary + 1 && row(b, 'Delegate Pass').not_paid === row(start, 'Delegate Pass').not_paid, JSON.stringify(row(b, 'Delegate Pass')));

  const diff = LIST[STANDARD]['Premium Delegate Pass'] - LIST[STANDARD]['Delegate Pass'];
  const bought = await W.buy(id, 'Premium Delegate Pass');
  check('Paid another way: a move up is charged the difference only', bought.order?.base_paise === diff * 100 && bought.order?.previous_badge === 'Delegate Pass', JSON.stringify(bought.order || bought.start?.text).slice(0, 200));
  const a = W.who(id);
  const total = (Number(paidElsewhere) + rupees(paise(diff).total)).toFixed(2);
  check('Paid another way: the pass moved, and what was paid in all adds up', a.badge_type === 'Premium Delegate Pass' && a.payment_status === 'paid' && a.payment_amount === total, JSON.stringify([a.badge_type, a.payment_status, a.payment_amount, total]));
}

// ---- Not paid yet: no pass until they pay, the full price, then it is theirs ----
{
  const id = W.person(3);
  await put(id, { badge_type: 'VIP Pass', payment_status: 'pending' });
  const t = await token(id);
  check('Not paid yet: no pass', t.status !== 200 && !t.json?.token, t.status + ' ' + t.text.slice(0, 120));
  const b = await board();
  check('Not paid yet: the Overview counts them as not paid', row(b, 'VIP Pass').not_paid === row(start, 'VIP Pass').not_paid + 1, JSON.stringify(row(b, 'VIP Pass')));
  const bought = await W.buy(id, 'VIP Pass');
  check('Not paid yet: they are charged the full price', bought.order?.base_paise === LIST[STANDARD]['VIP Pass'] * 100, JSON.stringify(bought.order || bought.start?.text).slice(0, 200));
  const a = W.who(id);
  check('Not paid yet: once paid the pass is confirmed', a.badge_type === 'VIP Pass' && a.payment_status === 'paid' && a.payment_amount === rupees(paise(LIST[STANDARD]['VIP Pass']).total).toFixed(2), JSON.stringify([a.badge_type, a.payment_status, a.payment_amount]));
  const t2 = await token(id);
  check('Not paid yet: and now the pass can be issued', t2.status === 200 && !!t2.json?.token, t2.text.slice(0, 120));
}

// ---- The bug itself, end to end ----
{
  const id = W.person(4);
  const saved = await put(id, { badge_type: 'Delegate Pass', payment_status: 'paid' });
  const a = W.who(id);
  check('what Full Edit used to do (Payment box reads paid, no money): refused, still a Visitor', saved.status === 400 && a.badge_type === 'Visitor Pass', saved.status + ' ' + a.badge_type);
  const up = await W.start(id, 'VIP Pass');
  check('so no one gets a cheap move up on money never received: they buy at the full price', up.status === 201 && up.json?.amount === 23598.82, up.status + ' ' + up.text.slice(0, 200));
}

// ---- On the other side of the dated price change ----
{
  W.at(LATE);
  const id = W.person(5);
  await put(id, { badge_type: 'Delegate Pass', payment_status: 'paid', payment_amount: '5898.82' });
  const s = await W.start(id, 'VIP Pass');
  check('Paid another way, from 6 Nov: the difference at the late prices', s.status === 201 && W.order(s.json.order_id).base_paise === (LIST[LATE]['VIP Pass'] - LIST[LATE]['Delegate Pass']) * 100, s.text.slice(0, 160));
  const p = W.person(6);
  await put(p, { badge_type: 'Delegate Pass', payment_status: 'pending' });
  const s2 = await W.start(p, 'Delegate Pass');
  check('Not paid yet, from 6 Nov: the full late price', s2.status === 201 && W.order(s2.json.order_id).base_paise === LIST[LATE]['Delegate Pass'] * 100, s2.text.slice(0, 160));
  W.at(STANDARD);
}

W.realClock();
console.log(fails() ? `\n${fails()} FAILED` : '\nall system checks passed');
process.exit(fails() ? 1 : 0);
