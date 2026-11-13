-- 13 Nov 2026: the organiser cancelled the Startup Pitch ("no startup pitch is happening").
-- Run once: npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/startup-pitch-off-2026-11-13.sql
--
-- The app's Startup Pitch tab and an investor's Deal flow list every active row of
-- startup_pitches (15 on 13 Nov, all active). Switched off, not deleted: the rows stay in
-- Admin -> Startup Pitch, where the tick turns any one back on.
UPDATE startup_pitches SET is_active = 0 WHERE event_id = 1 AND is_active = 1;
