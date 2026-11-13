import { Hono } from 'hono'
import { adminReady, conferenceReady, sessionsWithSpeakers, hallsFor, wordsFor, hallLabel, dayLabel, clock, ROLE_WORD, splitSpeakerLine, normName, draftFilterSql } from './conference'

// ==================== SPEAKER BRIEFS (12 Nov 2026) ====================
//
// The organiser: "send speakers their speaker badge, schedule of their time slot, if
// panellist time slot and other panellists in their panel ... give option on dashboard
// with option to preview email". One email per speaker, the "brief":
//   - each of their sessions: role, title, day and time, the hall by both names
//     (event name and the venue's room) and how to find it, add-to-calendar links;
//   - on a panel: the moderator and the other panellists, by name and organisation
//     only (never anyone's email or mobile);
//   - a button that signs them into the app at their pass (the QR the badge desk
//     scans). The pass is the attendee row under their email, made or raised to
//     Speaker by the same issueSpeakerPass Admin -> Conference uses.
// Admin -> Conference shows "Speaker briefs" (the list) and "Brief" on each speaker
// card once public/static/speaker-brief.js is on the page.
//
// What was sent is kept in admin_audit (action 'speaker.brief', entity 'speaker'),
// with a fingerprint of the slots as sent, so the list can say "changed since sent"
// when a time, hall, title, role or panel moves. No migration: the table exists.
//
// Ministers (Hon'ble, or a role naming a minister) are left out of "select all":
// their offices handle protocol. The list offers the same details as plain text to
// paste into WhatsApp, without the pass link (that link signs in).
//
// Every /api/admin/* route here is behind the admin middleware in index.tsx.
// GET /api/sessions/:id/calendar.ics is public: a published session's own details.

type Hooks = {
  sendEmail?: (c: any, to: string, subject: string, html: string) => Promise<{ ok: boolean; error?: string }>
  audit?: (c: any, action: string, entity?: string, entityId?: any, detail?: any) => Promise<void>
  emailHeader?: (title: string, subtitle: string) => string
  issueSpeakerPass?: (c: any, x: { eventId: number; name: string; email: string; mobile: string; company: string; designation: string; linkedin: string; avatarUrl: string }) =>
    Promise<{ attendeeId: number; pass: string; created: boolean; raised: boolean; kept: boolean } | { error: string }>
  // The app link that signs them in and opens their pass (index.tsx mints the token).
  passLink?: (c: any, eventId: number, email: string) => Promise<string>
}
let hooks: Hooks = {}
export function configureSpeakerBrief(h: Hooks) { hooks = { ...hooks, ...h } }

const brief = new Hono<{ Bindings: any }>()
const SITE = 'https://bharataiinnovation.com'
export const NOTE_KEY = 'speaker_brief_note'
export const AUDIT_ACTION = 'speaker.brief'

const all = async (c: any, sql: string, ...args: any[]) => (((await c.env.DB.prepare(sql).bind(...args).all()) as any).results || []) as any[]
const one = async (c: any, sql: string, ...args: any[]) => (await c.env.DB.prepare(sql).bind(...args).first()) as any
const escH = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ---------- pure helpers (scripts/verify/unit-speaker-brief.mjs tests each) ----------

// Ministers' offices handle their protocol: no email from the list for them.
export function isProtocol(sp: { name?: any; role?: any }): boolean {
  return /^\s*hon[’']?ble\b/i.test(String(sp?.name || '')) || /\bminister\b/i.test(String(sp?.role || ''))
}

// A hall in a sentence: "Homi J. Bhabha Hall (Peacock Hall)" (the both-names rule).
export function hallSentence(room: any, venue: any): string {
  const r = String(room || '').trim(), v = String(venue || '').trim()
  if (!r) return v
  return v && normName(v) !== normName(r) ? `${r} (${v})` : r
}

// Everyone else on the session, from the saved/derived links (their profile's
// organisation) and the people typed by hand, without the speaker the brief is for.
export function peopleOf(s: { links?: any[]; others?: any; speaker_name?: any; session_type?: any }, meId: number, speakersById: Map<number, any>):
    { moderators: { name: string; org: string }[]; others: { name: string; org: string }[] } {
  const moderators: { name: string; org: string }[] = [], others: { name: string; org: string }[] = []
  const seen = new Set<string>()
  const me = speakersById.get(Number(meId))
  if (me) seen.add(normName(me.name))
  const put = (name: string, org: string, role: string) => {
    const k = normName(name)
    if (!k || seen.has(k)) return
    seen.add(k)
    ;(role === 'moderator' ? moderators : others).push({ name: name.trim(), org: String(org || '').trim() })
  }
  for (const l of s.links || []) {
    if (Number(l.speaker_id) === Number(meId)) continue
    const sp = speakersById.get(Number(l.speaker_id))
    if (sp) put(String(sp.name || ''), String(sp.organisation || ''), String(l.role || ''))
  }
  for (const p of splitSpeakerLine(s.others || '')) put(p.name, p.role ? '' : p.info, p.role)
  return { moderators, others }
}

// A session for the brief: what the speaker needs, nothing internal (no notes).
export function slotOf(s: any, meId: number, speakersById: Map<number, any>, hall: any) {
  const link = (s.links || []).find((l: any) => Number(l.speaker_id) === Number(meId))
  const people = peopleOf(s, meId, speakersById)
  return {
    id: Number(s.id), title: String(s.title || ''), session_type: String(s.session_type || ''), track: String(s.track || ''),
    start_time: String(s.start_time || ''), end_time: String(s.end_time || ''), room: String(s.room || ''),
    venue_room: String(hall?.venue_room || ''), location: String(hall?.location || ''),
    my_role: String(link?.role || 'speaker'), moderators: people.moderators, others: people.others,
  }
}

// Changes when anything the speaker was told changes: time, hall, title, role, panel.
export function briefFingerprint(slots: any[]): string {
  const key = JSON.stringify(slots.map(s => [s.id, s.title, s.start_time, s.end_time, s.room, s.venue_room, s.my_role,
    [...s.moderators, ...s.others].map((p: any) => normName(p.name)).sort()]).sort((a: any, b: any) => (String(a[2]) < String(b[2]) ? -1 : 1)))
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0')
}

export type BriefStatus = 'no-session' | 'no-email' | 'protocol' | 'ready' | 'sent' | 'changed'
export function briefStatus(x: { slots: any[]; email: any; protocol: boolean; last: { fp?: string } | null; fp: string }): BriefStatus {
  if (!x.slots.length) return 'no-session'
  if (x.protocol) return 'protocol'
  if (!String(x.email || '').trim()) return 'no-email'
  if (!x.last) return 'ready'
  return x.last.fp === x.fp ? 'sent' : 'changed'
}

// "2026-11-21 15:15" (IST wall clock, as sessions keep it) -> "20261121T094500Z".
export function utcStamp(t: any): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(t || ''))
  if (!m) return ''
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) - 330 * 60000
  return new Date(ms).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'
}

const whereLine = (s: any, words: { venue: string }) => [hallSentence(s.room, s.venue_room), s.location, words.venue].filter(Boolean).join(', ')

export function googleCalendarUrl(s: any, words: { name: string; venue: string }): string {
  const a = utcStamp(s.start_time), b = utcStamp(s.end_time) || a
  const q = new URLSearchParams({ action: 'TEMPLATE', text: `${s.title} (${words.name})`, dates: `${a}/${b}`,
    details: `${ROLE_WORD[s.my_role] || 'Speaker'} at ${words.name}.`, location: whereLine(s, words) })
  return 'https://calendar.google.com/calendar/render?' + q.toString()
}

// One published session as a calendar file (Outlook, Apple Calendar).
export function icsText(s: any, words: { name: string; venue: string }, nowIso = new Date().toISOString()): string {
  const clean = (t: any) => String(t || '').replace(/\\/g, '\\\\').replace(/[;,]/g, (m) => '\\' + m).replace(/\r?\n/g, ' ').trim()
  const st = utcStamp(s.start_time), en = utcStamp(s.end_time) || st
  const now = nowIso.replace(/[-:]/g, '').slice(0, 15) + 'Z'
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Bharat AI Innovation//Speaker brief//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:session-${s.id}@bharataiinnovation.com`, `DTSTAMP:${now}`, `DTSTART:${st}`, `DTEND:${en}`,
    `SUMMARY:${clean(s.title + ' (' + words.name + ')')}`, `LOCATION:${clean(whereLine(s, words))}`,
    `DESCRIPTION:${clean((s.track ? s.track + '. ' : '') + words.name + '.')}`, `URL:${SITE}/conference#schedule`,
    'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n')
}

const firstName = (name: any) => String(name || '').replace(/^(hon[’']?ble|shri\.?|smt\.?|dr\.?|mr\.?|ms\.?|mrs\.?|prof\.?)\s+/gi, '').split(/\s+/)[0] || 'there'
const who = (p: { name: string; org: string }) => p.org ? `${p.name} (${p.org})` : p.name
const whenLine = (s: any) => `${dayLabel(s.start_time)}, ${clock(s.start_time)} to ${clock(s.end_time)}`

export function briefSubject(slots: any[], words: { name: string }, update: boolean): string {
  const s = slots[0]
  const base = slots.length === 1
    ? `Your session at ${words.name}: ${dayLabel(s.start_time)}, ${clock(s.start_time)}, ${hallSentence(s.room, s.venue_room) || 'hall to be confirmed'}`
    : `Your ${slots.length} sessions at ${words.name}`
  return (update ? 'Updated: ' : '') + base
}

// The usual greeting and opening. The organiser may change both, and the subject,
// for one email after seeing the preview; the sessions, hall, panel, calendar
// links and pass button are always filled in from the programme.
export function briefGreeting(sp: any): string { return `Dear ${firstName(sp && sp.name)},` }
export function briefOpening(slots: any[], words: { name: string }, update: boolean): string {
  const one = slots.length === 1
  return update
    ? `Your session details have changed. Here ${one ? 'is your session' : 'are your sessions'} as ${one ? 'it stands' : 'they stand'} now; please use these and not the earlier email.`
    : `Thank you for speaking at ${words.name}. Here is everything for your day: ${one ? 'your session' : 'your sessions'} and your pass.`
}
// What an organiser typed: a subject is one line (no line breaks can reach the mail
// header); a greeting is one line; an opening keeps its line breaks.
export function cleanLine(v: any, max: number): string { return String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max) }
export function cleanBlock(v: any, max: number): string { return String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max) }

// The email. passHref '' leaves the pass block out (no address to sign in with);
// '#preview' is what a preview carries, so a preview never mints a sign-in link.
// subject / greeting / opening: the organiser's words for this one email ('' = the usual).
export function briefEmailHTML(a: { sp: any; slots: any[]; note: string; header: string; words: { name: string; venue: string; line: string };
    update: boolean; passHref: string; passName: string; subject?: string; greeting?: string; opening?: string }): { subject: string; html: string } {
  const { sp, slots, words } = a
  const greeting = cleanLine(a.greeting, 120) || briefGreeting(sp)
  const opening = cleanBlock(a.opening, 1500) || briefOpening(slots, words, a.update)
  const subject = cleanLine(a.subject, 200) || briefSubject(slots, words, a.update)
  const row = (k: string, v: string) => `<tr><td style="color:#6b7280;padding:2px 14px 2px 0;vertical-align:top;white-space:nowrap">${k}</td><td style="padding:2px 0">${v}</td></tr>`
  const card = (s: any) => {
    const ics = `${SITE}/api/sessions/${s.id}/calendar.ics`
    return `<div style="border:1px solid #e7e9f5;border-radius:12px;padding:16px 18px;margin:0 0 12px;background:#fbfcff">
      <div style="font-size:12px;font-weight:bold;color:#C84F00;text-transform:uppercase;letter-spacing:0.4px">${escH(ROLE_WORD[s.my_role] || 'Speaker')}</div>
      <div style="font-size:17px;font-weight:bold;margin:4px 0 10px;color:#1e2140">${escH(s.title)}</div>
      <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.6;color:#1e2140">
        ${row('When', `<strong>${escH(whenLine(s))}</strong>`)}
        ${row('Where', `<strong>${escH(hallLabel(s.room, s.venue_room) || 'Hall to be confirmed')}</strong>`)}
        ${s.location ? row('Finding it', escH(s.location + ', ' + words.venue)) : ''}
        ${s.moderators.length ? row('Moderator', escH(s.moderators.map(who).join(', '))) : ''}
        ${s.others.length ? row(s.session_type === 'panel' ? 'On the panel' : 'With you', s.others.map((p: any) => escH(who(p))).join('<br>')) : ''}
      </table>
      <div style="margin-top:10px;font-size:13px">Add to your calendar: <a href="${escH(googleCalendarUrl(s, words))}" style="color:#C84F00;font-weight:bold">Google</a>
        &middot; <a href="${escH(ics)}" style="color:#C84F00;font-weight:bold">Outlook or Apple</a></div>
    </div>`
  }
  const pass = a.passHref ? `<div style="border:1px solid #f3d9c6;border-radius:12px;padding:16px 18px;margin:6px 0 12px;background:#fff8f3">
      <div style="font-size:15px;font-weight:bold;color:#1e2140;margin:0 0 6px">Your ${escH(a.passName || 'Speaker')} pass</div>
      <p style="font-size:14px;line-height:1.6;margin:0 0 12px">It is in the event app. At the venue, show its QR code at the badge desk to collect your printed badge.</p>
      <a href="${escH(a.passHref)}" style="display:inline-block;padding:12px 24px;background:#C84F00;color:#fff;text-decoration:none;border-radius:10px;font-weight:bold;font-size:14px">Show my ${escH(a.passName || 'Speaker')} pass</a>
      <p style="font-size:12px;color:#6b7280;margin:10px 0 0">The button signs you in. It works for 7 days; after that, sign in at the app with this email address.</p>
    </div>` : ''
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f6f7fb;padding:24px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1e2140">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e7e9f5">
    ${a.header}
    <div style="padding:26px 26px 8px">
      <p style="font-size:15px;line-height:1.65;margin:0 0 14px">${escH(greeting)}</p>
      <p style="font-size:15px;line-height:1.65;margin:0 0 18px;white-space:pre-wrap">${escH(opening)}</p>
      ${slots.map(card).join('')}
      ${pass}
      ${a.note ? `<p style="font-size:15px;line-height:1.65;margin:16px 0 0;white-space:pre-wrap">${escH(a.note)}</p>` : ''}
      <p style="font-size:15px;line-height:1.65;margin:16px 0 0">If anything here is wrong, reply to this email and we will fix it.</p>
      <p style="margin:22px 0 24px;font-size:14px;color:#555">Team Bharat AI Innovation<br>
        <span style="color:#888">${escH(words.line).replace(' · ', ' &middot; ')}</span></p>
    </div>
  </div></body></html>`
  return { subject, html }
}

// The same details as plain text, for WhatsApp or a minister's office. No pass link:
// that link signs in, so it never leaves in a message meant to be forwarded.
export function briefText(sp: any, slots: any[], note: string, words: { name: string; venue: string }): string {
  const lines = [`*${words.name}*`, `Speaker details for ${String(sp.name || '').trim()}`, '']
  for (const s of slots) {
    lines.push(`*${s.title}*`, `Role: ${ROLE_WORD[s.my_role] || 'Speaker'}`, `When: ${whenLine(s)}`, `Where: ${whereLine(s, words) || 'Hall to be confirmed'}`)
    if (s.moderators.length) lines.push(`Moderator: ${s.moderators.map(who).join(', ')}`)
    if (s.others.length) lines.push(`${s.session_type === 'panel' ? 'On the panel' : 'With'}: ${s.others.map(who).join(', ')}`)
    lines.push('')
  }
  if (note) lines.push(note, '')
  lines.push('Team Bharat AI Innovation')
  return lines.join('\n')
}

// ---------- reading what a brief needs ----------

async function eventOf(c: any, eventId: number) {
  return await one(c, 'SELECT id, title, venue, start_date, end_date FROM events WHERE id = ?', eventId)
}

// Every speaker's published slots, built the way Admin -> Conference reads them.
async function speakersWithSlots(c: any, eventId: number, onlyId: number | null = null) {
  const r = await adminReady(c)
  const speakers = await all(c, 'SELECT id, event_id, slug, name, role, organisation, photo_url, email, phone, linkedin_url, is_published FROM speakers WHERE event_id = ? ORDER BY sort_order, id', eventId)
  const [sessions, halls] = await Promise.all([sessionsWithSpeakers(c, eventId, speakers, r), hallsFor(c, eventId, r.halls)])
  const live = sessions.filter((s: any) => s.status !== 'draft')
  const hallBy = new Map(halls.map((h: any) => [h.name, h]))
  const byId = new Map(speakers.map((s: any) => [Number(s.id), s]))
  const out: any[] = []
  for (const sp of speakers) {
    if (onlyId != null && Number(sp.id) !== onlyId) continue
    const mine = live.filter((s: any) => (s.links || []).some((l: any) => Number(l.speaker_id) === Number(sp.id)))
    const slots = mine.map((s: any) => slotOf(s, Number(sp.id), byId, hallBy.get(s.room))).sort((a: any, b: any) => (a.start_time < b.start_time ? -1 : 1))
    out.push({ sp, slots, drafts: sessions.length - live.length })
  }
  return out
}

// The last brief each speaker was sent (and the older single slot email, for the record).
async function lastSent(c: any, ids: number[]): Promise<Map<number, any>> {
  const out = new Map<number, any>()
  if (!ids.length) return out
  try {
    const rows = await all(c, `SELECT entity_id, action, detail, actor, created_at FROM admin_audit WHERE entity = 'speaker' AND action IN ('${AUDIT_ACTION}', 'speaker.slot_email') ORDER BY id`)
    const want = new Set(ids.map(String))
    for (const x of rows) {
      if (!want.has(String(x.entity_id))) continue
      let d: any = {}
      try { d = JSON.parse(x.detail || '{}') } catch { /* not JSON */ }
      const id = Number(x.entity_id)
      const was = out.get(id) || {}
      if (x.action === AUDIT_ACTION) out.set(id, { ...was, at: x.created_at, by: x.actor, fp: d.fp || '', kind: d.kind || 'first', to: d.to || '', n: (was.n || 0) + 1 })
      else out.set(id, { ...was, slot_email_at: x.created_at })
    }
  } catch { /* no audit table: nothing sent as far as anyone can tell */ }
  for (const [k, v] of out) if (!v.at) out.set(k, { ...v, fp: undefined, none: true })
  return out
}

async function passesOf(c: any, eventId: number): Promise<Map<string, any>> {
  const out = new Map<string, any>()
  try {
    const rows = await all(c, `SELECT a.id, lower(trim(a.email)) AS email, a.badge_type, a.payment_status FROM attendees a
      WHERE a.event_id = ? AND lower(trim(a.email)) IN (SELECT lower(trim(email)) FROM speakers WHERE event_id = ? AND trim(COALESCE(email, '')) <> '') ORDER BY a.id`, eventId, eventId)
    for (const r of rows) if (!out.has(r.email)) out.set(r.email, { attendee_id: Number(r.id), badge_type: r.badge_type || '' })
  } catch { /* no attendees table in a bare world */ }
  return out
}

const lastOf = (m: Map<number, any>, id: number) => { const v = m.get(id); return v && !v.none ? v : null }

async function savedNote(c: any): Promise<string> {
  try { return String((await one(c, 'SELECT value FROM app_settings WHERE key = ?', NOTE_KEY))?.value || '') } catch { return '' }
}

// ---------- routes ----------

brief.get('/api/admin/events/:id/speaker-briefs', async (c) => {
  const eventId = Number(c.req.param('id')) || 1
  const list = await speakersWithSlots(c, eventId)
  const [sent, passes, note] = await Promise.all([lastSent(c, list.map(x => Number(x.sp.id))), passesOf(c, eventId), savedNote(c)])
  const speakers = list.map(({ sp, slots }) => {
    const fp = briefFingerprint(slots)
    const protocol = isProtocol(sp)
    const last = lastOf(sent, Number(sp.id))
    const email = String(sp.email || '').trim().toLowerCase()
    return {
      id: Number(sp.id), name: sp.name, role: sp.role || '', organisation: sp.organisation || '', photo_url: sp.photo_url || '', email,
      is_published: Number(sp.is_published ?? 1), protocol, fp,
      status: briefStatus({ slots, email, protocol, last, fp }),
      last, slot_email_at: sent.get(Number(sp.id))?.slot_email_at || null,
      pass: email ? (passes.get(email) || null) : null,
      slots: slots.map((s: any) => ({ id: s.id, title: s.title, session_type: s.session_type, start_time: s.start_time, end_time: s.end_time, room: s.room, venue_room: s.venue_room, my_role: s.my_role })),
    }
  })
  const counts: Record<string, number> = {}
  for (const s of speakers) counts[s.status] = (counts[s.status] || 0) + 1
  return c.json({ event_id: eventId, speakers, counts, note })
})

// The note every brief carries (arrival time, speaker lounge, slides, contact on the day).
brief.put('/api/admin/speaker-briefs/note', async (c) => {
  const b = await c.req.json().catch(() => ({})) as any
  const note = String(b.note == null ? '' : b.note).replace(/\r\n/g, '\n').trim().slice(0, 1500)
  await c.env.DB.prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP')
    .bind(NOTE_KEY, note).run()
  if (hooks.audit) { try { await hooks.audit(c, 'speaker.brief_note', 'setting', NOTE_KEY, { length: note.length }) } catch { /* never fails the save */ } }
  return c.json({ success: true, note })
})

// Preview ({ preview: true }) or send one speaker's brief. { anyway: true } is needed
// to email a minister (the list never does it for you).
brief.post('/api/admin/speakers/:id/brief', async (c) => {
  const id = Number(c.req.param('id'))
  const spRow = await one(c, 'SELECT id, event_id FROM speakers WHERE id = ?', id)
  if (!spRow) return c.json({ error: 'That speaker is not on the list any more.' }, 404)
  const eventId = Number(spRow.event_id) || 1
  if (eventId !== 1) return c.json({ error: 'Speaker briefs are for the Mumbai event for now.' }, 409)
  const b = await c.req.json().catch(() => ({})) as any
  const [mine] = await speakersWithSlots(c, eventId, id)
  if (!mine) return c.json({ error: 'That speaker is not on the list any more.' }, 404)
  const { sp, slots } = mine
  if (!slots.length) return c.json({ error: sp.name + ' has no published session yet. Give them a session first.' }, 409)
  const note = b.note == null ? await savedNote(c) : String(b.note).replace(/\r\n/g, '\n').trim().slice(0, 1500)
  const words = wordsFor(await eventOf(c, eventId))
  const fp = briefFingerprint(slots)
  const last = lastOf(await lastSent(c, [id]), id)
  const update = b.update == null ? !!(last && last.fp !== fp) : !!b.update
  const email = String(sp.email || '').trim().toLowerCase()
  const passes = await passesOf(c, eventId)
  const have = email ? passes.get(email) : null
  const passName = have && have.badge_type && !/visitor/i.test(have.badge_type) ? String(have.badge_type).replace(/\s*pass$/i, '') : 'Speaker'
  const header = hooks.emailHeader ? hooks.emailHeader(update ? 'Your session has changed' : 'Your speaker brief', words.line) : ''
  const text = briefText(sp, slots, note, words)
  const protocol = isProtocol(sp)
  // The organiser's own words for this one email (left out or blank = the usual).
  const usual = { subject: briefSubject(slots, words, update), greeting: briefGreeting(sp), opening: briefOpening(slots, words, update) }
  const own = { subject: cleanLine(b.subject, 200), greeting: cleanLine(b.greeting, 120), opening: cleanBlock(b.opening, 1500) }
  const edited = (Object.keys(usual) as (keyof typeof usual)[]).filter(k => own[k] && own[k] !== usual[k])
  const wording = { subject: edited.includes('subject') ? own.subject : '', greeting: edited.includes('greeting') ? own.greeting : '', opening: edited.includes('opening') ? own.opening : '' }

  if (b.preview) {
    const mail = briefEmailHTML({ sp, slots, note, header, words, update, passHref: email ? '#preview' : '', passName, ...wording })
    return c.json({ to: email, subject: mail.subject, html: mail.html, text, note, update, protocol, fp, name: sp.name, usual, edited,
      status: briefStatus({ slots, email, protocol, last, fp }), last,
      pass: have ? { badge_type: have.badge_type, will_change: /visitor/i.test(have.badge_type || '') } : (email ? { badge_type: null, will_create: true } : null) })
  }
  if (!email) return c.json({ error: 'There is no email address for ' + sp.name + '. Add it on their page first.' }, 409)
  if (protocol && !b.anyway) return c.json({ error: sp.name + ' is a minister: their office handles protocol. Copy the details for WhatsApp instead, or send anyway from their brief.' }, 409)
  if (!hooks.sendEmail) return c.json({ error: 'Email is not set up on this server.' }, 503)

  // Their pass first: the button must open something.
  let passInfo: any = null
  if (hooks.issueSpeakerPass) {
    const p = await hooks.issueSpeakerPass(c, { eventId, name: sp.name, email, mobile: String(sp.phone || ''), company: String(sp.organisation || ''),
      designation: String(sp.role || ''), linkedin: String(sp.linkedin_url || ''), avatarUrl: String(sp.photo_url || '') })
    if ('error' in p) return c.json({ error: 'Their pass could not be made: ' + p.error }, 409)
    passInfo = p
  }
  const sentName = passInfo && passInfo.kept ? String(passInfo.pass || '').replace(/\s*pass$/i, '') || 'Speaker' : 'Speaker'
  let href = ''
  if (hooks.passLink) { try { href = await hooks.passLink(c, eventId, email) } catch { href = '' } }
  const mail = briefEmailHTML({ sp, slots, note, header, words, update, passHref: href, passName: sentName, ...wording })
  const sent = await hooks.sendEmail(c, email, mail.subject, mail.html)
  if (!sent.ok) return c.json({ error: sent.error || 'The email did not go.' }, 502)
  if (hooks.audit) {
    try { await hooks.audit(c, AUDIT_ACTION, 'speaker', id, { name: sp.name, to: email, fp, kind: update ? 'update' : 'first', sessions: slots.map((s: any) => s.id), pass: passInfo ? passInfo.pass : null,
      edited, subject: mail.subject }) }
    catch { /* the audit log never fails a send */ }
  }
  return c.json({ success: true, to: email, kind: update ? 'update' : 'first', fp, pass: passInfo, subject: mail.subject, edited })
})

// A published session as a calendar file, for the brief's "Outlook or Apple" link.
brief.get('/api/sessions/:id/calendar.ics', async (c) => {
  const id = Number(c.req.param('id'))
  if (!id) return c.text('Not found', 404)
  const drafts = await draftFilterSql(c)
  const s = await one(c, `SELECT id, event_id, title, track, room, start_time, end_time FROM sessions WHERE id = ? AND event_id = 1${drafts}`, id)
  if (!s || !s.start_time) return c.text('Not found', 404)
  const r = await conferenceReady(c)
  const halls = await hallsFor(c, 1, r.halls)
  const h: any = halls.find((x: any) => x.name === s.room)
  const words = wordsFor(await eventOf(c, 1))
  const body = icsText({ ...s, venue_room: h?.venue_room || '', location: h?.location || '' }, words)
  return new Response(body, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="bharat-ai-session-${id}.ics"`, 'Cache-Control': 'public, max-age=300' } })
})

export default brief
