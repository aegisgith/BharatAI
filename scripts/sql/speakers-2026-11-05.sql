-- Speakers added on 5 Nov 2026, for the app's Speakers list (speakers table, migration 0033),
-- the same as the home and conference pages and llms.txt in the same commit. Safe to run again:
-- UNIQUE(event_id, slug) makes a second run skip a row already there.
--
-- Run scripts/sql/speakers-2026-11-04.sql first if it has not been run, so that Dr. Mahesh lists
-- after Shri Kaustubh Dhavse.
--
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/speakers-2026-11-05.sql
--
-- The app lists speakers by sort_order, and a tie falls to the newer id:
-- 1. Hon’ble Shri Ashish Nandkishore Jaiswal: sort 2 (Shri Sanjay Rathod), so right after him, with
--    the ministers. The topic names no keynote, because none has been confirmed.
-- 2. Dr. K. Mahesh: sort 6 (Dr. Kunal Khemnar, Shri Suhas Mapari, Shri Kaustubh Dhavse), so right
--    after Shri Dhavse, as on the pages.
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'ashish-jaiswal', 'Hon’ble Shri Ashish Nandkishore Jaiswal', 'Minister of State for Finance, Planning, Agriculture, Assistance and Rehabilitation', 'Government of Maharashtra', 'Minister of State', '/images/speaker-ashish-jaiswal-sq.webp', 2);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'k-mahesh', 'Dr. K. Mahesh', 'Secretary, Art, Culture & Language Department', 'Government of NCT of Delhi', 'Art, Culture & Language', '/images/speaker-k-mahesh-sq.webp', 6);
