// "My photos" on the app's home screen (23 Nov 2026, src/routes/my-photos.ts and
// renderMyPhotosCard() in /app.js), on the talks world: the whole built worker on real
// SQLite with the production schema and migration 0064. Who gets which album (speaker,
// Innovation Talk speaker, guest, attendee), the count the photos page itself shows (less
// "Not me" and hidden photos), small signed photos only, the ask for a clear photo when
// nobody is found, and no card for the signed out, another event, a campus panel only, or
// someone who said "Don't match my photos". Then the card itself, lifted out of /app.js.
// Run after `npm run build`:  node scripts/verify/smoke-my-photos.mjs
import { createHmac } from 'node:crypto';
import vm from 'node:vm';
import { talksWorld, checker, ADMIN } from './talks-world.mjs';

const W = await talksWorld({ times: true });
const { db, rows, hit, read, talk } = W;
const { check, done } = checker();
db.exec(read('migrations/0064_event_photos.sql'));
const SPK = JSON.parse(read('src/data/speaker-photos.json'));
const ATT = JSON.parse(read('src/data/attendee-photos.json'));
const sig = (key) => createHmac('sha256', ADMIN).update('photos:' + key).digest('hex').slice(0, 32);
const cookie = (id) => { const exp = Math.floor(Date.now() / 1000) + 3600; const b = `${id}.${exp}`; return 'bai_session=' + b + '.' + createHmac('sha256', 'talks-session').update(b).digest('hex'); };
const mine = (id) => hit('GET', '/api/my-photos', undefined, { Cookie: cookie(id) });

// Every photo of the albums used here is in the store (event_photos), as in production.
let n = 0;
const stored = new Map();
const store = (ids) => { for (const d of ids) if (!stored.has(d)) { const pid = ('P' + String(++n).padStart(11, '0')); stored.set(d, pid); db.run("INSERT INTO event_photos (event_id, pid, drive_id, title, day, taken_at, camera, hall, width, height, bytes, raw) VALUES (1, ?, ?, ?, '2026-11-20', '', 'D1 Cam 1', '', 6000, 4000, 4, 0)", [pid, d, d + '.JPG']); } };
const addAtt = (id, email, extra = {}) => db.run('INSERT INTO attendees (id, event_id, name, email, company, avatar_url, main_event) VALUES (?, ?, ?, ?, ?, ?, ?)',
  [id, extra.event ?? 1, 'Person ' + id, email, 'Example Co', extra.photo ?? '', extra.main ?? 1]);

// The attendee albums: one ordinary, one who opted out.
const albums = Object.entries(ATT.albums).filter(([, v]) => v.photos.length >= 6).map(([k, v]) => ({ key: k, id: Number(k.slice(1)), ...v }));
const [A, O] = albums;
store(A.photos); store(O.photos);
addAtt(A.id, 'att.a@example.com', { photo: 'https://example.com/a.jpg' });
addAtt(O.id, 'att.o@example.com');
// A speaker, an Innovation Talk speaker (their own email), a talk found only by the booth
// contact (must not count), and a named guest; each signs in as an attendee row of their own.
const S = SPK.people.find(p => p.speakers.length && p.photos.length >= 6);
const T = SPK.people.find(p => p.talks.length && !p.speakers.length && p.photos.length >= 3 && talk('id = ?', p.talks[0]));
const TB = SPK.people.find(p => p.talks.length && !p.speakers.length && p !== T && p.photos.length >= 3 && talk('id = ?', p.talks[0]));
const G = SPK.people.find(p => p.guest && p.guest.email && p.photos.length >= 3);
for (const p of [S, T, TB, G]) store(p.photos);
const free = (k) => { let id = 90000 + k; while (ATT.albums['a' + id]) id++; return id; };
db.run("INSERT INTO speakers (id, event_id, slug, name, role, organisation, email, is_published) VALUES (?, 1, 'sp-test', ?, 'Founder', 'Example Co', 'Speaker.One@Example.com', 1)", [S.speakers[0], S.name]);
addAtt(free(1), 'speaker.one@example.com');
db.run('UPDATE innovation_talks SET speaker_email = ? WHERE id = ?', ['talk.own@example.com', T.talks[0]]);
addAtt(free(2), 'talk.own@example.com');
const tb = talk('id = ?', TB.talks[0]);
db.run("UPDATE innovation_talks SET speaker_email = '' WHERE id = ?", [tb.id]);
db.run("INSERT INTO exhibitors (event_id, company_name, contact_email) VALUES (1, ?, 'booth.contact@example.com')", [tb.company]);
addAtt(free(3), 'booth.contact@example.com');
addAtt(free(4), String(G.guest.email).toUpperCase());
// Nobody found: with and without a photo in the app; another event; a campus panel only.
addAtt(free(5), 'nobody@example.com');
addAtt(free(6), 'nobody.photo@example.com', { photo: 'https://example.com/n.jpg' });
addAtt(free(7), 'delhi@example.com', { event: 2 });
addAtt(free(8), 'panel@example.com', { main: 0 });

// ---- who is asking ----
let r = await hit('GET', '/api/my-photos');
check('signed out: refused, no card', r.status === 401 && r.json?.state === 'none', r.status);
r = await hit('GET', '/api/my-photos', undefined, { Cookie: cookie(A.id).replace(/.$/, c => (c === 'a' ? 'b' : 'a')) });
check('a forged session: refused', r.status === 401, r.status);

// ---- an attendee's own album ----
r = await mine(A.id);
const page = `https://bharataiinnovation.com/photos/${A.key}?k=${sig(A.key)}`;
check('an attendee: found, every photo counted, their own signed page', r.status === 200 && r.json?.state === 'found' && r.json.count === A.photos.length && r.json.url === page, JSON.stringify(r.json).slice(0, 300));
const th = r.json?.thumbs || [];
check('four small photos, signed for their album, best first, never the full size',
  th.length === 4 && th.every(t => /\/photo\/P\d{11}\/s\.jpg\?u=/.test(t.s) && t.s.includes('u=' + A.key) && !/\/o\.jpg/.test(t.s))
  && th[0].s.includes('/photo/' + stored.get(A.best[0]) + '/'), JSON.stringify(th[0]));
check('each small photo keeps their face in view', th.every(t => Number.isFinite(t.x) && Number.isFinite(t.y)), JSON.stringify(th.map(t => [t.x, t.y])));
const pg = await W.fetchRaw(new Request(page));
check('the link opens their photos page', pg.status === 200, pg.status);
// "Not me" on one photo and the organiser hiding another: the count follows the page.
db.run("INSERT INTO admin_audit (action, entity, entity_id, detail) VALUES ('photos.not_me', 'photo_album', ?, ?)", [A.key, JSON.stringify({ photo: A.photos[1] })]);
db.run('UPDATE event_photos SET hidden = 1 WHERE drive_id = ?', [A.photos[2]]);
r = await mine(A.id);
check('"Not me" and a hidden photo are not counted or shown', r.json?.count === A.photos.length - 2 && !(r.json.thumbs || []).some(t => t.s.includes('/' + stored.get(A.photos[1]) + '/') || t.s.includes('/' + stored.get(A.photos[2]) + '/')), r.json?.count);
db.run("INSERT INTO admin_audit (action, entity, entity_id, detail) VALUES ('photos.opt_out', 'photo_album', ?, '{}')", [O.key]);
r = await mine(O.id);
check('"Don\'t match my photos": no card', r.status === 200 && r.json?.state === 'optedout', JSON.stringify(r.json));

// ---- speaker side ----
r = await mine(free(1));
check('a speaker (email in any case): their speaker album', r.json?.state === 'found' && r.json.url === `https://bharataiinnovation.com/photos/${S.key}?k=${sig(S.key)}` && r.json.count === S.photos.length, JSON.stringify(r.json).slice(0, 200));
r = await mine(free(2));
check('an Innovation Talk speaker by their own email: their talk album', r.json?.state === 'found' && r.json.url.includes('/photos/' + T.key + '?'), JSON.stringify(r.json).slice(0, 200));
r = await mine(free(3));
check('the booth contact of a talk is NOT given the speaker\'s photos', r.json?.state === 'notfound', JSON.stringify(r.json).slice(0, 200));
db.run('UPDATE innovation_talks SET speaker_email = ? WHERE id = ?', ['booth.contact@example.com', tb.id]);
r = await mine(free(3));
check('(control) the same address as the talk\'s own speaker email does find that album', r.json?.state === 'found' && r.json.url.includes('/photos/' + TB.key + '?'), JSON.stringify(r.json).slice(0, 200));
db.run("UPDATE innovation_talks SET speaker_email = '' WHERE id = ?", [tb.id]);
r = await mine(free(4));
check('a named guest: their guest album', r.json?.state === 'found' && r.json.url.includes('/photos/' + G.key + '?'), JSON.stringify(r.json).slice(0, 200));

// ---- nobody found, and no card ----
r = await mine(free(5));
check('not found, no photo in the app: asked to add one', r.json?.state === 'notfound' && r.json.photo === false, JSON.stringify(r.json));
r = await mine(free(6));
check('not found, with a photo: asked for a clearer one', r.json?.state === 'notfound' && r.json.photo === true, JSON.stringify(r.json));
r = await mine(free(7));
check('another event (Delhi): no card', r.json?.state === 'none', JSON.stringify(r.json));
r = await mine(free(8));
check('a campus panel only: no card', r.json?.state === 'none', JSON.stringify(r.json));
r = await mine(A.id);
check('never cached', /no-store/.test((await W.fetchRaw(new Request('https://bharataiinnovation.com/api/my-photos', { headers: { Cookie: cookie(A.id) } }))).headers.get('Cache-Control') || ''), '');

// ---- the card, lifted out of the /app.js this build serves ----
const js = (await hit('GET', '/app.js')).text;
const from = js.indexOf('    var myPhotosFor = null'), to = js.indexOf('    function renderPassAndCardCta(');
check('the card code is in /app.js, with no backslash-quote', from > 0 && to > from && !js.slice(from, to).includes("\\'"), from);
const card = { classList: { s: new Set(['hidden']), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); }, contains(c) { return this.s.has(c); } }, innerHTML: '' };
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const safeUrl = (u) => { const v = String(u == null ? '' : u).trim(); const l = v.toLowerCase(); return (l.indexOf('http://') === 0 || l.indexOf('https://') === 0) ? esc(v) : ''; };
let answer = null;
const box = vm.createContext({ Number, String, Date, JSON, console, esc, safeUrl, currentUser: { id: A.id, event_id: 1 }, mumbaiOverInApp: () => true,
  document: { getElementById: (id) => (id === 'my-photos-card' ? card : null) },
  fetch: async () => ({ ok: true, json: async () => answer }) });
vm.runInContext(js.slice(from, to), box);
const settle = () => new Promise(ok => setTimeout(ok, 20));
answer = (await mine(A.id)).json;
box.renderMyPhotosCard(); await settle();
check('found: the card shows, with the count, four photos and "See all my photos" to their page', !card.classList.contains('hidden') && card.innerHTML.includes((A.photos.length - 2) + ' photos of you')
  && (card.innerHTML.match(/<img /g) || []).length === 4 && card.innerHTML.includes('See all my photos') && card.innerHTML.includes(esc(page)), card.innerHTML.slice(0, 300));
check('buttons are at least 44px tall for a thumb, white words on saffron', /min-height:48px;background:#C84F00;color:#fff;/.test(card.innerHTML) && !/text-white/.test(card.innerHTML), '');
box.drawMyPhotosCard({ state: 'found', count: 1, url: 'javascript:alert(1)', thumbs: [{ s: 'javascript:alert(2)', x: 1, y: 1 }] });
check('a link that is not http(s) is never drawn', !card.innerHTML.includes('javascript:') && card.innerHTML.includes('1 photo of you'), card.innerHTML.slice(0, 200));
box.drawMyPhotosCard({ state: 'notfound', photo: false });
check('not found: asks for a photo, the photo picker button', !card.classList.contains('hidden') && card.innerHTML.includes('Are you in the event photos?') && card.innerHTML.includes('addProfilePhotoFromCard()') && card.innerHTML.includes('Add my photo'), card.innerHTML.slice(0, 200));
box.drawMyPhotosCard({ state: 'notfound', photo: true });
check('not found with a photo: Change my photo', card.innerHTML.includes('changeMyPhoto()') && card.innerHTML.includes('Change my photo'), '');
for (const st of ['optedout', 'none']) { box.drawMyPhotosCard({ state: st }); check(st + ': no card', card.classList.contains('hidden') && card.innerHTML === '', card.innerHTML); }
box.currentUser = null; box.renderMyPhotosCard();
check('signed out: the card hides', card.classList.contains('hidden'), '');
box.currentUser = { id: free(7), event_id: 2 }; box.renderMyPhotosCard();
check('another event: the card hides without asking', card.classList.contains('hidden'), '');

done();
