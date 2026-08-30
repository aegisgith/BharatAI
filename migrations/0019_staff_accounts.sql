-- Badge-desk staff accounts.
--
-- Verification was gated on the single ADMIN_SECRET, which meant handing the key to
-- the whole admin panel to every person on the desk, and check-ins recorded only
-- "desk" rather than who admitted someone. Individual accounts fix both: the desk
-- gets scan-and-check-in and nothing else, and every entry is attributable.
--
-- Passwords are PBKDF2-SHA256 with a per-account salt, matching the scheme the
-- marketplace was moved to — never the unsalted single-round SHA-256 this codebase
-- used before.

CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  last_login_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_staff_username ON staff(username);
