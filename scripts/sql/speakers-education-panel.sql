-- Education Panel speakers for the app's Speakers list (speakers table, migration 0033).
-- The Education Panel as on the home and conference pages: seven on 24 Oct 2026, six since
-- Dr. Dhaval Pujara dropped out on 4 Nov (scripts/sql/speakers-2026-11-04.sql hides his row if
-- this file was already run). Safe to run again:
-- UNIQUE(event_id, slug) makes a second run skip every row already there.
--
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/speakers-education-panel.sql

INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, is_featured, is_published, sort_order) VALUES (1, 'lakshmi-mohan', 'Dr. Lakshmi Mohan', 'Pro Vice Chancellor', 'ITM Skills University', 'Education Panel', '/images/speaker-lakshmi-mohan-sq.webp', 0, 1, 35);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, is_featured, is_published, sort_order) VALUES (1, 'manpreet-singh-manna', 'Dr. Manpreet Singh Manna', 'Founding Executive Director', 'GCC School', 'Education Panel', '/images/speaker-manpreet-singh-manna-sq.webp', 0, 1, 36);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, is_featured, is_published, sort_order) VALUES (1, 'priyesh-gandhi', 'Dr. Priyesh Gandhi', 'Provost (Vice Chancellor)', 'Sigma University', 'Education Panel', '/images/speaker-priyesh-gandhi-sq.webp', 0, 1, 37);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, is_featured, is_published, sort_order) VALUES (1, 'shashank-dalvi', 'Dr. Shashank D Dalvi', 'Vice Chancellor', 'MGM Institute of Health Sciences', 'Education Panel', '/images/speaker-shashank-dalvi-sq.webp', 0, 1, 38);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, is_featured, is_published, sort_order) VALUES (1, 'raju-haldankar', 'Raju Haldankar', 'President', 'Chetana''s Institute of Management & Research', 'Education Panel', '/images/speaker-raju-haldankar-sq.webp', 0, 1, 39);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, is_featured, is_published, sort_order) VALUES (1, 'saurabh-mehta', 'Dr. Saurabh N. Mehta', 'Chief Academic Officer & Professor', 'Vidyalankar Institute of Technology, Mumbai', 'Education Panel', '/images/speaker-saurabh-mehta-sq.webp', 0, 1, 40);
