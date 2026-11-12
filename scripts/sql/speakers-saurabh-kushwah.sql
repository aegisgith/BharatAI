-- Saurabh Kushwah, Co-Founder & Chief Product and Technology Officer, BULLET Microdrama, ZEEL
-- (organiser, 12 Nov 2026), on the Media panel "Content, Creativity & AI" (Day 2, 15:15,
-- Homi J. Bhabha Hall). The session already names him (schedule.sql), so Admin -> Conference
-- links him to it by name once this row exists. No link row is written here on purpose: a
-- session with any saved link shows only its saved links, which would drop the other two
-- panellists. His email and Speaker pass went in from a private file, not this one.
-- Adds nothing if a speaker with his slug or surname is already there, so it is safe to run again.
--
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/speakers-saurabh-kushwah.sql

INSERT INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order)
SELECT 1, 'saurabh-kushwah', 'Saurabh Kushwah', 'Co-Founder & Chief Product and Technology Officer',
       'BULLET Microdrama · ZEEL', 'AI in Media', '/images/speaker-saurabh-kushwah-sq.webp', 44
WHERE NOT EXISTS (SELECT 1 FROM speakers WHERE event_id = 1 AND (slug = 'saurabh-kushwah' OR lower(name) LIKE '%kushwah%'));
