-- attendees.registration_date is referenced by three admin routes but has never
-- existed on the table, so every statement naming it fails at prepare time with
-- "no such column". In practice that means:
--
--   PUT  /api/admin/attendees/:id   the admin edit form  — UPDATE ... registration_date=?
--   POST /api/admin/attendees       the Add Attendee button — INSERT (... registration_date ...)
--
-- both error out, and the Reg Date column in Attendee Management rendered "-" for
-- every one of the 1,057 rows because the field was simply absent from the payload.
--
-- The field is intended, not vestigial: the bulk-upload importer maps CSV headers
-- "registration date", "reg_date", "registered" onto it, which exists so historical
-- registrations captured elsewhere can carry their original date rather than the
-- date they happened to be imported. So the column is created rather than the
-- references removed.
--
-- Backfilled from created_at so no row is blank, and every existing attendee keeps
-- a truthful date. TEXT to match how the rest of the schema stores dates and what
-- the importer writes.

ALTER TABLE attendees ADD COLUMN registration_date TEXT;

UPDATE attendees
   SET registration_date = date(created_at)
 WHERE registration_date IS NULL
   AND created_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_attendees_registration_date ON attendees(registration_date);
