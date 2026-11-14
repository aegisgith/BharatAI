-- Organiser, 14 Nov 2026: the Media panel's new title.
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/session-media-panel-title.sql
UPDATE sessions SET title = 'Beyond Traditional Entertainment: How AI Is Reshaping the Future of Media and Digital Content'
WHERE event_id = 1 AND title LIKE 'Content, Creativity & AI%';
