-- Migration 0033: the 2026 speaker line-up, moved out of the marketing HTML.
--
-- The 33 speakers existed only as <div class="speaker-card"> blocks in
-- public/conference.html. The app could not list them, the admin could not edit one,
-- and sessions.speaker_name is empty on all 85 rows while sessions.speaker_avatar
-- turned out to hold a session EMOJI rather than a photo - so nothing in the database
-- knew who was speaking. Same shape of problem as the booths.
--
-- email is deliberately nullable: the addresses are coming separately, and a speaker
-- with no address must still be listable. Photos are the real files already shipped
-- under public/images - every one verified present on disk before seeding.

CREATE TABLE IF NOT EXISTS speakers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL DEFAULT 1,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT,                      -- job title, e.g. 'Joint Secretary, MeitY'
  organisation TEXT,
  topic TEXT,                     -- the talk theme shown on the card
  photo_url TEXT,
  bio TEXT,
  email TEXT,                     -- supplied later; never required to list a speaker
  phone TEXT,
  linkedin_url TEXT,
  is_featured INTEGER NOT NULL DEFAULT 0,
  is_published INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_speakers_event_sort ON speakers(event_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_speakers_published ON speakers(event_id, is_published);

INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'aditi-tatkare', 'Hon’ble Smt. Aditi Tatkare', 'Minister, Women & Child Development', 'Government of Maharashtra', 'Keynote Address', '/images/aditi-tatkare.jpg', 1);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'sanjay-rathod', 'Hon’ble Shri Sanjay Rathod', 'Minister, Soil & Water Conservation', 'Government of Maharashtra', 'Keynote Address', '/images/sanjay-rathod.jpg', 2);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'abhijit-gangopadhyay', 'Dr. Abhijit Gangopadhyay', 'Dean', 'Aegis School of Data Science & AI; Former Dean, IIM & TISS', 'AI Education', '/images/speaker-abhijit-gangopadhyay.webp', 3);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'k-k-singh', 'Shri. K.K. Singh', 'Joint Secretary, MeitY', 'Ministry of Electronics & Information Technology, Govt of India', 'National AI Policy', '/images/speaker-kk-singh-v2.jpg', 4);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'praveen-pardeshi', 'Shri Praveen Pardeshi', 'CEO, MITRA | Chief Economic Advisor to CM Maharashtra', 'Maharashtra Institution for Transformation, Govt of Maharashtra', 'Maharashtra AI Strategy', '/images/speaker-praveen-pardeshi.webp', 5);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'shrikant-patil', 'Dr. Shrikant Patil', 'CEO', 'Maharashtra State Innovation Society (MSInS), Govt of Maharashtra', 'AI Governance', '/images/speaker-shrikant-patil.webp', 6);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'nilesh-shah', 'Nilesh Shah', 'Managing Director', 'Kotak Mahindra Asset Management Co. Ltd', 'AI in Asset Management', '/images/speaker-nilesh-shah-kotak.avif', 7);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'saurabh-kumar-sahu', 'Saurabh Kumar Sahu', 'CEO', 'Accenture in India', 'Enterprise AI', '/images/speaker-saurabh-kumar-sahu.jpg', 8);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'umar-ali-shaikh', 'Umar Ali Shaikh', 'CEO', 'Atos Solutions & Systems', 'Digital Transformation', '/images/speaker-umar-ali-shaikh.jpg', 9);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'bhupesh-daheria', 'Bhupesh Daheria', 'CEO, Aegis School of Data Science & AI', 'Trustee, Aegis Knowledge Trust', 'AI Talent', '/images/speaker-bhupesh-daheria.jpg', 10);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'shailesh-dhuri', 'Shailesh Dhuri', 'Chief Executive Officer', 'Decimal Point Analytics', 'AI in Finance', '/images/speaker-shailesh-dhuri-final.webp', 11);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'rajesh-dhuddu-phd', 'Rajesh Dhuddu (PhD)', 'Partner & Emerging Tech Leader', 'Leadership Team @ iDAC, PwC', 'Responsible AI', '/images/speaker-rajesh-dhuddu.jpg', 12);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'ashish-tendulkar', 'Dr. Ashish Tendulkar', 'Lead AI', 'Google', 'AI Research', '/images/speaker-ashish-tendulkar-final.jpg', 13);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'mukesh-jain', 'Mukesh Jain', 'Global EVP & CTO', 'Capgemini', 'AI at Scale', '/images/speaker-mukesh-jain-capgemini.webp', 14);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'manish-agrawal', 'Manish Agrawal', 'President & Chief Operating Officer', 'Comviva', 'AI in Telecom', '/images/speaker-manish-agarwal-comviva.webp', 15);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'rinoo-rajesh', 'Rinoo Rajesh', 'President of PMI Pune', NULL, 'AI Project Management', '/images/speaker-rinoo-rajesh.webp', 16);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'ramanarayana-parhi', 'Ramanarayana Parhi', 'VP & CIO', 'Alkem Laboratories', 'AI in Pharma', '/images/speaker-ramanarayana-parhi-alkem.webp', 17);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'ratan-kumar-kesh', 'Ratan Kumar Kesh', 'Executive Director & COO', 'Bandhan Bank', 'AI in Banking', '/images/speaker-ratan-kumar-kesh-bandhan.webp', 18);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'sandeep-kumar', 'Sandeep Kumar', 'CIO', 'Go Digit Insurance', 'AI in Insurance', '/images/speaker-sandeep-kumar-godigit.webp', 19);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'parag-dabhade', 'Parag Dabhade', 'Chief Technology Officer', 'AI & Agritech Innovation Center, Govt of Maharashtra', 'AgriTech AI', '/images/speaker-parag-dabhade.jpg', 20);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'joy-chakraborty', 'Joy Chakraborty', 'Deputy Chief Executive Officer', 'P. D. Hinduja National Hospital & Medical Research Centre', 'Healthcare AI', '/images/speaker-joy-chakraborty.jpg', 21);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'rahul-molasi', 'Rahul Molasi', 'Associate Director, L&D', 'Cipla Digital Learning Transformation', 'AI in Pharma', '/images/speaker-rahul-molasi.jpg', 22);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'abdul-hai-mattoo', 'Abdul Hai Mattoo', 'CVP & Head of Training', 'Axis Max Life Insurance', 'AI in Insurance', '/images/speaker-abdul-hai-mattoo.jpg', 23);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'rajul-gajjar', 'Dr. Rajul Gajjar', 'Vice Chancellor', 'Gujarat Technological University', 'AI in Education', '/images/speaker-rajul-gajjar.webp', 24);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'soly-thomas', 'Soly Thomas', 'Deputy CEO & Chief Digital Officer', 'Canara HSBC Life Insurance', 'AI in Banking', '/images/speaker-soly-thomas.webp', 25);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'tarun-chugh', 'Tarun Chugh', 'MD & CEO', 'Bajaj Life Insurance Company', 'AI in Insurance', '/images/speaker-tarun-chugh.webp', 26);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'jagbir-singh', 'Jagbir Singh', 'Chief Technology & Information Officer', 'Vodafone Idea Limited', 'AI in Telecom', '/images/speaker-jagbir-singh.webp', 27);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'akhil-gupta', 'Akhil Gupta', 'Founder', 'NoBroker.com', 'AI in PropTech', '/images/speaker-akhil-gupta.webp', 28);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'rajiv-kumar', 'Rajiv Kumar', 'MD & Corporate Vice President', 'Microsoft', 'Enterprise AI', '/images/speaker-rajiv-kumar.webp', 29);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'dheeraj-sinha', 'Dheeraj Sinha', 'EVP & Global Chief Information Officer', 'Sun Pharma', 'AI in Pharma', '/images/speaker-dheeraj-sinha.webp', 30);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'rajkumar-upadhyay', 'Dr. Rajkumar Upadhyay', 'CEO & Chairman', 'CDOT Board', 'AI in Telecom', '/images/speaker-rajkumar-upadhyay.webp', 31);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'abhay-sharma', 'Abhay Sharma', 'Partner & Practice Leader', 'IBM', 'Enterprise AI', '/images/speaker-abhay-sharma.webp', 32);
INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order) VALUES (1, 'pravin-kumar', 'Pravin Kumar', 'Chief Market Information Security Officer & Data Protection Officer', 'National Payments Corporation of India (NPCI)', 'AI Governance', '/images/speaker-pravin-kumar.jpg', 33);
