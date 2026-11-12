import { Hono } from 'hono'

// ==================== A SPEAKER'S OWN TALK DETAILS (12 Nov 2026) ====================
//
// The organiser: speakers "should be able to update by themselves on the networking app
// rather than sending details to organisers". Until now the "a few details we need"
// email asked a speaker (or their booth contact) to REPLY with a bio, a mobile and a
// photo, and somebody on the team typed the reply in.
//
// Now the email carries a link, /app/my-talk?t=<token>, that opens the talk's own page
// in the app's design, on a phone, with no sign-in. The speaker fills in what is
// missing and it goes straight into innovation_talks, where the Innovation Talks tab,
// the scheduler and the app already read it.
//
// The token is the talk's id and an expiry, signed. It names a TALK, not a person: the
// email often goes to the booth contact, who forwards it, and the link must work for
// whoever it is forwarded to. It never signs anyone in and can change only what a
// speaker sends (topic, designation, company as shown, bio, mobile, what they will show,
// photo). Time, hall and the speaker's name stay the organisers'.
//
// The page is public/static/talk-self.{js,css}; tests are *-talk-self.*.

type Hooks = {
  // PASS_SECRET || SESSION_SECRET || ADMIN_SECRET, as the pass tokens use.
  secret?: (c: any) => string
  audit?: (c: any, action: string, entity?: string, entityId?: any, detail?: any, actorOverride?: { actor: string; kind: string }) => Promise<void>
  appUrl?: (c: any) => Promise<string>
  hallText?: (hall: any) => string
}
let hooks: Hooks = {}
export function configureTalkSelf(h: Hooks) { hooks = { ...hooks, ...h } }

const talk = new Hono<{ Bindings: any }>()

// A link lasts this long. The event is 20-21 Nov 2026; a month covers any email sent
// before it and the corrections after.
export const LINK_DAYS = 30

// What a speaker may write, and the longest each may be: the same limits as the
// Innovation Talks tab (topic 200, bio 800, showcase 1000, phone 30), so nothing the
// organisers typed is ever too long for the page.
export const FIELDS: Record<string, { label: string; max: number }> = {
  topic: { label: 'The title of your talk', max: 200 },
  speaker_title: { label: 'Your designation', max: 120 },
  speaker_bio: { label: 'Two or three lines about you', max: 800 },
  speaker_phone: { label: 'Your mobile number', max: 30 },
  showcase: { label: 'What you will show on stage', max: 1000 },
  company: { label: 'Your company name, as it should be shown', max: 120 },
}

// Only what the speaker changed. The page sends every box on Save; a box left as the
// organisers wrote it (a longer bio, two mobile numbers in one box, a link in it) is
// not theirs to fix and must never block their save (Hall session's review, 12 Nov).
export function changedOnly(body: any, row: any): Record<string, any> {
  const out: Record<string, any> = {}
  const norm = (v: any) => String(v == null ? '' : v).replace(/\r\n/g, '\n').trim()
  for (const k of Object.keys(FIELDS)) {
    if (!body || !(k in body)) continue
    if (norm(body[k]) !== norm(row?.[k])) out[k] = body[k]
  }
  return out
}
// What the programme needs from a speaker: the Innovation Talks tab's "missing" list
// (ITALK_NEEDED in index.tsx), which the organisers' time and hall are not part of.
export const NEEDED = ['topic', 'speaker_title', 'company', 'speaker_photo_url', 'speaker_bio', 'speaker_phone']

// ---------- the signed link ----------

const enc = new TextEncoder()
async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)))
  return Array.from(sig, b => b.toString(16).padStart(2, '0')).join('')
}
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

// "<talk id>.<expiry, seconds>.<signature>"
export async function signTalkToken(secret: string, talkId: number, expSeconds: number): Promise<string> {
  const body = `${talkId}.${expSeconds}`
  return body + '.' + (await hmacHex(secret, 'talk-self:' + body)).slice(0, 32)
}

// The talk id a token names, or why not: 'bad' (not ours, or altered), 'expired'.
export async function readTalkToken(secret: string, token: any, nowSeconds: number): Promise<{ id: number } | { error: 'bad' | 'expired' }> {
  const m = String(token || '').match(/^(\d{1,9})\.(\d{9,11})\.([0-9a-f]{32})$/)
  if (!secret || !m) return { error: 'bad' }
  const expected = (await hmacHex(secret, `talk-self:${m[1]}.${m[2]}`)).slice(0, 32)
  if (!sameText(m[3], expected)) return { error: 'bad' }
  if (Number(m[2]) < nowSeconds) return { error: 'expired' }
  return { id: Number(m[1]) }
}

// The link the "a few details we need" email carries. '' when no secret is set, so the
// email falls back to asking for a reply.
export async function talkDetailsLink(c: any, talkId: number): Promise<string> {
  const secret = hooks.secret ? hooks.secret(c) : ''
  if (!secret || !Number(talkId)) return ''
  const exp = Math.floor(Date.now() / 1000) + LINK_DAYS * 86400
  const base = String((hooks.appUrl ? await hooks.appUrl(c).catch(() => '') : '') || 'https://bharataiinnovation.com/app').replace(/\/+$/, '')
  return base + '/my-talk?t=' + (await signTalkToken(secret, Number(talkId), exp))
}

// ---------- the rules (scripts/verify/unit-talk-self.mjs tests each) ----------

// The fields sent that may be saved, cleaned, or the first problem in plain words.
export function cleanFields(body: any): { set: Record<string, string>; error?: string; field?: string } {
  const set: Record<string, string> = {}
  for (const k of Object.keys(FIELDS)) {
    if (!body || !(k in body)) continue
    const v = String(body[k] == null ? '' : body[k]).replace(/\r\n/g, '\n').trim()
    if (v.length > FIELDS[k].max) return { set, error: `${FIELDS[k].label} is too long: at most ${FIELDS[k].max} characters.`, field: k }
    set[k] = v
  }
  if (set.speaker_phone) {
    const digits = set.speaker_phone.replace(/\D/g, '')
    if (digits.length < 10 || digits.length > 15) return { set, error: 'Type a mobile number with at least 10 digits.', field: 'speaker_phone' }
    set.speaker_phone = (set.speaker_phone.trim().startsWith('+') ? '+' : '') + digits
  }
  if (set.speaker_bio && /https?:\/\/|<\s*\w/i.test(set.speaker_bio)) return { set, error: 'Please write the lines about you as plain text, with no links.', field: 'speaker_bio' }
  // A company that was shown cannot be blanked from a link; the organisers can.
  if ('company' in set && !set.company) delete set.company
  return { set }
}

export function missingOf(t: any): string[] {
  return NEEDED.filter(k => !String(t?.[k] ?? '').trim())
}

// What the page shows: never the speaker's email, the booth contact or the team's notes.
export function publicView(t: any, hallText: (h: any) => string = (h) => String(h || '')) {
  const timed = !!t.starts_at && !!String(t.time_slot || '').trim() && !/to be announced/i.test(String(t.time_slot))
  return {
    speaker_name: String(t.speaker_name || ''), company: String(t.company || ''),
    topic: String(t.topic || ''), speaker_title: String(t.speaker_title || ''), speaker_bio: String(t.speaker_bio || ''),
    speaker_phone: String(t.speaker_phone || ''), showcase: String(t.showcase || ''),
    speaker_photo_url: /^(\/|https:\/\/)/.test(String(t.speaker_photo_url || '')) ? String(t.speaker_photo_url) : '',
    when: timed ? String(t.time_slot) : '', where: hallText(t.hall) || '',
    updated_at: t.details_updated_at || null, missing: missingOf(t),
  }
}

// ---------- routes ----------

const now = () => Math.floor(Date.now() / 1000)
async function talkFor(c: any, token: string) {
  const r = await readTalkToken(hooks.secret ? hooks.secret(c) : '', token, now())
  if ('error' in r) return { status: r.error === 'expired' ? 410 : 404, error: r.error === 'expired'
    ? 'This link has expired. Reply to the email it came in and we will send you a new one.'
    : 'This link is not right. Open it again from the email, or reply to the email for a new one.' }
  const t = await c.env.DB.prepare('SELECT * FROM innovation_talks WHERE id = ?').bind(r.id).first() as any
  if (!t) return { status: 404, error: 'This talk is no longer on the programme. Reply to the email if that is a mistake.' }
  return { t }
}
const hall = (h: any) => (hooks.hallText ? hooks.hallText(h) : String(h || ''))
const actor = (t: any) => ({ actor: String(t.speaker_name || 'speaker').slice(0, 60) + ' (own link)', kind: 'speaker-link' })

talk.get('/api/talk-self/:token', async (c) => {
  const f: any = await talkFor(c, c.req.param('token'))
  if (f.error) return c.json({ error: f.error, expired: f.status === 410 }, f.status)
  c.header('Cache-Control', 'no-store')
  return c.json({ talk: publicView(f.t, hall), fields: FIELDS })
})

talk.put('/api/talk-self/:token', async (c) => {
  const f: any = await talkFor(c, c.req.param('token'))
  if (f.error) return c.json({ error: f.error, expired: f.status === 410 }, f.status)
  const body = await c.req.json().catch(() => null)
  const { set, error, field } = cleanFields(changedOnly(body, f.t))
  if (error) return c.json({ error, field }, 400)
  if (!Object.keys(set).length) return c.json({ talk: publicView(f.t, hall), unchanged: true })
  const write = async (vals: Record<string, string>) => {
    const keys = Object.keys(vals)
    await c.env.DB.prepare('UPDATE innovation_talks SET ' + keys.map(k => k + ' = ?').join(', ') + ", details_updated_at = datetime('now') WHERE id = ?")
      .bind(...keys.map(k => vals[k]), f.t.id).run()
  }
  try { await write(set) } catch (e: any) {
    // Before 0052 there is no mobile column: keep the rest.
    if (!/no such column/i.test(String(e?.message || '')) || !('speaker_phone' in set)) throw e
    const { speaker_phone, ...rest } = set
    if (Object.keys(rest).length) await write(rest)
  }
  const changed = Object.keys(set).filter(k => String(f.t[k] ?? '') !== set[k])
  if (hooks.audit && changed.length) {
    try { await hooks.audit(c, 'innovation_talk.self_update', 'innovation_talk', f.t.id, { fields: changed, speaker: f.t.speaker_name, company: f.t.company }, actor(f.t)) } catch { /* never fails a save */ }
  }
  const after = await c.env.DB.prepare('SELECT * FROM innovation_talks WHERE id = ?').bind(f.t.id).first()
  return c.json({ success: true, talk: publicView(after, hall), changed })
})

// A photo, cropped square in the browser, kept in the uploads bucket.
talk.post('/api/talk-self/:token/photo', async (c) => {
  const f: any = await talkFor(c, c.req.param('token'))
  if (f.error) return c.json({ error: f.error, expired: f.status === 410 }, f.status)
  if (!c.env.UPLOADS) return c.json({ error: 'Photos cannot be saved just now. Please attach it to a reply to the email instead.' }, 503)
  const b = await c.req.json().catch(() => ({})) as any
  const m = String(b.image || '').match(/^data:(image\/(jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/)
  if (!m) return c.json({ error: 'Choose a JPEG, PNG or WebP photo.' }, 400)
  const bin = atob(m[3])
  if (bin.length > 2 * 1024 * 1024) return c.json({ error: 'That photo is larger than 2 MB. Choose a smaller one.' }, 413)
  if (bin.length < 2048) return c.json({ error: 'That file is too small to be a photo.' }, 400)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const key = 'talks/' + f.t.id + '-' + Date.now() + '.' + (m[2] === 'jpeg' ? 'jpg' : m[2])
  await c.env.UPLOADS.put(key, bytes, { httpMetadata: { contentType: m[1], cacheControl: 'public, max-age=31536000' } })
  const url = '/api/uploads/' + key
  await c.env.DB.prepare("UPDATE innovation_talks SET speaker_photo_url = ?, details_updated_at = datetime('now') WHERE id = ?").bind(url, f.t.id).run()
  const prev = String(f.t.speaker_photo_url || '')
  if (prev.startsWith('/api/uploads/talks/')) { try { await c.env.UPLOADS.delete(prev.slice('/api/uploads/'.length)) } catch { /* an orphan costs nothing */ } }
  if (hooks.audit) { try { await hooks.audit(c, 'innovation_talk.self_photo', 'innovation_talk', f.t.id, { speaker: f.t.speaker_name, company: f.t.company }, actor(f.t)) } catch {} }
  return c.json({ success: true, speaker_photo_url: url })
})

// The page itself. Everything it shows comes from the API, so the HTML holds no data
// and can be the same for every talk.
talk.get('/app/my-talk', (c) => {
  c.header('Cache-Control', 'no-store')
  c.header('X-Robots-Tag', 'noindex')
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<title>Your Innovation Talk · Bharat AI Innovation 2026</title>
<link rel="icon" href="/favicon.ico">
<link rel="stylesheet" href="/css/fonts-app.css?v=1">
<link rel="stylesheet" href="/static/talk-self.css?v=20261112">
</head>
<body>
<header class="ts-top"><a href="/app" class="ts-brand"><img src="/images/logo-nav.webp" alt="Bharat AI Innovation" width="120" height="36"></a><span class="ts-event">20–21 Nov 2026 · World Trade Center, Mumbai</span></header>
<main id="ts-root" class="ts-main" aria-live="polite"><p class="ts-loading">Opening your talk…</p></main>
<footer class="ts-foot">Questions? Write to <a href="mailto:register@bharataiinnovation.com">register@bharataiinnovation.com</a><br><a href="/app">Open the networking app</a></footer>
<script src="/static/talk-self.js?v=20261112b"></script>
</body>
</html>`)
})

export default talk
