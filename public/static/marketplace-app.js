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

const demoListings = [
  { id:'demo-1', product_name:'Bharat Insight Copilot', company_name:'NovaSigma AI', description:'Agentic AI copilot that automates policy research, drafting, and compliance workflows.', target_customer:'Enterprise compliance leaders', target_industry:'Banking, Insurance, Financial Services', ai_category:'Risk & Compliance Management, Contract Analysis, AI Agents, LLM-powered, RAG', product_image_url:'https://placehold.co/1200x630/0f172a/34d399?text=Insight+Copilot', tags:'Risk, Compliance, Regulatory', sales_contact_name:'Aisha Khan', sales_contact_email:'sales@novasigma.ai', innovation:'Combines multi-agent reasoning with regulatory knowledge graphs.', pricing_type:'Enterprise', pricing_details:'Custom annual contract', founder_name:'Arjun Menon', awards_rating:5, website_url:'https://example.com', product_url:'https://example.com/product' },
  { id:'demo-2', product_name:'Orbit GenAI Studio', company_name:'Helios Labs', description:'Generative AI platform for marketing, brand content, and localized campaigns.', target_customer:'CMOs and growth teams', target_industry:'Retail, Consumer Goods, Hospitality', ai_category:'Content Generation, Campaign Automation, Personalization Engines, Generative AI', product_image_url:'https://placehold.co/1200x630/0f172a/818cf8?text=Orbit+GenAI', tags:'Brand, Campaigns, Localization', sales_contact_name:'Maya Singh', innovation:'Realtime brand guardrails with multimodal generation.', pricing_type:'Paid', pricing_details:'From $1,200/month', awards_rating:4 },
  { id:'demo-3', product_name:'Atlas Code Pilot', company_name:'VertexOps', description:'AI development assistant for SDLC automation, code review, and QA.', target_customer:'Engineering leaders', target_industry:'Software, Telecom, Healthcare', ai_category:'Code Generation / SDLC, DevOps Automation, Test Automation', product_image_url:'https://placehold.co/1200x630/0f172a/fbbf24?text=Atlas+Code+Pilot', tags:'DevOps, QA, Code Review', innovation:'Context-aware CI/CD copilots with automated test generation.', pricing_type:'Paid', pricing_details:'Usage-based', awards_rating:4 },
  { id:'demo-4', product_name:'Quanta Support Grid', company_name:'Nimbus AI Systems', description:'AI service desk with multilingual voice and chat automation for customer support.', target_customer:'Support operations leaders', target_industry:'Telecom, Utilities, Logistics', ai_category:'Customer Support Automation, AI Chatbots, Speech / Voice AI', product_image_url:'https://placehold.co/1200x630/0f172a/f472b6?text=Quanta+Support', tags:'Voice AI, Service Desk, Automation', innovation:'Real-time sentiment routing and auto-resolution playbooks.', pricing_type:'Paid', pricing_details:'From $0.12/conversation', awards_rating:4 },
  { id:'demo-5', product_name:'Lumina Health AI', company_name:'CareSense', description:'Clinical decision support and patient triage with secure AI agents.', target_customer:'Hospital administrators', target_industry:'Healthcare, Pharma', ai_category:'RAG, AI Safety / Guardrails, LLM-powered', product_image_url:'https://placehold.co/1200x630/0f172a/34d399?text=Lumina+Health+AI', tags:'Clinical, Triage, Patient Safety', innovation:'HIPAA-ready retrieval + multi-agent verification.', pricing_type:'Enterprise', pricing_details:'Annual license', awards_rating:5 }
]

const showToast = (msg, isError = false) => {
  toast.textContent = msg; toast.classList.remove('hidden')
  toast.classList.toggle('border-rose-500', isError); toast.classList.toggle('border-slate-700', !isError)
  setTimeout(() => toast.classList.add('hidden'), 3000)
}
const getInitials = (name = '') => name.split(' ').filter(Boolean).slice(0,2).map(p => p[0]).join('').toUpperCase()
const toSlug = (text) => (text||'').toLowerCase().trim().replace(/&/g,'and').replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,80)
const listingUrl = (l) => { const cs = l.company_slug || toSlug(l.company_name), ps = l.product_slug || toSlug(l.product_name); return (cs && ps) ? `/marketplace/listing/${cs}/${ps}` : `/marketplace/listing/${l.id}` }
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

const setListingView = (view) => {
  const sel = view === 'list' ? 'list' : 'grid'
  listingsContainer.classList.toggle('listing-list', sel === 'list')
  listingsContainer.classList.toggle('listing-grid', sel === 'grid')
  viewButtons.forEach(b => b.classList.toggle('view-active', b.getAttribute('data-view') === sel))
  localStorage.setItem('mpListingView', sel)
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
  renderFilterGroup(filterTagsContainer, Array.from(tags).sort(), filters.tag, v => { filters.tag = v; loadListings() })
  renderFilterGroup(filterIndustriesContainer, MASTER_INDUSTRIES, filters.industry, v => { filters.industry = v; loadListings() })
  renderFilterGroup(filterCategoriesContainer, MASTER_AI_CATEGORIES, filters.category, v => { filters.category = v; loadListings() })
}

const applyFilters = (listings) => listings.filter(l => {
  const il = toTagList(l.target_industry), cl = toTagList(l.ai_category), tl = toTagList(l.tags)
  return (!filters.industry || il.includes(filters.industry)) && (!filters.category || cl.includes(filters.category)) && (!filters.tag || tl.includes(filters.tag))
})

const createListingCard = (listing) => {
  const card = document.createElement('div'); card.className = 'listing-card'
  const cats = toTagList(listing.ai_category), tags = toTagList(listing.tags), inds = toTagList(listing.target_industry)
  const initials = getInitials(listing.product_name)
  const logoMk = listing.logo_url ? `<img src="${listing.logo_url}" alt="">` : initials
  const tagMk = items => items.length ? items.slice(0,3).map(i => `<span class="tag">${i}</span>`).join('') : '<span class="tag tag-muted">—</span>'
  const imgMk = listing.product_image_url ? `<div class="listing-product-img"><img src="${listing.product_image_url}" alt=""></div>` : ''
  const boothBadge = listing.booth_number ? `<span class="listing-booth-badge"><i class="fas fa-map-marker-alt"></i> Booth ${listing.booth_number}</span>` : ''

  card.innerHTML = `${imgMk}
    <div class="listing-compact">
      <div class="listing-logo">${logoMk}</div>
      <div class="listing-compact-body">
        <p class="listing-company">${listing.company_name} ${boothBadge}</p>
        <h4 class="listing-title">${listing.product_name}</h4>
        <p class="listing-desc">${listing.description}</p>
        <div class="listing-meta">
          <div class="rating-row"><i class="fa-solid fa-star"></i><span>${listing.awards_rating||'—'} Rating</span></div>
          <span class="meta-dot">·</span><span>${listing.pricing_type||'Pricing on request'}</span>
        </div>
        <div class="listing-section"><p class="section-label">AI Categories</p><div class="tag-row">${tagMk(cats)}</div></div>
        <div class="listing-section"><p class="section-label">Tags</p><div class="tag-row">${tagMk(tags)}</div></div>
        <div class="listing-cta"><a class="learn-more" href="${listingUrl(listing)}">Learn more</a></div>
      </div>
    </div>`
  return card
}

const createHeroCard = () => {
  const card = document.createElement('div'); card.className = 'listing-card listing-hero'
  card.innerHTML = `<div class="hero-content"><p class="hero-kicker">AI Agents</p><h4>Explore AI Solutions</h4><p>Discover AI solutions that automate workflows, make decisions, and support teams across industries.</p><button class="hero-button" onclick="document.getElementById('filter-categories').scrollIntoView({behavior:'smooth'})">Explore categories</button></div>`
  return card
}

const loadListings = async () => {
  try {
    const d = await api('/api/mp/listings'); state.listings = d.listings || []
  } catch { state.listings = [] }
  const active = state.listings.length ? state.listings : demoListings
  buildFilters(active)
  const filtered = applyFilters(active)
  listingsContainer.innerHTML = ''
  if (!filtered.length) { listingsContainer.innerHTML = '<p class="text-slate-400 p-4">No listings match the selected filters.</p>'; return }
  if (!state.listings.length) listingsContainer.innerHTML = '<p class="text-slate-400 text-sm p-4">Showing sample listings.</p>'
  if (listingsContainer.classList.contains('listing-grid')) listingsContainer.appendChild(createHeroCard())
  filtered.forEach(l => listingsContainer.appendChild(createListingCard(l)))
}

const loadAdminListings = async () => {
  if (!state.user || state.user.role !== 'admin') return
  try {
    const d = await api('/api/mp/admin/listings?status=pending')
    adminListingsContainer.innerHTML = ''
    if (!d.listings.length) { adminListingsContainer.innerHTML = '<p class="text-slate-400">No pending submissions.</p>'; return }
    d.listings.forEach(l => {
      const w = document.createElement('div'); w.className = 'border border-slate-800 rounded-lg p-4 space-y-2 mb-3'
      w.innerHTML = `<p class="font-semibold">${l.product_name} <span class="text-sm text-slate-400">by ${l.company_name}</span></p><p class="text-sm text-slate-300">${l.description}</p>`
      const approve = document.createElement('button'); approve.textContent = 'Approve'; approve.className = 'px-3 py-2 bg-emerald-500 text-slate-900 rounded-lg text-sm font-semibold mr-2'
      const reject = document.createElement('button'); reject.textContent = 'Reject'; reject.className = 'px-3 py-2 border border-rose-500 text-rose-400 rounded-lg text-sm font-semibold'
      approve.addEventListener('click', async () => { await api(`/api/mp/admin/listings/${l.id}`, { method:'PATCH', body:JSON.stringify({status:'approved'}) }); showToast('Approved'); loadAdminListings(); loadListings() })
      reject.addEventListener('click', async () => { await api(`/api/mp/admin/listings/${l.id}`, { method:'PATCH', body:JSON.stringify({status:'rejected'}) }); showToast('Rejected'); loadAdminListings() })
      const br = document.createElement('div'); br.className = 'flex gap-3 mt-2'; br.appendChild(approve); br.appendChild(reject); w.appendChild(br)
      adminListingsContainer.appendChild(w)
    })
  } catch {}
}

// Auth events
loginButton.addEventListener('click', () => authSection.classList.toggle('hidden'))
logoutButton.addEventListener('click', async () => { await api('/api/mp/auth/logout', { method: 'POST' }); state.user = null; updateAuthUI(); showToast('Logged out') })
openListingButton.addEventListener('click', () => { if (!state.user) { authSection.classList.remove('hidden'); showToast('Login required to submit listings', true); return }; listingFormSection.classList.remove('hidden'); listingFormSection.scrollIntoView({ behavior:'smooth' }) })
refreshButton.addEventListener('click', () => loadListings())
viewButtons.forEach(b => b.addEventListener('click', () => setListingView(b.getAttribute('data-view') || 'grid')))

const registerForm = document.getElementById('register-form')
const loginForm = document.getElementById('login-form')
const listingForm = document.getElementById('listing-form')

registerForm.addEventListener('submit', async (e) => { e.preventDefault(); try { await api('/api/mp/auth/register', { method:'POST', body:JSON.stringify(Object.fromEntries(new FormData(registerForm).entries())) }); showToast('Registration complete. Please login.'); registerForm.reset() } catch (err) { showToast(err.message, true) } })

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  try {
    await api('/api/mp/auth/login', { method:'POST', body:JSON.stringify(Object.fromEntries(new FormData(loginForm).entries())) })
    showToast('Welcome back'); loginForm.reset(); await loadMe()
    if (state.user && state.user.role !== 'admin') { window.location.href = '/marketplace/dashboard'; return }
    if (state.user && state.user.role === 'admin') { window.location.href = '/marketplace/admin'; return }
  } catch (err) { showToast(err.message, true) }
})

// File upload helper
const uploadFile = async (file) => {
  const fd = new FormData(); fd.append('file', file)
  const r = await fetch('/api/mp/uploads', { method:'POST', body:fd, credentials:'same-origin' })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || 'Upload failed')
  return d
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
    const r = new FileReader(); r.onload = e => { logoPreviewImg.src = e.target.result; logoPreview.classList.remove('hidden') }; r.readAsDataURL(f)
  })
  if (logoRemoveBtn) logoRemoveBtn.addEventListener('click', () => { logoInput.value = ''; logoPreview.classList.add('hidden'); logoPreviewImg.src = '' })
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
    if (f.size > 5*1024*1024) { showToast('Max 5MB', true); productImgInput.value = ''; return }
    const r = new FileReader(); r.onload = e => {
      productImgPreviewImg.src = e.target.result; productImgPreview.classList.remove('hidden')
      const img = new Image(); img.onload = () => { productImgSize.textContent = `${img.naturalWidth}x${img.naturalHeight} · ${formatFileSize(f.size)}` }; img.src = e.target.result
    }; r.readAsDataURL(f)
  })
  if (productImgRemove) productImgRemove.addEventListener('click', () => { productImgInput.value = ''; productImgPreview.classList.add('hidden'); productImgPreviewImg.src = ''; productImgSize.textContent = '' })
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
    Array.from(screenshotsInput.files).forEach(f => { if (selectedScreenshots.length >= 3) { showToast('Max 3 screenshots', true); return }; if (f.size > 5*1024*1024) { showToast(`${f.name} too large`, true); return }; selectedScreenshots.push(f) })
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

  try {
    if (logoInput?.files?.[0]) { const u = await uploadFile(logoInput.files[0]); payload.logo_url = u.url }
    if (productImgInput?.files?.[0]) { const u = await uploadFile(productImgInput.files[0]); payload.product_image_url = u.url }
    if (selectedScreenshots.length) { const ups = await Promise.all(selectedScreenshots.map(f => uploadFile(f))); payload.screenshot_urls = ups.map(u => u.url).join(', ') }
    delete payload.logo_file; delete payload.product_image_file; delete payload.screenshot_files

    await api('/api/mp/listings', { method:'POST', body:JSON.stringify(payload) })
    const pn = payload.product_name || 'Your listing'
    listingFormSection.innerHTML = `<div class="listing-success-panel"><div class="listing-success-icon"><i class="fas fa-check-circle"></i></div><h3 class="listing-success-title">Listing Submitted!</h3><p class="listing-success-sub"><strong>${pn}</strong> is now pending admin review.</p><div class="listing-success-actions"><a href="/marketplace/dashboard" class="listing-success-btn listing-success-btn--primary"><i class="fas fa-chart-pie mr-2"></i>Dashboard</a><a href="/marketplace?submit=true" class="listing-success-btn listing-success-btn--secondary"><i class="fas fa-plus mr-2"></i>Submit Another</a><a href="/marketplace" class="listing-success-btn listing-success-btn--secondary"><i class="fas fa-store mr-2"></i>Marketplace</a></div></div>`
    listingFormSection.scrollIntoView({ behavior:'smooth' })
  } catch (err) { showToast(err.message, true); if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = submitBtnHTML } }
})

// Init
const init = async () => {
  await loadMe()
  const params = new URLSearchParams(window.location.search)
  if (params.get('submit') === 'true' && state.user) {
    listingFormSection.classList.remove('hidden')
    setTimeout(() => listingFormSection.scrollIntoView({ behavior:'smooth' }), 300)
  }
  setListingView(localStorage.getItem('mpListingView') || 'grid')
  await loadListings()
  await loadAdminListings()
}
init()
