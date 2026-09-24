-- 0044: exhibitors' own Innovation Talk & Showcase slots.
--
-- Every booth package includes a slot on stage (Startup Pod 8 minutes up to Mega
-- Pavilion 40; STAGE_MINUTES in src/routes/marketplace.ts). The exhibitor fills in
-- the talk and the speaker - name, designation, photo, short bio - from the
-- marketplace dashboard, and the organisers give it a day and a time from the
-- marketplace admin (Stage Talks). It is the same programme the /admin Innovation
-- Talks tab edits and the app's Innovation Talks tab shows, so these are columns on
-- that table rather than a second one.
--
-- A row with an exhibitor_id stays out of the programme until it has a time
-- (starts_at), and out of the public app until it also has a topic and a speaker:
-- see GET /api/events/:id/innovation-talks.
--
-- Additive only. Until this runs, that route and the dashboard carry on without the
-- feature instead of failing.
ALTER TABLE innovation_talks ADD COLUMN exhibitor_id       INTEGER;
ALTER TABLE innovation_talks ADD COLUMN speaker_title      TEXT DEFAULT '';
ALTER TABLE innovation_talks ADD COLUMN speaker_bio        TEXT DEFAULT '';
ALTER TABLE innovation_talks ADD COLUMN speaker_photo_url  TEXT DEFAULT '';  -- /api/mp/uploads/<id>, uploaded by the exhibitor
ALTER TABLE innovation_talks ADD COLUMN showcase           TEXT DEFAULT '';
ALTER TABLE innovation_talks ADD COLUMN duration_min       INTEGER;
ALTER TABLE innovation_talks ADD COLUMN starts_at          TEXT;              -- 'YYYY-MM-DD HH:MM', Mumbai wall-clock time
ALTER TABLE innovation_talks ADD COLUMN details_updated_at TEXT;

-- One slot per exhibitor: a company holding two stands still gets one talk, the
-- longer of the two.
CREATE UNIQUE INDEX IF NOT EXISTS idx_innovation_talks_exhibitor
  ON innovation_talks(event_id, exhibitor_id) WHERE exhibitor_id IS NOT NULL;
