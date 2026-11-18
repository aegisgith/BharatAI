-- Panel 2, BFSI: "AI Democratizing and Driving Financial Inclusion" (session 126,
-- Fri 20 Nov, 2:00-3:00 pm, Homi J. Bhabha Hall), as the organiser sent it on 18 Nov 2026:
--   Tarun Chugh (Bajaj Life), Nilesh Shah (Kotak Mahindra AMC), Sarosh Amaria (Tata Capital
--   Housing Finance), Mayur Kapur (TransUnion), Kiran Nambiar (MyFi), Shailesh Dhuri (moderator).
-- Tarun Chugh (26), Nilesh Shah (7), Kiran Nambiar (144) and Shailesh Dhuri (11) are listed
-- speakers and are linked; Sarosh Amaria and Mayur Kapur are named on the line, as before.
-- Only touches session 126 while it is still this panel. Safe to run twice.
UPDATE sessions SET
  speaker_name = 'Tarun Chugh (Bajaj Life Insurance), Nilesh Shah (Kotak Mahindra Asset Management), Sarosh Amaria (Tata Capital Housing Finance), Mayur Kapur (TransUnion), Kiran Nambiar (MyFi), Shailesh Dhuri (Moderator)',
  start_time = '2026-11-20 14:00', end_time = '2026-11-20 15:00'
WHERE id = 126 AND event_id = 1 AND title = 'AI Democratizing and Driving Financial Inclusion';

INSERT OR IGNORE INTO session_speakers (session_id, speaker_id, role, sort_order)
SELECT 126, s.id, x.role, x.ord FROM (
  SELECT 26 AS sid, 'panellist' AS role, 0 AS ord UNION ALL
  SELECT 7, 'panellist', 1 UNION ALL
  SELECT 144, 'panellist', 4 UNION ALL
  SELECT 11, 'moderator', 5
) x JOIN speakers s ON s.id = x.sid
WHERE EXISTS (SELECT 1 FROM sessions WHERE id = 126 AND title = 'AI Democratizing and Driving Financial Inclusion');

UPDATE session_speakers SET sort_order = CASE speaker_id WHEN 26 THEN 0 WHEN 7 THEN 1 WHEN 144 THEN 4 WHEN 11 THEN 5 ELSE sort_order END,
  role = CASE speaker_id WHEN 11 THEN 'moderator' ELSE 'panellist' END
WHERE session_id = 126 AND speaker_id IN (26, 7, 144, 11);
