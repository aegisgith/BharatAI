-- The Jade Global panel "Beyond Pilots: Turning Enterprise Investments into Measurable Business Value"
-- (20 Nov, 3:00 to 4:00 pm, Homi J. Bhabha Hall) gets its four panellists (organiser, 14 Nov 2026).
-- Speakers are added only if nobody of that slug or name is there yet. The panel's typed line and
-- description are set to match the website. Safe to run again. Their emails and mobiles go in from a
-- private file, not this one.
--
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/speakers-jade-global-panel.sql

INSERT INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order)
SELECT 1, 'arun-menon', 'Arun Menon', 'Chief Operating Officer and Chief Technology & Strategy Officer', 'Jade Global', 'Enterprise AI', '/images/speaker-arun-menon-sq.webp', 60
WHERE NOT EXISTS (SELECT 1 FROM speakers WHERE event_id = 1 AND (slug = 'arun-menon' OR lower(name) LIKE '%arun menon%'));

INSERT INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order)
SELECT 1, 'sushil-vishwakarma', 'Sushil Vishwakarma', 'Director, Integrated Technology & Innovation Leader', 'Whirlpool Corporation', 'Enterprise AI', '/images/speaker-sushil-vishwakarma-sq.webp', 61
WHERE NOT EXISTS (SELECT 1 FROM speakers WHERE event_id = 1 AND (slug = 'sushil-vishwakarma' OR lower(name) LIKE '%sushil vishwakarma%'));

INSERT INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order)
SELECT 1, 'amod-deshpande', 'Amod Deshpande', 'Head of India, Engineering & Operations', 'Allvue Systems', 'Enterprise AI', '/images/speaker-amod-deshpande-sq.webp', 62
WHERE NOT EXISTS (SELECT 1 FROM speakers WHERE event_id = 1 AND (slug = 'amod-deshpande' OR lower(name) LIKE '%amod deshpande%'));

INSERT INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order)
SELECT 1, 'ganesh-joshi', 'Ganesh Joshi', 'AVP – IT & Chief Information Officer', 'Nilons Enterprises Pvt. Ltd.', 'Enterprise AI', '/images/speaker-ganesh-joshi-sq.webp', 63
WHERE NOT EXISTS (SELECT 1 FROM speakers WHERE event_id = 1 AND (slug = 'ganesh-joshi' OR lower(name) LIKE '%ganesh joshi%'));

UPDATE sessions
SET speaker_name = 'Arun Menon (Jade Global), Sushil Vishwakarma (Whirlpool Corporation), Amod Deshpande (Allvue Systems), Ganesh Joshi (Nilons Enterprises)',
    description = 'Panel: Jade Global. Hosted by Jade Global.'
WHERE event_id = 1 AND title LIKE 'Beyond Pilots%';
