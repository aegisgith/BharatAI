#!/usr/bin/env python3
"""Generate the booths seed in migrations/0030_booths.sql from the floor plan file.

WHY THIS EXISTS
  The exhibition inventory -- 93 booths, their codes, sizes and their fractional
  coordinates on the plan image -- lives in public/js/floor-plan-data.js as a
  static `window.BOOTHS` array. That file is the surveyed source of truth: the
  fx/fy/fw/fh numbers were measured off the drawing and cannot be re-derived
  from anything else in the repo. Migration 0030 lifts that inventory into D1 so
  a sale can be recorded against a booth instead of against free text.

  The layout has already been redrawn once ("the revised WTC hall layout", which
  dropped the old outdoor pads and added the 5x2 Premium tier) and it will be
  redrawn again. Hand-typing 93 rows is how the plan and the database drift
  apart the second time that happens, and a drifted coordinate does not throw --
  it just draws a hotspot in the wrong place, or nowhere at all.  So the seed is
  generated, and the generator is checked in next to it.

  One-way door on purpose: floor-plan-data.js -> SQL, never the reverse.
  Geometry keeps living in the JS file; only allocation state lives in D1.

USAGE
    python scripts/gen-booth-seed.py            # print the seed block to stdout
    python scripts/gen-booth-seed.py --summary  # counts per category, nothing else
    python scripts/gen-booth-seed.py --verify   # load it into sqlite3 and assert
    python scripts/gen-booth-seed.py --write    # rewrite the marked block in 0030

--verify is the guard rail. Every failure mode here is silent in the browser: a
booth with sqm 0 prices at zero, an fx outside 0..1 draws off the image, and a
duplicated code makes two hotspots fight over one booth. None of them raise.
It loads migrations/0030_booths.sql into an in-memory sqlite3 TWICE -- the file
is applied by hand, so it will be applied twice -- and asserts the 93 stands, the
per-category subtotals, the Rs 1,82,90,000 grand total, the seeded revenue
target, and the commercial invariant amount_inr = list_price_inr - discount_inr.

It also asserts the thing no amount of application care can guarantee: the
PARTIAL unique index that lets a released stand be resold without ever letting
one be sold twice. Two live rows on a stand are rejected; releasing one and
selling again is allowed; released rows accumulate beside the live one. Get that
index wrong in either direction and the failure is expensive and quiet -- a
non-partial index blocks every resale, a non-unique one sells stand 51 twice --
so those assertions run against the real migration file in real sqlite3.

WHAT IS DELIBERATELY NOT COPIED
  `blurb` is per-TIER marketing copy repeated on every row of that tier, not per
  booth data, and `booked` is the hand-edited flag this whole migration exists
  to replace. Neither has a column in the schema.

PRICE IS SEEDED -- BUT NOT FROM THE DATA FILE
  Every stand now carries booths.list_price_inr, because "how much is stand 27?"
  has to be answerable in one query, and because a revenue target is meaningless
  without the value of what is still unsold. The numbers come from LIST_PRICE_INR
  below, transcribed from the admin Booth Inventory screen -- NOT from the
  window.BOOTH_PRICES map sitting in the same data file, which has gone stale.
  --verify cross-checks the two and fails on any divergence not listed in
  KNOWN_PRICE_DIVERGENCE, so neither copy can drift again unnoticed.
"""

import json
import os
import re
import sqlite3
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_JS = os.path.join(REPO, "public", "js", "floor-plan-data.js")
MIGRATION = os.path.join(REPO, "migrations", "0030_booths.sql")

BEGIN_MARK = "-- >>> BEGIN generated seed -- scripts/gen-booth-seed.py -- do not hand-edit"
END_MARK = "-- <<< END generated seed"

# The eight tier keys the floor plan uses. type_key is stored verbatim so the
# admin screen and the public plan cannot disagree about what a booth is.
# NOTE the documented naming quirk in public/js/floor-plan.js: type
# 'accelerator' DISPLAYS as "Enterprise Booth" and type 'standard' DISPLAYS as
# "Accelerator Booth" -- the keys are legacy floor-map identifiers while the
# names follow the exhibition.html package cards by physical size. We therefore
# take `name` from the data file verbatim and never re-derive it from the key.
TYPE_KEYS = (
    "pod",          # 1.5 x 1.5 m -- Startup Pod
    "explorer",     # 2 x 2 m     -- Explorer Booth
    "innovator",    # 3 x 2 m     -- Innovator Booth
    "accelerator",  # 4 x 2 m     -- Enterprise Booth   (quirk)
    "standard",     # 3 x 3 m     -- Accelerator Booth  (quirk)
    "premium",      # 5 x 2 m     -- Premium Booth
    "enterprise",   # 6 x 2 m     -- Flagship Pavilion
    "mega",         # 7 x 7.7 m   -- Mega Pavilion
)

# Zones are asserted only where the layout itself makes them obvious: the pod
# clusters are what exhibition.html sells as the "Startup Pavilion" (the pod
# package literally promises "Listing in startup pavilion"), and MP01/MP02 are
# named Mega Pavilion on the plan. The site advertises "8 industry zones" but no
# zone boundary is drawn anywhere in the repo, so every other booth gets NULL
# rather than a guess the sales team would later have to un-guess.
ZONE_BY_TYPE = {"pod": "Startup Pavilion", "mega": "Mega Pavilion"}

EXPECTED_TOTAL = 93  # what exhibition.html and index.html both advertise

# ---------------------------------------------------------------------------
# PRICE. Whole rupees, ex-GST, per stand: the sticker price before any
# concession. Integers only -- money in this app is whole rupees and never a
# float, because a float rupee becomes 32249.999999 in an invoice total. GST is
# added downstream at GST_PERCENT and is never baked into these figures.
#
# Transcribed from the admin Booth Inventory screen, which is also what the
# inquiry form in src/index.tsx quotes (BOOTH_PRICES there, by display name).
# ---------------------------------------------------------------------------
LIST_PRICE_INR = {
    "pod":            38_000,   # Startup Pod        1.5 x 1.5 m
    "explorer":      125_000,   # Explorer Booth     2 x 2 m
    "innovator":     195_000,   # Innovator Booth    3 x 2 m
    "accelerator":   258_000,   # Enterprise Booth   4 x 2 m   (naming quirk)
    "standard":      291_000,   # Accelerator Booth  3 x 3 m   (naming quirk)
    "enterprise":    387_000,   # Flagship Pavilion  6 x 2 m
    "mega":        1_740_000,   # Mega Pavilion      7 x 7.7 m
    # !!  DERIVED, NOT CONFIRMED  !!
    # The Premium Booth (5 x 2 m) is absent from the Booth Inventory screen
    # entirely, so this is not a quoted price: it is 10 sqm x the ~Rs 32,250/sqm
    # package rate. It affects exactly TWO stands -- codes 1 and 8 -- and
    # Rs 6,45,000 of the Rs 1,82,90,000 total. Get it confirmed by sales before
    # it reaches a customer-facing quote, and change it HERE (then --write),
    # never in the SQL.
    "premium":       322_500,
}
UNCONFIRMED_PRICE_TYPES = ("premium",)

# The same data file also carries window.BOOTH_PRICES. It is not the source of
# truth for this seed -- it is only cross-checked, because it is demonstrably
# stale. Anything listed here is a KNOWN, DELIBERATE disagreement; anything not
# listed fails --verify.
KNOWN_PRICE_DIVERGENCE = {
    # type_key: (what floor-plan-data.js says, what we seed, why we win)
    "explorer": (
        129_000, 125_000,
        "floor-plan-data.js still carries the old Rs 1,29,000. The inquiry form "
        "in src/index.tsx and the Booth Inventory screen both say Rs 1,25,000, "
        "and 15 explorer stands x Rs 1,25,000 is the Rs 18,75,000 the floor "
        "plan totals to. Fix the JS map and delete this entry.",
    ),
}

# What the seeded prices must add up to. Hard-coded on purpose: these were
# computed from the real floor plan independently of this script, so a future
# layout change trips the assertion and somebody looks -- instead of the revenue
# target quietly re-deriving itself from whatever happens to be in the file.
EXPECTED_SQM = 604.3
EXPECTED_REVENUE_INR = 18_290_000            # Rs 1,82,90,000 ex-GST, everything at list
EXPECTED_REVENUE_BY_TYPE = {
    "standard":    5_238_000,
    "mega":        3_480_000,
    "enterprise":  2_709_000,
    "innovator":   2_535_000,
    "explorer":    1_875_000,
    "pod":         1_292_000,
    "premium":       645_000,                # the unconfirmed slice
    "accelerator":   516_000,
}

GST_PERCENT = 18

# The venue's own GST state code, used by --verify to exercise BOTH branches of
# the place-of-supply question -- an in-state buyer and an out-of-state one. It
# does not answer that question and nothing in the schema depends on it: see the
# buyer_state_code comment in 0030. WTC Mumbai, Cuffe Parade -> Maharashtra -> 27.
VENUE_STATE_CODE = "27"

# One editable number, so it belongs in the key/value store 0005 already
# provides and not in a table of its own. Seeded with the full sellable value so
# the portal has a denominator on day one, INSERT OR IGNORE so a re-run never
# overwrites an edited target.
TARGET_SETTING_KEY = "booth_revenue_target_inr"

# app_settings is created by 0005, not by 0030 -- migrations run in order, and
# 0016 already relies on the same thing. --verify replays the real prerequisite
# file rather than inventing a second copy of that DDL here.
PREREQ_MIGRATIONS = ("0005_app_settings.sql",)


def gst_inr(amount_inr):
    """18% GST on a whole-rupee amount, in whole rupees, half-up.

    Integer arithmetic end to end: no float ever touches money, so the Python
    here, the SQL and the worker cannot round three different ways.
    """
    return (int(amount_inr) * GST_PERCENT + 50) // 100


def cgst_sgst_inr(gst_total):
    """Split a whole-rupee GST figure into (CGST, SGST) without losing a rupee.

    Only meaningful if the place of supply turns out to be intra-state -- which is
    UNRESOLVED, see buyer_state_code in 0030. It lives here so --verify can prove
    the one property that holds whichever way that lands: the halves are integers
    and they sum to gst_inr EXACTLY. An odd GST figure does not halve evenly, and
    18% of a whole-rupee amount is odd often enough to matter, so the remainder
    rupee is assigned rather than rounded away twice. Which half carries it is the
    accountant's call; that it is not silently lost is not.
    """
    half = int(gst_total) // 2
    return half, int(gst_total) - half


def read_js_array(text, name):
    """Pull `window.NAME=[...];` out of the data file and parse it as JSON.

    The file is machine-generated with double-quoted keys and JSON literals, so
    json.loads is exact -- no JS engine, no eval().
    """
    m = re.search(r"window\.%s\s*=\s*(\[.*?\])\s*;" % re.escape(name), text, re.S)
    if not m:
        raise SystemExit("could not find window.%s in %s" % (name, DATA_JS))
    return json.loads(m.group(1))


def read_js_price_map(text, name):
    """Pull `window.NAME={key:1234,...}` out of the data file.

    A JS object literal with UNQUOTED keys, so json.loads cannot read it and this
    has to be a scrape. It is only ever used for the --verify cross-check, never
    to build SQL. Returns None when the map is gone, which --verify reports as a
    failure rather than quietly reading as agreement.
    """
    m = re.search(r"window\.%s\s*=\s*\{(.*?)\}\s*;" % re.escape(name), text, re.S)
    if not m:
        return None
    return {k: int(v) for k, v in re.findall(r"([A-Za-z_]\w*)\s*:\s*(\d+)", m.group(1))}


def load_js_prices():
    with open(DATA_JS, encoding="utf-8") as fh:
        return read_js_price_map(fh.read(), "BOOTH_PRICES")


def sort_key(code):
    """Numeric codes ascending first, then lettered codes (MP01, MP02) last."""
    return (0, int(code), "") if code.isdigit() else (1, 0, code)


def load_booths():
    with open(DATA_JS, encoding="utf-8") as fh:
        text = fh.read()
    booths = read_js_array(text, "BOOTHS")
    plots = read_js_array(text, "PLOTS")
    if plots:
        # PLOTS are named areas -- cafeteria, VIP lounge, theatres. None is
        # sellable stand space today, so none is seeded. If a future layout adds
        # a sellable plot that is a commercial decision, not a code change, so
        # say it loudly instead of silently importing a cafeteria as a booth.
        print(
            "WARNING: window.PLOTS has %d entries; they are NOT seeded as booths. "
            "Review whether any of them is sellable." % len(plots),
            file=sys.stderr,
        )

    rows = []
    for b in sorted(booths, key=lambda b: sort_key(b["code"])):
        key = b["type"]
        if key not in TYPE_KEYS:
            raise SystemExit("booth %s has unknown type %r" % (b["code"], key))
        rows.append(
            {
                "code": b["code"],
                "type_key": key,
                "name": b["name"],          # verbatim -- see the quirk note above
                "dim": b.get("dim"),
                "sqm": float(b["sqm"]),
                # Priced from the tier, stored per stand: a single stand can be
                # repriced later without inventing a per-stand override table.
                "list_price_inr": LIST_PRICE_INR[key],
                "zone": ZONE_BY_TYPE.get(key),
                "fx": float(b["fx"]),
                "fy": float(b["fy"]),
                "fw": float(b["fw"]),
                "fh": float(b["fh"]),
            }
        )
    for i, r in enumerate(rows, start=1):
        r["sort_order"] = i
    return rows


def lit(v):
    if v is None:
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"


def num(v):
    """Shortest round-tripping form: 2.25 stays 2.25, 12.0 prints as 12."""
    return repr(v) if v != int(v) else str(int(v))


def inr(n):
    """Indian digit grouping, for the report only: 18290000 -> 1,82,90,000.

    Never used to build SQL -- the migration stores plain integers.
    """
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


def build_seed(rows):
    cells = [
        [
            "1,",
            lit(r["code"]) + ",",
            lit(r["type_key"]) + ",",
            lit(r["name"]) + ",",
            lit(r["dim"]) + ",",
            num(r["sqm"]) + ",",
            str(r["list_price_inr"]) + ",",
            lit(r["zone"]) + ",",
            repr(r["fx"]) + ",",
            repr(r["fy"]) + ",",
            repr(r["fw"]) + ",",
            repr(r["fh"]) + ",",
            str(r["sort_order"]),
        ]
        for r in rows
    ]
    widths = [max(len(c[i]) for c in cells) for i in range(len(cells[0]))]
    lines = [
        BEGIN_MARK,
        "-- %d booths, regenerated with: python scripts/gen-booth-seed.py --write"
        % len(rows),
        "-- %s sqm of stand space, Rs %s ex-GST if every stand sells at list price."
        % (num(round(sum(r["sqm"] for r in rows), 2)),
           inr(sum(r["list_price_inr"] for r in rows))),
        "-- list_price_inr is per-tier (scripts/gen-booth-seed.py LIST_PRICE_INR); the",
        "-- premium rows -- codes %s -- carry a DERIVED, UNCONFIRMED price. See the header."
        % ", ".join(r["code"] for r in rows if r["type_key"] in UNCONFIRMED_PRICE_TYPES),
        "INSERT OR IGNORE INTO booths",
        "  (event_id, code, type_key, name, dim, sqm, list_price_inr, zone, fx, fy, fw, fh, sort_order) VALUES",
    ]
    for n, c in enumerate(cells):
        body = " ".join(c[i].ljust(widths[i]) for i in range(len(c))).rstrip()
        lines.append("  (%s)%s" % (body, ";" if n == len(cells) - 1 else ","))
    lines.append(END_MARK)
    return "\n".join(lines) + "\n"


def summarise(rows, out=sys.stdout):
    by_key = {}
    for r in rows:
        by_key.setdefault(r["type_key"], []).append(r)
    rule = "-" * 104
    print("type_key        displays as         booths      sqm      list price         revenue  codes",
          file=out)
    print(rule, file=out)
    for key in TYPE_KEYS:
        got = by_key.get(key, [])
        if not got:
            continue
        names = sorted({r["name"] for r in got})
        if len(names) > 1:
            raise SystemExit("type %s has conflicting names: %s" % (key, names))
        codes = [r["code"] for r in got]
        shown = ", ".join(codes[:5]) + (" ..." if len(codes) > 5 else "")
        price = LIST_PRICE_INR[key]
        print(
            "%-15s %-19s %6d %8s %15s %15s  %s"
            % (key, names[0], len(got),
               num(round(sum(r["sqm"] for r in got), 2)),
               inr(price) + ("*" if key in UNCONFIRMED_PRICE_TYPES else " "),
               inr(price * len(got)), shown),
            file=out,
        )
    print(rule, file=out)
    print(
        "%-15s %-19s %6d %8s %15s %15s"
        % ("TOTAL", "", len(rows), num(round(sum(r["sqm"] for r in rows), 2)),
           "", inr(sum(r["list_price_inr"] for r in rows))),
        file=out,
    )
    at_list = sum(r["list_price_inr"] for r in rows)
    print(
        "if every stand sells at list: Rs %s ex-GST  +  Rs %s GST @ %d%%  =  Rs %s"
        % (inr(at_list), inr(gst_inr(at_list)), GST_PERCENT, inr(at_list + gst_inr(at_list))),
        file=out,
    )
    print(
        "app_settings['%s'] seeds to %s (ex-GST, editable in the portal)"
        % (TARGET_SETTING_KEY, inr(EXPECTED_REVENUE_INR)),
        file=out,
    )
    zoned = {}
    for r in rows:
        zoned[r["zone"]] = zoned.get(r["zone"], 0) + 1
    print(
        "zones: "
        + ", ".join(
            "%s=%d" % (z or "NULL (unzoned)", n)
            for z, n in sorted(zoned.items(), key=lambda kv: (kv[0] is None, kv[0]))
        ),
        file=out,
    )
    for key in UNCONFIRMED_PRICE_TYPES:
        got = by_key.get(key, [])
        if not got:
            continue
        print(
            "* %s = Rs %s is DERIVED (%s sqm x ~Rs 32,250/sqm package rate), NOT confirmed."
            "  %d stand(s): %s.  Rs %s of the total rests on it."
            % (key, inr(LIST_PRICE_INR[key]), num(got[0]["sqm"]), len(got),
               ", ".join(r["code"] for r in got),
               inr(LIST_PRICE_INR[key] * len(got))),
            file=out,
        )
        print(
            "  window.BOOTH_PRICES agrees, but it is the same derivation and not a"
            " second source. Only sales can confirm it.",
            file=out,
        )


def verify(rows, seed):
    """Load the real migration into sqlite3 -- TWICE -- and assert every invariant.

    Twice on purpose. Cloudflare deploys do not run migrations, so this file gets
    applied by hand, and a file applied by hand eventually gets applied again.
    """
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys=ON")
    used_migration = os.path.exists(MIGRATION)
    sql = None
    if used_migration:
        with open(MIGRATION, encoding="utf-8") as fh:
            sql = fh.read()
        if BEGIN_MARK not in sql:
            raise SystemExit("%s has no generated-seed markers; run --write" % MIGRATION)
        # app_settings belongs to 0005, not to 0030. Migrations run in order and
        # 0016 already leans on the same thing, so replay the real prerequisite
        # file rather than keeping a second copy of that DDL here to drift.
        for name in PREREQ_MIGRATIONS:
            with open(os.path.join(os.path.dirname(MIGRATION), name), encoding="utf-8") as fh:
                db.executescript(fh.read())
        db.executescript(sql)
    else:
        db.executescript(
            "CREATE TABLE booths (id INTEGER PRIMARY KEY AUTOINCREMENT,"
            " event_id INTEGER NOT NULL DEFAULT 1, code TEXT NOT NULL, type_key TEXT NOT NULL,"
            " name TEXT NOT NULL, dim TEXT, sqm REAL NOT NULL DEFAULT 0,"
            " list_price_inr INTEGER NOT NULL DEFAULT 0, zone TEXT,"
            " fx REAL, fy REAL, fw REAL, fh REAL, sort_order INTEGER NOT NULL DEFAULT 0,"
            " created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(event_id, code));"
        )
        db.executescript(seed)

    fail = []

    def check(label, ok, detail=""):
        print("%s  %s%s" % ("PASS" if ok else "FAIL", label,
                            ("  -- " + detail) if detail and not ok else ""))
        if not ok:
            fail.append(label)

    (total,) = db.execute("SELECT COUNT(*) FROM booths").fetchone()
    check("row count is %d" % EXPECTED_TOTAL, total == EXPECTED_TOTAL, "got %d" % total)
    check("seed matches the data file", total == len(rows), "file has %d" % len(rows))

    (dupes,) = db.execute(
        "SELECT COUNT(*) FROM (SELECT code FROM booths GROUP BY event_id, code HAVING COUNT(*) > 1)"
    ).fetchone()
    check("no duplicate codes", dupes == 0, "%d duplicated" % dupes)

    (bad_sqm,) = db.execute(
        "SELECT COUNT(*) FROM booths WHERE sqm IS NULL OR sqm <= 0"
    ).fetchone()
    check("every sqm > 0", bad_sqm == 0, "%d bad" % bad_sqm)

    (bad_xy,) = db.execute(
        "SELECT COUNT(*) FROM booths WHERE fx IS NULL OR fy IS NULL OR fw IS NULL OR fh IS NULL"
        " OR fx < 0 OR fx > 1 OR fy < 0 OR fy > 1 OR fw <= 0 OR fw > 1 OR fh <= 0 OR fh > 1"
    ).fetchone()
    check("every fx/fy/fw/fh within 0..1", bad_xy == 0, "%d out of range" % bad_xy)

    (off_plan,) = db.execute(
        "SELECT COUNT(*) FROM booths WHERE fx + fw > 1.0001 OR fy + fh > 1.0001"
    ).fetchone()
    check("no hotspot runs off the plan image", off_plan == 0, "%d overflow" % off_plan)

    (bad_type,) = db.execute(
        "SELECT COUNT(*) FROM booths WHERE type_key NOT IN (%s)"
        % ",".join("'%s'" % t for t in TYPE_KEYS)
    ).fetchone()
    check("every type_key is one of the 8 tiers", bad_type == 0, "%d unknown" % bad_type)

    src = {}
    for r in rows:
        src[r["type_key"]] = src.get(r["type_key"], 0) + 1
    got = dict(db.execute("SELECT type_key, COUNT(*) FROM booths GROUP BY type_key").fetchall())
    check("category counts match the source file", got == src,
          "db=%s file=%s" % (sorted(got.items()), sorted(src.items())))

    names_ok = all(
        db.execute("SELECT name FROM booths WHERE code = ?", (r["code"],)).fetchone()[0] == r["name"]
        for r in rows
    )
    check("names preserved verbatim from the data file", names_ok)

    order = [c for (c,) in db.execute("SELECT code FROM booths ORDER BY sort_order")]
    expect = [r["code"] for r in rows]
    check("sort_order is numeric-ascending then lettered", order == expect,
          "got %s .. %s" % (order[:3], order[-3:]))
    (order_dupes,) = db.execute(
        "SELECT COUNT(*) FROM (SELECT sort_order FROM booths GROUP BY sort_order HAVING COUNT(*) > 1)"
    ).fetchone()
    check("sort_order is unique", order_dupes == 0)

    # -----------------------------------------------------------------------
    # PRICE. The seeded numbers have to reproduce the floor plan's own totals
    # exactly. Those totals were computed off the real plan independently of
    # this script, so a mismatch means somebody has to look -- rather than the
    # revenue target quietly re-deriving itself from whatever is in the file.
    # -----------------------------------------------------------------------
    (unpriced,) = db.execute(
        "SELECT COUNT(*) FROM booths WHERE list_price_inr IS NULL OR list_price_inr <= 0"
    ).fetchone()
    check("every stand carries a list price > 0", unpriced == 0, "%d unpriced" % unpriced)

    (fractional,) = db.execute(
        "SELECT COUNT(*) FROM booths WHERE CAST(list_price_inr AS INTEGER) <> list_price_inr"
    ).fetchone()
    check("every list price is whole rupees, never a float", fractional == 0,
          "%d fractional" % fractional)

    priced = db.execute(
        "SELECT type_key, COUNT(*), MIN(list_price_inr), MAX(list_price_inr), SUM(list_price_inr)"
        " FROM booths GROUP BY type_key"
    ).fetchall()
    mixed = [t for t, n, lo, hi, s in priced if lo != hi]
    check("one list price per tier", not mixed, "tiers priced inconsistently: %s" % mixed)
    wrong = {t: (lo, LIST_PRICE_INR.get(t)) for t, n, lo, hi, s in priced
             if lo != LIST_PRICE_INR.get(t)}
    check("seeded prices match LIST_PRICE_INR", not wrong, "seeded vs expected: %s" % wrong)

    got_rev = {t: s for t, n, lo, hi, s in priced}
    check("per-category revenue reproduces the floor plan", got_rev == EXPECTED_REVENUE_BY_TYPE,
          "db=%s expected=%s" % (sorted(got_rev.items()), sorted(EXPECTED_REVENUE_BY_TYPE.items())))
    check("the per-category subtotals add up to the grand total",
          sum(EXPECTED_REVENUE_BY_TYPE.values()) == EXPECTED_REVENUE_INR,
          "%s vs %s" % (inr(sum(EXPECTED_REVENUE_BY_TYPE.values())), inr(EXPECTED_REVENUE_INR)))

    (total_rev,) = db.execute("SELECT SUM(list_price_inr) FROM booths").fetchone()
    check("everything at list totals Rs %s ex-GST" % inr(EXPECTED_REVENUE_INR),
          total_rev == EXPECTED_REVENUE_INR, "got Rs %s" % inr(total_rev))

    (total_sqm,) = db.execute("SELECT SUM(sqm) FROM booths").fetchone()
    check("stand space totals %s sqm" % num(EXPECTED_SQM),
          abs(total_sqm - EXPECTED_SQM) < 0.005, "got %s" % total_sqm)

    # The same data file also carries window.BOOTH_PRICES. It is NOT the source
    # of truth -- it is demonstrably stale -- but it is what the public plan
    # would quote from, so an unlisted disagreement is a bug in one copy or the
    # other and neither is allowed to drift again unnoticed.
    js_prices = load_js_prices()
    if js_prices is None:
        check("window.BOOTH_PRICES is still there to cross-check", False,
              "the map is gone from %s" % os.path.basename(DATA_JS))
    else:
        unexplained = {}
        for key in sorted(set(js_prices) | set(LIST_PRICE_INR)):
            js, mine = js_prices.get(key), LIST_PRICE_INR.get(key)
            if js == mine:
                continue
            known = KNOWN_PRICE_DIVERGENCE.get(key)
            if known and (known[0], known[1]) == (js, mine):
                continue
            unexplained[key] = "js=%s seed=%s" % (js, mine)
        check("no unexplained divergence from window.BOOTH_PRICES", not unexplained,
              "%s -- fix one side or add it to KNOWN_PRICE_DIVERGENCE" % unexplained)
        stale = [k for k in KNOWN_PRICE_DIVERGENCE if js_prices.get(k) == LIST_PRICE_INR.get(k)]
        check("KNOWN_PRICE_DIVERGENCE carries no stale entries", not stale,
              "%s now agree; delete the entry" % stale)

    if used_migration:
        # -------------------------------------------------------------------
        # The commercial record, and THE guarantee.
        # -------------------------------------------------------------------
        cols = {r[1]: r for r in db.execute("PRAGMA table_info(booth_allocations)")}
        want = {
            "list_price_inr":  ("INTEGER", 1, "0"),
            "discount_inr":    ("INTEGER", 1, "0"),
            "gst_inr":         ("INTEGER", 1, "0"),
            "grand_total_inr": ("INTEGER", 1, "0"),
            "invoice_number":  ("TEXT", 0, None),
            "invoice_date":    ("DATETIME", 0, None),
            "amount_paid_inr": ("INTEGER", 1, "0"),
            "paid_date":       ("DATETIME", 0, None),
            "payment_status":  ("TEXT", 1, "'pending'"),
        }
        # Added once the first real invoices were drafted: the option clock, the
        # soft release, and everything a GST invoice needs that a fascia name is
        # not. Same shape discipline as the nine above -- money INTEGER NOT NULL
        # DEFAULT 0, dates nullable, no float anywhere near a rupee.
        want_settlement = {
            "hold_expires_at":  ("DATETIME", 0, None),
            "released_at":      ("DATETIME", 0, None),
            "tds_deducted_inr": ("INTEGER", 1, "0"),
            "balance_due_date": ("DATETIME", 0, None),
            "buyer_gstin":      ("TEXT", 0, None),
            "buyer_legal_name": ("TEXT", 0, None),
            "buyer_state_code": ("TEXT", 0, None),
        }
        missing = sorted(c for c in want if c not in cols)
        check("booth_allocations has all 9 commercial columns", not missing, "missing %s" % missing)
        missing_s = sorted(c for c in want_settlement if c not in cols)
        check("booth_allocations has all 7 settlement columns", not missing_s,
              "missing %s" % missing_s)
        want = dict(want, **want_settlement)
        shape = {}
        for c, expected in want.items():
            if c not in cols:
                continue
            actual = (cols[c][2].upper(), cols[c][3], cols[c][4])
            if actual != expected:
                shape[c] = "%s want %s" % (actual, expected)
        check("commercial columns typed and defaulted as agreed", not shape, "%s" % shape)
        check("amount_inr kept its name and its meaning", "amount_inr" in cols)

        # THE PRIMARY PATH: a deal closed on the phone. There is no
        # booth_requests row and none is expected -- booth_request_id stays NULL
        # and the allocation carries the whole commercial record itself.
        walkup_id, walkup_list = db.execute(
            "SELECT id, list_price_inr FROM booths WHERE code = '8'").fetchone()
        discount = 22_500
        amount = walkup_list - discount
        gst = gst_inr(amount)
        db.execute(
            "INSERT INTO booth_allocations (booth_id, company_name, contact_name, status,"
            " list_price_inr, discount_inr, amount_inr, gst_inr, grand_total_inr,"
            " invoice_number, invoice_date, amount_paid_inr, paid_date, payment_status, allocated_by)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (walkup_id, "Walk-up Robotics Pvt Ltd", "closed at another expo", "confirmed",
             walkup_list, discount, amount, gst, amount + gst,
             "BAI/2026/0042", "2026-09-10", amount + gst, "2026-09-10", "paid", "sales"),
        )
        w = db.execute(
            "SELECT booth_request_id, exhibitor_id, list_price_inr, discount_inr, amount_inr,"
            " gst_inr, grand_total_inr, amount_paid_inr, payment_status"
            " FROM booth_allocations WHERE booth_id = ?", (walkup_id,)).fetchone()
        check("a manual sale records with no booth_requests row behind it",
              w[0] is None and w[1] is None, "request=%s exhibitor=%s" % (w[0], w[1]))
        check("INVARIANT amount_inr = list_price_inr - discount_inr",
              w[4] == w[2] - w[3], "%d != %d - %d" % (w[4], w[2], w[3]))
        check("gst_inr is 18% of the net, in whole rupees",
              w[5] == gst_inr(w[4]), "%d != %d" % (w[5], gst_inr(w[4])))
        check("grand_total_inr = amount_inr + gst_inr",
              w[6] == w[4] + w[5], "%d != %d + %d" % (w[6], w[4], w[5]))
        check("no float ever reaches the money columns",
              all(isinstance(v, int) for v in w[2:8]), "%s" % (w[2:8],))
        check("a settled deal is 'paid' with receipts equal to the grand total",
              w[8] == "paid" and w[7] == w[6], "%s / %d vs %d" % (w[8], w[7], w[6]))

        # A bare insert -- the shape the already-deployed worker writes, which
        # knows nothing about these columns -- must still land on a coherent,
        # zeroed commercial record rather than an IntegrityError.
        bare_id = db.execute("SELECT id FROM booths WHERE code = '90'").fetchone()[0]
        db.execute(
            "INSERT INTO booth_allocations (booth_id, company_name) VALUES (?, 'Bare Minimum Ltd')",
            (bare_id,),
        )
        d = db.execute(
            "SELECT status, payment_status, list_price_inr, discount_inr, amount_inr, gst_inr,"
            " grand_total_inr, amount_paid_inr, invoice_number, invoice_date, paid_date"
            " FROM booth_allocations WHERE booth_id = ?", (bare_id,)).fetchone()
        check("a minimal insert still defaults to held / pending",
              (d[0], d[1]) == ("held", "pending"), "%s" % (d[:2],))
        check("every new money column defaults to 0 and every new date to NULL",
              tuple(d[2:8]) == (0, 0, 0, 0, 0, 0) and d[8] is None and d[9] is None and d[10] is None,
              "%s" % (d[2:],))
        check("the invariant holds at zero as well", d[4] == d[2] - d[3], "%s" % (d[2:5],))

        # Prove THE guarantee actually bites: one allocation per booth, enforced
        # by the database and not by whatever the API remembers to check.
        bid = db.execute("SELECT id FROM booths WHERE code = '51'").fetchone()[0]
        db.execute(
            "INSERT INTO booth_allocations (booth_id, company_name, status)"
            " VALUES (?, 'Acme AI', 'confirmed')", (bid,)
        )
        try:
            db.execute(
                "INSERT INTO booth_allocations (booth_id, company_name, status)"
                " VALUES (?, 'Rival Corp', 'held')", (bid,)
            )
            check("UNIQUE(event_id, booth_id) blocks a double allocation", False,
                  "the second insert succeeded")
        except sqlite3.IntegrityError:
            check("UNIQUE(event_id, booth_id) blocks a double allocation", True)
        try:
            db.execute(
                "INSERT INTO booth_allocations (booth_id, company_name) VALUES (99999, 'Ghost Ltd')"
            )
            check("FK rejects an allocation on a booth that does not exist", False,
                  "the insert succeeded")
        except sqlite3.IntegrityError:
            check("FK rejects an allocation on a booth that does not exist", True)
        db.execute("DELETE FROM booth_allocations WHERE booth_id = ?", (bid,))
        db.execute(
            "INSERT INTO booth_allocations (booth_id, company_name) VALUES (?, 'Late Arrival')",
            (bid,),
        )
        check("releasing = DELETE, and the booth can be allocated again", True)

        # -------------------------------------------------------------------
        # THE PARTIAL INDEX. The single most important assertion in this file.
        #
        # A released row STAYS, so the old UNIQUE(event_id, booth_id) table
        # constraint cannot be the guarantee any more: it counts history as
        # occupancy and would block every resale. The replacement is a unique
        # index partial on released_at IS NULL, and it is wrong in two opposite
        # and equally quiet ways. Drop the WHERE and no released stand can ever
        # be sold again -- a constraint error on a legitimate sale. Drop the
        # UNIQUE and stand 51 sells twice. Both are asserted here, against the
        # real migration in real sqlite3, because neither shows up in a build.
        # -------------------------------------------------------------------
        idx = {r[1]: r for r in db.execute("PRAGMA index_list(booth_allocations)")}
        live = idx.get("idx_booth_alloc_live")
        check("idx_booth_alloc_live exists", live is not None,
              "indexes present: %s" % sorted(idx))
        if live is not None:
            # PRAGMA index_list: (seq, name, unique, origin, partial)
            check("idx_booth_alloc_live is UNIQUE -- without this, stand 51 sells twice",
                  live[2] == 1, "unique=%s" % live[2])
            check("idx_booth_alloc_live is PARTIAL -- without this, no stand can be resold",
                  live[4] == 1, "partial=%s" % live[4])
            idx_cols = [r[2] for r in db.execute("PRAGMA index_info(idx_booth_alloc_live)")]
            check("idx_booth_alloc_live is keyed on (event_id, booth_id)",
                  idx_cols == ["event_id", "booth_id"], "%s" % idx_cols)
            (idx_sql,) = db.execute(
                "SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_booth_alloc_live'"
            ).fetchone()
            flat = " ".join((idx_sql or "").split()).lower()
            check("its predicate is exactly `WHERE released_at IS NULL`",
                  flat.endswith("where released_at is null"), "%s" % idx_sql)

        # A leftover UNIQUE(event_id, booth_id) on the table would not conflict
        # with the index -- it would silently override it, both enforced and the
        # stricter one winning, so resale fails against an index behaving
        # perfectly. sqlite exposes table constraints as origin 'u' auto-indexes.
        table_unique = []
        for name, row in idx.items():
            if row[3] != "u":
                continue
            c = [r[2] for r in db.execute("PRAGMA index_info(%s)" % name)]
            if set(c) >= {"event_id", "booth_id"}:
                table_unique.append((name, c))
        check("no UNIQUE table constraint on (event_id, booth_id) survives -- it would "
              "silently override the partial index",
              not table_unique, "%s" % table_unique)

        # Stand 52 turns over twice, the way a real one does.
        s52 = db.execute("SELECT id, list_price_inr FROM booths WHERE code = '52'").fetchone()[0]

        def alloc_52(who, **kw):
            cols_ = ["booth_id", "company_name"] + list(kw)
            db.execute(
                "INSERT INTO booth_allocations (%s) VALUES (%s)"
                % (",".join(cols_), ",".join("?" * len(cols_))),
                [s52, who] + list(kw.values()),
            )
            return db.execute("SELECT last_insert_rowid()").fetchone()[0]

        def live_on_52():
            return db.execute(
                "SELECT COUNT(*) FROM booth_allocations"
                " WHERE booth_id = ? AND released_at IS NULL", (s52,)).fetchone()[0]

        first = alloc_52("First Buyer Ltd", status="confirmed",
                         invoice_number="BAI/2026/0101", payment_status="paid")
        try:
            alloc_52("Double Seller Ltd", status="held")
            check("two LIVE allocations on one stand are still rejected", False,
                  "the second live insert SUCCEEDED -- stand sold twice")
        except sqlite3.IntegrityError:
            check("two LIVE allocations on one stand are still rejected", True)

        # The soft release: stamp it, do not delete it.
        db.execute("UPDATE booth_allocations SET released_at = '2026-09-10' WHERE id = ?",
                   (first,))
        try:
            second = alloc_52("Second Buyer Ltd", status="confirmed",
                              invoice_number="BAI/2026/0102")
            check("releasing a stand lets it be SOLD AGAIN", True)
        except sqlite3.IntegrityError as exc:
            second = None
            check("releasing a stand lets it be SOLD AGAIN", False,
                  "resale rejected: %s -- the index is not partial" % exc)

        kept = db.execute(
            "SELECT company_name, invoice_number, payment_status, released_at"
            " FROM booth_allocations WHERE id = ?", (first,)).fetchone()
        check("release is not DELETE: the released row keeps its invoice, so a credit "
              "note still has something to refer to",
              kept is not None and kept[1] == "BAI/2026/0101" and kept[3] is not None,
              "%s" % (kept,))

        if second is not None:
            db.execute("UPDATE booth_allocations SET released_at = '2026-09-11' WHERE id = ?",
                       (second,))
            alloc_52("Third Buyer Ltd", status="confirmed")
        total_52 = db.execute(
            "SELECT COUNT(*) FROM booth_allocations WHERE booth_id = ?", (s52,)).fetchone()[0]
        check("two released rows and one live row coexist on the same stand",
              (total_52, live_on_52()) == (3, 1), "rows=%d live=%d" % (total_52, live_on_52()))
        try:
            alloc_52("Opportunist Ltd", status="held")
            check("a second live row is STILL rejected once releases are present", False,
                  "double sale slipped past the index after a release")
        except sqlite3.IntegrityError:
            check("a second live row is STILL rejected once releases are present", True)

        check("released rows drop out of the live count -- occupancy is `released_at IS NULL`",
              live_on_52() == 1, "%d live rows on one stand" % live_on_52())

        # Expiry is advisory. The index cannot tell the time, so a lapsed hold
        # goes on occupying the stand until something sweeps it -- which is a
        # property of this design, not a bug, and is asserted so nobody builds a
        # release flow on the assumption that the database does it for them.
        s53 = db.execute("SELECT id FROM booths WHERE code = '53'").fetchone()[0]
        db.execute(
            "INSERT INTO booth_allocations (booth_id, company_name, status, hold_expires_at)"
            " VALUES (?, 'Lapsed Option Ltd', 'held', '2026-01-01')", (s53,))
        try:
            db.execute("INSERT INTO booth_allocations (booth_id, company_name)"
                       " VALUES (?, 'Rival Corp')", (s53,))
            check("a LAPSED hold still occupies the stand until something sweeps it", False,
                  "the rival insert succeeded -- expiry is not self-enforcing, but "
                  "something has started behaving as if it were")
        except sqlite3.IntegrityError:
            check("a LAPSED hold still occupies the stand until something sweeps it", True)
        (lapsed,) = db.execute(
            "SELECT COUNT(*) FROM booth_allocations WHERE status = 'held'"
            " AND released_at IS NULL AND hold_expires_at IS NOT NULL"
            " AND hold_expires_at < '2026-09-10'").fetchone()
        check("lapsed holds are findable in one query, so the sweep has something to sweep",
              lapsed == 1, "%d found" % lapsed)
        (never_expiring,) = db.execute(
            "SELECT COUNT(*) FROM booth_allocations"
            " WHERE status IN ('confirmed', 'blocked') AND hold_expires_at IS NOT NULL"
        ).fetchone()
        check("no confirmed or blocked row carries an expiry -- a sale is not on loan",
              never_expiring == 0, "%d dated" % never_expiring)

        # -------------------------------------------------------------------
        # TDS. The buyer withholds it and remits it against the seller's PAN, so
        # it never reaches the bank -- and a fully settled Indian B2B deal is
        # therefore SHORT by exactly that amount, permanently.
        # -------------------------------------------------------------------
        s54_id, s54_list = db.execute(
            "SELECT id, list_price_inr FROM booths WHERE code = '54'").fetchone()
        t_amount = s54_list                       # no discount; keeps the arithmetic legible
        t_gst = gst_inr(t_amount)
        t_grand = t_amount + t_gst
        t_tds = t_amount * 2 // 100               # illustrative rate ONLY -- see 0030
        db.execute(
            "INSERT INTO booth_allocations (booth_id, company_name, buyer_legal_name, status,"
            " list_price_inr, amount_inr, gst_inr, grand_total_inr, invoice_number,"
            " amount_paid_inr, tds_deducted_inr, payment_status, buyer_gstin, buyer_state_code)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (s54_id, "Northbound AI", "Northbound Technologies Private Limited", "confirmed",
             s54_list, t_amount, t_gst, t_grand, "BAI/2026/0103",
             t_grand - t_tds, t_tds, "paid", "29ABCDE1234F1Z5", "29"),
        )
        t = db.execute(
            "SELECT amount_inr, gst_inr, grand_total_inr, amount_paid_inr, tds_deducted_inr,"
            " payment_status, company_name, buyer_legal_name, buyer_gstin, buyer_state_code"
            " FROM booth_allocations WHERE booth_id = ?", (s54_id,)).fetchone()
        check("SETTLEMENT amount_paid_inr + tds_deducted_inr = grand_total_inr",
              t[3] + t[4] == t[2], "%d + %d != %d" % (t[3], t[4], t[2]))
        check("a fully settled B2B deal is legitimately SHORT of the grand total",
              t[3] < t[2] and t[5] == "paid", "paid=%d grand=%d status=%s" % (t[3], t[2], t[5]))
        # The trap, stated as an assertion so nobody re-introduces it: this is the
        # test a receivables report reaches for first, and on this row it is wrong.
        check("the naive `amount_paid_inr >= grand_total_inr` test WOULD misread this row "
              "as outstanding -- use payment_status, not the subtraction",
              not (t[3] >= t[2]), "the fixture no longer demonstrates the trap")
        check("TDS is whole rupees and never a float",
              isinstance(t[4], int) and t[4] > 0, "%r" % (t[4],))
        (no_tds,) = db.execute(
            "SELECT tds_deducted_inr FROM booth_allocations WHERE booth_id = ?",
            (walkup_id,)).fetchone()
        check("a buyer who withholds nothing leaves tds_deducted_inr at 0, and then "
              "amount_paid_inr does equal grand_total_inr",
              no_tds == 0 and w[7] == w[6], "tds=%s paid=%d grand=%d" % (no_tds, w[7], w[6]))

        # -------------------------------------------------------------------
        # GST place of supply -- UNRESOLVED, see buyer_state_code in 0030. What
        # is asserted here is only what holds whichever way it lands.
        # -------------------------------------------------------------------
        check("buyer_state_code is the first two characters of buyer_gstin",
              t[8][:2] == t[9], "gstin=%s state=%s" % (t[8], t[9]))
        check("the legal name on the invoice is stored apart from the fascia name",
              t[6] != t[7] and t[7].endswith("Private Limited"), "%s / %s" % (t[6], t[7]))
        igst = t[1]
        cgst, sgst = cgst_sgst_inr(t[1])
        check("IGST and CGST+SGST come to the same gst_inr -- only the breakout differs, "
              "which is why the split is derived and not stored",
              cgst + sgst == igst == t[1], "%d + %d vs %d" % (cgst, sgst, igst))
        check("the fixture buyer is out-of-state, so both branches are real",
              t[9] != VENUE_STATE_CODE, "buyer is in %s, the venue's own state" % t[9])
        # An odd GST figure is where a float would quietly lose the rupee that
        # makes the invoice not add up, so the split is proved on one.
        odd_amount = 310_150
        odd_gst = gst_inr(odd_amount)
        odd_c, odd_s = cgst_sgst_inr(odd_gst)
        check("the odd-GST fixture really is odd, or it proves nothing", odd_gst % 2 == 1,
              "gst on Rs %s is %s, which is even" % (inr(odd_amount), inr(odd_gst)))
        check("an odd gst_inr still splits into two INTEGERS summing to it exactly",
              odd_c + odd_s == odd_gst and isinstance(odd_c, int) and isinstance(odd_s, int),
              "%r + %r != %r" % (odd_c, odd_s, odd_gst))

        # The already-deployed worker writes none of these columns. Its bare
        # insert must still land on a coherent row: live, unexpired, untaxed.
        n = db.execute(
            "SELECT hold_expires_at, released_at, tds_deducted_inr, balance_due_date,"
            " buyer_gstin, buyer_legal_name, buyer_state_code"
            " FROM booth_allocations WHERE booth_id = ?", (bare_id,)).fetchone()
        check("a bare insert defaults every new date and buyer field to NULL and TDS to 0",
              n == (None, None, 0, None, None, None, None), "%s" % (n,))
        check("a bare insert is LIVE -- released_at NULL is what makes it occupy the stand",
              n[1] is None)

        # -------------------------------------------------------------------
        # The revenue target, then the whole file applied a SECOND time.
        # -------------------------------------------------------------------
        target = (db.execute("SELECT value FROM app_settings WHERE key = ?",
                             (TARGET_SETTING_KEY,)).fetchone() or (None,))[0]
        check("app_settings carries '%s'" % TARGET_SETTING_KEY, target is not None, "row absent")
        check("the seeded target is the full sellable value",
              target == str(EXPECTED_REVENUE_INR), "got %r" % target)
        check("the target equals what the seed itself adds up to",
              target is not None and int(target) == total_rev,
              "target=%r, seed sums to %s" % (target, total_rev))

        before_alloc = db.execute("SELECT COUNT(*) FROM booth_allocations").fetchone()[0]
        db.executescript(sql)                       # <-- the SECOND load
        (again,) = db.execute("SELECT COUNT(*) FROM booths").fetchone()
        check("loading the migration twice still leaves %d booths" % EXPECTED_TOTAL,
              again == total, "%d -> %d" % (total, again))
        (rev_again,) = db.execute("SELECT SUM(list_price_inr) FROM booths").fetchone()
        check("loading it twice does not double the revenue",
              rev_again == EXPECTED_REVENUE_INR, "Rs %s" % inr(rev_again))
        (alloc_again,) = db.execute("SELECT COUNT(*) FROM booth_allocations").fetchone()
        check("loading it twice leaves live allocations untouched",
              alloc_again == before_alloc, "%d -> %d" % (before_alloc, alloc_again))
        # CREATE UNIQUE INDEX IF NOT EXISTS over a table that already holds
        # released rows is the re-apply case that would actually throw if the
        # predicate were ever dropped: the released rows on stand 52 collide the
        # moment the index stops being partial.
        idx2 = {r[1]: r for r in db.execute("PRAGMA index_list(booth_allocations)")}
        check("re-applying over released rows leaves the partial index intact",
              "idx_booth_alloc_live" in idx2 and idx2["idx_booth_alloc_live"][2] == 1
              and idx2["idx_booth_alloc_live"][4] == 1,
              "%s" % (idx2.get("idx_booth_alloc_live"),))
        try:
            db.execute("INSERT INTO booth_allocations (booth_id, company_name)"
                       " VALUES (?, 'Post Reapply Ltd')", (s52,))
            check("the guarantee still bites after the file is applied twice", False,
                  "a second live row landed on stand 52 after the re-apply")
        except sqlite3.IntegrityError:
            check("the guarantee still bites after the file is applied twice", True)

        # INSERT OR IGNORE and not an UPDATE, so a target sales has since revised
        # is never dragged back to the seeded number by a routine re-apply.
        db.execute("UPDATE app_settings SET value = '25000000' WHERE key = ?", (TARGET_SETTING_KEY,))
        db.executescript(sql)
        edited = (db.execute("SELECT value FROM app_settings WHERE key = ?",
                             (TARGET_SETTING_KEY,)).fetchone() or (None,))[0]
        check("an edited revenue target survives a re-run", edited == "25000000",
              "clobbered back to %r" % edited)
    else:
        print("note: %s not found -- verified the seed against inline DDL only" % MIGRATION)

    print()
    summarise(rows)
    print()
    if fail:
        print("FAILED: %s" % ", ".join(fail))
        return 1
    print("all checks ok (%d booths, Rs %s ex-GST at list)" % (total, inr(total_rev)))
    return 0


def write_block(seed):
    if not os.path.exists(MIGRATION):
        raise SystemExit(
            "%s does not exist. Create it with the seed markers first:\n  %s\n  %s"
            % (MIGRATION, BEGIN_MARK, END_MARK)
        )
    with open(MIGRATION, encoding="utf-8") as fh:
        sql = fh.read()
    start, end = sql.find(BEGIN_MARK), sql.find(END_MARK)
    if start < 0 or end < 0:
        raise SystemExit("seed markers not found in %s" % MIGRATION)
    end += len(END_MARK)
    updated = sql[:start] + seed.rstrip("\n") + sql[end:]
    if updated == sql:
        print("%s already up to date" % MIGRATION)
        return
    with open(MIGRATION, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(updated)
    print("rewrote the seed block in %s" % MIGRATION)


def main(argv):
    rows = load_booths()
    seed = build_seed(rows)
    if "--summary" in argv:
        summarise(rows)
    elif "--verify" in argv:
        return verify(rows, seed)
    elif "--write" in argv:
        write_block(seed)
        summarise(rows, out=sys.stderr)
    else:
        sys.stdout.write(seed)
        summarise(rows, out=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
