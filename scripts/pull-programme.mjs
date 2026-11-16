// Pulls the conference programme and the speakers from the app, for the website.
//
// Since 16 Nov 2026 Admin -> Conference (the app's D1) is the only source of the
// programme. This script fetches it and writes the files the generators read:
//
//   node scripts/pull-programme.mjs                 from the live app (the public answer
//                                                   of GET /api/events/1/programme)
//   node scripts/pull-programme.mjs --from d1       straight from production D1 with
//                                                   wrangler (needs a wrangler login)
//   node scripts/pull-programme.mjs --from <url>    another host (a test harness)
//
// 1. scripts/data/programme.json: the answer as it came, with every uploaded photo
//    (/api/uploads/...) replaced by a 400px square copy saved under
//    public/images/speakers/<slug>.webp, so the website stays whole on its own.
// 2. scripts/data/schedule.json: the same programme in the website's shape (hall key,
//    day, start, end, type, label, speaker / panel / moderator), which
//    scripts/gen-schedule.mjs reads. Written by this script only, never by hand.
//
// Then run `node scripts/gen-schedule.mjs` and `node scripts/gen-speakers.mjs`, or
// `npm run sync:programme`, which is the three in a row. The Cloudflare Pages build runs
// the same three (prebuild) when CF_PAGES is set, so every deploy carries the programme
// as it is that minute; if the app cannot be reached the committed files are used.
//
// Nothing here touches the app. Leaves with 1 on a failure so a build notices.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { programmeFromApp, peopleOf, norm, slugOf } from './lib/programme.mjs'

const args = process.argv.slice(2)
const from = args.includes('--from') ? args[args.indexOf('--from') + 1] : 'https://bharataiinnovation.com'
const EVENT = Number(process.env.PROGRAMME_EVENT || 1)
const PHOTOS = 'images/speakers'
const lf = (t) => t.split('\r').join('')
const writeKeepingEol = (path, text) => {
  const eol = existsSync(path) && readFileSync(path, 'utf8').includes('\r\n') ? '\r\n' : '\n'
  writeFileSync(path, lf(text).replace(/\n/g, eol))
}

async function fromApi(base) {
  const url = base.replace(/\/$/, '') + `/api/events/${EVENT}/programme`
  const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) })
  if (!r.ok) throw new Error(`${url} answered ${r.status}`)
  const p = await r.json()
  if (!Array.isArray(p.sessions) || !Array.isArray(p.speakers)) throw new Error(`${url} did not answer a programme`)
  return { programme: p, base: base.replace(/\/$/, '') }
}

// The same answer, read from D1 with wrangler: for the first pull (before the endpoint
// was deployed) and for anyone who prefers not to depend on the site being up.
function fromD1() {
  // --command, never --file: a file goes through the import API, which answers with a
  // count of rows read and no rows. The SQL is double-quoted for the shell (cmd.exe on
  // Windows, sh elsewhere), so it must not carry a double quote itself.
  const q = (sql) => {
    if (sql.includes('"')) throw new Error('no double quotes in a pull query')
    const out = execSync(`npx wrangler d1 execute bharatai-production --remote --json --command "${sql}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
    const j = JSON.parse(out.slice(out.indexOf('[')))
    const rows = j[0].results
    if (rows.length && 'Total queries executed' in rows[0]) throw new Error('wrangler answered a summary, not rows')
    return rows
  }
  const event = q(`SELECT id, title, venue, start_date, end_date FROM events WHERE id = ${EVENT}`)[0]
  const speakers = q(`SELECT id, slug, name, role, organisation, topic, photo_url, bio, linkedin_url, is_featured, 1 AS is_published, sort_order FROM speakers WHERE event_id = ${EVENT} AND is_published = 1 ORDER BY sort_order, id`)
  const halls = q(`SELECT name, short_name, location, purpose, sort_order FROM conference_halls WHERE event_id = ${EVENT} AND is_active = 1 ORDER BY sort_order, id`)
  const talks = q(`SELECT id, company, speaker_name, speaker_title, topic, starts_at, duration_min, hall, speaker_photo_url AS photo_url, status FROM innovation_talks WHERE event_id = ${EVENT} AND COALESCE(status, 'confirmed') <> 'cancelled' ORDER BY starts_at IS NULL, starts_at, slot_no, id`)
  const sessions = q(`SELECT id, title, description, session_type, track, room, start_time, end_time, speaker_name, speaker_title FROM sessions WHERE event_id = ${EVENT} AND id NOT IN (SELECT session_id FROM session_admin WHERE status = 'draft') ORDER BY start_time, id`)
  const links = q(`SELECT ss.session_id, ss.speaker_id, ss.role FROM session_speakers ss JOIN sessions s ON s.id = ss.session_id WHERE s.event_id = ${EVENT} ORDER BY ss.session_id, ss.sort_order, ss.id`)
  const live = String((q(`SELECT value FROM app_settings WHERE key = 'site_live_conference'`)[0] || {}).value || '').trim().toLowerCase() === 'on'
  const byS = new Map()
  for (const l of links) { if (!byS.has(l.session_id)) byS.set(l.session_id, []); byS.get(l.session_id).push({ speaker_id: Number(l.speaker_id), role: l.role || '' }) }
  return { programme: { generated_at: new Date().toISOString(), live, event, halls, sessions: sessions.map((s) => ({ ...s, links: byS.get(s.id) || [] })), speakers, talks }, base: 'https://bharataiinnovation.com' }
}

// An uploaded photo lives in the app's bucket; the website keeps its own 400px copy.
async function localPhoto(base, url, slug) {
  const file = `${PHOTOS}/${slug}.webp`
  const path = join('public', file)
  if (existsSync(path)) {
    // The same upload keeps its copy; a new upload (a new key) is fetched again.
    const stamp = join('public', PHOTOS, `${slug}.src`)
    if (existsSync(stamp) && lf(readFileSync(stamp, 'utf8')).trim() === url) return '/' + file
  }
  const r = await fetch(base + url, { signal: AbortSignal.timeout(20000) })
  if (!r.ok) { console.log(`  could not fetch ${url} (${r.status}); the app's own address is kept`); return url }
  const buf = Buffer.from(await r.arrayBuffer())
  const sharp = (await import('sharp')).default
  mkdirSync(join('public', PHOTOS), { recursive: true })
  await sharp(buf).rotate().resize({ width: 400, height: 400, fit: 'cover', position: 'top' }).webp({ quality: 84 }).toFile(path)
  writeFileSync(join('public', PHOTOS, `${slug}.src`), url + '\n')
  console.log(`  saved ${file} from ${url}`)
  return '/' + file
}

const { programme, base } = from === 'd1' ? fromD1() : await fromApi(from)
console.log(`programme from ${from === 'd1' ? 'production D1' : base}: ${programme.sessions.length} sessions, ${programme.speakers.length} speakers, ${programme.talks.length} talks, ${programme.halls.length} halls`)
// Until the organiser's SQL of 16 Nov 2026 has run (it ends by switching this on), the app
// is behind the website: nothing is written, so a build keeps the committed pages.
if (!programme.live && !args.includes('--force')) {
  console.log('the app is not the source yet (app_settings.site_live_conference is not on): nothing written; --force overrides')
  process.exit(2)
}

// Uploaded photos -> website files.
for (const sp of programme.speakers) if (/^\/api\/uploads\//.test(sp.photo_url || '')) sp.photo_url = await localPhoto(base, sp.photo_url, sp.slug || slugOf(sp.name))
for (const t of programme.talks) if (/^\/api\/uploads\//.test(t.photo_url || '')) t.photo_url = await localPhoto(base, t.photo_url, 'talk-' + slugOf(t.speaker_name || t.company))

// Each session's people (the typed line, each found on the speakers list), kept in the
// JSON so a reader of programme.json sees who is who without the app's code.
const byNorm = new Map()
for (const sp of programme.speakers) { const k = norm(sp.name); if (k && !byNorm.has(k)) byNorm.set(k, sp) }
for (const s of programme.sessions) s.people = peopleOf(s, byNorm)

mkdirSync('scripts/data', { recursive: true })
writeKeepingEol('scripts/data/programme.json', JSON.stringify(programme, null, 1) + '\n')
const S = programmeFromApp(programme)
writeKeepingEol('scripts/data/schedule.json', JSON.stringify(S, null, 2) + '\n')
console.log(`wrote scripts/data/programme.json and scripts/data/schedule.json (${S.sessions.length} schedule rows, ${S.halls.length} halls)`)
