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
import { readFileSync, writeFileSync } from 'node:fs'

const PAGE = 'public/conference.html'
const SQL = 'scripts/sql/schedule.sql'
const S = JSON.parse(readFileSync('scripts/data/schedule.json', 'utf8'))
const talks = JSON.parse(readFileSync('scripts/data/innovation-talks.json', 'utf8'))
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
  } else {
    s.note = s.note || 'Speaker to be announced.'
  }
}

const time = (s) => (s.start ? `${s.start} – ${s.end}` : 'Time to be announced')
const BADGE = { keynote: 'badge-keynote', panel: 'badge-panel', talk: 'badge-workshop', workshop: 'badge-workshop', break: 'badge-break', networking: 'badge-keynote', elsewhere: 'badge-break' }
const badgeText = (s) => ({ keynote: 'Keynote', panel: 'Panel', talk: 'Talk', workshop: 'Workshop', elsewhere: 'All halls' })[s.type] || s.label
const heading = (s) => s.title || (s.speaker ? `${s.label}: ${s.speaker.name}` : s.label)

function lines(s) {
  const out = []
  // The label adds something only for a panel ("Panel: Governance") or a named talk.
  if (s.title && s.label && ['panel', 'talk'].includes(s.type) && !s.title.includes(s.label) && !s.company) out.push(esc(s.label))
  if (s.speaker) out.push(s.title ? `${esc(s.speaker.name)}, ${esc(s.speaker.role)}` : esc(s.speaker.role))
  if (s.topic) out.push(`&ldquo;${esc(s.topic.replace(/[.]$/, ''))}&rdquo;`)
  if (s.panel) out.push('With ' + s.panel.map((p) => `${esc(p.name)} (${esc(p.org)})`).join(', '))
  if (s.moderator) out.push(`Moderator: ${esc(s.moderator.name)} (${esc(s.moderator.org)})`)
  if (s.note) out.push(esc(s.note.replace(/\.$/, '')))
  return out
}

const item = (s, tag = '') => {
  const ls = lines(s)
  const p = ls.length || tag ? `<p>${tag}${ls.join('. ')}${ls.length ? '.' : ''}</p>` : ''
  return [
    '<div class="schedule-item">',
    `    <div class="schedule-time">${time(s)}</div>`,
    `    <div class="schedule-info"><h4>${esc(heading(s))}</h4>${p}</div>`,
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
writeFileSync(PAGE, out.replace(/\n/g, eol), 'utf8')

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
writeFileSync(SQL, sql.join('\n'), 'utf8')
console.log(`${S.sessions.length} schedule rows; ${rows.length} app sessions; ${ws.length} workshop times; ${PAGE} and ${SQL} written`)
