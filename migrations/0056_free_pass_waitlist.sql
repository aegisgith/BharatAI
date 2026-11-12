-- 0056_free_pass_waitlist: the free Visitor Pass waiting list (12 Nov 2026).
--
-- The organiser: free Visitor Passes are full for now. Someone who registers for one
-- after the switch is thrown is still registered (an attendees row, the app, the
-- badge, every upgrade prompt), but is told "You are on the waiting list", has no
-- pass to download and is refused at the desk until the organisers confirm them
-- (Admin -> Attendees -> the Waiting list filter and button). People who registered
-- before the switch keep their pass: their entry_status stays NULL.
--
--   entry_status      'waitlisted' | 'confirmed' | NULL (an ordinary free pass)
--   entry_slot        what the person is told when confirmed ("Day 2, 2 pm to 6 pm"), or NULL
--   entry_decided_at  when an organiser confirmed or waitlisted them by hand
--
-- A paid pass is never on the list: the server reads entry_status only while the
-- person is on a free pass (entryWaitlisted() in src/index.tsx).
--
-- The switch: app_settings.free_pass_waitlist = '1' puts new free registrations on
-- the list; anything else registers them as before. Admin -> Settings -> Free Visitor
-- Pass throws it. It is set ON here, in the organiser's words of 12 Nov 2026.
--
-- Until this runs, the switch does nothing and Admin -> Settings says so. Apply with:
--   npx wrangler d1 execute bharatai-production --remote --file=./migrations/0056_free_pass_waitlist.sql
--   npx wrangler d1 execute bharatai-production --remote --command "INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0056_free_pass_waitlist.sql')"

ALTER TABLE attendees ADD COLUMN entry_status TEXT DEFAULT NULL;
ALTER TABLE attendees ADD COLUMN entry_slot TEXT DEFAULT NULL;
ALTER TABLE attendees ADD COLUMN entry_decided_at DATETIME DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_attendees_entry_status ON attendees(entry_status);
INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES ('free_pass_waitlist', '1', datetime('now'));
