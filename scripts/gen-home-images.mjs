// Builds the home page's photographs from the archive originals.
//
//   node scripts/gen-home-images.mjs
//
// public/img/hero-1..7.webp - the home hero frames. Since 23 Nov 2026 they are Mumbai 2026
//   photographs, built by scripts/gen-mumbai-photos.mjs (the photos marked "hero" in
//   scripts/data/mumbai-2026-photos.json). This script no longer writes them.
// public/img/t/<name>.webp - 720px copies of the gallery photographs, for the
//   photo tiles and the gallery grid (a phone shows them at ~180-360 css px).
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const GALLERY = ['oIGfmq8T', 'XYFamTjB', 'sx04jhlV', '3swgeyOb', 'G2kIKD4Y', 'IseXJc9a', 'FSwgFC1Q', '7PN2Sjyw', 'ziOcVT9u', 'M0pjzJb1', 'WkdpnU9p', 'fhk60Z58', 'u8AQyE20', 'GiqsZVsx', '5rwd54S2', 'qaOYFZfB', 'Mw680XyB', 'CrqPzMWZ', 'lQr1QV9W'];

fs.mkdirSync(path.join(root, 'img', 't'), { recursive: true });
for (const name of GALLERY) {
  const out = path.join(root, 'img', 't', name + '.webp');
  await sharp(path.join(root, 'img', name + '.jpg')).resize({ width: 720, withoutEnlargement: true }).webp({ quality: 70, effort: 6 }).toFile(out);
  console.log(path.relative(root, out), Math.round(fs.statSync(out).size / 1024) + 'KB');
}
