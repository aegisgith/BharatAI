import { Hono } from 'hono'
import { utcStamp, cleanLine, cleanBlock } from './speaker-brief'
import { MUMBAI_WORDS } from './conference'

// ==================== INNOVATION TALK BRIEFS (16 Nov 2026) ====================
//
// The organiser: speakers "will also need to be sent time slot hall etc". The
// conference's speakers and panellists have the speaker briefs (routes/speaker-brief.ts,
// from the sessions table). The Innovation Talk & Showcase speakers (exhibitors' stage
// talks, the innovation_talks table) had only the "a few details we need" email, which
// tells the time in passing. This is their brief: one email per talk with the day and
// time, the hall and where it is, how long the slot is, the topic as the programme has
// it, add-to-calendar links, a button to their pass when they hold one, and the
// organiser's note (where to report, slides, who to call). Previewed and sent from
// Admin -> Innovation Talks -> "Time & hall briefs".
//
// Who it goes to: the talk's own speaker email, else the person by that name on the
// company's team list, else the booth contact, who is asked to pass it on (the same
// order the "details we need" email uses, italkContactFor in index.tsx, passed in as a
// hook). Government officials are held back, as that email holds them (their offices
// handle protocol); { anyway: true } sends to one.
//
// What was sent is an admin_audit row (action 'innovation_talk.brief', entity
// 'innovation_talk') with a fingerprint of time, length, hall and topic, so the list can
// say "changed since sent" when the programme moves. No migration: the tables exist.
// Every /api/admin/* route here is behind the admin middleware in index.tsx.

type Contact = { email: string; source: string; note: string; protocol?: boolean }
type Hooks = {
  sendEmail?: (c: any, to: string, subject: string, html: string) => Promise<{ ok: boolean; error?: string }>
  audit?: (c: any, action: string, entity?: string, entityId?: any, detail?: any) => Promise<void>
  emailHeader?: (title: string, subtitle: string) => string
  // Who to write to for each talk, and whether they are a government official.
  contacts?: (c: any, eventId: number) => Promise<Record<string, Contact>>
  // "On the exhibition floor" for Aryabhata Theatre, and so on (ITALK_HALLS).
  hallWhere?: (hall: any) => string
  // The app link that signs them in at their pass (index.tsx mints the token).
  passLink?: (c: any, eventId: number, email: string) => Promise<string>
  // The speaker's own page for adding a topic or photo (routes/talk-self.ts).
  detailsLink?: (c: any, talkId: number) => Promise<string>
}
let hooks: Hooks = {}
export function configureTalkBrief(h: Hooks) { hooks = { ...hooks, ...h } }

const tb = new Hono<{ Bindings: any }>()
const SITE = 'https://bharataiinnovation.com'
export const NOTE_KEY = 'talk_brief_note'
export const AUDIT_ACTION = 'innovation_talk.brief'
const all = async (c: any, sql: string, ...args: any[]) => (((await c.env.DB.prepare(sql).bind(...args).all()) as any).results || []) as any[]
const one = async (c: any, sql: string, ...args: any[]) => (await c.env.DB.prepare(sql).bind(...args).first()) as any
const escH = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const STARTS_RE = /^(\d{4})-(\d{2})-(\d{2}) ([01]\d|2[0-3]):([0-5]\d)$/

// ---------- pure helpers (scripts/verify/smoke-talk-brief.mjs checks them) ----------

export function firstName(name: any): string {
  return String(name || '').replace(/^(hon[’']?ble|shri\.?|smt\.?|dr\.?|mr\.?|ms\.?|mrs\.?|prof\.?)\s+/gi, '').trim().split(/\s+/)[0] || 'there'
}
// The name after "Dear" (the organiser, 23 Nov 2026: "when someone is Dr. address them as
// Dear Dr. Rajkumar, not Rajkumar; all govt officials ... Shri before name").
// Dr. / Prof. stay with the first name: "Dr. Rajkumar". Hon'ble / Shri / Smt. take the full
// name: "Shri Sachin Itkar". Mr / Ms / Mrs are dropped, as before, and so is a trailing
// "(IAS)". Titles come only from the stored name: who is an official, and whether Shri or
// Smt., is never guessed here; the organiser puts it in the name in Admin.
export function dearName(name: any): string {
  let rest = String(name || '').replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+/g, ' ').trim()
  const kept: string[] = []
  let formal = false
  for (let m = /^(hon[’']?ble|shri|smt|dr|prof|mr|ms|mrs)\.?\s+/i.exec(rest); m; m = /^(hon[’']?ble|shri|smt|dr|prof|mr|ms|mrs)\.?\s+/i.exec(rest)) {
    const t = m[1].toLowerCase()
    if (/^hon/.test(t)) { kept.push(m[1]); formal = true }
    else if (t === 'shri') { kept.push('Shri'); formal = true }
    else if (t === 'smt') { kept.push('Smt.'); formal = true }
    else if (t === 'dr') kept.push('Dr.')
    else if (t === 'prof') kept.push('Prof.')
    rest = rest.slice(m[0].length)
  }
  if (!rest) return 'there'
  const first = rest.split(' ')[0]
  // "K.K. Singh": an initial is no name to greet someone by.
  const shown = formal || /^[A-Za-z]{1,2}\.|^[A-Za-z]$/.test(first) ? rest : first
  return [...kept, shown].join(' ')
}
export function timed(t: any): boolean { return STARTS_RE.test(String(t?.starts_at || '')) && Number(t?.duration_min) > 0 && !!String(t?.hall || '').trim() }
export function endOf(startsAt: string, minutes: number): string {
  const m = STARTS_RE.exec(String(startsAt || ''))
  if (!m) return ''
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]) + Math.max(0, Number(minutes) || 0)))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}
export function dayLabel(t: any): string {
  const m = STARTS_RE.exec(String(t || ''))
  if (!m) return ''
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' +
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]
}
export function clock(t: any): string {
  const m = STARTS_RE.exec(String(t || ''))
  if (!m) return ''
  const h = Number(m[4])
  return `${h % 12 || 12}:${m[5]} ${h < 12 ? 'am' : 'pm'}`
}
export const whenLine = (t: any) => `${dayLabel(t.starts_at)}, ${clock(t.starts_at)} to ${clock(endOf(t.starts_at, t.duration_min))}`
export const whereLine = (t: any) => [String(t.hall || '').trim(), hooks.hallWhere ? hooks.hallWhere(t.hall) : '', MUMBAI_WORDS.venue].filter(Boolean).join(', ')

// Changes when anything the speaker was told changes: time, length, hall, topic.
export function briefFingerprint(t: any): string {
  const key = JSON.stringify([String(t.starts_at || ''), Number(t.duration_min) || 0, String(t.hall || '').trim(), String(t.topic || '').trim()])
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0')
}

export type BriefStatus = 'no-time' | 'no-email' | 'protocol' | 'ready' | 'sent' | 'changed'
export function briefStatus(x: { timed: boolean; email: string; protocol: boolean; last: { fp?: string } | null; fp: string }): BriefStatus {
  if (!x.timed) return 'no-time'
  if (x.protocol) return 'protocol'
  if (!x.email) return 'no-email'
  if (!x.last) return 'ready'
  return x.last.fp === x.fp ? 'sent' : 'changed'
}

export function googleCalendarUrl(t: any): string {
  const a = utcStamp(t.starts_at), b = utcStamp(endOf(t.starts_at, t.duration_min)) || a
  const q = new URLSearchParams({ action: 'TEMPLATE', text: `Innovation Talk: ${String(t.topic || '').trim() || String(t.company || '').trim() || 'my talk'} (${MUMBAI_WORDS.name})`,
    dates: `${a}/${b}`, details: `Innovation Talk & Showcase at ${MUMBAI_WORDS.name}.`, location: whereLine(t) })
  return 'https://calendar.google.com/calendar/render?' + q.toString()
}
export function icsText(t: any, nowIso = new Date().toISOString()): string {
  const clean = (v: any) => String(v || '').replace(/\\/g, '\\\\').replace(/[;,]/g, (m) => '\\' + m).replace(/\r?\n/g, ' ').trim()
  const st = utcStamp(t.starts_at), en = utcStamp(endOf(t.starts_at, t.duration_min)) || st
  const now = nowIso.replace(/[-:]/g, '').slice(0, 15) + 'Z'
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Bharat AI Innovation//Innovation Talk brief//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:innovation-talk-${t.id}@bharataiinnovation.com`, `DTSTAMP:${now}`, `DTSTART:${st}`, `DTEND:${en}`,
    `SUMMARY:${clean('Innovation Talk: ' + (String(t.topic || '').trim() || String(t.company || '').trim()) + ' (' + MUMBAI_WORDS.name + ')')}`,
    `LOCATION:${clean(whereLine(t))}`, `DESCRIPTION:${clean('Innovation Talk & Showcase at ' + MUMBAI_WORDS.name + '.')}`, `URL:${SITE}/exhibition#innovation-talks`,
    'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n')
}

export function briefSubject(t: any, toSpeaker: boolean, update: boolean): string {
  const when = `${dayLabel(t.starts_at)}, ${clock(t.starts_at)}, ${String(t.hall || '').trim() || 'hall to be confirmed'}`
  const base = toSpeaker ? `Your Innovation Talk at ${MUMBAI_WORDS.name}: ${when}`
    : `Innovation Talk by ${String(t.speaker_name || '').trim() || 'your speaker'}: ${when}`
  return (update ? 'Updated: ' : '') + base
}

// The email. passHref '' leaves the pass button out; '#preview' is what a preview
// carries, so a preview never mints a sign-in link. detailsHref '' leaves out the line
// about adding a topic or photo.
export function briefEmailHTML(a: { t: any; toSpeaker: boolean; update: boolean; note: string; header: string; passHref: string; passName: string; detailsHref: string;
    subject?: string; greeting?: string; opening?: string }): { subject: string; html: string } {
  const { t, toSpeaker } = a
  const name = String(t.speaker_name || '').trim()
  const company = String(t.company || '').trim()
  const topic = String(t.topic || '').trim()
  const greeting = cleanLine(a.greeting, 120) || (toSpeaker ? `Dear ${firstName(name)},` : 'Hello,')
  const opening = cleanBlock(a.opening, 1500) || (a.update
    ? `The details of ${toSpeaker ? 'your' : name ? name + '’s' : 'the'} Innovation Talk have changed. Here they are as they stand now; please use these and not the earlier email.`
    : toSpeaker
      ? `Thank you for presenting at the Innovation Talk & Showcase at ${MUMBAI_WORDS.name}. Here is your slot: the day and time, the hall, and how long you have on stage.`
      : `Here is the slot for the Innovation Talk by ${name || 'your speaker'}${company ? ` of ${company}` : ''} at ${MUMBAI_WORDS.name}. Please pass it on to ${name ? firstName(name) : 'them'}.`)
  const subject = cleanLine(a.subject, 200) || briefSubject(t, toSpeaker, a.update)
  const row = (k: string, v: string) => `<tr><td style="color:#6b7280;padding:3px 14px 3px 0;vertical-align:top;white-space:nowrap">${k}</td><td style="padding:3px 0">${v}</td></tr>`
  const missing = !topic || !String(t.speaker_photo_url || '').trim() || !String(t.speaker_title || '').trim()
  const card = `<div style="border:1px solid #e7e9f5;border-radius:12px;padding:16px 18px;margin:0 0 12px;background:#fbfcff">
      <div style="font-size:12px;font-weight:bold;color:#C84F00;text-transform:uppercase;letter-spacing:0.4px">Innovation Talk &amp; Showcase</div>
      <div style="font-size:17px;font-weight:bold;margin:4px 0 10px;color:#1e2140">${topic ? escH(topic) : `<span style="color:#9aa0b8">Topic to be announced</span>`}</div>
      <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.6;color:#1e2140">
        ${row('Speaker', escH(name) + (t.speaker_title ? `, ${escH(t.speaker_title)}` : '') + (company ? ` &middot; ${escH(company)}` : ''))}
        ${row('When', `<strong>${escH(whenLine(t))}</strong>`)}
        ${row('On stage', `${Number(t.duration_min)} minutes, including your demo`)}
        ${row('Where', `<strong>${escH(String(t.hall || '').trim())}</strong>${hooks.hallWhere && hooks.hallWhere(t.hall) ? `, ${escH(hooks.hallWhere(t.hall))}` : ''}, ${escH(MUMBAI_WORDS.venue)}`)}
      </table>
      <div style="margin-top:10px;font-size:13px">Add to your calendar: <a href="${escH(googleCalendarUrl(t))}" style="color:#C84F00;font-weight:bold">Google</a>
        &middot; <a href="${SITE}/api/innovation-talks/${Number(t.id)}/calendar.ics" style="color:#C84F00;font-weight:bold">Outlook or Apple</a></div>
    </div>`
  const details = missing && a.detailsHref ? `<p style="font-size:14px;line-height:1.65;margin:0 0 14px">${toSpeaker ? 'Your' : 'The'} ${[!topic ? 'topic' : '', !String(t.speaker_title || '').trim() ? 'designation' : '', !String(t.speaker_photo_url || '').trim() ? 'photo' : ''].filter(Boolean).join(', ').replace(/, ([^,]*)$/, ' and $1')} ${!topic && (String(t.speaker_title || '').trim() && String(t.speaker_photo_url || '').trim()) ? 'is' : 'are'} still missing from the programme. <a href="${escH(a.detailsHref)}" style="color:#C84F00;font-weight:bold">Add ${toSpeaker ? 'them' : 'them for ' + (name ? firstName(name) : 'the speaker')}</a>; it takes two minutes on a phone and no sign-in.</p>` : ''
  const pass = a.passHref
    ? `<div style="border:1px solid #f3d9c6;border-radius:12px;padding:16px 18px;margin:6px 0 12px;background:#fff8f3">
      <div style="font-size:15px;font-weight:bold;color:#1e2140;margin:0 0 6px">${toSpeaker ? 'Your' : firstName(name) + '’s'} ${escH(a.passName)} pass</div>
      <p style="font-size:14px;line-height:1.6;margin:0 0 12px">It is in the event app. At the venue, show its QR code at the badge desk to collect the printed badge.</p>
      <a href="${escH(a.passHref)}" style="display:inline-block;padding:12px 24px;background:#C84F00;color:#fff;text-decoration:none;border-radius:10px;font-weight:bold;font-size:14px">Show ${toSpeaker ? 'my' : 'the'} pass</a>
      <p style="font-size:12px;color:#6b7280;margin:10px 0 0">The button signs ${toSpeaker ? 'you' : 'the pass holder'} in. It works for 7 days; after that, sign in at the app with ${toSpeaker ? 'this' : 'their'} email address.</p>
    </div>`
    : `<div style="border:1px solid #e7e9f5;border-radius:12px;padding:14px 18px;margin:6px 0 12px;background:#fbfcff">
      <div style="font-size:15px;font-weight:bold;color:#1e2140;margin:0 0 6px">${toSpeaker ? 'Your' : 'The speaker’s'} pass</div>
      <p style="font-size:14px;line-height:1.6;margin:0">Everyone on stage needs their own pass. ${toSpeaker ? 'Ask your company’s booth contact to add you' : 'Add ' + (name ? firstName(name) : 'them')} under <strong>Teams &amp; Passes</strong> on the <a href="${SITE}/marketplace/dashboard" style="color:#C84F00;font-weight:bold">exhibitor dashboard</a>; the pass then comes by email. Not possible? Reply to this email.</p>
    </div>`
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f6f7fb;padding:24px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1e2140">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e7e9f5">
    ${a.header}
    <div style="padding:26px 26px 8px">
      <p style="font-size:15px;line-height:1.65;margin:0 0 14px">${escH(greeting)}</p>
      <p style="font-size:15px;line-height:1.65;margin:0 0 18px;white-space:pre-wrap">${escH(opening)}</p>
      ${card}
      ${details}
      ${pass}
      ${a.note ? `<p style="font-size:15px;line-height:1.65;margin:16px 0 0;white-space:pre-wrap">${escH(a.note)}</p>` : ''}
      <p style="font-size:15px;line-height:1.65;margin:16px 0 0">If anything here is wrong, reply to this email and we will fix it.</p>
      <p style="margin:22px 0 24px;font-size:14px;color:#555">Team Bharat AI Innovation<br>
        <span style="color:#888">${escH(MUMBAI_WORDS.line).replace(' · ', ' &middot; ')}</span></p>
    </div>
  </div></body></html>`
  return { subject, html }
}

// The same details as plain text, for WhatsApp. No pass link: that link signs in.
export function briefText(t: any, note: string): string {
  const lines = [`*${MUMBAI_WORDS.name}*`, `Innovation Talk & Showcase: ${String(t.speaker_name || '').trim()}${String(t.company || '').trim() ? ', ' + String(t.company).trim() : ''}`, '']
  lines.push(`*${String(t.topic || '').trim() || 'Topic to be announced'}*`, `When: ${whenLine(t)}`, `On stage: ${Number(t.duration_min)} minutes`, `Where: ${whereLine(t)}`, '')
  if (note) lines.push(note, '')
  lines.push('Team Bharat AI Innovation')
  return lines.join('\n')
}

// ---------- reading what a brief needs ----------

// The talks the Innovation Talks tab lists: every organiser row, and an exhibitor's own
// stage-talk row once it has a time (a draft without one is hidden there too).
async function talksOf(c: any, eventId: number): Promise<any[]> {
  return await all(c, "SELECT * FROM innovation_talks WHERE event_id = ? AND (exhibitor_id IS NULL OR starts_at IS NOT NULL) AND COALESCE(status, '') <> 'cancelled' ORDER BY starts_at IS NULL, starts_at, slot_no, id", eventId)
    .catch(async () => await all(c, "SELECT * FROM innovation_talks WHERE event_id = ? AND COALESCE(status, '') <> 'cancelled' ORDER BY slot_no, id", eventId))
}

async function lastSent(c: any, ids: number[]): Promise<Map<number, any>> {
  const out = new Map<number, any>()
  if (!ids.length) return out
  try {
    const rows = await all(c, `SELECT entity_id, detail, actor, created_at FROM admin_audit WHERE entity = 'innovation_talk' AND action = '${AUDIT_ACTION}' ORDER BY id`)
    const want = new Set(ids.map(String))
    for (const x of rows) {
      if (!want.has(String(x.entity_id))) continue
      let d: any = {}
      try { d = JSON.parse(x.detail || '{}') } catch { /* not JSON */ }
      const id = Number(x.entity_id)
      const was = out.get(id) || {}
      out.set(id, { at: x.created_at, by: x.actor, fp: d.fp || '', kind: d.kind || 'first', to: d.to || '', n: (was.n || 0) + 1 })
    }
  } catch { /* no audit table: nothing sent as far as anyone can tell */ }
  return out
}

// The pass under an email address, if any. A booth contact's own pass is not the
// speaker's, so a brief sent to the booth carries no pass button.
async function passOf(c: any, eventId: number, email: string): Promise<{ attendee_id: number; badge_type: string } | null> {
  if (!email) return null
  try {
    const r = await one(c, 'SELECT id, badge_type FROM attendees WHERE event_id = ? AND lower(trim(email)) = ? ORDER BY id LIMIT 1', eventId, email.toLowerCase())
    return r ? { attendee_id: Number(r.id), badge_type: String(r.badge_type || '') } : null
  } catch { return null }
}

async function savedNote(c: any): Promise<string> {
  try { return String((await one(c, 'SELECT value FROM app_settings WHERE key = ?', NOTE_KEY))?.value || '') } catch { return '' }
}

const passWord = (badge: string) => badge && !/visitor/i.test(badge) ? badge.replace(/\s*pass$/i, '') : 'Visitor'

// ---------- routes ----------

tb.get('/api/admin/events/:id/talk-briefs', async (c) => {
  const eventId = Number(c.req.param('id')) || 1
  const talks = await talksOf(c, eventId)
  const [contacts, sent, note] = await Promise.all([hooks.contacts ? hooks.contacts(c, eventId) : {}, lastSent(c, talks.map(t => Number(t.id))), savedNote(c)])
  const out: any[] = []
  for (const t of talks) {
    const ct = contacts[String(t.id)] || { email: '', source: 'none', note: 'No email on file.', protocol: false }
    const email = String(ct.email || '').trim().toLowerCase()
    const fp = briefFingerprint(t)
    const last = sent.get(Number(t.id)) || null
    const pass = ct.source === 'booth' ? null : await passOf(c, eventId, email)
    out.push({
      id: Number(t.id), speaker: t.speaker_name || '', title: t.speaker_title || '', company: t.company || '', topic: t.topic || '', photo_url: t.speaker_photo_url || '',
      starts_at: t.starts_at || null, duration_min: Number(t.duration_min) || 0, hall: t.hall || '', time_slot: t.time_slot || '',
      email, source: ct.source, contact_note: ct.note || '', protocol: !!ct.protocol, fp, last,
      status: briefStatus({ timed: timed(t), email, protocol: !!ct.protocol, last, fp }),
      pass,
    })
  }
  const counts: Record<string, number> = {}
  for (const x of out) counts[x.status] = (counts[x.status] || 0) + 1
  return c.json({ event_id: eventId, talks: out, counts, note })
})

// The note every brief carries (where to report, slides, who to call on the day).
tb.put('/api/admin/talk-briefs/note', async (c) => {
  const b = await c.req.json().catch(() => ({})) as any
  const note = String(b.note == null ? '' : b.note).replace(/\r\n/g, '\n').trim().slice(0, 1500)
  await c.env.DB.prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP')
    .bind(NOTE_KEY, note).run()
  if (hooks.audit) { try { await hooks.audit(c, 'innovation_talk.brief_note', 'setting', NOTE_KEY, { length: note.length }) } catch { /* never fails the save */ } }
  return c.json({ success: true, note })
})

// Preview ({ preview: true }) or send one talk's brief. { anyway: true } is needed to
// email a government official (the list never does it for you). { to } sends to another
// address instead of the one on file (typed in the sheet).
tb.post('/api/admin/innovation-talks/:id/brief', async (c) => {
  const b = await c.req.json().catch(() => ({})) as any
  return sendTalkBrief(c, Number(c.req.param('id')), b)
})

// "Reminder for Saturday" (the organiser, 20 Nov night: "send reminder to all speakers with
// schedule as well"): each Saturday talk's brief once more, with a reminder subject, sent by
// the minute clock (index.tsx, while app_settings.sat_reminders is 'on'), a few a minute.
// Government officials, talks with no address and talks already started are left out.
const REMINDER_DAY = '2026-11-21'
const REMINDER_ACTION = 'innovation_talk.reminder'
const istMs = (v: any) => { const t = Date.parse(String(v || '').replace(' ', 'T').slice(0, 16) + ':00+05:30'); return Number.isFinite(t) ? t : Infinity }
export async function saturdayTalkReminders(c: any, max = 10, nowMs = Date.now()): Promise<{ sent: number; failed: number; left: number; skipped: number }> {
  const out = { sent: 0, failed: 0, left: 0, skipped: 0 }
  const talks = (await talksOf(c, 1)).filter(t => timed(t) && String(t.starts_at).slice(0, 10) === REMINDER_DAY && istMs(t.starts_at) > nowMs)
  if (!talks.length) return out
  const done = new Set((await all(c, "SELECT entity_id FROM admin_audit WHERE entity = 'innovation_talk' AND action = ?", REMINDER_ACTION).catch(() => [])).map((r: any) => String(r.entity_id)))
  const contacts = hooks.contacts ? await hooks.contacts(c, 1) : {}
  for (const t of talks) {
    if (done.has(String(t.id))) continue
    const ct = contacts[String(t.id)]
    if (!ct || !String(ct.email || '').trim() || ct.protocol) { out.skipped++; continue }
    if (out.sent + out.failed >= max) { out.left++; continue }
    const res = await sendTalkBrief(c, Number(t.id), { update: false, audit_action: REMINDER_ACTION, subject: 'Reminder: your Innovation Talk on Saturday 21 Nov at Bharat AI Innovation' })
    if (res.status === 200) out.sent++; else out.failed++
  }
  return out
}

async function sendTalkBrief(c: any, id: number, b: any): Promise<Response> {
  const t = await one(c, 'SELECT * FROM innovation_talks WHERE id = ?', id)
  if (!t) return c.json({ error: 'That talk is not there any more. Refresh the page.' }, 404)
  const eventId = Number(t.event_id) || 1
  if (eventId !== 1) return c.json({ error: 'Talk briefs are for the Mumbai event for now.' }, 409)
  if (!timed(t)) return c.json({ error: `${t.speaker_name || 'This talk'} has no time or hall yet. Set them on the talk first.` }, 409)
  const contacts = hooks.contacts ? await hooks.contacts(c, eventId) : {}
  const ct = contacts[String(id)] || { email: '', source: 'none', note: '', protocol: false }
  const typed = String(b.to || '').trim().toLowerCase()
  if (typed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed)) return c.json({ error: 'That email address does not look right.' }, 400)
  const email = typed || String(ct.email || '').trim().toLowerCase()
  const toSpeaker = typed ? true : ct.source !== 'booth'
  const note = b.note == null ? await savedNote(c) : String(b.note).replace(/\r\n/g, '\n').trim().slice(0, 1500)
  const fp = briefFingerprint(t)
  const last = (await lastSent(c, [id])).get(id) || null
  const update = b.update == null ? !!(last && last.fp !== fp) : !!b.update
  const have = toSpeaker ? await passOf(c, eventId, email) : null
  const passName = have ? passWord(have.badge_type) : ''
  const header = hooks.emailHeader ? hooks.emailHeader(update ? 'Your Innovation Talk has moved' : 'Your Innovation Talk', MUMBAI_WORDS.line) : ''
  const protocol = !!ct.protocol
  let detailsHref = ''
  if (hooks.detailsLink) { try { detailsHref = await hooks.detailsLink(c, id) } catch { detailsHref = '' } }
  const wording = { subject: cleanLine(b.subject, 200), greeting: cleanLine(b.greeting, 120), opening: cleanBlock(b.opening, 1500) }

  if (b.preview) {
    const mail = briefEmailHTML({ t, toSpeaker, update, note, header, passHref: have ? '#preview' : '', passName, detailsHref: detailsHref ? '#preview' : '', ...wording })
    return c.json({ to: email, source: typed ? 'typed' : ct.source, to_speaker: toSpeaker, subject: mail.subject, html: mail.html, text: briefText(t, note), note, update, protocol, fp,
      speaker: t.speaker_name || '', status: briefStatus({ timed: true, email, protocol, last, fp }), last, pass: have ? { badge_type: have.badge_type } : null })
  }
  if (!email) return c.json({ error: `There is no email address for ${t.speaker_name || 'this talk'}. Type one, or add it on the talk.` }, 409)
  if (protocol && !b.anyway) return c.json({ error: `${t.speaker_name || 'This speaker'} is a government official: their office handles protocol. Copy the details for WhatsApp instead, or send anyway.` }, 409)
  if (!hooks.sendEmail) return c.json({ error: 'Email is not set up on this server.' }, 503)
  let href = ''
  if (have && hooks.passLink) { try { href = await hooks.passLink(c, eventId, email) } catch { href = '' } }
  const mail = briefEmailHTML({ t, toSpeaker, update, note, header, passHref: href, passName, detailsHref, ...wording })
  const sent = await hooks.sendEmail(c, email, mail.subject, mail.html)
  if (!sent.ok) return c.json({ error: sent.error || 'The email did not go.' }, 502)
  // Remembered on the talk too, so the tab's "asked" column knows this address.
  if (typed && ct.source !== 'speaker') {
    try { await c.env.DB.prepare("UPDATE innovation_talks SET speaker_email = ? WHERE id = ? AND trim(ifnull(speaker_email, '')) = ''").bind(email, id).run() } catch { /* before 0052 */ }
  }
  if (hooks.audit) {
    try { await hooks.audit(c, String(b.audit_action || AUDIT_ACTION), 'innovation_talk', id, { speaker: t.speaker_name, company: t.company, to: email, source: typed ? 'typed' : ct.source, fp, kind: update ? 'update' : 'first', subject: mail.subject, pass: have ? have.badge_type : null }) }
    catch { /* the audit log never fails a send */ }
  }
  return c.json({ success: true, to: email, kind: update ? 'update' : 'first', fp, subject: mail.subject })
}

// A timed talk as a calendar file, for the brief's "Outlook or Apple" link.
tb.get('/api/innovation-talks/:id/calendar.ics', async (c) => {
  const id = Number(c.req.param('id'))
  if (!id) return c.text('Not found', 404)
  const t = await one(c, "SELECT * FROM innovation_talks WHERE id = ? AND event_id = 1 AND COALESCE(status, '') <> 'cancelled'", id).catch(() => null)
  if (!t || !timed(t)) return c.text('Not found', 404)
  return new Response(icsText(t), { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="bharat-ai-innovation-talk-${id}.ics"`, 'Cache-Control': 'public, max-age=300' } })
})

export default tb
