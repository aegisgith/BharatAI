-- Migration 0037: let one emailed link be clicked more than once.
--
-- A sign-in token is single use, which is right for a sign-in: the code arrives,
-- it is spent, it cannot be replayed. It is wrong for a campaign email that
-- offers the reader three things to do.
--
-- The profile reminder builds its three calls to action by string-replacing the
-- action in one URL, so all three carry the SAME token. redeemLoginToken marks
-- it used on the first redemption, so on any device without an existing session
-- - a different phone, private browsing, cleared storage - the first click works
-- and the other two land on a sign-in wall. The link most likely to be clicked
-- second is "make your card", which is the one that gives somebody a reason to
-- want a photo in the first place.
--
-- Rather than mint three rows and have each supersede the last (createLoginToken
-- invalidates outstanding tokens for the address on purpose, so an old code
-- cannot be reused), the token itself gets a budget. Sign-in keeps max_uses = 1
-- and behaves exactly as before; a campaign link asks for the number of doors it
-- opens.
--
-- This does not widen the blast radius in any meaningful way: whoever can read
-- the inbox can already click the first link, and the token still expires on the
-- same clock. It only stops the second click failing.
--
-- Defaults chosen so every existing row and every existing caller keeps today's
-- behaviour without being touched.

ALTER TABLE login_tokens ADD COLUMN max_uses INTEGER NOT NULL DEFAULT 1;
ALTER TABLE login_tokens ADD COLUMN uses INTEGER NOT NULL DEFAULT 0;
