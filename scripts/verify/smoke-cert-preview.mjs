// Certificate preview in Admin (23 Nov 2026), on the built worker with real SQLite (sql.js),
// the production schema and this process's clock moved to the event days:
//  - Admin -> Workshop Seats marks every seat holder: "ready" (the app gives them the
//    workshop certificate), "not_there" (no check-in at the venue on the workshop day) or
//    "not_over" (the workshop has not ended);
//  - each mark agrees with the attendee's own GET /api/attendees/:id/certificate-eligibility,
//    which Admin's preview also reads (with the admin token);
//  - the marks are for Admin only;
//  - the drawing lives in /js/cert-render.js, loaded by /app and /admin, and the app no
//    longer carries its own copy.
// Run after `npm run build`:  node scripts/verify/smoke-cert-preview.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const Real = Date;
let off = 0;
globalThis.Date = class extends Real {
  constructor(...a) { if (a.length) super(...a); else super(Real.now() + off); }
  static now() { return Real.now() + off; }
};
const at = (day, hhmm) => { off = Real.parse(`${day}T${hhmm}:00+05:30`) - Real.now(); };
at('2026-11-21', '11:00');

const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');
const worker = (await import(new URL('../../dist/_worker.js?' + Real.now(), import.meta.url).href)).default;
const SQL = await initSqlJs();
const db = new SQL.Database();
db.exec(readFileSync(new URL('./prod-schema.sql', import.meta.url), 'utf8'));
db.exec(readFileSync(new URL('../../migrations/0051_leads_and_daily_checkins.sql', import.meta.url), 'utf8'));
// The programme tables and a stage talk's own address, for the certificates by email (24 Nov 2026).
for (const m of ['0052_innovation_talk_details.sql', '0054_conference_manager.sql']) { try { db.exec(readFileSync(new URL('../../migrations/' + m, import.meta.url), 'utf8')); } catch (e) { console.log('note: ' + m + ': ' + e.message); } }
const clean = (a) => a.map(v => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
const rows = (sql, args) => { const st = db.prepare(sql); st.bind(args); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; };
const D1 = {
  prepare(sql) {
    let args = [];
    const s = {
      bind(...a) { args = clean(a); return s; },
      async first() { return rows(sql, args)[0] || null; },
      async all() { return { results: rows(sql, args) }; },
      async run() { db.run(sql, args); return { meta: { last_row_id: db.exec('SELECT last_insert_rowid()')[0].values[0][0], changes: db.getRowsModified() } }; },
      _rows() { return rows(sql, args); },
    };
    return s;
  },
  async batch(list) { return list.map(s => ({ results: s._rows(), meta: {} })); },
  async exec(sql) { db.exec(sql); return { count: 1 }; },
};
const sent = [];
globalThis.fetch = async (url, init) => {
  if (String(url).includes('elasticemail')) { try { const b = JSON.parse(init.body); sent.push({ to: b.Recipients.To[0], subject: b.Content.Subject, html: b.Content.Body[0].Content }); } catch {} }
  return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const SESSION = 'smoke-session', ADMIN = 'smoke-admin';
const env = new Proxy({ ADMIN_SECRET: ADMIN, SESSION_SECRET: SESSION, ELASTIC_EMAIL_API_KEY: 'smoke-key', DB: D1 }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };
const hit = async (method, path, body, headers = {}) => {
  const req = new Request('https://bharataiinnovation.com' + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await worker.fetch(req, env, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
};
const admin = { Authorization: 'Bearer ' + ADMIN };
const { sessionCookie } = await import('./pay-db.mjs');
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 300))); if (!ok) fails++; };

// Mumbai's three workshops: two on Friday, one on Saturday.
db.run("INSERT INTO events (id, title, start_date, end_date) VALUES (1, 'Bharat AI', '2026-11-20', '2026-11-21')");
db.run(`INSERT INTO workshops (id, event_id, slug, title, speaker, starts_at, ends_at) VALUES
  (2, 1, 'fde', 'From Prototype to Production', 'Dr. Ashish Tendulkar', '2026-11-20 14:00', '2026-11-20 15:30'),
  (3, 1, 'llm', 'LLM Fine-Tuning, Hands-On', 'Virendra Pal', '2026-11-21 10:30', '2026-11-21 12:00'),
  (5, 1, 'ibm', 'AI, Trust and Evolving Skills using IBM Bob', 'KrishnaKanth Naik', '2026-11-20 11:30', '2026-11-20 13:00')`);
// id, seat, check-in days (checkins rows), first arrival (attendees.checked_in_at, UTC)
const people = [
  [1, 3, ['2026-11-20', '2026-11-21'], '2026-11-20 04:30:00'],  // Saturday seat, in both days
  [2, 3, ['2026-11-20'], '2026-11-20 04:30:00'],                // Saturday seat, Friday only
  [3, 2, ['2026-11-20'], '2026-11-20 04:30:00'],                // Friday seat, in Friday
  [4, 5, [], null],                                            // never came
  [5, null, ['2026-11-21'], '2026-11-21 04:30:00'],             // no seat
  [6, 3, [], '2026-11-21 04:30:00'],                            // admitted before the day table: first arrival on Saturday
  [7, 2, [], '2026-11-19 20:00:00'],                            // 1:30 am Friday in India, a UTC Thursday
];
for (const [id, seat, days, first] of people) {
  db.run("INSERT INTO attendees (id, event_id, name, email, badge_type, payment_status, main_event, checked_in_at) VALUES (?, 1, ?, ?, 'VIP Pass', 'paid', 1, ?)", [id, 'Person ' + id, 'p' + id + '@example.test', first]);
  if (seat) db.run('INSERT INTO workshop_seats (event_id, attendee_id, workshop_id) VALUES (1, ?, ?)', [id, seat]);
  for (const d of days) db.run('INSERT INTO checkins (event_id, attendee_id, day, checked_in_at) VALUES (1, ?, ?, ?)', [id, d, d + ' 04:30:00']);
}
const marks = async () => {
  const r = await hit('GET', '/api/admin/workshops', undefined, admin);
  return Object.fromEntries((r.json?.seats || []).map(s => [s.id, s.cert]));
};
const mine = async (id) => (await hit('GET', '/api/attendees/' + id + '/certificate-eligibility', undefined, { Cookie: sessionCookie(SESSION, id) })).json;

// ---- Saturday 11:00, the Saturday workshop still running ----
let m = await marks();
check('Saturday 11:00: the Saturday workshop is "not_over" for its seat holders', m[1] === 'not_over' && m[2] === 'not_over' && m[6] === 'not_over', m);
check('Saturday 11:00: Friday workshops are over: in on Friday "ready", never came "not_there"', m[3] === 'ready' && m[4] === 'not_there', m);
check('a first arrival at 1:30 am Friday India time (a UTC Thursday) counts as Friday', m[7] === 'ready', m);
check('no seat, no mark', !(5 in m), m);

// ---- Saturday 12:30, everything over ----
at('2026-11-21', '12:30');
m = await marks();
check('Saturday 12:30: in on Saturday "ready", in on Friday only "not_there"', m[1] === 'ready' && m[2] === 'not_there', m);
check('admitted before the day table, first arrival on Saturday: "ready"', m[6] === 'ready', m);
// The QR codes (24 Nov 2026): the attendee gets one only for a certificate that is theirs
// to download; Admin gets one for every certificate it previews (to send a locked one by
// hand). Apart from that, both read the same answer.
const noQr = (j) => { const o = JSON.parse(JSON.stringify(j || {})); delete o.verify; if (o.workshop) delete o.workshop.verify; return JSON.stringify(o); };
let agree = true, qrRule = true; const seen = [];
for (const id of [1, 2, 3, 4, 6, 7]) {
  const own = await mine(id);
  const viaAdmin = (await hit('GET', '/api/attendees/' + id + '/certificate-eligibility', undefined, admin)).json;
  const same = !!own?.workshop && own.workshop.eligible === (m[id] === 'ready') && noQr(own) === noQr(viaAdmin);
  const qrOk = (own.workshop.eligible ? /^https:\/\/bharataiinnovation\.com\/certificate\/W\d+-\d+\.[0-9a-f]{16}$/.test(own.workshop.verify || '') && own.workshop.verify === viaAdmin.workshop.verify
    : !('verify' in own.workshop)) && /\/certificate\/W/.test(viaAdmin.workshop.verify || '')
    && (own.eligible ? own.verify === viaAdmin.verify && /\/certificate\/C\d+\./.test(own.verify) : !('verify' in own)) && /\/certificate\/C/.test(viaAdmin.verify || '');
  seen.push(id + ':' + m[id] + '/' + own?.workshop?.eligible + (same ? '' : ' DIFFERS') + (qrOk ? '' : ' QR'));
  if (!same) agree = false;
  if (!qrOk) qrRule = false;
}
check("every mark agrees with the attendee's own answer, and Admin's preview reads that same answer", agree, seen.join(', '));
check('a QR code only with a certificate the person may download; Admin gets one for every certificate it previews', qrRule, seen.join(', '));
const s2 = await mine(2);
check('the person not there is told why (the words the preview quotes)', /checked in at the venue on the day of the workshop/.test(s2.workshop.reason || ''), s2.workshop);
const s5 = await mine(5);
check('no seat: the conference certificate only (workshop null)', s5.eligible === true && s5.workshop === null, s5);

// ---- Admin only ----
let r = await hit('GET', '/api/admin/workshops');
check('the marks need the admin token', r.status === 401 || r.status === 403, r.status);
r = await hit('GET', '/api/attendees/1/certificate-eligibility', undefined, { Cookie: sessionCookie(SESSION, 2) });
check("an attendee cannot read another person's certificate", r.status === 401 || r.status === 403, r.status);

// ---- one drawing, loaded by both pages ----
const page = async (p) => (await hit('GET', p, undefined, p.startsWith('/admin') ? admin : {})).text;
const appHtml = await page('/app'), adminHtml = await page('/admin');
const appJs = await page('/app.js' + ((appHtml.match(/\/app\.js(\?v=[a-z0-9]+)/) || [])[1] || ''));
const adminJs = await page('/admin.js' + ((adminHtml.match(/\/admin\.js(\?v=[a-z0-9]+)/) || [])[1] || ''));
check('/app and /admin both load /js/cert-render.js', /src="\/js\/cert-render\.js\?v=\w+"/.test(appHtml) && /src="\/js\/cert-render\.js\?v=\w+"/.test(adminHtml), '');
// (The campus-panel certificate, generatePanelCertificate, is a different drawing and stays.)
check('the app draws with BhaiCert and keeps no copy of its own', /BhaiCert\.draw\(/.test(appJs) && !/for taking part in the workshop/.test(appJs) && !/BHAI-WS-/.test(appJs), '');
check('Admin has the sample, the person view and the Workshop Seats marks', /function adminCertSample/.test(adminJs) && /function adminCertFor/.test(adminJs) && /Gets it in the app/.test(adminJs) && /onclick="adminCertFor\(/.test(adminJs) && /Preview certificate/.test(adminJs), '');
const renderer = readFileSync(new URL('../../public/js/cert-render.js', import.meta.url), 'utf8');
const sandbox = { window: {} }; sandbox.window.window = sandbox.window;
vm.runInNewContext(renderer, sandbox);
check('cert-render.js defines BhaiCert.draw and BhaiCert.filename', typeof sandbox.window.BhaiCert?.draw === 'function' && sandbox.window.BhaiCert.filename(true) === 'BharatAI-2026-Workshop-Certificate.png' && sandbox.window.BhaiCert.filename(false) === 'BharatAI-2026-Certificate.png', '');
// 24 Nov 2026, the organiser: every certificate carries the Aegis School of Data Science and AI
// logo and is signed by two people, the facilitator and the Dean.
const BC = sandbox.window.BhaiCert || {};
const fac = BC.facilitator ? BC.facilitator('Dr. Ashish Tendulkar, PhD, IIT Bombay; Google AI') : null;
const kWs = BC.content ? BC.content({ id: 7, workshop: { title: 'T', speaker: 'Dr. Ashish Tendulkar, PhD, IIT Bombay; Google AI', day: '2026-11-20' } }) : {};
const kConf = BC.content ? BC.content({ id: 7, pass: 'VIP Pass' }) : {};
const kPanel = BC.content ? BC.content({ id: 7, panel: { slug: 'djsanghvi-21sep', titleShort: 'AI and Employability', subtitle: 'S' } }) : {};
check('signed by the facilitator (the workshop speaker, name before the first comma) and the Dean', BC.DEAN?.name === 'Dr. Abhijit Gangopadhyay' && BC.DEAN?.role === 'Dean' && BC.DEAN?.org === 'Aegis School of Data Science and AI' && fac?.name === 'Dr. Ashish Tendulkar' && fac?.role === 'Workshop Facilitator' && fac?.org === 'PhD, IIT Bombay · Google AI' && BC.facilitator('') === null && BC.COMMITTEE?.name === 'Organizing Committee' && kWs.left?.name === 'Dr. Ashish Tendulkar' && kConf.left === BC.COMMITTEE && kPanel.left === BC.COMMITTEE && /signBlock\(ctx, X \+ 470, 850, DEAN/.test(renderer), JSON.stringify(fac));
// Design C (24 Nov 2026): one drawing for all three certificates, the Hindi line in
// tricolour under our logo, the Aegis logo, and the QR.
check('one design for the workshop, conference and campus-panel certificates, each with its own number', kWs.certId === 'BHAI-WS-0007' && kWs.when === '20 NOVEMBER 2026' && kConf.certId === 'BHAI-CERT-0007' && kConf.subs.some(s => s[0] === 'Pass: VIP Pass') && kPanel.certId === 'BHAI-CS-DJSANG-00007' && /BhaiCert\.draw\(\{[\s\S]{0,80}panel: \{/.test(appJs) && /verifyUrl: p\.verify/.test(appJs) && !/BhaiCert\.signoff\(/.test(appJs), JSON.stringify([kWs.certId, kConf.certId, kPanel.certId]));
check('the renderer draws the Hindi line, the Aegis logo and the QR with the bundled encoder (never a QR service)', /'भारत', SAFFRON/.test(renderer) && /images\/cert\/aegis\.png/.test(renderer) && /global\.qrcode\(0, 'M'\)/.test(renderer) && !/qrserver/.test(renderer) && /qrcode-generator\.js/.test(appHtml) && /qrcode-generator\.js/.test(adminHtml), '');

// ---- the page the QR opens: /certificate/<code> ----
const own1 = await mine(1), own5 = await mine(5), own4a = (await hit('GET', '/api/attendees/4/certificate-eligibility', undefined, admin)).json;
const open = async (url) => hit('GET', String(url || '').replace('https://bharataiinnovation.com', ''));
let pg = await open(own1.workshop.verify);
check('a workshop QR opens "Genuine certificate" with the name, workshop, facilitator and number from our records', pg.status === 200 && /Genuine certificate/.test(pg.text) && /Person 1/.test(pg.text) && /LLM Fine-Tuning, Hands-On/.test(pg.text) && /Virendra Pal, Workshop Facilitator/.test(pg.text) && /Dr\. Abhijit Gangopadhyay, Dean/.test(pg.text) && /BHAI-WS-0001/.test(pg.text) && /21 November 2026/.test(pg.text), pg.status + ' ' + pg.text.slice(0, 200));
pg = await open(own5.verify);
check('a conference QR opens the person, the pass and BHAI-CERT-', pg.status === 200 && /Person 5/.test(pg.text) && /Pass: VIP Pass/.test(pg.text) && /BHAI-CERT-0005/.test(pg.text), pg.status);
check('the page is never indexed or cached', /noindex/.test(pg.text), '');
const forged = String(own5.verify).replace('/C5.', '/C6.');
pg = await open(forged);
const bitFlip = String(own5.verify).replace(/.$/, (ch) => (ch === '0' ? '1' : '0'));
const pg2 = await open(bitFlip), pg3 = await open('https://bharataiinnovation.com/certificate/C5');
check('a code with another number, a changed signature or none at all is refused', pg.status === 404 && /could not confirm/.test(pg.text) && !/Person 6/.test(pg.text) && pg2.status === 404 && pg3.status === 404, [pg.status, pg2.status, pg3.status].join(','));
pg = await open(own4a.workshop.verify);
check("Admin's code for a locked certificate (sent by hand) still checks out", pg.status === 200 && /Person 4/.test(pg.text) && /IBM Bob/.test(pg.text), pg.status);
pg = await open('https://bharataiinnovation.com/certificate/sample');
check("the sample in Admin's preview opens a page that says it is a sample", pg.status === 200 && /Sample certificate/.test(pg.text) && !/Genuine/.test(pg.text), pg.status);
db.run("INSERT INTO panel_registrations (attendee_id, panel_slug, source, registered_at, claimed_at) VALUES (5, 'djsanghvi-21sep', 'page', '2026-09-10 10:00:00', '2026-09-21 06:50:00'), (3, 'jnu-30sep', 'page', '2026-09-10 10:00:00', NULL)");
const p5 = (await hit('GET', '/api/attendees/5/panels', undefined, { Cookie: sessionCookie(SESSION, 5) })).json || [];
const p3 = (await hit('GET', '/api/attendees/3/panels', undefined, { Cookie: sessionCookie(SESSION, 3) })).json || [];
pg = await open(p5[0]?.verify);
check('a claimed campus panel has a QR (an unclaimed one has none) and it opens the panel and the college', /\/certificate\/P5-djsanghvi-21sep\.[0-9a-f]{16}$/.test(p5[0]?.verify || '') && p3[0] && !('verify' in p3[0]) && pg.status === 200 && /AI and Employability/.test(pg.text) && /Dwarkadas J\. Sanghvi College of Engineering/.test(pg.text) && /BHAI-CS-DJSANG-00005/.test(pg.text) && /21 September 2026/.test(pg.text), JSON.stringify([p5[0]?.verify, p3[0]?.verify, pg.status]));

// ==== Certificates by email and the event style (24 Nov 2026) ====
// The organiser: a participation certificate to everyone who came, another to speakers,
// another to Innovation Stage presenters, in a new style (design C stays for the workshop);
// no photo on record, no certificate: a request for one instead; IDFC FIRST Bank and the
// partners at the foot.
const partnersJson = JSON.parse(readFileSync(new URL('../../src/data/partners.json', import.meta.url), 'utf8'));
check('the event style for participation, speakers and the stage; design C for the workshop and the campus panel',
  BC.styleOf({}) === 'event' && BC.styleOf({ speaker: {} }) === 'event' && BC.styleOf({ stage: {} }) === 'event' && BC.styleOf({ workshop: {} }) === 'C' && BC.styleOf({ panel: {} }) === 'C', '');
check('the partners at the foot are partners.json, in its order, and IDFC FIRST Bank powers it',
  JSON.stringify((BC.PARTNERS || []).map(p => [p.name, p.label, p.logo])) === JSON.stringify(partnersJson.partners.map(p => [p.name, p.label, p.logo])) && BC.POWERED_BY?.logo === partnersJson.powered_by.logo, '');
const kSp = BC.content({ id: 9, speaker: { id: 9, role: 'moderator', session: { title: 'AI for Viksit Bharat', type: 'panel', room: 'Homi J. Bhabha Hall', start: '2026-11-20 11:30' } } });
const kSt = BC.content({ id: 26, stage: { id: 26, topic: 'Reimagining Marketplaces', title: 'Founder', company: 'NoBroker', slot: '2026-11-20 12:30' } });
check('a speaker: appreciation, gold, MODERATOR; a stage talk: appreciation, green, their title and company under the name',
  kSp.eyebrow === 'CERTIFICATE OF APPRECIATION' && kSp.pill === 'MODERATOR' && kSp.certId === 'BHAI-SPK-0009' && kSp.when === '20 NOVEMBER 2026'
  && kSt.eyebrow === 'CERTIFICATE OF APPRECIATION' && kSt.pill === 'INNOVATION STAGE' && kSt.certId === 'BHAI-IT-0026' && kSt.designation === 'Founder, NoBroker', JSON.stringify([kSp.pill, kSt.designation]));
check('the app asks for a photo before every certificate, the workshop one too (25 Nov 2026), and draws each with the photo',
  /Your certificate carries your photo/.test(appJs) && /if \(!myPhoto\) \{/.test(appJs) && /photo: myPhoto,/.test(appJs) && !/photo: ws \? '' : myPhoto/.test(appJs)
  && /verifyUrl: g\.workshop\.verify \|\| '', photo: g\.photo \|\| ''/.test(adminJs), '');

// The people: 3 participants checked in (2 with a photo), 1 not checked in; 2 speakers on a
// published session (one with no photo, one on two sessions), 1 on a draft session; stage talks
// with a time (one by its booth contact), one never given a time.
db.run("UPDATE attendees SET avatar_url = '/api/uploads/p1.jpg', job_title = 'Data Scientist', company = 'TCS' WHERE id = 1");
db.run("UPDATE attendees SET avatar_url = '/api/uploads/p3.jpg' WHERE id = 3");
db.run("INSERT INTO speakers (id, event_id, slug, name, role, organisation, photo_url, email, is_published) VALUES (40, 1, 'asha', 'Dr. Asha Rao', 'CTO', 'Acme', '/images/asha.jpg', 'asha@example.test', 1), (41, 1, 'ravi', 'Ravi Iyer', 'CEO', 'Beta', '', 'ravi@example.test', 1), (42, 1, 'gone', 'Gone Person', 'X', 'Y', '/images/g.jpg', 'gone@example.test', 1)");
db.run("INSERT INTO sessions (id, event_id, title, session_type, room, start_time, end_time) VALUES (124, 1, 'AI for Viksit Bharat', 'panel', 'Homi J. Bhabha Hall', '2026-11-20 11:30', '2026-11-20 12:30'), (145, 1, 'Improving Learning Outcomes with AI', 'panel', 'Kalam Theatre', '2026-11-21 14:00', '2026-11-21 15:00'), (150, 1, 'Never held', 'keynote', 'Raman Theatre', '2026-11-21 10:00', '2026-11-21 10:30')");
db.run("INSERT INTO session_speakers (session_id, speaker_id, role) VALUES (124, 40, 'moderator'), (145, 40, 'panellist'), (124, 41, 'panellist'), (150, 42, 'speaker')");
db.run("INSERT INTO session_admin (session_id, status) VALUES (150, 'draft')");
db.run("INSERT INTO exhibitors (id, event_id, company_name, contact_email) VALUES (7, 1, 'NoBroker', 'booth@nobroker.test')");
db.run("INSERT INTO innovation_talks (id, event_id, speaker_name, company, topic, status, speaker_email, speaker_photo_url, starts_at, exhibitor_id, speaker_title) VALUES (26, 1, 'Akhil Gupta', 'NoBroker', 'Reimagining Marketplaces', 'confirmed', '', '/api/mp/uploads/a.jpg', '2026-11-20 12:30', 7, 'Founder'), (27, 1, 'Meera Shah', 'Shah AI', 'Agents at work', 'confirmed', 'meera@example.test', '/api/mp/uploads/m.jpg', '2026-11-21 11:00', NULL, 'CEO'), (28, 1, 'No Time', 'Later Co', 'Untimed', 'confirmed', 'later@example.test', '/x.jpg', NULL, NULL, '')");
db.run("UPDATE attendees SET checked_in_at = NULL WHERE id = 4");
const certInfo = (await hit('GET', '/api/admin/certificates', undefined, admin)).json || {};
const G = certInfo.groups || {};
check('Admin: who is in each group, with and without a photo, the untimed talk and the booth contact shown',
  G.participants?.total === 6 && G.participants?.with_photo === 2 && G.speakers?.certificates === 3 && G.speakers?.addresses === 2 && G.speakers?.no_photo === 1
  && G.stage?.certificates === 2 && G.stage?.no_time?.length === 1 && G.stage?.rows?.some(r => r.via_booth && r.email === 'booth@nobroker.test')
  && !!certInfo.emails?.speakers?.photo?.html, JSON.stringify({ p: [G.participants?.total, G.participants?.with_photo], s: [G.speakers?.certificates, G.speakers?.addresses, G.speakers?.no_photo], t: [G.stage?.certificates, G.stage?.no_time?.length], e: G.participants?.error || G.speakers?.error || G.stage?.error }));
check('the certificate runs need the admin token', (await hit('GET', '/api/admin/certificates')).status === 401 || (await hit('GET', '/api/admin/certificates')).status === 403, '');

// Run every group, both emails, through the campaign engine, pumping until done.
const runCert = async (kind, ref) => {
  const r = await hit('POST', '/api/admin/campaigns', { kind, ref_id: ref, audience: 'all' }, admin);
  if (!r.json?.id) return { status: r.status, error: r.json?.error, total: 0 };
  for (let i = 0; i < 10; i++) { const p = await hit('POST', '/api/admin/campaigns/' + r.json.id + '/pump', { batch: 25 }, admin); if (p.json?.status === 'done' || p.json?.finished) break; }
  return { status: r.status, total: r.json.total };
};
sent.length = 0;
const pr = await runCert('cert_ready', 1), pp = await runCert('cert_photo', 1);
const byTo = (to) => sent.filter(m => m.to === to);
const m1 = byTo('p1@example.test')[0], m2 = byTo('p2@example.test')[0];
const c1 = (m1?.html.match(/\/certificate\/(C1\.[0-9a-f]{16})\?download=1/) || [])[1];
check('participants: the 2 with a photo get "Your certificate" with their own download link; the rest who came are asked for a photo; never the one who did not come',
  pr.total === 2 && pp.total === 4 && /Your certificate/.test(m1?.subject || '') && !!c1 && /Add your photo/.test(m2?.subject || '') && /action=complete-profile/.test(m2?.html || '') && !byTo('p4@example.test').length,
  JSON.stringify({ pr, pp, subjects: sent.map(m => m.to + ': ' + m.subject) }));
const again = await hit('POST', '/api/admin/campaigns', { kind: 'cert_ready', ref_id: 1, audience: 'all' }, admin);
check('nobody gets the same email twice: a second run finds nobody', again.status === 400, again.status + ' ' + JSON.stringify(again.json));
sent.length = 0;
const sr = await runCert('cert_ready', 2), sp = await runCert('cert_photo', 2);
const asha = byTo('asha@example.test')[0], ravi = byTo('ravi@example.test')[0];
const raviCode = ((ravi?.html || '').match(/\/certificate\/(S41-124\.[0-9a-f]{16})\?download=1/) || [])[1];
check('speakers: one email per person with a link per session; every speaker gets the certificate, the one with no photo too (25 Nov 2026), and no photo request; a draft session gets nothing',
  sr.total === 2 && sp.total === 0 && (asha?.html.match(/\/certificate\/S40-\d+\.[0-9a-f]{16}\?download=1/g) || []).length === 2 && /Moderator: AI for Viksit Bharat/.test(asha?.html || '')
  && /Dear Dr\. Asha/.test(asha?.html || '') && /Thank you for speaking/.test(ravi?.subject || '') && !!raviCode && /certificate of appreciation is ready\./.test(ravi?.html || '')
  && !/with your photo/.test(ravi?.html || '') && !/reply to this email with a clear photo/i.test(ravi?.html || '') && !byTo('gone@example.test').length,
  JSON.stringify({ sr, sp, to: sent.map(m => m.to) }));
const rdp = await hit('GET', '/certificate/' + raviCode + '?download=1');
check("a speaker with no photo: the download page draws the certificate (the seal in the circle), never \"add your photo first\"",
  rdp.status === 200 && /BhaiCert\.draw/.test(rdp.text) && !/Add your photo first/.test(rdp.text) && !/var d = null/.test(rdp.text), rdp.status);
sent.length = 0;
const tr = await runCert('cert_ready', 3);
check('stage: a talk with a time, to the speaker or else the booth contact; the talk never given a time gets nothing',
  tr.total === 2 && byTo('booth@nobroker.test').length === 1 && byTo('meera@example.test').length === 1 && !byTo('later@example.test').length, JSON.stringify({ tr, to: sent.map(m => m.to) }));

// The page the email opens, and the check page the QR opens.
let dp = await hit('GET', '/certificate/' + c1 + '?download=1');
check('the download page draws their certificate with their photo and designation, and carries no email address',
  dp.status === 200 && /BhaiCert\.draw/.test(dp.text) && /p1\.jpg/.test(dp.text) && /Data Scientist, TCS/.test(dp.text) && /linkedin\.com\/profile\/add/.test(dp.text) && !/@example\.test/.test(dp.text), dp.status);
const c2 = await (async () => { const g = (await hit('GET', '/api/attendees/2/certificate-eligibility', undefined, admin)).json; return String(g?.verify || '').split('/certificate/')[1]; })();
dp = await hit('GET', '/certificate/' + c2 + '?download=1');
check('no photo on record: the page asks for one and draws nothing', dp.status === 200 && /Add your photo first/.test(dp.text) && /var d = null/.test(dp.text), dp.status);
const sCode = (asha.html.match(/\/certificate\/(S40-124\.[0-9a-f]{16})/) || [])[1];
pg = await hit('GET', '/certificate/' + sCode);
check('a speaker QR opens "Genuine certificate" with the role, the session, the hall and no signatures',
  pg.status === 200 && /Genuine certificate/.test(pg.text) && /Dr\. Asha Rao/.test(pg.text) && /spoke as Moderator/.test(pg.text) && /Homi J\. Bhabha Hall/.test(pg.text) && /BHAI-SPK-0040/.test(pg.text) && /Issued by/.test(pg.text), pg.status);
pg = await hit('GET', '/certificate/' + String(sCode).replace('S40-124', 'S41-124'));
check('a speaker code with another person in it is refused', pg.status === 404, pg.status);
pg = await hit('GET', '/certificate/' + c1);
check('the participation QR page says it is issued by the event, with no signatures', pg.status === 200 && /Issued by/.test(pg.text) && !/Signed by/.test(pg.text), pg.status);
const sv = await hit('POST', '/api/certificates/' + c1 + '/saved');
check('a save from the download page is counted', sv.status === 204 && rows("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'certificate.saved'", [])[0].n === 1, sv.status);

// Volunteers (24 Nov 2026: "Pillai students who volunteered, we need to make their certificate
// with photo"). Organiser passes: 50 and 51 Pillai students checked in (50 with a photo), 52 a
// Pillai student never scanned in, 53 a team member (title, photo), 54 blank title and company
// on a gmail address, checked in, no photo.
const orgIns = (id, email, inAt, photo, title) => db.run("INSERT INTO attendees (id, event_id, name, email, badge_type, payment_status, main_event, checked_in_at, avatar_url, job_title, company) VALUES (?, 1, ?, ?, 'Organiser', 'waived', 1, ?, ?, ?, ?)",
  [id, 'Vol ' + id, email, inAt, photo, title, title ? 'Bharat AI Innovation' : '']);
orgIns(50, 'v50@student.pillai.edu.in', '2026-11-20 03:00:00', '/api/uploads/v50.jpg', '');
orgIns(51, 'v51@student.pillai.edu.in', '2026-11-20 03:00:00', '', '');
orgIns(52, 'v52@student.pillai.edu.in', null, '/api/uploads/v52.jpg', '');
orgIns(53, 'team53@example.test', '2026-11-20 03:00:00', '/api/uploads/t53.jpg', 'Innovation Evangelist');
orgIns(54, 'v54@gmail.example', '2026-11-20 03:00:00', '', '');
orgIns(55, 'v55@student.pillai.edu.in', null, '', '');
let VG = ((await hit('GET', '/api/admin/certificates', undefined, admin)).json || {}).groups || {};
const volIds = (VG.volunteers?.rows || []).map(r => r.id).join(',');
check('volunteers to start with: Organiser passes checked in with a Pillai student address or no title and company; never the team, never one not scanned in',
  volIds === '50,51,54' && VG.volunteers?.with_photo === 1 && VG.volunteers?.saved === false && (VG.volunteers?.choices || []).length === 6
  && VG.volunteers.choices.find(p => p.id === 52)?.on === false && VG.volunteers.choices.find(p => p.id === 53)?.on === false
  && VG.volunteers.rows.find(r => r.id === 50)?.designation === 'Student, Pillai University' && VG.volunteers.rows.find(r => r.id === 54)?.designation === '',
  JSON.stringify({ volIds, v: VG.volunteers }));
check('never scanned in: waiting for a face check, not a volunteer yet (52 with a photo, 55 without)', (VG.volunteers?.checking || []).map(x => x.id).join(',') === '52,55' && VG.volunteers.choices.find(p => p.id === 55)?.checking === true && !!certInfo.emails?.volunteers?.photo, JSON.stringify(VG.volunteers?.checking));
const partIds = (VG.participants?.rows || []).map(r => r.id);
check('a volunteer is not a participant as well; the team member is', partIds.includes(53) && ![50, 51, 54].some(n => partIds.includes(n)), partIds.join(','));
const kVol = BC.content({ id: 50, volunteer: { designation: 'Student, Pillai University' } });
check('the volunteer certificate: appreciation, VOLUNTEER, blue, its own number, the college under the name',
  kVol.kind === 'volunteer' && kVol.eyebrow === 'CERTIFICATE OF APPRECIATION' && kVol.pill === 'VOLUNTEER' && kVol.ring === '#4C7FE8' && kVol.certId === 'BHAI-VOL-0050'
  && kVol.designation === 'Student, Pillai University' && /volunteering/.test(kVol.lead) && BC.styleOf({ volunteer: {} }) === 'event'
  && BC.filename(false, true) === 'BharatAI-2026-Volunteer-Certificate.png' && BC.filename(false) === 'BharatAI-2026-Certificate.png', JSON.stringify(kVol));
check('the background: charcoal for the volunteer only, midnight blue for participation, speakers and the stage', kVol.bg?.[0] === '#2B2D33' && kConf.bg?.[0] === '#18235A' && kSp.bg?.[0] === '#18235A' && kSt.bg?.[0] === '#18235A', JSON.stringify([kVol.bg, kConf.bg]));
const e50 = await mine(50);
check("the volunteer's own answer: eligible, the volunteer certificate, the college", e50.eligible === true && e50.volunteer?.designation === 'Student, Pillai University' && e50.designation === 'Student, Pillai University' && /\/certificate\/C50\./.test(e50.verify || ''), e50);
check('the app and Admin draw the volunteer certificate for a volunteer', /volunteer: vol,/.test(appJs) && /BhaiCert\.filename\(!!ws, !!vol\)/.test(appJs) && /volunteer: g\.volunteer \|\| null/.test(adminJs), '');
sent.length = 0;
const vr = await runCert('cert_ready', 4), vp = await runCert('cert_photo', 4), pr2 = await runCert('cert_ready', 1);
const v50 = byTo('v50@student.pillai.edu.in')[0], v51 = byTo('v51@student.pillai.edu.in')[0];
const c50 = (v50?.html.match(/\/certificate\/(C50\.[0-9a-f]{16})\?download=1/) || [])[1];
check('volunteers: the one with a photo gets "Thank you for volunteering"; the two without are asked to add one in the app; the participation run takes only the team member',
  vr.total === 1 && vp.total === 3 && /Thank you for volunteering/.test(v50?.subject || '') && !!c50 && /volunteer certificate is ready: add your photo/.test(v51?.subject || '') && /action=complete-profile/.test(v51?.html || '')
  && byTo('v54@gmail.example').length === 1 && pr2.total === 1 && byTo('team53@example.test').length === 1 && !byTo('v52@student.pillai.edu.in').length,
  JSON.stringify({ vr, vp, pr2, subjects: sent.map(m => m.to + ': ' + m.subject) }));
const v55 = byTo('v55@student.pillai.edu.in')[0], e55 = await mine(55);
check('the face-check email asks for a photo, says we will match it with the event photos, and carries no certificate link; the app says the same',
  /Add your photo for your Bharat AI Innovation 2026 volunteer certificate/.test(v55?.subject || '') && /match your photo with the photos taken at the event/.test(v55?.html || '') && !(v55?.html || '').includes('/certificate/') && /action=complete-profile/.test(v55?.html || '')
  && e55.eligible === false && /match it with the photos taken at the event/.test(e55.reason || '') && !e55.volunteer, JSON.stringify({ s: v55?.subject, e55 }));
dp = await hit('GET', '/certificate/' + c50 + '?download=1');
check('the volunteer download page draws the volunteer certificate with the photo', dp.status === 200 && /"volunteer":\{"designation":"Student, Pillai University"\}/.test(dp.text) && /v50\.jpg/.test(dp.text) && /BharatAI-2026-Volunteer-Certificate\.png/.test(dp.text), dp.status);
pg = await hit('GET', '/certificate/' + c50);
check('the volunteer QR page: appreciation, volunteered at, the college, BHAI-VOL-', pg.status === 200 && /issued this certificate of appreciation to/.test(pg.text) && /volunteered at/.test(pg.text) && /Student, Pillai University/.test(pg.text) && /BHAI-VOL-0050/.test(pg.text), pg.status);
r = await hit('POST', '/api/admin/certificates/volunteers', { ids: [50, 52] });
check('saving the volunteers list needs the admin token', r.status === 401 || r.status === 403, r.status);
r = await hit('POST', '/api/admin/certificates/volunteers', { ids: [50, 52, 99999, 'x'] }, admin);
VG = ((await hit('GET', '/api/admin/certificates', undefined, admin)).json || {}).groups || {};
const e52 = await mine(52);
check('a saved list wins: unknown ids dropped, a ticked volunteer never scanned in still gets theirs, an unticked one goes back to participants, and it is audited',
  r.json?.count === 2 && r.json?.checking === 1 && (VG.volunteers?.checking || []).map(x => x.id).join(',') === '55' && VG.volunteers?.saved === true && (VG.volunteers?.rows || []).map(x => x.id).join(',') === '50,52' && VG.volunteers?.not_checked_in === 1
  && e52.eligible === true && !!e52.volunteer && (VG.participants?.rows || []).some(x => x.id === 51)
  && rows("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'certificates.volunteers'", [])[0].n === 1, JSON.stringify({ r: r.json, v: VG.volunteers?.rows?.map(x => x.id), e52 }));
const desk = readFileSync(new URL('../../public/js/admin-certs.js', import.meta.url), 'utf8');
check("Admin's certificates card has the volunteers, their tick list and its Save", /key: 'volunteers', ref: 4/.test(desk) && /data-act="vol-save"/.test(desk) && /\/api\/admin\/certificates\/volunteers/.test(desk), '');

console.log(fails ? `\n${fails} FAILED` : '\nAll certificate preview checks passed');
process.exit(fails ? 1 : 0);
