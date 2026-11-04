-- Speaker changes of 4 Nov 2026 for the app's Speakers list (speakers table, migration 0033),
-- the same as the home and conference pages and llms.txt in the same commit. One run does all
-- five, and it is safe to run again (UNIQUE(event_id, slug) skips a row already there; the
-- UPDATEs set the same value twice).
--
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/speakers-2026-11-04.sql
--
-- The app lists speakers by sort_order, and a tie falls to the newer id:
-- 1. Shri Kaustubh Dhavse, Chief Advisor to the Chief Minister: sort 6 (Dr. Shrikant Patil,
--    Dr. Kunal Khemnar, Shri Suhas Mapari), so right after Suhas Mapari, as on the pages.
-- 2. Vishal Rally, Chief Revenue Officer, Tata Tele Business Services: sort 27 (Jagbir Singh,
--    Vodafone Idea), so right after him, with the telecom speakers.
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, is_featured, is_published, sort_order) VALUES (1, 'kaustubh-dhavse', 'Shri Kaustubh Dhavse', 'Chief Advisor to the Chief Minister (Investments, Infrastructure, Technology and Strategy)', 'Government of Maharashtra', 'Investments & Infrastructure', '/images/speaker-kaustubh-dhavse-sq.webp', 0, 1, 6);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, is_featured, is_published, sort_order) VALUES (1, 'vishal-rally', 'Vishal Rally', 'Chief Revenue Officer', 'Tata Tele Business Services', 'AI for Business', '/images/speaker-vishal-rally-sq.webp', 0, 1, 27);

-- 3. Dr. Dhaval Pujara (Adani University; Education Panel) has dropped out. Hidden, row kept, so
--    is_published = 1 undoes it. If scripts/sql/speakers-education-panel.sql was never run there
--    is no row and this changes nothing; that file no longer adds him.
UPDATE speakers SET is_published = 0, updated_at = CURRENT_TIMESTAMP WHERE event_id = 1 AND slug = 'dhaval-pujara';

-- 4. Saurabh N. Mehta is Dr. Saurabh N. Mehta (the education panel file now says so too).
UPDATE speakers SET name = 'Dr. Saurabh N. Mehta', updated_at = CURRENT_TIMESTAMP WHERE event_id = 1 AND slug = 'saurabh-mehta';

-- 5. Dr. Rajul Gajjar is the Former Vice Chancellor of Gujarat Technological University.
UPDATE speakers SET role = 'Former Vice Chancellor', updated_at = CURRENT_TIMESTAMP WHERE event_id = 1 AND slug = 'rajul-gajjar';
