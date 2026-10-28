-- Dr. Kunal Khemnar (IAS), Joint CEO, MIDC, for the app's Speakers list (speakers table, migration 0033).
-- Added to the home and conference pages on 28 Oct 2026, first in the second row. sort_order 6 is
-- Dr. Shrikant Patil's: the tie falls to the newer id, so he lists right after him, with the
-- Maharashtra government speakers, rather than at the end. Safe to run again:
-- UNIQUE(event_id, slug) makes a second run skip the row.
--
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/speakers-kunal-khemnar.sql

INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, is_featured, is_published, sort_order) VALUES (1, 'kunal-khemnar', 'Dr. Kunal Khemnar (IAS)', 'Joint Chief Executive Officer', 'Maharashtra Industrial Development Corporation (MIDC)', 'Industrial Development', '/images/speaker-kunal-khemnar-sq.webp', 0, 1, 6);
