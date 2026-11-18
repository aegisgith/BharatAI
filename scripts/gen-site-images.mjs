// What the Worker cannot see for itself: the size of every logo and photo file the live
// exhibitor wall, talk cards and speaker grid may use, and which Admin upload each
// baked copy was made from (18 Nov 2026).
//
//   node scripts/gen-site-images.mjs      writes scripts/data/site-images.json
//
// src/routes/site-live.ts draws /exhibition, the home page, /partner and /conference
// from the app on every request (scripts/lib/exhibit-site.mjs). It reads this file to
// give each <img> its width and height, to know a file is there, and to use the small
// baked copy of an upload (a `<name>.src` file beside it names the upload) instead of
// the full upload. Run by scripts/sync-programme.mjs on every Pages build, after the
// generators have baked; run it by hand after adding images and commit the result.
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const PUBLIC = 'public'
const DIRS = ['images', 'images/exhibitors', 'images/talks', 'images/speakers', 'images/org-logos', 'images/government']
const RASTER = /\.(webp|png|jpe?g|avif|gif)$/i

const files = new Set()
for (const d of DIRS) {
  const dir = join(PUBLIC, d)
  if (!existsSync(dir)) continue
  for (const f of readdirSync(dir)) if (RASTER.test(f) && statSync(join(dir, f)).isFile()) files.add(`${d}/${f}`)
}
// Logos named by the people list and the talks list, wherever they live.
const lf = (t) => t.split('\r').join('')
try { for (const p of JSON.parse(lf(readFileSync('scripts/data/schedule-people.json', 'utf8'))).people || []) for (const f of [p.logo, p.photo]) if (f && RASTER.test(f) && existsSync(join(PUBLIC, f))) files.add(f) } catch { /* no people list */ }
try { for (const t of JSON.parse(lf(readFileSync('scripts/data/innovation-talks.json', 'utf8')))) if (t.logoFile && existsSync(join(PUBLIC, t.logoFile))) files.add(t.logoFile) } catch { /* no talks list */ }

const dims = {}
for (const f of [...files].sort()) {
  try { const m = await sharp(join(PUBLIC, f)).metadata(); if (m.width && m.height) dims[f] = [m.width, m.height] } catch { /* not an image sharp can read */ }
}

// Baked copies of uploads: images/exhibitors/<slug>.src and images/speakers/<slug>.src
// hold the upload's address; the copy is <slug>.webp beside it.
const baked = {}
for (const d of ['images/exhibitors', 'images/speakers']) {
  const dir = join(PUBLIC, d)
  if (!existsSync(dir)) continue
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.src')) continue
    const webp = `${d}/${f.slice(0, -4)}.webp`
    const from = lf(readFileSync(join(dir, f), 'utf8')).trim()
    if (from && dims[webp]) baked[from] = webp
  }
}

const out = { note: 'Written by scripts/gen-site-images.mjs; read by src/routes/site-live.ts. Do not edit.', dims, baked }
writeFileSync('scripts/data/site-images.json', JSON.stringify(out, null, 0).replace(/\],"/g, '],\n"') + '\n')
console.log(`[site-images] ${Object.keys(dims).length} image sizes, ${Object.keys(baked).length} baked uploads`)
