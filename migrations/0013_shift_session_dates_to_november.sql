-- Migration 0013: Shift conference schedule dates June -> November 2026
--
-- Context: migration 0012 seeded all sessions with the ORIGINAL event dates
-- (2 June 2026 / 3 June 2026). The event was subsequently moved to
-- 20-21 November 2026, and the rest of the app (marketing, hero, emails)
-- was updated to "20-21 Nov 2026" in code. However the `sessions` table in
-- production was never re-dated, so the Schedule tab still shows June while
-- the rest of the site shows November. This migration fixes that mismatch.
--
-- Mapping (day-of-event preserved):
--   Day 1: 2026-06-02  ->  2026-11-20
--   Day 2: 2026-06-03  ->  2026-11-21
--
-- Safety notes:
--   * Non-destructive: UPDATE only. No DELETE / DROP / re-insert. Existing
--     session rows (and any registrations referencing them) are preserved.
--   * Time-of-day is preserved: only the 10-char date prefix is replaced,
--     so '2026-06-02 08:30' -> '2026-11-20 08:30'.
--   * Scoped to event_id = 1 (the conference instance used elsewhere).
--   * Idempotent: re-running is a no-op. The WHERE clauses only match rows
--     that still carry the June prefix, and REPLACE on an already-shifted
--     value finds nothing to replace. Safe to apply more than once.
--
-- BEFORE APPLYING TO PRODUCTION, take a backup:
--   npx wrangler d1 export bharatai-production --remote --output backup-sessions-pre-0013.sql
-- Then apply:
--   npx wrangler d1 migrations apply bharatai-production --remote
-- Or apply this single file directly:
--   npx wrangler d1 execute bharatai-production --remote --file=./migrations/0013_shift_session_dates_to_november.sql

-- Day 1: 2 June -> 20 November
UPDATE sessions
SET start_time = REPLACE(start_time, '2026-06-02', '2026-11-20'),
    end_time   = REPLACE(end_time,   '2026-06-02', '2026-11-20')
WHERE event_id = 1
  AND (start_time LIKE '2026-06-02%' OR end_time LIKE '2026-06-02%');

-- Day 2: 3 June -> 21 November
UPDATE sessions
SET start_time = REPLACE(start_time, '2026-06-03', '2026-11-21'),
    end_time   = REPLACE(end_time,   '2026-06-03', '2026-11-21')
WHERE event_id = 1
  AND (start_time LIKE '2026-06-03%' OR end_time LIKE '2026-06-03%');
