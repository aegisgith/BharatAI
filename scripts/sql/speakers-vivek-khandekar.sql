-- Shri Vivek Khandekar (IFS) for the app's Speakers list (speakers table, migration 0033), the same
-- as the home and conference pages and llms.txt in the same commit. Safe to run again:
-- UNIQUE(event_id, slug) makes a second run skip the row.
--
-- Run scripts/sql/speakers-2026-11-05.sql first if it has not been run, so that he lists after
-- Dr. K. Mahesh. The app lists by sort_order and a tie falls to the newer id: sort 6 puts him right
-- after Dr. Mahesh, with the other state officers. His topic stays empty here, as on the home page:
-- it shows with his talk, from scripts/sql/innovation-talks.sql.
--
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/speakers-vivek-khandekar.sql

INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'vivek-khandekar', 'Shri Vivek Khandekar (IFS)', 'Principal Chief Conservator of Forests (Social Forestry)', 'Maharashtra Forest Department', '', '/images/speaker-vivek-khandekar-sq.webp', 6);
