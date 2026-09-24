// Escapes text before it goes into innerHTML. Inquiry and listing fields are
// attacker-controlled — the inquiry form needs no login at all — and were being
// interpolated raw, so a payload in a name or message ran as script in the
// vendor dashboard and the admin queue.
const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Bharat AI Marketplace — Company Dashboard JS
const toast = document.getElementById('dash-toast')
const main = document.getElementById('dash-main')
let dashCompanySlug = ''

const showToast = (msg, isError = false) => {
  toast.textContent = msg; toast.classList.remove('hidden')
  toast.classList.toggle('border-rose-500', isError); toast.classList.toggle('border-slate-700', !isError)
  setTimeout(() => toast.classList.add('hidden'), 3500)
}
const api = async (path, opts = {}) => {
  const r = await fetch(path, { headers:{'Content-Type':'application/json'}, credentials:'same-origin', ...opts })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || 'Request failed')
  return d
}
const toSlug = (t) => (t||'').toLowerCase().trim().replace(/&/g,'and').replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,80)
const fmtDate = (d) => { if (!d) return '—'; return new Date(d).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) }
const fmtDateTime = (d) => { if (!d) return '—'; return new Date(d).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) }
const statusBadge = (s) => {
  const m = { approved:{cls:'dash-badge--green',icon:'fa-circle-check',label:'Approved'}, pending:{cls:'dash-badge--yellow',icon:'fa-clock',label:'Pending'}, rejected:{cls:'dash-badge--red',icon:'fa-circle-xmark',label:'Rejected'} }
  const x = m[s] || {cls:'',icon:'fa-question',label:s}
  return `<span class="dash-badge ${esc(x.cls)}"><i class="fa-solid ${esc(x.icon)}"></i> ${esc(x.label)}</span>`
}

// Sidebar nav
const sidebarItems = document.querySelectorAll('.dash-sidebar-item[data-section]')
const allSections = document.querySelectorAll('.dash-section')
const sidebarToggle = document.getElementById('dash-sidebar-toggle')
const sidebar = document.getElementById('dash-sidebar')

const switchSection = (name) => {
  sidebarItems.forEach(i => i.classList.toggle('dash-sidebar-active', i.getAttribute('data-section') === name))
  allSections.forEach(s => s.classList.toggle('hidden', s.id !== `section-${name}`))
  main.scrollTo({top:0,behavior:'smooth'})
  if (sidebar) sidebar.classList.remove('dash-sidebar-open')
}
sidebarItems.forEach(i => i.addEventListener('click', () => { const s = i.getAttribute('data-section'); if (s) switchSection(s) }))
document.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => switchSection(b.getAttribute('data-goto'))))
if (sidebarToggle) sidebarToggle.addEventListener('click', () => sidebar.classList.toggle('dash-sidebar-open'))

const initDashboard = async () => {
  try {
    const d = await api('/api/mp/auth/me')
    if (!d.user) {
      main.innerHTML = `<section class="dash-section"><div class="dash-login-required"><i class="fas fa-lock"></i><h2>Login Required</h2><p>Please log in to access your dashboard.</p><a href="/marketplace" class="dash-btn-primary">Go to Login</a></div></section>`
      return
    }
    if (d.user.role === 'admin') { window.location.href = '/marketplace/admin'; return }
    const name = d.user.company_name || 'Company'
    dashCompanySlug = toSlug(name)
    document.getElementById('dash-company-name').textContent = name
    const tn = document.getElementById('dash-topbar-name'); if (tn) tn.textContent = name
    const av = document.getElementById('dash-avatar'); if (av) av.textContent = name.charAt(0).toUpperCase()
    await Promise.all([loadStats(), loadListings(), loadStage(), loadInquiries(), loadReviews(), loadProfile(), loadRecentInquiries()])
  } catch (err) { showToast('Failed to load dashboard', true) }
}

const loadStats = async () => {
  try {
    const s = await api('/api/mp/dashboard/stats')
    document.getElementById('stat-total').textContent = s.total_listings
    document.getElementById('stat-approved').textContent = s.approved
    document.getElementById('stat-pending').textContent = s.pending
    document.getElementById('stat-views').textContent = (s.total_views||0).toLocaleString()
    document.getElementById('stat-inquiries').textContent = s.total_inquiries
    document.getElementById('stat-rating').textContent = s.avg_rating ? `${esc(s.avg_rating)} / 5` : 'No reviews'
  } catch {}
}

const loadListings = async () => {
  const c = document.getElementById('dash-listings-table')
  try {
    const d = await api('/api/mp/dashboard/listings'); const ls = d.listings || []
    dashListings = ls; renderTodo()
    if (!ls.length) { c.innerHTML = `<div class="dash-empty"><i class="fas fa-box-open"></i><p>No listings yet</p><p class="text-xs text-slate-500">Submit from <a href="/marketplace" class="text-emerald-400">marketplace</a>.</p></div>`; return }
    c.innerHTML = `<table class="dash-table"><thead><tr><th>Product</th><th>Status</th><th>Views</th><th>Inquiries</th><th>Rating</th><th>Submitted</th><th>Actions</th></tr></thead><tbody>${ls.map(l => `<tr><td><div class="dash-product-cell">${l.product_image_url ? `<img src="${esc(l.product_image_url)}" class="dash-product-thumb">` : `<div class="dash-product-thumb-placeholder"><i class="fas fa-box"></i></div>`}<div><p class="font-medium text-sm">${esc(l.product_name)}</p><p class="text-xs text-slate-500 truncate" style="max-width:200px">${esc((l.description || '').slice(0,60))}...</p></div></div></td><td>${statusBadge(l.status)}${(l.missing || []).length ? `<button type="button" class="dash-badge dash-badge--yellow mt-1" style="display:inline-flex;cursor:pointer;border:0" data-edit-id="${esc(l.id)}" title="Missing: ${esc(l.missing.join(', '))}"><i class="fa-solid fa-exclamation-circle"></i> ${l.missing.length} to add</button>` : ''}</td><td class="text-sm">${(l.view_count||0).toLocaleString()}</td><td class="text-sm">${l.inquiry_count||0}</td><td class="text-sm">${l.avg_rating ? l.avg_rating + ' <i class="fas fa-star text-amber-400" style="font-size:0.65rem"></i>' : '—'}</td><td class="text-xs text-slate-400">${fmtDate(l.created_at)}</td><td><div class="dash-actions"><button class="dash-action-btn" data-edit-id="${esc(l.id)}"><i class="fas fa-pen-to-square"></i></button>${l.status==='approved' ? `<a href="/marketplace/listing/${encodeURIComponent(l.company_slug || dashCompanySlug)}/${encodeURIComponent(l.product_slug || toSlug(l.product_name))}" class="dash-action-btn" target="_blank" rel="noopener"><i class="fas fa-arrow-up-right-from-square"></i></a>` : ''}</div></td></tr>`).join('')}</tbody></table>`
    c.querySelectorAll('[data-edit-id]').forEach(b => b.addEventListener('click', () => openEditModal(b.getAttribute('data-edit-id'))))
    renderCompleteness(ls)
  } catch { c.innerHTML = '<p class="text-sm text-rose-400">Failed to load listings</p>' }
}

// The server lists what each listing is missing; the overview says so up front, with
// a button straight into the edit form, so nobody has to find it in the table.
const renderCompleteness = (ls) => {
  const box = document.getElementById('dash-complete'); if (!box) return
  const incomplete = (ls || []).filter(l => (l.missing || []).length)
  if (!incomplete.length) { box.classList.add('hidden'); box.innerHTML = ''; return }
  box.innerHTML = `<h3 style="color:#9a3412"><i class="fas fa-exclamation-circle mr-2"></i>Complete your listing${incomplete.length === 1 ? '' : 's'}</h3>
    <p class="text-sm mb-2" style="color:#7c2d12">Listings with a logo, a product image and clear pricing get more views and inquiries.</p>
    ${incomplete.map(l => `<div class="flex gap-3 items-center justify-between flex-wrap" style="padding:10px 0;border-top:1px solid #fed7aa">
      <div><p class="font-medium text-sm">${esc(l.product_name)}</p><p class="text-xs" style="color:#9a3412">Missing: ${esc(l.missing.join(', '))}</p></div>
      <button type="button" class="mp-btn-primary text-sm py-2 px-4" data-complete-id="${esc(l.id)}">Add details</button>
    </div>`).join('')}`
  box.classList.remove('hidden')
  box.querySelectorAll('[data-complete-id]').forEach(b => b.addEventListener('click', () => openEditModal(b.getAttribute('data-complete-id'))))
}

// ── Images (same handling as the listing form) ──
const RASTER_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const IMAGE_KINDS = { logo: { maxDim: 512, type: 'image/png' }, photo: { maxDim: 1600, type: 'image/jpeg' }, avatar: { maxDim: 600, type: 'image/jpeg' } }
const isSvgFile = (f) => f.type === 'image/svg+xml' || /\.svg$/i.test(f.name || '')
const checkImageFile = (f, kind) => {
  const svg = isSvgFile(f)
  if (svg && kind !== 'logo') return `${f.name}: SVG works for the logo only. Use a PNG or JPG here.`
  if (!svg && !RASTER_TYPES.includes(f.type)) return `${f.name}: please use a PNG, JPG, WebP${kind === 'logo' ? ' or SVG' : ''} image.`
  if (f.size > 25 * 1024 * 1024) return `${f.name} is over 25MB. Please use a smaller image.`
  return ''
}
const prepareImage = async (file, kind) => {
  const problem = checkImageFile(file, kind); if (problem) throw new Error(problem)
  const svg = isSvgFile(file)
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error(`${file.name} could not be read as an image.`)); i.src = url })
    const { maxDim, type } = IMAGE_KINDS[kind]
    let w = img.naturalWidth, h = img.naturalHeight
    if (!w || !h) { w = maxDim; h = maxDim }
    if (!svg && Math.max(w, h) <= maxDim && file.size <= 1024 * 1024) return file
    const scale = svg ? maxDim / Math.max(w, h) : Math.min(1, maxDim / Math.max(w, h))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w * scale)); canvas.height = Math.max(1, Math.round(h * scale))
    const ctx = canvas.getContext('2d')
    if (type === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height) }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    let blob = null
    try { blob = await new Promise(r => canvas.toBlob(r, type, 0.86)) } catch { blob = null }
    if (!blob) throw new Error(`${file.name} could not be converted. Please upload a PNG or JPG instead.`)
    return new File([blob], (file.name || 'image').replace(/\.[^.]+$/, '') + (type === 'image/png' ? '.png' : '.jpg'), { type })
  } finally { URL.revokeObjectURL(url) }
}
const uploadImage = async (file, kind) => {
  const fd = new FormData(); fd.append('file', await prepareImage(file, kind))
  const r = await fetch('/api/mp/uploads', { method: 'POST', body: fd, credentials: 'same-origin' })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`${file.name}: ${d.error || 'upload failed. Please try again.'}`)
  return d.url
}
const safeImageUrl = (u) => /^\/api\/mp\/uploads\/\d+$/.test(String(u || '')) ? u : ''

// ── Stage talk ──
// Every confirmed stand includes an Innovation Talk & Showcase slot. The exhibitor
// fills in the talk and the speaker here; the organisers set the time, which then
// shows here and in the event app's programme.
let dashListings = null
let stageInfo = null

const loadStage = async () => {
  try { stageInfo = await api('/api/mp/dashboard/stage-talk') } catch { stageInfo = null }
  const eligible = !!(stageInfo && stageInfo.eligible)
  const nav = document.getElementById('dash-nav-stage'); if (nav) nav.classList.toggle('hidden', !eligible)
  if (eligible) renderStage()
  renderTodo()
}

const renderStage = () => {
  const s = stageInfo
  document.getElementById('stage-slot').innerHTML = s.slot
    ? `<p class="text-sm"><i class="fas fa-calendar-check mr-1" style="color:#059669"></i> Your time on stage: <strong>${esc(s.slot)}</strong></p>
       <p class="text-xs text-slate-500 mt-1">${s.in_programme ? 'Your talk is in the event app programme. Anything you change here shows there straight away.' : 'Add your topic and speaker below and your talk appears in the event app programme.'}</p>`
    : `<p class="text-sm"><i class="fas fa-microphone-alt mr-1" style="color:#FF6B00"></i> Your booth includes ${s.minutes ? `a <strong>${esc(s.minutes)}-minute</strong>` : 'an'} Innovation Talk &amp; Showcase slot.</p>
       <p class="text-xs text-slate-500 mt-1">Fill in the details below. The organisers set the time, and it shows here.</p>`
  // Never overwrite a box the exhibitor is typing in.
  const set = (id, v) => { const el = document.getElementById(id); if (el && document.activeElement !== el) el.value = v || '' }
  set('stage-topic', s.topic); set('stage-showcase', s.showcase); set('stage-speaker', s.speaker_name); set('stage-speaker-title', s.speaker_title); set('stage-bio', s.speaker_bio)
  const img = document.getElementById('stage-photo-preview'), u = safeImageUrl(s.speaker_photo_url)
  if (u) { img.src = u; img.classList.remove('hidden') } else { img.removeAttribute('src'); img.classList.add('hidden') }
}

// Exhibitors see what their booth includes as two steps, so nothing depends on
// finding the right menu item.
const renderTodo = () => {
  const box = document.getElementById('dash-todo'); if (!box) return
  if (!stageInfo || !stageInfo.eligible || dashListings === null) { box.classList.add('hidden'); return }
  const s = stageInfo, listed = dashListings.length > 0, live = dashListings.some(l => l.status === 'approved')
  const step = (done, title, note, action) => `<div class="flex gap-3 items-center justify-between flex-wrap" style="padding:12px 0;border-top:1px solid #e5e7eb">
      <div class="flex gap-3 items-center" style="flex:1;min-width:200px"><i class="fas ${done ? 'fa-check-circle' : 'fa-circle'}" style="font-size:20px;color:${done ? '#059669' : '#cbd5e1'}"></i>
        <div><p class="font-medium text-sm">${title}</p><p class="text-xs text-slate-500">${note}</p></div></div>
      ${action}</div>`
  box.innerHTML = '<h3><i class="fas fa-clipboard-list mr-2"></i>Your exhibitor to-do list</h3>'
    + step(listed, 'List your AI product',
      live ? 'Live on the AI Marketplace.' : listed ? 'In review. We email you as soon as it is live.' : 'Free with your booth. Takes about five minutes.',
      listed ? '' : '<a href="/marketplace?submit=true" class="mp-btn-primary text-sm py-2 px-4" style="display:inline-block;text-decoration:none">List your product</a>')
    + step(s.details_complete, `Add your stage talk${s.minutes ? ` (${esc(s.minutes)} minutes)` : ''}`,
      s.slot ? `On stage ${esc(s.slot)}.` : s.details_complete ? 'Details saved. Your time on stage will show here.' : 'Your topic, what you will showcase, and the speaker with a photo.',
      `<button type="button" class="${s.details_complete ? 'mp-btn-secondary' : 'mp-btn-primary'} text-sm py-2 px-4" data-goto="stage">${s.details_complete ? 'Edit' : 'Add details'}</button>`)
    // Every exhibitor is also a delegate: the pass is made when the organisers email them.
    + (s.delegate ? step(s.delegate.signed_in, 'Network as a delegate',
      `Your exhibitor pass is also a delegate pass. Sign in to the event app with ${esc(s.delegate.email)}; we email you a code.`,
      '<a href="/app" class="mp-btn-secondary text-sm py-2 px-4" style="display:inline-block;text-decoration:none">Open the event app</a>') : '')
  box.classList.remove('hidden')
  box.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => switchSection(b.getAttribute('data-goto'))))
}

const stageForm = document.getElementById('stage-form')
if (stageForm) stageForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  const btn = stageForm.querySelector('button[type="submit"]'), html = btn.innerHTML
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Saving...'
  try {
    const fields = {}
    stageForm.querySelectorAll('[name]').forEach(el => { fields[el.name] = el.value })
    const photo = document.getElementById('stage-photo-file')
    if (photo.files[0]) fields.speaker_photo_url = await uploadImage(photo.files[0], 'avatar')
    stageInfo = await api('/api/mp/dashboard/stage-talk', { method: 'PUT', body: JSON.stringify(fields) })
    photo.value = ''
    renderStage(); renderTodo()
    showToast(stageInfo.details_complete ? 'Saved. Thank you!' : 'Saved. Add the topic and the speaker name to complete it.')
  } catch (err) { showToast(err.message, true) }
  finally { btn.disabled = false; btn.innerHTML = html }
})

const loadRecentInquiries = async () => {
  const c = document.getElementById('dash-recent-inquiries'); if (!c) return
  try {
    const d = await api('/api/mp/dashboard/inquiries'); const inqs = (d.inquiries||[]).slice(0,5)
    if (!inqs.length) { c.innerHTML = `<div class="dash-empty" style="padding:1.5rem"><i class="fas fa-envelope" style="font-size:1.3rem"></i><p>No inquiries yet</p></div>`; return }
    c.innerHTML = `<table class="dash-table"><thead><tr><th>From</th><th>Product</th><th>Message</th><th>Date</th></tr></thead><tbody>${inqs.map(i => `<tr><td><span class="text-sm font-medium">${esc(i.inquirer_name || '—')}</span><p class="text-xs text-slate-500">${esc(i.inquirer_company || '')}</p></td><td><span class="text-xs dash-badge dash-badge--blue">${esc(i.product_name)}</span></td><td><p class="text-sm text-slate-300" style="max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc((i.inquirer_message||'—').slice(0,80))}</p></td><td class="text-xs text-slate-400">${fmtDate(i.created_at)}</td></tr>`).join('')}</tbody></table>`
  } catch { c.innerHTML = '<p class="text-sm text-rose-400">Failed</p>' }
}

const loadInquiries = async () => {
  const c = document.getElementById('dash-inquiries')
  try {
    const d = await api('/api/mp/dashboard/inquiries'); const inqs = d.inquiries || []
    if (!inqs.length) { c.innerHTML = `<div class="dash-empty"><i class="fas fa-envelope"></i><p>No inquiries yet</p></div>`; return }
    c.innerHTML = `<table class="dash-table"><thead><tr><th>From</th><th>Company</th><th>Product</th><th>Message</th><th>Date</th><th>Contact</th></tr></thead><tbody>${inqs.map(i => `<tr><td class="text-sm font-medium">${esc(i.inquirer_name || '—')}</td><td class="text-sm">${esc(i.inquirer_company || '—')}</td><td><span class="text-xs dash-badge dash-badge--blue">${esc(i.product_name)}</span></td><td><p class="text-sm text-slate-300" style="max-width:250px;white-space:pre-wrap">${esc((i.inquirer_message || '').slice(0,150))}</p></td><td class="text-xs text-slate-400">${fmtDateTime(i.created_at)}</td><td><div class="dash-contact-links">${i.inquirer_email ? `<a href="mailto:${esc(i.inquirer_email)}" class="dash-contact-link"><i class="fas fa-envelope"></i></a>` : ''}${i.inquirer_phone ? `<a href="tel:${esc(i.inquirer_phone)}" class="dash-contact-link"><i class="fas fa-phone"></i></a>` : ''}</div></td></tr>`).join('')}</tbody></table>`
  } catch { c.innerHTML = '<p class="text-sm text-rose-400">Failed</p>' }
}

const loadReviews = async () => {
  const c = document.getElementById('dash-reviews')
  try {
    const d = await api('/api/mp/dashboard/reviews'); const revs = d.reviews || []
    if (!revs.length) { c.innerHTML = `<div class="dash-empty"><i class="fas fa-star"></i><p>No reviews yet</p></div>`; return }
    c.innerHTML = `<table class="dash-table"><thead><tr><th>Product</th><th>Rating</th><th>Comment</th><th>Date</th></tr></thead><tbody>${revs.map(r => `<tr><td class="text-sm font-medium">${esc(r.product_name)}</td><td>${'<i class="fas fa-star text-amber-400"></i>'.repeat(r.rating)}${'<i class="far fa-star text-slate-600"></i>'.repeat(5-r.rating)}</td><td class="text-sm text-slate-300" style="max-width:300px">${esc(r.comment || '—')}</td><td class="text-xs text-slate-400">${fmtDate(r.created_at)}</td></tr>`).join('')}</tbody></table>`
  } catch { c.innerHTML = '<p class="text-sm text-rose-400">Failed</p>' }
}

const loadProfile = async () => {
  try {
    const d = await api('/api/mp/dashboard/profile'); const p = d.profile; if (!p) return
    document.getElementById('profile-company-name').value = p.company_name || ''
    document.getElementById('profile-email').value = p.email || ''
    document.getElementById('profile-role').value = p.role === 'admin' ? 'Admin' : 'Company'
    document.getElementById('profile-since').value = fmtDate(p.created_at)
  } catch {}
}

document.getElementById('dash-profile-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  try {
    const r = await api('/api/mp/dashboard/profile', { method:'PUT', body:JSON.stringify({company_name:document.getElementById('profile-company-name').value}) })
    showToast(r.requeued ? 'Profile updated. Your listings are back in review under the new name.' : 'Profile updated')
    loadListings(); loadStats()
    const nn = document.getElementById('profile-company-name').value; dashCompanySlug = toSlug(nn)
    document.getElementById('dash-company-name').textContent = nn
    const tn = document.getElementById('dash-topbar-name'); if (tn) tn.textContent = nn
    const av = document.getElementById('dash-avatar'); if (av) av.textContent = nn.charAt(0).toUpperCase()
  } catch (err) { showToast(err.message, true) }
})

// Edit modal
const editModal = document.getElementById('edit-listing-modal')
const editForm = document.getElementById('edit-listing-form')

const openEditModal = async (id) => {
  try {
    const d = await api(`/api/mp/dashboard/listings/${id}`); const l = d.listing
    document.getElementById('edit-listing-id').value = l.id
    document.getElementById('edit-product-name').value = l.product_name||''
    document.getElementById('edit-description').value = l.description||''
    document.getElementById('edit-target-customer').value = l.target_customer||''
    document.getElementById('edit-pricing-type').value = l.pricing_type||''
    document.getElementById('edit-pricing-details').value = l.pricing_details||''
    document.getElementById('edit-tags').value = l.tags||''
    document.getElementById('edit-target-industry').value = l.target_industry||''
    document.getElementById('edit-ai-category').value = l.ai_category||''
    document.getElementById('edit-website-url').value = l.website_url||''
    document.getElementById('edit-product-url').value = l.product_url||''
    document.getElementById('edit-sales-name').value = l.sales_contact_name||''
    document.getElementById('edit-sales-email').value = l.sales_contact_email||''
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || '' }
    setVal('edit-sales-phone', l.sales_contact_phone); setVal('edit-demo-url', l.demo_url); setVal('edit-video-url', l.video_url)
    setVal('edit-access-info', l.access_info); setVal('edit-use-cases', l.use_cases); setVal('edit-innovation', l.innovation)
    const preview = (id, url) => { const el = document.getElementById(id); if (!el) return; const u = safeImageUrl(url); if (u) { el.src = u; el.classList.remove('hidden') } else { el.removeAttribute('src'); el.classList.add('hidden') } }
    preview('edit-logo-preview', l.logo_url); preview('edit-image-preview', l.product_image_url)
    document.getElementById('edit-logo-file').value = ''; document.getElementById('edit-image-file').value = ''
    // Listing rows from the table carry the missing list; this one came from the detail route, so ask the table's data.
    const fromTable = (await api('/api/mp/dashboard/listings')).listings.find(x => String(x.id) === String(l.id))
    const missing = fromTable?.missing || []
    const note = document.getElementById('edit-missing')
    if (missing.length) { note.innerHTML = `<strong>Still missing:</strong> ${esc(missing.join(', '))}`; note.classList.remove('hidden') } else { note.classList.add('hidden'); note.innerHTML = '' }
    document.getElementById('edit-review-note').classList.toggle('hidden', l.status !== 'approved')
    editModal.classList.remove('hidden')
  } catch { showToast('Failed to load listing', true) }
}

document.getElementById('edit-modal-close').addEventListener('click', () => editModal.classList.add('hidden'))
document.getElementById('edit-cancel').addEventListener('click', () => editModal.classList.add('hidden'))
editModal.addEventListener('click', (e) => { if (e.target === editModal) editModal.classList.add('hidden') })

editForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  const id = document.getElementById('edit-listing-id').value
  const fields = {}
  editForm.querySelectorAll('[name]').forEach(el => { if (el.name && el.name !== 'id' && el.value !== undefined) fields[el.name] = el.value })
  const saveBtn = editForm.querySelector('button[type="submit"]'); const saveHTML = saveBtn ? saveBtn.innerHTML : ''
  if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Saving...' }
  try {
    const logoFile = document.getElementById('edit-logo-file').files[0]
    const imageFile = document.getElementById('edit-image-file').files[0]
    if (logoFile) fields.logo_url = await uploadImage(logoFile, 'logo')
    if (imageFile) fields.product_image_url = await uploadImage(imageFile, 'photo')
    const r = await api(`/api/mp/dashboard/listings/${id}`, { method:'PUT', body:JSON.stringify(fields) })
    editModal.classList.add('hidden')
    showToast(r.changed ? 'Saved. The listing is in review and goes live once approved.' : 'No changes to save')
    await Promise.all([loadStats(), loadListings()])
  } catch (err) { showToast(err.message, true) }
  finally { if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = saveHTML } }
})

// Show a chosen image before it is uploaded.
;[['edit-logo-file', 'edit-logo-preview', 'logo'], ['edit-image-file', 'edit-image-preview', 'photo'], ['stage-photo-file', 'stage-photo-preview', 'avatar']].forEach(([inputId, previewId, kind]) => {
  const input = document.getElementById(inputId), preview = document.getElementById(previewId)
  if (!input || !preview) return
  input.addEventListener('change', () => {
    const f = input.files[0]; if (!f) return
    const problem = checkImageFile(f, kind)
    if (problem) { showToast(problem, true); input.value = ''; return }
    preview.src = URL.createObjectURL(f); preview.classList.remove('hidden')
  })
})

document.getElementById('dash-refresh-listings').addEventListener('click', async () => {
  await Promise.all([loadStats(), loadListings(), loadStage(), loadInquiries(), loadReviews(), loadRecentInquiries()])
  showToast('Refreshed')
})

document.getElementById('dash-logout').addEventListener('click', async () => {
  await api('/api/mp/auth/logout', { method:'POST' })
  window.location.href = '/marketplace'
})

initDashboard()
