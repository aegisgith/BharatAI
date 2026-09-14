// Escapes text before it goes into innerHTML. Inquiry and listing fields are
// attacker-controlled — the inquiry form needs no login at all — and were being
// interpolated raw, so a payload in a name or message ran as script in the
// vendor dashboard and the admin queue.
const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Only our own upload URLs and http(s) links may reach a src or href. Escaping
// alone does not stop a javascript: URL.
const safeUrl = (v) => {
  const s = String(v == null ? '' : v).trim()
  if (/^\/api\/mp\/uploads\/\d+$/.test(s)) return s
  try { const u = new URL(s); return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : '' } catch { return '' }
}

// Bharat AI Marketplace — Main App JS
const state = { user: null, listings: [] }
const toast = document.getElementById('toast')

const MASTER_INDUSTRIES = [
  'Industry Agnostic','Aerospace','Agriculture','Airline','Automotive','Banking',
  'Biotech','Chemicals','Construction','Consumer Goods','Cybersecurity','Defense',
  'Education','Energy','Entertainment','Financial Services','Food & Beverage',
  'Government','Healthcare','Hospitality','Insurance','Legal','Logistics',
  'Manufacturing','Media & Publishing','Mining','Non-Profit','Pharma',
  'Real Estate','Retail','Telecom','Transportation','Travel & Tourism','Utilities','Other'
]

const MASTER_AI_CATEGORIES = [
  'Sales Automation','Lead Generation Automation','CRM Automation',
  'Proposal / RFP Automation','Revenue Intelligence','Sales Forecasting','Inside Sales AI',
  'Social Media Automation','Content Generation','Performance Marketing Optimization',
  'SEO / SEM Automation','Personalization Engines','Campaign Automation','Brand Monitoring',
  'Customer Support Automation','AI Chatbots','Sentiment Analysis',
  'Customer Journey Analytics','Self-Service Portals',
  'Invoice Processing','Expense Management','Fraud Detection',
  'Financial Forecasting','Tax Automation','Audit Automation',
  'Recruitment Automation','Resume Screening','Employee Engagement',
  'Workforce Planning','Learning & Development AI','Compensation Intelligence',
  'Contract Analysis','Regulatory Monitoring','Legal Document Automation',
  'E-Discovery','Risk & Compliance Management',
  'Workflow Automation','Inventory Optimization','Procurement AI',
  'Demand Forecasting','Quality Control AI','Logistics / Route Optimization',
  'Code Generation / SDLC','DevOps Automation','Cybersecurity AI',
  'IT Service Management','Test Automation','Infrastructure Monitoring',
  'Product Analytics','Market Intelligence','Competitive Analysis',
  'Innovation Management','R&D Automation',
  'AI Agents','Agentic Automation','Generative AI','LLM-powered','Multimodal AI',
  'Computer Vision','Speech / Voice AI','Robotics','Edge AI','RAG','MLOps',
  'Model Training / Hosting','AI Safety / Guardrails','Observability / Monitoring'
]

const showToast = (msg, isError = false) => {
  toast.textContent = msg; toast.classList.remove('hidden')
  toast.classList.toggle('border-rose-500', isError); toast.classList.toggle('border-slate-700', !isError)
  clearTimeout(showToast.t); showToast.t = setTimeout(() => toast.classList.add('hidden'), isError ? 6000 : 3500)
}
const getInitials = (name = '') => name.split(' ').filter(Boolean).slice(0,2).map(p => p[0]).join('').toUpperCase()
const toSlug = (text) => (text||'').toLowerCase().trim().replace(/&/g,'and').replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,80)
const listingUrl = (l) => { const cs = l.company_slug || toSlug(l.company_name), ps = l.product_slug || toSlug(l.product_name); return (cs && ps) ? `/marketplace/listing/${encodeURIComponent(cs)}/${encodeURIComponent(ps)}` : `/marketplace/listing/${encodeURIComponent(l.id)}` }
const toTagList = (v) => (v||'').split(',').map(i => i.trim()).filter(Boolean)
const formatFileSize = (b) => { if (b < 1024) return b + ' B'; if (b < 1048576) return (b/1024).toFixed(1) + ' KB'; return (b/1048576).toFixed(1) + ' MB' }

const api = async (path, opts = {}) => {
  const r = await fetch(path, { headers: {'Content-Type':'application/json'}, credentials:'same-origin', ...opts })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || 'Request failed')
  return d
}

const authSection = document.getElementById('auth-section')
const listingFormSection = document.getElementById('listing-form-section')
const adminSection = document.getElementById('admin-section')
const listingsContainer = document.getElementById('listings-container')
const adminListingsContainer = document.getElementById('admin-listings')
const companyNameField = document.getElementById('company-name')
const filterTagsContainer = document.getElementById('filter-tags')
const filterIndustriesContainer = document.getElementById('filter-industries')
const filterCategoriesContainer = document.getElementById('filter-categories')

const filters = { tag: null, industry: null, category: null }

const loginButton = document.getElementById('login-button')
const logoutButton = document.getElementById('logout-button')
const dashboardLink = document.getElementById('dashboard-link')
const openListingButton = document.getElementById('open-listing-button')
const refreshButton = document.getElementById('refresh-button')
const viewButtons = document.querySelectorAll('[data-view]')

// Set when someone asked to list a product before signing in, so signing in
// brings them back to the form instead of dropping them on the dashboard.
let wantsToSubmit = new URLSearchParams(window.location.search).get('submit') === 'true'

const updateAuthUI = () => {
  if (state.user) {
    loginButton.classList.add('hidden'); logoutButton.classList.remove('hidden')
    if (dashboardLink) {
      dashboardLink.classList.remove('hidden')
      dashboardLink.href = state.user.role === 'admin' ? '/marketplace/admin' : '/marketplace/dashboard'
    }
    listingFormSection.classList.remove('hidden'); authSection.classList.add('hidden')
    if (companyNameField) companyNameField.value = state.user.company_name || ''
    adminSection.classList.toggle('hidden', state.user.role !== 'admin')
  } else {
    loginButton.classList.remove('hidden'); logoutButton.classList.add('hidden')
    if (dashboardLink) dashboardLink.classList.add('hidden')
    listingFormSection.classList.add('hidden'); adminSection.classList.add('hidden')
    if (companyNameField) companyNameField.value = ''
  }
}

const showListingForm = () => {
  listingFormSection.classList.remove('hidden')
  setTimeout(() => listingFormSection.scrollIntoView({ behavior:'smooth' }), 150)
}

const setListingView = (view) => {
  const sel = view === 'list' ? 'list' : 'grid'
  listingsContainer.classList.toggle('listing-list', sel === 'list')
  listingsContainer.classList.toggle('listing-grid', sel === 'grid')
  viewButtons.forEach(b => b.classList.toggle('view-active', b.getAttribute('data-view') === sel))
  try { localStorage.setItem('mpListingView', sel) } catch {}
}

const loadMe = async () => { try { const d = await api('/api/mp/auth/me'); state.user = d.user; updateAuthUI() } catch {} }

const FILTER_COLLAPSE_LIMIT = 12
const renderFilterGroup = (container, options, activeValue, onSelect) => {
  if (!container) return
  const all = ['All', ...options]
  const needsCollapse = all.length > FILTER_COLLAPSE_LIMIT + 1
  const activeIdx = activeValue ? all.indexOf(activeValue) : -1
  const startExpanded = activeIdx >= FILTER_COLLAPSE_LIMIT + 1
  container.innerHTML = ''
  const wrap = document.createElement('div'); wrap.className = 'filter-chip-wrap'
  all.forEach((label, idx) => {
    const value = label === 'All' ? null : label
    const btn = document.createElement('button')
    btn.className = `filter-chip ${value === activeValue ? 'filter-active' : ''}`
    btn.textContent = label
    if (needsCollapse && idx > FILTER_COLLAPSE_LIMIT && !startExpanded) btn.classList.add('filter-chip-hidden')
    btn.addEventListener('click', () => onSelect(value))
    wrap.appendChild(btn)
  })
  container.appendChild(wrap)
  if (needsCollapse) {
    const toggle = document.createElement('button'); toggle.className = 'filter-toggle-btn'
    const hc = all.length - FILTER_COLLAPSE_LIMIT - 1
    toggle.innerHTML = startExpanded ? '<i class="fa-solid fa-chevron-up"></i> Show fewer' : `<i class="fa-solid fa-chevron-down"></i> +${hc} more`
    let exp = startExpanded
    toggle.addEventListener('click', () => {
      exp = !exp
      if (exp) { wrap.querySelectorAll('.filter-chip-hidden').forEach(c => c.classList.remove('filter-chip-hidden')); toggle.innerHTML = '<i class="fa-solid fa-chevron-up"></i> Show fewer' }
      else { Array.from(wrap.children).forEach((c, i) => { if (i > FILTER_COLLAPSE_LIMIT) c.classList.add('filter-chip-hidden') }); toggle.innerHTML = `<i class="fa-solid fa-chevron-down"></i> +${hc} more` }
    })
    container.appendChild(toggle)
  }
}

const buildFilters = (listings) => {
  const tags = new Set(); listings.forEach(l => toTagList(l.tags).forEach(t => tags.add(t)))
  renderFilterGroup(filterTagsContainer, Array.from(tags).sort(), filters.tag, v => { filters.tag = v; renderListings() })
  renderFilterGroup(filterIndustriesContainer, MASTER_INDUSTRIES, filters.industry, v => { filters.industry = v; renderListings() })
  renderFilterGroup(filterCategoriesContainer, MASTER_AI_CATEGORIES, filters.category, v => { filters.category = v; renderListings() })
}

const applyFilters = (listings) => listings.filter(l => {
  const il = toTagList(l.target_industry), cl = toTagList(l.ai_category), tl = toTagList(l.tags)
  return (!filters.industry || il.includes(filters.industry)) && (!filters.category || cl.includes(filters.category)) && (!filters.tag || tl.includes(filters.tag))
})

const createListingCard = (listing) => {
  const card = document.createElement('div'); card.className = 'listing-card'
  const cats = toTagList(listing.ai_category), tags = toTagList(listing.tags)
  const logo = safeUrl(listing.logo_url), image = safeUrl(listing.product_image_url)
  const logoMk = logo ? `<img src="${esc(logo)}" alt="">` : esc(getInitials(listing.product_name))
  const tagMk = items => items.length ? items.slice(0,3).map(i => `<span class="tag">${esc(i)}</span>`).join('') : '<span class="tag tag-muted">—</span>'
  const imgMk = image ? `<div class="listing-product-img"><img src="${esc(image)}" alt="" loading="lazy"></div>` : ''
  const booth = listing.exhibitor_booth || listing.booth_number
  const boothBadge = booth ? `<span class="listing-booth-badge"><i class="fas fa-map-marker-alt"></i> Booth ${esc(booth)}</span>` : ''
  // No rating exists until one is given; "— Rating" on every card read as broken.
  const rating = Number(listing.awards_rating) > 0 ? `<div class="rating-row"><i class="fa-solid fa-star"></i><span>${esc(listing.awards_rating)} Rating</span></div><span class="meta-dot">·</span>` : ''

  card.innerHTML = `${imgMk}
    <div class="listing-compact">
      <div class="listing-logo">${logoMk}</div>
      <div class="listing-compact-body">
        <p class="listing-company">${esc(listing.company_name)} ${boothBadge}</p>
        <h4 class="listing-title">${esc(listing.product_name)}</h4>
        <p class="listing-desc">${esc(listing.description)}</p>
        <div class="listing-meta">${rating}<span>${esc(listing.pricing_type || 'Pricing on request')}</span></div>
        <div class="listing-section"><p class="section-label">AI Categories</p><div class="tag-row">${tagMk(cats)}</div></div>
        <div class="listing-section"><p class="section-label">Tags</p><div class="tag-row">${tagMk(tags)}</div></div>
        <div class="listing-cta"><a class="learn-more" href="${esc(listingUrl(listing))}">Learn more</a></div>
      </div>
    </div>`
  return card
}

const createHeroCard = () => {
  const card = document.createElement('div'); card.className = 'listing-card listing-hero'
  card.innerHTML = `<div class="hero-content"><p class="hero-kicker">AI Agents</p><h4>Explore AI Solutions</h4><p>Discover AI solutions that automate workflows, make decisions, and support teams across industries.</p><button class="hero-button" onclick="document.getElementById('filter-categories').scrollIntoView({behavior:'smooth'})">Explore categories</button></div>`
  return card
}

const renderListings = () => {
  // The marketplace is empty until listings are approved. It used to fall back to
  // five invented companies behind a small "Showing sample listings." note -
  // fabricated products, pricing and sales contacts a visitor could click straight
  // into, indistinguishable from the real thing. Say the truth instead.
  if (!state.listings.length) {
    buildFilters([])
    listingsContainer.innerHTML = '<div class="mp-empty-state"><i class="fa-solid fa-store"></i><h4>No listings published yet</h4><p>Approved AI products appear here as exhibitors submit them. Be one of the first &mdash; submitting is free and takes a few minutes.</p><button type="button" class="mp-hero-btn mp-hero-btn--primary" id="mp-empty-submit">Submit your product</button></div>'
    const b = document.getElementById('mp-empty-submit')
    // Reuse the real button so the login-required guard is not duplicated here.
    if (b) b.addEventListener('click', () => openListingButton.click())
    return
  }
  buildFilters(state.listings)
  const filtered = applyFilters(state.listings)
  listingsContainer.innerHTML = ''
  if (!filtered.length) { listingsContainer.innerHTML = '<p class="text-slate-400 p-4">No listings match the selected filters.</p>'; return }
  if (listingsContainer.classList.contains('listing-grid')) listingsContainer.appendChild(createHeroCard())
  filtered.forEach(l => listingsContainer.appendChild(createListingCard(l)))
}

const loadListings = async () => {
  try {
    const d = await api('/api/mp/listings'); state.listings = d.listings || []
  } catch { state.listings = [] }
  renderListings()
}

const loadAdminListings = async () => {
  if (!state.user || state.user.role !== 'admin') return
  try {
    const d = await api('/api/mp/admin/listings?status=pending')
    adminListingsContainer.innerHTML = ''
    if (!d.listings.length) { adminListingsContainer.innerHTML = '<p class="text-slate-400">No pending submissions.</p>'; return }
    d.listings.forEach(l => {
      const w = document.createElement('div'); w.className = 'border border-slate-800 rounded-lg p-4 space-y-2 mb-3'
      w.innerHTML = `<p class="font-semibold">${esc(l.product_name)} <span class="text-sm text-slate-400">by ${esc(l.company_name)}</span></p><p class="text-sm text-slate-300">${esc(l.description)}</p><p class="text-sm"><a href="/marketplace/admin" class="text-emerald-400">Review full details in the admin dashboard</a></p>`
      const approve = document.createElement('button'); approve.textContent = 'Approve'; approve.className = 'px-3 py-2 bg-emerald-500 text-slate-900 rounded-lg text-sm font-semibold mr-2'
      const reject = document.createElement('button'); reject.textContent = 'Reject'; reject.className = 'px-3 py-2 border border-rose-500 text-rose-400 rounded-lg text-sm font-semibold'
      const act = async (status) => {
        let reason = ''
        if (status === 'rejected') { reason = window.prompt('Reason for rejecting (emailed to the company, optional):', ''); if (reason === null) return }
        try { await api(`/api/mp/admin/listings/${encodeURIComponent(l.id)}`, { method:'PATCH', body:JSON.stringify({ status, reason }) }); showToast(status === 'approved' ? 'Approved' : 'Rejected'); loadAdminListings(); loadListings() }
        catch (err) { showToast(err.message, true) }
      }
      approve.addEventListener('click', () => act('approved'))
      reject.addEventListener('click', () => act('rejected'))
      const br = document.createElement('div'); br.className = 'flex gap-3 mt-2'; br.appendChild(approve); br.appendChild(reject); w.appendChild(br)
      adminListingsContainer.appendChild(w)
    })
  } catch {}
}

// Auth events
loginButton.addEventListener('click', () => authSection.classList.toggle('hidden'))
logoutButton.addEventListener('click', async () => { await api('/api/mp/auth/logout', { method: 'POST' }); state.user = null; updateAuthUI(); showToast('Logged out') })
openListingButton.addEventListener('click', () => {
  if (!state.user) {
    wantsToSubmit = true
    authSection.classList.remove('hidden'); authSection.scrollIntoView({ behavior:'smooth' })
    showToast('Log in or create a free account to submit your product', true); return
  }
  showListingForm()
})
refreshButton.addEventListener('click', () => loadListings())
viewButtons.forEach(b => b.addEventListener('click', () => { setListingView(b.getAttribute('data-view') || 'grid'); renderListings() }))

const registerForm = document.getElementById('register-form')
const loginForm = document.getElementById('login-form')
const listingForm = document.getElementById('listing-form')

// After signing in: admins go to the review queue; a company that came to list a
// product goes to the form; anyone else to their dashboard.
const afterSignIn = () => {
  if (!state.user) return
  if (state.user.role === 'admin') { window.location.href = '/marketplace/admin'; return }
  if (wantsToSubmit) { showListingForm(); return }
  window.location.href = '/marketplace/dashboard'
}

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  try {
    await api('/api/mp/auth/register', { method:'POST', body:JSON.stringify(Object.fromEntries(new FormData(registerForm).entries())) })
    registerForm.reset()
    // Registering signs you in. Someone creating an account here has come to list.
    wantsToSubmit = true
    await loadMe()
    showToast('Account created. Add your product below.')
    afterSignIn()
  } catch (err) { showToast(err.message, true) }
})

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  try {
    await api('/api/mp/auth/login', { method:'POST', body:JSON.stringify(Object.fromEntries(new FormData(loginForm).entries())) })
    showToast('Welcome back'); loginForm.reset(); await loadMe()
    afterSignIn()
  } catch (err) { showToast(err.message, true) }
})

// ── Images ──
// Photos are scaled down here so the marketplace grid is not loading
// multi-megabyte originals, and SVG logos (which the server refuses, since SVG can
// carry script) are drawn to PNG.
const RASTER_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const IMAGE_KINDS = { logo: { maxDim: 512, type: 'image/png' }, photo: { maxDim: 1600, type: 'image/jpeg' } }
const KEEP_ORIGINAL_BELOW = 1024 * 1024
const MAX_SOURCE_BYTES = 25 * 1024 * 1024
const isSvgFile = (f) => f.type === 'image/svg+xml' || /\.svg$/i.test(f.name || '')

const checkImageFile = (f, kind) => {
  const svg = isSvgFile(f)
  if (svg && kind !== 'logo') return `${f.name}: SVG works for the logo only. Use a PNG or JPG here.`
  if (!svg && !RASTER_TYPES.includes(f.type)) return `${f.name}: please use a PNG, JPG, WebP${kind === 'logo' ? ' or SVG' : ''} image.`
  if (f.size > MAX_SOURCE_BYTES) return `${f.name} is over 25MB. Please use a smaller image.`
  return ''
}

const decodeImage = (file) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.onload = () => resolve({ img, url })
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`${file.name} could not be read as an image.`)) }
  img.src = url
})

const prepareImage = async (file, kind) => {
  const problem = checkImageFile(file, kind); if (problem) throw new Error(problem)
  const svg = isSvgFile(file)
  const { img, url } = await decodeImage(file)
  try {
    const { maxDim, type } = IMAGE_KINDS[kind]
    let w = img.naturalWidth, h = img.naturalHeight
    if (!w || !h) { w = maxDim; h = maxDim }
    if (!svg && Math.max(w, h) <= maxDim && file.size <= KEEP_ORIGINAL_BELOW) return file
    // Vector logos have no real pixel size (Chrome reports 150px for a viewBox-only
    // SVG), so they are drawn at full size; photos are only ever scaled down.
    const scale = svg ? maxDim / Math.max(w, h) : Math.min(1, maxDim / Math.max(w, h))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w * scale)); canvas.height = Math.max(1, Math.round(h * scale))
    const ctx = canvas.getContext('2d')
    if (type === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height) }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    let blob = null
    try { blob = await new Promise(r => canvas.toBlob(r, type, 0.86)) } catch { blob = null }
    if (!blob) throw new Error(`${file.name} could not be converted. Please upload a PNG or JPG instead.`)
    const base = (file.name || 'image').replace(/\.[^.]+$/, '')
    return new File([blob], `${base}.${type === 'image/png' ? 'png' : 'jpg'}`, { type })
  } finally { URL.revokeObjectURL(url) }
}

// A retry after a failed submit reuses what already uploaded instead of storing it again.
const uploadedUrls = new WeakMap()
const uploadImage = async (file, kind) => {
  if (uploadedUrls.has(file)) return uploadedUrls.get(file)
  const prepared = await prepareImage(file, kind)
  const fd = new FormData(); fd.append('file', prepared)
  const r = await fetch('/api/mp/uploads', { method:'POST', body:fd, credentials:'same-origin' })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`${file.name}: ${d.error || 'upload failed. Please try again.'}`)
  uploadedUrls.set(file, d.url)
  return d.url
}

// Logo upload
const logoInput = listingForm.querySelector('input[name="logo_file"]')
const logoPreview = document.getElementById('logo-preview')
const logoPreviewImg = document.getElementById('logo-preview-img')
const logoRemoveBtn = document.getElementById('logo-remove')
const logoUploadLabel = document.getElementById('logo-upload-label')

if (logoInput) {
  logoUploadLabel.addEventListener('click', () => logoInput.click())
  logoInput.addEventListener('change', () => {
    const f = logoInput.files[0]; if (!f) return
    const problem = checkImageFile(f, 'logo'); if (problem) { showToast(problem, true); logoInput.value = ''; return }
    logoPreviewImg.src = URL.createObjectURL(f); logoPreview.classList.remove('hidden')
  })
  if (logoRemoveBtn) logoRemoveBtn.addEventListener('click', () => { logoInput.value = ''; logoPreview.classList.add('hidden'); logoPreviewImg.removeAttribute('src') })
}

// Product image upload
const productImgInput = listingForm.querySelector('input[name="product_image_file"]')
const productImgPreview = document.getElementById('product-img-preview')
const productImgPreviewImg = document.getElementById('product-img-preview-img')
const productImgRemove = document.getElementById('product-img-remove')
const productImgLabel = document.getElementById('product-img-label')
const productImgSize = document.getElementById('product-img-size')

if (productImgInput) {
  productImgLabel.addEventListener('click', () => productImgInput.click())
  productImgInput.addEventListener('change', () => {
    const f = productImgInput.files[0]; if (!f) return
    const problem = checkImageFile(f, 'photo'); if (problem) { showToast(problem, true); productImgInput.value = ''; return }
    const src = URL.createObjectURL(f)
    productImgPreviewImg.src = src; productImgPreview.classList.remove('hidden')
    const img = new Image(); img.onload = () => { productImgSize.textContent = `${img.naturalWidth}x${img.naturalHeight} · ${formatFileSize(f.size)}` }; img.src = src
  })
  if (productImgRemove) productImgRemove.addEventListener('click', () => { productImgInput.value = ''; productImgPreview.classList.add('hidden'); productImgPreviewImg.removeAttribute('src'); productImgSize.textContent = '' })
}

// Screenshots
const screenshotsInput = listingForm.querySelector('input[name="screenshot_files"]')
const screenshotsPreview = document.getElementById('screenshots-preview')
const screenshotsLabel = document.getElementById('screenshots-label')
let selectedScreenshots = []
const renderScreenshotThumbs = () => {
  screenshotsPreview.innerHTML = ''
  selectedScreenshots.forEach((f, i) => {
    const t = document.createElement('div'); t.className = 'screenshot-thumb'
    const img = document.createElement('img'); img.src = URL.createObjectURL(f)
    const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'screenshot-thumb-remove'; rm.innerHTML = '<i class="fas fa-times"></i>'
    rm.addEventListener('click', () => { selectedScreenshots.splice(i, 1); renderScreenshotThumbs() })
    t.appendChild(img); t.appendChild(rm); screenshotsPreview.appendChild(t)
  })
}
if (screenshotsInput) {
  screenshotsLabel.addEventListener('click', () => screenshotsInput.click())
  screenshotsInput.addEventListener('change', () => {
    Array.from(screenshotsInput.files).forEach(f => {
      if (selectedScreenshots.length >= 3) { showToast('Max 3 screenshots', true); return }
      const problem = checkImageFile(f, 'photo'); if (problem) { showToast(problem, true); return }
      selectedScreenshots.push(f)
    })
    screenshotsInput.value = ''; renderScreenshotThumbs()
  })
}

// Listing form submit
const submitBtn = listingForm.querySelector('button[type="submit"]')
const submitBtnHTML = submitBtn ? submitBtn.innerHTML : 'Submit'

listingForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Submitting...' }
  const fd = new FormData(listingForm)
  const payload = Object.fromEntries(fd.entries())
  payload.target_industry = Array.from(document.querySelectorAll('input[name="target_industry"]:checked')).map(i => i.value).join(', ')
  payload.ai_category = Array.from(document.querySelectorAll('input[name="ai_category"]:checked')).map(i => i.value).join(', ')
  if (payload.tags) payload.tags = payload.tags.split(',').map(v => v.trim()).filter(Boolean).join(', ')
  delete payload.logo_file; delete payload.product_image_file; delete payload.screenshot_files; delete payload.company_name

  try {
    if (logoInput?.files?.[0]) payload.logo_url = await uploadImage(logoInput.files[0], 'logo')
    if (productImgInput?.files?.[0]) payload.product_image_url = await uploadImage(productImgInput.files[0], 'photo')
    if (selectedScreenshots.length) payload.screenshot_urls = (await Promise.all(selectedScreenshots.map(f => uploadImage(f, 'photo')))).join(', ')

    await api('/api/mp/listings', { method:'POST', body:JSON.stringify(payload) })
    const pn = payload.product_name || 'Your listing'
    listingFormSection.innerHTML = `<div class="listing-success-panel"><div class="listing-success-icon"><i class="fas fa-check-circle"></i></div><h3 class="listing-success-title">Listing Submitted!</h3><p class="listing-success-sub"><strong>${esc(pn)}</strong> is now pending review. We will email you when it is live.</p><div class="listing-success-actions"><a href="/marketplace/dashboard" class="listing-success-btn listing-success-btn--primary"><i class="fas fa-chart-pie mr-2"></i>Dashboard</a><a href="/marketplace?submit=true" class="listing-success-btn listing-success-btn--secondary"><i class="fas fa-plus mr-2"></i>Submit Another</a><a href="/marketplace" class="listing-success-btn listing-success-btn--secondary"><i class="fas fa-store mr-2"></i>Marketplace</a></div></div>`
    listingFormSection.scrollIntoView({ behavior:'smooth' })
  } catch (err) { showToast(err.message, true); if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = submitBtnHTML } }
})

// Init
const init = async () => {
  await loadMe()
  // The event app's "List on AI Market" lands here with ?submit=true.
  if (wantsToSubmit && state.user) showListingForm()
  else if (wantsToSubmit) { authSection.classList.remove('hidden'); setTimeout(() => authSection.scrollIntoView({ behavior:'smooth' }), 150) }
  let view = 'grid'; try { view = localStorage.getItem('mpListingView') || 'grid' } catch {}
  setListingView(view)
  await loadListings()
  await loadAdminListings()
}
init()
