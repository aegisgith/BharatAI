-- 0053_inquiry_pipeline: the commercial side of an enquiry (12 Nov 2026).
--
-- Admin -> Inquiries became a desk that is worked, not a list that is read: an
-- owner, a status from New to Won or Lost, notes, saved replies, a history. Most of
-- that lives on the inquiries table already (status, assigned_to, responded_at,
-- admin_notes). Three things did not fit anywhere: what a deal is worth, when to
-- chase it next, and why one was lost. They live here, one row per enquiry that
-- has any of them, so the inquiries table is not altered (ADD COLUMN is not safe to
-- run twice; this file is).
--
-- Until this runs, the desk hides value, follow-up and lost reason and everything
-- else works. Apply with:
--   npx wrangler d1 execute bharatai-production --remote --file=./migrations/0053_inquiry_pipeline.sql
--   npx wrangler d1 execute bharatai-production --remote --command "INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0053_inquiry_pipeline.sql')"

CREATE TABLE IF NOT EXISTS inquiry_pipeline (
  inquiry_id      INTEGER PRIMARY KEY,           -- inquiries.id
  priority        TEXT,                          -- 'hot' | 'warm' | 'cold' set by a person; NULL = the desk's own score
  deal_value_inr  INTEGER,                       -- expected value, WHOLE RUPEES before GST; NULL = not known
  next_action_at  TEXT,                          -- follow-up day in India, YYYY-MM-DD
  next_action     TEXT,                          -- what to do that day, in a few words
  lost_reason     TEXT,                          -- why a Lost one was lost
  closed_at       TEXT,                          -- when it became Won, Lost or Closed
  updated_at      TEXT DEFAULT CURRENT_TIMESTAMP
);

-- "Follow-ups due today" reads by day.
CREATE INDEX IF NOT EXISTS idx_inquiry_pipeline_next ON inquiry_pipeline(next_action_at);
-- The desk lists one event's enquiries by status.
CREATE INDEX IF NOT EXISTS idx_inquiries_event_status ON inquiries(event_id, status);
