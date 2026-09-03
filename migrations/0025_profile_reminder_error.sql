-- Why the profile reminder could not be delivered to this attendee, if it could not.
--
-- The queue picks the next unstamped attendee, so a send that fails for a reason
-- that will never change - a malformed address such as "riddhia1134@gmail", of which
-- production holds several - would be retried every two minutes until the end of
-- time and nobody behind it would ever be mailed. Such rows are now stamped as done
-- and the reason kept here, so the queue moves on and the admin can see who needs a
-- corrected address. Transient failures (rate limits, outages) stay unstamped and are
-- retried, so this column is only ever written for a problem with the recipient.

ALTER TABLE attendees ADD COLUMN profile_reminder_error TEXT;
