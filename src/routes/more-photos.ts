import { Hono } from 'hono'
import ATTENDEES from '../data/attendee-photos.json'
import LATE from '../data/late-photos.json'
import { personFor, pageUrl, hiddenPhotos, AUDIT_ACTION, ATT_SENT, NOT_ME, OPT_OUT } from './photos'
import { linksForDrive } from './photo-store'
import { boothPhotoCompanies, boothPhotosNow, boothContact, BOOTH_AUDIT } from './exhibitor-photos'
import { MUMBAI_WORDS } from './conference'
import { dearName } from './talk-brief'

// ==================== "WE FOUND MORE PHOTOS OF YOU" (23 Nov 2026) ====================
//
// The organiser: "if you find new additional photos of some users, we need to send a new
// email with an alert: found your new photos".
//
// Albums grow after their photos email went: 566 photos were missing from the first Drive
// listing, burst shots were added, booth names were read in more photos. Every photos email
// records how many photos it showed (admin_audit detail.count: speaker.photos,
// attendee.photos, booth_photos.sent). This compares that number with the album now and
// lists everyone whose album has grown. One short email each, to the SAME address the first
// one went to, with a few of the new photos (small size only) and the button to their page
// (a booth: to the exhibitor dashboard). Sent from Admin -> After the Event -> More photos
// found, never by itself. Each send is recorded as MORE_AUDIT with the new count, so the
// next run only counts what came after it.

type Hooks = {
  sendEmail?: (c: any, to: string, subject: string, html: string, opts?: any) => Promise<any>
  emailHeader?: (title: string, subtitle: string) => string
  audit?: (c: any, action: string, entity: string, entityId: any, detail?: any) => Promise<any>
  // The exhibitor dashboard sign-in link that lands on Booth photos (routes/marketplace.ts).
  boothLink?: (c: any, exhibitorIds: number[], email: string) => Promise<string>
}
let hooks: Hooks = {}
export function configureMorePhotos(h: Hooks) { hooks = { ...hooks, ...h } }

export const MORE_AUDIT = 'photos.more'
const mp = new Hono<{ Bindings: any }>()
const SITE = 'https://bharataiinnovation.com'
const escH = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const ATT = ATTENDEES as unknown as { albums: Record<string, { photos: string[]; best: string[] }> }
const LATE_IDS = new Set<string>(((LATE as any).ids || []) as string[])
const all = async (c: any, sql: string, ...args: any[]) => (((await c.env.DB.prepare(sql).bind(...args).all()) as any).results || []) as any[]

type Kind = 'speaker' | 'attendee' | 'booth'
export type MoreRow = { key: string; kind: Kind; name: string; to: string; was: number; now: number; added: number; first_at: string; last_at: string; status: string }

// The last count each album was emailed with, and to whom (the first email or a later one).
async function sentCounts(c: any) {
  const out = new Map<string, { kind: Kind; to: string; was: number; first_at: string; last_at: string; name: string }>()
  const rows = await all(c, 'SELECT action, entity, entity_id, detail, created_at FROM admin_audit WHERE action IN (?, ?, ?, ?) ORDER BY id', AUDIT_ACTION, ATT_SENT, BOOTH_AUDIT, MORE_AUDIT).catch(() => [] as any[])
  for (const r of rows) {
    let d: any = {}
    try { d = JSON.parse(r.detail || '{}') } catch { /* not JSON */ }
    const key = String(r.entity_id || '')
    const kind: Kind = r.action === BOOTH_AUDIT || (r.action === MORE_AUDIT && r.entity === 'booth_photos') ? 'booth' : r.action === ATT_SENT || /^a\d+$/.test(key) ? 'attendee' : 'speaker'
    const was = Number(d.count ?? d.photos ?? 0) || 0
    const prev = out.get(key)
    out.set(key, { kind, to: String(d.to || prev?.to || ''), was, first_at: prev ? prev.first_at : String(r.created_at || ''), last_at: String(r.created_at || ''), name: String(d.name || prev?.name || '') })
  }
  return out
}

// What an album holds now, counted the way its first email counted it.
async function countsNow(c: any, keys: Map<string, { kind: Kind }>) {
  const hidden = await hiddenPhotos(c)
  const notMe = new Map<string, Set<string>>(); const out = new Set<string>()
  for (const r of await all(c, 'SELECT action, entity_id, detail FROM admin_audit WHERE action IN (?, ?)', NOT_ME, OPT_OUT).catch(() => [] as any[])) {
    const k = String(r.entity_id)
    if (r.action === OPT_OUT) { out.add(k); continue }
    try { const d = JSON.parse(r.detail || '{}'); if (d.photo) { const s = notMe.get(k) || new Set<string>(); s.add(String(d.photo)); notMe.set(k, s) } } catch { /* not JSON */ }
  }
  const now = new Map<string, { ids: string[]; optedOut: boolean }>()
  for (const [key, v] of keys) {
    if (v.kind === 'booth') { now.set(key, { ids: await boothPhotosNow(c, key), optedOut: false }); continue }
    const p = v.kind === 'attendee' ? (ATT.albums[key] ? { photos: ATT.albums[key].photos } : null) : personFor(key)
    const nm = notMe.get(key)
    const ids = (p ? p.photos : []).filter(id => !(hidden && hidden.has(id)) && !(nm && nm.has(id)))
    now.set(key, { ids, optedOut: out.has(key) })
  }
  return now
}

export async function moreRows(c: any): Promise<MoreRow[]> {
  const sent = await sentCounts(c)
  const now = await countsNow(c, sent)
  const attIds = [...sent.keys()].filter(k => /^a\d+$/.test(k)).map(k => Number(k.slice(1)))
  const people = new Map<number, any>()
  for (let i = 0; i < attIds.length; i += 90) {
    const ch = attIds.slice(i, i + 90)
    for (const a of await all(c, `SELECT id, name, unsubscribed_at FROM attendees WHERE id IN (${ch.map(() => '?').join(',')})`, ...ch).catch(() => [] as any[])) people.set(Number(a.id), a)
  }
  const rows: MoreRow[] = []
  for (const [key, s] of sent) {
    const n = now.get(key)!
    const a = s.kind === 'attendee' ? people.get(Number(key.slice(1))) : null
    const name = s.kind === 'booth' ? (boothPhotoCompanies()[key]?.name || key) : s.kind === 'attendee' ? String(a?.name || '') : (s.name || personFor(key)?.name || key)
    const added = n.ids.length - s.was
    const status = n.optedOut ? 'opted-out' : a && a.unsubscribed_at ? 'unsubscribed' : !s.to.includes('@') ? 'no-email' : added > 0 ? 'more' : 'same'
    rows.push({ key, kind: s.kind, name, to: s.to, was: s.was, now: n.ids.length, added: Math.max(0, added), first_at: s.first_at, last_at: s.last_at, status })
  }
  rows.sort((x, y) => (x.status === 'more' ? 0 : 1) - (y.status === 'more' ? 0 : 1) || y.added - x.added || x.name.localeCompare(y.name))
  return rows
}

export function morePhotosEmailHTML(a: { name: string; booth: boolean; company: string; added: number; total: number; thumbs: string[]; href: string; header: string }): { subject: string; html: string } {
  const w = MUMBAI_WORDS
  const more = `${a.added} more photo${a.added === 1 ? '' : 's'}`
  const subject = a.booth ? `We found ${more} of ${a.company}` : `We found ${more} of you`
  const pics = a.thumbs.slice(0, 4)
  const rows: string[] = []
  for (let i = 0; i < pics.length; i += 2) rows.push(`<tr>${pics.slice(i, i + 2).map(u => `<td style="padding:4px;width:50%"><img src="${escH(u)}" alt="" width="270" style="display:block;width:100%;height:auto;border-radius:8px"></td>`).join('')}</tr>`)
  const what = a.booth ? `${escH(a.company)}` : 'you'
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f6f7fb;padding:24px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1e2140">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e7e9f5">
    ${a.header}
    <div style="padding:26px 26px 8px">
      <p style="font-size:15px;line-height:1.65;margin:0 0 14px">${escH(a.name ? `Dear ${dearName(a.name)},` : `Dear ${a.company} team,`)}</p>
      <p style="font-size:15px;line-height:1.65;margin:0 0 14px">Good news: since our last email, we found <strong>${escH(more)}</strong> of ${what} from ${escH(w.name)} in Mumbai. More of the photographers' photos came in, and we looked through every one again. ${a.booth ? 'Your booth photos' : 'Your album'} now has ${escH(String(a.total))} photos.</p>
      ${rows.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px">${rows.join('')}</table>` : ''}
      <p style="margin:0 0 20px;text-align:center"><a href="${escH(a.href)}" style="display:inline-block;padding:13px 26px;background:#C84F00;color:#fff;text-decoration:none;border-radius:10px;font-weight:bold;font-size:15px">See all ${escH(String(a.total))} photos</a></p>
      <p style="font-size:13px;line-height:1.6;margin:0 0 12px;color:#6b7280">${a.booth ? 'The button signs you in to your exhibitor dashboard, at Booth photos. No password is needed.' : 'The same page as before: save any photo at full size. If a photo is not you, tap &ldquo;Not me&rdquo; under it.'}</p>
      <p style="font-size:14px;line-height:1.65;margin:16px 0 0">See you at Bharat AI Innovation, New Delhi: 28 and 29 July 2027 at Bharat Mandapam. <a href="${SITE}/delhi" style="color:#C84F00;font-weight:bold">See the Delhi edition</a></p>
      <p style="margin:22px 0 24px;font-size:14px;color:#555">Team Bharat AI Innovation<br>
        <span style="color:#888">${escH(w.line).replace(' · ', ' &middot; ')}</span></p>
    </div>
  </div></body></html>`
  return { subject, html }
}

// The new photos first (the late-found ones), then the rest of the album; small size only.
async function mailFor(c: any, r: MoreRow, preview: boolean) {
  const header = hooks.emailHeader ? hooks.emailHeader('More photos of you', MUMBAI_WORDS.line) : ''
  if (r.kind === 'booth') {
    const ids = await boothPhotosNow(c, r.key)
    const pick = [...ids.filter(id => LATE_IDS.has(id)), ...ids.filter(id => !LATE_IDS.has(id))].slice(0, 4)
    const co = boothPhotoCompanies()[r.key]
    const got = await linksForDrive(c, 'x' + Number(co.ids[0]), pick)
    const contact = await boothContact(c, r.key)
    const href = preview || !hooks.boothLink ? SITE + '/marketplace/dashboard#photos' : await hooks.boothLink(c, co.ids, r.to)
    return morePhotosEmailHTML({ name: contact?.name || '', booth: true, company: contact?.company || co.name, added: r.added, total: r.now, thumbs: pick.filter(id => got[id]).map(id => got[id].m), href, header })
  }
  const p = r.kind === 'attendee' ? (ATT.albums[r.key] ? { photos: ATT.albums[r.key].photos, best: ATT.albums[r.key].best } : null) : personFor(r.key)
  const ids = p ? p.photos : []
  const pick = [...ids.filter(id => LATE_IDS.has(id)), ...(p ? p.best : []).filter(id => !LATE_IDS.has(id))].filter((id, i, a) => a.indexOf(id) === i).slice(0, 4)
  const got = await linksForDrive(c, r.key, pick)
  const href = preview ? '#preview' : await pageUrl(c, r.key)
  return morePhotosEmailHTML({ name: r.name, booth: false, company: '', added: r.added, total: r.now, thumbs: pick.filter(id => got[id]).map(id => got[id].m), href, header })
}

mp.get('/api/admin/more-photos', async (c) => {
  const rows = await moreRows(c)
  return c.json({ rows, ready: rows.filter(r => r.status === 'more').length, photos: rows.filter(r => r.status === 'more').reduce((n, r) => n + r.added, 0) })
})

mp.get('/api/admin/more-photos/:key/preview', async (c) => {
  const r = (await moreRows(c)).find(x => x.key === c.req.param('key'))
  if (!r) return c.json({ error: 'No photos email has gone to that album yet.' }, 404)
  const m = await mailFor(c, r, true)
  return c.json({ to: r.to, subject: m.subject, html: m.html, added: r.added, status: r.status })
})

mp.post('/api/admin/more-photos/:key/send', async (c) => {
  const r = (await moreRows(c)).find(x => x.key === c.req.param('key'))
  if (!r) return c.json({ error: 'No photos email has gone to that album yet.' }, 404)
  if (r.status === 'opted-out') return c.json({ error: r.name + ' asked us not to match their photos.' }, 409)
  if (r.status === 'unsubscribed') return c.json({ error: r.name + ' unsubscribed from our emails.' }, 409)
  if (r.status === 'no-email') return c.json({ error: 'There is no address for ' + r.name + '.' }, 409)
  if (r.status !== 'more') return c.json({ error: 'No new photos of ' + r.name + ' since the last email.', already: true }, 409)
  if (!hooks.sendEmail) return c.json({ error: 'Email is not set up on this server.' }, 503)
  const m = await mailFor(c, r, false)
  const sent = await hooks.sendEmail(c, r.to, m.subject, m.html, { unsubscribe: r.kind === 'attendee' })
  if (sent && sent.ok === false) return c.json({ error: sent.error || 'The email did not go.' }, 502)
  try { await hooks.audit?.(c, MORE_AUDIT, r.kind === 'booth' ? 'booth_photos' : 'photo_album', r.key, { to: r.to, count: r.now, added: r.added, kind: r.kind, name: r.name }) } catch { /* sent either way */ }
  return c.json({ success: true, to: r.to, added: r.added, count: r.now })
})

export default mp
