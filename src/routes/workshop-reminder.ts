import { Hono } from 'hono'
import { conferenceReady, hallsFor, hallLabel, dayLabel, clock, MUMBAI_WORDS } from './conference'

// ==================== WORKSHOP EMAILS (15 Nov 2026) ====================
//
// The organiser, five days out: "should we send email to registered paid users to
// select the workshop" - yes. 16 paid Premium Delegate and VIP holders had no seat
// and the only nudge they ever got was one line in the payment email. One email per
// person, previewed and sent from Admin -> Workshops, of one of two kinds:
//   - 'choose': no seat yet. Every workshop still open, with its time, room and what
//     to bring, and a button that signs them in at the seat picker (?action=workshop).
//   - 'seat': they hold a seat. Their workshop's time and room, and what to do before
//     the day: for IBM's, install IBM Bob and sign in (the steps on /training-workshop).
// The kind follows the person: whoever has a seat by the time it goes gets 'seat'.
//
// Times and rooms come from the workshops table (Admin -> Workshops can move them),
// never from this file. What to bring is in BRING below, copied from each workshop's
// "What you need" on /training-workshop: change both together.
//
// Nobody is ticked for you. The list shows each person's pass, organisation and
// whether they said no to email, because a test record, our own team or a
// government guest may need leaving out or a personal note instead.
// A send is kept in admin_audit (action 'workshop.reminder', entity 'attendee'); the
// same kind again within 12 hours needs { again: true }, so a double click or a second
// "send to ticked" cannot email anyone twice. No migration: every table exists.
//
// Every /api/admin/* route here is behind the admin middleware in index.tsx.

type Workshop = { id: number; slug: string; title: string; speaker: string; summary: string; starts_at: string | null; ends_at: string | null;
  room: string; left: number; student_left: number; open: boolean }
type Hooks = {
  sendEmail?: (c: any, to: string, subject: string, html: string) => Promise<{ ok: boolean; error?: string }>
  audit?: (c: any, action: string, entity?: string, entityId?: any, detail?: any) => Promise<void>
  emailHeader?: (title: string, subtitle: string) => string
  // The app link that signs them in and opens the seat picker (index.tsx mints the token).
  signInLink?: (c: any, eventId: number, email: string) => Promise<string>
  workshops?: (c: any) => Promise<Workshop[]>
  closes?: (c: any) => Promise<string>
  tiers?: () => string[]
}
let hooks: Hooks = {}
export function configureWorkshopReminder(h: Hooks) { hooks = { ...hooks, ...h } }

const wr = new Hono<{ Bindings: any }>()
const SITE = 'https://bharataiinnovation.com'
export const AUDIT_ACTION = 'workshop.reminder'
const AGAIN_HOURS = 12

const all = async (c: any, sql: string, ...args: any[]) => (((await c.env.DB.prepare(sql).bind(...args).all()) as any).results || []) as any[]
const one = async (c: any, sql: string, ...args: any[]) => (await c.env.DB.prepare(sql).bind(...args).first()) as any
const escH = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// What each workshop asks people to bring and do first, from /training-workshop.
// short: one line under the workshop in the 'choose' email. steps: the 'seat' email.
export const BRING: Record<string, { short: string; steps: string[]; links: { href: string; text: string }[] }> = {
  'ibm-workshop': {
    short: 'Bring a laptop with IBM Bob installed and signed in. The steps come with your seat.',
    steps: [
      'Bring a laptop (8 GB RAM, Chrome or Edge) and its charger. The whole workshop runs in IBM Bob on your own laptop. A personal laptop is safer than an office one, which may block the install.',
      'Make an IBMid at ibm.com/account/reg. Your work email can be your IBMid.',
      'Start the free trial at bob.ibm.com/trial. Start it close to the workshop: the 30 days begin when you sign up.',
      'Download IBM Bob from bob.ibm.com/download and install it. Open it, sign in, and check your name shows at the top right.',
      'Make an empty folder on your desktop called aegis-workshop and open it in IBM Bob.',
      'Ready check: in IBM Bob type "Hello, what can you do?". If Bob answers, you are ready.',
    ],
    links: [
      { href: SITE + '/training-workshop#ibm-workshop', text: 'Every step on our website' },
      { href: SITE + '/docs/ibm-bob-install-guide.pdf', text: 'IBM Bob installation guide, with pictures (PDF)' },
    ],
  },
  'llm-fine-tuning': {
    short: 'Bring a laptop. Everything runs in your browser; you need a Google account and a free Hugging Face account.',
    steps: [
      'Bring a laptop (8 GB RAM, Chrome or Edge) and its charger. Tablets and phones will not work.',
      'Sign in to a Google account on that laptop and check that colab.research.google.com opens.',
      'Make a free Hugging Face account, create a read access token and save it somewhere you can copy it from.',
      'Office laptops often block Colab and Hugging Face. A personal laptop is safer.',
    ],
    links: [{ href: SITE + '/training-workshop#llm-fine-tuning', text: 'More on our website' }],
  },
}

// ---------- pure helpers (scripts/verify/smoke-workshop-reminder.mjs checks each) ----------

const firstName = (name: any) => String(name || '').replace(/^(hon[’']?ble|shri\.?|smt\.?|dr\.?|mr\.?|ms\.?|mrs\.?|prof\.?)\s+/gi, '').trim().split(/\s+/)[0] || 'there'

// "Friday 20 November, 11:30 am to 1:00 pm", or "Day and time to be announced".
export function whenText(w: { starts_at?: any; ends_at?: any }): string {
  const s = String(w.starts_at || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/.test(s)) return 'Day and time to be announced'
  const e = String(w.ends_at || '').trim()
  const end = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/.test(e) ? ' to ' + clock(e) : ''
  return `${dayLabel(s)}, ${clock(s)}${end}`
}

// "15 November, 11:59 pm" for the switch cut-off (IST wall clock).
export function closesText(v: any): string {
  const s = String(v || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/.test(s)) return ''
  return `${dayLabel(s)}, ${clock(s)}`
}

// Which workshops a person may still choose: open, and with a seat left for them
// (a Student Pass may fill only its share of a workshop).
export function choosable(list: Workshop[], badge: string): Workshop[] {
  const student = badge === 'Student Pass'
  return list.filter(w => w.open && (student ? w.student_left : w.left) > 0)
}

export function reminderSubject(kind: 'choose' | 'seat', w: Workshop | null): string {
  if (kind === 'choose') return 'Your pass includes a workshop: choose your seat'
  const day = w && w.starts_at ? dayLabel(String(w.starts_at)).split(' ')[0] : ''
  return `Your workshop${day ? ' on ' + day : ''}: ${w ? w.title : ''}`.trim()
}

// The email. href '#preview' is what a preview carries, so a preview never mints a
// sign-in link. where(room) gives "Raman Theatre, First Floor, Centre One".
export function reminderEmailHTML(x: { kind: 'choose' | 'seat'; a: any; seat: Workshop | null; options: Workshop[]; closes: string; canSwitch: boolean;
    header: string; href: string; where: (room: string) => string; line: string }): { subject: string; html: string } {
  const { kind, a, seat } = x
  const subject = reminderSubject(kind, seat)
  const pass = String(a.badge_type || 'pass')
  const row = (k: string, v: string) => `<tr><td style="color:#6b7280;padding:2px 14px 2px 0;vertical-align:top;white-space:nowrap">${k}</td><td style="padding:2px 0">${v}</td></tr>`
  const card = (w: Workshop, withBring: boolean) => {
    const bring = BRING[w.slug]
    return `<div style="border:1px solid #e7e9f5;border-radius:12px;padding:16px 18px;margin:0 0 12px;background:#fbfcff">
      <div style="font-size:17px;font-weight:bold;margin:0 0 4px;color:#1e2140">${escH(w.title)}</div>
      ${w.speaker ? `<div style="font-size:13px;color:#555;margin:0 0 10px">${escH(w.speaker)}</div>` : ''}
      <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.6;color:#1e2140">
        ${row('When', `<strong>${escH(whenText(w))}</strong>`)}
        ${row('Where', `<strong>${escH(x.where(w.room) || 'Room to be announced')}</strong>`)}
        ${withBring && bring ? row('Bring', escH(bring.short)) : ''}
      </table>
    </div>`
  }
  const button = (text: string) => `<div style="text-align:center;margin:20px 0 8px">
      <a href="${escH(x.href)}" style="display:inline-block;padding:13px 28px;background:#C84F00;color:#fff;text-decoration:none;border-radius:10px;font-weight:bold;font-size:15px">${escH(text)}</a>
    </div>
    <p style="font-size:12px;color:#6b7280;margin:0 0 6px;text-align:center">The button signs you in. It works for 7 days; after that, sign in at the app with this email address.</p>`
  const p = (t: string) => `<p style="font-size:15px;line-height:1.65;margin:0 0 14px">${t}</p>`

  let body = ''
  if (kind === 'choose') {
    body = p(`Your ${escH(pass)} includes one hands-on workshop, and you have not chosen yours yet. Seats go first come, first served. Choosing takes a few seconds in the app.`) +
      x.options.map(w => card(w, true)).join('') +
      button('Choose my workshop') +
      (x.canSwitch && x.closes ? p(`<span style="font-size:13px;color:#555">You can change your choice until ${escH(closesText(x.closes))}.</span>`) : '')
  } else if (seat) {
    const bring = BRING[seat.slug]
    body = p('Your workshop seat is booked. Here is everything for the day.') + card(seat, false) +
      (bring ? `<div style="border:1px solid #f3d9c6;border-radius:12px;padding:16px 18px;margin:6px 0 12px;background:#fff8f3">
        <div style="font-size:15px;font-weight:bold;color:#1e2140;margin:0 0 8px">Before you come</div>
        <ol style="margin:0;padding-left:20px;font-size:14px;line-height:1.65;color:#1e2140">${bring.steps.map(s => `<li style="margin:0 0 6px">${escH(s)}</li>`).join('')}</ol>
        ${bring.links.length ? `<p style="font-size:14px;margin:10px 0 0">${bring.links.map(l => `<a href="${escH(l.href)}" style="color:#C84F00;font-weight:bold">${escH(l.text)}</a>`).join('<br>')}</p>` : ''}
      </div>` : '') +
      button('See my workshop in the app') +
      (x.canSwitch && x.closes ? p(`<span style="font-size:13px;color:#555">Want a different workshop? You can switch in the app until ${escH(closesText(x.closes))}, while seats last.</span>`) : '')
  }
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f6f7fb;padding:24px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1e2140">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e7e9f5">
    ${x.header}
    <div style="padding:26px 26px 8px">
      ${p(`Dear ${escH(firstName(a.name))},`)}
      ${body}
      ${p('Questions? Reply to this email and we will help.')}
      <p style="margin:22px 0 24px;font-size:14px;color:#555">Team Bharat AI Innovation<br>
        <span style="color:#888">${escH(x.line).replace(' · ', ' &middot; ')}</span></p>
    </div>
  </div></body></html>`
  return { subject, html }
}

// ---------- reading ----------

// Who has a workshop in their pass: the tiers, not unpaid or refunded (the app's own
// rule, workshopEntitlement in index.tsx), with an email address.
async function entitledPeople(c: any, onlyId: number | null = null) {
  const tiers = hooks.tiers ? hooks.tiers() : ['Premium Delegate Pass', 'VIP Pass', 'Student Pass']
  const marks = tiers.map(() => '?').join(', ')
  return await all(c, `SELECT a.id, a.event_id, a.name, a.email, a.company, a.job_title, a.badge_type, a.payment_status, a.unsubscribed_at,
      (SELECT s.workshop_id FROM workshop_seats s WHERE s.event_id = 1 AND s.attendee_id = a.id) AS workshop_id
    FROM attendees a
    WHERE a.event_id = 1 AND a.badge_type IN (${marks})
      AND LOWER(TRIM(COALESCE(a.payment_status, ''))) NOT IN ('pending', 'refunded')
      AND TRIM(COALESCE(a.email, '')) <> ''${onlyId != null ? ' AND a.id = ?' : ''}
    ORDER BY a.name COLLATE NOCASE`, ...tiers, ...(onlyId != null ? [onlyId] : []))
}

// The last email of each kind each person was sent.
async function lastSent(c: any): Promise<Map<number, { at: string; kind: string; by: string; n: number }>> {
  const out = new Map<number, any>()
  try {
    const rows = await all(c, `SELECT entity_id, detail, actor, created_at FROM admin_audit WHERE action = ? AND entity = 'attendee' ORDER BY id`, AUDIT_ACTION)
    for (const r of rows) {
      let d: any = {}
      try { d = JSON.parse(r.detail || '{}') } catch { /* not JSON */ }
      const id = Number(r.entity_id)
      const was = out.get(id)
      out.set(id, { at: r.created_at, kind: String(d.kind || ''), by: r.actor || '', n: (was ? was.n : 0) + 1 })
    }
  } catch { /* no audit table: nothing sent as far as anyone can tell */ }
  return out
}

// Hours since an admin_audit stamp (UTC, 'YYYY-MM-DD HH:MM:SS').
const hoursSince = (t: any) => {
  const ms = Date.parse(String(t || '').replace(' ', 'T') + 'Z')
  return Number.isFinite(ms) ? (Date.now() - ms) / 3600000 : Infinity
}

async function whereFn(c: any): Promise<(room: string) => string> {
  let halls: any[] = []
  try { halls = await hallsFor(c, 1, (await conferenceReady(c)).halls) } catch { /* the room alone */ }
  return (room: string) => {
    const r = String(room || '').trim()
    if (!r) return ''
    const h = halls.find((x: any) => String(x.name || '').trim().toLowerCase() === r.toLowerCase())
    return [hallLabel(r), h && h.location ? String(h.location) : '', MUMBAI_WORDS.venue].filter(Boolean).join(', ')
  }
}

async function context(c: any) {
  const workshops = hooks.workshops ? await hooks.workshops(c) : []
  const closes = hooks.closes ? await hooks.closes(c) : ''
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(closes)
  const canSwitch = !!m && Date.now() < Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+05:30`)
  return { workshops, closes, canSwitch }
}

// ---------- routes ----------

wr.get('/api/admin/workshop-reminders', async (c) => {
  const [people, sent, ctx] = await Promise.all([entitledPeople(c), lastSent(c), context(c)])
  const title = new Map(ctx.workshops.map(w => [w.id, w.title]))
  const list = people.map((p: any) => ({
    id: Number(p.id), name: p.name || '', email: String(p.email || '').trim(), company: p.company || '', job_title: p.job_title || '',
    badge_type: p.badge_type || '', payment_status: p.payment_status || '', unsubscribed: !!p.unsubscribed_at,
    workshop_id: p.workshop_id == null ? null : Number(p.workshop_id),
    workshop: p.workshop_id == null ? '' : (title.get(Number(p.workshop_id)) || ''),
    kind: p.workshop_id == null ? 'choose' : 'seat',
    last: sent.get(Number(p.id)) || null,
  }))
  return c.json({ people: list, closes: ctx.closes, can_switch: ctx.canSwitch,
    open_workshops: ctx.workshops.filter(w => w.open && w.left > 0).length,
    counts: { choose: list.filter(p => p.kind === 'choose').length, seat: list.filter(p => p.kind === 'seat').length } })
})

// Preview ({ preview: true }) or send one person's email. { again: true } sends the
// same kind again within AGAIN_HOURS of the last one.
wr.post('/api/admin/attendees/:id/workshop-reminder', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json().catch(() => ({})) as any
  const [a] = await entitledPeople(c, id)
  if (!a) {
    const any = await one(c, 'SELECT id, name, badge_type, payment_status, email FROM attendees WHERE id = ?', id)
    if (!any) return c.json({ error: 'That person is not on the list any more.' }, 404)
    const who = String(any.name || '').trim() || 'This person'
    if (!String(any.email || '').trim()) return c.json({ error: 'There is no email address for ' + who + '.' }, 409)
    const st = String(any.payment_status || '').trim().toLowerCase()
    return c.json({ error: who + ' holds a ' + (any.badge_type || 'pass') + (st === 'pending' ? ' that is not paid yet' : st === 'refunded' ? ' that was refunded' : ' with no workshop in it') + '.' }, 409)
  }
  const ctx = await context(c)
  const seat = a.workshop_id == null ? null : (ctx.workshops.find(w => w.id === Number(a.workshop_id)) || null)
  const kind: 'choose' | 'seat' = seat ? 'seat' : 'choose'
  const options = choosable(ctx.workshops, String(a.badge_type || ''))
  if (kind === 'choose' && !options.length) return c.json({ error: 'Every workshop is full or closed, so there is nothing to choose. Open one in the cards above first.' }, 409)
  const where = await whereFn(c)
  const header = hooks.emailHeader ? hooks.emailHeader(kind === 'choose' ? 'Choose your workshop' : 'Your workshop', MUMBAI_WORDS.line) : ''
  const last = (await lastSent(c)).get(id) || null
  const email = String(a.email).trim()
  const build = (href: string) => reminderEmailHTML({ kind, a, seat, options, closes: ctx.closes, canSwitch: ctx.canSwitch, header, href, where, line: MUMBAI_WORDS.line })

  if (b.preview) {
    const mail = build('#preview')
    return c.json({ to: email, name: a.name, kind, subject: mail.subject, html: mail.html, last, unsubscribed: !!a.unsubscribed_at })
  }
  if (last && last.kind === kind && hoursSince(last.at) < AGAIN_HOURS && !b.again) {
    return c.json({ error: (String(a.name || '').trim() || 'This person') + ' was sent this email less than ' + AGAIN_HOURS + ' hours ago.', already: true, last }, 409)
  }
  if (!hooks.sendEmail) return c.json({ error: 'Email is not set up on this server.' }, 503)
  let href = ''
  if (hooks.signInLink) { try { href = await hooks.signInLink(c, Number(a.event_id) || 1, email.toLowerCase()) } catch { href = '' } }
  if (!href) href = SITE + '/app?action=workshop'
  const mail = build(href)
  const sent = await hooks.sendEmail(c, email, mail.subject, mail.html)
  if (!sent.ok) return c.json({ error: sent.error || 'The email did not go.' }, 502)
  if (hooks.audit) {
    try { await hooks.audit(c, AUDIT_ACTION, 'attendee', id, { kind, to: email, workshop_id: seat ? seat.id : null, subject: mail.subject }) }
    catch { /* the audit log never fails a send */ }
  }
  return c.json({ success: true, to: email, kind, subject: mail.subject })
})

export default wr
