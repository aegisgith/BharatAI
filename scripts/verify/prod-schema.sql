-- Production D1 schema (structure only, no rows), read from sqlite_master on 28 Oct 2026.
-- Used by smoke-merge-dupes.mjs to run the merge against real SQLite. Refresh it when a migration lands.
CREATE TABLE admin_audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor       TEXT    NOT NULL DEFAULT 'unknown',
  actor_kind  TEXT    NOT NULL DEFAULT 'admin',
  action      TEXT    NOT NULL,
  entity      TEXT,
  entity_id   TEXT,
  detail      TEXT,
  ip          TEXT,
  user_agent  TEXT,
  created_at  TEXT    DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  announcement_type TEXT DEFAULT 'general', 
  author_name TEXT,
  pinned INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id)
);
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE attendees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT,
  job_title TEXT,
  bio TEXT,
  avatar_url TEXT,
  interests TEXT, 
  linkedin_url TEXT,
  twitter_url TEXT,
  website_url TEXT,
  role TEXT NOT NULL DEFAULT 'attendee', 
  badge_type TEXT DEFAULT 'general', 
  is_online INTEGER DEFAULT 0,
  last_seen TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, mobile TEXT DEFAULT '', lunch_inclusion TEXT DEFAULT 'Yes', arrival_time TEXT, notified_at DATETIME, rsvp_status TEXT DEFAULT NULL, rsvp_at DATETIME DEFAULT NULL, last_login_at DATETIME, pass_downloaded_at DATETIME, industry TEXT DEFAULT '', city TEXT DEFAULT '', country TEXT DEFAULT 'India', company_size TEXT DEFAULT '', special_requirements TEXT DEFAULT '', registration_source TEXT DEFAULT 'networking_app', pass_type TEXT DEFAULT 'visitor', payment_status TEXT NOT NULL DEFAULT 'paid', registration_date TEXT, checked_in_at DATETIME, checked_in_by TEXT, payment_amount TEXT, profile_reminder_sent_at DATETIME, profile_reminder_error TEXT, social_card_downloaded_at DATETIME, company_logo_url TEXT, networking_goals TEXT, avatar_fingerprint TEXT, photo_flagged_at DATETIME, photo_flagged_by TEXT, flagged_avatar_url TEXT, flagged_avatar_fingerprint TEXT, main_event INTEGER NOT NULL DEFAULT 1, main_event_answered_at DATETIME, marketing_consent INTEGER, unsubscribed_at DATETIME,
  UNIQUE(event_id, email)
);
CREATE TABLE award_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  voting_open INTEGER DEFAULT 1,
  max_votes_per_user INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id)
);
CREATE TABLE award_nominees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL,
  event_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  company TEXT,
  vote_count INTEGER DEFAULT 0,
  is_winner INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES award_categories(id),
  FOREIGN KEY (event_id) REFERENCES events(id)
);
CREATE TABLE award_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nominee_id INTEGER NOT NULL,
  category_id INTEGER NOT NULL,
  attendee_id INTEGER NOT NULL,
  event_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (nominee_id) REFERENCES award_nominees(id),
  FOREIGN KEY (category_id) REFERENCES award_categories(id),
  FOREIGN KEY (attendee_id) REFERENCES attendees(id),
  FOREIGN KEY (event_id) REFERENCES events(id),
  UNIQUE(category_id, attendee_id)
);
CREATE TABLE booth_allocations (
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
CREATE TABLE booth_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  booth_type_id INTEGER NOT NULL,
  attendee_id INTEGER,
  
  company_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  website TEXT,
  
  industry TEXT,
  company_size TEXT,
  company_description TEXT,
  
  quantity INTEGER NOT NULL DEFAULT 1,
  preferred_zone TEXT,
  preferred_booth_numbers TEXT,
  special_requirements TEXT,
  
  products_to_display TEXT,
  
  total_price_inr INTEGER NOT NULL DEFAULT 0,
  gst_amount INTEGER NOT NULL DEFAULT 0,
  grand_total INTEGER NOT NULL DEFAULT 0,
  
  payment_status TEXT NOT NULL DEFAULT 'pending',  
  payment_reference TEXT,
  payment_date DATETIME,
  invoice_number TEXT,
  
  status TEXT NOT NULL DEFAULT 'submitted',  
  admin_notes TEXT,
  reviewed_by TEXT,
  reviewed_at DATETIME,
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booth_type_id) REFERENCES booth_types(id),
  FOREIGN KEY (attendee_id) REFERENCES attendees(id)
);
CREATE TABLE booth_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  size_label TEXT NOT NULL,          
  width_m REAL NOT NULL,
  depth_m REAL NOT NULL,
  area_sqm REAL NOT NULL,
  area_sqft INTEGER NOT NULL,
  total_count INTEGER NOT NULL DEFAULT 0,
  total_area_sqm REAL NOT NULL DEFAULT 0,
  total_area_sqft INTEGER NOT NULL DEFAULT 0,
  price_inr INTEGER NOT NULL,
  available_count INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  features TEXT,                     
  color TEXT DEFAULT '#4c6ef5',      
  icon TEXT DEFAULT 'fa-store',      
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE booth_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exhibitor_id INTEGER NOT NULL,
  attendee_id INTEGER NOT NULL,
  event_id INTEGER NOT NULL,
  visited_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  interested INTEGER DEFAULT 0,
  FOREIGN KEY (exhibitor_id) REFERENCES exhibitors(id),
  FOREIGN KEY (attendee_id) REFERENCES attendees(id),
  FOREIGN KEY (event_id) REFERENCES events(id)
);
CREATE TABLE booths (
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
CREATE TABLE campaign_recipients (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  attendee_id INTEGER,
  email       TEXT,
  name        TEXT,
  status      TEXT    NOT NULL DEFAULT 'pending',  -- pending | sent | failed
  error       TEXT,
  sent_at     TEXT
);
CREATE TABLE campaigns (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT    NOT NULL,               -- notify | thankyou | announcement
  title       TEXT,
  ref_id      INTEGER,                        -- announcement id, when kind = announcement
  audience    TEXT,                           -- how the recipient list was chosen
  status      TEXT    NOT NULL DEFAULT 'running',  -- running | paused | done
  total       INTEGER NOT NULL DEFAULT 0,
  sent        INTEGER NOT NULL DEFAULT 0,
  failed      INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT,
  created_at  TEXT    DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT    DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);
CREATE TABLE checkout_leads (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id       INTEGER NOT NULL DEFAULT 1,
  email          TEXT    NOT NULL,                 -- lower-case
  name           TEXT,
  mobile         TEXT,
  company        TEXT,
  job_title      TEXT,
  city           TEXT,
  industry       TEXT,
  pass_type      TEXT,                             -- spelled as PAID_TIERS
  page           TEXT    NOT NULL DEFAULT 'register',
  ip             TEXT,                             -- only to cap how many one address can create
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  reminded_at    TEXT,                             -- the last reminder that went out
  reminder_count INTEGER NOT NULL DEFAULT 0,
  reminder_error TEXT,                             -- why the last attempt did not go, if it did not
  UNIQUE(event_id, email)
);
CREATE TABLE connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  from_attendee_id INTEGER NOT NULL,
  to_attendee_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', 
  message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (from_attendee_id) REFERENCES attendees(id),
  FOREIGN KEY (to_attendee_id) REFERENCES attendees(id),
  UNIQUE(event_id, from_attendee_id, to_attendee_id)
);
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  event_type TEXT NOT NULL DEFAULT 'conference', 
  venue TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  banner_url TEXT,
  status TEXT NOT NULL DEFAULT 'upcoming', 
  max_attendees INTEGER DEFAULT 500,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE exhibitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  company_name TEXT NOT NULL,
  description TEXT,
  logo_url TEXT,
  banner_url TEXT,
  booth_number TEXT,
  booth_size TEXT DEFAULT 'standard', 
  category TEXT,
  website_url TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  products TEXT, 
  social_links TEXT, 
  visitor_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, attendee_id INTEGER REFERENCES attendees(id),
  FOREIGN KEY (event_id) REFERENCES events(id)
);
CREATE TABLE innovation_talks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id      INTEGER NOT NULL DEFAULT 1,
  slot_no       INTEGER,
  session_type  TEXT    NOT NULL DEFAULT 'Morning',
  time_slot     TEXT,
  speaker_name  TEXT,
  company       TEXT    DEFAULT '',
  topic         TEXT    DEFAULT '',
  status        TEXT    NOT NULL DEFAULT 'confirmed',
  notes         TEXT    DEFAULT '',
  created_at    TEXT    DEFAULT CURRENT_TIMESTAMP
, exhibitor_id       INTEGER, speaker_title      TEXT DEFAULT '', speaker_bio        TEXT DEFAULT '', speaker_photo_url  TEXT DEFAULT '', showcase           TEXT DEFAULT '', duration_min       INTEGER, starts_at          TEXT, details_updated_at TEXT);
CREATE TABLE inquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL DEFAULT 1,
  inquiry_type TEXT NOT NULL DEFAULT 'general',
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT DEFAULT '',
  organization TEXT DEFAULT '',
  subject TEXT DEFAULT '',
  message TEXT DEFAULT '',
  metadata TEXT DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'new',
  admin_notes TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, assigned_to  TEXT, responded_at TEXT,
  FOREIGN KEY (event_id) REFERENCES events(id)
);
CREATE TABLE invoices (id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_no TEXT NOT NULL UNIQUE, attendee_id INTEGER, buyer_name TEXT NOT NULL, buyer_email TEXT NOT NULL, buyer_company TEXT, buyer_gstin TEXT, buyer_address TEXT, buyer_phone TEXT, item_desc TEXT NOT NULL, order_ref TEXT, payment_ref TEXT, paid_at DATETIME, currency TEXT NOT NULL DEFAULT 'INR', gst_rate INTEGER NOT NULL DEFAULT 18, taxable_paise INTEGER NOT NULL, cgst_paise INTEGER NOT NULL DEFAULT 0, sgst_paise INTEGER NOT NULL DEFAULT 0, igst_paise INTEGER NOT NULL DEFAULT 0, total_paise INTEGER NOT NULL, place_of_supply TEXT, emailed_at DATETIME, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE item_allocations (
  id               INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  event_id         INTEGER NOT NULL DEFAULT 1,
  item_id          INTEGER NOT NULL,

  
  
  
  
  
  
  
  
  
  unit_no          INTEGER NOT NULL DEFAULT 1,

  
  
  
  
  
  
  
  
  company_name     TEXT    NOT NULL,           
  contact_name     TEXT,
  email            TEXT,
  phone            TEXT,

  
  
  
  
  status           TEXT    NOT NULL DEFAULT 'held',

  amount_inr       INTEGER NOT NULL DEFAULT 0, 

  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  list_price_inr   INTEGER NOT NULL DEFAULT 0,
  discount_inr     INTEGER NOT NULL DEFAULT 0, 
  gst_inr          INTEGER NOT NULL DEFAULT 0, 
  grand_total_inr  INTEGER NOT NULL DEFAULT 0, 
  invoice_number   TEXT,                       
  invoice_date     DATETIME,
  amount_paid_inr  INTEGER NOT NULL DEFAULT 0, 
  paid_date        DATETIME,                   
  
  
  payment_status   TEXT    NOT NULL DEFAULT 'pending',

  
  
  
  
  
  
  
  
  hold_expires_at  DATETIME,

  
  
  
  
  
  
  
  
  
  
  
  
  
  released_at      DATETIME,

  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  tds_deducted_inr INTEGER NOT NULL DEFAULT 0,

  
  
  
  
  balance_due_date DATETIME,

  
  
  
  
  buyer_gstin      TEXT,                       
  buyer_legal_name TEXT,                       

  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  buyer_state_code TEXT,                       

  notes            TEXT,                       
  allocated_by     TEXT,                       
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP,

  
  
  
  
  
  
  
  
  

  
  
  
  
  
  
  
  CHECK (unit_no >= 1),

  
  
  
  
  
  FOREIGN KEY (item_id) REFERENCES sellable_items(id)
);
CREATE TABLE login_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
, max_uses INTEGER NOT NULL DEFAULT 1, uses INTEGER NOT NULL DEFAULT 0);
CREATE TABLE meeting_rooms (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id   INTEGER NOT NULL DEFAULT 1,
  slug       TEXT    NOT NULL UNIQUE,   -- stable key, independent of the row id
  label      TEXT    NOT NULL,          -- what the site calls it
  wtc_name   TEXT    NOT NULL,          -- what the venue calls it, for signage and the WTC
  layout     TEXT,                      -- NULL where the site does not state one
  capacity   INTEGER NOT NULL,
  price_inr  INTEGER NOT NULL,          -- per hour, exclusive of GST
  image_url  TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  requester_id INTEGER NOT NULL,
  requestee_id INTEGER NOT NULL,
  title TEXT,
  meeting_time TEXT NOT NULL,
  duration_minutes INTEGER DEFAULT 15,
  location TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending', 
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (requester_id) REFERENCES attendees(id),
  FOREIGN KEY (requestee_id) REFERENCES attendees(id)
);
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  sender_id INTEGER NOT NULL,
  receiver_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  is_read INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (sender_id) REFERENCES attendees(id),
  FOREIGN KEY (receiver_id) REFERENCES attendees(id)
);
CREATE TABLE mp_companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'company',
  
  exhibitor_id INTEGER,
  attendee_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE mp_inquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL,
  inquirer_name TEXT NOT NULL,
  inquirer_email TEXT NOT NULL,
  inquirer_company TEXT,
  inquirer_phone TEXT,
  inquirer_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (listing_id) REFERENCES mp_listings(id) ON DELETE CASCADE
);
CREATE TABLE mp_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  company_name TEXT NOT NULL,
  company_slug TEXT,
  product_name TEXT NOT NULL,
  product_slug TEXT,
  description TEXT NOT NULL,
  target_customer TEXT,
  target_industry TEXT,
  target_functional_area TEXT,
  ai_category TEXT,
  ai_category_custom TEXT,
  tags TEXT,
  innovation TEXT,
  use_cases TEXT,
  pricing_type TEXT,
  pricing_details TEXT,
  product_image_url TEXT,
  logo_url TEXT,
  screenshot_urls TEXT,
  website_url TEXT,
  product_url TEXT,
  demo_url TEXT,
  video_url TEXT,
  founder_name TEXT,
  cto_name TEXT,
  contact_name TEXT,
  company_registration TEXT,
  company_phone TEXT,
  company_address TEXT,
  sales_contact_name TEXT,
  sales_contact_email TEXT,
  sales_contact_phone TEXT,
  current_customers TEXT,
  integration_requirements TEXT,
  supported_platforms TEXT,
  tech_stack TEXT,
  security_protocols TEXT,
  case_studies TEXT,
  certifications_compliance TEXT,
  access_info TEXT,
  support_offering TEXT,
  sla_details TEXT,
  onboarding_process TEXT,
  awards_rating INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  view_count INTEGER DEFAULT 0,
  
  exhibitor_id INTEGER,
  booth_number TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE mp_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL,
  company_id INTEGER NOT NULL,
  company_name TEXT,
  rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (listing_id) REFERENCES mp_listings(id) ON DELETE CASCADE
);
CREATE TABLE mp_uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT,
  size INTEGER,
  data TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE panel_registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attendee_id INTEGER NOT NULL,
  panel_slug TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'page',
  external_ref TEXT,
  registered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmation_sent_at DATETIME,
  confirmation_error TEXT,
  claimed_at DATETIME,
  claim_attempts INTEGER NOT NULL DEFAULT 0,
  last_claim_attempt_at DATETIME,
  certificate_downloaded_at DATETIME,
  card_downloaded_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, rsvp_status TEXT, rsvp_at DATETIME, reminder_sent_at DATETIME, reminder_error TEXT,
  UNIQUE(attendee_id, panel_slug),
  FOREIGN KEY (attendee_id) REFERENCES attendees(id)
);
CREATE TABLE payment_orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id       TEXT    NOT NULL UNIQUE,          -- ours, sent to the gateway: BAI<attendee>-<stamp>
  attendee_id    INTEGER NOT NULL,
  event_id       INTEGER NOT NULL DEFAULT 1,
  gateway        TEXT    NOT NULL DEFAULT 'ccavenue',
  pass_type      TEXT    NOT NULL,                 -- the pass being bought, spelled as PAID_TIERS
  previous_badge TEXT,                             -- what they held when they started, for the record
  base_paise     INTEGER NOT NULL,                 -- pass price before GST
  gst_paise      INTEGER NOT NULL,
  amount_paise   INTEGER NOT NULL,                 -- what the gateway was asked to charge
  currency       TEXT    NOT NULL DEFAULT 'INR',
  status         TEXT    NOT NULL DEFAULT 'created',
  tracking_id    TEXT,                             -- CCAvenue's reference number
  bank_ref_no    TEXT,
  payment_mode   TEXT,                             -- Credit Card, UPI, Net Banking ...
  card_name      TEXT,
  gateway_status TEXT,                             -- order_status exactly as the gateway sent it
  status_message TEXT,
  gateway_amount TEXT,                             -- the amount the gateway reported, as sent
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  responded_at   TEXT,
  paid_at        TEXT
);
CREATE TABLE photo_flags (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  attendee_id  INTEGER NOT NULL,
  avatar_url   TEXT,              
  fingerprint  TEXT,              
  flagged_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  flagged_by   TEXT,
  cleared_at   DATETIME,          
  cleared_by   TEXT,
  cleared_how  TEXT               
);
CREATE TABLE report_downloads (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id          INTEGER NOT NULL DEFAULT 1,
  email             TEXT    NOT NULL,                 -- lower-case
  name              TEXT,
  mobile            TEXT,
  company           TEXT,
  job_title         TEXT,
  city              TEXT,
  industry          TEXT,
  who               TEXT,                             -- professional | student | faculty
  attendee_id       INTEGER,
  source            TEXT    NOT NULL DEFAULT 'page',  -- page | email
  marketing_consent INTEGER,                          -- 1 = ticked "keep me posted" on /insights
  ip                TEXT,                             -- only to cap how many one address can create
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  email_sent_at     TEXT,
  email_error       TEXT,
  downloads         INTEGER NOT NULL DEFAULT 0,
  last_download_at  TEXT,
  last_report       TEXT,
  UNIQUE(event_id, email)
);
CREATE TABLE report_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id   INTEGER NOT NULL DEFAULT 1,
  kind       TEXT    NOT NULL,                 -- open | watch
  report     TEXT    NOT NULL,                 -- djsce | jnu
  subject    TEXT    NOT NULL DEFAULT '',      -- l<id> | a<id> | ''
  email      TEXT,                             -- lower-case, when known
  source     TEXT    NOT NULL DEFAULT 'site',  -- email | site | link (a direct PDF link from before /r/)
  page       TEXT,                             -- the page a play started on
  ip         TEXT,                             -- only to cap how many rows one address can write
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE room_bookings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id      INTEGER NOT NULL DEFAULT 1,
  room_id       INTEGER NOT NULL,
  slot_date     TEXT    NOT NULL,               -- 'YYYY-MM-DD', denormalised for the day grid
  slot_start    TEXT    NOT NULL,               -- 'YYYY-MM-DD HH:00'
  slot_end      TEXT    NOT NULL,               -- 'YYYY-MM-DD HH:00', always +1h
  group_ref     TEXT,                           -- ties the consecutive hours of one reservation
  kind          TEXT    NOT NULL DEFAULT 'booking',  -- booking | block
  attendee_id   INTEGER,                        -- NULL for an admin-created block
  meeting_id    INTEGER,                        -- set when the hour was booked from a meeting request
  title         TEXT,
  headcount     INTEGER,
  notes         TEXT,
  contact_name  TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  price_inr     INTEGER NOT NULL DEFAULT 0,     -- snapshot of the rate at booking time
  status        TEXT    NOT NULL DEFAULT 'held',    -- held | confirmed | cancelled | rejected
  created_by    TEXT,
  created_at    TEXT    DEFAULT CURRENT_TIMESTAMP,
  updated_at    TEXT    DEFAULT CURRENT_TIMESTAMP,
  cancelled_at  TEXT
);
CREATE TABLE sellable_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    INTEGER NOT NULL DEFAULT 1,

  
  
  
  
  
  
  code        TEXT    NOT NULL,          

  
  
  
  category    TEXT    NOT NULL,          
  name        TEXT    NOT NULL,          
  description TEXT,                      

  
  
  
  
  
  unit_label  TEXT    NOT NULL DEFAULT 'unit',

  
  
  
  
  
  quantity_available INTEGER,

  
  
  
  
  list_price_inr INTEGER NOT NULL DEFAULT 0,

  sort_order  INTEGER NOT NULL DEFAULT 0, 

  
  
  
  
  
  
  is_active   INTEGER NOT NULL DEFAULT 1,

  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  
  
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(event_id, code),

  
  
  
  
  
  
  
  CHECK (quantity_available IS NULL OR quantity_available > 0)
);
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  speaker_name TEXT,
  speaker_title TEXT,
  speaker_avatar TEXT,
  session_type TEXT NOT NULL DEFAULT 'talk', 
  track TEXT,
  room TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  capacity INTEGER DEFAULT 100,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id)
);
CREATE TABLE speakers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL DEFAULT 1,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT,                      -- job title, e.g. 'Joint Secretary, MeitY'
  organisation TEXT,
  topic TEXT,                     -- the talk theme shown on the card
  photo_url TEXT,
  bio TEXT,
  email TEXT,                     -- supplied later; never required to list a speaker
  phone TEXT,
  linkedin_url TEXT,
  is_featured INTEGER NOT NULL DEFAULT 0,
  is_published INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id, slug)
);
CREATE TABLE staff (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, last_login_at DATETIME, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, failed_attempts INTEGER NOT NULL DEFAULT 0, last_failed_at DATETIME, role TEXT NOT NULL DEFAULT 'desk', email TEXT);
CREATE TABLE startup_investors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  title TEXT DEFAULT '',
  company TEXT DEFAULT '',
  avatar_url TEXT DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id)
);
CREATE TABLE startup_pitches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  slot_order INTEGER NOT NULL DEFAULT 0,
  time_slot TEXT NOT NULL,
  company TEXT NOT NULL,
  pitcher_name TEXT NOT NULL,
  pitcher_title TEXT DEFAULT '',
  pitcher_profile TEXT DEFAULT '',
  pitcher_avatar_url TEXT DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id)
);
CREATE TABLE workshop_seats (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id     INTEGER NOT NULL DEFAULT 1,
  attendee_id  INTEGER NOT NULL,
  workshop_id  INTEGER NOT NULL,
  chosen_by    TEXT    NOT NULL DEFAULT 'attendee',   -- 'attendee', or 'admin:<name>'
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (event_id, attendee_id)
);
CREATE TABLE workshops (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    INTEGER NOT NULL DEFAULT 1,
  slug        TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  speaker     TEXT,
  summary     TEXT,
  starts_at   TEXT,                       -- 'YYYY-MM-DD HH:MM', IST; NULL = to be announced
  ends_at     TEXT,
  room        TEXT,
  capacity    INTEGER NOT NULL DEFAULT 100,
  is_open     INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (event_id, slug)
);
CREATE INDEX idx_admin_audit_created ON admin_audit(created_at DESC);
CREATE INDEX idx_admin_audit_entity  ON admin_audit(entity, entity_id);
CREATE INDEX idx_announcements_event ON announcements(event_id);
CREATE INDEX idx_attendees_checked_in ON attendees(checked_in_at);
CREATE INDEX idx_attendees_email ON attendees(email);
CREATE INDEX idx_attendees_event ON attendees(event_id);
CREATE INDEX idx_attendees_event_name ON attendees(event_id, name, id);
CREATE INDEX idx_attendees_payment_status ON attendees(payment_status);
CREATE INDEX idx_attendees_registration_date ON attendees(registration_date);
CREATE INDEX idx_attendees_rsvp ON attendees(rsvp_status);
CREATE INDEX idx_attendees_unsubscribed ON attendees(unsubscribed_at);
CREATE INDEX idx_award_nominees_category ON award_nominees(category_id);
CREATE INDEX idx_award_votes_nominee ON award_votes(nominee_id);
CREATE INDEX idx_booth_alloc_booth ON booth_allocations(event_id, booth_id);
CREATE INDEX idx_booth_alloc_exhibitor ON booth_allocations(exhibitor_id);
CREATE UNIQUE INDEX idx_booth_alloc_live
  ON booth_allocations(event_id, booth_id)
  WHERE released_at IS NULL;
CREATE INDEX idx_booth_alloc_request   ON booth_allocations(booth_request_id);
CREATE INDEX idx_booth_alloc_status    ON booth_allocations(event_id, status);
CREATE INDEX idx_booth_requests_attendee ON booth_requests(attendee_id);
CREATE INDEX idx_booth_requests_email ON booth_requests(email);
CREATE INDEX idx_booth_requests_event ON booth_requests(event_id);
CREATE INDEX idx_booth_requests_payment ON booth_requests(payment_status);
CREATE INDEX idx_booth_requests_status ON booth_requests(status);
CREATE INDEX idx_booth_types_slug ON booth_types(slug);
CREATE INDEX idx_booths_event_sort ON booths(event_id, sort_order);
CREATE INDEX idx_booths_type       ON booths(event_id, type_key);
CREATE INDEX idx_campaign_recipients_next
  ON campaign_recipients(campaign_id, status, id);
CREATE INDEX idx_campaigns_status
  ON campaigns(status, id DESC);
CREATE INDEX idx_checkout_leads_ip ON checkout_leads(ip, created_at);
CREATE INDEX idx_connections_event ON connections(event_id);
CREATE INDEX idx_connections_from ON connections(from_attendee_id);
CREATE INDEX idx_connections_to ON connections(to_attendee_id);
CREATE INDEX idx_exhibitors_attendee ON exhibitors(attendee_id);
CREATE INDEX idx_exhibitors_event ON exhibitors(event_id);
CREATE INDEX idx_innovation_talks_event_slot
  ON innovation_talks(event_id, slot_no);
CREATE UNIQUE INDEX idx_innovation_talks_exhibitor
  ON innovation_talks(event_id, exhibitor_id) WHERE exhibitor_id IS NOT NULL;
CREATE INDEX idx_inquiries_email ON inquiries(email);
CREATE INDEX idx_inquiries_event ON inquiries(event_id);
CREATE INDEX idx_inquiries_status ON inquiries(status);
CREATE INDEX idx_inquiries_type ON inquiries(inquiry_type);
CREATE INDEX idx_invoices_attendee ON invoices(attendee_id);
CREATE INDEX idx_invoices_email ON invoices(buyer_email);
CREATE INDEX idx_item_alloc_invoice ON item_allocations(invoice_number);
CREATE INDEX idx_item_alloc_item    ON item_allocations(event_id, item_id);
CREATE UNIQUE INDEX idx_item_alloc_live
  ON item_allocations(event_id, item_id, unit_no)
  WHERE released_at IS NULL;
CREATE INDEX idx_item_alloc_status  ON item_allocations(event_id, status);
CREATE INDEX idx_login_tokens_email ON login_tokens(event_id, email);
CREATE INDEX idx_login_tokens_expiry ON login_tokens(expires_at);
CREATE INDEX idx_login_tokens_token ON login_tokens(token_hash);
CREATE INDEX idx_messages_receiver ON messages(receiver_id);
CREATE INDEX idx_messages_receiver_unread ON messages(receiver_id, is_read);
CREATE INDEX idx_messages_sender ON messages(sender_id);
CREATE INDEX idx_mp_inquiries_listing ON mp_inquiries(listing_id);
CREATE INDEX idx_mp_listings_company ON mp_listings(company_id);
CREATE INDEX idx_mp_listings_company_slug ON mp_listings(company_slug, product_slug);
CREATE INDEX idx_mp_listings_exhibitor ON mp_listings(exhibitor_id);
CREATE INDEX idx_mp_listings_status ON mp_listings(status);
CREATE INDEX idx_mp_reviews_listing ON mp_reviews(listing_id);
CREATE INDEX idx_panel_registrations_slug ON panel_registrations(panel_slug);
CREATE INDEX idx_payment_orders_attendee ON payment_orders(attendee_id, created_at);
CREATE INDEX idx_payment_orders_status   ON payment_orders(status, paid_at);
CREATE INDEX idx_photo_flags_attendee ON photo_flags(attendee_id, cleared_at);
CREATE INDEX idx_photo_flags_open     ON photo_flags(cleared_at);
CREATE INDEX idx_photo_flags_url      ON photo_flags(avatar_url);
CREATE INDEX idx_report_downloads_attendee ON report_downloads(attendee_id);
CREATE INDEX idx_report_downloads_ip ON report_downloads(ip, created_at);
CREATE INDEX idx_report_events_email ON report_events(email, kind);
CREATE INDEX idx_report_events_ip ON report_events(ip, created_at);
CREATE INDEX idx_report_events_kind ON report_events(kind, report, created_at);
CREATE INDEX idx_room_bookings_attendee ON room_bookings(attendee_id, slot_start);
CREATE INDEX idx_room_bookings_day      ON room_bookings(slot_date, room_id, slot_start);
CREATE INDEX idx_room_bookings_group    ON room_bookings(group_ref);
CREATE INDEX idx_room_bookings_meeting  ON room_bookings(meeting_id);
CREATE INDEX idx_sellable_items_category   ON sellable_items(event_id, category, sort_order);
CREATE INDEX idx_sellable_items_event_sort ON sellable_items(event_id, sort_order);
CREATE INDEX idx_sessions_event ON sessions(event_id);
CREATE INDEX idx_speakers_event_sort ON speakers(event_id, sort_order);
CREATE INDEX idx_speakers_published ON speakers(event_id, is_published);
CREATE INDEX idx_staff_role ON staff(role);
CREATE INDEX idx_staff_username ON staff(username);
CREATE INDEX idx_startup_investors_event ON startup_investors(event_id);
CREATE INDEX idx_startup_pitches_event ON startup_pitches(event_id);
CREATE INDEX idx_workshop_seats_workshop ON workshop_seats (workshop_id);
CREATE UNIQUE INDEX ux_room_bookings_slot
  ON room_bookings(room_id, slot_start)
  WHERE status IN ('held', 'confirmed');