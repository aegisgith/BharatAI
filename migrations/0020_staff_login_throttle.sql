-- Throttling for badge-desk sign-in.
--
-- Desk passwords are three words and three digits, typed on a phone at a door, so
-- they are deliberately short. Nothing rate-limited /api/staff/login, which left a
-- small keyspace open to an unlimited number of guesses.
--
-- These two columns back a progressive DELAY on repeated failures rather than a
-- lockout. A lockout would be worse than the attack it prevents: usernames are
-- guessable (desk1..desk8), so anyone could lock the whole door team out in the
-- middle of the event by failing on purpose. A delay costs an attacker everything
-- and costs a staff member who fat-fingered a password about a second.
--
-- The application checks for these columns before using them, so this migration and
-- the code deploy are independent of each other, in either order.

ALTER TABLE staff ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE staff ADD COLUMN last_failed_at DATETIME;
