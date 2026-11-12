-- 13 Nov 2026: the organiser dropped three speakers. Take them off the app as well.
-- Run once: npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/speakers-dropped-2026-11-13.sql
--
-- Speakers: hidden, the row is kept (the same as "Hide" in Admin -> Conference -> Speakers).
-- Production ids on 13 Nov: 31 rajkumar-upadhyay, 82 k-mahesh, 85 prajakta-verma.
UPDATE speakers SET is_published = 0
WHERE event_id = 1 AND slug IN ('rajkumar-upadhyay', 'k-mahesh', 'prajakta-verma');

-- Dr. K. Mahesh's Innovation Talk (production id 44, Delhi Government, no topic yet).
-- The app's Innovation Talks tab lists every row it is given, including a 'cancelled'
-- one, so the row goes, as "Delete" in Admin -> Innovation Talks does.
DELETE FROM innovation_talks
WHERE event_id = 1 AND speaker_name = 'Dr. K. Mahesh' AND company = 'Delhi Government';

-- No conference session names any of the three (checked 13 Nov), so sessions are untouched.
