-- Innovation Talks in the app, 11 Nov 2026: topics and titles from the organiser's
-- Confirmed Booth sheet (11 Nov) for speakers who are already in innovation_talks.
-- Run AFTER innovation-talks.sql, which adds the four new speakers with their topics.
-- A topic is only filled where the row has none, so nothing typed in /admin is overwritten.
-- Safe to run again.
--
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/innovation-talks-2026-11-11.sql

UPDATE innovation_talks SET speaker_title = 'Business Head, Insurance AI & Distribution Enablement Products' WHERE event_id = 1 AND speaker_name = 'Dhiman Bhattacharya' AND company = 'ValuEnable';
UPDATE innovation_talks SET speaker_title = 'Sales Manager' WHERE event_id = 1 AND speaker_name = 'Harshal Wakharkar' AND company = 'Intangles';
UPDATE innovation_talks SET topic = 'From Data to AI Value in 90 Days' WHERE event_id = 1 AND speaker_name = 'Ferosh Sethumadhavan' AND company = 'Evoke Technologies' AND COALESCE(topic, '') = '';
UPDATE innovation_talks SET speaker_title = 'Senior Director – Technology Practices' WHERE event_id = 1 AND speaker_name = 'Ferosh Sethumadhavan' AND company = 'Evoke Technologies';
UPDATE innovation_talks SET topic = 'The Shift: From Software Testing to Engineering Release Confidence' WHERE event_id = 1 AND speaker_name = 'Deepak Ramteke' AND company = 'Kadeep.ai' AND COALESCE(topic, '') = '';
UPDATE innovation_talks SET topic = 'AI in Cybersecurity' WHERE event_id = 1 AND speaker_name = 'Taher Pepermintwala' AND company = 'Envista Cyber Defence' AND COALESCE(topic, '') = '';
UPDATE innovation_talks SET topic = 'Sovereign AI in Action: Building Secure, Customizable and Full-Stack AI for Indian Enterprises' WHERE event_id = 1 AND speaker_name = 'Aditi Saini' AND company = 'Aria Telecom' AND COALESCE(topic, '') = '';
UPDATE innovation_talks SET topic = 'Building Intelligence Engine for Enterprises' WHERE event_id = 1 AND speaker_name = 'Selva' AND company = 'OliAI' AND COALESCE(topic, '') = '';
UPDATE innovation_talks SET topic = 'Building Intelligence Engine for Enterprises' WHERE event_id = 1 AND speaker_name = 'Aravind' AND company = 'OliAI' AND COALESCE(topic, '') = '';
UPDATE innovation_talks SET topic = 'AI Innovation & Asmadiya products' WHERE event_id = 1 AND speaker_name = 'Ashish Kumar Mishra' AND company = 'Asmadiya Technologies' AND COALESCE(topic, '') = '';
UPDATE innovation_talks SET topic = 'AI Innovation & Asmadiya products' WHERE event_id = 1 AND speaker_name = 'Shuvam Giri' AND company = 'Asmadiya Technologies' AND COALESCE(topic, '') = '';
UPDATE innovation_talks SET topic = 'The importance of becoming AI-native in today''s landscape' WHERE event_id = 1 AND speaker_name = 'Azharuddin Khan' AND company = 'Jade Global' AND COALESCE(topic, '') = '';
UPDATE innovation_talks SET topic = 'Personal Software: The Next Step After App Marketplaces' WHERE event_id = 1 AND speaker_name = 'Saumya Phor' AND company = 'Cloud Crane' AND COALESCE(topic, '') = '';
UPDATE innovation_talks SET topic = 'Personal Software: The Next Step After App Marketplaces' WHERE event_id = 1 AND speaker_name = 'Chirag Phor' AND company = 'Cloud Crane' AND COALESCE(topic, '') = '';
UPDATE innovation_talks SET topic = 'Embedded and automotive' WHERE event_id = 1 AND speaker_name = 'Dipak Zope' AND company = 'Paisani Technology Services' AND COALESCE(topic, '') = '';
UPDATE innovation_talks SET topic = 'Managing the environmental impact of AI' WHERE event_id = 1 AND speaker_name = 'Manoj Agarwal' AND company = 'Rightangle Technologies' AND COALESCE(topic, '') = '';
UPDATE innovation_talks SET topic = 'Moving From AI Pilots to AI-Native Enterprise: Reimagining Business Processes, Operating Models and Enterprise Growth with Agentic AI' WHERE event_id = 1 AND speaker_name = 'Mohit Kataria' AND company = 'Nu10 Technologies' AND COALESCE(topic, '') = '';
UPDATE innovation_talks SET topic = 'Judgement wins the Moment: Big AI, Focused AI and What India should build' WHERE event_id = 1 AND speaker_name = 'Senthil Kumar Hariram' AND company = 'FTA Global' AND COALESCE(topic, '') = '';
