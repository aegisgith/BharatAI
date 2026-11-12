// The conference schedule: one list, two outputs, the same pattern as
// gen-innovation-talks.mjs.
//
// The list is scripts/data/schedule.json, written by hand from the organiser's agenda
// workbook in Drive ("BHAI Nov 2026_Agenda_Panel & Innovation Talk.xlsx"). The
// workbook carries internal notes, tentative names and speakers who have since come
// off the site, so it is never copied across blindly: edit the JSON, then run
//
//   node scripts/gen-schedule.mjs
//
// 1. public/conference.html, between <!-- schedule:start --> and <!-- schedule:end -->:
//    a tab per hall and a combined "Full Schedule" tab, two days each. The event's
//    hall names map to the venue's rooms (organiser, 12 Nov 2026, Kalam and Aryabhata
//    swapped that day): Homi J. Bhabha Hall = Peacock Hall, Kalam Theatre = Centrum Hall
//    A, Raman Theatre = Centrum Hall B, Aryabhata Theatre = the Expo Hall. The hall
//    keys in schedule.json name the ROOMS (key "kalam" is the Expo Hall, key
//    "aryabhata" is Centrum Hall A); only their "name" changed. Each hall tab says
//    which room it is.
// 2. scripts/sql/schedule.sql: replaces the app's sessions for event 1 (the app's
//    Conference Schedule tab reads them) and sets the workshops' times and room.
//    The organiser runs it.
//
// Expo Hall (Innovation Talks) rows name only the company: the speaker and topic come from
// scripts/data/innovation-talks.json, so a talk changes in one place.
//
// The people in a session (organiser, 12 Nov 2026: "speaker photo small, designation,
// department along with logo of govt organisation, if no logo name of organisation").
// Each keynote, talk, workshop and panel lists its people as a small round photo, the
// name, the designation, and the department or organisation with its logo beside it.
// Who is who comes from scripts/data/schedule-people.json (matched by name, ignoring
// Shri / Dr. / (IAS) and the like), then from innovation-talks.json for exhibitors'
// speakers. Someone in neither still shows: initials in place of a photo, and the
// words schedule.json gives. No logo on file: the organisation is named in words only.
// 3. public/images/sched/: a 144px photo and a 48px-high logo per person on the
//    schedule, cut from the photos already on the site, so a phone opening a panel of
//    ten does not download ten full-size portraits. Rebuilt on every run; a file no
//    session uses any more is removed. A photo whose face is off-centre takes a
//    "crop" in schedule-people.json (left, top, size as fractions, as the talks do).
//    This folder is this script's alone: never put a hand-made file in it.
// The app's SQL is untouched by any of this.
//
//   node scripts/gen-schedule.mjs --check
//
// writes nothing: it says whether the page, the SQL and the small pictures on disk
// are exactly what this script would write from the JSON today, and leaves with 1 if
// not (scripts/verify/unit-schedule-people.mjs runs it).
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import sharp from 'sharp'

const PAGE = 'public/conference.html'
const SQL = 'scripts/sql/schedule.sql'
const S = JSON.parse(readFileSync('scripts/data/schedule.json', 'utf8'))
const talks = JSON.parse(readFileSync('scripts/data/innovation-talks.json', 'utf8'))
const PEOPLE = JSON.parse(readFileSync('scripts/data/schedule-people.json', 'utf8')).people
const THUMBS = 'images/sched'
const CHECK = process.argv.includes('--check')
const drift = []
const lf = (t) => t.split('\r').join('')
function put(path, data) {
  if (!CHECK) return writeFileSync(path, data)
  const same = (have) => (Buffer.isBuffer(data) ? have.equals(data) : lf(have.toString('utf8')) === lf(data))
  if (!existsSync(path) || !same(readFileSync(path))) drift.push(path)
}
const DATE = { 1: '2026-11-20', 2: '2026-11-21' }
const DAY_TAB = { 1: 'Day 1 — Nov 20', 2: 'Day 2 — Nov 21' }

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const sq = (s) => String(s ?? '').replace(/'/g, "''")
const hall = (key) => {
  const h = S.halls.find((x) => x.key === key)
  if (!h) throw new Error(`unknown hall: ${key}`)
  return h
}

// Expo Hall talks: the speaker and topic from the talks list.
for (const s of S.sessions) {
  hall(s.hall)
  if (!s.company) continue
  const t = talks.find((x) => x.company === s.company)
  s.title = `Innovation Talk: ${s.company}`
  s.track = s.track || 'Innovation Talks'
  if (t) {
    s.speaker = { name: t.name, role: [t.title, s.company].filter(Boolean).join(', ') }
    s.topic = t.topic || ''
    s.talk = t
  } else {
    s.note = s.note || 'Speaker to be announced.'
  }
}

const time = (s) => (s.start ? `${s.start} – ${s.end}` : 'Time to be announced')
const BADGE = { keynote: 'badge-keynote', panel: 'badge-panel', talk: 'badge-workshop', workshop: 'badge-workshop', break: 'badge-break', networking: 'badge-keynote', elsewhere: 'badge-break' }
const badgeText = (s) => ({ keynote: 'Keynote', panel: 'Panel', talk: 'Talk', workshop: 'Workshop', elsewhere: 'All halls' })[s.type] || s.label
const heading = (s) => s.title || (s.speaker ? `${s.label}: ${s.speaker.name}` : s.label)

// ---- the people in a session ----
// One name, however it is written: "Shri. K.K. Singh" and "Shri K.K. Singh (IAS)" are
// the same person.
const norm = (n) => String(n).toLowerCase()
  .replace(/\((ias|ifs|ips|retd\.?)\)/g, ' ')
  .replace(/hon[’']ble/g, ' ')
  .replace(/\b(shri|smt|mr|mrs|ms|dr|prof|cmde)\b\.?/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ').trim()
const slugOf = (name) => name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const initials = (name) => { const w = norm(name).split(' ').filter(Boolean); return ((w[0]?.[0] || '') + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase() }
const onDisk = (file) => (file && existsSync(join('public', file)) ? file : '')

const directory = new Map()
for (const p of PEOPLE) {
  const k = norm(p.name)
  if (directory.has(k)) throw new Error(`schedule-people.json names ${p.name} twice`)
  for (const f of [p.photo, p.logo]) if (f && !onDisk(f)) throw new Error(`schedule-people.json: ${p.name}: no such file public/${f}`)
  directory.set(k, p)
}
// An exhibitor's speaker: the photo and logo the Innovation Talks wall already uses.
const fromTalk = (t, company) => ({
  role: t.title || '',
  org: company || t.company,
  photo: onDisk(`images/talks/${t.slug}.webp`),
  logo: onDisk(t.logoFile || `images/exhibitors/${slugOf(t.company)}.webp`),
  crop: null,
})
const talkPeople = new Map(talks.map((t) => [norm(t.name), fromTalk(t)]))

const used = new Set(), unknown = new Set()
// `given` is what schedule.json says of them, used only when nobody else knows them.
function person(name, given = {}, known = null) {
  const k = norm(name)
  const d = known || directory.get(k) || talkPeople.get(k)
  if (d && directory.get(k) === d) used.add(k)
  if (!d) unknown.add(name)
  return { name, slug: k.replace(/ /g, '-'), role: d ? d.role : given.role || '', org: d ? d.org : given.org || '', photo: d?.photo || '', logo: d?.logo || '', crop: d?.crop || null }
}
function people(s) {
  if (s.talk) return [person(s.talk.name, {}, fromTalk(s.talk, s.company))]
  const out = []
  if (s.speaker) out.push(person(s.speaker.name, { role: s.speaker.role }))
  for (const p of s.panel || []) out.push(person(p.name, { org: p.org }))
  if (s.moderator) out.push({ ...person(s.moderator.name, { org: s.moderator.org }), tag: 'Moderator' })
  return out
}
for (const s of S.sessions) s.people = people(s)

// The small photos and logos. Always rebuilt, so a new portrait or a changed crop
// shows without anyone remembering a flag; the same picture gives the same bytes.
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
// A logo: its empty margin trimmed off, so every mark fills its own box, then sized
// as the exhibitor wall sizes them, a wide wordmark lower than a square seal, so
// they read at the same weight. `lw` and `lh` are the size on the page in pixels.
// Only a white or see-through margin is trimmed: a logo drawn on its own coloured
// tile (Hinduja Hospital's, Aria Telecom's) keeps the tile.
async function bakeLogo(file) {
  const name = 'logo-' + slugOf(file.split('/').pop().replace(/\.[a-z]+$/, '').replace(/^(logo|favicon)-/, '')) + '.webp'
  const m = await bake(`logo:${file}`, name, async () => {
    const src = join('public', file)
    const corner = (await sharp(src).ensureAlpha().extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer())
    const empty = corner[3] < 16 || (corner[0] > 240 && corner[1] > 240 && corner[2] > 240)
    const trimmed = empty ? await sharp(src).trim().toBuffer().catch(() => readFileSync(src)) : readFileSync(src)
    // Twice the largest size it is ever drawn at (92 by 40), for sharp phone screens.
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
for (const s of S.sessions) {
  for (const p of s.people) {
    if (p.photo) p.thumb = await bakePhoto(p)
    if (p.logo) p.mark = await bakeLogo(p.logo)
  }
}
const kept = new Set([...made.values()].map((m) => m.name))
for (const f of readdirSync(join('public', THUMBS))) {
  if (kept.has(f)) continue
  if (CHECK) drift.push(`${join('public', THUMBS, f)} (no session uses it)`)
  else unlinkSync(join('public', THUMBS, f))
}

const face = (p) => p.thumb
  ? `<img class="sch-photo" width="48" height="48" loading="lazy" decoding="async" src="${p.thumb.src}" alt="">`
  : `<span class="sch-photo sch-initials" aria-hidden="true">${esc(initials(p.name))}</span>`
// The organisation is named in words beside it, so the logo itself says nothing to a
// screen reader. The page scales --lw and --lh down a little on a phone.
const mark = (p) => (p.mark ? `<img class="sch-logo" width="${p.mark.w}" height="${p.mark.h}" loading="lazy" decoding="async" src="${p.mark.src}" alt="" style="--lw:${p.mark.lw};--lh:${p.mark.lh}">` : '')
const who = (p, nameTag) => [
  `<${nameTag}${nameTag === 'h4' ? '' : ' class="sch-name"'}>${esc(p.name)}${p.tag ? ` <span class="sch-tag">${esc(p.tag)}</span>` : ''}</${nameTag}>`,
  p.role ? `<div class="sch-role">${esc(p.role.replace(/[.]$/, ''))}</div>` : '',
  p.org ? `<div class="sch-org">${esc(p.org)}</div>` : '',
].join('')
// One person: photo, then name / designation / department, with the logo at the top
// right of those words (it comes first so the words can run round it on a phone).
const card = (p, tag, nameTag, cls = '') => `<${tag} class="sch-person${cls}">${face(p)}<div class="sch-who">${mark(p)}${who(p, nameTag)}</div></${tag}>`

// The words that are not people: what kind of panel or talk it is and the topic. The
// note ("More panellists to be announced") reads after the names.
function words(s) {
  const out = []
  // The label adds something only for a panel ("Panel: Governance") or a named talk.
  if (s.title && s.label && ['panel', 'talk'].includes(s.type) && !s.title.includes(s.label) && !s.company) out.push(esc(s.label))
  if (s.topic) out.push(`&ldquo;${esc(s.topic.replace(/[.]$/, ''))}&rdquo;`)
  return out
}
const sentence = (tag, ls, cls = '') => (ls.length || tag ? `<p${cls ? ` class="${cls}"` : ''}>${tag}${ls.join('. ')}${ls.length ? '.' : ''}</p>` : '')

const item = (s, tag = '') => {
  const ppl = s.people || []
  const note = s.note ? [esc(s.note.replace(/\.$/, ''))] : []
  const info = []
  if (!ppl.length) {
    info.push(`<h4>${esc(heading(s))}</h4>`, sentence(tag, [...words(s), ...note]))
  } else if (!s.title && ppl.length === 1) {
    // A keynote with no title of its own: the speaker is the heading.
    info.push(card(ppl[0], 'div', 'h4', ' sch-lead'), sentence(tag, [...words(s), ...note], 'sch-note'))
  } else {
    info.push(`<h4>${esc(heading(s))}</h4>`, sentence(tag, words(s)))
    info.push(`<ul class="sch-people">${ppl.map((p) => card(p, 'li', 'div')).join('')}</ul>`)
    info.push(sentence('', note, 'sch-note'))
  }
  return [
    `<div class="schedule-item${!ppl.length ? '' : !s.title && ppl.length === 1 ? ' has-lead' : ' has-people'}">`,
    `    <div class="schedule-time">${time(s)}</div>`,
    `    <div class="schedule-info">${info.filter(Boolean).join('')}</div>`,
    `    <span class="schedule-badge ${BADGE[s.type]}">${esc(badgeText(s))}</span>`,
    '</div>',
  ].join('\n')
}

const byTime = (a, b) => (a.start || '99') < (b.start || '99') ? -1 : (a.start || '99') > (b.start || '99') ? 1 : 0
const dayTabs = (id) => [
  '<div class="schedule-tabs">',
  `    <button class="schedule-tab active" onclick="switchDay('${id}', 0)">${DAY_TAB[1]}</button>`,
  `    <button class="schedule-tab" onclick="switchDay('${id}', 1)">${DAY_TAB[2]}</button>`,
  '</div>',
].join('\n')
const dayPanel = (day, items, empty) => [
  `<div class="schedule-panel${day === 1 ? ' active' : ''}">`,
  '    <div class="schedule-list">',
  (items.length ? items : [`<p style="color:var(--dark-grey);margin:0;">${empty}</p>`]).map((h) => h.replace(/^/gm, '        ')).join('\n'),
  '    </div>',
  '</div>',
].join('\n')
const indent = (s, n) => s.replace(/^(?=.)/gm, ' '.repeat(n))

const html = []
html.push('<!-- Hall Selector -->', '<div class="hall-tabs">')
S.halls.forEach((h, i) => html.push(`    <button class="hall-tab${i === 0 ? ' active' : ''}" onclick="switchHall(${i})">${esc(h.name)}</button>`))
html.push(`    <button class="hall-tab" onclick="switchHall(${S.halls.length})" style="background:linear-gradient(135deg,#FF6B00,#138808);color:white;border-color:transparent;">Full Schedule</button>`, '</div>', '')

S.halls.forEach((h, i) => {
  const id = `hall-${i}`
  html.push(`<!-- ${h.name.toUpperCase()} = ${h.venue} -->`, `<div class="hall-panel${i === 0 ? ' active' : ''}" id="${id}">`)
  html.push(indent(`<p class="hall-venue" style="font-size:0.86rem;color:var(--dark-grey);margin:0 0 1rem;">At the venue: <strong>${esc(h.venue)}</strong>${h.about ? ` &middot; ${esc(h.about)}` : ''}</p>`, 4))
  html.push(indent(dayTabs(id), 4))
  for (const day of [1, 2]) {
    const items = S.sessions.filter((s) => s.hall === h.key && s.day === day).sort(byTime).map((s) => item(s))
    html.push(indent(dayPanel(day, items, 'Sessions to be announced.'), 4))
  }
  html.push('</div>', '')
})

// Full Schedule: every hall in time order. Breaks and registration come from the
// main hall only, and a run of short Expo Hall talks shows as one block.
const full = S.halls.length
html.push('<!-- FULL SCHEDULE (all halls) -->', `<div class="hall-panel" id="hall-${full}">`)
html.push(indent(dayTabs(`hall-${full}`), 4))
for (const day of [1, 2]) {
  const rows = []
  const list = S.sessions.filter((s) => s.day === day && s.type !== 'elsewhere' && (s.type !== 'break' || s.hall === S.halls[0].key)).sort(byTime)
  const runs = []
  for (const s of list) {
    if (s.company && s.start) {
      const run = runs[runs.length - 1]
      const gap = run ? (Number(s.start.slice(0, 2)) * 60 + Number(s.start.slice(3))) - (Number(run.end.slice(0, 2)) * 60 + Number(run.end.slice(3))) : 99
      if (run && gap <= 30) { run.end = s.end; run.names.push(s.company); continue }
      const r = { hall: s.hall, day, start: s.start, end: s.end, names: [s.company], run: true }
      runs.push(r)
      rows.push(r)
    } else rows.push(s)
  }
  const out = rows.map((s) => {
    const h = hall(s.hall)
    const tag = s.label === 'Registration'
      ? '<span class="hall-label hl-all">All halls</span>'
      : `<span class="hall-label hl-${h.key}">${esc(h.name)}</span>`
    if (s.run) return item({ type: 'talk', label: 'Innovation Talks', title: 'Innovation Talks', start: s.start, end: s.end, note: s.names.join(', ') }, tag)
    return item(s, tag)
  })
  html.push(indent(dayPanel(day, out, 'Sessions to be announced.'), 4))
}
html.push('</div>')

// Replace the text between the markers, keeping the file's line endings.
const src = readFileSync(PAGE, 'utf8')
const eol = src.includes('\r\n') ? '\r\n' : '\n'
const s = src.replace(/\r\n/g, '\n')
const a = s.indexOf('<!-- schedule:start'), b = s.indexOf('<!-- schedule:end -->')
if (a < 0 || b < 0) throw new Error(`${PAGE}: schedule markers missing`)
const lineStart = s.lastIndexOf('\n', a) + 1
const ind = s.slice(lineStart, a)
const startLine = s.slice(a, s.indexOf('\n', a) + 1)
const body = html.join('\n') + '\n'
const out = s.slice(0, lineStart) + ind + startLine + body.split('\n').map((l) => (l ? ind + l : l)).join('\n') + ind + s.slice(b)
put(PAGE, out.replace(/\n/g, eol))

// ---- the app: sessions + workshop times ----
const AVATAR = { keynote: '🎤', panel: '💬', talk: '💡', workshop: '🔬', networking: '🤝' }
const avatar = (s) => s.type === 'break' ? ({ Registration: '📋', Lunch: '🍽️', Tea: '🍵' })[s.label] || '☕' : (s.label === 'Evening' ? '🥂' : AVATAR[s.type] || '📌')
const CAP = { break: 5000, networking: 500, workshop: 100 }
// The app splits a panel's speaker_name on commas and reads "Name (Info)", so a name
// must not carry its own brackets: "(IAS)" and "(IFS)" stay on the website only.
const bare = (n) => n.replace(/\s*\((IAS|IFS)\)/g, '')
const rows = []
for (const s of S.sessions) {
  if (s.type === 'elsewhere' || !s.start) continue
  const h = hall(s.hall)
  let speakerName = null, speakerTitle = null
  if (s.panel) {
    speakerName = s.panel.map((p) => `${bare(p.name)} (${p.org})`).concat(s.moderator ? [`${bare(s.moderator.name)} (Moderator)`] : []).join(', ')
  } else if (s.speaker) {
    speakerName = s.speaker.name
    speakerTitle = s.speaker.role
  }
  const title = s.title || s.label
  const desc = [s.topic, s.title && ['panel', 'talk'].includes(s.type) && !s.title.includes(s.label) && !s.company ? s.label : '', s.note].filter(Boolean).join('. ')
  const v = (x) => (x == null || x === '' ? 'NULL' : `'${sq(x)}'`)
  rows.push(`(1, ${v(title)}, ${v(desc)}, ${v(speakerName)}, ${v(speakerTitle)}, ${v(avatar(s))}, '${s.type}', ${v(s.track)}, '${sq(h.name)}', '${DATE[s.day]} ${s.start}', '${DATE[s.day]} ${s.end}', ${CAP[s.type] || 1000})`)
}
const ws = S.sessions.filter((s) => s.workshop)
const sql = [
  '-- The conference schedule in the app, from scripts/data/schedule.json.',
  '-- Written by scripts/gen-schedule.mjs: edit the JSON and re-run, never this file.',
  '--',
  '-- Replaces every session of event 1 (the old placeholder schedule) with the agenda',
  "-- from the organiser's workbook, and sets the workshops' times and room. Attendees'",
  '-- starred sessions live on their phones by session id, so old stars simply stop',
  '-- matching. Safe to run again: it deletes and re-inserts the same rows.',
  '--',
  '--   npx wrangler d1 execute bharatai-production --remote --file=scripts/sql/schedule.sql',
  '',
  'DELETE FROM sessions WHERE event_id = 1;',
  '',
  'INSERT INTO sessions (event_id, title, description, speaker_name, speaker_title, speaker_avatar, session_type, track, room, start_time, end_time, capacity) VALUES',
  rows.join(',\n') + ';',
  '',
  ...ws.map((s) => `UPDATE workshops SET starts_at = '${DATE[s.day]} ${s.start}', ends_at = '${DATE[s.day]} ${s.end}', room = '${sq(hall(s.hall).name)}' WHERE event_id = 1 AND slug = '${sq(s.workshop)}';`),
  '',
]
put(SQL, sql.join('\n'))
console.log(`${S.sessions.length} schedule rows; ${rows.length} app sessions; ${ws.length} workshop times; ${PAGE} and ${SQL} ${CHECK ? 'checked' : 'written'}`)
const shown = new Map(S.sessions.flatMap((s) => s.people).map((p) => [p.slug, p]))
const noPhoto = [...shown.values()].filter((p) => !p.photo).map((p) => p.name)
const noLogo = [...shown.values()].filter((p) => !p.logo && p.org).map((p) => `${p.name} (${p.org})`)
console.log(`${shown.size} people on the schedule; ${kept.size} files in public/${THUMBS}`)
if (unknown.size) console.log(`Not in schedule-people.json (shown with initials and schedule.json's words): ${[...unknown].join('; ')}`)
if (noPhoto.length) console.log(`No photo (initials shown): ${noPhoto.join('; ')}`)
if (noLogo.length) console.log(`No logo (organisation named in words): ${noLogo.join('; ')}`)
const stale = PEOPLE.filter((p) => !used.has(norm(p.name))).map((p) => p.name)
if (stale.length) console.log(`In schedule-people.json but in no session: ${stale.join('; ')}`)
if (CHECK) {
  if (drift.length) console.log(`Out of step with the JSON (run node scripts/gen-schedule.mjs): ${drift.join('; ')}`)
  else console.log('In step: the page, the SQL and the pictures are what the JSON gives.')
  process.exit(drift.length ? 1 : 0)
}
