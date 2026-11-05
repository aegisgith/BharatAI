// UNIT level for a pass set by hand (5 Nov 2026): the admin page's own three small
// functions, lifted from the /admin.js this build serves and run on their own, and
// its list of passes held against the server's. No browser. Run after `npm run build`.
// The other levels: integration-pass-answer.mjs, system-pass-answer.mjs and
// browser-pass-answer.cjs.
import vm from 'node:vm';
import { makeUpgradeWorld, checker } from './upgrade-world.mjs';

const { check, fails } = checker();
const W = await makeUpgradeWorld();
const js = (await W.hit('GET', '/admin.js')).text;
const lift = (name) => {
  const m = js.match(new RegExp('\\n( *)function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\1\\}'));
  if (!m) throw new Error('/admin.js has no function ' + name);
  return m[0];
};
const tiers = js.match(/var HAND_SET_TIERS = \[[^\]]*\];/);
if (!tiers) throw new Error('/admin.js has no HAND_SET_TIERS');
const box = vm.createContext({ Number, String, isFinite });
vm.runInContext(tiers[0] + '\n' + ['passMoveNeedsAnswer', 'passAnswerAmount', 'passAnswerFields'].map(lift).join('\n'), box);
const { passMoveNeedsAnswer: needs, passAnswerAmount: amount, passAnswerFields: fields } = box;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- Who is asked ----
const PAID = ['Academic Pass', 'Delegate Pass', 'Premium Delegate Pass', 'VIP Pass'];
const OTHERS = ['Visitor Pass', 'Media Pass', 'Organiser', 'VIP Guest', 'Exhibitor', 'Delegate', 'Exhibition Speaker', 'Jury', 'Media', 'Support Staff', 'Investor', 'Felicitation Delegate', 'Speaker', 'Startup Pitcher', '', null, undefined];
for (const from of OTHERS) for (const to of PAID) check('asked: ' + from + ' to ' + to, needs(from, to) === true, 'not asked');
for (const from of PAID) for (const to of PAID) check('not asked, between paid passes: ' + from + ' to ' + to, needs(from, to) === false, 'asked');
for (const from of [...PAID, 'Visitor Pass', '']) for (const to of OTHERS) check('not asked, not a paid pass: ' + from + ' to ' + to, needs(from, to) === false, 'asked');
check('a case slip in a pass name is not a paid pass', needs('Visitor Pass', 'delegate pass') === false, 'asked');

// ---- The list is the server's ----
const cfg = (await W.hit('GET', '/api/payments/config')).json;
check('the admin page and the server name the same four paid passes', same([...box.HAND_SET_TIERS].sort(), Object.keys(cfg.passes).sort()), JSON.stringify([box.HAND_SET_TIERS, Object.keys(cfg.passes)]));

// ---- An amount as typed ----
for (const [typed, want] of [['5898.82', '5898.82'], ['5,898.82', '5898.82'], ['₹5,898.82', '5898.82'], ['Rs 5898', '5898.00'], [' 11798 ', '11798.00'], ['1,00,000', '100000.00'], [5898.82, '5898.82'], ['0.5', '0.50'],
  ['', ''], [null, ''], [undefined, ''], ['0', ''], ['0.00', ''], ['-500', '500.00'], ['abc', ''], ['12.3.4', ''], ['.', '']]) {
  check('amount typed as ' + JSON.stringify(typed) + ' reads as ' + JSON.stringify(want), amount(typed) === want, JSON.stringify(amount(typed)));
}

// ---- What an answer writes ----
check('Complimentary writes waived and no amount', same(fields('waived', ''), { payment_status: 'waived' }), JSON.stringify(fields('waived', '')));
check('a stray amount is not written with Complimentary', same(fields('waived', '5000'), { payment_status: 'waived' }), JSON.stringify(fields('waived', '5000')));
check('Not paid yet writes pending and no amount', same(fields('pending', '5000'), { payment_status: 'pending' }), JSON.stringify(fields('pending', '5000')));
check('Paid another way writes paid and the amount', same(fields('paid', '5,898.82'), { payment_status: 'paid', payment_amount: '5898.82' }), JSON.stringify(fields('paid', '5,898.82')));
for (const blank of ['', '0', 'abc', null]) check('Paid another way with ' + JSON.stringify(blank) + ' is not an answer yet', fields('paid', blank) === null, JSON.stringify(fields('paid', blank)));
for (const none of ['', 'refunded', 'paid ', undefined]) check('no choice (' + JSON.stringify(none) + ') is not an answer', fields(none, '5000') === null, JSON.stringify(fields(none, '5000')));

console.log(fails() ? `\n${fails()} FAILED` : '\nall unit checks passed');
process.exit(fails() ? 1 : 0);
