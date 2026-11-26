-- 0067: AI Agent Summit 2027 on the day (26 Nov 2026).
-- The home page promises these for Friday 16 April 2027, and the organiser said "go ahead":
--   summit_slots    the companies on stage, in order, and whether the room may score them now
--   summit_scores   one row per voter per slot: did it work, would I use it, was it clear (1 to 5)
--   summit_breaks   Break the agent: one row per break that the company confirmed at the booth
-- Routes: src/routes/agent-summit.ts ("On the day"). Until this runs, those routes answer
-- { ready: false } and Admin -> AI Agent Summit -> On the day shows this command.
--
-- IF NOT EXISTS throughout: safe to run twice. Additive only: no existing table is touched.

CREATE TABLE IF NOT EXISTS summit_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  position INTEGER NOT NULL DEFAULT 0,
  company TEXT NOT NULL,
  agent TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'waiting',   -- 'waiting' | 'open' | 'closed'
  opened_at TEXT,
  closed_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_summit_slots_state ON summit_slots (state, position);

CREATE TABLE IF NOT EXISTS summit_scores (
  slot_id INTEGER NOT NULL,
  attendee_id INTEGER NOT NULL,
  worked INTEGER NOT NULL,
  would_use INTEGER NOT NULL,
  clear INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (slot_id, attendee_id)
);

CREATE TABLE IF NOT EXISTS summit_breaks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  breaker TEXT NOT NULL,
  agent TEXT NOT NULL,
  what TEXT NOT NULL DEFAULT '',
  recorded_by TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
