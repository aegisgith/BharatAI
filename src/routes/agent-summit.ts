import { Hono } from 'hono'

// ==================== AI AGENT SUMMIT 2027 (event 3), 15 Nov 2026 ====================
//
// The organiser: "use the same backend app for delegate registration, participants,
// booths; we have really everything built". The summit is event 3 the way Delhi 2027 is
// event 2: its people are rows in `attendees` with event_id = 3, its paid passes go through
// the same payment_orders, CCAvenue checkout, receipt and GST invoice, and its showcase
// applications and sponsor enquiries are rows on the Inquiries desk.
//
// Saturday 17 April 2027, World Trade Center Mumbai. One day. Companies that have built AI
// agents apply for a 10-minute slot (7 minutes live demo, 3 minutes buyer panel) and a
// showcase spot on the floor.
//
// Pages: public/ai-agent-summit/ (its own design: dark "agent console"). They post here:
//   POST /api/agent-summit/pass         a pass: free ones are confirmed (Buyer/Investor wait
//                                        for the team), paid ones return a checkout link
//   POST /api/agent-summit/pass-again   Try again from the result page (signed link)
//   POST /api/agent-summit/apply        showcase application -> inquiry 'agent_showcase'
//   POST /api/agent-summit/enquire      sponsor enquiry -> inquiry 'sponsorship'
//   GET  /api/admin/agent-summit/passes Admin -> Overview card "AI Agent Summit passes"
//
// Rules this keeps (handbook §2, §14 6 Nov): every query on attendees / payment_orders
// names event 3; /api/events/3/* is refused in index.tsx next to Delhi's line; checkout
// always runs on bharataiinnovation.com, the address CCAvenue knows, even when the form
// was on the summit's own domain; emails carry no "Bharat AI app" block (noAppOnPhone).
//
// Inquiries keep event_id = 1 (the desk reads event 1 only, and Delhi's rows do the same);
// a summit row is told apart by metadata.edition = 'agent-summit-2027' and its subject.
//
// Module rules (index.tsx 478): this file cannot import from index.tsx. Everything it
// needs comes through configureAgentSummit(), as closures, because the mount runs before
// most of index.tsx's constants are declared.

type Hooks = {
  audit: (c: any, action: string, entity?: string, entityId?: any, detail?: any, actorOverride?: { actor: string; kind: string }) => Promise<void>
  sendEmail: (c: any, to: string, subject: string, html: string, opts?: any) => Promise<any>
  settingValue: (c: any, key: string) => Promise<string>
  onlinePaymentsOn: (c: any) => Promise<any>
  payLinkToken: (c: any, orderId: string) => Promise<string>
  orderFromLinkToken: (c: any, token: string) => Promise<any | null>
  mobileHolder: (c: any, eventId: any, mobile: unknown, exceptId?: any) => Promise<{ id: number; name: string; email: string } | null>
  emailTypo: (email: string) => { fixed?: string; reason: string } | null
  cleanBilling: (raw: any) => any
  saveBilling: (c: any, attendeeId: any, b: any) => Promise<void>
  sanitizeSource: (v: unknown) => string | null
  noAppOnPhone: (html: string) => string
  notifyTeam: (c: any, row: any) => Promise<any>
  settledPaidTier: (a: any) => string
  payPage: (title: string, body: string, edition?: any) => string
  payH1: (t: string) => string
  payP: (t: string) => string
  payButton: (href: string, label: string) => string
  payRows: (rows: [string, string][]) => string
  payEsc: (v: any) => string
  rupees: (paise: number) => string
  istStamp: (v: any) => string
  mobileKey: (v: unknown) => string
  maskEmail: (email: string) => string
  consts: () => { PAID_TIERS: string[]; FREE_BADGE_RE: RegExp; PASS_GST_RATE: number; PAY_ORDERS_PER_HOUR: number }
}
let h: Hooks = {} as Hooks
export function configureAgentSummit(hooks: Partial<Hooks>) { h = { ...h, ...hooks } as Hooks }

export const SUMMIT_EVENT_ID = 3
export const SUMMIT_EVENT_NAME = 'AI Agent Summit 2027'
export const SUMMIT_WHEN = 'Saturday 17 April 2027 &bull; World Trade Center Mumbai'
export const SUMMIT_PAGE = '/ai-agent-summit/'
// The summit's own domain(s), served at their root by GET / below. Empty until the domain
// is pointed at this Pages project; then add it here AND add '/' to FORCE_DYNAMIC in
// scripts/gen-routes.mjs (today '/' is the static Mumbai home and never reaches the worker).
export const SUMMIT_HOSTS: string[] = []

// Whole rupees before GST, as printed on /ai-agent-summit/attend. The names are Mumbai's,
// so PAID_TIERS, LUNCH_BY_PASS and settlePaidOrder work unchanged.
export const SUMMIT_PASS_PRICES_INR: Record<string, number> = { 'Delegate Pass': 3999, 'VIP Pass': 12999, 'Academic Pass': 999 }
const SUMMIT_EARLY_UNTIL = Date.parse('2027-01-31T23:59:59+05:30')
const SUMMIT_EARLY_PRICES_INR: Record<string, number> = { 'Delegate Pass': 2499 }
const SUMMIT_PER_IP_HOUR = 60
const SUMMIT_TEAM_FALLBACK = 'info@bharataiinnovation.com'

// The form's pass keys. Buyer and Investor are free once the team has checked who they are.
const FREE_PASSES: Record<string, { label: string; source: string; review: boolean }> = {
  visitor: { label: 'Visitor Pass', source: 'agent-summit', review: false },
  buyer: { label: 'Buyer Pass', source: 'agent-summit-buyer', review: true },
  investor: { label: 'Investor Pass', source: 'agent-summit-investor', review: true },
}
const PAID_PASSES: Record<string, string> = { delegate: 'Delegate Pass', vip: 'VIP Pass', academic: 'Academic Pass' }

const SHOWCASE_PACKAGES: Record<string, { label: string; price: string }> = {
  startup: { label: 'Startup Showcase', price: 'Rs 79,000 (Rs 64,000 by 31 Jan 2027)' },
  growth: { label: 'Growth Showcase', price: 'Rs 1,49,000' },
  enterprise: { label: 'Enterprise Showcase', price: 'Rs 2,95,000' },
  pod: { label: 'Showcase pod only', price: 'Rs 38,000' },
}
const AGENT_CATEGORIES: Record<string, string> = {
  'customer-support': 'Customer support and CX', 'sales-marketing': 'Sales and marketing',
  'finance-ops': 'Finance, BFSI and back office', 'hr-talent': 'HR and talent',
  'software-eng': 'Software engineering and IT ops', healthcare: 'Healthcare and life sciences',
  'legal-compliance': 'Legal, risk and compliance', 'supply-chain': 'Manufacturing and supply chain',
  'voice-indic': 'Voice and Indian-language agents', education: 'Education',
  'gov-public': 'Government and public services', 'agent-infra': 'Agent infrastructure (orchestration, evals, security)',
  other: 'Something else',
}
const STAGES: Record<string, string> = { 'live-paying': 'Live with paying customers', pilots: 'In pilots with named customers', beta: 'Working beta with real users' }
const EDITION = 'agent-summit-2027'

export function isSummitOrder(o: any): boolean { return Number(o?.event_id) === SUMMIT_EVENT_ID }

export function summitPrice(passType: string, now = Date.now()): number {
  if (now <= SUMMIT_EARLY_UNTIL && SUMMIT_EARLY_PRICES_INR[passType]) return SUMMIT_EARLY_PRICES_INR[passType]
  return SUMMIT_PASS_PRICES_INR[passType] || 0
}

export function summitPassAmounts(passType: string, now = Date.now()): { base: number; gst: number; total: number } | null {
  const price = summitPrice(passType, now)
  if (!price) return null
  const base = price * 100
  const gst = Math.round(base * h.consts().PASS_GST_RATE / 100)
  return { base, gst, total: base + gst }
}

// The list price, or the difference for a confirmed pass moving up, as in Mumbai and Delhi.
function summitOrderAmounts(a: any, passType: string) {
  const from = summitPrice(h.settledPaidTier(a))
  const to = summitPrice(passType)
  if (!from || to <= from) return summitPassAmounts(passType)
  const base = (to - from) * 100
  const gst = Math.round(base * h.consts().PASS_GST_RATE / 100)
  return { base, gst, total: base + gst }
}

function summitPayRefusal(a: any, passType: string): string | null {
  const { PAID_TIERS, FREE_BADGE_RE } = h.consts()
  const badge = String(a.badge_type || '').trim()
  const status = String(a.payment_status || '').trim().toLowerCase()
  if (!badge || FREE_BADGE_RE.test(badge) || badge === 'Buyer Pass' || badge === 'Investor Pass') return null
  if (PAID_TIERS.includes(badge)) {
    if (status === 'pending' || status === 'refunded') return null
    if (status === 'paid' && summitPrice(passType) > summitPrice(badge)) return null
    return 'Your ' + badge + ' for the AI Agent Summit is already confirmed, so there is nothing to pay. To change it, write to info@bharataiinnovation.com.'
  }
  return 'Your AI Agent Summit pass (' + badge + ') is arranged by the organisers and cannot be changed here. Write to info@bharataiinnovation.com and we will sort it out.'
}

// Checkout must open on the address registered with CCAvenue, never the summit's domain.
async function checkoutBase(c: any): Promise<string> {
  return ((await h.settingValue(c, 'app_url')) || 'https://bharataiinnovation.com/app').replace(/\/app\/?$/, '')
}

async function startSummitOrder(c: any, a: any, passType: string): Promise<{ order_id: string; amount: number; pay_url: string } | { error: string; status: number }> {
  const refused = summitPayRefusal(a, passType)
  if (refused) return { error: refused, status: 409 }
  const amounts = summitOrderAmounts(a, passType)
  if (!amounts) return { error: 'That pass cannot be bought online.', status: 400 }
  const recent = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM payment_orders WHERE attendee_id = ? AND event_id = ? AND created_at > datetime('now', '-1 hour')"
  ).bind(a.id, SUMMIT_EVENT_ID).first() as any
  if (Number(recent?.n || 0) >= h.consts().PAY_ORDERS_PER_HOUR) {
    return { error: 'That is a lot of payment attempts in one hour. Please wait a little, or write to info@bharataiinnovation.com.', status: 429 }
  }
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(4))).map(b => (b % 36).toString(36)).join('')
  const orderId = ('BAI' + a.id + '-' + Date.now().toString(36) + rand).toUpperCase()
  await c.env.DB.prepare(
    'INSERT INTO payment_orders (order_id, attendee_id, event_id, pass_type, previous_badge, base_paise, gst_paise, amount_paise) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(orderId, a.id, SUMMIT_EVENT_ID, passType, a.badge_type || '', amounts.base, amounts.gst, amounts.total).run()
  await h.audit(c, 'summit.pay', 'attendee', a.id, { order_id: orderId, pass_type: passType, amount_paise: amounts.total }, { actor: 'public registration', kind: 'public' })
  return { order_id: orderId, amount: amounts.total / 100, pay_url: (await checkoutBase(c)) + '/pay/ccavenue/' + await h.payLinkToken(c, orderId) }
}

// ---- emails ----

function summitHeader(title: string): string {
  return `<div style="background:#0d1013;padding:26px 30px;border-bottom:3px solid #c6ff3d;">
    <div style="font-family:Consolas,Menlo,monospace;font-size:13px;color:#c6ff3d;letter-spacing:0;">ai-agent-summit/2027</div>
    <div style="font-family:Arial,sans-serif;font-size:22px;font-weight:bold;color:#ffffff;margin-top:6px;">${title}</div>
    <div style="font-family:Arial,sans-serif;font-size:13px;color:#a4aeb9;margin-top:4px;">${SUMMIT_WHEN}</div>
  </div>`
}

function summitMail(title: string, inner: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#f2f3f5;font-family:Arial,sans-serif;">
  <div style="max-width:600px;margin:20px auto;background:#fff;border-radius:10px;overflow:hidden;">
    ${summitHeader(title)}
    <div style="padding:28px 30px;">${inner}
      <p style="margin:22px 0 0;font-size:12.5px;line-height:1.6;color:#777;">AI Agent Summit 2027 is organised by Aegis Knowledge Trust, the team behind Bharat AI Innovation. Questions? Write to <a href="mailto:info@bharataiinnovation.com" style="color:#555;">info@bharataiinnovation.com</a> or call +91 89765 80367.</p>
    </div>
  </div></body></html>`
}

const P = (t: string) => `<p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#444;">${t}</p>`

async function teamAddress(c: any): Promise<string> {
  return (await h.settingValue(c, 'inquiry_notify_email')) || SUMMIT_TEAM_FALLBACK
}

// Called by sendPaymentEmails in index.tsx for an event-3 order. Never throws.
export async function sendSummitPaymentEmails(c: any, a: any, order: any, trackingId: string, paymentMode: string, unlocked: boolean,
    receipt: { invoice_no: string; url: string } | null = null, upgradeFrom = '') {
  try {
    const esc = h.payEsc
    const amount = h.rupees(Number(order.amount_paise))
    const rows = h.payRows([
      ['Pass', esc(order.pass_type) + (upgradeFrom ? ` <span style="font-weight:normal;color:#666;">(moved up from ${esc(upgradeFrom)})</span>` : '')],
      ['Event', SUMMIT_EVENT_NAME],
      ['Date', 'Saturday 17 April 2027, doors 08:30 IST'],
      ['Venue', 'World Trade Center, Cuffe Parade, Mumbai'],
      ['Amount paid', `&#8377;${amount} <span style="font-weight:normal;color:#666;">(includes ${h.consts().PASS_GST_RATE}% GST)</span>`],
      ['Order number', esc(order.order_id)],
      ['CCAvenue reference', esc(trackingId)],
      ['Paid on', esc(h.istStamp(new Date().toISOString()))],
    ])
    const gstText = receipt
      ? `<strong>Payment receipt:</strong> receipt <strong>${esc(receipt.invoice_no)}</strong> is in a separate email, and here: <a href="${esc(receipt.url)}" style="color:#3b6d00;font-weight:bold;">view and download the receipt</a>. Your GST invoice follows separately from our accounts team. If it should be made out to your organisation, send its registered name, GSTIN and billing address to info@bharataiinnovation.com, quoting order ${esc(order.order_id)}.`
      : `<strong>GST invoice:</strong> we will email your tax invoice separately. If it should be made out to your organisation, send its registered name, GSTIN and billing address to info@bharataiinnovation.com, quoting order ${esc(order.order_id)}.`
    const html = summitMail('Payment received',
      `<p style="margin:0 0 6px;font-size:15px;color:#333;">Hi <strong>${esc(a.name)}</strong>,</p>` +
      P(upgradeFrom
        ? `Thank you. Your payment has arrived and your ${esc(upgradeFrom)} for ${SUMMIT_EVENT_NAME} is now a <strong>${esc(order.pass_type)}</strong>.`
        : `Thank you. Your payment has arrived and your <strong>${esc(order.pass_type)}</strong> for ${SUMMIT_EVENT_NAME} is confirmed.`) +
      rows +
      `<p style="margin:0 0 4px;font-size:14px;font-weight:bold;color:#0d1013;">What happens next</p>` +
      P('There is nothing more to do now. In the week before the summit we will email your entry pass and the final programme.') +
      `<div style="text-align:center;margin:0 0 20px;"><a href="https://bharataiinnovation.com/ai-agent-summit/ai-agent-summit-2027.ics" style="display:inline-block;padding:12px 26px;background:#c6ff3d;color:#07080a;text-decoration:none;border-radius:4px;font-weight:bold;font-size:14px;">Save the date</a></div>` +
      `<div style="padding:14px;background:#f6f8f2;border:1px solid #e1e8d2;border-radius:8px;"><p style="margin:0;font-size:12.5px;line-height:1.6;color:#333;">${gstText}</p></div>`)
    await h.sendEmail(c, a.email, 'Payment received: your ' + order.pass_type + ' for ' + SUMMIT_EVENT_NAME, h.noAppOnPhone(html), { unsubscribe: false })

    const teamHtml = `<div style="font-family:Arial,sans-serif;max-width:560px;">
      <p style="font-size:14px;line-height:1.6;color:#333;margin:0 0 14px;"><strong>${esc(a.name)}</strong> (${esc(a.email)}${a.company ? ', ' + esc(a.company) : ''}) has paid online for <strong>${SUMMIT_EVENT_NAME}</strong> through CCAvenue.</p>
      ${rows}
      <p style="font-size:13px;line-height:1.6;color:#555;margin:0;">${!unlocked
        ? 'Their pass was <strong>not</strong> changed, because it had been set to ' + esc(a.badge_type) + ' by hand. Decide what this payment was for, then raise the invoice from Admin, Payments.'
        : receipt
          ? 'The pass is confirmed and payment receipt <strong>' + esc(receipt.invoice_no) + '</strong> was emailed automatically. The GST tax invoice is still to raise: Admin, Payments, &ldquo;Paid online&rdquo;.'
          : 'The pass is confirmed. The payment receipt could <strong>not</strong> be sent automatically. The GST tax invoice is still to raise: Admin, Payments, &ldquo;Paid online&rdquo;.'}</p></div>`
    await h.sendEmail(c, await teamAddress(c), `Paid online, AI Agent Summit: ${a.name}, ${order.pass_type}${upgradeFrom ? ' (moved up from ' + upgradeFrom + ')' : ''}, Rs ${amount}`, teamHtml, { unsubscribe: false })
  } catch (e: any) {
    console.error('summit payment emails failed', order?.order_id, e?.message)
  }
}

async function sendFreePassEmail(c: any, a: any, kind: string) {
  try {
    const esc = h.payEsc
    const info = FREE_PASSES[kind]
    const body = info.review
      ? P(`Thank you for asking for a <strong>${info.label}</strong> for ${SUMMIT_EVENT_NAME}. ${info.label}es are complimentary for people who ${kind === 'buyer' ? 'evaluate AI agents for their organisation' : 'invest in applied AI'}. Our team will check your details and confirm within three working days.`)
      : P(`Your <strong>Visitor Pass</strong> for ${SUMMIT_EVENT_NAME} is confirmed. It covers the showcase floor all day, and seating in the main hall when seats are free.`)
    const html = summitMail(info.review ? 'Request received' : 'You are registered',
      `<p style="margin:0 0 6px;font-size:15px;color:#333;">Hi <strong>${esc(a.name)}</strong>,</p>` + body +
      h.payRows([['Event', SUMMIT_EVENT_NAME], ['Date', 'Saturday 17 April 2027, doors 08:30 IST'], ['Venue', 'World Trade Center, Cuffe Parade, Mumbai']]) +
      P('In the week before the summit we will email your entry pass and the final programme. Want a reserved seat and lunch? The Delegate Pass is on the attend page.') +
      `<div style="text-align:center;margin:0 0 6px;"><a href="https://bharataiinnovation.com/ai-agent-summit/ai-agent-summit-2027.ics" style="display:inline-block;padding:12px 26px;background:#c6ff3d;color:#07080a;text-decoration:none;border-radius:4px;font-weight:bold;font-size:14px;">Save the date</a></div>`)
    await h.sendEmail(c, a.email, info.review ? `We have your ${info.label} request: ${SUMMIT_EVENT_NAME}` : `You are registered: ${SUMMIT_EVENT_NAME}`, h.noAppOnPhone(html), { unsubscribe: false })
    if (info.review) {
      await h.sendEmail(c, await teamAddress(c), `${info.label} request, AI Agent Summit: ${a.name}${a.company ? ', ' + a.company : ''}`,
        `<div style="font-family:Arial,sans-serif;max-width:560px;font-size:14px;line-height:1.6;color:#333;"><p><strong>${esc(a.name)}</strong> asked for a <strong>${info.label}</strong> for ${SUMMIT_EVENT_NAME}.</p>` +
        h.payRows([['Email', esc(a.email)], ['Mobile', esc(a.mobile)], ['Organisation', esc(a.company)], ['Title', esc(a.job_title)], ['City', esc(a.city)]]) +
        `<p style="font-size:13px;color:#555;">Check who they are and reply to confirm. They are listed in Admin, Overview, AI Agent Summit passes.</p></div>`, { unsubscribe: false })
    }
  } catch (e: any) {
    console.error('summit free pass email failed', a?.email, e?.message)
  }
}

// /pay/result for a summit order (index.tsx dispatches here).
export async function summitPayResult(c: any, order: any) {
  const esc = h.payEsc
  const no = esc(order.order_id)
  const page = (title: string, body: string) => c.html(h.payPage(title, body, 'summit'))
  const back = h.payButton(SUMMIT_PAGE, 'Back to the AI Agent Summit')
  const token = await h.payLinkToken(c, order.order_id)
  const retry = `<button id="again" type="button" style="padding:13px 24px;background:#FF6B00;color:#fff;border:0;border-radius:9px;font-size:15px;font-weight:bold;cursor:pointer;">Try again</button>` +
    `<a href="${SUMMIT_PAGE}" style="margin-left:14px;font-size:13px;color:#555;">Back to the summit page</a>` +
    `<p id="again-msg" style="font-size:13px;color:#B3261E;margin:12px 0 0;min-height:16px;"></p>` +
    `<script>document.getElementById("again").onclick=function(){var b=this,m=document.getElementById("again-msg");b.disabled=true;m.textContent="";` +
    `fetch("/api/agent-summit/pass-again",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({o:${JSON.stringify(token)}})})` +
    `.then(function(r){return r.json().catch(function(){return {};}).then(function(j){return {ok:r.ok,j:j};});})` +
    `.then(function(x){if(x.ok&&x.j.pay_url){location.href=x.j.pay_url;return;}b.disabled=false;m.textContent=x.j.error||"We could not start a new payment. Please try again from the summit page.";})` +
    `.catch(function(){b.disabled=false;m.textContent="Network error. Nothing was charged. Please try again.";});};</script>`

  if (order.status === 'paid') {
    return page('Payment received', h.payH1('Payment received. Thank you.') +
      h.payP(`Your <strong>${esc(order.pass_type)}</strong> for ${SUMMIT_EVENT_NAME} is confirmed.`) +
      h.payRows([
        ['Amount paid', `&#8377;${h.rupees(Number(order.amount_paise))} <span style="font-weight:normal;color:#666;">(includes GST)</span>`],
        ['Order number', no],
        ['CCAvenue reference', esc(order.tracking_id)],
      ]) +
      h.payP('A confirmation and your receipt are on their way to your email, and your GST invoice follows separately. In the week before the summit we will email your entry pass.') +
      h.payButton(SUMMIT_PAGE + 'ai-agent-summit-2027.ics', 'Save the date'))
  }
  if (order.status === 'aborted') {
    return page('Payment cancelled', h.payH1('You cancelled the payment.') +
      h.payP(`Nothing was charged and your ${esc(order.pass_type)} for the AI Agent Summit is still waiting. You can pay whenever you are ready.`) + retry)
  }
  if (order.status === 'awaited') {
    return page('Waiting for your bank', h.payH1('Your bank has not confirmed yet.') +
      h.payP('Please do not pay a second time. If the money has left your account, your pass is confirmed as soon as the bank reports it.') +
      h.payP(`If nothing has changed in a day, write to info@bharataiinnovation.com quoting order <strong>${no}</strong>.`) + back)
  }
  if (order.status === 'mismatch') {
    return page('We are checking this payment', h.payH1('We need to check this payment.') +
      h.payP('The amount the payment gateway reported is not the price of the pass, so the pass has not been issued automatically. Our team has been told and will write to you.') +
      h.payP(`Your order number is <strong>${no}</strong>.`) + back)
  }
  if (order.status === 'created') {
    return page('No answer yet', h.payH1('We have not heard back about this payment.') +
      h.payP('If you completed it, give it a minute and refresh this page. If you did not, nothing was charged.') +
      h.payP(`Your order number is <strong>${no}</strong>.`) + retry)
  }
  const why = String(order.status_message || '').trim()
  return page('Payment not completed', h.payH1('The payment did not go through.') +
    h.payP('No pass has been issued for it. If money left your account, your bank returns it on its own; if it has not come back within a week, write to info@bharataiinnovation.com quoting order <strong>' + no + '</strong>.') +
    (why && why.toLowerCase() !== 'null' ? h.payP('The payment gateway said: ' + esc(why)) : '') + retry)
}

// ---- input helpers ----

const text = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max)

async function ipOver(c: any, action: string, limit: number): Promise<boolean> {
  const ip = String(c.req.header('CF-Connecting-IP') || '').slice(0, 64)
  if (!ip) return false
  const recent = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM admin_audit WHERE action = ? AND ip = ? AND created_at > datetime('now', '-1 hour')"
  ).bind(action, ip).first().catch(() => null) as any
  return Number(recent?.n || 0) >= limit
}

async function ensureSummitEvent(c: any) {
  // attendees.event_id and inquiries.event_id have foreign keys in production: the first
  // registration brings event 3 into being, as Delhi's first buyer did for event 2.
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO events (id, title, event_type, venue, start_date, end_date) VALUES (?, ?, 'conference', 'World Trade Center Mumbai', '2027-04-17', '2027-04-17')"
  ).bind(SUMMIT_EVENT_ID, SUMMIT_EVENT_NAME).run()
}

function splitName(b: any): string {
  const full = text(b.name, 120)
  if (full) return full
  return (text(b.first_name, 60) + ' ' + text(b.last_name, 60)).trim()
}

const app = new Hono<{ Bindings: any }>()

// The summit's own domain shows the summit at its root. Reached only once '/' is in
// FORCE_DYNAMIC (see SUMMIT_HOSTS); every other host gets the static file unchanged.
app.get('/', async (c, next) => {
  const host = String(c.req.header('host') || '').toLowerCase().replace(/:\d+$/, '')
  if (!SUMMIT_HOSTS.includes(host)) {
    if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw)
    return next()
  }
  const url = new URL(c.req.url)
  url.pathname = SUMMIT_PAGE
  return c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw))
})

// ---- passes ----

app.post('/api/agent-summit/pass', async (c) => {
  const b = await c.req.json().catch(() => ({})) as any
  const key = String(b.pass || '').toLowerCase()
  const free = FREE_PASSES[key]
  const paidType = PAID_PASSES[key]
  if (!free && !paidType) return c.json({ ok: false, error: 'Choose a pass.', errors: [{ field: 'pass', message: 'Choose a pass.' }] }, 400)
  if (paidType && !(await h.onlinePaymentsOn(c))) {
    return c.json({ ok: false, error: 'Online payment is not available just now. Nothing was charged. Please try again in a little while, or write to info@bharataiinnovation.com.', code: 'not_configured' }, 503)
  }
  const name = splitName(b)
  const email = text(b.email, 160).toLowerCase()
  const mobile = text(b.mobile || b.phone, 20)
  const company = text(b.organization || b.company, 160)
  const job_title = text(b.job_title, 120)
  const city = text(b.city, 80)
  const industry = text(b.industry, 80)
  const academic = paidType === 'Academic Pass'

  const errors: { field: string; message: string }[] = []
  if (!text(b.first_name, 60) && !text(b.name, 120)) errors.push({ field: 'first_name', message: 'First name is required.' })
  if (!text(b.last_name, 60) && !text(b.name, 120)) errors.push({ field: 'last_name', message: 'Last name is required.' })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.push({ field: 'email', message: 'Please check your email. It should look like name@example.com.' })
  if (mobile.replace(/\D/g, '').length < 10) errors.push({ field: 'phone', message: 'Please check your mobile number. It needs at least 10 digits.' })
  if ((paidType || (free && free.review)) && !company) errors.push({ field: 'organization', message: academic ? 'Your college is required.' : 'Your organisation is required for this pass.' })
  if (((free && free.review) || (paidType && !academic)) && !job_title) errors.push({ field: 'job_title', message: 'Your job title is required for this pass.' })
  if (!['yes', 'on', 'true', '1'].includes(String(b.consent || '').toLowerCase())) errors.push({ field: 'consent', message: 'Please agree to the terms and privacy policy to continue.' })
  if (errors.length) return c.json({ ok: false, error: errors.length === 1 ? errors[0].message : 'Please check the highlighted fields.', errors }, 400)
  const typo = h.emailTypo(email)
  if (typo) return c.json({ ok: false, error: typo.reason, code: 'email_typo', suggestion: typo.fixed || '', errors: [{ field: 'email', message: typo.reason }] }, 400)
  if (await ipOver(c, paidType ? 'summit.pay' : 'summit.register', SUMMIT_PER_IP_HOUR)) {
    return c.json({ ok: false, error: 'Too many attempts from this connection. Please try again in an hour, or write to info@bharataiinnovation.com.' }, 429)
  }
  const billing = paidType && b.billing !== undefined ? h.cleanBilling(b.billing) : undefined
  if (billing && 'error' in billing) return c.json({ ok: false, error: billing.error }, 400)

  const pick = () => c.env.DB.prepare('SELECT * FROM attendees WHERE event_id = ? AND email = ?').bind(SUMMIT_EVENT_ID, email).first() as Promise<any>
  let a = await pick()
  const wantBadge = paidType || free.label
  if (a) {
    // No sign-in on this form: the mobile they registered with is what lets them go on.
    if (h.mobileKey(a.mobile) !== h.mobileKey(mobile)) {
      return c.json({ ok: false, error: email + ' is already registered for the AI Agent Summit with another mobile number. Please use that number, or write to info@bharataiinnovation.com.', code: 'email_registered' }, 409)
    }
    if (free) {
      return c.json({ ok: true, already: true, reference: 'AAS27-' + a.id, pass: a.badge_type, message: 'You are already registered for the AI Agent Summit with this email (' + a.badge_type + '). Your reference is AAS27-' + a.id + '.' })
    }
    const refused = summitPayRefusal(a, paidType)
    if (refused) return c.json({ ok: false, error: refused, code: 'already_confirmed' }, 409)
    if (String(a.payment_status || '').toLowerCase() !== 'paid' || h.consts().FREE_BADGE_RE.test(String(a.badge_type || '')) || /^(Buyer|Investor) Pass$/.test(String(a.badge_type || ''))) {
      await c.env.DB.prepare("UPDATE attendees SET badge_type = ?, payment_status = 'pending' WHERE id = ? AND event_id = ?").bind(paidType, a.id, SUMMIT_EVENT_ID).run()
      a = { ...a, badge_type: paidType, payment_status: 'pending' }
    }
  } else {
    const holder = await h.mobileHolder(c, SUMMIT_EVENT_ID, mobile)
    if (holder) return c.json({ ok: false, error: 'This mobile number is already registered for the AI Agent Summit with ' + h.maskEmail(holder.email) + '. Please use your own mobile number.', code: 'mobile_registered', errors: [{ field: 'phone', message: 'This mobile number is already registered with another email.' }] }, 409)
    await ensureSummitEvent(c)
    try {
      const made = await c.env.DB.prepare(
        `INSERT INTO attendees (event_id, name, email, company, job_title, mobile, city, industry, lunch_inclusion, badge_type, payment_status, registration_source, registration_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'No', ?, ?, ?, datetime('now'))`
      ).bind(SUMMIT_EVENT_ID, name, email, company, academic ? '' : job_title, mobile, city, industry, wantBadge,
        // A free pass owes nothing ('paid', as Mumbai's free Visitor rows); a paid one waits for the gateway.
        paidType ? 'pending' : 'paid',
        h.sanitizeSource(b.registration_source) || (paidType ? 'agent-summit' : free.source)).run()
      a = await c.env.DB.prepare('SELECT * FROM attendees WHERE id = ?').bind(made.meta.last_row_id).first()
    } catch (e: any) {
      if (!String(e?.message || '').includes('UNIQUE')) {
        console.error('summit register failed', email, e?.message)
        await h.audit(c, 'summit.register_failed', 'attendee', null, { email, error: String(e?.message || e).slice(0, 300) }, { actor: 'public registration', kind: 'public' })
        return c.json({ ok: false, error: 'We could not save your details. Nothing was charged. Please try again.' }, 500)
      }
      a = await pick()
    }
  }

  if (free) {
    await h.audit(c, 'summit.register', 'attendee', a.id, { pass: free.label, review: free.review }, { actor: 'public registration', kind: 'public' })
    const mails = sendFreePassEmail(c, a, key)
    try { c.executionCtx.waitUntil(mails) } catch { await mails }
    return c.json({
      ok: true, reference: 'AAS27-' + a.id, pass: free.label, status: free.review ? 'under_review' : 'confirmed',
      message: free.review
        ? `Thank you. ${free.label}es are complimentary for people who ${key === 'buyer' ? 'evaluate AI agents for their organisation' : 'invest in applied AI'}. Our team will confirm yours within three working days. Your reference is AAS27-${a.id}.`
        : `Your Visitor Pass is confirmed. We will email your entry pass in the week before the summit. Your reference is AAS27-${a.id}.`,
    }, 201)
  }

  if (billing) await h.saveBilling(c, a.id, billing.billing)
  const r = await startSummitOrder(c, a, paidType)
  if ('error' in r) return c.json({ ok: false, error: r.error }, r.status as any)
  return c.json({ ok: true, reference: 'AAS27-' + a.id, pass: paidType, status: 'payment_pending', message: 'Taking you to secure checkout.', ...r }, 201)
})

// Try again, from the result page: the signed link stands in for a session.
app.post('/api/agent-summit/pass-again', async (c) => {
  if (!(await h.onlinePaymentsOn(c))) return c.json({ error: 'Online payment is not available just now. Nothing was charged. Please try again in a little while.' }, 503)
  const b = await c.req.json().catch(() => ({})) as any
  const order = await h.orderFromLinkToken(c, String(b.o || ''))
  if (!order || !isSummitOrder(order)) return c.json({ error: 'That link is not valid. Please start again from the summit page.' }, 400)
  const a = await c.env.DB.prepare('SELECT * FROM attendees WHERE id = ? AND event_id = ?').bind(order.attendee_id, SUMMIT_EVENT_ID).first() as any
  if (!a) return c.json({ error: 'That link is not valid. Please start again from the summit page.' }, 400)
  const r = await startSummitOrder(c, a, String(order.pass_type))
  if ('error' in r) return c.json({ error: r.error }, r.status as any)
  return c.json(r, 201)
})

// ---- showcase applications and sponsor enquiries: rows on the Inquiries desk ----

async function saveInquiry(c: any, row: { type: string; name: string; email: string; phone: string; organization: string; subject: string; message: string; metadata: any }) {
  const r = await c.env.DB.prepare(
    `INSERT INTO inquiries (event_id, inquiry_type, name, email, phone, organization, subject, message, metadata) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(row.type, row.name, row.email, row.phone, row.organization, row.subject, row.message, JSON.stringify(row.metadata)).run()
  const id = r.meta.last_row_id
  const saved = { id, inquiry_type: row.type, name: row.name, email: row.email, phone: row.phone, organization: row.organization, subject: row.subject, message: row.message }
  const notify = h.notifyTeam(c, saved).catch((e: any) => console.error('summit notify failed', e?.message))
  try { c.executionCtx.waitUntil(notify) } catch { await notify }
  return id
}

app.post('/api/agent-summit/apply', async (c) => {
  const b = await c.req.json().catch(() => ({})) as any
  const pkg = String(b.package || '')
  const category = String(b.category || '')
  const errors: { field: string; message: string }[] = []
  const company = text(b.company, 120)
  const agent = text(b.agent_name, 80)
  const summary = text(b.agent_summary, 700)
  const contact = text(b.contact_name, 100)
  const email = text(b.email, 160).toLowerCase()
  const phone = text(b.phone, 30)
  if (!SHOWCASE_PACKAGES[pkg]) errors.push({ field: 'package', message: 'Choose a showcase package.' })
  if (company.length < 2) errors.push({ field: 'company', message: 'Company name is required.' })
  if (agent.length < 2) errors.push({ field: 'agent_name', message: 'Agent or product name is required.' })
  if (!AGENT_CATEGORIES[category]) errors.push({ field: 'category', message: 'Choose the category that fits your agent best.' })
  if (summary.length < 30) errors.push({ field: 'agent_summary', message: summary ? 'The description of your agent needs at least 30 characters.' : 'The description of your agent is required.' })
  if (!STAGES[String(b.stage || '')]) errors.push({ field: 'stage', message: 'Tell us how far along the product is.' })
  if (contact.length < 2) errors.push({ field: 'contact_name', message: 'Your name is required.' })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.push({ field: 'email', message: 'Enter a valid email address.' })
  if (phone.replace(/\D/g, '').length < 8) errors.push({ field: 'phone', message: 'Enter a valid phone number.' })
  if (!['yes', 'on', 'true', '1'].includes(String(b.consent || '').toLowerCase())) errors.push({ field: 'consent', message: 'Please agree to the terms and privacy policy to continue.' })
  if (errors.length) return c.json({ ok: false, error: errors.length === 1 ? errors[0].message : 'Please check the highlighted fields.', errors }, 400)
  if (text(b.website_confirm, 200)) return c.json({ ok: true, reference: 'AAS27-RECEIVED', message: 'Thank you.' })
  if (await ipOver(c, 'summit.apply', 20)) return c.json({ ok: false, error: 'Too many applications from this connection. Please try again in an hour, or write to info@bharataiinnovation.com.' }, 429)

  const dupe = await c.env.DB.prepare(
    "SELECT id FROM inquiries WHERE inquiry_type = 'agent_showcase' AND lower(email) = ? AND lower(COALESCE(json_extract(metadata, '$.agent_name'), '')) = lower(?) LIMIT 1"
  ).bind(email, agent).first().catch(() => null) as any
  if (dupe) {
    return c.json({ ok: true, already: true, reference: 'AAS27-A' + dupe.id, message: `We already have an application for ${agent} from this email (reference AAS27-A${dupe.id}). Reply to our email if you need to change anything.` })
  }
  const meta = {
    edition: EDITION, package: pkg, package_label: SHOWCASE_PACKAGES[pkg].label, package_price: SHOWCASE_PACKAGES[pkg].price,
    agent_name: agent, category, category_label: AGENT_CATEGORIES[category], stage: String(b.stage), stage_label: STAGES[String(b.stage)],
    website: text(b.website, 300), demo_url: text(b.demo_url, 300), live_demo: text(b.live_demo, 700), customers: text(b.customers, 300),
    founded_year: text(b.founded_year, 4), team_size: text(b.team_size, 20), city: text(b.city, 80), contact_role: text(b.contact_role, 100),
    heard_from: text(b.heard_from, 120), page: 'ai-agent-summit/showcase',
  }
  const message = [
    summary,
    '',
    'Package: ' + SHOWCASE_PACKAGES[pkg].label + ' (' + SHOWCASE_PACKAGES[pkg].price + ' + GST)',
    'Category: ' + AGENT_CATEGORIES[category],
    'Stage: ' + STAGES[String(b.stage)],
    meta.live_demo ? 'Live demo plan: ' + meta.live_demo : '',
    meta.demo_url ? 'Demo link: ' + meta.demo_url : '',
    meta.website ? 'Website: ' + meta.website : '',
    meta.customers ? 'Customers or pilots: ' + meta.customers : '',
    [meta.founded_year && 'Founded ' + meta.founded_year, meta.team_size && 'team ' + meta.team_size, meta.city].filter(Boolean).join(', '),
    meta.contact_role ? 'Contact role: ' + meta.contact_role : '',
  ].filter((l, i) => l !== '' || i === 1).join('\n').slice(0, 4000)
  const id = await saveInquiry(c, {
    type: 'agent_showcase', name: contact, email, phone, organization: company,
    subject: `AI Agent Summit 2027 · Showcase: ${agent} (${SHOWCASE_PACKAGES[pkg].label})`, message, metadata: meta,
  })
  await h.audit(c, 'summit.apply', 'inquiry', id, { package: pkg, agent }, { actor: 'public registration', kind: 'public' })
  return c.json({ ok: true, reference: 'AAS27-A' + id, message: `Application received for ${agent}. The jury reviews applications every week and will reply within five working days. Your reference is AAS27-A${id}.` }, 201)
})

const TIERS: Record<string, string> = { presenting: 'Presenting Partner (Rs 20,00,000)', platinum: 'Platinum (Rs 10,00,000)', gold: 'Gold (Rs 5,00,000)', silver: 'Silver (Rs 2,50,000)', 'add-on': 'An add-on' }

app.post('/api/agent-summit/enquire', async (c) => {
  const b = await c.req.json().catch(() => ({})) as any
  const name = text(b.name, 100)
  const email = text(b.email, 160).toLowerCase()
  const errors: { field: string; message: string }[] = []
  if (name.length < 2) errors.push({ field: 'name', message: 'Your name is required.' })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.push({ field: 'email', message: 'Enter a valid email address.' })
  if (!['yes', 'on', 'true', '1'].includes(String(b.consent || '').toLowerCase())) errors.push({ field: 'consent', message: 'Please agree to the terms and privacy policy to continue.' })
  if (errors.length) return c.json({ ok: false, error: errors.length === 1 ? errors[0].message : 'Please check the highlighted fields.', errors }, 400)
  if (text(b.website_confirm, 200)) return c.json({ ok: true, reference: 'AAS27-RECEIVED', message: 'Thank you.' })
  if (await ipOver(c, 'summit.enquire', 20)) return c.json({ ok: false, error: 'Too many enquiries from this connection. Please try again in an hour.' }, 429)
  const tier = TIERS[String(b.tier || '')] || 'Not sure yet'
  const company = text(b.company, 120)
  const id = await saveInquiry(c, {
    type: 'sponsorship', name, email, phone: text(b.phone, 30), organization: company,
    subject: `AI Agent Summit 2027 · Partner: ${tier}`,
    message: [text(b.message, 2000), '', 'Interested in: ' + tier, text(b.job_title, 100) ? 'Title: ' + text(b.job_title, 100) : ''].filter(Boolean).join('\n'),
    metadata: { edition: EDITION, tier: String(b.tier || ''), job_title: text(b.job_title, 100), page: 'ai-agent-summit/partners' },
  })
  await h.audit(c, 'summit.enquire', 'inquiry', id, { tier: String(b.tier || '') }, { actor: 'public registration', kind: 'public' })
  return c.json({ ok: true, reference: 'AAS27-E' + id, message: `Thank you, ${name.split(' ')[0]}. Our partnerships team will reply within one working day with the partner deck and what is still open. Your reference is AAS27-E${id}.` }, 201)
})

// ---- admin (behind index.tsx's /api/admin/* guard) ----

app.get('/api/admin/agent-summit/passes', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.name, a.email, a.mobile, a.company, a.job_title, a.city, a.industry, a.badge_type, a.payment_status, a.registration_source, a.registration_date,
            (SELECT o.status FROM payment_orders o WHERE o.attendee_id = a.id AND o.event_id = ? ORDER BY o.id DESC LIMIT 1) AS last_order,
            (SELECT COALESCE(SUM(o.amount_paise), 0) FROM payment_orders o WHERE o.attendee_id = a.id AND o.event_id = ? AND o.status = 'paid') AS paid_paise
       FROM attendees a WHERE a.event_id = ? ORDER BY a.id DESC`
  ).bind(SUMMIT_EVENT_ID, SUMMIT_EVENT_ID, SUMMIT_EVENT_ID).all() as any
  return c.json({ results: results || [] })
})

// A Buyer or Investor Pass confirmed by the team is an admin_audit row (action
// 'summit.confirm'), not a column: attendees.entry_status is Mumbai's waiting list.
const CONFIRMED_SQL = "EXISTS (SELECT 1 FROM admin_audit au WHERE au.action = 'summit.confirm' AND CAST(au.entity_id AS TEXT) = CAST(a.id AS TEXT))"

export async function summitSales(c: any): Promise<{ registered: number; paid: number; paise: number; review: number; applications: number; applications_new: number; partners: number }> {
  const one = async (sql: string, ...v: any[]) => Number(((await c.env.DB.prepare(sql).bind(...v).first().catch(() => null)) as any)?.n || 0)
  return {
    registered: await one('SELECT COUNT(*) AS n FROM attendees WHERE event_id = ?', SUMMIT_EVENT_ID),
    paid: await one("SELECT COUNT(DISTINCT attendee_id) AS n FROM payment_orders WHERE event_id = ? AND status = 'paid'", SUMMIT_EVENT_ID),
    paise: await one("SELECT COALESCE(SUM(amount_paise), 0) AS n FROM payment_orders WHERE event_id = ? AND status = 'paid'", SUMMIT_EVENT_ID),
    review: await one(`SELECT COUNT(*) AS n FROM attendees a WHERE a.event_id = ? AND a.badge_type IN ('Buyer Pass', 'Investor Pass') AND NOT ${CONFIRMED_SQL}`, SUMMIT_EVENT_ID),
    applications: await one("SELECT COUNT(*) AS n FROM inquiries WHERE inquiry_type = 'agent_showcase'"),
    applications_new: await one("SELECT COUNT(*) AS n FROM inquiries WHERE inquiry_type = 'agent_showcase' AND status = 'new'"),
    partners: await one(`SELECT COUNT(*) AS n FROM inquiries WHERE inquiry_type = 'sponsorship' AND subject LIKE 'AI Agent Summit 2027%'`),
  }
}

// Admin -> AI Agent Summit: everything the section shows, in one answer.
app.get('/api/admin/agent-summit/overview', async (c) => {
  const db = c.env.DB
  const passes = ((await db.prepare(
    `SELECT a.id, a.name, a.email, a.mobile, a.company, a.job_title, a.city, a.industry, a.badge_type, a.payment_status, a.registration_source, a.registration_date,
            (SELECT o.status FROM payment_orders o WHERE o.attendee_id = a.id AND o.event_id = ? ORDER BY o.id DESC LIMIT 1) AS last_order,
            (SELECT COALESCE(SUM(o.amount_paise), 0) FROM payment_orders o WHERE o.attendee_id = a.id AND o.event_id = ? AND o.status = 'paid') AS paid_paise,
            (SELECT MAX(au.created_at) FROM admin_audit au WHERE au.action = 'summit.confirm' AND CAST(au.entity_id AS TEXT) = CAST(a.id AS TEXT)) AS confirmed_at
       FROM attendees a WHERE a.event_id = ? ORDER BY a.id DESC LIMIT 3000`
  ).bind(SUMMIT_EVENT_ID, SUMMIT_EVENT_ID, SUMMIT_EVENT_ID).all()) as any).results || []
  const parse = (m: any) => { try { return JSON.parse(m || '{}') || {} } catch { return {} } }
  const applications = ((((await db.prepare(
    `SELECT id, created_at, name, email, phone, organization, subject, message, status, metadata FROM inquiries WHERE inquiry_type = 'agent_showcase' ORDER BY id DESC LIMIT 1000`
  ).all()) as any).results || []) as any[]).map((r) => {
    const m = parse(r.metadata)
    return { id: r.id, created_at: r.created_at, contact: r.name, email: r.email, phone: r.phone, company: r.organization, status: r.status,
      agent: m.agent_name || '', package: m.package_label || '', category: m.category_label || '', stage: m.stage_label || '',
      demo_url: m.demo_url || '', website: m.website || '', summary: String(r.message || '').split('\n')[0] }
  })
  const partners = ((((await db.prepare(
    `SELECT id, created_at, name, email, phone, organization, subject, status, metadata FROM inquiries WHERE inquiry_type = 'sponsorship' AND subject LIKE 'AI Agent Summit 2027%' ORDER BY id DESC LIMIT 500`
  ).all()) as any).results || []) as any[]).map((r) => {
    const m = parse(r.metadata)
    return { id: r.id, created_at: r.created_at, name: r.name, email: r.email, phone: r.phone, company: r.organization, status: r.status,
      tier: String(r.subject || '').replace(/^AI Agent Summit 2027 · Partner: /, ''), job_title: m.job_title || '' }
  })
  return c.json({ sales: await summitSales(c), passes, applications, partners, prices: SUMMIT_PASS_PRICES_INR })
})

// The team confirms a Buyer or Investor Pass: the person is emailed, the audit row is the record.
app.post('/api/admin/agent-summit/passes/:id/confirm', async (c) => {
  const id = Number(c.req.param('id'))
  const a = await c.env.DB.prepare('SELECT * FROM attendees WHERE id = ? AND event_id = ?').bind(id, SUMMIT_EVENT_ID).first() as any
  if (!a) return c.json({ error: 'No AI Agent Summit registration with that id.' }, 404)
  if (!/^(Buyer|Investor) Pass$/.test(String(a.badge_type || ''))) return c.json({ error: 'Only Buyer and Investor passes are confirmed by hand.' }, 400)
  const done = await c.env.DB.prepare(`SELECT 1 AS y FROM attendees a WHERE a.id = ? AND ${CONFIRMED_SQL}`).bind(id).first()
  if (done) return c.json({ ok: true, already: true })
  await h.audit(c, 'summit.confirm', 'attendee', id, { pass: a.badge_type, email: a.email })
  const esc = h.payEsc
  const html = summitMail('Your pass is confirmed',
    `<p style="margin:0 0 6px;font-size:15px;color:#333;">Hi <strong>${esc(a.name)}</strong>,</p>` +
    P(`Your <strong>${esc(a.badge_type)}</strong> for ${SUMMIT_EVENT_NAME} is confirmed. It is complimentary and includes a reserved seat in the main hall, lunch, the VIP lounge and introductions to the companies you choose.`) +
    h.payRows([['Event', SUMMIT_EVENT_NAME], ['Date', 'Saturday 17 April 2027, doors 08:30 IST'], ['Venue', 'World Trade Center, Cuffe Parade, Mumbai']]) +
    P('In the week before the summit we will email your entry pass and the final programme, with the list of companies on stage.') +
    `<div style="text-align:center;margin:0 0 6px;"><a href="https://bharataiinnovation.com/ai-agent-summit/ai-agent-summit-2027.ics" style="display:inline-block;padding:12px 26px;background:#c6ff3d;color:#07080a;text-decoration:none;border-radius:4px;font-weight:bold;font-size:14px;">Save the date</a></div>`)
  const sent = h.sendEmail(c, a.email, `Confirmed: your ${a.badge_type} for ${SUMMIT_EVENT_NAME}`, h.noAppOnPhone(html), { unsubscribe: false })
    .catch((e: any) => console.error('summit confirm email failed', a.email, e?.message))
  try { c.executionCtx.waitUntil(sent) } catch { await sent }
  return c.json({ ok: true })
})

export default app
