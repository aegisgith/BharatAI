-- 0069: the home-page hero test on aiagentssummit.org (27 Nov 2026).
-- Hero A ("Arena", photos of one person on stage) against hero C ("Signal", the summit's lime).
-- The browser counts each visitor once per step and sends only the hero and the step, so a row
-- is a day's total: no person, email or IP is stored. Safe to run twice.
--   step: seen (the home page), cta (clicked Apply to showcase or Get a pass), apply, pass,
--         applied (finished a showcase application), registered (finished a pass form)
CREATE TABLE IF NOT EXISTS summit_hero_test (
  day     TEXT    NOT NULL,          -- IST date, YYYY-MM-DD
  variant TEXT    NOT NULL,          -- 'a' or 'c'
  step    TEXT    NOT NULL,
  n       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, variant, step)
);
