-- The app's Live Feed (public on /app, signed out) still showed the five
-- announcements seeded on 5 March 2026. This names the gala evening properly
-- (organiser, 29 Oct 2026: the CXO Gala Networking Evening is part of the VIP
-- Pass only), pins the 5 Nov price deadline, and replaces the event description
-- that the signed-out hero used to read ("India's largest AI conference...
-- 60+ speakers, 100+ exhibitors"). Safe to run twice.
--
--   npx wrangler d1 execute bharatai-production --remote --file=./scripts/sql/announcements-2026-10-29.sql

UPDATE announcements
   SET title = 'CXO Gala Networking Evening, Day 1',
       content = 'The evening of 20 November: a cocktail evening for CXOs, senior leaders and ministers, where the next day''s meetings get set up. Part of the VIP Pass, and by invitation.',
       announcement_type = 'general'
 WHERE event_id = 1 AND id = 5 AND title LIKE 'Gala Networking Evening%';

INSERT INTO announcements (event_id, title, content, announcement_type, author_name, pinned)
SELECT 1,
       'Standard prices until 5 November',
       'Delegate Pass Rs 4,999 + GST, Premium Delegate Rs 9,999, VIP Rs 19,999, Academic Rs 999 until the end of 5 November. From 6 November: Rs 8,999, Rs 14,999, Rs 24,999 and Rs 3,999. Every paid pass has guaranteed entry on both days; a free Visitor Pass is admitted by time slot, confirmed by email.',
       'general', 'Bharat AI Innovation', 1
 WHERE NOT EXISTS (SELECT 1 FROM announcements WHERE event_id = 1 AND title = 'Standard prices until 5 November');

UPDATE events
   SET description = 'India''s B2B platform for AI: the organisations running AI in production, the companies providing it and the policymakers shaping it. Two days at WTC Mumbai with 40+ speakers, 48 exhibitors, 12 tracks and 23 Innovation Talks.'
 WHERE id = 1 AND description LIKE 'India''s largest AI conference%';
