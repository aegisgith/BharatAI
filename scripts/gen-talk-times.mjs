// The Innovation Talks' times and hall, for the app (12 Nov 2026).
//
// The agenda (scripts/data/schedule.json, from the organiser's Drive workbook) gives
// each Expo Hall slot a company; the talks list (scripts/data/innovation-talks.json)
// gives that company's speaker. The app's talks (D1 innovation_talks, filled from
// scripts/sql/innovation-talks.sql) had no time at all: every one read "To be
// announced". This writes scripts/sql/innovation-talk-times.sql, which gives each
// scheduled talk its day, time and hall, and every talk the Expo Hall as its hall.
//
//   node scripts/gen-talk-times.mjs
//
// Then the organiser runs (after migrations/0052_innovation_talk_details.sql):
//   npx wrangler d1 execute bharatai-production --remote --file=./scripts/sql/innovation-talk-times.sql
//
// Re-run both after every agenda change. A time set by hand in /admin for a talk the
// agenda also schedules is replaced by the agenda's; a talk the agenda does not
// schedule is left as it is.
import { readFileSync, writeFileSync } from 'node:fs'

// From this file's own place, so the checks can import it from any folder.
const OUT = new URL('./sql/innovation-talk-times.sql', import.meta.url)
const S = JSON.parse(readFileSync(new URL('./data/schedule.json', import.meta.url), 'utf8'))
const talks = JSON.parse(readFileSync(new URL('./data/innovation-talks.json', import.meta.url), 'utf8'))
const DATE = { 1: '2026-11-20', 2: '2026-11-21' }
const DAY = { '2026-11-20': 'Fri 20 Nov', '2026-11-21': 'Sat 21 Nov' }
// The event's name for each real room. The organiser swapped Kalam and Aryabhata on
// 12 Nov 2026, so the name is read from the real room at the start of halls[].venue,
// which never changes, not from halls[].name: right whichever names schedule.json has.
const NAME_OF_ROOM = [['Peacock Hall', 'Homi J. Bhabha Hall'], ['Centrum Hall A', 'Kalam Theatre'], ['Centrum Hall B', 'Raman Theatre'], ['Expo', 'Aryabhata Theatre']]
const HALL = 'Aryabhata Theatre' // the Expo Hall, where the Innovation Talks are

const sq = (s) => String(s ?? '').replace(/'/g, "''")
const minutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
const clock = (mins) => { const h = Math.floor(mins / 60) % 24, m = mins % 60; return { text: `${h % 12 || 12}:${String(m).padStart(2, '0')}`, pm: h >= 12 } }
// The same words the server writes (italkSlotLabel in src/index.tsx) and the exhibitor
// stage talks use: "Fri 20 Nov · 11:30 – 11:38 AM".
export const slotLabel = (date, start, end) => {
  const a = clock(minutes(start)), b = clock(minutes(end))
  return `${DAY[date] || date} · ${a.pm === b.pm ? a.text : `${a.text} ${a.pm ? 'PM' : 'AM'}`} – ${b.text} ${b.pm ? 'PM' : 'AM'}`
}

const hallOf = (key) => { const h = S.halls.find((x) => x.key === key); if (!h) throw new Error(`unknown hall: ${key}`); return h }
const hallName = (key) => {
  const venue = String(hallOf(key).venue || '')
  const hit = NAME_OF_ROOM.find(([room]) => venue.startsWith(room))
  if (!hit) throw new Error(`hall ${key}: its venue "${venue}" does not start with a room this script knows`)
  return hit[1]
}
const isExpo = (key) => hallName(key) === HALL

// Which agenda talks belong to which talk in the list. Most are Expo Hall rows that
// name the company; a few talks are in the main halls and name the
// speaker (CGI, the Forest Department); a slot that names only "Innovation Talk:
// <company>" has no confirmed speaker yet.
const sessionsOf = new Map() // talk index -> [{ s, how }]
const unmatched = []
for (const s of S.sessions) {
  if (s.type !== 'talk' || !s.start || !s.end) continue
  let found = [], how = ''
  if (s.company) { found = talks.filter((t) => t.company === s.company); how = 'company' }
  else if (s.speaker && s.speaker.name) { found = talks.filter((t) => t.name === s.speaker.name); how = 'speaker' }
  else if (/^Innovation Talk: /.test(s.title || '')) { found = talks.filter((t) => t.company === s.title.slice(17)); how = 'title' }
  else continue
  const label = s.company || (s.speaker && s.speaker.name) || s.title
  if (!found.length) { if (how !== 'speaker') unmatched.push(`${label} (no speaker in the talks list)`); continue }
  if (found.length > 1) { unmatched.push(`${label} (two speakers in the talks list)`); continue }
  const i = talks.indexOf(found[0])
  sessionsOf.set(i, [...(sessionsOf.get(i) || []), { s, how }])
}

const rows = []
const elsewhere = new Set() // companies whose talk is not on the Expo Stage
for (const [i, list] of sessionsOf) {
  const t = talks[i]
  if (list.some(({ s }) => !isExpo(s.hall))) elsewhere.add(t.company)
  if (list.length > 1) { unmatched.push(`${t.name}, ${t.company} (${list.length} talks in the agenda: set the time by hand)`); continue }
  const { s, how } = list[0]
  if (how === 'title') { unmatched.push(`${t.company} (the agenda names no speaker for its slot)`); continue }
  const date = DATE[s.day]
  const dur = minutes(s.end) - minutes(s.start)
  if (!date || dur <= 0) throw new Error(`bad slot for ${t.company}: day ${s.day} ${s.start}-${s.end}`)
  const sameCompany = talks.filter((x) => x.company === t.company).length > 1
  rows.push({ company: t.company, speaker: t.name, byName: sameCompany, hall: hallName(s.hall), starts_at: `${date} ${s.start}`, dur, label: slotLabel(date, s.start, s.end), session: minutes(s.start) < 12 * 60 ? 'Morning' : 'Afternoon' })
}
rows.sort((a, b) => a.starts_at.localeCompare(b.starts_at))

const sql = [
  '-- Generated by scripts/gen-talk-times.mjs from scripts/data/schedule.json; do not edit by hand.',
  '-- Needs migrations/0052_innovation_talk_details.sql first (the hall column).',
  '-- Safe to run again: it sets the same values each time.',
  `-- ${rows.length} talks get a time.${unmatched.length ? ' Agenda slots with no single talk to match: ' + unmatched.join('; ') + '.' : ''}`,
  '',
  `-- Innovation Talks are in the Expo Hall (${HALL}), unless a hall is already set`,
  `-- or the agenda puts the talk in another hall (${[...elsewhere].sort().join(', ') || 'none'}).`,
  `UPDATE innovation_talks SET hall = '${HALL}' WHERE event_id = 1 AND trim(ifnull(hall, '')) = ''${elsewhere.size ? ` AND company NOT IN (${[...elsewhere].sort().map((c) => `'${sq(c)}'`).join(', ')})` : ''};`,
  '',
  ...rows.flatMap((r) => [`-- ${r.speaker.replace(/[\r\n]/g, ' ')}`, `UPDATE innovation_talks SET starts_at = '${r.starts_at}', duration_min = ${r.dur}, time_slot = '${sq(r.label)}', session_type = '${r.session}', hall = '${sq(r.hall)}' WHERE event_id = 1 AND exhibitor_id IS NULL AND company = '${sq(r.company)}'${r.byName ? ` AND speaker_name = '${sq(r.speaker)}'` : ''};`]),
  '',
  '-- What it did: how many talks now have a time.',
  "SELECT COUNT(*) AS talks_with_a_time FROM innovation_talks WHERE event_id = 1 AND starts_at IS NOT NULL;",
  '',
].join('\n')

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/gen-talk-times.mjs')) {
  writeFileSync(OUT, sql)
  console.log(`scripts/sql/innovation-talk-times.sql: ${rows.length} talks with a time`)
  if (unmatched.length) console.log('not matched: ' + unmatched.join('; '))
}
