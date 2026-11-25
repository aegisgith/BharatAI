import { Hono } from 'hono'
import { dearName } from './talk-brief'

// ==================== CERTIFICATES BY EMAIL (24 Nov 2026) ====================
//
// The organiser: "send email to all participants of Bharat AI a participation certificate
// ... for speakers we need to send a different certificate, and to innovation talk and
// showcase a different one. Show me the design first, I'll approve, then send." Then: "in
// case no photo on record don't send, send them email to update photo for getting the
// participation certificate", "in all category of certificate".
//
// Three groups, each drawn by /js/cert-render.js in the event style, with the person's photo:
//   participants  everyone checked in at the venue (attendees.checked_in_at), with their pass
//   speakers      everyone on a published session of the live programme (Admin -> Conference),
//                 one certificate per session; the 24 Nov corrections (who never came) hold
//   stage         every confirmed Innovation Stage talk that got a time (innovation_talks.starts_at);
//                 a talk that never got one is listed for the organisers, not sent
// No photo on record, no certificate: the person is asked for one instead (a participant adds
// it in the app; a speaker or presenter replies with it).
//
// Two bulk runs (index.tsx campaigns, the minute clock): kind cert_ready (has a photo: "your
// certificate is ready") and cert_photo (no photo: "add your photo"). ref_id is the group
// (1 participants, 2 speakers, 3 stage). Speakers and presenters are written to by address,
// one email listing every certificate of that address. Every send checks again, so someone
// who added a photo since the list was made is skipped by cert_photo and picked up by the
// next cert_ready, and nobody gets the same email twice.
//
// The email's button opens /certificate/<code>?download=1 (index.tsx), which draws the
// certificate in the browser and saves it; the same code is the certificate's QR.
//
// A fourth group the same day, the organiser: "Pillai students who volunteered, we need to
// make their certificate with photo":
//   volunteers    the people ticked as volunteers (ref_id 4), who get a certificate of
//                 appreciation for volunteering (blue) instead of the participation one, on
//                 the same C<attendee> code. See VOLUNTEERS below.

type Hooks = {
  sendEmail?: (c: any, to: string, subject: string, html: string) => Promise<{ ok: boolean; error?: string }>
  emailHeader?: (title: string, subtitle: string) => string
  certVerifyUrl?: (c: any, kind: 'C' | 'W' | 'P' | 'S' | 'T', id: any, ref?: any) => Promise<string>
  passLabel?: (badge: any, payment: any) => string
  // The app link that signs a participant in and opens their profile, photo first.
  profileLink?: (c: any, eventId: number, email: string) => Promise<string>
  audit?: (c: any, action: string, entity: string, id: any, details?: any) => Promise<void>
}
let hooks: Hooks = {}
export function configureCertificates(h: Hooks) { hooks = { ...hooks, ...h } }

const cr = new Hono<{ Bindings: any }>()
const SITE = 'https://bharataiinnovation.com'
// Bump with the ?v= on /app and /admin (index.tsx) whenever cert-render.js changes.
export const CERT_RENDER_V = '2026112407'
const escH = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const clean = (v: any) => String(v ?? '').replace(/\s+/g, ' ').trim()
const emailOk = (e: any) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim()) && !/@no-email\.invalid$/i.test(String(e || ''))
const lc = (e: any) => String(e || '').trim().toLowerCase()

export type CertGroup = 'participants' | 'speakers' | 'stage' | 'volunteers'
export const CERT_GROUP_REF: Record<CertGroup, number> = { participants: 1, speakers: 2, stage: 3, volunteers: 4 }
export const certGroupOfRef = (ref: any): CertGroup => (Number(ref) === 2 ? 'speakers' : Number(ref) === 3 ? 'stage' : Number(ref) === 4 ? 'volunteers' : 'participants')
export const CERT_KINDS = ['cert_ready', 'cert_photo']
const GROUPS: CertGroup[] = ['participants', 'speakers', 'stage', 'volunteers']
// Participants and volunteers are attendees, who add their own photo in the app.
const byAttendee = (g: CertGroup) => g === 'participants' || g === 'volunteers'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const dayOf = (iso: any): string => {
  const p = String(iso || '').slice(0, 10).split('-')
  return p.length === 3 && MONTHS[Number(p[1]) - 1] ? Number(p[2]) + ' ' + MONTHS[Number(p[1]) - 1] + ' ' + p[0] : ''
}
const ROLE_WORDS: Record<string, string> = { moderator: 'Moderator', panellist: 'Panellist', keynote: 'Keynote Speaker', speaker: 'Speaker', host: 'Host', chair: 'Chair' }
const roleWord = (role: any, type: any) => (String(type || '').toLowerCase() === 'keynote' && String(role || 'speaker') === 'speaker' ? 'Keynote Speaker' : ROLE_WORDS[String(role || 'speaker').toLowerCase()] || 'Speaker')

// ---------- who ----------

// VOLUNTEERS. The 33 Pillai University students who helped at the venue hold Organiser
// passes (one Admin import, 19 Nov 2026), as the organising team does, so who volunteered
// is a list: app_settings 'cert_volunteers' = {"ids":[attendee ids]}, ticked in Admin ->
// After the Event -> Certificates. Until it is first saved, the list is the Organiser pass
// holders checked in at the venue who have a Pillai student address, or no designation and
// no company (the import left both blank; every team member has a title). A ticked person
// gets the volunteer certificate whether or not the badge desk scanned them, and never the
// participation one as well.
const VOL_KEY = 'cert_volunteers'
const PILLAI_STUDENT = /@student\.pillai\.edu\.in$/i
const ATT_COLS = 'id, name, email, badge_type, payment_status, job_title, company, avatar_url, unsubscribed_at, checked_in_at'

async function savedVolunteerIds(c: any): Promise<number[] | null> {
  try {
    const r = await c.env.DB.prepare('SELECT value FROM app_settings WHERE key = ?').bind(VOL_KEY).first() as any
    if (!r) return null
    const ids = JSON.parse(String(r.value || '{}')).ids
    return Array.isArray(ids) ? ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : null
  } catch { return null }
}
async function organiserRows(c: any): Promise<any[]> {
  const { results } = await c.env.DB.prepare(`SELECT ${ATT_COLS} FROM attendees WHERE event_id = 1 AND badge_type = 'Organiser' ORDER BY id`).all()
  return (results as any[]) || []
}
const volunteerByDefault = (a: any) => !!a.checked_in_at
  && (PILLAI_STUDENT.test(String(a.email || '').trim()) || (!clean(a.job_title) && !clean(a.company)))

export async function volunteerIdSet(c: any): Promise<Set<number>> {
  const saved = await savedVolunteerIds(c)
  if (saved) return new Set(saved)
  try { return new Set((await organiserRows(c)).filter(volunteerByDefault).map(a => Number(a.id))) } catch { return new Set() }
}
// What the certificate says under a volunteer's name: their own designation if they have
// one, else their college for a Pillai student address.
const volunteerDesignation = (a: any) => [clean(a.job_title), clean(a.company)].filter(Boolean).join(', ')
  || (PILLAI_STUDENT.test(String(a.email || '').trim()) ? 'Student, Pillai University' : '')

// The volunteers (one bound value: the ids go in as JSON, never a growing IN list).
async function volunteerRows(c: any, where = '', binds: any[] = []): Promise<any[]> {
  const ids = [...await volunteerIdSet(c)]
  if (!ids.length) return []
  const { results } = await c.env.DB.prepare(
    `SELECT ${ATT_COLS} FROM attendees
      WHERE event_id = 1 AND id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))${where} ORDER BY id`
  ).bind(JSON.stringify(ids), ...binds).all()
  return ((results as any[]) || []).map(a => ({ ...a, photo: clean(a.avatar_url), designation: volunteerDesignation(a) }))
}

// For index.tsx (the app's certificate button and Admin): a volunteer's certificate, or null.
export async function certVolunteerOf(c: any, id: number): Promise<{ designation: string } | null> {
  const a = (await volunteerRows(c, ' AND id = ?', [Number(id)]))[0]
  return a ? { designation: a.designation } : null
}

// Everyone checked in at the venue with an address, volunteers apart. The pass is the one
// the certificate names (a paid tier not paid for reads as the Visitor Pass, as at the desk).
async function participantRows(c: any, where = '', binds: any[] = []): Promise<any[]> {
  const { results } = await c.env.DB.prepare(
    `SELECT ${ATT_COLS} FROM attendees WHERE event_id = 1 AND checked_in_at IS NOT NULL${where} ORDER BY id`
  ).bind(...binds).all()
  const vol = await volunteerIdSet(c)
  return ((results as any[]) || []).filter(a => !vol.has(Number(a.id))).map(a => ({
    ...a, pass: hooks.passLabel ? hooks.passLabel(a.badge_type, a.payment_status) : clean(a.badge_type) || 'Visitor Pass',
    photo: clean(a.avatar_url), designation: [clean(a.job_title), clean(a.company)].filter(Boolean).join(', '),
  }))
}

// Every speaker on a published session of the live programme, one row per session.
async function speakerRows(c: any, where = '', binds: any[] = []): Promise<any[]> {
  const { results } = await c.env.DB.prepare(
    `SELECT sp.id AS speaker_id, sp.name, sp.role AS sp_role, sp.organisation, sp.photo_url, sp.email,
            s.id AS session_id, s.title, s.session_type, s.room, s.start_time, ss.role AS srole
       FROM speakers sp JOIN session_speakers ss ON ss.speaker_id = sp.id
       JOIN sessions s ON s.id = ss.session_id LEFT JOIN session_admin sa ON sa.session_id = s.id
      WHERE s.event_id = 1 AND sp.is_published = 1 AND COALESCE(sa.status, 'published') = 'published'${where}
      ORDER BY s.start_time, s.id, ss.sort_order`
  ).bind(...binds).all()
  return ((results as any[]) || []).map(r => ({
    ...r, photo: clean(r.photo_url),
    designation: [clean(r.sp_role), clean(r.organisation)].filter(Boolean).join(' · '),
  }))
}

// Every confirmed Innovation Stage talk that got a time. The address is the speaker's own,
// else the booth contact of the exhibitor whose talk it was.
async function stageRows(c: any, where = '', binds: any[] = [], withUntimed = false): Promise<any[]> {
  const sql = (email: string) => `SELECT t.id, t.speaker_name, t.speaker_title, t.company, t.topic, t.speaker_photo_url, t.starts_at, t.exhibitor_id,
            ${email}
       FROM innovation_talks t LEFT JOIN exhibitors e ON e.id = t.exhibitor_id
      WHERE t.event_id = 1 AND t.status = 'confirmed'${withUntimed ? '' : " AND COALESCE(t.starts_at, '') != ''"}${where}
      ORDER BY t.starts_at, t.id`
  let rows: any[] = []
  try {
    rows = ((await c.env.DB.prepare(sql("COALESCE(t.speaker_email, '') AS own_email, COALESCE(e.contact_email, '') AS booth_email")).bind(...binds).all()).results as any[]) || []
  } catch { /* before speaker_email: booth contacts only */
    rows = ((await c.env.DB.prepare(sql("'' AS own_email, COALESCE(e.contact_email, '') AS booth_email")).bind(...binds).all()).results as any[]) || []
  }
  return rows.map(t => {
    const own = emailOk(t.own_email) ? lc(t.own_email) : ''
    return {
      ...t, email: own || (emailOk(t.booth_email) ? lc(t.booth_email) : ''), via_booth: !own && emailOk(t.booth_email),
      name: clean(t.speaker_name), photo: clean(t.speaker_photo_url),
      designation: [clean(t.speaker_title), clean(t.company)].filter(Boolean).join(', '),
    }
  })
}

// One recipient per address for speakers and presenters: every certificate of theirs, and
// whether every one of them has a photo.
function byAddress(rows: any[]): any[] {
  const m = new Map<string, any>()
  for (const r of rows) {
    const k = lc(r.email)
    if (!emailOk(k)) continue
    const g = m.get(k) || { email: k, name: r.name, items: [], photo: true }
    g.items.push(r)
    if (!r.photo) g.photo = false
    m.set(k, g)
  }
  return [...m.values()]
}

// Already written to by this kind for this group (sent, or waiting in a run).
async function alreadySet(c: any, kind: string, group: CertGroup): Promise<Set<string>> {
  const out = new Set<string>()
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT cr.attendee_id, cr.email FROM campaign_recipients cr JOIN campaigns cp ON cp.id = cr.campaign_id
        WHERE cp.kind = ? AND cp.ref_id = ? AND cr.status IN ('pending', 'sending', 'sent')`
    ).bind(kind, CERT_GROUP_REF[group]).all()
    for (const r of (results as any[]) || []) { if (r.attendee_id) out.add('a' + r.attendee_id); if (r.email) out.add(lc(r.email)) }
  } catch { /* no campaigns table: nobody yet */ }
  return out
}

// The campaign's list. audience for participants: 'all', or 'only:' and the passes joined by |.
export async function certAudienceRows(c: any, kind: string, group: CertGroup, audience: string): Promise<any[]> {
  const wantPhoto = kind === 'cert_ready'
  const done = await alreadySet(c, kind, group)
  if (byAttendee(group)) {
    const only = group === 'participants' && audience.startsWith('only:') ? new Set(audience.slice(5).split('|').map(clean).filter(Boolean)) : null
    return (group === 'volunteers' ? await volunteerRows(c) : await participantRows(c))
      .filter(a => emailOk(a.email) && !a.unsubscribed_at && (!!a.photo === wantPhoto) && (!only || only.has(a.pass)))
      .filter(a => !done.has('a' + a.id) && !done.has(lc(a.email)))
      .map(a => ({ id: a.id, name: a.name, email: String(a.email).trim() }))
  }
  const list = byAddress(group === 'speakers' ? await speakerRows(c) : await stageRows(c))
  return list.filter(g => g.photo === wantPhoto && !done.has(g.email)).map(g => ({ id: null, name: g.name, email: g.email }))
}

// ---------- what each certificate says (the download page and the check page) ----------

// The options BhaiCert.draw takes, and the words for the check page. null: not ours.
export async function certDrawData(c: any, kind: string, id: number, ref: string): Promise<any | null> {
  const verify = hooks.certVerifyUrl ? await hooks.certVerifyUrl(c, kind as any, id, ref || undefined) : ''
  if (kind === 'C') {
    // A volunteer's C code is their volunteer certificate.
    const v = (await volunteerRows(c, ' AND id = ?', [id]))[0]
    if (v) {
      return {
        group: 'volunteers', name: v.name, photo: v.photo, designation: v.designation, certId: 'BHAI-VOL-' + String(id).padStart(4, '0'),
        certName: 'Volunteer, Bharat AI Innovation 2026', file: 'BharatAI-2026-Volunteer-Certificate.png',
        draw: { id, name: v.name, designation: v.designation, photo: v.photo, verifyUrl: verify, volunteer: { designation: v.designation } },
      }
    }
    const a = (await participantRows(c, ' AND id = ?', [id]))[0]
    if (!a) return null
    return {
      group: 'participants', name: a.name, photo: a.photo, certId: 'BHAI-CERT-' + String(id).padStart(4, '0'),
      certName: 'Certificate of Participation: Bharat AI Innovation 2026', file: 'BharatAI-2026-Certificate.png',
      draw: { id, name: a.name, pass: a.pass, designation: a.designation, photo: a.photo, verifyUrl: verify },
    }
  }
  if (kind === 'S') {
    const r = (await speakerRows(c, ' AND sp.id = ? AND s.id = ?', [id, Number(ref)]))[0]
    if (!r) return null
    return {
      group: 'speakers', name: r.name, photo: r.photo, certId: 'BHAI-SPK-' + String(id).padStart(4, '0'),
      certName: roleWord(r.srole, r.session_type) + ', Bharat AI Innovation 2026', file: 'BharatAI-2026-Speaker-Certificate.png',
      role: roleWord(r.srole, r.session_type), session: r.title, room: r.room, day: dayOf(r.start_time),
      draw: { id, name: r.name, designation: r.designation, photo: r.photo, verifyUrl: verify,
        speaker: { id, role: String(r.srole || 'speaker').toLowerCase(), session: { title: r.title, type: r.session_type, room: r.room, start: r.start_time } } },
    }
  }
  if (kind === 'T') {
    const t = (await stageRows(c, ' AND t.id = ?', [id]))[0]
    if (!t) return null
    return {
      group: 'stage', name: t.name, photo: t.photo, certId: 'BHAI-IT-' + String(id).padStart(4, '0'),
      certName: 'Innovation Stage Presenter, Bharat AI Innovation 2026', file: 'BharatAI-2026-Innovation-Stage-Certificate.png',
      topic: t.topic, company: t.company, day: dayOf(t.starts_at),
      draw: { id, name: t.name, photo: t.photo, verifyUrl: verify,
        stage: { id, topic: t.topic, title: t.speaker_title, company: t.company, slot: t.starts_at } },
    }
  }
  return null
}

// ---------- the emails ----------

const btn = (href: string, label: string) =>
  `<a href="${escH(href)}" style="display:inline-block;padding:13px 26px;background:#C84F00;color:#fff;text-decoration:none;border-radius:10px;font-weight:bold;font-size:15px">${escH(label)}</a>`
const p = (html: string, extra = '') => `<p style="font-size:15px;line-height:1.65;margin:0 0 14px${extra}">${html}</p>`

export function certEmailHTML(o: {
  variant: 'ready' | 'photo'; group: CertGroup; name: string; header: string
  items: { label: string; href: string }[]; photoHref?: string
}): { subject: string; html: string } {
  const what = o.group === 'participants' ? 'certificate of participation' : 'certificate of appreciation'
  const thanks = o.group === 'speakers' ? 'Thank you for speaking at Bharat AI Innovation 2026 at World Trade Center, Mumbai, on 20 and 21 November.'
    : o.group === 'stage' ? 'Thank you for presenting on the Innovation Stage at Bharat AI Innovation 2026 at World Trade Center, Mumbai, on 20 and 21 November.'
    : o.group === 'volunteers' ? 'Thank you for volunteering at Bharat AI Innovation 2026 at World Trade Center, Mumbai, on 20 and 21 November. Your help at the desks and in the halls made the two days work.'
    : 'Thank you for coming to Bharat AI Innovation 2026 at World Trade Center, Mumbai, on 20 and 21 November.'
  const many = o.items.length > 1
  let subject: string, body: string
  if (o.variant === 'ready') {
    subject = o.group === 'participants' ? 'Your certificate: Bharat AI Innovation 2026, Mumbai'
      : o.group === 'speakers' ? 'Thank you for speaking: your Bharat AI Innovation 2026 certificate'
      : o.group === 'volunteers' ? 'Thank you for volunteering: your Bharat AI Innovation 2026 certificate'
      : 'Thank you for presenting: your Bharat AI Innovation 2026 certificate'
    body = p(escH(thanks))
      + p(many ? `Your ${what}s are ready, one for each session, with your photo and your name:` : `Your ${what} is ready, with your photo and your name.`)
      + (many
        ? `<ul style="margin:0 0 18px;padding-left:20px">${o.items.map(i => `<li style="font-size:15px;line-height:1.6;margin:0 0 8px"><a href="${escH(i.href)}" style="color:#C84F00;font-weight:bold">${escH(i.label)}</a></li>`).join('')}</ul>`
        : `<p style="margin:0 0 20px;text-align:center">${btn(o.items[0]?.href || SITE, 'Download my certificate')}</p>`)
      + p('The page that opens has a button that adds it to your LinkedIn profile. We would love it if you share it and tag Bharat AI Innovation.')
      + p('Every certificate carries a QR code. Scanning it opens a page on our website that confirms the certificate is genuine.', ';color:#555;font-size:14px')
  } else {
    subject = o.group === 'participants' ? 'Add your photo to get your Bharat AI Innovation 2026 certificate'
      : o.group === 'volunteers' ? 'Your Bharat AI Innovation 2026 volunteer certificate is ready: add your photo to download it'
      : 'A photo for your Bharat AI Innovation 2026 certificate'
    // A volunteer's is ready the moment they add a photo (organiser, 25 Nov 2026: "send Pillai
    // volunteers that their certificate is ready, they need to update their photos and they can
    // download the certificate").
    body = p(escH(thanks))
      + (o.group === 'volunteers'
        ? p(`Your ${what} for volunteering is ready. It carries your photo, and we do not have one on record for you yet, so add it first and then download your certificate.`)
        : p(`Your ${what} carries your photo, and we do not have one on record for you yet.`))
      + (byAttendee(o.group)
        ? `<ol style="margin:0 0 18px;padding-left:20px;font-size:15px;line-height:1.65">
             <li style="margin:0 0 6px">Tap <b>Add my photo</b>. It signs you in to the event app, at your profile.</li>
             <li style="margin:0 0 6px">Add a clear photo of your face and save.</li>
             <li>Then ${o.group === 'volunteers' ? 'download your certificate' : 'open your certificate'}: <a href="${escH(o.items[0]?.href || SITE)}" style="color:#C84F00;font-weight:bold">${o.group === 'volunteers' ? 'Download my certificate' : 'My certificate'}</a>.</li></ol>
           <p style="margin:0 0 20px;text-align:center">${btn(o.photoHref || SITE + '/app', 'Add my photo')}</p>`
        : p('Please reply to this email with a clear photo of yourself. A head and shoulders photo works best. We will add it and send your certificate.'))
  }
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f6f7fb;padding:24px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1e2140">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e7e9f5">
    ${o.header}
    <div style="padding:26px 26px 8px">
      ${p(escH(`Dear ${dearName(o.name)},`))}
      ${body}
      <p style="font-size:14px;line-height:1.65;margin:16px 0 0">See you at Bharat AI Innovation, New Delhi: 28 and 29 July 2027 at Bharat Mandapam. <a href="${SITE}/" style="color:#C84F00;font-weight:bold">See the Delhi edition</a></p>
      <p style="margin:22px 0 24px;font-size:14px;color:#555">Team Bharat AI Innovation<br>
        <span style="color:#888">20-21 November 2026 &middot; World Trade Center, Mumbai</span></p>
    </div>
  </div></body></html>`
  return { subject, html }
}

// The email for one recipient, as it would go. preview: links that go nowhere.
async function mailFor(c: any, variant: 'ready' | 'photo', group: CertGroup, who: { name: string; email: string; items: { kind: string; id: number; ref?: any; label: string }[] }, preview = false) {
  const header = hooks.emailHeader ? hooks.emailHeader(group === 'participants' ? 'Your certificate' : 'Thank you', '20-21 November 2026 · World Trade Center, Mumbai') : ''
  const items: { label: string; href: string }[] = []
  for (const i of who.items) {
    const v = preview ? '#preview' : hooks.certVerifyUrl ? await hooks.certVerifyUrl(c, i.kind as any, i.id, i.ref) : ''
    items.push({ label: i.label, href: v && v !== '#preview' ? v + '?download=1' : v || SITE })
  }
  const photoHref = byAttendee(group)
    ? (preview ? '#preview' : hooks.profileLink ? await hooks.profileLink(c, 1, lc(who.email)) : SITE + '/app')
    : ''
  return certEmailHTML({ variant, group, name: who.name, header, items, photoHref })
}

const speakerItem = (r: any) => ({ kind: 'S', id: Number(r.speaker_id), ref: r.session_id, label: roleWord(r.srole, r.session_type) + ': ' + clean(r.title) })
const stageItem = (t: any) => ({ kind: 'T', id: Number(t.id), label: 'Innovation Stage: ' + clean(t.topic || 'your talk') })

// One recipient (the campaign's send route). Skips, never fails, anyone who no longer fits.
cr.post('/api/admin/certificates/send', async (c) => {
  const variant = c.req.query('variant') === 'photo' ? 'photo' : 'ready'
  const group = (GROUPS.includes(String(c.req.query('group')) as CertGroup) ? c.req.query('group') : '') as CertGroup
  if (!group) return c.json({ error: 'Unknown certificate group.' }, 400)
  if (!hooks.sendEmail) return c.json({ error: 'Email is not set up on this server.' }, 503)
  let who: any = null
  if (byAttendee(group)) {
    const vol = group === 'volunteers'
    const a = (await (vol ? volunteerRows : participantRows)(c, ' AND id = ?', [Number(c.req.query('attendee'))]))[0]
    if (!a) return c.json({ skipped: true, reason: vol ? 'No longer on the volunteers list' : 'Not checked in at the venue, on the volunteers list, or no longer registered' })
    if (!emailOk(a.email)) return c.json({ skipped: true, reason: 'No email address' })
    if (a.unsubscribed_at) return c.json({ skipped: true, reason: 'Unsubscribed' })
    if (variant === 'ready' && !a.photo) return c.json({ skipped: true, reason: 'No photo now: the photo request covers them' })
    if (variant === 'photo' && a.photo) return c.json({ skipped: true, reason: 'Has a photo now: the next certificate run sends theirs' })
    who = { name: a.name, email: String(a.email).trim(), items: [{ kind: 'C', id: Number(a.id), label: vol ? 'Volunteer certificate' : 'Certificate of participation' }] }
  } else {
    const email = lc(c.req.query('email'))
    if (!emailOk(email)) return c.json({ skipped: true, reason: 'No email address' })
    const rows = group === 'speakers' ? await speakerRows(c, ' AND LOWER(TRIM(sp.email)) = ?', [email]) : (await stageRows(c)).filter(t => t.email === email)
    if (!rows.length) return c.json({ skipped: true, reason: group === 'speakers' ? 'No longer on the programme' : 'No talk on the Innovation Stage at this address' })
    const allPhotos = rows.every(r => !!r.photo)
    if (variant === 'ready' && !allPhotos) return c.json({ skipped: true, reason: 'No photo on record: the photo request covers them' })
    if (variant === 'photo' && allPhotos) return c.json({ skipped: true, reason: 'Has a photo now: the next certificate run sends theirs' })
    who = { name: rows[0].name, email, items: rows.map(group === 'speakers' ? speakerItem : stageItem) }
  }
  const mail = await mailFor(c, variant, group, who)
  const sent = await hooks.sendEmail(c, who.email, mail.subject, mail.html)
  if (!sent.ok) return c.json({ error: sent.error || 'The email did not go.' }, 502)
  return c.json({ success: true })
})

// For Admin -> After the Event -> Certificates: who is in each group, with and without a
// photo, the passes, who has no address, and each email as it would go.
cr.get('/api/admin/certificates', async (c) => {
  const out: any = { groups: {} }
  const doneOf = async (group: CertGroup) => ({ ready: await alreadySet(c, 'cert_ready', group), photo: await alreadySet(c, 'cert_photo', group) })
  try {
    const parts = await participantRows(c)
    const d = await doneOf('participants')
    const passes: Record<string, { with_photo: number; no_photo: number }> = {}
    for (const a of parts) { const k = a.pass || 'Visitor Pass'; passes[k] = passes[k] || { with_photo: 0, no_photo: 0 }; if (a.photo) passes[k].with_photo++; else passes[k].no_photo++ }
    out.groups.participants = {
      total: parts.length, with_photo: parts.filter(a => a.photo).length, no_photo: parts.filter(a => !a.photo).length,
      no_email: parts.filter(a => !emailOk(a.email)).length, unsubscribed: parts.filter(a => a.unsubscribed_at).length,
      passes: Object.entries(passes).map(([pass, n]) => ({ pass, ...n })).sort((x, y) => (y.with_photo + y.no_photo) - (x.with_photo + x.no_photo)),
      rows: parts.map(a => ({ id: a.id, name: a.name, email: a.email, pass: a.pass, designation: a.designation, photo: a.photo,
        sent: d.ready.has('a' + a.id) ? 'certificate' : d.photo.has('a' + a.id) ? 'photo request' : '' })),
    }
  } catch (e: any) { out.groups.participants = { error: String(e?.message || e).slice(0, 200) } }
  try {
    const rows = await speakerRows(c)
    const d = await doneOf('speakers')
    const people = byAddress(rows)
    const noEmail = [...new Map(rows.filter(r => !emailOk(r.email)).map(r => [r.speaker_id, r])).values()]
    out.groups.speakers = {
      certificates: rows.length, addresses: people.length, with_photo: people.filter(g => g.photo).length, no_photo: people.filter(g => !g.photo).length,
      no_email: noEmail.map(r => ({ name: r.name, session: r.title })),
      rows: people.map(g => ({ name: g.name, email: g.email, photo: g.photo, sessions: g.items.map((r: any) => roleWord(r.srole, r.session_type) + ': ' + clean(r.title)),
        designation: g.items[0].designation, sent: d.ready.has(g.email) ? 'certificate' : d.photo.has(g.email) ? 'photo request' : '' })),
    }
  } catch (e: any) { out.groups.speakers = { error: String(e?.message || e).slice(0, 200) } }
  try {
    const all = await stageRows(c, '', [], true)
    const timed = all.filter(t => clean(t.starts_at))
    const d = await doneOf('stage')
    const people = byAddress(timed)
    out.groups.stage = {
      certificates: timed.length, addresses: people.length, with_photo: people.filter(g => g.photo).length, no_photo: people.filter(g => !g.photo).length,
      no_email: timed.filter(t => !t.email).map(t => ({ name: t.name, company: t.company, topic: t.topic })),
      no_time: all.filter(t => !clean(t.starts_at)).map(t => ({ name: t.name, company: t.company, topic: t.topic })),
      rows: people.map(g => ({ name: g.name, email: g.email, photo: g.photo, via_booth: g.items.some((t: any) => t.via_booth),
        talks: g.items.map((t: any) => clean(t.topic)), designation: g.items[0].designation,
        sent: d.ready.has(g.email) ? 'certificate' : d.photo.has(g.email) ? 'photo request' : '' })),
    }
  } catch (e: any) { out.groups.stage = { error: String(e?.message || e).slice(0, 200) } }
  try {
    const vols = await volunteerRows(c)
    const d = await doneOf('volunteers')
    const on = new Set(vols.map(a => Number(a.id)))
    // Who can be ticked: every Organiser pass holder, and anyone already on the list.
    const orgs = await organiserRows(c)
    const choices = [...orgs, ...vols.filter(v => !orgs.some(o => Number(o.id) === Number(v.id)))]
    out.groups.volunteers = {
      total: vols.length, with_photo: vols.filter(a => a.photo).length, no_photo: vols.filter(a => !a.photo).length,
      no_email: vols.filter(a => !emailOk(a.email)).length, unsubscribed: vols.filter(a => a.unsubscribed_at).length,
      not_checked_in: vols.filter(a => !a.checked_in_at).length, saved: !!(await savedVolunteerIds(c)),
      rows: vols.map(a => ({ id: a.id, name: a.name, email: a.email, designation: a.designation, photo: a.photo, checked_in: !!a.checked_in_at,
        sent: d.ready.has('a' + a.id) ? 'certificate' : d.photo.has('a' + a.id) ? 'photo request' : '' })),
      choices: choices.map(a => ({ id: a.id, name: a.name, email: a.email, title: [clean(a.job_title), clean(a.company)].filter(Boolean).join(', '),
        checked_in: !!a.checked_in_at, photo: !!clean(a.avatar_url), on: on.has(Number(a.id)) })),
    }
  } catch (e: any) { out.groups.volunteers = { error: String(e?.message || e).slice(0, 200) } }
  // Each email as it would go, to a made-up person.
  const sample: Record<CertGroup, any> = {
    participants: { name: 'Asha Kumar', email: 'preview@example.com', items: [{ kind: 'C', id: 0, label: 'Certificate of participation' }] },
    speakers: { name: 'Dr. Asha Kumar', email: 'preview@example.com', items: [{ kind: 'S', id: 0, ref: 0, label: 'Panellist: AI for Viksit Bharat' }, { kind: 'S', id: 0, ref: 0, label: 'Moderator: Improving Learning Outcomes with AI' }] },
    stage: { name: 'Asha Kumar', email: 'preview@example.com', items: [{ kind: 'T', id: 0, label: 'Innovation Stage: Reimagining Marketplaces in the era of AI Agents' }] },
    volunteers: { name: 'Asha Kumar', email: 'preview@example.com', items: [{ kind: 'C', id: 0, label: 'Volunteer certificate' }] },
  }
  out.emails = {}
  for (const g of GROUPS) {
    out.emails[g] = { ready: await mailFor(c, 'ready', g, sample[g], true), photo: await mailFor(c, 'photo', g, sample[g], true) }
  }
  return c.json(out)
})

// A test of one email (sample person, links that go nowhere) to an address the organiser types.
cr.post('/api/admin/certificates/test', async (c) => {
  const b = await c.req.json().catch(() => ({})) as any
  const to = String(b.to || '').trim()
  if (!emailOk(to)) return c.json({ error: 'Type the address to send the test to.' }, 400)
  const group = (GROUPS.includes(String(b.group) as CertGroup) ? b.group : 'participants') as CertGroup
  const variant = b.variant === 'photo' ? 'photo' : 'ready'
  if (!hooks.sendEmail) return c.json({ error: 'Email is not set up on this server.' }, 503)
  const mail = await mailFor(c, variant, group, { name: 'Asha Kumar', email: to, items: [{ kind: group === 'speakers' ? 'S' : group === 'stage' ? 'T' : 'C', id: 0, ref: 0, label: 'Your certificate' }] }, true)
  const sent = await hooks.sendEmail(c, to, '[Test] ' + mail.subject, mail.html)
  if (!sent.ok) return c.json({ error: sent.error || 'The email did not go.' }, 502)
  return c.json({ success: true })
})

// Who volunteered, as ticked in Admin: the whole list each time (attendees of the event only).
cr.post('/api/admin/certificates/volunteers', async (c) => {
  const b = await c.req.json().catch(() => ({})) as any
  if (!Array.isArray(b.ids)) return c.json({ error: 'Send the list of volunteers.' }, 400)
  const want = [...new Set(b.ids.map((v: any) => parseInt(String(v), 10)).filter((n: number) => Number.isInteger(n) && n > 0))].slice(0, 1000) as number[]
  let ids: number[] = []
  if (want.length) {
    const { results } = await c.env.DB.prepare(
      'SELECT id FROM attendees WHERE event_id = 1 AND id IN (SELECT CAST(value AS INTEGER) FROM json_each(?)) ORDER BY id'
    ).bind(JSON.stringify(want)).all()
    ids = ((results as any[]) || []).map(r => Number(r.id))
  }
  const before = await volunteerIdSet(c)
  await c.env.DB.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  ).bind(VOL_KEY, JSON.stringify({ ids })).run()
  const after = new Set(ids)
  try {
    if (hooks.audit) await hooks.audit(c, 'certificates.volunteers', 'app_settings', VOL_KEY, {
      count: ids.length, added: ids.filter(n => !before.has(n)), removed: [...before].filter(n => !after.has(n)),
    })
  } catch { /* the list is saved; the audit row is a record only */ }
  return c.json({ success: true, count: ids.length })
})

// ---------- the page the email opens: /certificate/<code>?download=1 ----------

export function certDownloadPageHTML(o: { data: any | null; state: 'ok' | 'no-photo' | 'bad'; code: string }): string {
  const d = o.data
  const top = `<div class="top"><img src="/images/cert/bharat-on-dark.png" alt="Bharat AI Innovation"><div class="hi"><span class="s">भारत</span> <span class="w">एआई</span> <span class="g">इनोवेशन</span></div></div><div class="tri"></div>`
  const MAIL = '<a href="mailto:register@bharataiinnovation.com">register@bharataiinnovation.com</a>'
  let body = ''
  if (o.state === 'bad' || !d) {
    body = `<h1>We could not find this certificate</h1><p>The link is not complete, or the certificate is no longer on our list. Write to ${MAIL} and we will send it to you.</p>`
  } else if (o.state === 'no-photo') {
    body = `<h1>Add your photo first</h1><p>Your certificate carries your photo, and we do not have one on record for you yet.</p>`
      + (byAttendee(d.group)
        ? `<ol><li>Tap <b>Add my photo</b> and sign in to the event app.</li><li>Add a clear photo of your face and save.</li><li>Open this link again: your certificate will be here.</li></ol><p class="c"><a class="btn" href="/app?action=complete-profile">Add my photo</a></p>`
        : `<p>Please send a clear photo of yourself to ${MAIL}. We will add it and send your certificate.</p>`)
  } else {
    const li = 'https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME&name=' + encodeURIComponent(d.certName)
      + '&organizationName=' + encodeURIComponent('Bharat AI Innovation') + '&issueYear=2026&issueMonth=11'
      + '&certUrl=' + encodeURIComponent(String(d.draw.verifyUrl || '')) + '&certId=' + encodeURIComponent(d.certId)
    body = `<h1>Your certificate, ${escH(d.name)}</h1>
      <div class="box"><p id="wait">Drawing your certificate&hellip;</p><img id="img" alt="Your certificate" hidden></div>
      <div class="acts"><a id="dl" class="btn off" href="#" download="${escH(d.file)}">Download certificate</a>
        <a class="btn2" href="${escH(li)}" target="_blank" rel="noopener">Add to LinkedIn</a></div>
      <p class="tip">On a phone: if the download does not start, press and hold the picture, then tap Save image.</p>
      <p class="tip">The QR code on it opens a page on our website that confirms it is genuine.</p>`
  }
  // The data the drawing needs: no email, nothing the certificate does not show.
  const json = JSON.stringify(o.state === 'ok' && d ? { draw: d.draw, file: d.file, code: o.code } : null).replace(/</g, '\\u003c')
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Your certificate · Bharat AI Innovation 2026</title>
<link rel="stylesheet" href="/css/fonts-app.css?v=1">
<style>
*{box-sizing:border-box}body{margin:0;background:#F4F1EA;color:#0E1430;font-family:Manrope,Arial,sans-serif;-webkit-text-size-adjust:100%}
.top{background:linear-gradient(#141C42,#090D22);padding:22px 20px 18px;text-align:center}.top img{width:210px;max-width:64%;height:auto;display:block;margin:0 auto}
.hi{font-family:Mukta,'Nirmala UI',sans-serif;font-weight:700;font-size:20px;margin-top:6px}.hi .s{color:#FF9933}.hi .w{color:#fff}.hi .g{color:#1FA015}
.tri{height:6px;background:linear-gradient(90deg,#FF9933 0 33.3%,#fff 33.3% 66.6%,#138808 66.6%)}
main{max-width:980px;margin:0 auto;padding:22px 16px 40px}.card{background:#fff;border-radius:18px;padding:22px 18px;box-shadow:0 10px 30px rgba(14,20,48,.06)}
h1{font-family:'Playfair Display',Georgia,serif;font-size:28px;line-height:1.2;margin:0 0 14px;overflow-wrap:anywhere}
p,li{font-size:16px;line-height:1.55}ol{padding-left:22px}.c{text-align:center}
.box{background:#0E1430;border-radius:12px;min-height:180px;display:flex;align-items:center;justify-content:center;overflow:hidden}
.box p{color:#C8CBDA;margin:0;padding:30px}.box img{display:block;width:100%;height:auto}
.acts{display:flex;flex-wrap:wrap;gap:12px;margin:16px 0 6px}
.btn,.btn2{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 22px;border-radius:12px;font-weight:700;font-size:16px;text-decoration:none}
.btn{background:#C84F00;color:#fff}.btn.off{opacity:.45;pointer-events:none}.btn2{background:#0A66C2;color:#fff}
.tip{color:#5B6275;font-size:14px;margin:8px 0 0}a{color:#B4520A}
@media (max-width:520px){.acts a{flex:1 1 100%}}
</style></head><body>${top}<main><div class="card">${body}</div></main>
<script src="/js/vendor/qrcode-generator.js?v=20261029"></script>
<script src="/js/cert-render.js?v=${CERT_RENDER_V}"></script>
<script>
(function () {
  var d = ${json};
  if (!d) return;
  var wait = document.getElementById('wait'), img = document.getElementById('img'), dl = document.getElementById('dl');
  var fail = function () { if (wait) wait.textContent = 'Your certificate could not be drawn on this device. Please try on a computer, or write to register@bharataiinnovation.com and we will send it to you.'; };
  if (!window.BhaiCert) { fail(); return; }
  window.BhaiCert.draw(d.draw).then(function (cv) {
    cv.toBlob(function (b) {
      if (!b) { fail(); return; }
      var u = URL.createObjectURL(b);
      img.src = u; img.hidden = false; if (wait) wait.remove();
      dl.href = u; dl.classList.remove('off');
      dl.addEventListener('click', function () { try { navigator.sendBeacon('/api/certificates/' + encodeURIComponent(d.code) + '/saved'); } catch (e) {} });
    }, 'image/png');
  }).catch(fail);
})();
</script></body></html>`
}

// A save from the download page, counted for Admin (no personal data beyond the code).
cr.post('/api/certificates/:code/saved', async (c) => {
  const code = String(c.req.param('code') || '')
  if (!/^[CWPST]\d{1,9}(-[a-z0-9-]{1,40})?\.[0-9a-f]{16}$/.test(code)) return c.body(null, 204)
  try { if (hooks.audit) await hooks.audit(c, 'certificate.saved', 'certificate', code) } catch { /* a count, never an error */ }
  return c.body(null, 204)
})

export default cr
