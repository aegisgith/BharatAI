-- Speakers for the app's list, 6 Nov 2026 (organiser). Added to the site the same day.
-- Shri Vinamra Mishra, Smt. Prajakta Verma (IAS) and Shri Sachin Itkar list right after
-- Shri Vivek Khandekar: same sort_order, newer ids. No topics were given.
-- Dr. Vivek Bhoite came off: hidden, row kept, if an earlier run added him.
--
-- Safe to run again: UNIQUE(event_id, slug) skips rows that exist.
--
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/speakers-2026-11-06.sql

INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, is_featured, is_published, sort_order) VALUES
  (1, 'vinamra-mishra', 'Shri Vinamra Mishra', 'Joint Secretary', 'Ministry of Micro, Small and Medium Enterprises (MSME), Government of India', '', '/images/speaker-vinamra-mishra-sq.webp', 0, 1, 6),
  (1, 'prajakta-verma', 'Smt. Prajakta Verma (IAS)', 'Additional Municipal Commissioner', 'Brihanmumbai Municipal Corporation (BMC)', '', '/images/speaker-prajakta-verma-sq.webp', 0, 1, 6),
  (1, 'sachin-itkar', 'Shri Sachin Itkar', 'Vice President', 'Maharashtra Economic Development Council (MEDC)', '', '/images/speaker-sachin-itkar-sq.webp', 0, 1, 6);

UPDATE speakers SET is_published = 0 WHERE event_id = 1 AND slug = 'vivek-bhoite';
