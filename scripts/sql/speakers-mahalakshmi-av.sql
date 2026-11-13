-- Mahalakshmi AV, Head of Sales, West and South India, AWS (organiser, 13 Nov 2026), on the
-- Enterprise AI panel "Building the Enterprise AI Workforce: Talent, Delivery and the Rise of
-- Forward-Deployed Engineering" (21 Nov, 11:00 am to 12:00 pm, Homi J. Bhabha Hall (Peacock Hall);
-- session 138 in production on 13 Nov). Added only if nobody of that slug or name is there yet.
-- On the panel's typed line she goes before the moderator (or at the end when there is none),
-- only if the line does not name her; linked only where the panel already has saved links (it had
-- none on 13 Nov). Safe to run again. Her email and mobile go in from a private file, not this one.
--
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/speakers-mahalakshmi-av.sql

INSERT INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order)
SELECT 1, 'mahalakshmi-av', 'Mahalakshmi AV', 'Head of Sales, West and South India', 'AWS', 'Enterprise AI', '/images/speaker-mahalakshmi-av-sq.webp', 46
WHERE NOT EXISTS (SELECT 1 FROM speakers WHERE event_id = 1 AND (slug = 'mahalakshmi-av' OR lower(name) LIKE '%mahalakshmi%'));

UPDATE sessions SET speaker_name = REPLACE(speaker_name, ', Mr. Bhupesh Daheria (Moderator)', ', Mahalakshmi AV (AWS), Mr. Bhupesh Daheria (Moderator)')
WHERE event_id = 1 AND title LIKE 'Building the Enterprise AI Workforce%' AND speaker_name LIKE '%, Mr. Bhupesh Daheria (Moderator)%' AND speaker_name NOT LIKE '%Mahalakshmi%';

UPDATE sessions SET speaker_name = speaker_name || ', Mahalakshmi AV (AWS)'
WHERE event_id = 1 AND title LIKE 'Building the Enterprise AI Workforce%' AND COALESCE(speaker_name, '') <> '' AND speaker_name NOT LIKE '%Mahalakshmi%';

INSERT OR IGNORE INTO session_speakers (session_id, speaker_id, role, sort_order)
SELECT ses.id, sp.id, 'panellist', 9
FROM sessions ses, speakers sp
WHERE ses.event_id = 1 AND ses.title LIKE 'Building the Enterprise AI Workforce%' AND sp.event_id = 1 AND sp.slug = 'mahalakshmi-av'
  AND EXISTS (SELECT 1 FROM session_speakers x WHERE x.session_id = ses.id);
