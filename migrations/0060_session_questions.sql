-- 0060_session_questions.sql  (written 12 Nov 2026)
--
-- Questions from the room: asked in the app on a session, voted up by others, read out
-- by the moderator from /live (Admin -> Live Q&A). Until this runs, the app says
-- questions open shortly and nothing else changes.
--
-- IF NOT EXISTS throughout: safe to run twice. Run it with
--   npx wrangler d1 execute bharatai-production --remote --file=./migrations/0060_session_questions.sql
-- then record it:
--   npx wrangler d1 execute bharatai-production --remote --command "INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0060_session_questions.sql')"

CREATE TABLE IF NOT EXISTS session_questions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id     INTEGER NOT NULL DEFAULT 1,
  session_id   INTEGER NOT NULL,
  attendee_id  INTEGER NOT NULL,              -- who asked; never shown in the app
  body         TEXT    NOT NULL,
  anonymous    INTEGER NOT NULL DEFAULT 0,    -- 1: the moderator is not told who asked
  status       TEXT    NOT NULL DEFAULT 'live',  -- live | answered | hidden (moderator) | withdrawn (asker)
  votes        INTEGER NOT NULL DEFAULT 0,    -- kept equal to its rows in session_question_votes
  created_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_session_questions_session ON session_questions(session_id, status, votes);
CREATE INDEX IF NOT EXISTS idx_session_questions_attendee ON session_questions(attendee_id, created_at);

CREATE TABLE IF NOT EXISTS session_question_votes (
  question_id  INTEGER NOT NULL,
  attendee_id  INTEGER NOT NULL,
  created_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (question_id, attendee_id)
);
