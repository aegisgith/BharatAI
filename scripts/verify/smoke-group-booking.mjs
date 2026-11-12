// Group booking (12 Nov 2026; tiers 13 Nov): passes of one kind in one booking, paid online
// at /group: 3 or 4 passes 15% off each, 5 or more 30% off each. The built worker on real SQLite with the
// production schema, the gateway played with CCAvenue's own cipher (upgrade-world.mjs).
//   unit:        the price of one pass and of the group on both sides of the dated
//                price change; the rule printed from the two constants
//   integration: the refusals (5 people, the same email twice, a member who holds a
//                confirmed or a complimentary pass, a wrong pass, the GSTIN), the order
//                at n x round(list x 0.7) + GST, the hand-off page, the answer
//   system:      the money lands: every person a paid pass with their share and lunch,
//                new people registered then and not before, a member who got a pass
//                meanwhile passed over and the team told, the receipt with the GST
//                details, each person's email with their own link, the buyer's summary,
//                the result page, the same answer twice, a cancelled payment, the
//                payments queue and the Overview board, the pages that say the rule
// The phone in a real browser is browser-group-booking.cjs.
// Run after `npm run build`:  node scripts/verify/smoke-group-booking.mjs
import { readFileSync } from 'node:fs';
import { makeUpgradeWorld, checker, ADMIN, LATE, STANDARD } from './upgrade-world.mjs';

const W = await makeUpgradeWorld();
const { check, fails } = checker();
const { at, person, who, order, answer, until, mailTo, setting, hit, q, db, sent, subject, html, as, handoff } = W;
const TEAM = 'info@bharataiinnovation.com';
const exec = (file) => db.exec(readFileSync(new URL('../../migrations/' + file, import.meta.url), 'utf8'));
for (const [k, v] of Object.entries({ inv_legal_name: 'Smoke Organiser Trust', inv_gstin: '27AAATS0000A1Z5', inv_state: 'Maharashtra', inv_state_code: '27', inv_prefix: 'AKT', inv_next_number: '119' })) setting(k, v);

// Each start from its own address, so the per-address limit is tested on its own.
let ipNo = 0;
const ip = () => ({ 'CF-Connecting-IP': '10.0.0.' + (++ipNo) });
const stamp = (iso) => iso.slice(0, 19).replace('T', ' ');
const start = async (body, headers = {}) => {
  const r = await hit('POST', '/api/group/start', body, { ...ip(), ...headers });
  // As upgrade-world does: the order is stamped with the pinned day, for the hand-off page.
  if (r.json?.order_id) db.run('UPDATE payment_orders SET created_at = ? WHERE order_id = ?', [stamp(LATE), r.json.order_id]);
  return r;
};
const blank = { name: '', email: '', mobile: '', designation: '' };
const people = (n, tag, over = {}) => Array.from({ length: n }, (_, i) => ({ name: 'Member ' + tag + (i + 1), email: `m${i + 1}.${tag}@team.example`, mobile: '', designation: 'Analyst', ...(over[i] || {}) }));
const buyerA = { name: 'Priya Buyer', email: 'priya.buyer@acme.example', mobile: '98200 11111', company: 'Acme Analytics' };
const paise = (inr) => inr * 100;
const withGst = (p) => p + Math.round(p * 18 / 100);
const count = (sql, ...a) => Number(q(sql, ...a)[0]?.n || 0);
let r;

at(LATE);

// ---- 0. before 0059: nothing is sold ----
r = await hit('GET', '/group');
check('before 0059: /group says group booking opens shortly, with no form', r.status === 200 && /opens shortly/.test(r.text) && !/id="gb-form"/.test(r.text), r.text.slice(0, 200));
r = await start({ pass_type: 'Delegate Pass', buyer: buyerA, members: people(6, 'z') });
check('before 0059: a start is refused, and nothing is written', r.status === 503 && /opens shortly/.test(r.json?.error || '') && count('SELECT COUNT(*) AS n FROM payment_orders') === 0, r.status + ' ' + r.text);
exec('0059_group_orders.sql');

// ---- 1. unit: the prices ----
const LIST = { 'Delegate Pass': 8999, 'Premium Delegate Pass': 14999, 'VIP Pass': 24999 };
const UNIT = { 'Delegate Pass': 6299, 'Premium Delegate Pass': 10499, 'VIP Pass': 17499 };   // round(list x 0.70), 5 or more
const UNIT15 = { 'Delegate Pass': 7649, 'Premium Delegate Pass': 12749, 'VIP Pass': 21249 }; // round(list x 0.85), 3 or 4
r = await hit('GET', '/group');
check('the page: three passes, the list price struck through, 30% off for 5 or more and 15% off for 3 or 4', r.status === 200 && /id="gb-form"/.test(r.text)
  && Object.keys(LIST).every(p => r.text.includes('value="' + p + '" data-list="' + LIST[p] + '"') && r.text.includes('&#8377;' + UNIT[p].toLocaleString('en-IN') + ' <small>+ GST each, 5 or more</small>') && r.text.includes('&#8377;' + UNIT15[p].toLocaleString('en-IN') + ' + GST each for 3 or 4'))
  && r.text.includes('<s>&#8377;8,999</s>') && r.text.includes('data-tiers="[{&quot;min&quot;:5,&quot;pct&quot;:30},{&quot;min&quot;:3,&quot;pct&quot;:15}]"') && !/value="(Student|Academic) Pass"/.test(r.text), r.text.slice(0, 300));
check('the rule is printed from the constants, in the words everywhere uses', r.text.includes('Passes of one kind in one booking, paid online: 3 or 4 passes, 15% off each; 5 or more, 30% off each.'), '');
check('it starts with 3 empty people, Add a person, I am attending too, and the total for 3 at 15% off', (r.text.match(/class="gb-person"/g) || []).length === 4 /* 3 + the template */ && r.text.includes('id="gb-add"') && r.text.includes('I am attending too')
  && r.text.includes('Pay &#8377;' + (withGst(3 * paise(7649)) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 }) + ' and book 3 passes'), r.text.match(/Pay [^<]*/)?.[0]);
check('phone-first: inputs at 16px, taps at 44px or more, its own script', /font-size:16px/.test(r.text) && /min-height:48px/.test(r.text) && r.text.includes('/js/group-booking.js?v=') && r.text.includes('novalidate'), '');
r = await hit('GET', '/group?pass=vip');
check('?pass=vip opens on the VIP Pass', /value="VIP Pass" data-list="24999" checked/.test(r.text), '');
at(STANDARD);
r = await hit('GET', '/group');
check('before 6 Nov the standard price is the list: Delegate 4,999 less 30% is 3,499, less 15% is 4,249', r.text.includes('value="Delegate Pass" data-list="4999"') && r.text.includes('&#8377;3,499 <small>+ GST each, 5 or more</small>') && r.text.includes('&#8377;4,249 + GST each for 3 or 4'), r.text.match(/value="Delegate Pass"[^>]*/)?.[0]);
at(LATE);

// ---- 2. integration: refusals, and nothing written by any of them ----
const before = count('SELECT COUNT(*) AS n FROM attendees');
r = await start({ pass_type: 'Delegate Pass', buyer: buyerA, members: [...people(2, 'a'), blank] });
check('2 people: refused, a group is 3 or more (a pair does not qualify)', r.status === 400 && r.json.field === 'members' && /3 passes or more\. You have 2 on the list: add 1 more\./.test(r.json.error), r.text);
r = await start({ pass_type: 'Delegate Pass', buyer: buyerA, members: people(6, 'b', { 3: { email: 'm2.b@team.example' } }) });
check('the same email twice: refused on that person, naming the first', r.status === 400 && r.json.row === 4 && r.json.field === 'email' && /same email as person 2/.test(r.json.error), r.text);
r = await start({ pass_type: 'Student Pass', buyer: buyerA, members: people(6, 'c') });
check('a Student Pass is not a group pass', r.status === 400 && r.json.field === 'pass', r.text);
r = await start({ pass_type: 'Delegate Pass', buyer: { ...buyerA, mobile: '' }, members: people(6, 'c') });
check('the buyer\'s mobile is asked for', r.status === 400 && r.json.field === 'buyer-mobile', r.text);
r = await start({ pass_type: 'Delegate Pass', buyer: buyerA, members: people(6, 'c', { 2: { name: 'X' } }) });
check('a person with no name: refused with their number', r.status === 400 && r.json.row === 3 && r.json.field === 'name', r.text);
r = await start({ pass_type: 'Delegate Pass', buyer: buyerA, billing: { legal_name: 'Acme Analytics Pvt Ltd', gstin: '27ABC', address: '' }, members: people(6, 'c') });
check('a GSTIN that is not one: refused, the GST section named', r.status === 400 && r.json.field === 'billing' && /GSTIN/.test(r.json.error), r.text);
const PAIDD = person(40, { name: 'Has Delegate', email: 'm3.d@team.example', badge_type: 'Delegate Pass', payment_status: 'paid', payment_amount: '10618.82' });
r = await start({ pass_type: 'Delegate Pass', buyer: buyerA, members: people(6, 'd') });
check('a member with a confirmed paid pass: refused with their number (person 3), no second pass sold', r.status === 409 && r.json.row === 3 && /already has a pass/.test(r.json.error), r.text);
person(41, { name: 'Comp Vip', email: 'm5.e@team.example', badge_type: 'VIP Pass', payment_status: 'waived' });
r = await start({ pass_type: 'Delegate Pass', buyer: buyerA, members: people(6, 'e') });
check('a complimentary VIP is refused too (person 5)', r.status === 409 && r.json.row === 5, r.text);
person(42, { name: 'Speaker Sam', email: 'm1.f@team.example', badge_type: 'Speaker', payment_status: 'waived' });
r = await start({ pass_type: 'Delegate Pass', buyer: buyerA, members: people(6, 'f') });
check('an organisers\' pass (Speaker) is refused too', r.status === 409 && r.json.row === 1, r.text);
check('no refusal wrote a registration, an order or a group', count('SELECT COUNT(*) AS n FROM attendees') === before + 3 /* the three made above */ && count('SELECT COUNT(*) AS n FROM payment_orders') === 0 && count('SELECT COUNT(*) AS n FROM group_orders') === 0, count('SELECT COUNT(*) AS n FROM attendees') + ' vs ' + (before + 3));

// ---- 2b. the tiers: 3 and 4 people at 15% off, 5 at 30% off ----
for (const [n, unit, total] of [[3, 7649, 27077.46], [4, 7649, 36103.28], [5, 6299, 37164.1]]) {
  const t = await start({ pass_type: 'Delegate Pass', buyer: { name: 'Tier Buyer ' + n, email: 'tier' + n + '@tiers.example', mobile: '98200' + String(70000 + n), company: 'Tiers' }, members: people(n, 't' + n) });
  check(n + ' people: ' + n + ' x ' + unit + ' + GST = ' + total, t.status === 201 && t.json.amount === total && t.json.qty === n && order(t.json.order_id).base_paise === n * unit * 100, t.status + ' ' + t.text);
  if (t.json?.order_id) { db.run("UPDATE group_orders SET status = 'cancelled' WHERE order_id = ?", [t.json.order_id]); db.run("DELETE FROM payment_orders WHERE order_id = ?", [t.json.order_id]); db.run("DELETE FROM attendees WHERE email LIKE 'tier%@tiers.example'"); }
}

// ---- 3. integration: the order ----
const V1 = person(50, { name: 'Vera Visitor', email: 'vera@team.example', badge_type: 'Visitor Pass', payment_status: 'paid', job_title: '' });
const PEND = person(51, { name: 'Pending Paul', email: 'paul@team.example', badge_type: 'VIP Pass', payment_status: 'pending' });
const LATER = person(52, { name: 'Late Lata', email: 'lata@team.example', badge_type: 'Visitor Pass', payment_status: 'paid' });
const HOLDER = person(53, { name: 'Mobile Holder', email: 'holder@else.example', mobile: '9876543210' });
const team8 = [
  { name: 'Vera Visitor', email: 'Vera@Team.example', mobile: '', designation: 'Data Lead' },
  { name: 'Pending Paul', email: 'paul@team.example', mobile: '', designation: '' },
  blank,
  { name: 'Late Lata', email: 'lata@team.example', mobile: '', designation: '' },
  { name: 'New One', email: 'new1@team.example', mobile: '98200 22222', designation: 'ML Engineer' },
  { name: 'New Two', email: 'new2@team.example', mobile: '+91 98765 43210', designation: 'Analyst' },   // HOLDER's number
  { name: 'New Three', email: 'new3@team.example', mobile: '', designation: '' },
  { name: 'New Four', email: 'new4@team.example', mobile: '', designation: '' },
  { name: 'New Five', email: 'new5@team.example', mobile: '', designation: 'CTO' },
];
r = await start({ pass_type: 'Delegate Pass', buyer: buyerA, billing: { legal_name: 'Acme Analytics Pvt Ltd', gstin: '27AAACA1234B1Z5', address: 'Kurla West, Mumbai 400070' }, members: team8 });
const G1 = r.json?.order_id;
const total8 = withGst(8 * paise(6299));
check('8 people (an empty row passed over): 8 x 6,299 + GST = 59,462.56', r.status === 201 && r.json.amount === 59462.56 && r.json.qty === 8 && total8 === 5946256 && /^\/pay\/ccavenue\//.test(r.json.pay_url), r.status + ' ' + r.text);
const o1 = order(G1) || {};
check('one order under the buyer: pass_type "Group: 8 x Delegate Pass", base, GST and total in paise', o1.pass_type === 'Group: 8 x Delegate Pass' && o1.base_paise === 8 * 629900 && o1.gst_paise === 907056 && o1.amount_paise === 5946256 && /^BAI\d{1,9}-[A-Z0-9]{8,18}$/.test(G1), JSON.stringify(o1));
const BUYER = Number(o1.attendee_id);
check('the buyer, new and not on the list, is registered on a Visitor Pass (source group, not coming), and signed in', who(BUYER)?.email === 'priya.buyer@acme.example' && who(BUYER).badge_type === 'Visitor Pass' && who(BUYER).registration_source === 'group' && Number(who(BUYER).main_event) === 0 && o1.previous_badge === 'Visitor Pass' && /bai_session=/.test(r.headers.get('set-cookie') || ''), JSON.stringify(who(BUYER)));
const g1 = q('SELECT * FROM group_orders WHERE order_id = ?', G1)[0] || {};
const m1 = JSON.parse(g1.members || '[]');
check('the group is held with its 8 people, the known ones by id, the price per pass kept', g1.status === 'held' && g1.qty === 8 && g1.unit_base_paise === 629900 && g1.pass_type === 'Delegate Pass' && m1.length === 8 && m1[0].attendee_id === V1 && m1[0].email === 'vera@team.example' && m1[4].attendee_id === null, JSON.stringify(m1.slice(0, 5)));
check('nobody new is registered before the money lands', count("SELECT COUNT(*) AS n FROM attendees WHERE email LIKE 'new%@team.example'") === 0, '');
const ho = await handoff(r.json.pay_url);
check('the hand-off page names the group and the amount, and asks the gateway for exactly that', ho.status === 200 && ho.text.includes('Group: 8 x Delegate Pass') && ho.text.includes('59,462.56') && ho.asked.amount === '59462.56' && ho.asked.merchant_param2 === 'Group: 8 x Delegate Pass' && !/Upgrade to/.test(ho.text), ho.status + ' ' + JSON.stringify(ho.asked));

// Meanwhile, Lata buys a Premium Delegate Pass of her own.
db.run("UPDATE attendees SET badge_type = 'Premium Delegate Pass', payment_status = 'paid', payment_amount = '17698.82' WHERE id = ?", [LATER]);

// ---- 4. system: the money lands ----
sent.length = 0;
const back = await answer(G1);
const given = [V1, PEND];
await until(() => who(V1).badge_type === 'Delegate Pass' && sent.filter(p => /is confirmed$/.test(subject(p))).length >= 7 && mailTo(TEAM).length >= 1 && mailTo('priya.buyer@acme.example').some(p => /^Booked:/.test(subject(p))), 12000);
const fresh = ['new1', 'new2', 'new3', 'new4', 'new5'].map(k => q('SELECT * FROM attendees WHERE email = ?', k + '@team.example')[0]);
check('paid: the order is paid and the gateway sends the buyer to the result page', order(G1).status === 'paid' && /^\/pay\/result\?o=/.test(back.location), JSON.stringify([order(G1).status, back]));
check('the two already registered are Delegate Pass, paid, their share with GST (7,432.82), lunch, coming', given.every(id => who(id).badge_type === 'Delegate Pass' && who(id).payment_status === 'paid' && who(id).payment_amount === '7432.82' && who(id).lunch_inclusion === 'Yes' && Number(who(id).main_event) === 1), JSON.stringify(given.map(who).map(a => [a.badge_type, a.payment_status, a.payment_amount, a.lunch_inclusion])));
check('a blank designation is filled from the list, never one already there', who(V1).job_title === 'Data Lead', who(V1).job_title);
check('the five new people are registered now, each on a paid Delegate Pass with their share, source group, the buyer\'s company', fresh.every(a => a && a.badge_type === 'Delegate Pass' && a.payment_status === 'paid' && a.payment_amount === '7432.82' && a.lunch_inclusion === 'Yes' && a.registration_source === 'group' && a.company === 'Acme Analytics' && Number(a.main_event) === 1), JSON.stringify(fresh.map(a => a && [a.email, a.badge_type, a.payment_amount, a.company])));
check('their designation and mobile are kept; a mobile someone else holds is left off', fresh[0].job_title === 'ML Engineer' && fresh[0].mobile === '9820022222' && fresh[1].mobile === '' && fresh[4].job_title === 'CTO', JSON.stringify(fresh.map(a => [a.mobile, a.job_title])));
check('Lata, who bought her own pass meanwhile, keeps it: no second pass', who(LATER).badge_type === 'Premium Delegate Pass' && who(LATER).payment_amount === '17698.82', JSON.stringify(who(LATER)));
const g1p = q('SELECT * FROM group_orders WHERE order_id = ?', G1)[0];
const mp = JSON.parse(g1p.members);
check('the group is paid and says who got a pass and who was passed over', g1p.status === 'paid' && !!g1p.paid_at && mp.filter(e => e.status === 'given').length === 7 && mp.find(e => e.email === 'lata@team.example').status === 'skipped' && mp.find(e => e.email === 'lata@team.example').held === 'Premium Delegate Pass', JSON.stringify(mp.map(e => e.email + ':' + e.status)));
const inv1 = q('SELECT * FROM invoices WHERE order_ref = ?', G1);
check('one receipt for the whole amount, to the buyer, with the GST details from the form', inv1.length === 1 && inv1[0].total_paise === 5946256 && inv1[0].attendee_id === BUYER && inv1[0].buyer_gstin === '27AAACA1234B1Z5' && inv1[0].buyer_company === 'Acme Analytics Pvt Ltd' && /^Group: 8 x Delegate Pass - Bharat AI Innovation/.test(inv1[0].item_desc), JSON.stringify(inv1));
await until(() => who(BUYER).payment_status === '', 3000);
check('the buyer, not on the list, keeps their own Visitor Pass as it was (the receipt does not mark it paid)', who(BUYER).badge_type === 'Visitor Pass' && who(BUYER).payment_status === '' && who(BUYER).lunch_inclusion === 'No', JSON.stringify([who(BUYER).badge_type, who(BUYER).payment_status, who(BUYER).lunch_inclusion]));
const memberMail = (email) => mailTo(email).filter(p => subject(p) === 'Your Delegate Pass for Bharat AI Innovation 2026 is confirmed');
check('each of the 7 gets their own email: confirmed, booked by the buyer and company, with their own sign-in link', ['vera@team.example', 'paul@team.example', 'new1@team.example', 'new2@team.example', 'new3@team.example', 'new4@team.example', 'new5@team.example'].every(e => memberMail(e).length === 1 && /booked by Priya Buyer, Acme Analytics/.test(html(memberMail(e)[0])) && W.tokensIn(memberMail(e)[0]).length === 1 && html(memberMail(e)[0]).includes('email=' + encodeURIComponent(e))), sent.map(p => W.to(p) + ':' + subject(p)).join(' | '));
check('a Delegate Pass email has no workshop line; Lata gets nothing', !/choose your seat/.test(html(memberMail('vera@team.example')[0])) && mailTo('lata@team.example').length === 0, '');
const bmail = mailTo('priya.buyer@acme.example').find(p => /^Booked:/.test(subject(p)));
check('the buyer\'s summary: 7 passes, the list, Lata passed over and what happens next, the receipt', bmail && subject(bmail) === 'Booked: 7 Delegate Passes for your group at Bharat AI Innovation 2026' && /New Five/.test(html(bmail)) && /already had a pass/.test(html(bmail)) && /refund that pass/.test(html(bmail)) && /59,462\.56/.test(html(bmail)) && /Receipt <strong>/.test(html(bmail)), bmail ? subject(bmail) : 'none');
const tmail = mailTo(TEAM).find(p => /^Group booking paid:/.test(subject(p)));
check('the team is told, with ACTION NEEDED for the pass to refund or swap', tmail && /Priya Buyer, Acme Analytics, 8 x Delegate Pass, Rs 59,462\.56 \(ACTION NEEDED\)/.test(subject(tmail)) && /Refund or swap/.test(html(tmail)) && html(tmail).includes('lata@team.example: Premium Delegate Pass'), tmail ? subject(tmail) : sent.map(subject).join('|'));
const aud = W.rows('payment.received', BUYER).pop();
check('the audit log has the payment with the group in it', aud && JSON.parse(aud.detail).group.qty === 8 && JSON.parse(aud.detail).group.given.length === 7 && JSON.parse(aud.detail).group.skipped[0] === 'lata@team.example', aud && aud.detail);
r = await hit('GET', back.location);
check('the result page: the group is booked, 7 passes, Lata\'s pass mentioned, the saved form cleared', r.status === 200 && /Your group is booked/.test(r.text) && /7 Delegate Passes for Bharat AI Innovation 2026 are confirmed/.test(r.text) && /1 person on your list already had a pass/.test(r.text) && r.text.includes('sessionStorage.removeItem("bai_group_draft")') && r.text.includes('59,462.56'), r.text.slice(0, 300));
const n1 = sent.length;
const again = await answer(G1);
await new Promise(res => setTimeout(res, 600));
check('the same answer twice changes nothing and sends nothing', again.status === 303 && sent.length === n1 && q('SELECT COUNT(*) AS n FROM invoices WHERE order_ref = ?', G1)[0].n === 1, sent.length + ' vs ' + n1);

// ---- 5. the buyer signed in and coming: Premium Delegate, a workshop each ----
const SELF = person(900, { name: 'Ravi Lead', email: 'ravi@beta.example', badge_type: 'Visitor Pass', payment_status: 'paid', company: 'Beta Labs' });
const crew = [{ name: 'Ravi Lead', email: 'ravi@beta.example', mobile: '', designation: 'Head of AI' }, ...people(5, 'g')];
r = await start({ pass_type: 'Premium Delegate Pass', buyer: { name: 'Ravi Lead', email: 'ravi@beta.example', mobile: '9820033333', company: 'Beta Labs' }, members: crew }, as(SELF));
const G2 = r.json?.order_id;
check('signed in: 6 x 10,499 + GST = 74,332.92, under their own registration, no new session', r.status === 201 && r.json.amount === 74332.92 && order(G2).attendee_id === SELF && !/bai_session=/.test(r.headers.get('set-cookie') || ''), r.status + ' ' + r.text);
sent.length = 0;
const back2 = await answer(G2);
await until(() => who(SELF).badge_type === 'Premium Delegate Pass' && sent.filter(p => /is confirmed$/.test(subject(p))).length >= 6, 12000);
check('the buyer on the list holds the Premium Delegate Pass, paid, their share (12,388.82)', who(SELF).badge_type === 'Premium Delegate Pass' && who(SELF).payment_status === 'paid' && who(SELF).payment_amount === '12388.82', JSON.stringify(who(SELF)));
const pm = mailTo('m1.g@team.example').find(p => /Premium Delegate Pass for Bharat AI Innovation 2026 is confirmed/.test(subject(p)));
check('a Premium Delegate email has the workshop line with the seat link', pm && /choose your seat in the app/.test(html(pm)) && /action=workshop/.test(html(pm)), pm ? 'no line' : 'no email');
r = await hit('GET', back2.location, undefined, as(SELF));
check('their result page opens the app', /Your group is booked/.test(r.text) && r.text.includes('href="/app"') && /6 Premium Delegate Passes/.test(r.text), r.text.slice(0, 200));

// ---- 6. an existing address typed by someone not signed in: no session for them ----
const OTHER = person(950, { name: 'Real Owner', email: 'owner@gamma.example' });
r = await start({ pass_type: 'VIP Pass', buyer: { name: 'Someone', email: 'owner@gamma.example', mobile: '9820044444', company: '' }, members: people(6, 'h') });
check('typing a registered address books under that registration, but signs nobody in', r.status === 201 && order(r.json.order_id).attendee_id === OTHER && !/bai_session=/.test(r.headers.get('set-cookie') || '') && r.json.amount === withGst(6 * paise(17499)) / 100, r.status + ' ' + r.text);
const G3 = r.json.order_id;
r = await start({ pass_type: 'VIP Pass', buyer: { name: 'Someone', email: 'owner@gamma.example', mobile: '9820044444', company: '' }, members: people(7, 'h') });
check('starting again replaces the open booking', q('SELECT status FROM group_orders WHERE order_id = ?', G3)[0].status === 'cancelled' && q('SELECT status FROM group_orders WHERE order_id = ?', r.json.order_id)[0].status === 'held', '');

// ---- 7. cancelled at the gateway ----
const back4 = await answer(r.json.order_id, { order_status: 'Aborted' });
r = await hit('GET', back4.location);
check('cancelled: told so, nothing issued, Try again goes back to the form', r.status === 200 && /You cancelled the payment/.test(r.text) && r.text.includes('href="/group"') && count("SELECT COUNT(*) AS n FROM attendees WHERE email LIKE '%.h@team.example'") === 0, r.text.slice(0, 200));

// ---- 8. the queues and the board ----
r = await hit('GET', '/api/admin/payments-pending', undefined, ADMIN);
const po = (r.json?.paid_online || []).find(x => x.order_id === G1);
check('Admin, Payments lists the group under Paid online, with its pass and amount', r.status === 200 && po && po.pass_type === 'Group: 8 x Delegate Pass' && po.amount === 59462.56 && po.email === 'priya.buyer@acme.example', r.status + ' ' + JSON.stringify(po));
r = await hit('GET', '/api/admin/events/1/board', undefined, ADMIN);
check('the Overview board answers, with the group\'s money among what was paid on this site', r.status === 200 && (r.json?.money?.sold || []).some(s => s.pass === 'Group: 8 x Delegate Pass' && s.total === 5946256), r.status + ' ' + JSON.stringify(r.json?.money?.sold));

// ---- 9. checkout off, and the per-address limit ----
setting('payment_gateway', 'off');
r = await start({ pass_type: 'Delegate Pass', buyer: buyerA, members: people(6, 'k') });
check('checkout off: refused with a sentence', r.status === 503 && /not available just now/.test(r.json?.error || ''), r.text);
r = await hit('GET', '/group');
check('and the page says so, with the button off', /Online payment is not available just now/.test(r.text) && /id="gb-go" disabled/.test(r.text), '');
setting('payment_gateway', 'ccavenue');
let last = null;
for (let i = 0; i < 21; i++) last = await hit('POST', '/api/group/start', { pass_type: 'Delegate Pass', buyer: buyerA, members: people(5, 'l') }, { 'CF-Connecting-IP': '10.9.9.9' });
check('one address: 20 tries an hour, then a polite no', last.status === 429 && /a lot of bookings/.test(last.json?.error || ''), last.status + ' ' + last.text);

// ---- 10. the pages that state the rule ----
r = await hit('GET', '/passes');
check('/passes: "Booking for three or more?" and a button, both to /group; the old five-for-four rule gone', r.text.includes('Booking for three or more?') && r.text.includes('<a href="/group" class="text-primary-400 underline">Book for your group</a>') && r.text.includes('<a class="ps-buy" href="/group">Book for your group</a>') && !/price of four/.test(r.text) && r.text.includes('Passes of one kind in one booking, paid online: 3 or 4 passes, 15% off each; 5 or more, 30% off each.'), '');
r = await hit('GET', '/register');
check('/register: the group section books online', /id="delegation-section"[\s\S]{0,400}href="\/group" class="rg-ghost">Book for your group/.test(r.text) && !/price of four/.test(r.text), '');
r = await hit('GET', '/contact');
check('/contact: the group form opens with the notice and a link to /group, the form kept', r.text.includes('Booking 3 or more passes? Book online with up to 30% off.') && r.text.includes('href="/group"') && r.text.includes('cf-groupsize') && !/5\+ people/.test(r.text), '');
const site = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8'), llms = readFileSync(new URL('../../public/llms.txt', import.meta.url), 'utf8');
check('the home page and llms.txt state the new rule and link /group', !/price of four/.test(site) && site.includes('https://bharataiinnovation.com/group') && site.includes('href="/group"') && !/price of four/.test(llms) && llms.includes('https://bharataiinnovation.com/group'), '');

console.log(fails() ? `\n${fails()} FAILED` : '\nALL PASSED');
process.exit(fails() ? 1 : 0);
