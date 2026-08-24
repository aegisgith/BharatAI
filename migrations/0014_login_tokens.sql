-- Verified sign-in for attendees.
--
-- Until now, sign-in was email-only: POST an address, get that person's account.
-- Anyone who knew a delegate's email could be that delegate. This table backs a
-- real magic link — a random token emailed to the address, plus a 6-digit code
-- for people whose mail client strips links.
--
-- Only hashes are stored, so a leak of this table cannot be replayed as a login.
-- Rows are single-use (used_at) and short-lived (expires_at), and attempts is
-- counted so a 6-digit code cannot be brute-forced.
--
-- The application treats the EXISTENCE of this table as the switch that turns
-- verified sign-in on. Before it is applied, the old email-only path keeps
-- working; the moment it exists, verification is required. That makes the code
-- deploy and the migration independent of each other, in either order.

CREATE TABLE IF NOT EXISTS login_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_login_tokens_token ON login_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_login_tokens_email ON login_tokens(event_id, email);
CREATE INDEX IF NOT EXISTS idx_login_tokens_expiry ON login_tokens(expires_at);
