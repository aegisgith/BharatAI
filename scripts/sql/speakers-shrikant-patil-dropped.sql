-- Dr. Shrikant Patil (CEO, Maharashtra State Innovation Society) has dropped out
-- (organiser, 12 Nov 2026). Hidden, not deleted, so either can be brought back:
--
-- 1. His speaker card: is_published = 0 (the app's speaker list shows published only).
-- 2. His Day 1 keynote, 11:30 - 11:40 in Homi J. Bhabha Hall: kept as a draft in
--    Admin -> Conference, which attendees do not see. To bring it back, open it in
--    Admin -> Conference and publish it.
--
-- Safe to run twice; touches no other row. Needs migration 0054 (session_admin),
-- applied 12 Nov 2026.
--
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/speakers-shrikant-patil-dropped.sql

UPDATE speakers
   SET is_published = 0,
       updated_at = datetime('now')
 WHERE event_id = 1 AND slug = 'shrikant-patil';

INSERT INTO session_admin (session_id, status, note, updated_at)
  SELECT id, 'draft', 'Dr. Shrikant Patil dropped out (organiser, 12 Nov 2026). Hidden, not deleted.', CURRENT_TIMESTAMP
    FROM sessions
   WHERE event_id = 1 AND speaker_name = 'Dr. Shrikant Patil' AND start_time = '2026-11-20 11:30'
  ON CONFLICT(session_id) DO UPDATE SET status = 'draft', note = excluded.note, updated_at = CURRENT_TIMESTAMP;
