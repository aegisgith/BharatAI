import { Hono } from 'hono'
import { cors } from 'hono/cors'
import mp from './routes/marketplace'
import { marketplacePageHTML, marketplaceListingPageHTML, marketplaceDashboardPageHTML, marketplaceAdminPageHTML, marketplaceFaqPageHTML } from './routes/marketplace-pages'

type Bindings = {
  DB: D1Database
  // Bearer token for the read-only attendee export consumed by AImailPilot's
  // contact-list sync. Set via `wrangler secret put ATTENDEE_EXPORT_SECRET`
  // — never lives in this repo or the database.
  ATTENDEE_EXPORT_SECRET?: string
  // Shared secret that authenticates the admin panel. Set via
  // `wrangler secret put ADMIN_SECRET` (or a Pages env var) — never in this
  // repo or the DB. Every /api/admin/* route requires it (see middleware
  // below). This replaces the old client-side-only `admin123` check.
  ADMIN_SECRET?: string
  // Secret used to HMAC-sign marketplace session cookies so the company id
  // can't be forged. Falls back to ADMIN_SECRET if unset.
  MP_SESSION_SECRET?: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('/api/*', cors())

// ==================== ADMIN AUTHENTICATION ====================
// Server-side guard for every /api/admin/* route. The admin panel sends the
// secret as `Authorization: Bearer <ADMIN_SECRET>` on all fetches (see the
// `api` helper in the admin page). The one CSV-export link is a plain <a>
// download, so it may also pass the secret as `?token=` — accepted here too.
//
// Fails CLOSED: if ADMIN_SECRET is not configured, all admin routes return
// 503 rather than being world-open. Set it in Cloudflare before relying on
// the panel: `npx wrangler pages secret put ADMIN_SECRET`.
app.use('/api/admin/*', async (c, next) => {
  const expected = c.env.ADMIN_SECRET || ''
  if (!expected) {
    return c.json({ error: 'admin access is not configured' }, 503)
  }
  const header = c.req.header('Authorization') || ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : ''
  const token = bearer || c.req.query('token') || ''
  if (token !== expected) {
    return c.json({ error: 'unauthorized' }, 401)
  }
  await next()
})

// Lightweight endpoint the admin login form calls to verify the entered
// password server-side. Protected by the middleware above, so a 200 means
// the secret is correct; a 401 means it isn't. Returns no data.
app.get('/api/admin/verify', (c) => c.json({ ok: true }))

// ==================== AI MARKETPLACE (integrated) ====================
app.route('/', mp)

// Marketplace page routes
app.get('/marketplace', (c) => c.html(marketplacePageHTML()))
app.get('/marketplace/faq', (c) => c.html(marketplaceFaqPageHTML()))
app.get('/marketplace/dashboard', (c) => c.html(marketplaceDashboardPageHTML()))
app.get('/marketplace/admin', (c) => c.html(marketplaceAdminPageHTML()))
app.get('/marketplace/listing/:companySlug/:productSlug', (c) => {
  const companySlug = c.req.param('companySlug')
  const productSlug = c.req.param('productSlug')
  return c.html(marketplaceListingPageHTML(companySlug, productSlug))
})
app.get('/marketplace/listing/:id', (c) => {
  const id = c.req.param('id')
  return c.html(marketplaceListingPageHTML(undefined, undefined, id))
})

// ==================== EVENT APIs ====================

app.get('/api/events/:id', async (c) => {
  const id = c.req.param('id')
  const event = await c.env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(id).first()
  if (!event) return c.json({ error: 'Event not found' }, 404)
  return c.json(event)
})

// ==================== SCHEDULE APIs ====================

app.get('/api/events/:id/sessions', async (c) => {
  const eventId = c.req.param('id')
  const date = c.req.query('date')
  const type = c.req.query('type')
  const track = c.req.query('track')

  const room = c.req.query('room')
  let query = 'SELECT * FROM sessions WHERE event_id = ?'
  const params: any[] = [eventId]

  if (date) {
    query += ' AND start_time LIKE ?'
    params.push(`${date}%`)
  }
  if (type) {
    query += ' AND session_type = ?'
    params.push(type)
  }
  if (track) {
    query += ' AND track = ?'
    params.push(track)
  }
  if (room) {
    query += ' AND room = ?'
    params.push(room)
  }

  query += ' ORDER BY start_time ASC'

  const { results } = await c.env.DB.prepare(query).bind(...params).all()
  return c.json(results)
})

app.get('/api/events/:id/sessions/tracks', async (c) => {
  const eventId = c.req.param('id')
  const { results } = await c.env.DB.prepare(
    'SELECT DISTINCT track FROM sessions WHERE event_id = ? AND track IS NOT NULL ORDER BY track'
  ).bind(eventId).all()
  return c.json(results.map((r: any) => r.track))
})

app.get('/api/events/:id/sessions/rooms', async (c) => {
  const eventId = c.req.param('id')
  const { results } = await c.env.DB.prepare(
    'SELECT DISTINCT room FROM sessions WHERE event_id = ? AND room IS NOT NULL ORDER BY room'
  ).bind(eventId).all()
  return c.json(results.map((r: any) => r.room))
})

// ==================== ATTENDEE APIs ====================

// Public networking directory. By default returns only non-contact fields —
// email and mobile are withheld so the delegate list can't be scraped for
// PII by anonymous callers. When the admin secret is supplied (the admin
// panel sends it as a bearer token), the full record incl. contact details
// is returned, since the admin table needs email to send notifications.
const ATTENDEE_PUBLIC_COLS = 'id, event_id, name, company, job_title, bio, avatar_url, interests, linkedin_url, twitter_url, website_url, role, badge_type, is_online, last_seen, industry, city, country, created_at'

function isAdminRequest(c: any): boolean {
  const expected = c.env.ADMIN_SECRET || ''
  if (!expected) return false
  const header = c.req.header('Authorization') || ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : ''
  const token = bearer || c.req.query('token') || ''
  return token === expected
}

app.get('/api/events/:id/attendees', async (c) => {
  const eventId = c.req.param('id')
  const search = c.req.query('search')
  const role = c.req.query('role')
  const interest = c.req.query('interest')

  const cols = isAdminRequest(c) ? '*' : ATTENDEE_PUBLIC_COLS
  let query = `SELECT ${cols} FROM attendees WHERE event_id = ?`
  const params: any[] = [eventId]

  if (search) {
    query += ' AND (name LIKE ? OR company LIKE ? OR job_title LIKE ?)'
    const s = `%${search}%`
    params.push(s, s, s)
  }
  if (role) {
    query += ' AND role LIKE ?'
    params.push(`%${role}%`)
  }
  if (interest) {
    query += ' AND interests LIKE ?'
    params.push(`%${interest}%`)
  }

  query += ' ORDER BY is_online DESC, name ASC'

  const { results } = await c.env.DB.prepare(query).bind(...params).all()
  return c.json(results)
})

app.get('/api/attendees/:id', async (c) => {
  const id = c.req.param('id')
  const cols = isAdminRequest(c) ? '*' : ATTENDEE_PUBLIC_COLS
  const attendee = await c.env.DB.prepare(`SELECT ${cols} FROM attendees WHERE id = ?`).bind(id).first()
  if (!attendee) return c.json({ error: 'Attendee not found' }, 404)
  return c.json(attendee)
})

app.post('/api/events/:id/attendees/register', async (c) => {
  const eventId = c.req.param('id')
  const body = await c.req.json()
  const { name, email, company, job_title, bio, interests, linkedin_url, mobile, lunch_inclusion, city, badge_type } = body

  if (!name || !email) return c.json({ error: 'Name and email are required' }, 400)
  const normalizedEmail = email.trim().toLowerCase()

  // Honor the pass the user selected. Previously this hardcoded 'Visitor Pass',
  // so anyone who chose (and paid for) Delegate/VIP/Academic was stored as a
  // free Visitor and then locked out of networking. Validate against a known
  // allowlist so a bad value can't create an arbitrary pass; default to Visitor.
  const ALLOWED_PASSES = ['Visitor Pass', 'Delegate Pass', 'VIP Pass', 'Academic Pass', 'Media Pass']
  const passType = ALLOWED_PASSES.includes(badge_type) ? badge_type : 'Visitor Pass'

  try {
    const result = await c.env.DB.prepare(
      'INSERT INTO attendees (event_id, name, email, company, job_title, bio, interests, linkedin_url, mobile, city, lunch_inclusion, badge_type, is_online, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime("now"))'
    ).bind(eventId, name.trim(), normalizedEmail, company || '', job_title || '', bio || '', interests || '', linkedin_url || '', mobile || '', city || '', lunch_inclusion || 'No', passType).run()

    const attendee = await c.env.DB.prepare('SELECT * FROM attendees WHERE id = ?').bind(result.meta.last_row_id).first()
    return c.json(attendee, 201)
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) {
      const existing = await c.env.DB.prepare('SELECT * FROM attendees WHERE event_id = ? AND email = ?').bind(eventId, normalizedEmail).first()
      if (existing) {
        await c.env.DB.prepare('UPDATE attendees SET is_online = 1, last_login_at = datetime("now") WHERE id = ?').bind((existing as any).id).run()
        return c.json(existing)
      }
    }
    return c.json({ error: 'Registration failed' }, 400)
  }
})

// ==================== EXTERNAL REGISTRATION (from bharataiinnovation.com) ====================

// Maps pass types from main site to badge_type in DB
const PASS_TYPE_MAP: Record<string, string> = {
  'delegate': 'Delegate Pass',
  'vip': 'VIP Pass',
  'startup': 'Visitor Pass',
  'academic': 'Academic Pass',
  'visitor': 'Visitor Pass',
  'media': 'Media Pass',
}

app.post('/api/external/register', async (c) => {
  const body = await c.req.json()
  const {
    first_name, last_name, email, phone, organization, job_title,
    industry, company_size, city, country, source, special_requirements,
    package: passPackage, newsletter
  } = body

  if (!first_name || !email) return c.json({ error: 'Name and email are required' }, 400)

  const fullName = `${first_name.trim()} ${(last_name || '').trim()}`.trim()
  const normalizedEmail = email.trim().toLowerCase()
  const badgeType = PASS_TYPE_MAP[passPackage] || 'Visitor Pass'
  const eventId = 1

  try {
    // Try to add all the extra columns — if migration hasn't run yet, the basic columns still work
    const result = await c.env.DB.prepare(
      `INSERT INTO attendees (
        event_id, name, email, company, job_title, mobile, badge_type,
        lunch_inclusion, is_online, last_login_at,
        industry, city, country, company_size, special_requirements,
        registration_source, pass_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, datetime("now"), ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      eventId, fullName, normalizedEmail,
      organization || '', job_title || '', phone || '', badgeType,
      badgeType === 'Visitor Pass' ? 'No' : 'Yes',
      industry || '', city || '', country || 'India',
      company_size || '', special_requirements || '',
      'website', passPackage || 'visitor'
    ).run()

    const attendee = await c.env.DB.prepare('SELECT * FROM attendees WHERE id = ?').bind(result.meta.last_row_id).first() as any

    const refId = 'BHAI-2026-' + String(attendee.id).padStart(5, '0')
    return c.json({
      success: true,
      reference: refId,
      attendee_id: attendee.id,
      name: attendee.name,
      email: attendee.email,
      badge_type: attendee.badge_type,
      networking_app_url: `https://bharatai-networking.pages.dev?email=${encodeURIComponent(attendee.email)}`
    }, 201)
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) {
      // Already registered — return existing
      const existing = await c.env.DB.prepare(
        'SELECT * FROM attendees WHERE event_id = ? AND email = ?'
      ).bind(eventId, normalizedEmail).first() as any

      if (existing) {
        // Update badge_type if they're upgrading
        if (passPackage && passPackage !== 'visitor') {
          await c.env.DB.prepare(
            'UPDATE attendees SET badge_type = ?, lunch_inclusion = ?, last_login_at = datetime("now") WHERE id = ?'
          ).bind(badgeType, 'Yes', existing.id).run()
        }
        const refId = 'BHAI-2026-' + String(existing.id).padStart(5, '0')
        return c.json({
          success: true,
          reference: refId,
          attendee_id: existing.id,
          name: existing.name,
          email: existing.email,
          badge_type: passPackage ? badgeType : existing.badge_type,
          networking_app_url: `https://bharatai-networking.pages.dev?email=${encodeURIComponent(existing.email)}`,
          already_registered: true
        })
      }
    }
    return c.json({ error: 'Registration failed', details: e.message }, 400)
  }
})

// ==================== ATTENDEE EXPORT (AImailPilot sync) ====================
//
// Read-only endpoint consumed by AImailPilot's bharatai-attendee-sync
// sweeper (https://github.com/aimailpilot/aimailpilot, runs every 4h).
// Returns attendees as a JSON array sorted by created_at ASC so the
// downstream watermark advances monotonically.
//
// Auth: bearer token in Authorization header. Secret is a Cloudflare
// Workers env var (set via `wrangler secret put ATTENDEE_EXPORT_SECRET`),
// not in the repo or DB. Same value is pasted into AImailPilot Advanced
// Settings as a write-only field.
//
// Query params:
//   event_id (default 1)  — the conference instance
//   since    (optional)   — ISO timestamp; only return rows with
//                           created_at >= since (delta sync)
//   limit    (default 5000, max 5000)
app.get('/api/external/attendees-export', async (c) => {
  const authHeader = c.req.header('Authorization') || ''
  const expected = c.env.ATTENDEE_EXPORT_SECRET || ''
  if (!expected) {
    return c.json({ error: 'export endpoint not configured' }, 500)
  }
  if (authHeader !== `Bearer ${expected}`) {
    return c.json({ error: 'unauthorized' }, 401)
  }

  const eventIdRaw = c.req.query('event_id') || '1'
  const eventId = parseInt(eventIdRaw, 10)
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return c.json({ error: 'invalid event_id' }, 400)
  }
  const since = (c.req.query('since') || '').trim()
  const limitRaw = parseInt(c.req.query('limit') || '5000', 10)
  const limit = Math.min(Math.max(limitRaw || 5000, 1), 5000)

  let sql = `SELECT id, event_id, name, email, company, job_title, bio,
                    avatar_url, interests, linkedin_url, twitter_url,
                    website_url, role, badge_type, industry, city, country,
                    company_size, pass_type, registration_source, created_at
               FROM attendees
              WHERE event_id = ?`
  const args: any[] = [eventId]
  if (since) {
    sql += ` AND created_at >= ?`
    args.push(since)
  }
  sql += ` ORDER BY created_at ASC LIMIT ?`
  args.push(limit)

  const result = await c.env.DB.prepare(sql).bind(...args).all()
  return c.json(result.results || [])
})

// ==================== SIGN IN API ====================

app.post('/api/events/:id/attendees/signin', async (c) => {
  const eventId = c.req.param('id')
  const { email } = await c.req.json()

  if (!email) return c.json({ error: 'Email is required' }, 400)

  const attendee = await c.env.DB.prepare(
    'SELECT * FROM attendees WHERE event_id = ? AND email = ?'
  ).bind(eventId, email.trim().toLowerCase()).first()

  if (!attendee) {
    return c.json({ error: 'No account found with this email. Please register first.' }, 404)
  }

  // Mark user as online and track login time
  await c.env.DB.prepare('UPDATE attendees SET is_online = 1, last_login_at = datetime("now") WHERE id = ?').bind((attendee as any).id).run()

  return c.json(attendee)
})

// Login endpoint (alias for signin — used by auto-login from email links)
app.post('/api/events/:id/attendees/login', async (c) => {
  const eventId = c.req.param('id')
  const { email } = await c.req.json()
  if (!email) return c.json({ error: 'Email is required' }, 400)
  const attendee = await c.env.DB.prepare(
    'SELECT * FROM attendees WHERE event_id = ? AND email = ?'
  ).bind(eventId, email.trim().toLowerCase()).first()
  if (!attendee) return c.json({ error: 'No account found with this email.' }, 404)
  await c.env.DB.prepare('UPDATE attendees SET is_online = 1, last_login_at = datetime("now") WHERE id = ?').bind((attendee as any).id).run()
  return c.json(attendee)
})

// ==================== MAGIC LINK LOGIN ====================
app.post('/api/events/:id/attendees/send-magic-link', async (c) => {
  const eventId = c.req.param('id')
  const { email } = await c.req.json()
  if (!email) return c.json({ error: 'Email is required' }, 400)
  const normalizedEmail = email.trim().toLowerCase()

  // Check if attendee exists
  const attendee = await c.env.DB.prepare(
    'SELECT * FROM attendees WHERE event_id = ? AND email = ?'
  ).bind(eventId, normalizedEmail).first() as any

  if (!attendee) {
    return c.json({ error: 'No account found with this email. Please register first or check your email address.' }, 404)
  }

  // Build magic link URL
  const appUrlRow = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'app_url'").first() as any
  const appUrl = appUrlRow?.value || 'https://bharataiinnovation.com/app'
  const magicLink = `${appUrl}?email=${encodeURIComponent(normalizedEmail)}&action=magic-login`

  // Build email HTML
  const emailHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <div style="max-width:600px;margin:20px auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
    <div style="background:linear-gradient(135deg,#0b0d1a,#1a1f3a);padding:24px 32px;text-align:center;border-bottom:1px solid rgba(245,98,10,0.2);">
      <img src="https://bharataiinnovation.com/images/Bharat%20AI%20Innovation%20Logo.png" alt="BHAI" style="height:50px;margin-bottom:12px;">
      <h1 style="color:white;margin:0;font-size:20px;">Sign In to Bharat AI Innovation 2026</h1>
      <p style="color:#c4b5fd;margin:6px 0 0;font-size:13px;">16th Bharat AI Innovation • 20-21 Nov 2026</p>
    </div>
    <div style="padding:32px;">
      <p style="color:#333;line-height:1.6;margin:0 0 16px;">Hi <strong>${attendee.name}</strong>,</p>
      <p style="color:#555;line-height:1.6;margin:0 0 24px;">Click the button below to sign in to the Bharat AI Innovation 2026. This link will log you in automatically — no password needed.</p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${magicLink}" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#6366f1,#4f46e5);color:white;text-decoration:none;border-radius:10px;font-weight:bold;font-size:15px;">
          🔑 Sign In Now
        </a>
      </div>
      <p style="color:#999;font-size:12px;text-align:center;margin:16px 0 0;">If you didn't request this, you can safely ignore this email.</p>
    </div>
    <div style="text-align:center;padding:16px;border-top:1px solid #eee;">
      <p style="color:#999;font-size:12px;margin:0;">Bharat AI Innovation 2026 • World Trade Center, Mumbai</p>
    </div>
  </div>
</body></html>`

  // Send via Elastic Email
  const apiKeyRow = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'elastic_email_api_key'").first() as any
  const senderRow = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'sender_email'").first() as any
  const senderNameRow = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'sender_name'").first() as any

  if (!apiKeyRow?.value) {
    return c.json({ error: 'Email service not configured.' }, 500)
  }

  const fromEmail = senderRow?.value || 'delegates@bharataiinnovation.com'
  const fromName = senderNameRow?.value || 'Bharat AI Innovation Conference & Exhibition 2026'

  try {
    const payload = {
      Recipients: { To: [normalizedEmail] },
      Content: {
        Body: [{ ContentType: "HTML", Content: emailHtml, Charset: "utf-8" }],
        From: `${fromName} <${fromEmail}>`,
        Subject: 'Sign In to Bharat AI Innovation 2026'
      },
      Options: { TrackClicks: false, TrackOpens: false }
    }
    const res = await fetch('https://api.elasticemail.com/v4/emails/transactional', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ElasticEmail-ApiKey': apiKeyRow.value
      },
      body: JSON.stringify(payload)
    })
    const result = await res.json() as any
    if (!res.ok) {
      return c.json({ error: result.Error || 'Failed to send magic link email' }, 500)
    }
    return c.json({ success: true, message: 'Magic link sent! Check your email inbox.' })
  } catch (e: any) {
    return c.json({ error: 'Failed to send email: ' + e.message }, 500)
  }
})

// Track delegate pass download
app.post('/api/attendees/:id/track-pass-download', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('UPDATE attendees SET pass_downloaded_at = datetime("now") WHERE id = ? AND pass_downloaded_at IS NULL').bind(id).run()
  return c.json({ success: true })
})

// ==================== RSVP APIs ====================

// Update RSVP status (used by both email link and in-app)
app.post('/api/attendees/:id/rsvp', async (c) => {
  const id = c.req.param('id')
  const { status } = await c.req.json()
  if (!['confirmed', 'declined', 'maybe'].includes(status)) return c.json({ error: 'Invalid status' }, 400)
  await c.env.DB.prepare('UPDATE attendees SET rsvp_status = ?, rsvp_at = datetime("now") WHERE id = ?').bind(status, id).run()
  return c.json({ success: true, status })
})

// RSVP via email token (GET — one click from email)
app.get('/api/rsvp', async (c) => {
  const email = c.req.query('email')
  const status = c.req.query('status')
  const eventId = c.req.query('event') || '1'
  if (!email || !['confirmed', 'declined', 'maybe'].includes(status || '')) {
    return c.text('Invalid RSVP link', 400)
  }
  const attendee = await c.env.DB.prepare('SELECT id, name FROM attendees WHERE event_id = ? AND email = ?').bind(eventId, email.trim().toLowerCase()).first() as any
  if (!attendee) return c.text('Attendee not found', 404)
  await c.env.DB.prepare('UPDATE attendees SET rsvp_status = ?, rsvp_at = datetime("now") WHERE id = ?').bind(status, attendee.id).run()

  // Redirect to pretty RSVP confirmation page
  const appUrlRow = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'app_url'").first() as any
  const appUrl = appUrlRow?.value || 'https://bharataiinnovation.com/app'
  return c.redirect(`/rsvp-confirmed?status=${status}&name=${encodeURIComponent(attendee.name)}&email=${encodeURIComponent(email as string)}&app=${encodeURIComponent(appUrl)}`)
})

// RSVP confirmation landing page
app.get('/rsvp-confirmed', (c) => {
  const status = c.req.query('status') || 'confirmed'
  const name = c.req.query('name') || 'there'
  const email = c.req.query('email') || ''
  const appUrl = c.req.query('app') || 'https://bharataiinnovation.com/app'

  const statusConfig: any = {
    confirmed: { emoji: '🎉', title: "You're Confirmed!", subtitle: "We look forward to seeing you at the event.", color: '#22c55e', bg: 'from-green-500/20 to-emerald-500/20', border: 'border-green-500/30' },
    declined: { emoji: '😔', title: "Sorry to hear that", subtitle: "We hope to see you at future events.", color: '#ef4444', bg: 'from-red-500/20 to-rose-500/20', border: 'border-red-500/30' },
    maybe: { emoji: '🤔', title: "Noted as Maybe", subtitle: "Let us know when you've decided! You can change anytime.", color: '#f59e0b', bg: 'from-amber-500/20 to-orange-500/20', border: 'border-amber-500/30' },
  }
  const cfg = statusConfig[status] || statusConfig.confirmed

  return c.html(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RSVP - Bharat AI Innovation 2026</title><script src="https://cdn.tailwindcss.com"></script><link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet"></head>
<body class="min-h-screen bg-gradient-to-br from-[#0a0a1a] via-[#111132] to-[#0a0a1a] flex items-center justify-center p-4 font-sans">
  <div class="max-w-md w-full text-center">
    <img src="https://bharataiinnovation.com/images/Bharat%20AI%20Innovation%20Logo.png" alt="BHAI" class="h-16 mx-auto mb-8 opacity-80">
    <div class="bg-white/5 backdrop-blur-xl border ${cfg.border} rounded-3xl p-8 shadow-2xl">
      <div class="text-6xl mb-4">${cfg.emoji}</div>
      <h1 class="text-2xl font-bold text-white mb-2">${cfg.title}</h1>
      <p class="text-gray-400 mb-1">Hi <strong class="text-white">${name}</strong>,</p>
      <p class="text-gray-400 mb-6 text-sm">${cfg.subtitle}</p>
      <div class="bg-white/5 rounded-xl p-4 mb-6 text-left">
        <div class="text-xs text-gray-500 uppercase tracking-wider mb-2">Event Details</div>
        <p class="text-white font-semibold text-sm">Bharat AI Innovation Conference & Exhibition 2026</p>
        <p class="text-gray-400 text-xs mt-1"><i class="fas fa-calendar-alt mr-1"></i>20-21 Nov 2026 &bull; <i class="fas fa-map-marker-alt ml-1 mr-1"></i>World Trade Center, Mumbai</p>
      </div>
      ${status === 'confirmed' ? `<div class="space-y-2 mb-4"><a href="${appUrl}?email=${encodeURIComponent(email)}&action=download-pass" class="block w-full py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-500 hover:to-primary-400 transition text-sm"><i class="fas fa-id-badge mr-2"></i>Download Delegate Pass</a></div>` : ''}
      <a href="${appUrl}?email=${encodeURIComponent(email)}" class="block w-full py-3 rounded-xl font-bold text-white transition text-sm text-center hover:opacity-90 no-underline" style="background:linear-gradient(135deg,#FF6B00,#e03060);box-shadow:0 4px 20px rgba(245,98,10,0.28);"><i class="fas fa-rocket mr-2"></i>Open Networking App</a>
      <p class="text-xs text-gray-500 mt-4">You can change your RSVP anytime from the app.</p>
    </div>
    <p class="text-xs text-gray-600 mt-6">Bharat AI Innovation 2026 &bull; World Trade Center, Mumbai &bull; 20-21 Nov 2026</p>
  </div>
</body></html>`)
})

// ==================== CONNECTION APIs ====================

app.get('/api/attendees/:id/connections', async (c) => {
  const attendeeId = c.req.param('id')
  const { results } = await c.env.DB.prepare(`
    SELECT c.*, 
      CASE WHEN c.from_attendee_id = ? THEN a2.name ELSE a1.name END as other_name,
      CASE WHEN c.from_attendee_id = ? THEN a2.email ELSE a1.email END as other_email,
      CASE WHEN c.from_attendee_id = ? THEN a2.company ELSE a1.company END as other_company,
      CASE WHEN c.from_attendee_id = ? THEN a2.job_title ELSE a1.job_title END as other_job_title,
      CASE WHEN c.from_attendee_id = ? THEN a2.id ELSE a1.id END as other_id,
      CASE WHEN c.from_attendee_id = ? THEN a2.is_online ELSE a1.is_online END as other_online,
      CASE WHEN c.from_attendee_id = ? THEN a2.avatar_url ELSE a1.avatar_url END as other_avatar
    FROM connections c
    JOIN attendees a1 ON c.from_attendee_id = a1.id
    JOIN attendees a2 ON c.to_attendee_id = a2.id
    WHERE c.from_attendee_id = ? OR c.to_attendee_id = ?
    ORDER BY c.created_at DESC
  `).bind(attendeeId, attendeeId, attendeeId, attendeeId, attendeeId, attendeeId, attendeeId, attendeeId, attendeeId).all()
  return c.json(results)
})

app.post('/api/connections', async (c) => {
  const body = await c.req.json()
  const { event_id, from_attendee_id, to_attendee_id, message } = body

  try {
    await c.env.DB.prepare(
      'INSERT INTO connections (event_id, from_attendee_id, to_attendee_id, message) VALUES (?, ?, ?, ?)'
    ).bind(event_id, from_attendee_id, to_attendee_id, message || '').run()
    return c.json({ success: true }, 201)
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) return c.json({ error: 'Connection already exists' }, 409)
    return c.json({ error: 'Failed to create connection' }, 400)
  }
})

app.put('/api/connections/:id', async (c) => {
  const id = c.req.param('id')
  const { status } = await c.req.json()
  await c.env.DB.prepare('UPDATE connections SET status = ? WHERE id = ?').bind(status, id).run()
  return c.json({ success: true })
})

// ==================== MESSAGE APIs ====================

app.get('/api/messages/:userId/:otherUserId', async (c) => {
  const userId = c.req.param('userId')
  const otherUserId = c.req.param('otherUserId')
  const { results } = await c.env.DB.prepare(`
    SELECT m.*, a.name as sender_name 
    FROM messages m
    JOIN attendees a ON m.sender_id = a.id
    WHERE (m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?)
    ORDER BY m.created_at ASC
  `).bind(userId, otherUserId, otherUserId, userId).all()

  // Mark as read
  await c.env.DB.prepare(
    'UPDATE messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ?'
  ).bind(otherUserId, userId).run()

  return c.json(results)
})

app.post('/api/messages', async (c) => {
  const body = await c.req.json()
  const { event_id, sender_id, receiver_id, content } = body

  const result = await c.env.DB.prepare(
    'INSERT INTO messages (event_id, sender_id, receiver_id, content) VALUES (?, ?, ?, ?)'
  ).bind(event_id, sender_id, receiver_id, content).run()

  return c.json({ id: result.meta.last_row_id, success: true }, 201)
})

app.get('/api/attendees/:id/unread', async (c) => {
  const id = c.req.param('id')
  const result = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM messages WHERE receiver_id = ? AND is_read = 0'
  ).bind(id).first()
  return c.json(result)
})

// ==================== MEETING APIs ====================

app.get('/api/attendees/:id/meetings', async (c) => {
  const attendeeId = c.req.param('id')
  const { results } = await c.env.DB.prepare(`
    SELECT m.*, 
      a1.name as requester_name, a1.company as requester_company,
      a2.name as requestee_name, a2.company as requestee_company
    FROM meetings m
    JOIN attendees a1 ON m.requester_id = a1.id
    JOIN attendees a2 ON m.requestee_id = a2.id
    WHERE m.requester_id = ? OR m.requestee_id = ?
    ORDER BY m.meeting_time ASC
  `).bind(attendeeId, attendeeId).all()
  return c.json(results)
})

app.post('/api/meetings', async (c) => {
  const body = await c.req.json()
  const { event_id, requester_id, requestee_id, title, meeting_time, duration_minutes, location, notes } = body

  const result = await c.env.DB.prepare(
    'INSERT INTO meetings (event_id, requester_id, requestee_id, title, meeting_time, duration_minutes, location, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(event_id, requester_id, requestee_id, title, meeting_time, duration_minutes || 15, location || '', notes || '').run()

  return c.json({ id: result.meta.last_row_id, success: true }, 201)
})

app.put('/api/meetings/:id', async (c) => {
  const id = c.req.param('id')
  const { status } = await c.req.json()
  await c.env.DB.prepare('UPDATE meetings SET status = ? WHERE id = ?').bind(status, id).run()
  return c.json({ success: true })
})

// ==================== EXHIBITOR APIs ====================

app.get('/api/events/:id/exhibitors', async (c) => {
  const eventId = c.req.param('id')
  const category = c.req.query('category')
  const search = c.req.query('search')

  let query = 'SELECT * FROM exhibitors WHERE event_id = ?'
  const params: any[] = [eventId]

  if (category) {
    query += ' AND category = ?'
    params.push(category)
  }
  if (search) {
    query += ' AND (company_name LIKE ? OR description LIKE ? OR products LIKE ?)'
    const s = `%${search}%`
    params.push(s, s, s)
  }

  query += ' ORDER BY booth_size DESC, company_name ASC'

  const { results } = await c.env.DB.prepare(query).bind(...params).all()
  return c.json(results)
})

app.get('/api/exhibitors/:id', async (c) => {
  const id = c.req.param('id')
  const exhibitor = await c.env.DB.prepare('SELECT * FROM exhibitors WHERE id = ?').bind(id).first()
  if (!exhibitor) return c.json({ error: 'Exhibitor not found' }, 404)
  return c.json(exhibitor)
})

app.post('/api/exhibitors/:id/visit', async (c) => {
  const exhibitorId = c.req.param('id')
  const { attendee_id, event_id, interested, notes } = await c.req.json()

  await c.env.DB.prepare(
    'INSERT INTO booth_visits (exhibitor_id, attendee_id, event_id, interested, notes) VALUES (?, ?, ?, ?, ?)'
  ).bind(exhibitorId, attendee_id, event_id, interested ? 1 : 0, notes || '').run()

  await c.env.DB.prepare(
    'UPDATE exhibitors SET visitor_count = visitor_count + 1 WHERE id = ?'
  ).bind(exhibitorId).run()

  return c.json({ success: true }, 201)
})

app.get('/api/events/:id/exhibitors/categories', async (c) => {
  const eventId = c.req.param('id')
  const { results } = await c.env.DB.prepare(
    'SELECT DISTINCT category FROM exhibitors WHERE event_id = ? ORDER BY category'
  ).bind(eventId).all()
  return c.json(results.map((r: any) => r.category))
})

// ==================== IMAGE PROXY (for CORS-free canvas drawing) ====================
app.get('/api/image-proxy', async (c) => {
  const url = c.req.query('url')
  if (!url) return c.text('Missing url param', 400)
  // Only allow bharataiinnovation.com images
  if (!url.startsWith('https://bharataiinnovation.com/')) return c.text('Domain not allowed', 403)
  try {
    const resp = await fetch(url)
    if (!resp.ok) return c.text('Upstream error', resp.status)
    const buf = await resp.arrayBuffer()
    const ct = resp.headers.get('content-type') || 'image/png'
    return new Response(buf, {
      headers: {
        'Content-Type': ct,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400',
      }
    })
  } catch(e: any) {
    return c.text('Fetch failed: ' + e.message, 500)
  }
})

// ==================== BOOTH TYPES & REQUESTS APIs ====================

// Get all active booth types
app.get('/api/booth-types', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM booth_types WHERE is_active = 1 ORDER BY sort_order'
  ).all()
  return c.json(results)
})

// Get single booth type by slug
app.get('/api/booth-types/:slug', async (c) => {
  const slug = c.req.param('slug')
  const bt = await c.env.DB.prepare('SELECT * FROM booth_types WHERE slug = ?').bind(slug).first()
  if (!bt) return c.json({ error: 'Booth type not found' }, 404)
  return c.json(bt)
})

// Submit booth request
app.post('/api/booth-requests', async (c) => {
  const body = await c.req.json() as any
  const { booth_type_id, event_id, company_name, contact_name, email, phone, website, industry,
    company_size, company_description, quantity, preferred_zone, preferred_booth_numbers,
    special_requirements, products_to_display, attendee_id } = body

  if (!booth_type_id || !company_name || !contact_name || !email) {
    return c.json({ error: 'booth_type_id, company_name, contact_name, and email are required' }, 400)
  }

  // Get booth type for price calc
  const bt = await c.env.DB.prepare('SELECT * FROM booth_types WHERE id = ?').bind(booth_type_id).first() as any
  if (!bt) return c.json({ error: 'Invalid booth type' }, 404)

  const qty = Math.max(1, quantity || 1)
  if (qty > bt.available_count) {
    return c.json({ error: `Only ${bt.available_count} ${bt.name} booths available` }, 400)
  }

  const total_price = bt.price_inr * qty
  const gst = Math.round(total_price * 0.18)
  const grand_total = total_price + gst

  const result = await c.env.DB.prepare(
    `INSERT INTO booth_requests (event_id, booth_type_id, attendee_id, company_name, contact_name, email, phone, website,
      industry, company_size, company_description, quantity, preferred_zone, preferred_booth_numbers,
      special_requirements, products_to_display, total_price_inr, gst_amount, grand_total)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    event_id || 1, booth_type_id, attendee_id || null, company_name, contact_name, email,
    phone || '', website || '', industry || '', company_size || '', company_description || '',
    qty, preferred_zone || '', preferred_booth_numbers || '', special_requirements || '',
    products_to_display || '', total_price, gst, grand_total
  ).run()

  return c.json({
    id: result.meta.last_row_id,
    booth_type: bt.name,
    quantity: qty,
    total_price_inr: total_price,
    gst_amount: gst,
    grand_total: grand_total,
    status: 'submitted',
    payment_status: 'pending',
    message: 'Booth request submitted successfully! Our team will review and send you an invoice.'
  })
})

// Get booth requests for a user (by email or attendee_id)
app.get('/api/booth-requests', async (c) => {
  const email = c.req.query('email')
  const attendee_id = c.req.query('attendee_id')

  let query = `SELECT br.*, bt.name as booth_type_name, bt.slug as booth_type_slug,
    bt.size_label, bt.area_sqm, bt.price_inr as unit_price, bt.color as booth_color, bt.icon as booth_icon
    FROM booth_requests br JOIN booth_types bt ON br.booth_type_id = bt.id`
  const params: any[] = []

  if (attendee_id) {
    query += ' WHERE br.attendee_id = ?'
    params.push(attendee_id)
  } else if (email) {
    query += ' WHERE br.email = ?'
    params.push(email)
  } else {
    return c.json({ error: 'email or attendee_id required' }, 400)
  }
  query += ' ORDER BY br.created_at DESC'

  const { results } = await c.env.DB.prepare(query).bind(...params).all()
  return c.json(results)
})

// Admin: Get all booth requests
app.get('/api/admin/booth-requests', async (c) => {
  const status = c.req.query('status')
  let query = `SELECT br.*, bt.name as booth_type_name, bt.slug as booth_type_slug,
    bt.size_label, bt.area_sqm, bt.price_inr as unit_price, bt.color as booth_color
    FROM booth_requests br JOIN booth_types bt ON br.booth_type_id = bt.id`
  const params: any[] = []
  if (status) {
    query += ' WHERE br.status = ?'
    params.push(status)
  }
  query += ' ORDER BY br.created_at DESC'
  const { results } = await c.env.DB.prepare(query).bind(...params).all()
  return c.json(results)
})

// Admin: Update booth request status
app.put('/api/admin/booth-requests/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json() as any
  const { status, payment_status, admin_notes, invoice_number, reviewed_by } = body

  const updates: string[] = ['updated_at = CURRENT_TIMESTAMP']
  const params: any[] = []

  if (status) { updates.push('status = ?'); params.push(status) }
  if (payment_status) { updates.push('payment_status = ?'); params.push(payment_status) }
  if (admin_notes !== undefined) { updates.push('admin_notes = ?'); params.push(admin_notes) }
  if (invoice_number) { updates.push('invoice_number = ?'); params.push(invoice_number) }
  if (reviewed_by) { updates.push('reviewed_by = ?'); params.push(reviewed_by) }
  if (status === 'approved' || status === 'rejected') {
    updates.push('reviewed_at = CURRENT_TIMESTAMP')
  }
  if (payment_status === 'paid') {
    updates.push('payment_date = CURRENT_TIMESTAMP')
  }

  // If approved, reduce available count
  if (status === 'approved') {
    const req = await c.env.DB.prepare('SELECT booth_type_id, quantity FROM booth_requests WHERE id = ?').bind(id).first() as any
    if (req) {
      await c.env.DB.prepare('UPDATE booth_types SET available_count = MAX(0, available_count - ?) WHERE id = ?')
        .bind(req.quantity, req.booth_type_id).run()
    }
  }

  params.push(id)
  await c.env.DB.prepare(`UPDATE booth_requests SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run()

  const updated = await c.env.DB.prepare(
    `SELECT br.*, bt.name as booth_type_name FROM booth_requests br JOIN booth_types bt ON br.booth_type_id = bt.id WHERE br.id = ?`
  ).bind(id).first()
  return c.json(updated)
})

// Admin: Booth request stats
app.get('/api/admin/booth-stats', async (c) => {
  const [totalRequests, statusBreakdown, typeBreakdown, revenue] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM booth_requests').first(),
    c.env.DB.prepare("SELECT status, COUNT(*) as count FROM booth_requests GROUP BY status").all(),
    c.env.DB.prepare(`SELECT bt.name, bt.slug, bt.total_count, bt.available_count, bt.price_inr,
      COUNT(br.id) as requests, SUM(CASE WHEN br.status='approved' THEN br.quantity ELSE 0 END) as approved_qty
      FROM booth_types bt LEFT JOIN booth_requests br ON bt.id = br.booth_type_id
      WHERE bt.is_active = 1 GROUP BY bt.id ORDER BY bt.sort_order`).all(),
    c.env.DB.prepare("SELECT SUM(grand_total) as total FROM booth_requests WHERE status IN ('approved','confirmed') AND payment_status = 'paid'").first(),
  ])
  return c.json({
    total_requests: (totalRequests as any)?.count || 0,
    by_status: (statusBreakdown as any)?.results || [],
    by_type: (typeBreakdown as any)?.results || [],
    total_revenue: (revenue as any)?.total || 0,
  })
})

// ==================== AWARD APIs ====================

app.get('/api/events/:id/awards', async (c) => {
  const eventId = c.req.param('id')
  const { results: categories } = await c.env.DB.prepare(
    'SELECT * FROM award_categories WHERE event_id = ? ORDER BY id'
  ).bind(eventId).all()

  const enriched = await Promise.all(categories.map(async (cat: any) => {
    const { results: nominees } = await c.env.DB.prepare(
      'SELECT * FROM award_nominees WHERE category_id = ? ORDER BY name ASC'
    ).bind(cat.id).all()
    return { ...cat, nominees }
  }))

  return c.json(enriched)
})

// ==================== STARTUP PITCH APIs ====================

// Public: Get all active startup pitches for an event
app.get('/api/events/:id/startup-pitches', async (c) => {
  const eventId = c.req.param('id')
  const { results: pitches } = await c.env.DB.prepare(
    'SELECT * FROM startup_pitches WHERE event_id = ? AND is_active = 1 ORDER BY slot_order ASC'
  ).bind(eventId).all()
  const { results: investors } = await c.env.DB.prepare(
    'SELECT * FROM startup_investors WHERE event_id = ? AND is_active = 1 ORDER BY name ASC'
  ).bind(eventId).all()
  return c.json({ pitches, investors })
})

// ==================== ANNOUNCEMENT APIs ====================

app.get('/api/events/:id/announcements', async (c) => {
  const eventId = c.req.param('id')
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM announcements WHERE event_id = ? ORDER BY pinned DESC, created_at DESC'
  ).bind(eventId).all()
  return c.json(results)
})

// ==================== USER DASHBOARD APIs ====================

app.get('/api/attendees/:id/dashboard', async (c) => {
  const id = c.req.param('id')
  const attendee = await c.env.DB.prepare('SELECT * FROM attendees WHERE id = ?').bind(id).first()
  if (!attendee) return c.json({ error: 'Attendee not found' }, 404)

  const connectionsAccepted = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM connections WHERE (from_attendee_id = ? OR to_attendee_id = ?) AND status = ?'
  ).bind(id, id, 'accepted').first()

  const connectionsPending = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM connections WHERE to_attendee_id = ? AND status = ?'
  ).bind(id, 'pending').first()

  const totalMessages = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM messages WHERE sender_id = ? OR receiver_id = ?'
  ).bind(id, id).first()

  const unreadMessages = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM messages WHERE receiver_id = ? AND is_read = 0'
  ).bind(id).first()

  const meetingsUpcoming = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM meetings WHERE (requester_id = ? OR requestee_id = ?) AND status = 'accepted'`
  ).bind(id, id).first()

  const meetingsPending = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM meetings WHERE (requester_id = ? OR requestee_id = ?) AND status = 'pending'`
  ).bind(id, id).first()

  const boothVisits = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM booth_visits WHERE attendee_id = ?'
  ).bind(id).first()

  // Get recent connections with names
  const { results: recentConnections } = await c.env.DB.prepare(`
    SELECT c.*,
      CASE WHEN c.from_attendee_id = ? THEN a2.name ELSE a1.name END as other_name,
      CASE WHEN c.from_attendee_id = ? THEN a2.email ELSE a1.email END as other_email,
      CASE WHEN c.from_attendee_id = ? THEN a2.company ELSE a1.company END as other_company,
      CASE WHEN c.from_attendee_id = ? THEN a2.id ELSE a1.id END as other_id,
      CASE WHEN c.from_attendee_id = ? THEN a2.is_online ELSE a1.is_online END as other_online
    FROM connections c
    JOIN attendees a1 ON c.from_attendee_id = a1.id
    JOIN attendees a2 ON c.to_attendee_id = a2.id
    WHERE (c.from_attendee_id = ? OR c.to_attendee_id = ?) AND c.status = 'accepted'
    ORDER BY c.created_at DESC LIMIT 6
  `).bind(id, id, id, id, id, id, id).all()

  // Get upcoming meetings
  const { results: upcomingMeetings } = await c.env.DB.prepare(`
    SELECT m.*,
      a1.name as requester_name, a1.company as requester_company,
      a2.name as requestee_name, a2.company as requestee_company
    FROM meetings m
    JOIN attendees a1 ON m.requester_id = a1.id
    JOIN attendees a2 ON m.requestee_id = a2.id
    WHERE (m.requester_id = ? OR m.requestee_id = ?) AND m.status IN ('accepted','pending')
    ORDER BY m.meeting_time ASC LIMIT 5
  `).bind(id, id).all()

  // Get visited booths with exhibitor names
  const { results: visitedBooths } = await c.env.DB.prepare(`
    SELECT bv.*, e.company_name, e.booth_number, e.category
    FROM booth_visits bv
    JOIN exhibitors e ON bv.exhibitor_id = e.id
    WHERE bv.attendee_id = ?
    ORDER BY bv.visited_at DESC LIMIT 6
  `).bind(id).all()

  return c.json({
    profile: attendee,
    stats: {
      connectionsAccepted: (connectionsAccepted as any)?.count || 0,
      connectionsPending: (connectionsPending as any)?.count || 0,
      totalMessages: (totalMessages as any)?.count || 0,
      unreadMessages: (unreadMessages as any)?.count || 0,
      meetingsUpcoming: (meetingsUpcoming as any)?.count || 0,
      meetingsPending: (meetingsPending as any)?.count || 0,
      boothVisits: (boothVisits as any)?.count || 0,
    },
    recentConnections,
    upcomingMeetings,
    visitedBooths,
  })
})

// Update attendee profile
app.put('/api/attendees/:id/profile', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const { name, company, job_title, bio, interests, linkedin_url, twitter_url, website_url, mobile, lunch_inclusion, arrival_time } = body

  await c.env.DB.prepare(
    'UPDATE attendees SET name=?, company=?, job_title=?, bio=?, interests=?, linkedin_url=?, twitter_url=?, website_url=?, mobile=?, lunch_inclusion=?, arrival_time=? WHERE id=?'
  ).bind(
    name, company || '', job_title || '', bio || '', interests || '',
    linkedin_url || '', twitter_url || '', website_url || '', mobile || '', lunch_inclusion || 'Yes', arrival_time || '', id
  ).run()

  const updated = await c.env.DB.prepare('SELECT * FROM attendees WHERE id = ?').bind(id).first()
  return c.json(updated)
})

// Upload avatar photo for attendee (self-service or admin)
app.post('/api/attendees/:id/avatar', async (c) => {
  const id = c.req.param('id')
  const attendee = await c.env.DB.prepare('SELECT id FROM attendees WHERE id = ?').bind(id).first()
  if (!attendee) return c.json({ error: 'Attendee not found' }, 404)

  const { image } = await c.req.json()
  if (!image) return c.json({ error: 'No image data provided' }, 400)

  // Validate it's a data URL (base64 image)
  if (!image.startsWith('data:image/')) {
    return c.json({ error: 'Invalid image format. Must be a data:image URL.' }, 400)
  }

  // Check size (max ~500KB base64 string)
  if (image.length > 500000) {
    return c.json({ error: 'Image too large. Please use a smaller image (max 500KB).' }, 400)
  }

  await c.env.DB.prepare('UPDATE attendees SET avatar_url = ? WHERE id = ?').bind(image, id).run()
  return c.json({ success: true, avatar_url: image })
})

// Delete avatar photo for attendee
app.delete('/api/attendees/:id/avatar', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('UPDATE attendees SET avatar_url = NULL WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

// Get exhibitor booth linked to an attendee
app.get('/api/attendees/:id/exhibitor', async (c) => {
  const id = c.req.param('id')
  const exhibitor = await c.env.DB.prepare('SELECT * FROM exhibitors WHERE attendee_id = ?').bind(id).first()
  return c.json(exhibitor || null)
})

// Create or update exhibitor booth for an attendee (self-service)
app.put('/api/attendees/:id/exhibitor', async (c) => {
  const attendeeId = c.req.param('id')
  const body = await c.req.json()
  const { company_name, description, booth_number, booth_size, category, website_url, contact_email, contact_phone, products } = body

  // Check if attendee has exhibitor-related badge
  const attendee = await c.env.DB.prepare('SELECT * FROM attendees WHERE id = ?').bind(attendeeId).first() as any
  if (!attendee) return c.json({ error: 'Attendee not found' }, 404)

  const exhibitorBadges = ['Exhibitor', 'Exhibitor Booth', 'Exhibition Speaker']
  const hasExhibitorBadge = exhibitorBadges.some(b => (attendee.badge_type || '').toLowerCase().includes(b.toLowerCase()))
  if (!hasExhibitorBadge) return c.json({ error: 'Only exhibitor badge holders can manage booths' }, 403)

  // Check if exhibitor already exists for this attendee
  const existing = await c.env.DB.prepare('SELECT id FROM exhibitors WHERE attendee_id = ?').bind(attendeeId).first()

  if (existing) {
    await c.env.DB.prepare(
      'UPDATE exhibitors SET company_name=?, description=?, booth_number=?, booth_size=?, category=?, website_url=?, contact_email=?, contact_phone=?, products=? WHERE attendee_id=?'
    ).bind(company_name, description || '', booth_number || '', booth_size || 'standard', category || '', website_url || '', contact_email || '', contact_phone || '', products || '', attendeeId).run()
  } else {
    await c.env.DB.prepare(
      'INSERT INTO exhibitors (event_id, company_name, description, booth_number, booth_size, category, website_url, contact_email, contact_phone, products, attendee_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    ).bind(attendee.event_id, company_name, description || '', booth_number || '', booth_size || 'standard', category || '', website_url || '', contact_email || '', contact_phone || '', products || '', attendeeId).run()
  }

  const updated = await c.env.DB.prepare('SELECT * FROM exhibitors WHERE attendee_id = ?').bind(attendeeId).first()
  return c.json(updated)
})

// ==================== STATS APIs ====================

app.get('/api/events/:id/stats', async (c) => {
  const eventId = c.req.param('id')

  const attendeeCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM attendees WHERE event_id = ?').bind(eventId).first()
  const onlineCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM attendees WHERE event_id = ? AND is_online = 1').bind(eventId).first()
  const sessionCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM sessions WHERE event_id = ?').bind(eventId).first()
  const exhibitorCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM exhibitors WHERE event_id = ?').bind(eventId).first()
  const connectionCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM connections WHERE event_id = ?').bind(eventId).first()
  const categoryCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM award_categories WHERE event_id = ?').bind(eventId).first()

  return c.json({
    attendees: (attendeeCount as any)?.count || 0,
    online: (onlineCount as any)?.count || 0,
    sessions: (sessionCount as any)?.count || 0,
    exhibitors: (exhibitorCount as any)?.count || 0,
    connections: (connectionCount as any)?.count || 0,
    categories: (categoryCount as any)?.count || 0,
  })
})

// ==================== ADMIN APIs ====================

// Admin: Update event
app.put('/api/admin/events/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const { title, description, event_type, venue, start_date, end_date, status, max_attendees } = body
  await c.env.DB.prepare(
    'UPDATE events SET title=?, description=?, event_type=?, venue=?, start_date=?, end_date=?, status=?, max_attendees=? WHERE id=?'
  ).bind(title, description, event_type, venue, start_date, end_date, status, max_attendees, id).run()
  return c.json({ success: true })
})

// Admin: CRUD sessions
app.post('/api/admin/sessions', async (c) => {
  const b = await c.req.json()
  const result = await c.env.DB.prepare(
    'INSERT INTO sessions (event_id, title, description, speaker_name, speaker_title, speaker_avatar, session_type, track, room, start_time, end_time, capacity) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(b.event_id, b.title, b.description||'', b.speaker_name||'', b.speaker_title||'', b.speaker_avatar||'', b.session_type, b.track||'', b.room||'', b.start_time, b.end_time, b.capacity||100).run()
  return c.json({ id: result.meta.last_row_id, success: true }, 201)
})

app.put('/api/admin/sessions/:id', async (c) => {
  const id = c.req.param('id')
  const b = await c.req.json()
  await c.env.DB.prepare(
    'UPDATE sessions SET title=?, description=?, speaker_name=?, speaker_title=?, speaker_avatar=?, session_type=?, track=?, room=?, start_time=?, end_time=?, capacity=? WHERE id=?'
  ).bind(b.title, b.description||'', b.speaker_name||'', b.speaker_title||'', b.speaker_avatar||'', b.session_type, b.track||'', b.room||'', b.start_time, b.end_time, b.capacity||100, id).run()
  return c.json({ success: true })
})

app.delete('/api/admin/sessions/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM sessions WHERE id=?').bind(id).run()
  return c.json({ success: true })
})

// Admin: Update attendees
app.put('/api/admin/attendees/:id', async (c) => {
  const id = c.req.param('id')
  const b = await c.req.json()
  await c.env.DB.prepare(
    'UPDATE attendees SET name=?, email=?, company=?, job_title=?, bio=?, interests=?, role=?, badge_type=?, mobile=?, linkedin_url=?, lunch_inclusion=?, twitter_url=?, website_url=?, arrival_time=?, city=?, country=?, registration_date=?, payment_amount=? WHERE id=?'
  ).bind(b.name, b.email, b.company||'', b.job_title||'', b.bio||'', b.interests||'', b.role, b.badge_type, b.mobile||'', b.linkedin_url||'', b.lunch_inclusion||'Yes', b.twitter_url||'', b.website_url||'', b.arrival_time||'', b.city||'', b.country||'', b.registration_date||'', b.payment_amount||'', id).run()

  // Auto-create exhibitor entry if badge is exhibitor-related
  const exhibitorBadges = ['exhibitor', 'exhibitor booth', 'exhibition speaker']
  if (exhibitorBadges.some(eb => (b.badge_type || '').toLowerCase().includes(eb))) {
    const existing = await c.env.DB.prepare('SELECT id FROM exhibitors WHERE attendee_id = ?').bind(id).first()
    if (!existing) {
      const attendee = await c.env.DB.prepare('SELECT event_id, company, email FROM attendees WHERE id = ?').bind(id).first() as any
      if (attendee) {
        await c.env.DB.prepare(
          'INSERT INTO exhibitors (event_id, company_name, contact_email, attendee_id) VALUES (?,?,?,?)'
        ).bind(attendee.event_id, attendee.company || b.company || 'TBD', attendee.email || b.email || '', id).run()
      }
    }
  }

  return c.json({ success: true })
})

// Admin: Partial inline update for a single attendee field
app.patch('/api/admin/attendees/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const allowedFields = ['name', 'email', 'mobile', 'company', 'job_title', 'role', 'badge_type', 'rsvp_status', 'lunch_inclusion', 'arrival_time', 'linkedin_url', 'bio', 'interests', 'twitter_url', 'website_url', 'city', 'country', 'registration_date', 'payment_amount']
  const updates: string[] = []
  const values: any[] = []
  for (const [key, val] of Object.entries(body)) {
    if (allowedFields.includes(key)) {
      updates.push(`${key} = ?`)
      values.push(val ?? '')
    }
  }
  if (updates.length === 0) return c.json({ error: 'No valid fields to update' }, 400)
  values.push(id)
  await c.env.DB.prepare(`UPDATE attendees SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run()

  // Auto-create exhibitor entry if badge changed to exhibitor-related
  if (body.badge_type) {
    const exhibitorBadges = ['exhibitor', 'exhibitor booth', 'exhibition speaker']
    if (exhibitorBadges.some(eb => (body.badge_type || '').toLowerCase().includes(eb))) {
      const existing = await c.env.DB.prepare('SELECT id FROM exhibitors WHERE attendee_id = ?').bind(id).first()
      if (!existing) {
        const attendee = await c.env.DB.prepare('SELECT event_id, company, email FROM attendees WHERE id = ?').bind(id).first() as any
        if (attendee) {
          await c.env.DB.prepare('INSERT INTO exhibitors (event_id, company_name, contact_email, attendee_id) VALUES (?,?,?,?)').bind(attendee.event_id, attendee.company || '', attendee.email || '', id).run()
        }
      }
    }
  }

  return c.json({ success: true })
})

app.delete('/api/admin/attendees/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM attendees WHERE id=?').bind(id).run()
  return c.json({ success: true })
})

// Admin: Add single attendee
app.post('/api/admin/attendees', async (c) => {
  const body = await c.req.json()
  const { event_id, name, email, company, job_title, bio, interests, linkedin_url, twitter_url, website_url, mobile, lunch_inclusion, role, badge_type, arrival_time, city, country, registration_date, payment_amount } = body
  if (!name || !email) return c.json({ error: 'Name and email are required' }, 400)
  const normalizedEmail = email.trim().toLowerCase()

  try {
    const result = await c.env.DB.prepare(
      'INSERT INTO attendees (event_id, name, email, company, job_title, bio, interests, linkedin_url, twitter_url, website_url, mobile, lunch_inclusion, role, badge_type, arrival_time, city, country, registration_date, payment_amount, is_online) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)'
    ).bind(event_id, name.trim(), normalizedEmail, company || '', job_title || '', bio || '', interests || '', linkedin_url || '', twitter_url || '', website_url || '', mobile || '', lunch_inclusion || 'Yes', role || 'attendee', badge_type || 'Delegate', arrival_time || '', city || '', country || '', registration_date || '', payment_amount || '').run()

    const attendee = await c.env.DB.prepare('SELECT * FROM attendees WHERE id = ?').bind(result.meta.last_row_id).first()

    // Auto-create exhibitor if badge is exhibitor-related
    const exhibitorBadges = ['exhibitor', 'exhibitor booth', 'exhibition speaker']
    if (exhibitorBadges.some(b => (badge_type || '').toLowerCase().includes(b))) {
      await c.env.DB.prepare(
        'INSERT INTO exhibitors (event_id, company_name, contact_email, attendee_id) VALUES (?,?,?,?)'
      ).bind(event_id, company || name.trim(), normalizedEmail, result.meta.last_row_id).run()
    }

    return c.json(attendee, 201)
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) {
      return c.json({ error: 'An attendee with this email already exists' }, 409)
    }
    return c.json({ error: 'Failed to add attendee: ' + e.message }, 400)
  }
})

// Admin: Bulk upload attendees (receives parsed JSON array from frontend)
app.post('/api/admin/attendees/bulk', async (c) => {
  const { event_id, attendees } = await c.req.json()
  if (!Array.isArray(attendees) || attendees.length === 0) {
    return c.json({ error: 'No attendees data provided' }, 400)
  }
  if (attendees.length > 500) {
    return c.json({ error: 'Maximum 500 attendees per upload' }, 400)
  }

  const results = { imported: 0, skipped: 0, errors: [] as string[] }

  for (const a of attendees) {
    if (!a.name || !a.email) {
      results.errors.push(`Row missing name or email: ${a.name || '?'} / ${a.email || '?'}`)
      results.skipped++
      continue
    }
    const email = a.email.trim().toLowerCase()
    try {
      await c.env.DB.prepare(
        'INSERT INTO attendees (event_id, name, email, company, job_title, bio, interests, linkedin_url, mobile, lunch_inclusion, role, badge_type, is_online) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)'
      ).bind(
        event_id,
        a.name.trim(),
        email,
        a.company?.trim() || '',
        a.job_title?.trim() || '',
        a.bio?.trim() || '',
        a.interests?.trim() || '',
        a.linkedin_url?.trim() || '',
        a.mobile?.trim() || '',
        a.lunch_inclusion?.trim() || 'Yes',
        a.role?.trim() || 'attendee',
        a.badge_type?.trim() || 'Delegate'
      ).run()
      results.imported++
    } catch (e: any) {
      if (e.message?.includes('UNIQUE')) {
        results.errors.push(`Duplicate email: ${email}`)
        results.skipped++
      } else {
        results.errors.push(`Failed to import ${a.name}: ${e.message}`)
        results.skipped++
      }
    }
  }

  return c.json(results)
})

// Admin: Download attendees as CSV
app.get('/api/admin/events/:id/attendees/export', async (c) => {
  const eventId = c.req.param('id')
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, email, company, job_title, bio, interests, linkedin_url, mobile, lunch_inclusion, arrival_time, role, badge_type, is_online, notified_at, last_login_at, pass_downloaded_at, rsvp_status, rsvp_at, created_at FROM attendees WHERE event_id = ? ORDER BY id'
  ).bind(eventId).all()

  const headers = ['name', 'email', 'company', 'job_title', 'mobile', 'city', 'country', 'linkedin_url', 'lunch_inclusion', 'arrival_time', 'bio', 'interests', 'role', 'badge_type', 'registration_date', 'payment_amount', 'rsvp_status', 'rsvp_at', 'notified_at', 'last_login_at', 'pass_downloaded_at']
  const csvRows = [headers.join(',')]
  for (const r of results as any[]) {
    const row = headers.map(h => {
      const val = (r[h] || '').toString().replace(/"/g, '""')
      return val.includes(',') || val.includes('"') || val.includes('\\n') ? `"${val}"` : val
    })
    csvRows.push(row.join(','))
  }

  return new Response(csvRows.join('\\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="attendees_export.csv"'
    }
  })
})

// Admin: CRUD exhibitors
app.post('/api/admin/exhibitors', async (c) => {
  const b = await c.req.json()
  const result = await c.env.DB.prepare(
    'INSERT INTO exhibitors (event_id, company_name, description, booth_number, booth_size, category, website_url, contact_email, contact_phone, products) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).bind(b.event_id, b.company_name, b.description||'', b.booth_number||'', b.booth_size||'standard', b.category||'', b.website_url||'', b.contact_email||'', b.contact_phone||'', b.products||'').run()
  return c.json({ id: result.meta.last_row_id, success: true }, 201)
})

app.put('/api/admin/exhibitors/:id', async (c) => {
  const id = c.req.param('id')
  const b = await c.req.json()
  await c.env.DB.prepare(
    'UPDATE exhibitors SET company_name=?, description=?, booth_number=?, booth_size=?, category=?, website_url=?, contact_email=?, contact_phone=?, products=? WHERE id=?'
  ).bind(b.company_name, b.description||'', b.booth_number||'', b.booth_size||'standard', b.category||'', b.website_url||'', b.contact_email||'', b.contact_phone||'', b.products||'', id).run()
  return c.json({ success: true })
})

app.delete('/api/admin/exhibitors/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM exhibitors WHERE id=?').bind(id).run()
  return c.json({ success: true })
})

// Admin: Sync exhibitors from attendees with exhibitor badge types
app.post('/api/admin/exhibitors/sync', async (c) => {
  const { event_id } = await c.req.json()
  // Find attendees with exhibitor-related badges who don't have an exhibitor entry yet
  const { results: attendees } = await c.env.DB.prepare(
    `SELECT a.id, a.name, a.email, a.company, a.event_id FROM attendees a
     WHERE a.event_id = ? AND (
       LOWER(a.badge_type) LIKE '%exhibitor%' OR LOWER(a.badge_type) LIKE '%exhibition%'
     ) AND NOT EXISTS (
       SELECT 1 FROM exhibitors e WHERE e.attendee_id = a.id
     )`
  ).bind(event_id).all()

  let created = 0
  for (const a of attendees as any[]) {
    await c.env.DB.prepare(
      'INSERT INTO exhibitors (event_id, company_name, contact_email, attendee_id) VALUES (?,?,?,?)'
    ).bind(a.event_id, a.company || 'TBD', a.email || '', a.id).run()
    created++
  }

  return c.json({ success: true, created, message: `${created} exhibitor(s) created from attendees` })
})

// Admin: Send notification email to attendee
app.post('/api/admin/attendees/:id/notify', async (c) => {
  const id = c.req.param('id')
  const attendee = await c.env.DB.prepare('SELECT * FROM attendees WHERE id = ?').bind(id).first() as any
  if (!attendee) return c.json({ error: 'Attendee not found' }, 404)
  if (!attendee.email) return c.json({ error: 'Attendee has no email' }, 400)

  const event = await c.env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(attendee.event_id).first() as any

  // Use stored app_url setting, or fall back to production domain, or derive from request
  const appUrlRow = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'app_url'").first() as any
  const appUrl = appUrlRow?.value || 'https://bharataiinnovation.com/app'

  const passUrl = `${appUrl}?email=${encodeURIComponent(attendee.email)}&action=download-pass`

  const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    <!-- Supported by MeitY -->
    <div style="text-align:center;margin-bottom:8px;">
      <p style="margin:0 0 6px;color:#888;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Supported by</p>
      <img src="https://bharataiinnovation.com/wp-content/uploads/2026/02/Meity-logo.png" alt="Ministry of Electronics and Information Technology" style="height:60px;max-width:280px;">
    </div>
    <!-- BHAI Logo -->
    <div style="text-align:center;margin-bottom:12px;">
      <img src="https://bharataiinnovation.com/images/Bharat%20AI%20Innovation%20Logo.png" alt="Bharat AI Innovation" style="height:70px;max-width:240px;">
    </div>
    <!-- Header Banner -->
    <div style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);border-radius:16px;padding:32px 24px;text-align:center;color:white;">
      <h1 style="margin:0 0 6px;font-size:24px;">Bharat AI Innovation Conference & Exhibition 2026</h1>
      <p style="margin:0;opacity:0.8;font-size:14px;">20-21 Nov 2026 &bull; World Trade Center, Mumbai</p>
    </div>
    <!-- Main Content -->
    <div style="background:white;border-radius:16px;padding:30px;margin-top:16px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
      <h2 style="margin:0 0 16px;color:#1a1a2e;font-size:22px;">Dear ${attendee.name},</h2>
      <p style="color:#555;line-height:1.6;margin:0 0 16px;">
        Your account for the <strong>Bharat AI Innovation 2026</strong> has been created. You are now registered as an official <strong>Delegate</strong> for the event. On 20-21 Nov 2026, we gather to recognise innovators and their innovations that are creating meaningful impact in our lives, our society, our nation, and the business ecosystem.
      </p>
      <div style="background:#f8f9fa;border-left:4px solid #1a1a2e;border-radius:0 8px 8px 0;padding:16px 20px;margin:0 0 20px;">
        <p style="color:#1a1a2e;font-weight:bold;margin:0 0 6px;font-size:15px;">Event Details</p>
        <p style="color:#555;line-height:1.6;margin:0;font-size:14px;">
          <strong>Date:</strong> 20-21 Nov 2026<br>
          <strong>Venue:</strong> World Trade Center, Mumbai
        </p>
      </div>
      <!-- Delegate Pass Section -->
      <div style="background:linear-gradient(135deg,#f0f4ff,#e8eeff);border:1px solid #c7d2fe;border-radius:12px;padding:20px;margin:20px 0;text-align:center;">
        <h3 style="margin:0 0 10px;color:#1a1a2e;font-size:18px;">🎟️ Your Delegate Pass</h3>
        <p style="color:#555;line-height:1.6;margin:0 0 16px;font-size:14px;">
          You can download your Delegate Pass from the networking app.<br>Please keep it handy for smooth entry at the venue.
        </p>
        <a href="${passUrl}" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#22c55e,#16a34a);color:white;text-decoration:none;border-radius:10px;font-weight:bold;font-size:14px;">
          Download Delegate Pass &rarr;
        </a>
      </div>
      <!-- Arrival Time Section -->
      <div style="background:#f8f9fa;border-radius:12px;padding:20px;margin:20px 0;">
        <h3 style="margin:0 0 10px;color:#1a1a2e;font-size:16px;">⏰ Please Update Your Arrival Time</h3>
        <p style="color:#555;line-height:1.6;margin:0;font-size:14px;">
          To help us plan event logistics, kindly update your <strong>expected arrival time</strong> in the app.
        </p>
      </div>
      <!-- RSVP Section -->
      <div style="background:linear-gradient(135deg,#fef9e7,#fdf2d6);border:1px solid #f0d48a;border-radius:12px;padding:24px;margin:20px 0;text-align:center;">
        <h3 style="margin:0 0 6px;color:#1a1a2e;font-size:18px;">📋 Confirm Your Attendance</h3>
        <p style="color:#555;line-height:1.6;margin:0 0 18px;font-size:14px;">
          Will you be attending the event on <strong>20-21 Nov 2026</strong>?
        </p>
        <table cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
          <tr>
            <td style="padding:0 6px;">
              <a href="${appUrl}/api/rsvp?email=${encodeURIComponent(attendee.email)}&status=confirmed&event=${attendee.event_id}" style="display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#22c55e,#16a34a);color:white;text-decoration:none;border-radius:10px;font-weight:bold;font-size:13px;">✅ Yes, I'll attend</a>
            </td>
            <td style="padding:0 6px;">
              <a href="${appUrl}/api/rsvp?email=${encodeURIComponent(attendee.email)}&status=maybe&event=${attendee.event_id}" style="display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#f59e0b,#d97706);color:white;text-decoration:none;border-radius:10px;font-weight:bold;font-size:13px;">🤔 Maybe</a>
            </td>
            <td style="padding:0 6px;">
              <a href="${appUrl}/api/rsvp?email=${encodeURIComponent(attendee.email)}&status=declined&event=${attendee.event_id}" style="display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#ef4444,#dc2626);color:white;text-decoration:none;border-radius:10px;font-weight:bold;font-size:13px;">❌ Can't make it</a>
            </td>
          </tr>
        </table>
      </div>
      <!-- CTA Button -->
      <div style="text-align:center;margin:24px 0;">
        <a href="${appUrl}?email=${encodeURIComponent(attendee.email)}" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#6366f1,#4f46e5);color:white;text-decoration:none;border-radius:10px;font-weight:bold;font-size:15px;">
          Open Networking App &rarr;
        </a>
      </div>
      <!-- Login Details -->
      <div style="border-top:1px solid #eee;padding-top:16px;margin-top:20px;">
        <p style="color:#888;font-size:13px;margin:0 0 8px;"><strong>Your Login Details:</strong></p>
        <p style="color:#555;font-size:14px;margin:0;">
          Email: <strong>${attendee.email}</strong><br>
          Name: <strong>${attendee.name}</strong>
        </p>
      </div>
      <!-- Closing -->
      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #eee;">
        <p style="color:#555;line-height:1.6;margin:0 0 16px;">We look forward to welcoming you to the event.</p>
        <p style="color:#555;line-height:1.6;margin:0;">
          Regards,<br>
          <strong>Team Bharat AI Innovation</strong>
        </p>
      </div>
    </div>
    <!-- Partner Logos Footer -->
    <div style="text-align:center;margin-top:20px;padding:16px 0;">
      <table cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
        <tr>
          <td style="padding:0 10px;vertical-align:middle;"><img src="https://bharataiinnovation.com/wp-content/uploads/2026/02/Bharat-AI-Innovation-Expo-logo-scaled.png" alt="Bharat AI Innovation" style="height:40px;"></td>
          <td style="padding:0 10px;vertical-align:middle;"><img src="https://bharataiinnovation.com/wp-content/uploads/2025/10/Aegis_college_new1.png" alt="Aegis School of Business" style="height:40px;"></td>
          <td style="padding:0 10px;vertical-align:middle;"><img src="https://bharataiinnovation.com/wp-content/uploads/2023/12/Assessfy-black.png" alt="Assessfy" style="height:35px;"></td>
          <td style="padding:0 10px;vertical-align:middle;"><img src="https://bharataiinnovation.com/wp-content/uploads/2019/06/tcoei.png" alt="TCOEI" style="height:40px;"></td>
          <td style="padding:0 10px;vertical-align:middle;"><img src="https://bharataiinnovation.com/wp-content/uploads/2025/10/Swissnex-red-logo_76ea13ce5cec9e3d897b76c6abe4779f-400x120.png" alt="Swissnex" style="height:35px;"></td>
        </tr>
      </table>
    </div>
    <p style="text-align:center;color:#999;font-size:12px;margin-top:8px;">
      Bharat AI Innovation Conference & Exhibition 2026 &bull; World Trade Center, Mumbai &bull; 20-21 Nov 2026
    </p>
  </div>
</body>
</html>`

  // Try Elastic Email API v4 (stored in D1 settings)
  const apiKeyRow = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'elastic_email_api_key'").first() as any
  const senderRow = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'sender_email'").first() as any
  const senderNameRow = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'sender_name'").first() as any

  if (apiKeyRow?.value) {
    const fromEmail = senderRow?.value || 'delegates@bharataiinnovation.com'
    const fromName = senderNameRow?.value || 'Bharat AI Innovation Conference & Exhibition 2026'
    try {
      const payload = {
        Recipients: { To: [attendee.email] },
        Content: {
          Body: [
            { ContentType: "HTML", Content: emailHtml, Charset: "utf-8" }
          ],
          From: `${fromName} <${fromEmail}>`,
          Subject: 'Your Delegate Pass for Bharat AI Innovation 2026'
        },
        Options: {
          TrackClicks: false,
          TrackOpens: false
        }
      }
      const res = await fetch('https://api.elasticemail.com/v4/emails/transactional', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-ElasticEmail-ApiKey': apiKeyRow.value
        },
        body: JSON.stringify(payload)
      })
      const result = await res.json() as any
      if (res.ok && !result.Error) {
        await c.env.DB.prepare('UPDATE attendees SET notified_at = datetime("now") WHERE id = ?').bind(id).run()
        return c.json({ success: true, method: 'elastic_email', email: attendee.email, messageId: result.MessageID || result.TransactionID })
      } else {
        const errMsg = result.Error || result.error || JSON.stringify(result)
        return c.json({ error: 'Elastic Email: ' + errMsg, method: 'elastic_email' }, 400)
      }
    } catch (e: any) {
      return c.json({ error: 'Elastic Email connection error: ' + e.message, method: 'elastic_email' }, 500)
    }
  }

  // Fallback: return mailto data for client-side email
  await c.env.DB.prepare('UPDATE attendees SET notified_at = datetime("now") WHERE id = ?').bind(id).run()
  return c.json({
    success: true,
    method: 'mailto',
    email: attendee.email,
    subject: 'Your Delegate Pass for Bharat AI Innovation 2026',
    body: `Dear ${attendee.name},\n\nYour account for the Bharat AI Innovation Conference & Exhibition 2026 has been created. You are now registered as an official Delegate for India's largest AI conference.\n\nEvent Details:\nDate: 20-21 Nov 2026\nVenue: World Trade Center, Mumbai, Cuffe Parade\n\n🎟️ Your Delegate Pass\nDownload your Delegate Pass: ${passUrl}\nPlease keep it handy for smooth entry at the venue.\n\n⏰ Please update your expected arrival time to help us plan event logistics.\n\nOpen the networking app: ${appUrl}?email=${encodeURIComponent(attendee.email)}\n\nYour Login Details:\nEmail: ${attendee.email}\nName: ${attendee.name}\n\nWe look forward to welcoming you in Mumbai!\n\nRegards,\nTeam Bharat AI Innovation`,
  })
})

// Admin: Bulk notify all un-notified attendees
app.post('/api/admin/attendees/notify-all', async (c) => {
  const { event_id } = await c.req.json()
  const { results: unnotified } = await c.env.DB.prepare(
    'SELECT id, name, email FROM attendees WHERE event_id = ? AND notified_at IS NULL AND email IS NOT NULL AND email != ""'
  ).bind(event_id).all()
  return c.json({ attendees: unnotified, count: unnotified.length })
})

// Admin: Resend email to RSVP non-responders (notified but no RSVP)
app.post('/api/admin/attendees/resend-non-responders', async (c) => {
  const { event_id } = await c.req.json()
  const { results: nonResponders } = await c.env.DB.prepare(
    'SELECT id, name, email FROM attendees WHERE event_id = ? AND notified_at IS NOT NULL AND (rsvp_status IS NULL) AND email IS NOT NULL AND email != ""'
  ).bind(event_id).all()
  return c.json({ attendees: nonResponders, count: nonResponders.length })
})

// Admin: Get list of all attendees with email for thank-you campaign
app.post('/api/admin/attendees/thankyou-list', async (c) => {
  const { event_id } = await c.req.json()
  const { results: attendees } = await c.env.DB.prepare(
    'SELECT id, name, email FROM attendees WHERE event_id = ? AND email IS NOT NULL AND email != ""'
  ).bind(event_id).all()
  return c.json({ attendees, count: attendees.length })
})

// Admin: Send post-ceremony thank-you email to a specific attendee
app.post('/api/admin/attendees/:id/send-thankyou', async (c) => {
  const id = c.req.param('id')
  const attendee = await c.env.DB.prepare('SELECT * FROM attendees WHERE id = ?').bind(id).first() as any
  if (!attendee) return c.json({ error: 'Attendee not found' }, 404)
  if (!attendee.email) return c.json({ error: 'Attendee has no email' }, 400)

  const appUrlRow = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'app_url'").first() as any
  const appUrl = appUrlRow?.value || 'https://bharataiinnovation.com/app'
  const photosUrl = 'https://drive.google.com/drive/folders/14YkEgPMjXIJ2JYNYmgxmBOH6g2TL1-FM?usp=sharing'

  const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    <!-- Supported by MeitY -->
    <div style="text-align:center;margin-bottom:8px;">
      <p style="margin:0 0 6px;color:#888;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Supported by</p>
      <img src="https://bharataiinnovation.com/wp-content/uploads/2026/02/Meity-logo.png" alt="Ministry of Electronics and Information Technology" style="height:60px;max-width:280px;">
    </div>
    <!-- BHAI Logo -->
    <div style="text-align:center;margin-bottom:12px;">
      <img src="https://bharataiinnovation.com/images/Bharat%20AI%20Innovation%20Logo.png" alt="Bharat AI Innovation" style="height:70px;max-width:240px;">
    </div>
    <!-- Header Banner -->
    <div style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);border-radius:16px;padding:32px 24px;text-align:center;color:white;">
      <h1 style="margin:0 0 6px;font-size:24px;">Confirm Your Attendance!</h1>
      <p style="margin:0;opacity:0.8;font-size:14px;">Bharat AI Innovation Conference & Exhibition 2026 &bull; 20-21 Nov 2026</p>
    </div>
    <!-- Main Content -->
    <div style="background:white;border-radius:16px;padding:30px;margin-top:16px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
      <h2 style="margin:0 0 16px;color:#1a1a2e;font-size:22px;">Dear ${attendee.name},</h2>
      <p style="color:#555;line-height:1.7;margin:0 0 16px;">
        We are truly grateful for your presence at the <strong>Bharat AI Innovation Conference & Exhibition 2026</strong> ceremony held on <strong>20-21 Nov 2026</strong> at <strong>World Trade Center Mumbai, Mumbai</strong>. Your participation and support played a vital role in making this event a resounding success.
      </p>
      <p style="color:#555;line-height:1.7;margin:0 0 20px;">
        It was a memorable evening celebrating innovation, technology, and the exceptional contributions of individuals and organizations driving meaningful change across industries and society.
      </p>

      <!-- Congratulations Section -->
      <div style="background:linear-gradient(135deg,#fef9e7,#fdf2d6);border:1px solid #f0d48a;border-radius:12px;padding:24px;margin:20px 0;">
        <h3 style="margin:0 0 14px;color:#1a1a2e;font-size:18px;text-align:center;">&#127942; Congratulations!</h3>
        <p style="color:#555;line-height:1.7;margin:0 0 12px;">
          We extend our heartfelt congratulations to all the:
        </p>
        <table cellpadding="0" cellspacing="0" border="0" style="width:100%;">
          <tr>
            <td style="padding:8px 12px;vertical-align:top;">
              <div style="background-color:#ecfdf5;border:1px solid #86efac;border-radius:10px;padding:16px;text-align:center;">
                <div style="font-size:28px;margin-bottom:6px;">&#127942;</div>
                <div style="font-weight:bold;color:#166534;font-size:14px;">AI Innovation Leaders</div>
                <div style="color:#555;font-size:12px;margin-top:4px;">Outstanding innovation &amp; impact</div>
              </div>
            </td>
            <td style="padding:8px 12px;vertical-align:top;">
              <div style="background-color:#eef2ff;border:1px solid #a5b4fc;border-radius:10px;padding:16px;text-align:center;">
                <div style="font-size:28px;margin-bottom:6px;">&#11088;</div>
                <div style="font-weight:bold;color:#3730a3;font-size:14px;">Finalists</div>
                <div style="color:#555;font-size:12px;margin-top:4px;">Exceptional shortlisted entries</div>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 12px;vertical-align:top;">
              <div style="background-color:#fffbeb;border:1px solid #fbbf24;border-radius:10px;padding:16px;text-align:center;">
                <div style="font-size:28px;margin-bottom:6px;">&#128161;</div>
                <div style="font-weight:bold;color:#92400e;font-size:14px;">AI Innovation Star</div>
                <div style="color:#555;font-size:12px;margin-top:4px;">Certified innovators shaping the future</div>
              </div>
            </td>
            <td style="padding:8px 12px;vertical-align:top;">
              <div style="background-color:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:16px;text-align:center;">
                <div style="font-size:28px;margin-bottom:6px;">&#128640;</div>
                <div style="font-weight:bold;color:#991b1b;font-size:14px;">NTH Winners</div>
                <div style="color:#555;font-size:12px;margin-top:4px;">Next-gen tech heroes leading change</div>
              </div>
            </td>
          </tr>
        </table>
        <p style="color:#555;line-height:1.7;margin:16px 0 0;text-align:center;font-size:14px;">
          Your achievements inspire the entire innovation ecosystem. We are proud to honour your contributions!
        </p>
      </div>

      <!-- Event Photos Section -->
      <div style="background:linear-gradient(135deg,#f0f4ff,#e8eeff);border:1px solid #c7d2fe;border-radius:12px;padding:24px;margin:20px 0;text-align:center;">
        <h3 style="margin:0 0 10px;color:#1a1a2e;font-size:18px;">&#128247; Event Photos &amp; Memories</h3>
        <p style="color:#555;line-height:1.6;margin:0 0 18px;font-size:14px;">
          Relive the wonderful moments from the ceremony! Access and download all event photographs from our shared gallery.
        </p>
        <a href="${photosUrl}" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#6366f1,#4f46e5);color:white;text-decoration:none;border-radius:10px;font-weight:bold;font-size:15px;">
          &#128247; View Event Photos &rarr;
        </a>
        <p style="color:#888;font-size:12px;margin:12px 0 0;">
          Photos are hosted on Google Drive. Click to open the gallery.
        </p>
      </div>

      <!-- Stay Connected -->
      <div style="background:#f8f9fa;border-left:4px solid #1a1a2e;border-radius:0 8px 8px 0;padding:16px 20px;margin:0 0 20px;">
        <p style="color:#1a1a2e;font-weight:bold;margin:0 0 6px;font-size:15px;">Stay Connected</p>
        <p style="color:#555;line-height:1.6;margin:0;font-size:14px;">
          The networking app remains active for you to connect with fellow delegates, share insights, and continue the conversations started at the event.
        </p>
      </div>

      <!-- CTA Button -->
      <div style="text-align:center;margin:24px 0;">
        <a href="${appUrl}?email=${encodeURIComponent(attendee.email)}" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#22c55e,#16a34a);color:white;text-decoration:none;border-radius:10px;font-weight:bold;font-size:15px;">
          Open Networking App &rarr;
        </a>
      </div>

      <!-- Closing -->
      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #eee;">
        <p style="color:#555;line-height:1.7;margin:0 0 16px;">
          Once again, thank you for being a part of the <strong>Bharat AI Innovation 2026</strong>. We look forward to welcoming you again at the <a href="https://bharataiinnovation.com/" style="color:#4f46e5;font-weight:bold;text-decoration:underline;">next edition of Bharat AI Innovation</a> &amp; <a href="https://bharataiinnovation.com/" style="color:#4f46e5;font-weight:bold;text-decoration:underline;">Bharat AI Innovations</a>!
        </p>
        <p style="color:#555;line-height:1.6;margin:0;">
          With warm regards,<br>
          <strong>Team Bharat AI Innovation</strong><br>
          <span style="font-size:13px;color:#888;">Bharat AI Innovation</span>
        </p>
      </div>
    </div>
    <!-- Partner Logos Footer -->
    <div style="text-align:center;margin-top:20px;padding:16px 0;">
      <table cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
        <tr>
          <td style="padding:0 10px;vertical-align:middle;"><img src="https://bharataiinnovation.com/wp-content/uploads/2026/02/Bharat-AI-Innovation-Expo-logo-scaled.png" alt="Bharat AI Innovation" style="height:40px;"></td>
          <td style="padding:0 10px;vertical-align:middle;"><img src="https://bharataiinnovation.com/wp-content/uploads/2025/10/Aegis_college_new1.png" alt="Aegis School of Business" style="height:40px;"></td>
          <td style="padding:0 10px;vertical-align:middle;"><img src="https://bharataiinnovation.com/wp-content/uploads/2023/12/Assessfy-black.png" alt="Assessfy" style="height:35px;"></td>
          <td style="padding:0 10px;vertical-align:middle;"><img src="https://bharataiinnovation.com/wp-content/uploads/2019/06/tcoei.png" alt="TCOEI" style="height:40px;"></td>
          <td style="padding:0 10px;vertical-align:middle;"><img src="https://bharataiinnovation.com/wp-content/uploads/2025/10/Swissnex-red-logo_76ea13ce5cec9e3d897b76c6abe4779f-400x120.png" alt="Swissnex" style="height:35px;"></td>
        </tr>
      </table>
    </div>
    <p style="text-align:center;color:#999;font-size:12px;margin-top:8px;">
      Bharat AI Innovation Conference & Exhibition 2026 &bull; World Trade Center Mumbai, Mumbai &bull; 20-21 Nov 2026
    </p>
  </div>
</body>
</html>`

  // Send via Elastic Email
  const apiKeyRow = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'elastic_email_api_key'").first() as any
  const senderRow = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'sender_email'").first() as any
  const senderNameRow = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'sender_name'").first() as any

  if (apiKeyRow?.value) {
    const fromEmail = senderRow?.value || 'delegates@bharataiinnovation.com'
    const fromName = senderNameRow?.value || 'Bharat AI Innovation Conference & Exhibition 2026'
    try {
      const payload = {
        Recipients: { To: [attendee.email] },
        Content: {
          Body: [
            { ContentType: "HTML", Content: emailHtml, Charset: "utf-8" }
          ],
          From: `${fromName} <${fromEmail}>`,
          Subject: 'Thank You for Making the Bharat AI Innovation 2026 a Grand Success! \u{1F3C6}'
        },
        Options: {
          TrackClicks: false,
          TrackOpens: false
        }
      }
      const res = await fetch('https://api.elasticemail.com/v4/emails/transactional', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-ElasticEmail-ApiKey': apiKeyRow.value
        },
        body: JSON.stringify(payload)
      })
      const result = await res.json() as any
      if (res.ok && !result.Error) {
        return c.json({ success: true, method: 'elastic_email', email: attendee.email, messageId: result.MessageID || result.TransactionID })
      } else {
        const errMsg = result.Error || result.error || JSON.stringify(result)
        return c.json({ error: 'Elastic Email: ' + errMsg, method: 'elastic_email' }, 400)
      }
    } catch (e: any) {
      return c.json({ error: 'Elastic Email connection error: ' + e.message, method: 'elastic_email' }, 500)
    }
  }

  return c.json({ error: 'No Elastic Email API key configured. Please set it in Settings.' }, 400)
})

// ============ INNOVATION TALKS API ============
// Get all innovation talks for an event
app.get('/api/events/:id/innovation-talks', async (c) => {
  const eventId = c.req.param('id')
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM innovation_talks WHERE event_id = ? ORDER BY slot_no ASC'
  ).bind(eventId).all()
  return c.json(results)
})

// Create a new innovation talk
app.post('/api/admin/innovation-talks', async (c) => {
  const body = await c.req.json() as any
  const { event_id, slot_no, session_type, time_slot, speaker_name, company, topic, status, notes } = body
  const result = await c.env.DB.prepare(
    'INSERT INTO innovation_talks (event_id, slot_no, session_type, time_slot, speaker_name, company, topic, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(event_id || 1, slot_no, session_type || 'Morning', time_slot, speaker_name, company || '', topic || '', status || 'confirmed', notes || '').run()
  return c.json({ success: true, id: result.meta.last_row_id })
})

// Update an innovation talk
app.patch('/api/admin/innovation-talks/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json() as any
  const allowedFields = ['slot_no', 'session_type', 'time_slot', 'speaker_name', 'company', 'topic', 'status', 'notes']
  const updates: string[] = []
  const values: any[] = []
  for (const [key, val] of Object.entries(body)) {
    if (allowedFields.includes(key)) {
      updates.push(`${key} = ?`)
      values.push(val)
    }
  }
  if (updates.length === 0) return c.json({ error: 'No valid fields' }, 400)
  values.push(id)
  await c.env.DB.prepare(`UPDATE innovation_talks SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run()
  return c.json({ success: true })
})

// Delete an innovation talk
app.delete('/api/admin/innovation-talks/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM innovation_talks WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

// Reorder innovation talks (update slot numbers)
app.post('/api/admin/innovation-talks/reorder', async (c) => {
  const body = await c.req.json() as any
  const { orders } = body // [{id, slot_no}]
  for (const o of orders) {
    await c.env.DB.prepare('UPDATE innovation_talks SET slot_no = ? WHERE id = ?').bind(o.slot_no, o.id).run()
  }
  return c.json({ success: true })
})

// Admin: Find suspected duplicate attendees
app.get('/api/admin/events/:id/attendees/duplicates', async (c) => {
  const eventId = c.req.param('id')
  const { results: attendees } = await c.env.DB.prepare(
    'SELECT id, name, email, company, job_title, badge_type, mobile, rsvp_status, notified_at, last_login_at FROM attendees WHERE event_id = ? ORDER BY name'
  ).bind(eventId).all() as any

  // Normalize name for comparison: lowercase, remove titles, trim
  function normalizeName(name: string): string {
    return name.toLowerCase()
      .replace(/^(dr\.?|prof\.?|mr\.?|mrs\.?|ms\.?|lt\.?\s*gen\.?|col\.?|shri\.?)\s*/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  // Extract first+last name tokens
  function nameTokens(name: string): string[] {
    return normalizeName(name).split(' ').filter(t => t.length > 1)
  }

  // Calculate similarity between two names
  function nameSimilarity(a: string, b: string): number {
    const tokA = nameTokens(a)
    const tokB = nameTokens(b)
    if (tokA.length === 0 || tokB.length === 0) return 0

    // Check exact normalized match
    if (normalizeName(a) === normalizeName(b)) return 1.0

    // Check token overlap
    const setA = new Set(tokA)
    const setB = new Set(tokB)
    let matches = 0
    for (const t of setA) {
      if (setB.has(t)) matches++
      else {
        // Check partial match (one contains the other)
        for (const tb of setB) {
          if (t.length >= 3 && tb.length >= 3 && (t.includes(tb) || tb.includes(t))) { matches += 0.7; break }
        }
      }
    }
    const maxLen = Math.max(setA.size, setB.size)
    return matches / maxLen
  }

  const groups: any[] = []
  const used = new Set<number>()

  for (let i = 0; i < attendees.length; i++) {
    if (used.has(attendees[i].id)) continue
    const dupes: any[] = []

    for (let j = i + 1; j < attendees.length; j++) {
      if (used.has(attendees[j].id)) continue

      const sim = nameSimilarity(attendees[i].name, attendees[j].name)

      // Also check if same mobile (non-empty)
      const sameMobile = attendees[i].mobile && attendees[j].mobile &&
        attendees[i].mobile.replace(/\D/g, '').slice(-10) === attendees[j].mobile.replace(/\D/g, '').slice(-10)

      if (sim >= 0.6 || sameMobile) {
        dupes.push({ ...attendees[j], similarity: Math.round(sim * 100) })
        used.add(attendees[j].id)
      }
    }

    if (dupes.length > 0) {
      used.add(attendees[i].id)
      groups.push({
        primary: attendees[i],
        duplicates: dupes,
        count: dupes.length + 1
      })
    }
  }

  // Sort by group size descending
  groups.sort((a: any, b: any) => b.count - a.count)

  return c.json({ groups, totalGroups: groups.length, totalDuplicates: groups.reduce((s: number, g: any) => s + g.duplicates.length, 0) })
})

// Admin: App Settings CRUD
app.get('/api/admin/settings', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT key, value FROM app_settings').all()
  const settings: Record<string, string> = {}
  for (const r of results as any[]) { settings[r.key] = r.value }
  return c.json(settings)
})

app.put('/api/admin/settings', async (c) => {
  const body = await c.req.json()
  for (const [key, value] of Object.entries(body)) {
    await c.env.DB.prepare(
      'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime("now")) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at'
    ).bind(key, value as string).run()
  }
  return c.json({ success: true })
})

app.post('/api/admin/settings/test-email', async (c) => {
  const { test_email } = await c.req.json()
  const apiKeyRow = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'elastic_email_api_key'").first() as any
  if (!apiKeyRow || !apiKeyRow.value) return c.json({ error: 'Elastic Email API key not configured' }, 400)

  const senderRow = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'sender_email'").first() as any
  const senderNameRow = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'sender_name'").first() as any
  const fromEmail = senderRow?.value || 'delegates@bharataiinnovation.com'
  const fromName = senderNameRow?.value || 'Bharat AI Innovation Conference & Exhibition 2026'

  try {
    const payload = {
      Recipients: { To: [test_email] },
      Content: {
        Body: [
          { ContentType: "HTML", Content: "<div style='font-family:Arial,sans-serif;max-width:600px;margin:0 auto;'><div style='background:linear-gradient(135deg,#1a1a2e,#0f3460);padding:30px;border-radius:12px;text-align:center;color:white;'><h1>Bharat AI Innovation Conference & Exhibition 2026</h1><p style='opacity:0.8'>Email Test Successful!</p></div><div style='background:white;padding:24px;border-radius:12px;margin-top:12px;'><h2 style='color:#1a1a2e'>Test Email</h2><p style='color:#555;line-height:1.6'>This is a test email from the Bharat AI Innovation Conference & Exhibition 2026 admin dashboard.</p><p style='color:#555;line-height:1.6'>If you received this, your Elastic Email integration is working correctly!</p><div style='background:#f0f4ff;padding:16px;border-radius:8px;margin-top:16px;'><p style='margin:0;color:#4c6ef5;font-size:14px'><strong>Sender:</strong> " + fromName + " &lt;" + fromEmail + "&gt;</p></div></div></div>", Charset: "utf-8" }
        ],
        From: `${fromName} <${fromEmail}>`,
        Subject: 'Test Email from Bharat AI Innovation Conference & Exhibition 2026 Admin'
      }
    }
    const res = await fetch('https://api.elasticemail.com/v4/emails/transactional', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ElasticEmail-ApiKey': apiKeyRow.value
      },
      body: JSON.stringify(payload)
    })
    const result = await res.json() as any
    if (res.ok && !result.Error) {
      return c.json({ success: true, message: `Test email sent to ${test_email}`, messageId: result.MessageID || result.TransactionID })
    } else {
      return c.json({ error: result.Error || result.error || 'Failed to send test email', detail: result }, 400)
    }
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Admin: Verify Elastic Email API key
app.post('/api/admin/settings/verify-key', async (c) => {
  const { api_key } = await c.req.json()
  if (!api_key) return c.json({ error: 'No API key provided' }, 400)

  try {
    // Test 1: Check if key can access account (security endpoint)
    const secRes = await fetch('https://api.elasticemail.com/v4/security/apikeys', {
      headers: { 'X-ElasticEmail-ApiKey': api_key }
    })
    const secData = await secRes.json() as any

    if (secData.Error === 'Access Denied.') {
      // Key might still work for sending only - try a different endpoint
      const emailsRes = await fetch('https://api.elasticemail.com/v4/emails/transactional', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-ElasticEmail-ApiKey': api_key
        },
        // Send with empty body to test permissions without actually sending
        body: JSON.stringify({
          Recipients: { To: ['test@test.com'] },
          Content: {
            Body: [{ ContentType: "HTML", Content: "test", Charset: "utf-8" }],
            From: "test@test.com",
            Subject: "test"
          }
        })
      })
      const emailData = await emailsRes.json() as any

      if (emailData.Error === 'Access Denied.') {
        return c.json({
          success: false,
          error: 'API key does NOT have email sending permissions.',
          hint: 'Your API key was created with restricted permissions. Please create a NEW API key in Elastic Email: Go to Settings → Manage API Keys → Create → select "Full Access" or ensure "Emails" permission is enabled. Then paste the new key here.'
        }, 400)
      } else {
        // Key has send permission but returned validation error (expected since From is not verified)
        return c.json({
          success: true,
          message: 'API key has email sending permissions! Make sure your sender email (delegates@bharataiinnovation.com) is verified in Elastic Email.',
          warning: 'Key has limited permissions - cannot list API keys, but CAN send emails.'
        })
      }
    }

    // Full access - key works for everything
    return c.json({ success: true, message: 'API key is valid with full access!' })
  } catch (e: any) {
    return c.json({ error: 'Connection error: ' + e.message }, 500)
  }
})

// Admin: Get lunch pack stats based on arrival time
app.get('/api/admin/events/:id/lunch-stats', async (c) => {
  const eventId = c.req.param('id')

  const totalLunch = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM attendees WHERE event_id = ? AND (lunch_inclusion = 'Yes' OR lunch_inclusion IS NULL)"
  ).bind(eventId).first() as any

  const withArrival = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM attendees WHERE event_id = ? AND arrival_time IS NOT NULL AND arrival_time != ''"
  ).bind(eventId).first() as any

  const beforeLunch = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM attendees WHERE event_id = ? AND arrival_time IS NOT NULL AND arrival_time != '' AND arrival_time <= '13:00' AND (lunch_inclusion = 'Yes' OR lunch_inclusion IS NULL)"
  ).bind(eventId).first() as any

  const afterLunch = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM attendees WHERE event_id = ? AND arrival_time IS NOT NULL AND arrival_time != '' AND arrival_time > '13:00' AND (lunch_inclusion = 'Yes' OR lunch_inclusion IS NULL)"
  ).bind(eventId).first() as any

  const noArrivalLunch = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM attendees WHERE event_id = ? AND (arrival_time IS NULL OR arrival_time = '') AND (lunch_inclusion = 'Yes' OR lunch_inclusion IS NULL)"
  ).bind(eventId).first() as any

  const notified = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM attendees WHERE event_id = ? AND notified_at IS NOT NULL"
  ).bind(eventId).first() as any

  const totalAttendees = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM attendees WHERE event_id = ?"
  ).bind(eventId).first() as any

  // Breakdown by time slot
  const timeSlots = await c.env.DB.prepare(
    `SELECT 
      CASE 
        WHEN arrival_time <= '10:00' THEN 'Before 10 AM'
        WHEN arrival_time <= '11:00' THEN '10-11 AM'
        WHEN arrival_time <= '12:00' THEN '11 AM-12 PM'
        WHEN arrival_time <= '13:00' THEN '12-1 PM'
        WHEN arrival_time <= '14:00' THEN '1-2 PM (Lunch)'
        ELSE 'After 2 PM'
      END as slot,
      COUNT(*) as count
    FROM attendees 
    WHERE event_id = ? AND arrival_time IS NOT NULL AND arrival_time != ''
    GROUP BY slot
    ORDER BY MIN(arrival_time)`
  ).bind(eventId).all()

  // Engagement tracking stats
  const loggedIn = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM attendees WHERE event_id = ? AND last_login_at IS NOT NULL"
  ).bind(eventId).first() as any

  const loggedInAfterNotify = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM attendees WHERE event_id = ? AND last_login_at IS NOT NULL AND notified_at IS NOT NULL AND last_login_at >= notified_at"
  ).bind(eventId).first() as any

  const passDownloaded = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM attendees WHERE event_id = ? AND pass_downloaded_at IS NOT NULL"
  ).bind(eventId).first() as any

  // RSVP stats
  const rsvpConfirmed = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM attendees WHERE event_id = ? AND rsvp_status = 'confirmed'"
  ).bind(eventId).first() as any
  const rsvpDeclined = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM attendees WHERE event_id = ? AND rsvp_status = 'declined'"
  ).bind(eventId).first() as any
  const rsvpMaybe = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM attendees WHERE event_id = ? AND rsvp_status = 'maybe'"
  ).bind(eventId).first() as any

  return c.json({
    totalAttendees: totalAttendees?.count || 0,
    totalLunchEligible: totalLunch?.count || 0,
    withArrivalTime: withArrival?.count || 0,
    arrivingBeforeLunch: beforeLunch?.count || 0,
    arrivingAfterLunch: afterLunch?.count || 0,
    noArrivalTimeLunch: noArrivalLunch?.count || 0,
    estimatedLunchPacks: (beforeLunch?.count || 0) + (noArrivalLunch?.count || 0),
    notifiedCount: notified?.count || 0,
    loggedInCount: loggedIn?.count || 0,
    loggedInAfterNotifyCount: loggedInAfterNotify?.count || 0,
    passDownloadedCount: passDownloaded?.count || 0,
    timeSlots: timeSlots.results,
    rsvpConfirmed: rsvpConfirmed?.count || 0,
    rsvpDeclined: rsvpDeclined?.count || 0,
    rsvpMaybe: rsvpMaybe?.count || 0,
    rsvpNoResponse: (totalAttendees?.count || 0) - (rsvpConfirmed?.count || 0) - (rsvpDeclined?.count || 0) - (rsvpMaybe?.count || 0),
  })
})

// Admin: CRUD award categories
app.post('/api/admin/award-categories', async (c) => {
  const b = await c.req.json()
  const result = await c.env.DB.prepare(
    'INSERT INTO award_categories (event_id, name, description, icon) VALUES (?,?,?,?)'
  ).bind(b.event_id, b.name, b.description||'', b.icon||'').run()
  return c.json({ id: result.meta.last_row_id, success: true }, 201)
})

app.put('/api/admin/award-categories/:id', async (c) => {
  const id = c.req.param('id')
  const b = await c.req.json()
  await c.env.DB.prepare(
    'UPDATE award_categories SET name=?, description=?, icon=? WHERE id=?'
  ).bind(b.name, b.description||'', b.icon||'', id).run()
  return c.json({ success: true })
})

app.delete('/api/admin/award-categories/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM award_nominees WHERE category_id=?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM award_categories WHERE id=?').bind(id).run()
  return c.json({ success: true })
})

// Admin: CRUD nominees
app.post('/api/admin/nominees', async (c) => {
  const b = await c.req.json()
  const result = await c.env.DB.prepare(
    'INSERT INTO award_nominees (category_id, event_id, name, description, company) VALUES (?,?,?,?,?)'
  ).bind(b.category_id, b.event_id, b.name, b.description||'', b.company||'').run()
  return c.json({ id: result.meta.last_row_id, success: true }, 201)
})

app.put('/api/admin/nominees/:id', async (c) => {
  const id = c.req.param('id')
  const b = await c.req.json()
  await c.env.DB.prepare(
    'UPDATE award_nominees SET name=?, description=?, company=?, is_winner=? WHERE id=?'
  ).bind(b.name, b.description||'', b.company||'', b.is_winner ? 1 : 0, id).run()
  return c.json({ success: true })
})

app.delete('/api/admin/nominees/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM award_nominees WHERE id=?').bind(id).run()
  return c.json({ success: true })
})

// Admin: CRUD announcements
app.post('/api/admin/announcements', async (c) => {
  const b = await c.req.json()
  const result = await c.env.DB.prepare(
    'INSERT INTO announcements (event_id, title, content, announcement_type, author_name, pinned) VALUES (?,?,?,?,?,?)'
  ).bind(b.event_id, b.title, b.content, b.announcement_type||'general', b.author_name||'Admin', b.pinned ? 1 : 0).run()
  return c.json({ id: result.meta.last_row_id, success: true }, 201)
})

app.put('/api/admin/announcements/:id', async (c) => {
  const id = c.req.param('id')
  const b = await c.req.json()
  await c.env.DB.prepare(
    'UPDATE announcements SET title=?, content=?, announcement_type=?, author_name=?, pinned=? WHERE id=?'
  ).bind(b.title, b.content, b.announcement_type||'general', b.author_name||'Admin', b.pinned ? 1 : 0, id).run()
  return c.json({ success: true })
})

app.delete('/api/admin/announcements/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM announcements WHERE id=?').bind(id).run()
  return c.json({ success: true })
})

// Admin: Advanced analytics
app.get('/api/admin/events/:id/analytics', async (c) => {
  const eventId = c.req.param('id')
  
  const attendeesByRole = await c.env.DB.prepare('SELECT role, COUNT(*) as count FROM attendees WHERE event_id=? GROUP BY role').bind(eventId).all()
  const attendeesByBadge = await c.env.DB.prepare('SELECT badge_type, COUNT(*) as count FROM attendees WHERE event_id=? GROUP BY badge_type').bind(eventId).all()
  const sessionsByType = await c.env.DB.prepare('SELECT session_type, COUNT(*) as count FROM sessions WHERE event_id=? GROUP BY session_type').bind(eventId).all()
  const sessionsByTrack = await c.env.DB.prepare('SELECT track, COUNT(*) as count FROM sessions WHERE event_id=? AND track IS NOT NULL GROUP BY track').bind(eventId).all()
  const connectionsByStatus = await c.env.DB.prepare('SELECT status, COUNT(*) as count FROM connections WHERE event_id=? GROUP BY status').bind(eventId).all()
  const meetingsByStatus = await c.env.DB.prepare('SELECT status, COUNT(*) as count FROM meetings WHERE event_id=? GROUP BY status').bind(eventId).all()
  const topExhibitors = await c.env.DB.prepare('SELECT company_name, visitor_count, booth_size FROM exhibitors WHERE event_id=? ORDER BY visitor_count DESC LIMIT 10').bind(eventId).all()
  const topNominees = await c.env.DB.prepare('SELECT n.name, n.company, c.name as category_name, n.is_winner FROM award_nominees n JOIN award_categories c ON n.category_id=c.id WHERE n.event_id=? ORDER BY n.is_winner DESC, n.name ASC LIMIT 10').bind(eventId).all()
  const messageCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM messages WHERE event_id=?').bind(eventId).first()
  const boothVisitCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM booth_visits WHERE event_id=?').bind(eventId).first()
  const exhibitorsByCategory = await c.env.DB.prepare('SELECT category, COUNT(*) as count FROM exhibitors WHERE event_id=? GROUP BY category').bind(eventId).all()
  const recentRegistrations = await c.env.DB.prepare('SELECT id, name, email, company, job_title, role, badge_type, created_at FROM attendees WHERE event_id=? ORDER BY created_at DESC LIMIT 10').bind(eventId).all()

  return c.json({
    attendeesByRole: attendeesByRole.results,
    attendeesByBadge: attendeesByBadge.results,
    sessionsByType: sessionsByType.results,
    sessionsByTrack: sessionsByTrack.results,
    connectionsByStatus: connectionsByStatus.results,
    meetingsByStatus: meetingsByStatus.results,
    topExhibitors: topExhibitors.results,
    topNominees: topNominees.results,
    messageCount: (messageCount as any)?.count || 0,
    boothVisitCount: (boothVisitCount as any)?.count || 0,
    exhibitorsByCategory: exhibitorsByCategory.results,
    recentRegistrations: recentRegistrations.results,
  })
})

// Admin: Bulk operations
app.post('/api/admin/events/:id/broadcast', async (c) => {
  const eventId = c.req.param('id')
  const { title, content, announcement_type, author_name } = await c.req.json()
  const result = await c.env.DB.prepare(
    'INSERT INTO announcements (event_id, title, content, announcement_type, author_name, pinned) VALUES (?,?,?,?,?,1)'
  ).bind(eventId, title, content, announcement_type || 'urgent', author_name || 'Event Admin').run()
  return c.json({ id: result.meta.last_row_id, success: true }, 201)
})

// ============ ADMIN STARTUP PITCH APIs ============

// Get all pitches (including inactive) for admin
app.get('/api/admin/startup-pitches', async (c) => {
  const eventId = c.req.query('event_id') || '1'
  const { results: pitches } = await c.env.DB.prepare(
    'SELECT * FROM startup_pitches WHERE event_id = ? ORDER BY slot_order ASC'
  ).bind(eventId).all()
  const { results: investors } = await c.env.DB.prepare(
    'SELECT * FROM startup_investors WHERE event_id = ? ORDER BY name ASC'
  ).bind(eventId).all()
  return c.json({ pitches, investors })
})

// Create pitch
app.post('/api/admin/startup-pitches', async (c) => {
  const body = await c.req.json() as any
  const { event_id, slot_order, time_slot, company, pitcher_name, pitcher_title, pitcher_profile } = body
  const result = await c.env.DB.prepare(
    'INSERT INTO startup_pitches (event_id, slot_order, time_slot, company, pitcher_name, pitcher_title, pitcher_profile) VALUES (?,?,?,?,?,?,?)'
  ).bind(event_id || 1, slot_order || 0, time_slot, company, pitcher_name, pitcher_title || '', pitcher_profile || '').run()
  return c.json({ id: result.meta.last_row_id, success: true }, 201)
})

// Update pitch
app.put('/api/admin/startup-pitches/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json() as any
  const { slot_order, time_slot, company, pitcher_name, pitcher_title, pitcher_profile, is_active } = body
  await c.env.DB.prepare(
    'UPDATE startup_pitches SET slot_order=?, time_slot=?, company=?, pitcher_name=?, pitcher_title=?, pitcher_profile=?, is_active=? WHERE id=?'
  ).bind(slot_order, time_slot, company, pitcher_name, pitcher_title || '', pitcher_profile || '', is_active ?? 1, id).run()
  return c.json({ success: true })
})

// Delete pitch
app.delete('/api/admin/startup-pitches/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM startup_pitches WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

// Create investor
app.post('/api/admin/startup-investors', async (c) => {
  const body = await c.req.json() as any
  const { event_id, name, title, company } = body
  const result = await c.env.DB.prepare(
    'INSERT INTO startup_investors (event_id, name, title, company) VALUES (?,?,?,?)'
  ).bind(event_id || 1, name, title || '', company || '').run()
  return c.json({ id: result.meta.last_row_id, success: true }, 201)
})

// Update investor
app.put('/api/admin/startup-investors/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json() as any
  const { name, title, company, is_active } = body
  await c.env.DB.prepare(
    'UPDATE startup_investors SET name=?, title=?, company=?, is_active=? WHERE id=?'
  ).bind(name, title || '', company || '', is_active ?? 1, id).run()
  return c.json({ success: true })
})

// Delete investor
app.delete('/api/admin/startup-investors/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM startup_investors WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

// ==================== INQUIRY APIs ====================

// Public: Submit an inquiry
app.post('/api/inquiries', async (c) => {
  const body = await c.req.json() as any
  const { inquiry_type, name, email, phone, organization, subject, message, metadata } = body

  if (!name || !email) return c.json({ error: 'Name and email are required' }, 400)
  if (!inquiry_type) return c.json({ error: 'Inquiry type is required' }, 400)

  const validTypes = ['general', 'exhibition', 'booth_inquiry', 'sponsorship', 'speaking', 'media', 'group_registration', 'other']
  if (!validTypes.includes(inquiry_type)) return c.json({ error: 'Invalid inquiry type' }, 400)

  const result = await c.env.DB.prepare(
    `INSERT INTO inquiries (event_id, inquiry_type, name, email, phone, organization, subject, message, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    1, inquiry_type, name.trim(), email.trim().toLowerCase(),
    phone || '', organization || '', subject || '', message || '',
    JSON.stringify(metadata || {})
  ).run()

  return c.json({ success: true, id: result.meta.last_row_id, message: 'Inquiry submitted successfully. We will get back to you soon!' }, 201)
})

// Admin: Get all inquiries with optional filters
app.get('/api/admin/inquiries', async (c) => {
  const type = c.req.query('type')
  const status = c.req.query('status')

  let query = 'SELECT * FROM inquiries WHERE event_id = 1'
  const params: any[] = []

  if (type) {
    query += ' AND inquiry_type = ?'
    params.push(type)
  }
  if (status) {
    query += ' AND status = ?'
    params.push(status)
  }
  query += ' ORDER BY created_at DESC'

  const { results } = await c.env.DB.prepare(query).bind(...params).all()

  // Also get counts by type
  const { results: typeCounts } = await c.env.DB.prepare(
    'SELECT inquiry_type, COUNT(*) as count FROM inquiries WHERE event_id = 1 GROUP BY inquiry_type'
  ).all()
  const { results: statusCounts } = await c.env.DB.prepare(
    'SELECT status, COUNT(*) as count FROM inquiries WHERE event_id = 1 GROUP BY status'
  ).all()

  return c.json({ inquiries: results, typeCounts, statusCounts })
})

// Admin: Update inquiry status/notes
app.patch('/api/admin/inquiries/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json() as any
  const { status, admin_notes } = body
  const updates: string[] = ['updated_at = datetime("now")']
  const values: any[] = []
  if (status) { updates.push('status = ?'); values.push(status) }
  if (admin_notes !== undefined) { updates.push('admin_notes = ?'); values.push(admin_notes) }
  values.push(id)
  await c.env.DB.prepare(`UPDATE inquiries SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run()
  return c.json({ success: true })
})

// Admin: Delete an inquiry
app.delete('/api/admin/inquiries/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM inquiries WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

// ==================== AI MARKETPLACE APIs ====================

const generateSlug = (text: string) =>
  (text || '').toLowerCase().trim().replace(/&/g,'and').replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,80)

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message)
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer)
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2,'0')).join('')
}

// Cookie helpers for marketplace auth.
// The session cookie is `<companyId>.<hmac>` — the id is HMAC-signed with the
// server secret so it can't be forged (previously it was a bare, guessable
// integer). Verification and signing mirror the helpers in routes/marketplace.ts.
function mpSecret(c: any): string {
  return c.env.MP_SESSION_SECRET || c.env.ADMIN_SECRET || ''
}
async function mpHmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}
function mpSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
async function signMpSession(c: any, companyId: number | string): Promise<string> {
  const id = String(companyId)
  return `${id}.${await mpHmacHex(mpSecret(c), id)}`
}
function mpCookie(value: string, maxAge = 604800): string {
  return `mp_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
}
// Returns the verified company id, or null for missing/unsigned/forged cookies.
async function getMpSession(c: any): Promise<number | null> {
  const cookie = c.req.header('Cookie') || ''
  const match = cookie.match(/mp_session=([^;]+)/)
  if (!match) return null
  const value = decodeURIComponent(match[1])
  const secret = mpSecret(c)
  if (!secret) return null
  const dot = value.lastIndexOf('.')
  if (dot < 1) return null // reject bare-id (legacy/forged) cookies
  const id = value.slice(0, dot)
  const sig = value.slice(dot + 1)
  if (!/^\d+$/.test(id)) return null
  if (!mpSafeEqual(sig, await mpHmacHex(secret, id))) return null
  return parseInt(id, 10)
}

// --- Auth ---
app.post('/api/mp/auth/register', async (c) => {
  const { company_name, email, password } = await c.req.json() as any
  if (!company_name || !email || !password) return c.json({ error: 'All fields required' }, 400)
  const hash = await sha256(password)
  try {
    await c.env.DB.prepare('INSERT INTO mp_companies (company_name, email, password_hash) VALUES (?,?,?)')
      .bind(company_name.trim(), email.trim().toLowerCase(), hash).run()
    return c.json({ success: true })
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) return c.json({ error: 'Email already registered' }, 409)
    throw e
  }
})

app.post('/api/mp/auth/login', async (c) => {
  const { email, password } = await c.req.json() as any
  if (!email || !password) return c.json({ error: 'Email and password required' }, 400)
  const hash = await sha256(password)
  const user = await c.env.DB.prepare('SELECT id, company_name, email, role FROM mp_companies WHERE email = ? AND password_hash = ?')
    .bind(email.trim().toLowerCase(), hash).first()
  if (!user) return c.json({ error: 'Invalid credentials' }, 401)
  return new Response(JSON.stringify({ success: true, user }), {
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': mpCookie(await signMpSession(c, user.id as number)) }
  })
})

app.post('/api/mp/auth/logout', (c) => {
  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': mpCookie('', 0) }
  })
})

app.get('/api/mp/auth/me', async (c) => {
  const userId = await getMpSession(c)
  if (!userId) return c.json({ user: null })
  const user = await c.env.DB.prepare('SELECT id, company_name, email, role, exhibitor_id, attendee_id FROM mp_companies WHERE id = ?').bind(userId).first()
  return c.json({ user: user || null })
})

// --- Public Listings ---
app.get('/api/mp/listings', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT l.*, e.company_name as exhibitor_company, e.booth_number as exhibitor_booth
     FROM mp_listings l LEFT JOIN exhibitors e ON l.exhibitor_id = e.id
     WHERE l.status = 'approved' ORDER BY l.created_at DESC`
  ).all()
  return c.json({ listings: results })
})

app.get('/api/mp/listings/:id', async (c) => {
  const id = c.req.param('id')
  const listing = await c.env.DB.prepare(
    `SELECT l.*, e.company_name as exhibitor_company, e.booth_number as exhibitor_booth
     FROM mp_listings l LEFT JOIN exhibitors e ON l.exhibitor_id = e.id WHERE l.id = ?`
  ).bind(id).first()
  if (!listing) return c.json({ error: 'Not found' }, 404)
  await c.env.DB.prepare('UPDATE mp_listings SET view_count = view_count + 1 WHERE id = ?').bind(id).run()
  return c.json({ listing })
})

app.get('/api/mp/listings/by-slug/:company/:product', async (c) => {
  const cs = c.req.param('company'), ps = c.req.param('product')
  const listing = await c.env.DB.prepare(
    `SELECT l.*, e.company_name as exhibitor_company, e.booth_number as exhibitor_booth
     FROM mp_listings l LEFT JOIN exhibitors e ON l.exhibitor_id = e.id
     WHERE l.company_slug = ? AND l.product_slug = ?`
  ).bind(cs, ps).first()
  if (!listing) return c.json({ error: 'Not found' }, 404)
  await c.env.DB.prepare('UPDATE mp_listings SET view_count = view_count + 1 WHERE id = ?').bind(listing.id).run()
  return c.json({ listing })
})

// Submit a new listing (authenticated)
app.post('/api/mp/listings', async (c) => {
  const userId = await getMpSession(c)
  if (!userId) return c.json({ error: 'Login required' }, 401)
  const user = await c.env.DB.prepare('SELECT * FROM mp_companies WHERE id = ?').bind(userId).first() as any
  if (!user) return c.json({ error: 'User not found' }, 401)
  const body = await c.req.json() as any
  if (!body.product_name || !body.description) return c.json({ error: 'Product name and description required' }, 400)
  const companySlug = generateSlug(user.company_name)
  const productSlug = generateSlug(body.product_name)
  const result = await c.env.DB.prepare(
    `INSERT INTO mp_listings (company_id, company_name, company_slug, product_name, product_slug, description,
     target_customer, target_industry, target_functional_area, ai_category, ai_category_custom, tags, innovation,
     use_cases, pricing_type, pricing_details, product_image_url, logo_url, screenshot_urls, website_url,
     product_url, demo_url, video_url, founder_name, cto_name, contact_name, company_registration, company_phone,
     company_address, sales_contact_name, sales_contact_email, sales_contact_phone, current_customers,
     integration_requirements, supported_platforms, tech_stack, security_protocols, case_studies,
     certifications_compliance, access_info, support_offering, sla_details, onboarding_process, awards_rating,
     exhibitor_id, booth_number, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    userId, user.company_name, companySlug, body.product_name, productSlug, body.description,
    body.target_customer||'', body.target_industry||'', body.target_functional_area||'', body.ai_category||'',
    body.ai_category_custom||'', body.tags||'', body.innovation||'', body.use_cases||'', body.pricing_type||'',
    body.pricing_details||'', body.product_image_url||'', body.logo_url||'', body.screenshot_urls||'',
    body.website_url||'', body.product_url||'', body.demo_url||'', body.video_url||'', body.founder_name||'',
    body.cto_name||'', body.contact_name||'', body.company_registration||'', body.company_phone||'',
    body.company_address||'', body.sales_contact_name||'', body.sales_contact_email||'',
    body.sales_contact_phone||'', body.current_customers||'', body.integration_requirements||'',
    body.supported_platforms||'', body.tech_stack||'', body.security_protocols||'', body.case_studies||'',
    body.certifications_compliance||'', body.access_info||'', body.support_offering||'', body.sla_details||'',
    body.onboarding_process||'', body.awards_rating||0, user.exhibitor_id||null, body.booth_number||'', 'pending'
  ).run()
  return c.json({ success: true, id: result.meta.last_row_id }, 201)
})

// --- Listing Reviews ---
app.get('/api/mp/listings/:id/reviews', async (c) => {
  const id = c.req.param('id')
  const { results } = await c.env.DB.prepare('SELECT * FROM mp_reviews WHERE listing_id = ? ORDER BY created_at DESC').bind(id).all()
  return c.json({ reviews: results })
})

app.post('/api/mp/listings/:id/reviews', async (c) => {
  const userId = await getMpSession(c)
  if (!userId) return c.json({ error: 'Login required' }, 401)
  const user = await c.env.DB.prepare('SELECT company_name FROM mp_companies WHERE id = ?').bind(userId).first() as any
  const id = c.req.param('id')
  const { rating, comment } = await c.req.json() as any
  if (!rating || rating < 1 || rating > 5) return c.json({ error: 'Rating 1-5 required' }, 400)
  await c.env.DB.prepare('INSERT INTO mp_reviews (listing_id, company_id, company_name, rating, comment) VALUES (?,?,?,?,?)')
    .bind(id, userId, user?.company_name||'', rating, comment||'').run()
  return c.json({ success: true })
})

// --- Listing Inquiries ---
app.post('/api/mp/inquiries', async (c) => {
  const body = await c.req.json() as any
  if (!body.listing_id || !body.inquirer_name || !body.inquirer_email) return c.json({ error: 'Required fields missing' }, 400)
  await c.env.DB.prepare(
    'INSERT INTO mp_inquiries (listing_id, inquirer_name, inquirer_email, inquirer_company, inquirer_phone, inquirer_message) VALUES (?,?,?,?,?,?)'
  ).bind(body.listing_id, body.inquirer_name, body.inquirer_email, body.inquirer_company||'', body.inquirer_phone||'', body.inquirer_message||'').run()
  return c.json({ success: true })
})

// --- File Uploads ---
app.post('/api/mp/uploads', async (c) => {
  const userId = await getMpSession(c)
  if (!userId) return c.json({ error: 'Login required' }, 401)
  const formData = await c.req.formData()
  const file = formData.get('file') as File
  if (!file) return c.json({ error: 'No file' }, 400)
  if (file.size > 5 * 1024 * 1024) return c.json({ error: 'File too large (5MB max)' }, 400)
  const arrayBuffer = await file.arrayBuffer()
  const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))
  const dataUri = `data:${file.type};base64,${base64}`
  const result = await c.env.DB.prepare('INSERT INTO mp_uploads (company_id, filename, content_type, size, data) VALUES (?,?,?,?,?)')
    .bind(userId, file.name, file.type, file.size, dataUri).run()
  return c.json({ url: `/api/mp/files/${result.meta.last_row_id}`, id: result.meta.last_row_id })
})

app.get('/api/mp/files/:id', async (c) => {
  const id = c.req.param('id')
  const file = await c.env.DB.prepare('SELECT data, content_type FROM mp_uploads WHERE id = ?').bind(id).first() as any
  if (!file) return c.json({ error: 'Not found' }, 404)
  if (file.data.startsWith('data:')) {
    const base64 = file.data.split(',')[1]
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new Response(bytes, { headers: { 'Content-Type': file.content_type, 'Cache-Control': 'public, max-age=31536000' } })
  }
  return c.json({ error: 'Invalid file' }, 500)
})

// --- Company Dashboard APIs ---
app.get('/api/mp/dashboard/stats', async (c) => {
  const userId = await getMpSession(c)
  if (!userId) return c.json({ error: 'Login required' }, 401)
  const total = await c.env.DB.prepare('SELECT COUNT(*) as c FROM mp_listings WHERE company_id = ?').bind(userId).first() as any
  const approved = await c.env.DB.prepare("SELECT COUNT(*) as c FROM mp_listings WHERE company_id = ? AND status = 'approved'").bind(userId).first() as any
  const pending = await c.env.DB.prepare("SELECT COUNT(*) as c FROM mp_listings WHERE company_id = ? AND status = 'pending'").bind(userId).first() as any
  const views = await c.env.DB.prepare('SELECT COALESCE(SUM(view_count),0) as c FROM mp_listings WHERE company_id = ?').bind(userId).first() as any
  const inqs = await c.env.DB.prepare('SELECT COUNT(*) as c FROM mp_inquiries WHERE listing_id IN (SELECT id FROM mp_listings WHERE company_id = ?)').bind(userId).first() as any
  const rating = await c.env.DB.prepare('SELECT AVG(rating) as avg FROM mp_reviews WHERE listing_id IN (SELECT id FROM mp_listings WHERE company_id = ?)').bind(userId).first() as any
  return c.json({
    total_listings: total.c, approved: approved.c, pending: pending.c,
    total_views: views.c, total_inquiries: inqs.c, avg_rating: rating.avg ? Math.round(rating.avg * 10) / 10 : null
  })
})

app.get('/api/mp/dashboard/listings', async (c) => {
  const userId = await getMpSession(c)
  if (!userId) return c.json({ error: 'Login required' }, 401)
  const { results } = await c.env.DB.prepare(
    `SELECT l.*, (SELECT COUNT(*) FROM mp_inquiries WHERE listing_id = l.id) as inquiry_count,
     (SELECT AVG(rating) FROM mp_reviews WHERE listing_id = l.id) as avg_rating
     FROM mp_listings l WHERE l.company_id = ? ORDER BY l.created_at DESC`
  ).bind(userId).all()
  return c.json({ listings: results })
})

app.get('/api/mp/dashboard/listings/:id', async (c) => {
  const userId = await getMpSession(c)
  if (!userId) return c.json({ error: 'Login required' }, 401)
  const listing = await c.env.DB.prepare('SELECT * FROM mp_listings WHERE id = ? AND company_id = ?').bind(c.req.param('id'), userId).first()
  if (!listing) return c.json({ error: 'Not found' }, 404)
  return c.json({ listing })
})

app.put('/api/mp/dashboard/listings/:id', async (c) => {
  const userId = await getMpSession(c)
  if (!userId) return c.json({ error: 'Login required' }, 401)
  const id = c.req.param('id')
  const body = await c.req.json() as any
  const listing = await c.env.DB.prepare('SELECT status FROM mp_listings WHERE id = ? AND company_id = ?').bind(id, userId).first() as any
  if (!listing) return c.json({ error: 'Not found' }, 404)
  const newStatus = listing.status === 'approved' ? 'pending' : listing.status
  const fields = ['product_name','description','target_customer','pricing_type','pricing_details','tags','target_industry','ai_category','website_url','product_url','sales_contact_name','sales_contact_email']
  const updates = fields.filter(f => body[f] !== undefined).map(f => `${f} = ?`)
  if (!updates.length) return c.json({ error: 'No fields to update' }, 400)
  updates.push('status = ?', 'product_slug = ?', 'updated_at = CURRENT_TIMESTAMP')
  const values = fields.filter(f => body[f] !== undefined).map(f => body[f])
  values.push(newStatus, generateSlug(body.product_name || ''))
  await c.env.DB.prepare(`UPDATE mp_listings SET ${updates.join(', ')} WHERE id = ? AND company_id = ?`).bind(...values, id, userId).run()
  return c.json({ success: true, new_status: newStatus })
})

app.get('/api/mp/dashboard/inquiries', async (c) => {
  const userId = await getMpSession(c)
  if (!userId) return c.json({ error: 'Login required' }, 401)
  const { results } = await c.env.DB.prepare(
    `SELECT i.*, l.product_name FROM mp_inquiries i JOIN mp_listings l ON i.listing_id = l.id WHERE l.company_id = ? ORDER BY i.created_at DESC`
  ).bind(userId).all()
  return c.json({ inquiries: results })
})

app.get('/api/mp/dashboard/reviews', async (c) => {
  const userId = await getMpSession(c)
  if (!userId) return c.json({ error: 'Login required' }, 401)
  const { results } = await c.env.DB.prepare(
    `SELECT r.*, l.product_name FROM mp_reviews r JOIN mp_listings l ON r.listing_id = l.id WHERE l.company_id = ? ORDER BY r.created_at DESC`
  ).bind(userId).all()
  return c.json({ reviews: results })
})

app.get('/api/mp/dashboard/profile', async (c) => {
  const userId = await getMpSession(c)
  if (!userId) return c.json({ error: 'Login required' }, 401)
  const profile = await c.env.DB.prepare('SELECT id, company_name, email, role, created_at FROM mp_companies WHERE id = ?').bind(userId).first()
  return c.json({ profile })
})

app.put('/api/mp/dashboard/profile', async (c) => {
  const userId = await getMpSession(c)
  if (!userId) return c.json({ error: 'Login required' }, 401)
  const { company_name } = await c.req.json() as any
  await c.env.DB.prepare('UPDATE mp_companies SET company_name = ? WHERE id = ?').bind(company_name, userId).run()
  return c.json({ success: true })
})

// --- Admin APIs ---
app.get('/api/mp/admin/stats', async (c) => {
  const userId = await getMpSession(c)
  if (!userId) return c.json({ error: 'Login required' }, 401)
  const user = await c.env.DB.prepare('SELECT role FROM mp_companies WHERE id = ?').bind(userId).first() as any
  if (!user || user.role !== 'admin') return c.json({ error: 'Admin only' }, 403)
  const total = await c.env.DB.prepare('SELECT COUNT(*) as c FROM mp_listings').first() as any
  const pending = await c.env.DB.prepare("SELECT COUNT(*) as c FROM mp_listings WHERE status = 'pending'").first() as any
  const approved = await c.env.DB.prepare("SELECT COUNT(*) as c FROM mp_listings WHERE status = 'approved'").first() as any
  const rejected = await c.env.DB.prepare("SELECT COUNT(*) as c FROM mp_listings WHERE status = 'rejected'").first() as any
  const inqCount = await c.env.DB.prepare('SELECT COUNT(*) as c FROM mp_inquiries').first() as any
  const views = await c.env.DB.prepare('SELECT COALESCE(SUM(view_count),0) as c FROM mp_listings').first() as any
  const companies = await c.env.DB.prepare('SELECT COUNT(*) as c FROM mp_companies WHERE role != ?').bind('admin').first() as any
  const recent = await c.env.DB.prepare('SELECT * FROM mp_listings ORDER BY created_at DESC LIMIT 10').all()
  return c.json({
    totalListings: total.c, pendingListings: pending.c, approvedListings: approved.c,
    rejectedListings: rejected.c, inquiryCount: inqCount.c, totalViews: views.c,
    totalCompanies: companies.c, recentListings: recent.results
  })
})

app.get('/api/mp/admin/listings', async (c) => {
  const userId = await getMpSession(c)
  if (!userId) return c.json({ error: 'Login required' }, 401)
  const user = await c.env.DB.prepare('SELECT role FROM mp_companies WHERE id = ?').bind(userId).first() as any
  if (!user || user.role !== 'admin') return c.json({ error: 'Admin only' }, 403)
  const status = c.req.query('status')
  let query = 'SELECT * FROM mp_listings'
  if (status && status !== 'all') query += ` WHERE status = '${status}'`
  query += ' ORDER BY created_at DESC'
  const { results } = await c.env.DB.prepare(query).all()
  return c.json({ listings: results })
})

app.patch('/api/mp/admin/listings/:id', async (c) => {
  const userId = await getMpSession(c)
  if (!userId) return c.json({ error: 'Login required' }, 401)
  const user = await c.env.DB.prepare('SELECT role FROM mp_companies WHERE id = ?').bind(userId).first() as any
  if (!user || user.role !== 'admin') return c.json({ error: 'Admin only' }, 403)
  const { status } = await c.req.json() as any
  await c.env.DB.prepare('UPDATE mp_listings SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(status, c.req.param('id')).run()
  return c.json({ success: true })
})

app.post('/api/mp/admin/listings', async (c) => {
  const userId = await getMpSession(c)
  if (!userId) return c.json({ error: 'Login required' }, 401)
  const user = await c.env.DB.prepare('SELECT role FROM mp_companies WHERE id = ?').bind(userId).first() as any
  if (!user || user.role !== 'admin') return c.json({ error: 'Admin only' }, 403)
  const body = await c.req.json() as any
  if (!body.company_name || !body.company_email || !body.product_name || !body.description) return c.json({ error: 'Required fields missing' }, 400)
  // Ensure company exists or create it
  let company = await c.env.DB.prepare('SELECT id FROM mp_companies WHERE email = ?').bind(body.company_email.trim().toLowerCase()).first() as any
  if (!company) {
    const hash = await sha256('changeme123')
    const res = await c.env.DB.prepare('INSERT INTO mp_companies (company_name, email, password_hash) VALUES (?,?,?)')
      .bind(body.company_name, body.company_email.trim().toLowerCase(), hash).run()
    company = { id: res.meta.last_row_id }
  }
  const companySlug = generateSlug(body.company_name)
  const productSlug = generateSlug(body.product_name)
  const result = await c.env.DB.prepare(
    `INSERT INTO mp_listings (company_id, company_name, company_slug, product_name, product_slug, description,
     target_customer, target_industry, ai_category, tags, pricing_type, pricing_details, product_image_url,
     sales_contact_name, sales_contact_email, sales_contact_phone, innovation, founder_name, website_url, product_url, demo_url, video_url,
     current_customers, awards_rating, access_info, contact_name, supported_platforms, tech_stack, case_studies,
     certifications_compliance, support_offering, sla_details, onboarding_process, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    company.id, body.company_name, companySlug, body.product_name, productSlug, body.description,
    body.target_customer||'', body.target_industry||'', body.ai_category||'', body.tags||'',
    body.pricing_type||'', body.pricing_details||'', body.product_image_url||'',
    body.sales_contact_name||'', body.sales_contact_email||'', body.sales_contact_phone||'',
    body.innovation||'', body.founder_name||'', body.website_url||'', body.product_url||'',
    body.demo_url||'', body.video_url||'', body.current_customers||'', body.awards_rating||0,
    body.access_info||'', body.contact_name||'', body.supported_platforms||'', body.tech_stack||'',
    body.case_studies||'', body.certifications_compliance||'', body.support_offering||'',
    body.sla_details||'', body.onboarding_process||'', body.status||'approved'
  ).run()
  return c.json({ success: true, id: result.meta.last_row_id })
})

app.post('/api/mp/admin/bulk-listings', async (c) => {
  const userId = await getMpSession(c)
  if (!userId) return c.json({ error: 'Login required' }, 401)
  const user = await c.env.DB.prepare('SELECT role FROM mp_companies WHERE id = ?').bind(userId).first() as any
  if (!user || user.role !== 'admin') return c.json({ error: 'Admin only' }, 403)
  const { listings } = await c.req.json() as any
  let inserted = 0
  const errors: string[] = []
  for (const item of listings) {
    try {
      let company = await c.env.DB.prepare('SELECT id FROM mp_companies WHERE email = ?').bind((item.company_email||'').trim().toLowerCase()).first() as any
      if (!company) {
        const hash = await sha256('changeme123')
        const res = await c.env.DB.prepare('INSERT INTO mp_companies (company_name, email, password_hash) VALUES (?,?,?)')
          .bind(item.company_name, (item.company_email||'').trim().toLowerCase(), hash).run()
        company = { id: res.meta.last_row_id }
      }
      await c.env.DB.prepare(
        `INSERT INTO mp_listings (company_id, company_name, company_slug, product_name, product_slug, description,
         target_customer, target_industry, ai_category, tags, pricing_type, pricing_details, product_image_url,
         sales_contact_name, sales_contact_email, sales_contact_phone, innovation, founder_name, website_url,
         product_url, demo_url, video_url, current_customers, awards_rating, access_info, contact_name,
         supported_platforms, tech_stack, case_studies, certifications_compliance, support_offering, sla_details,
         onboarding_process, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        company.id, item.company_name, generateSlug(item.company_name), item.product_name, generateSlug(item.product_name),
        item.description, item.target_customer||'', item.target_industry||'', item.ai_category||'', item.tags||'',
        item.pricing_type||'', item.pricing_details||'', item.product_image_url||'',
        item.sales_contact_name||'', item.sales_contact_email||'', item.sales_contact_phone||'',
        item.innovation||'', item.founder_name||'', item.website_url||'', item.product_url||'',
        item.demo_url||'', item.video_url||'', item.current_customers||'', item.awards_rating||0,
        item.access_info||'', item.contact_name||'', item.supported_platforms||'', item.tech_stack||'',
        item.case_studies||'', item.certifications_compliance||'', item.support_offering||'',
        item.sla_details||'', item.onboarding_process||'', item.status||'pending'
      ).run()
      inserted++
    } catch (e: any) { errors.push(e.message) }
  }
  return c.json({ inserted, errors })
})

app.get('/api/mp/admin/inquiries', async (c) => {
  const userId = await getMpSession(c)
  if (!userId) return c.json({ error: 'Login required' }, 401)
  const user = await c.env.DB.prepare('SELECT role FROM mp_companies WHERE id = ?').bind(userId).first() as any
  if (!user || user.role !== 'admin') return c.json({ error: 'Admin only' }, 403)
  const { results } = await c.env.DB.prepare(
    `SELECT i.*, l.product_name, l.company_name, l.sales_contact_name, l.sales_contact_email, l.sales_contact_phone
     FROM mp_inquiries i JOIN mp_listings l ON i.listing_id = l.id ORDER BY i.created_at DESC`
  ).all()
  return c.json({ inquiries: results })
})

// --- Exhibitor → Marketplace Bridge ---
// Allow an exhibitor (logged into networking app) to create a marketplace account
app.post('/api/mp/bridge/exhibitor-register', async (c) => {
  const body = await c.req.json() as any
  const { attendee_id, exhibitor_id } = body
  if (!attendee_id) return c.json({ error: 'Attendee ID required' }, 400)
  const attendee = await c.env.DB.prepare('SELECT * FROM attendees WHERE id = ?').bind(attendee_id).first() as any
  if (!attendee) return c.json({ error: 'Attendee not found' }, 404)
  // Check if already has marketplace account
  let mpCompany = await c.env.DB.prepare('SELECT id FROM mp_companies WHERE email = ?').bind(attendee.email).first() as any
  if (mpCompany) {
    // Link exhibitor if not already
    if (exhibitor_id) await c.env.DB.prepare('UPDATE mp_companies SET exhibitor_id = ?, attendee_id = ? WHERE id = ?').bind(exhibitor_id, attendee_id, mpCompany.id).run()
    return new Response(JSON.stringify({ success: true, mp_company_id: mpCompany.id, existing: true }), {
      headers: { 'Content-Type': 'application/json', 'Set-Cookie': mpCookie(await signMpSession(c, mpCompany.id)) }
    })
  }
  const hash = await sha256('changeme123')
  const companyName = attendee.organization || attendee.name
  const result = await c.env.DB.prepare(
    'INSERT INTO mp_companies (company_name, email, password_hash, exhibitor_id, attendee_id) VALUES (?,?,?,?,?)'
  ).bind(companyName, attendee.email, hash, exhibitor_id||null, attendee_id).run()
  return new Response(JSON.stringify({ success: true, mp_company_id: result.meta.last_row_id, existing: false }), {
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': mpCookie(await signMpSession(c, result.meta.last_row_id)) }
  })
})

// ==================== CONTACT PAGE ====================

app.get('/contact', (c) => {
  return c.html(contactPageHTML())
})

// ==================== REGISTER PAGE (Free Visitor Pass) ====================

app.get('/register', (c) => {
  return c.html(registerPageHTML())
})

// ==================== STANDALONE INQUIRY FORM (embeddable URL for main website) ====================

app.get('/inquiry', (c) => {
  return c.html(inquiryFormPageHTML())
})

// Shared <head> for app pages (contact, register, marketplace). `path` and
// `desc` power per-page canonical + social-share cards so links pasted into
// WhatsApp/LinkedIn/X render a proper preview (previously these pages had NO
// og/twitter/canonical/JSON-LD at all). og:image is a 1200x630 card.
function sharedHeadHTML(title: string, path: string = '/', desc?: string): string {
  const fullTitle = `${title} — Bharat AI Innovation 2026`
  const description = desc || `${title} for Bharat AI Innovation 2026 — India's largest AI Conference & Exhibition, 20-21 Nov 2026, WTC Mumbai. Register free.`
  const url = `https://bharataiinnovation.com${path}`
  const ogImage = 'https://bharataiinnovation.com/images/og-card.png'
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${fullTitle}</title>
  <meta name="description" content="${description}">
  <link rel="canonical" href="${url}">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <!-- Open Graph -->
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Bharat AI Innovation">
  <meta property="og:locale" content="en_IN">
  <meta property="og:url" content="${url}">
  <meta property="og:title" content="${fullTitle}">
  <meta property="og:description" content="${description}">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:url" content="${url}">
  <meta name="twitter:title" content="${fullTitle}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${ogImage}">
  <!-- Structured data -->
  <script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org", "@type": "Event",
    name: "Bharat AI Innovation 2026",
    description: "India's largest AI Conference & Exhibition — GenAI, LLMs, enterprise AI, startups. 20-21 Nov 2026, WTC Mumbai.",
    startDate: "2026-11-20", endDate: "2026-11-21",
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: { "@type": "Place", name: "World Trade Center, Mumbai", address: { "@type": "PostalAddress", addressLocality: "Mumbai", addressRegion: "Maharashtra", addressCountry: "IN" } },
    image: [ogImage],
    organizer: { "@type": "Organization", name: "Bharat AI Innovation", url: "https://bharataiinnovation.com" },
    offers: { "@type": "Offer", url: "https://bharataiinnovation.com/register", price: "0", priceCurrency: "INR", availability: "https://schema.org/InStock" }
  })}</script>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            primary: { 50:'#fff3e9',100:'#ffe0c7',200:'#ffc194',300:'#ff9d55',400:'#ff8524',500:'#FF6B00',600:'#e05a00',700:'#b84800',800:'#933a08',900:'#79300c' },
            accent: { 50:'#fdf4ff',100:'#fbe8ff',200:'#f5d0fe',300:'#f0abfc',400:'#e879f9',500:'#d946ef',600:'#c026d3',700:'#a21caf',800:'#86198f',900:'#701a75' },
            dark: { 700:'#1e2240',800:'#141730',900:'#0b0d1a' }
          }
        }
      }
    }
  </script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
    * { font-family: 'Inter', sans-serif; }
    body { background: #0b0d1a; color: #e2e8f0; }
    .glass { background: rgba(255,255,255,0.04); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.07); }
    .gradient-text { background: linear-gradient(120deg, #ff7c1f 0%, #f5620a 40%, #e8406c 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    .card-hover { transition: all 0.3s ease; }
    .card-hover:hover { transform: translateY(-3px); box-shadow: 0 12px 40px rgba(245,98,10,0.15); }
    .modal-overlay { background: rgba(0,0,0,0.75); backdrop-filter: blur(6px); }
    input, textarea, select { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.10); color: #e2e8f0; }
    input:focus, textarea:focus, select:focus { outline: none; border-color: #f5620a; box-shadow: 0 0 0 3px rgba(245,98,10,0.18); }
    select option { background: #141730; color: #e2e8f0; }
    select { -webkit-appearance: none; -moz-appearance: none; appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%239ca3af' d='M6 8L1 3h10z'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; padding-right: 32px; }
    .toast { position: fixed; top: 20px; right: 20px; z-index: 100; padding: 12px 20px; border-radius: 12px; font-size: 14px; font-weight: 500; animation: slideIn 0.3s ease; }
    @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
  </style>
</head>`
}

function sharedNavHTML(activePage: string): string {
  const pill = (href: string, label: string, page: string) => {
    const active = activePage === page
    return `<a href="${href}" class="px-3.5 py-1.5 rounded-full text-xs font-medium transition-all no-underline ${
      active
        ? 'bg-gradient-to-r from-primary-600 to-primary-500 text-white shadow-sm shadow-primary-500/30'
        : 'text-gray-300 hover:text-white hover:bg-white/8'
    }">${label}</a>`
  }
  return `<nav style="background:rgba(11,13,26,0.93);backdrop-filter:blur(24px);border-bottom:1px solid rgba(255,255,255,0.07);" class="sticky top-0 z-30">
  <div class="max-w-7xl mx-auto px-4">
    <div class="flex items-center h-14 gap-4">
      <!-- Logo -->
      <a href="/" class="flex items-center gap-2.5 hover:opacity-90 transition shrink-0">
        <img src="https://bharataiinnovation.com/images/Bharat%20AI%20Innovation%20Logo.png" alt="Bharat AI Innovation Logo" loading="eager" style="height:44px;width:auto;border-radius:12px;padding:6px;background:rgba(255,255,255,0.95);box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <div class="leading-tight hidden sm:block">
          <div class="text-sm font-bold text-white">Bharat AI Innovation</div>
          <div class="text-[10px] text-gray-400">India's Largest AI Conference</div>
        </div>
      </a>
      <!-- Center pills -->
      <div class="flex items-center gap-0.5 flex-1 justify-center flex-wrap">
        ${pill('/', 'Home', 'home')}
        ${pill('/register', 'Register', 'register')}
        ${pill('/inquiry', 'Book Booth', 'inquiry')}
        ${pill('/contact', 'Contact', 'contact')}
        ${pill('/marketplace', 'AI Market', 'marketplace')}
        <a href="https://bharataiinnovation.com" target="_blank" class="px-3.5 py-1.5 rounded-full text-xs font-medium text-gray-300 hover:text-white hover:bg-white/8 transition-all no-underline hidden md:inline-flex">Main Site</a>
      </div>
      <!-- CTA -->
      <div class="shrink-0">
        <a href="/register" class="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold text-white transition-all hover:opacity-90 no-underline" style="background:linear-gradient(135deg,#FF6B00,#e03060);box-shadow:0 4px 15px rgba(245,98,10,0.35);">
          Register <i class="fas fa-arrow-right text-[10px]"></i>
        </a>
      </div>
    </div>
  </div>
</nav>`
}

function sharedFooterHTML(): string {
  return `<footer class="glass border-t border-white/10 mt-12">
  <div class="max-w-7xl mx-auto px-4 py-8">
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
      <div>
        <div class="flex items-center gap-3 mb-3">
          <img src="https://bharataiinnovation.com/images/Bharat%20AI%20Innovation%20Logo.png" alt="BHAI" class="w-10 h-10 rounded-lg object-contain">
          <div>
            <h3 class="font-bold text-sm">Bharat AI Innovation 2026</h3>
            <p class="text-[10px] text-gray-400">16th Edition</p>
          </div>
        </div>
        <p class="text-xs text-gray-400">India's Largest AI Conference & Exhibition bringing together innovators, researchers, startups, and industry leaders.</p>
      </div>
      <div>
        <h4 class="font-semibold text-sm mb-3">Event Details</h4>
        <ul class="space-y-2 text-xs text-gray-400">
          <li><i class="fas fa-calendar mr-2 text-primary-400"></i>20-21 Nov 2026</li>
          <li><i class="fas fa-map-marker-alt mr-2 text-primary-400"></i>World Trade Center, Mumbai</li>
          <li><i class="fas fa-building mr-2 text-primary-400"></i>Centre 1 Building, Cuffe Parade, 400005</li>
          <li><a href="https://maps.google.com/?q=World+Trade+Centre+Mumbai+Cuffe+Parade" target="_blank" class="text-primary-400 hover:underline"><i class="fas fa-directions mr-1"></i>Get Directions</a></li>
        </ul>
      </div>
      <div>
        <h4 class="font-semibold text-sm mb-3">Quick Links</h4>
        <ul class="space-y-2 text-xs">
          <li><a href="/app" class="text-gray-400 hover:text-white transition"><i class="fas fa-home mr-2"></i>Networking App</a></li>
          <li><a href="/register" class="text-gray-400 hover:text-white transition"><i class="fas fa-ticket-alt mr-2"></i>Register</a></li>
          <li><a href="/contact" class="text-gray-400 hover:text-white transition"><i class="fas fa-envelope mr-2"></i>Contact Us</a></li>
          <li><a href="/inquiry" class="text-gray-400 hover:text-white transition"><i class="fas fa-store mr-2"></i>Book a Booth</a></li>
          <li><a href="/marketplace" class="text-gray-400 hover:text-white transition"><i class="fas fa-robot mr-2"></i>AI Marketplace</a></li>
          <li><a href="https://bharataiinnovation.com" target="_blank" class="text-gray-400 hover:text-white transition"><i class="fas fa-globe mr-2"></i>bharataiinnovation.com</a></li>
          <li><a href="/exhibition" class="text-gray-400 hover:text-white transition"><i class="fas fa-store mr-2"></i>Exhibition</a></li>
          <li><a href="/training-workshop" class="text-gray-400 hover:text-white transition"><i class="fas fa-laptop-code mr-2"></i>Workshops</a></li>
        </ul>
      </div>
    </div>
    <div class="border-t border-white/10 pt-4 text-center text-xs text-gray-500">
      &copy; 2026 Bharat AI Innovation. All rights reserved.
    </div>
  </div>
</footer>`
}

function sharedToastJS(): string {
  return `
  function showToast(msg, type) {
    const t = document.createElement('div');
    t.className = 'toast ' + (type === 'error' ? 'bg-red-500/90 text-white' : type === 'success' ? 'bg-green-500/90 text-white' : 'bg-primary-500/90 text-white');
    t.innerHTML = '<i class="fas ' + (type === 'error' ? 'fa-exclamation-circle' : type === 'success' ? 'fa-check-circle' : 'fa-info-circle') + ' mr-2"></i>' + msg;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; setTimeout(() => t.remove(), 300); }, 4000);
  }`
}

function contactPageHTML(): string {
  return `${sharedHeadHTML('Contact Us', '/contact', "Questions about Bharat AI Innovation 2026? Reach the team for registration, sponsorship, exhibition, and press enquiries. 20-21 Nov 2026, WTC Mumbai.")}
<body class="min-h-screen">
${sharedNavHTML('contact')}

<main class="max-w-7xl mx-auto px-4 py-8">
  <!-- Hero -->
  <div class="text-center mb-8">
    <h1 class="text-3xl md:text-4xl font-bold mb-3"><i class="fas fa-headset text-primary-400 mr-3"></i>Contact Us</h1>
    <p class="text-gray-400 max-w-2xl mx-auto">Have questions about Bharat AI Innovation 2026? We're here to help. Choose your inquiry type below and we'll respond within 24 hours.</p>
  </div>

  <!-- Inquiry Type Cards -->
  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
    <div class="glass rounded-2xl p-6 card-hover cursor-pointer border border-primary-500/20 hover:border-primary-400/40" onclick="selectType('general')">
      <div class="w-12 h-12 rounded-xl bg-primary-500/20 flex items-center justify-center mb-3"><i class="fas fa-question-circle text-xl text-primary-400"></i></div>
      <h3 class="font-bold text-base text-primary-300">General Inquiry</h3>
      <p class="text-xs text-gray-400 mt-1">Event details, schedule, venue, registration questions</p>
    </div>
    <div class="glass rounded-2xl p-6 card-hover cursor-pointer border border-amber-500/20 hover:border-amber-400/40" onclick="selectType('exhibition')">
      <div class="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center mb-3"><i class="fas fa-store text-xl text-amber-400"></i></div>
      <h3 class="font-bold text-base text-amber-300">Exhibition / Booth</h3>
      <p class="text-xs text-gray-400 mt-1">Booth packages, availability, pricing, floor plan</p>
    </div>
    <div class="glass rounded-2xl p-6 card-hover cursor-pointer border border-orange-500/20 hover:border-orange-400/40" onclick="selectType('sponsorship')">
      <div class="w-12 h-12 rounded-xl bg-orange-500/20 flex items-center justify-center mb-3"><i class="fas fa-handshake text-xl text-orange-400"></i></div>
      <h3 class="font-bold text-base text-orange-300">Sponsorship</h3>
      <p class="text-xs text-gray-400 mt-1">Brand visibility, partnership, sponsorship packages</p>
    </div>
    <div class="glass rounded-2xl p-6 card-hover cursor-pointer border border-purple-500/20 hover:border-purple-400/40" onclick="selectType('speaking')">
      <div class="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center mb-3"><i class="fas fa-microphone-alt text-xl text-purple-400"></i></div>
      <h3 class="font-bold text-base text-purple-300">Speaking Opportunity</h3>
      <p class="text-xs text-gray-400 mt-1">Submit your talk, workshop, or panel proposal</p>
    </div>
    <div class="glass rounded-2xl p-6 card-hover cursor-pointer border border-rose-500/20 hover:border-rose-400/40" onclick="selectType('media')">
      <div class="w-12 h-12 rounded-xl bg-rose-500/20 flex items-center justify-center mb-3"><i class="fas fa-newspaper text-xl text-rose-400"></i></div>
      <h3 class="font-bold text-base text-rose-300">Media / Press</h3>
      <p class="text-xs text-gray-400 mt-1">Press accreditation, interviews, media coverage</p>
    </div>
    <div class="glass rounded-2xl p-6 card-hover cursor-pointer border border-green-500/20 hover:border-green-400/40" onclick="selectType('group_registration')">
      <div class="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center mb-3"><i class="fas fa-users text-xl text-green-400"></i></div>
      <h3 class="font-bold text-base text-green-300">Group Registration</h3>
      <p class="text-xs text-gray-400 mt-1">Delegation discounts for 5+ people, corporate bookings</p>
    </div>
  </div>

  <!-- Contact Form -->
  <div class="max-w-2xl mx-auto">
    <div class="glass rounded-2xl p-6 md:p-8" id="contact-form-card">
      <div class="flex items-center gap-3 mb-6">
        <div class="w-10 h-10 rounded-xl bg-primary-500/20 flex items-center justify-center shrink-0" id="cf-icon-box">
          <i class="fas fa-envelope text-lg text-primary-400" id="cf-icon"></i>
        </div>
        <div>
          <h2 class="font-bold text-lg" id="cf-title">Send us a message</h2>
          <p class="text-xs text-gray-400" id="cf-subtitle">Select an inquiry type above or fill the form directly</p>
        </div>
      </div>

      <form id="contact-form" onsubmit="submitContactForm(event)" class="space-y-4">
        <input type="hidden" id="cf-type" value="general">

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="text-xs text-gray-400 mb-1 block">Full Name *</label>
            <input type="text" id="cf-name" required class="w-full px-4 py-3 rounded-xl text-sm" placeholder="Your name">
          </div>
          <div>
            <label class="text-xs text-gray-400 mb-1 block">Email Address *</label>
            <input type="email" id="cf-email" required class="w-full px-4 py-3 rounded-xl text-sm" placeholder="your@email.com">
          </div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="text-xs text-gray-400 mb-1 block">Phone</label>
            <input type="tel" id="cf-phone" class="w-full px-4 py-3 rounded-xl text-sm" placeholder="+91 XXXXX XXXXX">
          </div>
          <div>
            <label class="text-xs text-gray-400 mb-1 block">Organization</label>
            <input type="text" id="cf-org" class="w-full px-4 py-3 rounded-xl text-sm" placeholder="Company / Institute">
          </div>
        </div>
        <div>
          <label class="text-xs text-gray-400 mb-1 block">Subject</label>
          <input type="text" id="cf-subject" class="w-full px-4 py-3 rounded-xl text-sm" placeholder="Brief subject line">
        </div>

        <!-- Dynamic Extra Fields -->
        <div id="cf-extra"></div>

        <div>
          <label class="text-xs text-gray-400 mb-1 block">Message *</label>
          <textarea id="cf-message" rows="4" required class="w-full px-4 py-3 rounded-xl text-sm" placeholder="Describe your inquiry in detail..."></textarea>
        </div>
        <button type="submit" id="cf-submit" class="w-full py-3.5 rounded-xl font-bold text-white transition-all text-sm hover:opacity-90" style="background:linear-gradient(135deg,#FF6B00,#e03060);box-shadow:0 4px 20px rgba(245,98,10,0.3);">
          <i class="fas fa-paper-plane mr-2"></i>Submit Inquiry
        </button>
      </form>

      <div id="cf-success" class="hidden text-center py-8">
        <div class="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
          <i class="fas fa-check text-3xl text-green-400"></i>
        </div>
        <h3 class="font-bold text-xl text-green-300">Inquiry Submitted!</h3>
        <p class="text-sm text-gray-400 mt-2 max-w-md mx-auto">Thank you for reaching out. Our team will review your inquiry and respond within 24 hours.</p>
        <div class="flex gap-3 justify-center mt-6">
          <button onclick="resetContactForm()" class="px-6 py-2.5 rounded-xl text-sm font-semibold glass hover:bg-white/10 transition"><i class="fas fa-plus mr-2"></i>Send Another</button>
          <a href="/app" class="px-6 py-2.5 rounded-xl text-sm font-semibold bg-primary-500/20 text-primary-300 hover:bg-primary-500/30 transition"><i class="fas fa-home mr-2"></i>Go to App</a>
        </div>
      </div>
    </div>
  </div>

  <!-- Quick Info Bar -->
  <div class="max-w-2xl mx-auto mt-6">
    <div class="glass rounded-xl p-4 flex flex-wrap items-center justify-center gap-4 text-xs text-gray-400">
      <span><i class="fas fa-envelope text-primary-400 mr-1.5"></i>info@bharataiinnovation.com</span>
      <span><i class="fas fa-globe text-primary-400 mr-1.5"></i><a href="https://bharataiinnovation.com" target="_blank" class="hover:text-white transition">bharataiinnovation.com</a></span>
      <span><i class="fas fa-map-marker-alt text-primary-400 mr-1.5"></i>WTC Mumbai, Cuffe Parade</span>
      <span><i class="fas fa-calendar text-primary-400 mr-1.5"></i>20-21 Nov 2026</span>
    </div>
  </div>
</main>

${sharedFooterHTML()}

<script>
${sharedToastJS()}

const TYPE_CONFIG = {
  general: { icon: 'fa-question-circle', color: 'primary', title: 'General Inquiry', subtitle: 'Ask us anything about the event' },
  exhibition: { icon: 'fa-store', color: 'amber', title: 'Exhibition Inquiry', subtitle: 'Booth packages, availability & pricing' },
  sponsorship: { icon: 'fa-handshake', color: 'orange', title: 'Sponsorship Inquiry', subtitle: 'Brand visibility & partnership opportunities' },
  speaking: { icon: 'fa-microphone-alt', color: 'purple', title: 'Speaking Opportunity', subtitle: 'Submit your talk or workshop proposal' },
  media: { icon: 'fa-newspaper', color: 'rose', title: 'Media / Press Inquiry', subtitle: 'Accreditation, interviews & coverage' },
  group_registration: { icon: 'fa-users', color: 'green', title: 'Group Registration', subtitle: 'Delegation discounts for 5+ people' },
};

function selectType(type) {
  const cfg = TYPE_CONFIG[type] || TYPE_CONFIG.general;
  document.getElementById('cf-type').value = type;
  document.getElementById('cf-icon').className = 'fas ' + cfg.icon + ' text-lg text-' + cfg.color + '-400';
  document.getElementById('cf-icon-box').className = 'w-10 h-10 rounded-xl bg-' + cfg.color + '-500/20 flex items-center justify-center shrink-0';
  document.getElementById('cf-title').textContent = cfg.title;
  document.getElementById('cf-subtitle').textContent = cfg.subtitle;

  // Extra fields
  let extra = '';
  if (type === 'exhibition') {
    extra = '<div><label class="text-xs text-gray-400 mb-1 block">Preferred Booth Type</label><select id="cf-booth" class="w-full px-4 py-3 rounded-xl text-sm"><option value="">Select booth type</option><option value="Startup Pod - 1.5×1.5m - ₹38,000">Startup Pod — 1.5 × 1.5 m — ₹38,000</option><option value="Explorer Booth - 2×2m - ₹1,25,000">Explorer Booth — 2 × 2 m — ₹1,25,000</option><option value="Innovator Booth - 3×2m - ₹1,95,000">Innovator Booth — 3 × 2 m — ₹1,95,000</option><option value="Accelerator Booth - 3×3m - ₹2,91,000">Accelerator Booth — 3 × 3 m — ₹2,91,000</option><option value="Enterprise Booth - 4×2m - ₹2,58,000">Enterprise Booth — 4 × 2 m — ₹2,58,000</option><option value="Flagship Pavilion - 6×2m - ₹3,87,000">Flagship Pavilion — 6 × 2 m — ₹3,87,000</option><option value="Mega Pavilion - 7×7.7m - ₹17,40,000">Mega Pavilion — 7 × 7.7 m — ₹17,40,000</option><option value="Undecided">Not sure yet / Need consultation</option></select></div><div class="mt-4"><label class="text-xs text-gray-400 mb-1 block">Preferred Zone</label><select id="cf-zone" class="w-full px-4 py-3 rounded-xl text-sm"><option value="">Any zone</option><option value="Main Hall">Main Hall</option><option value="Innovation Hub">Innovation Hub</option><option value="Startup Alley">Startup Alley</option><option value="Enterprise Zone">Enterprise Zone</option></select></div>';
  } else if (type === 'speaking') {
    extra = '<div><label class="text-xs text-gray-400 mb-1 block">Proposed Topic</label><input type="text" id="cf-topic" class="w-full px-4 py-3 rounded-xl text-sm" placeholder="Your talk/workshop topic"></div>';
  } else if (type === 'group_registration') {
    extra = '<div class="grid grid-cols-2 gap-4"><div><label class="text-xs text-gray-400 mb-1 block">Group Size</label><input type="number" id="cf-groupsize" min="2" class="w-full px-4 py-3 rounded-xl text-sm" placeholder="Number of people"></div><div><label class="text-xs text-gray-400 mb-1 block">Preferred Pass Type</label><select id="cf-passtype" class="w-full px-4 py-3 rounded-xl text-sm"><option value="">Select pass</option><option value="Delegate">Delegate (₹4,999)</option><option value="VIP">VIP (₹14,999)</option><option value="Academic">Academic (₹999)</option><option value="Visitor">Visitor (Free)</option><option value="Mixed">Mixed</option></select></div></div>';
  } else if (type === 'sponsorship') {
    extra = '<div><label class="text-xs text-gray-400 mb-1 block">Budget Range</label><select id="cf-budget" class="w-full px-4 py-3 rounded-xl text-sm"><option value="">Select range</option><option value="Under ₹1 Lakh">Under ₹1 Lakh</option><option value="₹1-3 Lakhs">₹1-3 Lakhs</option><option value="₹3-5 Lakhs">₹3-5 Lakhs</option><option value="₹5-10 Lakhs">₹5-10 Lakhs</option><option value="₹10+ Lakhs">₹10+ Lakhs</option></select></div>';
  }
  document.getElementById('cf-extra').innerHTML = extra;

  // Scroll to form
  document.getElementById('contact-form-card').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function submitContactForm(e) {
  e.preventDefault();
  const btn = document.getElementById('cf-submit');
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Submitting...';
  btn.disabled = true;

  const metadata = {};
  const booth = document.getElementById('cf-booth'); if (booth) metadata.booth_type = booth.value;
  // booth quantity removed — single booth per inquiry
  const zone = document.getElementById('cf-zone'); if (zone) metadata.preferred_zone = zone.value;
  const topic = document.getElementById('cf-topic'); if (topic) metadata.topic = topic.value;
  const gs = document.getElementById('cf-groupsize'); if (gs) metadata.group_size = gs.value;
  const pt = document.getElementById('cf-passtype'); if (pt) metadata.pass_type = pt.value;
  const bgt = document.getElementById('cf-budget'); if (bgt) metadata.budget = bgt.value;

  try {
    const resp = await fetch('/api/inquiries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inquiry_type: document.getElementById('cf-type').value,
        name: document.getElementById('cf-name').value.trim(),
        email: document.getElementById('cf-email').value.trim(),
        phone: document.getElementById('cf-phone').value.trim(),
        organization: document.getElementById('cf-org').value.trim(),
        subject: document.getElementById('cf-subject').value.trim(),
        message: document.getElementById('cf-message').value.trim(),
        metadata
      })
    });
    const data = await resp.json();
    if (!resp.ok) { showToast(data.error || 'Failed to submit', 'error'); btn.innerHTML = '<i class="fas fa-paper-plane mr-2"></i>Submit Inquiry'; btn.disabled = false; return; }

    document.getElementById('contact-form').classList.add('hidden');
    document.getElementById('cf-success').classList.remove('hidden');
    showToast('Inquiry submitted successfully!', 'success');
  } catch(err) {
    showToast('Network error. Please try again.', 'error');
    btn.innerHTML = '<i class="fas fa-paper-plane mr-2"></i>Submit Inquiry';
    btn.disabled = false;
  }
}

function resetContactForm() {
  document.getElementById('contact-form').reset();
  document.getElementById('contact-form').classList.remove('hidden');
  document.getElementById('cf-success').classList.add('hidden');
  document.getElementById('cf-extra').innerHTML = '';
  document.getElementById('cf-type').value = 'general';
  document.getElementById('cf-icon').className = 'fas fa-envelope text-lg text-primary-400';
  document.getElementById('cf-icon-box').className = 'w-10 h-10 rounded-xl bg-primary-500/20 flex items-center justify-center shrink-0';
  document.getElementById('cf-title').textContent = 'Send us a message';
  document.getElementById('cf-subtitle').textContent = 'Select an inquiry type above or fill the form directly';
  document.getElementById('cf-submit').innerHTML = '<i class="fas fa-paper-plane mr-2"></i>Submit Inquiry';
  document.getElementById('cf-submit').disabled = false;
}

// Auto-select type from URL hash
const hash = window.location.hash.replace('#', '');
if (hash && TYPE_CONFIG[hash]) selectType(hash);
</script>
</body>
</html>`
}

function registerPageHTML(): string {
  return `${sharedHeadHTML('Register Free', '/register', "Register free for Bharat AI Innovation 2026 — India's largest AI conference. Get your Visitor Pass in 30 seconds, or upgrade to Delegate/VIP. 20-21 Nov 2026, WTC Mumbai.")}
<body class="min-h-screen">
${sharedNavHTML('register')}

<main class="max-w-7xl mx-auto px-4 py-8">
  <!-- Hero -->
  <div class="text-center mb-8">
    <div class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold bg-primary-500/20 text-primary-300 border border-primary-500/30 mb-4">
      <i class="fas fa-ticket-alt"></i>FREE REGISTRATION OPEN
    </div>
    <h1 class="text-3xl md:text-4xl font-bold mb-3">Register for Bharat AI Innovation 2026</h1>
    <p class="text-gray-400 max-w-2xl mx-auto">Join India's largest AI conference at World Trade Center, Mumbai on 20-21 Nov 2026. Get your free Visitor Pass or upgrade to a premium pass.</p>
  </div>

  <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-5xl mx-auto">
    <!-- Registration Form -->
    <div>
      <div class="glass rounded-2xl p-6 md:p-8 border border-primary-500/20">
        <div class="flex items-center gap-3 mb-2">
          <div class="w-10 h-10 rounded-xl bg-primary-500/20 flex items-center justify-center shrink-0">
            <i class="fas fa-id-badge text-lg text-primary-400"></i>
          </div>
          <div>
            <h2 class="font-bold text-lg text-primary-300">Get Your Free Visitor Pass</h2>
            <p class="text-xs text-gray-400">Register in 30 seconds</p>
          </div>
        </div>
        <div class="text-center p-3 rounded-xl bg-primary-500/10 border border-primary-500/20 mb-5">
          <span class="text-primary-400 text-xs font-semibold"><i class="fas fa-check-circle mr-1"></i>Exhibition floor access & product demos — all free</span>
        </div>

        <form id="reg-form" onsubmit="submitRegistration(event)" class="space-y-4">
          <div>
            <label class="text-xs text-gray-400 mb-1 block">Full Name *</label>
            <input type="text" id="rf-name" required class="w-full px-4 py-3 rounded-xl text-sm" placeholder="Your full name">
          </div>
          <div>
            <label class="text-xs text-gray-400 mb-1 block">Email Address *</label>
            <input type="email" id="rf-email" required class="w-full px-4 py-3 rounded-xl text-sm" placeholder="your@email.com">
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="text-xs text-gray-400 mb-1 block">Mobile Number</label>
              <input type="tel" id="rf-phone" class="w-full px-4 py-3 rounded-xl text-sm" placeholder="+91 XXXXX XXXXX">
            </div>
            <div>
              <label class="text-xs text-gray-400 mb-1 block">Organization</label>
              <input type="text" id="rf-company" class="w-full px-4 py-3 rounded-xl text-sm" placeholder="Company / Institute">
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="text-xs text-gray-400 mb-1 block">Designation / Job Title</label>
              <input type="text" id="rf-title" class="w-full px-4 py-3 rounded-xl text-sm" placeholder="Your designation">
            </div>
            <div>
              <label class="text-xs text-gray-400 mb-1 block">City</label>
              <input type="text" id="rf-city" class="w-full px-4 py-3 rounded-xl text-sm" placeholder="Your city">
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="text-xs text-gray-400 mb-1 block">LinkedIn</label>
              <input type="url" id="rf-linkedin" class="w-full px-4 py-3 rounded-xl text-sm" placeholder="linkedin.com/in/...">
            </div>
            <div>
              <label class="text-xs text-gray-400 mb-1 block">Interests</label>
              <input type="text" id="rf-interests" class="w-full px-4 py-3 rounded-xl text-sm" placeholder="AI, ML, Computer Vision...">
            </div>
          </div>
          <button type="submit" id="rf-submit" class="w-full py-3.5 rounded-xl font-semibold text-white bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-500 hover:to-primary-400 transition-all text-sm shadow-lg shadow-primary-500/25">
            <i class="fas fa-check-circle mr-2"></i>Register — It's Free!
          </button>
          <p class="text-center text-[10px] text-gray-500">By registering, you agree to receive event updates via email</p>
        </form>

        <div id="reg-success" class="hidden text-center py-6">
          <div class="w-20 h-20 rounded-full bg-primary-500/20 flex items-center justify-center mx-auto mb-4">
            <i class="fas fa-check text-3xl text-primary-400"></i>
          </div>
          <h3 class="font-bold text-xl text-primary-300" id="rs-name"></h3>
          <p class="text-sm text-gray-300 mt-1" id="rs-ref"></p>
          <p class="text-xs text-gray-400 mt-2">Your Visitor Pass is confirmed. You can now access the networking app.</p>
          <div class="flex gap-3 justify-center mt-5">
            <a href="/app" id="rs-app-link" class="px-6 py-2.5 rounded-xl text-sm font-semibold bg-primary-500/20 text-primary-300 hover:bg-primary-500/30 transition"><i class="fas fa-rocket mr-2"></i>Open Networking App</a>
          </div>
        </div>

        <!-- Already registered? -->
        <div class="mt-4 pt-4 border-t border-white/10 text-center">
          <p class="text-xs text-gray-500">Already registered? <a href="/app" class="text-primary-400 hover:underline font-semibold">Sign in on the networking app</a></p>
        </div>
      </div>
    </div>

    <!-- Pass Info Sidebar -->
    <div class="space-y-4">
      <!-- Visitor Pass Details -->
      <div class="glass rounded-2xl p-6 border border-primary-500/20">
        <h3 class="font-bold text-lg text-primary-300 mb-3"><i class="fas fa-ticket-alt mr-2"></i>Visitor Pass — FREE</h3>
        <ul class="space-y-2 text-sm text-gray-300">
          <li><i class="fas fa-check text-primary-400 mr-2"></i>Exhibition floor access</li>
          <li><i class="fas fa-check text-primary-400 mr-2"></i>Product & startup demos</li>
          <li><i class="fas fa-check text-primary-400 mr-2"></i>Exhibition day activities</li>
        </ul>
      </div>

      <!-- Upgrade Options -->
      <div class="glass rounded-2xl p-6 border border-amber-500/20">
        <h3 class="font-bold text-base text-amber-300 mb-3"><i class="fas fa-arrow-up mr-2"></i>Want Full Conference Access?</h3>
        <p class="text-xs text-gray-400 mb-4">Upgrade to a paid pass for complete conference sessions, workshops, meals, and exclusive perks.</p>
        <div class="space-y-3">
          <div class="flex items-center justify-between p-3 rounded-xl bg-white/5">
            <div>
              <span class="text-sm font-semibold">🎟️ Delegate Pass</span>
              <p class="text-[10px] text-gray-400">Full 2-day conference + exhibition + networking</p>
            </div>
            <span class="text-sm font-bold text-primary-300">₹4,999</span>
          </div>
          <div class="flex items-center justify-between p-3 rounded-xl bg-white/5">
            <div>
              <span class="text-sm font-semibold">⭐ VIP Pass</span>
              <p class="text-[10px] text-gray-400">Everything + VIP lounge + speaker dinner</p>
            </div>
            <span class="text-sm font-bold text-amber-300">₹14,999</span>
          </div>
          <div class="flex items-center justify-between p-3 rounded-xl bg-white/5">
            <div>
              <span class="text-sm font-semibold">🎓 Academic Pass</span>
              <p class="text-[10px] text-gray-400">Conference + hackathon + student zone</p>
            </div>
            <span class="text-sm font-bold text-violet-300">₹999</span>
          </div>
        </div>
        <button onclick="openRegisterPaidPassModal()" class="mt-4 block w-full text-center py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 transition-all text-sm cursor-pointer">
          <i class="fas fa-external-link-alt mr-2"></i>Get Paid Pass
        </button>
      </div>

      <!-- Group Discount -->
      <div class="glass rounded-2xl p-6 border border-orange-500/20">
        <h3 class="font-bold text-base text-orange-300 mb-2"><i class="fas fa-users mr-2"></i>Group Registration</h3>
        <p class="text-xs text-gray-400 mb-3">Bringing a team of 5+? Save up to 30% with delegation packages.</p>
        <div class="flex gap-2">
          <a href="https://bharataiinnovation.com/register#delegation-section" target="_blank" class="px-4 py-2 rounded-lg text-xs font-semibold bg-orange-500/20 text-orange-300 hover:bg-orange-500/30 transition border border-orange-500/30">View Packages</a>
          <a href="/contact#group_registration" class="px-4 py-2 rounded-lg text-xs font-semibold glass text-gray-300 hover:bg-white/10 transition">Send Inquiry</a>
        </div>
      </div>
    </div>
  </div>
</main>

${sharedFooterHTML()}

<script>
${sharedToastJS()}

async function submitRegistration(e) {
  e.preventDefault();
  const btn = document.getElementById('rf-submit');
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Registering...';
  btn.disabled = true;

  try {
    const resp = await fetch('/api/events/1/attendees/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('rf-name').value.trim(),
        email: document.getElementById('rf-email').value.trim(),
        mobile: document.getElementById('rf-phone').value.trim(),
        company: document.getElementById('rf-company').value.trim(),
        job_title: document.getElementById('rf-title').value.trim(),
        city: document.getElementById('rf-city').value.trim(),
        linkedin_url: document.getElementById('rf-linkedin').value.trim(),
        interests: document.getElementById('rf-interests').value.trim(),
        bio: '',
        badge_type: 'Visitor Pass'
      })
    });
    const data = await resp.json();

    if (data.error) {
      showToast(data.error, 'error');
      btn.innerHTML = '<i class="fas fa-check-circle mr-2"></i>Register — It\\'s Free!';
      btn.disabled = false;
      return;
    }

    // Success
    document.getElementById('reg-form').classList.add('hidden');
    document.getElementById('reg-success').classList.remove('hidden');
    const refId = 'BHAI-2026-' + String(data.id).padStart(5, '0');
    document.getElementById('rs-name').textContent = 'Welcome, ' + data.name + '!';
    document.getElementById('rs-ref').textContent = 'Reference: ' + refId + ' · ' + data.email;
    document.getElementById('rs-app-link').href = '/app?email=' + encodeURIComponent(data.email);
    showToast('Registration successful!', 'success');
  } catch(err) {
    showToast('Network error. Please try again.', 'error');
    btn.innerHTML = '<i class="fas fa-check-circle mr-2"></i>Register — It\\'s Free!';
    btn.disabled = false;
  }
}

function openRegisterPaidPassModal() {
  document.getElementById('reg-paid-pass-modal').classList.remove('hidden');
  document.getElementById('reg-paid-pass-modal').classList.add('flex');
  document.body.style.overflow = 'hidden';
}
function closeRegisterPaidPassModal() {
  document.getElementById('reg-paid-pass-modal').classList.add('hidden');
  document.getElementById('reg-paid-pass-modal').classList.remove('flex');
  document.body.style.overflow = '';
}
async function submitRegisterPaidPassForm(e) {
  e.preventDefault();
  const btn = document.getElementById('rpp-submit-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Processing...';

  const name     = document.getElementById('rpp-name').value.trim();
  const email    = document.getElementById('rpp-email').value.trim();
  const phone    = document.getElementById('rpp-phone').value.trim();
  const company  = document.getElementById('rpp-company').value.trim();
  const desig    = document.getElementById('rpp-designation').value.trim();
  const city     = document.getElementById('rpp-city').value.trim();
  const passType = document.getElementById('rpp-pass-type').value;

  if (!name || !email || !passType) {
    alert('Please select a pass type and fill in Name & Email.');
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-arrow-right mr-2"></i>Proceed to Payment';
    return;
  }

  try {
    await fetch('/api/events/1/attendees/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, mobile: phone, company, job_title: desig, city, bio: '', interests: '', linkedin_url: '', badge_type: passType })
    });
  } catch(_) {}

  const params = new URLSearchParams({ name, email, phone, organization: company, designation: desig, city, pass_type: passType });
  window.open('https://municampus.com/event/BharatAI?' + params.toString(), '_blank');
  closeRegisterPaidPassModal();
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-arrow-right mr-2"></i>Proceed to Payment';
}
// Backdrop click handler set after DOM is ready
</script>

<!-- ===== PAID PASS MODAL (Register Page) ===== -->
<div id="reg-paid-pass-modal" class="fixed inset-0 z-50 hidden items-center justify-center p-4" style="background:rgba(0,0,0,0.75);backdrop-filter:blur(6px);">
  <div style="background:rgba(15,21,53,0.97);border:1px solid rgba(99,102,241,0.35);border-radius:18px;width:100%;max-width:520px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#1e1b4b,#312e81);padding:20px 24px;display:flex;align-items:center;justify-content:space-between;">
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="width:40px;height:40px;border-radius:10px;background:rgba(165,138,255,0.2);display:flex;align-items:center;justify-content:center;">
          <i class="fas fa-star" style="color:#fbbf24;font-size:18px;"></i>
        </div>
        <div>
          <div style="font-weight:700;color:white;font-size:16px;">Get Your Paid Pass</div>
          <div style="font-size:12px;color:#a5b4fc;">Fill details &amp; proceed to secure payment</div>
        </div>
      </div>
      <button onclick="closeRegisterPaidPassModal()" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:20px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:8px;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='none'">
        <i class="fas fa-times"></i>
      </button>
    </div>
    <div style="padding:24px;max-height:calc(90vh - 80px);overflow-y:auto;">
      <!-- Pass Type Selector -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px;">
        <label style="cursor:pointer;">
          <input type="radio" name="rpp-pass" value="Delegate Pass" style="display:none;" onchange="document.getElementById('rpp-pass-type').value=this.value;document.querySelectorAll('[data-rpp-card]').forEach(el=>{el.style.boxShadow='none';el.style.borderColor='rgba(139,92,246,0.2)'});this.nextElementSibling.style.boxShadow='0 0 0 2px #818cf8';this.nextElementSibling.style.borderColor='#818cf8'">
          <div data-rpp-card style="padding:12px;border-radius:12px;text-align:center;background:rgba(139,92,246,0.08);border:1px solid rgba(139,92,246,0.2);transition:all 0.2s;">
            <i class="fas fa-id-badge" style="color:#a78bfa;font-size:20px;display:block;margin-bottom:4px;"></i>
            <div style="color:white;font-weight:600;font-size:12px;">Delegate</div>
            <div style="color:#a78bfa;font-weight:700;font-size:14px;">&#8377;4,999</div>
            <div style="color:#64748b;font-size:10px;">Full 2-day access</div>
          </div>
        </label>
        <label style="cursor:pointer;">
          <input type="radio" name="rpp-pass" value="VIP Pass" style="display:none;" onchange="document.getElementById('rpp-pass-type').value=this.value;document.querySelectorAll('[data-rpp-card]').forEach(el=>{el.style.boxShadow='none';el.style.borderColor='rgba(251,191,36,0.2)'});this.nextElementSibling.style.boxShadow='0 0 0 2px #fbbf24';this.nextElementSibling.style.borderColor='#fbbf24'">
          <div data-rpp-card style="padding:12px;border-radius:12px;text-align:center;background:rgba(251,191,36,0.06);border:1px solid rgba(251,191,36,0.2);transition:all 0.2s;">
            <i class="fas fa-crown" style="color:#fbbf24;font-size:20px;display:block;margin-bottom:4px;"></i>
            <div style="color:white;font-weight:600;font-size:12px;">VIP</div>
            <div style="color:#fbbf24;font-weight:700;font-size:14px;">&#8377;14,999</div>
            <div style="color:#64748b;font-size:10px;">Lounge + dinner</div>
          </div>
        </label>
        <label style="cursor:pointer;">
          <input type="radio" name="rpp-pass" value="Academic Pass" style="display:none;" onchange="document.getElementById('rpp-pass-type').value=this.value;document.querySelectorAll('[data-rpp-card]').forEach(el=>{el.style.boxShadow='none';el.style.borderColor='rgba(192,132,252,0.2)'});this.nextElementSibling.style.boxShadow='0 0 0 2px #c084fc';this.nextElementSibling.style.borderColor='#c084fc'">
          <div data-rpp-card style="padding:12px;border-radius:12px;text-align:center;background:rgba(192,132,252,0.06);border:1px solid rgba(192,132,252,0.2);transition:all 0.2s;">
            <i class="fas fa-graduation-cap" style="color:#c084fc;font-size:20px;display:block;margin-bottom:4px;"></i>
            <div style="color:white;font-weight:600;font-size:12px;">Academic</div>
            <div style="color:#c084fc;font-weight:700;font-size:14px;">&#8377;999</div>
            <div style="color:#64748b;font-size:10px;">Students</div>
          </div>
        </label>
      </div>
      <input type="hidden" id="rpp-pass-type" value="">

      <form id="reg-paid-pass-form" onsubmit="submitRegisterPaidPassForm(event)" style="display:flex;flex-direction:column;gap:12px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:4px;">Full Name <span style="color:#f87171;">*</span></label>
            <input type="text" id="rpp-name" required placeholder="Your full name" style="width:100%;padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#e2e8f0;font-size:13px;outline:none;box-sizing:border-box;">
          </div>
          <div>
            <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:4px;">Email <span style="color:#f87171;">*</span></label>
            <input type="email" id="rpp-email" required placeholder="you@email.com" style="width:100%;padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#e2e8f0;font-size:13px;outline:none;box-sizing:border-box;">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:4px;">Mobile</label>
            <input type="tel" id="rpp-phone" placeholder="+91 XXXXX XXXXX" style="width:100%;padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#e2e8f0;font-size:13px;outline:none;box-sizing:border-box;">
          </div>
          <div>
            <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:4px;">Organization</label>
            <input type="text" id="rpp-company" placeholder="Company / Institute" style="width:100%;padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#e2e8f0;font-size:13px;outline:none;box-sizing:border-box;">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:4px;">Designation</label>
            <input type="text" id="rpp-designation" placeholder="Your designation" style="width:100%;padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#e2e8f0;font-size:13px;outline:none;box-sizing:border-box;">
          </div>
          <div>
            <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:4px;">City</label>
            <input type="text" id="rpp-city" placeholder="Your city" style="width:100%;padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#e2e8f0;font-size:13px;outline:none;box-sizing:border-box;">
          </div>
        </div>
        <button type="submit" id="rpp-submit-btn" style="width:100%;padding:13px;border-radius:10px;border:none;background:linear-gradient(135deg,#f97316,#ea580c);color:white;font-weight:700;font-size:14px;cursor:pointer;margin-top:4px;">
          <i class="fas fa-arrow-right" style="margin-right:8px;"></i>Proceed to Payment
        </button>
        <p style="text-align:center;font-size:10px;color:#475569;margin:0;">You will be redirected to our secure payment partner.</p>
      </form>
    </div>
  </div>
</div>

</body>
</html>`
}

// ==================== STANDALONE INQUIRY FORM PAGE ====================

function inquiryFormPageHTML(): string {
  return `${sharedHeadHTML('Book Your Booth', '/inquiry', "Exhibit at Bharat AI Innovation 2026. Book a booth to reach 5,000+ AI decision-makers at WTC Mumbai, 20-21 Nov 2026. Booths from ₹38,000.")}
<body class="min-h-screen">
${sharedNavHTML('inquiry')}

<main class="max-w-6xl mx-auto px-4 py-8">
  <!-- Hero -->
  <div class="text-center mb-8">
    <div class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 mb-4">
      <i class="fas fa-store"></i> EXHIBITION BOOKING OPEN
    </div>
    <h1 class="text-3xl md:text-4xl font-bold mb-3">Book Your Exhibition Booth</h1>
    <p class="text-gray-400 max-w-2xl mx-auto">Showcase your AI products & solutions at India's largest AI expo — World Trade Center, Mumbai | 20-21 Nov 2026</p>
  </div>

  <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">

    <!-- Booth Packages Panel (Left Column) -->
    <div class="lg:col-span-1 space-y-3">
      <h3 class="font-bold text-base text-amber-300 mb-2"><i class="fas fa-th-large mr-2"></i>Booth Packages</h3>

      <div class="booth-pkg glass rounded-xl p-4 border border-green-500/20 cursor-pointer hover:border-green-400/40 transition" onclick="selectBooth(this, 'Startup Pod - 1.5x1.5m - Rs.38,000')">
        <div class="flex items-center justify-between">
          <div>
            <span class="text-sm font-bold text-green-300">&#x1F680; Startup Pod</span>
            <p class="text-[10px] text-gray-400 mt-0.5">1.5 x 1.5 m (2.25 sqm)</p>
          </div>
          <span class="text-sm font-bold text-green-400">&#x20B9;38,000</span>
        </div>
      </div>

      <div class="booth-pkg glass rounded-xl p-4 border border-blue-500/20 cursor-pointer hover:border-blue-400/40 transition" onclick="selectBooth(this, 'Explorer Booth - 2x2m - Rs.1,25,000')">
        <div class="flex items-center justify-between">
          <div>
            <span class="text-sm font-bold text-blue-300">&#x1F50D; Explorer Booth</span>
            <p class="text-[10px] text-gray-400 mt-0.5">2 x 2 m (4 sqm)</p>
          </div>
          <span class="text-sm font-bold text-blue-400">&#x20B9;1,25,000</span>
        </div>
      </div>

      <div class="booth-pkg glass rounded-xl p-4 border border-primary-500/20 cursor-pointer hover:border-primary-400/40 transition" onclick="selectBooth(this, 'Innovator Booth - 3x2m - Rs.1,95,000')">
        <div class="flex items-center justify-between">
          <div>
            <span class="text-sm font-bold text-primary-300">&#x1F4A1; Innovator Booth</span>
            <p class="text-[10px] text-gray-400 mt-0.5">3 x 2 m (6 sqm)</p>
          </div>
          <span class="text-sm font-bold text-primary-400">&#x20B9;1,95,000</span>
        </div>
      </div>

      <div class="booth-pkg glass rounded-xl p-4 border border-violet-500/20 cursor-pointer hover:border-violet-400/40 transition" onclick="selectBooth(this, 'Accelerator Booth - 3x3m - Rs.2,91,000')">
        <div class="flex items-center justify-between">
          <div>
            <span class="text-sm font-bold text-violet-300">&#x26A1; Accelerator Booth</span>
            <p class="text-[10px] text-gray-400 mt-0.5">3 x 3 m (9 sqm)</p>
          </div>
          <span class="text-sm font-bold text-violet-400">&#x20B9;2,91,000</span>
        </div>
      </div>

      <div class="booth-pkg glass rounded-xl p-4 border border-orange-500/20 cursor-pointer hover:border-orange-400/40 transition" onclick="selectBooth(this, 'Enterprise Booth - 4x2m - Rs.2,58,000')">
        <div class="flex items-center justify-between">
          <div>
            <span class="text-sm font-bold text-orange-300">&#x1F3E2; Enterprise Booth</span>
            <p class="text-[10px] text-gray-400 mt-0.5">4 x 2 m (8 sqm)</p>
          </div>
          <span class="text-sm font-bold text-orange-400">&#x20B9;2,58,000</span>
        </div>
      </div>

      <div class="booth-pkg glass rounded-xl p-4 border border-amber-500/20 cursor-pointer hover:border-amber-400/40 transition" onclick="selectBooth(this, 'Flagship Pavilion - 6x2m - Rs.3,87,000')">
        <div class="flex items-center justify-between">
          <div>
            <span class="text-sm font-bold text-amber-300">&#x1F3DB; Flagship Pavilion</span>
            <p class="text-[10px] text-gray-400 mt-0.5">6 x 2 m (12 sqm)</p>
          </div>
          <span class="text-sm font-bold text-amber-400">&#x20B9;3,87,000</span>
        </div>
      </div>

      <div class="booth-pkg glass rounded-xl p-4 border border-rose-500/20 cursor-pointer hover:border-rose-400/40 transition" onclick="selectBooth(this, 'Mega Pavilion - 7x7.7m - Rs.17,40,000')">
        <div class="flex items-center justify-between">
          <div>
            <span class="text-sm font-bold text-rose-300">&#x1F451; Mega Pavilion</span>
            <p class="text-[10px] text-gray-400 mt-0.5">7 x 7.7 m (53.90 sqm)</p>
          </div>
          <span class="text-sm font-bold text-rose-400">&#x20B9;17,40,000</span>
        </div>
      </div>

      <!-- Quick Info -->
      <div class="glass rounded-xl p-4 mt-4 border border-white/5">
        <h4 class="text-xs font-bold text-gray-300 mb-2"><i class="fas fa-info-circle text-primary-400 mr-1.5"></i>All Booths Include</h4>
        <ul class="text-[10px] text-gray-400 space-y-1">
          <li><i class="fas fa-check text-green-400 mr-1.5"></i>Basic booth structure & branding</li>
          <li><i class="fas fa-check text-green-400 mr-1.5"></i>Electricity & Wi-Fi access</li>
          <li><i class="fas fa-check text-green-400 mr-1.5"></i>2 exhibitor badges per booth</li>
          <li><i class="fas fa-check text-green-400 mr-1.5"></i>Listing in event directory & app</li>
          <li><i class="fas fa-check text-green-400 mr-1.5"></i>AI Marketplace product listing</li>
        </ul>
      </div>
    </div>

    <!-- Inquiry Form (Right 2 Columns) -->
    <div class="lg:col-span-2">
      <div class="glass rounded-2xl p-6 md:p-8 border border-amber-500/20" id="inquiry-form-card">
        <div class="flex items-center gap-3 mb-6">
          <div class="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
            <i class="fas fa-store text-lg text-amber-400"></i>
          </div>
          <div>
            <h2 class="font-bold text-lg text-amber-300">Booth Inquiry Form</h2>
            <p class="text-xs text-gray-400">Select a booth package or fill in details below</p>
          </div>
        </div>

        <form id="inquiry-form" onsubmit="submitBoothInquiry(event)" class="space-y-4">

          <!-- Booth Selection -->
          <div>
            <label class="text-xs text-gray-400 mb-1 block">Booth Type *</label>
            <select id="iq-booth-type" required class="w-full px-4 py-3 rounded-xl text-sm">
              <option value="">Select booth type</option>
              <option value="Startup Pod - 1.5x1.5m - Rs.38,000">Startup Pod &#x2014; 1.5 x 1.5 m &#x2014; &#x20B9;38,000</option>
              <option value="Explorer Booth - 2x2m - Rs.1,25,000">Explorer Booth &#x2014; 2 x 2 m &#x2014; &#x20B9;1,25,000</option>
              <option value="Innovator Booth - 3x2m - Rs.1,95,000">Innovator Booth &#x2014; 3 x 2 m &#x2014; &#x20B9;1,95,000</option>
              <option value="Accelerator Booth - 3x3m - Rs.2,91,000">Accelerator Booth &#x2014; 3 x 3 m &#x2014; &#x20B9;2,91,000</option>
              <option value="Enterprise Booth - 4x2m - Rs.2,58,000">Enterprise Booth &#x2014; 4 x 2 m &#x2014; &#x20B9;2,58,000</option>
              <option value="Flagship Pavilion - 6x2m - Rs.3,87,000">Flagship Pavilion &#x2014; 6 x 2 m &#x2014; &#x20B9;3,87,000</option>
              <option value="Mega Pavilion - 7x7.7m - Rs.17,40,000">Mega Pavilion &#x2014; 7 x 7.7 m &#x2014; &#x20B9;17,40,000</option>
              <option value="Undecided">Not sure yet / Need consultation</option>
            </select>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>

            </div>
            <div>
              <label class="text-xs text-gray-400 mb-1 block">Preferred Zone</label>
              <select id="iq-zone" class="w-full px-4 py-3 rounded-xl text-sm">
                <option value="">Any zone</option>
                <option value="Main Hall">Main Hall</option>
                <option value="Innovation Hub">Innovation Hub</option>
                <option value="Startup Alley">Startup Alley</option>
                <option value="Enterprise Zone">Enterprise Zone</option>
              </select>
            </div>
          </div>

          <hr class="border-white/10">

          <!-- Contact Info -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="text-xs text-gray-400 mb-1 block">Contact Person *</label>
              <input type="text" id="iq-name" required class="w-full px-4 py-3 rounded-xl text-sm" placeholder="Your full name">
            </div>
            <div>
              <label class="text-xs text-gray-400 mb-1 block">Email Address *</label>
              <input type="email" id="iq-email" required class="w-full px-4 py-3 rounded-xl text-sm" placeholder="your@email.com">
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="text-xs text-gray-400 mb-1 block">Phone Number *</label>
              <input type="tel" id="iq-phone" required class="w-full px-4 py-3 rounded-xl text-sm" placeholder="+91 XXXXX XXXXX">
            </div>
            <div>
              <label class="text-xs text-gray-400 mb-1 block">Company / Organization *</label>
              <input type="text" id="iq-company" required class="w-full px-4 py-3 rounded-xl text-sm" placeholder="Company name">
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="text-xs text-gray-400 mb-1 block">Designation</label>
              <input type="text" id="iq-designation" class="w-full px-4 py-3 rounded-xl text-sm" placeholder="Your role / title">
            </div>
            <div>
              <label class="text-xs text-gray-400 mb-1 block">Website</label>
              <input type="url" id="iq-website" class="w-full px-4 py-3 rounded-xl text-sm" placeholder="https://yourcompany.com">
            </div>
          </div>
          <div>
            <label class="text-xs text-gray-400 mb-1 block">Industry / Domain</label>
            <select id="iq-industry" class="w-full px-4 py-3 rounded-xl text-sm">
              <option value="">Select industry</option>
              <option value="AI/ML">Artificial Intelligence / Machine Learning</option>
              <option value="IT/Software">IT / Software</option>
              <option value="Healthcare">Healthcare / MedTech</option>
              <option value="FinTech">FinTech / Banking</option>
              <option value="EdTech">EdTech / Education</option>
              <option value="Manufacturing">Manufacturing / Industry 4.0</option>
              <option value="Agriculture">AgriTech / Agriculture</option>
              <option value="Defense">Defense / Aerospace</option>
              <option value="Retail">Retail / E-commerce</option>
              <option value="Government">Government / Public Sector</option>
              <option value="Telecom">Telecom / IoT</option>
              <option value="Automotive">Automotive / EV</option>
              <option value="Energy">Energy / CleanTech</option>
              <option value="Logistics">Logistics / Supply Chain</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div>
            <label class="text-xs text-gray-400 mb-1 block">Products / Solutions to Showcase</label>
            <textarea id="iq-products" rows="2" class="w-full px-4 py-3 rounded-xl text-sm" placeholder="Brief description of what you plan to exhibit..."></textarea>
          </div>
          <div>
            <label class="text-xs text-gray-400 mb-1 block">Special Requirements / Questions</label>
            <textarea id="iq-message" rows="3" class="w-full px-4 py-3 rounded-xl text-sm" placeholder="Any specific requirements, questions, or preferences..."></textarea>
          </div>

          <!-- Price Summary -->
          <div id="iq-price-summary" class="hidden p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <div class="flex items-center justify-between">
              <div>
                <span class="text-xs text-gray-400">Selected Booth</span>
                <p class="text-sm font-bold text-amber-300" id="iq-summary-type"></p>
              </div>
              <div class="text-right">
                <span class="text-xs text-gray-400">Estimated Total</span>
                <p class="text-lg font-bold text-amber-400" id="iq-summary-price"></p>
              </div>
            </div>
            <p class="text-[10px] text-gray-500 mt-1">* Final pricing confirmed after review. GST extra as applicable.</p>
          </div>

          <button type="submit" id="iq-submit" class="w-full py-3.5 rounded-xl font-semibold text-white bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 transition-all text-sm shadow-lg shadow-amber-500/20">
            <i class="fas fa-paper-plane mr-2"></i>Submit Booth Inquiry
          </button>
          <p class="text-center text-[10px] text-gray-500">Our team will respond within 24 hours with booth availability and next steps.</p>
        </form>

        <!-- Success State -->
        <div id="iq-success" class="hidden text-center py-8">
          <div class="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
            <i class="fas fa-check text-3xl text-green-400"></i>
          </div>
          <h3 class="font-bold text-xl text-green-300">Booth Inquiry Submitted!</h3>
          <p class="text-sm text-gray-400 mt-2 max-w-md mx-auto">Thank you for your interest in exhibiting at Bharat AI Innovation 2026. Our exhibition team will review your request and contact you within 24 hours.</p>
          <p class="text-xs text-gray-500 mt-2">Reference: <span id="iq-ref" class="text-primary-400 font-mono"></span></p>
          <div class="flex gap-3 justify-center mt-6 flex-wrap">
            <button onclick="resetInquiryForm()" class="px-6 py-2.5 rounded-xl text-sm font-semibold glass hover:bg-white/10 transition"><i class="fas fa-plus mr-2"></i>Submit Another</button>
            <a href="/app" class="px-6 py-2.5 rounded-xl text-sm font-semibold bg-primary-500/20 text-primary-300 hover:bg-primary-500/30 transition"><i class="fas fa-rocket mr-2"></i>Explore Event</a>
            <a href="/marketplace" class="px-6 py-2.5 rounded-xl text-sm font-semibold bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition"><i class="fas fa-store mr-2"></i>AI Marketplace</a>
          </div>
        </div>
      </div>

      <!-- Why Exhibit Section -->
      <div class="glass rounded-2xl p-6 mt-6 border border-white/5">
        <h3 class="font-bold text-base text-white mb-4"><i class="fas fa-chart-line text-primary-400 mr-2"></i>Why Exhibit at BHAI 2026?</h3>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div class="text-center">
            <div class="text-2xl font-bold text-primary-400">10,000+</div>
            <div class="text-[10px] text-gray-400 mt-1">Expected Visitors</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-amber-400">200+</div>
            <div class="text-[10px] text-gray-400 mt-1">Exhibitors</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-green-400">50+</div>
            <div class="text-[10px] text-gray-400 mt-1">Countries</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-purple-400">2 Days</div>
            <div class="text-[10px] text-gray-400 mt-1">Full Access</div>
          </div>
        </div>
      </div>
    </div>

  </div>

  <!-- Quick Contact Bar -->
  <div class="max-w-6xl mx-auto mt-6">
    <div class="glass rounded-xl p-4 flex flex-wrap items-center justify-center gap-4 text-xs text-gray-400">
      <span><i class="fas fa-envelope text-amber-400 mr-1.5"></i>exhibition@bharataiinnovation.com</span>
      <span><i class="fas fa-globe text-amber-400 mr-1.5"></i><a href="https://bharataiinnovation.com" target="_blank" class="hover:text-white transition">bharataiinnovation.com</a></span>
      <span><i class="fas fa-map-marker-alt text-amber-400 mr-1.5"></i>WTC Mumbai, Cuffe Parade</span>
      <span><i class="fas fa-calendar text-amber-400 mr-1.5"></i>20-21 Nov 2026</span>
    </div>
  </div>
</main>

${sharedFooterHTML()}

<script>
${sharedToastJS()}

var BOOTH_PRICES = {
  'Startup Pod - 1.5x1.5m - Rs.38,000': { name: 'Startup Pod (1.5 x 1.5 m)', price: 38000 },
  'Explorer Booth - 2x2m - Rs.1,25,000': { name: 'Explorer Booth (2 x 2 m)', price: 125000 },
  'Innovator Booth - 3x2m - Rs.1,95,000': { name: 'Innovator Booth (3 x 2 m)', price: 195000 },
  'Accelerator Booth - 3x3m - Rs.2,91,000': { name: 'Accelerator Booth (3 x 3 m)', price: 291000 },
  'Enterprise Booth - 4x2m - Rs.2,58,000': { name: 'Enterprise Booth (4 x 2 m)', price: 258000 },
  'Flagship Pavilion - 6x2m - Rs.3,87,000': { name: 'Flagship Pavilion (6 x 2 m)', price: 387000 },
  'Mega Pavilion - 7x7.7m - Rs.17,40,000': { name: 'Mega Pavilion (7 x 7.7 m)', price: 1740000 }
};

function selectBooth(el, val) {
  document.getElementById('iq-booth-type').value = val;
  updatePriceSummary();
  document.getElementById('inquiry-form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.querySelectorAll('.booth-pkg').forEach(function(p) { p.style.outline = 'none'; });
  el.style.outline = '2px solid #fbbf24';
  el.style.outlineOffset = '2px';
}

function updatePriceSummary() {
  var sel = document.getElementById('iq-booth-type').value;
  var summary = document.getElementById('iq-price-summary');
  var info = BOOTH_PRICES[sel];

  if (info) {
    document.getElementById('iq-summary-type').textContent = info.name;
    document.getElementById('iq-summary-price').textContent = '\\u20B9' + info.price.toLocaleString('en-IN');
    summary.classList.remove('hidden');
  } else {
    summary.classList.add('hidden');
  }
}

document.getElementById('iq-booth-type').addEventListener('change', updatePriceSummary);

async function submitBoothInquiry(e) {
  e.preventDefault();
  var btn = document.getElementById('iq-submit');
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Submitting...';
  btn.disabled = true;

  var boothType = document.getElementById('iq-booth-type').value;
  var zone = document.getElementById('iq-zone').value;
  var info = BOOTH_PRICES[boothType];

  var metadata = {
    booth_type: boothType,
    booth_quantity: 1,
    preferred_zone: zone,
    estimated_total: info ? info.price : null,
    designation: document.getElementById('iq-designation').value.trim(),
    website: document.getElementById('iq-website').value.trim(),
    industry: document.getElementById('iq-industry').value,
    products_to_showcase: document.getElementById('iq-products').value.trim()
  };

  try {
    var resp = await fetch('/api/inquiries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inquiry_type: 'booth_inquiry',
        name: document.getElementById('iq-name').value.trim(),
        email: document.getElementById('iq-email').value.trim(),
        phone: document.getElementById('iq-phone').value.trim(),
        organization: document.getElementById('iq-company').value.trim(),
        subject: 'Booth Inquiry: ' + (boothType || 'General'),
        message: document.getElementById('iq-message').value.trim(),
        metadata: metadata
      })
    });
    var data = await resp.json();
    if (!resp.ok) {
      showToast(data.error || 'Failed to submit', 'error');
      btn.innerHTML = '<i class="fas fa-paper-plane mr-2"></i>Submit Booth Inquiry';
      btn.disabled = false;
      return;
    }

    document.getElementById('inquiry-form').classList.add('hidden');
    document.getElementById('iq-success').classList.remove('hidden');
    document.getElementById('iq-ref').textContent = 'BHAI-INQ-' + String(data.id).padStart(5, '0');
    showToast('Booth inquiry submitted successfully!', 'success');
  } catch(err) {
    showToast('Network error. Please try again.', 'error');
    btn.innerHTML = '<i class="fas fa-paper-plane mr-2"></i>Submit Booth Inquiry';
    btn.disabled = false;
  }
}

function resetInquiryForm() {
  document.getElementById('inquiry-form').reset();
  document.getElementById('inquiry-form').classList.remove('hidden');
  document.getElementById('iq-success').classList.add('hidden');
  document.getElementById('iq-price-summary').classList.add('hidden');
  document.getElementById('iq-submit').innerHTML = '<i class="fas fa-paper-plane mr-2"></i>Submit Booth Inquiry';
  document.getElementById('iq-submit').disabled = false;
  document.querySelectorAll('.booth-pkg').forEach(function(p) { p.style.outline = 'none'; });
}

// Check URL params for pre-selected booth type
var urlParams = new URLSearchParams(window.location.search);
var preselect = urlParams.get('booth');
if (preselect) {
  var matchKey = Object.keys(BOOTH_PRICES).find(function(k) { return k.toLowerCase().indexOf(preselect.toLowerCase()) !== -1; });
  if (matchKey) {
    document.getElementById('iq-booth-type').value = matchKey;
    updatePriceSummary();
  }
}
</script>
</body>
</html>`
}

// ==================== AI MARKETPLACE PAGES ====================

app.get('/marketplace', (c) => c.html(marketplacePageHTML()))
app.get('/marketplace/dashboard', (c) => c.html(marketplaceDashboardHTML()))
app.get('/marketplace/admin', (c) => c.html(marketplaceAdminHTML()))
app.get('/marketplace/faq', (c) => c.html(marketplaceFaqHTML()))
app.get('/marketplace/listing/:companySlug/:productSlug', (c) => {
  return c.html(marketplaceListingHTML(c.req.param('companySlug'), c.req.param('productSlug')))
})
app.get('/marketplace/listing/:id', (c) => {
  return c.html(marketplaceListingHTML(null, null, c.req.param('id')))
})

// ==================== ADMIN PAGE ====================

app.get('/admin', (c) => {
  return c.html(adminPageHTML())
})

// ==================== MAIN PAGE ====================

// The app's networking landing/SPA lives at /app. The root path (/) is served
// statically as the marketing index.html (see public/index.html + the
// _routes.json exclude in vite.config.ts), so the SEO-rich brochure is the
// front door and the app is one click in.
app.get('/app', (c) => {
  return c.html(mainPageHTML())
})

function mainPageHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bharat AI Innovation 2026 — Networking App</title>
  <meta name="description" content="Join the Bharat AI Innovation 2026 networking app — connect with 5,000+ AI leaders, book meetings, browse the marketplace, and manage your pass. 20-21 Nov 2026, WTC Mumbai.">
  <link rel="canonical" href="https://bharataiinnovation.com/app">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Bharat AI Innovation">
  <meta property="og:url" content="https://bharataiinnovation.com/app">
  <meta property="og:title" content="Bharat AI Innovation 2026 — Networking & Registration">
  <meta property="og:description" content="Register free and connect with 5,000+ AI researchers, founders, and CXOs at India's largest AI conference. 20-21 Nov 2026, WTC Mumbai.">
  <meta property="og:image" content="https://bharataiinnovation.com/images/og-card.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Bharat AI Innovation 2026 — Networking & Registration">
  <meta name="twitter:description" content="Register free and connect with 5,000+ AI leaders at India's largest AI conference. 20-21 Nov 2026, WTC Mumbai.">
  <meta name="twitter:image" content="https://bharataiinnovation.com/images/og-card.png">
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            primary: { 50:'#fff3e9',100:'#ffe0c7',200:'#ffc194',300:'#ff9d55',400:'#ff8524',500:'#FF6B00',600:'#e05a00',700:'#b84800',800:'#933a08',900:'#79300c' },
            accent: { 50:'#fdf4ff',100:'#fbe8ff',200:'#f5d0fe',300:'#f0abfc',400:'#e879f9',500:'#d946ef',600:'#c026d3',700:'#a21caf',800:'#86198f',900:'#701a75' },
            dark: { 700:'#1e2240',800:'#141730',900:'#0b0d1a' }
          }
        }
      }
    }
  </script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
    * { font-family: 'Inter', sans-serif; }
    body { background: #0b0d1a; color: #e2e8f0; }
    .glass { background: rgba(255,255,255,0.04); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.07); }
    .glass-light { background: rgba(255,255,255,0.07); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.10); }
    .glow { box-shadow: 0 0 30px rgba(245,98,10,0.15); }
    .glow-accent { box-shadow: 0 0 30px rgba(245,98,10,0.25); }
    .gradient-text { background: linear-gradient(120deg, #ff7c1f 0%, #f5620a 40%, #e8406c 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    .gradient-border { border-image: linear-gradient(135deg, #f5620a, #e8406c) 1; }
    .badge-pulse { animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
    .tab-active { background: linear-gradient(135deg, #f5620a, #c94040); color: white; }
    .card-hover { transition: all 0.3s ease; }
    .card-hover:hover { transform: translateY(-3px); box-shadow: 0 12px 40px rgba(245,98,10,0.15); }
    .online-dot { width: 10px; height: 10px; border-radius: 50%; background: #22c55e; display: inline-block; animation: pulse 2s infinite; }
    .offline-dot { width: 10px; height: 10px; border-radius: 50%; background: #64748b; display: inline-block; }
    .scroll-hide { -ms-overflow-style: none; scrollbar-width: none; }
    .scroll-hide::-webkit-scrollbar { display: none; }
    .modal-overlay { background: rgba(0,0,0,0.75); backdrop-filter: blur(6px); }
    .progress-bar { transition: width 0.5s ease; }
    .booth-platinum { border-left: 4px solid #f5620a; }
    .booth-premium { border-left: 4px solid #e8406c; }
    .booth-standard { border-left: 4px solid #64748b; }
    .hero-gradient { background: linear-gradient(160deg, #0b0d1a 0%, #10122a 30%, #16133a 60%, #0e1128 100%); }
    /* Animated node network background */
    .hero-nodes { position:absolute; inset:0; overflow:hidden; pointer-events:none; }
    .hero-nodes::before { content:''; position:absolute; inset:-50%; background: radial-gradient(ellipse at 72% 40%, rgba(245,98,10,0.10) 0%, transparent 55%), radial-gradient(ellipse at 25% 65%, rgba(59,100,200,0.08) 0%, transparent 50%), radial-gradient(ellipse at 50% 20%, rgba(180,100,220,0.06) 0%, transparent 45%); }
    .stat-card { transition: all 0.3s; }
    .stat-card:hover { transform: scale(1.05); }
    input, textarea, select { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.10); color: #e2e8f0; }
    input:focus, textarea:focus, select:focus { outline: none; border-color: #f5620a; box-shadow: 0 0 0 3px rgba(245,98,10,0.18); }
    select option { background: #141730; color: #e2e8f0; padding: 8px 12px; }
    select option:checked { background: #1e2240; }
    select option:hover { background: #1a1f3a; }
    select { -webkit-appearance: none; -moz-appearance: none; appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%239ca3af' d='M6 8L1 3h10z'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; padding-right: 32px; }
    .chat-bubble-sent { background: linear-gradient(135deg, #f5620a, #c94040); border-radius: 18px 18px 4px 18px; }
    .chat-bubble-received { background: rgba(255,255,255,0.07); border-radius: 18px 18px 18px 4px; }
    .shimmer { background: linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.03) 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    .animate-pulse-slow { animation: pulse-slow 2s ease-in-out infinite; }
    @keyframes pulse-slow { 0%, 100% { opacity: 1; } 50% { opacity: 0.8; } }
    .engagement-ring { position: relative; width: 120px; height: 120px; }
    .engagement-ring svg { transform: rotate(-90deg); }
    .engagement-ring circle { fill: none; stroke-width: 8; stroke-linecap: round; }
    .engagement-ring .bg-ring { stroke: rgba(255,255,255,0.06); }
    .engagement-ring .fg-ring { stroke: url(#engGrad); transition: stroke-dashoffset 1s ease; }
    .timeline-line { position: absolute; left: 19px; top: 40px; bottom: 0; width: 2px; background: rgba(255,255,255,0.06); }
    .profile-cover { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 40%, #0f3460 70%, #1a1a2e 100%); position: relative; overflow: hidden; }
    .profile-cover::before { content: ''; position: absolute; inset: 0; background: radial-gradient(circle at 30% 50%, rgba(76,110,245,0.15) 0%, transparent 60%), radial-gradient(circle at 70% 30%, rgba(255,152,0,0.1) 0%, transparent 50%); }
    .quick-action-btn { transition: all 0.2s ease; }
    .quick-action-btn:hover { transform: translateY(-2px); }
  </style>
</head>
<body class="min-h-screen">
  <!-- App Container -->
  <div id="app">
    <!-- Loading -->
    <div id="loading-screen" class="fixed inset-0 z-50 flex items-center justify-center" style="background:#0b0d1a;">
      <div class="text-center">
        <div class="mb-6"><img src="https://bharataiinnovation.com/images/Bharat%20AI%20Innovation%20Logo.png" alt="BHAI" class="w-20 h-20 mx-auto rounded-xl object-contain"></div>
        <h1 class="text-3xl font-bold gradient-text mb-2">Bharat AI Innovation 2026</h1>
        <p class="text-gray-400 mb-6">Loading your experience...</p>
        <div class="w-48 h-1 bg-gray-800 rounded-full mx-auto overflow-hidden">
          <div class="h-full bg-gradient-to-r from-primary-500 to-accent-500 rounded-full" style="width:60%;animation:loading 1.5s ease infinite"></div>
        </div>
      </div>
    </div>

    <!-- Registration / Sign In Modal -->
    <div id="registration-modal" class="fixed inset-0 z-40 modal-overlay hidden flex items-center justify-center p-4">
      <div class="glass rounded-2xl p-8 w-full max-w-md relative">
        <button onclick="document.getElementById('registration-modal').classList.add('hidden')" class="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors text-lg">
          <i class="fas fa-times"></i>
        </button>
        <div class="text-center mb-6">
          <img src="https://bharataiinnovation.com/images/Bharat%20AI%20Innovation%20Logo.png" alt="BHAI" class="w-20 h-20 mx-auto mb-3 rounded-xl object-contain">
          <h2 class="text-2xl font-bold gradient-text">Bharat AI Innovation 2026</h2>
          <p class="text-gray-400 mt-1 text-sm">Sign in to access networking, inbox & your profile</p>
        </div>

        <!-- Auth Mode Tabs -->
        <div class="flex mb-6 bg-white/5 rounded-xl p-1">
          <button id="auth-tab-signin" class="flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all tab-active" onclick="switchAuthMode('signin')">
            <i class="fas fa-sign-in-alt mr-1.5"></i>Sign In
          </button>
          <button id="auth-tab-register" class="flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all text-gray-400" onclick="switchAuthMode('register')">
            <i class="fas fa-user-plus mr-1.5"></i>Register
          </button>
        </div>

        <!-- Sign In Form -->
        <form id="signin-form" class="space-y-4">
          <div>
            <label class="text-xs text-gray-400 mb-1 block">Email Address</label>
            <input type="email" id="signin-email" placeholder="Enter your registered email" required class="w-full px-4 py-3 rounded-xl text-sm">
          </div>
          <button type="submit" class="w-full py-3 rounded-xl font-bold text-white transition-all hover:opacity-90" style="background:linear-gradient(135deg,#FF6B00,#e03060);box-shadow:0 4px 20px rgba(245,98,10,0.3);">
            <i class="fas fa-sign-in-alt mr-2"></i>Sign In
          </button>
          <div class="relative flex items-center my-3">
            <div class="flex-1 border-t border-white/10"></div>
            <span class="px-3 text-xs text-gray-500">or</span>
            <div class="flex-1 border-t border-white/10"></div>
          </div>
          <button type="button" onclick="sendMagicLink()" id="magic-link-btn" class="w-full py-3 rounded-xl font-semibold text-white transition-all text-sm hover:opacity-90" style="background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);">
            <i class="fas fa-magic mr-2"></i>Send Me a Login Link via Email
          </button>
          <div id="magic-link-success" class="hidden text-center text-sm text-green-400 mt-2 p-3 rounded-xl bg-green-500/10 border border-green-500/20">
            <i class="fas fa-check-circle mr-1"></i>Login link sent! Check your email inbox.
          </div>
          <div id="signin-error" class="hidden text-center text-sm text-red-400 mt-2"></div>
          <p class="text-center text-xs text-gray-500 mt-3">Don't have an account? <button type="button" onclick="switchAuthMode('register')" class="text-primary-400 hover:underline font-medium">Register here</button></p>
        </form>

        <!-- Register Form -->
        <form id="register-form" class="space-y-4 hidden">
          <div class="text-center mb-2 p-3 rounded-xl bg-primary-500/10 border border-primary-500/20">
            <span class="text-primary-400 text-xs font-semibold"><i class="fas fa-ticket-alt mr-1"></i>You will receive a FREE Visitor Pass</span>
          </div>
          <div><input type="text" id="reg-name" placeholder="Full Name *" required class="w-full px-4 py-3 rounded-xl text-sm"></div>
          <div><input type="email" id="reg-email" placeholder="Email Address *" required class="w-full px-4 py-3 rounded-xl text-sm"></div>
          <div class="grid grid-cols-2 gap-3">
            <input type="text" id="reg-company" placeholder="Company" class="px-4 py-3 rounded-xl text-sm">
            <input type="text" id="reg-title" placeholder="Job Title" class="px-4 py-3 rounded-xl text-sm">
          </div>
          <div class="grid grid-cols-2 gap-3">
            <input type="tel" id="reg-mobile" placeholder="Mobile Number" class="px-4 py-3 rounded-xl text-sm">
            <input type="url" id="reg-linkedin" placeholder="LinkedIn URL" class="px-4 py-3 rounded-xl text-sm">
          </div>
          <div><textarea id="reg-bio" placeholder="Short bio (optional)" rows="2" class="w-full px-4 py-3 rounded-xl text-sm"></textarea></div>
          <div><input type="text" id="reg-interests" placeholder="Interests (comma-separated)" class="w-full px-4 py-3 rounded-xl text-sm"></div>
          <button type="submit" class="w-full py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-500 hover:to-primary-400 transition-all">
            <i class="fas fa-user-plus mr-2"></i>Register & Get Visitor Pass
          </button>
          <div class="text-center p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <span class="text-amber-300 text-xs">Want Delegate or VIP access? <a href="https://bharataiinnovation.com/register" target="_blank" class="text-amber-400 hover:underline font-semibold">Upgrade here →</a></span>
          </div>
          <div id="register-error" class="hidden text-center text-sm text-red-400 mt-2"></div>
          <p class="text-center text-xs text-gray-500 mt-3">Already registered? <button type="button" onclick="switchAuthMode('signin')" class="text-primary-400 hover:underline font-medium">Sign in here</button></p>
        </form>
      </div>
    </div>

    <!-- Attendee Profile Modal -->
    <div id="profile-modal" class="fixed inset-0 z-40 modal-overlay hidden flex items-center justify-center p-4">
      <div class="glass rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto scroll-hide">
        <div class="flex justify-between items-start mb-4">
          <h2 class="text-xl font-bold" id="profile-name"></h2>
          <button onclick="closeProfileModal()" class="text-gray-400 hover:text-white"><i class="fas fa-times text-lg"></i></button>
        </div>
        <div id="profile-content"></div>
      </div>
    </div>

    <!-- Visitor Upgrade Modal -->
    <div id="visitor-upgrade-modal" class="fixed inset-0 z-50 hidden items-center justify-center p-4" style="background:rgba(0,0,0,0.82);backdrop-filter:blur(8px);">
      <div class="glass rounded-2xl p-8 w-full max-w-md relative text-center shadow-2xl border border-white/10">
        <!-- Lock icon -->
        <div class="w-20 h-20 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mx-auto mb-5">
          <i class="fas fa-lock text-amber-400 text-3xl"></i>
        </div>
        <h2 class="text-2xl font-bold mb-2">Networking is a Paid Feature</h2>
        <p class="text-gray-400 text-sm mb-6 leading-relaxed">
          Your <span class="text-white font-semibold">Visitor Pass</span> doesn't include access to the Networking Hub.<br>
          Upgrade to a <span class="text-primary-300 font-semibold">Delegate</span> or <span class="text-amber-300 font-semibold">VIP Pass</span> to connect with 500+ attendees, speakers, and investors.
        </p>
        <!-- Pass options -->
        <div class="grid grid-cols-2 gap-3 mb-6">
          <div class="glass-light rounded-xl p-4 border border-primary-500/20">
            <div class="text-2xl mb-1">🎫</div>
            <div class="font-bold text-primary-300 text-sm">Delegate Pass</div>
            <div class="text-xs text-gray-400 mt-0.5">₹4,999 / person</div>
            <ul class="text-[11px] text-gray-400 mt-2 space-y-0.5 text-left">
              <li><i class="fas fa-check text-green-400 mr-1"></i>Full networking access</li>
              <li><i class="fas fa-check text-green-400 mr-1"></i>Connect & message all</li>
              <li><i class="fas fa-check text-green-400 mr-1"></i>Schedule meetings</li>
            </ul>
          </div>
          <div class="glass-light rounded-xl p-4 border border-amber-500/30 relative">
            <div class="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 text-black">BEST</div>
            <div class="text-2xl mb-1">👑</div>
            <div class="font-bold text-amber-300 text-sm">VIP Pass</div>
            <div class="text-xs text-gray-400 mt-0.5">₹14,999 / person</div>
            <ul class="text-[11px] text-gray-400 mt-2 space-y-0.5 text-left">
              <li><i class="fas fa-check text-amber-400 mr-1"></i>Everything in Delegate</li>
              <li><i class="fas fa-check text-amber-400 mr-1"></i>VIP lounge access</li>
              <li><i class="fas fa-check text-amber-400 mr-1"></i>Speaker meet & greet</li>
            </ul>
          </div>
        </div>
        <a href="https://municampus.com/event/BharatAI" target="_blank"
           class="block w-full py-3.5 rounded-xl font-bold text-white text-sm transition-all mb-3"
           style="background:linear-gradient(135deg,#6366f1,#8b5cf6);">
          <i class="fas fa-arrow-up-right-from-square mr-2"></i>Upgrade My Pass — Get Full Access
        </a>
        <button onclick="document.getElementById('visitor-upgrade-modal').classList.add('hidden');document.getElementById('visitor-upgrade-modal').classList.remove('flex');"
          class="text-xs text-gray-500 hover:text-gray-300 transition">
          Maybe later — go back
        </button>
      </div>
    </div>

    <!-- Chat Modal -->
    <div id="chat-modal" class="fixed inset-0 z-40 modal-overlay hidden flex items-center justify-center p-4">
      <div class="glass rounded-2xl w-full max-w-lg h-[80vh] flex flex-col">
        <div class="flex items-center justify-between p-4 border-b border-white/10">
          <div>
            <h3 class="font-semibold" id="chat-partner-name"></h3>
            <p class="text-xs text-gray-400" id="chat-partner-company"></p>
          </div>
          <button onclick="closeChatModal()" class="text-gray-400 hover:text-white"><i class="fas fa-times text-lg"></i></button>
        </div>
        <div id="chat-messages" class="flex-1 overflow-y-auto p-4 space-y-3 scroll-hide"></div>
        <div class="p-4 border-t border-white/10">
          <form id="chat-form" class="flex gap-2">
            <input type="text" id="chat-input" placeholder="Type a message..." class="flex-1 px-4 py-2 rounded-xl text-sm">
            <button type="submit" class="px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-white"><i class="fas fa-paper-plane"></i></button>
          </form>
        </div>
      </div>
    </div>

    <!-- Meeting Modal -->
    <div id="meeting-modal" class="fixed inset-0 z-40 modal-overlay hidden flex items-center justify-center p-4">
      <div class="glass rounded-2xl p-6 w-full max-w-md">
        <div class="flex justify-between items-start mb-4">
          <h2 class="text-xl font-bold"><i class="fas fa-calendar-plus mr-2 text-primary-400"></i>Schedule Meeting</h2>
          <button onclick="closeMeetingModal()" class="text-gray-400 hover:text-white"><i class="fas fa-times text-lg"></i></button>
        </div>
        <form id="meeting-form" class="space-y-4">
          <input type="hidden" id="meeting-requestee-id">
          <div><input type="text" id="meeting-title" placeholder="Meeting Title *" required class="w-full px-4 py-3 rounded-xl text-sm"></div>
          <div><input type="datetime-local" id="meeting-time" required class="w-full px-4 py-3 rounded-xl text-sm"></div>
          <div class="grid grid-cols-2 gap-3">
            <select id="meeting-duration" class="px-4 py-3 rounded-xl text-sm">
              <option value="15">15 minutes</option>
              <option value="30" selected>30 minutes</option>
              <option value="45">45 minutes</option>
              <option value="60">1 hour</option>
            </select>
            <input type="text" id="meeting-location" placeholder="Location" class="px-4 py-3 rounded-xl text-sm">
          </div>
          <textarea id="meeting-notes" placeholder="Notes..." rows="2" class="w-full px-4 py-3 rounded-xl text-sm"></textarea>
          <button type="submit" class="w-full py-3 rounded-xl font-bold text-white transition-all hover:opacity-90" style="background:linear-gradient(135deg,#FF6B00,#e03060);box-shadow:0 4px 20px rgba(245,98,10,0.28);">
            <i class="fas fa-calendar-check mr-2"></i>Send Meeting Request
          </button>
        </form>
      </div>
    </div>

    <!-- Main Navigation -->
    <nav id="main-nav" class="hidden fixed bottom-0 left-0 right-0 z-30 md:top-0 md:bottom-auto" style="background:rgba(11,13,26,0.92);backdrop-filter:blur(24px);border-bottom:1px solid rgba(255,255,255,0.06);">
      <div class="max-w-7xl mx-auto px-4">
        <!-- Mobile nav: icon bar at bottom -->
        <div class="flex md:hidden items-center justify-around py-2">
          <button class="nav-btn tab-active flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-[10px] font-medium transition-all" data-tab="dashboard" onclick="switchTab('dashboard')">
            <i class="fas fa-th-large text-base"></i><span>Home</span>
          </button>
          <button class="nav-btn flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-[10px] font-medium text-gray-400 hover:text-white transition-all" data-tab="schedule" onclick="switchTab('schedule')">
            <i class="fas fa-calendar-alt text-base"></i><span>Schedule</span>
          </button>
          <button class="nav-btn auth-gated hidden flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-[10px] font-medium text-gray-400 hover:text-white transition-all" data-tab="networking" onclick="switchTab('networking')">
            <i class="fas fa-users text-base"></i><span>Network</span>
          </button>
          <button class="nav-btn flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-[10px] font-medium text-gray-400 hover:text-white transition-all" data-tab="workshops" onclick="switchTab('workshops')">
            <i class="fas fa-laptop-code text-base"></i><span>Workshops</span>
          </button>
          <a href="/marketplace" class="nav-btn flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-[10px] font-medium text-orange-400/80 hover:text-orange-300 transition-all no-underline">
            <i class="fas fa-robot text-base"></i><span>AI Market</span>
          </a>
          <button class="nav-btn auth-gated hidden flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-[10px] font-medium text-gray-400 hover:text-white transition-all relative" data-tab="inbox" onclick="switchTab('inbox')">
            <i class="fas fa-envelope text-base"></i><span>Inbox</span>
            <span id="unread-badge-mobile" class="hidden absolute -top-1 right-0 w-4 h-4 bg-red-500 text-white text-[9px] rounded-full flex items-center justify-center badge-pulse">0</span>
          </button>
          <button class="js-signin-btn nav-btn flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-[10px] font-semibold text-orange-400 hover:text-orange-300 transition-all" id="nav-signin-btn" onclick="showRegistration()">
            <i class="fas fa-sign-in-alt text-base"></i><span>Sign In</span>
          </button>
          <button class="hidden nav-btn flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-[10px] font-medium text-gray-400 hover:text-white transition-all" data-tab="myprofile" onclick="switchTab('myprofile')" id="nav-mobile-me">
            <i class="fas fa-id-badge text-base"></i><span>Me</span>
          </button>
        </div>

        <!-- Desktop nav: logo + links + CTA -->
        <div class="hidden md:flex items-center h-14 gap-6">
          <!-- Logo -->
          <a href="/app" class="flex items-center gap-2.5 hover:opacity-90 transition shrink-0">
            <img src="https://bharataiinnovation.com/images/Bharat%20AI%20Innovation%20Logo.png" alt="Bharat AI Innovation Logo" loading="eager" style="height:44px;width:auto;border-radius:12px;padding:6px;background:rgba(255,255,255,0.95);box-shadow:0 2px 8px rgba(0,0,0,0.08);">
            <div class="leading-tight">
              <div class="text-sm font-bold text-white">Bharat AI Innovation</div>
              <div class="text-[10px] text-gray-400">India's Largest AI Conference</div>
            </div>
          </a>

          <!-- Center nav pills -->
          <div class="flex items-center gap-0.5 flex-1 justify-center">
            <button class="nav-btn tab-active px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all" data-tab="dashboard" onclick="switchTab('dashboard')">Home</button>
            <button class="nav-btn px-3.5 py-1.5 rounded-full text-xs font-medium text-gray-300 hover:text-white hover:bg-white/8 transition-all" data-tab="schedule" onclick="switchTab('schedule')">Schedule</button>
            <button class="nav-btn auth-gated hidden px-3.5 py-1.5 rounded-full text-xs font-medium text-gray-300 hover:text-white hover:bg-white/8 transition-all" data-tab="networking" onclick="switchTab('networking')">Network</button>
            <button class="nav-btn px-3.5 py-1.5 rounded-full text-xs font-medium text-gray-300 hover:text-white hover:bg-white/8 transition-all" data-tab="workshops" onclick="switchTab('workshops')">Workshops</button>
            <a href="/marketplace" class="px-3.5 py-1.5 rounded-full text-xs font-medium text-gray-300 hover:text-white hover:bg-white/8 transition-all no-underline">AI Market</a>
            <a href="/inquiry" class="px-3.5 py-1.5 rounded-full text-xs font-medium text-gray-300 hover:text-white hover:bg-white/8 transition-all no-underline">Book Booth</a>
            <a href="/contact" class="px-3.5 py-1.5 rounded-full text-xs font-medium text-gray-300 hover:text-white hover:bg-white/8 transition-all no-underline">Contact</a>
            <a href="https://bharataiinnovation.com" target="_blank" class="px-3.5 py-1.5 rounded-full text-xs font-medium text-gray-300 hover:text-white hover:bg-white/8 transition-all no-underline">Main Site</a>
          </div>

          <!-- Right: inbox + sign-in/avatar -->
          <div class="flex items-center gap-2 shrink-0">
            <button class="nav-btn nav-gated hidden items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-gray-300 hover:text-white hover:bg-white/8 transition-all relative" data-tab="inbox" onclick="switchTab('inbox')">
              <i class="fas fa-envelope"></i><span>Inbox</span>
              <span id="unread-badge" class="hidden absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] rounded-full flex items-center justify-center badge-pulse">0</span>
            </button>
            <!-- Log In / Register button (opens combined modal; defaults to Sign In tab) -->
            <button class="js-signin-btn flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold text-white transition-all hover:opacity-90" id="nav-signin-btn-desktop" onclick="showRegistration()" style="background:linear-gradient(135deg,#FF6B00,#e03060);box-shadow:0 4px 15px rgba(255,107,0,0.35);">
              <i class="fas fa-sign-in-alt text-[11px]"></i> Log In / Register
            </button>
            <!-- Avatar + Log Out (visible when logged in) -->
            <button class="js-avatar-btn hidden nav-btn items-center gap-2 px-2 py-1 rounded-full text-sm font-medium text-gray-300 hover:text-white transition-all border border-white/10" data-tab="myprofile" onclick="switchTab('myprofile')" id="nav-avatar-btn">
              <img id="nav-avatar-img" src="https://ui-avatars.com/api/?name=U&size=36&background=FF6B00&color=fff&bold=true&rounded=true" alt="Profile" class="w-8 h-8 rounded-full object-cover border-2 border-orange-500/50">
              <span id="nav-avatar-name" class="max-w-[100px] truncate text-xs">Me</span>
            </button>
            <button class="js-avatar-btn hidden nav-btn items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium text-gray-400 hover:text-white transition-all border border-white/10" onclick="logoutUser()" id="nav-logout-btn" title="Log out">
              <i class="fas fa-sign-out-alt"></i><span class="hidden lg:inline">Log Out</span>
            </button>
          </div>
        </div>
      </div>
    </nav>

    <!-- Content Area -->
    <main id="content" class="hidden pb-24 md:pt-16 md:pb-8">
      <!-- Dashboard Tab -->
      <div id="tab-dashboard" class="tab-content">
        <!-- Hero -->
        <div class="hero-gradient relative overflow-hidden" style="min-height:360px;">
          <!-- Background layer: deep navy with subtle purple shift (matches reference) -->
          <div class="absolute inset-0" style="background:radial-gradient(ellipse 80% 60% at 70% 30%, rgba(60,40,120,0.22) 0%, transparent 70%),radial-gradient(ellipse 60% 80% at 20% 80%, rgba(30,25,80,0.18) 0%, transparent 60%);"></div>
          <!-- Ambient glows -->
          <div class="absolute inset-0 pointer-events-none">
            <div class="absolute -top-10 right-1/3 w-[500px] h-[500px] rounded-full filter blur-[140px]" style="background:rgba(245,98,10,0.09);"></div>
            <div class="absolute top-10 right-0 w-64 h-64 rounded-full filter blur-[100px]" style="background:rgba(228,89,156,0.07);"></div>
            <div class="absolute bottom-0 left-1/4 w-80 h-80 rounded-full filter blur-[120px]" style="background:rgba(59,80,200,0.07);"></div>
            <!-- SVG wireframe globe / neural net — exact reference style -->
            <svg class="absolute inset-0 w-full h-full" style="opacity:0.09;" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 400" preserveAspectRatio="xMidYMid slice">
              <defs>
                <radialGradient id="glb" cx="72%" cy="45%" r="32%">
                  <stop offset="0%" stop-color="#e8b090" stop-opacity="1"/>
                  <stop offset="100%" stop-color="#5080e8" stop-opacity="0.6"/>
                </radialGradient>
                <radialGradient id="glb2" cx="72%" cy="45%" r="32%">
                  <stop offset="0%" stop-color="#f5620a" stop-opacity="0.5"/>
                  <stop offset="100%" stop-color="#3b64c8" stop-opacity="0.2"/>
                </radialGradient>
              </defs>
              <!-- Globe circles (latitude-like ellipses centered right) -->
              <ellipse cx="860" cy="180" rx="260" ry="260" fill="none" stroke="url(#glb)" stroke-width="0.7"/>
              <ellipse cx="860" cy="180" rx="210" ry="260" fill="none" stroke="url(#glb)" stroke-width="0.5"/>
              <ellipse cx="860" cy="180" rx="120" ry="260" fill="none" stroke="url(#glb)" stroke-width="0.5"/>
              <ellipse cx="860" cy="180" rx="40" ry="260" fill="none" stroke="url(#glb)" stroke-width="0.4"/>
              <!-- Longitude arcs -->
              <ellipse cx="860" cy="180" rx="260" ry="80" fill="none" stroke="url(#glb)" stroke-width="0.5"/>
              <ellipse cx="860" cy="180" rx="260" ry="160" fill="none" stroke="url(#glb)" stroke-width="0.5"/>
              <ellipse cx="860" cy="180" rx="260" ry="230" fill="none" stroke="url(#glb)" stroke-width="0.4"/>
              <!-- Network connection lines (left side — neural lattice) -->
              <line x1="50" y1="60" x2="180" y2="140" stroke="url(#glb2)" stroke-width="0.7"/>
              <line x1="180" y1="140" x2="320" y2="90" stroke="url(#glb2)" stroke-width="0.7"/>
              <line x1="320" y1="90" x2="480" y2="170" stroke="url(#glb2)" stroke-width="0.6"/>
              <line x1="480" y1="170" x2="600" y2="110" stroke="url(#glb2)" stroke-width="0.6"/>
              <line x1="180" y1="140" x2="300" y2="240" stroke="url(#glb2)" stroke-width="0.6"/>
              <line x1="300" y1="240" x2="460" y2="300" stroke="url(#glb2)" stroke-width="0.6"/>
              <line x1="460" y1="300" x2="580" y2="250" stroke="url(#glb2)" stroke-width="0.5"/>
              <line x1="320" y1="90" x2="300" y2="240" stroke="url(#glb2)" stroke-width="0.5"/>
              <line x1="100" y1="280" x2="300" y2="240" stroke="url(#glb2)" stroke-width="0.5"/>
              <line x1="50" y1="60" x2="100" y2="280" stroke="url(#glb2)" stroke-width="0.4"/>
              <line x1="480" y1="170" x2="460" y2="300" stroke="url(#glb2)" stroke-width="0.5"/>
              <!-- Nodes -->
              <circle cx="50" cy="60" r="2.5" fill="#f5620a" opacity="0.8"/>
              <circle cx="180" cy="140" r="3" fill="#f5620a" opacity="0.9"/>
              <circle cx="320" cy="90" r="2.5" fill="#e8406c" opacity="0.8"/>
              <circle cx="480" cy="170" r="3" fill="#f5620a" opacity="0.9"/>
              <circle cx="600" cy="110" r="2" fill="#e8406c" opacity="0.7"/>
              <circle cx="300" cy="240" r="2.5" fill="#3b64c8" opacity="0.8"/>
              <circle cx="460" cy="300" r="2" fill="#3b64c8" opacity="0.7"/>
              <circle cx="100" cy="280" r="2" fill="#3b64c8" opacity="0.7"/>
              <circle cx="580" cy="250" r="2" fill="#f5620a" opacity="0.7"/>
            </svg>
          </div>

          <!-- Hero content: centered -->
          <div class="relative max-w-4xl mx-auto px-4 pt-10 pb-10 md:pt-16 md:pb-12 text-center">
            <!-- Date + location pill -->
            <div class="flex items-center justify-center gap-2 mb-5">
              <span class="px-3 py-1 rounded-full text-[11px] font-semibold tracking-widest uppercase" style="background:rgba(245,98,10,0.12);color:#f5a070;border:1px solid rgba(245,98,10,0.25);">NOV 20–21, 2026</span>
              <span class="text-gray-500 text-[11px] tracking-widest uppercase">World Trade Center Mumbai &nbsp;·&nbsp; India</span>
            </div>

            <!-- Title -->
            <h1 class="font-black leading-none tracking-tight mb-4" style="font-size:clamp(2.8rem,8vw,5.5rem);">
              <span style="background:linear-gradient(120deg,#ff7c1f 0%,#f5620a 40%,#e8406c 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">Bharat AI</span><br>
              <span class="text-white">Innovation</span>
            </h1>

            <!-- Subtitle -->
            <p class="text-sm md:text-base max-w-xl mx-auto mb-8" id="event-desc" style="color:#9ea8c8;">5,000+ researchers, founders, CXOs, and policymakers at WTC Mumbai<br class="hidden md:block"> — two days defining India's AI direction for the decade ahead.</p>

            <!-- CTA buttons -->
            <div class="flex items-center justify-center gap-3 flex-wrap">
              <button onclick="showRegistration()" class="flex items-center gap-2 px-6 py-3 rounded-full text-sm font-bold text-white transition hover:opacity-90" style="background:linear-gradient(135deg,#FF6B00,#e03060);box-shadow:0 6px 20px rgba(245,98,10,0.35);">Register Free <i class="fas fa-arrow-right text-xs"></i></button>
              <a href="https://bharataiinnovation.com" target="_blank" class="flex items-center gap-2 px-6 py-3 rounded-full text-sm font-semibold text-gray-200 transition hover:bg-white/10 no-underline" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);">Learn More</a>
            </div>

            <!-- Hidden fields for JS -->
            <div class="hidden" id="hero-venue-dates">
              <span id="event-venue"></span><span id="event-dates"></span>
            </div>
            <div class="hidden" id="event-title"></div>
          </div>
        </div>

        <!-- Stats (hidden until MIN_REGISTRATIONS) -->
        <div class="max-w-7xl mx-auto px-4 -mt-6 relative z-10 hidden" id="stats-section">
          <div class="grid grid-cols-3 md:grid-cols-6 gap-3" id="stats-grid"></div>
        </div>

        <!-- Venue Card (hidden until MIN_REGISTRATIONS) -->
        <div class="max-w-7xl mx-auto px-4 mt-6 hidden" id="venue-section">
          <div class="glass rounded-2xl p-5 border border-primary-500/15 card-hover">
            <div class="flex items-start gap-4">
              <div class="w-14 h-14 rounded-xl bg-gradient-to-br from-primary-500/20 to-blue-500/20 flex items-center justify-center shrink-0">
                <i class="fas fa-map-marked-alt text-2xl text-primary-400"></i>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="font-bold text-base mb-1">Venue</h3>
                <p class="text-sm text-gray-300 font-medium">World Trade Center Mumbai</p>
                <p class="text-xs text-gray-400 mt-0.5">Centre 1 Building, Cuffe Parade, Mumbai, Maharashtra 400005</p>
                <div class="flex flex-wrap gap-2 mt-3">
                  <a href="https://maps.google.com/?q=World+Trade+Centre+Mumbai+Cuffe+Parade" target="_blank" rel="noopener" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-primary-600 hover:bg-primary-500 text-white transition-all shadow-lg shadow-primary-500/20">
                    <i class="fas fa-directions"></i>Open in Google Maps
                  </a>
                  <a href="https://maps.google.com/?q=World+Trade+Centre+Mumbai+Cuffe+Parade" target="_blank" rel="noopener" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium glass hover:bg-white/10 text-gray-300 transition border border-white/10">
                    <i class="fas fa-share-alt"></i>Share Location
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- RSVP Confirmation Card -->
        <div class="max-w-7xl mx-auto px-4 mt-6 hidden" id="rsvp-card-container">
          <div class="glass rounded-2xl p-6 border border-amber-500/20" id="rsvp-card">
            <div class="flex items-start gap-4">
              <div class="w-14 h-14 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center shrink-0">
                <i class="fas fa-clipboard-check text-2xl text-amber-400"></i>
              </div>
              <div class="flex-1">
                <h3 class="font-bold text-base mb-1">Confirm Your Attendance</h3>
                <p class="text-xs text-gray-400 mb-4">Will you be attending <strong class="text-white">Bharat AI Innovation 2026</strong> on <strong class="text-white">20-21 Nov 2026</strong> at World Trade Center, Mumbai?</p>
                <div class="flex flex-wrap gap-2" id="rsvp-buttons">
                  <button onclick="submitRsvp('confirmed')" class="px-5 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white transition-all shadow-lg shadow-green-500/20"><i class="fas fa-check-circle mr-1.5"></i>Yes, I'll be there</button>
                  <button onclick="submitRsvp('maybe')" class="px-5 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white transition-all shadow-lg shadow-amber-500/20"><i class="fas fa-question-circle mr-1.5"></i>Not sure yet</button>
                  <button onclick="submitRsvp('declined')" class="px-5 py-2.5 rounded-xl text-sm font-semibold bg-white/10 hover:bg-white/15 text-gray-300 transition-all border border-white/10"><i class="fas fa-times-circle mr-1.5"></i>Can't make it</button>
                </div>
                <div id="rsvp-status-display" class="hidden mt-3"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Quick Actions: Delegate Pass + Arrival Time -->
        <div class="max-w-7xl mx-auto px-4 mt-6 hidden" id="home-quick-actions">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <!-- Download Delegate Pass Card -->
            <div class="glass rounded-2xl p-5 border border-green-500/20 card-hover cursor-pointer" onclick="generateDelegatePass()">
              <div class="flex items-center gap-4">
                <div class="w-14 h-14 rounded-xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center shrink-0">
                  <i class="fas fa-id-badge text-2xl text-green-400"></i>
                </div>
                <div class="flex-1">
                  <h3 class="font-bold text-base mb-0.5">Download Delegate Pass</h3>
                  <p class="text-xs text-gray-400">Get your official pass for entry at WTC Mumbai</p>
                </div>
                <i class="fas fa-download text-green-400 text-lg"></i>
              </div>
            </div>
            <!-- Arrival Time Card -->
            <div class="glass rounded-2xl p-5 border border-amber-500/20 card-hover cursor-pointer" onclick="showArrivalTimePrompt()" id="arrival-time-card">
              <div class="flex items-center gap-4">
                <div class="w-14 h-14 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center shrink-0">
                  <i class="fas fa-clock text-2xl text-amber-400"></i>
                </div>
                <div class="flex-1">
                  <h3 class="font-bold text-base mb-0.5" id="arrival-card-title">Set Your Arrival Time</h3>
                  <p class="text-xs text-gray-400" id="arrival-card-desc">Help us plan logistics – when will you arrive at the venue?</p>
                </div>
                <i class="fas fa-chevron-right text-amber-400 text-lg" id="arrival-card-icon"></i>
              </div>
            </div>
          </div>
        </div>

        <!-- Pass Comparison & Registration CTA -->
        <div class="max-w-7xl mx-auto px-4 py-8" id="pass-comparison-section">
          <div class="glass rounded-2xl p-6 md:p-8 glow-accent">
            <div class="text-center mb-6">
              <h2 class="text-2xl font-bold mb-2"><i class="fas fa-ticket-alt text-amber-400 mr-2"></i>Choose Your Pass</h2>
              <p class="text-gray-400 text-sm">Select the registration package that best fits your goals at Bharat AI Innovation 2026</p>
            </div>

            <!-- Pass Cards Grid -->
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
              <!-- Delegate Pass -->
              <div class="relative glass rounded-2xl p-5 border border-primary-500/30 hover:border-primary-400/50 transition-all group">
                <div class="absolute -top-2.5 right-3 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-gradient-to-r from-amber-500 to-orange-500 text-white">MOST POPULAR</div>
                <div class="text-2xl mb-2">🎟️</div>
                <h3 class="font-bold text-base text-primary-300">Delegate Pass</h3>
                <div class="text-xl font-black text-white mt-1">₹4,999<span class="text-xs font-normal text-gray-400">/person</span></div>
                <ul class="mt-3 space-y-1.5 text-xs text-gray-300">
                  <li><i class="fas fa-check text-green-400 mr-1.5 text-[10px]"></i>Full 2-day conference access</li>
                  <li><i class="fas fa-check text-green-400 mr-1.5 text-[10px]"></i>Exhibition floor pass</li>
                  <li><i class="fas fa-check text-green-400 mr-1.5 text-[10px]"></i>Conference materials & kit</li>
                  <li><i class="fas fa-check text-green-400 mr-1.5 text-[10px]"></i>Networking & startup zone</li>
                  <li><i class="fas fa-check text-green-400 mr-1.5 text-[10px]"></i>Lunch & refreshments</li>
                  <li><i class="fas fa-check text-green-400 mr-1.5 text-[10px]"></i>1 AI workshop (hands-on)</li>
                  <li><i class="fas fa-check text-green-400 mr-1.5 text-[10px]"></i>AI Marketplace access</li>
                  <li><i class="fas fa-check text-green-400 mr-1.5 text-[10px]"></i>Certificate of participation <span class="text-gray-500 text-[10px]">(workshop)</span></li>
                  <li><i class="fas fa-wifi text-primary-400 mr-1.5 text-[10px]"></i><span class="text-primary-300 font-semibold">Access to networking app</span></li>
                </ul>
              </div>

              <!-- VIP Pass -->
              <div class="glass rounded-2xl p-5 border border-amber-500/30 hover:border-amber-400/50 transition-all group">
                <div class="text-2xl mb-2">⭐</div>
                <h3 class="font-bold text-base text-amber-300">VIP Pass</h3>
                <div class="text-xl font-black text-white mt-1">₹14,999<span class="text-xs font-normal text-gray-400">/person</span></div>
                <ul class="mt-3 space-y-1.5 text-xs text-gray-300">
                  <li><i class="fas fa-id-badge text-amber-400 mr-1.5 text-[10px]"></i><span class="text-amber-300 font-semibold">VIP Badge</span></li>
                  <li><i class="fas fa-check text-green-400 mr-1.5 text-[10px]"></i>Everything in Delegate</li>
                  <li><i class="fas fa-check text-amber-400 mr-1.5 text-[10px]"></i>VIP lounge access</li>
                  <li><i class="fas fa-check text-amber-400 mr-1.5 text-[10px]"></i>Speaker meet & greet</li>
                  <li><i class="fas fa-check text-amber-400 mr-1.5 text-[10px]"></i>Priority front-row seating</li>
                  <li><i class="fas fa-check text-amber-400 mr-1.5 text-[10px]"></i>Exclusive VIP dinner</li>
                  <li><i class="fas fa-check text-amber-400 mr-1.5 text-[10px]"></i>AI image generation suite</li>
                  <li><i class="fas fa-check text-amber-400 mr-1.5 text-[10px]"></i>VIP networking zone</li>
                  <li><i class="fas fa-wifi text-primary-400 mr-1.5 text-[10px]"></i><span class="text-primary-300 font-semibold">Access to networking app</span></li>
                </ul>
              </div>

              <!-- Academic Pass -->
              <div class="glass rounded-2xl p-5 border border-violet-500/30 hover:border-violet-400/50 transition-all group">
                <div class="text-2xl mb-2">🎓</div>
                <h3 class="font-bold text-base text-violet-300">Academic Pass</h3>
                <div class="text-xl font-black text-white mt-1">₹999<span class="text-xs font-normal text-gray-400">/person</span></div>
                <div class="text-[10px] font-semibold text-violet-400 mt-0.5">Teachers, Students & researchers</div>
                <ul class="mt-3 space-y-1.5 text-xs text-gray-300">
                  <li><i class="fas fa-check text-green-400 mr-1.5 text-[10px]"></i>Full conference access</li>
                  <li><i class="fas fa-check text-green-400 mr-1.5 text-[10px]"></i>Exhibition floor pass</li>
                  <li><i class="fas fa-check text-green-400 mr-1.5 text-[10px]"></i>Networking & startup zone</li>
                  <li><i class="fas fa-check text-violet-400 mr-1.5 text-[10px]"></i>Hackathon participation</li>
                  <li><i class="fas fa-check text-violet-400 mr-1.5 text-[10px]"></i>1 workshop</li>
                  <li><i class="fas fa-check text-violet-400 mr-1.5 text-[10px]"></i>AI Marketplace access</li>
                  <li><i class="fas fa-check text-violet-400 mr-1.5 text-[10px]"></i>Certificate of participation</li>
                  <li><i class="fas fa-wifi text-primary-400 mr-1.5 text-[10px]"></i><span class="text-primary-300 font-semibold">Access to networking app</span></li>
                </ul>
              </div>

              <!-- Media Pass -->
              <div class="glass rounded-2xl p-5 border border-rose-500/30 hover:border-rose-400/50 transition-all group">
                <div class="text-2xl mb-2">📰</div>
                <h3 class="font-bold text-base text-rose-300">Media Pass</h3>
                <div class="text-xl font-black text-white mt-1">By Invite</div>
                <div class="text-[10px] font-semibold text-rose-400 mt-0.5">Journalists & media partners</div>
                <ul class="mt-3 space-y-1.5 text-xs text-gray-300">
                  <li><i class="fas fa-check text-green-400 mr-1.5 text-[10px]"></i>Full conference access</li>
                  <li><i class="fas fa-check text-green-400 mr-1.5 text-[10px]"></i>Exhibition floor pass</li>
                  <li><i class="fas fa-check text-green-400 mr-1.5 text-[10px]"></i>Networking & startup zone</li>
                  <li><i class="fas fa-check text-green-400 mr-1.5 text-[10px]"></i>Lunch & refreshments</li>
                  <li><i class="fas fa-check text-green-400 mr-1.5 text-[10px]"></i>Conference materials & kit</li>
                  <li><i class="fas fa-check text-rose-400 mr-1.5 text-[10px]"></i>Press/media area access</li>
                  <li><i class="fas fa-check text-rose-400 mr-1.5 text-[10px]"></i>Interview & recording rights</li>
                  <li><i class="fas fa-check text-rose-400 mr-1.5 text-[10px]"></i>Speaker meet & greet</li>
                </ul>
              </div>

              <!-- Visitor Pass (FREE) -->
              <div class="glass rounded-2xl p-5 border border-green-500/30 hover:border-green-400/50 transition-all group">
                <div class="text-2xl mb-2">🎫</div>
                <h3 class="font-bold text-base text-green-300">Visitor Pass</h3>
                <div class="text-xl font-black text-white mt-1">FREE</div>
                <div class="text-[10px] font-semibold text-green-400 mt-0.5">Open to all</div>
                <ul class="mt-3 space-y-1.5 text-xs text-gray-300">
                  <li><i class="fas fa-check text-green-400 mr-1.5 text-[10px]"></i>Exhibition floor access</li>
                  <li><i class="fas fa-check text-green-400 mr-1.5 text-[10px]"></i>Exhibition day activities</li>
                  <li><i class="fas fa-check text-green-400 mr-1.5 text-[10px]"></i>AI Marketplace browsing</li>
                </ul>
              </div>
            </div>

            <!-- Bringing a Team Banner -->
            <div class="glass rounded-xl p-4 border border-orange-500/20 mb-6">
              <div class="flex items-center gap-3">
                <span class="text-2xl">👥</span>
                <div class="flex-1">
                  <p class="text-sm font-semibold text-orange-300">Bringing a team? Save up to 30%!</p>
                  <p class="text-xs text-gray-400 mt-0.5">Check Delegation Packages for group discounts on 5+ registrations</p>
                </div>
                <a href="https://bharataiinnovation.com/register#delegation-section" target="_blank" class="px-4 py-2 rounded-lg text-xs font-semibold bg-orange-500/20 text-orange-300 hover:bg-orange-500/30 transition border border-orange-500/30">
                  <i class="fas fa-users mr-1"></i>View Packages
                </a>
              </div>
            </div>

            <!-- Full Comparison Table -->
            <div class="mb-6">
              <div class="flex items-center gap-2 mb-3">
                <i class="fas fa-table text-xs text-primary-300"></i>
                <span class="text-sm font-semibold text-primary-300">Full Pass Comparison</span>
                <span class="ml-auto flex items-center gap-3 text-[10px] text-gray-500">
                  <span><span class="text-green-400 mr-1">✔</span>Included</span>
                  <span><span class="text-amber-400 mr-1">✔</span>VIP only</span>
                  <span><span class="text-rose-400 mr-1">✔</span>Media only</span>
                  <span><span class="text-gray-500 mr-1">○</span>Not included</span>
                </span>
              </div>
              <div class="overflow-x-auto mt-2">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="border-b border-white/10">
                      <th class="text-left py-3 px-2 text-gray-400 font-medium text-xs">Feature</th>
                      <th class="py-3 px-2 text-center text-green-400 font-bold text-xs">Visitor<br><span class="font-normal text-green-300">FREE</span></th>
                      <th class="py-3 px-2 text-center text-primary-400 font-bold text-xs">Delegate<br><span class="font-normal text-primary-300">₹4,999</span></th>
                      <th class="py-3 px-2 text-center text-amber-400 font-bold text-xs">VIP<br><span class="font-normal text-amber-300">₹14,999</span></th>
                      <th class="py-3 px-2 text-center text-violet-400 font-bold text-xs">Academic<br><span class="font-normal text-violet-300">₹999</span></th>
                      <th class="py-3 px-2 text-center text-rose-400 font-bold text-xs">Media<br><span class="font-normal text-rose-300">By Invite</span></th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-white/5 text-xs">
                    <!-- Access -->
                    <tr class="bg-white/[0.02]"><td class="py-1.5 px-2 text-gray-500 font-semibold uppercase tracking-wider text-[10px]" colspan="6">Access</td></tr>
                    <tr><td class="py-2 px-2 text-gray-300">Exhibition Floor Access</td><td class="py-2 px-2 text-center text-green-400">✔</td><td class="py-2 px-2 text-center text-green-400">✔</td><td class="py-2 px-2 text-center text-green-400">✔</td><td class="py-2 px-2 text-center text-green-400">✔</td><td class="py-2 px-2 text-center text-green-400">✔</td></tr>
                    <tr><td class="py-2 px-2 text-gray-300">Conference Sessions</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-green-400">✔</td><td class="py-2 px-2 text-center text-green-400">✔</td><td class="py-2 px-2 text-center text-green-400">✔</td><td class="py-2 px-2 text-center text-green-400">✔</td></tr>
                    <tr><td class="py-2 px-2 text-gray-300">Networking & Startup Zone</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-green-400">✔</td><td class="py-2 px-2 text-center text-green-400">✔</td><td class="py-2 px-2 text-center text-green-400">✔</td><td class="py-2 px-2 text-center text-green-400">✔</td></tr>
                    <tr><td class="py-2 px-2 text-gray-300">AI Marketplace Access</td><td class="py-2 px-2 text-center text-green-400">✔</td><td class="py-2 px-2 text-center text-green-400">✔</td><td class="py-2 px-2 text-center text-green-400">✔</td><td class="py-2 px-2 text-center text-green-400">✔</td><td class="py-2 px-2 text-center text-green-400">✔</td></tr>
                    <!-- Benefits -->
                    <tr class="bg-white/[0.02]"><td class="py-1.5 px-2 text-gray-500 font-semibold uppercase tracking-wider text-[10px]" colspan="6">Benefits</td></tr>
                    <tr><td class="py-2 px-2 text-gray-300">Conference Materials & Kit</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-green-400">✔</td><td class="py-2 px-2 text-center text-green-400">✔</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-green-400">✔</td></tr>
                    <tr><td class="py-2 px-2 text-gray-300">Lunch & Refreshments</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-green-400">✔</td><td class="py-2 px-2 text-center text-green-400">✔</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-green-400">✔</td></tr>
                    <tr><td class="py-2 px-2 text-gray-300">Certificate of Participation</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-green-400">✔</td><td class="py-2 px-2 text-center text-green-400">✔</td><td class="py-2 px-2 text-center text-green-400">✔</td><td class="py-2 px-2 text-center text-green-400">✔</td></tr>
                    <tr><td class="py-2 px-2 text-gray-300">Speaker Meet & Greet</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-green-400">✔</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-green-400">✔</td></tr>
                    <tr><td class="py-2 px-2 text-gray-300">Digital Recordings Access</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-green-400">✔</td><td class="py-2 px-2 text-center text-green-400">✔</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-green-400">✔</td></tr>
                    <tr><td class="py-2 px-2 text-gray-300"><i class="fas fa-wifi text-primary-400 mr-1"></i>Networking App Access</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-green-400">✔</td><td class="py-2 px-2 text-center text-green-400">✔</td><td class="py-2 px-2 text-center text-green-400">✔</td><td class="py-2 px-2 text-center text-gray-600">○</td></tr>
                    <!-- Learning & Activities -->
                    <tr class="bg-white/[0.02]"><td class="py-1.5 px-2 text-gray-500 font-semibold uppercase tracking-wider text-[10px]" colspan="6">Learning & Activities</td></tr>
                    <tr><td class="py-2 px-2 text-gray-300">AI Workshops (Hands-on)</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-green-400">✔</td><td class="py-2 px-2 text-center text-green-400">✔</td><td class="py-2 px-2 text-center text-green-400">✔</td><td class="py-2 px-2 text-center text-gray-600">○</td></tr>
                    <tr><td class="py-2 px-2 text-gray-300">Hackathon Participation</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-green-400">✔</td><td class="py-2 px-2 text-center text-gray-600">○</td></tr>
                    <tr><td class="py-2 px-2 text-gray-300">Student Networking Zone</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-green-400">✔</td><td class="py-2 px-2 text-center text-gray-600">○</td></tr>
                    <!-- VIP Exclusive -->
                    <tr class="bg-white/[0.02]"><td class="py-1.5 px-2 text-gray-500 font-semibold uppercase tracking-wider text-[10px]" colspan="6">VIP Exclusive</td></tr>
                    <tr><td class="py-2 px-2 text-gray-300">VIP Lounge & Priority Seating</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-amber-400">✔</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-gray-600">○</td></tr>
                    <tr><td class="py-2 px-2 text-gray-300">Exclusive VIP Dinner</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-amber-400">✔</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-gray-600">○</td></tr>
                    <tr><td class="py-2 px-2 text-gray-300">AI Image Generation Suite</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-amber-400">✔</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-gray-600">○</td></tr>
                    <tr><td class="py-2 px-2 text-gray-300">VIP Student Networking Zone</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-amber-400">✔</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-gray-600">○</td></tr>
                    <!-- Media Exclusive -->
                    <tr class="bg-white/[0.02]"><td class="py-1.5 px-2 text-gray-500 font-semibold uppercase tracking-wider text-[10px]" colspan="6">Media Exclusive</td></tr>
                    <tr><td class="py-2 px-2 text-gray-300">Press/Media Area Access</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-rose-400">✔</td></tr>
                    <tr><td class="py-2 px-2 text-gray-300">Interview & Recording Rights</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-gray-600">○</td><td class="py-2 px-2 text-center text-rose-400">✔</td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- CTA Buttons -->
            <div class="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button onclick="openQuickVisitorReg()" class="px-6 py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-500 hover:to-primary-400 transition-all text-sm shadow-lg shadow-primary-500/25 animate-pulse-slow">
                <i class="fas fa-ticket-alt mr-2"></i>Register Free — Visitor Pass
              </button>
              <button onclick="openPaidPassForm()" class="px-6 py-3 rounded-xl font-bold text-white transition-all text-sm hover:opacity-90" style="background:linear-gradient(135deg,#FF6B00,#e03060);box-shadow:0 4px 20px rgba(245,98,10,0.28);">
                <i class="fas fa-star mr-2"></i>Get Paid Pass (Delegate/VIP)
              </button>
              <a href="https://bharataiinnovation.com/register#delegation-section" target="_blank" class="px-6 py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 transition-all text-sm">
                <i class="fas fa-users mr-2"></i>Group Packages
              </a>
            </div>
          </div>
        </div>

        <!-- Quick Visitor Registration Section -->
        <div class="max-w-7xl mx-auto px-4 py-6" id="quick-visitor-reg-section">
          <div class="glass rounded-2xl p-6 md:p-8 border border-green-500/20 glow-accent" id="quick-visitor-reg-card">
            <div class="flex items-center gap-3 mb-4">
              <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center shrink-0">
                <i class="fas fa-id-badge text-2xl text-green-400"></i>
              </div>
              <div>
                <h2 class="text-xl font-bold text-green-300">Get Your Free Visitor Pass</h2>
                <p class="text-xs text-gray-400">Register in 30 seconds — access the exhibition floor and explore AI innovations</p>
              </div>
            </div>
            <form id="quick-visitor-form" onsubmit="submitQuickVisitorReg(event)" class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><input type="text" id="qv-name" placeholder="Full Name *" required class="w-full px-4 py-3 rounded-xl text-sm"></div>
              <div><input type="email" id="qv-email" placeholder="Email Address *" required class="w-full px-4 py-3 rounded-xl text-sm"></div>
              <div><input type="tel" id="qv-phone" placeholder="Mobile Number" class="w-full px-4 py-3 rounded-xl text-sm"></div>
              <div><input type="text" id="qv-company" placeholder="Organization / Company" class="w-full px-4 py-3 rounded-xl text-sm"></div>
              <div><input type="text" id="qv-designation" placeholder="Designation / Job Title" class="w-full px-4 py-3 rounded-xl text-sm"></div>
              <div><input type="text" id="qv-city" placeholder="City" class="w-full px-4 py-3 rounded-xl text-sm"></div>
              <div class="md:col-span-2 flex flex-col sm:flex-row gap-3 items-center">
                <button type="submit" id="qv-submit-btn" class="w-full sm:w-auto px-8 py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-500 hover:to-primary-400 transition-all text-sm shadow-lg shadow-primary-500/25">
                  <i class="fas fa-check-circle mr-2"></i>Register — It's Free!
                </button>
                <span class="text-xs text-gray-500">By registering, you agree to receive event updates</span>
              </div>
            </form>
            <div id="qv-success" class="hidden mt-4 p-4 rounded-xl bg-green-500/10 border border-green-500/20 text-center">
              <i class="fas fa-check-circle text-green-400 text-3xl mb-2"></i>
              <h3 class="font-bold text-green-300 text-lg" id="qv-success-name"></h3>
              <p class="text-sm text-gray-300 mt-1" id="qv-success-msg"></p>
            </div>
            <div class="mt-4 pt-4 border-t border-white/5 flex flex-wrap gap-4 items-center justify-center text-xs text-gray-500">
              <span><i class="fas fa-store text-green-500 mr-1"></i>Exhibition Floor Access</span>
              <span><i class="fas fa-laptop text-green-500 mr-1"></i>Product & Startup Demos</span>
              <span><i class="fas fa-building text-green-500 mr-1"></i>Exhibition Day Activities</span>
              <span><i class="fas fa-calendar text-green-500 mr-1"></i>20-21 Nov 2026</span>
              <span><i class="fas fa-map-marker-alt text-green-500 mr-1"></i>WTC Mumbai</span>
            </div>
          </div>
        </div>

        <!-- Exhibition & Inquiry Section -->
        <div class="max-w-7xl mx-auto px-4 py-4">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <!-- Exhibit With Us Card -->
            <div class="glass rounded-2xl p-6 border border-amber-500/20 card-hover">
              <div class="flex items-center gap-3 mb-4">
                <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center shrink-0">
                  <i class="fas fa-store text-2xl text-amber-400"></i>
                </div>
                <div>
                  <h3 class="font-bold text-lg text-amber-300">Exhibit With Us</h3>
                  <p class="text-xs text-gray-400">Showcase your AI solutions at India's largest AI expo</p>
                </div>
              </div>
              <ul class="space-y-1.5 text-xs text-gray-300 mb-4">
                <li><i class="fas fa-check text-amber-400 mr-1.5 text-[10px]"></i>7 booth packages: Startup Pod to Mega Pavilion</li>
                <li><i class="fas fa-check text-amber-400 mr-1.5 text-[10px]"></i>500+ decision-makers visiting exhibition floor</li>
                <li><i class="fas fa-check text-amber-400 mr-1.5 text-[10px]"></i>Live demo area, networking lounge, branding</li>
              </ul>
              <div class="flex gap-2">
                <button onclick="switchTab('exhibition'); setTimeout(()=>switchExhibitionSubtab('booth-catalog'),100)" class="px-4 py-2 rounded-lg text-xs font-semibold bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition border border-amber-500/30">
                  <i class="fas fa-th-large mr-1"></i>View Booth Packages
                </button>
                <button onclick="openInquiryForm('exhibition')" class="px-4 py-2 rounded-lg text-xs font-semibold bg-white/5 text-gray-300 hover:bg-white/10 transition border border-white/10">
                  <i class="fas fa-envelope mr-1"></i>Send Inquiry
                </button>
              </div>
            </div>

            <!-- Contact / General Inquiry Card -->
            <div class="glass rounded-2xl p-6 border border-primary-500/20 card-hover">
              <div class="flex items-center gap-3 mb-4">
                <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-primary-500/20 to-blue-500/20 flex items-center justify-center shrink-0">
                  <i class="fas fa-headset text-2xl text-primary-400"></i>
                </div>
                <div>
                  <h3 class="font-bold text-lg text-primary-300">Have a Question?</h3>
                  <p class="text-xs text-gray-400">Reach out — we're happy to help</p>
                </div>
              </div>
              <div class="grid grid-cols-2 gap-2 mb-4">
                <button onclick="openInquiryForm('general')" class="p-2.5 rounded-lg text-xs font-medium glass hover:bg-white/10 transition text-left">
                  <i class="fas fa-question-circle text-primary-400 mr-1.5"></i>General Inquiry
                </button>
                <button onclick="openInquiryForm('sponsorship')" class="p-2.5 rounded-lg text-xs font-medium glass hover:bg-white/10 transition text-left">
                  <i class="fas fa-handshake text-amber-400 mr-1.5"></i>Sponsorship
                </button>
                <button onclick="openInquiryForm('speaking')" class="p-2.5 rounded-lg text-xs font-medium glass hover:bg-white/10 transition text-left">
                  <i class="fas fa-microphone-alt text-purple-400 mr-1.5"></i>Speaking Slot
                </button>
                <button onclick="openInquiryForm('media')" class="p-2.5 rounded-lg text-xs font-medium glass hover:bg-white/10 transition text-left">
                  <i class="fas fa-newspaper text-rose-400 mr-1.5"></i>Media / Press
                </button>
                <button onclick="openInquiryForm('group_registration')" class="p-2.5 rounded-lg text-xs font-medium glass hover:bg-white/10 transition text-left">
                  <i class="fas fa-users text-green-400 mr-1.5"></i>Group Booking
                </button>
                <button onclick="openInquiryForm('other')" class="p-2.5 rounded-lg text-xs font-medium glass hover:bg-white/10 transition text-left">
                  <i class="fas fa-ellipsis-h text-gray-400 mr-1.5"></i>Other
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Inquiry Form Modal -->
        <div id="inquiry-modal" class="fixed inset-0 z-40 modal-overlay hidden flex items-center justify-center p-4">
          <div class="glass rounded-2xl p-6 md:p-8 w-full max-w-lg relative">
            <button onclick="closeInquiryForm()" class="absolute top-4 right-4 text-gray-400 hover:text-white transition text-lg"><i class="fas fa-times"></i></button>
            <div class="flex items-center gap-3 mb-5">
              <div class="w-10 h-10 rounded-xl bg-primary-500/20 flex items-center justify-center shrink-0" id="inq-icon-box"><i class="fas fa-envelope text-lg text-primary-400" id="inq-icon"></i></div>
              <div>
                <h3 class="font-bold text-lg" id="inq-title">Send Inquiry</h3>
                <p class="text-xs text-gray-400" id="inq-subtitle">We'll respond within 24 hours</p>
              </div>
            </div>
            <form onsubmit="submitInquiry(event)" id="inquiry-form" class="space-y-3">
              <input type="hidden" id="inq-type" value="general">
              <div class="grid grid-cols-2 gap-3">
                <input type="text" id="inq-name" placeholder="Full Name *" required class="w-full px-4 py-3 rounded-xl text-sm">
                <input type="email" id="inq-email" placeholder="Email *" required class="w-full px-4 py-3 rounded-xl text-sm">
              </div>
              <div class="grid grid-cols-2 gap-3">
                <input type="tel" id="inq-phone" placeholder="Phone" class="w-full px-4 py-3 rounded-xl text-sm">
                <input type="text" id="inq-org" placeholder="Organization" class="w-full px-4 py-3 rounded-xl text-sm">
              </div>
              <input type="text" id="inq-subject" placeholder="Subject" class="w-full px-4 py-3 rounded-xl text-sm">
              <!-- Dynamic extra fields based on type -->
              <div id="inq-extra-fields"></div>
              <textarea id="inq-message" placeholder="Your message / requirements..." rows="3" required class="w-full px-4 py-3 rounded-xl text-sm"></textarea>
              <button type="submit" id="inq-submit-btn" class="w-full py-3 rounded-xl font-bold text-white transition-all text-sm hover:opacity-90" style="background:linear-gradient(135deg,#FF6B00,#e03060);box-shadow:0 4px 20px rgba(245,98,10,0.28);">
                <i class="fas fa-paper-plane mr-2"></i>Submit Inquiry
              </button>
            </form>
            <div id="inq-success" class="hidden text-center py-6">
              <i class="fas fa-check-circle text-green-400 text-4xl mb-3"></i>
              <h3 class="font-bold text-lg text-green-300">Inquiry Submitted!</h3>
              <p class="text-sm text-gray-400 mt-1">We'll get back to you within 24 hours.</p>
              <button onclick="closeInquiryForm()" class="mt-4 px-6 py-2 rounded-xl text-sm font-semibold glass hover:bg-white/10 transition">Close</button>
            </div>
          </div>
        </div>

        <!-- Live Feed & Quick Actions -->
        <div class="max-w-7xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
          <!-- Announcements -->
          <div class="lg:col-span-2">
            <h2 class="text-xl font-bold mb-4"><i class="fas fa-bullhorn text-accent-400 mr-2"></i>Live Feed</h2>
            <div id="announcements-feed" class="space-y-3"></div>
          </div>
          <!-- Upcoming Sessions -->
          <div>
            <h2 class="text-xl font-bold mb-4"><i class="fas fa-calendar-day text-primary-400 mr-2"></i>Event Schedule</h2>
            <div id="upcoming-sessions" class="space-y-3"></div>
          </div>
        </div>
      </div>

      <!-- Schedule Tab -->
      <div id="tab-schedule" class="tab-content hidden">
        <div class="max-w-7xl mx-auto px-4 py-6">
          <h2 class="text-2xl font-bold mb-1"><i class="fas fa-calendar-alt text-primary-400 mr-2"></i>Event Schedule</h2>
          <p class="text-gray-400 text-sm mb-5">20-21 Nov 2026 · World Trade Center, Mumbai</p>

          <!-- Day Selector -->
          <div class="flex gap-2 mb-4 overflow-x-auto scroll-hide pb-1" id="sched-day-selector"></div>

          <!-- Hall Tabs -->
          <div class="flex gap-2 mb-5 overflow-x-auto scroll-hide pb-1" id="sched-hall-tabs"></div>

          <!-- Track Filter -->
          <div class="flex gap-2 mb-5 overflow-x-auto scroll-hide pb-1" id="sched-track-filter"></div>

          <!-- Sessions List -->
          <div id="sched-sessions-list" class="space-y-3"></div>
        </div>
      </div>

      <!-- Networking Tab -->
      <div id="tab-networking" class="tab-content hidden">
        <div class="max-w-7xl mx-auto px-4 py-6">
          <h2 class="text-2xl font-bold mb-2"><i class="fas fa-users text-primary-400 mr-2"></i>Networking Hub</h2>
          <p class="text-gray-400 text-sm mb-6">Connect with fellow attendees, speakers, and exhibitors</p>

          <!-- Search & Filter — always visible -->
          <div class="flex flex-col md:flex-row gap-3 mb-6">
            <div class="flex-1 relative">
              <i class="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-gray-500"></i>
              <input type="text" id="attendee-search" placeholder="Search by name, company, or title..." class="w-full pl-11 pr-4 py-3 rounded-xl text-sm" oninput="debounceSearch()">
            </div>
            <select id="role-filter" class="px-4 py-3 rounded-xl text-sm" onchange="loadAttendees()">
              <option value="">All Roles</option>
              <option value="Speaker">Speakers</option>
              <option value="Exhibitor">Exhibitors</option>
              <option value="Investor">Investors</option>
              <option value="Jury">Jury</option>
              <option value="Delegate Pass">Delegate Pass</option>
              <option value="VIP Pass">VIP Pass</option>
              <option value="Academic Pass">Academic Pass</option>
              <option value="Visitor Pass">Visitor Pass</option>
              <option value="Media Pass">Media Pass</option>
              <option value="Finalist">Finalists</option>
            </select>
          </div>

          <!-- Visitor upgrade banner (shown only for visitor pass users) -->
          <div id="visitor-network-banner" class="hidden mb-5 rounded-2xl border border-amber-500/30 overflow-hidden" style="background:linear-gradient(135deg,rgba(245,158,11,0.08),rgba(99,102,241,0.08));">
            <div class="flex items-center gap-4 p-4">
              <div class="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
                <i class="fas fa-lock text-amber-400"></i>
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-semibold text-white">Networking requires a paid pass</p>
                <p class="text-xs text-gray-400 mt-0.5">Upgrade to Delegate or VIP to connect, message, and meet attendees</p>
              </div>
              <a href="https://municampus.com/event/BharatAI" target="_blank"
                 class="shrink-0 px-4 py-2 rounded-xl text-xs font-bold text-white transition-all whitespace-nowrap"
                 style="background:linear-gradient(135deg,#6366f1,#8b5cf6);">
                Upgrade Now <i class="fas fa-arrow-right ml-1"></i>
              </a>
            </div>
          </div>

          <!-- Attendee Grid wrapper — blurred for visitors -->
          <div id="attendee-grid-wrapper" class="relative">
            <div id="attendee-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"></div>
            <!-- Visitor lock overlay — sits over the grid -->
            <div id="visitor-grid-lock" class="hidden absolute inset-0 z-10 cursor-pointer" onclick="showNetworkUpgradeModal()" style="background:linear-gradient(to bottom,transparent 0%,rgba(13,13,35,0.6) 30%,rgba(13,13,35,0.95) 55%,rgba(13,13,35,1) 100%);">
              <div class="absolute bottom-0 left-0 right-0 flex flex-col items-center justify-end pb-10 px-4 text-center">
                <div class="w-16 h-16 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mb-4">
                  <i class="fas fa-lock text-amber-400 text-2xl"></i>
                </div>
                <h3 class="text-xl font-bold text-white mb-2">Unlock Full Networking Access</h3>
                <p class="text-sm text-gray-400 mb-5 max-w-sm">Your Visitor Pass doesn't include networking. Upgrade to <span class="text-primary-300 font-semibold">Delegate</span> or <span class="text-amber-300 font-semibold">VIP</span> to connect with all attendees.</p>
                <a href="https://municampus.com/event/BharatAI" target="_blank"
                   onclick="event.stopPropagation()"
                   class="px-8 py-3.5 rounded-xl font-bold text-white text-sm transition-all shadow-xl"
                   style="background:linear-gradient(135deg,#6366f1,#8b5cf6);">
                  <i class="fas fa-arrow-up-right-from-square mr-2"></i>Upgrade My Pass
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Exhibition Tab -->
      <div id="tab-exhibition" class="tab-content hidden">
        <div class="max-w-7xl mx-auto px-4 py-6">
          <h2 class="text-2xl font-bold mb-2"><i class="fas fa-store text-primary-400 mr-2"></i>Exhibition Hall</h2>
          <p class="text-gray-400 text-sm mb-4">Explore booths, book your exhibition space, and connect with exhibitors</p>

          <!-- Exhibition Sub-tabs -->
          <div class="flex gap-2 mb-6 overflow-x-auto scroll-hide pb-2">
            <button onclick="switchExhibitionSubtab('exhibitors')" class="exh-subtab px-4 py-2.5 rounded-xl text-sm font-medium tab-active whitespace-nowrap" data-exh-tab="exhibitors">
              <i class="fas fa-store mr-1.5"></i>Exhibitors
            </button>
            <button onclick="switchExhibitionSubtab('booth-catalog')" class="exh-subtab px-4 py-2.5 rounded-xl text-sm font-medium text-gray-400 whitespace-nowrap" data-exh-tab="booth-catalog">
              <i class="fas fa-th-large mr-1.5"></i>Booth Catalog
            </button>
            <button onclick="switchExhibitionSubtab('my-requests')" class="exh-subtab nav-gated hidden px-4 py-2.5 rounded-xl text-sm font-medium text-gray-400 whitespace-nowrap" data-exh-tab="my-requests">
              <i class="fas fa-file-alt mr-1.5"></i>My Requests
            </button>
          </div>

          <!-- === SUB: Exhibitors === -->
          <div id="exh-sub-exhibitors" class="exh-sub-content">

          <!-- Floor Plan Toggle -->
          <div class="mb-6">
            <button onclick="document.getElementById('floor-plan').classList.toggle('hidden'); this.querySelector('i.fa-chevron-down,i.fa-chevron-up').classList.toggle('fa-chevron-down'); this.querySelector('i.fa-chevron-down,i.fa-chevron-up').classList.toggle('fa-chevron-up');" class="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold glass hover:bg-white/10 transition-all w-full md:w-auto">
              <i class="fas fa-map text-primary-400"></i>
              <span>Hall C — Floor Plan</span>
              <i class="fas fa-chevron-down text-gray-400 text-xs ml-auto md:ml-2"></i>
            </button>

            <div id="floor-plan" class="hidden mt-4 glass rounded-2xl p-4 md:p-6 overflow-x-auto">
              <!-- Legend -->
              <div class="flex flex-wrap gap-3 mb-4 text-xs">
                <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded bg-red-500 inline-block"></span> Red Zone</span>
                <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded bg-green-500 inline-block"></span> Green Zone</span>
                <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded bg-blue-500 inline-block"></span> Blue Zone</span>
                <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded bg-purple-500 inline-block"></span> Purple Zone</span>
                <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded bg-yellow-500 inline-block"></span> Stage</span>
              </div>

              <!-- Floor Plan Grid -->
              <div class="min-w-[600px]" style="display:grid; grid-template-columns: repeat(8, 1fr); grid-template-rows: repeat(14, auto); gap: 4px; font-size: 10px;">

                <!-- Row 1: HALL C label -->
                <div style="grid-column: 1 / 9; text-align:center; padding:6px; font-weight:800; font-size:14px; color:#94a3b8; letter-spacing:2px;">HALL C</div>

                <!-- Row 2: STAGE -->
                <div style="grid-column: 3 / 6; background: linear-gradient(135deg,#eab308,#ca8a04); color:#000; text-align:center; padding:10px 0; font-weight:800; font-size:13px; border-radius:8px;">🎤 STAGE</div>

                <!-- Row 3: Cognizant (Purple 39) + gap + Capgemini (Purple 54) -->
                <div style="grid-column: 1 / 2;"></div>
                <div style="grid-column: 2 / 5; background:rgba(147,51,234,0.3); border:2px solid #9333ea; border-radius:8px; padding:8px; text-align:center; cursor:pointer;" onclick="highlightBooth('Cognizant')" class="booth-cell card-hover">
                  <div style="font-weight:700; color:#c084fc;">39 · Purple</div>
                  <div style="font-weight:800; color:white; font-size:11px;">Cognizant</div>
                </div>
                <div style="grid-column: 5 / 5;"></div>
                <div style="grid-column: 5 / 8; background:rgba(147,51,234,0.3); border:2px solid #9333ea; border-radius:8px; padding:8px; text-align:center; cursor:pointer;" onclick="highlightBooth('Capgemini')" class="booth-cell card-hover">
                  <div style="font-weight:700; color:#c084fc;">54 · Purple</div>
                  <div style="font-weight:800; color:white; font-size:11px;">Capgemini</div>
                </div>

                <!-- Row 4: MedhAnkura (Red 38) + Velox (Blue 51) + JAAJI (Blue 53) -->
                <div style="grid-column: 1 / 3; background:rgba(239,68,68,0.3); border:2px solid #ef4444; border-radius:8px; padding:6px; text-align:center; cursor:pointer;" onclick="highlightBooth('MedhAnkura')" class="booth-cell card-hover">
                  <div style="font-weight:700; color:#f87171;">38 · Red</div>
                  <div style="font-weight:800; color:white;">MedhAnkura</div>
                </div>
                <div style="grid-column: 3 / 4; background:rgba(59,130,246,0.3); border:2px solid #3b82f6; border-radius:8px; padding:6px; text-align:center; cursor:pointer;" onclick="highlightBooth('Velox')" class="booth-cell card-hover">
                  <div style="font-weight:700; color:#60a5fa;">51 · Blue</div>
                  <div style="font-weight:800; color:white;">Velox</div>
                </div>
                <div style="grid-column: 4 / 6; background:rgba(59,130,246,0.3); border:2px solid #3b82f6; border-radius:8px; padding:6px; text-align:center; cursor:pointer;" onclick="highlightBooth('JAAJI')" class="booth-cell card-hover">
                  <div style="font-weight:700; color:#60a5fa;">53 · Blue</div>
                  <div style="font-weight:800; color:white;">JAAJI</div>
                </div>
                <div style="grid-column: 6 / 9;"></div>

                <!-- Row 5: OneAssist (Red 37) + Assessfy (Green 41) + Bandhure/aivi (Blue 50) + Cams Online (Blue 52) -->
                <div style="grid-column: 1 / 3; background:rgba(239,68,68,0.3); border:2px solid #ef4444; border-radius:8px; padding:6px; text-align:center; cursor:pointer;" onclick="highlightBooth('OneAssist')" class="booth-cell card-hover">
                  <div style="font-weight:700; color:#f87171;">37 · Red</div>
                  <div style="font-weight:800; color:white;">OneAssist</div>
                </div>
                <div style="grid-column: 3 / 4; background:rgba(34,197,94,0.3); border:2px solid #22c55e; border-radius:8px; padding:6px; text-align:center; cursor:pointer;" onclick="highlightBooth('Assessfy')" class="booth-cell card-hover">
                  <div style="font-weight:700; color:#4ade80;">41 · Green</div>
                  <div style="font-weight:800; color:white;">Assessfy</div>
                </div>
                <div style="grid-column: 4 / 6; background:rgba(59,130,246,0.3); border:2px solid #3b82f6; border-radius:8px; padding:6px; text-align:center; cursor:pointer;" onclick="highlightBooth('Bandhure')" class="booth-cell card-hover">
                  <div style="font-weight:700; color:#60a5fa;">50 · Blue</div>
                  <div style="font-weight:800; color:white;">Bandhure (aivi)</div>
                </div>
                <div style="grid-column: 6 / 8; background:rgba(59,130,246,0.3); border:2px solid #3b82f6; border-radius:8px; padding:6px; text-align:center; cursor:pointer;" onclick="highlightBooth('Cams Online')" class="booth-cell card-hover">
                  <div style="font-weight:700; color:#60a5fa;">52 · Blue</div>
                  <div style="font-weight:800; color:white;">Cams Online</div>
                </div>

                <!-- Row 6: Cloudangles (Red 36) + Anur Cloud (Green 42) + Extrieve (Blue 49) + GenXAI (Blue 56) -->
                <div style="grid-column: 1 / 3; background:rgba(239,68,68,0.3); border:2px solid #ef4444; border-radius:8px; padding:6px; text-align:center; cursor:pointer;" onclick="highlightBooth('Cloudangles')" class="booth-cell card-hover">
                  <div style="font-weight:700; color:#f87171;">36 · Red</div>
                  <div style="font-weight:800; color:white;">Cloudangles</div>
                </div>
                <div style="grid-column: 3 / 4; background:rgba(34,197,94,0.3); border:2px solid #22c55e; border-radius:8px; padding:6px; text-align:center; cursor:pointer;" onclick="highlightBooth('Anur Cloud')" class="booth-cell card-hover">
                  <div style="font-weight:700; color:#4ade80;">42 · Green</div>
                  <div style="font-weight:800; color:white;">Anur Cloud</div>
                </div>
                <div style="grid-column: 4 / 6; background:rgba(59,130,246,0.3); border:2px solid #3b82f6; border-radius:8px; padding:6px; text-align:center; cursor:pointer;" onclick="highlightBooth('Extrieve')" class="booth-cell card-hover">
                  <div style="font-weight:700; color:#60a5fa;">49 · Blue</div>
                  <div style="font-weight:800; color:white;">Extrieve</div>
                </div>
                <div style="grid-column: 6 / 8; background:rgba(59,130,246,0.3); border:2px solid #3b82f6; border-radius:8px; padding:6px; text-align:center; cursor:pointer;" onclick="highlightBooth('GenXAI')" class="booth-cell card-hover">
                  <div style="font-weight:700; color:#60a5fa;">56 · Blue</div>
                  <div style="font-weight:800; color:white;">GenXAI</div>
                </div>

                <!-- Row 7: Comolho (Green 30) + Pyramed (Red 43) + HCL (Blue 48) + Wexa AI (Green 18) -->
                <div style="grid-column: 1 / 3; background:rgba(34,197,94,0.3); border:2px solid #22c55e; border-radius:8px; padding:6px; text-align:center; cursor:pointer;" onclick="highlightBooth('Comolho')" class="booth-cell card-hover">
                  <div style="font-weight:700; color:#4ade80;">30 · Green</div>
                  <div style="font-weight:800; color:white;">Comolho</div>
                </div>
                <div style="grid-column: 3 / 4; background:rgba(239,68,68,0.3); border:2px solid #ef4444; border-radius:8px; padding:6px; text-align:center; cursor:pointer;" onclick="highlightBooth('Pyramed')" class="booth-cell card-hover">
                  <div style="font-weight:700; color:#f87171;">43 · Red</div>
                  <div style="font-weight:800; color:white;">Pyramed</div>
                </div>
                <div style="grid-column: 4 / 5; background:rgba(59,130,246,0.3); border:2px solid #3b82f6; border-radius:8px; padding:6px; text-align:center; cursor:pointer;" onclick="highlightBooth('HCL')" class="booth-cell card-hover">
                  <div style="font-weight:700; color:#60a5fa;">48 · Blue</div>
                  <div style="font-weight:800; color:white;">HCL</div>
                </div>
                <div style="grid-column: 5 / 7; background:rgba(34,197,94,0.3); border:2px solid #22c55e; border-radius:8px; padding:6px; text-align:center; cursor:pointer;" onclick="highlightBooth('Wexa AI')" class="booth-cell card-hover">
                  <div style="font-weight:700; color:#4ade80;">18 · Green</div>
                  <div style="font-weight:800; color:white;">Wexa AI</div>
                </div>

                <!-- Row 8: Skyshade (Green 32) + Liquidmind (Blue 44) + Anur Cloud/Wexa (Green 47) + Decimal Point (Red 57) -->
                <div style="grid-column: 1 / 3; background:rgba(34,197,94,0.3); border:2px solid #22c55e; border-radius:8px; padding:6px; text-align:center; cursor:pointer;" onclick="highlightBooth('Skyshade')" class="booth-cell card-hover">
                  <div style="font-weight:700; color:#4ade80;">32 · Green</div>
                  <div style="font-weight:800; color:white;">Skyshade</div>
                </div>
                <div style="grid-column: 3 / 4; background:rgba(59,130,246,0.3); border:2px solid #3b82f6; border-radius:8px; padding:6px; text-align:center; cursor:pointer;" onclick="highlightBooth('Liquidmind')" class="booth-cell card-hover">
                  <div style="font-weight:700; color:#60a5fa;">44 · Blue</div>
                  <div style="font-weight:800; color:white;">Liquidmind</div>
                </div>
                <div style="grid-column: 4 / 6; background:rgba(59,130,246,0.3); border:2px solid #3b82f6; border-radius:8px; padding:6px; text-align:center; cursor:pointer;" onclick="highlightBooth('CAMB.AI')" class="booth-cell card-hover">
                  <div style="font-weight:700; color:#60a5fa;">45 · Blue</div>
                  <div style="font-weight:800; color:white;">CAMB.AI</div>
                </div>
                <div style="grid-column: 6 / 8; background:rgba(239,68,68,0.3); border:2px solid #ef4444; border-radius:8px; padding:6px; text-align:center; cursor:pointer;" onclick="highlightBooth('Decimal Point')" class="booth-cell card-hover">
                  <div style="font-weight:700; color:#f87171;">57 · Red</div>
                  <div style="font-weight:800; color:white;">Decimal Point</div>
                </div>

                <!-- Row 9: Castler (Blue 46) + Castler contd (Blue 46) + Deloitte (Red 58) -->
                <div style="grid-column: 1 / 2;"></div>
                <div style="grid-column: 2 / 4; background:rgba(59,130,246,0.3); border:2px solid #3b82f6; border-radius:8px; padding:6px; text-align:center; cursor:pointer;" onclick="highlightBooth('Castler')" class="booth-cell card-hover">
                  <div style="font-weight:700; color:#60a5fa;">46 · Blue</div>
                  <div style="font-weight:800; color:white;">Castler</div>
                </div>
                <div style="grid-column: 4 / 6; background:rgba(59,130,246,0.3); border:2px solid #3b82f6; border-radius:8px; padding:6px; text-align:center; cursor:pointer;" onclick="highlightBooth('CAMB.AI')" class="booth-cell card-hover">
                  <div style="font-weight:700; color:#60a5fa;">45 · Blue</div>
                  <div style="font-weight:800; color:white;">CAMB.AI</div>
                </div>
                <div style="grid-column: 6 / 8; background:rgba(239,68,68,0.3); border:2px solid #ef4444; border-radius:8px; padding:6px; text-align:center; cursor:pointer;" onclick="highlightBooth('Deloitte')" class="booth-cell card-hover">
                  <div style="font-weight:700; color:#f87171;">58 · Red</div>
                  <div style="font-weight:800; color:white;">Deloitte</div>
                </div>

                <!-- Row 10: Spacer -->
                <div style="grid-column: 1 / 9; height: 12px;"></div>

                <!-- Row 11: Partners area - Aegis, Bharat AI, BOTel -->
                <div style="grid-column: 1 / 4; display:flex; gap:4px;">
                  <div style="flex:1; background:rgba(34,197,94,0.4); border:2px solid #22c55e; border-radius:8px; padding:6px; text-align:center; cursor:pointer;" onclick="highlightBooth('Aegis')" class="booth-cell card-hover">
                    <div style="font-weight:800; color:white; font-size:9px;">Aegis</div>
                  </div>
                  <div style="flex:1; background:rgba(34,197,94,0.4); border:2px solid #22c55e; border-radius:8px; padding:6px; text-align:center; cursor:pointer;" onclick="highlightBooth('Bharat AI')" class="booth-cell card-hover">
                    <div style="font-weight:800; color:white; font-size:9px;">Bharat AI</div>
                  </div>
                  <div style="flex:1; background:rgba(34,197,94,0.4); border:2px solid #22c55e; border-radius:8px; padding:6px; text-align:center; cursor:pointer;" onclick="highlightBooth('BOTel')" class="booth-cell card-hover">
                    <div style="font-weight:800; color:white; font-size:9px;">BOTel</div>
                  </div>
                </div>

                <!-- Row 12: EXIT -->
                <div style="grid-column: 1 / 9; text-align:center; padding:8px; margin-top:4px;">
                  <span style="background:rgba(255,255,255,0.1); padding:6px 24px; border-radius:8px; font-weight:800; font-size:12px; color:#94a3b8; letter-spacing:3px; border:1px solid rgba(255,255,255,0.15);">🚪 EXIT</span>
                </div>

              </div>

              <p class="text-center text-[10px] text-gray-600 mt-3">Tap a booth to find it in the exhibitor list below</p>
            </div>
          </div>

          <!-- Category Filter -->
          <div class="flex gap-2 mb-6 overflow-x-auto scroll-hide pb-2" id="exhibitor-categories"></div>
          <!-- Search -->
          <div class="relative mb-6">
            <i class="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-gray-500"></i>
            <input type="text" id="exhibitor-search" placeholder="Search exhibitors, products..." class="w-full pl-11 pr-4 py-3 rounded-xl text-sm" oninput="debounceExhibitorSearch()">
          </div>
          <!-- Exhibitor Grid -->
          <div id="exhibitor-grid" class="grid grid-cols-1 md:grid-cols-2 gap-4"></div>

          </div><!-- end exh-sub-exhibitors -->

          <!-- === SUB: Booth Catalog === -->
          <div id="exh-sub-booth-catalog" class="exh-sub-content hidden">
            <div id="booth-catalog-container"></div>
          </div>

          <!-- === SUB: My Requests === -->
          <div id="exh-sub-my-requests" class="exh-sub-content hidden">
            <div id="my-booth-requests-container"></div>
          </div>

          <!-- Booth Request Form Modal -->
          <div id="booth-request-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center p-4" style="background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);">
            <div class="glass rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-0 border border-white/10">
              <div id="booth-request-form-container"></div>
            </div>
          </div>

        </div>
      </div>

      <!-- Awards Tab -->
      <div id="tab-awards" class="tab-content hidden">
        <div class="max-w-7xl mx-auto px-4 py-6">
          <div class="text-center mb-8">
            <img src="https://bharataiinnovation.com/images/Bharat%20AI%20Innovation%20Logo.png" alt="BHAI" class="w-16 h-16 mx-auto mb-3 rounded-xl object-contain">
            <h2 class="text-3xl font-bold mb-2"><i class="fas fa-trophy text-accent-400 mr-2"></i>Bharat AI Innovation &amp; BHAI Innovation Certification</h2>
          </div>

          <!-- Sub-tabs for Awards -->
          <div class="flex justify-center gap-2 mb-8 flex-wrap">
            <button class="awards-tab px-4 py-2.5 rounded-xl text-sm font-medium tab-active" data-awards-tab="finalists" onclick="switchAwardsTab('finalists')">
              <i class="fas fa-star mr-1.5"></i>16th Startup Finalists
            </button>
            <button class="awards-tab px-4 py-2.5 rounded-xl text-sm font-medium text-gray-400" data-awards-tab="enterprise" onclick="switchAwardsTab('enterprise')">
              <i class="fas fa-building mr-1.5"></i>16th Enterprise Finalists
            </button>
            <button class="awards-tab md:hidden px-4 py-2.5 rounded-xl text-sm font-medium text-gray-400" data-awards-tab="categories" onclick="switchAwardsTab('categories')">
              <i class="fas fa-list-alt mr-1.5"></i>BHAI 2026 Award Categories
            </button>
            <button class="awards-tab md:hidden px-4 py-2.5 rounded-xl text-sm font-medium text-gray-400" data-awards-tab="schedule" onclick="switchAwardsTab('schedule')">
              <i class="fas fa-gavel mr-1.5"></i>17th Jury Schedule
            </button>
            <button class="awards-tab md:hidden px-4 py-2.5 rounded-xl text-sm font-medium text-gray-400" data-awards-tab="startup-pitch" onclick="switchAwardsTab('startup-pitch')">
              <i class="fas fa-rocket mr-1.5"></i>Startup Pitch
            </button>
          </div>

          <!-- Startup Finalists Section -->
          <div id="awards-finalists" class="space-y-6">
            <div class="text-center mb-4">
              <div class="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-500/30">
                <i class="fas fa-medal text-amber-400"></i>
                <span class="text-sm font-semibold text-amber-300">Bharat AI Innovation 2026 Startup Finalists</span>
              </div>
            </div>
            <div id="finalists-container" class="space-y-5"></div>
          </div>

          <!-- Enterprise Finalists Section -->
          <div id="awards-enterprise" class="hidden space-y-6">
            <div class="text-center mb-4">
              <div class="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-blue-500/20 to-indigo-500/20 border border-blue-500/30">
                <i class="fas fa-building text-blue-400"></i>
                <span class="text-sm font-semibold text-blue-300">Bharat AI Innovation 2026 Enterprise Finalists</span>
              </div>
            </div>
            <div id="enterprise-container" class="space-y-5"></div>
          </div>

          <!-- Categories Section -->
          <div id="awards-categories" class="hidden space-y-8">
            <div id="awards-container" class="space-y-8"></div>
          </div>

          <!-- 17th Jury Schedule Section -->
          <div id="awards-schedule" class="hidden space-y-6">
            <div class="text-center mb-6">
              <div class="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-violet-500/20 to-fuchsia-500/20 border border-violet-500/30">
                <i class="fas fa-gavel text-violet-400"></i>
                <span class="text-sm font-semibold text-violet-300">17th Bharat AI Innovation &amp; Innovation Certification — Jury Schedule</span>
              </div>
              <p class="text-xs text-gray-500 mt-2">Monthly jury evaluation across 3 parallel category tracks (Wed–Fri)</p>
            </div>

            <!-- Schedule Grid -->
            <div class="space-y-3" id="jury-schedule-grid">
              <!-- MARCH -->
              <div class="glass rounded-2xl overflow-hidden">
                <div class="bg-gradient-to-r from-violet-600/30 to-fuchsia-600/30 px-5 py-3 flex items-center justify-between">
                  <div class="flex items-center gap-3"><span class="text-xl">🗓️</span><span class="font-bold text-lg">MARCH</span></div>
                  <span class="px-3 py-1 rounded-full text-xs font-semibold bg-white/10 text-violet-300"><i class="fas fa-gavel mr-1"></i>Mar 25, 26, 27</span>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/5">
                  <div class="p-4 bg-dark-800/50"><div class="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Category 1</div><div class="font-semibold text-sm">🔄 Digital Transformation</div></div>
                  <div class="p-4 bg-dark-800/50"><div class="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Category 2</div><div class="font-semibold text-sm">📊 Data Science / Analytics</div></div>
                  <div class="p-4 bg-dark-800/50"><div class="text-[10px] uppercase tracking-wider text-purple-500 mb-1">AI Rotation</div><div class="font-semibold text-sm text-purple-300">🧠 [A] Core AI (Agentic, Foundation, RAG 2.0)</div></div>
                </div>
              </div>
              <!-- APRIL -->
              <div class="glass rounded-2xl overflow-hidden">
                <div class="bg-gradient-to-r from-violet-600/30 to-fuchsia-600/30 px-5 py-3 flex items-center justify-between">
                  <div class="flex items-center gap-3"><span class="text-xl">🗓️</span><span class="font-bold text-lg">APRIL</span></div>
                  <span class="px-3 py-1 rounded-full text-xs font-semibold bg-white/10 text-violet-300"><i class="fas fa-gavel mr-1"></i>Apr 22, 23, 24</span>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/5">
                  <div class="p-4 bg-dark-800/50"><div class="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Category 1</div><div class="font-semibold text-sm">🔐 Cyber Security</div></div>
                  <div class="p-4 bg-dark-800/50"><div class="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Category 2</div><div class="font-semibold text-sm">💳 Fintech</div></div>
                  <div class="p-4 bg-dark-800/50"><div class="text-[10px] uppercase tracking-wider text-purple-500 mb-1">AI Rotation</div><div class="font-semibold text-sm text-purple-300">💼 [B] Functional (Sales, Marketing, HR, CX)</div></div>
                </div>
              </div>
              <!-- MAY -->
              <div class="glass rounded-2xl overflow-hidden">
                <div class="bg-gradient-to-r from-violet-600/30 to-fuchsia-600/30 px-5 py-3 flex items-center justify-between">
                  <div class="flex items-center gap-3"><span class="text-xl">🗓️</span><span class="font-bold text-lg">MAY</span></div>
                  <span class="px-3 py-1 rounded-full text-xs font-semibold bg-white/10 text-violet-300"><i class="fas fa-gavel mr-1"></i>May 27, 28, 29</span>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/5">
                  <div class="p-4 bg-dark-800/50"><div class="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Category 1</div><div class="font-semibold text-sm">🏦 Banking</div></div>
                  <div class="p-4 bg-dark-800/50"><div class="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Category 2</div><div class="font-semibold text-sm">🛡️ InsuranceTech</div></div>
                  <div class="p-4 bg-dark-800/50"><div class="text-[10px] uppercase tracking-wider text-purple-500 mb-1">AI Rotation</div><div class="font-semibold text-sm text-purple-300">🏗️ [C] Industry (BFSI, Health, Retail, Telecom)</div></div>
                </div>
              </div>
              <!-- JUNE -->
              <div class="glass rounded-2xl overflow-hidden">
                <div class="bg-gradient-to-r from-violet-600/30 to-fuchsia-600/30 px-5 py-3 flex items-center justify-between">
                  <div class="flex items-center gap-3"><span class="text-xl">🗓️</span><span class="font-bold text-lg">JUNE</span></div>
                  <span class="px-3 py-1 rounded-full text-xs font-semibold bg-white/10 text-violet-300"><i class="fas fa-gavel mr-1"></i>Jun 24, 25, 26</span>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/5">
                  <div class="p-4 bg-dark-800/50"><div class="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Category 1</div><div class="font-semibold text-sm">🌍 Climate Change</div></div>
                  <div class="p-4 bg-dark-800/50"><div class="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Category 2</div><div class="font-semibold text-sm">🏙️ Smart City</div></div>
                  <div class="p-4 bg-dark-800/50"><div class="text-[10px] uppercase tracking-wider text-purple-500 mb-1">AI Rotation</div><div class="font-semibold text-sm text-purple-300">🧠 [A] Core AI (Trusted AI, Edge, Auto SW Eng)</div></div>
                </div>
              </div>
              <!-- JULY -->
              <div class="glass rounded-2xl overflow-hidden">
                <div class="bg-gradient-to-r from-violet-600/30 to-fuchsia-600/30 px-5 py-3 flex items-center justify-between">
                  <div class="flex items-center gap-3"><span class="text-xl">🗓️</span><span class="font-bold text-lg">JULY</span></div>
                  <span class="px-3 py-1 rounded-full text-xs font-semibold bg-white/10 text-violet-300"><i class="fas fa-gavel mr-1"></i>Jul 29, 30, 31</span>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/5">
                  <div class="p-4 bg-dark-800/50"><div class="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Category 1</div><div class="font-semibold text-sm">🏢 Enterprise Solutions</div></div>
                  <div class="p-4 bg-dark-800/50"><div class="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Category 2</div><div class="font-semibold text-sm">☁️ Cloud Computing</div></div>
                  <div class="p-4 bg-dark-800/50"><div class="text-[10px] uppercase tracking-wider text-purple-500 mb-1">AI Rotation</div><div class="font-semibold text-sm text-purple-300">💼 [B] Functional (Ops, Finance, Cybersecurity)</div></div>
                </div>
              </div>
              <!-- AUGUST -->
              <div class="glass rounded-2xl overflow-hidden">
                <div class="bg-gradient-to-r from-violet-600/30 to-fuchsia-600/30 px-5 py-3 flex items-center justify-between">
                  <div class="flex items-center gap-3"><span class="text-xl">🗓️</span><span class="font-bold text-lg">AUGUST</span></div>
                  <span class="px-3 py-1 rounded-full text-xs font-semibold bg-white/10 text-violet-300"><i class="fas fa-gavel mr-1"></i>Aug 26, 27, 28</span>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/5">
                  <div class="p-4 bg-dark-800/50"><div class="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Category 1</div><div class="font-semibold text-sm">🌐 Digital Infra</div></div>
                  <div class="p-4 bg-dark-800/50"><div class="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Category 2</div><div class="font-semibold text-sm">📶 Telecom / 5G / 6G</div></div>
                  <div class="p-4 bg-dark-800/50"><div class="text-[10px] uppercase tracking-wider text-purple-500 mb-1">AI Rotation</div><div class="font-semibold text-sm text-purple-300">🏗️ [C] Industry (Mfg, Logistics, Energy, Aviation)</div></div>
                </div>
              </div>
              <!-- SEPTEMBER -->
              <div class="glass rounded-2xl overflow-hidden">
                <div class="bg-gradient-to-r from-violet-600/30 to-fuchsia-600/30 px-5 py-3 flex items-center justify-between">
                  <div class="flex items-center gap-3"><span class="text-xl">🗓️</span><span class="font-bold text-lg">SEPTEMBER</span></div>
                  <span class="px-3 py-1 rounded-full text-xs font-semibold bg-white/10 text-violet-300"><i class="fas fa-gavel mr-1"></i>Sep 23, 24, 25</span>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/5">
                  <div class="p-4 bg-dark-800/50"><div class="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Category 1</div><div class="font-semibold text-sm">🏭 Manufacturing</div></div>
                  <div class="p-4 bg-dark-800/50"><div class="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Category 2</div><div class="font-semibold text-sm">👥 HRTech</div></div>
                  <div class="p-4 bg-dark-800/50"><div class="text-[10px] uppercase tracking-wider text-purple-500 mb-1">AI Rotation</div><div class="font-semibold text-sm text-purple-300">🧠 [A] Core AI (Conv. AI, Personal AI, MLOps)</div></div>
                </div>
              </div>
              <!-- OCTOBER -->
              <div class="glass rounded-2xl overflow-hidden">
                <div class="bg-gradient-to-r from-violet-600/30 to-fuchsia-600/30 px-5 py-3 flex items-center justify-between">
                  <div class="flex items-center gap-3"><span class="text-xl">🗓️</span><span class="font-bold text-lg">OCTOBER</span></div>
                  <span class="px-3 py-1 rounded-full text-xs font-semibold bg-white/10 text-violet-300"><i class="fas fa-gavel mr-1"></i>Oct 28, 29, 30</span>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/5">
                  <div class="p-4 bg-dark-800/50"><div class="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Category 1</div><div class="font-semibold text-sm">🚗 EV &amp; Automobile</div></div>
                  <div class="p-4 bg-dark-800/50"><div class="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Category 2</div><div class="font-semibold text-sm">📦 Supply Chain</div></div>
                  <div class="p-4 bg-dark-800/50"><div class="text-[10px] uppercase tracking-wider text-purple-500 mb-1">AI Rotation</div><div class="font-semibold text-sm text-purple-300">💼 [B] Functional (Supply Chain, Strategy &amp; Decision)</div></div>
                </div>
              </div>
              <!-- NOVEMBER -->
              <div class="glass rounded-2xl overflow-hidden">
                <div class="bg-gradient-to-r from-violet-600/30 to-fuchsia-600/30 px-5 py-3 flex items-center justify-between">
                  <div class="flex items-center gap-3"><span class="text-xl">🗓️</span><span class="font-bold text-lg">NOVEMBER</span></div>
                  <span class="px-3 py-1 rounded-full text-xs font-semibold bg-white/10 text-violet-300"><i class="fas fa-gavel mr-1"></i>Nov 18, 19, 20</span>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/5">
                  <div class="p-4 bg-dark-800/50"><div class="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Category 1</div><div class="font-semibold text-sm">🏥 HealthTech / Life Sci.</div></div>
                  <div class="p-4 bg-dark-800/50"><div class="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Category 2</div><div class="font-semibold text-sm">🌾 Agritech</div></div>
                  <div class="p-4 bg-dark-800/50"><div class="text-[10px] uppercase tracking-wider text-purple-500 mb-1">AI Rotation</div><div class="font-semibold text-sm text-purple-300">🏗️ [C] Industry (Agri, EdTech, Public Sector)</div></div>
                </div>
              </div>
              <!-- DECEMBER -->
              <div class="glass rounded-2xl overflow-hidden">
                <div class="bg-gradient-to-r from-violet-600/30 to-fuchsia-600/30 px-5 py-3 flex items-center justify-between">
                  <div class="flex items-center gap-3"><span class="text-xl">🗓️</span><span class="font-bold text-lg">DECEMBER</span></div>
                  <span class="px-3 py-1 rounded-full text-xs font-semibold bg-white/10 text-violet-300"><i class="fas fa-gavel mr-1"></i>Dec 16, 17, 18</span>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/5">
                  <div class="p-4 bg-dark-800/50"><div class="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Category 1</div><div class="font-semibold text-sm">🛒 ConsumerTech / Retail</div></div>
                  <div class="p-4 bg-dark-800/50"><div class="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Category 2</div><div class="font-semibold text-sm">🧬 Deeptech (Sub-cat below)</div></div>
                  <div class="p-4 bg-dark-800/50"><div class="text-[10px] uppercase tracking-wider text-purple-500 mb-1">AI Rotation</div><div class="font-semibold text-sm text-purple-300">🧠 [A] Core AI (Foundational Breakthroughs)</div></div>
                </div>
              </div>
            </div>

            <!-- Legend -->
            <div class="glass rounded-xl p-4 mt-4">
              <div class="flex flex-wrap gap-4 justify-center text-xs">
                <div class="flex items-center gap-2"><span class="w-3 h-3 rounded-full bg-gray-500/30"></span><span class="text-gray-400">Category 1 &amp; 2 — Domain tracks</span></div>
                <div class="flex items-center gap-2"><span class="w-3 h-3 rounded-full bg-purple-500/30"></span><span class="text-purple-400">Category 3 — AI Rotation ([A] [B] [C] cycle)</span></div>
                <div class="flex items-center gap-2"><i class="fas fa-gavel text-violet-400 text-[10px]"></i><span class="text-violet-400">Jury dates are Wed–Thu–Fri</span></div>
              </div>
            </div>
          </div>

          <!-- BHAI Startup Pitch Section (mobile sub-tab) -->
          <div id="awards-startup-pitch" class="hidden">
            <div id="startup-pitch-content-mobile"></div>
          </div>

        </div>
      </div>

      <!-- BHAI 2026 Award Categories Tab (top-level, desktop) -->
      <div id="tab-agba-categories" class="tab-content hidden">
        <div class="max-w-7xl mx-auto px-4 py-6">
          <div class="text-center mb-8">
            <img src="https://bharataiinnovation.com/images/Bharat%20AI%20Innovation%20Logo.png" alt="BHAI" class="w-16 h-16 mx-auto mb-3 rounded-xl object-contain">
            <h2 class="text-2xl font-bold mb-2"><i class="fas fa-list-alt text-accent-400 mr-2"></i>BHAI 2026 Award Categories</h2>
            <p class="text-gray-400 text-sm">Award categories for the 17th Bharat AI Innovation &amp; Innovation Certification</p>
          </div>
          <div id="agba-categories-container" class="space-y-8"></div>
        </div>
      </div>

      <!-- BHAI 2026 Jury Schedule Tab (top-level, desktop) -->
      <div id="tab-agba-jury" class="tab-content hidden">
        <div class="max-w-7xl mx-auto px-4 py-6">
          <div class="text-center mb-8">
            <img src="https://bharataiinnovation.com/images/Bharat%20AI%20Innovation%20Logo.png" alt="BHAI" class="w-16 h-16 mx-auto mb-3 rounded-xl object-contain">
            <h2 class="text-2xl font-bold mb-2"><i class="fas fa-gavel text-violet-400 mr-2"></i>BHAI 2026 Jury Schedule</h2>
            <p class="text-gray-400 text-sm">Monthly jury evaluation across 3 parallel category tracks (Wed&#8211;Fri)</p>
          </div>
          <div id="agba-jury-schedule-grid" class="space-y-3"></div>
        </div>
      </div>

      <!-- BHAI Startup Pitch Tab (top-level, desktop) -->
      <div id="tab-startup-pitch" class="tab-content hidden">
        <div class="max-w-7xl mx-auto px-4 py-6">
          <div id="startup-pitch-content-desktop"></div>
        </div>
      </div>

      <!-- Innovation Talks Tab -->
      <div id="tab-innovation" class="tab-content hidden">
        <div class="max-w-7xl mx-auto px-4 py-6">
          <div id="innovation-talks-content"></div>
        </div>
      </div>

      <!-- Workshops Tab -->
      <div id="tab-workshops" class="tab-content hidden">
        <div class="max-w-7xl mx-auto px-4 py-6">
          <!-- Hero -->
          <div class="text-center mb-8">
            <div class="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-teal-500/20 to-cyan-500/20 border border-teal-500/30 mb-4">
              <i class="fas fa-laptop-code text-teal-400"></i>
              <span class="text-sm font-semibold text-teal-300">Hands-On Training</span>
            </div>
            <h2 class="text-2xl md:text-3xl font-black mb-2">AI Training <span class="gradient-text">Workshops</span></h2>
            <p class="text-gray-400 text-sm md:text-base max-w-2xl mx-auto">Intensive hands-on workshops led by industry experts. Code alongside practitioners, work on real projects, and earn completion certificates.</p>
          </div>

          <!-- Workshop Highlights -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
            <div class="glass rounded-xl p-4 text-center border border-teal-500/10">
              <div class="text-2xl mb-1">💻</div>
              <div class="text-xs font-semibold text-teal-300">Hands-On Practice</div>
              <div class="text-[10px] text-gray-500 mt-0.5">Code with real datasets & tools</div>
            </div>
            <div class="glass rounded-xl p-4 text-center border border-cyan-500/10">
              <div class="text-2xl mb-1">👨‍🏫</div>
              <div class="text-xs font-semibold text-cyan-300">Industry Experts</div>
              <div class="text-[10px] text-gray-500 mt-0.5">Learn from AI practitioners</div>
            </div>
            <div class="glass rounded-xl p-4 text-center border border-blue-500/10">
              <div class="text-2xl mb-1">📊</div>
              <div class="text-xs font-semibold text-blue-300">Real Projects</div>
              <div class="text-[10px] text-gray-500 mt-0.5">Actual use cases & solutions</div>
            </div>
            <div class="glass rounded-xl p-4 text-center border border-violet-500/10">
              <div class="text-2xl mb-1">🎓</div>
              <div class="text-xs font-semibold text-violet-300">Certificate</div>
              <div class="text-[10px] text-gray-500 mt-0.5">Earn completion certificates</div>
            </div>
          </div>

          <!-- Workshop Cards -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8" id="workshop-cards">
            <!-- Generative AI & LLMs -->
            <div class="glass rounded-2xl p-6 border border-teal-500/20 hover:border-teal-400/40 transition-all group relative overflow-hidden">
              <div class="absolute top-3 right-3 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-gradient-to-r from-amber-500 to-orange-500 text-white">Popular</div>
              <div class="flex items-center gap-3 mb-4">
                <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-teal-500/20 to-emerald-500/20 flex items-center justify-center shrink-0">
                  <i class="fas fa-brain text-xl text-teal-400"></i>
                </div>
                <div>
                  <h3 class="font-bold text-base text-white group-hover:text-teal-300 transition">Generative AI & LLMs</h3>
                  <p class="text-[11px] text-gray-500">Master Large Language Models & GenAI applications</p>
                </div>
              </div>
              <div class="mb-4">
                <div class="text-xs font-semibold text-gray-400 mb-2">Topics Covered</div>
                <div class="flex flex-wrap gap-1.5">
                  <span class="px-2 py-0.5 rounded-full text-[10px] bg-teal-500/10 text-teal-300 border border-teal-500/20">LLM Architecture</span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] bg-teal-500/10 text-teal-300 border border-teal-500/20">Prompt Engineering</span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] bg-teal-500/10 text-teal-300 border border-teal-500/20">RAG</span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] bg-teal-500/10 text-teal-300 border border-teal-500/20">Fine-tuning</span>
                </div>
              </div>
              <a href="https://bharataiinnovation.com/register" target="_blank" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-teal-600 hover:bg-teal-500 text-white transition-all shadow-lg shadow-teal-900/30">
                <i class="fas fa-ticket-alt"></i>Register Now
              </a>
            </div>

            <!-- Agentic AI Development -->
            <div class="glass rounded-2xl p-6 border border-cyan-500/20 hover:border-cyan-400/40 transition-all group relative overflow-hidden">
              <div class="absolute top-3 right-3 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-gradient-to-r from-cyan-500 to-blue-500 text-white">New</div>
              <div class="flex items-center gap-3 mb-4">
                <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center shrink-0">
                  <i class="fas fa-robot text-xl text-cyan-400"></i>
                </div>
                <div>
                  <h3 class="font-bold text-base text-white group-hover:text-cyan-300 transition">Agentic AI Development</h3>
                  <p class="text-[11px] text-gray-500">Build autonomous AI agents that reason, plan & act</p>
                </div>
              </div>
              <div class="mb-4">
                <div class="text-xs font-semibold text-gray-400 mb-2">Topics Covered</div>
                <div class="flex flex-wrap gap-1.5">
                  <span class="px-2 py-0.5 rounded-full text-[10px] bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">Agent Architecture</span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">Tool Integration</span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">Multi-Agent Systems</span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">Orchestration</span>
                </div>
              </div>
              <a href="https://bharataiinnovation.com/register" target="_blank" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white transition-all shadow-lg shadow-cyan-900/30">
                <i class="fas fa-ticket-alt"></i>Register Now
              </a>
            </div>

            <!-- VibeCoding & AI-Assisted Development -->
            <div class="glass rounded-2xl p-6 border border-purple-500/20 hover:border-purple-400/40 transition-all group relative overflow-hidden">
              <div class="absolute top-3 right-3 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-gradient-to-r from-purple-500 to-pink-500 text-white">Trending</div>
              <div class="flex items-center gap-3 mb-4">
                <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center shrink-0">
                  <i class="fas fa-code text-xl text-purple-400"></i>
                </div>
                <div>
                  <h3 class="font-bold text-base text-white group-hover:text-purple-300 transition">VibeCoding & AI-Assisted Dev</h3>
                  <p class="text-[11px] text-gray-500">Prompt-driven development & rapid prototyping</p>
                </div>
              </div>
              <div class="mb-4">
                <div class="text-xs font-semibold text-gray-400 mb-2">Topics Covered</div>
                <div class="flex flex-wrap gap-1.5">
                  <span class="px-2 py-0.5 rounded-full text-[10px] bg-purple-500/10 text-purple-300 border border-purple-500/20">GitHub Copilot & Cursor AI</span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] bg-purple-500/10 text-purple-300 border border-purple-500/20">Prompt for Code</span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] bg-purple-500/10 text-purple-300 border border-purple-500/20">Rapid Prototyping</span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] bg-purple-500/10 text-purple-300 border border-purple-500/20">AI Code Review</span>
                </div>
              </div>
              <a href="https://bharataiinnovation.com/register" target="_blank" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white transition-all shadow-lg shadow-purple-900/30">
                <i class="fas fa-ticket-alt"></i>Register Now
              </a>
            </div>

            <!-- AI Product Development -->
            <div class="glass rounded-2xl p-6 border border-orange-500/20 hover:border-orange-400/40 transition-all group relative overflow-hidden">
              <div class="absolute top-3 right-3 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-gradient-to-r from-orange-500 to-red-500 text-white">Essential</div>
              <div class="flex items-center gap-3 mb-4">
                <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-orange-500/20 to-red-500/20 flex items-center justify-center shrink-0">
                  <i class="fas fa-box-open text-xl text-orange-400"></i>
                </div>
                <div>
                  <h3 class="font-bold text-base text-white group-hover:text-orange-300 transition">AI Product Development</h3>
                  <p class="text-[11px] text-gray-500">End-to-end journey from ideation to deployment</p>
                </div>
              </div>
              <div class="mb-4">
                <div class="text-xs font-semibold text-gray-400 mb-2">Topics Covered</div>
                <div class="flex flex-wrap gap-1.5">
                  <span class="px-2 py-0.5 rounded-full text-[10px] bg-orange-500/10 text-orange-300 border border-orange-500/20">AI Product Strategy</span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] bg-orange-500/10 text-orange-300 border border-orange-500/20">MVP Development</span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] bg-orange-500/10 text-orange-300 border border-orange-500/20">Model Integration</span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] bg-orange-500/10 text-orange-300 border border-orange-500/20">Deployment & Monitoring</span>
                </div>
              </div>
              <a href="https://bharataiinnovation.com/register" target="_blank" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-orange-600 hover:bg-orange-500 text-white transition-all shadow-lg shadow-orange-900/30">
                <i class="fas fa-ticket-alt"></i>Register Now
              </a>
            </div>

            <!-- Recommender System Development -->
            <div class="glass rounded-2xl p-6 border border-emerald-500/20 hover:border-emerald-400/40 transition-all group relative overflow-hidden">
              <div class="absolute top-3 right-3 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-gradient-to-r from-emerald-500 to-green-500 text-white">Popular</div>
              <div class="flex items-center gap-3 mb-4">
                <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500/20 to-green-500/20 flex items-center justify-center shrink-0">
                  <i class="fas fa-magic text-xl text-emerald-400"></i>
                </div>
                <div>
                  <h3 class="font-bold text-base text-white group-hover:text-emerald-300 transition">Recommender Systems</h3>
                  <p class="text-[11px] text-gray-500">Build intelligent recommendation engines</p>
                </div>
              </div>
              <div class="mb-4">
                <div class="text-xs font-semibold text-gray-400 mb-2">Topics Covered</div>
                <div class="flex flex-wrap gap-1.5">
                  <span class="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">Collaborative Filtering</span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">Content-Based</span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">Matrix Factorization</span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">Real-time Systems</span>
                </div>
              </div>
              <a href="https://bharataiinnovation.com/register" target="_blank" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-lg shadow-emerald-900/30">
                <i class="fas fa-ticket-alt"></i>Register Now
              </a>
            </div>

            <!-- AI Chatbot Development -->
            <div class="glass rounded-2xl p-6 border border-blue-500/20 hover:border-blue-400/40 transition-all group relative overflow-hidden">
              <div class="absolute top-3 right-3 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-gradient-to-r from-blue-500 to-indigo-500 text-white">Hands-On</div>
              <div class="flex items-center gap-3 mb-4">
                <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500/20 to-indigo-500/20 flex items-center justify-center shrink-0">
                  <i class="fas fa-comments text-xl text-blue-400"></i>
                </div>
                <div>
                  <h3 class="font-bold text-base text-white group-hover:text-blue-300 transition">AI Chatbot Development</h3>
                  <p class="text-[11px] text-gray-500">Create intelligent conversational AI systems</p>
                </div>
              </div>
              <div class="mb-4">
                <div class="text-xs font-semibold text-gray-400 mb-2">Topics Covered</div>
                <div class="flex flex-wrap gap-1.5">
                  <span class="px-2 py-0.5 rounded-full text-[10px] bg-blue-500/10 text-blue-300 border border-blue-500/20">Conversational AI</span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] bg-blue-500/10 text-blue-300 border border-blue-500/20">Intent Recognition</span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] bg-blue-500/10 text-blue-300 border border-blue-500/20">Context Management</span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] bg-blue-500/10 text-blue-300 border border-blue-500/20">Platform Integration</span>
                </div>
              </div>
              <a href="https://bharataiinnovation.com/register" target="_blank" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-all shadow-lg shadow-blue-900/30">
                <i class="fas fa-ticket-alt"></i>Register Now
              </a>
            </div>

            <!-- LLM Model Fine-Tuning -->
            <div class="glass rounded-2xl p-6 border border-rose-500/20 hover:border-rose-400/40 transition-all group relative overflow-hidden">
              <div class="absolute top-3 right-3 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-gradient-to-r from-rose-500 to-pink-500 text-white">Advanced</div>
              <div class="flex items-center gap-3 mb-4">
                <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-500/20 to-pink-500/20 flex items-center justify-center shrink-0">
                  <i class="fas fa-sliders-h text-xl text-rose-400"></i>
                </div>
                <div>
                  <h3 class="font-bold text-base text-white group-hover:text-rose-300 transition">LLM Fine-Tuning</h3>
                  <p class="text-[11px] text-gray-500">Customize large language models for specific use cases</p>
                </div>
              </div>
              <div class="mb-4">
                <div class="text-xs font-semibold text-gray-400 mb-2">Topics Covered</div>
                <div class="flex flex-wrap gap-1.5">
                  <span class="px-2 py-0.5 rounded-full text-[10px] bg-rose-500/10 text-rose-300 border border-rose-500/20">Transfer Learning</span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] bg-rose-500/10 text-rose-300 border border-rose-500/20">PEFT / LoRA / QLoRA</span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] bg-rose-500/10 text-rose-300 border border-rose-500/20">Evaluation</span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] bg-rose-500/10 text-rose-300 border border-rose-500/20">Deployment</span>
                </div>
              </div>
              <a href="https://bharataiinnovation.com/register" target="_blank" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white transition-all shadow-lg shadow-rose-900/30">
                <i class="fas fa-ticket-alt"></i>Register Now
              </a>
            </div>

            <!-- Computer Vision & Image AI -->
            <div class="glass rounded-2xl p-6 border border-sky-500/20 hover:border-sky-400/40 transition-all group relative overflow-hidden">
              <div class="absolute top-3 right-3 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-gradient-to-r from-sky-500 to-blue-500 text-white">Practical</div>
              <div class="flex items-center gap-3 mb-4">
                <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-sky-500/20 to-blue-500/20 flex items-center justify-center shrink-0">
                  <i class="fas fa-eye text-xl text-sky-400"></i>
                </div>
                <div>
                  <h3 class="font-bold text-base text-white group-hover:text-sky-300 transition">Computer Vision & Image AI</h3>
                  <p class="text-[11px] text-gray-500">Image recognition, object detection & visual AI</p>
                </div>
              </div>
              <div class="mb-4">
                <div class="text-xs font-semibold text-gray-400 mb-2">Topics Covered</div>
                <div class="flex flex-wrap gap-1.5">
                  <span class="px-2 py-0.5 rounded-full text-[10px] bg-sky-500/10 text-sky-300 border border-sky-500/20">CNN & Transfer Learning</span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] bg-sky-500/10 text-sky-300 border border-sky-500/20">YOLO / R-CNN</span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] bg-sky-500/10 text-sky-300 border border-sky-500/20">Image Segmentation</span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] bg-sky-500/10 text-sky-300 border border-sky-500/20">Edge Deployment</span>
                </div>
              </div>
              <a href="https://bharataiinnovation.com/register" target="_blank" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white transition-all shadow-lg shadow-sky-900/30">
                <i class="fas fa-ticket-alt"></i>Register Now
              </a>
            </div>
          </div>

          <!-- Who Should Attend -->
          <div class="glass rounded-2xl p-6 md:p-8 border border-white/5 mb-8">
            <h3 class="text-lg font-bold mb-4 text-center"><i class="fas fa-user-check text-teal-400 mr-2"></i>Who Should Attend?</h3>
            <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <div class="text-center p-3">
                <div class="text-2xl mb-1">💻</div>
                <div class="text-xs font-semibold text-gray-300">Developers</div>
                <div class="text-[10px] text-gray-500">Add AI to your toolkit</div>
              </div>
              <div class="text-center p-3">
                <div class="text-2xl mb-1">📊</div>
                <div class="text-xs font-semibold text-gray-300">Data Scientists</div>
                <div class="text-[10px] text-gray-500">Latest ML & AI techniques</div>
              </div>
              <div class="text-center p-3">
                <div class="text-2xl mb-1">🎓</div>
                <div class="text-xs font-semibold text-gray-300">Students</div>
                <div class="text-[10px] text-gray-500">Hands-on with cutting-edge tools</div>
              </div>
              <div class="text-center p-3">
                <div class="text-2xl mb-1">👔</div>
                <div class="text-xs font-semibold text-gray-300">Product Managers</div>
                <div class="text-[10px] text-gray-500">Understand AI capabilities</div>
              </div>
              <div class="text-center p-3">
                <div class="text-2xl mb-1">🚀</div>
                <div class="text-xs font-semibold text-gray-300">Entrepreneurs</div>
                <div class="text-[10px] text-gray-500">Build & validate AI products</div>
              </div>
              <div class="text-center p-3">
                <div class="text-2xl mb-1">🏢</div>
                <div class="text-xs font-semibold text-gray-300">Enterprise Teams</div>
                <div class="text-[10px] text-gray-500">Upskill in AI technologies</div>
              </div>
            </div>
          </div>

          <!-- Prerequisites -->
          <div class="glass rounded-2xl p-6 border border-white/5 mb-8">
            <h3 class="text-lg font-bold mb-4 text-center"><i class="fas fa-clipboard-check text-amber-400 mr-2"></i>Prerequisites</h3>
            <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div class="flex items-center gap-2 text-xs text-gray-300"><i class="fas fa-laptop text-teal-400"></i>Laptop with 8GB+ RAM</div>
              <div class="flex items-center gap-2 text-xs text-gray-300"><i class="fab fa-python text-teal-400"></i>Basic Python knowledge</div>
              <div class="flex items-center gap-2 text-xs text-gray-300"><i class="fas fa-wifi text-teal-400"></i>Stable internet connection</div>
              <div class="flex items-center gap-2 text-xs text-gray-300"><i class="fab fa-github text-teal-400"></i>GitHub / Google Cloud account</div>
              <div class="flex items-center gap-2 text-xs text-gray-300"><i class="fas fa-download text-teal-400"></i>Pre-installed software</div>
              <div class="flex items-center gap-2 text-xs text-gray-300"><i class="fas fa-fire text-teal-400"></i>Enthusiasm to learn!</div>
            </div>
          </div>

          <!-- Expert Instructors -->
          <div class="glass rounded-2xl p-6 md:p-8 border border-teal-500/20 mb-8 glow-accent">
            <div class="text-center">
              <h3 class="text-lg font-bold mb-2"><i class="fas fa-chalkboard-teacher text-teal-400 mr-2"></i>Learn from Industry Experts</h3>
              <p class="text-xs text-gray-400 mb-4 max-w-xl mx-auto">Our workshops are led by experienced AI practitioners building real-world systems at leading companies, startups, and research institutions.</p>
              <div class="flex flex-wrap justify-center gap-2">
                <span class="px-3 py-1 rounded-full text-[11px] font-medium bg-teal-500/10 text-teal-300 border border-teal-500/20">🏢 FAANG Engineers</span>
                <span class="px-3 py-1 rounded-full text-[11px] font-medium bg-blue-500/10 text-blue-300 border border-blue-500/20">🎓 PhD Researchers</span>
                <span class="px-3 py-1 rounded-full text-[11px] font-medium bg-purple-500/10 text-purple-300 border border-purple-500/20">🚀 Startup Founders</span>
                <span class="px-3 py-1 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-300 border border-amber-500/20">📚 Published Authors</span>
                <span class="px-3 py-1 rounded-full text-[11px] font-medium bg-rose-500/10 text-rose-300 border border-rose-500/20">💼 Industry Veterans</span>
              </div>
            </div>
          </div>

          <!-- CTA -->
          <div class="text-center">
            <h3 class="text-xl font-bold mb-2">Ready to Master AI Technologies?</h3>
            <p class="text-gray-400 text-sm mb-4">Special conference rates for workshop attendees. Includes materials, certificate & lifetime access to recordings.</p>
            <div class="flex flex-col sm:flex-row justify-center gap-3">
              <a href="https://bharataiinnovation.com/register" target="_blank" class="px-6 py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 transition-all text-sm shadow-lg shadow-teal-500/20">
                <i class="fas fa-ticket-alt mr-2"></i>Register for Workshops
              </a>
              <a href="/training-workshop" class="px-6 py-3 rounded-xl font-semibold text-white glass hover:bg-white/10 transition-all text-sm border border-white/10">
                <i class="fas fa-external-link-alt mr-2"></i>View Full Details
              </a>
            </div>
          </div>
        </div>
      </div>

      <!-- Inbox Tab -->
      <div id="tab-inbox" class="tab-content hidden">
        <div class="max-w-7xl mx-auto px-4 py-6">
          <h2 class="text-2xl font-bold mb-2"><i class="fas fa-envelope text-primary-400 mr-2"></i>Inbox</h2>
          <p class="text-gray-400 text-sm mb-6">Your connections, messages, and meetings</p>
          <!-- Sub-tabs -->
          <div class="flex gap-2 mb-6">
            <button class="inbox-tab px-4 py-2 rounded-xl text-sm font-medium tab-active" data-inbox="connections" onclick="switchInboxTab('connections')">
              <i class="fas fa-link mr-1"></i>Connections
            </button>
            <button class="inbox-tab px-4 py-2 rounded-xl text-sm font-medium text-gray-400" data-inbox="meetings" onclick="switchInboxTab('meetings')">
              <i class="fas fa-calendar-check mr-1"></i>Meetings
            </button>
          </div>
          <div id="inbox-connections" class="space-y-3"></div>
          <div id="inbox-meetings" class="hidden space-y-3"></div>
        </div>
      </div>

      <!-- My Profile / User Dashboard Tab -->
      <div id="tab-myprofile" class="tab-content hidden">
        <div class="max-w-7xl mx-auto px-4 py-6">
          <!-- Profile Header Card -->
          <div id="my-profile-header"></div>

          <!-- Quick Actions Bar -->
          <div id="my-quick-actions" class="mb-6"></div>

          <!-- My Exhibition Booth (for Exhibitor badge holders) -->
          <div id="my-booth-section" class="mb-6 hidden"></div>

          <!-- Engagement Score + Activity Stats Row -->
          <div class="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-8">
            <div id="my-engagement-ring" class="lg:col-span-1"></div>
            <div id="my-profile-stats" class="lg:col-span-3 grid grid-cols-2 sm:grid-cols-3 gap-3"></div>
          </div>

          <!-- Sub-tabs for dashboard sections -->
          <div class="flex items-center gap-2 mb-6 overflow-x-auto scroll-hide pb-1">
            <button class="profile-subtab px-4 py-2 rounded-xl text-sm font-medium tab-active whitespace-nowrap" data-subtab="overview" onclick="switchProfileSubtab('overview')">
              <i class="fas fa-chart-pie mr-1.5"></i>Overview
            </button>
            <button class="profile-subtab px-4 py-2 rounded-xl text-sm font-medium text-gray-400 hover:text-white whitespace-nowrap" data-subtab="connections" onclick="switchProfileSubtab('connections')">
              <i class="fas fa-user-friends mr-1.5"></i>Connections
            </button>
            <button class="profile-subtab px-4 py-2 rounded-xl text-sm font-medium text-gray-400 hover:text-white whitespace-nowrap" data-subtab="meetings" onclick="switchProfileSubtab('meetings')">
              <i class="fas fa-calendar-check mr-1.5"></i>Meetings
            </button>
            <button class="profile-subtab px-4 py-2 rounded-xl text-sm font-medium text-gray-400 hover:text-white whitespace-nowrap" data-subtab="activity" onclick="switchProfileSubtab('activity')">
              <i class="fas fa-stream mr-1.5"></i>Activity
            </button>
          </div>

          <!-- Overview subtab (connections + meetings + booths) -->
          <div id="profile-subtab-overview" class="profile-subtab-content">
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              <div>
                <div class="flex items-center justify-between mb-3">
                  <h3 class="text-lg font-bold"><i class="fas fa-user-friends text-primary-400 mr-2"></i>Recent Connections</h3>
                  <button onclick="switchProfileSubtab('connections')" class="text-xs text-primary-400 hover:underline">View all &rarr;</button>
                </div>
                <div id="my-connections-list" class="space-y-3"></div>
              </div>
              <div>
                <div class="flex items-center justify-between mb-3">
                  <h3 class="text-lg font-bold"><i class="fas fa-calendar-check text-green-400 mr-2"></i>Upcoming Meetings</h3>
                  <button onclick="switchProfileSubtab('meetings')" class="text-xs text-primary-400 hover:underline">View all &rarr;</button>
                </div>
                <div id="my-meetings-list" class="space-y-3"></div>
              </div>
            </div>
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              <div>
                <h3 class="text-lg font-bold mb-3"><i class="fas fa-store text-accent-400 mr-2"></i>Booths I Visited</h3>
                <div id="my-booths-list" class="space-y-3"></div>
              </div>
              <div>
                <h3 class="text-lg font-bold mb-3"><i class="fas fa-rocket text-purple-400 mr-2"></i>Startup Pitch</h3>
                <div class="glass rounded-xl p-6 text-center text-gray-500"><i class="fas fa-rocket text-2xl mb-2 block opacity-30"></i><p class="text-sm">Watch top AI startups pitch to investors</p><button onclick="switchTab('startup-pitch')" class="mt-2 text-primary-400 text-xs hover:underline font-medium">View Pitches &rarr;</button></div>
              </div>
            </div>
          </div>

          <!-- Connections subtab (full list) -->
          <div id="profile-subtab-connections" class="profile-subtab-content hidden">
            <div class="mb-4">
              <input type="text" id="my-connections-search" placeholder="Search connections..." class="w-full px-4 py-3 rounded-xl text-sm" oninput="filterMyConnections(this.value)">
            </div>
            <div id="my-all-connections-list" class="space-y-3"></div>
          </div>

          <!-- Meetings subtab (full list) -->
          <div id="profile-subtab-meetings" class="profile-subtab-content hidden">
            <div class="flex items-center gap-2 mb-4">
              <button class="meeting-filter px-3 py-1.5 rounded-lg text-xs font-medium tab-active" data-mfilter="all" onclick="filterMyMeetings('all')">All</button>
              <button class="meeting-filter px-3 py-1.5 rounded-lg text-xs font-medium text-gray-400" data-mfilter="accepted" onclick="filterMyMeetings('accepted')">Confirmed</button>
              <button class="meeting-filter px-3 py-1.5 rounded-lg text-xs font-medium text-gray-400" data-mfilter="pending" onclick="filterMyMeetings('pending')">Pending</button>
            </div>
            <div id="my-all-meetings-list" class="space-y-3"></div>
          </div>

          <!-- Activity subtab (timeline) -->
          <div id="profile-subtab-activity" class="profile-subtab-content hidden">
            <div id="my-activity-timeline" class="space-y-4"></div>
          </div>
        </div>
      </div>

      <!-- Edit Profile Modal -->
      <div id="edit-profile-modal" class="fixed inset-0 z-40 modal-overlay hidden flex items-center justify-center p-4">
        <div class="glass rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto scroll-hide">
          <div class="flex justify-between items-start mb-5">
            <h2 class="text-xl font-bold"><i class="fas fa-user-edit text-primary-400 mr-2"></i>Edit Profile</h2>
            <button onclick="closeEditProfile()" class="text-gray-400 hover:text-white"><i class="fas fa-times text-lg"></i></button>
          </div>
          <form id="edit-profile-form" class="space-y-4">
            <!-- Photo Upload -->
            <div class="flex items-center gap-4">
              <div class="relative">
                <img id="edit-avatar-preview" src="" alt="Avatar" class="w-16 h-16 rounded-full object-cover border-2 border-white/10">
                <label for="edit-avatar-input" class="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-primary-600 hover:bg-primary-500 flex items-center justify-center cursor-pointer transition">
                  <i class="fas fa-camera text-white text-xs"></i>
                </label>
                <input type="file" id="edit-avatar-input" accept="image/*" class="hidden" onchange="handleProfilePhotoSelect(this)">
              </div>
              <div class="flex-1">
                <p class="text-sm font-medium">Profile Photo</p>
                <p class="text-xs text-gray-500">Click the camera icon to upload. Max 500KB, auto-resized.</p>
                <button type="button" id="remove-avatar-btn" class="text-xs text-red-400 hover:text-red-300 mt-1 hidden" onclick="removeProfilePhoto()">
                  <i class="fas fa-trash-alt mr-1"></i>Remove photo
                </button>
              </div>
            </div>
            <div>
              <label class="text-xs text-gray-400 mb-1 block">Full Name *</label>
              <input type="text" id="edit-name" required class="w-full px-4 py-3 rounded-xl text-sm">
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-xs text-gray-400 mb-1 block">Company</label>
                <input type="text" id="edit-company" class="w-full px-4 py-3 rounded-xl text-sm">
              </div>
              <div>
                <label class="text-xs text-gray-400 mb-1 block">Job Title</label>
                <input type="text" id="edit-jobtitle" class="w-full px-4 py-3 rounded-xl text-sm">
              </div>
            </div>
            <div>
              <label class="text-xs text-gray-400 mb-1 block">Bio</label>
              <textarea id="edit-bio" rows="3" class="w-full px-4 py-3 rounded-xl text-sm"></textarea>
            </div>
            <div>
              <label class="text-xs text-gray-400 mb-1 block">Interests (comma-separated)</label>
              <input type="text" id="edit-interests" class="w-full px-4 py-3 rounded-xl text-sm">
            </div>
            <div>
              <label class="text-xs text-gray-400 mb-1 block">LinkedIn URL</label>
              <input type="url" id="edit-linkedin" class="w-full px-4 py-3 rounded-xl text-sm" placeholder="https://linkedin.com/in/...">
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-xs text-gray-400 mb-1 block">Mobile Number</label>
                <input type="tel" id="edit-mobile" class="w-full px-4 py-3 rounded-xl text-sm" placeholder="+91 98765 43210">
              </div>
              <div>
                <label class="text-xs text-gray-400 mb-1 block">Lunch Inclusion</label>
                <select id="edit-lunch" class="w-full px-4 py-3 rounded-xl text-sm">
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              </div>
            </div>
            <div>
              <label class="text-xs text-gray-400 mb-1 block">Expected Arrival Time at Event</label>
              <select id="edit-arrival" class="w-full px-4 py-3 rounded-xl text-sm">
                <option value="">-- Select arrival time --</option>
                <option value="09:00">9:00 AM</option>
                <option value="09:30">9:30 AM</option>
                <option value="10:00">10:00 AM (Inauguration)</option>
                <option value="10:30">10:30 AM</option>
                <option value="11:00">11:00 AM</option>
                <option value="11:30">11:30 AM</option>
                <option value="12:00">12:00 PM</option>
                <option value="12:30">12:30 PM</option>
                <option value="13:00">1:00 PM (Lunch starts)</option>
                <option value="13:30">1:30 PM</option>
                <option value="14:00">2:00 PM</option>
                <option value="14:30">2:30 PM</option>
                <option value="15:00">3:00 PM</option>
                <option value="15:30">3:30 PM</option>
                <option value="16:00">4:00 PM</option>
                <option value="16:30">4:30 PM</option>
              </select>
              <p class="text-[10px] text-gray-500 mt-1"><i class="fas fa-utensils mr-1"></i>Lunch: 1:00 - 2:00 PM. Arrive before 1 PM for lunch pack.</p>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-xs text-gray-400 mb-1 block">Twitter URL</label>
                <input type="url" id="edit-twitter" class="w-full px-4 py-3 rounded-xl text-sm" placeholder="https://twitter.com/...">
              </div>
              <div>
                <label class="text-xs text-gray-400 mb-1 block">Website URL</label>
                <input type="url" id="edit-website" class="w-full px-4 py-3 rounded-xl text-sm" placeholder="https://...">
              </div>
            </div>
            <button type="submit" class="w-full py-3 rounded-xl font-bold text-white transition-all hover:opacity-90" style="background:linear-gradient(135deg,#FF6B00,#e03060);box-shadow:0 4px 20px rgba(245,98,10,0.28);">
              <i class="fas fa-save mr-2"></i>Save Changes
            </button>
          </form>
        </div>
      </div>
    </main>
  </div>

  <script>
    // ==================== STATE ====================
    const EVENT_ID = 1;
    function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
    let currentUser = null;
    let currentTab = 'dashboard';
    let searchTimeout = null;

    function resizeImage(file, maxSize, quality) {
      return new Promise((resolve, reject) => {
        maxSize = maxSize || 256;
        quality = quality || 0.8;
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            let w = img.width, h = img.height;
            if (w > h) { if (w > maxSize) { h = h * maxSize / w; w = maxSize; } }
            else { if (h > maxSize) { w = w * maxSize / h; h = maxSize; } }
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', quality));
          };
          img.onerror = reject;
          img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    // ==================== AVATAR HELPERS ====================
    // Compact MD5 implementation for Gravatar hash
    function md5(s){function L(k,d){return(k<<d)|(k>>>(32-d))}function K(G,k){var I,d,F,H,x;F=(G&2147483648);H=(k&2147483648);I=(G&1073741824);d=(k&1073741824);x=(G&1073741823)+(k&1073741823);if(I&d)return(x^2147483648^F^H);if(I|d){if(x&1073741824)return(x^3221225472^F^H);else return(x^1073741824^F^H)}else return(x^F^H)}function r(d,F,k){return(d&F)|((~d)&k)}function q(d,F,k){return(d&k)|(F&(~k))}function p(d,F,k){return(d^F^k)}function n(d,F,k){return(F^(d|(~k)))}function u(G,F,aa,Z,k,H,I){G=K(G,K(K(r(F,aa,Z),k),I));return K(L(G,H),F)}function f(G,F,aa,Z,k,H,I){G=K(G,K(K(q(F,aa,Z),k),I));return K(L(G,H),F)}function D(G,F,aa,Z,k,H,I){G=K(G,K(K(p(F,aa,Z),k),I));return K(L(G,H),F)}function t(G,F,aa,Z,k,H,I){G=K(G,K(K(n(F,aa,Z),k),I));return K(L(G,H),F)}function e(G){var Z;var F=G.length;var x=F+8;var k=(x-(x%64))/64;var I=(k+1)*16;var aa=Array(I-1);var d=0;var H=0;while(H<F){Z=(H-(H%4))/4;d=(H%4)*8;aa[Z]=(aa[Z]|(G.charCodeAt(H)<<d));H++}Z=(H-(H%4))/4;d=(H%4)*8;aa[Z]=aa[Z]|(128<<d);aa[I-2]=F<<3;aa[I-1]=F>>>29;return aa}function B(x){var k="",F="",G,d;for(d=0;d<=3;d++){G=(x>>>(d*8))&255;F="0"+G.toString(16);k=k+F.substr(F.length-2,2)}return k}var C=Array();var P,h,E,v,g,Y,X,W,V;var S=7,Q=12,N=17,M=22;var A=5,z=9,y=14,w=20;var o=4,m=11,l=16,j=23;var U=6,T=10,R=15,O=21;s=unescape(encodeURIComponent(s));C=e(s);Y=1732584193;X=4023233417;W=2562383102;V=271733878;for(P=0;P<C.length;P+=16){h=Y;E=X;v=W;g=V;Y=u(Y,X,W,V,C[P+0],S,3614090360);V=u(V,Y,X,W,C[P+1],Q,3905402710);W=u(W,V,Y,X,C[P+2],N,606105819);X=u(X,W,V,Y,C[P+3],M,3250441966);Y=u(Y,X,W,V,C[P+4],S,4118548399);V=u(V,Y,X,W,C[P+5],Q,1200080426);W=u(W,V,Y,X,C[P+6],N,2821735955);X=u(X,W,V,Y,C[P+7],M,4249261313);Y=u(Y,X,W,V,C[P+8],S,1770035416);V=u(V,Y,X,W,C[P+9],Q,2336552879);W=u(W,V,Y,X,C[P+10],N,4294925233);X=u(X,W,V,Y,C[P+11],M,2304563134);Y=u(Y,X,W,V,C[P+12],S,1804603682);V=u(V,Y,X,W,C[P+13],Q,4254626195);W=u(W,V,Y,X,C[P+14],N,2792965006);X=u(X,W,V,Y,C[P+15],M,1236535329);Y=f(Y,X,W,V,C[P+1],A,4129170786);V=f(V,Y,X,W,C[P+6],z,3225465664);W=f(W,V,Y,X,C[P+11],y,643717713);X=f(X,W,V,Y,C[P+0],w,3921069994);Y=f(Y,X,W,V,C[P+5],A,3593408605);V=f(V,Y,X,W,C[P+10],z,38016083);W=f(W,V,Y,X,C[P+15],y,3634488961);X=f(X,W,V,Y,C[P+4],w,3889429448);Y=f(Y,X,W,V,C[P+9],A,568446438);V=f(V,Y,X,W,C[P+14],z,3275163606);W=f(W,V,Y,X,C[P+3],y,4107603335);X=f(X,W,V,Y,C[P+8],w,1163531501);Y=f(Y,X,W,V,C[P+13],A,2850285829);V=f(V,Y,X,W,C[P+2],z,4243563512);W=f(W,V,Y,X,C[P+7],y,1735328473);X=f(X,W,V,Y,C[P+12],w,2368359562);Y=D(Y,X,W,V,C[P+5],o,4294588738);V=D(V,Y,X,W,C[P+8],m,2272392833);W=D(W,V,Y,X,C[P+11],l,1839030562);X=D(X,W,V,Y,C[P+14],j,4259657740);Y=D(Y,X,W,V,C[P+1],o,2763975236);V=D(V,Y,X,W,C[P+4],m,1272893353);W=D(W,V,Y,X,C[P+7],l,4139469664);X=D(X,W,V,Y,C[P+10],j,3200236656);Y=D(Y,X,W,V,C[P+13],o,681279174);V=D(V,Y,X,W,C[P+0],m,3936430074);W=D(W,V,Y,X,C[P+3],l,3572445317);X=D(X,W,V,Y,C[P+6],j,76029189);Y=D(Y,X,W,V,C[P+9],o,3654602809);V=D(V,Y,X,W,C[P+12],m,3873151461);W=D(W,V,Y,X,C[P+15],l,530742520);X=D(X,W,V,Y,C[P+2],j,3299628645);Y=t(Y,X,W,V,C[P+0],U,4096336452);V=t(V,Y,X,W,C[P+7],T,1126891415);W=t(W,V,Y,X,C[P+14],R,2878612391);X=t(X,W,V,Y,C[P+5],O,4237533241);Y=t(Y,X,W,V,C[P+12],U,1700485571);V=t(V,Y,X,W,C[P+3],T,2399980690);W=t(W,V,Y,X,C[P+10],R,4293915773);X=t(X,W,V,Y,C[P+1],O,2240044497);Y=t(Y,X,W,V,C[P+8],U,1873313359);V=t(V,Y,X,W,C[P+15],T,4264355552);W=t(W,V,Y,X,C[P+6],R,2734768916);X=t(X,W,V,Y,C[P+13],O,1309151649);Y=t(Y,X,W,V,C[P+4],U,4149444226);V=t(V,Y,X,W,C[P+11],T,3174756917);W=t(W,V,Y,X,C[P+2],R,718787259);X=t(X,W,V,Y,C[P+9],O,3951481745);Y=K(Y,h);X=K(X,E);W=K(W,v);V=K(V,g)}return(B(Y)+B(X)+B(W)+B(V)).toLowerCase()}

    // Get avatar URL: Gravatar with UI Avatars fallback
    function getAvatarUrl(email, name, size, avatarUrl) {
      if (avatarUrl && avatarUrl.startsWith('data:image/')) return avatarUrl;
      size = size || 80;
      // Generate unique background color from email/name hash
      const seed = (email || name || 'unknown').trim().toLowerCase();
      const colors = ['6366f1','8b5cf6','ec4899','f43f5e','f97316','eab308','22c55e','14b8a6','06b6d4','3b82f6','a855f7','e11d48','0ea5e9','10b981','f59e0b','84cc16'];
      let hashVal = 0;
      for (let i = 0; i < seed.length; i++) hashVal = ((hashVal << 5) - hashVal + seed.charCodeAt(i)) | 0;
      const bg = colors[Math.abs(hashVal) % colors.length];
      const fallback = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(name || '?') + '&size=' + size + '&background=' + bg + '&color=fff&bold=true&format=png';
      if (!email) return fallback;
      const hash = md5(email.trim().toLowerCase());
      return 'https://www.gravatar.com/avatar/' + hash + '?s=' + size + '&d=' + encodeURIComponent(fallback);
    }

    // Enhance all avatar images: try Gravatar first, fall back gracefully
    function setupAvatarFallbacks() {
      document.querySelectorAll('img[data-avatar-fallback]').forEach(img => {
        if (!img._avatarSetup) {
          img._avatarSetup = true;
          img.onerror = function() {
            if (this.dataset.avatarFallback && this.src !== this.dataset.avatarFallback) {
              this.src = this.dataset.avatarFallback;
            }
          };
        }
      });
    }

    function updateNavAvatar() {
      if (!currentUser) return;
      const img = document.getElementById('nav-avatar-img');
      const nameEl = document.getElementById('nav-avatar-name');
      if (img) img.src = getAvatarUrl(currentUser.email, currentUser.name, 72, currentUser.avatar_url);
      if (nameEl) {
        const firstName = currentUser.name ? currentUser.name.split(' ')[0] : 'Me';
        nameEl.textContent = firstName;
      }
    }

    // ==================== COMPANY LOGO HELPER ====================
    function getCompanyLogoUrl(company, websiteUrl, linkedinUrl, email) {
      // Try to extract a domain from available sources
      let domain = '';
      
      // 1. From website URL
      if (websiteUrl) {
        try {
          const url = websiteUrl.startsWith('http') ? websiteUrl : 'https://' + websiteUrl;
          domain = new URL(url).hostname.replace('www.', '');
        } catch(e) {}
      }
      
      // 2. From LinkedIn company URL (extract company name for domain guess)
      if (!domain && linkedinUrl) {
        try {
          const url = new URL(linkedinUrl);
          // e.g. linkedin.com/company/google → google.com
          const match = url.pathname.match(/\\/(?:company|in)\\/([^/]+)/);
          if (match && match[1] && match[1] !== 'in') {
            const slug = match[1].toLowerCase().replace(/[^a-z0-9]/g, '');
            domain = slug + '.com';
          }
        } catch(e) {}
      }
      
      // 3. From email domain (skip common providers)
      if (!domain && email) {
        const emailDomain = email.split('@')[1];
        if (emailDomain && !['gmail.com','yahoo.com','hotmail.com','outlook.com','live.com','icloud.com','aol.com','mail.com','protonmail.com','ymail.com','rediffmail.com'].includes(emailDomain.toLowerCase())) {
          domain = emailDomain.toLowerCase();
        }
      }
      
      // 4. Guess from company name (simple heuristic)
      if (!domain && company) {
        const cleaned = company.trim().toLowerCase()
          .replace(/\\s*(pvt|private|ltd|limited|inc|incorporated|llc|llp|corp|corporation|co|gmbh|ag|sa|srl|group|technologies|technology|tech|solutions|consulting|services|enterprises|global|india|int'?l|international)\\s*/gi, '')
          .replace(/[^a-z0-9]/g, '');
        if (cleaned.length > 1 && cleaned.length <= 30) {
          domain = cleaned + '.com';
        }
      }
      
      if (!domain) return '';
      
      // Use Google's S2 Favicons API (free, no key, reliable)
      return 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(domain) + '&sz=128';
    }

    // ==================== API HELPERS ====================
    const api = {
      get: (url) => fetch(url).then(r => r.json()),
      post: (url, data) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),
      put: (url, data) => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),
    };

    function linkify(text) {
      return (text || '').replace(/(https?:\\/\\/[^\\s<]+)/g, '<a href="$1" target="_blank" class="text-primary-400 hover:underline">$1</a>');
    }

    // ==================== INIT ====================
    let pendingAction = null; // Store pending action (e.g. 'download-pass') for post-login
    let pendingTabAfterLogin = null; // Store tab to navigate to after login

    async function init() {
      // Check for ?email= param from notification email link
      const urlParams = new URLSearchParams(window.location.search);
      const emailParam = urlParams.get('email');
      pendingAction = urlParams.get('action'); // Store action before URL cleanup

      // Always show public app first (no login required for public tabs)
      showPublicApp();

      const saved = localStorage.getItem('agba_user');
      if (saved) {
        try {
          currentUser = JSON.parse(saved);
          // Re-register to mark online
          const user = await api.post(\`/api/events/\${EVENT_ID}/attendees/register\`, {
            name: currentUser.name,
            email: currentUser.email,
            company: currentUser.company,
            job_title: currentUser.job_title,
          });
          currentUser = user;
          localStorage.setItem('agba_user', JSON.stringify(currentUser));
          if (emailParam) window.history.replaceState({}, '', window.location.pathname);
          upgradeToLoggedIn();
          if (urlParams.get('action') === 'download-pass' || pendingAction === 'download-pass') setTimeout(() => generateDelegatePass(), 1500);
        } catch(e) {
          // Saved session invalid, continue as public user
          currentUser = null;
          localStorage.removeItem('agba_user');
        }
      } else if (emailParam) {
        // Auto-login from email link
        try {
          const resp = await fetch(\`/api/events/\${EVENT_ID}/attendees/login\`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: emailParam })
          });
          if (resp.ok) {
            const data = await resp.json();
            currentUser = data;
            localStorage.setItem('agba_user', JSON.stringify(currentUser));
            window.history.replaceState({}, '', window.location.pathname);
            showToast(\`Welcome back, \${currentUser.name}!\`, 'success');
            upgradeToLoggedIn();
            if (pendingAction === 'download-pass') setTimeout(() => generateDelegatePass(), 1500);
            return;
          }
        } catch(e) {}
        // Email param but not found — prefill sign-in
        if (emailParam) window.history.replaceState({}, '', window.location.pathname);
      }
    }

    // Show public app: nav + content visible, no login required
    function showPublicApp() {
      document.getElementById('loading-screen').classList.add('hidden');
      document.getElementById('main-nav').classList.remove('hidden');
      document.getElementById('content').classList.remove('hidden');
      updateNavForAuth();
      loadDashboard();
    }

    // Upgrade UI after successful login (show avatar, enable protected tabs)
    function upgradeToLoggedIn() {
      updateNavForAuth();
      updateNavAvatar();
      checkUnread();
      // Refresh dashboard with user-specific content (RSVP, arrival card)
      if (currentTab === 'dashboard') loadDashboard();
      // Navigate to pending tab if any
      if (pendingTabAfterLogin) {
        switchTab(pendingTabAfterLogin);
        pendingTabAfterLogin = null;
      }
      // Show arrival time prompt if not set
      setTimeout(() => {
        if (currentUser && !currentUser.arrival_time) {
          showArrivalTimePrompt();
        }
      }, 1500);
    }

    // Update nav bar to show Sign In button or avatar based on auth state.
    // There are TWO sign-in buttons (mobile + desktop) and TWO "me"/avatar
    // buttons; toggle ALL of them by class, not by a single (non-unique) id —
    // that bug left the desktop Sign In button visible while logged in.
    function updateNavForAuth() {
      const signInBtns = document.querySelectorAll('.js-signin-btn');
      const loggedInBtns = document.querySelectorAll('.js-avatar-btn'); // avatar + Log Out
      const authGated = document.querySelectorAll('.auth-gated');       // Network, Inbox
      const mobileMe = document.getElementById('nav-mobile-me');
      if (currentUser) {
        signInBtns.forEach(b => b.classList.add('hidden'));
        loggedInBtns.forEach(b => { b.classList.remove('hidden'); b.classList.add('flex'); });
        authGated.forEach(b => { b.classList.remove('hidden'); b.classList.add('flex'); });
        if (mobileMe) { mobileMe.classList.remove('hidden'); mobileMe.classList.add('flex'); }
      } else {
        signInBtns.forEach(b => b.classList.remove('hidden'));
        loggedInBtns.forEach(b => { b.classList.add('hidden'); b.classList.remove('flex'); });
        authGated.forEach(b => { b.classList.add('hidden'); b.classList.remove('flex'); });
        if (mobileMe) { mobileMe.classList.add('hidden'); mobileMe.classList.remove('flex'); }
      }
    }

    function showRegistration(prefillEmail) {
      document.getElementById('registration-modal').classList.remove('hidden');
      if (prefillEmail) {
        const emailField = document.getElementById('signin-email');
        if (emailField) { emailField.value = prefillEmail; }
      }
    }

    function showApp() {
      document.getElementById('loading-screen').classList.add('hidden');
      document.getElementById('registration-modal').classList.add('hidden');
      document.getElementById('main-nav').classList.remove('hidden');
      document.getElementById('content').classList.remove('hidden');
      updateNavForAuth();
      updateNavAvatar();
      loadDashboard();
      checkUnread();
      // Show arrival time prompt if not set
      setTimeout(() => {
        if (currentUser && !currentUser.arrival_time) {
          showArrivalTimePrompt();
        }
      }, 1500);
    }

    // ==================== QUICK VISITOR REGISTRATION ====================
    function openQuickVisitorReg() {
      const section = document.getElementById('quick-visitor-reg-card');
      if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'center' });
        section.classList.add('ring-2', 'ring-green-400/50');
        setTimeout(() => section.classList.remove('ring-2', 'ring-green-400/50'), 2000);
      }
    }

    async function submitQuickVisitorReg(e) {
      e.preventDefault();
      const btn = document.getElementById('qv-submit-btn');
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Registering...';
      btn.disabled = true;

      const name = document.getElementById('qv-name').value.trim();
      const email = document.getElementById('qv-email').value.trim();
      const phone = document.getElementById('qv-phone').value.trim();
      const company = document.getElementById('qv-company').value.trim();
      const designation = document.getElementById('qv-designation').value.trim();
      const city = document.getElementById('qv-city').value.trim();

      try {
        const resp = await fetch('/api/events/' + EVENT_ID + '/attendees/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, mobile: phone, company, job_title: designation, city, bio: '', interests: '', linkedin_url: '' })
        });
        const data = await resp.json();

        if (data.error) {
          showToast(data.error, 'error');
          btn.innerHTML = '<i class="fas fa-check-circle mr-2"></i>Register — It\\'s Free!';
          btn.disabled = false;
          return;
        }

        // Success!
        document.getElementById('quick-visitor-form').classList.add('hidden');
        const successDiv = document.getElementById('qv-success');
        successDiv.classList.remove('hidden');
        document.getElementById('qv-success-name').textContent = 'Welcome, ' + data.name + '!';
        const refId = 'BHAI-2026-' + String(data.id).padStart(5, '0');
        document.getElementById('qv-success-msg').innerHTML = 'Your Visitor Pass is confirmed. Reference: <strong>' + refId + '</strong><br>You can now sign in to access networking, inbox & more.';

        // Auto-sign-in the user
        currentUser = data;
        localStorage.setItem('agba_user', JSON.stringify(currentUser));
        upgradeToLoggedIn();
        showToast('Registration successful! Welcome, ' + data.name, 'success');
      } catch(err) {
        showToast('Network error. Please try again.', 'error');
        btn.innerHTML = '<i class="fas fa-check-circle mr-2"></i>Register — It\\'s Free!';
        btn.disabled = false;
      }
    }

    // ==================== INQUIRY SYSTEM ====================
    const INQUIRY_CONFIG = {
      general: { icon: 'fa-question-circle', color: 'text-primary-400', bg: 'bg-primary-500/20', title: 'General Inquiry', subtitle: 'Ask us anything about the event' },
      exhibition: { icon: 'fa-store', color: 'text-amber-400', bg: 'bg-amber-500/20', title: 'Exhibition Inquiry', subtitle: 'Booth packages, availability & pricing' },
      sponsorship: { icon: 'fa-handshake', color: 'text-amber-400', bg: 'bg-amber-500/20', title: 'Sponsorship Inquiry', subtitle: 'Brand visibility & partnership opportunities' },
      speaking: { icon: 'fa-microphone-alt', color: 'text-purple-400', bg: 'bg-purple-500/20', title: 'Speaking Opportunity', subtitle: 'Submit your talk or workshop proposal' },
      media: { icon: 'fa-newspaper', color: 'text-rose-400', bg: 'bg-rose-500/20', title: 'Media / Press Inquiry', subtitle: 'Accreditation, interviews & coverage' },
      group_registration: { icon: 'fa-users', color: 'text-green-400', bg: 'bg-green-500/20', title: 'Group Registration Inquiry', subtitle: 'Delegation discounts for 5+ people' },
      other: { icon: 'fa-ellipsis-h', color: 'text-gray-400', bg: 'bg-white/5', title: 'Other Inquiry', subtitle: 'We\\'ll route your message to the right team' }
    };

    function openInquiryForm(type) {
      const cfg = INQUIRY_CONFIG[type] || INQUIRY_CONFIG.general;
      document.getElementById('inq-type').value = type;
      document.getElementById('inq-icon').className = 'fas ' + cfg.icon + ' text-lg ' + cfg.color;
      document.getElementById('inq-icon-box').className = 'w-10 h-10 rounded-xl ' + cfg.bg + ' flex items-center justify-center shrink-0';
      document.getElementById('inq-title').textContent = cfg.title;
      document.getElementById('inq-subtitle').textContent = cfg.subtitle;

      // Extra fields based on type
      let extra = '';
      if (type === 'exhibition') {
        extra = '<select id="inq-booth-tier" class="w-full px-4 py-3 rounded-xl text-sm"><option value="">Preferred Booth Package</option><option value="Platinum - ₹5,00,000">Platinum — ₹5,00,000</option><option value="Gold - ₹3,00,000">Gold — ₹3,00,000</option><option value="Silver - ₹1,50,000">Silver — ₹1,50,000</option><option value="Startup - ₹75,000">Startup — ₹75,000</option><option value="Undecided">Not sure yet</option></select>';
      } else if (type === 'speaking') {
        extra = '<input type="text" id="inq-topic" placeholder="Proposed Talk / Workshop Topic" class="w-full px-4 py-3 rounded-xl text-sm">';
      } else if (type === 'group_registration') {
        extra = '<div class="grid grid-cols-2 gap-3"><input type="number" id="inq-group-size" placeholder="Group Size" min="2" class="w-full px-4 py-3 rounded-xl text-sm"><select id="inq-pass-type" class="w-full px-4 py-3 rounded-xl text-sm"><option value="">Preferred Pass</option><option value="Delegate">Delegate (₹4,999)</option><option value="VIP">VIP (₹14,999)</option><option value="Academic">Academic (₹999)</option><option value="Visitor">Visitor (Free)</option><option value="Mixed">Mixed</option></select></div>';
      } else if (type === 'sponsorship') {
        extra = '<select id="inq-budget" class="w-full px-4 py-3 rounded-xl text-sm"><option value="">Budget Range</option><option value="Under ₹1 Lakh">Under ₹1 Lakh</option><option value="₹1-3 Lakhs">₹1-3 Lakhs</option><option value="₹3-5 Lakhs">₹3-5 Lakhs</option><option value="₹5-10 Lakhs">₹5-10 Lakhs</option><option value="₹10+ Lakhs">₹10+ Lakhs</option></select>';
      }
      document.getElementById('inq-extra-fields').innerHTML = extra;

      // Show form, hide success
      document.getElementById('inquiry-form').classList.remove('hidden');
      document.getElementById('inq-success').classList.add('hidden');
      document.getElementById('inquiry-modal').classList.remove('hidden');
    }

    function closeInquiryForm() {
      document.getElementById('inquiry-modal').classList.add('hidden');
      // Reset form
      document.getElementById('inquiry-form').reset();
      document.getElementById('inquiry-form').classList.remove('hidden');
      document.getElementById('inq-success').classList.add('hidden');
      document.getElementById('inq-extra-fields').innerHTML = '';
    }

    async function submitInquiry(e) {
      e.preventDefault();
      const btn = document.getElementById('inq-submit-btn');
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Submitting...';
      btn.disabled = true;

      const type = document.getElementById('inq-type').value;
      const metadata = {};
      // Collect extra fields
      const boothTier = document.getElementById('inq-booth-tier');
      if (boothTier) metadata.booth_tier = boothTier.value;
      const topic = document.getElementById('inq-topic');
      if (topic) metadata.topic = topic.value;
      const groupSize = document.getElementById('inq-group-size');
      if (groupSize) metadata.group_size = groupSize.value;
      const passType = document.getElementById('inq-pass-type');
      if (passType) metadata.pass_type = passType.value;
      const budget = document.getElementById('inq-budget');
      if (budget) metadata.budget = budget.value;

      try {
        const resp = await fetch('/api/inquiries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inquiry_type: type,
            name: document.getElementById('inq-name').value.trim(),
            email: document.getElementById('inq-email').value.trim(),
            phone: document.getElementById('inq-phone').value.trim(),
            organization: document.getElementById('inq-org').value.trim(),
            subject: document.getElementById('inq-subject').value.trim(),
            message: document.getElementById('inq-message').value.trim(),
            metadata
          })
        });
        const data = await resp.json();

        if (!resp.ok) {
          showToast(data.error || 'Submission failed', 'error');
          btn.innerHTML = '<i class="fas fa-paper-plane mr-2"></i>Submit Inquiry';
          btn.disabled = false;
          return;
        }

        // Show success
        document.getElementById('inquiry-form').classList.add('hidden');
        document.getElementById('inq-success').classList.remove('hidden');
        showToast('Inquiry submitted! We\\'ll get back to you soon.', 'success');
      } catch(err) {
        showToast('Network error. Please try again.', 'error');
        btn.innerHTML = '<i class="fas fa-paper-plane mr-2"></i>Submit Inquiry';
        btn.disabled = false;
      }
    }

    // ==================== REGISTRATION / SIGN IN ====================
    let authMode = 'signin'; // 'signin' or 'register'

    function switchAuthMode(mode) {
      authMode = mode;
      const signinTab = document.getElementById('auth-tab-signin');
      const registerTab = document.getElementById('auth-tab-register');
      const signinForm = document.getElementById('signin-form');
      const registerForm = document.getElementById('register-form');

      if (mode === 'signin') {
        signinTab.classList.add('tab-active');
        signinTab.classList.remove('text-gray-400');
        registerTab.classList.remove('tab-active');
        registerTab.classList.add('text-gray-400');
        signinForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
      } else {
        registerTab.classList.add('tab-active');
        registerTab.classList.remove('text-gray-400');
        signinTab.classList.remove('tab-active');
        signinTab.classList.add('text-gray-400');
        registerForm.classList.remove('hidden');
        signinForm.classList.add('hidden');
      }
      // Clear error messages
      document.getElementById('signin-error').classList.add('hidden');
      document.getElementById('register-error').classList.add('hidden');
    }

    // Sign In handler
    document.getElementById('signin-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      const errorEl = document.getElementById('signin-error');
      errorEl.classList.add('hidden');
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Signing in...';
      btn.disabled = true;

      try {
        const email = document.getElementById('signin-email').value.trim();
        const resp = await fetch(\`/api/events/\${EVENT_ID}/attendees/signin\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await resp.json();

        if (!resp.ok) {
          errorEl.textContent = data.error || 'Sign in failed. Please check your email.';
          errorEl.classList.remove('hidden');
          btn.innerHTML = '<i class="fas fa-sign-in-alt mr-2"></i>Sign In';
          btn.disabled = false;
          return;
        }

        currentUser = data;
        localStorage.setItem('agba_user', JSON.stringify(currentUser));
        showToast(\`Welcome back, \${currentUser.name}!\`, 'success');
        document.getElementById('registration-modal').classList.add('hidden');
        upgradeToLoggedIn();
        // Check for pending action after manual sign-in
        if (pendingAction === 'download-pass') setTimeout(() => generateDelegatePass(), 1500);
      } catch(err) {
        errorEl.textContent = 'Network error. Please try again.';
        errorEl.classList.remove('hidden');
        btn.innerHTML = '<i class="fas fa-sign-in-alt mr-2"></i>Sign In';
        btn.disabled = false;
      }
    });

    // Magic Link handler
    async function sendMagicLink() {
      const email = document.getElementById('signin-email').value.trim();
      if (!email) {
        const errorEl = document.getElementById('signin-error');
        errorEl.textContent = 'Please enter your email address first.';
        errorEl.classList.remove('hidden');
        return;
      }
      const btn = document.getElementById('magic-link-btn');
      const errorEl = document.getElementById('signin-error');
      const successEl = document.getElementById('magic-link-success');
      errorEl.classList.add('hidden');
      successEl.classList.add('hidden');
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Sending login link...';
      btn.disabled = true;

      try {
        const resp = await fetch(\`/api/events/\${EVENT_ID}/attendees/send-magic-link\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await resp.json();

        if (!resp.ok) {
          errorEl.textContent = data.error || 'Failed to send magic link.';
          errorEl.classList.remove('hidden');
          btn.innerHTML = '<i class="fas fa-magic mr-2"></i>Send Me a Login Link via Email';
          btn.disabled = false;
          return;
        }

        successEl.classList.remove('hidden');
        btn.innerHTML = '<i class="fas fa-check mr-2"></i>Link Sent! Check Your Email';
        setTimeout(() => {
          btn.innerHTML = '<i class="fas fa-magic mr-2"></i>Send Me a Login Link via Email';
          btn.disabled = false;
        }, 10000);
      } catch(err) {
        errorEl.textContent = 'Network error. Please try again.';
        errorEl.classList.remove('hidden');
        btn.innerHTML = '<i class="fas fa-magic mr-2"></i>Send Me a Login Link via Email';
        btn.disabled = false;
      }
    }

    // Register handler
    document.getElementById('register-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      const errorEl = document.getElementById('register-error');
      errorEl.classList.add('hidden');
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Creating account...';
      btn.disabled = true;

      try {
        const user = await api.post(\`/api/events/\${EVENT_ID}/attendees/register\`, {
          name: document.getElementById('reg-name').value,
          email: document.getElementById('reg-email').value,
          company: document.getElementById('reg-company').value,
          job_title: document.getElementById('reg-title').value,
          bio: document.getElementById('reg-bio').value,
          interests: document.getElementById('reg-interests').value,
          mobile: document.getElementById('reg-mobile').value,
          linkedin_url: document.getElementById('reg-linkedin').value,
        });

        if (user.error) {
          errorEl.textContent = user.error;
          errorEl.classList.remove('hidden');
          btn.innerHTML = '<i class="fas fa-user-plus mr-2"></i>Create Account & Enter';
          btn.disabled = false;
          return;
        }

        currentUser = user;
        localStorage.setItem('agba_user', JSON.stringify(currentUser));
        showToast(\`Welcome, \${currentUser.name}! Account created successfully.\`, 'success');
        document.getElementById('registration-modal').classList.add('hidden');
        upgradeToLoggedIn();
        // Check for pending action after registration
        if (pendingAction === 'download-pass') setTimeout(() => generateDelegatePass(), 1500);
      } catch(err) {
        errorEl.textContent = 'Registration failed. Please try again.';
        errorEl.classList.remove('hidden');
        btn.innerHTML = '<i class="fas fa-user-plus mr-2"></i>Create Account & Enter';
        btn.disabled = false;
      }
    });

    // ==================== TAB NAVIGATION ====================
    const PROTECTED_TABS = ['networking', 'inbox', 'myprofile'];

    function switchTab(tab) {
      // Gate protected tabs behind login
      if (PROTECTED_TABS.includes(tab) && !currentUser) {
        pendingTabAfterLogin = tab;
        showRegistration();
        return;
      }
      currentTab = tab;
      document.querySelectorAll('.nav-btn').forEach(b => {
        b.classList.remove('tab-active');
        b.classList.add('text-gray-400');
      });
      const tabBtn = document.querySelector(\`[data-tab="\${tab}"]\`);
      if (tabBtn) { tabBtn.classList.add('tab-active'); tabBtn.classList.remove('text-gray-400'); }
      document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
      const tabEl = document.getElementById(\`tab-\${tab}\`);
      if (tabEl) tabEl.classList.remove('hidden');

      switch(tab) {
        case 'dashboard': loadDashboard(); break;
        case 'schedule': loadSchedule(); break;
        case 'networking': loadAttendees(); break;
        case 'exhibition': loadExhibitors(); break;
        case 'awards': loadAwards(); break;
        case 'agba-categories': loadAgbaCategories(); break;
        case 'agba-jury': loadAgbaJurySchedule(); break;
        case 'startup-pitch': loadStartupPitch(); break;
        case 'innovation': loadInnovationShowcase(); break;
        case 'workshops': break; // Static content, no dynamic loading needed
        case 'inbox': loadInbox(); break;
        case 'myprofile': loadMyProfile(); break;
      }
    }

    const MIN_REGISTRATIONS = 100; // Threshold to show full app features

    // ==================== DASHBOARD ====================
    async function loadDashboard() {
      try {
        const [event, stats, announcements, sessions] = await Promise.all([
          api.get(\`/api/events/\${EVENT_ID}\`),
          api.get(\`/api/events/\${EVENT_ID}/stats\`),
          api.get(\`/api/events/\${EVENT_ID}/announcements\`),
          api.get(\`/api/events/\${EVENT_ID}/sessions\`),
        ]);

        document.getElementById('event-title').textContent = event.title;
        document.getElementById('event-desc').textContent = event.description;
        document.getElementById('event-venue').textContent = event.venue;
        document.getElementById('event-dates').textContent = \`\${event.start_date} to \${event.end_date}\`;

        // Schedule & Workshops are public (great for conversion — visitors see
        // the lineup and register). Only Network + Inbox are gated, and gated
        // by LOGIN, not a registration-count threshold. Any remaining
        // .nav-gated items follow the same login rule as a safety net.
        document.querySelectorAll('.nav-gated').forEach(el => {
          if (currentUser) { el.classList.remove('hidden'); el.classList.add('flex'); }
          else { el.classList.add('hidden'); el.classList.remove('flex'); }
        });

        // Show/hide stats, venue, hero venue/dates
        // NOTE: stats & venue hidden for now — will be re-enabled later
        // ['stats-section', 'venue-section', 'hero-venue-dates'].forEach(id => {
        //   const el = document.getElementById(id);
        //   if (el) el.classList.toggle('hidden', !featuresUnlocked);
        // });
        // Keep all three sections hidden regardless of registration count
        ['stats-section', 'venue-section', 'hero-venue-dates'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.classList.add('hidden');
        });

        const statsData = [
          { icon: 'fa-users', label: 'Attendees', value: stats.attendees, color: 'primary' },
          { icon: 'fa-circle', label: 'Online', value: stats.online, color: 'green' },
          { icon: 'fa-microphone', label: 'Sessions', value: stats.sessions, color: 'purple' },
          { icon: 'fa-store', label: 'Exhibitors', value: stats.exhibitors, color: 'accent' },
          { icon: 'fa-handshake', label: 'Connections', value: stats.connections, color: 'teal' },
          { icon: 'fa-trophy', label: 'Categories', value: stats.categories, color: 'pink' },
        ];

        document.getElementById('stats-grid').innerHTML = statsData.map(s => \`
          <div class="glass rounded-xl p-4 stat-card text-center card-hover cursor-pointer">
            <i class="fas \${s.icon} text-lg text-\${s.color === 'primary' ? 'primary-400' : s.color === 'accent' ? 'accent-400' : s.color === 'green' ? 'green-400' : s.color === 'purple' ? 'purple-400' : s.color === 'teal' ? 'teal-400' : 'pink-400'} mb-2"></i>
            <div class="text-xl font-bold">\${s.value}</div>
            <div class="text-xs text-gray-500">\${s.label}</div>
          </div>
        \`).join('');

        document.getElementById('announcements-feed').innerHTML = announcements.map(a => \`
          <div class="glass rounded-xl p-4 card-hover \${a.pinned ? 'glow border-l-4 border-accent-500' : ''}">
            <div class="flex items-start gap-3">
              <div class="w-10 h-10 rounded-full bg-\${a.announcement_type === 'urgent' ? 'red-500/20' : a.announcement_type === 'schedule_change' ? 'yellow-500/20' : 'primary-500/20'} flex items-center justify-center shrink-0">
                <i class="fas \${a.announcement_type === 'urgent' ? 'fa-exclamation-triangle text-red-400' : a.announcement_type === 'schedule_change' ? 'fa-exchange-alt text-yellow-400' : a.announcement_type === 'award_result' ? 'fa-trophy text-accent-400' : 'fa-bullhorn text-primary-400'}"></i>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <h3 class="font-semibold text-sm">\${a.title}</h3>
                  \${a.pinned ? '<span class="text-xs text-accent-400"><i class="fas fa-thumbtack"></i></span>' : ''}
                </div>
                <p class="text-sm text-gray-400">\${linkify(a.content)}</p>
                <div class="flex items-center gap-3 mt-2 text-xs text-gray-500">
                  <span><i class="fas fa-user mr-1"></i>\${a.author_name}</span>
                  <span><i class="fas fa-clock mr-1"></i>\${new Date(a.created_at).toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>
        \`).join('');

        const now = new Date();
        document.getElementById('upcoming-sessions').innerHTML = sessions.slice(0, 5).map(s => \`
          <div class="glass rounded-xl p-4 card-hover cursor-pointer" onclick="switchTab('schedule')">
            <div class="flex items-center gap-2 mb-2">
              <span class="text-lg">\${s.speaker_avatar || '📌'}</span>
              <span class="px-2 py-0.5 rounded-full text-xs font-medium \${getSessionTypeClass(s.session_type)}">\${s.session_type}</span>
            </div>
            <h3 class="font-semibold text-sm mb-1">\${s.title}</h3>
            <div class="text-xs text-gray-500">
              <span><i class="fas fa-clock mr-1"></i>\${formatTime(s.start_time)} - \${formatTime(s.end_time)}</span>
              \${s.room ? \`<span class="ml-2"><i class="fas fa-map-pin mr-1"></i>\${s.room}</span>\` : ''}
            </div>
          </div>
        \`).join('');
      } catch(e) { console.error('Dashboard error:', e); }

      // Conditionally show/hide sections based on auth state
      const rsvpCard = document.getElementById('rsvp-card-container');
      const quickActions = document.getElementById('home-quick-actions');
      const registerVisitorBtn = document.getElementById('register-visitor-btn');
      if (currentUser) {
        if (rsvpCard) rsvpCard.classList.remove('hidden');
        if (quickActions) quickActions.classList.remove('hidden');
        if (registerVisitorBtn) registerVisitorBtn.classList.add('hidden');
      } else {
        if (rsvpCard) rsvpCard.classList.add('hidden');
        if (quickActions) quickActions.classList.add('hidden');
        if (registerVisitorBtn) registerVisitorBtn.classList.remove('hidden');
      }

      // Update arrival time card on homepage
      updateArrivalCard();
      // Update RSVP card on homepage
      updateRsvpCard();
    }

    function updateArrivalCard() {
      const titleEl = document.getElementById('arrival-card-title');
      const descEl = document.getElementById('arrival-card-desc');
      const iconEl = document.getElementById('arrival-card-icon');
      const cardEl = document.getElementById('arrival-time-card');
      if (!titleEl || !cardEl) return;
      if (currentUser && currentUser.arrival_time) {
        // Format time for display
        const [h, m] = currentUser.arrival_time.split(':');
        const hr = parseInt(h);
        const ampm = hr >= 12 ? 'PM' : 'AM';
        const displayHr = hr > 12 ? hr - 12 : (hr === 0 ? 12 : hr);
        const timeStr = displayHr + ':' + m + ' ' + ampm;
        titleEl.textContent = 'Arrival Time: ' + timeStr;
        descEl.textContent = 'Tap to change your arrival time at WTC Mumbai';
        iconEl.className = 'fas fa-check-circle text-green-400 text-lg';
        cardEl.className = cardEl.className.replace('border-amber-500/20', 'border-green-500/20');
      } else {
        titleEl.textContent = 'Set Your Arrival Time';
        descEl.textContent = 'Help us plan logistics \u2013 when will you arrive at the venue?';
        iconEl.className = 'fas fa-chevron-right text-amber-400 text-lg';
      }
    }

    // ==================== SCHEDULE ====================
    let selectedDay = '2026-11-20';
    let selectedHall = 'Homi J. Bhabha Hall';
    let selectedTrack = '';

    const HALLS = [
      { key: 'Homi J. Bhabha Hall', short: 'Bhabha Hall', icon: '🏛️' },
      { key: 'Kalam Theatre',       short: 'Kalam',       icon: '🎭' },
      { key: 'Raman Theatre',       short: 'Raman',       icon: '🔬' },
      { key: 'Aryabhata Theatre',   short: 'Aryabhata',   icon: '🚀' },
    ];

    function renderScheduleSessionCard(s) {
      const isPanel = s.speaker_name && s.speaker_name.includes(',') && (s.session_type === 'panel' || s.speaker_name.split(',').length >= 3);
      let speakerHtml = '';
      if (isPanel && s.speaker_name) {
        const panelists = s.speaker_name.split(',').map(p => p.trim()).filter(Boolean);
        speakerHtml = \`
          <div class="mt-3 pt-3 border-t border-white/5">
            <div class="flex items-center gap-1.5 mb-2.5">
              <i class="fas fa-microphone-alt text-primary-400 text-xs"></i>
              <span class="text-xs font-semibold text-gray-300">Panelists</span>
            </div>
            <div class="flex flex-wrap gap-2">
              \${panelists.map(p => {
                const match = p.match(/^(.+?)\\s*\\((.+?)\\)$/);
                const pName = match ? match[1].trim() : p.trim();
                const pInfo = match ? match[2].trim() : '';
                const isMod = pInfo.toLowerCase() === 'moderator' || pName.toLowerCase().includes('moderator');
                const cleanName = pName.replace(/\\s*\\(moderator\\)/i, '').trim();
                return \`<div class="flex items-center gap-2 glass-light rounded-xl px-3 py-2 \${isMod ? 'border border-amber-500/30' : ''}">
                  <img src="\${getAvatarUrl(null, cleanName, 40)}" alt="\${cleanName}" class="w-8 h-8 rounded-full object-cover shrink-0">
                  <div class="min-w-0">
                    <div class="text-xs font-semibold text-white truncate">\${cleanName}</div>
                    \${pInfo ? \`<div class="text-[10px] text-gray-400 truncate">\${pInfo}</div>\` : ''}
                    \${isMod && pInfo.toLowerCase() !== 'moderator' ? \`<div class="text-[10px] text-amber-400 font-semibold">Moderator</div>\` : ''}
                  </div>
                </div>\`;
              }).join('')}
            </div>
          </div>\`;
      } else if (s.speaker_name) {
        speakerHtml = \`<div class="flex items-center gap-2 mt-2">
          <img src="\${getAvatarUrl(null, s.speaker_name, 40)}" alt="\${s.speaker_name}" class="w-7 h-7 rounded-full object-cover shrink-0">
          <span class="text-xs text-gray-300 font-medium">\${s.speaker_name}\${s.speaker_title ? ' <span class="text-gray-500 font-normal">· ' + s.speaker_title + '</span>' : ''}</span>
        </div>\`;
      }

      // Time display — strip date part, show HH:MM am/pm
      const startT = s.start_time ? s.start_time.replace('T',' ') : '';
      const endT   = s.end_time   ? s.end_time.replace('T',' ')   : '';
      const fmtT = dt => {
        if (!dt) return '';
        const parts = dt.trim().split(' ');
        const t = parts[parts.length-1]; // HH:MM or HH:MM:SS
        const [h,m] = t.split(':');
        const hr = parseInt(h);
        const ampm = hr >= 12 ? 'pm' : 'am';
        const disp = hr > 12 ? hr-12 : (hr===0 ? 12 : hr);
        return disp + ':' + m + ' ' + ampm;
      };

      const isBreak = s.session_type === 'break';
      const cardBg  = isBreak ? 'bg-white/3 border border-white/5' : 'glass card-hover';

      return \`
      <div class="\${cardBg} rounded-xl p-4">
        <div class="flex items-start gap-4">
          <!-- Time column -->
          <div class="shrink-0 w-[72px] text-center pt-0.5">
            <div class="text-base font-bold text-primary-400 leading-tight">\${fmtT(startT)}</div>
            <div class="text-[11px] text-gray-500 mt-0.5">\${fmtT(endT)}</div>
          </div>
          <!-- Content -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1.5 flex-wrap">
              <span class="text-lg leading-none">\${s.speaker_avatar || '📌'}</span>
              <span class="px-2 py-0.5 rounded-full text-[11px] font-semibold \${getSessionTypeClass(s.session_type)}">\${s.session_type}</span>
              \${s.track ? \`<span class="px-2 py-0.5 rounded-full text-[11px] bg-white/5 text-gray-400">\${s.track}</span>\` : ''}
            </div>
            <h3 class="font-bold text-[15px] leading-snug mb-1 \${isBreak ? 'text-gray-400' : 'text-white'}">\${s.title}</h3>
            \${s.description && !isBreak ? \`<p class="text-xs text-gray-400 mb-2 leading-relaxed">\${s.description}</p>\` : ''}
            \${s.title.toLowerCase().includes('innovation talk') ? \`<button onclick="event.stopPropagation();switchTab('innovation')" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 transition mb-2"><i class="fas fa-lightbulb"></i>Full Innovation Talk Schedule <i class="fas fa-arrow-right text-[10px]"></i></button>\` : ''}
            \${s.title.toLowerCase().includes('startup pitch') ? \`<button onclick="event.stopPropagation();switchTab('startup-pitch')" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-500/15 text-violet-400 hover:bg-violet-500/25 transition mb-2"><i class="fas fa-rocket"></i>View Startup Pitch Schedule <i class="fas fa-arrow-right text-[10px]"></i></button>\` : ''}
            \${!isPanel ? speakerHtml : ''}
            \${s.room && selectedHall === '' ? \`<div class="mt-1.5 text-[11px] text-gray-500"><i class="fas fa-map-pin mr-1 text-accent-400"></i>\${s.room}</div>\` : ''}
            \${isPanel ? speakerHtml : ''}
          </div>
        </div>
      </div>\`;
    }

    async function loadSchedule() {
      const listEl = document.getElementById('sched-sessions-list');
      if (!listEl) return;
      listEl.innerHTML = '<div class="text-center py-12"><i class="fas fa-spinner fa-spin text-2xl text-primary-400"></i><p class="text-gray-400 text-sm mt-2">Loading schedule...</p></div>';

      try {
        const [sessions, tracks] = await Promise.all([
          api.get(\`/api/events/\${EVENT_ID}/sessions?date=\${selectedDay}\${selectedHall ? '&room=' + encodeURIComponent(selectedHall) : ''}\${selectedTrack ? '&track=' + encodeURIComponent(selectedTrack) : ''}\`),
          api.get(\`/api/events/\${EVENT_ID}/sessions/tracks\`),
        ]);

        // ── Day selector ──
        const days = [{ val:'2026-11-20', label:'Day 1 · 20 Nov 2026' },{ val:'2026-11-21', label:'Day 2 · 21 Nov 2026' }];
        document.getElementById('sched-day-selector').innerHTML = days.map(d => \`
          <button onclick="selectedDay='\${d.val}'; loadSchedule()"
            class="px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-all \${selectedDay === d.val ? 'tab-active' : 'glass text-gray-400 hover:text-white'}">
            \${d.label}
          </button>\`).join('');

        // ── Hall tabs ──
        document.getElementById('sched-hall-tabs').innerHTML = HALLS.map(h => \`
          <button onclick="selectedHall='\${h.key}'; selectedTrack=''; loadSchedule()"
            class="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-all \${selectedHall === h.key ? 'bg-primary-500/30 text-primary-300 border border-primary-500/40' : 'glass text-gray-400 hover:text-white'}">
            <span class="text-base leading-none">\${h.icon}</span>
            <span class="hidden sm:inline">\${h.key}</span>
            <span class="sm:hidden">\${h.short}</span>
          </button>\`).join('');

        // ── Track filter ──
        document.getElementById('sched-track-filter').innerHTML = \`
          <button onclick="selectedTrack=''; loadSchedule()"
            class="px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all \${!selectedTrack ? 'tab-active' : 'glass text-gray-400 hover:text-white'}">
            All Tracks
          </button>
          \${tracks.map(t => \`
            <button onclick="selectedTrack='\${t}'; loadSchedule()"
              class="px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all \${selectedTrack === t ? 'tab-active' : 'glass text-gray-400 hover:text-white'}">
              \${t}
            </button>\`).join('')}\`;

        // ── Sessions list ──
        listEl.innerHTML = sessions.length
          ? sessions.map(renderScheduleSessionCard).join('')
          : '<div class="text-center text-gray-500 py-12"><i class="fas fa-calendar-times text-4xl mb-3 block opacity-40"></i><p>No sessions found for this filter.</p></div>';

      } catch(e) { console.error('Schedule error:', e); listEl.innerHTML = '<div class="text-center text-gray-500 py-12">Failed to load schedule. Please try again.</div>'; }
    }

    // ==================== NETWORKING ====================
    function isVisitorPass() {
      return (currentUser?.badge_type || '').toLowerCase().includes('visitor');
    }

    function showNetworkUpgradeModal() {
      const m = document.getElementById('visitor-upgrade-modal');
      m.classList.remove('hidden');
      m.classList.add('flex');
    }

    function applyVisitorNetworkLock() {
      const isVisitor = isVisitorPass();
      const banner   = document.getElementById('visitor-network-banner');
      const lockEl   = document.getElementById('visitor-grid-lock');
      const gridEl   = document.getElementById('attendee-grid');
      const searchEl = document.getElementById('attendee-search');
      const filterEl = document.getElementById('role-filter');

      if (isVisitor) {
        // Show banner
        banner?.classList.remove('hidden');
        // Show lock overlay
        lockEl?.classList.remove('hidden');
        // Blur the grid
        if (gridEl) gridEl.style.filter = 'blur(4px)';
        if (gridEl) gridEl.style.pointerEvents = 'none';
        if (gridEl) gridEl.style.userSelect = 'none';
        // Make search/filter trigger upgrade modal instead
        const triggerUpgrade = (e) => { e.preventDefault(); e.stopPropagation(); showNetworkUpgradeModal(); };
        if (searchEl) { searchEl.readOnly = true; searchEl.addEventListener('focus', triggerUpgrade); }
        if (filterEl) { filterEl.disabled = true; filterEl.addEventListener('mousedown', triggerUpgrade); }
        // Scroll listener on the networking tab
        const netTab = document.getElementById('tab-networking');
        if (netTab) {
          netTab._visitorScrollHandler = () => showNetworkUpgradeModal();
          netTab.addEventListener('scroll', netTab._visitorScrollHandler, { once: true });
        }
        // Listen to window scroll too (page-level)
        window._visitorScrollHandler = () => showNetworkUpgradeModal();
        window.addEventListener('scroll', window._visitorScrollHandler, { once: true });
      } else {
        // Not a visitor — make sure lock is hidden and grid unblurred
        banner?.classList.add('hidden');
        lockEl?.classList.add('hidden');
        if (gridEl) { gridEl.style.filter = ''; gridEl.style.pointerEvents = ''; gridEl.style.userSelect = ''; }
        if (searchEl) searchEl.readOnly = false;
        if (filterEl) filterEl.disabled = false;
      }
    }

    async function loadAttendees() {
      const search = document.getElementById('attendee-search')?.value || '';
      const role = document.getElementById('role-filter')?.value || '';

      // Always load a preview of attendees (so the blurred grid looks real)
      try {
        const attendees = await api.get(\`/api/events/\${EVENT_ID}/attendees?search=\${encodeURIComponent(search)}&role=\${role}\`);
        document.getElementById('attendee-grid').innerHTML = attendees.filter(a => a.id !== currentUser?.id).map(a => {
          const compLogo = getCompanyLogoUrl(a.company, a.website_url, a.linkedin_url, a.email);
          return \`
          <div class="glass rounded-xl p-5 \${isVisitorPass() ? '' : 'card-hover'}">
            <div class="flex items-start gap-3">
              <div class="relative">
                <img src="\${getAvatarUrl(a.email, a.name, 112, a.avatar_url)}" alt="\${a.name}" class="w-14 h-14 rounded-full object-cover">
                <span class="\${a.is_online ? 'online-dot' : 'offline-dot'} absolute -bottom-0.5 -right-0.5 border-2 border-dark-900"></span>
                \${compLogo ? \`<img src="\${compLogo}" alt="" class="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-white border border-white/20 shadow-sm object-contain" onerror="this.style.display='none'">\` : ''}
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <h3 class="font-semibold text-sm truncate">\${a.name}</h3>
                  <span class="px-1.5 py-0.5 rounded text-[10px] font-medium \${getBadgeClass(a.badge_type)}">\${displayBadge(a.badge_type)}</span>
                </div>
                <p class="text-xs text-gray-400 truncate">\${a.job_title || ''}\${a.job_title && a.company ? ' · ' : ''}\${a.company || ''}</p>
                \${a.interests ? \`<div class="flex flex-wrap gap-1 mt-2">\${a.interests.split(',').slice(0,3).map(i => \`<span class="px-2 py-0.5 rounded-full text-[10px] bg-white/5 text-gray-400">\${i.trim()}</span>\`).join('')}</div>\` : ''}
              </div>
            </div>
            <div class="flex gap-2 mt-4">
              <button onclick="\${isVisitorPass() ? 'showNetworkUpgradeModal()' : 'viewProfile(' + a.id + ')'}" class="flex-1 py-2 rounded-lg text-xs font-medium glass hover:bg-white/10 transition"><i class="fas fa-user mr-1"></i>Profile</button>
              <button onclick="\${isVisitorPass() ? 'showNetworkUpgradeModal()' : 'sendConnectionRequest(' + a.id + ')'}" class="flex-1 py-2 rounded-lg text-xs font-medium bg-primary-600/20 text-primary-300 hover:bg-primary-600/30 transition"><i class="fas fa-plus mr-1"></i>Connect</button>
              <button onclick="\${isVisitorPass() ? 'showNetworkUpgradeModal()' : 'openChat(' + a.id + ', \\'' + a.name.replace(/'/g, '&apos;') + '\\', \\'' + (a.company || '').replace(/'/g, '&apos;') + '\\')'}" class="py-2 px-3 rounded-lg text-xs font-medium bg-accent-500/20 text-accent-300 hover:bg-accent-500/30 transition" title="Message"><i class="fas fa-comment"></i></button>
              <button onclick="\${isVisitorPass() ? 'showNetworkUpgradeModal()' : 'openMeetingModal(' + a.id + ')'}" class="py-2 px-3 rounded-lg text-xs font-medium bg-green-500/20 text-green-300 hover:bg-green-500/30 transition" title="Schedule Meeting"><i class="fas fa-calendar-plus"></i></button>
            </div>
          </div>\`;
        }).join('') || '<div class="text-center text-gray-500 py-12 col-span-full"><i class="fas fa-search text-4xl mb-3 block"></i>No attendees found.</div>';

        // Apply visitor lock AFTER grid is populated
        applyVisitorNetworkLock();

      } catch(e) { console.error('Attendees error:', e); }
    }

    function debounceSearch() {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(loadAttendees, 300);
    }

    // ==================== PROFILE MODAL ====================
    async function viewProfile(id) {
      try {
        const a = await api.get(\`/api/attendees/\${id}\`);
        const compLogo = getCompanyLogoUrl(a.company, a.website_url, a.linkedin_url, a.email);
        document.getElementById('profile-name').textContent = a.name;
        document.getElementById('profile-content').innerHTML = \`
          <div class="flex items-center gap-4 mb-4">
            <div class="relative">
              <img src="\${getAvatarUrl(a.email, a.name, 160, a.avatar_url)}" alt="\${a.name}" class="w-20 h-20 rounded-full object-cover">
              \${compLogo ? \`<img src="\${compLogo}" alt="" class="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-white border-2 border-dark-900 shadow object-contain p-0.5" onerror="this.style.display='none'">\` : ''}
            </div>
            <div>
              <div class="flex items-center gap-2">
                <span class="\${a.is_online ? 'online-dot' : 'offline-dot'}"></span>
                <span class="text-xs text-gray-400">\${a.is_online ? 'Online' : 'Offline'}</span>
                <span class="px-2 py-0.5 rounded text-xs font-medium \${getBadgeClass(a.badge_type)}">\${displayBadge(a.badge_type)}</span>
              </div>
              <p class="font-semibold mt-1">\${a.job_title || 'Attendee'}</p>
              <p class="text-sm text-gray-400 flex items-center gap-1.5">\${compLogo ? \`<img src="\${compLogo}" alt="" class="w-4 h-4 rounded object-contain inline-block" onerror="this.style.display='none'">\` : ''}\${a.company || ''}</p>
            </div>
          </div>
          \${a.bio ? \`<p class="text-sm text-gray-300 mb-4">\${a.bio}</p>\` : ''}
          \${a.interests ? \`
            <div class="mb-4">
              <h4 class="text-xs font-semibold text-gray-500 uppercase mb-2">Interests</h4>
              <div class="flex flex-wrap gap-1">\${a.interests.split(',').map(i => \`<span class="px-2 py-1 rounded-full text-xs bg-primary-500/20 text-primary-300">\${i.trim()}</span>\`).join('')}</div>
            </div>
          \` : ''}
          <div class="flex gap-3 mb-4">
            \${a.linkedin_url ? \`<a href="\${a.linkedin_url}" target="_blank" class="text-blue-400 hover:text-blue-300"><i class="fab fa-linkedin text-xl"></i></a>\` : ''}
            \${a.twitter_url ? \`<a href="\${a.twitter_url}" target="_blank" class="text-sky-400 hover:text-sky-300"><i class="fab fa-twitter text-xl"></i></a>\` : ''}
            \${a.website_url ? \`<a href="\${a.website_url}" target="_blank" class="text-gray-400 hover:text-white"><i class="fas fa-globe text-xl"></i></a>\` : ''}
          </div>
          <div class="flex gap-2">
            <button onclick="sendConnectionRequest(\${a.id}); closeProfileModal();" class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-primary-600 hover:bg-primary-500 text-white transition"><i class="fas fa-user-plus mr-2"></i>Connect</button>
            <button onclick="openChat(\${a.id}, '\${a.name.replace(/'/g, "&apos;")}', '\${(a.company || '').replace(/'/g, "&apos;")}'); closeProfileModal();" class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-accent-500/20 text-accent-300 hover:bg-accent-500/30 transition"><i class="fas fa-comment mr-2"></i>Message</button>
            <button onclick="openMeetingModal(\${a.id}); closeProfileModal();" class="py-2.5 px-4 rounded-xl text-sm font-medium glass hover:bg-white/10 transition"><i class="fas fa-calendar-plus"></i></button>
          </div>
        \`;
        document.getElementById('profile-modal').classList.remove('hidden');
      } catch(e) { console.error('Profile error:', e); }
    }

    function closeProfileModal() { document.getElementById('profile-modal').classList.add('hidden'); }

    // ==================== CONNECTIONS ====================
    async function sendConnectionRequest(toId) {
      if (!currentUser) return;
      try {
        const res = await api.post('/api/connections', {
          event_id: EVENT_ID,
          from_attendee_id: currentUser.id,
          to_attendee_id: toId,
          message: 'Would love to connect!'
        });
        if (res.error) { showToast(res.error, 'warning'); }
        else { showToast('Connection request sent!', 'success'); }
      } catch(e) { showToast('Failed to send request', 'error'); }
    }

    // ==================== CHAT ====================
    let chatPartnerId = null;

    async function openChat(partnerId, name, company) {
      if (!currentUser) return;
      chatPartnerId = partnerId;
      document.getElementById('chat-partner-name').textContent = name;
      document.getElementById('chat-partner-company').textContent = company;
      document.getElementById('chat-modal').classList.remove('hidden');
      await loadMessages();
    }

    function closeChatModal() {
      document.getElementById('chat-modal').classList.add('hidden');
      chatPartnerId = null;
    }

    async function loadMessages() {
      if (!currentUser || !chatPartnerId) return;
      try {
        const messages = await api.get(\`/api/messages/\${currentUser.id}/\${chatPartnerId}\`);
        const container = document.getElementById('chat-messages');
        container.innerHTML = messages.length ? messages.map(m => \`
          <div class="flex \${m.sender_id == currentUser.id ? 'justify-end' : 'justify-start'}">
            <div class="max-w-[80%] px-4 py-2.5 \${m.sender_id == currentUser.id ? 'chat-bubble-sent' : 'chat-bubble-received'}">
              <p class="text-sm">\${m.content}</p>
              <p class="text-[10px] text-gray-400 mt-1 \${m.sender_id == currentUser.id ? 'text-right' : ''}">\${new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</p>
            </div>
          </div>
        \`).join('') : '<div class="text-center text-gray-500 py-8"><i class="fas fa-comments text-3xl mb-2 block"></i><p class="text-sm">Start a conversation!</p></div>';
        container.scrollTop = container.scrollHeight;
      } catch(e) { console.error('Messages error:', e); }
    }

    document.getElementById('chat-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('chat-input');
      const content = input.value.trim();
      if (!content || !currentUser || !chatPartnerId) return;
      input.value = '';

      try {
        await api.post('/api/messages', {
          event_id: EVENT_ID,
          sender_id: currentUser.id,
          receiver_id: chatPartnerId,
          content
        });
        await loadMessages();
      } catch(e) { console.error('Send message error:', e); }
    });

    // ==================== MEETINGS ====================
    function openMeetingModal(requesteeId) {
      document.getElementById('meeting-requestee-id').value = requesteeId;
      document.getElementById('meeting-modal').classList.remove('hidden');
    }

    function closeMeetingModal() {
      document.getElementById('meeting-modal').classList.add('hidden');
    }

    document.getElementById('meeting-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentUser) return;

      try {
        await api.post('/api/meetings', {
          event_id: EVENT_ID,
          requester_id: currentUser.id,
          requestee_id: parseInt(document.getElementById('meeting-requestee-id').value),
          title: document.getElementById('meeting-title').value,
          meeting_time: document.getElementById('meeting-time').value,
          duration_minutes: parseInt(document.getElementById('meeting-duration').value),
          location: document.getElementById('meeting-location').value,
          notes: document.getElementById('meeting-notes').value,
        });
        closeMeetingModal();
        showToast('Meeting request sent!', 'success');
        document.getElementById('meeting-form').reset();
      } catch(e) { showToast('Failed to schedule meeting', 'error'); }
    });

    // ==================== EXHIBITION ====================
    let selectedExhibitorCategory = '';

    async function loadExhibitors() {
      const search = document.getElementById('exhibitor-search')?.value || '';
      try {
        const [exhibitors, categories] = await Promise.all([
          api.get(\`/api/events/\${EVENT_ID}/exhibitors?category=\${encodeURIComponent(selectedExhibitorCategory)}&search=\${encodeURIComponent(search)}\`),
          api.get(\`/api/events/\${EVENT_ID}/exhibitors/categories\`),
        ]);

        document.getElementById('exhibitor-categories').innerHTML = \`
          <button onclick="selectedExhibitorCategory=''; loadExhibitors()" class="px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all \${!selectedExhibitorCategory ? 'tab-active' : 'glass text-gray-400 hover:text-white'}">All Categories</button>
          \${categories.map(c => \`
            <button onclick="selectedExhibitorCategory='\${c}'; loadExhibitors()" class="px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all \${selectedExhibitorCategory === c ? 'tab-active' : 'glass text-gray-400 hover:text-white'}">\${c}</button>
          \`).join('')}
        \`;

        document.getElementById('exhibitor-grid').innerHTML = exhibitors.map(ex => {
          const exLogo = getCompanyLogoUrl(ex.company_name, ex.website_url, '', ex.contact_email);
          return \`
          <div class="glass rounded-xl p-5 card-hover \${ex.booth_size === 'platinum' ? 'booth-platinum glow-accent' : ex.booth_size === 'premium' ? 'booth-premium glow' : 'booth-standard'}">
            <div class="flex items-start justify-between mb-3">
              <div class="flex items-center gap-3">
                <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-primary-500/20 to-accent-500/20 flex items-center justify-center text-lg font-bold text-primary-300 overflow-hidden">\${exLogo ? \`<img src="\${exLogo}" alt="\${ex.company_name}" class="w-8 h-8 object-contain" onerror="this.parentElement.innerHTML='\${ex.company_name.charAt(0)}'">\` : ex.company_name.charAt(0)}</div>
                <div>
                  <h3 class="font-bold">\${ex.company_name}</h3>
                  <div class="flex items-center gap-2 text-xs text-gray-500">
                    <span><i class="fas fa-map-pin mr-1"></i>Booth \${ex.booth_number}</span>
                    <span class="px-1.5 py-0.5 rounded text-[10px] font-medium \${ex.booth_size === 'platinum' ? 'bg-accent-500/20 text-accent-300' : ex.booth_size === 'premium' ? 'bg-primary-500/20 text-primary-300' : 'bg-white/5 text-gray-400'}">\${ex.booth_size}</span>
                  </div>
                </div>
              </div>
              <div class="text-right">
                <div class="text-lg font-bold text-primary-400">\${ex.visitor_count}</div>
                <div class="text-[10px] text-gray-500">visitors</div>
              </div>
            </div>
            <p class="text-sm text-gray-400 mb-3">\${ex.description}</p>
            <div class="mb-3">
              <span class="px-2 py-0.5 rounded-full text-xs bg-white/5 text-gray-400">\${ex.category}</span>
            </div>
            \${ex.products ? \`
              <div class="flex flex-wrap gap-1 mb-3">
                \${ex.products.split(',').map(p => \`<span class="px-2 py-0.5 rounded-full text-[10px] bg-primary-500/10 text-primary-300">\${p.trim()}</span>\`).join('')}
              </div>
            \` : ''}
            <div class="flex gap-2">
              <button onclick="visitBooth(\${ex.id})" class="flex-1 py-2 rounded-lg text-xs font-medium bg-primary-600/20 text-primary-300 hover:bg-primary-600/30 transition"><i class="fas fa-door-open mr-1"></i>Visit Booth</button>
              \${ex.website_url ? \`<a href="\${ex.website_url}" target="_blank" class="py-2 px-3 rounded-lg text-xs font-medium glass hover:bg-white/10 transition"><i class="fas fa-external-link-alt"></i></a>\` : ''}
            </div>
          </div>
        \`}).join('') || '<div class="text-center text-gray-500 py-12 col-span-full"><i class="fas fa-store-slash text-4xl mb-3 block"></i>No exhibitors found.</div>';
      } catch(e) { console.error('Exhibitors error:', e); }
    }

    function debounceExhibitorSearch() {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(loadExhibitors, 300);
    }

    function highlightBooth(companyName) {
      // Set search to company name and reload
      const searchInput = document.getElementById('exhibitor-search');
      if (searchInput) {
        searchInput.value = companyName;
        loadExhibitors();
        // Scroll to the exhibitor grid
        setTimeout(() => {
          const grid = document.getElementById('exhibitor-grid');
          if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 400);
      }
    }

    async function visitBooth(exhibitorId) {
      if (!currentUser) return;
      try {
        await api.post(\`/api/exhibitors/\${exhibitorId}/visit\`, {
          attendee_id: currentUser.id,
          event_id: EVENT_ID,
          interested: true
        });
        showToast('Booth visited! Contact details shared.', 'success');
        loadExhibitors();
      } catch(e) { showToast('Failed to record visit', 'error'); }
    }

    // ==================== BOOTH CATALOG & REQUEST SYSTEM ====================

    function switchExhibitionSubtab(tab) {
      document.querySelectorAll('.exh-subtab').forEach(b => {
        b.classList.remove('tab-active');
        b.classList.add('text-gray-400');
      });
      const activeBtn = document.querySelector('.exh-subtab[data-exh-tab="'+tab+'"]');
      if (activeBtn) { activeBtn.classList.add('tab-active'); activeBtn.classList.remove('text-gray-400'); }
      document.querySelectorAll('.exh-sub-content').forEach(d => d.classList.add('hidden'));
      const sub = document.getElementById('exh-sub-'+tab);
      if (sub) sub.classList.remove('hidden');
      if (tab === 'booth-catalog') loadBoothCatalog();
      if (tab === 'my-requests') loadMyBoothRequests();
      if (tab === 'exhibitors') loadExhibitors();
    }

    let boothTypesCache = [];

    async function loadBoothCatalog() {
      const container = document.getElementById('booth-catalog-container');
      if (!container) return;
      container.innerHTML = '<div class="text-center py-12"><i class="fas fa-spinner fa-spin text-2xl text-primary-400"></i><p class="text-sm text-gray-500 mt-2">Loading booth types...</p></div>';
      try {
        const types = await api.get('/api/booth-types');
        boothTypesCache = types;
        const totalBooths = types.reduce((s,t) => s + t.total_count, 0);
        const totalArea = types.reduce((s,t) => s + t.total_area_sqm, 0);

        container.innerHTML = \`
          <div class="mb-8">
            <div class="glass rounded-2xl p-6 border border-primary-500/20 mb-6">
              <div class="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-4">
                <div>
                  <h3 class="text-xl font-bold mb-1"><i class="fas fa-th-large text-primary-400 mr-2"></i>Exhibition Booth Packages</h3>
                  <p class="text-sm text-gray-400">Choose your perfect exhibition space at Bharat AI Innovation 2026</p>
                </div>
                <div class="flex gap-4 text-center">
                  <div class="glass rounded-xl px-4 py-2">
                    <div class="text-lg font-black text-accent-400">\${totalArea.toLocaleString()}</div>
                    <div class="text-[10px] text-gray-500 uppercase">sqm Area</div>
                  </div>
                  <div class="glass rounded-xl px-4 py-2">
                    <div class="text-lg font-black text-green-400">7</div>
                    <div class="text-[10px] text-gray-500 uppercase">Categories</div>
                  </div>
                </div>
              </div>
              <div class="flex flex-wrap gap-2">
                <span class="px-3 py-1 rounded-full text-xs bg-green-500/15 text-green-400 border border-green-500/20"><i class="fas fa-check-circle mr-1"></i>Custom branding</span>
                <span class="px-3 py-1 rounded-full text-xs bg-blue-500/15 text-blue-400 border border-blue-500/20"><i class="fas fa-wifi mr-1"></i>High-speed internet</span>
                <span class="px-3 py-1 rounded-full text-xs bg-purple-500/15 text-purple-400 border border-purple-500/20"><i class="fas fa-bolt mr-1"></i>Power included</span>
                <span class="px-3 py-1 rounded-full text-xs bg-amber-500/15 text-amber-400 border border-amber-500/20"><i class="fas fa-id-badge mr-1"></i>Event badges</span>
                <span class="px-3 py-1 rounded-full text-xs bg-pink-500/15 text-pink-400 border border-pink-500/20"><i class="fas fa-mobile-alt mr-1"></i>App listing</span>
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              \${types.map((bt, idx) => {
                const features = JSON.parse(bt.features || '[]');
                const availPct = Math.round((bt.available_count / bt.total_count) * 100);
                const urgency = bt.available_count <= 3 ? 'text-red-400' : bt.available_count <= 8 ? 'text-amber-400' : 'text-green-400';
                const isMega = bt.slug === 'mega-pavilion' || bt.slug === 'flagship-pavilion';
                return \`
                <div class="glass rounded-2xl overflow-hidden card-hover border border-white/5 hover:border-opacity-40 flex flex-col \${isMega ? 'md:col-span-2 xl:col-span-1' : ''}" style="border-top: 3px solid \${bt.color};">
                  <div class="p-5 flex-1">
                    <div class="flex items-start justify-between mb-3">
                      <div class="flex items-center gap-3">
                        <div class="w-12 h-12 rounded-xl flex items-center justify-center" style="background:\${bt.color}20;">
                          <i class="fas \${bt.icon} text-xl" style="color:\${bt.color};"></i>
                        </div>
                        <div>
                          <h3 class="font-bold text-base">\${bt.name}</h3>
                          <div class="flex items-center gap-2 text-xs text-gray-500">
                            <span><i class="fas fa-ruler-combined mr-1"></i>\${bt.size_label}m</span>
                            <span class="text-gray-600">•</span>
                            <span>\${bt.area_sqm} sqm / \${bt.area_sqft} sqft</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <p class="text-xs text-gray-400 mb-4 leading-relaxed">\${bt.description}</p>

                    <!-- Price -->
                    <div class="glass rounded-xl p-3 mb-4">
                      <div class="flex items-baseline gap-2">
                        <span class="text-2xl font-black" style="color:\${bt.color};">₹\${Number(bt.price_inr).toLocaleString('en-IN')}</span>
                        <span class="text-xs text-gray-500">+ GST</span>
                      </div>
                    </div>

                    <!-- Features -->
                    <div class="space-y-1.5 mb-4">
                      \${features.slice(0, 5).map(f => \`
                        <div class="flex items-start gap-2 text-xs text-gray-300">
                          <i class="fas fa-check-circle mt-0.5" style="color:\${bt.color}; font-size:10px;"></i>
                          <span>\${f}</span>
                        </div>
                      \`).join('')}
                      \${features.length > 5 ? \`<div class="text-[10px] text-gray-500 pl-5">+\${features.length - 5} more features</div>\` : ''}
                    </div>

                    <!-- Area Info -->
                    <div class="flex items-center gap-3 text-[10px] text-gray-500 mb-4">
                      <span><i class="fas fa-vector-square mr-1"></i>\${bt.area_sqm} sqm area</span>
                    </div>
                  </div>

                  <!-- Action Buttons -->
                  <div class="p-4 pt-0 flex gap-2">
                    <button onclick="openBoothRequestForm(\${bt.id})" class="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition hover:opacity-90" style="background:\${bt.color};">
                      <i class="fas fa-paper-plane mr-1.5"></i>Request Booth
                    </button>
                    <button onclick="viewBoothDetails(\${bt.id})" class="py-2.5 px-4 rounded-xl text-sm font-medium glass hover:bg-white/10 transition text-gray-300">
                      <i class="fas fa-info-circle"></i>
                    </button>
                  </div>
                </div>
              \`}).join('')}
            </div>

            <!-- Comparison Table -->
            <div class="mt-8 glass rounded-2xl p-5 overflow-x-auto">
              <h3 class="text-lg font-bold mb-4"><i class="fas fa-table text-primary-400 mr-2"></i>Quick Comparison</h3>
              <table class="w-full text-xs">
                <thead>
                  <tr class="border-b border-white/10">
                    <th class="text-left py-3 px-2 text-gray-400 font-semibold">Type</th>
                    <th class="text-center py-3 px-2 text-gray-400 font-semibold">Size (m)</th>
                    <th class="text-center py-3 px-2 text-gray-400 font-semibold">Area</th>
                    <th class="text-right py-3 px-2 text-gray-400 font-semibold">Price (₹)</th>
                    <th class="text-center py-3 px-2 text-gray-400 font-semibold"></th>
                  </tr>
                </thead>
                <tbody>
                  \${types.map(bt => \`
                    <tr class="border-b border-white/5 hover:bg-white/5 transition">
                      <td class="py-3 px-2">
                        <div class="flex items-center gap-2">
                          <i class="fas \${bt.icon}" style="color:\${bt.color};"></i>
                          <span class="font-semibold text-white">\${bt.name}</span>
                        </div>
                      </td>
                      <td class="text-center py-3 px-2 text-gray-300">\${bt.size_label}</td>
                      <td class="text-center py-3 px-2 text-gray-300">\${bt.area_sqm} sqm</td>
                      <td class="text-right py-3 px-2 font-bold" style="color:\${bt.color};">₹\${Number(bt.price_inr).toLocaleString('en-IN')}</td>
                      <td class="text-center py-3 px-2">
                        <button onclick="openBoothRequestForm(\${bt.id})" class="px-3 py-1.5 rounded-lg text-[10px] font-semibold text-white transition hover:opacity-90" style="background:\${bt.color};">
                          Request
                        </button>
                      </td>
                    </tr>
                  \`).join('')}
                </tbody>
              </table>
            </div>

            <!-- CTA -->
            <div class="mt-6 glass rounded-2xl p-6 text-center border border-amber-500/20">
              <h3 class="text-lg font-bold mb-2"><i class="fas fa-phone-alt text-amber-400 mr-2"></i>Need a Custom Package?</h3>
              <p class="text-sm text-gray-400 mb-4">Looking for multi-booth discounts, custom pavilion designs, or co-branded spaces? Our team is ready to help.</p>
              <div class="flex gap-3 justify-center flex-wrap">
                <button onclick="openInquiryForm('exhibition')" class="px-5 py-2.5 rounded-xl text-sm font-semibold bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition border border-amber-500/30">
                  <i class="fas fa-envelope mr-1.5"></i>Send Inquiry
                </button>
                <a href="tel:+919876543210" class="px-5 py-2.5 rounded-xl text-sm font-semibold glass text-gray-300 hover:bg-white/10 transition border border-white/10">
                  <i class="fas fa-phone mr-1.5"></i>Call Us
                </a>
              </div>
            </div>
          </div>
        \`;
      } catch(e) {
        console.error('Booth catalog error:', e);
        container.innerHTML = '<div class="text-center py-12 text-red-400"><i class="fas fa-exclamation-circle text-2xl mb-2 block"></i>Failed to load booth catalog</div>';
      }
    }

    function viewBoothDetails(boothTypeId) {
      const bt = boothTypesCache.find(b => b.id === boothTypeId);
      if (!bt) return;
      const features = JSON.parse(bt.features || '[]');
      openModal(\`
        <div class="p-6">
          <div class="flex items-center gap-3 mb-4">
            <div class="w-14 h-14 rounded-xl flex items-center justify-center" style="background:\${bt.color}20;">
              <i class="fas \${bt.icon} text-2xl" style="color:\${bt.color};"></i>
            </div>
            <div>
              <h3 class="text-xl font-bold">\${bt.name}</h3>
              <p class="text-sm text-gray-400">\${bt.size_label}m — \${bt.area_sqm} sqm (\${bt.area_sqft} sqft)</p>
            </div>
          </div>
          <p class="text-sm text-gray-300 mb-4 leading-relaxed">\${bt.description}</p>
          <div class="glass rounded-xl p-4 mb-4">
            <div class="flex items-baseline gap-2 mb-2">
              <span class="text-3xl font-black" style="color:\${bt.color};">₹\${Number(bt.price_inr).toLocaleString('en-IN')}</span>
              <span class="text-sm text-gray-500">+ 18% GST</span>
            </div>
            <div class="text-xs text-gray-500">GST: ₹\${Math.round(bt.price_inr * 0.18).toLocaleString('en-IN')} | Total: ₹\${Math.round(bt.price_inr * 1.18).toLocaleString('en-IN')}</div>
          </div>
          <h4 class="font-semibold text-sm mb-2">All Features Included:</h4>
          <div class="space-y-2 mb-4">
            \${features.map(f => \`
              <div class="flex items-start gap-2 text-sm text-gray-300">
                <i class="fas fa-check-circle mt-0.5" style="color:\${bt.color}; font-size:11px;"></i>
                <span>\${f}</span>
              </div>
            \`).join('')}
          </div>
          <div class="glass rounded-lg p-2 mb-4 text-center">
            <div class="text-lg font-bold text-amber-400">\${bt.area_sqm} sqm</div>
            <div class="text-[10px] text-gray-500">Booth Area</div>
          </div>
          <button onclick="closeModal(); openBoothRequestForm(\${bt.id})" class="w-full py-3 rounded-xl text-sm font-semibold text-white transition hover:opacity-90" style="background:\${bt.color};">
            <i class="fas fa-paper-plane mr-2"></i>Request This Booth
          </button>
        </div>
      \`);
    }

    function openBoothRequestForm(boothTypeId) {
      const bt = boothTypesCache.find(b => b.id === boothTypeId);
      if (!bt) { showToast('Booth type not found', 'error'); return; }
      const modal = document.getElementById('booth-request-modal');
      const container = document.getElementById('booth-request-form-container');
      const user = currentUser || {};
      const gst = Math.round(bt.price_inr * 0.18);
      const total = bt.price_inr + gst;

      container.innerHTML = \`
        <div class="sticky top-0 z-10 p-5 border-b border-white/10" style="background:linear-gradient(135deg, \${bt.color}15, \${bt.color}05);">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-lg flex items-center justify-center" style="background:\${bt.color}25;">
                <i class="fas \${bt.icon}" style="color:\${bt.color};"></i>
              </div>
              <div>
                <h3 class="font-bold text-lg">Request \${bt.name}</h3>
                <p class="text-xs text-gray-400">\${bt.size_label}m • \${bt.area_sqm} sqm • ₹\${Number(bt.price_inr).toLocaleString('en-IN')} + GST</p>
              </div>
            </div>
            <button onclick="closeBoothRequestModal()" class="w-8 h-8 rounded-lg glass hover:bg-white/10 flex items-center justify-center"><i class="fas fa-times text-gray-400"></i></button>
          </div>
        </div>
        <form id="booth-request-form" class="p-5 space-y-5">
          <input type="hidden" id="br-booth-type-id" value="\${bt.id}">
          <input type="hidden" id="br-unit-price" value="\${bt.price_inr}">

          <!-- Contact Info -->
          <div>
            <h4 class="font-semibold text-sm mb-3 text-gray-300"><i class="fas fa-user mr-1.5 text-primary-400"></i>Contact Information</h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label class="text-xs text-gray-400 mb-1 block">Company Name <span class="text-red-400">*</span></label>
                <input id="br-company" type="text" required value="\${user.company || ''}" class="w-full px-3 py-2.5 rounded-lg text-sm" placeholder="Your company name">
              </div>
              <div>
                <label class="text-xs text-gray-400 mb-1 block">Contact Person <span class="text-red-400">*</span></label>
                <input id="br-contact" type="text" required value="\${user.name || ''}" class="w-full px-3 py-2.5 rounded-lg text-sm" placeholder="Full name">
              </div>
              <div>
                <label class="text-xs text-gray-400 mb-1 block">Email <span class="text-red-400">*</span></label>
                <input id="br-email" type="email" required value="\${user.email || ''}" class="w-full px-3 py-2.5 rounded-lg text-sm" placeholder="email@company.com">
              </div>
              <div>
                <label class="text-xs text-gray-400 mb-1 block">Phone</label>
                <input id="br-phone" type="tel" value="\${user.phone || ''}" class="w-full px-3 py-2.5 rounded-lg text-sm" placeholder="+91 XXXXX XXXXX">
              </div>
            </div>
          </div>

          <!-- Company Details -->
          <div>
            <h4 class="font-semibold text-sm mb-3 text-gray-300"><i class="fas fa-building mr-1.5 text-accent-400"></i>Company Details</h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label class="text-xs text-gray-400 mb-1 block">Industry</label>
                <select id="br-industry" class="w-full px-3 py-2.5 rounded-lg text-sm">
                  <option value="">Select industry</option>
                  <option>AI / Machine Learning</option>
                  <option>Cloud Computing</option>
                  <option>Cybersecurity</option>
                  <option>Data Analytics</option>
                  <option>EdTech</option>
                  <option>FinTech</option>
                  <option>HealthTech</option>
                  <option>IoT / Hardware</option>
                  <option>SaaS</option>
                  <option>Robotics</option>
                  <option>Enterprise Software</option>
                  <option>Consulting</option>
                  <option>Other</option>
                </select>
              </div>
              <div>
                <label class="text-xs text-gray-400 mb-1 block">Company Size</label>
                <select id="br-company-size" class="w-full px-3 py-2.5 rounded-lg text-sm">
                  <option value="">Select size</option>
                  <option>1-10 employees</option>
                  <option>11-50 employees</option>
                  <option>51-200 employees</option>
                  <option>201-1000 employees</option>
                  <option>1000+ employees</option>
                </select>
              </div>
              <div class="md:col-span-2">
                <label class="text-xs text-gray-400 mb-1 block">Website</label>
                <input id="br-website" type="url" class="w-full px-3 py-2.5 rounded-lg text-sm" placeholder="https://yourcompany.com">
              </div>
              <div class="md:col-span-2">
                <label class="text-xs text-gray-400 mb-1 block">Brief Company Description</label>
                <textarea id="br-description" rows="2" class="w-full px-3 py-2.5 rounded-lg text-sm" placeholder="What does your company do?"></textarea>
              </div>
            </div>
          </div>

          <!-- Booth Preferences -->
          <div>
            <h4 class="font-semibold text-sm mb-3 text-gray-300"><i class="fas fa-store mr-1.5" style="color:\${bt.color};"></i>Booth Preferences</h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label class="text-xs text-gray-400 mb-1 block">Quantity</label>
                <div class="flex items-center gap-2">
                  <button type="button" onclick="adjustBoothQty(-1)" class="w-8 h-8 rounded-lg glass hover:bg-white/10 flex items-center justify-center"><i class="fas fa-minus text-xs"></i></button>
                  <input id="br-quantity" type="number" min="1" max="10" value="1" class="w-16 text-center px-2 py-2 rounded-lg text-sm" onchange="updateBoothPricing()">
                  <button type="button" onclick="adjustBoothQty(1)" class="w-8 h-8 rounded-lg glass hover:bg-white/10 flex items-center justify-center"><i class="fas fa-plus text-xs"></i></button>
                </div>
              </div>
              <div>
                <label class="text-xs text-gray-400 mb-1 block">Preferred Zone</label>
                <select id="br-zone" class="w-full px-3 py-2.5 rounded-lg text-sm">
                  <option value="">No preference</option>
                  <option>Red Zone (near stage)</option>
                  <option>Green Zone (mid-hall)</option>
                  <option>Blue Zone (central)</option>
                  <option>Purple Zone (premium corner)</option>
                  <option>Near Entrance</option>
                  <option>Near Exit</option>
                </select>
              </div>
              <div class="md:col-span-2">
                <label class="text-xs text-gray-400 mb-1 block">Products / Solutions to Display</label>
                <textarea id="br-products" rows="2" class="w-full px-3 py-2.5 rounded-lg text-sm" placeholder="List the products or solutions you plan to showcase"></textarea>
              </div>
              <div class="md:col-span-2">
                <label class="text-xs text-gray-400 mb-1 block">Special Requirements</label>
                <textarea id="br-special" rows="2" class="w-full px-3 py-2.5 rounded-lg text-sm" placeholder="Power needs, internet, display setup, furniture, etc."></textarea>
              </div>
            </div>
          </div>

          <!-- Pricing Summary -->
          <div class="glass rounded-xl p-4 border border-white/10">
            <h4 class="font-semibold text-sm mb-3 text-gray-300"><i class="fas fa-calculator mr-1.5 text-green-400"></i>Pricing Summary</h4>
            <div id="br-pricing-summary">
              <div class="flex justify-between text-sm mb-1">
                <span class="text-gray-400">\${bt.name} × <span id="br-qty-display">1</span></span>
                <span class="text-white font-semibold" id="br-subtotal">₹\${Number(bt.price_inr).toLocaleString('en-IN')}</span>
              </div>
              <div class="flex justify-between text-sm mb-1">
                <span class="text-gray-400">GST (18%)</span>
                <span class="text-white" id="br-gst">₹\${gst.toLocaleString('en-IN')}</span>
              </div>
              <div class="border-t border-white/10 mt-2 pt-2 flex justify-between">
                <span class="font-bold">Grand Total</span>
                <span class="text-xl font-black" id="br-grand-total" style="color:\${bt.color};">₹\${total.toLocaleString('en-IN')}</span>
              </div>
            </div>
          </div>

          <!-- Payment Note -->
          <div class="glass rounded-xl p-4 border border-amber-500/20 bg-amber-500/5">
            <div class="flex gap-3">
              <i class="fas fa-info-circle text-amber-400 mt-0.5"></i>
              <div>
                <p class="text-sm font-semibold text-amber-300 mb-1">Pay Later — No Payment Now</p>
                <p class="text-xs text-gray-400">Submit your request now and pay later. Our team will review your request and send a formal invoice with payment instructions within 24-48 hours. You can also pay online once the invoice is generated.</p>
              </div>
            </div>
          </div>

          <!-- Submit -->
          <div class="flex gap-3">
            <button type="submit" id="br-submit-btn" class="flex-1 py-3 rounded-xl text-sm font-bold text-white transition hover:opacity-90" style="background:\${bt.color};">
              <i class="fas fa-paper-plane mr-2"></i>Submit Booth Request
            </button>
            <button type="button" onclick="closeBoothRequestModal()" class="px-5 py-3 rounded-xl text-sm font-medium glass hover:bg-white/10 transition">Cancel</button>
          </div>
        </form>
      \`;

      modal.classList.remove('hidden');

      document.getElementById('booth-request-form').onsubmit = async (e) => {
        e.preventDefault();
        const btn = document.getElementById('br-submit-btn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Submitting...';
        try {
          const payload = {
            booth_type_id: parseInt(document.getElementById('br-booth-type-id').value),
            event_id: typeof EVENT_ID !== 'undefined' ? EVENT_ID : 1,
            company_name: document.getElementById('br-company').value,
            contact_name: document.getElementById('br-contact').value,
            email: document.getElementById('br-email').value,
            phone: document.getElementById('br-phone').value,
            website: document.getElementById('br-website').value,
            industry: document.getElementById('br-industry').value,
            company_size: document.getElementById('br-company-size').value,
            company_description: document.getElementById('br-description').value,
            quantity: parseInt(document.getElementById('br-quantity').value) || 1,
            preferred_zone: document.getElementById('br-zone').value,
            products_to_display: document.getElementById('br-products').value,
            special_requirements: document.getElementById('br-special').value,
            attendee_id: currentUser ? currentUser.id : null
          };
          const result = await api.post('/api/booth-requests', payload);
          closeBoothRequestModal();
          showBoothRequestSuccess(result);
        } catch(err) {
          showToast(err.message || 'Failed to submit request', 'error');
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-paper-plane mr-2"></i>Submit Booth Request';
        }
      };
    }

    function adjustBoothQty(delta) {
      const inp = document.getElementById('br-quantity');
      const max = parseInt(inp.max) || 100;
      let val = parseInt(inp.value) || 1;
      val = Math.max(1, Math.min(max, val + delta));
      inp.value = val;
      updateBoothPricing();
    }

    function updateBoothPricing() {
      const qty = parseInt(document.getElementById('br-quantity').value) || 1;
      const unitPrice = parseInt(document.getElementById('br-unit-price').value) || 0;
      const subtotal = unitPrice * qty;
      const gst = Math.round(subtotal * 0.18);
      const total = subtotal + gst;
      const qtyDisplay = document.getElementById('br-qty-display');
      if (qtyDisplay) qtyDisplay.textContent = qty;
      const subtotalEl = document.getElementById('br-subtotal');
      if (subtotalEl) subtotalEl.textContent = '₹' + subtotal.toLocaleString('en-IN');
      const gstEl = document.getElementById('br-gst');
      if (gstEl) gstEl.textContent = '₹' + gst.toLocaleString('en-IN');
      const totalEl = document.getElementById('br-grand-total');
      if (totalEl) totalEl.textContent = '₹' + total.toLocaleString('en-IN');
    }

    function closeBoothRequestModal() {
      document.getElementById('booth-request-modal').classList.add('hidden');
    }

    function showBoothRequestSuccess(result) {
      openModal(\`
        <div class="p-6 text-center">
          <div class="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
            <i class="fas fa-check-circle text-3xl text-green-400"></i>
          </div>
          <h3 class="text-xl font-bold mb-2">Booth Request Submitted!</h3>
          <p class="text-sm text-gray-400 mb-4">Your request for <strong class="text-white">\${result.booth_type}</strong> (×\${result.quantity}) has been received.</p>
          <div class="glass rounded-xl p-4 mb-4 text-left">
            <div class="flex justify-between text-sm mb-1">
              <span class="text-gray-400">Request ID</span>
              <span class="font-mono text-primary-400">#BR-\${String(result.id).padStart(4, '0')}</span>
            </div>
            <div class="flex justify-between text-sm mb-1">
              <span class="text-gray-400">Booth Cost</span>
              <span class="text-white">₹\${Number(result.total_price_inr).toLocaleString('en-IN')}</span>
            </div>
            <div class="flex justify-between text-sm mb-1">
              <span class="text-gray-400">GST (18%)</span>
              <span class="text-white">₹\${Number(result.gst_amount).toLocaleString('en-IN')}</span>
            </div>
            <div class="border-t border-white/10 mt-2 pt-2 flex justify-between">
              <span class="font-bold">Grand Total</span>
              <span class="text-lg font-black text-green-400">₹\${Number(result.grand_total).toLocaleString('en-IN')}</span>
            </div>
          </div>
          <div class="glass rounded-xl p-3 mb-4 border border-amber-500/20 bg-amber-500/5 text-left">
            <p class="text-xs text-amber-300"><i class="fas fa-clock mr-1.5"></i><strong>Next Steps:</strong> Our team will review your request and send an invoice within 24-48 hours. Payment can be completed online or via bank transfer.</p>
          </div>
          <div class="flex gap-3 justify-center">
            <button onclick="closeModal(); switchExhibitionSubtab('my-requests')" class="px-5 py-2.5 rounded-xl text-sm font-semibold bg-primary-600 hover:bg-primary-500 text-white transition">
              <i class="fas fa-file-alt mr-1.5"></i>View My Requests
            </button>
            <button onclick="closeModal()" class="px-5 py-2.5 rounded-xl text-sm font-medium glass hover:bg-white/10 transition">Close</button>
          </div>
        </div>
      \`);
    }

    async function loadMyBoothRequests() {
      const container = document.getElementById('my-booth-requests-container');
      if (!container) return;
      if (!currentUser) {
        container.innerHTML = '<div class="text-center py-12"><i class="fas fa-lock text-2xl text-gray-600 mb-3 block"></i><p class="text-sm text-gray-500">Please sign in to view your booth requests.</p></div>';
        return;
      }
      container.innerHTML = '<div class="text-center py-8"><i class="fas fa-spinner fa-spin text-primary-400 text-xl"></i></div>';
      try {
        const requests = await api.get('/api/booth-requests?attendee_id=' + currentUser.id);
        if (!requests.length) {
          container.innerHTML = \`
            <div class="text-center py-12">
              <div class="w-16 h-16 rounded-full bg-primary-500/10 flex items-center justify-center mx-auto mb-4">
                <i class="fas fa-file-alt text-2xl text-primary-400"></i>
              </div>
              <h3 class="font-bold mb-2">No Booth Requests Yet</h3>
              <p class="text-sm text-gray-400 mb-4">Browse our booth catalog and request your perfect exhibition space.</p>
              <button onclick="switchExhibitionSubtab('booth-catalog')" class="px-5 py-2.5 rounded-xl text-sm font-semibold bg-primary-600 hover:bg-primary-500 text-white transition">
                <i class="fas fa-th-large mr-1.5"></i>View Booth Catalog
              </button>
            </div>
          \`;
          return;
        }

        const statusColors = {
          submitted: 'bg-blue-500/20 text-blue-300',
          under_review: 'bg-amber-500/20 text-amber-300',
          approved: 'bg-green-500/20 text-green-300',
          rejected: 'bg-red-500/20 text-red-300',
          confirmed: 'bg-emerald-500/20 text-emerald-300',
          cancelled: 'bg-gray-500/20 text-gray-400'
        };
        const paymentColors = {
          pending: 'bg-amber-500/20 text-amber-300',
          invoice_sent: 'bg-blue-500/20 text-blue-300',
          paid: 'bg-green-500/20 text-green-300',
          cancelled: 'bg-gray-500/20 text-gray-400',
          refunded: 'bg-purple-500/20 text-purple-300'
        };

        container.innerHTML = \`
          <div class="mb-4 flex items-center justify-between">
            <h3 class="font-bold"><i class="fas fa-file-alt text-primary-400 mr-2"></i>My Booth Requests (\${requests.length})</h3>
            <button onclick="switchExhibitionSubtab('booth-catalog')" class="px-4 py-2 rounded-xl text-xs font-semibold bg-primary-600/20 text-primary-300 hover:bg-primary-600/30 transition">
              <i class="fas fa-plus mr-1"></i>New Request
            </button>
          </div>
          <div class="space-y-4">
            \${requests.map(r => \`
              <div class="glass rounded-2xl p-5 border border-white/5" style="border-left:3px solid \${r.booth_color || '#4c6ef5'};">
                <div class="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-3">
                  <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-lg flex items-center justify-center" style="background:\${r.booth_color || '#4c6ef5'}20;">
                      <i class="fas \${r.booth_icon || 'fa-store'}" style="color:\${r.booth_color || '#4c6ef5'};"></i>
                    </div>
                    <div>
                      <h4 class="font-bold">\${r.booth_type_name}</h4>
                      <p class="text-xs text-gray-500">\${r.size_label}m • \${r.area_sqm} sqm • Qty: \${r.quantity}</p>
                    </div>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase \${statusColors[r.status] || 'bg-white/10 text-gray-400'}">\${r.status.replace('_', ' ')}</span>
                    <span class="px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase \${paymentColors[r.payment_status] || 'bg-white/10 text-gray-400'}"><i class="fas fa-credit-card mr-1"></i>\${r.payment_status.replace('_', ' ')}</span>
                  </div>
                </div>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs mb-3">
                  <div>
                    <span class="text-gray-500">Request ID</span>
                    <div class="font-mono text-primary-400">#BR-\${String(r.id).padStart(4, '0')}</div>
                  </div>
                  <div>
                    <span class="text-gray-500">Unit Price</span>
                    <div class="font-semibold">₹\${Number(r.unit_price).toLocaleString('en-IN')}</div>
                  </div>
                  <div>
                    <span class="text-gray-500">Grand Total</span>
                    <div class="font-bold text-green-400">₹\${Number(r.grand_total).toLocaleString('en-IN')}</div>
                  </div>
                  <div>
                    <span class="text-gray-500">Requested</span>
                    <div>\${new Date(r.created_at).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })}</div>
                  </div>
                </div>
                \${r.admin_notes ? \`<div class="glass rounded-lg p-3 text-xs"><i class="fas fa-comment text-primary-400 mr-1.5"></i><span class="text-gray-400">Admin: </span>\${r.admin_notes}</div>\` : ''}
                \${r.status === 'approved' && r.payment_status !== 'paid' ? \`
                  <div class="mt-3 glass rounded-lg p-3 border border-green-500/20 bg-green-500/5 flex items-center justify-between">
                    <div class="text-xs text-green-300"><i class="fas fa-check-circle mr-1.5"></i>Approved! Complete payment to confirm your booth.</div>
                    <button onclick="showPaymentInfo(\${r.id})" class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-600 hover:bg-green-500 text-white transition"><i class="fas fa-credit-card mr-1"></i>Pay Now</button>
                  </div>
                \` : ''}
              </div>
            \`).join('')}
          </div>
        \`;
      } catch(e) {
        console.error('Load requests error:', e);
        container.innerHTML = '<div class="text-center py-8 text-red-400"><i class="fas fa-exclamation-circle text-xl mb-2 block"></i>Failed to load requests</div>';
      }
    }

    function showPaymentInfo(requestId) {
      openModal(\`
        <div class="p-6">
          <div class="flex items-center gap-3 mb-4">
            <div class="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
              <i class="fas fa-credit-card text-xl text-green-400"></i>
            </div>
            <div>
              <h3 class="font-bold text-lg">Complete Payment</h3>
              <p class="text-xs text-gray-400">Request #BR-\${String(requestId).padStart(4, '0')}</p>
            </div>
          </div>
          <div class="glass rounded-xl p-4 mb-4">
            <h4 class="text-sm font-semibold mb-3">Payment Options</h4>
            <div class="space-y-3">
              <div class="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
                <i class="fas fa-university text-primary-400 mt-0.5"></i>
                <div>
                  <p class="text-sm font-semibold">Bank Transfer (NEFT/RTGS)</p>
                  <p class="text-xs text-gray-400 mt-1">Invoice with bank details will be emailed to you. Transfer the amount and share the transaction reference.</p>
                </div>
              </div>
              <div class="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
                <i class="fas fa-qrcode text-accent-400 mt-0.5"></i>
                <div>
                  <p class="text-sm font-semibold">UPI Payment</p>
                  <p class="text-xs text-gray-400 mt-1">Scan the QR code from the invoice or pay directly via UPI ID provided in the invoice email.</p>
                </div>
              </div>
              <div class="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-amber-500/20 bg-amber-500/5">
                <i class="fas fa-globe text-amber-400 mt-0.5"></i>
                <div>
                  <p class="text-sm font-semibold text-amber-300">Online Payment (Coming Soon)</p>
                  <p class="text-xs text-gray-400 mt-1">Secure online payment gateway will be available shortly. You'll receive a payment link via email.</p>
                </div>
              </div>
            </div>
          </div>
          <p class="text-xs text-gray-500 text-center mb-4">Need help? Contact us at <a href="mailto:exhibition@bharataiinnovation.com" class="text-primary-400 hover:underline">exhibition@bharataiinnovation.com</a></p>
          <button onclick="closeModal()" class="w-full py-2.5 rounded-xl text-sm font-medium glass hover:bg-white/10 transition">Close</button>
        </div>
      \`);
    }

    // ==================== AWARDS ====================
    function switchAwardsTab(tab) {
      document.querySelectorAll('.awards-tab').forEach(b => {
        b.classList.remove('tab-active');
        b.classList.add('text-gray-400');
      });
      document.querySelector(\`[data-awards-tab="\${tab}"]\`).classList.add('tab-active');
      document.querySelector(\`[data-awards-tab="\${tab}"]\`).classList.remove('text-gray-400');
      document.getElementById('awards-finalists').classList.toggle('hidden', tab !== 'finalists');
      document.getElementById('awards-enterprise').classList.toggle('hidden', tab !== 'enterprise');
      document.getElementById('awards-categories').classList.toggle('hidden', tab !== 'categories');
      document.getElementById('awards-schedule').classList.toggle('hidden', tab !== 'schedule');
      document.getElementById('awards-startup-pitch').classList.toggle('hidden', tab !== 'startup-pitch');
      if (tab === 'startup-pitch') loadStartupPitch();
    }

    // ==================== BHAI 2026 CATEGORIES (top-level tab) ====================
    async function loadAgbaCategories() {
      const container = document.getElementById('agba-categories-container');
      if (!container) return;
      if (container.dataset.loaded === 'true') return;
      container.innerHTML = '<div class="text-center py-12"><i class="fas fa-spinner fa-spin text-2xl text-primary-400"></i><p class="text-gray-500 mt-3 text-sm">Loading categories...</p></div>';
      try {
        const awards = await api.get(\`/api/events/\${EVENT_ID}/awards\`);
        const seventeenthCategories = awards.filter(cat => cat.description && cat.description.startsWith('BHAI 2026'));
        container.innerHTML = seventeenthCategories.length > 0 ? seventeenthCategories.map(cat => {
          const isHeader = cat.name === 'AI-GenAI-Agentic AI';
          const isSubCat = cat.name.startsWith('[');
          return \`
            <div class="\${isHeader ? 'glass rounded-2xl p-5 border-l-4 border-purple-500/50' : 'glass rounded-2xl p-5'}">
              <div class="flex items-center gap-3">
                <span class="text-2xl">\${cat.icon}</span>
                <div class="flex-1">
                  <h3 class="\${isHeader ? 'text-lg font-bold text-purple-300' : isSubCat ? 'text-base font-semibold text-gray-300 pl-2' : 'text-lg font-bold'}">\${cat.name}</h3>
                  \${cat.description && !cat.description.startsWith('BHAI 2026') ? '<p class="text-xs text-gray-400 mt-0.5">' + cat.description.replace('BHAI 2026 - ', '') + '</p>' : ''}
                </div>
                <span class="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"><i class="fas fa-calendar-alt text-[8px] mr-1"></i>28 Feb</span>
              </div>
            </div>
          \`;
        }).join('') : '<div class="text-center py-8 text-gray-500"><i class="fas fa-trophy text-3xl mb-3 block opacity-30"></i><p>Categories coming soon</p></div>';
        container.dataset.loaded = 'true';
      } catch(e) { console.error('BHAI Categories error:', e); container.innerHTML = '<div class="text-center py-8 text-red-400"><p>Failed to load categories</p></div>'; }
    }

    // ==================== BHAI 2026 JURY SCHEDULE (top-level tab) ====================
    function loadAgbaJurySchedule() {
      const container = document.getElementById('agba-jury-schedule-grid');
      if (!container) return;
      if (container.dataset.loaded === 'true') return;
      // Clone the jury schedule content from the awards tab
      const source = document.getElementById('jury-schedule-grid');
      if (source) {
        container.innerHTML = source.innerHTML;
      }
      // Also clone the legend (next sibling with .glass class)
      const legend = source?.nextElementSibling;
      if (legend && legend.classList.contains('glass')) {
        container.insertAdjacentHTML('beforeend', legend.outerHTML);
      }
      container.dataset.loaded = 'true';
    }

    // ==================== BHAI STARTUP PITCH ====================
    async function loadStartupPitch() {
      try {
        const data = await api.get(\`/api/events/\${EVENT_ID}/startup-pitches\`);
        const pitchData = data.pitches || [];
        const investors = data.investors || [];

        if (pitchData.length === 0 && investors.length === 0) {
          const emptyHtml = \`
            <div class="text-center py-16">
              <img src="https://bharataiinnovation.com/images/Bharat%20AI%20Innovation%20Logo.png" alt="BHAI" class="w-16 h-16 mx-auto mb-4 rounded-xl object-contain opacity-50">
              <h2 class="text-2xl font-bold mb-2"><i class="fas fa-rocket text-orange-400 mr-2"></i>BHAI Startup Pitch</h2>
              <p class="text-lg font-semibold text-orange-300 mb-1">BHAI Innovation Pitch: Where Innovation Meets Investment</p>
              <p class="text-gray-400 text-sm mb-6">Connect. Pitch. Fund. The Ultimate Startup-Investor Experience</p>
              <div class="glass rounded-2xl p-8 max-w-md mx-auto border border-orange-500/20">
                <i class="fas fa-calendar-plus text-4xl text-orange-400/30 mb-4 block"></i>
                <p class="text-gray-400 text-sm font-medium">Pitch schedule will be announced soon</p>
                <p class="text-gray-500 text-xs mt-1">Stay tuned for startup pitches & investor panels</p>
              </div>
            </div>
          \`;
          const desktop = document.getElementById('startup-pitch-content-desktop');
          const mobile = document.getElementById('startup-pitch-content-mobile');
          if (desktop) desktop.innerHTML = emptyHtml;
          if (mobile) mobile.innerHTML = emptyHtml;
          return;
        }

      const html = \`
        <div class="text-center mb-8">
          <img src="https://bharataiinnovation.com/images/Bharat%20AI%20Innovation%20Logo.png" alt="BHAI" class="w-16 h-16 mx-auto mb-3 rounded-xl object-contain">
          <h2 class="text-2xl font-bold mb-2"><i class="fas fa-rocket text-orange-400 mr-2"></i>BHAI Startup Pitch</h2>
          <p class="text-lg font-semibold text-orange-300 mb-1">BHAI Innovation Pitch: Where Innovation Meets Investment</p>
          <p class="text-gray-400 text-sm">Connect. Pitch. Fund. The Ultimate Startup-Investor Experience</p>
          <p class="text-xs text-gray-500 mt-2"><i class="fas fa-calendar-alt mr-1"></i>20-21 Nov 2026 &bull; World Trade Center, Mumbai</p>
        </div>

        \${pitchData.length > 0 ? \`
        <!-- Pitch Schedule -->
        <div class="glass rounded-2xl overflow-hidden mb-8">
          <div class="bg-gradient-to-r from-orange-600/30 to-amber-600/30 px-5 py-3 flex items-center justify-between">
            <div class="flex items-center gap-3">
              <span class="text-xl">\u{1F3A4}</span>
              <span class="font-bold text-lg">Pitch Schedule</span>
            </div>
            <span class="px-3 py-1 rounded-full text-xs font-semibold bg-white/10 text-orange-300">\${pitchData.length} Startups</span>
          </div>
          <div class="divide-y divide-white/5">
            \${pitchData.map((p, i) => \`
              <div class="px-5 py-4 hover:bg-white/[0.02] transition flex items-start gap-4">
                <div class="shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-orange-500/20 to-amber-500/20 flex items-center justify-center text-orange-400 font-bold text-sm">\${i+1}</div>
                <div class="flex-1 min-w-0">
                  <div class="flex flex-wrap items-center gap-2 mb-1">
                    <span class="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-orange-500/20 text-orange-300 border border-orange-500/20">\${p.time_slot}</span>
                    <h4 class="font-bold text-sm text-white">\${p.company}</h4>
                  </div>
                  <div class="flex items-center gap-2 mb-1.5">
                    <img src="https://ui-avatars.com/api/?name=\${encodeURIComponent(p.pitcher_name)}&size=28&background=c2410c&color=fff&bold=true&rounded=true" class="w-7 h-7 rounded-full">
                    <span class="text-sm font-medium text-gray-200">\${p.pitcher_name}</span>
                    <span class="text-xs text-gray-500">\u2014</span>
                    <span class="text-xs text-orange-400/80">\${p.pitcher_title}</span>
                  </div>
                  <p class="text-xs text-gray-400 leading-relaxed">\${p.pitcher_profile}</p>
                </div>
              </div>
            \`).join('')}
          </div>
        </div>
        \` : ''}

        \${investors.length > 0 ? \`
        <!-- Investors Panel -->
        <div class="glass rounded-2xl overflow-hidden">
          <div class="bg-gradient-to-r from-emerald-600/30 to-teal-600/30 px-5 py-3 flex items-center justify-between">
            <div class="flex items-center gap-3">
              <span class="text-xl">\u{1F4B0}</span>
              <span class="font-bold text-lg">Investors & Evaluators</span>
            </div>
            <span class="px-3 py-1 rounded-full text-xs font-semibold bg-white/10 text-emerald-300">\${investors.length} Investors</span>
          </div>
          <div class="p-5">
            <p class="text-sm text-gray-400 mb-4">Distinguished investors evaluating startup pitches and identifying breakthrough innovations.</p>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              \${investors.map(inv => \`
                <div class="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5 hover:border-emerald-500/20 hover:bg-white/[0.05] transition">
                  <img src="https://ui-avatars.com/api/?name=\${encodeURIComponent(inv.name)}&size=40&background=065f46&color=fff&bold=true&rounded=true" class="w-10 h-10 rounded-full shrink-0">
                  <div class="min-w-0">
                    <div class="font-semibold text-sm text-white truncate">\${inv.name}</div>
                    \${inv.title ? '<div class="text-[11px] text-emerald-400/80 truncate">'+inv.title+'</div>' : ''}
                    \${inv.company ? '<div class="text-[10px] text-gray-500 truncate">'+inv.company+'</div>' : ''}
                  </div>
                </div>
              \`).join('')}
            </div>
          </div>
        </div>
        \` : ''}
      \`;

      // Render into both desktop and mobile containers
      const desktop = document.getElementById('startup-pitch-content-desktop');
      const mobile = document.getElementById('startup-pitch-content-mobile');
      if (desktop) desktop.innerHTML = html;
      if (mobile) mobile.innerHTML = html;
      } catch(e) { console.error('Startup Pitch error:', e); }
    }

    // Shuffle array helper (Fisher-Yates)
    function shuffleArray(arr) {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }

    async function loadAwards() {
      try {
        const awards = await api.get(\`/api/events/\${EVENT_ID}/awards\`);

        // Separate startup finalists vs enterprise finalists vs empty
        const startupCategories = awards.filter(cat => cat.nominees.some(n => n.description === 'Bharat AI Innovation 2026 Startup Finalist'));
        const enterpriseCategories = awards.filter(cat => cat.nominees.some(n => n.description === 'Bharat AI Innovation 2026 Enterprise Finalist'));

        // For startup tab, only show startup nominees per category
        const startupFiltered = startupCategories.map(cat => ({
          ...cat,
          nominees: cat.nominees.filter(n => n.description === 'Bharat AI Innovation 2026 Startup Finalist')
        }));

        // For enterprise tab, only show enterprise nominees per category – randomized order
        const enterpriseFiltered = enterpriseCategories.map(cat => ({
          ...cat,
          nominees: shuffleArray(cat.nominees.filter(n => n.description === 'Bharat AI Innovation 2026 Enterprise Finalist'))
        }));

        // Render Startup Finalists section
        document.getElementById('finalists-container').innerHTML = startupFiltered.length > 0 ? startupFiltered.map(cat => \`
          <div class="glass rounded-2xl p-5">
            <div class="flex items-center gap-3 mb-4">
              <span class="text-2xl">\${cat.icon}</span>
              <div class="flex-1">
                <h3 class="text-lg font-bold">\${cat.name}</h3>
              </div>
              <span class="px-2 py-0.5 rounded-full text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30">\${cat.nominees.length} Finalist\${cat.nominees.length > 1 ? 's' : ''}</span>
            </div>
            <div class="space-y-2">
              \${cat.nominees.map((n, idx) => \`
                <div class="flex items-center gap-3 p-3 rounded-xl glass-light">
                  <div class="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500/30 to-orange-500/30 flex items-center justify-center text-xs font-bold text-amber-300 shrink-0">\${idx + 1}</div>
                  <div class="flex-1 min-w-0">
                    <h4 class="font-semibold text-sm">\${n.name}</h4>
                    <p class="text-xs text-gray-500">\${n.company}</p>
                  </div>
                  <span class="px-2 py-0.5 rounded-full text-[10px] bg-amber-500/10 text-amber-400/80 shrink-0"><i class="fas fa-star text-[8px] mr-1"></i>Finalist</span>
                </div>
              \`).join('')}
            </div>
          </div>
        \`).join('') : '<div class="text-center py-8 text-gray-500"><i class="fas fa-trophy text-3xl mb-3 block opacity-30"></i><p>Finalists will be announced soon</p></div>';

        // Render Enterprise Finalists section (randomized order)
        document.getElementById('enterprise-container').innerHTML = enterpriseFiltered.length > 0 ? enterpriseFiltered.map(cat => \`
          <div class="glass rounded-2xl p-5">
            <div class="flex items-center gap-3 mb-4">
              <span class="text-2xl">\${cat.icon}</span>
              <div class="flex-1">
                <h3 class="text-lg font-bold">\${cat.name}</h3>
              </div>
              <span class="px-2 py-0.5 rounded-full text-[10px] bg-blue-500/20 text-blue-400 border border-blue-500/30">\${cat.nominees.length} Finalist\${cat.nominees.length > 1 ? 's' : ''}</span>
            </div>
            <div class="space-y-2">
              \${cat.nominees.map((n, idx) => \`
                <div class="flex items-center gap-3 p-3 rounded-xl glass-light">
                  <div class="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500/30 to-indigo-500/30 flex items-center justify-center text-xs font-bold text-blue-300 shrink-0">\${idx + 1}</div>
                  <div class="flex-1 min-w-0">
                    <h4 class="font-semibold text-sm">\${n.name}</h4>
                    <p class="text-xs text-gray-500">\${n.company}</p>
                  </div>
                  <span class="px-2 py-0.5 rounded-full text-[10px] bg-blue-500/10 text-blue-400/80 shrink-0"><i class="fas fa-building text-[8px] mr-1"></i>Finalist</span>
                </div>
              \`).join('')}
            </div>
          </div>
        \`).join('') : '<div class="text-center py-8 text-gray-500"><i class="fas fa-building text-3xl mb-3 block opacity-30"></i><p>Enterprise finalists will be announced soon</p></div>';

        // Render BHAI 2026 Award Categories section (only categories tagged as 17th)
        const seventeenthCategories = awards.filter(cat => cat.description && cat.description.startsWith('BHAI 2026'));
        document.getElementById('awards-container').innerHTML = seventeenthCategories.length > 0 ? seventeenthCategories.map(cat => {
          // Check if it's a section header (AI-GenAI-Agentic AI or sub-categories)
          const isHeader = cat.name === 'AI-GenAI-Agentic AI';
          const isSubCat = cat.name.startsWith('[');
          return \`
            <div class="\${isHeader ? 'glass rounded-2xl p-5 border-l-4 border-purple-500/50' : 'glass rounded-2xl p-5'}">
              <div class="flex items-center gap-3">
                <span class="text-2xl">\${cat.icon}</span>
                <div class="flex-1">
                  <h3 class="\${isHeader ? 'text-lg font-bold text-purple-300' : isSubCat ? 'text-base font-semibold text-gray-300 pl-2' : 'text-lg font-bold'}">\${cat.name}</h3>
                  \${cat.description && !cat.description.startsWith('BHAI 2026') ? '<p class="text-xs text-gray-400 mt-0.5">' + cat.description.replace('BHAI 2026 - ', '') + '</p>' : ''}
                </div>
                <span class="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"><i class="fas fa-calendar-alt text-[8px] mr-1"></i>28 Feb</span>
              </div>
            </div>
          \`;
        }).join('') : '<div class="text-center py-8 text-gray-500"><i class="fas fa-trophy text-3xl mb-3 block opacity-30"></i><p>Categories coming soon</p></div>';
      } catch(e) { console.error('Awards error:', e); }
    }


    // ==================== INNOVATION TALK & SHOWCASE ====================
    async function loadInnovationShowcase() {
      const container = document.getElementById('innovation-talks-content');
      container.innerHTML = '<div class="text-center py-12"><i class="fas fa-spinner fa-spin text-2xl text-primary-400"></i><p class="text-gray-400 text-sm mt-2">Loading schedule...</p></div>';

      try {
        const talks = await api.get('/api/events/' + EVENT_ID + '/innovation-talks');
        const morning = talks.filter(t => t.session_type === 'Morning');
        const afternoon = talks.filter(t => t.session_type === 'Afternoon');

        function talkCard(t, idx) {
          const isMultiSpeaker = t.speaker_name.includes(',') || t.speaker_name.includes('&');
          return '<div class="glass rounded-xl p-4 hover:bg-white/[0.04] transition group">'
            + '<div class="flex items-start gap-4">'
            + '<div class="shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-primary-500/20 to-violet-500/20 flex items-center justify-center text-primary-300 font-bold text-lg">' + t.slot_no + '</div>'
            + '<div class="flex-1 min-w-0">'
            + '<div class="flex items-center gap-2 mb-1">'
            + '<span class="text-xs px-2 py-0.5 rounded-full bg-white/5 text-gray-400"><i class="fas fa-clock mr-1"></i>' + esc(t.time_slot) + '</span>'
            + (t.status === 'cancelled' ? '<span class="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400">Cancelled</span>' : '')
            + '</div>'
            + '<h4 class="font-semibold text-white group-hover:text-primary-300 transition ' + (t.status === 'cancelled' ? 'line-through opacity-50' : '') + '">'
            + (isMultiSpeaker ? '<i class="fas fa-user-friends text-xs text-violet-400 mr-1.5"></i>' : '<i class="fas fa-user text-xs text-primary-400 mr-1.5"></i>')
            + esc(t.speaker_name) + '</h4>'
            + '<p class="text-sm text-gray-400 mt-0.5"><i class="fas fa-building text-xs mr-1.5"></i>' + esc(t.company) + '</p>'
            + (t.topic ? '<p class="text-xs text-gray-500 mt-1"><i class="fas fa-tag mr-1"></i>' + esc(t.topic) + '</p>' : '')
            + '</div>'
            + '</div></div>';
        }

        function sessionSection(title, icon, colorFrom, colorTo, items, timeRange) {
          return '<div class="mb-8">'
            + '<div class="flex items-center gap-3 mb-4">'
            + '<div class="w-10 h-10 rounded-xl bg-gradient-to-br from-' + colorFrom + ' to-' + colorTo + ' flex items-center justify-center"><i class="fas fa-' + icon + ' text-white"></i></div>'
            + '<div><h3 class="text-lg font-bold">' + title + '</h3>'
            + '<p class="text-xs text-gray-500">' + timeRange + ' · ' + items.length + ' presentations</p></div></div>'
            + '<div class="grid gap-3">'
            + items.map(talkCard).join('')
            + '</div></div>';
        }

        container.innerHTML =
          '<div class="mb-6">'
          + '<h2 class="text-2xl font-bold mb-2"><i class="fas fa-lightbulb text-amber-400 mr-3"></i>Innovation Talk & Showcase</h2>'
          + '<p class="text-gray-400 text-sm">10-minute presentations showcasing cutting-edge AI & technology solutions</p>'
          + '<div class="flex gap-4 mt-3">'
          + '<span class="text-xs glass px-3 py-1.5 rounded-full"><i class="fas fa-microphone-alt text-primary-400 mr-1.5"></i>' + talks.length + ' presentations</span>'
          + '<span class="text-xs glass px-3 py-1.5 rounded-full"><i class="fas fa-sun text-amber-400 mr-1.5"></i>' + morning.length + ' morning</span>'
          + '<span class="text-xs glass px-3 py-1.5 rounded-full"><i class="fas fa-moon text-indigo-400 mr-1.5"></i>' + afternoon.length + ' afternoon</span>'
          + '</div></div>'
          + sessionSection('Morning Session', 'sun', 'amber-500/30', 'orange-500/30', morning, '10:00 – 11:30 AM')
          + sessionSection('Afternoon Session', 'moon', 'indigo-500/30', 'violet-500/30', afternoon, '2:00 – 4:10 PM');

      } catch(err) {
        container.innerHTML = '<div class="text-center py-12"><i class="fas fa-exclamation-triangle text-2xl text-red-400"></i><p class="text-gray-400 text-sm mt-2">Failed to load innovation talks</p></div>';
      }
    }


    // ==================== INBOX ====================
    function switchInboxTab(tab) {
      document.querySelectorAll('.inbox-tab').forEach(b => {
        b.classList.remove('tab-active');
        b.classList.add('text-gray-400');
      });
      document.querySelector(\`[data-inbox="\${tab}"]\`).classList.add('tab-active');
      document.querySelector(\`[data-inbox="\${tab}"]\`).classList.remove('text-gray-400');
      document.getElementById('inbox-connections').classList.toggle('hidden', tab !== 'connections');
      document.getElementById('inbox-meetings').classList.toggle('hidden', tab !== 'meetings');
      if (tab === 'connections') loadConnections();
      else loadMeetings();
    }

    async function loadInbox() {
      await Promise.all([loadConnections(), loadMeetings()]);
    }

    async function loadConnections() {
      if (!currentUser) return;
      try {
        const connections = await api.get(\`/api/attendees/\${currentUser.id}/connections\`);
        document.getElementById('inbox-connections').innerHTML = connections.length ? connections.map(conn => \`
          <div class="glass rounded-xl p-4 card-hover">
            <div class="flex items-center gap-3">
              <div class="relative">
                <img src="\${getAvatarUrl(conn.other_email, conn.other_name, 96, conn.other_avatar)}" alt="\${conn.other_name}" class="w-12 h-12 rounded-full object-cover">
                <span class="\${conn.other_online ? 'online-dot' : 'offline-dot'} absolute -bottom-0.5 -right-0.5 border-2 border-dark-900"></span>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="font-semibold text-sm">\${conn.other_name}</h3>
                <p class="text-xs text-gray-400">\${conn.other_job_title || ''}\${conn.other_job_title && conn.other_company ? ' · ' : ''}\${conn.other_company || ''}</p>
                \${conn.message ? \`<p class="text-xs text-gray-500 mt-1 italic">"\${conn.message}"</p>\` : ''}
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <span class="px-2 py-0.5 rounded-full text-xs font-medium \${conn.status === 'accepted' ? 'bg-green-500/20 text-green-400' : conn.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'}">\${conn.status}</span>
                \${conn.status === 'pending' && conn.to_attendee_id == currentUser.id ? \`
                  <button onclick="updateConnection(\${conn.id}, 'accepted')" class="px-2 py-1 rounded text-xs bg-green-500/20 text-green-400 hover:bg-green-500/30"><i class="fas fa-check"></i></button>
                  <button onclick="updateConnection(\${conn.id}, 'declined')" class="px-2 py-1 rounded text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30"><i class="fas fa-times"></i></button>
                \` : ''}
                \${conn.status === 'accepted' ? \`<button onclick="openChat(\${conn.other_id}, '\${conn.other_name?.replace(/'/g, "&apos;")}', '\${(conn.other_company || '').replace(/'/g, "&apos;")}')" class="px-2 py-1 rounded text-xs bg-primary-500/20 text-primary-300 hover:bg-primary-500/30"><i class="fas fa-comment"></i></button>\` : ''}
              </div>
            </div>
          </div>
        \`).join('') : '<div class="text-center text-gray-500 py-12"><i class="fas fa-link text-4xl mb-3 block"></i><p>No connections yet. Start networking!</p></div>';
      } catch(e) { console.error('Connections error:', e); }
    }

    async function updateConnection(id, status) {
      try {
        await api.put(\`/api/connections/\${id}\`, { status });
        showToast(\`Connection \${status}!\`, 'success');
        loadConnections();
      } catch(e) { showToast('Failed to update connection', 'error'); }
    }

    async function loadMeetings() {
      if (!currentUser) return;
      try {
        const meetings = await api.get(\`/api/attendees/\${currentUser.id}/meetings\`);
        document.getElementById('inbox-meetings').innerHTML = meetings.length ? meetings.map(m => {
          const isRequester = m.requester_id == currentUser.id;
          const otherName = isRequester ? m.requestee_name : m.requester_name;
          const otherCompany = isRequester ? m.requestee_company : m.requester_company;
          return \`
            <div class="glass rounded-xl p-4 card-hover">
              <div class="flex items-start gap-3">
                <div class="w-10 h-10 rounded-xl bg-primary-500/20 flex items-center justify-center shrink-0">
                  <i class="fas fa-calendar-check text-primary-400"></i>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-1">
                    <h3 class="font-semibold text-sm">\${m.title || 'Meeting'}</h3>
                    <span class="px-2 py-0.5 rounded-full text-xs font-medium \${m.status === 'accepted' ? 'bg-green-500/20 text-green-400' : m.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' : m.status === 'cancelled' ? 'bg-red-500/20 text-red-400' : 'bg-gray-500/20 text-gray-400'}">\${m.status}</span>
                  </div>
                  <p class="text-xs text-gray-400">with <span class="text-white">\${otherName}</span> · \${otherCompany}</p>
                  <div class="flex items-center gap-3 mt-2 text-xs text-gray-500">
                    <span><i class="fas fa-clock mr-1"></i>\${new Date(m.meeting_time).toLocaleString()}</span>
                    <span><i class="fas fa-hourglass-half mr-1"></i>\${m.duration_minutes} min</span>
                    \${m.location ? \`<span><i class="fas fa-map-pin mr-1"></i>\${m.location}</span>\` : ''}
                  </div>
                </div>
                \${!isRequester && m.status === 'pending' ? \`
                  <div class="flex gap-1 shrink-0">
                    <button onclick="updateMeeting(\${m.id}, 'accepted')" class="px-2 py-1 rounded text-xs bg-green-500/20 text-green-400 hover:bg-green-500/30"><i class="fas fa-check"></i></button>
                    <button onclick="updateMeeting(\${m.id}, 'declined')" class="px-2 py-1 rounded text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30"><i class="fas fa-times"></i></button>
                  </div>
                \` : ''}
              </div>
            </div>
          \`;
        }).join('') : '<div class="text-center text-gray-500 py-12"><i class="fas fa-calendar-times text-4xl mb-3 block"></i><p>No meetings scheduled yet.</p></div>';
      } catch(e) { console.error('Meetings error:', e); }
    }

    async function updateMeeting(id, status) {
      try {
        await api.put(\`/api/meetings/\${id}\`, { status });
        showToast(\`Meeting \${status}!\`, 'success');
        loadMeetings();
      } catch(e) { showToast('Failed to update meeting', 'error'); }
    }

    // ==================== UNREAD CHECK ====================
    async function checkUnread() {
      if (!currentUser) return;
      try {
        const data = await api.get(\`/api/attendees/\${currentUser.id}/unread\`);
        const badge = document.getElementById('unread-badge');
        const badgeMobile = document.getElementById('unread-badge-mobile');
        if (data.count > 0) {
          if(badge){badge.textContent = data.count; badge.classList.remove('hidden');}
          if(badgeMobile){badgeMobile.textContent = data.count; badgeMobile.classList.remove('hidden');}
        } else {
          if(badge) badge.classList.add('hidden');
          if(badgeMobile) badgeMobile.classList.add('hidden');
        }
      } catch(e) {}
      setTimeout(checkUnread, 15000);
    }

    // ==================== RSVP FUNCTIONS ====================
    async function submitRsvp(status) {
      if (!currentUser) { showToast('Please sign in first', 'error'); return; }
      try {
        await api.post('/api/attendees/' + currentUser.id + '/rsvp', { status });
        currentUser.rsvp_status = status;
        currentUser.rsvp_at = new Date().toISOString();
        localStorage.setItem('tc_user', JSON.stringify(currentUser));
        updateRsvpCard();
        const msgs = { confirmed: "You're confirmed! See you at WTC Mumbai 🎉", declined: "We'll miss you! You can change your mind anytime.", maybe: "Noted as maybe. Let us know when you decide!" };
        showToast(msgs[status] || 'RSVP updated!', status === 'confirmed' ? 'success' : 'info');
      } catch(e) { showToast('Failed to update RSVP', 'error'); }
    }

    function updateRsvpCard() {
      const container = document.getElementById('rsvp-card-container');
      if (!container || !currentUser) return;
      const s = currentUser.rsvp_status;
      if (!s) {
        document.getElementById('rsvp-buttons').classList.remove('hidden');
        document.getElementById('rsvp-status-display').classList.add('hidden');
        return;
      }
      const cfg = {
        confirmed: { icon: 'fa-check-circle', text: "You've confirmed your attendance!", color: 'green', bg: 'bg-green-500/10 border-green-500/20' },
        declined: { icon: 'fa-times-circle', text: "You've indicated you can't attend.", color: 'red', bg: 'bg-red-500/10 border-red-500/20' },
        maybe: { icon: 'fa-question-circle', text: "You're marked as Maybe.", color: 'amber', bg: 'bg-amber-500/10 border-amber-500/20' },
      }[s] || { icon: 'fa-question-circle', text: 'Unknown', color: 'gray', bg: '' };

      document.getElementById('rsvp-buttons').classList.add('hidden');
      const display = document.getElementById('rsvp-status-display');
      display.classList.remove('hidden');
      display.innerHTML = \`
        <div class="flex items-center gap-3 p-3 rounded-xl \${cfg.bg} border">
          <i class="fas \${cfg.icon} text-\${cfg.color}-400 text-xl"></i>
          <div class="flex-1">
            <span class="text-sm font-semibold text-\${cfg.color}-400">\${cfg.text}</span>
            <p class="text-[10px] text-gray-500 mt-0.5">You can change your response anytime</p>
          </div>
          <button onclick="document.getElementById('rsvp-buttons').classList.remove('hidden'); document.getElementById('rsvp-status-display').classList.add('hidden');" class="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/15 text-gray-300 transition"><i class="fas fa-edit mr-1"></i>Change</button>
        </div>
      \`;
    }

    // ==================== DELEGATE PASS GENERATOR ====================
    async function generateDelegatePass(adminAttendee) {
      const user = adminAttendee || currentUser;
      const isAdminDownload = !!adminAttendee;
      if (!user) { showToast('Please sign in first', 'error'); return; }
      showToast('Generating Delegate Pass...', 'info');

      const W = 1000, H = 1500;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      const px = (u) => '/api/image-proxy?url=' + encodeURIComponent(u);
      const passId = 'BHAI-2026-' + String(user.id).padStart(4, '0');

      // ===== LOAD ALL LOGOS FIRST =====
      let meityLogo, agbaLogo, bharatLogo, aegisCollegeLogo, assessfyLogo, tcoeiLogo, swissnexLogo;
      try { meityLogo = await loadImage(px('https://bharataiinnovation.com/wp-content/uploads/2026/02/Meity-logo.png')); } catch(e) { console.log('MeitY logo failed:', e); }
      try { agbaLogo = await loadImage(px('https://bharataiinnovation.com/images/Bharat%20AI%20Innovation%20Logo.png')); } catch(e) { console.log('BHAI logo failed:', e); }
      try { bharatLogo = await loadImage(px('https://bharataiinnovation.com/wp-content/uploads/2026/02/Bharat-AI-Innovation-Expo-logo-scaled.png')); } catch(e) { console.log('Bharat AI logo failed:', e); }
      try { aegisCollegeLogo = await loadImage(px('https://bharataiinnovation.com/wp-content/uploads/2025/10/Aegis_college_new1.png')); } catch(e) { console.log('Aegis College logo failed:', e); }
      try { assessfyLogo = await loadImage(px('https://bharataiinnovation.com/wp-content/uploads/2023/12/Assessfy-black.png')); } catch(e) { console.log('Assessfy logo failed:', e); }
      try { tcoeiLogo = await loadImage(px('https://bharataiinnovation.com/wp-content/uploads/2019/06/tcoei.png')); } catch(e) { console.log('TCOEI logo failed:', e); }
      try { swissnexLogo = await loadImage(px('https://bharataiinnovation.com/wp-content/uploads/2025/10/Swissnex-red-logo_76ea13ce5cec9e3d897b76c6abe4779f-400x120.png')); } catch(e) { console.log('Swissnex logo failed:', e); }

      // ===== HELPER: Draw faded gold line =====
      function goldLine(y, xPad, alpha) {
        const g = ctx.createLinearGradient(xPad, 0, W - xPad, 0);
        g.addColorStop(0, 'rgba(200,168,85,0)');
        g.addColorStop(0.3, 'rgba(200,168,85,' + alpha + ')');
        g.addColorStop(0.5, 'rgba(219,185,96,' + (alpha + 0.15) + ')');
        g.addColorStop(0.7, 'rgba(200,168,85,' + alpha + ')');
        g.addColorStop(1, 'rgba(200,168,85,0)');
        ctx.fillStyle = g;
        ctx.fillRect(xPad, y, W - xPad * 2, 1);
      }

      // ===== BACKGROUND: Rich deep navy with subtle texture =====
      const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
      bgGrad.addColorStop(0, '#060a1e');
      bgGrad.addColorStop(0.15, '#0b1030');
      bgGrad.addColorStop(0.5, '#0e1438');
      bgGrad.addColorStop(0.85, '#0b1030');
      bgGrad.addColorStop(1, '#060a1e');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      // Soft warm radial glow behind avatar area
      const warmGlow = ctx.createRadialGradient(W/2, H * 0.42, 40, W/2, H * 0.42, 420);
      warmGlow.addColorStop(0, 'rgba(200,168,85,0.06)');
      warmGlow.addColorStop(0.5, 'rgba(200,168,85,0.02)');
      warmGlow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = warmGlow;
      ctx.fillRect(0, 0, W, H);

      // Very subtle top light
      const topGlow = ctx.createRadialGradient(W/2, -100, 50, W/2, 200, 500);
      topGlow.addColorStop(0, 'rgba(100,130,220,0.04)');
      topGlow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = topGlow;
      ctx.fillRect(0, 0, W, H);

      // ===== ELEGANT BORDER FRAME =====
      // Outer fine gold border
      ctx.strokeStyle = 'rgba(200,168,85,0.65)';
      ctx.lineWidth = 1.5;
      roundRect(ctx, 28, 28, W - 56, H - 56, 18); ctx.stroke();
      // Inner fine border
      ctx.strokeStyle = 'rgba(200,168,85,0.2)';
      ctx.lineWidth = 0.5;
      roundRect(ctx, 38, 38, W - 76, H - 76, 14); ctx.stroke();

      // Elegant corner ornaments (refined L-shapes with serif ends)
      ctx.strokeStyle = 'rgba(200,168,85,0.7)';
      ctx.lineWidth = 1.8;
      const cLen = 40, cOff = 42;
      // Top-left
      ctx.beginPath(); ctx.moveTo(cOff, cOff + cLen); ctx.lineTo(cOff, cOff); ctx.lineTo(cOff + cLen, cOff); ctx.stroke();
      // Top-right
      ctx.beginPath(); ctx.moveTo(W - cOff - cLen, cOff); ctx.lineTo(W - cOff, cOff); ctx.lineTo(W - cOff, cOff + cLen); ctx.stroke();
      // Bottom-left
      ctx.beginPath(); ctx.moveTo(cOff, H - cOff - cLen); ctx.lineTo(cOff, H - cOff); ctx.lineTo(cOff + cLen, H - cOff); ctx.stroke();
      // Bottom-right
      ctx.beginPath(); ctx.moveTo(W - cOff - cLen, H - cOff); ctx.lineTo(W - cOff, H - cOff); ctx.lineTo(W - cOff, H - cOff - cLen); ctx.stroke();
      // Small diamond at each corner
      [[cOff, cOff], [W - cOff, cOff], [cOff, H - cOff], [W - cOff, H - cOff]].forEach(([cx, cy]) => {
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.PI/4);
        ctx.fillStyle = 'rgba(200,168,85,0.5)';
        ctx.fillRect(-3, -3, 6, 6);
        ctx.restore();
      });

      // ===== TOP ACCENT BAR =====
      goldLine(62, 120, 0.5);

      // ===== HEADER: "Supported by" + MeitY Logo =====
      let curY = 85;
      ctx.fillStyle = 'rgba(200,168,85,0.55)';
      ctx.font = '500 10px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('S U P P O R T E D   B Y', W/2, curY);
      curY += 14;

      if (meityLogo) {
        const mH = 55, mW = mH * (meityLogo.width / meityLogo.height);
        ctx.drawImage(meityLogo, W/2 - mW/2, curY, mW, mH);
        curY += mH + 14;
      } else {
        curY += 10;
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '600 12px Arial, sans-serif';
        ctx.fillText('Ministry of Electronics & Information Technology', W/2, curY);
        curY += 24;
      }

      // Subtle separator
      goldLine(curY, 200, 0.3);
      curY += 18;

      // ===== BHAI LOGO =====
      if (agbaLogo) {
        const aH = 80, aW = aH * (agbaLogo.width / agbaLogo.height);
        ctx.drawImage(agbaLogo, W/2 - aW/2, curY, aW, aH);
        curY += aH + 14;
      } else {
        curY += 16;
      }

      // ===== EVENT TITLE =====
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 30px Georgia, "Times New Roman", serif';
      ctx.textAlign = 'center';
      ctx.fillText('16th Bharat AI Innovation', W/2, curY);
      curY += 30;

      // Venue & Date - elegant gold
      ctx.fillStyle = '#d4af5a';
      ctx.font = '500 14px Arial, sans-serif';
      ctx.fillText('20-21 Nov 2026  \u2022  World Trade Center, Mumbai', W/2, curY);
      curY += 24;

      // Decorative divider: thin lines with centered diamond
      const divW = 300;
      goldLine(curY, W/2 - divW/2, 0.4);
      // Center diamond
      ctx.save(); ctx.translate(W/2, curY);
      ctx.rotate(Math.PI/4);
      ctx.fillStyle = '#d4af5a';
      ctx.fillRect(-4.5, -4.5, 9, 9);
      ctx.restore();
      // Gap in middle
      ctx.fillStyle = '#0e1438';
      ctx.save(); ctx.translate(W/2, curY);
      ctx.rotate(Math.PI/4);
      ctx.clearRect(-7, -7, 14, 14);
      ctx.fillRect(-7, -7, 14, 14);
      ctx.restore();
      ctx.save(); ctx.translate(W/2, curY);
      ctx.rotate(Math.PI/4);
      ctx.fillStyle = '#d4af5a';
      ctx.fillRect(-4, -4, 8, 8);
      ctx.restore();
      curY += 26;

      // ===== DELEGATE PASS BADGE =====
      const badgeW = 340, badgeH = 48;
      const badgeX = W/2 - badgeW/2;
      // Elegant pill badge
      const badgeBg = ctx.createLinearGradient(badgeX, curY, badgeX + badgeW, curY + badgeH);
      badgeBg.addColorStop(0, 'rgba(200,168,85,0.12)');
      badgeBg.addColorStop(0.5, 'rgba(200,168,85,0.18)');
      badgeBg.addColorStop(1, 'rgba(200,168,85,0.12)');
      ctx.fillStyle = badgeBg;
      roundRect(ctx, badgeX, curY, badgeW, badgeH, 24); ctx.fill();
      // Gold border
      ctx.strokeStyle = 'rgba(200,168,85,0.5)';
      ctx.lineWidth = 1;
      roundRect(ctx, badgeX, curY, badgeW, badgeH, 24); ctx.stroke();
      // Badge text
      ctx.fillStyle = '#e8c86a';
      ctx.font = '700 18px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('\u2022  DELEGATE PASS  \u2022', W/2, curY + 32);
      curY += badgeH + 36;

      // ===== AVATAR WITH ELEGANT RING =====
      const avatarCY = curY + 80;
      const avatarR = 80;

      // Soft glow behind avatar
      ctx.shadowColor = 'rgba(200,168,85,0.25)';
      ctx.shadowBlur = 30;
      ctx.beginPath(); ctx.arc(W/2, avatarCY, avatarR + 8, 0, Math.PI * 2);
      const ringGrad = ctx.createLinearGradient(W/2 - avatarR, avatarCY - avatarR, W/2 + avatarR, avatarCY + avatarR);
      ringGrad.addColorStop(0, '#b8952e');
      ringGrad.addColorStop(0.3, '#e0c464');
      ringGrad.addColorStop(0.7, '#c8a040');
      ringGrad.addColorStop(1, '#d4b050');
      ctx.fillStyle = ringGrad;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Dark gap ring
      ctx.beginPath(); ctx.arc(W/2, avatarCY, avatarR + 3, 0, Math.PI * 2);
      ctx.fillStyle = '#0b1030';
      ctx.fill();

      // Inner gold ring (thin)
      ctx.beginPath(); ctx.arc(W/2, avatarCY, avatarR + 1, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(200,168,85,0.3)';
      ctx.lineWidth = 0.5;
      ctx.stroke();

      // Avatar image
      try {
        const avatarUrl = getAvatarUrl(user.email, user.name, 300, user.avatar_url);
        const img = await loadImage(avatarUrl);
        ctx.save();
        ctx.beginPath(); ctx.arc(W/2, avatarCY, avatarR, 0, Math.PI * 2); ctx.clip();
        ctx.drawImage(img, W/2 - avatarR, avatarCY - avatarR, avatarR * 2, avatarR * 2);
        ctx.restore();
      } catch(e) {
        ctx.beginPath(); ctx.arc(W/2, avatarCY, avatarR, 0, Math.PI * 2);
        const initBg = ctx.createLinearGradient(W/2 - avatarR, avatarCY - avatarR, W/2 + avatarR, avatarCY + avatarR);
        initBg.addColorStop(0, '#141a4a');
        initBg.addColorStop(1, '#1e2568');
        ctx.fillStyle = initBg; ctx.fill();
        ctx.fillStyle = '#e8c86a';
        ctx.font = 'bold 52px Georgia, serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2), W/2, avatarCY);
      }
      curY = avatarCY + avatarR + 30;

      // ===== NAME =====
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      // Handle long names — shrink font if needed instead of truncating
      let nameFontSize = 36;
      const nameText = user.name;
      ctx.font = 'bold ' + nameFontSize + 'px Georgia, "Times New Roman", serif';
      while (ctx.measureText(nameText).width > W - 140 && nameFontSize > 22) {
        nameFontSize -= 2;
        ctx.font = 'bold ' + nameFontSize + 'px Georgia, "Times New Roman", serif';
      }
      ctx.fillText(nameText, W/2, curY);
      curY += 6;

      // Job Title
      if (user.job_title) {
        curY += 26;
        ctx.fillStyle = '#d4af5a';
        let jtSize = 16;
        const jt = user.job_title;
        ctx.font = '500 ' + jtSize + 'px Arial, sans-serif';
        while (ctx.measureText(jt).width > W - 160 && jtSize > 11) {
          jtSize -= 1;
          ctx.font = '500 ' + jtSize + 'px Arial, sans-serif';
        }
        ctx.fillText(jt, W/2, curY);
      }
      // Company
      if (user.company) {
        curY += 24;
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        let coSize = 14;
        const co = user.company;
        ctx.font = coSize + 'px Arial, sans-serif';
        while (ctx.measureText(co).width > W - 140 && coSize > 10) {
          coSize -= 1;
          ctx.font = coSize + 'px Arial, sans-serif';
        }
        ctx.fillText(co, W/2, curY);
      }
      curY += 35;

      // ===== INFO PANEL (elegant frosted glass) =====
      const panelW = 520, panelH = 120, panelX = W/2 - panelW/2;
      // Panel background
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      roundRect(ctx, panelX, curY, panelW, panelH, 14); ctx.fill();
      ctx.strokeStyle = 'rgba(200,168,85,0.2)';
      ctx.lineWidth = 0.8;
      roundRect(ctx, panelX, curY, panelW, panelH, 14); ctx.stroke();

      // Row 1: Badge Type | Pass ID
      const row1Y = curY + 38;
      ctx.fillStyle = 'rgba(200,168,85,0.5)';
      ctx.font = '600 10px Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('BADGE TYPE', panelX + 28, row1Y - 8);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 16px Arial, sans-serif';
      ctx.fillText(displayBadge(user.badge_type || 'Delegate'), panelX + 28, row1Y + 14);

      ctx.fillStyle = 'rgba(200,168,85,0.5)';
      ctx.font = '600 10px Arial, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('PASS ID', panelX + panelW - 28, row1Y - 8);
      ctx.fillStyle = '#e8c86a';
      ctx.font = 'bold 16px monospace';
      ctx.fillText(passId, panelX + panelW - 28, row1Y + 14);

      // Vertical divider
      ctx.strokeStyle = 'rgba(200,168,85,0.15)';
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(W/2, curY + 16); ctx.lineTo(W/2, curY + 64); ctx.stroke();

      // Horizontal divider
      ctx.strokeStyle = 'rgba(200,168,85,0.1)';
      ctx.beginPath(); ctx.moveTo(panelX + 28, row1Y + 30); ctx.lineTo(panelX + panelW - 28, row1Y + 30); ctx.stroke();

      // Row 2: Event info
      const row2Y = row1Y + 52;
      ctx.fillStyle = 'rgba(200,168,85,0.5)';
      ctx.font = '600 10px Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('EVENT', panelX + 28, row2Y);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '500 13px Arial, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('20-21 Nov 2026  \u2022  World Trade Center, Mumbai', panelX + panelW - 28, row2Y);

      curY += panelH + 28;

      // ===== QR CODE =====
      const qrSize = 130;
      const qrX = W/2 - qrSize/2, qrTopY = curY;
      // QR container
      ctx.fillStyle = 'rgba(255,255,255,0.93)';
      roundRect(ctx, qrX - 10, qrTopY - 10, qrSize + 20, qrSize + 20, 10); ctx.fill();
      ctx.strokeStyle = 'rgba(200,168,85,0.3)';
      ctx.lineWidth = 0.8;
      roundRect(ctx, qrX - 10, qrTopY - 10, qrSize + 20, qrSize + 20, 10); ctx.stroke();

      // QR grid
      const cellSize = Math.floor(qrSize / 10);
      for (let r = 0; r < 10; r++) {
        for (let col = 0; col < 10; col++) {
          const hash = (user.id * (r + 1) * (col + 3) + r * col * 7 + col + r * 13) % 5;
          if (hash > 1) {
            ctx.fillStyle = hash > 3 ? '#0a0e27' : hash > 2 ? '#1a1f55' : '#2a2f75';
            roundRect(ctx, qrX + col * cellSize + 1, qrTopY + r * cellSize + 1, cellSize - 2, cellSize - 2, 2);
            ctx.fill();
          }
        }
      }
      // QR corner anchors
      [[qrX + 2, qrTopY + 2], [qrX + qrSize - 30, qrTopY + 2], [qrX + 2, qrTopY + qrSize - 30]].forEach(([ax, ay]) => {
        ctx.fillStyle = '#0a0e27';
        roundRect(ctx, ax, ay, 28, 28, 4); ctx.fill();
        ctx.fillStyle = '#ffffff';
        roundRect(ctx, ax + 4, ay + 4, 20, 20, 2); ctx.fill();
        ctx.fillStyle = '#0a0e27';
        roundRect(ctx, ax + 8, ay + 8, 12, 12, 2); ctx.fill();
      });

      // Pass ID below QR
      curY = qrTopY + qrSize + 22;
      ctx.fillStyle = 'rgba(200,168,85,0.4)';
      ctx.font = '600 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(passId, W/2, curY);
      curY += 26;

      // ===== DASHED TEAR LINE =====
      ctx.strokeStyle = 'rgba(200,168,85,0.25)';
      ctx.lineWidth = 0.8;
      ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.moveTo(65, curY); ctx.lineTo(W - 65, curY); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(200,168,85,0.35)';
      ctx.font = '13px Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('\u2702', 48, curY + 5);
      curY += 24;

      // ===== BOTTOM LOGOS SECTION (partner logos only) =====
      // "In Association With" label
      ctx.fillStyle = 'rgba(200,168,85,0.45)';
      ctx.font = '500 9px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('I N   A S S O C I A T I O N   W I T H', W/2, curY);
      curY += 16;

      // Draw all 5 partner logos in a row — larger, with white pill backgrounds for visibility
      const partnerLogos = [bharatLogo, aegisCollegeLogo, assessfyLogo, tcoeiLogo, swissnexLogo].filter(Boolean);
      if (partnerLogos.length > 0) {
        const lH = 42;
        const gap = 16;
        const padX = 10, padY = 6;
        const widths = partnerLogos.map(l => lH * (l.width / l.height));
        const totalLogoW = widths.reduce((a, b) => a + b, 0) + (padX * 2 + gap) * (partnerLogos.length - 1) + padX * 2;
        let lx = W/2 - totalLogoW/2;
        partnerLogos.forEach((logo, i) => {
          const w = widths[i];
          // White pill background for each logo
          ctx.fillStyle = 'rgba(255,255,255,0.92)';
          roundRect(ctx, lx, curY - padY, w + padX * 2, lH + padY * 2, 8); ctx.fill();
          ctx.drawImage(logo, lx + padX, curY, w, lH);
          lx += w + padX * 2 + gap;
        });
        curY += lH + padY * 2 + 16;
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = '11px Arial, sans-serif';
        ctx.fillText('Bharat AI  \u2022  Aegis School  \u2022  Assessfy  \u2022  TCOEI  \u2022  Swissnex', W/2, curY + 8);
        curY += 28;
      }

      // ===== WEBSITE FOOTER =====
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '11px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('bharataiinnovation.com  \u2022  networking.bharataiinnovation.com', W/2, H - 50);

      // Bottom accent bar
      goldLine(H - 38, 140, 0.4);

      // ===== DOWNLOAD =====
      const link = document.createElement('a');
      link.download = 'BHAI-2026-Delegate-Pass-' + user.name.replace(/\\s+/g, '-') + '.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
      showToast('Delegate Pass downloaded!', 'success');
      // Track download
      if (!isAdminDownload) { try { await fetch(\`/api/attendees/\${user.id}/track-pass-download\`, { method: 'POST' }); } catch(e) {} }
    }

    function loadImage(src) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      });
    }

    function roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }

    // ==================== HELPERS ====================
    function formatTime(dt) {
      if (!dt) return '';
      const d = new Date(dt);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function getSessionTypeClass(type) {
      const classes = {
        keynote: 'bg-accent-500/20 text-accent-300',
        talk: 'bg-primary-500/20 text-primary-300',
        panel: 'bg-purple-500/20 text-purple-300',
        workshop: 'bg-green-500/20 text-green-300',
        networking: 'bg-teal-500/20 text-teal-300',
        break: 'bg-gray-500/20 text-gray-400',
        ceremony: 'bg-amber-500/20 text-amber-300',
        exhibition: 'bg-emerald-500/20 text-emerald-300',
      };
      return classes[type] || 'bg-white/5 text-gray-400';
    }

    function getBadgeClass(badge) {
      const b = (badge || '').toLowerCase();
      const classes = {
        'organiser': 'bg-indigo-500/20 text-indigo-300',
        'vip guest': 'bg-amber-500/20 text-amber-300',
        'exhibitor': 'bg-green-500/20 text-green-300',
        'delegate': 'bg-primary-500/20 text-primary-300',
        'exhibition speaker': 'bg-purple-500/20 text-purple-300',
        'jury': 'bg-rose-500/20 text-rose-300',
        'visitor pass': 'bg-cyan-500/20 text-cyan-300',
        'media': 'bg-blue-500/20 text-blue-300',
        'support staff': 'bg-slate-500/20 text-slate-300',
        'investor': 'bg-emerald-500/20 text-emerald-300',
        'felicitation delegate': 'bg-pink-500/20 text-pink-300',
        'vip pass': 'bg-yellow-500/20 text-yellow-300',
        // Legacy mappings
        'vip': 'bg-amber-500/20 text-amber-300',
        'speaker': 'bg-purple-500/20 text-purple-300',
        'press': 'bg-blue-500/20 text-blue-300',
        'general': 'bg-white/5 text-gray-400',
      };
      return classes[b] || 'bg-white/5 text-gray-400';
    }

    // Public display badge name: simplify delegate variants to "Delegate"
    function displayBadge(badge) {
      const b = (badge || 'Delegate').trim();
      const delegateVariants = ['felicitation delegate', 'finalist delegate'];
      if (delegateVariants.includes(b.toLowerCase())) return 'Delegate';
      return b;
    }

    // ==================== MY PROFILE / USER DASHBOARD ====================
    let myDashboardData = null;
    let myAllConnections = [];
    let myAllMeetings = [];

    async function loadMyProfile() {
      if (!currentUser) return;
      try {
        const data = await api.get(\`/api/attendees/\${currentUser.id}/dashboard\`);
        myDashboardData = data;
        const p = data.profile;
        const s = data.stats;

        // Also fetch full connections + meetings for subtabs
        const [connData, meetData] = await Promise.all([
          api.get(\`/api/attendees/\${currentUser.id}/connections\`),
          api.get(\`/api/attendees/\${currentUser.id}/meetings\`),
        ]);
        myAllConnections = connData || [];
        myAllMeetings = meetData || [];

        // ---- Profile Header with Cover ----
        document.getElementById('my-profile-header').innerHTML = \`
          <div class="glass rounded-2xl overflow-hidden mb-6 glow">
            <div class="profile-cover h-32 md:h-40 relative">
              <div class="absolute inset-0 flex items-end p-6">
                <div class="flex items-end gap-4 w-full">
                  <div class="relative -mb-12 md:-mb-14 z-10 shrink-0">
                    <img src="\${getAvatarUrl(p.email, p.name, 224, p.avatar_url)}" alt="\${p.name}" class="w-24 h-24 md:w-28 md:h-28 rounded-2xl object-cover shadow-2xl border-4 border-dark-900">
                    <span class="\${p.is_online ? 'online-dot' : 'offline-dot'} absolute -bottom-1 -right-1 border-3 border-dark-900 w-5 h-5"></span>
                  </div>
                </div>
              </div>
            </div>
            <div class="px-6 pt-14 md:pt-16 pb-6">
              <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                <div class="flex-1">
                  <div class="flex items-center gap-3 flex-wrap mb-1">
                    <h2 class="text-2xl md:text-3xl font-black">\${p.name}</h2>
                    <span class="px-2.5 py-0.5 rounded-full text-xs font-bold \${getBadgeClass(p.badge_type)} uppercase tracking-wide">\${displayBadge(p.badge_type)}</span>
                    \${p.is_online ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-500/20 text-green-400"><i class="fas fa-circle text-[6px] mr-1"></i>Online</span>' : ''}
                  </div>
                  <p class="text-gray-300 text-sm md:text-base">\${p.job_title || 'Attendee'}\${p.company ? ' at <span class="text-white font-semibold">' + p.company + '</span>' : ''}</p>
                  \${p.bio ? \`<p class="text-sm text-gray-400 mt-2 max-w-2xl leading-relaxed">\${p.bio}</p>\` : ''}
                  \${p.interests ? \`
                    <div class="flex flex-wrap gap-1.5 mt-3">\${p.interests.split(',').map(i => \`<span class="px-2.5 py-1 rounded-full text-xs bg-primary-500/15 text-primary-300 border border-primary-500/20 font-medium">\${i.trim()}</span>\`).join('')}</div>
                  \` : ''}
                  <div class="flex items-center gap-4 mt-3">
                    \${p.linkedin_url ? \`<a href="\${p.linkedin_url}" target="_blank" class="text-blue-400 hover:text-blue-300 transition" title="LinkedIn"><i class="fab fa-linkedin text-lg"></i></a>\` : ''}
                    \${p.twitter_url ? \`<a href="\${p.twitter_url}" target="_blank" class="text-sky-400 hover:text-sky-300 transition" title="Twitter"><i class="fab fa-twitter text-lg"></i></a>\` : ''}
                    \${p.website_url ? \`<a href="\${p.website_url}" target="_blank" class="text-gray-400 hover:text-white transition" title="Website"><i class="fas fa-globe text-lg"></i></a>\` : ''}
                    <span class="text-xs text-gray-500 ml-1"><i class="fas fa-envelope mr-1"></i>\${p.email}</span>
                  </div>
                </div>
                <div class="flex gap-2 shrink-0 flex-wrap">
                  <button onclick="generateDelegatePass()" class="px-4 py-2.5 rounded-xl text-sm font-medium bg-primary-600 hover:bg-primary-500 text-white transition quick-action-btn"><i class="fas fa-id-badge mr-2"></i>Download Pass</button>
                  <button onclick="openEditProfile()" class="px-4 py-2.5 rounded-xl text-sm font-medium bg-primary-600 hover:bg-primary-500 text-white transition quick-action-btn"><i class="fas fa-user-edit mr-2"></i>Edit Profile</button>
                  <button onclick="logoutUser()" class="px-4 py-2.5 rounded-xl text-sm font-medium glass hover:bg-white/10 text-gray-400 transition quick-action-btn"><i class="fas fa-sign-out-alt mr-2"></i>Sign Out</button>
                </div>
              </div>
            </div>
          </div>
        \`;

        // ---- Quick Actions ----
        document.getElementById('my-quick-actions').innerHTML = \`
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <button onclick="switchTab('networking')" class="glass rounded-xl p-4 text-center card-hover quick-action-btn group">
              <div class="w-10 h-10 rounded-full bg-primary-500/20 flex items-center justify-center mx-auto mb-2 group-hover:bg-primary-500/30 transition">
                <i class="fas fa-user-plus text-primary-400"></i>
              </div>
              <div class="text-xs font-medium">Find People</div>
            </button>
            <button onclick="switchTab('schedule')" class="glass rounded-xl p-4 text-center card-hover quick-action-btn group">
              <div class="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-2 group-hover:bg-green-500/30 transition">
                <i class="fas fa-calendar-plus text-green-400"></i>
              </div>
              <div class="text-xs font-medium">View Schedule</div>
            </button>
            <button onclick="switchTab('exhibition')" class="glass rounded-xl p-4 text-center card-hover quick-action-btn group">
              <div class="w-10 h-10 rounded-full bg-accent-500/20 flex items-center justify-center mx-auto mb-2 group-hover:bg-accent-500/30 transition">
                <i class="fas fa-store text-accent-400"></i>
              </div>
              <div class="text-xs font-medium">Explore Expo</div>
            </button>
            <button onclick="switchTab('startup-pitch')" class="glass rounded-xl p-4 text-center card-hover quick-action-btn group">
              <div class="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center mx-auto mb-2 group-hover:bg-purple-500/30 transition">
                <i class="fas fa-rocket text-purple-400"></i>
              </div>
              <div class="text-xs font-medium">Startups</div>
            </button>
          </div>
        \`;

        // ---- My Exhibition Booth (for Exhibitor badge holders) ----
        const exhibitorBadges = ['exhibitor', 'exhibitor booth', 'exhibition speaker'];
        const isExhibitor = exhibitorBadges.some(b => (p.badge_type || '').toLowerCase().includes(b));
        const boothSection = document.getElementById('my-booth-section');
        if (isExhibitor) {
          boothSection.classList.remove('hidden');
          try {
            const booth = await api.get(\`/api/attendees/\${currentUser.id}/exhibitor\`);
            if (booth && booth.id) {
              boothSection.innerHTML = \`
                <div class="glass rounded-2xl overflow-hidden glow">
                  <div class="px-6 py-4 border-b border-white/10 flex items-center justify-between">
                    <div class="flex items-center gap-3">
                      <div class="w-10 h-10 rounded-full bg-accent-500/20 flex items-center justify-center">
                        <i class="fas fa-store text-accent-400"></i>
                      </div>
                      <div>
                        <h3 class="font-bold text-base">My Exhibition Booth</h3>
                        <p class="text-xs text-gray-400">\${booth.company_name} \${booth.booth_number ? '&bull; Booth '+booth.booth_number : ''}</p>
                      </div>
                    </div>
                    <button onclick="openEditMyBooth()" class="px-4 py-2 rounded-xl text-xs font-medium bg-accent-600 hover:bg-accent-500 text-white transition"><i class="fas fa-edit mr-1"></i>Edit Booth</button>
                  </div>
                  <div class="p-6">
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                      <div class="text-center">
                        <div class="text-2xl font-black text-accent-400">\${booth.visitor_count || 0}</div>
                        <div class="text-[10px] text-gray-500 uppercase tracking-wider">Visitors</div>
                      </div>
                      <div class="text-center">
                        <div class="text-sm font-semibold text-white">\${booth.booth_size || 'standard'}</div>
                        <div class="text-[10px] text-gray-500 uppercase tracking-wider">Booth Size</div>
                      </div>
                      <div class="text-center">
                        <div class="text-sm font-semibold text-white">\${booth.category || 'General'}</div>
                        <div class="text-[10px] text-gray-500 uppercase tracking-wider">Category</div>
                      </div>
                      <div class="text-center">
                        <div class="text-sm font-semibold text-white">\${booth.booth_number || '-'}</div>
                        <div class="text-[10px] text-gray-500 uppercase tracking-wider">Booth #</div>
                      </div>
                    </div>
                    \${booth.description ? '<p class="text-sm text-gray-400 mb-3">'+booth.description+'</p>' : ''}
                    \${booth.products ? '<div class="flex flex-wrap gap-1.5">' + booth.products.split(',').map(p => '<span class="px-2.5 py-1 rounded-full text-xs bg-accent-500/15 text-accent-300 border border-accent-500/20 font-medium">'+p.trim()+'</span>').join('') + '</div>' : ''}
                    \${booth.website_url ? '<div class="mt-3"><a href="'+booth.website_url+'" target="_blank" class="text-xs text-primary-400 hover:text-primary-300"><i class="fas fa-globe mr-1"></i>'+booth.website_url+'</a></div>' : ''}
                  </div>
                </div>
              \`;
            } else {
              boothSection.innerHTML = \`
                <div class="glass rounded-2xl p-6 text-center">
                  <div class="w-14 h-14 rounded-full bg-accent-500/20 flex items-center justify-center mx-auto mb-3">
                    <i class="fas fa-store text-accent-400 text-xl"></i>
                  </div>
                  <h3 class="font-bold mb-1">Set Up Your Exhibition Booth</h3>
                  <p class="text-sm text-gray-400 mb-4">As an exhibitor, you can create your booth listing visible to all attendees.</p>
                  <button onclick="openEditMyBooth()" class="px-6 py-2.5 rounded-xl text-sm font-medium bg-accent-600 hover:bg-accent-500 text-white transition"><i class="fas fa-plus mr-1"></i>Create Booth Listing</button>
                </div>
              \`;
            }
          } catch(e) { console.error('Booth load error:', e); boothSection.classList.add('hidden'); }
        } else {
          boothSection.classList.add('hidden');
        }

        // ---- Engagement Ring ----
        const totalPossible = 4; // connections, messages, meetings, booths
        let engagementCount = 0;
        if (s.connectionsAccepted > 0) engagementCount++;
        if (s.totalMessages > 0) engagementCount++;
        if (s.meetingsUpcoming > 0 || s.meetingsPending > 0) engagementCount++;
        if (s.boothVisits > 0) engagementCount++;
        const engagementPercent = Math.round((engagementCount / totalPossible) * 100);
        const circumference = 2 * Math.PI * 52;
        const dashOffset = circumference - (engagementPercent / 100) * circumference;

        document.getElementById('my-engagement-ring').innerHTML = \`
          <div class="glass rounded-xl p-5 flex flex-col items-center justify-center h-full">
            <div class="engagement-ring mx-auto">
              <svg width="120" height="120" viewBox="0 0 120 120">
                <defs>
                  <linearGradient id="engGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:#748ffc" />
                    <stop offset="100%" style="stop-color:#ff9800" />
                  </linearGradient>
                </defs>
                <circle class="bg-ring" cx="60" cy="60" r="52" />
                <circle class="fg-ring" cx="60" cy="60" r="52"
                  stroke-dasharray="\${circumference}"
                  stroke-dashoffset="\${dashOffset}" />
              </svg>
              <div class="absolute inset-0 flex flex-col items-center justify-center">
                <span class="text-2xl font-black gradient-text">\${engagementPercent}%</span>
                <span class="text-[10px] text-gray-500">Engagement</span>
              </div>
            </div>
            <p class="text-xs text-gray-400 mt-3 text-center">\${engagementCount}/\${totalPossible} activities completed</p>
            \${engagementPercent < 100 ? \`<p class="text-[10px] text-accent-400 mt-1 text-center">\${getEngagementTip(s)}</p>\` : '<p class="text-[10px] text-green-400 mt-1 text-center">Fully engaged! Great job!</p>'}
          </div>
        \`;

        // ---- Stats Cards ----
        const statsData = [
          { icon: 'fa-user-friends', label: 'Connections', value: s.connectionsAccepted, sub: s.connectionsPending > 0 ? s.connectionsPending + ' pending' : '', color: '#748ffc', onClick: "switchProfileSubtab('connections')" },
          { icon: 'fa-comment-dots', label: 'Messages', value: s.totalMessages, sub: s.unreadMessages > 0 ? s.unreadMessages + ' unread' : '', color: '#22c55e', onClick: "switchTab('inbox')" },
          { icon: 'fa-calendar-check', label: 'Meetings', value: s.meetingsUpcoming, sub: s.meetingsPending > 0 ? s.meetingsPending + ' pending' : '', color: '#ff9800', onClick: "switchProfileSubtab('meetings')" },
          { icon: 'fa-store', label: 'Booths', value: s.boothVisits, sub: '', color: '#a78bfa', onClick: "switchTab('exhibition')" },
          { icon: 'fa-clock', label: 'Since', value: new Date(p.created_at).toLocaleDateString([], {month:'short',day:'numeric'}), sub: '', color: '#14b8a6', onClick: '' },
        ];
        document.getElementById('my-profile-stats').innerHTML = statsData.map(st => \`
          <div class="glass rounded-xl p-4 card-hover text-center cursor-pointer" \${st.onClick ? 'onclick="' + st.onClick + '"' : ''}>
            <i class="fas \${st.icon} text-lg mb-2" style="color:\${st.color}"></i>
            <div class="text-2xl font-black">\${st.value}</div>
            <div class="text-[10px] text-gray-500 uppercase tracking-wide">\${st.label}</div>
            \${st.sub ? \`<div class="text-[10px] text-accent-400 mt-0.5 font-medium">\${st.sub}</div>\` : ''}
          </div>
        \`).join('');

        // ---- Populate Overview sub-tab lists ----
        renderMyConnectionsList(data.recentConnections);
        renderMyMeetingsList(data.upcomingMeetings);
        renderMyBoothsList(data.visitedBooths);

        // ---- Populate Full Connections sub-tab ----
        renderAllConnections(myAllConnections);

        // ---- Populate Full Meetings sub-tab ----
        renderAllMeetings(myAllMeetings);

        // ---- Build Activity Timeline ----
        buildActivityTimeline(data, connData, meetData);

      } catch(e) { console.error('Profile dashboard error:', e); }
    }

    function getEngagementTip(s) {
      if (s.connectionsAccepted === 0) return 'Connect with attendees!';
      if (s.totalMessages === 0) return 'Start a conversation!';
      if (s.meetingsUpcoming === 0 && s.meetingsPending === 0) return 'Schedule a meeting!';
      if (s.boothVisits === 0) return 'Visit an expo booth!';
      return 'Keep engaging!';
    }

    function renderMyConnectionsList(connections) {
      document.getElementById('my-connections-list').innerHTML = connections.length ? connections.map(c => \`
        <div class="glass rounded-xl p-4 card-hover">
          <div class="flex items-center gap-3">
            <div class="relative">
              <img src="\${getAvatarUrl(c.other_email, c.other_name, 80, c.other_avatar)}" alt="\${c.other_name}" class="w-10 h-10 rounded-full object-cover">
              <span class="\${c.other_online ? 'online-dot' : 'offline-dot'} absolute -bottom-0.5 -right-0.5 border-2 border-dark-900"></span>
            </div>
            <div class="flex-1 min-w-0">
              <h4 class="font-semibold text-sm truncate">\${c.other_name}</h4>
              <p class="text-xs text-gray-500 truncate">\${c.other_company || ''}</p>
            </div>
            <div class="flex gap-1.5">
              <button onclick="openChat(\${c.other_id}, '\${(c.other_name || '').replace(/'/g, "\\\\&apos;")}', '\${(c.other_company || '').replace(/'/g, "\\\\&apos;")}')" class="px-3 py-1.5 rounded-lg text-xs bg-primary-500/20 text-primary-300 hover:bg-primary-500/30 transition" title="Chat"><i class="fas fa-comment"></i></button>
              <button onclick="openMeetingModal(\${c.other_id}, '\${(c.other_name || '').replace(/'/g, "\\\\&apos;")}')" class="px-3 py-1.5 rounded-lg text-xs bg-green-500/20 text-green-300 hover:bg-green-500/30 transition" title="Schedule"><i class="fas fa-calendar-plus"></i></button>
            </div>
          </div>
        </div>
      \`).join('') : '<div class="glass rounded-xl p-6 text-center text-gray-500"><i class="fas fa-user-friends text-2xl mb-2 block opacity-30"></i><p class="text-sm">No connections yet</p><button onclick="switchTab(\\\'networking\\\')" class="mt-2 text-primary-400 text-xs hover:underline font-medium">Start networking &rarr;</button></div>';
    }

    function renderMyMeetingsList(meetings) {
      document.getElementById('my-meetings-list').innerHTML = meetings.length ? meetings.map(m => {
        const isReq = m.requester_id == currentUser.id;
        const otherN = isReq ? m.requestee_name : m.requester_name;
        const otherC = isReq ? m.requestee_company : m.requester_company;
        return \`
          <div class="glass rounded-xl p-4 card-hover">
            <div class="flex items-start gap-3">
              <div class="w-10 h-10 rounded-xl \${m.status === 'accepted' ? 'bg-green-500/20' : 'bg-yellow-500/20'} flex items-center justify-center shrink-0">
                <i class="fas \${m.status === 'accepted' ? 'fa-calendar-check text-green-400' : 'fa-clock text-yellow-400'}"></i>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <h4 class="font-semibold text-sm truncate">\${m.title || 'Meeting'}</h4>
                  <span class="px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 \${m.status === 'accepted' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}">\${m.status}</span>
                </div>
                <p class="text-xs text-gray-400">with \${otherN}\${otherC ? ' &middot; ' + otherC : ''}</p>
                <p class="text-xs text-gray-500 mt-1"><i class="fas fa-clock mr-1"></i>\${new Date(m.meeting_time).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})} &middot; \${m.duration_minutes}min\${m.location ? ' &middot; <i class="fas fa-map-pin ml-1 mr-1"></i>' + m.location : ''}</p>
              </div>
            </div>
          </div>
        \`;
      }).join('') : '<div class="glass rounded-xl p-6 text-center text-gray-500"><i class="fas fa-calendar-times text-2xl mb-2 block opacity-30"></i><p class="text-sm">No upcoming meetings</p><button onclick="switchTab(\\\'networking\\\')" class="mt-2 text-primary-400 text-xs hover:underline font-medium">Schedule one &rarr;</button></div>';
    }

    function renderMyBoothsList(booths) {
      document.getElementById('my-booths-list').innerHTML = booths.length ? booths.map(bv => \`
        <div class="glass rounded-xl p-4 card-hover">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-accent-500/20 flex items-center justify-center shrink-0">
              <i class="fas fa-store text-accent-400"></i>
            </div>
            <div class="flex-1 min-w-0">
              <h4 class="font-semibold text-sm truncate">\${bv.company_name}</h4>
              <p class="text-xs text-gray-500">Booth \${bv.booth_number}\${bv.category ? ' &middot; ' + bv.category : ''}</p>
            </div>
            <span class="text-[10px] text-gray-500 shrink-0">\${new Date(bv.visited_at).toLocaleDateString([], {month:'short',day:'numeric'})}</span>
          </div>
        </div>
      \`).join('') : '<div class="glass rounded-xl p-6 text-center text-gray-500"><i class="fas fa-store-slash text-2xl mb-2 block opacity-30"></i><p class="text-sm">No booths visited yet</p><button onclick="switchTab(\\\'exhibition\\\')" class="mt-2 text-primary-400 text-xs hover:underline font-medium">Explore expo &rarr;</button></div>';
    }

    // ---- Full Connections List ----
    function renderAllConnections(connections) {
      const accepted = connections.filter(c => c.status === 'accepted');
      const pending = connections.filter(c => c.status === 'pending');
      const el = document.getElementById('my-all-connections-list');

      let html = '';
      if (pending.length > 0) {
        html += '<h4 class="text-sm font-semibold text-yellow-400 mb-2"><i class="fas fa-clock mr-1.5"></i>Pending (' + pending.length + ')</h4>';
        html += pending.map(c => {
          const isIncoming = c.to_attendee_id == currentUser.id;
          return \`
            <div class="glass rounded-xl p-4 card-hover mb-3 border-l-2 border-yellow-500/50">
              <div class="flex items-center gap-3">
                <div class="relative">
                  <img src="\${getAvatarUrl(c.other_email, c.other_name, 80, c.other_avatar)}" alt="\${c.other_name}" class="w-10 h-10 rounded-full object-cover">
                  <span class="\${c.other_online ? 'online-dot' : 'offline-dot'} absolute -bottom-0.5 -right-0.5 border-2 border-dark-900"></span>
                </div>
                <div class="flex-1 min-w-0">
                  <h4 class="font-semibold text-sm">\${c.other_name}</h4>
                  <p class="text-xs text-gray-500">\${c.other_company || ''}\${c.other_job_title ? ' &middot; ' + c.other_job_title : ''}</p>
                  \${c.message ? \`<p class="text-xs text-gray-400 mt-1 italic">"\${c.message}"</p>\` : ''}
                </div>
                \${isIncoming ? \`
                  <div class="flex gap-1.5">
                    <button onclick="acceptConnection(\${c.id})" class="px-3 py-1.5 rounded-lg text-xs bg-green-500/20 text-green-400 hover:bg-green-500/30 transition"><i class="fas fa-check mr-1"></i>Accept</button>
                    <button onclick="declineConnection(\${c.id})" class="px-2 py-1.5 rounded-lg text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 transition"><i class="fas fa-times"></i></button>
                  </div>
                \` : '<span class="text-[10px] text-yellow-400 shrink-0">Sent</span>'}
              </div>
            </div>
          \`;
        }).join('');
      }

      if (accepted.length > 0) {
        html += '<h4 class="text-sm font-semibold text-green-400 mb-2 mt-4"><i class="fas fa-check-circle mr-1.5"></i>Connected (' + accepted.length + ')</h4>';
        html += accepted.map(c => \`
          <div class="glass rounded-xl p-4 card-hover mb-3">
            <div class="flex items-center gap-3">
              <div class="relative">
                <img src="\${getAvatarUrl(c.other_email, c.other_name, 80, c.other_avatar)}" alt="\${c.other_name}" class="w-10 h-10 rounded-full object-cover">
                <span class="\${c.other_online ? 'online-dot' : 'offline-dot'} absolute -bottom-0.5 -right-0.5 border-2 border-dark-900"></span>
              </div>
              <div class="flex-1 min-w-0">
                <h4 class="font-semibold text-sm">\${c.other_name}</h4>
                <p class="text-xs text-gray-500">\${c.other_company || ''}\${c.other_job_title ? ' &middot; ' + c.other_job_title : ''}</p>
              </div>
              <div class="flex gap-1.5">
                <button onclick="openChat(\${c.other_id}, '\${(c.other_name || '').replace(/'/g, "\\\\&apos;")}', '\${(c.other_company || '').replace(/'/g, "\\\\&apos;")}')" class="px-3 py-1.5 rounded-lg text-xs bg-primary-500/20 text-primary-300 hover:bg-primary-500/30 transition" title="Chat"><i class="fas fa-comment"></i></button>
                <button onclick="openMeetingModal(\${c.other_id}, '\${(c.other_name || '').replace(/'/g, "\\\\&apos;")}')" class="px-3 py-1.5 rounded-lg text-xs bg-green-500/20 text-green-300 hover:bg-green-500/30 transition" title="Schedule"><i class="fas fa-calendar-plus"></i></button>
              </div>
            </div>
          </div>
        \`).join('');
      }

      if (!html) {
        html = '<div class="glass rounded-xl p-8 text-center text-gray-500"><i class="fas fa-user-friends text-3xl mb-3 block opacity-30"></i><p>No connections yet.</p><button onclick="switchTab(\\\'networking\\\')" class="mt-3 px-4 py-2 rounded-xl text-sm bg-primary-600 hover:bg-primary-500 text-white transition">Browse Attendees</button></div>';
      }
      el.innerHTML = html;
    }

    function filterMyConnections(query) {
      const q = query.toLowerCase();
      const filtered = q ? myAllConnections.filter(c => 
        (c.other_name || '').toLowerCase().includes(q) || 
        (c.other_company || '').toLowerCase().includes(q) ||
        (c.other_job_title || '').toLowerCase().includes(q)
      ) : myAllConnections;
      renderAllConnections(filtered);
    }

    async function acceptConnection(connId) {
      try {
        await api.put(\`/api/connections/\${connId}\`, { status: 'accepted' });
        showToast('Connection accepted!', 'success');
        loadMyProfile();
      } catch(e) { showToast('Failed to accept', 'error'); }
    }

    async function declineConnection(connId) {
      try {
        await api.put(\`/api/connections/\${connId}\`, { status: 'declined' });
        showToast('Connection declined', 'info');
        loadMyProfile();
      } catch(e) { showToast('Failed to decline', 'error'); }
    }

    // ---- Full Meetings List ----
    function renderAllMeetings(meetings, filter = 'all') {
      const filtered = filter === 'all' ? meetings : meetings.filter(m => m.status === filter);
      const el = document.getElementById('my-all-meetings-list');

      el.innerHTML = filtered.length ? filtered.map(m => {
        const isReq = m.requester_id == currentUser.id;
        const otherN = isReq ? m.requestee_name : m.requester_name;
        const otherC = isReq ? m.requestee_company : m.requester_company;
        const isPending = m.status === 'pending';
        const isIncoming = !isReq && isPending;

        return \`
          <div class="glass rounded-xl p-4 card-hover \${isPending ? 'border-l-2 border-yellow-500/50' : m.status === 'accepted' ? 'border-l-2 border-green-500/50' : ''}">
            <div class="flex items-start gap-3">
              <div class="w-10 h-10 rounded-xl \${m.status === 'accepted' ? 'bg-green-500/20' : m.status === 'pending' ? 'bg-yellow-500/20' : 'bg-red-500/20'} flex items-center justify-center shrink-0">
                <i class="fas \${m.status === 'accepted' ? 'fa-calendar-check text-green-400' : m.status === 'pending' ? 'fa-clock text-yellow-400' : 'fa-calendar-times text-red-400'}"></i>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <h4 class="font-semibold text-sm">\${m.title || 'Meeting'}</h4>
                  <span class="px-1.5 py-0.5 rounded text-[10px] font-medium \${m.status === 'accepted' ? 'bg-green-500/20 text-green-400' : m.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'}">\${m.status}</span>
                </div>
                <p class="text-xs text-gray-400 mt-0.5">with <span class="text-white">\${otherN}</span>\${otherC ? ' &middot; ' + otherC : ''}</p>
                <p class="text-xs text-gray-500 mt-1">
                  <i class="fas fa-clock mr-1"></i>\${new Date(m.meeting_time).toLocaleString([], {weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}
                  &middot; \${m.duration_minutes}min
                  \${m.location ? '&middot; <i class="fas fa-map-pin ml-1 mr-1"></i>' + m.location : ''}
                </p>
                \${m.notes ? \`<p class="text-[10px] text-gray-500 mt-1"><i class="fas fa-sticky-note mr-1"></i>\${m.notes}</p>\` : ''}
              </div>
              \${isIncoming ? \`
                <div class="flex flex-col gap-1.5 shrink-0">
                  <button onclick="respondMeeting(\${m.id}, 'accepted')" class="px-3 py-1.5 rounded-lg text-xs bg-green-500/20 text-green-400 hover:bg-green-500/30 transition"><i class="fas fa-check mr-1"></i>Accept</button>
                  <button onclick="respondMeeting(\${m.id}, 'declined')" class="px-2 py-1.5 rounded-lg text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 transition"><i class="fas fa-times mr-1"></i>Decline</button>
                </div>
              \` : ''}
            </div>
          </div>
        \`;
      }).join('') : '<div class="glass rounded-xl p-8 text-center text-gray-500"><i class="fas fa-calendar-alt text-3xl mb-3 block opacity-30"></i><p>No ' + (filter === 'all' ? '' : filter + ' ') + 'meetings found.</p></div>';
    }

    function filterMyMeetings(filter) {
      document.querySelectorAll('.meeting-filter').forEach(b => {
        b.classList.remove('tab-active');
        b.classList.add('text-gray-400');
      });
      document.querySelector(\`[data-mfilter="\${filter}"]\`).classList.add('tab-active');
      document.querySelector(\`[data-mfilter="\${filter}"]\`).classList.remove('text-gray-400');
      renderAllMeetings(myAllMeetings, filter);
    }

    async function respondMeeting(meetingId, status) {
      try {
        await api.put(\`/api/meetings/\${meetingId}\`, { status });
        showToast(\`Meeting \${status}!\`, 'success');
        loadMyProfile();
      } catch(e) { showToast('Failed to update meeting', 'error'); }
    }

    // ---- Activity Timeline ----
    function buildActivityTimeline(data, connections, meetings) {
      const timeline = [];

      // Add connections as timeline events
      (connections || []).forEach(c => {
        const isFrom = c.from_attendee_id == currentUser.id;
        timeline.push({
          time: c.created_at,
          icon: c.status === 'accepted' ? 'fa-handshake' : 'fa-user-plus',
          color: c.status === 'accepted' ? '#22c55e' : '#ff9800',
          title: c.status === 'accepted' 
            ? \`Connected with \${c.other_name}\` 
            : (isFrom ? \`Sent request to \${c.other_name}\` : \`Received request from \${c.other_name}\`),
          subtitle: c.other_company || '',
          type: 'connection'
        });
      });

      // Add meetings
      (meetings || []).forEach(m => {
        const isReq = m.requester_id == currentUser.id;
        const otherN = isReq ? m.requestee_name : m.requester_name;
        timeline.push({
          time: m.created_at,
          icon: 'fa-calendar-plus',
          color: '#748ffc',
          title: \`Meeting scheduled with \${otherN}\`,
          subtitle: m.title || '',
          type: 'meeting'
        });
      });

      // Add booth visits
      (data.visitedBooths || []).forEach(bv => {
        timeline.push({
          time: bv.visited_at,
          icon: 'fa-store',
          color: '#ff9800',
          title: \`Visited \${bv.company_name} booth\`,
          subtitle: \`Booth \${bv.booth_number}\`,
          type: 'booth'
        });
      });

      // Sort by time desc
      timeline.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

      const el = document.getElementById('my-activity-timeline');
      el.innerHTML = timeline.length ? timeline.map((item, i) => \`
        <div class="relative \${i < timeline.length - 1 ? 'pb-4' : ''}">
          \${i < timeline.length - 1 ? '<div class="timeline-line"></div>' : ''}
          <div class="flex items-start gap-4">
            <div class="w-10 h-10 rounded-full flex items-center justify-center shrink-0 z-10" style="background: \${item.color}20">
              <i class="fas \${item.icon}" style="color: \${item.color}; font-size: 14px;"></i>
            </div>
            <div class="flex-1 glass rounded-xl p-4">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <h4 class="text-sm font-semibold">\${item.title}</h4>
                  \${item.subtitle ? \`<p class="text-xs text-gray-500">\${item.subtitle}</p>\` : ''}
                </div>
                <span class="text-[10px] text-gray-600 shrink-0 whitespace-nowrap">\${timeAgo(item.time)}</span>
              </div>
            </div>
          </div>
        </div>
      \`).join('') : '<div class="glass rounded-xl p-8 text-center text-gray-500"><i class="fas fa-stream text-3xl mb-3 block opacity-30"></i><p>No activity yet. Start networking to build your timeline!</p></div>';
    }

    function timeAgo(dateStr) {
      if (!dateStr) return '';
      const now = new Date();
      const then = new Date(dateStr);
      const diffMs = now.getTime() - then.getTime();
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) return 'just now';
      if (diffMin < 60) return diffMin + 'm ago';
      const diffHr = Math.floor(diffMin / 60);
      if (diffHr < 24) return diffHr + 'h ago';
      const diffDays = Math.floor(diffHr / 24);
      if (diffDays < 7) return diffDays + 'd ago';
      return then.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }

    // ---- Profile Sub-tab Switching ----
    function switchProfileSubtab(subtab) {
      document.querySelectorAll('.profile-subtab').forEach(b => {
        b.classList.remove('tab-active');
        b.classList.add('text-gray-400');
      });
      document.querySelector(\`[data-subtab="\${subtab}"]\`).classList.add('tab-active');
      document.querySelector(\`[data-subtab="\${subtab}"]\`).classList.remove('text-gray-400');
      document.querySelectorAll('.profile-subtab-content').forEach(c => c.classList.add('hidden'));
      document.getElementById(\`profile-subtab-\${subtab}\`).classList.remove('hidden');
    }

    // Arrival Time Prompt
    function showArrivalTimePrompt() {
      // Remove existing overlay if any
      const existing = document.getElementById('arrival-prompt-overlay');
      if (existing) existing.remove();

      const currentVal = currentUser ? (currentUser.arrival_time || '') : '';
      const headingText = currentVal ? 'Update Your Arrival Time' : 'Enter Your Arrival Time at WTC Mumbai';
      const descText = currentVal 
        ? 'You can change your expected arrival time below.'
        : 'To help us plan the event logistics, kindly share your expected arrival time at the event venue.';

      // Create overlay
      const overlay = document.createElement('div');
      overlay.id = 'arrival-prompt-overlay';
      overlay.className = 'fixed inset-0 z-50 modal-overlay flex items-center justify-center p-4';

      const timeOptions = [
        ['', '-- Select your arrival time --'],
        ['09:00', '9:00 AM'], ['09:30', '9:30 AM'],
        ['10:00', '10:00 AM (Inauguration)'], ['10:30', '10:30 AM'],
        ['11:00', '11:00 AM'], ['11:30', '11:30 AM'],
        ['12:00', '12:00 PM'], ['12:30', '12:30 PM'],
        ['13:00', '1:00 PM'], ['13:30', '1:30 PM'],
        ['14:00', '2:00 PM'], ['14:30', '2:30 PM'],
        ['15:00', '3:00 PM'], ['15:30', '3:30 PM'],
        ['16:00', '4:00 PM'],
      ];
      const optionsHtml = timeOptions.map(([val, label]) => 
        \`<option value="\${val}" \${val === currentVal ? 'selected' : ''}>\${label}</option>\`
      ).join('');

      overlay.innerHTML = \`
        <div class="glass rounded-2xl max-w-md w-full p-6 shadow-2xl border border-white/10">
          <div class="text-center mb-5">
            <div class="w-16 h-16 rounded-full bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center mx-auto mb-3">
              <i class="fas fa-clock text-2xl text-amber-400"></i>
            </div>
            <h3 class="text-xl font-bold mb-1">\${headingText}</h3>
            <p class="text-sm text-gray-400">\${descText}</p>
          </div>
          <div class="mb-5">
            <select id="arrival-prompt-select" class="w-full px-4 py-3 rounded-xl text-sm bg-white/5 border border-white/10 text-white">
              \${optionsHtml}
            </select>
          </div>
          <div class="flex gap-3">
            <button onclick="submitArrivalTime()" class="flex-1 py-3 rounded-xl text-sm font-semibold bg-gradient-to-r from-primary-600 to-primary-500 text-white hover:from-primary-500 hover:to-primary-400 transition">
              <i class="fas fa-check mr-2"></i>Save Arrival Time
            </button>
            <button onclick="dismissArrivalPrompt()" class="px-4 py-3 rounded-xl text-sm font-medium text-gray-400 hover:text-white glass-light transition">
              \${currentVal ? 'Cancel' : 'Later'}
            </button>
          </div>
        </div>
      \`;
      document.body.appendChild(overlay);
    }

    async function submitArrivalTime() {
      const val = document.getElementById('arrival-prompt-select').value;
      if (!val) { showToast('Please select an arrival time', 'error'); return; }
      try {
        await api.put(\`/api/attendees/\${currentUser.id}/profile\`, { ...currentUser, arrival_time: val });
        currentUser.arrival_time = val;
        localStorage.setItem('agba_user', JSON.stringify(currentUser));
        dismissArrivalPrompt();
        updateArrivalCard();
        showToast('Arrival time saved! Thank you.', 'success');
      } catch(e) { showToast('Failed to save. Please try again.', 'error'); }
    }

    function dismissArrivalPrompt() {
      const el = document.getElementById('arrival-prompt-overlay');
      if (el) el.remove();
    }

    // Edit Profile
    function openEditProfile() {
      if (!currentUser) return;
      document.getElementById('edit-name').value = currentUser.name || '';
      document.getElementById('edit-company').value = currentUser.company || '';
      document.getElementById('edit-jobtitle').value = currentUser.job_title || '';
      document.getElementById('edit-bio').value = currentUser.bio || '';
      document.getElementById('edit-interests').value = currentUser.interests || '';
      document.getElementById('edit-linkedin').value = currentUser.linkedin_url || '';
      document.getElementById('edit-mobile').value = currentUser.mobile || '';
      document.getElementById('edit-lunch').value = currentUser.lunch_inclusion || 'Yes';
      document.getElementById('edit-arrival').value = currentUser.arrival_time || '';
      document.getElementById('edit-twitter').value = currentUser.twitter_url || '';
      document.getElementById('edit-website').value = currentUser.website_url || '';
      // Avatar preview
      document.getElementById('edit-avatar-preview').src = getAvatarUrl(currentUser.email, currentUser.name, 128, currentUser.avatar_url);
      document.getElementById('remove-avatar-btn').classList.toggle('hidden', !currentUser.avatar_url || !currentUser.avatar_url.startsWith('data:image/'));
      document.getElementById('edit-profile-modal').classList.remove('hidden');
    }

    function closeEditProfile() {
      document.getElementById('edit-profile-modal').classList.add('hidden');
    }

    async function handleProfilePhotoSelect(input) {
      if (!input.files || !input.files[0]) return;
      const file = input.files[0];
      if (file.size > 5 * 1024 * 1024) {
        toast('Image too large. Max 5MB.', true);
        return;
      }
      try {
        const dataUrl = await resizeImage(file, 256, 0.8);
        document.getElementById('edit-avatar-preview').src = dataUrl;
        // Upload immediately
        const result = await api.post('/api/attendees/' + currentUser.id + '/avatar', { image: dataUrl });
        if (result.success) {
          currentUser.avatar_url = dataUrl;
          localStorage.setItem('tc_user', JSON.stringify(currentUser));
          document.getElementById('remove-avatar-btn').classList.remove('hidden');
          toast('Photo uploaded!');
        }
      } catch(e) {
        toast('Failed to upload photo: ' + (e.message || 'Unknown error'), true);
      }
      input.value = '';
    }

    async function removeProfilePhoto() {
      if (!confirm('Remove your profile photo?')) return;
      try {
        await fetch('/api/attendees/' + currentUser.id + '/avatar', { method: 'DELETE' }).then(r => r.json());
        currentUser.avatar_url = null;
        localStorage.setItem('tc_user', JSON.stringify(currentUser));
        document.getElementById('edit-avatar-preview').src = getAvatarUrl(currentUser.email, currentUser.name, 128);
        document.getElementById('remove-avatar-btn').classList.add('hidden');
        toast('Photo removed');
      } catch(e) {
        toast('Failed to remove photo', true);
      }
    }

    async function openEditMyBooth() {
      if (!currentUser) return;
      let booth = null;
      try { booth = await api.get(\`/api/attendees/\${currentUser.id}/exhibitor\`); } catch(e) {}
      const b = booth || {};
      const mc = document.getElementById('modal-container');
      const mb = document.getElementById('modal-box');
      mb.innerHTML = \`
        <form id="edit-booth-form" class="flex flex-col max-h-[90vh]">
          <div class="p-6 pb-3 border-b border-white/10 shrink-0">
            <h3 class="text-lg font-bold"><i class="fas fa-store text-accent-400 mr-2"></i>\${b.id ? 'Edit' : 'Create'} My Booth</h3>
          </div>
          <div class="flex-1 overflow-y-auto p-6 space-y-3 scroll-hide">
            <div class="grid grid-cols-2 gap-3">
              <div><label class="text-xs text-gray-400 mb-1 block">Company Name *</label><input id="mb-name" value="\${b.company_name || currentUser.company || ''}" required class="w-full px-3 py-2 rounded-lg text-sm"></div>
              <div><label class="text-xs text-gray-400 mb-1 block">Category</label><input id="mb-cat" value="\${b.category || ''}" placeholder="e.g. AI & ML, Fintech" class="w-full px-3 py-2 rounded-lg text-sm"></div>
            </div>
            <div><label class="text-xs text-gray-400 mb-1 block">Description</label><textarea id="mb-desc" rows="3" class="w-full px-3 py-2 rounded-lg text-sm" placeholder="Describe your company and what you're exhibiting...">\${b.description || ''}</textarea></div>
            <div class="grid grid-cols-3 gap-3">
              <div><label class="text-xs text-gray-400 mb-1 block">Booth #</label><input id="mb-booth" value="\${b.booth_number || ''}" class="w-full px-3 py-2 rounded-lg text-sm" placeholder="e.g. A-101"></div>
              <div><label class="text-xs text-gray-400 mb-1 block">Booth Size</label>
                <select id="mb-size" class="w-full px-3 py-2 rounded-lg text-sm">
                  \${['standard','premium','platinum'].map(s=>'<option '+(b.booth_size===s?'selected':'')+'>'+s+'</option>').join('')}
                </select>
              </div>
              <div><label class="text-xs text-gray-400 mb-1 block">Website</label><input id="mb-web" value="\${b.website_url || ''}" class="w-full px-3 py-2 rounded-lg text-sm" placeholder="https://..."></div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div><label class="text-xs text-gray-400 mb-1 block">Contact Email</label><input id="mb-email" value="\${b.contact_email || currentUser.email || ''}" class="w-full px-3 py-2 rounded-lg text-sm"></div>
              <div><label class="text-xs text-gray-400 mb-1 block">Contact Phone</label><input id="mb-phone" value="\${b.contact_phone || currentUser.mobile || ''}" class="w-full px-3 py-2 rounded-lg text-sm"></div>
            </div>
            <div><label class="text-xs text-gray-400 mb-1 block">Products / Services (comma-separated)</label><input id="mb-products" value="\${b.products || ''}" class="w-full px-3 py-2 rounded-lg text-sm" placeholder="e.g. AI Platform, Data Analytics, Cloud Services"></div>
          </div>
          <div class="p-6 pt-3 border-t border-white/10 shrink-0 flex gap-2">
            <button type="submit" class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-accent-600 hover:bg-accent-500 text-white"><i class="fas fa-save mr-1"></i>\${b.id ? 'Save Changes' : 'Create Booth'}</button>
            <button type="button" onclick="document.getElementById('modal-container').classList.add('hidden')" class="px-4 py-2.5 rounded-xl text-sm font-medium glass hover:bg-white/10">Cancel</button>
          </div>
        </form>
      \`;
      mc.classList.remove('hidden');
      document.getElementById('edit-booth-form').onsubmit = async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type=submit]');
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Saving...';
        btn.disabled = true;
        try {
          await api.put(\`/api/attendees/\${currentUser.id}/exhibitor\`, {
            company_name: document.getElementById('mb-name').value,
            description: document.getElementById('mb-desc').value,
            booth_number: document.getElementById('mb-booth').value,
            booth_size: document.getElementById('mb-size').value,
            category: document.getElementById('mb-cat').value,
            website_url: document.getElementById('mb-web').value,
            contact_email: document.getElementById('mb-email').value,
            contact_phone: document.getElementById('mb-phone').value,
            products: document.getElementById('mb-products').value,
          });
          mc.classList.add('hidden');
          showToast('Booth updated successfully!', 'success');
          loadMyProfile();
        } catch(err) {
          showToast(err.message || 'Failed to update booth', 'error');
        } finally {
          btn.innerHTML = '<i class="fas fa-save mr-1"></i>Save Changes';
          btn.disabled = false;
        }
      };
    }

    document.getElementById('edit-profile-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentUser) return;
      const btn = e.target.querySelector('button[type=submit]');
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...';
      btn.disabled = true;

      try {
        const updated = await api.put(\`/api/attendees/\${currentUser.id}/profile\`, {
          name: document.getElementById('edit-name').value,
          company: document.getElementById('edit-company').value,
          job_title: document.getElementById('edit-jobtitle').value,
          bio: document.getElementById('edit-bio').value,
          interests: document.getElementById('edit-interests').value,
          linkedin_url: document.getElementById('edit-linkedin').value,
          mobile: document.getElementById('edit-mobile').value,
          lunch_inclusion: document.getElementById('edit-lunch').value,
          arrival_time: document.getElementById('edit-arrival').value,
          twitter_url: document.getElementById('edit-twitter').value,
          website_url: document.getElementById('edit-website').value,
        });
        currentUser = updated;
        localStorage.setItem('agba_user', JSON.stringify(currentUser));
        closeEditProfile();
        showToast('Profile updated!', 'success');
        loadMyProfile();
      } catch(err) {
        showToast('Failed to update profile', 'error');
      } finally {
        btn.innerHTML = '<i class="fas fa-save mr-2"></i>Save Changes';
        btn.disabled = false;
      }
    });

    function logoutUser() {
      localStorage.removeItem('agba_user');
      currentUser = null;
      location.reload();
    }

    // Toast notification
    function showToast(msg, type = 'info') {
      const colors = { success: 'bg-green-500', error: 'bg-red-500', warning: 'bg-yellow-500', info: 'bg-primary-500' };
      const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };
      const toast = document.createElement('div');
      toast.className = \`fixed top-4 right-4 z-50 \${colors[type]} text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 text-sm transition-all transform translate-x-full\`;
      toast.innerHTML = \`<i class="fas \${icons[type]}"></i>\${msg}\`;
      document.body.appendChild(toast);
      setTimeout(() => toast.classList.remove('translate-x-full'), 10);
      setTimeout(() => { toast.classList.add('translate-x-full'); setTimeout(() => toast.remove(), 300); }, 3000);
    }

    // ==================== PAID PASS MODAL ====================
    function openPaidPassForm() {
      document.getElementById('paid-pass-modal').classList.remove('hidden');
      document.getElementById('paid-pass-modal').classList.add('flex');
      document.body.style.overflow = 'hidden';
    }

    function closePaidPassModal() {
      document.getElementById('paid-pass-modal').classList.add('hidden');
      document.getElementById('paid-pass-modal').classList.remove('flex');
      document.body.style.overflow = '';
    }

    async function submitPaidPassForm(e) {
      e.preventDefault();
      const btn = document.getElementById('pp-submit-btn');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Processing...';

      const name     = document.getElementById('pp-name').value.trim();
      const email    = document.getElementById('pp-email').value.trim();
      const phone    = document.getElementById('pp-phone').value.trim();
      const company  = document.getElementById('pp-company').value.trim();
      const desig    = document.getElementById('pp-designation').value.trim();
      const city     = document.getElementById('pp-city').value.trim();
      const passType = document.getElementById('pp-pass-type').value;

      if (!name || !email || !passType) {
        showToast('Please fill in all required fields.', 'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-arrow-right mr-2"></i>Proceed to Payment';
        return;
      }

      // Register attendee first, then redirect to payment
      try {
        await fetch('/api/events/' + EVENT_ID + '/attendees/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name, email, mobile: phone, company,
            job_title: desig, city, bio: '', interests: '', linkedin_url: '',
            badge_type: passType
          })
        });
      } catch(_) { /* proceed even if registration fails */ }

      // Build URL with prefilled params for municampus
      const params = new URLSearchParams({
        name, email, phone, organization: company,
        designation: desig, city, pass_type: passType
      });

      showToast('Redirecting to payment gateway...', 'success');
      setTimeout(() => {
        window.open('https://municampus.com/event/BharatAI?' + params.toString(), '_blank');
        closePaidPassModal();
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-arrow-right mr-2"></i>Proceed to Payment';
      }, 800);
    }

    // Close modal on backdrop click — deferred until after DOM is fully parsed
    document.addEventListener('DOMContentLoaded', function() {
      const ppm = document.getElementById('paid-pass-modal');
      if (ppm) ppm.addEventListener('click', function(e) { if (e.target === this) closePaidPassModal(); });
      const rpm = document.getElementById('reg-paid-pass-modal');
      if (rpm) rpm.addEventListener('click', function(e) { if (e.target === this) closeRegisterPaidPassModal(); });
    });

    // Init
    init();
  </script>

  <!-- ===== PAID PASS MODAL ===== -->
  <div id="paid-pass-modal" class="fixed inset-0 z-50 modal-overlay hidden items-center justify-center p-4">
    <div class="glass rounded-2xl w-full max-w-lg relative overflow-hidden" style="border:1px solid rgba(99,102,241,0.3);">
      <!-- Header -->
      <div style="background:linear-gradient(135deg,#1e1b4b,#312e81);" class="p-5 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-indigo-500/30 flex items-center justify-center">
            <i class="fas fa-star text-yellow-300 text-lg"></i>
          </div>
          <div>
            <h2 class="font-bold text-white text-lg">Get Your Paid Pass</h2>
            <p class="text-indigo-300 text-xs">Fill in your details to proceed to payment</p>
          </div>
        </div>
        <button onclick="closePaidPassModal()" class="text-gray-400 hover:text-white transition text-xl w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <!-- Body -->
      <div class="p-6 overflow-y-auto" style="max-height:calc(90vh - 80px);">
        <!-- Pass Type Selector -->
        <div class="grid grid-cols-3 gap-2 mb-5">
          <label class="pass-option cursor-pointer">
            <input type="radio" name="pp-pass" value="Delegate Pass" class="hidden" onchange="document.getElementById('pp-pass-type').value=this.value;document.querySelectorAll('.pass-option').forEach(el=>el.classList.remove('ring-2','ring-indigo-400'));this.closest('.pass-option').classList.add('ring-2','ring-indigo-400')">
            <div class="p-3 rounded-xl text-center" style="background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.2);">
              <i class="fas fa-id-badge text-violet-400 text-lg mb-1 block"></i>
              <div class="text-white font-semibold text-xs">Delegate</div>
              <div class="text-violet-300 font-bold text-sm">&#8377;4,999</div>
              <div class="text-gray-500 text-[10px]">Full 2-day access</div>
            </div>
          </label>
          <label class="pass-option cursor-pointer">
            <input type="radio" name="pp-pass" value="VIP Pass" class="hidden" onchange="document.getElementById('pp-pass-type').value=this.value;document.querySelectorAll('.pass-option').forEach(el=>el.classList.remove('ring-2','ring-yellow-400'));this.closest('.pass-option').classList.add('ring-2','ring-yellow-400')">
            <div class="p-3 rounded-xl text-center" style="background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.2);">
              <i class="fas fa-crown text-yellow-400 text-lg mb-1 block"></i>
              <div class="text-white font-semibold text-xs">VIP</div>
              <div class="text-yellow-300 font-bold text-sm">&#8377;14,999</div>
              <div class="text-gray-500 text-[10px]">VIP lounge + dinner</div>
            </div>
          </label>
          <label class="pass-option cursor-pointer">
            <input type="radio" name="pp-pass" value="Academic Pass" class="hidden" onchange="document.getElementById('pp-pass-type').value=this.value;document.querySelectorAll('.pass-option').forEach(el=>el.classList.remove('ring-2','ring-purple-400'));this.closest('.pass-option').classList.add('ring-2','ring-purple-400')">
            <div class="p-3 rounded-xl text-center" style="background:rgba(192,132,252,0.08);border:1px solid rgba(192,132,252,0.2);">
              <i class="fas fa-graduation-cap text-purple-400 text-lg mb-1 block"></i>
              <div class="text-white font-semibold text-xs">Academic</div>
              <div class="text-purple-300 font-bold text-sm">&#8377;999</div>
              <div class="text-gray-500 text-[10px]">Students &amp; researchers</div>
            </div>
          </label>
        </div>
        <input type="hidden" id="pp-pass-type" value="">

        <form id="paid-pass-form" onsubmit="submitPaidPassForm(event)" class="space-y-3">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-xs text-gray-400 mb-1 block">Full Name <span class="text-red-400">*</span></label>
              <input type="text" id="pp-name" required placeholder="Your full name" class="w-full px-4 py-2.5 rounded-xl text-sm" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#e2e8f0;outline:none;">
            </div>
            <div>
              <label class="text-xs text-gray-400 mb-1 block">Email Address <span class="text-red-400">*</span></label>
              <input type="email" id="pp-email" required placeholder="you@email.com" class="w-full px-4 py-2.5 rounded-xl text-sm" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#e2e8f0;outline:none;">
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-xs text-gray-400 mb-1 block">Mobile Number</label>
              <input type="tel" id="pp-phone" placeholder="+91 XXXXX XXXXX" class="w-full px-4 py-2.5 rounded-xl text-sm" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#e2e8f0;outline:none;">
            </div>
            <div>
              <label class="text-xs text-gray-400 mb-1 block">Organization</label>
              <input type="text" id="pp-company" placeholder="Company / Institute" class="w-full px-4 py-2.5 rounded-xl text-sm" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#e2e8f0;outline:none;">
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-xs text-gray-400 mb-1 block">Designation</label>
              <input type="text" id="pp-designation" placeholder="Your designation" class="w-full px-4 py-2.5 rounded-xl text-sm" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#e2e8f0;outline:none;">
            </div>
            <div>
              <label class="text-xs text-gray-400 mb-1 block">City</label>
              <input type="text" id="pp-city" placeholder="Your city" class="w-full px-4 py-2.5 rounded-xl text-sm" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#e2e8f0;outline:none;">
            </div>
          </div>
          <button type="submit" id="pp-submit-btn" class="w-full py-3 rounded-xl font-bold text-white mt-2 transition-all" style="background:linear-gradient(135deg,#f97316,#ea580c);">
            <i class="fas fa-arrow-right mr-2"></i>Proceed to Payment
          </button>
          <p class="text-center text-[10px] text-gray-500">You will be redirected to our secure payment partner to complete your registration.</p>
        </form>
      </div>
    </div>
  </div>

</body>
</html>`
}

function adminPageHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Dashboard - Bharat AI Innovation 2026</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            primary: { 50:'#f0f4ff',100:'#dbe4ff',200:'#bac8ff',300:'#91a7ff',400:'#748ffc',500:'#5c7cfa',600:'#4c6ef5',700:'#4263eb',800:'#3b5bdb',900:'#364fc7' },
            accent: { 50:'#fff3e0',100:'#ffe0b2',200:'#ffcc80',300:'#ffb74d',400:'#ffa726',500:'#ff9800',600:'#fb8c00',700:'#f57c00',800:'#ef6c00',900:'#e65100' },
            dark: { 700:'#1e1e36', 800:'#1a1a2e', 900:'#0f0f23' }
          }
        }
      }
    }
  </script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
    * { font-family: 'Inter', sans-serif; }
    body { background: #0f0f23; color: #e2e8f0; }
    .glass { background: rgba(255,255,255,0.05); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.08); }
    .glass-light { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12); }
    .glow { box-shadow: 0 0 30px rgba(92,124,250,0.15); }
    .sidebar-active { background: linear-gradient(135deg, #4c6ef5, #3b5bdb); color: white; }
    .card-hover:hover { transform: translateY(-2px); box-shadow: 0 8px 30px rgba(92,124,250,0.15); }
    .card-hover { transition: all 0.3s ease; }
    /* Inline editable cells */
    .ie-cell { cursor: pointer; position: relative; transition: background 0.15s; border-radius: 4px; }
    .ie-cell:hover { background: rgba(255,255,255,0.06); }
    .ie-cell:hover::after { content: '\\f303'; font-family: 'Font Awesome 5 Free'; font-weight: 900; font-size: 8px; color: rgba(147,165,255,0.5); position: absolute; top: 2px; right: 2px; }
    /* Resizable columns */
    #attendee-table { table-layout: fixed; border-collapse: collapse; }
    #attendee-table th, #attendee-table td { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 6px 8px; }
    #attendee-table td.ie-cell:hover { white-space: normal; }
    #attendee-table th { position: relative; user-select: none; }
    #attendee-table th.sortable { cursor: pointer; }
    #attendee-table th.sortable:hover { color: #e2e8f0; background: rgba(255,255,255,0.04); }
    .sort-icon { font-size: 9px; margin-left: 3px; opacity: 0.3; }
    .sort-icon.active { opacity: 1; color: #818cf8; }
    .col-resizer { position: absolute; right: -3px; top: 0; width: 7px; height: 100%; cursor: col-resize; z-index: 10; background: rgba(100,116,139,0.2); border-radius: 2px; transition: background 0.15s; }
    .col-resizer:hover, .col-resizer.active { background: rgba(76,110,245,0.6); }
    #attendee-table th:hover .col-resizer { background: rgba(100,116,139,0.4); }
    .col-settings-dropdown { position: absolute; top: 100%; right: 0; z-index: 50; background: rgba(15,23,42,0.97); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 10px; width: 280px; max-height: 450px; overflow-y: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.5); backdrop-filter: blur(12px); }
    .col-settings-dropdown label { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 6px; cursor: pointer; font-size: 12px; color: #94a3b8; transition: background 0.15s; }
    .col-settings-dropdown label:hover { background: rgba(255,255,255,0.06); }
    .col-settings-dropdown input[type=checkbox] { accent-color: #4c6ef5; width: 14px; height: 14px; }
    .col-preset-btn { padding: 4px 10px; border-radius: 6px; font-size: 11px; cursor: pointer; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05); color: #94a3b8; transition: all 0.15s; }
    .col-preset-btn:hover, .col-preset-btn.active { background: rgba(76,110,245,0.2); border-color: rgba(76,110,245,0.4); color: #e2e8f0; }
    .att-col-hidden { display: none !important; }
    .dup-row { background: rgba(239,68,68,0.06) !important; }
    .dup-row:hover { background: rgba(239,68,68,0.12) !important; }
    .dup-badge { display: inline-block; font-size: 8px; padding: 1px 4px; border-radius: 4px; font-weight: 600; margin-left: 4px; vertical-align: middle; }
    /* Sidebar collapse */
    #sidebar { transition: width 0.3s cubic-bezier(0.4,0,0.2,1); overflow: hidden; }
    #sidebar.collapsed { width: 64px; }
    #sidebar.collapsed .sidebar-label,
    #sidebar.collapsed .sidebar-header-text,
    #sidebar.collapsed .sidebar-footer-text { opacity: 0; width: 0; overflow: hidden; white-space: nowrap; transition: opacity 0.15s ease, width 0.15s ease; }
    #sidebar:not(.collapsed) .sidebar-label,
    #sidebar:not(.collapsed) .sidebar-header-text,
    #sidebar:not(.collapsed) .sidebar-footer-text { opacity: 1; transition: opacity 0.2s ease 0.1s; }
    #sidebar.collapsed .sidebar-btn { justify-content: center; padding-left: 0; padding-right: 0; }
    #sidebar.collapsed .sidebar-btn i { margin: 0; }
    #sidebar.collapsed nav { padding: 8px; }
    #sidebar.collapsed .sidebar-header { justify-content: center; padding: 12px 8px; }
    #sidebar.collapsed .sidebar-header img { width: 32px; height: 32px; }
    #sidebar.collapsed .sidebar-footer { padding: 8px; align-items: center; }
    #sidebar.collapsed .sidebar-footer a,
    #sidebar.collapsed .sidebar-footer button { justify-content: center; padding-left: 0; padding-right: 0; }
    #sidebar.collapsed .sidebar-toggle-icon { transform: rotate(180deg); }
    .sidebar-toggle-icon { transition: transform 0.3s cubic-bezier(0.4,0,0.2,1); }
    #main-content { transition: margin-left 0.3s cubic-bezier(0.4,0,0.2,1); }
    #main-content.sidebar-collapsed { margin-left: 64px; }
    /* Tooltip for collapsed sidebar buttons */
    #sidebar.collapsed .sidebar-btn { position: relative; }
    #sidebar.collapsed .sidebar-btn::after { content: attr(title); position: absolute; left: 100%; top: 50%; transform: translateY(-50%); margin-left: 8px; padding: 4px 10px; background: #1e1e3a; color: #e2e8f0; font-size: 12px; border-radius: 6px; white-space: nowrap; opacity: 0; pointer-events: none; transition: opacity 0.2s ease; z-index: 100; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
    #sidebar.collapsed .sidebar-btn:hover::after { opacity: 1; }
    input, textarea, select { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); color: #e2e8f0; }
    input:focus, textarea:focus, select:focus { outline: none; border-color: #4c6ef5; box-shadow: 0 0 0 3px rgba(76,110,245,0.2); }
    select option { background: #1a1a2e; color: #e2e8f0; padding: 8px 12px; }
    select option:checked { background: #2d2d5e; }
    select option:hover { background: #252550; }
    select { -webkit-appearance: none; -moz-appearance: none; appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%239ca3af' d='M6 8L1 3h10z'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; padding-right: 32px; }
    .modal-overlay { background: rgba(0,0,0,0.7); backdrop-filter: blur(5px); }
    .scroll-hide { scrollbar-width: none; }
    .scroll-hide::-webkit-scrollbar { display: none; }
    .badge-pulse { animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
    table { border-collapse: separate; border-spacing: 0; }
    th { position: sticky; top: 0; z-index: 10; background: #1a1a2e; }
    tr:hover td { background: rgba(255,255,255,0.03); }
    td, th { padding: 10px 14px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.06); }
    .chart-container { position: relative; height: 220px; }
  </style>
</head>
<body class="min-h-screen flex">

  <!-- Login Overlay -->
  <div id="login-overlay" class="fixed inset-0 z-50 modal-overlay flex items-center justify-center">
    <div class="glass rounded-2xl p-8 w-full max-w-sm">
      <div class="text-center mb-6">
        <img src="https://bharataiinnovation.com/images/Bharat%20AI%20Innovation%20Logo.png" alt="BHAI" class="w-16 h-16 mx-auto mb-4 rounded-xl object-contain">
        <h2 class="text-xl font-bold">Admin Login</h2>
        <p class="text-gray-400 text-sm mt-1">Enter password to continue</p>
      </div>
      <form id="login-form">
        <div class="relative mb-4">
          <i class="fas fa-lock absolute left-4 top-1/2 -translate-y-1/2 text-gray-500"></i>
          <input type="password" id="admin-password" placeholder="Admin Password" class="w-full pl-11 pr-4 py-3 rounded-xl text-sm" autofocus>
        </div>
        <button type="submit" class="w-full py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-primary-600 to-primary-700 hover:from-primary-500 hover:to-primary-600 transition-all">
          <i class="fas fa-sign-in-alt mr-2"></i>Enter Dashboard
        </button>
        <p id="login-error" class="text-red-400 text-xs text-center mt-3 hidden">Incorrect password. Please try again.</p>
      </form>
    </div>
  </div>

  <!-- Sidebar -->
  <aside id="sidebar" class="hidden w-64 min-h-screen glass border-r border-white/10 flex-col shrink-0 fixed left-0 top-0 bottom-0 z-20 overflow-y-auto scroll-hide">
    <div class="sidebar-header p-5 border-b border-white/10 flex items-center gap-3">
      <img src="https://bharataiinnovation.com/images/Bharat%20AI%20Innovation%20Logo.png" alt="BHAI" class="w-10 h-10 rounded-lg object-contain shrink-0">
      <div class="sidebar-header-text flex-1 min-w-0">
        <h1 class="font-bold text-sm">BHAI</h1>
        <p class="text-[10px] text-gray-400">Admin Dashboard</p>
      </div>
      <button onclick="toggleSidebar()" class="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/10 transition text-gray-400 hover:text-white" title="Toggle sidebar">
        <i class="fas fa-chevron-left text-xs sidebar-toggle-icon transition-transform"></i>
      </button>
    </div>
    <nav class="p-3 flex-1 space-y-1">
      <button onclick="switchSection('overview')" class="sidebar-btn sidebar-active w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all" data-section="overview" title="Overview">
        <i class="fas fa-chart-pie w-5 text-center shrink-0"></i><span class="sidebar-label">Overview</span>
      </button>
      <button onclick="switchSection('attendees')" class="sidebar-btn w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-all" data-section="attendees" title="Attendees">
        <i class="fas fa-users w-5 text-center shrink-0"></i><span class="sidebar-label">Attendees</span>
      </button>
      <button onclick="switchSection('sessions')" class="sidebar-btn w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-all" data-section="sessions" title="Sessions">
        <i class="fas fa-calendar-alt w-5 text-center shrink-0"></i><span class="sidebar-label">Sessions</span>
      </button>
      <button onclick="switchSection('exhibitors')" class="sidebar-btn w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-all" data-section="exhibitors" title="Exhibitors">
        <i class="fas fa-store w-5 text-center shrink-0"></i><span class="sidebar-label">Exhibitors</span>
      </button>
      <button onclick="switchSection('booth-requests')" class="sidebar-btn w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-all" data-section="booth-requests" title="Booth Requests">
        <i class="fas fa-th-large w-5 text-center shrink-0"></i><span class="sidebar-label">Booth Requests</span>
      </button>
      <button onclick="switchSection('awards')" class="sidebar-btn w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-all" data-section="awards" title="Awards">
        <i class="fas fa-trophy w-5 text-center shrink-0"></i><span class="sidebar-label">Awards</span>
      </button>
      <button onclick="switchSection('announcements')" class="sidebar-btn w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-all" data-section="announcements" title="Announcements">
        <i class="fas fa-bullhorn w-5 text-center shrink-0"></i><span class="sidebar-label">Announcements</span>
      </button>
      <button onclick="switchSection('innovation')" class="sidebar-btn w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-all" data-section="innovation" title="Innovation Talks">
        <i class="fas fa-lightbulb w-5 text-center shrink-0"></i><span class="sidebar-label">Innovation Talks</span>
      </button>
      <button onclick="switchSection('startup-pitch')" class="sidebar-btn w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-all" data-section="startup-pitch" title="Startup Pitch">
        <i class="fas fa-rocket w-5 text-center shrink-0"></i><span class="sidebar-label">Startup Pitch</span>
      </button>
      <button onclick="switchSection('inquiries')" class="sidebar-btn w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-all" data-section="inquiries" title="Inquiries">
        <i class="fas fa-inbox w-5 text-center shrink-0"></i><span class="sidebar-label">Inquiries</span>
      </button>
      <button onclick="switchSection('analytics')" class="sidebar-btn w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-all" data-section="analytics" title="Analytics">
        <i class="fas fa-chart-bar w-5 text-center shrink-0"></i><span class="sidebar-label">Analytics</span>
      </button>
      <div class="border-t border-white/10 my-2"></div>
      <button onclick="switchSection('settings')" class="sidebar-btn w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-all" data-section="settings" title="Settings">
        <i class="fas fa-cog w-5 text-center shrink-0"></i><span class="sidebar-label">Settings</span>
      </button>
    </nav>
    <div class="sidebar-footer p-4 border-t border-white/10">
      <a href="/" class="flex items-center gap-2 text-xs text-gray-400 hover:text-white transition" title="View Public Site">
        <i class="fas fa-external-link-alt shrink-0"></i><span class="sidebar-footer-text">View Public Site</span>
      </a>
      <button onclick="adminLogout()" class="mt-2 flex items-center gap-2 text-xs text-red-400 hover:text-red-300 transition" title="Logout">
        <i class="fas fa-sign-out-alt shrink-0"></i><span class="sidebar-footer-text">Logout</span>
      </button>
    </div>
  </aside>

  <!-- Main Content -->
  <main id="main-content" class="hidden flex-1 ml-64">
    <!-- Top Bar -->
    <header class="sticky top-0 z-10 glass border-b border-white/10 px-6 py-3 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <button onclick="toggleSidebar()" class="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/10 transition text-gray-400 hover:text-white" title="Toggle sidebar">
          <i class="fas fa-bars text-sm"></i>
        </button>
        <div>
          <h2 id="page-title" class="text-lg font-bold">Overview</h2>
          <p id="page-subtitle" class="text-xs text-gray-400">Real-time event management dashboard</p>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <button onclick="refreshCurrentSection()" class="px-3 py-1.5 rounded-lg text-xs font-medium glass hover:bg-white/10 transition"><i class="fas fa-sync-alt mr-1"></i>Refresh</button>
        <span class="px-3 py-1.5 rounded-full text-xs font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30"><i class="fas fa-circle text-[6px] mr-1 badge-pulse"></i>Live</span>
      </div>
    </header>

    <!-- Content Sections -->
    <div class="p-6">
      <!-- Overview Section -->
      <div id="section-overview" class="section-content"></div>
      <!-- Attendees Section -->
      <div id="section-attendees" class="section-content hidden"></div>
      <!-- Sessions Section -->
      <div id="section-sessions" class="section-content hidden"></div>
      <!-- Exhibitors Section -->
      <div id="section-exhibitors" class="section-content hidden"></div>
      <div id="section-booth-requests" class="section-content hidden"></div>
      <!-- Awards Section -->
      <div id="section-awards" class="section-content hidden"></div>
      <!-- Announcements Section -->
      <div id="section-announcements" class="section-content hidden"></div>
      <!-- Innovation Talks Section -->
      <div id="section-innovation" class="section-content hidden"></div>
      <!-- Startup Pitch Section -->
      <div id="section-startup-pitch" class="section-content hidden"></div>
      <!-- Inquiries Section -->
      <div id="section-inquiries" class="section-content hidden"></div>
      <!-- Analytics Section -->
      <div id="section-analytics" class="section-content hidden"></div>
      <!-- Settings Section -->
      <div id="section-settings" class="section-content hidden"></div>
    </div>
  </main>

  <!-- Modal Container -->
  <div id="modal-container" class="fixed inset-0 z-40 modal-overlay hidden flex items-center justify-center p-4">
    <div id="modal-box" class="glass rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" style="scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.15) transparent;"></div>
  </div>

  <script>
    const EID = 1;
    let currentSection = 'overview';
    let chartInstances = {};

    function resizeImage(file, maxSize, quality) {
      return new Promise((resolve, reject) => {
        maxSize = maxSize || 256;
        quality = quality || 0.8;
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            let w = img.width, h = img.height;
            if (w > h) { if (w > maxSize) { h = h * maxSize / w; w = maxSize; } }
            else { if (h > maxSize) { w = w * maxSize / h; h = maxSize; } }
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', quality));
          };
          img.onerror = reject;
          img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    // ==================== AVATAR HELPERS ====================
    function md5(s){function L(k,d){return(k<<d)|(k>>>(32-d))}function K(G,k){var I,d,F,H,x;F=(G&2147483648);H=(k&2147483648);I=(G&1073741824);d=(k&1073741824);x=(G&1073741823)+(k&1073741823);if(I&d)return(x^2147483648^F^H);if(I|d){if(x&1073741824)return(x^3221225472^F^H);else return(x^1073741824^F^H)}else return(x^F^H)}function r(d,F,k){return(d&F)|((~d)&k)}function q(d,F,k){return(d&k)|(F&(~k))}function p(d,F,k){return(d^F^k)}function n(d,F,k){return(F^(d|(~k)))}function u(G,F,aa,Z,k,H,I){G=K(G,K(K(r(F,aa,Z),k),I));return K(L(G,H),F)}function f(G,F,aa,Z,k,H,I){G=K(G,K(K(q(F,aa,Z),k),I));return K(L(G,H),F)}function D(G,F,aa,Z,k,H,I){G=K(G,K(K(p(F,aa,Z),k),I));return K(L(G,H),F)}function t(G,F,aa,Z,k,H,I){G=K(G,K(K(n(F,aa,Z),k),I));return K(L(G,H),F)}function e(G){var Z;var F=G.length;var x=F+8;var k=(x-(x%64))/64;var I=(k+1)*16;var aa=Array(I-1);var d=0;var H=0;while(H<F){Z=(H-(H%4))/4;d=(H%4)*8;aa[Z]=(aa[Z]|(G.charCodeAt(H)<<d));H++}Z=(H-(H%4))/4;d=(H%4)*8;aa[Z]=aa[Z]|(128<<d);aa[I-2]=F<<3;aa[I-1]=F>>>29;return aa}function B(x){var k="",F="",G,d;for(d=0;d<=3;d++){G=(x>>>(d*8))&255;F="0"+G.toString(16);k=k+F.substr(F.length-2,2)}return k}var C=Array();var P,h,E,v,g,Y,X,W,V;var S=7,Q=12,N=17,M=22;var A=5,z=9,y=14,w=20;var o=4,m=11,l=16,j=23;var U=6,T=10,R=15,O=21;s=unescape(encodeURIComponent(s));C=e(s);Y=1732584193;X=4023233417;W=2562383102;V=271733878;for(P=0;P<C.length;P+=16){h=Y;E=X;v=W;g=V;Y=u(Y,X,W,V,C[P+0],S,3614090360);V=u(V,Y,X,W,C[P+1],Q,3905402710);W=u(W,V,Y,X,C[P+2],N,606105819);X=u(X,W,V,Y,C[P+3],M,3250441966);Y=u(Y,X,W,V,C[P+4],S,4118548399);V=u(V,Y,X,W,C[P+5],Q,1200080426);W=u(W,V,Y,X,C[P+6],N,2821735955);X=u(X,W,V,Y,C[P+7],M,4249261313);Y=u(Y,X,W,V,C[P+8],S,1770035416);V=u(V,Y,X,W,C[P+9],Q,2336552879);W=u(W,V,Y,X,C[P+10],N,4294925233);X=u(X,W,V,Y,C[P+11],M,2304563134);Y=u(Y,X,W,V,C[P+12],S,1804603682);V=u(V,Y,X,W,C[P+13],Q,4254626195);W=u(W,V,Y,X,C[P+14],N,2792965006);X=u(X,W,V,Y,C[P+15],M,1236535329);Y=f(Y,X,W,V,C[P+1],A,4129170786);V=f(V,Y,X,W,C[P+6],z,3225465664);W=f(W,V,Y,X,C[P+11],y,643717713);X=f(X,W,V,Y,C[P+0],w,3921069994);Y=f(Y,X,W,V,C[P+5],A,3593408605);V=f(V,Y,X,W,C[P+10],z,38016083);W=f(W,V,Y,X,C[P+15],y,3634488961);X=f(X,W,V,Y,C[P+4],w,3889429448);Y=f(Y,X,W,V,C[P+9],A,568446438);V=f(V,Y,X,W,C[P+14],z,3275163606);W=f(W,V,Y,X,C[P+3],y,4107603335);X=f(X,W,V,Y,C[P+8],w,1163531501);Y=f(Y,X,W,V,C[P+13],A,2850285829);V=f(V,Y,X,W,C[P+2],z,4243563512);W=f(W,V,Y,X,C[P+7],y,1735328473);X=f(X,W,V,Y,C[P+12],w,2368359562);Y=D(Y,X,W,V,C[P+5],o,4294588738);V=D(V,Y,X,W,C[P+8],m,2272392833);W=D(W,V,Y,X,C[P+11],l,1839030562);X=D(X,W,V,Y,C[P+14],j,4259657740);Y=D(Y,X,W,V,C[P+1],o,2763975236);V=D(V,Y,X,W,C[P+4],m,1272893353);W=D(W,V,Y,X,C[P+7],l,4139469664);X=D(X,W,V,Y,C[P+10],j,3200236656);Y=D(Y,X,W,V,C[P+13],o,681279174);V=D(V,Y,X,W,C[P+0],m,3936430074);W=D(W,V,Y,X,C[P+3],l,3572445317);X=D(X,W,V,Y,C[P+6],j,76029189);Y=D(Y,X,W,V,C[P+9],o,3654602809);V=D(V,Y,X,W,C[P+12],m,3873151461);W=D(W,V,Y,X,C[P+15],l,530742520);X=D(X,W,V,Y,C[P+2],j,3299628645);Y=t(Y,X,W,V,C[P+0],U,4096336452);V=t(V,Y,X,W,C[P+7],T,1126891415);W=t(W,V,Y,X,C[P+14],R,2878612391);X=t(X,W,V,Y,C[P+5],O,4237533241);Y=t(Y,X,W,V,C[P+12],U,1700485571);V=t(V,Y,X,W,C[P+3],T,2399980690);W=t(W,V,Y,X,C[P+10],R,4293915773);X=t(X,W,V,Y,C[P+1],O,2240044497);Y=t(Y,X,W,V,C[P+8],U,1873313359);V=t(V,Y,X,W,C[P+15],T,4264355552);W=t(W,V,Y,X,C[P+6],R,2734768916);X=t(X,W,V,Y,C[P+13],O,1309151649);Y=t(Y,X,W,V,C[P+4],U,4149444226);V=t(V,Y,X,W,C[P+11],T,3174756917);W=t(W,V,Y,X,C[P+2],R,718787259);X=t(X,W,V,Y,C[P+9],O,3951481745);Y=K(Y,h);X=K(X,E);W=K(W,v);V=K(V,g)}return(B(Y)+B(X)+B(W)+B(V)).toLowerCase()}

    function getAvatarUrl(email, name, size, avatarUrl) {
      if (avatarUrl && avatarUrl.startsWith('data:image/')) return avatarUrl;
      size = size || 80;
      const seed = (email || name || 'unknown').trim().toLowerCase();
      const colors = ['6366f1','8b5cf6','ec4899','f43f5e','f97316','eab308','22c55e','14b8a6','06b6d4','3b82f6','a855f7','e11d48','0ea5e9','10b981','f59e0b','84cc16'];
      let hashVal = 0;
      for (let i = 0; i < seed.length; i++) hashVal = ((hashVal << 5) - hashVal + seed.charCodeAt(i)) | 0;
      const bg = colors[Math.abs(hashVal) % colors.length];
      const fallback = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(name || '?') + '&size=' + size + '&background=' + bg + '&color=fff&bold=true&format=png';
      if (!email) return fallback;
      const hash = md5(email.trim().toLowerCase());
      return 'https://www.gravatar.com/avatar/' + hash + '?s=' + size + '&d=' + encodeURIComponent(fallback);
    }

    // The admin secret entered at login. Held in memory + sessionStorage and
    // attached as an Authorization Bearer header to every admin API call so
    // the server-side /api/admin/* guard accepts them.
    function getAdminToken() { return sessionStorage.getItem('tc_admin_token') || ''; }
    function authHeaders(extra) {
      const h = Object.assign({}, extra || {});
      const t = getAdminToken();
      if (t) h['Authorization'] = 'Bearer ' + t;
      return h;
    }
    // If any admin call comes back 401, the stored secret is stale/wrong —
    // drop it and send the user back to the login screen.
    function handleAuthFailure() {
      sessionStorage.removeItem('tc_admin_token');
      localStorage.removeItem('tc_admin');
      location.reload();
    }

    // CSV export is a file download, so it can't carry an Authorization header.
    // Pass the admin secret as ?token= instead (the server guard accepts it).
    function exportAttendeesCsv(ev) {
      if (ev) ev.preventDefault();
      const t = getAdminToken();
      if (!t) { handleAuthFailure(); return; }
      window.location.href = '/api/admin/events/' + EID + '/attendees/export?token=' + encodeURIComponent(t);
    }

    const api = {
      get: u => fetch(u,{headers:authHeaders()}).then(async r => { if (r.status===401){handleAuthFailure();throw new Error('unauthorized');} return r.json(); }),
      post: (u,d) => fetch(u,{method:'POST',headers:authHeaders({'Content-Type':'application/json'}),body:JSON.stringify(d)}).then(async r => { if (r.status===401){handleAuthFailure();throw new Error('unauthorized');} const j = await r.json(); if (!r.ok) throw Object.assign(new Error(j.error||'Request failed'), {data:j}); return j; }),
      put: (u,d) => fetch(u,{method:'PUT',headers:authHeaders({'Content-Type':'application/json'}),body:JSON.stringify(d)}).then(async r => { if (r.status===401){handleAuthFailure();throw new Error('unauthorized');} const j = await r.json(); if (!r.ok) throw Object.assign(new Error(j.error||'Request failed'), {data:j}); return j; }),
      del: u => fetch(u,{method:'DELETE',headers:authHeaders()}).then(async r => { if (r.status===401){handleAuthFailure();throw new Error('unauthorized');} return r.json(); }),
      patch: (u,d) => fetch(u,{method:'PATCH',headers:authHeaders({'Content-Type':'application/json'}),body:JSON.stringify(d)}).then(async r => { if (r.status===401){handleAuthFailure();throw new Error('unauthorized');} const j = await r.json(); if (!r.ok) throw Object.assign(new Error(j.error||'Request failed'), {data:j}); return j; }),
    };

    // ============ AUTH ============
    // The password IS the admin secret. We verify it server-side by calling a
    // guarded no-op endpoint with it as a bearer token: 200 = correct.
    // Nothing is trusted client-side — the secret never ships in this code.
    document.getElementById('login-form').addEventListener('submit', async e => {
      e.preventDefault();
      const err = document.getElementById('login-error');
      const btn = e.target.querySelector('button[type=submit]');
      const pw = document.getElementById('admin-password').value;
      err.classList.add('hidden');
      if (btn) btn.disabled = true;
      try {
        const r = await fetch('/api/admin/verify', { headers: { 'Authorization': 'Bearer ' + pw } });
        if (r.ok) {
          sessionStorage.setItem('tc_admin_token', pw);
          localStorage.setItem('tc_admin', '1');
          showDashboard();
        } else {
          err.classList.remove('hidden');
        }
      } catch (_) {
        err.classList.remove('hidden');
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    function showDashboard() {
      document.getElementById('login-overlay').classList.add('hidden');
      const sidebar = document.getElementById('sidebar');
      const main = document.getElementById('main-content');
      sidebar.classList.remove('hidden');
      sidebar.classList.add('flex');
      main.classList.remove('hidden');
      // Restore sidebar collapsed state
      if (localStorage.getItem('tc_sidebar_collapsed') === '1') {
        sidebar.classList.add('collapsed');
        main.classList.add('sidebar-collapsed');
      }
      loadOverview();
    }

    function toggleSidebar() {
      const sidebar = document.getElementById('sidebar');
      const main = document.getElementById('main-content');
      const isCollapsed = sidebar.classList.toggle('collapsed');
      if (isCollapsed) {
        main.classList.add('sidebar-collapsed');
      } else {
        main.classList.remove('sidebar-collapsed');
      }
      localStorage.setItem('tc_sidebar_collapsed', isCollapsed ? '1' : '0');
    }

    function adminLogout() {
      sessionStorage.removeItem('tc_admin_token');
      localStorage.removeItem('tc_admin');
      location.reload();
    }

    // Auto-resume the session only if we still hold the secret. The token is
    // in sessionStorage (cleared when the tab closes), so a fresh tab always
    // re-authenticates — the login form re-verifies it server-side.
    if (localStorage.getItem('tc_admin') === '1' && getAdminToken()) {
      showDashboard();
    } else {
      localStorage.removeItem('tc_admin');
    }

    // ============ NAVIGATION ============
    function switchSection(sec) {
      currentSection = sec;
      document.querySelectorAll('.sidebar-btn').forEach(b => {
        b.classList.remove('sidebar-active');
        b.classList.add('text-gray-400');
      });
      document.querySelector('[data-section="'+sec+'"]').classList.add('sidebar-active');
      document.querySelector('[data-section="'+sec+'"]').classList.remove('text-gray-400');
      document.querySelectorAll('.section-content').forEach(s => s.classList.add('hidden'));
      document.getElementById('section-'+sec).classList.remove('hidden');

      const titles = { overview:'Overview', attendees:'Attendee Management', sessions:'Session Management', exhibitors:'Exhibitor Management', 'booth-requests':'Booth Requests', awards:'Awards Management', announcements:'Announcement Management', innovation:'Innovation Talk & Showcase', 'startup-pitch':'Startup Pitch Management', inquiries:'Inquiry Management', analytics:'Analytics & Reports', settings:'Settings' };
      const subtitles = { overview:'Real-time event management dashboard', attendees:'Manage all registered attendees', sessions:'Create and manage event sessions', exhibitors:'Manage exhibition booths', 'booth-requests':'Review and manage booth booking requests', awards:'Manage award categories and nominees', announcements:'Create and manage live feed announcements', innovation:'Manage innovation talk and showcase schedule', 'startup-pitch':'Manage startup pitches and investor panel', inquiries:'View and manage all incoming inquiries', analytics:'Deep dive into event engagement metrics', settings:'Configure email, API keys and app settings' };
      document.getElementById('page-title').textContent = titles[sec] || sec;
      document.getElementById('page-subtitle').textContent = subtitles[sec] || '';

      refreshCurrentSection();
    }

    function refreshCurrentSection() {
      switch(currentSection) {
        case 'overview': loadOverview(); break;
        case 'attendees': loadAdminAttendees(); break;
        case 'sessions': loadAdminSessions(); break;
        case 'exhibitors': loadAdminExhibitors(); break;
        case 'booth-requests': loadAdminBoothRequests(); break;
        case 'awards': loadAdminAwards(); break;
        case 'announcements': loadAdminAnnouncements(); break;
        case 'analytics': loadAnalytics(); break;
        case 'innovation': loadInnovationTalks(); break;
        case 'startup-pitch': loadAdminStartupPitch(); break;
        case 'inquiries': loadAdminInquiries(); break;
        case 'settings': loadSettings(); break;
      }
    }

    // ============ BADGE CLASS HELPER ============
    function getBadgeClass(badge) {
      const b = (badge || '').toLowerCase();
      const classes = {
        'organiser': 'bg-indigo-500/20 text-indigo-300',
        'vip guest': 'bg-amber-500/20 text-amber-300',
        'exhibitor': 'bg-green-500/20 text-green-300',
        'delegate': 'bg-primary-500/20 text-primary-300',
        'exhibition speaker': 'bg-purple-500/20 text-purple-300',
        'jury': 'bg-rose-500/20 text-rose-300',
        'visitor pass': 'bg-cyan-500/20 text-cyan-300',
        'media': 'bg-blue-500/20 text-blue-300',
        'support staff': 'bg-slate-500/20 text-slate-300',
        'investor': 'bg-emerald-500/20 text-emerald-300',
        'felicitation delegate': 'bg-pink-500/20 text-pink-300',
        'vip pass': 'bg-yellow-500/20 text-yellow-300',
        'vip': 'bg-amber-500/20 text-amber-300',
        'speaker': 'bg-purple-500/20 text-purple-300',
        'press': 'bg-blue-500/20 text-blue-300',
        'general': 'bg-white/5 text-gray-400',
      };
      return classes[b] || 'bg-white/5 text-gray-400';
    }

    // ============ TOAST ============
    function toast(msg, type='success') {
      const c = {success:'bg-green-500',error:'bg-red-500',info:'bg-primary-500'};
      const t = document.createElement('div');
      t.className = 'fixed top-4 right-4 z-50 '+c[type]+' text-white px-4 py-3 rounded-xl shadow-lg text-sm transition-all transform translate-x-full';
      t.innerHTML = '<i class="fas fa-'+(type==='error'?'exclamation-circle':'check-circle')+' mr-2"></i>'+msg;
      document.body.appendChild(t);
      setTimeout(()=>t.classList.remove('translate-x-full'), 10);
      setTimeout(()=>{t.classList.add('translate-x-full'); setTimeout(()=>t.remove(),300);}, 3000);
    }

    // ============ MODAL ============
    function openModal(html) {
      document.getElementById('modal-box').innerHTML = '<div class="p-6 overflow-y-auto flex-1" style="scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.15) transparent;">' + html + '</div>';
      document.getElementById('modal-container').classList.remove('hidden');
    }
    function closeModal() { document.getElementById('modal-container').classList.add('hidden'); }
    document.getElementById('modal-container').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });

    // ============ OVERVIEW ============
    async function loadOverview() {
      const [stats, event, analytics, lunchStats] = await Promise.all([
        api.get('/api/events/'+EID+'/stats'),
        api.get('/api/events/'+EID),
        api.get('/api/admin/events/'+EID+'/analytics'),
        api.get('/api/admin/events/'+EID+'/lunch-stats'),
      ]);

      document.getElementById('section-overview').innerHTML = \`
        <div class="mb-6">
          <div class="glass rounded-2xl p-5 glow">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="text-xl font-bold">\${event.title}</h3>
                <p class="text-sm text-gray-400 mt-1">\${event.venue} &middot; \${event.start_date} to \${event.end_date}</p>
              </div>
              <div class="flex items-center gap-2">
                <span class="px-3 py-1 rounded-full text-xs font-semibold \${event.status==='live'?'bg-green-500/20 text-green-400 border border-green-500/30':'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'}">\${event.status.toUpperCase()}</span>
                <button onclick="openEditEvent()" class="px-3 py-1.5 rounded-lg text-xs font-medium glass hover:bg-white/10 transition"><i class="fas fa-edit mr-1"></i>Edit</button>
              </div>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          \${[
            {icon:'fa-users',label:'Total Attendees',value:stats.attendees,color:'primary'},
            {icon:'fa-circle',label:'Online Now',value:stats.online,color:'green'},
            {icon:'fa-microphone',label:'Sessions',value:stats.sessions,color:'purple'},
            {icon:'fa-store',label:'Exhibitors',value:stats.exhibitors,color:'accent'},
            {icon:'fa-handshake',label:'Connections',value:stats.connections,color:'teal'},
            {icon:'fa-trophy',label:'Categories',value:stats.categories,color:'pink'},
          ].map(s=>\`
            <div class="glass rounded-xl p-4 card-hover text-center cursor-pointer" onclick="switchSection('\${s.label.includes('Attend')?'attendees':s.label.includes('Session')?'sessions':s.label.includes('Exhib')?'exhibitors':s.label.includes('Categ')?'awards':'overview'}')">
              <i class="fas \${s.icon} text-lg mb-2" style="color:\${s.color==='primary'?'#748ffc':s.color==='green'?'#22c55e':s.color==='purple'?'#a78bfa':s.color==='accent'?'#ff9800':s.color==='teal'?'#14b8a6':'#f472b6'}"></i>
              <div class="text-2xl font-bold">\${s.value}</div>
              <div class="text-[10px] text-gray-500">\${s.label}</div>
            </div>
          \`).join('')}
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div class="glass rounded-xl p-5">
            <h3 class="font-semibold mb-3 text-sm"><i class="fas fa-chart-bar text-primary-400 mr-2"></i>Attendees by Role</h3>
            <div class="chart-container"><canvas id="chart-roles"></canvas></div>
          </div>
          <div class="glass rounded-xl p-5">
            <h3 class="font-semibold mb-3 text-sm"><i class="fas fa-store text-accent-400 mr-2"></i>Top Exhibitors by Visitors</h3>
            <div class="chart-container"><canvas id="chart-exhibitors"></canvas></div>
          </div>
        </div>

        <!-- Lunch Pack & Notification Dashboard -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div class="glass rounded-xl p-5">
            <div class="flex items-center justify-between mb-4">
              <h3 class="font-semibold text-sm"><i class="fas fa-utensils text-amber-400 mr-2"></i>Lunch Pack Calculator</h3>
              <span class="text-[10px] text-gray-500">Lunch: 1:00 - 2:00 PM</span>
            </div>
            <div class="grid grid-cols-3 gap-3 mb-4">
              <div class="text-center p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <div class="text-2xl font-black text-amber-400">\${lunchStats.estimatedLunchPacks}</div>
                <div class="text-[10px] text-gray-400 uppercase tracking-wider mt-1">Est. Lunch Packs</div>
              </div>
              <div class="text-center p-3 rounded-xl bg-green-500/10 border border-green-500/20">
                <div class="text-2xl font-black text-green-400">\${lunchStats.arrivingBeforeLunch}</div>
                <div class="text-[10px] text-gray-400 uppercase tracking-wider mt-1">Arriving by 1 PM</div>
              </div>
              <div class="text-center p-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
                <div class="text-2xl font-black text-blue-400">\${lunchStats.withArrivalTime}</div>
                <div class="text-[10px] text-gray-400 uppercase tracking-wider mt-1">Arrival Updated</div>
              </div>
            </div>
            <div class="space-y-2 text-xs">
              <div class="flex justify-between text-gray-400"><span>Total lunch eligible (Lunch=Yes)</span><span class="font-semibold text-white">\${lunchStats.totalLunchEligible}</span></div>
              <div class="flex justify-between text-gray-400"><span>Arriving before lunch (by 1 PM)</span><span class="font-semibold text-green-400">\${lunchStats.arrivingBeforeLunch}</span></div>
              <div class="flex justify-between text-gray-400"><span>Arriving after lunch (after 1 PM)</span><span class="font-semibold text-gray-300">\${lunchStats.arrivingAfterLunch}</span></div>
              <div class="flex justify-between text-gray-400"><span>No arrival time set (assume lunch)</span><span class="font-semibold text-amber-400">\${lunchStats.noArrivalTimeLunch}</span></div>
              <div class="border-t border-white/10 pt-2 flex justify-between font-semibold"><span class="text-amber-300">Estimated lunch packs needed</span><span class="text-amber-400 text-base">\${lunchStats.estimatedLunchPacks}</span></div>
            </div>
            \${lunchStats.timeSlots && lunchStats.timeSlots.length > 0 ? \`
              <div class="mt-4 pt-3 border-t border-white/10">
                <h4 class="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Arrival Time Breakdown</h4>
                <div class="space-y-1">
                  \${lunchStats.timeSlots.map(s => \`
                    <div class="flex items-center gap-2 text-xs">
                      <span class="w-28 text-gray-400">\${s.slot}</span>
                      <div class="flex-1 h-4 bg-white/5 rounded-full overflow-hidden">
                        <div class="h-full rounded-full \${s.slot.includes('Lunch') ? 'bg-amber-500/60' : 'bg-primary-500/60'}" style="width:\${Math.max(4, (s.count / lunchStats.totalAttendees) * 100)}%"></div>
                      </div>
                      <span class="font-semibold text-white w-8 text-right">\${s.count}</span>
                    </div>
                  \`).join('')}
                </div>
              </div>
            \` : ''}
          </div>
          <div class="glass rounded-xl p-5">
            <div class="flex items-center justify-between mb-4">
              <h3 class="font-semibold text-sm"><i class="fas fa-bell text-blue-400 mr-2"></i>Notification Status</h3>
              <button onclick="notifyAllAttendees()" class="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white transition"><i class="fas fa-paper-plane mr-1"></i>Notify All</button>
            </div>
            <div class="grid grid-cols-2 gap-3 mb-4">
              <div class="text-center p-3 rounded-xl bg-green-500/10 border border-green-500/20">
                <div class="text-2xl font-black text-green-400">\${lunchStats.notifiedCount}</div>
                <div class="text-[10px] text-gray-400 uppercase tracking-wider mt-1">Notified</div>
              </div>
              <div class="text-center p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                <div class="text-2xl font-black text-red-400">\${lunchStats.totalAttendees - lunchStats.notifiedCount}</div>
                <div class="text-[10px] text-gray-400 uppercase tracking-wider mt-1">Pending</div>
              </div>
            </div>
            <div class="w-full bg-white/5 rounded-full h-3 mb-2">
              <div class="h-full rounded-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all" style="width:\${lunchStats.totalAttendees > 0 ? Math.round(lunchStats.notifiedCount/lunchStats.totalAttendees*100) : 0}%"></div>
            </div>
            <div class="flex justify-between text-xs text-gray-400">
              <span>\${lunchStats.totalAttendees > 0 ? Math.round(lunchStats.notifiedCount/lunchStats.totalAttendees*100) : 0}% notified</span>
              <span>\${lunchStats.totalAttendees} total attendees</span>
            </div>
            <div class="mt-4 pt-3 border-t border-white/10">
              <p class="text-xs text-gray-400 leading-relaxed">
                <i class="fas fa-info-circle text-blue-400 mr-1"></i>
                Notification emails inform attendees that their account is ready. They are asked to update their profile and expected arrival time. Lunch packs are calculated based on arrival time vs the 1-2 PM lunch window.
              </p>
            </div>
          </div>
        </div>

        <!-- Engagement Tracker -->
        <div class="glass rounded-xl p-5 mb-6">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-semibold text-sm"><i class="fas fa-chart-line text-emerald-400 mr-2"></i>Engagement Tracker</h3>
            <span class="text-[10px] text-gray-500">Post-notification actions</span>
          </div>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div class="text-center p-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
              <div class="text-2xl font-black text-blue-400">\${lunchStats.loggedInCount}</div>
              <div class="text-[10px] text-gray-400 uppercase tracking-wider mt-1">Logged In</div>
            </div>
            <div class="text-center p-3 rounded-xl bg-violet-500/10 border border-violet-500/20">
              <div class="text-2xl font-black text-violet-400">\${lunchStats.loggedInAfterNotifyCount}</div>
              <div class="text-[10px] text-gray-400 uppercase tracking-wider mt-1">Login After Email</div>
            </div>
            <div class="text-center p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <div class="text-2xl font-black text-emerald-400">\${lunchStats.passDownloadedCount}</div>
              <div class="text-[10px] text-gray-400 uppercase tracking-wider mt-1">Pass Downloaded</div>
            </div>
            <div class="text-center p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <div class="text-2xl font-black text-amber-400">\${lunchStats.withArrivalTime}</div>
              <div class="text-[10px] text-gray-400 uppercase tracking-wider mt-1">Arrival Updated</div>
            </div>
          </div>
          <div class="space-y-3">
            \${[
              { label: 'Logged into account', count: lunchStats.loggedInCount, total: lunchStats.totalAttendees, color: 'blue' },
              { label: 'Logged in after email notification', count: lunchStats.loggedInAfterNotifyCount, total: lunchStats.notifiedCount || 1, color: 'violet' },
              { label: 'Downloaded delegate pass', count: lunchStats.passDownloadedCount, total: lunchStats.totalAttendees, color: 'emerald' },
              { label: 'Updated arrival time', count: lunchStats.withArrivalTime, total: lunchStats.totalAttendees, color: 'amber' },
            ].map(m => \`
              <div>
                <div class="flex justify-between text-xs mb-1">
                  <span class="text-gray-400">\${m.label}</span>
                  <span class="font-semibold text-\${m.color}-400">\${m.count} / \${m.total} (\${m.total > 0 ? Math.round(m.count/m.total*100) : 0}%)</span>
                </div>
                <div class="w-full bg-white/5 rounded-full h-2.5">
                  <div class="h-full rounded-full bg-\${m.color}-500/60 transition-all" style="width:\${m.total > 0 ? Math.max(2, Math.round(m.count/m.total*100)) : 0}%"></div>
                </div>
              </div>
            \`).join('')}
          </div>
          <div class="mt-4 pt-3 border-t border-white/10">
            <p class="text-xs text-gray-400 leading-relaxed">
              <i class="fas fa-info-circle text-emerald-400 mr-1"></i>
              Tracks how many attendees have engaged after receiving their notification email: logged in, downloaded their delegate pass, or updated their expected arrival time.
            </p>
          </div>
        </div>

        <!-- RSVP Status -->
        <div class="glass rounded-xl p-5 mb-6">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-semibold text-sm"><i class="fas fa-clipboard-check text-amber-400 mr-2"></i>RSVP Status</h3>
            <button onclick="resendNonResponders()" class="px-3 py-1.5 rounded-lg text-xs font-medium bg-orange-600 hover:bg-orange-500 text-white transition" title="Resend email to attendees who were notified but haven't responded"><i class="fas fa-redo mr-1"></i>Resend to Non-Responders</button>
          </div>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div class="text-center p-3 rounded-xl bg-green-500/10 border border-green-500/20">
              <div class="text-2xl font-black text-green-400">\${lunchStats.rsvpConfirmed}</div>
              <div class="text-[10px] text-gray-400 uppercase tracking-wider mt-1">Confirmed</div>
            </div>
            <div class="text-center p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <div class="text-2xl font-black text-amber-400">\${lunchStats.rsvpMaybe}</div>
              <div class="text-[10px] text-gray-400 uppercase tracking-wider mt-1">Maybe</div>
            </div>
            <div class="text-center p-3 rounded-xl bg-red-500/10 border border-red-500/20">
              <div class="text-2xl font-black text-red-400">\${lunchStats.rsvpDeclined}</div>
              <div class="text-[10px] text-gray-400 uppercase tracking-wider mt-1">Declined</div>
            </div>
            <div class="text-center p-3 rounded-xl bg-gray-500/10 border border-gray-500/20">
              <div class="text-2xl font-black text-gray-400">\${lunchStats.rsvpNoResponse}</div>
              <div class="text-[10px] text-gray-400 uppercase tracking-wider mt-1">No Response</div>
            </div>
          </div>
          <div class="space-y-2">
            \${[
              { label: 'Confirmed', count: lunchStats.rsvpConfirmed, total: lunchStats.totalAttendees, color: 'green' },
              { label: 'Maybe', count: lunchStats.rsvpMaybe, total: lunchStats.totalAttendees, color: 'amber' },
              { label: 'Declined', count: lunchStats.rsvpDeclined, total: lunchStats.totalAttendees, color: 'red' },
              { label: 'No Response', count: lunchStats.rsvpNoResponse, total: lunchStats.totalAttendees, color: 'gray' },
            ].map(m => \`
              <div>
                <div class="flex justify-between text-xs mb-1">
                  <span class="text-gray-400">\${m.label}</span>
                  <span class="font-semibold text-\${m.color}-400">\${m.count} / \${m.total} (\${m.total > 0 ? Math.round(m.count/m.total*100) : 0}%)</span>
                </div>
                <div class="w-full bg-white/5 rounded-full h-2.5">
                  <div class="h-full rounded-full bg-\${m.color}-500/60 transition-all" style="width:\${m.total > 0 ? Math.max(2, Math.round(m.count/m.total*100)) : 0}%"></div>
                </div>
              </div>
            \`).join('')}
          </div>
          <div class="mt-4 pt-3 border-t border-white/10">
            <p class="text-xs text-gray-400 leading-relaxed">
              <i class="fas fa-info-circle text-amber-400 mr-1"></i>
              RSVP responses collected via email buttons and in-app confirmation. "No Response" includes attendees not yet notified and those who haven't clicked any button.
            </p>
          </div>
        </div>

        <!-- Post-Ceremony Thank You Email -->
        <div class="glass rounded-xl p-5 mb-6 border border-amber-500/20">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-semibold text-sm"><i class="fas fa-heart text-pink-400 mr-2"></i>Post-Ceremony Thank You Email</h3>
            <span class="px-2 py-0.5 rounded-full text-[10px] bg-pink-500/20 text-pink-300 border border-pink-500/30">NEW</span>
          </div>
          <div style="background:linear-gradient(135deg,rgba(236,72,153,0.08),rgba(168,85,247,0.08));border:1px solid rgba(236,72,153,0.2);border-radius:12px;padding:20px;margin-bottom:16px;">
            <p class="text-sm text-gray-300 leading-relaxed mb-3">
              Send a beautifully crafted <strong class="text-pink-300">thank-you email</strong> to all attendees, expressing gratitude for making the Bharat AI Innovation 2026 a grand success. The email will:
            </p>
            <ul class="text-xs text-gray-400 space-y-1.5 mb-4">
              <li><i class="fas fa-check text-green-400 mr-2"></i>Thank attendees for their presence &amp; support</li>
              <li><i class="fas fa-star text-amber-400 mr-2"></i>Highlight <strong>Key Speakers</strong>, <strong>Innovation Leaders</strong> &amp; <strong>Startup Finalists</strong></li>
              <li><i class="fas fa-camera text-blue-400 mr-2"></i>Share the <strong>Google Drive link</strong> to event photos</li>
              <li><i class="fas fa-link text-purple-400 mr-2"></i>Encourage continued use of the networking app</li>
            </ul>
            <div class="flex flex-wrap gap-2">
              <button onclick="sendThankYouToAll()" class="px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white transition shadow-lg shadow-pink-900/30">
                <i class="fas fa-paper-plane mr-2"></i>Send Thank You to All Attendees
              </button>
              <button onclick="previewThankYouEmail()" class="px-4 py-2 rounded-xl text-sm font-medium glass hover:bg-white/10 text-gray-300 transition border border-white/10">
                <i class="fas fa-eye mr-2"></i>Preview Email
              </button>
            </div>
          </div>
          <div id="thankyou-progress" style="display:none;">
            <div class="flex items-center gap-3 mb-2">
              <div class="flex-1 bg-white/5 rounded-full h-3">
                <div id="thankyou-bar" class="h-full rounded-full bg-gradient-to-r from-pink-500 to-purple-500 transition-all" style="width:0%"></div>
              </div>
              <span id="thankyou-count" class="text-xs font-mono text-gray-400">0/0</span>
            </div>
            <p id="thankyou-status" class="text-xs text-gray-400"></p>
          </div>
          <div class="mt-3 pt-3 border-t border-white/10">
            <p class="text-xs text-gray-500 leading-relaxed">
              <i class="fas fa-info-circle text-pink-400/60 mr-1"></i>
              Emails are sent individually via Elastic Email API. Each attendee receives a personalised email addressed to them by name. Photos link: <a href="https://drive.google.com/drive/folders/14YkEgPMjXIJ2JYNYmgxmBOH6g2TL1-FM?usp=sharing" target="_blank" class="text-blue-400 hover:underline">Google Drive Gallery</a>
            </p>
          </div>
        </div>

        <div class="glass rounded-xl p-5">
          <h3 class="font-semibold mb-3 text-sm"><i class="fas fa-user-plus text-green-400 mr-2"></i>Recent Registrations</h3>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead><tr class="text-gray-400 text-xs uppercase">
                <th></th><th>Name</th><th>Email</th><th>Company</th><th>Role</th><th>Badge</th><th>Registered</th>
              </tr></thead>
              <tbody>
                \${analytics.recentRegistrations.map(a=>\`<tr>
                  <td><img src="\${getAvatarUrl(a.email, a.name, 48, a.avatar_url)}" alt="" class="w-6 h-6 rounded-full object-cover"></td>
                  <td class="font-medium">\${a.name}</td>
                  <td class="text-gray-400">\${a.email}</td>
                  <td>\${a.company||'-'}</td>
                  <td><span class="px-2 py-0.5 rounded-full text-[10px] bg-primary-500/20 text-primary-300">\${a.role}</span></td>
                  <td><span class="px-2 py-0.5 rounded-full text-[10px] \${getBadgeClass(a.badge_type)}">\${a.badge_type}</span></td>
                  <td class="text-gray-500 text-xs">\${new Date(a.created_at).toLocaleString()}</td>
                </tr>\`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      \`;

      // Render charts
      setTimeout(() => {
        renderChart('chart-roles', 'doughnut', 
          analytics.attendeesByRole.map(r=>r.role),
          analytics.attendeesByRole.map(r=>r.count),
          ['#748ffc','#ff9800','#a78bfa','#22c55e','#f472b6']
        );
        renderChart('chart-exhibitors', 'bar',
          analytics.topExhibitors.map(e=>e.company_name),
          analytics.topExhibitors.map(e=>e.visitor_count),
          ['#748ffc','#91a7ff','#bac8ff','#4c6ef5','#3b5bdb','#ff9800','#ffb74d','#ffa726']
        );
      }, 100);
    }

    function renderChart(id, type, labels, data, colors) {
      const el = document.getElementById(id);
      if (!el) return;
      if (chartInstances[id]) chartInstances[id].destroy();
      chartInstances[id] = new Chart(el, {
        type,
        data: {
          labels,
          datasets: [{
            data,
            backgroundColor: type==='doughnut' ? colors : colors[0],
            borderColor: type==='doughnut' ? 'transparent' : colors[0],
            borderWidth: type==='bar' ? 0 : 0,
            borderRadius: type==='bar' ? 6 : 0,
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: type==='doughnut', position: 'right', labels: { color: '#94a3b8', font: {size:11} } } },
          scales: type==='bar' ? { x: { ticks: { color:'#64748b', font:{size:10} }, grid: {display:false} }, y: { ticks: { color:'#64748b' }, grid: { color:'rgba(255,255,255,0.04)' } } } : {},
        }
      });
    }

    // ============ ATTENDEES ============
    let bulkUploadData = [];
    let attSortCol = null;
    let attSortDir = 'asc'; // 'asc' or 'desc'
    let lastAttendees = null;
    let lastDupData = null;

    async function loadAdminAttendees(scrollToId) {
      // Preserve scroll position before reload
      const scrollContainer = document.querySelector('#section-attendees .overflow-y-auto');
      const prevScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
      const [attendees, dupData] = await Promise.all([
        api.get('/api/events/'+EID+'/attendees'),
        api.get('/api/admin/events/'+EID+'/attendees/duplicates').catch(()=>({groups:[]}))
      ]);
      lastAttendees = attendees;
      lastDupData = dupData;
      // Build duplicate ID map: id -> { groupIndex, color }
      const dupColors = ['#ef4444','#f97316','#eab308','#a855f7','#ec4899','#14b8a6','#6366f1','#0ea5e9','#84cc16','#f43f5e'];
      const dupMap = {};
      (dupData.groups||[]).forEach((g,gi) => {
        const color = dupColors[gi % dupColors.length];
        const allIds = [g.primary.id, ...g.duplicates.map(d=>d.id)];
        allIds.forEach(id => { dupMap[id] = { group: gi+1, color, count: allIds.length }; });
      });
      // Sort attendees
      if (attSortCol) {
        applyAttSort(attendees, attSortCol, attSortDir);
      } else {
        // Default: duplicates grouped at top, then by ID
        attendees.sort((a,b) => {
          const da = dupMap[a.id], db = dupMap[b.id];
          if (da && db) return da.group !== db.group ? da.group - db.group : a.id - b.id;
          if (da) return -1;
          if (db) return 1;
          return a.id - b.id;
        });
      }
      document.getElementById('section-attendees').innerHTML = \`
        <div class="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div class="flex gap-2 items-center">
            <div class="relative">
              <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs"></i>
              <input type="text" id="admin-att-search" placeholder="Search attendees..." class="pl-9 pr-4 py-2 rounded-lg text-xs w-64" oninput="filterAdminAttendees()">
            </div>
            <span class="text-xs text-gray-400">\${attendees.length} total</span>
            \${Object.keys(dupMap).length > 0 ? '<span class="text-xs text-red-400 ml-1"><i class="fas fa-exclamation-triangle mr-0.5"></i>' + (dupData.totalGroups||0) + ' dup groups (' + Object.keys(dupMap).length + ' entries)</span>' : ''}
            \${attSortCol ? '<span class="text-xs text-indigo-400 ml-2"><i class="fas fa-sort-amount-'+(attSortDir==='asc'?'up':'down')+' mr-0.5"></i>Sorted by '+attSortCol.replace('_',' ')+'</span><button onclick="resetAttSort()" class="text-[10px] text-gray-500 hover:text-white ml-1" title="Reset sort"><i class="fas fa-times-circle"></i></button>' : ''}
          </div>
          <div class="flex gap-2">
            <button onclick="notifyAllAttendees()" class="px-4 py-2 rounded-xl text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white transition"><i class="fas fa-envelope mr-1.5"></i>Notify All</button>
            <a href="#" onclick="exportAttendeesCsv(event)" class="px-4 py-2 rounded-xl text-xs font-medium glass hover:bg-white/10 text-gray-300 transition cursor-pointer"><i class="fas fa-download mr-1.5"></i>Export CSV</a>
            <button onclick="openAddAttendee()" class="px-4 py-2 rounded-xl text-xs font-medium bg-primary-600 hover:bg-primary-500 text-white transition"><i class="fas fa-user-plus mr-1.5"></i>Add Attendee</button>
            <button onclick="openBulkUploadModal()" class="px-4 py-2 rounded-xl text-xs font-medium bg-green-600 hover:bg-green-500 text-white transition"><i class="fas fa-file-upload mr-1.5"></i>Bulk Upload</button>
            <button onclick="findDuplicates()" class="px-4 py-2 rounded-xl text-xs font-medium bg-purple-600 hover:bg-purple-500 text-white transition"><i class="fas fa-user-friends mr-1.5"></i>Find Duplicates</button>
            <div class="relative" id="col-settings-wrap">
              <button onclick="toggleColSettings()" class="px-4 py-2 rounded-xl text-xs font-medium glass hover:bg-white/10 text-gray-300 transition" title="Adjust column widths & visibility"><i class="fas fa-columns mr-1.5"></i>Columns</button>
            </div>
          </div>
        </div>
        <div class="glass rounded-xl overflow-hidden">
          <div class="overflow-x-auto max-h-[70vh] overflow-y-auto scroll-hide">
            <table class="w-full text-sm" id="attendee-table">
              <thead><tr class="text-gray-400 text-xs uppercase">
                <th style="width:50px" class="sortable" onclick="sortAttendees('id')">ID\${sortIcon('id')}</th><th style="width:40px"></th><th style="width:130px" class="sortable" onclick="sortAttendees('name')">Name\${sortIcon('name')}<span class="col-resizer" data-col="2"></span></th><th style="width:180px" class="sortable" onclick="sortAttendees('email')">Email\${sortIcon('email')}<span class="col-resizer" data-col="3"></span></th><th style="width:100px" class="sortable" onclick="sortAttendees('mobile')">Mobile\${sortIcon('mobile')}<span class="col-resizer" data-col="4"></span></th><th style="width:130px" class="sortable" onclick="sortAttendees('company')">Company\${sortIcon('company')}<span class="col-resizer" data-col="5"></span></th><th style="width:110px" class="sortable" onclick="sortAttendees('job_title')">Title\${sortIcon('job_title')}<span class="col-resizer" data-col="6"></span></th><th style="width:80px" class="sortable" onclick="sortAttendees('city')">City\${sortIcon('city')}<span class="col-resizer" data-col="7"></span></th><th style="width:70px" class="sortable" onclick="sortAttendees('country')">Country\${sortIcon('country')}<span class="col-resizer" data-col="8"></span></th><th style="width:40px">In</th><th style="width:110px" class="sortable" onclick="sortAttendees('role')">Role\${sortIcon('role')}<span class="col-resizer" data-col="10"></span></th><th style="width:90px" class="sortable" onclick="sortAttendees('badge_type')">Badge\${sortIcon('badge_type')}<span class="col-resizer" data-col="11"></span></th><th style="width:60px" class="sortable" onclick="sortAttendees('rsvp_status')">RSVP\${sortIcon('rsvp_status')}</th><th style="width:45px" class="sortable" onclick="sortAttendees('lunch_inclusion')">Lunch\${sortIcon('lunch_inclusion')}</th><th style="width:60px" class="sortable" onclick="sortAttendees('arrival_time')">Arrival\${sortIcon('arrival_time')}</th><th style="width:80px" class="sortable" onclick="sortAttendees('registration_date')">Reg Date\${sortIcon('registration_date')}</th><th style="width:70px" class="sortable" onclick="sortAttendees('payment_amount')">Payment\${sortIcon('payment_amount')}</th><th style="width:45px">Notif</th><th style="width:80px">Engage</th><th style="width:140px">Actions</th>
              </tr></thead>
              <tbody>
                \${attendees.map((a,idx)=>{ const dup = dupMap[a.id]; const prevDup = idx > 0 ? dupMap[attendees[idx-1].id] : null; const groupChanged = (dup && prevDup && dup.group !== prevDup.group) || (prevDup && !dup); const separator = groupChanged ? '<tr class="dup-sep"><td colspan="20" style="height:2px;padding:0;background:rgba(255,255,255,0.06);"></td></tr>' : ''; return separator + \`<tr class="att-row \${dup ? 'dup-row' : ''}" id="att-row-\${a.id}" data-search="\${(a.name+a.email+a.company+a.job_title+(a.mobile||'')).toLowerCase()}" \${dup ? 'style="border-left: 3px solid '+dup.color+';" title="⚠ Suspected Duplicate (Group '+dup.group+', '+dup.count+' entries)"' : ''}>
                  <td class="text-gray-500">#\${a.id}\${dup ? '<span class="dup-badge" style="background:'+dup.color+'22;color:'+dup.color+'">⚠ G'+dup.group+'</span>' : ''}</td>
                  <td><img src="\${getAvatarUrl(a.email, a.name, 64, a.avatar_url)}" alt="" class="w-8 h-8 rounded-full object-cover"></td>
                  <td class="font-medium ie-cell" onclick="inlineEdit(this, \${a.id}, 'name', '\${esc(a.name)}')">\${a.name}</td>
                  <td class="text-gray-400 text-xs ie-cell" onclick="inlineEdit(this, \${a.id}, 'email', '\${esc(a.email)}')">\${a.email}</td>
                  <td class="text-xs text-gray-400 ie-cell" onclick="inlineEdit(this, \${a.id}, 'mobile', '\${esc(a.mobile||'')}')">\${a.mobile||'<span class=&quot;text-gray-600&quot;>-</span>'}</td>
                  <td class="ie-cell" onclick="inlineEdit(this, \${a.id}, 'company', '\${esc(a.company||'')}')">\${a.company||'<span class=&quot;text-gray-600&quot;>-</span>'}</td>
                  <td class="text-xs text-gray-400 ie-cell" onclick="inlineEdit(this, \${a.id}, 'job_title', '\${esc(a.job_title||'')}')">\${a.job_title||'<span class=&quot;text-gray-600&quot;>-</span>'}</td>
                  <td class="text-xs text-gray-400 ie-cell" onclick="inlineEdit(this, \${a.id}, 'city', '\${esc(a.city||'')}')">\${a.city||'<span class=&quot;text-gray-600&quot;>-</span>'}</td>
                  <td class="text-xs text-gray-400 ie-cell" onclick="inlineEdit(this, \${a.id}, 'country', '\${esc(a.country||'')}')">\${a.country||'<span class=&quot;text-gray-600&quot;>-</span>'}</td>
                  <td class="text-xs">\${a.linkedin_url ? '<a href="'+a.linkedin_url+'" target="_blank" class="text-blue-400 hover:text-blue-300"><i class="fab fa-linkedin"></i></a>' : '<span class="text-gray-600">-</span>'}</td>
                  <td class="ie-cell" onclick="inlineMultiSelect(this, \${a.id}, 'role', '\${esc(a.role||'attendee')}')"><div class="flex flex-wrap gap-0.5">\${(a.role||'attendee').split(',').map(r=>'<span class=&quot;px-1.5 py-0.5 rounded text-[9px] bg-primary-500/20 text-primary-300 whitespace-nowrap cursor-pointer&quot;>'+r.trim()+'</span>').join('')}</div></td>
                  <td class="ie-cell" onclick="inlineSelect(this, \${a.id}, 'badge_type', '\${esc(a.badge_type)}', ['Organiser','VIP Guest','Exhibitor','Delegate','Exhibition Speaker','Jury','Visitor Pass','Media','Support Staff','Investor','Felicitation Delegate','VIP Pass','Speaker','Startup Pitcher'])"><span class="px-2 py-0.5 rounded-full text-[10px] cursor-pointer hover:ring-1 hover:ring-primary-400/50 \${getBadgeClass(a.badge_type)}">\${a.badge_type}</span></td>
                  <td class="ie-cell" onclick="inlineSelect(this, \${a.id}, 'rsvp_status', '\${a.rsvp_status||''}', ['','confirmed','maybe','declined'])"><span class="px-2 py-0.5 rounded-full text-[10px] font-medium cursor-pointer hover:ring-1 hover:ring-primary-400/50 \${a.rsvp_status === 'confirmed' ? 'bg-green-500/20 text-green-400' : a.rsvp_status === 'declined' ? 'bg-red-500/20 text-red-400' : a.rsvp_status === 'maybe' ? 'bg-amber-500/20 text-amber-400' : 'bg-gray-500/10 text-gray-500'}">\${a.rsvp_status ? (a.rsvp_status === 'confirmed' ? '✓ Yes' : a.rsvp_status === 'declined' ? '✗ No' : '? Maybe') : '—'}</span></td>
                  <td class="ie-cell" onclick="inlineSelect(this, \${a.id}, 'lunch_inclusion', '\${a.lunch_inclusion||'Yes'}', ['Yes','No'])"><span class="px-1.5 py-0.5 rounded text-[10px] font-medium cursor-pointer hover:ring-1 hover:ring-primary-400/50 \${(a.lunch_inclusion||'Yes')==='Yes' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}">\${a.lunch_inclusion||'Yes'}</span></td>
                  <td class="text-xs ie-cell" onclick="inlineSelect(this, \${a.id}, 'arrival_time', '\${a.arrival_time||''}', ['','09:00','09:30','10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30','16:00','16:30'])">\${a.arrival_time ? '<span class="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 cursor-pointer hover:ring-1 hover:ring-blue-400/50">'+ (parseInt(a.arrival_time) > 12 ? (parseInt(a.arrival_time)-12)+':'+a.arrival_time.split(':')[1]+' PM' : a.arrival_time+' AM') +'</span>' : '<span class="text-gray-600 cursor-pointer hover:text-gray-400">-</span>'}</td>
                  <td class="text-xs text-gray-400 ie-cell" onclick="inlineEdit(this, \${a.id}, 'registration_date', '\${esc(a.registration_date||'')}')">\${a.registration_date||'<span class=&quot;text-gray-600&quot;>-</span>'}</td>
                  <td class="text-xs ie-cell" onclick="inlineEdit(this, \${a.id}, 'payment_amount', '\${esc(a.payment_amount||'')}')">\${a.payment_amount ? '<span class="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">₹'+a.payment_amount+'</span>' : '<span class=&quot;text-gray-600&quot;>-</span>'}</td>
                  <td class="text-xs" id="notified-\${a.id}">\${a.notified_at ? '<span class="text-green-400" title="'+a.notified_at+'"><i class="fas fa-check-circle"></i></span>' : '<span class="text-gray-600"><i class="fas fa-times-circle"></i></span>'}</td>
                  <td class="text-xs"><div class="flex gap-1.5 items-center" title="Login | Pass | Post-Email Login"><span class="\${a.last_login_at ? 'text-blue-400' : 'text-gray-600'}" title="\${a.last_login_at ? 'Logged in: '+a.last_login_at : 'Not logged in'}"><i class="fas fa-sign-in-alt"></i></span><span class="\${a.pass_downloaded_at ? 'text-emerald-400' : 'text-gray-600'}" title="\${a.pass_downloaded_at ? 'Pass downloaded: '+a.pass_downloaded_at : 'Pass not downloaded'}"><i class="fas fa-id-badge"></i></span><span class="\${a.notified_at && a.last_login_at && a.last_login_at >= a.notified_at ? 'text-violet-400' : 'text-gray-600'}" title="\${a.notified_at && a.last_login_at && a.last_login_at >= a.notified_at ? 'Opened after email' : 'Not opened after email'}"><i class="fas fa-envelope-open"></i></span></div></td>
                  <td class="flex gap-1">
                    <button onclick='openEditAttendee(\${JSON.stringify(a).replace(/'/g,"&#39;")})' class="px-2 py-1 rounded text-xs bg-primary-500/20 text-primary-300 hover:bg-primary-500/30" title="Full Edit"><i class="fas fa-edit"></i></button>
                    <button onclick='adminDownloadPass(\${JSON.stringify({id:a.id,name:a.name,email:a.email,company:a.company||"",job_title:a.job_title||"",badge_type:a.badge_type||"Delegate",avatar_url:a.avatar_url||""}).replace(/'/g,"&#39;")})' class="px-2 py-1 rounded text-xs bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30" title="Download Pass"><i class="fas fa-id-badge"></i></button>
                    <button onclick="notifyAttendee(\${a.id}, '\${a.name.replace(/'/g,"&apos;")}', '\${a.email}')" class="px-2 py-1 rounded text-xs bg-amber-500/20 text-amber-300 hover:bg-amber-500/30" title="Send notification email"><i class="fas fa-envelope"></i></button>
                    <button onclick="deleteAttendee(\${a.id})" class="px-2 py-1 rounded text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30" title="Delete"><i class="fas fa-trash"></i></button>
                  </td>
                </tr>\`; }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      \`;
      // Restore scroll position and column widths after reload
      requestAnimationFrame(() => {
        restoreColumnWidths();
        const newContainer = document.querySelector('#section-attendees .overflow-y-auto');
        if (newContainer) {
          if (scrollToId) {
            const row = document.getElementById('att-row-' + scrollToId);
            if (row) { row.scrollIntoView({ block: 'center' }); row.style.transition='background 0.3s'; row.style.background='rgba(76,110,245,0.15)'; setTimeout(()=>{row.style.background='';},1500); }
          } else if (prevScrollTop) {
            newContainer.scrollTop = prevScrollTop;
          }
        }
      });
    }

    // ---- Bulk Upload Modal ----
    function openBulkUploadModal() {
      bulkUploadData = [];
      openModal(\`
        <h3 class="text-lg font-bold mb-1"><i class="fas fa-file-upload text-green-400 mr-2"></i>Bulk Upload Attendees</h3>
        <p class="text-xs text-gray-400 mb-5">Upload a CSV or Excel file to import multiple attendees at once.</p>

        <!-- Step 1: File Upload -->
        <div id="bulk-step-upload">
          <div id="bulk-dropzone" class="border-2 border-dashed border-white/15 rounded-xl p-8 text-center cursor-pointer hover:border-primary-500/50 hover:bg-white/[0.02] transition-all"
               onclick="document.getElementById('bulk-file-input').click()"
               ondragover="event.preventDefault(); this.classList.add('border-primary-500/50','bg-white/[0.02]')"
               ondragleave="this.classList.remove('border-primary-500/50','bg-white/[0.02]')"
               ondrop="handleBulkDrop(event)">
            <i class="fas fa-cloud-upload-alt text-3xl text-gray-500 mb-3"></i>
            <p class="text-sm font-medium mb-1">Drop your file here or click to browse</p>
            <p class="text-xs text-gray-500">Supports <strong>.csv</strong>, <strong>.xlsx</strong>, <strong>.xls</strong> (max 500 rows)</p>
          </div>
          <input type="file" id="bulk-file-input" accept=".csv,.xlsx,.xls" class="hidden" onchange="handleBulkFile(this.files[0])">

          <div class="mt-4 glass rounded-lg p-4">
            <h4 class="text-xs font-semibold text-gray-300 mb-2"><i class="fas fa-info-circle text-primary-400 mr-1.5"></i>Required Columns</h4>
            <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
              <span class="text-white font-medium">name <span class="text-red-400">*</span></span>
              <span class="text-gray-500">Full name</span>
              <span class="text-white font-medium">email <span class="text-red-400">*</span></span>
              <span class="text-gray-500">Email address</span>
              <span class="text-gray-400">company</span>
              <span class="text-gray-500">Company name</span>
              <span class="text-gray-400">job_title</span>
              <span class="text-gray-500">Job title</span>
              <span class="text-gray-400">bio</span>
              <span class="text-gray-500">Short biography</span>
              <span class="text-gray-400">interests</span>
              <span class="text-gray-500">Comma-separated</span>
              <span class="text-gray-400">linkedin_url</span>
              <span class="text-gray-500">LinkedIn profile URL</span>
              <span class="text-gray-400">mobile</span>
              <span class="text-gray-500">Mobile / phone number</span>
              <span class="text-gray-400">lunch_inclusion</span>
              <span class="text-gray-500">Yes / No</span>
              <span class="text-gray-400">role</span>
              <span class="text-gray-500">attendee / speaker / vip / ...</span>
              <span class="text-gray-400">badge_type</span>
              <span class="text-gray-500">Delegate / VIP Guest / Exhibitor / ...</span>
            </div>
            <div class="mt-3 flex gap-2">
              <button onclick="downloadTemplate('csv')" class="px-3 py-1.5 rounded-lg text-[11px] font-medium glass hover:bg-white/10 transition"><i class="fas fa-file-csv mr-1 text-green-400"></i>Download CSV Template</button>
              <button onclick="downloadTemplate('xlsx')" class="px-3 py-1.5 rounded-lg text-[11px] font-medium glass hover:bg-white/10 transition"><i class="fas fa-file-excel mr-1 text-green-400"></i>Download Excel Template</button>
            </div>
          </div>
        </div>

        <!-- Step 2: Preview (hidden initially) -->
        <div id="bulk-step-preview" class="hidden">
          <div class="flex items-center justify-between mb-3">
            <div>
              <span id="bulk-file-name" class="text-xs text-primary-300 font-medium"></span>
              <span id="bulk-row-count" class="text-xs text-gray-500 ml-2"></span>
            </div>
            <button onclick="resetBulkUpload()" class="text-xs text-gray-400 hover:text-white transition"><i class="fas fa-times mr-1"></i>Change file</button>
          </div>

          <!-- Validation Summary -->
          <div id="bulk-validation" class="mb-3"></div>

          <!-- Preview Table -->
          <div class="glass rounded-lg overflow-hidden mb-4">
            <div class="overflow-x-auto max-h-[300px] overflow-y-auto scroll-hide">
              <table class="w-full text-xs" id="bulk-preview-table">
                <thead><tr class="text-gray-400 uppercase">
                  <th class="text-[10px] py-2 px-2">#</th><th class="text-[10px] py-2 px-2">Name</th><th class="text-[10px] py-2 px-2">Email</th><th class="text-[10px] py-2 px-2">Mobile</th><th class="text-[10px] py-2 px-2">Company</th><th class="text-[10px] py-2 px-2">LinkedIn</th><th class="text-[10px] py-2 px-2">Lunch</th><th class="text-[10px] py-2 px-2">Badge</th><th class="text-[10px] py-2 px-2">Status</th>
                </tr></thead>
                <tbody id="bulk-preview-body"></tbody>
              </table>
            </div>
          </div>

          <div class="flex gap-2">
            <button id="bulk-import-btn" onclick="executeBulkImport()" class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-green-600 hover:bg-green-500 text-white transition">
              <i class="fas fa-upload mr-1.5"></i>Import <span id="bulk-valid-count">0</span> Attendees
            </button>
            <button onclick="closeModal()" class="px-4 py-2.5 rounded-xl text-sm font-medium glass hover:bg-white/10">Cancel</button>
          </div>
        </div>

        <!-- Step 3: Results (hidden initially) -->
        <div id="bulk-step-results" class="hidden">
          <div id="bulk-results-content"></div>
          <button onclick="closeModal(); loadAdminAttendees();" class="w-full mt-4 py-2.5 rounded-xl text-sm font-medium bg-primary-600 hover:bg-primary-500 text-white transition"><i class="fas fa-check mr-1.5"></i>Done</button>
        </div>
      \`);
    }

    // ---- Template Downloads ----
    function downloadTemplate(format) {
      const headers = ['name','email','company','job_title','mobile','linkedin_url','lunch_inclusion','bio','interests','role','badge_type'];
      const sampleRows = [
        ['Jane Doe','jane@example.com','Acme Corp','Software Engineer','+91 98765 43210','https://linkedin.com/in/janedoe','Yes','Passionate about AI','AI, Machine Learning','attendee','Delegate'],
        ['John Smith','john@example.com','Tech Inc','Product Manager','+1 555-0100','https://linkedin.com/in/johnsmith','No','Building great products','Product, UX, Strategy','speaker','VIP Guest'],
      ];

      if (format === 'csv') {
        const csv = [headers.join(','), ...sampleRows.map(r => r.map(v => v.includes(',') ? '"'+v+'"' : v).join(','))].join('\\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'attendees_template.csv'; a.click();
        URL.revokeObjectURL(url);
      } else {
        if (typeof XLSX === 'undefined') { toast('Excel library loading, try again...', 'warning'); return; }
        const ws = XLSX.utils.aoa_to_sheet([headers, ...sampleRows]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Attendees');
        // Set column widths
        ws['!cols'] = headers.map(h => ({ wch: h === 'bio' ? 30 : h === 'linkedin_url' ? 35 : h === 'mobile' ? 18 : h === 'lunch_inclusion' ? 16 : 18 }));
        XLSX.writeFile(wb, 'attendees_template.xlsx');
      }
      toast('Template downloaded!', 'success');
    }

    // ---- File Handling ----
    function handleBulkDrop(e) {
      e.preventDefault();
      e.currentTarget.classList.remove('border-primary-500/50','bg-white/[0.02]');
      const file = e.dataTransfer?.files?.[0];
      if (file) handleBulkFile(file);
    }

    function handleBulkFile(file) {
      if (!file) return;
      const ext = file.name.split('.').pop().toLowerCase();
      if (!['csv','xlsx','xls'].includes(ext)) {
        toast('Please upload a CSV or Excel file', 'error');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast('File too large. Maximum 5MB', 'error');
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          let rows;
          if (ext === 'csv') {
            rows = parseCSV(e.target.result);
          } else {
            if (typeof XLSX === 'undefined') { toast('Excel library still loading. Please try again.', 'warning'); return; }
            const wb = XLSX.read(e.target.result, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(ws, { defval: '' });
            rows = jsonData;
          }
          if (rows.length === 0) { toast('File is empty or has no data rows', 'error'); return; }
          if (rows.length > 500) { toast('Maximum 500 rows allowed. File has ' + rows.length + ' rows.', 'error'); return; }
          bulkUploadData = normalizeRows(rows);
          showBulkPreview(file.name);
        } catch(err) {
          toast('Failed to parse file: ' + err.message, 'error');
        }
      };
      if (ext === 'csv') reader.readAsText(file);
      else reader.readAsArrayBuffer(file);
    }

    function parseCSV(text) {
      const lines = text.split(/\\r?\\n/).filter(l => l.trim());
      if (lines.length < 2) return [];
      // Parse header
      const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase().replace(/\\s+/g, '_'));
      const rows = [];
      for (let i = 1; i < lines.length; i++) {
        const vals = parseCSVLine(lines[i]);
        if (vals.length === 0 || vals.every(v => !v.trim())) continue;
        const row = {};
        headers.forEach((h, idx) => { row[h] = (vals[idx] || '').trim(); });
        rows.push(row);
      }
      return rows;
    }

    function parseCSVLine(line) {
      const result = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
          if (ch === '"' && line[i+1] === '"') { current += '"'; i++; }
          else if (ch === '"') { inQuotes = false; }
          else { current += ch; }
        } else {
          if (ch === '"') { inQuotes = true; }
          else if (ch === ',') { result.push(current); current = ''; }
          else { current += ch; }
        }
      }
      result.push(current);
      return result;
    }

    function normalizeRows(rows) {
      // Map common column name variations
      const colMap = {
        'name': ['name','full_name','fullname','attendee_name','attendeename'],
        'email': ['email','email_address','emailaddress','e-mail','mail'],
        'company': ['company','company_name','companyname','organization','org'],
        'job_title': ['job_title','jobtitle','title','job','position','designation'],
        'bio': ['bio','biography','about','description'],
        'interests': ['interests','interest','tags','skills'],
        'linkedin_url': ['linkedin_url','linkedin','linkedinurl','linkedin_profile','linkedin_url'],
        'mobile': ['mobile','mobile_number','mobilenumber','phone','phone_number','phonenumber','contact','cell','telephone','tel'],
        'lunch_inclusion': ['lunch_inclusion','lunch','lunchinclusion','lunch_included','meal','lunch_pass'],
        'role': ['role','type','attendee_type'],
        'badge_type': ['badge_type','badge','badgetype','badge_category'],
        'city': ['city','location','town'],
        'country': ['country','nation','country_name'],
        'registration_date': ['registration_date','registrationdate','reg_date','registered','registration'],
        'payment_amount': ['payment_amount','paymentamount','payment','amount','fee','price'],
      };

      return rows.map(row => {
        const normalized = {};
        const rowKeys = Object.keys(row);
        for (const [field, aliases] of Object.entries(colMap)) {
          const key = rowKeys.find(k => aliases.includes(k.toLowerCase().replace(/\\s+/g, '_')));
          normalized[field] = key ? row[key] : '';
        }
        return normalized;
      });
    }

    // ---- Preview ----
    function showBulkPreview(fileName) {
      document.getElementById('bulk-step-upload').classList.add('hidden');
      document.getElementById('bulk-step-preview').classList.remove('hidden');
      document.getElementById('bulk-file-name').textContent = fileName;
      document.getElementById('bulk-row-count').textContent = bulkUploadData.length + ' rows';

      // Validate
      let validCount = 0;
      let errorCount = 0;
      let dupEmails = new Set();
      let seenEmails = new Set();

      const tbody = document.getElementById('bulk-preview-body');
      tbody.innerHTML = bulkUploadData.map((r, i) => {
        let status = '';
        let statusClass = '';
        const hasName = r.name && r.name.trim();
        const hasEmail = r.email && r.email.trim();
        const emailLower = (r.email || '').trim().toLowerCase();
        const isDup = seenEmails.has(emailLower);
        seenEmails.add(emailLower);

        if (!hasName || !hasEmail) {
          status = 'Missing required'; statusClass = 'text-red-400'; errorCount++;
        } else if (isDup) {
          status = 'Duplicate email'; statusClass = 'text-yellow-400'; errorCount++; dupEmails.add(emailLower);
        } else {
          status = 'Ready'; statusClass = 'text-green-400'; validCount++;
        }

        return \`<tr class="\${statusClass === 'text-red-400' ? 'opacity-50' : ''}">
          <td class="text-gray-500 py-1.5 px-2">\${i+1}</td>
          <td class="py-1.5 px-2 font-medium \${!hasName ? 'text-red-400' : ''}">\${r.name || '<span class=text-red-400>MISSING</span>'}</td>
          <td class="py-1.5 px-2 \${!hasEmail ? 'text-red-400' : ''}">\${r.email || '<span class=text-red-400>MISSING</span>'}</td>
          <td class="py-1.5 px-2 text-gray-400">\${r.mobile || '-'}</td>
          <td class="py-1.5 px-2 text-gray-400">\${r.company || '-'}</td>
          <td class="py-1.5 px-2 text-xs">\${r.linkedin_url ? '<a href="'+r.linkedin_url+'" target="_blank" class="text-blue-400"><i class="fab fa-linkedin"></i></a>' : '-'}</td>
          <td class="py-1.5 px-2"><span class="px-1.5 py-0.5 rounded text-[10px] \${(r.lunch_inclusion||'Yes')==='Yes' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}">\${r.lunch_inclusion || 'Yes'}</span></td>
          <td class="py-1.5 px-2"><span class="px-1.5 py-0.5 rounded text-[10px] \${getBadgeClass(r.badge_type || 'Delegate')}">\${r.badge_type || 'Delegate'}</span></td>
          <td class="py-1.5 px-2"><span class="\${statusClass} text-[10px] font-medium">\${status}</span></td>
        </tr>\`;
      }).join('');

      // Validation summary
      const valEl = document.getElementById('bulk-validation');
      if (errorCount > 0) {
        valEl.innerHTML = \`
          <div class="flex gap-3 text-xs">
            <span class="px-2.5 py-1 rounded-lg bg-green-500/15 text-green-400 font-medium"><i class="fas fa-check mr-1"></i>\${validCount} valid</span>
            <span class="px-2.5 py-1 rounded-lg bg-red-500/15 text-red-400 font-medium"><i class="fas fa-exclamation-triangle mr-1"></i>\${errorCount} issues (will be skipped)</span>
          </div>
        \`;
      } else {
        valEl.innerHTML = '<span class="text-xs px-2.5 py-1 rounded-lg bg-green-500/15 text-green-400 font-medium"><i class="fas fa-check-circle mr-1"></i>All ' + validCount + ' rows valid and ready to import</span>';
      }

      document.getElementById('bulk-valid-count').textContent = validCount;
      if (validCount === 0) {
        document.getElementById('bulk-import-btn').disabled = true;
        document.getElementById('bulk-import-btn').classList.add('opacity-50', 'cursor-not-allowed');
      }
    }

    function resetBulkUpload() {
      bulkUploadData = [];
      document.getElementById('bulk-step-upload').classList.remove('hidden');
      document.getElementById('bulk-step-preview').classList.add('hidden');
      document.getElementById('bulk-step-results').classList.add('hidden');
      document.getElementById('bulk-file-input').value = '';
    }

    // ---- Execute Import ----
    async function executeBulkImport() {
      const btn = document.getElementById('bulk-import-btn');
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1.5"></i>Importing...';
      btn.disabled = true;

      // Filter only valid rows
      const seenEmails = new Set();
      const validRows = bulkUploadData.filter(r => {
        if (!r.name?.trim() || !r.email?.trim()) return false;
        const e = r.email.trim().toLowerCase();
        if (seenEmails.has(e)) return false;
        seenEmails.add(e);
        return true;
      });

      try {
        const result = await api.post('/api/admin/attendees/bulk', {
          event_id: EID,
          attendees: validRows
        });

        document.getElementById('bulk-step-preview').classList.add('hidden');
        document.getElementById('bulk-step-results').classList.remove('hidden');

        let html = '<div class="text-center py-4">';
        if (result.imported > 0) {
          html += '<div class="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4"><i class="fas fa-check-circle text-3xl text-green-400"></i></div>';
          html += '<h3 class="text-xl font-bold mb-1">Import Complete!</h3>';
        } else {
          html += '<div class="w-16 h-16 rounded-full bg-yellow-500/20 flex items-center justify-center mx-auto mb-4"><i class="fas fa-exclamation-triangle text-3xl text-yellow-400"></i></div>';
          html += '<h3 class="text-xl font-bold mb-1">Import Finished</h3>';
        }
        html += '</div>';

        html += '<div class="grid grid-cols-2 gap-3 mb-4">';
        html += '<div class="glass rounded-lg p-3 text-center"><div class="text-2xl font-bold text-green-400">' + result.imported + '</div><div class="text-[10px] text-gray-500 uppercase">Imported</div></div>';
        html += '<div class="glass rounded-lg p-3 text-center"><div class="text-2xl font-bold text-yellow-400">' + result.skipped + '</div><div class="text-[10px] text-gray-500 uppercase">Skipped</div></div>';
        html += '</div>';

        if (result.errors && result.errors.length > 0) {
          html += '<div class="glass rounded-lg p-3 max-h-[150px] overflow-y-auto scroll-hide">';
          html += '<h4 class="text-xs font-semibold text-gray-300 mb-2"><i class="fas fa-exclamation-circle text-yellow-400 mr-1"></i>Details</h4>';
          html += '<div class="space-y-1">';
          result.errors.slice(0, 20).forEach(err => {
            html += '<p class="text-[11px] text-gray-400"><i class="fas fa-minus text-[8px] text-gray-600 mr-1.5"></i>' + err + '</p>';
          });
          if (result.errors.length > 20) html += '<p class="text-[11px] text-gray-500 mt-1">...and ' + (result.errors.length - 20) + ' more</p>';
          html += '</div></div>';
        }

        document.getElementById('bulk-results-content').innerHTML = html;
        toast(result.imported + ' attendees imported!', 'success');

      } catch(err) {
        toast('Import failed: ' + err.message, 'error');
        btn.innerHTML = '<i class="fas fa-upload mr-1.5"></i>Retry Import';
        btn.disabled = false;
      }
    }

    // ============ INLINE EDITING ============
    function esc(s) { return (s||'').replace(/'/g,"&apos;").replace(/"/g,'&quot;'); }

    let activeInlineEdit = null;
    function cancelActiveInlineEdit() {
      if (activeInlineEdit) {
        const { cell, original } = activeInlineEdit;
        cell.innerHTML = original;
        activeInlineEdit = null;
      }
    }

    async function inlineSave(id, field, value) {
      try {
        const res = await fetch('/api/admin/attendees/' + id, {
          method: 'PATCH',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ [field]: value })
        });
        if (res.status === 401) { handleAuthFailure(); return false; }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Save failed');
        return true;
      } catch(e) {
        toast('Failed to save: ' + e.message, 'error');
        return false;
      }
    }

    function inlineEdit(cell, id, field, currentVal) {
      if (activeInlineEdit && activeInlineEdit.cell === cell) return;
      cancelActiveInlineEdit();
      const original = cell.innerHTML;
      activeInlineEdit = { cell, original };
      const input = document.createElement('input');
      input.type = 'text';
      input.value = currentVal;
      input.className = 'w-full px-2 py-1 rounded text-xs bg-white/10 border border-primary-500/50 text-white outline-none focus:ring-1 focus:ring-primary-400';
      input.style.minWidth = '60px';
      cell.innerHTML = '';
      cell.appendChild(input);
      input.focus();
      input.select();

      async function save() {
        const newVal = input.value.trim();
        if (newVal === currentVal) { cell.innerHTML = original; activeInlineEdit = null; return; }
        input.disabled = true;
        input.style.opacity = '0.5';
        const ok = await inlineSave(id, field, newVal);
        if (ok) {
          activeInlineEdit = null;
          // Update display
          if (field === 'name') { cell.innerHTML = newVal; cell.setAttribute('onclick', "inlineEdit(this, "+id+", 'name', '"+esc(newVal)+"')"); }
          else if (field === 'email') { cell.innerHTML = newVal; cell.setAttribute('onclick', "inlineEdit(this, "+id+", 'email', '"+esc(newVal)+"')"); }
          else { cell.innerHTML = newVal || '<span class=&quot;text-gray-600&quot;>-</span>'; cell.setAttribute('onclick', "inlineEdit(this, "+id+", '"+field+"', '"+esc(newVal)+"')"); }
          toast('Saved', 'success');
        } else {
          cell.innerHTML = original;
          activeInlineEdit = null;
        }
      }
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
        if (e.key === 'Escape') { cell.innerHTML = original; activeInlineEdit = null; }
      });
      input.addEventListener('blur', () => { setTimeout(save, 100); });
    }

    function inlineSelect(cell, id, field, currentVal, options) {
      if (activeInlineEdit && activeInlineEdit.cell === cell) return;
      cancelActiveInlineEdit();
      const original = cell.innerHTML;
      activeInlineEdit = { cell, original };

      const select = document.createElement('select');
      select.className = 'px-1 py-1 rounded text-xs bg-[#1e1e2e] border border-primary-500/50 text-white outline-none focus:ring-1 focus:ring-primary-400';

      const labels = {};
      if (field === 'rsvp_status') { labels[''] = '— None'; labels['confirmed'] = '✓ Yes'; labels['maybe'] = '? Maybe'; labels['declined'] = '✗ No'; }
      else if (field === 'arrival_time') { labels[''] = '— Not set'; }

      options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = labels[opt] || opt;
        if (opt === currentVal) o.selected = true;
        select.appendChild(o);
      });
      cell.innerHTML = '';
      cell.appendChild(select);
      select.focus();

      async function save() {
        const newVal = select.value;
        if (newVal === currentVal) { cell.innerHTML = original; activeInlineEdit = null; return; }
        select.disabled = true;
        select.style.opacity = '0.5';
        const ok = await inlineSave(id, field, newVal);
        activeInlineEdit = null;
        if (ok) {
          toast('Saved', 'success');
          loadAdminAttendees(id); // Reload and scroll back to this row
        } else {
          cell.innerHTML = original;
        }
      }
      select.addEventListener('change', save);
      select.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { cell.innerHTML = original; activeInlineEdit = null; }
      });
      select.addEventListener('blur', () => { setTimeout(() => { if (activeInlineEdit && activeInlineEdit.cell === cell) save(); }, 150); });
    }

    const ROLE_OPTIONS = ['Visitor Pass','Exhibitor','Star Rating','Finalist Startup','Finalist Enterprise','Delegate Pass (paid)','VIP Pass (paid)','VIP Guest (CTO/CIO/other)','Investor','Jury Morning','Jury Evening','Jury Whole Day','Speaker','Family & Friends Guest'];

    function inlineMultiSelect(cell, id, field, currentVal) {
      if (activeInlineEdit && activeInlineEdit.cell === cell) return;
      cancelActiveInlineEdit();
      const original = cell.innerHTML;
      activeInlineEdit = { cell, original };

      const selected = new Set(currentVal.split(',').map(s => s.trim()).filter(Boolean));
      const dropdown = document.createElement('div');
      dropdown.className = 'absolute z-50 bg-[#1a1a2e] border border-primary-500/40 rounded-lg shadow-xl p-2 w-52 max-h-64 overflow-y-auto scroll-hide';
      dropdown.style.left = '0'; dropdown.style.top = '100%';

      let html = '<div class="text-[10px] text-gray-500 uppercase font-semibold px-1 mb-1">Select Roles</div>';
      ROLE_OPTIONS.forEach(opt => {
        const checked = selected.has(opt) ? 'checked' : '';
        html += '<label class="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/5 cursor-pointer text-xs text-gray-300"><input type="checkbox" value="'+opt+'" '+checked+' class="accent-primary-500 rounded" style="width:14px;height:14px;"><span>'+opt+'</span></label>';
      });
      html += '<div class="border-t border-white/10 mt-2 pt-2 flex gap-2"><button id="ms-save" class="flex-1 py-1.5 rounded-lg text-[11px] font-medium bg-primary-600 hover:bg-primary-500 text-white transition">Save</button><button id="ms-cancel" class="flex-1 py-1.5 rounded-lg text-[11px] font-medium glass hover:bg-white/10 text-gray-400 transition">Cancel</button></div>';
      dropdown.innerHTML = html;

      cell.style.position = 'relative';
      cell.innerHTML = '';
      cell.appendChild(dropdown);

      dropdown.querySelector('#ms-cancel').addEventListener('click', (e) => {
        e.stopPropagation();
        cell.innerHTML = original;
        activeInlineEdit = null;
      });

      dropdown.querySelector('#ms-save').addEventListener('click', async (e) => {
        e.stopPropagation();
        const checks = dropdown.querySelectorAll('input[type=checkbox]:checked');
        const newRoles = Array.from(checks).map(c => c.value);
        const newVal = newRoles.length > 0 ? newRoles.join(', ') : 'Visitor Pass';
        if (newVal === currentVal) { cell.innerHTML = original; activeInlineEdit = null; return; }
        dropdown.querySelector('#ms-save').disabled = true;
        dropdown.querySelector('#ms-save').textContent = 'Saving...';
        const ok = await inlineSave(id, field, newVal);
        activeInlineEdit = null;
        if (ok) {
          toast('Roles updated', 'success');
          loadAdminAttendees(id);
        } else {
          cell.innerHTML = original;
        }
      });

      // Prevent click from propagating to cell
      dropdown.addEventListener('click', (e) => e.stopPropagation());
    }

    // Close inline edit when clicking outside
    document.addEventListener('click', (e) => {
      if (activeInlineEdit && !activeInlineEdit.cell.contains(e.target)) {
        // Let blur handler deal with saving
      }
    });

    // ============ COLUMN RESIZE ============
    const COL_NAMES = ['ID','','Name','Email','Mobile','Company','Title','City','Country','In','Role','Badge','RSVP','Lunch','Arrival','Reg Date','Payment','Notif','Engage','Actions'];
    const COL_DEFAULTS = {compact:[40,32,100,140,80,100,90,60,55,32,90,75,50,40,50,65,55,38,65,120], normal:[50,40,130,180,100,130,110,80,70,40,110,90,60,45,60,80,70,45,80,140], wide:[60,48,180,240,130,180,150,110,90,45,150,120,75,55,75,100,90,55,100,170]};

    (function initColumnResize() {
      let resizing = null;
      document.addEventListener('mousedown', (e) => {
        if (!e.target.classList.contains('col-resizer')) return;
        e.preventDefault();
        const th = e.target.parentElement;
        const startX = e.clientX;
        const startW = th.offsetWidth;
        e.target.classList.add('active');
        resizing = { th, startX, startW, handle: e.target };
      });
      document.addEventListener('mousemove', (e) => {
        if (!resizing) return;
        const newW = Math.max(30, resizing.startW + (e.clientX - resizing.startX));
        resizing.th.style.width = newW + 'px';
      });
      document.addEventListener('mouseup', () => {
        if (resizing) {
          resizing.handle.classList.remove('active');
          saveColumnWidths();
          resizing = null;
        }
      });
    })();

    function saveColumnWidths() {
      const table = document.getElementById('attendee-table');
      if (!table) return;
      const widths = Array.from(table.querySelectorAll('thead th')).map(th => th.style.width || '');
      localStorage.setItem('att_col_widths', JSON.stringify(widths));
    }

    function restoreColumnWidths() {
      const saved = localStorage.getItem('att_col_widths');
      if (!saved) return;
      try {
        const widths = JSON.parse(saved);
        const table = document.getElementById('attendee-table');
        if (!table) return;
        const ths = table.querySelectorAll('thead th');
        widths.forEach((w, i) => { if (w && ths[i]) ths[i].style.width = w; });
      } catch(e) {}
      restoreHiddenCols();
    }

    function restoreHiddenCols() {
      try {
        const hidden = JSON.parse(localStorage.getItem('att_hidden_cols') || '[]');
        const table = document.getElementById('attendee-table');
        if (!table) return;
        hidden.forEach(ci => {
          table.querySelectorAll('tr').forEach(row => {
            const cells = row.children;
            if (cells[ci]) cells[ci].classList.add('att-col-hidden');
          });
        });
      } catch(e) {}
    }

    function toggleColSettings() {
      const wrap = document.getElementById('col-settings-wrap');
      let dd = wrap.querySelector('.col-settings-dropdown');
      if (dd) { dd.remove(); return; }
      const hidden = JSON.parse(localStorage.getItem('att_hidden_cols') || '[]');
      const currentPreset = localStorage.getItem('att_col_preset') || 'normal';
      dd = document.createElement('div');
      dd.className = 'col-settings-dropdown';
      dd.innerHTML = '<div class="text-xs font-semibold text-gray-300 mb-2 px-1"><i class="fas fa-columns mr-1"></i> Column Settings</div>'
        + '<div class="text-[10px] text-gray-500 mb-2 px-1">Drag column borders to resize. Toggle visibility below.</div>'
        + '<div class="flex gap-1.5 mb-3 px-1"><span class="text-[10px] text-gray-500 mr-1 self-center">Presets:</span>'
        + ['compact','normal','wide'].map(p => '<button class="col-preset-btn '+(p===currentPreset?'active':'')+'" onclick="applyColPreset(&quot;'+p+'&quot;)">' + p.charAt(0).toUpperCase()+p.slice(1) + '</button>').join('')
        + '<button class="col-preset-btn" onclick="resetColWidths()" title="Reset to default"><i class="fas fa-undo"></i></button></div>'
        + '<div class="border-t border-white/5 pt-2">'
        + COL_NAMES.map((name, i) => {
            if (!name) return '';
            return '<label><input type="checkbox" '+(hidden.includes(i)?'':'checked')+' onchange="toggleColumn('+i+', this.checked)"><span>'+name+'</span></label>';
          }).join('')
        + '</div>'
        + '<div class="border-t border-white/5 mt-2 pt-2 flex gap-2"><button class="col-preset-btn flex-1" onclick="showAllColumns()"><i class="fas fa-eye mr-1"></i>Show All</button><button class="col-preset-btn flex-1" onclick="hideNonEssentialCols()"><i class="fas fa-eye-slash mr-1"></i>Essential Only</button></div>';
      wrap.appendChild(dd);
      // Close on outside click
      setTimeout(() => {
        const closer = (ev) => { if (!wrap.contains(ev.target)) { dd.remove(); document.removeEventListener('click', closer); } };
        document.addEventListener('click', closer);
      }, 10);
    }

    function toggleColumn(colIndex, show) {
      const table = document.getElementById('attendee-table');
      if (!table) return;
      table.querySelectorAll('tr').forEach(row => {
        const cells = row.children;
        if (cells[colIndex]) { show ? cells[colIndex].classList.remove('att-col-hidden') : cells[colIndex].classList.add('att-col-hidden'); }
      });
      let hidden = JSON.parse(localStorage.getItem('att_hidden_cols') || '[]');
      if (show) { hidden = hidden.filter(i => i !== colIndex); } else { if (!hidden.includes(colIndex)) hidden.push(colIndex); }
      localStorage.setItem('att_hidden_cols', JSON.stringify(hidden));
    }

    function showAllColumns() {
      const table = document.getElementById('attendee-table');
      if (!table) return;
      table.querySelectorAll('.att-col-hidden').forEach(el => el.classList.remove('att-col-hidden'));
      localStorage.setItem('att_hidden_cols', '[]');
      // Refresh dropdown
      const wrap = document.getElementById('col-settings-wrap');
      const dd = wrap?.querySelector('.col-settings-dropdown');
      if (dd) { dd.remove(); toggleColSettings(); }
    }

    function hideNonEssentialCols() {
      // Hide: City(7), Country(8), LinkedIn(9), Arrival(14), RegDate(15), Notif(17), Engage(18)
      const toHide = [7,8,9,14,15,17,18];
      const table = document.getElementById('attendee-table');
      if (!table) return;
      // First show all
      table.querySelectorAll('.att-col-hidden').forEach(el => el.classList.remove('att-col-hidden'));
      toHide.forEach(ci => {
        table.querySelectorAll('tr').forEach(row => {
          if (row.children[ci]) row.children[ci].classList.add('att-col-hidden');
        });
      });
      localStorage.setItem('att_hidden_cols', JSON.stringify(toHide));
      const wrap = document.getElementById('col-settings-wrap');
      const dd = wrap?.querySelector('.col-settings-dropdown');
      if (dd) { dd.remove(); toggleColSettings(); }
    }

    function applyColPreset(preset) {
      const widths = COL_DEFAULTS[preset];
      if (!widths) return;
      const table = document.getElementById('attendee-table');
      if (!table) return;
      const ths = table.querySelectorAll('thead th');
      widths.forEach((w, i) => { if (ths[i]) ths[i].style.width = w + 'px'; });
      localStorage.setItem('att_col_preset', preset);
      saveColumnWidths();
      toast('Column widths: ' + preset.charAt(0).toUpperCase() + preset.slice(1), 'info');
      // Refresh dropdown to highlight active
      const wrap = document.getElementById('col-settings-wrap');
      const dd = wrap?.querySelector('.col-settings-dropdown');
      if (dd) { dd.remove(); toggleColSettings(); }
    }

    function resetColWidths() {
      localStorage.removeItem('att_col_widths');
      localStorage.removeItem('att_col_preset');
      localStorage.removeItem('att_hidden_cols');
      loadAdminAttendees();
      toast('Column settings reset to default', 'info');
    }

    function sortIcon(col) {
      if (attSortCol !== col) return '<span class="sort-icon"><i class="fas fa-sort"></i></span>';
      return '<span class="sort-icon active"><i class="fas fa-sort-' + (attSortDir === 'asc' ? 'up' : 'down') + '"></i></span>';
    }

    function applyAttSort(arr, col, dir) {
      const m = dir === 'asc' ? 1 : -1;
      arr.sort((a, b) => {
        let va = a[col], vb = b[col];
        if (col === 'id') return (va - vb) * m;
        if (col === 'payment_amount') {
          const na = parseFloat((va||'').replace(/[^0-9.]/g,'')) || 0;
          const nb = parseFloat((vb||'').replace(/[^0-9.]/g,'')) || 0;
          return (na - nb) * m;
        }
        va = (va || '').toString().toLowerCase();
        vb = (vb || '').toString().toLowerCase();
        if (va < vb) return -1 * m;
        if (va > vb) return 1 * m;
        return 0;
      });
    }

    function sortAttendees(col) {
      if (attSortCol === col) {
        attSortDir = attSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        attSortCol = col;
        attSortDir = 'asc';
      }
      loadAdminAttendees();
    }

    function resetAttSort() {
      attSortCol = null;
      attSortDir = 'asc';
      loadAdminAttendees();
    }

    function filterAdminAttendees() {
      const q = document.getElementById('admin-att-search').value.toLowerCase();
      document.querySelectorAll('.att-row').forEach(r => {
        r.style.display = r.dataset.search.includes(q) ? '' : 'none';
      });
    }

    function openAddAttendee() {
      const box = document.getElementById('modal-box');
      box.innerHTML = \`
        <form id="add-att-form" class="flex flex-col h-full max-h-[90vh]">
          <div class="p-6 pb-3 border-b border-white/10 shrink-0">
            <div class="flex items-center gap-3">
              <div class="w-12 h-12 rounded-full bg-primary-600 flex items-center justify-center"><i class="fas fa-user-plus text-white text-lg"></i></div>
              <div>
                <h3 class="text-lg font-bold">Add New Attendee</h3>
                <p class="text-xs text-gray-400">Manually add a single attendee to the event</p>
              </div>
            </div>
          </div>
          <div class="p-6 py-4 overflow-y-auto flex-1 space-y-3" style="scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.15) transparent;">
            <div class="grid grid-cols-2 gap-3">
              <div><label class="text-xs text-gray-400 mb-1 block">Name *</label><input id="na-name" class="w-full px-3 py-2 rounded-lg text-sm" required placeholder="Full name"></div>
              <div><label class="text-xs text-gray-400 mb-1 block">Email *</label><input id="na-email" type="email" class="w-full px-3 py-2 rounded-lg text-sm" required placeholder="email@example.com"></div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div><label class="text-xs text-gray-400 mb-1 block">Company</label><input id="na-company" class="w-full px-3 py-2 rounded-lg text-sm" placeholder="Company name"></div>
              <div><label class="text-xs text-gray-400 mb-1 block">Job Title</label><input id="na-title" class="w-full px-3 py-2 rounded-lg text-sm" placeholder="e.g. CEO, CTO"></div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div><label class="text-xs text-gray-400 mb-1 block">Mobile</label><input id="na-mobile" class="w-full px-3 py-2 rounded-lg text-sm" placeholder="+91 98765 43210"></div>
              <div><label class="text-xs text-gray-400 mb-1 block">LinkedIn URL</label><input id="na-linkedin" class="w-full px-3 py-2 rounded-lg text-sm" placeholder="https://linkedin.com/in/..."></div>
            </div>
            <div class="grid grid-cols-3 gap-3">
              <div><label class="text-xs text-gray-400 mb-1 block">Role</label>
                <select id="na-role" class="w-full px-3 py-2 rounded-lg text-sm">
                  \${['Visitor Pass','Exhibitor','Star Rating','Finalist Startup','Finalist Enterprise','Delegate Pass (paid)','VIP Pass (paid)','VIP Guest (CTO/CIO/other)','Investor','Jury Morning','Jury Evening','Jury Whole Day','Speaker','Family & Friends Guest'].map(r=>'<option value="'+r+'">'+r+'</option>').join('')}
                </select></div>
              <div><label class="text-xs text-gray-400 mb-1 block">Badge Type</label>
                <select id="na-badge" class="w-full px-3 py-2 rounded-lg text-sm">
                  \${['Delegate','Organiser','VIP Guest','Exhibitor','Exhibition Speaker','Jury','Visitor Pass','Media','Support Staff','Investor','Felicitation Delegate','VIP Pass'].map(b=>'<option value="'+b+'">'+b+'</option>').join('')}
                </select></div>
              <div><label class="text-xs text-gray-400 mb-1 block">Lunch</label>
                <select id="na-lunch" class="w-full px-3 py-2 rounded-lg text-sm">
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select></div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div><label class="text-xs text-gray-400 mb-1 block">Arrival Time</label>
                <select id="na-arrival" class="w-full px-3 py-2 rounded-lg text-sm">
                  <option value="">Not set</option>
                  \${['09:00','09:30','10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30','16:00','16:30'].map(t=>'<option value="'+t+'">'+t+'</option>').join('')}
                </select></div>
              <div><label class="text-xs text-gray-400 mb-1 block">Twitter URL</label><input id="na-twitter" class="w-full px-3 py-2 rounded-lg text-sm" placeholder="https://twitter.com/..."></div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div><label class="text-xs text-gray-400 mb-1 block">Website URL</label><input id="na-website" class="w-full px-3 py-2 rounded-lg text-sm" placeholder="https://..."></div>
              <div></div>
            </div>
            <div><label class="text-xs text-gray-400 mb-1 block">Bio</label><textarea id="na-bio" rows="2" class="w-full px-3 py-2 rounded-lg text-sm" placeholder="Short bio..."></textarea></div>
            <div><label class="text-xs text-gray-400 mb-1 block">Interests (comma-separated)</label><input id="na-interests" class="w-full px-3 py-2 rounded-lg text-sm" placeholder="e.g. AI, Cloud, IoT"></div>
          </div>
          <div class="p-6 pt-3 border-t border-white/10 shrink-0 flex gap-2">
            <button type="submit" id="na-submit-btn" class="flex-1 py-3 rounded-xl text-sm font-semibold bg-primary-600 hover:bg-primary-500 text-white transition"><i class="fas fa-user-plus mr-2"></i>Add Attendee</button>
            <button type="button" onclick="closeModal()" class="px-6 py-3 rounded-xl text-sm font-medium glass hover:bg-white/10 transition">Cancel</button>
          </div>
        </form>
      \`;
      document.getElementById('modal-container').classList.remove('hidden');
      document.getElementById('add-att-form').onsubmit = async e => {
        e.preventDefault();
        const btn = document.getElementById('na-submit-btn');
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Adding...';
        btn.disabled = true;
        try {
          await api.post('/api/admin/attendees', {
            event_id: EID,
            name: document.getElementById('na-name').value,
            email: document.getElementById('na-email').value,
            company: document.getElementById('na-company').value,
            job_title: document.getElementById('na-title').value,
            mobile: document.getElementById('na-mobile').value,
            linkedin_url: document.getElementById('na-linkedin').value,
            role: document.getElementById('na-role').value,
            badge_type: document.getElementById('na-badge').value,
            lunch_inclusion: document.getElementById('na-lunch').value,
            arrival_time: document.getElementById('na-arrival').value,
            twitter_url: document.getElementById('na-twitter').value,
            website_url: document.getElementById('na-website').value,
            bio: document.getElementById('na-bio').value,
            interests: document.getElementById('na-interests').value,
          });
          closeModal(); toast('Attendee added successfully!', 'success'); loadAdminAttendees();
        } catch(err) {
          toast(err.message || 'Failed to add attendee', 'error');
          btn.innerHTML = '<i class="fas fa-user-plus mr-2"></i>Add Attendee';
          btn.disabled = false;
        }
      };
    }

    function openEditAttendee(a) {
      // Use custom modal layout with fixed footer for Save button visibility
      const box = document.getElementById('modal-box');
      box.innerHTML = \`
        <form id="edit-att-form" class="flex flex-col h-full max-h-[90vh]">
          <div class="p-6 pb-3 border-b border-white/10 shrink-0">
            <div class="flex items-center gap-3">
              <img src="\${getAvatarUrl(a.email, a.name, 96, a.avatar_url)}" alt="\${a.name}" class="w-12 h-12 rounded-full object-cover">
              <div>
                <h3 class="text-lg font-bold">Edit Attendee #\${a.id}</h3>
                <p class="text-xs text-gray-400">\${a.name} &middot; \${a.email}</p>
              </div>
            </div>
          </div>
          <div class="p-6 py-4 overflow-y-auto flex-1 space-y-3" style="scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.15) transparent;">
            <!-- Admin Photo Upload -->
            <div class="flex items-center gap-3 p-3 rounded-xl glass-light">
              <div class="relative">
                <img id="ea-avatar-preview" src="\${getAvatarUrl(a.email, a.name, 96, a.avatar_url)}" alt="" class="w-12 h-12 rounded-full object-cover">
                <label for="ea-avatar-input" class="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-primary-600 hover:bg-primary-500 flex items-center justify-center cursor-pointer transition">
                  <i class="fas fa-camera text-white" style="font-size:10px"></i>
                </label>
                <input type="file" id="ea-avatar-input" accept="image/*" class="hidden" data-attendee-id="\${a.id}">
              </div>
              <div class="flex-1">
                <p class="text-xs font-medium">Profile Photo</p>
                <p class="text-[10px] text-gray-500">Click camera to upload. Auto-resized to 256px.</p>
              </div>
              <button type="button" id="ea-remove-avatar" class="text-xs text-red-400 hover:text-red-300 \${a.avatar_url && a.avatar_url.startsWith('data:image/') ? '' : 'hidden'}" data-attendee-id="\${a.id}">
                <i class="fas fa-trash-alt"></i>
              </button>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div><label class="text-xs text-gray-400 mb-1 block">Name *</label><input id="ea-name" value="\${a.name}" class="w-full px-3 py-2 rounded-lg text-sm" required></div>
              <div><label class="text-xs text-gray-400 mb-1 block">Email *</label><input id="ea-email" value="\${a.email}" class="w-full px-3 py-2 rounded-lg text-sm" required></div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div><label class="text-xs text-gray-400 mb-1 block">Company</label><input id="ea-company" value="\${a.company||''}" class="w-full px-3 py-2 rounded-lg text-sm"></div>
              <div><label class="text-xs text-gray-400 mb-1 block">Job Title</label><input id="ea-title" value="\${a.job_title||''}" class="w-full px-3 py-2 rounded-lg text-sm"></div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div><label class="text-xs text-gray-400 mb-1 block">Mobile</label><input id="ea-mobile" value="\${a.mobile||''}" class="w-full px-3 py-2 rounded-lg text-sm" placeholder="+91 98765 43210"></div>
              <div><label class="text-xs text-gray-400 mb-1 block">LinkedIn URL</label><input id="ea-linkedin" value="\${a.linkedin_url||''}" class="w-full px-3 py-2 rounded-lg text-sm" placeholder="https://linkedin.com/in/..."></div>
            </div>
            <div class="grid grid-cols-3 gap-3">
              <div><label class="text-xs text-gray-400 mb-1 block">Role</label>
                <select id="ea-role" class="w-full px-3 py-2 rounded-lg text-sm">
                  \${['Visitor Pass','Exhibitor','Star Rating','Finalist Startup','Finalist Enterprise','Delegate Pass (paid)','VIP Pass (paid)','VIP Guest (CTO/CIO/other)','Investor','Jury Morning','Jury Evening','Jury Whole Day','Speaker','Family & Friends Guest'].map(r=>'<option value="'+r+'" '+(a.role===r?'selected':'')+'>'+r+'</option>').join('')}
                </select></div>
              <div><label class="text-xs text-gray-400 mb-1 block">Badge</label>
                <select id="ea-badge" class="w-full px-3 py-2 rounded-lg text-sm">
                  \${['Delegate Pass','VIP Pass','Academic Pass','Visitor Pass','Media Pass','Organiser','VIP Guest','Exhibitor','Delegate','Exhibition Speaker','Jury','Media','Support Staff','Investor','Felicitation Delegate'].map(b=>'<option value="'+b+'" '+(a.badge_type===b?'selected':'')+'>'+b+'</option>').join('')}
                </select></div>
              <div><label class="text-xs text-gray-400 mb-1 block">Lunch</label>
                <select id="ea-lunch" class="w-full px-3 py-2 rounded-lg text-sm">
                  \${['Yes','No'].map(l=>'<option value="'+l+'" '+((a.lunch_inclusion||'Yes')===l?'selected':'')+'>'+l+'</option>').join('')}
                </select></div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div><label class="text-xs text-gray-400 mb-1 block">Arrival Time</label>
                <select id="ea-arrival" class="w-full px-3 py-2 rounded-lg text-sm">
                  <option value="">Not set</option>
                  \${['09:00','09:30','10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30','16:00','16:30'].map(t=>'<option value="'+t+'" '+(a.arrival_time===t?'selected':'')+'>'+t+'</option>').join('')}
                </select></div>
              <div><label class="text-xs text-gray-400 mb-1 block">Notified</label>
                <div class="px-3 py-2 rounded-lg text-sm glass \${a.notified_at ? 'text-green-400' : 'text-gray-500'}">\${a.notified_at ? '<i class="fas fa-check-circle mr-1"></i>'+new Date(a.notified_at).toLocaleDateString() : '<i class="fas fa-times-circle mr-1"></i>Not yet'}</div></div>
            </div>
            <div><label class="text-xs text-gray-400 mb-1 block">Bio</label><textarea id="ea-bio" rows="2" class="w-full px-3 py-2 rounded-lg text-sm">\${a.bio||''}</textarea></div>
            <div><label class="text-xs text-gray-400 mb-1 block">Interests (comma-separated)</label><input id="ea-interests" value="\${a.interests||''}" class="w-full px-3 py-2 rounded-lg text-sm"></div>
            <div class="grid grid-cols-2 gap-3">
              <div><label class="text-xs text-gray-400 mb-1 block">Twitter URL</label><input id="ea-twitter" value="\${a.twitter_url||''}" class="w-full px-3 py-2 rounded-lg text-sm" placeholder="https://twitter.com/..."></div>
              <div><label class="text-xs text-gray-400 mb-1 block">Website URL</label><input id="ea-website" value="\${a.website_url||''}" class="w-full px-3 py-2 rounded-lg text-sm" placeholder="https://..."></div>
            </div>
          </div>
          <div class="p-6 pt-3 border-t border-white/10 shrink-0 flex gap-2">
            <button type="submit" class="flex-1 py-3 rounded-xl text-sm font-semibold bg-primary-600 hover:bg-primary-500 text-white transition"><i class="fas fa-save mr-2"></i>Save Changes</button>
            <button type="button" onclick="closeModal()" class="px-6 py-3 rounded-xl text-sm font-medium glass hover:bg-white/10 transition">Cancel</button>
          </div>
        </form>
      \`;
      document.getElementById('modal-container').classList.remove('hidden');
      document.getElementById('edit-att-form').onsubmit = async e => {
        e.preventDefault();
        await api.put('/api/admin/attendees/'+a.id, {
          name: document.getElementById('ea-name').value,
          email: document.getElementById('ea-email').value,
          company: document.getElementById('ea-company').value,
          job_title: document.getElementById('ea-title').value,
          mobile: document.getElementById('ea-mobile').value,
          linkedin_url: document.getElementById('ea-linkedin').value,
          role: document.getElementById('ea-role').value,
          badge_type: document.getElementById('ea-badge').value,
          lunch_inclusion: document.getElementById('ea-lunch').value,
          arrival_time: document.getElementById('ea-arrival').value,
          bio: document.getElementById('ea-bio').value,
          interests: document.getElementById('ea-interests').value,
          twitter_url: document.getElementById('ea-twitter').value,
          website_url: document.getElementById('ea-website').value,
        });
        closeModal(); toast('Attendee updated!', 'success'); loadAdminAttendees();
      };

      // Wire up admin photo upload
      document.getElementById('ea-avatar-input').addEventListener('change', async function() {
        if (!this.files || !this.files[0]) return;
        const attId = this.dataset.attendeeId;
        try {
          const dataUrl = await resizeImage(this.files[0], 256, 0.8);
          document.getElementById('ea-avatar-preview').src = dataUrl;
          const result = await api.post('/api/attendees/' + attId + '/avatar', { image: dataUrl });
          if (result.success) {
            document.getElementById('ea-remove-avatar').classList.remove('hidden');
            toast('Photo uploaded!');
          }
        } catch(e) { toast('Failed: ' + (e.message || 'Error'), true); }
        this.value = '';
      });
      document.getElementById('ea-remove-avatar').addEventListener('click', async function() {
        if (!confirm('Remove photo?')) return;
        const attId = this.dataset.attendeeId;
        try {
          await fetch('/api/attendees/' + attId + '/avatar', { method: 'DELETE' }).then(r => r.json());
          document.getElementById('ea-avatar-preview').src = getAvatarUrl(a.email, a.name, 96);
          this.classList.add('hidden');
          toast('Photo removed');
        } catch(e) { toast('Failed to remove', true); }
      });
    }

    async function deleteAttendee(id) {
      if (!confirm('Delete this attendee? This cannot be undone.')) return;
      await api.del('/api/admin/attendees/'+id);
      toast('Attendee deleted!'); loadAdminAttendees();
    }

    // Admin: Download delegate pass for any attendee (does NOT mark pass_downloaded_at)
    function adminLoadImage(src) {
      return new Promise((resolve, reject) => {
        const img = new Image(); img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img); img.onerror = reject; img.src = src;
      });
    }
    async function adminDownloadPass(user) {
      toast('Generating pass for ' + user.name + '...', 'info');
      const W = 1000, H = 1500;
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      const px = (u) => '/api/image-proxy?url=' + encodeURIComponent(u);
      const passId = 'BHAI-2026-' + String(user.id).padStart(4, '0');

      let meityLogo, agbaLogo, bharatLogo, aegisCollegeLogo, assessfyLogo, tcoeiLogo, swissnexLogo;
      try { meityLogo = await adminLoadImage(px('https://bharataiinnovation.com/wp-content/uploads/2026/02/Meity-logo.png')); } catch(e) {}
      try { agbaLogo = await adminLoadImage(px('https://bharataiinnovation.com/images/Bharat%20AI%20Innovation%20Logo.png')); } catch(e) {}
      try { bharatLogo = await adminLoadImage(px('https://bharataiinnovation.com/wp-content/uploads/2026/02/Bharat-AI-Innovation-Expo-logo-scaled.png')); } catch(e) {}
      try { aegisCollegeLogo = await adminLoadImage(px('https://bharataiinnovation.com/wp-content/uploads/2025/10/Aegis_college_new1.png')); } catch(e) {}
      try { assessfyLogo = await adminLoadImage(px('https://bharataiinnovation.com/wp-content/uploads/2023/12/Assessfy-black.png')); } catch(e) {}
      try { tcoeiLogo = await adminLoadImage(px('https://bharataiinnovation.com/wp-content/uploads/2019/06/tcoei.png')); } catch(e) {}
      try { swissnexLogo = await adminLoadImage(px('https://bharataiinnovation.com/wp-content/uploads/2025/10/Swissnex-red-logo_76ea13ce5cec9e3d897b76c6abe4779f-400x120.png')); } catch(e) {}

      function goldLine(y, xPad, alpha) {
        const g = ctx.createLinearGradient(xPad, 0, W - xPad, 0);
        g.addColorStop(0, 'rgba(200,168,85,0)'); g.addColorStop(0.3, 'rgba(200,168,85,' + alpha + ')');
        g.addColorStop(0.5, 'rgba(219,185,96,' + (alpha + 0.15) + ')');
        g.addColorStop(0.7, 'rgba(200,168,85,' + alpha + ')'); g.addColorStop(1, 'rgba(200,168,85,0)');
        ctx.fillStyle = g; ctx.fillRect(xPad, y, W - xPad * 2, 1);
      }
      function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
      }
      function getAvatarUrl(email, name, size, avatarUrl) {
        if (avatarUrl) return avatarUrl;
        return 'https://ui-avatars.com/api/?name=' + encodeURIComponent(name||'?') + '&size=' + (size||128) + '&background=4c6ef5&color=fff&bold=true';
      }

      // Background
      const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
      bgGrad.addColorStop(0, '#060a1e'); bgGrad.addColorStop(0.15, '#0b1030');
      bgGrad.addColorStop(0.5, '#0e1438'); bgGrad.addColorStop(0.85, '#0b1030'); bgGrad.addColorStop(1, '#060a1e');
      ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H);
      const warmGlow = ctx.createRadialGradient(W/2, H * 0.42, 40, W/2, H * 0.42, 420);
      warmGlow.addColorStop(0, 'rgba(200,168,85,0.06)'); warmGlow.addColorStop(0.5, 'rgba(200,168,85,0.02)'); warmGlow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = warmGlow; ctx.fillRect(0, 0, W, H);
      // Gold borders
      ctx.strokeStyle = 'rgba(200,168,85,0.35)'; ctx.lineWidth = 2;
      roundRect(ctx, 30, 30, W - 60, H - 60, 16); ctx.stroke();
      ctx.strokeStyle = 'rgba(200,168,85,0.15)'; ctx.lineWidth = 1;
      roundRect(ctx, 38, 38, W - 76, H - 76, 12); ctx.stroke();

      // Supported by + MeitY
      ctx.fillStyle = 'rgba(180,180,180,0.5)'; ctx.font = '500 11px Arial, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Supported by', W / 2, 80);
      if (meityLogo) { const mh = 50; const mw = mh * (meityLogo.width / meityLogo.height); ctx.drawImage(meityLogo, (W - mw) / 2, 88, mw, mh); }
      goldLine(155, 100, 0.3);

      // BHAI logo
      if (agbaLogo) { const lh = 55; const lw = lh * (agbaLogo.width / agbaLogo.height); ctx.drawImage(agbaLogo, (W - lw) / 2, 168, lw, lh); }
      ctx.fillStyle = '#c8a855'; ctx.font = 'bold 28px Georgia, serif'; ctx.fillText('16th Bharat AI Innovation', W / 2, 260);
      ctx.fillStyle = 'rgba(200,168,85,0.7)'; ctx.font = '16px Arial, sans-serif'; ctx.fillText('Celebrating Innovation that Impacts', W / 2, 288);
      goldLine(310, 140, 0.4);

      // Avatar
      const avatarSize = 180, avatarX = (W - avatarSize) / 2, avatarY = 340;
      try {
        const avatarImg = await adminLoadImage(getAvatarUrl(user.email, user.name, 256, user.avatar_url));
        ctx.save();
        roundRect(ctx, avatarX, avatarY, avatarSize, avatarSize, avatarSize / 2); ctx.clip();
        ctx.drawImage(avatarImg, avatarX, avatarY, avatarSize, avatarSize); ctx.restore();
      } catch(e) {
        ctx.save(); roundRect(ctx, avatarX, avatarY, avatarSize, avatarSize, avatarSize / 2); ctx.clip();
        ctx.fillStyle = '#4c6ef5'; ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = 'bold 72px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText((user.name || '?')[0].toUpperCase(), W / 2, avatarY + avatarSize / 2); ctx.restore();
      }
      ctx.strokeStyle = 'rgba(200,168,85,0.5)'; ctx.lineWidth = 3;
      roundRect(ctx, avatarX - 2, avatarY - 2, avatarSize + 4, avatarSize + 4, (avatarSize + 4) / 2); ctx.stroke();

      // Name
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center';
      const nameSize = user.name.length > 24 ? 32 : user.name.length > 18 ? 36 : 42;
      ctx.font = 'bold ' + nameSize + 'px Georgia, serif'; ctx.fillText(user.name, W / 2, 575);
      // Title & Company
      if (user.job_title) { ctx.fillStyle = 'rgba(200,168,85,0.9)'; ctx.font = '500 20px Arial, sans-serif'; ctx.fillText(user.job_title, W / 2, 615); }
      if (user.company) { ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '18px Arial, sans-serif'; ctx.fillText(user.company, W / 2, user.job_title ? 648 : 615); }
      goldLine(680, 140, 0.4);

      // Badge
      const badge = user.badge_type || 'Delegate';
      const badgeColors = { 'Organiser': ['#c8a855','#a08530'], 'VIP Guest': ['#8b5cf6','#7c3aed'], 'VIP Pass': ['#8b5cf6','#7c3aed'], 'Exhibitor': ['#f97316','#ea580c'], 'Speaker': ['#06b6d4','#0891b2'], 'Jury': ['#ec4899','#db2777'], 'Investor': ['#10b981','#059669'], 'Media': ['#6366f1','#4f46e5'] };
      const [bc1, bc2] = badgeColors[badge] || ['#4c6ef5','#3b5bdb'];
      const badgeWidth = Math.max(ctx.measureText(badge.toUpperCase()).width + 80, 240);
      const bx = (W - badgeWidth) / 2, by = 710;
      const badgeGrad = ctx.createLinearGradient(bx, by, bx + badgeWidth, by + 48);
      badgeGrad.addColorStop(0, bc1); badgeGrad.addColorStop(1, bc2);
      roundRect(ctx, bx, by, badgeWidth, 48, 24); ctx.fillStyle = badgeGrad; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 18px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(badge.toUpperCase(), W / 2, 741);

      // Event details
      goldLine(790, 140, 0.3);
      ctx.fillStyle = 'rgba(200,168,85,0.9)'; ctx.font = '500 22px Arial, sans-serif'; ctx.fillText('20-21 Nov 2026', W / 2, 835);
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '17px Arial, sans-serif'; ctx.fillText('WTC Mumbai, Chanakyapuri, Mumbai', W / 2, 865);
      ctx.fillText('9:00 AM \u2013 6:00 PM', W / 2, 892);
      goldLine(920, 140, 0.3);

      // Pass ID
      ctx.fillStyle = 'rgba(200,168,85,0.6)'; ctx.font = '500 15px monospace'; ctx.fillText(passId, W / 2, 955);

      // QR placeholder
      const qrSize = 140, qrX = (W - qrSize) / 2, qrY = 980;
      roundRect(ctx, qrX, qrY, qrSize, qrSize, 8); ctx.fillStyle = '#ffffff'; ctx.fill();
      try {
        const qrImg = await adminLoadImage('https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=' + encodeURIComponent('https://networking.bharataiinnovation.com?email=' + user.email));
        ctx.drawImage(qrImg, qrX + 4, qrY + 4, qrSize - 8, qrSize - 8);
      } catch(e) { ctx.fillStyle = '#333'; ctx.font = '12px Arial'; ctx.fillText('QR Code', W / 2, qrY + qrSize / 2); }
      ctx.fillStyle = 'rgba(200,168,85,0.5)'; ctx.font = '12px Arial, sans-serif'; ctx.fillText('Scan to access networking app', W / 2, qrY + qrSize + 20);

      // Partner logos
      goldLine(1170, 100, 0.25);
      const logoY = 1190, logoH = 35;
      const logos = [bharatLogo, aegisCollegeLogo, assessfyLogo, tcoeiLogo, swissnexLogo].filter(Boolean);
      if (logos.length > 0) {
        const totalW = logos.reduce((s, l) => s + (logoH * (l.width / l.height)) + 30, -30);
        let lx = (W - totalW) / 2;
        logos.forEach(l => { const lw = logoH * (l.width / l.height); ctx.globalAlpha = 0.7; ctx.drawImage(l, lx, logoY, lw, logoH); ctx.globalAlpha = 1; lx += lw + 30; });
      }

      // Footer
      goldLine(1250, 140, 0.25);
      ctx.fillStyle = 'rgba(180,180,180,0.4)'; ctx.font = '11px Arial, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('bharataiinnovation.com  \u2022  networking.bharataiinnovation.com', W / 2, H - 50);
      goldLine(H - 38, 140, 0.4);

      // Download (no tracking)
      const link = document.createElement('a');
      link.download = 'BHAI-2026-Pass-' + user.name.replace(/\\s+/g, '-') + '.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
      toast('Pass downloaded for ' + user.name, 'success');
    }

    async function notifyAttendee(id, name, email) {
      if (!confirm(\`Send notification email to \${name} (\${email})?\`)) return;
      try {
        const result = await api.post('/api/admin/attendees/'+id+'/notify', {});
        if (result.method === 'mailto') {
          const subject = encodeURIComponent(result.subject);
          const body = encodeURIComponent(result.body);
          window.open(\`mailto:\${email}?subject=\${subject}&body=\${body}\`, '_blank');
          toast(\`Email draft opened for \${name}\`);
        } else if (result.method === 'elastic_email') {
          toast(\`Email sent to \${name} via Elastic Email!\`);
        } else {
          toast(\`Notification sent to \${name}!\`);
        }
        // Update just the notified icon in-place (no full reload / no scroll reset)
        const cell = document.getElementById('notified-'+id);
        if (cell) {
          const now = new Date().toISOString();
          cell.innerHTML = '<span class="text-green-400" title="'+now+'"><i class="fas fa-check-circle"></i></span>';
        }
      } catch(e) {
        const msg = e.data ? (e.data.error || 'Unknown error') : e.message;
        toast('Failed: ' + msg, true);
      }
    }

    async function notifyAllAttendees() {
      try {
        const result = await api.post('/api/admin/attendees/notify-all', { event_id: EID });
        if (result.count === 0) {
          toast('All attendees have already been notified!', 'success');
          return;
        }
        if (!confirm(\`Send notification to \${result.count} un-notified attendee(s)?\`)) return;
        let sent = 0, failed = 0;
        toast(\`Sending to \${result.count} attendees...\`);
        for (const a of result.attendees) {
          try {
            await api.post('/api/admin/attendees/'+a.id+'/notify', {});
            sent++;
          } catch(e) { failed++; }
        }
        toast(\`Done! Sent: \${sent}, Failed: \${failed}\`, sent > 0 ? 'success' : 'error');
        loadAdminAttendees();
      } catch(e) { toast('Failed to send notifications', 'error'); }
    }

    async function resendNonResponders() {
      try {
        const result = await api.post('/api/admin/attendees/resend-non-responders', { event_id: EID });
        if (result.count === 0) {
          toast('All notified attendees have already responded!', 'success');
          return;
        }
        if (!confirm(\`Resend notification email to \${result.count} attendee(s) who haven't responded to RSVP?\`)) return;
        let sent = 0, failed = 0;
        toast(\`Resending to \${result.count} non-responders...\`);
        const reminderSubject = 'Reminder: Confirm your attendance — Bharat AI Innovation 2026, 20-21 Nov, WTC Mumbai';
        for (const a of result.attendees) {
          try {
            await api.post('/api/admin/attendees/'+a.id+'/notify', { subject: reminderSubject });
            sent++;
          } catch(e) { failed++; }
        }
        toast(\`Done! Sent: \${sent}, Failed: \${failed}\`, sent > 0 ? 'success' : 'error');
        refreshCurrentSection();
      } catch(e) { toast('Failed to resend notifications', 'error'); }
    }

    // ============ POST-CEREMONY THANK YOU EMAIL ============
    async function sendThankYouToAll() {
      try {
        const result = await api.post('/api/admin/attendees/thankyou-list', { event_id: EID });
        if (result.count === 0) {
          toast('No attendees with email addresses found!', 'error');
          return;
        }
        if (!confirm(\`Send post-ceremony THANK YOU email to ALL \${result.count} attendee(s)?\\n\\nThis will send a personalised thank-you email to every attendee expressing gratitude, congratulating winners/finalists/Innovation Star/NTH winners, and sharing the event photos link.\\n\\nProceed?\`)) return;

        const progress = document.getElementById('thankyou-progress');
        const bar = document.getElementById('thankyou-bar');
        const countEl = document.getElementById('thankyou-count');
        const statusEl = document.getElementById('thankyou-status');
        progress.style.display = 'block';

        let sent = 0, failed = 0;
        const total = result.count;
        countEl.textContent = '0/' + total;
        statusEl.textContent = 'Starting...';

        for (const a of result.attendees) {
          try {
            statusEl.textContent = \`Sending to \${a.name} (\${a.email})...\`;
            await api.post('/api/admin/attendees/' + a.id + '/send-thankyou', {});
            sent++;
          } catch(e) { failed++; }
          const done = sent + failed;
          const pct = Math.round(done / total * 100);
          bar.style.width = pct + '%';
          countEl.textContent = done + '/' + total;
        }

        statusEl.innerHTML = \`<span class="text-green-400 font-semibold">Complete!</span> Sent: <strong>\${sent}</strong>, Failed: <strong>\${failed}</strong>\`;
        toast(\`Thank you emails sent! \${sent} delivered, \${failed} failed.\`, sent > 0 ? 'success' : 'error');
      } catch(e) {
        toast('Failed to send thank-you emails: ' + (e.message || 'Error'), 'error');
      }
    }

    function previewThankYouEmail() {
      openModal(\`
        <div style="max-height:80vh;overflow-y:auto;background:#f4f4f5;border-radius:12px;padding:8px;">
          <div style="text-align:center;margin-bottom:8px;">
            <p style="margin:0 0 6px;color:#888;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Supported by</p>
            <img src="https://bharataiinnovation.com/wp-content/uploads/2026/02/Meity-logo.png" alt="MeitY" style="height:50px;">
          </div>
          <div style="text-align:center;margin-bottom:12px;">
            <img src="https://bharataiinnovation.com/images/Bharat%20AI%20Innovation%20Logo.png" alt="BHAI" style="height:60px;">
          </div>
          <div style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);border-radius:16px;padding:24px 20px;text-align:center;color:white;">
            <h2 style="margin:0 0 6px;font-size:20px;">Confirm Your Attendance!</h2>
            <p style="margin:0;opacity:0.8;font-size:13px;">Bharat AI Innovation Conference & Exhibition 2026 &bull; 20-21 Nov 2026</p>
          </div>
          <div style="background:white;border-radius:16px;padding:24px;margin-top:12px;color:#333;">
            <h3 style="margin:0 0 12px;color:#1a1a2e;">Dear [Attendee Name],</h3>
            <p style="color:#555;line-height:1.6;font-size:13px;margin:0 0 12px;">
              We are truly grateful for your presence at the <strong style="color:#1a1a2e;">Bharat AI Innovation 2026</strong> ceremony held on <strong style="color:#1a1a2e;">20-21 Nov 2026</strong> at <strong style="color:#1a1a2e;">World Trade Center Mumbai, Mumbai</strong>. Your participation played a vital role in making this event a resounding success.
            </p>
            <p style="color:#555;line-height:1.6;font-size:13px;margin:0 0 16px;">
              It was a memorable evening celebrating innovation, technology, and the exceptional contributions of individuals and organizations driving meaningful change across industries and society.
            </p>
            <div style="background:linear-gradient(135deg,#fef9e7,#fdf2d6);border:1px solid #f0d48a;border-radius:12px;padding:20px;margin:16px 0;">
              <h4 style="margin:0 0 12px;text-align:center;color:#92400e;font-size:16px;">&#127942; Highlights!</h4>
              <p style="color:#555;line-height:1.6;font-size:13px;margin:0 0 12px;text-align:center;">We extend our heartfelt congratulations to all the:</p>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                <div style="background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);border-radius:8px;padding:12px;text-align:center;">
                  <div style="font-size:24px;">&#127942;</div>
                  <div style="font-weight:bold;font-size:13px;color:#166534;">Innovation Leaders</div>
                  <div style="color:#555;font-size:11px;margin-top:3px;">Outstanding innovation & impact</div>
                </div>
                <div style="background:rgba(99,102,241,0.12);border:1px solid rgba(99,102,241,0.3);border-radius:8px;padding:12px;text-align:center;">
                  <div style="font-size:24px;">&#11088;</div>
                  <div style="font-weight:bold;font-size:13px;color:#3730a3;">Startup Finalists</div>
                  <div style="color:#555;font-size:11px;margin-top:3px;">Exceptional shortlisted entries</div>
                </div>
                <div style="background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.3);border-radius:8px;padding:12px;text-align:center;">
                  <div style="font-size:24px;">&#128161;</div>
                  <div style="font-weight:bold;font-size:13px;color:#92400e;">Key Speakers</div>
                  <div style="color:#555;font-size:11px;margin-top:3px;">Thought leaders shaping the future</div>
                </div>
                <div style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:12px;text-align:center;">
                  <div style="font-size:24px;">&#128640;</div>
                  <div style="font-weight:bold;font-size:13px;color:#991b1b;">Exhibitors & Partners</div>
                  <div style="color:#555;font-size:11px;margin-top:3px;">Showcasing next-gen AI solutions</div>
                </div>
              </div>
              <p style="color:#555;font-size:12px;text-align:center;margin:12px 0 0;">Your achievements inspire the entire innovation ecosystem!</p>
            </div>
            <div style="background:linear-gradient(135deg,#f0f4ff,#e8eeff);border:1px solid #c7d2fe;border-radius:12px;padding:20px;margin:16px 0;text-align:center;">
              <h4 style="margin:0 0 8px;color:#3730a3;">&#128247; Event Photos &amp; Memories</h4>
              <p style="color:#555;font-size:13px;margin:0 0 12px;">Relive the wonderful moments from the ceremony!</p>
              <a href="https://drive.google.com/drive/folders/14YkEgPMjXIJ2JYNYmgxmBOH6g2TL1-FM?usp=sharing" target="_blank" style="display:inline-block;padding:10px 24px;background:linear-gradient(135deg,#6366f1,#4f46e5);color:white;text-decoration:none;border-radius:8px;font-weight:bold;font-size:13px;">
                &#128247; View Event Photos &rarr;
              </a>
            </div>
            <div style="margin-top:20px;padding-top:16px;border-top:1px solid #eee;">
              <p style="color:#555;font-size:13px;line-height:1.7;margin:0 0 12px;">
                Once again, thank you for being a part of the <strong style="color:#1a1a2e;">Bharat AI Innovation 2026</strong>. We look forward to welcoming you again at the <a href="https://bharataiinnovation.com/" style="color:#4f46e5;font-weight:bold;text-decoration:underline;">next edition of Bharat AI Innovation</a> &amp; <a href="https://bharataiinnovation.com/" style="color:#4f46e5;font-weight:bold;text-decoration:underline;">Bharat AI Innovations</a>!
              </p>
              <p style="color:#555;font-size:13px;margin:0;">With warm regards,<br><strong style="color:#1a1a2e;">Team Bharat AI Innovation</strong><br><span style="font-size:12px;color:#888;">Bharat AI Innovation</span></p>
            </div>
          </div>
        </div>
      \`);
    }

    // ============ FIND DUPLICATES ============
    async function findDuplicates() {
      openModal(\`
        <div class="text-center py-8">
          <i class="fas fa-spinner fa-spin text-3xl text-primary-400 mb-3"></i>
          <p class="text-sm text-gray-400">Scanning for duplicate entries...</p>
        </div>
      \`);
      try {
        const data = await api.get('/api/admin/events/'+EID+'/attendees/duplicates');
        if (data.totalGroups === 0) {
          openModal(\`
            <div class="text-center py-6">
              <i class="fas fa-check-circle text-4xl text-green-400 mb-3"></i>
              <h3 class="text-lg font-bold mb-1">No Duplicates Found</h3>
              <p class="text-sm text-gray-400">All attendee records appear to be unique.</p>
              <button onclick="closeModal()" class="mt-4 px-6 py-2 rounded-xl text-sm font-medium bg-primary-600 hover:bg-primary-500 text-white transition">Close</button>
            </div>
          \`);
          return;
        }

        let html = \`
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-lg font-bold"><i class="fas fa-user-friends text-purple-400 mr-2"></i>Suspected Duplicates</h3>
            <span class="text-xs text-gray-400">\${data.totalGroups} groups · \${data.totalDuplicates} potential duplicates</span>
          </div>
          <p class="text-xs text-gray-500 mb-4">These attendees have similar names but different emails. Review and delete duplicates as needed.</p>
          <div class="space-y-4 max-h-[60vh] overflow-y-auto scroll-hide pr-1">
        \`;

        data.groups.forEach((g, gi) => {
          const all = [g.primary, ...g.duplicates];
          html += \`<div class="glass rounded-xl p-4 border border-purple-500/20">
            <div class="flex items-center gap-2 mb-3">
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/20 text-purple-300">Group \${gi+1}</span>
              <span class="text-xs text-gray-500">\${all.length} entries</span>
            </div>
            <div class="overflow-x-auto">
              <table class="w-full text-xs">
                <thead><tr class="text-gray-500 text-[10px] uppercase">
                  <th class="text-left py-1 px-2">ID</th>
                  <th class="text-left py-1 px-2">Name</th>
                  <th class="text-left py-1 px-2">Email</th>
                  <th class="text-left py-1 px-2">Mobile</th>
                  <th class="text-left py-1 px-2">Company</th>
                  <th class="text-left py-1 px-2">Badge</th>
                  <th class="text-left py-1 px-2">RSVP</th>
                  <th class="text-left py-1 px-2">Match</th>
                  <th class="text-left py-1 px-2">Action</th>
                </tr></thead>
                <tbody>\`;
          all.forEach((a, ai) => {
            const sim = ai === 0 ? '—' : (a.similarity || 0) + '%';
            const hasActivity = a.last_login_at || a.notified_at || a.rsvp_status;
            html += \`<tr class="border-t border-white/5 \${ai === 0 ? 'bg-white/[0.03]' : ''}">
              <td class="py-1.5 px-2 text-gray-500">#\${a.id}</td>
              <td class="py-1.5 px-2 font-medium \${ai === 0 ? 'text-white' : 'text-gray-300'}">\${a.name}</td>
              <td class="py-1.5 px-2 text-gray-400">\${a.email}</td>
              <td class="py-1.5 px-2 text-gray-400">\${a.mobile || '-'}</td>
              <td class="py-1.5 px-2 text-gray-400">\${a.company || '-'}</td>
              <td class="py-1.5 px-2"><span class="px-1.5 py-0.5 rounded text-[10px] \${getBadgeClass(a.badge_type)}">\${a.badge_type}</span></td>
              <td class="py-1.5 px-2">\${a.rsvp_status ? '<span class="text-green-400">'+a.rsvp_status+'</span>' : '<span class="text-gray-600">—</span>'}</td>
              <td class="py-1.5 px-2">\${ai === 0 ? '<span class="text-purple-300 font-semibold">Primary</span>' : '<span class="text-amber-400">'+sim+'</span>'}</td>
              <td class="py-1.5 px-2"><button onclick="deleteDuplicate('+a.id+', this)" class="px-2 py-1 rounded text-[10px] font-medium '+(hasActivity ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30' : 'bg-red-500/20 text-red-400 hover:bg-red-500/30')+' transition" title="'+(hasActivity ? 'Has activity — review before deleting' : 'No activity — safe to delete')+'">'+(hasActivity ? '<i class="fas fa-exclamation-triangle mr-1"></i>' : '')+'<i class="fas fa-trash"></i> Delete</button></td>
            </tr>\`;
          });
          html += \`</tbody></table></div></div>\`;
        });

        html += \`</div>
          <button onclick="closeModal(); loadAdminAttendees();" class="w-full mt-4 py-2.5 rounded-xl text-sm font-medium bg-primary-600 hover:bg-primary-500 text-white transition"><i class="fas fa-check mr-1.5"></i>Done</button>
        \`;
        openModal(html);
      } catch(e) {
        openModal(\`<div class="text-center py-6"><i class="fas fa-exclamation-triangle text-3xl text-red-400 mb-3"></i><h3 class="font-bold mb-1">Error</h3><p class="text-sm text-gray-400">Failed to scan for duplicates.</p><button onclick="closeModal()" class="mt-3 px-6 py-2 rounded-xl text-sm bg-primary-600 text-white transition">Close</button></div>\`);
      }
    }

    async function deleteDuplicate(id, btnEl) {
      if (!confirm('Delete attendee #' + id + '? This cannot be undone.')) return;
      try {
        await api.del('/api/admin/attendees/' + id);
        btnEl.closest('tr').remove();
        toast('Deleted attendee #' + id, 'success');
      } catch(e) { toast('Failed to delete', 'error'); }
    }

    // ============ SESSIONS ============
    async function loadAdminSessions() {
      const sessions = await api.get('/api/events/'+EID+'/sessions');
      document.getElementById('section-sessions').innerHTML = \`
        <div class="flex items-center justify-between mb-4">
          <span class="text-xs text-gray-400">\${sessions.length} sessions</span>
          <button onclick="openCreateSession()" class="px-4 py-2 rounded-xl text-xs font-medium bg-primary-600 hover:bg-primary-500 text-white transition"><i class="fas fa-plus mr-1"></i>Add Session</button>
        </div>
        <div class="glass rounded-xl overflow-hidden">
          <div class="overflow-x-auto max-h-[70vh] overflow-y-auto scroll-hide">
            <table class="w-full text-sm">
              <thead><tr class="text-gray-400 text-xs uppercase">
                <th>Time</th><th>Title</th><th>Speaker</th><th>Type</th><th>Track</th><th>Room</th><th>Actions</th>
              </tr></thead>
              <tbody>
                \${sessions.map(s=>\`<tr>
                  <td class="text-xs text-gray-400 whitespace-nowrap">\${s.start_time?.slice(5,16)||''}<br>\${s.end_time?.slice(11,16)||''}</td>
                  <td class="font-medium">\${s.title}</td>
                  <td class="text-xs">\${s.speaker_name||'-'}</td>
                  <td><span class="px-2 py-0.5 rounded-full text-[10px] bg-primary-500/20 text-primary-300">\${s.session_type}</span></td>
                  <td class="text-xs text-gray-400">\${s.track||'-'}</td>
                  <td class="text-xs">\${s.room||'-'}</td>
                  <td class="flex gap-1">
                    <button onclick='openEditSession(\${JSON.stringify(s).replace(/'/g,"&#39;")})' class="px-2 py-1 rounded text-xs bg-primary-500/20 text-primary-300 hover:bg-primary-500/30"><i class="fas fa-edit"></i></button>
                    <button onclick="deleteSession(\${s.id})" class="px-2 py-1 rounded text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30"><i class="fas fa-trash"></i></button>
                  </td>
                </tr>\`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      \`;
    }

    function sessionFormHTML(s={}) {
      return \`
        <div class="space-y-3">
          <div><label class="text-xs text-gray-400 mb-1 block">Title *</label><input id="sf-title" value="\${s.title||''}" required class="w-full px-3 py-2 rounded-lg text-sm"></div>
          <div><label class="text-xs text-gray-400 mb-1 block">Description</label><textarea id="sf-desc" rows="2" class="w-full px-3 py-2 rounded-lg text-sm">\${s.description||''}</textarea></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="text-xs text-gray-400 mb-1 block">Speaker Name</label><input id="sf-speaker" value="\${s.speaker_name||''}" class="w-full px-3 py-2 rounded-lg text-sm"></div>
            <div><label class="text-xs text-gray-400 mb-1 block">Speaker Title</label><input id="sf-speaker-title" value="\${s.speaker_title||''}" class="w-full px-3 py-2 rounded-lg text-sm"></div>
          </div>
          <div class="grid grid-cols-3 gap-3">
            <div><label class="text-xs text-gray-400 mb-1 block">Type *</label>
              <select id="sf-type" class="w-full px-3 py-2 rounded-lg text-sm">
                \${['keynote','talk','panel','workshop','ceremony','exhibition','networking','break'].map(t=>'<option '+(s.session_type===t?'selected':'')+'>'+t+'</option>').join('')}
              </select></div>
            <div><label class="text-xs text-gray-400 mb-1 block">Track</label><input id="sf-track" value="\${s.track||''}" class="w-full px-3 py-2 rounded-lg text-sm"></div>
            <div><label class="text-xs text-gray-400 mb-1 block">Room</label><input id="sf-room" value="\${s.room||''}" class="w-full px-3 py-2 rounded-lg text-sm"></div>
          </div>
          <div class="grid grid-cols-3 gap-3">
            <div><label class="text-xs text-gray-400 mb-1 block">Start Time *</label><input type="datetime-local" id="sf-start" value="\${(s.start_time||'').replace(' ','T')}" required class="w-full px-3 py-2 rounded-lg text-sm"></div>
            <div><label class="text-xs text-gray-400 mb-1 block">End Time *</label><input type="datetime-local" id="sf-end" value="\${(s.end_time||'').replace(' ','T')}" required class="w-full px-3 py-2 rounded-lg text-sm"></div>
            <div><label class="text-xs text-gray-400 mb-1 block">Emoji</label><input id="sf-avatar" value="\${s.speaker_avatar||''}" class="w-full px-3 py-2 rounded-lg text-sm" placeholder="e.g. 🎤"></div>
          </div>
        </div>
      \`;
    }

    function getSessionForm() {
      return {
        event_id: EID, title: document.getElementById('sf-title').value,
        description: document.getElementById('sf-desc').value,
        speaker_name: document.getElementById('sf-speaker').value,
        speaker_title: document.getElementById('sf-speaker-title').value,
        speaker_avatar: document.getElementById('sf-avatar').value,
        session_type: document.getElementById('sf-type').value,
        track: document.getElementById('sf-track').value,
        room: document.getElementById('sf-room').value,
        start_time: document.getElementById('sf-start').value.replace('T',' '),
        end_time: document.getElementById('sf-end').value.replace('T',' '),
      };
    }

    function openCreateSession() {
      openModal('<h3 class="text-lg font-bold mb-4"><i class="fas fa-plus text-green-400 mr-2"></i>Add Session</h3><form id="sf-form">'+sessionFormHTML()+'<div class="flex gap-2 pt-3"><button type="submit" class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-green-600 hover:bg-green-500 text-white"><i class="fas fa-plus mr-1"></i>Create</button><button type="button" onclick="closeModal()" class="px-4 py-2.5 rounded-xl text-sm font-medium glass hover:bg-white/10">Cancel</button></div></form>');
      document.getElementById('sf-form').onsubmit = async e => { e.preventDefault(); await api.post('/api/admin/sessions', getSessionForm()); closeModal(); toast('Session created!'); loadAdminSessions(); };
    }

    function openEditSession(s) {
      openModal('<h3 class="text-lg font-bold mb-4"><i class="fas fa-edit text-primary-400 mr-2"></i>Edit Session</h3><form id="sf-form">'+sessionFormHTML(s)+'<div class="flex gap-2 pt-3"><button type="submit" class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-primary-600 hover:bg-primary-500 text-white"><i class="fas fa-save mr-1"></i>Save</button><button type="button" onclick="closeModal()" class="px-4 py-2.5 rounded-xl text-sm font-medium glass hover:bg-white/10">Cancel</button></div></form>');
      document.getElementById('sf-form').onsubmit = async e => { e.preventDefault(); await api.put('/api/admin/sessions/'+s.id, getSessionForm()); closeModal(); toast('Session updated!'); loadAdminSessions(); };
    }

    async function deleteSession(id) { if (!confirm('Delete this session?')) return; await api.del('/api/admin/sessions/'+id); toast('Session deleted!'); loadAdminSessions(); }

    // ============ EXHIBITORS ============
    async function loadAdminExhibitors() {
      const exhibitors = await api.get('/api/events/'+EID+'/exhibitors');
      document.getElementById('section-exhibitors').innerHTML = \`
        <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
          <span class="text-xs text-gray-400">\${exhibitors.length} exhibitors</span>
          <div class="flex gap-2">
            <button onclick="syncExhibitorsFromAttendees()" class="px-4 py-2 rounded-xl text-xs font-medium bg-green-600/20 text-green-300 hover:bg-green-600/30 border border-green-500/30 transition"><i class="fas fa-sync mr-1"></i>Sync from Attendees</button>
            <button onclick="openCreateExhibitor()" class="px-4 py-2 rounded-xl text-xs font-medium bg-primary-600 hover:bg-primary-500 text-white transition"><i class="fas fa-plus mr-1"></i>Add Exhibitor</button>
          </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          \${exhibitors.map(ex=>\`
            <div class="glass rounded-xl p-4 card-hover \${ex.booth_size==='platinum'?'border-l-4 border-amber-500':ex.booth_size==='premium'?'border-l-4 border-primary-500':'border-l-4 border-gray-600'}">
              <div class="flex items-start justify-between mb-2">
                <div>
                  <h4 class="font-bold">\${ex.company_name}</h4>
                  <div class="flex items-center gap-2 text-xs text-gray-400 flex-wrap">
                    \${ex.booth_number ? '<span>Booth '+ex.booth_number+'</span>' : '<span class="text-amber-400">No booth #</span>'}
                    <span class="px-1.5 py-0.5 rounded text-[10px] bg-white/5">\${ex.booth_size}</span>
                    \${ex.category ? '<span>'+ex.category+'</span>' : ''}
                    \${ex.attendee_id ? '<span class="px-1.5 py-0.5 rounded text-[10px] bg-blue-500/20 text-blue-300"><i class="fas fa-user-check mr-0.5"></i>Linked #'+ex.attendee_id+'</span>' : ''}
                  </div>
                </div>
                <div class="text-right">
                  <span class="text-lg font-bold text-primary-400">\${ex.visitor_count}</span>
                  <span class="text-[10px] text-gray-500 block">visitors</span>
                </div>
              </div>
              <p class="text-xs text-gray-400 mb-3 line-clamp-2">\${ex.description||'<span class="italic">No description yet</span>'}</p>
              <div class="flex gap-1">
                <button onclick='openEditExhibitor(\${JSON.stringify(ex).replace(/'/g,"&#39;")})' class="px-3 py-1.5 rounded-lg text-xs bg-primary-500/20 text-primary-300 hover:bg-primary-500/30"><i class="fas fa-edit mr-1"></i>Edit</button>
                <button onclick="deleteExhibitor(\${ex.id})" class="px-3 py-1.5 rounded-lg text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30"><i class="fas fa-trash mr-1"></i>Delete</button>
              </div>
            </div>
          \`).join('')}
        </div>
      \`;
    }

    function exhibitorFormHTML(e={}) {
      return \`<div class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <div><label class="text-xs text-gray-400 mb-1 block">Company *</label><input id="ef-name" value="\${e.company_name||''}" required class="w-full px-3 py-2 rounded-lg text-sm"></div>
          <div><label class="text-xs text-gray-400 mb-1 block">Category</label><input id="ef-cat" value="\${e.category||''}" class="w-full px-3 py-2 rounded-lg text-sm"></div>
        </div>
        <div><label class="text-xs text-gray-400 mb-1 block">Description</label><textarea id="ef-desc" rows="2" class="w-full px-3 py-2 rounded-lg text-sm">\${e.description||''}</textarea></div>
        <div class="grid grid-cols-3 gap-3">
          <div><label class="text-xs text-gray-400 mb-1 block">Booth #</label><input id="ef-booth" value="\${e.booth_number||''}" class="w-full px-3 py-2 rounded-lg text-sm"></div>
          <div><label class="text-xs text-gray-400 mb-1 block">Size</label>
            <select id="ef-size" class="w-full px-3 py-2 rounded-lg text-sm">
              \${['standard','premium','platinum'].map(s=>'<option '+(e.booth_size===s?'selected':'')+'>'+s+'</option>').join('')}
            </select></div>
          <div><label class="text-xs text-gray-400 mb-1 block">Website</label><input id="ef-web" value="\${e.website_url||''}" class="w-full px-3 py-2 rounded-lg text-sm"></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="text-xs text-gray-400 mb-1 block">Email</label><input id="ef-email" value="\${e.contact_email||''}" class="w-full px-3 py-2 rounded-lg text-sm"></div>
          <div><label class="text-xs text-gray-400 mb-1 block">Phone</label><input id="ef-phone" value="\${e.contact_phone||''}" class="w-full px-3 py-2 rounded-lg text-sm"></div>
        </div>
        <div><label class="text-xs text-gray-400 mb-1 block">Products (comma-separated)</label><input id="ef-products" value="\${e.products||''}" class="w-full px-3 py-2 rounded-lg text-sm"></div>
      </div>\`;
    }

    function getExhibitorForm() {
      return { event_id:EID, company_name:document.getElementById('ef-name').value, description:document.getElementById('ef-desc').value, booth_number:document.getElementById('ef-booth').value, booth_size:document.getElementById('ef-size').value, category:document.getElementById('ef-cat').value, website_url:document.getElementById('ef-web').value, contact_email:document.getElementById('ef-email').value, contact_phone:document.getElementById('ef-phone').value, products:document.getElementById('ef-products').value };
    }

    function openCreateExhibitor() {
      openModal('<h3 class="text-lg font-bold mb-4"><i class="fas fa-plus text-green-400 mr-2"></i>Add Exhibitor</h3><form id="ef-form">'+exhibitorFormHTML()+'<div class="flex gap-2 pt-3"><button type="submit" class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-green-600 hover:bg-green-500 text-white"><i class="fas fa-plus mr-1"></i>Create</button><button type="button" onclick="closeModal()" class="px-4 py-2.5 rounded-xl text-sm font-medium glass hover:bg-white/10">Cancel</button></div></form>');
      document.getElementById('ef-form').onsubmit = async e => { e.preventDefault(); await api.post('/api/admin/exhibitors', getExhibitorForm()); closeModal(); toast('Exhibitor created!'); loadAdminExhibitors(); };
    }

    function openEditExhibitor(ex) {
      openModal('<h3 class="text-lg font-bold mb-4"><i class="fas fa-edit text-primary-400 mr-2"></i>Edit Exhibitor</h3><form id="ef-form">'+exhibitorFormHTML(ex)+'<div class="flex gap-2 pt-3"><button type="submit" class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-primary-600 hover:bg-primary-500 text-white"><i class="fas fa-save mr-1"></i>Save</button><button type="button" onclick="closeModal()" class="px-4 py-2.5 rounded-xl text-sm font-medium glass hover:bg-white/10">Cancel</button></div></form>');
      document.getElementById('ef-form').onsubmit = async e => { e.preventDefault(); await api.put('/api/admin/exhibitors/'+ex.id, getExhibitorForm()); closeModal(); toast('Exhibitor updated!'); loadAdminExhibitors(); };
    }

    async function deleteExhibitor(id) { if (!confirm('Delete this exhibitor?')) return; await api.del('/api/admin/exhibitors/'+id); toast('Exhibitor deleted!'); loadAdminExhibitors(); }

    async function syncExhibitorsFromAttendees() {
      try {
        const result = await api.post('/api/admin/exhibitors/sync', { event_id: EID });
        toast(result.message || 'Sync complete!');
        loadAdminExhibitors();
      } catch(e) { toast('Sync failed', 'error'); }
    }

    // ============ ADMIN BOOTH REQUESTS ============
    let adminBoothRequestFilter = '';

    async function loadAdminBoothRequests() {
      const section = document.getElementById('section-booth-requests');
      if (!section) return;
      section.innerHTML = '<div class="text-center py-8"><i class="fas fa-spinner fa-spin text-primary-400 text-xl"></i></div>';
      try {
        const [requests, stats] = await Promise.all([
          api.get('/api/admin/booth-requests' + (adminBoothRequestFilter ? '?status='+adminBoothRequestFilter : '')),
          api.get('/api/admin/booth-stats')
        ]);

        const statusColors = {
          submitted: 'bg-blue-500/20 text-blue-300',
          under_review: 'bg-amber-500/20 text-amber-300',
          approved: 'bg-green-500/20 text-green-300',
          rejected: 'bg-red-500/20 text-red-300',
          confirmed: 'bg-emerald-500/20 text-emerald-300',
          cancelled: 'bg-gray-500/20 text-gray-400'
        };
        const payColors = {
          pending: 'bg-amber-500/20 text-amber-300',
          invoice_sent: 'bg-blue-500/20 text-blue-300',
          paid: 'bg-green-500/20 text-green-300',
          cancelled: 'bg-gray-500/20 text-gray-400',
          refunded: 'bg-purple-500/20 text-purple-300'
        };

        section.innerHTML = \`
          <!-- Stats Cards -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <div class="glass rounded-xl p-4 text-center">
              <div class="text-2xl font-black text-primary-400">\${stats.total_requests}</div>
              <div class="text-xs text-gray-500">Total Requests</div>
            </div>
            \${stats.by_status.map(s => \`
              <div class="glass rounded-xl p-4 text-center cursor-pointer card-hover" onclick="adminBoothRequestFilter='\${s.status}'; loadAdminBoothRequests();">
                <div class="text-2xl font-black">\${s.count}</div>
                <div class="text-xs text-gray-500 capitalize">\${s.status.replace('_',' ')}</div>
              </div>
            \`).join('')}
            <div class="glass rounded-xl p-4 text-center border border-green-500/20">
              <div class="text-2xl font-black text-green-400">₹\${Number(stats.total_revenue || 0).toLocaleString('en-IN')}</div>
              <div class="text-xs text-gray-500">Revenue (Paid)</div>
            </div>
          </div>

          <!-- Booth Type Availability -->
          <div class="glass rounded-xl p-4 mb-6 overflow-x-auto">
            <h4 class="text-sm font-semibold mb-3"><i class="fas fa-cubes text-primary-400 mr-2"></i>Booth Inventory</h4>
            <table class="w-full text-xs">
              <thead><tr class="border-b border-white/10">
                <th class="text-left py-2 px-2 text-gray-400">Type</th>
                <th class="text-center py-2 px-2 text-gray-400">Total</th>
                <th class="text-center py-2 px-2 text-gray-400">Available</th>
                <th class="text-center py-2 px-2 text-gray-400">Requests</th>
                <th class="text-center py-2 px-2 text-gray-400">Approved</th>
                <th class="text-right py-2 px-2 text-gray-400">Price</th>
              </tr></thead>
              <tbody>
                \${stats.by_type.map(t => \`
                  <tr class="border-b border-white/5 hover:bg-white/5">
                    <td class="py-2 px-2 font-semibold">\${t.name}</td>
                    <td class="text-center py-2 px-2">\${t.total_count}</td>
                    <td class="text-center py-2 px-2 \${t.available_count <= 3 ? 'text-red-400 font-bold' : 'text-green-400'}">\${t.available_count}</td>
                    <td class="text-center py-2 px-2">\${t.requests}</td>
                    <td class="text-center py-2 px-2 text-green-400">\${t.approved_qty || 0}</td>
                    <td class="text-right py-2 px-2">₹\${Number(t.price_inr).toLocaleString('en-IN')}</td>
                  </tr>
                \`).join('')}
              </tbody>
            </table>
          </div>

          <!-- Filter Tabs -->
          <div class="flex gap-2 mb-4 flex-wrap">
            <button onclick="adminBoothRequestFilter=''; loadAdminBoothRequests();" class="px-3 py-1.5 rounded-lg text-xs font-medium \${!adminBoothRequestFilter ? 'tab-active' : 'glass text-gray-400 hover:text-white'}">All</button>
            \${['submitted','under_review','approved','confirmed','rejected','cancelled'].map(s => \`
              <button onclick="adminBoothRequestFilter='\${s}'; loadAdminBoothRequests();" class="px-3 py-1.5 rounded-lg text-xs font-medium \${adminBoothRequestFilter===s ? 'tab-active' : 'glass text-gray-400 hover:text-white'}">\${s.replace('_',' ')}</button>
            \`).join('')}
          </div>

          <!-- Requests List -->
          <div class="space-y-3">
            \${requests.length ? requests.map(r => \`
              <div class="glass rounded-xl p-4 card-hover" style="border-left:3px solid \${r.booth_color || '#4c6ef5'};">
                <div class="flex flex-col md:flex-row md:items-center justify-between gap-2 mb-2">
                  <div>
                    <span class="font-mono text-xs text-primary-400">#BR-\${String(r.id).padStart(4,'0')}</span>
                    <span class="font-bold ml-2">\${r.company_name}</span>
                    <span class="text-xs text-gray-500 ml-2">\${r.contact_name} &lt;\${r.email}&gt;</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="px-2 py-1 rounded-full text-[10px] font-semibold uppercase \${statusColors[r.status] || ''}">\${r.status.replace('_',' ')}</span>
                    <span class="px-2 py-1 rounded-full text-[10px] font-semibold uppercase \${payColors[r.payment_status] || ''}"><i class="fas fa-credit-card mr-1"></i>\${r.payment_status.replace('_',' ')}</span>
                  </div>
                </div>
                <div class="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs mb-3">
                  <div><span class="text-gray-500">Booth:</span> <span class="font-semibold">\${r.booth_type_name}</span></div>
                  <div><span class="text-gray-500">Size:</span> \${r.size_label}m</div>
                  <div><span class="text-gray-500">Qty:</span> \${r.quantity}</div>
                  <div><span class="text-gray-500">Total:</span> <span class="font-bold text-green-400">₹\${Number(r.grand_total).toLocaleString('en-IN')}</span></div>
                  <div><span class="text-gray-500">Date:</span> \${new Date(r.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</div>
                </div>
                \${r.industry ? '<div class="text-xs text-gray-500 mb-2"><i class="fas fa-industry mr-1"></i>'+r.industry+(r.company_size ? ' &middot; '+r.company_size : '')+'</div>' : ''}
                \${r.products_to_display ? '<div class="text-xs text-gray-500 mb-2"><i class="fas fa-box mr-1"></i>'+r.products_to_display+'</div>' : ''}
                \${r.special_requirements ? '<div class="text-xs text-gray-500 mb-2"><i class="fas fa-star mr-1"></i>'+r.special_requirements+'</div>' : ''}
                <div class="flex gap-2 mt-2 flex-wrap">
                  \${r.status === 'submitted' ? '<button onclick="updateBoothRequest('+r.id+',&apos;under_review&apos;,null)" class="px-3 py-1.5 rounded-lg text-[10px] font-semibold bg-amber-600/20 text-amber-300 hover:bg-amber-600/30"><i class="fas fa-search mr-1"></i>Review</button>' : ''}
                  \${r.status !== 'approved' && r.status !== 'confirmed' && r.status !== 'cancelled' ? '<button onclick="updateBoothRequest('+r.id+',&apos;approved&apos;,null)" class="px-3 py-1.5 rounded-lg text-[10px] font-semibold bg-green-600/20 text-green-300 hover:bg-green-600/30"><i class="fas fa-check mr-1"></i>Approve</button>' : ''}
                  \${r.status !== 'rejected' && r.status !== 'cancelled' ? '<button onclick="updateBoothRequest('+r.id+',&apos;rejected&apos;,null)" class="px-3 py-1.5 rounded-lg text-[10px] font-semibold bg-red-600/20 text-red-300 hover:bg-red-600/30"><i class="fas fa-times mr-1"></i>Reject</button>' : ''}
                  \${r.status === 'approved' && r.payment_status !== 'paid' ? '<button onclick="updateBoothRequestPayment('+r.id+',&apos;paid&apos;)" class="px-3 py-1.5 rounded-lg text-[10px] font-semibold bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30"><i class="fas fa-check-double mr-1"></i>Mark Paid</button>' : ''}
                  <button onclick="addBoothRequestNote('+r.id+')" class="px-3 py-1.5 rounded-lg text-[10px] font-semibold bg-white/5 text-gray-400 hover:bg-white/10"><i class="fas fa-comment mr-1"></i>Note</button>
                </div>
              </div>
            \`).join('') : '<div class="text-center py-8 text-gray-500"><i class="fas fa-inbox text-2xl mb-2 block"></i>No booth requests found.</div>'}
          </div>
        \`;
      } catch(e) {
        console.error('Admin booth requests error:', e);
        section.innerHTML = '<div class="text-center py-8 text-red-400">Failed to load booth requests</div>';
      }
    }

    async function updateBoothRequest(id, status, paymentStatus) {
      try {
        const payload = {};
        if (status) payload.status = status;
        if (paymentStatus) payload.payment_status = paymentStatus;
        payload.reviewed_by = 'admin';
        await api.put('/api/admin/booth-requests/'+id, payload);
        toast('Request updated!');
        loadAdminBoothRequests();
      } catch(e) { toast('Update failed: '+(e.message||''), 'error'); }
    }

    async function updateBoothRequestPayment(id, paymentStatus) {
      if (!confirm('Mark this request as PAID?')) return;
      await updateBoothRequest(id, null, paymentStatus);
    }

    function addBoothRequestNote(id) {
      const note = prompt('Add admin note for request #BR-'+String(id).padStart(4,'0')+':');
      if (note !== null) {
        api.put('/api/admin/booth-requests/'+id, { admin_notes: note }).then(() => {
          toast('Note added!');
          loadAdminBoothRequests();
        }).catch(e => toast('Failed to add note', 'error'));
      }
    }

    // ============ AWARDS ============
    async function loadAdminAwards() {
      const awards = await api.get('/api/events/'+EID+'/awards');
      document.getElementById('section-awards').innerHTML = \`
        <div class="flex items-center justify-between mb-4">
          <span class="text-xs text-gray-400">\${awards.length} categories</span>
          <button onclick="openCreateCategory()" class="px-4 py-2 rounded-xl text-xs font-medium bg-primary-600 hover:bg-primary-500 text-white transition"><i class="fas fa-plus mr-1"></i>Add Category</button>
        </div>
        <div class="space-y-6">
          \${awards.map(cat => {
            return \`
              <div class="glass rounded-2xl p-5">
                <div class="flex items-center justify-between mb-4">
                  <div class="flex items-center gap-3">
                    <span class="text-2xl">\${cat.icon||'🏆'}</span>
                    <div>
                      <h3 class="font-bold">\${cat.name}</h3>
                      <p class="text-xs text-gray-400">\${cat.description||''}</p>
                    </div>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="px-2 py-0.5 rounded-full text-[10px] bg-primary-500/20 text-primary-300">\${cat.nominees.length} nominees</span>
                    <button onclick="openEditCategory(\${cat.id}, '\${cat.name}', '\${cat.description||''}', '\${cat.icon||''}')" class="px-2 py-1 rounded text-xs bg-primary-500/20 text-primary-300 hover:bg-primary-500/30"><i class="fas fa-edit"></i></button>
                    <button onclick="deleteCategory(\${cat.id})" class="px-2 py-1 rounded text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30"><i class="fas fa-trash"></i></button>
                  </div>
                </div>
                <div class="space-y-2 mb-3">
                  \${cat.nominees.map((n,i) => \`
                    <div class="flex items-center gap-3 p-2 rounded-lg glass-light">
                      <span class="w-6 text-center text-xs font-bold text-gray-400">#\${i+1}</span>
                      <div class="flex-1">
                        <div class="flex items-center gap-2">
                          <span class="font-medium text-sm">\${n.name}</span>
                          \${n.is_winner?'<i class="fas fa-crown text-amber-400 text-xs"></i>':''}
                          <span class="text-xs text-gray-500">\${n.company||''}</span>
                        </div>
                      </div>
                      <div class="flex gap-1">
                        <button onclick="declareWinner(\${n.id}, '\${n.name}', '\${n.description||''}', '\${n.company||''}', \${n.is_winner?0:1})" class="px-1.5 py-1 rounded text-[10px] \${n.is_winner?'bg-amber-500/20 text-amber-400':'bg-white/5 text-gray-400 hover:bg-amber-500/20 hover:text-amber-400'}" title="\${n.is_winner?'Remove winner':'Declare winner'}"><i class="fas fa-crown"></i></button>
                        <button onclick="openEditNominee(\${n.id}, '\${n.name.replace(/'/g,"&apos;")}', '\${(n.description||'').replace(/'/g,"&apos;")}', '\${(n.company||'').replace(/'/g,"&apos;")}', \${n.is_winner})" class="px-1.5 py-1 rounded text-[10px] bg-primary-500/20 text-primary-300 hover:bg-primary-500/30"><i class="fas fa-edit"></i></button>
                        <button onclick="deleteNominee(\${n.id})" class="px-1.5 py-1 rounded text-[10px] bg-red-500/20 text-red-400 hover:bg-red-500/30"><i class="fas fa-trash"></i></button>
                      </div>
                    </div>
                  \`).join('')}
                </div>
                <button onclick="openAddNominee(\${cat.id})" class="w-full py-2 rounded-lg text-xs font-medium glass hover:bg-white/10 transition"><i class="fas fa-plus mr-1"></i>Add Nominee</button>
              </div>
            \`;
          }).join('')}
        </div>
      \`;
    }

    function openCreateCategory() {
      openModal(\`<h3 class="text-lg font-bold mb-4"><i class="fas fa-plus text-green-400 mr-2"></i>Add Category</h3>
        <form id="cat-form" class="space-y-3">
          <div><label class="text-xs text-gray-400 mb-1 block">Name *</label><input id="cf-name" required class="w-full px-3 py-2 rounded-lg text-sm"></div>
          <div><label class="text-xs text-gray-400 mb-1 block">Description</label><input id="cf-desc" class="w-full px-3 py-2 rounded-lg text-sm"></div>
          <div><label class="text-xs text-gray-400 mb-1 block">Icon Emoji</label><input id="cf-icon" class="w-full px-3 py-2 rounded-lg text-sm" placeholder="e.g. 🏆"></div>
          <div class="flex gap-2 pt-2"><button type="submit" class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-green-600 hover:bg-green-500 text-white"><i class="fas fa-plus mr-1"></i>Create</button><button type="button" onclick="closeModal()" class="px-4 py-2.5 rounded-xl text-sm font-medium glass hover:bg-white/10">Cancel</button></div>
        </form>\`);
      document.getElementById('cat-form').onsubmit = async e => { e.preventDefault(); await api.post('/api/admin/award-categories', { event_id:EID, name:document.getElementById('cf-name').value, description:document.getElementById('cf-desc').value, icon:document.getElementById('cf-icon').value }); closeModal(); toast('Category created!'); loadAdminAwards(); };
    }

    function openEditCategory(id, name, desc, icon) {
      openModal(\`<h3 class="text-lg font-bold mb-4"><i class="fas fa-edit text-primary-400 mr-2"></i>Edit Category</h3>
        <form id="cat-form" class="space-y-3">
          <div><label class="text-xs text-gray-400 mb-1 block">Name *</label><input id="cf-name" value="\${name}" required class="w-full px-3 py-2 rounded-lg text-sm"></div>
          <div><label class="text-xs text-gray-400 mb-1 block">Description</label><input id="cf-desc" value="\${desc}" class="w-full px-3 py-2 rounded-lg text-sm"></div>
          <div><label class="text-xs text-gray-400 mb-1 block">Icon Emoji</label><input id="cf-icon" value="\${icon}" class="w-full px-3 py-2 rounded-lg text-sm"></div>
          <div class="flex gap-2 pt-2"><button type="submit" class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-primary-600 hover:bg-primary-500 text-white"><i class="fas fa-save mr-1"></i>Save</button><button type="button" onclick="closeModal()" class="px-4 py-2.5 rounded-xl text-sm font-medium glass hover:bg-white/10">Cancel</button></div>
        </form>\`);
      document.getElementById('cat-form').onsubmit = async e => { e.preventDefault(); await api.put('/api/admin/award-categories/'+id, { name:document.getElementById('cf-name').value, description:document.getElementById('cf-desc').value, icon:document.getElementById('cf-icon').value }); closeModal(); toast('Category updated!'); loadAdminAwards(); };
    }

    async function deleteCategory(id) { if (!confirm('Delete this entire category and all its nominees?')) return; await api.del('/api/admin/award-categories/'+id); toast('Category deleted!'); loadAdminAwards(); }
    async function declareWinner(id, name, desc, company, isWinner) { await api.put('/api/admin/nominees/'+id, { name, description:desc, company, is_winner:isWinner }); toast(isWinner?'Winner declared!':'Winner removed!'); loadAdminAwards(); }

    function openAddNominee(catId) {
      openModal(\`<h3 class="text-lg font-bold mb-4"><i class="fas fa-plus text-green-400 mr-2"></i>Add Nominee</h3>
        <form id="nom-form" class="space-y-3">
          <div><label class="text-xs text-gray-400 mb-1 block">Name *</label><input id="nf-name" required class="w-full px-3 py-2 rounded-lg text-sm"></div>
          <div><label class="text-xs text-gray-400 mb-1 block">Description</label><input id="nf-desc" class="w-full px-3 py-2 rounded-lg text-sm"></div>
          <div><label class="text-xs text-gray-400 mb-1 block">Company</label><input id="nf-company" class="w-full px-3 py-2 rounded-lg text-sm"></div>
          <div class="flex gap-2 pt-2"><button type="submit" class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-green-600 hover:bg-green-500 text-white"><i class="fas fa-plus mr-1"></i>Add</button><button type="button" onclick="closeModal()" class="px-4 py-2.5 rounded-xl text-sm font-medium glass hover:bg-white/10">Cancel</button></div>
        </form>\`);
      document.getElementById('nom-form').onsubmit = async e => { e.preventDefault(); await api.post('/api/admin/nominees', { category_id:catId, event_id:EID, name:document.getElementById('nf-name').value, description:document.getElementById('nf-desc').value, company:document.getElementById('nf-company').value }); closeModal(); toast('Nominee added!'); loadAdminAwards(); };
    }

    function openEditNominee(id, name, desc, company, isWinner) {
      openModal(\`<h3 class="text-lg font-bold mb-4"><i class="fas fa-edit text-primary-400 mr-2"></i>Edit Nominee</h3>
        <form id="nom-form" class="space-y-3">
          <div><label class="text-xs text-gray-400 mb-1 block">Name *</label><input id="nf-name" value="\${name}" required class="w-full px-3 py-2 rounded-lg text-sm"></div>
          <div><label class="text-xs text-gray-400 mb-1 block">Description</label><input id="nf-desc" value="\${desc}" class="w-full px-3 py-2 rounded-lg text-sm"></div>
          <div><label class="text-xs text-gray-400 mb-1 block">Company</label><input id="nf-company" value="\${company}" class="w-full px-3 py-2 rounded-lg text-sm"></div>
          <div class="flex gap-2 pt-2"><button type="submit" class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-primary-600 hover:bg-primary-500 text-white"><i class="fas fa-save mr-1"></i>Save</button><button type="button" onclick="closeModal()" class="px-4 py-2.5 rounded-xl text-sm font-medium glass hover:bg-white/10">Cancel</button></div>
        </form>\`);
      document.getElementById('nom-form').onsubmit = async e => { e.preventDefault(); await api.put('/api/admin/nominees/'+id, { name:document.getElementById('nf-name').value, description:document.getElementById('nf-desc').value, company:document.getElementById('nf-company').value, is_winner:isWinner }); closeModal(); toast('Nominee updated!'); loadAdminAwards(); };
    }

    async function deleteNominee(id) { if (!confirm('Delete this nominee?')) return; await api.del('/api/admin/nominees/'+id); toast('Nominee deleted!'); loadAdminAwards(); }

    // ============ ANNOUNCEMENTS ============
    async function loadAdminAnnouncements() {
      const anns = await api.get('/api/events/'+EID+'/announcements');
      document.getElementById('section-announcements').innerHTML = \`
        <div class="flex items-center justify-between mb-4">
          <span class="text-xs text-gray-400">\${anns.length} announcements</span>
          <div class="flex gap-2">
            <button onclick="openBroadcast()" class="px-4 py-2 rounded-xl text-xs font-medium bg-red-600 hover:bg-red-500 text-white transition"><i class="fas fa-broadcast-tower mr-1"></i>Broadcast</button>
            <button onclick="openCreateAnnouncement()" class="px-4 py-2 rounded-xl text-xs font-medium bg-primary-600 hover:bg-primary-500 text-white transition"><i class="fas fa-plus mr-1"></i>Add</button>
          </div>
        </div>
        <div class="space-y-3">
          \${anns.map(a=>\`
            <div class="glass rounded-xl p-4 card-hover \${a.pinned?'border-l-4 border-amber-500':''}">
              <div class="flex items-start justify-between">
                <div class="flex items-start gap-3 flex-1">
                  <div class="w-8 h-8 rounded-lg bg-\${a.announcement_type==='urgent'?'red-500/20':a.announcement_type==='schedule_change'?'yellow-500/20':'primary-500/20'} flex items-center justify-center shrink-0">
                    <i class="fas \${a.announcement_type==='urgent'?'fa-exclamation-triangle text-red-400':a.announcement_type==='schedule_change'?'fa-exchange-alt text-yellow-400':'fa-bullhorn text-primary-400'} text-xs"></i>
                  </div>
                  <div>
                    <div class="flex items-center gap-2">
                      <h4 class="font-semibold text-sm">\${a.title}</h4>
                      \${a.pinned?'<i class="fas fa-thumbtack text-amber-400 text-xs"></i>':''}
                      <span class="px-1.5 py-0.5 rounded text-[10px] bg-white/5 text-gray-400">\${a.announcement_type}</span>
                    </div>
                    <p class="text-xs text-gray-400 mt-1">\${a.content}</p>
                    <p class="text-[10px] text-gray-500 mt-1">by \${a.author_name} &middot; \${new Date(a.created_at).toLocaleString()}</p>
                  </div>
                </div>
                <div class="flex gap-1 shrink-0 ml-2">
                  <button onclick='openEditAnnouncement(\${JSON.stringify(a).replace(/'/g,"&#39;")})' class="px-2 py-1 rounded text-xs bg-primary-500/20 text-primary-300 hover:bg-primary-500/30"><i class="fas fa-edit"></i></button>
                  <button onclick="deleteAnnouncement(\${a.id})" class="px-2 py-1 rounded text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30"><i class="fas fa-trash"></i></button>
                </div>
              </div>
            </div>
          \`).join('')}
        </div>
      \`;
    }

    function announcementFormHTML(a={}) {
      return \`<div class="space-y-3">
        <div><label class="text-xs text-gray-400 mb-1 block">Title *</label><input id="af-title" value="\${a.title||''}" required class="w-full px-3 py-2 rounded-lg text-sm"></div>
        <div><label class="text-xs text-gray-400 mb-1 block">Content *</label><textarea id="af-content" rows="3" required class="w-full px-3 py-2 rounded-lg text-sm">\${a.content||''}</textarea></div>
        <div class="grid grid-cols-3 gap-3">
          <div><label class="text-xs text-gray-400 mb-1 block">Type</label>
            <select id="af-type" class="w-full px-3 py-2 rounded-lg text-sm">
              \${['general','urgent','schedule_change','award_result'].map(t=>'<option '+(a.announcement_type===t?'selected':'')+'>'+t+'</option>').join('')}
            </select></div>
          <div><label class="text-xs text-gray-400 mb-1 block">Author</label><input id="af-author" value="\${a.author_name||'Event Team'}" class="w-full px-3 py-2 rounded-lg text-sm"></div>
          <div class="flex items-end"><label class="flex items-center gap-2 pb-2 cursor-pointer"><input type="checkbox" id="af-pinned" \${a.pinned?'checked':''} class="rounded"><span class="text-xs text-gray-400">Pinned</span></label></div>
        </div>
      </div>\`;
    }

    function getAnnouncementForm() {
      return { event_id:EID, title:document.getElementById('af-title').value, content:document.getElementById('af-content').value, announcement_type:document.getElementById('af-type').value, author_name:document.getElementById('af-author').value, pinned:document.getElementById('af-pinned').checked };
    }

    function openCreateAnnouncement() {
      openModal('<h3 class="text-lg font-bold mb-4"><i class="fas fa-plus text-green-400 mr-2"></i>Create Announcement</h3><form id="af-form">'+announcementFormHTML()+'<div class="flex gap-2 pt-3"><button type="submit" class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-green-600 hover:bg-green-500 text-white"><i class="fas fa-plus mr-1"></i>Create</button><button type="button" onclick="closeModal()" class="px-4 py-2.5 rounded-xl text-sm font-medium glass hover:bg-white/10">Cancel</button></div></form>');
      document.getElementById('af-form').onsubmit = async e => { e.preventDefault(); await api.post('/api/admin/announcements', getAnnouncementForm()); closeModal(); toast('Announcement created!'); loadAdminAnnouncements(); };
    }

    function openEditAnnouncement(a) {
      openModal('<h3 class="text-lg font-bold mb-4"><i class="fas fa-edit text-primary-400 mr-2"></i>Edit Announcement</h3><form id="af-form">'+announcementFormHTML(a)+'<div class="flex gap-2 pt-3"><button type="submit" class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-primary-600 hover:bg-primary-500 text-white"><i class="fas fa-save mr-1"></i>Save</button><button type="button" onclick="closeModal()" class="px-4 py-2.5 rounded-xl text-sm font-medium glass hover:bg-white/10">Cancel</button></div></form>');
      document.getElementById('af-form').onsubmit = async e => { e.preventDefault(); await api.put('/api/admin/announcements/'+a.id, getAnnouncementForm()); closeModal(); toast('Announcement updated!'); loadAdminAnnouncements(); };
    }

    function openBroadcast() {
      openModal(\`<h3 class="text-lg font-bold mb-4"><i class="fas fa-broadcast-tower text-red-400 mr-2"></i>Emergency Broadcast</h3>
        <p class="text-xs text-gray-400 mb-4">This will create a pinned urgent announcement visible to all attendees.</p>
        <form id="bc-form" class="space-y-3">
          <div><label class="text-xs text-gray-400 mb-1 block">Title *</label><input id="bc-title" required class="w-full px-3 py-2 rounded-lg text-sm" placeholder="e.g. Schedule Change"></div>
          <div><label class="text-xs text-gray-400 mb-1 block">Message *</label><textarea id="bc-content" rows="3" required class="w-full px-3 py-2 rounded-lg text-sm" placeholder="Enter your broadcast message..."></textarea></div>
          <div class="flex gap-2 pt-2"><button type="submit" class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-red-600 hover:bg-red-500 text-white"><i class="fas fa-broadcast-tower mr-1"></i>Send Broadcast</button><button type="button" onclick="closeModal()" class="px-4 py-2.5 rounded-xl text-sm font-medium glass hover:bg-white/10">Cancel</button></div>
        </form>\`);
      document.getElementById('bc-form').onsubmit = async e => { e.preventDefault(); await api.post('/api/admin/events/'+EID+'/broadcast', { title:document.getElementById('bc-title').value, content:document.getElementById('bc-content').value }); closeModal(); toast('Broadcast sent!'); loadAdminAnnouncements(); };
    }

    async function deleteAnnouncement(id) { if (!confirm('Delete this announcement?')) return; await api.del('/api/admin/announcements/'+id); toast('Announcement deleted!'); loadAdminAnnouncements(); }

    // ============ EDIT EVENT ============
    async function openEditEvent() {
      const ev = await api.get('/api/events/'+EID);
      openModal(\`<h3 class="text-lg font-bold mb-4"><i class="fas fa-edit text-primary-400 mr-2"></i>Edit Event</h3>
        <form id="ev-form" class="space-y-3">
          <div><label class="text-xs text-gray-400 mb-1 block">Title</label><input id="ev-title" value="\${ev.title}" class="w-full px-3 py-2 rounded-lg text-sm"></div>
          <div><label class="text-xs text-gray-400 mb-1 block">Description</label><textarea id="ev-desc" rows="3" class="w-full px-3 py-2 rounded-lg text-sm">\${ev.description||''}</textarea></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="text-xs text-gray-400 mb-1 block">Venue</label><input id="ev-venue" value="\${ev.venue||''}" class="w-full px-3 py-2 rounded-lg text-sm"></div>
            <div><label class="text-xs text-gray-400 mb-1 block">Status</label>
              <select id="ev-status" class="w-full px-3 py-2 rounded-lg text-sm">
                \${['upcoming','live','completed'].map(s=>'<option '+(ev.status===s?'selected':'')+'>'+s+'</option>').join('')}
              </select></div>
          </div>
          <div class="grid grid-cols-3 gap-3">
            <div><label class="text-xs text-gray-400 mb-1 block">Type</label>
              <select id="ev-type" class="w-full px-3 py-2 rounded-lg text-sm">
                \${['conference','exhibition','awards','hybrid'].map(t=>'<option '+(ev.event_type===t?'selected':'')+'>'+t+'</option>').join('')}
              </select></div>
            <div><label class="text-xs text-gray-400 mb-1 block">Start Date</label><input type="date" id="ev-start" value="\${ev.start_date}" class="w-full px-3 py-2 rounded-lg text-sm"></div>
            <div><label class="text-xs text-gray-400 mb-1 block">End Date</label><input type="date" id="ev-end" value="\${ev.end_date}" class="w-full px-3 py-2 rounded-lg text-sm"></div>
          </div>
          <div><label class="text-xs text-gray-400 mb-1 block">Max Attendees</label><input type="number" id="ev-max" value="\${ev.max_attendees||500}" class="w-full px-3 py-2 rounded-lg text-sm"></div>
          <div class="flex gap-2 pt-2"><button type="submit" class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-primary-600 hover:bg-primary-500 text-white"><i class="fas fa-save mr-1"></i>Save</button><button type="button" onclick="closeModal()" class="px-4 py-2.5 rounded-xl text-sm font-medium glass hover:bg-white/10">Cancel</button></div>
        </form>\`);
      document.getElementById('ev-form').onsubmit = async e => {
        e.preventDefault();
        await api.put('/api/admin/events/'+EID, {
          title:document.getElementById('ev-title').value, description:document.getElementById('ev-desc').value,
          event_type:document.getElementById('ev-type').value, venue:document.getElementById('ev-venue').value,
          start_date:document.getElementById('ev-start').value, end_date:document.getElementById('ev-end').value,
          status:document.getElementById('ev-status').value, max_attendees:parseInt(document.getElementById('ev-max').value),
        });
        closeModal(); toast('Event updated!'); loadOverview();
      };
    }

    // ============ INNOVATION TALKS ============
    async function loadInnovationTalks() {
      const talks = await api.get('/api/events/'+EID+'/innovation-talks');
      const morning = talks.filter(t => t.session_type === 'Morning');
      const afternoon = talks.filter(t => t.session_type === 'Afternoon');

      function renderTalkRow(t) {
        const statusColors = { confirmed: 'bg-green-500/20 text-green-400', tentative: 'bg-amber-500/20 text-amber-400', cancelled: 'bg-red-500/20 text-red-400' };
        const sc = statusColors[t.status] || statusColors.confirmed;
        return '<tr class="hover:bg-white/[0.03] transition" id="italk-row-'+t.id+'">'
          + '<td class="px-3 py-2.5 text-center text-gray-500 text-xs font-mono">'+t.slot_no+'</td>'
          + '<td class="px-3 py-2.5 text-xs text-gray-300"><span class="px-2 py-0.5 rounded bg-white/5">'+esc(t.time_slot)+'</span></td>'
          + '<td class="px-3 py-2.5 font-medium text-sm">'+esc(t.speaker_name)+'</td>'
          + '<td class="px-3 py-2.5 text-xs text-gray-400">'+esc(t.company)+'</td>'
          + '<td class="px-3 py-2.5 text-xs text-gray-400">'+esc(t.topic||'')+'</td>'
          + '<td class="px-3 py-2.5 text-center"><span class="px-2 py-0.5 rounded-full text-[10px] font-medium '+sc+'">'+t.status+'</span></td>'
          + '<td class="px-3 py-2.5 text-center">'
          + '<div class="flex gap-1 justify-center">'
          + '<button onclick="editInnovationTalk('+t.id+')" class="px-2 py-1 rounded text-xs bg-primary-500/20 text-primary-300 hover:bg-primary-500/30" title="Edit"><i class="fas fa-edit"></i></button>'
          + '<button onclick="deleteInnovationTalk('+t.id+')" class="px-2 py-1 rounded text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30" title="Delete"><i class="fas fa-trash"></i></button>'
          + '</div></td></tr>';
      }

      function renderSection(title, icon, color, items) {
        return '<div class="glass rounded-xl overflow-hidden mb-6">'
          + '<div class="px-5 py-3 border-b border-white/5 flex items-center justify-between">'
          + '<div class="flex items-center gap-2"><i class="fas fa-'+icon+' text-'+color+'-400"></i><h3 class="font-semibold text-sm">'+title+'</h3>'
          + '<span class="text-xs text-gray-500">('+items.length+' talks)</span></div>'
          + '<span class="text-[10px] text-gray-500">'+(title==='Morning Session'?'10:00 – 11:30 AM':'2:00 – 4:10 PM')+'</span>'
          + '</div>'
          + '<div class="overflow-x-auto"><table class="w-full text-sm">'
          + '<thead><tr class="text-gray-500 text-xs uppercase border-b border-white/5">'
          + '<th class="px-3 py-2 w-14 text-center">Slot</th>'
          + '<th class="px-3 py-2 w-40">Time</th>'
          + '<th class="px-3 py-2">Speaker(s)</th>'
          + '<th class="px-3 py-2">Company</th>'
          + '<th class="px-3 py-2">Topic</th>'
          + '<th class="px-3 py-2 w-24 text-center">Status</th>'
          + '<th class="px-3 py-2 w-24 text-center">Actions</th>'
          + '</tr></thead><tbody>'
          + items.map(renderTalkRow).join('')
          + '</tbody></table></div></div>';
      }

      document.getElementById('section-innovation').innerHTML =
        '<div class="flex items-center justify-between mb-4 flex-wrap gap-3">'
        + '<div class="flex gap-2 items-center">'
        + '<span class="text-xs text-gray-400">'+talks.length+' talks total</span>'
        + '<span class="text-xs text-amber-400"><i class="fas fa-sun mr-0.5"></i>'+morning.length+' morning</span>'
        + '<span class="text-xs text-indigo-400"><i class="fas fa-moon mr-0.5"></i>'+afternoon.length+' afternoon</span>'
        + '</div>'
        + '<div class="flex gap-2">'
        + '<button onclick="addInnovationTalk()" class="px-4 py-2 rounded-xl text-xs font-medium bg-primary-600 hover:bg-primary-500 text-white transition"><i class="fas fa-plus mr-1.5"></i>Add Talk</button>'
        + '</div></div>'
        + renderSection('Morning Session', 'sun', 'amber', morning)
        + renderSection('Afternoon Session', 'moon', 'indigo', afternoon);
    }

    function addInnovationTalk() {
      const box = document.getElementById('modal-box');
      box.innerHTML =
        '<div class="p-6"><h3 class="text-lg font-bold mb-4"><i class="fas fa-plus-circle text-primary-400 mr-2"></i>Add Innovation Talk</h3>'
        + '<form id="add-italk-form" class="space-y-3">'
        + '<div class="grid grid-cols-2 gap-3">'
        + '<div><label class="text-xs text-gray-400 mb-1 block">Slot No.</label><input type="number" name="slot_no" class="w-full px-3 py-2 rounded-lg text-sm" required></div>'
        + '<div><label class="text-xs text-gray-400 mb-1 block">Session</label><select name="session_type" class="w-full px-3 py-2 rounded-lg text-sm"><option>Morning</option><option>Afternoon</option></select></div>'
        + '</div>'
        + '<div><label class="text-xs text-gray-400 mb-1 block">Time Slot</label><input type="text" name="time_slot" placeholder="e.g. 10:00 – 10:10 AM" class="w-full px-3 py-2 rounded-lg text-sm" required></div>'
        + '<div><label class="text-xs text-gray-400 mb-1 block">Speaker Name(s)</label><input type="text" name="speaker_name" class="w-full px-3 py-2 rounded-lg text-sm" required></div>'
        + '<div><label class="text-xs text-gray-400 mb-1 block">Company</label><input type="text" name="company" class="w-full px-3 py-2 rounded-lg text-sm"></div>'
        + '<div><label class="text-xs text-gray-400 mb-1 block">Topic / Title</label><input type="text" name="topic" class="w-full px-3 py-2 rounded-lg text-sm"></div>'
        + '<div><label class="text-xs text-gray-400 mb-1 block">Status</label><select name="status" class="w-full px-3 py-2 rounded-lg text-sm"><option value="confirmed">Confirmed</option><option value="tentative">Tentative</option><option value="cancelled">Cancelled</option></select></div>'
        + '<div><label class="text-xs text-gray-400 mb-1 block">Notes</label><textarea name="notes" rows="2" class="w-full px-3 py-2 rounded-lg text-sm"></textarea></div>'
        + '<div class="flex gap-2 pt-2"><button type="submit" class="flex-1 py-2 rounded-xl text-sm font-medium bg-primary-600 hover:bg-primary-500 text-white transition">Add Talk</button>'
        + '<button type="button" onclick="closeModal()" class="px-6 py-2 rounded-xl text-sm glass hover:bg-white/10 text-gray-300 transition">Cancel</button></div>'
        + '</form></div>';
      openModal();
      document.getElementById('add-italk-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const data = Object.fromEntries(fd.entries());
        data.event_id = EID;
        data.slot_no = parseInt(data.slot_no);
        try {
          await api.post('/api/admin/innovation-talks', data);
          toast('Talk added successfully', 'success');
          closeModal();
          loadInnovationTalks();
        } catch(err) { toast('Failed to add talk: ' + err.message, 'error'); }
      });
    }

    async function editInnovationTalk(id) {
      const talks = await api.get('/api/events/'+EID+'/innovation-talks');
      const t = talks.find(x => x.id === id);
      if (!t) { toast('Talk not found', 'error'); return; }
      const box = document.getElementById('modal-box');
      box.innerHTML =
        '<div class="p-6"><h3 class="text-lg font-bold mb-4"><i class="fas fa-edit text-primary-400 mr-2"></i>Edit Innovation Talk #'+t.slot_no+'</h3>'
        + '<form id="edit-italk-form" class="space-y-3">'
        + '<div class="grid grid-cols-2 gap-3">'
        + '<div><label class="text-xs text-gray-400 mb-1 block">Slot No.</label><input type="number" name="slot_no" value="'+t.slot_no+'" class="w-full px-3 py-2 rounded-lg text-sm" required></div>'
        + '<div><label class="text-xs text-gray-400 mb-1 block">Session</label><select name="session_type" class="w-full px-3 py-2 rounded-lg text-sm"><option '+(t.session_type==='Morning'?'selected':'')+'>Morning</option><option '+(t.session_type==='Afternoon'?'selected':'')+'>Afternoon</option></select></div>'
        + '</div>'
        + '<div><label class="text-xs text-gray-400 mb-1 block">Time Slot</label><input type="text" name="time_slot" value="'+esc(t.time_slot)+'" class="w-full px-3 py-2 rounded-lg text-sm" required></div>'
        + '<div><label class="text-xs text-gray-400 mb-1 block">Speaker Name(s)</label><input type="text" name="speaker_name" value="'+esc(t.speaker_name)+'" class="w-full px-3 py-2 rounded-lg text-sm" required></div>'
        + '<div><label class="text-xs text-gray-400 mb-1 block">Company</label><input type="text" name="company" value="'+esc(t.company)+'" class="w-full px-3 py-2 rounded-lg text-sm"></div>'
        + '<div><label class="text-xs text-gray-400 mb-1 block">Topic / Title</label><input type="text" name="topic" value="'+esc(t.topic||'')+'" class="w-full px-3 py-2 rounded-lg text-sm"></div>'
        + '<div><label class="text-xs text-gray-400 mb-1 block">Status</label><select name="status" class="w-full px-3 py-2 rounded-lg text-sm"><option value="confirmed" '+(t.status==='confirmed'?'selected':'')+'>Confirmed</option><option value="tentative" '+(t.status==='tentative'?'selected':'')+'>Tentative</option><option value="cancelled" '+(t.status==='cancelled'?'selected':'')+'>Cancelled</option></select></div>'
        + '<div><label class="text-xs text-gray-400 mb-1 block">Notes</label><textarea name="notes" rows="2" class="w-full px-3 py-2 rounded-lg text-sm">'+esc(t.notes||'')+'</textarea></div>'
        + '<div class="flex gap-2 pt-2"><button type="submit" class="flex-1 py-2 rounded-xl text-sm font-medium bg-primary-600 hover:bg-primary-500 text-white transition">Save Changes</button>'
        + '<button type="button" onclick="closeModal()" class="px-6 py-2 rounded-xl text-sm glass hover:bg-white/10 text-gray-300 transition">Cancel</button></div>'
        + '</form></div>';
      openModal();
      document.getElementById('edit-italk-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const data = Object.fromEntries(fd.entries());
        data.slot_no = parseInt(data.slot_no);
        try {
          await api.patch('/api/admin/innovation-talks/'+id, data);
          toast('Talk updated', 'success');
          closeModal();
          loadInnovationTalks();
        } catch(err) { toast('Failed to update: ' + err.message, 'error'); }
      });
    }

    async function deleteInnovationTalk(id) {
      if (!confirm('Delete this innovation talk?')) return;
      try {
        await api.del('/api/admin/innovation-talks/'+id);
        toast('Talk deleted', 'success');
        loadInnovationTalks();
      } catch(err) { toast('Failed to delete: ' + err.message, 'error'); }
    }

    // ============ ADMIN STARTUP PITCH ============
    async function loadAdminStartupPitch() {
      try {
        const data = await api.get('/api/admin/startup-pitches?event_id=' + EID);
        const pitches = data.pitches || [];
        const investors = data.investors || [];

        document.getElementById('section-startup-pitch').innerHTML = \`
          <div class="space-y-6">
            <!-- Pitches Section -->
            <div class="glass rounded-2xl p-6">
              <div class="flex items-center justify-between mb-4">
                <h3 class="text-lg font-bold"><i class="fas fa-microphone-alt text-orange-400 mr-2"></i>Startup Pitches <span class="text-sm text-gray-500 font-normal">(\${pitches.length})</span></h3>
                <button onclick="showAddPitchForm()" class="px-4 py-2 rounded-xl text-xs font-semibold bg-orange-600 hover:bg-orange-500 text-white transition"><i class="fas fa-plus mr-1"></i>Add Pitch</button>
              </div>
              <!-- Add / Edit Form (hidden by default) -->
              <div id="pitch-form-container" class="hidden mb-4 glass rounded-xl p-4 border border-orange-500/20">
                <h4 class="text-sm font-bold mb-3" id="pitch-form-title"><i class="fas fa-plus text-orange-400 mr-1"></i>Add New Pitch</h4>
                <input type="hidden" id="pf-id" value="">
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                  <div>
                    <label class="text-[10px] text-gray-400 mb-0.5 block">Slot Order</label>
                    <input type="number" id="pf-order" class="w-full px-3 py-2 rounded-lg text-sm" placeholder="1">
                  </div>
                  <div>
                    <label class="text-[10px] text-gray-400 mb-0.5 block">Time Slot</label>
                    <input type="text" id="pf-time" class="w-full px-3 py-2 rounded-lg text-sm" placeholder="2:30 – 2:38 PM">
                  </div>
                  <div>
                    <label class="text-[10px] text-gray-400 mb-0.5 block">Company</label>
                    <input type="text" id="pf-company" class="w-full px-3 py-2 rounded-lg text-sm" placeholder="Company Name">
                  </div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                  <div>
                    <label class="text-[10px] text-gray-400 mb-0.5 block">Pitcher Name</label>
                    <input type="text" id="pf-name" class="w-full px-3 py-2 rounded-lg text-sm" placeholder="Full Name">
                  </div>
                  <div>
                    <label class="text-[10px] text-gray-400 mb-0.5 block">Pitcher Title</label>
                    <input type="text" id="pf-title" class="w-full px-3 py-2 rounded-lg text-sm" placeholder="CEO & Founder">
                  </div>
                </div>
                <div class="mb-3">
                  <label class="text-[10px] text-gray-400 mb-0.5 block">Profile / Description</label>
                  <textarea id="pf-profile" rows="2" class="w-full px-3 py-2 rounded-lg text-sm" placeholder="Brief bio or description..."></textarea>
                </div>
                <div class="flex gap-2">
                  <button onclick="savePitch()" class="px-4 py-2 rounded-lg text-xs font-semibold bg-orange-600 hover:bg-orange-500 text-white transition"><i class="fas fa-save mr-1"></i>Save</button>
                  <button onclick="document.getElementById('pitch-form-container').classList.add('hidden')" class="px-4 py-2 rounded-lg text-xs font-medium glass hover:bg-white/10 text-gray-300 transition border border-white/10">Cancel</button>
                </div>
              </div>
              <!-- Pitches Table -->
              <div class="overflow-x-auto">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="border-b border-white/10 text-xs text-gray-400">
                      <th class="py-2 px-2 text-left">#</th>
                      <th class="py-2 px-2 text-left">Time</th>
                      <th class="py-2 px-2 text-left">Company</th>
                      <th class="py-2 px-2 text-left">Pitcher</th>
                      <th class="py-2 px-2 text-left">Title</th>
                      <th class="py-2 px-2 text-center">Active</th>
                      <th class="py-2 px-2 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-white/5">
                    \${pitches.map(p => \`
                      <tr class="hover:bg-white/[0.02] \${p.is_active ? '' : 'opacity-40'}">
                        <td class="py-2 px-2 text-gray-500">\${p.slot_order}</td>
                        <td class="py-2 px-2"><span class="px-2 py-0.5 rounded-full text-[10px] bg-orange-500/15 text-orange-300">\${p.time_slot}</span></td>
                        <td class="py-2 px-2 font-medium text-white">\${p.company}</td>
                        <td class="py-2 px-2 text-gray-300">\${p.pitcher_name}</td>
                        <td class="py-2 px-2 text-gray-400 text-xs">\${p.pitcher_title}</td>
                        <td class="py-2 px-2 text-center">
                          <button onclick="togglePitchActive(\${p.id}, \${p.is_active ? 0 : 1}, \${JSON.stringify(JSON.stringify(p))})" class="text-xs \${p.is_active ? 'text-green-400' : 'text-red-400'}">\${p.is_active ? '\u2705' : '\u274c'}</button>
                        </td>
                        <td class="py-2 px-2 text-center">
                          <button onclick='editPitch(\${JSON.stringify(p)})' class="text-primary-400 hover:text-primary-300 mr-2" title="Edit"><i class="fas fa-edit"></i></button>
                          <button onclick="deletePitch(\${p.id})" class="text-red-400 hover:text-red-300" title="Delete"><i class="fas fa-trash"></i></button>
                        </td>
                      </tr>
                    \`).join('')}
                    \${pitches.length === 0 ? '<tr><td colspan="7" class="py-8 text-center text-gray-500"><i class="fas fa-rocket text-2xl mb-2 block opacity-30"></i>No pitches added yet</td></tr>' : ''}
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Investors Section -->
            <div class="glass rounded-2xl p-6">
              <div class="flex items-center justify-between mb-4">
                <h3 class="text-lg font-bold"><i class="fas fa-hand-holding-usd text-emerald-400 mr-2"></i>Investors & Evaluators <span class="text-sm text-gray-500 font-normal">(\${investors.length})</span></h3>
                <button onclick="showAddInvestorForm()" class="px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition"><i class="fas fa-plus mr-1"></i>Add Investor</button>
              </div>
              <!-- Add / Edit Form -->
              <div id="investor-form-container" class="hidden mb-4 glass rounded-xl p-4 border border-emerald-500/20">
                <h4 class="text-sm font-bold mb-3" id="investor-form-title"><i class="fas fa-plus text-emerald-400 mr-1"></i>Add New Investor</h4>
                <input type="hidden" id="if-id" value="">
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                  <div>
                    <label class="text-[10px] text-gray-400 mb-0.5 block">Name</label>
                    <input type="text" id="if-name" class="w-full px-3 py-2 rounded-lg text-sm" placeholder="Full Name">
                  </div>
                  <div>
                    <label class="text-[10px] text-gray-400 mb-0.5 block">Title / Role</label>
                    <input type="text" id="if-title" class="w-full px-3 py-2 rounded-lg text-sm" placeholder="Managing Partner">
                  </div>
                  <div>
                    <label class="text-[10px] text-gray-400 mb-0.5 block">Company / Fund</label>
                    <input type="text" id="if-company" class="w-full px-3 py-2 rounded-lg text-sm" placeholder="Venture Capital Fund">
                  </div>
                </div>
                <div class="flex gap-2">
                  <button onclick="saveInvestor()" class="px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition"><i class="fas fa-save mr-1"></i>Save</button>
                  <button onclick="document.getElementById('investor-form-container').classList.add('hidden')" class="px-4 py-2 rounded-lg text-xs font-medium glass hover:bg-white/10 text-gray-300 transition border border-white/10">Cancel</button>
                </div>
              </div>
              <!-- Investors Grid -->
              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                \${investors.map(inv => \`
                  <div class="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5 \${inv.is_active ? '' : 'opacity-40'}">
                    <img src="https://ui-avatars.com/api/?name=\${encodeURIComponent(inv.name)}&size=40&background=065f46&color=fff&bold=true&rounded=true" class="w-10 h-10 rounded-full shrink-0">
                    <div class="flex-1 min-w-0">
                      <div class="font-semibold text-sm text-white truncate">\${inv.name}</div>
                      \${inv.title ? '<div class="text-[10px] text-emerald-400/80 truncate">'+inv.title+'</div>' : ''}
                      \${inv.company ? '<div class="text-[10px] text-gray-500 truncate">'+inv.company+'</div>' : ''}
                    </div>
                    <div class="flex gap-1 shrink-0">
                      <button onclick='editInvestor(\${JSON.stringify(inv)})' class="text-primary-400 hover:text-primary-300 text-xs p-1" title="Edit"><i class="fas fa-edit"></i></button>
                      <button onclick="toggleInvestorActive(\${inv.id}, \${inv.is_active ? 0 : 1}, \${JSON.stringify(JSON.stringify(inv))})" class="text-xs p-1 \${inv.is_active ? 'text-green-400' : 'text-red-400'}" title="Toggle">\${inv.is_active ? '\u2705' : '\u274c'}</button>
                      <button onclick="deleteInvestor(\${inv.id})" class="text-red-400 hover:text-red-300 text-xs p-1" title="Delete"><i class="fas fa-trash"></i></button>
                    </div>
                  </div>
                \`).join('')}
                \${investors.length === 0 ? '<div class="col-span-full text-center py-8 text-gray-500"><i class="fas fa-hand-holding-usd text-2xl mb-2 block opacity-30"></i>No investors added yet</div>' : ''}
              </div>
            </div>
          </div>
        \`;
      } catch(err) { toast('Failed to load startup pitch data: ' + err.message, 'error'); }
    }

    // Pitch CRUD helpers
    function showAddPitchForm() {
      document.getElementById('pitch-form-container').classList.remove('hidden');
      document.getElementById('pitch-form-title').innerHTML = '<i class="fas fa-plus text-orange-400 mr-1"></i>Add New Pitch';
      document.getElementById('pf-id').value = '';
      document.getElementById('pf-order').value = '';
      document.getElementById('pf-time').value = '';
      document.getElementById('pf-company').value = '';
      document.getElementById('pf-name').value = '';
      document.getElementById('pf-title').value = '';
      document.getElementById('pf-profile').value = '';
    }

    function editPitch(p) {
      document.getElementById('pitch-form-container').classList.remove('hidden');
      document.getElementById('pitch-form-title').innerHTML = '<i class="fas fa-edit text-orange-400 mr-1"></i>Edit Pitch';
      document.getElementById('pf-id').value = p.id;
      document.getElementById('pf-order').value = p.slot_order;
      document.getElementById('pf-time').value = p.time_slot;
      document.getElementById('pf-company').value = p.company;
      document.getElementById('pf-name').value = p.pitcher_name;
      document.getElementById('pf-title').value = p.pitcher_title;
      document.getElementById('pf-profile').value = p.pitcher_profile;
    }

    async function savePitch() {
      const id = document.getElementById('pf-id').value;
      const payload = {
        event_id: EID,
        slot_order: parseInt(document.getElementById('pf-order').value) || 0,
        time_slot: document.getElementById('pf-time').value,
        company: document.getElementById('pf-company').value,
        pitcher_name: document.getElementById('pf-name').value,
        pitcher_title: document.getElementById('pf-title').value,
        pitcher_profile: document.getElementById('pf-profile').value,
        is_active: 1,
      };
      if (!payload.company || !payload.pitcher_name) { toast('Company and pitcher name are required', 'error'); return; }
      try {
        if (id) {
          await api.put('/api/admin/startup-pitches/' + id, payload);
          toast('Pitch updated!', 'success');
        } else {
          await api.post('/api/admin/startup-pitches', payload);
          toast('Pitch added!', 'success');
        }
        loadAdminStartupPitch();
      } catch(err) { toast('Failed to save: ' + err.message, 'error'); }
    }

    async function togglePitchActive(id, newState, pJson) {
      try {
        const p = JSON.parse(pJson);
        await api.put('/api/admin/startup-pitches/' + id, { ...p, is_active: newState });
        toast(newState ? 'Pitch activated' : 'Pitch deactivated', 'success');
        loadAdminStartupPitch();
      } catch(err) { toast('Failed: ' + err.message, 'error'); }
    }

    async function deletePitch(id) {
      if (!confirm('Delete this pitch entry?')) return;
      try {
        await api.delete('/api/admin/startup-pitches/' + id);
        toast('Pitch deleted', 'success');
        loadAdminStartupPitch();
      } catch(err) { toast('Failed to delete: ' + err.message, 'error'); }
    }

    // Investor CRUD helpers
    function showAddInvestorForm() {
      document.getElementById('investor-form-container').classList.remove('hidden');
      document.getElementById('investor-form-title').innerHTML = '<i class="fas fa-plus text-emerald-400 mr-1"></i>Add New Investor';
      document.getElementById('if-id').value = '';
      document.getElementById('if-name').value = '';
      document.getElementById('if-title').value = '';
      document.getElementById('if-company').value = '';
    }

    function editInvestor(inv) {
      document.getElementById('investor-form-container').classList.remove('hidden');
      document.getElementById('investor-form-title').innerHTML = '<i class="fas fa-edit text-emerald-400 mr-1"></i>Edit Investor';
      document.getElementById('if-id').value = inv.id;
      document.getElementById('if-name').value = inv.name;
      document.getElementById('if-title').value = inv.title || '';
      document.getElementById('if-company').value = inv.company || '';
    }

    async function saveInvestor() {
      const id = document.getElementById('if-id').value;
      const payload = {
        event_id: EID,
        name: document.getElementById('if-name').value,
        title: document.getElementById('if-title').value,
        company: document.getElementById('if-company').value,
        is_active: 1,
      };
      if (!payload.name) { toast('Investor name is required', 'error'); return; }
      try {
        if (id) {
          await api.put('/api/admin/startup-investors/' + id, payload);
          toast('Investor updated!', 'success');
        } else {
          await api.post('/api/admin/startup-investors', payload);
          toast('Investor added!', 'success');
        }
        loadAdminStartupPitch();
      } catch(err) { toast('Failed to save: ' + err.message, 'error'); }
    }

    async function toggleInvestorActive(id, newState, invJson) {
      try {
        const inv = JSON.parse(invJson);
        await api.put('/api/admin/startup-investors/' + id, { ...inv, is_active: newState });
        toast(newState ? 'Investor activated' : 'Investor deactivated', 'success');
        loadAdminStartupPitch();
      } catch(err) { toast('Failed: ' + err.message, 'error'); }
    }

    async function deleteInvestor(id) {
      if (!confirm('Remove this investor?')) return;
      try {
        await api.delete('/api/admin/startup-investors/' + id);
        toast('Investor removed', 'success');
        loadAdminStartupPitch();
      } catch(err) { toast('Failed to delete: ' + err.message, 'error'); }
    }

    // ============ ADMIN INQUIRIES ============
    let inquiryFilterType = '';
    let inquiryFilterStatus = '';

    async function loadAdminInquiries() {
      try {
        let url = '/api/admin/inquiries?';
        if (inquiryFilterType) url += 'type=' + inquiryFilterType + '&';
        if (inquiryFilterStatus) url += 'status=' + inquiryFilterStatus + '&';
        const data = await api.get(url);
        const { inquiries, typeCounts, statusCounts } = data;

        const totalNew = (statusCounts || []).find(s => s.status === 'new');
        const totalAll = (inquiries || []).length;

        const typeLabels = {
          general: { icon: 'fa-question-circle', color: 'primary', label: 'General' },
          exhibition: { icon: 'fa-store', color: 'amber', label: 'Exhibition' },
          booth_inquiry: { icon: 'fa-store-alt', color: 'amber', label: 'Booth Inquiry' },
          sponsorship: { icon: 'fa-handshake', color: 'orange', label: 'Sponsorship' },
          speaking: { icon: 'fa-microphone-alt', color: 'purple', label: 'Speaking' },
          media: { icon: 'fa-newspaper', color: 'rose', label: 'Media' },
          group_registration: { icon: 'fa-users', color: 'green', label: 'Group Reg' },
          other: { icon: 'fa-ellipsis-h', color: 'gray', label: 'Other' }
        };

        const statusColors = { new: 'bg-blue-500/20 text-blue-300', in_progress: 'bg-amber-500/20 text-amber-300', responded: 'bg-green-500/20 text-green-300', closed: 'bg-gray-500/20 text-gray-400' };

        // Type filter pills
        const typeFilterHtml = '<button onclick="inquiryFilterType=\\'\\';loadAdminInquiries()" class="px-3 py-1.5 rounded-lg text-xs font-medium transition ' + (!inquiryFilterType ? 'bg-primary-500/20 text-primary-300 border border-primary-500/30' : 'glass hover:bg-white/10 text-gray-400') + '">All (' + totalAll + ')</button>' +
          (typeCounts || []).map(tc => {
            const cfg = typeLabels[tc.inquiry_type] || typeLabels.other;
            const active = inquiryFilterType === tc.inquiry_type;
            return '<button onclick="inquiryFilterType=\\'' + tc.inquiry_type + '\\';loadAdminInquiries()" class="px-3 py-1.5 rounded-lg text-xs font-medium transition ' + (active ? 'bg-' + cfg.color + '-500/20 text-' + cfg.color + '-300 border border-' + cfg.color + '-500/30' : 'glass hover:bg-white/10 text-gray-400') + '"><i class="fas ' + cfg.icon + ' mr-1"></i>' + cfg.label + ' (' + tc.count + ')</button>';
          }).join('');

        // Status filter
        const statusFilterHtml = '<select onchange="inquiryFilterStatus=this.value;loadAdminInquiries()" class="px-3 py-1.5 rounded-lg text-xs font-medium glass">' +
          '<option value=""' + (!inquiryFilterStatus ? ' selected' : '') + '>All Status</option>' +
          '<option value="new"' + (inquiryFilterStatus === 'new' ? ' selected' : '') + '>New</option>' +
          '<option value="in_progress"' + (inquiryFilterStatus === 'in_progress' ? ' selected' : '') + '>In Progress</option>' +
          '<option value="responded"' + (inquiryFilterStatus === 'responded' ? ' selected' : '') + '>Responded</option>' +
          '<option value="closed"' + (inquiryFilterStatus === 'closed' ? ' selected' : '') + '>Closed</option></select>';

        const rows = (inquiries || []).map(inq => {
          const cfg = typeLabels[inq.inquiry_type] || typeLabels.other;
          const sColor = statusColors[inq.status] || statusColors.new;
          const meta = inq.metadata ? (function() { try { return JSON.parse(inq.metadata); } catch(e) { return {}; } })() : {};
          const metaStr = Object.entries(meta).filter(([k,v]) => v).map(([k,v]) => '<span class="text-[10px] text-gray-500">' + k.replace(/_/g,' ') + ': ' + v + '</span>').join(' · ');

          return '<div class="glass rounded-xl p-4 border border-white/5 hover:border-white/10 transition">' +
            '<div class="flex items-start justify-between gap-3">' +
              '<div class="flex-1 min-w-0">' +
                '<div class="flex items-center gap-2 mb-1">' +
                  '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-' + cfg.color + '-500/20 text-' + cfg.color + '-300"><i class="fas ' + cfg.icon + ' mr-1"></i>' + cfg.label + '</span>' +
                  '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold ' + sColor + '">' + inq.status.replace('_', ' ') + '</span>' +
                  '<span class="text-[10px] text-gray-500">#' + inq.id + '</span>' +
                '</div>' +
                '<h4 class="font-semibold text-sm truncate">' + (inq.subject || inq.name) + '</h4>' +
                '<p class="text-xs text-gray-400 mt-0.5">' + inq.name + (inq.organization ? ' · ' + inq.organization : '') + '</p>' +
                '<p class="text-xs text-gray-500 mt-0.5"><i class="fas fa-envelope mr-1"></i>' + inq.email + (inq.phone ? ' · <i class="fas fa-phone mr-1"></i>' + inq.phone : '') + '</p>' +
                '<p class="text-xs text-gray-300 mt-2 line-clamp-2">' + (inq.message || '<em class="text-gray-500">No message</em>') + '</p>' +
                (metaStr ? '<div class="mt-1">' + metaStr + '</div>' : '') +
                (inq.admin_notes ? '<div class="mt-2 p-2 rounded-lg bg-amber-500/5 border border-amber-500/10 text-xs text-amber-300"><i class="fas fa-sticky-note mr-1"></i>' + inq.admin_notes + '</div>' : '') +
              '</div>' +
              '<div class="flex flex-col gap-1 shrink-0">' +
                '<select onchange="updateInquiryStatus(' + inq.id + ', this.value)" class="px-2 py-1 rounded-lg text-[10px] glass">' +
                  '<option value="new"' + (inq.status === 'new' ? ' selected' : '') + '>New</option>' +
                  '<option value="in_progress"' + (inq.status === 'in_progress' ? ' selected' : '') + '>In Progress</option>' +
                  '<option value="responded"' + (inq.status === 'responded' ? ' selected' : '') + '>Responded</option>' +
                  '<option value="closed"' + (inq.status === 'closed' ? ' selected' : '') + '>Closed</option>' +
                '</select>' +
                '<button onclick="addInquiryNote(' + inq.id + ')" class="px-2 py-1 rounded-lg text-[10px] glass hover:bg-white/10 transition" title="Add note"><i class="fas fa-sticky-note mr-1"></i>Note</button>' +
                '<button onclick="deleteInquiry(' + inq.id + ')" class="px-2 py-1 rounded-lg text-[10px] text-red-400 glass hover:bg-red-500/10 transition" title="Delete"><i class="fas fa-trash"></i></button>' +
              '</div>' +
            '</div>' +
            '<div class="text-[10px] text-gray-600 mt-2">' + new Date(inq.created_at).toLocaleString() + '</div>' +
          '</div>';
        }).join('');

        document.getElementById('section-inquiries').innerHTML =
          '<div class="space-y-4">' +
            '<div class="flex flex-wrap gap-2 items-center">' + typeFilterHtml + '<div class="ml-auto">' + statusFilterHtml + '</div></div>' +
            (rows || '<div class="text-center py-12 text-gray-500"><i class="fas fa-inbox text-4xl mb-3"></i><p>No inquiries yet</p></div>') +
          '</div>';
      } catch(err) {
        document.getElementById('section-inquiries').innerHTML = '<div class="text-center py-12 text-red-400"><i class="fas fa-exclamation-triangle text-3xl mb-3"></i><p>Failed to load inquiries: ' + err.message + '</p></div>';
      }
    }

    async function updateInquiryStatus(id, status) {
      try {
        await api.patch('/api/admin/inquiries/' + id, { status });
        toast('Status updated', 'success');
        loadAdminInquiries();
      } catch(err) { toast('Failed: ' + err.message, 'error'); }
    }

    async function addInquiryNote(id) {
      const note = prompt('Add admin note for inquiry #' + id + ':');
      if (note === null) return;
      try {
        await api.patch('/api/admin/inquiries/' + id, { admin_notes: note });
        toast('Note saved', 'success');
        loadAdminInquiries();
      } catch(err) { toast('Failed: ' + err.message, 'error'); }
    }

    async function deleteInquiry(id) {
      if (!confirm('Delete inquiry #' + id + '?')) return;
      try {
        await api.del('/api/admin/inquiries/' + id);
        toast('Inquiry deleted', 'success');
        loadAdminInquiries();
      } catch(err) { toast('Failed: ' + err.message, 'error'); }
    }

    // ============ ANALYTICS ============
    async function loadAnalytics() {
      const [analytics, stats] = await Promise.all([
        api.get('/api/admin/events/'+EID+'/analytics'),
        api.get('/api/events/'+EID+'/stats'),
      ]);

      document.getElementById('section-analytics').innerHTML = \`
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div class="glass rounded-xl p-4 text-center"><div class="text-2xl font-bold text-primary-400">\${stats.attendees}</div><div class="text-xs text-gray-500">Total Attendees</div></div>
          <div class="glass rounded-xl p-4 text-center"><div class="text-2xl font-bold text-green-400">\${analytics.messageCount}</div><div class="text-xs text-gray-500">Messages Sent</div></div>
          <div class="glass rounded-xl p-4 text-center"><div class="text-2xl font-bold text-accent-400">\${analytics.boothVisitCount}</div><div class="text-xs text-gray-500">Booth Visits</div></div>
          <div class="glass rounded-xl p-4 text-center"><div class="text-2xl font-bold text-purple-400">\${stats.categories}</div><div class="text-xs text-gray-500">Award Categories</div></div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div class="glass rounded-xl p-5"><h3 class="font-semibold text-sm mb-3"><i class="fas fa-id-badge text-accent-400 mr-2"></i>Attendees by Badge</h3><div class="chart-container"><canvas id="chart-badges"></canvas></div></div>
          <div class="glass rounded-xl p-5"><h3 class="font-semibold text-sm mb-3"><i class="fas fa-calendar text-primary-400 mr-2"></i>Sessions by Type</h3><div class="chart-container"><canvas id="chart-session-types"></canvas></div></div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div class="glass rounded-xl p-5"><h3 class="font-semibold text-sm mb-3"><i class="fas fa-handshake text-green-400 mr-2"></i>Connections by Status</h3><div class="chart-container"><canvas id="chart-connections"></canvas></div></div>
          <div class="glass rounded-xl p-5"><h3 class="font-semibold text-sm mb-3"><i class="fas fa-calendar-check text-purple-400 mr-2"></i>Meetings by Status</h3><div class="chart-container"><canvas id="chart-meetings"></canvas></div></div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="glass rounded-xl p-5">
            <h3 class="font-semibold text-sm mb-3"><i class="fas fa-trophy text-amber-400 mr-2"></i>Top Nominees</h3>
            <div class="space-y-2">\${analytics.topNominees.map((n,i) => \`
              <div class="flex items-center gap-3 p-2 rounded-lg glass-light">
                <span class="w-6 text-center text-xs font-bold \${i<3?'text-amber-400':'text-gray-500'}">#\${i+1}</span>
                <div class="flex-1"><span class="text-sm font-medium">\${n.name}</span><span class="text-xs text-gray-500 ml-2">\${n.category_name}</span></div>
                \${n.is_winner ? '<i class="fas fa-crown text-amber-400 text-xs"></i>' : ''}
              </div>
            \`).join('')}</div>
          </div>
          <div class="glass rounded-xl p-5">
            <h3 class="font-semibold text-sm mb-3"><i class="fas fa-store text-accent-400 mr-2"></i>Exhibitors by Category</h3>
            <div class="chart-container"><canvas id="chart-exhibitor-cats"></canvas></div>
          </div>
        </div>
      \`;

      setTimeout(() => {
        const colors5 = ['#748ffc','#ff9800','#a78bfa','#22c55e','#f472b6','#14b8a6','#fbbf24'];
        renderChart('chart-badges','doughnut', analytics.attendeesByBadge.map(r=>r.badge_type), analytics.attendeesByBadge.map(r=>r.count), colors5);
        renderChart('chart-session-types','doughnut', analytics.sessionsByType.map(r=>r.session_type), analytics.sessionsByType.map(r=>r.count), colors5);
        renderChart('chart-connections','doughnut', analytics.connectionsByStatus.map(r=>r.status), analytics.connectionsByStatus.map(r=>r.count), ['#22c55e','#fbbf24','#ef4444']);
        renderChart('chart-meetings','doughnut', analytics.meetingsByStatus.map(r=>r.status), analytics.meetingsByStatus.map(r=>r.count), ['#22c55e','#fbbf24','#ef4444','#64748b']);
        renderChart('chart-exhibitor-cats','bar', analytics.exhibitorsByCategory.map(r=>r.category), analytics.exhibitorsByCategory.map(r=>r.count), ['#748ffc']);
      }, 100);
    }

    // ============ SETTINGS ============
    async function loadSettings() {
      const settings = await api.get('/api/admin/settings');
      const el = document.getElementById('section-settings');
      el.innerHTML = \`
        <div class="max-w-3xl mx-auto space-y-6">

          <!-- Email Configuration -->
          <div class="glass rounded-2xl p-6">
            <div class="flex items-center gap-3 mb-5">
              <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
                <i class="fas fa-envelope text-white"></i>
              </div>
              <div>
                <h3 class="font-bold text-lg">Email Configuration</h3>
                <p class="text-xs text-gray-400">Configure Elastic Email for sending notification emails</p>
              </div>
            </div>

            <form id="settings-email-form" class="space-y-4">
              <div>
                <label class="block text-xs font-medium text-gray-400 mb-1.5">Elastic Email API Key <span class="text-red-400">*</span></label>
                <div class="relative">
                  <i class="fas fa-key absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"></i>
                  <input type="password" id="set-elastic-key" value="\${settings.elastic_email_api_key || ''}" 
                    placeholder="Enter your Elastic Email API key" 
                    class="w-full pl-10 pr-12 py-2.5 rounded-xl text-sm">
                  <button type="button" onclick="toggleApiKeyVisibility()" class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                    <i id="key-eye-icon" class="fas fa-eye"></i>
                  </button>
                </div>
                <p class="text-xs text-gray-500 mt-1">Get your API key from <a href="https://elasticemail.com/account#/settings/new/create-api" target="_blank" class="text-primary-400 hover:underline">Elastic Email Dashboard</a></p>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label class="block text-xs font-medium text-gray-400 mb-1.5">Sender Email Address <span class="text-red-400">*</span></label>
                  <div class="relative">
                    <i class="fas fa-at absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"></i>
                    <input type="email" id="set-sender-email" value="\${settings.sender_email || 'delegates@bharataiinnovation.com'}" 
                      placeholder="delegates@bharataiinnovation.com" 
                      class="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm">
                  </div>
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-400 mb-1.5">Sender Display Name</label>
                  <div class="relative">
                    <i class="fas fa-user-tag absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"></i>
                    <input type="text" id="set-sender-name" value="\${settings.sender_name || 'Bharat AI Innovation Conference & Exhibition 2026'}" 
                      placeholder="Bharat AI Innovation Conference & Exhibition 2026" 
                      class="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm">
                  </div>
                </div>
              </div>

              <div>
                <label class="block text-xs font-medium text-gray-400 mb-1.5">App URL (for email links)</label>
                <div class="relative">
                  <i class="fas fa-link absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"></i>
                  <input type="url" id="set-app-url" value="\${settings.app_url || 'https://bharataiinnovation.com/app'}" 
                    placeholder="https://networking.bharataiinnovation.com" 
                    class="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm">
                </div>
                <p class="text-xs text-gray-500 mt-1">Production URL used in email links (Download Pass, Open App). Leave default if unsure.</p>
              </div>

              <div class="flex flex-wrap items-center gap-3 pt-2">
                <button type="submit" class="px-6 py-2.5 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-primary-600 to-primary-700 hover:from-primary-500 hover:to-primary-600 transition-all">
                  <i class="fas fa-save mr-2"></i>Save Settings
                </button>
                <button type="button" onclick="verifyApiKey()" class="px-5 py-2.5 rounded-xl font-semibold text-sm border border-green-500/30 text-green-300 hover:bg-green-500/10 transition-all">
                  <i class="fas fa-check-circle mr-2"></i>Verify Key
                </button>
                <button type="button" onclick="testEmailSettings()" class="px-5 py-2.5 rounded-xl font-semibold text-sm border border-white/10 text-gray-300 hover:text-white hover:bg-white/5 transition-all">
                  <i class="fas fa-paper-plane mr-2"></i>Send Test Email
                </button>
              </div>
              <div id="settings-status" class="mt-3 hidden"></div>
            </form>
          </div>

          <!-- Email Status -->
          <div class="glass rounded-2xl p-6">
            <div class="flex items-center gap-3 mb-4">
              <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center">
                <i class="fas fa-info-circle text-white"></i>
              </div>
              <div>
                <h3 class="font-bold text-lg">Email Service Status</h3>
                <p class="text-xs text-gray-400">Current email delivery configuration status</p>
              </div>
            </div>
            <div id="email-status-panel" class="space-y-3"></div>
          </div>

          <!-- How It Works -->
          <div class="glass rounded-2xl p-6">
            <div class="flex items-center gap-3 mb-4">
              <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center">
                <i class="fas fa-question-circle text-white"></i>
              </div>
              <div>
                <h3 class="font-bold text-lg">How Email Notifications Work</h3>
                <p class="text-xs text-gray-400">Step-by-step guide</p>
              </div>
            </div>
            <div class="space-y-3 text-sm text-gray-300">
              <div class="flex gap-3 items-start">
                <span class="w-7 h-7 rounded-full bg-primary-500/20 text-primary-400 flex items-center justify-center text-xs font-bold shrink-0">1</span>
                <p>Sign up at <a href="https://elasticemail.com" target="_blank" class="text-primary-400 hover:underline">elasticemail.com</a> and create an API key with <strong>Send</strong> permissions.</p>
              </div>
              <div class="flex gap-3 items-start">
                <span class="w-7 h-7 rounded-full bg-primary-500/20 text-primary-400 flex items-center justify-center text-xs font-bold shrink-0">2</span>
                <div>
                  <p>Create an API key with <strong class="text-amber-300">Full Access</strong> permissions. Go to: <strong>Settings &rarr; Manage API Keys &rarr; Create</strong>.</p>
                  <p class="text-xs text-gray-500 mt-1">&#9888; Keys with limited permissions (e.g., "View Only") will return "Access Denied".</p>
                </div>
              </div>
              <div class="flex gap-3 items-start">
                <span class="w-7 h-7 rounded-full bg-primary-500/20 text-primary-400 flex items-center justify-center text-xs font-bold shrink-0">3</span>
                <p>Verify your sender email (<strong>delegates@bharataiinnovation.com</strong>) in <strong>Settings &rarr; Email Verification</strong>. You must click the verification link sent to that email.</p>
              </div>
              <div class="flex gap-3 items-start">
                <span class="w-7 h-7 rounded-full bg-primary-500/20 text-primary-400 flex items-center justify-center text-xs font-bold shrink-0">4</span>
                <p>Paste the API key above, click <strong>"Verify Key"</strong> to confirm it works, then <strong>"Save Settings"</strong>.</p>
              </div>
              <div class="flex gap-3 items-start">
                <span class="w-7 h-7 rounded-full bg-primary-500/20 text-primary-400 flex items-center justify-center text-xs font-bold shrink-0">5</span>
                <p>Use <strong>"Send Test Email"</strong> to verify end-to-end delivery before notifying attendees.</p>
              </div>
            </div>
          </div>

        </div>
      \`;

      // Populate status panel (avoid triple-nested backticks)
      const statusPanel = document.getElementById('email-status-panel');
      if (settings.elastic_email_api_key) {
        statusPanel.innerHTML = '<div class="flex items-center gap-3 p-3 rounded-xl bg-green-500/10 border border-green-500/20"><i class="fas fa-check-circle text-green-400 text-lg"></i><div><p class="text-sm font-medium text-green-300">Elastic Email API Configured</p><p class="text-xs text-gray-400">Emails will be sent automatically via Elastic Email from <strong>' + (settings.sender_email || 'delegates@bharataiinnovation.com') + '</strong></p></div></div>';
      } else {
        statusPanel.innerHTML = '<div class="flex items-center gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20"><i class="fas fa-exclamation-triangle text-amber-400 text-lg"></i><div><p class="text-sm font-medium text-amber-300">No Email Service Configured</p><p class="text-xs text-gray-400">Clicking "Notify" will open your default email client (mailto) with a pre-filled email. Configure Elastic Email above for automatic sending.</p></div></div>';
      }

      // Attach form handler
      document.getElementById('settings-email-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        const origHTML = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...';
        btn.disabled = true;
        try {
          await api.put('/api/admin/settings', {
            elastic_email_api_key: document.getElementById('set-elastic-key').value.trim(),
            sender_email: document.getElementById('set-sender-email').value.trim(),
            sender_name: document.getElementById('set-sender-name').value.trim(),
            app_url: document.getElementById('set-app-url').value.trim()
          });
          toast('Email settings saved successfully!');
          loadSettings(); // Refresh to update status panel
        } catch (e) {
          toast('Failed to save settings', true);
        } finally {
          btn.innerHTML = origHTML;
          btn.disabled = false;
        }
      });
    }

    function toggleApiKeyVisibility() {
      const inp = document.getElementById('set-elastic-key');
      const icon = document.getElementById('key-eye-icon');
      if (inp.type === 'password') {
        inp.type = 'text';
        icon.classList.replace('fa-eye', 'fa-eye-slash');
      } else {
        inp.type = 'password';
        icon.classList.replace('fa-eye-slash', 'fa-eye');
      }
    }

    function showSettingsStatus(msg, isError) {
      const el = document.getElementById('settings-status');
      el.classList.remove('hidden');
      if (isError) {
        el.innerHTML = '<div class="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20"><i class="fas fa-times-circle text-red-400 mt-0.5"></i><div class="text-sm text-red-300">' + msg + '</div></div>';
      } else {
        el.innerHTML = '<div class="flex items-start gap-2 p-3 rounded-xl bg-green-500/10 border border-green-500/20"><i class="fas fa-check-circle text-green-400 mt-0.5"></i><div class="text-sm text-green-300">' + msg + '</div></div>';
      }
    }

    async function verifyApiKey() {
      const apiKey = document.getElementById('set-elastic-key').value.trim();
      if (!apiKey) {
        showSettingsStatus('Please enter an API key first.', true);
        return;
      }
      showSettingsStatus('<i class="fas fa-spinner fa-spin mr-1"></i> Verifying API key...', false);
      try {
        const result = await api.post('/api/admin/settings/verify-key', { api_key: apiKey });
        showSettingsStatus('API key is valid! You can save and start sending emails.', false);
      } catch(e) {
        const hint = e.data && e.data.hint ? '<br><span class="text-xs text-gray-400 mt-1 block">' + e.data.hint + '</span>' : '';
        showSettingsStatus('API key verification failed: ' + (e.data ? e.data.error : e.message) + hint, true);
      }
    }

    async function testEmailSettings() {
      const apiKey = document.getElementById('set-elastic-key').value.trim();
      const senderEmail = document.getElementById('set-sender-email').value.trim();
      const senderName = document.getElementById('set-sender-name').value.trim();

      if (!apiKey) {
        showSettingsStatus('Please enter an Elastic Email API key first.', true);
        return;
      }
      if (!senderEmail) {
        showSettingsStatus('Please enter a sender email address.', true);
        return;
      }

      // First save settings
      try {
        await api.put('/api/admin/settings', {
          elastic_email_api_key: apiKey,
          sender_email: senderEmail,
          sender_name: senderName,
          app_url: document.getElementById('set-app-url')?.value?.trim() || 'https://bharataiinnovation.com/app'
        });
      } catch(e) {
        showSettingsStatus('Failed to save settings: ' + e.message, true);
        return;
      }

      // Prompt for test email recipient
      const testTo = prompt('Send a test email to:', senderEmail);
      if (!testTo) return;

      showSettingsStatus('<i class="fas fa-spinner fa-spin mr-1"></i> Sending test email to ' + testTo + '...', false);
      try {
        const result = await api.post('/api/admin/settings/test-email', { test_email: testTo });
        showSettingsStatus('Test email sent successfully to <strong>' + testTo + '</strong>! Check your inbox (and spam folder).', false);
        toast('Test email sent to ' + testTo + '!');
      } catch (e) {
        const msg = e.data ? (e.data.error || 'Unknown error') : e.message;
        showSettingsStatus('Failed to send test email: ' + msg, true);
        toast('Failed: ' + msg, true);
      }
    }
  </script>
</body>
</html>`
}

export default app
