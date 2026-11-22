// Event photos -> R2, step 3 (23 Nov 2026): the event_photos rows for D1.
//
// One row for every photo upload.mjs has put in R2 (progress.jsonl), with what the
// manifest knows. Needs migration 0064_event_photos.sql first. Safe to run again after
// more photos are copied: a photo already in the table is left as it is (its hidden and
// highlight flags too).
//
// usage: node scripts/photo-store/make-sql.mjs <dir> [--event 1]   -> <dir>/event-photos.sql
// then:  npx wrangler d1 execute bharatai-production --remote --yes --file=<dir>/event-photos.sql
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const DIR = args[0];
const i = args.indexOf('--event');
const EVENT = i > 0 ? Number(args[i + 1]) : 1;
if (!DIR) { console.error('usage: make-sql.mjs <dir> [--event 1]'); process.exit(2); }

const manifest = new Map(JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')).map(r => [r.pid, r]));
const copied = new Map();
for (const line of readFileSync(join(DIR, 'progress.jsonl'), 'utf8').split('\n')) { try { const r = JSON.parse(line); copied.set(r.pid, r); } catch {} }

const q = (v) => (typeof v === 'number' ? String(v) : "'" + String(v ?? '').replace(/'/g, "''") + "'");
const rows = [];
for (const [pid, p] of copied) {
  const m = manifest.get(pid);
  if (!m) continue;
  rows.push('(' + [EVENT, pid, m.drive_id, m.title, m.day, m.taken_at, m.camera, m.hall, p.width | 0, p.height | 0, p.bytes | 0, m.raw ? 1 : 0].map(q).join(', ') + ')');
}
const out = ['-- event_photos rows from scripts/photo-store/make-sql.mjs, ' + new Date().toISOString() + ', ' + rows.length + ' photos'];
for (let k = 0; k < rows.length; k += 50) {
  out.push('INSERT INTO event_photos (event_id, pid, drive_id, title, day, taken_at, camera, hall, width, height, bytes, raw) VALUES\n' + rows.slice(k, k + 50).join(',\n') + '\nON CONFLICT(pid) DO NOTHING;');
}
writeFileSync(join(DIR, 'event-photos.sql'), out.join('\n') + '\n');
console.log(`${rows.length} photos -> ${join(DIR, 'event-photos.sql')} (${Math.ceil(rows.length / 50)} statements)`);
