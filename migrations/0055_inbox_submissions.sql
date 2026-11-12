-- 0055_inbox_submissions: what clients send by email, filed for one-click use (12 Nov 2026).
--
-- The team's mailboxes all land in AImailPilot's inbox. Every email there that looks like
-- a logo, a speaker's photo or a list of the people coming to a booth is pushed to
-- POST /api/external/inbox-submissions with its files, and lands here, one row per email,
-- the files in the uploads bucket (attachments: [{key, filename, mime, size, w, h, use}]).
-- matches is what the server worked out: which exhibitor, which talk or speaker, the
-- people it found in the text. applied is what Admin -> Submissions did with it, each
-- entry with the previous value so it can be undone.
--
-- Until this runs, Admin -> Submissions says so, and the external route answers 503.
-- Apply with:
--   npx wrangler d1 execute bharatai-production --remote --file=./migrations/0055_inbox_submissions.sql
--   npx wrangler d1 execute bharatai-production --remote --command "INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0055_inbox_submissions.sql')"

CREATE TABLE IF NOT EXISTS inbox_submissions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id      INTEGER NOT NULL DEFAULT 1,
  source        TEXT    NOT NULL DEFAULT 'aimailpilot',
  source_id     TEXT    NOT NULL,                 -- the email's id on the source; one row per email
  thread_id     TEXT    NOT NULL DEFAULT '',
  from_email    TEXT    NOT NULL DEFAULT '',      -- lowercased
  from_name     TEXT    NOT NULL DEFAULT '',
  to_email      TEXT    NOT NULL DEFAULT '',      -- the team mailbox it arrived in
  subject       TEXT    NOT NULL DEFAULT '',
  body          TEXT    NOT NULL DEFAULT '',      -- plain words, clipped at 20,000 characters
  link          TEXT    NOT NULL DEFAULT '',      -- opens the email on the source
  received_at   TEXT    NOT NULL,                 -- ISO, UTC
  kind          TEXT    NOT NULL DEFAULT 'other', -- logo | photo | team | details | other
  attachments   TEXT    NOT NULL DEFAULT '[]',    -- JSON list, see above
  matches       TEXT    NOT NULL DEFAULT '{}',    -- JSON: exhibitors, talks, speakers, people
  status        TEXT    NOT NULL DEFAULT 'new',   -- new | applied | dismissed
  applied       TEXT    NOT NULL DEFAULT '[]',    -- JSON list of what was done, with prev for undo
  decided_by    TEXT    NOT NULL DEFAULT '',
  decided_at    TEXT,
  created_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source, source_id)
);

-- The screen lists one event's submissions by status, newest first.
CREATE INDEX IF NOT EXISTS idx_inbox_submissions_status ON inbox_submissions(event_id, status, received_at);
