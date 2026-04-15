-- Migration 0012: Replace sessions with full conference.html schedule
-- Halls: Homi J. Bhabha Hall, Kalam Theatre, Raman Theatre, Aryabhata Theatre
-- Days: Day 1 (2026-06-02), Day 2 (2026-06-03)

-- Clear existing sessions for event 1
DELETE FROM sessions WHERE event_id = 1;

-- ═══════════════════════════════════════════════════════════
-- HOMI J. BHABHA HALL — DAY 1 (2 June 2026)
-- ═══════════════════════════════════════════════════════════
INSERT OR IGNORE INTO sessions (event_id, title, description, speaker_name, speaker_title, speaker_avatar, session_type, track, room, start_time, end_time, capacity) VALUES
(1, 'Registration & Reporting', 'Check-in and badge collection at Homi J. Bhabha Hall', NULL, NULL, '📋', 'break', NULL, 'Homi J. Bhabha Hall', '2026-06-02 08:30', '2026-06-02 09:30', 5000),
(1, 'Morning Tea & Networking', 'Welcome networking session before the opening plenary', NULL, NULL, '☕', 'networking', NULL, 'Homi J. Bhabha Hall', '2026-06-02 09:30', '2026-06-02 10:00', 5000),
(1, 'Plenary — Inauguration, Welcome & Keynotes 1–4', 'Grand opening ceremony with inaugural addresses and keynote sessions from top industry and government leaders', NULL, NULL, '🎤', 'keynote', 'Main Stage', 'Homi J. Bhabha Hall', '2026-06-02 10:00', '2026-06-02 12:00', 2000),
(1, 'Innovation Talks 1–5', 'Five rapid-fire 10-minute innovation talks from industry innovators and disruptors', NULL, NULL, '💡', 'talk', 'Innovation Talks', 'Homi J. Bhabha Hall', '2026-06-02 12:00', '2026-06-02 12:50', 2000),
(1, 'Networking Lunch Break — All Halls', 'Networking lunch with exhibition floor open', NULL, NULL, '🍽️', 'break', NULL, 'Homi J. Bhabha Hall', '2026-06-02 13:00', '2026-06-02 14:00', 5000),
(1, 'Panel 5 — Healthcare', 'Democratizing Healthcare with AI: Access, Affordability & Outcomes', NULL, NULL, '🏥', 'panel', 'Healthcare & Life Sciences AI', 'Homi J. Bhabha Hall', '2026-06-02 14:00', '2026-06-02 15:10', 2000),
(1, 'Networking Tea Break', 'Refreshments and open networking', NULL, NULL, '🍵', 'break', NULL, 'Homi J. Bhabha Hall', '2026-06-02 15:20', '2026-06-02 15:40', 5000),
(1, 'Panel 6 — Agriculture', 'Transforming Indian Agriculture with AI: Doubling Farmer Income', NULL, NULL, '🌾', 'panel', 'Agricultural AI', 'Homi J. Bhabha Hall', '2026-06-02 15:40', '2026-06-02 16:50', 2000),
(1, 'Day 1 Wrap-up', 'Summary of the day''s sessions and preview of Day 2', NULL, NULL, '📝', 'break', NULL, 'Homi J. Bhabha Hall', '2026-06-02 17:00', '2026-06-02 17:10', 5000),
(1, 'The Innovators'' Circle — CXO Cocktail Evening', 'Exclusive networking cocktail evening for CXOs and senior industry leaders', NULL, NULL, '🥂', 'networking', 'Networking', 'Homi J. Bhabha Hall', '2026-06-02 18:30', '2026-06-02 20:30', 500),

-- ═══════════════════════════════════════════════════════════
-- HOMI J. BHABHA HALL — DAY 2 (3 June 2026)
-- ═══════════════════════════════════════════════════════════
(1, 'Registration & Reporting', 'Check-in for Day 2 attendees', NULL, NULL, '📋', 'break', NULL, 'Homi J. Bhabha Hall', '2026-06-03 08:30', '2026-06-03 09:30', 5000),
(1, 'Morning Tea & Networking', 'Day 2 welcome networking session', NULL, NULL, '☕', 'networking', NULL, 'Homi J. Bhabha Hall', '2026-06-03 09:30', '2026-06-03 10:00', 5000),
(1, 'Panel 7 — Energy & Utilities', 'Powering the Future: AI for Smart Grids, Sustainability, and Energy Optimization', NULL, NULL, '⚡', 'panel', 'Manufacturing & Industry 4.0', 'Homi J. Bhabha Hall', '2026-06-03 10:00', '2026-06-03 11:10', 2000),
(1, 'Innovation Talks 16–19', 'Four rapid-fire 10-minute innovation talks', NULL, NULL, '💡', 'talk', 'Innovation Talks', 'Homi J. Bhabha Hall', '2026-06-03 11:10', '2026-06-03 11:50', 2000),
(1, 'Pre-Lunch Networking & Expo', 'Open networking session with exhibition floor and startup zone', NULL, NULL, '🤝', 'networking', NULL, 'Homi J. Bhabha Hall', '2026-06-03 12:00', '2026-06-03 13:00', 5000),
(1, 'Networking Lunch Break — All Halls', 'Networking lunch with exhibition floor open', NULL, NULL, '🍽️', 'break', NULL, 'Homi J. Bhabha Hall', '2026-06-03 13:00', '2026-06-03 14:00', 5000),
(1, 'Workshop 1 — Hands-on Agentic AI', '60-minute practical workshop on building and deploying Agentic AI systems', NULL, NULL, '🔬', 'workshop', 'Training Workshop', 'Homi J. Bhabha Hall', '2026-06-03 14:00', '2026-06-03 15:00', 300),
(1, 'Networking Tea Break', 'Refreshments and open networking', NULL, NULL, '🍵', 'break', NULL, 'Homi J. Bhabha Hall', '2026-06-03 15:20', '2026-06-03 15:40', 5000),
(1, 'Masterclass — AI 2030: India''s Leadership Playbook', '60-minute masterclass on India''s strategic roadmap for AI leadership through 2030', NULL, NULL, '🎓', 'keynote', 'Main Stage', 'Homi J. Bhabha Hall', '2026-06-03 15:40', '2026-06-03 16:40', 2000),
(1, 'Networking & Wrap-up', 'Final networking session and conference summary', NULL, NULL, '🤝', 'networking', NULL, 'Homi J. Bhabha Hall', '2026-06-03 16:40', '2026-06-03 17:00', 5000),
(1, 'Closing Ceremony', 'Valedictory address, key announcements, and closing of Bharat AI Innovation 2026', NULL, NULL, '🏁', 'keynote', 'Main Stage', 'Homi J. Bhabha Hall', '2026-06-03 17:00', '2026-06-03 17:15', 2000),

-- ═══════════════════════════════════════════════════════════
-- KALAM THEATRE — DAY 1 (2 June 2026)
-- ═══════════════════════════════════════════════════════════
(1, 'Registration & Reporting', 'Check-in and badge collection', NULL, NULL, '📋', 'break', NULL, 'Kalam Theatre', '2026-06-02 08:30', '2026-06-02 09:30', 5000),
(1, 'Morning Tea & Networking', 'Welcome networking session before the opening plenary', NULL, NULL, '☕', 'networking', NULL, 'Kalam Theatre', '2026-06-02 09:30', '2026-06-02 10:00', 5000),
(1, 'Homi J. Bhabha Hall Plenary — Inauguration, Welcome & Keynotes 1–4', 'Grand opening ceremony with inaugural addresses and keynote sessions', NULL, NULL, '🎤', 'keynote', 'Main Stage', 'Kalam Theatre', '2026-06-02 10:00', '2026-06-02 12:00', 2000),
(1, 'Innovation Talks 1–5', 'Five rapid-fire 10-minute innovation talks from industry innovators', NULL, NULL, '💡', 'talk', 'Innovation Talks', 'Kalam Theatre', '2026-06-02 12:00', '2026-06-02 12:50', 2000),
(1, 'Networking Lunch Break — All Halls', 'Networking lunch with exhibition floor open', NULL, NULL, '🍽️', 'break', NULL, 'Kalam Theatre', '2026-06-02 13:00', '2026-06-02 14:00', 5000),
(1, 'Panel 5 — Healthcare', 'Democratizing Healthcare with AI: Access, Affordability & Outcomes', NULL, NULL, '🏥', 'panel', 'Healthcare & Life Sciences AI', 'Kalam Theatre', '2026-06-02 14:00', '2026-06-02 15:10', 2000),
(1, 'Networking Tea Break', 'Refreshments and open networking', NULL, NULL, '🍵', 'break', NULL, 'Kalam Theatre', '2026-06-02 15:20', '2026-06-02 15:40', 5000),
(1, 'Panel 6 — Agriculture', 'Transforming Indian Agriculture with AI: Doubling Farmer Income', NULL, NULL, '🌾', 'panel', 'Agricultural AI', 'Kalam Theatre', '2026-06-02 15:40', '2026-06-02 16:50', 2000),
(1, 'Day 1 Wrap-up', 'Summary of the day''s sessions and preview of Day 2', NULL, NULL, '📝', 'break', NULL, 'Kalam Theatre', '2026-06-02 17:00', '2026-06-02 17:10', 5000),
(1, 'The Innovators'' Circle — CXO Cocktail Evening', 'Exclusive networking cocktail evening for CXOs and senior industry leaders', NULL, NULL, '🥂', 'networking', 'Networking', 'Kalam Theatre', '2026-06-02 18:30', '2026-06-02 20:30', 500),

-- ═══════════════════════════════════════════════════════════
-- KALAM THEATRE — DAY 2 (3 June 2026)
-- ═══════════════════════════════════════════════════════════
(1, 'Registration & Reporting', 'Check-in for Day 2 attendees', NULL, NULL, '📋', 'break', NULL, 'Kalam Theatre', '2026-06-03 08:30', '2026-06-03 09:30', 5000),
(1, 'Morning Tea & Networking', 'Day 2 welcome networking session', NULL, NULL, '☕', 'networking', NULL, 'Kalam Theatre', '2026-06-03 09:30', '2026-06-03 10:00', 5000),
(1, 'Panel 7 — Energy & Utilities', 'Powering the Future: AI for Smart Grids, Sustainability, and Energy Optimization', NULL, NULL, '⚡', 'panel', 'Manufacturing & Industry 4.0', 'Kalam Theatre', '2026-06-03 10:00', '2026-06-03 11:10', 2000),
(1, 'Innovation Talks 16–19', 'Four rapid-fire 10-minute innovation talks', NULL, NULL, '💡', 'talk', 'Innovation Talks', 'Kalam Theatre', '2026-06-03 11:10', '2026-06-03 11:50', 2000),
(1, 'Pre-Lunch Networking & Expo', 'Open networking session with exhibition floor and startup zone', NULL, NULL, '🤝', 'networking', NULL, 'Kalam Theatre', '2026-06-03 12:00', '2026-06-03 13:00', 5000),
(1, 'Networking Lunch Break — All Halls', 'Networking lunch with exhibition floor open', NULL, NULL, '🍽️', 'break', NULL, 'Kalam Theatre', '2026-06-03 13:00', '2026-06-03 14:00', 5000),
(1, 'Workshop 1 — Hands-on Agentic AI', '60-minute practical workshop on building and deploying Agentic AI systems', NULL, NULL, '🔬', 'workshop', 'Training Workshop', 'Kalam Theatre', '2026-06-03 14:00', '2026-06-03 15:00', 300),
(1, 'Networking Tea Break', 'Refreshments and open networking', NULL, NULL, '🍵', 'break', NULL, 'Kalam Theatre', '2026-06-03 15:20', '2026-06-03 15:40', 5000),
(1, 'Masterclass — AI 2030: India''s Leadership Playbook', '60-minute masterclass on India''s strategic roadmap for AI leadership through 2030', NULL, NULL, '🎓', 'keynote', 'Main Stage', 'Kalam Theatre', '2026-06-03 15:40', '2026-06-03 16:40', 2000),
(1, 'Networking & Wrap-up', 'Final networking session and conference summary', NULL, NULL, '🤝', 'networking', NULL, 'Kalam Theatre', '2026-06-03 16:40', '2026-06-03 17:00', 5000),
(1, 'Closing Ceremony', 'Valedictory address, key announcements, and closing of Bharat AI Innovation 2026', NULL, NULL, '🏁', 'keynote', 'Main Stage', 'Kalam Theatre', '2026-06-03 17:00', '2026-06-03 17:15', 2000),

-- ═══════════════════════════════════════════════════════════
-- RAMAN THEATRE — DAY 1 (2 June 2026)
-- ═══════════════════════════════════════════════════════════
(1, 'Registration & Reporting', 'Check-in and badge collection', NULL, NULL, '📋', 'break', NULL, 'Raman Theatre', '2026-06-02 08:30', '2026-06-02 09:30', 5000),
(1, 'Morning Tea & Networking', 'Welcome networking session before the opening plenary', NULL, NULL, '☕', 'networking', NULL, 'Raman Theatre', '2026-06-02 09:30', '2026-06-02 10:00', 5000),
(1, 'Homi J. Bhabha Hall Plenary — Inauguration, Welcome & Keynotes 1–4', 'Grand opening ceremony with inaugural addresses and keynote sessions', NULL, NULL, '🎤', 'keynote', 'Main Stage', 'Raman Theatre', '2026-06-02 10:00', '2026-06-02 12:00', 2000),
(1, 'Innovation Talks 11–15', 'Five rapid-fire 10-minute innovation talks', NULL, NULL, '💡', 'talk', 'Innovation Talks', 'Raman Theatre', '2026-06-02 12:00', '2026-06-02 12:50', 2000),
(1, 'Networking Lunch Break', 'Networking lunch with exhibition floor open', NULL, NULL, '🍽️', 'break', NULL, 'Raman Theatre', '2026-06-02 13:00', '2026-06-02 14:00', 5000),
(1, 'Panel 10 — Insurance', 'The Next Wave of AI in Insurance', NULL, NULL, '🛡️', 'panel', 'FinTech & BFSI AI', 'Raman Theatre', '2026-06-02 14:40', '2026-06-02 15:50', 2000),
(1, 'Networking Tea Break', 'Refreshments and open networking', NULL, NULL, '🍵', 'break', NULL, 'Raman Theatre', '2026-06-02 15:20', '2026-06-02 15:40', 5000),
(1, 'Networking / Expo', 'Open networking with exhibition floor', NULL, NULL, '🤝', 'networking', NULL, 'Raman Theatre', '2026-06-02 16:00', '2026-06-02 16:30', 5000),
(1, 'Investor Connect', 'Curated startup-investor matchmaking session', NULL, NULL, '💼', 'talk', 'Startups', 'Raman Theatre', '2026-06-02 16:30', '2026-06-02 17:00', 300),
(1, 'Day 1 Wrap-up', 'Summary of sessions and preview of Day 2', NULL, NULL, '📝', 'break', NULL, 'Raman Theatre', '2026-06-02 17:00', '2026-06-02 17:10', 5000),
(1, 'The Innovators'' Circle — CXO Cocktail Evening', 'Exclusive networking cocktail evening for CXOs and senior industry leaders', NULL, NULL, '🥂', 'networking', 'Networking', 'Raman Theatre', '2026-06-02 18:30', '2026-06-02 20:30', 500),

-- ═══════════════════════════════════════════════════════════
-- RAMAN THEATRE — DAY 2 (3 June 2026)
-- ═══════════════════════════════════════════════════════════
(1, 'Registration & Reporting', 'Check-in for Day 2 attendees', NULL, NULL, '📋', 'break', NULL, 'Raman Theatre', '2026-06-03 08:30', '2026-06-03 09:30', 5000),
(1, 'Morning Tea & Networking', 'Day 2 welcome networking session', NULL, NULL, '☕', 'networking', NULL, 'Raman Theatre', '2026-06-03 09:30', '2026-06-03 10:00', 5000),
(1, 'Panel 4 — Learning & Education', 'Improving Learning Outcomes with AI: From Assessment to Measurable Impact (Powered by Assessfy)', NULL, NULL, '🎓', 'panel', 'AI in Education', 'Raman Theatre', '2026-06-03 10:00', '2026-06-03 11:10', 2000),
(1, 'Innovation Talks 23–25', 'Three rapid-fire 10-minute innovation talks', NULL, NULL, '💡', 'talk', 'Innovation Talks', 'Raman Theatre', '2026-06-03 11:10', '2026-06-03 11:40', 2000),
(1, 'Gen AI & Agentic AI Master Class for Leaders', 'Pre-lunch masterclass on Generative and Agentic AI for business leaders', NULL, NULL, '🤖', 'keynote', 'Generative AI & LLMs', 'Raman Theatre', '2026-06-03 12:00', '2026-06-03 13:00', 2000),
(1, 'Networking Lunch Break', 'Networking lunch with exhibition floor open', NULL, NULL, '🍽️', 'break', NULL, 'Raman Theatre', '2026-06-03 13:00', '2026-06-03 14:00', 5000),
(1, 'Panel 12 — Telecom', 'AI in Telecom: Enabling Digital India Through Intelligent Connectivity', NULL, NULL, '📡', 'panel', 'Manufacturing & Industry 4.0', 'Raman Theatre', '2026-06-03 14:20', '2026-06-03 15:30', 2000),
(1, 'Networking Tea Break', 'Refreshments and open networking', NULL, NULL, '🍵', 'break', NULL, 'Raman Theatre', '2026-06-03 15:30', '2026-06-03 15:50', 5000),
(1, 'Workshop 3 — Generative AI Hands-on', '60-minute hands-on Generative AI workshop', NULL, NULL, '🔬', 'workshop', 'Generative AI & LLMs', 'Raman Theatre', '2026-06-03 15:50', '2026-06-03 16:50', 300),
(1, 'Networking & Expo', 'Closing networking session with exhibition floor', NULL, NULL, '🤝', 'networking', NULL, 'Raman Theatre', '2026-06-03 16:50', '2026-06-03 17:10', 5000),
(1, 'Closing', 'Closing remarks for Raman Theatre sessions', NULL, NULL, '🏁', 'keynote', NULL, 'Raman Theatre', '2026-06-03 17:10', '2026-06-03 17:20', 2000),

-- ═══════════════════════════════════════════════════════════
-- ARYABHATA THEATRE — DAY 1 (2 June 2026)
-- ═══════════════════════════════════════════════════════════
(1, 'Registration & Reporting', 'Check-in and badge collection', NULL, NULL, '📋', 'break', NULL, 'Aryabhata Theatre', '2026-06-02 08:30', '2026-06-02 09:30', 5000),
(1, 'Morning Tea & Networking', 'Welcome networking session before the opening plenary', NULL, NULL, '☕', 'networking', NULL, 'Aryabhata Theatre', '2026-06-02 09:30', '2026-06-02 10:00', 5000),
(1, 'Homi J. Bhabha Hall Plenary — Inauguration, Welcome & Keynotes 1–4', 'Grand opening ceremony with inaugural addresses and keynote sessions', NULL, NULL, '🎤', 'keynote', 'Main Stage', 'Aryabhata Theatre', '2026-06-02 10:00', '2026-06-02 12:00', 2000),
(1, 'Innovation Talks 6–10', 'Five rapid-fire 10-minute innovation talks', NULL, NULL, '💡', 'talk', 'Innovation Talks', 'Aryabhata Theatre', '2026-06-02 12:00', '2026-06-02 12:50', 2000),
(1, 'Networking Lunch Break — All Halls', 'Networking lunch with exhibition floor open', NULL, NULL, '🍽️', 'break', NULL, 'Aryabhata Theatre', '2026-06-02 13:00', '2026-06-02 14:00', 5000),
(1, 'Panel 8 — Sales & Marketing', 'AI-Driven Growth Engines: Transforming Sales & Marketing', NULL, NULL, '📈', 'panel', 'FinTech & BFSI AI', 'Aryabhata Theatre', '2026-06-02 14:20', '2026-06-02 15:30', 2000),
(1, 'Networking Tea Break', 'Refreshments and open networking', NULL, NULL, '🍵', 'break', NULL, 'Aryabhata Theatre', '2026-06-02 15:30', '2026-06-02 15:50', 5000),
(1, 'Panel 9 — Workforce', 'Reimagining the Workforce: AI Across Hiring, Learning, and Talent Experience', NULL, NULL, '👥', 'panel', 'AI in Education', 'Aryabhata Theatre', '2026-06-02 15:50', '2026-06-02 17:00', 2000),
(1, 'Day 1 Wrap-up', 'Summary of sessions and preview of Day 2', NULL, NULL, '📝', 'break', NULL, 'Aryabhata Theatre', '2026-06-02 17:10', '2026-06-02 17:20', 5000),
(1, 'The Innovators'' Circle — CXO Cocktail Evening', 'Exclusive networking cocktail evening for CXOs and senior industry leaders', NULL, NULL, '🥂', 'networking', 'Networking', 'Aryabhata Theatre', '2026-06-02 18:30', '2026-06-02 20:30', 500),

-- ═══════════════════════════════════════════════════════════
-- ARYABHATA THEATRE — DAY 2 (3 June 2026)
-- ═══════════════════════════════════════════════════════════
(1, 'Registration & Reporting', 'Check-in for Day 2 attendees', NULL, NULL, '📋', 'break', NULL, 'Aryabhata Theatre', '2026-06-03 08:30', '2026-06-03 09:30', 5000),
(1, 'Morning Tea & Networking', 'Day 2 welcome networking session', NULL, NULL, '☕', 'networking', NULL, 'Aryabhata Theatre', '2026-06-03 09:30', '2026-06-03 10:00', 5000),
(1, 'Panel 3 — Government AI', 'AI Transforming Governance: Enabling Viksit Bharat', NULL, NULL, '🏛️', 'panel', 'AI for Governance', 'Aryabhata Theatre', '2026-06-03 10:40', '2026-06-03 11:50', 2000),
(1, 'Innovation Talks 20–22', 'Three rapid-fire 10-minute innovation talks', NULL, NULL, '💡', 'talk', 'Innovation Talks', 'Aryabhata Theatre', '2026-06-03 11:50', '2026-06-03 12:20', 2000),
(1, 'Pre-Lunch Networking', 'Open networking session before lunch', NULL, NULL, '🤝', 'networking', NULL, 'Aryabhata Theatre', '2026-06-03 12:20', '2026-06-03 13:00', 5000),
(1, 'Networking Lunch Break — All Halls', 'Networking lunch with exhibition floor open', NULL, NULL, '🍽️', 'break', NULL, 'Aryabhata Theatre', '2026-06-03 13:00', '2026-06-03 14:00', 5000),
(1, 'Workshop 2 — AI in Business Operations', '60-minute hands-on workshop on AI-driven business operations', NULL, NULL, '🔬', 'workshop', 'Training Workshop', 'Aryabhata Theatre', '2026-06-03 14:00', '2026-06-03 15:00', 300),
(1, 'Networking Tea Break', 'Refreshments and open networking', NULL, NULL, '🍵', 'break', NULL, 'Aryabhata Theatre', '2026-06-03 15:30', '2026-06-03 15:50', 5000),
(1, 'Masterclass — AI Implementation for Enterprises', '60-minute masterclass on enterprise AI adoption and implementation', NULL, NULL, '🎓', 'keynote', 'Main Stage', 'Aryabhata Theatre', '2026-06-03 15:50', '2026-06-03 16:50', 2000),
(1, 'Networking & Expo', 'Closing networking session with exhibition floor', NULL, NULL, '🤝', 'networking', NULL, 'Aryabhata Theatre', '2026-06-03 16:50', '2026-06-03 17:10', 5000),
(1, 'Wrap-up', 'Closing remarks for Aryabhata Theatre sessions', NULL, NULL, '🏁', 'keynote', NULL, 'Aryabhata Theatre', '2026-06-03 17:10', '2026-06-03 17:20', 2000);
