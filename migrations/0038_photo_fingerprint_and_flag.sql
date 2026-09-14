-- Migration 0038: whose photo is it?
--
-- The person check proves a profile photo has a person in it, not whose face it
-- is. Two additions, both additive and nullable, so every existing row and every
-- existing query is unaffected:
--
-- avatar_fingerprint: a fingerprint of the uploaded photo (public/js/
--   photo-fingerprint.js), so the next person to upload the same picture - saved
--   from the directory, or from the website - is refused. Backfilled for existing
--   uploads from the stored files.
--
-- photo_flagged_at / photo_flagged_by / flagged_avatar_url /
-- flagged_avatar_fingerprint: the badge desk, holding a government ID next to the
--   person, can say the face on the pass is not theirs. The photo comes off the
--   pass and the card but is kept here with who said so and when, and its
--   fingerprint stays blocked.

ALTER TABLE attendees ADD COLUMN avatar_fingerprint TEXT;
ALTER TABLE attendees ADD COLUMN photo_flagged_at DATETIME;
ALTER TABLE attendees ADD COLUMN photo_flagged_by TEXT;
ALTER TABLE attendees ADD COLUMN flagged_avatar_url TEXT;
ALTER TABLE attendees ADD COLUMN flagged_avatar_fingerprint TEXT;
