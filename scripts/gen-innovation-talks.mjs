// Innovation Talk & Showcase speakers: one list, three outputs.
//
//   node scripts/gen-innovation-talks.mjs "<folder of speaker photos>"
//
// The list is scripts/data/innovation-talks.json (name, title, company, topic,
// photo file, slug), prepared from the organiser's "Innovation Talk" sheet. Edit
// the JSON and re-run. Run with no folder to rebuild the HTML/SQL from the photos
// already in the repo.
//
// 1. public/images/talks/<slug>.webp - a 320px square headshot per speaker who
//    sent one (cropped towards the top, where heads are). A photo that arrives
//    inside a PDF (Trust3 AI's did, 23 Oct 2026) cannot be read by sharp: copy the
//    folder somewhere else, save the PDF's embedded image beside the others under
//    the name the JSON gives (pypdf: PdfReader(pdf).pages[0].images[0].data), and
//    run against that copy.
//    The 4 Nov 2026 export renamed every older photo (same files, new names), so
//    the JSON keeps the 23 Oct export's names; the presenters added that day are in
//    its "4 Nov Presentor" folder. Run against a copy of the 23 Oct folder with the
//    4 Nov files added, kept in a short path such as c:\tmp: the longest names pass
//    Windows' 260-character limit from the scratchpad, and sharp cannot open them.
//    A speaker whose JSON "photo" is empty (Shri Vivek Khandekar's came by chat, 5 Nov
//    2026) keeps the file already in public/images/talks: nothing rebakes it.
// 2. The block between <!-- talks:start --> and <!-- talks:end --> in
//    public/exhibition.html (the speaker wall under "Innovation Stage") and in
//    public/llms.txt (so AI assistants can name the speakers and topics).
// 3. scripts/sql/innovation-talks.sql - inserts the same speakers into the
//    innovation_talks table the app's Innovation Talks tab and the /admin tab read.
//    The organiser runs it; it never inserts a speaker twice. Hall and time are
//    left for the admin tab to fill in later, so time_slot is "To be announced".
//
// Hall and times are not known yet. When they are, set them in /admin (Innovation
// Talks) for the app; this page says "hall and times to be announced" until the
// copy below is updated.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { EXHIBITORS } from './data/exhibitor-looks.mjs'
import { slugOf, talksFromApp, talkLogoFiles, sizeTalkLogo, renderTalks, fillTalks } from './lib/exhibit-site.mjs'

// The markup is scripts/lib/exhibit-site.mjs, shared with the Worker, which draws the
// same cards live from the app on every request (src/routes/site-live.ts, 18 Nov 2026).

const DATA = 'scripts/data/innovation-talks.json'
const OUT = 'public/images/talks'
const SQL = 'scripts/sql/innovation-talks.sql'

const listed = JSON.parse(readFileSync(DATA, 'utf8'))

// --from-app (18 Nov 2026, organiser: "if someone is on the web it should be on the app
// and vice versa"): the talks are the app's (Admin -> Innovation Talks), read from
// scripts/data/programme.json, which scripts/pull-programme.mjs writes just before
// (an uploaded photo is already copied to public/images/speakers/talk-<slug>.webp).
// The app's name, designation, company, topic and photo win; the JSON only adds what
// the app does not hold (the logo file, the government order, a topic the app lacks).
// Run by scripts/sync-programme.mjs on every Pages build. Writes no SQL.
const FROM_APP = process.argv.includes('--from-app')
function fromApp() {
  let p
  try { p = JSON.parse(readFileSync('scripts/data/programme.json', 'utf8')) } catch { return null }
  if (!Array.isArray(p.talks) || !p.talks.length) return null
  return talksFromApp(p.talks, listed)
}
const talks = (FROM_APP && fromApp()) || listed
if (FROM_APP && talks === listed) { console.log('[talks] the app\'s talks could not be read: the committed blocks stand'); process.exit(0) }

const sq = (s) => String(s ?? '').replace(/'/g, "''")

async function bake(src, slug, crop) {
  // Square crop biased towards the top third: portraits put the head there. A
  // photo that is not a portrait (a hall shot, a very tall frame) carries its own
  // box in the JSON: left/top/size as fractions of the source (size of the width).
  // `pad` first widens the source by that fraction of its width on each side,
  // repeating the edge pixels, for a passport photo whose head is taller than the
  // frame is wide: without it the round frame on the page cuts off the chin.
  let img = sharp(src).rotate()
  if (crop?.pad) {
    const { data, info } = await img.png().toBuffer({ resolveWithObject: true })
    const px = Math.round(info.width * crop.pad)
    img = sharp(await sharp(data).extend({ left: px, right: px, extendWith: 'copy' }).png().toBuffer())
  }
  if (crop?.size) {
    const m = await img.metadata()
    const w = m.width, h = m.height
    const size = Math.round(w * crop.size)
    img = img.extract({ left: Math.round(w * crop.left), top: Math.round(h * crop.top), width: Math.min(size, w), height: Math.min(size, h) })
  }
  // A cut-out with a transparent background (LightMetrics sent one) is laid on
  // white, like the studio shots, so it still fills its round frame.
  const buf = await img.resize({ width: 320, height: 320, fit: 'cover', position: 'top' })
    .flatten({ background: '#ffffff' })
    .webp({ quality: 88 }).toBuffer()
  writeFileSync(join(OUT, `${slug}.webp`), buf)
}

// Replace the text between the markers, keeping the file's BOM and line endings.
function fill(path, body) {
  const src = readFileSync(path, 'utf8')
  const eol = src.includes('\r\n') ? '\r\n' : '\n'
  const out = fillTalks(src.replace(/\r\n/g, '\n'), body)
  writeFileSync(path, out.replace(/\n/g, eol), 'utf8')
}

const srcDir = FROM_APP ? '' : process.argv[2]
mkdirSync(OUT, { recursive: true })

if (srcDir) {
  for (const t of talks) {
    if (!t.photo) continue
    const src = join(srcDir, t.photo)
    if (!existsSync(src)) throw new Error(`missing photo: ${src}`)
    await bake(src, t.slug, t.crop)
  }
}
for (const t of talks) {
  // The app's photo first (an Admin upload), then the baked file.
  t.photoSrc = [t.photoSrc, `images/talks/${t.slug}.webp`].find((f) => f && existsSync(join('public', f))) || ''
  t.hasPhoto = !!t.photoSrc
}

// Each card carries the company's logo from the exhibitor wall (made by
// scripts/gen-exhibitor-logos.mjs): every talk is an exhibitor's, and the JSON names
// the company as the wall does. The organiser's "Presenter Logo" folder (4 Nov 2026)
// pairs each presenter with that same logo. Sized as the wall sizes them, a wide
// wordmark lower than a square mark, so they read at the same weight. A company
// with no logo on the wall gets its name only. A speaker who is not an exhibitor (a
// government department showing its work) names their logo in the JSON's "logoFile".
const looks = EXHIBITORS.map((e) => ({ ...e, slug: slugOf(e.name) }))
for (const t of talks) {
  const file = talkLogoFiles(t, looks).find((f) => existsSync(join('public', f)))
  if (!file) continue
  const m = await sharp(join('public', file)).metadata()
  sizeTalkLogo(t, { file, w: m.width, h: m.height })
}

const out = renderTalks(talks)
fill('public/exhibition.html', out.exhibition)
fill('public/conference.html', out.conference)
fill('public/llms.txt', out.llms)

// ---- SQL for the app (organiser runs it) ----
const sql = [
  '-- Innovation Talk & Showcase speakers for the app\'s Innovation Talks tab.',
  '-- Generated by scripts/gen-innovation-talks.mjs from scripts/data/innovation-talks.json.',
  '-- Safe to run again: a speaker already in innovation_talks for this event is skipped,',
  '-- and a photo that arrived after the first import is filled in only where the row',
  '-- has none, so a photo already set (in /admin, say) is never replaced.',
  '-- Hall and time are set later in /admin (Innovation Talks); until then the app',
  '-- lists these under "Speakers announced" with the time to be announced.',
  '--',
  '--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/innovation-talks.sql',
  '',
]
talks.forEach((t, i) => {
  const photo = t.hasPhoto ? `/images/talks/${t.slug}.webp` : ''
  sql.push(
    `INSERT INTO innovation_talks (event_id, slot_no, session_type, time_slot, speaker_name, company, topic, status, speaker_title, speaker_photo_url, notes)`,
    `SELECT 1, ${i + 1}, 'Morning', 'To be announced', '${sq(t.name)}', '${sq(t.company)}', '${sq(t.topic)}', 'confirmed', '${sq(t.title)}', '${photo}', 'Imported from the Innovation Talk sheet, 12 Oct 2026'`,
    `WHERE NOT EXISTS (SELECT 1 FROM innovation_talks WHERE event_id = 1 AND speaker_name = '${sq(t.name)}' AND company = '${sq(t.company)}');`,
    '',
  )
  if (photo) sql.push(
    `UPDATE innovation_talks SET speaker_photo_url = '${photo}'`,
    `WHERE event_id = 1 AND speaker_name = '${sq(t.name)}' AND company = '${sq(t.company)}' AND COALESCE(speaker_photo_url, '') = '';`,
    '',
  )
})
if (!FROM_APP) writeFileSync(SQL, sql.join('\n'), 'utf8')

console.log(`${talks.length} speakers, ${talks.filter((t) => t.hasPhoto).length} with photos; ${FROM_APP ? 'from the app, no SQL written' : SQL + ' rewritten'}`)
