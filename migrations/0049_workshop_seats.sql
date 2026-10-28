-- 0049: workshop seats, chosen online by the buyer after paying.
--
-- Organiser, 26 Oct 2026: a Premium Delegate or VIP Pass includes ONE workshop.
-- Seats are first come, first served and are taken in the app (Workshops tab),
-- not arranged by email. A seat can be switched until app_settings
-- workshop_choice_closes (IST wall clock, default 2026-11-18 23:59).
--
-- The catalogue is its own table, not the schedule: the schedule's older
-- "Workshop 1-3" rows stay listed but are not bookable. Times are NULL until the
-- organiser fixes them in Admin -> Workshop Seats ("to be announced" in the app).
--
-- IF NOT EXISTS / OR IGNORE throughout: safe to run twice.

CREATE TABLE IF NOT EXISTS workshops (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    INTEGER NOT NULL DEFAULT 1,
  slug        TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  speaker     TEXT,
  summary     TEXT,
  starts_at   TEXT,                       -- 'YYYY-MM-DD HH:MM', IST; NULL = to be announced
  ends_at     TEXT,
  room        TEXT,
  capacity    INTEGER NOT NULL DEFAULT 100,
  is_open     INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (event_id, slug)
);

-- One seat per person per event: UNIQUE (event_id, attendee_id) is what makes a
-- switch an update of the same row, never a second seat.
CREATE TABLE IF NOT EXISTS workshop_seats (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id     INTEGER NOT NULL DEFAULT 1,
  attendee_id  INTEGER NOT NULL,
  workshop_id  INTEGER NOT NULL,
  chosen_by    TEXT    NOT NULL DEFAULT 'attendee',   -- 'attendee', or 'admin:<name>'
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (event_id, attendee_id)
);
CREATE INDEX IF NOT EXISTS idx_workshop_seats_workshop ON workshop_seats (workshop_id);

INSERT OR IGNORE INTO workshops (event_id, slug, title, speaker, summary, capacity, sort_order) VALUES
  (1, 'cxo-guide',
   'Data Science to Agentic AI: A CXO’s Guide to Strategic Decision-Making',
   'Dr. Vinay Kulkarni, Adjunct Faculty, IIT Bombay; Director, Aegis School of Data Science & AI',
   'A practical framework for choosing the right business problems and AI use cases, judging pilots, and scaling what works into production.',
   100, 1),
  (1, 'fde-workshop',
   'From Prototype to Production: Building Enterprise AI with Forward-Deployed Engineers',
   'Dr. Ashish Tendulkar, Google AI',
   'Live coding, 90 minutes: an enterprise AI workflow built live, tested against realistic cases, and taken through what production needs.',
   100, 2);
