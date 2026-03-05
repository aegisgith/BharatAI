-- Add mobile and lunch_inclusion columns to attendees
ALTER TABLE attendees ADD COLUMN mobile TEXT DEFAULT '';
ALTER TABLE attendees ADD COLUMN lunch_inclusion TEXT DEFAULT 'Yes';
