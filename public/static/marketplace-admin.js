// Bharat AI Marketplace — Super Admin Dashboard JS

// Everything this page renders is typed by a company that registered with no
// checks, or by an anonymous inquirer, and it all went into innerHTML raw - so
// a listing description or inquiry message ran as script in the admin's session.
const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const safeUrl = (v) => {
  const s = String(v == null ? '' : v).trim()
  if (/^\/api\/mp\/uploads\/\d+$/.test(s)) return s
  try { const u = new URL(s); return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : '' } catch { return '' }
}
const num = (v) => Number.parseInt(v, 10) || 0

const toast = document.getElementById('dash-toast')
const main = document.getElementById('dash-main')
const showToast = (msg, isError = false) => { toast.textContent = msg; toast.classList.remove('hidden'); toast.classList.toggle('border-rose-500', isError); toast.classList.toggle('border-slate-700', !isError); clearTimeout(showToast.t); showToast.t = setTimeout(() => toast.classList.add('hidden'), 3500) }
const api = async (path, opts = {}) => { const r = await fetch(path, { headers:{'Content-Type':'application/json'}, credentials:'same-origin', ...opts }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error||'Request failed'); return d }
const fmtDate = (d) => { if (!d) return '—'; return new Date(String(d).replace(' ', 'T') + (String(d).includes('Z') ? '' : 'Z')).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) }
const statusBadge = (s) => {
  const m = { approved:{cls:'dash-badge--green',icon:'fa-circle-check',label:'Approved'}, pending:{cls:'dash-badge--yellow',icon:'fa-clock',label:'Pending'}, rejected:{cls:'dash-badge--red',icon:'fa-circle-xmark',label:'Rejected'} }
  const x = m[s]||{cls:'',icon:'fa-question',label:s}
  return `<span class="dash-badge ${x.cls}"><i class="fa-solid ${x.icon}"></i> ${esc(x.label)}</span>`
}

// Sidebar
const sidebarItems = document.querySelectorAll('.dash-sidebar-item[data-section]')
const allSections = document.querySelectorAll('.dash-section')
const sidebarToggle = document.getElementById('dash-sidebar-toggle')
const sidebar = document.getElementById('dash-sidebar')
const switchSection = (n) => { sidebarItems.forEach(i => i.classList.toggle('dash-sidebar-active', i.getAttribute('data-section')===n)); allSections.forEach(s => s.classList.toggle('hidden', s.id!==`section-${n}`)); main.scrollTo({top:0,behavior:'smooth'}); if(sidebar) sidebar.classList.remove('dash-sidebar-open') }
sidebarItems.forEach(i => i.addEventListener('click', () => { const s = i.getAttribute('data-section'); if(s) switchSection(s) }))
if(sidebarToggle) sidebarToggle.addEventListener('click', () => sidebar.classList.toggle('dash-sidebar-open'))

let exhibitors = []

const initAdmin = async () => {
  try {
    const d = await api('/api/mp/auth/me')
    if (!d.user || d.user.role !== 'admin') {
      main.innerHTML = `<section class="dash-section"><div class="dash-login-required"><i class="fas fa-lock"></i><h2>Admin Access Required</h2><p>Log in with the marketplace admin account using "Exhibitor Login" on the marketplace page.</p><a href="/marketplace" class="dash-btn-primary">Go to Login</a></div></section>`
      return
    }
    try { exhibitors = (await api('/api/mp/admin/exhibitors')).exhibitors || [] } catch { exhibitors = [] }
    await Promise.all([loadStats(), loadAllListings(), loadPendingListings(), loadInquiries()])
    // The queue is what an admin comes here for; open it when there is something in it.
    if (num(document.getElementById('stat-pending').textContent) > 0) switchSection('pending')
  } catch { showToast('Failed to load', true) }
}

const loadStats = async () => {
  try {
    const s = await api('/api/mp/admin/stats')
    document.getElementById('stat-total').textContent = num(s.total_listings)
    document.getElementById('stat-approved').textContent = num(s.approved)
    document.getElementById('stat-pending').textContent = num(s.pending)
    document.getElementById('stat-rejected').textContent = num(s.rejected)
    document.getElementById('stat-companies').textContent = num(s.total_companies)
    document.getElementById('stat-inquiries').textContent = num(s.total_inquiries)
    const pendingNav = document.querySelector('.dash-sidebar-item[data-section="pending"]')
    if (pendingNav) pendingNav.innerHTML = `<i class="fas fa-clock"></i> Pending Review${num(s.pending) ? ` (${num(s.pending)})` : ''}`
  } catch {}
}

const actionButtons = (l) => {
  const id = num(l.id)
  return `${l.status!=='approved' ? `<button class="dash-action-btn" title="Approve" data-action="approved" data-id="${id}"><i class="fas fa-check text-emerald-400"></i></button>` : ''}${l.status!=='rejected' ? `<button class="dash-action-btn" title="Reject" data-action="rejected" data-id="${id}"><i class="fas fa-times text-rose-400"></i></button>` : ''}${l.status!=='pending' ? `<button class="dash-action-btn" title="Set Pending" data-action="pending" data-id="${id}"><i class="fas fa-clock text-amber-400"></i></button>` : ''}`
}

const publicUrl = (l) => `/marketplace/listing/${encodeURIComponent(l.company_slug || '')}/${encodeURIComponent(l.product_slug || '')}`

const loadAllListings = async () => {
  const c = document.getElementById('admin-all-listings')
  try {
    const d = await api('/api/mp/admin/listings'); const ls = d.listings || []
    if (!ls.length) { c.innerHTML = '<p class="text-slate-400">No listings yet.</p>'; return }
    c.innerHTML = `<div class="overflow-x-auto"><table class="dash-table"><thead><tr><th>Product</th><th>Company</th><th>Status</th><th>Views</th><th>Submitted</th><th>Actions</th></tr></thead><tbody>${ls.map(l => `<tr><td class="text-sm font-medium">${l.status === 'approved' ? `<a href="${esc(publicUrl(l))}" target="_blank" rel="noopener">${esc(l.product_name)}</a>` : esc(l.product_name)}</td><td class="text-sm">${esc(l.company_name)}<p class="text-xs text-slate-500">${esc(l.account_email || '')}</p></td><td>${statusBadge(l.status)}</td><td class="text-sm">${num(l.view_count).toLocaleString()}</td><td class="text-xs text-slate-400">${fmtDate(l.created_at)}</td><td><div class="dash-actions">${actionButtons(l)}</div></td></tr>`).join('')}</tbody></table></div>`
  } catch { c.innerHTML = '<p class="text-rose-400">Failed</p>' }
}

// Every non-empty field of a submission, so it can be judged before it goes public.
const REVIEW_FIELDS = [
  ['target_customer','Target customer'],['target_industry','Industries'],['ai_category','AI categories'],['tags','Tags'],
  ['innovation','Innovation'],['use_cases','Use cases'],['pricing_type','Pricing model'],['pricing_details','Pricing details'],
  ['access_info','Access'],['founder_name','Founder / CEO'],['cto_name','CTO'],['contact_name','Primary contact'],
  ['company_registration','Registration / CIN'],['company_phone','Company phone'],['company_address','Address'],
  ['sales_contact_name','Sales contact'],['sales_contact_email','Sales email'],['sales_contact_phone','Sales phone'],
  ['current_customers','Current customers'],['integration_requirements','Integration'],['supported_platforms','Platforms'],
  ['tech_stack','Tech stack'],['security_protocols','Security'],['case_studies','Case studies'],
  ['certifications_compliance','Certifications'],['support_offering','Support'],['sla_details','SLA'],['onboarding_process','Onboarding'],
]
const LINK_FIELDS = [['website_url','Website'],['product_url','Product'],['demo_url','Demo'],['video_url','Video']]

const exhibitorPicker = (l) => {
  if (!exhibitors.length) return ''
  const opts = exhibitors.map(e => `<option value="${num(e.id)}"${num(e.id) === num(l.exhibitor_id) ? ' selected' : ''}>${esc(e.company_name)}${e.booth_number ? ` — Booth ${esc(e.booth_number)}` : ''}</option>`).join('')
  return `<label class="text-xs text-slate-400 block mt-3">Exhibitor / booth
    <select class="form-input mt-1" data-link-exhibitor="${num(l.id)}"><option value="">Not an exhibitor</option>${opts}</select></label>`
}

const pendingCard = (l) => {
  const logo = safeUrl(l.logo_url), image = safeUrl(l.product_image_url)
  const shots = String(l.screenshot_urls || '').split(',').map(s => safeUrl(s.trim())).filter(Boolean)
  const rows = REVIEW_FIELDS.filter(([k]) => String(l[k] || '').trim()).map(([k, label]) => `<tr><td class="text-xs text-slate-400" style="white-space:nowrap;vertical-align:top;padding-right:12px">${esc(label)}</td><td class="text-sm" style="white-space:pre-wrap">${esc(l[k])}</td></tr>`).join('')
  const links = LINK_FIELDS.map(([k, label]) => { const u = safeUrl(l[k]); return u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer" class="text-emerald-400 text-sm">${esc(label)} ↗</a>` : '' }).filter(Boolean).join(' · ')
  const booth = l.exhibitor_id ? `Linked to exhibitor <strong>${esc(l.exhibitor_company || '#' + num(l.exhibitor_id))}</strong>${(l.exhibitor_booth || l.booth_number) ? `, booth ${esc(l.exhibitor_booth || l.booth_number)}` : ', no booth number yet'}. Check it is the same company.` : 'Not linked to an exhibitor.'
  return `<div class="dash-card">
    <div class="flex gap-3 items-center">
      ${logo ? `<img src="${esc(logo)}" alt="" style="width:48px;height:48px;object-fit:contain;border-radius:8px;background:#fff">` : ''}
      <div><h4 class="font-medium">${esc(l.product_name)}</h4><p class="text-sm text-slate-400">${esc(l.company_name)} · ${esc(l.account_email || 'no account email')} · submitted ${fmtDate(l.created_at)}${l.updated_at && l.updated_at !== l.created_at ? `, edited ${fmtDate(l.updated_at)}` : ''}</p></div>
    </div>
    <p class="text-sm text-slate-300 mt-2" style="white-space:pre-wrap">${esc(l.description)}</p>
    ${links ? `<p class="mt-2">${links}</p>` : ''}
    ${(image || shots.length) ? `<div class="flex gap-2 flex-wrap mt-2">${[image, ...shots].filter(Boolean).map(u => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="" style="height:72px;border-radius:6px"></a>`).join('')}</div>` : ''}
    ${rows ? `<details class="mt-2"><summary class="text-sm text-slate-400" style="cursor:pointer">All submitted details</summary><table class="mt-2">${rows}</table></details>` : ''}
    <p class="text-xs text-slate-400 mt-2">${booth}</p>
    ${exhibitorPicker(l)}
    <div class="flex gap-2 mt-3"><button class="mp-btn-primary text-sm py-2 px-4" data-action="approved" data-id="${num(l.id)}"><i class="fas fa-check mr-1"></i>Approve</button><button class="mp-btn-secondary text-sm py-2 px-4" data-action="rejected" data-id="${num(l.id)}"><i class="fas fa-times mr-1"></i>Reject</button></div>
  </div>`
}

const loadPendingListings = async () => {
  const c = document.getElementById('admin-pending-listings')
  try {
    const d = await api('/api/mp/admin/listings?status=pending'); const ls = d.listings || []
    if (!ls.length) { c.innerHTML = '<p class="text-slate-400">No pending submissions.</p>'; return }
    c.innerHTML = `<p class="text-sm text-slate-400 mb-2">Approving publishes the listing on /marketplace and emails the company. Rejecting asks for an optional reason, which is emailed to them.</p>` + ls.map(pendingCard).join('')
  } catch { c.innerHTML = '<p class="text-rose-400">Failed</p>' }
}

const adminAction = async (id, status) => {
  let reason = ''
  if (status === 'rejected') {
    reason = window.prompt('Reason for rejecting (emailed to the company, optional):', '')
    if (reason === null) return
  }
  try {
    await api(`/api/mp/admin/listings/${num(id)}`, { method:'PATCH', body:JSON.stringify({ status, reason }) })
    showToast(status === 'approved' ? 'Approved: now live, company notified' : status === 'rejected' ? 'Rejected: company notified' : 'Moved back to pending')
    await Promise.all([loadStats(), loadAllListings(), loadPendingListings()])
  } catch (err) { showToast(err.message, true) }
}

const linkExhibitor = async (id, exhibitorId) => {
  try {
    await api(`/api/mp/admin/listings/${num(id)}`, { method:'PATCH', body:JSON.stringify({ exhibitor_id: exhibitorId ? num(exhibitorId) : null }) })
    showToast(exhibitorId ? 'Booth linked' : 'Exhibitor link removed')
    await Promise.all([loadAllListings(), loadPendingListings()])
  } catch (err) { showToast(err.message, true) }
}

// Delegated, so no listing value is ever written into an inline handler.
main.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action][data-id]')
  if (btn) adminAction(btn.getAttribute('data-id'), btn.getAttribute('data-action'))
  const del = e.target.closest('[data-delete-inquiry]')
  if (del) deleteInquiry(del.getAttribute('data-delete-inquiry'))
})
main.addEventListener('change', (e) => {
  const sel = e.target.closest('[data-link-exhibitor]')
  if (sel) linkExhibitor(sel.getAttribute('data-link-exhibitor'), sel.value)
})

const loadInquiries = async () => {
  const c = document.getElementById('admin-inquiries')
  try {
    const d = await api('/api/mp/admin/inquiries'); const inqs = d.inquiries || []
    if (!inqs.length) { c.innerHTML = '<p class="text-slate-400">No inquiries yet.</p>'; return }
    c.innerHTML = `<div class="overflow-x-auto"><table class="dash-table"><thead><tr><th>From</th><th>Email</th><th>Product</th><th>Company</th><th>Message</th><th>Date</th><th>Actions</th></tr></thead><tbody>${inqs.map(i => `<tr><td class="text-sm font-medium">${esc(i.inquirer_name||'—')}</td><td class="text-sm">${esc(i.inquirer_email||'—')}</td><td><span class="dash-badge dash-badge--blue text-xs">${esc(i.product_name)}</span></td><td class="text-sm">${esc(i.company_name||'—')}</td><td class="text-sm" style="max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(i.inquirer_message||'')}">${esc(i.inquirer_message||'—')}</td><td class="text-xs text-slate-400">${fmtDate(i.created_at)}</td><td><button class="dash-action-btn" data-delete-inquiry="${num(i.id)}"><i class="fas fa-trash text-rose-400"></i></button></td></tr>`).join('')}</tbody></table></div>`
  } catch { c.innerHTML = '<p class="text-rose-400">Failed</p>' }
}

const deleteInquiry = async (id) => {
  if (!confirm('Delete this inquiry?')) return
  try { await api(`/api/mp/admin/inquiries/${num(id)}`, { method:'DELETE' }); showToast('Deleted'); loadInquiries() } catch (err) { showToast(err.message, true) }
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
  bulkPreviewTable.innerHTML = `<table class="dash-table"><thead><tr>${headers.slice(0,5).map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${bulkData.slice(0,5).map(r => `<tr>${headers.slice(0,5).map(h => `<td class="text-sm">${esc((r[h]||'').slice(0,40))}</td>`).join('')}</tr>`).join('')}${bulkData.length > 5 ? `<tr><td colspan="${Math.min(headers.length,5)}" class="text-sm text-slate-400">...and ${bulkData.length-5} more rows</td></tr>` : ''}</tbody></table>`
  bulkPreview.classList.remove('hidden'); bulkResult.classList.add('hidden')
}

if (bulkUploadBtn) {
  bulkUploadBtn.addEventListener('click', async () => {
    bulkUploadBtn.disabled = true; bulkUploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Uploading...'
    try {
      const r = await api('/api/mp/admin/listings/bulk', { method:'POST', body:JSON.stringify({listings:bulkData}) })
      bulkResult.classList.remove('hidden')
      bulkResult.innerHTML = `<p class="text-emerald-400"><i class="fas fa-check-circle mr-1"></i> Uploaded: ${num(r.uploaded)} | Failed: ${num(r.failed)}</p>`
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
