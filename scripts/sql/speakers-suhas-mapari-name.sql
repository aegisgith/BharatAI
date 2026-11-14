-- Organiser, 14 Nov 2026: "Shri Suhas Mapari (IAS)" is shown as "Shri Suhas Mapari".
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/speakers-suhas-mapari-name.sql
UPDATE speakers SET name = 'Shri Suhas Mapari' WHERE event_id = 1 AND name = 'Shri Suhas Mapari (IAS)';
UPDATE sessions SET speaker_name = REPLACE(speaker_name, 'Shri Suhas Mapari (IAS)', 'Shri Suhas Mapari') WHERE event_id = 1 AND speaker_name LIKE '%Suhas Mapari (IAS)%';
