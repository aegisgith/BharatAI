-- The app's exhibitor list brought level with the website (organiser, 18 Nov 2026:
-- "if someone is on the web it should be on the app and vice versa").
-- 1. The 8 companies on the website but not in the app: added, each with a booking
--    row (exhibitor_team_settings) so the app lists them; no booth number yet (set it
--    in Admin -> Exhibitors). 2. Every exhibitor gets its website logo where the app
--    has none, so the Exhibition tab shows it. Never overwrites a logo set in Admin.
-- Safe to run twice. From now on Admin -> Exhibitors is the only list: the website
-- wall is drawn from it on every build (scripts/gen-exhibitor-logos.mjs --from-app).

-- 1. New in the app
INSERT INTO exhibitors (event_id, company_name, description, logo_url, booth_number, booth_size, category)
SELECT 1, 'Actin Technologies', '', 'https://bharataiinnovation.com/images/exhibitors/actin-technologies.webp', '', 'standard', ''
WHERE NOT EXISTS (SELECT 1 FROM exhibitors WHERE event_id = 1 AND lower(company_name) = lower('Actin Technologies'));
INSERT OR IGNORE INTO exhibitor_team_settings (exhibitor_id) SELECT id FROM exhibitors WHERE event_id = 1 AND lower(company_name) = lower('Actin Technologies');

INSERT INTO exhibitors (event_id, company_name, description, logo_url, booth_number, booth_size, category)
SELECT 1, 'Aegis School of Data Science & AI', '', 'https://bharataiinnovation.com/images/exhibitors/aegis-school-of-data-science-and-ai.webp', '', 'standard', ''
WHERE NOT EXISTS (SELECT 1 FROM exhibitors WHERE event_id = 1 AND lower(company_name) = lower('Aegis School of Data Science & AI'));
INSERT OR IGNORE INTO exhibitor_team_settings (exhibitor_id) SELECT id FROM exhibitors WHERE event_id = 1 AND lower(company_name) = lower('Aegis School of Data Science & AI');

INSERT INTO exhibitors (event_id, company_name, description, logo_url, booth_number, booth_size, category)
SELECT 1, 'AI Products Factory', '', 'https://bharataiinnovation.com/images/exhibitors/ai-products-factory.webp', '', 'standard', ''
WHERE NOT EXISTS (SELECT 1 FROM exhibitors WHERE event_id = 1 AND lower(company_name) = lower('AI Products Factory'));
INSERT OR IGNORE INTO exhibitor_team_settings (exhibitor_id) SELECT id FROM exhibitors WHERE event_id = 1 AND lower(company_name) = lower('AI Products Factory');

INSERT INTO exhibitors (event_id, company_name, description, logo_url, booth_number, booth_size, category)
SELECT 1, 'Kavion.ai', '', 'https://bharataiinnovation.com/images/exhibitors/kavion-ai.webp', '', 'standard', ''
WHERE NOT EXISTS (SELECT 1 FROM exhibitors WHERE event_id = 1 AND lower(company_name) = lower('Kavion.ai'));
INSERT OR IGNORE INTO exhibitor_team_settings (exhibitor_id) SELECT id FROM exhibitors WHERE event_id = 1 AND lower(company_name) = lower('Kavion.ai');

INSERT INTO exhibitors (event_id, company_name, description, logo_url, booth_number, booth_size, category)
SELECT 1, 'Yarnit', '', 'https://bharataiinnovation.com/images/exhibitors/yarnit.webp', '', 'standard', ''
WHERE NOT EXISTS (SELECT 1 FROM exhibitors WHERE event_id = 1 AND lower(company_name) = lower('Yarnit'));
INSERT OR IGNORE INTO exhibitor_team_settings (exhibitor_id) SELECT id FROM exhibitors WHERE event_id = 1 AND lower(company_name) = lower('Yarnit');

INSERT INTO exhibitors (event_id, company_name, description, logo_url, booth_number, booth_size, category)
SELECT 1, 'Lenixvision', '', 'https://bharataiinnovation.com/images/exhibitors/lenixvision.webp', '', 'standard', ''
WHERE NOT EXISTS (SELECT 1 FROM exhibitors WHERE event_id = 1 AND lower(company_name) = lower('Lenixvision'));
INSERT OR IGNORE INTO exhibitor_team_settings (exhibitor_id) SELECT id FROM exhibitors WHERE event_id = 1 AND lower(company_name) = lower('Lenixvision');

INSERT INTO exhibitors (event_id, company_name, description, logo_url, booth_number, booth_size, category)
SELECT 1, 'Pramaana Labs', '', 'https://bharataiinnovation.com/images/exhibitors/pramaana-labs.webp', '', 'standard', ''
WHERE NOT EXISTS (SELECT 1 FROM exhibitors WHERE event_id = 1 AND lower(company_name) = lower('Pramaana Labs'));
INSERT OR IGNORE INTO exhibitor_team_settings (exhibitor_id) SELECT id FROM exhibitors WHERE event_id = 1 AND lower(company_name) = lower('Pramaana Labs');

INSERT INTO exhibitors (event_id, company_name, description, logo_url, booth_number, booth_size, category)
SELECT 1, 'Wissen Technology', '', 'https://bharataiinnovation.com/images/exhibitors/wissen-technology.webp', '', 'standard', ''
WHERE NOT EXISTS (SELECT 1 FROM exhibitors WHERE event_id = 1 AND lower(company_name) = lower('Wissen Technology'));
INSERT OR IGNORE INTO exhibitor_team_settings (exhibitor_id) SELECT id FROM exhibitors WHERE event_id = 1 AND lower(company_name) = lower('Wissen Technology');

-- 2. Logos for the exhibitors already in the app
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/ai-vie-insights.webp' WHERE id = 9 AND company_name = 'Ai Vie Insights Private Limited' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/algoanalytics.webp' WHERE id = 6 AND company_name = 'Algo Analytics' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/aria-telecom.webp' WHERE id = 41 AND company_name = 'Aria Telecom' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/asmadiya-technologies.webp' WHERE id = 12 AND company_name = 'Asmadiya' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/assessfy.webp' WHERE id = 39 AND company_name = 'Assessfy' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/cosmica-telematics.webp' WHERE id = 8 AND company_name = 'COSMICA TELEMATICS PRIVATE LIMITED' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/cloud-crane.webp' WHERE id = 42 AND company_name = 'Cloud Crane' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/daten-technology-solutions.webp' WHERE id = 16 AND company_name = 'Daten Intelligenz Software, AIGyan Technologies' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/dysosphere.webp' WHERE id = 43 AND company_name = 'Dysosphere' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/eurys-infosystems.webp' WHERE id = 15 AND company_name = 'EURYS infosystemS private limited' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/envista-cyber-defence.webp' WHERE id = 28 AND company_name = 'Envista Cyber Defence' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/evoke-technologies.webp' WHERE id = 27 AND company_name = 'Evoke Technologies' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/fta-global.webp' WHERE id = 44 AND company_name = 'FTA Global' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/gupshup-ai.webp' WHERE id = 45 AND company_name = 'Gupshup' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/harrier-information-systems.webp' WHERE id = 25 AND company_name = 'Harrier Information Systems Pvt. Ltd.' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/image-infosystems.webp' WHERE id = 4 AND company_name = 'Image Infosystem' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/indigloo-software.webp' WHERE id = 32 AND company_name = 'Indigloo Software Pvt Ltd' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/info-science-labs.webp' WHERE id = 46 AND company_name = 'Info Science Labs' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/intangles.webp' WHERE id = 3 AND company_name = 'Intangles' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/jade-global.webp' WHERE id = 35 AND company_name = 'Jade Global' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/joget.webp' WHERE id = 23 AND company_name = 'Joget INC' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/joyvibe.webp' WHERE id = 47 AND company_name = 'JoyVibe' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/kirusa.webp' WHERE id = 20 AND company_name = 'Kirusa Inc' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/lightmetrics.webp' WHERE id = 48 AND company_name = 'LightMetrics' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/ministry-of-tribal-affairs.webp' WHERE id = 24 AND company_name = 'Ministry of Tribal Affairs' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/nu10-technologies.webp' WHERE id = 49 AND company_name = 'Nu10 Technologies' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/oranje-ai.webp' WHERE id = 14 AND company_name = 'ORANJE AI PRIVATE LIMITED' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/oliai.webp' WHERE id = 38 AND company_name = 'Oli AI' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/origins-ai.webp' WHERE id = 19 AND company_name = 'Origin AI' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/p99soft.webp' WHERE id = 51 AND company_name = 'P99Soft' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/paisani-technology-services.webp' WHERE id = 13 AND company_name = 'Paisani Technology Services' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/phoebetal-technologies.webp' WHERE id = 30 AND company_name = 'Phoebetal Technologies Pvt Ltd' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/qapitol-ai.webp' WHERE id = 2 AND company_name = 'Qapitol AI' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/redferns-tech.webp' WHERE id = 29 AND company_name = 'RedFerns Tech Private Limited' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/rightangle-technologies.webp' WHERE id = 52 AND company_name = 'Rightangle Technologies' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/saranyu-technologies.webp' WHERE id = 11 AND company_name = 'Saranyu Technologies' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/seem-fintech-and-sustainability.webp' WHERE id = 7 AND company_name = 'Seem Fintech & Sustainability Pvt Ltd' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/teenage-works.webp' WHERE id = 53 AND company_name = 'Teenage Works' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/trust3-ai.webp' WHERE id = 54 AND company_name = 'Trust3 AI' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/valuenable.webp' WHERE id = 55 AND company_name = 'ValuEnable' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/vassar-labs.webp' WHERE id = 56 AND company_name = 'Vassar Labs' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/wyn-labs.webp' WHERE id = 17 AND company_name = 'Wyn Labs' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/xtant-tech.webp' WHERE id = 57 AND company_name = 'Xtant Tech' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/zanopy-ai.webp' WHERE id = 21 AND company_name = 'Zanopy AI' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/kadeep-ai.webp' WHERE id = 26 AND company_name = 'kadeep.ai' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/amnex-infotechnologies.webp' WHERE id = 22 AND company_name = 'Amnex technologies' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/cgi.webp' WHERE id = 5 AND company_name = 'CGI' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/nobroker.webp' WHERE id = 10 AND company_name = 'NoBroker Technologies Solutions Private Limited' AND COALESCE(logo_url, '') = '';
UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/ary-soft.webp' WHERE id = 31 AND company_name = 'ary-soft' AND COALESCE(logo_url, '') = '';
