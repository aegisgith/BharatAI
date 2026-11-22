// Builds the website's Mumbai 2026 photographs from the photographers' copies.
//
//   node scripts/gen-mumbai-photos.mjs <source folder>
//
// The list is scripts/data/mumbai-2026-photos.json: one entry per photo, with a
// slug (the file name on the site), the photo-store pid (R2 key, so Admin can find
// the same photo among the 4,600), where it is used, its alt text and the point a
// crop must keep. The source folder holds <slug>.jpg, the 2,000px copies of the
// chosen photos; it lives outside the repo (Downloads/bharatai-site-photos/),
// because those files are big and the repo needs only what the site serves.
//
// public/img/mumbai-2026/<slug>.webp      1600px wide, for wide frames (/delhi, hero)
// public/img/mumbai-2026/<slug>-720.webp  720px wide, for grids and phones
// public/img/hero-1..7.webp               the home hero frames: the photos marked
//   "hero", in order, at 1600px, each one's exposure scaled so its average
//   brightness lands near TARGET_MEAN (never brighter than the photo, never below
//   MIN_SCALE of it), so one scrim suits all seven. Sharp, never blurred.
//
// A photo is chosen only if the hall looks full: no rows of empty chairs, no close-up
// of a private attendee (students especially). Stage, panel and crowd shots only.
// New site photos mean re-running python scripts/gen-site-photo-fingerprints.py.
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(repo, 'public');
const src = process.argv[2];
if (!src || !fs.existsSync(src)) {
  console.error('Usage: node scripts/gen-mumbai-photos.mjs <folder with <slug>.jpg>');
  process.exit(1);
}
const list = JSON.parse(fs.readFileSync(path.join(repo, 'scripts', 'data', 'mumbai-2026-photos.json'), 'utf8'));
const outDir = path.join(pub, 'img', 'mumbai-2026');
fs.mkdirSync(outDir, { recursive: true });

const TARGET_MEAN = 92;   // 0-255, whole frame, greyscale
const MIN_SCALE = 0.5;

async function meanGrey(file) {
  const { data } = await sharp(file).rotate().resize(256, 171, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  let s = 0;
  for (const v of data) s += v;
  return s / data.length;
}

const kb = (f) => Math.round(fs.statSync(f).size / 1024) + 'KB';
let hero = 0;
for (const p of list.photos) {
  const file = path.join(src, p.slug + '.jpg');
  if (!fs.existsSync(file)) { console.error('missing', file); process.exitCode = 1; continue; }
  const big = path.join(outDir, p.slug + '.webp');
  const small = path.join(outDir, p.slug + '-720.webp');
  await sharp(file).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 74, effort: 6 }).toFile(big);
  await sharp(file).rotate().resize({ width: 720, withoutEnlargement: true }).webp({ quality: 70, effort: 6 }).toFile(small);
  console.log(p.slug, kb(big), kb(small));
  if ((p.use || []).includes('hero')) {
    hero++;
    const mean = await meanGrey(file);
    const scale = Math.max(MIN_SCALE, Math.min(1, TARGET_MEAN / mean));
    const out = path.join(pub, 'img', `hero-${hero}.webp`);
    await sharp(file).rotate().resize(1600, 1066, { fit: 'cover', position: p.heroPos || 'centre' }).linear(scale, 0).webp({ quality: 72, effort: 6 }).toFile(out);
    console.log('  ', path.relative(pub, out), 'mean', mean.toFixed(0), 'scale', scale.toFixed(2), kb(out));
  }
}
if (hero && hero !== 7) console.warn(`${hero} hero photos; the home page has seven hero <img> frames.`);
