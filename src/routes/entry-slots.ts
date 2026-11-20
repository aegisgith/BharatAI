import { Hono } from 'hono'

// ==================== ENTRY TIMES FOR THE FREE VISITOR PASS (17 Nov 2026) ====================
//
// The organiser, three days out: "plan the free pass registered users time slot for entry
// for two days so we can manage crowd properly and everybody gets chance to attend; we will
// need some crowd as backup in morning on 20th, after that distribute in two days". Then:
// "check cities as well ... people from outside are less likely to come", "we can also give
// access to those who are wait listed and send them notification on 19th morning", "rest we
// can send info tonight and tomorrow". This keeps the promise of 28 Oct (FREE_ENTRY_TEXT:
// "you may be offered a half-day slot, or none").
//
// Every free pass holder gets one entry time, written to attendees.entry_slot (0056) as the
// words they are told. The rule (planSlots, pure, checked by smoke-entry-slots.mjs):
//   - lives outside Mumbai and the Thane / Navi Mumbai side: either day, any time (few of
//     them come, and they travel);
//   - in Mumbai, the Thane side or no city given, and said "I'm coming" or has the pass on
//     the phone: Friday morning, the opening (the backup crowd); so does anyone from the
//     same company or college as one of them, so they come together;
//   - the rest of Mumbai: shared out evenly over Friday afternoon, Saturday morning and
//     Saturday afternoon, a company or college kept together.
// The waiting list (closed 14 Nov) is let in separately on the 19th: entry_status becomes
// 'confirmed' with an entry time, either day at any time (the organiser, 19 Nov, on the
// numbers: Friday about 650 at the busiest hour, Saturday about 400, the floor about 1,000;
// it had been Saturday morning for Mumbai).
// Those who tapped "I can't make it" after the email are offered either day, any time, by a
// second run (kind 'entry_reoffer', the organiser, 19 Nov): their entry time changes as their
// email goes.
// A person with an entry time already keeps it: assigning again fills only the empty ones.
//
// The entry time is told, not enforced: the badge desk shows it on the scan (amber "not their
// time", with Undo), and the app's pass card says it. A paid pass never has one that counts.
//
// The email is a campaign of kind 'entry_slot' on the bulk pump (BULK EMAIL CAMPAIGNS in
// index.tsx): ten a minute from the clock, as fast as the server answers while the Admin tab
// is open, 9am-9pm IST, Friday morning first. Nobody is sent it twice. Screen:
// public/static/entry-slots.js, on Admin -> Overview under the event-week strip.
// Every /api/admin/* route here is behind the admin middleware in index.tsx.

export type SlotKey = 'fri-am' | 'fri-pm' | 'sat-am' | 'sat-pm' | 'any'
export const SLOT_ORDER: SlotKey[] = ['fri-am', 'any', 'fri-pm', 'sat-am', 'sat-pm']
// day: the IST date; from/to: minutes after midnight IST. 'any' is both days, all day.
export const SLOTS: Record<SlotKey, { text: string; short: string; day: string; from: number; to: number }> = {
  'fri-am': { text: 'Friday 20 Nov, 8:30 am to 1 pm', short: 'Fri morning', day: '2026-11-20', from: 8 * 60 + 30, to: 13 * 60 },
  'fri-pm': { text: 'Friday 20 Nov, 1 pm to 5 pm', short: 'Fri afternoon', day: '2026-11-20', from: 13 * 60, to: 17 * 60 },
  'sat-am': { text: 'Saturday 21 Nov, 8:30 am to 1 pm', short: 'Sat morning', day: '2026-11-21', from: 8 * 60 + 30, to: 13 * 60 },
  'sat-pm': { text: 'Saturday 21 Nov, 1 pm to 5 pm', short: 'Sat afternoon', day: '2026-11-21', from: 13 * 60, to: 17 * 60 },
  'any': { text: 'Friday 20 or Saturday 21 Nov, any time from 8:30 am', short: 'Either day', day: '', from: 8 * 60 + 30, to: 18 * 60 },
}
const SPLIT: SlotKey[] = ['fri-pm', 'sat-am', 'sat-pm']
export const WAITLIST_SLOT: SlotKey = 'any'
export const CAMPAIGN_KIND = 'entry_slot'
export const REOFFER_KIND = 'entry_reoffer'
const TEAM_ONLY = ['Organiser', 'Support Staff']
const IST_MS = 330 * 60000
// Thirty minutes either side still counts as on time at the desk.
const GRACE_MIN = 30
// This email goes from 8:30 am (the organiser, 17 Nov 2026: "lets start sending from
// morning 8:30 AM"), until 9 pm IST like every bulk email. Only this email: the shared
// 9am-9pm window (sendWindowState in index.tsx) is unchanged for the rest.
export const SEND_FROM_MIN = 8 * 60 + 30
export const SEND_UNTIL_MIN = 21 * 60
export function sendWindow(nowMs = Date.now()): { open: boolean; window: string; ist_time: string } {
  const ist = new Date(nowMs + IST_MS)
  const m = ist.getUTCHours() * 60 + ist.getUTCMinutes()
  return { open: m >= SEND_FROM_MIN && m < SEND_UNTIL_MIN, window: '8:30am to 9pm IST', ist_time: ist.toISOString().slice(11, 16) + ' IST' }
}

type Hooks = {
  sendEmail?: (c: any, to: string, subject: string, html: string) => Promise<{ ok: boolean; error?: string }>
  emailHeader?: (title: string, subtitle: string) => string
  appUrl?: (c: any) => Promise<string>
  signIn?: (c: any, eventId: number, email: string) => Promise<string>
  clauses?: (c: any) => Promise<{ mc: string; noEmail: string }>
  notifyKind?: (a: any) => 'free' | 'unpaid' | 'paid'
  waitlisted?: (a: any) => boolean
  profileGaps?: (a: any) => string[]
  // The signed one-tap "Are you coming?" link (/api/rsvp in index.tsx); index.tsx signs it.
  rsvpLink?: (c: any, email: string, status: 'confirmed' | 'declined') => Promise<string>
  decorate?: (c: any, html: string, to: string) => Promise<string>
  audit?: (c: any, action: string, entity?: string, entityId?: any, detail?: any) => Promise<any>
}
let hooks: Hooks = {}
export function configureEntrySlots(h: Hooks) { hooks = { ...hooks, ...h } }

const es = new Hono<{ Bindings: any }>()
const SITE = 'https://bharataiinnovation.com'
const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const all = async (c: any, sql: string, ...args: any[]) => (((await c.env.DB.prepare(sql).bind(...args).all()) as any).results || []) as any[]
const validEmail = (e: any) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim())

// ---------- pure helpers ----------

// Where a person lives, from the city they typed (295 spellings on 17 Nov 2026).
export type Zone = 'mumbai' | 'mmr' | 'unknown' | 'near' | 'state' | 'india' | 'abroad'
const MUMBAI = ['mumbai', 'mumbau', 'mimbai', 'mumbaj', 'mumbi', 'mumbqi', 'bombay', 'andheri', 'bandra', 'borivali', 'chembur', 'goregaon', 'kandivali', 'kanjurmarg', 'mahim', 'mankhurd', 'marol', 'sion', 'vile parle', 'govandi', 'malad', 'dadar', 'powai', 'worli', 'colaba', 'kurla', 'ghatkopar', 'mulund', 'vikhroli', 'santacruz', 'juhu', 'byculla', 'parel', 'lower parel', 'dahisar', 'jogeshwari']
const MMR = ['thane', 'kharghar', 'nerul', 'seawoods', 'rabale', 'kamothe', 'panvel', 'uran', 'kalyan', 'dombivli', 'dombivali', 'ulhasnagar', 'ambernath', 'badlapur', 'bhiwandi', 'vasai', 'virar', 'nalasopara', 'nallasopara', 'naigaon', 'mira', 'bhayandar', 'diva', 'palava', 'talavali', 'shahpur', 'navimumbai', 'new mumbai', 'navi mumbai', 'vashi', 'belapur', 'airoli', 'ghansoli', 'kopar khairane', 'sanpada', 'turbhe']
const NEAR = ['pune', 'hadapsar', 'oune', 'puen', 'punw', 'pimpri', 'chinchwad', 'nashik', 'palghar', 'palger', 'boisar', 'vapi', 'valsad', 'umbergaon', 'surat', 'lonere', 'shrivardhan', 'alibag', 'lonavala', 'karjat']
const STATE = ['nagpur', 'aurangabad', 'sambhaji', 'sambnaji', 'kolhapur', 'satara', 'sangli', 'solapur', 'latur', 'nanded', 'jalgaon', 'dhule', 'ahemadnagar', 'ahmednagar', 'malegaon', 'ratnagiri', 'chiplun', 'kankavli', 'shirpur', 'chopda', 'sillod', 'udgir', 'umarkhed', 'shegaon', 'gondia', 'ambejogai', 'amravati', 'akola', 'maharastra', 'maharashtra', 'ahmedabad', 'ahemdabad', 'vadodara', 'baroda', 'rajkot', 'anand', 'gandhinagar', 'morbi', 'bharuch', 'jamnagar', 'palanpur', 'patan', 'goa', 'panaji', 'margoa', 'margao', 'ponda', 'belgaum']
const ABROAD = ['london', 'dubai', 'san francisco', 'boston', 'california', 'kenya', 'malaysia', 'muscat', 'le chesnay', 'abdjan', 'singapore', 'usa', 'united states', 'canada', 'australia', 'germany', 'abu dhabi', 'qatar', 'doha', 'riyadh', 'oman']
const UNKNOWN = ['', 'india', 'na', 'n/a', '-', '.', 'sasd', 'hol']
const has = (c: string, list: string[]) => list.some(w => c.includes(w))
export function zoneOf(city: any): Zone {
  const c = String(city || '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (UNKNOWN.includes(c) || /^ct\d+$/.test(c) || /construction/.test(c)) return 'unknown'
  if (c === 'uk' || has(c, ABROAD)) return 'abroad'
  // "Navi Mumbai" and "New Mumbai" are the Thane side, "Mumbai Suburban" is Mumbai.
  if (has(c, MMR) && !/^mumbai/.test(c)) return 'mmr'
  if (has(c, MUMBAI)) return 'mumbai'
  if (has(c, NEAR)) return 'near'
  if (has(c, STATE)) return 'state'
  return 'india'
}
// Mumbai, the Thane side, and no city given (most of those are local): a half-day each.
export const isLocal = (z: Zone) => z === 'mumbai' || z === 'mmr' || z === 'unknown'

// A company or college as a key, so colleagues and classmates share an entry time. Words
// that are not an organisation ("student", "NA", "self") keep a person on their own.
const NOT_AN_ORG = /^(|na|n\/a|nil|none|no|-+|\.+|self|self employed|self-employed|freelance|freelancer|student|students|individual|unemployed|not applicable|home|personal|independent|retired|nothing|test|xyz|abc)$/
export function orgKey(company: any): string {
  const k = String(company || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(pvt|private|ltd|limited|llp|inc|llc|co|company|the|india|technologies|technology|tech|solutions|services)\b/g, ' ').replace(/\s+/g, ' ').trim()
  return NOT_AN_ORG.test(k) || k.length < 3 ? '' : k
}

// Said "I'm coming", or has the pass on the phone without answering: the backup crowd.
export function keen(a: any): boolean {
  const r = String(a?.rsvp_status || '').trim().toLowerCase()
  if (r === 'confirmed') return true
  return !r && !!a?.pass_downloaded_at
}

// Who gets which entry time. rows: the free pass holders still without one (id, city,
// company, rsvp_status, pass_downloaded_at). Pure: the same rows give the same answer.
export function planSlots(rows: any[]): Map<number, SlotKey> {
  const out = new Map<number, SlotKey>()
  const local: any[] = []
  for (const a of rows) {
    if (!isLocal(zoneOf(a.city))) out.set(Number(a.id), 'any')
    else local.push(a)
  }
  // Groups by organisation; a person with no organisation is a group of one.
  const groups = new Map<string, any[]>()
  for (const a of local) {
    const k = orgKey(a.company) || '#' + a.id
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(a)
  }
  const rest: any[][] = []
  for (const g of groups.values()) {
    if (g.some(keen)) for (const a of g) out.set(Number(a.id), 'fri-am')
    else rest.push(g)
  }
  // Biggest groups first, each to the half-day with the fewest so far.
  rest.sort((x, y) => (y.length - x.length) || (Number(x[0].id) - Number(y[0].id)))
  const load: Record<string, number> = { 'fri-pm': 0, 'sat-am': 0, 'sat-pm': 0 }
  for (const g of rest) {
    let best = SPLIT[0]
    for (const s of SPLIT) if (load[s] < load[best]) best = s
    load[best] += g.length
    for (const a of g) out.set(Number(a.id), best)
  }
  return out
}
// Everyone on the waiting list: either day, any time (19 Nov). Kept as a function so the
// rule can differ by person again.
export function waitlistSlotFor(_a: any): SlotKey { return WAITLIST_SLOT }

// The key of a stored entry time ('' when an organiser typed something else).
export function slotKeyOf(text: any): SlotKey | '' {
  const t = String(text || '').trim()
  for (const k of SLOT_ORDER) if (SLOTS[k].text === t) return k
  return ''
}
// At the desk: is now their time? null when the entry time is not one of ours.
export function inSlot(text: any, nowMs = Date.now()): boolean | null {
  const k = slotKeyOf(text)
  if (!k) return null
  const s = SLOTS[k]
  const ist = new Date(nowMs + IST_MS)
  const day = ist.toISOString().slice(0, 10)
  const min = ist.getUTCHours() * 60 + ist.getUTCMinutes()
  // Saturday is open to every free pass, at any time (the organiser, 20 Nov 22:15: "allow
  // every one tomorrow"): any of our entry times is on time that day.
  if (day === OPEN_DAY) return true
  const onDay = s.day ? day === s.day : (day === SLOTS['fri-am'].day || day === SLOTS['sat-am'].day)
  return onDay && min >= s.from - GRACE_MIN && min <= s.to + GRACE_MIN
}
// The day open to every free pass, and the words their Saturday email gives (20 Nov).
export const OPEN_DAY = '2026-11-21'
export const SAT_TEXT = 'Saturday 21 Nov, any time from 8:30 am'
export const SAT_KIND = 'sat_open'
// The Saturday email goes tonight until 11:30 pm and from 6 am (the organiser: "send it now
// till 11:30 PM with no gap in emails"), not in the 8:30 am - 9 pm window of the entry-time
// email; fifty a minute from the clock (tickCampaigns in index.tsx), no send gap.
export function satWindow(nowMs = Date.now()): { open: boolean; window: string; ist_time: string } {
  const ist = new Date(nowMs + IST_MS)
  const m = ist.getUTCHours() * 60 + ist.getUTCMinutes()
  return { open: m >= 6 * 60 && m < 23 * 60 + 30, window: '6am to 11:30pm IST', ist_time: ist.toISOString().slice(11, 16) + ' IST' }
}

// "riddhi" and "DR. RAJESH KUMAR" both arrive from imports; the greeting wants "Riddhi".
export function firstName(name: any): string {
  const words = String(name || '').trim().split(/\s+/).filter(w => !/^(dr|prof|mr|mrs|ms|miss|shri|smt|er|ca|adv|hon[’']?ble)\.?$/i.test(w))
  const w = words[0] || ''
  if (!/[a-z]/i.test(w)) return ''
  return w === w.toUpperCase() || w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w
}

// A free pass holder of the conference: the only people an entry time is for. Not an
// exhibitor's guest (registration_source 'exhibitor:<id>', given from the exhibitor's
// dashboard since 19 Nov, routes/team-guests.ts): they come when their host expects them,
// with no entry time and no email from us.
function freeHolder(a: any): boolean {
  if (!a || Number(a.main_event ?? 1) === 0) return false
  if (TEAM_ONLY.includes(String(a.badge_type || '').trim())) return false
  if (/^exhibitor:/i.test(String(a.registration_source || '').trim())) return false
  const nk = hooks.notifyKind ? hooks.notifyKind(a) : 'free'
  return nk === 'free' || nk === 'unpaid'
}

// ---------- the email ----------

export function subjectFor(a: any, reoffer = false, saturday = false): string {
  const first = firstName(a?.name)
  const lead = first ? first + ', ' : ''
  const slot = String(a?.entry_slot || '').trim()
  if (saturday) return String(a?.entry_status || '') === 'confirmed'
    ? lead + (first ? 'good' : 'Good') + ' news: your Free Visitor Pass is confirmed for Saturday 21 Nov, any time'
    : lead + (first ? 'come' : 'Come') + ' any time on Saturday 21 Nov: your Free Visitor Pass works all day'
  if (reoffer) return lead + (first ? 'no' : 'No') + ' problem: come any time on Friday 20 or Saturday 21 Nov'
  if (String(a?.entry_status || '') === 'confirmed') return lead + (first ? 'good' : 'Good') + ' news: your Free Visitor Pass is confirmed for ' + slot
  return lead + (first ? 'your' : 'Your') + ' entry time for Bharat AI Innovation: ' + slot
}

// opts.reoffer: the "you can't make it, come any time" version; a carries the new entry time.
// opts.saturday: "Saturday is open to all" (20 Nov); the box says SAT_TEXT, no "Are you coming?".
export async function entrySlotEmail(c: any, a: any, opts: { preview?: boolean; reoffer?: boolean; saturday?: boolean } = {}): Promise<{ subject: string; html: string }> {
  const appUrl = hooks.appUrl ? await hooks.appUrl(c) : SITE + '/app'
  const email = String(a.email || '').trim()
  const first = firstName(a.name)
  const sat = !!opts.saturday
  const slot = sat ? SAT_TEXT : String(a.entry_slot || '').trim()
  const key = slotKeyOf(slot)
  const fromWaitlist = String(a.entry_status || '') === 'confirmed'
  let token = ''
  if (!opts.preview && hooks.signIn) { try { token = await hooks.signIn(c, Number(a.event_id) || 1, email.toLowerCase()) } catch { token = '' } }
  const base = `${appUrl}?email=${encodeURIComponent(email)}`
  const go = (action: string, extra = '') => `${base}&action=${action}${extra}${token ? '&token=' + token : ''}`
  // "Are you coming?" (the organiser, 17 Nov 2026: most yeses are from October; "how do we
  // know how many will come?"): one tap records a fresh answer, counted on the Admin strip.
  const ask = async (status: 'confirmed' | 'declined') => (opts.preview || !hooks.rsvpLink) ? '#' : await hooks.rsvpLink(c, email.toLowerCase(), status)
  const yesHref = sat ? '' : await ask('confirmed'), noHref = sat ? '' : await ask('declined')
  const btn = (href: string, label: string, bg = '#C84F00') =>
    `<a href="${href}" style="display:inline-block;margin:8px 0 0;padding:11px 20px;background:${bg};color:#fff;text-decoration:none;border-radius:10px;font-weight:bold;font-size:13.5px;">${label}</a>`
  const gaps = hooks.profileGaps ? hooks.profileGaps(a) : []
  const needsPhoto = gaps.includes('photo')

  const when = sat
    ? 'Doors open at <strong>8:30 am</strong>. Come at any time that suits you, whatever entry time we gave you before: the morning is the best part of the day.'
    : key === 'fri-am'
    ? 'The opening and the inauguration start at <strong>9:30 am</strong>. Come by 9 am, so you are through the badge desk in time.'
    : key === 'sat-am' ? 'The day opens at <strong>9 am</strong>. Come early, so you are through the badge desk in time.'
    : key === 'any' ? 'Come on either day, at any time from 8:30 am. If you are travelling to Mumbai, the mornings are the best part of each day.'
    : 'The exhibition floor is open all afternoon. Come to the badge desk in this time.'
  const stay = key === 'any' ? 'Once you are in, stay as long as you like.' : 'Once you are in, stay as long as you like that day.'
  const intro = sat
    ? (fromWaitlist
      ? 'Good news: a place has opened up for you. Your <strong>Free Visitor Pass</strong> for Bharat AI Innovation 2026 is confirmed. Come on Saturday, at any time:'
      : 'Day 1 is done, and Saturday is open to every <strong>Free Visitor Pass</strong> holder. Come at any time, whatever entry time we gave you before:')
    : opts.reoffer
    ? 'You told us you can&rsquo;t make it at the entry time we gave you. No problem: your <strong>Free Visitor Pass</strong> for Bharat AI Innovation 2026 now works at any time, on either day. Your new entry time:'
    : fromWaitlist
    ? 'Good news: a place has opened up for you. Your <strong>Free Visitor Pass</strong> for Bharat AI Innovation 2026 is confirmed, with this entry time:'
    : 'Your <strong>Free Visitor Pass</strong> for Bharat AI Innovation 2026 has an entry time. We give free passes an entry time so that everyone who registered gets a chance to come in. Yours is:'

  let n = 0
  const step = (title: string, body: string, extra = '') => {
    n++
    return `<tr><td width="40" valign="top" style="padding:0 0 16px;"><div style="width:28px;height:28px;border-radius:50%;background:#FF6B00;color:#fff;font-weight:bold;font-size:13px;line-height:28px;text-align:center;">${n}</div></td>` +
      `<td valign="top" style="padding:2px 0 16px;"><p style="margin:0 0 3px;font-size:15px;font-weight:bold;color:#1E2140;">${title}</p><p style="margin:0;font-size:13.5px;line-height:1.6;color:#555;">${body}</p>${extra}</td></tr>`
  }
  const steps = [
    needsPhoto
      ? step('Add your photo, then put your pass on your phone', 'Your pass needs your photo before it can be made. Take it with your phone in the app; it takes a minute. Then download your pass.', btn(go('complete-profile'), 'Add my photo'))
      : step('Put your pass on your phone', 'The badge desk scans the QR code on your pass. Nothing to print.', btn(go('download-pass'), 'Download my pass', '#1E2140')),
    step('Bring a government photo ID', 'With the same name as your pass. The desk checks it.'),
    sat
      ? step('Come any time on Saturday', 'Doors open at 8:30 am. There is no on-spot registration at the venue: bring this pass.')
      : step('Come in your entry time', 'There is no on-spot registration at the venue. Please keep to your time, so the floor stays comfortable and everyone gets their turn.'),
  ]
  const askBox = sat ? '' : `<div style="margin:16px 0 0;padding:16px 18px;background:#F0FAF4;border:1px solid #BFE3CC;border-radius:12px;text-align:center;">
        <p style="margin:0 0 4px;font-size:15px;font-weight:bold;color:#1E2140;">${key === 'any' ? 'Are you coming?' : 'Are you coming at this time?'}</p>
        <p style="margin:0 0 6px;font-size:13px;line-height:1.5;color:#555;">One tap. It helps us keep the floor comfortable for everyone.</p>
        <a href="${yesHref}" style="display:inline-block;margin:6px 4px 0;padding:11px 20px;background:#0f7b47;color:#fff;text-decoration:none;border-radius:10px;font-weight:bold;font-size:13.5px;">Yes, I&rsquo;m coming</a>
        <a href="${noHref}" style="display:inline-block;margin:6px 4px 0;padding:11px 20px;background:#fff;color:#1E2140;border:1px solid #C9CDE6;text-decoration:none;border-radius:10px;font-weight:bold;font-size:13.5px;">I can&rsquo;t make it</a>
      </div>`
  // No Expo Pass offer in this email (the organiser, 17 Nov 23:58: "remove this it does not look good").
  const header = hooks.emailHeader ? hooks.emailHeader(sat ? 'See you on Saturday' : opts.reoffer ? 'Come on either day' : fromWaitlist ? 'Your Free Visitor Pass is confirmed' : 'Your entry time', '20&ndash;21 Nov 2026 &bull; World Trade Center, Mumbai') : ''
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Your entry time: ${esc(slot)}. World Trade Center, Cuffe Parade, Mumbai.</div>
  <div style="max-width:600px;margin:0 auto;padding:16px;">
    <div style="border-radius:16px;overflow:hidden;">${header}</div>
    <div style="background:white;border-radius:16px;padding:24px 22px;margin-top:16px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
      <p style="margin:0 0 10px;font-size:15px;color:#333;">Hi <strong>${esc(first || 'there')}</strong>,</p>
      <p style="margin:0;font-size:14.5px;line-height:1.7;color:#444;">${intro}</p>
      <div style="margin:18px 0 0;padding:18px 20px;background:#1E2140;border-radius:14px;color:#fff;">
        <p style="margin:0 0 4px;font-size:11px;letter-spacing:1.6px;font-weight:bold;color:#FF9E4D;">YOUR ENTRY TIME</p>
        <p style="margin:0 0 6px;font-size:21px;font-weight:bold;line-height:1.3;">${esc(slot)}</p>
        <p style="margin:0;font-size:13px;line-height:1.6;color:#C9CDE6;">World Trade Center, Cuffe Parade, Mumbai 400005. ${stay}</p>
      </div>
      <p style="margin:14px 0 0;font-size:13.5px;line-height:1.65;color:#555;">${when}</p>
      ${askBox}
      <table role="presentation" data-app-on-phone="1" style="width:100%;border-collapse:collapse;margin:20px 0 0;">${steps.join('')}</table>
      <div style="margin-top:22px;padding-top:16px;border-top:1px solid #eee;">
        <p style="margin:0 0 14px;font-size:12.5px;line-height:1.6;color:#888;">The buttons in this email sign you in as <strong>${esc(email)}</strong>. If one has expired, open the app and sign in with this address: we send you a one-time code, no password needed. Your entry time is also on your pass in the app. <a href="${base}${token ? '&token=' + token : ''}" style="color:#4f46e5;">Open the app</a></p>
        <p style="margin:0;font-size:14px;line-height:1.6;color:#555;">See you in Mumbai,<br><strong>Team Bharat AI Innovation</strong></p>
      </div>
    </div>
    <p style="text-align:center;color:#999;font-size:12px;margin-top:16px;">Bharat AI Innovation Conference &amp; Exhibition 2026 &bull; World Trade Center, Mumbai &bull; Friday 20 and Saturday 21 Nov 2026</p>
  </div>
</body>
</html>`
  return { subject: subjectFor(a, !!opts.reoffer, sat), html }
}

// ---------- who ----------

// The free pass holders of the conference, with what the plan reads.
async function freeHolders(c: any): Promise<any[]> {
  const cl = hooks.clauses ? await hooks.clauses(c) : { mc: '', noEmail: '' }
  const rows = await all(c, `SELECT id, event_id, name, email, city, company, badge_type, payment_status, main_event, rsvp_status, rsvp_at, pass_downloaded_at,
      entry_status, entry_slot, unsubscribed_at, registration_source FROM attendees WHERE event_id = 1${cl.mc} ORDER BY id`)
  return rows.filter(freeHolder)
}
const waitingRow = (a: any) => hooks.waitlisted ? hooks.waitlisted(a) : String(a.entry_status || '') === 'waitlisted'

// Everyone with an entry time, not on the waiting list, not yet on an entry_slot run;
// Friday morning first, then the travellers, then the rest in time order.
const NOT_YET_SQL = ` AND id NOT IN (SELECT cr.attendee_id FROM campaign_recipients cr JOIN campaigns cp ON cp.id = cr.campaign_id
    WHERE cp.kind = '${CAMPAIGN_KIND}' AND cr.attendee_id IS NOT NULL AND cr.status IN ('pending', 'sending', 'sent'))`
export async function entrySlotAudienceRows(c: any, _audience = 'all', clauses?: { mc: string; noEmail?: string }): Promise<any[]> {
  const cl = clauses || (hooks.clauses ? await hooks.clauses(c) : { mc: '', noEmail: '' })
  const noEmail = cl.noEmail ? ` AND ${cl.noEmail}` : ''
  const rows = await all(c, `SELECT * FROM attendees WHERE event_id = 1 AND email IS NOT NULL AND TRIM(email) != '' AND COALESCE(TRIM(entry_slot), '') != ''
      AND unsubscribed_at IS NULL${noEmail}${cl.mc}${NOT_YET_SQL} ORDER BY id`)
  const order = (a: any) => { const i = SLOT_ORDER.indexOf(slotKeyOf(a.entry_slot) as SlotKey); return i < 0 ? 9 : i }
  return rows
    .filter((a: any) => validEmail(a.email) && freeHolder(a) && !waitingRow(a))
    .sort((x: any, y: any) => (order(x) - order(y)) || (Number(x.id) - Number(y.id)))
    .map((a: any) => ({ id: a.id, name: a.name, email: a.email, slot: slotKeyOf(a.entry_slot) || 'other' }))
}

// "Saturday is open to all" (20 Nov): every free pass holder (the waiting list was let in
// that night) who did not come on Friday, not yet on such a run. Friday's arrivals are read
// from the checkins table, or attendees.checked_in_at where it does not exist.
const SAT_NOT_YET_SQL = ` AND id NOT IN (SELECT cr.attendee_id FROM campaign_recipients cr JOIN campaigns cp ON cp.id = cr.campaign_id
    WHERE cp.kind = '${SAT_KIND}' AND cr.attendee_id IS NOT NULL AND cr.status IN ('pending', 'sending', 'sent'))`
// A free pass only: a paid pass not yet paid for is stopped at the desk for payment, so
// "your Free Visitor Pass works all day" would be wrong for them.
const satHolder = (a: any) => freeHolder(a) && (hooks.notifyKind ? hooks.notifyKind(a) === 'free' : true)
async function cameFriday(c: any): Promise<Set<number>> {
  try {
    return new Set((await all(c, "SELECT attendee_id AS id FROM checkins WHERE day = '2026-11-20'")).map((r: any) => Number(r.id)))
  } catch {
    return new Set((await all(c, "SELECT id FROM attendees WHERE event_id = 1 AND checked_in_at IS NOT NULL")).map((r: any) => Number(r.id)))
  }
}
export async function satOpenAudienceRows(c: any, _audience = 'all', clauses?: { mc: string; noEmail?: string }): Promise<any[]> {
  const cl = clauses || (hooks.clauses ? await hooks.clauses(c) : { mc: '', noEmail: '' })
  const noEmail = cl.noEmail ? ` AND ${cl.noEmail}` : ''
  const came = await cameFriday(c)
  const rows = await all(c, `SELECT * FROM attendees WHERE event_id = 1 AND email IS NOT NULL AND TRIM(email) != '' AND unsubscribed_at IS NULL${noEmail}${cl.mc}${SAT_NOT_YET_SQL} ORDER BY id`)
  return rows
    .filter((a: any) => validEmail(a.email) && satHolder(a) && !waitingRow(a) && !came.has(Number(a.id)))
    .map((a: any) => ({ id: a.id, name: a.name, email: a.email, slot: slotKeyOf(a.entry_slot) || 'other' }))
}

async function openRun(c: any, kind = CAMPAIGN_KIND): Promise<any> {
  return await c.env.DB.prepare(`SELECT * FROM campaigns WHERE kind = '${kind}' AND status IN ('running', 'paused') ORDER BY id DESC LIMIT 1`).first().catch(() => null)
}

// When the first entry-time run was made: an answer given after it is a fresh one.
async function askedSince(c: any): Promise<string> {
  return String(((await c.env.DB.prepare(`SELECT MIN(created_at) AS t FROM campaigns WHERE kind = '${CAMPAIGN_KIND}'`).first().catch(() => null)) as any)?.t || '')
}

// "Come any time instead" (19 Nov): free pass holders who tapped "I can't make it" after the
// entry-time email went, whose entry time is not already either day, not yet on such a run.
const REOFFER_NOT_YET_SQL = ` AND id NOT IN (SELECT cr.attendee_id FROM campaign_recipients cr JOIN campaigns cp ON cp.id = cr.campaign_id
    WHERE cp.kind = '${REOFFER_KIND}' AND cr.attendee_id IS NOT NULL AND cr.status IN ('pending', 'sending', 'sent'))`
export async function entryReofferAudienceRows(c: any, _audience = 'all', clauses?: { mc: string; noEmail?: string }): Promise<any[]> {
  const since = await askedSince(c)
  if (!since) return []
  const cl = clauses || (hooks.clauses ? await hooks.clauses(c) : { mc: '', noEmail: '' })
  const noEmail = cl.noEmail ? ` AND ${cl.noEmail}` : ''
  const rows = await all(c, `SELECT * FROM attendees WHERE event_id = 1 AND email IS NOT NULL AND TRIM(email) != '' AND COALESCE(TRIM(entry_slot), '') NOT IN ('', ?)
      AND unsubscribed_at IS NULL AND LOWER(COALESCE(rsvp_status, '')) = 'declined' AND rsvp_at >= ?${noEmail}${cl.mc}${REOFFER_NOT_YET_SQL} ORDER BY id`, SLOTS.any.text, since)
  return rows
    .filter((a: any) => validEmail(a.email) && freeHolder(a) && !waitingRow(a))
    .map((a: any) => ({ id: a.id, name: a.name, email: a.email, slot: slotKeyOf(a.entry_slot) || 'other' }))
}

async function writeSlots(c: any, pairs: [number, SlotKey][], confirm: boolean) {
  const stmts: any[] = []
  for (const k of SLOT_ORDER) {
    const ids = pairs.filter(p => p[1] === k).map(p => p[0])
    for (let i = 0; i < ids.length; i += 90) {
      const part = ids.slice(i, i + 90)
      const ph = part.map(() => '?').join(',')
      stmts.push(confirm
        ? c.env.DB.prepare(`UPDATE attendees SET entry_status = 'confirmed', entry_slot = ?, entry_decided_at = datetime('now') WHERE id IN (${ph}) AND entry_status = 'waitlisted'`).bind(SLOTS[k].text, ...part)
        : c.env.DB.prepare(`UPDATE attendees SET entry_slot = ? WHERE id IN (${ph}) AND COALESCE(TRIM(entry_slot), '') = ''`).bind(SLOTS[k].text, ...part))
    }
  }
  for (let i = 0; i < stmts.length; i += 40) await c.env.DB.batch(stmts.slice(i, i + 40))
}

// ---------- routes ----------

// What the card shows: entry times given (and sent) per half-day, the plan for those
// still without one, the waiting list and its plan, the open run.
es.get('/api/admin/entry-slots/status', async (c) => {
  try {
    const rows = await freeHolders(c)
    const sentIds = new Set((await all(c, `SELECT cr.attendee_id AS id FROM campaign_recipients cr JOIN campaigns cp ON cp.id = cr.campaign_id
        WHERE cp.kind = '${CAMPAIGN_KIND}' AND cr.status = 'sent' AND cr.attendee_id IS NOT NULL`)).map((r: any) => Number(r.id)))
    // A fresh answer: one given since the first entry-time run was made (the email's two
    // buttons, or the app). Older yeses, most from October, are not counted here.
    const since = await askedSince(c)
    // Those offered either day (entry_reoffer): their "can't" was about the old time, so it
    // counts only when given again after that email.
    const offered = new Map<number, string>()
    for (const r of await all(c, `SELECT cr.attendee_id AS id, cr.sent_at FROM campaign_recipients cr JOIN campaigns cp ON cp.id = cr.campaign_id
        WHERE cp.kind = '${REOFFER_KIND}' AND cr.status = 'sent' AND cr.attendee_id IS NOT NULL`)) offered.set(Number(r.id), String(r.sent_at || ''))
    const fresh = (a: any, s: string) => {
      if (!since || String(a.rsvp_status || '') !== s || String(a.rsvp_at || '') < since) return false
      const o = offered.get(Number(a.id))
      return s !== 'declined' || o === undefined || String(a.rsvp_at || '') >= o
    }
    let offeredYes = 0
    for (const a of rows) { const o = offered.get(Number(a.id)); if (o !== undefined && String(a.rsvp_status || '') === 'confirmed' && String(a.rsvp_at || '') >= o) offeredYes++ }
    const given: Record<string, number> = {}, sent: Record<string, number> = {}, planned: Record<string, number> = {}, wlPlan: Record<string, number> = {}
    const yesNow: Record<string, number> = {}, noNow: Record<string, number> = {}
    for (const k of SLOT_ORDER) { given[k] = 0; sent[k] = 0; planned[k] = 0; wlPlan[k] = 0; yesNow[k] = 0; noNow[k] = 0 }
    let other = 0, waiting = 0, letIn = 0
    const open: any[] = [], wl: any[] = []
    for (const a of rows) {
      if (waitingRow(a)) { waiting++; wl.push(a); continue }
      if (String(a.entry_status || '') === 'confirmed') letIn++
      const t = String(a.entry_slot || '').trim()
      if (!t) { open.push(a); continue }
      const k = slotKeyOf(t)
      if (!k) { other++; continue }
      given[k]++
      if (sentIds.has(Number(a.id))) sent[k]++
      if (fresh(a, 'confirmed')) yesNow[k]++
      if (fresh(a, 'declined')) noNow[k]++
    }
    for (const k of planSlots(open).values()) planned[k]++
    for (const a of wl) wlPlan[waitlistSlotFor(a)]++
    const run = await openRun(c)
    const toSend = (await entrySlotAudienceRows(c)).length
    const roRun = await openRun(c, REOFFER_KIND)
    const satRun = await openRun(c, SAT_KIND)
    const satSent = Number(((await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM campaign_recipients cr JOIN campaigns cp ON cp.id = cr.campaign_id
        WHERE cp.kind = '${SAT_KIND}' AND cr.status = 'sent'`).first().catch(() => null)) as any)?.n || 0)
    const runOut = (r: any) => r ? { id: r.id, status: r.status, title: r.title, total: r.total, sent: r.sent, failed: r.failed } : null
    return c.json({
      slots: SLOT_ORDER.map(k => ({ key: k, text: SLOTS[k].text, short: SLOTS[k].short, given: given[k], sent: sent[k], planned: planned[k], waitlist: wlPlan[k], yes_now: yesNow[k], no_now: noNow[k] })),
      without: open.length, other, waiting, let_in: letIn, to_send: toSend, asked_since: since,
      reoffer: { to_send: (await entryReofferAudienceRows(c)).length, sent: offered.size, yes_after: offeredYes, open_run: runOut(roRun) },
      saturday: { to_send: (await satOpenAudienceRows(c)).length, sent: satSent, open_run: runOut(satRun) },
      open_run: runOut(run),
      window: sendWindow().window,
    })
  } catch (e: any) {
    if (/no such (table|column)/i.test(String(e?.message || ''))) return c.json({ unavailable: true })
    throw e
  }
})

// Give an entry time to every free pass holder without one (not the waiting list).
es.post('/api/admin/entry-slots/assign', async (c) => {
  const rows = (await freeHolders(c)).filter(a => !waitingRow(a) && !String(a.entry_slot || '').trim())
  const plan = planSlots(rows)
  const pairs = [...plan.entries()] as [number, SlotKey][]
  if (pairs.length) await writeSlots(c, pairs, false)
  const counts: Record<string, number> = {}
  for (const [, k] of pairs) counts[k] = (counts[k] || 0) + 1
  if (hooks.audit) await hooks.audit(c, 'entry_slots.assign', 'attendee', '', { count: pairs.length, counts })
  return c.json({ success: true, assigned: pairs.length, counts })
})

// The waiting list in: confirmed, with an entry time (Saturday morning; either day for
// those who live outside Mumbai). Their email is the same run, with "a place has opened up".
es.post('/api/admin/entry-slots/let-in-waitlist', async (c) => {
  const rows = (await freeHolders(c)).filter(waitingRow)
  const pairs = rows.map(a => [Number(a.id), waitlistSlotFor(a)] as [number, SlotKey])
  if (pairs.length) await writeSlots(c, pairs, true)
  const counts: Record<string, number> = {}
  for (const [, k] of pairs) counts[k] = (counts[k] || 0) + 1
  if (hooks.audit) await hooks.audit(c, 'entry_slots.let_in_waitlist', 'attendee', '', { count: pairs.length, counts })
  return c.json({ success: true, let_in: pairs.length, counts })
})

// One email to ONE attendee, for the campaign pump: 409 outside the window, skipped when it
// no longer fits the person.
es.post('/api/admin/attendees/:id/send-entry-slot', async (c) => {
  const a = await c.env.DB.prepare('SELECT * FROM attendees WHERE id = ?').bind(c.req.param('id')).first() as any
  if (!a) return c.json({ error: 'Attendee not found' }, 404)
  if (!a.email || !validEmail(a.email)) return c.json({ skipped: true, reason: 'No usable email address' })
  if (a.unsubscribed_at) return c.json({ skipped: true, reason: 'Unsubscribed' })
  if (!freeHolder(a)) return c.json({ skipped: true, reason: 'Holds ' + (String(a.badge_type || '').trim() || 'another pass') + ' now: no entry time needed' })
  if (waitingRow(a)) return c.json({ skipped: true, reason: 'Still on the waiting list' })
  if (!String(a.entry_slot || '').trim()) return c.json({ skipped: true, reason: 'No entry time' })
  const win = sendWindow()
  if (!win.open && c.req.query('force') !== '1') {
    return c.json({ paused: true, reason: `Outside the ${win.window} sending window (it is ${win.ist_time}).`, window: win }, 409)
  }
  if (!hooks.sendEmail) return c.json({ error: 'Email is not set up on this server.' }, 503)
  const mail = await entrySlotEmail(c, a)
  const res = await hooks.sendEmail(c, a.email, mail.subject, mail.html)
  if (!res.ok) return c.json({ error: res.error || 'Not sent' }, 502)
  return c.json({ success: true, sent_to: a.email, slot: a.entry_slot })
})

// "Saturday is open to all", to ONE attendee, for the campaign pump.
es.post('/api/admin/attendees/:id/send-sat-open', async (c) => {
  const a = await c.env.DB.prepare('SELECT * FROM attendees WHERE id = ?').bind(c.req.param('id')).first() as any
  if (!a) return c.json({ error: 'Attendee not found' }, 404)
  if (!a.email || !validEmail(a.email)) return c.json({ skipped: true, reason: 'No usable email address' })
  if (a.unsubscribed_at) return c.json({ skipped: true, reason: 'Unsubscribed' })
  if (!satHolder(a)) return c.json({ skipped: true, reason: 'Holds ' + (String(a.badge_type || '').trim() || 'another pass') + ' now: not a free pass' })
  if (waitingRow(a)) return c.json({ skipped: true, reason: 'Still on the waiting list' })
  if ((await cameFriday(c)).has(Number(a.id))) return c.json({ skipped: true, reason: 'Came on Friday' })
  const win = satWindow()
  if (!win.open && c.req.query('force') !== '1') {
    return c.json({ paused: true, reason: `Outside the ${win.window} sending window (it is ${win.ist_time}).`, window: win }, 409)
  }
  if (!hooks.sendEmail) return c.json({ error: 'Email is not set up on this server.' }, 503)
  const mail = await entrySlotEmail(c, a, { saturday: true })
  const res = await hooks.sendEmail(c, a.email, mail.subject, mail.html)
  if (!res.ok) return c.json({ error: res.error || 'Not sent' }, 502)
  return c.json({ success: true, sent_to: a.email })
})

// The Saturday email before it goes: how many, and one real recipient's email. Sends nothing.
es.get('/api/admin/entry-slots/sat-preview', async (c) => {
  const rows = await satOpenAudienceRows(c)
  const want = String(c.req.query('who') || '')
  const open = await openRun(c, SAT_KIND)
  let pick = rows[0] || null
  const ids = rows.map(r => Number(r.id))
  const wl = ids.length ? await all(c, `SELECT id FROM attendees WHERE entry_status = 'confirmed' AND id IN (${ids.slice(0, 900).join(',')}) LIMIT 1`) : []
  if (want === 'waitlist' && wl[0]) pick = rows.find(r => Number(r.id) === Number(wl[0].id)) || pick
  const out = { total: rows.length, window: satWindow().window, open_run: open ? { id: open.id, status: open.status, title: open.title } : null, has_waitlist: !!wl[0] }
  const sample = pick ? await c.env.DB.prepare('SELECT * FROM attendees WHERE id = ?').bind(pick.id).first() as any : null
  if (!sample) return c.json({ ...out, sample: null })
  const mail = await entrySlotEmail(c, sample, { preview: true, saturday: true })
  return c.json({ ...out, subject: mail.subject, who: want === 'waitlist' && wl[0] ? 'waitlist' : 'all',
    sample: { id: sample.id, name: sample.name, email: sample.email, from_waitlist: String(sample.entry_status || '') === 'confirmed' },
    html: hooks.decorate ? await hooks.decorate(c, mail.html, sample.email) : mail.html })
})

// "Come any time instead", to ONE attendee, for the campaign pump. Their entry time becomes
// either day once the email has gone (a failed send leaves them as they were, for a new run).
es.post('/api/admin/attendees/:id/send-entry-reoffer', async (c) => {
  const a = await c.env.DB.prepare('SELECT * FROM attendees WHERE id = ?').bind(c.req.param('id')).first() as any
  if (!a) return c.json({ error: 'Attendee not found' }, 404)
  if (!a.email || !validEmail(a.email)) return c.json({ skipped: true, reason: 'No usable email address' })
  if (a.unsubscribed_at) return c.json({ skipped: true, reason: 'Unsubscribed' })
  if (!freeHolder(a)) return c.json({ skipped: true, reason: 'Holds ' + (String(a.badge_type || '').trim() || 'another pass') + ' now: no entry time needed' })
  if (waitingRow(a)) return c.json({ skipped: true, reason: 'Still on the waiting list' })
  if (!String(a.entry_slot || '').trim()) return c.json({ skipped: true, reason: 'No entry time' })
  if (slotKeyOf(a.entry_slot) === 'any') return c.json({ skipped: true, reason: 'Already either day' })
  if (String(a.rsvp_status || '').trim().toLowerCase() !== 'declined') return c.json({ skipped: true, reason: 'Answered again since: ' + (String(a.rsvp_status || '').trim() || 'no answer') })
  const win = sendWindow()
  if (!win.open && c.req.query('force') !== '1') {
    return c.json({ paused: true, reason: `Outside the ${win.window} sending window (it is ${win.ist_time}).`, window: win }, 409)
  }
  if (!hooks.sendEmail) return c.json({ error: 'Email is not set up on this server.' }, 503)
  const moved = { ...a, entry_slot: SLOTS.any.text }
  const mail = await entrySlotEmail(c, moved, { reoffer: true })
  const res = await hooks.sendEmail(c, a.email, mail.subject, mail.html)
  if (!res.ok) return c.json({ error: res.error || 'Not sent' }, 502)
  await c.env.DB.prepare('UPDATE attendees SET entry_slot = ? WHERE id = ?').bind(SLOTS.any.text, a.id).run()
  return c.json({ success: true, sent_to: a.email, slot: SLOTS.any.text, was: a.entry_slot })
})

// The "come any time" email before it goes: how many, from which entry time, and one real
// recipient's email. Sends nothing, mints no token, moves nobody.
es.get('/api/admin/entry-slots/reoffer-preview', async (c) => {
  const rows = await entryReofferAudienceRows(c)
  const counts: Record<string, number> = { total: rows.length }
  for (const r of rows) counts[r.slot] = (counts[r.slot] || 0) + 1
  const open = await openRun(c, REOFFER_KIND)
  const out = { counts, slots: SLOT_ORDER.map(k => ({ key: k, text: SLOTS[k].text, short: SLOTS[k].short })), window: sendWindow().window,
    open_run: open ? { id: open.id, status: open.status, title: open.title } : null }
  const sample = rows[0] ? await c.env.DB.prepare('SELECT * FROM attendees WHERE id = ?').bind(rows[0].id).first() as any : null
  if (!sample) return c.json({ ...out, sample: null })
  const mail = await entrySlotEmail(c, { ...sample, entry_slot: SLOTS.any.text }, { preview: true, reoffer: true })
  return c.json({ ...out, subject: mail.subject,
    sample: { id: sample.id, name: sample.name, email: sample.email, was: sample.entry_slot },
    html: hooks.decorate ? await hooks.decorate(c, mail.html, sample.email) : mail.html })
})

// The email before it goes: how many per entry time and one real recipient's email for
// the time asked for. Sends nothing, mints no token, writes nothing.
// Before "Give entry times" nobody has one, so the organiser reads what the plan would send
// (the person's entry time is filled in from the plan, in memory only), and ?slot=waitlist
// shows the "a place has opened up" version the waiting list gets when it is let in.
es.get('/api/admin/entry-slots/preview', async (c) => {
  const want = String(c.req.query('slot') || '')
  const rows = await entrySlotAudienceRows(c)
  const counts: Record<string, number> = { total: rows.length }
  const first: Record<string, any> = {}
  for (const r of rows) { counts[r.slot] = (counts[r.slot] || 0) + 1; if (!first[r.slot]) first[r.slot] = r }
  const planned: Record<string, number> = {}
  const firstPlanned: Record<string, { id: number; slot: SlotKey; wl: boolean }> = {}
  const holders = await freeHolders(c)
  for (const [id, k] of planSlots(holders.filter(a => !waitingRow(a) && !String(a.entry_slot || '').trim()))) {
    planned[k] = (planned[k] || 0) + 1
    if (!firstPlanned[k]) firstPlanned[k] = { id, slot: k, wl: false }
  }
  for (const a of holders.filter(waitingRow)) {
    planned.waitlist = (planned.waitlist || 0) + 1
    if (!firstPlanned.waitlist) firstPlanned.waitlist = { id: Number(a.id), slot: waitlistSlotFor(a), wl: true }
  }
  let pick: any = null, from: { id: number; slot: SlotKey; wl: boolean } | null = null
  if (want) { pick = first[want] || null; if (!pick) from = firstPlanned[want] || null }
  if (!pick && !from) pick = SLOT_ORDER.map(k => first[k]).find(Boolean) || null
  if (!pick && !from) from = SLOT_ORDER.map(k => firstPlanned[k]).find(Boolean) || firstPlanned.waitlist || null
  if (!pick && !from) pick = first.other || null
  const id = pick ? Number(pick.id) : from ? from.id : 0
  let sample = id ? await c.env.DB.prepare('SELECT * FROM attendees WHERE id = ?').bind(id).first() as any : null
  if (sample && from) sample = { ...sample, entry_slot: SLOTS[from.slot].text, entry_status: from.wl ? 'confirmed' : sample.entry_status }
  const open = await openRun(c)
  const out = { counts, planned, slots: SLOT_ORDER.map(k => ({ key: k, text: SLOTS[k].text, short: SLOTS[k].short })), window: sendWindow().window,
    open_run: open ? { id: open.id, status: open.status, title: open.title } : null }
  if (!sample) return c.json({ ...out, slot: want, sample: null })
  const mail = await entrySlotEmail(c, sample, { preview: true })
  return c.json({ ...out, slot: from ? (from.wl ? 'waitlist' : from.slot) : (slotKeyOf(sample.entry_slot) || 'other'), subject: mail.subject,
    sample: { id: sample.id, name: sample.name, email: sample.email, entry_slot: sample.entry_slot, from_waitlist: String(sample.entry_status || '') === 'confirmed', planned: !!from },
    html: hooks.decorate ? await hooks.decorate(c, mail.html, sample.email) : mail.html })
})

export default es
