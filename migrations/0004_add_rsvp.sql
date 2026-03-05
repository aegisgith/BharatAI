-- Add RSVP tracking columns
ALTER TABLE attendees ADD COLUMN rsvp_status TEXT DEFAULT NULL;
ALTER TABLE attendees ADD COLUMN rsvp_at DATETIME DEFAULT NULL;
-- rsvp_status: 'confirmed', 'declined', 'maybe', or NULL (no response)
CREATE INDEX IF NOT EXISTS idx_attendees_rsvp ON attendees(rsvp_status);
