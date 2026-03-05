-- Seed Event
INSERT OR IGNORE INTO events (id, title, description, event_type, venue, start_date, end_date, status, max_attendees) VALUES
(1, 'Bharat AI Innovation 2026', 'India''s largest AI conference and exhibition bringing together 60+ speakers, 100+ exhibitors, and thousands of AI professionals. Two days of intensive learning, networking, and collaboration across 10+ focused tracks covering Generative AI, Healthcare AI, FinTech AI, Manufacturing AI, AgriTech, and more.', 'conference', 'World Trade Center, Mumbai', '2026-06-02', '2026-06-03', 'upcoming', 5000);

-- Seed Sessions (Bharat AI Innovation 2026 - Day 1: 2 June 2026, WTC Mumbai)
INSERT OR IGNORE INTO sessions (id, event_id, title, description, speaker_name, speaker_title, speaker_avatar, session_type, track, room, start_time, end_time, capacity) VALUES
-- Day 1 Sessions
(1, 1, 'Registration & Welcome Coffee', 'Check-in, badge collection, networking breakfast at the WTC Mumbai lobby.', NULL, NULL, '☕', 'break', NULL, 'Lobby & Registration Desk', '2026-06-02 08:00', '2026-06-02 09:00', 5000),
(2, 1, 'Opening Ceremony & Inaugural Keynote', 'Grand inauguration of Bharat AI Innovation 2026 with keynote address by Honble Shri Chirag Paswan, Union Minister of Food Processing Industries, Government of India.', 'Shri Chirag Paswan', 'Union Minister, Govt of India', '🇮🇳', 'keynote', 'Main Stage', 'Main Auditorium', '2026-06-02 09:00', '2026-06-02 10:00', 2000),
(3, 1, 'India''s AI Superpower Journey', 'How India is charting a unique AI path — keynote by global AI leaders on India''s 20,000 crore R&D commitment and the Viksit Bharat vision.', NULL, NULL, '🌟', 'keynote', 'Main Stage', 'Main Auditorium', '2026-06-02 10:00', '2026-06-02 11:00', 2000),
(4, 1, 'Networking Tea Break', 'Exhibition Hall open — explore exhibitor booths across 8 industry zones.', NULL, NULL, '🍵', 'break', NULL, 'Exhibition Hall', '2026-06-02 11:00', '2026-06-02 11:30', 5000),
(5, 1, 'Generative AI — Redefining the Possible', 'Panel discussion: CEOs of India''s leading AI companies debate GenAI''s impact across sectors. Covering LLMs, multimodal AI, ChatGPT, and creative applications.', NULL, NULL, '🤖', 'panel', 'Generative AI & LLMs', 'Main Auditorium', '2026-06-02 11:30', '2026-06-02 13:00', 1000),
(6, 1, 'Lunch Break & Exhibition Tour', 'Networking lunch, exhibition floor open for hosted meetings and live AI demos.', NULL, NULL, '🍽️', 'break', NULL, 'Dining Hall & Exhibition', '2026-06-02 13:00', '2026-06-02 14:00', 5000),
(7, 1, 'Healthcare & Life Sciences AI', 'Medical diagnosis, drug discovery, telemedicine, mental health AI, and clinical workflows — presentations and demos.', NULL, NULL, '🏥', 'talk', 'Healthcare & Life Sciences AI', 'Conference Hall A', '2026-06-02 14:00', '2026-06-02 15:30', 500),
(8, 1, 'FinTech & BFSI AI', 'Digital payments, fraud detection, algorithmic trading, credit scoring, and insurance AI — trends and case studies.', NULL, NULL, '💰', 'talk', 'FinTech & BFSI AI', 'Conference Hall B', '2026-06-02 14:00', '2026-06-02 15:30', 500),
(9, 1, 'Agricultural AI', 'Precision farming, crop prediction, soil analytics, supply chain, and rural development through AI.', NULL, NULL, '🌾', 'talk', 'Agricultural AI', 'Conference Hall C', '2026-06-02 14:00', '2026-06-02 15:30', 300),
(10, 1, 'Manufacturing & Industry 4.0', 'Predictive maintenance, quality control, robotic automation, and smart factory systems.', NULL, NULL, '🏭', 'talk', 'Manufacturing & Industry 4.0', 'Conference Hall D', '2026-06-02 14:00', '2026-06-02 15:30', 300),
(11, 1, 'AI Exhibition & Innovation Stage', 'Live AI demonstrations, product launches, and startup showcases across 8 industry zones. Innovation Stage: 8-min spotlight pitches.', NULL, NULL, '💡', 'exhibition', 'Exhibition', 'Exhibition Hall', '2026-06-02 10:00', '2026-06-02 18:00', 5000),
(12, 1, 'Hands-On AI Workshops', 'Prompt Engineering, Fine-tuning LLMs, Responsible AI, Computer Vision — hands-on sessions by industry experts.', NULL, NULL, '🔬', 'workshop', 'Training Workshop', 'Workshop Hall', '2026-06-02 15:30', '2026-06-02 17:00', 300),
(13, 1, 'AI for Governance & Smart Cities', 'Digital India, smart city platforms, e-governance, and public sector AI transformation.', NULL, NULL, '🏛️', 'talk', 'AI for Governance', 'Conference Hall A', '2026-06-02 15:30', '2026-06-02 17:00', 500),
(14, 1, 'Gala Networking Evening', 'Industry mixer, startup pitch showcase, live AI demos, and networking with India''s brightest AI minds.', NULL, NULL, '🎉', 'networking', 'Networking', 'Banquet Hall', '2026-06-02 18:30', '2026-06-02 21:00', 2000),

-- Day 2 Sessions
(15, 1, 'Day 2 Opening Keynote', 'The Future of Work in an AI World — Global Perspectives on AI Talent, automation, and the evolving job landscape.', NULL, NULL, '🎤', 'keynote', 'Main Stage', 'Main Auditorium', '2026-06-03 09:00', '2026-06-03 10:00', 2000),
(16, 1, 'AI Policy & Governance Roundtable', 'Senior Government Officials, regulators, and industry leaders debate AI policy frameworks, regulation, and India''s AI strategy.', 'Shri K.K. Singh', 'Joint Secretary, MeitY', '🏛️', 'panel', 'AI for Governance', 'Main Auditorium', '2026-06-03 10:00', '2026-06-03 11:30', 1000),
(17, 1, 'Networking Break', 'Exhibition Hall, Startup Zone, and Investor Meetings open.', NULL, NULL, '🤝', 'break', NULL, 'Exhibition Hall', '2026-06-03 11:30', '2026-06-03 12:00', 5000),
(18, 1, 'Research Paper Presentations', 'Peer-reviewed research from IITs, IISc, NITs and global institutions showcasing breakthrough AI research.', NULL, NULL, '📄', 'talk', 'Research', 'Conference Hall A', '2026-06-03 12:00', '2026-06-03 14:00', 500),
(19, 1, 'Lunch & Startup Pitches', 'Top 20 AI startups pitch to a panel of leading investors. Networking lunch with exhibition access.', NULL, NULL, '🎯', 'panel', 'Startups', 'Dining Hall & Innovation Stage', '2026-06-03 14:00', '2026-06-03 15:00', 1000),
(20, 1, 'AI Ethics & Responsible AI', 'Bias mitigation, explainability, privacy-preserving AI, and regulatory frameworks.', NULL, NULL, '⚖️', 'talk', 'AI Ethics & Responsible AI', 'Conference Hall B', '2026-06-03 15:00', '2026-06-03 16:30', 500),
(21, 1, 'AI in Education', 'Personalized learning, intelligent tutoring, assessment AI, and EdTech innovation.', NULL, NULL, '🎓', 'talk', 'AI in Education', 'Conference Hall C', '2026-06-03 15:00', '2026-06-03 16:30', 300),
(22, 1, 'Mobility & Smart Transport AI', 'Autonomous vehicles, traffic management, logistics AI, and connected infrastructure.', NULL, NULL, '🚗', 'talk', 'Mobility & Smart Transport', 'Conference Hall D', '2026-06-03 15:00', '2026-06-03 16:30', 300),
(23, 1, 'GenAI & Agentic AI Workshop', 'Hands-on: GenAI development, Agentic AI, VibeCoding, AI Product Development, Chatbot Development, LLM Model Fine-Tuning.', NULL, NULL, '🧠', 'workshop', 'Training Workshop', 'Workshop Hall', '2026-06-03 15:00', '2026-06-03 17:00', 300),
(24, 1, 'Closing Keynote & Valedictory', 'Future roadmap, announcements, and key commitments from industry and government for India''s AI journey.', NULL, NULL, '🎤', 'keynote', 'Main Stage', 'Main Auditorium', '2026-06-03 17:00', '2026-06-03 18:30', 2000),
(25, 1, 'Bharat AI Innovation Gala Dinner', 'Networking gala dinner with special recognition for AI excellence, awards, and celebration.', NULL, NULL, '🥂', 'networking', 'Networking', 'Banquet Hall', '2026-06-03 19:00', '2026-06-03 22:00', 2000);

-- No seed attendees - real attendees are added via admin bulk upload or registration

-- Seed Exhibitors
-- Exhibitors are created dynamically when attendees with exhibitor badges are added
-- No dummy exhibitors needed in seed data

-- Seed Award Categories (Bharat AI Innovation 2026 - AI Innovation Awards)
INSERT OR IGNORE INTO award_categories (id, event_id, name, description, icon, voting_open) VALUES
(1, 1, 'Best AI Startup', 'Recognizing the most innovative AI startup making significant impact', '🚀', 0),
(2, 1, 'AI Innovation in Healthcare', 'Honoring breakthrough AI applications in healthcare and life sciences', '🏥', 0),
(3, 1, 'AI Innovation in FinTech', 'Celebrating transformative AI solutions in financial services', '💳', 0),
(4, 1, 'AI Innovation in Agriculture', 'Recognizing AI-driven innovations transforming Indian agriculture', '🌾', 0),
(5, 1, 'AI Innovation in Manufacturing', 'Honoring Industry 4.0 and smart manufacturing AI solutions', '🏭', 0),
(6, 1, 'AI Innovation in Education', 'Celebrating AI-powered learning and EdTech innovations', '🎓', 0),
(7, 1, 'AI for Social Good', 'Recognizing AI solutions addressing societal challenges', '🤝', 0),
(8, 1, 'Best Generative AI Solution', 'Honoring outstanding GenAI applications and products', '🤖', 0),
(9, 1, 'AI Innovation in Governance', 'Celebrating AI solutions for public sector and smart cities', '🏛️', 0),
(10, 1, 'AI Innovation in Cybersecurity', 'Recognizing AI-driven cybersecurity innovations', '🔐', 0),
(11, 1, 'AI Research Excellence', 'Honoring outstanding AI research contributions', '🔬', 0),
(12, 1, 'Best Enterprise AI Solution', 'Celebrating enterprise-grade AI deployments', '🏢', 0),
(13, 1, 'AI Innovation in Mobility', 'Recognizing AI innovations in transport and autonomous systems', '🚗', 0),
(14, 1, 'Best AI Ethics Initiative', 'Honoring responsible AI practices and initiatives', '⚖️', 0),
(15, 1, 'AI Innovation in Climate & Sustainability', 'Celebrating AI solutions for climate action and sustainability', '🌍', 0);

-- No seed nominees - nominations managed via admin panel

-- No seed connections, messages, or meetings - created by real attendees

-- Seed Announcements
INSERT OR IGNORE INTO announcements (event_id, title, content, announcement_type, author_name, pinned) VALUES
(1, 'Welcome to Bharat AI Innovation 2026!', 'We are thrilled to welcome you to India''s largest AI conference and exhibition at World Trade Center, Mumbai on 2-3 June 2026! Update your profile, explore the 2-day schedule with 10+ tracks, and prepare for an incredible experience. See you in Mumbai!', 'general', 'Bharat AI Innovation Team', 1),
(1, 'Call for Speakers Open', 'Share your AI expertise, research, or innovation story with India''s top decision-makers. Submit your speaker proposal now at bharataiinnovation.com/contact', 'urgent', 'Conference Committee', 1),
(1, 'AI Exhibition & Innovation Stage', 'The exhibition spanning 8 industry zones will be open both days. Book your booth and Innovation Stage speaking slot at bharataiinnovation.com/exhibition', 'general', 'Exhibition Team', 0),
(1, 'Hands-On AI Training Workshops', 'Register for hands-on workshops on GenAI, Agentic AI, VibeCoding, AI Product Development, Chatbot Development, and LLM Fine-Tuning. Limited seats available!', 'general', 'Training Team', 0),
(1, 'Gala Networking Evening - Day 1', 'Don''t miss the Gala Networking Evening on Day 1 (2 June) from 6:30 PM featuring industry mixer, startup pitches, and live AI demos. A great opportunity to connect with investors and industry leaders!', 'general', 'Bharat AI Innovation Team', 0);
