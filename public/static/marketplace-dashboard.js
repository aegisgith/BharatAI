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
  return `<span class="dash-badge ${x.cls}"><i class="fa-solid ${x.icon}"></i> ${x.label}</span>`
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
    await Promise.all([loadStats(), loadListings(), loadInquiries(), loadReviews(), loadProfile(), loadRecentInquiries()])
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
    document.getElementById('stat-rating').textContent = s.avg_rating ? `${s.avg_rating} / 5` : 'No reviews'
  } catch {}
}

const loadListings = async () => {
  const c = document.getElementById('dash-listings-table')
  try {
    const d = await api('/api/mp/dashboard/listings'); const ls = d.listings || []
    if (!ls.length) { c.innerHTML = `<div class="dash-empty"><i class="fas fa-box-open"></i><p>No listings yet</p><p class="text-xs text-slate-500">Submit from <a href="/marketplace" class="text-emerald-400">marketplace</a>.</p></div>`; return }
    c.innerHTML = `<table class="dash-table"><thead><tr><th>Product</th><th>Status</th><th>Views</th><th>Inquiries</th><th>Rating</th><th>Submitted</th><th>Actions</th></tr></thead><tbody>${ls.map(l => `<tr><td><div class="dash-product-cell">${l.product_image_url ? `<img src="${l.product_image_url}" class="dash-product-thumb">` : `<div class="dash-product-thumb-placeholder"><i class="fas fa-box"></i></div>`}<div><p class="font-medium text-sm">${l.product_name}</p><p class="text-xs text-slate-500 truncate" style="max-width:200px">${(l.description||'').slice(0,60)}...</p></div></div></td><td>${statusBadge(l.status)}</td><td class="text-sm">${(l.view_count||0).toLocaleString()}</td><td class="text-sm">${l.inquiry_count||0}</td><td class="text-sm">${l.avg_rating ? l.avg_rating + ' <i class="fas fa-star text-amber-400" style="font-size:0.65rem"></i>' : '—'}</td><td class="text-xs text-slate-400">${fmtDate(l.created_at)}</td><td><div class="dash-actions"><button class="dash-action-btn" data-edit-id="${l.id}"><i class="fas fa-pen-to-square"></i></button>${l.status==='approved' ? `<a href="/marketplace/listing/${dashCompanySlug}/${l.product_slug||toSlug(l.product_name)}" class="dash-action-btn" target="_blank"><i class="fas fa-arrow-up-right-from-square"></i></a>` : ''}</div></td></tr>`).join('')}</tbody></table>`
    c.querySelectorAll('[data-edit-id]').forEach(b => b.addEventListener('click', () => openEditModal(b.getAttribute('data-edit-id'))))
  } catch { c.innerHTML = '<p class="text-sm text-rose-400">Failed to load listings</p>' }
}

const loadRecentInquiries = async () => {
  const c = document.getElementById('dash-recent-inquiries'); if (!c) return
  try {
    const d = await api('/api/mp/dashboard/inquiries'); const inqs = (d.inquiries||[]).slice(0,5)
    if (!inqs.length) { c.innerHTML = `<div class="dash-empty" style="padding:1.5rem"><i class="fas fa-envelope" style="font-size:1.3rem"></i><p>No inquiries yet</p></div>`; return }
    c.innerHTML = `<table class="dash-table"><thead><tr><th>From</th><th>Product</th><th>Message</th><th>Date</th></tr></thead><tbody>${inqs.map(i => `<tr><td><span class="text-sm font-medium">${i.inquirer_name||'—'}</span><p class="text-xs text-slate-500">${i.inquirer_company||''}</p></td><td><span class="text-xs dash-badge dash-badge--blue">${i.product_name}</span></td><td><p class="text-sm text-slate-300" style="max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${(i.inquirer_message||'—').slice(0,80)}</p></td><td class="text-xs text-slate-400">${fmtDate(i.created_at)}</td></tr>`).join('')}</tbody></table>`
  } catch { c.innerHTML = '<p class="text-sm text-rose-400">Failed</p>' }
}

const loadInquiries = async () => {
  const c = document.getElementById('dash-inquiries')
  try {
    const d = await api('/api/mp/dashboard/inquiries'); const inqs = d.inquiries || []
    if (!inqs.length) { c.innerHTML = `<div class="dash-empty"><i class="fas fa-envelope"></i><p>No inquiries yet</p></div>`; return }
    c.innerHTML = `<table class="dash-table"><thead><tr><th>From</th><th>Company</th><th>Product</th><th>Message</th><th>Date</th><th>Contact</th></tr></thead><tbody>${inqs.map(i => `<tr><td class="text-sm font-medium">${i.inquirer_name||'—'}</td><td class="text-sm">${i.inquirer_company||'—'}</td><td><span class="text-xs dash-badge dash-badge--blue">${i.product_name}</span></td><td><p class="text-sm text-slate-300" style="max-width:250px;white-space:pre-wrap">${(i.inquirer_message||'').slice(0,150)}</p></td><td class="text-xs text-slate-400">${fmtDateTime(i.created_at)}</td><td><div class="dash-contact-links">${i.inquirer_email ? `<a href="mailto:${i.inquirer_email}" class="dash-contact-link"><i class="fas fa-envelope"></i></a>` : ''}${i.inquirer_phone ? `<a href="tel:${i.inquirer_phone}" class="dash-contact-link"><i class="fas fa-phone"></i></a>` : ''}</div></td></tr>`).join('')}</tbody></table>`
  } catch { c.innerHTML = '<p class="text-sm text-rose-400">Failed</p>' }
}

const loadReviews = async () => {
  const c = document.getElementById('dash-reviews')
  try {
    const d = await api('/api/mp/dashboard/reviews'); const revs = d.reviews || []
    if (!revs.length) { c.innerHTML = `<div class="dash-empty"><i class="fas fa-star"></i><p>No reviews yet</p></div>`; return }
    c.innerHTML = `<table class="dash-table"><thead><tr><th>Product</th><th>Rating</th><th>Comment</th><th>Date</th></tr></thead><tbody>${revs.map(r => `<tr><td class="text-sm font-medium">${r.product_name}</td><td>${'<i class="fas fa-star text-amber-400"></i>'.repeat(r.rating)}${'<i class="far fa-star text-slate-600"></i>'.repeat(5-r.rating)}</td><td class="text-sm text-slate-300" style="max-width:300px">${r.comment||'—'}</td><td class="text-xs text-slate-400">${fmtDate(r.created_at)}</td></tr>`).join('')}</tbody></table>`
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
    await api('/api/mp/dashboard/profile', { method:'PUT', body:JSON.stringify({company_name:document.getElementById('profile-company-name').value}) })
    showToast('Profile updated')
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
  editForm.querySelectorAll('[name]').forEach(el => { if (el.name && el.value !== undefined) fields[el.name] = el.value })
  try {
    const r = await api(`/api/mp/dashboard/listings/${id}`, { method:'PUT', body:JSON.stringify(fields) })
    editModal.classList.add('hidden')
    showToast(r.new_status === 'pending' ? 'Updated & re-submitted for review' : 'Updated')
    await Promise.all([loadStats(), loadListings()])
  } catch (err) { showToast(err.message, true) }
})

document.getElementById('dash-refresh-listings').addEventListener('click', async () => {
  await Promise.all([loadStats(), loadListings(), loadInquiries(), loadReviews(), loadRecentInquiries()])
  showToast('Refreshed')
})

document.getElementById('dash-logout').addEventListener('click', async () => {
  await api('/api/mp/auth/logout', { method:'POST' })
  window.location.href = '/marketplace'
})

initDashboard()
