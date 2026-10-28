-- Dr. Ashish Tendulkar's Prototype to Production workshop is 90 minutes, not 60
-- (organiser, 28 Oct 2026). Corrects the summary 0049 seeded for the app's seat
-- picker. Safe to run again; if 0049 has not been run yet, run 0049 instead
-- (it now seeds the 90-minute text) and skip this.
--
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/workshop-fde-90-minutes.sql

UPDATE workshops
   SET summary = 'Live coding, 90 minutes: an enterprise AI workflow built live, tested against realistic cases, and taken through what production needs.'
 WHERE event_id = 1 AND slug = 'fde-workshop';
