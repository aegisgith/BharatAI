-- Migration 0040: one row per person per campus panel.
--
-- Until now a campus-panel registration was a TAG on the attendee row
-- (registration_source = 'campus:<slug>'), written by the panel page's form.
-- That works for attribution and for keeping students out of conference-wide
-- mail, and it stays. It cannot carry three things this table has to:
--
--   1. A person who registered for the conference on the website in August and
--      then signed up for a panel on mUni Campus in September. Rewriting their
--      source to 'campus:' would erase where they really came from and drop
--      them out of every conference campaign. They keep their source; they get
--      a row here.
--   2. Attendance. Nobody from the organiser stands at the door of another
--      college, so attendance is CLAIMED: the closing slide shows a code, the
--      registrant enters it in the app inside a short window, and claimed_at
--      is the record. The certificate and the "I attended" card are gated on
--      it. checked_in_at on attendees is deliberately not reused - that column
--      means "scanned in at WTC in November" and unlocks the conference
--      certificate.
--   3. The same person at two panels (JNU is nine days after DJ Sanghvi), and
--      a per-panel count of who was emailed, who claimed, who took what.
--
-- source: 'page' (the campus page form), 'muni' (imported from the mUni Campus
-- export), 'admin'. external_ref keeps the mUni registration date so a fresh
-- export can be reconciled against what is already here.

CREATE TABLE IF NOT EXISTS panel_registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attendee_id INTEGER NOT NULL,
  panel_slug TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'page',
  external_ref TEXT,
  registered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmation_sent_at DATETIME,
  confirmation_error TEXT,
  claimed_at DATETIME,
  claim_attempts INTEGER NOT NULL DEFAULT 0,
  last_claim_attempt_at DATETIME,
  certificate_downloaded_at DATETIME,
  card_downloaded_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(attendee_id, panel_slug),
  FOREIGN KEY (attendee_id) REFERENCES attendees(id)
);

CREATE INDEX IF NOT EXISTS idx_panel_registrations_slug ON panel_registrations(panel_slug);

-- Everyone the campus page form has already tagged gets a row, dated from
-- their registration. The tag stays on the attendee row untouched.
INSERT OR IGNORE INTO panel_registrations (attendee_id, panel_slug, source, registered_at)
SELECT id, substr(registration_source, 8), 'page', COALESCE(registration_date, created_at, CURRENT_TIMESTAMP)
  FROM attendees
 WHERE registration_source LIKE 'campus:%';
