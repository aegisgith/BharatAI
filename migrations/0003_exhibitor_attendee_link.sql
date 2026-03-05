-- Add attendee_id to exhibitors table to link exhibitor booths with attendee accounts
ALTER TABLE exhibitors ADD COLUMN attendee_id INTEGER REFERENCES attendees(id);

-- Create index for fast lookup
CREATE INDEX IF NOT EXISTS idx_exhibitors_attendee ON exhibitors(attendee_id);
