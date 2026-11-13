-- 0063_attendee_type.sql  (written 13 Nov 2026)
--
-- "I am a..." on /register: who the person is, asked first on the form. One column on
-- attendees: 'corporate', 'startup', 'student', 'faculty', 'government' or 'media',
-- NULL for everyone who registered before the question existed. The words the screens
-- show live in ATTENDEE_TYPES in src/index.tsx.
--
-- The answer chooses which passes the next screen offers first (a student sees the
-- Student Pass, a teacher the Academic Pass), and Admin, Attendees shows and searches it.
--
-- Until it runs, registering works as before and the answer is simply not kept.
--
-- Run it ONCE. A second run stops with "duplicate column name: attendee_type", which
-- changes nothing. Run it with
--   npx wrangler d1 execute bharatai-production --remote --file=./migrations/0063_attendee_type.sql
-- then record it (the migrations ledger stops at 0043, see the handbook, section 3):
--   npx wrangler d1 execute bharatai-production --remote --command "INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0063_attendee_type.sql')"

ALTER TABLE attendees ADD COLUMN attendee_type TEXT;
