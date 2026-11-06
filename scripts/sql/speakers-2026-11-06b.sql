-- Speakers for the app's list, 6 Nov 2026 (organiser). Added to the site the same day.
-- Shri Bhanudas Palwe (IAS) and Shri Bhim Singh list right after Shri Sachin Itkar:
-- same sort_order, newer ids, so run speakers-2026-11-06.sql first. No topics were given.
--
-- Safe to run again: UNIQUE(event_id, slug) skips rows that exist.
--
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/speakers-2026-11-06b.sql

INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, is_featured, is_published, sort_order) VALUES
  (1, 'bhanudas-palwe', 'Shri Bhanudas Palwe (IAS)', 'Commissioner of Fisheries', 'Government of Maharashtra', '', '/images/speaker-bhanudas-palwe-sq.webp', 0, 1, 6),
  (1, 'bhim-singh', 'Shri Bhim Singh', 'Secretary and CEO', 'State Rural Development Agency, Government of Chhattisgarh', '', '/images/speaker-bhim-singh-sq.webp', 0, 1, 6);
