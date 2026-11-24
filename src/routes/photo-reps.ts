import { Hono } from 'hono'
import { whatsappNumber, shownNumber, isNoEmail } from './team-guests'

// ==================== WHO LOOKS AFTER THEM (24 Nov 2026) ====================
//
// The organiser, looking at Admin -> WhatsApp -> Sent: "put the name, email, designation,
// mobile of PR below main guys / exhibitor, speaker, vip, govt etc name". A speaker's or a
// guest's photos often go to the person who looks after them (their PR, their office), and a
// company's photos go to someone on its team; the list then showed the main name beside a
// stranger's number.
//
// A "rep" belongs to an album key: s<speaker id>, t<talk id>, g<n> a guest, a<attendee id>,
// x<exhibitor id> a company's photos. Three sources, joined into one list a key:
// - typed by the team: admin_audit action 'photos.rep', entity 'photo_album', entity_id the
//   key, detail { name, title, email, mobile } ({ removed: true } takes one off again);
// - a copy of a speaker's photos email to their PR: 'speaker.photos_copy', detail.to;
// - a company's photos on WhatsApp: every number an x<id> album went to is someone at that
//   company. (For a person's own album a typed number may be their own, so it is never
//   called a rep unless the team typed who it is.)
// Names, designations, emails and mobiles that are missing are filled in from their own
// registration, found by email or by the last ten digits of the mobile.
//
// Used by routes/whatsapp.ts (the Sent list, and photos-one saves who a typed number is).

type Hooks = { audit?: (c: any, action: string, entity?: string, entityId?: any, detail?: any) => Promise<any> }
let hooks: Hooks = {}
export function configurePhotoReps(h: Hooks) { hooks = { ...hooks, ...h } }

export const REP_ACTION = 'photos.rep'
const COPY_ACTION = 'speaker.photos_copy'
export type Rep = { name: string; title: string; email: string; mobile: string; number: string; by: string[] }

const reps = new Hono<{ Bindings: any }>()
const KEY_RE = /^[a-z]\d{1,9}$/
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/
const all = async (c: any, sql: string, ...args: any[]) => (((await c.env.DB.prepare(sql).bind(...args).all()) as any).results || []) as any[]
const line = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const mailOf = (v: unknown) => { const e = String(v ?? '').trim().toLowerCase(); return EMAIL_RE.test(e) && !isNoEmail(e) ? e : '' }
const ten = (v: unknown) => { const d = String(v ?? '').replace(/\D/g, ''); return d.length >= 8 ? d.slice(-10) : '' }
const MOBILE_SQL = "REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(mobile, ''), ' ', ''), '-', ''), '+', ''), '(', '')"
const chunks = <T>(xs: T[], n = 90): T[][] => { const r: T[][] = []; for (let i = 0; i < xs.length; i += n) r.push(xs.slice(i, i + n)); return r }

// One person is one rep: the same mobile (last ten digits) or the same email.
const same = (a: Rep, b: Partial<Rep>) => (!!ten(a.mobile) && ten(a.mobile) === ten(b.mobile)) || (!!a.email && a.email === mailOf(b.email))
function put(list: Rep[], r: Partial<Rep>, by: string): void {
  const mobile = ten(r.mobile) ? String(r.mobile).trim() : '', email = mailOf(r.email)
  if (!mobile && !email) return
  let hit = list.find(x => same(x, { mobile, email }))
  if (!hit) { hit = { name: '', title: '', email: '', mobile: '', number: '', by: [] }; list.push(hit) }
  // What the team typed wins over what was found; otherwise the first words stay.
  const typed = by === 'typed'
  if (line(r.name, 120) && (typed || !hit.name)) hit.name = line(r.name, 120)
  if (line(r.title, 160) && (typed || !hit.title)) hit.title = line(r.title, 160)
  if (email && (typed || !hit.email)) hit.email = email
  if (mobile && (typed || !hit.mobile)) hit.mobile = mobile
  if (!hit.by.includes(by)) hit.by.push(by)
}

// Everyone who looks after each of these albums, by album key.
export async function repsFor(c: any, keys: string[]): Promise<Map<string, Rep[]>> {
  const ks = [...new Set(keys.map(k => String(k || '')).filter(k => KEY_RE.test(k)))]
  const out = new Map<string, Rep[]>()
  if (!ks.length) return out
  const listOf = (k: string) => { let l = out.get(k); if (!l) { l = []; out.set(k, l) } return l }
  for (const ch of chunks(ks)) {
    const q = ch.map(() => '?').join(',')
    // Typed records and email copies, oldest first, so a later "removed" takes one off.
    for (const r of await all(c, `SELECT action, entity_id, detail FROM admin_audit WHERE entity = 'photo_album' AND action IN (?, ?) AND entity_id IN (${q}) ORDER BY id`, REP_ACTION, COPY_ACTION, ...ch).catch(() => [] as any[])) {
      let d: any = {}
      try { d = JSON.parse(r.detail || '{}') } catch { d = {} }
      const l = listOf(String(r.entity_id))
      if (r.action === COPY_ACTION) { put(l, { email: d.to }, 'email copy'); continue }
      if (d.removed) { const i = l.findIndex(x => same(x, { mobile: d.mobile, email: d.email })); if (i >= 0) l.splice(i, 1); continue }
      put(l, { name: d.name, title: d.title, email: d.email, mobile: d.mobile }, 'typed')
    }
    // A company's photos on WhatsApp: whoever they went to is at that company.
    const xs = ch.filter(k => k[0] === 'x')
    if (xs.length) {
      for (const r of await all(c, `SELECT DISTINCT person, wa_number FROM wa_messages WHERE direction = 'out' AND kind = 'photos' AND test = 0
           AND status NOT IN ('failed', 'skipped', 'cancelled') AND person IN (${xs.map(() => '?').join(',')})`, ...xs).catch(() => [] as any[])) {
        put(listOf(String(r.person)), { mobile: String(r.wa_number || '') }, 'whatsapp')
      }
    }
  }
  // Fill in what is missing from their own registration: by email, then by mobile.
  const everyone = [...out.values()].flat()
  const byEmail = new Map<string, any>()
  for (const ch of chunks([...new Set(everyone.filter(r => r.email && (!r.name || !r.title || !r.mobile)).map(r => r.email))])) {
    for (const a of await all(c, `SELECT name, job_title, email, mobile, event_id, id FROM attendees WHERE lower(email) IN (${ch.map(() => '?').join(',')}) ORDER BY (event_id = 1), id`, ...ch).catch(() => [] as any[])) byEmail.set(String(a.email || '').toLowerCase(), a)
  }
  const byTen = new Map<string, any>()
  for (const t of [...new Set(everyone.filter(r => ten(r.mobile) && (!r.name || !r.title || !r.email) && !(r.email && byEmail.has(r.email))).map(r => ten(r.mobile)))].slice(0, 60)) {
    const a = await c.env.DB.prepare(`SELECT name, job_title, email, mobile FROM attendees WHERE ${MOBILE_SQL} LIKE ? ORDER BY (event_id = 1) DESC, id DESC LIMIT 1`).bind('%' + t).first().catch(() => null)
    if (a) byTen.set(t, a)
  }
  for (const [k, l] of out) {
    for (const r of l) {
      const a = (r.email && byEmail.get(r.email)) || byTen.get(ten(r.mobile))
      if (a) {
        if (!r.name) r.name = line(a.name, 120)
        if (!r.title) r.title = line(a.job_title, 160)
        if (!r.email) r.email = mailOf(a.email)
        if (!r.mobile && ten(a.mobile)) r.mobile = String(a.mobile).trim()
      }
    }
    // The same person found twice (once by email, once by number) is one line.
    const one: Rep[] = []
    for (const r of l) {
      const hit = one.find(x => same(x, r))
      if (!hit) { one.push(r); continue }
      for (const f of ['name', 'title', 'email', 'mobile'] as const) if (!hit[f] && r[f]) hit[f] = r[f]
      for (const b of r.by) if (!hit.by.includes(b)) hit.by.push(b)
    }
    // A number kept as digits with another country's code reads as one only with its + back.
    for (const r of one) { r.number = whatsappNumber(r.mobile) || whatsappNumber('+' + r.mobile.replace(/\D/g, '')) || ''; r.mobile = r.number ? shownNumber(r.number) : r.mobile }
    out.set(k, one)
  }
  return out
}

// Saves who looks after an album (the team typed it). Returns an error in words, or ''.
export async function saveRep(c: any, key: string, r: { name?: unknown; title?: unknown; email?: unknown; mobile?: unknown; removed?: boolean }): Promise<string> {
  if (!KEY_RE.test(String(key || ''))) return 'That is not one of our photo albums.'
  const name = line(r.name, 120), title = line(r.title, 160), email = mailOf(r.email)
  const typedMobile = String(r.mobile ?? '').trim()
  const number = typedMobile ? whatsappNumber(typedMobile) : ''
  if (String(r.email ?? '').trim() && !email) return 'That email address is not complete.'
  if (typedMobile && !number) return 'That mobile number is not complete.'
  if (!email && !number) return 'Type their mobile number or their email address.'
  if (!r.removed && !name) return 'Type their name.'
  if (!hooks.audit) return 'This cannot be saved on this server.'
  await hooks.audit(c, REP_ACTION, 'photo_album', key, { name, title, email, mobile: number, ...(r.removed ? { removed: true } : {}) })
  return ''
}

reps.get('/api/admin/photo-reps', async (c) => {
  const key = String(c.req.query('key') || '')
  if (!KEY_RE.test(key)) return c.json({ error: 'That is not one of our photo albums.' }, 400)
  return c.json({ key, reps: (await repsFor(c, [key])).get(key) || [] })
})

reps.post('/api/admin/photo-reps', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as any
  const key = String(b.key || '')
  const error = await saveRep(c, key, { name: b.name, title: b.title, email: b.email, mobile: b.mobile, removed: b.remove === true })
  if (error) return c.json({ error }, 400)
  return c.json({ success: true, key, reps: (await repsFor(c, [key])).get(key) || [] })
})

export default reps
