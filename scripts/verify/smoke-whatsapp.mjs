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
check('two built-in messages, not yet with WhatsApp', r.json?.templates?.length === 2 && r.json.templates.every(t => t.builtin && t.status === 'draft'), '');
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
check('ask WhatsApp: both approved, and the kind Meta chose is shown (it made photos a marketing message)', r.json?.templates.length === 2 && r.json.templates.every(t => t.status === 'APPROVED') && photosTpl.meta_category === 'MARKETING', JSON.stringify(r.json?.templates.map(t => [t.name, t.status, t.meta_category])));

// A picture or announcement the team writes.
const store = new Map();
env.UPLOADS = { async put(key, bytes, o) { store.set(key, { bytes, type: o?.httpMetadata?.contentType }); },
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
await as('POST', '/api/admin/whatsapp/settings', { sending: 'off' });
await as('POST', '/api/admin/whatsapp/send', { kind: 'custom', template: custom, audience: 'one', number: '90000 33333', name: 'Kiran' });
const off = (await as('POST', '/api/admin/whatsapp/send', { kind: 'custom', template: custom, audience: 'list', list: 'Z, 9444400001', expect: 1 })).json?.batch;
t = await tick();
check('with sending switched off the queue holds', t?.off === true && msgs("batch_id = ? AND status = 'queued'", [off]).length === 1, JSON.stringify(t));
await as('POST', '/api/admin/whatsapp/settings', { sending: 'on' });

// ---------- the lists, and nothing leaking ----------
r = await as('GET', '/api/admin/whatsapp/messages?status=failed');
const ov = (await as('GET', '/api/admin/whatsapp')).json;
check('the Sent list filters by state, and the overview counts every send with its numbers', r.json?.rows.length >= 6 && r.json.rows.every(x => x.status === 'failed' && /^\+91 /.test(x.number))
  && ov.batches.length === 5 && ov.batches.find(b => b.id === batch1).counts.read === 1 && ov.batches.find(b => b.id === batch1).taps === 1 && ov.batches.find(b => b.id === batch1).replied === 2 && ov.totals.taps >= 2, JSON.stringify(ov.batches.find(b => b.id === batch1)));
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

check('the audit log names what was done, never a value',rows("SELECT detail FROM admin_audit WHERE action LIKE 'whatsapp.%'").length >= 8 && rows("SELECT detail FROM admin_audit WHERE action LIKE 'whatsapp.%'").every(x => !String(x.detail).includes(TOKEN) && !String(x.detail).includes(SECRET)), '');
done();
