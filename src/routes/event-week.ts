import { Hono } from 'hono'

// ==================== THE EVENT-WEEK EMAIL (16 Nov 2026) ====================
//
// The organiser, four days out: "send emails to delegates, exhibitors to update their
// profile and download pass and share on LinkedIn social pass, download app, book
// meeting with interesting parties". One email per person, "Get ready for 20 and 21
// Nov": a checklist with what they have done ticked, each step a button that signs
// them into the app at that step. The body follows the pass the person holds:
//   - exhibitor (Exhibitor, Exhibition Speaker): their booth and company first, the
//     team's passes on the exhibitor dashboard, Booth Leads in the app;
//   - paid (every settled paid tier and every given pass: Speaker, VIP Guest, Media...);
//   - expo (Expo Pass: the floor and the networking app, no sessions);
//   - free (Free Visitor Pass): the same steps; booking is not theirs, accepting is;
//   - waitlisted (on the free-pass waiting list: no pass): get a pass before you come;
//   - unpaid (a paid tier never paid for): finish paying.
// It is a campaign of kind 'event_week' on the bulk pump (BULK EMAIL CAMPAIGNS in
// index.tsx), one of four audiences: 'passes' (exhibitor + paid + expo), 'exhibitors',
// 'free' (free + waitlisted + unpaid), 'all'. Nobody is written to twice: anyone on an
// event_week run is left out of the next. It is not paced by the shared send gap (the
// networking run took days at one a minute): the tab sends as fast as the server
// answers and the minute clock moves it ten at a time, 9am-9pm IST.
// Opens and clicks are admin_audit rows eventweek.open / eventweek.click (mailMark, tag
// ew= on every button), counted from app_settings 'eventweek_marks_from'.
// Every /api/admin/* route here is behind the admin middleware in index.tsx.

type Kind = 'exhibitor' | 'paid' | 'expo' | 'free' | 'waitlisted' | 'unpaid'
export const KINDS: Kind[] = ['exhibitor', 'paid', 'expo', 'unpaid', 'free', 'waitlisted']
export const AUDIENCES: Record<string, { title: string; kinds: Kind[] }> = {
  passes: { title: 'Get ready for 20 and 21 Nov: paid passes and exhibitors', kinds: ['exhibitor', 'paid', 'expo'] },
  exhibitors: { title: 'Get ready for 20 and 21 Nov: exhibitors', kinds: ['exhibitor'] },
  free: { title: 'Get ready for 20 and 21 Nov: Free Visitor Pass', kinds: ['free', 'waitlisted', 'unpaid'] },
  all: { title: 'Get ready for 20 and 21 Nov: everyone', kinds: KINDS },
}
export const KIND_WORD: Record<Kind, string> = {
  exhibitor: 'Exhibitors', paid: 'Paid and given passes', expo: 'Expo Pass', free: 'Free Visitor Pass', waitlisted: 'Waiting list (no pass)', unpaid: 'Chose a paid pass, not paid',
}
export const CAMPAIGN_KIND = 'event_week'
export const MARKS_FROM_KEY = 'eventweek_marks_from'
const TEAM_PASSES = ['Exhibitor', 'Exhibition Speaker']
const TEAM_ONLY = ['Organiser', 'Support Staff']
const EVENT_DAY1_IST = Date.UTC(2026, 10, 20) // 20 Nov 2026, as a UTC midnight stamp of the IST date
const IST_MS = 330 * 60000

type Hooks = {
  sendEmail?: (c: any, to: string, subject: string, html: string) => Promise<{ ok: boolean; error?: string }>
  emailHeader?: (title: string, subtitle: string) => string
  appUrl?: (c: any) => Promise<string>
  // A sign-in token for one email ('' when sign-in links are off); index.tsx mints it.
  signIn?: (c: any, eventId: number, email: string) => Promise<string>
  markSig?: (c: any, kind: string, id: any) => Promise<string>
  mark?: (c: any, action: string, id: any, sig: any) => Promise<void>
  // Lazy: the 1x1 gif is a const declared further down index.tsx.
  pixel?: () => Uint8Array
  // The two clauses every attendee email obeys (campus-panel only, unsubscribed) and
  // the stand-in addresses of guests registered with a mobile number only.
  clauses?: (c: any) => Promise<{ mc: string; sc: string; noEmail: string }>
  profileGaps?: (a: any) => string[]
  notifyKind?: (a: any) => 'free' | 'unpaid' | 'paid'
  waitlisted?: (a: any) => boolean
  pushPassFor?: (a: any) => string
  rsPrice?: (pass: string) => string
  passKey?: (pass: string) => string
  window?: () => { open: boolean; window: string; ist_time: string }
  // For the preview: the block and footer every sent email gets from sendAdminEmail.
  decorate?: (c: any, html: string, to: string) => Promise<string>
  setting?: (c: any, key: string) => Promise<string>
  settingWrite?: (c: any, key: string, value: string) => Promise<void>
}
let hooks: Hooks = {}
export function configureEventWeek(h: Hooks) { hooks = { ...hooks, ...h } }

const ew = new Hono<{ Bindings: any }>()
const SITE = 'https://bharataiinnovation.com'
const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const all = async (c: any, sql: string, ...args: any[]) => (((await c.env.DB.prepare(sql).bind(...args).all()) as any).results || []) as any[]
const validEmail = (e: any) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim())

// ---------- pure helpers (scripts/verify/smoke-event-week.mjs checks them) ----------

// "riddhi" and "DR. RAJESH KUMAR" both arrive from imports; the greeting wants "Riddhi".
export function firstName(name: any): string {
  const words = String(name || '').trim().split(/\s+/).filter(w => !/^(dr|prof|mr|mrs|ms|miss|shri|smt|er|ca|adv|hon[’']?ble)\.?$/i.test(w))
  const w = words[0] || ''
  if (!/[a-z]/i.test(w)) return ''
  return w === w.toUpperCase() || w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w
}

// Which email a person gets, from their row.
export function kindOf(a: any): Kind {
  const badge = String(a?.badge_type || '').trim()
  if (TEAM_PASSES.includes(badge)) return 'exhibitor'
  const nk = hooks.notifyKind ? hooks.notifyKind(a) : 'paid'
  if (nk === 'unpaid') return 'unpaid'
  if (nk === 'free') return hooks.waitlisted && hooks.waitlisted(a) ? 'waitlisted' : 'free'
  return badge === 'Expo Pass' ? 'expo' : 'paid'
}

// "4 days to go" on 16 Nov; "Tomorrow" on the 19th; "Today" on the 20th and 21st.
export function daysLine(nowMs = Date.now()): string {
  const istDay = Math.floor((nowMs + IST_MS) / 86400000) * 86400000
  const n = Math.round((EVENT_DAY1_IST - istDay) / 86400000)
  if (n > 1) return `${n} days to go`
  if (n === 1) return 'Tomorrow'
  if (n === 0 || n === -1) return 'Today'
  return ''
}

export function subjectFor(kind: Kind, a: any): string {
  const first = firstName(a?.name)
  const lead = first ? first + ', ' : ''
  const cap = (s: string) => first ? s : s.charAt(0).toUpperCase() + s.slice(1)
  switch (kind) {
    case 'exhibitor': return lead + cap('your booth, your team and your meetings at Bharat AI Innovation, 20 and 21 Nov')
    case 'waitlisted': return lead + cap('20 and 21 Nov is this week: get your pass before you come')
    case 'unpaid': return lead + cap(`20 and 21 Nov is this week: finish paying for your ${String(a?.badge_type || 'pass').trim()}`)
    case 'free': return lead + cap('get ready for 20 and 21 Nov: your pass, your badge and the app')
    default: return lead + cap('get ready for 20 and 21 Nov: your pass, your badge and your meetings')
  }
}

// The exhibitor's company and booth, from the team list (0050) or the booth contact.
async function boothOf(c: any, a: any): Promise<{ company: string; booths: string[] } | null> {
  const email = String(a?.email || '').trim().toLowerCase()
  let ex: any = null
  try {
    ex = (await all(c, `SELECT e.id, e.company_name, e.booth_number FROM exhibitor_team t JOIN exhibitors e ON e.id = t.exhibitor_id
      WHERE t.event_id = ? AND (t.attendee_id = ? OR lower(trim(t.email)) = ?) ORDER BY t.id LIMIT 1`, Number(a.event_id) || 1, Number(a.id), email))[0] || null
  } catch { /* before 0050: no team list */ }
  if (!ex) {
    try { ex = (await all(c, 'SELECT id, company_name, booth_number FROM exhibitors WHERE event_id = ? AND lower(trim(contact_email)) = ? ORDER BY id LIMIT 1', Number(a.event_id) || 1, email))[0] || null } catch { /* no exhibitors table */ }
  }
  if (!ex) return String(a?.company || '').trim() ? { company: String(a.company).trim(), booths: [] } : null
  let booths: string[] = []
  try {
    booths = (await all(c, `SELECT b.code FROM booth_allocations ba JOIN booths b ON b.id = ba.booth_id
      WHERE ba.exhibitor_id = ? AND ba.status = 'confirmed' AND ba.released_at IS NULL ORDER BY CAST(b.code AS INTEGER), b.code`, Number(ex.id))).map((r: any) => String(r.code))
  } catch { /* an older booths table */ }
  if (!booths.length && String(ex.booth_number || '').trim()) booths = [String(ex.booth_number).trim()]
  return { company: String(ex.company_name || a.company || '').trim(), booths }
}

// ---------- the email ----------

export async function eventWeekEmail(c: any, a: any, opts: { preview?: boolean; now?: number } = {}): Promise<{ subject: string; html: string; kind: Kind }> {
  const appUrl = hooks.appUrl ? await hooks.appUrl(c) : SITE + '/app'
  const origin = appUrl.replace(/\/app\/?$/, '')
  const email = String(a.email || '').trim()
  const first = firstName(a.name)
  const kind = kindOf(a)
  const badge = String(a.badge_type || '').trim()
  const passName = kind === 'free' || kind === 'waitlisted' || kind === 'unpaid' ? 'Free Visitor Pass' : (/pass$/i.test(badge) ? badge : badge + ' Pass')
  const booth = kind === 'exhibitor' ? await boothOf(c, a) : null

  // One sign-in token for every button, the open picture and the click tag. None in a
  // preview: a token minted there would cancel the link the person already holds.
  let token = '', tag = '', pixel = ''
  if (!opts.preview) {
    if (hooks.markSig) {
      const sig = await hooks.markSig(c, 'eventweek', a.id)
      tag = `&ew=${Number(a.id)}.${sig}`
      pixel = `<img src="${origin}/api/eventweek-open?a=${Number(a.id)}&amp;s=${sig}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px;">`
    }
    if (hooks.signIn) { try { token = await hooks.signIn(c, Number(a.event_id) || 1, email.toLowerCase()) } catch { token = '' } }
  }
  const base = `${appUrl}?email=${encodeURIComponent(email)}`
  const go = (action: string, extra = '') => `${base}&action=${action}${extra}${token ? '&token=' + token : ''}${tag}`

  const gaps = hooks.profileGaps ? hooks.profileGaps(a) : []
  const needsPhoto = gaps.includes('photo')
  const details = gaps.filter(g => g !== 'photo')
  const list = (x: string[]) => x.length < 2 ? (x[0] || '') : x.slice(0, -1).join(', ') + ' and ' + x[x.length - 1]
  const canBook = kind === 'exhibitor' || kind === 'paid' || kind === 'expo'

  const btn = (href: string, label: string, bg = '#C84F00') =>
    `<a href="${href}" style="display:inline-block;margin:8px 0 0;padding:11px 20px;background:${bg};color:#fff;text-decoration:none;border-radius:10px;font-weight:bold;font-size:13.5px;">${label}</a>`
  const link = (href: string, label: string) => `<a href="${href}" style="color:#C84F00;font-weight:bold;">${label}</a>`
  // A step: ticked green when done, numbered orange when not.
  let n = 0
  const step = (done: boolean, title: string, body: string, extra = '') => {
    n++
    return `<tr><td width="40" valign="top" style="padding:0 0 18px;"><div style="width:28px;height:28px;border-radius:50%;background:${done ? '#0f7b47' : '#FF6B00'};color:#fff;font-weight:bold;font-size:13px;line-height:28px;text-align:center;">${done ? '&#10003;' : n}</div></td>` +
      `<td valign="top" style="padding:2px 0 18px;"><p style="margin:0 0 3px;font-size:15px;font-weight:bold;color:#1E2140;">${title}</p><p style="margin:0;font-size:13.5px;line-height:1.6;color:#555;">${body}</p>${extra}</td></tr>`
  }

  const days = daysLine(opts.now)
  const steps: string[] = []
  // 1. Photo and details: on the badge, the pass and the card people read before they ask to meet.
  steps.push(step(!gaps.length,
    !gaps.length ? 'Your photo and details are in' : needsPhoto ? 'Add your photo' + (details.length ? ' and your ' + esc(list(details)) : '') : 'Add your ' + esc(list(details)),
    !gaps.length ? 'They are on your pass and your badge. Change them in the app at any time.'
      : 'They go on your pass, your badge and the card people read before they ask to meet you. Take the photo with your phone in the app; it takes a minute.',
    gaps.length ? btn(go('complete-profile'), needsPhoto ? 'Add my photo' : 'Add my details') : ''))
  // 2. The pass: on the phone, or still to get.
  if (kind === 'waitlisted') {
    const push = hooks.pushPassFor ? hooks.pushPassFor(a) : 'Delegate Pass'
    steps.push(step(false, 'Get your pass before you come',
      'Free registration is closed, and there is no on-spot registration at the venue. You are on the waiting list, which is not a pass. ' +
      `To be sure of your entry on both days, get a <strong>${esc(push)}</strong>${hooks.rsPrice ? ` (${hooks.rsPrice(push)} + GST)` : ''}.`,
      btn(go('pay', '&pass=' + (hooks.passKey ? hooks.passKey(push) : 'delegate')), 'Get my ' + esc(push), '#0f7b47')))
  } else if (kind === 'unpaid') {
    steps.push(step(false, `Finish paying for your ${esc(badge)}`,
      `Its payment is not complete, so for now your account holds a Free Visitor Pass, and entry on a free pass is not guaranteed. Pay${hooks.rsPrice ? ' ' + hooks.rsPrice(badge) + ' + GST' : ''} and your ${esc(badge)} is yours, with guaranteed entry on both days.`,
      btn(go('pay', '&pass=' + (hooks.passKey ? hooks.passKey(badge) : 'delegate')), 'Finish paying', '#0f7b47')))
  } else {
    steps.push(step(!!a.pass_downloaded_at, a.pass_downloaded_at ? 'Your pass is on your phone' : 'Put your pass on your phone',
      `Your <strong>${esc(passName)}</strong> has a QR code. The badge desk scans it and hands you your printed badge; nothing to print at home.` +
      (a.pass_downloaded_at ? ' Open the app on the day and it is there.' : ''),
      a.pass_downloaded_at ? '' : btn(go('download-pass'), 'Download my pass', '#1E2140')))
  }
  // 3. The card for LinkedIn: the cheapest reach the event has, and how people get asked to meet.
  steps.push(step(!!a.social_card_downloaded_at, a.social_card_downloaded_at ? 'Your badge is out there' : 'Post your &ldquo;I&rsquo;m attending&rdquo; badge on LinkedIn',
    'A picture with your photo, name and organisation, sized for LinkedIn, WhatsApp and Stories, with a caption to copy. Tag Bharat AI Innovation and add #BharatAI2026. ' +
    (a.social_card_downloaded_at ? 'Post it again this week: the people coming are deciding now who to meet.' : 'The people coming see it and ask to meet you before you arrive.'),
    btn(go('social-card'), a.social_card_downloaded_at ? 'Get my badge again' : 'Make my badge')))
  // 4. The app on the phone. Marked data-app-on-phone, so the foot of the email does not
  // say it a second time (withAppOnPhone leaves a marked email alone).
  steps.push(step(false, 'Save the app on your phone',
    'Your pass, the schedule, your messages and your meetings open with one tap at the gate. No searching through emails. ' +
    '<strong>Android:</strong> open bharataiinnovation.com/app in Chrome, tap &#8942;, then Add to Home screen. <strong>iPhone:</strong> open it in Safari, tap Share, then Add to Home Screen.',
    btn(go('save-app'), 'Show me how', '#1E2140')))
  // 5. Meetings: booking for a pass that may start them, saying yes for a free pass.
  if (canBook) {
    steps.push(step(false, 'Book meetings with the people you want to meet',
      'See who is coming, message them and book a 15-minute slot on 20 or 21 Nov; the app shows when you are both free. Walk in with your meetings fixed, not hoping to bump into people. ' +
      `Say why you are coming (buying, selling, partners, hiring) and the right people find you: ${link(go('goals'), 'add it to my profile')}.`,
      btn(go('network'), 'Find people to meet')))
  } else {
    steps.push(step(false, 'Say yes when someone asks to meet you',
      'Delegates and exhibitors are booking their meetings now. If one asks to connect or to meet you, you get it in the app and by email; accepting and replying are free on your pass. ' +
      (kind === 'free' && hooks.rsPrice
        ? `Want to book meetings yourself, and guaranteed entry on both days? The Expo Pass is ${hooks.rsPrice('Expo Pass')} + GST: ${link(go('pay', '&pass=expo'), 'get the Expo Pass')}. The Delegate Pass adds the conference itself.`
        : ''),
      btn(go('network'), 'Open the app')))
  }
  // 6. The programme, for a pass that includes it.
  if (kind === 'paid') {
    steps.push(step(false, 'Star the sessions you want',
      `Two days, four halls. Star your sessions in the app&rsquo;s Conference Schedule and it builds your two days${/premium|vip|student/i.test(badge) ? ', with your workshop seat' : ''}. The full programme is on ${link(SITE + '/conference', 'bharataiinnovation.com/conference')}.`))
  }

  // Exhibitors first see their own things: the booth, the team's passes, the leads.
  const exhibitorBlock = kind === 'exhibitor' ? `
      <div style="margin:22px 0 0;padding:18px 20px;background:#1E2140;border-radius:14px;color:#fff;">
        <p style="margin:0 0 4px;font-size:11px;letter-spacing:1.6px;font-weight:bold;color:#FF9E4D;">YOUR BOOTH</p>
        <p style="margin:0 0 6px;font-size:19px;font-weight:bold;line-height:1.3;">${booth && booth.booths.length ? `Booth ${esc(booth.booths.join(', '))}` : 'Your booth on the exhibition floor'}${booth && booth.company ? ` &middot; ${esc(booth.company)}` : ''}</p>
        <p style="margin:0 0 12px;font-size:13px;line-height:1.65;color:#C9CDE6;">Everyone at the booth needs their own pass and their own app account. Add your team under <strong style="color:#fff;">Teams &amp; Passes</strong> on the exhibitor dashboard; each person gets their pass by email. Branding sizes and your payment are there too.</p>
        <a href="${SITE}/marketplace/dashboard" style="display:inline-block;padding:10px 18px;background:#fff;color:#1E2140;text-decoration:none;border-radius:10px;font-weight:bold;font-size:13px;">Open the exhibitor dashboard</a>
        <p style="margin:14px 0 0;font-size:13px;line-height:1.65;color:#C9CDE6;"><strong style="color:#fff;">Keep every lead.</strong> Scan a visitor&rsquo;s badge with the app and their name, company and interests are saved to your booth, even with no signal. ${link(go('leads'), 'Open Booth Leads')}</p>
      </div>` : ''

  const onTheDay = `
      <div style="margin:22px 0 0;padding:18px 20px;background:#FFF8EC;border:1px solid #F3DDB0;border-radius:12px;">
        <p style="margin:0 0 6px;font-size:15px;font-weight:bold;color:#1E2140;">On the day</p>
        <p style="margin:0;font-size:13.5px;line-height:1.65;color:#555;">The badge desk opens at <strong>8:30 am on Thursday 20 Nov</strong> at the World Trade Center, Cuffe Parade, Mumbai 400005. Show the QR code of your pass on your phone and a government photo ID with the same name. There is no on-spot registration. ${kind === 'exhibitor' ? 'Your booth is set up and waiting for you.' : ''}</p>
      </div>`

  const intro = kind === 'exhibitor'
    ? `Bharat AI Innovation 2026 is this Thursday and Friday${days ? ` (<strong>${days.toLowerCase()}</strong>)` : ''} at the World Trade Center, Mumbai. Here is your booth, and what to do before the doors open so your team walks in ready and your leads are kept.`
    : `Bharat AI Innovation 2026 is this Thursday and Friday${days ? ` (<strong>${days.toLowerCase()}</strong>)` : ''} at the World Trade Center, Mumbai. Here is what to do before you arrive, in order. Each button signs you in, so it takes a minute on your phone.`
  const preheader = kind === 'exhibitor' ? 'Your booth, your team’s passes, Booth Leads and your meetings. 20 and 21 Nov, WTC Mumbai.'
    : 'Your pass, your badge for LinkedIn, the app and your meetings. 20 and 21 Nov, WTC Mumbai.'
  const header = hooks.emailHeader ? hooks.emailHeader('Get ready for 20 and 21 Nov', (days ? days + ' &bull; ' : '') + 'World Trade Center, Mumbai') : ''

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div>
  <div style="max-width:600px;margin:0 auto;padding:16px;">
    <div style="border-radius:16px;overflow:hidden;">${header}</div>
    <div style="background:white;border-radius:16px;padding:24px 22px;margin-top:16px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
      <p style="margin:0 0 10px;font-size:15px;color:#333;">Hi <strong>${esc(first || 'there')}</strong>,</p>
      <p style="margin:0;font-size:14.5px;line-height:1.7;color:#444;">${intro}</p>
      ${exhibitorBlock}
      <table role="presentation" data-app-on-phone="1" style="width:100%;border-collapse:collapse;margin:24px 0 0;">${steps.join('')}</table>
      ${onTheDay}
      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #eee;">
        <p style="margin:0 0 14px;font-size:12.5px;line-height:1.6;color:#888;">The buttons in this email sign you in as <strong>${esc(email)}</strong>. If one has expired, open the app and sign in with this address: we send you a one-time code, no password needed. <a href="${base}${token ? '&token=' + token : ''}${tag}" style="color:#4f46e5;">Open the app</a></p>
        <p style="margin:0;font-size:14px;line-height:1.6;color:#555;">See you in Mumbai,<br><strong>Team Bharat AI Innovation</strong></p>
      </div>
    </div>
    <p style="text-align:center;color:#999;font-size:12px;margin-top:16px;">Bharat AI Innovation Conference &amp; Exhibition 2026 &bull; World Trade Center, Mumbai &bull; 20-21 Nov 2026</p>
  </div>${pixel}
</body>
</html>`
  return { subject: subjectFor(kind, a), html, kind }
}

// ---------- who gets it ----------

// Everyone not yet on an event_week run, sorted into kinds here (the kind needs the
// whole row: pass, payment, waiting list). clauses: the campus-panel and unsubscribe
// clauses index.tsx already computed for the campaign.
const NOT_YET_SQL = ` AND id NOT IN (SELECT cr.attendee_id FROM campaign_recipients cr JOIN campaigns cp ON cp.id = cr.campaign_id
    WHERE cp.kind = '${CAMPAIGN_KIND}' AND cr.attendee_id IS NOT NULL AND cr.status IN ('pending', 'sending', 'sent'))`
export async function eventWeekAudienceRows(c: any, audience: string, clauses?: { mc: string; sc: string; noEmail?: string }): Promise<any[]> {
  const aud = AUDIENCES[audience] || AUDIENCES.passes
  const cl = clauses || (hooks.clauses ? await hooks.clauses(c) : { mc: '', sc: '', noEmail: '' })
  const noEmail = cl.noEmail ? ` AND ${cl.noEmail}` : ''
  const rows = await all(c, `SELECT * FROM attendees WHERE event_id = 1 AND email IS NOT NULL AND TRIM(email) != ''${noEmail}${cl.mc}${cl.sc}${NOT_YET_SQL} ORDER BY id`)
  const order = new Map(KINDS.map((k, i) => [k, i]))
  return rows
    .filter((a: any) => validEmail(a.email) && !TEAM_ONLY.includes(String(a.badge_type || '').trim()))
    .map((a: any) => ({ ...a, kind: kindOf(a) }))
    .filter((a: any) => aud.kinds.includes(a.kind))
    // Exhibitors and paid passes first: theirs are the meeting requests the rest receive.
    .sort((x: any, y: any) => (order.get(x.kind)! - order.get(y.kind)!) || (Number(x.id) - Number(y.id)))
    .map((a: any) => ({ id: a.id, name: a.name, email: a.email, kind: a.kind }))
}

async function openRun(c: any): Promise<any> {
  return await c.env.DB.prepare(`SELECT * FROM campaigns WHERE kind = '${CAMPAIGN_KIND}' AND status IN ('running', 'paused') ORDER BY id DESC LIMIT 1`).first().catch(() => null)
}

// ---------- routes ----------

// One email to ONE attendee, for the campaign pump: 409 outside the window, skipped
// when it no longer fits the person. No shared send gap (see the top of the file).
ew.post('/api/admin/attendees/:id/send-event-week', async (c) => {
  const a = await c.env.DB.prepare('SELECT * FROM attendees WHERE id = ?').bind(c.req.param('id')).first() as any
  if (!a) return c.json({ error: 'Attendee not found' }, 404)
  if (!a.email || !validEmail(a.email)) return c.json({ skipped: true, reason: 'No usable email address' })
  if (a.unsubscribed_at || String(a.marketing_consent ?? '') === '0') return c.json({ skipped: true, reason: 'Unsubscribed, or said no to email' })
  if (Number(a.main_event ?? 1) === 0) return c.json({ skipped: true, reason: 'Campus panel only: has not said yes to the conference' })
  if (TEAM_ONLY.includes(String(a.badge_type || '').trim())) return c.json({ skipped: true, reason: 'On the organising team' })
  const win = hooks.window ? hooks.window() : { open: true, window: '', ist_time: '' }
  if (!win.open && c.req.query('force') !== '1') {
    return c.json({ paused: true, reason: `Outside the ${win.window} sending window (it is ${win.ist_time}).`, window: win }, 409)
  }
  if (!hooks.sendEmail) return c.json({ error: 'Email is not set up on this server.' }, 503)
  const mail = await eventWeekEmail(c, a)
  const res = await hooks.sendEmail(c, a.email, mail.subject, mail.html)
  if (!res.ok) return c.json({ error: res.error || 'Not sent' }, 502)
  // Opens and clicks count from the first marked send.
  if (hooks.setting && hooks.settingWrite && !(await hooks.setting(c, MARKS_FROM_KEY))) {
    await hooks.settingWrite(c, MARKS_FROM_KEY, new Date().toISOString().slice(0, 19).replace('T', ' ')).catch(() => null)
  }
  return c.json({ success: true, sent_to: a.email, kind: mail.kind })
})

ew.get('/api/eventweek-open', async (c) => {
  if (hooks.mark) await hooks.mark(c, 'eventweek.open', c.req.query('a'), c.req.query('s'))
  return c.body(hooks.pixel ? hooks.pixel() : new Uint8Array(), 200, { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, private' })
})
ew.post('/api/eventweek-click', async (c) => {
  const b = await c.req.json().catch(() => ({})) as any
  if (hooks.mark) await hooks.mark(c, 'eventweek.click', b.a, b.s)
  return c.json({ ok: true })
})

// What came of it: of those sent it since the marks began, how many opened and clicked;
// of everyone sent it, how many then downloaded their pass, made their badge, or asked
// someone to connect or meet.
async function stats(c: any) {
  const from = (hooks.setting ? await hooks.setting(c, MARKS_FROM_KEY) : '') || '9999-12-31 00:00:00'
  const mark = (action: string) => `LEFT JOIN (SELECT entity_id, 1 AS hit FROM admin_audit WHERE entity = 'attendee' AND action = '${action}' GROUP BY entity_id)`
  const r = await c.env.DB.prepare(
    `SELECT COUNT(*) AS sent,
            SUM(s.sent_at >= ?1) AS tracked,
            SUM(s.sent_at >= ?1 AND (op.hit = 1 OR ck.hit = 1)) AS opened,
            SUM(s.sent_at >= ?1 AND ck.hit = 1) AS clicked,
            SUM(a.pass_downloaded_at >= s.sent_at) AS pass_after,
            SUM(a.social_card_downloaded_at >= s.sent_at) AS shared_after,
            SUM(EXISTS (SELECT 1 FROM connections x WHERE x.from_attendee_id = s.attendee_id AND x.created_at >= s.sent_at)
             OR EXISTS (SELECT 1 FROM meetings m WHERE m.requester_id = s.attendee_id AND m.created_at >= s.sent_at)) AS asked
       FROM (SELECT cr.attendee_id, cr.sent_at FROM campaign_recipients cr JOIN campaigns cp ON cp.id = cr.campaign_id
              WHERE cp.kind = '${CAMPAIGN_KIND}' AND cr.status = 'sent' AND cr.attendee_id IS NOT NULL) s
       JOIN attendees a ON a.id = s.attendee_id
       ${mark('eventweek.open')} op ON op.entity_id = CAST(s.attendee_id AS TEXT)
       ${mark('eventweek.click')} ck ON ck.entity_id = CAST(s.attendee_id AS TEXT)`
  ).bind(from).first().catch(() => null) as any
  const out: Record<string, number> = {}
  for (const k of ['sent', 'tracked', 'opened', 'clicked', 'pass_after', 'shared_after', 'asked']) out[k] = Number(r?.[k] || 0)
  return out
}

// For the Overview card: the open run, who has not had it yet (by audience and kind),
// and what came of it.
ew.get('/api/admin/event-week/status', async (c) => {
  try {
    const open = await openRun(c)
    const rows = await eventWeekAudienceRows(c, 'all')
    const kinds: Record<string, number> = {}
    for (const k of KINDS) kinds[k] = 0
    for (const r of rows) kinds[r.kind]++
    const left: Record<string, number> = {}
    for (const [k, v] of Object.entries(AUDIENCES)) left[k] = rows.filter(r => v.kinds.includes(r.kind)).length
    return c.json({ open_run: open ? { id: open.id, kind: open.kind, title: open.title, audience: open.audience, status: open.status, total: open.total, sent: open.sent, failed: open.failed } : null,
      left, kinds, kind_words: KIND_WORD, audiences: Object.fromEntries(Object.entries(AUDIENCES).map(([k, v]) => [k, v.title])),
      stats: await stats(c), window: hooks.window ? hooks.window().window : '', days: daysLine() })
  } catch (e: any) {
    if (/no such table/i.test(String(e?.message || ''))) return c.json({ unavailable: true })
    throw e
  }
})

// The email before it goes: how many of each kind the run reaches and one real
// recipient's email of the kind asked for. ?campaign= shows a run already made. Sends
// nothing, mints no token, writes no mark.
ew.get('/api/admin/event-week/preview', async (c) => {
  const want = String(c.req.query('kind') || '')
  const audience = AUDIENCES[String(c.req.query('audience') || '')] ? String(c.req.query('audience')) : 'passes'
  const campId = parseInt(String(c.req.query('campaign') || ''), 10)
  let rows: any[]
  if (Number.isFinite(campId)) {
    const listed = async (more: string) => await all(c, `SELECT attendee_id AS id, email FROM campaign_recipients WHERE campaign_id = ?${more} ORDER BY id`, campId)
    rows = await listed(" AND status IN ('pending', 'sending')")
    if (!rows.length) rows = await listed('')
    const full = new Map((await all(c, 'SELECT * FROM attendees WHERE event_id = 1')).map((a: any) => [Number(a.id), a]))
    rows = rows.map((r: any) => ({ ...r, kind: kindOf(full.get(Number(r.id)) || {}) }))
  } else {
    rows = await eventWeekAudienceRows(c, audience)
  }
  const counts: Record<string, number> = { total: rows.length }
  const first: Record<string, any> = {}
  for (const k of KINDS) counts[k] = 0
  for (const r of rows) { counts[r.kind] = (counts[r.kind] || 0) + 1; if (!first[r.kind]) first[r.kind] = r }
  const pick = want ? first[want] : KINDS.map(k => first[k]).find(Boolean)
  const sample = pick ? await c.env.DB.prepare('SELECT * FROM attendees WHERE id = ?').bind(pick.id).first() as any : null
  const open = Number.isFinite(campId) ? null : await openRun(c)
  const out = { counts, audience, title: AUDIENCES[audience].title, kind_words: KIND_WORD, window: hooks.window ? hooks.window().window : '',
    open_run: open ? { id: open.id, status: open.status, title: open.title } : null }
  if (!sample) return c.json({ ...out, kind: want, sample: null })
  const mail = await eventWeekEmail(c, sample, { preview: true })
  return c.json({ ...out, kind: mail.kind, subject: mail.subject,
    sample: { id: sample.id, name: sample.name, email: sample.email, badge_type: sample.badge_type || 'Visitor Pass' },
    html: hooks.decorate ? await hooks.decorate(c, mail.html, sample.email) : mail.html })
})

export default ew
