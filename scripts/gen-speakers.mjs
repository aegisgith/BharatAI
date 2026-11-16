// The speakers on the website, written from the app's speakers list (16 Nov 2026).
//
// Until now a confirmed speaker was hand-written in four places (the home grid and its
// JSON-LD, the conference grid, llms.txt) and separately in the app's speakers table,
// and the two drifted. Now Admin -> Conference is the source: run
//
//   node scripts/pull-programme.mjs      (writes scripts/data/programme.json from the app)
//   node scripts/gen-speakers.mjs
//
// and this writes, between <!-- speakers:start --> and <!-- speakers:end -->:
//   - public/conference.html: the ministers' grid, then every speaker (the worker draws
//     the same block live from D1, so this is the template and the fallback);
//   - public/index.html: the home grid (#spkGrid), everyone who is not a minister; the
//     ministers' row above it stays written by hand (its tags are marketing words);
//     and the Event's "performer" list in the page's JSON-LD;
//   - public/llms.txt: one line a person.
// The order is the app's (drag to reorder in Admin). A minister is anyone whose role says
// Minister or whose name opens Hon'ble. The topic chip is the speaker's "topic" in Admin.
// Pictures: the app's photo (a site file, or an upload copied by the pull script); the
// organisation's logo from scripts/data/schedule-people.json, by name, when there is one.
//
//   node scripts/gen-speakers.mjs --check     writes nothing; leaves with 1 if out of step.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { renderSpeakers, fillBlock, fillPerformers, hasBlock, makeDirectory, norm } from './lib/programme.mjs'

const CHECK = process.argv.includes('--check')
const lf = (t) => t.split('\r').join('')
const json = (p) => JSON.parse(lf(readFileSync(p, 'utf8')))
const programme = json('scripts/data/programme.json')
const directory = makeDirectory(json('scripts/data/schedule-people.json').people)
const drift = []
function put(path, text) {
  const raw = readFileSync(path, 'utf8')
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const next = lf(text).replace(/\n/g, eol)
  if (raw === next) return
  if (CHECK) drift.push(path)
  else writeFileSync(path, next)
}
const dims = new Map()
async function size(file) {
  if (!dims.has(file)) { try { const m = await sharp(join('public', file)).metadata(); dims.set(file, { w: m.width, h: m.height }) } catch { dims.set(file, { w: 400, h: 400 }) } }
  return dims.get(file)
}
const siteFile = (url) => String(url || '').replace(/^\//, '')
const onDisk = (f) => !!f && !/^https?:|^api\//.test(f) && existsSync(join('public', f))

// Sizes first (sharp is async; the renderer is not).
const photoDims = new Map(), logoDims = new Map()
for (const sp of programme.speakers) {
  const f = siteFile(sp.photo_url)
  if (onDisk(f)) photoDims.set(sp.id, { src: f, ...(await size(f)) })
  else if (/^https?:|^\/api\//.test(sp.photo_url || '')) photoDims.set(sp.id, { src: sp.photo_url, w: 400, h: 400 })
  const d = directory.get(norm(sp.name))
  if (d?.logo && onDisk(d.logo)) logoDims.set(sp.id, { src: d.logo, ...(await size(d.logo)) })
}
const r = renderSpeakers(programme.speakers, { photoOf: (sp) => photoDims.get(sp.id) || null, logoOf: (sp) => logoDims.get(sp.id) || null })

for (const [page, fill] of [
  ['public/conference.html', (t) => fillBlock(t, 'speakers', r.conference)],
  ['public/index.html', (t) => fillPerformers(fillBlock(t, 'speakers', r.home), r.performers)],
  ['public/llms.txt', (t) => fillBlock(t, 'speakers', '## Confirmed speakers\n\n' + r.llms + '\n')],
]) {
  const src = lf(readFileSync(page, 'utf8'))
  if (!hasBlock(src, 'speakers')) throw new Error(`${page}: speakers markers missing`)
  put(page, fill(src))
}
const noPhoto = programme.speakers.filter((sp) => !photoDims.has(sp.id)).map((sp) => sp.name)
console.log(`${r.ministers.length} ministers and ${r.others.length} speakers from the app ${CHECK ? 'checked' : 'written'} on /conference, the home page (and its JSON-LD) and llms.txt`)
if (noPhoto.length) console.log(`No photo (initials shown): ${noPhoto.join('; ')}`)
if (CHECK) {
  if (drift.length) console.log(`Out of step with programme.json (run node scripts/gen-speakers.mjs): ${drift.join('; ')}`)
  else console.log('In step: the speaker grids are what the app gives.')
  process.exit(drift.length ? 1 : 0)
}
