-- Migration 0030: exhibition booths -- inventory and allocations.
--
-- The floor plan has been complete and accurate for months: 93 booths, every one
-- with a code, a tier, a size and measured coordinates. It just lives in
-- public/js/floor-plan-data.js as a static `window.BOOTHS` array in which every
-- entry carries a hand-edited `"booked":false`. Marking a booth sold today means
-- editing a JavaScript file and redeploying the site.
--
-- Meanwhile the real sales sit in booth_requests with payment_status and
-- grand_total, and the two have never been connected. preferred_booth_numbers is
-- free text and exhibitors.booth_number is free text, so a paid request never
-- becomes an allocated booth, "which booths are actually left?" has no answer
-- anyone can query, and nothing whatsoever stops booth 51 being sold twice. The
-- guarantee at the bottom of booth_allocations is the point of this migration.
--
-- WHY THE TEAM ALLOCATES AND THE PUBLIC PLAN STAYS READ-ONLY
--   Booths sell at roughly Rs 32,250/sqm on a GST invoice, so the price has to be
--   quoted, not self-served -- the same reasoning that keeps the boardrooms in
--   0029 routing their public CTA to an enquiry. There is deliberately no
--   public self-serve booth picking here. What the public plan gains is live
--   availability (available / held / sold / blocked), which creates urgency
--   without handing over pricing control, and the exhibitor's name appears only
--   once a booth is genuinely sold.
--
-- WHY AN ALLOCATION TABLE AND NOT A STATUS COLUMN ON booths
--   A `status` column on booths would have to be reset by hand when a hold
--   lapses, and it has nowhere to put who holds it, for how much, or against
--   which booth_request. Rows also carry their own history: releasing a booth
--   before any paperwork exists is DELETE of the allocation row, which returns it
--   to available atomically and cannot leave a half-freed booth behind. Once an
--   invoice has been raised the row must NOT be deleted -- a credit note has to
--   refer to something -- so release becomes released_at instead, and the
--   guarantee at the bottom of this table is a PARTIAL index for exactly that
--   reason. 'blocked' is an organiser hold --
--   storage, a sponsor reservation, a fire exit that got drawn as a stand -- not
--   a sale, so it never counts toward sold_sqm.
--
-- WHY THE MONEY SITS ON THE ALLOCATION, AND THE PRICE ON THE BOOTH
--   The team sells booths OFFLINE -- a phone call, an email, a meeting at
--   somebody else's exhibition -- and the salesperson records the deal
--   afterwards. Most exhibitors never submit a portal request at all, so
--   booth_request_id is NULL on the ORDINARY path and there is simply nowhere
--   else for the money to live. Reading the price off booth_requests.grand_total
--   would mean a walk-up sale could not be recorded without first fabricating a
--   request the customer never made. The allocation therefore carries its own
--   commercial record: list, discount, GST, invoice, receipts.
--
--   And the stand itself needs a price, because "subject to availability" is
--   only half an answer. An operator looking at a free stand has to be able to
--   quote it in the same breath, and the unsold half of a revenue target has no
--   value at all until every stand carries one. booths.list_price_inr is the
--   sticker; booth_allocations.list_price_inr is that sticker FROZEN at the
--   moment of sale, so repricing the hall next month cannot silently rewrite a
--   deal that was already signed.
--
-- WHY THE TARGET IS A SETTING AND NOT A CONSTANT
--   app_settings (0005) is already where this app keeps its one-off editable
--   numbers. The booth revenue target is exactly that -- one number sales will
--   revise the first time the layout changes -- so it goes in the key/value
--   store rather than a table of its own. Seeded at the full sellable value so
--   the portal has a denominator on day one, INSERT OR IGNORE so re-running this
--   file can never clobber a target somebody has since edited.
--
-- THE SEED IS GENERATED, NOT TYPED
--   Everything between the markers below comes from scripts/gen-booth-seed.py,
--   which parses public/js/floor-plan-data.js. That file stays the source of
--   truth for geometry -- the fx/fy/fw/fh fractions were measured off the
--   drawing and exist nowhere else. The hall was already redrawn once (the
--   revised WTC layout dropped the old outdoor pads and introduced the 5x2
--   Premium tier); when it is redrawn again, run the generator instead of
--   editing 93 rows by hand:
--
--       python scripts/gen-booth-seed.py --write     # regenerate the block
--       python scripts/gen-booth-seed.py --verify    # assert it in sqlite3
--
--   type_key is the floor plan's own legacy key and `name` is the floor plan's
--   own display string, both copied verbatim. They disagree on purpose -- type
--   'accelerator' displays as "Enterprise Booth" and type 'standard' displays as
--   "Accelerator Booth" (see the note in public/js/floor-plan.js). Re-deriving
--   either from the other is how the admin screen starts contradicting the
--   public plan.
--
-- Additive only, and every statement is IF NOT EXISTS / OR IGNORE, so re-running
-- this file changes nothing. Cloudflare deploys do not run migrations, so the
-- code that reads these tables ships first and must tolerate their absence --
-- see roomBookingEnabled() in src/index.tsx for the pattern.

-- ---------------------------------------------------------------------------
-- The inventory. One row per sellable stand, mirroring the drawing.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS booths (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id   INTEGER NOT NULL DEFAULT 1,
  code       TEXT    NOT NULL,          -- "51", "MP01" -- matches the floor plan labels
  type_key   TEXT    NOT NULL,          -- pod|explorer|innovator|accelerator|standard|premium|enterprise|mega
  name       TEXT    NOT NULL,          -- "Flagship Pavilion" -- the plan's own display name
  dim        TEXT,                      -- "6m x 2m"
  sqm        REAL    NOT NULL DEFAULT 0,
  -- Sticker price for this stand: WHOLE RUPEES, ex-GST, before any concession.
  -- Seeded per tier by scripts/gen-booth-seed.py (LIST_PRICE_INR) but stored per
  -- STAND, so one corner unit can be repriced without inventing an override
  -- table, and so "how much is stand 27?" is a query rather than a lookup in the
  -- admin screen's markup. NOTE the two premium stands (codes 1 and 8) carry a
  -- DERIVED, UNCONFIRMED price -- see the generator's header before quoting them.
  list_price_inr INTEGER NOT NULL DEFAULT 0,
  zone       TEXT,                      -- nullable; only asserted where the layout says so
  fx REAL, fy REAL, fw REAL, fh REAL,   -- fractional coords on the plan image (0..1)
  sort_order INTEGER NOT NULL DEFAULT 0,-- numeric codes ascending, lettered codes last
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id, code)
);

-- The whole inventory is read at once, in plan order, by both the admin list and
-- the public availability payload.
CREATE INDEX IF NOT EXISTS idx_booths_event_sort ON booths(event_id, sort_order);
-- The tier chips on the public plan count availability per type.
CREATE INDEX IF NOT EXISTS idx_booths_type       ON booths(event_id, type_key);

-- ---------------------------------------------------------------------------
-- Who has which booth. Absence of a row IS availability -- there is no
-- 'available' status, because a booth nobody has taken has nothing to record.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS booth_allocations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id         INTEGER NOT NULL DEFAULT 1,
  booth_id         INTEGER NOT NULL,
  booth_request_id INTEGER,                    -- the existing booth_requests row, when there is one
  exhibitor_id     INTEGER,                    -- filled when confirm creates the exhibitors row
  company_name     TEXT    NOT NULL,           -- what the floor plan will show once sold
  contact_name     TEXT,
  email            TEXT,
  phone            TEXT,
  status           TEXT    NOT NULL DEFAULT 'held',  -- held | confirmed | blocked
  amount_inr       INTEGER NOT NULL DEFAULT 0, -- NET agreed price, ex-GST. Unchanged in meaning; see the invariant.

  -- The commercial record. Present because the sale is closed offline and
  -- recorded afterwards, so there is usually no booth_requests row to hang it
  -- on -- see the header. Every figure is WHOLE RUPEES: money in this app is
  -- never a float, because a float rupee becomes 32249.999999 in an invoice
  -- total and the exhibitor is the one who finds out.
  --
  -- INVARIANT, enforced where the numbers are computed and asserted by
  -- scripts/gen-booth-seed.py --verify:
  --     amount_inr      = list_price_inr - discount_inr
  --     gst_inr         = round(amount_inr * 18 / 100)     -- GST is 18%
  --     grand_total_inr = amount_inr + gst_inr
  --
  -- Deliberately NOT a CHECK constraint. Cloudflare deploys do not run
  -- migrations, so the worker ships before this file is applied and its existing
  -- allocate route writes amount_inr on its own; a CHECK would turn each of
  -- those into a runtime IntegrityError against a table whose shape the deployed
  -- code cannot see. The database's job here is the UNIQUE below -- the thing no
  -- amount of application care can guarantee -- not arithmetic the caller does.
  list_price_inr   INTEGER NOT NULL DEFAULT 0, -- the booths row's price, snapshotted at sale
  discount_inr     INTEGER NOT NULL DEFAULT 0, -- what was conceded to close it; 0 on a full-price deal
  gst_inr          INTEGER NOT NULL DEFAULT 0, -- 18% of amount_inr
  grand_total_inr  INTEGER NOT NULL DEFAULT 0, -- amount_inr + gst_inr: what the exhibitor actually owes
  invoice_number   TEXT,                       -- NULL until one is raised; the GST invoice series is 0021's
  invoice_date     DATETIME,
  amount_paid_inr  INTEGER NOT NULL DEFAULT 0, -- cumulative receipts, so a part payment is a number not a guess
  paid_date        DATETIME,                   -- when it was settled (or when the last receipt landed)
  -- pending | invoiced | part_paid | paid | refunded. Money only: whether the
  -- stand is OCCUPIED is `status` above. A refund that also frees the stand is a
  -- DELETE of this row, exactly like any other release.
  payment_status   TEXT    NOT NULL DEFAULT 'pending',

  -- THE OPTION CLOCK AND THE SOFT RELEASE.
  --
  -- When a hold lapses back to available. A 'held' stand is an OPTION the sales
  -- team gave somebody -- "yours until Friday" -- and the reason 0030 has an
  -- allocation table rather than a status column on booths is precisely that
  -- nobody should have to remember to undo one by hand. NULL on 'confirmed' and
  -- on 'blocked': a sale has no expiry, and an organiser block is not on loan to
  -- anyone.
  --
  -- Advisory, NOT enforced. SQLite has no clock of its own, so a lapsed hold goes
  -- on occupying the stand until something sweeps it -- the index at the bottom
  -- cannot tell the time and will keep rejecting a rival booking on a hold that
  -- expired in March. Whatever runs the sweep is what actually frees the stand;
  -- this column only makes "which holds have lapsed?" a query instead of a
  -- spreadsheet somebody maintains.
  hold_expires_at  DATETIME,

  -- The soft release. Deleting the row is still right for a hold that came to
  -- nothing -- no invoice, no trail, nothing worth keeping. But once
  -- invoice_number is populated the row is a tax document's counterparty, and a
  -- credit note referring to a deleted row refers to nothing at all. So a
  -- released sale is stamped here and KEPT: the invoice, the receipts, the TDS,
  -- the discount and who agreed it all survive the stand going back on the
  -- market. NULL means live -- this stand is taken.
  --
  -- This is what forces the guarantee to be a PARTIAL unique index. A plain
  -- UNIQUE(event_id, booth_id) cannot tell "sold twice" from "sold, released,
  -- sold again", so the only way it could keep its promise would be to block the
  -- resale -- the one thing the release exists to allow.
  --
  -- CONSEQUENCE for every reader: deciding whether a stand is TAKEN now requires
  -- `released_at IS NULL`. A row with a date here is history, not occupancy, and
  -- a LEFT JOIN that omits the predicate will show a released stand as still
  -- sold and hide it from the availability count.
  released_at      DATETIME,

  -- SETTLEMENT, AND WHO THE INVOICE IS MADE OUT TO.
  --
  -- Tax deducted at source: the buyer withholds this from the payment and remits
  -- it to the Income Tax Department against the seller's PAN, so it never lands
  -- in the bank. It is a receipt in every sense that matters -- the seller claims
  -- it back against its own liability -- and the invoice is settled when
  --
  --     amount_paid_inr + tds_deducted_inr = grand_total_inr
  --
  -- CONSEQUENCE, and it will bite whatever reads this table: for an Indian B2B
  -- buyer amount_paid_inr will LEGITIMATELY never equal grand_total_inr. A fully
  -- settled deal looks short by exactly the TDS, forever. Anything that decides
  -- "is this paid?" by comparing amount_paid_inr against grand_total_inr will
  -- chase exhibitors who do not owe a rupee, and any outstanding-receivables
  -- figure that ignores this column overstates the debtor book by every rupee of
  -- TDS in it. payment_status answers "is this paid?"; the identity above answers
  -- "does it reconcile?", and they are not the same question.
  --
  -- The rate and the section (194C, 194J and 194I differ, and TDS is deducted on
  -- the taxable value rather than on the GST-inclusive total) are the organiser's
  -- accountant's call and are deliberately not encoded here. Whatever the rate
  -- turns out to be, the settlement identity does not change -- which is why this
  -- is an amount recorded off the buyer's certificate and never one computed from
  -- a rate this file guessed. Whole rupees, like every other figure here.
  tds_deducted_inr INTEGER NOT NULL DEFAULT 0,

  -- When the unpaid remainder falls due. Part payment is the norm -- a deposit on
  -- signature, the balance nearer the show -- and 'part_paid' on its own cannot
  -- say whether that is fine or a problem. NULL when nothing is outstanding.
  balance_due_date DATETIME,

  -- company_name above is what the floor plan prints: the trading name, the name
  -- that goes on the fascia. It is frequently NOT the name that may appear on a
  -- GST invoice, and an invoice made out to a brand instead of to the registered
  -- entity is one the buyer's accounts team sends back. Kept as its own column
  -- rather than overloading company_name, because the plan and the invoice
  -- genuinely want different strings and only one of them is a legal name.
  buyer_gstin      TEXT,                       -- 15 characters; NULL if unregistered
  buyer_legal_name TEXT,                       -- the registered entity, not the fascia name

  -- The buyer's 2-digit GST state code. It is also the first two characters of
  -- buyer_gstin, which is what makes a mismatched pair catchable at all.
  --
  -- UNRESOLVED, and it needs the organiser's accountant rather than a guess in a
  -- migration: the place of supply for exhibition stand space. Treated as
  -- immovable-property-linked, the supply is taxed where the venue is and every
  -- invoice is CGST+SGST no matter where the buyer sits. Treated as a service to
  -- a registered person, it follows the buyer's location and an out-of-state
  -- buyer is IGST instead.
  --
  -- gst_inr is unaffected either way -- 18% is 18%, and IGST 18% comes to the
  -- same rupee as CGST 9 + SGST 9. What changes is how that single figure is
  -- BROKEN OUT on the face of the invoice, and getting it wrong denies the
  -- exhibitor the input credit they are paying for. So the split is not stored:
  -- it is derivable from this column the day the answer arrives, and capturing
  -- the code NOW is what stops either answer requiring somebody to go back to
  -- sixty exhibitors and ask where they are registered. If the split is ever
  -- stored, the halves must be integers summing to gst_inr exactly -- an odd GST
  -- figure does not halve evenly, and a float here loses the one rupee that makes
  -- the invoice not add up.
  buyer_state_code TEXT,                       -- '27' Maharashtra, '29' Karnataka, ...

  notes            TEXT,
  allocated_by     TEXT,                       -- staff username, for the audit trail
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP,

  -- THE GUARANTEE IS NOT ON THIS LINE ANY MORE. It is the partial unique index
  -- below, and it has to be an index rather than the UNIQUE(event_id, booth_id)
  -- table constraint that used to sit here, because released_at means a released
  -- row now STAYS (see the column). A table constraint counts history as
  -- occupancy: it would keep its promise by refusing to let a released stand be
  -- sold again, which is the one thing the release exists to allow.
  --
  -- Do not put UNIQUE(event_id, booth_id) back. It would not conflict with the
  -- index so much as silently override it -- both get enforced, the stricter one
  -- wins, and resale after release starts failing with a constraint error that
  -- points at an index which is behaving perfectly. --verify asserts that no
  -- unique constraint spanning (event_id, booth_id) exists on the table itself.

  -- Unlike 0021/0027/0028/0029, a FOREIGN KEY is safe here. It was avoided there
  -- because a FK on attendee_id would have broken the admin panel's existing
  -- DELETE FROM attendees; booths rows are never deleted by any flow -- the
  -- layout is regenerated, not pruned -- so this constraint can only ever fire
  -- against a genuinely bogus booth_id.
  FOREIGN KEY (booth_id) REFERENCES booths(id)
);

-- THE GUARANTEE. One LIVE allocation per booth, enforced by the database and not
-- by whatever the API remembers to check. Two operators can hit allocate on stand
-- 51 in the same second and SQLite decides which of them got it -- the loser gets
-- an IntegrityError to translate into a 409, not a second sale.
--
-- Partial on released_at IS NULL, so the promise is about what is TAKEN rather
-- than about everything ever recorded. Two live rows on one stand: rejected.
-- Release a stand and sell it again: allowed. Any number of released rows sitting
-- alongside one live row on the same stand: allowed, which is what a stand that
-- has turned over twice actually looks like. status is deliberately not part of
-- the predicate -- every status occupies the stand while it is live, 'blocked'
-- included -- so only released_at decides.
CREATE UNIQUE INDEX IF NOT EXISTS idx_booth_alloc_live
  ON booth_allocations(event_id, booth_id)
  WHERE released_at IS NULL;

-- The plan's LEFT JOIN binds event_id and booth_id together and used to be served
-- by the auto-index behind the UNIQUE table constraint that is now gone. SQLite
-- will only use the partial index above for a query that says `released_at IS
-- NULL`, so this restores exactly what the removed constraint provided and
-- nothing more. It becomes redundant once every reader filters on released_at,
-- and can be dropped on the day that is true.
CREATE INDEX IF NOT EXISTS idx_booth_alloc_booth ON booth_allocations(event_id, booth_id);
-- "Has this paid request been allocated a booth yet?" on the requests screen.
CREATE INDEX IF NOT EXISTS idx_booth_alloc_request   ON booth_allocations(booth_request_id);
-- The held/sold/blocked counters and the sold_sqm total.
CREATE INDEX IF NOT EXISTS idx_booth_alloc_status    ON booth_allocations(event_id, status);
-- "Which booth is this exhibitor on?" from the exhibitor record.
CREATE INDEX IF NOT EXISTS idx_booth_alloc_exhibitor ON booth_allocations(exhibitor_id);

-- ---------------------------------------------------------------------------
-- Seed: the 93 booths of the revised WTC hall layout, generated from
-- public/js/floor-plan-data.js. INSERT OR IGNORE against UNIQUE(event_id, code)
-- so re-running this migration, or re-running the generator over a live table,
-- adds nothing and overwrites nothing.
-- ---------------------------------------------------------------------------
-- >>> BEGIN generated seed -- scripts/gen-booth-seed.py -- do not hand-edit
-- 93 booths, regenerated with: python scripts/gen-booth-seed.py --write
-- 604.3 sqm of stand space, Rs 1,82,90,000 ex-GST if every stand sells at list price.
-- list_price_inr is per-tier (scripts/gen-booth-seed.py LIST_PRICE_INR); the
-- premium rows -- codes 1, 8 -- carry a DERIVED, UNCONFIRMED price. See the header.
INSERT OR IGNORE INTO booths
  (event_id, code, type_key, name, dim, sqm, list_price_inr, zone, fx, fy, fw, fh, sort_order) VALUES
  (1, '1',    'premium',     'Premium Booth',     '5m x 2m',     10,   322500,  NULL,               0.13875, 0.58021, 0.05312, 0.02911, 1),
  (1, '2',    'standard',    'Accelerator Booth', '3m x 3m',     9,    291000,  NULL,               0.0975,  0.5373,  0.04125, 0.04291, 2),
  (1, '3',    'standard',    'Accelerator Booth', '3m x 3m',     9,    291000,  NULL,               0.0975,  0.49439, 0.04125, 0.04291, 3),
  (1, '4',    'standard',    'Accelerator Booth', '3m x 3m',     9,    291000,  NULL,               0.0975,  0.45149, 0.04125, 0.04291, 4),
  (1, '5',    'standard',    'Accelerator Booth', '3m x 3m',     9,    291000,  NULL,               0.0975,  0.40858, 0.04125, 0.04291, 5),
  (1, '6',    'standard',    'Accelerator Booth', '3m x 3m',     9,    291000,  NULL,               0.0975,  0.36567, 0.04125, 0.04291, 6),
  (1, '7',    'standard',    'Accelerator Booth', '3m x 3m',     9,    291000,  NULL,               0.0975,  0.32277, 0.04125, 0.04291, 7),
  (1, '8',    'premium',     'Premium Booth',     '5m x 2m',     10,   322500,  NULL,               0.13875, 0.28913, 0.05563, 0.02911, 8),
  (1, '9',    'standard',    'Accelerator Booth', '3m x 3m',     9,    291000,  NULL,               0.175,   0.34735, 0.04063, 0.04204, 9),
  (1, '10',   'standard',    'Accelerator Booth', '3m x 3m',     9,    291000,  NULL,               0.175,   0.40686, 0.04063, 0.04269, 10),
  (1, '11',   'standard',    'Accelerator Booth', '3m x 3m',     9,    291000,  NULL,               0.175,   0.44955, 0.04063, 0.04269, 11),
  (1, '12',   'standard',    'Accelerator Booth', '3m x 3m',     9,    291000,  NULL,               0.175,   0.50776, 0.04063, 0.04204, 12),
  (1, '13',   'standard',    'Accelerator Booth', '3m x 3m',     9,    291000,  NULL,               0.25438, 0.30466, 0.04063, 0.04237, 13),
  (1, '14',   'standard',    'Accelerator Booth', '3m x 3m',     9,    291000,  NULL,               0.25438, 0.34702, 0.04063, 0.04237, 14),
  (1, '15',   'standard',    'Accelerator Booth', '3m x 3m',     9,    291000,  NULL,               0.25438, 0.40621, 0.04063, 0.04269, 15),
  (1, '16',   'standard',    'Accelerator Booth', '3m x 3m',     9,    291000,  NULL,               0.25438, 0.4489,  0.04063, 0.04269, 16),
  (1, '17',   'standard',    'Accelerator Booth', '3m x 3m',     9,    291000,  NULL,               0.25438, 0.50776, 0.04063, 0.04204, 17),
  (1, '18',   'enterprise',  'Flagship Pavilion', '6m x 2m',     12,   387000,  NULL,               0.24875, 0.58085, 0.08313, 0.02781, 18),
  (1, '19',   'explorer',    'Explorer Booth',    '2m x 2m',     4,    125000,  NULL,               0.3375,  0.54326, 0.02687, 0.02854, 19),
  (1, '20',   'explorer',    'Explorer Booth',    '2m x 2m',     4,    125000,  NULL,               0.3375,  0.51472, 0.02687, 0.02854, 20),
  (1, '21',   'explorer',    'Explorer Booth',    '2m x 2m',     4,    125000,  NULL,               0.3375,  0.48617, 0.02687, 0.02854, 21),
  (1, '22',   'explorer',    'Explorer Booth',    '2m x 2m',     4,    125000,  NULL,               0.3375,  0.45763, 0.02687, 0.02854, 22),
  (1, '23',   'explorer',    'Explorer Booth',    '2m x 2m',     4,    125000,  NULL,               0.3375,  0.42909, 0.02687, 0.02854, 23),
  (1, '24',   'explorer',    'Explorer Booth',    '2m x 2m',     4,    125000,  NULL,               0.3375,  0.40055, 0.02687, 0.02854, 24),
  (1, '25',   'explorer',    'Explorer Booth',    '2m x 2m',     4,    125000,  NULL,               0.3375,  0.37201, 0.02687, 0.02854, 25),
  (1, '26',   'explorer',    'Explorer Booth',    '2m x 2m',     4,    125000,  NULL,               0.3375,  0.34347, 0.02687, 0.02854, 26),
  (1, '27',   'enterprise',  'Flagship Pavilion', '6m x 2m',     12,   387000,  NULL,               0.33687, 0.31371, 0.08313, 0.02846, 27),
  (1, '28',   'enterprise',  'Flagship Pavilion', '6m x 2m',     12,   387000,  NULL,               0.42,    0.31371, 0.08313, 0.02846, 28),
  (1, '29',   'explorer',    'Explorer Booth',    '2m x 2m',     4,    125000,  NULL,               0.3075,  0.24968, 0.02656, 0.02846, 29),
  (1, '30',   'explorer',    'Explorer Booth',    '2m x 2m',     4,    125000,  NULL,               0.33406, 0.24968, 0.02656, 0.02846, 30),
  (1, '31',   'innovator',   'Innovator Booth',   '3m x 2m',     6,    195000,  NULL,               0.36125, 0.24968, 0.04063, 0.02846, 31),
  (1, '32',   'accelerator', 'Enterprise Booth',  '4m x 2m',     8,    258000,  NULL,               0.41563, 0.24968, 0.05437, 0.02846, 32),
  (1, '33',   'accelerator', 'Enterprise Booth',  '4m x 2m',     8,    258000,  NULL,               0.41563, 0.22122, 0.05437, 0.02846, 33),
  (1, '34',   'innovator',   'Innovator Booth',   '3m x 2m',     6,    195000,  NULL,               0.36125, 0.22122, 0.04063, 0.02846, 34),
  (1, '35',   'explorer',    'Explorer Booth',    '2m x 2m',     4,    125000,  NULL,               0.33406, 0.22122, 0.02656, 0.02846, 35),
  (1, '36',   'explorer',    'Explorer Booth',    '2m x 2m',     4,    125000,  NULL,               0.3075,  0.22122, 0.02656, 0.02846, 36),
  (1, '37',   'pod',         'Startup Pod',       '1.5m x 1.5m', 2.25, 38000,   'Startup Pavilion', 0.31,    0.16559, 0.02031, 0.02135, 37),
  (1, '38',   'pod',         'Startup Pod',       '1.5m x 1.5m', 2.25, 38000,   'Startup Pavilion', 0.33031, 0.16559, 0.02031, 0.02135, 38),
  (1, '39',   'pod',         'Startup Pod',       '1.5m x 1.5m', 2.25, 38000,   'Startup Pavilion', 0.35063, 0.16559, 0.02031, 0.02135, 39),
  (1, '40',   'pod',         'Startup Pod',       '1.5m x 1.5m', 2.25, 38000,   'Startup Pavilion', 0.37094, 0.16559, 0.02031, 0.02135, 40),
  (1, '41',   'pod',         'Startup Pod',       '1.5m x 1.5m', 2.25, 38000,   'Startup Pavilion', 0.41187, 0.16559, 0.02042, 0.02135, 41),
  (1, '42',   'pod',         'Startup Pod',       '1.5m x 1.5m', 2.25, 38000,   'Startup Pavilion', 0.43229, 0.16559, 0.02042, 0.02135, 42),
  (1, '43',   'pod',         'Startup Pod',       '1.5m x 1.5m', 2.25, 38000,   'Startup Pavilion', 0.45271, 0.16559, 0.02042, 0.02135, 43),
  (1, '44',   'pod',         'Startup Pod',       '1.5m x 1.5m', 2.25, 38000,   'Startup Pavilion', 0.45271, 0.14424, 0.02042, 0.02135, 44),
  (1, '45',   'pod',         'Startup Pod',       '1.5m x 1.5m', 2.25, 38000,   'Startup Pavilion', 0.43229, 0.14424, 0.02042, 0.02135, 45),
  (1, '46',   'pod',         'Startup Pod',       '1.5m x 1.5m', 2.25, 38000,   'Startup Pavilion', 0.41187, 0.14424, 0.02042, 0.02135, 46),
  (1, '47',   'pod',         'Startup Pod',       '1.5m x 1.5m', 2.25, 38000,   'Startup Pavilion', 0.37094, 0.14424, 0.02031, 0.02135, 47),
  (1, '48',   'pod',         'Startup Pod',       '1.5m x 1.5m', 2.25, 38000,   'Startup Pavilion', 0.35063, 0.14424, 0.02031, 0.02135, 48),
  (1, '49',   'pod',         'Startup Pod',       '1.5m x 1.5m', 2.25, 38000,   'Startup Pavilion', 0.33031, 0.14424, 0.02031, 0.02135, 49),
  (1, '50',   'pod',         'Startup Pod',       '1.5m x 1.5m', 2.25, 38000,   'Startup Pavilion', 0.31,    0.14424, 0.02031, 0.02135, 50),
  (1, '51',   'enterprise',  'Flagship Pavilion', '6m x 2m',     12,   387000,  NULL,               0.22187, 0.06404, 0.08271, 0.03622, 51),
  (1, '52',   'enterprise',  'Flagship Pavilion', '6m x 2m',     12,   387000,  NULL,               0.30458, 0.06404, 0.08271, 0.03622, 52),
  (1, '53',   'enterprise',  'Flagship Pavilion', '6m x 2m',     12,   387000,  NULL,               0.38729, 0.06404, 0.08271, 0.03622, 53),
  (1, '54',   'explorer',    'Explorer Booth',    '2m x 2m',     4,    125000,  NULL,               0.47125, 0.06404, 0.04063, 0.03493, 54),
  (1, '55',   'innovator',   'Innovator Booth',   '3m x 2m',     6,    195000,  NULL,               0.65,    0.55757, 0.0275,  0.04269, 55),
  (1, '56',   'innovator',   'Innovator Booth',   '3m x 2m',     6,    195000,  NULL,               0.65,    0.51488, 0.0275,  0.04269, 56),
  (1, '57',   'innovator',   'Innovator Booth',   '3m x 2m',     6,    195000,  NULL,               0.65125, 0.44308, 0.02625, 0.04204, 57),
  (1, '58',   'innovator',   'Innovator Booth',   '3m x 2m',     6,    195000,  NULL,               0.65125, 0.40103, 0.02625, 0.04204, 58),
  (1, '59',   'standard',    'Accelerator Booth', '3m x 3m',     9,    291000,  NULL,               0.81625, 0.40039, 0.04125, 0.04204, 59),
  (1, '60',   'standard',    'Accelerator Booth', '3m x 3m',     9,    291000,  NULL,               0.8575,  0.40039, 0.04125, 0.04204, 60),
  (1, '61',   'standard',    'Accelerator Booth', '3m x 3m',     9,    291000,  NULL,               0.89875, 0.40039, 0.04125, 0.04204, 61),
  (1, '62',   'pod',         'Startup Pod',       '1.5m x 1.5m', 2.25, 38000,   'Startup Pavilion', 0.72437, 0.40039, 0.01844, 0.02377, 62),
  (1, '63',   'pod',         'Startup Pod',       '1.5m x 1.5m', 2.25, 38000,   'Startup Pavilion', 0.72437, 0.42416, 0.01844, 0.02377, 63),
  (1, '64',   'pod',         'Startup Pod',       '1.5m x 1.5m', 2.25, 38000,   'Startup Pavilion', 0.72437, 0.44793, 0.01844, 0.02377, 64),
  (1, '65',   'pod',         'Startup Pod',       '1.5m x 1.5m', 2.25, 38000,   'Startup Pavilion', 0.72437, 0.4717,  0.01844, 0.02377, 65),
  (1, '66',   'pod',         'Startup Pod',       '1.5m x 1.5m', 2.25, 38000,   'Startup Pavilion', 0.725,   0.51035, 0.01812, 0.02361, 66),
  (1, '67',   'pod',         'Startup Pod',       '1.5m x 1.5m', 2.25, 38000,   'Startup Pavilion', 0.725,   0.53396, 0.01812, 0.02361, 67),
  (1, '68',   'pod',         'Startup Pod',       '1.5m x 1.5m', 2.25, 38000,   'Startup Pavilion', 0.725,   0.55757, 0.01812, 0.02361, 68),
  (1, '69',   'pod',         'Startup Pod',       '1.5m x 1.5m', 2.25, 38000,   'Startup Pavilion', 0.725,   0.58118, 0.01812, 0.02361, 69),
  (1, '70',   'pod',         'Startup Pod',       '1.5m x 1.5m', 2.25, 38000,   'Startup Pavilion', 0.72562, 0.61708, 0.01812, 0.02361, 70),
  (1, '71',   'pod',         'Startup Pod',       '1.5m x 1.5m', 2.25, 38000,   'Startup Pavilion', 0.72562, 0.64069, 0.01812, 0.02361, 71),
  (1, '72',   'pod',         'Startup Pod',       '1.5m x 1.5m', 2.25, 38000,   'Startup Pavilion', 0.74375, 0.64069, 0.01812, 0.02361, 72),
  (1, '73',   'pod',         'Startup Pod',       '1.5m x 1.5m', 2.25, 38000,   'Startup Pavilion', 0.74375, 0.61708, 0.01812, 0.02361, 73),
  (1, '74',   'pod',         'Startup Pod',       '1.5m x 1.5m', 2.25, 38000,   'Startup Pavilion', 0.74313, 0.58118, 0.01812, 0.02361, 74),
  (1, '75',   'pod',         'Startup Pod',       '1.5m x 1.5m', 2.25, 38000,   'Startup Pavilion', 0.74313, 0.55757, 0.01812, 0.02361, 75),
  (1, '76',   'pod',         'Startup Pod',       '1.5m x 1.5m', 2.25, 38000,   'Startup Pavilion', 0.74313, 0.53396, 0.01812, 0.02361, 76),
  (1, '77',   'pod',         'Startup Pod',       '1.5m x 1.5m', 2.25, 38000,   'Startup Pavilion', 0.74313, 0.51035, 0.01812, 0.02361, 77),
  (1, '78',   'pod',         'Startup Pod',       '1.5m x 1.5m', 2.25, 38000,   'Startup Pavilion', 0.74281, 0.4717,  0.01844, 0.02377, 78),
  (1, '79',   'pod',         'Startup Pod',       '1.5m x 1.5m', 2.25, 38000,   'Startup Pavilion', 0.74281, 0.44793, 0.01844, 0.02377, 79),
  (1, '80',   'pod',         'Startup Pod',       '1.5m x 1.5m', 2.25, 38000,   'Startup Pavilion', 0.74281, 0.42416, 0.01844, 0.02377, 80),
  (1, '81',   'pod',         'Startup Pod',       '1.5m x 1.5m', 2.25, 38000,   'Startup Pavilion', 0.74281, 0.40039, 0.01844, 0.02377, 81),
  (1, '82',   'innovator',   'Innovator Booth',   '3m x 2m',     6,    195000,  NULL,               0.81625, 0.51488, 0.02687, 0.04269, 82),
  (1, '83',   'innovator',   'Innovator Booth',   '3m x 2m',     6,    195000,  NULL,               0.81625, 0.55757, 0.02687, 0.04269, 83),
  (1, '84',   'explorer',    'Explorer Booth',    '2m x 2m',     4,    125000,  NULL,               0.81688, 0.61578, 0.02719, 0.02781, 84),
  (1, '85',   'explorer',    'Explorer Booth',    '2m x 2m',     4,    125000,  NULL,               0.84406, 0.61578, 0.02719, 0.02781, 85),
  (1, '86',   'innovator',   'Innovator Booth',   '3m x 2m',     6,    195000,  NULL,               0.84375, 0.5718,  0.02687, 0.04269, 86),
  (1, '87',   'innovator',   'Innovator Booth',   '3m x 2m',     6,    195000,  NULL,               0.84375, 0.52911, 0.02687, 0.04269, 87),
  (1, '88',   'innovator',   'Innovator Booth',   '3m x 2m',     6,    195000,  NULL,               0.84375, 0.48642, 0.02687, 0.04269, 88),
  (1, '89',   'innovator',   'Innovator Booth',   '3m x 2m',     6,    195000,  NULL,               0.91,    0.61514, 0.02625, 0.04204, 89),
  (1, '90',   'innovator',   'Innovator Booth',   '3m x 2m',     6,    195000,  NULL,               0.91,    0.57309, 0.02625, 0.04204, 90),
  (1, '91',   'enterprise',  'Flagship Pavilion', '6m x 2m',     12,   387000,  NULL,               0.90938, 0.48642, 0.02687, 0.08538, 91),
  (1, 'MP01', 'mega',        'Mega Pavilion',     '7m x 7.7m',   53.9, 1740000, 'Mega Pavilion',    0.51625, 0.04851, 0.09688, 0.1229,  92),
  (1, 'MP02', 'mega',        'Mega Pavilion',     '7m x 7.7m',   53.9, 1740000, 'Mega Pavilion',    0.51375, 0.23997, 0.1,     0.1216,  93);
-- <<< END generated seed

-- ---------------------------------------------------------------------------
-- The revenue target. One editable number, so it belongs in the key/value store
-- 0005 already provides -- app_settings(key TEXT PRIMARY KEY, value TEXT NOT
-- NULL, updated_at) -- and not in a table of its own. app_settings is created by
-- migration 0005 and migrations run in order; 0016 already depends on the same
-- thing.
--
-- 18290000 is the full sellable value of the hall: all 93 stands at list, ex-GST
-- (Rs 1,82,90,000 -- of which Rs 6,45,000 rests on the UNCONFIRMED premium
-- price). It is a starting denominator, not a forecast, and the portal edits it.
-- INSERT OR IGNORE against the PRIMARY KEY so re-running this migration over a
-- live database leaves an edited target exactly as sales left it.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('booth_revenue_target_inr', '18290000');
