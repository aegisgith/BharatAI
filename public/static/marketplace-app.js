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

const loginButton = document.getElementById('login-button')
const logoutButton = document.getElementById('logout-button')
const dashboardLink = document.getElementById('dashboard-link')
const openListingButton = document.getElementById('open-listing-button')
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
  viewButtons.forEach(b => { const on = b.getAttribute('data-view') === sel; b.classList.toggle('view-active', on); b.setAttribute('aria-pressed', String(on)) })
  try { localStorage.setItem('mpListingView', sel) } catch {}
}

const loadMe = async () => { try { const d = await api('/api/mp/auth/me'); state.user = d.user; updateAuthUI() } catch {} }

// ── Search and filters ──
// Each filter lists only values that approved listings actually use, with a count.
// It used to render every master industry (35) and AI category (66) as a chip wall,
// most of them leading to "No listings match", above the listings themselves.
// Vendor-typed tags differ in case ("Recruitment" / "recruitment"), so values are
// matched on a lower-cased key and shown with the first spelling seen.
const keyOf = (v) => String(v || '').trim().toLowerCase()
const FILTERS = [
  { name: 'industry', field: 'target_industry', all: 'Industry', select: document.getElementById('filter-industry') },
  { name: 'category', field: 'ai_category', all: 'Category', select: document.getElementById('filter-category') },
  { name: 'tag', field: 'tags', all: 'Tag', select: document.getElementById('filter-tag') },
]
const filters = { q: '', industry: '', category: '', tag: '' }
const filterLabels = {}
const searchInput = document.getElementById('mk-search')
const statusEl = document.getElementById('mk-status')
let filtersBuiltFor = null

const buildFilters = (listings) => {
  FILTERS.forEach(f => {
    const counts = new Map()
    listings.forEach(l => new Set(toTagList(l[f.field]).map(keyOf)).forEach(k => counts.set(k, (counts.get(k) || 0) + 1)))
    const labels = filterLabels[f.name] = {}
    listings.forEach(l => toTagList(l[f.field]).forEach(v => { const k = keyOf(v); if (!labels[k]) labels[k] = v }))
    const keys = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || labels[a].localeCompare(labels[b]))
    if (filters[f.name] && !counts.has(filters[f.name])) filters[f.name] = ''
    if (!f.select) return
    f.select.innerHTML = `<option value="">${esc(f.all)}</option>` + keys.map(k => `<option value="${esc(k)}">${esc(labels[k])} (${counts.get(k)})</option>`).join('')
    f.select.value = filters[f.name]
    f.select.hidden = keys.length === 0
  })
  filtersBuiltFor = listings
}

const searchText = (l) => [l.product_name, l.company_name, l.description, l.ai_category, l.tags, l.target_industry, l.target_customer, l.use_cases].map(v => String(v || '')).join(' ').toLowerCase()

const applyFilters = (listings) => {
  const words = filters.q.toLowerCase().split(/\s+/).filter(Boolean)
  return listings.filter(l => {
    if (FILTERS.some(f => filters[f.name] && !toTagList(l[f.field]).map(keyOf).includes(filters[f.name]))) return false
    if (!words.length) return true
    const text = searchText(l)
    return words.every(w => text.includes(w))
  })
}

const isFiltering = () => !!(filters.q.trim() || FILTERS.some(f => filters[f.name]))

const clearFilters = () => {
  filters.q = ''; if (searchInput) searchInput.value = ''
  FILTERS.forEach(f => { filters[f.name] = '' })
  renderListings()
}

const renderStatus = (shown, total) => {
  if (!statusEl) return
  if (!isFiltering()) { statusEl.innerHTML = ''; return }
  const chips = FILTERS.filter(f => filters[f.name]).map(f =>
    `<button type="button" class="mk-active-chip" data-clear="${f.name}" aria-label="Remove filter ${esc(filterLabels[f.name]?.[filters[f.name]] || filters[f.name])}"><span>${esc(filterLabels[f.name]?.[filters[f.name]] || filters[f.name])}</span><i class="fas fa-xmark" aria-hidden="true"></i></button>`)
  if (filters.q.trim()) chips.unshift(`<button type="button" class="mk-active-chip" data-clear="q" aria-label="Clear search"><span>&ldquo;${esc(filters.q.trim())}&rdquo;</span><i class="fas fa-xmark" aria-hidden="true"></i></button>`)
  statusEl.innerHTML = `<span class="mk-count">${shown} of ${total} product${total === 1 ? '' : 's'}</span>${chips.join('')}<button type="button" class="mk-clear" data-clear="all">Clear all</button>`
}

if (statusEl) statusEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-clear]'); if (!btn) return
  const which = btn.getAttribute('data-clear')
  if (which === 'all') return clearFilters()
  if (which === 'q') { filters.q = ''; if (searchInput) searchInput.value = '' }
  else filters[which] = ''
  renderListings()
})
FILTERS.forEach(f => f.select && f.select.addEventListener('change', () => { filters[f.name] = f.select.value; renderListings() }))
if (searchInput) searchInput.addEventListener('input', () => { filters.q = searchInput.value; renderListings() })

// ── Cards ──
// The whole card is the link. Empty fields are left out rather than shown as "—",
// and the company line is dropped when it only repeats the product name.
const createListingCard = (listing) => {
  const card = document.createElement('a')
  card.className = 'listing-card'
  card.href = listingUrl(listing)
  const name = String(listing.product_name || '').trim() || 'Untitled product'
  const company = String(listing.company_name || '').trim()
  const logo = safeUrl(listing.logo_url), image = safeUrl(listing.product_image_url)
  const booth = listing.exhibitor_booth || listing.booth_number
  const chipsFrom = [toTagList(listing.ai_category), toTagList(listing.tags), toTagList(listing.target_industry)].find(list => list.length) || []
  const chips = chipsFrom.slice(0, 3).map(c => `<span class="chip">${esc(c)}</span>`).join('') + (chipsFrom.length > 3 ? `<span class="chip chip--more">+${chipsFrom.length - 3}</span>` : '')

  card.innerHTML = `${image ? `<div class="listing-product-img"><img src="${esc(image)}" alt="" loading="lazy"></div>` : ''}
    <div class="listing-body">
      <div class="listing-head">
        <div class="listing-logo${logo ? '' : ' listing-logo--initials'}">${logo ? `<img src="${esc(logo)}" alt="" loading="lazy">` : esc(getInitials(name))}</div>
        <div class="listing-names">
          <h3 class="listing-title">${esc(name)}</h3>
          ${company && keyOf(company) !== keyOf(name) ? `<p class="listing-company">${esc(company)}</p>` : ''}
        </div>
      </div>
      ${listing.description ? `<p class="listing-desc">${esc(listing.description)}</p>` : ''}
      ${chips ? `<div class="listing-chips">${chips}</div>` : ''}
      <div class="listing-foot">
        <span class="listing-price"><span>${esc(listing.pricing_type || 'Pricing on request')}</span>${booth ? `<span class="listing-booth-badge"><i class="fas fa-location-dot" aria-hidden="true"></i> Booth ${esc(booth)}</span>` : ''}</span>
        <span class="listing-view">View details <i class="fas fa-arrow-right" aria-hidden="true"></i></span>
      </div>
    </div>`
  return card
}

const renderListings = () => {
  listingsContainer.removeAttribute('aria-busy')
  // The marketplace is empty until listings are approved. It used to fall back to
  // five invented companies behind a small "Showing sample listings." note -
  // fabricated products, pricing and sales contacts a visitor could click straight
  // into, indistinguishable from the real thing. Say the truth instead.
  if (!state.listings.length) {
    buildFilters([]); renderStatus(0, 0)
    listingsContainer.innerHTML = '<div class="mp-empty-state"><i class="fa-solid fa-store"></i><h4>No listings published yet</h4><p>Approved AI products appear here as exhibitors submit them. Be one of the first: submitting is free and takes a few minutes.</p><button type="button" class="mp-hero-btn mp-hero-btn--primary" id="mp-empty-submit">Submit your product</button></div>'
    const b = document.getElementById('mp-empty-submit')
    // Reuse the real button so the login-required guard is not duplicated here.
    if (b) b.addEventListener('click', () => openListingButton.click())
    return
  }
  if (filtersBuiltFor !== state.listings) buildFilters(state.listings)
  FILTERS.forEach(f => f.select && f.select.classList.toggle('is-set', !!filters[f.name]))
  const filtered = applyFilters(state.listings)
  renderStatus(filtered.length, state.listings.length)
  listingsContainer.innerHTML = ''
  if (!filtered.length) {
    listingsContainer.innerHTML = '<div class="mp-empty-state"><i class="fa-solid fa-search"></i><h4>No products match</h4><p>Try a shorter search, or remove one of the filters.</p><button type="button" class="mp-hero-btn mp-hero-btn--secondary" id="mp-empty-clear">Clear search and filters</button></div>'
    document.getElementById('mp-empty-clear').addEventListener('click', clearFilters)
    return
  }
  const frag = document.createDocumentFragment()
  filtered.forEach(l => frag.appendChild(createListingCard(l)))
  listingsContainer.appendChild(frag)
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
// Every event pass includes a listing: someone signed in to the event app is signed
// in here without a second account. The server decides whether that is safe for
// their email; when it is not, it emails them a sign-in link instead.
const signInFromApp = async () => {
  try {
    const r = await fetch('/api/mp/auth/from-app', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const d = await r.json().catch(() => ({}))
    if (r.ok && d.user) { await loadMe(); return !!state.user }
    if (d.link_sent) { showToast(d.message); return 'link-sent' }
  } catch {}
  return false
}

openListingButton.addEventListener('click', async () => {
  if (!state.user) {
    const viaApp = await signInFromApp()
    if (viaApp === 'link-sent') return
    if (viaApp) { showListingForm(); return }
    wantsToSubmit = true
    authSection.classList.remove('hidden'); authSection.scrollIntoView({ behavior:'smooth' })
    showToast('Log in or create a free account to submit your product', true); return
  }
  showListingForm()
})
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
    const d = await api('/api/mp/auth/register', { method:'POST', body:JSON.stringify(Object.fromEntries(new FormData(registerForm).entries())) })
    registerForm.reset()
    // An account already set up for this address (an exhibitor's, say): the server
    // emailed a sign-in link rather than letting a password be set on it here.
    if (d.link_sent) { showToast(d.message); return }
    // Registering signs you in. Someone creating an account here has come to list.
    wantsToSubmit = true
    await loadMe()
    showToast('Account created. Add your product below.')
    afterSignIn()
  } catch (err) { showToast(err.message, true) }
})

// "Email me a sign-in link": the same reply whether or not the address is known.
const linkForm = document.getElementById('link-form')
if (linkForm) linkForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  const btn = linkForm.querySelector('button[type="submit"]'); if (btn) btn.disabled = true
  try {
    const d = await api('/api/mp/auth/link', { method:'POST', body:JSON.stringify(Object.fromEntries(new FormData(linkForm).entries())) })
    showToast(d.message || 'If that address is known to us, a sign-in link is on its way.'); linkForm.reset()
  } catch (err) { showToast(err.message, true) }
  finally { if (btn) btn.disabled = false }
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
let submitBtnHTML = submitBtn ? submitBtn.innerHTML : 'Submit'

// Details buyers look for. None blocks a submission: the first click lists what is
// missing, a second click submits anyway. Labels match the server's checklist, which
// the confirmation email and the dashboard repeat.
const field = (name) => listingForm.elements.namedItem(name)
const RECOMMENDED = [
  ['Company logo', () => !!logoInput?.files?.[0], 'logo_file'],
  ['Product image', () => !!productImgInput?.files?.[0], 'product_image_file'],
  ['Website', () => !!field('website_url')?.value.trim(), 'website_url'],
  ['Pricing model', () => !!field('pricing_type')?.value, 'pricing_type'],
  ['AI category', () => !!listingForm.querySelector('input[name="ai_category"]:checked'), 'ai_category'],
  ['Target industry', () => !!listingForm.querySelector('input[name="target_industry"]:checked'), 'target_industry'],
  ['Use cases', () => !!field('use_cases')?.value.trim(), 'use_cases'],
  ['Demo or video link', () => !!(field('demo_url')?.value.trim() || field('video_url')?.value.trim()), 'demo_url'],
  ['Sales contact email', () => !!field('sales_contact_email')?.value.trim(), 'sales_contact_email'],
]
let incompleteAcknowledged = false
const incompleteNotice = document.createElement('div')
incompleteNotice.hidden = true
incompleteNotice.setAttribute('role', 'status')
incompleteNotice.style.cssText = 'margin:16px 0;padding:14px 16px;border-radius:12px;border:1px solid #fed7aa;background:#fff7ed;color:#7c2d12;font-size:14px;line-height:1.6'
listingForm.querySelector('.form-actions')?.before(incompleteNotice)
incompleteNotice.addEventListener('click', (e) => {
  const b = e.target.closest('[data-goto-field]'); if (!b) return
  const el = listingForm.querySelector(`[name="${b.getAttribute('data-goto-field')}"]`); if (!el) return
  const section = el.closest('details'); if (section) section.open = true
  ;(el.closest('.form-field') || el).scrollIntoView({ behavior: 'smooth', block: 'center' })
  if (el.type !== 'file' && el.type !== 'checkbox' && el.focus) setTimeout(() => el.focus({ preventScroll: true }), 300)
})
const showIncomplete = (missing) => {
  incompleteNotice.innerHTML = `<p style="margin:0 0 6px;font-weight:600">Your listing is missing ${missing.length} detail${missing.length === 1 ? '' : 's'} buyers look for:</p>
    <ul style="margin:0 0 8px;padding-left:18px">${missing.map(([label, , name]) => `<li><button type="button" data-goto-field="${esc(name)}" style="background:none;border:0;padding:0;color:#c2410c;text-decoration:underline;cursor:pointer;font:inherit">${esc(label)}</button></li>`).join('')}</ul>
    <p style="margin:0">Listings with a logo, a product image and clear pricing get more views and inquiries. Add them now, or submit anyway and finish later from your dashboard.</p>`
  incompleteNotice.hidden = false
  if (submitBtn) { submitBtnHTML = '<i class="fas fa-paper-plane mr-2"></i>Submit anyway'; submitBtn.innerHTML = submitBtnHTML }
  incompleteNotice.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

listingForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  const missing = RECOMMENDED.filter(([, has]) => !has())
  if (missing.length && !incompleteAcknowledged) { incompleteAcknowledged = true; showIncomplete(missing); return }
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

    const res = await api('/api/mp/listings', { method:'POST', body:JSON.stringify(payload) })
    const pn = payload.product_name || 'Your listing'
    const stillMissing = Array.isArray(res.missing) ? res.missing : []
    const missingNote = stillMissing.length ? ` It is still missing ${stillMissing.length} detail${stillMissing.length === 1 ? '' : 's'} (${esc(stillMissing.join(', '))}); you can add them from your dashboard.` : ''
    listingFormSection.innerHTML = `<div class="listing-success-panel"><div class="listing-success-icon"><i class="fas fa-check-circle"></i></div><h3 class="listing-success-title">Listing Submitted!</h3><p class="listing-success-sub"><strong>${esc(pn)}</strong> is now pending review. We will email you when it is live.${missingNote}</p><div class="listing-success-actions"><a href="/marketplace/dashboard" class="listing-success-btn listing-success-btn--primary"><i class="fas fa-chart-pie mr-2"></i>Dashboard</a><a href="/marketplace?submit=true" class="listing-success-btn listing-success-btn--secondary"><i class="fas fa-plus mr-2"></i>Submit Another</a><a href="/marketplace" class="listing-success-btn listing-success-btn--secondary"><i class="fas fa-store mr-2"></i>Marketplace</a></div></div>`
    listingFormSection.scrollIntoView({ behavior:'smooth' })
  } catch (err) { showToast(err.message, true); if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = submitBtnHTML } }
})

// Init
const init = async () => {
  await loadMe()
  // The event app's "List on AI Market" lands here with ?submit=true.
  const viaApp = wantsToSubmit && !state.user ? await signInFromApp() : false
  if (wantsToSubmit && state.user) showListingForm()
  else if (wantsToSubmit && viaApp !== 'link-sent') { authSection.classList.remove('hidden'); setTimeout(() => authSection.scrollIntoView({ behavior:'smooth' }), 150) }
  // A sign-in link past its seven days lands here; the form below sends a fresh one.
  if (new URLSearchParams(window.location.search).get('signin') === 'expired' && !state.user) {
    authSection.classList.remove('hidden'); setTimeout(() => authSection.scrollIntoView({ behavior:'smooth' }), 150)
    showToast('That sign-in link has expired. Enter your email below and we will send a new one.', true)
    const el = linkForm && linkForm.querySelector('input[name="email"]'); if (el) setTimeout(() => el.focus({ preventScroll: true }), 400)
  }
  let view = 'grid'; try { view = localStorage.getItem('mpListingView') || 'grid' } catch {}
  setListingView(view)
  await loadListings()
  await loadAdminListings()
}
init()
