-- 0061_delhi_codes.sql  (written 12 Nov 2026)
--
-- Partner and discount codes for Delhi 2027 passes (Admin -> Delhi 2027, the code box on
-- /delhi-register). Until this runs every code is "not valid" and buying with no code
-- works as before.
--
-- IF NOT EXISTS throughout: safe to run twice. Run it with
--   npx wrangler d1 execute bharatai-production --remote --file=./migrations/0061_delhi_codes.sql
-- then record it:
--   npx wrangler d1 execute bharatai-production --remote --command "INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0061_delhi_codes.sql')"

CREATE TABLE IF NOT EXISTS delhi_codes (
  code         TEXT    PRIMARY KEY,              -- upper case: letters, digits, hyphens
  partner      TEXT    NOT NULL DEFAULT '',      -- whose code: partner, community or campaign
  percent      INTEGER NOT NULL DEFAULT 0,       -- off the pass before GST; 0 only counts sales
  passes       TEXT    NOT NULL DEFAULT '',      -- comma list of pass names; empty = every pass
  valid_until  TEXT    NOT NULL DEFAULT '',      -- last day it works, India date YYYY-MM-DD; empty = no end
  max_uses     INTEGER NOT NULL DEFAULT 0,       -- paid uses allowed; 0 = no limit
  active       INTEGER NOT NULL DEFAULT 1,
  note         TEXT    NOT NULL DEFAULT '',
  created_by   TEXT    NOT NULL DEFAULT '',
  created_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One row per order made with a code. The order itself (payment_orders) already holds the
-- price after the discount; this says which code and what it took off.
CREATE TABLE IF NOT EXISTS delhi_code_orders (
  order_id       TEXT    PRIMARY KEY,
  code           TEXT    NOT NULL,
  attendee_id    INTEGER NOT NULL,
  list_paise     INTEGER NOT NULL,               -- the total it would have been, GST included
  discount_paise INTEGER NOT NULL,               -- what the code took off, GST included
  created_at     TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_delhi_code_orders_code ON delhi_code_orders(code);
