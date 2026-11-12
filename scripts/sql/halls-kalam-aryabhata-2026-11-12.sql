-- Kalam Theatre and Aryabhata Theatre swapped (organiser, 12 Nov 2026).
--   Kalam Theatre     = Centrum Hall A (was Aryabhata Theatre)
--   Aryabhata Theatre = Expo Hall, the Innovation Talks (was Kalam Theatre)
-- Peacock Hall = Homi J. Bhabha Hall and Centrum Hall B = Raman Theatre are unchanged.
--
-- Moves every session in those two halls to its new hall name, each matched by its
-- title and both times (from scripts/sql/schedule.sql as regenerated on 12 Nov), so
-- every session keeps its id and the stars on attendees' phones keep matching.
-- Safe to run twice: a session already in its new hall is set to the same name.
-- 21 sessions go to Aryabhata Theatre (Expo Hall), 15 to Kalam Theatre (Centrum Hall A).
-- A session added in Admin since then is not in this list: check those by hand.
--
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/halls-kalam-aryabhata-2026-11-12.sql

UPDATE sessions SET room = 'Kalam Theatre' WHERE event_id = 1 AND title = 'Registration' AND start_time = '2026-11-20 08:30' AND end_time = '2026-11-20 09:30' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
UPDATE sessions SET room = 'Kalam Theatre' WHERE event_id = 1 AND title = 'Democratizing Healthcare with AI: Access, Affordability & Outcomes' AND start_time = '2026-11-20 11:30' AND end_time = '2026-11-20 12:30' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
UPDATE sessions SET room = 'Kalam Theatre' WHERE event_id = 1 AND title = 'From Copilots to an Organisation Brain: What We Learned Building Enterprise AI Agents' AND start_time = '2026-11-20 12:30' AND end_time = '2026-11-20 12:50' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
UPDATE sessions SET room = 'Kalam Theatre' WHERE event_id = 1 AND title = 'Innovation Talk: NoBroker' AND start_time = '2026-11-20 12:50' AND end_time = '2026-11-20 13:10' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
UPDATE sessions SET room = 'Kalam Theatre' WHERE event_id = 1 AND title = 'Networking Lunch' AND start_time = '2026-11-20 13:10' AND end_time = '2026-11-20 14:00' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
UPDATE sessions SET room = 'Kalam Theatre' WHERE event_id = 1 AND title = 'AI-Driven Growth Engines: Transforming Sales & Marketing' AND start_time = '2026-11-20 14:00' AND end_time = '2026-11-20 15:00' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
UPDATE sessions SET room = 'Kalam Theatre' WHERE event_id = 1 AND title = 'GeoAI Forest Encroachment Monitoring' AND start_time = '2026-11-20 15:00' AND end_time = '2026-11-20 15:20' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
UPDATE sessions SET room = 'Kalam Theatre' WHERE event_id = 1 AND title = 'Your Next Colleague Is an AI: Lessons from Delivering Technology Operations for Global Clients' AND start_time = '2026-11-20 15:20' AND end_time = '2026-11-20 15:40' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
UPDATE sessions SET room = 'Kalam Theatre' WHERE event_id = 1 AND title = 'Harnessing DEPA''s Interoperable, Secure, and Privacy-Preserving Architecture for Advancing AI in Health' AND start_time = '2026-11-20 15:40' AND end_time = '2026-11-20 16:00' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
UPDATE sessions SET room = 'Kalam Theatre' WHERE event_id = 1 AND title = 'Hi-Tea Break' AND start_time = '2026-11-20 16:00' AND end_time = '2026-11-20 16:15' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
UPDATE sessions SET room = 'Kalam Theatre' WHERE event_id = 1 AND title = 'AI for the Frontlines: Taking AI from Pilots to Population-Scale Public Infrastructure' AND start_time = '2026-11-21 10:00' AND end_time = '2026-11-21 10:20' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
UPDATE sessions SET room = 'Kalam Theatre' WHERE event_id = 1 AND title = 'Artificial Intelligence: From Molecules to Medicines' AND start_time = '2026-11-21 10:40' AND end_time = '2026-11-21 11:00' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
UPDATE sessions SET room = 'Kalam Theatre' WHERE event_id = 1 AND title = 'Transforming Indian Agriculture with AI: Doubling Farmer Income' AND start_time = '2026-11-21 11:00' AND end_time = '2026-11-21 12:00' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
UPDATE sessions SET room = 'Kalam Theatre' WHERE event_id = 1 AND title = 'Networking Lunch' AND start_time = '2026-11-21 13:00' AND end_time = '2026-11-21 14:00' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
UPDATE sessions SET room = 'Kalam Theatre' WHERE event_id = 1 AND title = 'Hi-Tea Break' AND start_time = '2026-11-21 16:00' AND end_time = '2026-11-21 16:20' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
UPDATE sessions SET room = 'Aryabhata Theatre' WHERE event_id = 1 AND title = 'Innovation Talk: Paisani Technology Services' AND start_time = '2026-11-20 11:30' AND end_time = '2026-11-20 11:38' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
UPDATE sessions SET room = 'Aryabhata Theatre' WHERE event_id = 1 AND title = 'Innovation Talk: RedFerns Tech' AND start_time = '2026-11-20 11:40' AND end_time = '2026-11-20 11:48' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
UPDATE sessions SET room = 'Aryabhata Theatre' WHERE event_id = 1 AND title = 'Innovation Talk: Xtant Tech' AND start_time = '2026-11-20 11:50' AND end_time = '2026-11-20 11:58' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
UPDATE sessions SET room = 'Aryabhata Theatre' WHERE event_id = 1 AND title = 'Innovation Talk: Oranje AI' AND start_time = '2026-11-20 12:00' AND end_time = '2026-11-20 12:08' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
UPDATE sessions SET room = 'Aryabhata Theatre' WHERE event_id = 1 AND title = 'Innovation Talk: Eurys Infosystems' AND start_time = '2026-11-20 12:10' AND end_time = '2026-11-20 12:18' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
UPDATE sessions SET room = 'Aryabhata Theatre' WHERE event_id = 1 AND title = 'Innovation Talk: Daten Technology Solutions' AND start_time = '2026-11-20 12:20' AND end_time = '2026-11-20 12:28' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
UPDATE sessions SET room = 'Aryabhata Theatre' WHERE event_id = 1 AND title = 'Innovation Talk: Origins AI' AND start_time = '2026-11-20 12:40' AND end_time = '2026-11-20 12:48' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
UPDATE sessions SET room = 'Aryabhata Theatre' WHERE event_id = 1 AND title = 'Innovation Talk: Kirusa' AND start_time = '2026-11-20 12:50' AND end_time = '2026-11-20 12:58' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
UPDATE sessions SET room = 'Aryabhata Theatre' WHERE event_id = 1 AND title = 'Innovation Talk: Phoebetal Technologies' AND start_time = '2026-11-20 13:10' AND end_time = '2026-11-20 13:18' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
UPDATE sessions SET room = 'Aryabhata Theatre' WHERE event_id = 1 AND title = 'Innovation Talk: Zanopy AI' AND start_time = '2026-11-20 14:00' AND end_time = '2026-11-20 14:08' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
UPDATE sessions SET room = 'Aryabhata Theatre' WHERE event_id = 1 AND title = 'Innovation Talk: Aria Telecom' AND start_time = '2026-11-20 14:10' AND end_time = '2026-11-20 14:18' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
UPDATE sessions SET room = 'Aryabhata Theatre' WHERE event_id = 1 AND title = 'Innovation Talk: Gupshup.ai' AND start_time = '2026-11-20 14:20' AND end_time = '2026-11-20 14:30' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
UPDATE sessions SET room = 'Aryabhata Theatre' WHERE event_id = 1 AND title = 'Innovation Talk: IIT Bombay' AND start_time = '2026-11-20 14:46' AND end_time = '2026-11-20 15:06' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
UPDATE sessions SET room = 'Aryabhata Theatre' WHERE event_id = 1 AND title = 'Innovation Talk: Joget' AND start_time = '2026-11-20 15:08' AND end_time = '2026-11-20 15:28' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
UPDATE sessions SET room = 'Aryabhata Theatre' WHERE event_id = 1 AND title = 'Innovation Talk: Intangles' AND start_time = '2026-11-20 15:30' AND end_time = '2026-11-20 15:50' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
UPDATE sessions SET room = 'Aryabhata Theatre' WHERE event_id = 1 AND title = 'Innovation Talk: Ministry of Tribal Affairs' AND start_time = '2026-11-20 15:52' AND end_time = '2026-11-20 16:12' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
UPDATE sessions SET room = 'Aryabhata Theatre' WHERE event_id = 1 AND title = 'Innovation Talk: LightMetrics' AND start_time = '2026-11-20 16:14' AND end_time = '2026-11-20 16:34' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
UPDATE sessions SET room = 'Aryabhata Theatre' WHERE event_id = 1 AND title = 'Innovation Talk: Image Infosystems' AND start_time = '2026-11-20 16:36' AND end_time = '2026-11-20 16:56' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
UPDATE sessions SET room = 'Aryabhata Theatre' WHERE event_id = 1 AND title = 'Innovation Talk: Dysosphere' AND start_time = '2026-11-20 17:20' AND end_time = '2026-11-20 17:30' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
UPDATE sessions SET room = 'Aryabhata Theatre' WHERE event_id = 1 AND title = 'Innovation Talk: AlgoAnalytics' AND start_time = '2026-11-20 17:44' AND end_time = '2026-11-20 17:54' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
UPDATE sessions SET room = 'Aryabhata Theatre' WHERE event_id = 1 AND title = 'Innovation Talk: Seem Fintech & Sustainability' AND start_time = '2026-11-20 17:56' AND end_time = '2026-11-20 18:06' AND room IN ('Kalam Theatre', 'Aryabhata Theatre');
