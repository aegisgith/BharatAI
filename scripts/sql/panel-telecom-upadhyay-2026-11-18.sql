-- Dr. Rajkumar Upadhyay (CEO & Chairman, C-DOT) joins the telecom panel (organiser,
-- 18 Nov 2026): "AI in Telecom: Enabling Digital India Through Intelligent Connectivity",
-- Sat 21 Nov, 9:30-10:20, Homi J. Bhabha Hall. He was on the speakers list but hidden
-- (id 31, with his photo): shown again, organisation "C-DOT", first on the panel
-- (government first). Safe to run twice.
UPDATE speakers SET is_published = 1, organisation = 'C-DOT', updated_at = CURRENT_TIMESTAMP
WHERE id = 31 AND event_id = 1 AND slug = 'rajkumar-upadhyay';
UPDATE sessions SET speaker_name = 'Dr. Rajkumar Upadhyay (C-DOT), ' || speaker_name
WHERE id = 137 AND event_id = 1 AND speaker_name NOT LIKE '%Upadhyay%';
