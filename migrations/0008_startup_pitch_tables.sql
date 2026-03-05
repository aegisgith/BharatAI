-- Startup Pitches table
CREATE TABLE IF NOT EXISTS startup_pitches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  slot_order INTEGER NOT NULL DEFAULT 0,
  time_slot TEXT NOT NULL,
  company TEXT NOT NULL,
  pitcher_name TEXT NOT NULL,
  pitcher_title TEXT DEFAULT '',
  pitcher_profile TEXT DEFAULT '',
  pitcher_avatar_url TEXT DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

-- Startup Investors / Evaluators table
CREATE TABLE IF NOT EXISTS startup_investors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  title TEXT DEFAULT '',
  company TEXT DEFAULT '',
  avatar_url TEXT DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_startup_pitches_event ON startup_pitches(event_id);
CREATE INDEX IF NOT EXISTS idx_startup_investors_event ON startup_investors(event_id);
