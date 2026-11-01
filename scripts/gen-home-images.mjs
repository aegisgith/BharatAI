// Builds the home page's photographs from the archive originals.
//
//   node scripts/gen-home-images.mjs
//
// public/img/hero-1..7.webp - the seven frames behind the hero. Sharp: no blur
//   (Nov 2026: the organiser wants the Data Science Congress photographs to be
//   seen, not hinted at). Each frame's exposure is scaled so its average
//   brightness lands near TARGET_MEAN, never brighter than the original and never
//   below MIN_SCALE of it, so one scrim suits all seven. The old frames were
//   blurred and cut to about 40% brightness, which is why they read as nothing.
// public/img/t/<name>.webp - 720px copies of the gallery photographs, for the
//   photo tiles and the gallery grid (a phone shows them at ~180-360 css px).
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

// Same seven photographs, same order, as the frames they replace; the 1600px
// original where the archive has one, else the 1024px copy.
const HERO = [
  'images/gallery/7C2A3159.jpg',  // panel discussion, full stage
  'images/gallery/MNP_3505.jpg',  // speaker, bright screen
  'images/gallery/7C2A2991.jpg',  // keynote, NVIDIA
  'images/gallery/7C2A2823.jpg',  // minister at the lectern
  'images/gallery/577B0776.jpg',  // keynote, big screen
  'img/FSwgFC1Q.jpg',             // speaker, dark screen
  'images/gallery/DSC_5278.jpg',  // expo booth
];
const TARGET_MEAN = 92;   // 0-255, whole frame, greyscale
const MIN_SCALE = 0.5;

const GALLERY = ['oIGfmq8T', 'XYFamTjB', 'sx04jhlV', '3swgeyOb', 'G2kIKD4Y', 'IseXJc9a', 'FSwgFC1Q', '7PN2Sjyw', 'ziOcVT9u', 'M0pjzJb1', 'WkdpnU9p', 'fhk60Z58', 'u8AQyE20', 'GiqsZVsx', '5rwd54S2', 'qaOYFZfB', 'Mw680XyB', 'CrqPzMWZ', 'lQr1QV9W'];

async function meanGrey(file) {
  const { data } = await sharp(file).resize(256, 171, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  let s = 0;
  for (const v of data) s += v;
  return s / data.length;
}

for (let i = 0; i < HERO.length; i++) {
  const src = path.join(root, HERO[i]);
  const mean = await meanGrey(src);
  const scale = Math.max(MIN_SCALE, Math.min(1, TARGET_MEAN / mean));
  const out = path.join(root, 'img', `hero-${i + 1}.webp`);
  await sharp(src).resize({ width: 1600, withoutEnlargement: true }).linear(scale, 0).webp({ quality: 72, effort: 6 }).toFile(out);
  console.log(path.relative(root, out), 'mean', mean.toFixed(0), 'scale', scale.toFixed(2), Math.round(fs.statSync(out).size / 1024) + 'KB');
}

fs.mkdirSync(path.join(root, 'img', 't'), { recursive: true });
for (const name of GALLERY) {
  const out = path.join(root, 'img', 't', name + '.webp');
  await sharp(path.join(root, 'img', name + '.jpg')).resize({ width: 720, withoutEnlargement: true }).webp({ quality: 70, effort: 6 }).toFile(out);
  console.log(path.relative(root, out), Math.round(fs.statSync(out).size / 1024) + 'KB');
}
