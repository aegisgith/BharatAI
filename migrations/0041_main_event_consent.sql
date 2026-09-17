-- Migration 0041: a campus-panel registration is not a conference registration.
--
-- Until now anyone who registered for a Campus Series panel - on the panel page
-- or, since 0040, imported from a mUni Campus list - was written as a free
-- Visitor for 20-21 November as well, and told so. The organiser has decided
-- otherwise (17 Sep 2026): they registered for a panel on their own campus, and
-- the conference is a separate question that has to be ASKED, in the email and
-- in the app, and answered by them.
--
-- main_event: 1 = registered for the conference, 0 = not (panel only, or asked
-- and declined). Existing rows default to 1 - they registered for the conference
-- themselves. Everything conference-facing reads it: the pass token, the badge
-- desk, the networking directory and the registration count. Sign-in, the panel
-- card, the claim and the panel certificate do not, so the app looks the same.
--
-- main_event_answered_at: when the person answered, either way. NULL with
-- main_event = 0 means never asked to a conclusion; the app keeps asking once.

ALTER TABLE attendees ADD COLUMN main_event INTEGER NOT NULL DEFAULT 1;
ALTER TABLE attendees ADD COLUMN main_event_answered_at DATETIME;

-- Everyone whose registration came through a campus panel starts as panel-only.
-- A person who registered for the conference on the website first and later
-- joined a panel list keeps their website source, and so keeps main_event = 1.
UPDATE attendees SET main_event = 0 WHERE registration_source LIKE 'campus:%';
