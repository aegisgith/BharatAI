import { Hono } from 'hono'
import DATA from '../data/exhibitor-photos.json'
import * as store from './photo-store'
import { MUMBAI_WORDS } from './conference'
import { dearName } from './talk-brief'

// ==================== BOOTH PHOTOS FOR EXHIBITORS (23 Nov 2026) ====================
//
// The organiser: "all exhibitors, even if we don't find the face: find the logos of their
// company, put the photos that match their company's logo in their dashboard and send them
// an email."
//
// scripts/photos/exh_match.py reads the company names printed in every event photo (OCR on
// the organiser's computer): the booth fascia, standees, screens and their own talk slide.
// The stage's side walls carry every exhibitor's logo, so those small logos do not count.
// src/data/exhibitor-photos.json holds the result, by company: every exhibitors row of the
// company (one company can have several), its photos, and the six for the email.
//
// Where they see them: the exhibitor dashboard, Booth photos (/marketplace/dashboard#photos,
// public/static/booth-photos.js). The photos come from R2 with links signed for this company
// ('x<first exhibitor id>'), and "Save all" is one ZIP. One email each to the booth contact,
// sent by the organiser from Admin -> After the Event -> Booth photos. The email has small
// photos only (never a full-size link) and a button that signs them in to the dashboard.

type Company = { name: string; ids: number[]; photos: string[]; best: string[] }
type Hooks = {
  sendEmail?: (c: any, to: string, subject: string, html: string, opts?: any) => Promise<any>
  emailHeader?: (title: string, subtitle: string) => string
  audit?: (c: any, action: string, entity: string, entityId: any, detail?: any) => Promise<any>
  // The signed-in dashboard account's exhibitor (routes/marketplace.ts), or null.
  dashboardExhibitor?: (c: any) => Promise<{ id: number; company_name: string; event_id?: number } | null>
  // A sign-in link to the exhibitor dashboard that lands on Booth photos.
  signInLink?: (c: any, accountId: number) => Promise<string>
}
let hooks: Hooks = {}
export function configureExhibitorPhotos(h: Hooks) { hooks = { ...hooks, ...h } }

const ep = new Hono<{ Bindings: any }>()
const SITE = 'https://bharataiinnovation.com'
export const BOOTH_AUDIT = 'booth_photos.sent'
const escH = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const D = DATA as unknown as { companies: Record<string, Company>; photos: Record<string, [string, string]> }
const COMPANIES = D.companies || {}
const all = async (c: any, sql: string, ...args: any[]) => (((await c.env.DB.prepare(sql).bind(...args).all()) as any).results || []) as any[]
const linksForDrive = store.linksForDrive
// "Save all" as one ZIP needs the photo store's ZIP helpers (photosByPid, photosZip). They
// arrive with the change that removes the save limit; until then there is no ZIP button and
// each photo is saved one by one.
const zipKit = store as unknown as { photosByPid?: (c: any, pids: string[]) => Promise<any[]>; photosZip?: (c: any, photos: any[], fileName: string) => Response; ZIP_MAX_PHOTOS?: number }
const canZip = () => typeof zipKit.photosByPid === 'function' && typeof zipKit.photosZip === 'function'

// The company an exhibitors row belongs to, as [key, company].
export function companyOfExhibitor(exhibitorId: number): [string, Company] | null {
  for (const [k, co] of Object.entries(COMPANIES)) if ((co.ids || []).includes(Number(exhibitorId))) return [k, co]
  return null
}
export const boothPhotoCompanies = () => COMPANIES
// One signer name per company, so a company's links are the same from every row of it.
const personOf = (co: Company) => 'x' + Number(co.ids[0])

// Photos of a company that are in R2 and not hidden, in the album's order.
async function photosOf(c: any, co: Company) {
  const links = await linksForDrive(c, personOf(co), co.photos)
  return co.photos.filter(id => links[id]).map(id => ({ id, ...links[id], day: D.photos[id]?.[0] || links[id].day, time: D.photos[id]?.[1] || '' }))
}

// The booth contact: the company's exhibitors row with a contact email, booked rows first.
async function contactOf(c: any, co: Company) {
  const ids = (co.ids || []).map(Number).filter(n => Number.isInteger(n) && n > 0)
  if (!ids.length) return null
  const rows = await all(c, `SELECT e.id, e.company_name, e.contact_email, e.booth_number, s.contact_name FROM exhibitors e
    LEFT JOIN exhibitor_team_settings s ON s.exhibitor_id = e.id WHERE e.id IN (${ids.map(() => '?').join(',')})`, ...ids).catch(() => [] as any[])
  const withMail = rows.filter(r => String(r.contact_email || '').includes('@'))
  withMail.sort((a, b) => (b.booth_number ? 1 : 0) - (a.booth_number ? 1 : 0) || ids.indexOf(Number(a.id)) - ids.indexOf(Number(b.id)))
  const r = withMail[0] || rows[0]
  return r ? { id: Number(r.id), company: String(r.company_name || co.name), email: String(r.contact_email || '').trim(), name: String(r.contact_name || ''), booth: String(r.booth_number || '') } : null
}

async function sentOf(c: any): Promise<Map<string, { at: string; n: number }>> {
  const rs = await all(c, "SELECT entity_id, MAX(created_at) AS at, COUNT(*) AS n FROM admin_audit WHERE action = ? AND entity = 'booth_photos' GROUP BY entity_id", BOOTH_AUDIT).catch(() => [] as any[])
  return new Map(rs.map(r => [String(r.entity_id), { at: String(r.at || ''), n: Number(r.n) || 0 }]))
}

export function boothPhotosEmailHTML(a: { name: string; company: string; count: number; thumbs: string[]; href: string; header: string }): { subject: string; html: string } {
  const w = MUMBAI_WORDS
  const subject = `${a.company} in the ${w.name} photos`
  const pics = a.thumbs.slice(0, 6)
  const rows: string[] = []
  for (let i = 0; i < pics.length; i += 2) {
    rows.push(`<tr>${pics.slice(i, i + 2).map(u => `<td style="padding:4px;width:50%"><img src="${escH(u)}" alt="" width="270" style="display:block;width:100%;height:auto;border-radius:8px"></td>`).join('')}</tr>`)
  }
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f6f7fb;padding:24px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1e2140">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e7e9f5">
    ${a.header}
    <div style="padding:26px 26px 8px">
      <p style="font-size:15px;line-height:1.65;margin:0 0 14px">${escH(a.name ? `Dear ${dearName(a.name)},` : `Dear ${a.company} team,`)}</p>
      <p style="font-size:15px;line-height:1.65;margin:0 0 14px">Thank you for exhibiting at ${escH(w.name)} in Mumbai. Our photographers took more than 5,000 photos. We found <strong>${escH(a.company)}</strong> in ${escH(String(a.count))} of them: your booth, your banner and your team at work.</p>
      ${rows.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px">${rows.join('')}</table>` : ''}
      <p style="margin:0 0 20px;text-align:center"><a href="${escH(a.href)}" style="display:inline-block;padding:13px 26px;background:#C84F00;color:#fff;text-decoration:none;border-radius:10px;font-weight:bold;font-size:15px">See and save all ${escH(String(a.count))} photos</a></p>
      <p style="font-size:13px;line-height:1.6;margin:0 0 12px;color:#6b7280">The button signs you in to your exhibitor dashboard, at Booth photos. No password is needed. You can save each photo at full size, or all of them at once.</p>
      <p style="font-size:14px;line-height:1.65;margin:0 0 12px">Please use them on LinkedIn, your website and your newsletters, and tag <strong>#BharatAIInnovation</strong>.</p>
      <p style="font-size:14px;line-height:1.65;margin:16px 0 0">See you at Bharat AI Innovation, New Delhi: 28 and 29 July 2027 at Bharat Mandapam. <a href="${SITE}/delhi" style="color:#C84F00;font-weight:bold">See the Delhi edition</a></p>
      <p style="margin:22px 0 24px;font-size:14px;color:#555">Team Bharat AI Innovation<br>
        <span style="color:#888">${escH(w.line).replace(' · ', ' &middot; ')}</span></p>
    </div>
  </div></body></html>`
  return { subject, html }
}

async function mailFor(c: any, key: string, co: Company, preview: boolean) {
  const contact = await contactOf(c, co)
  const got = await photosOf(c, co)
  const best = co.best.filter(id => got.some(g => g.id === id))
  const thumbs = (best.length ? best : got.slice(0, 6).map(g => g.id)).map(id => got.find(g => g.id === id)!.m)
  let href = SITE + '/marketplace/dashboard#photos'
  if (!preview && contact) {
    const byId = await c.env.DB.prepare(`SELECT id FROM mp_companies WHERE exhibitor_id IN (${co.ids.map(() => '?').join(',')}) ORDER BY id LIMIT 1`).bind(...co.ids).first().catch(() => null) as any
    const acct = byId || (contact.email ? await c.env.DB.prepare('SELECT id FROM mp_companies WHERE lower(email) = ? ORDER BY id LIMIT 1').bind(contact.email.toLowerCase()).first().catch(() => null) as any : null)
    if (acct && hooks.signInLink) href = await hooks.signInLink(c, Number(acct.id))
  }
  const header = hooks.emailHeader ? hooks.emailHeader('Your booth photos', MUMBAI_WORDS.line) : ''
  return { contact, count: got.length, ...boothPhotosEmailHTML({ name: contact?.name || '', company: contact?.company || co.name, count: got.length, thumbs, href, header }) }
}

// ---- The exhibitor's dashboard ----

ep.get('/api/mp/dashboard/booth-photos', async (c) => {
  const ex = hooks.dashboardExhibitor ? await hooks.dashboardExhibitor(c).catch(() => null) : null
  if (!ex) return c.json({ error: 'Sign in to your exhibitor dashboard to see your booth photos.' }, 401)
  // These are the Mumbai photos: an exhibitor of another edition gets no tab.
  if (Number(ex.event_id || 1) !== 1) return c.json({ eligible: false, company: ex.company_name, photos: [], zip: '' })
  const hit = companyOfExhibitor(ex.id)
  if (!hit) return c.json({ eligible: true, company: ex.company_name, photos: [], zip: '' })
  const photos = (await photosOf(c, hit[1])).map(p => ({ id: p.id, s: p.s, m: p.m, o: p.o, width: p.width, height: p.height, day: p.day, time: p.time }))
  return c.json({ eligible: true, company: ex.company_name || hit[1].name, photos, zip: photos.length && canZip() ? '/api/mp/dashboard/booth-photos/zip' : '' })
})

// Every booth photo in one ZIP (at most ZIP_MAX_PHOTOS; a company has far fewer).
ep.get('/api/mp/dashboard/booth-photos/zip', async (c) => {
  const ex = hooks.dashboardExhibitor ? await hooks.dashboardExhibitor(c).catch(() => null) : null
  if (!ex) return c.json({ error: 'Sign in to your exhibitor dashboard first.' }, 401)
  const hit = companyOfExhibitor(ex.id)
  if (!hit || !canZip()) return c.json({ error: 'No booth photos to save together yet. Please save them one by one.' }, 404)
  const got = await photosOf(c, hit[1])
  const rows = await zipKit.photosByPid!(c, got.slice(0, zipKit.ZIP_MAX_PHOTOS || 100).map(g => g.pid))
  if (!rows.length) return c.json({ error: 'No booth photos yet.' }, 404)
  const slug = hit[1].name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'booth'
  return zipKit.photosZip!(c, rows, `bharat-ai-innovation-2026-${slug}.zip`)
})

// ---- Admin -> After the Event -> Booth photos ----

ep.get('/api/admin/booth-photos', async (c) => {
  const sent = await sentOf(c)
  const out: any[] = []
  for (const [key, co] of Object.entries(COMPANIES)) {
    const contact = await contactOf(c, co)
    const got = await photosOf(c, co)
    const s = sent.get(key)
    out.push({ key, company: contact?.company || co.name, booth: contact?.booth || '', email: contact?.email || '', count: got.length,
      thumbs: got.slice(0, 4).map(g => g.s), sent_at: s?.at || '', sent_count: s?.n || 0,
      status: s ? 'sent' : !got.length ? 'no-photos' : !contact?.email ? 'no-email' : 'ready' })
  }
  out.sort((a, b) => a.company.localeCompare(b.company))
  return c.json({ rows: out, companies: out.length, photos: out.reduce((n, r) => n + r.count, 0) })
})

ep.get('/api/admin/booth-photos/:key/preview', async (c) => {
  const key = c.req.param('key'); const co = COMPANIES[key]
  if (!co) return c.json({ error: 'No booth photos for that company.' }, 404)
  const m = await mailFor(c, key, co, true)
  return c.json({ to: m.contact?.email || '', subject: m.subject, html: m.html, count: m.count })
})

ep.post('/api/admin/booth-photos/:key/send', async (c) => {
  const key = c.req.param('key'); const co = COMPANIES[key]
  if (!co) return c.json({ error: 'No booth photos for that company.' }, 404)
  const body = (await c.req.json().catch(() => ({}))) as any
  const s = (await sentOf(c)).get(key)
  if (s && body.again !== true) return c.json({ error: 'Already sent on ' + s.at + '. Choose "Send again" to send it once more.', already: true, sent_at: s.at }, 409)
  const m = await mailFor(c, key, co, false)
  if (!m.contact || !m.contact.email.includes('@')) return c.json({ error: 'This exhibitor has no contact email. Add it in Admin -> Exhibitors.' }, 400)
  if (!m.count) return c.json({ error: 'None of their photos is in the photo store yet.' }, 400)
  if (!hooks.sendEmail) return c.json({ error: 'Email is not set up here.' }, 500)
  const r = await hooks.sendEmail(c, m.contact.email, m.subject, m.html, { unsubscribe: false })
  if (r && r.ok === false) return c.json({ error: r.error || 'The email did not go.' }, 502)
  try { await hooks.audit?.(c, BOOTH_AUDIT, 'booth_photos', key, { to: m.contact.email, photos: m.count, exhibitor: m.contact.id, again: body.again === true }) } catch { /* sent either way */ }
  return c.json({ ok: true, to: m.contact.email, count: m.count })
})

export default ep
