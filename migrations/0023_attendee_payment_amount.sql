-- The payment_amount the admin panel has always tried to save.
--
-- Admin "Save Changes" and "Add Attendee" both bound payment_amount, and the column
-- was never created - no migration adds it. Every write through those two handlers
-- failed with "no such column", silently, for as long as they have existed. The
-- handlers were made tolerant separately, intersecting their field set with the
-- columns that actually exist; this gives them the column back so the Payment field
-- in Attendee Management does what it looks like it does.
--
-- Free text rather than a number, because that is what the admin form and the
-- existing sort treat it as: values like "5,898.82" and "paid by NEFT" are already
-- what people type into it.
--
-- Bookkeeping note: d1_migrations had stalled at 0012 because 0013-0022 were applied
-- by hand with `d1 execute`. It has been backfilled, so `d1 migrations apply` is a
-- clean no-op again and this file is the first that can go through it normally.

ALTER TABLE attendees ADD COLUMN payment_amount TEXT;
