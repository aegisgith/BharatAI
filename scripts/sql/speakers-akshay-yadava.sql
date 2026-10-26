-- Akshay Yadava (Director, UIDAI) for the app's Speakers list (speakers table, migration 0033).
-- Added to the home and conference pages on 26 Oct 2026. Safe to run again:
-- UNIQUE(event_id, slug) makes a second run skip the row.
--
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/speakers-akshay-yadava.sql

INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, is_featured, is_published, sort_order) VALUES (1, 'akshay-yadava', 'Akshay Yadava', 'Director', 'Unique Identification Authority of India (UIDAI)', 'Digital Identity', '/images/speaker-akshay-yadava-sq.webp', 0, 1, 41);
