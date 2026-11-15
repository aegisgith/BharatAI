-- The IBM workshop's topic and facilitator (organiser, 15 Nov 2026, from IBM's
-- "Workshop Info" and "IBM Bob Installation & Registration Guide" PDFs):
-- "AI, Trust and Evolving Skills using IBM Bob", led by KrishnaKanth Naik,
-- Program Manager, IBM Career Education. Fri 20 Nov, 11:30-13:00, Raman Theatre.
--
-- 1. The bookable workshop (app seat picker). The insert only runs if the 13 Nov
--    ibm-workshop row was never added; the update then names it either way.
-- 2. The programme session (app Conference Schedule), matched by its old title,
--    so a session edited in Admin -> Conference keeps its id and stars.
-- 3. The facilitator in the app's speakers list.
--
-- Safe to run twice.
--
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/workshop-ibm-2026-11-15.sql

INSERT INTO workshops (event_id, slug, title, speaker, summary, starts_at, ends_at, room, capacity, is_open, sort_order)
SELECT 1, 'ibm-workshop', 'AI, Trust and Evolving Skills using IBM Bob', 'KrishnaKanth Naik, Program Manager, IBM Career Education', '', '2026-11-20 11:30', '2026-11-20 13:00', 'Raman Theatre', 100, 1, 0
WHERE NOT EXISTS (SELECT 1 FROM workshops WHERE event_id = 1 AND slug = 'ibm-workshop');

UPDATE workshops SET
  title = 'AI, Trust and Evolving Skills using IBM Bob',
  speaker = 'KrishnaKanth Naik, Program Manager, IBM Career Education',
  summary = 'Hands-on, 90 minutes: check the security of the Skills your AI coding agent uses. Learn IBM Bob, build a Skill from a GitHub repository, scan it with Caterpillar, and compare Bob''s answers before and after. Bring a laptop with IBM Bob installed and signed in.',
  starts_at = '2026-11-20 11:30', ends_at = '2026-11-20 13:00', room = 'Raman Theatre'
WHERE event_id = 1 AND slug = 'ibm-workshop';

UPDATE sessions SET
  title = 'AI, Trust and Evolving Skills using IBM Bob',
  description = NULL,
  speaker_name = 'KrishnaKanth Naik',
  speaker_title = 'Program Manager, IBM Career Education'
WHERE event_id = 1 AND session_type = 'workshop' AND title = 'Workshop by IBM';

INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, is_featured, is_published, sort_order)
SELECT 1, 'krishnakanth-naik', 'KrishnaKanth Naik', 'Program Manager', 'IBM Career Education', 'IBM Bob Workshop', '/images/speaker-krishnakanth-naik.webp', 0, 1,
  COALESCE((SELECT MAX(sort_order) FROM speakers WHERE event_id = 1), 0) + 1;
