import { Hono } from 'hono'

// ==================== EVENT PHOTOS IN R2 (23 Nov 2026) ====================
//
// The organiser: thumbnails in each person's dashboard and email, the high-resolution
// photo on a tap. At first full-size saves were capped (15 a person, 50 a speaker); later the
// same day the organiser: "allow people to download every photo in which they are visible,
// dont limit to 50 max rule. they should be able to select and download each one or all or
// whatever selected photos". So there is no cap: a person only ever holds links to their
// own photos, and that is the protection.
//
// The photographers' photos are copied once from Google Drive to R2 by
// scripts/photo-store/ (migration 0064, table event_photos):
//   event-photos/<event>/<pid>/s.jpg   600 px long side: grids, emails
//   event-photos/<event>/<pid>/m.jpg   1600 px: looking at one photo on a phone, sharing
//   event-photos/<event>/<pid>/o.jpg   the original (a RAW photo: Drive's full-size JPEG of it)
//
// Rules:
// - The bucket is never public and no link carries a Drive id (the Drive folder is
//   "anyone with the link"). Every link is signed for ONE person, ONE photo and ONE size
//   (photoLink), so a person only ever holds links to the photos the server chose for
//   them: their own, and later the "best of" set.
// - Saving an original (o, or a ZIP of them) is recorded in photo_downloads (who saved which
//   photo, how many times) for the organiser's counts. It never stops a save.
//   Looking (s, m) is never recorded.
// - Never put an o link in an email: mail scanners open links and would fill the counts
//   with saves nobody made. Emails carry s images and the link to the person's page.
// - A hidden photo (event_photos.hidden = 1) stops working everywhere at once.
// - `person` is 'a<attendee id>' for an attendee, or a speaker album key from
//   src/routes/photos.ts. 'admin' is the organiser's own view: never recorded.
// Every /api/admin/* route here is behind the admin middleware in index.tsx.

type Hooks = { audit?: (c: any, action: string, entity?: string, entityId?: any, detail?: any) => Promise<void> }
let hooks: Hooks = {}
export function configurePhotoStore(h: Hooks) { hooks = { ...hooks, ...h } }

const st = new Hono<{ Bindings: any }>()
const SITE = 'https://bharataiinnovation.com'
export const LINK_DAYS = 120
const DAY_MS = 86400000
export const PID_RE = /^[A-Za-z0-9_-]{12}$/
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

// bytes: the original's exact size, so the page can split a big "save all" into ZIP parts.
export type PhotoLinks = { pid: string; s: string; m: string; o: string; width: number; height: number; day: string; taken_at: string; bytes: number }

async function linksOf(c: any, person: string, r: any, days: number): Promise<PhotoLinks> {
  return { pid: r.pid, s: await photoLink(c, r.pid, 's', person, days), m: await photoLink(c, r.pid, 'm', person, days), o: await photoLink(c, r.pid, 'o', person, days),
    width: Number(r.width || 0), height: Number(r.height || 0), day: String(r.day || ''), taken_at: String(r.taken_at || ''), bytes: Number(r.bytes || 0) }
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
      const rs = await all(c, `SELECT pid, drive_id, width, height, day, taken_at, bytes FROM event_photos WHERE event_id = ? AND hidden = 0 AND drive_id IN (${chunk.map(() => '?').join(',')})`, eventId, ...chunk)
      for (const r of rs) out[r.drive_id] = await linksOf(c, person, r, days)
    }
  } catch { /* no event_photos table here yet */ }
  return out
}

// A speaker's album (person 's<speaker id>' or 't<talk id>', src/routes/photos.ts; or a named
// guest's, 'g<id>'), as opposed to an attendee's ('a<id>'). Kept apart in the counts.
export const isSpeakerAlbum = (person: string) => /^[stg]\d+$/.test(String(person || ''))

// Records saves of originals (one photo, or every photo in a ZIP). Saving a photo again adds
// to its times. Never stops a save, and never fails one: a count that cannot be written is lost.
export async function recordSaves(c: any, person: string, photoIds: number[]): Promise<void> {
  if (person === ADMIN_PERSON || !photoIds.length) return
  try {
    const q = c.env.DB.prepare('INSERT INTO photo_downloads (person, photo_id) VALUES (?, ?) ON CONFLICT (person, photo_id) DO UPDATE SET times = times + 1, last_at = CURRENT_TIMESTAMP')
    for (let i = 0; i < photoIds.length; i += 50) await c.env.DB.batch(photoIds.slice(i, i + 50).map(id => q.bind(person, id)))
  } catch { /* the save goes ahead */ }
}

export async function downloadsUsed(c: any, person: string): Promise<number> {
  try { return Number(((await c.env.DB.prepare('SELECT COUNT(*) AS n FROM photo_downloads WHERE person = ?').bind(person).first()) as any)?.n || 0) } catch { return 0 }
}

export function downloadName(title: string): string {
  const stem = String(title || '').replace(/\.[A-Za-z0-9]+$/, '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'photo'
  return `BharatAI-Mumbai-2026-${stem}.jpg`
}

// ---------- many photos at once: one ZIP file ----------
//
// "Save all" and "Save selected" on a person's photos page. JPEGs do not shrink, so the ZIP
// stores each photo as it is and streams it straight from R2: the worker never holds a whole
// photo. The CRC each file needs is worked out on the way through and written just after the
// photo (a data descriptor, as client-zip does); Windows, macOS, iPhone Files and Android open
// these. The exact length is known up front (event_photos.bytes is the original's size), so
// the browser shows progress. One ZIP holds at most ZIP_MAX_PHOTOS photos and ZIP_MAX_BYTES:
// no ZIP64 needed, a phone can hold it, and the CRC fits easily in the worker's CPU time. The
// page asks for a bigger choice in parts.
export const ZIP_MAX_PHOTOS = 100
export const ZIP_MAX_BYTES = 900_000_000

// CRC-32 eight bytes at a time ("slicing by 8"): about 0.2 s of CPU per 100 MB, five times
// the byte-at-a-time loop, so a full 900 MB ZIP stays near 2 s of the worker's CPU time.
const CRC_T = (() => {
  const t = new Int32Array(256 * 8)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c }
  for (let n = 0; n < 256; n++) { let c = t[n]; for (let k = 1; k < 8; k++) { c = t[c & 255] ^ (c >>> 8); t[k * 256 + n] = c } }
  return t
})()
export function crc32(buf: Uint8Array, prev = 0): number {
  const t = CRC_T
  let c = ~prev, i = 0
  const n = buf.length, end = n - (n & 7)
  for (; i < end; i += 8) {
    const a = (buf[i] | (buf[i + 1] << 8) | (buf[i + 2] << 16) | (buf[i + 3] << 24)) ^ c
    c = t[1792 + (a & 255)] ^ t[1536 + ((a >>> 8) & 255)] ^ t[1280 + ((a >>> 16) & 255)] ^ t[1024 + (a >>> 24)]
      ^ t[768 + buf[i + 4]] ^ t[512 + buf[i + 5]] ^ t[256 + buf[i + 6]] ^ t[buf[i + 7]]
  }
  for (; i < n; i++) c = t[(c ^ buf[i]) & 255] ^ (c >>> 8)
  return ~c >>> 0
}

// When the photo was taken, in India, the way a ZIP file stores a date and time.
function dosStamp(takenAt: string, day: string): [number, number] {
  let ms = Date.parse(String(takenAt || ''))
  ms = Number.isFinite(ms) ? ms + 330 * 60000 : Date.parse((/^\d{4}-\d{2}-\d{2}$/.test(day) ? day : '2026-11-20') + 'T12:00:00Z')
  const d = new Date(ms)
  return [(d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1), ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate()]
}

export type ZipPhoto = { id: number; pid: string; drive_id: string; event_id: number; title: string; day: string; taken_at: string; bytes: number }
type ZipEntry = { key: string; name: Uint8Array; size: number; time: number; date: number; crc: number; offset: number }
const u16 = (v: DataView, at: number, n: number) => v.setUint16(at, n & 0xffff, true)
const u32 = (v: DataView, at: number, n: number) => v.setUint32(at, n >>> 0, true)
const FLAGS = 0x0808 // bit 3: CRC and sizes follow the data; bit 11: UTF-8 names

function localHeader(f: ZipEntry): Uint8Array {
  const b = new Uint8Array(30 + f.name.length), v = new DataView(b.buffer)
  u32(v, 0, 0x04034b50); u16(v, 4, 20); u16(v, 6, FLAGS); u16(v, 8, 0); u16(v, 10, f.time); u16(v, 12, f.date)
  u16(v, 26, f.name.length); b.set(f.name, 30) // CRC and sizes stay 0 here: see the descriptor
  return b
}
function dataDescriptor(f: ZipEntry): Uint8Array {
  const b = new Uint8Array(16), v = new DataView(b.buffer)
  u32(v, 0, 0x08074b50); u32(v, 4, f.crc); u32(v, 8, f.size); u32(v, 12, f.size)
  return b
}
function centralDirectory(files: ZipEntry[], at: number): Uint8Array {
  const size = files.reduce((n, f) => n + 46 + f.name.length, 0)
  const b = new Uint8Array(size + 22), v = new DataView(b.buffer)
  let p = 0
  for (const f of files) {
    u32(v, p, 0x02014b50); u16(v, p + 4, 20); u16(v, p + 6, 20); u16(v, p + 8, FLAGS); u16(v, p + 10, 0); u16(v, p + 12, f.time); u16(v, p + 14, f.date)
    u32(v, p + 16, f.crc); u32(v, p + 20, f.size); u32(v, p + 24, f.size); u16(v, p + 28, f.name.length)
    u32(v, p + 42, f.offset); b.set(f.name, p + 46)
    p += 46 + f.name.length
  }
  u32(v, p, 0x06054b50); u16(v, p + 8, files.length); u16(v, p + 10, files.length); u32(v, p + 12, size); u32(v, p + 16, at)
  return b
}

// The photos for these pids, in the order asked: in R2's table, not hidden. Unknown pids are left out.
export async function photosByPid(c: any, pids: string[], eventId = 1): Promise<ZipPhoto[]> {
  const ok = [...new Set((pids || []).map(String))].filter(p => PID_RE.test(p))
  const by = new Map<string, ZipPhoto>()
  for (let i = 0; i < ok.length; i += 90) {
    const ch = ok.slice(i, i + 90)
    for (const r of await all(c, `SELECT id, pid, drive_id, event_id, title, day, taken_at, bytes FROM event_photos WHERE event_id = ? AND hidden = 0 AND pid IN (${ch.map(() => '?').join(',')})`, eventId, ...ch)) by.set(String(r.pid), r)
  }
  return ok.map(p => by.get(p)).filter(Boolean) as ZipPhoto[]
}

// Streams one ZIP of these photos' originals. The caller has checked they are the person's own,
// within the limits above. A photo that turns out missing or a different size stops the
// download (the browser shows it failed) rather than giving a broken file.
export function photosZip(c: any, photos: ZipPhoto[], fileName: string): Response {
  const enc = new TextEncoder(), used = new Set<string>()
  let at = 0
  const files: ZipEntry[] = photos.map(p => {
    const base = downloadName(p.title)
    let name = base, k = 2
    while (used.has(name.toLowerCase())) name = base.replace(/\.jpg$/, `-${k++}.jpg`)
    used.add(name.toLowerCase())
    const [time, date] = dosStamp(p.taken_at, p.day)
    const f: ZipEntry = { key: photoKey(Number(p.event_id), p.pid, 'o'), name: enc.encode(name), size: Number(p.bytes), time, date, crc: 0, offset: at }
    at += 30 + f.name.length + f.size + 16
    return f
  })
  const total = at + files.reduce((n, f) => n + 46 + f.name.length, 0) + 22
  const Fixed = (globalThis as any).FixedLengthStream
  const { readable, writable } = Fixed ? new Fixed(total) : new TransformStream()
  const pump = (async () => {
    const w = writable.getWriter()
    try {
      for (const f of files) {
        const obj = await c.env.UPLOADS.get(f.key)
        if (!obj || !obj.body) throw new Error('not in the bucket: ' + f.key)
        await w.write(localHeader(f))
        const r = obj.body.getReader()
        let crc = 0, n = 0
        for (;;) {
          const { done, value } = await r.read()
          if (done) break
          const u = value instanceof Uint8Array ? value : new Uint8Array(value)
          crc = crc32(u, crc); n += u.length
          await w.write(u)
        }
        if (n !== f.size) throw new Error(`size ${n}, not ${f.size}: ${f.key}`)
        f.crc = crc
        await w.write(dataDescriptor(f))
      }
      await w.write(centralDirectory(files, at))
      await w.close()
    } catch (e) { try { await w.abort(e) } catch { /* already closed */ } }
  })()
  try { c.executionCtx.waitUntil(pump) } catch { /* no execution context (tests): reading the body drives it */ }
  const h: Record<string, string> = { ...NOINDEX, 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${fileName}"`, 'Cache-Control': 'private, no-store' }
  if (!Fixed) h['Content-Length'] = String(total)
  return new Response(readable, { headers: h })
}

// What a person sees when a full-size save is refused: a page, in plain words. A small
// or medium image that is refused answers with a bare status (it sits in an <img>).
type Why = 'broken' | 'expired' | 'gone' | 'off' | 'too-many'
function refusePage(why: Why): string {
  const say: Record<Why, [string, string]> = {
    broken: ['This photo link is not complete', 'Please open your photos page again and tap the photo there.'],
    expired: ['This photo link has expired', 'Please open your photos page again from your email or the app. It gives you fresh links.'],
    gone: ['This photo is no longer available', 'It may have been taken down. Your other photos are still on your photos page.'],
    off: ['Photos are not available right now', 'Please try again in a little while.'],
    'too-many': ['Too many photos in one go', `Please go back to your photos page and save them from there. It splits them into downloads of up to ${ZIP_MAX_PHOTOS} photos.`],
  }
  const [h, p] = say[why]
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Photos</title></head>
<body style="font-family:Segoe UI,Roboto,Arial,sans-serif;max-width:560px;margin:60px auto;padding:0 16px;color:#1e2140"><h1 style="font-size:22px">${h}</h1>
<p style="line-height:1.6">${p}</p>
<p><a href="${SITE}/" style="color:#C84F00;font-weight:bold">Bharat AI Innovation</a></p></body></html>`
}
const NOINDEX = { 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' }
export function refuse(status: number, original: boolean, why: Why): Response {
  if (!original) return new Response(null, { status, headers: { ...NOINDEX, 'Cache-Control': 'no-store' } })
  return new Response(refusePage(why), { status, headers: { ...NOINDEX, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
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
    await recordSaves(c, person, [Number(row.id)])
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

// How many photos are in, by day; how many people saved how many (speakers' albums and
// attendees apart).
st.get('/api/admin/event-photos', async (c) => {
  const ev = Number(c.req.query('event') || 1)
  try {
    const days = await all(c, 'SELECT day, COUNT(*) AS photos, SUM(hidden) AS hidden, SUM(highlight) AS highlights, SUM(raw) AS raw, SUM(bytes) AS bytes FROM event_photos WHERE event_id = ? GROUP BY day ORDER BY day', ev)
    const SPEAKER_SQL = "(d.person GLOB 's[0-9]*' OR d.person GLOB 't[0-9]*' OR d.person GLOB 'g[0-9]*')"
    const sum = async (where: string) => (await c.env.DB.prepare(`SELECT COUNT(DISTINCT d.person) AS people, COUNT(*) AS photos, COALESCE(SUM(d.times), 0) AS saves FROM photo_downloads d JOIN event_photos p ON p.id = d.photo_id WHERE p.event_id = ?${where}`).bind(ev).first()) as any
    const n = (r: any) => ({ people: Number(r?.people || 0), photos: Number(r?.photos || 0), saves: Number(r?.saves || 0) })
    const [everyone, speakers] = await Promise.all([sum(''), sum(' AND ' + SPEAKER_SQL)])
    return c.json({ days, downloads: { ...n(everyone), speakers: n(speakers) }, signing: !!secretOf(c), bucket: !!c.env.UPLOADS })
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
    const rs = await all(c, `SELECT pid, title, day, taken_at, camera, hall, width, height, bytes, raw, hidden, highlight FROM event_photos WHERE ${where.join(' AND ')} ORDER BY day, CASE WHEN taken_at = '' THEN 1 ELSE 0 END, taken_at, title LIMIT ? OFFSET ?`, ...args, size, offset)
    const photos = []
    for (const r of rs) photos.push({ ...(await linksOf(c, ADMIN_PERSON, r, 2)), title: r.title, camera: r.camera, hall: r.hall, raw: !!r.raw, hidden: !!r.hidden, highlight: !!r.highlight })
    return c.json({ total, offset, size, photos })
  } catch { return c.json(NO_TABLES, 503) }
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
