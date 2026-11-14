-- Hon'ble Shri Eknath Shinde, Deputy Chief Minister of Maharashtra: special address, 21 Nov 2026,
-- 5:30 to 6:00 pm, Homi J. Bhabha Hall (Peacock Hall) (organiser, 14 Nov 2026). Adds the session once
-- and his speaker row once. Safe to run again.
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/speakers-eknath-shinde.sql
INSERT INTO sessions (event_id, title, description, speaker_name, speaker_title, speaker_avatar, session_type, track, room, start_time, end_time, capacity)
SELECT 1, 'Special Address', NULL, 'Hon’ble Shri Eknath Shinde', 'Deputy Chief Minister, Government of Maharashtra', '🎤', 'keynote', NULL, 'Homi J. Bhabha Hall', '2026-11-21 17:30', '2026-11-21 18:00', 1000
WHERE NOT EXISTS (SELECT 1 FROM sessions WHERE event_id = 1 AND speaker_name LIKE '%Eknath Shinde%');
INSERT INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order)
SELECT 1, 'eknath-shinde', 'Hon’ble Shri Eknath Shinde', 'Deputy Chief Minister', 'Government of Maharashtra', 'Special Address', '/images/eknath-shinde.webp', 59
WHERE NOT EXISTS (SELECT 1 FROM speakers WHERE event_id = 1 AND (slug = 'eknath-shinde' OR lower(name) LIKE '%eknath shinde%'));
