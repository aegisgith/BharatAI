-- 0062_lead_tags.sql  (written 13 Nov 2026)
--
-- What a visitor wants, ticked at the booth when their badge is scanned: a demo, a
-- price, a partnership, buying soon, an investor, looking for a job. One column on
-- exhibitor_leads (0051): the keys, comma separated ('demo,price'), '' when none. The
-- words the screens show live in LEAD_TAGS in src/index.tsx.
--
-- Until it runs, the scanner and the lead lists simply show no tags; scanning, ratings
-- and notes work as before.
--
-- Run it ONCE. A second run stops with "duplicate column name: tags", which changes
-- nothing. Run it with
--   npx wrangler d1 execute bharatai-production --remote --file=./migrations/0062_lead_tags.sql
-- then record it (the migrations ledger stops at 0043, see the handbook, section 3):
--   npx wrangler d1 execute bharatai-production --remote --command "INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0062_lead_tags.sql')"

ALTER TABLE exhibitor_leads ADD COLUMN tags TEXT NOT NULL DEFAULT '';
