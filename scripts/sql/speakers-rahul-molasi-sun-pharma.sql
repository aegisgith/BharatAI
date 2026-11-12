-- Rahul Molasi is at Sun Pharma, not Cipla (organiser, 12 Nov 2026, from the
-- "Speakers & Panelist" sheet). His speaker card in the app, and his name on the
-- Day 1 Sales & Marketing panel ("Rahul Molasi (Cipla), ..."), which the app's
-- Conference Schedule reads. Admin -> Conference rebuilds that line from the speaker's
-- organisation, so both are changed. Safe to run twice; touches no other row.
--
-- Before: role 'Associate Director, L&D', organisation 'Cipla Digital Learning Transformation'.
--
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/speakers-rahul-molasi-sun-pharma.sql

UPDATE speakers
   SET role = 'DGM L&OD; Head CoE, Digital, Managerial and Learning Analytics',
       organisation = 'Sun Pharma',
       updated_at = datetime('now')
 WHERE event_id = 1 AND slug = 'rahul-molasi';

UPDATE sessions
   SET speaker_name = REPLACE(speaker_name, 'Rahul Molasi (Cipla)', 'Rahul Molasi (Sun Pharma)')
 WHERE event_id = 1 AND speaker_name LIKE '%Rahul Molasi (Cipla)%';
