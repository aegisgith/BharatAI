-- 0047: who has the Campus Series insights reports, and how they got them.
--
-- The two reports (DJ Sanghvi, 21 Sep 2026; JNU, 30 Sep 2026) are PDFs under
-- /reports/, served by the worker only with a signed link. A link is minted two
-- ways, and both land here, one row per address:
--
--   source = 'page'   the person gave their details on /insights and was shown
--                     the links at once (and emailed them);
--   source = 'email'  a panel registrant was sent the links from Admin ->
--                     Overview -> Campus panels -> "Send the reports".
--
-- email_sent_at / email_error are the "your reports" email, whichever way the
-- row came to exist, so a panel registrant who already asked on the page is not
-- mailed a second time, and the pump's pause ('paused: by admin') parks in
-- email_error like the other panel pumps.
--
-- downloads counts PDF opens through a signed link; last_report is the slug of
-- the one opened last ('djsce' | 'jnu').
--
-- A row here is never a registration: it does not count anywhere, has no pass
-- and no place in the directory. attendee_id is set when the address belongs to
-- someone on the attendees table, for the admin to join on, nothing more.
--
-- Additive only, and every statement is IF NOT EXISTS, so running this file
-- twice changes nothing. Until it runs, /insights still serves the PDFs (the
-- links are signed, not looked up) and simply keeps no record, and the admin
-- block says so.
CREATE TABLE IF NOT EXISTS report_downloads (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id          INTEGER NOT NULL DEFAULT 1,
  email             TEXT    NOT NULL,                 -- lower-case
  name              TEXT,
  mobile            TEXT,
  company           TEXT,
  job_title         TEXT,
  city              TEXT,
  industry          TEXT,
  who               TEXT,                             -- professional | student | faculty
  attendee_id       INTEGER,
  source            TEXT    NOT NULL DEFAULT 'page',  -- page | email
  marketing_consent INTEGER,                          -- 1 = ticked "keep me posted" on /insights
  ip                TEXT,                             -- only to cap how many one address can create
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  email_sent_at     TEXT,
  email_error       TEXT,
  downloads         INTEGER NOT NULL DEFAULT 0,
  last_download_at  TEXT,
  last_report       TEXT,
  UNIQUE(event_id, email)
);

CREATE INDEX IF NOT EXISTS idx_report_downloads_ip ON report_downloads(ip, created_at);
CREATE INDEX IF NOT EXISTS idx_report_downloads_attendee ON report_downloads(attendee_id);
