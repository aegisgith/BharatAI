import { Hono } from 'hono'

type Bindings = {
  DB: D1Database
  // Listing images. Without the bucket (a local or preview build) uploads fall back
  // to base64 in D1, which caps them lower - see MAX_INLINE_UPLOAD_BYTES.
  UPLOADS?: R2Bucket
  // Secret used to HMAC-sign marketplace session cookies so the company id
  // can't be forged. Set via a Cloudflare Pages secret:
  //   npx wrangler pages secret put MP_SESSION_SECRET
  // Falls back to ADMIN_SECRET if unset, so a single secret can cover both.
  MP_SESSION_SECRET?: string
  ADMIN_SECRET?: string
}
const mp = new Hono<{ Bindings: Bindings }>()

// ── Hooks from the event app ──
// src/index.tsx owns email, the admin panel's authentication and its audit log.
// They are handed in rather than imported because index.tsx imports this module.
// Anything not configured is simply skipped.
type Mailer = (c: any, to: string, subject: string, html: string) => Promise<{ ok: boolean; error?: string }>
type MarketplaceHooks = {
  // sendAdminEmail: Elastic Email, key in app_settings.
  sendEmail?: Mailer
  // isAdminRequest: a signed staff session with role 'admin', or the shared admin
  // password sent as a Bearer header by the /admin panel.
  isEventAdmin?: (c: any) => boolean
  // audit(): the admin_audit table the /admin panel reads.
  audit?: (c: any, action: string, entity?: string, entityId?: any, detail?: any, actorOverride?: { actor: string; kind: string }) => Promise<void>
  // ensureExhibitorDelegate: every exhibitor is also a delegate. Gives the booth
  // contact an event-app pass under the booth email; null when there is no confirmed stand.
  ensureDelegate?: (c: any, x: { exhibitorId: number; email: string; company: string }) => Promise<{ attendeeId: number; created: boolean; upgraded: boolean } | null>
}
let hooks: MarketplaceHooks = {}
export const configureMarketplace = (h: MarketplaceHooks) => { hooks = { ...hooks, ...h } }

// Eight real submissions sat in 'pending' for up to five months because nothing
// told anyone they existed. Mail goes out after the response via waitUntil, so a
// slow or failing mail service can never fail the submission that triggered it.
const inBackground = (c: any, work: () => Promise<unknown>) => {
  const run = work().catch(() => {})
  try { c.executionCtx.waitUntil(run) } catch { /* no execution context: the promise still runs */ }
}

const setting = async (c: any, key: string): Promise<string | undefined> => {
  try {
    return ((await c.env.DB.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first()) as any)?.value || undefined
  } catch { return undefined }
}

const htmlEsc = (v: any) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const siteOrigin = (c: any) => { try { return new URL(c.req.url).origin } catch { return 'https://bharataiinnovation.com' } }

const emailShell = (title: string, body: string) => `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#f6f7fb;padding:24px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1e2140">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:14px;padding:28px;border:1px solid #e7e9f5">
    <h2 style="margin:0 0 16px;font-size:19px">${htmlEsc(title)}</h2>
    ${body}
    <p style="margin:24px 0 0;font-size:12px;color:#888">Bharat AI Marketplace &middot; Bharat AI Innovation 2026 &middot; 20-21 November 2026, World Trade Center, Mumbai</p>
  </div></body></html>`

const emailButton = (href: string, label: string) =>
  `<p style="margin:20px 0 0"><a href="${htmlEsc(href)}" style="display:inline-block;background:#FF6B00;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px">${htmlEsc(label)}</a></p>`

const emailRow = (k: string, v: any) => v
  ? `<tr><td style="padding:5px 12px 5px 0;color:#666;font-size:13px;vertical-align:top">${htmlEsc(k)}</td><td style="padding:5px 0;font-size:13px"><strong>${htmlEsc(v)}</strong></td></tr>`
  : ''

// Returns whether the mail service accepted it. Cloudflare's live log is the only
// record of these sends, so every attempt writes one line there (never the address).
const sendMail = async (c: any, kind: string, to: string, subject: string, html: string): Promise<boolean> => {
  if (!hooks.sendEmail || !to) return false
  let ok = false, error: string | undefined
  try { const r = await hooks.sendEmail(c, to, subject, html); ok = !!r.ok; error = r.ok ? undefined : r.error }
  catch (e: any) { error = e?.message || 'send threw' }
  console.log(JSON.stringify({ marketplaceMail: kind, ok, error }))
  return ok
}

const teamAddress = async (c: any) =>
  (await setting(c, 'marketplace_notify_email')) || (await setting(c, 'inquiry_notify_email')) || 'info@bharataiinnovation.com'

// ── Listing completeness ──
// None of these is required to submit, but a listing without them gets passed
// over: when the marketplace first went live no listing had a product image and
// most had no logo. Companies are told what is missing, at submission, on
// approval, in their dashboard, and by an admin reminder.
const COMPLETENESS: { label: string; has: (l: any) => boolean }[] = [
  { label: 'Company logo', has: l => !!String(l.logo_url || '').trim() },
  { label: 'Product image', has: l => !!String(l.product_image_url || '').trim() },
  { label: 'Website', has: l => !!String(l.website_url || '').trim() },
  { label: 'Pricing model', has: l => !!String(l.pricing_type || '').trim() },
  { label: 'AI category', has: l => !!String(l.ai_category || '').trim() },
  { label: 'Target industry', has: l => !!String(l.target_industry || '').trim() },
  { label: 'Use cases', has: l => !!String(l.use_cases || '').trim() },
  { label: 'Demo or video link', has: l => !!String(l.demo_url || '').trim() || !!String(l.video_url || '').trim() },
  { label: 'Sales contact email', has: l => !!String(l.sales_contact_email || '').trim() },
]
const missingListingInfo = (l: any): string[] => COMPLETENESS.filter(f => !f.has(l)).map(f => f.label)

const emailMissingBlock = (c: any, missing: string[], intro: string) => missing.length
  ? `<div style="margin-top:18px;padding:14px 16px;background:#fff7ed;border:1px solid #fed7aa;border-radius:10px">
      <p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#9a3412">${htmlEsc(intro)}</p>
      <ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.7;color:#7c2d12">${missing.map(m => `<li>${htmlEsc(m)}</li>`).join('')}</ul>
      <p style="margin:10px 0 0;font-size:13px;color:#9a3412">Listings with a logo, a product image and clear pricing get noticeably more views and inquiries.</p>
      ${emailButton(siteOrigin(c) + '/marketplace/dashboard', 'Complete your listing')}
    </div>`
  : ''

const notifyTeamOfSubmission = (c: any, listing: { id: any; product_name: string; company_name: string; description?: string; website_url?: string }, accountEmail: string, kind: 'new' | 'updated') =>
  inBackground(c, async () => {
    const pending = ((await c.env.DB.prepare("SELECT COUNT(*) AS n FROM mp_listings WHERE status = 'pending'").first()) as any)?.n || 0
    const verb = kind === 'new' ? 'New AI Marketplace listing' : 'AI Marketplace listing edited'
    const body = `<p style="margin:0 0 14px;font-size:14px;line-height:1.6">${kind === 'new' ? 'A company submitted a product' : 'A company edited its listing, which takes it off the public marketplace'} and it is waiting for review. ${pending} listing${pending === 1 ? '' : 's'} pending in total.</p>
      <table style="border-collapse:collapse">${emailRow('Product', listing.product_name)}${emailRow('Company', listing.company_name)}${emailRow('Account', accountEmail)}${emailRow('Website', listing.website_url)}</table>
      ${listing.description ? `<div style="margin-top:14px;padding:12px 14px;background:#f8f9fa;border-left:3px solid #FF9933;font-size:14px;line-height:1.6;white-space:pre-wrap">${htmlEsc(String(listing.description).slice(0, 600))}</div>` : ''}
      ${emailButton(siteOrigin(c) + '/marketplace/admin', 'Review pending listings')}
      <p style="margin:12px 0 0;font-size:12px;color:#888">Or open the event admin panel and choose AI Marketplace in the sidebar.</p>`
    await sendMail(c, 'team-' + kind, await teamAddress(c), `${verb}: ${listing.product_name} (${listing.company_name})`, emailShell(verb, body))
  })

const notifyCompanyWelcome = (c: any, companyName: string, email: string) =>
  inBackground(c, async () => {
    const origin = siteOrigin(c)
    const body = `<p style="margin:0 0 12px;font-size:14px;line-height:1.6">Your Bharat AI Marketplace account for <strong>${htmlEsc(companyName)}</strong> is ready.</p>
      <p style="margin:0 0 12px;font-size:14px;line-height:1.6">Next, list your AI product. It takes a few minutes: our team reviews each listing and emails you as soon as it is live, and buyers' inquiries come straight to this address.</p>
      <p style="margin:0;font-size:14px;line-height:1.6">Exhibiting at Bharat AI Innovation 2026? If this is the email on your booth booking, your booth number is added to your listing automatically.</p>
      ${emailButton(origin + '/marketplace?submit=true', 'List your AI product')}
      <p style="margin:14px 0 0;font-size:12px;color:#888">Did not create this account? You can ignore this email.</p>`
    await sendMail(c, 'company-welcome', email, 'Welcome to the Bharat AI Marketplace', emailShell('Welcome to the Bharat AI Marketplace', body))
  })

const notifyCompanyOfSubmission = (c: any, email: string, listing: any) =>
  inBackground(c, async () => {
    const missing = missingListingInfo(listing)
    const body = `<p style="margin:0;font-size:14px;line-height:1.6">Thanks for listing <strong>${htmlEsc(listing.product_name)}</strong>. It is now with our team for review, and we will email you as soon as it is live on the marketplace.</p>
      ${emailMissingBlock(c, missing, 'While you wait, your listing is missing:')}
      ${missing.length ? '' : emailButton(siteOrigin(c) + '/marketplace/dashboard', 'Open your dashboard')}`
    await sendMail(c, 'company-submitted', email, `We received your listing: ${listing.product_name}`, emailShell('Listing received', body))
  })

// Admin-triggered mails also leave their outcome in admin_audit, so whether a
// company was actually told can be checked from the panel rather than guessed.
const notifyCompanyOfDecision = (c: any, admin: any, listingId: number, status: 'approved' | 'rejected', reason: string) =>
  inBackground(c, async () => {
    const row = await c.env.DB.prepare(
      'SELECT l.*, co.email AS account_email FROM mp_listings l JOIN mp_companies co ON co.id = l.company_id WHERE l.id = ?'
    ).bind(listingId).first() as any
    if (!row?.account_email) return
    const origin = siteOrigin(c)
    let ok: boolean
    if (status === 'approved') {
      const missing = missingListingInfo(row)
      const body = `<p style="margin:0;font-size:14px;line-height:1.6"><strong>${htmlEsc(row.product_name)}</strong> is now live on the Bharat AI Marketplace. Buyers can find it, and their inquiries will reach this address.</p>
        ${emailButton(`${origin}/marketplace/listing/${row.company_slug}/${row.product_slug}`, 'View your listing')}
        ${emailMissingBlock(c, missing, 'To get more out of it, add:')}
        ${missing.length ? '<p style="margin:10px 0 0;font-size:12px;color:#888">Changes are reviewed before they go live.</p>' : ''}`
      ok = await sendMail(c, 'company-approved', row.account_email, `Your listing is live: ${row.product_name}`, emailShell('Your listing is approved', body))
    } else {
      const body = `<p style="margin:0;font-size:14px;line-height:1.6">We could not publish <strong>${htmlEsc(row.product_name)}</strong> as submitted.</p>
        ${reason ? `<div style="margin-top:14px;padding:12px 14px;background:#f8f9fa;border-left:3px solid #FF9933;font-size:14px;line-height:1.6;white-space:pre-wrap">${htmlEsc(reason)}</div>` : ''}
        <p style="margin:14px 0 0;font-size:14px;line-height:1.6">Edit the listing from your dashboard and it goes straight back into review.</p>
        ${emailButton(origin + '/marketplace/dashboard', 'Open your dashboard')}`
      ok = await sendMail(c, 'company-rejected', row.account_email, `Your listing needs changes: ${row.product_name}`, emailShell('Your listing was not approved', body))
    }
    await auditAdmin(c, admin, ok ? 'marketplace.email-sent' : 'marketplace.email-failed', listingId, { kind: 'company-' + status })
  })

const sendCompletionReminder = async (c: any, row: any, missing: string[]): Promise<boolean> => {
  const live = row.status === 'approved'
  const body = `<p style="margin:0;font-size:14px;line-height:1.6">${live ? `<strong>${htmlEsc(row.product_name)}</strong> is live on the Bharat AI Marketplace, but` : `Your listing <strong>${htmlEsc(row.product_name)}</strong> is`} missing some details buyers look for.</p>
    ${emailMissingBlock(c, missing, 'Please add:')}
    ${live ? '<p style="margin:10px 0 0;font-size:12px;color:#888">Changes are reviewed before they go live.</p>' : ''}`
  return sendMail(c, 'company-reminder', row.account_email, `Complete your listing: ${row.product_name}`, emailShell('Complete your marketplace listing', body))
}

const notifyCompanyOfInquiry = (c: any, listing: any, inq: { name: string; email: string; company: string; phone: string; message: string }) =>
  inBackground(c, async () => {
    const owner = await c.env.DB.prepare('SELECT email FROM mp_companies WHERE id = ?').bind(listing.company_id).first() as any
    if (!owner?.email) return
    const body = `<p style="margin:0 0 14px;font-size:14px;line-height:1.6">Someone sent an inquiry about <strong>${htmlEsc(listing.product_name)}</strong> on the Bharat AI Marketplace. Reply to them directly at the address below.</p>
      <table style="border-collapse:collapse">${emailRow('Name', inq.name)}${emailRow('Email', inq.email)}${emailRow('Company', inq.company)}${emailRow('Phone', inq.phone)}</table>
      ${inq.message ? `<div style="margin-top:14px;padding:12px 14px;background:#f8f9fa;border-left:3px solid #FF9933;font-size:14px;line-height:1.6;white-space:pre-wrap">${htmlEsc(inq.message)}</div>` : ''}
      ${emailButton(siteOrigin(c) + '/marketplace/dashboard', 'See all inquiries')}`
    await sendMail(c, 'company-inquiry', owner.email, `New inquiry about ${listing.product_name} from ${inq.name}`, emailShell('New marketplace inquiry', body))
  })

// ── Session signing ──
// The session cookie is `<companyId>.<hmac>` where hmac = HMAC-SHA256 of the
// id under the server secret. A forged/edited id fails the signature check,
// which closes the previous hole where the cookie was a bare, guessable id.
const sessionSecret = (c: any): string =>
  c.env.MP_SESSION_SECRET || c.env.ADMIN_SECRET || ''

const hmacHex = async (secret: string, message: string): Promise<string> => {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Constant-time-ish string compare (avoids trivial early-exit timing leaks).
const safeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const signSession = async (c: any, companyId: number | string): Promise<string> => {
  const secret = sessionSecret(c)
  const id = String(companyId)
  const sig = await hmacHex(secret, id)
  return `${id}.${sig}`
}

// Returns the verified company id from a signed cookie value, or null.
const verifySession = async (c: any, value: string): Promise<number | null> => {
  const secret = sessionSecret(c)
  if (!secret || !value) return null
  const dot = value.lastIndexOf('.')
  if (dot < 1) return null // reject bare-id (legacy/forged) cookies — no signature
  const id = value.slice(0, dot)
  const sig = value.slice(dot + 1)
  if (!/^\d+$/.test(id)) return null
  const expected = await hmacHex(secret, id)
  if (!safeEqual(sig, expected)) return null
  return parseInt(id, 10)
}

const mpSessionCookie = (value: string, maxAge = 604800) =>
  `mp_session=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`

// ── Sign-in links ──
// An exhibitor's account is made for them from the booth record, so the invitation
// can sign them straight in - no form, no password - the way the campus panel emails
// already do. The link is <id>.<exp>.<hmac>: good for seven days, bound to the
// account by the signature, and it opens an ordinary session. Whoever the email is
// forwarded to gets in as that company, which is usually the colleague meant to fill
// the listing in; the panel links make the same trade.
const SIGNIN_LINK_DAYS = 7
// The signature also covers the account's password hash, so the moment an exhibitor
// sets a password every link still out there stops working. Until then the link is
// the only key, and a forwarded email is a week of access - the same trade the
// panel links make, on something less sensitive than a badge.
const linkFingerprint = async (c: any, passwordHash: string) => (await hmacHex(sessionSecret(c), 'mplink-pw:' + (passwordHash || ''))).slice(0, 16)
// <id>.<exp>.<fingerprint>.<sig>. The fingerprint travels inside the signed token so a
// forged link is refused on the signature alone, before the database is read; only a
// genuine link costs a lookup, to compare its fingerprint with the account's now.
const signInToken = async (c: any, companyId: number | string, passwordHash: string): Promise<string> => {
  const exp = Math.floor(Date.now() / 1000) + SIGNIN_LINK_DAYS * 86400
  const fp = await linkFingerprint(c, passwordHash)
  const sig = await hmacHex(sessionSecret(c), `mplink:${companyId}.${exp}.${fp}`)
  return `${companyId}.${exp}.${fp}.${sig}`
}
// Signature and expiry only; returns the account id and the fingerprint to compare.
const verifySignInToken = async (c: any, token: string): Promise<{ id: number; fp: string } | null> => {
  const secret = sessionSecret(c)
  const [id, exp, fp, sig] = String(token || '').split('.')
  if (!secret || !/^\d+$/.test(id || '') || !/^\d+$/.test(exp || '') || !/^[0-9a-f]{16}$/.test(fp || '') || !sig) return null
  if (parseInt(exp, 10) * 1000 < Date.now()) return null
  if (!safeEqual(sig, await hmacHex(secret, `mplink:${id}.${exp}.${fp}`))) return null
  return { id: parseInt(id, 10), fp }
}
const signInLink = async (c: any, companyId: number | string) => {
  const row = await c.env.DB.prepare('SELECT password_hash FROM mp_companies WHERE id = ?').bind(companyId).first() as any
  return `${siteOrigin(c)}/marketplace/signin?t=${await signInToken(c, companyId, String(row?.password_hash || ''))}`
}

// ── Helpers ──
const generateSlug = (text: string) =>
  (text || '').toLowerCase().trim()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)

// Two accounts can slugify to the same company ("Acme" and "ACME"), and the
// by-slug lookup returns one row, so the second listing was unreachable.
const uniqueProductSlug = async (c: any, companySlug: string, productName: string, excludeId = 0) => {
  const root = generateSlug(productName) || 'product'
  for (let n = 1; n <= 50; n++) {
    const candidate = n === 1 ? root : `${root.slice(0, 76)}-${n}`
    const clash = await c.env.DB.prepare('SELECT id FROM mp_listings WHERE company_slug = ? AND product_slug = ? AND id != ?')
      .bind(companySlug, candidate, excludeId).first()
    if (!clash) return candidate
  }
  return `${root.slice(0, 70)}-${Date.now().toString(36)}`
}

// Passwords were a single unsalted SHA-256 round. That is reversible for anything
// in a wordlist and, being unsalted, identical passwords produced identical hashes
// — one cracked hash exposed every account sharing that password.
//
// Now PBKDF2-SHA256 with a per-account random salt. The iteration count is stored
// inside the hash, so it can be raised later without invalidating existing rows.
// NOTE ON WORKERS CPU: key derivation is deliberately expensive. 100k iterations
// costs roughly 40-90ms of CPU. That is fine on Workers Paid; if marketplace login
// ever starts failing with "Exceeded CPU limit" on the free tier, lower this
// constant — the stored format keeps older hashes verifiable either way.
const PBKDF2_ITERATIONS = 100000

// Chunked: spreading a whole buffer into String.fromCharCode overflows the stack
// somewhere past ~120KB, which is what made every product image upload fail.
const b64 = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)))
  }
  return btoa(bin)
}
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), ch => ch.charCodeAt(0))

const deriveKey = async (password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256)
  return new Uint8Array(bits)
}

// Constant-time compare — a length-or-content shortcut leaks the hash byte by byte.
const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

const hashPassword = async (password: string) => {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await deriveKey(password, salt, PBKDF2_ITERATIONS)
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(hash)}`
}

// The old scheme, kept only so existing accounts can still sign in once.
const legacySha256Hex = async (password: string) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

type PwResult = 'ok' | 'legacy' | 'bad'
const verifyPassword = async (password: string, stored: string): Promise<PwResult> => {
  if (!stored) return 'bad'
  if (stored.startsWith('pbkdf2$')) {
    const [, iterStr, saltB64, hashB64] = stored.split('$')
    const iterations = parseInt(iterStr, 10)
    if (!iterations || !saltB64 || !hashB64) return 'bad'
    const derived = await deriveKey(password, unb64(saltB64), iterations)
    return bytesEqual(derived, unb64(hashB64)) ? 'ok' : 'bad'
  }
  // Legacy unsalted SHA-256. Correct here means "let them in, then upgrade".
  return safeEqual(await legacySha256Hex(password), stored) ? 'legacy' : 'bad'
}

const getCookie = (c: any, name: string) => {
  const header = c.req.header('Cookie') || ''
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

const getCompanyFromSession = async (c: any) => {
  const raw = getCookie(c, 'mp_session')
  if (!raw) return null
  const companyId = await verifySession(c, raw)
  if (companyId === null) return null // unsigned/forged/tampered → not authenticated
  const company = await c.env.DB.prepare('SELECT id, company_name, email, role, exhibitor_id, attendee_id FROM mp_companies WHERE id = ?').bind(companyId).first()
  return company || null
}

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/

// ── Who may moderate ──
// The marketplace's own role='admin' account, or anyone the /admin event panel
// already trusts, so the team reviews listings without a second password. The
// panel's check also accepts ?token=<ADMIN_SECRET>; that is refused here, because
// a link carrying it would put the master secret in browser history, logs and the
// Referer of every outbound link on the review page.
const eventAdminRequest = (c: any): boolean => {
  if (!hooks.isEventAdmin || c.req.query('token')) return false
  try { return !!hooks.isEventAdmin(c) } catch { return false }
}

type MarketplaceAdmin = { via: 'marketplace'; company: any } | { via: 'event'; company: null }
const marketplaceAdmin = async (c: any): Promise<MarketplaceAdmin | null> => {
  const company = await getCompanyFromSession(c) as any
  if (company && company.role === 'admin') return { via: 'marketplace', company }
  if (eventAdminRequest(c)) return { via: 'event', company: null }
  return null
}

// Moderation goes into the same audit log as the rest of the admin panel. An event
// admin is named the way the panel names them (staff account, or the operator name
// typed into the panel); the separate marketplace account is named by its email.
const auditAdmin = async (c: any, admin: MarketplaceAdmin, action: string, entityId: any, detail?: any, entity = 'mp_listing') => {
  if (!hooks.audit) return
  const actorOverride = admin.via === 'marketplace' ? { actor: String(admin.company.email || 'marketplace admin'), kind: 'marketplace-account' } : undefined
  try { await hooks.audit(c, action, entity, entityId, detail, actorOverride) } catch { /* never fail the action it records */ }
}

// ── Exhibitor cross-link ──
// Nothing ever set mp_companies.exhibitor_id once the credential-free
// exhibitor-login route was deleted, so no listing could show a booth. A company
// whose marketplace email matches an exhibitor's contact email is linked
// automatically; admin can also link or unlink one by hand while reviewing. The
// email is not verified, which is why the link is shown to the admin before approval.
const findExhibitorByEmail = async (c: any, email: string) => {
  if (!email) return null
  try {
    return await c.env.DB.prepare(
      "SELECT id, company_name, booth_number FROM exhibitors WHERE trim(ifnull(contact_email, '')) <> '' AND lower(trim(contact_email)) = lower(trim(?)) ORDER BY id DESC LIMIT 1"
    ).bind(email).first() as any
  } catch { return null }
}

// The account behind an invitation, made from the booth record with no password. The
// sign-in link opens it, and "Create Account" with the same email claims it (sets a
// password) instead of being refused as already registered.
const ensureExhibitorAccount = async (c: any, exhibitor: { id: number; company_name: string; contact_email: string }): Promise<number | null> => {
  const email = String(exhibitor.contact_email || '').trim().toLowerCase()
  if (!email) return null
  const existing = await c.env.DB.prepare('SELECT id, exhibitor_id FROM mp_companies WHERE lower(email) = ? ORDER BY id LIMIT 1').bind(email).first() as any
  if (existing) {
    if (!existing.exhibitor_id) await c.env.DB.prepare('UPDATE mp_companies SET exhibitor_id = ? WHERE id = ?').bind(exhibitor.id, existing.id).run()
    return existing.id
  }
  const ins = await c.env.DB.prepare('INSERT INTO mp_companies (company_name, email, password_hash, exhibitor_id) VALUES (?, ?, ?, ?)')
    .bind(String(exhibitor.company_name || 'Exhibitor').trim().slice(0, 150), email, '', exhibitor.id).run()
  return ins.meta.last_row_id as number
}

const resolveExhibitor = async (c: any, company: any) => {
  if (company.exhibitor_id) {
    const linked = await c.env.DB.prepare('SELECT id, company_name, booth_number FROM exhibitors WHERE id = ?').bind(company.exhibitor_id).first().catch(() => null)
    if (linked) return linked as any
  }
  const match = await findExhibitorByEmail(c, company.email)
  if (match) await c.env.DB.prepare('UPDATE mp_companies SET exhibitor_id = ? WHERE id = ?').bind(match.id, company.id).run()
  return match
}

// ── Listing input ──
// Every link and image used to be stored as typed and then written into href/src
// on the public page, so a javascript: URL was one click from running on this origin.
const LINK_FIELDS = ['website_url', 'product_url', 'demo_url', 'video_url']
const IMAGE_FIELDS = ['logo_url', 'product_image_url']
const TEXT_FIELDS = [
  'target_customer', 'target_industry', 'target_functional_area', 'ai_category', 'ai_category_custom', 'tags',
  'innovation', 'use_cases', 'pricing_type', 'pricing_details', 'founder_name', 'cto_name', 'contact_name',
  'company_registration', 'company_phone', 'company_address', 'sales_contact_name', 'sales_contact_email',
  'sales_contact_phone', 'current_customers', 'integration_requirements', 'supported_platforms', 'tech_stack',
  'security_protocols', 'case_studies', 'certifications_compliance', 'access_info', 'support_offering',
  'sla_details', 'onboarding_process',
]
const FIELD_LABELS: Record<string, string> = {
  product_name: 'Product name', description: 'Description', website_url: 'Website URL', product_url: 'Product URL',
  demo_url: 'Demo URL', video_url: 'Video URL', sales_contact_email: 'Sales email',
}
const UPLOAD_URL_RE = /^\/api\/mp\/uploads\/\d+$/

const cleanLink = (raw: any): string | null => {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  const isWeb = (v: string) => { try { const u = new URL(v); return u.protocol === 'https:' || u.protocol === 'http:' } catch { return false } }
  // Returned as typed, not re-serialised: URL.toString() adds a trailing slash, and
  // an untouched field would then count as an edit and send the listing back to review.
  if (isWeb(s)) return s
  // A bare domain ("example.com") is what people type into the dashboard's plain inputs.
  if (/^[\w-]+(\.[\w-]+)+([/?#]\S*)?$/.test(s) && isWeb('https://' + s)) return 'https://' + s
  return null
}

// Returns the cleaned values for the fields present in `body`, or an error message.
const normalizeListingInput = (body: any, fields: string[]): { values: Record<string, string>; error?: string } => {
  const values: Record<string, string> = {}
  for (const f of fields) {
    if (body[f] === undefined) continue
    const label = FIELD_LABELS[f] || f.replace(/_/g, ' ')
    if (LINK_FIELDS.includes(f)) {
      const v = cleanLink(body[f])
      if (v === null) return { values, error: `${label} must be a web address starting with http:// or https://` }
      values[f] = v
    } else if (IMAGE_FIELDS.includes(f)) {
      const v = String(body[f] ?? '').trim()
      if (v && !UPLOAD_URL_RE.test(v)) return { values, error: `${label} must be an image uploaded through the form` }
      values[f] = v
    } else if (f === 'screenshot_urls') {
      const list = String(body[f] ?? '').split(',').map(s => s.trim()).filter(Boolean)
      if (list.length > 3 || list.some(u => !UPLOAD_URL_RE.test(u))) return { values, error: 'Screenshots must be up to 3 images uploaded through the form' }
      values[f] = list.join(', ')
    } else {
      const v = String(body[f] ?? '').trim()
      const max = f === 'product_name' ? 150 : 5000
      if (v.length > max) return { values, error: `${label} is too long (max ${max} characters)` }
      if (f === 'sales_contact_email' && v && !EMAIL_RE.test(v)) return { values, error: 'Sales email is not a valid email address' }
      values[f] = v
    }
  }
  if ('product_name' in values && !values.product_name) return { values, error: 'Product name is required' }
  if ('description' in values && !values.description) return { values, error: 'Description is required' }
  return { values }
}

// An upload URL is only an id, so without this a listing could point at another
// company's images.
const uploadsOwnedBy = async (c: any, companyId: number, urls: any[]): Promise<boolean> => {
  for (const u of urls.map(u => String(u || '').trim()).filter(Boolean)) {
    const id = parseInt(u.split('/').pop() || '', 10)
    const row = await c.env.DB.prepare('SELECT company_id FROM mp_uploads WHERE id = ?').bind(id).first() as any
    if (!row || row.company_id !== companyId) return false
  }
  return true
}
const imagesOwnedBy = (c: any, companyId: number, values: Record<string, string>): Promise<boolean> =>
  uploadsOwnedBy(c, companyId, [values.logo_url, values.product_image_url, ...String(values.screenshot_urls || '').split(',')])

// ══════════════════════════════════════════
// AUTH ROUTES
// ══════════════════════════════════════════

mp.post('/api/mp/auth/register', async (c) => {
  const body = await c.req.json().catch(() => ({})) as any
  const company_name = String(body.company_name || '').trim()
  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')
  if (!company_name || !email || !password) return c.json({ error: 'All fields required' }, 400)
  if (company_name.length > 150) return c.json({ error: 'Company name is too long' }, 400)
  if (!EMAIL_RE.test(email)) return c.json({ error: 'Enter a valid email address' }, 400)
  if (password.length < 6) return c.json({ error: 'Password must be at least 6 characters' }, 400)

  const existing = await c.env.DB.prepare('SELECT id, password_hash FROM mp_companies WHERE lower(email) = ? ORDER BY id LIMIT 1').bind(email).first() as any
  if (existing && existing.password_hash) return c.json({ error: 'Email already registered' }, 400)

  const password_hash = await hashPassword(password)
  let id: number
  if (existing) {
    // Made for an exhibitor from the booth record and not yet claimed: registering
    // with that email claims it, keeping the booth link, rather than being refused.
    await c.env.DB.prepare('UPDATE mp_companies SET company_name = ?, password_hash = ? WHERE id = ?').bind(company_name, password_hash, existing.id).run()
    id = existing.id
  } else {
    const result = await c.env.DB.prepare(
      'INSERT INTO mp_companies (company_name, email, password_hash) VALUES (?, ?, ?)'
    ).bind(company_name, email, password_hash).run()
    id = result.meta.last_row_id as number
  }

  // Signed straight in: registering used to end on "Please login", a second form
  // standing between a company and the listing form it came for.
  c.header('Set-Cookie', mpSessionCookie(await signSession(c, id)))
  notifyCompanyWelcome(c, company_name, email)
  return c.json({ success: true, id, claimed: !!existing, user: { id, company_name, email, role: 'company' } })
})

// "Email me a sign-in link": for an exhibitor whose account was made for them, and for
// anyone who has forgotten a password. The reply is the same whether or not the
// address is known, so the form cannot be used to find out who has an account.
mp.post('/api/mp/auth/link', async (c) => {
  const body = await c.req.json().catch(() => ({})) as any
  const email = String(body.email || '').trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return c.json({ error: 'Enter a valid email address' }, 400)
  const reply = () => c.json({ success: true, message: 'If that address has a marketplace account or a booth booking, a sign-in link is on its way.' })

  let company = await c.env.DB.prepare('SELECT id, company_name, role FROM mp_companies WHERE lower(email) = ? ORDER BY id LIMIT 1').bind(email).first() as any
  if (!company) {
    const ex = await findExhibitorByEmail(c, email)
    if (ex) {
      const id = await ensureExhibitorAccount(c, { id: ex.id, company_name: ex.company_name, contact_email: email })
      if (id) company = { id, company_name: ex.company_name, role: 'company' }
    }
  }
  // The admin account keeps its password; a mailed link would make its inbox the key.
  if (!company || company.role === 'admin') return reply()
  // One link per account every two minutes, so the form cannot flood an inbox.
  const recent = await c.env.DB.prepare(
    "SELECT 1 AS hit FROM admin_audit WHERE action = 'marketplace.signin-link' AND entity = 'mp_company' AND entity_id = ? AND created_at > datetime('now', '-2 minutes')"
  ).bind(String(company.id)).first().catch(() => null)
  if (recent) return reply()

  const link = await signInLink(c, company.id)
  const html = emailShell('Your marketplace sign-in link', `<p style="margin:0;font-size:14px;line-height:1.6">Click the button to sign in to the Bharat AI Marketplace as <strong>${htmlEsc(company.company_name)}</strong>. It works for seven days and needs no password.</p>
    ${emailButton(link, 'Sign in to the marketplace')}
    <p style="margin:16px 0 0;font-size:12px;color:#888">If you did not ask for this, you can ignore this email.</p>`)
  inBackground(c, async () => {
    const ok = await sendMail(c, 'signin-link', email, 'Your Bharat AI Marketplace sign-in link', html)
    try { await hooks.audit?.(c, ok ? 'marketplace.signin-link' : 'marketplace.signin-link-failed', 'mp_company', company.id, undefined, { actor: 'marketplace', kind: 'system' }) } catch { /* the send stands either way */ }
  })
  return reply()
})

// Where a sign-in link lands. A bad or expired link goes back to the marketplace
// with a flag the page turns into "ask for a fresh one".
mp.get('/marketplace/signin', async (c) => {
  const link = await verifySignInToken(c, c.req.query('t') || '')
  if (!link) return c.redirect('/marketplace?signin=expired')
  const company = await c.env.DB.prepare('SELECT id, role, password_hash, exhibitor_id FROM mp_companies WHERE id = ?').bind(link.id).first() as any
  // A password set since the link was sent changes the fingerprint and retires the link.
  if (!company || company.role === 'admin' || !safeEqual(link.fp, await linkFingerprint(c, String(company.password_hash || '')))) return c.redirect('/marketplace?signin=expired')
  c.header('Set-Cookie', mpSessionCookie(await signSession(c, company.id)))
  // An exhibitor with a stage slot has two things to do, the listing and the talk, and
  // the dashboard's to-do list shows both. Anyone else goes straight to the listing
  // form until they have a listing.
  if (company.exhibitor_id && await stageSlotOf(c, Number(company.exhibitor_id))) return c.redirect('/marketplace/dashboard')
  const has = await c.env.DB.prepare('SELECT 1 AS hit FROM mp_listings WHERE company_id = ? LIMIT 1').bind(company.id).first()
  return c.redirect(has ? '/marketplace/dashboard' : '/marketplace?submit=true')
})

mp.post('/api/mp/auth/login', async (c) => {
  const body = await c.req.json().catch(() => ({})) as any
  const email = String(body.email || '').trim()
  const password = String(body.password || '')
  if (!email || !password) return c.json({ error: 'Email and password required' }, 400)

  // Matching in SQL is no longer possible: every account has its own salt, so the
  // row must be fetched first and the password verified in code.
  const company = await c.env.DB.prepare(
    'SELECT id, company_name, email, role, password_hash FROM mp_companies WHERE lower(email) = lower(?) ORDER BY id LIMIT 1'
  ).bind(email).first() as any

  if (!company) return c.json({ error: 'Invalid email or password' }, 401)
  // An account made for an exhibitor that nobody has claimed has no password to check.
  if (!company.password_hash) return c.json({ error: 'This account has no password yet. Use "Email me a sign-in link" below, or create the account with this email to set one.' }, 401)

  const verdict = await verifyPassword(password, company.password_hash || '')
  if (verdict === 'bad') return c.json({ error: 'Invalid email or password' }, 401)

  // Rehash-on-login: the only moment the plaintext is available, so upgrade the
  // stored hash from the legacy scheme now and never look at it again.
  if (verdict === 'legacy') {
    await c.env.DB.prepare('UPDATE mp_companies SET password_hash = ? WHERE id = ?')
      .bind(await hashPassword(password), company.id).run()
  }
  delete company.password_hash

  // Set signed cookie session (see signSession — id is HMAC-signed so it
  // can't be forged the way a bare id could).
  c.header('Set-Cookie', mpSessionCookie(await signSession(c, company.id as number)))
  return c.json({ success: true, user: company })
})

mp.get('/api/mp/auth/me', async (c) => {
  const company = await getCompanyFromSession(c)
  // Reported whether or not a company is also signed in here: an organiser who has
  // tried the listing flow as a company in the same browser is still an admin.
  return c.json({ user: company, event_admin: eventAdminRequest(c) })
})

mp.post('/api/mp/auth/logout', async (c) => {
  c.header('Set-Cookie', mpSessionCookie('', 0))
  return c.json({ success: true })
})

// REMOVED: POST /api/mp/auth/exhibitor-login — it minted a validly-signed
// marketplace session from an attendee_id and email supplied in the request body,
// with no credential of any kind. Passing an existing company's email relinked that
// company to the caller and returned a session for it, so any account — including
// role='admin' — could be taken over by anyone who knew its email address. It also
// auto-created accounts with the guessable password 'exhibitor_<attendee_id>'.
// Nothing in the app, the static JS or any page called it: the only occurrence in the
// repository was the route definition itself. Deleted rather than patched.

// ══════════════════════════════════════════
// LISTINGS (PUBLIC)
// ══════════════════════════════════════════

// exhibitor_booth is read live from the exhibitor row, so a booth assigned after
// the listing was approved still shows; booth_number is the snapshot taken at submit.
const PUBLIC_LISTING_SELECT =
  'SELECT l.*, e.company_name AS exhibitor_company, e.booth_number AS exhibitor_booth FROM mp_listings l LEFT JOIN exhibitors e ON l.exhibitor_id = e.id'

mp.get('/api/mp/listings', async (c) => {
  // Hardcoded: this is the PUBLIC catalogue. The status used to come from the query
  // string, so ?status=pending / ?status=rejected dumped every unreviewed listing
  // with its private contact and registration details to anonymous callers.
  // Moderators read the queue through the admin routes, which check role='admin'.
  const listings = await c.env.DB.prepare(
    `${PUBLIC_LISTING_SELECT} WHERE l.status = ? ORDER BY l.created_at DESC`
  ).bind('approved').all()
  return c.json({ listings: listings.results })
})

mp.get('/api/mp/listings/by-slug/:companySlug/:productSlug', async (c) => {
  const companySlug = c.req.param('companySlug')
  const productSlug = c.req.param('productSlug')
  const listing = await c.env.DB.prepare(
    `${PUBLIC_LISTING_SELECT} WHERE l.company_slug = ? AND l.product_slug = ? AND l.status = ?`
  ).bind(companySlug, productSlug, 'approved').first()
  if (!listing) return c.json({ error: 'Listing not found' }, 404)
  // Increment view count
  await c.env.DB.prepare('UPDATE mp_listings SET view_count = view_count + 1 WHERE id = ?').bind(listing.id).run()
  return c.json({ listing })
})

mp.get('/api/mp/listings/:id', async (c) => {
  // Approved only, like the slug route. This one had no status filter, and ids are
  // sequential, so /api/mp/listings/1, /2, /3... returned every pending and
  // rejected submission with its registration number, phone and address.
  const id = parseInt(c.req.param('id'), 10)
  if (!Number.isFinite(id)) return c.json({ error: 'Listing not found' }, 404)
  const listing = await c.env.DB.prepare(`${PUBLIC_LISTING_SELECT} WHERE l.id = ? AND l.status = ?`).bind(id, 'approved').first()
  if (!listing) return c.json({ error: 'Listing not found' }, 404)
  await c.env.DB.prepare('UPDATE mp_listings SET view_count = view_count + 1 WHERE id = ?').bind(listing.id).run()
  return c.json({ listing })
})

// ── Submit new listing ──
mp.post('/api/mp/listings', async (c) => {
  const company = await getCompanyFromSession(c) as any
  if (!company) return c.json({ error: 'Login required' }, 401)

  const body = await c.req.json().catch(() => ({})) as any
  if (!String(body.product_name || '').trim() || !String(body.description || '').trim()) {
    return c.json({ error: 'Product name and description are required' }, 400)
  }
  const { values: v, error } = normalizeListingInput(body, ['product_name', 'description', ...TEXT_FIELDS, ...LINK_FIELDS, ...IMAGE_FIELDS, 'screenshot_urls'])
  if (error) return c.json({ error }, 400)
  if (!(await imagesOwnedBy(c, company.id, v))) return c.json({ error: 'Images must be uploaded through the form' }, 400)

  // A failed upload used to lose the whole form, so people resubmitted; now that
  // submitting works, the same product twice is a mistake rather than a retry.
  const dup = await c.env.DB.prepare('SELECT id FROM mp_listings WHERE company_id = ? AND lower(trim(product_name)) = lower(?)')
    .bind(company.id, v.product_name).first()
  if (dup) return c.json({ error: `You already have a listing called "${v.product_name}". Edit it from your dashboard instead.` }, 409)

  const company_slug = generateSlug(company.company_name) || 'company'
  const product_slug = await uniqueProductSlug(c, company_slug, v.product_name)

  const exhibitor = await resolveExhibitor(c, company)
  const exhibitor_id = exhibitor ? exhibitor.id : null
  const booth_number = exhibitor ? (exhibitor.booth_number || null) : null

  const s = (f: string) => v[f] || ''
  const result = await c.env.DB.prepare(`
    INSERT INTO mp_listings (
      company_id, company_name, company_slug, product_name, product_slug,
      description, target_customer, target_industry, target_functional_area,
      ai_category, ai_category_custom, tags, innovation, use_cases,
      pricing_type, pricing_details, product_image_url, logo_url, screenshot_urls,
      website_url, product_url, demo_url, video_url,
      founder_name, cto_name, contact_name, company_registration, company_phone, company_address,
      sales_contact_name, sales_contact_email, sales_contact_phone,
      current_customers, integration_requirements, supported_platforms,
      tech_stack, security_protocols, case_studies, certifications_compliance,
      access_info, support_offering, sla_details, onboarding_process,
      exhibitor_id, booth_number, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    company.id, company.company_name, company_slug, v.product_name, product_slug,
    v.description, s('target_customer'), s('target_industry'), s('target_functional_area'),
    s('ai_category'), s('ai_category_custom'), s('tags'), s('innovation'), s('use_cases'),
    s('pricing_type'), s('pricing_details'), s('product_image_url'), s('logo_url'), s('screenshot_urls'),
    s('website_url'), s('product_url'), s('demo_url'), s('video_url'),
    s('founder_name'), s('cto_name'), s('contact_name'), s('company_registration'), s('company_phone'), s('company_address'),
    s('sales_contact_name'), s('sales_contact_email'), s('sales_contact_phone'),
    s('current_customers'), s('integration_requirements'), s('supported_platforms'),
    s('tech_stack'), s('security_protocols'), s('case_studies'), s('certifications_compliance'),
    s('access_info'), s('support_offering'), s('sla_details'), s('onboarding_process'),
    exhibitor_id, booth_number, 'pending'
  ).run()

  const id = result.meta.last_row_id
  notifyTeamOfSubmission(c, { id, product_name: v.product_name, company_name: company.company_name, description: v.description, website_url: v.website_url }, company.email, 'new')
  notifyCompanyOfSubmission(c, company.email, v)
  return c.json({ success: true, id, missing: missingListingInfo(v) })
})

// ── Reviews ──
mp.get('/api/mp/listings/:id/reviews', async (c) => {
  const listingId = c.req.param('id')
  const reviews = await c.env.DB.prepare(
    'SELECT r.id, r.listing_id, r.company_name, r.rating, r.comment, r.created_at FROM mp_reviews r JOIN mp_listings l ON l.id = r.listing_id WHERE r.listing_id = ? AND l.status = ? ORDER BY r.created_at DESC'
  ).bind(parseInt(listingId), 'approved').all()
  return c.json({ reviews: reviews.results })
})

mp.post('/api/mp/listings/:id/reviews', async (c) => {
  const company = await getCompanyFromSession(c) as any
  if (!company) return c.json({ error: 'Login required' }, 401)

  const listingId = parseInt(c.req.param('id'), 10)
  const body = await c.req.json().catch(() => ({})) as any
  const rating = Number(body.rating)
  const comment = String(body.comment || '').trim().slice(0, 2000)
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return c.json({ error: 'Rating must be 1-5' }, 400)

  const listing = await c.env.DB.prepare('SELECT id, company_id FROM mp_listings WHERE id = ? AND status = ?').bind(listingId, 'approved').first() as any
  if (!listing) return c.json({ error: 'Listing not found' }, 404)
  if (listing.company_id === company.id) return c.json({ error: 'You cannot review your own listing' }, 403)

  // One review per company per listing: a second one replaces the first.
  const existing = await c.env.DB.prepare('SELECT id FROM mp_reviews WHERE listing_id = ? AND company_id = ?').bind(listingId, company.id).first() as any
  if (existing) {
    await c.env.DB.prepare('UPDATE mp_reviews SET rating = ?, comment = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?').bind(rating, comment, existing.id).run()
  } else {
    await c.env.DB.prepare(
      'INSERT INTO mp_reviews (listing_id, company_id, company_name, rating, comment) VALUES (?, ?, ?, ?, ?)'
    ).bind(listingId, company.id, company.company_name, rating, comment).run()
  }
  return c.json({ success: true })
})

// ── Marketplace inquiries ──
mp.post('/api/mp/inquiries', async (c) => {
  const body = await c.req.json().catch(() => ({})) as any
  const listingId = parseInt(body.listing_id, 10)
  const name = String(body.inquirer_name || '').trim().slice(0, 120)
  const email = String(body.inquirer_email || '').trim().slice(0, 200)
  const company = String(body.inquirer_company || '').trim().slice(0, 200)
  const phone = String(body.inquirer_phone || '').trim().slice(0, 40)
  const message = String(body.inquirer_message || '').trim().slice(0, 4000)
  if (!listingId || !name || !email) return c.json({ error: 'Name, email, and listing are required' }, 400)
  if (!EMAIL_RE.test(email)) return c.json({ error: 'Enter a valid email address' }, 400)

  const listing = await c.env.DB.prepare('SELECT id, company_id, product_name FROM mp_listings WHERE id = ? AND status = ?').bind(listingId, 'approved').first() as any
  if (!listing) return c.json({ error: 'Listing not found' }, 404)

  // Each inquiry now emails the vendor, and the form needs no login, so a repeat
  // from the same address inside ten minutes is accepted but not stored or sent twice.
  const recent = await c.env.DB.prepare(
    "SELECT id FROM mp_inquiries WHERE listing_id = ? AND lower(inquirer_email) = lower(?) AND created_at > datetime('now', '-10 minutes')"
  ).bind(listingId, email).first()
  if (recent) return c.json({ success: true })

  await c.env.DB.prepare(
    'INSERT INTO mp_inquiries (listing_id, inquirer_name, inquirer_email, inquirer_company, inquirer_phone, inquirer_message) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(listingId, name, email, company, phone, message).run()

  notifyCompanyOfInquiry(c, listing, { name, email, company, phone, message })
  return c.json({ success: true })
})

// ── File uploads ──
// Only real images are accepted, identified by their bytes rather than the
// browser-declared type. SVG is refused here because it can carry script; the
// listing form converts SVG logos to PNG before uploading.
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
// D1 caps a row at 2MB and base64 grows data by a third.
const MAX_INLINE_UPLOAD_BYTES = 1400 * 1024
const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif' }

const sniffImageType = (b: Uint8Array): string | null => {
  const ascii = (s: number, e: number) => String.fromCharCode(...Array.from(b.subarray(s, e)))
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 6 && ascii(0, 4) === 'GIF8') return 'image/gif'
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  if (b.length >= 12 && ascii(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 12))) return 'image/avif'
  return null
}

mp.post('/api/mp/uploads', async (c) => {
  const company = await getCompanyFromSession(c) as any
  if (!company) return c.json({ error: 'Login required' }, 401)

  const formData = await c.req.formData().catch(() => null)
  const file = formData?.get('file') as File | string | null
  if (!file || typeof file === 'string') return c.json({ error: 'No file provided' }, 400)

  const bytes = new Uint8Array(await file.arrayBuffer())
  const type = sniffImageType(bytes)
  if (!type) return c.json({ error: 'Please upload a PNG, JPG, WebP or GIF image.' }, 415)
  const limit = c.env.UPLOADS ? MAX_UPLOAD_BYTES : MAX_INLINE_UPLOAD_BYTES
  if (bytes.length > limit) return c.json({ error: `Image too large (max ${(limit / 1048576).toFixed(1)}MB)` }, 413)

  // R2 when bound, as the attendee photos are; the D1 row keeps ownership and the id
  // the listing URL uses, so /api/mp/uploads/<id> works for both storage kinds.
  let data: string
  if (c.env.UPLOADS) {
    const key = `marketplace/${company.id}/${crypto.randomUUID()}.${IMAGE_EXT[type]}`
    await c.env.UPLOADS.put(key, bytes, { httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' } })
    data = 'r2:' + key
  } else {
    data = `data:${type};base64,${b64(bytes)}`
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO mp_uploads (company_id, filename, content_type, size, data) VALUES (?, ?, ?, ?, ?)'
  ).bind(company.id, String(file.name || 'image').slice(0, 200), type, bytes.length, data).run()

  return c.json({ success: true, url: `/api/mp/uploads/${result.meta.last_row_id}`, id: result.meta.last_row_id })
})

mp.get('/api/mp/uploads/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (!Number.isFinite(id)) return c.json({ error: 'File not found' }, 404)
  const upload = await c.env.DB.prepare('SELECT data, content_type FROM mp_uploads WHERE id = ?').bind(id).first()
  if (!upload) return c.json({ error: 'File not found' }, 404)

  // The stored content_type is attacker-chosen at upload time. Replaying it let a
  // vendor upload HTML and have it served as text/html from this origin — same-origin
  // script against every marketplace session. Only image types are echoed back;
  // anything else is forced to a non-renderable type and marked for download.
  const SAFE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']
  const declared = String((upload as any).content_type || '').toLowerCase().split(';')[0].trim()
  const safeType = SAFE_IMAGE_TYPES.includes(declared) ? declared : 'application/octet-stream'
  const headers: Record<string, string> = {
    'Content-Type': safeType,
    'Cache-Control': 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
    ...(safeType === 'application/octet-stream' ? { 'Content-Disposition': 'attachment' } : {}),
  }

  const data = String((upload as any).data || '')
  if (data.startsWith('r2:')) {
    const obj = c.env.UPLOADS ? await c.env.UPLOADS.get(data.slice(3)) : null
    if (!obj) return c.json({ error: 'File not found' }, 404)
    return new Response(obj.body, { headers })
  }
  if (data.startsWith('data:')) {
    const base64Data = data.split(',')[1] || ''
    const binaryString = atob(base64Data)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    return new Response(bytes, { headers })
  }
  return c.json({ error: 'Invalid file data' }, 500)
})

// ══════════════════════════════════════════
// COMPANY DASHBOARD
// ══════════════════════════════════════════

mp.get('/api/mp/dashboard/stats', async (c) => {
  const company = await getCompanyFromSession(c)
  if (!company) return c.json({ error: 'Login required' }, 401)

  const total = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM mp_listings WHERE company_id = ?').bind(company.id).first()
  const approved = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM mp_listings WHERE company_id = ? AND status = ?').bind(company.id, 'approved').first()
  const pending = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM mp_listings WHERE company_id = ? AND status = ?').bind(company.id, 'pending').first()
  const views = await c.env.DB.prepare('SELECT COALESCE(SUM(view_count), 0) as cnt FROM mp_listings WHERE company_id = ?').bind(company.id).first()
  const inquiries = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM mp_inquiries WHERE listing_id IN (SELECT id FROM mp_listings WHERE company_id = ?)'
  ).bind(company.id).first()
  const avgRating = await c.env.DB.prepare(
    'SELECT ROUND(AVG(rating), 1) as avg FROM mp_reviews WHERE listing_id IN (SELECT id FROM mp_listings WHERE company_id = ?)'
  ).bind(company.id).first()

  return c.json({
    total_listings: (total as any)?.cnt || 0,
    approved: (approved as any)?.cnt || 0,
    pending: (pending as any)?.cnt || 0,
    total_views: (views as any)?.cnt || 0,
    total_inquiries: (inquiries as any)?.cnt || 0,
    avg_rating: (avgRating as any)?.avg || 0
  })
})

mp.get('/api/mp/dashboard/listings', async (c) => {
  const company = await getCompanyFromSession(c)
  if (!company) return c.json({ error: 'Login required' }, 401)

  const listings = await c.env.DB.prepare(`
    SELECT l.*,
      (SELECT COUNT(*) FROM mp_inquiries WHERE listing_id = l.id) as inquiry_count,
      (SELECT ROUND(AVG(rating), 1) FROM mp_reviews WHERE listing_id = l.id) as avg_rating
    FROM mp_listings l WHERE l.company_id = ? ORDER BY l.created_at DESC
  `).bind(company.id).all()

  return c.json({ listings: (listings.results as any[]).map(l => ({ ...l, missing: missingListingInfo(l) })) })
})

mp.get('/api/mp/dashboard/listings/:id', async (c) => {
  const company = await getCompanyFromSession(c)
  if (!company) return c.json({ error: 'Login required' }, 401)

  const id = c.req.param('id')
  const listing = await c.env.DB.prepare('SELECT * FROM mp_listings WHERE id = ? AND company_id = ?')
    .bind(parseInt(id), company.id).first()
  if (!listing) return c.json({ error: 'Listing not found' }, 404)
  return c.json({ listing })
})

// Everything the completeness check asks for has to be fixable here: the edit form
// used to cover twelve text fields and no images, so a listing submitted without a
// logo or product image could never get one.
const DASHBOARD_EDITABLE = ['product_name', 'description', 'target_customer', 'pricing_type', 'pricing_details',
  'tags', 'target_industry', 'ai_category', 'website_url', 'product_url', 'demo_url', 'video_url',
  'use_cases', 'innovation', 'access_info', 'logo_url', 'product_image_url', 'screenshot_urls',
  'sales_contact_name', 'sales_contact_email', 'sales_contact_phone']

mp.put('/api/mp/dashboard/listings/:id', async (c) => {
  const company = await getCompanyFromSession(c) as any
  if (!company) return c.json({ error: 'Login required' }, 401)

  const id = parseInt(c.req.param('id'), 10)
  const listing = await c.env.DB.prepare('SELECT * FROM mp_listings WHERE id = ? AND company_id = ?')
    .bind(id, company.id).first() as any
  if (!listing) return c.json({ error: 'Listing not found' }, 404)

  const body = await c.req.json().catch(() => ({})) as any
  const { values, error } = normalizeListingInput(body, DASHBOARD_EDITABLE)
  if (error) return c.json({ error }, 400)
  if (!(await imagesOwnedBy(c, company.id, values))) return c.json({ error: 'Images must be uploaded through the form' }, 400)

  const changed = Object.keys(values).filter(f => values[f] !== String(listing[f] ?? '').trim())
  if (!changed.length) return c.json({ success: true, changed: false, new_status: listing.status })

  const updates: string[] = []
  const params: any[] = []
  for (const f of changed) { updates.push(`${f} = ?`); params.push(values[f]) }
  if (changed.includes('product_name')) {
    updates.push('product_slug = ?')
    params.push(await uniqueProductSlug(c, listing.company_slug || generateSlug(company.company_name), values.product_name, id))
  }

  // Any edit goes back to review. Only name, description and target customer used
  // to, so an approved listing could swap its website or sales email for anything
  // without a second look - and a rejected listing stayed rejected however it was fixed.
  const newStatus = 'pending'
  updates.push('status = ?')
  params.push(newStatus)
  updates.push('updated_at = CURRENT_TIMESTAMP')
  params.push(id)

  await c.env.DB.prepare(`UPDATE mp_listings SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run()
  if (listing.status !== 'pending') {
    notifyTeamOfSubmission(c, { id, product_name: values.product_name || listing.product_name, company_name: listing.company_name, description: values.description || listing.description, website_url: values.website_url ?? listing.website_url }, company.email, 'updated')
  }
  return c.json({ success: true, changed: true, new_status: newStatus })
})

mp.get('/api/mp/dashboard/inquiries', async (c) => {
  const company = await getCompanyFromSession(c)
  if (!company) return c.json({ error: 'Login required' }, 401)

  const inquiries = await c.env.DB.prepare(`
    SELECT i.*, l.product_name FROM mp_inquiries i
    JOIN mp_listings l ON i.listing_id = l.id
    WHERE l.company_id = ? ORDER BY i.created_at DESC
  `).bind(company.id).all()

  return c.json({ inquiries: inquiries.results })
})

mp.get('/api/mp/dashboard/reviews', async (c) => {
  const company = await getCompanyFromSession(c)
  if (!company) return c.json({ error: 'Login required' }, 401)

  const reviews = await c.env.DB.prepare(`
    SELECT r.*, l.product_name FROM mp_reviews r
    JOIN mp_listings l ON r.listing_id = l.id
    WHERE l.company_id = ? ORDER BY r.created_at DESC
  `).bind(company.id).all()

  return c.json({ reviews: reviews.results })
})

mp.get('/api/mp/dashboard/profile', async (c) => {
  const company = await getCompanyFromSession(c)
  if (!company) return c.json({ error: 'Login required' }, 401)

  // Explicit column list: SELECT * returned password_hash to the browser. It then
  // named five columns (website, description, logo_url, contact_name,
  // contact_phone) that mp_companies has never had, so every call returned 500.
  const profile = await c.env.DB.prepare(
    'SELECT id, company_name, email, role, attendee_id, exhibitor_id, created_at FROM mp_companies WHERE id = ?'
  ).bind(company.id).first()
  return c.json({ profile })
})

mp.put('/api/mp/dashboard/profile', async (c) => {
  const company = await getCompanyFromSession(c) as any
  if (!company) return c.json({ error: 'Login required' }, 401)

  const body = await c.req.json().catch(() => ({})) as any
  const company_name = String(body.company_name || '').trim()
  if (!company_name) return c.json({ error: 'Company name required' }, 400)
  if (company_name.length > 150) return c.json({ error: 'Company name is too long' }, 400)
  if (company_name === company.company_name) return c.json({ success: true })

  await c.env.DB.prepare('UPDATE mp_companies SET company_name = ? WHERE id = ?').bind(company_name, company.id).run()

  // Listings carry the name too. A rename is an identity change, so a live listing
  // goes back to review rather than appearing under a different company unchecked.
  const company_slug = generateSlug(company_name) || 'company'
  const listings = (await c.env.DB.prepare('SELECT id, product_name, status FROM mp_listings WHERE company_id = ?').bind(company.id).all()).results as any[]
  let requeued = 0
  for (const l of listings) {
    const product_slug = await uniqueProductSlug(c, company_slug, l.product_name, l.id)
    await c.env.DB.prepare("UPDATE mp_listings SET company_name = ?, company_slug = ?, product_slug = ?, status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(company_name, company_slug, product_slug, l.id).run()
    if (l.status !== 'pending') requeued++
  }
  if (requeued && listings[0]) {
    notifyTeamOfSubmission(c, { id: listings[0].id, product_name: listings.map(l => l.product_name).join(', '), company_name: `${company_name} (renamed from ${company.company_name})` }, company.email, 'updated')
  }

  return c.json({ success: true, requeued })
})

// ══════════════════════════════════════════
// ADMIN ROUTES
// ══════════════════════════════════════════

mp.get('/api/mp/admin/listings', async (c) => {
  const admin = await marketplaceAdmin(c)
  if (!admin) return c.json({ error: 'Admin required' }, 403)

  const status = c.req.query('status')
  let query = `SELECT l.*, co.email AS account_email, e.company_name AS exhibitor_company, e.booth_number AS exhibitor_booth
    FROM mp_listings l LEFT JOIN mp_companies co ON co.id = l.company_id LEFT JOIN exhibitors e ON e.id = l.exhibitor_id`
  const params: any[] = []
  if (status) {
    query += ' WHERE l.status = ?'
    params.push(status)
  }
  query += ' ORDER BY l.created_at DESC'

  const listings = await c.env.DB.prepare(query).bind(...params).all()
  return c.json({ listings: (listings.results as any[]).map(l => ({ ...l, missing: missingListingInfo(l) })) })
})

// Email a company what its listing is missing. Admin-triggered, at most once a day
// per listing, and recorded in admin_audit with whether the mail service took it.
mp.post('/api/mp/admin/listings/:id/remind', async (c) => {
  const admin = await marketplaceAdmin(c)
  if (!admin) return c.json({ error: 'Admin required' }, 403)

  const id = parseInt(c.req.param('id'), 10)
  const row = await c.env.DB.prepare('SELECT l.*, co.email AS account_email FROM mp_listings l JOIN mp_companies co ON co.id = l.company_id WHERE l.id = ?')
    .bind(id).first() as any
  if (!row) return c.json({ error: 'Listing not found' }, 404)
  if (!row.account_email) return c.json({ error: 'This listing has no company account to email' }, 400)
  const missing = missingListingInfo(row)
  if (!missing.length) return c.json({ error: 'Nothing is missing from this listing' }, 400)

  const recent = await c.env.DB.prepare(
    "SELECT created_at FROM admin_audit WHERE action = 'marketplace.listing-reminded' AND entity = 'mp_listing' AND entity_id = ? AND created_at > datetime('now', '-1 day') ORDER BY id DESC LIMIT 1"
  ).bind(String(id)).first().catch(() => null) as any
  if (recent) return c.json({ error: `A reminder was already sent for this listing at ${recent.created_at} UTC. Try again tomorrow.` }, 429)

  const sent = await sendCompletionReminder(c, row, missing)
  // Only a delivered reminder counts toward the once-a-day limit.
  await auditAdmin(c, admin, sent ? 'marketplace.listing-reminded' : 'marketplace.listing-remind-failed', id, { missing })
  if (!sent) return c.json({ error: 'The email service did not accept the reminder. Check the Elastic Email settings.' }, 502)
  return c.json({ success: true, missing })
})

// For linking a listing to a booth by hand when the emails don't match.
mp.get('/api/mp/admin/exhibitors', async (c) => {
  const admin = await marketplaceAdmin(c)
  if (!admin) return c.json({ error: 'Admin required' }, 403)
  const rows = await c.env.DB.prepare('SELECT id, company_name, booth_number FROM exhibitors ORDER BY company_name COLLATE NOCASE').all().catch(() => ({ results: [] }))
  return c.json({ exhibitors: rows.results })
})

// ══════════════════════════════════════════
// EXHIBITOR INVITATIONS
// ══════════════════════════════════════════
// A booth includes a free listing and nothing ever said so: every listing on the
// marketplace came from a company that found it by itself, and not one exhibitor is
// among them. Admin sends these; nothing goes out on a schedule, an exhibitor is
// asked at most once a week, and whoever has unsubscribed is skipped even though
// this is about a service they have paid for.
const INVITE_SENT = 'marketplace.exhibitor-invited'
const INVITE_FAILED = 'marketplace.exhibitor-invite-failed'
const INVITE_COOLDOWN_DAYS = 7
// The shorter follow-up: "your account is ready, click to sign in". For exhibitors
// invited before accounts were made for them, and for anyone who has not got in.
const LINK_SENT = 'marketplace.exhibitor-link-sent'
const LINK_FAILED = 'marketplace.exhibitor-link-failed'

// exhibitors.description holds internal import notes ("Owner: <staff name>"), so it
// is never selected here and must never reach a page or an email.
const INVITE_ROWS_SQL = (withUnsub: boolean) => `
  SELECT e.id, e.company_name, e.booth_number, e.contact_email, co.id AS account_id,
    (co.password_hash IS NOT NULL AND co.password_hash <> '') AS account_claimed,
    (SELECT COUNT(*) FROM mp_listings l WHERE l.exhibitor_id = e.id OR (co.id IS NOT NULL AND l.company_id = co.id)) AS listing_count,
    (SELECT COUNT(*) FROM mp_listings l WHERE (l.exhibitor_id = e.id OR (co.id IS NOT NULL AND l.company_id = co.id)) AND l.status = 'approved') AS live_count,
    (SELECT MAX(created_at) FROM admin_audit a WHERE a.action = '${INVITE_SENT}' AND a.entity = 'exhibitor' AND a.entity_id = CAST(e.id AS TEXT)) AS last_invited,
    (SELECT MAX(created_at) FROM admin_audit a WHERE a.action = '${LINK_SENT}' AND a.entity = 'exhibitor' AND a.entity_id = CAST(e.id AS TEXT)) AS last_link,
    ${withUnsub ? `(SELECT COUNT(*) FROM attendees t WHERE t.unsubscribed_at IS NOT NULL AND lower(trim(t.email)) = lower(trim(e.contact_email))) AS unsubscribed` : '0 AS unsubscribed'}
  FROM exhibitors e
  LEFT JOIN mp_companies co ON trim(ifnull(e.contact_email, '')) <> '' AND lower(trim(co.email)) = lower(trim(e.contact_email))
  ORDER BY e.company_name COLLATE NOCASE`

// The state says how far this exhibitor has got, so an invitation sent last week
// does not hide the fact that they have since registered. Whether the button is
// offered is a separate question, answered by can_invite. "Registered" means they
// set a password: every invited exhibitor has an account made for them, so the
// account's existence says nothing about whether they have done anything.
const daysSince = (stamp: any): number | null => stamp ? (Date.now() - Date.parse(String(stamp).replace(' ', 'T') + 'Z')) / 86400000 : null

const inviteState = (r: any) => {
  const email = String(r.contact_email || '').trim()
  const days = daysSince(r.last_invited)
  const linkDays = daysSince(r.last_link)
  const state = r.live_count ? 'live'
    : r.listing_count ? 'pending'
    : !email ? 'no-email'
    : r.unsubscribed ? 'unsubscribed'
    : r.account_claimed ? 'registered'
    : days !== null ? 'invited'
    : 'new'
  // What blocks BOTH mails, then what blocks each on its own.
  const block = !email ? 'No email address on file' : r.unsubscribed ? 'This address has unsubscribed' : r.live_count ? 'Already listing' : ''
  let reason = block, link_reason = block
  if (!block && days !== null && days < INVITE_COOLDOWN_DAYS) {
    const d = Math.floor(days)
    reason = d === 0 ? 'Invited today' : d === 1 ? 'Invited yesterday' : `Invited ${d} days ago`
  }
  if (!block && linkDays !== null && linkDays < 1) link_reason = 'Sign-in link sent today'
  return { state, can_invite: !reason, reason, can_link: !link_reason, link_reason }
}

const exhibitorInviteRows = async (c: any) => {
  // attendees carries the unsubscribe flag; if that table is ever out of reach the
  // list still loads, and the send path checks again before mailing anyone.
  let rows: any[] = []
  try { rows = ((await c.env.DB.prepare(INVITE_ROWS_SQL(true)).all()).results || []) as any[] }
  catch { rows = ((await c.env.DB.prepare(INVITE_ROWS_SQL(false)).all().catch(() => ({ results: [] }))).results || []) as any[] }
  return rows.map(r => ({ ...r, ...inviteState(r) }))
}

// Every exhibitor is also a delegate. The pass is made, or a Visitor Pass raised, as
// the email goes out, so an email only ever mentions a pass that exists.
const exhibitorDelegate = async (c: any, row: any) => {
  try { return (await hooks.ensureDelegate?.(c, { exhibitorId: Number(row.id), email: String(row.contact_email || ''), company: String(row.company_name || '') })) || null }
  catch { return null }
}
const delegateHowTo = (c: any) =>
  `open <a href="${htmlEsc(siteOrigin(c) + '/app')}" style="color:#FF6B00">bharataiinnovation.com/app</a> and sign in with this email address. We email you a code, so there is nothing to register.`

const sendExhibitorInvite = async (c: any, row: any): Promise<boolean> => {
  const booth = String(row.booth_number || '').trim()
  // The account is made here, so the button signs them in. If that fails for any
  // reason the button falls back to the listing form, where the same email still works.
  let accountId: number | null = null
  try { accountId = await ensureExhibitorAccount(c, { id: Number(row.id), company_name: row.company_name, contact_email: row.contact_email }) } catch { accountId = null }
  const href = accountId ? await signInLink(c, accountId) : siteOrigin(c) + '/marketplace?submit=true'
  const stage = accountId ? await stageSlotOf(c, Number(row.id)) : null
  const delegate = await exhibitorDelegate(c, row)
  const body = `<p style="margin:0 0 12px;font-size:14px;line-height:1.6">You are exhibiting at Bharat AI Innovation 2026 (20-21 November, World Trade Center, Mumbai), and your booth includes a free listing on the event's AI Marketplace, where buyers browse AI products before and during the show.</p>
    <p style="margin:0 0 12px;font-size:14px;line-height:1.6">Your listing is public on bharataiinnovation.com and in the event app attendees use to plan who to meet, and it stays online after the show.</p>
    <p style="margin:0 0 12px;font-size:14px;line-height:1.6">It takes about five minutes: the button below signs you in &mdash; no password needed &mdash; then describe your product and add a logo and an image. We review every listing and email you as soon as it is live.</p>
    <p style="margin:0;font-size:14px;line-height:1.6">${accountId
      ? `Your account is under this email address${booth ? `, with Booth ${htmlEsc(booth)} already on it` : ''}, so visitors can find you at the venue.`
      : `Please register with this email address &mdash; your booth number${booth ? ` (Booth ${htmlEsc(booth)})` : ''} is then added to your listing automatically, so visitors can find you at the venue.`}</p>
    ${stage ? `<p style="margin:12px 0 0;font-size:14px;line-height:1.6">Your booth also includes ${stageSlotPhrase(stage.minutes)}. In the same dashboard, add your talk topic, what you will showcase, and your speaker's name, photo and a short bio. Your time on stage shows there once the programme is set.</p>` : ''}
    ${delegate ? `<p style="margin:12px 0 0;font-size:14px;line-height:1.6">Your exhibitor pass is also a delegate pass for the event app, where you can meet and message attendees: ${delegateHowTo(c)}</p>` : ''}
    ${emailButton(href, stage ? 'Sign in to your exhibitor dashboard' : accountId ? 'Sign in and list your product' : 'List your AI product')}
    <p style="margin:16px 0 0;font-size:12px;color:#888">${accountId ? 'The button works for seven days. After that, choose "Email me a sign-in link" on bharataiinnovation.com/marketplace and a fresh one is sent to this address. ' : ''}If you would rather not receive marketplace emails, reply to this message and we will stop.</p>`
  return sendMail(c, 'exhibitor-invite', String(row.contact_email).trim(), 'Your booth includes a free AI Marketplace listing', emailShell('Your free AI Marketplace listing', body))
}

const sendExhibitorSignInMail = async (c: any, row: any): Promise<boolean> => {
  const accountId = await ensureExhibitorAccount(c, { id: Number(row.id), company_name: row.company_name, contact_email: row.contact_email })
  if (!accountId) return false
  const booth = String(row.booth_number || '').trim()
  const stage = await stageSlotOf(c, Number(row.id))
  const delegate = await exhibitorDelegate(c, row)
  const li = (html: string) => `<li style="margin:0 0 8px">${html}</li>`
  // Everything the booth includes, in one list. The listing and the talk are in the
  // dashboard the button opens; the delegate pass is in the event app.
  const includes = [
    li('<strong>A free AI Marketplace listing.</strong> Describe your product; it takes about five minutes.'),
    ...(stage ? [li(`<strong>${stage.minutes ? `A ${stage.minutes}-minute` : 'An'} Innovation Talk &amp; Showcase slot.</strong> Add your stage talk: the topic, what you will showcase, and your speaker's name, photo and a short bio.`)] : []),
    ...(delegate ? [li(`<strong>A delegate pass for the event app</strong>, to meet and message attendees: ${delegateHowTo(c)}`)] : []),
  ]
  const body = includes.length > 1
    ? `<p style="margin:0 0 12px;font-size:14px;line-height:1.6">You do not need to create an account: your exhibitor account is ready under this email address${booth ? `, with Booth ${htmlEsc(booth)} already on it` : ''}. Your booth includes:</p>
    <ul style="margin:0;padding-left:20px;font-size:14px;line-height:1.6">${includes.join('')}</ul>
    <p style="margin:4px 0 0;font-size:14px;line-height:1.6">The button signs you in to your exhibitor dashboard, where you list your product${stage ? ' and add your stage talk' : ''}. No password needed.</p>
    ${emailButton(await signInLink(c, accountId), 'Sign in to your exhibitor dashboard')}`
    : `<p style="margin:0 0 12px;font-size:14px;line-height:1.6">You do not need to create an account for the Bharat AI Marketplace: one is ready under this email address${booth ? `, with Booth ${htmlEsc(booth)} already on it` : ''}.</p>
    <p style="margin:0;font-size:14px;line-height:1.6">Click the button to sign in &mdash; no password needed &mdash; and list your AI product. It takes about five minutes, and we email you as soon as the listing is live.</p>
    ${emailButton(await signInLink(c, accountId), 'Sign in and list your product')}`
  const footer = `<p style="margin:16px 0 0;font-size:12px;color:#888">The button works for seven days. After that, choose "Email me a sign-in link" on bharataiinnovation.com/marketplace and a fresh one is sent to this address. If you would rather not receive marketplace emails, reply to this message and we will stop.</p>`
  return sendMail(c, 'exhibitor-signin', String(row.contact_email).trim(), includes.length > 1 ? 'Your exhibitor account is ready' : 'Your AI Marketplace account is ready', emailShell('Your account is ready', body + footer))
}

mp.get('/api/mp/admin/exhibitor-invites', async (c) => {
  const admin = await marketplaceAdmin(c)
  if (!admin) return c.json({ error: 'Admin required' }, 403)
  const exhibitors = await exhibitorInviteRows(c)
  return c.json({
    exhibitors,
    summary: {
      total: exhibitors.length,
      can_invite: exhibitors.filter(e => e.can_invite).length,
      can_link: exhibitors.filter(e => e.can_link).length,
      no_email: exhibitors.filter(e => e.state === 'no-email').length,
      live: exhibitors.filter(e => e.state === 'live').length,
    },
  })
})

mp.post('/api/mp/admin/exhibitors/:id/signin-link', async (c) => {
  const admin = await marketplaceAdmin(c)
  if (!admin) return c.json({ error: 'Admin required' }, 403)
  const id = parseInt(c.req.param('id'), 10)
  const row = (await exhibitorInviteRows(c)).find(r => Number(r.id) === id)
  if (!row) return c.json({ error: 'Exhibitor not found' }, 404)
  if (!row.can_link) return c.json({ error: row.link_reason || 'A sign-in link cannot be sent to this exhibitor' }, 409)
  const sent = await sendExhibitorSignInMail(c, row)
  await auditAdmin(c, admin, sent ? LINK_SENT : LINK_FAILED, id, { company: row.company_name, booth: row.booth_number || null }, 'exhibitor')
  if (!sent) return c.json({ error: 'The email service did not accept the message. Check the Elastic Email settings.' }, 502)
  return c.json({ success: true, company: row.company_name })
})

const inviteOne = async (c: any, admin: MarketplaceAdmin, row: any) => {
  if (!row.can_invite) return { status: 409, body: { error: row.reason || 'This exhibitor cannot be invited' } }
  const sent = await sendExhibitorInvite(c, row)
  await auditAdmin(c, admin, sent ? INVITE_SENT : INVITE_FAILED, row.id, { company: row.company_name, booth: row.booth_number || null }, 'exhibitor')
  if (!sent) return { status: 502, body: { error: 'The email service did not accept the invitation. Check the Elastic Email settings.' } }
  return { status: 200, body: { success: true, company: row.company_name } }
}

mp.post('/api/mp/admin/exhibitors/:id/invite', async (c) => {
  const admin = await marketplaceAdmin(c)
  if (!admin) return c.json({ error: 'Admin required' }, 403)
  const id = parseInt(c.req.param('id'), 10)
  const row = (await exhibitorInviteRows(c)).find(r => Number(r.id) === id)
  if (!row) return c.json({ error: 'Exhibitor not found' }, 404)
  const r = await inviteOne(c, admin, row)
  return c.json(r.body, r.status as any)
})

// There is deliberately no send-everyone route. The admin page sends one invitation
// per request with a gap between them, as the panel sender on /admin does: a burst
// of identical mail to the same domains lands in spam.

// ══════════════════════════════════════════
// STAGE TALKS (Innovation Talk & Showcase)
// ══════════════════════════════════════════
// Every booth package includes a slot on stage. The exhibitor fills in the talk and
// the speaker from the dashboard; the organisers give it a day and a time from the
// admin page. The rows are innovation_talks rows with an exhibitor_id (migration
// 0044), which is the programme the /admin Innovation Talks tab edits and the event
// app shows: an exhibitor's talk appears there once it has a time, a topic and a speaker.

// Minutes on stage per package, as the exhibition page sells them. The keys are the
// floor plan's legacy type_key, so 'accelerator' is the Enterprise Booth and
// 'standard' the Accelerator Booth. The Premium Booth is not on that page, so it has
// no length until the organisers set one.
const STAGE_MINUTES: Record<string, number> = { pod: 8, explorer: 10, innovator: 12, accelerator: 15, standard: 20, enterprise: 30, mega: 40 }
const STAGE_DAYS = [{ date: '2026-11-20', label: 'Fri 20 Nov' }, { date: '2026-11-21', label: 'Sat 21 Nov' }]
const STAGE_FIELDS: Record<string, { label: string; max: number }> = {
  topic: { label: 'Talk topic', max: 150 },
  showcase: { label: 'What you will showcase', max: 1000 },
  speaker_name: { label: 'Speaker name', max: 120 },
  speaker_title: { label: 'Designation', max: 120 },
  speaker_bio: { label: 'Short bio', max: 800 },
}
const STAGE_COLS = 'id, event_id, exhibitor_id, company, topic, showcase, speaker_name, speaker_title, speaker_bio, speaker_photo_url, duration_min, starts_at, time_slot, details_updated_at'
const STAGE_SCHEDULED = 'marketplace.stage-talk-scheduled'
const STAGE_CLEARED = 'marketplace.stage-talk-cleared'

// Until 0044 has run, the feature is simply absent: no dashboard card, no admin list.
const stageReady = async (c: any): Promise<boolean> => {
  try { await c.env.DB.prepare(`SELECT ${STAGE_COLS} FROM innovation_talks LIMIT 0`).all(); return true } catch { return false }
}

// The confirmed stands behind each exhibitor, and the one slot they add up to: the
// longest their packages include. A held stand is not a sale, so it earns no slot.
type StageStands = { event_id: number; booths: string[]; packages: string[]; minutes: number | null }
const confirmedStands = async (c: any, exhibitorId?: number): Promise<Map<number, StageStands>> => {
  const st = c.env.DB.prepare(`SELECT ba.exhibitor_id, ba.event_id, b.code, b.type_key, b.name
    FROM booth_allocations ba JOIN booths b ON b.id = ba.booth_id
    WHERE ba.status = 'confirmed' AND ba.released_at IS NULL AND ba.exhibitor_id IS NOT NULL${exhibitorId ? ' AND ba.exhibitor_id = ?' : ''}
    ORDER BY CAST(b.code AS INTEGER), b.code`)
  let rows: any[] = []
  try { rows = ((await (exhibitorId ? st.bind(exhibitorId) : st).all()).results || []) as any[] } catch { rows = [] }
  const by = new Map<number, StageStands>()
  for (const r of rows) {
    const id = Number(r.exhibitor_id)
    const s = by.get(id) || { event_id: Number(r.event_id) || 1, booths: [], packages: [], minutes: null }
    s.booths.push(String(r.code))
    if (r.name && !s.packages.includes(r.name)) s.packages.push(r.name)
    const m = STAGE_MINUTES[r.type_key]
    if (m && (s.minutes === null || m > s.minutes)) s.minutes = m
    by.set(id, s)
  }
  return by
}

// For the exhibitor emails: whether there is a slot to mention, and how long it is.
const stageSlotOf = async (c: any, exhibitorId: number): Promise<{ minutes: number | null } | null> => {
  if (!(await stageReady(c))) return null
  const s = (await confirmedStands(c, exhibitorId)).get(exhibitorId)
  if (!s) return null
  const talk = await c.env.DB.prepare('SELECT duration_min FROM innovation_talks WHERE exhibitor_id = ? LIMIT 1').bind(exhibitorId).first().catch(() => null) as any
  return { minutes: Number(talk?.duration_min) || s.minutes }
}
const stageSlotPhrase = (minutes: number | null) =>
  minutes ? `a ${minutes}-minute Innovation Talk &amp; Showcase slot` : 'an Innovation Talk &amp; Showcase slot'

// "Fri 20 Nov · 10:00 – 10:08 AM", the shape the programme's time column already uses.
const stageMinuteOfDay = (startsAt: string) => { const [h, m] = String(startsAt).split(' ')[1].split(':').map(Number); return h * 60 + m }
const stageClock = (mins: number) => {
  const h = Math.floor(mins / 60) % 24, m = mins % 60
  return { text: `${h % 12 || 12}:${String(m).padStart(2, '0')}`, pm: h >= 12 }
}
const stageSlotLabel = (startsAt: string, minutes: number) => {
  const start = stageMinuteOfDay(startsAt)
  const a = stageClock(start), b = stageClock(start + (minutes || 0))
  const date = String(startsAt).slice(0, 10)
  const day = STAGE_DAYS.find(d => d.date === date)?.label || date
  return `${day} · ${a.pm === b.pm ? a.text : `${a.text} ${a.pm ? 'PM' : 'AM'}`} – ${b.text} ${b.pm ? 'PM' : 'AM'}`
}

const stageDetailsInput = (body: any): { values: Record<string, string>; error?: string } => {
  const values: Record<string, string> = {}
  for (const [f, { label, max }] of Object.entries(STAGE_FIELDS)) {
    if (body[f] === undefined) continue
    const v = String(body[f] ?? '').trim()
    if (v.length > max) return { values, error: `${label} is too long (max ${max} characters)` }
    values[f] = v
  }
  if (body.speaker_photo_url !== undefined) {
    const v = String(body.speaker_photo_url ?? '').trim()
    if (v && !UPLOAD_URL_RE.test(v)) return { values, error: 'The speaker photo must be uploaded through the form' }
    values.speaker_photo_url = v
  }
  return { values }
}

const stageTalkOf = (c: any, exhibitorId: number): Promise<any> =>
  c.env.DB.prepare(`SELECT ${STAGE_COLS} FROM innovation_talks WHERE exhibitor_id = ? ORDER BY id LIMIT 1`).bind(exhibitorId).first()

// Made by whichever comes first, the exhibitor's details or the organisers' time.
const ensureStageTalk = async (c: any, exhibitor: { id: number; company_name: string }, stands?: StageStands): Promise<any> => {
  const existing = await stageTalkOf(c, exhibitor.id)
  if (existing) return existing
  try {
    await c.env.DB.prepare("INSERT INTO innovation_talks (event_id, exhibitor_id, company, speaker_name, topic, duration_min) VALUES (?, ?, ?, '', '', ?)")
      .bind(stands?.event_id || 1, exhibitor.id, String(exhibitor.company_name || '').trim(), stands?.minutes ?? null).run()
  } catch { /* two saves in the same instant: the unique index kept one row, read it back */ }
  return stageTalkOf(c, exhibitor.id)
}

// Slot numbers follow the clock, so the programme's order and its numbering agree.
const renumberStageTalks = async (c: any, eventId: number) => {
  const rows = ((await c.env.DB.prepare('SELECT id FROM innovation_talks WHERE event_id = ? AND exhibitor_id IS NOT NULL AND starts_at IS NOT NULL ORDER BY starts_at, id')
    .bind(eventId).all()).results || []) as any[]
  for (let i = 0; i < rows.length; i++) await c.env.DB.prepare('UPDATE innovation_talks SET slot_no = ? WHERE id = ?').bind(i + 1, rows[i].id).run()
}

// Two talks on one day whose times overlap. Warned about, not refused: swapping two
// talks passes through an overlap.
const stageClashes = (talks: any[]) => {
  const timed = talks.filter(t => t.starts_at && Number(t.duration_min) > 0)
  const out = new Map<number, string[]>()
  for (const a of timed) for (const b of timed) {
    if (a === b || String(a.starts_at).slice(0, 10) !== String(b.starts_at).slice(0, 10)) continue
    const a0 = stageMinuteOfDay(a.starts_at), b0 = stageMinuteOfDay(b.starts_at)
    if (a0 < b0 + Number(b.duration_min) && b0 < a0 + Number(a.duration_min)) {
      out.set(Number(a.exhibitor_id), [...(out.get(Number(a.exhibitor_id)) || []), String(b.company || 'another talk')])
    }
  }
  return out
}

const stageSummary = (t: any, fallbackMinutes: number | null) => {
  const minutes = Number(t.duration_min) || fallbackMinutes || null
  return {
    minutes,
    topic: t.topic || '', showcase: t.showcase || '', speaker_name: t.speaker_name || '', speaker_title: t.speaker_title || '',
    speaker_bio: t.speaker_bio || '', speaker_photo_url: t.speaker_photo_url || '', details_updated_at: t.details_updated_at || null,
    starts_at: t.starts_at || null,
    // time_slot is what the programme shows, and the /admin tab can edit it.
    slot: t.starts_at ? (t.time_slot || stageSlotLabel(t.starts_at, minutes || 0)) : null,
    details_complete: !!(t.topic && t.speaker_name),
    in_programme: !!(t.starts_at && t.topic && t.speaker_name),
  }
}

// The exhibitor behind a signed-in account and its stands, or null when the account
// has no slot: not an exhibitor, no confirmed stand, or 0044 not yet run.
const dashboardStage = async (c: any, company: any) => {
  if (!(await stageReady(c))) return null
  const exhibitor = await resolveExhibitor(c, company)
  if (!exhibitor) return null
  const stands = (await confirmedStands(c, Number(exhibitor.id))).get(Number(exhibitor.id))
  return stands ? { exhibitor: { id: Number(exhibitor.id), company_name: String(exhibitor.company_name || '') }, stands } : null
}

// The event-app pass on this account's email. Anything but the free Visitor Pass may
// start conversations (canInitiateNetworking in index.tsx), so that is what counts.
const delegatePassOf = async (c: any, email: string, eventId: number) => {
  const a = await c.env.DB.prepare('SELECT badge_type, last_login_at FROM attendees WHERE event_id = ? AND lower(email) = lower(?) ORDER BY id LIMIT 1')
    .bind(eventId, String(email || '').trim()).first().catch(() => null) as any
  return a && !/visitor/i.test(String(a.badge_type || '')) ? { email: String(email).trim().toLowerCase(), signed_in: !!a.last_login_at } : null
}

const dashboardStageJson = async (c: any, company: any, s: NonNullable<Awaited<ReturnType<typeof dashboardStage>>>) => ({
  eligible: true, booths: s.stands.booths, packages: s.stands.packages,
  ...stageSummary((await stageTalkOf(c, s.exhibitor.id)) || {}, s.stands.minutes),
  delegate: await delegatePassOf(c, company.email, s.stands.event_id),
})

mp.get('/api/mp/dashboard/stage-talk', async (c) => {
  const company = await getCompanyFromSession(c)
  if (!company) return c.json({ error: 'Login required' }, 401)
  const s = await dashboardStage(c, company)
  if (!s) return c.json({ eligible: false })
  return c.json(await dashboardStageJson(c, company, s))
})

// Saved as typed and shown in the event app as soon as the talk has a time: these are
// paying exhibitors describing their own talk, and the organisers can still correct
// it from the /admin Innovation Talks tab.
mp.put('/api/mp/dashboard/stage-talk', async (c) => {
  const company = await getCompanyFromSession(c) as any
  if (!company) return c.json({ error: 'Login required' }, 401)
  const { values, error } = stageDetailsInput((await c.req.json().catch(() => ({}))) || {})
  if (error) return c.json({ error }, 400)
  const fields = Object.keys(values)
  if (!fields.length) return c.json({ error: 'Nothing to save' }, 400)
  const s = await dashboardStage(c, company)
  if (!s) return c.json({ error: 'Stage talks come with a confirmed exhibition stand' }, 403)
  if (!(await uploadsOwnedBy(c, company.id, [values.speaker_photo_url]))) return c.json({ error: 'The speaker photo must be uploaded through the form' }, 400)
  const talk = await ensureStageTalk(c, s.exhibitor, s.stands)
  await c.env.DB.prepare(`UPDATE innovation_talks SET ${fields.map(f => `${f} = ?`).join(', ')}, details_updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(...fields.map(f => values[f]), talk.id).run()
  return c.json({ success: true, ...(await dashboardStageJson(c, company, s)) })
})

mp.get('/api/mp/admin/stage-talks', async (c) => {
  const admin = await marketplaceAdmin(c)
  if (!admin) return c.json({ error: 'Admin required' }, 403)
  if (!(await stageReady(c))) return c.json({ ready: false, days: STAGE_DAYS, talks: [] })
  const stands = await confirmedStands(c)
  const talks = ((await c.env.DB.prepare(`SELECT ${STAGE_COLS} FROM innovation_talks WHERE exhibitor_id IS NOT NULL`).all()).results || []) as any[]
  const talkOf = new Map(talks.map(t => [Number(t.exhibitor_id), t]))
  const clashes = stageClashes(talks)
  // Never exhibitors.description: it holds internal import notes.
  const exhibitors = ((await c.env.DB.prepare('SELECT id, company_name, contact_email FROM exhibitors').all()).results || []) as any[]
  const rows = exhibitors.filter(e => stands.has(Number(e.id)) || talkOf.has(Number(e.id))).map(e => {
    const id = Number(e.id), s = stands.get(id)
    return {
      exhibitor_id: id, company_name: e.company_name, contact_email: e.contact_email || '',
      booths: s?.booths || [], packages: s?.packages || [], has_stand: !!s, package_minutes: s?.minutes ?? null,
      ...stageSummary(talkOf.get(id) || {}, s?.minutes ?? null),
      clashes: clashes.get(id) || [],
    }
  })
  // The programme in time order, then everyone still without a time, A to Z.
  rows.sort((a, b) => (a.starts_at ? 0 : 1) - (b.starts_at ? 0 : 1)
    || String(a.starts_at || '').localeCompare(String(b.starts_at || ''))
    || String(a.company_name).localeCompare(String(b.company_name)))
  return c.json({
    ready: true, days: STAGE_DAYS, talks: rows,
    summary: {
      exhibitors: rows.filter(r => r.has_stand).length,
      with_details: rows.filter(r => r.details_complete).length,
      scheduled: rows.filter(r => r.starts_at).length,
      in_programme: rows.filter(r => r.in_programme).length,
    },
  })
})

// Sets or clears one exhibitor's time: { date, time, minutes } or { clear: true }.
mp.patch('/api/mp/admin/stage-talks/:exhibitorId', async (c) => {
  const admin = await marketplaceAdmin(c)
  if (!admin) return c.json({ error: 'Admin required' }, 403)
  if (!(await stageReady(c))) return c.json({ error: 'Stage talks need migration 0044 on the database first' }, 503)
  const id = parseInt(c.req.param('exhibitorId'), 10)
  const exhibitor = await c.env.DB.prepare('SELECT id, company_name FROM exhibitors WHERE id = ?').bind(id).first() as any
  if (!exhibitor) return c.json({ error: 'Exhibitor not found' }, 404)
  const body = ((await c.req.json().catch(() => ({}))) || {}) as any

  if (body.clear) {
    const talk = await stageTalkOf(c, id)
    if (talk?.starts_at) {
      await c.env.DB.prepare('UPDATE innovation_talks SET starts_at = NULL, time_slot = NULL, slot_no = NULL WHERE id = ?').bind(talk.id).run()
      await renumberStageTalks(c, Number(talk.event_id) || 1)
      await auditAdmin(c, admin, STAGE_CLEARED, id, { company: exhibitor.company_name, was: talk.time_slot || talk.starts_at }, 'exhibitor')
    }
    return c.json({ success: true })
  }

  const date = String(body.date || ''), time = String(body.time || ''), minutes = Number(body.minutes)
  if (!STAGE_DAYS.some(d => d.date === date)) return c.json({ error: 'Choose one of the event days' }, 400)
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return c.json({ error: 'The start time must look like 10:30' }, 400)
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) return c.json({ error: 'The length must be between 1 and 120 minutes' }, 400)
  const stands = (await confirmedStands(c, id)).get(id)
  if (!stands && !(await stageTalkOf(c, id))) return c.json({ error: 'This exhibitor has no confirmed stand' }, 409)

  const talk = await ensureStageTalk(c, { id, company_name: exhibitor.company_name }, stands)
  const startsAt = `${date} ${time}`
  const slot = stageSlotLabel(startsAt, minutes)
  await c.env.DB.prepare('UPDATE innovation_talks SET starts_at = ?, duration_min = ?, time_slot = ?, session_type = ? WHERE id = ?')
    .bind(startsAt, minutes, slot, stageMinuteOfDay(startsAt) < 13 * 60 ? 'Morning' : 'Afternoon', talk.id).run()
  await renumberStageTalks(c, Number(talk.event_id) || 1)
  await auditAdmin(c, admin, STAGE_SCHEDULED, id, { company: exhibitor.company_name, slot }, 'exhibitor')
  const all = ((await c.env.DB.prepare(`SELECT ${STAGE_COLS} FROM innovation_talks WHERE exhibitor_id IS NOT NULL`).all()).results || []) as any[]
  return c.json({ success: true, slot, clashes: stageClashes(all).get(id) || [] })
})

mp.patch('/api/mp/admin/listings/:id', async (c) => {
  const admin = await marketplaceAdmin(c)
  if (!admin) return c.json({ error: 'Admin required' }, 403)

  const id = parseInt(c.req.param('id'), 10)
  const body = await c.req.json().catch(() => ({})) as any
  const listing = await c.env.DB.prepare('SELECT l.id, l.status, l.exhibitor_id, co.id AS company_id, co.email, co.exhibitor_id AS company_exhibitor_id FROM mp_listings l LEFT JOIN mp_companies co ON co.id = l.company_id WHERE l.id = ?')
    .bind(id).first() as any
  if (!listing) return c.json({ error: 'Listing not found' }, 404)

  if (body.exhibitor_id !== undefined) {
    const exId = body.exhibitor_id === null || body.exhibitor_id === '' ? null : parseInt(body.exhibitor_id, 10)
    let booth: string | null = null
    if (exId !== null) {
      const ex = await c.env.DB.prepare('SELECT id, booth_number FROM exhibitors WHERE id = ?').bind(exId).first() as any
      if (!ex) return c.json({ error: 'Exhibitor not found' }, 400)
      booth = ex.booth_number || null
    }
    await c.env.DB.prepare('UPDATE mp_listings SET exhibitor_id = ?, booth_number = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(exId, booth, id).run()
    if (listing.company_id) await c.env.DB.prepare('UPDATE mp_companies SET exhibitor_id = ? WHERE id = ?').bind(exId, listing.company_id).run()
    await auditAdmin(c, admin, 'marketplace.listing-exhibitor', id, { exhibitor_id: exId, booth })
  }

  if (body.status !== undefined) {
    const status = body.status
    if (!['approved', 'rejected', 'pending'].includes(status)) return c.json({ error: 'Invalid status' }, 400)
    // An exhibitor who registered after submitting gets their booth on approval.
    if (status === 'approved' && !listing.exhibitor_id && body.exhibitor_id === undefined && listing.email) {
      const match = await findExhibitorByEmail(c, listing.email)
      if (match) {
        await c.env.DB.prepare('UPDATE mp_listings SET exhibitor_id = ?, booth_number = ? WHERE id = ?').bind(match.id, match.booth_number || null, id).run()
        await c.env.DB.prepare('UPDATE mp_companies SET exhibitor_id = ? WHERE id = ?').bind(match.id, listing.company_id).run()
      }
    }
    await c.env.DB.prepare('UPDATE mp_listings SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(status, id).run()
    const reason = String(body.reason || '').trim().slice(0, 2000)
    if (status !== listing.status) {
      await auditAdmin(c, admin, 'marketplace.listing-' + status, id, { from: listing.status, reason: reason || undefined })
    }
    if (status !== listing.status && (status === 'approved' || status === 'rejected')) {
      notifyCompanyOfDecision(c, admin, id, status, reason)
    }
  }

  return c.json({ success: true })
})

mp.get('/api/mp/admin/inquiries', async (c) => {
  const admin = await marketplaceAdmin(c)
  if (!admin) return c.json({ error: 'Admin required' }, 403)

  const inquiries = await c.env.DB.prepare(`
    SELECT i.*, l.product_name, l.company_name FROM mp_inquiries i
    JOIN mp_listings l ON i.listing_id = l.id ORDER BY i.created_at DESC
  `).all()

  return c.json({ inquiries: inquiries.results })
})

mp.delete('/api/mp/admin/inquiries/:id', async (c) => {
  const admin = await marketplaceAdmin(c)
  if (!admin) return c.json({ error: 'Admin required' }, 403)

  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM mp_inquiries WHERE id = ?').bind(parseInt(id)).run()
  await auditAdmin(c, admin, 'marketplace.inquiry-delete', id)
  return c.json({ success: true })
})

mp.get('/api/mp/admin/stats', async (c) => {
  const admin = await marketplaceAdmin(c)
  if (!admin) return c.json({ error: 'Admin required' }, 403)

  const total = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM mp_listings').first()
  const approved = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM mp_listings WHERE status = ?').bind('approved').first()
  const pending = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM mp_listings WHERE status = ?').bind('pending').first()
  const rejected = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM mp_listings WHERE status = ?').bind('rejected').first()
  const companies = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM mp_companies WHERE role != ?').bind('admin').first()
  const inquiries = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM mp_inquiries').first()
  const views = await c.env.DB.prepare('SELECT COALESCE(SUM(view_count), 0) as cnt FROM mp_listings').first()

  return c.json({
    total_listings: (total as any)?.cnt || 0,
    approved: (approved as any)?.cnt || 0,
    pending: (pending as any)?.cnt || 0,
    rejected: (rejected as any)?.cnt || 0,
    total_companies: (companies as any)?.cnt || 0,
    total_inquiries: (inquiries as any)?.cnt || 0,
    total_views: (views as any)?.cnt || 0
  })
})

// ── Bulk upload (admin) ──
mp.post('/api/mp/admin/listings/bulk', async (c) => {
  const admin = await marketplaceAdmin(c)
  if (!admin) return c.json({ error: 'Admin required' }, 403)

  const { listings } = await c.req.json()
  if (!Array.isArray(listings) || !listings.length) return c.json({ error: 'No listings provided' }, 400)

  // Bulk rows belong to the marketplace admin account, whoever uploads them.
  const ownerId = admin.company?.id
    ?? ((await c.env.DB.prepare("SELECT id FROM mp_companies WHERE role = 'admin' ORDER BY id LIMIT 1").first()) as any)?.id
    ?? 1

  let success = 0
  let failed = 0

  for (const item of listings) {
    try {
      if (!item.product_name || !item.description || !item.company_name) {
        failed++
        continue
      }
      const { values: v, error } = normalizeListingInput(item, ['product_name', 'description', 'target_customer', 'target_industry', 'ai_category', 'tags',
        'pricing_type', 'pricing_details', 'website_url', 'product_url', 'sales_contact_name', 'sales_contact_email', 'sales_contact_phone', 'founder_name', 'innovation'])
      if (error) { failed++; continue }
      const s = (f: string) => v[f] || ''
      const company_slug = generateSlug(item.company_name) || 'company'
      const product_slug = await uniqueProductSlug(c, company_slug, v.product_name)

      await c.env.DB.prepare(`
        INSERT INTO mp_listings (
          company_id, company_name, company_slug, product_name, product_slug,
          description, target_customer, target_industry, ai_category, tags,
          pricing_type, pricing_details, website_url, product_url,
          sales_contact_name, sales_contact_email, sales_contact_phone,
          founder_name, innovation, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        ownerId, String(item.company_name).trim().slice(0, 150), company_slug, v.product_name, product_slug,
        v.description, s('target_customer'), s('target_industry'), s('ai_category'), s('tags'),
        s('pricing_type'), s('pricing_details'), s('website_url'), s('product_url'),
        s('sales_contact_name'), s('sales_contact_email'), s('sales_contact_phone'),
        s('founder_name'), s('innovation'), 'approved'
      ).run()
      success++
    } catch {
      failed++
    }
  }

  await auditAdmin(c, admin, 'marketplace.bulk-upload', null, { uploaded: success, failed })
  return c.json({ success: true, uploaded: success, failed })
})

export default mp
