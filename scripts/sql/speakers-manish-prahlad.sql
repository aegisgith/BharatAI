-- Mr. Manish K. Prahlad, Co-Founder and CEO, Verdant Impact (organiser, 16 Nov 2026), on the
-- Agriculture panel "Transforming Indian Agriculture with AI: Doubling Farmer Income" (21 Nov,
-- 11:00 am, Kalam Theatre; session 158, whose typed line already names him). Added only if nobody
-- of that slug or name is there yet; safe to run again. His email and mobile go in from a private
-- file, not this one.
--
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/speakers-manish-prahlad.sql

INSERT INTO speakers (event_id, slug, name, role, organisation, topic, photo_url, sort_order)
SELECT 1, 'manish-k-prahlad', 'Manish K. Prahlad', 'Co-Founder and CEO', 'Verdant Impact', 'AI in Agriculture', '/images/speaker-manish-prahlad-sq.webp', 64
WHERE NOT EXISTS (SELECT 1 FROM speakers WHERE event_id = 1 AND (slug = 'manish-k-prahlad' OR lower(name) LIKE '%prahlad%'));
