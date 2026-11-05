// INTEGRATION level for a pass set by hand (5 Nov 2026): the Admin routes on the
// built worker and real SQLite with the production schema. What each of the four
// screens sends, each answer, money already on record, and that nobody else moves.
// The bug this closes: Full Edit always posts its Payment box, which reads 'paid' on
// a free pass, and that stepped around the rule making a hand-given pass complimentary.
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
const givenAudit = (id) => W.q("SELECT * FROM admin_audit WHERE action = 'attendee.pass-given' AND entity_id = ?", String(id)).length;

// ---- Full Edit: it always posts the Payment box ----
{
  const id = visitor();
  const r = await put(id, { badge_type: 'Delegate Pass', payment_status: 'paid' });
  check('Full Edit, Visitor to Delegate, Payment box still reading paid: complimentary, not a sale', r.status === 200 && holds(id, 'Delegate Pass', 'waived'), seen(id));
  check('and the log says the pass was given', givenAudit(id) === 1, String(givenAudit(id)));
  check('and it has the lunch the pass includes', W.who(id).lunch_inclusion === 'Yes', seen(id));
}
{
  const id = visitor();
  await put(id, { badge_type: 'Delegate Pass', payment_status: 'paid', payment_amount: '5898.82' });
  check('Full Edit, Paid another way: paid, with the amount', holds(id, 'Delegate Pass', 'paid', '5898.82'), seen(id));
  check('and it is not logged as given', givenAudit(id) === 0, String(givenAudit(id)));
  const log = W.q("SELECT detail FROM admin_audit WHERE action = 'attendee.update' AND entity_id = ?", String(id))[0]?.detail || '';
  check('the log keeps the amount and the pass, old and new', log.includes('5898.82') && log.includes('Delegate Pass'), log);
}
{
  const id = visitor();
  await put(id, { badge_type: 'VIP Pass', payment_status: 'waived' });
  check('Full Edit, Complimentary', holds(id, 'VIP Pass', 'waived'), seen(id));
}
{
  const id = visitor();
  await put(id, { badge_type: 'Premium Delegate Pass', payment_status: 'pending' });
  check('Full Edit, Not paid yet', holds(id, 'Premium Delegate Pass', 'pending'), seen(id));
}
{
  const id = visitor({ payment_amount: '0' });
  await put(id, { badge_type: 'Academic Pass', payment_status: 'paid', payment_amount: '0' });
  check('an amount of nothing is no money: complimentary', holds(id, 'Academic Pass', 'waived'), seen(id));
}
{
  const id = visitor();
  await put(id, { badge_type: 'Academic Pass', payment_status: 'paid', payment_amount: 'free' });
  check('words in the amount are no money: complimentary', holds(id, 'Academic Pass', 'waived'), seen(id));
}
{
  const id = visitor({ payment_status: 'pending' });
  await put(id, { badge_type: 'Delegate Pass', payment_status: 'paid' });
  check('a free pass somehow marked pending, saved as paid with no money: complimentary', holds(id, 'Delegate Pass', 'waived'), seen(id));
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
  await patch(id, { badge_type: 'Delegate Pass' });
  check('inline cell with no answer (an old page still open): complimentary', holds(id, 'Delegate Pass', 'waived'), seen(id));
}
{
  const id = visitor();
  await patch(id, { badge_type: 'Delegate Pass', payment_status: 'paid' });
  check('inline cell saying paid with no money: complimentary', holds(id, 'Delegate Pass', 'waived'), seen(id));
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
  await bulk([a, b], { badge_type: 'VIP Pass' });
  check('Set pass with no answer on a mixed selection: the Visitor is given, the paid Delegate keeps what they paid', holds(a, 'VIP Pass', 'waived') && holds(b, 'VIP Pass', 'paid', '5898.82'), seen(a) + seen(b));
}
{
  const a = visitor();
  await bulk([a], { badge_type: 'VIP Pass', payment_status: 'paid' });
  check('Set pass saying paid with no money: complimentary', holds(a, 'VIP Pass', 'waived'), seen(a));
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
  check('170 people at once, paid with no money: every one complimentary', r.status === 200 && ids.every(i => holds(i, 'Delegate Pass', 'waived')), r.text.slice(0, 200));
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
  check('Add Attendee saying paid with no money: complimentary', r.status === 201 && holds(addedId(r), 'Delegate Pass', 'waived'), r.text.slice(0, 160));
}
{
  const r = await add({ badge_type: 'VIP Pass' });
  check('Add Attendee with no answer (an old page): complimentary, as before', r.status === 201 && holds(addedId(r), 'VIP Pass', 'waived'), r.text.slice(0, 160));
}
{
  const r = await add({ badge_type: 'Visitor Pass' });
  check('Add Attendee, a Visitor Pass: paid by column default, as before', r.status === 201 && holds(addedId(r), 'Visitor Pass', 'paid'), r.text.slice(0, 160));
}

// ---- Bulk Upload is unchanged ----
{
  const r = await W.hit('POST', '/api/admin/attendees/bulk', { event_id: 1, attendees: [{ name: 'Imported', email: 'imported@example.com', badge_type: 'Delegate Pass' }] }, ADMIN);
  const a = W.q("SELECT * FROM attendees WHERE email = 'imported@example.com'")[0];
  check('Bulk Upload still makes a paid pass complimentary', r.status === 200 && a?.payment_status === 'waived', JSON.stringify([r.status, a?.payment_status]));
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
