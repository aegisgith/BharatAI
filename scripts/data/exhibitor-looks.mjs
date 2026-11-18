// How each exhibitor's logo looks on the website: its source file, `optical`, `dark`,
// matched to the app's exhibitor rows by `db` id or by name. Moved here from
// scripts/gen-exhibitor-logos.mjs on 18 Nov 2026 so the Worker (src/routes/site-live.ts)
// can draw the wall live from the app with the same list. Edit it here.

// SINCE 18 NOV 2026 THE APP IS THE LIST (organiser: "if someone is on the web it should
// be on the app and vice versa"). `--from-app`, run by scripts/sync-programme.mjs on
// every Pages build, draws the wall from the app's public exhibitor list (Admin ->
// Exhibitors): add, edit, delete or upload a logo there and the website follows on
// the next deploy. This list then only says how each logo looks (its file, `optical`,
// `dark`), matched by `db` id or by name. `untilApp: true` on an entry keeps a company
// on the wall while the app does not have it yet (none now: the 18 Nov sync SQL ran
// that day); remove the flag as soon as the app has the company.
export const EXHIBITORS = [
  { name: 'Actin Technologies', file: 'Actin Technologies logo.jpg' },
  { name: 'Aegis School of Data Science & AI', file: 'Our Logo/logo-aegis (1) (1).webp', optical: 1.15 },
  { name: 'AI Products Factory', file: 'Our Logo/AI Product Factory/aipf-logo-horizontal-transparent.png' },
  // Back on 18 Nov 2026 (organiser): logos restored from before 91bc99b; no source file.
  { name: 'Amnex Infotechnologies', db: [22, 'Amnex technologies'] },
  { name: 'Indigloo Software', db: [32, 'Indigloo Software Pvt Ltd'] },
  // 18 Nov 2026, sent by the organiser on WhatsApp (baked with this script's bake(), grey field whitened).
  { name: 'Kavion.ai' },
  { name: 'Yarnit' },
  { name: 'Ai Vie Insights', file: 'Ai Vie Insights Private Limited.jpg', db: [9, 'Ai Vie Insights Private Limited'] },
  { name: 'AlgoAnalytics', file: 'Algo Analytics.jpg', db: [6, 'Algo Analytics'] },
  { name: 'Aria Telecom', file: 'Aria Telecom Solutions Pvt. Ltd.jpg', dark: true }, // white wordmark on navy
  { name: 'Ary-Soft', file: 'ary-soft logo.jpg', db: [31, 'ary-soft'] },
  { name: 'Asmadiya Technologies', file: '4 Nov Presenter/Asmadiya- Ashish Kumar Mishra & Shuvam Giri.png', db: [12, 'Asmadiya'], optical: 1.2 },
  { name: 'Assessfy', file: 'Our Logo/Assessfy.png', optical: 1.15 },
  { name: 'CGI', file: 'CGI logo.jpg', db: [5, 'CGI'] },
  // The file says "CloudCarne"; the artwork says CLOUD CRANE.
  { name: 'Cloud Crane', file: 'CloudCarne logo.jpg', dark: true }, // white and yellow on black
  { name: 'Cosmica Telematics', file: 'COSMICA TELEMATICS PRIVATE LIMITED.jpg', db: [8, 'COSMICA TELEMATICS PRIVATE LIMITED'] },
  { name: 'Daten Technology Solutions', file: 'Daten Technology Solutions logo.jpg', db: [16, 'Daten Intelligenz Software, AIGyan Technologies'] },
  { name: 'Dysosphere', file: 'Dysosphere Pvt Ltd Logo.png' },
  { name: 'Envista Cyber Defence', file: 'Envista cyber defence logo.jpg', db: [28, 'Envista Cyber Defence'] },
  { name: 'Eurys Infosystems', file: 'EURYS infosystemS private limited.jpg', db: [15, 'EURYS infosystemS private limited'] },
  { name: 'Evoke Technologies', file: 'Evoke Technologies logo.jpg', db: [27, 'Evoke Technologies'] },
  { name: 'FTA Global', file: '4 Nov New logo/FTA GLOBAL.jpg' },
  // Startup Pod, 18 Nov 2026 (organiser, logo by chat; baked with bake(), grey field whitened).
  { name: 'GeNext Genomics', db: [118, 'GeNext Genomics Pvt Ltd'], untilApp: true }, // until exhibitor-genext-genomics-2026-11-18.sql runs
  { name: 'Gupshup.ai', file: 'gupshup ai logo.jpg' },
  { name: 'Harrier Information Systems', file: 'Harrier Information Systems Pvt. Ltd. logo.jpg', db: [25, 'Harrier Information Systems Pvt. Ltd.'], optical: 1.1 },
  { name: 'Image Infosystems', file: 'Image Infosystem.jpg', db: [4, 'Image Infosystem'], optical: 1.3 },
  { name: 'Info Science Labs', file: 'Info Science Labs logo.jpg' },
  { name: 'Intangles', file: 'Intangles Logo.jpg', db: [3, 'Intangles'] },
  { name: 'Jade Global', file: 'Jade Global logo.jpg' },
  { name: 'Joget', file: 'Joget INC logo.jpg', db: [23, 'Joget INC'] },
  { name: 'JoyVibe', file: 'joyvibe_logo.jpg', optical: 1.15 },
  { name: 'Kadeep.ai', file: 'Kadeep Ai logo.jpg', db: [26, 'kadeep.ai'] },
  { name: 'Kirusa', file: 'Kirusa Inc.jpg', db: [20, 'Kirusa Inc'] },
  { name: 'Lenixvision', file: 'Lenixvision Smart Eyewear Logo.png', optical: 1.2 },
  { name: 'LightMetrics', file: 'LightMetrics logo.jpg' },
  // The ministry's own logo (organiser, 4 Oct), replacing an old Azadi Ka Amrit Mahotsav graphic.
  { name: 'Ministry of Tribal Affairs', file: 'Minsitry of Tribal Affairs  Logo.png', db: [24, 'Ministry of Tribal Affairs'], optical: 1.3 },
  { name: 'NoBroker', file: 'NoBroker Technologies Solutions Private Limited.jpg', db: [10, 'NoBroker Technologies Solutions Private Limited'] },
  // New logo 18 Nov 2026 (organiser, WhatsApp); baked by hand, so no source file here.
  { name: 'Nu10 Technologies', db: [49, 'Nu10 Technologies'] },
  { name: 'OliAI', file: 'Oli AI  Logo_.jpg', optical: 1.15, db: [38, 'Oli AI'] },
  { name: 'Oranje AI', file: 'ORANJE AI PRIVATE LIMITED logo.png', db: [14, 'ORANJE AI PRIVATE LIMITED'] },
  // Renamed Origins AI with a new logo on 28 Oct; the database row is renamed by
  // scripts/sql/exhibitor-changes-2026-10-28.sql (organiser runs it).
  { name: 'Origins AI', file: 'Origins AI Logo_.png', db: [19, 'Origins AI'] },
  { name: 'P99Soft', file: 'P99SOFT Logo.jpg', dark: true }, // white mark on dark teal
  { name: 'Paisani Technology Services', file: 'Paisani Technology Services_.jpg', db: [13, 'Paisani Technology Services'], optical: 1.2 }, // thin script
  { name: 'Phoebetal Technologies', file: 'Phoebetal Technologies Pvt Ltd.jpg', db: [30, 'Phoebetal Technologies Pvt Ltd'] },
  { name: 'Pramaana Labs', file: 'pramaana labs logo.jpg' },
  { name: 'Qapitol AI', file: 'Qapitol AI logo.jpg', db: [2, 'Qapitol AI'] },
  { name: 'RedFerns Tech', file: 'RedFerns Tech Private Limited.jpg', db: [29, 'RedFerns Tech Private Limited'] },
  { name: 'Rightangle Technologies', file: '4 Nov New logo/Rightangle Technologies Pvt. Ltd_' }, // no extension; it is a JPEG
  { name: 'Saranyu Technologies', file: 'Saranyu Technologies.jpg', db: [11, 'Saranyu Technologies'] },
  { name: 'Seem Fintech & Sustainability', file: 'Seem Fintech & Sustainability Pvt Ltd.jpg', db: [7, 'Seem Fintech & Sustainability Pvt Ltd'] },
  { name: 'Teenage Works', file: 'Teenage Works Logo.jpg' },
  { name: 'Trust3 AI', file: 'Trust3 AI Logo.png' },
  { name: 'ValuEnable', file: 'Valuenable pvt ltd.jpg' },
  { name: 'Vassar Labs', file: 'Vassar Lab logo.jpg' },
  { name: 'Wissen Technology', file: 'Wissen Technology Logo.jpg', dark: true }, // white mark on navy
  { name: 'Wyn Labs', file: 'Wyn Labs.jpg', db: [17, 'Wyn Labs'] },
  { name: 'Xtant Tech', file: 'Xtant Tech.png', dark: true }, // white wordmark on a big black square
  { name: 'Zanopy AI', file: 'Zanopy AI.jpg', db: [21, 'Zanopy AI'] },
]
export const MEDIA_PARTNER = { name: 'The Mainstream', file: 'Digital Media Partner/The MAINSTREAM logo Digital Media Partner.jpeg' }
