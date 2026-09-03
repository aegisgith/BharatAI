-- innovation_talks: the table five endpoints have always bound and no migration
-- ever created.
--
-- /api/events/:id/innovation-talks returned HTTP 500 in production for the life of
-- the feature, which took the admin Innovation Talks tab and the app's Innovation
-- Talks tab down with it. Same failure class as attendees.payment_amount (see
-- migration 0023): code binding a column - here a whole table - that the schema
-- never got, failing invisibly on D1.
--
-- Columns are exactly what src/index.tsx binds in the POST and PATCH handlers:
-- event_id, slot_no, session_type, time_slot, speaker_name, company, topic,
-- status, notes. Nothing is inserted here; the tab starts empty and is filled
-- from the panel.
CREATE TABLE IF NOT EXISTS innovation_talks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id      INTEGER NOT NULL DEFAULT 1,
  slot_no       INTEGER,
  session_type  TEXT    NOT NULL DEFAULT 'Morning',
  time_slot     TEXT,
  speaker_name  TEXT,
  company       TEXT    DEFAULT '',
  topic         TEXT    DEFAULT '',
  status        TEXT    NOT NULL DEFAULT 'confirmed',
  notes         TEXT    DEFAULT '',
  created_at    TEXT    DEFAULT CURRENT_TIMESTAMP
);

-- The tab reads every talk for one event ordered by slot.
CREATE INDEX IF NOT EXISTS idx_innovation_talks_event_slot
  ON innovation_talks(event_id, slot_no);
