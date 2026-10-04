-- 0045: orders sent to the payment gateway (CCAvenue), one row per attempt.
--
-- Until now a paid pass was bought on mUni Campus and nothing came back to this
-- database: a Delegate stayed 'pending' until somebody found the payment in a
-- report and confirmed it by hand. With the event's own CCAvenue account the
-- checkout starts here, so the answer comes back here too.
--
-- A row is written BEFORE the buyer leaves for the gateway, with the amount this
-- site decided to charge. The gateway's answer is checked against that row, never
-- against what the answer says about itself: the answer travels through the
-- buyer's browser, and the amount in it is only believed if it equals this one.
--
-- Money is paise, as integers, like the invoices table (0021).
--
-- status: created (sent to the gateway, no answer yet) | paid | failed |
--         aborted (the buyer cancelled) | awaited (the bank has not decided) |
--         mismatch (the gateway said Success for a different amount: nothing is
--         unlocked and somebody has to look).
-- A 'paid' row never changes again; a later answer for the same order is ignored.
--
-- Additive only, and every statement is IF NOT EXISTS, so running this file twice
-- changes nothing. Until it runs, the site keeps sending paid passes to mUni
-- Campus exactly as before (paymentOrdersReady in src/index.tsx).
CREATE TABLE IF NOT EXISTS payment_orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id       TEXT    NOT NULL UNIQUE,          -- ours, sent to the gateway: BAI<attendee>-<stamp>
  attendee_id    INTEGER NOT NULL,
  event_id       INTEGER NOT NULL DEFAULT 1,
  gateway        TEXT    NOT NULL DEFAULT 'ccavenue',
  pass_type      TEXT    NOT NULL,                 -- the pass being bought, spelled as PAID_TIERS
  previous_badge TEXT,                             -- what they held when they started, for the record
  base_paise     INTEGER NOT NULL,                 -- pass price before GST
  gst_paise      INTEGER NOT NULL,
  amount_paise   INTEGER NOT NULL,                 -- what the gateway was asked to charge
  currency       TEXT    NOT NULL DEFAULT 'INR',
  status         TEXT    NOT NULL DEFAULT 'created',
  tracking_id    TEXT,                             -- CCAvenue's reference number
  bank_ref_no    TEXT,
  payment_mode   TEXT,                             -- Credit Card, UPI, Net Banking ...
  card_name      TEXT,
  gateway_status TEXT,                             -- order_status exactly as the gateway sent it
  status_message TEXT,
  gateway_amount TEXT,                             -- the amount the gateway reported, as sent
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  responded_at   TEXT,
  paid_at        TEXT
);

-- "What has this person tried?" on the payments queue, and the hourly cap on new orders.
CREATE INDEX IF NOT EXISTS idx_payment_orders_attendee ON payment_orders(attendee_id, created_at);
-- "Paid online, invoice not raised yet."
CREATE INDEX IF NOT EXISTS idx_payment_orders_status   ON payment_orders(status, paid_at);
