-- 30 Oct 2026: Aegis School of Data Science & AI and Assessfy as exhibitors in the app.
-- Both have been on the website's exhibitor wall since 4 Oct, but they had no row in
-- exhibitors, so the app's Exhibitors tab never showed them. The organiser runs it,
-- after the site deploy that serves the logos; safe to run again:
--
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/exhibitor-changes-2026-10-30.sql
--
-- A row is added only when no exhibitor of that name exists yet; if one was made by
-- hand in the meantime, it only gets the logo, and only where it has none. No booth
-- number: the card leaves it out. description and category are set because the
-- app's card prints both as they are (a NULL would show the word "null").
--
-- Cloud Crane, Lenixvision, Trust3 AI and Wissen Technology (new on the website today)
-- are not here: they had no exhibitor row that this file could match.

INSERT INTO exhibitors (event_id, company_name, description, category, booth_size, website_url, logo_url)
SELECT 1, 'Aegis School of Data Science & AI', '', 'Education', 'standard', 'https://www.aegis.edu.in',
       'https://bharataiinnovation.com/images/exhibitors/aegis-school-of-data-science-and-ai.webp'
WHERE NOT EXISTS (SELECT 1 FROM exhibitors WHERE event_id = 1 AND lower(company_name) LIKE '%aegis%');

INSERT INTO exhibitors (event_id, company_name, description, category, booth_size, website_url, logo_url)
SELECT 1, 'Assessfy', '', 'Education', 'standard', 'https://assessfy.com',
       'https://bharataiinnovation.com/images/exhibitors/assessfy.webp'
WHERE NOT EXISTS (SELECT 1 FROM exhibitors WHERE event_id = 1 AND lower(company_name) LIKE '%assessfy%');

UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/aegis-school-of-data-science-and-ai.webp'
WHERE event_id = 1 AND lower(company_name) LIKE '%aegis%' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/assessfy.webp'
WHERE event_id = 1 AND lower(company_name) LIKE '%assessfy%' AND COALESCE(logo_url, '') = '';
