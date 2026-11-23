// Built-worker checks for "We found more photos of you" (23 Nov 2026, src/routes/more-photos.ts):
// who is on the list (already sent a photos email, album bigger now), the count against the
// last email, the same address as before, the preview with small photos only, one send and
// its record (so the next run counts from there), opted-out and unsubscribed left out, and a
// booth's email with its dashboard sign-in. Nothing is sent: the mail service is answered here.
// Run after `npm run build`:  node scripts/verify/smoke-more-photos.mjs
import { talksWorld, checker } from './talks-world.mjs';

const { db, rows, sent, hit, as, read, fetchRaw } = await talksWorld({ seedTalks: false });
const { check, done } = checker();
const SP = JSON.parse(read('src/data/speaker-photos.json'));
const ATT = JSON.parse(read('src/data/attendee-photos.json'));
const EXH = JSON.parse(read('src/data/exhibitor-photos.json'));
const LATE = new Set(JSON.parse(read('src/data/late-photos.json')).ids);
const S = SP.people.find(p => p.photos.length >= 8 && p.photos.some(id => LATE.has(id)));
const [AK, A] = Object.entries(ATT.albums).find(([, a]) => a.photos.length >= 4);
const [OK2] = Object.entries(ATT.albums).find(([k, a]) => k !== AK && a.photos.length >= 2);
const [BK, B] = Object.entries(EXH.companies).find(([, c]) => c.photos.length >= 4 && c.ids.length === 1);
check('the data: a list of the late-found photos, and albums that hold some of them', LATE.size > 500 && !!S && SP.people.some(p => p.photos.some(id => LATE.has(id))), LATE.size);

db.exec(read('migrations/0064_event_photos.sql'));
let n = 0;
const store = (drive) => db.run("INSERT OR IGNORE INTO event_photos (event_id, pid, drive_id, title, day, taken_at, camera, hall, width, height, bytes, raw) VALUES (1, ?, ?, ?, '2026-11-20', '', 'Cam 1', '', 6000, 4000, 3, 0)", ['MorePhoto' + String(n).padStart(3, '0'), drive, 'M' + (n++) + '.JPG']);
for (const id of [...S.photos.slice(0, 6), ...S.photos.filter(i => LATE.has(i)).slice(0, 2), ...A.photos.slice(0, 4), ...B.photos]) store(id);
const aid = Number(AK.slice(1)), oid = Number(OK2.slice(1));
db.run("INSERT INTO attendees (id, event_id, name, email, badge_type) VALUES (?, 1, 'Asha Rao', 'asha@example.com', 'Delegate Pass')", [aid]);
db.run("INSERT INTO attendees (id, event_id, name, email, badge_type) VALUES (?, 1, 'Opted Out', 'out@example.com', 'Visitor Pass')", [oid]);
db.run("INSERT INTO exhibitors (id, event_id, company_name, contact_email, booth_number) VALUES (?, 1, ?, 'spoc@ex.test', '21')", [B.ids[0], B.name]);
db.run("INSERT INTO mp_companies (id, company_name, email, password_hash, exhibitor_id) VALUES (8001, ?, 'spoc@ex.test', '', ?)", [B.name, B.ids[0]]);
const audit = (action, entity, key, d) => db.run("INSERT INTO admin_audit (actor, actor_kind, action, entity, entity_id, detail) VALUES ('admin', 'admin', ?, ?, ?, ?)", [action, entity, key, JSON.stringify(d)]);
// What went out earlier today: fewer photos than the albums hold now.
audit('speaker.photos', 'photo_album', S.key, { name: S.name, to: 'speaker@example.com', count: S.photos.length - 3 });
audit('attendee.photos', 'photo_album', AK, { to: 'asha@example.com', count: A.photos.length - 2 });
audit('attendee.photos', 'photo_album', OK2, { to: 'out@example.com', count: 0 });
audit('photos.opt_out', 'photo_album', OK2, { photos: 2 });
audit('booth_photos.sent', 'booth_photos', BK, { to: 'spoc@ex.test', photos: B.photos.length - 1 });

check('the list needs admin', (await hit('GET', '/api/admin/more-photos')).status === 401, '');
let r = await as('GET', '/api/admin/more-photos');
const by = Object.fromEntries((r.json?.rows || []).map(x => [x.key, x]));
check('a speaker: 3 more than their email showed, to the same address', by[S.key]?.status === 'more' && by[S.key].added === 3 && by[S.key].to === 'speaker@example.com' && by[S.key].kind === 'speaker', JSON.stringify(by[S.key]));
check('an attendee: 2 more, by their name from the registration', by[AK]?.status === 'more' && by[AK].added === 2 && by[AK].name === 'Asha Rao', JSON.stringify(by[AK]));
check('someone who said "Don\'t match my photos" is left out', by[OK2]?.status === 'opted-out', JSON.stringify(by[OK2]));
check('a booth: counted from its photos in the store', by[BK]?.status === 'more' && by[BK].added === 1 && by[BK].kind === 'booth', JSON.stringify(by[BK]));
check('nobody who was never sent a photos email is on the list', (r.json?.rows || []).length === 4 && r.json?.ready === 3, (r.json?.rows || []).length);

r = await as('GET', `/api/admin/more-photos/${S.key}/preview`);
const pv = r.json?.html || '';
check('the preview: "We found 3 more photos of you", the new photos first, small size only, nothing sent', r.status === 200 && r.json?.subject === 'We found 3 more photos of you'
  && /\/m\.jpg\?u=/.test(pv) && !/\/o\.jpg/.test(pv) && !/googleusercontent/.test(pv) && sent.length === 0, r.json?.subject);

r = await as('POST', `/api/admin/more-photos/${S.key}/send`, {});
const body = sent[0]?.Content?.Body?.[0]?.Content || '';
check('one send: to the address the first email went to, with their page link', r.status === 200 && sent.length === 1 && JSON.stringify(sent[0].Recipients.To) === '["speaker@example.com"]' && /\/photos\/[stg]\d+\?k=[0-9a-f]{32}/.test(body), r.status + ' ' + JSON.stringify(r.json));
const rec = rows("SELECT entity_id, detail FROM admin_audit WHERE action = 'photos.more'");
check('the send is recorded with the new count', rec.length === 1 && rec[0].entity_id === S.key && JSON.parse(rec[0].detail).count === S.photos.length, JSON.stringify(rec));
r = await as('GET', '/api/admin/more-photos');
check('so the next run counts from there: nothing new for them now', (r.json?.rows || []).find(x => x.key === S.key)?.status === 'same', '');
r = await as('POST', `/api/admin/more-photos/${S.key}/send`, {});
check('sending again with nothing new is refused, nothing sent', r.status === 409 && r.json?.already === true && sent.length === 1, r.status);
r = await as('POST', `/api/admin/more-photos/${OK2}/send`, {});
check('the opted-out person cannot be sent it', r.status === 409 && sent.length === 1, r.status);

r = await as('POST', `/api/admin/more-photos/${BK}/send`, {});
const bb = sent[1]?.Content?.Body?.[0]?.Content || '';
const link = (bb.match(/https:\/\/[^"]*\/marketplace\/signin\?t=[^"]+/) || [''])[0].replace(/&amp;/g, '&');
check('a booth: "We found 1 more photo of <company>" to the booth contact', r.status === 200 && JSON.stringify(sent[1]?.Recipients?.To) === '["spoc@ex.test"]' && bb.includes('1 more photo</strong>'), r.status + ' ' + JSON.stringify(r.json));
const go = link ? await fetchRaw(new Request(link, { redirect: 'manual' })) : null;
check('...whose button signs them in at Booth photos', go && go.status === 302 && go.headers.get('location') === '/marketplace/dashboard#photos', go ? go.status + ' ' + go.headers.get('location') : 'no link');
done();
