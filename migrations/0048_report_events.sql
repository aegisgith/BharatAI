-- 0048: what people did with the Campus Series insights reports, one row per act.
--
-- report_downloads (0047) keeps one row per address with a running count of PDF
-- opens. This table keeps the acts themselves, so the organiser can see WHO opened
-- WHICH report and who started WHICH recording, and when:
--
--   kind    = 'open'   a PDF served through a signed link (GET /reports/:file)
--             'watch'  a recording: a tap on the video link in the email
--                      (source 'email', through GET /watch/:slug) or a play
--                      started on a page of the website (source 'site', the
--                      YouTube player's own "playing" signal, sent by
--                      public/js/watch-track.js)
--   report  = 'djsce' | 'jnu'
--   subject = 'l<report_downloads.id>' for someone who asked on /insights,
--             'a<attendees.id>' for a panel registrant mailed the links,
--             ''  when nobody is known (a play on a campus page by a visitor)
--   email   = resolved from the subject when the row is written, lower-case,
--             so the admin lists join on it; NULL when nobody is known
--
-- A mail scanner that follows every link in an email runs no script, and both
-- email links land on a page that needs script to move on, so a scanner's visit
-- leaves no row here.
--
-- Additive only, and every statement is IF NOT EXISTS, so running this file twice
-- changes nothing. Until it runs, opens are still counted on report_downloads and
-- plays are not recorded; the admin block shows the numbers it can.
CREATE TABLE IF NOT EXISTS report_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id   INTEGER NOT NULL DEFAULT 1,
  kind       TEXT    NOT NULL,                 -- open | watch
  report     TEXT    NOT NULL,                 -- djsce | jnu
  subject    TEXT    NOT NULL DEFAULT '',      -- l<id> | a<id> | ''
  email      TEXT,                             -- lower-case, when known
  source     TEXT    NOT NULL DEFAULT 'site',  -- email | site | link (a direct PDF link from before /r/)
  page       TEXT,                             -- the page a play started on
  ip         TEXT,                             -- only to cap how many rows one address can write
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_report_events_email ON report_events(email, kind);
CREATE INDEX IF NOT EXISTS idx_report_events_kind ON report_events(kind, report, created_at);
CREATE INDEX IF NOT EXISTS idx_report_events_ip ON report_events(ip, created_at);
