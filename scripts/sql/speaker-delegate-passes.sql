-- Speaker = delegate + speaker + networking app (organiser, 24 Sep 2026).
--
-- Gives every published speaker who has an email address an event-app pass under
-- that address: badge Speaker, payment waived, a conference registrant, so they sign
-- in to /app with the emailed code like everyone else and can start conversations
-- (canInitiateNetworking allows every badge but Visitor). The Network tab's speaker
-- cards link to the attendee by email, so delegates can reach them from there.
--
-- Left out on purpose, as the Network tab already leaves them out (14 Sep):
-- ministers, and the two officials in NETWORK_HIDDEN_SPEAKER_SLUGS.
--
-- Safe to run again: a speaker who already has a row is skipped, and only a free
-- Visitor Pass on a speaker's address is raised. Run it after adding emails:
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/speaker-delegate-passes.sql
-- Speakers had no email addresses at all on 24 Sep 2026, so until they are added
-- (UPDATE speakers SET email = '...' WHERE slug = '...') this creates nothing.

INSERT INTO attendees (event_id, name, email, company, job_title, bio, linkedin_url, role, badge_type,
  lunch_inclusion, country, payment_status, registration_date, main_event, registration_source, is_online)
SELECT s.event_id, s.name, lower(trim(s.email)), COALESCE(s.organisation, ''), COALESCE(s.role, ''), COALESCE(s.bio, ''),
  COALESCE(s.linkedin_url, ''), 'Speaker', 'Speaker', 'Yes', 'India', 'waived',
  strftime('%Y-%m-%d %H:%M:%S', 'now'), 1, 'speaker', 0
FROM speakers s
WHERE s.is_published = 1
  AND trim(COALESCE(s.email, '')) <> ''
  AND lower(COALESCE(s.role, '')) NOT LIKE '%minister%'
  AND s.slug NOT IN ('k-k-singh', 'praveen-pardeshi')
  AND NOT EXISTS (SELECT 1 FROM attendees a WHERE a.event_id = s.event_id AND lower(trim(a.email)) = lower(trim(s.email)));

-- A speaker who registered themselves on the free pass may now start conversations.
UPDATE attendees SET badge_type = 'Speaker', role = CASE WHEN COALESCE(role, '') IN ('', 'attendee') THEN 'Speaker' ELSE role END, main_event = 1
WHERE badge_type LIKE '%Visitor%'
  AND lower(trim(email)) IN (
    SELECT lower(trim(s.email)) FROM speakers s
    WHERE s.is_published = 1 AND trim(COALESCE(s.email, '')) <> ''
      AND lower(COALESCE(s.role, '')) NOT LIKE '%minister%' AND s.slug NOT IN ('k-k-singh', 'praveen-pardeshi'));
