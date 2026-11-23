// Built-worker checks for the event photos in R2 (23 Nov 2026, src/routes/photo-store.ts,
// migration 0064) on the talks world (real SQLite, the production schema) with a bucket
// kept in memory: a photo opens only with a link signed for that person, that photo and
// that size; a hidden or missing photo is gone; saving full size is recorded with no limit
// (the organiser, 23 Nov 2026: "dont limit"), saving one again adds to its times, one
// person's saves are not another's; the organiser's summary, list, hide and "best of".
// (Save all / save chosen as a ZIP is checked through the album page: smoke-speaker-photos.mjs.)
// Run after `npm run build`:  node scripts/verify/smoke-photo-store.mjs
import { createHmac } from 'node:crypto';
import { talksWorld, checker, ADMIN } from './talks-world.mjs';

const { check, done } = checker();
const W = await talksWorld({ seedTalks: false });
const { db, rows, hit, as, env, read } = W;
db.exec(read('migrations/0064_event_photos.sql'));

// The bucket: key -> bytes.
const store = new Map();
env.UPLOADS = {
  async get(key) {
    const b = store.get(key);
    if (!b) return null;
    return { body: new Response(b).body, size: b.length, httpEtag: '"e-' + key.length + '"', writeHttpMetadata() {} };
  },
};
const day = Math.floor(Date.now() / 86400000);
const sig = (pid, part, person, exp) => createHmac('sha256', ADMIN).update(`photo:${pid}:${part}:${person}:${exp}`).digest('hex').slice(0, 32);
const link = (pid, part, person, exp = day + 120, k) => `/photo/${pid}/${part}.jpg?u=${encodeURIComponent(person)}&e=${exp}&k=${k ?? sig(pid, part, person, exp)}`;
const get = (path) => W.fetchRaw(new Request('https://bharataiinnovation.com' + path));

// 20 photos, every size in the bucket, except photo 19's original.
const pids = Array.from({ length: 20 }, (_, i) => ('P' + String(i).padStart(2, '0') + 'abcdefghij').slice(0, 12));
pids.forEach((pid, i) => {
  db.run('INSERT INTO event_photos (event_id, pid, drive_id, title, day, taken_at, camera, hall, width, height, bytes, raw) VALUES (1, ?, ?, ?, ?, ?, ?, ?, 6000, 4000, 4, 0)',
    [pid, 'drive' + i, i === 3 ? '126A1503.CR3' : `885A53${String(i).padStart(2, '0')}.JPG`, i < 10 ? '2026-11-20' : '2026-11-21', '2026-11-20T05:0' + (i % 10) + ':00Z', 'D1 Centrum', '']);
  for (const part of ['s', 'm', 'o']) if (!(i === 19 && part === 'o')) store.set(`event-photos/1/${pid}/${part}.jpg`, new Uint8Array([0xff, 0xd8, part.charCodeAt(0), i]));
});
const id = (pid) => rows('SELECT id FROM event_photos WHERE pid = ?', [pid])[0].id;
const saved = (person) => rows('SELECT COUNT(*) AS n FROM photo_downloads WHERE person = ?', [person])[0].n;

// ---- looking: small and medium ----
let r = await get(link(pids[0], 's', 'a7'));
let bytes = new Uint8Array(await r.arrayBuffer());
check('a small photo opens with its signed link, as a JPEG', r.status === 200 && r.headers.get('Content-Type') === 'image/jpeg' && bytes[2] === 's'.charCodeAt(0), r.status);
check('it is noindex and kept out of shared caches', /noindex/.test(r.headers.get('X-Robots-Tag') || '') && /^private/.test(r.headers.get('Cache-Control') || ''), r.headers.get('Cache-Control'));
r = await get(link(pids[0], 'm', 'a7'));
check('the medium photo opens with its own link', r.status === 200 && new Uint8Array(await r.arrayBuffer())[2] === 'm'.charCodeAt(0), r.status);
check('looking is never counted', saved('a7') === 0, saved('a7'));

r = await get(link(pids[0], 's', 'a8', day + 120, sig(pids[0], 's', 'a7', day + 120)));
check("someone else's link does not open for another person (the signature names the person)", r.status === 403, r.status);
r = await get(link(pids[1], 's', 'a7', day + 120, sig(pids[0], 's', 'a7', day + 120)));
check('a link for one photo does not open another photo', r.status === 403, r.status);
r = await get(link(pids[0], 'o', 'a7', day + 120, sig(pids[0], 's', 'a7', day + 120)));
check('a small-photo link cannot be turned into a full-size download', r.status === 403 && /not complete/.test(await r.text()), r.status);
r = await get(link(pids[0], 's', 'a7', day + 120, sig(pids[0], 's', 'a7', day + 120).replace(/^./, ch => (ch === 'a' ? 'b' : 'a'))));
check('a changed signature is refused', r.status === 403, r.status);
r = await get(`/photo/${pids[0]}/s.jpg`);
check('a link with nothing signed is refused', r.status === 404, r.status);
r = await get(link('short', 's', 'a7'));
check('a made-up photo id is refused', r.status === 404, r.status);
r = await get(link(pids[0], 's', 'a7', day - 1));
check('an expired link says so (410)', r.status === 410, r.status);
r = await get(link(pids[0], 'o', 'a7', day - 1));
check('an expired full-size link explains it in words', r.status === 410 && /expired/.test(await r.text()), r.status);

// ---- saving full size: recorded, never limited ----
r = await get(link(pids[0], 'o', 'a7'));
bytes = new Uint8Array(await r.arrayBuffer());
check('the original downloads as an attachment with a clear file name', r.status === 200 && bytes[2] === 'o'.charCodeAt(0) && /attachment; filename="BharatAI-Mumbai-2026-885A5300\.jpg"/.test(r.headers.get('Content-Disposition') || ''), r.headers.get('Content-Disposition'));
check('a full-size save is never cached', /no-store/.test(r.headers.get('Cache-Control') || ''));
check('the save is recorded once', saved('a7') === 1, saved('a7'));
r = await get(link(pids[3], 'o', 'a7'));
check("a RAW photo's file is named .jpg (R2 holds Drive's JPEG of it)", r.status === 200 && /126A1503\.jpg"/.test(r.headers.get('Content-Disposition') || ''), r.headers.get('Content-Disposition'));
r = await get(link(pids[0], 'o', 'a7'));
const again = rows('SELECT times FROM photo_downloads WHERE person = ? AND photo_id = ?', ['a7', id(pids[0])])[0];
check('saving the same photo again adds to its times (still 2 photos, that one twice)', r.status === 200 && saved('a7') === 2 && again.times === 2, { n: saved('a7'), again });

let okAll = true;
for (let i = 4; i <= 18; i++) { const x = await get(link(pids[i], 'o', 'a7')); okAll = okAll && x.status === 200 && /attachment/.test(x.headers.get('Content-Disposition') || ''); }
check('an attendee saves every one of their photos: 17 different, no limit (it was 15)', okAll && saved('a7') === 17, saved('a7'));
r = await get(link(pids[17], 'o', 'a8'));
check("another person's saves are their own", r.status === 200 && saved('a8') === 1, { status: r.status, n: saved('a8') });

r = await get(link(pids[19], 'o', 'a9'));
check('a photo whose original is missing from the bucket is gone, and not recorded', r.status === 404 && saved('a9') === 0, { status: r.status, n: saved('a9') });

// ---- the organiser ----
r = await as('POST', '/api/admin/event-photos/settings', { download_limit: 20 });
check('there is no save limit left to set', r.status === 404, r.status);

r = await as('POST', `/api/admin/event-photos/${pids[2]}`, { hidden: true });
check('the organiser hides a photo', r.status === 200 && rows('SELECT hidden FROM event_photos WHERE pid = ?', [pids[2]])[0].hidden === 1, r.json);
r = await get(link(pids[2], 's', 'a7'));
check('every link to a hidden photo stops working', r.status === 404, r.status);
r = await get(link(pids[2], 'o', 'a10'));
check('...its full-size save too, and that is not recorded', r.status === 404 && saved('a10') === 0, r.status);
await as('POST', `/api/admin/event-photos/${pids[2]}`, { hidden: false, highlight: true });
r = await get(link(pids[2], 's', 'a7'));
check('shown again, the same link works; it is in the "best of" set', r.status === 200 && rows('SELECT highlight FROM event_photos WHERE pid = ?', [pids[2]])[0].highlight === 1, r.status);
r = await as('POST', '/api/admin/event-photos/NoSuchPhoto1', { hidden: true });
check('hiding a photo that does not exist says so', r.status === 404, r.status);
r = await as('POST', `/api/admin/event-photos/${pids[2]}`, {});
check('a change that says nothing is refused', r.status === 400, r.status);

r = await as('GET', '/api/admin/event-photos/list?day=2026-11-21&size=5');
check('the organiser pages through one day', r.status === 200 && r.json.total === 10 && r.json.photos.length === 5 && r.json.photos.every(p => p.day === '2026-11-21'), r.json && r.json.total);
const p0 = r.json.photos[0];
check('each photo in the list carries links signed for the organiser, and its size', /[?&]u=admin&/.test(p0.s) && /[?&]u=admin&/.test(p0.o) && p0.bytes === 4, p0.bytes);
r = await get(p0.o.replace('https://bharataiinnovation.com', ''));
check("the organiser's own full-size saves are never recorded", r.status === 200 && saved('admin') === 0, { status: r.status, n: saved('admin') });

// ---- a speaker's album (routes/photos.ts keys 's<speaker id>' / 't<talk id>'): no limit either ----
const more = Array.from({ length: 60 }, (_, i) => ('S' + String(i).padStart(2, '0') + 'speakerabcd').slice(0, 12));
more.forEach((pid, i) => {
  db.run('INSERT INTO event_photos (event_id, pid, drive_id, title, day, taken_at, camera, hall, width, height, bytes, raw) VALUES (1, ?, ?, ?, ?, ?, ?, ?, 6000, 4000, 4, 0)',
    [pid, 'sdrive' + i, `SP${i}.JPG`, '2026-11-21', '2026-11-21T05:00:00Z', 'Cam 1', '']);
  store.set(`event-photos/1/${pid}/o.jpg`, new Uint8Array([0xff, 0xd8, 0x6f, i]));
});
okAll = true;
for (let i = 0; i < 60; i++) { const x = await get(link(more[i], 'o', 's123')); okAll = okAll && x.status === 200; }
check("a speaker's album saves all 60 different photos (it stopped at 50)", okAll && saved('s123') === 60, saved('s123'));
r = await get(link(more[0], 'o', 't45'));
check("an Innovation Talk speaker's album ('t<id>') has its own record", r.status === 200 && saved('t45') === 1, { status: r.status, n: saved('t45') });

r = await as('GET', '/api/admin/event-photos');
check('the summary counts photos by day and the saves, speakers apart', r.status === 200 && r.json.days.length === 2 && r.json.days[0].photos === 10
  && r.json.downloads.people === 4 && r.json.downloads.photos === 17 + 1 + 60 + 1 && r.json.downloads.speakers.people === 2 && r.json.downloads.speakers.photos === 61
  && !('limit' in r.json), r.json && r.json.downloads);
r = await hit('GET', '/api/admin/event-photos');
check('the summary is for admins only', r.status === 401 || r.status === 403, r.status);

// ---- a database without migration 0064 ----
const W2 = await talksWorld({ seedTalks: false });
W2.env.UPLOADS = env.UPLOADS;
r = await W2.as('GET', '/api/admin/event-photos');
check('without the photo tables the summary says which migration is missing', r.status === 503 && /0064/.test(r.json.error), r.json);
r = await W2.fetchRaw(new Request('https://bharataiinnovation.com' + link(pids[0], 's', 'a7')));
check('without the photo tables a link is simply gone, not an error', r.status === 404, r.status);

done();
