-- Migration 0042: marketing consent + unsubscribe, and the two indexes the busiest
-- queries were missing.
--
-- marketing_consent: NULL = never asked, 1 = yes, 0 = no. The LinkedIn lead form
-- asks it outright ("the organizer may use the above information to send
-- communications about their offerings"), and 76 of the first 158 said no. Until
-- now the app had nowhere to keep that answer, so it could not honour it.
--
-- unsubscribed_at: set by the signed /unsubscribe link that every campaign mail
-- now carries in its footer and List-Unsubscribe header. Transactional mail (a
-- sign-in link, a connection request, a panel confirmation) is unaffected: the
-- person asked for those by acting. Campaign audiences exclude both a 0 consent
-- and an unsubscribe.
--
-- Indexes: the networking directory pages by (event_id, name, id) and the unread
-- badge counts messages by (receiver_id, is_read), every 15 seconds, per phone.
-- Neither had an index that matched, so each was a scan and a sort at 5,000 users.

ALTER TABLE attendees ADD COLUMN marketing_consent INTEGER;
ALTER TABLE attendees ADD COLUMN unsubscribed_at DATETIME;

CREATE INDEX IF NOT EXISTS idx_attendees_event_name ON attendees(event_id, name, id);
CREATE INDEX IF NOT EXISTS idx_attendees_unsubscribed ON attendees(unsubscribed_at);
CREATE INDEX IF NOT EXISTS idx_messages_receiver_unread ON messages(receiver_id, is_read);
