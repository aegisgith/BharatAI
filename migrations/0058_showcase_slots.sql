-- Paid 10-minute Innovation Showcase slots (12 Nov 2026).
--
-- The organiser, eight days before the event: sell a 10-minute slot on the
-- Innovation Stage (Aryabhata Theatre, Expo Hall) to the people who asked to
-- speak, Rs 10,000 + GST, or Rs 15,000 + GST with a VIP Pass. One row per
-- checkout: 'held' while the CCAvenue order is open (it counts towards the cap
-- for the hour the pay link lives, so the last slot is not sold twice), 'paid'
-- once the money lands (an innovation_talks row is made then, with no time:
-- the team places it in Admin, Innovation Talks), 'cancelled' when the same
-- person starts again.
--
-- Run once (production, from the repo root):
--   npx wrangler d1 execute bharatai-production --remote --file=migrations/0058_showcase_slots.sql
-- Until it runs, /showcase-slot says the slots open shortly and nothing is sold.
CREATE TABLE IF NOT EXISTS showcase_slots (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id     INTEGER NOT NULL DEFAULT 1,
  order_id     TEXT    NOT NULL UNIQUE,        -- payment_orders.order_id
  attendee_id  INTEGER NOT NULL,
  with_vip     INTEGER NOT NULL DEFAULT 0,     -- 1: the Rs 15,000 slot with a VIP Pass
  name         TEXT    DEFAULT '',
  company      TEXT    DEFAULT '',
  designation  TEXT    DEFAULT '',
  email        TEXT    DEFAULT '',
  mobile       TEXT    DEFAULT '',
  title        TEXT    NOT NULL,               -- the talk's title, as the buyer typed it
  summary      TEXT    DEFAULT '',
  status       TEXT    NOT NULL DEFAULT 'held', -- held | paid | cancelled
  talk_id      INTEGER,                        -- innovation_talks.id, once paid
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  paid_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_showcase_slots_status ON showcase_slots(event_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_showcase_slots_attendee ON showcase_slots(attendee_id);
