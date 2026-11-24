import { Hono } from 'hono'
import DATA from '../data/exhibitor-photos.json'
import * as store from './photo-store'
import { MUMBAI_WORDS } from './conference'
import { dearName } from './talk-brief'
import { isNoEmail } from './team-guests'
import { albumPageHTML, albumPeople, addPhotoDays, pageUrl, photoSig, personFor, hiddenPhotos, liveProgramme, panelShotsBy, NOT_ME, OPT_OUT } from './photos'
import type { Live } from './photos'

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
//
// 24 Nov 2026, evening. The organiser: "put photos of all representatives, booths, speakers,
// innovation talk related any exhibitor in their respective account", then "send them email
// that they can find photos in their respective accounts, and make sure the email access does
// generate otp code and they are able to login". So now:
// - Every Mumbai exhibitors row is a company (allCompanies), not only the 54 with booth photos.
// - A company's photos are, in this order and each photo once: its booth; its Innovation
//   Talk; each of its speakers on stage (published speakers of the company, or whose email is
//   one of its representatives', with their panels' group shots); then each representative's
//   own photos (their attendee album a<id>). An attendee album still marked "check" (no
//   strong match: may be a lookalike) is left out, as are "Not me" photos and anyone who said
//   "Don't match my photos".
// - Any representative can sign in to the dashboard with a 6-digit code emailed to them
//   (routes/marketplace.ts /api/mp/auth/code, using companyOfPerson below) and sees the tab.
// - Admin sends each representative one "your photos are in your account" email
//   (POST /api/admin/booth-photos/:key/send-account).
// - Companies whose booth contact has no email or no mobile are listed for the organising
//   team (GET /api/admin/booth-contact-gaps, POST .../send).

// aka: other names the company goes by ("Aegis" for Aegis School of Data Science & AI), so
// people registered under any of them are found. ids: every exhibitors row of the company;
// a stand with no exhibitors row (Aegis Super Intelligence Lab) carries a made-up id, 900001
// and up, that only makes its page key.
type Company = { name: string; ids: number[]; photos: string[]; best: string[]; aka?: string[] }
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
  return all(c, `SELECT e.id, e.company_name, e.contact_email, e.contact_phone, e.booth_number, s.contact_name FROM exhibitors e
    LEFT JOIN exhibitor_team_settings s ON s.exhibitor_id = e.id WHERE e.id IN (${ids.map(() => '?').join(',')})`, ...ids).catch(() => [] as any[])
}

// ---- Every Mumbai exhibitor is a company (24 Nov 2026) ----
// 13 exhibitors rows are in no booth album (no booth found in the photos, or a sponsor with
// no stand), and three companies have a second row the photo file does not know (Sequretek
// 179, Ai Vie Insights 146, Aegis Super Intelligence Lab 182). A row whose name, less the
// words every company uses, is a known company's joins it; any other row is a company of its
// own, keyed x<id>, with no booth photos but its talk, its speakers and its team.
const coreWords = (s: any) => companyWords(String(s ?? '').replace(/\b(it|solutions?|technolog(?:y|ies)|services|systems|software|india)\b/gi, ' '))
export async function allCompanies(c: any): Promise<Map<string, Company>> {
  const out = new Map<string, Company>()
  for (const [k, co] of Object.entries(COMPANIES)) out.set(k, { ...co, ids: [...(co.ids || [])] })
  const known = new Set([...out.values()].flatMap(co => co.ids.map(Number)))
  for (const r of await all(c, 'SELECT id, company_name FROM exhibitors WHERE event_id = 1 ORDER BY id').catch(() => [] as any[])) {
    const id = Number(r.id)
    if (known.has(id)) continue
    known.add(id)
    const w = coreWords(r.company_name)
    const into = w.length >= 4 ? [...out.values()].find(co => [co.name, ...(co.aka || [])].some(n => coreWords(n) === w)) : undefined
    if (into) into.ids.push(id)
    else out.set('x' + id, { name: String(r.company_name || '').trim() || 'Exhibitor', ids: [id], photos: [], best: [] })
  }
  return out
}
async function companyOfRow(c: any, exhibitorId: number): Promise<[string, Company] | null> {
  for (const [k, co] of await allCompanies(c)) if (co.ids.includes(Number(exhibitorId))) return [k, co]
  return null
}
// The company behind a photo page key: its first exhibitor id only, as personOf makes it.
async function companyByPageKey(c: any, key: string): Promise<[string, Company] | null> {
  if (!/^x\d{1,9}$/.test(String(key || ''))) return null
  for (const [k, co] of await allCompanies(c)) if (personOf(co) === key) return [k, co]
  return null
}
// Admin's key: a booth album's name in the photo file, or x<id> for any other exhibitor.
async function companyByKey(c: any, key: string): Promise<Company | null> {
  return (await allCompanies(c)).get(String(key || '')) || (await companyByPageKey(c, key))?.[1] || null
}

// "Not me" photos and "Don't match my photos", every attendee album's at once.
async function albumChoices(c: any): Promise<Map<string, { out: boolean; notMe: Set<string> }>> {
  const m = new Map<string, { out: boolean; notMe: Set<string> }>()
  for (const r of await all(c, "SELECT action, entity_id, detail FROM admin_audit WHERE entity = 'photo_album' AND action IN (?, ?)", NOT_ME, OPT_OUT).catch(() => [] as any[])) {
    const k = String(r.entity_id); const ch = m.get(k) || { out: false, notMe: new Set<string>() }
    if (r.action === OPT_OUT) ch.out = true
    else { try { const d = JSON.parse(r.detail || '{}'); if (d.photo) ch.notMe.add(String(d.photo)) } catch { /* not JSON */ } }
    m.set(k, ch)
  }
  return m
}

type Kind = 'booth' | 'talk' | 'speaker' | 'team'
type Section = { title: string; kind: Kind; ids: string[] }
type Album = { sections: Section[]; focus: Record<string, [number, number]> }
// A company's photos, as named sections, each photo once (Drive ids; the store decides later
// which it has). See the header for the order and what is left out.
async function albumOf(c: any, co: Company): Promise<Album> {
  const rows = await exhibitorRows(c, co)
  const names = new Set([co.name, ...rows.map(r => r.company_name), ...(co.aka || [])].map(companyWords).filter(n => n.length >= 3))
  const hidden = await hiddenPhotos(c).catch(() => null)
  const used = new Set<string>(); const focus: Record<string, [number, number]> = {}
  const sections: Section[] = []
  // into: a section already there that these photos join (a speaker's own attendee album).
  const add = (title: string, kind: Kind, ids: string[], f?: Record<string, [number, number]>, into?: Section) => {
    const keep = [...new Set(ids)].filter(id => id && !used.has(id) && !(hidden && hidden.has(id)))
    keep.forEach(id => { used.add(id); if (f && f[id]) focus[id] = f[id] })
    if (keep.length && into) into.ids.push(...keep)
    else if (keep.length) sections.push({ title, kind, ids: keep })
  }
  const speakerOf = new Map<Section, string>()
  // The booth, in the day order its photos were taken (a stable sort keeps the album's order within a day).
  add('Your booth', 'booth', (co.photos || []).slice().sort((a, b) => String(D.photos[a]?.[0] || '').localeCompare(String(D.photos[b]?.[0] || ''))))
  // Its own Innovation Talk: the talk albums (key t<n>) whose talk is this exhibitor's, by the
  // talk's exhibitor link or, where that was never set (50 of 60 talks), by the company name.
  const exIds = new Set((co.ids || []).map(Number))
  const talks = await all(c, 'SELECT id, exhibitor_id, company FROM innovation_talks WHERE event_id = 1')
    .catch(() => all(c, 'SELECT id, NULL AS exhibitor_id, company FROM innovation_talks WHERE event_id = 1').catch(() => [] as any[]))
  const mine = new Set(talks.filter(r => exIds.has(Number(r.exhibitor_id)) || names.has(companyWords(r.company))).map(r => Number(r.id)))
  const shown = new Set<string>() // album keys already in a section
  const talkIds: string[] = []
  for (const p of albumPeople()) {
    if (!/^t\d+$/.test(p.key) || !(p.talks || []).some(t => mine.has(Number(t)))) continue
    shown.add(p.key); talkIds.push(...(p.photos || []))
    for (const [id, f] of Object.entries(p.focus || {})) if (!focus[id]) focus[id] = f
  }
  add('Your Innovation Talk on stage', 'talk', talkIds)
  // Its speakers: published speakers of the company, or whose email is a representative's.
  const reps = await representativesOf(c, co).catch(() => ({ people: [] as Representative[], domains: [], shared: [] }))
  const repMail = new Set(reps.people.map(p => p.email))
  let live: Live | null | undefined
  const liveNow = async () => (live === undefined ? (live = await liveProgramme(c).catch(() => null)) : live)
  const speakers = await all(c, 'SELECT id, name, organisation, email FROM speakers WHERE event_id = 1 AND is_published = 1 ORDER BY sort_order, id').catch(() => [] as any[])
  for (const s of speakers) {
    if (!names.has(companyWords(s.organisation)) && !repMail.has(String(s.email || '').trim().toLowerCase())) continue
    const p = personFor('s' + s.id)
    if (!p || shown.has(p.key)) continue
    shown.add(p.key)
    const lv = await liveNow()
    const panel = lv ? panelShotsBy(p.key, lv).flatMap(g => g.ids) : []
    const before = sections.length
    add(`${String(s.name || p.name).trim()} on stage`, 'speaker', [...panel, ...(p.photos || [])], p.focus)
    if (sections.length > before) speakerOf.set(sections[sections.length - 1], nameKey(s.name || p.name))
  }
  // A guest the organiser named (key g<n>) whose email is a representative's.
  for (const p of albumPeople()) {
    if (!p.guest || shown.has(p.key) || !repMail.has(String(p.guest.email || '').trim().toLowerCase())) continue
    shown.add(p.key)
    add(p.guest.name || p.name, 'speaker', p.photos || [], p.focus)
  }
  // Each representative's own photos.
  const choices = await albumChoices(c)
  for (const r of reps.people) {
    if (!r.attendee_id) continue
    const key = 'a' + r.attendee_id
    const p = personFor(key)
    const ch = choices.get(key)
    if (!p || !p.attendee || p.check || shown.has(key) || (ch && ch.out)) continue
    shown.add(key)
    // A speaker registered as an attendee too, perhaps spelt another way (Shreenivas and
    // Sreenivas Chetlapalli): their own photos join their section, not a second heading.
    const me = nameKey(r.name)
    const theirs = me.length >= 6 ? [...speakerOf].find(([, n]) => near(n, me))?.[0] : undefined
    add(r.name || 'Your team', 'team', (p.photos || []).filter(id => !(ch && ch.notMe.has(id))), p.focus, theirs)
  }
  return { sections, focus }
}

// A person's name as letters only, without a title: 'Dr. Shreenivas Chetlapalli' = 'shreenivaschetlapalli'.
const nameKey = (v: any) => String(v ?? '').toLowerCase().replace(/\b(dr|mr|mrs|ms|shri|smt|prof)\b\.?/g, ' ').replace(/[^a-z]/g, '')
// Two names at most two letters apart (one spelt with an extra h, a missing letter).
function near(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 2) return false
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = row
  }
  return prev[b.length] <= 2
}
const hhmm = (v: any) => (String(v || '').match(/(\d{2}:\d{2})/) || ['', ''])[1]
// A company's photos that are in R2 and not hidden, section by section, with the section's
// name and kind on each. full = false: the booth only (what Admin's list and "More photos
// found" count).
async function albumPhotos(c: any, co: Company, full = true) {
  const al: Album = full ? await albumOf(c, co)
    : { sections: (co.photos || []).length ? [{ title: 'Your booth', kind: 'booth', ids: [...new Set(co.photos)] }] : [], focus: {} }
  const links = await linksForDrive(c, personOf(co), al.sections.flatMap(s => s.ids))
  const photos = al.sections.flatMap(s => s.ids.filter(id => links[id]).map(id => ({ id, ...links[id], kind: s.kind, section: s.title, talk: s.kind !== 'booth',
    day: D.photos[id]?.[0] || links[id].day, time: D.photos[id]?.[1] || hhmm(links[id].taken_at) })))
  const sections = al.sections.map(s => ({ title: s.title, kind: s.kind, ids: s.ids.filter(id => links[id]) })).filter(s => s.ids.length)
  return { photos, sections, focus: al.focus }
}
async function photosOf(c: any, co: Company, full = true) { return (await albumPhotos(c, co, full)).photos }

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
// For routes/whatsapp.ts: a company's photos by its page key (x<id>), as Drive ids, every
// section (booth, talk, speakers, team); best = the six for the email.
export async function boothAlbumOf(c: any, key: string): Promise<{ name: string; photos: string[]; best: string[] } | null> {
  const hit = await companyByPageKey(c, key)
  if (!hit) return null
  const co = hit[1]
  const al = await albumOf(c, co)
  const name = String((await exhibitorRows(c, co)).find(r => String(r.company_name || '').trim())?.company_name || co.name).trim()
  return { name, photos: al.sections.flatMap(s => s.ids), best: pickBest(co, al.sections) }
}

// The six photos for an email: two of the booth's chosen best, two of the talk, two of the
// speakers, two of the team, then the rest of the booth's best and anything else, as an even
// number when it can be (they sit two to a row).
function pickBest(co: Company, sections: { kind: Kind; ids: string[] }[]): string[] {
  const of = (k: Kind) => sections.filter(s => s.kind === k).flatMap(s => s.ids)
  const booth = of('booth')
  const best = (co.best || []).filter(id => booth.includes(id))
  const out = [...best.slice(0, 2), ...of('talk').slice(0, 2), ...of('speaker').slice(0, 2), ...of('team').slice(0, 2), ...best.slice(2)]
  for (const id of sections.flatMap(s => s.ids)) { if (out.length >= 6) break; if (!out.includes(id)) out.push(id) }
  const six = [...new Set(out)].slice(0, 6)
  return six.length > 1 && six.length % 2 ? six.slice(0, -1) : six
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
async function mailParts(c: any, co: Company, title = 'Your booth photos') {
  const contact = await contactOf(c, co)
  const al = await albumPhotos(c, co)
  const got = al.photos
  const thumbs = pickBest(co, al.sections).map(id => got.find(g => g.id === id)!.m)
  const href = await pageUrl(c, personOf(co))
  const header = hooks.emailHeader ? hooks.emailHeader(title, MUMBAI_WORDS.line) : ''
  const kinds = [...new Set(al.sections.map(s => s.kind))]
  return { contact, got, thumbs, href, header, kinds, talk: kinds.includes('talk'), company: contact?.company || co.name }
}

// ---- "Your photos are in your account" (24 Nov 2026) ----
// One email to each representative: the photos are in their exhibitor account, and how to get
// in with a 6-digit code. The button opens the dashboard with their address filled in; the
// code is only sent when they ask for it there, so a mail scanner opening the link sends
// nothing. The company's photo page, with no sign-in, stays as the way in if a code is slow.
export const ACCOUNT_AUDIT = 'booth_photos.account'
const KIND_WORDS: Record<Kind, string> = { booth: 'your booth', talk: 'your Innovation Talk on stage', speaker: 'your speakers on stage', team: 'your team at the event' }
const listWords = (xs: string[]) => xs.length <= 1 ? (xs[0] || '') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]
export function accountPhotosEmailHTML(a: { name: string; company: string; email: string; count: number; thumbs: string[]; kinds: string[]; signIn: string; page: string; header: string }): { subject: string; html: string } {
  const w = MUMBAI_WORDS
  const subject = `${a.company}: your ${w.name} photos are in your account`
  const pics = a.thumbs.slice(0, 6)
  const rows: string[] = []
  for (let i = 0; i < pics.length; i += 2) {
    rows.push(`<tr>${pics.slice(i, i + 2).map(u => `<td style="padding:4px;width:50%"><img src="${escH(u)}" alt="" width="270" style="display:block;width:100%;height:auto;border-radius:8px"></td>`).join('')}</tr>`)
  }
  const what = listWords((a.kinds as Kind[]).filter(k => KIND_WORDS[k]).map(k => KIND_WORDS[k]))
  const step = (n: number, t: string) => `<tr><td style="vertical-align:top;padding:0 10px 10px 0;width:28px"><span style="display:inline-block;width:26px;height:26px;line-height:26px;border-radius:13px;background:#1e2140;color:#fff;font-weight:bold;font-size:13px;text-align:center">${n}</span></td><td style="padding:2px 0 10px;font-size:15px;line-height:1.55">${t}</td></tr>`
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f6f7fb;padding:24px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1e2140">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e7e9f5">
    ${a.header}
    <div style="padding:26px 26px 8px">
      <p style="font-size:15px;line-height:1.65;margin:0 0 14px">${escH(a.name ? `Dear ${dearName(a.name)},` : `Dear ${a.company} team,`)}</p>
      <p style="font-size:15px;line-height:1.65;margin:0 0 14px">Thank you for being part of ${escH(w.name)} in Mumbai. We have put <strong>${escH(String(a.count))} photos</strong> of <strong>${escH(a.company)}</strong> in your exhibitor account${what ? `: ${escH(what)}` : ''}.</p>
      ${rows.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px">${rows.join('')}</table>` : ''}
      <p style="margin:0 0 20px;text-align:center"><a href="${escH(a.signIn)}" style="display:inline-block;padding:13px 26px;background:#C84F00;color:#fff;text-decoration:none;border-radius:10px;font-weight:bold;font-size:15px">Open my account</a></p>
      <p style="font-size:15px;font-weight:bold;margin:0 0 10px">How to sign in. No password needed.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 8px">
        ${step(1, 'Tap <strong>Open my account</strong>.')}
        ${step(2, `Your email address is already filled in: <strong>${escH(a.email)}</strong>. Tap <strong>Email me a code</strong>.`)}
        ${step(3, 'We email you a 6-digit code. Type it in and tap <strong>Sign in</strong>.')}
        ${step(4, 'Your photos open. Save each photo at full size, or all of them at once.')}
      </table>
      <p style="font-size:13px;line-height:1.6;margin:0 0 14px;color:#6b7280">The code works for 30 minutes. If it does not come in 2 minutes, look in your spam folder. You can also <a href="${escH(a.page)}" style="color:#C84F00">open your company's photos without signing in</a>.</p>
      <p style="font-size:14px;line-height:1.65;margin:0 0 12px">Please use them on LinkedIn, your website and your newsletters, and tag <strong>#BharatAIInnovation</strong>.</p>
      <p style="font-size:14px;line-height:1.65;margin:16px 0 0">See you at Bharat AI Innovation, New Delhi: 28 and 29 July 2027 at Bharat Mandapam. <a href="${SITE}/delhi" style="color:#C84F00;font-weight:bold">See the Delhi edition</a></p>
      <p style="margin:22px 0 24px;font-size:14px;color:#555">Team Bharat AI Innovation<br>
        <span style="color:#888">${escH(w.line).replace(' · ', ' &middot; ')}</span></p>
    </div>
  </div></body></html>`
  return { subject, html }
}
const signInHref = (email: string) => `${SITE}/marketplace/dashboard?email=${encodeURIComponent(email)}#photos`
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
// Our own addresses are people like anyone else (the organiser, 24 Nov 2026: "dont skip
// assessfy and aegis and aegis super intelligence lab"), but never a company's domain: one
// of our team on an exhibitor's list must not bring every Aegis address in.
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
    // A guest registered with a mobile only has a stand-in address: nothing can be mailed to it.
    if (!EMAIL_OK.test(e) || isNoEmail(e)) return
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
  // The company's own domains: the booth contact's and its dashboard accounts', and a domain
  // at least two people on its team list share. One team member at another company's address
  // (a guest, a partner) must not bring that whole company in.
  const teamDomains = new Map<string, number>()
  for (const r of map.values()) if (r.why.includes('team list')) teamDomains.set(domainOf(r.email), (teamDomains.get(domainOf(r.email)) || 0) + 1)
  const domains = [...new Set([...map.values()].filter(r => r.why.includes('booth contact') || r.why.includes('dashboard account') || (teamDomains.get(domainOf(r.email)) || 0) >= 2).map(r => domainOf(r.email))
    .filter(d => !FREE_MAIL.has(d) && !SHARED_DOMAIN.test(d) && !OUR_DOMAINS.has(d)))].slice(0, 20)
  // Every name the company goes by. The first real word of each narrows the search (a short
  // name like "Aegis" has no other); the full name, compared as words only, decides.
  const allNames = [co.name, ...ex.map(r => r.company_name), ...(co.aka || [])].map(n => String(n || '').trim()).filter(Boolean)
  const names = new Set(allNames.map(companyWords).filter(n => n.length >= 3))
  const PLAIN = ['pvt', 'private', 'ltd', 'limited', 'llp', 'inc', 'the', 'and', 'technologies', 'solutions', 'services', 'india']
  const words = [...new Set(allNames.map(n => (n.toLowerCase().match(/[a-z0-9]{3,}/g) || []).find(x => !PLAIN.includes(x)) || '').filter(Boolean))].slice(0, 6)
  const shared: string[] = []
  const cols = 'id, name, email, mobile, company'
  let found: any[] = []
  if (domains.length) found = await all(c, `SELECT ${cols} FROM attendees WHERE event_id = 1 AND lower(substr(email, instr(email, '@') + 1)) IN (${domains.map(() => '?').join(',')})`, ...domains).catch(() => [] as any[])
  const perDomain = new Map<string, number>()
  for (const r of found) perDomain.set(domainOf(String(r.email || '')), (perDomain.get(domainOf(String(r.email || ''))) || 0) + 1)
  for (const [d, n] of perDomain) if (n > DOMAIN_CAP) shared.push(d)
  for (const r of found) if (!shared.includes(domainOf(String(r.email || '')))) add(r.email, r.name, 'same email domain', r.id, r.mobile)
  for (const word of names.size ? words : []) {
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

// The Mumbai company an email address represents (24 Nov 2026), as representativesOf finds
// them: the booth contact, a dashboard account of the exhibitor, the team list, or a Mumbai
// registration at the company's own email domain or with its name. Used by the dashboard and
// by the 6-digit code sign-in (routes/marketplace.ts). The cheap reads narrow it to a few
// companies; representativesOf decides, so this and the email reach exactly the same people.
export async function companyOfPerson(c: any, email: string): Promise<{ key: string; exhibitorId: number; name: string } | null> {
  const e = String(email || '').trim().toLowerCase()
  if (!EMAIL_OK.test(e) || isNoEmail(e)) return null
  const list = await allCompanies(c)
  const answer = (k: string, co: Company) => ({ key: k, exhibitorId: Number(co.ids.find(id => id > 0 && id < 900000) || co.ids[0]), name: co.name })
  const byRow = (id: any) => { for (const [k, co] of list) if (co.ids.includes(Number(id))) return answer(k, co); return null }
  for (const r of await all(c, `SELECT id AS x FROM exhibitors WHERE event_id = 1 AND lower(trim(contact_email)) = ?
    UNION ALL SELECT exhibitor_id AS x FROM mp_companies WHERE exhibitor_id IS NOT NULL AND lower(email) = ?
    UNION ALL SELECT exhibitor_id AS x FROM exhibitor_team WHERE email <> '' AND lower(email) = ?`, e, e, e).catch(() => [] as any[])) {
    const hit = byRow(r.x); if (hit) return hit
  }
  const cands = new Set<string>()
  const d = domainOf(e)
  if (!FREE_MAIL.has(d) && !SHARED_DOMAIN.test(d) && !OUR_DOMAINS.has(d)) {
    const dom = "lower(substr(trim(%), instr(trim(%), '@') + 1)) = ?"
    for (const r of await all(c, `SELECT id AS x FROM exhibitors WHERE event_id = 1 AND ${dom.replace(/%/g, 'contact_email')}
      UNION SELECT exhibitor_id AS x FROM mp_companies WHERE exhibitor_id IS NOT NULL AND ${dom.replace(/%/g, 'email')}
      UNION SELECT exhibitor_id AS x FROM exhibitor_team WHERE email <> '' AND ${dom.replace(/%/g, 'email')}`, d, d, d).catch(() => [] as any[])) {
      const hit = byRow(r.x); if (hit) cands.add(hit.key)
    }
  }
  const reg = await one(c, 'SELECT company FROM attendees WHERE event_id = 1 AND lower(email) = ? LIMIT 1', e)
  const w = companyWords(reg?.company)
  if (w.length >= 3) {
    const rowNames = await all(c, 'SELECT id, company_name FROM exhibitors WHERE event_id = 1').catch(() => [] as any[])
    for (const [k, co] of list) {
      if ([co.name, ...(co.aka || [])].some(n => companyWords(n) === w) || rowNames.some(r => co.ids.includes(Number(r.id)) && companyWords(r.company_name) === w)) cands.add(k)
    }
  }
  for (const k of [...cands].slice(0, 6)) {
    const co = list.get(k)!
    if ((await representativesOf(c, co)).people.some(p => p.email === e)) return answer(k, co)
  }
  return null
}

// The company a signed-in dashboard account sees: its own booth's; for someone on an
// exhibitor's team list (their address, or the pass they hold), that exhibitor's; else the
// company the account's address represents (companyOfPerson).
async function dashboardCompanyOf(c: any): Promise<{ id: number; company_name: string; event_id?: number } | null> {
  const ex = hooks.dashboardExhibitor ? await hooks.dashboardExhibitor(c).catch(() => null) : null
  if (ex) return ex
  const acct = hooks.dashboardAccount ? await hooks.dashboardAccount(c).catch(() => null) : null
  if (!acct) return null
  const email = String(acct.email || '').trim().toLowerCase()
  const row = await one(c, `SELECT e.id, e.company_name, e.event_id FROM exhibitor_team t JOIN exhibitors e ON e.id = t.exhibitor_id
    WHERE (t.email <> '' AND lower(t.email) = ?) OR (t.attendee_id IS NOT NULL AND t.attendee_id = ?) ORDER BY (e.event_id = 1) DESC, t.id LIMIT 1`, email, Number(acct.attendee_id) || -1)
  if (row) return { id: Number(row.id), company_name: String(row.company_name || ''), event_id: Number(row.event_id) || 1 }
  const rep = await companyOfPerson(c, email).catch(() => null)
  return rep ? { id: rep.exhibitorId, company_name: rep.name, event_id: 1 } : null
}

ep.get('/api/mp/dashboard/booth-photos', async (c) => {
  const ex = await dashboardCompanyOf(c)
  if (!ex) return c.json({ error: 'Sign in to your exhibitor dashboard to see your booth photos.' }, 401)
  // These are the Mumbai photos: an exhibitor of another edition gets no tab.
  if (Number(ex.event_id || 1) !== 1) return c.json({ eligible: false, company: ex.company_name, photos: [], zip: '' })
  const hit = await companyOfRow(c, ex.id)
  if (!hit) return c.json({ eligible: true, company: ex.company_name, photos: [], zip: '', parts: 0 })
  const al = await albumPhotos(c, hit[1])
  const photos = al.photos.map(p => ({ id: p.id, s: p.s, m: p.m, o: p.o, width: p.width, height: p.height, day: p.day, time: p.time, section: p.section, kind: p.kind }))
  const parts = Math.ceil(photos.length / store.ZIP_MAX_PHOTOS)
  return c.json({ eligible: true, company: ex.company_name || hit[1].name, photos, kinds: [...new Set(al.sections.map(s => s.kind))],
    zip: photos.length ? '/api/mp/dashboard/booth-photos/zip' : '', parts, per_part: store.ZIP_MAX_PHOTOS })
})

// The photos as ZIP files of at most ZIP_MAX_PHOTOS each: ?n=2 is the second hundred.
ep.get('/api/mp/dashboard/booth-photos/zip', async (c) => {
  const ex = await dashboardCompanyOf(c)
  if (!ex) return c.json({ error: 'Sign in to your exhibitor dashboard first.' }, 401)
  const hit = Number(ex.event_id || 1) === 1 ? await companyOfRow(c, ex.id) : null
  if (!hit) return c.json({ error: 'No photos to save together yet. Please save them one by one.' }, 404)
  const got = await photosOf(c, hit[1])
  const per = store.ZIP_MAX_PHOTOS, of = Math.ceil(got.length / per)
  const n = Math.min(Math.max(1, Math.floor(Number(c.req.query('n') || 1)) || 1), Math.max(1, of))
  const rows = await store.photosByPid(c, got.slice((n - 1) * per, n * per).map(g => g.pid))
  if (!rows.length) return c.json({ error: 'No photos yet.' }, 404)
  const slug = hit[1].name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'booth'
  return store.photosZip(c, rows, `bharat-ai-innovation-2026-${slug}${of > 1 ? `-part-${n}-of-${of}` : ''}.zip`)
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
  if (!sameText(await photoSig(c, key), String(c.req.query('k') || ''))) return brokenPage()
  const hit = await companyByPageKey(c, key)
  if (!hit) return brokenPage()
  const co = hit[1]
  const name = String((await exhibitorRows(c, co)).find(r => String(r.company_name || '').trim())?.company_name || co.name).trim()
  const al = await albumPhotos(c, co)
  const links: Record<string, { s: string; m: string; o: string; pid?: string; bytes?: number }> = {}
  for (const p of al.photos) links[p.id] = { s: p.s, m: p.m, o: p.o, pid: p.pid, bytes: p.bytes }
  return new Response(albumPageHTML({ name, org: '', ids: al.photos.map(p => p.id), got: links, focus: al.focus,
    sections: al.sections.map(s => ({ title: s.title, ids: s.ids })) }), { headers: PAGE_HEAD })
})

// "Save all" / "Save" on the company's page: the chosen originals as one ZIP. p = store ids
// joined by '.', as the page has them; only the company's own photos are ever in it.
boothAlbum.get('/photos/:key{x[0-9]+}/save', async (c) => {
  const key = c.req.param('key')
  if (!sameText(await photoSig(c, key), String(c.req.query('k') || ''))) return store.refuse(404, true, 'broken')
  const hit = await companyByPageKey(c, key)
  if (!hit) return store.refuse(404, true, 'broken')
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
  for (const [key, co] of await allCompanies(c)) {
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
  const key = c.req.param('key'); const co = await companyByKey(c, key)
  if (!co) return c.json({ error: 'No exhibitor by that key.' }, 404)
  const m = await mailFor(c, co)
  return c.json({ to: m.contact?.email || '', subject: m.subject, html: m.html, count: m.count, page: await pageUrl(c, personOf(co)) })
})

ep.post('/api/admin/booth-photos/:key/send', async (c) => {
  const key = c.req.param('key'); const co = await companyByKey(c, key)
  if (!co) return c.json({ error: 'No exhibitor by that key.' }, 404)
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
  const key = c.req.param('key'); const co = await companyByKey(c, key)
  if (!co) return c.json({ error: 'No exhibitor by that key.' }, 404)
  const r = await representativesOf(c, co)
  const sent = await alreadySent(c, key)
  // People the team added by hand (send-team's `extra`) are on none of our lists: they are
  // shown from the record of their send, so the list says everyone who has had it.
  const added: Representative[] = []
  for (const row of await all(c, "SELECT detail FROM admin_audit WHERE action = ? AND entity = 'booth_photos' AND entity_id = ? ORDER BY id", TEAM_AUDIT, key).catch(() => [] as any[])) {
    let d: any = {}
    try { d = JSON.parse(row.detail || '{}') } catch { d = {} }
    const e = String(d.to || '').toLowerCase()
    if (!e || !Array.isArray(d.why) || !d.why.includes('added by the team')) continue
    if (r.people.some(p => p.email === e) || added.some(p => p.email === e)) continue
    added.push({ email: e, name: String(d.name || ''), why: ['added by the team'], attendee_id: null, mobile: '' })
  }
  const everyone = [...r.people, ...added]
  const unsub = await unsubscribed(c, everyone.map(p => p.email))
  return c.json({ company: co.name, page: await pageUrl(c, personOf(co)), domains: r.domains, shared_domains: r.shared,
    people: everyone.map(p => ({ ...p, sent: sent.has(p.email), unsubscribed: unsub.has(p.email) })) })
})

// The photos email to everyone who represents the company and has not had it (each once).
// { dry: true } lists who it would go to; { only: [emails] } narrows it to those.
ep.post('/api/admin/booth-photos/:key/send-team', async (c) => {
  const key = c.req.param('key'); const co = await companyByKey(c, key)
  if (!co) return c.json({ error: 'No exhibitor by that key.' }, 404)
  const body = (await c.req.json().catch(() => ({}))) as any
  const only = Array.isArray(body.only) ? new Set(body.only.map((e: any) => String(e || '').trim().toLowerCase())) : null
  const r = await representativesOf(c, co)
  // extra: [{ email, name }], people the team names who are on none of our lists (a
  // coordinator known only from their emails to us; 24 Nov 2026). Only an address at one of
  // the company's own email domains is taken: the domain is the proof they are at that
  // company. Anyone else has to go on the company's team list first, and is refused here.
  const refused: { email: string; why: string }[] = []
  const extra: Representative[] = []
  for (const x of Array.isArray(body.extra) ? body.extra.slice(0, 20) : []) {
    const e = String(x?.email || '').trim().toLowerCase()
    if (!EMAIL_OK.test(e) || isNoEmail(e)) { refused.push({ email: e, why: 'That email address is not complete.' }); continue }
    if (r.people.some(p => p.email === e) || extra.some(p => p.email === e)) continue
    if (!r.domains.includes(domainOf(e))) {
      refused.push({ email: e, why: r.domains.length ? 'This address is not at the company’s own email domain (' + r.domains.join(', ') + '). Add them to the company’s team list first.'
        : 'We have no email domain of its own on record for this company, so an address cannot be checked. Add them to the company’s team list first.' })
      continue
    }
    extra.push({ email: e, name: String(x?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120), why: ['added by the team'], attendee_id: null, mobile: '' })
  }
  const everyone = [...r.people, ...extra]
  const sent = await alreadySent(c, key)
  const unsub = await unsubscribed(c, everyone.map(p => p.email))
  const skipped = everyone.filter(p => sent.has(p.email) || unsub.has(p.email)).map(p => ({ email: p.email, why: sent.has(p.email) ? 'already sent' : 'unsubscribed' }))
  const to = everyone.filter(p => !sent.has(p.email) && !unsub.has(p.email) && (!only || only.has(p.email)))
  const m = await mailParts(c, co)
  if (!m.got.length) return c.json({ error: 'None of their photos is in the photo store yet.' }, 400)
  if (body.dry === true) return c.json({ company: m.company, count: m.got.length, page: m.href, would: to, skipped, refused, shared_domains: r.shared })
  if (!hooks.sendEmail) return c.json({ error: 'Email is not set up here.' }, 500)
  const done: string[] = [], failed: { email: string; error: string }[] = []
  for (const p of to) {
    const mail = boothPhotosEmailHTML({ name: p.name, company: m.company, count: m.got.length, thumbs: m.thumbs, href: m.href, header: m.header, talk: m.talk })
    let res: any
    try { res = await hooks.sendEmail(c, p.email, mail.subject, mail.html, { unsubscribe: false }) } catch (e: any) { res = { ok: false, error: String(e?.message || e) } }
    if (res && res.ok === false) { failed.push({ email: p.email, error: String(res.error || 'not sent') }); continue }
    done.push(p.email)
    try { await hooks.audit?.(c, TEAM_AUDIT, 'booth_photos', key, { to: p.email, why: p.why, photos: m.got.length, ...(p.why.includes('added by the team') && p.name ? { name: p.name } : {}) }) } catch { /* sent either way */ }
  }
  return c.json({ ok: true, company: m.company, count: m.got.length, sent: done, failed, skipped, refused })
})

// ---- "Your photos are in your account": one email to each representative ----
// { dry: true } lists who it would go to; { only: [emails] } narrows it. Each person once
// (admin_audit ACCOUNT_AUDIT, detail.to), never an unsubscribed address.
async function accountSent(c: any, key: string): Promise<Set<string>> {
  const out = new Set<string>()
  for (const r of await all(c, "SELECT detail FROM admin_audit WHERE action = ? AND entity = 'booth_photos' AND entity_id = ?", ACCOUNT_AUDIT, key).catch(() => [] as any[])) {
    try { const d = JSON.parse(r.detail || '{}'); if (d.to) out.add(String(d.to).toLowerCase()) } catch { /* not JSON */ }
  }
  return out
}
ep.post('/api/admin/booth-photos/:key/send-account', async (c) => {
  const key = c.req.param('key'); const co = await companyByKey(c, key)
  if (!co) return c.json({ error: 'No exhibitor by that key.' }, 404)
  const body = (await c.req.json().catch(() => ({}))) as any
  const only = Array.isArray(body.only) ? new Set(body.only.map((e: any) => String(e || '').trim().toLowerCase())) : null
  const r = await representativesOf(c, co)
  const sent = await accountSent(c, key)
  const unsub = await unsubscribed(c, r.people.map(p => p.email))
  const skipped = r.people.filter(p => sent.has(p.email) || unsub.has(p.email)).map(p => ({ email: p.email, why: sent.has(p.email) ? 'already sent' : 'unsubscribed' }))
  const to = r.people.filter(p => !sent.has(p.email) && !unsub.has(p.email) && (!only || only.has(p.email)))
  const m = await mailParts(c, co, 'Your photos are in your account')
  if (!m.got.length) return c.json({ error: 'No photos of this company yet.', company: m.company, count: 0, would: [], skipped }, 400)
  const mailOf = (p: Representative) => accountPhotosEmailHTML({ name: p.name, company: m.company, email: p.email, count: m.got.length, thumbs: m.thumbs, kinds: m.kinds,
    signIn: signInHref(p.email), page: m.href, header: m.header })
  if (body.dry === true) {
    const sample = to[0] ? mailOf(to[0]) : null
    return c.json({ company: m.company, count: m.got.length, kinds: m.kinds, would: to.map(p => ({ email: p.email, name: p.name, why: p.why })), skipped,
      subject: sample?.subject || '', html: body.html === true ? sample?.html || '' : undefined })
  }
  if (!hooks.sendEmail) return c.json({ error: 'Email is not set up here.' }, 500)
  const done: string[] = [], failed: { email: string; error: string }[] = []
  for (const p of to) {
    const mail = mailOf(p)
    let res: any
    try { res = await hooks.sendEmail(c, p.email, mail.subject, mail.html, { unsubscribe: false }) } catch (e: any) { res = { ok: false, error: String(e?.message || e) } }
    if (res && res.ok === false) { failed.push({ email: p.email, error: String(res.error || 'not sent') }); continue }
    done.push(p.email)
    try { await hooks.audit?.(c, ACCOUNT_AUDIT, 'booth_photos', key, { to: p.email, why: p.why, photos: m.got.length }) } catch { /* sent either way */ }
  }
  return c.json({ ok: true, company: m.company, count: m.got.length, sent: done, failed, skipped })
})

// ---- Booth contacts with no email or no mobile (24 Nov 2026) ----
// The organiser: "if u dont find email or mobile of spoc send email to anita ram and tushar,
// they are organising team members, so they update emails and mobile nos". The booth contact
// (SPOC) is the exhibitors row's contact; a mobile missing there is looked for in their own
// registration and on the team list before the company is listed. Everyone else found at the
// company is listed beside it, to help the team find the right person.
type Gap = { key: string; company: string; booth: string; spoc: string; email: string; mobile: string; missing: string[]; exhibitor_ids: number[];
  others: { name: string; email: string; mobile: string; why: string[] }[] }
async function contactGaps(c: any): Promise<Gap[]> {
  const out: Gap[] = []
  for (const [key, co] of await allCompanies(c)) {
    const rows = await exhibitorRows(c, co)
    if (!rows.length) continue
    const contact = await contactOf(c, co)
    const email = String(contact?.email || '').trim().toLowerCase()
    const spoc = String(rows.find(r => String(r.contact_name || '').trim())?.contact_name || contact?.name || '').trim()
    let mobile = String(rows.find(r => String(r.contact_phone || '').replace(/\D/g, '').length >= 8)?.contact_phone || '').trim()
    if (!mobile && email) {
      const m = await one(c, `SELECT mobile FROM attendees WHERE lower(email) = ? AND trim(COALESCE(mobile, '')) <> ''
        UNION ALL SELECT mobile FROM exhibitor_team WHERE lower(email) = ? AND trim(mobile) <> '' LIMIT 1`, email, email)
      mobile = String(m?.mobile || '').trim()
    }
    const missing = [!email ? 'email' : '', !mobile ? 'mobile' : ''].filter(Boolean)
    if (!missing.length) continue
    const reps = await representativesOf(c, co).catch(() => ({ people: [] as Representative[] }))
    out.push({ key, company: contact?.company || co.name, booth: String(rows.find(r => String(r.booth_number || '').trim())?.booth_number || ''), spoc, email, mobile, missing,
      exhibitor_ids: rows.map(r => Number(r.id)),
      others: reps.people.filter(p => p.email !== email).slice(0, 6).map(p => ({ name: p.name, email: p.email, mobile: p.mobile, why: p.why })) })
  }
  out.sort((a, b) => b.missing.length - a.missing.length || a.company.localeCompare(b.company))
  return out
}
export function contactGapsEmailHTML(a: { name: string; rows: Gap[]; header: string }): { subject: string; html: string } {
  const subject = `${a.rows.length} exhibitor contacts to fill in: email or mobile missing`
  const cell = 'padding:8px 10px;border-bottom:1px solid #e7e9f5;font-size:14px;line-height:1.5;vertical-align:top'
  const none = '<span style="color:#b42318;font-weight:bold">missing</span>'
  const list = a.rows.map(r => `<tr>
      <td style="${cell}"><strong>${escH(r.company)}</strong>${r.booth ? `<br><span style="color:#6b7280">Booth ${escH(r.booth)}</span>` : ''}<br><span style="color:#6b7280">Exhibitor no. ${escH(r.exhibitor_ids.join(', '))}</span></td>
      <td style="${cell}">${r.spoc ? escH(r.spoc) : '<span style="color:#6b7280">not named</span>'}<br>Email: ${r.email ? escH(r.email) : none}<br>Mobile: ${r.mobile ? escH(r.mobile) : none}
        ${r.others.length ? `<br><span style="color:#6b7280;font-size:13px">Others we found there: ${r.others.map(o => escH([o.name, o.email, o.mobile].filter(Boolean).join(', '))).join('; ')}</span>` : ''}</td></tr>`).join('')
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f6f7fb;padding:24px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1e2140">
  <div style="max-width:680px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e7e9f5">
    ${a.header}
    <div style="padding:24px 24px 8px">
      <p style="font-size:15px;line-height:1.65;margin:0 0 12px">Dear ${escH(a.name ? dearName(a.name) : 'team')},</p>
      <p style="font-size:15px;line-height:1.65;margin:0 0 12px">We are sending every exhibitor their Mumbai photos, in their exhibitor account. For these ${escH(String(a.rows.length))} exhibitors, the main contact (SPOC) has no email address or no mobile number with us.</p>
      <p style="font-size:15px;line-height:1.65;margin:0 0 16px"><strong>Please fill them in:</strong> Admin, then Exhibitors, then <strong>Edit</strong> on the company: <strong>Contact Email</strong> and <strong>Contact Phone</strong>. Once a company has an email, we send its photos.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 18px">
        <tr><th align="left" style="${cell};background:#f6f7fb">Exhibitor</th><th align="left" style="${cell};background:#f6f7fb">Main contact</th></tr>
        ${list}
      </table>
      <p style="margin:18px 0 24px;font-size:14px;color:#555">Thank you,<br>Bharat AI Innovation app</p>
    </div>
  </div></body></html>`
  return { subject, html }
}
export const GAPS_AUDIT = 'booth_photos.contact_gaps'
ep.get('/api/admin/booth-contact-gaps', async (c) => c.json({ rows: await contactGaps(c) }))
// { to: [emails], dry? }: only to people who hold an Organiser pass for Mumbai (the organising team).
ep.post('/api/admin/booth-contact-gaps/send', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as any
  const want = [...new Set((Array.isArray(body.to) ? body.to : []).map((e: any) => String(e || '').trim().toLowerCase()).filter((e: string) => EMAIL_OK.test(e)))] as string[]
  if (!want.length) return c.json({ error: 'Choose who to send it to.' }, 400)
  const team = new Map<string, string>()
  for (let i = 0; i < want.length; i += 90) {
    const ch = want.slice(i, i + 90)
    for (const r of await all(c, `SELECT lower(email) AS email, name FROM attendees WHERE event_id = 1 AND badge_type = 'Organiser' AND lower(email) IN (${ch.map(() => '?').join(',')})`, ...ch).catch(() => [] as any[])) team.set(String(r.email), String(r.name || ''))
  }
  const refused = want.filter(e => !team.has(e))
  if (refused.length) return c.json({ error: 'Only the organising team (Organiser pass) can be sent this list: ' + refused.join(', ') }, 400)
  const rows = await contactGaps(c)
  const header = hooks.emailHeader ? hooks.emailHeader('Exhibitor contacts to fill in', MUMBAI_WORDS.line) : ''
  if (body.dry === true) return c.json({ to: want, rows, ...contactGapsEmailHTML({ name: team.get(want[0]) || '', rows, header }) })
  if (!rows.length) return c.json({ ok: true, sent: [], rows: 0, note: 'Every booth contact has an email and a mobile.' })
  if (!hooks.sendEmail) return c.json({ error: 'Email is not set up here.' }, 500)
  const done: string[] = [], failed: { email: string; error: string }[] = []
  for (const e of want) {
    const mail = contactGapsEmailHTML({ name: team.get(e) || '', rows, header })
    let res: any
    try { res = await hooks.sendEmail(c, e, mail.subject, mail.html, { unsubscribe: false }) } catch (x: any) { res = { ok: false, error: String(x?.message || x) } }
    if (res && res.ok === false) { failed.push({ email: e, error: String(res.error || 'not sent') }); continue }
    done.push(e)
    try { await hooks.audit?.(c, GAPS_AUDIT, 'booth_photos', 'contact-gaps', { to: e, companies: rows.map(r => r.key) }) } catch { /* sent either way */ }
  }
  return c.json({ ok: true, sent: done, failed, rows: rows.length })
})

export default ep
