import { Hono } from 'hono'
import { MUMBAI_WORDS } from './conference'
import { dearName } from './talk-brief'
import ATTENDEES from '../data/attendee-photos.json'

// ==================== "FIND YOURSELF IN THE PHOTOS" (23 Nov 2026) ====================
//
// The organiser: "did u find people who did not sign in with qr code at venue but attended
// ... we should send them their photo, this will have better engagement post event", then
// chose to email everyone registered for Mumbai who has not been found yet.
//
// The photos are found by matching the profile photo in the app (scripts/photos/att_match.py),
// so someone with no photo there, or an old or tiny one, cannot be found. This email asks
// them to add a clear photo of themselves; the next matching run finds them, and their own
// photos email (Admin -> After the Event -> Attendee photos) follows. It says what the photo
// is used for, and that they can remove it.
//
// A bulk run of kind 'find_photos' (index.tsx campaigns, the minute clock): the audience is
// everyone on event 1 with an email who is not in src/data/attendee-photos.json, has not
// unsubscribed and has not said "Don't match my photos". This route sends one.

type Hooks = {
  sendEmail?: (c: any, to: string, subject: string, html: string) => Promise<{ ok: boolean; error?: string }>
  emailHeader?: (title: string, subtitle: string) => string
  // The app link that signs them in and opens their profile, photo first (index.tsx).
  profileLink?: (c: any, eventId: number, email: string) => Promise<string>
}
let hooks: Hooks = {}
export function configureFindPhotos(h: Hooks) { hooks = { ...hooks, ...h } }

const fp = new Hono<{ Bindings: any }>()
const SITE = 'https://bharataiinnovation.com'
const escH = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const ATT = ATTENDEES as unknown as { albums: Record<string, unknown>; photos: Record<string, unknown> }

// Attendee ids already found (their photos email covers them).
export const FOUND_IDS: number[] = Object.keys(ATT.albums || {}).map(k => Number(k.slice(1))).filter(n => Number.isInteger(n) && n > 0)

// The audience, as SQL for the campaign: event 1, an email, not found, not unsubscribed,
// not opted out. The ids are ours (from the data file), never from a request.
export function findPhotosWhereSql(): string {
  const found = FOUND_IDS.length ? ` AND id NOT IN (${FOUND_IDS.join(',')})` : ''
  return `email IS NOT NULL AND TRIM(email) != '' AND email NOT LIKE '%@no-email.invalid' AND unsubscribed_at IS NULL${found}`
    + ` AND ('a' || id) NOT IN (SELECT entity_id FROM admin_audit WHERE action = 'photos.opt_out' AND entity_id IS NOT NULL)`
}

export function findPhotosEmailHTML(a: { name: string; href: string; header: string; photos: number }): { subject: string; html: string } {
  const w = MUMBAI_WORDS
  const subject = `Are you in the ${w.name} photos?`
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f6f7fb;padding:24px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1e2140">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e7e9f5">
    ${a.header}
    <div style="padding:26px 26px 8px">
      <p style="font-size:15px;line-height:1.65;margin:0 0 14px">${escH(`Dear ${dearName(a.name)},`)}</p>
      <p style="font-size:15px;line-height:1.65;margin:0 0 14px">Our photographers took more than ${escH(a.photos.toLocaleString('en-IN'))} photos at ${escH(w.name)} in Mumbai. If you were there, you may well be in some of them.</p>
      <p style="font-size:15px;line-height:1.65;margin:0 0 20px">Add a clear photo of yourself in the event app, and we will find every photo you are in and email them to you, to keep and share.</p>
      <p style="margin:0 0 20px;text-align:center"><a href="${escH(a.href)}" style="display:inline-block;padding:13px 26px;background:#C84F00;color:#fff;text-decoration:none;border-radius:10px;font-weight:bold;font-size:15px">Add my photo</a></p>
      <p style="font-size:13px;line-height:1.6;margin:0 0 12px;color:#6b7280">The button signs you in to the app. We use your photo to find you in the event photos; it also shows on your profile in the app, as before. You can change or remove it there at any time.</p>
      <p style="font-size:14px;line-height:1.65;margin:16px 0 0">See you at Bharat AI Innovation, New Delhi: 28 and 29 July 2027 at Bharat Mandapam. <a href="${SITE}/delhi" style="color:#C84F00;font-weight:bold">See the Delhi edition</a></p>
      <p style="margin:22px 0 24px;font-size:14px;color:#555">Team Bharat AI Innovation<br>
        <span style="color:#888">${escH(w.line).replace(' · ', ' &middot; ')}</span></p>
    </div>
  </div></body></html>`
  return { subject, html }
}

async function mailFor(c: any, a: any, preview: boolean) {
  const href = preview ? '#preview' : (hooks.profileLink ? await hooks.profileLink(c, 1, String(a.email).trim().toLowerCase()) : `${SITE}/app`)
  const header = hooks.emailHeader ? hooks.emailHeader('Find yourself in the photos', MUMBAI_WORDS.line) : ''
  return findPhotosEmailHTML({ name: String(a.name || ''), href, header, photos: 4600 })
}

// One person (the campaign's send route). Skips, never fails, anyone who no longer fits.
fp.post('/api/admin/attendees/:id/send-find-photos', async (c) => {
  const a = await c.env.DB.prepare('SELECT id, event_id, name, email, unsubscribed_at FROM attendees WHERE id = ?').bind(c.req.param('id')).first() as any
  if (!a) return c.json({ error: 'Attendee not found' }, 404)
  if (Number(a.event_id) !== 1) return c.json({ skipped: true, reason: 'Not a Mumbai registration' })
  if (!a.email || /@no-email\.invalid$/i.test(String(a.email))) return c.json({ skipped: true, reason: 'No email address' })
  if (a.unsubscribed_at) return c.json({ skipped: true, reason: 'Unsubscribed' })
  if (FOUND_IDS.includes(Number(a.id))) return c.json({ skipped: true, reason: 'Already found: their photos email covers them' })
  const out = await c.env.DB.prepare("SELECT 1 AS y FROM admin_audit WHERE action = 'photos.opt_out' AND entity_id = ?").bind('a' + a.id).first().catch(() => null)
  if (out) return c.json({ skipped: true, reason: 'Asked not to be matched' })
  if (!hooks.sendEmail) return c.json({ error: 'Email is not set up on this server.' }, 503)
  const mail = await mailFor(c, a, false)
  const sent = await hooks.sendEmail(c, String(a.email).trim(), mail.subject, mail.html)
  if (!sent.ok) return c.json({ error: sent.error || 'The email did not go.' }, 502)
  return c.json({ success: true })
})

// The preview and how many it would go to.
fp.get('/api/admin/find-photos', async (c) => {
  let n = 0
  try { n = Number(((await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM attendees WHERE event_id = 1 AND ${findPhotosWhereSql()}`).first()) as any)?.n || 0) } catch { /* no table */ }
  const mail = await mailFor(c, { name: 'Asha Kumar', email: 'preview@example.com' }, true)
  return c.json({ audience: n, found: FOUND_IDS.length, subject: mail.subject, html: mail.html })
})

export default fp
