-- Rajiv Kumar (MD & Corporate Vice President, Microsoft) has dropped out (organiser, 30 Oct 2026).
-- This hides him from the app's Speakers list. The row stays, so it can be undone by setting
-- is_published back to 1. He came off the home page, the conference page and llms.txt in the
-- same commit. Safe to run again.
--
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/speakers-hide-rajiv-kumar.sql

UPDATE speakers SET is_published = 0, updated_at = CURRENT_TIMESTAMP WHERE event_id = 1 AND slug = 'rajiv-kumar';
