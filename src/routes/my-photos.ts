import { Hono } from 'hono'
import { personFor, albumPeople, pageUrl, hiddenPhotos, shown, NOT_ME, OPT_OUT, liveProgramme, panelShotsFor } from './photos'
import { linksForDrive } from './photo-store'

// ==================== MY PHOTOS IN THE APP (23 Nov 2026) ====================
//
// The organiser: "will everyone get photos inside their dashboard?" ... "yes". The app's
// home screen shows the signed-in person a few of their Mumbai event photos and a button
// to their own photos page (/photos/<key>, routes/photos.ts): the same page their photos
// email opens, so saves, "Not me" and "Don't match my photos" all stay in one place.
//
// Which album is theirs: a speaker, Innovation Talk speaker or named guest whose email is
// this person's (that album has their panel's group shots), else their attendee album
// a<attendee id> (scripts/photos/att_match.py). The talk's email counts only when it is
// the speaker's own or found by name on the company's team list, never the booth contact.
//
// What the card is told (GET /api/my-photos):
//   found     count, four small photos (signed s links, never the full size), the page link
//   notfound  registered for Mumbai, no album yet: the card asks for a clear photo, so the
//             next matching run can find them (the same ask as routes/find-photos.ts)
//   optedout  they said "Don't match my photos": no card
//   none      not signed in, another event, or a campus-panel-only registration: no card
// The count is the page's own: panel shots first, then their own photos, less "Not me"
// and hidden ones, and only photos the store has a link for (albumView in photos.ts).

type Me = { id: number; email: string; name: string; company: string }
type Contact = { email?: string; source?: string }
type Hooks = {
  me?: (c: any) => Promise<Me | null>
  talkContacts?: (c: any, eventId: number) => Promise<Record<string, Contact>>
}
let hooks: Hooks = {}
export function configureMyPhotos(h: Hooks) { hooks = { ...hooks, ...h } }

const mp = new Hono<{ Bindings: any }>()
const THUMBS = 4
const norm = (v: any) => String(v ?? '').trim().toLowerCase()
const NO_STORE = { 'Cache-Control': 'private, no-store' }

// The album key for this person, speaker side first. Exported for the smoke test.
export async function albumKeyFor(c: any, me: Me): Promise<string | null> {
  const email = norm(me.email)
  const has = (key: string) => { const p = personFor(key); return p && p.photos && p.photos.length ? p.key : null }
  if (email) {
    try {
      const rows = ((await c.env.DB.prepare('SELECT id FROM speakers WHERE event_id = 1 AND lower(trim(email)) = ?').bind(email).all()) as any).results || []
      for (const r of rows) { const k = has('s' + r.id); if (k) return k }
    } catch { /* no speakers table here */ }
    try {
      const talks = hooks.talkContacts ? await hooks.talkContacts(c, 1) : {}
      for (const [id, t] of Object.entries(talks || {})) {
        if (norm(t && t.email) === email && (t.source === 'speaker' || t.source === 'team')) { const k = has('t' + id); if (k) return k }
      }
    } catch { /* the talks list did not load */ }
    for (const p of albumPeople()) if (p.guest && norm(p.guest.email) === email && p.photos.length) return p.key
  }
  return has('a' + me.id)
}

async function choicesOf(c: any, key: string): Promise<{ optedOut: boolean; notMe: Set<string> }> {
  const notMe = new Set<string>(); let optedOut = false
  try {
    const rows = ((await c.env.DB.prepare("SELECT action, detail FROM admin_audit WHERE entity = 'photo_album' AND entity_id = ? AND action IN (?, ?)").bind(key, NOT_ME, OPT_OUT).all()) as any).results || []
    for (const r of rows) {
      if (r.action === OPT_OUT) optedOut = true
      else { try { const d = JSON.parse(r.detail || '{}'); if (d.photo) notMe.add(String(d.photo)) } catch { /* not JSON */ } }
    }
  } catch { /* no audit table */ }
  return { optedOut, notMe }
}

mp.get('/api/my-photos', async (c) => {
  const me = hooks.me ? await hooks.me(c).catch(() => null) : null
  if (!me) return c.json({ state: 'none' }, 401, NO_STORE)
  // Mumbai only, and not a campus-panel-only registration (main_event = 0).
  let row: any = null
  try { row = await c.env.DB.prepare('SELECT * FROM attendees WHERE id = ?').bind(me.id).first() } catch { row = null }
  if (!row || Number(row.event_id || 1) !== 1 || (row.main_event !== undefined && row.main_event !== null && Number(row.main_event) === 0)) return c.json({ state: 'none' }, 200, NO_STORE)

  const key = await albumKeyFor(c, me)
  if (!key) return c.json({ state: 'notfound', photo: !!String(row.avatar_url || '').trim() }, 200, NO_STORE)
  const p = personFor(key)!
  const attendee = /^a\d+$/.test(key)
  const mine = attendee ? await choicesOf(c, key) : { optedOut: false, notMe: new Set<string>() }
  if (mine.optedOut) return c.json({ state: 'optedout' }, 200, NO_STORE)

  const hidden = await hiddenPhotos(c)
  let panel: string[] = []
  if (!attendee) { try { panel = panelShotsFor(key, await liveProgramme(c)) } catch { panel = [] } }
  const asked = [...panel, ...p.photos.filter(id => !panel.includes(id))].filter(id => !mine.notMe.has(id) && !(hidden && hidden.has(id)))
  const got = await linksForDrive(c, key, asked)
  const ids = shown(asked, got, hidden !== null).filter(id => got[id])
  if (!ids.length) return c.json({ state: 'notfound', photo: !!String(row.avatar_url || '').trim() }, 200, NO_STORE)

  // Their best (chosen for the email: in person, landscape, a big face) first.
  const order = [...(p.best || []).filter(id => ids.includes(id)), ...ids]
  const thumbs: { s: string; x: number; y: number }[] = []
  for (const id of order) {
    if (thumbs.length >= THUMBS) break
    if (thumbs.some(t => t.s === got[id].s)) continue
    const f = (p.focus && p.focus[id]) || [50, 40]
    thumbs.push({ s: got[id].s, x: Math.round(Number(f[0]) || 50), y: Math.round(Number(f[1]) || 40) })
  }
  return c.json({ state: 'found', count: ids.length, url: await pageUrl(c, key), thumbs }, 200, NO_STORE)
})

export default mp
