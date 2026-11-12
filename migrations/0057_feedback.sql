-- 0057_feedback.sql  (written 12 Nov 2026)
--
-- The two-minute survey after the event (/feedback, Admin -> After the Event).
-- One row per person: answering again replaces the answers. Until this runs the
-- survey page says it opens shortly and Admin says to apply this file; nothing else
-- changes.
--
-- IF NOT EXISTS throughout: safe to run twice. Run it with
--   npx wrangler d1 execute bharatai-production --remote --file=./migrations/0057_feedback.sql
-- then record it:
--   npx wrangler d1 execute bharatai-production --remote --command "INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0057_feedback.sql')"

CREATE TABLE IF NOT EXISTS feedback (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id     INTEGER NOT NULL DEFAULT 1,
  attendee_id  INTEGER NOT NULL,
  recommend    INTEGER,                        -- 0 to 10: how likely to recommend the event to a colleague
  useful       TEXT    NOT NULL DEFAULT '',    -- comma list: talks, exhibition, people, workshops, innovation_talks, app
  met          TEXT    NOT NULL DEFAULT '',    -- several | one | none: met someone to follow up with
  entry        TEXT    NOT NULL DEFAULT '',    -- good | okay | poor: getting in and finding the way
  delhi        TEXT    NOT NULL DEFAULT '',    -- yes | maybe | no: coming to Delhi 2027
  fix          TEXT    NOT NULL DEFAULT '',    -- the one thing to fix, in their words
  created_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (event_id, attendee_id)
);
CREATE INDEX IF NOT EXISTS idx_feedback_event ON feedback(event_id, updated_at);
