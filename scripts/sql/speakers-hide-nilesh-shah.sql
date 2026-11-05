-- Nilesh Shah (Managing Director, Kotak Mahindra Asset Management Co. Ltd) is hidden, not deleted
-- (organiser, 5 Nov 2026). This hides him from the app's Speakers list. The row stays, so it can be
-- undone by setting is_published back to 1. He came off the home page, the conference page and
-- llms.txt in the same commit; scripts/data/hidden-speakers.md keeps those blocks word for word.
-- Safe to run again.
--
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/speakers-hide-nilesh-shah.sql

UPDATE speakers SET is_published = 0, updated_at = CURRENT_TIMESTAMP WHERE event_id = 1 AND slug = 'nilesh-shah';
