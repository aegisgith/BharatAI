// Built-worker checks for the speaker photos (23 Nov 2026, src/routes/photos.ts) on the
// talks world (real SQLite, the production schema): a photo page opens only with its
// signed link and is noindex, its script parses, a RAW photo downloads as Drive's JPEG;
// Admin -> After the Event's list, a preview that sends nothing, a send with its audit
// row, "already sent" refused unless sent again on purpose, an official held back, no
// email. Nothing is sent: the mail service is answered here.
// Run after `npm run build`:  node scripts/verify/smoke-speaker-photos.mjs
import { createHmac } from 'node:crypto';
import { talksWorld, checker, ADMIN } from './talks-world.mjs';

const W = await talksWorld({ times: true });
const { db, rows, sent, hit, as, fetchRaw, read, env } = W;
const { check, done } = checker();
const DATA = JSON.parse(read('src/data/speaker-photos.json'));
const sig = (key) => createHmac('sha256', ADMIN).update('photos:' + key).digest('hex').slice(0, 32);

const withSp = DATA.people.filter(p => p.speakers.length && p.photos.length >= 3 && !p.check);
const weak = DATA.people.find(p => p.speakers.length && p.photos.length && p.check);
check('the data file has people with photos, each with a few best ones for the email', withSp.length >= 2 && withSp.every(p => p.best.length >= 1 && p.best.every(id => p.photos.includes(id))), `${DATA.people.length} people`);
const [A, B] = withSp;
// Put A and B on the programme (the world has no conference speakers of its own).
const addSpeaker = (p, email, role = 'Founder') => db.run('INSERT INTO speakers (id, event_id, slug, name, role, organisation, email, is_published) VALUES (?, 1, ?, ?, ?, ?, ?, 1)',
  [p.speakers[0], 'sp-' + p.speakers[0], p.name, role, 'Example Co', email]);
addSpeaker(A, 'a.speaker@example.com');
addSpeaker(B, '');

// ---- the page ----
const page = (key, k) => fetchRaw(new Request(`https://bharataiinnovation.com/photos/${key}` + (k === undefined ? '' : `?k=${k}`)));
let r = await page(A.key);
check('the page without its signature is refused, noindex', r.status === 404 && /noindex/.test(r.headers.get('X-Robots-Tag') || ''), r.status);
r = await page(A.key, sig(A.key).replace(/^./, c => (c === 'a' ? 'b' : 'a')));
check('a wrong signature is refused', r.status === 404, r.status);
r = await page(A.key, sig(A.key));
const html = await r.text();
check('the signed page opens, noindex, with their name and every photo', r.status === 200 && /noindex/.test(r.headers.get('X-Robots-Tag') || '') && html.includes('Photos of ' + A.name.replace(/&/g, '&amp;'))
  && A.photos.every(id => html.includes(id)), r.status);
const focused = A.focus ? Object.entries(A.focus)[0] : null;
check('the square thumbnails keep their face in view', !!focused && html.includes(`style="object-position:${focused[1][0]}% ${focused[1][1]}%"`), focused);
const scripts = [...html.matchAll(/<script(?![^>]*application\/json)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
let parses = true; try { scripts.forEach(s => new Function(s)); } catch (e) { parses = String(e); }
check('the page script parses', scripts.length === 1 && parses === true, parses);
const ids = JSON.parse((html.match(/<script type="application\/json" id="ids">([\s\S]*?)<\/script>/) || [])[1] || '[]');
check('each photo carries its download link (Drive download for a JPG)', ids.length === A.photos.length && ids.every(x => /^https:\/\/(drive\.google\.com\/uc\?export=download&id=|lh3\.googleusercontent\.com\/d\/[^=]+=s0$)/.test(x[1])), ids[0]);
const raw = Object.entries(DATA.photos).find(([, m]) => m[3]);
if (raw) {
  const holder = DATA.people.find(p => p.photos.includes(raw[0]));
  const rp = holder ? await (await page(holder.key, sig(holder.key))).text() : '';
  check('a camera RAW photo downloads as Drive\'s full-size JPEG, not the .CR3', !holder || rp.includes(`https://lh3.googleusercontent.com/d/${raw[0]}=s0`), holder && holder.name);
}
r = await page(B.speakers.length ? 's' + B.speakers[0] : B.key, sig(B.key));
check('the same person by another key needs that key\'s own signature', B.key === 's' + B.speakers[0] ? true : r.status === 404, r.status);

// ---- the admin list ----
check('without admin the list is refused', (await hit('GET', '/api/admin/speaker-photos')).status === 401, '');
let l = await as('GET', '/api/admin/speaker-photos');
const row = (key) => (l.json?.rows || []).find(x => x.key === key);
check('the list: A ready with their email, B with no email', l.status === 200 && row(A.key)?.status === 'ready' && row(A.key)?.email === 'a.speaker@example.com' && row(B.key)?.status === 'no-email', JSON.stringify(l.json?.counts));
check('each row has its count, small pictures and a signed page link', row(A.key)?.count === A.photos.length && row(A.key)?.thumbs?.length >= 1 && row(A.key)?.page?.endsWith('?k=' + sig(A.key)), JSON.stringify(row(A.key)).slice(0, 300));
const talksRows = (l.json?.rows || []).filter(x => (x.kinds || []).includes('Innovation Talk'));
check('Innovation Talk speakers are on the list too', talksRows.length >= 10, talksRows.length);

// ---- preview and send ----
let p = await as('GET', `/api/admin/speaker-photos/${A.key}/preview`);
check('a preview: subject, whole photos (not cropped), the page link, nothing sent', p.status === 200 && p.json?.subject === 'Your photos from Bharat AI Innovation 2026' && p.json?.html.includes('=w560') && !p.json?.html.includes('-c"')
  && p.json?.html.includes(`/photos/${A.key}?k=${sig(A.key)}`) && p.json?.html.includes('See and download all') && sent.length === 0, p.status);
let s = await as('POST', `/api/admin/speaker-photos/${A.key}/send`, {});
const mail = sent[0];
check('send: one email to them, with the photos and their page', s.status === 200 && sent.length === 1 && JSON.stringify(mail?.Recipients?.To) === JSON.stringify(['a.speaker@example.com'])
  && mail?.Content?.Body?.[0]?.Content.includes(`/photos/${A.key}?k=${sig(A.key)}`), s.status + ' ' + JSON.stringify(s.json));
const au = rows("SELECT entity, entity_id, detail FROM admin_audit WHERE action = 'speaker.photos'");
check('the send is recorded', au.length === 1 && au[0].entity === 'photo_album' && String(au[0].entity_id) === A.key && JSON.parse(au[0].detail).to === 'a.speaker@example.com', JSON.stringify(au));
l = await as('GET', '/api/admin/speaker-photos');
check('the list now says sent', row(A.key)?.status === 'sent' && row(A.key)?.sent_count === 1, row(A.key)?.status);
s = await as('POST', `/api/admin/speaker-photos/${A.key}/send`, {});
check('a second send is refused unless asked for again', s.status === 409 && s.json?.already === true && sent.length === 1, s.status);
s = await as('POST', `/api/admin/speaker-photos/${A.key}/send`, { again: true });
check('sent again on purpose', s.status === 200 && sent.length === 2, s.status);
s = await as('POST', `/api/admin/speaker-photos/${B.key}/send`, {});
check('no email: refused, nothing sent', s.status === 409 && sent.length === 2, s.status);

// ---- a weaker match: looked at before sending, not in "send to all" ----
if (weak) {
  addSpeaker(weak, 'weak.match@example.com');
  l = await as('GET', '/api/admin/speaker-photos');
  check('a weaker match waits for a look ("check"), not "ready"', row(weak.key)?.status === 'check', row(weak.key)?.status);
  const n = sent.length;
  s = await as('POST', `/api/admin/speaker-photos/${weak.key}/send`, {});
  check('...and sends one by one once looked at', s.status === 200 && sent.length === n + 1, s.status);
  db.run("DELETE FROM admin_audit WHERE action = 'speaker.photos' AND entity_id = ?", [weak.key]);
}

// ---- an official ----
db.run("UPDATE speakers SET email = 'office@example.gov.in', role = 'Minister of State, IT' WHERE id = ?", [B.speakers[0]]);
l = await as('GET', '/api/admin/speaker-photos');
check('a minister is held for their office', row(B.key)?.status === 'protocol', row(B.key)?.status);
const before = sent.length;
s = await as('POST', `/api/admin/speaker-photos/${B.key}/send`, {});
check('...and not sent unless "anyway"', s.status === 409 && sent.length === before, s.status);
s = await as('POST', `/api/admin/speaker-photos/${B.key}/send`, { anyway: true });
check('...sent when the organiser says so', s.status === 200 && sent.length === before + 1, s.status);

// ---- our own copies in R2 (routes/photo-store.ts) ----
// Until a photo is in event_photos everything above came from Drive. Now two of A's
// photos are in R2 (one of them in A's email six), the rest still only in Drive.
db.exec(read('migrations/0064_event_photos.sql'));
const store = new Map();
env.UPLOADS = { async get(key) { const b = store.get(key); return b ? { body: new Response(b).body, size: b.length, httpEtag: '"e"', writeHttpMetadata() {} } : null; } };
const inR2 = [A.best[0], ...A.photos.filter(id => id !== A.best[0]).slice(0, 2)];
const pidOf = {};
inR2.forEach((drive, i) => {
  const pid = ('R2pid' + i + 'abcdefghij').slice(0, 12); pidOf[drive] = pid;
  db.run("INSERT INTO event_photos (event_id, pid, drive_id, title, day, taken_at, camera, hall, width, height, bytes, raw) VALUES (1, ?, ?, ?, '2026-11-20', '2026-11-20T05:00:00Z', 'Cam 1', '', 6000, 4000, 9, 0)", [pid, drive, 'IMG' + i + '.JPG']);
  for (const part of ['s', 'm', 'o']) store.set(`event-photos/1/${pid}/${part}.jpg`, new Uint8Array([0xff, 0xd8, i]));
});
const html2 = await (await page(A.key, sig(A.key))).text();
const ids2 = JSON.parse((html2.match(/<script type="application\/json" id="ids">([\s\S]*?)<\/script>/) || [])[1] || '[]');
const r2 = (part, drive) => `/photo/${pidOf[drive]}/${part}.jpg?u=${encodeURIComponent(A.key)}`;
check('the page shows a photo in R2 from our own link, signed for this album', inR2.every(d => html2.includes(r2('s', d))), inR2);
check('...its large view and full-size save are ours too; the rest still come from Drive', inR2.every(d => ids2.some(x => x[0].includes(r2('m', d)) && x[1].includes(r2('o', d))))
  && ids2.filter(x => /lh3\.googleusercontent\.com/.test(x[0])).length === A.photos.length - inR2.length, ids2.slice(0, 2));
check('the page says a speaker may save up to 50', html2.includes('You can save up to 50 of your photos at full size'), (html2.match(/You can save[^.]*\./) || [])[0]);
const pv2 = await as('GET', `/api/admin/speaker-photos/${A.key}/preview`);
check('the email shows its photo in R2 by our small link, and never a full-size link', pv2.json?.html.includes(r2('s', A.best[0])) && !/\/o\.jpg/.test(pv2.json?.html || ''), (pv2.json?.html.match(/\/photo\/[^"]+/) || [])[0]);
l = await as('GET', '/api/admin/speaker-photos');
check('the Admin list shows its small pictures from R2 as the organiser (never counted)', (row(A.key)?.thumbs || []).some(t => t.includes(`/photo/${pidOf[A.best[0]]}/s.jpg?u=admin`)), row(A.key)?.thumbs);
// Saves: a speaker's album has its own limit, not the attendees' 15.
db.run("INSERT INTO app_settings (key, value) VALUES ('photo_download_limit', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value");
const o = (d) => ids2.find(x => x[1].includes(r2('o', d)))[1].replace('https://bharataiinnovation.com', '');
const got1 = await W.fetchRaw(new Request('https://bharataiinnovation.com' + o(inR2[0])));
const got2 = await W.fetchRaw(new Request('https://bharataiinnovation.com' + o(inR2[1])));
check('a speaker saves past the attendees\' limit (set to 1 here): their own 50 applies', got1.status === 200 && got2.status === 200 && /attachment/.test(got2.headers.get('Content-Disposition') || ''), [got1.status, got2.status]);
db.run("INSERT INTO app_settings (key, value) VALUES ('photo_download_limit_speakers', '2')");
const got3 = await W.fetchRaw(new Request('https://bharataiinnovation.com' + o(inR2[2])));
check('...and stops at the speakers\' limit (2 here)', got3.status === 429, got3.status);
const html3 = await (await page(A.key, sig(A.key))).text();
check('the page then says they have saved the most they can', html3.includes('You have saved 2 photos at full size'), (html3.match(/You (have|can) save[^.]*\./) || [])[0]);

done();
