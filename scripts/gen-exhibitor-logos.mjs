// Exhibitor logos: one list, four outputs.
//
//   node scripts/gen-exhibitor-logos.mjs "<folder of logo files>"
//
// 1. public/images/exhibitors/<slug>.webp — each logo with its white margin
//    trimmed (many arrive as a small wordmark in a big white square), never
//    enlarged past the source.
// 2. The block between <!-- exhibitors:start --> and <!-- exhibitors:end --> in
//    public/index.html (a scrolling strip) and public/exhibition.html (the grid).
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
// lists them.
//
// The names are printed under every logo: half of these are symbol-only marks.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const SITE = 'https://bharataiinnovation.com'
const OUT = 'public/images/exhibitors'

const EXHIBITORS = [
  { name: 'Actin Technologies', file: 'Actin Technologies logo.jpg' },
  { name: 'Ai Vie Insights', file: 'Ai Vie Insights Private Limited.jpg', db: [9, 'Ai Vie Insights Private Limited'] },
  { name: 'AlgoAnalytics', file: 'Algo Analytics.jpg', db: [6, 'Algo Analytics'] },
  { name: 'Amnex Infotechnologies', file: 'Amnex infotech logo.jpg', db: [22, 'Amnex technologies'] },
  { name: 'Ary-Soft', file: 'ary-soft logo.jpg', db: [31, 'ary-soft'] },
  { name: 'Asmadiya Technologies', file: 'Asmadiya technologies.jpg', db: [12, 'Asmadiya'] },
  { name: 'CGI', file: 'CGI logo.jpg', db: [5, 'CGI'] },
  { name: 'Cosmica Telematics', file: 'COSMICA TELEMATICS PRIVATE LIMITED.jpg', db: [8, 'COSMICA TELEMATICS PRIVATE LIMITED'] },
  { name: 'Daten Technology Solutions', file: 'Daten Technology Solutions logo.jpg', db: [16, 'Daten Intelligenz Software, AIGyan Technologies'] },
  { name: 'Envista Cyber Defence', file: 'Envista cyber defence logo.jpg', db: [28, 'Envista Cyber Defence'] },
  { name: 'Eurys Infosystems', file: 'EURYS infosystemS private limited.jpg', db: [15, 'EURYS infosystemS private limited'] },
  { name: 'Evoke Technologies', file: 'Evoke Technologies logo.jpg', db: [27, 'Evoke Technologies'] },
  { name: 'Gupshup.ai', file: 'gupshup ai logo.jpg' },
  { name: 'Harrier Information Systems', file: 'Harrier information system pvt ltd logo.jpg', db: [25, 'Harrier Information Systems Pvt. Ltd.'] },
  { name: 'Image Infosystems', file: 'Image Infosystem.jpg', db: [4, 'Image Infosystem'] },
  { name: 'Indigloo Software', file: 'Indigloo Software Pvt Ltd logo.jpg', db: [32, 'Indigloo Software Pvt Ltd'] },
  { name: 'Info Science Labs', file: 'Info Science Labs logo.jpg' },
  { name: 'Intangles', file: 'Intangles Logo.jpg', db: [3, 'Intangles'] },
  { name: 'Jade Global', file: 'Jade Global logo.jpg' },
  { name: 'Joget', file: 'Joget INC logo.jpg', db: [23, 'Joget INC'] },
  { name: 'Kadeep.ai', file: 'Kadeep Ai logo.jpg', db: [26, 'kadeep.ai'] },
  { name: 'Kirusa', file: 'Kirusa Inc.jpg', db: [20, 'Kirusa Inc'] },
  { name: 'LightMetrics', file: 'LightMetrics logo.jpg' },
  { name: 'Ministry of Tribal Affairs', file: 'Minsitry of Tribal Affairs  Logo.jpg', db: [24, 'Ministry of Tribal Affairs'] },
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
  const flat = await sharp(src).flatten({ background: bg }).toBuffer()
  let img = sharp(flat)
  try { img = sharp(await sharp(flat).trim({ background: bg, threshold: 24 }).toBuffer()) } catch { /* nothing to trim */ }
  const m = await img.metadata()
  const pad = Math.round(Math.max(m.width, m.height) * (dark ? 0.12 : 0.06))
  const buf = await img.extend({ top: pad, bottom: pad, left: pad, right: pad, background: bg })
    .resize({ width: 320, height: 160, fit: 'inside', withoutEnlargement: true })
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

const img = (e, cls = '') => `<img${cls} src="/images/exhibitors/${e.slug}.webp" width="${e.w}" height="${e.h}" alt="" loading="lazy" decoding="async">`
const START = '<!-- exhibitors:start (generated by scripts/gen-exhibitor-logos.mjs: edit the list there, not here) -->'

// Home: two rows that drift in opposite directions. The second copy of each row
// is what makes the loop seamless; screen readers skip it.
const rows = [all.filter((_, i) => i % 2 === 0), all.filter((_, i) => i % 2 === 1)]
const chips = (list) => list.map((e) => `        <li class="exh-chip">${img(e)}<span>${esc(e.name)}</span></li>`).join('\n')
const home = `${START}
<section class="section-pad-sm exh-strip" id="exhibitors">
    <div class="container">
        <div class="section-header reveal">
            <h2 class="section-title">On the <span class="accent">exhibition floor</span></h2>
            <p class="section-subtitle">The AI companies and organisations taking a stand at WTC Mumbai, 20&ndash;21 November 2026.</p>
        </div>
    </div>
    <div class="exh-marquee">
${rows.map((r, i) => `      <div class="exh-row${i ? ' exh-row-rev' : ''}" style="--exh-dur:${r.length * 3}s">
        <ul class="exh-track" aria-label="Exhibitors">
${chips(r)}
        </ul>
        <ul class="exh-track" aria-hidden="true">
${chips(r)}
        </ul>
      </div>`).join('\n')}
    </div>
    <div class="container exh-strip-foot">
        <p class="exh-media"><span class="exh-media-label">Digital media partner</span><span class="exh-media-name">${img(media)}<span>${esc(media.name)}</span></span></p>
        <div class="exh-strip-ctas">
            <a href="/exhibition#exhibitors" class="btn btn-outline">See every exhibitor</a>
            <a href="/exhibition#packages" class="btn btn-primary">Book a booth</a>
        </div>
    </div>
</section>
`

const grid = `${START}
<section class="section-pad exh-section" id="exhibitors">
    <div class="container">
        <div class="section-header reveal">
            <h2 class="section-title">Exhibiting at <span class="accent">Bharat AI Innovation 2026</span></h2>
            <p class="section-subtitle">The companies and organisations showing their work on the floor at WTC Mumbai, 20&ndash;21 November 2026.</p>
        </div>
        <ul class="exh-grid">
${all.map((e) => `            <li class="exh-card"><span class="exh-logo">${img(e)}</span><span class="exh-name">${esc(e.name)}</span></li>`).join('\n')}
        </ul>
        <p class="exh-media"><span class="exh-media-label">Digital media partner</span><span class="exh-media-name">${img(media)}<span>${esc(media.name)}</span></span></p>
        <p class="exh-cta"><a href="#packages" class="btn btn-primary">Book your booth</a></p>
    </div>
</section>
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
