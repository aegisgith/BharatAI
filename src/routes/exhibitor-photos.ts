import { Hono } from 'hono'
import DATA from '../data/exhibitor-photos.json'
import * as store from './photo-store'
import { MUMBAI_WORDS } from './conference'
import { dearName } from './talk-brief'
import { albumPageHTML, albumPeople, addPhotoDays, pageUrl, photoSig } from './photos'

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
// 24 Nov 2026, after Envista Cyber Defence's social media person waited four days: the email
// went to one booth contact, its button signed in only that contact's account, and nobody
// else on the team could get in ("we have been unable to receive the access codes"). The
// organiser: "every exhibitor should get their photos". So now:
// - A company's photos are its booth photos AND its own stage talk (the Innovation Talk
//   albums in speaker-photos.json, key t<n>, whose talk is this exhibitor's).
// - Each company has a photo page, /photos/x<first exhibitor id>?k=<sig>, signed like a
//   speaker's album (photos.ts pageUrl / photoSig): no sign-in, no code, and it still works
//   when the email is forwarded to a colleague. Saving all is one ZIP from .../save. It is
//   served by `boothAlbum` below, mounted in index.tsx BEFORE the speaker albums' router.
// - The email's button opens that page (no longer a dashboard sign-in).
// - The exhibitor dashboard's Booth photos tab also opens for anyone on the company's team
//   list (exhibitor_team), not only the booth contact's account.
// - Admin can send the email to everyone who represents the company: the booth contact, the
//   dashboard accounts, the team list, and Mumbai attendees at the company's own email
//   domain or with the company's name (POST /api/admin/booth-photos/:key/send-team).
//
// Where they see them: the exhibitor dashboard, Booth photos (/marketplace/dashboard#photos,
// public/static/booth-photos.js), and the company's photo page. The photos come from R2 with
// links signed for this company ('x<first exhibitor id>').

type Company = { name: string; ids: number[]; photos: string[]; best: string[] }
type Hooks = {
  sendEmail?: (c: any, to: string, subject: string, html: string, opts?: any) => Promise<any>
  emailHeader?: (title: string, subtitle: string) => string
  audit?: (c: any, action: string, entity: string, entityId: any, detail?: any) => Promise<any>
  // The signed-in dashboard account's exhibitor (routes/marketplace.ts), or null.
  dashboardExhibitor?: (c: any) => Promise<{ id: number; company_name: string; event_id?: number } | null>
  // The signed-in dashboard account itself, for a team member whose account is not the booth's.
  dashboardAccount?: (c: any) => Promise<{ id: number; email: string; attendee_id: number | null } | null>
}
let hooks: Hooks = {}
export function configureExhibitorPhotos(h: Hooks) { hooks = { ...hooks, ...h } }

const ep = new Hono<{ Bindings: any }>()
const SITE = 'https://bharataiinnovation.com'
export const BOOTH_AUDIT = 'booth_photos.sent'
// One row a person sent the company's photos by send-team, detail.to = their address.
export const TEAM_AUDIT = 'booth_photos.team'
const escH = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const D = DATA as unknown as { companies: Record<string, Company>; photos: Record<string, [string, string]> }
const COMPANIES = D.companies || {}
// The company's photo page groups photos by day: tell the album page each booth photo's day.
addPhotoDays(D.photos || {})
const all = async (c: any, sql: string, ...args: any[]) => (((await c.env.DB.prepare(sql).bind(...args).all()) as any).results || []) as any[]
const one = async (c: any, sql: string, ...args: any[]) => (await c.env.DB.prepare(sql).bind(...args).first().catch(() => null)) as any
const linksForDrive = store.linksForDrive
const sameText = (a: string, b: string) => { if (!a || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0 }

// The company an exhibitors row belongs to, as [key, company].
export function companyOfExhibitor(exhibitorId: number): [string, Company] | null {
  for (const [k, co] of Object.entries(COMPANIES)) if ((co.ids || []).includes(Number(exhibitorId))) return [k, co]
  return null
}
export const boothPhotoCompanies = () => COMPANIES
// One signer name per company, so a company's links are the same from every row of it. It is
// also the company's photo page key: /photos/x<id>.
const personOf = (co: Company) => 'x' + Number(co.ids[0])
// The company behind a photo page key, only for its canonical key (the first exhibitor id).
export function companyOfAlbumKey(key: string): [string, Company] | null {
  const m = /^x(\d{1,9})$/.exec(String(key || ''))
  const hit = m ? companyOfExhibitor(Number(m[1])) : null
  return hit && personOf(hit[1]) === key ? hit : null
}

// Company names compared as words only: "Envista Cyber Defence Pvt. Ltd." = "envista cyber defence".
export const companyWords = (s: any) => String(s ?? '').toLowerCase().replace(/&/g, ' and ')
  .replace(/\b(pvt|private|ltd|limited|llp|llc|inc|corp|corporation|co|company|the)\b\.?/g, ' ').replace(/[^a-z0-9]+/g, '')

async function exhibitorRows(c: any, co: Company) {
  const ids = (co.ids || []).map(Number).filter(n => Number.isInteger(n) && n > 0)
  if (!ids.length) return [] as any[]
  return all(c, `SELECT e.id, e.company_name, e.contact_email, e.booth_number, s.contact_name FROM exhibitors e
    LEFT JOIN exhibitor_team_settings s ON s.exhibitor_id = e.id WHERE e.id IN (${ids.map(() => '?').join(',')})`, ...ids).catch(() => [] as any[])
}

// The company's own stage talk: the Innovation Talk albums whose talk is this exhibitor's,
// by the talk's exhibitor link or, where that was never set (50 of 60 talks), by the company
// name on the talk. Drive ids, in album order.
async function talkPhotosOf(c: any, co: Company): Promise<string[]> {
  const ids = new Set((co.ids || []).map(Number))
  const names = new Set([co.name, ...(await exhibitorRows(c, co)).map(r => r.company_name)].map(companyWords).filter(n => n.length >= 3))
  const rs = await all(c, 'SELECT id, exhibitor_id, company FROM innovation_talks WHERE event_id = 1')
    .catch(() => all(c, 'SELECT id, NULL AS exhibitor_id, company FROM innovation_talks WHERE event_id = 1').catch(() => [] as any[]))
  const talks = new Set(rs.filter(r => ids.has(Number(r.exhibitor_id)) || names.has(companyWords(r.company))).map(r => Number(r.id)))
  const out: string[] = []
  if (!talks.size) return out
  for (const p of albumPeople()) {
    if (!/^t\d+$/.test(p.key) || !(p.talks || []).some(t => talks.has(Number(t)))) continue
    for (const id of p.photos || []) if (!out.includes(id)) out.push(id)
  }
  return out
}

const hhmm = (v: any) => (String(v || '').match(/(\d{2}:\d{2})/) || ['', ''])[1]
// Photos of a company that are in R2 and not hidden: its booth photos in the album's order,
// then its talk, grouped by day (a stable sort keeps that order within a day).
async function photosOf(c: any, co: Company, withTalk = true) {
  const talk = withTalk ? await talkPhotosOf(c, co).catch(() => [] as string[]) : []
  const ids = [...new Set([...co.photos, ...talk])]
  const links = await linksForDrive(c, personOf(co), ids)
  return ids.filter(id => links[id])
    .map(id => ({ id, ...links[id], talk: !co.photos.includes(id), day: D.photos[id]?.[0] || links[id].day, time: D.photos[id]?.[1] || hhmm(links[id].taken_at) }))
    .sort((a, b) => String(a.day || '').localeCompare(String(b.day || '')))
}

// The booth contact: the company's exhibitors row with a contact email, booked rows first.
async function contactOf(c: any, co: Company) {
  const ids = (co.ids || []).map(Number).filter(n => Number.isInteger(n) && n > 0)
  if (!ids.length) return null
  const rows = await exhibitorRows(c, co)
  const withMail = rows.filter(r => String(r.contact_email || '').includes('@'))
  withMail.sort((a, b) => (b.booth_number ? 1 : 0) - (a.booth_number ? 1 : 0) || ids.indexOf(Number(a.id)) - ids.indexOf(Number(b.id)))
  const r = withMail[0] || rows[0]
  return r ? { id: Number(r.id), company: String(r.company_name || co.name), email: String(r.contact_email || '').trim(), name: String(r.contact_name || ''), booth: String(r.booth_number || '') } : null
}

// For routes/more-photos.ts: a company's booth photos now (in the store, not hidden), and its
// booth contact, by company key. Booth only: the talk photos were never part of what it compares.
export async function boothPhotosNow(c: any, key: string): Promise<string[]> {
  const co = COMPANIES[key]
  return co ? (await photosOf(c, co, false)).map(p => p.id) : []
}
export async function boothContact(c: any, key: string) {
  const co = COMPANIES[key]
  return co ? contactOf(c, co) : null
}
// For routes/whatsapp.ts: a company's photos by its page key (x<id>), as Drive ids, booth
// photos and talk; best = the six for the email.
export async function boothAlbumOf(c: any, key: string): Promise<{ name: string; photos: string[]; best: string[] } | null> {
  const hit = companyOfAlbumKey(key)
  if (!hit) return null
  const co = hit[1]
  const talk = await talkPhotosOf(c, co).catch(() => [] as string[])
  const name = String((await exhibitorRows(c, co)).find(r => String(r.company_name || '').trim())?.company_name || co.name).trim()
  return { name, photos: [...new Set([...co.photos, ...talk])], best: [...co.best, ...talk.slice(0, 2)] }
}

async function sentOf(c: any): Promise<Map<string, { at: string; n: number }>> {
  const rs = await all(c, "SELECT entity_id, MAX(created_at) AS at, COUNT(*) AS n FROM admin_audit WHERE action = ? AND entity = 'booth_photos' GROUP BY entity_id", BOOTH_AUDIT).catch(() => [] as any[])
  return new Map(rs.map(r => [String(r.entity_id), { at: String(r.at || ''), n: Number(r.n) || 0 }]))
}
async function teamSentCounts(c: any): Promise<Map<string, number>> {
  const rs = await all(c, "SELECT entity_id, COUNT(*) AS n FROM admin_audit WHERE action = ? AND entity = 'booth_photos' GROUP BY entity_id", TEAM_AUDIT).catch(() => [] as any[])
  return new Map(rs.map(r => [String(r.entity_id), Number(r.n) || 0]))
}

export function boothPhotosEmailHTML(a: { name: string; company: string; count: number; thumbs: string[]; href: string; header: string; talk?: boolean }): { subject: string; html: string } {
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
      <p style="font-size:15px;line-height:1.65;margin:0 0 14px">Thank you for exhibiting at ${escH(w.name)} in Mumbai. Our photographers took more than 5,000 photos. We found <strong>${escH(a.company)}</strong> in ${escH(String(a.count))} of them: your booth, your banner and your team at work${a.talk ? ', and your talk on stage' : ''}.</p>
      ${rows.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px">${rows.join('')}</table>` : ''}
      <p style="margin:0 0 20px;text-align:center"><a href="${escH(a.href)}" style="display:inline-block;padding:13px 26px;background:#C84F00;color:#fff;text-decoration:none;border-radius:10px;font-weight:bold;font-size:15px">See and save all ${escH(String(a.count))} photos</a></p>
      <p style="font-size:13px;line-height:1.6;margin:0 0 12px;color:#6b7280">The button opens your company's photos. There is no sign-in and no code. You can save each photo at full size, or all of them at once. You can forward this email to your colleagues: the button works for them too.</p>
      <p style="font-size:14px;line-height:1.65;margin:0 0 12px">Please use them on LinkedIn, your website and your newsletters, and tag <strong>#BharatAIInnovation</strong>.</p>
      <p style="font-size:14px;line-height:1.65;margin:16px 0 0">See you at Bharat AI Innovation, New Delhi: 28 and 29 July 2027 at Bharat Mandapam. <a href="${SITE}/delhi" style="color:#C84F00;font-weight:bold">See the Delhi edition</a></p>
      <p style="margin:22px 0 24px;font-size:14px;color:#555">Team Bharat AI Innovation<br>
        <span style="color:#888">${escH(w.line).replace(' · ', ' &middot; ')}</span></p>
    </div>
  </div></body></html>`
  return { subject, html }
}

// The email's parts that are the same for everyone at the company: the photos, the six small
// ones, and the company's photo page.
async function mailParts(c: any, co: Company) {
  const contact = await contactOf(c, co)
  const got = await photosOf(c, co)
  const best = [...co.best.filter(id => got.some(g => g.id === id && !g.talk)), ...got.filter(g => g.talk).slice(0, 2).map(g => g.id)].slice(0, 6)
  const pick = best.length >= 2 ? best : got.slice(0, 6).map(g => g.id)
  const thumbs = pick.slice(0, pick.length - (pick.length % 2) || 1).map(id => got.find(g => g.id === id)!.m)
  const href = await pageUrl(c, personOf(co))
  const header = hooks.emailHeader ? hooks.emailHeader('Your booth photos', MUMBAI_WORDS.line) : ''
  return { contact, got, thumbs, href, header, talk: got.some(g => g.talk), company: contact?.company || co.name }
}
async function mailFor(c: any, co: Company) {
  const m = await mailParts(c, co)
  return { contact: m.contact, count: m.got.length, ...boothPhotosEmailHTML({ name: m.contact?.name || '', company: m.company, count: m.got.length, thumbs: m.thumbs, href: m.href, header: m.header, talk: m.talk }) }
}

// ---- Everyone who represents a company (24 Nov 2026) ----
// The organiser: "send email to exhibition representative and spoc who created account,
// match with email domain and name". Each person once, with every reason they were found.
// Domain matching never uses a free-mail, college or government domain (thousands share
// those), and a domain with more than DOMAIN_CAP Mumbai attendees is treated as shared.
const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.in', 'ymail.com', 'rediffmail.com', 'rediff.com', 'hotmail.com', 'hotmail.co.in',
  'outlook.com', 'outlook.in', 'live.com', 'live.in', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'zoho.com', 'zohomail.in', 'zohomail.com',
  'mail.com', 'gmx.com', 'gmx.net', 'yandex.com', 'inbox.com', 'tutanota.com', 'fastmail.com', 'hey.com', 'example.com'])
const OUR_DOMAINS = new Set(['bharataiinnovation.com', 'aegis.edu.in'])
const SHARED_DOMAIN = /(\.|^)(ac\.[a-z]{2}|edu(\.[a-z]{2})?|gov(\.[a-z]{2})?|nic\.in|res\.in|org\.in)$/
const DOMAIN_CAP = 25
const EMAIL_OK = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/
const domainOf = (e: string) => e.slice(e.lastIndexOf('@') + 1).toLowerCase()
export type Representative = { email: string; name: string; why: string[]; attendee_id: number | null; mobile: string }

export async function representativesOf(c: any, co: Company): Promise<{ people: Representative[]; domains: string[]; shared: string[] }> {
  const ids = (co.ids || []).map(Number).filter(n => Number.isInteger(n) && n > 0)
  const q = ids.map(() => '?').join(',')
  const map = new Map<string, Representative>()
  const add = (email: any, name: any, why: string, attendeeId: any = null, mobile: any = '') => {
    const e = String(email || '').trim().toLowerCase()
    if (!EMAIL_OK.test(e) || OUR_DOMAINS.has(domainOf(e))) return
    const r = map.get(e) || { email: e, name: '', why: [], attendee_id: null, mobile: '' }
    if (!r.name && String(name || '').trim()) r.name = String(name).trim()
    if (!r.why.includes(why)) r.why.push(why)
    if (r.attendee_id == null && Number(attendeeId) > 0) r.attendee_id = Number(attendeeId)
    if (!r.mobile && String(mobile || '').trim()) r.mobile = String(mobile).trim()
    map.set(e, r)
  }
  if (!ids.length) return { people: [], domains: [], shared: [] }
  const ex = await exhibitorRows(c, co)
  for (const r of ex) add(r.contact_email, r.contact_name, 'booth contact')
  for (const r of await all(c, `SELECT email, attendee_id FROM mp_companies WHERE exhibitor_id IN (${q})`, ...ids).catch(() => [] as any[])) add(r.email, '', 'dashboard account', r.attendee_id)
  for (const r of await all(c, `SELECT first_name, last_name, email, mobile, attendee_id FROM exhibitor_team WHERE exhibitor_id IN (${q})`, ...ids).catch(() => [] as any[])) {
    add(r.email, [r.first_name, r.last_name].map(x => String(x || '').trim()).filter(Boolean).join(' '), 'team list', r.attendee_id, r.mobile)
  }
  // The company's own domains, from the addresses above.
  const domains = [...new Set([...map.keys()].map(domainOf).filter(d => !FREE_MAIL.has(d) && !SHARED_DOMAIN.test(d)))].slice(0, 20)
  const names = new Set([co.name, ...ex.map(r => r.company_name)].map(companyWords).filter(n => n.length >= 3))
  // The longest word of the company's name narrows the name search; the full name decides.
  const word = ([co.name, ...ex.map(r => r.company_name)].join(' ').toLowerCase().match(/[a-z0-9]{3,}/g) || [])
    .filter(x => !['pvt', 'private', 'ltd', 'limited', 'llp', 'inc', 'the', 'and', 'technologies', 'solutions', 'services', 'india'].includes(x))
    .sort((a, b) => b.length - a.length)[0] || ''
  const shared: string[] = []
  const cols = 'id, name, email, mobile, company'
  let found: any[] = []
  if (domains.length) found = await all(c, `SELECT ${cols} FROM attendees WHERE event_id = 1 AND lower(substr(email, instr(email, '@') + 1)) IN (${domains.map(() => '?').join(',')})`, ...domains).catch(() => [] as any[])
  const perDomain = new Map<string, number>()
  for (const r of found) perDomain.set(domainOf(String(r.email || '')), (perDomain.get(domainOf(String(r.email || ''))) || 0) + 1)
  for (const [d, n] of perDomain) if (n > DOMAIN_CAP) shared.push(d)
  for (const r of found) if (!shared.includes(domainOf(String(r.email || '')))) add(r.email, r.name, 'same email domain', r.id, r.mobile)
  if (word && names.size) {
    for (const r of await all(c, `SELECT ${cols} FROM attendees WHERE event_id = 1 AND lower(company) LIKE ?`, '%' + word + '%').catch(() => [] as any[])) {
      if (names.has(companyWords(r.company))) add(r.email, r.name, 'company name', r.id, r.mobile)
    }
  }
  // Names and mobiles for the addresses found without them (an account, a contact), from their registration.
  const missing = [...map.values()].filter(r => !r.name || !r.mobile).map(r => r.email)
  for (let i = 0; i < missing.length; i += 90) {
    const ch = missing.slice(i, i + 90)
    for (const a of await all(c, `SELECT id, name, email, mobile FROM attendees WHERE event_id = 1 AND lower(email) IN (${ch.map(() => '?').join(',')})`, ...ch).catch(() => [] as any[])) {
      const r = map.get(String(a.email || '').toLowerCase())
      if (!r) continue
      if (!r.name && String(a.name || '').trim()) r.name = String(a.name).trim()
      if (!r.mobile && String(a.mobile || '').trim()) r.mobile = String(a.mobile).trim()
      if (r.attendee_id == null) r.attendee_id = Number(a.id)
    }
  }
  return { people: [...map.values()], domains, shared }
}

// Addresses that asked for no more email from us (attendees.unsubscribed_at), in chunks of 90.
async function unsubscribed(c: any, emails: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  for (let i = 0; i < emails.length; i += 90) {
    const ch = emails.slice(i, i + 90)
    try {
      for (const r of await all(c, `SELECT lower(email) AS email FROM attendees WHERE unsubscribed_at IS NOT NULL AND lower(email) IN (${ch.map(() => '?').join(',')})`, ...ch)) out.add(String(r.email))
    } catch { return out }
  }
  return out
}
// Everyone a company's photos email already went to: the booth send and the team sends.
async function alreadySent(c: any, key: string): Promise<Set<string>> {
  const out = new Set<string>()
  for (const r of await all(c, "SELECT detail FROM admin_audit WHERE action IN (?, ?) AND entity = 'booth_photos' AND entity_id = ?", BOOTH_AUDIT, TEAM_AUDIT, key).catch(() => [] as any[])) {
    try { const d = JSON.parse(r.detail || '{}'); if (d.to) out.add(String(d.to).toLowerCase()) } catch { /* not JSON */ }
  }
  return out
}

// ---- The exhibitor's dashboard ----

// The company a signed-in dashboard account sees: its own booth's, or, for someone on an
// exhibitor's team list (their address, or the pass they hold), that exhibitor's.
async function dashboardCompanyOf(c: any): Promise<{ id: number; company_name: string; event_id?: number } | null> {
  const ex = hooks.dashboardExhibitor ? await hooks.dashboardExhibitor(c).catch(() => null) : null
  if (ex) return ex
  const acct = hooks.dashboardAccount ? await hooks.dashboardAccount(c).catch(() => null) : null
  if (!acct) return null
  const email = String(acct.email || '').trim().toLowerCase()
  const row = await one(c, `SELECT e.id, e.company_name, e.event_id FROM exhibitor_team t JOIN exhibitors e ON e.id = t.exhibitor_id
    WHERE (t.email <> '' AND lower(t.email) = ?) OR (t.attendee_id IS NOT NULL AND t.attendee_id = ?) ORDER BY (e.event_id = 1) DESC, t.id LIMIT 1`, email, Number(acct.attendee_id) || -1)
  return row ? { id: Number(row.id), company_name: String(row.company_name || ''), event_id: Number(row.event_id) || 1 } : null
}

ep.get('/api/mp/dashboard/booth-photos', async (c) => {
  const ex = await dashboardCompanyOf(c)
  if (!ex) return c.json({ error: 'Sign in to your exhibitor dashboard to see your booth photos.' }, 401)
  // These are the Mumbai photos: an exhibitor of another edition gets no tab.
  if (Number(ex.event_id || 1) !== 1) return c.json({ eligible: false, company: ex.company_name, photos: [], zip: '' })
  const hit = companyOfExhibitor(ex.id)
  if (!hit) return c.json({ eligible: true, company: ex.company_name, photos: [], zip: '' })
  const photos = (await photosOf(c, hit[1])).map(p => ({ id: p.id, s: p.s, m: p.m, o: p.o, width: p.width, height: p.height, day: p.day, time: p.time }))
  return c.json({ eligible: true, company: ex.company_name || hit[1].name, photos, zip: photos.length ? '/api/mp/dashboard/booth-photos/zip' : '' })
})

// Every photo in one ZIP (at most ZIP_MAX_PHOTOS; a company has far fewer).
ep.get('/api/mp/dashboard/booth-photos/zip', async (c) => {
  const ex = await dashboardCompanyOf(c)
  if (!ex) return c.json({ error: 'Sign in to your exhibitor dashboard first.' }, 401)
  const hit = companyOfExhibitor(ex.id)
  if (!hit) return c.json({ error: 'No booth photos to save together yet. Please save them one by one.' }, 404)
  const got = await photosOf(c, hit[1])
  const rows = await store.photosByPid(c, got.slice(0, store.ZIP_MAX_PHOTOS).map(g => g.pid))
  if (!rows.length) return c.json({ error: 'No booth photos yet.' }, 404)
  const slug = hit[1].name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'booth'
  return store.photosZip(c, rows, `bharat-ai-innovation-2026-${slug}.zip`)
})

// ---- The company's photo page: /photos/x<id>?k=<sig> (index.tsx mounts this first) ----

export const boothAlbum = new Hono<{ Bindings: any }>()
const PAGE_HEAD = { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'private, max-age=300', 'Referrer-Policy': 'no-referrer' }
const brokenPage = () => new Response(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Photos</title></head>
<body style="font-family:Segoe UI,Roboto,Arial,sans-serif;max-width:560px;margin:60px auto;padding:0 16px;color:#1e2140"><h1 style="font-size:22px">This photo link is not complete</h1>
<p style="line-height:1.6">Please open the link from your email again, all of it. If it still does not work, write to <a href="mailto:register@bharataiinnovation.com">register@bharataiinnovation.com</a> and we will send it again.</p>
<p><a href="${SITE}/" style="color:#C84F00;font-weight:bold">Bharat AI Innovation</a></p></body></html>`, { status: 404, headers: PAGE_HEAD })

boothAlbum.get('/photos/:key{x[0-9]+}', async (c) => {
  const key = c.req.param('key')
  const hit = companyOfAlbumKey(key)
  if (!hit || !sameText(await photoSig(c, key), String(c.req.query('k') || ''))) return brokenPage()
  const co = hit[1]
  const name = String((await exhibitorRows(c, co)).find(r => String(r.company_name || '').trim())?.company_name || co.name).trim()
  const got = await photosOf(c, co)
  const links: Record<string, { s: string; m: string; o: string; pid?: string; bytes?: number }> = {}
  for (const p of got) links[p.id] = { s: p.s, m: p.m, o: p.o, pid: p.pid, bytes: p.bytes }
  return new Response(albumPageHTML({ name, org: '', ids: got.map(p => p.id), got: links }), { headers: PAGE_HEAD })
})

// "Save all" / "Save" on the company's page: the chosen originals as one ZIP. p = store ids
// joined by '.', as the page has them; only the company's own photos are ever in it.
boothAlbum.get('/photos/:key{x[0-9]+}/save', async (c) => {
  const key = c.req.param('key')
  const hit = companyOfAlbumKey(key)
  if (!hit || !sameText(await photoSig(c, key), String(c.req.query('k') || ''))) return store.refuse(404, true, 'broken')
  if (!c.env.UPLOADS) return store.refuse(503, true, 'off')
  const want = String(c.req.query('p') || '').split('.').filter(Boolean)
  if (!want.length) return store.refuse(404, true, 'broken')
  if (want.length > store.ZIP_MAX_PHOTOS) return store.refuse(413, true, 'too-many')
  const own = new Set((await photosOf(c, hit[1])).map(p => p.id))
  let photos: Awaited<ReturnType<typeof store.photosByPid>> = []
  try { photos = (await store.photosByPid(c, want)).filter(x => own.has(String(x.drive_id))) } catch { photos = [] }
  if (!photos.length) return store.refuse(404, true, 'gone')
  if (photos.reduce((t, x) => t + Number(x.bytes || 0), 0) > store.ZIP_MAX_BYTES) return store.refuse(413, true, 'too-many')
  await store.recordSaves(c, key, photos.map(x => Number(x.id)))
  const n = Number(c.req.query('n') || 0), of = Number(c.req.query('of') || 0)
  const part = Number.isInteger(n) && Number.isInteger(of) && of > 1 && n >= 1 && n <= of ? `-part-${n}-of-${of}` : ''
  const slug = hit[1].name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'booth'
  return store.photosZip(c, photos, `bharat-ai-innovation-2026-${slug}${part}.zip`)
})

// ---- Admin -> After the Event -> Booth photos ----

ep.get('/api/admin/booth-photos', async (c) => {
  const sent = await sentOf(c)
  const team = await teamSentCounts(c)
  const out: any[] = []
  for (const [key, co] of Object.entries(COMPANIES)) {
    const contact = await contactOf(c, co)
    const got = await photosOf(c, co, false)
    const s = sent.get(key)
    out.push({ key, company: contact?.company || co.name, booth: contact?.booth || '', email: contact?.email || '', count: got.length,
      thumbs: got.slice(0, 4).map(g => g.s), sent_at: s?.at || '', sent_count: s?.n || 0, team_sent: team.get(key) || 0,
      status: s ? 'sent' : !got.length ? 'no-photos' : !contact?.email ? 'no-email' : 'ready' })
  }
  out.sort((a, b) => a.company.localeCompare(b.company))
  return c.json({ rows: out, companies: out.length, photos: out.reduce((n, r) => n + r.count, 0) })
})

ep.get('/api/admin/booth-photos/:key/preview', async (c) => {
  const key = c.req.param('key'); const co = COMPANIES[key]
  if (!co) return c.json({ error: 'No booth photos for that company.' }, 404)
  const m = await mailFor(c, co)
  return c.json({ to: m.contact?.email || '', subject: m.subject, html: m.html, count: m.count, page: await pageUrl(c, personOf(co)) })
})

ep.post('/api/admin/booth-photos/:key/send', async (c) => {
  const key = c.req.param('key'); const co = COMPANIES[key]
  if (!co) return c.json({ error: 'No booth photos for that company.' }, 404)
  const body = (await c.req.json().catch(() => ({}))) as any
  const s = (await sentOf(c)).get(key)
  if (s && body.again !== true) return c.json({ error: 'Already sent on ' + s.at + '. Choose "Send again" to send it once more.', already: true, sent_at: s.at }, 409)
  const m = await mailFor(c, co)
  if (!m.contact || !m.contact.email.includes('@')) return c.json({ error: 'This exhibitor has no contact email. Add it in Admin -> Exhibitors.' }, 400)
  if (!m.count) return c.json({ error: 'None of their photos is in the photo store yet.' }, 400)
  if (!hooks.sendEmail) return c.json({ error: 'Email is not set up here.' }, 500)
  const r = await hooks.sendEmail(c, m.contact.email, m.subject, m.html, { unsubscribe: false })
  if (r && r.ok === false) return c.json({ error: r.error || 'The email did not go.' }, 502)
  try { await hooks.audit?.(c, BOOTH_AUDIT, 'booth_photos', key, { to: m.contact.email, photos: m.count, exhibitor: m.contact.id, again: body.again === true }) } catch { /* sent either way */ }
  return c.json({ ok: true, to: m.contact.email, count: m.count })
})

// Who represents the company, and whether each has had the photos email.
ep.get('/api/admin/booth-photos/:key/people', async (c) => {
  const key = c.req.param('key'); const co = COMPANIES[key]
  if (!co) return c.json({ error: 'No booth photos for that company.' }, 404)
  const r = await representativesOf(c, co)
  const sent = await alreadySent(c, key)
  const unsub = await unsubscribed(c, r.people.map(p => p.email))
  return c.json({ company: co.name, page: await pageUrl(c, personOf(co)), domains: r.domains, shared_domains: r.shared,
    people: r.people.map(p => ({ ...p, sent: sent.has(p.email), unsubscribed: unsub.has(p.email) })) })
})

// The photos email to everyone who represents the company and has not had it (each once).
// { dry: true } lists who it would go to; { only: [emails] } narrows it to those.
ep.post('/api/admin/booth-photos/:key/send-team', async (c) => {
  const key = c.req.param('key'); const co = COMPANIES[key]
  if (!co) return c.json({ error: 'No booth photos for that company.' }, 404)
  const body = (await c.req.json().catch(() => ({}))) as any
  const only = Array.isArray(body.only) ? new Set(body.only.map((e: any) => String(e || '').trim().toLowerCase())) : null
  const r = await representativesOf(c, co)
  const sent = await alreadySent(c, key)
  const unsub = await unsubscribed(c, r.people.map(p => p.email))
  const skipped = r.people.filter(p => sent.has(p.email) || unsub.has(p.email)).map(p => ({ email: p.email, why: sent.has(p.email) ? 'already sent' : 'unsubscribed' }))
  const to = r.people.filter(p => !sent.has(p.email) && !unsub.has(p.email) && (!only || only.has(p.email)))
  const m = await mailParts(c, co)
  if (!m.got.length) return c.json({ error: 'None of their photos is in the photo store yet.' }, 400)
  if (body.dry === true) return c.json({ company: m.company, count: m.got.length, page: m.href, would: to, skipped, shared_domains: r.shared })
  if (!hooks.sendEmail) return c.json({ error: 'Email is not set up here.' }, 500)
  const done: string[] = [], failed: { email: string; error: string }[] = []
  for (const p of to) {
    const mail = boothPhotosEmailHTML({ name: p.name, company: m.company, count: m.got.length, thumbs: m.thumbs, href: m.href, header: m.header, talk: m.talk })
    let res: any
    try { res = await hooks.sendEmail(c, p.email, mail.subject, mail.html, { unsubscribe: false }) } catch (e: any) { res = { ok: false, error: String(e?.message || e) } }
    if (res && res.ok === false) { failed.push({ email: p.email, error: String(res.error || 'not sent') }); continue }
    done.push(p.email)
    try { await hooks.audit?.(c, TEAM_AUDIT, 'booth_photos', key, { to: p.email, why: p.why, photos: m.got.length }) } catch { /* sent either way */ }
  }
  return c.json({ ok: true, company: m.company, count: m.got.length, sent: done, failed, skipped })
})

export default ep
