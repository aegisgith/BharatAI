-- Hon'ble Shri Chhagan Bhujbal dropped out (organiser, 18 Nov 2026).
-- His keynote "Inauguration and Special Address: AI for Viksit Maharashtra"
-- (Sat 21 Nov, 9:10-9:30, Homi J. Bhabha Hall) becomes a draft in Admin -> Conference:
-- hidden from the app and the website, kept so it can be published again.
-- Touches that session only while it still names him. Safe to run twice.
INSERT INTO session_admin (session_id, status, note, updated_at)
SELECT id, 'draft', 'Hon''ble Shri Chhagan Bhujbal dropped out (organiser, 18 Nov 2026)', CURRENT_TIMESTAMP
FROM sessions WHERE id = 136 AND event_id = 1 AND speaker_name LIKE '%Bhujbal%'
ON CONFLICT(session_id) DO UPDATE SET status = 'draft', note = excluded.note, updated_at = CURRENT_TIMESTAMP;
