-- Migration 0043: will you be there? An RSVP for campus panels.
--
-- A campus panel registration says someone signed up, not that they will come.
-- For the DJ Sanghvi panel (21 Sep 2026) 431 people registered from three
-- places, 157 of them from outside the host college through a LinkedIn form,
-- and the organiser had no way to tell the college how many to expect.
--
-- rsvp_status: NULL = not answered, 'yes' = coming, 'no' = cannot make it.
-- Answered by a signed one-tap link in the reminder email (a confirm page, so an
-- email scanner following links records nothing) or by the buttons on the panel
-- card in the app. Changeable until the panel starts.
--
-- reminder_sent_at / reminder_error: the reminder is pumped from the admin
-- overview like the confirmation; only people who have not answered are mailed,
-- and 'paused:' in reminder_error parks a row until Resume.

ALTER TABLE panel_registrations ADD COLUMN rsvp_status TEXT;
ALTER TABLE panel_registrations ADD COLUMN rsvp_at DATETIME;
ALTER TABLE panel_registrations ADD COLUMN reminder_sent_at DATETIME;
ALTER TABLE panel_registrations ADD COLUMN reminder_error TEXT;
