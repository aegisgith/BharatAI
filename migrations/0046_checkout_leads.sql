-- 0046: people who started buying a pass and stopped, and who has been reminded.
--
-- The paid form keeps what is typed as it is typed (the form says so), so someone
-- who closes it before Proceed to Payment is not lost: one row per address. The
-- same table records the "finish paying" reminder for everyone, including people
-- who did register and then left the CCAvenue page, so nobody is sent two.
--
-- page: 'register' (the /register form), 'app' (the paid form inside the app), or
-- 'reminder' (no form was involved: the row exists only to record a reminder sent
-- to a registered attendee whose paid pass is still pending).
--
-- A lead is never a registration. It does not count anywhere, has no pass, and is
-- shown only on Admin -> Payments under "Didn't finish paying".
--
-- Additive only, and every statement is IF NOT EXISTS, so running this file twice
-- changes nothing. Until it runs, the forms carry on and simply keep nothing, and
-- Admin -> Payments says so.
CREATE TABLE IF NOT EXISTS checkout_leads (
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

-- The per-address cap on new rows ("no more than 30 an hour from one address").
CREATE INDEX IF NOT EXISTS idx_checkout_leads_ip ON checkout_leads(ip, created_at);
