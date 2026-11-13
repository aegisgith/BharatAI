-- Organiser, 13 Nov 2026, from the agenda sheet: three panels' speakers, five new speakers.
-- On 13 Nov production had no saved session_speakers links for these sessions (130, 138, 140),
-- so Admin finds everyone by name from the typed line. Chirag Paswan was in no app row.
-- Safe to run again.
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/speakers-2026-11-13-agenda-sheet.sql

INSERT INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order)
SELECT 1, 'raveesh-dewan', 'Raveesh Dewan', 'President & CEO', 'Joget Inc.', 'GenAI & Agentic AI', '/images/talks/raveesh-dewan.webp', 47
WHERE NOT EXISTS (SELECT 1 FROM speakers WHERE event_id = 1 AND (slug = 'raveesh-dewan' OR lower(name) LIKE '%raveesh dewan%'));
INSERT INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order)
SELECT 1, 'ashwani-kumar', 'Ashwani Kumar', 'Senior Director of Engineering, AI Platform', 'Nielsen', 'Enterprise AI', '', 48
WHERE NOT EXISTS (SELECT 1 FROM speakers WHERE event_id = 1 AND (slug = 'ashwani-kumar' OR lower(name) LIKE '%ashwani kumar%'));
INSERT INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order)
SELECT 1, 'abhay-tewari', 'Abhay Tewari', 'MD & CEO', 'Star Union Dai-ichi Life Insurance', 'AI in Insurance', '/images/speaker-abhay-tewari-sq.webp', 49
WHERE NOT EXISTS (SELECT 1 FROM speakers WHERE event_id = 1 AND (slug = 'abhay-tewari' OR lower(name) LIKE '%abhay tewari%' OR lower(name) LIKE '%abhay tiwari%'));
INSERT INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order)
SELECT 1, 'shallu-kaushik', 'Shallu Kaushik', 'Chief Digital Officer', 'Tata Capital', 'AI in Insurance', '/images/speaker-shallu-kaushik-sq.webp', 50
WHERE NOT EXISTS (SELECT 1 FROM speakers WHERE event_id = 1 AND (slug = 'shallu-kaushik' OR lower(name) LIKE '%shallu kaushik%'));
INSERT INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order)
SELECT 1, 'pawan-chawla', 'Dr. Pawan Chawla', 'Senior VP & CISO', 'Tata AIA Life Insurance', 'AI in Insurance', '/images/speaker-pawan-chawla-sq.webp', 51
WHERE NOT EXISTS (SELECT 1 FROM speakers WHERE event_id = 1 AND (slug = 'pawan-chawla' OR lower(name) LIKE '%pawan chawla%'));

UPDATE sessions SET speaker_name = 'Ms. Surbhi Gupta (Birla Opus Paints), Abhay Sharma (IBM), Akhil Gupta (NoBroker), Raveesh Dewan (Joget Inc.), Mukesh Jain (Moderator)'
WHERE event_id = 1 AND title LIKE 'The Rise of Autonomous Enterprises%';
UPDATE sessions SET speaker_name = 'Dr. Ashish Tendulkar (Google), Sudhir Kumar Rai (Trellix), Ashwani Kumar (Nielsen), Mahalakshmi AV (AWS), Mr. Bhupesh Daheria (Moderator)'
WHERE event_id = 1 AND title LIKE 'Building the Enterprise AI Workforce%';
UPDATE sessions SET speaker_name = 'Sandeep Kumar (Go Digit Insurance), Abhay Tewari (Star Union Dai-ichi Life Insurance), Shallu Kaushik (Tata Capital), Dr. Pawan Chawla (Tata AIA Life Insurance)'
WHERE event_id = 1 AND title LIKE 'Reinventing Insurance for Bharat%';

UPDATE speakers SET is_published = 0 WHERE event_id = 1 AND lower(name) LIKE '%chirag paswan%';
