-- When this attendee was sent the profile-completion reminder.
--
-- The campaign runs to roughly 1,167 people at one email every 90 seconds inside a
-- 9am-9pm IST window, which is about three calendar days of sending. It therefore
-- cannot live in a browser tab's memory: the run has to survive the tab being closed,
-- the laptop sleeping, and the window closing overnight, and it must never mail the
-- same person twice across those restarts.
--
-- NULL means "not yet sent", which is also what every existing row gets, so the first
-- run picks up the whole list. Deliberately separate from notified_at, which belongs
-- to the registration/RSVP campaign - the two are sent for different reasons and one
-- must not suppress the other.

ALTER TABLE attendees ADD COLUMN profile_reminder_sent_at DATETIME;
