-- 13 Nov 2026, organiser: Ashutosh Agrawal, Group CEO, Globe Teleservices, is a listed speaker as well
-- as a panellist on "AI in Telecom" (21 Nov, 10:00, Homi J. Bhabha Hall). He already holds a Speaker
-- badge (attendee 3603). Photo: his VIP pass photo. The agenda spelt him "Agarwal"; his own record says
-- Agrawal. Safe to run again.
--
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/speaker-ashutosh-agrawal-2026-11-13.sql

INSERT INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order)
SELECT 1, 'ashutosh-agrawal', 'Ashutosh Agrawal', 'Group CEO', 'Globe Teleservices', 'AI in Telecom', '/images/speaker-ashutosh-agrawal-sq.webp', 46
WHERE NOT EXISTS (SELECT 1 FROM speakers WHERE event_id = 1 AND (slug = 'ashutosh-agrawal' OR lower(name) LIKE '%ashutosh agarwal%' OR lower(name) LIKE '%ashutosh agrawal%'));

UPDATE sessions SET speaker_name = replace(speaker_name, 'Ashutosh Agarwal', 'Ashutosh Agrawal')
WHERE event_id = 1 AND title LIKE 'AI in Telecom%' AND speaker_name LIKE '%Ashutosh Agarwal%';

INSERT OR IGNORE INTO session_speakers (session_id, speaker_id, role, sort_order)
SELECT ses.id, sp.id, 'panellist', 9
FROM sessions ses, speakers sp
WHERE ses.event_id = 1 AND ses.title LIKE 'AI in Telecom%' AND sp.event_id = 1 AND sp.slug = 'ashutosh-agrawal'
  AND EXISTS (SELECT 1 FROM session_speakers x WHERE x.session_id = ses.id);
