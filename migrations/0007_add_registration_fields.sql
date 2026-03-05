-- Add registration fields from main website form
ALTER TABLE attendees ADD COLUMN industry TEXT DEFAULT '';
ALTER TABLE attendees ADD COLUMN city TEXT DEFAULT '';
ALTER TABLE attendees ADD COLUMN country TEXT DEFAULT 'India';
ALTER TABLE attendees ADD COLUMN company_size TEXT DEFAULT '';
ALTER TABLE attendees ADD COLUMN special_requirements TEXT DEFAULT '';
ALTER TABLE attendees ADD COLUMN registration_source TEXT DEFAULT 'networking_app';
ALTER TABLE attendees ADD COLUMN pass_type TEXT DEFAULT 'visitor';
