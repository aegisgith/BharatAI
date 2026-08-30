-- Two data corrections that cannot be made from code, only from the database.
--
-- 1. EVENT DATES
--    The events row says 2026-06-02 to 2026-06-03 while every public page, the
--    schedule, the passes and the marketing site say 20-21 November 2026. The app
--    derives countdown, "upcoming/live/completed" status and schedule grouping
--    from this row, so the whole app has been reasoning from June.
--    Migration 0013 moved the SESSION dates to November but left the parent event
--    behind, which is how the two came apart.
--
-- 2. SENDER EMAIL
--    app_settings.sender_email holds delegates@bharataiinnovation.com, an address
--    with no mailbox. Elastic Email accepts it because the DOMAIN is verified, so
--    mail leaves but every reply bounces into nothing. register@ is a real mailbox
--    on the Microsoft 365 tenant (MX -> outlook) and is the verified sending
--    domain, so replies land somewhere a human reads.
--
-- Both statements are idempotent and narrowly targeted: re-running changes nothing,
-- and neither touches a row that is already correct.

UPDATE events
   SET start_date = '2026-11-20',
       end_date   = '2026-11-21'
 WHERE id = 1
   AND (start_date <> '2026-11-20' OR end_date <> '2026-11-21');

UPDATE app_settings
   SET value = 'register@bharataiinnovation.com',
       updated_at = CURRENT_TIMESTAMP
 WHERE key = 'sender_email'
   AND value <> 'register@bharataiinnovation.com';

-- If the row was never created, the app falls back to the code default, which is
-- already register@. Insert it only when absent so the admin Settings page shows
-- the real value rather than an empty field.
INSERT INTO app_settings (key, value)
SELECT 'sender_email', 'register@bharataiinnovation.com'
 WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'sender_email');
