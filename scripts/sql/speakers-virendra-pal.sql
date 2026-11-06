-- Virendra Pal, AI & FinTech Expert, who leads the LLM Fine-Tuning workshop
-- (workshop-llm-fine-tuning.sql), is a confirmed speaker (organiser, 6 Nov 2026).
-- Added to the home and conference pages the same day. He is listed without an
-- employer: he runs the workshop in his personal capacity.
--
-- His free Speaker pass needs his email address, which is not on file yet, so it
-- is not in this file.
--
-- Safe to run again: UNIQUE(event_id, slug) skips the row.
--
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/speakers-virendra-pal.sql

INSERT OR IGNORE INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, is_featured, is_published, sort_order) VALUES
  (1, 'virendra-pal', 'Virendra Pal', 'AI & FinTech Expert', '', 'LLM Fine-Tuning', '/images/speaker-virendra-pal.webp', 0, 1, 43);
