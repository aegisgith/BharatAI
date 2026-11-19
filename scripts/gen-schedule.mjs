// The conference schedule on /conference, written from the app's programme.
//
// Since 16 Nov 2026 the app (Admin -> Conference, the sessions and speakers tables in
// D1) is the only source of the programme. scripts/data/schedule.json is no longer
// written by hand: `node scripts/pull-programme.mjs` fetches the live programme and
// writes it (and scripts/data/programme.json, the raw answer). Then
//
//   node scripts/gen-schedule.mjs
//
// 1. public/conference.html, between <!-- schedule:start --> and <!-- schedule:end -->:
//    a tab per hall and a combined "Full Schedule" tab, two days each. Each keynote,
//    talk, workshop and panel lists its people: a small round photo, the name, the
//    designation and the department or organisation with its logo beside it. The words
//    are the app's (a speaker's role and organisation as Admin holds them); the pictures
//    come from scripts/data/schedule-people.json (photo, logo, a crop for a face that is
//    off-centre), then from the Innovation Talks wall for exhibitors' speakers. Someone
//    in neither still shows: initials in place of a photo, the words the app gives.
// 2. public/images/sched/: a 144px photo and a 48px-high logo per person on the
//    schedule, so a phone opening a panel of ten does not download ten portraits.
//    Rebuilt on every run; a file no session uses any more is removed. This folder is
//    this script's alone: never put a hand-made file in it.
// 3. public/images/sched/manifest.json: which small picture is whose, with its size.
//    The worker reads it to draw the same schedule live from D1 (src/routes/site-live.ts),
//    so a person added in Admin after the last build shows with their full photo until
//    the next build bakes a small one.
// 4. The Tracks section (<!-- tracks:start --> ... <!-- tracks:end -->) and the page's
//    FAQ answer on how many tracks there are: every real session grouped by track, with
//    the words about each track from scripts/data/tracks.json.
//
// The rendering itself is scripts/lib/programme.mjs, shared with the worker.
//
//   node scripts/gen-schedule.mjs --check
//
// writes nothing: it says whether the page, the manifest and the small pictures on disk
// are exactly what this script would write from the JSON today, and leaves with 1 if
// not (scripts/verify/unit-schedule-people.mjs runs it).
//
// There is no SQL output any more: the app is the source, the website follows it.
// Running the old scripts/sql/schedule.sql would have deleted the team's work in Admin.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import sharp from 'sharp'
import { makeDirectory, resolvePeople, renderConference, fillBlock, fillFaq, slugOf, norm, poweredLogoFiles } from './lib/programme.mjs'

const PAGE = 'public/conference.html'
const THUMBS = 'images/sched'
const MANIFEST = join('public', THUMBS, 'manifest.json')
const CHECK = process.argv.includes('--check')
const lf = (t) => t.split('\r').join('')
const json = (p) => JSON.parse(lf(readFileSync(p, 'utf8')))
const S = json('scripts/data/schedule.json')
const TALKS_JSON = json('scripts/data/innovation-talks.json')
const PEOPLE = json('scripts/data/schedule-people.json').people
const TRACKS = json('scripts/data/tracks.json').tracks
const drift = []
function put(path, data) {
  if (!CHECK) return writeFileSync(path, data)
  const same = (have) => (Buffer.isBuffer(data) ? have.equals(data) : lf(have.toString('utf8')) === lf(data))
  if (!existsSync(path) || !same(readFileSync(path))) drift.push(path)
}
const onDisk = (file) => !!file && !/^https?:|^\/api\//.test(file) && existsSync(join('public', file))

// Expo Hall rows ("Innovation Talk: <company>") name the company; the speaker and topic
// come with the app's talks (programmeFromApp sets `talk`), or, for a schedule.json
// written before the app became the source, from innovation-talks.json.
// The first presenter listed for a company, as the wall shows them.
const talkJsonByCo = new Map()
for (const t of TALKS_JSON) if (!talkJsonByCo.has(t.company)) talkJsonByCo.set(t.company, t)
for (const s of S.sessions) {
  if (!s.company) continue
  const t = talkJsonByCo.get(s.company) || TALKS_JSON.find((x) => s.talk && norm(x.name) === norm(s.talk.name))
  if (s.talk) {
    // The app's talk, with the topic written for the website when the app has none yet.
    if (t && !s.talk.topic && t.topic) s.talk.topic = t.topic
    continue
  }
  if (t) { s.talk = { name: t.name, title: t.title || '', company: s.company, topic: t.topic || '', slug: t.slug, logoFile: t.logoFile || '' }; if (/to be announced/i.test(s.note || '')) delete s.note }
  else s.note = s.note || 'Speaker to be announced.'
}
// An exhibitor's speaker: the photo and logo the Innovation Talks wall already uses, or
// the photo the app holds for them.
// A row found only by company (the app changed the speaker) gives the company's logo,
// never its old speaker's photo: Paisani's talk showed Dipak Zope's face under Archana
// Ambekar Shedge's name (19 Nov 2026).
function talkFiles(talk) {
  const byName = TALKS_JSON.find((t) => norm(t.name) === norm(talk.name))
  const fromJson = byName || talkJsonByCo.get(talk.company)
  const slug = talk.slug || byName?.slug || slugOf(talk.name)
  const photo = [`images/talks/${slug}.webp`, String(talk.photo || '').replace(/^\//, '')].find(onDisk) || ''
  const logo = [talk.logoFile, fromJson?.logoFile, `images/exhibitors/${slugOf(talk.company)}.webp`].find(onDisk) || ''
  return { photo, logo, crop: null }
}

const directory = makeDirectory(PEOPLE)
for (const p of PEOPLE) for (const f of [p.photo, p.logo]) if (f && !onDisk(f)) throw new Error(`schedule-people.json: ${p.name}: no such file public/${f}`)
// An exhibitor's presenter who also speaks in a hall (CGI's talk in Kalam Theatre): the
// photo and logo the Innovation Talks wall already uses, unless the directory knows them.
for (const t of TALKS_JSON) {
  const k = norm(t.name)
  if (!k || directory.has(k)) continue
  directory.set(k, { name: t.name, role: t.title || '', org: t.company, photo: onDisk(`images/talks/${t.slug}.webp`) ? `images/talks/${t.slug}.webp` : '', logo: [t.logoFile, `images/exhibitors/${slugOf(t.company)}.webp`].find(onDisk) || '' })
}
const { used, unknown } = resolvePeople(S, { directory, talkFiles, onDisk })

// The small photos and logos. Always rebuilt, so a new portrait or a changed crop shows
// without anyone remembering a flag; the same picture gives the same bytes.
const made = new Map()
const stamp = (buf) => createHash('md5').update(buf).digest('hex').slice(0, 8)
async function bake(key, name, build) {
  if (!made.has(key)) {
    const buf = await build()
    put(join('public', THUMBS, name), buf)
    const m = await sharp(buf).metadata()
    made.set(key, { src: `${THUMBS}/${name}?v=${stamp(buf)}`, name, w: m.width, h: m.height })
  }
  return made.get(key)
}
async function bakePhoto(p) {
  return bake(`photo:${p.slug}`, `${p.slug}.webp`, async () => {
    let img = sharp(join('public', p.photo)).rotate()
    if (p.crop?.size) {
      const m = await img.metadata()
      const size = Math.round(m.width * p.crop.size)
      const left = Math.round(m.width * p.crop.left), top = Math.round(m.height * p.crop.top)
      img = img.extract({ left, top, width: Math.min(size, m.width - left), height: Math.min(size, m.height - top) })
    }
    return img.resize({ width: 144, height: 144, fit: 'cover', position: 'top' }).flatten({ background: '#ffffff' }).webp({ quality: 82 }).toBuffer()
  })
}
// A logo: its empty margin trimmed off, so every mark fills its own box, then sized as
// the exhibitor wall sizes them, a wide wordmark lower than a square seal. Only a white
// or see-through margin is trimmed: a logo drawn on its own coloured tile keeps the tile.
async function bakeLogo(file) {
  const name = 'logo-' + slugOf(file.split('/').pop().replace(/\.[a-z]+$/, '').replace(/^(logo|favicon)-/, '')) + '.webp'
  const m = await bake(`logo:${file}`, name, async () => {
    const src = join('public', file)
    const corner = (await sharp(src).ensureAlpha().extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer())
    const empty = corner[3] < 16 || (corner[0] > 240 && corner[1] > 240 && corner[2] > 240)
    const trimmed = empty ? await sharp(src).trim().toBuffer().catch(() => readFileSync(src)) : readFileSync(src)
    return sharp(trimmed).resize({ width: 184, height: 80, fit: 'inside', withoutEnlargement: true }).webp({ quality: 90, alphaQuality: 100 }).toBuffer()
  })
  const r = m.w / m.h
  let h = Math.min(40, Math.max(20, 40 * Math.pow(r, -0.4)))
  if (h * r > 92) h = 92 / r
  m.lw = Math.round(h * r)
  m.lh = Math.round(h)
  return m
}
mkdirSync(join('public', THUMBS), { recursive: true })
const manifest = { about: 'Written by scripts/gen-schedule.mjs: the small picture of each person and logo on the conference schedule, by person slug and by logo file. Read by the worker to draw /conference live from the app.', photos: {}, logos: {} }
for (const s of S.sessions) {
  for (const p of s.people) {
    if (p.photo && onDisk(p.photo)) { p.thumb = await bakePhoto(p); manifest.photos[p.slug] = { src: p.thumb.src, w: p.thumb.w, h: p.thumb.h } }
    else if (/^\/api\/uploads\//.test(p.photo || '')) p.thumb = { src: p.photo, w: 144, h: 144 }
    if (p.logo) { p.mark = await bakeLogo(p.logo); manifest.logos[p.logo] = { src: p.mark.src, w: p.mark.w, h: p.mark.h, lw: p.mark.lw, lh: p.mark.lh } }
  }
}
// Every logo the directory knows, baked too, so the worker can draw a person the
// directory names who joins a panel after this build.
for (const p of PEOPLE) if (p.logo && !manifest.logos[p.logo]) { const m = await bakeLogo(p.logo); manifest.logos[p.logo] = { src: m.src, w: m.w, h: m.h, lw: m.lw, lh: m.lh } }
// A session's sponsor ("Powered by EXENI." in its description): its logo in org-logos/, else
// the exhibitor wall's.
for (const s of S.sessions) { const f = s.poweredBy ? poweredLogoFiles(s.poweredBy).find(onDisk) : ''; if (f && !manifest.logos[f]) { const m = await bakeLogo(f); manifest.logos[f] = { src: m.src, w: m.w, h: m.h, lw: m.lw, lh: m.lh } } }
for (const p of PEOPLE) if (p.photo && !manifest.photos[norm(p.name).replace(/ /g, '-')]) { const q = { slug: norm(p.name).replace(/ /g, '-'), photo: p.photo, crop: p.crop || null }; const t = await bakePhoto(q); manifest.photos[q.slug] = { src: t.src, w: t.w, h: t.h } }
const kept = new Set([...[...made.values()].map((m) => m.name), 'manifest.json'])
for (const f of readdirSync(join('public', THUMBS))) {
  if (kept.has(f)) continue
  if (CHECK) drift.push(`${join('public', THUMBS, f)} (no session uses it)`)
  else unlinkSync(join('public', THUMBS, f))
}

const pictures = (p) => ({ thumb: p.thumb || null, mark: p.mark || null })
const r = renderConference(S, { tracks: TRACKS, pictures, logoOf: (f) => manifest.logos[f] || null })

// Replace the text between each pair of markers, keeping the file's line endings.
const src = readFileSync(PAGE, 'utf8')
const eol = src.includes('\r\n') ? '\r\n' : '\n'
let out = lf(src)
out = fillBlock(out, 'schedule', r.schedule)
out = fillBlock(out, 'tracks', r.tracks)
out = fillFaq(out, r.faq)
put(PAGE, out.replace(/\n/g, eol))
put(MANIFEST, JSON.stringify(manifest, null, 1) + '\n')

console.log(`${S.sessions.length} schedule rows; ${PAGE} and ${MANIFEST} ${CHECK ? 'checked' : 'written'}; programme from ${S.source || 'schedule.json'}`)
const shown = new Map(S.sessions.flatMap((s) => s.people).map((p) => [p.slug, p]))
const noPhoto = [...shown.values()].filter((p) => !p.thumb).map((p) => p.name)
const noLogo = [...shown.values()].filter((p) => !p.logo && p.org).map((p) => `${p.name} (${p.org})`)
console.log(`${shown.size} people on the schedule; ${kept.size - 1} pictures in public/${THUMBS}`)
if (unknown.size) console.log(`Known to neither the app nor schedule-people.json (shown with initials and the words the programme gives): ${[...unknown].join('; ')}`)
if (noPhoto.length) console.log(`No photo (initials shown): ${noPhoto.join('; ')}`)
if (noLogo.length) console.log(`No logo (organisation named in words): ${noLogo.join('; ')}`)
if (r.unknownTracks.length) console.log(`Tracks with no words in scripts/data/tracks.json (shown by name only): ${r.unknownTracks.join('; ')}`)
const stale = PEOPLE.filter((p) => !used.has(norm(p.name))).map((p) => p.name)
if (stale.length) console.log(`In schedule-people.json but in no session: ${stale.join('; ')}`)
if (CHECK) {
  if (drift.length) console.log(`Out of step with the JSON (run node scripts/gen-schedule.mjs): ${drift.join('; ')}`)
  else console.log('In step: the page, the manifest and the pictures are what the JSON gives.')
  process.exit(drift.length ? 1 : 0)
}
