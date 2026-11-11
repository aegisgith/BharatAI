-- Two speakers have dropped out (organiser, 11 Nov 2026):
--   Saurabh Kumar Sahu, CEO, Accenture in India
--   Umar Ali Shaikh, CEO, Atos Solutions & Systems (he was also on the Agentic AI panel, Day 1 16:30)
-- This hides them from the app's Speakers list. The rows stay, so it can be undone by setting
-- is_published back to 1. They came off the home page, the conference page and the schedule in
-- the same commit. Run this BEFORE scripts/sql/speaker-delegate-passes.sql, which only gives
-- passes to published speakers. Safe to run again.
--
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/speakers-dropped-2026-11-11.sql

UPDATE speakers SET is_published = 0, updated_at = CURRENT_TIMESTAMP WHERE event_id = 1 AND slug IN ('saurabh-kumar-sahu', 'umar-ali-shaikh');
