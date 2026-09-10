#!/usr/bin/env python3
"""Load migrations/0032_sellable_items.sql into real sqlite3 and assert every claim it makes.

WHY THIS EXISTS
  0032 is the sponsorship and branding ledger: a catalogue of things the show
  sells that are not floor space, and one allocation row per UNIT sold. Its whole
  value is a guarantee -- that the single delegate lanyard cannot be promised to
  two sponsors -- and that guarantee is a PARTIAL UNIQUE INDEX whose failure
  modes are both silent and both expensive:

      not partial  -> a released unit can never be resold, and the sales team
                      works around the database instead of with it
      not unique   -> the lanyard is sold twice and nobody finds out until the
                      print order goes in

  Neither raises in the browser. So both are asserted here, against the real
  migration file, in real sqlite3.

  0032 also does something 0030 did not have to: it sells MULTI-UNIT items. Two
  water bottle brands, twelve guide pages, unlimited badges. The index guards
  (event_id, item_id, unit_no), which is exactly the right guarantee and is NOT
  the whole job -- keeping unit_no inside quantity_available spans two tables and
  no SQLite constraint can express it. That cap lives in the allocation route,
  which makes it the single most likely thing to be got wrong later, so the rule
  is implemented ONCE here in next_unit_no() as the reference the route must
  mirror, and the loophole it closes is asserted in both directions:

      * both units of a 2-unit item sell             -> allowed
      * a third sale of that item                    -> refused BY THE RULE
      * a third row forced in at unit_no = 3         -> the DATABASE ALLOWS IT
                                                        (proof the cap is not the
                                                        index's job, and that the
                                                        drift query is needed)
      * releasing unit 1 frees UNIT 1, not unit 3    -> the next sale reuses it

USAGE
    python scripts/verify-sellable-items.py             # verify, then print the catalogue
    python scripts/verify-sellable-items.py --verify    # assertions only
    python scripts/verify-sellable-items.py --catalogue # the catalogue table only

Exit status is non-zero on any failure, so this is safe to wire into a check.

THE MIGRATION IS LOADED TWICE, on purpose. Cloudflare deploys do not run
migrations; 0032 is applied by hand, and a file applied by hand eventually gets
applied again. Every statement in it is IF NOT EXISTS / INSERT OR IGNORE and the
second load must therefore change nothing at all -- including not overwriting a
price the owner has since confirmed in the portal, which is asserted by editing
one and re-applying the file on top of it.

EVERY PRICE IN THE SEED IS A PLACEHOLDER. The totals below are hard-coded so that
a hand-edit of the SQL trips an assertion and somebody looks -- exactly as
gen-booth-seed.py hard-codes Rs 1,82,90,000 -- NOT because Rs 1,76,01,000 is a
number anyone has agreed to. It is the sum of two dozen guesses. See the header of
0032 before quoting any of it.
"""

import os
import sqlite3
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIGRATION = os.path.join(REPO, "migrations", "0032_sellable_items.sql")

# 0032 references no other table -- no app_settings row, no FK outside itself --
# so unlike gen-booth-seed.py there are no prerequisite migrations to replay.
PREREQ_MIGRATIONS = ()

GST_PERCENT = 18

# The venue's own GST state code, used to exercise BOTH branches of the
# place-of-supply question -- an in-state sponsor and an out-of-state one. It does
# not answer that question and nothing in the schema depends on it: see the
# buyer_state_code comment in 0032. WTC Mumbai, Cuffe Parade -> Maharashtra -> 27.
VENUE_STATE_CODE = "27"

# What the seed must add up to. Hard-coded so a hand-edit trips the assertion.
# Placeholders every one -- the point of pinning them is that they stop being
# QUIETLY editable, not that they are right.
EXPECTED_ITEMS = 26
EXPECTED_UNLIMITED_ITEMS = 2
EXPECTED_CAPPED_UNITS = 109
EXPECTED_CAPPED_VALUE_INR = 17_601_000       # Rs 1,76,01,000 ex-GST, every unit at list

# category -> (items, capped units, capped value). None/None means the category is
# unlimited and has no ceiling to total.
EXPECTED_BY_CATEGORY = {
    "sponsorship":       (6, 20, 12_100_000),
    "delegate_kit":      (5,  6,  1_300_000),
    "venue_branding":    (6, 49,  2_250_000),
    "digital":           (3,  8,  1_250_000),
    "publication":       (4, 26,    701_000),
    "exhibitor_service": (2, None,     None),
}

CATEGORY_ORDER = (
    "sponsorship",
    "delegate_kit",
    "venue_branding",
    "digital",
    "publication",
    "exhibitor_service",
)

# The commercial record is deliberately IDENTICAL to booth_allocations, so a
# receivables report can UNION the two tables instead of learning two schemas.
# Asserted by name, because a rename here is how that union silently stops
# balancing.
SHARED_COMMERCIAL_COLUMNS = (
    "company_name", "contact_name", "email", "phone",
    "status", "amount_inr", "list_price_inr", "discount_inr",
    "gst_inr", "grand_total_inr", "invoice_number", "invoice_date",
    "amount_paid_inr", "paid_date", "payment_status",
    "hold_expires_at", "released_at", "tds_deducted_inr", "balance_due_date",
    "buyer_gstin", "buyer_legal_name", "buyer_state_code",
    "notes", "allocated_by", "created_at", "updated_at",
)


def gst_inr(amount_inr):
    """18% GST on a whole-rupee amount, in whole rupees, half-up.

    Integer arithmetic end to end, matching gen-booth-seed.py exactly: no float
    ever touches money, so the Python here, the SQL and the worker cannot round
    three different ways.
    """
    return (int(amount_inr) * GST_PERCENT + 50) // 100


def cgst_sgst_inr(gst_total):
    """Split a whole-rupee GST figure into (CGST, SGST) without losing a rupee.

    Only meaningful if the place of supply turns out to be intra-state, which is
    UNRESOLVED -- and may resolve DIFFERENTLY for sponsorship than for stand
    space, see buyer_state_code in 0032. It lives here so the one property that
    holds whichever way it lands can be asserted: the halves are integers and
    they sum to gst_inr EXACTLY. Which half carries the odd rupee is the
    accountant's call; that it is not silently lost is not.
    """
    half = int(gst_total) // 2
    return half + (int(gst_total) - 2 * half), half


def inr(n):
    """Indian digit grouping, for the report only: 17601000 -> 1,76,01,000."""
    n = int(n)
    s = str(abs(n))
    if len(s) > 3:
        head, tail, parts = s[:-3], s[-3:], []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts + [tail])
    return ("-" if n < 0 else "") + s


# ---------------------------------------------------------------------------
# THE REFERENCE IMPLEMENTATION OF THE CAP.
#
# This is the rule the allocation route in src/index.tsx must mirror, and the
# reason it is written out here rather than described: 0032's guarantee stops at
# "no two live rows on one unit", and everything that keeps unit_no inside
# quantity_available is application code. One implementation, asserted.
# ---------------------------------------------------------------------------
def next_unit_no(db, item_id, event_id=1):
    """Lowest positive unit_no not currently LIVE on this item, or None if sold out.

    Lowest-free rather than MAX+1, and the difference is the whole point:
    releasing unit 2 of a 2-unit item has to free UNIT 2, and MAX+1 would hand the
    next buyer unit 3 on an item that has only two -- an oversell by way of a
    number that looks tidy.

    Returns None when quantity_available is not NULL and every unit up to it is
    live: that is 'sold out', and the caller must answer 409 rather than insert.
    A NULL quantity_available is UNLIMITED and never sells out.

    Racy by nature, and deliberately left so. Two operators can compute the same
    number in the same second; the partial unique index decides which of them got
    it and the loser gets an IntegrityError to translate into a 409 and retry.
    Do not paper over that with a lock -- the index IS the lock.
    """
    (cap,) = db.execute(
        "SELECT quantity_available FROM sellable_items WHERE id = ?", (item_id,)
    ).fetchone()
    live = {
        row[0]
        for row in db.execute(
            "SELECT unit_no FROM item_allocations"
            " WHERE event_id = ? AND item_id = ? AND released_at IS NULL",
            (event_id, item_id),
        )
    }
    n = 1
    while n in live:
        n += 1
    if cap is not None and n > cap:
        return None
    return n


# The drift query from 0032's header, verbatim. Whatever sweeps lapsed holds
# should run this too; it must always return nothing.
OVERSELL_QUERY = """
SELECT a.id, i.code, a.unit_no, i.quantity_available
  FROM item_allocations a JOIN sellable_items i ON i.id = a.item_id
 WHERE a.released_at IS NULL
   AND i.quantity_available IS NOT NULL
   AND a.unit_no > i.quantity_available
"""


def load(twice=True):
    """Apply the real migration to an in-memory database, twice."""
    if not os.path.exists(MIGRATION):
        raise SystemExit("missing %s" % MIGRATION)
    with open(MIGRATION, encoding="utf-8") as fh:
        sql = fh.read()
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys=ON")
    for name in PREREQ_MIGRATIONS:
        with open(os.path.join(os.path.dirname(MIGRATION), name), encoding="utf-8") as fh:
            db.executescript(fh.read())
    db.executescript(sql)
    if twice:
        db.executescript(sql)
    return db, sql


def verify():
    db, sql = load()
    fail = []

    def check(label, ok, detail=""):
        print("%s  %s%s" % ("PASS" if ok else "FAIL", label,
                            ("  -- " + detail) if detail and not ok else ""))
        if not ok:
            fail.append(label)

    def item(code):
        row = db.execute(
            "SELECT id, quantity_available, list_price_inr FROM sellable_items"
            " WHERE code = ?", (code,)).fetchone()
        if row is None:
            raise SystemExit("seed has no item %r -- the catalogue changed" % code)
        return row

    def alloc(item_id, who, unit_no=None, **kw):
        """Insert an allocation. unit_no=None means 'use the rule'."""
        if unit_no is None:
            unit_no = next_unit_no(db, item_id)
            if unit_no is None:
                raise ValueError("sold out")
        cols = ["item_id", "unit_no", "company_name"] + list(kw)
        db.execute(
            "INSERT INTO item_allocations (%s) VALUES (%s)"
            % (",".join(cols), ",".join("?" * len(cols))),
            [item_id, unit_no, who] + list(kw.values()),
        )
        return db.execute("SELECT last_insert_rowid()").fetchone()[0]

    def live_units(item_id):
        return sorted(r[0] for r in db.execute(
            "SELECT unit_no FROM item_allocations"
            " WHERE item_id = ? AND released_at IS NULL", (item_id,)))

    # -----------------------------------------------------------------------
    # Idempotence. The file was already applied twice by load().
    # -----------------------------------------------------------------------
    (total,) = db.execute("SELECT COUNT(*) FROM sellable_items").fetchone()
    check("applying the migration TWICE leaves %d catalogue rows, not %d"
          % (EXPECTED_ITEMS, EXPECTED_ITEMS * 2),
          total == EXPECTED_ITEMS, "got %d" % total)

    (dupes,) = db.execute(
        "SELECT COUNT(*) FROM (SELECT code FROM sellable_items"
        " GROUP BY event_id, code HAVING COUNT(*) > 1)").fetchone()
    check("no duplicate codes", dupes == 0, "%d duplicated" % dupes)

    # The reason INSERT OR IGNORE matters more here than in 0030: every seeded
    # price is a placeholder awaiting the owner, so re-applying this file over a
    # database where they have been confirmed must not put the guesses back.
    db.execute("UPDATE sellable_items SET list_price_inr = 999999 WHERE code = 'DK-LANYARD'")
    db.executescript(sql)
    (kept,) = db.execute(
        "SELECT list_price_inr FROM sellable_items WHERE code = 'DK-LANYARD'").fetchone()
    check("re-applying the file does NOT overwrite a price the owner has confirmed",
          kept == 999999, "placeholder came back as %s" % kept)
    db.execute("UPDATE sellable_items SET list_price_inr = 300000 WHERE code = 'DK-LANYARD'")

    # -----------------------------------------------------------------------
    # The catalogue itself.
    # -----------------------------------------------------------------------
    (unlimited,) = db.execute(
        "SELECT COUNT(*) FROM sellable_items WHERE quantity_available IS NULL").fetchone()
    check("%d items are UNLIMITED (quantity_available IS NULL)" % EXPECTED_UNLIMITED_ITEMS,
          unlimited == EXPECTED_UNLIMITED_ITEMS, "got %d" % unlimited)

    (units,) = db.execute(
        "SELECT COALESCE(SUM(quantity_available), 0) FROM sellable_items").fetchone()
    check("the capped items carry %d units between them" % EXPECTED_CAPPED_UNITS,
          units == EXPECTED_CAPPED_UNITS, "got %d" % units)

    (value,) = db.execute(
        "SELECT COALESCE(SUM(quantity_available * list_price_inr), 0) FROM sellable_items"
    ).fetchone()
    check("capped catalogue totals Rs %s ex-GST at list" % inr(EXPECTED_CAPPED_VALUE_INR),
          value == EXPECTED_CAPPED_VALUE_INR, "got Rs %s" % inr(value))

    for cat in CATEGORY_ORDER:
        want_items, want_units, want_value = EXPECTED_BY_CATEGORY[cat]
        got = db.execute(
            "SELECT COUNT(*), SUM(quantity_available),"
            "       SUM(quantity_available * list_price_inr)"
            " FROM sellable_items WHERE category = ?", (cat,)).fetchone()
        check("category %-18s = %d items, %s units, Rs %s"
              % (cat, want_items,
                 "unlimited" if want_units is None else want_units,
                 "n/a" if want_value is None else inr(want_value)),
              (got[0], got[1], got[2]) == (want_items, want_units, want_value),
              "got %s" % (got,))

    (uncategorised,) = db.execute(
        "SELECT COUNT(*) FROM sellable_items WHERE category NOT IN (%s)"
        % ",".join("'%s'" % c for c in CATEGORY_ORDER)).fetchone()
    check("every item falls in one of the %d known categories" % len(CATEGORY_ORDER),
          uncategorised == 0, "%d stray" % uncategorised)

    (free,) = db.execute(
        "SELECT COUNT(*) FROM sellable_items WHERE list_price_inr <= 0").fetchone()
    check("nothing is seeded at or below zero rupees -- an unpriced row is a "
          "promise waiting to be made by accident",
          free == 0, "%d at <= 0" % free)

    (labelled,) = db.execute(
        "SELECT COUNT(*) FROM sellable_items"
        " WHERE unit_label IS NULL OR TRIM(unit_label) = ''").fetchone()
    check("every item says what ONE unit is -- a quantity of 2 is otherwise "
          "ambiguous between two brands and two bottles",
          labelled == 0, "%d unlabelled" % labelled)

    (dup_sort,) = db.execute(
        "SELECT COUNT(*) FROM (SELECT sort_order FROM sellable_items"
        " GROUP BY event_id, sort_order HAVING COUNT(*) > 1)").fetchone()
    check("sort_order is unique, so the sales screen has one stable order",
          dup_sort == 0, "%d collisions" % dup_sort)

    # A quantity of zero is not a smaller number than one -- it is an item that
    # can never be sold and is silently missing from availability forever.
    try:
        db.execute("INSERT INTO sellable_items (code, category, name, quantity_available,"
                   " list_price_inr) VALUES ('ZZ-ZERO', 'digital', 'Zero', 0, 1)")
        check("quantity_available = 0 is rejected (0 is not 'unlimited', NULL is)", False,
              "the insert succeeded -- an unsellable row is now in the catalogue")
    except sqlite3.IntegrityError:
        check("quantity_available = 0 is rejected (0 is not 'unlimited', NULL is)", True)

    # -----------------------------------------------------------------------
    # Schema shape. The guarantee, and the commercial columns it has to carry.
    # -----------------------------------------------------------------------
    cols = {r[1] for r in db.execute("PRAGMA table_info(item_allocations)")}
    missing = [c for c in SHARED_COMMERCIAL_COLUMNS if c not in cols]
    check("item_allocations carries all %d commercial columns of booth_allocations, "
          "by the same names -- so a receivables report can UNION the two"
          % len(SHARED_COMMERCIAL_COLUMNS),
          not missing, "missing %s" % missing)
    check("...plus item_id and unit_no, which are what replace booth_id",
          {"item_id", "unit_no"} <= cols, "have %s" % sorted(cols & {"item_id", "unit_no"}))

    idx = {r[1]: r for r in db.execute("PRAGMA index_list(item_allocations)")}
    check("the partial unique index idx_item_alloc_live exists",
          "idx_item_alloc_live" in idx, "indexes: %s" % sorted(idx))
    if "idx_item_alloc_live" in idx:
        row = idx["idx_item_alloc_live"]
        check("it is UNIQUE", row[2] == 1, "unique flag %s" % row[2])
        check("it is PARTIAL -- sqlite reports partial=1", row[4] == 1,
              "partial flag %s: a full index would block every resale" % row[4])
        got_cols = [r[2] for r in db.execute("PRAGMA index_info(idx_item_alloc_live)")]
        check("it spans exactly (event_id, item_id, unit_no)",
              got_cols == ["event_id", "item_id", "unit_no"], "spans %s" % got_cols)
        (idx_sql,) = db.execute(
            "SELECT sql FROM sqlite_master WHERE type='index'"
            " AND name='idx_item_alloc_live'").fetchone()
        flat = " ".join((idx_sql or "").split()).lower()
        check("its predicate is exactly `WHERE released_at IS NULL`",
              flat.endswith("where released_at is null"), "%s" % idx_sql)

    # A leftover UNIQUE(event_id, item_id, unit_no) table constraint would not
    # conflict with the partial index -- it would silently override it. Both get
    # enforced, the stricter one wins, and resale after release starts failing
    # against an index that is behaving perfectly.
    table_unique = []
    for name, row in idx.items():
        if row[3] != "u":
            continue
        c = [r[2] for r in db.execute("PRAGMA index_info(%s)" % name)]
        if set(c) >= {"event_id", "item_id", "unit_no"}:
            table_unique.append((name, c))
    check("no UNIQUE table constraint on (event_id, item_id, unit_no) survives -- "
          "it would silently override the partial index",
          not table_unique, "%s" % table_unique)

    fks = [r[2] for r in db.execute("PRAGMA foreign_key_list(item_allocations)")]
    check("item_allocations has a FOREIGN KEY to sellable_items, so a catalogue row "
          "cannot be deleted out from under a sale",
          fks == ["sellable_items"], "references %s" % fks)

    # -----------------------------------------------------------------------
    # THE THREE MULTI-UNIT CASES. Water bottle branding: 2 units, 2 brands.
    # -----------------------------------------------------------------------
    water_id, water_cap, water_price = item("DK-WATER")
    check("DK-WATER is the 2-unit item the multi-unit model exists for",
          water_cap == 2, "quantity_available = %s" % water_cap)

    # CASE 1 -- selling BOTH units succeeds.
    u1 = next_unit_no(db, water_id)
    a1 = alloc(water_id, "First Beverage Brand Ltd", unit_no=u1, status="confirmed",
               invoice_number="BAI/2026/0201", payment_status="paid")
    u2 = next_unit_no(db, water_id)
    try:
        a2 = alloc(water_id, "Second Beverage Brand Ltd", unit_no=u2, status="confirmed",
                   invoice_number="BAI/2026/0202")
        ok2 = True
    except sqlite3.IntegrityError as exc:
        a2, ok2 = None, False
        check("CASE 1: both units of a 2-unit item sell", False,
              "second unit rejected: %s -- unit_no is not in the index" % exc)
    if ok2:
        check("CASE 1: both units of a 2-unit item sell -- units %s to two different brands"
              % (live_units(water_id),),
              (u1, u2) == (1, 2) and live_units(water_id) == [1, 2],
              "units %s" % (live_units(water_id),))

    # ...and two live rows on the SAME unit are still rejected, which is the half
    # of the guarantee that 0030 already had.
    try:
        alloc(water_id, "Interloper Drinks Ltd", unit_no=1, status="held")
        check("two LIVE rows on the SAME unit are rejected", False,
              "the second live insert SUCCEEDED -- unit 1 sold twice")
    except sqlite3.IntegrityError:
        check("two LIVE rows on the SAME unit are rejected", True)

    # CASE 2 -- a third sale fails. It fails BY THE RULE, not by the index, and
    # the difference is the most important thing in this file.
    check("CASE 2: a THIRD sale of a 2-unit item is refused -- next_unit_no() "
          "returns None (sold out), so the route answers 409 and never inserts",
          next_unit_no(db, water_id) is None,
          "rule offered unit %s on an item with 2 units" % next_unit_no(db, water_id))

    # The loophole, asserted so nobody believes the database is doing this job.
    third = alloc(water_id, "Overselling Drinks Ltd", unit_no=3, status="held")
    check("CASE 2, the loophole: forcing unit_no = 3 onto a 2-unit item is ACCEPTED "
          "by the database -- the cap is application code, not a constraint",
          third is not None)
    drift = db.execute(OVERSELL_QUERY).fetchall()
    check("...and 0032's drift query catches exactly that row, which is why the "
          "sweep has to run it",
          len(drift) == 1 and drift[0][1] == "DK-WATER" and drift[0][2] == 3,
          "query returned %s" % (drift,))
    db.execute("DELETE FROM item_allocations WHERE id = ?", (third,))
    check("with the forced row gone the drift query is empty again -- an empty "
          "result is the only acceptable steady state",
          db.execute(OVERSELL_QUERY).fetchall() == [])

    # CASE 3 -- releasing one frees EXACTLY that unit.
    db.execute("UPDATE item_allocations SET released_at = '2026-09-10' WHERE id = ?", (a1,))
    freed = next_unit_no(db, water_id)
    check("CASE 3: releasing unit 1 frees UNIT 1 -- the rule offers 1 again, not 3, "
          "which is why it is lowest-free and not MAX+1",
          freed == 1, "rule offered unit %s" % freed)
    try:
        a3 = alloc(water_id, "Third Beverage Brand Ltd", unit_no=freed, status="confirmed",
                   invoice_number="BAI/2026/0203")
        check("...and that unit can actually be RESOLD past the partial index", True)
    except sqlite3.IntegrityError as exc:
        a3 = None
        check("...and that unit can actually be RESOLD past the partial index", False,
              "resale rejected: %s -- the index is not partial" % exc)

    keptrow = db.execute(
        "SELECT company_name, invoice_number, payment_status, released_at"
        " FROM item_allocations WHERE id = ?", (a1,)).fetchone()
    check("release is not DELETE: the released row keeps its invoice, so a credit "
          "note still has something to refer to",
          keptrow is not None and keptrow[1] == "BAI/2026/0201" and keptrow[3] is not None,
          "%s" % (keptrow,))

    rows_on_water = db.execute(
        "SELECT COUNT(*) FROM item_allocations WHERE item_id = ?", (water_id,)).fetchone()[0]
    check("a released row and two live rows coexist on the same 2-unit item",
          (rows_on_water, live_units(water_id)) == (3, [1, 2]),
          "rows=%d live=%s" % (rows_on_water, live_units(water_id)))
    check("the item is sold out again once the freed unit is resold",
          next_unit_no(db, water_id) is None)

    # -----------------------------------------------------------------------
    # The 1-unit item -- where this table degenerates to exactly 0030.
    # -----------------------------------------------------------------------
    lan_id = item("DK-LANYARD")[0]
    alloc(lan_id, "Sole Lanyard Sponsor Ltd", status="confirmed",
          invoice_number="BAI/2026/0210")
    check("the single lanyard is unit 1", live_units(lan_id) == [1],
          "units %s" % (live_units(lan_id),))
    check("a second lanyard sponsor is refused by the rule",
          next_unit_no(db, lan_id) is None)
    try:
        alloc(lan_id, "Rival Lanyard Sponsor Ltd", unit_no=1, status="held")
        check("...and refused by the DATABASE even if the rule is bypassed -- there "
              "is exactly one lanyard and no way to print a second", False,
              "the lanyard was sold twice")
    except sqlite3.IntegrityError:
        check("...and refused by the DATABASE even if the rule is bypassed -- there "
              "is exactly one lanyard and no way to print a second", True)

    # -----------------------------------------------------------------------
    # The UNLIMITED item -- where the cap disappears and the index changes job.
    # -----------------------------------------------------------------------
    badge_id, badge_cap, badge_price = item("EX-BADGE")
    check("EX-BADGE is UNLIMITED (quantity_available IS NULL), not capped at some "
          "invented ceiling", badge_cap is None, "cap = %s" % badge_cap)
    for n in range(1, 26):
        alloc(badge_id, "Exhibitor %d Pvt Ltd" % n, status="confirmed")
    check("25 badges sell with no ceiling, numbered 1..25",
          live_units(badge_id) == list(range(1, 26)),
          "units %s" % (live_units(badge_id)[:5],))
    check("an unlimited item never reports sold out",
          next_unit_no(db, badge_id) == 26, "rule offered %s" % next_unit_no(db, badge_id))
    try:
        alloc(badge_id, "Duplicate Badge Ltd", unit_no=7, status="held")
        check("unlimited does NOT mean unguarded: unit 7 is still unique while live",
              False, "two live rows now claim badge 7")
    except sqlite3.IntegrityError:
        check("unlimited does NOT mean unguarded: unit 7 is still unique while live", True)
    db.execute("UPDATE item_allocations SET released_at = '2026-09-10'"
               " WHERE item_id = ? AND unit_no = 7", (badge_id,))
    check("releasing badge 7 hands 7 back to the next buyer, not 26",
          next_unit_no(db, badge_id) == 7, "rule offered %s" % next_unit_no(db, badge_id))
    alloc(badge_id, "Replacement Badge Ltd", status="confirmed")
    check("the unlimited item still has no gaps and no duplicates after a turnover",
          live_units(badge_id) == list(range(1, 26)))

    # unit_no = 0 collides with a NULL coalesced to 0 on one phantom unit, so the
    # symptom is "the second sale of every item fails" and the cause is nowhere
    # near the error.
    for bad in (0, -1):
        try:
            alloc(badge_id, "Bad Unit Ltd", unit_no=bad)
            check("unit_no = %d is rejected by the CHECK" % bad, False,
                  "a non-positive unit went in")
        except sqlite3.IntegrityError:
            check("unit_no = %d is rejected by the CHECK" % bad, True)

    # -----------------------------------------------------------------------
    # Holds. The clock is advisory -- the index cannot tell the time.
    # -----------------------------------------------------------------------
    page_id, page_cap, page_price = item("PB-FULL")
    alloc(page_id, "Lapsed Option Ltd", status="held", hold_expires_at="2026-01-01")
    check("a LAPSED hold still occupies its unit until something sweeps it -- "
          "the rule skips unit 1 and offers unit 2",
          next_unit_no(db, page_id) == 2, "rule offered %s" % next_unit_no(db, page_id))
    (lapsed,) = db.execute(
        "SELECT COUNT(*) FROM item_allocations WHERE status = 'held'"
        " AND released_at IS NULL AND hold_expires_at IS NOT NULL"
        " AND hold_expires_at < '2026-09-10'").fetchone()
    check("lapsed holds are findable in one query, so the sweep has something to sweep",
          lapsed == 1, "%d found" % lapsed)
    (never_expiring,) = db.execute(
        "SELECT COUNT(*) FROM item_allocations"
        " WHERE status IN ('confirmed', 'blocked') AND hold_expires_at IS NOT NULL"
    ).fetchone()
    check("no confirmed or blocked row carries an expiry -- a sale is not on loan",
          never_expiring == 0, "%d dated" % never_expiring)

    # 'blocked' occupies the unit without being a sale: the ministry partner's
    # lanyard, the host's own page.
    ifc_id = item("PB-IFC")[0]
    alloc(ifc_id, "Reserved -- host advertisement", status="blocked")
    check("a 'blocked' unit occupies the item exactly like a sale does",
          next_unit_no(db, ifc_id) is None)
    (blocked_revenue,) = db.execute(
        "SELECT COALESCE(SUM(amount_inr), 0) FROM item_allocations"
        " WHERE status = 'blocked'").fetchone()
    check("...but contributes nothing to revenue", blocked_revenue == 0,
          "Rs %s booked against a block" % inr(blocked_revenue))

    # -----------------------------------------------------------------------
    # Money. Whole rupees, the 0030 invariant, TDS, and the unresolved split.
    # -----------------------------------------------------------------------
    track_id, track_cap, track_price = item("SP-TRACK")
    discount = 50_000
    amount = track_price - discount
    tax = gst_inr(amount)
    grand = amount + tax
    deal = alloc(track_id, "Discounted Track Sponsor Ltd", status="confirmed",
                 list_price_inr=track_price, discount_inr=discount, amount_inr=amount,
                 gst_inr=tax, grand_total_inr=grand,
                 invoice_number="BAI/2026/0220", invoice_date="2026-09-10",
                 buyer_legal_name="Discounted Track Sponsor Private Limited",
                 buyer_gstin="29ABCDE1234F1Z5", buyer_state_code="29",
                 balance_due_date="2026-10-31", payment_status="invoiced",
                 allocated_by="sales")
    got = db.execute(
        "SELECT list_price_inr, discount_inr, amount_inr, gst_inr, grand_total_inr"
        " FROM item_allocations WHERE id = ?", (deal,)).fetchone()
    check("amount_inr = list_price_inr - discount_inr", got[2] == got[0] - got[1], "%s" % (got,))
    check("gst_inr = 18%% of amount_inr, whole rupees (Rs %s)" % inr(tax),
          got[3] == gst_inr(got[2]), "%s" % (got,))
    check("grand_total_inr = amount_inr + gst_inr", got[4] == got[2] + got[3], "%s" % (got,))
    check("every money column is an INTEGER -- no float rupee reaches an invoice",
          all(isinstance(v, int) for v in got), "%s" % [type(v).__name__ for v in got])

    # The catalogue price is SNAPSHOTTED, not read live: re-pricing next month
    # must not rewrite a deal already signed. With every price here a placeholder
    # awaiting the owner, that re-pricing is scheduled, not hypothetical.
    db.execute("UPDATE sellable_items SET list_price_inr = 500000 WHERE id = ?", (track_id,))
    (snapshot,) = db.execute(
        "SELECT list_price_inr FROM item_allocations WHERE id = ?", (deal,)).fetchone()
    check("re-pricing the catalogue does NOT rewrite a signed deal -- list_price_inr "
          "on the allocation is a snapshot",
          snapshot == track_price, "deal now reads Rs %s" % inr(snapshot))
    db.execute("UPDATE sellable_items SET list_price_inr = ? WHERE id = ?",
               (track_price, track_id))

    # TDS. A fully settled Indian B2B deal is SHORT by exactly the withholding,
    # permanently -- and sponsorship is squarely a service, so this is the normal
    # case here rather than the exception.
    tds = 30_000
    db.execute(
        "UPDATE item_allocations SET amount_paid_inr = ?, tds_deducted_inr = ?,"
        " payment_status = 'paid', paid_date = '2026-10-15' WHERE id = ?",
        (grand - tds, tds, deal))
    paid, withheld, total_due, pstatus = db.execute(
        "SELECT amount_paid_inr, tds_deducted_inr, grand_total_inr, payment_status"
        " FROM item_allocations WHERE id = ?", (deal,)).fetchone()
    check("settlement identity: amount_paid_inr + tds_deducted_inr = grand_total_inr",
          paid + withheld == total_due, "%d + %d != %d" % (paid, withheld, total_due))
    check("a fully settled deal is marked paid while amount_paid_inr is SHORT by the "
          "TDS -- anything comparing those two chases sponsors who owe nothing",
          pstatus == "paid" and paid < total_due,
          "paid=%s status=%s" % (paid, pstatus))
    (overstated,) = db.execute(
        "SELECT COALESCE(SUM(grand_total_inr - amount_paid_inr), 0) FROM item_allocations"
        " WHERE payment_status = 'paid'").fetchone()
    check("a receivables figure ignoring tds_deducted_inr overstates the debtor book "
          "by exactly Rs %s here -- which is the bug, stated as a number" % inr(tds),
          overstated == tds, "Rs %s" % inr(overstated))
    (real_outstanding,) = db.execute(
        "SELECT COALESCE(SUM(grand_total_inr - amount_paid_inr - tds_deducted_inr), 0)"
        " FROM item_allocations WHERE payment_status = 'paid'").fetchone()
    check("...and including it gives Rs 0 outstanding, which is the truth",
          real_outstanding == 0, "Rs %s" % inr(real_outstanding))

    # The place of supply is UNRESOLVED and may resolve differently here than for
    # stand space. Only the property that holds either way is asserted.
    cgst, sgst = cgst_sgst_inr(tax)
    check("whichever way place of supply lands, IGST %d%% and CGST+SGST come to the "
          "same rupee: %s = %s + %s" % (GST_PERCENT, inr(tax), inr(cgst), inr(sgst)),
          cgst + sgst == tax and isinstance(cgst, int) and isinstance(sgst, int),
          "%s + %s != %s" % (cgst, sgst, tax))
    odd = gst_inr(track_price - 1)          # an amount whose 18% is very likely odd
    c2, s2 = cgst_sgst_inr(odd)
    check("an ODD gst_inr still halves into two integers summing exactly -- the "
          "rupee is assigned, never rounded away twice",
          c2 + s2 == odd and c2 - s2 in (0, 1), "%s + %s != %s" % (c2, s2, odd))
    check("nothing in the schema stores a CGST/SGST split, so neither answer is "
          "baked in before the accountant gives one",
          not [c for c in cols if "cgst" in c or "sgst" in c or "igst" in c],
          "found %s" % [c for c in cols if "gst" in c])
    (in_state,) = db.execute(
        "SELECT COUNT(*) FROM item_allocations WHERE buyer_state_code IS NOT NULL"
        " AND buyer_state_code <> ?", (VENUE_STATE_CODE,)).fetchone()
    check("an out-of-state sponsor is recorded as such (state 29 vs venue %s), so "
          "the IGST answer is implementable the day it arrives" % VENUE_STATE_CODE,
          in_state == 1, "%d found" % in_state)
    (gstin_ok,) = db.execute(
        "SELECT COUNT(*) FROM item_allocations WHERE buyer_gstin IS NOT NULL"
        " AND SUBSTR(buyer_gstin, 1, 2) <> buyer_state_code").fetchone()
    check("buyer_state_code matches the first two characters of buyer_gstin -- the "
          "one cross-check that makes a mismatched pair catchable",
          gstin_ok == 0, "%d mismatched" % gstin_ok)
    (legal,) = db.execute(
        "SELECT COUNT(*) FROM item_allocations WHERE invoice_number IS NOT NULL"
        " AND buyer_legal_name IS NOT NULL AND buyer_legal_name = company_name").fetchone()
    check("the printed brand and the invoiced legal entity are separate columns and "
          "are genuinely different strings on the invoiced deal",
          legal == 0, "%d identical" % legal)

    # The catalogue row behind a sale cannot be deleted; deactivate instead.
    try:
        db.execute("DELETE FROM sellable_items WHERE id = ?", (water_id,))
        check("a catalogue row with sales against it cannot be DELETED", False,
              "the delete succeeded and orphaned its allocations")
    except sqlite3.IntegrityError:
        check("a catalogue row with sales against it cannot be DELETED", True)
    db.execute("UPDATE sellable_items SET is_active = 0 WHERE id = ?", (water_id,))
    (retired,) = db.execute(
        "SELECT COUNT(*) FROM item_allocations a JOIN sellable_items i ON i.id = a.item_id"
        " WHERE i.is_active = 0").fetchone()
    check("...but is_active = 0 retires it while its history survives",
          retired > 0, "%d rows kept" % retired)
    db.execute("UPDATE sellable_items SET is_active = 1 WHERE id = ?", (water_id,))

    # And the whole point, restated at the end: no oversell anywhere.
    check("FINAL: the oversell drift query is empty across every item exercised above",
          db.execute(OVERSELL_QUERY).fetchall() == [])

    print()
    if fail:
        print("%d FAILED: %s" % (len(fail), "; ".join(fail)))
        return 1
    print("all %s checks passed" % "verify")
    return 0


def catalogue(out=sys.stdout):
    db, _ = load()
    rule = "-" * 118
    print(file=out)
    print("BharatAI Innovation 2026 -- sponsorship and branding catalogue "
          "(migration 0032, EVERY PRICE A PLACEHOLDER)", file=out)
    print(rule, file=out)
    print("%-14s %-38s %-14s %9s %14s %16s"
          % ("code", "item", "unit", "units", "unit price", "if all sold"), file=out)
    print(rule, file=out)
    capped_value = 0
    capped_units = 0
    for cat in CATEGORY_ORDER:
        rows = db.execute(
            "SELECT code, name, unit_label, quantity_available, list_price_inr"
            " FROM sellable_items WHERE category = ? ORDER BY sort_order", (cat,)
        ).fetchall()
        if not rows:
            continue
        sub_units = sum(r[3] for r in rows if r[3] is not None)
        sub_value = sum(r[3] * r[4] for r in rows if r[3] is not None)
        unlimited_here = [r for r in rows if r[3] is None]
        print("%s" % cat.replace("_", " ").upper(), file=out)
        for code, name, unit, qty, price in rows:
            print("  %-12s %-38s %-14s %9s %14s %16s"
                  % (code, name[:38], unit,
                     "unlimited" if qty is None else qty,
                     inr(price) + " *",
                     "--" if qty is None else inr(qty * price)), file=out)
        print("  %-12s %-38s %-14s %9s %14s %16s"
              % ("", "subtotal", "", sub_units or "--", "",
                 inr(sub_value) if sub_value else "--"), file=out)
        if unlimited_here:
            print("  %-12s (%d unlimited item(s): no ceiling, so no total to take)"
                  % ("", len(unlimited_here)), file=out)
        capped_units += sub_units
        capped_value += sub_value
    print(rule, file=out)
    (items,) = db.execute("SELECT COUNT(*) FROM sellable_items").fetchone()
    (unl,) = db.execute(
        "SELECT COUNT(*) FROM sellable_items WHERE quantity_available IS NULL").fetchone()
    print("%-14s %-38s %-14s %9d %14s %16s"
          % ("TOTAL", "%d items (%d capped, %d unlimited)" % (items, items - unl, unl),
             "", capped_units, "", inr(capped_value)), file=out)
    print(rule, file=out)
    print("TOTAL POTENTIAL VALUE  Rs %s ex-GST  +  Rs %s GST @ %d%%  =  Rs %s"
          % (inr(capped_value), inr(gst_inr(capped_value)), GST_PERCENT,
             inr(capped_value + gst_inr(capped_value))), file=out)
    print("  ...from the %d CAPPED items only. The %d unlimited items "
          "(extra badges, co-exhibitor listings) have no ceiling and are excluded "
          "rather than assumed to sell some invented number of times."
          % (items - unl, unl), file=out)
    print("  For scale: the exhibition floor (migration 0030) is 93 stands and "
          "Rs 1,82,90,000 ex-GST. That these two land within 4%% of each other is a "
          "property of prices this file invented, not evidence the ratio is right.",
          file=out)
    print(file=out)
    print("*  EVERY PRICE ABOVE IS A PLACEHOLDER. The owner has quoted none of them.",
          file=out)
    print("   They are order-of-magnitude derivations from India Poultry Show, ITPO "
          "AAHAR and Fairfest published rates, adjusted upward for an audience whose "
          "floor sells at ~Rs 32,250/sqm. The per-row reasoning is in the comment "
          "above each row in migrations/0032_sellable_items.sql.", file=out)
    print("   So are the QUANTITIES: 12 branding panels, 12 guide pages, 10 tracks, "
          "4 charging stations. A quantity is as capable of being wrong as a price, "
          "and quantity_available is what the sold-out check reads.", file=out)
    print("   Nothing here may reach a customer-facing quote, a proposal deck or a "
          "rate card until the owner confirms it -- the same flag 0030 puts on the "
          "Premium Booth at Rs 3,22,500, but on every row instead of two.", file=out)
    print("   Confirm prices in the PORTAL, not in the SQL: INSERT OR IGNORE means "
          "re-applying 0032 will never put a placeholder back over a confirmed price.",
          file=out)
    print(file=out)
    return 0


def main(argv):
    args = argv[1:]
    if "--catalogue" in args or "--report" in args:
        return catalogue()
    rc = verify()
    if "--verify" not in args:
        catalogue()
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv))
