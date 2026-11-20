import { Hono } from 'hono'
import { conferenceReady, hallsFor, hallLabel, dayLabel, clock, MUMBAI_WORDS } from './conference'
import { NO_EMAIL_SQL } from './team-guests'

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
  // Bulk sends share one pace and the 9am-9pm window with every other campaign
  // (claimSendSlot, sendWindowState in index.tsx): null = go, else the reply to give.
  pace?: (c: any) => Promise<null | { status: number; body: any }>
}
let hooks: Hooks = {}
export function configureWorkshopReminder(h: Hooks) { hooks = { ...hooks, ...h } }

const wr = new Hono<{ Bindings: any }>()
const SITE = 'https://bharataiinnovation.com'
export const AUDIT_ACTION = 'workshop.reminder'
const AGAIN_HOURS = 12

// Automatic (organiser, 15 Nov 2026: "send automated email after 15 min of
// registration to block the workshop"): the minute clock (POST /api/cron/tick) sends
// "Choose your workshop" once, AUTO_AFTER_MINUTES after a workshop pass is confirmed
// (the paid order for that pass, or the registration itself for a pass given free),
// to anyone who still has no seat and was never sent a workshop email. Only passes
// confirmed in the last AUTO_WITHIN_HOURS: older holders are the panel's to email.
// Claimed in admin_audit before it goes, so two clocks send it once; a failure is
// kept as 'workshop.reminder_error' and not retried (the panel shows them as not
// emailed). Off when app_settings AUTO_KEY = 'off' (the panel's switch).
export const AUTO_KEY = 'workshop_auto'
export const AUTO_AFTER_MINUTES = 15
const AUTO_WITHIN_HOURS = 48
const AUTO_PER_TICK = 10
const CRON_ALIVE_MS = 3 * 60 * 1000

// Passes without a workshop (organiser, 15 Nov 2026: "send to even free pass so they
// get motivated to buy ... let them try booking workshop then prompt and store that
// data who all tried to book workshop so tomorrow we can call them"):
//   - 'invite': the open workshops, their time, room and what to bring, and a button
//     that signs them in at the workshops. It says nothing untrue: not that a seat is
//     included, not that it is free. The pass and the price are on the sheet the app
//     shows when they press "Book this seat" (showUpgradeModal 'workshop').
//   - Sent in bulk as the campaign kind 'workshop_invite' (paced like every campaign,
//     honouring unsubscribes, campus-panel-only left out), and by the minute clock
//     AUTO_AFTER_MINUTES after a pass without a workshop is confirmed (same switch).
//   - Each send is 'workshop.invite' in admin_audit; nobody gets it twice.
//   - Each "Book this seat" pressed without a workshop in the pass is 'workshop.tried'
//     (POST /api/workshops/choose -> noteWorkshopTry); Admin -> Workshops lists them
//     with phone and email for the sales calls, and says who has bought since.
export const INVITE_PASSES = ['Visitor Pass', 'Expo Pass', 'Delegate Pass', 'Academic Pass']
export const INVITE_ACTION = 'workshop.invite'
export const TRY_ACTION = 'workshop.tried'

// The Delegate Pass bonus (organiser, 16 Nov 2026, four days out: "give access to
// workshop to delagtes as well. also pre price increase thos who bough delegation give
// them workshop access as well. and send them notification"). Agreed with them the same
// hour: one workshop for everyone who held a Delegate Pass then, bought before or after
// the 6 Nov price rise or given free. The Delegate Pass on sale still has no workshop
// (that is the Premium Delegate Pass), so no public page changed.
//   - The holders are listed by attendee id, read from production at 12:40 pm IST on 16 Nov.
//     A date rule would also let in someone made a Delegate later by a group booking or
//     by hand. The pass must still be a Delegate Pass, not unpaid or refunded
//     (workshopEntitlement in index.tsx). Anyone else: Admin -> Workshops seats anyone.
//   - They are on the "Choose your workshop" list and never sent the invitation again.
//   - The notice is the "Choose your workshop" email in their own words (reminderEmailHTML),
//     sent once by the minute clock (autoWorkshopReminders), 9am to 9pm India, on the
//     same switch, to nobody who unsubscribed (the panel can still send to them).
//   - index.tsx refuses them the Premium Delegate step (it would add nothing) and the
//     app leaves it out of their "Move up" list.
export const BONUS_PASS = 'Delegate Pass'
export const BONUS_IDS: ReadonlySet<number> = new Set([
  39, 79, 210, 352, 510, 565, 574, 704, 734, 753, 769, 770, 806, 819, 880, 927, 1613, 1634, 1658, 2118, 2119,
  2751, 2752, 2781, 2824, 2870, 2943, 2944, 2952, 3002, 3012, 3027, 3030, 3039, 3076, 3078, 3079, 3088, 3455,
  3483, 3496, 3498, 3510, 3511, 3513, 3520, 3524, 3535, 3537, 3558, 3564, 3567, 3571, 3573, 3574, 3579, 3597,
  3599, 3601, 3605, 3621, 3623, 3624, 3784, 3786, 3788, 3796, 3805, 3840, 3852, 3862, 3938, 3945, 3952, 3953,
  3958, 3966,
])
// A Delegate Pass on the list (row with id and badge_type). Paid or not is the caller's rule.
export const isWorkshopBonus = (a: any): boolean =>
  String(a?.badge_type || '').trim() === BONUS_PASS && BONUS_IDS.has(Number(a?.id))
// The same in SQL, for a row aliased p ('a.').
export const workshopBonusSql = (p = 'a.'): string =>
  `(${p}badge_type = '${BONUS_PASS}' AND ${p}id IN (${[...BONUS_IDS].join(', ') || '0'}))`
const BONUS_HOURS_IST = { from: 9, to: 21 }
const bonusHour = (nowMs = Date.now()) => { const h = new Date(nowMs + 5.5 * 3600000).getUTCHours(); return h >= BONUS_HOURS_IST.from && h < BONUS_HOURS_IST.to }

// Who may be sent the invitation: the conference (not campus-panel-only), nobody who
// unsubscribed or said no to email, a pass without a workshop that is not unpaid.
const INVITE_WHERE = `a.event_id = 1 AND COALESCE(a.main_event, 1) = 1
  AND a.unsubscribed_at IS NULL AND (a.marketing_consent IS NULL OR a.marketing_consent = 1)
  AND LOWER(TRIM(COALESCE(a.payment_status, ''))) NOT IN ('pending', 'refunded')
  AND TRIM(COALESCE(a.email, '')) <> '' AND ${NO_EMAIL_SQL('a.')} AND NOT ${workshopBonusSql('a.')}`

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

type Kind = 'choose' | 'seat' | 'invite'

// The one day every listed workshop is on ("Friday 20 November"), or ''.
export function oneDay(list: Workshop[]): string {
  const days = Array.from(new Set(list.map(w => (w.starts_at ? dayLabel(String(w.starts_at)) : '')).filter(Boolean)))
  return days.length === 1 && list.every(w => w.starts_at) ? days[0] : ''
}
const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const count = (n: number) => NUMBER_WORDS[n] || String(n)

export function reminderSubject(kind: Kind, w: Workshop | null, options: Workshop[] = [], bonus = false): string {
  if (kind === 'choose') return bonus ? 'We have added a workshop to your Delegate Pass: choose your seat' : 'Your pass includes a workshop: choose your seat'
  if (kind === 'invite') {
    const day = oneDay(options)
    return `Hands-on AI workshops${day ? ' on ' + day : ''}: book your seat`
  }
  const day = w && w.starts_at ? dayLabel(String(w.starts_at)).split(' ')[0] : ''
  return `Your workshop${day ? ' on ' + day : ''}: ${w ? w.title : ''}`.trim()
}

// The email. href '#preview' is what a preview carries, so a preview never mints a
// sign-in link. where(room) gives "Raman Theatre, First Floor, Centre One".
export function reminderEmailHTML(x: { kind: Kind; a: any; seat: Workshop | null; options: Workshop[]; closes: string; canSwitch: boolean;
    header: string; href: string; where: (room: string) => string; line: string; subject?: string; intro?: string; buttonText?: string }): { subject: string; html: string } {
  const { kind, a, seat } = x
  const bonus = isWorkshopBonus(a)
  const subject = x.subject || reminderSubject(kind, seat, x.options, bonus)
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
  if (kind === 'invite' && x.intro) {
    body = p(escH(x.intro)) + x.options.map(w => card(w, true)).join('') + button(x.buttonText || 'Book my seat') +
      p('<span style="font-size:13px;color:#555">Seats are limited and go first come, first served.</span>')
  } else if (kind === 'invite') {
    const day = oneDay(x.options)
    const n = x.options.length
    body = p(`${day ? 'On ' + escH(day) + ', ' : 'At Bharat AI Innovation, '}${n === 1 ? 'a hands-on workshop runs' : escH(count(n)) + ' hands-on workshops run'}${day ? ' at Bharat AI Innovation' : ''}, ${n === 1 ? 'led' : 'each led'} by an industry expert. Pick the one you want and book your seat in the app.`) +
      x.options.map(w => card(w, true)).join('') +
      button('See the workshops and book') +
      p('<span style="font-size:13px;color:#555">Seats in each workshop are limited.</span>')
  } else if (kind === 'choose') {
    body = (bonus
      ? p('Good news: we have added one hands-on workshop to your Delegate Pass, at no extra cost.') +
        p('Pick the one you want below. Seats go first come, first served, and choosing takes a few seconds in the app.')
      : p(`Your ${escH(pass)} includes one hands-on workshop, and you have not chosen yours yet. Seats go first come, first served. Choosing takes a few seconds in the app.`)) +
      x.options.map(w => card(w, true)).join('') +
      button('Choose my workshop') +
      (x.canSwitch && x.closes ? p(`<span style="font-size:13px;color:#555">You can change your choice until ${escH(closesText(x.closes))}.</span>`) : '')
  } else if (seat) {
    const bring = BRING[seat.slug]
    body = p(x.intro ? escH(x.intro) : 'Your workshop seat is booked. Here is everything for the day.') + card(seat, false) +
      (bring ? `<div style="border:1px solid #f3d9c6;border-radius:12px;padding:16px 18px;margin:6px 0 12px;background:#fff8f3">
        <div style="font-size:15px;font-weight:bold;color:#1e2140;margin:0 0 8px">Before you come</div>
        <ol style="margin:0;padding-left:20px;font-size:14px;line-height:1.65;color:#1e2140">${bring.steps.map(s => `<li style="margin:0 0 6px">${escH(s)}</li>`).join('')}</ol>
        ${bring.links.length ? `<p style="font-size:14px;margin:10px 0 0">${bring.links.map(l => `<a href="${escH(l.href)}" style="color:#C84F00;font-weight:bold">${escH(l.text)}</a>`).join('<br>')}</p>` : ''}
      </div>` : '') +
      button(x.buttonText || 'See my workshop in the app') +
      (!x.intro && x.canSwitch && x.closes ? p(`<span style="font-size:13px;color:#555">Want a different workshop? You can switch in the app until ${escH(closesText(x.closes))}, while seats last.</span>`) : '')
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

// Who has a workshop in their pass: the tiers and the Delegate Pass bonus, not unpaid
// or refunded (the app's own rule, workshopEntitlement in index.tsx), with an email address.
async function entitledPeople(c: any, onlyId: number | null = null) {
  const tiers = hooks.tiers ? hooks.tiers() : ['Premium Delegate Pass', 'VIP Pass', 'Student Pass']
  const marks = tiers.map(() => '?').join(', ')
  return await all(c, `SELECT a.id, a.event_id, a.name, a.email, a.company, a.job_title, a.badge_type, a.payment_status, a.unsubscribed_at,
      (SELECT s.workshop_id FROM workshop_seats s WHERE s.event_id = 1 AND s.attendee_id = a.id) AS workshop_id
    FROM attendees a
    WHERE a.event_id = 1 AND (a.badge_type IN (${marks}) OR ${workshopBonusSql('a.')})
      AND LOWER(TRIM(COALESCE(a.payment_status, ''))) NOT IN ('pending', 'refunded')
      AND TRIM(COALESCE(a.email, '')) <> '' AND ${NO_EMAIL_SQL('a.')}${onlyId != null ? ' AND a.id = ?' : ''}
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
      out.set(id, { at: r.created_at, kind: String(d.kind || ''), by: r.actor || '', auto: !!d.auto, n: (was ? was.n : 0) + 1 })
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

// ---------- automatic ----------

async function setting(c: any, key: string): Promise<string> {
  try { return String((await one(c, 'SELECT value FROM app_settings WHERE key = ?', key))?.value ?? '') } catch { return '' }
}

// Who is due, AUTO_AFTER_MINUTES after their pass was confirmed (the paid order for
// it, or the registration for a pass given free) and within AUTO_WITHIN_HOURS:
//   'choose': a workshop pass, no seat, never sent a workshop email of any kind;
//   'invite': a pass without a workshop (INVITE_WHERE), never sent the invitation.
async function autoDue(c: any, kind: 'choose' | 'invite', limit: number): Promise<any[]> {
  if (limit <= 0) return []
  const passes = kind === 'invite' ? INVITE_PASSES : (hooks.tiers ? hooks.tiers() : ['Premium Delegate Pass', 'VIP Pass', 'Student Pass'])
  const marks = passes.map(() => '?').join(', ')
  const action = kind === 'invite' ? INVITE_ACTION : AUDIT_ACTION
  const who = kind === 'invite' ? INVITE_WHERE
    : `a.event_id = 1 AND LOWER(TRIM(COALESCE(a.payment_status, ''))) NOT IN ('pending', 'refunded') AND TRIM(COALESCE(a.email, '')) <> ''
       AND ${NO_EMAIL_SQL('a.')}
       AND NOT EXISTS (SELECT 1 FROM workshop_seats s WHERE s.event_id = 1 AND s.attendee_id = a.id)`
  try {
    return await all(c, `SELECT * FROM (
        SELECT a.id, a.event_id, a.name, a.email, a.badge_type, a.payment_status,
          COALESCE((SELECT MAX(o.paid_at) FROM payment_orders o WHERE o.attendee_id = a.id AND o.status = 'paid' AND o.pass_type IN (${marks})), a.created_at) AS due_at
          FROM attendees a
         WHERE a.badge_type IN (${marks}) AND ${who}
           AND NOT EXISTS (SELECT 1 FROM admin_audit x WHERE x.entity = 'attendee' AND x.entity_id = CAST(a.id AS TEXT) AND x.action IN (?, ?)))
      WHERE due_at <= datetime('now', ?) AND due_at > datetime('now', ?)
      ORDER BY due_at LIMIT ?`,
      ...passes, ...passes, action, action + '_error', `-${AUTO_AFTER_MINUTES} minutes`, `-${AUTO_WITHIN_HOURS} hours`, limit)
  } catch { return [] }
}

// The Delegate Pass bonus holders still to be told (BONUS_IDS): paid or given free, no
// seat, never sent a workshop email of this kind, not unsubscribed. No time window:
// every one of them is told once.
async function bonusDue(c: any, limit: number): Promise<any[]> {
  if (limit <= 0 || !bonusHour()) return []
  try {
    return await all(c, `SELECT a.id, a.event_id, a.name, a.email, a.badge_type, a.payment_status FROM attendees a
       WHERE a.event_id = 1 AND ${workshopBonusSql('a.')}
         AND LOWER(TRIM(COALESCE(a.payment_status, ''))) NOT IN ('pending', 'refunded')
         AND a.unsubscribed_at IS NULL
         AND TRIM(COALESCE(a.email, '')) <> '' AND ${NO_EMAIL_SQL('a.')}
         AND NOT EXISTS (SELECT 1 FROM workshop_seats s WHERE s.event_id = 1 AND s.attendee_id = a.id)
         AND NOT EXISTS (SELECT 1 FROM admin_audit x WHERE x.entity = 'attendee' AND x.entity_id = CAST(a.id AS TEXT) AND x.action IN (?, ?))
       ORDER BY a.id LIMIT ?`, AUDIT_ACTION, AUDIT_ACTION + '_error', limit)
  } catch { return [] }
}

// The minute clock's part. Never throws.
export async function autoWorkshopReminders(c: any): Promise<any> {
  if ((await setting(c, AUTO_KEY)).trim() === 'off') return { on: false }
  if (!hooks.sendEmail) return { on: true, error: 'Email is not set up on this server.' }
  const fresh = await autoDue(c, 'choose', AUTO_PER_TICK)
  const bonus = await bonusDue(c, AUTO_PER_TICK - fresh.length)
  const choose = [...fresh, ...bonus]
  const invite = await autoDue(c, 'invite', AUTO_PER_TICK - choose.length)
  if (!choose.length && !invite.length) return { on: true, due: 0, sent: 0 }
  const ctx = await context(c)
  const where = await whereFn(c)
  const headers: Record<string, string> = {
    choose: hooks.emailHeader ? hooks.emailHeader('Choose your workshop', MUMBAI_WORDS.line) : '',
    invite: hooks.emailHeader ? hooks.emailHeader('Hands-on workshops', MUMBAI_WORDS.line) : '',
  }
  let sent = 0, invited = 0, failed = 0, waiting = 0
  const due = [...choose.map(a => ({ a, kind: 'choose' as const })), ...invite.map(a => ({ a, kind: 'invite' as const }))]
  for (const { a, kind } of due) {
    // Nothing to choose (every workshop full or closed): not claimed, so it goes
    // if one opens again while they are still in the window.
    const options = kind === 'invite' ? ctx.workshops.filter(w => w.open && w.left > 0) : choosable(ctx.workshops, String(a.badge_type || ''))
    if (!options.length) { waiting++; continue }
    const action = kind === 'invite' ? INVITE_ACTION : AUDIT_ACTION
    const email = String(a.email || '').trim()
    const claim = await c.env.DB.prepare(
      `INSERT INTO admin_audit (actor, actor_kind, action, entity, entity_id, detail)
       SELECT 'scheduler', 'system', ?1, 'attendee', ?2, ?3
        WHERE NOT EXISTS (SELECT 1 FROM admin_audit WHERE entity = 'attendee' AND entity_id = ?2 AND action IN (?1, ?4))`
    ).bind(action, String(a.id), JSON.stringify({ kind, to: email, auto: true, ...(isWorkshopBonus(a) ? { bonus: true } : {}) }), action + '_error').run().catch(() => null) as any
    if (!Number(claim?.meta?.changes)) continue
    const claimId = claim?.meta?.last_row_id
    let res: { ok: boolean; error?: string }
    try {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error('Not a usable email address.')
      let href = ''
      if (hooks.signInLink) { try { href = await hooks.signInLink(c, Number(a.event_id) || 1, email.toLowerCase()) } catch { href = '' } }
      const mail = reminderEmailHTML({ kind, a, seat: null, options, closes: ctx.closes, canSwitch: ctx.canSwitch, header: headers[kind],
        href: href || SITE + '/app?action=workshop', where, line: MUMBAI_WORDS.line })
      res = await hooks.sendEmail(c, email, mail.subject, mail.html)
    } catch (e: any) { res = { ok: false, error: String(e?.message || e) } }
    if (res.ok) { if (kind === 'invite') invited++; else sent++; continue }
    failed++
    await c.env.DB.prepare('UPDATE admin_audit SET action = ?, detail = ? WHERE id = ?')
      .bind(action + '_error', JSON.stringify({ kind, to: email, auto: true, ...(isWorkshopBonus(a) ? { bonus: true } : {}), error: String(res.error || 'not sent').slice(0, 300) }), claimId).run().catch(() => null)
  }
  return { on: true, due: due.length, sent, invited, failed, waiting }
}

// For the panel: on or off, how many went by themselves, and whether the clock knocks.
async function autoState(c: any) {
  let n: any = null
  try {
    n = await one(c, `SELECT SUM(action = ?1) AS sent, SUM(action = ?3) AS invited, SUM(action IN (?2, ?4)) AS failed FROM admin_audit
      WHERE entity = 'attendee' AND action IN (?1, ?2, ?3, ?4) AND json_extract(detail, '$.auto') = 1`,
      AUDIT_ACTION, AUDIT_ACTION + '_error', INVITE_ACTION, INVITE_ACTION + '_error')
  } catch { /* no audit table */ }
  const tick = Number(await setting(c, 'cron_last_tick')) || 0
  return { on: (await setting(c, AUTO_KEY)).trim() !== 'off', after_minutes: AUTO_AFTER_MINUTES,
    sent: Number(n?.sent || 0), invited: Number(n?.invited || 0), failed: Number(n?.failed || 0), clock_running: Date.now() - tick < CRON_ALIVE_MS }
}

// ---------- routes ----------

// The panel's switch. On unless somebody turned it off.
wr.post('/api/admin/workshop-reminders/auto', async (c) => {
  const b = await c.req.json().catch(() => ({})) as any
  const on = b.on !== false
  await c.env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP")
    .bind(AUTO_KEY, on ? 'on' : 'off').run()
  if (hooks.audit) { try { await hooks.audit(c, 'workshop.reminder_auto_switch', 'setting', AUTO_KEY, { on }) } catch { /* never fails the switch */ } }
  return c.json({ ok: true, auto: await autoState(c) })
})

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
  return c.json({ people: list, closes: ctx.closes, can_switch: ctx.canSwitch, auto: await autoState(c),
    open_workshops: ctx.workshops.filter(w => w.open && w.left > 0).length,
    counts: { choose: list.filter(p => p.kind === 'choose').length, seat: list.filter(p => p.kind === 'seat').length } })
})

// Preview ({ preview: true }) or send one person's email. { again: true } sends the
// same kind again within AGAIN_HOURS of the last one.
wr.post('/api/admin/attendees/:id/workshop-reminder', async (c) => {
  const b = await c.req.json().catch(() => ({})) as any
  return sendReminder(c, Number(c.req.param('id')), b)
})

// Saturday's workshop (the organiser, 20 Nov night: "send tomorrows workshop details as
// well", "we had poor workshop participation today"): sent by the minute clock (index.tsx,
// while app_settings.sat_reminders is 'on'), each person once (admin_audit
// workshop.sat_reminder), a few a minute, until the last Saturday workshop starts. A seat on
// Saturday gets "Your workshop on Saturday" with what to bring; a workshop pass with no seat
// gets "choose your seat" (only open workshops with room are listed); a Friday seat is left out.
const SAT_DAY = '2026-11-21'
const SAT_ACTION = 'workshop.sat_reminder'
const istMs = (v: any) => { const t = Date.parse(String(v || '').replace(' ', 'T').slice(0, 16) + ':00+05:30'); return Number.isFinite(t) ? t : -Infinity }
export async function saturdayWorkshopReminders(c: any, max = 10, nowMs = Date.now()): Promise<{ sent: number; failed: number; left: number }> {
  const out = { sent: 0, failed: 0, left: 0 }
  const ctx = await context(c)
  const sat = ctx.workshops.filter(w => String(w.starts_at || '').slice(0, 10) === SAT_DAY)
  if (!sat.length || !sat.some(w => istMs(w.starts_at) > nowMs)) return out
  const done = new Set((await all(c, "SELECT entity_id FROM admin_audit WHERE entity = 'attendee' AND action = ?", SAT_ACTION).catch(() => [])).map((r: any) => String(r.entity_id)))
  // Friday's seat holders are invited to Saturday's workshop too (the organiser: "send
  // details to even todays workshop attendees and participants"): the first Saturday
  // workshop still to start, shown as theirs, "you are welcome to join it with your pass".
  const next = sat.filter(w => istMs(w.starts_at) > nowMs).sort((x, y) => istMs(x.starts_at) - istMs(y.starts_at))[0]
  for (const a of await entitledPeople(c)) {
    if (done.has(String(a.id))) continue
    const seat = a.workshop_id == null ? null : (ctx.workshops.find(w => w.id === Number(a.workshop_id)) || null)
    const friday = !!seat && String(seat.starts_at || '').slice(0, 10) < SAT_DAY
    if (seat && !friday && !(String(seat.starts_at || '').slice(0, 10) === SAT_DAY && istMs(seat.starts_at) > nowMs)) continue
    if (!seat && !choosable(ctx.workshops, String(a.badge_type || '')).length) continue
    if (out.sent + out.failed >= max) { out.left++; continue }
    const res = await sendReminder(c, Number(a.id), friday
      ? { again: true, audit_action: SAT_ACTION, seat_id: next.id, subject: 'One more workshop on Saturday: ' + next.title,
          intro: 'One more hands-on workshop runs on Saturday 21 Nov, and you are welcome to join it with your pass. Here is everything for the day.', button: 'Open the app' }
      : { again: true, audit_action: SAT_ACTION })
    if (res.status === 200) out.sent++; else out.failed++
  }
  return out
}

// Saturday's workshop opened to Delegate and Expo passes, free (the organiser, 20 Nov night,
// "go ahead", after poor turnout on Friday; the booking rule is workshopEntitlement in
// index.tsx). One email each (admin_audit workshop.open_invite), sent by the minute clock
// with the other Saturday reminders, likeliest first, until the seats are gone. Unsubscribed,
// no-marketing, unpaid and the Delegate bonus holders (sent "choose your seat") are left out,
// as is anyone with a Saturday seat already.
const OPEN_ACTION = 'workshop.open_invite'
export async function saturdayWorkshopOpenInvites(c: any, max = 20): Promise<{ sent: number; failed: number; left: number }> {
  const out = { sent: 0, failed: 0, left: 0 }
  const ctx = await context(c)
  const options = ctx.workshops.filter(w => w.open && w.left > 0 && String(w.starts_at || '').slice(0, 10) === SAT_DAY)
  if (!options.length || !hooks.sendEmail) return out
  const rows = inviteOrder((await all(c, `SELECT a.id, a.event_id, a.name, a.email, a.badge_type, a.job_title, a.last_login_at FROM attendees a
    WHERE a.badge_type IN ('Delegate Pass', 'Expo Pass') AND ${INVITE_WHERE}
      AND NOT EXISTS (SELECT 1 FROM admin_audit x WHERE x.entity = 'attendee' AND x.entity_id = CAST(a.id AS TEXT) AND x.action = ?)
      AND NOT EXISTS (SELECT 1 FROM workshop_seats s JOIN workshops w ON w.id = s.workshop_id WHERE s.attendee_id = a.id AND w.starts_at LIKE '${SAT_DAY}%')`, OPEN_ACTION))
    .filter((r: any) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(r.email || '').trim())))
  const where = await whereFn(c)
  const header = hooks.emailHeader ? hooks.emailHeader('Saturday’s workshop, free for your pass', MUMBAI_WORDS.line) : ''
  for (const a of rows) {
    if (out.sent + out.failed >= max) { out.left++; continue }
    const email = String(a.email).trim()
    let href = ''
    if (hooks.signInLink) { try { href = await hooks.signInLink(c, Number(a.event_id) || 1, email.toLowerCase()) } catch { href = '' } }
    const mail = reminderEmailHTML({ kind: 'invite', a, seat: null, options, closes: ctx.closes, canSwitch: ctx.canSwitch, header, href: href || SITE + '/app?action=workshop', where, line: MUMBAI_WORDS.line,
      subject: 'Free for your pass: Saturday’s hands-on workshop, ' + options[0].title,
      intro: `Good news: Saturday’s hands-on workshop is now open to your ${String(a.badge_type || 'pass')}, at no extra cost. Seats are limited and go first come, first served: book yours in the app before you come.` })
    const sent = await hooks.sendEmail(c, email, mail.subject, mail.html)
    if (!sent.ok) { out.failed++; continue }
    out.sent++
    if (hooks.audit) { try { await hooks.audit(c, OPEN_ACTION, 'attendee', a.id, { kind: 'open_invite', to: email, workshop_id: options[0].id }) } catch { /* never fails a send */ } }
  }
  return out
}

async function sendReminder(c: any, id: number, b: any): Promise<Response> {
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
  // b.seat_id: the workshop to tell them about instead of their own seat (Saturday's, for
  // Friday's seat holders; the clock's Saturday reminder only).
  const seat = b.seat_id ? (ctx.workshops.find(w => w.id === Number(b.seat_id)) || null)
    : a.workshop_id == null ? null : (ctx.workshops.find(w => w.id === Number(a.workshop_id)) || null)
  const kind: 'choose' | 'seat' = seat ? 'seat' : 'choose'
  const options = choosable(ctx.workshops, String(a.badge_type || ''))
  if (kind === 'choose' && !options.length) return c.json({ error: 'Every workshop is full or closed, so there is nothing to choose. Open one in the cards above first.' }, 409)
  const where = await whereFn(c)
  const header = hooks.emailHeader ? hooks.emailHeader(kind === 'choose' ? 'Choose your workshop' : 'Your workshop', MUMBAI_WORDS.line) : ''
  const last = (await lastSent(c)).get(id) || null
  const email = String(a.email).trim()
  const build = (href: string) => reminderEmailHTML({ kind, a, seat, options, closes: ctx.closes, canSwitch: ctx.canSwitch, header, href, where, line: MUMBAI_WORDS.line,
    subject: b.seat_id ? String(b.subject || '') : '', intro: b.seat_id ? String(b.intro || '') : '', buttonText: b.seat_id ? String(b.button || '') : '' })

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
    // The Saturday reminder keeps its own mark too, so the clock sends it once.
    if (b.audit_action) { try { await hooks.audit(c, String(b.audit_action), 'attendee', id, { kind, to: email, workshop_id: seat ? seat.id : null }) } catch { /* never fails a send */ } }
  }
  return c.json({ success: true, to: email, kind, subject: mail.subject })
}

// ---------- passes without a workshop: the invitation and who tried ----------

const GROUPS: Record<string, { label: string; passes: string[] }> = {
  free: { label: 'Free Visitor Pass', passes: ['Visitor Pass'] },
  paid: { label: 'Expo, Delegate and Academic Passes', passes: ['Expo Pass', 'Delegate Pass', 'Academic Pass'] },
}
const TOP_TITLE = /\b(founder|co-?founder|ceo|cto|cio|cfo|coo|cmo|ciso|cdo|cxo|chief|director|head|vp|vice president|president|partner|owner|managing|md)\b/i
const MID_TITLE = /\b(manager|lead|principal|architect|consultant|gm|general manager)\b/i

// Everyone in a group not yet sent the invitation, likeliest buyers first: anyone in
// the app in the last 14 days, then senior titles, then anyone who ever signed in,
// then the newest registrations. A bulk run sends in this order.
export function inviteOrder(rows: any[], nowMs = Date.now()): any[] {
  const recent = (t: any) => { const ms = Date.parse(String(t || '').replace(' ', 'T') + 'Z'); return Number.isFinite(ms) && nowMs - ms < 14 * 86400000 }
  const rank = (r: any) => TOP_TITLE.test(String(r.job_title || '')) ? 2 : MID_TITLE.test(String(r.job_title || '')) ? 1 : 0
  return rows.slice().sort((a, b) =>
    (Number(recent(b.last_login_at)) - Number(recent(a.last_login_at))) || (rank(b) - rank(a)) ||
    (Number(!!b.last_login_at) - Number(!!a.last_login_at)) || (Number(b.id) - Number(a.id)))
}

async function inviteAudience(c: any, group: string): Promise<any[]> {
  const g = GROUPS[group]
  if (!g) return []
  const rows = await all(c, `SELECT a.id, a.name, a.email, a.job_title, a.last_login_at FROM attendees a
    WHERE a.badge_type IN (${g.passes.map(() => '?').join(', ')}) AND ${INVITE_WHERE}
      AND NOT EXISTS (SELECT 1 FROM admin_audit x WHERE x.entity = 'attendee' AND x.entity_id = CAST(a.id AS TEXT) AND x.action = ?)`,
    ...g.passes, INVITE_ACTION)
  return inviteOrder(rows.filter((r: any) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(r.email || '').trim())))
}

async function inviteMail(c: any, a: any, href: string) {
  const ctx = await context(c)
  const options = ctx.workshops.filter(w => w.open && w.left > 0)
  if (!options.length) return null
  const header = hooks.emailHeader ? hooks.emailHeader('Hands-on workshops', MUMBAI_WORDS.line) : ''
  return reminderEmailHTML({ kind: 'invite', a, seat: null, options, closes: ctx.closes, canSwitch: ctx.canSwitch, header, href, where: await whereFn(c), line: MUMBAI_WORDS.line })
}

// The panel: how many each group would reach now, the bulk runs so far, how many
// tried to book.
wr.get('/api/admin/workshop-invites', async (c) => {
  const groups: Record<string, any> = {}
  for (const k of Object.keys(GROUPS)) groups[k] = { label: GROUPS[k].label, count: (await inviteAudience(c, k)).length }
  let campaigns: any[] = []
  try { campaigns = await all(c, "SELECT id, title, audience, status, total, sent, failed, created_at FROM campaigns WHERE kind = 'workshop_invite' ORDER BY id DESC LIMIT 10") } catch { /* no campaigns table */ }
  let tried = 0
  try { tried = Number((await one(c, 'SELECT COUNT(DISTINCT entity_id) AS n FROM admin_audit WHERE action = ? AND entity = ?', TRY_ACTION, 'attendee'))?.n || 0) } catch { /* none */ }
  const ctx = await context(c)
  return c.json({ groups, campaigns, tried, open_workshops: ctx.workshops.filter(w => w.open && w.left > 0).length })
})

// The ids a bulk run is started with (POST /api/admin/campaigns keeps their order).
wr.get('/api/admin/workshop-invites/audience', async (c) => {
  const group = String(c.req.query('group') || '')
  if (!GROUPS[group]) return c.json({ error: 'Choose free or paid.' }, 400)
  const rows = await inviteAudience(c, group)
  return c.json({ group, label: GROUPS[group].label, ids: rows.map((r: any) => Number(r.id)) })
})

// The invitation as the first person of a group would get it. Mints and sends nothing.
wr.post('/api/admin/workshop-invites/preview', async (c) => {
  const b = await c.req.json().catch(() => ({})) as any
  const rows = GROUPS[String(b.group)] ? await inviteAudience(c, String(b.group)) : []
  const a = rows[0] || { name: 'Sample Person', email: 'sample@example.com' }
  const mail = await inviteMail(c, a, '#preview')
  if (!mail) return c.json({ error: 'Every workshop is full or closed, so there is nothing to invite people to.' }, 409)
  return c.json({ to: a.email, name: a.name, subject: mail.subject, html: mail.html, count: rows.length })
})

// One person's invitation, for the bulk run (campaignSendOne, kind 'workshop_invite').
// Paced like every campaign; "skipped" when it no longer applies to them.
wr.post('/api/admin/attendees/:id/send-workshop-invite', async (c) => {
  const id = Number(c.req.param('id'))
  const a = await one(c, `SELECT a.id, a.event_id, a.name, a.email, a.badge_type FROM attendees a
    WHERE a.id = ? AND a.badge_type IN (${INVITE_PASSES.map(() => '?').join(', ')}) AND ${INVITE_WHERE}`, id, ...INVITE_PASSES)
  if (!a) return c.json({ skipped: true, reason: 'Their pass has a workshop now, or they unsubscribed, or it is not paid.' })
  const email = String(a.email || '').trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return c.json({ skipped: true, reason: 'No usable email address.' })
  const before = await one(c, "SELECT 1 AS y FROM admin_audit WHERE entity = 'attendee' AND entity_id = ? AND action = ?", String(id), INVITE_ACTION)
  if (before) return c.json({ skipped: true, reason: 'Sent the workshop invitation already.' })
  const ctx = await context(c)
  if (!ctx.workshops.some(w => w.open && w.left > 0)) return c.json({ paused: true, reason: 'Every workshop is full or closed.' }, 409)
  if (hooks.pace) { const wait = await hooks.pace(c); if (wait) return c.json(wait.body, wait.status as any) }
  if (!hooks.sendEmail) return c.json({ error: 'Email is not set up on this server.' }, 503)
  let href = ''
  if (hooks.signInLink) { try { href = await hooks.signInLink(c, Number(a.event_id) || 1, email.toLowerCase()) } catch { href = '' } }
  const mail = await inviteMail(c, a, href || SITE + '/app?action=workshop')
  if (!mail) return c.json({ paused: true, reason: 'Every workshop is full or closed.' }, 409)
  const sent = await hooks.sendEmail(c, email, mail.subject, mail.html)
  if (!sent.ok) return c.json({ error: sent.error || 'The email did not go.' }, 502)
  if (hooks.audit) { try { await hooks.audit(c, INVITE_ACTION, 'attendee', id, { kind: 'invite', to: email }) } catch { /* never fails a send */ } }
  return c.json({ success: true, to: email })
})

// "Book this seat" pressed on a pass without a workshop (POST /api/workshops/choose).
// One row per person and workshop in any ten minutes. Never throws.
export async function noteWorkshopTry(c: any, me: any, workshopId: number): Promise<void> {
  try {
    const w = await one(c, 'SELECT id, title FROM workshops WHERE id = ? AND event_id = 1', Number(workshopId))
    if (!w || !me || !me.id) return
    await c.env.DB.prepare(
      `INSERT INTO admin_audit (actor, actor_kind, action, entity, entity_id, detail)
       SELECT ?1, 'attendee', ?2, 'attendee', ?3, ?4
        WHERE NOT EXISTS (SELECT 1 FROM admin_audit WHERE action = ?2 AND entity = 'attendee' AND entity_id = ?3
                            AND json_extract(detail, '$.workshop_id') = ?5 AND created_at > datetime('now', '-10 minutes'))`
    ).bind('attendee ' + me.id, TRY_ACTION, String(me.id), JSON.stringify({ workshop_id: Number(w.id), title: String(w.title || ''), pass: String(me.badge_type || '') }), Number(w.id)).run()
  } catch { /* the sheet still opens */ }
}

// Everyone who pressed "Book this seat" without a workshop in their pass, latest
// first, with what they hold now: for the sales calls.
wr.get('/api/admin/workshop-tries', async (c) => {
  let rows: any[] = []
  try { rows = await all(c, "SELECT entity_id, detail, created_at FROM admin_audit WHERE action = ? AND entity = 'attendee' ORDER BY id", TRY_ACTION) } catch { /* none */ }
  const by = new Map<number, { n: number; first: string; last: string; workshops: string[] }>()
  for (const r of rows) {
    let d: any = {}
    try { d = JSON.parse(r.detail || '{}') } catch { /* not JSON */ }
    const id = Number(r.entity_id)
    const x = by.get(id) || { n: 0, first: r.created_at, last: r.created_at, workshops: [] as string[] }
    x.n++; x.last = r.created_at
    if (d.title && !x.workshops.includes(d.title)) x.workshops.push(String(d.title))
    by.set(id, x)
  }
  const ids = [...by.keys()]
  const people = new Map<number, any>(), seats = new Set<number>()
  for (let i = 0; i < ids.length; i += 80) {
    const part = ids.slice(i, i + 80), marks = part.map(() => '?').join(', ')
    for (const p of await all(c, `SELECT id, name, email, mobile, company, job_title, city, badge_type, payment_status FROM attendees WHERE id IN (${marks})`, ...part)) people.set(Number(p.id), p)
    for (const s of await all(c, `SELECT attendee_id FROM workshop_seats WHERE event_id = 1 AND attendee_id IN (${marks})`, ...part)) seats.add(Number(s.attendee_id))
  }
  const tiers = hooks.tiers ? hooks.tiers() : ['Premium Delegate Pass', 'VIP Pass', 'Student Pass']
  const list = ids.map(id => {
    const p = people.get(id) || {}, x = by.get(id)!
    const pay = String(p.payment_status || '').trim().toLowerCase()
    // A Delegate Pass bonus holder did not buy one: given it (BONUS_IDS), not a sales call.
    const given = isWorkshopBonus({ id, badge_type: p.badge_type }) && !['pending', 'refunded'].includes(pay)
    const now = seats.has(id) ? 'Has a seat'
      : given ? 'Workshop added to their pass'
      : tiers.includes(String(p.badge_type || '')) ? (pay === 'pending' ? 'Started paying' : 'Bought a workshop pass')
      : 'Not bought yet'
    return { id, name: p.name || '', email: p.email || '', mobile: p.mobile || '', company: p.company || '', job_title: p.job_title || '', city: p.city || '',
      badge_type: p.badge_type || '', tries: x.n, first: x.first, last: x.last, workshops: x.workshops, now, given }
  }).sort((a, b) => (a.last < b.last ? 1 : -1))
  return c.json({ people: list, counts: { tried: list.length, bought: list.filter(p => !p.given && p.now !== 'Not bought yet' && p.now !== 'Started paying').length } })
})

export default wr
