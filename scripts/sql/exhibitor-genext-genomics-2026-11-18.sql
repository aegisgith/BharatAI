-- GeNext Genomics (GNG), a Startup Pod exhibitor (organiser, 18 Nov 2026, with its logo).
-- Two of its people hold Exhibitor badges, which had made two hidden rows (118, 119). Row
-- 118 becomes the company's one exhibitor row: a booking row (Startup Pod; the pod number
-- is set in Admin -> Exhibitors), the website's logo, both people on its team with the
-- passes Admin gave them (added_by 'badge'), and 119 folded in. Safe to run twice.
INSERT OR IGNORE INTO exhibitor_team_settings (exhibitor_id, booth_type, booth_name, booth_dim)
SELECT 118, 'pod', 'Startup Pod', '1.5m x 1.5m' WHERE EXISTS (SELECT 1 FROM exhibitors WHERE id = 118 AND company_name LIKE 'GeNext Genomics%');
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/genext-genomics.webp'
WHERE id = 118 AND company_name LIKE 'GeNext Genomics%' AND COALESCE(logo_url, '') = '';

-- Both people (the attendees behind rows 118 and 119) on the team, unless already listed.
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
SELECT a.event_id, 118,
  CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END,
  CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END,
  COALESCE(a.job_title, ''), 'GeNext Genomics Pvt Ltd', lower(trim(a.email)),
  CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
  CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
WHERE e.id IN (118, 119) AND e.company_name LIKE 'GeNext Genomics%' AND trim(COALESCE(a.email, '')) <> ''
  AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));

-- 119 folded into 118.
UPDATE exhibitor_team SET exhibitor_id = 118, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 119;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 118 WHERE exhibitor_id = 119;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 118 WHERE exhibitor_id = 119;
UPDATE mp_companies SET exhibitor_id = 118 WHERE exhibitor_id = 119;
UPDATE mp_listings SET exhibitor_id = 118 WHERE exhibitor_id = 119;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 118 WHERE exhibitor_id = 119;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 119;
DELETE FROM booth_visits WHERE exhibitor_id = 119;
DELETE FROM exhibitors WHERE id = 119 AND company_name LIKE 'GeNext Genomics%'
  AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 119)
  AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 119 AND status = 'confirmed' AND released_at IS NULL);
