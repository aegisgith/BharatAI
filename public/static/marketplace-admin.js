// Bharat AI Marketplace — Super Admin Dashboard JS
const toast = document.getElementById('dash-toast')
const main = document.getElementById('dash-main')
const showToast = (msg, isError = false) => { toast.textContent = msg; toast.classList.remove('hidden'); toast.classList.toggle('border-rose-500', isError); toast.classList.toggle('border-slate-700', !isError); setTimeout(() => toast.classList.add('hidden'), 3500) }
const api = async (path, opts = {}) => { const r = await fetch(path, { headers:{'Content-Type':'application/json'}, credentials:'same-origin', ...opts }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error||'Request failed'); return d }
const fmtDate = (d) => { if (!d) return '—'; return new Date(d).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) }
const statusBadge = (s) => {
  const m = { approved:{cls:'dash-badge--green',icon:'fa-circle-check',label:'Approved'}, pending:{cls:'dash-badge--yellow',icon:'fa-clock',label:'Pending'}, rejected:{cls:'dash-badge--red',icon:'fa-circle-xmark',label:'Rejected'} }
  const x = m[s]||{cls:'',icon:'fa-question',label:s}
  return `<span class="dash-badge ${x.cls}"><i class="fa-solid ${x.icon}"></i> ${x.label}</span>`
}

// Sidebar
const sidebarItems = document.querySelectorAll('.dash-sidebar-item[data-section]')
const allSections = document.querySelectorAll('.dash-section')
const sidebarToggle = document.getElementById('dash-sidebar-toggle')
const sidebar = document.getElementById('dash-sidebar')
const switchSection = (n) => { sidebarItems.forEach(i => i.classList.toggle('dash-sidebar-active', i.getAttribute('data-section')===n)); allSections.forEach(s => s.classList.toggle('hidden', s.id!==`section-${n}`)); main.scrollTo({top:0,behavior:'smooth'}); if(sidebar) sidebar.classList.remove('dash-sidebar-open') }
sidebarItems.forEach(i => i.addEventListener('click', () => { const s = i.getAttribute('data-section'); if(s) switchSection(s) }))
if(sidebarToggle) sidebarToggle.addEventListener('click', () => sidebar.classList.toggle('dash-sidebar-open'))

const initAdmin = async () => {
  try {
    const d = await api('/api/mp/auth/me')
    if (!d.user || d.user.role !== 'admin') {
      main.innerHTML = `<section class="dash-section"><div class="dash-login-required"><i class="fas fa-lock"></i><h2>Admin Access Required</h2><p>Please log in as admin.</p><a href="/marketplace" class="dash-btn-primary">Go to Login</a></div></section>`
      return
    }
    await Promise.all([loadStats(), loadAllListings(), loadPendingListings(), loadInquiries()])
  } catch { showToast('Failed to load', true) }
}

const loadStats = async () => {
  try {
    const s = await api('/api/mp/admin/stats')
    document.getElementById('stat-total').textContent = s.total_listings
    document.getElementById('stat-approved').textContent = s.approved
    document.getElementById('stat-pending').textContent = s.pending
    document.getElementById('stat-rejected').textContent = s.rejected
    document.getElementById('stat-companies').textContent = s.total_companies
    document.getElementById('stat-inquiries').textContent = s.total_inquiries
  } catch {}
}

const loadAllListings = async () => {
  const c = document.getElementById('admin-all-listings')
  try {
    const d = await api('/api/mp/admin/listings'); const ls = d.listings || []
    if (!ls.length) { c.innerHTML = '<p class="text-slate-400">No listings yet.</p>'; return }
    c.innerHTML = `<div class="overflow-x-auto"><table class="dash-table"><thead><tr><th>Product</th><th>Company</th><th>Status</th><th>Views</th><th>Submitted</th><th>Actions</th></tr></thead><tbody>${ls.map(l => `<tr><td class="text-sm font-medium">${l.product_name}</td><td class="text-sm">${l.company_name}</td><td>${statusBadge(l.status)}</td><td class="text-sm">${(l.view_count||0).toLocaleString()}</td><td class="text-xs text-slate-400">${fmtDate(l.created_at)}</td><td><div class="dash-actions">${l.status!=='approved' ? `<button class="dash-action-btn" title="Approve" onclick="adminAction(${l.id},'approved')"><i class="fas fa-check text-emerald-400"></i></button>` : ''}${l.status!=='rejected' ? `<button class="dash-action-btn" title="Reject" onclick="adminAction(${l.id},'rejected')"><i class="fas fa-times text-rose-400"></i></button>` : ''}${l.status!=='pending' ? `<button class="dash-action-btn" title="Set Pending" onclick="adminAction(${l.id},'pending')"><i class="fas fa-clock text-amber-400"></i></button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>`
  } catch { c.innerHTML = '<p class="text-rose-400">Failed</p>' }
}

const loadPendingListings = async () => {
  const c = document.getElementById('admin-pending-listings')
  try {
    const d = await api('/api/mp/admin/listings?status=pending'); const ls = d.listings || []
    if (!ls.length) { c.innerHTML = '<p class="text-slate-400">No pending submissions.</p>'; return }
    c.innerHTML = ls.map(l => `<div class="dash-card"><div class="flex justify-between items-start"><div><h4 class="font-medium">${l.product_name}</h4><p class="text-sm text-slate-400">${l.company_name}</p><p class="text-sm text-slate-300 mt-1">${l.description}</p><p class="text-xs text-slate-500 mt-1">Industry: ${l.target_industry||'—'} · Category: ${l.ai_category||'—'}</p></div></div><div class="flex gap-2 mt-3"><button class="mp-btn-primary text-sm py-2 px-4" onclick="adminAction(${l.id},'approved')"><i class="fas fa-check mr-1"></i>Approve</button><button class="mp-btn-secondary text-sm py-2 px-4" onclick="adminAction(${l.id},'rejected')"><i class="fas fa-times mr-1"></i>Reject</button></div></div>`).join('')
  } catch { c.innerHTML = '<p class="text-rose-400">Failed</p>' }
}

window.adminAction = async (id, status) => {
  try {
    await api(`/api/mp/admin/listings/${id}`, { method:'PATCH', body:JSON.stringify({status}) })
    showToast(`Listing ${status}`)
    await Promise.all([loadStats(), loadAllListings(), loadPendingListings()])
  } catch (err) { showToast(err.message, true) }
}

const loadInquiries = async () => {
  const c = document.getElementById('admin-inquiries')
  try {
    const d = await api('/api/mp/admin/inquiries'); const inqs = d.inquiries || []
    if (!inqs.length) { c.innerHTML = '<p class="text-slate-400">No inquiries yet.</p>'; return }
    c.innerHTML = `<div class="overflow-x-auto"><table class="dash-table"><thead><tr><th>From</th><th>Email</th><th>Product</th><th>Company</th><th>Message</th><th>Date</th><th>Actions</th></tr></thead><tbody>${inqs.map(i => `<tr><td class="text-sm font-medium">${i.inquirer_name||'—'}</td><td class="text-sm">${i.inquirer_email||'—'}</td><td><span class="dash-badge dash-badge--blue text-xs">${i.product_name}</span></td><td class="text-sm">${i.company_name||'—'}</td><td class="text-sm" style="max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${i.inquirer_message||'—'}</td><td class="text-xs text-slate-400">${fmtDate(i.created_at)}</td><td><button class="dash-action-btn" onclick="deleteInquiry(${i.id})"><i class="fas fa-trash text-rose-400"></i></button></td></tr>`).join('')}</tbody></table></div>`
  } catch { c.innerHTML = '<p class="text-rose-400">Failed</p>' }
}

window.deleteInquiry = async (id) => {
  if (!confirm('Delete this inquiry?')) return
  try { await api(`/api/mp/admin/inquiries/${id}`, { method:'DELETE' }); showToast('Deleted'); loadInquiries() } catch (err) { showToast(err.message, true) }
}

// Bulk upload
const bulkZone = document.getElementById('bulk-upload-zone')
const bulkInput = document.getElementById('bulk-file-input')
const bulkPreview = document.getElementById('bulk-preview')
const bulkPreviewTable = document.getElementById('bulk-preview-table')
const bulkCount = document.getElementById('bulk-count')
const bulkUploadBtn = document.getElementById('bulk-upload-btn')
const bulkCancelBtn = document.getElementById('bulk-cancel-btn')
const bulkResult = document.getElementById('bulk-result')
let bulkData = []

if (bulkZone) {
  bulkZone.addEventListener('click', () => bulkInput.click())
  bulkInput.addEventListener('change', () => { if (bulkInput.files[0]) parseBulkFile(bulkInput.files[0]) })
}

const parseBulkFile = async (file) => {
  const text = await file.text()
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) { showToast('File must have header + data rows', true); return }
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'))
  bulkData = lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''))
    const obj = {}; headers.forEach((h, i) => { obj[h] = vals[i] || '' }); return obj
  }).filter(r => r.product_name && r.company_name && r.description)

  if (!bulkData.length) { showToast('No valid rows found (need product_name, company_name, description)', true); return }
  bulkCount.textContent = bulkData.length
  bulkPreviewTable.innerHTML = `<table class="dash-table"><thead><tr>${headers.slice(0,5).map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${bulkData.slice(0,5).map(r => `<tr>${headers.slice(0,5).map(h => `<td class="text-sm">${(r[h]||'').slice(0,40)}</td>`).join('')}</tr>`).join('')}${bulkData.length > 5 ? `<tr><td colspan="${Math.min(headers.length,5)}" class="text-sm text-slate-400">...and ${bulkData.length-5} more rows</td></tr>` : ''}</tbody></table>`
  bulkPreview.classList.remove('hidden'); bulkResult.classList.add('hidden')
}

if (bulkUploadBtn) {
  bulkUploadBtn.addEventListener('click', async () => {
    bulkUploadBtn.disabled = true; bulkUploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Uploading...'
    try {
      const r = await api('/api/mp/admin/listings/bulk', { method:'POST', body:JSON.stringify({listings:bulkData}) })
      bulkResult.classList.remove('hidden')
      bulkResult.innerHTML = `<p class="text-emerald-400"><i class="fas fa-check-circle mr-1"></i> Uploaded: ${r.uploaded} | Failed: ${r.failed}</p>`
      bulkPreview.classList.add('hidden'); bulkData = []
      await Promise.all([loadStats(), loadAllListings()])
    } catch (err) { showToast(err.message, true) }
    bulkUploadBtn.disabled = false; bulkUploadBtn.innerHTML = '<i class="fas fa-upload mr-1"></i>Upload All'
  })
}
if (bulkCancelBtn) bulkCancelBtn.addEventListener('click', () => { bulkPreview.classList.add('hidden'); bulkData = []; bulkInput.value = '' })

// Refresh
const adminRefresh = document.getElementById('admin-refresh')
if (adminRefresh) adminRefresh.addEventListener('click', async () => {
  await Promise.all([loadStats(), loadAllListings(), loadPendingListings(), loadInquiries()])
  showToast('Refreshed')
})

// Logout
document.getElementById('dash-logout').addEventListener('click', async () => {
  await api('/api/mp/auth/logout', { method:'POST' })
  window.location.href = '/marketplace'
})

initAdmin()
