-- 0051_leads_and_daily_checkins.sql  (written 11 Nov 2026)
--
-- Two things the event days need.
--
-- 1. exhibitor_leads: a visitor's badge scanned at a booth. Until now the only lead
--    was a visitor tapping "Visit Booth" in the app (booth_visits), which the exhibitor
--    cannot make happen. A scan is made by someone on the exhibitor's team (or its
--    booth contact) and carries their own rating and note. One row per exhibitor and
--    visitor: scanning the same badge again updates it.
--
-- 2. checkins: one row per person per day. attendees.checked_in_at holds one moment,
--    so on the second day everyone admitted on the first read "Already checked in"
--    and day-two arrivals could not be counted. checked_in_at stays as the FIRST
--    arrival (certificates, analytics and exports read it); this table says which days.
--
-- IF NOT EXISTS throughout: safe to run twice. Until it runs, exhibitors have no scan
-- screen and the desk works as it did (one check-in per person). Run it with
--   npx wrangler d1 execute bharatai-production --remote --file=./migrations/0051_leads_and_daily_checkins.sql
-- then record it:
--   npx wrangler d1 execute bharatai-production --remote --command "INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0051_leads_and_daily_checkins.sql')"

CREATE TABLE IF NOT EXISTS exhibitor_leads (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id      INTEGER NOT NULL DEFAULT 1,
  exhibitor_id  INTEGER NOT NULL,
  attendee_id   INTEGER NOT NULL,              -- the visitor whose badge was scanned
  rating        TEXT    NOT NULL DEFAULT '',   -- hot | warm | cold | '' (not rated)
  note          TEXT    NOT NULL DEFAULT '',   -- the exhibitor's own note
  scanned_by    TEXT    NOT NULL DEFAULT '',   -- the team member's name, or the booth contact's email
  created_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (exhibitor_id, attendee_id)
);
CREATE INDEX IF NOT EXISTS idx_exhibitor_leads_exhibitor ON exhibitor_leads(exhibitor_id, created_at);

CREATE TABLE IF NOT EXISTS checkins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id      INTEGER NOT NULL DEFAULT 1,
  attendee_id   INTEGER NOT NULL,
  day           TEXT    NOT NULL,              -- the date in India, '2026-11-20'
  checked_in_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,   -- UTC, like every stamp here
  checked_in_by TEXT    NOT NULL DEFAULT '',   -- the desk account that admitted them
  UNIQUE (attendee_id, day)
);
CREATE INDEX IF NOT EXISTS idx_checkins_day ON checkins(event_id, day);
