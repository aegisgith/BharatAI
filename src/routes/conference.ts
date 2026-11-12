import { Hono } from 'hono'

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
async function adminReady(c: any) { forgetNotYet(); return conferenceReady(c) }
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

async function hallsFor(c: any, eventId: number, isReady: boolean) {
  if (isReady) {
    return await all(c, 'SELECT id, name, short_name, venue_room, location, capacity, purpose, sort_order, is_active FROM conference_halls WHERE event_id = ? ORDER BY sort_order, id', eventId)
  }
  return DEFAULT_HALLS.map((h, i) => ({ id: null, capacity: null, is_active: 1, ...h, sort_order: h.sort_order || i + 1 }))
}

// Every session of the event with its speakers: the saved links where there are any,
// otherwise the ones its typed line names.
async function sessionsWithSpeakers(c: any, eventId: number, speakers: any[], r: { links: boolean; drafts: boolean }) {
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
  const [event, speakers, halls] = await Promise.all([
    one(c, 'SELECT id, title, venue, start_date, end_date FROM events WHERE id = ?', eventId),
    all(c, 'SELECT id, slug, name, role, organisation, topic, photo_url, bio, email, phone, linkedin_url, is_featured, is_published, sort_order, updated_at FROM speakers WHERE event_id = ? ORDER BY sort_order, id', eventId),
    hallsFor(c, eventId, r.halls),
  ])
  const sessions = await sessionsWithSpeakers(c, eventId, speakers, r)
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
  }))

  const byId = new Map(speakers.map((s: any) => [Number(s.id), s]))
  const clashes = findClashes(sessions.map((s: any) => ({
    id: s.id, title: s.title, room: s.room, session_type: s.session_type, start_time: s.start_time, end_time: s.end_time, status: s.status,
    speakers: s.links.map((l: any) => ({ id: l.speaker_id, name: byId.get(l.speaker_id)?.name || '' })),
  })))

  const days: string[] = []
  if (event?.start_date && event?.end_date) {
    const d = new Date(String(event.start_date).slice(0, 10) + 'T00:00:00Z'), end = new Date(String(event.end_date).slice(0, 10) + 'T00:00:00Z')
    for (let i = 0; i < 10 && d <= end; i++) { days.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1) }
  }
  for (const s of sessions) { const day = String(s.start_time || '').slice(0, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(day) && !days.includes(day)) days.push(day) }
  days.sort()

  return c.json({
    ready: r, migration: MIGRATION_FILE, command: MIGRATION_COMMAND,
    event, days, halls, speakers: outSpeakers, sessions, clashes,
    session_types: SESSION_TYPES, speaker_roles: SPEAKER_ROLES,
  })
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
  return c.json({ success: true, id, slug }, 201)
})

conf.put('/api/admin/speakers/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json().catch(() => ({})) as any
  const before = await one(c, 'SELECT * FROM speakers WHERE id = ?', id)
  if (!before) return c.json({ error: 'That speaker is not on the list any more. Reload the page.' }, 404)
  const { set, error } = speakerFields(b)
  if (error) return c.json({ error }, 400)
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
  const sessions = (await sessionsWithSpeakers(c, eventId, speakers, r)).filter((s: any) => Number(s.id) !== Number(v.sessionId))
  const byId = new Map(speakers.map((s: any) => [Number(s.id), s]))
  const mine = {
    id: -1, title: v.row.title, room: v.row.room, session_type: v.row.session_type, start_time: v.row.start_time, end_time: v.row.end_time,
    speakers: v.people.map((p: any) => ({ id: p.speaker_id, name: p.name })),
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
  await audit(c, 'session.create', 'session', id, { title: v.row.title, start_time: v.row.start_time, room: v.row.room, status: v.status, speakers: v.people.map((p: any) => p.name), clashes_accepted: clashes.length })
  return c.json({ id, success: true, clashes }, 201)
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
  await audit(c, 'session.update', 'session', id, { title: v.row.title, status: v.status, changes: hooks.changedFields ? hooks.changedFields(before, after) : Object.keys(after), clashes_accepted: clashes.length })
  return c.json({ success: true, clashes })
})

conf.delete('/api/admin/sessions/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const before = await one(c, 'SELECT title, start_time, room FROM sessions WHERE id = ?', id)
  const r = await adminReady(c)
  if (r.links) await c.env.DB.prepare('DELETE FROM session_speakers WHERE session_id = ?').bind(id).run()
  if (r.drafts) await c.env.DB.prepare('DELETE FROM session_admin WHERE session_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run()
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
const ROLE_WORD: Record<string, string> = { keynote: 'Keynote speaker', speaker: 'Speaker', panellist: 'Panellist', moderator: 'Moderator', host: 'Host', chair: 'Chair' }

async function slotsOfSpeaker(c: any, sp: any) {
  const r = await adminReady(c)
  const speakers = await all(c, 'SELECT id, name FROM speakers WHERE event_id = ?', sp.event_id)
  const sessions = (await sessionsWithSpeakers(c, Number(sp.event_id), speakers, r))
  const halls = await hallsFor(c, Number(sp.event_id), r.halls)
  const hallBy = new Map(halls.map((h: any) => [h.name, h]))
  return sessions.filter((s: any) => s.links.some((l: any) => l.speaker_id === Number(sp.id)))
    .map((s: any) => ({ ...s, my_role: s.links.find((l: any) => l.speaker_id === Number(sp.id))?.role || 'speaker', hall: hallBy.get(s.room) || null }))
}

export function slotEmailHTML(sp: any, slots: any[], note: string, header: string): { subject: string; html: string } {
  const first = slots[0]
  const subject = slots.length === 1
    ? 'Your session at Bharat AI Innovation 2026: ' + dayLabel(first.start_time) + ', ' + clock(first.start_time) + ', ' + (first.room || 'hall to be confirmed')
    : 'Your ' + slots.length + ' sessions at Bharat AI Innovation 2026'
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
      <p style="font-size:15px;line-height:1.65;margin:0 0 18px">Thank you for speaking at Bharat AI Innovation 2026. Here ${slots.length === 1 ? 'is your session' : 'are your sessions'}.</p>
      ${slots.map(card).join('')}
      ${note ? `<p style="font-size:15px;line-height:1.65;margin:16px 0 0;white-space:pre-wrap">${escH(note)}</p>` : ''}
      <p style="font-size:15px;line-height:1.65;margin:16px 0 0">If anything here is wrong, reply to this email and we will fix it.</p>
      <p style="margin:22px 0 24px;font-size:14px;color:#555">Team Bharat AI Innovation<br>
        <span style="color:#888">20-21 November 2026 &middot; World Trade Center, Mumbai</span></p>
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
  const header = hooks.emailHeader ? hooks.emailHeader('Your session', '20-21 November 2026 · World Trade Center, Mumbai') : ''
  const mail = slotEmailHTML(sp, slots, note, header)
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
