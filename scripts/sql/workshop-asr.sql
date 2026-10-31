-- Dr. Parijat Shukla's Automatic Speech Recognition workshop becomes a seat a
-- Premium Delegate or VIP can choose in the app (organiser, 31 Oct 2026).
-- Needs migration 0049 first (it creates the workshops table). Safe to run again:
-- UNIQUE(event_id, slug) makes a second run skip the row. Times stay NULL ("to be
-- announced") until set in Admin -> Workshop Seats, like the other two.
--
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/workshop-asr.sql

INSERT OR IGNORE INTO workshops (event_id, slug, title, speaker, summary, capacity, sort_order) VALUES
  (1, 'asr-workshop',
   'Automatic Speech Recognition (Speech-to-Text)',
   'Dr. Parijat Shukla, PhD, Iowa State University',
   'Hands-on, 90 minutes: the kinds of speech problems ASR solves, the popular models, choosing the right model and hardware for your task, and a hands-on session.',
   100, 3);
