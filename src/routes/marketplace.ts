import { Hono } from 'hono'

type Bindings = { DB: D1Database }
const mp = new Hono<{ Bindings: Bindings }>()

// ── Helpers ──
const generateSlug = (text: string) =>
  (text || '').toLowerCase().trim()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)

const hashPassword = async (password: string) => {
  const encoder = new TextEncoder()
  const data = encoder.encode(password)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
}

const getCookie = (c: any, name: string) => {
  const header = c.req.header('Cookie') || ''
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

const getCompanyFromSession = async (c: any) => {
  const sessionId = getCookie(c, 'mp_session')
  if (!sessionId) return null
  const company = await c.env.DB.prepare('SELECT id, company_name, email, role, exhibitor_id, attendee_id FROM mp_companies WHERE id = ?').bind(parseInt(sessionId)).first()
  return company || null
}

// ══════════════════════════════════════════
// AUTH ROUTES
// ══════════════════════════════════════════

mp.post('/api/mp/auth/register', async (c) => {
  const { company_name, email, password } = await c.req.json()
  if (!company_name || !email || !password) return c.json({ error: 'All fields required' }, 400)
  if (password.length < 6) return c.json({ error: 'Password must be at least 6 characters' }, 400)

  const existing = await c.env.DB.prepare('SELECT id FROM mp_companies WHERE email = ?').bind(email).first()
  if (existing) return c.json({ error: 'Email already registered' }, 400)

  const password_hash = await hashPassword(password)
  const result = await c.env.DB.prepare(
    'INSERT INTO mp_companies (company_name, email, password_hash) VALUES (?, ?, ?)'
  ).bind(company_name, email, password_hash).run()

  return c.json({ success: true, id: result.meta.last_row_id })
})

mp.post('/api/mp/auth/login', async (c) => {
  const { email, password } = await c.req.json()
  if (!email || !password) return c.json({ error: 'Email and password required' }, 400)

  const password_hash = await hashPassword(password)
  const company = await c.env.DB.prepare(
    'SELECT id, company_name, email, role FROM mp_companies WHERE email = ? AND password_hash = ?'
  ).bind(email, password_hash).first()

  if (!company) return c.json({ error: 'Invalid email or password' }, 401)

  // Set simple cookie session
  c.header('Set-Cookie', `mp_session=${company.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`)
  return c.json({ success: true, user: company })
})

mp.get('/api/mp/auth/me', async (c) => {
  const company = await getCompanyFromSession(c)
  return c.json({ user: company })
})

mp.post('/api/mp/auth/logout', async (c) => {
  c.header('Set-Cookie', 'mp_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0')
  return c.json({ success: true })
})

// ── Login as exhibitor (cross-link from networking app) ──
mp.post('/api/mp/auth/exhibitor-login', async (c) => {
  const { attendee_id, exhibitor_id, company_name, email } = await c.req.json()
  if (!attendee_id || !company_name) return c.json({ error: 'Missing required fields' }, 400)

  // Check if already linked
  let company = await c.env.DB.prepare(
    'SELECT id, company_name, email, role FROM mp_companies WHERE attendee_id = ?'
  ).bind(attendee_id).first()

  if (!company) {
    // Auto-create marketplace account from exhibitor data
    const password_hash = await hashPassword('exhibitor_' + attendee_id)
    const emailToUse = email || `exhibitor_${attendee_id}@bharataiinnovation.com`
    
    // Check if email already exists
    const existing = await c.env.DB.prepare('SELECT id FROM mp_companies WHERE email = ?').bind(emailToUse).first()
    if (existing) {
      // Link existing account
      await c.env.DB.prepare('UPDATE mp_companies SET attendee_id = ?, exhibitor_id = ? WHERE id = ?')
        .bind(attendee_id, exhibitor_id || null, existing.id).run()
      company = await c.env.DB.prepare('SELECT id, company_name, email, role FROM mp_companies WHERE id = ?')
        .bind(existing.id).first()
    } else {
      const result = await c.env.DB.prepare(
        'INSERT INTO mp_companies (company_name, email, password_hash, attendee_id, exhibitor_id) VALUES (?, ?, ?, ?, ?)'
      ).bind(company_name, emailToUse, password_hash, attendee_id, exhibitor_id || null).run()
      company = { id: result.meta.last_row_id, company_name, email: emailToUse, role: 'company' }
    }
  }

  c.header('Set-Cookie', `mp_session=${(company as any).id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`)
  return c.json({ success: true, user: company })
})

// ══════════════════════════════════════════
// LISTINGS (PUBLIC)
// ══════════════════════════════════════════

mp.get('/api/mp/listings', async (c) => {
  const status = c.req.query('status') || 'approved'
  const listings = await c.env.DB.prepare(
    'SELECT l.*, e.company_name as exhibitor_company, e.booth_number as exhibitor_booth FROM mp_listings l LEFT JOIN exhibitors e ON l.exhibitor_id = e.id WHERE l.status = ? ORDER BY l.created_at DESC'
  ).bind(status).all()
  return c.json({ listings: listings.results })
})

mp.get('/api/mp/listings/by-slug/:companySlug/:productSlug', async (c) => {
  const companySlug = c.req.param('companySlug')
  const productSlug = c.req.param('productSlug')
  const listing = await c.env.DB.prepare(
    'SELECT * FROM mp_listings WHERE company_slug = ? AND product_slug = ? AND status = ?'
  ).bind(companySlug, productSlug, 'approved').first()
  if (!listing) return c.json({ error: 'Listing not found' }, 404)
  // Increment view count
  await c.env.DB.prepare('UPDATE mp_listings SET view_count = view_count + 1 WHERE id = ?').bind(listing.id).run()
  return c.json({ listing })
})

mp.get('/api/mp/listings/:id', async (c) => {
  const id = c.req.param('id')
  const listing = await c.env.DB.prepare('SELECT * FROM mp_listings WHERE id = ?').bind(parseInt(id)).first()
  if (!listing) return c.json({ error: 'Listing not found' }, 404)
  await c.env.DB.prepare('UPDATE mp_listings SET view_count = view_count + 1 WHERE id = ?').bind(listing.id).run()
  return c.json({ listing })
})

// ── Submit new listing ──
mp.post('/api/mp/listings', async (c) => {
  const company = await getCompanyFromSession(c)
  if (!company) return c.json({ error: 'Login required' }, 401)

  const body = await c.req.json()
  const { product_name, description } = body
  if (!product_name || !description) return c.json({ error: 'Product name and description are required' }, 400)

  const company_slug = generateSlug(company.company_name)
  const product_slug = generateSlug(product_name)

  // Check if exhibitor to cross-link
  let exhibitor_id = null
  let booth_number = null
  if (company.exhibitor_id) {
    const exhibitor = await c.env.DB.prepare('SELECT id, booth_number FROM exhibitors WHERE id = ?')
      .bind(company.exhibitor_id).first()
    if (exhibitor) {
      exhibitor_id = exhibitor.id
      booth_number = (exhibitor as any).booth_number
    }
  }

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
    company.id, company.company_name, company_slug, product_name, product_slug,
    description, body.target_customer || '', body.target_industry || '', body.target_functional_area || '',
    body.ai_category || '', body.ai_category_custom || '', body.tags || '', body.innovation || '', body.use_cases || '',
    body.pricing_type || '', body.pricing_details || '', body.product_image_url || '', body.logo_url || '', body.screenshot_urls || '',
    body.website_url || '', body.product_url || '', body.demo_url || '', body.video_url || '',
    body.founder_name || '', body.cto_name || '', body.contact_name || '', body.company_registration || '', body.company_phone || '', body.company_address || '',
    body.sales_contact_name || '', body.sales_contact_email || '', body.sales_contact_phone || '',
    body.current_customers || '', body.integration_requirements || '', body.supported_platforms || '',
    body.tech_stack || '', body.security_protocols || '', body.case_studies || '', body.certifications_compliance || '',
    body.access_info || '', body.support_offering || '', body.sla_details || '', body.onboarding_process || '',
    exhibitor_id, booth_number, 'pending'
  ).run()

  return c.json({ success: true, id: result.meta.last_row_id })
})

// ── Reviews ──
mp.get('/api/mp/listings/:id/reviews', async (c) => {
  const listingId = c.req.param('id')
  const reviews = await c.env.DB.prepare(
    'SELECT * FROM mp_reviews WHERE listing_id = ? ORDER BY created_at DESC'
  ).bind(parseInt(listingId)).all()
  return c.json({ reviews: reviews.results })
})

mp.post('/api/mp/listings/:id/reviews', async (c) => {
  const company = await getCompanyFromSession(c)
  if (!company) return c.json({ error: 'Login required' }, 401)

  const listingId = c.req.param('id')
  const { rating, comment } = await c.req.json()
  if (!rating || rating < 1 || rating > 5) return c.json({ error: 'Rating must be 1-5' }, 400)

  await c.env.DB.prepare(
    'INSERT INTO mp_reviews (listing_id, company_id, company_name, rating, comment) VALUES (?, ?, ?, ?, ?)'
  ).bind(parseInt(listingId), company.id, company.company_name, rating, comment || '').run()

  return c.json({ success: true })
})

// ── Marketplace inquiries ──
mp.post('/api/mp/inquiries', async (c) => {
  const body = await c.req.json()
  const { listing_id, inquirer_name, inquirer_email } = body
  if (!listing_id || !inquirer_name || !inquirer_email) return c.json({ error: 'Name, email, and listing are required' }, 400)

  await c.env.DB.prepare(
    'INSERT INTO mp_inquiries (listing_id, inquirer_name, inquirer_email, inquirer_company, inquirer_phone, inquirer_message) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(listing_id, inquirer_name, inquirer_email, body.inquirer_company || '', body.inquirer_phone || '', body.inquirer_message || '').run()

  return c.json({ success: true })
})

// ── File uploads (base64 in D1) ──
mp.post('/api/mp/uploads', async (c) => {
  const company = await getCompanyFromSession(c)
  if (!company) return c.json({ error: 'Login required' }, 401)

  const formData = await c.req.formData()
  const file = formData.get('file') as File
  if (!file) return c.json({ error: 'No file provided' }, 400)
  if (file.size > 5 * 1024 * 1024) return c.json({ error: 'File too large (max 5MB)' }, 400)

  const buffer = await file.arrayBuffer()
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
  const dataUrl = `data:${file.type};base64,${base64}`

  const result = await c.env.DB.prepare(
    'INSERT INTO mp_uploads (company_id, filename, content_type, size, data) VALUES (?, ?, ?, ?, ?)'
  ).bind(company.id, file.name, file.type, file.size, dataUrl).run()

  return c.json({ success: true, url: `/api/mp/uploads/${result.meta.last_row_id}`, id: result.meta.last_row_id })
})

mp.get('/api/mp/uploads/:id', async (c) => {
  const id = c.req.param('id')
  const upload = await c.env.DB.prepare('SELECT data, content_type FROM mp_uploads WHERE id = ?').bind(parseInt(id)).first()
  if (!upload) return c.json({ error: 'File not found' }, 404)

  const dataUrl = upload.data as string
  if (dataUrl.startsWith('data:')) {
    const base64Data = dataUrl.split(',')[1]
    const binaryString = atob(base64Data)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    return new Response(bytes, {
      headers: { 'Content-Type': (upload.content_type as string) || 'application/octet-stream', 'Cache-Control': 'public, max-age=86400' }
    })
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

  return c.json({ listings: listings.results })
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

mp.put('/api/mp/dashboard/listings/:id', async (c) => {
  const company = await getCompanyFromSession(c)
  if (!company) return c.json({ error: 'Login required' }, 401)

  const id = c.req.param('id')
  const listing = await c.env.DB.prepare('SELECT * FROM mp_listings WHERE id = ? AND company_id = ?')
    .bind(parseInt(id), company.id).first()
  if (!listing) return c.json({ error: 'Listing not found' }, 404)

  const body = await c.req.json()
  const fields = ['product_name', 'description', 'target_customer', 'pricing_type', 'pricing_details',
    'tags', 'target_industry', 'ai_category', 'website_url', 'product_url',
    'sales_contact_name', 'sales_contact_email']

  const updates: string[] = []
  const values: any[] = []
  for (const field of fields) {
    if (body[field] !== undefined) {
      updates.push(`${field} = ?`)
      values.push(body[field])
    }
  }

  if (body.product_name) {
    updates.push('product_slug = ?')
    values.push(generateSlug(body.product_name))
  }

  // Re-submit for review if content changed
  const contentFields = ['product_name', 'description', 'target_customer']
  const contentChanged = contentFields.some(f => body[f] !== undefined && body[f] !== (listing as any)[f])
  let newStatus = (listing as any).status
  if (contentChanged && (listing as any).status === 'approved') {
    updates.push('status = ?')
    values.push('pending')
    newStatus = 'pending'
  }

  updates.push('updated_at = CURRENT_TIMESTAMP')
  values.push(parseInt(id))

  await c.env.DB.prepare(`UPDATE mp_listings SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run()
  return c.json({ success: true, new_status: newStatus })
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

  const profile = await c.env.DB.prepare('SELECT * FROM mp_companies WHERE id = ?').bind(company.id).first()
  return c.json({ profile })
})

mp.put('/api/mp/dashboard/profile', async (c) => {
  const company = await getCompanyFromSession(c)
  if (!company) return c.json({ error: 'Login required' }, 401)

  const { company_name } = await c.req.json()
  if (!company_name) return c.json({ error: 'Company name required' }, 400)

  await c.env.DB.prepare('UPDATE mp_companies SET company_name = ? WHERE id = ?').bind(company_name, company.id).run()
  // Update all listings too
  await c.env.DB.prepare('UPDATE mp_listings SET company_name = ?, company_slug = ? WHERE company_id = ?')
    .bind(company_name, generateSlug(company_name), company.id).run()

  return c.json({ success: true })
})

// ══════════════════════════════════════════
// ADMIN ROUTES
// ══════════════════════════════════════════

mp.get('/api/mp/admin/listings', async (c) => {
  const company = await getCompanyFromSession(c)
  if (!company || company.role !== 'admin') return c.json({ error: 'Admin required' }, 403)

  const status = c.req.query('status')
  let query = 'SELECT * FROM mp_listings'
  const params: any[] = []
  if (status) {
    query += ' WHERE status = ?'
    params.push(status)
  }
  query += ' ORDER BY created_at DESC'

  const listings = await c.env.DB.prepare(query).bind(...params).all()
  return c.json({ listings: listings.results })
})

mp.patch('/api/mp/admin/listings/:id', async (c) => {
  const company = await getCompanyFromSession(c)
  if (!company || company.role !== 'admin') return c.json({ error: 'Admin required' }, 403)

  const id = c.req.param('id')
  const { status } = await c.req.json()
  if (!['approved', 'rejected', 'pending'].includes(status)) return c.json({ error: 'Invalid status' }, 400)

  await c.env.DB.prepare('UPDATE mp_listings SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(status, parseInt(id)).run()

  return c.json({ success: true })
})

mp.get('/api/mp/admin/inquiries', async (c) => {
  const company = await getCompanyFromSession(c)
  if (!company || company.role !== 'admin') return c.json({ error: 'Admin required' }, 403)

  const inquiries = await c.env.DB.prepare(`
    SELECT i.*, l.product_name, l.company_name FROM mp_inquiries i
    JOIN mp_listings l ON i.listing_id = l.id ORDER BY i.created_at DESC
  `).all()

  return c.json({ inquiries: inquiries.results })
})

mp.delete('/api/mp/admin/inquiries/:id', async (c) => {
  const company = await getCompanyFromSession(c)
  if (!company || company.role !== 'admin') return c.json({ error: 'Admin required' }, 403)

  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM mp_inquiries WHERE id = ?').bind(parseInt(id)).run()
  return c.json({ success: true })
})

mp.get('/api/mp/admin/stats', async (c) => {
  const company = await getCompanyFromSession(c)
  if (!company || company.role !== 'admin') return c.json({ error: 'Admin required' }, 403)

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
  const company = await getCompanyFromSession(c)
  if (!company || company.role !== 'admin') return c.json({ error: 'Admin required' }, 403)

  const { listings } = await c.req.json()
  if (!Array.isArray(listings) || !listings.length) return c.json({ error: 'No listings provided' }, 400)

  let success = 0
  let failed = 0

  for (const item of listings) {
    try {
      if (!item.product_name || !item.description || !item.company_name) {
        failed++
        continue
      }
      const company_slug = generateSlug(item.company_name)
      const product_slug = generateSlug(item.product_name)

      await c.env.DB.prepare(`
        INSERT INTO mp_listings (
          company_id, company_name, company_slug, product_name, product_slug,
          description, target_customer, target_industry, ai_category, tags,
          pricing_type, pricing_details, website_url, product_url, 
          sales_contact_name, sales_contact_email, sales_contact_phone,
          founder_name, innovation, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        company.id, item.company_name, company_slug, item.product_name, product_slug,
        item.description, item.target_customer || '', item.target_industry || '', item.ai_category || '', item.tags || '',
        item.pricing_type || '', item.pricing_details || '', item.website_url || '', item.product_url || '',
        item.sales_contact_name || '', item.sales_contact_email || '', item.sales_contact_phone || '',
        item.founder_name || '', item.innovation || '', 'approved'
      ).run()
      success++
    } catch {
      failed++
    }
  }

  return c.json({ success: true, uploaded: success, failed })
})

export default mp
