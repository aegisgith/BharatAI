-- WhatsApp (23 Nov 2026): messages sent from our own WhatsApp Business number through
-- Meta's WhatsApp Cloud API, and what comes back (delivered, read, failed, replies).
-- Server: src/routes/whatsapp.ts. Screen: Admin -> WhatsApp.
-- Safe to run twice (IF NOT EXISTS throughout). Nothing here touches another table.
--
--   npx wrangler d1 execute bharatai-production --remote --file=./migrations/0065_whatsapp.sql
--   npx wrangler d1 execute bharatai-production --remote --command "INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0065_whatsapp.sql')"

-- One row per message, out or in. An outgoing row is written 'queued' and sent by the
-- minute clock (or by the Admin page while it is open); Meta's webhook then moves it to
-- delivered / read / failed.
CREATE TABLE IF NOT EXISTS wa_messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id      INTEGER NOT NULL DEFAULT 1,
  direction     TEXT    NOT NULL DEFAULT 'out',    -- out | in
  kind          TEXT    NOT NULL DEFAULT 'custom', -- photos | pass | custom | reply | in
  wa_number     TEXT    NOT NULL,                  -- country code and digits: 919876543210
  attendee_id   INTEGER,
  person        TEXT    NOT NULL DEFAULT '',       -- the photo album key ('a123') for kind photos
  name          TEXT    NOT NULL DEFAULT '',
  template      TEXT    NOT NULL DEFAULT '',       -- the template's name at Meta; '' = a free message
  payload       TEXT    NOT NULL DEFAULT '{}',     -- what was built for this person: words, picture, sign-in
  target_url    TEXT    NOT NULL DEFAULT '',       -- where the button goes, through /w/<code>
  status        TEXT    NOT NULL DEFAULT 'queued', -- queued | sending | sent | delivered | read | failed | skipped | cancelled | received
  error         TEXT,
  error_code    INTEGER,
  wamid         TEXT,                              -- Meta's id for the message
  price_category TEXT,                             -- what Meta billed it as: marketing | utility | service
  price_type    TEXT,                              -- regular (paid) | free_customer_service | ...
  batch_id      INTEGER,                           -- wa_batches.id for a bulk send
  test          INTEGER NOT NULL DEFAULT 0,        -- 1: a test to the organiser's own number
  own           INTEGER NOT NULL DEFAULT 0,        -- 1: sent by hand from a team member's own WhatsApp (wa.me)
  created_by    TEXT    NOT NULL DEFAULT '',
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  sent_at       DATETIME,
  delivered_at  DATETIME,
  read_at       DATETIME,
  clicked_at    DATETIME,
  updated_at    DATETIME
);
CREATE INDEX IF NOT EXISTS idx_wa_messages_queue ON wa_messages(status, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_messages_wamid ON wa_messages(wamid) WHERE wamid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wa_messages_number ON wa_messages(wa_number, id);
CREATE INDEX IF NOT EXISTS idx_wa_messages_batch ON wa_messages(batch_id, status);
CREATE INDEX IF NOT EXISTS idx_wa_messages_sent ON wa_messages(direction, sent_at);

-- One row per bulk send.
CREATE TABLE IF NOT EXISTS wa_batches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    INTEGER NOT NULL DEFAULT 1,
  kind        TEXT    NOT NULL,                    -- photos | pass | custom
  template    TEXT    NOT NULL DEFAULT '',
  title       TEXT    NOT NULL DEFAULT '',
  audience    TEXT    NOT NULL DEFAULT '',
  status      TEXT    NOT NULL DEFAULT 'running',  -- running | paused | done | cancelled
  total       INTEGER NOT NULL DEFAULT 0,
  note        TEXT,                                -- why it stopped by itself, in plain words
  created_by  TEXT    NOT NULL DEFAULT '',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME
);

-- One row per mobile number we have heard from, or that asked us to stop.
CREATE TABLE IF NOT EXISTS wa_contacts (
  wa_number     TEXT PRIMARY KEY,
  name          TEXT    NOT NULL DEFAULT '',       -- the name on their WhatsApp profile
  opted_out_at  DATETIME,                          -- they replied STOP, or the team stopped it
  opted_out_by  TEXT,                              -- 'reply' or the team member's name
  last_in_at    DATETIME,                          -- their last message to us: a free reply is allowed for 24 hours after it
  unread        INTEGER NOT NULL DEFAULT 0,
  updated_at    DATETIME
);

-- The messages Meta has to approve before we may send them ("templates"). The two built
-- in ones (photos, pass) are written in src/routes/whatsapp.ts and only their state at
-- Meta is kept here; a picture or announcement the team writes is kept here whole.
CREATE TABLE IF NOT EXISTS wa_templates (
  name            TEXT PRIMARY KEY,                -- lower case, digits and _ only (Meta's rule)
  builtin         INTEGER NOT NULL DEFAULT 0,
  title           TEXT    NOT NULL DEFAULT '',     -- the team's own name for it
  category        TEXT    NOT NULL DEFAULT 'MARKETING', -- MARKETING | UTILITY, as we asked
  body            TEXT    NOT NULL DEFAULT '',     -- the words after "Hello <name>,"
  greet           INTEGER NOT NULL DEFAULT 1,      -- 1: starts with "Hello <name>,"
  image_url       TEXT    NOT NULL DEFAULT '',     -- /api/uploads/whatsapp/...
  button_text     TEXT    NOT NULL DEFAULT '',
  button_url      TEXT    NOT NULL DEFAULT '',
  status          TEXT    NOT NULL DEFAULT 'draft',-- draft | PENDING | APPROVED | REJECTED | PAUSED | DISABLED | ...
  meta_id         TEXT,
  meta_category   TEXT,                            -- what Meta decided it is (it may change ours)
  rejected_reason TEXT,
  created_by      TEXT    NOT NULL DEFAULT '',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  submitted_at    DATETIME,
  updated_at      DATETIME
);
