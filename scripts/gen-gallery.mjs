// The public photo gallery at /gallery (public/gallery.html), 23 Nov 2026.
// The organiser: "a public gallery of 100 to 200 best photos, no empty chairs, no empty
// hall, grand visuals, past and present event both", with its own tab in the menu.
//
//   node scripts/gen-gallery.mjs                  write the photos and filter buttons into public/gallery.html
//   node scripts/gen-gallery.mjs --images <mumbai folder> <dsc folder>
//                                                 also make the WebP files and the link-preview card
//   node scripts/gen-gallery.mjs --check          fail if the page is out of date or a photo file is missing
//
// The list, captions and alt text: scripts/data/gallery.json.
//   hero[]: the header photos, in the order they change (every 7 seconds). Each "ref" names a photo
//     already in mumbai2026 or dsc2017, whose caption is shown; "pos" is where a phone centres it.
//     Written between hero:start / hero:end, plus the preload line for the first one.
//   mumbai2026[]: "site" reuses public/img/mumbai-2026/<site>.webp (the 17 photos of the home page,
//     scripts/gen-mumbai-photos.mjs); "pid" is the photo store id: its source is <mumbai folder>/<pid>.jpg,
//     the 1600px copy from R2 (event-photos/1/<pid>/m.jpg). The sources live in
//     Downloads/bharatai-site-photos/gallery, not the repo.
//   dsc2017[]: "file" is the original in <dsc folder> (Downloads/Bharat AI/Pics, or its
//     "Video & conf pic" subfolder). All were taken 6 to 8 June 2017.
// Written: public/img/gallery/<mumbai-2026|dsc-2017>/<slug>.webp (inside 1600px) and <slug>-720.webp,
// and public/images/og/gallery.jpg (1200x630).
// Rules for adding photos: full halls only, no rows of empty chairs, no close-up of a private
// attendee (students especially), never the hall name "Centrum" or "Peacock" in a caption.
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const PAGE = path.join(PUB, 'gallery.html');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'data', 'gallery.json'), 'utf8'));
const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const IMAGES = args.indexOf('--images');

const KINDS = [['all', 'All'], ['stage', 'Talks'], ['panel', 'Panels'], ['hall', 'Full halls'], ['expo', 'Exhibition'], ['people', 'People'], ['arrivals', 'Arrivals']];
const EVENTS = [
  { key: 'mumbai2026', id: 'mumbai-2026', dir: 'mumbai-2026', title: 'Mumbai 2026', label: 'Bharat AI Innovation 2026, Mumbai', sub: '20 and 21 November 2026, World Trade Center Mumbai' },
  { key: 'dsc2017', id: 'dsc-2017', dir: 'dsc-2017', title: 'Data Science Congress 2017', label: 'Data Science Congress 2017', sub: '6 to 8 June 2017. The congress Aegis School of Data Science ran before Bharat AI Innovation.' },
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const files = (ev, e) => e.site
  ? { big: `img/mumbai-2026/${e.site}.webp`, small: `img/mumbai-2026/${e.site}-720.webp` }
  : { big: `img/gallery/${ev.dir}/${e.slug}.webp`, small: `img/gallery/${ev.dir}/${e.slug}-720.webp` };

for (const ev of EVENTS) for (const e of data[ev.key]) {
  if (!KINDS.some(([k]) => k === e.kind)) throw new Error(`unknown kind "${e.kind}" for ${e.slug || e.site}`);
  if (!e.alt || !e.caption) throw new Error(`missing alt or caption for ${e.slug || e.site}`);
  if (/centrum|peacock/i.test(e.alt + e.caption)) throw new Error(`hall name in ${e.slug || e.site}`);
}
// The header photos (data.hero): each names a photo already in the gallery, so it has a caption and both sizes.
const hero = (data.hero || []).map((h) => {
  const ev = EVENTS.find((x) => x.key === h.event);
  if (!ev) throw new Error(`hero: unknown event "${h.event}"`);
  const e = data[ev.key].find((x) => x.site === h.ref || x.slug === h.ref);
  if (!e) throw new Error(`hero: no photo "${h.ref}" in ${h.event}`);
  if (h.pos && !/^\d{1,3}% \d{1,3}%$/.test(h.pos)) throw new Error(`hero: pos for ${h.ref} must look like "50% 40%"`);
  return { ev, e, pos: h.pos || '50% 50%' };
});
if (hero.length < 2) throw new Error('hero: list at least two header photos in scripts/data/gallery.json');

if (IMAGES >= 0) {
  const [mdir, ddir] = [args[IMAGES + 1], args[IMAGES + 2]];
  if (!mdir || !ddir) throw new Error('--images needs <mumbai folder> <dsc folder>');
  const findDsc = (name) => {
    for (const d of [ddir, path.join(ddir, 'Video & conf pic')]) for (const ext of ['.JPG', '.jpg', '.jpeg']) {
      const p = path.join(d, name + ext); if (fs.existsSync(p)) return p;
    }
    throw new Error(`no original for ${name} in ${ddir}`);
  };
  let made = 0;
  for (const ev of EVENTS) {
    fs.mkdirSync(path.join(PUB, 'img', 'gallery', ev.dir), { recursive: true });
    for (const e of data[ev.key]) {
      if (e.site) continue;
      const src = ev.key === 'mumbai2026' ? path.join(mdir, e.pid + '.jpg') : findDsc(e.file);
      if (!fs.existsSync(src)) throw new Error(`missing source ${src}`);
      const f = files(ev, e);
      await sharp(src).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 72, effort: 6 }).toFile(path.join(PUB, f.big));
      await sharp(src).rotate().resize({ width: 720, withoutEnlargement: true }).webp({ quality: 68, effort: 6 }).toFile(path.join(PUB, f.small));
      made++;
    }
  }
  await sharp(path.join(PUB, 'img', 'mumbai-2026', 'opening-main-stage.webp')).resize(1200, 630, { fit: 'cover', position: 'centre' }).jpeg({ quality: 82, mozjpeg: true }).toFile(path.join(PUB, 'images', 'og', 'gallery.jpg'));
  console.log(`gen-gallery: made ${made} photos (two sizes each) and images/og/gallery.jpg`);
}

// The block: filter buttons, then one section per event.
const missing = [];
const dims = async (rel) => {
  const p = path.join(PUB, rel);
  if (!fs.existsSync(p)) { missing.push(rel); return { width: 0, height: 0 }; }
  const m = await sharp(p).metadata();
  return { width: m.width, height: m.height };
};
const all = EVENTS.flatMap((ev) => data[ev.key]);
const chips = KINDS.map(([k, label], i) => {
  const n = k === 'all' ? all.length : all.filter((e) => e.kind === k).length;
  return `<button type="button" class="gx-chip" data-kind="${k}" aria-pressed="${i === 0}">${label} <span>${n}</span></button>`;
});
const out = ['<!-- gallery:start -->', '<!-- Written by scripts/gen-gallery.mjs from scripts/data/gallery.json. Do not edit by hand. -->',
  '<div class="gx-bar" role="group" aria-label="Show photos of"><div class="gx-bar-in">', ...chips, '</div></div>'];
let first = true;
for (const [n, ev] of EVENTS.entries()) {
  const list = data[ev.key];
  out.push(`<section class="gx-sec" id="${ev.id}" data-event="${esc(ev.label)}" aria-labelledby="${ev.id}-title"><div class="gx-sec-in">`);
  out.push(`<div class="gx-sec-head"><span class="gx-sec-n" aria-hidden="true">${String(n + 1).padStart(2, '0')}</span>`
    + `<h2 id="${ev.id}-title">${esc(ev.title)}</h2><p>${esc(ev.sub)}</p>`
    + `<span class="gx-sec-count">${list.length} photos</span></div>`);
  out.push('<ul class="gx-grid">');
  let i = 0;
  for (const e of list) {
    const f = files(ev, e);
    const s = await dims(f.small), b = await dims(f.big);
    const eager = first && i < 6;
    const srcset = e.feature ? ` srcset="/${f.small} ${s.width}w, /${f.big} ${b.width}w" sizes="(min-width: 1100px) 50vw, (min-width: 768px) 66vw, 100vw"` : '';
    out.push(`<li class="gx-t${e.feature ? ' gx-f' : ''}" data-kind="${e.kind}"><a class="gx-a" href="/${f.big}" data-cap="${esc(e.caption)}">`
      + `<img src="/${f.small}"${srcset} width="${s.width}" height="${s.height}" alt="${esc(e.alt)}" loading="${eager ? 'eager' : 'lazy'}" decoding="async">`
      + `<span class="gx-cap" aria-hidden="true">${esc(e.caption)}</span></a></li>`);
    i++;
  }
  first = false;
  out.push('</ul>');
  out.push('<p class="gx-none">No photos of this kind from this event.</p>');
  out.push('</div></section>');
}
out.push('<!-- gallery:end -->');

// The header: one layer per photo. Only the first has a src; the page script loads each next
// one just before it is shown, so a visitor who never waits downloads one header photo.
// The sizes say how wide the photo is drawn: a tall phone screen crops a 3:2 photo to its height.
const HERO_SIZES = '(max-width: 767px) 170vw, (max-aspect-ratio: 3/2) 140vh, 100vw';
const heroOut = ['<!-- hero:start -->', '<!-- Written by scripts/gen-gallery.mjs from "hero" in scripts/data/gallery.json. Do not edit by hand. -->'];
let preload = '';
for (const [i, h] of hero.entries()) {
  const f = files(h.ev, h.e);
  const s = await dims(f.small), b = await dims(f.big);
  const srcset = `/${f.small} ${s.width}w, /${f.big} ${b.width}w`;
  const src = i === 0 ? `src="/${f.big}" srcset="${srcset}" fetchpriority="high"` : `data-src="/${f.big}" data-srcset="${srcset}"`;
  heroOut.push(`<div class="gx-slide${i === 0 ? ' is-on' : ''}" style="--pos: ${h.pos}" data-cap="${esc(h.e.caption)}" data-event="${esc(h.ev.title)}" data-href="/${f.big}">`
    + `<img ${src} sizes="${HERO_SIZES}" width="${b.width}" height="${b.height}" alt="" decoding="async"></div>`);
  if (i === 0) preload = `<link rel="preload" as="image" href="/${f.big}" imagesrcset="${srcset}" imagesizes="${HERO_SIZES}" fetchpriority="high">`;
}
heroOut.push('<!-- hero:end -->');

if (missing.length) {
  console.error(`gen-gallery: ${missing.length} photo file(s) missing, e.g. ${missing.slice(0, 3).join(', ')}. Run with --images first.`);
  process.exit(1);
}

const page = fs.readFileSync(PAGE, 'utf8');
const eol = page.includes('\r\n') ? '\r\n' : '\n';
const re = /<!-- gallery:start -->[\s\S]*?<!-- gallery:end -->/;
const reHero = /<!-- hero:start -->[\s\S]*?<!-- hero:end -->/;
const rePre = /<link rel="preload" as="image"[^>]*>/;
if (!re.test(page)) throw new Error('gallery.html has no gallery:start / gallery:end markers');
if (!reHero.test(page)) throw new Error('gallery.html has no hero:start / hero:end markers');
if (!rePre.test(page)) throw new Error('gallery.html has no <link rel="preload" as="image"> for the first header photo');
const next = page.replace(re, out.join(eol)).replace(reHero, heroOut.join(eol)).replace(rePre, preload);
if (CHECK) {
  if (next !== page) { console.error('gen-gallery: public/gallery.html is out of date. Run node scripts/gen-gallery.mjs'); process.exit(1); }
  console.log(`gen-gallery: public/gallery.html is up to date (${all.length} photos)`);
} else {
  fs.writeFileSync(PAGE, next);
  console.log(`gen-gallery: wrote public/gallery.html (${data.mumbai2026.length} Mumbai 2026 + ${data.dsc2017.length} Data Science Congress 2017 photos)`);
}
