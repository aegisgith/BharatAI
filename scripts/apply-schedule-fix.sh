#!/usr/bin/env bash
# One-shot, safe fix for the empty Schedule tab.
#
# The production `sessions` table still carries June dates (2026-06-02/03),
# but the app's Schedule tab filters for the current event dates
# (20-21 Nov 2026), so it shows "No sessions found". Migration 0013 shifts
# the session dates June -> November. It is UPDATE-only, scoped to event_id=1,
# and idempotent (safe to run more than once).
#
# This script: checks login -> backs up the whole DB -> shows before -> applies
# 0013 -> shows after. Nothing is deleted; a full backup is written first.
#
# Usage (from the repo root, in Git Bash / WSL / macOS / Linux):
#   npx wrangler login          # once, if not already logged in
#   bash scripts/apply-schedule-fix.sh

set -euo pipefail

DB="bharatai-production"
MIGRATION="./migrations/0013_shift_session_dates_to_november.sql"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="backup-${DB}-pre-0013-${STAMP}.sql"

echo "=============================================================="
echo " Bharat AI — schedule date fix (migration 0013)"
echo "=============================================================="

# 0. Sanity: are we logged in and is the migration present?
echo ""
echo "[0/4] Checking wrangler login + migration file..."
if ! npx wrangler whoami >/dev/null 2>&1; then
  echo "  ✗ Not logged in. Run:  npx wrangler login   then re-run this script."
  exit 1
fi
[ -f "$MIGRATION" ] || { echo "  ✗ Migration file not found: $MIGRATION"; exit 1; }
echo "  ✓ Logged in, migration file present."

# 1. Back up the ENTIRE production database first (attendees, everything).
echo ""
echo "[1/4] Backing up production DB -> $BACKUP ..."
npx wrangler d1 export "$DB" --remote --output "$BACKUP"
echo "  ✓ Backup written: $BACKUP  (restore point if anything looks wrong)"

# 2. Show the BEFORE state.
echo ""
echo "[2/4] Session dates BEFORE:"
npx wrangler d1 execute "$DB" --remote --command \
  "SELECT substr(start_time,1,7) AS month, COUNT(*) AS sessions FROM sessions WHERE event_id=1 GROUP BY month ORDER BY month;"

# 3. Apply migration 0013 (UPDATE-only, idempotent).
echo ""
echo "[3/4] Applying migration 0013 (June -> November)..."
npx wrangler d1 execute "$DB" --remote --file="$MIGRATION"
echo "  ✓ Applied."

# 4. Show the AFTER state — expect 2026-11 only.
echo ""
echo "[4/4] Session dates AFTER (expect all 2026-11):"
npx wrangler d1 execute "$DB" --remote --command \
  "SELECT substr(start_time,1,7) AS month, COUNT(*) AS sessions FROM sessions WHERE event_id=1 GROUP BY month ORDER BY month;"

echo ""
echo "=============================================================="
echo " Done. Open https://bharataiinnovation.com/app -> Schedule."
echo " If anything looks wrong, restore from: $BACKUP"
echo "=============================================================="
