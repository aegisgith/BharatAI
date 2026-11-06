// INTEGRATION level for a pass set by hand (5 Nov 2026): the Admin routes on the
// built worker and real SQLite with the production schema. What each of the four
// screens sends, each answer, money already on record, and that nobody else moves.
// The bug this closes: Full Edit always posts its Payment box, which reads 'paid' on
// a free pass, and that stepped around the rule making a hand-given pass complimentary.
// Since 6 Nov 2026 no money paid means no paid pass: a save with neither money nor a plain
// answer is refused and they stay where they are; Add Attendee stores a Visitor Pass.
import { makeUpgradeWorld, checker, ADMIN, STANDARD } from './upgrade-world.mjs';

const { check, fails } = checker();
const W = await makeUpgradeWorld();
W.at(STANDARD);
let next = 100;
// The next free id: Add Attendee takes ids of its own.
const visitor = (over = {}) => W.person(Number(W.q('SELECT COALESCE(MAX(id), 99) + 1 AS id FROM attendees')[0].id), over);
const put = (id, body) => W.hit('PUT', '/api/admin/attendees/' + id, body, ADMIN);
const patch = (id, body) => W.hit('PATCH', '/api/admin/attendees/' + id, body, ADMIN);
const bulk = (ids, changes) => W.hit('POST', '/api/admin/attendees/bulk-update', { ids, changes }, ADMIN);
const add = (body) => W.hit('POST', '/api/admin/attendees', { event_id: 1, name: 'Added ' + next, email: 'added' + (next++) + '@example.com', ...body }, ADMIN);
const money = (v) => String(v ?? '');
const holds = (id, badge, status, amount) => {
  const a = W.who(id);
  return a.badge_type === badge && a.payment_status === status && (amount === undefined || money(a.payment_amount) === amount);
};
const seen = (id) => JSON.stringify((({ badge_type, payment_status, payment_amount, lunch_inclusion }) => ({ badge_type, payment_status, payment_amount, lunch_inclusion }))(W.who(id)));
const refused = (r) => r.status === 400 && /no money on record/.test(r.json?.error || '');
const REFUSED_WORDS = /Not saved.*stay on the pass they hold.*Complimentary or Not paid yet/;

// ---- Full Edit: it always posts the Payment box ----
{
  const id = visitor();
  const r = await put(id, { badge_type: 'Delegate Pass', payment_status: 'paid' });
  check('Full Edit, Visitor to Delegate, Payment box still reading paid, no money: refused, still a Visitor', refused(r) && holds(id, 'Visitor Pass', 'paid'), r.status + seen(id));
  check('and the admin is told why, in words', REFUSED_WORDS.test(r.json?.error || ''), r.text.slice(0, 200));
  const r2 = await put(id, { badge_type: 'Delegate Pass', payment_status: 'paid', company: 'Moved Co' });
  check('nothing else in that save lands either: they are told, and try again', refused(r2) && W.who(id).company !== 'Moved Co', seen(id));
}
{
  const id = visitor();
  await put(id, { badge_type: 'Delegate Pass', payment_status: 'paid', payment_amount: '5898.82' });
  check('Full Edit, Paid another way: paid, with the amount', holds(id, 'Delegate Pass', 'paid', '5898.82'), seen(id));
  const log = W.q("SELECT detail FROM admin_audit WHERE action = 'attendee.update' AND entity_id = ?", String(id))[0]?.detail || '';
  check('the log keeps the amount and the pass, old and new', log.includes('5898.82') && log.includes('Delegate Pass'), log);
}
{
  const id = visitor();
  await put(id, { badge_type: 'VIP Pass', payment_status: 'waived' });
  check('Full Edit, Complimentary said plainly: still given', holds(id, 'VIP Pass', 'waived'), seen(id));
  check('and it has the lunch the pass includes', W.who(id).lunch_inclusion === 'Yes', seen(id));
}
{
  const id = visitor();
  await put(id, { badge_type: 'Premium Delegate Pass', payment_status: 'pending' });
  check('Full Edit, Not paid yet', holds(id, 'Premium Delegate Pass', 'pending'), seen(id));
}
{
  const id = visitor({ payment_amount: '0' });
  const r = await put(id, { badge_type: 'Academic Pass', payment_status: 'paid', payment_amount: '0' });
  check('an amount of nothing is no money: stays a Visitor', refused(r) && holds(id, 'Visitor Pass', 'paid'), seen(id));
}
{
  const id = visitor();
  const r = await put(id, { badge_type: 'Academic Pass', payment_status: 'paid', payment_amount: 'free' });
  check('words in the amount are no money: stays a Visitor', refused(r) && holds(id, 'Visitor Pass', 'paid'), seen(id));
}
{
  const id = visitor({ payment_status: 'pending' });
  const r = await put(id, { badge_type: 'Delegate Pass', payment_status: 'paid' });
  check('a free pass somehow marked pending, saved as paid with no money: stays a Visitor', refused(r) && holds(id, 'Visitor Pass', 'pending'), seen(id));
}

// ---- Money already on record stays a sale ----
{
  const id = visitor({ payment_amount: '5898.82' });
  await put(id, { badge_type: 'Delegate Pass', payment_status: 'paid' });
  check('an amount already on the row: stays paid', holds(id, 'Delegate Pass', 'paid', '5898.82'), seen(id));
}
{
  const id = visitor();
  W.db.run("INSERT INTO payment_orders (order_id, attendee_id, event_id, gateway, pass_type, base_paise, gst_paise, amount_paise, status) VALUES (?, ?, 1, 'ccavenue', 'Delegate Pass', 499900, 89982, 589882, 'paid')", ['BAITEST-' + id, id]);
  await put(id, { badge_type: 'Delegate Pass', payment_status: 'paid' });
  check('a paid order on record: stays paid', holds(id, 'Delegate Pass', 'paid'), seen(id));
}
{
  const id = visitor();
  W.db.run("INSERT INTO invoices (invoice_no, attendee_id, buyer_name, buyer_email, item_desc, taxable_paise, total_paise) VALUES (?, ?, 'B', 'b@example.com', 'Delegate Pass', 499900, 589882)", ['INV-' + id, id]);
  await put(id, { badge_type: 'Delegate Pass', payment_status: 'paid' });
  check('an invoice on record: stays paid', holds(id, 'Delegate Pass', 'paid'), seen(id));
}

// ---- What must not change ----
{
  const id = visitor({ badge_type: 'Delegate Pass', payment_status: 'paid', payment_amount: '5898.82' });
  await put(id, { badge_type: 'Delegate Pass', payment_status: 'paid', company: 'New Co' });
  check('saving a paid Delegate with nothing to do with the pass: still paid', holds(id, 'Delegate Pass', 'paid', '5898.82') && W.who(id).company === 'New Co', seen(id));
  await put(id, { badge_type: 'VIP Pass', payment_status: 'paid' });
  check('between paid passes by hand: what they paid stays', holds(id, 'VIP Pass', 'paid', '5898.82'), seen(id));
}
{
  const id = visitor({ badge_type: 'Delegate Pass', payment_status: 'paid' });
  await put(id, { badge_type: 'Delegate Pass', payment_status: 'paid' });
  check('a pass already held and marked paid with no amount is not silently changed by a save (the organiser decides those)', holds(id, 'Delegate Pass', 'paid'), seen(id));
}
{
  const id = visitor({ badge_type: 'Delegate Pass', payment_status: 'waived' });
  await put(id, { badge_type: 'VIP Pass', payment_status: 'waived' });
  check('a complimentary pass moved up stays complimentary', holds(id, 'VIP Pass', 'waived'), seen(id));
}
{
  const id = visitor();
  await put(id, { badge_type: 'Exhibitor', payment_status: 'paid' });
  check('Visitor to Exhibitor is not a paid pass: left alone', holds(id, 'Exhibitor', 'paid'), seen(id));
  const v2 = visitor();
  await put(v2, { badge_type: 'Visitor Pass', payment_status: 'paid', city: 'Pune' });
  check('a Visitor edited and staying a Visitor: left alone', holds(v2, 'Visitor Pass', 'paid'), seen(v2));
}
{
  const id = visitor({ badge_type: 'Delegate Pass', payment_status: 'pending' });
  await put(id, { badge_type: 'Delegate Pass', payment_status: 'paid' });
  check('marking an unpaid Delegate paid by hand is an existing decision: left as said', holds(id, 'Delegate Pass', 'paid'), seen(id));
}

// ---- The inline cell ----
{
  const id = visitor();
  const r = await patch(id, { badge_type: 'VIP Pass', payment_status: 'paid', payment_amount: '23,598.82' });
  check('inline cell, Paid another way', r.status === 200 && holds(id, 'VIP Pass', 'paid') && money(W.who(id).payment_amount).includes('23'), seen(id));
}
{
  const id = visitor();
  await patch(id, { badge_type: 'VIP Pass', payment_status: 'waived' });
  check('inline cell, Complimentary', holds(id, 'VIP Pass', 'waived'), seen(id));
}
{
  const id = visitor();
  await patch(id, { badge_type: 'Delegate Pass', payment_status: 'pending' });
  check('inline cell, Not paid yet', holds(id, 'Delegate Pass', 'pending'), seen(id));
}
{
  const id = visitor();
  const r = await patch(id, { badge_type: 'Delegate Pass' });
  check('inline cell with no answer (an old page still open): refused, still a Visitor', refused(r) && holds(id, 'Visitor Pass', 'paid'), r.status + seen(id));
}
{
  const id = visitor();
  const r = await patch(id, { badge_type: 'Delegate Pass', payment_status: 'paid' });
  check('inline cell saying paid with no money: refused, still a Visitor', refused(r) && holds(id, 'Visitor Pass', 'paid'), r.status + seen(id));
}

// ---- Set pass on a selection ----
{
  const a = visitor(), b = visitor();
  const r = await bulk([a, b], { badge_type: 'Delegate Pass', payment_status: 'paid', payment_amount: '5898.82' });
  check('Set pass, Paid another way: each has the amount', r.status === 200 && holds(a, 'Delegate Pass', 'paid', '5898.82') && holds(b, 'Delegate Pass', 'paid', '5898.82'), seen(a) + seen(b));
}
{
  const a = visitor(), b = visitor();
  await bulk([a, b], { badge_type: 'Delegate Pass', payment_status: 'waived' });
  check('Set pass, Complimentary', holds(a, 'Delegate Pass', 'waived') && holds(b, 'Delegate Pass', 'waived'), seen(a) + seen(b));
}
{
  const a = visitor();
  await bulk([a], { badge_type: 'Delegate Pass', payment_status: 'pending' });
  check('Set pass, Not paid yet', holds(a, 'Delegate Pass', 'pending'), seen(a));
}
{
  const a = visitor(), b = visitor({ badge_type: 'Delegate Pass', payment_status: 'paid', payment_amount: '5898.82' });
  const r = await bulk([a, b], { badge_type: 'VIP Pass' });
  check('Set pass with no answer on a mixed selection (an old page): nobody moves, all or nothing', refused(r) && holds(a, 'Visitor Pass', 'paid') && holds(b, 'Delegate Pass', 'paid', '5898.82'), r.status + seen(a) + seen(b));
  check('and the message counts the people it stopped on', /^Not saved\. This person/.test(r.json?.error || ''), r.text.slice(0, 200));
}
{
  const a = visitor();
  const r = await bulk([a], { badge_type: 'VIP Pass', payment_status: 'paid' });
  check('Set pass saying paid with no money: refused, still a Visitor', refused(r) && holds(a, 'Visitor Pass', 'paid'), r.status + seen(a));
}
{
  // The two calls the page makes for a mixed selection: the answer goes on the mover only.
  const mover = visitor(), holder = visitor({ badge_type: 'Delegate Pass', payment_status: 'paid', payment_amount: '5898.82' });
  await bulk([holder], { badge_type: 'VIP Pass' });
  await bulk([mover], { badge_type: 'VIP Pass', payment_status: 'pending' });
  check('a mixed selection as the page sends it: the holder keeps paid, the mover has the answer', holds(holder, 'VIP Pass', 'paid', '5898.82') && holds(mover, 'VIP Pass', 'pending'), seen(holder) + seen(mover));
}
{
  // Ninety-plus rows must not fail on D1's limit of 100 bound values.
  const ids = Array.from({ length: 170 }, () => visitor({ mobile: null }));
  const r = await bulk(ids, { badge_type: 'Delegate Pass', payment_status: 'paid' });
  check('170 people at once, paid with no money: every one still a Visitor, and the count is right', refused(r) && ids.every(i => holds(i, 'Visitor Pass', 'paid')) && /170 of these people/.test(r.json.error), r.text.slice(0, 200));
}

// ---- Add Attendee ----
const addedId = (r) => r.json?.id;
{
  const r = await add({ badge_type: 'VIP Pass', payment_status: 'waived' });
  check('Add Attendee, Complimentary', r.status === 201 && holds(addedId(r), 'VIP Pass', 'waived'), r.text.slice(0, 160));
}
{
  const r = await add({ badge_type: 'Delegate Pass', payment_status: 'paid', payment_amount: '5898.82' });
  check('Add Attendee, Paid another way', r.status === 201 && holds(addedId(r), 'Delegate Pass', 'paid', '5898.82'), r.text.slice(0, 160));
}
{
  const r = await add({ badge_type: 'Delegate Pass', payment_status: 'pending' });
  check('Add Attendee, Not paid yet', r.status === 201 && holds(addedId(r), 'Delegate Pass', 'pending'), r.text.slice(0, 160));
}
{
  const r = await add({ badge_type: 'Delegate Pass', payment_status: 'paid' });
  check('Add Attendee saying paid with no money: a Visitor Pass', r.status === 201 && holds(addedId(r), 'Visitor Pass', 'paid'), r.text.slice(0, 160));
  check('and a Visitor has no lunch', W.who(addedId(r)).lunch_inclusion === 'No', seen(addedId(r)));
}
{
  const r = await add({ badge_type: 'VIP Pass', lunch_inclusion: 'Yes' });
  check('Add Attendee with no answer (an old page): a Visitor Pass, with no lunch whatever the form said', r.status === 201 && holds(addedId(r), 'Visitor Pass', 'paid') && W.who(addedId(r)).lunch_inclusion === 'No', r.text.slice(0, 160));
}
{
  const r = await add({ badge_type: 'Visitor Pass' });
  check('Add Attendee, a Visitor Pass: paid by column default, as before', r.status === 201 && holds(addedId(r), 'Visitor Pass', 'paid'), r.text.slice(0, 160));
}
{
  const r = await add({ badge_type: 'Delegate', lunch_inclusion: 'Yes' });
  check('Add Attendee, the old plain Delegate (an old page opened on it): a Visitor Pass, no lunch', r.status === 201 && holds(addedId(r), 'Visitor Pass', 'paid') && W.who(addedId(r)).lunch_inclusion === 'No', r.text.slice(0, 160));
  const none = await add({});
  check('Add Attendee, no pass at all: a Visitor Pass, no lunch', none.status === 201 && holds(addedId(none), 'Visitor Pass', 'paid') && W.who(addedId(none)).lunch_inclusion === 'No', none.text.slice(0, 160));
  const sp = await add({ badge_type: 'Speaker' });
  check('Add Attendee, a pass with nothing to pay: left as chosen', sp.status === 201 && W.who(addedId(sp)).badge_type === 'Speaker', sp.text.slice(0, 160));
  const held = visitor({ badge_type: 'Delegate' });
  const save = await put(held, { badge_type: 'Delegate', city: 'Pune' });
  check('someone still holding the old Delegate is not changed by saving them: the organiser decides', save.status === 200 && W.who(held).badge_type === 'Delegate' && W.who(held).city === 'Pune', seen(held));
}

// ---- Bulk Upload is unchanged ----
{
  const r = await W.hit('POST', '/api/admin/attendees/bulk', { event_id: 1, attendees: [{ name: 'Imported', email: 'imported@example.com', badge_type: 'Delegate Pass' }] }, ADMIN);
  const a = W.q("SELECT * FROM attendees WHERE email = 'imported@example.com'")[0];
  check('Bulk Upload still makes a paid pass complimentary', r.status === 200 && a?.payment_status === 'waived', JSON.stringify([r.status, a?.payment_status]));
  await W.hit('POST', '/api/admin/attendees/bulk', { event_id: 1, attendees: [{ name: 'No Pass', email: 'imp-none@example.com' }, { name: 'Old Name', email: 'imp-old@example.com', badge_type: 'Delegate' }] }, ADMIN);
  const none = W.q("SELECT * FROM attendees WHERE email = 'imp-none@example.com'")[0], old = W.q("SELECT * FROM attendees WHERE email = 'imp-old@example.com'")[0];
  check('Bulk Upload, a row with no pass or the old Delegate: a Visitor Pass, no lunch', none?.badge_type === 'Visitor Pass' && none?.lunch_inclusion === 'No' && old?.badge_type === 'Visitor Pass' && old?.lunch_inclusion === 'No', JSON.stringify([none?.badge_type, none?.lunch_inclusion, old?.badge_type, old?.lunch_inclusion]));
}

// ---- Only Admin may do any of it ----
{
  const id = visitor();
  const r = await W.hit('PUT', '/api/admin/attendees/' + id, { badge_type: 'VIP Pass', payment_status: 'paid', payment_amount: '1' });
  check('with no Admin sign-in nothing changes', r.status === 401 && holds(id, 'Visitor Pass', 'paid'), r.status + seen(id));
  const self = await W.hit('PUT', '/api/admin/attendees/' + id, { badge_type: 'VIP Pass', payment_status: 'paid', payment_amount: '1' }, W.as(id));
  check('someone signed in as themselves cannot give themselves a pass', self.status === 401 && holds(id, 'Visitor Pass', 'paid'), self.status + seen(id));
}

W.realClock();
console.log(fails() ? `\n${fails()} FAILED` : '\nall integration checks passed');
process.exit(fails() ? 1 : 0);
