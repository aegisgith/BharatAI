import { Hono } from 'hono'
import { personFor, photoSig } from './photos'

// ==================== PHOTOS EMAIL: OPENED, VISITED, SAVED (23 Nov 2026) ====================
//
// The organiser: "how do we know if someone opened the email, clicked the link for the
// photos, downloaded them?" Three marks per album (speaker 's'/'t', guest 'g', attendee 'a'),
// shown on Admin -> After the Event beside each "Sent":
//
// - Opened: a 1x1 picture in the photos email (/photos/<key>/o.gif?k=<the page signature>).
//   Only emails sent after this went live carry it (app_settings photo_open_marks_from, set on
//   the first email that carries it). Approximate: some mail apps block pictures, Apple Mail
//   loads them for everyone.
// - Visited: their own page /photos/<key> reports itself once it has been on screen for a
//   moment (a beacon from the page's own script, so a mail scanner that only fetches the link
//   is not counted). Counted from photo_visit_marks_from, set on the first visit or the first
//   Admin load after this went live. The organiser's "Open their page" adds by=admin and is
//   never counted.
// - Saved: full-size saves, already recorded by the photo store (photo_downloads).
//
// Opened and Visited are admin_audit rows (entity 'photo_album', entity_id the album key),
// one per person and kind, detail {"n": times, "last": UTC time}; created_at is the first.
// Nothing here changes routes/photos.ts: the page is passed through photoPageBeacon (a
// middleware in front of it) and the email through withOpenPixel (in the sendEmail hook).

export const OPENED = 'photos.opened', VISITED = 'photos.visited'
const OPEN_FROM = 'photo_open_marks_from', VISIT_FROM = 'photo_visit_marks_from'
const SITE = 'https://bharataiinnovation.com'
const KEY_RE = /^[a-z]\d{1,7}$/
// A transparent 1x1 GIF.
const GIF = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), ch => ch.charCodeAt(0))
const nowUtc = () => new Date().toISOString().slice(0, 19).replace('T', ' ')

function sameText(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}
// The album a key and signature open, as its own key ('s28' and 't26' can be one person).
async function albumOf(c: any, key: string, k: string): Promise<string> {
  if (!KEY_RE.test(key) || !/^[0-9a-f]{32}$/.test(k)) return ''
  const p = personFor(key)
  if (!p) return ''
  return sameText(await photoSig(c, key), k) ? String(p.key || key) : ''
}
async function stampOnce(c: any, name: string): Promise<void> {
  try { await c.env.DB.prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)').bind(name, nowUtc()).run() } catch { /* no settings table */ }
}
async function setting(c: any, name: string): Promise<string> {
  try { return String(((await c.env.DB.prepare('SELECT value FROM app_settings WHERE key = ?').bind(name).first()) as any)?.value || '') } catch { return '' }
}
// One more open or visit: the person's row counts up, or is written the first time.
async function mark(c: any, action: string, album: string): Promise<void> {
  const db = c.env.DB, at = nowUtc()
  try {
    const row: any = await db.prepare("SELECT id, detail FROM admin_audit WHERE action = ? AND entity = 'photo_album' AND entity_id = ? ORDER BY id LIMIT 1").bind(action, album).first()
    if (row) {
      let n = 1
      try { n = Number(JSON.parse(row.detail || '{}').n) || 1 } catch { /* not JSON */ }
      await db.prepare('UPDATE admin_audit SET detail = ? WHERE id = ?').bind(JSON.stringify({ n: n + 1, last: at }), row.id).run()
    } else {
      await db.prepare("INSERT INTO admin_audit (actor, actor_kind, action, entity, entity_id, detail) VALUES ('recipient', 'public', ?, 'photo_album', ?, ?)")
        .bind(action, album, JSON.stringify({ n: 1, last: at })).run()
    }
  } catch { /* a mark that cannot be written is lost; the page and picture still answer */ }
}

// ---- the email: one small picture, from the page link the email already carries ----
const LINK_RE = /\/photos\/([a-z]\d{1,7})\?k=([0-9a-f]{32})/
export async function withOpenPixel(c: any, html: string): Promise<string> {
  const m = LINK_RE.exec(String(html || ''))
  if (!m) return html
  await stampOnce(c, OPEN_FROM)
  const img = `<img src="${SITE}/photos/${m[1]}/o.gif?k=${m[2]}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;margin:0;padding:0">`
  const at = html.toLowerCase().lastIndexOf('</body>')
  return at >= 0 ? html.slice(0, at) + img + html.slice(at) : html + img
}

// ---- the page: report a visit once it has been seen ----
// Put at the START of the page's own script (the page keeps one script), so nothing the
// page's code does later can stop it; or as its own script if the page has none.
const BEACON = `;(function(){try{var q=location.search;if(/[?&]by=admin(&|$)/.test(q))return;var sent=false;`
  + `function go(){if(sent||document.visibilityState==='hidden')return;sent=true;var u=location.pathname.replace(/\\/+$/,'')+'/seen'+q;`
  + `if(navigator.sendBeacon){navigator.sendBeacon(u)}else{fetch(u,{method:'POST',keepalive:true})}}`
  + `setTimeout(go,1500);document.addEventListener('visibilitychange',function(){setTimeout(go,1500)})}catch(e){}})();`
export async function photoPageBeacon(c: any, next: () => Promise<void>) {
  await next()
  if (c.req.method !== 'GET' || c.res.status !== 200 || !/text\/html/i.test(c.res.headers.get('content-type') || '')) return
  const html = await c.res.text()
  const open = html.lastIndexOf('<script'), close = html.lastIndexOf('</script>')
  const start = open >= 0 ? html.indexOf('>', open) + 1 : 0
  const tag = open >= 0 ? html.slice(open, start) : ''
  let out: string
  if (open >= 0 && start > open && close > start && !/application\/json|\bsrc=/i.test(tag)) {
    // After a "use strict" directive, if the script opens with one, so it stays a directive.
    const strict = /^\s*(['"])use strict\1;?/.exec(html.slice(start, close))
    const at = start + (strict ? strict[0].length : 0)
    out = html.slice(0, at) + BEACON + '\n' + html.slice(at)
  } else {
    const b = html.toLowerCase().lastIndexOf('</body>')
    const s = '<script>' + BEACON + '</script>'
    out = b >= 0 ? html.slice(0, b) + s + html.slice(b) : html + s
  }
  const h = new Headers(c.res.headers)
  h.delete('content-length')
  c.res = undefined
  c.res = new Response(out, { status: 200, headers: h })
}

const pt = new Hono<{ Bindings: any }>()

pt.get('/photos/:key/o.gif', async (c) => {
  const album = await albumOf(c, c.req.param('key'), String(c.req.query('k') || ''))
  if (album) await mark(c, OPENED, album)
  return new Response(GIF, { status: 200, headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, private', 'X-Robots-Tag': 'noindex' } })
})

pt.post('/photos/:key/seen', async (c) => {
  if (c.req.query('by') === 'admin') return new Response(null, { status: 204 })
  const album = await albumOf(c, c.req.param('key'), String(c.req.query('k') || ''))
  if (!album) return new Response(null, { status: 404 })
  await stampOnce(c, VISIT_FROM)
  await mark(c, VISITED, album)
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
})

// Admin -> After the Event: the three marks for every album, by its key.
pt.get('/api/admin/photo-tracking', async (c) => {
  await stampOnce(c, VISIT_FROM)
  const db = c.env.DB
  const all = async (sql: string) => { try { return (((await db.prepare(sql).all()) as any).results || []) as any[] } catch { return [] as any[] } }
  const [marks, sends, saves, openFrom, visitFrom] = await Promise.all([
    all(`SELECT action, entity_id, detail, created_at FROM admin_audit WHERE entity = 'photo_album' AND action IN ('${OPENED}', '${VISITED}')`),
    all("SELECT entity_id, MAX(created_at) AS last_sent FROM admin_audit WHERE action IN ('speaker.photos', 'attendee.photos') GROUP BY entity_id"),
    all("SELECT person, COUNT(*) AS photos, SUM(times) AS times, MAX(last_at) AS last_at FROM photo_downloads WHERE person <> 'admin' GROUP BY person"),
    setting(c, OPEN_FROM), setting(c, VISIT_FROM)])
  type One = { opened: number; opened_first: string; opened_last: string; visits: number; visited_first: string; visited_last: string; saved: number; saved_last: string; open_tracked: boolean }
  const people: Record<string, One> = {}
  const one = (key: string): One => (people[key] ||= { opened: 0, opened_first: '', opened_last: '', visits: 0, visited_first: '', visited_last: '', saved: 0, saved_last: '', open_tracked: false })
  const albumKey = (k: string) => String(personFor(k)?.key || k)
  for (const m of marks) {
    let d: any = {}
    try { d = JSON.parse(m.detail || '{}') } catch { /* not JSON */ }
    const p = one(albumKey(String(m.entity_id))), n = Number(d.n) || 1, last = String(d.last || m.created_at || '')
    if (m.action === OPENED) { p.opened += n; p.opened_first = p.opened_first && p.opened_first < m.created_at ? p.opened_first : String(m.created_at || ''); if (last > p.opened_last) p.opened_last = last }
    else { p.visits += n; p.visited_first = p.visited_first && p.visited_first < m.created_at ? p.visited_first : String(m.created_at || ''); if (last > p.visited_last) p.visited_last = last }
  }
  for (const s of saves) {
    const p = one(albumKey(String(s.person)))
    p.saved += Number(s.photos) || 0
    if (String(s.last_at || '') > p.saved_last) p.saved_last = String(s.last_at || '')
  }
  // An open can only be seen for an email that carried the picture.
  for (const s of sends) if (openFrom && String(s.last_sent || '') >= openFrom) one(albumKey(String(s.entity_id))).open_tracked = true
  return c.json({ open_from: openFrom, visit_from: visitFrom, people })
})

export default pt
