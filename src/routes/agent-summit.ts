import { Hono } from 'hono'
import { titledName } from '../lib/greet'

// ==================== AI AGENT SUMMIT 2027 (event 3), 15 Nov 2026 ====================
//
// The organiser: "use the same backend app for delegate registration, participants,
// booths; we have really everything built". The summit is event 3 the way Delhi 2027 is
// event 2: its people are rows in `attendees` with event_id = 3, its paid passes go through
// the same payment_orders, CCAvenue checkout, receipt and GST invoice, and its showcase
// applications and sponsor enquiries are rows on the Inquiries desk.
//
// Friday 16 April 2027, World Trade Center Mumbai. One day. Companies that have built AI
// agents apply for a 10-minute slot (7 minutes live demo, 3 minutes of questions) and a
// showcase spot on the floor.
//
// Pages: public/ai-agent-summit/ (its own design: dark "agent console"). They post here:
//   POST /api/agent-summit/pass         a pass: free ones are confirmed (Buyer/Investor wait
//                                        for the team), paid ones return a checkout link
//   POST /api/agent-summit/pass-again   Try again from the result page (signed link)
//   POST /api/agent-summit/apply        showcase application -> inquiry 'agent_showcase'
//   POST /api/agent-summit/enquire      sponsor enquiry -> inquiry 'sponsorship'
//   POST /api/agent-summit/challenge    AI Agent Challenge team -> inquiry 'agent_challenge'
//   POST /api/agent-summit/problem      a buyer's problem for the board -> inquiry 'agent_problem'
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
  sign: (c: any, message: string) => Promise<string>
  receiptForOrder: (c: any, order: any, a: any, trackingId: string) => Promise<{ invoice_no: string; url: string } | null>
}
let h: Hooks = {} as Hooks
export function configureAgentSummit(hooks: Partial<Hooks>) { h = { ...h, ...hooks } as Hooks }

export const SUMMIT_EVENT_ID = 3
export const SUMMIT_EVENT_NAME = 'AI Agent Summit 2027'
export const SUMMIT_WHEN = 'Friday 16 April 2027 &bull; World Trade Center Mumbai'
export const SUMMIT_PAGE = '/ai-agent-summit/'
// The summit's own domain is aiagentssummit.org (15 Nov 2026): a Cloudflare zone in this account,
// attached to this Pages project (apex and www). Its home page is NOT served by this worker:
// two URL Rewrite Rules on that zone turn '/' (and '/?utm...') into /ai-agent-summit/, so
// bharataiinnovation.com's static home never runs through the worker. SUMMIT_HOSTS stays empty;
// GET / below only matters if '/' is ever added to FORCE_DYNAMIC in scripts/gen-routes.mjs.
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

// The commercials of 26 Nov 2026 (the organiser): three showcase choices, each with a stage
// slot, and a custom booth by the square foot, booked by 15 Feb 2027. The pod without a
// stage slot is no longer sold: the Startup Showcase is the pod with a stage slot, Rs 38,000.
const CUSTOM_RATE_INR = 6000
const CUSTOM_MIN_SQFT = 200
const CUSTOM_MAX_SQFT = 2000
const CUSTOM_BOOK_BY = Date.parse('2027-02-15T23:59:59+05:30')
const customSqft = (v: any) => Math.min(CUSTOM_MAX_SQFT, Math.max(CUSTOM_MIN_SQFT, Math.floor(Number(v) || 0)))
const SHOWCASE_PACKAGES: Record<string, { label: string; price: string }> = {
  startup: { label: 'Startup Showcase', price: 'Rs 38,000' },
  growth: { label: 'Growth Showcase', price: 'Rs 1,49,000' },
  enterprise: { label: 'Enterprise Showcase', price: 'Rs 2,95,000' },
  custom: { label: 'Custom Booth', price: 'Rs 6,000 per sq ft, 200 sq ft minimum' },
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
    <img src="https://bharataiinnovation.com/ai-agent-summit/images/brand/logo-horizontal-dark.png" width="220" height="32" alt="AI Agent Summit" style="display:block;border:0;width:220px;height:auto;">
    <div style="font-family:Arial,sans-serif;font-size:22px;font-weight:bold;color:#ffffff;margin-top:16px;">${title}</div>
    <div style="font-family:Arial,sans-serif;font-size:13px;color:#a4aeb9;margin-top:4px;">${SUMMIT_WHEN}</div>
  </div>`
}

// The top of a summit payment page (checkout, result, the package pay page): the summit's
// own logo bar, not Bharat AI's, though the page is on bharataiinnovation.com (26 Nov 2026).
export function summitPageHeader(): string {
  return `<div style="background:#0d1013;padding:22px 24px;border-bottom:3px solid #c6ff3d;">
    <img src="https://bharataiinnovation.com/ai-agent-summit/images/brand/logo-horizontal-dark.png" width="200" height="29" alt="AI Agent Summit" style="display:block;border:0;width:200px;height:auto;">
    <div style="font-family:Arial,sans-serif;font-size:13px;color:#a4aeb9;margin-top:12px;">${SUMMIT_WHEN}</div>
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
      ['Date', 'Friday 16 April 2027, doors 08:30 IST'],
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
      h.payRows([['Event', SUMMIT_EVENT_NAME], ['Date', 'Friday 16 April 2027, doors 08:30 IST'], ['Venue', 'World Trade Center, Cuffe Parade, Mumbai']]) +
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
  if (isSummitPackageOrder(order)) return packagePayResult(c, order)
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
    "INSERT OR IGNORE INTO events (id, title, event_type, venue, start_date, end_date) VALUES (?, ?, 'conference', 'World Trade Center Mumbai', '2027-04-16', '2027-04-16')"
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
  const sqft = Math.floor(Number(String(b.booth_sqft ?? '').replace(/[^\d.]/g, '')) || 0)
  if (!SHOWCASE_PACKAGES[pkg]) errors.push({ field: 'package', message: 'Choose a showcase package.' })
  if (pkg === 'custom') {
    if (Date.now() > CUSTOM_BOOK_BY) errors.push({ field: 'package', message: 'Custom booths closed on 15 February 2027. Choose another package, or write to info@bharataiinnovation.com.' })
    else if (sqft < CUSTOM_MIN_SQFT || sqft > CUSTOM_MAX_SQFT) errors.push({ field: 'booth_sqft', message: 'Enter the booth size you want, from 200 to 2,000 sq ft. For a larger one, write to info@bharataiinnovation.com.' })
  }
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
  const priceText = pkg === 'custom'
    ? `${inrText(sqft)} sq ft at Rs ${inrText(CUSTOM_RATE_INR)} per sq ft: Rs ${inrText(sqft * CUSTOM_RATE_INR)}`
    : SHOWCASE_PACKAGES[pkg].price
  const meta = {
    edition: EDITION, package: pkg, package_label: SHOWCASE_PACKAGES[pkg].label, package_price: priceText,
    booth_sqft: pkg === 'custom' ? sqft : undefined,
    agent_name: agent, category, category_label: AGENT_CATEGORIES[category], stage: String(b.stage), stage_label: STAGES[String(b.stage)],
    website: text(b.website, 300), demo_url: text(b.demo_url, 300), live_demo: text(b.live_demo, 700), customers: text(b.customers, 300),
    founded_year: text(b.founded_year, 4), team_size: text(b.team_size, 20), city: text(b.city, 80), contact_role: text(b.contact_role, 100),
    heard_from: text(b.heard_from, 120), page: 'ai-agent-summit/showcase',
  }
  const message = [
    summary,
    '',
    'Package: ' + SHOWCASE_PACKAGES[pkg].label + ' (' + priceText + ' + GST)',
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
  return c.json({ ok: true, reference: 'AAS27-A' + id, message: `Application received for ${agent}. The evaluation committee reviews applications every week and will reply within five working days. Your reference is AAS27-A${id}.` }, 201)
})

const TIERS: Record<string, string> = { presenting: 'Presenting Partner (Rs 20,00,000)', platinum: 'Platinum (Rs 10,00,000)', gold: 'Gold (Rs 5,00,000)', 'add-on': 'An add-on or extra floor space', challenge: 'AI Agent Challenge partner', break: 'Break the agent booth partner' }

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
  return c.json({ ok: true, reference: 'AAS27-E' + id, message: `Thank you, ${titledName(name) || name}. Our partnerships team will reply within one working day with the partner deck and what is still open. Your reference is AAS27-E${id}.` }, 201)
})

// ---- The AI Agent Challenge and the problem board (26 Nov 2026) ----
// The organiser said yes to both: an online challenge before the summit, whose five
// finalists present free on the main stage at 19:00 on the day, and a board of real tasks
// that buyers want an agent for. A team is an inquiry 'agent_challenge', a problem an
// inquiry 'agent_problem', both on the Inquiries desk with the summit's other rows.
// Nothing goes on the public board until the team has read it and told the sender.
const CHALLENGE_REGISTER_BY = Date.parse('2027-01-31T23:59:59+05:30')
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const agreed = (v: unknown) => ['yes', 'on', 'true', '1'].includes(String(v || '').toLowerCase())
export const PROBLEM_SECTORS: Record<string, string> = {
  banking: 'Banking and financial services', insurance: 'Insurance', manufacturing: 'Manufacturing', retail: 'Retail and consumer goods',
  healthcare: 'Healthcare', it: 'IT and software', logistics: 'Logistics and travel', government: 'Government and public services', other: 'Another sector',
}

app.post('/api/agent-summit/challenge', async (c) => {
  const b = await c.req.json().catch(() => ({})) as any
  if (Date.now() > CHALLENGE_REGISTER_BY) {
    return c.json({ ok: false, error: 'Team registration for the AI Agent Challenge closed on 31 January 2027. For anything else, write to info@bharataiinnovation.com.' }, 400)
  }
  const team = text(b.team_name, 80)
  const name = text(b.name, 100)
  const email = text(b.email, 160).toLowerCase()
  const phone = text(b.phone, 30)
  const members = Math.floor(Number(b.members) || 0)
  const idea = text(b.idea, 700)
  const errors: { field: string; message: string }[] = []
  if (team.length < 2) errors.push({ field: 'team_name', message: 'Your team name is required.' })
  if (name.length < 2) errors.push({ field: 'name', message: 'Your name is required.' })
  if (!EMAIL_RE.test(email)) errors.push({ field: 'email', message: 'Enter a valid email address.' })
  if (phone.replace(/\D/g, '').length < 8) errors.push({ field: 'phone', message: 'Enter a valid phone number.' })
  if (members < 1 || members > 4) errors.push({ field: 'members', message: 'A team has one to four people.' })
  if (idea.length < 30) errors.push({ field: 'idea', message: idea ? 'Tell us a little more: at least 30 characters.' : 'Tell us what your agent will do.' })
  if (!agreed(b.eligible)) errors.push({ field: 'eligible', message: 'The challenge is for teams that have not raised outside funding.' })
  if (!agreed(b.consent)) errors.push({ field: 'consent', message: 'Please agree to the terms and privacy policy to continue.' })
  if (errors.length) return c.json({ ok: false, error: errors.length === 1 ? errors[0].message : 'Please check the highlighted fields.', errors }, 400)
  if (text(b.website_confirm, 200)) return c.json({ ok: true, reference: 'AAS27-RECEIVED', message: 'Thank you.' })
  if (await ipOver(c, 'summit.challenge', 20)) return c.json({ ok: false, error: 'Too many registrations from this connection. Please try again in an hour, or write to info@bharataiinnovation.com.' }, 429)
  const dupe = await c.env.DB.prepare(
    "SELECT id FROM inquiries WHERE inquiry_type = 'agent_challenge' AND lower(email) = ? AND lower(COALESCE(json_extract(metadata, '$.team_name'), '')) = lower(?) LIMIT 1"
  ).bind(email, team).first().catch(() => null) as any
  if (dupe) return c.json({ ok: true, already: true, reference: 'AAS27-C' + dupe.id, message: `Team ${team} is already registered from this email. Your reference is AAS27-C${dupe.id}.` })
  const meta = {
    edition: EDITION, kind: 'challenge', team_name: team, members, idea,
    org: text(b.org, 120), city: text(b.city, 80), problem: text(b.problem, 200), page: 'ai-agent-summit/challenge',
  }
  const message = [
    idea,
    '',
    'Team: ' + team + ' (' + members + (members === 1 ? ' person' : ' people') + ')',
    meta.org ? 'College or company: ' + meta.org : '',
    meta.city ? 'City: ' + meta.city : '',
    meta.problem ? 'Problem from the board: ' + meta.problem : '',
  ].filter((l, i) => l !== '' || i === 1).join('\n')
  const id = await saveInquiry(c, {
    type: 'agent_challenge', name, email, phone, organization: meta.org || team,
    subject: `AI Agent Summit 2027 · Challenge: ${team}`, message, metadata: meta,
  })
  await h.audit(c, 'summit.challenge', 'inquiry', id, { team, members }, { actor: 'public registration', kind: 'public' })
  return c.json({ ok: true, reference: 'AAS27-C' + id, message: `Team ${team} is registered for the AI Agent Challenge. We will email the full brief and how to submit to ${email}. Your reference is AAS27-C${id}.` }, 201)
})

app.post('/api/agent-summit/problem', async (c) => {
  const b = await c.req.json().catch(() => ({})) as any
  const name = text(b.name, 100)
  const email = text(b.email, 160).toLowerCase()
  const company = text(b.company, 120)
  const sector = String(b.sector || '')
  const problem = text(b.problem, 1500)
  const errors: { field: string; message: string }[] = []
  if (name.length < 2) errors.push({ field: 'name', message: 'Your name is required.' })
  if (!EMAIL_RE.test(email)) errors.push({ field: 'email', message: 'Enter a valid email address.' })
  if (company.length < 2) errors.push({ field: 'company', message: 'Your company is required. You can keep it off the board.' })
  if (!PROBLEM_SECTORS[sector]) errors.push({ field: 'sector', message: 'Choose the sector closest to yours.' })
  if (problem.length < 30) errors.push({ field: 'problem', message: problem ? 'Tell us a little more: at least 30 characters.' : 'Describe the task you want an agent to do.' })
  if (!agreed(b.consent)) errors.push({ field: 'consent', message: 'Please agree to the terms and privacy policy to continue.' })
  if (errors.length) return c.json({ ok: false, error: errors.length === 1 ? errors[0].message : 'Please check the highlighted fields.', errors }, 400)
  if (text(b.website_confirm, 200)) return c.json({ ok: true, reference: 'AAS27-RECEIVED', message: 'Thank you.' })
  if (await ipOver(c, 'summit.problem', 20)) return c.json({ ok: false, error: 'Too many problems from this connection. Please try again in an hour, or write to info@bharataiinnovation.com.' }, 429)
  const dupe = await c.env.DB.prepare(
    "SELECT id FROM inquiries WHERE inquiry_type = 'agent_problem' AND lower(email) = ? AND COALESCE(json_extract(metadata, '$.problem'), '') = ? LIMIT 1"
  ).bind(email, problem).first().catch(() => null) as any
  if (dupe) return c.json({ ok: true, already: true, reference: 'AAS27-P' + dupe.id, message: `We already have this problem from you. Your reference is AAS27-P${dupe.id}.` })
  const showName = agreed(b.show_name)
  const meta = {
    edition: EDITION, kind: 'problem', sector, sector_label: PROBLEM_SECTORS[sector], problem, volume: text(b.volume, 300),
    job_title: text(b.job_title, 100), show_name: showName, page: 'ai-agent-summit/problems',
  }
  const message = [
    problem,
    '',
    meta.volume ? 'How often or how much: ' + meta.volume : '',
    'Sector: ' + PROBLEM_SECTORS[sector],
    'Company name on the board: ' + (showName ? 'yes' : 'no, keep it off'),
    meta.job_title ? 'Title: ' + meta.job_title : '',
  ].filter((l, i) => l !== '' || i === 1).join('\n')
  const id = await saveInquiry(c, {
    type: 'agent_problem', name, email, phone: text(b.phone, 30), organization: company,
    subject: `AI Agent Summit 2027 · Problem: ${problem.length > 60 ? problem.slice(0, 57).trim() + '...' : problem}`, message, metadata: meta,
  })
  await h.audit(c, 'summit.problem', 'inquiry', id, { sector, show_name: showName }, { actor: 'public registration', kind: 'public' })
  return c.json({ ok: true, reference: 'AAS27-P' + id, message: `Thank you, ${titledName(name) || name}. We read every problem before it goes on the board, and we will email you before yours is published. Your reference is AAS27-P${id}.` }, 201)
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

export async function summitSales(c: any): Promise<{ registered: number; paid: number; passes_paid: number; packages_paid: number; paise: number; review: number; applications: number; applications_new: number; partners: number }> {
  const one = async (sql: string, ...v: any[]) => Number(((await c.env.DB.prepare(sql).bind(...v).first().catch(() => null)) as any)?.n || 0)
  return {
    registered: await one('SELECT COUNT(*) AS n FROM attendees WHERE event_id = ?', SUMMIT_EVENT_ID),
    paid: await one("SELECT COUNT(DISTINCT attendee_id) AS n FROM payment_orders WHERE event_id = ? AND status = 'paid'", SUMMIT_EVENT_ID),
    paise: await one("SELECT COALESCE(SUM(amount_paise), 0) AS n FROM payment_orders WHERE event_id = ? AND status = 'paid'", SUMMIT_EVENT_ID),
    // Showcase packages (26 Nov 2026) are in paid and paise; the desk shows them apart from the passes.
    passes_paid: await one(`SELECT COUNT(DISTINCT attendee_id) AS n FROM payment_orders WHERE event_id = ? AND status = 'paid' AND pass_type NOT IN (${PACKAGE_LABELS_SQL})`, SUMMIT_EVENT_ID),
    packages_paid: await one(`SELECT COUNT(*) AS n FROM payment_orders WHERE event_id = ? AND status = 'paid' AND pass_type IN (${PACKAGE_LABELS_SQL})`, SUMMIT_EVENT_ID),
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
      demo_url: m.demo_url || '', website: m.website || '', summary: String(r.message || '').split('\n')[0],
      package_key: m.package || '', accepted_at: m.accepted_at || null, accepted_package: m.accepted_package || '', link_sent_at: m.link_sent_at || null,
      sqft: Number(m.accepted_sqft || m.booth_sqft) || 0,
      price_inr: owedPrice(m, SUMMIT_PACKAGES[m.accepted_package] ? m.accepted_package : m.package || ''), paid_at: m.paid_at || null, paid_paise: Number(m.paid_paise) || 0 }
  })
  const partners = ((((await db.prepare(
    `SELECT id, created_at, name, email, phone, organization, subject, status, metadata FROM inquiries WHERE inquiry_type = 'sponsorship' AND subject LIKE 'AI Agent Summit 2027%' ORDER BY id DESC LIMIT 500`
  ).all()) as any).results || []) as any[]).map((r) => {
    const m = parse(r.metadata)
    return { id: r.id, created_at: r.created_at, name: r.name, email: r.email, phone: r.phone, company: r.organization, status: r.status,
      tier: String(r.subject || '').replace(/^AI Agent Summit 2027 · Partner: /, ''), job_title: m.job_title || '' }
  })
  const sold = await packagesSold(c)
  const packages = Object.fromEntries(Object.entries(SUMMIT_PACKAGES).filter(([, p]) => !p.retired).map(([k, p]) => [k, {
    label: p.label, inr: p.inr, early: null, per_sqft: p.perSqft || null, min_sqft: p.perSqft ? CUSTOM_MIN_SQFT : null,
    slots: p.slots || null, shares: p.shares || null, sold: sold[p.label] || 0 }]))
  return c.json({ sales: await summitSales(c), passes, applications, partners, prices: SUMMIT_PASS_PRICES_INR, packages })
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
    P(`Your <strong>${esc(a.badge_type)}</strong> for ${SUMMIT_EVENT_NAME} is confirmed. It is complimentary and includes a reserved seat in the main hall, lunch, the VIP lounge, the cocktail evening and help meeting the companies you choose.`) +
    h.payRows([['Event', SUMMIT_EVENT_NAME], ['Date', 'Friday 16 April 2027, doors 08:30 IST'], ['Venue', 'World Trade Center, Cuffe Parade, Mumbai']]) +
    P('In the week before the summit we will email your entry pass and the final programme, with the list of companies on stage.') +
    `<div style="text-align:center;margin:0 0 6px;"><a href="https://bharataiinnovation.com/ai-agent-summit/ai-agent-summit-2027.ics" style="display:inline-block;padding:12px 26px;background:#c6ff3d;color:#07080a;text-decoration:none;border-radius:4px;font-weight:bold;font-size:14px;">Save the date</a></div>`)
  const sent = h.sendEmail(c, a.email, `Confirmed: your ${a.badge_type} for ${SUMMIT_EVENT_NAME}`, h.noAppOnPhone(html), { unsubscribe: false })
    .catch((e: any) => console.error('summit confirm email failed', a.email, e?.message))
  try { c.executionCtx.waitUntil(sent) } catch { await sent }
  return c.json({ ok: true })
})

// ==================== SHOWCASE PACKAGES: accepted, then paid online (26 Nov 2026) ====================
//
// The organiser, 26 Nov 2026: yes to online payment for accepted showcase packages, in this
// app. The team accepts an application on Admin -> AI Agent Summit; the company is emailed a
// signed link to /pay/summit-showcase, adds its GST details there and pays through the same
// CCAvenue checkout as the passes. The order is an event-3 payment_orders row whose pass_type
// is the package name: settlePaidOrder (index.tsx) hands it to settleSummitPackageOrder, never
// to the pass path. No new table: acceptance and payment are on the application's metadata
// (accepted_at, accepted_package, accepted_inr, link_sent_at, last_order, paid_at, paid_order,
// paid_paise) and in admin_audit (summit.accept, summit.package.order, payment.received).
// A link stays good for PACKAGE_LINK_DAYS; Resend on the desk makes a new one.

// The commercials of 26 Nov 2026: the day has 50 ten-minute slots, 44 of them for showcase
// companies (the other 6 are the Platinum keynotes and the Gold talks). `slots` is how many
// of the 44 a package may take; a custom booth takes an Enterprise slot (`shares`). The
// Startup Showcase was Rs 79,000 (Rs 64,000 early) until that day. `retired` keeps a package
// that was sold before then payable and settleable, and off the form and the desk.
export const SUMMIT_PACKAGES: Record<string, { label: string; inr: number; stage: boolean; space: string; passes: string; slots?: number; shares?: string; perSqft?: number; retired?: boolean }> = {
  startup: { label: 'Startup Showcase', inr: 38000, stage: true, space: '24 sq ft pod', passes: '2 team passes', slots: 20 },
  growth: { label: 'Growth Showcase', inr: 149000, stage: true, space: '43 sq ft booth', passes: '4 team passes (1 VIP)', slots: 14 },
  enterprise: { label: 'Enterprise Showcase', inr: 295000, stage: true, space: '65 sq ft booth', passes: '6 team passes (2 VIP)', slots: 10 },
  custom: { label: 'Custom Booth', inr: CUSTOM_RATE_INR * CUSTOM_MIN_SQFT, perSqft: CUSTOM_RATE_INR, stage: true, space: 'custom booth', passes: '6 team passes (2 VIP)', shares: 'enterprise' },
  pod: { label: 'Showcase Pod', inr: 38000, stage: false, space: '24 sq ft pod', passes: '1 team pass', retired: true },
}
const PACKAGE_BY_LABEL: Record<string, string> = Object.fromEntries(Object.entries(SUMMIT_PACKAGES).map(([k, p]) => [p.label, k]))
const PACKAGE_LABELS_SQL = Object.values(SUMMIT_PACKAGES).map((p) => "'" + p.label.replace(/'/g, "''") + "'").join(', ')
const PACKAGE_LINK_DAYS = 30
const STAGE_CAP_KEY = 'summit_stage_cap'
const STAGE_CAP_DEFAULT = 44
const PACKAGE_PAY_PATH = '/pay/summit-showcase'

export function isSummitPackageOrder(o: any): boolean { return isSummitOrder(o) && !!PACKAGE_BY_LABEL[String(o?.pass_type || '')] }

// The list price: fixed, or for a custom booth its size (200 sq ft at least) at Rs 6,000 a sq ft.
export function packagePrice(key: string, sqft?: any): number {
  const p = SUMMIT_PACKAGES[key]
  if (!p) return 0
  return p.perSqft ? p.perSqft * customSqft(sqft) : p.inr
}
// What an accepted application pays: the price it was accepted at, and for a fixed package
// never more than today's list price (a Startup Showcase accepted at Rs 79,000 pays Rs 38,000).
function owedPrice(m: any, key: string): number {
  const p = SUMMIT_PACKAGES[key]
  if (!p) return 0
  const list = packagePrice(key, m?.accepted_sqft || m?.booth_sqft)
  const agreed = Number(m?.accepted_inr) || 0
  if (!agreed) return list
  return p.perSqft ? agreed : Math.min(agreed, list)
}
function packageAmounts(inr: number) {
  const base = inr * 100
  const gst = Math.round(base * h.consts().PASS_GST_RATE / 100)
  return { base, gst, total: base + gst }
}
const inrText = (n: number) => Number(n).toLocaleString('en-IN')
const parseMeta = (m: any) => { try { return JSON.parse(m || '{}') || {} } catch { return {} } }
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

async function packageToken(c: any, inquiryId: number): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + PACKAGE_LINK_DAYS * 86400
  const sig = await h.sign(c, 'summit-package:' + inquiryId + ':' + exp)
  return inquiryId + '.' + exp + '.' + sig.slice(0, 32)
}
async function packageTokenId(c: any, token: unknown): Promise<number> {
  const m = /^(\d{1,9})\.(\d{9,11})\.([0-9a-f]{32})$/.exec(String(token || ''))
  if (!m || Number(m[2]) * 1000 < Date.now()) return 0
  const want = (await h.sign(c, 'summit-package:' + m[1] + ':' + m[2])).slice(0, 32)
  return want && sameText(want, m[3]) ? Number(m[1]) : 0
}
async function packageLink(c: any, inquiryId: number): Promise<string> {
  return (await checkoutBase(c)) + PACKAGE_PAY_PATH + '?t=' + encodeURIComponent(await packageToken(c, inquiryId))
}
async function applicationRow(c: any, id: number): Promise<any | null> {
  if (!id) return null
  return await c.env.DB.prepare("SELECT * FROM inquiries WHERE id = ? AND inquiry_type = 'agent_showcase'").bind(id).first().catch(() => null)
}
async function stageCap(c: any): Promise<number> {
  const v = parseInt(await h.settingValue(c, STAGE_CAP_KEY), 10)
  return Number.isFinite(v) && v >= 0 ? v : STAGE_CAP_DEFAULT
}
async function stagePaid(c: any): Promise<number> {
  const labels = Object.values(SUMMIT_PACKAGES).filter((p) => p.stage).map((p) => p.label)
  const r = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM payment_orders WHERE event_id = ? AND status = 'paid' AND pass_type IN (${labels.map(() => '?').join(', ')})`
  ).bind(SUMMIT_EVENT_ID, ...labels).first() as any
  return Number(r?.n || 0)
}
// A package's own slots are all paid for (Startup 20, Growth 14, Enterprise with custom booths
// 10): app_settings.summit_cap_<package> changes a number without a deploy.
async function tierFull(c: any, key: string): Promise<boolean> {
  const group = SUMMIT_PACKAGES[key]?.shares || key
  const slots = SUMMIT_PACKAGES[group]?.slots
  if (!slots) return false
  const set = parseInt(await h.settingValue(c, 'summit_cap_' + group), 10)
  const limit = Number.isFinite(set) && set >= 0 ? set : slots
  const labels = Object.entries(SUMMIT_PACKAGES).filter(([k, p]) => k === group || p.shares === group).map(([, p]) => p.label)
  const r = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM payment_orders WHERE event_id = ? AND status = 'paid' AND pass_type IN (${labels.map(() => '?').join(', ')})`
  ).bind(SUMMIT_EVENT_ID, ...labels).first() as any
  return Number(r?.n || 0) >= limit
}
async function packagesSold(c: any): Promise<Record<string, number>> {
  const out = await c.env.DB.prepare(
    `SELECT pass_type, COUNT(*) AS n FROM payment_orders WHERE event_id = ? AND status = 'paid' AND pass_type IN (${PACKAGE_LABELS_SQL}) GROUP BY pass_type`
  ).bind(SUMMIT_EVENT_ID).all().catch(() => ({ results: [] })) as any
  return Object.fromEntries(((out?.results || []) as any[]).map((r) => [String(r.pass_type), Number(r.n) || 0]))
}
function includesLine(key: string, sqft: any = 0): string {
  const p = SUMMIT_PACKAGES[key]
  const space = p.perSqft ? inrText(customSqft(sqft)) + ' sq ft custom booth' : p.space
  // Every team pass includes lunch and the cocktail evening (the organiser, 26 Nov 2026).
  return p.stage
    ? `A ten-minute slot on the main stage, a ${space} for the day, ${p.passes} with lunch and the cocktail evening, and the edited video of your demo`
    : `A ${p.space} on the showcase floor for the day, and ${p.passes} with lunch and the cocktail evening`
}

// Admin: accept an application, or send its link again. Body: { package?: key, sqft?: number, send?: false }.
app.post('/api/admin/agent-summit/applications/:id/accept', async (c) => {
  const id = Number(c.req.param('id'))
  const r = await applicationRow(c, id)
  if (!r) return c.json({ error: 'No AI Agent Summit showcase application with that id.' }, 404)
  const m = parseMeta(r.metadata)
  if (m.paid_at) return c.json({ ok: true, paid: true, error: 'This application is paid already.' })
  const b = await c.req.json().catch(() => ({})) as any
  const onSale = (k: any) => !!SUMMIT_PACKAGES[String(k || '')] && !SUMMIT_PACKAGES[String(k)].retired
  const key = onSale(b.package) ? String(b.package)
    : SUMMIT_PACKAGES[m.accepted_package] ? String(m.accepted_package)
    : onSale(m.package) ? String(m.package) : ''
  if (!key) return c.json({ error: 'Choose the package to accept them for.' }, 400)
  const sqft = SUMMIT_PACKAGES[key].perSqft ? customSqft(b.sqft ?? m.accepted_sqft ?? m.booth_sqft) : 0
  const price = packagePrice(key, sqft)
  const link = await packageLink(c, id)
  const resend = !!m.accepted_at
  const send = b.send !== false
  await c.env.DB.prepare(
    `UPDATE inquiries SET metadata = json_set(COALESCE(metadata, '{}'), '$.accepted_at', COALESCE(json_extract(metadata, '$.accepted_at'), datetime('now')),
       '$.accepted_package', ?, '$.accepted_inr', ?, '$.accepted_sqft', ?, '$.link_sent_at', datetime('now')),
       status = CASE WHEN status IN ('new', 'responded') THEN 'in_progress' ELSE status END
     WHERE id = ?`
  ).bind(key, price, sqft || null, id).run()
  await h.audit(c, 'summit.accept', 'inquiry', id, { package: key, price_inr: price, sqft: sqft || undefined, resend, emailed: send })
  if (send) {
    const esc = h.payEsc
    const p = SUMMIT_PACKAGES[key]
    const a = packageAmounts(price)
    const agent = String(m.agent_name || r.organization || 'your agent')
    const html = summitMail(resend ? 'Your payment link' : 'You are on the stage',
      `<p style="margin:0 0 6px;font-size:15px;color:#333;">Hi <strong>${esc(titledName(r.name) || 'there')}</strong>,</p>` +
      P(resend
        ? `Here is the link again to pay for <strong>${esc(agent)}</strong>'s ${esc(p.label)} at ${SUMMIT_EVENT_NAME}.`
        : `Good news: <strong>${esc(agent)}</strong> is accepted for ${SUMMIT_EVENT_NAME}, with the ${esc(p.label)}. Your place is confirmed when the payment arrives.`) +
      h.payRows([
        ['Company', esc(r.organization || '')],
        ['Package', esc(p.label)],
        ['Includes', esc(includesLine(key, sqft))],
        ['Price', `&#8377;${inrText(price)} + ${h.consts().PASS_GST_RATE}% GST = <strong>&#8377;${h.rupees(a.total)}</strong>`],
        ['Date', 'Friday 16 April 2027, World Trade Center Mumbai'],
      ]) +
      `<div style="text-align:center;margin:0 0 20px;"><a href="${esc(link)}" style="display:inline-block;padding:13px 28px;background:#c6ff3d;color:#07080a;text-decoration:none;border-radius:4px;font-weight:bold;font-size:15px;">Pay online and confirm</a></div>` +
      P(`The link works for ${PACKAGE_LINK_DAYS} days. You add your GST details on the page, and the GST invoice is made out to your company. If your finance team needs a proforma invoice or prefers a bank transfer, reply to this email and we will send one.`))
    const sent = h.sendEmail(c, r.email, (resend ? 'Payment link: ' : 'Accepted: ') + agent + ' at ' + SUMMIT_EVENT_NAME, h.noAppOnPhone(html), { unsubscribe: false })
      .catch((e: any) => console.error('summit accept email failed', r.email, e?.message))
    try { c.executionCtx.waitUntil(sent) } catch { await sent }
  }
  return c.json({ ok: true, link, package: SUMMIT_PACKAGES[key].label, sqft: sqft || null, price_inr: price, total_inr: packageAmounts(price).total / 100, resend, emailed: send })
})

// The pay page the email links to, and its form.
function packagePage(c: any, title: string, body: string, status = 200) {
  c.header('Cache-Control', 'no-store')
  c.header('X-Robots-Tag', 'noindex')
  return c.html(h.payPage(title, body, 'summit'), status)
}
function packageForm(token: string, r: any, m: any, key: string, price: number, fill: any, error = ''): string {
  const esc = h.payEsc
  const p = SUMMIT_PACKAGES[key]
  const a = packageAmounts(price)
  const field = 'width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #cfd3da;border-radius:8px;font-size:14px;margin:0 0 12px;font-family:inherit;'
  const label = 'display:block;font-size:13px;font-weight:bold;color:#333;margin:0 0 5px;'
  return h.payH1('Pay for your ' + esc(p.label)) +
    h.payP(`<strong>${esc(m.agent_name || r.organization || '')}</strong> is accepted for ${SUMMIT_EVENT_NAME}, Friday 16 April 2027 at World Trade Center Mumbai.`) +
    h.payRows([
      ['Company', esc(r.organization || '')],
      ['Package', esc(p.label)],
      ['Includes', esc(includesLine(key, m.accepted_sqft))],
      ['Price', `&#8377;${inrText(price)}`],
      [`GST (${h.consts().PASS_GST_RATE}%)`, `&#8377;${h.rupees(a.gst)}`],
      ['To pay', `&#8377;${h.rupees(a.total)}`],
    ]) +
    (error ? `<p role="alert" style="margin:0 0 14px;padding:10px 12px;border-radius:8px;background:#fdecea;color:#8a1c12;font-size:14px;line-height:1.5;">${esc(error)}</p>` : '') +
    `<form method="post" action="${PACKAGE_PAY_PATH}" style="margin:6px 0 0;">` +
    `<input type="hidden" name="t" value="${esc(token)}">` +
    `<p style="margin:0 0 12px;font-size:14px;color:#444;line-height:1.6;">The GST invoice is made out to these details.</p>` +
    `<label for="ln" style="${label}">Registered company name</label><input id="ln" name="legal_name" required maxlength="160" autocomplete="organization" value="${esc(fill.legal_name ?? r.organization ?? '')}" style="${field}">` +
    `<label for="gs" style="${label}">GSTIN <span style="font-weight:normal;color:#777;">(leave empty if you have none)</span></label><input id="gs" name="gstin" maxlength="20" placeholder="27AAACB1234C1Z5" value="${esc(fill.gstin ?? '')}" style="${field}text-transform:uppercase;">` +
    `<label for="ad" style="${label}">Billing address <span style="font-weight:normal;color:#777;">(needed with a GSTIN)</span></label><textarea id="ad" name="address" rows="3" maxlength="400" autocomplete="street-address" style="${field}">${esc(fill.address ?? '')}</textarea>` +
    `<button type="submit" style="width:100%;padding:14px 24px;background:#c6ff3d;color:#07080a;border:0;border-radius:9px;font-size:16px;font-weight:bold;cursor:pointer;">Pay &#8377;${h.rupees(a.total)} securely</button>` +
    `</form>` +
    `<p style="font-size:12px;line-height:1.6;color:#777;margin:14px 0 0;">Payments are handled by CCAvenue: card, UPI and net banking details are entered on their page and never reach this site. For a proforma invoice or a bank transfer, write to info@bharataiinnovation.com.</p>`
}
async function packageFromToken(c: any, token: unknown): Promise<{ r: any; m: any; key: string; price: number } | null> {
  const r = await applicationRow(c, await packageTokenId(c, token))
  if (!r) return null
  const m = parseMeta(r.metadata)
  const key = String(m.accepted_package || '')
  if (!m.accepted_at || !SUMMIT_PACKAGES[key]) return null
  return { r, m, key, price: owedPrice(m, key) }
}
const linkGone = (c: any) => packagePage(c, 'Link not valid', h.payH1('That payment link is not valid any more.') +
  h.payP('Nothing has been charged. Links work for ' + PACKAGE_LINK_DAYS + ' days: write to info@bharataiinnovation.com or call +91 89765 80367 and we will send a new one.'), 404)
const paidAlready = (c: any, m: any) => packagePage(c, 'Paid', h.payH1('This package is paid. Thank you.') +
  h.payP('The payment for ' + h.payEsc(m.agent_name || 'this application') + ' arrived' + (m.paid_at ? ' on ' + h.istStamp(m.paid_at) : '') + '. The confirmation and receipt went to your email.') +
  h.payButton(SUMMIT_PAGE, 'Back to the AI Agent Summit'))

app.get(PACKAGE_PAY_PATH, async (c) => {
  const t = String(c.req.query('t') || '')
  const x = await packageFromToken(c, t)
  if (!x) return linkGone(c)
  if (x.m.paid_at) return paidAlready(c, x.m)
  return packagePage(c, 'Pay for your showcase', packageForm(t, x.r, x.m, x.key, x.price, {}))
})

app.post(PACKAGE_PAY_PATH, async (c) => {
  const f = await c.req.parseBody().catch(() => ({})) as Record<string, any>
  const t = String(f.t || '')
  const x = await packageFromToken(c, t)
  if (!x) return linkGone(c)
  const { r, m, key, price } = x
  if (m.paid_at) return paidAlready(c, m)
  const again = (msg: string, status = 400) => packagePage(c, 'Pay for your showcase', packageForm(t, r, m, key, price, f, msg), status)
  if (!(await h.onlinePaymentsOn(c))) return again('Online payment is not available just now. Please try again in a little while, or write to info@bharataiinnovation.com for a bank transfer.', 503)
  const billed = h.cleanBilling({ legal_name: f.legal_name, gstin: f.gstin, address: f.address })
  if ('error' in billed) return again(billed.error)
  if (!billed.billing) return again('Add the registered company name for the GST invoice.')
  if (SUMMIT_PACKAGES[key].stage && (await stagePaid(c)) >= (await stageCap(c))) {
    return again('All the stage slots have been paid for. Write to info@bharataiinnovation.com: we will tell you if one comes free.', 409)
  }
  if (await tierFull(c, key)) {
    return again('All the ' + SUMMIT_PACKAGES[SUMMIT_PACKAGES[key].shares || key].label + ' slots have been paid for. Write to info@bharataiinnovation.com: we will tell you if one comes free, or offer another package.', 409)
  }
  // The contact as an event-3 attendee: the order, receipt and invoice hang off one.
  const email = String(r.email || '').trim().toLowerCase()
  const pick = () => c.env.DB.prepare('SELECT * FROM attendees WHERE event_id = ? AND lower(email) = ? ORDER BY id LIMIT 1').bind(SUMMIT_EVENT_ID, email).first()
  let a = await pick() as any
  if (!a) {
    await ensureSummitEvent(c)
    try {
      const made = await c.env.DB.prepare(
        `INSERT INTO attendees (event_id, name, email, company, job_title, mobile, city, industry, lunch_inclusion, badge_type, payment_status, registration_source, registration_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, '', 'No', 'Visitor Pass', 'paid', 'agent-summit-showcase', datetime('now'))`
      ).bind(SUMMIT_EVENT_ID, text(r.name, 100), email, text(r.organization, 120), text(m.contact_role, 100), text(r.phone, 30), text(m.city, 80)).run()
      a = await c.env.DB.prepare('SELECT * FROM attendees WHERE id = ?').bind(made.meta.last_row_id).first()
    } catch (e: any) {
      if (!String(e?.message || '').includes('UNIQUE')) {
        console.error('summit package attendee failed', email, e?.message)
        return again('We could not start the payment. Nothing was charged. Please try again, or write to info@bharataiinnovation.com.', 500)
      }
      a = await pick()
    }
  }
  if (!a) return again('We could not start the payment. Nothing was charged. Please try again.', 500)
  const recent = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM payment_orders WHERE attendee_id = ? AND event_id = ? AND created_at > datetime('now', '-1 hour')"
  ).bind(a.id, SUMMIT_EVENT_ID).first() as any
  if (Number(recent?.n || 0) >= h.consts().PAY_ORDERS_PER_HOUR) return again('That is a lot of payment attempts in one hour. Please wait a little, or write to info@bharataiinnovation.com.', 429)
  await h.saveBilling(c, a.id, billed.billing)
  const amounts = packageAmounts(price)
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(4))).map(b => (b % 36).toString(36)).join('')
  const orderId = ('BAI' + a.id + '-' + Date.now().toString(36) + rand).toUpperCase()
  await c.env.DB.prepare(
    'INSERT INTO payment_orders (order_id, attendee_id, event_id, pass_type, previous_badge, base_paise, gst_paise, amount_paise) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(orderId, a.id, SUMMIT_EVENT_ID, SUMMIT_PACKAGES[key].label, a.badge_type || '', amounts.base, amounts.gst, amounts.total).run()
  await c.env.DB.prepare("UPDATE inquiries SET metadata = json_set(COALESCE(metadata, '{}'), '$.last_order', ?) WHERE id = ?").bind(orderId, r.id).run()
  await h.audit(c, 'summit.package.order', 'inquiry', r.id, { order_id: orderId, package: key, amount_paise: amounts.total, attendee: a.id }, { actor: 'showcase pay link', kind: 'public' })
  return c.redirect((await checkoutBase(c)) + '/pay/ccavenue/' + await h.payLinkToken(c, orderId), 303)
})

// The money has arrived for a package: the application is marked paid (Won on the Enquiries
// desk), the contact's free pass becomes Exhibitor, then the receipt and both emails.
export async function settleSummitPackageOrder(c: any, order: any, trackingId: string, paymentMode: string) {
  const a = await c.env.DB.prepare('SELECT * FROM attendees WHERE id = ?').bind(order.attendee_id).first() as any
  if (!a) throw new Error('attendee ' + order.attendee_id + ' no longer exists')
  const key = PACKAGE_BY_LABEL[String(order.pass_type)]
  const p = SUMMIT_PACKAGES[key]
  const badge = String(a.badge_type || '').trim()
  const { FREE_BADGE_RE } = h.consts()
  const freeLike = !badge || FREE_BADGE_RE.test(badge) || ['Visitor Pass', 'Buyer Pass', 'Investor Pass'].includes(badge)
  if (freeLike) {
    await c.env.DB.prepare("UPDATE attendees SET badge_type = 'Exhibitor', payment_status = 'paid' WHERE id = ? AND event_id = ?").bind(a.id, SUMMIT_EVENT_ID).run()
  }
  const app_ = await c.env.DB.prepare(
    "SELECT * FROM inquiries WHERE inquiry_type = 'agent_showcase' AND json_extract(metadata, '$.last_order') = ? LIMIT 1"
  ).bind(order.order_id).first().catch(() => null) as any
  const m = parseMeta(app_?.metadata)
  if (app_) {
    await c.env.DB.prepare(
      `UPDATE inquiries SET status = 'won', metadata = json_set(COALESCE(metadata, '{}'), '$.paid_at', datetime('now'), '$.paid_order', ?, '$.paid_paise', ?) WHERE id = ?`
    ).bind(order.order_id, Number(order.amount_paise), app_.id).run()
  }
  await h.audit(c, 'payment.received', 'attendee', a.id, {
    order_id: order.order_id, tracking_id: trackingId, pass_type: order.pass_type, amount_paise: order.amount_paise,
    payment_mode: paymentMode, badge: freeLike ? [badge || null, 'Exhibitor'] : 'left as ' + badge, summit_application: app_?.id ?? null,
  }, { actor: 'CCAvenue', kind: 'gateway' })

  const mails = (async () => {
    const receipt = await h.receiptForOrder(c, order, a, trackingId)
    try {
      const esc = h.payEsc
      const amount = h.rupees(Number(order.amount_paise))
      const agent = String(m.agent_name || app_?.organization || a.company || '')
      const next = [
        p.stage ? 'Your block and time on stage: we email them by early March, once the programme is set.' : 'Your pod position: we email the floor plan by early March.',
        p.passes
          ? `Your ${p.passes}, each with lunch and the cocktail evening: reply to this email with the names, and we send each person their entry pass in the week before the summit.`
          : 'Reply to this email with the names of the people staffing your pod, and we send each of them an entry pass in the week before the summit.',
        p.stage ? 'Early April: an online rehearsal with our A/V team. Please send us a backup screen recording of your demo by 10 April.' : '',
        'Your logo and a two-line description for the summit\'s agent directory: reply with them when you can.',
      ].filter(Boolean)
      const html = summitMail('Payment received',
        `<p style="margin:0 0 6px;font-size:15px;color:#333;">Hi <strong>${esc(titledName(app_?.name || a.name) || 'there')}</strong>,</p>` +
        P(`Thank you. The payment has arrived and <strong>${esc(agent)}</strong>'s ${esc(p.label)} at ${SUMMIT_EVENT_NAME} is confirmed.`) +
        h.payRows([
          ['Package', esc(p.label)],
          ['Includes', esc(includesLine(key, m.accepted_sqft))],
          ['Date', 'Friday 16 April 2027, doors 08:30 IST'],
          ['Venue', 'World Trade Center, Cuffe Parade, Mumbai'],
          ['Amount paid', `&#8377;${amount} <span style="font-weight:normal;color:#666;">(includes ${h.consts().PASS_GST_RATE}% GST)</span>`],
          ['Order number', esc(order.order_id)],
          ['CCAvenue reference', esc(trackingId)],
        ]) +
        P('<strong>What happens next</strong>') +
        `<ul style="margin:0 0 16px 18px;padding:0;font-size:14px;line-height:1.7;color:#444;">${next.map((l) => '<li>' + l + '</li>').join('')}</ul>` +
        (receipt
          ? P(`Receipt <strong>${esc(receipt.invoice_no)}</strong>: <a href="${esc(receipt.url)}" style="color:#3a5a00;font-weight:bold;">view the receipt</a>. Your GST invoice follows separately.`)
          : P('Your receipt and GST invoice follow separately.')) +
        `<div style="text-align:center;margin:0 0 6px;"><a href="https://bharataiinnovation.com/ai-agent-summit/ai-agent-summit-2027.ics" style="display:inline-block;padding:12px 26px;background:#c6ff3d;color:#07080a;text-decoration:none;border-radius:4px;font-weight:bold;font-size:14px;">Save the date</a></div>`)
      await h.sendEmail(c, a.email, `Payment received: ${p.label} at ${SUMMIT_EVENT_NAME}`, h.noAppOnPhone(html), { unsubscribe: false })
      await h.sendEmail(c, await teamAddress(c), `Showcase paid, AI Agent Summit: ${agent}${app_?.organization ? ', ' + app_.organization : ''}, ${p.label}, Rs ${amount}`,
        `<div style="font-family:Arial,sans-serif;max-width:560px;font-size:14px;line-height:1.6;color:#333;"><p style="margin:0 0 12px;"><strong>${esc(app_?.organization || a.company || '')}</strong> has paid for the <strong>${esc(p.label)}</strong> (${esc(agent)}): &#8377;${amount} including GST, order ${esc(order.order_id)}, CCAvenue ${esc(trackingId)}${paymentMode ? ' (' + esc(paymentMode) + ')' : ''}.</p>` +
        `<p style="margin:0 0 12px;">Contact: ${esc(app_?.name || a.name)}, ${esc(a.email)}${app_?.phone ? ', ' + esc(app_.phone) : ''}.${receipt ? ' Receipt ' + esc(receipt.invoice_no) + '.' : ' <strong>No receipt was raised automatically: raise it by hand.</strong>'}</p>` +
        `<p style="margin:0;color:#555;">Admin &rarr; AI Agent Summit &rarr; Showcase applications shows it as paid${app_ ? ' (application #' + esc(app_.id) + ')' : ''}.</p></div>`, { unsubscribe: false })
    } catch (e: any) { console.error('summit package emails failed', order?.order_id, e?.message) }
  })()
  let scheduled = false
  try { c.executionCtx.waitUntil(mails); scheduled = true } catch { /* no ctx */ }
  if (!scheduled) await mails
}

// The result page for a package order (summitPayResult sends it here).
async function packagePayResult(c: any, order: any) {
  const esc = h.payEsc
  const no = esc(order.order_id)
  const page = (title: string, body: string) => c.html(h.payPage(title, body, 'summit'))
  const app_ = await c.env.DB.prepare(
    "SELECT id FROM inquiries WHERE inquiry_type = 'agent_showcase' AND json_extract(metadata, '$.last_order') = ? LIMIT 1"
  ).bind(order.order_id).first().catch(() => null) as any
  const retry = app_ ? h.payButton(await packageLink(c, Number(app_.id)), 'Try again') : h.payP('Write to info@bharataiinnovation.com and we will send a new payment link.')
  if (order.status === 'paid') {
    return page('Payment received', h.payH1('Payment received. Thank you.') +
      h.payP(`Your <strong>${esc(order.pass_type)}</strong> at ${SUMMIT_EVENT_NAME} is confirmed.`) +
      h.payRows([
        ['Amount paid', `&#8377;${h.rupees(Number(order.amount_paise))} <span style="font-weight:normal;color:#666;">(includes GST)</span>`],
        ['Order number', no],
        ['CCAvenue reference', esc(order.tracking_id)],
      ]) +
      h.payP('The confirmation, with what happens next, and your receipt are on their way to your email. The GST invoice follows separately.') +
      h.payButton(SUMMIT_PAGE + 'ai-agent-summit-2027.ics', 'Save the date'))
  }
  if (order.status === 'awaited') {
    return page('Waiting for your bank', h.payH1('Your bank has not confirmed yet.') +
      h.payP('Please do not pay a second time. If the money has left your account, the package is confirmed as soon as the bank reports it.') +
      h.payP(`If nothing has changed in a day, write to info@bharataiinnovation.com quoting order <strong>${no}</strong>.`))
  }
  if (order.status === 'mismatch') {
    return page('We are checking this payment', h.payH1('We need to check this payment.') +
      h.payP(`The amount the payment gateway reported is not the package price. Our team has been told and will write to you. Your order number is <strong>${no}</strong>.`))
  }
  return page('Payment not completed', h.payH1(order.status === 'aborted' ? 'You cancelled the payment.' : order.status === 'created' ? 'We have not heard back about this payment.' : 'The payment did not go through.') +
    h.payP('Nothing has been confirmed for this order. If money left your account, your bank returns it on its own; if it has not come back within a week, write to info@bharataiinnovation.com quoting order <strong>' + no + '</strong>.') + retry)
}

export default app
