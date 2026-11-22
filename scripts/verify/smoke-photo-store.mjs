// Built-worker checks for the event photos in R2 (23 Nov 2026, src/routes/photo-store.ts,
// migration 0064) on the talks world (real SQLite, the production schema) with a bucket
// kept in memory: a photo opens only with a link signed for that person, that photo and
// that size; a hidden or missing photo is gone; saving full size is counted, at most the
// limit of different photos, saving one again is free, one person's count is not
// another's; the organiser's limit, summary, list, hide and "best of".
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
  db.run('INSERT INTO event_photos (event_id, pid, drive_id, title, day, taken_at, camera, hall, width, height, bytes, raw) VALUES (1, ?, ?, ?, ?, ?, ?, ?, 6000, 4000, 9, 0)',
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

// ---- saving full size ----
r = await get(link(pids[0], 'o', 'a7'));
bytes = new Uint8Array(await r.arrayBuffer());
check('the original downloads as an attachment with a clear file name', r.status === 200 && bytes[2] === 'o'.charCodeAt(0) && /attachment; filename="BharatAI-Mumbai-2026-885A5300\.jpg"/.test(r.headers.get('Content-Disposition') || ''), r.headers.get('Content-Disposition'));
check('a full-size save is never cached', /no-store/.test(r.headers.get('Cache-Control') || ''));
check('the save is counted once', saved('a7') === 1, saved('a7'));
r = await get(link(pids[3], 'o', 'a7'));
check("a RAW photo's file is named .jpg (R2 holds Drive's JPEG of it)", r.status === 200 && /126A1503\.jpg"/.test(r.headers.get('Content-Disposition') || ''), r.headers.get('Content-Disposition'));
r = await get(link(pids[0], 'o', 'a7'));
const again = rows('SELECT times FROM photo_downloads WHERE person = ? AND photo_id = ?', ['a7', id(pids[0])])[0];
check('saving the same photo again is free (still 2 photos, that one twice)', r.status === 200 && saved('a7') === 2 && again.times === 2, { n: saved('a7'), again });

for (let i = 4; i <= 16; i++) await get(link(pids[i], 'o', 'a7'));
check('15 different photos saved', saved('a7') === 15, saved('a7'));
r = await get(link(pids[17], 'o', 'a7'));
let text = await r.text();
check('the 16th different photo is refused with a page that says why (429)', r.status === 429 && /You have saved 15 photos/.test(text) && /share them/.test(text), r.status);
check('the refused one is not counted', saved('a7') === 15 && !rows('SELECT 1 FROM photo_downloads WHERE person = ? AND photo_id = ?', ['a7', id(pids[17])]).length);
r = await get(link(pids[5], 'o', 'a7'));
check('a photo already saved can still be saved again at the limit', r.status === 200, r.status);
r = await get(link(pids[17], 's', 'a7'));
check('at the limit, looking at every photo still works', r.status === 200, r.status);
r = await get(link(pids[17], 'o', 'a8'));
check("another person's count is their own", r.status === 200 && saved('a8') === 1, { status: r.status, n: saved('a8') });

r = await get(link(pids[19], 'o', 'a9'));
check('a photo whose original is missing from the bucket is gone, and not counted', r.status === 404 && saved('a9') === 0, { status: r.status, n: saved('a9') });

// ---- the organiser ----
r = await hit('POST', '/api/admin/event-photos/settings', { download_limit: 20 });
check('the limit cannot be changed without signing in as admin', r.status === 401 || r.status === 403, r.status);
r = await as('POST', '/api/admin/event-photos/settings', { download_limit: -1 });
check('a limit that is not a whole number from 0 to 500 is refused', r.status === 400, r.status);
r = await as('POST', '/api/admin/event-photos/settings', { download_limit: 20 });
check('the organiser raises the limit to 20', r.status === 200 && r.json.limit === 20, r.json);
r = await get(link(pids[17], 'o', 'a7'));
check('with the limit at 20, the 16th photo saves', r.status === 200 && saved('a7') === 16, { status: r.status, n: saved('a7') });
await as('POST', '/api/admin/event-photos/settings', { download_limit: 0 });
r = await get(link(pids[18], 'o', 'a10'));
check('a limit of 0 stops every new full-size save', r.status === 429, r.status);
await as('POST', '/api/admin/event-photos/settings', { download_limit: 15 });

r = await as('POST', `/api/admin/event-photos/${pids[2]}`, { hidden: true });
check('the organiser hides a photo', r.status === 200 && rows('SELECT hidden FROM event_photos WHERE pid = ?', [pids[2]])[0].hidden === 1, r.json);
r = await get(link(pids[2], 's', 'a7'));
check('every link to a hidden photo stops working', r.status === 404, r.status);
await as('POST', `/api/admin/event-photos/${pids[2]}`, { hidden: false, highlight: true });
r = await get(link(pids[2], 's', 'a7'));
check('shown again, the same link works; it is in the "best of" set', r.status === 200 && rows('SELECT highlight FROM event_photos WHERE pid = ?', [pids[2]])[0].highlight === 1, r.status);
r = await as('POST', '/api/admin/event-photos/NoSuchPhoto1', { hidden: true });
check('hiding a photo that does not exist says so', r.status === 404, r.status);
r = await as('POST', `/api/admin/event-photos/${pids[2]}`, {});
check('a change that says nothing is refused', r.status === 400, r.status);

r = await as('GET', '/api/admin/event-photos');
check('the summary counts photos by day and the saves', r.status === 200 && r.json.days.length === 2 && r.json.days[0].photos === 10 && r.json.limit === 15 && r.json.downloads.people === 2 && r.json.downloads.photos === 17, r.json);
r = await hit('GET', '/api/admin/event-photos');
check('the summary is for admins only', r.status === 401 || r.status === 403, r.status);
r = await as('GET', '/api/admin/event-photos/list?day=2026-11-21&size=5');
check('the organiser pages through one day', r.status === 200 && r.json.total === 10 && r.json.photos.length === 5 && r.json.photos.every(p => p.day === '2026-11-21'), r.json && r.json.total);
const p0 = r.json.photos[0];
check('each photo in the list carries links signed for the organiser', /[?&]u=admin&/.test(p0.s) && /[?&]u=admin&/.test(p0.o));
r = await get(p0.o.replace('https://bharataiinnovation.com', ''));
check("the organiser's own full-size saves are never counted", r.status === 200 && saved('admin') === 0, { status: r.status, n: saved('admin') });

// ---- a database without migration 0064 ----
const W2 = await talksWorld({ seedTalks: false });
W2.env.UPLOADS = env.UPLOADS;
r = await W2.as('GET', '/api/admin/event-photos');
check('without the photo tables the summary says which migration is missing', r.status === 503 && /0064/.test(r.json.error), r.json);
r = await W2.fetchRaw(new Request('https://bharataiinnovation.com' + link(pids[0], 's', 'a7')));
check('without the photo tables a link is simply gone, not an error', r.status === 404, r.status);

done();
