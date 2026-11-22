import { Hono } from 'hono'

// ==================== EVENT PHOTOS IN R2 (23 Nov 2026) ====================
//
// The organiser: thumbnails in each person's dashboard and email, the high-resolution
// photo on a tap, "limit one per[son] from downloading not more than 10 to 15 photos
// ... so that user don't download other photos and download their own; it will also
// protect it from misuse".
//
// The photographers' photos are copied once from Google Drive to R2 by
// scripts/photo-store/ (migration 0064, table event_photos):
//   event-photos/<event>/<pid>/s.jpg   600 px long side: grids, emails
//   event-photos/<event>/<pid>/m.jpg   1600 px: looking at one photo on a phone
//   event-photos/<event>/<pid>/o.jpg   the original (a RAW photo: Drive's full-size JPEG of it)
//
// Rules:
// - The bucket is never public and no link carries a Drive id (the Drive folder is
//   "anyone with the link"). Every link is signed for ONE person, ONE photo and ONE size
//   (photoLink), so a person only ever holds links to the photos the server chose for
//   them: their own, and later the "best of" set.
// - Saving an original (o) is counted in photo_downloads: at most photo_download_limit
//   (app_settings, default 15) different photos per person. Saving the same photo again
//   is free. Looking (s, m) is never counted.
// - Never put an o link in an email: mail scanners open links and would spend the
//   person's downloads. Emails carry s images and the link to the person's page.
// - A hidden photo (event_photos.hidden = 1) stops working everywhere at once.
// - `person` is 'a<attendee id>' for an attendee, or a speaker album key from
//   src/routes/photos.ts. 'admin' is the organiser's own view: never counted.
// Every /api/admin/* route here is behind the admin middleware in index.tsx.

type Hooks = { audit?: (c: any, action: string, entity?: string, entityId?: any, detail?: any) => Promise<void> }
let hooks: Hooks = {}
export function configurePhotoStore(h: Hooks) { hooks = { ...hooks, ...h } }

const st = new Hono<{ Bindings: any }>()
const SITE = 'https://bharataiinnovation.com'
export const DEFAULT_DOWNLOAD_LIMIT = 15
export const LINK_DAYS = 120
const DAY_MS = 86400000
const PID_RE = /^[A-Za-z0-9_-]{12}$/
const PERSON_RE = /^[A-Za-z0-9_.:-]{1,64}$/
export const ADMIN_PERSON = 'admin'

export const photoKey = (eventId: number, pid: string, part: string) => `event-photos/${eventId}/${pid}/${part}.jpg`
export const dayNumber = (now = Date.now()) => Math.floor(now / DAY_MS)
const all = async (c: any, sql: string, ...args: any[]) => (((await c.env.DB.prepare(sql).bind(...args).all()) as any).results || []) as any[]

function secretOf(c: any): string { return String(c.env?.PHOTO_SECRET || c.env?.ADMIN_SECRET || '') }
async function hmac32(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder()
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const s = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)))
  return Array.from(s.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join('')
}
function sameText(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

export async function photoLinkSig(c: any, pid: string, part: string, person: string, exp: number): Promise<string> {
  const s = secretOf(c)
  return s ? hmac32(s, `photo:${pid}:${part}:${person}:${exp}`) : ''
}

// The link to one size of one photo, for one person. Good for `days` days; the expiry is
// a whole day so the same link is given all day (browsers and mail proxies cache it).
export async function photoLink(c: any, pid: string, part: 's' | 'm' | 'o', person: string, days = LINK_DAYS, now = Date.now()): Promise<string> {
  const exp = dayNumber(now) + days
  const k = await photoLinkSig(c, pid, part, person, exp)
  return `${SITE}/photo/${pid}/${part}.jpg?u=${encodeURIComponent(person)}&e=${exp}&k=${k}`
}

export type PhotoLinks = { pid: string; s: string; m: string; o: string; width: number; height: number; day: string; taken_at: string }

async function linksOf(c: any, person: string, r: any, days: number): Promise<PhotoLinks> {
  return { pid: r.pid, s: await photoLink(c, r.pid, 's', person, days), m: await photoLink(c, r.pid, 'm', person, days), o: await photoLink(c, r.pid, 'o', person, days),
    width: Number(r.width || 0), height: Number(r.height || 0), day: String(r.day || ''), taken_at: String(r.taken_at || '') }
}

// For src/routes/photos.ts (the speaker albums, which know their photos by Drive id):
// signed links for each Drive id that is in R2 and not hidden, keyed by Drive id. A
// Drive id that is missing (not copied yet, hidden, or no migration 0064 on this
// database) is simply absent, so the caller can fall back to what it had.
export async function linksForDrive(c: any, person: string, driveIds: string[], eventId = 1, days = LINK_DAYS): Promise<Record<string, PhotoLinks>> {
  const out: Record<string, PhotoLinks> = {}
  if (!PERSON_RE.test(person) || !secretOf(c)) return out
  const ids = [...new Set((driveIds || []).filter(Boolean).map(String))]
  try {
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90)
      const rs = await all(c, `SELECT pid, drive_id, width, height, day, taken_at FROM event_photos WHERE event_id = ? AND hidden = 0 AND drive_id IN (${chunk.map(() => '?').join(',')})`, eventId, ...chunk)
      for (const r of rs) out[r.drive_id] = await linksOf(c, person, r, days)
    }
  } catch { /* no event_photos table here yet */ }
  return out
}

export async function downloadLimit(c: any): Promise<number> {
  try {
    const r = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'photo_download_limit'").first() as any
    const n = parseInt(String(r?.value ?? ''), 10)
    if (Number.isFinite(n) && n >= 0) return n
  } catch { /* the default */ }
  return DEFAULT_DOWNLOAD_LIMIT
}

// Counts one save of an original. True: let it through. Saving a photo already saved
// is always free; a new one only while the person is under the limit.
export async function countDownload(c: any, person: string, photoId: number, limit: number): Promise<boolean> {
  if (person === ADMIN_PERSON) return true
  const again = await c.env.DB.prepare('UPDATE photo_downloads SET times = times + 1, last_at = CURRENT_TIMESTAMP WHERE person = ? AND photo_id = ?').bind(person, photoId).run() as any
  if (again?.meta?.changes) return true
  if (limit <= 0) return false
  const add = await c.env.DB.prepare('INSERT INTO photo_downloads (person, photo_id) SELECT ?, ? WHERE (SELECT COUNT(*) FROM photo_downloads WHERE person = ?) < ? ON CONFLICT (person, photo_id) DO NOTHING')
    .bind(person, photoId, person, limit).run() as any
  if (add?.meta?.changes) return true
  // Two taps on the same new photo at once: the other one counted it.
  return !!(await c.env.DB.prepare('SELECT 1 AS y FROM photo_downloads WHERE person = ? AND photo_id = ?').bind(person, photoId).first())
}

export async function downloadsUsed(c: any, person: string): Promise<number> {
  try { return Number(((await c.env.DB.prepare('SELECT COUNT(*) AS n FROM photo_downloads WHERE person = ?').bind(person).first()) as any)?.n || 0) } catch { return 0 }
}

export function downloadName(title: string): string {
  const stem = String(title || '').replace(/\.[A-Za-z0-9]+$/, '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'photo'
  return `BharatAI-Mumbai-2026-${stem}.jpg`
}

// What a person sees when a full-size save is refused: a page, in plain words. A small
// or medium image that is refused answers with a bare status (it sits in an <img>).
function refusePage(why: 'broken' | 'expired' | 'gone' | 'limit' | 'off', limit = 0): string {
  const say: Record<string, [string, string]> = {
    broken: ['This photo link is not complete', 'Please open your photos page again and tap the photo there.'],
    expired: ['This photo link has expired', 'Please open your photos page again from your email or the app. It gives you fresh links.'],
    gone: ['This photo is no longer available', 'It may have been taken down. Your other photos are still on your photos page.'],
    limit: [`You have saved ${limit} photos`, `Each person can save up to ${limit} full-size photos. You can still look at all your photos and share them from your photos page. If you need more for your company or the press, reply to our email and we will help.`],
    off: ['Photos are not available right now', 'Please try again in a little while.'],
  }
  const [h, p] = say[why]
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Photos</title></head>
<body style="font-family:Segoe UI,Roboto,Arial,sans-serif;max-width:560px;margin:60px auto;padding:0 16px;color:#1e2140"><h1 style="font-size:22px">${h}</h1>
<p style="line-height:1.6">${p}</p>
<p><a href="${SITE}/" style="color:#C84F00;font-weight:bold">Bharat AI Innovation</a></p></body></html>`
}
const NOINDEX = { 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' }
function refuse(status: number, original: boolean, why: 'broken' | 'expired' | 'gone' | 'limit' | 'off', limit = 0): Response {
  if (!original) return new Response(null, { status, headers: { ...NOINDEX, 'Cache-Control': 'no-store' } })
  return new Response(refusePage(why, limit), { status, headers: { ...NOINDEX, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
}

// ---------- the photo itself ----------

st.get('/photo/:pid/:file', async (c) => {
  const pid = c.req.param('pid')
  const part = (/^([smo])\.jpg$/.exec(c.req.param('file')) || [])[1] || ''
  const original = part === 'o'
  const person = String(c.req.query('u') || '')
  const exp = Number(c.req.query('e') || 0)
  const k = String(c.req.query('k') || '')
  if (!PID_RE.test(pid) || !part || !PERSON_RE.test(person) || !Number.isInteger(exp)) return refuse(404, original, 'broken')
  if (!secretOf(c) || !c.env.UPLOADS) return refuse(503, original, 'off')
  if (!sameText(await photoLinkSig(c, pid, part, person, exp), k)) return refuse(403, original, 'broken')
  if (exp < dayNumber()) return refuse(410, original, 'expired')
  let row: any = null
  try { row = await c.env.DB.prepare('SELECT id, event_id, title, hidden FROM event_photos WHERE pid = ?').bind(pid).first() } catch { row = null }
  if (!row || row.hidden) return refuse(404, original, 'gone')
  const obj = await c.env.UPLOADS.get(photoKey(Number(row.event_id), pid, part))
  if (!obj) return refuse(404, original, 'gone')
  const h = new Headers({ ...NOINDEX, 'Content-Type': 'image/jpeg' })
  if (obj.size) h.set('Content-Length', String(obj.size))
  if (original) {
    const limit = await downloadLimit(c)
    if (!(await countDownload(c, person, Number(row.id), limit))) {
      try { await obj.body?.cancel() } catch { /* nothing to free */ }
      return refuse(429, true, 'limit', limit)
    }
    h.set('Cache-Control', 'private, no-store')
    h.set('Content-Disposition', `attachment; filename="${downloadName(row.title)}"`)
  } else {
    h.set('Cache-Control', 'private, max-age=604800')
    if (obj.httpEtag) h.set('ETag', obj.httpEtag)
  }
  return new Response(obj.body, { headers: h })
})

// ---------- Admin ----------

const NO_TABLES = { error: 'The photo tables are not in this database yet (migration 0064_event_photos.sql).' }

// How many photos are in, by day; how many people saved how many.
st.get('/api/admin/event-photos', async (c) => {
  const ev = Number(c.req.query('event') || 1)
  try {
    const days = await all(c, 'SELECT day, COUNT(*) AS photos, SUM(hidden) AS hidden, SUM(highlight) AS highlights, SUM(raw) AS raw, SUM(bytes) AS bytes FROM event_photos WHERE event_id = ? GROUP BY day ORDER BY day', ev)
    const limit = await downloadLimit(c)
    const dl = await c.env.DB.prepare('SELECT COUNT(DISTINCT d.person) AS people, COUNT(*) AS photos, COALESCE(SUM(d.times), 0) AS saves FROM photo_downloads d JOIN event_photos p ON p.id = d.photo_id WHERE p.event_id = ?').bind(ev).first() as any
    const full = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM (SELECT d.person FROM photo_downloads d JOIN event_photos p ON p.id = d.photo_id WHERE p.event_id = ? GROUP BY d.person HAVING COUNT(*) >= ?)').bind(ev, Math.max(limit, 1)).first() as any
    return c.json({ days, limit, downloads: { people: Number(dl?.people || 0), photos: Number(dl?.photos || 0), saves: Number(dl?.saves || 0), at_limit: Number(full?.n || 0) },
      signing: !!secretOf(c), bucket: !!c.env.UPLOADS })
  } catch { return c.json(NO_TABLES, 503) }
})

// A page of photos for the organiser to look through, with links signed for 'admin'
// (never counted, good for two days).
st.get('/api/admin/event-photos/list', async (c) => {
  const ev = Number(c.req.query('event') || 1)
  const day = String(c.req.query('day') || '')
  const offset = Math.max(0, parseInt(String(c.req.query('offset') || '0'), 10) || 0)
  const size = Math.min(200, Math.max(1, parseInt(String(c.req.query('size') || '60'), 10) || 60))
  const only = String(c.req.query('only') || '')   // '' | hidden | highlight
  if (!secretOf(c)) return c.json({ error: 'Photo links cannot be signed on this server.' }, 503)
  try {
    const where = ['event_id = ?']; const args: any[] = [ev]
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) { where.push('day = ?'); args.push(day) }
    if (only === 'hidden') where.push('hidden = 1')
    if (only === 'highlight') where.push('highlight = 1')
    const total = Number(((await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM event_photos WHERE ${where.join(' AND ')}`).bind(...args).first()) as any)?.n || 0)
    const rs = await all(c, `SELECT pid, title, day, taken_at, camera, hall, width, height, raw, hidden, highlight FROM event_photos WHERE ${where.join(' AND ')} ORDER BY day, CASE WHEN taken_at = '' THEN 1 ELSE 0 END, taken_at, title LIMIT ? OFFSET ?`, ...args, size, offset)
    const photos = []
    for (const r of rs) photos.push({ ...(await linksOf(c, ADMIN_PERSON, r, 2)), title: r.title, camera: r.camera, hall: r.hall, raw: !!r.raw, hidden: !!r.hidden, highlight: !!r.highlight })
    return c.json({ total, offset, size, photos })
  } catch { return c.json(NO_TABLES, 503) }
})

// The download limit for everyone (0 = no full-size saves at all).
st.post('/api/admin/event-photos/settings', async (c) => {
  const b = await c.req.json().catch(() => ({})) as any
  const n = Number(b.download_limit)
  if (!Number.isInteger(n) || n < 0 || n > 500) return c.json({ error: 'The download limit must be a whole number from 0 to 500.' }, 400)
  await c.env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('photo_download_limit', ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP").bind(String(n)).run()
  if (hooks.audit) { try { await hooks.audit(c, 'photos.limit', 'app_settings', 'photo_download_limit', { limit: n }) } catch { /* never fails the change */ } }
  return c.json({ success: true, limit: n })
})

// Hide a photo (every link to it stops working) or put it in the "best of" set.
st.post('/api/admin/event-photos/:pid', async (c) => {
  const pid = c.req.param('pid')
  if (!PID_RE.test(pid)) return c.json({ error: 'No such photo.' }, 404)
  const b = await c.req.json().catch(() => ({})) as any
  const sets: string[] = [], args: any[] = []
  if (typeof b.hidden === 'boolean') { sets.push('hidden = ?'); args.push(b.hidden ? 1 : 0) }
  if (typeof b.highlight === 'boolean') { sets.push('highlight = ?'); args.push(b.highlight ? 1 : 0) }
  if (!sets.length) return c.json({ error: 'Say hidden or highlight, true or false.' }, 400)
  try {
    const r = await c.env.DB.prepare(`UPDATE event_photos SET ${sets.join(', ')} WHERE pid = ?`).bind(...args, pid).run() as any
    if (!r?.meta?.changes) return c.json({ error: 'No such photo.' }, 404)
  } catch { return c.json(NO_TABLES, 503) }
  if (hooks.audit) { try { await hooks.audit(c, 'photos.change', 'event_photo', pid, { hidden: b.hidden, highlight: b.highlight }) } catch { /* never fails the change */ } }
  return c.json({ success: true, pid, hidden: b.hidden, highlight: b.highlight })
})

export default st
