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
// Opened from the /admin panel's sidebar, this page uses that panel's sign-in: a
// staff account travels as a cookie on its own, and the shared admin password lives
// in this tab's sessionStorage, so it is sent the way the panel sends it. The
// operator name goes along so approvals are audited under the right person.
const eventAdminHeaders = () => {
  const h = {}
  try { const t = sessionStorage.getItem('tc_admin_token'); if (t) h['Authorization'] = 'Bearer ' + t } catch {}
  try { const op = localStorage.getItem('tc_admin_operator'); if (op) h['X-Admin-Actor'] = op } catch {}
  return h
}
const api = async (path, opts = {}) => { const r = await fetch(path, { credentials:'same-origin', ...opts, headers:{ 'Content-Type':'application/json', ...eventAdminHeaders(), ...(opts.headers || {}) } }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error||'Request failed'); return d }
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
    const marketplaceAccountAdmin = !!(d.user && d.user.role === 'admin')
    const viaEventAdmin = !marketplaceAccountAdmin && !!d.event_admin
    if (!viaEventAdmin && !marketplaceAccountAdmin) {
      main.innerHTML = `<section class="dash-section"><div class="dash-login-required"><i class="fas fa-lock"></i><h2>Admin Access Required</h2><p>Sign in to the event admin panel and open AI Marketplace from its sidebar.</p><a href="/admin" class="dash-btn-primary">Open event admin</a></div></section>`
      return
    }
    if (viaEventAdmin) {
      // Nothing to log out of here: the session belongs to the event admin panel.
      const out = document.getElementById('dash-logout')
      if (out) { out.innerHTML = '<i class="fas fa-arrow-left mr-1"></i> Back to event admin'; out.classList.remove('text-rose-400'); out.dataset.back = '1' }
      const info = document.querySelector('.dash-topbar-info span')
      if (info) info.textContent = 'Marketplace Admin · signed in through event admin'
    }
    try { exhibitors = (await api('/api/mp/admin/exhibitors')).exhibitors || [] } catch { exhibitors = [] }
    await Promise.all([loadStats(), loadAllListings(), loadPendingListings(), loadInquiries(), loadExhibitors()])
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

const missingBadge = (l) => (l.missing || []).length
  ? `<span class="dash-badge dash-badge--yellow" title="Missing: ${esc(l.missing.join(', '))}"><i class="fa-solid fa-exclamation-circle"></i> ${l.missing.length} missing</span>`
  : '<span class="dash-badge dash-badge--green"><i class="fa-solid fa-circle-check"></i> Complete</span>'

const actionButtons = (l) => {
  const id = num(l.id)
  const remind = (l.missing || []).length ? `<button class="dash-action-btn" title="Email the company what is missing" data-remind="${id}" data-company="${esc(l.company_name)}" data-missing="${esc(l.missing.join(', '))}"><i class="fas fa-envelope text-blue-400"></i></button>` : ''
  return `${remind}${l.status!=='approved' ? `<button class="dash-action-btn" title="Approve" data-action="approved" data-id="${id}"><i class="fas fa-check text-emerald-400"></i></button>` : ''}${l.status!=='rejected' ? `<button class="dash-action-btn" title="Reject" data-action="rejected" data-id="${id}"><i class="fas fa-times text-rose-400"></i></button>` : ''}${l.status!=='pending' ? `<button class="dash-action-btn" title="Set Pending" data-action="pending" data-id="${id}"><i class="fas fa-clock text-amber-400"></i></button>` : ''}`
}

const publicUrl = (l) => `/marketplace/listing/${encodeURIComponent(l.company_slug || '')}/${encodeURIComponent(l.product_slug || '')}`

const loadAllListings = async () => {
  const c = document.getElementById('admin-all-listings')
  try {
    const d = await api('/api/mp/admin/listings'); const ls = d.listings || []
    if (!ls.length) { c.innerHTML = '<p class="text-slate-400">No listings yet.</p>'; return }
    c.innerHTML = `<div class="overflow-x-auto"><table class="dash-table"><thead><tr><th>Product</th><th>Company</th><th>Status</th><th>Details</th><th>Views</th><th>Submitted</th><th>Actions</th></tr></thead><tbody>${ls.map(l => `<tr><td class="text-sm font-medium">${l.status === 'approved' ? `<a href="${esc(publicUrl(l))}" target="_blank" rel="noopener">${esc(l.product_name)}</a>` : esc(l.product_name)}</td><td class="text-sm">${esc(l.company_name)}<p class="text-xs text-slate-500">${esc(l.account_email || '')}</p></td><td>${statusBadge(l.status)}</td><td>${missingBadge(l)}</td><td class="text-sm">${num(l.view_count).toLocaleString()}</td><td class="text-xs text-slate-400">${fmtDate(l.created_at)}</td><td><div class="dash-actions">${actionButtons(l)}</div></td></tr>`).join('')}</tbody></table></div>`
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
    ${(l.missing || []).length ? `<p class="text-xs mt-2" style="color:#9a3412"><i class="fa-solid fa-exclamation-circle"></i> Missing: ${esc(l.missing.join(', '))}. Approving still works; the approval email lists these for the company.</p>` : ''}
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
  const remind = e.target.closest('[data-remind]')
  if (remind) sendReminder(remind)
  const invite = e.target.closest('[data-invite]')
  if (invite) inviteExhibitor(invite)
  const link = e.target.closest('[data-link]')
  if (link) sendSignInLink(link)
})

const sendReminder = async (btn) => {
  const company = btn.getAttribute('data-company'), missing = btn.getAttribute('data-missing')
  if (!confirm(`Email ${company} a reminder to add: ${missing}?`)) return
  btn.disabled = true
  try {
    await api(`/api/mp/admin/listings/${num(btn.getAttribute('data-remind'))}/remind`, { method: 'POST', body: '{}' })
    showToast(`Reminder sent to ${company}`)
  } catch (err) { showToast(err.message, true) }
  finally { btn.disabled = false }
}
main.addEventListener('change', (e) => {
  const sel = e.target.closest('[data-link-exhibitor]')
  if (sel) linkExhibitor(sel.getAttribute('data-link-exhibitor'), sel.value)
})

// ── Exhibitors ──
// Who among the paid exhibitors has taken up the free listing, and who has not been
// asked. The invitation is sent from here, one exhibitor or all eligible at once.
const INVITE_STATE = {
  'no-email': { cls: '', icon: 'fa-envelope-open', label: 'No email' },
  unsubscribed: { cls: 'dash-badge--red', icon: 'fa-ban', label: 'Unsubscribed' },
  live: { cls: 'dash-badge--green', icon: 'fa-circle-check', label: 'Listing live' },
  pending: { cls: 'dash-badge--yellow', icon: 'fa-clock', label: 'Listing in review' },
  invited: { cls: 'dash-badge--blue', icon: 'fa-paper-plane', label: 'Invited' },
  registered: { cls: 'dash-badge--blue', icon: 'fa-user', label: 'Registered, no listing' },
  new: { cls: '', icon: 'fa-circle', label: 'Not invited' },
}
const inviteBadge = (e) => {
  const s = INVITE_STATE[e.state] || INVITE_STATE.new
  return `<span class="dash-badge ${s.cls}"><i class="fa-solid ${s.icon}"></i> ${esc(s.label)}</span>`
}

const loadExhibitors = async () => {
  const c = document.getElementById('admin-exhibitors'); if (!c) return
  try {
    const d = await api('/api/mp/admin/exhibitor-invites')
    const rows = d.exhibitors || [], s = d.summary || {}
    const sum = document.getElementById('invite-summary')
    if (sum) sum.textContent = `${num(s.total)} exhibitors · ${num(s.live)} listing · ${num(s.can_invite)} can be invited now · ${num(s.can_link)} can be sent a sign-in link · ${num(s.no_email)} without an email address`
    const btn = document.getElementById('invite-all')
    if (btn) { btn.disabled = !num(s.can_invite); btn.dataset.count = String(num(s.can_invite)) }
    const lbtn = document.getElementById('link-all')
    if (lbtn) { lbtn.disabled = !num(s.can_link); lbtn.dataset.count = String(num(s.can_link)) }
    if (!rows.length) { c.innerHTML = '<p class="text-slate-400">No exhibitors yet.</p>'; return }
    c.innerHTML = `<div class="overflow-x-auto"><table class="dash-table"><thead><tr><th>Company</th><th>Booth</th><th>Booth contact</th><th>Status</th><th>Last invited</th><th>Actions</th></tr></thead><tbody>${rows.map(e => `<tr>
      <td class="text-sm font-medium">${esc(e.company_name)}</td>
      <td class="text-sm">${esc(e.booth_number || '—')}</td>
      <td class="text-sm">${esc(e.contact_email || '—')}</td>
      <td>${inviteBadge(e)}</td>
      <td class="text-xs text-slate-400">${e.last_invited ? fmtDate(e.last_invited) : '—'}</td>
      <td><div class="dash-actions">${e.can_invite
        ? `<button class="dash-action-btn" title="Email this exhibitor the invitation" data-invite="${num(e.id)}" data-company="${esc(e.company_name)}" data-email="${esc(e.contact_email || '')}"><i class="fas fa-paper-plane text-blue-400"></i></button>` : ''}${e.can_link
        ? `<button class="dash-action-btn" title="Email this exhibitor a one-click sign-in link" data-link="${num(e.id)}" data-company="${esc(e.company_name)}" data-email="${esc(e.contact_email || '')}"><i class="fas fa-sign-in-alt text-emerald-400"></i></button>` : ''}${(!e.can_invite && !e.can_link)
        ? `<span class="text-xs text-slate-500">${esc(e.link_reason || e.reason || '')}</span>` : ''}</div></td></tr>`).join('')}</tbody></table></div>`
  } catch (err) { c.innerHTML = `<p class="text-rose-400">${esc(err.message)}</p>` }
}

const inviteExhibitor = async (btn) => {
  const company = btn.getAttribute('data-company'), email = btn.getAttribute('data-email')
  if (!confirm(`Email ${company} at ${email} an invitation to list on the AI Marketplace?`)) return
  btn.disabled = true
  try {
    await api(`/api/mp/admin/exhibitors/${num(btn.getAttribute('data-invite'))}/invite`, { method: 'POST', body: '{}' })
    showToast(`Invitation sent to ${company}`)
    await loadExhibitors()
  } catch (err) { showToast(err.message, true); btn.disabled = false }
}

const sendSignInLink = async (btn) => {
  const company = btn.getAttribute('data-company'), email = btn.getAttribute('data-email')
  if (!confirm(`Email ${company} at ${email} a one-click sign-in link ("your account is ready")?`)) return
  btn.disabled = true
  try {
    await api(`/api/mp/admin/exhibitors/${num(btn.getAttribute('data-link'))}/signin-link`, { method: 'POST', body: '{}' })
    showToast(`Sign-in link sent to ${company}`)
    await loadExhibitors()
  } catch (err) { showToast(err.message, true); btn.disabled = false }
}

// One email per request with a gap between them, the way the panel sender on /admin
// works: a burst of identical mail to the same domains lands in spam. The tab has to
// stay open; clicking the same button again stops after the one in flight. Each send
// still goes through the server's own checks, so a stale row is refused, not emailed.
const INVITE_GAP_MS = 30000
let pacedRun = null
const runPaced = async (btn, opts) => {
  if (pacedRun) { pacedRun.stop = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Stopping after this one...'; return }
  const rows = ((await api('/api/mp/admin/exhibitor-invites')).exhibitors || []).filter(opts.eligible)
  if (!rows.length) { showToast('Nobody is eligible right now'); return }
  if (!confirm(opts.confirm(rows.length))) return
  const html = btn.innerHTML
  const run = pacedRun = { stop: false }
  let sent = 0, failed = 0, i = 0
  try {
    for (const e of rows) {
      if (run.stop) break
      i++
      btn.innerHTML = `<i class="fas fa-spinner fa-spin mr-1"></i> Sending ${i} of ${rows.length} · ${esc(e.company_name)} — click to stop`
      try { await api(opts.url(e), { method: 'POST', body: '{}' }); sent++ }
      catch (err) { failed++; showToast(`${e.company_name}: ${err.message}`, true) }
      if (i < rows.length && !run.stop) await new Promise(r => setTimeout(r, INVITE_GAP_MS))
    }
    showToast(`${sent} ${opts.noun}${sent === 1 ? '' : 's'} sent${failed ? `, ${failed} failed` : ''}${run.stop ? ' (stopped)' : ''}`, !!failed)
  } catch (err) { showToast(err.message, true) }
  finally { pacedRun = null; btn.innerHTML = html; await loadExhibitors() }
}
const pace = `They go out one at a time, ${INVITE_GAP_MS / 1000} seconds apart, so keep this tab open.`
const inviteAllBtn = document.getElementById('invite-all')
if (inviteAllBtn) inviteAllBtn.addEventListener('click', () => runPaced(inviteAllBtn, {
  eligible: e => e.can_invite, noun: 'invitation', url: e => `/api/mp/admin/exhibitors/${num(e.id)}/invite`,
  confirm: n => `Email ${n} exhibitor${n === 1 ? '' : 's'} the invitation to list on the AI Marketplace? ${pace} Anyone already listing, invited this week, or unsubscribed is skipped.`,
}))
const linkAllBtn = document.getElementById('link-all')
if (linkAllBtn) linkAllBtn.addEventListener('click', () => runPaced(linkAllBtn, {
  eligible: e => e.can_link, noun: 'sign-in link', url: e => `/api/mp/admin/exhibitors/${num(e.id)}/signin-link`,
  confirm: n => `Email ${n} exhibitor${n === 1 ? '' : 's'} a one-click sign-in link ("your account is ready")? ${pace} Anyone already listing, sent a link today, or unsubscribed is skipped.`,
}))

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
  await Promise.all([loadStats(), loadAllListings(), loadPendingListings(), loadInquiries(), loadExhibitors()])
  showToast('Refreshed')
})

// Logout
document.getElementById('dash-logout').addEventListener('click', async (e) => {
  if (e.currentTarget.dataset.back) { window.location.href = '/admin'; return }
  await api('/api/mp/auth/logout', { method:'POST' })
  window.location.href = '/marketplace'
})

initAdmin()
