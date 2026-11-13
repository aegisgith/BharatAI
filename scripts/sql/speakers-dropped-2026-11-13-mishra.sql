-- Shri Vinamra Mishra, Joint Secretary, Ministry of MSME, dropped out (organiser,
-- 13 Nov 2026: medical emergency). Hide him in the app and take him off the 20 Nov
-- "AI for Viksit Bharat" panel's typed line (session 124 in production). No saved
-- session_speakers links existed for him on 13 Nov; the DELETE is for safety.
-- Run: npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/speakers-dropped-2026-11-13-mishra.sql
-- Undo: UPDATE speakers SET is_published = 1 WHERE event_id = 1 AND slug = 'vinamra-mishra';
UPDATE speakers SET is_published = 0 WHERE event_id = 1 AND slug = 'vinamra-mishra';
UPDATE sessions SET speaker_name = REPLACE(speaker_name, 'Shri Vinamra Mishra (Ministry of MSME), ', '')
  WHERE event_id = 1 AND speaker_name LIKE '%Shri Vinamra Mishra (Ministry of MSME), %';
DELETE FROM session_speakers WHERE speaker_id IN (SELECT id FROM speakers WHERE event_id = 1 AND slug = 'vinamra-mishra');
