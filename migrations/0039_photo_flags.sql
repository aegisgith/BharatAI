-- Migration 0039: every badge-desk photo flag is kept, not just the latest.
--
-- 0038 kept one flagged photo per attendee, on the attendees row. A second flag
-- overwrote it: the first photo's URL was gone from the database and its
-- fingerprint stopped being blocked, so the first photo could simply be uploaded
-- again. Nothing could clear a wrong flag after the desk's 15-minute undo either.
--
-- One row per flag, never overwritten. The flagged_* and photo_flagged_* columns
-- on attendees stay as a summary of the latest OPEN flag, for the desk screen and
-- the admin list. The reuse check reads this table, and an open flag blocks its
-- photo for every account, whoever uploads it.

CREATE TABLE IF NOT EXISTS photo_flags (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  attendee_id  INTEGER NOT NULL,
  avatar_url   TEXT,              -- the photo the desk judged; its R2 object is kept
  fingerprint  TEXT,              -- blocked while the flag is open
  flagged_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  flagged_by   TEXT,
  cleared_at   DATETIME,          -- NULL while the flag stands
  cleared_by   TEXT,
  cleared_how  TEXT               -- 'desk-undo' | 'admin'
);

CREATE INDEX IF NOT EXISTS idx_photo_flags_attendee ON photo_flags(attendee_id, cleared_at);
CREATE INDEX IF NOT EXISTS idx_photo_flags_open     ON photo_flags(cleared_at);
CREATE INDEX IF NOT EXISTS idx_photo_flags_url      ON photo_flags(avatar_url);

-- Carry across any flag already on an attendees row, once.
INSERT INTO photo_flags (attendee_id, avatar_url, fingerprint, flagged_at, flagged_by)
SELECT a.id, a.flagged_avatar_url, a.flagged_avatar_fingerprint, a.photo_flagged_at, a.photo_flagged_by
  FROM attendees a
 WHERE a.photo_flagged_at IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM photo_flags f WHERE f.attendee_id = a.id);
