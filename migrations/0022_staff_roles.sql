-- Roles for staff accounts.
--
-- Issuing an invoice required ADMIN_SECRET, which is the key to the whole panel:
-- every attendee's email and mobile, the settings, the other staff accounts. The
-- accounts team needs to raise invoices and nothing else, and the badge desk must
-- not be able to raise one at all.
--
-- Same table, same PBKDF2 passwords, same signed session. Only what the session is
-- allowed to reach changes. Existing rows default to 'desk', which is what every
-- account created before this was.

ALTER TABLE staff ADD COLUMN role TEXT NOT NULL DEFAULT 'desk';
ALTER TABLE staff ADD COLUMN email TEXT;

CREATE INDEX IF NOT EXISTS idx_staff_role ON staff(role);
