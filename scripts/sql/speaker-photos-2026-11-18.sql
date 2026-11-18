-- Photos for the four listed speakers who had none (18 Nov 2026).
-- Rohini Ramnathan, Ashwani Kumar and Fal Ghancha: headshots found on public pages
-- that name them with their company; Dr. Omprakash Mandge: the site already had his
-- photo, the app row did not point at it. Files: public/images/speaker-<slug>-sq.webp.
-- Fills an empty photo only, so a photo chosen in Admin is never replaced.
-- Safe to run twice.
UPDATE speakers SET photo_url = '/images/speaker-rohini-ramnathan-sq.webp' WHERE event_id = 1 AND slug = 'rohini-ramnathan' AND COALESCE(photo_url, '') = '';
UPDATE speakers SET photo_url = '/images/speaker-ashwani-kumar-sq.webp' WHERE event_id = 1 AND slug = 'ashwani-kumar' AND COALESCE(photo_url, '') = '';
UPDATE speakers SET photo_url = '/images/speaker-fal-ghancha-sq.webp' WHERE event_id = 1 AND slug = 'fal-ghancha' AND COALESCE(photo_url, '') = '';
UPDATE speakers SET photo_url = '/images/speaker-omprakash-mandge-sq.webp' WHERE event_id = 1 AND slug = 'omprakash-mandge' AND COALESCE(photo_url, '') = '';
