import { Hono } from 'hono'

// ==================== A GUEST WITH ONLY A MOBILE NUMBER (16 Nov 2026) ====================
//
// The organiser: "if we have only mobile no of some guest can we register and send pass
// by whatsapp", by anyone of the team, from their phone. They chose (16 Nov 2026): the
// team on their own phone, and a Visitor Pass, or a Delegate or VIP Pass given free.
// Later the same day: "give right to each team member to upload from their account the
// guest list ... also interface to send whatsapp msg with their mobile phone using
// whatsapp web interface". So: one guest or a whole sheet, and a send queue that opens
// WhatsApp on a phone or WhatsApp Web on a laptop, one guest at a time, and remembers
// who has been sent their pass.
//
// Who may do it: anyone holding the Organiser pass (lib/team.ts), signed in to the app.
// In the app's account menu they get "Register guests" (public/static/team-guest.js):
// one guest (name, mobile, pass) or a .csv/.xlsx list, then "Send on WhatsApp", which
// opens the team member's own WhatsApp (wa.me on a phone, web.whatsapp.com on a laptop)
// with the guest's number and a message holding the pass link. Nothing is sent by us:
// no WhatsApp account of ours sits in the middle. Tapping Send marks the guest as sent
// (an audit row, undoable), so a list of two hundred can be worked through over a day.
//
// The pass link is /pass/<signed pass token>: the same token the QR on every pass
// carries, so the desk scans it as it scans everyone's. The page draws the pass with
// public/js/pass-render.js, as the app and the admin panel do, and lets the guest save
// the picture. It opens only for a guest registered this way, so a token read off
// somebody else's printed badge shows nothing here.
//
// An attendee row needs an email (NOT NULL, one per event). A guest who has none gets a
// stand-in, wa<number>@no-email.invalid. ".invalid" can never be a real address (RFC
// 2606), and every send checks isNoEmail(): sendAdminEmail refuses it, campaign
// audiences leave it out (suppressionClause), the workshop emails skip it.
//
// 19 Nov 2026, the organiser: "give option to all exhibitors to issue visitor passes from
// their dashboard", "they should be able to upload csv, excel or type individual ones".
// The same three tabs on /marketplace/dashboard (Visitor passes), for any account linked
// to a Mumbai exhibitor: a Visitor Pass only, whatever a sheet's Pass column says; up to
// EXHIBITOR_GUEST_LIMIT for the whole company (app_settings.exhibitor_guest_limit
// changes it); the row is registration_source 'exhibitor:<exhibitor id>', so every
// account of one company shares one list; the message says who invited them and where
// their booth is, and is sent from the exhibitor's own WhatsApp, SMS or email. A refusal
// never names who already holds a number or an email: an exhibitor is not the team.

export const NO_EMAIL_DOMAIN = 'no-email.invalid'
export const isNoEmail = (email: unknown): boolean =>
  String(email ?? '').trim().toLowerCase().endsWith('@' + NO_EMAIL_DOMAIN)
export const NO_EMAIL_SQL = (alias = '') => `${alias}email NOT LIKE '%@${NO_EMAIL_DOMAIN}'`
export const NO_EMAIL_ERROR = 'No email address: this guest was registered with a mobile number only, so their pass went on WhatsApp.'

// The passes the team may give, and what each one carries. A Visitor Pass is the free
// tier ('paid' is the column's meaning of "nothing owed", as desk walk-ins store it);
// Delegate and VIP are given free, recorded as Complimentary ('waived'), with the lunch
// those passes include.
export const GUEST_PASSES: Record<string, { badge: string; payment: string; free: string }> = {
  visitor: { badge: 'Visitor Pass', payment: 'paid', free: 'free' },
  delegate: { badge: 'Delegate Pass', payment: 'waived', free: 'complimentary' },
  vip: { badge: 'VIP Pass', payment: 'waived', free: 'complimentary' },
}

// How many guests one team member may register in a day, and in one sheet. Ten people
// on the team, and the desk's walk-in form is still there on the day; this only stops a
// runaway loop or a sheet uploaded twice by mistake.
export const DAILY_LIMIT = 500
export const BULK_MAX = 300
// Visitor Passes one exhibitor company may give in all (19 Nov 2026), unless
// app_settings.exhibitor_guest_limit says another number.
export const EXHIBITOR_GUEST_LIMIT = 100

// The audit rows that remember a pass was sent on WhatsApp (and that it was not, after
// Undo). The latest of the two for a guest is their state.
export const SENT_ACTION = 'team.guest.sent'
export const UNSENT_ACTION = 'team.guest.unsent'

type Hooks = {
  me?: (c: any) => Promise<number | null>
  mobileHolder?: (c: any, eventId: number, mobile: unknown) => Promise<{ id: number; name: string; email: string } | null>
  columns?: (c: any) => Promise<Set<string>>
  passToken?: (c: any, id: number) => Promise<string>
  readPassToken?: (c: any, token: string) => Promise<number | null>
  audit?: (c: any, action: string, entity?: string, entityId?: any, detail?: any, actorOverride?: { actor: string; kind: string }) => Promise<void>
  lunch?: (badge: string) => string | undefined
  validEmail?: (email: string) => boolean
  // The exhibitor behind the signed-in /marketplace/dashboard account (routes/marketplace.ts).
  exhibitor?: (c: any) => Promise<{ signedIn: boolean; ex: { id: number; company_name: string; booth: string; event_id: number; by: string } | null }>
}
let hooks: Hooks = {}
export function configureTeamGuests(h: Hooks) { hooks = { ...hooks, ...h } }

const tg = new Hono<{ Bindings: any }>()

const one = async (c: any, sql: string, ...args: any[]) => (await c.env.DB.prepare(sql).bind(...args).first()) as any
const all = async (c: any, sql: string, ...args: any[]) => (((await c.env.DB.prepare(sql).bind(...args).all()) as any).results || []) as any[]

const clean = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const ref = (id: number | string) => 'BHAI-2026-' + String(id).padStart(5, '0')

// How the message and the page greet them: the first name, or the title and surname for
// "Dr. Kavita Shah" (Hello Dr. Shah), never "Hello Dr.".
const TITLE_WORD = /^(dr|prof|mr|mrs|ms|miss|shri|smt|sri|kum|col|capt|cdr|gen|adv|er|ca|cs)\.?$/i
export function greetName(name: string): string {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!w.length) return ''
  if (TITLE_WORD.test(w[0]) && w.length > 1) return w[0] + ' ' + w[w.length - 1]
  return w[0]
}
const firstName = greetName

// The number as WhatsApp wants it: country code and digits, nothing else. Ten digits
// (or a 0 or 91 in front of ten) is an Indian mobile; anything written with a + keeps
// its own country code. Answers '' for something that is not a mobile number.
export function whatsappNumber(raw: unknown): string {
  const typed = String(raw ?? '').trim()
  const d = typed.replace(/\D/g, '')
  if (typed.startsWith('+')) {
    if (d.startsWith('91')) return d.length === 12 && /^91[6-9]/.test(d) ? d : ''
    return d.length >= 8 && d.length <= 15 ? d : ''
  }
  let ten = d
  if (ten.length === 11 && ten.startsWith('0')) ten = ten.slice(1)
  if (ten.length === 12 && ten.startsWith('91')) ten = ten.slice(2)
  return /^[6-9]\d{9}$/.test(ten) ? '91' + ten : ''
}

// As stored on the row and shown to people: +91 98765 43210.
export function shownNumber(wa: string): string {
  return wa.startsWith('91') && wa.length === 12 ? '+91 ' + wa.slice(2, 7) + ' ' + wa.slice(7) : '+' + wa
}

// The same key the rest of the app uses for "one mobile, one attendee": the last ten
// digits of anything with at least eight.
const mobileKey = (v: unknown): string => {
  const d = String(v ?? '').replace(/\D/g, '')
  return d.length >= 8 ? d.slice(-10) : ''
}

// The pass a sheet names, in whatever words: "VIP", "vip pass", "Delegate", "visitor",
// "free". '' for an empty cell (the sheet's default applies), null for words we do not
// understand (that row is refused rather than guessed).
export function passKeyOf(v: unknown): string | null {
  const s = String(v ?? '').trim().toLowerCase()
  if (!s) return ''
  if (/vip/.test(s)) return 'vip'
  if (/premium|academic|student|speaker|exhibitor|organi/.test(s)) return null
  if (/delegate/.test(s)) return 'delegate'
  if (/visitor|free|expo|general|guest/.test(s)) return 'visitor'
  return null
}

// The message the team member sends from their own WhatsApp. Plain words, the pass link
// on its own line so WhatsApp makes it tappable. An exhibitor's message adds who invited
// them (invite) and is signed with the company (sign).
export function guestMessage(o: { name: string; badge: string; free: string; link: string; from: string; invite?: string; sign?: string }): string {
  const hello = firstName(o.name) ? 'Hello ' + firstName(o.name) + ',' : 'Hello,'
  const pass = o.free === 'complimentary' ? 'your complimentary ' + o.badge : 'your ' + o.badge
  return [
    hello,
    '',
    pass.charAt(0).toUpperCase() + pass.slice(1) + ' for Bharat AI Innovation 2026 is ready.',
    ...(o.invite ? [o.invite] : []),
    '20-21 Nov 2026, WTC Mumbai, Cuffe Parade. 9 AM to 6 PM.',
    '',
    'Open your pass here and save the picture on your phone:',
    o.link,
    '',
    'Show it at the entry desk with a government photo ID in this name.',
    '',
    o.sign || (o.from ? o.from + ', Bharat AI Innovation team' : 'Bharat AI Innovation team'),
  ].join('\n')
}

// Who is giving the passes: a member of the organising team (the app), or an exhibitor's
// dashboard account. Every rule that differs between the two is here.
type Issuer = {
  source: string                   // registration_source of each guest they add
  kind: 'team' | 'exhibitor'
  actor: string                    // the log's actor
  audit: string                    // the log action for one guest; '.sheet' for a sheet
  from: string                     // the team member's name, for the message's last line
  invite?: string
  sign?: string
  passes: string[]                 // the pass keys they may give; one key = that pass, always
  limit: number
  perDay: boolean                  // the limit counts the last day (team) or all time (exhibitor)
  limitError: string
  own: (source: string) => boolean // a guest already on the list that they may send again
  names: boolean                   // may a refusal name the person who holds the number
  detail: Record<string, any>
}
type Signature = Pick<Issuer, 'from' | 'invite' | 'sign'>

const EMAIL_SUBJECT = 'Your pass for Bharat AI Innovation 2026'

// Everything the team member's screen needs to send one guest their pass. Two WhatsApp
// links: wa.me for a phone (it opens the app), web.whatsapp.com for a laptop (it opens
// WhatsApp Web with the chat and the message, when the phone is linked to it).
async function sendKit(c: any, row: any, who: Signature, extra: { sent_at?: string | null; by?: string } = {}) {
  const token = hooks.passToken ? await hooks.passToken(c, Number(row.id)) : String(row.id)
  const origin = new URL(c.req.url).origin
  const link = origin + '/pass/' + token
  const pass = Object.values(GUEST_PASSES).find(p => p.badge === row.badge_type)
  const free = pass ? (row.payment_status === 'waived' ? 'complimentary' : pass.free) : ''
  const message = guestMessage({ name: row.name, badge: row.badge_type || 'pass', free, link, from: who.from, invite: who.invite, sign: who.sign })
  const wa = whatsappNumber(row.mobile)
  const text = encodeURIComponent(message)
  const hasEmail = !isNoEmail(row.email)
  return {
    id: Number(row.id), name: row.name, badge_type: row.badge_type, ref: ref(row.id),
    company: row.company || '', mobile: wa ? shownNumber(wa) : String(row.mobile || ''),
    has_email: hasEmail,
    pass_url: link, message,
    whatsapp_url: 'https://wa.me/' + wa + '?text=' + text,
    whatsapp_web_url: 'https://web.whatsapp.com/send?phone=' + wa + '&text=' + text,
    sms_url: 'sms:+' + wa + '?&body=' + text,
    // Opens the sender's own email with the message written (the exhibitor's screen offers it).
    email_url: hasEmail ? 'mailto:' + encodeURIComponent(String(row.email)) + '?subject=' + encodeURIComponent(EMAIL_SUBJECT) + '&body=' + text : '',
    registered_at: row.registration_date || row.created_at || '',
    sent_at: extra.sent_at || null,
    by: extra.by || '',
  }
}

const teamIssuer = (me: any): Issuer => ({
  source: 'team:' + me.id, kind: 'team', actor: String(me.name || 'team').slice(0, 80), audit: 'team.guest',
  from: String(me.name || ''), passes: Object.keys(GUEST_PASSES),
  limit: DAILY_LIMIT, perDay: true,
  limitError: 'You have registered ' + DAILY_LIMIT + ' guests in the last day. Ask the organiser to add the rest in Admin.',
  own: (s) => s.startsWith('team:'), names: true, detail: { by: me.name, by_id: me.id },
})

// The signed-in team member, or a reply saying why not.
async function teamMember(c: any): Promise<{ me: any; who: Issuer } | { res: Response }> {
  const id = hooks.me ? await hooks.me(c) : null
  if (id == null) return { res: c.json({ error: 'Sign in to the app first.' }, 401) }
  const me = await one(c, 'SELECT id, event_id, name, email, badge_type FROM attendees WHERE id = ?', id)
  if (!me || String(me.badge_type || '') !== 'Organiser' || Number(me.event_id) !== 1) {
    return { res: c.json({ error: 'Only the organising team can register guests here.' }, 403) }
  }
  return { me, who: teamIssuer(me) }
}

// How many Visitor Passes one exhibitor company may give: the setting, or the default.
async function exhibitorLimit(c: any): Promise<number> {
  try {
    const r = await one(c, 'SELECT value FROM app_settings WHERE key = ?', 'exhibitor_guest_limit')
    const n = Number(String(r?.value ?? '').trim())
    if (String(r?.value ?? '').trim() !== '' && Number.isInteger(n) && n >= 0) return n
  } catch { /* no setting: the default */ }
  return EXHIBITOR_GUEST_LIMIT
}

// The signed-in exhibitor (the dashboard's company account), or a reply saying why not.
// Mumbai only: the message, the dates and the pass are this event's.
async function exhibitorGuestGiver(c: any): Promise<{ ex: any; who: Issuer } | { res: Response; signedIn: boolean }> {
  const r = hooks.exhibitor ? await hooks.exhibitor(c).catch(() => ({ signedIn: false, ex: null })) : { signedIn: false, ex: null }
  if (!r.signedIn) return { signedIn: false, res: c.json({ error: 'Your sign-in has run out. Sign in to your dashboard again.' }, 401) }
  const ex = r.ex
  if (!ex || Number(ex.event_id) !== 1) return { signedIn: true, res: c.json({ error: 'Visitor passes are for exhibitors at Bharat AI Innovation Mumbai, 20-21 Nov 2026.' }, 403) }
  const company = clean(ex.company_name, 120) || 'An exhibitor'
  const booth = clean(ex.booth, 40)
  const limit = await exhibitorLimit(c)
  const who: Issuer = {
    source: 'exhibitor:' + ex.id, kind: 'exhibitor', actor: company.slice(0, 80), audit: 'exhibitor.guest',
    from: company, sign: company,
    invite: company + ' invited you' + (booth ? ': visit them at Booth ' + booth + '.' : '. Visit their booth on the exhibition floor.'),
    passes: ['visitor'], limit, perDay: false,
    limitError: company + ' has given ' + limit + ' Visitor Passes, the most one exhibitor can give. For more, use Report a problem on your dashboard.',
    own: (s) => s === 'exhibitor:' + ex.id, names: false,
    detail: { by: ex.by || company, exhibitor_id: ex.id, company },
  }
  return { ex, who }
}

const GUEST_COLS = 'id, name, email, mobile, company, badge_type, payment_status, registration_source, registration_date, created_at'

// ---------- adding one guest, for the form and for every row of a sheet ----------

type AddInput = { name?: unknown; mobile?: unknown; pass?: unknown; company?: unknown; job_title?: unknown; email?: unknown }
type AddResult =
  | { ok: true; status: 201; guest: any }
  | { ok: false; status: 400; field: string; error: string }
  | { ok: false; status: 409; code: 'already_registered'; error: string; holder: any; guest: any | null }
  | { ok: false; status: 429 | 500; error: string }

// A number already on the list. The form asks the app's own mobileHolder for one
// number; a sheet reads every held number once and keeps the map as rows are added, so
// the same number twice in one sheet is caught too.
type Holder = (wa: string) => Promise<{ id: number } | null>

async function addGuest(c: any, who: Issuer, b: AddInput, holder: Holder, defaultPass = 'visitor'): Promise<AddResult> {
  const name = clean(b.name, 120)
  const company = clean(b.company, 160)
  const jobTitle = clean(b.job_title, 160)
  const typedEmail = clean(b.email, 200).toLowerCase()
  // An issuer with one pass (an exhibitor: Visitor) gives that one, whatever was typed.
  const passKey = who.passes.length === 1 ? who.passes[0] : passKeyOf(b.pass)
  const key = passKey === '' ? defaultPass : String(passKey)
  const pass = who.passes.includes(key) ? GUEST_PASSES[key] : undefined
  const wa = whatsappNumber(b.mobile)
  if (name.length < 2) return { ok: false, status: 400, field: 'name', error: 'Write the guest\'s name as it should be printed on the pass.' }
  if (!wa) return { ok: false, status: 400, field: 'mobile', error: 'That does not look like a mobile number. Write the 10 digits, or + and the country code for a number outside India.' }
  if (!pass) return { ok: false, status: 400, field: 'pass', error: 'Choose a Visitor, Delegate or VIP Pass.' }
  if (typedEmail && (isNoEmail(typedEmail) || (hooks.validEmail && !hooks.validEmail(typedEmail)))) {
    return { ok: false, status: 400, field: 'email', error: 'That email address does not look right. Leave it empty if you do not have it.' }
  }

  // One mobile, one attendee (28 Oct 2026). Someone already on the list is not added
  // again: a guest this issuer registered gets their pass link back, to send again. To an
  // exhibitor, someone else's registration is never named.
  const already = async (row: any, by: string): Promise<AddResult> => {
    const own = who.own(String(row.registration_source || ''))
    const why = by === 'email' ? 'That email' : 'That mobile number'
    const named = who.names || own
    return {
      ok: false, status: 409, code: 'already_registered',
      error: named
        ? why + ' is already registered as ' + row.name + ' (' + (row.badge_type || 'Visitor Pass') + ').'
          + (own ? ' Their pass link is below, to send again.' : ' They have a pass already: they open it in the app with their own email.')
        : why + ' is already registered for the event, so this person has a pass already. They open it in the event app with the email they registered with.',
      holder: named ? { name: row.name, badge_type: row.badge_type || 'Visitor Pass', ref: ref(row.id) } : null,
      guest: own ? await sendKit(c, row, who, await sentState(c, [Number(row.id)]).then(m => ({ sent_at: m.get(Number(row.id)) || null }))) : null,
    }
  }
  const byMobile = await holder(wa)
  if (byMobile) return already(await one(c, `SELECT ${GUEST_COLS} FROM attendees WHERE id = ?`, byMobile.id), 'mobile')
  const email = typedEmail || ('wa' + wa + '@' + NO_EMAIL_DOMAIN)
  const byEmail = await one(c, `SELECT ${GUEST_COLS} FROM attendees WHERE event_id = 1 AND lower(email) = ?`, email)
  if (byEmail) return already(byEmail, typedEmail ? 'email' : 'mobile')

  const given = await one(c, `SELECT COUNT(*) AS n FROM attendees WHERE event_id = 1 AND registration_source = ?`
      + (who.perDay ? ` AND registration_date >= datetime('now', '-1 day')` : ''), who.source)
  if (Number(given?.n || 0) >= who.limit) {
    return { ok: false, status: 429, error: who.limitError }
  }

  const cols = hooks.columns ? await hooks.columns(c) : new Set<string>()
  const row: Record<string, any> = {
    event_id: 1, name, email, mobile: shownNumber(wa), company, job_title: jobTitle,
    badge_type: pass.badge, role: 'attendee', country: wa.startsWith('91') ? 'India' : '',
    payment_status: pass.payment,
    lunch_inclusion: (hooks.lunch && hooks.lunch(pass.badge)) || 'No',
    registration_source: who.source,
    registration_date: new Date().toISOString().slice(0, 19).replace('T', ' '),
    // Invited by the team (or an exhibitor) to the event itself: not a panel-only row,
    // and never on the free-pass waiting list.
    main_event: 1, is_online: 0,
  }
  // A guest with no email is out of every mailing by consent as well as by address, so
  // the AImailPilot export (opted_out) leaves them out too.
  if (!typedEmail) row.marketing_consent = 0
  const always = new Set(['event_id', 'name', 'email', 'is_online'])
  const names = Object.keys(row).filter(k => always.has(k) || cols.has(k))
  let id = 0
  try {
    const r = await c.env.DB.prepare(`INSERT INTO attendees (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`)
      .bind(...names.map(k => row[k])).run()
    id = Number(r.meta.last_row_id)
  } catch (e: any) {
    if (String(e?.message || '').includes('UNIQUE')) {
      const again = await one(c, `SELECT ${GUEST_COLS} FROM attendees WHERE event_id = 1 AND lower(email) = ?`, email)
      if (again) return already(again, typedEmail ? 'email' : 'mobile')
    }
    return { ok: false, status: 500, error: 'Could not register them: ' + (e?.message || 'unknown error') }
  }
  if (hooks.audit) {
    try {
      await hooks.audit(c, who.audit, 'attendee', id,
        { name, mobile: shownNumber(wa), email: typedEmail || null, badge_type: pass.badge, payment_status: pass.payment, ...who.detail },
        { actor: who.actor, kind: who.kind })
    } catch { /* the guest is registered; the log never undoes that */ }
  }
  const saved = await one(c, `SELECT ${GUEST_COLS} FROM attendees WHERE id = ?`, id)
  return { ok: true, status: 201, guest: await sendKit(c, saved, who) }
}

const reply = (c: any, r: AddResult) => {
  if (r.ok) return c.json({ success: true, guest: r.guest }, 201)
  const { ok, status, ...rest } = r as any
  return c.json(rest, status)
}

// The two doors in: the team (in the app) and an exhibitor (on the dashboard). Each
// endpoint below is mounted under both, with the giver that checks who is asking.
type Giver = (c: any) => Promise<{ who: Issuer } | { res: Response }>
const DOORS: { base: string; giver: Giver }[] = [
  { base: '/api/team/guests', giver: teamMember },
  { base: '/api/mp/dashboard/guests', giver: exhibitorGuestGiver },
]

for (const { base, giver } of DOORS) tg.post(base, async (c) => {
  const t = await giver(c)
  if ('res' in t) return t.res
  const b = await c.req.json().catch(() => ({})) as any
  const holder: Holder = async (wa) => hooks.mobileHolder ? hooks.mobileHolder(c, 1, wa) : null
  return reply(c, await addGuest(c, t.who, b, holder))
})

// ---------- a sheet of guests ----------

// The columns a sheet names in its heading row, in the words people use.
const HEAD: [string, RegExp][] = [
  ['first', /^first\s*name$/i],
  ['last', /^(last\s*name|surname|family\s*name)$/i],
  ['name', /^((full\s*)?names?|guest(\s*name)?|name of (the )?(person|guest|participant|delegate|attendee|member)|participants?|delegates?|attendees?|members?|person|invitee)$/i],
  ['mobile', /^((mobile|phone|contact|cell|whatsapp|wa|telephone)(\s*(no|number|num))?\.?|mob\.?(\s*no\.?)?|contact\s*details)$/i],
  ['email', /^(e-?mail(\s*(id|address))?|mail\s*id)$/i],
  ['pass', /^(pass(\s*type)?|badge(\s*type)?|category|ticket(\s*type)?)$/i],
  ['company', /^(organi[sz]ation|company(\s*name)?|firm|employer|org)$/i],
  ['job_title', /^(designation|title|job\s*title|role|position|post)$/i],
]
export function headField(cell: unknown): string {
  const t = String(cell ?? '').trim().replace(/[:*]+$/, '').replace(/\s+/g, ' ').trim()
  for (const [k, re] of HEAD) if (re.test(t)) return k
  return ''
}
// One row of the sheet as the form would have sent it. Keys are the sheet's own headings.
export function rowInput(row: Record<string, unknown>): AddInput & { known: boolean } {
  const got: Record<string, string> = {}
  for (const k of Object.keys(row || {})) {
    const f = headField(k)
    if (f && !got[f]) got[f] = String((row as any)[k] ?? '').trim()
  }
  const name = got.name || [got.first, got.last].filter(Boolean).join(' ')
  return { name, mobile: got.mobile || '', pass: got.pass || '', company: got.company || '', job_title: got.job_title || '', email: got.email || '',
    known: !!(got.name || got.first || got.mobile) }
}

for (const { base, giver } of DOORS) tg.post(base + '/bulk', async (c) => {
  const t = await giver(c)
  if ('res' in t) return t.res
  const who = t.who
  const b = await c.req.json().catch(() => ({})) as any
  const rows: any[] = Array.isArray(b.rows) ? b.rows : []
  if (!rows.length) return c.json({ error: 'The sheet has no rows under its heading row.' }, 400)
  if (rows.length > BULK_MAX) return c.json({ error: 'A sheet may have up to ' + BULK_MAX + ' guests. Split it and upload the parts.' }, 400)
  // An empty default is a Visitor Pass; a pass we do not give (passKeyOf null) is refused,
  // never quietly turned into one. An exhibitor gives a Visitor Pass to every row.
  const dp = who.passes.length === 1 ? who.passes[0] : passKeyOf(b.default_pass)
  const defaultPass = dp === '' ? 'visitor' : String(dp)
  if (!GUEST_PASSES[defaultPass] || !who.passes.includes(defaultPass)) return c.json({ error: 'Choose a Visitor, Delegate or VIP Pass for rows that do not say.' }, 400)
  const inputs = rows.map(r => rowInput(r && typeof r === 'object' ? r : {}))
  if (!inputs.some(i => i.known)) {
    return c.json({ error: 'Could not find a Name and a Mobile column. Head the columns ' + (who.passes.length === 1 ? 'Name, Mobile, Organisation, Designation, Email' : 'Name, Mobile, Pass, Organisation, Designation, Email') + ' (the blank sheet has them).' }, 400)
  }

  // Every held number once; a number added below joins the map, so a sheet that lists
  // someone twice adds them once.
  const held = new Map<string, number>()
  for (const r of await all(c, "SELECT id, mobile FROM attendees WHERE event_id = 1 AND mobile IS NOT NULL AND mobile != ''")) {
    const k = mobileKey(r.mobile)
    if (k && !held.has(k)) held.set(k, Number(r.id))
  }
  const holder: Holder = async (wa) => { const id = held.get(mobileKey(wa)); return id ? { id } : null }

  const results: any[] = []
  const counts = { added: 0, already: 0, skipped: 0 }
  let stop = ''
  for (let i = 0; i < inputs.length; i++) {
    const inp = inputs[i]
    const label = { row: i + 2, name: clean(inp.name, 120), mobile: String(inp.mobile || '').trim() }
    if (stop) { results.push({ ...label, status: 'skipped', reason: stop }); counts.skipped++; continue }
    const r = await addGuest(c, who, inp, holder, defaultPass)
    if (r.ok) {
      held.set(mobileKey(r.guest.mobile), r.guest.id)
      results.push({ ...label, status: 'added', guest: r.guest }); counts.added++
    } else if (r.status === 409) {
      results.push({ ...label, status: 'already', reason: r.error, guest: r.guest }); counts.already++
    } else if (r.status === 429) {
      stop = r.error
      results.push({ ...label, status: 'skipped', reason: r.error }); counts.skipped++
    } else {
      results.push({ ...label, status: 'skipped', reason: (r as any).error }); counts.skipped++
    }
  }
  if (hooks.audit) {
    try {
      const sheetOf = who.kind === 'team' ? (t as any).me?.id : who.detail.exhibitor_id
      await hooks.audit(c, who.audit + '.sheet', who.kind === 'team' ? 'attendee' : 'exhibitor', sheetOf,
        { rows: inputs.length, ...counts, default_pass: GUEST_PASSES[defaultPass].badge, by: who.detail.by },
        { actor: who.actor, kind: who.kind })
    } catch { /* the guests are registered */ }
  }
  return c.json({ success: true, counts, results, stopped: stop || null }, 201)
})

// A blank sheet with the headings the upload understands, and one example row. An
// exhibitor's has no Pass column (every guest of theirs gets a Visitor Pass) and no
// example rows, so a sheet sent back unedited registers nobody by mistake.
for (const { base, giver } of DOORS) tg.get(base + '/template.csv', async (c) => {
  const t = await giver(c)
  if ('res' in t) return t.res
  const csv = t.who.passes.length === 1
    ? 'Name,Mobile,Organisation,Designation,Email\r\n'
    : 'Name,Mobile,Pass,Organisation,Designation,Email\r\n'
      + 'Priya Nair,98200 12345,Visitor,Nair Foods,Director,\r\n'
      + 'Dr. Arun Mehta,+91 90000 00001,VIP,Mehta Hospitals,Chairman,arun@example.com\r\n'
  return new Response(csv, { status: 200, headers: {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="guest-list.csv"',
    'Cache-Control': 'no-store',
  } })
})

// ---------- sent on WhatsApp, or not ----------

// For each guest: when their pass was marked sent, or null. The latest sent / unsent
// row wins. Ids go in chunks of 90 (D1 binds at most 100 parameters).
async function sentState(c: any, ids: number[]): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>()
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90)
    if (!part.length) continue
    let rows: any[] = []
    try {
      rows = await all(c, `SELECT entity_id, action, created_at FROM admin_audit
         WHERE entity = 'attendee' AND action IN (?, ?) AND entity_id IN (${part.map(() => '?').join(', ')}) ORDER BY id`,
        SENT_ACTION, UNSENT_ACTION, ...part.map(String))
    } catch { rows = [] }
    for (const r of rows) out.set(Number(r.entity_id), r.action === SENT_ACTION ? String(r.created_at) : null)
  }
  return out
}

// A guest this issuer may mark sent: the team any team guest, an exhibitor its own.
async function guestRowFor(c: any, who: Issuer, id: number) {
  const row = await one(c, `SELECT ${GUEST_COLS} FROM attendees WHERE id = ? AND event_id = 1`, id)
  return row && who.own(String(row.registration_source || '')) ? row : null
}

// The same two audit actions for both doors: sentState reads them by guest, and the
// log row's actor_kind ('team' or 'exhibitor') says who tapped.
for (const { base, giver } of DOORS) for (const [path, action, sent] of [['sent', SENT_ACTION, true], ['unsent', UNSENT_ACTION, false]] as const) {
  tg.post(base + '/:id/' + path, async (c) => {
    const t = await giver(c)
    if ('res' in t) return t.res
    const who = t.who
    const id = Number(c.req.param('id'))
    const row = Number.isInteger(id) && id > 0 ? await guestRowFor(c, who, id) : null
    if (!row) return c.json({ error: who.kind === 'team' ? 'Not a guest the team registered.' : 'Not a visitor your company invited.' }, 404)
    if (hooks.audit) {
      try { await hooks.audit(c, action, 'attendee', id, { name: row.name, ...who.detail }, { actor: who.actor, kind: who.kind }) }
      catch { return c.json({ error: 'Could not save that. Try again.' }, 500) }
    }
    const at = (await sentState(c, [id])).get(id) || null
    return c.json({ success: true, id, sent: sent && !!at, sent_at: sent ? at : null })
  })
}

// The guests this team member registered (or, with ?all=1, everyone's), newest first,
// each with its links to send and whether it was sent. An exhibitor sees its company's,
// with how many it may still give; a dashboard account that is not a Mumbai exhibitor
// gets { eligible: false }, so the dashboard leaves the menu item out.
for (const { base, giver } of DOORS) tg.get(base, async (c) => {
  const t = await giver(c)
  if ('res' in t) return (t as any).signedIn === true ? c.json({ eligible: false }) : t.res
  const who = t.who
  const everyone = who.kind === 'team' && c.req.query('all') === '1'
  const rows = everyone
    ? await all(c, `SELECT ${GUEST_COLS} FROM attendees WHERE event_id = 1 AND registration_source LIKE 'team:%' ORDER BY id DESC LIMIT 1000`)
    : await all(c, `SELECT ${GUEST_COLS} FROM attendees WHERE event_id = 1 AND registration_source = ? ORDER BY id DESC LIMIT 1000`, who.source)
  const sent = await sentState(c, rows.map(r => Number(r.id)))
  const team = new Map<string, string>()
  if (everyone) for (const m of await all(c, "SELECT id, name FROM attendees WHERE event_id = 1 AND badge_type = 'Organiser'")) team.set(String(m.id), String(m.name || ''))
  const guests = []
  for (const r of rows) {
    const byId = String(r.registration_source || '').slice('team:'.length)
    guests.push(await sendKit(c, r, who, { sent_at: sent.get(Number(r.id)) || null, by: everyone ? (team.get(byId) || '') : '' }))
  }
  const done = guests.filter(g => g.sent_at).length
  const counts = { total: guests.length, sent: done, to_send: guests.length - done }
  if (who.kind === 'team') return c.json({ guests, counts, me: { id: (t as any).me.id, name: (t as any).me.name } })
  const ex = (t as any).ex
  const used = Number((await one(c, 'SELECT COUNT(*) AS n FROM attendees WHERE event_id = 1 AND registration_source = ?', who.source))?.n || 0)
  return c.json({ eligible: true, guests, counts, limit: who.limit, used, left: Math.max(0, who.limit - used),
    company: who.actor, booth: clean(ex.booth, 40), message_preview: guestMessage({ name: 'Priya Nair', badge: 'Visitor Pass', free: 'free', link: new URL(c.req.url).origin + '/pass/…', from: who.from, invite: who.invite, sign: who.sign }) })
})

// ---------- the guest's page ----------

const escHtml = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string))
// JSON inside a <script> block: "<" written as < so a name holding "</script>" cannot end it.
const jsonInScript = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c')

export function guestPassPageHTML(o: { pass: any | null; token: string }): string {
  const p = o.pass
  const title = p ? 'Your pass' : 'Pass not found'
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#1E2140">
<title>${escHtml(title)} - Bharat AI Innovation 2026</title>
<link rel="icon" href="/favicon.ico">
<link rel="stylesheet" href="/css/fonts-app.css?v=1">
<link rel="stylesheet" href="/static/guest-pass.css?v=20261116">
</head><body>
<main class="gp">
  <header class="gp-head">
    <img src="/images/Bharat%20AI%20Innovation%20Logo.png" alt="Bharat AI Innovation" class="gp-logo" width="132" height="40">
  </header>
  ${p ? `
  <h1 class="gp-title">Your pass, ${escHtml(firstName(p.name) || p.name)}</h1>
  <p class="gp-when">20-21 Nov 2026 &middot; WTC Mumbai, Cuffe Parade &middot; 9 AM to 6 PM</p>
  <div class="gp-card" id="gp-card" aria-live="polite">
    <p class="gp-wait" id="gp-wait">Getting your pass ready&hellip;</p>
    <img id="gp-img" class="gp-img" alt="Your ${escHtml(p.badge_type || 'event')} pass for ${escHtml(p.name)}, with the QR code the entry desk scans" hidden>
  </div>
  <button type="button" id="gp-save" class="gp-btn" hidden>Save the picture</button>
  <p class="gp-hint" id="gp-hint" hidden></p>
  <ol class="gp-steps">
    <li>Save the picture now, so it opens without the internet.</li>
    <li>At the entry desk, show this pass and a government photo ID with this name.</li>
    <li>There is no on-spot registration, so keep this pass with you.</li>
  </ol>
  <p class="gp-foot">Questions? Reply to the person who sent you this link.</p>
  <script type="application/json" id="gp-data">${jsonInScript({ pass: p, token: o.token })}</script>
  <script src="/js/vendor/qrcode-generator.js?v=20261029"></script>
  <script src="/js/pass-render.js?v=20261114"></script>
  <script src="/static/guest-pass.js?v=20261116"></script>` : `
  <h1 class="gp-title">This pass link does not open</h1>
  <p class="gp-when">Check that the whole link was copied, or ask the person who sent it to send it again.</p>`}
</main>
</body></html>`
}

// The guest's pass. Only for a guest the team or an exhibitor registered on these
// screens: the token is the same one every pass's QR carries, and somebody holding
// another person's badge must not be able to read their details here.
const pageGuest = (source: string) => source.startsWith('team:') || source.startsWith('exhibitor:')
tg.get('/pass/:token', async (c) => {
  const token = String(c.req.param('token') || '').slice(0, 80)
  const id = hooks.readPassToken ? await hooks.readPassToken(c, token) : null
  let row: any = null
  if (id != null) {
    row = await one(c, 'SELECT id, name, company, job_title, badge_type, role, avatar_url, registration_source, main_event FROM attendees WHERE id = ?', id).catch(() => null)
    if (row && (!pageGuest(String(row.registration_source || '')) || Number(row.main_event ?? 1) === 0)) row = null
  }
  c.header('Cache-Control', 'no-store')
  c.header('X-Robots-Tag', 'noindex, nofollow')
  const pass = row ? { id: Number(row.id), name: row.name, company: row.company || '', job_title: row.job_title || '',
    badge_type: row.badge_type || 'Visitor Pass', role: row.role || 'attendee', avatar_url: row.avatar_url || '' } : null
  return c.html(guestPassPageHTML({ pass, token: pass ? token : '' }), pass ? 200 : 404)
})

export default tg
