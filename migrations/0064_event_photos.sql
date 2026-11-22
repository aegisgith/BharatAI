-- Event photos (23 Nov 2026): the photographers' photos, copied once from Google Drive
-- to R2 by scripts/photo-store/ (bucket bharatai-uploads, event-photos/<event>/<pid>/
-- s.jpg 600 px, m.jpg 1600 px, o.jpg the original). The bucket is never public: the
-- worker (src/routes/photo-store.ts) serves a photo only through a link signed for one
-- person, and a person may save at most photo_download_limit (app_settings, default 15)
-- different originals. Safe to run twice.

-- One row per photo.
CREATE TABLE IF NOT EXISTS event_photos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    INTEGER NOT NULL DEFAULT 1,
  pid         TEXT    NOT NULL UNIQUE,           -- random, in every link; never the Drive id
  drive_id    TEXT    NOT NULL UNIQUE,           -- the photographers' Drive file (backup copy)
  title       TEXT    NOT NULL DEFAULT '',       -- the camera's file name, 885A5364.JPG
  day         TEXT    NOT NULL DEFAULT '',       -- the date in India, '2026-11-20'
  taken_at    TEXT    NOT NULL DEFAULT '',       -- UTC, '' when unknown (the RAW photos)
  camera      TEXT    NOT NULL DEFAULT '',       -- the photographer's folder; for the organiser only
  hall        TEXT    NOT NULL DEFAULT '',       -- the event hall name when the folder says it
  width       INTEGER NOT NULL DEFAULT 0,
  height      INTEGER NOT NULL DEFAULT 0,
  bytes       INTEGER NOT NULL DEFAULT 0,        -- the original in R2
  raw         INTEGER NOT NULL DEFAULT 0,        -- 1: shot RAW; R2 has Drive's JPEG of it
  hidden      INTEGER NOT NULL DEFAULT 0,        -- 1: no link to it works any more
  highlight   INTEGER NOT NULL DEFAULT 0,        -- 1: in the "best of" set everyone sees
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_event_photos_day ON event_photos(event_id, day, taken_at);

-- Who is in which photo. `person` is the same text the links are signed for:
-- 'a<attendee id>', or a speaker album key from src/data/speaker-photos.json.
CREATE TABLE IF NOT EXISTS photo_matches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  photo_id    INTEGER NOT NULL,
  person      TEXT    NOT NULL,
  source      TEXT    NOT NULL DEFAULT 'face',   -- face | manual
  score       REAL,
  state       TEXT    NOT NULL DEFAULT 'shown',  -- shown | not_me (they said so) | removed (by the organiser)
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME,
  UNIQUE (photo_id, person)
);
CREATE INDEX IF NOT EXISTS idx_photo_matches_person ON photo_matches(person, state);

-- What people ask for: 'find' (look for me in the photos; consent_at is when they
-- agreed to the face match) or 'remove' (take this photo of me down).
CREATE TABLE IF NOT EXISTS photo_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    INTEGER NOT NULL DEFAULT 1,
  attendee_id INTEGER NOT NULL,
  kind        TEXT    NOT NULL DEFAULT 'find',
  photo_id    INTEGER,
  consent_at  DATETIME,
  status      TEXT    NOT NULL DEFAULT 'waiting', -- waiting | matched | none | done | refused
  note        TEXT    NOT NULL DEFAULT '',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME
);
CREATE INDEX IF NOT EXISTS idx_photo_requests_status ON photo_requests(event_id, kind, status);

-- Every original a person has saved, once per photo (saving it again is free).
CREATE TABLE IF NOT EXISTS photo_downloads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  person      TEXT    NOT NULL,
  photo_id    INTEGER NOT NULL,
  first_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  times       INTEGER NOT NULL DEFAULT 1,
  UNIQUE (person, photo_id)
);
CREATE INDEX IF NOT EXISTS idx_photo_downloads_person ON photo_downloads(person);
