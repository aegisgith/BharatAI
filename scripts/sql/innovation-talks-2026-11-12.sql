-- 12 Nov 2026: two corrections to the app's Innovation Talks, from the booth sheet
-- "Bharat AI Exhibition booth 2026" (tab "Innovation Talk Speakers").
--
-- Run this BEFORE re-running scripts/sql/innovation-talks.sql: that file skips a speaker
-- only when the same name and company are already there, so without this it would add
-- these three a second time.
--
--   npx wrangler d1 execute bharatai-production --remote --file=./scripts/sql/innovation-talks-2026-11-12.sql
--
-- Safe to run twice: each line changes nothing once done.

-- Oli AI's two speakers by their full names (the website shows them since 12 Nov).
UPDATE innovation_talks SET speaker_name = 'Selva Soorya' WHERE event_id = 1 AND speaker_name = 'Selva' AND company = 'OliAI';
UPDATE innovation_talks SET speaker_name = 'Aravind Raj' WHERE event_id = 1 AND speaker_name = 'Aravind' AND company = 'OliAI';

-- Gaurav Jha is in the app twice: "Origin AI" (added 12 Oct) and "Origins AI" (28 Oct), the
-- same designation and photo, no topic. The talks list, the website and the agenda say
-- "Origins AI": the older copy goes, and where it is the only one it is renamed instead.
DELETE FROM innovation_talks WHERE event_id = 1 AND speaker_name = 'Gaurav Jha' AND company = 'Origin AI'
  AND EXISTS (SELECT 1 FROM innovation_talks k WHERE k.event_id = 1 AND k.speaker_name = 'Gaurav Jha' AND k.company = 'Origins AI');
UPDATE innovation_talks SET company = 'Origins AI' WHERE event_id = 1 AND speaker_name = 'Gaurav Jha' AND company = 'Origin AI';
