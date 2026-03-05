-- Add arrival_time and notified_at fields to attendees table
ALTER TABLE attendees ADD COLUMN arrival_time TEXT; -- e.g. '09:00', '10:30', '12:00'
ALTER TABLE attendees ADD COLUMN notified_at DATETIME; -- timestamp when notification email was sent
