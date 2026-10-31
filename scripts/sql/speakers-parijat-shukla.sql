-- Dr. Parijat Shukla (PhD, Iowa State University), who leads the Automatic Speech
-- Recognition workshop (workshop-asr.sql), is a confirmed speaker (organiser,
-- 31 Oct 2026). Added to the home and conference pages the same day.
--
-- Like every speaker with an email (speaker-delegate-passes.sql), he also gets a
-- pass in the delegate list: badge Speaker, payment waived, lunch, a conference
-- registrant, so he signs in to /app with the emailed code and can network.
--
-- Safe to run again: UNIQUE(event_id, slug) skips the speaker row, the pass is
-- only created when his address has no row, and only a free Visitor Pass on his
-- address is raised (a pass he paid for is left as it is).
--
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/speakers-parijat-shukla.sql

INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, email, is_featured, is_published, sort_order) VALUES
  (1, 'parijat-shukla', 'Dr. Parijat Shukla', 'PhD', 'Iowa State University', 'Automatic Speech Recognition', '/images/speaker-parijat-shukla-sq.webp', 'parijatshukla31@gmail.com', 0, 1, 42);

INSERT INTO attendees (event_id, name, email, company, job_title, role, badge_type,
  lunch_inclusion, country, payment_status, registration_date, main_event, registration_source, is_online)
SELECT 1, 'Dr. Parijat Shukla', 'parijatshukla31@gmail.com', 'Iowa State University', 'PhD', 'Speaker', 'Speaker',
  'Yes', 'India', 'waived', strftime('%Y-%m-%d %H:%M:%S', 'now'), 1, 'speaker', 0
WHERE NOT EXISTS (SELECT 1 FROM attendees WHERE event_id = 1 AND lower(trim(email)) = 'parijatshukla31@gmail.com');

UPDATE attendees
SET badge_type = 'Speaker',
    role = CASE WHEN COALESCE(role, '') IN ('', 'attendee') THEN 'Speaker' ELSE role END,
    lunch_inclusion = 'Yes',
    payment_status = 'waived',
    company = COALESCE(NULLIF(trim(company), ''), 'Iowa State University'),
    job_title = COALESCE(NULLIF(trim(job_title), ''), 'PhD'),
    main_event = 1
WHERE event_id = 1 AND lower(trim(email)) = 'parijatshukla31@gmail.com' AND badge_type LIKE '%Visitor%';
