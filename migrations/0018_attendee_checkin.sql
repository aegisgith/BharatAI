-- Event-day check-in.
--
-- There was no way to verify a pass. The QR encoded
-- networking.bharataiinnovation.com?email=<address> — a subdomain that 301s to the
-- homepage — so scanning a pass landed staff on the marketing site, and the code
-- itself leaked the holder's email to anyone who photographed the pass.
--
-- Recording the check-in is what stops one pass walking in twice: the second scan
-- can report when and by whom it was already used, rather than silently admitting
-- a second person.

ALTER TABLE attendees ADD COLUMN checked_in_at DATETIME;
ALTER TABLE attendees ADD COLUMN checked_in_by TEXT;

CREATE INDEX IF NOT EXISTS idx_attendees_checked_in ON attendees(checked_in_at);
