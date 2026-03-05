-- Add engagement tracking columns to attendees table
ALTER TABLE attendees ADD COLUMN last_login_at DATETIME; -- timestamp of last login
ALTER TABLE attendees ADD COLUMN pass_downloaded_at DATETIME; -- timestamp when delegate pass was downloaded
