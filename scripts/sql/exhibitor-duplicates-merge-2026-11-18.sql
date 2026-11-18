-- One company, one exhibitor row (organiser said yes, 18 Nov 2026).
-- Giving someone an Exhibitor badge in Admin used to make a new exhibitors row for that
-- one person (7 CGI rows, 7 NoBroker rows, 4 extra Nu10 rows...). Their booth leads were
-- filed under their own row and a booth contact's dashboard could open an empty copy.
-- For each such row D of a company that is an exhibitor (row R, with a stand or a booking
-- row): the person behind D joins R's team with the pass Admin gave them (added_by
-- 'badge': the team list never counts, changes or takes back that pass), D's team list,
-- leads, visits, marketplace link and talk move to R, R gets D's contact email if it has
-- none, and D is deleted. The code stops making these rows (linkBadgeHolderToCompany).
-- Rows of companies that are not exhibitors yet are left alone. Safe to run twice.

-- 33 KaDeep Technologies -> 26 kadeep.ai
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 33)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 33))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 33)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 33));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 26, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 26), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 33 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 26) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 33) WHERE id = 26 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 33);
UPDATE exhibitor_team SET exhibitor_id = 26, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 33;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 26 WHERE exhibitor_id = 33;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 26 WHERE exhibitor_id = 33;
UPDATE mp_companies SET exhibitor_id = 26 WHERE exhibitor_id = 33;
UPDATE mp_listings SET exhibitor_id = 26 WHERE exhibitor_id = 33;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 26 WHERE exhibitor_id = 33;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 33;
DELETE FROM booth_visits WHERE exhibitor_id = 33;
DELETE FROM exhibitors WHERE id = 33 AND company_name = 'KaDeep Technologies' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 33) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 33 AND status = 'confirmed' AND released_at IS NULL);

-- 34 Joget -> 23 Joget INC
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 34)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 34))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 34)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 34));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 23, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 23), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 34 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 23) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 34) WHERE id = 23 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 34);
UPDATE exhibitor_team SET exhibitor_id = 23, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 34;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 23 WHERE exhibitor_id = 34;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 23 WHERE exhibitor_id = 34;
UPDATE mp_companies SET exhibitor_id = 23 WHERE exhibitor_id = 34;
UPDATE mp_listings SET exhibitor_id = 23 WHERE exhibitor_id = 34;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 23 WHERE exhibitor_id = 34;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 34;
DELETE FROM booth_visits WHERE exhibitor_id = 34;
DELETE FROM exhibitors WHERE id = 34 AND company_name = 'Joget' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 34) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 34 AND status = 'confirmed' AND released_at IS NULL);

-- 36 ArySoft Global -> 31 ary-soft
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 36)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 36))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 36)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 36));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 31, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 31), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 36 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 31) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 36) WHERE id = 31 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 36);
UPDATE exhibitor_team SET exhibitor_id = 31, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 36;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 31 WHERE exhibitor_id = 36;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 31 WHERE exhibitor_id = 36;
UPDATE mp_companies SET exhibitor_id = 31 WHERE exhibitor_id = 36;
UPDATE mp_listings SET exhibitor_id = 31 WHERE exhibitor_id = 36;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 31 WHERE exhibitor_id = 36;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 36;
DELETE FROM booth_visits WHERE exhibitor_id = 36;
DELETE FROM exhibitors WHERE id = 36 AND company_name = 'ArySoft Global' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 36) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 36 AND status = 'confirmed' AND released_at IS NULL);

-- 37 OriginLabs AI Private Limited -> 19 Origin AI
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 37)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 37))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 37)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 37));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 19, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 19), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 37 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 19) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 37) WHERE id = 19 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 37);
UPDATE exhibitor_team SET exhibitor_id = 19, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 37;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 19 WHERE exhibitor_id = 37;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 19 WHERE exhibitor_id = 37;
UPDATE mp_companies SET exhibitor_id = 19 WHERE exhibitor_id = 37;
UPDATE mp_listings SET exhibitor_id = 19 WHERE exhibitor_id = 37;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 19 WHERE exhibitor_id = 37;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 37;
DELETE FROM booth_visits WHERE exhibitor_id = 37;
DELETE FROM exhibitors WHERE id = 37 AND company_name = 'OriginLabs AI Private Limited' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 37) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 37 AND status = 'confirmed' AND released_at IS NULL);

-- 40 JOGET -> 23 Joget INC
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 40)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 40))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 40)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 40));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 23, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 23), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 40 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 23) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 40) WHERE id = 23 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 40);
UPDATE exhibitor_team SET exhibitor_id = 23, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 40;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 23 WHERE exhibitor_id = 40;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 23 WHERE exhibitor_id = 40;
UPDATE mp_companies SET exhibitor_id = 23 WHERE exhibitor_id = 40;
UPDATE mp_listings SET exhibitor_id = 23 WHERE exhibitor_id = 40;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 23 WHERE exhibitor_id = 40;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 40;
DELETE FROM booth_visits WHERE exhibitor_id = 40;
DELETE FROM exhibitors WHERE id = 40 AND company_name = 'JOGET' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 40) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 40 AND status = 'confirmed' AND released_at IS NULL);

-- 58 Aria Telecom -> 41 Aria Telecom
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 58)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 58))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 58)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 58));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 41, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 41), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 58 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 41) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 58) WHERE id = 41 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 58);
UPDATE exhibitor_team SET exhibitor_id = 41, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 58;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 41 WHERE exhibitor_id = 58;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 41 WHERE exhibitor_id = 58;
UPDATE mp_companies SET exhibitor_id = 41 WHERE exhibitor_id = 58;
UPDATE mp_listings SET exhibitor_id = 41 WHERE exhibitor_id = 58;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 41 WHERE exhibitor_id = 58;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 58;
DELETE FROM booth_visits WHERE exhibitor_id = 58;
DELETE FROM exhibitors WHERE id = 58 AND company_name = 'Aria Telecom' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 58) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 58 AND status = 'confirmed' AND released_at IS NULL);

-- 59 Nu10 Technologies -> 49 Nu10 Technologies
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 59)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 59))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 59)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 59));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 49, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 49), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 59 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 49) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 59) WHERE id = 49 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 59);
UPDATE exhibitor_team SET exhibitor_id = 49, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 59;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 49 WHERE exhibitor_id = 59;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 49 WHERE exhibitor_id = 59;
UPDATE mp_companies SET exhibitor_id = 49 WHERE exhibitor_id = 59;
UPDATE mp_listings SET exhibitor_id = 49 WHERE exhibitor_id = 59;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 49 WHERE exhibitor_id = 59;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 59;
DELETE FROM booth_visits WHERE exhibitor_id = 59;
DELETE FROM exhibitors WHERE id = 59 AND company_name = 'Nu10 Technologies' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 59) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 59 AND status = 'confirmed' AND released_at IS NULL);

-- 61 Rightangle Technologies -> 52 Rightangle Technologies
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 61)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 61))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 61)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 61));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 52, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 52), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 61 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 52) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 61) WHERE id = 52 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 61);
UPDATE exhibitor_team SET exhibitor_id = 52, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 61;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 52 WHERE exhibitor_id = 61;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 52 WHERE exhibitor_id = 61;
UPDATE mp_companies SET exhibitor_id = 52 WHERE exhibitor_id = 61;
UPDATE mp_listings SET exhibitor_id = 52 WHERE exhibitor_id = 61;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 52 WHERE exhibitor_id = 61;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 61;
DELETE FROM booth_visits WHERE exhibitor_id = 61;
DELETE FROM exhibitors WHERE id = 61 AND company_name = 'Rightangle Technologies' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 61) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 61 AND status = 'confirmed' AND released_at IS NULL);

-- 62 Nu10 Technologies -> 49 Nu10 Technologies
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 62)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 62))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 62)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 62));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 49, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 49), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 62 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 49) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 62) WHERE id = 49 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 62);
UPDATE exhibitor_team SET exhibitor_id = 49, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 62;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 49 WHERE exhibitor_id = 62;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 49 WHERE exhibitor_id = 62;
UPDATE mp_companies SET exhibitor_id = 49 WHERE exhibitor_id = 62;
UPDATE mp_listings SET exhibitor_id = 49 WHERE exhibitor_id = 62;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 49 WHERE exhibitor_id = 62;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 62;
DELETE FROM booth_visits WHERE exhibitor_id = 62;
DELETE FROM exhibitors WHERE id = 62 AND company_name = 'Nu10 Technologies' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 62) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 62 AND status = 'confirmed' AND released_at IS NULL);

-- 63 Nu10 Technologies -> 49 Nu10 Technologies
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 63)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 63))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 63)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 63));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 49, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 49), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 63 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 49) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 63) WHERE id = 49 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 63);
UPDATE exhibitor_team SET exhibitor_id = 49, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 63;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 49 WHERE exhibitor_id = 63;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 49 WHERE exhibitor_id = 63;
UPDATE mp_companies SET exhibitor_id = 49 WHERE exhibitor_id = 63;
UPDATE mp_listings SET exhibitor_id = 49 WHERE exhibitor_id = 63;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 49 WHERE exhibitor_id = 63;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 63;
DELETE FROM booth_visits WHERE exhibitor_id = 63;
DELETE FROM exhibitors WHERE id = 63 AND company_name = 'Nu10 Technologies' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 63) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 63 AND status = 'confirmed' AND released_at IS NULL);

-- 64 Nu10 Technologies -> 49 Nu10 Technologies
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 64)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 64))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 64)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 64));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 49, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 49), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 64 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 49) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 64) WHERE id = 49 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 64);
UPDATE exhibitor_team SET exhibitor_id = 49, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 64;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 49 WHERE exhibitor_id = 64;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 49 WHERE exhibitor_id = 64;
UPDATE mp_companies SET exhibitor_id = 49 WHERE exhibitor_id = 64;
UPDATE mp_listings SET exhibitor_id = 49 WHERE exhibitor_id = 64;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 49 WHERE exhibitor_id = 64;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 64;
DELETE FROM booth_visits WHERE exhibitor_id = 64;
DELETE FROM exhibitors WHERE id = 64 AND company_name = 'Nu10 Technologies' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 64) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 64 AND status = 'confirmed' AND released_at IS NULL);

-- 65 TeenageWorks -> 53 Teenage Works
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 65)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 65))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 65)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 65));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 53, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 53), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 65 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 53) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 65) WHERE id = 53 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 65);
UPDATE exhibitor_team SET exhibitor_id = 53, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 65;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 53 WHERE exhibitor_id = 65;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 53 WHERE exhibitor_id = 65;
UPDATE mp_companies SET exhibitor_id = 53 WHERE exhibitor_id = 65;
UPDATE mp_listings SET exhibitor_id = 53 WHERE exhibitor_id = 65;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 53 WHERE exhibitor_id = 65;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 65;
DELETE FROM booth_visits WHERE exhibitor_id = 65;
DELETE FROM exhibitors WHERE id = 65 AND company_name = 'TeenageWorks' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 65) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 65 AND status = 'confirmed' AND released_at IS NULL);

-- 66 NoBroker Technologies Solutions Private Limited -> 10 NoBroker Technologies Solutions Private Limited
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 66)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 66))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 66)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 66));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 10, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 10), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 66 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 10) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 66) WHERE id = 10 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 66);
UPDATE exhibitor_team SET exhibitor_id = 10, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 66;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 10 WHERE exhibitor_id = 66;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 10 WHERE exhibitor_id = 66;
UPDATE mp_companies SET exhibitor_id = 10 WHERE exhibitor_id = 66;
UPDATE mp_listings SET exhibitor_id = 10 WHERE exhibitor_id = 66;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 10 WHERE exhibitor_id = 66;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 66;
DELETE FROM booth_visits WHERE exhibitor_id = 66;
DELETE FROM exhibitors WHERE id = 66 AND company_name = 'NoBroker Technologies Solutions Private Limited' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 66) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 66 AND status = 'confirmed' AND released_at IS NULL);

-- 67 NoBroker Technologies Solutions Private Limited -> 10 NoBroker Technologies Solutions Private Limited
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 67)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 67))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 67)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 67));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 10, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 10), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 67 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 10) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 67) WHERE id = 10 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 67);
UPDATE exhibitor_team SET exhibitor_id = 10, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 67;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 10 WHERE exhibitor_id = 67;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 10 WHERE exhibitor_id = 67;
UPDATE mp_companies SET exhibitor_id = 10 WHERE exhibitor_id = 67;
UPDATE mp_listings SET exhibitor_id = 10 WHERE exhibitor_id = 67;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 10 WHERE exhibitor_id = 67;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 67;
DELETE FROM booth_visits WHERE exhibitor_id = 67;
DELETE FROM exhibitors WHERE id = 67 AND company_name = 'NoBroker Technologies Solutions Private Limited' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 67) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 67 AND status = 'confirmed' AND released_at IS NULL);

-- 68 NoBroker Technologies Solutions Private Limited -> 10 NoBroker Technologies Solutions Private Limited
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 68)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 68))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 68)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 68));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 10, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 10), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 68 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 10) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 68) WHERE id = 10 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 68);
UPDATE exhibitor_team SET exhibitor_id = 10, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 68;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 10 WHERE exhibitor_id = 68;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 10 WHERE exhibitor_id = 68;
UPDATE mp_companies SET exhibitor_id = 10 WHERE exhibitor_id = 68;
UPDATE mp_listings SET exhibitor_id = 10 WHERE exhibitor_id = 68;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 10 WHERE exhibitor_id = 68;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 68;
DELETE FROM booth_visits WHERE exhibitor_id = 68;
DELETE FROM exhibitors WHERE id = 68 AND company_name = 'NoBroker Technologies Solutions Private Limited' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 68) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 68 AND status = 'confirmed' AND released_at IS NULL);

-- 69 NoBroker Technologies Solutions Private Limited -> 10 NoBroker Technologies Solutions Private Limited
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 69)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 69))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 69)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 69));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 10, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 10), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 69 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 10) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 69) WHERE id = 10 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 69);
UPDATE exhibitor_team SET exhibitor_id = 10, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 69;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 10 WHERE exhibitor_id = 69;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 10 WHERE exhibitor_id = 69;
UPDATE mp_companies SET exhibitor_id = 10 WHERE exhibitor_id = 69;
UPDATE mp_listings SET exhibitor_id = 10 WHERE exhibitor_id = 69;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 10 WHERE exhibitor_id = 69;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 69;
DELETE FROM booth_visits WHERE exhibitor_id = 69;
DELETE FROM exhibitors WHERE id = 69 AND company_name = 'NoBroker Technologies Solutions Private Limited' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 69) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 69 AND status = 'confirmed' AND released_at IS NULL);

-- 70 NoBroker Technologies Solutions Private Limited -> 10 NoBroker Technologies Solutions Private Limited
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 70)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 70))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 70)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 70));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 10, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 10), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 70 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 10) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 70) WHERE id = 10 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 70);
UPDATE exhibitor_team SET exhibitor_id = 10, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 70;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 10 WHERE exhibitor_id = 70;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 10 WHERE exhibitor_id = 70;
UPDATE mp_companies SET exhibitor_id = 10 WHERE exhibitor_id = 70;
UPDATE mp_listings SET exhibitor_id = 10 WHERE exhibitor_id = 70;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 10 WHERE exhibitor_id = 70;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 70;
DELETE FROM booth_visits WHERE exhibitor_id = 70;
DELETE FROM exhibitors WHERE id = 70 AND company_name = 'NoBroker Technologies Solutions Private Limited' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 70) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 70 AND status = 'confirmed' AND released_at IS NULL);

-- 71 NoBroker Technologies Solutions Private Limited -> 10 NoBroker Technologies Solutions Private Limited
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 71)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 71))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 71)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 71));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 10, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 10), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 71 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 10) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 71) WHERE id = 10 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 71);
UPDATE exhibitor_team SET exhibitor_id = 10, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 71;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 10 WHERE exhibitor_id = 71;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 10 WHERE exhibitor_id = 71;
UPDATE mp_companies SET exhibitor_id = 10 WHERE exhibitor_id = 71;
UPDATE mp_listings SET exhibitor_id = 10 WHERE exhibitor_id = 71;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 10 WHERE exhibitor_id = 71;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 71;
DELETE FROM booth_visits WHERE exhibitor_id = 71;
DELETE FROM exhibitors WHERE id = 71 AND company_name = 'NoBroker Technologies Solutions Private Limited' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 71) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 71 AND status = 'confirmed' AND released_at IS NULL);

-- 72 NoBroker Technologies Solutions Private Limited -> 10 NoBroker Technologies Solutions Private Limited
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 72)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 72))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 72)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 72));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 10, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 10), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 72 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 10) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 72) WHERE id = 10 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 72);
UPDATE exhibitor_team SET exhibitor_id = 10, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 72;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 10 WHERE exhibitor_id = 72;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 10 WHERE exhibitor_id = 72;
UPDATE mp_companies SET exhibitor_id = 10 WHERE exhibitor_id = 72;
UPDATE mp_listings SET exhibitor_id = 10 WHERE exhibitor_id = 72;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 10 WHERE exhibitor_id = 72;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 72;
DELETE FROM booth_visits WHERE exhibitor_id = 72;
DELETE FROM exhibitors WHERE id = 72 AND company_name = 'NoBroker Technologies Solutions Private Limited' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 72) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 72 AND status = 'confirmed' AND released_at IS NULL);

-- 73 KaDeep Technologies -> 26 kadeep.ai
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 73)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 73))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 73)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 73));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 26, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 26), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 73 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 26) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 73) WHERE id = 26 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 73);
UPDATE exhibitor_team SET exhibitor_id = 26, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 73;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 26 WHERE exhibitor_id = 73;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 26 WHERE exhibitor_id = 73;
UPDATE mp_companies SET exhibitor_id = 26 WHERE exhibitor_id = 73;
UPDATE mp_listings SET exhibitor_id = 26 WHERE exhibitor_id = 73;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 26 WHERE exhibitor_id = 73;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 73;
DELETE FROM booth_visits WHERE exhibitor_id = 73;
DELETE FROM exhibitors WHERE id = 73 AND company_name = 'KaDeep Technologies' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 73) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 73 AND status = 'confirmed' AND released_at IS NULL);

-- 74 Arysoft Global Pvt Ltd -> 31 ary-soft
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 74)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 74))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 74)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 74));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 31, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 31), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 74 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 31) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 74) WHERE id = 31 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 74);
UPDATE exhibitor_team SET exhibitor_id = 31, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 74;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 31 WHERE exhibitor_id = 74;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 31 WHERE exhibitor_id = 74;
UPDATE mp_companies SET exhibitor_id = 31 WHERE exhibitor_id = 74;
UPDATE mp_listings SET exhibitor_id = 31 WHERE exhibitor_id = 74;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 31 WHERE exhibitor_id = 74;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 74;
DELETE FROM booth_visits WHERE exhibitor_id = 74;
DELETE FROM exhibitors WHERE id = 74 AND company_name = 'Arysoft Global Pvt Ltd' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 74) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 74 AND status = 'confirmed' AND released_at IS NULL);

-- 75 Oranje -> 14 ORANJE AI PRIVATE LIMITED
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 75)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 75))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 75)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 75));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 14, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 14), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 75 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 14) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 75) WHERE id = 14 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 75);
UPDATE exhibitor_team SET exhibitor_id = 14, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 75;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 14 WHERE exhibitor_id = 75;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 14 WHERE exhibitor_id = 75;
UPDATE mp_companies SET exhibitor_id = 14 WHERE exhibitor_id = 75;
UPDATE mp_listings SET exhibitor_id = 14 WHERE exhibitor_id = 75;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 14 WHERE exhibitor_id = 75;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 75;
DELETE FROM booth_visits WHERE exhibitor_id = 75;
DELETE FROM exhibitors WHERE id = 75 AND company_name = 'Oranje' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 75) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 75 AND status = 'confirmed' AND released_at IS NULL);

-- 76 Lightmetrics -> 48 LightMetrics
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 76)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 76))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 76)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 76));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 48, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 48), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 76 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 48) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 76) WHERE id = 48 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 76);
UPDATE exhibitor_team SET exhibitor_id = 48, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 76;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 48 WHERE exhibitor_id = 76;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 48 WHERE exhibitor_id = 76;
UPDATE mp_companies SET exhibitor_id = 48 WHERE exhibitor_id = 76;
UPDATE mp_listings SET exhibitor_id = 48 WHERE exhibitor_id = 76;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 48 WHERE exhibitor_id = 76;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 76;
DELETE FROM booth_visits WHERE exhibitor_id = 76;
DELETE FROM exhibitors WHERE id = 76 AND company_name = 'Lightmetrics' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 76) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 76 AND status = 'confirmed' AND released_at IS NULL);

-- 77 Joget.Inc -> 23 Joget INC
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 77)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 77))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 77)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 77));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 23, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 23), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 77 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 23) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 77) WHERE id = 23 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 77);
UPDATE exhibitor_team SET exhibitor_id = 23, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 77;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 23 WHERE exhibitor_id = 77;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 23 WHERE exhibitor_id = 77;
UPDATE mp_companies SET exhibitor_id = 23 WHERE exhibitor_id = 77;
UPDATE mp_listings SET exhibitor_id = 23 WHERE exhibitor_id = 77;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 23 WHERE exhibitor_id = 77;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 77;
DELETE FROM booth_visits WHERE exhibitor_id = 77;
DELETE FROM exhibitors WHERE id = 77 AND company_name = 'Joget.Inc' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 77) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 77 AND status = 'confirmed' AND released_at IS NULL);

-- 78 Joget, Inc. -> 23 Joget INC
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 78)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 78))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 78)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 78));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 23, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 23), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 78 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 23) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 78) WHERE id = 23 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 78);
UPDATE exhibitor_team SET exhibitor_id = 23, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 78;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 23 WHERE exhibitor_id = 78;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 23 WHERE exhibitor_id = 78;
UPDATE mp_companies SET exhibitor_id = 23 WHERE exhibitor_id = 78;
UPDATE mp_listings SET exhibitor_id = 23 WHERE exhibitor_id = 78;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 23 WHERE exhibitor_id = 78;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 78;
DELETE FROM booth_visits WHERE exhibitor_id = 78;
DELETE FROM exhibitors WHERE id = 78 AND company_name = 'Joget, Inc.' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 78) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 78 AND status = 'confirmed' AND released_at IS NULL);

-- 79 LightMetrics -> 48 LightMetrics
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 79)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 79))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 79)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 79));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 48, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 48), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 79 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 48) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 79) WHERE id = 48 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 79);
UPDATE exhibitor_team SET exhibitor_id = 48, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 79;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 48 WHERE exhibitor_id = 79;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 48 WHERE exhibitor_id = 79;
UPDATE mp_companies SET exhibitor_id = 48 WHERE exhibitor_id = 79;
UPDATE mp_listings SET exhibitor_id = 48 WHERE exhibitor_id = 79;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 48 WHERE exhibitor_id = 79;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 79;
DELETE FROM booth_visits WHERE exhibitor_id = 79;
DELETE FROM exhibitors WHERE id = 79 AND company_name = 'LightMetrics' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 79) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 79 AND status = 'confirmed' AND released_at IS NULL);

-- 80 LightMetrics -> 48 LightMetrics
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 80)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 80))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 80)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 80));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 48, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 48), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 80 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 48) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 80) WHERE id = 48 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 80);
UPDATE exhibitor_team SET exhibitor_id = 48, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 80;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 48 WHERE exhibitor_id = 80;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 48 WHERE exhibitor_id = 80;
UPDATE mp_companies SET exhibitor_id = 48 WHERE exhibitor_id = 80;
UPDATE mp_listings SET exhibitor_id = 48 WHERE exhibitor_id = 80;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 48 WHERE exhibitor_id = 80;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 80;
DELETE FROM booth_visits WHERE exhibitor_id = 80;
DELETE FROM exhibitors WHERE id = 80 AND company_name = 'LightMetrics' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 80) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 80 AND status = 'confirmed' AND released_at IS NULL);

-- 81 Joget -> 23 Joget INC
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 81)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 81))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 81)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 81));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 23, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 23), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 81 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 23) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 81) WHERE id = 23 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 81);
UPDATE exhibitor_team SET exhibitor_id = 23, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 81;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 23 WHERE exhibitor_id = 81;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 23 WHERE exhibitor_id = 81;
UPDATE mp_companies SET exhibitor_id = 23 WHERE exhibitor_id = 81;
UPDATE mp_listings SET exhibitor_id = 23 WHERE exhibitor_id = 81;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 23 WHERE exhibitor_id = 81;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 81;
DELETE FROM booth_visits WHERE exhibitor_id = 81;
DELETE FROM exhibitors WHERE id = 81 AND company_name = 'Joget' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 81) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 81 AND status = 'confirmed' AND released_at IS NULL);

-- 82 Joget Inc -> 23 Joget INC
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 82)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 82))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 82)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 82));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 23, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 23), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 82 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 23) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 82) WHERE id = 23 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 82);
UPDATE exhibitor_team SET exhibitor_id = 23, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 82;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 23 WHERE exhibitor_id = 82;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 23 WHERE exhibitor_id = 82;
UPDATE mp_companies SET exhibitor_id = 23 WHERE exhibitor_id = 82;
UPDATE mp_listings SET exhibitor_id = 23 WHERE exhibitor_id = 82;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 23 WHERE exhibitor_id = 82;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 82;
DELETE FROM booth_visits WHERE exhibitor_id = 82;
DELETE FROM exhibitors WHERE id = 82 AND company_name = 'Joget Inc' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 82) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 82 AND status = 'confirmed' AND released_at IS NULL);

-- 83 Algo Analytics -> 6 Algo Analytics
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 83)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 83))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 83)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 83));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 6, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 6), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 83 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 6) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 83) WHERE id = 6 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 83);
UPDATE exhibitor_team SET exhibitor_id = 6, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 83;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 6 WHERE exhibitor_id = 83;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 6 WHERE exhibitor_id = 83;
UPDATE mp_companies SET exhibitor_id = 6 WHERE exhibitor_id = 83;
UPDATE mp_listings SET exhibitor_id = 6 WHERE exhibitor_id = 83;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 6 WHERE exhibitor_id = 83;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 83;
DELETE FROM booth_visits WHERE exhibitor_id = 83;
DELETE FROM exhibitors WHERE id = 83 AND company_name = 'Algo Analytics' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 83) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 83 AND status = 'confirmed' AND released_at IS NULL);

-- 84 Wyn Labs -> 17 Wyn Labs
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 84)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 84))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 84)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 84));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 17, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 17), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 84 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 17) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 84) WHERE id = 17 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 84);
UPDATE exhibitor_team SET exhibitor_id = 17, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 84;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 17 WHERE exhibitor_id = 84;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 17 WHERE exhibitor_id = 84;
UPDATE mp_companies SET exhibitor_id = 17 WHERE exhibitor_id = 84;
UPDATE mp_listings SET exhibitor_id = 17 WHERE exhibitor_id = 84;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 17 WHERE exhibitor_id = 84;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 84;
DELETE FROM booth_visits WHERE exhibitor_id = 84;
DELETE FROM exhibitors WHERE id = 84 AND company_name = 'Wyn Labs' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 84) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 84 AND status = 'confirmed' AND released_at IS NULL);

-- 85 Intangles Lab Pvt Ltd -> 3 Intangles
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 85)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 85))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 85)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 85));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 3, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 3), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 85 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 3) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 85) WHERE id = 3 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 85);
UPDATE exhibitor_team SET exhibitor_id = 3, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 85;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 3 WHERE exhibitor_id = 85;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 3 WHERE exhibitor_id = 85;
UPDATE mp_companies SET exhibitor_id = 3 WHERE exhibitor_id = 85;
UPDATE mp_listings SET exhibitor_id = 3 WHERE exhibitor_id = 85;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 3 WHERE exhibitor_id = 85;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 85;
DELETE FROM booth_visits WHERE exhibitor_id = 85;
DELETE FROM exhibitors WHERE id = 85 AND company_name = 'Intangles Lab Pvt Ltd' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 85) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 85 AND status = 'confirmed' AND released_at IS NULL);

-- 86 Origins AI -> 19 Origin AI
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 86)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 86))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 86)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 86));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 19, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 19), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 86 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 19) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 86) WHERE id = 19 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 86);
UPDATE exhibitor_team SET exhibitor_id = 19, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 86;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 19 WHERE exhibitor_id = 86;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 19 WHERE exhibitor_id = 86;
UPDATE mp_companies SET exhibitor_id = 19 WHERE exhibitor_id = 86;
UPDATE mp_listings SET exhibitor_id = 19 WHERE exhibitor_id = 86;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 19 WHERE exhibitor_id = 86;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 86;
DELETE FROM booth_visits WHERE exhibitor_id = 86;
DELETE FROM exhibitors WHERE id = 86 AND company_name = 'Origins AI ' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 86) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 86 AND status = 'confirmed' AND released_at IS NULL);

-- 87 Intangles Lab Pvt Ltd -> 3 Intangles
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 87)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 87))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 87)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 87));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 3, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 3), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 87 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 3) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 87) WHERE id = 3 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 87);
UPDATE exhibitor_team SET exhibitor_id = 3, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 87;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 3 WHERE exhibitor_id = 87;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 3 WHERE exhibitor_id = 87;
UPDATE mp_companies SET exhibitor_id = 3 WHERE exhibitor_id = 87;
UPDATE mp_listings SET exhibitor_id = 3 WHERE exhibitor_id = 87;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 3 WHERE exhibitor_id = 87;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 87;
DELETE FROM booth_visits WHERE exhibitor_id = 87;
DELETE FROM exhibitors WHERE id = 87 AND company_name = 'Intangles Lab Pvt Ltd' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 87) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 87 AND status = 'confirmed' AND released_at IS NULL);

-- 88 Intangles Lab Pvt Ltd -> 3 Intangles
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 88)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 88))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 88)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 88));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 3, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 3), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 88 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 3) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 88) WHERE id = 3 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 88);
UPDATE exhibitor_team SET exhibitor_id = 3, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 88;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 3 WHERE exhibitor_id = 88;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 3 WHERE exhibitor_id = 88;
UPDATE mp_companies SET exhibitor_id = 3 WHERE exhibitor_id = 88;
UPDATE mp_listings SET exhibitor_id = 3 WHERE exhibitor_id = 88;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 3 WHERE exhibitor_id = 88;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 88;
DELETE FROM booth_visits WHERE exhibitor_id = 88;
DELETE FROM exhibitors WHERE id = 88 AND company_name = 'Intangles Lab Pvt Ltd' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 88) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 88 AND status = 'confirmed' AND released_at IS NULL);

-- 89 Intangles Lab Pvt Ltd -> 3 Intangles
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 89)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 89))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 89)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 89));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 3, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 3), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 89 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 3) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 89) WHERE id = 3 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 89);
UPDATE exhibitor_team SET exhibitor_id = 3, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 89;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 3 WHERE exhibitor_id = 89;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 3 WHERE exhibitor_id = 89;
UPDATE mp_companies SET exhibitor_id = 3 WHERE exhibitor_id = 89;
UPDATE mp_listings SET exhibitor_id = 3 WHERE exhibitor_id = 89;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 3 WHERE exhibitor_id = 89;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 89;
DELETE FROM booth_visits WHERE exhibitor_id = 89;
DELETE FROM exhibitors WHERE id = 89 AND company_name = 'Intangles Lab Pvt Ltd' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 89) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 89 AND status = 'confirmed' AND released_at IS NULL);

-- 90 DysosphereAI -> 43 Dysosphere
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 90)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 90))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 90)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 90));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 43, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 43), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 90 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 43) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 90) WHERE id = 43 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 90);
UPDATE exhibitor_team SET exhibitor_id = 43, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 90;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 43 WHERE exhibitor_id = 90;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 43 WHERE exhibitor_id = 90;
UPDATE mp_companies SET exhibitor_id = 43 WHERE exhibitor_id = 90;
UPDATE mp_listings SET exhibitor_id = 43 WHERE exhibitor_id = 90;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 43 WHERE exhibitor_id = 90;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 90;
DELETE FROM booth_visits WHERE exhibitor_id = 90;
DELETE FROM exhibitors WHERE id = 90 AND company_name = 'DysosphereAI' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 90) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 90 AND status = 'confirmed' AND released_at IS NULL);

-- 91 DysosphereAI -> 43 Dysosphere
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 91)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 91))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 91)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 91));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 43, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 43), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 91 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 43) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 91) WHERE id = 43 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 91);
UPDATE exhibitor_team SET exhibitor_id = 43, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 91;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 43 WHERE exhibitor_id = 91;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 43 WHERE exhibitor_id = 91;
UPDATE mp_companies SET exhibitor_id = 43 WHERE exhibitor_id = 91;
UPDATE mp_listings SET exhibitor_id = 43 WHERE exhibitor_id = 91;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 43 WHERE exhibitor_id = 91;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 91;
DELETE FROM booth_visits WHERE exhibitor_id = 91;
DELETE FROM exhibitors WHERE id = 91 AND company_name = 'DysosphereAI' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 91) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 91 AND status = 'confirmed' AND released_at IS NULL);

-- 92 DysosphereAI -> 43 Dysosphere
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 92)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 92))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 92)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 92));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 43, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 43), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 92 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 43) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 92) WHERE id = 43 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 92);
UPDATE exhibitor_team SET exhibitor_id = 43, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 92;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 43 WHERE exhibitor_id = 92;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 43 WHERE exhibitor_id = 92;
UPDATE mp_companies SET exhibitor_id = 43 WHERE exhibitor_id = 92;
UPDATE mp_listings SET exhibitor_id = 43 WHERE exhibitor_id = 92;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 43 WHERE exhibitor_id = 92;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 92;
DELETE FROM booth_visits WHERE exhibitor_id = 92;
DELETE FROM exhibitors WHERE id = 92 AND company_name = 'DysosphereAI' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 92) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 92 AND status = 'confirmed' AND released_at IS NULL);

-- 93 RedFerns Tech Private Limited -> 29 RedFerns Tech Private Limited
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 93)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 93))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 93)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 93));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 29, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 29), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 93 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 29) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 93) WHERE id = 29 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 93);
UPDATE exhibitor_team SET exhibitor_id = 29, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 93;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 29 WHERE exhibitor_id = 93;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 29 WHERE exhibitor_id = 93;
UPDATE mp_companies SET exhibitor_id = 29 WHERE exhibitor_id = 93;
UPDATE mp_listings SET exhibitor_id = 29 WHERE exhibitor_id = 93;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 29 WHERE exhibitor_id = 93;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 93;
DELETE FROM booth_visits WHERE exhibitor_id = 93;
DELETE FROM exhibitors WHERE id = 93 AND company_name = 'RedFerns Tech Private Limited' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 93) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 93 AND status = 'confirmed' AND released_at IS NULL);

-- 94 RedFerns Tech Private Limited -> 29 RedFerns Tech Private Limited
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 94)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 94))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 94)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 94));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 29, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 29), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 94 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 29) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 94) WHERE id = 29 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 94);
UPDATE exhibitor_team SET exhibitor_id = 29, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 94;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 29 WHERE exhibitor_id = 94;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 29 WHERE exhibitor_id = 94;
UPDATE mp_companies SET exhibitor_id = 29 WHERE exhibitor_id = 94;
UPDATE mp_listings SET exhibitor_id = 29 WHERE exhibitor_id = 94;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 29 WHERE exhibitor_id = 94;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 94;
DELETE FROM booth_visits WHERE exhibitor_id = 94;
DELETE FROM exhibitors WHERE id = 94 AND company_name = 'RedFerns Tech Private Limited' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 94) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 94 AND status = 'confirmed' AND released_at IS NULL);

-- 97 Evoke Technologies -> 27 Evoke Technologies
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 97)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 97))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 97)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 97));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 27, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 27), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 97 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 27) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 97) WHERE id = 27 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 97);
UPDATE exhibitor_team SET exhibitor_id = 27, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 97;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 27 WHERE exhibitor_id = 97;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 27 WHERE exhibitor_id = 97;
UPDATE mp_companies SET exhibitor_id = 27 WHERE exhibitor_id = 97;
UPDATE mp_listings SET exhibitor_id = 27 WHERE exhibitor_id = 97;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 27 WHERE exhibitor_id = 97;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 97;
DELETE FROM booth_visits WHERE exhibitor_id = 97;
DELETE FROM exhibitors WHERE id = 97 AND company_name = 'Evoke Technologies' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 97) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 97 AND status = 'confirmed' AND released_at IS NULL);

-- 98 Evoke Technologies -> 27 Evoke Technologies
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 98)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 98))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 98)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 98));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 27, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 27), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 98 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 27) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 98) WHERE id = 27 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 98);
UPDATE exhibitor_team SET exhibitor_id = 27, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 98;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 27 WHERE exhibitor_id = 98;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 27 WHERE exhibitor_id = 98;
UPDATE mp_companies SET exhibitor_id = 27 WHERE exhibitor_id = 98;
UPDATE mp_listings SET exhibitor_id = 27 WHERE exhibitor_id = 98;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 27 WHERE exhibitor_id = 98;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 98;
DELETE FROM booth_visits WHERE exhibitor_id = 98;
DELETE FROM exhibitors WHERE id = 98 AND company_name = 'Evoke Technologies' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 98) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 98 AND status = 'confirmed' AND released_at IS NULL);

-- 99 FTA GLOBAL -> 44 FTA Global
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 99)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 99))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 99)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 99));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 44, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 44), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 99 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 44) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 99) WHERE id = 44 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 99);
UPDATE exhibitor_team SET exhibitor_id = 44, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 99;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 44 WHERE exhibitor_id = 99;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 44 WHERE exhibitor_id = 99;
UPDATE mp_companies SET exhibitor_id = 44 WHERE exhibitor_id = 99;
UPDATE mp_listings SET exhibitor_id = 44 WHERE exhibitor_id = 99;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 44 WHERE exhibitor_id = 99;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 99;
DELETE FROM booth_visits WHERE exhibitor_id = 99;
DELETE FROM exhibitors WHERE id = 99 AND company_name = 'FTA GLOBAL' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 99) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 99 AND status = 'confirmed' AND released_at IS NULL);

-- 100 FTA GLOBAL -> 44 FTA Global
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 100)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 100))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 100)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 100));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 44, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 44), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 100 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 44) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 100) WHERE id = 44 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 100);
UPDATE exhibitor_team SET exhibitor_id = 44, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 100;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 44 WHERE exhibitor_id = 100;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 44 WHERE exhibitor_id = 100;
UPDATE mp_companies SET exhibitor_id = 44 WHERE exhibitor_id = 100;
UPDATE mp_listings SET exhibitor_id = 44 WHERE exhibitor_id = 100;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 44 WHERE exhibitor_id = 100;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 100;
DELETE FROM booth_visits WHERE exhibitor_id = 100;
DELETE FROM exhibitors WHERE id = 100 AND company_name = 'FTA GLOBAL' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 100) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 100 AND status = 'confirmed' AND released_at IS NULL);

-- 103 FTA GLOBAL -> 44 FTA Global
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 103)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 103))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 103)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 103));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 44, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 44), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 103 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 44) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 103) WHERE id = 44 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 103);
UPDATE exhibitor_team SET exhibitor_id = 44, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 103;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 44 WHERE exhibitor_id = 103;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 44 WHERE exhibitor_id = 103;
UPDATE mp_companies SET exhibitor_id = 44 WHERE exhibitor_id = 103;
UPDATE mp_listings SET exhibitor_id = 44 WHERE exhibitor_id = 103;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 44 WHERE exhibitor_id = 103;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 103;
DELETE FROM booth_visits WHERE exhibitor_id = 103;
DELETE FROM exhibitors WHERE id = 103 AND company_name = 'FTA GLOBAL' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 103) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 103 AND status = 'confirmed' AND released_at IS NULL);

-- 104 Jade Global -> 35 Jade Global
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 104)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 104))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 104)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 104));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 35, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 35), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 104 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 35) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 104) WHERE id = 35 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 104);
UPDATE exhibitor_team SET exhibitor_id = 35, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 104;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 35 WHERE exhibitor_id = 104;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 35 WHERE exhibitor_id = 104;
UPDATE mp_companies SET exhibitor_id = 35 WHERE exhibitor_id = 104;
UPDATE mp_listings SET exhibitor_id = 35 WHERE exhibitor_id = 104;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 35 WHERE exhibitor_id = 104;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 104;
DELETE FROM booth_visits WHERE exhibitor_id = 104;
DELETE FROM exhibitors WHERE id = 104 AND company_name = 'Jade Global' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 104) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 104 AND status = 'confirmed' AND released_at IS NULL);

-- 105 Jade Global -> 35 Jade Global
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 105)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 105))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 105)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 105));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 35, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 35), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 105 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 35) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 105) WHERE id = 35 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 105);
UPDATE exhibitor_team SET exhibitor_id = 35, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 105;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 35 WHERE exhibitor_id = 105;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 35 WHERE exhibitor_id = 105;
UPDATE mp_companies SET exhibitor_id = 35 WHERE exhibitor_id = 105;
UPDATE mp_listings SET exhibitor_id = 35 WHERE exhibitor_id = 105;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 35 WHERE exhibitor_id = 105;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 105;
DELETE FROM booth_visits WHERE exhibitor_id = 105;
DELETE FROM exhibitors WHERE id = 105 AND company_name = 'Jade Global' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 105) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 105 AND status = 'confirmed' AND released_at IS NULL);

-- 111 Ministry of Tribal Affairs -> 24 Ministry of Tribal Affairs
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 111)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 111))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 111)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 111));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 24, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 24), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 111 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 24) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 111) WHERE id = 24 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 111);
UPDATE exhibitor_team SET exhibitor_id = 24, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 111;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 24 WHERE exhibitor_id = 111;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 24 WHERE exhibitor_id = 111;
UPDATE mp_companies SET exhibitor_id = 24 WHERE exhibitor_id = 111;
UPDATE mp_listings SET exhibitor_id = 24 WHERE exhibitor_id = 111;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 24 WHERE exhibitor_id = 111;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 111;
DELETE FROM booth_visits WHERE exhibitor_id = 111;
DELETE FROM exhibitors WHERE id = 111 AND company_name = 'Ministry of Tribal Affairs' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 111) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 111 AND status = 'confirmed' AND released_at IS NULL);

-- 115 Image Infosystem -> 4 Image Infosystem
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 115)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 115))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 115)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 115));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 4, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 4), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 115 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 4) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 115) WHERE id = 4 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 115);
UPDATE exhibitor_team SET exhibitor_id = 4, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 115;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 4 WHERE exhibitor_id = 115;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 4 WHERE exhibitor_id = 115;
UPDATE mp_companies SET exhibitor_id = 4 WHERE exhibitor_id = 115;
UPDATE mp_listings SET exhibitor_id = 4 WHERE exhibitor_id = 115;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 4 WHERE exhibitor_id = 115;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 115;
DELETE FROM booth_visits WHERE exhibitor_id = 115;
DELETE FROM exhibitors WHERE id = 115 AND company_name = 'Image Infosystem' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 115) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 115 AND status = 'confirmed' AND released_at IS NULL);

-- 116 Image Infosystem -> 4 Image Infosystem
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 116)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 116))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 116)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 116));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 4, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 4), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 116 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 4) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 116) WHERE id = 4 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 116);
UPDATE exhibitor_team SET exhibitor_id = 4, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 116;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 4 WHERE exhibitor_id = 116;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 4 WHERE exhibitor_id = 116;
UPDATE mp_companies SET exhibitor_id = 4 WHERE exhibitor_id = 116;
UPDATE mp_listings SET exhibitor_id = 4 WHERE exhibitor_id = 116;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 4 WHERE exhibitor_id = 116;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 116;
DELETE FROM booth_visits WHERE exhibitor_id = 116;
DELETE FROM exhibitors WHERE id = 116 AND company_name = 'Image Infosystem' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 116) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 116 AND status = 'confirmed' AND released_at IS NULL);

-- 117 Image Infosystems -> 4 Image Infosystem
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 117)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 117))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 117)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 117));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 4, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 4), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 117 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 4) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 117) WHERE id = 4 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 117);
UPDATE exhibitor_team SET exhibitor_id = 4, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 117;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 4 WHERE exhibitor_id = 117;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 4 WHERE exhibitor_id = 117;
UPDATE mp_companies SET exhibitor_id = 4 WHERE exhibitor_id = 117;
UPDATE mp_listings SET exhibitor_id = 4 WHERE exhibitor_id = 117;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 4 WHERE exhibitor_id = 117;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 117;
DELETE FROM booth_visits WHERE exhibitor_id = 117;
DELETE FROM exhibitors WHERE id = 117 AND company_name = 'Image Infosystems' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 117) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 117 AND status = 'confirmed' AND released_at IS NULL);

-- 120 Image Infosystems -> 4 Image Infosystem
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 120)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 120))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 120)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 120));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 4, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 4), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 120 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 4) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 120) WHERE id = 4 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 120);
UPDATE exhibitor_team SET exhibitor_id = 4, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 120;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 4 WHERE exhibitor_id = 120;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 4 WHERE exhibitor_id = 120;
UPDATE mp_companies SET exhibitor_id = 4 WHERE exhibitor_id = 120;
UPDATE mp_listings SET exhibitor_id = 4 WHERE exhibitor_id = 120;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 4 WHERE exhibitor_id = 120;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 120;
DELETE FROM booth_visits WHERE exhibitor_id = 120;
DELETE FROM exhibitors WHERE id = 120 AND company_name = 'Image Infosystems' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 120) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 120 AND status = 'confirmed' AND released_at IS NULL);

-- 121 Image Infosystems -> 4 Image Infosystem
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 121)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 121))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 121)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 121));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 4, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 4), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 121 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 4) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 121) WHERE id = 4 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 121);
UPDATE exhibitor_team SET exhibitor_id = 4, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 121;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 4 WHERE exhibitor_id = 121;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 4 WHERE exhibitor_id = 121;
UPDATE mp_companies SET exhibitor_id = 4 WHERE exhibitor_id = 121;
UPDATE mp_listings SET exhibitor_id = 4 WHERE exhibitor_id = 121;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 4 WHERE exhibitor_id = 121;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 121;
DELETE FROM booth_visits WHERE exhibitor_id = 121;
DELETE FROM exhibitors WHERE id = 121 AND company_name = 'Image Infosystems' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 121) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 121 AND status = 'confirmed' AND released_at IS NULL);

-- 122 Image Infosystems -> 4 Image Infosystem
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 122)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 122))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 122)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 122));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 4, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 4), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 122 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 4) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 122) WHERE id = 4 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 122);
UPDATE exhibitor_team SET exhibitor_id = 4, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 122;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 4 WHERE exhibitor_id = 122;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 4 WHERE exhibitor_id = 122;
UPDATE mp_companies SET exhibitor_id = 4 WHERE exhibitor_id = 122;
UPDATE mp_listings SET exhibitor_id = 4 WHERE exhibitor_id = 122;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 4 WHERE exhibitor_id = 122;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 122;
DELETE FROM booth_visits WHERE exhibitor_id = 122;
DELETE FROM exhibitors WHERE id = 122 AND company_name = 'Image Infosystems' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 122) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 122 AND status = 'confirmed' AND released_at IS NULL);

-- 123 CGI -> 5 CGI
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 123)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 123))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 123)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 123));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 5, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 5), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 123 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 5) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 123) WHERE id = 5 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 123);
UPDATE exhibitor_team SET exhibitor_id = 5, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 123;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 5 WHERE exhibitor_id = 123;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 5 WHERE exhibitor_id = 123;
UPDATE mp_companies SET exhibitor_id = 5 WHERE exhibitor_id = 123;
UPDATE mp_listings SET exhibitor_id = 5 WHERE exhibitor_id = 123;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 5 WHERE exhibitor_id = 123;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 123;
DELETE FROM booth_visits WHERE exhibitor_id = 123;
DELETE FROM exhibitors WHERE id = 123 AND company_name = 'CGI' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 123) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 123 AND status = 'confirmed' AND released_at IS NULL);

-- 124 CGI -> 5 CGI
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 124)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 124))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 124)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 124));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 5, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 5), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 124 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 5) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 124) WHERE id = 5 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 124);
UPDATE exhibitor_team SET exhibitor_id = 5, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 124;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 5 WHERE exhibitor_id = 124;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 5 WHERE exhibitor_id = 124;
UPDATE mp_companies SET exhibitor_id = 5 WHERE exhibitor_id = 124;
UPDATE mp_listings SET exhibitor_id = 5 WHERE exhibitor_id = 124;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 5 WHERE exhibitor_id = 124;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 124;
DELETE FROM booth_visits WHERE exhibitor_id = 124;
DELETE FROM exhibitors WHERE id = 124 AND company_name = 'CGI' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 124) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 124 AND status = 'confirmed' AND released_at IS NULL);

-- 125 CGI -> 5 CGI
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 125)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 125))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 125)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 125));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 5, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 5), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 125 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 5) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 125) WHERE id = 5 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 125);
UPDATE exhibitor_team SET exhibitor_id = 5, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 125;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 5 WHERE exhibitor_id = 125;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 5 WHERE exhibitor_id = 125;
UPDATE mp_companies SET exhibitor_id = 5 WHERE exhibitor_id = 125;
UPDATE mp_listings SET exhibitor_id = 5 WHERE exhibitor_id = 125;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 5 WHERE exhibitor_id = 125;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 125;
DELETE FROM booth_visits WHERE exhibitor_id = 125;
DELETE FROM exhibitors WHERE id = 125 AND company_name = 'CGI' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 125) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 125 AND status = 'confirmed' AND released_at IS NULL);

-- 126 CGI -> 5 CGI
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 126)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 126))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 126)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 126));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 5, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 5), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 126 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 5) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 126) WHERE id = 5 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 126);
UPDATE exhibitor_team SET exhibitor_id = 5, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 126;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 5 WHERE exhibitor_id = 126;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 5 WHERE exhibitor_id = 126;
UPDATE mp_companies SET exhibitor_id = 5 WHERE exhibitor_id = 126;
UPDATE mp_listings SET exhibitor_id = 5 WHERE exhibitor_id = 126;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 5 WHERE exhibitor_id = 126;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 126;
DELETE FROM booth_visits WHERE exhibitor_id = 126;
DELETE FROM exhibitors WHERE id = 126 AND company_name = 'CGI' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 126) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 126 AND status = 'confirmed' AND released_at IS NULL);

-- 127 CGI -> 5 CGI
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 127)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 127))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 127)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 127));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 5, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 5), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 127 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 5) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 127) WHERE id = 5 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 127);
UPDATE exhibitor_team SET exhibitor_id = 5, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 127;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 5 WHERE exhibitor_id = 127;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 5 WHERE exhibitor_id = 127;
UPDATE mp_companies SET exhibitor_id = 5 WHERE exhibitor_id = 127;
UPDATE mp_listings SET exhibitor_id = 5 WHERE exhibitor_id = 127;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 5 WHERE exhibitor_id = 127;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 127;
DELETE FROM booth_visits WHERE exhibitor_id = 127;
DELETE FROM exhibitors WHERE id = 127 AND company_name = 'CGI' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 127) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 127 AND status = 'confirmed' AND released_at IS NULL);

-- 128 CGI -> 5 CGI
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 128)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 128))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 128)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 128));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 5, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 5), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 128 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 5) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 128) WHERE id = 5 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 128);
UPDATE exhibitor_team SET exhibitor_id = 5, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 128;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 5 WHERE exhibitor_id = 128;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 5 WHERE exhibitor_id = 128;
UPDATE mp_companies SET exhibitor_id = 5 WHERE exhibitor_id = 128;
UPDATE mp_listings SET exhibitor_id = 5 WHERE exhibitor_id = 128;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 5 WHERE exhibitor_id = 128;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 128;
DELETE FROM booth_visits WHERE exhibitor_id = 128;
DELETE FROM exhibitors WHERE id = 128 AND company_name = 'CGI' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 128) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 128 AND status = 'confirmed' AND released_at IS NULL);

-- 129 CGI -> 5 CGI
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 129)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 129))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 129)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 129));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 5, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 5), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 129 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 5) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 129) WHERE id = 5 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 129);
UPDATE exhibitor_team SET exhibitor_id = 5, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 129;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 5 WHERE exhibitor_id = 129;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 5 WHERE exhibitor_id = 129;
UPDATE mp_companies SET exhibitor_id = 5 WHERE exhibitor_id = 129;
UPDATE mp_listings SET exhibitor_id = 5 WHERE exhibitor_id = 129;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 5 WHERE exhibitor_id = 129;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 129;
DELETE FROM booth_visits WHERE exhibitor_id = 129;
DELETE FROM exhibitors WHERE id = 129 AND company_name = 'CGI' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 129) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 129 AND status = 'confirmed' AND released_at IS NULL);

-- 130 COSMICA TELEMATICS PRIVATE LIMITED -> 8 COSMICA TELEMATICS PRIVATE LIMITED
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 130)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 130))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 130)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 130));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 8, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 8), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 130 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 8) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 130) WHERE id = 8 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 130);
UPDATE exhibitor_team SET exhibitor_id = 8, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 130;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 8 WHERE exhibitor_id = 130;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 8 WHERE exhibitor_id = 130;
UPDATE mp_companies SET exhibitor_id = 8 WHERE exhibitor_id = 130;
UPDATE mp_listings SET exhibitor_id = 8 WHERE exhibitor_id = 130;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 8 WHERE exhibitor_id = 130;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 130;
DELETE FROM booth_visits WHERE exhibitor_id = 130;
DELETE FROM exhibitors WHERE id = 130 AND company_name = 'COSMICA TELEMATICS PRIVATE LIMITED' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 130) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 130 AND status = 'confirmed' AND released_at IS NULL);

-- 131 COSMICA TELEMATICS PRIVATE LIMITED -> 8 COSMICA TELEMATICS PRIVATE LIMITED
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 131)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 131))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 131)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 131));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 8, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 8), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 131 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 8) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 131) WHERE id = 8 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 131);
UPDATE exhibitor_team SET exhibitor_id = 8, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 131;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 8 WHERE exhibitor_id = 131;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 8 WHERE exhibitor_id = 131;
UPDATE mp_companies SET exhibitor_id = 8 WHERE exhibitor_id = 131;
UPDATE mp_listings SET exhibitor_id = 8 WHERE exhibitor_id = 131;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 8 WHERE exhibitor_id = 131;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 131;
DELETE FROM booth_visits WHERE exhibitor_id = 131;
DELETE FROM exhibitors WHERE id = 131 AND company_name = 'COSMICA TELEMATICS PRIVATE LIMITED' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 131) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 131 AND status = 'confirmed' AND released_at IS NULL);

-- 132 Harrier Information Systems Pvt. Ltd. -> 25 Harrier Information Systems Pvt. Ltd.
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 132)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 132))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 132)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 132));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 25, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 25), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 132 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 25) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 132) WHERE id = 25 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 132);
UPDATE exhibitor_team SET exhibitor_id = 25, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 132;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 25 WHERE exhibitor_id = 132;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 25 WHERE exhibitor_id = 132;
UPDATE mp_companies SET exhibitor_id = 25 WHERE exhibitor_id = 132;
UPDATE mp_listings SET exhibitor_id = 25 WHERE exhibitor_id = 132;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 25 WHERE exhibitor_id = 132;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 132;
DELETE FROM booth_visits WHERE exhibitor_id = 132;
DELETE FROM exhibitors WHERE id = 132 AND company_name = 'Harrier Information Systems Pvt. Ltd.' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 132) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 132 AND status = 'confirmed' AND released_at IS NULL);

-- 133 Harrier Information Systems Pvt. Ltd. -> 25 Harrier Information Systems Pvt. Ltd.
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 133)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 133))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 133)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 133));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 25, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 25), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 133 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 25) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 133) WHERE id = 25 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 133);
UPDATE exhibitor_team SET exhibitor_id = 25, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 133;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 25 WHERE exhibitor_id = 133;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 25 WHERE exhibitor_id = 133;
UPDATE mp_companies SET exhibitor_id = 25 WHERE exhibitor_id = 133;
UPDATE mp_listings SET exhibitor_id = 25 WHERE exhibitor_id = 133;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 25 WHERE exhibitor_id = 133;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 133;
DELETE FROM booth_visits WHERE exhibitor_id = 133;
DELETE FROM exhibitors WHERE id = 133 AND company_name = 'Harrier Information Systems Pvt. Ltd.' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 133) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 133 AND status = 'confirmed' AND released_at IS NULL);

-- 135 Saranyu Technologies Private Limited -> 11 Saranyu Technologies
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 135)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 135))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 135)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 135));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 11, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 11), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 135 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 11) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 135) WHERE id = 11 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 135);
UPDATE exhibitor_team SET exhibitor_id = 11, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 135;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 11 WHERE exhibitor_id = 135;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 11 WHERE exhibitor_id = 135;
UPDATE mp_companies SET exhibitor_id = 11 WHERE exhibitor_id = 135;
UPDATE mp_listings SET exhibitor_id = 11 WHERE exhibitor_id = 135;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 11 WHERE exhibitor_id = 135;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 135;
DELETE FROM booth_visits WHERE exhibitor_id = 135;
DELETE FROM exhibitors WHERE id = 135 AND company_name = 'Saranyu Technologies Private Limited ' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 135) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 135 AND status = 'confirmed' AND released_at IS NULL);

-- 136 Saranyu Technologies Private Limited -> 11 Saranyu Technologies
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 136)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 136))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 136)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 136));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 11, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 11), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 136 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 11) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 136) WHERE id = 11 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 136);
UPDATE exhibitor_team SET exhibitor_id = 11, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 136;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 11 WHERE exhibitor_id = 136;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 11 WHERE exhibitor_id = 136;
UPDATE mp_companies SET exhibitor_id = 11 WHERE exhibitor_id = 136;
UPDATE mp_listings SET exhibitor_id = 11 WHERE exhibitor_id = 136;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 11 WHERE exhibitor_id = 136;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 136;
DELETE FROM booth_visits WHERE exhibitor_id = 136;
DELETE FROM exhibitors WHERE id = 136 AND company_name = 'Saranyu Technologies Private Limited' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 136) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 136 AND status = 'confirmed' AND released_at IS NULL);

-- 145 Saranyu Technologies Private Limited -> 11 Saranyu Technologies
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 145)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 145))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 145)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 145));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 11, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 11), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 145 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 11) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 145) WHERE id = 11 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 145);
UPDATE exhibitor_team SET exhibitor_id = 11, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 145;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 11 WHERE exhibitor_id = 145;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 11 WHERE exhibitor_id = 145;
UPDATE mp_companies SET exhibitor_id = 11 WHERE exhibitor_id = 145;
UPDATE mp_listings SET exhibitor_id = 11 WHERE exhibitor_id = 145;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 11 WHERE exhibitor_id = 145;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 145;
DELETE FROM booth_visits WHERE exhibitor_id = 145;
DELETE FROM exhibitors WHERE id = 145 AND company_name = 'Saranyu Technologies Private Limited' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 145) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 145 AND status = 'confirmed' AND released_at IS NULL);

-- 148 Valuenable pvt ltd -> 55 ValuEnable
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 148)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 148))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 148)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 148));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 55, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 55), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 148 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 55) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 148) WHERE id = 55 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 148);
UPDATE exhibitor_team SET exhibitor_id = 55, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 148;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 55 WHERE exhibitor_id = 148;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 55 WHERE exhibitor_id = 148;
UPDATE mp_companies SET exhibitor_id = 55 WHERE exhibitor_id = 148;
UPDATE mp_listings SET exhibitor_id = 55 WHERE exhibitor_id = 148;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 55 WHERE exhibitor_id = 148;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 148;
DELETE FROM booth_visits WHERE exhibitor_id = 148;
DELETE FROM exhibitors WHERE id = 148 AND company_name = 'Valuenable pvt ltd' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 148) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 148 AND status = 'confirmed' AND released_at IS NULL);

-- 149 Kadeep Technologies -> 26 kadeep.ai
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 149)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 149))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 149)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 149));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 26, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 26), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 149 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 26) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 149) WHERE id = 26 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 149);
UPDATE exhibitor_team SET exhibitor_id = 26, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 149;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 26 WHERE exhibitor_id = 149;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 26 WHERE exhibitor_id = 149;
UPDATE mp_companies SET exhibitor_id = 26 WHERE exhibitor_id = 149;
UPDATE mp_listings SET exhibitor_id = 26 WHERE exhibitor_id = 149;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 26 WHERE exhibitor_id = 149;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 149;
DELETE FROM booth_visits WHERE exhibitor_id = 149;
DELETE FROM exhibitors WHERE id = 149 AND company_name = 'Kadeep Technologies' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 149) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 149 AND status = 'confirmed' AND released_at IS NULL);

-- 150 KaDeep AI -> 26 kadeep.ai
UPDATE exhibitor_team SET attendee_id = (SELECT id FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 150)), speaker = CASE WHEN lower((SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 150))) LIKE '%speaker%' THEN 1 ELSE speaker END, pass = CASE WHEN pass = '' THEN (SELECT COALESCE(badge_type, '') FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 150)) ELSE pass END, updated_at = CURRENT_TIMESTAMP
  WHERE event_id = 1 AND attendee_id IS NULL AND email <> '' AND lower(email) = (SELECT lower(trim(email)) FROM (SELECT a.* FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id WHERE e.id = 150));
INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, photo_url, at_booth, speaker, attendee_id, pass, pass_given, added_by)
  SELECT a.event_id, 26, CASE WHEN instr(trim(a.name), ' ') > 0 THEN substr(trim(a.name), 1, instr(trim(a.name), ' ') - 1) ELSE trim(a.name) END, CASE WHEN instr(trim(a.name), ' ') > 0 THEN trim(substr(trim(a.name), instr(trim(a.name), ' ') + 1)) ELSE '' END, COALESCE(a.job_title, ''), (SELECT company_name FROM exhibitors WHERE id = 26), lower(trim(a.email)),
    CASE WHEN a.avatar_url LIKE '/api/uploads/%' OR a.avatar_url LIKE '/images/%' THEN a.avatar_url ELSE '' END, 1,
    CASE WHEN lower(COALESCE(a.badge_type, '')) LIKE '%speaker%' THEN 1 ELSE 0 END, a.id, COALESCE(a.badge_type, ''), '', 'badge'
  FROM attendees a JOIN exhibitors e ON e.attendee_id = a.id
  WHERE e.id = 150 AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 26) AND trim(COALESCE(a.email, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM exhibitor_team t WHERE t.event_id = a.event_id AND (t.attendee_id = a.id OR lower(t.email) = lower(trim(a.email))));
UPDATE exhibitors SET contact_email = (SELECT contact_email FROM exhibitors WHERE id = 150) WHERE id = 26 AND COALESCE(trim(contact_email), '') = '' AND EXISTS (SELECT 1 FROM exhibitors WHERE id = 150);
UPDATE exhibitor_team SET exhibitor_id = 26, updated_at = CURRENT_TIMESTAMP WHERE exhibitor_id = 150;
UPDATE OR IGNORE exhibitor_leads SET exhibitor_id = 26 WHERE exhibitor_id = 150;
UPDATE OR IGNORE booth_visits SET exhibitor_id = 26 WHERE exhibitor_id = 150;
UPDATE mp_companies SET exhibitor_id = 26 WHERE exhibitor_id = 150;
UPDATE mp_listings SET exhibitor_id = 26 WHERE exhibitor_id = 150;
UPDATE OR IGNORE innovation_talks SET exhibitor_id = 26 WHERE exhibitor_id = 150;
DELETE FROM exhibitor_leads WHERE exhibitor_id = 150;
DELETE FROM booth_visits WHERE exhibitor_id = 150;
DELETE FROM exhibitors WHERE id = 150 AND company_name = 'KaDeep AI' AND NOT EXISTS (SELECT 1 FROM exhibitor_team_settings WHERE exhibitor_id = 150) AND NOT EXISTS (SELECT 1 FROM booth_allocations WHERE exhibitor_id = 150 AND status = 'confirmed' AND released_at IS NULL);

-- A team member typed without an email who is now also listed with one: the email-less copy goes.
DELETE FROM exhibitor_team WHERE exhibitor_id = 3 AND email = '' AND EXISTS (SELECT 1 FROM exhibitor_team t2 WHERE t2.exhibitor_id = 3 AND t2.id <> exhibitor_team.id AND t2.email <> '' AND lower(trim(t2.first_name)) = lower(trim(exhibitor_team.first_name)) AND lower(trim(t2.last_name)) = lower(trim(exhibitor_team.last_name)));
DELETE FROM exhibitor_team WHERE exhibitor_id = 4 AND email = '' AND EXISTS (SELECT 1 FROM exhibitor_team t2 WHERE t2.exhibitor_id = 4 AND t2.id <> exhibitor_team.id AND t2.email <> '' AND lower(trim(t2.first_name)) = lower(trim(exhibitor_team.first_name)) AND lower(trim(t2.last_name)) = lower(trim(exhibitor_team.last_name)));
DELETE FROM exhibitor_team WHERE exhibitor_id = 5 AND email = '' AND EXISTS (SELECT 1 FROM exhibitor_team t2 WHERE t2.exhibitor_id = 5 AND t2.id <> exhibitor_team.id AND t2.email <> '' AND lower(trim(t2.first_name)) = lower(trim(exhibitor_team.first_name)) AND lower(trim(t2.last_name)) = lower(trim(exhibitor_team.last_name)));
DELETE FROM exhibitor_team WHERE exhibitor_id = 6 AND email = '' AND EXISTS (SELECT 1 FROM exhibitor_team t2 WHERE t2.exhibitor_id = 6 AND t2.id <> exhibitor_team.id AND t2.email <> '' AND lower(trim(t2.first_name)) = lower(trim(exhibitor_team.first_name)) AND lower(trim(t2.last_name)) = lower(trim(exhibitor_team.last_name)));
DELETE FROM exhibitor_team WHERE exhibitor_id = 8 AND email = '' AND EXISTS (SELECT 1 FROM exhibitor_team t2 WHERE t2.exhibitor_id = 8 AND t2.id <> exhibitor_team.id AND t2.email <> '' AND lower(trim(t2.first_name)) = lower(trim(exhibitor_team.first_name)) AND lower(trim(t2.last_name)) = lower(trim(exhibitor_team.last_name)));
DELETE FROM exhibitor_team WHERE exhibitor_id = 10 AND email = '' AND EXISTS (SELECT 1 FROM exhibitor_team t2 WHERE t2.exhibitor_id = 10 AND t2.id <> exhibitor_team.id AND t2.email <> '' AND lower(trim(t2.first_name)) = lower(trim(exhibitor_team.first_name)) AND lower(trim(t2.last_name)) = lower(trim(exhibitor_team.last_name)));
DELETE FROM exhibitor_team WHERE exhibitor_id = 11 AND email = '' AND EXISTS (SELECT 1 FROM exhibitor_team t2 WHERE t2.exhibitor_id = 11 AND t2.id <> exhibitor_team.id AND t2.email <> '' AND lower(trim(t2.first_name)) = lower(trim(exhibitor_team.first_name)) AND lower(trim(t2.last_name)) = lower(trim(exhibitor_team.last_name)));
DELETE FROM exhibitor_team WHERE exhibitor_id = 14 AND email = '' AND EXISTS (SELECT 1 FROM exhibitor_team t2 WHERE t2.exhibitor_id = 14 AND t2.id <> exhibitor_team.id AND t2.email <> '' AND lower(trim(t2.first_name)) = lower(trim(exhibitor_team.first_name)) AND lower(trim(t2.last_name)) = lower(trim(exhibitor_team.last_name)));
DELETE FROM exhibitor_team WHERE exhibitor_id = 17 AND email = '' AND EXISTS (SELECT 1 FROM exhibitor_team t2 WHERE t2.exhibitor_id = 17 AND t2.id <> exhibitor_team.id AND t2.email <> '' AND lower(trim(t2.first_name)) = lower(trim(exhibitor_team.first_name)) AND lower(trim(t2.last_name)) = lower(trim(exhibitor_team.last_name)));
DELETE FROM exhibitor_team WHERE exhibitor_id = 19 AND email = '' AND EXISTS (SELECT 1 FROM exhibitor_team t2 WHERE t2.exhibitor_id = 19 AND t2.id <> exhibitor_team.id AND t2.email <> '' AND lower(trim(t2.first_name)) = lower(trim(exhibitor_team.first_name)) AND lower(trim(t2.last_name)) = lower(trim(exhibitor_team.last_name)));
DELETE FROM exhibitor_team WHERE exhibitor_id = 23 AND email = '' AND EXISTS (SELECT 1 FROM exhibitor_team t2 WHERE t2.exhibitor_id = 23 AND t2.id <> exhibitor_team.id AND t2.email <> '' AND lower(trim(t2.first_name)) = lower(trim(exhibitor_team.first_name)) AND lower(trim(t2.last_name)) = lower(trim(exhibitor_team.last_name)));
DELETE FROM exhibitor_team WHERE exhibitor_id = 24 AND email = '' AND EXISTS (SELECT 1 FROM exhibitor_team t2 WHERE t2.exhibitor_id = 24 AND t2.id <> exhibitor_team.id AND t2.email <> '' AND lower(trim(t2.first_name)) = lower(trim(exhibitor_team.first_name)) AND lower(trim(t2.last_name)) = lower(trim(exhibitor_team.last_name)));
DELETE FROM exhibitor_team WHERE exhibitor_id = 25 AND email = '' AND EXISTS (SELECT 1 FROM exhibitor_team t2 WHERE t2.exhibitor_id = 25 AND t2.id <> exhibitor_team.id AND t2.email <> '' AND lower(trim(t2.first_name)) = lower(trim(exhibitor_team.first_name)) AND lower(trim(t2.last_name)) = lower(trim(exhibitor_team.last_name)));
DELETE FROM exhibitor_team WHERE exhibitor_id = 26 AND email = '' AND EXISTS (SELECT 1 FROM exhibitor_team t2 WHERE t2.exhibitor_id = 26 AND t2.id <> exhibitor_team.id AND t2.email <> '' AND lower(trim(t2.first_name)) = lower(trim(exhibitor_team.first_name)) AND lower(trim(t2.last_name)) = lower(trim(exhibitor_team.last_name)));
DELETE FROM exhibitor_team WHERE exhibitor_id = 27 AND email = '' AND EXISTS (SELECT 1 FROM exhibitor_team t2 WHERE t2.exhibitor_id = 27 AND t2.id <> exhibitor_team.id AND t2.email <> '' AND lower(trim(t2.first_name)) = lower(trim(exhibitor_team.first_name)) AND lower(trim(t2.last_name)) = lower(trim(exhibitor_team.last_name)));
DELETE FROM exhibitor_team WHERE exhibitor_id = 29 AND email = '' AND EXISTS (SELECT 1 FROM exhibitor_team t2 WHERE t2.exhibitor_id = 29 AND t2.id <> exhibitor_team.id AND t2.email <> '' AND lower(trim(t2.first_name)) = lower(trim(exhibitor_team.first_name)) AND lower(trim(t2.last_name)) = lower(trim(exhibitor_team.last_name)));
DELETE FROM exhibitor_team WHERE exhibitor_id = 31 AND email = '' AND EXISTS (SELECT 1 FROM exhibitor_team t2 WHERE t2.exhibitor_id = 31 AND t2.id <> exhibitor_team.id AND t2.email <> '' AND lower(trim(t2.first_name)) = lower(trim(exhibitor_team.first_name)) AND lower(trim(t2.last_name)) = lower(trim(exhibitor_team.last_name)));
DELETE FROM exhibitor_team WHERE exhibitor_id = 35 AND email = '' AND EXISTS (SELECT 1 FROM exhibitor_team t2 WHERE t2.exhibitor_id = 35 AND t2.id <> exhibitor_team.id AND t2.email <> '' AND lower(trim(t2.first_name)) = lower(trim(exhibitor_team.first_name)) AND lower(trim(t2.last_name)) = lower(trim(exhibitor_team.last_name)));
DELETE FROM exhibitor_team WHERE exhibitor_id = 41 AND email = '' AND EXISTS (SELECT 1 FROM exhibitor_team t2 WHERE t2.exhibitor_id = 41 AND t2.id <> exhibitor_team.id AND t2.email <> '' AND lower(trim(t2.first_name)) = lower(trim(exhibitor_team.first_name)) AND lower(trim(t2.last_name)) = lower(trim(exhibitor_team.last_name)));
DELETE FROM exhibitor_team WHERE exhibitor_id = 43 AND email = '' AND EXISTS (SELECT 1 FROM exhibitor_team t2 WHERE t2.exhibitor_id = 43 AND t2.id <> exhibitor_team.id AND t2.email <> '' AND lower(trim(t2.first_name)) = lower(trim(exhibitor_team.first_name)) AND lower(trim(t2.last_name)) = lower(trim(exhibitor_team.last_name)));
DELETE FROM exhibitor_team WHERE exhibitor_id = 44 AND email = '' AND EXISTS (SELECT 1 FROM exhibitor_team t2 WHERE t2.exhibitor_id = 44 AND t2.id <> exhibitor_team.id AND t2.email <> '' AND lower(trim(t2.first_name)) = lower(trim(exhibitor_team.first_name)) AND lower(trim(t2.last_name)) = lower(trim(exhibitor_team.last_name)));
DELETE FROM exhibitor_team WHERE exhibitor_id = 48 AND email = '' AND EXISTS (SELECT 1 FROM exhibitor_team t2 WHERE t2.exhibitor_id = 48 AND t2.id <> exhibitor_team.id AND t2.email <> '' AND lower(trim(t2.first_name)) = lower(trim(exhibitor_team.first_name)) AND lower(trim(t2.last_name)) = lower(trim(exhibitor_team.last_name)));
DELETE FROM exhibitor_team WHERE exhibitor_id = 49 AND email = '' AND EXISTS (SELECT 1 FROM exhibitor_team t2 WHERE t2.exhibitor_id = 49 AND t2.id <> exhibitor_team.id AND t2.email <> '' AND lower(trim(t2.first_name)) = lower(trim(exhibitor_team.first_name)) AND lower(trim(t2.last_name)) = lower(trim(exhibitor_team.last_name)));
DELETE FROM exhibitor_team WHERE exhibitor_id = 52 AND email = '' AND EXISTS (SELECT 1 FROM exhibitor_team t2 WHERE t2.exhibitor_id = 52 AND t2.id <> exhibitor_team.id AND t2.email <> '' AND lower(trim(t2.first_name)) = lower(trim(exhibitor_team.first_name)) AND lower(trim(t2.last_name)) = lower(trim(exhibitor_team.last_name)));
DELETE FROM exhibitor_team WHERE exhibitor_id = 53 AND email = '' AND EXISTS (SELECT 1 FROM exhibitor_team t2 WHERE t2.exhibitor_id = 53 AND t2.id <> exhibitor_team.id AND t2.email <> '' AND lower(trim(t2.first_name)) = lower(trim(exhibitor_team.first_name)) AND lower(trim(t2.last_name)) = lower(trim(exhibitor_team.last_name)));
DELETE FROM exhibitor_team WHERE exhibitor_id = 55 AND email = '' AND EXISTS (SELECT 1 FROM exhibitor_team t2 WHERE t2.exhibitor_id = 55 AND t2.id <> exhibitor_team.id AND t2.email <> '' AND lower(trim(t2.first_name)) = lower(trim(exhibitor_team.first_name)) AND lower(trim(t2.last_name)) = lower(trim(exhibitor_team.last_name)));
