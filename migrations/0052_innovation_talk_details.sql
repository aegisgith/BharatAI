-- 0052_innovation_talk_details.sql  (written 12 Nov 2026)
--
-- The admin Innovation Talks tab gains what the organisers asked for on 12 Nov 2026:
-- the hall each talk is in, the speaker's own email and mobile, and a note of when
-- the speaker was last emailed for missing details.
--
--   hall                  'Kalam Theatre' for the Expo Stage; the same hall names as
--                         the app's sessions (scripts/data/schedule.json)
--   speaker_email         the speaker's own address, for the "missing details" email
--   speaker_phone         for the day itself, if a time or a stage changes
--   details_requested_at  when the last "missing details" email went (UTC)
--   details_requested_to  the address it went to
--
-- Additive only. Until it runs, the tab and the app carry on without these columns:
-- the routes leave them out when the database does not have them.
--
-- Run it with
--   npx wrangler d1 execute bharatai-production --remote --file=./migrations/0052_innovation_talk_details.sql
-- then record it (the migrations ledger stops at 0043, see the handbook, section 3):
--   npx wrangler d1 execute bharatai-production --remote --command "INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0052_innovation_talk_details.sql')"
-- and then the talk times and halls: scripts/sql/innovation-talk-times.sql
ALTER TABLE innovation_talks ADD COLUMN hall                 TEXT DEFAULT '';
ALTER TABLE innovation_talks ADD COLUMN speaker_email        TEXT DEFAULT '';
ALTER TABLE innovation_talks ADD COLUMN speaker_phone        TEXT DEFAULT '';
ALTER TABLE innovation_talks ADD COLUMN details_requested_at TEXT;
ALTER TABLE innovation_talks ADD COLUMN details_requested_to TEXT DEFAULT '';
