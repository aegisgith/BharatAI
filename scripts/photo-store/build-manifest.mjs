// Event photos -> R2, step 1 (23 Nov 2026): the manifest.
//
// One row per photo in the photographers' Drive folder "Nov 2026_Bharat AI_Mumbai"
// (19Ii5MnQLA2adUxH4LDPikF2GUcvRuOeJ), from the Drive listing the speaker-photos work
// made (index.json: id, title, parentId, modifiedTime, fileSize, mimeType).
//
// Each photo gets a random `pid`. Every link the site gives out carries the pid, never
// the Drive id: the Drive folder is "anyone with the link", so a Drive id would let
// anyone skip the download limit. Re-running keeps every pid already given.
//
// - JPG: time taken = Drive's modifiedTime (the camera's clock), kept in UTC.
// - CR3 (Canon RAW, 114 on Day 1 Cam 4, no JPG twin): kept; R2 stores Drive's full-size
//   JPEG render of it. Its modifiedTime is the upload time, so its time is ''.
// - MP4 (8 clips): left out. Photos only.
// - `camera` is the photographer's folder name, for the organiser's eyes only: some say
//   "Centrum" (a venue room). `hall` is the event hall name when the folder says it.
//
// usage: node scripts/photo-store/build-manifest.mjs <index.json> <out dir>
//        writes <out dir>/manifest.json
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const [INDEX, OUT] = process.argv.slice(2);
if (!INDEX || !OUT) { console.error('usage: build-manifest.mjs <index.json> <out dir>'); process.exit(2); }

// The photographers' folders (Drive ids from the listing), day and camera.
const FOLDERS = {
  '1V0ANjyTnfBQ4TVs8ZDTKi_U-8OudEiJ_': ['2026-11-20', 'D1 Cam 1', ''],
  '1dgfV1_9Aqx1Fkhm2WZDy5KxOVVlGTc0-': ['2026-11-20', 'D1 Cam 2', ''],
  '1OR9Bhb5z0H0xRAcmoCxKUcRMlLzHFQxW': ['2026-11-20', 'D1 Cam 3', ''],
  '1VDUlZkowzad0X6ra09cCTb8E0D-0AWGD': ['2026-11-20', 'D1 Cam 4', ''],
  '1EFh2DitPNGNNtO2JZQ5C4fS70iyMsNHJ': ['2026-11-20', 'D1 Cam 5', ''],
  '15xhVXrZIdPEo-RV5w3_i4vE7d5b9qY58': ['2026-11-20', 'D1 Cam 6', ''],
  '1ifBcPbnczf6-SqECLwpj4pIofTymUbBz': ['2026-11-20', 'D1 Aaryabhatta', 'Aryabhata Theatre'],
  // "Centrum" does not say Hall A (Kalam Theatre) or Hall B (Raman Theatre): no hall.
  '11DBmuc9CbsruhRFV_txuwgeXgtmmUZX6': ['2026-11-20', 'D1 Centrum', ''],
  '1p7m4-kNxNIt2w1nG5MzeT1Td5UmQtljs': ['2026-11-20', 'D1', ''],
  '1J4a_KGkSIZMSvUiXR-q_MuhPxBwSKZ79': ['2026-11-21', 'D2 Cam 1 - Homi', 'Homi J. Bhabha Hall'],
  '1CJvSSGP7c6X-XqNTgbyGDxW_U49DCnR_': ['2026-11-21', 'D2 Cam 2 - Homi', 'Homi J. Bhabha Hall'],
  '1fJtR1QM3McNdNz3WoI5pZsqFlmBxnYMI': ['2026-11-21', 'D2 Cam 3 - Aaryabhatta', 'Aryabhata Theatre'],
  '1nhSIPJVsoOwiglte29AdOtXnFKDdnhQb': ['2026-11-21', 'D2 Cam 4', ''],
  '1qGy6q9VFbJFZf6eW856-S92ktnDJxQik': ['2026-11-21', 'D2 Cam 5', ''],
  '1x-3dnGf--HD03wovnMWwd4jT02tjnml7': ['2026-11-21', 'D2 Cam 6', ''],
  '1qFNmlUNpLR42ow9loldAChOd-IXm0IUt': ['2026-11-21', 'D2', ''],
};
const IST_MS = 330 * 60 * 1000;

const files = JSON.parse(readFileSync(INDEX, 'utf8'));
mkdirSync(OUT, { recursive: true });
const OUTFILE = join(OUT, 'manifest.json');
const old = existsSync(OUTFILE) ? JSON.parse(readFileSync(OUTFILE, 'utf8')) : [];
const pidOf = new Map(old.map(r => [r.drive_id, r.pid]));
const used = new Set(old.map(r => r.pid));
const newPid = () => { let p; do p = randomBytes(9).toString('base64url'); while (used.has(p)); used.add(p); return p; };

const rows = [], skipped = {};
for (const f of files) {
  const raw = f.mimeType === 'image/cr3';
  if (f.mimeType !== 'image/jpeg' && !raw) { skipped[f.mimeType] = (skipped[f.mimeType] || 0) + 1; continue; }
  const folder = FOLDERS[f.parentId];
  if (!folder) { skipped['unknown folder ' + f.parentId] = (skipped['unknown folder ' + f.parentId] || 0) + 1; continue; }
  const [day, camera, hall] = folder;
  let taken = '';
  if (!raw && f.modifiedTime) {
    const t = new Date(f.modifiedTime);
    if (new Date(t.getTime() + IST_MS).toISOString().slice(0, 10) === day) taken = t.toISOString().replace('.000Z', 'Z');
  }
  rows.push({
    pid: pidOf.get(f.id) || newPid(), drive_id: f.id, title: String(f.title || ''), day, taken_at: taken,
    camera, hall, raw: raw ? 1 : 0, drive_bytes: Number(f.fileSize || 0),
  });
}
rows.sort((a, b) => (a.day + (a.taken_at || '~') + a.title).localeCompare(b.day + (b.taken_at || '~') + b.title));
writeFileSync(OUTFILE, JSON.stringify(rows, null, 1));
const by = {};
for (const r of rows) by[r.camera] = (by[r.camera] || 0) + 1;
console.log(`${rows.length} photos -> ${OUTFILE}  (${rows.filter(r => r.raw).length} RAW, ${rows.filter(r => !r.taken_at).length} with no time)`);
console.log('by folder:', by);
console.log('left out:', skipped);
