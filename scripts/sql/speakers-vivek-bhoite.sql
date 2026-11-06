-- Dr. Vivek Bhoite, Agricultural Scientist, Krishi Vigyan Kendra (KVK), is a confirmed
-- speaker (organiser, 6 Nov 2026). Added to the home and conference pages the same day.
-- No topic was given, so the topic is empty.
--
-- Safe to run again: UNIQUE(event_id, slug) skips the row.
--
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/speakers-vivek-bhoite.sql

INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, is_featured, is_published, sort_order) VALUES
  (1, 'vivek-bhoite', 'Dr. Vivek Bhoite', 'Agricultural Scientist', 'Krishi Vigyan Kendra (KVK)', '', '/images/speaker-vivek-bhoite-sq.webp', 0, 1, 44);
