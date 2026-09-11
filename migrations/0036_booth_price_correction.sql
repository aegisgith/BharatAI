-- Migration 0036: the two prices the catalogue got wrong, and the one size.
--
-- There are two price tables, not one, and they have been contradicting each
-- other in production. `booth_types` is the catalogue: /api/booth-types reads it
-- and the /app "Exhibition Booth Packages" cards render it verbatim. `booths` is
-- the floor plan: 93 individual stands, each with its own list_price_inr, and it
-- feeds the admin Booth Inventory screen. Somebody repriced `booths` by hand and
-- nothing carried the change across, so for months the same two packages have
-- been quoted at two different prices depending on which screen the customer
-- happened to open:
--
--                     booth_types (/app)      booths (admin, floor plan)
--   Startup Pod       38,000                  48,000
--   Explorer Booth    1,25,000                1,29,000
--
-- The organiser has confirmed which side is right, and the arithmetic agrees:
-- Explorer is 4 sqm and the hall sells at Rs 32,250/sqm, which is 1,29,000 to
-- the rupee. (The Startup Pod is deliberately below rate - it is the subsidised
-- tier for early-stage startups - so it is confirmed by the organiser rather
-- than by the rate card.)
--
-- The pod's SIZE is corrected here for the same reason. The catalogue says
-- 1.5 x 1.2 / 1.8 sqm, which appears nowhere else in the system: every seeded
-- stand, /inquiry, /exhibition and the homepage FAQ all say 1.5 x 1.5 / 2.25 sqm.
-- The 1.8 is a fossil of the size_label EXAMPLE in 0011's own schema comment.
-- Left alone it would keep telling a startup they are buying a stand that does
-- not exist on the floor.

UPDATE booth_types
   SET price_inr = 48000, size_label = '1.5 × 1.5', area_sqm = 2.25, area_sqft = 24
 WHERE slug = 'startup-pod';

UPDATE booth_types
   SET price_inr = 129000
 WHERE slug = 'explorer-booth';

-- The same two corrections against the floor-plan table. Production already
-- holds both, so this is a no-op there; it matters for any database built from
-- 0030, whose seed still carries the old numbers.
UPDATE booths SET list_price_inr = 48000  WHERE type_key = 'pod';
UPDATE booths SET list_price_inr = 129000 WHERE type_key = 'explorer';

-- The hall revenue target was computed from the old prices, and 0030 inserts it
-- with INSERT OR IGNORE, so it can never correct itself. Sum of the 93 stands at
-- the corrected prices is 1,86,90,000 - the old target was four lakh light, which
-- would have shown the sales team as ahead of a target that did not exist.
UPDATE app_settings SET value = '18690000' WHERE key = 'booth_revenue_target_inr';
