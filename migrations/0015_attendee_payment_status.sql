-- Stop a paid pass being self-issued for free.
--
-- /register accepts badge_type from the request body and stores it verbatim, so
-- posting {"badge_type":"VIP Pass"} creates a Rs.14,999 pass for nothing. The tier
-- cannot simply be ignored: the paid flow sets it BEFORE redirecting to mUni
-- Campus, and there is no callback to set it afterwards. So the tier is still
-- recorded — it just no longer confers anything until payment is confirmed.
--
-- DEFAULT 'paid' is deliberate. Every existing attendee keeps exactly the access
-- they have today; only registrations made after this column exists can land in
-- 'pending'. Nobody is locked out by applying this.
--
-- The application treats the EXISTENCE of this column as the switch, so the code
-- deploy and this migration are independent and safe in either order.

ALTER TABLE attendees ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'paid';

CREATE INDEX IF NOT EXISTS idx_attendees_payment_status ON attendees(payment_status);
