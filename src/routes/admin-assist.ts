import { Hono } from 'hono'

// ==================== ADMIN ASSISTANT, "Ask" (24 Nov 2026) ====================
//
// The organiser: "make it world class ... mobile first and AI first". Admin has 26
// screens; the quickest way to an answer is to ask for it. Ctrl+K (or Ask in the top
// bar, or the middle button of the phone's bottom bar) opens one box that goes to any
// screen as you type and answers a question in plain words
// (public/js/admin-shell.js). The same answer, in briefing form, is the first card on
// the Overview ("Today at a glance").
//
// What the model sees: the dashboard's own totals, nothing else. The page builds them
// from the Overview's board (GET /api/admin/events/:id/board: passes held, not paid,
// money in, what is waiting on a person) and the sidebar counts, as labelled lines.
// No name, email, mobile or company goes in: the board has none, and cleanFacts() keeps
// a line only if it is a short label with a number or a short value.
//
// What the organiser sees: only an answer whose every number is in those lines (or in
// the question). An answer with a number the lines do not hold is held back, and the
// page shows the dashboard's own lines that match the question instead. A wrong number
// said confidently is worse than no answer ("read the screen status, never guess").
//
// Without Workers AI (a test harness, a binding taken away) the route answers
// { ai: false } and the page uses the same lines, so nothing on the screen depends on it.
// Every /api/admin/* route here is behind the admin middleware in index.tsx.

export const ASSIST_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
// The model Submissions already uses; tried when the first one is not there.
export const ASSIST_MODEL_FALLBACK = '@cf/meta/llama-3.1-8b-instruct'

// The screens an answer may point to, by the id switchSection() takes. 'marketplace'
// is the one that is a page of its own (/marketplace/admin), not a section.
export const ASSIST_SCREENS: Record<string, string> = {
  overview: 'Overview: today\'s numbers, who holds which pass, money from passes, what is waiting',
  attendees: 'Attendees: every registered person, search, edit, passes, export',
  sessions: 'Conference: the programme by day and hall, speakers, halls',
  exhibitors: 'Exhibitors: the exhibiting companies and their booths',
  'booth-requests': 'Booth Requests: booth booking requests to review',
  'floor-plan': 'Floor Plan: which stands are sold, held and free',
  sponsorship: 'Sponsorship: sponsorship and branding sales',
  awards: 'Awards: award categories and nominees',
  announcements: 'Announcements: the live feed in the app',
  innovation: 'Innovation Talks: stage talks and the showcase',
  'startup-pitch': 'Startup Pitch: pitches and the investor panel',
  inquiries: 'Inquiries: enquiries from the website (booths, sponsors, speakers, delegations)',
  submissions: 'Submissions: logos, photos and team lists sent by email',
  media: 'Media & Influencer: media pass requests to approve',
  marketplace: 'AI Marketplace: company listings to review',
  payments: 'Payments: online payments, payments to confirm, GST invoices, offers',
  workshops: 'Workshop Seats: who sits in which workshop',
  'badge-desk': 'Badge Desk: check-in on the day and the desk accounts',
  boothleads: 'Booth Leads: badges scanned at each booth',
  analytics: 'Analytics: charts and reports',
  rooms: 'Boardrooms: boardroom bookings by the hour',
  after: 'After the Event: feedback survey, photo emails, exhibitor results',
  whatsapp: 'WhatsApp: messages from our own number and the replies',
  liveqa: 'Live Q&A: questions from the room in each session',
  delhi2027: 'Delhi 2027: Delhi passes, partner and discount codes',
  agentsummit: 'AI Agent Summit 2027: passes, showcase applications, partners',
  settings: 'Settings: email, switches, the free pass waiting list, staff accounts',
}

export type AssistFact = { k: string; v: string; s: string }
export type AssistFacts = { asOf: string; event: string; lines: AssistFact[] }

const MAX_LINES = 90
const MAX_LABEL = 120
const MAX_VALUE = 220
const MAX_QUESTION = 300

// Only short, plain lines get through, so whatever the page sends, the model is given a
// list of totals and not a pasted table of people. An "@" anywhere drops the line.
export function cleanFacts(raw: any): AssistFacts {
  const text = (v: any, max: number) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
  const out: AssistFacts = { asOf: text(raw?.asOf, 60), event: text(raw?.event, 160), lines: [] }
  const list = Array.isArray(raw?.lines) ? raw.lines : []
  for (const l of list) {
    if (out.lines.length >= MAX_LINES) break
    const k = text(l?.k, MAX_LABEL)
    const v = typeof l?.v === 'number' && Number.isFinite(l.v) ? String(l.v) : text(l?.v, MAX_VALUE)
    if (!k || !v || k.includes('@') || v.includes('@')) continue
    const s = ASSIST_SCREENS[String(l?.s || '')] ? String(l.s) : ''
    out.lines.push({ k, v, s })
  }
  return out
}

// Every number written in a text, as digits: "₹4,51,900" is 451900, "2026-11-20" is
// 2026, 11 and 20, "1.5" is 1.5. Grouping commas go; leading zeros go.
export function numbersIn(text: string): string[] {
  const out: string[] = []
  for (const m of String(text || '').matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    let n = m[0].replace(/,/g, '')
    if (n.includes('.')) n = n.replace(/0+$/, '').replace(/\.$/, '')
    n = n.replace(/^0+(?=\d)/, '')
    if (n) out.push(n)
  }
  return out
}

// The numbers in an answer that neither the facts nor the question hold. Counting words
// in a sentence ("three things are waiting") is allowed up to ten as digits too.
export function unsupportedNumbers(answer: string, facts: AssistFacts, question = ''): string[] {
  const known = new Set<string>()
  const all = [facts.asOf, facts.event, question, ...facts.lines.map(l => l.k + ' ' + l.v)].join(' \n ')
  for (const n of numbersIn(all)) known.add(n)
  const bad: string[] = []
  for (const n of numbersIn(answer)) {
    if (known.has(n)) continue
    if (/^\d+$/.test(n) && Number(n) <= 10) continue
    if (!bad.includes(n)) bad.push(n)
  }
  return bad
}

export function factsText(f: AssistFacts): string {
  const head = [f.event ? 'Event: ' + f.event : '', f.asOf ? 'As of: ' + f.asOf : ''].filter(Boolean)
  return head.concat(f.lines.map(l => '- ' + l.k + ': ' + l.v + (l.s ? ' [screen: ' + l.s + ']' : ''))).join('\n')
}

// The model is asked for {"answer": "...", "open": ["payments"]}. A model that wrote
// plain words instead still gives an answer, with no screens.
export function parseAssistReply(raw: any): { answer: string; open: string[] } {
  let obj: any = raw && typeof raw === 'object' ? raw : null
  const s = typeof raw === 'string' ? raw : ''
  if (!obj && s) {
    const m = s.match(/\{[\s\S]*\}/)
    if (m) { try { obj = JSON.parse(m[0]) } catch { obj = null } }
  }
  let answer = obj ? String(obj.answer ?? '') : s
  answer = answer.replace(/[*#`_]+/g, '').replace(/\s+\n/g, '\n').trim().slice(0, 900)
  const open = (obj && Array.isArray(obj.open) ? obj.open : [])
    .map((x: any) => String(x || '').trim()).filter((x: string) => !!ASSIST_SCREENS[x])
  return { answer, open: Array.from(new Set<string>(open)).slice(0, 3) }
}

export function assistMessages(mode: 'ask' | 'brief', q: string, facts: AssistFacts) {
  const screens = Object.entries(ASSIST_SCREENS).map(([id, what]) => id + ' = ' + what).join('\n')
  const system = [
    'You are the assistant inside the admin dashboard of Bharat AI Innovation, an AI expo and conference in India, talking to the organisers.',
    'Answer ONLY from the FACTS, which are the dashboard\'s own numbers. Never invent a number, a name or a date.',
    'Copy every number exactly as the FACTS write it. Do not add numbers up, and do not work out percentages or averages.',
    'Write plain, short English: at most four sentences, no headings, no lists, no tables, no markdown.',
    'If the FACTS do not answer the question, say so in one sentence and name the screen most likely to have it.',
    'Reply with JSON only, in this shape: {"answer": "your words", "open": ["screen id"]}. "open" holds up to three screen ids from SCREENS, the most useful first.',
    '',
    'SCREENS:',
    screens,
  ].join('\n')
  const ask = mode === 'brief'
    ? 'Write today\'s briefing for the organiser in at most three short sentences. First what is waiting on them, the largest and most urgent first; then anything that moved today. Mention only numbers above zero. Put the screens for the first things to do in "open".'
    : q
  return [
    { role: 'system', content: system },
    { role: 'user', content: 'FACTS:\n' + factsText(facts) + '\n\nQUESTION: ' + ask },
  ]
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))])
}

const app = new Hono<{ Bindings: any }>()

app.post('/api/admin/assist', async (c) => {
  const body: any = await c.req.json().catch(() => ({}))
  const mode: 'ask' | 'brief' = body?.mode === 'brief' ? 'brief' : 'ask'
  const q = String(body?.q || '').replace(/\s+/g, ' ').trim()
  if (mode === 'ask' && !q) return c.json({ error: 'Type a question first.' }, 400)
  if (q.length > MAX_QUESTION) return c.json({ error: 'Please keep the question under ' + MAX_QUESTION + ' characters.' }, 400)
  const facts = cleanFacts(body?.facts)
  if (!facts.lines.length) return c.json({ error: 'The dashboard numbers did not come with the question. Refresh the page and ask again.' }, 400)
  if (!c.env.AI) return c.json({ ok: true, ai: false, why: 'not_configured' })

  const messages = assistMessages(mode, q, facts)
  let raw: any = null
  let model = ''
  for (const m of [ASSIST_MODEL, ASSIST_MODEL_FALLBACK]) {
    try {
      const out: any = await withTimeout(c.env.AI.run(m, { messages, max_tokens: 400, temperature: 0.1 }), 20000)
      raw = out?.response ?? out?.result?.response ?? null
      if (raw) { model = m; break }
    } catch { /* the next model, then the page's own lines */ }
  }
  if (!raw) return c.json({ ok: true, ai: false, why: 'unavailable' })
  const reply = parseAssistReply(raw)
  if (!reply.answer) return c.json({ ok: true, ai: false, why: 'empty' })
  const bad = unsupportedNumbers(reply.answer, facts, q)
  // Held back, not shown with a warning: the organiser acts on these numbers.
  if (bad.length) return c.json({ ok: true, ai: false, why: 'unchecked_numbers', open: reply.open })
  return c.json({ ok: true, ai: true, answer: reply.answer, open: reply.open, model })
})

export default app
