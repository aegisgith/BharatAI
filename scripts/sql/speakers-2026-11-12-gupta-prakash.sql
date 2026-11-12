-- Two speakers (organiser, 12 Nov 2026):
--   Ms. Surbhi Gupta, Chief Digital Officer, Birla Opus Paints. Her session is not on the programme yet
--     (the organiser's note names "AI for Bharat: Igniting and Empowering Dreams of 1.4 Billion Indians",
--     21 Nov 11:15 am to 12:15 pm, Peacock Hall; no such session exists yet). Add it in Admin -> Conference.
--   Pramod Prakash, Chief Technology Officer, Zee Entertainment Enterprises, on the Media panel
--     "Content, Creativity & AI" (21 Nov, 3:15 pm, Homi J. Bhabha Hall).
-- Each speaker is added only if nobody with that slug or surname-and-first-name is there yet. Pramod is added
-- to the panel's speaker line only if the line does not name him; and linked to it only where the panel
-- already has saved links (with none, Admin finds everyone by name; with some, it shows only the saved ones).
-- Safe to run again. Her contact email went in from a private file, not this one.
--
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/speakers-2026-11-12-gupta-prakash.sql

INSERT INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order)
SELECT 1, 'surbhi-gupta', 'Ms. Surbhi Gupta', 'Chief Digital Officer', 'Birla Opus Paints', 'AI for Bharat', '/images/speaker-surbhi-gupta-sq.webp', 45
WHERE NOT EXISTS (SELECT 1 FROM speakers WHERE event_id = 1 AND (slug = 'surbhi-gupta' OR lower(name) LIKE '%surbhi gupta%'));

INSERT INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, bio, sort_order)
SELECT 1, 'pramod-prakash', 'Pramod Prakash', 'Chief Technology Officer', 'Zee Entertainment Enterprises', 'AI in Media', '/images/speaker-pramod-prakash-sq.webp',
  'Pramod Prakash is the Chief Technology Officer at Zee Entertainment Enterprises Limited, where he oversees technology, platform scalability, infrastructure and streaming performance for the ZEE5 OTT platform, including high-traffic live events. With 22 years across technology, engineering, data analytics and product development, he has worked with InMobi, Yahoo and Oracle, and co-founded InstaLogist as Co-Founder & CEO.', 44
WHERE NOT EXISTS (SELECT 1 FROM speakers WHERE event_id = 1 AND (slug = 'pramod-prakash' OR lower(name) LIKE '%pramod prakash%'));

UPDATE sessions SET speaker_name = speaker_name || ', Pramod Prakash (Zee Entertainment Enterprises)'
WHERE event_id = 1 AND title LIKE 'Content, Creativity & AI%' AND COALESCE(speaker_name, '') <> '' AND speaker_name NOT LIKE '%Pramod Prakash%';

INSERT OR IGNORE INTO session_speakers (session_id, speaker_id, role, sort_order)
SELECT ses.id, sp.id, 'panellist', 9
FROM sessions ses, speakers sp
WHERE ses.event_id = 1 AND ses.title LIKE 'Content, Creativity & AI%' AND sp.event_id = 1 AND sp.slug = 'pramod-prakash'
  AND EXISTS (SELECT 1 FROM session_speakers x WHERE x.session_id = ses.id);
