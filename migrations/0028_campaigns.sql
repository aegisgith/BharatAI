-- Durable bulk-email campaigns.
--
-- Every bulk send in the panel ran as a for-loop inside the operator's browser
-- tab: notify-all, resend-to-non-responders, the thank-you mail, the new bulk
-- notify. Closing the tab stopped the run mid-way with no record of where it
-- stopped, and starting again re-sent to everyone already contacted.
--
-- The work still has to be pumped from somewhere - Cloudflare Pages has no cron
-- trigger, so nothing on the server can wake itself up - but the STATE now lives
-- here rather than in a browser. A closed tab pauses a campaign; any tab can
-- resume it; and because each recipient is a row with its own status, a resume
-- picks up exactly where it stopped and cannot send twice.
CREATE TABLE IF NOT EXISTS campaigns (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT    NOT NULL,               -- notify | thankyou | announcement
  title       TEXT,
  ref_id      INTEGER,                        -- announcement id, when kind = announcement
  audience    TEXT,                           -- how the recipient list was chosen
  status      TEXT    NOT NULL DEFAULT 'running',  -- running | paused | done
  total       INTEGER NOT NULL DEFAULT 0,
  sent        INTEGER NOT NULL DEFAULT 0,
  failed      INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT,
  created_at  TEXT    DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT    DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);

-- One row per intended recipient, so progress survives the tab and a resume
-- cannot double-send. The error is kept so a failed address can be corrected
-- and the campaign retried for just those rows.
CREATE TABLE IF NOT EXISTS campaign_recipients (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  attendee_id INTEGER,
  email       TEXT,
  name        TEXT,
  status      TEXT    NOT NULL DEFAULT 'pending',  -- pending | sent | failed
  error       TEXT,
  sent_at     TEXT
);

-- The pump asks for the next pending rows of one campaign, over and over.
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_next
  ON campaign_recipients(campaign_id, status, id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status
  ON campaigns(status, id DESC);
