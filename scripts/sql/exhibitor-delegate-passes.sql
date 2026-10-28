-- Every exhibitor is also a delegate (organiser, 24 Sep 2026): the SQL twin of
-- ensureExhibitorDelegate() in src/index.tsx, for every exhibitor at once.
--
-- The code gives the booth contact an event-app pass when the marketplace emails
-- the exhibitor; most exhibitors were imported and never emailed that way, so on
-- 28 Oct 2026 one Exhibitor badge existed against 31 confirmed stands. This gives
-- the pass to every exhibitor that has a CONFIRMED, unreleased stand and a booth
-- email: badge Exhibitor, role Exhibitor, payment waived, lunch Yes, a conference
-- registrant, signing in to /app with the emailed code like everyone else. A free
-- Visitor Pass already on the booth address is raised to Exhibitor; any other pass
-- (a paid Delegate, a Speaker) already networks and is left alone. A held or
-- released stand is not a sale and carries no pass, as in the code.
--
-- Safe to run again: an address that already has a row is skipped, only a Visitor
-- Pass is raised, and exhibitors.attendee_id is set only where it is empty. Two
-- exhibitors on one address get one pass (the earliest exhibitor); OR IGNORE is the
-- belt to that, so one clash cannot abort the file.
--
--   npx wrangler d1 export bharatai-production --remote --output=backup-pre-exhibitor-passes-<date>.sql
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/exhibitor-delegate-passes.sql

INSERT OR IGNORE INTO attendees (event_id, name, email, company, job_title, bio, linkedin_url, role, badge_type,
  lunch_inclusion, country, payment_status, registration_date, main_event, registration_source, is_online)
SELECT e.event_id,
  COALESCE(NULLIF(TRIM(b.contact_name), ''), NULLIF(TRIM(e.company_name), ''), 'Exhibitor'),
  lower(trim(e.contact_email)), COALESCE(e.company_name, ''), '', '', '', 'Exhibitor', 'Exhibitor',
  'Yes', 'India', 'waived', strftime('%Y-%m-%d %H:%M:%S', 'now'), 1, 'exhibitor', 0
FROM exhibitors e
JOIN booth_allocations b ON b.id = (
    SELECT MIN(b2.id) FROM booth_allocations b2
    WHERE b2.exhibitor_id = e.id AND b2.status = 'confirmed' AND b2.released_at IS NULL)
WHERE e.id IN (
    SELECT MIN(e2.id) FROM exhibitors e2
    WHERE TRIM(COALESCE(e2.contact_email, '')) <> ''
    GROUP BY e2.event_id, lower(trim(e2.contact_email)))
  AND NOT EXISTS (SELECT 1 FROM attendees a WHERE a.event_id = e.event_id AND lower(trim(a.email)) = lower(trim(e.contact_email)));

-- A booth contact who registered themselves on the free pass may now start conversations.
UPDATE attendees
   SET badge_type = 'Exhibitor',
       role = CASE WHEN COALESCE(role, '') IN ('', 'attendee') THEN 'Exhibitor' ELSE role END,
       main_event = 1
 WHERE badge_type LIKE '%Visitor%'
   AND EXISTS (
     SELECT 1 FROM exhibitors e
     JOIN booth_allocations b ON b.exhibitor_id = e.id AND b.status = 'confirmed' AND b.released_at IS NULL
     WHERE e.event_id = attendees.event_id
       AND TRIM(COALESCE(e.contact_email, '')) <> ''
       AND lower(trim(e.contact_email)) = lower(trim(attendees.email)));

-- Link each exhibitor to its pass, where the link is still empty.
UPDATE exhibitors
   SET attendee_id = (
     SELECT a.id FROM attendees a
     WHERE a.event_id = exhibitors.event_id AND lower(trim(a.email)) = lower(trim(exhibitors.contact_email))
     ORDER BY a.id LIMIT 1)
 WHERE attendee_id IS NULL
   AND TRIM(COALESCE(contact_email, '')) <> ''
   AND EXISTS (SELECT 1 FROM booth_allocations b WHERE b.exhibitor_id = exhibitors.id AND b.status = 'confirmed' AND b.released_at IS NULL)
   AND EXISTS (SELECT 1 FROM attendees a WHERE a.event_id = exhibitors.event_id AND lower(trim(a.email)) = lower(trim(exhibitors.contact_email)));

-- One line in the audit log for the run, as the code writes one per pass.
INSERT INTO admin_audit (actor, actor_kind, action, entity, detail)
VALUES ('scripts/sql/exhibitor-delegate-passes.sql', 'script', 'attendee.exhibitor-pass.bulk', 'exhibitors',
  'Exhibitor passes for every confirmed stand with a booth email; Visitor Passes on those addresses raised');
