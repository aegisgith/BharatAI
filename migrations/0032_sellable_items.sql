-- Migration 0032: sponsorship and branding -- catalogue and allocations.
--
-- 0030 gave the hall a ledger. 93 stands, a price on each one, and a partial
-- unique index that makes selling stand 51 twice a constraint error instead of a
-- phone call in November. Everything the show sells that is NOT floor space has
-- none of that. The lanyard, the delegate bag, the registration arch, the Wi-Fi,
-- the back cover of the show guide, the extra exhibitor badge -- all of it is
-- quoted from a deck, agreed over email, and remembered by whoever agreed it.
--
-- There is exactly one lanyard. It can be promised to two sponsors on two
-- different days by two different people and nothing anywhere will say so until
-- the print order goes in. That is the same failure 0030 exists to prevent, on
-- inventory that is scarcer than the floor and priced higher per unit, and this
-- migration is the same answer: a catalogue row per thing, an allocation row per
-- unit sold, and the guarantee in the database rather than in somebody's memory.
--
-- WHY A CATALOGUE TABLE AND NOT A LIST IN THE CODE
--   The obvious cheap version is a constant array in src/index.tsx, the way
--   BOOTH_PRICES lives there. 0030's own header records what that costs: the
--   floor plan's price map and the admin screen's price map disagreed for
--   months, and only a generator cross-checking the two caught it. Sponsorship
--   is worse, because unlike booths there is no drawing to be the source of
--   truth -- the catalogue IS the source of truth, and it will be edited by the
--   owner the first week it is used. A price the owner can change is a row, not
--   a redeploy.
--
-- WHY unit_no EXISTS, WHICH IS THE WHOLE DIFFERENCE FROM 0030
--   A booth is one thing. `booths` has 93 rows because the hall has 93 stands,
--   and (event_id, booth_id) is therefore already a unique enough handle on
--   "which one". Sponsorship inventory does not decompose that way. "Water
--   bottle branding" is ONE catalogue entry that can be sold to TWO brands.
--   "Show guide full page" is one entry sold twelve times. "Additional exhibitor
--   badge" is one entry sold as many times as people ask.
--
--   Modelling that as 12 catalogue rows named "Show Guide Full Page 1" ...
--   "Show Guide Full Page 12" would work and would be wrong: the owner edits the
--   price in twelve places, the sales screen shows twelve near-identical lines,
--   and adding a thirteenth page is a migration. So the catalogue carries
--   quantity_available and the ALLOCATION carries unit_no -- which unit of that
--   entry this sale is. One row per unit sold, exactly as 0030 has one row per
--   stand sold, and the guarantee becomes (event_id, item_id, unit_no).
--
--   quantity_available IS NULL means UNLIMITED. Extra badges and co-exhibitor
--   listings have no venue constraint at all -- the show can print another
--   badge -- and a catalogue that forces a made-up ceiling onto them makes the
--   ceiling the thing that eventually rejects a legitimate sale. NULL is the
--   honest value and every reader has to handle it: COALESCE-ing it to zero
--   turns "unlimited" into "sold out", which is the failure that looks like a
--   working system.
--
-- THE CAP THE DATABASE CANNOT ENFORCE -- READ THIS BEFORE WRITING THE ROUTE
--   The partial unique index below guarantees that no two LIVE rows claim the
--   same unit of the same item. It does NOT and cannot guarantee that unit_no
--   stays within quantity_available, because that number lives on the other
--   table and SQLite CHECK constraints cannot see it. Insert unit_no = 7 against
--   a 2-unit item and the index is perfectly happy: seven is not five, the row
--   goes in, and the show has sold five water bottles it does not have.
--
--   So the allocation route MUST choose unit_no rather than accept it, and the
--   rule that covers both the capped and the unlimited case is one sentence:
--
--       take the LOWEST positive integer not currently live on this item;
--       if quantity_available IS NOT NULL and that integer exceeds it, the item
--       is sold out -- reject with 409, do not insert.
--
--   Lowest-free rather than MAX+1 on purpose. Releasing unit 2 of a 2-unit item
--   has to free unit 2 specifically, and MAX+1 would hand the next buyer unit 3
--   on an item that has only two -- overselling by way of a number that looks
--   tidy. The live unit numbers of one item are a handful of integers; read them
--   and pick the first gap.
--
--   Two operators can still compute the same lowest-free number in the same
--   second. That is what the index is for: the loser gets an IntegrityError to
--   translate into a 409 and retry, not a second sale. For an UNLIMITED item the
--   index therefore stops guarding a ceiling and starts serialising the
--   numbering, which is the correct and only job left for it there.
--
--   Drift is findable in one query, and whatever sweeps lapsed holds should run
--   it too:
--
--       SELECT a.id, i.code, a.unit_no, i.quantity_available
--         FROM item_allocations a JOIN sellable_items i ON i.id = a.item_id
--        WHERE a.released_at IS NULL
--          AND i.quantity_available IS NOT NULL
--          AND a.unit_no > i.quantity_available;
--
--   It must return nothing. A row here is an oversell that has already happened.
--
-- !!  EVERY PRICE IN THE SEED IS A PLACEHOLDER  !!
--   Louder than the premium-booth flag in 0030, because there the unconfirmed
--   number was two stands and Rs 6,45,000 of Rs 1,82,90,000. Here it is EVERY
--   ROW. The owner has not quoted a single one of these figures. They were
--   derived from a scan of what comparable Indian shows publish --
--
--       India Poultry Show : visitor lanyard Rs 1,00,000; water bottle branding
--                            Rs 3,00,000 for each of 2 brands; venue branding
--                            Rs 500/sq ft; welcome banner logo Rs 5,000;
--                            LED wall Rs 25,000
--       ITPO AAHAR         : fair guide advertising Rs 5,250 - 31,500 a page;
--                            additional badges Rs 1,000
--       Fairfest           : co-exhibitor Rs 10,000; extra badge Rs 2,000
--
--   -- and then moved, mostly upward, to sit sensibly beside this show's own
--   floor price of ~Rs 32,250/sqm, which is several times what those shows
--   charge for space. A comparable is a sanity check on an ORDER OF MAGNITUDE.
--   It is not a quote, it is not this show's audience, and the derivation of
--   each row is written above that row so the owner can argue with the reasoning
--   instead of just the number.
--
--   Nothing here may reach a customer-facing quote, a proposal deck or a rate
--   card until the owner has confirmed it. When they do, change the price in the
--   PORTAL -- these rows are editable and INSERT OR IGNORE means re-running this
--   file will never overwrite a confirmed price with a placeholder again.
--
-- WHY NO REVENUE TARGET IS SEEDED, UNLIKE 0030
--   0030 seeded app_settings['booth_revenue_target_inr'] = 18290000 because that
--   figure was the real value of a real hall at prices that were real bar two
--   stands. The equivalent number here would be the sum of prices nobody has
--   quoted, and a denominator on a dashboard is precisely the kind of number
--   that gets read out in a meeting as though somebody chose it. So there is no
--   target row. Whatever reads it must tolerate the key being absent -- it has
--   to anyway, since Cloudflare deploys do not run migrations -- and the day the
--   owner confirms the catalogue it is one INSERT.
--
-- WHAT IS DELIBERATELY NOT IN THIS CATALOGUE
--   Speaking slots. 0026 already owns that pipeline (innovation_talks, with its
--   own status and slot model) and a second, commercial way to get on stage
--   modelled over here would give the programme two sources of truth about who
--   is speaking. If a talk is ever sold, it belongs in 0026's table with a
--   reference to an allocation, not as a catalogue row that quietly books a slot
--   nothing else can see.
--
--   Booth space. That is 0030, and an item row priced per sq ft would be a
--   second, worse answer to a question already answered properly.
--
-- Additive only, and every statement is IF NOT EXISTS / OR IGNORE, so re-running
-- this file changes nothing. Cloudflare deploys do not run migrations, so the
-- code that reads these tables ships first and must tolerate their absence --
-- see boothInventoryEnabled() in src/index.tsx for the pattern: probe once,
-- memoise ONLY the positive result, answer 200 with ready:false until the day
-- the migration lands.

-- ---------------------------------------------------------------------------
-- The catalogue. One row per THING that can be sold, not per unit of it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sellable_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    INTEGER NOT NULL DEFAULT 1,

  -- The stable handle. `name` is marketing copy and WILL be rewritten -- "Title
  -- Sponsor" becomes "Presenting Partner" the first time a deck is redesigned --
  -- so it cannot be the natural key, and a seed keyed on it would insert a
  -- duplicate the next time this file is applied after a rename. code is chosen
  -- once and never edited, which is what makes the INSERT OR IGNORE below
  -- actually idempotent. Same role booths.code plays in 0030.
  code        TEXT    NOT NULL,          -- 'SP-TITLE', 'DK-LANYARD', 'PB-FULL'

  -- How the sales screen groups the list. Free text rather than a lookup table:
  -- six categories the owner will re-cut once do not need referential integrity,
  -- and a second table here is a join on every read for nothing.
  category    TEXT    NOT NULL,          -- sponsorship | delegate_kit | venue_branding | digital | publication | exhibitor_service
  name        TEXT    NOT NULL,          -- what the sales screen and the proposal show
  description TEXT,                      -- one line of what the buyer actually gets

  -- What ONE unit is, in words, for the screen: 'brand', 'page', 'slot',
  -- 'badge'. Purely a label -- nothing computes on it -- but without it a
  -- quantity of 2 on "water bottle branding" is ambiguous between two brands and
  -- two bottles, and the person answering that question is the salesperson on
  -- the phone.
  unit_label  TEXT    NOT NULL DEFAULT 'unit',

  -- How many units exist. NULL means UNLIMITED -- see the header; do NOT
  -- COALESCE it to 0, which turns "we can print more" into "sold out". The cap
  -- is enforced in the allocation route, not here: a CHECK cannot reach across
  -- to item_allocations, and the partial index cannot reach across to this
  -- column.
  quantity_available INTEGER,

  -- Sticker price for ONE unit: WHOLE RUPEES, ex-GST, before any concession.
  -- Integer, like every other figure in this app, because a float rupee becomes
  -- 322499.99999 in an invoice total and the sponsor is the one who finds out.
  -- EVERY SEEDED VALUE IS A PLACEHOLDER. See the header.
  list_price_inr INTEGER NOT NULL DEFAULT 0,

  sort_order  INTEGER NOT NULL DEFAULT 0, -- category blocks in tens, items within them

  -- Retire an item without deleting it. This matters more here than it did for
  -- booths: a stand is never deleted because the hall is regenerated rather than
  -- pruned, but a catalogue row is exactly the kind of thing an owner strikes
  -- out -- "we are not selling the notepad" -- and the FK on item_allocations
  -- will (correctly) refuse to let one go that has ever been sold. Deactivate
  -- instead: history survives, the sales screen stops offering it.
  is_active   INTEGER NOT NULL DEFAULT 1,

  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  -- booths has no updated_at because a stand's row is written once. These rows
  -- are written once and then RE-PRICED, which is the whole expected next event
  -- in this file's life, so when it happened is worth knowing.
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(event_id, code),

  -- 0030 refused CHECK constraints on the money and was right to: the worker
  -- ships before the migration and its own arithmetic would have been the thing
  -- failing. This one is a different animal. It constrains a single column to
  -- its own domain, no deployed code writes to a table that does not exist yet,
  -- and zero here is not a smaller number than one -- it is an item that can
  -- never be sold at all, silently missing from availability forever. NULL stays
  -- legal because NULL is the documented "unlimited".
  CHECK (quantity_available IS NULL OR quantity_available > 0)
);

-- The whole catalogue is read at once, in display order, by the sales screen.
CREATE INDEX IF NOT EXISTS idx_sellable_items_event_sort ON sellable_items(event_id, sort_order);
-- The category blocks on that screen, and "what sponsorship is left?".
CREATE INDEX IF NOT EXISTS idx_sellable_items_category   ON sellable_items(event_id, category, sort_order);

-- ---------------------------------------------------------------------------
-- Who has which unit of which item. Absence of a live row IS availability --
-- there is no 'available' status, because a unit nobody has taken has nothing to
-- record. Structurally this is booth_allocations with booth_id replaced by
-- (item_id, unit_no); the commercial columns are deliberately IDENTICAL in name,
-- type and meaning, so an invoice, a receipt, a TDS certificate or a receivables
-- report can UNION the two tables instead of learning two schemas.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS item_allocations (
  id               INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  event_id         INTEGER NOT NULL DEFAULT 1,
  item_id          INTEGER NOT NULL,

  -- WHICH unit of that item. 1-based. Chosen by the route as the lowest positive
  -- integer not currently live on this item, never supplied by the client -- see
  -- the header. For a 1-unit item it is always 1 and the index degenerates to
  -- exactly 0030's guarantee. For an unlimited item it is a sequence number.
  --
  -- DEFAULT 1 is a deliberate fail-safe rather than a convenience: a caller that
  -- forgets to set it collides on unit 1 and gets a loud 409 on the second sale.
  -- The dangerous direction is the other one -- a caller that computes it wrong
  -- and goes OVER quantity_available -- and nothing in this table can see that.
  unit_no          INTEGER NOT NULL DEFAULT 1,

  -- No booth_request_id and no exhibitor_id here, unlike 0030. There is no
  -- request table for sponsorship -- there is no public self-serve path and
  -- deliberately will not be, for the same reason 0029 routes boardrooms to an
  -- enquiry: this is quoted, not vended. And a sponsor is frequently NOT an
  -- exhibitor: a brand can buy the lanyard without taking a stand, so a FK to
  -- exhibitors would either be NULL on the ordinary path or force a fabricated
  -- exhibitor record. The join to a company that is both is by email today, and
  -- becomes a real column the day something needs it to be one.
  company_name     TEXT    NOT NULL,           -- the brand as it will be printed
  contact_name     TEXT,
  email            TEXT,
  phone            TEXT,

  -- held | confirmed | blocked. Same three as 0030 and the same meanings.
  -- 'blocked' is an organiser hold -- the lanyard kept back for a ministry
  -- partner, a page reserved for the host's own ad -- not a sale, so it never
  -- counts toward revenue while it does occupy the unit.
  status           TEXT    NOT NULL DEFAULT 'held',

  amount_inr       INTEGER NOT NULL DEFAULT 0, -- NET agreed price for this unit, ex-GST

  -- The commercial record, identical to booth_allocations. Every figure is
  -- WHOLE RUPEES.
  --
  -- INVARIANT, enforced where the numbers are computed and asserted by
  -- scripts/verify-sellable-items.py:
  --     amount_inr      = list_price_inr - discount_inr
  --     gst_inr         = round(amount_inr * 18 / 100)     -- GST is 18%
  --     grand_total_inr = amount_inr + gst_inr
  --
  -- Deliberately NOT a CHECK constraint, for the reason 0030 gives at length:
  -- the database's job here is the unique index -- the thing no amount of
  -- application care can guarantee -- and not arithmetic the caller does.
  --
  -- list_price_inr is the sellable_items price SNAPSHOTTED at sale. Re-pricing
  -- the catalogue next month must not silently rewrite a deal already signed --
  -- and with every price in this file a placeholder awaiting the owner, that
  -- re-pricing is not hypothetical, it is scheduled.
  list_price_inr   INTEGER NOT NULL DEFAULT 0,
  discount_inr     INTEGER NOT NULL DEFAULT 0, -- what was conceded to close it; 0 on a full-price deal
  gst_inr          INTEGER NOT NULL DEFAULT 0, -- 18% of amount_inr
  grand_total_inr  INTEGER NOT NULL DEFAULT 0, -- amount_inr + gst_inr: what the sponsor actually owes
  invoice_number   TEXT,                       -- NULL until one is raised; the GST invoice series is 0021's
  invoice_date     DATETIME,
  amount_paid_inr  INTEGER NOT NULL DEFAULT 0, -- cumulative receipts, so a part payment is a number not a guess
  paid_date        DATETIME,                   -- when it was settled (or when the last receipt landed)
  -- pending | invoiced | part_paid | paid | refunded. Money only: whether the
  -- unit is OCCUPIED is `status` above.
  payment_status   TEXT    NOT NULL DEFAULT 'pending',

  -- The option clock. A 'held' unit is an OPTION the sales team gave somebody,
  -- and it bites harder here than on a stand: there is one lanyard, and a
  -- forgotten hold on it blocks the single highest-margin line in the catalogue.
  --
  -- Advisory, NOT enforced. SQLite has no clock of its own, the index below
  -- cannot tell the time, and a hold that expired in March goes on occupying the
  -- unit until something sweeps it. NULL on 'confirmed' and on 'blocked' -- a
  -- sale has no expiry and an organiser block is not on loan to anyone.
  hold_expires_at  DATETIME,

  -- The soft release. Deleting the row is still right for a hold that came to
  -- nothing. Once invoice_number is populated the row is a tax document's
  -- counterparty and a credit note referring to a deleted row refers to nothing,
  -- so a released sale is stamped here and KEPT. NULL means live -- this unit is
  -- taken.
  --
  -- CONSEQUENCE for every reader, and it is 0030's trap with one extra edge:
  -- deciding whether a unit is TAKEN requires `released_at IS NULL`. A row with a
  -- date here is history, not occupancy. A LEFT JOIN that omits the predicate
  -- shows a released unit as still sold, hides it from availability, and -- new
  -- in this table -- makes the lowest-free-unit calculation skip a unit that is
  -- genuinely back on the market, so the next sale silently lands one above the
  -- cap instead of in the gap.
  released_at      DATETIME,

  -- Tax deducted at source. The buyer withholds it and remits it to the Income
  -- Tax Department against the seller's PAN, so it never lands in the bank, and
  -- the invoice is settled when
  --
  --     amount_paid_inr + tds_deducted_inr = grand_total_inr
  --
  -- CONSEQUENCE: for an Indian B2B buyer amount_paid_inr will LEGITIMATELY never
  -- equal grand_total_inr. A fully settled deal looks short by exactly the TDS,
  -- forever. Anything deciding "is this paid?" by comparing the two will chase
  -- sponsors who do not owe a rupee, and any receivables figure ignoring this
  -- column overstates the debtor book by every rupee of TDS in it. Sponsorship
  -- is squarely a service, so this column will be non-zero MORE often here than
  -- on a booth, not less. The rate and the section are the organiser's
  -- accountant's call and are deliberately not encoded: this is an amount
  -- recorded off the buyer's certificate, never one computed from a rate a
  -- migration guessed.
  tds_deducted_inr INTEGER NOT NULL DEFAULT 0,

  -- When the unpaid remainder falls due. Part payment is the norm -- a deposit
  -- on signature, the balance nearer the show -- and 'part_paid' on its own
  -- cannot say whether that is fine or a problem. NULL when nothing is
  -- outstanding.
  balance_due_date DATETIME,

  -- company_name above is the brand that gets PRINTED -- on the lanyard, on the
  -- banner, in the guide. It is frequently NOT the registered entity a GST
  -- invoice must be made out to, and an invoice addressed to a brand instead of
  -- to the legal entity is one the buyer's accounts team sends back.
  buyer_gstin      TEXT,                       -- 15 characters; NULL if unregistered
  buyer_legal_name TEXT,                       -- the registered entity, not the printed brand

  -- The buyer's 2-digit GST state code. It is also the first two characters of
  -- buyer_gstin, which is what makes a mismatched pair catchable at all.
  --
  -- UNRESOLVED and going to the organiser's accountant, exactly as in 0030 --
  -- and note that the answer may legitimately DIFFER between the two tables.
  -- Stand space has an argument for being immovable-property-linked and taxed
  -- where the venue is, making every invoice CGST+SGST whoever the buyer is. A
  -- lanyard print, an email send or a page of advertising has a far weaker one
  -- and would ordinarily follow the recipient's location, making an out-of-state
  -- sponsor IGST. Which is precisely why nothing is hard-coded here: gst_inr is
  -- 18% either way and comes to the same rupee, and only the BREAK-OUT on the
  -- face of the invoice changes -- getting it wrong denies the sponsor the input
  -- credit they are paying for. Capturing the code NOW is what stops either
  -- answer requiring somebody to go back to every sponsor and ask where they are
  -- registered. If the split is ever stored, the halves must be integers summing
  -- to gst_inr EXACTLY -- an odd GST figure does not halve evenly, and a float
  -- here loses the one rupee that makes the invoice not add up.
  buyer_state_code TEXT,                       -- '27' Maharashtra, '29' Karnataka, ...

  notes            TEXT,                       -- artwork deadlines, what was promised, which unit is which
  allocated_by     TEXT,                       -- staff username, for the audit trail
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP,

  -- THE GUARANTEE IS NOT A TABLE CONSTRAINT. It is the partial unique index
  -- below, for the same reason as in 0030: released_at means a released row
  -- STAYS, and a plain UNIQUE(event_id, item_id, unit_no) cannot tell "sold
  -- twice" from "sold, released, sold again". It would keep its promise by
  -- refusing the resale -- the one thing the release exists to allow.
  --
  -- Do not add one. It would not conflict with the index so much as silently
  -- override it: both get enforced, the stricter wins, and resale after release
  -- starts failing against an index that is behaving perfectly.

  -- Safe as a CHECK for the same reasons as the one on sellable_items: single
  -- column, its own domain, no deployed writer. And unit_no = 0 is not a small
  -- bug -- 0, and a NULL coalesced to 0, both collide on one phantom unit, so
  -- the symptom is "the second sale of every item fails" and the cause is
  -- nowhere near the error. The cap that actually matters,
  -- unit_no <= quantity_available, is the one a CHECK cannot express, because it
  -- spans two tables. See the header.
  CHECK (unit_no >= 1),

  -- Safe here, as in 0030: nothing in the app DELETEs from this catalogue as a
  -- matter of course. Unlike booths, though, a catalogue row is something an
  -- owner might genuinely try to delete -- and this constraint refusing to let
  -- one go while a sale points at it is the POINT, not an inconvenience.
  -- Deactivate (is_active = 0) instead.
  FOREIGN KEY (item_id) REFERENCES sellable_items(id)
);

-- THE GUARANTEE. One LIVE allocation per UNIT of an item, enforced by the
-- database and not by whatever the API remembers to check. Two operators can hit
-- allocate on the lanyard in the same second and SQLite decides which of them got
-- it -- the loser gets an IntegrityError to translate into a 409, not a second
-- sale of the only lanyard there is.
--
-- Partial on released_at IS NULL, so the promise is about what is TAKEN rather
-- than about everything ever recorded. Two live rows on one unit: rejected. Both
-- units of a 2-unit item sold at once: allowed, because they differ in unit_no.
-- Release one and sell it again: allowed. Any number of released rows sitting
-- alongside one live row on the same unit: allowed, which is what a unit that has
-- turned over twice actually looks like. status is deliberately not part of the
-- predicate -- every status occupies the unit while it is live, 'blocked'
-- included -- so only released_at decides.
--
-- What it does NOT do is keep unit_no inside quantity_available. See the header.
CREATE UNIQUE INDEX IF NOT EXISTS idx_item_alloc_live
  ON item_allocations(event_id, item_id, unit_no)
  WHERE released_at IS NULL;

-- The availability LEFT JOIN binds event_id and item_id and does not mention
-- unit_no, so it cannot use the partial index above unless it also says
-- `released_at IS NULL`. This covers it either way. It becomes redundant on the
-- day every reader filters on released_at, and can be dropped then.
CREATE INDEX IF NOT EXISTS idx_item_alloc_item    ON item_allocations(event_id, item_id);
-- The held/sold/blocked counters and the revenue rollup.
CREATE INDEX IF NOT EXISTS idx_item_alloc_status  ON item_allocations(event_id, status);
-- The finance screen going the other way: "what is on invoice BAI/2026/0117?" --
-- which, unlike a booth, routinely spans several units of several items on one
-- document.
CREATE INDEX IF NOT EXISTS idx_item_alloc_invoice ON item_allocations(invoice_number);

-- ---------------------------------------------------------------------------
-- Seed: a STARTING catalogue, not a rate card.
--
-- 26 items. Two of them (the exhibitor services) are UNLIMITED; the other 24
-- carry 109 units between them, worth Rs 1,76,01,000 ex-GST if every unit sold at
-- the placeholder price -- a number to sanity-check the SHAPE of the catalogue
-- against, and nothing else. Its closeness to the hall's Rs 1,82,90,000 is a
-- property of prices this file invented, not evidence that the ratio is right.
--
-- !!  EVERY list_price_inr BELOW IS A PLACEHOLDER AWAITING THE OWNER  !!
-- The comment above each row is its derivation, so the reasoning can be argued
-- with and not just the number. Where a comparable exists it is named; where none
-- does, the row says so outright. So are the QUANTITIES: 12 branding panels and
-- 12 guide pages are guesses at what the hall and the publication actually hold,
-- and a quantity is as capable of being wrong as a price.
--
-- Items whose deliverable does not exist at this show -- there may be no welcome
-- banner, no charging stations, no printed guide -- should be DELETED from the
-- catalogue rather than left in it at any price. An unsellable row on the sales
-- screen is a promise waiting to be made by accident. Delete is safe until the
-- row has been sold; after that the FK will stop you, and is_active = 0 is the
-- answer.
--
-- INSERT OR IGNORE against UNIQUE(event_id, code), so re-running this migration
-- adds nothing, overwrites nothing, and can never put a placeholder back over a
-- price the owner has since confirmed in the portal.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO sellable_items
  (event_id, code, category, name, description, unit_label, quantity_available, list_price_inr, sort_order) VALUES

  -- SPONSORSHIP ------------------------------------------------------------
  -- Rs 25,00,000 PLACEHOLDER. No comparable: none of the shows scanned publishes
  -- a title fee. Anchored instead on this show's own top line -- the Mega
  -- Pavilion at Rs 17,40,000 -- on the reasoning that title carries naming rights
  -- ON TOP OF a presence at least that size. It is the single largest number in
  -- this app and the one most likely to be wrong.
  (1, 'SP-TITLE',     'sponsorship',       'Title Sponsor',                         'Naming rights across the event identity, stage, print and digital.', 'naming rights', 1,    2500000, 10),
  -- Rs 12,00,000 PLACEHOLDER, roughly half of title, which is the usual step
  -- down. TWO slots because one co-sponsor reads as a second title and four
  -- dilutes both.
  (1, 'SP-COPOWER',   'sponsorship',       'Co-Powered By Sponsor',                 'Second-tier naming alongside the title sponsor on key surfaces.',    'slot',          2,    1200000, 11),
  -- Rs 6,00,000 PLACEHOLDER, half again. Four slots is about the point at which a
  -- logo row still reads on a backdrop.
  (1, 'SP-ASSOCIATE', 'sponsorship',       'Associate Sponsor',                     'Logo presence across event branding, show guide and website.',       'slot',          4,     600000, 12),
  -- Rs 3,50,000 PLACEHOLDER x 10 tracks. Ten because the event record itself says
  -- "10+ focused tracks" -- the only quantity in this seed taken from something
  -- the show already publishes rather than chosen. Confirm the real track count
  -- before quoting: if there are twelve tracks this is twelve units.
  (1, 'SP-TRACK',     'sponsorship',       'Track Sponsor',                         'Naming of one conference track across its sessions and signage.',    'track',        10,     350000, 13),
  -- Rs 5,00,000 PLACEHOLDER. The Startup Pavilion is a real zone on the floor
  -- plan (30 pods). This sponsors the ZONE; it does not sell the pods, which are
  -- 0030's inventory at Rs 38,000 each and must not be double-sold from here.
  (1, 'SP-STARTUP',   'sponsorship',       'Startup Pavilion Sponsor',              'Naming and branding of the Startup Pavilion zone.',                  'pavilion',      1,     500000, 14),
  -- Rs 4,00,000 PLACEHOLDER x 2 -- one per show day, 20 and 21 November 2026.
  -- Delete both units if no evening reception is actually programmed.
  (1, 'SP-NETWORK',   'sponsorship',       'Networking Reception Sponsor',          'Naming of one evening networking reception (one per show day).',     'reception',     2,     400000, 15),

  -- DELEGATE KIT -----------------------------------------------------------
  -- Rs 3,00,000 PLACEHOLDER. India Poultry Show publishes Rs 1,00,000 for the
  -- visitor lanyard; 3x for a delegate base of up to 5,000 at a conference whose
  -- floor sells at ~Rs 32,250/sqm. THE SINGLE MOST OVERSELLABLE LINE IN THIS
  -- FILE: there is exactly one lanyard and no way to print a second one.
  (1, 'DK-LANYARD',   'delegate_kit',      'Delegate Lanyard Branding',             'Sole brand on every delegate lanyard.',                              'brand',         1,     300000, 20),
  -- Rs 1,50,000 PLACEHOLDER, half the lanyard. No comparable found; the badge
  -- reverse is seen every time a delegate looks down and by almost nobody else.
  (1, 'DK-BADGE',     'delegate_kit',      'Delegate Badge Reverse Branding',       'Sole brand printed on the reverse of every delegate badge.',         'brand',         1,     150000, 21),
  -- Rs 3,50,000 PLACEHOLDER, slightly ABOVE the lanyard: the bag leaves the venue
  -- and goes on being carried. Delete if no delegate bag is being produced.
  (1, 'DK-BAG',       'delegate_kit',      'Delegate Bag Branding',                 'Sole brand on the delegate bag.',                                    'brand',         1,     350000, 22),
  -- Rs 2,00,000 PLACEHOLDER x 2 brands. India Poultry Show publishes Rs 3,00,000
  -- for each of 2 brands; held BELOW that comparable because bottle branding at a
  -- two-day indoor conference delivers fewer impressions than at a show with
  -- outdoor halls. These 2 units are the reason unit_no exists -- see the header.
  (1, 'DK-WATER',     'delegate_kit',      'Water Bottle Branding',                 'One of two brands on delegate water bottles.',                       'brand',         2,     200000, 23),
  -- Rs 1,00,000 PLACEHOLDER. The lowest-value kit line. Delete it rather than
  -- discount it if no notepad is being produced.
  (1, 'DK-NOTEPAD',   'delegate_kit',      'Notepad and Pen Branding',              'Sole brand on the delegate notepad and pen.',                        'brand',         1,     100000, 24),

  -- VENUE BRANDING ---------------------------------------------------------
  -- Rs 4,00,000 PLACEHOLDER. No comparable. Every delegate passes it once and a
  -- fair number photograph it, which is the argument for pricing it beside the
  -- kit lines rather than below them.
  (1, 'VB-ARCH',      'venue_branding',    'Registration Arch Branding',            'Sole brand on the registration entrance arch.',                      'arch',          1,     400000, 30),
  -- Rs 50,000 PLACEHOLDER x 12 panels. This one IS derived from a published rate:
  -- India Poultry Show's Rs 500/sq ft x 100 sq ft for a 10ft x 10ft panel. Sold
  -- as FIXED PANELS on purpose -- an allocation has no quantity column, one row
  -- is one unit, so a per-sq-ft rate card would need either 100 rows for one
  -- banner or a negotiated total smuggled into list_price_inr. If the owner
  -- insists on selling by area, that is a schema change, not a workaround. 12 is
  -- a guess at how many such positions the hall actually has.
  (1, 'VB-PANEL',     'venue_branding',    'Venue Branding Panel (10ft x 10ft)',    'One 100 sq ft branding panel at an agreed position in the hall.',    'panel',        12,      50000, 31),
  -- Rs 2,50,000 PLACEHOLDER x 2 lounges. No comparable; priced between the arch
  -- and a charging station on dwell time.
  (1, 'VB-LOUNGE',    'venue_branding',    'Networking Lounge Branding',            'Naming and full branding of one networking lounge.',                 'lounge',        2,     250000, 32),
  -- Rs 75,000 PLACEHOLDER x 4. No comparable. Delete if no charging stations are
  -- being installed -- this is the row most likely to describe furniture that
  -- does not exist.
  (1, 'VB-CHARGE',    'venue_branding',    'Charging Station Branding',             'Sole brand on one delegate charging station.',                       'station',       4,      75000, 33),
  -- Rs 25,000 PLACEHOLDER x 10 slots. The LED figure is taken from India Poultry
  -- Show UNCHANGED, being the one comparable that needs no adjustment for
  -- audience: a loop slot is a loop slot. 10 slots keeps the loop short enough
  -- that each is actually seen; more slots is a cheaper, worse product.
  (1, 'VB-LED',       'venue_branding',    'Main Stage LED Loop Slot',              'One slot in the main stage LED loop played between sessions.',       'slot',         10,      25000, 34),
  -- Rs 10,000 PLACEHOLDER x 20 logos. India Poultry Show publishes Rs 5,000;
  -- doubled on the same audience reasoning as the lanyard. The cheapest entry
  -- point in the catalogue and the one a small exhibitor actually buys.
  (1, 'VB-BANNER',    'venue_branding',    'Welcome Banner Logo',                   'One logo on the main welcome banner.',                               'logo',         20,      10000, 35),

  -- DIGITAL ----------------------------------------------------------------
  -- Rs 4,00,000 PLACEHOLDER. No comparable. The app and attendee portal are the
  -- surface a delegate opens most often across the two days, which is the
  -- argument for pricing it beside the arch rather than beside the website.
  (1, 'DG-APP',       'digital',           'Event App and Attendee Portal Sponsor', 'Sole brand across the attendee portal and event app.',               'sponsor',       1,     400000, 40),
  -- Rs 2,50,000 PLACEHOLDER. No comparable. Delete this row unless the venue
  -- Wi-Fi SSID and splash page are genuinely the organiser's to sell -- at WTC
  -- they may well be the venue's, and selling something the venue owns is the
  -- expensive mistake in this category.
  (1, 'DG-WIFI',      'digital',           'Venue Wi-Fi Sponsor',                   'Named SSID and branded splash page on the venue Wi-Fi.',             'sponsor',       1,     250000, 41),
  -- Rs 1,00,000 PLACEHOLDER x 6 sends. No comparable. Six is a CONSENT AND
  -- FATIGUE ceiling, not a revenue one: delegates gave their address in order to
  -- attend, and the seventh solus email is how a list stops opening.
  (1, 'DG-EMAIL',     'digital',           'Solus Email to Registered Delegates',   'One dedicated email send to the registered delegate list.',          'send',          6,     100000, 42),

  -- PUBLICATION ------------------------------------------------------------
  -- Rs 75,000 PLACEHOLDER. ITPO AAHAR tops out at Rs 31,500 a page; the back
  -- cover is priced well above that as the only page seen without opening the
  -- guide. DELETE THIS WHOLE CATEGORY if no printed show guide is produced.
  (1, 'PB-BACK',      'publication',       'Show Guide Back Cover',                 'Full-page advertisement on the back cover of the show guide.',       'page',          1,      75000, 50),
  -- Rs 50,000 PLACEHOLDER, sitting between the back cover and a run-of-book page.
  (1, 'PB-IFC',       'publication',       'Show Guide Inside Front Cover',         'Full-page advertisement on the inside front cover.',                 'page',          1,      50000, 51),
  -- Rs 30,000 PLACEHOLDER x 12 pages -- effectively ITPO AAHAR's Rs 31,500 top
  -- page rate, rounded, which is the closest thing to a DIRECT comparable in this
  -- file. 12 pages is a guess at the guide's advertising allocation.
  (1, 'PB-FULL',      'publication',       'Show Guide Full Page',                  'Full-page run-of-book advertisement in the show guide.',             'page',         12,      30000, 52),
  -- Rs 18,000 PLACEHOLDER x 12. Deliberately ABOVE half the full page: a half
  -- page costs the same to sell, chase artwork for and lay out as a full one.
  (1, 'PB-HALF',      'publication',       'Show Guide Half Page',                  'Half-page run-of-book advertisement in the show guide.',             'page',         12,      18000, 53),

  -- EXHIBITOR SERVICES -----------------------------------------------------
  -- Rs 2,000 PLACEHOLDER. Fairfest publishes Rs 2,000 and ITPO AAHAR Rs 1,000;
  -- taken at the higher of the two. quantity_available IS NULL -- UNLIMITED. The
  -- show can print another badge, so a ceiling here would only ever be the thing
  -- that rejects a legitimate sale. unit_no becomes a sequence number and the
  -- unique index serialises the numbering rather than guarding a cap.
  (1, 'EX-BADGE',     'exhibitor_service', 'Additional Exhibitor Badge',            'One extra staff badge beyond a stand''s included allocation.',       'badge',      NULL,       2000, 60),
  -- Rs 15,000 PLACEHOLDER. Fairfest publishes Rs 10,000; raised on the same
  -- audience reasoning as the rest. Also UNLIMITED -- a listing costs a line in
  -- the guide and a row in the directory, and capping it caps nothing real.
  (1, 'EX-COEXH',     'exhibitor_service', 'Co-Exhibitor Listing',                  'Directory and show guide listing for a second company on one stand.','company',    NULL,      15000, 61);

-- Deliberately NO app_settings row. See "WHY NO REVENUE TARGET IS SEEDED" in the
-- header: a denominator summed from prices nobody has quoted is exactly the kind
-- of number that gets read out in a meeting as though somebody chose it. Add it
-- the day the owner confirms the catalogue:
--
--     INSERT OR IGNORE INTO app_settings (key, value)
--     VALUES ('sponsorship_revenue_target_inr', '<the confirmed total>');
