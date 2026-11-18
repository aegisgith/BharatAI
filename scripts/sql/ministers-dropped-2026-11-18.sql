-- Hon'ble Shri Dattatray Bharane (Agriculture) and Hon'ble Shri Sanjay Rathod (Soil & Water
-- Conservation) are off the programme (organiser, 18 Nov 2026). Their keynotes (Fri 20 Nov,
-- 10:15 and 10:40, Homi J. Bhabha Hall) become drafts in Admin -> Conference, and their speaker
-- rows are hidden: off the app and the website, kept so they can be published again.
-- Touches those rows only while they still name them. Safe to run twice.
INSERT INTO session_admin (session_id, status, note, updated_at)
SELECT id, 'draft', 'Minister off the programme (organiser, 18 Nov 2026)', CURRENT_TIMESTAMP
FROM sessions WHERE event_id = 1 AND ((id = 115 AND speaker_name LIKE '%Bharane%') OR (id = 117 AND speaker_name LIKE '%Rathod%'))
ON CONFLICT(session_id) DO UPDATE SET status = 'draft', note = excluded.note, updated_at = CURRENT_TIMESTAMP;
UPDATE speakers SET is_published = 0 WHERE event_id = 1 AND (name LIKE '%Dattatray Bharane%' OR name LIKE '%Sanjay Rathod%');
