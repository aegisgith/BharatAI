-- Group bookings, 30% off (12 Nov 2026).
--
-- The organiser: instead of a group enquiry nobody has time to answer, 6 or more
-- passes of one kind in one booking get 30% off each pass, paid online at /group
-- (Delegate, Premium Delegate or VIP). One row per checkout, beside its CCAvenue
-- order (payment_orders, under the buyer, pass_type 'Group: <n> x <pass>'):
-- 'held' while the order is open, 'paid' once the money lands (each person on the
-- list then holds the pass, and members says who got one and who was passed over
-- because they already held a pass), 'cancelled' when the same buyer starts again.
-- Nobody on the list is registered before the money lands.
--
-- Run once (production, from the repo root):
--   npx wrangler d1 execute bharatai-production --remote --file=migrations/0059_group_orders.sql
-- Until it runs, /group says group booking opens shortly and nothing is sold.
CREATE TABLE IF NOT EXISTS group_orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id          INTEGER NOT NULL DEFAULT 1,
  order_id          TEXT    NOT NULL UNIQUE,         -- payment_orders.order_id
  buyer_attendee_id INTEGER NOT NULL,                -- payment_orders.attendee_id: the person paying
  pass_type         TEXT    NOT NULL,                -- Delegate Pass | Premium Delegate Pass | VIP Pass
  qty               INTEGER NOT NULL,                -- passes in the booking (6 to 50)
  unit_base_paise   INTEGER NOT NULL,                -- one pass before GST: the list price that day less 30%
  members           TEXT    NOT NULL DEFAULT '[]',   -- JSON: [{attendee_id, name, email, mobile, designation}], with status once paid
  buyer             TEXT    NOT NULL DEFAULT '{}',   -- JSON: {name, email, mobile, company}, as typed on the form
  billing           TEXT    NOT NULL DEFAULT '',     -- JSON: the GST invoice details from the form, '' when none were sent
  status            TEXT    NOT NULL DEFAULT 'held', -- held | paid | cancelled
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  paid_at           TEXT
);

CREATE INDEX IF NOT EXISTS idx_group_orders_buyer ON group_orders(buyer_attendee_id, status);
CREATE INDEX IF NOT EXISTS idx_group_orders_status ON group_orders(event_id, status, created_at);
