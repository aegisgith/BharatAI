// Exhibitor logos: one list, four outputs.
//
//   node scripts/gen-exhibitor-logos.mjs "<folder of logo files>"
//
// 1. public/images/exhibitors/<slug>.webp — each logo with its white margin
//    trimmed (many arrive as a small wordmark in a big white square), never
//    enlarged past the source.
// 2. The block between <!-- exhibitors:start --> and <!-- exhibitors:end --> in
//    public/mumbai.html (a strip of chips; the home page until 24 Nov 2026) and public/exhibition.html (the wall).
// 3. The same markers in public/llms.txt, so AI assistants can name exhibitors.
// 4. scripts/sql/exhibitor-logos.sql — fills exhibitors.logo_url for the app's
//    Exhibitors tab. The organiser runs it; it never overwrites a logo set by hand.
//
// To add or drop a company, edit EXHIBITORS (scripts/data/exhibitor-looks.mjs since
// 18 Nov 2026) and re-run with the folder. Run with no folder to rebuild the HTML/SQL
// from the images already in the repo.
//
// `db` is exhibitors.id + company_name in production (read 3 Oct 2026). Entries
// without it had no confirmed booth then: Actin, Info Science Labs, Jade Global,
// LightMetrics, Teenage Works, ValuEnable and Xtant Tech were "held" in
// booth_allocations; gupshup.ai, Pramaana Labs and Vassar Labs were not in the
// database at all. They are listed because the organiser's logo folder lists
// them. Omnirises Technologies was dropped on 24 Oct, and Amnex Infotechnologies and
// Indigloo Software on 28 Oct: not participating. Aegis School of Data Science & AI and Assessfy were added on 4 Oct
// at the organiser's request, with no exhibitor or booth row yet. Aria Telecom,
// JoyVibe, OliAI and P99Soft came from the organiser's 23 Oct folder; none had an
// exhibitors row on 24 Oct. Cloud Crane, Lenixvision, Trust3 AI and Wissen
// Technology came from the 30 Oct export, which has no "Our Logo" or "Digital Media
// Partner" folder and no Qapitol AI file: those sources are the 12 Oct export's.
// scripts/sql/exhibitor-changes-2026-10-30.sql gives Aegis and Assessfy app rows.
// FTA Global, Nu10 Technologies and Rightangle Technologies came from the 4 Nov
// export's "4 Nov New logo" folder (it is flat otherwise, like the 30 Oct one, and
// some of its names start with a space), with no exhibitors row known. Asmadiya's
// full wordmark came the same day from the organiser's "Presenter Logo" export
// ("4 Nov Presenter" folder); the booth folder's file is the symbol alone.
//
// The names are printed under every logo: half of these are symbol-only marks.
// `optical` enlarges a lockup whose small lettering would otherwise be lost.
//
// The markup is scripts/lib/exhibit-site.mjs, shared with the Worker, which draws the
// same wall live from the app on every request (src/routes/site-live.ts, 18 Nov 2026).
// This script bakes the logo files and writes the committed copies of the blocks.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { EXHIBITORS, MEDIA_PARTNER } from './data/exhibitor-looks.mjs'
import { slugOf, byName, matchWall, sizeWall, renderWall, fillWall, FEATURED } from './lib/exhibit-site.mjs'

const SITE = 'https://bharataiinnovation.com'
const OUT = 'public/images/exhibitors'

// `dark`: a light mark on a dark field. Trim the dark field instead of white,
// or the mark stays a speck in the middle of a dark tile. The field's colour is
// read from the top-left pixel (black, navy, teal...), so the pad matches it.
async function bake(src, slug, dark) {
  // An SVG renders at 72 dpi by default; draw it big so small lettering survives the downscale.
  const input = /\.svg$/i.test(src) ? sharp(src, { density: 300 }) : sharp(src)
  const flat = await input.flatten({ background: dark ? '#000000' : '#ffffff' }).png().toBuffer()
  let bg = '#ffffff'
  if (dark) {
    const { data } = await sharp(flat).extract({ left: 0, top: 0, width: 1, height: 1 }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    bg = { r: data[0], g: data[1], b: data[2] }
  }
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
  const out = fillWall(src.replace(/\r\n/g, '\n'), html)
  writeFileSync(path, out.replace(/\n/g, eol), 'utf8')
}

const FROM_APP = process.argv.includes('--from-app')
const srcDir = FROM_APP ? '' : process.argv[2]
mkdirSync(OUT, { recursive: true })
let all = [...EXHIBITORS].sort(byName).map((e) => ({ ...e, slug: slugOf(e.name) }))
const media = { ...MEDIA_PARTNER, slug: slugOf(MEDIA_PARTNER.name) }

// ---- the app's list (see the note in scripts/data/exhibitor-looks.mjs) ----
async function fromApp() {
  const base = (process.argv[process.argv.indexOf('--from-app') + 1] || '').startsWith('http') ? process.argv[process.argv.indexOf('--from-app') + 1] : SITE
  let rows
  try {
    const r = await fetch(base.replace(/\/$/, '') + '/api/events/1/exhibitors', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) })
    rows = r.ok ? await r.json() : null
  } catch { rows = null }
  if (!Array.isArray(rows) || !rows.length) return null
  const { list, gone } = matchWall(rows, [...all])
  for (const e of list) {
    // A logo uploaded in Admin wins: a 300 x 150 copy is baked into the site, once per upload.
    const logo = e.logoUrl || ''
    if (/^\/api\/uploads\//.test(logo)) {
      const mark = join(OUT, `${e.slug}.src`)
      if (!(existsSync(mark) && readFileSync(mark, 'utf8').trim() === logo && existsSync(join(OUT, `${e.slug}.webp`)))) {
        try {
          const r = await fetch(base.replace(/\/$/, '') + logo, { signal: AbortSignal.timeout(20000) })
          if (r.ok) {
            const tmp = join(OUT, `${e.slug}.upload`)
            writeFileSync(tmp, Buffer.from(await r.arrayBuffer()))
            await bake(tmp, e.slug, e.dark)
            writeFileSync(mark, logo + '\n')
            try { (await import('node:fs')).unlinkSync(tmp) } catch { /* left behind */ }
          }
        } catch (err) { console.log(`[exhibitors] ${e.name}: the uploaded logo could not be fetched (${err.message})`) }
      }
    } else if (/^\/images\/exhibitors\/[a-z0-9-]+\.webp$/.test(logo) && existsSync(join('public', logo))) {
      e.slug = logo.slice('/images/exhibitors/'.length, -'.webp'.length)
    }
  }
  if (gone.length) console.log(`[exhibitors] not in the app, so not on the website: ${gone.join(', ')}`)
  return list.sort(byName)
}
if (FROM_APP) {
  const list = await fromApp()
  if (!list) { console.log('[exhibitors] the app\'s exhibitor list could not be read: the committed blocks stand'); process.exit(0) }
  all = list
}

if (srcDir) {
  for (const e of [...all, media]) {
    if (!e.file) { console.log(`${e.name}: no source file, keeping ${e.slug}.webp`); continue }
    const src = join(srcDir, e.file)
    if (!existsSync(src)) throw new Error(`missing logo file: ${src}`)
    await bake(src, e.slug, e.dark)
  }
  const known = new Set([...all, media].map((e) => `${e.slug}.webp`))
  const stray = readdirSync(OUT).filter((f) => !known.has(f) && /\.webp$/.test(f))
  if (stray.length) console.log(`not in the list any more (delete if unwanted): ${stray.join(', ')}`)
}
// A company with no logo file shows its name in the logo's place.
for (const e of [...all, media]) if (existsSync(join(OUT, `${e.slug}.webp`))) Object.assign(e, await size(e.slug))
sizeWall(all)

for (const n of FEATURED) if (!all.some((e) => e.name === n)) { if (FROM_APP) console.log(`[exhibitors] FEATURED ${n} is not in the app`); else throw new Error(`FEATURED names an unknown exhibitor: ${n}`) }
const { home, grid, llms } = renderWall(all, media)

fill('public/mumbai.html', home)
fill('public/partner.html', home)
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
if (!FROM_APP) writeFileSync('scripts/sql/exhibitor-logos.sql', sql)

console.log(FROM_APP
  ? `${all.length} exhibitors from the app (${all.filter((e) => !e.appId).length} kept until the app has them, ${all.filter((e) => !e.w).length} without a logo) + media partner`
  : `${all.length} exhibitors + media partner; ${all.filter((e) => e.db).length} rows in scripts/sql/exhibitor-logos.sql`)
