// Exhibitor logos: one list, four outputs.
//
//   node scripts/gen-exhibitor-logos.mjs "<folder of logo files>"
//
// 1. public/images/exhibitors/<slug>.webp — each logo with its white margin
//    trimmed (many arrive as a small wordmark in a big white square), never
//    enlarged past the source.
// 2. The block between <!-- exhibitors:start --> and <!-- exhibitors:end --> in
//    public/index.html (a strip of chips) and public/exhibition.html (the wall).
// 3. The same markers in public/llms.txt, so AI assistants can name exhibitors.
// 4. scripts/sql/exhibitor-logos.sql — fills exhibitors.logo_url for the app's
//    Exhibitors tab. The organiser runs it; it never overwrites a logo set by hand.
//
// To add or drop a company, edit EXHIBITORS and re-run with the folder. Run with
// no folder to rebuild the HTML/SQL from the images already in the repo.
//
// `db` is exhibitors.id + company_name in production (read 3 Oct 2026). Entries
// without it had no confirmed booth then: Actin, Info Science Labs, Jade Global,
// LightMetrics, Teenage Works, ValuEnable and Xtant Tech were "held" in
// booth_allocations; gupshup.ai, Omnirises, Pramaana Labs and Vassar Labs were not
// in the database at all. They are listed because the organiser's logo folder
// lists them. Aegis School of Data Science & AI and Assessfy were added on 4 Oct
// at the organiser's request, with no exhibitor or booth row yet.
//
// The names are printed under every logo: half of these are symbol-only marks.
// `optical` enlarges a lockup whose small lettering would otherwise be lost.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const SITE = 'https://bharataiinnovation.com'
const OUT = 'public/images/exhibitors'

const EXHIBITORS = [
  { name: 'Actin Technologies', file: 'Actin Technologies logo.jpg' },
  { name: 'Aegis School of Data Science & AI', file: 'Our Logo/logo-aegis (1) (1).webp', optical: 1.15 },
  { name: 'Ai Vie Insights', file: 'Ai Vie Insights Private Limited.jpg', db: [9, 'Ai Vie Insights Private Limited'] },
  { name: 'AlgoAnalytics', file: 'Algo Analytics.jpg', db: [6, 'Algo Analytics'] },
  { name: 'Amnex Infotechnologies', file: 'Amnex infotech logo.jpg', db: [22, 'Amnex technologies'] },
  { name: 'Ary-Soft', file: 'ary-soft logo.jpg', db: [31, 'ary-soft'] },
  { name: 'Asmadiya Technologies', file: 'Asmadiya technologies.jpg', db: [12, 'Asmadiya'] },
  { name: 'Assessfy', file: 'Our Logo/Assessfy.png', optical: 1.15 },
  { name: 'CGI', file: 'CGI logo.jpg', db: [5, 'CGI'] },
  { name: 'Cosmica Telematics', file: 'COSMICA TELEMATICS PRIVATE LIMITED.jpg', db: [8, 'COSMICA TELEMATICS PRIVATE LIMITED'] },
  { name: 'Daten Technology Solutions', file: 'Daten Technology Solutions logo.jpg', db: [16, 'Daten Intelligenz Software, AIGyan Technologies'] },
  { name: 'Envista Cyber Defence', file: 'Envista cyber defence logo.jpg', db: [28, 'Envista Cyber Defence'] },
  { name: 'Eurys Infosystems', file: 'EURYS infosystemS private limited.jpg', db: [15, 'EURYS infosystemS private limited'] },
  { name: 'Evoke Technologies', file: 'Evoke Technologies logo.jpg', db: [27, 'Evoke Technologies'] },
  { name: 'Gupshup.ai', file: 'gupshup ai logo.jpg' },
  { name: 'Harrier Information Systems', file: 'Harrier information system pvt ltd logo.jpg', db: [25, 'Harrier Information Systems Pvt. Ltd.'], optical: 1.1 },
  { name: 'Image Infosystems', file: 'Image Infosystem.jpg', db: [4, 'Image Infosystem'], optical: 1.3 },
  { name: 'Indigloo Software', file: 'Indigloo Software Pvt Ltd logo.jpg', db: [32, 'Indigloo Software Pvt Ltd'] },
  { name: 'Info Science Labs', file: 'Info Science Labs logo.jpg' },
  { name: 'Intangles', file: 'Intangles Logo.jpg', db: [3, 'Intangles'] },
  { name: 'Jade Global', file: 'Jade Global logo.jpg' },
  { name: 'Joget', file: 'Joget INC logo.jpg', db: [23, 'Joget INC'] },
  { name: 'Kadeep.ai', file: 'Kadeep Ai logo.jpg', db: [26, 'kadeep.ai'] },
  { name: 'Kirusa', file: 'Kirusa Inc.jpg', db: [20, 'Kirusa Inc'] },
  { name: 'LightMetrics', file: 'LightMetrics logo.jpg' },
  // The ministry's own logo (organiser, 4 Oct), replacing an old Azadi Ka Amrit Mahotsav graphic.
  { name: 'Ministry of Tribal Affairs', file: 'Ministry_of_Tribal_Affairs.svg', db: [24, 'Ministry of Tribal Affairs'], optical: 1.3 },
  { name: 'NoBroker', file: 'NoBroker Technologies Solutions Private Limited.jpg', db: [10, 'NoBroker Technologies Solutions Private Limited'] },
  { name: 'Omnirises Technologies', file: 'Omnirises Technologies logo.jpg' },
  { name: 'Oranje AI', file: 'ORANJE AI PRIVATE LIMITED logo.jpg', db: [14, 'ORANJE AI PRIVATE LIMITED'] },
  { name: 'Origin AI', file: 'Origin AI.jpg', db: [19, 'Origin AI'] },
  { name: 'Paisani Technology Services', file: 'Paisani Technology Services_.jpg', db: [13, 'Paisani Technology Services'] },
  { name: 'Phoebetal Technologies', file: 'Phoebetal Technologies Pvt Ltd.jpg', db: [30, 'Phoebetal Technologies Pvt Ltd'] },
  { name: 'Pramaana Labs', file: 'pramaana labs logo.jpg' },
  { name: 'Qapitol AI', file: 'Qapitol AI logo.jpg', db: [2, 'Qapitol AI'] },
  { name: 'RedFerns Tech', file: 'RedFerns Tech Private Limited.jpg', db: [29, 'RedFerns Tech Private Limited'] },
  { name: 'Saranyu Technologies', file: 'Saranyu Technologies.jpg', db: [11, 'Saranyu Technologies'] },
  { name: 'Seem Fintech & Sustainability', file: 'Seem Fintech & Sustainability Pvt Ltd.jpg', db: [7, 'Seem Fintech & Sustainability Pvt Ltd'] },
  { name: 'Teenage Works', file: 'Teenage Works Logo.jpg' },
  { name: 'ValuEnable', file: 'Valuenable pvt ltd.jpg' },
  { name: 'Vassar Labs', file: 'Vassar labs logo.jpg' },
  { name: 'Wyn Labs', file: 'Wyn Labs.jpg', db: [17, 'Wyn Labs'] },
  { name: 'Xtant Tech', file: 'Xtant Tech.png', dark: true }, // white wordmark on a big black square
  { name: 'Zanopy AI', file: 'Zanopy AI.jpg', db: [21, 'Zanopy AI'] },
]
const MEDIA_PARTNER = { name: 'The Mainstream', file: 'Digital Media Partner/The MAINSTREAM logo Digital Media Partner.jpeg' }

const slugOf = (name) => name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })

// `dark`: a light mark on a dark field. Trim the dark field instead of white,
// or the mark stays a speck in the middle of a black tile.
async function bake(src, slug, dark) {
  const bg = dark ? '#000000' : '#ffffff'
  // An SVG renders at 72 dpi by default; draw it big so small lettering survives the downscale.
  const input = /\.svg$/i.test(src) ? sharp(src, { density: 300 }) : sharp(src)
  const flat = await input.flatten({ background: bg }).png().toBuffer()
  let trimmed = flat
  try { trimmed = await sharp(flat).trim({ background: bg, threshold: 24 }).png().toBuffer() } catch { /* nothing to trim */ }
  // Intermediates are PNG: toBuffer() keeps the input format, so a JPEG would be
  // recompressed at every step. Separate passes: sharp always resizes before it
  // extends, whatever the call order, so a pad sized from the unresized image
  // swamps a large source.
  const fitted = await sharp(trimmed).resize({ width: 300, height: 150, fit: 'inside', withoutEnlargement: true }).png().toBuffer()
  const m = await sharp(fitted).metadata()
  const pad = Math.round(Math.max(m.width, m.height) * (dark ? 0.12 : 0.06))
  const buf = await sharp(fitted).extend({ top: pad, bottom: pad, left: pad, right: pad, background: bg })
    .webp({ quality: 90 }).toBuffer()
  writeFileSync(join(OUT, `${slug}.webp`), buf)
}

async function size(slug) {
  const m = await sharp(join(OUT, `${slug}.webp`)).metadata()
  return { w: m.width, h: m.height }
}

// Replace the text between the markers, keeping the file's BOM and line endings.
function fill(path, html) {
  const src = readFileSync(path, 'utf8')
  const eol = src.includes('\r\n') ? '\r\n' : '\n'
  const s = src.replace(/\r\n/g, '\n')
  const a = s.indexOf('<!-- exhibitors:start'), b = s.indexOf('<!-- exhibitors:end -->')
  if (a < 0 || b < 0) throw new Error(`${path}: exhibitors markers missing`)
  const lineStart = s.lastIndexOf('\n', a) + 1
  const ind = s.slice(lineStart, a)
  const body = html.split('\n').map((l) => (l ? ind + l : l)).join('\n')
  const out = s.slice(0, lineStart) + body + ind + s.slice(b)
  writeFileSync(path, out.replace(/\n/g, eol), 'utf8')
}

const srcDir = process.argv[2]
mkdirSync(OUT, { recursive: true })
const all = [...EXHIBITORS].sort(byName).map((e) => ({ ...e, slug: slugOf(e.name) }))
const media = { ...MEDIA_PARTNER, slug: slugOf(MEDIA_PARTNER.name) }

if (srcDir) {
  for (const e of [...all, media]) {
    const src = join(srcDir, e.file)
    if (!existsSync(src)) throw new Error(`missing logo file: ${src}`)
    await bake(src, e.slug, e.dark)
  }
  const known = new Set([...all, media].map((e) => `${e.slug}.webp`))
  const stray = readdirSync(OUT).filter((f) => !known.has(f))
  if (stray.length) console.log(`not in the list any more (delete if unwanted): ${stray.join(', ')}`)
}
for (const e of [...all, media]) Object.assign(e, await size(e.slug))

// Optical sizing. At one shared height a wide wordmark shouts and a square mark
// whispers, so the displayed height falls as the logo gets wider (aspect^-0.4,
// a little gentler than equal area, which leaves long wordmarks too small).
// The page scales the result per screen size through --ls.
for (const e of all) {
  const r = e.w / e.h
  let h = 52 * Math.pow(r, -0.4) * (e.optical || 1)
  h = Math.min(58, Math.max(24, h))
  if (h * r > 180) h = 180 / r
  e.lh = Math.round(h)
}

const img = (e, style = '') => `<img src="/images/exhibitors/${e.slug}.webp" width="${e.w}" height="${e.h}"${style ? ` style="${style}"` : ''} alt="" loading="lazy" decoding="async">`
const START = '<!-- exhibitors:start (generated by scripts/gen-exhibitor-logos.mjs: edit the list there, not here) -->'

// Both pages show the exhibitors as rows that drift in opposite directions,
// never as a grid: the organiser does not want the number of exhibitors (and so
// the booths still unsold) countable at a glance. For the same reason:
// - row speeds are fixed, never derived from how many logos a row holds;
// - the order is reshuffled on every visit (SHUFFLE below), so there is no
//   alphabetical first and last name to count between;
// - nothing prints a total;
// - tiles take their logo's natural width and each row starts at a random
//   offset, so there are no columns to multiply by rows (3 rows of 7 equal
//   cards read as "21" at a glance, under half the real number);
// - rows are dense enough that a wide screen shows about every exhibitor at
//   once, which is the true scale, without a logo repeating in view. The row
//   count grows with the list (rowsFor): about 11 logos a row on the
//   exhibition page, 14 on the home page. More rows than that would put the
//   same logo twice on one screen, which reads as padding.
// Each row leads with a recognisable name (FEATURED), then the rest at random.
// The second copy of each row makes the loop seamless; screen readers skip it.
const FEATURED = ['CGI', 'NoBroker', 'Gupshup.ai', 'Jade Global', 'Evoke Technologies', 'Ministry of Tribal Affairs']
for (const n of FEATURED) if (!all.some((e) => e.name === n)) throw new Error(`FEATURED names an unknown exhibitor: ${n}`)
for (const e of all) e.featured = FEATURED.includes(e.name)
const ordered = [...all.filter((e) => e.featured), ...all.filter((e) => !e.featured)]
const deal = (n) => ordered.reduce((rows, e, i) => (rows[i % n].push(e), rows), Array.from({ length: n }, () => []))
const rowsFor = (perRow, min, max) => Math.min(max, Math.max(min, Math.round(all.length / perRow)))
const feat = (e) => (e.featured ? ' data-featured' : '')

// Runs at load. Without it the build-time order above stays, which is fine.
const SHUFFLE = `<script>
(function () {
  var wall = document.getElementById('exhibitors');
  var all = wall ? Array.prototype.slice.call(wall.querySelectorAll('.exh-row')) : [];
  if (!all.length) return;
  var featured = [], rest = [];
  all.forEach(function (row) {
    Array.prototype.slice.call(row.querySelector('.exh-track').children).forEach(function (li) {
      if (li.classList.contains('exh-cta-tile')) return;
      (li.hasAttribute('data-featured') ? featured : rest).push(li);
    });
  });
  var rows = all;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce) and (min-width: 700px)').matches) {
    // Animations off on a wide screen: the CSS shows one still cloud, so deal
    // every logo into one row and let it wrap in a single flow (separate rows
    // would each leave a short line mid-cloud). Known names lead the cloud.
    rows = all.slice(0, 1);
    all.slice(1).forEach(function (row) { row.hidden = true; });
  } else if (window.innerWidth >= 1700 && all.length > 3) {
    // A very wide screen shows more tiles per row than a row holds, so the same
    // logo would appear twice: deal into one row fewer (never below three).
    rows = all.slice(0, all.length - 1);
    all[all.length - 1].hidden = true;
  }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  rows.forEach(function (row) { row.style.setProperty('--exh-delay', '-' + Math.floor(Math.random() * 70) + 's'); });
  var dealt = [];
  for (var r = 0; r < rows.length; r++) dealt.push([]);
  shuffle(featured).concat(shuffle(rest)).forEach(function (li, i) { dealt[i % rows.length].push(li); });
  // Three passes: take every logo out, deal them back, then copy each row. A
  // copy made before the later rows have collected their logos would not match.
  featured.concat(rest).forEach(function (li) { li.parentNode.removeChild(li); });
  rows.forEach(function (row, r) {
    var first = row.querySelector('.exh-track');
    var cta = first.querySelector('.exh-cta-tile');
    dealt[r].forEach(function (li) { first.insertBefore(li, cta); });
  });
  all.forEach(function (row) {
    var tracks = row.querySelectorAll('.exh-track');
    var first = tracks[0], copy = tracks[1];
    if (!copy) return;
    copy.innerHTML = '';
    Array.prototype.slice.call(first.children).forEach(function (li) {
      var c = li.cloneNode(true);
      c.querySelectorAll('a').forEach(function (a) { a.setAttribute('tabindex', '-1'); });
      copy.appendChild(c);
    });
  });
})();
</script>`

const marquee = (cls, rows, item, tail = '') => `    <div class="${cls}">
${rows.map((r, i) => `      <div class="exh-row${i % 2 ? ' exh-row-rev' : ''}" style="--exh-dur:${[84, 100, 76, 92, 88, 96][i % 6]}s;--exh-delay:-${[0, 41, 23, 57, 12, 33][i % 6]}s">
${[0, 1].map((copy) => `        <ul class="exh-track"${copy ? ' aria-hidden="true"' : ' aria-label="Exhibitors"'}>
${r.map(item).join('\n')}${tail && i % 2 === 0 ? '\n' + tail(copy) : ''}
        </ul>`).join('\n')}
      </div>`).join('\n')}
    </div>`

const chip = (e) => `          <li class="exh-chip"${feat(e)}>${img(e, `--lh:${e.lh}px`)}<span>${esc(e.name)}</span></li>`
const card = (e) => `          <li class="exh-card"${feat(e)}><span class="exh-logo">${img(e, `--lh:${e.lh}px`)}</span><span class="exh-name">${esc(e.name)}</span></li>`
// A call to action at the end of every other exhibition row (more than one or
// two in view reads as empty booths), plainly labelled: an invitation, not an
// exhibitor.
const ctaTile = (copy) => `          <li class="exh-card exh-cta-tile"><a href="#packages"${copy ? ' tabindex="-1"' : ''}><span class="exh-cta-plus" aria-hidden="true">+</span><span class="exh-name">Your company here</span><span class="exh-cta-link">Book a booth &rarr;</span></a></li>`
const mediaLine = `<p class="exh-media"><span class="exh-media-label">Digital media partner</span><span class="exh-media-name">${img(media)}<span>${esc(media.name)}</span></span></p>`
// Who is on the floor, by kind, naming only exhibitors with a confirmed booth so
// the line stays true if a held booth falls through.
const WHO = 'Global IT firms like CGI, platforms like NoBroker, AI startups and the Ministry of Tribal Affairs, showing their work to enterprise and government buyers.'

const home = `${START}
<section class="section-pad-sm exh-strip" id="exhibitors">
    <div class="container">
        <div class="section-header reveal">
            <h2 class="section-title">Already on the <span class="accent">exhibition floor</span></h2>
            <p class="section-subtitle">${WHO}</p>
        </div>
    </div>
${marquee('exh-marquee', deal(rowsFor(14, 2, 4)), chip)}
    <div class="container exh-strip-foot">
        ${mediaLine}
        <div class="exh-strip-ctas">
            <a href="/exhibition#exhibitors" class="btn btn-outline">Explore the exhibition</a>
            <a href="/exhibition#packages" class="btn btn-primary">Book a booth</a>
        </div>
    </div>
</section>
${SHUFFLE}
`

const grid = `${START}
<section class="section-pad exh-section" id="exhibitors">
    <div class="container">
        <div class="section-header reveal">
            <h2 class="section-title">Join the companies <span class="accent">already exhibiting</span></h2>
            <p class="section-subtitle">${WHO}</p>
        </div>
    </div>
${marquee('exh-marquee exh-wall', deal(rowsFor(11, 3, 6)), card, ctaTile)}
    <div class="container">
        ${mediaLine}
        <p class="exh-cta"><a href="#packages" class="btn btn-primary">Book your booth</a></p>
    </div>
</section>
${SHUFFLE}
`

const llms = `${START}
## Exhibitors

Companies and organisations exhibiting at Bharat AI Innovation 2026 (list updated 3 October 2026; see https://bharataiinnovation.com/exhibition#exhibitors):

${all.map((e) => `- ${e.name}`).join('\n')}

Digital media partner: ${media.name}.
`

fill('public/index.html', home)
fill('public/exhibition.html', grid)
fill('public/llms.txt', llms)

const sql = `-- Exhibitor logos for the app's Exhibitors tab (organiser's logo folder, 3 Oct 2026).
-- Generated by scripts/gen-exhibitor-logos.mjs; the images are served from
-- ${SITE}/images/exhibitors/, so deploy before running this.
--
-- Each row is matched on id AND company_name, and only an empty logo_url is filled,
-- so a logo set later by hand is never overwritten. Safe to run again:
--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/exhibitor-logos.sql
-- Exhibitors with no confirmed row on 3 Oct are not here; see the list in the script.

${all.filter((e) => e.db).map((e) => `UPDATE exhibitors SET logo_url = '${SITE}/images/exhibitors/${e.slug}.webp' WHERE id = ${e.db[0]} AND company_name = '${e.db[1].replace(/'/g, "''")}' AND COALESCE(logo_url, '') = '';`).join('\n')}
`
writeFileSync('scripts/sql/exhibitor-logos.sql', sql)

console.log(`${all.length} exhibitors + media partner; ${all.filter((e) => e.db).length} rows in scripts/sql/exhibitor-logos.sql`)
