-- Organiser, 14 Nov 2026: Hon'ble Shri Devendra Fadnavis is not confirmed. The 20 Nov 09:35 inauguration
-- goes back to a chief guest to be announced, and his speaker row (if added) is hidden.
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/session-inauguration-chief-guest.sql
UPDATE sessions SET title = 'Inauguration and Chief Guest Keynote', speaker_name = '', speaker_title = NULL
WHERE event_id = 1 AND start_time = '2026-11-20 09:35' AND speaker_name LIKE '%Fadnavis%';
DELETE FROM session_speakers WHERE speaker_id IN (SELECT id FROM speakers WHERE event_id = 1 AND lower(name) LIKE '%fadnavis%');
UPDATE speakers SET is_published = 0 WHERE event_id = 1 AND lower(name) LIKE '%fadnavis%';
