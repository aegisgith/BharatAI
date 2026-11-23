// "Share your Bharat AI moment" (/share, 23 Nov 2026): the rules of the cards and
// their words, and the server parts they lean on, in one file.
//   rules:  js/moment-card.js run in node:vm (no browser): the words for every card
//           and platform (X within 280, the right handle on each platform, the pass
//           said only when it is a bought one, Powered by IDFC FIRST Bank), the
//           photos and logos it draws all exist, the partners in partners.json order.
//   server: the built worker on real SQLite with the production schema: the step
//           counter takes kind 'moment' from the person only, /app carries the
//           Home card, the sign-in link action and the move of the old badge
//           button to /share; the page itself is wired (scripts, strip, preview).
// Run after `npm run build`:  node scripts/verify/unit-share-moment.mjs
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { sessionCookie } from './pay-db.mjs';
const require = createRequire(import.meta.url);
const ROOT = new URL('../../', import.meta.url);
const pub = (p) => new URL('public' + p, ROOT);
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };

// ---------------------------------------------------------------- rules
const box = { window: { location: { origin: 'https://bharataiinnovation.com' } }, URL };
box.window.URL = URL;
vm.createContext(box);
vm.runInContext(readFileSync(pub('/js/moment-card.js'), 'utf8'), box);
const MC = box.window.BhaiMomentCard;
check('moment-card.js loads and exposes the renderer', !!(MC && MC.render && MC.captions), typeof MC);

const longTk = 'Agentic AI is moving from pilots to production, and the companies that win will be the ones that cleaned their data first, years ago.';
const me = (pass) => ({ name: 'Asha Rao', title: 'Head of Data', company: 'Example Ltd', pass });
const speaker = { name: 'Dr. Abhijit Gangopadhyay', title: 'Dean', company: 'Aegis School of Data Science & AI' };
const ten = Array.from({ length: 10 }, (_, i) => ({ name: 'Panellist Number ' + (i + 1), title: 'Chief Executive Officer', company: 'A Very Long Company Name Private Limited', moderator: i === 9 }));
const cases = {
  attended: { me: me('delegate'), showPass: true, takeaway: longTk },
  met: { me: me('visitor'), showPass: true, takeaway: longTk, people: [speaker, { name: 'Ravi Shah', company: 'Acme' }, { name: 'Meera Iyer', title: 'CTO', company: 'Beta Labs India' }] },
  talk: { me: me('expo'), showPass: true, takeaway: longTk, talk: { kindWords: 'an Innovation Talk', topic: 'From AI Pilots to AI-Native Enterprises: Reimagining Business Processes for the Age of Autonomous Agents', speakers: [speaker] } },
  panel: { me: me('vip'), showPass: true, takeaway: longTk, panel: { topic: 'Beyond Traditional Entertainment: How AI Is Reshaping the Future of Media and Digital Content', people: ten } },
};
for (const [kind, d] of Object.entries(cases)) {
  const c = MC.captions(kind, d);
  check(`${kind}: X words fit in 280 (a link counts 23)`, MC.xLength(c.x) <= 280, MC.xLength(c.x) + ': ' + c.x);
  check(`${kind}: X words keep the link and the hashtag`, /https:\/\/bharataiinnovation\.com\/delhi\?/.test(c.x) && c.x.includes('#BharatAIInnovation'), c.x);
  check(`${kind}: LinkedIn names the page to tag, with the link and the sponsor`, c.linkedin.includes('@Bharat AI Innovation') && c.linkedin.includes('utm_source=linkedin') && c.linkedin.includes('Powered by IDFC FIRST Bank') && c.linkedin.includes('#BharatAIInnovation'), c.linkedin);
  check(`${kind}: Facebook tags @BharatAIInnovation`, c.facebook.includes('@BharatAIInnovation') && c.facebook.includes('Powered by IDFC FIRST Bank'), c.facebook);
  check(`${kind}: Instagram tags @bharataiinnovation.ai (the real handle) and has no link to click`, c.instagram.includes('@bharataiinnovation.ai') && !/https?:\/\//.test(c.instagram) && !/@bharataiinnovation(?!\.ai)/.test(c.instagram), c.instagram);
  check(`${kind}: WhatsApp has the link`, c.whatsapp.includes('utm_source=whatsapp'), c.whatsapp);
  check(`${kind}: the takeaway is in the post`, c.linkedin.includes(longTk.replace(/\.$/, '')), c.linkedin);
}
const att = (pass, showPass = true) => MC.captions('attended', { me: me(pass), showPass }).linkedin.split('\n')[0];
check('a Delegate says "as a Delegate"', /, as a Delegate\.$/.test(att('delegate')), att('delegate'));
check('a VIP says "as a VIP guest"', /, as a VIP guest\.$/.test(att('vip')), att('vip'));
check('a Premium Delegate says "as a Premium Delegate"', /as a Premium Delegate\.$/.test(att('premium')), att('premium'));
check('a free Visitor says no pass', !/ as an? /.test(att('visitor')) && /^I attended/.test(att('visitor')), att('visitor'));
check('an Expo Pass says no pass', !/ as an? /.test(att('expo')), att('expo'));
check('pass hidden: no pass in the words', !/ as an? /.test(att('delegate', false)), att('delegate', false));
check('a speaker says "I spoke at"', /^I spoke at/.test(att('speaker')), att('speaker'));
check('an exhibitor says "We exhibited at"', /^We exhibited at/.test(att('exhibitor')), att('exhibitor'));
const met = MC.captions('met', cases.met);
check('who I met: each person named, with "@" on LinkedIn to show where to tag', met.linkedin.includes('@Dr. Abhijit Gangopadhyay, Dean at Aegis School of Data Science & AI') && met.linkedin.includes('@Ravi Shah of Acme'), met.linkedin);
check('who I met: no "@" before names on Instagram (it would tag nobody)', !met.instagram.includes('@Dr.') && met.instagram.includes('Dr. Abhijit Gangopadhyay'), met.instagram);
const pan = MC.captions('panel', cases.panel).linkedin;
check('panel: every panellist listed, the moderator apart', ten.slice(0, 9).every(p => pan.includes('• @' + p.name + ',')) && pan.includes('Moderated by @Panellist Number 10'), pan);
const kw = MC.captions('talk', { me: me('delegate'), talk: { kindWords: 'a keynote', topic: '', speakers: [{ name: 'Shri Example Name', title: 'Secretary' }] } }).linkedin;
check('a keynote with no topic reads "I attended the keynote by …"', /^I attended the keynote by @Shri Example Name, Secretary, at Bharat AI Innovation/.test(kw), kw);

// pass keys agree with the pass the badge desk printed (pass-render.js tierFor)
const keys = { 'VIP Pass': 'vip', 'Premium Delegate Pass': 'premium', 'Delegate Pass': 'delegate', 'Academic Pass': 'academic', 'Student Pass': 'student', 'Expo Pass': 'expo', 'Visitor Pass': 'visitor', 'Free Visitor Pass': 'visitor', 'Speaker': 'speaker', 'Exhibitor': 'exhibitor', 'Organiser': 'organiser', 'Media Pass': 'media' };
const wrong = Object.entries(keys).filter(([b, k]) => MC.passKey(b, '') !== k);
check('every pass name maps to its own pass colour', !wrong.length, JSON.stringify(wrong));
check('a role of speaker on a Visitor Pass is a speaker', MC.passKey('Visitor Pass', 'speaker') === 'speaker', MC.passKey('Visitor Pass', 'speaker'));

const missing = [];
for (const b of MC.BACKDROPS) { if (!existsSync(pub(b.src))) missing.push(b.src); if (!existsSync(pub(b.src.replace(/\.webp$/, '-720.webp')))) missing.push(b.src + ' (720)'); }
for (const id of Object.keys(MC.PANEL_PHOTOS)) { const s = MC.PANEL_PHOTOS[id].src; if (!existsSync(pub(s))) missing.push(s); if (!existsSync(pub(s.replace(/\.webp$/, '-720.webp')))) missing.push(s + ' (720)'); }
for (const s of MC.PARTNER_LOGOS.concat(['/images/logo-idfc-first-bank.webp', '/images/Bharat AI Innovation Logo.png'])) if (!existsSync(pub(s))) missing.push(s);
check('every event photo, its thumbnail and every logo the cards draw is on the site', !missing.length, missing.join(', '));
check('twelve panels have their own photo', Object.keys(MC.PANEL_PHOTOS).length === 12, Object.keys(MC.PANEL_PHOTOS).length);
const partners = JSON.parse(readFileSync(new URL('src/data/partners.json', ROOT), 'utf8'));
check('the partners on the cards are partners.json, in its order', JSON.stringify(MC.PARTNER_LOGOS) === JSON.stringify(partners.partners.map(p => p.logo)), JSON.stringify(MC.PARTNER_LOGOS));

// ---------------------------------------------------------------- the page
const page = readFileSync(pub('/share.html'), 'utf8');
check('/share loads the renderer and the page script, each with a version', /src="\/js\/moment-card\.js\?v=\w+"/.test(page) && /src="\/js\/share-studio\.js\?v=\w+"/.test(page), 'script tags');
check('/share carries the partners strip and its own link preview', page.includes('data-partners-block="1"') && page.includes('/images/og/share.jpg') && existsSync(pub('/images/og/share.jpg')), 'strip/og');
check('/share signs people in through the app and comes back', readFileSync(pub('/js/share-studio.js'), 'utf8').includes("/app?action=share-moment"), 'sign-in link');
check('/share is in the sitemap', readFileSync(pub('/sitemap.xml'), 'utf8').includes('<loc>https://bharataiinnovation.com/share</loc>'), 'sitemap');

// ---------------------------------------------------------------- server
const worker = (await import(new URL('dist/_worker.js?' + Date.now(), ROOT).href)).default;
const initSqlJs = require('sql.js');
const SQL = await initSqlJs();
const db = new SQL.Database();
db.exec(readFileSync(new URL('./prod-schema.sql', import.meta.url), 'utf8'));
const clean = (a) => a.map(v => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
const D1 = {
  prepare(sql) {
    let args = [];
    const s = {
      bind(...a) { args = clean(a); return s; },
      async first() { const st = db.prepare(sql); st.bind(args); const r = st.step() ? st.getAsObject() : null; st.free(); return r; },
      async all() { const st = db.prepare(sql); st.bind(args); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return { results: out }; },
      async run() { db.run(sql, args); return { meta: { last_row_id: db.exec('SELECT last_insert_rowid()')[0].values[0][0], changes: db.getRowsModified() } }; },
    };
    return s;
  },
  async batch(list) { for (const s of list) await s.run(); return list.map(() => ({ results: [], meta: {} })); },
  async exec(sql) { db.exec(sql); return { count: 1 }; },
};
const SESSION = 'share-session';
const env = new Proxy({ ADMIN_SECRET: 'share-admin', SESSION_SECRET: SESSION, DB: D1 }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };
const hit = async (method, path, body, headers = {}) => {
  const req = new Request('https://bharataiinnovation.com' + path, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/128.0 Mobile', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await worker.fetch(req, env, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
};
const as = (id) => ({ Cookie: sessionCookie(SESSION, id) });
db.run("INSERT INTO events (id, title, start_date, end_date) VALUES (1, 'Bharat AI', '2026-11-20', '2026-11-21')");
db.run("INSERT INTO attendees (id, event_id, name, email, mobile, badge_type, payment_status, company, job_title) VALUES (1, 1, 'Asha Rao', 'asha@example.com', '9820000001', 'Delegate Pass', 'paid', 'Example Ltd', 'Head of Data')");
db.run("INSERT INTO attendees (id, event_id, name, email, mobile, badge_type, payment_status) VALUES (2, 1, 'Ravi Shah', 'ravi@example.com', '9820000002', 'Delegate Pass', 'pending')");

let r = await hit('POST', '/api/attendees/1/track-step', { kind: 'moment', step: 'made', reason: 'talk linkedin' });
check('step: no session is refused', r.status === 401, r.status + ' ' + r.text);
r = await hit('POST', '/api/attendees/1/track-step', { kind: 'moment', step: 'made', reason: 'talk linkedin' }, as(2));
check('step: someone else is refused', r.status === 403, r.status + ' ' + r.text);
r = await hit('POST', '/api/attendees/1/track-step', { kind: 'moment', step: 'dance' }, as(1));
check('step: an unknown step is refused', r.status === 400, r.status + ' ' + r.text);
for (const step of ['open', 'made', 'shared', 'saved', 'copied', 'opened']) {
  r = await hit('POST', '/api/attendees/1/track-step', { kind: 'moment', step, reason: 'talk linkedin' }, as(1));
  check(`step: "${step}" is counted`, r.status === 200 && r.json && r.json.ok === true, r.status + ' ' + r.text);
}
const audit = db.exec("SELECT action, detail FROM admin_audit WHERE entity_id = '1' AND action = 'moment.shared'");
check('step: kept as moment.shared with the picture and the platform', audit.length && String(audit[0].values[0][1]).includes('talk linkedin'), JSON.stringify(audit));
r = await hit('POST', '/api/attendees/1/track-step', { kind: 'card', step: 'shared' }, as(1));
check('step: the old badge kinds did not gain the new steps', r.status === 400, r.status);

r = await hit('GET', '/api/attendees/1', undefined, as(1));
check('the page reads its own record: name, designation, pass, event', r.status === 200 && r.json.name === 'Asha Rao' && r.json.job_title === 'Head of Data' && /delegate/i.test(r.json.badge_type) && Number(r.json.event_id) === 1, r.status + ' ' + r.text.slice(0, 200));
r = await hit('GET', '/api/attendees/2', undefined, as(2));
check('an unpaid Delegate reads as a Visitor, so the card says no Delegate', r.status === 200 && !/delegate/i.test(r.json.badge_type), r.json && r.json.badge_type);

const app = await hit('GET', '/app');
const js = await hit('GET', '/app.js');
check('/app has the "Share your Bharat AI moment" Home card, linking to /share', app.text.includes('id="share-moment-card"') && app.text.includes('href="/share"'), 'card');
check('/app.js: the card shows after Mumbai, for a Mumbai registrant', js.text.includes('function renderShareMomentCard') && /function mumbaiOverInApp\(\) \{ return Date\.now\(\) >= 17\d{11}; \}/.test(js.text), 'renderShareMomentCard');
check('/app.js: the sign-in link with action=share-moment comes back to /share', /act === 'share-moment'[\s\S]{0,120}location\.href = '\/share'/.test(js.text), 'share-moment');
check('/app.js: the old badge button goes to /share after Mumbai, a campus panel card does not', /typeof preferPanel !== 'string' && currentUser && Number\(currentUser\.event_id \|\| 1\) === 1 && mumbaiOverInApp\(\)\) \{ window\.location\.href = '\/share'; return; \}/.test(js.text), 'openSocialCard');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
