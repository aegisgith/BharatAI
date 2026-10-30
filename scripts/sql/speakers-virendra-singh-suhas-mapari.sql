-- Shri Virendra Singh (IAS) and Shri Suhas Mapari (IAS), Government of Maharashtra, for the app's
-- Speakers list (speakers table, migration 0033). Added to the home and conference pages on
-- 30 Oct 2026: Virendra Singh third in the first row, Suhas Mapari right after Dr. Kunal Khemnar
-- in the second.
--
-- sort_order 4 is Shri K.K. Singh's and 6 is Dr. Shrikant Patil's: a tie falls to the newer id, so
-- Virendra Singh lists right after K.K. Singh and Suhas Mapari after Dr. Kunal Khemnar, with the
-- Maharashtra government speakers, rather than at the end. Safe to run again:
-- UNIQUE(event_id, slug) makes a second run skip the rows.
--
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/speakers-virendra-singh-suhas-mapari.sql

INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, is_featured, is_published, sort_order) VALUES (1, 'virendra-singh', 'Shri Virendra Singh (IAS)', 'Secretary, Electronics, Information Technology and Artificial Intelligence Department', 'Government of Maharashtra', 'AI in Governance', '/images/speaker-virendra-singh-sq.webp', 0, 1, 4);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, is_featured, is_published, sort_order) VALUES (1, 'suhas-mapari', 'Shri Suhas Mapari (IAS)', 'Joint Secretary, Chief Minister''s Secretariat; Additional CEO, Vision Management Unit for Viksit Maharashtra 2047', 'Government of Maharashtra', 'Viksit Maharashtra 2047', '/images/speaker-suhas-mapari-sq.webp', 0, 1, 6);
