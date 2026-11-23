import { Hono } from 'hono'
import { titledName } from '../lib/greet'
import { whatsappNumber, shownNumber, isNoEmail } from './team-guests'
import { pageUrl, hiddenPhotos, NOT_ME, OPT_OUT } from './photos'
import { photoLink } from './photo-store'
import ATTENDEES from '../data/attendee-photos.json'

// ==================== WHATSAPP (23 Nov 2026) ====================
//
// The organiser: "build utility so we can send msg using whatsapp, photos, pass, social
// media creative". Until now the only WhatsApp in the platform was a wa.me link opened on
// a team member's own phone, one guest at a time (routes/team-guests.ts). This sends from
// the event's own WhatsApp Business number, through Meta's WhatsApp Cloud API.
//
// What can be sent (Admin -> WhatsApp, public/js/admin-whatsapp.js):
//   photos  each person found in the event photos gets one photo of themselves and a
//           button to their own album page (/photos/a<id>, routes/photos.ts)
//   pass    "your pass is ready" with a button that opens it
//   custom  a picture or an announcement the team writes (a social media creative, a
//           date, a thank-you), to everyone, to who came, to one pass, or to a pasted list
//   reply   an answer to someone who wrote to us (free text, for 24 hours after they wrote)
//
// How WhatsApp works, in four rules this file is built around:
// 1. We may only START a conversation with a message Meta has approved (a "template").
//    Each of ours is submitted from the screen and can be sent once Meta says APPROVED.
// 2. Free text is allowed only for 24 hours after the person last wrote to us.
// 3. A new number may write to a limited number of people a day (250 at first). We count
//    and hold the rest for tomorrow, so nothing fails for that reason.
// 4. Anyone can say STOP. We never write to them again, from any send.
//
// Sending: a bulk send writes one 'queued' row per person in wa_messages (migration 0065).
// The minute clock (POST /api/cron/tick -> whatsappTick) and the Admin page while it is
// open send them, a few a minute, only between 9 am and 9 pm in India. A row is claimed
// (queued -> sending) before the call to Meta, so two clocks cannot send one twice.
// Meta's webhook (POST /api/whatsapp/webhook) then reports delivered, read or failed, and
// brings replies in.
//
// Every button goes through /w/<row id>-<signature>, which notes the tap and sends them
// on; a pass button signs them in to the app there, for seven days after the send, as
// the links in our emails do.
//
// The five values from Meta are read from Worker secrets first (WHATSAPP_TOKEN,
// WHATSAPP_PHONE_ID, WHATSAPP_WABA_ID, WHATSAPP_APP_SECRET, WHATSAPP_APP_ID) and then
// from app_settings (whatsapp_token ...), where Admin -> WhatsApp -> Setup saves them.
// No route ever sends a value back: only whether each one is there.
// Every /api/admin/* route here is behind the admin middleware in index.tsx.

type Hooks = {
  audit?: (c: any, action: string, entity?: string, entityId?: any, detail?: any, actor?: { actor: string; kind: string }) => Promise<void>
  actor?: (c: any) => string
  columns?: (c: any) => Promise<Set<string>>
  passToken?: (c: any, id: number) => Promise<string>
  // The app link that signs this person in and opens `action` (index.tsx).
  signIn?: (c: any, eventId: number, email: string, action: string) => Promise<string>
  appUrl?: (c: any) => Promise<string>
}
let hooks: Hooks = {}
export function configureWhatsapp(h: Hooks) { hooks = { ...hooks, ...h } }

const wa = new Hono<{ Bindings: any }>()
const SITE = 'https://bharataiinnovation.com'
const GRAPH = 'https://graph.facebook.com'
export const DEFAULT_GRAPH_VERSION = 'v27.0'
export const FOOTER = 'Reply STOP to stop these messages'
export const DEFAULT_PER_MINUTE = 20
export const DEFAULT_DAILY_LIMIT = 250
export const DEFAULT_HOURS: [number, number] = [9, 21]
export const SIGN_IN_DAYS = 7
export const BATCH_MAX = 5000
const MIGRATION = 'npx wrangler d1 execute bharatai-production --remote --file=./migrations/0065_whatsapp.sql'

const one = async (c: any, sql: string, ...args: any[]) => (await c.env.DB.prepare(sql).bind(...args).first()) as any
const all = async (c: any, sql: string, ...args: any[]) => (((await c.env.DB.prepare(sql).bind(...args).all()) as any).results || []) as any[]
const run = async (c: any, sql: string, ...args: any[]) => (await c.env.DB.prepare(sql).bind(...args).run()) as any
const changed = (r: any) => Number(r?.meta?.changes ?? 0)
const oneLine = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const actorOf = (c: any) => { try { return hooks.actor ? hooks.actor(c) : '' } catch { return '' } }
const note = async (c: any, action: string, id: any, detail: any) => { if (hooks.audit) { try { await hooks.audit(c, action, 'whatsapp', id, detail) } catch { /* a log line never fails a send */ } } }

// ---------- pure helpers (scripts/verify/smoke-whatsapp.mjs checks them through the routes) ----------

// The built-in messages. The name carries a version: Meta does not let an approved
// message's words change freely, so a new wording is a new name (_v2).
export type Tpl = { name: string; builtin: boolean; kind: 'photos' | 'pass' | 'custom'; title: string; category: 'MARKETING' | 'UTILITY'; text: string;
  image: boolean; imageUrl: string; button: string; buttonUrl: string; samples: string[]; what: string }
export const BUILT_IN: Record<string, Tpl> = {
  bhai_event_photos_v1: { name: 'bhai_event_photos_v1', builtin: true, kind: 'photos', title: 'Your photos from the event', category: 'UTILITY',
    text: 'Hello {{1}}, we found {{2}} of you at Bharat AI Innovation 2026 in Mumbai. Tap the button to see them and save the ones you like.',
    image: true, imageUrl: '/images/og/gallery.jpg', button: 'See my photos', buttonUrl: '', samples: ['Asha', '12 photos'],
    what: 'One photo of the person, and a button to their own album.' },
  bhai_event_pass_v1: { name: 'bhai_event_pass_v1', builtin: true, kind: 'pass', title: 'Your pass is ready', category: 'UTILITY',
    text: 'Hello {{1}}, your {{2}} for {{3}} is ready. Tap the button to open it on your phone, and show the QR code at the entry desk.',
    image: false, imageUrl: '', button: 'Open my pass', buttonUrl: '', samples: ['Asha', 'Delegate Pass', 'Bharat AI Innovation 2026'],
    what: 'Tells them their pass is ready, with a button that opens it.' },
}
export const TEMPLATE_FOR: Record<string, string> = { photos: 'bhai_event_photos_v1', pass: 'bhai_event_pass_v1' }

// A picture or announcement the team wrote, as a template. With greet, the words Meta
// approves start "Hello {{1}}," and the person's name is the only blank.
export function customTpl(r: any): Tpl {
  const greet = Number(r.greet ?? 1) === 1
  const body = String(r.body || '').trim()
  return { name: String(r.name), builtin: false, kind: 'custom', title: String(r.title || r.name), category: String(r.category) === 'UTILITY' ? 'UTILITY' : 'MARKETING',
    text: (greet ? 'Hello {{1}},\n\n' : '') + body, image: !!r.image_url, imageUrl: String(r.image_url || ''), button: String(r.button_text || ''), buttonUrl: String(r.button_url || ''),
    samples: greet ? ['Asha'] : [], what: '' }
}

// The words with the blanks filled, as the person reads them.
export function fill(text: string, params: string[]): string { return text.replace(/\{\{(\d+)\}\}/g, (_m, n) => String(params[Number(n) - 1] ?? '')) }

// A value for a blank: Meta refuses a new line, a tab or four spaces in a row.
export const blank = (v: unknown, max = 60) => oneLine(v, max) || '-'
export const photoWords = (n: number) => (n === 1 ? '1 photo' : n + ' photos')

// What we send Meta to have a message approved.
export function metaTemplate(t: Tpl, handle: string) {
  const comps: any[] = []
  if (t.image) comps.push({ type: 'HEADER', format: 'IMAGE', example: { header_handle: [handle] } })
  const body: any = { type: 'BODY', text: t.text }
  if (t.samples.length) body.example = { body_text: [t.samples] }
  comps.push(body, { type: 'FOOTER', text: FOOTER })
  if (t.button) comps.push({ type: 'BUTTONS', buttons: [{ type: 'URL', text: t.button, url: SITE + '/w/{{1}}', example: ['1-abc123def456'] }] })
  return { name: t.name, language: 'en', category: t.category, components: comps }
}

// What we send Meta to send one message.
export function metaMessage(row: any, code: string) {
  let p: any = {}
  try { p = JSON.parse(row.payload || '{}') } catch { p = {} }
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to: String(row.wa_number) }
  if (row.template) {
    const comps: any[] = []
    if (p.image) comps.push({ type: 'header', parameters: [{ type: 'image', image: { link: p.image } }] })
    if (Array.isArray(p.params) && p.params.length) comps.push({ type: 'body', parameters: p.params.map((t: string) => ({ type: 'text', text: String(t) })) })
    if (p.button) comps.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] })
    return { ...base, type: 'template', template: { name: row.template, language: { code: 'en' }, components: comps } }
  }
  if (p.image) return { ...base, type: 'image', image: { link: p.image, caption: String(p.text || '').slice(0, 1024) } }
  return { ...base, type: 'text', text: { preview_url: false, body: String(p.text || '').slice(0, 4096) } }
}

// Meta's error numbers in plain words. stop: the fault is ours or the account's, so the
// send pauses and the person stays in the queue. soft: Meta is busy; the next minute
// tries again by itself. Anything else is about that one person.
export const ERRORS: Record<number, { words: string; stop?: boolean; soft?: boolean; mine?: boolean }> = {
  131026: { words: 'This number is not on WhatsApp, or their WhatsApp is too old to receive it.' },
  131049: { words: 'WhatsApp held it back: this person has had many business messages lately. Try again in a day or two.' },
  131047: { words: 'More than 24 hours have passed since they wrote to us, so a typed reply is not allowed. Send them an approved message instead.' },
  131056: { words: 'Too many messages to this one number in a short time. Try again later.' },
  131021: { words: 'That is our own WhatsApp number.' },
  132012: { words: 'WhatsApp did not accept the details for this person (their name has something unusual in it).' },
  131048: { words: 'WhatsApp is limiting how many messages our number may send. Open WhatsApp Manager and look at the number: it may have been reported.', stop: true },
  131064: { words: 'WhatsApp is limiting our number because of how its messages were classified. Open WhatsApp Manager to see why.', stop: true },
  131042: { words: 'Meta needs a way to pay: add a card in WhatsApp Manager, under Payment settings.', stop: true },
  131031: { words: 'Meta has locked the WhatsApp account. Open WhatsApp Manager to see why.', stop: true },
  368: { words: 'Meta has restricted the WhatsApp account for breaking a rule. Open WhatsApp Manager to see why.', stop: true },
  133010: { words: 'Our number is not registered with WhatsApp yet. Register it once in Setup, with a 6-digit PIN.', stop: true },
  133016: { words: 'Too many tries to register our number: Meta allows 10 in 3 days. Try again after 72 hours.', stop: true },
  190: { words: 'The access key from Meta has expired or is wrong. Paste a new one in Setup.', stop: true },
  10: { words: 'The access key from Meta is not allowed to send WhatsApp messages. Give the system user the two WhatsApp permissions and make a new key.', stop: true },
  200: { words: 'The access key from Meta is not allowed to send WhatsApp messages. Give the system user the two WhatsApp permissions and make a new key.', stop: true },
  132000: { words: 'The message does not match what Meta approved. Tell the developer: the number of blanks differs.', stop: true, mine: true },
  132001: { words: 'Meta has not approved this message yet, or it has been removed.', stop: true, mine: true },
  132015: { words: 'Meta has paused this message because people reacted badly to it. It cannot be sent for now.', stop: true, mine: true },
  132016: { words: 'Meta has switched this message off for good. Write a new one.', stop: true, mine: true },
  130429: { words: 'Sending too fast for WhatsApp. It carries on by itself in a minute.', soft: true },
  80007: { words: 'Sending too fast for WhatsApp. It carries on by itself in a minute.', soft: true },
  131000: { words: 'WhatsApp had a problem of its own. It tries again by itself.', soft: true },
  131016: { words: 'WhatsApp is not available just now. It tries again by itself.', soft: true },
  131057: { words: 'The WhatsApp account is in maintenance. It tries again by itself.', soft: true },
}
export function errorWords(code: number, message: string): string {
  const e = ERRORS[code]
  return e ? e.words : (oneLine(message, 220) || 'WhatsApp refused this message.') + (code > 0 ? ' (WhatsApp error ' + code + ')' : '')
}

export const STOP_RE = /^\s*(stop|stop messages?|unsubscribe|opt\s*-?\s*out|band karo|बंद|बंद करो)\s*[.!]*\s*$/i
export const START_RE = /^\s*(start|subscribe|unstop)\s*[.!]*\s*$/i

// India's hour of the day, 0 to 23.
export const indiaHour = (now = Date.now()) => new Date(now + 5.5 * 3600000).getUTCHours()
export function hoursOf(v: string): [number, number] {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(String(v || '').trim())
  if (!m) return DEFAULT_HOURS
  const a = Number(m[1]), b = Number(m[2])
  return a >= 0 && b <= 24 && a < b ? [a, b] : DEFAULT_HOURS
}
// TIER_250 -> 250, TIER_2K -> 2000, TIER_UNLIMITED -> 100000 (ours: more than we will ever send in a day).
export function tierNumber(tier: unknown): number {
  const t = String(tier || '').toUpperCase().replace(/^TIER_/, '')
  if (t === 'UNLIMITED') return 100000
  const m = /^(\d+)(K?)$/.exec(t)
  return m ? Number(m[1]) * (m[2] ? 1000 : 1) : 0
}

async function hmacHex(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder()
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const s = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)))
  return Array.from(s).map(b => b.toString(16).padStart(2, '0')).join('')
}
function sameText(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}
const linkSecret = (c: any) => String(c.env?.WHATSAPP_LINK_SECRET || c.env?.SESSION_SECRET || c.env?.ADMIN_SECRET || '')
// The end of every button link: the row and a signature, so a link cannot be guessed.
export async function codeFor(c: any, id: number | string): Promise<string> {
  const s = linkSecret(c)
  return s ? `${id}-${(await hmacHex(s, 'wa:' + id)).slice(0, 12)}` : ''
}
// What Meta is told to say back when it first calls the webhook. Ours to choose, so it
// is made from the server's own secret: one value less for the organiser to carry.
export async function verifyToken(c: any): Promise<string> {
  const own = String(c.env?.WHATSAPP_VERIFY_TOKEN || '').trim()
  if (own) return own
  const s = String(c.env?.ADMIN_SECRET || c.env?.SESSION_SECRET || '')
  return s ? 'bhai' + (await hmacHex(s, 'wa-webhook-verify')).slice(0, 24) : ''
}

// ---------- the five values from Meta, and our own settings ----------

type Cfg = { token: string; phoneId: string; wabaId: string; appSecret: string; appId: string; version: string; from: Record<string, string>; set: Record<string, string> }
const VALUES: [keyof Cfg & string, string, string][] = [
  ['token', 'WHATSAPP_TOKEN', 'whatsapp_token'], ['phoneId', 'WHATSAPP_PHONE_ID', 'whatsapp_phone_id'], ['wabaId', 'WHATSAPP_WABA_ID', 'whatsapp_waba_id'],
  ['appSecret', 'WHATSAPP_APP_SECRET', 'whatsapp_app_secret'], ['appId', 'WHATSAPP_APP_ID', 'whatsapp_app_id']]
async function loadCfg(c: any): Promise<Cfg> {
  const set: Record<string, string> = {}
  try { for (const r of await all(c, "SELECT key, value FROM app_settings WHERE key LIKE 'whatsapp%'")) set[String(r.key)] = String(r.value ?? '') } catch { /* no settings table */ }
  const cfg: any = { from: {}, set, version: /^v\d{1,3}\.\d$/.test(set.whatsapp_graph_version || '') ? set.whatsapp_graph_version : DEFAULT_GRAPH_VERSION }
  for (const [name, env, key] of VALUES) {
    const e = String(c.env?.[env] || '').trim(), s = String(set[key] || '').trim()
    cfg[name] = e || s
    cfg.from[name] = e ? 'secret' : s ? 'saved' : ''
  }
  return cfg as Cfg
}
const connected = (cfg: Cfg) => !!(cfg.token && cfg.phoneId)
const numberSetting = (cfg: Cfg, key: string, dflt: number, min: number, max: number) => {
  const n = parseInt(String(cfg.set[key] ?? ''), 10)
  return Number.isFinite(n) && n >= min && n <= max ? n : dflt
}
const saveSetting = (c: any, key: string, value: string) => run(c,
  "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", key, value)

let tablesThere = false
async function ready(c: any): Promise<boolean> {
  if (tablesThere) return true
  try { await one(c, 'SELECT 1 FROM wa_messages LIMIT 1'); await one(c, 'SELECT 1 FROM wa_templates LIMIT 1'); tablesThere = true } catch { tablesThere = false }
  return tablesThere
}
const notReady = (c: any) => c.json({ ready: false, error: 'The WhatsApp tables are not in the database yet. Run migration 0065 once.', command: MIGRATION }, 409)

// ---------- talking to Meta ----------

type GraphOut = { ok: boolean; status: number; json: any; code: number; message: string }
async function graph(cfg: Cfg, method: string, path: string, body?: any, extra: { raw?: any; headers?: Record<string, string>; scheme?: string; timeoutMs?: number } = {}): Promise<GraphOut> {
  const url = /^https:/.test(path) ? path : `${GRAPH}/${cfg.version}/${path.replace(/^\//, '')}`
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), extra.timeoutMs || 12000)
  try {
    const headers: Record<string, string> = { Authorization: `${extra.scheme || 'Bearer'} ${cfg.token}`, ...(extra.headers || {}) }
    if (body !== undefined && extra.raw === undefined) headers['Content-Type'] = 'application/json'
    const res = await fetch(url, { method, headers, body: extra.raw !== undefined ? extra.raw : body !== undefined ? JSON.stringify(body) : undefined, signal: ctl.signal })
    const json: any = await res.json().catch(() => ({}))
    const e = json?.error
    if (!res.ok || e) return { ok: false, status: res.status, json, code: Number(e?.code || 0), message: oneLine(e?.error_data?.details || e?.error_user_msg || e?.message || 'HTTP ' + res.status, 300) }
    return { ok: true, status: res.status, json, code: 0, message: '' }
  } catch (err: any) {
    return { ok: false, status: 0, json: {}, code: -1, message: err?.name === 'AbortError' ? 'WhatsApp did not answer in time.' : 'WhatsApp could not be reached.' }
  } finally { clearTimeout(timer) }
}

// Sends one row that is already claimed ('sending'). Never throws.
async function deliver(c: any, cfg: Cfg, row: any): Promise<{ ok: boolean; code: number; words: string; stop: boolean; soft: boolean; mine: boolean }> {
  const r = await graph(cfg, 'POST', `${cfg.phoneId}/messages`, metaMessage(row, await codeFor(c, row.id)))
  if (r.ok) {
    const id = String(r.json?.messages?.[0]?.id || '')
    await run(c, "UPDATE wa_messages SET status = 'sent', wamid = ?, sent_at = datetime('now'), updated_at = datetime('now'), error = NULL, error_code = NULL WHERE id = ? AND status = 'sending'", id || null, row.id)
    return { ok: true, code: 0, words: '', stop: false, soft: false, mine: false }
  }
  const e = ERRORS[r.code] || {}
  // No answer at all (a timeout, a dropped line): Meta may or may not have it, so it is
  // never sent again by itself.
  const soft = !!e.soft || (r.status >= 500 && r.code !== -1)
  return { ok: false, code: r.code, words: errorWords(r.code, r.message), stop: !!e.stop, soft, mine: !!e.mine }
}
const failRow = (c: any, id: number, words: string, code: number) =>
  run(c, "UPDATE wa_messages SET status = 'failed', error = ?, error_code = ?, updated_at = datetime('now') WHERE id = ?", words, code || null, id)

// One message now: a test, a reply, a single person. The row is written and sent in one go.
async function sendNow(c: any, cfg: Cfg, row: Record<string, any>): Promise<{ ok: boolean; id: number; error?: string }> {
  const cols = Object.keys(row)
  const ins = await run(c, `INSERT INTO wa_messages (${cols.join(', ')}, status, updated_at) VALUES (${cols.map(() => '?').join(', ')}, 'sending', datetime('now'))`, ...cols.map(k => row[k] ?? null))
  const id = Number(ins?.meta?.last_row_id || 0)
  const out = await deliver(c, cfg, { ...row, id })
  if (out.ok) return { ok: true, id }
  await failRow(c, id, out.words, out.code)
  return { ok: false, id, error: out.words }
}

// ---------- templates ----------

async function templateRows(c: any): Promise<any[]> { return all(c, 'SELECT * FROM wa_templates ORDER BY builtin DESC, created_at DESC, name') }
function shapeTemplates(rows: any[]): any[] {
  const by = new Map(rows.map(r => [String(r.name), r]))
  const out: any[] = []
  const shape = (t: Tpl, r: any) => ({ name: t.name, builtin: t.builtin, kind: t.kind, title: t.title, what: t.what, category: t.category, text: t.text, footer: FOOTER,
    image: t.image, image_url: t.imageUrl, button: t.button, button_url: t.buttonUrl, samples: t.samples, preview: fill(t.text, t.samples),
    status: String(r?.status || 'draft'), meta_category: r?.meta_category || '', rejected_reason: r?.rejected_reason || '', submitted_at: r?.submitted_at || '', created_at: r?.created_at || '' })
  for (const t of Object.values(BUILT_IN)) out.push(shape(t, by.get(t.name)))
  for (const r of rows) if (!Number(r.builtin) && !BUILT_IN[String(r.name)]) out.push(shape(customTpl(r), r))
  return out
}
async function templateBy(c: any, name: string): Promise<{ tpl: Tpl; row: any } | null> {
  const row = await one(c, 'SELECT * FROM wa_templates WHERE name = ?', name).catch(() => null)
  if (BUILT_IN[name]) return { tpl: BUILT_IN[name], row }
  return row ? { tpl: customTpl(row), row } : null
}
// What Meta says about each of our messages, copied into wa_templates.
async function refreshTemplates(c: any, cfg: Cfg): Promise<string> {
  if (!cfg.token || !cfg.wabaId) return ''
  const r = await graph(cfg, 'GET', `${cfg.wabaId}/message_templates?fields=name,status,category,rejected_reason,language&limit=250`)
  if (!r.ok) return errorWords(r.code, r.message)
  const mine = new Set((await templateRows(c)).map(x => String(x.name)))
  for (const t of (r.json?.data || []) as any[]) {
    const name = String(t.name || '')
    if (!/^en/i.test(String(t.language || 'en'))) continue
    if (BUILT_IN[name] && !mine.has(name)) { await run(c, "INSERT OR IGNORE INTO wa_templates (name, builtin, title, category, status) VALUES (?, 1, ?, ?, 'draft')", name, BUILT_IN[name].title, BUILT_IN[name].category); mine.add(name) }
    if (!mine.has(name)) continue
    const why = String(t.rejected_reason || '')
    await run(c, "UPDATE wa_templates SET status = ?, meta_id = ?, meta_category = ?, rejected_reason = ?, updated_at = datetime('now') WHERE name = ?",
      String(t.status || 'PENDING'), String(t.id || '') || null, String(t.category || '') || null, why && why !== 'NONE' ? why : null, name)
  }
  return ''
}
// The picture's bytes: one we hold (the uploads bucket) or one of the site's own files.
async function pictureBytes(c: any, url: string): Promise<{ bytes: ArrayBuffer; type: string } | null> {
  try {
    if (url.startsWith('/api/uploads/')) {
      const obj = c.env.UPLOADS ? await c.env.UPLOADS.get(url.slice('/api/uploads/'.length)) : null
      if (!obj) return null
      return { bytes: await obj.arrayBuffer(), type: obj.httpMetadata?.contentType || (/\.png$/i.test(url) ? 'image/png' : 'image/jpeg') }
    }
    const req = new Request(SITE + url)
    const res = c.env.ASSETS ? await c.env.ASSETS.fetch(req) : await fetch(req)
    if (!res.ok) return null
    return { bytes: await res.arrayBuffer(), type: /\.png$/i.test(url) ? 'image/png' : 'image/jpeg' }
  } catch { return null }
}
// Meta wants a sample picture uploaded to it before it reviews a message that has one.
async function uploadSample(c: any, cfg: Cfg, url: string): Promise<{ handle?: string; error?: string }> {
  const pic = await pictureBytes(c, url)
  if (!pic) return { error: 'The picture could not be read. Add it again.' }
  let appId = cfg.appId
  if (!appId) { const d = await graph(cfg, 'GET', `debug_token?input_token=${encodeURIComponent(cfg.token)}`); appId = String(d.json?.data?.app_id || '') }
  if (!appId) { const a = await graph(cfg, 'GET', 'app?fields=id'); appId = String(a.json?.id || '') }
  if (!appId) return { error: 'Meta needs the App ID for a message with a picture. Paste it in Setup (Meta: App settings, Basic).' }
  const start = await graph(cfg, 'POST', `${appId}/uploads?file_name=sample.${pic.type === 'image/png' ? 'png' : 'jpg'}&file_length=${pic.bytes.byteLength}&file_type=${encodeURIComponent(pic.type)}`, undefined, { scheme: 'OAuth' })
  const session = String(start.json?.id || '')
  if (!start.ok || !session) return { error: 'Meta did not take the picture: ' + errorWords(start.code, start.message) }
  const up = await graph(cfg, 'POST', `${session}`, undefined, { raw: pic.bytes, scheme: 'OAuth', headers: { file_offset: '0', 'Content-Type': 'application/octet-stream' } })
  const handle = String(up.json?.h || '')
  return up.ok && handle ? { handle } : { error: 'Meta did not take the picture: ' + errorWords(up.code, up.message) }
}

// ---------- who gets it ----------

type AttAlbum = { group: number; came: boolean; check: boolean; photos: string[]; best: string[] }
const ATT = ATTENDEES as unknown as { albums: Record<string, AttAlbum> }
type Person = { attendee_id: number | null; person: string; name: string; number: string; params: string[]; image: string; target: string; signin?: { email: string; action: string }; text: string }
type Built = { people: Person[]; skipped: Record<string, number>; error?: string }
export type Spec = { kind: string; template?: string; event?: number; audience?: string; list?: string; only_new?: boolean; attendee_id?: number; number?: string; name?: string }
const SKIP_WORDS: Record<string, string> = { no_mobile: 'have no mobile number', bad_number: 'have a mobile number that is not complete', stopped: 'asked us to stop on WhatsApp',
  unsubscribed: 'unsubscribed from our updates', already: 'were already sent this', no_photo: 'have no photo left to show', photo_no: 'asked us not to match their photos', twice: 'share a number with someone above' }

async function sentAlready(c: any, spec: Spec, tpl: Tpl): Promise<Set<string>> {
  try {
    const rows = spec.kind === 'custom'
      ? await all(c, "SELECT DISTINCT wa_number FROM wa_messages WHERE direction = 'out' AND test = 0 AND status NOT IN ('failed', 'skipped', 'cancelled') AND template = ?", tpl.name)
      : await all(c, "SELECT DISTINCT wa_number FROM wa_messages WHERE direction = 'out' AND test = 0 AND status NOT IN ('failed', 'skipped', 'cancelled') AND kind = ? AND event_id = ?", spec.kind, Number(spec.event || 1))
    return new Set(rows.map(r => String(r.wa_number)))
  } catch { return new Set() }
}
async function stoppedNumbers(c: any): Promise<Set<string>> {
  try { return new Set((await all(c, 'SELECT wa_number FROM wa_contacts WHERE opted_out_at IS NOT NULL')).map(r => String(r.wa_number))) } catch { return new Set() }
}

// Everyone a send would reach, each with their own words, picture and link, and a count
// of everyone left out and why. links: false only counts (no signing, no extra reads).
async function build(c: any, spec: Spec, tpl: Tpl, links = true): Promise<Built> {
  const eventId = Number(spec.event || 1)
  const skipped: Record<string, number> = {}
  const skip = (why: string) => { skipped[why] = (skipped[why] || 0) + 1 }
  const people: Person[] = []
  const stopped = await stoppedNumbers(c)
  const already = spec.only_new === false ? new Set<string>() : await sentAlready(c, spec, tpl)
  const seen = new Set<string>()
  const cols = hooks.columns ? await hooks.columns(c).catch(() => new Set<string>()) : new Set<string>()
  const has = (col: string) => !cols.size || cols.has(col)
  // The checks every send shares. Returns the number as WhatsApp wants it, or ''.
  const numberFor = (a: any, checkConsent: boolean): string => {
    const raw = String(a.mobile || '').trim()
    if (!raw) { skip('no_mobile'); return '' }
    const n = whatsappNumber(raw)
    if (!n) { skip('bad_number'); return '' }
    if (stopped.has(n)) { skip('stopped'); return '' }
    if (checkConsent && (a.unsubscribed_at || String(a.marketing_consent ?? '') === '0')) { skip('unsubscribed'); return '' }
    if (already.has(n)) { skip('already'); return '' }
    if (seen.has(n)) { skip('twice'); return '' }
    seen.add(n)
    return n
  }
  const consent = (has('unsubscribed_at') ? ', unsubscribed_at' : '') + (has('marketing_consent') ? ', marketing_consent' : '')
  const greet = (name: unknown) => blank(titledName(name) || 'there', 60)
  const one1 = spec.attendee_id ? ' AND id = ' + Math.floor(Number(spec.attendee_id)) : ''

  if (spec.kind === 'photos') {
    const keys = Object.keys(ATT.albums || {})
    const ids = keys.map(k => Number(k.slice(1))).filter(n => Number.isInteger(n) && n > 0 && (!spec.attendee_id || n === Number(spec.attendee_id)))
    const rowsById = new Map<number, any>()
    for (let i = 0; i < ids.length; i += 90) {
      const ch = ids.slice(i, i + 90)
      for (const a of await all(c, `SELECT id, name, email, mobile${consent} FROM attendees WHERE event_id = 1 AND id IN (${ch.map(() => '?').join(',')})`, ...ch)) rowsById.set(Number(a.id), a)
    }
    const out = new Set<string>(), notMe = new Map<string, Set<string>>()
    try {
      for (const r of await all(c, 'SELECT action, entity_id, detail FROM admin_audit WHERE action IN (?, ?)', NOT_ME, OPT_OUT)) {
        const k = String(r.entity_id)
        if (r.action === OPT_OUT) { out.add(k); continue }
        try { const d = JSON.parse(r.detail || '{}'); if (d.photo) { const s = notMe.get(k) || new Set<string>(); s.add(String(d.photo)); notMe.set(k, s) } } catch { /* not JSON */ }
      }
    } catch { /* no audit table */ }
    const hidden = await hiddenPhotos(c)
    const chosen: { p: Person; pick: string[] }[] = []
    for (const id of ids) {
      const key = 'a' + id, al = ATT.albums[key], a = rowsById.get(id)
      if (!a || !al) continue // no longer registered
      if (out.has(key)) { skip('photo_no'); continue }
      const no = notMe.get(key)
      const keep = (d: string) => !(no && no.has(d)) && !(hidden && hidden.has(d))
      const mine = (al.photos || []).filter(keep)
      if (!mine.length) { skip('no_photo'); continue }
      const n = numberFor(a, true)
      if (!n) continue
      const params = [greet(a.name), photoWords(mine.length)]
      chosen.push({ p: { attendee_id: id, person: key, name: String(a.name || ''), number: n, params, image: '', target: '', text: fill(tpl.text, params) },
        pick: [...(al.best || []).filter(keep), ...mine].slice(0, 6) })
    }
    if (links && chosen.length) {
      // One read for every picture, then each link is signed for its own person.
      const want = [...new Set(chosen.flatMap(x => x.pick))], pid = new Map<string, string>()
      try {
        for (let i = 0; i < want.length; i += 90) {
          const ch = want.slice(i, i + 90)
          for (const r of await all(c, `SELECT pid, drive_id FROM event_photos WHERE event_id = 1 AND hidden = 0 AND drive_id IN (${ch.map(() => '?').join(',')})`, ...ch)) pid.set(String(r.drive_id), String(r.pid))
        }
      } catch { /* no event_photos table: nobody has a picture to send */ }
      for (const x of chosen) {
        const d = x.pick.find(q => pid.has(q))
        if (!d) { skip('no_photo'); continue }
        x.p.image = await photoLink(c, pid.get(d)!, 'm', x.p.person)
        x.p.target = await pageUrl(c, x.p.person)
        if (!x.p.image || !/[?&]k=[0-9a-f]+/.test(x.p.target)) { skip('no_photo'); continue }
        people.push(x.p)
      }
    } else for (const x of chosen) people.push(x.p)
    return { people, skipped }
  }

  if (spec.kind === 'pass') {
    const ev = await one(c, 'SELECT title FROM events WHERE id = ?', eventId).catch(() => null)
    const title = blank(ev?.title || 'Bharat AI Innovation', 60)
    const where = "payment_status IN ('paid', 'waived')" + (has('main_event') ? ' AND main_event = 1' : '') + (has('entry_status') ? " AND COALESCE(entry_status, '') <> 'waitlisted'" : '')
    const appUrl = hooks.appUrl ? await hooks.appUrl(c).catch(() => SITE + '/app') : SITE + '/app'
    for (const a of await all(c, `SELECT id, name, email, mobile, badge_type, registration_source${consent} FROM attendees WHERE event_id = ? AND ${where}${one1} ORDER BY id`, eventId)) {
      const n = numberFor(a, false) // their own pass: a service message, sent even to someone who left the mailing list
      if (!n) continue
      const params = [greet(a.name), blank(a.badge_type || 'pass', 40), title]
      const p: Person = { attendee_id: Number(a.id), person: '', name: String(a.name || ''), number: n, params, image: '', target: '', text: fill(tpl.text, params) }
      const src = String(a.registration_source || '')
      if (isNoEmail(a.email) || /^(team|exhibitor):/.test(src)) p.target = links && hooks.passToken ? `${SITE}/pass/${await hooks.passToken(c, Number(a.id))}` : SITE
      else { p.target = `${appUrl}?email=${encodeURIComponent(String(a.email || ''))}&action=download-pass`; p.signin = { email: String(a.email || ''), action: 'download-pass' } }
      people.push(p)
    }
    return { people, skipped }
  }

  // A picture or an announcement.
  const mk = (id: number | null, name: string, n: string): Person => {
    const params = tpl.samples.length ? [greet(name)] : []
    return { attendee_id: id, person: '', name, number: n, params, image: tpl.imageUrl ? SITE + tpl.imageUrl : '', target: tpl.buttonUrl, text: fill(tpl.text, params) }
  }
  const aud = String(spec.audience || 'everyone')
  if (aud === 'list') {
    for (const line of String(spec.list || '').split(/\r?\n/).slice(0, BATCH_MAX)) {
      if (!line.trim()) continue
      const m = /(\+?\d[\d\s().-]{7,}\d)/.exec(line)
      const name = oneLine(line.replace(m ? m[1] : '', '').replace(/[,;|\t]+/g, ' '), 80)
      const n = numberFor({ mobile: m ? m[1] : 'x' }, false)
      if (n) people.push(mk(null, name, n))
    }
    return { people, skipped }
  }
  if (aud === 'one' && spec.number) {
    const n = numberFor({ mobile: spec.number }, false)
    if (n) people.push(mk(null, oneLine(spec.name, 80), n))
    return { people, skipped }
  }
  let where = has('main_event') ? 'a.main_event = 1' : '1 = 1'
  const args: any[] = [eventId]
  const cameSql = (withTable: boolean) => 'a.checked_in_at IS NOT NULL' + (withTable ? ' OR EXISTS (SELECT 1 FROM checkins ck WHERE ck.attendee_id = a.id)' : '')
  const paidOnly = " AND a.payment_status IN ('paid', 'waived')"
  const run1 = async (withTable: boolean) => {
    let w = where
    if (aud === 'came') w += ` AND (${cameSql(withTable)})`
    else if (aud === 'not_came') w += ` AND NOT (${cameSql(withTable)})`
    else if (aud.startsWith('pass:')) { w += ' AND a.badge_type = ?' + (/^visitor/i.test(aud.slice(5)) ? '' : paidOnly); if (args.length === 1) args.push(aud.slice(5)) }
    else if (aud !== 'everyone' && aud !== 'one') throw new Error('audience')
    return all(c, `SELECT a.id, a.name, a.mobile${consent.replace(/, /g, ', a.')} FROM attendees a WHERE a.event_id = ? AND ${w}${one1.replace('AND id', 'AND a.id')} ORDER BY a.id`, ...args)
  }
  let rows: any[]
  try { rows = await run1(true) } catch (e: any) {
    if (e?.message === 'audience') return { people, skipped, error: 'Choose who gets it.' }
    rows = await run1(false) // a database without the daily check-in table (migration 0051)
  }
  for (const a of rows) { const n = numberFor(a, true); if (n) people.push(mk(Number(a.id), String(a.name || ''), n)) }
  return { people, skipped }
}
const skippedWords = (s: Record<string, number>) => Object.keys(s).filter(k => s[k] > 0).map(k => ({ why: k, n: s[k], words: SKIP_WORDS[k] || k }))
const rowFor = (p: Person, spec: Spec, tpl: Tpl, by: string, extra: Record<string, any> = {}) => ({
  event_id: Number(spec.event || 1), direction: 'out', kind: spec.kind, wa_number: p.number, attendee_id: p.attendee_id, person: p.person, name: p.name.slice(0, 120), template: tpl.name,
  payload: JSON.stringify({ params: p.params, image: p.image, button: tpl.button ? 1 : 0, text: p.text, ...(p.signin ? { signin: p.signin } : {}) }), target_url: p.target, created_by: by, ...extra })

// ---------- the queue ----------

async function usedToday(c: any): Promise<number> {
  const r = await one(c, "SELECT COUNT(DISTINCT wa_number) AS n FROM wa_messages WHERE direction = 'out' AND template <> '' AND own = 0 AND sent_at > datetime('now', '-1 day')").catch(() => null)
  return Number(r?.n || 0)
}
async function pauseBatches(c: any, words: string, batchId: number | null) {
  const stamp = "status = 'paused', note = ?"
  if (batchId) await run(c, `UPDATE wa_batches SET ${stamp} WHERE id = ? AND status = 'running'`, words, batchId)
  else await run(c, `UPDATE wa_batches SET ${stamp} WHERE status = 'running'`, words)
}

// Sends what is waiting. Called every minute by the clock and by the Admin page while it
// is open; the per-minute number holds whoever calls.
export async function whatsappTick(c: any, o: { budgetMs?: number } = {}): Promise<any> {
  if (!(await ready(c))) return { ready: false }
  const cfg = await loadCfg(c)
  if (!connected(cfg)) return { connected: false }
  if (cfg.set.whatsapp_sending === 'off') return { off: true }
  const started = Date.now(), budget = Math.min(25000, Math.max(1000, o.budgetMs || 20000))
  await run(c, "UPDATE wa_messages SET status = 'failed', error = ?, updated_at = datetime('now') WHERE status = 'sending' AND updated_at < datetime('now', '-10 minutes')",
    'No answer came back from WhatsApp for this one. Check with the person before sending it again.')
  const perMinute = numberSetting(cfg, 'whatsapp_per_minute', DEFAULT_PER_MINUTE, 1, 60)
  const daily = numberSetting(cfg, 'whatsapp_daily_limit', DEFAULT_DAILY_LIMIT, 1, 1000000)
  const [from, to] = hoursOf(cfg.set.whatsapp_hours || '')
  const h = indiaHour()
  const open = h >= from && h < to
  const lastMinute = Number((await one(c, "SELECT COUNT(*) AS n FROM wa_messages WHERE direction = 'out' AND batch_id IS NOT NULL AND sent_at > datetime('now', '-60 seconds')"))?.n || 0)
  let used = await usedToday(c)
  let room = Math.max(0, perMinute - lastMinute)
  const out = { sent: 0, failed: 0, skipped: 0, held_for_tomorrow: 0, outside_hours: !open, paused: '' }
  // One person's message (no bulk send behind it) goes at any hour and is never counted
  // against the minute; a bulk send's go inside the hours, up to the day's number.
  const rows = await all(c, `SELECT m.*, b.status AS batch_status FROM wa_messages m LEFT JOIN wa_batches b ON b.id = m.batch_id
     WHERE m.direction = 'out' AND m.status = 'queued' AND (m.batch_id IS NULL OR b.status = 'running')
     ORDER BY (m.batch_id IS NOT NULL), m.id LIMIT ?`, perMinute + 10)
  const stopped = rows.length ? await stoppedNumbers(c) : new Set<string>()
  const fails = new Map<number, number>()
  for (const row of rows) {
    if (Date.now() - started > budget) break
    const bulk = row.batch_id != null
    if (bulk) {
      if (!open) continue
      if (used >= daily) { out.held_for_tomorrow++; continue }
      if (room <= 0) continue
    }
    if (changed(await run(c, "UPDATE wa_messages SET status = 'sending', updated_at = datetime('now') WHERE id = ? AND status = 'queued'", row.id)) !== 1) continue
    if (stopped.has(String(row.wa_number))) {
      await run(c, "UPDATE wa_messages SET status = 'skipped', error = 'Asked us to stop on WhatsApp', updated_at = datetime('now') WHERE id = ?", row.id)
      out.skipped++; continue
    }
    const r = await deliver(c, cfg, row)
    if (r.ok) { out.sent++; if (bulk) { room--; used++; fails.set(row.batch_id, 0) } continue }
    if (r.stop || r.soft) {
      // Ours to fix, or Meta's: the person goes back in the queue untouched.
      await run(c, "UPDATE wa_messages SET status = 'queued', updated_at = datetime('now') WHERE id = ? AND status = 'sending'", row.id)
      if (r.stop) {
        if (bulk) await pauseBatches(c, r.words, r.mine ? Number(row.batch_id) : null)
        else await failRow(c, row.id, r.words, r.code)
        out.paused = r.words
        await note(c, 'whatsapp.paused', row.batch_id, { code: r.code, why: r.words })
      }
      break
    }
    await failRow(c, row.id, r.words, r.code)
    out.failed++
    if (bulk) {
      // Five in a row refused: something is wrong with the send itself, not with five people.
      const n = (fails.get(row.batch_id) || 0) + 1
      fails.set(row.batch_id, n)
      if (n >= 5) { const words = 'Five in a row were refused, so this send was paused. The last reason: ' + r.words; await pauseBatches(c, words, Number(row.batch_id)); out.paused = words; break }
    }
  }
  await run(c, `UPDATE wa_batches SET status = 'done', finished_at = datetime('now') WHERE status = 'running'
     AND NOT EXISTS (SELECT 1 FROM wa_messages m WHERE m.batch_id = wa_batches.id AND m.status IN ('queued', 'sending'))`)
  return out
}

// ---------- Meta calls us: delivered, read, failed, and replies ----------

wa.get('/api/whatsapp/webhook', async (c) => {
  const want = await verifyToken(c)
  const got = String(c.req.query('hub.verify_token') || '')
  if (c.req.query('hub.mode') !== 'subscribe' || !want || !sameText(got, want)) return c.text('Forbidden', 403)
  return c.text(String(c.req.query('hub.challenge') || ''), 200)
})

const stamp = (seconds: unknown) => {
  const n = Number(seconds)
  const d = Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date()
  return d.toISOString().slice(0, 19).replace('T', ' ')
}
async function applyStatus(c: any, s: any) {
  const id = String(s?.id || ''), st = String(s?.status || ''), when = stamp(s?.timestamp)
  if (!id) return
  const cat = s?.pricing?.category ? String(s.pricing.category).slice(0, 40) : null
  const typ = s?.pricing?.type ? String(s.pricing.type).slice(0, 40) : null
  const price = ', price_category = COALESCE(?, price_category), price_type = COALESCE(?, price_type)'
  if (st === 'sent') await run(c, `UPDATE wa_messages SET status = CASE WHEN status IN ('queued', 'sending', 'sent') THEN 'sent' ELSE status END, sent_at = COALESCE(sent_at, ?), updated_at = datetime('now')${price} WHERE wamid = ?`, when, cat, typ, id)
  else if (st === 'delivered') await run(c, `UPDATE wa_messages SET status = CASE WHEN status = 'read' THEN 'read' ELSE 'delivered' END, delivered_at = COALESCE(delivered_at, ?), error = NULL, error_code = NULL, updated_at = datetime('now')${price} WHERE wamid = ?`, when, cat, typ, id)
  else if (st === 'read') await run(c, `UPDATE wa_messages SET status = 'read', read_at = COALESCE(read_at, ?), delivered_at = COALESCE(delivered_at, ?), error = NULL, error_code = NULL, updated_at = datetime('now')${price} WHERE wamid = ?`, when, when, cat, typ, id)
  else if (st === 'failed') {
    const e = (s.errors || [])[0] || {}
    const code = Number(e.code || 0)
    await run(c, "UPDATE wa_messages SET status = CASE WHEN status IN ('delivered', 'read') THEN status ELSE 'failed' END, error = ?, error_code = ?, updated_at = datetime('now') WHERE wamid = ?",
      errorWords(code, e?.error_data?.details || e.message || e.title || ''), code || null, id)
  }
}
async function setStopped(c: any, number: string, on: boolean, by: string) {
  await run(c, `INSERT INTO wa_contacts (wa_number, opted_out_at, opted_out_by, updated_at) VALUES (?, ${on ? "datetime('now')" : 'NULL'}, ?, datetime('now'))
     ON CONFLICT(wa_number) DO UPDATE SET opted_out_at = excluded.opted_out_at, opted_out_by = excluded.opted_out_by, updated_at = excluded.updated_at`, number, on ? by : null)
  if (on) await run(c, "UPDATE wa_messages SET status = 'skipped', error = 'Asked us to stop on WhatsApp', updated_at = datetime('now') WHERE wa_number = ? AND direction = 'out' AND status = 'queued'", number)
}
async function applyInbound(c: any, cfg: Cfg, m: any, profile: string) {
  const from = String(m?.from || '').replace(/\D/g, '')
  const id = String(m?.id || '')
  if (!from || !id) return // a person known only by a username: no number to file them under
  const type = String(m.type || '')
  const text = type === 'text' ? String(m.text?.body || '') : type === 'button' ? String(m.button?.text || '')
    : type === 'interactive' ? String(m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '')
    : type === 'reaction' ? String(m.reaction?.emoji || '') : ''
  const last = await one(c, "SELECT attendee_id, name, event_id FROM wa_messages WHERE wa_number = ? AND direction = 'out' ORDER BY id DESC LIMIT 1", from).catch(() => null)
  const ins = await run(c, `INSERT OR IGNORE INTO wa_messages (event_id, direction, kind, wa_number, attendee_id, name, payload, status, wamid, created_at, updated_at)
     VALUES (?, 'in', 'in', ?, ?, ?, ?, 'received', ?, ?, datetime('now'))`,
    Number(last?.event_id || 1), from, last?.attendee_id ?? null, oneLine(last?.name || profile, 120),
    JSON.stringify({ type, text: text.slice(0, 4000), reply_to: String(m.context?.id || '') }), id, stamp(m.timestamp))
  if (changed(ins) !== 1) return // Meta sends a message again when it is unsure we got it
  await run(c, `INSERT INTO wa_contacts (wa_number, name, last_in_at, unread, updated_at) VALUES (?, ?, datetime('now'), 1, datetime('now'))
     ON CONFLICT(wa_number) DO UPDATE SET name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE wa_contacts.name END, last_in_at = excluded.last_in_at, unread = wa_contacts.unread + 1, updated_at = excluded.updated_at`,
    from, oneLine(profile, 120))
  const stop = STOP_RE.test(text), start = !stop && START_RE.test(text)
  if (!stop && !start) return
  const was = await one(c, 'SELECT opted_out_at FROM wa_contacts WHERE wa_number = ?', from).catch(() => null)
  await setStopped(c, from, stop, 'reply')
  // They are told once, when it changes. Someone sending STOP and START in turns gets
  // two answers a day and no more: each answer is a message we pay for.
  if ((stop ? !!was?.opted_out_at : !was?.opted_out_at) || !connected(cfg)) return
  const autos = await one(c, "SELECT COUNT(*) AS n FROM wa_messages WHERE wa_number = ? AND direction = 'out' AND created_by = 'automatic' AND created_at > datetime('now', '-1 day')", from).catch(() => null)
  if (Number(autos?.n || 0) >= 2) return
  const words = stop ? 'Done. You will not get WhatsApp messages from Bharat AI Innovation any more. Reply START if you change your mind.'
    : 'Thank you. You will get WhatsApp messages from Bharat AI Innovation again. Reply STOP at any time to stop them.'
  await sendNow(c, cfg, { event_id: Number(last?.event_id || 1), direction: 'out', kind: 'reply', wa_number: from, attendee_id: last?.attendee_id ?? null, name: oneLine(last?.name || profile, 120),
    template: '', payload: JSON.stringify({ text: words, auto: 1 }), created_by: 'automatic' })
}

wa.post('/api/whatsapp/webhook', async (c) => {
  // Meta's calls are a few kilobytes. Anything huge is not Meta and is not read.
  if (Number(c.req.header('content-length') || 0) > 2000000) return c.json({ error: 'too large' }, 413)
  const raw = await c.req.text()
  const cfg = await loadCfg(c)
  // Without Meta's app secret nobody can prove a call is Meta's, so nothing is believed.
  if (!cfg.appSecret) return c.json({ error: 'not configured' }, 503)
  const sig = String(c.req.header('X-Hub-Signature-256') || '').replace(/^sha256=/i, '').toLowerCase()
  if (!sameText(sig, await hmacHex(cfg.appSecret, raw))) return c.json({ error: 'bad signature' }, 401)
  if (!(await ready(c))) return c.json({ error: 'not ready' }, 503)
  let body: any = null
  try { body = JSON.parse(raw) } catch { return c.json({ error: 'bad body' }, 400) }
  for (const entry of (body?.entry || []) as any[]) {
    for (const ch of (entry?.changes || []) as any[]) {
      const v = ch?.value || {}
      try {
        if (ch.field === 'message_template_status_update' && v.message_template_name) {
          await run(c, "UPDATE wa_templates SET status = ?, rejected_reason = ?, updated_at = datetime('now') WHERE name = ?",
            String(v.event || 'PENDING').toUpperCase(), v.reason && v.reason !== 'NONE' ? String(v.reason).slice(0, 200) : null, String(v.message_template_name))
          continue
        }
        if (ch.field !== 'messages') continue
        // Another number on the same Meta account is not ours to record.
        if (cfg.phoneId && v.metadata?.phone_number_id && String(v.metadata.phone_number_id) !== cfg.phoneId) continue
        for (const s of (v.statuses || []) as any[]) await applyStatus(c, s)
        const names = new Map<string, string>(((v.contacts || []) as any[]).map(p => [String(p?.wa_id || ''), String(p?.profile?.name || '')]))
        for (const m of (v.messages || []) as any[]) await applyInbound(c, cfg, m, names.get(String(m?.from || '')) || '')
      } catch { /* one bad item never loses the rest of the call */ }
    }
  }
  return c.json({ ok: true })
})

// ---------- the button on every message ----------

wa.get('/w/:code', async (c, next) => {
  // /w/ is shared with the campus recording links (/w/jnu, /w/djsce in index.tsx, sent in
  // the reports email). Only our own shape is ours; anything else goes on to that route,
  // which before 23 Nov 2026 never ran: every recording link landed on the home page.
  const m = /^(\d{1,12})-([0-9a-f]{12})$/.exec(String(c.req.param('code') || ''))
  if (!m) return next()
  c.header('Cache-Control', 'no-store')
  c.header('X-Robots-Tag', 'noindex, nofollow')
  if (!sameText(m[2], (await codeFor(c, m[1])).split('-')[1] || '')) return c.redirect(SITE + '/', 302)
  const row = await one(c, 'SELECT id, event_id, payload, target_url, sent_at, created_at FROM wa_messages WHERE id = ?', Number(m[1])).catch(() => null)
  let target = String(row?.target_url || '')
  if (!row || !/^https:\/\//.test(target)) return c.redirect(SITE + '/', 302)
  // A link checker is not the person: it is sent on, and nothing is noted or signed in.
  const robot = /facebookexternalhit|^WhatsApp\/|bot\b|crawler|spider|preview/i.test(c.req.header('User-Agent') || '')
  if (!robot) {
    try { await run(c, "UPDATE wa_messages SET clicked_at = COALESCE(clicked_at, datetime('now')) WHERE id = ?", row.id) } catch { /* the tap still works */ }
    let p: any = {}
    try { p = JSON.parse(row.payload || '{}') } catch { p = {} }
    const sent = Date.parse(String(row.sent_at || row.created_at || '').replace(' ', 'T') + 'Z')
    if (p.signin?.email && hooks.signIn && Number.isFinite(sent) && Date.now() - sent < SIGN_IN_DAYS * 86400000) {
      try { const href = await hooks.signIn(c, Number(row.event_id || 1), String(p.signin.email), String(p.signin.action || 'download-pass')); if (/^https:\/\//.test(href)) target = href } catch { /* the plain link asks them to sign in */ }
    }
  }
  return c.redirect(target, 302)
})

// ---------- Admin -> WhatsApp ----------

async function overview(c: any) {
  const cfg = await loadCfg(c)
  const isReady = await ready(c)
  const state = { token: !!cfg.token, phone_id: !!cfg.phoneId, waba_id: !!cfg.wabaId, app_secret: !!cfg.appSecret, app_id: !!cfg.appId }
  const [from, to] = hoursOf(cfg.set.whatsapp_hours || '')
  let checked: any = null
  try { checked = cfg.set.whatsapp_checked ? JSON.parse(cfg.set.whatsapp_checked) : null } catch { checked = null }
  const base: any = { ready: isReady, command: isReady ? '' : MIGRATION, connected: connected(cfg), config: state, config_from: cfg.from,
    webhook_url: SITE + '/api/whatsapp/webhook', verify_token: await verifyToken(c), checked,
    settings: { sending: cfg.set.whatsapp_sending === 'off' ? 'off' : 'on', per_minute: numberSetting(cfg, 'whatsapp_per_minute', DEFAULT_PER_MINUTE, 1, 60),
      daily_limit: numberSetting(cfg, 'whatsapp_daily_limit', DEFAULT_DAILY_LIMIT, 1, 1000000), hours_from: from, hours_to: to },
    open_now: indiaHour() >= from && indiaHour() < to, footer: FOOTER }
  if (!isReady) return { ...base, templates: shapeTemplates([]), batches: [], totals: {}, used_today: 0, unread: 0, events: [], passes: [] }
  const [tpls, batches, totals, unread, events] = await Promise.all([
    templateRows(c),
    all(c, 'SELECT * FROM wa_batches ORDER BY id DESC LIMIT 15'),
    all(c, "SELECT status, COUNT(*) AS n, SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS taps FROM wa_messages WHERE direction = 'out' AND test = 0 GROUP BY status"),
    one(c, 'SELECT COALESCE(SUM(unread), 0) AS n FROM wa_contacts'),
    all(c, 'SELECT id, title FROM events ORDER BY id').catch(() => [] as any[])])
  const ids = batches.map(b => Number(b.id))
  const per = ids.length ? await all(c, `SELECT batch_id, status, COUNT(*) AS n, SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS taps FROM wa_messages WHERE batch_id IN (${ids.map(() => '?').join(',')}) GROUP BY batch_id, status`, ...ids) : []
  const replied = ids.length ? await all(c, `SELECT o.batch_id, COUNT(DISTINCT o.wa_number) AS n FROM wa_messages o WHERE o.batch_id IN (${ids.map(() => '?').join(',')})
     AND EXISTS (SELECT 1 FROM wa_messages i WHERE i.direction = 'in' AND i.wa_number = o.wa_number AND i.id > o.id) GROUP BY o.batch_id`, ...ids) : []
  const sum: Record<string, number> = {}
  let taps = 0
  for (const t of totals) { sum[String(t.status)] = Number(t.n); taps += Number(t.taps || 0) }
  return { ...base, templates: shapeTemplates(tpls), used_today: await usedToday(c), unread: Number(unread?.n || 0), events,
    totals: { ...sum, taps },
    batches: batches.map(b => {
      const counts: Record<string, number> = {}
      let t = 0
      for (const p of per) if (Number(p.batch_id) === Number(b.id)) { counts[String(p.status)] = Number(p.n); t += Number(p.taps || 0) }
      return { ...b, counts, taps: t, replied: Number(replied.find(x => Number(x.batch_id) === Number(b.id))?.n || 0) }
    }) }
}
wa.get('/api/admin/whatsapp', async (c) => { c.header('Cache-Control', 'no-store'); return c.json(await overview(c)) })

// Setup: the values from Meta. An empty box is left as it is; nothing is ever sent back.
wa.post('/api/admin/whatsapp/config', async (c) => {
  const b = await c.req.json().catch(() => ({})) as any
  const saved: string[] = []
  const was = await loadCfg(c)
  const rules: [string, string, RegExp, string][] = [
    ['token', 'whatsapp_token', /^[A-Za-z0-9_\-|.]{40,600}$/, 'The access key should be one long line of letters and numbers, with no spaces.'],
    ['phone_id', 'whatsapp_phone_id', /^\d{8,24}$/, 'The Phone number ID is digits only (it is not the phone number).'],
    ['waba_id', 'whatsapp_waba_id', /^\d{8,24}$/, 'The WhatsApp Business Account ID is digits only.'],
    ['app_secret', 'whatsapp_app_secret', /^[a-f0-9]{24,64}$/i, 'The App secret is 32 letters and numbers.'],
    ['app_id', 'whatsapp_app_id', /^\d{8,24}$/, 'The App ID is digits only.']]
  for (const [field, key, re, words] of rules) {
    const v = String(b[field] ?? '').trim()
    if (!v) continue
    if (!re.test(v)) return c.json({ error: words, field }, 400)
    await saveSetting(c, key, v)
    saved.push(field)
  }
  if (!saved.length) return c.json({ error: 'Paste at least one value.' }, 400)
  // A different WhatsApp account (moving from Meta's test number to our own) has approved
  // nothing yet: Meta approves each message per account. A different number has not been
  // checked or registered. Neither may go on showing what the old one said.
  const now = await loadCfg(c)
  if (was.wabaId && now.wabaId !== was.wabaId && (await ready(c))) {
    await run(c, "UPDATE wa_templates SET status = 'draft', meta_id = NULL, meta_category = NULL, rejected_reason = NULL, submitted_at = NULL, updated_at = datetime('now')")
    saved.push('templates_reset')
  }
  if (was.phoneId && now.phoneId !== was.phoneId) await saveSetting(c, 'whatsapp_checked', '')
  await note(c, 'whatsapp.config', null, { saved })
  return c.json({ success: true, saved, ...(await overview(c)) })
})

// Asks Meta who we are: the number, its name, its health, how many people a day, and
// whether Meta is set to call our webhook. Saves what it learns for the screen.
wa.post('/api/admin/whatsapp/check', async (c) => {
  const cfg = await loadCfg(c)
  if (!connected(cfg)) return c.json({ error: 'Paste the access key and the Phone number ID first.' }, 409)
  const a = await graph(cfg, 'GET', `${cfg.phoneId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status`)
  if (!a.ok) return c.json({ error: errorWords(a.code, a.message) }, 502)
  const extra = await graph(cfg, 'GET', `${cfg.phoneId}?fields=whatsapp_business_manager_messaging_limit,status,name_status`)
  const tier = String(extra.json?.whatsapp_business_manager_messaging_limit || '')
  const limit = tierNumber(tier)
  const out: any = { at: new Date().toISOString(), number: String(a.json.display_phone_number || ''), name: String(a.json.verified_name || ''), quality: String(a.json.quality_rating || ''),
    number_status: String(extra.json?.status || ''), name_status: String(extra.json?.name_status || ''), tier, daily_limit: limit || null, webhook: '' }
  if (limit) await saveSetting(c, 'whatsapp_daily_limit', String(limit))
  if (cfg.wabaId) {
    // Meta only calls our webhook for this account once the app is "subscribed" to it.
    // Another app (a vendor's) may be subscribed to the same account: only ours counts.
    const subs = await graph(cfg, 'GET', `${cfg.wabaId}/subscribed_apps`)
    const apps = (subs.json?.data || []) as any[]
    const ours = cfg.appId ? apps.some(x => String(x?.whatsapp_business_api_data?.id || x?.id || '') === cfg.appId) : apps.length > 0
    if (subs.ok && !ours) { const s = await graph(cfg, 'POST', `${cfg.wabaId}/subscribed_apps`); out.webhook = s.ok ? 'subscribed' : 'not subscribed: ' + errorWords(s.code, s.message) }
    else out.webhook = subs.ok ? 'subscribed' : 'could not be checked: ' + errorWords(subs.code, subs.message)
    if (await ready(c)) out.templates_error = await refreshTemplates(c, cfg)
  }
  await saveSetting(c, 'whatsapp_checked', JSON.stringify(out))
  return c.json({ success: true, check: out, ...(await overview(c)) })
})

// Registers our number with WhatsApp's Cloud API, once. Until then Meta answers every
// send with 133010 and the number's status is PENDING. The PIN is the number's two-step
// PIN: the organiser chooses it the first time (it becomes the PIN) or types the one already
// set. It goes to Meta and is kept nowhere, not even in the audit log. Meta allows 10 tries
// in 3 days, so a number that is already CONNECTED is not registered again.
wa.post('/api/admin/whatsapp/register', async (c) => {
  const cfg = await loadCfg(c)
  if (!connected(cfg)) return c.json({ error: 'Paste the access key and the Phone number ID first.' }, 409)
  const b = await c.req.json().catch(() => ({})) as any
  const pin = String(b.pin ?? '').replace(/\s+/g, '')
  if (!/^\d{6}$/.test(pin)) return c.json({ error: 'The PIN is 6 digits.', field: 'pin' }, 400)
  const remember = async (status: string) => {
    let ck: any = {}
    try { ck = JSON.parse(cfg.set.whatsapp_checked || '{}') || {} } catch { ck = {} }
    ck.number_status = status
    ck.at = new Date().toISOString()
    await saveSetting(c, 'whatsapp_checked', JSON.stringify(ck))
  }
  const before = await graph(cfg, 'GET', `${cfg.phoneId}?fields=status`)
  if (before.ok && String(before.json?.status || '').toUpperCase() === 'CONNECTED') {
    await remember('CONNECTED')
    return c.json({ success: true, already: true, number_status: 'CONNECTED', ...(await overview(c)) })
  }
  // Meta took longer than 12 seconds on 23 Nov and still registered the number.
  const r = await graph(cfg, 'POST', `${cfg.phoneId}/register`, { messaging_product: 'whatsapp', pin }, { timeoutMs: 30000 })
  await note(c, 'whatsapp.register', null, { ok: r.ok, code: r.code || null })
  if (!r.ok && r.code === -1) {
    // No answer is not a no: ask Meta what the number's status is now.
    const now = await graph(cfg, 'GET', `${cfg.phoneId}?fields=status`)
    if (now.ok && String(now.json?.status || '').toUpperCase() === 'CONNECTED') {
      await remember('CONNECTED')
      return c.json({ success: true, number_status: 'CONNECTED', ...(await overview(c)) })
    }
  }
  if (!r.ok) return c.json({ error: errorWords(r.code, r.message) }, 502)
  const after = await graph(cfg, 'GET', `${cfg.phoneId}?fields=status`)
  const status = after.ok ? String(after.json?.status || '').toUpperCase() || 'CONNECTED' : 'CONNECTED'
  await remember(status)
  return c.json({ success: true, number_status: status, ...(await overview(c)) })
})

wa.post('/api/admin/whatsapp/settings', async (c) => {
  const b = await c.req.json().catch(() => ({})) as any
  if (b.sending === 'on' || b.sending === 'off') await saveSetting(c, 'whatsapp_sending', b.sending)
  const pm = parseInt(b.per_minute, 10)
  if (Number.isFinite(pm)) { if (pm < 1 || pm > 60) return c.json({ error: 'Between 1 and 60 a minute.' }, 400); await saveSetting(c, 'whatsapp_per_minute', String(pm)) }
  const dl = parseInt(b.daily_limit, 10)
  if (Number.isFinite(dl)) { if (dl < 1 || dl > 1000000) return c.json({ error: 'The number of people a day must be 1 or more.' }, 400); await saveSetting(c, 'whatsapp_daily_limit', String(dl)) }
  const hf = parseInt(b.hours_from, 10), ht = parseInt(b.hours_to, 10)
  if (Number.isFinite(hf) || Number.isFinite(ht)) {
    if (!(hf >= 0 && ht <= 24 && hf < ht)) return c.json({ error: 'The hours must be like 9 to 21.' }, 400)
    await saveSetting(c, 'whatsapp_hours', hf + '-' + ht)
  }
  await note(c, 'whatsapp.settings', null, { sending: b.sending, per_minute: b.per_minute, daily_limit: b.daily_limit, hours: [b.hours_from, b.hours_to] })
  return c.json({ success: true, ...(await overview(c)) })
})

wa.get('/api/admin/whatsapp/templates', async (c) => {
  if (!(await ready(c))) return notReady(c)
  let error = ''
  if (c.req.query('refresh')) error = await refreshTemplates(c, await loadCfg(c))
  return c.json({ templates: shapeTemplates(await templateRows(c)), error })
})

// A picture or an announcement the team writes. Saved as a draft; Meta sees it on Submit.
wa.post('/api/admin/whatsapp/templates', async (c) => {
  if (!(await ready(c))) return notReady(c)
  const b = await c.req.json().catch(() => ({})) as any
  const title = oneLine(b.title, 60)
  const body = String(b.body ?? '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  const btnText = oneLine(b.button_text, 25), btnUrl = String(b.button_url ?? '').trim()
  if (title.length < 3) return c.json({ error: 'Give it a short name, so you can find it later.', field: 'title' }, 400)
  if (body.length < 10) return c.json({ error: 'Write the message: at least a sentence.', field: 'body' }, 400)
  if (body.length > 900) return c.json({ error: 'The message is too long for WhatsApp. Keep it under 900 letters.', field: 'body' }, 400)
  if (/\{\{|\}\}/.test(body)) return c.json({ error: 'Take the curly brackets out of the message.', field: 'body' }, 400)
  if (!!btnText !== !!btnUrl) return c.json({ error: 'A button needs both its words and its link, or leave both empty.', field: 'button_url' }, 400)
  if (btnUrl && !/^https:\/\/[^\s]{4,400}$/.test(btnUrl)) return c.json({ error: 'The link must start with https://', field: 'button_url' }, 400)
  let imageUrl = ''
  const img = String(b.image ?? '')
  if (img) {
    const m = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(img)
    if (!m) return c.json({ error: 'The picture must be a JPG or a PNG.', field: 'image' }, 400)
    if (!c.env.UPLOADS) return c.json({ error: 'Pictures cannot be stored on this server.' }, 503)
    const bin = atob(m[2])
    if (bin.length > 5 * 1024 * 1024) return c.json({ error: 'The picture is over 5 MB, which is WhatsApp’s limit. Use a smaller one.', field: 'image' }, 400)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const rand = Array.from(crypto.getRandomValues(new Uint8Array(10))).map(x => x.toString(16).padStart(2, '0')).join('')
    const key = `whatsapp/${rand}.${m[1] === 'image/png' ? 'png' : 'jpg'}`
    await c.env.UPLOADS.put(key, bytes, { httpMetadata: { contentType: m[1], cacheControl: 'public, max-age=31536000' } })
    imageUrl = '/api/uploads/' + key
  } else if (/^\/api\/uploads\/whatsapp\/[a-f0-9]{20}\.(jpg|png)$/.test(String(b.image_url ?? ''))) imageUrl = String(b.image_url)
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 28) || 'message'
  const name = `bhai_c_${slug}_${Array.from(crypto.getRandomValues(new Uint8Array(2))).map(x => x.toString(16).padStart(2, '0')).join('')}`
  // "Change" on a draft: the new one takes its place.
  const old = String(b.replace ?? '')
  if (old && !BUILT_IN[old]) await run(c, "DELETE FROM wa_templates WHERE name = ? AND builtin = 0 AND status = 'draft'", old)
  await run(c, `INSERT INTO wa_templates (name, builtin, title, category, body, greet, image_url, button_text, button_url, status, created_by, updated_at)
     VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, datetime('now'))`,
    name, title, b.category === 'UTILITY' ? 'UTILITY' : 'MARKETING', body, b.greet === false || b.greet === 0 ? 0 : 1, imageUrl, btnText, btnUrl, actorOf(c))
  await note(c, 'whatsapp.template.create', name, { title, image: !!imageUrl, button: !!btnText })
  return c.json({ success: true, name, templates: shapeTemplates(await templateRows(c)) })
})

wa.post('/api/admin/whatsapp/templates/:name/submit', async (c) => {
  if (!(await ready(c))) return notReady(c)
  const cfg = await loadCfg(c)
  if (!cfg.token || !cfg.wabaId) return c.json({ error: 'Connect WhatsApp first: Setup needs the access key and the WhatsApp Business Account ID.' }, 409)
  const name = String(c.req.param('name'))
  const got = await templateBy(c, name)
  if (!got) return c.json({ error: 'That message is not here any more.' }, 404)
  const st = String(got.row?.status || 'draft')
  if (st !== 'draft') return c.json({ error: st === 'APPROVED' ? 'Meta has already approved this message.' : 'This message is already with Meta (' + st.toLowerCase() + ').' }, 409)
  let handle = ''
  if (got.tpl.image) {
    const up = await uploadSample(c, cfg, got.tpl.imageUrl)
    if (!up.handle) return c.json({ error: up.error }, 502)
    handle = up.handle
  }
  const r = await graph(cfg, 'POST', `${cfg.wabaId}/message_templates`, metaTemplate(got.tpl, handle))
  if (!r.ok) return c.json({ error: 'Meta did not take the message: ' + errorWords(r.code, r.json?.error?.error_user_msg || r.message) }, 502)
  await run(c, 'INSERT OR IGNORE INTO wa_templates (name, builtin, title, category) VALUES (?, 1, ?, ?)', name, got.tpl.title, got.tpl.category)
  await run(c, "UPDATE wa_templates SET status = ?, meta_id = ?, meta_category = ?, rejected_reason = NULL, submitted_at = datetime('now'), updated_at = datetime('now') WHERE name = ?",
    String(r.json?.status || 'PENDING'), String(r.json?.id || '') || null, String(r.json?.category || got.tpl.category), name)
  await note(c, 'whatsapp.template.submit', name, { status: r.json?.status, category: r.json?.category })
  return c.json({ success: true, status: String(r.json?.status || 'PENDING'), templates: shapeTemplates(await templateRows(c)) })
})

wa.delete('/api/admin/whatsapp/templates/:name', async (c) => {
  if (!(await ready(c))) return notReady(c)
  const name = String(c.req.param('name'))
  if (BUILT_IN[name]) return c.json({ error: 'This one is built in and cannot be removed.' }, 409)
  const row = await one(c, 'SELECT * FROM wa_templates WHERE name = ?', name)
  if (!row) return c.json({ error: 'That message is not here any more.' }, 404)
  const waiting = await one(c, "SELECT COUNT(*) AS n FROM wa_messages WHERE template = ? AND status IN ('queued', 'sending')", name)
  if (Number(waiting?.n || 0) > 0) return c.json({ error: 'A send is still using this message. Cancel that send first.' }, 409)
  const cfg = await loadCfg(c)
  if (String(row.status) !== 'draft' && cfg.token && cfg.wabaId) await graph(cfg, 'DELETE', `${cfg.wabaId}/message_templates?name=${encodeURIComponent(name)}`)
  await run(c, 'DELETE FROM wa_templates WHERE name = ?', name)
  await note(c, 'whatsapp.template.delete', name, { status: row.status })
  return c.json({ success: true, templates: shapeTemplates(await templateRows(c)) })
})

// Reads a send request: what, with which message, to whom.
async function specOf(c: any, b: any): Promise<{ spec: Spec; tpl: Tpl; row: any } | { error: string; status: number }> {
  const kind = String(b.kind || '')
  if (!['photos', 'pass', 'custom'].includes(kind)) return { error: 'Choose what to send.', status: 400 }
  const name = kind === 'custom' ? String(b.template || '') : TEMPLATE_FOR[kind]
  const got = await templateBy(c, name)
  if (!got || got.tpl.kind !== kind) return { error: 'Choose the message to send.', status: 400 }
  const spec: Spec = { kind, template: name, event: kind === 'photos' ? 1 : Math.max(1, Math.floor(Number(b.event) || 1)), audience: String(b.audience || 'everyone'),
    list: String(b.list || ''), only_new: b.only_new !== false, attendee_id: Number(b.attendee_id) > 0 ? Math.floor(Number(b.attendee_id)) : undefined,
    number: b.number ? String(b.number) : undefined, name: b.name ? String(b.name) : undefined }
  return { spec, tpl: got.tpl, row: got.row }
}
const maskNumber = (n: string) => shownNumber(n).replace(/\d(?=(?:\D*\d){4})/g, (d, i) => (i < 4 ? d : '•'))

// How many, who is left out and why, and how it will read. Sends nothing.
wa.post('/api/admin/whatsapp/audience', async (c) => {
  if (!(await ready(c))) return notReady(c)
  const b = await c.req.json().catch(() => ({})) as any
  const s = await specOf(c, b)
  if ('error' in s) return c.json({ error: s.error }, s.status as any)
  const built = await build(c, s.spec, s.tpl, false)
  if (built.error) return c.json({ error: built.error }, 400)
  const first = built.people[0]
  let image = s.tpl.imageUrl ? SITE + s.tpl.imageUrl : ''
  if (first && s.spec.kind === 'photos') {
    // Only the first person's picture is signed, for the preview.
    const one1 = await build(c, { ...s.spec, attendee_id: first.attendee_id || undefined, only_new: false }, s.tpl, true)
    image = one1.people[0]?.image || ''
  }
  const cfg = await loadCfg(c)
  const daily = numberSetting(cfg, 'whatsapp_daily_limit', DEFAULT_DAILY_LIMIT, 1, 1000000)
  return c.json({ count: built.people.length, skipped: skippedWords(built.skipped), sample: built.people.slice(0, 5).map(p => ({ name: p.name, number: maskNumber(p.number) })),
    preview: { name: first?.name || 'Asha', text: first ? first.text : fill(s.tpl.text, s.tpl.samples), image, button: s.tpl.button, footer: FOOTER },
    status: String(s.row?.status || 'draft'), category: String(s.row?.meta_category || s.tpl.category), daily_limit: daily, used_today: await usedToday(c),
    days: Math.max(1, Math.ceil(built.people.length / daily)) })
})

function refuseSend(cfg: Cfg, row: any): string {
  if (!connected(cfg)) return 'WhatsApp is not connected yet. Open Setup and follow the steps.'
  if (String(row?.status || 'draft') !== 'APPROVED') return 'Meta has not approved this message yet. Open Messages and send it for approval; it usually takes a few minutes to a few hours.'
  return ''
}

// One message to a number the organiser types: their own phone, to see it before a send.
wa.post('/api/admin/whatsapp/test', async (c) => {
  if (!(await ready(c))) return notReady(c)
  const b = await c.req.json().catch(() => ({})) as any
  const s = await specOf(c, b)
  if ('error' in s) return c.json({ error: s.error }, s.status as any)
  const cfg = await loadCfg(c)
  const no = refuseSend(cfg, s.row)
  if (no) return c.json({ error: no }, 409)
  const to = whatsappNumber(b.to)
  if (!to) return c.json({ error: 'Type a full mobile number, for example 98765 43210.', field: 'to' }, 400)
  // The first real person's message, so the test reads exactly as theirs will.
  const built = await build(c, { ...s.spec, only_new: false }, s.tpl, false)
  let p: Person | undefined = built.people[0]
  if (p && s.spec.kind !== 'custom') p = (await build(c, { ...s.spec, attendee_id: p.attendee_id || undefined, only_new: false }, s.tpl, true)).people[0]
  if (!p) {
    if (s.tpl.image && !s.tpl.imageUrl) return c.json({ error: 'There is nobody to send this to yet, so there is no picture to test with.' }, 409)
    p = { attendee_id: null, person: '', name: 'Asha', number: to, params: s.tpl.samples, image: s.tpl.imageUrl ? SITE + s.tpl.imageUrl : '', target: s.tpl.buttonUrl || SITE, text: fill(s.tpl.text, s.tpl.samples) }
  }
  const sent = await sendNow(c, cfg, rowFor({ ...p, number: to, signin: undefined, target: p.signin ? SITE + '/app' : p.target }, s.spec, s.tpl, actorOf(c), { test: 1, attendee_id: null }))
  if (!sent.ok) return c.json({ error: sent.error }, 502)
  await note(c, 'whatsapp.test', sent.id, { kind: s.spec.kind, template: s.tpl.name })
  return c.json({ success: true, to: shownNumber(to), as: p.name })
})

// The send. `expect` is the number the screen showed: if the list has changed since,
// nothing is sent and the screen shows the new number.
wa.post('/api/admin/whatsapp/send', async (c) => {
  if (!(await ready(c))) return notReady(c)
  const b = await c.req.json().catch(() => ({})) as any
  const s = await specOf(c, b)
  if ('error' in s) return c.json({ error: s.error }, s.status as any)
  const cfg = await loadCfg(c)
  const no = refuseSend(cfg, s.row)
  if (no) return c.json({ error: no }, 409)
  const built = await build(c, s.spec, s.tpl, true)
  if (built.error) return c.json({ error: built.error }, 400)
  const people = built.people
  if (!people.length) return c.json({ error: 'There is nobody to send this to.', skipped: skippedWords(built.skipped) }, 409)
  if (people.length > BATCH_MAX) return c.json({ error: 'That is more than ' + BATCH_MAX + ' in one send. Choose a smaller group.' }, 409)
  const single = !!(s.spec.attendee_id || s.spec.audience === 'one')
  if (!single && Number(b.expect) !== people.length) return c.json({ error: 'The list has changed: it is now ' + people.length + '. Look again, then send.', count: people.length, changed: true }, 409)
  const by = actorOf(c)
  if (single) {
    const sent = await sendNow(c, cfg, rowFor(people[0], s.spec, s.tpl, by))
    if (!sent.ok) return c.json({ error: sent.error }, 502)
    await note(c, 'whatsapp.send.one', sent.id, { kind: s.spec.kind, template: s.tpl.name, attendee: people[0].attendee_id })
    return c.json({ success: true, sent: 1, to: people[0].name })
  }
  const title = s.spec.kind === 'custom' ? s.tpl.title : s.tpl.title + (s.spec.kind === 'pass' ? ' (event ' + s.spec.event + ')' : '')
  const ins = await run(c, "INSERT INTO wa_batches (event_id, kind, template, title, audience, status, total, created_by) VALUES (?, ?, ?, ?, ?, 'running', ?, ?)",
    s.spec.event, s.spec.kind, s.tpl.name, title.slice(0, 120), String(s.spec.audience || '').slice(0, 80), people.length, by)
  const batchId = Number(ins?.meta?.last_row_id || 0)
  const rows = people.map(p => rowFor(p, s.spec, s.tpl, by, { batch_id: batchId }))
  const cols = Object.keys(rows[0])
  const sql = `INSERT INTO wa_messages (${cols.join(', ')}, status, updated_at) VALUES (${cols.map(() => '?').join(', ')}, 'queued', datetime('now'))`
  for (let i = 0; i < rows.length; i += 40) await c.env.DB.batch(rows.slice(i, i + 40).map(r => c.env.DB.prepare(sql).bind(...cols.map(k => (r as any)[k] ?? null))))
  await note(c, 'whatsapp.send', batchId, { kind: s.spec.kind, template: s.tpl.name, audience: s.spec.audience, count: people.length })
  return c.json({ success: true, batch: batchId, count: people.length, skipped: skippedWords(built.skipped) })
})

wa.post('/api/admin/whatsapp/batches/:id/:what', async (c) => {
  if (!(await ready(c))) return notReady(c)
  const id = Number(c.req.param('id')), what = String(c.req.param('what'))
  const b = await one(c, 'SELECT * FROM wa_batches WHERE id = ?', id)
  if (!b) return c.json({ error: 'That send is not here.' }, 404)
  if (what === 'pause' && b.status === 'running') await run(c, "UPDATE wa_batches SET status = 'paused', note = NULL WHERE id = ?", id)
  else if (what === 'resume' && b.status === 'paused') await run(c, "UPDATE wa_batches SET status = 'running', note = NULL WHERE id = ?", id)
  else if (what === 'cancel' && (b.status === 'running' || b.status === 'paused')) {
    await run(c, "UPDATE wa_messages SET status = 'cancelled', updated_at = datetime('now') WHERE batch_id = ? AND status = 'queued'", id)
    await run(c, "UPDATE wa_batches SET status = 'cancelled', finished_at = datetime('now') WHERE id = ?", id)
  } else return c.json({ error: 'That cannot be done to this send now.' }, 409)
  await note(c, 'whatsapp.batch.' + what, id, {})
  return c.json({ success: true, ...(await overview(c)) })
})

// The Admin page's own push while it is open, so a send moves without waiting a minute.
wa.post('/api/admin/whatsapp/tick', async (c) => {
  c.header('Cache-Control', 'no-store')
  return c.json({ tick: await whatsappTick(c, { budgetMs: 8000 }), ...(await overview(c)) })
})

wa.get('/api/admin/whatsapp/messages', async (c) => {
  if (!(await ready(c))) return notReady(c)
  const where: string[] = ["m.direction = 'out'"], args: any[] = []
  const st = String(c.req.query('status') || ''), batch = Number(c.req.query('batch') || 0), q = oneLine(c.req.query('q'), 60)
  if (st === 'tapped') where.push('m.clicked_at IS NOT NULL')
  else if (st) { where.push('m.status = ?'); args.push(st) }
  if (batch) { where.push('m.batch_id = ?'); args.push(batch) }
  if (q) { where.push('(m.name LIKE ? OR m.wa_number LIKE ?)'); args.push('%' + q + '%', '%' + q.replace(/\D/g, '') + '%') }
  const rows = await all(c, `SELECT m.id, m.kind, m.wa_number, m.name, m.template, m.status, m.error, m.test, m.own, m.batch_id, m.created_at, m.sent_at, m.delivered_at, m.read_at, m.clicked_at, m.price_category, m.created_by
     FROM wa_messages m WHERE ${where.join(' AND ')} ORDER BY m.id DESC LIMIT 200`, ...args)
  return c.json({ rows: rows.map(r => ({ ...r, number: shownNumber(String(r.wa_number)) })) })
})

// Replies: everyone who has written to us, newest first.
wa.get('/api/admin/whatsapp/inbox', async (c) => {
  if (!(await ready(c))) return notReady(c)
  const rows = await all(c, `SELECT k.wa_number, k.name, k.unread, k.last_in_at, k.opted_out_at,
       (SELECT payload FROM wa_messages m WHERE m.wa_number = k.wa_number AND m.direction = 'in' ORDER BY m.id DESC LIMIT 1) AS last,
       (SELECT name FROM wa_messages m WHERE m.wa_number = k.wa_number AND m.name <> '' ORDER BY m.id DESC LIMIT 1) AS known,
       CASE WHEN k.last_in_at > datetime('now', '-1 day') THEN 1 ELSE 0 END AS open
     FROM wa_contacts k WHERE k.last_in_at IS NOT NULL ORDER BY k.last_in_at DESC LIMIT 200`)
  return c.json({ rows: rows.map(r => { let t = ''; try { t = String(JSON.parse(r.last || '{}').text || '') } catch { t = '' }
    return { number: String(r.wa_number), shown: shownNumber(String(r.wa_number)), name: String(r.known || r.name || ''), unread: Number(r.unread || 0), last_in_at: r.last_in_at, last: t.slice(0, 140), open: Number(r.open) === 1, stopped: !!r.opted_out_at } }) })
})
wa.get('/api/admin/whatsapp/thread/:number', async (c) => {
  if (!(await ready(c))) return notReady(c)
  const n = String(c.req.param('number')).replace(/\D/g, '')
  const k = await one(c, "SELECT *, CASE WHEN last_in_at > datetime('now', '-1 day') THEN 1 ELSE 0 END AS open FROM wa_contacts WHERE wa_number = ?", n)
  const rows = await all(c, 'SELECT id, direction, kind, template, payload, status, error, created_at, created_by FROM wa_messages WHERE wa_number = ? ORDER BY id DESC LIMIT 60', n)
  await run(c, 'UPDATE wa_contacts SET unread = 0 WHERE wa_number = ?', n)
  return c.json({ number: n, shown: shownNumber(n), name: String(k?.name || ''), open: Number(k?.open || 0) === 1, stopped: !!k?.opted_out_at,
    messages: rows.reverse().map(r => { let p: any = {}; try { p = JSON.parse(r.payload || '{}') } catch { p = {} }
      return { id: r.id, out: r.direction === 'out', kind: r.kind, text: String(p.text || (p.type ? '[' + p.type + ']' : '')), image: String(p.image || ''), status: r.status, error: r.error || '', at: r.created_at, by: r.created_by || '' } }) })
})
wa.post('/api/admin/whatsapp/reply', async (c) => {
  if (!(await ready(c))) return notReady(c)
  const b = await c.req.json().catch(() => ({})) as any
  const n = String(b.number || '').replace(/\D/g, ''), text = String(b.text ?? '').trim().slice(0, 2000)
  if (!n || !text) return c.json({ error: 'Type your reply.' }, 400)
  const cfg = await loadCfg(c)
  if (!connected(cfg)) return c.json({ error: 'WhatsApp is not connected yet. Open Setup and follow the steps.' }, 409)
  const k = await one(c, "SELECT opted_out_at, name, CASE WHEN last_in_at > datetime('now', '-1 day') THEN 1 ELSE 0 END AS open FROM wa_contacts WHERE wa_number = ?", n)
  if (!k || Number(k.open) !== 1) return c.json({ error: ERRORS[131047].words, closed: true }, 409)
  const last = await one(c, "SELECT attendee_id, name, event_id FROM wa_messages WHERE wa_number = ? AND name <> '' ORDER BY id DESC LIMIT 1", n).catch(() => null)
  const sent = await sendNow(c, cfg, { event_id: Number(last?.event_id || 1), direction: 'out', kind: 'reply', wa_number: n, attendee_id: last?.attendee_id ?? null,
    name: oneLine(last?.name || k.name, 120), template: '', payload: JSON.stringify({ text }), created_by: actorOf(c) })
  if (!sent.ok) return c.json({ error: sent.error }, 502)
  return c.json({ success: true })
})
// Stop, or start again, by hand: someone asked on a call, or wrote "please remove me".
wa.post('/api/admin/whatsapp/stop', async (c) => {
  if (!(await ready(c))) return notReady(c)
  const b = await c.req.json().catch(() => ({})) as any
  // Ten digits is an Indian mobile; digits that already carry another country's code
  // (as the Replies list holds them) are read with a + in front.
  const n = whatsappNumber(b.number) || whatsappNumber('+' + String(b.number || '').replace(/\D/g, ''))
  if (!n) return c.json({ error: 'Type a full mobile number.' }, 400)
  await setStopped(c, n, b.on !== false, actorOf(c) || 'team')
  await note(c, 'whatsapp.stop', n.slice(-4), { on: b.on !== false })
  return c.json({ success: true, stopped: b.on !== false })
})

// One by one from a team member's own WhatsApp: works before Meta is connected. The
// same people a photos send would reach, each with a ready wa.me link; a tap marks them.
wa.get('/api/admin/whatsapp/own', async (c) => {
  if (!(await ready(c))) return notReady(c)
  const tpl = BUILT_IN[TEMPLATE_FOR.photos]
  const built = await build(c, { kind: 'photos', only_new: false }, tpl, false)
  for (const p of built.people) p.target = await pageUrl(c, p.person)
  const sent = new Map<string, number>()
  for (const r of await all(c, "SELECT id, wa_number FROM wa_messages WHERE direction = 'out' AND kind = 'photos' AND test = 0 AND status NOT IN ('failed', 'skipped', 'cancelled')")) sent.set(String(r.wa_number), Number(r.id))
  return c.json({ skipped: skippedWords(built.skipped), rows: built.people.map(p => {
    const text = encodeURIComponent(p.text.replace('Tap the button to see them', 'See them here') + '\n' + p.target + '\n\nBharat AI Innovation team')
    return { attendee_id: p.attendee_id, name: p.name, number: shownNumber(p.number), photos: p.params[1], sent: sent.has(p.number),
      wa_url: `https://wa.me/${p.number}?text=${text}`, web_url: `https://web.whatsapp.com/send?phone=${p.number}&text=${text}` } }) })
})
wa.post('/api/admin/whatsapp/own/mark', async (c) => {
  if (!(await ready(c))) return notReady(c)
  const b = await c.req.json().catch(() => ({})) as any
  const tpl = BUILT_IN[TEMPLATE_FOR.photos]
  const built = await build(c, { kind: 'photos', only_new: false, attendee_id: Number(b.attendee_id) || -1 }, tpl, false)
  const p = built.people[0]
  if (!p) return c.json({ error: 'That person is not on the list.' }, 404)
  p.target = await pageUrl(c, p.person)
  if (b.undo) { await run(c, "DELETE FROM wa_messages WHERE wa_number = ? AND kind = 'photos' AND own = 1", p.number); return c.json({ success: true, sent: false }) }
  const has = await one(c, "SELECT id FROM wa_messages WHERE wa_number = ? AND kind = 'photos' AND direction = 'out' AND test = 0 AND status NOT IN ('failed', 'skipped', 'cancelled') LIMIT 1", p.number)
  if (!has) await run(c, `INSERT INTO wa_messages (event_id, direction, kind, wa_number, attendee_id, person, name, template, payload, target_url, status, own, created_by, sent_at, updated_at)
     VALUES (1, 'out', 'photos', ?, ?, ?, ?, '', ?, ?, 'sent', 1, ?, datetime('now'), datetime('now'))`,
    p.number, p.attendee_id, p.person, p.name.slice(0, 120), JSON.stringify({ text: p.text, own: 1 }), p.target, actorOf(c))
  return c.json({ success: true, sent: true })
})

export default wa
