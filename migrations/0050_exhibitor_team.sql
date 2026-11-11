-- 0050_exhibitor_team.sql  (written 11 Nov 2026)
--
-- Each exhibitor's team: who is coming, at the booth, on stage for the Innovation
-- Talk & Showcase, or both. The booth contact (SPOC) fills it in from the exhibitor
-- dashboard (/marketplace/dashboard, "Your Team"); passes are issued from it. Until
-- this runs, the dashboard shows no Team screen and the admin Teams screen shows this
-- file's name.
--
-- The SPOC has the dashboard login but gets a pass only by adding themselves.
--
-- IF NOT EXISTS throughout: safe to run twice. Run it with
--   npx wrangler d1 execute bharatai-production --remote --file=./migrations/0050_exhibitor_team.sql
-- then record it (the migrations ledger stops at 0043, see the handbook, section 3):
--   npx wrangler d1 execute bharatai-production --remote --command "INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0050_exhibitor_team.sql')"

CREATE TABLE IF NOT EXISTS exhibitor_team (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id      INTEGER NOT NULL DEFAULT 1,
  exhibitor_id  INTEGER NOT NULL,
  first_name    TEXT    NOT NULL,
  last_name     TEXT    NOT NULL DEFAULT '',
  designation   TEXT    NOT NULL DEFAULT '',
  company       TEXT    NOT NULL DEFAULT '',
  email         TEXT    NOT NULL DEFAULT '',   -- lowercased; empty only on a row imported without one
  mobile        TEXT    NOT NULL DEFAULT '',
  linkedin_url  TEXT    NOT NULL DEFAULT '',
  photo_url     TEXT    NOT NULL DEFAULT '',   -- /api/mp/uploads/<id>, or /images/talks/<slug>.webp from the site
  at_booth      INTEGER NOT NULL DEFAULT 1,
  speaker       INTEGER NOT NULL DEFAULT 0,    -- presents the Innovation Talk & Showcase
  attendee_id   INTEGER,                       -- the attendee row that holds their pass
  pass          TEXT    NOT NULL DEFAULT '',   -- the pass they hold now, as last settled
  pass_given    TEXT    NOT NULL DEFAULT '',   -- the pass this list gave them ('' = they already had one, or none yet)
  pass_note     TEXT    NOT NULL DEFAULT '',   -- why there is no pass yet, in words the exhibitor reads
  pass_photo_url TEXT   NOT NULL DEFAULT '',   -- the pass photo this list set, so a newer team photo may replace it
  added_by      TEXT    NOT NULL DEFAULT '',   -- the account email, 'admin' or 'sheet'
  created_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One person, one team, per event. Rows imported without an email are not held to it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_exhibitor_team_email ON exhibitor_team(event_id, email) WHERE email <> '';
CREATE INDEX IF NOT EXISTS idx_exhibitor_team_exhibitor ON exhibitor_team(exhibitor_id);

-- What the booking sheet knows about an exhibitor that the booth tables may not, and
-- the organisers' exception to its number of passes. The number of passes is, in
-- order: `passes` when the organisers set one; else the confirmed stands' packages
-- (TEAM_PASSES in src/routes/marketplace.ts); else `booth_type` x `booths` from the
-- sheet. A Premium Booth, which the exhibition page does not price, has no number
-- until the organisers set one.
CREATE TABLE IF NOT EXISTS exhibitor_team_settings (
  exhibitor_id  INTEGER PRIMARY KEY,
  passes        INTEGER,                       -- the organisers' exception; NULL = the booth's own number
  booth_type    TEXT    NOT NULL DEFAULT '',   -- floor-plan type_key: pod, explorer, innovator, accelerator, standard, premium, enterprise, mega
  booth_name    TEXT    NOT NULL DEFAULT '',   -- "Explorer Booth", as the email names it
  booth_dim     TEXT    NOT NULL DEFAULT '',   -- "2m x 2m"
  booths        INTEGER NOT NULL DEFAULT 1,    -- how many stands of that type
  contact_name  TEXT    NOT NULL DEFAULT '',   -- the booth contact (SPOC), for "Dear ..."
  updated_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
