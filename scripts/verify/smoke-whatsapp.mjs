// Built-worker checks for WhatsApp (23 Nov 2026, src/routes/whatsapp.ts, migration 0065) on
// the talks world (real SQLite, the production schema). Meta is played here: every call to
// graph.facebook.com is answered and kept, so what we would send Meta is read back exactly.
// Covers: before the migration; the values from Meta never coming back out; the webhook
// handshake and signature; messages sent for approval (words, picture upload, button);
// who a photos, pass or announcement send reaches and who is left out and why; the queue
// (hours, a minute's number, the day's number, never twice); delivered, read and failed;
// replies, the 24 hours, STOP and START; the button link; a send pausing itself.
// Run after `npm run build`:  node scripts/verify/smoke-whatsapp.mjs
import { createHmac } from 'node:crypto';
import { talksWorld, checker, ADMIN } from './talks-world.mjs';

const { check, done } = checker();
const W = await talksWorld({ seedTalks: false });
const { db, rows, hit, env, read } = W;
const SITE = 'https://bharataiinnovation.com';
const PHONE = '106540352242922', WABA = '102290129340398', APP = '777000111222';
const SECRET = '0123456789abcdef0123456789abcdef', TOKEN = 'EAAG' + 'x9Zq'.repeat(40);

// Every admin answer is kept, to prove at the end that no value from Meta came back out.
const answers = [];
const as = async (method, path, body) => { const r = await W.as(method, path, body); answers.push(r.text); return r; };

// ---------- Meta, played ----------
const calls = [];
let failWith = null;          // { code, message, times } for the next sends
let templatesAtMeta = [];
let wam = 0;
let subsData = [];            // the apps Meta says are subscribed to the account
let numberStatus = 'PENDING'; // the number's status until it is registered
let loseRegister = false;     // Meta registers the number but its answer never arrives
const worldFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url && url.url ? url.url : url);
  if (!u.startsWith('https://graph.facebook.com/')) return worldFetch(url, init);
  const call = { url: u, path: u.replace(/^https:\/\/graph\.facebook\.com\/v\d+\.\d\//, ''), method: init.method || 'GET', headers: init.headers || {},
    body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body };
  calls.push(call);
  const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  if (call.path === `${PHONE}/messages`) {
    if (failWith && failWith.times > 0) { failWith.times--; return json({ error: { message: `(#${failWith.code}) ${failWith.message}`, type: 'OAuthException', code: failWith.code, error_data: { messaging_product: 'whatsapp', details: failWith.message } } }, 400); }
    return json({ messaging_product: 'whatsapp', contacts: [{ input: call.body.to, wa_id: call.body.to }], messages: [{ id: 'wamid.T' + (++wam) }] });
  }
  if (call.path.startsWith(`${PHONE}?fields=display_phone_number`)) return json({ display_phone_number: '+91 22 5555 0100', verified_name: 'Bharat AI Innovation', quality_rating: 'GREEN', code_verification_status: 'VERIFIED', id: PHONE });
  if (call.path.startsWith(`${PHONE}?fields=whatsapp_business_manager`)) return json({ whatsapp_business_manager_messaging_limit: 'TIER_2K', status: 'CONNECTED', id: PHONE });
  if (call.path === `${WABA}/subscribed_apps`) return json(call.method === 'GET' ? { data: subsData } : { success: true });
  if (call.path.startsWith(`${PHONE}?fields=status`)) return json({ status: numberStatus, id: PHONE });
  if (call.path === `${PHONE}/register`) {
    if (call.body?.pin === '999999') return json({ error: { message: '(#133016) Too many registration attempts', code: 133016 } }, 400);
    numberStatus = 'CONNECTED';
    if (loseRegister) throw new Error('socket hang up');
    return json({ success: true });
  }
  if (call.path.startsWith(`${WABA}/message_templates`)) {
    if (call.method === 'GET') return json({ data: templatesAtMeta });
    if (call.method === 'DELETE') return json({ success: true });
    return json({ id: 'T' + calls.length, status: 'PENDING', category: call.body.category });
  }
  if (call.path.startsWith('debug_token')) return json({ data: { app_id: APP } });
  if (call.path.startsWith(`${APP}/uploads`)) return json({ id: 'upload:SESSION1' });
  if (call.path === 'upload:SESSION1') return json({ h: '4::HANDLE' });
  return json({ error: { message: 'unexpected call in this test: ' + call.path, code: 1 } }, 400);
};
const sends = () => calls.filter(c => c.path === `${PHONE}/messages`);
const tick = async () => (await as('POST', '/api/admin/whatsapp/tick', {})).json?.tick;
const hooked = async (payload, secret = SECRET, sigOverride) => {
  const raw = JSON.stringify(payload);
  const sig = sigOverride ?? 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
  const res = await W.fetchRaw(new Request(SITE + '/api/whatsapp/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig }, body: raw }));
  return { status: res.status, text: await res.text() };
};
const envelope = (value, field = 'messages') => ({ object: 'whatsapp_business_account', entry: [{ id: WABA, changes: [{ value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '912255550100', phone_number_id: PHONE }, ...value }, field }] }] });
const now = () => String(Math.floor(Date.now() / 1000));
const get = (path, headers = {}) => W.fetchRaw(new Request(SITE + path, { redirect: 'manual', headers }));

// ---------- the people ----------
db.exec(read('migrations/0051_leads_and_daily_checkins.sql'));
db.exec(read('migrations/0064_event_photos.sql'));
const ATT = JSON.parse(read('src/data/attendee-photos.json'));
const keys = Object.keys(ATT.albums).slice(0, 7);
const idOf = (k) => Number(k.slice(1));
const person = (id, name, mobile, extra = {}) => {
  const row = { id, event_id: 1, name, email: `p${id}@example.com`, mobile, badge_type: 'Visitor Pass', payment_status: 'paid', ...extra };
  const cols = Object.keys(row);
  db.run(`INSERT INTO attendees (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map(k => row[k]));
};
person(idOf(keys[0]), 'Dr. Asha Mehta', '98765 43210');
person(idOf(keys[1]), 'Ravi Kumar', '+91 98111 22233');
person(idOf(keys[2]), 'No Mobile', '');
person(idOf(keys[3]), 'Bad Number', '12345');
person(idOf(keys[4]), 'Left The List', '98222 00004', { unsubscribed_at: '2026-11-22 10:00:00' });
person(idOf(keys[5]), 'No Matching', '98222 00005');
person(idOf(keys[6]), 'Sunita Rao', '98222 00006');
db.run("INSERT INTO admin_audit (actor, actor_kind, action, entity, entity_id, detail) VALUES (?, 'attendee', 'photos.opt_out', 'photo_album', ?, '{}')", [keys[5], keys[5]]);
// Their pictures in the store (one each is enough for a message).
keys.forEach((k, i) => {
  const al = ATT.albums[k];
  const d = [...(al.best || []), ...(al.photos || [])][0];
  db.run('INSERT OR IGNORE INTO event_photos (event_id, pid, drive_id, title, day) VALUES (1, ?, ?, ?, ?)', [('W' + String(i).padStart(2, '0') + 'abcdefghi').slice(0, 12), d, 'IMG' + i + '.JPG', '2026-11-20']);
});
person(990001, 'Neha Shah', '90000 00001', { badge_type: 'Delegate Pass', checked_in_at: '2026-11-20 05:00:00' });
person(990002, 'Arun Rao', '90000 00002');
person(990003, 'Pending Paid', '90000 00003', { badge_type: 'VIP Pass', payment_status: 'pending' });
person(990004, 'Guest Of Team', '90000 00004', { email: 'wa919000000004@no-email.invalid', registration_source: 'team:5' });
person(990005, 'Said No', '90000 00005', { marketing_consent: 0 });
person(990006, 'Same Phone', '9000000001', { badge_type: 'Delegate Pass', payment_status: 'pending' });
db.run("INSERT INTO checkins (event_id, attendee_id, day) VALUES (1, 990002, '2026-11-21')");
const nPhotos = (k) => { const n = ATT.albums[k].photos.length; return n === 1 ? '1 photo' : n + ' photos'; };
const msgs = (where = '1 = 1', args = []) => rows('SELECT * FROM wa_messages WHERE ' + where + ' ORDER BY id', args);

// ---------- before the migration ----------
let r = await as('GET', '/api/admin/whatsapp');
check('before migration 0065: the screen says so and shows the command', r.status === 200 && r.json?.ready === false && /0065_whatsapp\.sql/.test(r.json?.command || ''), r.text.slice(0, 200));
r = await as('POST', '/api/admin/whatsapp/send', { kind: 'photos', expect: 1 });
check('before the migration nothing can be sent', r.status === 409 && r.json?.ready === false, r.status);
r = await hit('POST', '/api/cron/tick', {}, { Authorization: 'Bearer ' + ADMIN });
check('the minute clock is safe without the tables', r.status === 200 && r.json?.whatsapp?.ready === false, JSON.stringify(r.json?.whatsapp));
check('without admin every screen route is refused', (await hit('GET', '/api/admin/whatsapp')).status === 401 && (await hit('POST', '/api/admin/whatsapp/send', {})).status === 401 && (await hit('POST', '/api/admin/whatsapp/config', { token: TOKEN })).status === 401, '');

db.exec(read('migrations/0065_whatsapp.sql'));
db.exec(read('migrations/0065_whatsapp.sql'));
r = await as('GET', '/api/admin/whatsapp');
const verify = r.json?.verify_token || '';
check('after the migration (run twice): ready, not connected, nothing saved', r.json?.ready === true && r.json?.connected === false && Object.values(r.json?.config || { x: 1 }).every(v => v === false)
  && r.json?.webhook_url === SITE + '/api/whatsapp/webhook' && /^bhai[0-9a-f]{24}$/.test(verify), JSON.stringify(r.json?.config));

// ---------- the webhook's handshake ----------
let g = await get('/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=' + verify + '&hub.challenge=11223344');
check('Meta’s first call: the right token gets the challenge back', g.status === 200 && (await g.text()) === '11223344', g.status);
g = await get('/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=guess&hub.challenge=11223344');
check('a wrong token is refused', g.status === 403, g.status);
check('until the app secret is saved, nothing Meta says is believed', (await hooked(envelope({ statuses: [] }))).status === 503, '');

// ---------- not connected yet ----------
r = await as('POST', '/api/admin/whatsapp/audience', { kind: 'photos' });
check('who gets the photos can be counted before Meta is connected', r.status === 200 && r.json?.count === 3 && r.json?.status === 'draft', JSON.stringify(r.json).slice(0, 300));
r = await as('POST', '/api/admin/whatsapp/send', { kind: 'photos', expect: 3 });
check('sending is refused, in plain words, until connected', r.status === 409 && /not connected/i.test(r.json?.error || ''), r.json?.error);
r = await as('GET', '/api/admin/whatsapp/own');
const ownRow = (r.json?.rows || []).find(x => x.attendee_id === idOf(keys[0]));
const ownText = decodeURIComponent((ownRow?.wa_url || '').split('?text=')[1] || '');
check('one by one from my own WhatsApp works today: the number, the words and their own album link', r.status === 200 && r.json.rows.length === 3 && ownRow.wa_url.startsWith('https://wa.me/919876543210?text=')
  && ownRow.web_url.startsWith('https://web.whatsapp.com/send?phone=919876543210') && ownText.startsWith('Hello Dr. Asha, we found ' + nPhotos(keys[0]))
  && new RegExp('/photos/' + keys[0] + '\\?k=[0-9a-f]{32}').test(ownText) && !/button/i.test(ownText), ownText);
r = await as('POST', '/api/admin/whatsapp/own/mark', { attendee_id: idOf(keys[0]) });
let again = await as('POST', '/api/admin/whatsapp/audience', { kind: 'photos' });
check('a tap marks them sent, and a later send leaves them out', r.json?.sent === true && again.json?.count === 2 && again.json.skipped.some(s => s.why === 'already' && s.n === 1), JSON.stringify(again.json?.skipped));
await as('POST', '/api/admin/whatsapp/own/mark', { attendee_id: idOf(keys[0]), undo: true });
check('Undo takes the mark off', (await as('POST', '/api/admin/whatsapp/audience', { kind: 'photos' })).json?.count === 3, '');

// ---------- the five values ----------
r = await as('POST', '/api/admin/whatsapp/config', { phone_id: '+91 98765 43210' });
check('a phone number typed where the Phone number ID goes is caught', r.status === 400 && r.json?.field === 'phone_id', r.json?.error);
r = await as('POST', '/api/admin/whatsapp/config', { token: TOKEN, phone_id: PHONE, waba_id: WABA, app_secret: SECRET });
check('saved: connected, each value shown only as there or not', r.status === 200 && r.json?.connected === true && r.json.config.token && r.json.config.app_secret && r.json.config.app_id === false && r.json.config_from.token === 'saved', JSON.stringify(r.json?.config));
r = await as('GET', '/api/admin/settings');
check('Settings masks the key and the secret', r.status === 200 && !r.text.includes(TOKEN) && !r.text.includes(SECRET) && r.json?.whatsapp_phone_id === PHONE, '');
r = await as('POST', '/api/admin/whatsapp/check', {});
const sub = calls.find(c => c.path === `${WABA}/subscribed_apps` && c.method === 'POST');
check('check the connection: our number, its health, people a day from Meta, and delivery reports switched on', r.status === 200 && r.json?.check?.number === '+91 22 5555 0100' && r.json.check.quality === 'GREEN'
  && r.json.check.daily_limit === 2000 && r.json.settings.daily_limit === 2000 && r.json.check.webhook === 'subscribed' && !!sub && calls.every(c => c.headers.Authorization === 'Bearer ' + TOKEN), JSON.stringify(r.json?.check));

// ---------- messages for approval ----------
r = await as('GET', '/api/admin/whatsapp/templates');
check('six built-in messages (photos, pass and the four automatic ones), not yet with WhatsApp', r.json?.templates?.length === 6 && r.json.templates.every(t => t.builtin && t.status === 'draft')
  && r.json.templates.filter(t => t.kind === 'auto').length === 4 && r.json.templates.filter(t => t.kind === 'auto').every(t => t.category === 'UTILITY'), JSON.stringify(r.json?.templates?.map(t => [t.name, t.kind])));
r = await as('POST', '/api/admin/whatsapp/templates/bhai_event_pass_v1/submit', {});
let made = calls.filter(c => c.path === `${WABA}/message_templates` && c.method === 'POST').pop()?.body;
const comp = (m, type) => (m?.components || []).find(x => x.type === type);
check('the pass message as Meta gets it: service, three blanks with samples, the stop line, a button to /w/', r.status === 200 && r.json?.status === 'PENDING' && made.name === 'bhai_event_pass_v1' && made.category === 'UTILITY' && made.language === 'en'
  && (comp(made, 'BODY').text.match(/\{\{\d\}\}/g) || []).length === 3 && comp(made, 'BODY').example.body_text[0].length === 3 && !/^\{\{|\}\}$/.test(comp(made, 'BODY').text)
  && comp(made, 'FOOTER').text.length <= 60 && comp(made, 'BUTTONS').buttons[0].url === SITE + '/w/{{1}}' && comp(made, 'BUTTONS').buttons[0].text.length <= 25 && !comp(made, 'HEADER'), JSON.stringify(made));
check('it cannot be sent to Meta twice', (await as('POST', '/api/admin/whatsapp/templates/bhai_event_pass_v1/submit', {})).status === 409, '');
r = await as('POST', '/api/admin/whatsapp/templates/bhai_event_photos_v1/submit', {});
made = calls.filter(c => c.path === `${WABA}/message_templates` && c.method === 'POST').pop()?.body;
const up1 = calls.find(c => c.path.startsWith(`${APP}/uploads?`)), up2 = calls.find(c => c.path === 'upload:SESSION1');
check('the photos message: its sample picture is uploaded to Meta first (the App ID found by itself)', r.status === 200 && /file_length=\d+&file_type=image%2Fjpeg/.test(up1?.path || '') && up2?.headers.Authorization === 'OAuth ' + TOKEN && up2.headers.file_offset === '0'
  && comp(made, 'HEADER').format === 'IMAGE' && comp(made, 'HEADER').example.header_handle[0] === '4::HANDLE' && comp(made, 'BODY').example.body_text[0].length === 2, JSON.stringify(made).slice(0, 300));
r = await as('POST', '/api/admin/whatsapp/send', { kind: 'photos', expect: 3 });
check('a message still waiting for approval cannot be sent', r.status === 409 && /not approved/i.test(r.json?.error || ''), r.json?.error);
templatesAtMeta = [{ name: 'bhai_event_pass_v1', status: 'APPROVED', category: 'UTILITY', language: 'en', id: '1' }, { name: 'bhai_event_photos_v1', status: 'APPROVED', category: 'MARKETING', language: 'en', id: '2' },
  { name: 'someone_elses', status: 'APPROVED', category: 'MARKETING', language: 'en', id: '3' }];
r = await as('GET', '/api/admin/whatsapp/templates?refresh=1');
const photosTpl = r.json?.templates.find(t => t.name === 'bhai_event_photos_v1');
check('ask WhatsApp: both approved, and the kind Meta chose is shown (it made photos a marketing message)', r.json?.templates.length === 6 && r.json.templates.filter(t => t.status === 'APPROVED').map(t => t.name).sort().join() === 'bhai_event_pass_v1,bhai_event_photos_v1'
  && photosTpl.meta_category === 'MARKETING', JSON.stringify(r.json?.templates.map(t => [t.name, t.status, t.meta_category])));

// A picture or announcement the team writes.
const store = new Map();
env.UPLOADS = { async put(key, bytes, o) { store.set(key, { bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), type: o?.httpMetadata?.contentType }); },
  async get(key) { const b = store.get(key); return b ? { arrayBuffer: async () => b.bytes.buffer, httpMetadata: { contentType: b.type }, body: new Response(b.bytes).body, httpEtag: '"e"', writeHttpMetadata() {} } : null; } };
const JPG = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString('base64');
const good = { title: 'Delhi 2027 dates', body: 'Thank you for being part of Bharat AI Innovation 2026.\n\n\n\nThe next edition is in Delhi on 28 and 29 July 2027.', image: JPG, button_text: 'See Delhi 2027', button_url: SITE + '/delhi' };
const bad = [[{ ...good, body: 'Short' }, 'body'], [{ ...good, body: good.body + ' {{2}}' }, 'body'], [{ ...good, button_url: '' }, 'button_url'], [{ ...good, button_url: 'http://example.com' }, 'button_url'],
  [{ ...good, title: 'x' }, 'title'], [{ ...good, image: 'data:image/svg+xml;base64,AAAA' }, 'image']];
let refusals = 0;
for (const [b, field] of bad) { r = await as('POST', '/api/admin/whatsapp/templates', b); if (r.status === 400 && r.json?.field === field) refusals++; }
check('an announcement is refused with the box named: too short, curly brackets, half a button, an http link, no name, an SVG', refusals === bad.length, refusals);
r = await as('POST', '/api/admin/whatsapp/templates', good);
const custom = r.json?.name || '';
const mine = r.json?.templates?.find(t => t.name === custom);
check('saved as a draft: a name Meta accepts, "Hello <name>," first, extra blank lines closed up, the picture in our store', r.status === 200 && /^bhai_c_delhi_2027_dates_[0-9a-f]{4}$/.test(custom) && mine.status === 'draft'
  && mine.text.startsWith('Hello {{1}},\n\nThank you') && !/\n{3}/.test(mine.text) && /^\/api\/uploads\/whatsapp\/[0-9a-f]{20}\.jpg$/.test(mine.image_url) && store.size === 1 && mine.category === 'MARKETING', JSON.stringify(mine));
r = await as('POST', `/api/admin/whatsapp/templates/${custom}/submit`, {});
made = calls.filter(c => c.path === `${WABA}/message_templates` && c.method === 'POST').pop()?.body;
check('sent for approval: marketing, the name as the one blank, never a blank first or last', r.status === 200 && made.category === 'MARKETING' && comp(made, 'BODY').example.body_text[0].length === 1 && !/^\{\{|\}\}$/.test(comp(made, 'BODY').text) && !!comp(made, 'HEADER'), JSON.stringify(made).slice(0, 200));
check('a built-in message cannot be deleted', (await as('DELETE', '/api/admin/whatsapp/templates/bhai_event_pass_v1')).status === 409, '');

// ---------- the webhook, signed ----------
check('a call with a wrong signature is refused', (await hooked(envelope({ statuses: [] }), 'not-the-secret')).status === 401 && (await hooked(envelope({ statuses: [] }), SECRET, '')).status === 401, '');
r = await hooked(envelope({ event: 'APPROVED', message_template_name: custom, message_template_id: 9, reason: 'NONE' }, 'message_template_status_update'));
check('Meta approving a message reaches us by itself', r.status === 200 && rows('SELECT status FROM wa_templates WHERE name = ?', [custom])[0].status === 'APPROVED', r.text);

// ---------- the photos send ----------
r = await as('POST', '/api/admin/whatsapp/audience', { kind: 'photos' });
const why = Object.fromEntries((r.json?.skipped || []).map(s => [s.why, s.n]));
check('who gets the photos: three, and each person left out is counted with the reason', r.json?.count === 3 && why.no_mobile === 1 && why.bad_number === 1 && why.unsubscribed === 1 && why.photo_no === 1 && r.json.status === 'APPROVED', JSON.stringify(r.json?.skipped));
check('how it reads: their title kept, their own number of photos, their own picture, masked numbers in the list', r.json.preview.text.startsWith('Hello Dr. Asha, we found ' + nPhotos(keys[0]) + ' of you')
  && new RegExp('/photo/[A-Za-z0-9_-]{12}/m\\.jpg\\?u=' + keys[0] + '&e=\\d+&k=').test(r.json.preview.image) && r.json.preview.button === 'See my photos' && r.json.sample.every(p => /•/.test(p.number) && !/43210 ?$/.test(p.number.replace(/•/g, '')) === true), JSON.stringify(r.json.preview) + JSON.stringify(r.json.sample));
r = await as('POST', '/api/admin/whatsapp/send', { kind: 'photos', expect: 5 });
check('a list that changed since the screen counted it is not sent', r.status === 409 && r.json?.changed === true && r.json.count === 3 && msgs().length === 0, r.text);
r = await as('POST', '/api/admin/whatsapp/send', { kind: 'photos', expect: 3 });
const batch1 = r.json?.batch;
check('the send: one waiting row each, nothing at Meta yet', r.status === 200 && r.json.count === 3 && msgs("status = 'queued'").length === 3 && sends().length === 0, r.text);

const h = new Date(Date.now() + 5.5 * 3600000).getUTCHours();
await as('POST', '/api/admin/whatsapp/settings', h < 12 ? { hours_from: 13, hours_to: 24 } : { hours_from: 0, hours_to: 12 });
let t = await tick();
check('outside the hours a bulk send waits', t?.sent === 0 && t.outside_hours === true && sends().length === 0, JSON.stringify(t));
await as('POST', '/api/admin/whatsapp/settings', { hours_from: 0, hours_to: 24, daily_limit: 1 });
db.run("INSERT INTO wa_messages (direction, kind, wa_number, template, status, sent_at) VALUES ('out', 'custom', '919333300001', 'x', 'sent', datetime('now'))");
t = await tick();
check('past the day’s number of people, the rest are held for tomorrow', t?.sent === 0 && t.held_for_tomorrow === 3 && sends().length === 0, JSON.stringify(t));
db.run("DELETE FROM wa_messages WHERE wa_number = '919333300001'");
await as('POST', '/api/admin/whatsapp/settings', { daily_limit: 2000 });
t = await tick();
const first = sends()[0]?.body, row1 = msgs('attendee_id = ?', [idOf(keys[0])])[0];
const parts = Object.fromEntries((first?.template?.components || []).map(x => [x.type, x]));
check('inside the hours all three go; each is the approved message with that person’s picture, words and own button', t?.sent === 3 && sends().length === 3 && first.to === '919876543210' && first.type === 'template' && first.template.name === 'bhai_event_photos_v1'
  && first.template.language.code === 'en' && /\/m\.jpg\?u=/.test(parts.header.parameters[0].image.link) && parts.body.parameters.map(p => p.text).join('|') === 'Dr. Asha|' + nPhotos(keys[0])
  && parts.button.sub_type === 'url' && parts.button.index === '0' && new RegExp('^' + row1.id + '-[0-9a-f]{12}$').test(parts.button.parameters[0].text), JSON.stringify(first));
check('each row is marked sent with Meta’s id, and the send is finished', msgs("status = 'sent' AND wamid LIKE 'wamid.T%'").length === 3 && rows('SELECT status FROM wa_batches WHERE id = ?', [batch1])[0].status === 'done', '');
await tick();
check('a second clock tick sends nobody twice', sends().length === 3, sends().length);
r = await as('POST', '/api/admin/whatsapp/audience', { kind: 'photos' });
check('asked again, the same people are left out as already sent', r.json?.count === 0 && r.json.skipped.some(s => s.why === 'already' && s.n === 3), JSON.stringify(r.json?.skipped));

// ---------- delivered, read, failed ----------
const [m1, m2, m3] = msgs('batch_id = ?', [batch1]);
await hooked(envelope({ statuses: [{ id: m1.wamid, status: 'delivered', timestamp: now(), recipient_id: m1.wa_number, pricing: { billable: true, pricing_model: 'PMP', type: 'regular', category: 'marketing' } }] }));
await hooked(envelope({ statuses: [{ id: m1.wamid, status: 'read', timestamp: now(), recipient_id: m1.wa_number }] }));
await hooked(envelope({ statuses: [{ id: m1.wamid, status: 'delivered', timestamp: now(), recipient_id: m1.wa_number }] }));
await hooked(envelope({ statuses: [{ id: m2.wamid, status: 'failed', timestamp: now(), recipient_id: m2.wa_number, errors: [{ code: 131026, title: 'Message undeliverable', message: 'Message undeliverable' }] }] }));
await hooked({ object: 'whatsapp_business_account', entry: [{ id: WABA, changes: [{ field: 'messages', value: { metadata: { phone_number_id: '999' }, statuses: [{ id: m3.wamid, status: 'read', timestamp: now() }] } }] }] });
const a1 = msgs('id = ?', [m1.id])[0], a2 = msgs('id = ?', [m2.id])[0], a3 = msgs('id = ?', [m3.id])[0];
check('Meta’s reports: read stays read when "delivered" arrives late, what it was billed as is kept, a failure is in plain words, another number’s report is ignored',
  a1.status === 'read' && !!a1.delivered_at && !!a1.read_at && a1.price_category === 'marketing' && a2.status === 'failed' && /not on WhatsApp/.test(a2.error) && a2.error_code === 131026 && a3.status === 'sent', JSON.stringify([a1.status, a2.error, a3.status]));

// ---------- the button ----------
const code1 = parts.button.parameters[0].text;
g = await get('/w/' + code1, { 'User-Agent': 'facebookexternalhit/1.1' });
check('a link checker is sent on but not counted as a tap', g.status === 302 && msgs('id = ?', [row1.id])[0].clicked_at === null, g.status);
g = await get('/w/' + code1, { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile' });
check('the button opens their own album and the tap is noted', g.status === 302 && new RegExp('^' + SITE + '/photos/' + keys[0] + '\\?k=[0-9a-f]{32}$').test(g.headers.get('location')) && !!msgs('id = ?', [row1.id])[0].clicked_at, g.headers.get('location'));
g = await get('/w/' + row1.id + '-000000000000');
const g2 = await get('/w/' + (row1.id + 1) + '-' + code1.split('-')[1]);
check('a guessed or altered link goes to the home page, never to someone’s album', g.headers.get('location') === SITE + '/' && g2.headers.get('location') === SITE + '/', g.headers.get('location'));
// /w/ is shared with the campus recording links: those must still reach their own route.
g = await get('/w/jnu');
const g3 = await get('/w/not-a-report');
check('a campus recording link (/w/jnu) still plays its video, and an unknown one goes to /insights', g.status === 302 && /youtube\.com\/watch\?v=6tlYBxAPw3g$/.test(g.headers.get('location') || '') && /\/insights#watch$/.test(g3.headers.get('location') || ''), g.headers.get('location') + ' | ' + g3.headers.get('location'));

// ---------- replies, the 24 hours, STOP ----------
const inMsg = (from, text, id, name = 'Ravi K') => envelope({ contacts: [{ profile: { name }, wa_id: from }], messages: [{ from, id, timestamp: now(), type: 'text', text: { body: text } }] });
await hooked(inMsg('919811122233', 'Thank you, lovely photos!', 'wamid.IN1'));
await hooked(inMsg('919811122233', 'Thank you, lovely photos!', 'wamid.IN1'));
r = await as('GET', '/api/admin/whatsapp/inbox');
check('a reply arrives once (Meta repeats itself), under the name we know them by, unread', r.json?.rows.length === 1 && r.json.rows[0].name === 'Ravi Kumar' && r.json.rows[0].unread === 1 && r.json.rows[0].open === true && /lovely/.test(r.json.rows[0].last)
  && msgs("direction = 'in'").length === 1 && (await as('GET', '/api/admin/whatsapp')).json.unread === 1, JSON.stringify(r.json?.rows));
r = await as('GET', '/api/admin/whatsapp/thread/919811122233');
check('the conversation shows what we sent and what they wrote, and reading it clears the unread mark', r.json?.messages.length === 2 && r.json.messages[0].out === true && r.json.messages[1].out === false && r.json.open === true
  && rows("SELECT unread FROM wa_contacts WHERE wa_number = '919811122233'")[0].unread === 0, JSON.stringify(r.json?.messages));
const before = sends().length;
r = await as('POST', '/api/admin/whatsapp/reply', { number: '919811122233', text: 'Glad you liked them.' });
const reply = sends()[before]?.body;
check('a typed reply goes as plain text while the 24 hours are open', r.status === 200 && reply.type === 'text' && reply.text.body === 'Glad you liked them.' && reply.to === '919811122233' && !reply.template, JSON.stringify(reply));
db.run("UPDATE wa_contacts SET last_in_at = datetime('now', '-25 hours') WHERE wa_number = '919811122233'");
r = await as('POST', '/api/admin/whatsapp/reply', { number: '919811122233', text: 'Too late' });
check('after 24 hours a typed reply is refused, with the reason', r.status === 409 && r.json?.closed === true && sends().length === before + 1, r.json?.error);

r = await as('POST', '/api/admin/whatsapp/send', { kind: 'custom', template: custom, audience: 'list', list: 'Sunita Rao, 98222 00006\nMr. Imran Khan; +91 90000 11111\nno number here\n98222 00006', expect: 2 });
const batch2 = r.json?.batch;
check('a pasted list: names and numbers read, a line without a number and a repeat left out', r.status === 200 && r.json.count === 2 && r.json.skipped.some(s => s.why === 'bad_number') && r.json.skipped.some(s => s.why === 'twice'), r.text);
const sBefore = sends().length;
await hooked(inMsg('919822200006', ' Stop. ', 'wamid.IN2', 'Sunita'));
const conf = sends()[sBefore]?.body;
const stopped = msgs("wa_number = '919822200006' AND batch_id = ?", [batch2])[0];
check('STOP: they are taken off, told so once, and their waiting message is dropped', rows("SELECT opted_out_at, opted_out_by FROM wa_contacts WHERE wa_number = '919822200006'")[0].opted_out_by === 'reply'
  && conf?.type === 'text' && /will not get WhatsApp messages/.test(conf.text.body) && stopped.status === 'skipped', JSON.stringify([conf, stopped?.status]));
await as('POST', '/api/admin/whatsapp/settings', { per_minute: 60 });
db.run("UPDATE wa_messages SET sent_at = datetime('now', '-5 minutes') WHERE batch_id = ?", [batch1]);
t = await tick();
const ann = sends().filter(c => c.body.template?.name === custom).pop()?.body;
const annParts = Object.fromEntries((ann?.template?.components || []).map(x => [x.type, x]));
check('the announcement goes to the other one: our picture, "Imran" (Mr. dropped), a button', t?.sent === 1 && ann.to === '919000011111' && annParts.header.parameters[0].image.link === SITE + mine.image_url
  && annParts.body.parameters[0].text === 'Imran' && !!annParts.button, JSON.stringify(ann));
r = await as('POST', '/api/admin/whatsapp/audience', { kind: 'photos', only_new: false });
check('nobody who said STOP is in any later send', r.json?.count === 2 && r.json.skipped.some(s => s.why === 'stopped' && s.n === 1), JSON.stringify(r.json?.skipped));
await hooked(inMsg('919822200006', 'please dont stop the photos', 'wamid.IN3', 'Sunita'));
check('a sentence that only contains the word "stop" changes nothing', rows("SELECT opted_out_at FROM wa_contacts WHERE wa_number = '919822200006'")[0].opted_out_at !== null, '');
await hooked(inMsg('919822200006', 'START', 'wamid.IN4', 'Sunita'));
check('START brings them back', rows("SELECT opted_out_at FROM wa_contacts WHERE wa_number = '919822200006'")[0].opted_out_at === null, '');
r = await as('POST', '/api/admin/whatsapp/stop', { number: '90000 00002', on: true });
check('the team can stop a number by hand (ten digits read as an Indian mobile)', r.status === 200 && rows("SELECT opted_out_by FROM wa_contacts WHERE wa_number = '919000000002'").length === 1, r.text);

// ---------- who an announcement reaches ----------
const n = async (audience, extra = {}) => (await as('POST', '/api/admin/whatsapp/audience', { kind: 'custom', template: custom, audience, only_new: false, ...extra })).json;
const everyone = await n('everyone');
const whyE = Object.fromEntries((everyone?.skipped || []).map(s => [s.why, s.n]));
// Registered with a good mobile: 4 album people + 990001, 990003, 990004 = 7 (990002 stopped, 990005 said no, 990006 shares a number, one unsubscribed).
check('everyone registered: not the stopped, the unsubscribed, the one who said no to updates, or a number twice', everyone?.count === 7 && whyE.stopped === 1 && whyE.unsubscribed === 2 && whyE.twice === 1 && whyE.no_mobile === 1 && whyE.bad_number === 1, JSON.stringify(everyone?.skipped) + everyone?.count);
await as('POST', '/api/admin/whatsapp/stop', { number: '90000 00002', on: false });
// Came: 990001 (the desk's stamp) and 990002 (the daily check-in table). Did not: four album people, the unpaid VIP,
// the team's guest, and 990006, whose shared number is free here because 990001 is not in this list.
const came = await n('came'), notCame = await n('not_came');
check('who came (the desk scan or the daily check-in), and who did not', came?.count === 2 && notCame?.count === 7, came?.count + ' ' + notCame?.count);
check('holders of one pass: a paid Delegate, not the one still to pay', (await n('pass:Delegate Pass'))?.count === 1 && (await n('pass:VIP Pass'))?.count === 0, '');
check('one typed number', (await n('one', { number: '90000 22222', name: 'Meera' }))?.count === 1 && (await n('nonsense'))?.count === undefined, '');

// ---------- the pass ----------
r = await as('POST', '/api/admin/whatsapp/audience', { kind: 'pass', event: 1 });
// Five album people with a good mobile (one of them unsubscribed) + 990001, 990002, 990004, 990005; never 990003 or 990006 (still to pay).
check('the pass goes to confirmed passes only (not one waiting for payment), even to someone off the mailing list', r.json?.sample && r.json.count === 9 && /^Hello Dr\. Asha, your Visitor Pass for Bharat AI Innovation 2026 is ready/.test(r.json.preview.text), r.json?.count + ' ' + r.json?.preview?.text);
r = await as('POST', '/api/admin/whatsapp/send', { kind: 'pass', event: 1, attendee_id: 990001 });
const passRow = msgs("kind = 'pass' AND attendee_id = 990001")[0];
check('one person’s pass goes at once; its button is kept as their app link', r.status === 200 && r.json?.sent === 1 && passRow.status === 'sent' && passRow.batch_id === null && /\/app\?email=p990001%40example\.com&action=download-pass$/.test(passRow.target_url), JSON.stringify(passRow));
const passCode = sends().pop().body.template.components.find(x => x.type === 'button').parameters[0].text;
g = await get('/w/' + passCode, { 'User-Agent': 'Mozilla/5.0 (iPhone)' });
check('tapping it opens the app on their pass', g.status === 302 && /\/app\?email=p990001%40example\.com&action=download-pass/.test(g.headers.get('location')), g.headers.get('location'));
r = await as('POST', '/api/admin/whatsapp/send', { kind: 'pass', event: 1, attendee_id: 990004 });
const guestRow = msgs("kind = 'pass' AND attendee_id = 990004")[0];
check('a guest with only a mobile number gets the pass page itself', r.status === 200 && new RegExp('^' + SITE + '/pass/990004\\.[0-9a-f]{24}$').test(guestRow.target_url), guestRow?.target_url);
r = await as('POST', '/api/admin/whatsapp/test', { kind: 'pass', event: 1, to: '98200 12345' });
const testRow = msgs('test = 1')[0];
check('a test to my own phone reads as the first person’s, but its button never signs me in as them', r.status === 200 && testRow.wa_number === '919820012345' && testRow.target_url === SITE + '/app' && !/signin/.test(testRow.payload) && testRow.attendee_id === null, JSON.stringify(testRow));
check('a test needs a full number', (await as('POST', '/api/admin/whatsapp/test', { kind: 'pass', to: '12345' })).status === 400, '');

// ---------- a send that stops itself ----------
r = await as('POST', '/api/admin/whatsapp/send', { kind: 'custom', template: custom, audience: 'list', list: 'A, 9111100001\nB, 9111100002\nC, 9111100003', expect: 3 });
const batch3 = r.json?.batch;
failWith = { code: 190, message: 'Error validating access token: Session has expired', times: 9 };
t = await tick();
let b3 = rows('SELECT status, note FROM wa_batches WHERE id = ?', [batch3])[0];
check('an expired key pauses the send with the reason; nobody is marked failed or lost', b3.status === 'paused' && /access key/i.test(b3.note) && msgs("batch_id = ? AND status = 'queued'", [batch3]).length === 3 && /access key/i.test(t.paused), JSON.stringify(b3));
failWith = { code: 131026, message: 'Message undeliverable', times: 1 };
r = await as('POST', `/api/admin/whatsapp/batches/${batch3}/resume`, {});
t = await tick();
check('carried on: one number not on WhatsApp is marked so, the others go', r.status === 200 && t.sent === 2 && t.failed === 1 && msgs("batch_id = ? AND status = 'failed'", [batch3])[0].error_code === 131026 && rows('SELECT status FROM wa_batches WHERE id = ?', [batch3])[0].status === 'done', JSON.stringify(t));
r = await as('POST', '/api/admin/whatsapp/send', { kind: 'custom', template: custom, audience: 'list', list: Array.from({ length: 7 }, (_, i) => 'X, 912220000' + i).join('\n'), expect: 7 });
const batch4 = r.json?.batch;
failWith = { code: 100, message: 'Invalid parameter', times: 99 };
t = await tick();
b3 = rows('SELECT status, note FROM wa_batches WHERE id = ?', [batch4])[0];
check('five refused in a row pauses the send instead of failing everyone', b3.status === 'paused' && /Five in a row/.test(b3.note) && msgs("batch_id = ? AND status = 'failed'", [batch4]).length === 5 && msgs("batch_id = ? AND status = 'queued'", [batch4]).length === 2, JSON.stringify(b3));
failWith = null;
r = await as('POST', `/api/admin/whatsapp/batches/${batch4}/cancel`, {});
check('cancel drops whoever is still waiting', r.status === 200 && msgs("batch_id = ? AND status = 'cancelled'", [batch4]).length === 2 && rows('SELECT status FROM wa_batches WHERE id = ?', [batch4])[0].status === 'cancelled', '');

// ---------- reports and the inbox (23 Nov 2026, evening) ----------
r = await as('GET', '/api/admin/whatsapp');
const b3o = (r.json?.batches || []).find(b => b.id === batch3);
check('a send says why some did not arrive, in plain words, counted', b3o?.reasons?.length === 1 && b3o.reasons[0].n === 1 && /not on WhatsApp/.test(b3o.reasons[0].words), JSON.stringify(b3o?.reasons));
db.run("INSERT INTO wa_messages (event_id, direction, kind, wa_number, name, template, payload, status, batch_id, test, updated_at) VALUES (1, 'out', 'custom', '919111100009', ?, ?, '{}', 'skipped', ?, 0, datetime('now'))", ['=HYPERLINK("http://x")', custom, batch3]);
const rep = await W.fetchRaw(new Request(SITE + `/api/admin/whatsapp/batches/${batch3}/report`, { headers: W.admin }));
const repText = await rep.text();
const repLines = repText.replace(/^\uFEFF/, '').trim().split(/\r\n/);
check('a send downloads as a spreadsheet: one line each, the state and the reason in words, India time', rep.status === 200 && /text\/csv/.test(rep.headers.get('content-type') || '') && /attachment; filename="whatsapp-.+-\d+\.csv"/.test(rep.headers.get('content-disposition') || '')
  && repLines[0].startsWith('Name,Mobile,State,Sent,Delivered,Read') && repLines.length === 5 && repLines.some(l => /Not delivered/.test(l) && /not on WhatsApp/.test(l)) && repLines.some(l => /,Sent,\d{4}-\d\d-\d\d \d\d:\d\d,/.test(l)), repLines.slice(0, 3).join(' | '));
check('a name that looks like a formula is written as text, never run by the spreadsheet', repLines.some(l => l.startsWith(`"'=HYPERLINK(""http://x"")"`)), repLines.find(l => /HYPERLINK/.test(l)));
check('the report is for the team only', (await hit('GET', `/api/admin/whatsapp/batches/${batch3}/report`)).status === 401 && (await as('GET', '/api/admin/whatsapp/batches/99999/report')).status === 404, '');
await hooked(inMsg('919876543210', 'Is the Delhi pass open?', 'wamid.IN9', 'Asha'));
r = await as('GET', '/api/admin/whatsapp/inbox');
const asha = r.json?.rows.find(x => x.number === '919876543210'), ravi = r.json?.rows.find(x => x.number === '919811122233');
check('the inbox marks who is waiting for our reply (they wrote last), and not someone we answered', asha?.waiting === true && ravi?.waiting === false, JSON.stringify([asha?.waiting, ravi?.waiting]));
r = await as('GET', '/api/admin/whatsapp/thread/919876543210');
check('a chat shows who is writing: their registration, pass, payment and event', r.json?.person?.attendee_id === idOf(keys[0]) && r.json.person.name === 'Dr. Asha Mehta' && r.json.person.pass === 'Visitor Pass' && r.json.person.payment === 'paid' && r.json.person.email === 'p' + idOf(keys[0]) + '@example.com', JSON.stringify(r.json?.person));
r = await as('GET', '/api/admin/whatsapp/thread/449999999999');
check('a number on no registration says so, and nothing breaks', r.status === 200 && r.json?.person === null, JSON.stringify(r.json?.person));
r = await as('POST', '/api/admin/whatsapp/quick-replies', { list: [{ title: 'Delhi', text: 'Delhi 2027 passes open soon: bharataiinnovation.com/delhi' }, { text: '' }, { title: '', text: 'Thank you for writing to us.' }] });
const quick = (await as('GET', '/api/admin/whatsapp')).json?.quick;
check('quick replies: saved for the whole team, an empty one dropped, a missing title taken from the words', r.status === 200 && quick?.length === 2 && quick[0].title === 'Delhi' && quick[1].title === 'Thank you for writing to us.', JSON.stringify(quick));
check('quick replies need a list', (await as('POST', '/api/admin/whatsapp/quick-replies', { list: 'x' })).status === 400, '');

// ---------- Claude's own way in: the MCP server on the desk ----------
const mcp = async (key, body) => {
  const res = await W.fetchRaw(new Request(SITE + '/api/whatsapp/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) }, body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json().catch(() => null) };
};
const call = async (key, name, args = {}) => { const r = await mcp(key, { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } }); const t = r.json?.result?.content?.[0]?.text; return { ...r, data: t ? JSON.parse(t) : null, isError: r.json?.result?.isError }; };
check('MCP: nothing without a key (none made yet)', (await mcp('bwa_guess', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status === 401 && (await mcp('', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status === 401, '');
r = await as('POST', '/api/admin/whatsapp/mcp-key', {});
const mkey = r.json?.key;
const ovm = (await as('GET', '/api/admin/whatsapp')).text;
check('MCP: the key is shown once inside the command to paste; afterwards only "on" and its dates', r.status === 200 && /^bwa_[A-Za-z0-9_-]{43}$/.test(mkey || '') && r.json.command === `claude mcp add --transport http bharat_whatsapp ${SITE}/api/whatsapp/mcp --header "Authorization: Bearer ${mkey}"`
  && !ovm.includes(mkey) && JSON.parse(ovm).mcp.on === true && !rows("SELECT value FROM app_settings WHERE key LIKE 'whatsapp%'").some(x => String(x.value).includes(mkey)), r.text.slice(0, 120));
r = await mcp(mkey, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '2' } } });
check('MCP: initialize answers with tools and the rules for a send', r.status === 200 && r.json?.result?.protocolVersion === '2025-06-18' && !!r.json.result.capabilities.tools && /explicit yes/.test(r.json.result.instructions), JSON.stringify(r.json).slice(0, 200));
check('MCP: a notification gets no body', (await W.fetchRaw(new Request(SITE + '/api/whatsapp/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + mkey }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) }))).status === 202, '');
r = await mcp(mkey, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
const toolNames = (r.json?.result?.tools || []).map(x => x.name);
check('MCP: the tools are listed, each with its input', toolNames.length === 11 && ['whatsapp_status', 'whatsapp_audience', 'whatsapp_send_bulk', 'whatsapp_reply', 'whatsapp_chat'].every(x => toolNames.includes(x)) && r.json.result.tools.every(x => x.inputSchema?.type === 'object'), toolNames.join(','));
let mc = await call(mkey, 'whatsapp_status');
check('MCP: status reads the number, the day, and every template with its approval', !mc.isError && mc.data.connected === true && mc.data.templates.some(x => x.name === custom && x.status === 'APPROVED') && Array.isArray(mc.data.latest_sends) && typeof mc.data.today.limit === 'number', JSON.stringify(mc.data).slice(0, 200));
mc = await call(mkey, 'whatsapp_audience', { kind: 'custom', template: custom, audience: 'list', list: 'Meera, 9555500001\nJoy, 9555500002', only_new: false });
check('MCP: an audience is counted without sending anything', !mc.isError && mc.data.count === 2, JSON.stringify(mc.data).slice(0, 200));
const sentBeforeMcp = sends().length;
mc = await call(mkey, 'whatsapp_send_bulk', { kind: 'custom', template: custom, audience: 'list', list: 'Meera, 9555500001\nJoy, 9555500002', only_new: false, expect: 3 });
check('MCP: a bulk send with a count that does not match is refused and nothing is queued', mc.isError === true && /changed/.test(mc.data.error) && mc.data.count === 2 && msgs("wa_number IN ('919555500001', '919555500002')").length === 0, JSON.stringify(mc.data));
mc = await call(mkey, 'whatsapp_send_bulk', { kind: 'custom', template: custom, audience: 'one', number: '9555500001', expect: 1 });
check('MCP: one person is never a bulk send', mc.isError === true && /send_one/.test(mc.data.error), JSON.stringify(mc.data));
mc = await call(mkey, 'whatsapp_reply', { number: '+91 98765 43210', text: 'Delhi passes open in January. We will write to you first.' });
const mreply = msgs("wa_number = '919876543210' AND kind = 'reply'").pop();
check('MCP: a reply within the 24 hours goes, signed as "Claude (MCP)" on the message', !mc.isError && sends().length === sentBeforeMcp + 1 && mreply?.created_by === 'Claude (MCP)', JSON.stringify(mreply));
mc = await call(mkey, 'whatsapp_inbox', { filter: 'waiting' });
check('MCP: the inbox filter: Asha is no longer waiting once answered', !mc.isError && !mc.data.chats.some(x => x.number === '919876543210'), JSON.stringify(mc.data.chats.map(x => x.number)));
mc = await call(mkey, 'whatsapp_sends');
check('MCP: sends come back with rates and the reasons', !mc.isError && mc.data.sends.some(x => x.id === batch3 && x.failed === 1 && x.why_not_delivered.length === 1 && /%$/.test(x.rates.delivered)), JSON.stringify(mc.data.sends.find(x => x.id === batch3)));
check('MCP: an unknown tool and an unknown method say so', (await mcp(mkey, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'drop_tables' } })).json?.error?.code === -32602 && (await mcp(mkey, { jsonrpc: '2.0', id: 9, method: 'resources/list' })).json?.error?.code === -32601, '');
r = await as('POST', '/api/admin/whatsapp/mcp-key', {});
check('MCP: a new key stops the old one', (await mcp(mkey, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status === 401 && (await mcp(r.json.key, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status === 200, '');
r = await as('POST', '/api/admin/whatsapp/mcp-key', { off: true });
check('MCP: switched off, nothing gets in', r.json?.mcp?.on === false && (await mcp(mkey, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status === 401, '');
check('MCP: making a key is for the team only', (await hit('POST', '/api/admin/whatsapp/mcp-key', {})).status === 401, '');

// ---------- the message builder: video, PDF, words on top, buttons, Hindi, blanks (migration 0066) ----------
const rawPost = async (path, bytes, type, name) => W.fetchRaw(new Request(SITE + path, { method: 'POST', headers: { ...W.admin, 'Content-Type': type, ...(name ? { 'X-File-Name': encodeURIComponent(name) } : {}) }, body: bytes }));
const MP4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, ...Array(120).fill(1)]);
const PDF = new Uint8Array([...Buffer.from('%PDF-1.7\n'), ...Array(120).fill(32)]);
let up = await rawPost('/api/admin/whatsapp/media', MP4, 'video/mp4', 'Delhi teaser.mp4');
let upj = await up.json();
const videoUrl = upj.url;
check('builder: a video for the top of a message is kept, checked to be a video', up.status === 200 && /^\/api\/uploads\/whatsapp\/[a-f0-9]{20}\.mp4$/.test(upj.url || '') && upj.header === 'video', JSON.stringify(upj));
up = await rawPost('/api/admin/whatsapp/media', PDF, 'application/pdf', 'Sponsorship deck.pdf');
upj = await up.json();
const pdfUrl = upj.url;
check('builder: a PDF is kept with its name', up.status === 200 && /\.pdf$/.test(upj.url || '') && upj.filename === 'Sponsorship deck.pdf', JSON.stringify(upj));
check('builder: a file that is not what it says, or another kind, is refused; only the team may add one', (await rawPost('/api/admin/whatsapp/media', PDF, 'video/mp4')).status === 400
  && (await rawPost('/api/admin/whatsapp/media', PDF, 'text/html')).status === 400 && (await hit('POST', '/api/admin/whatsapp/media', {})).status === 401, '');
const delhi = { title: 'Delhi invite Hindi', lang: 'hi', greet: true, category: 'MARKETING', body: 'आपका [Pass] [Event] के लिए तैयार है। दिल्ली 2027 में मिलते हैं।', header: { type: 'video', url: videoUrl },
  buttons: [{ type: 'url', text: 'दिल्ली 2027 देखें', url: SITE + '/delhi' }, { type: 'reply', text: 'हाँ, आऊँगा' }, { type: 'phone', text: 'कॉल करें', phone: '91373 69984' }, { type: 'url', text: 'Brochure', url: SITE + '/brochure.pdf' }] };
r = await as('POST', '/api/admin/whatsapp/templates', delhi);
check('builder: before migration 0066, video, Hindi, more buttons and blanks are refused with the command to run', r.status === 409 && /0066_whatsapp_template_spec\.sql/.test(r.json?.command || ''), r.text.slice(0, 200));
db.exec(read('migrations/0066_whatsapp_template_spec.sql'));
r = await as('POST', '/api/admin/whatsapp/templates', delhi);
const hindi = r.json?.name;
const ht = (r.json?.templates || []).find(x => x.name === hindi);
check('builder: a Hindi message with a video, blanks and four kinds of button is saved, quick replies first', r.status === 200 && ht?.lang === 'hi' && ht.header.type === 'video' && ht.buttons.map(x => x.type).join() === 'reply,url,url,phone'
  && ht.preview.startsWith('नमस्ते Asha,\n\nआपका Delegate Pass Bharat AI Innovation 2026 के लिए') && ht.footer === 'ये संदेश बंद करने के लिए STOP लिखें', JSON.stringify(ht).slice(0, 300));
const badB = [[{ ...delhi, buttons: [0, 1, 2].map(i => ({ type: 'url', text: 'L' + i, url: SITE + '/x' + i })) }, /two link/], [{ ...delhi, buttons: [{ type: 'phone', text: 'A', phone: '9137369984' }, { type: 'phone', text: 'B', phone: '9137369985' }] }, /one call/],
  [{ ...delhi, buttons: Array.from({ length: 11 }, (_, i) => ({ type: 'reply', text: 'R' + i })) }, /10 buttons/], [{ ...delhi, buttons: [{ type: 'reply', text: 'Yes' }, { type: 'reply', text: 'yes' }] }, /same words/],
  [{ ...delhi, body: 'We will see you at [Event]' }, /End the message/], [{ ...delhi, header: { type: 'video', url: pdfUrl } }, /video again/], [{ ...delhi, header: { type: 'text', text: '' } }, /top of the message/]];
let bOk = 0;
for (const [b, re] of badB) { const x = await as('POST', '/api/admin/whatsapp/templates', b); if (x.status === 400 && re.test(x.json?.error || '')) bOk++; }
check('builder: refused as Meta would: three links, two calls, eleven buttons, twins, a blank at the end, the wrong file, empty words on top', bOk === badB.length, bOk + ' of ' + badB.length);
r = await as('POST', `/api/admin/whatsapp/templates/${hindi}/submit`, {});
const madeH = calls.filter(x => x.path === `${WABA}/message_templates` && x.method === 'POST').pop()?.body;
const upCall = calls.filter(x => x.path.startsWith(`${APP}/uploads?`)).pop();
check('builder: Meta gets it in Hindi: the video sample uploaded first, the blanks with samples, the Hindi STOP line, the buttons in order, each link tracked',
  r.status === 200 && madeH.language === 'hi' && comp(madeH, 'HEADER').format === 'VIDEO' && comp(madeH, 'HEADER').example.header_handle[0] === '4::HANDLE' && /file_type=video%2Fmp4/.test(upCall?.path || '')
  && comp(madeH, 'BODY').text === 'नमस्ते {{1}},\n\nआपका {{2}} {{3}} के लिए तैयार है। दिल्ली 2027 में मिलते हैं।' && JSON.stringify(comp(madeH, 'BODY').example.body_text[0]) === JSON.stringify(['Asha', 'Delegate Pass', 'Bharat AI Innovation 2026'])
  && comp(madeH, 'FOOTER').text === 'ये संदेश बंद करने के लिए STOP लिखें' && comp(madeH, 'BUTTONS').buttons.map(x => x.type).join() === 'QUICK_REPLY,URL,URL,PHONE_NUMBER'
  && comp(madeH, 'BUTTONS').buttons[1].url === SITE + '/w/{{1}}' && comp(madeH, 'BUTTONS').buttons[3].phone_number === '+919137369984', JSON.stringify(madeH).slice(0, 500));
db.run("UPDATE wa_templates SET status = 'APPROVED' WHERE name = ?", [hindi]);
let sb = sends().length;
r = await as('POST', '/api/admin/whatsapp/send', { kind: 'custom', template: hindi, audience: 'one', number: '90000 44444', name: 'Kiran' });
const hm = sends()[sb]?.body;
const hbtn = (hm?.template?.components || []).filter(x => x.type === 'button');
const hrow = msgs("wa_number = '919000044444'").pop();
check('builder: it goes in Hindi: the video on top, the blanks filled for the person, each link button with its own code', r.status === 200 && hm.template.language.code === 'hi'
  && hm.template.components[0].parameters[0].video.link === SITE + videoUrl && JSON.stringify(hm.template.components.find(x => x.type === 'body').parameters.map(x => x.text)) === JSON.stringify(['Kiran', 'pass', 'Bharat AI Innovation 2026'])
  && hbtn.length === 2 && hbtn[0].index === '1' && hbtn[1].index === '2' && new RegExp('^' + hrow.id + '-[0-9a-f]{12}$').test(hbtn[0].parameters[0].text) && hbtn[1].parameters[0].text === hbtn[0].parameters[0].text + 'b1', JSON.stringify(hm?.template).slice(0, 500));
g = await get('/w/' + hbtn[1].parameters[0].text, { 'User-Agent': 'Mozilla/5.0 (iPhone)' });
check('builder: the second link button leads to its own page, and the tap is noted', g.status === 302 && g.headers.get('location') === SITE + '/brochure.pdf' && !!msgs('id = ?', [hrow.id])[0].clicked_at, g.headers.get('location'));
g = await get('/w/' + hbtn[0].parameters[0].text + 'b7');
check('builder: a made-up button number goes to the home page', g.headers.get('location') === SITE + '/', g.headers.get('location'));
r = await as('POST', '/api/admin/whatsapp/templates', { title: 'Sponsor deck', greet: true, body: 'Here is our sponsorship deck for Delhi 2027. Reply here with any question.', header: { type: 'document', url: pdfUrl, filename: 'Sponsorship deck' }, buttons: [] });
const deck = r.json?.name;
db.run("UPDATE wa_templates SET status = 'APPROVED' WHERE name = ?", [deck]);
sb = sends().length;
await as('POST', '/api/admin/whatsapp/send', { kind: 'custom', template: deck, audience: 'one', number: '90000 55555', name: 'Ritu' });
const dm = sends()[sb]?.body;
check('builder: a PDF on top goes as a document with its file name', dm?.template?.components?.[0]?.parameters?.[0]?.document?.link === SITE + pdfUrl && dm.template.components[0].parameters[0].document.filename === 'Sponsorship deck.pdf' && dm.template.language.code === 'en', JSON.stringify(dm?.template?.components?.[0]));
r = await as('POST', '/api/admin/whatsapp/templates', { title: 'Words on top', greet: false, body: 'Delhi 2027 passes open in January. Watch this space for the dates.', header: { type: 'text', text: 'Delhi 2027 *is coming*' } });
await as('POST', `/api/admin/whatsapp/templates/${r.json?.name}/submit`, {});
const tmade = calls.filter(x => x.path === `${WABA}/message_templates` && x.method === 'POST').pop()?.body;
check('builder: words on top go as a text header (formatting marks taken out); no greeting means no blanks', comp(tmade, 'HEADER')?.format === 'TEXT' && comp(tmade, 'HEADER').text === 'Delhi 2027 is coming' && !comp(tmade, 'BODY').example && !/\{\{/.test(comp(tmade, 'BODY').text), JSON.stringify(tmade).slice(0, 300));
await as('POST', '/api/admin/whatsapp/settings', { sending: 'off' });
await as('POST', '/api/admin/whatsapp/send', { kind: 'custom', template: custom, audience: 'one', number: '90000 33333', name: 'Kiran' });
const off = (await as('POST', '/api/admin/whatsapp/send', { kind: 'custom', template: custom, audience: 'list', list: 'Z, 9444400001', expect: 1 })).json?.batch;
t = await tick();
check('with sending switched off the queue holds', t?.off === true && msgs("batch_id = ? AND status = 'queued'", [off]).length === 1, JSON.stringify(t));
await as('POST', '/api/admin/whatsapp/settings', { sending: 'on' });

// ---------- automatic messages (Admin -> WhatsApp -> Automatic) ----------
const AUTO_TPLS = ['bhai_auto_enquiry_v1', 'bhai_auto_delhi_paid_v1', 'bhai_auto_listing_live_v1', 'bhai_auto_listing_lead_v1'];
const autoOf = (o, key) => (o?.auto || []).find(a => a.key === key);
let ovA = (await as('GET', '/api/admin/whatsapp')).json;
check('automatic: four rules, every one off until the team switches it on', ovA?.auto?.length === 4 && ovA.auto.every(a => a.on === false && a.status === 'draft' && a.title && a.when), JSON.stringify(ovA?.auto));
r = await as('POST', '/api/admin/whatsapp/auto', { key: 'enquiry', on: true });
check('automatic: it cannot be switched on before Meta approves its message', r.status === 409 && /approved/i.test(r.json?.error || '') && !autoOf((await as('GET', '/api/admin/whatsapp')).json, 'enquiry').on, r.json?.error);
check('automatic: a rule that does not exist is refused', (await as('POST', '/api/admin/whatsapp/auto', { key: 'everyone', on: true })).status === 400, '');
r = await as('POST', '/api/admin/whatsapp/templates/bhai_auto_enquiry_v1/submit', {});
const madeA = calls.filter(x => x.path === `${WABA}/message_templates` && x.method === 'POST').pop()?.body;
check('automatic: the enquiry thank-you goes to Meta as a service message with two blanks and their samples, no button', r.status === 200 && madeA?.name === 'bhai_auto_enquiry_v1' && madeA.category === 'UTILITY'
  && comp(madeA, 'BODY').example.body_text[0].length === 2 && !comp(madeA, 'BUTTONS') && !/\}\}\.?$/.test(comp(madeA, 'BODY').text), JSON.stringify(madeA).slice(0, 300));
for (const n of AUTO_TPLS) db.run("INSERT OR IGNORE INTO wa_templates (name, builtin, title, category, status) VALUES (?, 1, ?, 'UTILITY', 'draft')", [n, n]);
db.run(`UPDATE wa_templates SET status = 'APPROVED' WHERE name IN (${AUTO_TPLS.map(() => '?').join(',')})`, AUTO_TPLS);
// What happened before the rules were switched on: never messaged.
const AGO = '2026-01-01 00:00:00';
const enquiry = (type, name, phone, at = "datetime('now', '+1 minute')") => db.run(`INSERT INTO inquiries (event_id, inquiry_type, name, email, phone, created_at) VALUES (1, ?, ?, ?, ?, ${at})`, [type, name, name.replace(/\W/g, '').toLowerCase() + '@example.com', phone]);
enquiry('booth', 'Old Enquiry', '98200 11111', `'${AGO}'`);
person(990101, 'Kavita Joshi', '98200 55555', { event_id: 2, badge_type: 'Delegate Pass' });
person(990102, 'Paid Long Ago', '98200 66666', { event_id: 2, badge_type: 'VIP Pass' });
const order = (id, att, status, paidAt) => db.run(`INSERT INTO payment_orders (order_id, attendee_id, event_id, pass_type, base_paise, gst_paise, amount_paise, status, paid_at) VALUES (?, ?, 2, 'delegate', 100, 18, 118, ?, ${paidAt})`, [id, att, status]);
order('BAI990102-1', 990102, 'paid', `'${AGO}'`);
const listing = (id, product, slug, seller, phone, created, updated) => db.run(`INSERT INTO mp_listings (id, company_id, company_name, company_slug, product_name, product_slug, description, sales_contact_name, sales_contact_phone, status, created_at, updated_at)
  VALUES (?, 1, 'Acme AI', ?, ?, ?, 'An AI product.', ?, ?, 'approved', ${created}, ${updated})`, [id, slug ? 'acme-ai' : null, product, slug, seller, phone]);
listing(7701, 'Acme Copilot', 'acme-copilot', 'Rohit Sen', '98200 77777', `'${AGO}'`, `'${AGO}'`);
listing(7702, 'Old Product', null, 'Old Seller', '98200 88888', `'${AGO}'`, "datetime('now', '+1 minute')"); // live since January, only edited now
for (const k of ['enquiry', 'delhi_paid', 'listing_live', 'listing_lead']) r = await as('POST', '/api/admin/whatsapp/auto', { key: k, on: true });
check('automatic: once approved each one switches on, and notes the time it was switched on', r.status === 200 && r.json?.auto?.every(a => a.on && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(a.since) && a.status === 'APPROVED'), JSON.stringify(r.json?.auto));
// What happens after.
enquiry('sponsorship', 'Dr. Meera Iyer', '+91 98200 22222');
enquiry('booth', 'Short Number', '12345');
enquiry('speaking', 'No Phone', '');
enquiry('general', 'Said Stop', '98200 44444');
db.run("INSERT INTO wa_contacts (wa_number, opted_out_at, opted_out_by) VALUES ('919820044444', datetime('now'), 'reply')");
order('BAI990101-1', 990101, 'paid', "datetime('now', '+1 minute')");
order('BAI990102-2', 990102, 'created', 'NULL'); // started paying again, did not finish
db.run("INSERT INTO admin_audit (actor, actor_kind, action, entity, entity_id, detail, created_at) VALUES ('Team', 'admin', 'marketplace.listing-approved', 'mp_listing', '7701', '{}', datetime('now', '+1 minute'))");
db.run("INSERT INTO mp_inquiries (listing_id, inquirer_name, inquirer_email, inquirer_message, created_at) VALUES (7701, 'Secret Buyer', 'buyer@example.com', 'What does it cost?', datetime('now', '+1 minute'))");
sb = sends().length;
t = await tick();
const autoSent = sends().slice(sb).map(x => x.body).filter(b => AUTO_TPLS.includes(b?.template?.name));
const sentAs = (name) => autoSent.find(b => b.template.name === name);
const bodyOf = (b) => ((b?.template?.components || []).find(x => x.type === 'body')?.parameters || []).map(p => p.text);
const codeOf = (b) => (b?.template?.components || []).find(x => x.type === 'button')?.parameters?.[0]?.text;
check('automatic: one minute sends each new one once: an enquiry, a Delhi payment, an approval, a buyer’s question', t?.auto?.enquiry === 1 && t.auto.delhi_paid === 1 && t.auto.listing_live === 1 && t.auto.listing_lead === 1 && autoSent.length === 4,
  JSON.stringify(t?.auto) + ' ' + autoSent.map(b => b.template.name + '>' + b.to).join());
const eq = sentAs('bhai_auto_enquiry_v1');
check('automatic: the enquiry thank-you names what they wrote about, and has no button', eq?.to === '919820022222' && bodyOf(eq)[1] === 'sponsorship' && /Meera|Iyer/.test(bodyOf(eq)[0]) && !codeOf(eq), JSON.stringify(eq?.template));
const dp = sentAs('bhai_auto_delhi_paid_v1');
g = dp ? await get('/w/' + codeOf(dp), { 'User-Agent': 'Mozilla/5.0 (iPhone)' }) : null;
check('automatic: the Delhi confirmation names their pass, and its button opens Delhi 2027', dp?.to === '919820055555' && bodyOf(dp)[1] === 'Delegate Pass' && g?.status === 302 && g.headers.get('location') === SITE + '/delhi', JSON.stringify(dp?.template) + ' ' + g?.headers.get('location'));
const ll = sentAs('bhai_auto_listing_live_v1');
g = ll ? await get('/w/' + codeOf(ll), { 'User-Agent': 'Mozilla/5.0 (iPhone)' }) : null;
check('automatic: "your listing is live" goes to the seller and opens their own listing', ll?.to === '919820077777' && bodyOf(ll)[1] === 'Acme Copilot' && g?.headers.get('location') === SITE + '/marketplace/listing/acme-ai/acme-copilot', g?.headers.get('location'));
const lq = sentAs('bhai_auto_listing_lead_v1');
g = lq ? await get('/w/' + codeOf(lq), { 'User-Agent': 'Mozilla/5.0 (iPhone)' }) : null;
check('automatic: a buyer’s question goes to the seller without the buyer’s name, and opens their leads', lq?.to === '919820077777' && bodyOf(lq)[1] === 'Acme Copilot' && !JSON.stringify(lq).includes('Secret Buyer')
  && !msgs("kind = 'auto'").some(x => String(x.payload).includes('Secret Buyer')) && g?.headers.get('location') === SITE + '/marketplace/dashboard#leads', g?.headers.get('location'));
const autoRows = msgs("kind = 'auto'");
check('automatic: nobody from before it was switched on, no edited listing and no unfinished payment; a short number and a STOP are written down as left out',
  !autoSent.some(b => ['919820011111', '919820066666', '919820088888'].includes(b.to)) && autoRows.length === 6 && autoRows.every(x => x.created_by === 'automatic' && x.batch_id === null)
  && autoRows.filter(x => x.status === 'skipped').map(x => x.error).sort().join('|') === 'Asked us to stop on WhatsApp|The mobile number is not complete', JSON.stringify(autoRows.map(x => [x.name, x.status, x.error])));
t = await tick();
check('automatic: the next minute sends nobody twice', !Object.keys(t?.auto || {}).length && msgs("kind = 'auto'").length === 6, JSON.stringify(t?.auto));
ovA = (await as('GET', '/api/admin/whatsapp')).json;
check('automatic: the screen counts what each one sent, and when', autoOf(ovA, 'enquiry')?.sent === 1 && autoOf(ovA, 'listing_lead')?.sent === 1 && !!autoOf(ovA, 'enquiry').last_at, JSON.stringify(ovA?.auto));
r = await as('POST', '/api/admin/whatsapp/auto', { key: 'enquiry', on: false });
enquiry('general', 'After Off', '98200 99999', "datetime('now', '+2 minutes')");
sb = sends().length;
t = await tick();
check('automatic: switched off, a new enquiry gets nothing (and the others stay on)', r.status === 200 && !autoOf(r.json, 'enquiry').on && autoOf(r.json, 'delhi_paid').on && sends().length === sb && !msgs("name = 'After Off'").length, '');
db.run("UPDATE wa_templates SET status = 'PAUSED' WHERE name = 'bhai_auto_delhi_paid_v1'");
person(990103, 'Paused Payer', '98200 12121', { event_id: 2, badge_type: 'VIP Pass' });
order('BAI990103-1', 990103, 'paid', "datetime('now', '+2 minutes')");
t = await tick();
check('automatic: a message Meta has paused waits (nothing written, so it goes once Meta lets it)', !msgs("name = 'Paused Payer'").length, '');
db.run("UPDATE wa_templates SET status = 'APPROVED' WHERE name = 'bhai_auto_delhi_paid_v1'");
t = await tick();
check('automatic: …and goes once Meta approves it again', msgs("name = 'Paused Payer' AND kind = 'auto'").length === 1 && t?.auto?.delhi_paid === 1, JSON.stringify(t?.auto));

// ---------- the lists, and nothing leaking ----------
r = await as('GET', '/api/admin/whatsapp/messages?status=failed');
const ov = (await as('GET', '/api/admin/whatsapp')).json;
check('the Sent list filters by state, and the overview counts every send with its numbers', r.json?.rows.length >= 6 && r.json.rows.every(x => x.status === 'failed' && /^\+91 /.test(x.number))
  && ov.batches.length === 5 && ov.batches.find(b => b.id === batch1).counts.read === 1 && ov.batches.find(b => b.id === batch1).taps === 1 && ov.batches.find(b => b.id === batch1).replied === 3 /* Ravi, Sunita, and Asha asking about Delhi */ && ov.totals.taps >= 2, JSON.stringify(ov.batches.find(b => b.id === batch1)));
check('no answer from any admin route ever carried the access key or the app secret', answers.length > 60 && answers.every(a => !a.includes(TOKEN) && !a.includes(SECRET)), answers.length);
// ---------- registering our number (Meta answers 133010 until it is) ----------
const registers = () => calls.filter(c => c.path === `${PHONE}/register`);
r = await as('POST', '/api/admin/whatsapp/register', { pin: '12345' });
check('register: a PIN that is not 6 digits is caught before Meta is asked', r.status === 400 && r.json?.field === 'pin' && registers().length === 0, r.json?.error);
r = await as('POST', '/api/admin/whatsapp/register', { pin: '999999' });
check('register: Meta’s "too many tries" comes back in plain words', r.status === 502 && /10 in 3 days/.test(r.json?.error || ''), r.json?.error);
r = await as('POST', '/api/admin/whatsapp/register', { pin: '482 913' });
const reg = registers().pop();
check('register: Meta gets the number and the PIN, the screen learns the number can send', r.status === 200 && r.json?.number_status === 'CONNECTED' && r.json?.checked?.number_status === 'CONNECTED'
  && reg.method === 'POST' && reg.body.messaging_product === 'whatsapp' && reg.body.pin === '482913' && reg.headers.Authorization === 'Bearer ' + TOKEN, JSON.stringify(r.json?.checked));
r = await as('POST', '/api/admin/whatsapp/register', { pin: '482913' });
check('register: a number already registered is not registered again (Meta allows 10 tries in 3 days)', r.status === 200 && r.json?.already === true && registers().length === 2, registers().length);
check('register: the PIN is kept nowhere, not in an answer, a setting or the audit log', !answers.some(t => t.includes('482913') || t.includes('482 913'))
  && !rows("SELECT value FROM app_settings WHERE key LIKE 'whatsapp%'").some(x => String(x.value).includes('482913'))
  && !rows("SELECT detail FROM admin_audit WHERE action LIKE 'whatsapp.%'").some(x => String(x.detail).includes('482913')), '');
failWith = { code: 133010, message: 'Account not registered', times: 1 };
r = await as('POST', '/api/admin/whatsapp/test', { kind: 'pass', event: 1, to: '98200 12345' });
failWith = null;
check('a send Meta refuses as "not registered" tells the team where to fix it', r.status === 502 && /Register it once in Setup/.test(r.json?.error || ''), r.json?.error);

// ---------- delivery reports: only our own app counts ----------
await as('POST', '/api/admin/whatsapp/config', { app_id: APP });
let subPosts = calls.filter(c => c.path === `${WABA}/subscribed_apps` && c.method === 'POST').length;
subsData = [{ whatsapp_business_api_data: { id: '999000999000', name: 'A vendor' } }];
r = await as('POST', '/api/admin/whatsapp/check', {});
check('another app on the account does not count: ours is subscribed too', r.json?.check?.webhook === 'subscribed' && calls.filter(c => c.path === `${WABA}/subscribed_apps` && c.method === 'POST').length === subPosts + 1, r.json?.check?.webhook);
subsData = [{ whatsapp_business_api_data: { id: APP, name: 'Ours' } }];
subPosts = calls.filter(c => c.path === `${WABA}/subscribed_apps` && c.method === 'POST').length;
r = await as('POST', '/api/admin/whatsapp/check', {});
check('ours already there: not subscribed twice', r.json?.check?.webhook === 'subscribed' && calls.filter(c => c.path === `${WABA}/subscribed_apps` && c.method === 'POST').length === subPosts, '');

// ---------- Meta registers the number but its answer is lost (23 Nov: it took over 12 seconds) ----------
numberStatus = 'PENDING'; loseRegister = true;
r = await as('POST', '/api/admin/whatsapp/register', { pin: '135790' });
loseRegister = false;
check('register: no answer from Meta, but the number is ready: the screen says ready, not an error', r.status === 200 && r.json?.number_status === 'CONNECTED' && r.json?.checked?.number_status === 'CONNECTED', r.text.slice(0, 200));

// ---------- moving from Meta's test number to our own ----------
const approvedBefore = rows("SELECT COUNT(*) AS n FROM wa_templates WHERE status = 'APPROVED'")[0].n;
r = await as('POST', '/api/admin/whatsapp/config', { phone_id: '200000000000001', waba_id: '300000000000001' });
const tplAfter = rows('SELECT status, meta_id, meta_category FROM wa_templates');
check('a new WhatsApp account starts with nothing approved (Meta approves per account), and the old number’s check is cleared', r.status === 200 && approvedBefore > 0
  && tplAfter.length > 0 && tplAfter.every(t => t.status === 'draft' && t.meta_id === null && t.meta_category === null) && r.json?.checked === null, JSON.stringify(tplAfter));
r = await as('POST', '/api/admin/whatsapp/config', { phone_id: '200000000000001' });
check('saving the same account again resets nothing', r.status === 200 && rows('SELECT status FROM wa_templates').every(t => t.status === 'draft'), '');

check('the audit log names what was done, never a value',rows("SELECT detail FROM admin_audit WHERE action LIKE 'whatsapp.%'").length >= 8 && rows("SELECT detail FROM admin_audit WHERE action LIKE 'whatsapp.%'").every(x => !String(x.detail).includes(TOKEN) && !String(x.detail).includes(SECRET)), '');
done();
