-- Virendra Pal's LLM Fine-Tuning workshop becomes a seat a Premium Delegate or VIP can choose in
-- the app (organiser, 6 Nov 2026). Needs migration 0049 first (it creates the workshops table).
-- Safe to run again: UNIQUE(event_id, slug) makes a second run skip the row. Times stay NULL ("to
-- be announced") until set in Admin -> Workshop Seats, like the others. Capacity 40 is the top of
-- the batch size in his plan (30 to 40), because everyone needs help in the hands-on part.
--
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/workshop-llm-fine-tuning.sql

INSERT OR IGNORE INTO workshops (event_id, slug, title, speaker, summary, capacity, sort_order) VALUES
  (1, 'llm-fine-tuning',
   'LLM Fine-Tuning, Hands-On',
   'Virendra Pal, AI and FinTech Expert',
   'Hands-on, 2 hours: when to fine-tune, how LoRA works, and fine-tuning a small open model yourself in Google Colab, with a before/after comparison. Bring a laptop; basic Python is enough.',
   40, 4);
