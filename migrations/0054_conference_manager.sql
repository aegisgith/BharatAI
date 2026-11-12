-- 0054_conference_manager.sql  (written 12 Nov 2026)
--
-- Admin -> Conference: the programme, its speakers, its halls and the speaker
-- announcements, managed in the admin panel instead of SQL files.
--
-- Until now a speaker could only be added or changed by a SQL file the organiser
-- ran, a session's speakers were a typed line of names ("Name (Org), Name (Org)")
-- with no link to the speakers table, the four halls were a list written into the
-- app's code, and nothing recorded which speakers had been announced.
--
-- 1. conference_halls: each hall attendees see (its name is what sessions.room
--    holds), the room it is at the venue, how to find it, and its seats.
-- 2. session_speakers: who speaks in which session, and as what (keynote,
--    panellist, moderator...). sessions.speaker_name is still written from these
--    links on every save, because that line is what the app shows today.
-- 3. session_admin: a session kept as a draft (not shown to attendees) and the
--    team's own note on it. A session with no row here is published.
-- 4. speaker_announcements: each time a speaker was announced, and the
--    announcement it posted.
--
-- IF NOT EXISTS and INSERT OR IGNORE throughout: safe to run twice. Until it runs,
-- Admin -> Conference still adds and edits speakers and sessions; halls, drafts,
-- saved speaker links and the announcement log wait for it. Run it with
--   npx wrangler d1 execute bharatai-production --remote --file=./migrations/0054_conference_manager.sql
-- then record it:
--   npx wrangler d1 execute bharatai-production --remote --command "INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0054_conference_manager.sql')"

CREATE TABLE IF NOT EXISTS conference_halls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,              -- what attendees see; sessions.room holds this
  short_name TEXT,                 -- the chip in the app: 'Bhabha Hall'
  venue_room TEXT,                 -- the room's name at the venue: 'Peacock Hall'
  location TEXT,                   -- how to find it: 'Ground floor, WTC Mumbai'
  capacity INTEGER,
  purpose TEXT,                    -- 'Keynotes and panels', 'Workshops'
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id, name)
);
CREATE INDEX IF NOT EXISTS idx_conference_halls_event ON conference_halls(event_id, sort_order);

-- The four halls of 20-21 Nov 2026 (organiser, 12 Nov: Kalam and Aryabhata swapped
-- that day: Kalam is Centrum Hall A, Aryabhata the Expo Hall), in the app's order.
INSERT OR IGNORE INTO conference_halls (event_id, name, short_name, venue_room, location, purpose, sort_order) VALUES
  (1, 'Homi J. Bhabha Hall', 'Bhabha Hall', 'Peacock Hall', 'Ground Floor, Centre One', 'Keynotes and panels', 1),
  (1, 'Kalam Theatre', 'Kalam', 'Centrum Hall A', 'First Floor, Centre One', 'Panels', 2),
  (1, 'Raman Theatre', 'Raman', 'Centrum Hall B', 'First Floor, Centre One', 'Workshops', 3),
  (1, 'Aryabhata Theatre', 'Aryabhata', 'Expo Hall', 'On the exhibition floor', 'Innovation Talks', 4);

CREATE TABLE IF NOT EXISTS session_speakers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  speaker_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'speaker',   -- speaker, keynote, panellist, moderator, host, chair
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(session_id, speaker_id)
);
CREATE INDEX IF NOT EXISTS idx_session_speakers_speaker ON session_speakers(speaker_id);

CREATE TABLE IF NOT EXISTS session_admin (
  session_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'published',  -- published, draft
  note TEXT,                                  -- the team's own note; never shown to attendees
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS speaker_announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL DEFAULT 1,
  speaker_id INTEGER NOT NULL,
  session_id INTEGER,
  announcement_id INTEGER,
  emailed INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_speaker_announcements_speaker ON speaker_announcements(speaker_id);
