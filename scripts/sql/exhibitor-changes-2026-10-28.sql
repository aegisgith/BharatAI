-- 28 Oct 2026: Origin AI is now Origins AI, with a new logo; Amnex Infotechnologies
-- and Indigloo Software have dropped out and their logos are off the website.
-- The organiser runs it; safe to run again (every line checks before it writes):
--
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/exhibitor-changes-2026-10-28.sql
--
-- The old logo files are deleted from the site, so a logo_url still pointing at one
-- would show a broken image in the app. Amnex (22) and Indigloo (32) keep their
-- exhibitor rows, booths and passes: removing those is the organiser's call.

UPDATE exhibitors SET company_name = 'Origins AI' WHERE id = 19 AND company_name = 'Origin AI';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/origins-ai.webp' WHERE id = 19 AND (COALESCE(logo_url, '') = '' OR logo_url = 'https://bharataiinnovation.com/images/exhibitors/origin-ai.webp');
UPDATE innovation_talks SET company = 'Origins AI' WHERE event_id = 1 AND company = 'Origin AI';

UPDATE exhibitors SET logo_url = NULL WHERE id = 22 AND logo_url = 'https://bharataiinnovation.com/images/exhibitors/amnex-infotechnologies.webp';
UPDATE exhibitors SET logo_url = NULL WHERE id = 32 AND logo_url = 'https://bharataiinnovation.com/images/exhibitors/indigloo-software.webp';
