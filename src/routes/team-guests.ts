import { Hono } from 'hono'

// ==================== A GUEST WITH ONLY A MOBILE NUMBER (16 Nov 2026) ====================
//
// The organiser: "if we have only mobile no of some guest can we register and send pass
// by whatsapp", by anyone of the team, from their phone. They chose (16 Nov 2026): the
// team on their own phone, and a Visitor Pass, or a Delegate or VIP Pass given free.
//
// Who may do it: anyone holding the Organiser pass (lib/team.ts), signed in to the app.
// In the app's account menu they get "Register a guest" (public/static/team-guest.js):
// the guest's name and mobile, the pass, then "Send on WhatsApp", which opens the team
// member's own WhatsApp with the guest's number and a message holding the pass link.
// Nothing is sent by us: no WhatsApp account of ours sits in the middle.
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

// How many guests one team member may register in a day. Ten people on the team, and
// the desk's walk-in form is still there on the day; this only stops a runaway loop.
export const DAILY_LIMIT = 150

type Hooks = {
  me?: (c: any) => Promise<number | null>
  mobileHolder?: (c: any, eventId: number, mobile: unknown) => Promise<{ id: number; name: string; email: string } | null>
  columns?: (c: any) => Promise<Set<string>>
  passToken?: (c: any, id: number) => Promise<string>
  readPassToken?: (c: any, token: string) => Promise<number | null>
  audit?: (c: any, action: string, entity?: string, entityId?: any, detail?: any, actorOverride?: { actor: string; kind: string }) => Promise<void>
  lunch?: (badge: string) => string | undefined
  validEmail?: (email: string) => boolean
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

// The message the team member sends from their own WhatsApp. Plain words, the pass link
// on its own line so WhatsApp makes it tappable.
export function guestMessage(o: { name: string; badge: string; free: string; link: string; from: string }): string {
  const hello = firstName(o.name) ? 'Hello ' + firstName(o.name) + ',' : 'Hello,'
  const pass = o.free === 'complimentary' ? 'your complimentary ' + o.badge : 'your ' + o.badge
  return [
    hello,
    '',
    pass.charAt(0).toUpperCase() + pass.slice(1) + ' for Bharat AI Innovation 2026 is ready.',
    '20-21 Nov 2026, WTC Mumbai, Cuffe Parade. 9 AM to 6 PM.',
    '',
    'Open your pass here and save the picture on your phone:',
    o.link,
    '',
    'Show it at the entry desk with a government photo ID in this name.',
    '',
    o.from ? o.from + ', Bharat AI Innovation team' : 'Bharat AI Innovation team',
  ].join('\n')
}

// Everything the team member's screen needs to send one guest their pass.
async function sendKit(c: any, row: any, from: string) {
  const token = hooks.passToken ? await hooks.passToken(c, Number(row.id)) : String(row.id)
  const origin = new URL(c.req.url).origin
  const link = origin + '/pass/' + token
  const pass = Object.values(GUEST_PASSES).find(p => p.badge === row.badge_type)
  const free = pass ? (row.payment_status === 'waived' ? 'complimentary' : pass.free) : ''
  const message = guestMessage({ name: row.name, badge: row.badge_type || 'pass', free, link, from })
  const wa = whatsappNumber(row.mobile)
  return {
    id: Number(row.id), name: row.name, badge_type: row.badge_type, ref: ref(row.id),
    company: row.company || '', mobile: wa ? shownNumber(wa) : String(row.mobile || ''),
    has_email: !isNoEmail(row.email),
    pass_url: link, message,
    whatsapp_url: 'https://wa.me/' + wa + '?text=' + encodeURIComponent(message),
    sms_url: 'sms:+' + wa + '?&body=' + encodeURIComponent(message),
    registered_at: row.registration_date || row.created_at || '',
  }
}

// The signed-in team member, or a reply saying why not.
async function teamMember(c: any): Promise<{ me: any } | { res: Response }> {
  const id = hooks.me ? await hooks.me(c) : null
  if (id == null) return { res: c.json({ error: 'Sign in to the app first.' }, 401) }
  const me = await one(c, 'SELECT id, event_id, name, email, badge_type FROM attendees WHERE id = ?', id)
  if (!me || String(me.badge_type || '') !== 'Organiser' || Number(me.event_id) !== 1) {
    return { res: c.json({ error: 'Only the organising team can register guests here.' }, 403) }
  }
  return { me }
}

const GUEST_COLS = 'id, name, email, mobile, company, badge_type, payment_status, registration_source, registration_date, created_at'

tg.post('/api/team/guests', async (c) => {
  const t = await teamMember(c)
  if ('res' in t) return t.res
  const me = t.me
  const b = await c.req.json().catch(() => ({})) as any
  const name = clean(b.name, 120)
  const company = clean(b.company, 160)
  const jobTitle = clean(b.job_title, 160)
  const typedEmail = clean(b.email, 200).toLowerCase()
  const pass = GUEST_PASSES[String(b.pass || 'visitor')]
  const wa = whatsappNumber(b.mobile)
  if (name.length < 2) return c.json({ error: 'Write the guest\'s name as it should be printed on the pass.', field: 'name' }, 400)
  if (!wa) return c.json({ error: 'That does not look like a mobile number. Write the 10 digits, or + and the country code for a number outside India.', field: 'mobile' }, 400)
  if (!pass) return c.json({ error: 'Choose a Visitor, Delegate or VIP Pass.', field: 'pass' }, 400)
  if (typedEmail && (isNoEmail(typedEmail) || (hooks.validEmail && !hooks.validEmail(typedEmail)))) {
    return c.json({ error: 'That email address does not look right. Leave it empty if you do not have it.', field: 'email' }, 400)
  }

  // One mobile, one attendee (28 Oct 2026). Someone already on the list is not added
  // again: a guest the team registered gets their pass link back, to send again.
  const already = async (row: any, by: string) => {
    const own = String(row.registration_source || '').startsWith('team:')
    const why = by === 'email' ? 'That email' : 'That mobile number'
    return c.json({
      error: why + ' is already registered as ' + row.name + ' (' + (row.badge_type || 'Visitor Pass') + ').'
        + (own ? ' Their pass link is below, to send again.' : ' They have a pass already: they open it in the app with their own email.'),
      code: 'already_registered',
      holder: { name: row.name, badge_type: row.badge_type || 'Visitor Pass', ref: ref(row.id) },
      guest: own ? await sendKit(c, row, me.name) : null,
    }, 409)
  }
  const byMobile = hooks.mobileHolder ? await hooks.mobileHolder(c, 1, wa) : null
  if (byMobile) return already(await one(c, `SELECT ${GUEST_COLS} FROM attendees WHERE id = ?`, byMobile.id), 'mobile')
  const email = typedEmail || ('wa' + wa + '@' + NO_EMAIL_DOMAIN)
  const byEmail = await one(c, `SELECT ${GUEST_COLS} FROM attendees WHERE event_id = 1 AND lower(email) = ?`, email)
  if (byEmail) return already(byEmail, typedEmail ? 'email' : 'mobile')

  const today = await one(c, `SELECT COUNT(*) AS n FROM attendees WHERE event_id = 1 AND registration_source = ?
      AND registration_date >= datetime('now', '-1 day')`, 'team:' + me.id)
  if (Number(today?.n || 0) >= DAILY_LIMIT) {
    return c.json({ error: 'You have registered ' + DAILY_LIMIT + ' guests in the last day. Ask the organiser to add the rest in Admin.' }, 429)
  }

  const cols = hooks.columns ? await hooks.columns(c) : new Set<string>()
  const row: Record<string, any> = {
    event_id: 1, name, email, mobile: shownNumber(wa), company, job_title: jobTitle,
    badge_type: pass.badge, role: 'attendee', country: wa.startsWith('91') ? 'India' : '',
    payment_status: pass.payment,
    lunch_inclusion: (hooks.lunch && hooks.lunch(pass.badge)) || 'No',
    registration_source: 'team:' + me.id,
    registration_date: new Date().toISOString().slice(0, 19).replace('T', ' '),
    // Invited by the team to the conference itself: not a panel-only row, and never on
    // the free-pass waiting list.
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
    return c.json({ error: 'Could not register them: ' + (e?.message || 'unknown error') }, 400)
  }
  if (hooks.audit) {
    try {
      await hooks.audit(c, 'team.guest', 'attendee', id,
        { name, mobile: shownNumber(wa), email: typedEmail || null, badge_type: pass.badge, payment_status: pass.payment, by: me.name, by_id: me.id },
        { actor: String(me.name || 'team').slice(0, 80), kind: 'team' })
    } catch { /* the guest is registered; the log never undoes that */ }
  }
  const saved = await one(c, `SELECT ${GUEST_COLS} FROM attendees WHERE id = ?`, id)
  return c.json({ success: true, guest: await sendKit(c, saved, me.name) }, 201)
})

// The guests this team member registered, newest first, each with its links to send again.
tg.get('/api/team/guests', async (c) => {
  const t = await teamMember(c)
  if ('res' in t) return t.res
  const rows = await all(c, `SELECT ${GUEST_COLS} FROM attendees WHERE event_id = 1 AND registration_source = ? ORDER BY id DESC LIMIT 200`, 'team:' + t.me.id)
  const guests = []
  for (const r of rows) guests.push(await sendKit(c, r, t.me.name))
  return c.json({ guests })
})

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
  <p class="gp-foot">Questions? Reply on WhatsApp to the person who sent you this link.</p>
  <script type="application/json" id="gp-data">${jsonInScript({ pass: p, token: o.token })}</script>
  <script src="/js/vendor/qrcode-generator.js?v=20261029"></script>
  <script src="/js/pass-render.js?v=20261114"></script>
  <script src="/static/guest-pass.js?v=20261116"></script>` : `
  <h1 class="gp-title">This pass link does not open</h1>
  <p class="gp-when">Check that the whole link was copied, or ask the person who sent it to send it again.</p>`}
</main>
</body></html>`
}

// The guest's pass. Only for a guest the team registered on this screen: the token is
// the same one every pass's QR carries, and somebody holding another person's badge
// must not be able to read their details here.
tg.get('/pass/:token', async (c) => {
  const token = String(c.req.param('token') || '').slice(0, 80)
  const id = hooks.readPassToken ? await hooks.readPassToken(c, token) : null
  let row: any = null
  if (id != null) {
    row = await one(c, 'SELECT id, name, company, job_title, badge_type, role, avatar_url, registration_source, main_event FROM attendees WHERE id = ?', id).catch(() => null)
    if (row && (!String(row.registration_source || '').startsWith('team:') || Number(row.main_event ?? 1) === 0)) row = null
  }
  c.header('Cache-Control', 'no-store')
  c.header('X-Robots-Tag', 'noindex, nofollow')
  const pass = row ? { id: Number(row.id), name: row.name, company: row.company || '', job_title: row.job_title || '',
    badge_type: row.badge_type || 'Visitor Pass', role: row.role || 'attendee', avatar_url: row.avatar_url || '' } : null
  return c.html(guestPassPageHTML({ pass, token: pass ? token : '' }), pass ? 200 : 404)
})

export default tg
