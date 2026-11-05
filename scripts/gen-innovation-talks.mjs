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

const DATA = 'scripts/data/innovation-talks.json'
const OUT = 'public/images/talks'
const SQL = 'scripts/sql/innovation-talks.sql'

const talks = JSON.parse(readFileSync(DATA, 'utf8'))

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const sq = (s) => String(s ?? '').replace(/'/g, "''")
const initials = (name) => name.replace(/^(Dr\.?|Mr\.?|Ms\.?)\s+/, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')

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
  const s = src.replace(/\r\n/g, '\n')
  const a = s.indexOf('<!-- talks:start'), b = s.indexOf('<!-- talks:end -->')
  if (a < 0 || b < 0) throw new Error(`${path}: talks markers missing`)
  const lineStart = s.lastIndexOf('\n', a) + 1
  const ind = s.slice(lineStart, a)
  const startLine = s.slice(a, s.indexOf('\n', a) + 1)
  const indented = body.split('\n').map((l) => (l ? ind + l : l)).join('\n')
  const out = s.slice(0, lineStart) + ind + startLine + indented + ind + s.slice(b)
  writeFileSync(path, out.replace(/\n/g, eol), 'utf8')
}

const srcDir = process.argv[2]
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
  t.hasPhoto = existsSync(join(OUT, `${t.slug}.webp`))
}

// Each card carries the company's logo from the exhibitor wall (made by
// scripts/gen-exhibitor-logos.mjs): every talk is an exhibitor's, and the JSON names
// the company as the wall does. The organiser's "Presenter Logo" folder (4 Nov 2026)
// pairs each presenter with that same logo. Sized as the wall sizes them, a wide
// wordmark lower than a square mark, so they read at the same weight. A company
// with no logo on the wall gets its name only. A speaker who is not an exhibitor (a
// government department showing its work) names their logo in the JSON's "logoFile".
const slugOf = (name) => name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
for (const t of talks) {
  const file = t.logoFile || `images/exhibitors/${slugOf(t.company)}.webp`
  if (!existsSync(join('public', file))) continue
  const m = await sharp(join('public', file)).metadata()
  const r = m.width / m.height
  let h = Math.min(34, Math.max(18, 30 * Math.pow(r, -0.4)))
  if (h * r > 120) h = 120 / r
  t.logo = { file, w: m.width, h: m.height, dh: Math.round(h) }
}
const logo = (t, margin) => t.logo
  ? `<img width="${t.logo.w}" height="${t.logo.h}" loading="lazy" decoding="async" src="${t.logo.file}" alt="" class="talk-logo" style="display:block;height:${t.logo.dh}px;width:auto;max-width:120px;margin:${margin};position:relative;z-index:1;">\n    `
  : ''

// ---- exhibition.html: a speaker wall ----
const cards = talks.map((t) => {
  const alt = `${t.name}, ${t.title ? t.title + ', ' : ''}${t.company}`
  const photo = t.hasPhoto
    ? `<img width="320" height="320" loading="lazy" decoding="async" src="images/talks/${t.slug}.webp" alt="${esc(alt)}" class="speaker-photo" style="aspect-ratio:1;border-radius:50%;width:120px;height:120px;margin:0 auto;object-fit:cover;">`
    : `<div class="speaker-photo" aria-hidden="true" style="width:120px;height:120px;margin:0 auto;border-radius:50%;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,rgba(255,107,0,0.14),rgba(57,73,171,0.14));color:var(--indigo-light);font-family:var(--font-display);font-weight:800;font-size:2rem;">${esc(initials(t.name))}</div>`
  const topic = t.topic
    ? `<p class="talk-topic" style="font-size:0.84rem;color:var(--charcoal);line-height:1.45;margin:0.6rem 0 0;">&ldquo;${esc(t.topic)}&rdquo;</p>`
    : `<p class="talk-topic" style="font-size:0.8rem;color:var(--dark-grey);margin:0.6rem 0 0;">Topic to be announced</p>`
  return `<div class="speaker-card reveal" style="text-align:center;align-items:center;">
    ${photo}
    <h4>${esc(t.name)}</h4>
    ${t.title ? `<p style="font-size:0.8rem;color:var(--saffron);font-weight:600;margin:0;">${esc(t.title)}</p>` : ''}
    ${logo(t, '0 auto')}<p class="spk-org" style="font-size:0.78rem;">${esc(t.company)}</p>
    ${topic}
</div>`
})
fill('public/exhibition.html', `<div class="speakers-grid">\n${cards.join('\n')}\n</div>\n`)

// ---- conference.html: the same speakers in that page's card style ----
const confCards = talks.map((t) => {
  const alt = `${t.name}, ${t.title ? t.title + ', ' : ''}${t.company}`
  const avatar = t.hasPhoto
    ? `<div class="speaker-avatar"><img width="320" height="320" loading="lazy" decoding="async" src="images/talks/${t.slug}.webp" alt="${esc(alt)}"></div>`
    : `<div class="speaker-avatar" aria-hidden="true"><span style="color:#fff;font-family:var(--font-display);font-weight:800;font-size:1.4rem;letter-spacing:0.02em;">${esc(initials(t.name))}</span></div>`
  const topic = t.topic
    ? `<p class="talk-topic" style="font-size:0.84rem;color:var(--charcoal);line-height:1.45;margin:0.6rem 0 0;position:relative;z-index:1;">&ldquo;${esc(t.topic)}&rdquo;</p>`
    : `<p class="talk-topic" style="font-size:0.8rem;color:var(--dark-grey);margin:0.6rem 0 0;position:relative;z-index:1;">Topic to be announced</p>`
  return `<div class="speaker-card reveal">
    ${avatar}
    <h4>${esc(t.name)}</h4>
    ${t.title ? `<div class="speaker-role">${esc(t.title)}</div>` : ''}
    ${logo(t, '0.6rem auto 0.3rem')}<div class="speaker-org">${esc(t.company)}</div>
    ${topic}
</div>`
})
fill('public/conference.html', `<div class="speakers-grid">\n${confCards.join('\n')}\n</div>\n`)

// ---- llms.txt ----
const lines = talks.map((t) => `- **${t.name}** (${t.title ? t.title + ', ' : ''}${t.company})${t.topic ? ' — ' + t.topic : ''}`)
fill('public/llms.txt', [
  '## Innovation Talk & Showcase speakers',
  '',
  `${talks.length} stage talks by exhibitors and government departments at Bharat AI Innovation 2026, 20–21 November, WTC Mumbai (hall and times to be announced):`,
  ...lines,
  '',
].join('\n') + '\n')

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
writeFileSync(SQL, sql.join('\n'), 'utf8')

console.log(`${talks.length} speakers, ${talks.filter((t) => t.hasPhoto).length} with photos; ${SQL} rewritten`)
