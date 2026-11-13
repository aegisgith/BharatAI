import { Hono } from 'hono'
import { organiserTeam, ownersOf, setOwner, clearOwner, isOwnerKind } from '../lib/team'

// ==================== CONFERENCE MANAGER (12 Nov 2026) ====================
//
// Admin -> Conference: the programme (sessions by day and hall), the speakers, the
// halls, and announcing a speaker. The screen is public/static/conference-admin.js.
//
// Before this, a speaker could only be added or changed by a SQL file the organiser
// ran; a session's speakers were a typed line ("Name (Org), Name (Org), Name
// (Moderator)") with no tie to the speakers table; the halls were a list in the
// app's code; and nobody could tell which speakers had been announced.
//
// What the app reads is unchanged: sessions.speaker_name is still that typed line,
// now written from the speakers chosen in Admin on every save, so the schedule cards
// keep working and nothing on a phone needs a new version to see an edit.
//
// Migration 0054 adds the halls, the saved speaker links, drafts and the announcement
// log. Until it runs, speakers and sessions can still be added and edited here; a
// session's speakers are then worked out from its typed line (deriveLinks), which is
// also how sessions made before 0054 (the generated agenda) find their speakers.
//
// Every route below is under /api/admin/*, so the admin middleware in index.tsx has
// already refused anyone who is not an admin before a handler runs.

type Hooks = {
  sendEmail?: (c: any, to: string, subject: string, html: string) => Promise<{ ok: boolean; error?: string }>
  audit?: (c: any, action: string, entity?: string, entityId?: any, detail?: any) => Promise<void>
  changedFields?: (before: any, after: Record<string, any>) => Record<string, [any, any]>
  emailHeader?: (title: string, subtitle: string) => string
  actor?: (c: any) => string
  // Writes an Innovation Talk's time and hall where the Innovation Talks tab keeps
  // them (index.tsx owns that table's wording); startsAt null clears the time.
  syncTalk?: (c: any, talkId: number, startsAt: string | null, minutes: number, hall: string) => Promise<void>
  // Makes, or raises to Speaker, the attendee row behind a speaker's email (their pass).
  issueSpeakerPass?: (c: any, x: { eventId: number; name: string; email: string; mobile: string; company: string; designation: string; linkedin: string; avatarUrl: string }) =>
    Promise<{ attendeeId: number; pass: string; created: boolean; raised: boolean; kept: boolean } | { error: string }>
}
let hooks: Hooks = {}
export function configureConference(h: Hooks) { hooks = { ...hooks, ...h } }

const conf = new Hono<{ Bindings: any }>()

export const SESSION_TYPES = ['keynote', 'talk', 'panel', 'workshop', 'ceremony', 'exhibition', 'networking', 'break']
export const SPEAKER_ROLES = ['keynote', 'speaker', 'panellist', 'moderator', 'host', 'chair']
export const MIGRATION_FILE = '0054_conference_manager.sql'
export const MIGRATION_COMMAND = 'npx wrangler d1 execute bharatai-production --remote --file=./migrations/' + MIGRATION_FILE

// The halls of 20-21 Nov 2026 (organiser, 12 Nov: Kalam and Aryabhata swapped that
// day, so Kalam is Centrum Hall A and Aryabhata the Expo Hall). The same four rows
// 0054 seeds; shown read-only until it runs.
export const DEFAULT_HALLS = [
  { name: 'Homi J. Bhabha Hall', short_name: 'Bhabha Hall', venue_room: 'Peacock Hall', location: 'Ground Floor, Centre One', purpose: 'Keynotes and panels', sort_order: 1 },
  { name: 'Kalam Theatre', short_name: 'Kalam', venue_room: 'Centrum Hall A', location: 'First Floor, Centre One', purpose: 'Panels', sort_order: 2 },
  { name: 'Raman Theatre', short_name: 'Raman', venue_room: 'Centrum Hall B', location: 'First Floor, Centre One', purpose: 'Workshops', sort_order: 3 },
  { name: 'Aryabhata Theatre', short_name: 'Aryabhata', venue_room: 'Expo Hall', location: 'On the exhibition floor', purpose: 'Innovation Talks', sort_order: 4 },
]

// ---------- pure helpers (scripts/verify/unit-conference.mjs tests each) ----------

// Both names of a hall, wherever delegates see one (organiser, 12 Nov 2026): the
// event's name, then the venue's own, because the venue's staff know only theirs.
// "Aryabhata Theatre · Expo Hall".
export function hallLabel(room: any, venue: any): string {
  const r = String(room || '').trim(), v = String(venue || '').trim()
  return r && v && v.toLowerCase() !== r.toLowerCase() ? r + ' · ' + v : r || v
}

// A person's name reduced to what identifies them: no titles of address, no service
// suffix, no punctuation. The agenda writes "Shri K.K. Singh" and "Mr. Bhupesh
// Daheria" where the speakers table has "Shri. K.K. Singh" and "Bhupesh Daheria".
export function normName(n: any): string {
  let s = String(n || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  s = s.replace(/\(\s*(ias|ifs|ips|irs|phd|ph\.?\s?d\.?|retd\.?|retired)\s*\)/g, ' ')
  s = s.replace(/[‘’'`]/g, '')
  s = s.replace(/[^a-z0-9]+/g, ' ').trim()
  let prev = ''
  while (prev !== s) {
    prev = s
    s = s.replace(/^(honble|honourable|hon|shri|shree|smt|sushri|kumari|mr|mrs|ms|miss|dr|prof|professor|sir|adv|er|col|capt|lt|gen)\s+/, '')
  }
  return s
}

// A URL-safe slug from a name, without the titles of address.
export function slugFor(name: any): string {
  return normName(name).replace(/\s+/g, '-').slice(0, 60).replace(/-+$/, '') || 'speaker'
}

// "A (Org), B (Org), C (Moderator)" -> [{name, info, role}]. Commas inside brackets
// do not split; a trailing bracket is the person's organisation, or their part.
export function splitSpeakerLine(line: any): { name: string; info: string; role: string }[] {
  const parts: string[] = []
  let depth = 0, cur = ''
  for (const ch of String(line || '')) {
    if (ch === '(') depth++
    if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) { if (cur.trim()) parts.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts.map(p => {
    let name = p, info = ''
    const m = p.match(/^(.*?)\s*\(([^()]*)\)\s*$/)
    if (m && m[1].trim() && !/^(ias|ifs|ips|irs|phd)$/i.test(m[2].trim())) { name = m[1].trim(); info = m[2].trim() }
    const low = info.toLowerCase()
    const role = low === 'moderator' ? 'moderator' : (low === 'host' || low === 'chair') ? low : ''
    return { name: name.trim(), info, role }
  })
}

const defaultRole = (type: string) => type === 'keynote' ? 'keynote' : type === 'panel' ? 'panellist' : 'speaker'

// The people a typed line names who are not on the speakers list, as typed.
export function typedOthers(line: any, speakers: { name: string }[]): string {
  const known = new Set(speakers.map(sp => normName(sp.name)).filter(Boolean))
  return splitSpeakerLine(line).filter(p => !known.has(normName(p.name)))
    .map(p => p.info ? p.name + ' (' + p.info + ')' : p.name).join(', ')
}

// The speakers a typed line names, matched to the speakers table by name, and the
// people it names who are not in that table (kept as typed, so a save never drops a
// panellist nobody has added as a speaker).
export function deriveLinks(line: any, speakers: { id: number; name: string }[], type = 'talk') {
  const index = new Map<string, { id: number; name: string }>()
  for (const sp of speakers) { const k = normName(sp.name); if (k && !index.has(k)) index.set(k, sp) }
  const links: { speaker_id: number; role: string; sort_order: number; derived: true }[] = []
  const others: string[] = []
  splitSpeakerLine(line).forEach((p, i) => {
    const sp = index.get(normName(p.name))
    if (sp && !links.some(l => l.speaker_id === Number(sp.id))) {
      links.push({ speaker_id: Number(sp.id), role: p.role || defaultRole(type), sort_order: i, derived: true })
    } else {
      others.push(p.info ? p.name + ' (' + p.info + ')' : p.name)
    }
  })
  return { links, others: others.join(', ') }
}

// The typed line the app shows, written from the chosen speakers. One speaker: their
// name, with role and organisation as the title line. More: "Name (Org), ..., Name
// (Moderator)", the format the app's panel cards split on commas, so no commas or
// brackets inside a name or an organisation, and the organisation is its first part.
export function composeSpeakerLine(people: { name: string; organisation?: string; role_title?: string; role?: string }[],
    others = '', typedTitle = ''): { speaker_name: string | null; speaker_title: string | null } {
  const plain = (s: any) => String(s || '').replace(/\s*\([^)]*\)/g, '').replace(/[,()]/g, ' ').replace(/\s+/g, ' ').trim()
  const extra = String(others || '').replace(/\s+/g, ' ').trim()
  if (!people.length) return { speaker_name: extra || null, speaker_title: extra ? (String(typedTitle || '').trim() || null) : null }
  if (people.length === 1 && !extra && people[0].role !== 'moderator') {
    const p = people[0]
    const title = [String(p.role_title || '').trim(), String(p.organisation || '').trim()].filter(Boolean).join(', ')
    return { speaker_name: String(p.name || '').trim() || null, speaker_title: title || null }
  }
  const parts = people.map(p => {
    const nm = plain(p.name)
    if (p.role === 'moderator') return nm + ' (Moderator)'
    const org = plain(String(p.organisation || '').split(/[;,]/)[0])
    return org ? nm + ' (' + org + ')' : nm
  })
  if (extra) parts.push(extra)
  return { speaker_name: parts.join(', '), speaker_title: null }
}

// 'YYYY-MM-DD HH:MM', the IST wall clock the sessions table holds.
export function cleanTime(v: any): string | null {
  const s = String(v || '').trim().replace('T', ' ').slice(0, 16)
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s) ? s : null
}

// Two sessions in one hall at once, and one speaker in two places at once. An
// exhibition-type session (the floor being open) shares its hall by design.
export function findClashes(list: { id: number; title: string; room: string; session_type: string; start_time: string; end_time: string;
    status?: string; speakers: { id: number; name: string }[] }[]) {
  const timed = list.filter(s => s.start_time && s.end_time && s.start_time < s.end_time)
  const room: any[] = [], speaker: any[] = []
  const brief = (s: any) => ({ id: s.id, title: s.title, start_time: s.start_time, end_time: s.end_time, room: s.room })
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i], b = timed[j]
      if (!(a.start_time < b.end_time && b.start_time < a.end_time)) continue
      if (a.room && a.room === b.room && a.session_type !== 'exhibition' && b.session_type !== 'exhibition') {
        room.push({ room: a.room, a: brief(a), b: brief(b) })
      }
      for (const sp of a.speakers) {
        if (b.speakers.some(x => x.id === sp.id)) speaker.push({ speaker_id: sp.id, speaker: sp.name, a: brief(a), b: brief(b) })
      }
    }
  }
  return { room, speaker }
}

// ---------- the scheduler's checks (12 Nov 2026) ----------
// The organiser: "show if any slot is empty, or any session needs attention, conflict,
// no info". Everything here is worked out from the lists already loaded, with no
// database, so scripts/verify/unit-scheduler.mjs can test each rule on its own.

export const MIN_FREE_MINUTES = 15   // a shorter gap is a changeover, not a free slot
export const TIGHT_MOVE_MINUTES = 10 // less than this to get from one hall to another
const NEEDS_SPEAKER = ['keynote', 'talk', 'panel', 'workshop']
const PLACEHOLDER_TITLE = /^(key ?note( address)?|panel( discussion)?|talk|innovation talks?|workshop|session|fireside chat|tba|tbc|tbd|to be (announced|confirmed|decided)|untitled|new session)( ?#?\d+)?$/i
const minsOf = (t: any) => Number(String(t).slice(11, 13)) * 60 + Number(String(t).slice(14, 16))
const hhmmOf = (m: number) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')
const dayOf = (t: any) => String(t || '').slice(0, 10)
const isTimed = (s: any) => !!s.start_time && !!s.end_time && s.start_time < s.end_time
const coKey = (v: any) => String(v || '').toLowerCase().replace(/&/g, ' and ').replace(/\b(pvt|private|ltd|limited|llp|inc)\b/g, ' ').replace(/[^a-z0-9]+/g, '')

// A day with nothing on it yet is planned between these.
export const BLANK_DAY = { from: 9 * 60 + 30, to: 18 * 60 }

// The hours a day's programme spans: from its first start to its last end.
export function dayWindow(sessions: any[], day: string): { from: number; to: number; empty: boolean } {
  const today = sessions.filter(s => isTimed(s) && dayOf(s.start_time) === day)
  if (!today.length) return { ...BLANK_DAY, empty: true }
  return { from: Math.min(...today.map(s => minsOf(s.start_time))), to: Math.max(...today.map(s => minsOf(s.end_time))), empty: false }
}

// Free time in each hall on each day, inside that day's programme. An exhibition-type
// session shares its hall, so it leaves the hall free. The day's hours come from
// spanOf (every session), so leaving one session out to move it does not shrink the day.
export function freeSlots(sessions: any[], halls: any[], days: string[], minMinutes = MIN_FREE_MINUTES, spanOf: any[] = sessions) {
  const out: { day: string; hall: string; start: string; end: string; minutes: number; whole: boolean }[] = []
  for (const day of days) {
    const w = dayWindow(spanOf, day)
    for (const h of halls) {
      if (!h || !h.name || Number(h.is_active) === 0) continue
      const busy = sessions.filter(s => isTimed(s) && dayOf(s.start_time) === day && s.room === h.name && s.session_type !== 'exhibition')
        .map(s => [minsOf(s.start_time), minsOf(s.end_time)]).sort((a, b) => a[0] - b[0])
      const whole = busy.length === 0
      let at = w.from
      for (const [a, b] of busy) {
        if (a - at >= minMinutes) out.push({ day, hall: h.name, start: hhmmOf(at), end: hhmmOf(a), minutes: a - at, whole })
        at = Math.max(at, b)
      }
      if (w.to - at >= minMinutes) out.push({ day, hall: h.name, start: hhmmOf(at), end: hhmmOf(w.to), minutes: w.to - at, whole })
    }
  }
  return out
}

// Where a session of this length fits: a free stretch of a hall in which none of its
// speakers is on stage elsewhere. The asked-for hall first, then the others in their
// order; earliest first within a hall. Starts land on five minutes.
export function suggestSlots(sessions: any[], halls: any[], q: { day: string; minutes: number; hall?: string; speakerIds?: number[]; exceptId?: number | null; limit?: number }) {
  const minutes = Math.max(5, Math.round(Number(q.minutes) || 30))
  const others = sessions.filter(s => isTimed(s) && Number(s.id) !== Number(q.exceptId ?? -1))
  const mine = new Set((q.speakerIds || []).map(Number))
  const speakerBusy = others.filter(s => dayOf(s.start_time) === q.day && (s.links || []).some((l: any) => mine.has(Number(l.speaker_id))))
    .map(s => [minsOf(s.start_time), minsOf(s.end_time)])
  const ordered = [...halls.filter(h => h && h.name && Number(h.is_active) !== 0)]
    .sort((a, b) => (a.name === q.hall ? -1 : 0) - (b.name === q.hall ? -1 : 0))
  const out: { hall: string; start: string; end: string; free_until: string }[] = []
  for (const h of ordered) {
    for (const f of freeSlots(others, [h], [q.day], minutes, sessions)) {
      let at = Math.ceil(minsOf('0000-00-00 ' + f.start) / 5) * 5
      const end = minsOf('0000-00-00 ' + f.end)
      // Slide past whatever keeps one of its speakers busy.
      for (let guard = 0; guard < 50 && at + minutes <= end; guard++) {
        const hit = speakerBusy.find(([a, b]) => a < at + minutes && at < b)
        if (!hit) break
        at = Math.ceil(hit[1] / 5) * 5
      }
      if (at + minutes <= end) out.push({ hall: h.name, start: hhmmOf(at), end: hhmmOf(at + minutes), free_until: f.end })
    }
  }
  return out.slice(0, q.limit || 8)
}

// Which session on the programme is which Innovation Talk. The agenda titles them
// "Innovation Talk: <company>"; failing that, a session titled "Innovation Talk..."
// whose speaker line names the talk's speaker. Two people of one company presenting
// together (two rows on the talks list) share the company's one session.
export function linkTalks(sessions: any[], talks: any[]): Map<number, number> {
  const out = new Map<number, number>()   // talk id -> session id
  const byName = new Set<number>()
  const candidates = sessions.filter(s => /^innovation talk\b/i.test(String(s.title || '')))
  const titled = (s: any) => coKey(String(s.title).replace(/^innovation talk\s*[:\-–]?\s*/i, ''))
  for (const t of talks) {
    const k = coKey(t.company), who = normName(t.speaker_name)
    const byCompany = k ? candidates.find(s => titled(s) === k) : null
    const hit = byCompany || (who.length > 3 ? candidates.find(s => !byName.has(Number(s.id)) && splitSpeakerLine(s.speaker_name).some(p => normName(p.name) === who)) : null)
    if (hit) { out.set(Number(t.id), Number(hit.id)); if (!byCompany) byName.add(Number(hit.id)) }
  }
  return out
}

const talkTimed = (t: any) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(t?.starts_at || ''))
const talkEnd = (t: any) => { const d = String(t.starts_at).slice(0, 10), m = minsOf(t.starts_at) + (Number(t.duration_min) || 0); return d + ' ' + hhmmOf(Math.min(m, 1439)) }

export type Issue = { key: string; kind: string; group: 'clash' | 'session' | 'speaker' | 'talk' | 'free' | 'draft'; level: 'bad' | 'warn' | 'info'
  what: string; day?: string; hall?: string; start?: string; end?: string; session_id?: number; other_id?: number; speaker_id?: number; talk_id?: number }

// Everything on the programme that a person should look at, worst first.
//  bad:  it cannot run as written (two sessions in one hall, one person in two places)
//  warn: something is missing or doubtful
//  info: worth knowing (free time, drafts, people typed by hand)
export function findIssues(a: { sessions: any[]; speakers: any[]; halls: any[]; days: string[]; eventDays: string[]; talks?: any[]; clashes?: { room: any[]; speaker: any[] } }): Issue[] {
  const out: Issue[] = []
  const { sessions, speakers, halls } = a
  const talks = a.talks || []
  const spBy = new Map(speakers.map(s => [Number(s.id), s]))
  const hallNames = new Set(halls.filter(h => h && h.name && !h.unlisted).map(h => h.name))
  const at = (s: any) => ({ day: dayOf(s.start_time), hall: s.room || '', start: String(s.start_time || '').slice(11, 16), end: String(s.end_time || '').slice(11, 16), session_id: Number(s.id) })
  const add = (i: Issue) => out.push(i)
  const clashes = a.clashes || findClashes(sessions.map(s => ({ ...s, speakers: (s.links || []).map((l: any) => ({ id: Number(l.speaker_id), name: spBy.get(Number(l.speaker_id))?.name || '' })) })))

  // ---- it cannot run as written ----
  for (const x of clashes.room) {
    add({ key: `hall-clash|${x.a.id}|${x.b.id}`, kind: 'hall-clash', group: 'clash', level: 'bad', ...at(x.a), other_id: Number(x.b.id),
      what: `Two sessions at once in ${x.room}: "${x.a.title}" and "${x.b.title}"` })
  }
  for (const x of clashes.speaker) {
    add({ key: `speaker-clash|${x.speaker_id}|${x.a.id}|${x.b.id}`, kind: 'speaker-clash', group: 'clash', level: 'bad', ...at(x.a), other_id: Number(x.b.id), speaker_id: Number(x.speaker_id),
      what: `${x.speaker} is in two places at once: "${x.a.title}" (${x.a.room || 'no hall'}) and "${x.b.title}" (${x.b.room || 'no hall'})` })
  }

  // ---- one person, two halls, no time to walk ----
  const bySpeaker = new Map<number, any[]>()
  for (const s of sessions) if (isTimed(s)) for (const l of s.links || []) { const k = Number(l.speaker_id); if (!bySpeaker.has(k)) bySpeaker.set(k, []); bySpeaker.get(k)!.push(s) }
  for (const [id, list] of bySpeaker) {
    list.sort((x, y) => (x.start_time < y.start_time ? -1 : 1))
    for (let i = 1; i < list.length; i++) {
      const p = list[i - 1], n = list[i]
      if (dayOf(p.start_time) !== dayOf(n.start_time) || !p.room || !n.room || p.room === n.room) continue
      const gap = minsOf(n.start_time) - minsOf(p.end_time)
      if (gap >= 0 && gap < TIGHT_MOVE_MINUTES) {
        add({ key: `tight|${id}|${p.id}|${n.id}`, kind: 'tight-move', group: 'clash', level: 'warn', ...at(n), other_id: Number(p.id), speaker_id: id,
          what: `${spBy.get(id)?.name || 'A speaker'} has ${gap === 0 ? 'no time' : 'only ' + gap + ' minutes'} to get from ${p.room} to ${n.room}` })
      }
    }
  }

  // ---- each session ----
  const linked = linkTalks(sessions, talks)
  const talkOfSession = new Map<number, any>()
  for (const t of talks) { const sid = linked.get(Number(t.id)); if (sid) talkOfSession.set(sid, t) }
  for (const s of sessions) {
    const type = String(s.session_type || 'talk')
    const where = at(s)
    const name = `"${s.title}"`
    if (!isTimed(s)) { add({ key: `no-time|${s.id}`, kind: 'no-time', group: 'session', level: 'warn', ...where, what: `${name} has no proper start and end time` }); continue }
    const len = minsOf(s.end_time) - minsOf(s.start_time)
    if (!s.room) add({ key: `no-hall|${s.id}`, kind: 'no-hall', group: 'session', level: 'warn', ...where, what: `${name} has no hall yet` })
    else if (hallNames.size && !hallNames.has(s.room)) add({ key: `unknown-hall|${s.id}`, kind: 'unknown-hall', group: 'session', level: 'warn', ...where, what: `${name} is in "${s.room}", which is not on the halls list` })
    if (a.eventDays.length && !a.eventDays.includes(where.day)) add({ key: `off-day|${s.id}`, kind: 'off-day', group: 'session', level: 'warn', ...where, what: `${name} is on ${where.day}, outside the event's days` })
    const fixed = ['break', 'networking', 'exhibition', 'ceremony'].includes(type)
    if (!fixed && len < 5) add({ key: `short|${s.id}`, kind: 'too-short', group: 'session', level: 'warn', ...where, what: `${name} is only ${len} minute${len === 1 ? '' : 's'} long` })
    if (!['exhibition', 'networking'].includes(type) && len > 240) add({ key: `long|${s.id}`, kind: 'too-long', group: 'session', level: 'warn', ...where, what: `${name} runs ${Math.round(len / 6) / 10} hours without a break` })

    const people = (s.links || []).length
    const typed = splitSpeakerLine(s.others || '')
    const talk = talkOfSession.get(Number(s.id))
    const talkSpeaker = !!(talk && String(talk.speaker_name || '').trim())
    if (NEEDS_SPEAKER.includes(type) && !people && !typed.length && !talkSpeaker) {
      add({ key: `no-speaker|${s.id}`, kind: 'no-speaker', group: 'session', level: 'warn', ...where, what: `${name} has no speaker yet` })
    }
    if (type === 'panel' && (people || typed.length)) {
      const mods = (s.links || []).filter((l: any) => l.role === 'moderator').length + typed.filter(p => p.role === 'moderator' || /moderator/i.test(p.info)).length
      const panel = people + typed.length - mods
      if (!mods) add({ key: `no-moderator|${s.id}`, kind: 'no-moderator', group: 'session', level: 'warn', ...where, what: `${name} has no moderator` })
      if (panel < 2) add({ key: `thin-panel|${s.id}`, kind: 'thin-panel', group: 'session', level: 'warn', ...where, what: `${name} has ${panel === 1 ? 'only one panellist' : 'no panellists'}` })
    }
    if (NEEDS_SPEAKER.includes(type) && PLACEHOLDER_TITLE.test(String(s.title || '').trim()) && !talk) {
      add({ key: `no-topic|${s.id}`, kind: 'no-topic', group: 'session', level: 'info', ...where, what: `The ${dayOf(s.start_time) ? where.start + ' ' : ''}${type} is titled only "${s.title}": no topic yet` })
    }
    // An Innovation Talk's speaker lives on the talks list, not here.
    if (typed.length && !talk) add({ key: `typed|${s.id}`, kind: 'typed-people', group: 'session', level: 'info', ...where,
      what: `${name}: ${typed.length === 1 ? typed[0].name + ' is' : typed.length + ' people are'} typed by hand, with no profile, photo or slot email` })
    if (s.status === 'draft') add({ key: `draft|${s.id}`, kind: 'draft', group: 'draft', level: 'info', ...where, what: `${name} is a draft: attendees do not see it` })
  }

  // ---- each speaker ----
  const slots = new Map<number, number>()
  for (const s of sessions) for (const l of s.links || []) slots.set(Number(l.speaker_id), (slots.get(Number(l.speaker_id)) || 0) + 1)
  for (const sp of speakers) {
    const id = Number(sp.id), on = slots.get(id) || 0, shown = Number(sp.is_published) !== 0
    const has = (v: any) => String(v ?? '').trim().length > 0
    if (on && !shown) add({ key: `hidden|${id}`, kind: 'hidden-speaker', group: 'speaker', level: 'warn', speaker_id: id, what: `${sp.name} is on the programme but hidden from attendees` })
    if (on && shown) {
      const need = [!has(sp.photo_url) && 'photo', !has(sp.role) && 'designation', !has(sp.organisation) && 'organisation'].filter(Boolean) as string[]
      const nice = [!has(sp.email) && 'email (the slot email cannot go)', !has(sp.bio) && 'bio'].filter(Boolean) as string[]
      if (need.length) add({ key: `sp-missing|${id}`, kind: 'speaker-missing', group: 'speaker', level: 'warn', speaker_id: id, what: `${sp.name} has no ${need.concat(nice).join(', no ')}` })
      else if (nice.length) add({ key: `sp-nice|${id}`, kind: 'speaker-missing', group: 'speaker', level: 'info', speaker_id: id, what: `${sp.name} has no ${nice.join(', no ')}` })
    }
    if (!on && shown) add({ key: `sp-noslot|${id}`, kind: 'speaker-no-session', group: 'speaker', level: 'info', speaker_id: id, what: `${sp.name} is shown to attendees but has no session yet` })
  }

  // ---- Innovation Talks: the talks list and the programme must say the same ----
  const sesBy = new Map(sessions.map(s => [Number(s.id), s]))
  let unplaced = 0
  for (const t of talks) {
    const s = sesBy.get(linked.get(Number(t.id)) ?? -1)
    const who = `${t.speaker_name || 'A speaker'}${t.company ? ' (' + t.company + ')' : ''}`
    if (t.status === 'cancelled') {
      if (s) add({ key: `talk-cancelled|${t.id}`, kind: 'talk-cancelled', group: 'talk', level: 'warn', ...at(s), talk_id: Number(t.id), what: `${who} is cancelled on the Innovation Talks list but still on the programme` })
      continue
    }
    if (!s && !talkTimed(t)) { unplaced++; continue }
    if (!s) {
      add({ key: `talk-off|${t.id}`, kind: 'talk-not-on-programme', group: 'talk', level: 'warn', talk_id: Number(t.id), day: dayOf(t.starts_at), hall: t.hall || '', start: String(t.starts_at).slice(11, 16), end: talkEnd(t).slice(11, 16),
        what: `${who} has a time on the Innovation Talks list (${t.time_slot || t.starts_at}) but is not on the programme` })
      continue
    }
    const same = talkTimed(t) && t.starts_at === s.start_time && talkEnd(t) === s.end_time && (!('hall' in t) || !t.hall || !s.room || t.hall === s.room)
    if (!same) add({ key: `talk-differs|${t.id}`, kind: 'talk-differs', group: 'talk', level: 'warn', ...at(s), talk_id: Number(t.id),
      what: talkTimed(t)
        ? `${who}: the programme says ${String(s.start_time).slice(11, 16)} to ${String(s.end_time).slice(11, 16)} in ${s.room || 'no hall'}; the Innovation Talks list says ${String(t.starts_at).slice(11, 16)} to ${talkEnd(t).slice(11, 16)}${t.hall ? ' in ' + t.hall : ''}`
        : `${who} is on the programme at ${String(s.start_time).slice(11, 16)}, but the Innovation Talks list has no time for it` })
    if (!String(t.topic || '').trim()) add({ key: `talk-topic|${t.id}`, kind: 'talk-no-topic', group: 'talk', level: 'info', ...at(s), talk_id: Number(t.id), what: `${who} has not sent a topic` })
  }
  if (unplaced) add({ key: 'talks-unplaced', kind: 'talks-unplaced', group: 'talk', level: 'info', what: `${unplaced} Innovation Talk${unplaced === 1 ? ' has' : 's have'} no time yet` })

  // ---- free time ----
  const days = a.days.length ? a.days : a.eventDays
  for (const day of days) {
    if (dayWindow(sessions, day).empty) add({ key: `empty-day|${day}`, kind: 'empty-day', group: 'free', level: 'info', day, what: `Nothing is planned on ${day} yet` })
  }
  const frees = freeSlots(sessions, halls, days.filter(d => !dayWindow(sessions, d).empty))
  const wholeSeen = new Set<string>()
  for (const f of frees) {
    if (f.whole) {
      const k = f.day + '|' + f.hall
      if (wholeSeen.has(k)) continue
      wholeSeen.add(k)
      add({ key: `empty-hall|${k}`, kind: 'empty-hall', group: 'free', level: 'info', day: f.day, hall: f.hall, start: f.start, end: f.end, what: `${f.hall} has nothing all day` })
    } else {
      add({ key: `free|${f.day}|${f.hall}|${f.start}`, kind: 'free', group: 'free', level: 'info', day: f.day, hall: f.hall, start: f.start, end: f.end,
        what: `${f.hall} is free for ${f.minutes >= 60 ? Math.floor(f.minutes / 60) + ' h' + (f.minutes % 60 ? ' ' + (f.minutes % 60) + ' min' : '') : f.minutes + ' minutes'}` })
    }
  }

  const rank = { bad: 0, warn: 1, info: 2 } as const
  return out.sort((x, y) => rank[x.level] - rank[y.level] || String(x.day || '9').localeCompare(String(y.day || '9')) || String(x.start || '99').localeCompare(String(y.start || '99')))
}

// "20-21 November 2026 · World Trade Center, Mumbai", from the event's own row, so a
// second event (Delhi, July 2027) gets its own dates and venue in every sentence.
export function eventWords(event: any): { name: string; when: string; venue: string; line: string } {
  const s = String(event?.start_date || '').slice(0, 10), e = String(event?.end_date || '').slice(0, 10)
  const d = (x: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(x); return m ? { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) } : null }
  const a = d(s), b = d(e) || d(s)
  let when = ''
  if (a && b) {
    when = a.y === b.y && a.m === b.m ? (a.d === b.d ? `${a.d}` : `${a.d}-${b.d}`) + ` ${MONTHS[a.m]} ${a.y}`
      : `${a.d} ${MONTHS[a.m]}${a.y === b.y ? '' : ' ' + a.y} to ${b.d} ${MONTHS[b.m]} ${b.y}`
  }
  const venue = String(event?.venue || '').trim()
  return { name: String(event?.title || 'Bharat AI Innovation').trim(), when, venue, line: [when, venue].filter(Boolean).join(' · ') }
}
// Mumbai's wording as the first emails and announcements carried it.
export const MUMBAI_WORDS = { name: 'Bharat AI Innovation 2026', when: '20-21 November 2026', venue: 'World Trade Center, Mumbai', line: '20-21 November 2026 · World Trade Center, Mumbai' }
export const wordsFor = (event: any) => (Number(event?.id) === 1 || !event ? MUMBAI_WORDS : eventWords(event))

// ---------- database ----------

// Whether 0054's tables exist. Once seen, for the life of the isolate; a missing table
// is asked about again after a minute, so the attendee routes that read this do not
// pay a failing query on every request while the migration is still to run.
const ready: Record<string, boolean> = {}
const notYet: Record<string, number> = {}
async function hasTable(c: any, name: string): Promise<boolean> {
  if (ready[name]) return true
  if (notYet[name] && Date.now() - notYet[name] < 60_000) return false
  try { await c.env.DB.prepare('SELECT 1 FROM ' + name + ' LIMIT 1').first(); ready[name] = true; delete notYet[name]; return true }
  catch { notYet[name] = Date.now(); return false }
}
// Admin's own reads and writes always look again, so the screen flips the moment 0054
// has run; only the attendee routes below use the minute's memory.
function forgetNotYet() { for (const k of Object.keys(notYet)) delete notYet[k] }
export async function adminReady(c: any) { forgetNotYet(); return conferenceReady(c) }
export async function conferenceReady(c: any) {
  const [halls, links, drafts, log] = await Promise.all([
    hasTable(c, 'conference_halls'), hasTable(c, 'session_speakers'), hasTable(c, 'session_admin'), hasTable(c, 'speaker_announcements')])
  return { halls, links, drafts, log, all: halls && links && drafts && log }
}

const audit = async (c: any, action: string, entity: string, id: any, detail: any) => {
  if (hooks.audit) { try { await hooks.audit(c, action, entity, id, detail) } catch { /* the audit log never fails a save */ } }
}
const all = async (c: any, sql: string, ...args: any[]) => (((await c.env.DB.prepare(sql).bind(...args).all()) as any).results || []) as any[]
const one = async (c: any, sql: string, ...args: any[]) => (await c.env.DB.prepare(sql).bind(...args).first()) as any

export async function hallsFor(c: any, eventId: number, isReady: boolean) {
  if (isReady) {
    return await all(c, 'SELECT id, name, short_name, venue_room, location, capacity, purpose, sort_order, is_active FROM conference_halls WHERE event_id = ? ORDER BY sort_order, id', eventId)
  }
  // The built-in four are Mumbai's: another event starts with no halls.
  if (eventId !== 1) return []
  return DEFAULT_HALLS.map((h, i) => ({ id: null, capacity: null, is_active: 1, ...h, sort_order: h.sort_order || i + 1 }))
}

// The event's Innovation Talks (the organisers' own rows and exhibitors' timed ones),
// or none where the table or the event has none.
async function talksFor(c: any, eventId: number): Promise<any[]> {
  try { return await all(c, 'SELECT * FROM innovation_talks WHERE event_id = ? ORDER BY starts_at IS NULL, starts_at, slot_no, id', eventId) }
  catch { return [] }
}
const talkBrief = (t: any) => ({ id: Number(t.id), speaker_name: t.speaker_name || '', speaker_title: t.speaker_title || '', company: t.company || '', topic: t.topic || '',
  status: t.status || 'confirmed', starts_at: t.starts_at || null, duration_min: Number(t.duration_min) || null, time_slot: t.time_slot || '', hall: t.hall || '', photo_url: t.speaker_photo_url || '' })

// Keeps the Innovation Talks list in step with a session that is one of its talks.
async function syncLinkedTalk(c: any, eventId: number, session: { id: number; title: string; speaker_name?: any; start_time: string; end_time: string; room: string }) {
  if (!hooks.syncTalk || !/^innovation talk\b/i.test(String(session.title || ''))) return null
  const talks = await talksFor(c, eventId)
  if (!talks.length) return null
  const ids = [...linkTalks([session], talks)].filter(([, sid]) => sid === Number(session.id)).map(([tid]) => tid)
  for (const tid of ids) {
    try { await hooks.syncTalk(c, tid, session.start_time, minsOf(session.end_time) - minsOf(session.start_time), session.room || '') } catch { /* the programme is saved; the talks list shows the difference */ }
  }
  return ids.length ? ids : null
}

// Every session of the event with its speakers: the saved links where there are any,
// otherwise the ones its typed line names.
export async function sessionsWithSpeakers(c: any, eventId: number, speakers: any[], r: { links: boolean; drafts: boolean }) {
  // One round trip, not three: D1 is ~100 ms away from Mumbai.
  const [sessions, saved, meta] = await Promise.all([
    all(c, 'SELECT * FROM sessions WHERE event_id = ? ORDER BY start_time, id', eventId),
    r.links ? all(c, 'SELECT ss.session_id, ss.speaker_id, ss.role, ss.sort_order FROM session_speakers ss JOIN sessions s ON s.id = ss.session_id WHERE s.event_id = ? ORDER BY ss.session_id, ss.sort_order, ss.id', eventId) : Promise.resolve([]),
    r.drafts ? all(c, 'SELECT sa.session_id, sa.status, sa.note FROM session_admin sa JOIN sessions s ON s.id = sa.session_id WHERE s.event_id = ?', eventId) : Promise.resolve([]),
  ])
  const bySession = new Map<number, any[]>()
  for (const l of saved) {
    const k = Number(l.session_id)
    if (!bySession.has(k)) bySession.set(k, [])
    bySession.get(k)!.push({ speaker_id: Number(l.speaker_id), role: l.role || 'speaker', sort_order: Number(l.sort_order || 0), derived: false })
  }
  const metaBy = new Map(meta.map((m: any) => [Number(m.session_id), m]))
  const known = new Set(speakers.map(s => Number(s.id)))
  return sessions.map((s: any) => {
    const savedLinks = (bySession.get(Number(s.id)) || []).filter(l => known.has(l.speaker_id))
    // With saved links, the line was written from them plus the people typed by hand;
    // without, the line is all there is. Either way, whoever it names that is not a
    // speaker stays as typed.
    const d = deriveLinks(s.speaker_name, speakers, s.session_type)
    const links: any[] = savedLinks.length ? savedLinks : d.links
    const others = typedOthers(s.speaker_name, speakers)
    const m: any = metaBy.get(Number(s.id))
    return { ...s, status: m?.status === 'draft' ? 'draft' : 'published', note: m?.note || '', links, others }
  })
}

// ---------- the one read the screen makes ----------

conf.get('/api/admin/events/:id/conference', async (c) => {
  const eventId = Number(c.req.param('id')) || 1
  forgetNotYet()
  const r = await adminReady(c)
  const [event, speakers, halls, talks, events, team, sessionOwners, speakerOwners] = await Promise.all([
    one(c, 'SELECT id, title, venue, start_date, end_date FROM events WHERE id = ?', eventId),
    all(c, 'SELECT id, slug, name, role, organisation, topic, photo_url, bio, email, phone, linkedin_url, is_featured, is_published, sort_order, updated_at FROM speakers WHERE event_id = ? ORDER BY sort_order, id', eventId),
    hallsFor(c, eventId, r.halls),
    talksFor(c, eventId),
    all(c, 'SELECT e.id, e.title, e.venue, e.start_date, e.end_date, (SELECT COUNT(*) FROM sessions s WHERE s.event_id = e.id) AS sessions FROM events e ORDER BY e.start_date, e.id'),
    // The organising team (Organiser pass holders) and who looks after what.
    organiserTeam(c.env.DB), ownersOf(c.env.DB, 'session'), ownersOf(c.env.DB, 'speaker'),
  ])
  const sessions = await sessionsWithSpeakers(c, eventId, speakers, r)
  for (const s of sessions) s.owner = sessionOwners.get(Number(s.id))?.name || ''
  // Rooms a session names that no hall row has, so nothing scheduled goes missing.
  const named = new Set(halls.map((h: any) => h.name))
  for (const s of sessions) {
    if (s.room && !named.has(s.room)) { named.add(s.room); halls.push({ id: null, name: s.room, short_name: s.room, venue_room: '', location: '', capacity: null, purpose: '', sort_order: 99, is_active: 1, unlisted: true }) }
  }
  const counts = new Map<string, number>()
  for (const s of sessions) if (s.room) counts.set(s.room, (counts.get(s.room) || 0) + 1)
  halls.forEach((h: any) => { h.sessions = counts.get(h.name) || 0 })

  // A speaker's pass: an attendee row under the same email.
  const emails = [...new Set(speakers.map((s: any) => String(s.email || '').trim().toLowerCase()).filter(Boolean))]
  const passes = new Map<string, any>()
  if (emails.length) {
    const rows = await all(c, 'SELECT id, email, badge_type, payment_status FROM attendees WHERE event_id = ? AND LOWER(TRIM(email)) IN (' + emails.map(() => '?').join(',') + ')', eventId, ...emails)
    for (const a of rows) passes.set(String(a.email).trim().toLowerCase(), { id: a.id, badge_type: a.badge_type || '', payment_status: a.payment_status || '' })
  }
  const announced = new Map<number, any>()
  if (r.log) {
    const rows = await all(c, 'SELECT speaker_id, COUNT(*) AS n, MAX(created_at) AS last_at, MAX(emailed) AS emailed FROM speaker_announcements WHERE event_id = ? GROUP BY speaker_id', eventId)
    for (const a of rows) announced.set(Number(a.speaker_id), { n: Number(a.n || 0), last_at: a.last_at, emailed: Number(a.emailed || 0) })
  }
  const slotCount = new Map<number, number>()
  for (const s of sessions) for (const l of s.links) slotCount.set(l.speaker_id, (slotCount.get(l.speaker_id) || 0) + 1)
  const outSpeakers = speakers.map((s: any) => ({
    ...s, pass: passes.get(String(s.email || '').trim().toLowerCase()) || null,
    announced: announced.get(Number(s.id)) || null, slots: slotCount.get(Number(s.id)) || 0,
    owner: speakerOwners.get(Number(s.id))?.name || '',
  }))

  const byId = new Map(speakers.map((s: any) => [Number(s.id), s]))
  const clashes = findClashes(sessions.map((s: any) => ({
    id: s.id, title: s.title, room: s.room, session_type: s.session_type, start_time: s.start_time, end_time: s.end_time, status: s.status,
    speakers: s.links.map((l: any) => ({ id: l.speaker_id, name: byId.get(l.speaker_id)?.name || '' })),
  })))

  const days = eventDaysOf(event)
  const eventDays = [...days]
  for (const s of sessions) { const day = String(s.start_time || '').slice(0, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(day) && !days.includes(day)) days.push(day) }
  days.sort()

  // The scheduler: which session is which Innovation Talk, what needs a person's
  // eye, where each hall is free, and the talks still to be given a time.
  const linked = linkTalks(sessions, talks)
  const talkOf = new Map<number, any[]>()
  for (const t of talks) { const sid = linked.get(Number(t.id)); if (sid) { if (!talkOf.has(sid)) talkOf.set(sid, []); talkOf.get(sid)!.push(talkBrief(t)) } }
  for (const s of sessions) { const mine = talkOf.get(Number(s.id)); if (mine) s.talks = mine }
  const issues = findIssues({ sessions, speakers: outSpeakers, halls, days, eventDays, talks, clashes })
  const free = freeSlots(sessions, halls, days)
  const unplaced = talks.filter((t: any) => t.status !== 'cancelled' && !linked.has(Number(t.id))).map(talkBrief)

  return c.json({
    ready: r, migration: MIGRATION_FILE, command: MIGRATION_COMMAND,
    event, days, event_days: eventDays, halls, speakers: outSpeakers, sessions, clashes,
    issues, free, windows: Object.fromEntries(days.map(d => [d, dayWindow(sessions, d)])),
    talks: { total: talks.length, on_programme: linked.size, unplaced },
    events, words: wordsFor(event),
    session_types: SESSION_TYPES, speaker_roles: SPEAKER_ROLES,
    team: team.map(m => ({ name: m.name })),
  })
})

// ---------- who looks after a speaker or a session ----------

// The owner a save carries, when it carries one: 'owner' in the body, '' for nobody.
// Never fails the save it rides on; the audit log records a real change.
async function saveOwnerFrom(c: any, kind: 'session' | 'speaker', id: number, b: any, label: string) {
  if (!b || !('owner' in b)) return
  try {
    const r = await setOwner(c.env.DB, kind, id, b.owner, await organiserTeam(c.env.DB))
    if (r.changed) await audit(c, kind + '.owner', kind, id, { name: label, from: r.before?.name || '(nobody)', to: r.after?.name || '(nobody)' })
  } catch { /* the speaker or session is saved; the owner can be set again from the list */ }
}

// One owner, from the lists' own boxes: { kind: 'speaker' | 'session', id, owner }.
conf.put('/api/admin/conference/owner', async (c) => {
  const b = await c.req.json().catch(() => ({})) as any
  const id = Number(b.id)
  if (!isOwnerKind(b.kind) || !Number.isInteger(id) || id <= 0) return c.json({ error: 'Say which speaker or session.' }, 400)
  const row = b.kind === 'speaker'
    ? await one(c, 'SELECT id, name AS label FROM speakers WHERE id = ?', id)
    : await one(c, 'SELECT id, title AS label FROM sessions WHERE id = ?', id)
  if (!row) return c.json({ error: 'That ' + b.kind + ' is not on the list any more. Reload the page.' }, 404)
  const r = await setOwner(c.env.DB, b.kind, id, b.owner, await organiserTeam(c.env.DB))
  if (r.changed) await audit(c, b.kind + '.owner', b.kind, id, { name: row.label, from: r.before?.name || '(nobody)', to: r.after?.name || '(nobody)' })
  return c.json({ success: true, owner: r.after?.name || '', changed: r.changed })
})

// The event's own days, from its row.
function eventDaysOf(event: any): string[] {
  const days: string[] = []
  if (event?.start_date && event?.end_date) {
    const d = new Date(String(event.start_date).slice(0, 10) + 'T00:00:00Z'), end = new Date(String(event.end_date).slice(0, 10) + 'T00:00:00Z')
    for (let i = 0; i < 10 && d <= end; i++) { days.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1) }
  }
  return days
}

// Where a session of this length fits (the editor's "Find a free slot").
conf.post('/api/admin/events/:id/conference/suggest', async (c) => {
  const eventId = Number(c.req.param('id')) || 1
  const b = await c.req.json().catch(() => ({})) as any
  const day = String(b.day || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return c.json({ error: 'Choose the day first.' }, 400)
  const minutes = Math.round(Number(b.minutes))
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 600) return c.json({ error: 'Set how long the session is (5 minutes or more).' }, 400)
  const r = await adminReady(c)
  const speakers = await all(c, 'SELECT id, name FROM speakers WHERE event_id = ?', eventId)
  const [sessions, halls] = await Promise.all([sessionsWithSpeakers(c, eventId, speakers, r), hallsFor(c, eventId, r.halls)])
  const slots = suggestSlots(sessions, halls, { day, minutes, hall: String(b.hall || ''), speakerIds: Array.isArray(b.speaker_ids) ? b.speaker_ids.map(Number) : [], exceptId: b.except_id ? Number(b.except_id) : null, limit: 10 })
  return c.json({ day, minutes, slots })
})

// ---------- a second event ----------

// Delhi 2027 as the paid-pass code creates it on its first buyer (index.tsx, DELHI
// 2027): the same id, name, venue and dates, so whichever comes first, the row is one.
const DELHI = { id: 2, title: 'Bharat AI Innovation Delhi 2027', venue: 'Bharat Mandapam, New Delhi', start_date: '2027-07-28', end_date: '2027-07-29' }
conf.post('/api/admin/conference/start-delhi', async (c) => {
  await c.env.DB.prepare("INSERT OR IGNORE INTO events (id, title, event_type, venue, start_date, end_date) VALUES (?, ?, 'conference', ?, ?, ?)")
    .bind(DELHI.id, DELHI.title, DELHI.venue, DELHI.start_date, DELHI.end_date).run()
  const event = await one(c, 'SELECT id, title, venue, start_date, end_date FROM events WHERE id = ?', DELHI.id)
  await audit(c, 'conference.start_event', 'event', DELHI.id, { title: event?.title })
  return c.json({ success: true, event })
})

// Starts one event's programme from another's: the halls (their event names, capacity
// and purpose; the venue's own room names are another building's, so they are left
// empty) and every session as a DRAFT with no speakers, on the same day number and at
// the same times. Refused once the event has sessions of its own.
conf.post('/api/admin/events/:id/conference/copy-from/:src', async (c) => {
  const eventId = Number(c.req.param('id')), srcId = Number(c.req.param('src'))
  if (!eventId || !srcId || eventId === srcId) return c.json({ error: 'Choose a different event to copy from.' }, 400)
  const r = await adminReady(c)
  if (!r.halls || !r.drafts) return needsMigration(c)
  const [event, src] = await Promise.all([
    one(c, 'SELECT id, title, start_date, end_date FROM events WHERE id = ?', eventId),
    one(c, 'SELECT id, title, start_date, end_date FROM events WHERE id = ?', srcId)])
  if (!event || !src) return c.json({ error: 'That event is not there. Reload the page.' }, 404)
  const have = Number((await one(c, 'SELECT COUNT(*) AS n FROM sessions WHERE event_id = ?', eventId))?.n || 0)
  if (have) return c.json({ error: event.title + ' already has ' + have + ' session' + (have === 1 ? '' : 's') + '. Copying is only for an empty programme.' }, 409)
  const toDays = eventDaysOf(event), fromDays = eventDaysOf(src)
  if (!toDays.length) return c.json({ error: event.title + ' has no dates yet.' }, 409)

  let hallsCopied = 0
  if (!Number((await one(c, 'SELECT COUNT(*) AS n FROM conference_halls WHERE event_id = ?', eventId))?.n || 0)) {
    const halls = await all(c, 'SELECT name, short_name, capacity, purpose, sort_order FROM conference_halls WHERE event_id = ? AND is_active = 1 ORDER BY sort_order, id', srcId)
    for (const h of halls) {
      await c.env.DB.prepare('INSERT OR IGNORE INTO conference_halls (event_id, name, short_name, venue_room, location, capacity, purpose, sort_order) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?)')
        .bind(eventId, h.name, h.short_name, h.capacity, h.purpose, h.sort_order).run()
      hallsCopied++
    }
  }
  const sessions = await all(c, 'SELECT title, description, session_type, track, room, start_time, end_time, capacity, speaker_avatar FROM sessions WHERE event_id = ? ORDER BY start_time, id', srcId)
  let copied = 0, skipped = 0
  for (const s of sessions) {
    const i = fromDays.indexOf(dayOf(s.start_time))
    if (i < 0 || i >= toDays.length || !isTimed(s)) { skipped++; continue }
    const res = await c.env.DB.prepare(
      'INSERT INTO sessions (event_id, title, description, speaker_name, speaker_title, speaker_avatar, session_type, track, room, start_time, end_time, capacity) VALUES (?,?,?,NULL,NULL,?,?,?,?,?,?,?)'
    ).bind(eventId, s.title, s.description, s.speaker_avatar, s.session_type, s.track, s.room, toDays[i] + String(s.start_time).slice(10, 16), toDays[i] + String(s.end_time).slice(10, 16), s.capacity || 100).run()
    await c.env.DB.prepare("INSERT INTO session_admin (session_id, status, note, updated_at) VALUES (?, 'draft', ?, CURRENT_TIMESTAMP)")
      .bind(Number(res.meta.last_row_id), 'Copied from ' + src.title + '. Give it its own title and speakers.').run()
    copied++
  }
  await audit(c, 'conference.copy_structure', 'event', eventId, { from: srcId, sessions: copied, halls: hallsCopied, skipped })
  return c.json({ success: true, sessions: copied, halls: hallsCopied, skipped })
})

// ---------- speakers ----------

const SPEAKER_TEXT: Record<string, number> = { name: 120, role: 200, organisation: 200, topic: 200, bio: 3000, email: 160, phone: 20, linkedin_url: 300, photo_url: 400 }

function speakerFields(b: any): { set: Record<string, any>; error?: string } {
  const set: Record<string, any> = {}
  for (const k of Object.keys(SPEAKER_TEXT)) {
    if (!(k in b)) continue
    const v = String(b[k] == null ? '' : b[k]).trim()
    if (v.length > SPEAKER_TEXT[k]) return { set, error: 'That ' + k.replace('_url', '').replace('_', ' ') + ' is too long (at most ' + SPEAKER_TEXT[k] + ' characters).' }
    set[k] = v || null
  }
  if ('name' in set && !set.name) return { set, error: 'Write the speaker\'s name.' }
  if (set.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(set.email)) return { set, error: 'That email address does not look right.' }
  if (set.email) set.email = String(set.email).toLowerCase()
  if (set.phone) {
    const digits = String(set.phone).replace(/[^\d+]/g, '')
    if (digits.replace(/\D/g, '').length < 10) return { set, error: 'A mobile number needs at least 10 digits.' }
    set.phone = digits
  }
  if (set.linkedin_url && !/^https:\/\/([a-z]+\.)?linkedin\.com\//i.test(set.linkedin_url)) return { set, error: 'The LinkedIn link should start with https://www.linkedin.com/' }
  if (set.photo_url && !/^(\/|https:\/\/)/.test(set.photo_url)) return { set, error: 'A photo must be uploaded here or be an https:// link.' }
  for (const k of ['is_featured', 'is_published']) if (k in b) set[k] = b[k] ? 1 : 0
  if ('sort_order' in b) { const n = Math.round(Number(b.sort_order)); set.sort_order = Number.isFinite(n) ? Math.max(0, Math.min(9999, n)) : 0 }
  return { set }
}

async function uniqueSlug(c: any, eventId: number, name: string, exceptId: number | null = null) {
  const base = slugFor(name)
  const rows = await all(c, 'SELECT id, slug FROM speakers WHERE event_id = ? AND (slug = ? OR slug LIKE ?)', eventId, base, base + '-%')
  const taken = new Set(rows.filter((r: any) => Number(r.id) !== exceptId).map((r: any) => r.slug))
  if (!taken.has(base)) return base
  for (let i = 2; i < 200; i++) if (!taken.has(base + '-' + i)) return base + '-' + i
  return base + '-' + Date.now()
}

conf.post('/api/admin/speakers', async (c) => {
  const b = await c.req.json().catch(() => ({})) as any
  const eventId = Number(b.event_id) || 1
  const { set, error } = speakerFields({ is_published: 1, ...b })
  if (error) return c.json({ error }, 400)
  if (!set.name) return c.json({ error: 'Write the speaker\'s name.' }, 400)
  if (set.email) {
    const dup = await one(c, 'SELECT id, name FROM speakers WHERE event_id = ? AND LOWER(email) = ?', eventId, set.email)
    if (dup) return c.json({ error: 'That email is already on ' + dup.name + '.', speaker_id: dup.id }, 409)
  }
  const same = await one(c, 'SELECT id, name FROM speakers WHERE event_id = ? AND LOWER(TRIM(name)) = ?', eventId, String(set.name).trim().toLowerCase())
  if (same && !b.allow_same_name) return c.json({ error: same.name + ' is already a speaker. Open them to edit, or save again to add a second person with this name.', speaker_id: same.id, same_name: true }, 409)
  if (!('sort_order' in set)) set.sort_order = Number((await one(c, 'SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM speakers WHERE event_id = ?', eventId))?.n || 1)
  const slug = await uniqueSlug(c, eventId, set.name)
  const cols = ['event_id', 'slug', ...Object.keys(set)]
  const res = await c.env.DB.prepare('INSERT INTO speakers (' + cols.join(', ') + ') VALUES (' + cols.map(() => '?').join(', ') + ')')
    .bind(eventId, slug, ...Object.values(set)).run()
  const id = res.meta.last_row_id
  await audit(c, 'speaker.create', 'speaker', id, { name: set.name, organisation: set.organisation || '', published: set.is_published })
  await saveOwnerFrom(c, 'speaker', Number(id), b, set.name)
  return c.json({ success: true, id, slug }, 201)
})

conf.put('/api/admin/speakers/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json().catch(() => ({})) as any
  const before = await one(c, 'SELECT * FROM speakers WHERE id = ?', id)
  if (!before) return c.json({ error: 'That speaker is not on the list any more. Reload the page.' }, 404)
  const { set, error } = speakerFields(b)
  if (error) return c.json({ error }, 400)
  await saveOwnerFrom(c, 'speaker', id, b, before.name)
  if (!Object.keys(set).length) return c.json({ success: true, unchanged: true })
  if (set.email && set.email !== String(before.email || '').toLowerCase()) {
    const dup = await one(c, 'SELECT id, name FROM speakers WHERE event_id = ? AND LOWER(email) = ? AND id != ?', before.event_id, set.email, id)
    if (dup) return c.json({ error: 'That email is already on ' + dup.name + '.', speaker_id: dup.id }, 409)
  }
  // The line the app shows carries the name, role and organisation: rewrite it on the
  // sessions they are in, recognising the old wording.
  const lineChanges = (['name', 'organisation', 'role'] as const).some(k => k in set && String(set[k] || '') !== String(before[k] || ''))
  const was = lineChanges ? await all(c, SPEAKER_COLS, before.event_id) : []
  const affected = lineChanges ? await sessionIdsOfSpeaker(c, Number(before.event_id), id, was) : []
  await c.env.DB.prepare('UPDATE speakers SET ' + Object.keys(set).map(k => k + ' = ?').join(', ') + ', updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(...Object.values(set), id).run()
  for (const sid of affected) await recomposeSession(c, sid, was)
  await audit(c, 'speaker.update', 'speaker', id, { name: set.name || before.name, changes: hooks.changedFields ? hooks.changedFields(before, set) : Object.keys(set) })
  return c.json({ success: true })
})

conf.delete('/api/admin/speakers/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const before = await one(c, 'SELECT id, event_id, name, organisation FROM speakers WHERE id = ?', id)
  if (!before) return c.json({ success: true, gone: true })
  const r = await adminReady(c)
  const was = await all(c, SPEAKER_COLS, before.event_id)
  const sessionIds = await sessionIdsOfSpeaker(c, Number(before.event_id), id, was)
  if (r.links) await c.env.DB.prepare('DELETE FROM session_speakers WHERE speaker_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM speakers WHERE id = ?').bind(id).run()
  await clearOwner(c.env.DB, 'speaker', id)
  // Their name leaves each session's line; everyone else on it stays.
  for (const sid of sessionIds) await recomposeSession(c, sid, was)
  await audit(c, 'speaker.delete', 'speaker', id, { name: before.name, organisation: before.organisation || '', sessions: sessionIds })
  return c.json({ success: true })
})

// The order of the speakers list (and of the app's speaker strip), as dragged.
conf.post('/api/admin/speakers/reorder', async (c) => {
  const b = await c.req.json().catch(() => ({})) as any
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter((n: number) => Number.isFinite(n) && n > 0).slice(0, 500)
  if (!ids.length) return c.json({ error: 'Nothing to reorder.' }, 400)
  for (let i = 0; i < ids.length; i++) await c.env.DB.prepare('UPDATE speakers SET sort_order = ? WHERE id = ?').bind(i + 1, ids[i]).run()
  await audit(c, 'speaker.reorder', 'speaker', null, { count: ids.length })
  return c.json({ success: true, count: ids.length })
})

// A photo chosen in Admin, cropped square in the browser, kept in the uploads bucket.
conf.post('/api/admin/speakers/:id/photo', async (c) => {
  const id = Number(c.req.param('id'))
  const sp = await one(c, 'SELECT id, name, photo_url FROM speakers WHERE id = ?', id)
  if (!sp) return c.json({ error: 'That speaker is not on the list any more.' }, 404)
  if (!c.env.UPLOADS) return c.json({ error: 'Photo storage is not set up on this server, so the photo was not saved.' }, 503)
  const b = await c.req.json().catch(() => ({})) as any
  const m = String(b.image || '').match(/^data:(image\/(jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/)
  if (!m) return c.json({ error: 'Choose a JPEG, PNG or WebP photo.' }, 400)
  const bin = atob(m[3])
  if (bin.length > 2 * 1024 * 1024) return c.json({ error: 'That photo is larger than 2 MB. Choose a smaller one.' }, 413)
  if (bin.length < 1024) return c.json({ error: 'That file is too small to be a photo.' }, 400)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const ext = m[2] === 'jpeg' ? 'jpg' : m[2]
  const key = 'speakers/' + id + '-' + Date.now() + '.' + ext
  await c.env.UPLOADS.put(key, bytes, { httpMetadata: { contentType: m[1], cacheControl: 'public, max-age=31536000' } })
  const url = '/api/uploads/' + key
  await c.env.DB.prepare('UPDATE speakers SET photo_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(url, id).run()
  const prev = String(sp.photo_url || '')
  if (prev.startsWith('/api/uploads/speakers/')) { try { await c.env.UPLOADS.delete(prev.slice('/api/uploads/'.length)) } catch { /* an orphan file costs nothing */ } }
  await audit(c, 'speaker.photo', 'speaker', id, { name: sp.name })
  return c.json({ success: true, photo_url: url })
})

// ---------- halls ----------

// A speaker's pass: the attendee row behind their email becomes a Speaker pass (or is
// made). A pass of their own, a paid Delegate or a VIP, is kept. Only for the event
// whose registration is open in this app (Mumbai, event 1): another event's passes
// open with its own registration.
conf.post('/api/admin/speakers/:id/pass', async (c) => {
  const id = Number(c.req.param('id'))
  const sp = await one(c, 'SELECT id, event_id, name, role, organisation, email, phone, linkedin_url, photo_url FROM speakers WHERE id = ?', id)
  if (!sp) return c.json({ error: 'That speaker is not on the list any more.' }, 404)
  if (Number(sp.event_id) !== 1) return c.json({ error: 'Passes for this event open when its registration does.' }, 409)
  if (!String(sp.email || '').trim()) return c.json({ error: 'Add an email for ' + sp.name + ' first: the pass is kept under it.' }, 409)
  if (!hooks.issueSpeakerPass) return c.json({ error: 'Passes are not set up on this server.' }, 503)
  const r: any = await hooks.issueSpeakerPass(c, { eventId: 1, name: sp.name, email: sp.email, mobile: sp.phone || '', company: sp.organisation || '', designation: sp.role || '',
    linkedin: sp.linkedin_url || '', avatarUrl: /^\/api\/uploads\//.test(String(sp.photo_url || '')) ? sp.photo_url : '' })
  if (r.error) return c.json({ error: r.error }, 409)
  await audit(c, 'speaker.pass', 'speaker', id, { name: sp.name, attendee_id: r.attendeeId, pass: r.pass, created: r.created, raised: r.raised, kept: r.kept })
  return c.json({ success: true, attendee_id: r.attendeeId, pass: r.pass, created: r.created, raised: r.raised, kept: r.kept })
})

const HALL_TEXT: Record<string, number> = { name: 80, short_name: 40, venue_room: 80, location: 200, purpose: 120 }
function hallFields(b: any): { set: Record<string, any>; error?: string } {
  const set: Record<string, any> = {}
  for (const k of Object.keys(HALL_TEXT)) {
    if (!(k in b)) continue
    const v = String(b[k] == null ? '' : b[k]).replace(/\s+/g, ' ').trim()
    if (v.length > HALL_TEXT[k]) return { set, error: 'That ' + k.replace('_', ' ') + ' is too long.' }
    set[k] = v || null
  }
  if ('name' in set && !set.name) return { set, error: 'Write the hall\'s name.' }
  if ('capacity' in b) { const n = Math.round(Number(b.capacity)); set.capacity = b.capacity === '' || b.capacity == null || !Number.isFinite(n) ? null : Math.max(0, Math.min(100000, n)) }
  if ('sort_order' in b) { const n = Math.round(Number(b.sort_order)); set.sort_order = Number.isFinite(n) ? Math.max(0, Math.min(999, n)) : 0 }
  if ('is_active' in b) set.is_active = b.is_active ? 1 : 0
  return { set }
}
const needsMigration = (c: any) => c.json({ error: 'Run migration ' + MIGRATION_FILE + ' first (Admin -> Conference shows the command).', needs_migration: true, command: MIGRATION_COMMAND }, 409)

conf.post('/api/admin/halls', async (c) => {
  const r = await adminReady(c)
  if (!r.halls) return needsMigration(c)
  const b = await c.req.json().catch(() => ({})) as any
  const eventId = Number(b.event_id) || 1
  const { set, error } = hallFields(b)
  if (error) return c.json({ error }, 400)
  if (!set.name) return c.json({ error: 'Write the hall\'s name.' }, 400)
  if (await one(c, 'SELECT id FROM conference_halls WHERE event_id = ? AND name = ?', eventId, set.name)) return c.json({ error: 'There is already a hall called ' + set.name + '.' }, 409)
  if (!('sort_order' in set)) set.sort_order = Number((await one(c, 'SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM conference_halls WHERE event_id = ?', eventId))?.n || 1)
  const cols = ['event_id', ...Object.keys(set)]
  const res = await c.env.DB.prepare('INSERT INTO conference_halls (' + cols.join(', ') + ') VALUES (' + cols.map(() => '?').join(', ') + ')').bind(eventId, ...Object.values(set)).run()
  await audit(c, 'hall.create', 'hall', res.meta.last_row_id, { name: set.name })
  return c.json({ success: true, id: res.meta.last_row_id }, 201)
})

conf.put('/api/admin/halls/:id', async (c) => {
  const r = await adminReady(c)
  if (!r.halls) return needsMigration(c)
  const id = Number(c.req.param('id'))
  const before = await one(c, 'SELECT * FROM conference_halls WHERE id = ?', id)
  if (!before) return c.json({ error: 'That hall is not on the list any more. Reload the page.' }, 404)
  const b = await c.req.json().catch(() => ({})) as any
  const { set, error } = hallFields(b)
  if (error) return c.json({ error }, 400)
  if (!Object.keys(set).length) return c.json({ success: true, unchanged: true })
  let moved = 0
  if (set.name && set.name !== before.name) {
    if (await one(c, 'SELECT id FROM conference_halls WHERE event_id = ? AND name = ? AND id != ?', before.event_id, set.name, id)) return c.json({ error: 'There is already a hall called ' + set.name + '.' }, 409)
    // sessions.room holds the hall's name: its sessions move with it.
    const res = await c.env.DB.prepare('UPDATE sessions SET room = ? WHERE event_id = ? AND room = ?').bind(set.name, before.event_id, before.name).run()
    moved = Number(res.meta?.changes || 0)
  }
  await c.env.DB.prepare('UPDATE conference_halls SET ' + Object.keys(set).map(k => k + ' = ?').join(', ') + ', updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(...Object.values(set), id).run()
  await audit(c, 'hall.update', 'hall', id, { name: set.name || before.name, changes: hooks.changedFields ? hooks.changedFields(before, set) : Object.keys(set), sessions_moved: moved })
  return c.json({ success: true, sessions_moved: moved })
})

conf.delete('/api/admin/halls/:id', async (c) => {
  const r = await adminReady(c)
  if (!r.halls) return needsMigration(c)
  const id = Number(c.req.param('id'))
  const h = await one(c, 'SELECT * FROM conference_halls WHERE id = ?', id)
  if (!h) return c.json({ success: true, gone: true })
  const n = Number((await one(c, 'SELECT COUNT(*) AS n FROM sessions WHERE event_id = ? AND room = ?', h.event_id, h.name))?.n || 0)
  if (n) return c.json({ error: h.name + ' still has ' + n + ' session' + (n === 1 ? '' : 's') + '. Move them to another hall first.', sessions: n }, 409)
  await c.env.DB.prepare('DELETE FROM conference_halls WHERE id = ?').bind(id).run()
  await audit(c, 'hall.delete', 'hall', id, { name: h.name })
  return c.json({ success: true })
})

// ---------- sessions ----------

const SPEAKER_COLS = 'SELECT id, name, organisation, role AS role_title FROM speakers WHERE event_id = ?'

// Rewrites a session's typed line from its speakers as they are now. `before` is the
// speakers list as it was before the change being saved (a rename, a removal), so the
// line's old wording is still recognised as those people and not kept as typed text.
async function recomposeSession(c: any, sessionId: number, before: any[] | null = null) {
  const s = await one(c, 'SELECT id, event_id, speaker_name, speaker_title, session_type FROM sessions WHERE id = ?', sessionId)
  if (!s) return
  const r = await adminReady(c)
  const now = await all(c, SPEAKER_COLS, s.event_id)
  const was = before || now
  const saved = r.links ? await all(c, 'SELECT speaker_id, role, sort_order FROM session_speakers WHERE session_id = ? ORDER BY sort_order, id', sessionId) : []
  const links = saved.length ? saved : deriveLinks(s.speaker_name, was, s.session_type).links
  const nowBy = new Map(now.map((x: any) => [Number(x.id), x]))
  const people = links.map((l: any) => ({ ...(nowBy.get(Number(l.speaker_id)) || {}), role: l.role })).filter((p: any) => p.name)
  const others = typedOthers(s.speaker_name, was)
  const line = composeSpeakerLine(people, others, people.length ? '' : s.speaker_title)
  if (line.speaker_name === s.speaker_name && line.speaker_title === s.speaker_title) return
  await c.env.DB.prepare('UPDATE sessions SET speaker_name = ?, speaker_title = ? WHERE id = ?').bind(line.speaker_name, line.speaker_title, sessionId).run()
}

// The sessions a speaker is in: saved links, or a name match on a session that has none.
async function sessionIdsOfSpeaker(c: any, eventId: number, speakerId: number, speakers: any[]) {
  const r = await adminReady(c)
  const ids = new Set<number>()
  const withSaved = new Set<number>()
  if (r.links) {
    for (const x of await all(c, 'SELECT ss.session_id, ss.speaker_id FROM session_speakers ss JOIN sessions s ON s.id = ss.session_id WHERE s.event_id = ?', eventId)) {
      withSaved.add(Number(x.session_id))
      if (Number(x.speaker_id) === speakerId) ids.add(Number(x.session_id))
    }
  }
  for (const s of await all(c, 'SELECT id, speaker_name, session_type FROM sessions WHERE event_id = ?', eventId)) {
    if (withSaved.has(Number(s.id))) continue
    if (deriveLinks(s.speaker_name, speakers, s.session_type).links.some(l => l.speaker_id === speakerId)) ids.add(Number(s.id))
  }
  return [...ids]
}

// Turns the name matches into saved links, for one speaker or for every session.
async function saveDerivedLinks(c: any, eventId: number, onlySpeaker: number | null = null) {
  const speakers = await all(c, 'SELECT id, name FROM speakers WHERE event_id = ?', eventId)
  const sessions = await all(c, 'SELECT id, speaker_name, session_type FROM sessions WHERE event_id = ?', eventId)
  const withLinks = new Set((await all(c, 'SELECT DISTINCT ss.session_id FROM session_speakers ss JOIN sessions s ON s.id = ss.session_id WHERE s.event_id = ?', eventId)).map((x: any) => Number(x.session_id)))
  let made = 0, sessionsTouched = 0
  for (const s of sessions) {
    if (withLinks.has(Number(s.id))) continue
    const d = deriveLinks(s.speaker_name, speakers, s.session_type)
    const pick = onlySpeaker ? (d.links.some(l => l.speaker_id === onlySpeaker) ? d.links : []) : d.links
    if (!pick.length) continue
    sessionsTouched++
    for (const l of pick) {
      await c.env.DB.prepare('INSERT OR IGNORE INTO session_speakers (session_id, speaker_id, role, sort_order) VALUES (?, ?, ?, ?)').bind(s.id, l.speaker_id, l.role, l.sort_order).run()
      made++
    }
  }
  return { made, sessions: sessionsTouched }
}

conf.post('/api/admin/events/:id/conference/link-speakers', async (c) => {
  const r = await adminReady(c)
  if (!r.links) return needsMigration(c)
  const eventId = Number(c.req.param('id')) || 1
  const out = await saveDerivedLinks(c, eventId)
  await audit(c, 'session.link_speakers', 'session', null, out)
  return c.json({ success: true, ...out })
})

async function validSession(c: any, b: any, eventId: number, sessionId: number | null) {
  const title = String(b.title || '').replace(/\s+/g, ' ').trim()
  if (!title) return { error: 'Give the session a title.' }
  if (title.length > 200) return { error: 'That title is too long (at most 200 characters).' }
  const start = cleanTime(b.start_time), end = cleanTime(b.end_time)
  if (!start || !end) return { error: 'Choose the day, the start time and the end time.' }
  if (end <= start) return { error: 'The session must end after it starts.' }
  if (start.slice(0, 10) !== end.slice(0, 10)) return { error: 'A session must start and end on the same day.' }
  const room = String(b.room || '').replace(/\s+/g, ' ').trim().slice(0, 100)
  const type = SESSION_TYPES.includes(String(b.session_type)) ? String(b.session_type) : 'talk'
  const cap = Math.round(Number(b.capacity))
  const status = b.status === 'draft' ? 'draft' : 'published'
  const note = String(b.note || '').trim().slice(0, 1000)
  const speakerRows = Array.isArray(b.speakers) ? b.speakers.slice(0, 40) : null
  let people: any[] = []
  if (speakerRows) {
    const ids = [...new Set(speakerRows.map((x: any) => Number(x.speaker_id)).filter((n: number) => n > 0))] as number[]
    const found = ids.length ? await all(c, 'SELECT id, name, organisation, role AS role_title FROM speakers WHERE event_id = ? AND id IN (' + ids.map(() => '?').join(',') + ')', eventId, ...ids) : []
    const byId = new Map(found.map((f: any) => [Number(f.id), f]))
    if (found.length !== ids.length) return { error: 'One of the chosen speakers is not on the speakers list any more. Reload the page.' }
    const seen = new Set<number>()
    people = speakerRows.filter((x: any) => { const k = Number(x.speaker_id); if (seen.has(k) || !byId.has(k)) return false; seen.add(k); return true })
      .map((x: any, i: number) => ({ ...byId.get(Number(x.speaker_id)), speaker_id: Number(x.speaker_id), role: SPEAKER_ROLES.includes(String(x.role)) ? String(x.role) : defaultRole(type), sort_order: i }))
  }
  return {
    row: { title, description: String(b.description || '').trim().slice(0, 2000), session_type: type, track: String(b.track || '').trim().slice(0, 100),
      room, start_time: start, end_time: end, capacity: Number.isFinite(cap) && cap > 0 ? Math.min(cap, 100000) : 100, speaker_avatar: String(b.speaker_avatar || '').slice(0, 8) },
    status, note, people, speakersGiven: !!speakerRows, others: String(b.others || '').trim().slice(0, 1000), typedTitle: String(b.speaker_title || '').trim().slice(0, 300),
    sessionId,
  }
}

// What this save would clash with: the same hall at the same time, or one of its
// speakers somewhere else at the same time.
async function clashesFor(c: any, eventId: number, v: any, r: any) {
  const speakers = await all(c, 'SELECT id, name FROM speakers WHERE event_id = ?', eventId)
  const everything = await sessionsWithSpeakers(c, eventId, speakers, r)
  const sessions = everything.filter((s: any) => Number(s.id) !== Number(v.sessionId))
  const byId = new Map(speakers.map((s: any) => [Number(s.id), s]))
  // A move changes no speakers: v.people is null and the session's own are used.
  const self = everything.find((s: any) => Number(s.id) === Number(v.sessionId))
  const people = v.people || (self ? self.links.map((l: any) => ({ speaker_id: l.speaker_id, name: byId.get(l.speaker_id)?.name || '' })) : [])
  const mine = {
    id: -1, title: v.row.title, room: v.row.room, session_type: v.row.session_type, start_time: v.row.start_time, end_time: v.row.end_time,
    speakers: people.map((p: any) => ({ id: p.speaker_id, name: p.name })),
  }
  const res = findClashes([mine, ...sessions.map((s: any) => ({ id: s.id, title: s.title, room: s.room, session_type: s.session_type, start_time: s.start_time, end_time: s.end_time,
    speakers: s.links.map((l: any) => ({ id: l.speaker_id, name: byId.get(l.speaker_id)?.name || '' })) }))])
  const mineOnly = (x: any) => x.a.id === -1 || x.b.id === -1
  const other = (x: any) => (x.a.id === -1 ? x.b : x.a)
  return [
    ...res.room.filter(mineOnly).map((x: any) => ({ kind: 'hall', what: x.room + ' already has "' + other(x).title + '" from ' + other(x).start_time.slice(11) + ' to ' + other(x).end_time.slice(11) + '.', session_id: other(x).id })),
    ...res.speaker.filter(mineOnly).map((x: any) => ({ kind: 'speaker', what: x.speaker + ' is also in "' + other(x).title + '" (' + (other(x).room || 'no hall') + ', ' + other(x).start_time.slice(11) + ').', session_id: other(x).id, speaker_id: x.speaker_id })),
  ]
}

async function writeSessionExtras(c: any, sessionId: number, v: any, r: any) {
  if (r.links && v.speakersGiven) {
    await c.env.DB.prepare('DELETE FROM session_speakers WHERE session_id = ?').bind(sessionId).run()
    for (const p of v.people) {
      await c.env.DB.prepare('INSERT INTO session_speakers (session_id, speaker_id, role, sort_order) VALUES (?, ?, ?, ?)').bind(sessionId, p.speaker_id, p.role, p.sort_order).run()
    }
  }
  if (r.drafts) {
    await c.env.DB.prepare('INSERT INTO session_admin (session_id, status, note, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(session_id) DO UPDATE SET status = excluded.status, note = excluded.note, updated_at = CURRENT_TIMESTAMP')
      .bind(sessionId, v.status, v.note || null).run()
  }
}

conf.post('/api/admin/sessions', async (c) => {
  const b = await c.req.json().catch(() => ({})) as any
  const eventId = Number(b.event_id) || 1
  const r = await adminReady(c)
  const v: any = await validSession(c, b, eventId, null)
  if (v.error) return c.json({ error: v.error }, 400)
  if (v.status === 'draft' && !r.drafts) return needsMigration(c)
  const clashes = await clashesFor(c, eventId, v, r)
  if (clashes.length && !b.force) return c.json({ error: 'This slot clashes with the programme.', clashes }, 409)
  const line = v.speakersGiven ? composeSpeakerLine(v.people, v.others, v.typedTitle)
    : { speaker_name: String(b.speaker_name || '').trim() || null, speaker_title: String(b.speaker_title || '').trim() || null }
  const res = await c.env.DB.prepare(
    'INSERT INTO sessions (event_id, title, description, speaker_name, speaker_title, speaker_avatar, session_type, track, room, start_time, end_time, capacity) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(eventId, v.row.title, v.row.description, line.speaker_name, line.speaker_title, v.row.speaker_avatar, v.row.session_type, v.row.track, v.row.room, v.row.start_time, v.row.end_time, v.row.capacity).run()
  const id = Number(res.meta.last_row_id)
  await writeSessionExtras(c, id, v, r)
  await saveOwnerFrom(c, 'session', id, b, v.row.title)
  const talk = await syncLinkedTalk(c, eventId, { id, title: v.row.title, speaker_name: line.speaker_name, start_time: v.row.start_time, end_time: v.row.end_time, room: v.row.room })
  await audit(c, 'session.create', 'session', id, { title: v.row.title, start_time: v.row.start_time, room: v.row.room, status: v.status, speakers: v.people.map((p: any) => p.name), clashes_accepted: clashes.length })
  return c.json({ id, success: true, clashes, talk_synced: talk }, 201)
})

// Drag and drop: a session moved to another time or hall, or made longer or shorter.
// Only its time and hall change. The same clash rule as a full save: 409 with what it
// clashes with until the body says force. Answers with where it was, for Undo.
conf.post('/api/admin/sessions/:id/move', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json().catch(() => ({})) as any
  const before = await one(c, 'SELECT * FROM sessions WHERE id = ?', id)
  if (!before) return c.json({ error: 'That session is not on the programme any more. Reload the page.' }, 404)
  const start = cleanTime(b.start_time), end = cleanTime(b.end_time)
  if (!start || !end) return c.json({ error: 'Choose the day, the start time and the end time.' }, 400)
  if (end <= start) return c.json({ error: 'The session must end after it starts.' }, 400)
  if (start.slice(0, 10) !== end.slice(0, 10)) return c.json({ error: 'A session must start and end on the same day.' }, 400)
  const room = 'room' in b ? String(b.room || '').replace(/\s+/g, ' ').trim().slice(0, 100) : String(before.room || '')
  const eventId = Number(before.event_id) || 1
  const r = await adminReady(c)
  const v = { sessionId: id, people: null, row: { title: before.title, room, session_type: before.session_type, start_time: start, end_time: end } }
  const clashes = await clashesFor(c, eventId, v, r)
  if (clashes.length && !b.force) return c.json({ error: 'This slot clashes with the programme.', clashes }, 409)
  await c.env.DB.prepare('UPDATE sessions SET start_time = ?, end_time = ?, room = ? WHERE id = ?').bind(start, end, room, id).run()
  const talk = await syncLinkedTalk(c, eventId, { id, title: before.title, speaker_name: before.speaker_name, start_time: start, end_time: end, room })
  const was = { start_time: before.start_time, end_time: before.end_time, room: before.room || '' }
  await audit(c, 'session.move', 'session', id, { title: before.title, from: was, to: { start_time: start, end_time: end, room }, clashes_accepted: clashes.length })
  return c.json({ success: true, clashes, before: was, talk_synced: talk })
})

conf.put('/api/admin/sessions/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json().catch(() => ({})) as any
  const before = await one(c, 'SELECT * FROM sessions WHERE id = ?', id)
  if (!before) return c.json({ error: 'That session is not on the programme any more. Reload the page.' }, 404)
  const eventId = Number(before.event_id) || 1
  const r = await adminReady(c)
  const v: any = await validSession(c, b, eventId, id)
  if (v.error) return c.json({ error: v.error }, 400)
  if (v.status === 'draft' && !r.drafts) return needsMigration(c)
  const clashes = await clashesFor(c, eventId, v, r)
  if (clashes.length && !b.force) return c.json({ error: 'This slot clashes with the programme.', clashes }, 409)
  const line = v.speakersGiven ? composeSpeakerLine(v.people, v.others, v.typedTitle)
    : { speaker_name: 'speaker_name' in b ? (String(b.speaker_name || '').trim() || null) : before.speaker_name, speaker_title: 'speaker_title' in b ? (String(b.speaker_title || '').trim() || null) : before.speaker_title }
  const after = { title: v.row.title, description: v.row.description, speaker_name: line.speaker_name, speaker_title: line.speaker_title, speaker_avatar: 'speaker_avatar' in b ? v.row.speaker_avatar : before.speaker_avatar,
    session_type: v.row.session_type, track: v.row.track, room: v.row.room, start_time: v.row.start_time, end_time: v.row.end_time, capacity: v.row.capacity }
  await c.env.DB.prepare('UPDATE sessions SET ' + Object.keys(after).map(k => k + ' = ?').join(', ') + ' WHERE id = ?').bind(...Object.values(after), id).run()
  await writeSessionExtras(c, id, v, r)
  await saveOwnerFrom(c, 'session', id, b, v.row.title)
  const talk = await syncLinkedTalk(c, eventId, { id, title: after.title, speaker_name: after.speaker_name, start_time: after.start_time, end_time: after.end_time, room: after.room })
  await audit(c, 'session.update', 'session', id, { title: v.row.title, status: v.status, changes: hooks.changedFields ? hooks.changedFields(before, after) : Object.keys(after), clashes_accepted: clashes.length })
  return c.json({ success: true, clashes, talk_synced: talk })
})

conf.delete('/api/admin/sessions/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const before = await one(c, 'SELECT title, start_time, room FROM sessions WHERE id = ?', id)
  const r = await adminReady(c)
  if (r.links) await c.env.DB.prepare('DELETE FROM session_speakers WHERE session_id = ?').bind(id).run()
  if (r.drafts) await c.env.DB.prepare('DELETE FROM session_admin WHERE session_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run()
  await clearOwner(c.env.DB, 'session', id)
  await audit(c, 'session.delete', 'session', id, before || {})
  return c.json({ success: true })
})

// ---------- announcing a speaker ----------

conf.post('/api/admin/speakers/:id/announce', async (c) => {
  const id = Number(c.req.param('id'))
  const sp = await one(c, 'SELECT id, event_id, name FROM speakers WHERE id = ?', id)
  if (!sp) return c.json({ error: 'That speaker is not on the list any more.' }, 404)
  const b = await c.req.json().catch(() => ({})) as any
  const title = String(b.title || '').replace(/\s+/g, ' ').trim().slice(0, 160)
  const content = String(b.content || '').trim().slice(0, 4000)
  if (!title || !content) return c.json({ error: 'Write the headline and the message.' }, 400)
  const sessionId = Number(b.session_id) || null
  const res = await c.env.DB.prepare('INSERT INTO announcements (event_id, title, content, announcement_type, author_name, pinned) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(sp.event_id, title, content, 'general', 'Bharat AI Innovation', b.pinned ? 1 : 0).run()
  const annId = Number(res.meta.last_row_id)
  const r = await adminReady(c)
  if (r.log) {
    await c.env.DB.prepare('INSERT INTO speaker_announcements (event_id, speaker_id, session_id, announcement_id, emailed, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(sp.event_id, id, sessionId, annId, b.email_it ? 1 : 0, hooks.actor ? hooks.actor(c) : null).run()
  }
  await audit(c, 'speaker.announce', 'speaker', id, { name: sp.name, announcement_id: annId, pinned: !!b.pinned, email_it: !!b.email_it })
  return c.json({ success: true, announcement_id: annId, logged: r.log }, 201)
})

// Announcing a whole panel (13 Nov 2026, organiser: "announce panel discussion speakers
// as well with details of their co-panellists along with time slot, hall, date"). One
// post in the app's announcements; every speaker shown on the session is then recorded
// as announced, so their cards say so. The words come from the screen and may be
// changed there; a draft is refused, since attendees cannot see it yet.
conf.post('/api/admin/sessions/:id/announce', async (c) => {
  const id = Number(c.req.param('id'))
  const s = await one(c, 'SELECT id, event_id, title, speaker_name, session_type FROM sessions WHERE id = ?', id)
  if (!s) return c.json({ error: 'That session is not on the programme any more.' }, 404)
  const r = await adminReady(c)
  if (r.drafts && await one(c, "SELECT 1 AS d FROM session_admin WHERE session_id = ? AND status = 'draft'", id))
    return c.json({ error: 'This session is a draft, so attendees cannot see it. Untick "Keep as a draft" and save it first.' }, 409)
  const b = await c.req.json().catch(() => ({})) as any
  const title = String(b.title || '').replace(/\s+/g, ' ').trim().slice(0, 160)
  const content = String(b.content || '').replace(/\r\n/g, '\n').trim().slice(0, 4000)
  if (!title || !content) return c.json({ error: 'Write the headline and the message.' }, 400)
  const speakers = await all(c, 'SELECT id, name, is_published FROM speakers WHERE event_id = ?', s.event_id)
  const saved = r.links ? await all(c, 'SELECT speaker_id FROM session_speakers WHERE session_id = ? ORDER BY sort_order, id', id) : []
  const links = saved.length ? saved : deriveLinks(s.speaker_name, speakers, s.session_type).links
  const shown = new Map(speakers.filter((x: any) => Number(x.is_published) !== 0).map((x: any) => [Number(x.id), x]))
  const people = [...new Set(links.map((l: any) => Number(l.speaker_id)))].filter(sid => shown.has(sid))
  const res = await c.env.DB.prepare('INSERT INTO announcements (event_id, title, content, announcement_type, author_name, pinned) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(s.event_id, title, content, 'general', 'Bharat AI Innovation', b.pinned ? 1 : 0).run()
  const annId = Number(res.meta.last_row_id)
  if (r.log) {
    for (const sid of people) {
      await c.env.DB.prepare('INSERT INTO speaker_announcements (event_id, speaker_id, session_id, announcement_id, emailed, created_by) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(s.event_id, sid, id, annId, b.email_it ? 1 : 0, hooks.actor ? hooks.actor(c) : null).run()
    }
  }
  await audit(c, 'session.announce', 'session', id, { title: s.title, announcement_id: annId, speakers: people.map(sid => shown.get(sid).name), pinned: !!b.pinned, email_it: !!b.email_it })
  return c.json({ success: true, announcement_id: annId, speakers: people.length, logged: r.log }, 201)
})

// ---------- telling a speaker their slot ----------

const escH = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export function dayLabel(t: string): string {
  const d = new Date(String(t).slice(0, 10) + 'T00:00:00Z')
  return isNaN(d.getTime()) ? '' : DAY_NAMES[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()]
}
export function clock(t: string): string {
  const m = String(t || '').match(/(\d{2}):(\d{2})$/)
  if (!m) return ''
  const h = Number(m[1]), mm = m[2]
  return (h % 12 || 12) + ':' + mm + (h < 12 ? ' am' : ' pm')
}
export const ROLE_WORD: Record<string, string> = { keynote: 'Keynote speaker', speaker: 'Speaker', panellist: 'Panellist', moderator: 'Moderator', host: 'Host', chair: 'Chair' }

export async function slotsOfSpeaker(c: any, sp: any) {
  const r = await adminReady(c)
  const speakers = await all(c, 'SELECT id, name FROM speakers WHERE event_id = ?', sp.event_id)
  const sessions = (await sessionsWithSpeakers(c, Number(sp.event_id), speakers, r))
  const halls = await hallsFor(c, Number(sp.event_id), r.halls)
  const hallBy = new Map(halls.map((h: any) => [h.name, h]))
  return sessions.filter((s: any) => s.links.some((l: any) => l.speaker_id === Number(sp.id)))
    .map((s: any) => ({ ...s, my_role: s.links.find((l: any) => l.speaker_id === Number(sp.id))?.role || 'speaker', hall: hallBy.get(s.room) || null }))
}

export function slotEmailHTML(sp: any, slots: any[], note: string, header: string, words: { name: string; line: string } = MUMBAI_WORDS): { subject: string; html: string } {
  const first = slots[0]
  const subject = slots.length === 1
    ? 'Your session at ' + words.name + ': ' + dayLabel(first.start_time) + ', ' + clock(first.start_time) + ', ' + (first.room || 'hall to be confirmed')
    : 'Your ' + slots.length + ' sessions at ' + words.name
  const card = (s: any) => {
    const where = hallLabel(s.room, s.hall?.venue_room)
    return `<div style="border:1px solid #e7e9f5;border-radius:12px;padding:16px 18px;margin:0 0 12px;background:#fbfcff">
      <div style="font-size:12px;font-weight:bold;color:#C84F00;text-transform:uppercase;letter-spacing:0.4px">${escH(ROLE_WORD[s.my_role] || 'Speaker')}</div>
      <div style="font-size:17px;font-weight:bold;margin:4px 0 10px;color:#1e2140">${escH(s.title)}</div>
      <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.6;color:#1e2140">
        <tr><td style="color:#6b7280;padding-right:14px">When</td><td><strong>${escH(dayLabel(s.start_time))}</strong>, ${escH(clock(s.start_time))} to ${escH(clock(s.end_time))}</td></tr>
        <tr><td style="color:#6b7280;padding-right:14px">Where</td><td><strong>${escH(where || 'Hall to be confirmed')}</strong></td></tr>
        ${s.hall?.location ? `<tr><td style="color:#6b7280;padding-right:14px">Finding it</td><td>${escH(s.hall.location)}</td></tr>` : ''}
      </table></div>`
  }
  const first_name = escH(String(sp.name || '').replace(/^(hon[’']?ble|shri\.?|smt\.?|dr\.?|mr\.?|ms\.?|mrs\.?|prof\.?)\s+/gi, '').split(/\s+/)[0] || 'there')
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f6f7fb;padding:24px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1e2140">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e7e9f5">
    ${header}
    <div style="padding:26px 26px 8px">
      <p style="font-size:15px;line-height:1.65;margin:0 0 14px">Dear ${first_name},</p>
      <p style="font-size:15px;line-height:1.65;margin:0 0 18px">Thank you for speaking at ${escH(words.name)}. Here ${slots.length === 1 ? 'is your session' : 'are your sessions'}.</p>
      ${slots.map(card).join('')}
      ${note ? `<p style="font-size:15px;line-height:1.65;margin:16px 0 0;white-space:pre-wrap">${escH(note)}</p>` : ''}
      <p style="font-size:15px;line-height:1.65;margin:16px 0 0">If anything here is wrong, reply to this email and we will fix it.</p>
      <p style="margin:22px 0 24px;font-size:14px;color:#555">Team Bharat AI Innovation<br>
        <span style="color:#888">${escH(words.line).replace(' · ', ' &middot; ')}</span></p>
    </div>
  </div></body></html>`
  return { subject, html }
}

conf.post('/api/admin/speakers/:id/slot-email', async (c) => {
  const id = Number(c.req.param('id'))
  const sp = await one(c, 'SELECT id, event_id, name, email FROM speakers WHERE id = ?', id)
  if (!sp) return c.json({ error: 'That speaker is not on the list any more.' }, 404)
  const b = await c.req.json().catch(() => ({})) as any
  const slots = await slotsOfSpeaker(c, sp)
  if (!slots.length) return c.json({ error: sp.name + ' is not on the programme yet. Give them a session first.' }, 409)
  const note = String(b.note == null ? '' : b.note).trim().slice(0, 1500)
  const words = wordsFor(await one(c, 'SELECT id, title, venue, start_date, end_date FROM events WHERE id = ?', Number(sp.event_id) || 1))
  const header = hooks.emailHeader ? hooks.emailHeader('Your session', words.line) : ''
  const mail = slotEmailHTML(sp, slots, note, header, words)
  if (b.preview) return c.json({ to: sp.email || '', subject: mail.subject, html: mail.html, slots: slots.length })
  if (!sp.email) return c.json({ error: 'There is no email address for ' + sp.name + '. Add it on their page first.' }, 409)
  if (!hooks.sendEmail) return c.json({ error: 'Email is not set up on this server.' }, 503)
  const sent = await hooks.sendEmail(c, sp.email, mail.subject, mail.html)
  if (!sent.ok) return c.json({ error: sent.error || 'The email did not go.' }, 502)
  await audit(c, 'speaker.slot_email', 'speaker', id, { name: sp.name, to: sp.email, sessions: slots.map((s: any) => s.id) })
  return c.json({ success: true, to: sp.email })
})

// ---------- for the attendee app (index.tsx reads these) ----------

// Each session's hall as the venue names it, for the schedule's own query: from the
// halls table once 0054 has run, else filled in from DEFAULT_HALLS (fillVenues).
export async function venueSelectSql(c: any): Promise<string> {
  try { return (await hasTable(c, 'conference_halls')) ? ', (SELECT h.venue_room FROM conference_halls h WHERE h.event_id = sessions.event_id AND h.name = sessions.room) AS venue_room' : '' }
  catch { return '' }
}
export function fillVenues(rows: any[]): any[] {
  const by = new Map(DEFAULT_HALLS.map(h => [h.name, h.venue_room]))
  for (const r of rows || []) if (r && !r.venue_room && r.room && by.has(r.room)) r.venue_room = by.get(r.room)
  return rows
}

// The clause that keeps sessions saved as drafts from attendees, for the schedule's
// own query (no extra round trip); '' until 0054 has run.
export async function draftFilterSql(c: any): Promise<string> {
  try { return (await hasTable(c, 'session_admin')) ? " AND id NOT IN (SELECT session_id FROM session_admin WHERE status = 'draft')" : '' }
  catch { return '' }
}

// When and where each listed speaker speaks: published sessions only, with the hall's
// venue room and directions. Keyed by speaker id.
export async function speakerSlots(c: any, eventId: number, speakers: { id: number; name: string }[]) {
  const out = new Map<number, any[]>()
  try {
    const r = await conferenceReady(c)
    const [withSpeakers, halls] = await Promise.all([sessionsWithSpeakers(c, eventId, speakers, r), hallsFor(c, eventId, r.halls)])
    const sessions = withSpeakers.filter((s: any) => s.status !== 'draft')
    const hallBy = new Map(halls.map((h: any) => [h.name, h]))
    for (const s of sessions) {
      for (const l of s.links) {
        if (!out.has(l.speaker_id)) out.set(l.speaker_id, [])
        const h: any = hallBy.get(s.room)
        out.get(l.speaker_id)!.push({ id: s.id, title: s.title, session_type: s.session_type, room: s.room || '', start_time: s.start_time, end_time: s.end_time,
          role: l.role, venue_room: h?.venue_room || '', location: h?.location || '' })
      }
    }
  } catch { /* the speakers list never fails over its slots */ }
  return out
}

export default conf
