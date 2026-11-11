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
    await Promise.all([loadStats(), loadAllListings(), loadPendingListings(), loadInquiries(), loadExhibitors(), loadStageTalks(), loadTeams(), loadReports(), loadDirectory(), loadPartnersAdmin(), loadDelhiPromoAdmin()])
    // The queue is what an admin comes here for; open it when there is something in it.
    if (num(document.getElementById('stat-pending').textContent) > 0) switchSection('pending')
    // The report email's button opens /marketplace/admin#reports.
    if (location.hash === '#reports') switchSection('reports')
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
  const stageEdit = e.target.closest('[data-stage-edit]')
  if (stageEdit) openStageEditor(num(stageEdit.getAttribute('data-stage-edit')))
  const stageSave = e.target.closest('[data-stage-save]')
  if (stageSave) saveStageTime(stageSave)
  const stageClear = e.target.closest('[data-stage-clear]')
  if (stageClear) clearStageTime(stageClear)
  if (e.target.closest('[data-stage-cancel]')) closeStageEditor()
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
  registered: { cls: 'dash-badge--blue', icon: 'fa-user', label: 'Signed in, no listing' },
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
  const rows = (opts.list ? await opts.list() : ((await api('/api/mp/admin/exhibitor-invites')).exhibitors || [])).filter(opts.eligible)
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
  finally { pacedRun = null; btn.innerHTML = html; await (opts.after ? opts.after() : loadExhibitors()) }
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

// ── Teams & passes ──
// Who each exhibitor is bringing, filled in by their contact from the dashboard, and
// the passes issued from it. The organisers ask for the list, make exceptions to the
// number of passes, and download everyone for the badge desk and the speaker cards.
let teamsAdmin = []
const TEAM_PHOTO_OK = (u) => /^\/api\/mp\/uploads\/\d+$/.test(String(u || '')) || /^\/images\/talks\/[a-z0-9-]+\.webp$/.test(String(u || ''))
const teamPassChip = (m) => (m.pass && !/visitor/i.test(m.pass))
  ? `<span class="dash-badge dash-badge--green">${esc(m.own_pass ? 'Own: ' + m.pass : m.pass)}</span>`
  : `<span class="dash-badge dash-badge--yellow" title="${esc(m.pass_note || '')}">No pass</span>`

const loadTeams = async () => {
  const c = document.getElementById('admin-teams'); if (!c) return
  try {
    const d = await api('/api/mp/admin/teams')
    const askAll = document.getElementById('team-ask-all')
    if (!d.ready) {
      c.innerHTML = '<p class="text-slate-400">Teams start working once migration 0050 has been run on the database: <code>npx wrangler d1 execute bharatai-production --remote --file=./migrations/0050_exhibitor_team.sql</code></p>'
      if (askAll) askAll.disabled = true
      return
    }
    teamsAdmin = d.teams || []
    const dl = document.getElementById('team-deadline'); if (dl && document.activeElement !== dl) dl.value = d.deadline || ''
    const s = d.summary || {}
    const sum = document.getElementById('team-summary')
    if (sum) sum.textContent = `${num(s.companies)} exhibitors · ${num(s.with_team)} with a team · ${num(s.people)} people · ${num(s.with_pass)} with a pass · ${num(s.photos_missing)} photos missing · ${num(s.asked)} asked${num(s.no_number) ? ` · ${num(s.no_number)} need a number of passes` : ''}`
    const notAsked = teamsAdmin.filter(t => t.can_ask && !t.last_asked).length
    if (askAll) { askAll.disabled = !notAsked; askAll.innerHTML = `<i class="fas fa-paper-plane mr-1"></i> Ask everyone not asked yet (${notAsked})` }
    if (!teamsAdmin.length) { c.innerHTML = '<p class="text-slate-400">No exhibitors yet.</p>'; return }
    c.innerHTML = `<table class="dash-table"><thead><tr><th>Company</th><th>Booth</th><th>Contact</th><th>Passes</th><th>Team</th><th>Asked</th><th>Actions</th></tr></thead><tbody>${teamsAdmin.map(t => {
      const id = num(t.exhibitor_id)
      const passes = t.passes === null || t.passes === undefined ? '<span class="dash-badge dash-badge--yellow">Not set</span>' : `${num(t.used)} of ${num(t.passes)}${t.passes_source === 'set' ? ' <span class="text-xs text-slate-400">(set by you)</span>' : ''}`
      return `<tr>
        <td class="text-sm font-medium">${esc(t.company_name)}<div class="text-xs text-slate-400">${esc((t.packages || []).join(', '))}</div></td>
        <td class="text-sm">${esc(t.booth || '—')}</td>
        <td class="text-xs">${esc((t.contacts || []).join(', ') || '—')}</td>
        <td class="text-sm">${passes} <button class="dash-action-btn" style="display:inline-flex;vertical-align:middle" title="Change the number of passes" data-team-passes="${id}"><i class="fas fa-pen"></i></button></td>
        <td class="text-sm">${num(t.members.length)} ${t.members.length === 1 ? 'person' : 'people'}${t.speakers ? ` · ${num(t.speakers)} on stage` : ''}${t.photos_missing ? `<div class="text-xs" style="color:#92400E">${num(t.photos_missing)} photo${t.photos_missing === 1 ? '' : 's'} missing</div>` : ''}</td>
        <td class="text-xs text-slate-400">${t.last_asked ? fmtDate(t.last_asked) : '—'}</td>
        <td><div class="dash-actions">${t.can_ask
          ? `<button class="dash-action-btn" title="Email the contact: add your team" data-team-ask="${id}"><i class="fas fa-paper-plane text-blue-400"></i></button>`
          : `<span class="text-xs text-slate-500" style="align-self:center">${esc(t.ask_reason)}</span>`}
          <button class="dash-action-btn" title="Issue passes now" data-team-settle="${id}"><i class="fas fa-id-badge text-emerald-400"></i></button>
          ${t.members.length ? `<button class="dash-action-btn" title="Show the team" data-team-show="${id}"><i class="fas fa-users"></i></button>` : ''}</div></td></tr>
        <tr class="hidden" data-team-detail="${id}"><td colspan="7"><table class="dash-table team-admin-members"><thead><tr><th></th><th>Name</th><th>Designation · Company</th><th>Email · Mobile</th><th>Role</th><th>Pass</th><th></th></tr></thead><tbody>${t.members.map(m => `<tr>
          <td>${TEAM_PHOTO_OK(m.photo_url) ? `<a href="${esc(m.photo_url)}" target="_blank" rel="noopener"><img class="team-admin-photo" src="${esc(m.photo_url)}" alt=""></a>` : '<span class="dash-badge dash-badge--yellow">No photo</span>'}</td>
          <td>${esc(`${m.first_name} ${m.last_name}`.trim())}${safeUrl(m.linkedin_url) ? ` <a href="${esc(safeUrl(m.linkedin_url))}" target="_blank" rel="noopener" title="LinkedIn"><i class="fab fa-linkedin"></i></a>` : ''}</td>
          <td>${esc([m.designation, m.company].filter(Boolean).join(' · '))}</td>
          <td>${esc([m.email, m.mobile].filter(Boolean).join(' · ') || '—')}</td>
          <td>${[m.at_booth ? 'Booth' : '', m.speaker ? 'Stage' : ''].filter(Boolean).join(' + ')}</td>
          <td>${teamPassChip(m)}</td>
          <td><button class="dash-action-btn" title="Remove from the team" data-team-remove="${num(m.id)}" data-name="${esc(`${m.first_name} ${m.last_name}`.trim())}"><i class="fas fa-trash-alt text-rose-400"></i></button></td></tr>`).join('')}</tbody></table></td></tr>`
    }).join('')}</tbody></table>`
  } catch (err) { c.innerHTML = `<p class="text-rose-400">${esc(err.message)}</p>` }
}

const teamOf = (id) => teamsAdmin.find(t => num(t.exhibitor_id) === num(id))
main.addEventListener('click', async (e) => {
  const show = e.target.closest('[data-team-show]')
  if (show) { const row = document.querySelector(`[data-team-detail="${num(show.getAttribute('data-team-show'))}"]`); if (row) row.classList.toggle('hidden'); return }
  const passes = e.target.closest('[data-team-passes]')
  if (passes) {
    const t = teamOf(passes.getAttribute('data-team-passes')); if (!t) return
    const answer = prompt(`How many passes for ${t.company_name}?\n\nLeave it empty to use the booth's own number.`, t.passes_source === 'set' ? String(t.passes) : '')
    if (answer === null) return
    try {
      const r = await api(`/api/mp/admin/teams/${num(t.exhibitor_id)}/passes`, { method: 'PUT', body: JSON.stringify({ passes: answer.trim() === '' ? null : Number(answer.trim()) }) })
      showToast(`${t.company_name}: ${r.passes === null ? 'no number yet' : r.passes + ' passes'}. Passes updated.`)
      await loadTeams()
    } catch (err) { showToast(err.message, true) }
    return
  }
  const settle = e.target.closest('[data-team-settle]')
  if (settle) {
    const t = teamOf(settle.getAttribute('data-team-settle')); if (!t) return
    settle.disabled = true
    try { await api(`/api/mp/admin/teams/${num(t.exhibitor_id)}/settle`, { method: 'POST', body: '{}' }); showToast(`${t.company_name}: passes issued`); await loadTeams() }
    catch (err) { showToast(err.message, true); settle.disabled = false }
    return
  }
  const ask = e.target.closest('[data-team-ask]')
  if (ask) {
    const t = teamOf(ask.getAttribute('data-team-ask')); if (!t) return
    if (!confirm(`Email ${t.company_name} (${(t.contacts || []).join(', ')}) asking them to add their team and photos?`)) return
    ask.disabled = true
    try { await api(`/api/mp/admin/teams/${num(t.exhibitor_id)}/ask`, { method: 'POST', body: '{}' }); showToast(`Asked ${t.company_name}`); await loadTeams() }
    catch (err) { showToast(err.message, true); ask.disabled = false }
    return
  }
  const rm = e.target.closest('[data-team-remove]')
  if (rm) {
    if (!confirm(`Remove ${rm.getAttribute('data-name')} from this team? A pass the team gave them goes back to a free Visitor Pass.`)) return
    try { await api(`/api/mp/admin/teams/member/${num(rm.getAttribute('data-team-remove'))}`, { method: 'DELETE' }); showToast('Removed'); await loadTeams() }
    catch (err) { showToast(err.message, true) }
  }
})

const teamAskAllBtn = document.getElementById('team-ask-all')
if (teamAskAllBtn) teamAskAllBtn.addEventListener('click', () => runPaced(teamAskAllBtn, {
  list: async () => (await api('/api/mp/admin/teams')).teams || [],
  eligible: t => t.can_ask && !t.last_asked, noun: 'email', url: t => `/api/mp/admin/teams/${num(t.exhibitor_id)}/ask`, after: loadTeams,
  confirm: n => `Email ${n} exhibitor${n === 1 ? '' : 's'} asking them to add their team and photos? ${pace} Anyone already asked, without an email, or unsubscribed is skipped.`,
}))

const teamDeadlineForm = document.getElementById('team-deadline-form')
if (teamDeadlineForm) teamDeadlineForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  try {
    const r = await api('/api/mp/admin/teams/settings', { method: 'PUT', body: JSON.stringify({ deadline: document.getElementById('team-deadline').value }) })
    showToast(r.deadline ? `The email now says: Deadline ${r.deadline}` : 'The email now gives no deadline')
  } catch (err) { showToast(err.message, true) }
})

const teamCsvBtn = document.getElementById('team-csv')
if (teamCsvBtn) teamCsvBtn.addEventListener('click', async () => {
  try {
    const r = await fetch('/api/mp/admin/teams.csv', { credentials: 'same-origin', headers: eventAdminHeaders() })
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'Download failed') }
    const url = URL.createObjectURL(await r.blob())
    const a = document.createElement('a'); a.href = url; a.download = 'exhibitor-teams.csv'; document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  } catch (err) { showToast(err.message, true) }
})

// ── Partners in the app ──
// The sponsors and partners the app's Home tab shows under "Our partners": a short
// list the organisers keep here. The server checks every row again on Save.
let partnersAdmin = []
const partnerRow = (p, i) => `<div class="partner-row" data-partner-row style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr)) 40px;gap:8px;align-items:center;padding:8px 0;border-top:1px solid #e5e7eb">
    <input data-f="name" aria-label="Name, row ${i + 1}" maxlength="80" autocomplete="off" placeholder="Name, e.g. Jade Global" value="${esc(p.name)}">
    <input data-f="label" aria-label="Label, row ${i + 1}" maxlength="60" autocomplete="off" placeholder="Label, e.g. Panel Host Partner" value="${esc(p.label)}">
    <input data-f="logo" aria-label="Logo, row ${i + 1}" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="/images/exhibitors/jade-global.webp" value="${esc(p.logo)}">
    <input data-f="url" aria-label="Website, row ${i + 1}" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Website (optional)" value="${esc(p.url)}">
    <button type="button" class="dash-action-btn" title="Remove this partner" data-partner-remove="${i}"><i class="fas fa-trash-alt text-rose-400"></i></button>
  </div>`
// What is typed in the boxes now, so Add and Remove never lose an unsaved edit.
const readPartnerRows = () => [...document.querySelectorAll('[data-partner-row]')].map(r => {
  const o = {}; r.querySelectorAll('[data-f]').forEach(i => { o[i.getAttribute('data-f')] = i.value.trim() }); return o
})
const drawPartners = () => {
  const c = document.getElementById('partners-rows'); if (!c) return
  c.innerHTML = partnersAdmin.length ? partnersAdmin.map(partnerRow).join('') : '<p class="text-slate-400 text-sm">No partners are shown in the app yet.</p>'
}
const partnersMsg = (text, bad) => { const m = document.getElementById('partners-msg'); if (m) { m.textContent = text; m.style.color = bad ? '#b91c1c' : '#047857' } }
const loadPartnersAdmin = async () => {
  if (!document.getElementById('partners-rows')) return
  try { partnersAdmin = (await api('/api/mp/admin/partners')).partners || [] } catch { partnersAdmin = [] }
  drawPartners()
}
// ── The Delhi edition in the app ──
// The card the app's Home tab and the exhibitor dashboard show. A box left empty means
// the wording in grey, which is the server's own. The links are fixed on the server.
const DELHI_BOXES = { title: 'delhi-title', text: 'delhi-text', cta: 'delhi-cta', ex_title: 'delhi-ex-title', ex_text: 'delhi-ex-text', ex_cta: 'delhi-ex-cta' }
const delhiMsg = (text, bad) => { const m = document.getElementById('delhi-msg'); if (m) { m.textContent = text; m.style.color = bad ? '#b91c1c' : '#047857' } }
const drawDelhiPromo = (d) => {
  const on = document.getElementById('delhi-on'); if (!on || !d) return
  on.checked = !!d.on
  Object.keys(DELHI_BOXES).forEach(k => {
    const el = document.getElementById(DELHI_BOXES[k]); if (!el) return
    if (d.typed) el.value = d.typed[k] || ''
    if (d.defaults) el.placeholder = d.defaults[k] || ''
  })
  const o = document.getElementById('delhi-opened')
  if (o && d.opened) o.textContent = `Opened so far by ${d.opened.attendees} ${d.opened.attendees === 1 ? 'person' : 'people'} in the app and ${d.opened.exhibitors} exhibitor ${d.opened.exhibitors === 1 ? 'account' : 'accounts'}. Each one is counted once.`
}
const loadDelhiPromoAdmin = async () => {
  if (!document.getElementById('delhi-on')) return
  try { drawDelhiPromo(await api('/api/mp/admin/delhi-promo')) } catch { delhiMsg('Could not load the Delhi card. Refresh the page to try again.', true) }
}
const delhiSaveBtn = document.getElementById('delhi-save')
if (delhiSaveBtn) delhiSaveBtn.addEventListener('click', async () => {
  delhiMsg('')
  const body = { on: document.getElementById('delhi-on').checked }
  Object.keys(DELHI_BOXES).forEach(k => { body[k] = document.getElementById(DELHI_BOXES[k]).value })
  delhiSaveBtn.disabled = true
  try {
    const r = await api('/api/mp/admin/delhi-promo', { method: 'PUT', body: JSON.stringify(body) })
    drawDelhiPromo({ on: r.on, typed: r.typed })
    delhiMsg(r.on ? 'Saved. The Delhi card is shown in the app and on exhibitor dashboards.' : 'Saved. The Delhi card is hidden.')
  } catch (err) { delhiMsg('Not saved. ' + err.message, true) }
  finally { delhiSaveBtn.disabled = false }
})

const partnerAddBtn = document.getElementById('partner-add')
if (partnerAddBtn) partnerAddBtn.addEventListener('click', () => {
  partnersAdmin = readPartnerRows(); partnersAdmin.push({ name: '', label: '', logo: '', url: '' }); drawPartners(); partnersMsg('')
  const rows = document.querySelectorAll('[data-partner-row]'); const last = rows[rows.length - 1]; if (last) last.querySelector('[data-f="name"]').focus()
})
const partnersSaveBtn = document.getElementById('partners-save')
if (partnersSaveBtn) partnersSaveBtn.addEventListener('click', async () => {
  // A row left completely empty is dropped; anything half filled is the server's to name.
  const rows = readPartnerRows().filter(p => p.name || p.label || p.logo || p.url)
  partnersSaveBtn.disabled = true
  try {
    partnersAdmin = (await api('/api/mp/admin/partners', { method: 'PUT', body: JSON.stringify({ partners: rows }) })).partners || []
    drawPartners()
    partnersMsg(partnersAdmin.length ? `Saved. ${partnersAdmin.length} ${partnersAdmin.length === 1 ? 'partner is' : 'partners are'} now shown in the app.` : 'Saved. No partners are shown in the app.')
  } catch (err) { partnersMsg('Not saved. ' + err.message, true) }
  finally { partnersSaveBtn.disabled = false }
})
main.addEventListener('click', (e) => {
  const rm = e.target.closest('[data-partner-remove]'); if (!rm) return
  partnersAdmin = readPartnerRows(); partnersAdmin.splice(num(rm.getAttribute('data-partner-remove')), 1); drawPartners(); partnersMsg('Removed. Press Save to apply.')
})

// ── The exhibitor list in the app ──
// The app's Exhibition tab shows nobody until this is on. What it will show is listed
// first, so nothing appears to attendees that the organisers have not seen.
const loadDirectory = async () => {
  const c = document.getElementById('directory-card'); if (!c) return
  try {
    const d = await api('/api/mp/admin/directory')
    const names = (list) => list.map(esc).join(', ')
    c.innerHTML = `<h3><i class="fas fa-mobile-alt mr-2"></i>Exhibitor list in the app: <span class="dash-badge ${d.on ? 'dash-badge--green' : 'dash-badge--red'}" style="font-size:12px">${d.on ? 'ON' : 'OFF'}</span></h3>
      <p class="text-sm" style="margin:0 0 8px;line-height:1.6">${d.on ? `Attendees see <strong>${num(d.showing)} exhibitors</strong> on the Exhibition tab of Bharat AI Connect, with their booth numbers.` : `Attendees see an <strong>empty</strong> Exhibition tab in Bharat AI Connect. Turning this on shows <strong>${num(d.showing)} exhibitors</strong> with their booth numbers.`} Internal booking notes are never shown.</p>
      ${d.without_booth.length ? `<p class="text-xs" style="margin:0 0 6px;color:#92400E">No booth number yet: ${names(d.without_booth)}</p>` : ''}
      ${d.not_shown.length ? `<p class="text-xs text-slate-500" style="margin:0 0 6px">Never shown, because they have no confirmed stand and are not on the booking sheet (usually a second row for the same company): ${names(d.not_shown)}</p>` : ''}
      <p class="text-xs text-slate-500" style="margin:0 0 10px">A company that has dropped out still shows while its stand is confirmed in Booth sales: release the stand there. Booth numbers are the ones in Booth sales and on the sheet, so check they match the final floor plan.</p>
      <button type="button" id="directory-toggle" class="${d.on ? 'mp-btn-secondary' : 'mp-btn-primary'} text-sm py-2 px-4">${d.on ? 'Turn it off' : 'Turn it on'}</button>`
    document.getElementById('directory-toggle').addEventListener('click', async () => {
      if (!confirm(d.on ? 'Hide the exhibitor list from attendees?' : `Show ${num(d.showing)} exhibitors to every attendee in the app now?`)) return
      try { await api('/api/mp/admin/directory', { method: 'PUT', body: JSON.stringify({ on: !d.on }) }); showToast(d.on ? 'The exhibitor list is hidden' : 'The exhibitor list is live in the app'); await loadDirectory() }
      catch (err) { showToast(err.message, true) }
    })
  } catch (err) { c.innerHTML = `<p class="text-rose-400">${esc(err.message)}</p>` }
}

// ── Reports from exhibitors ──
let reportsAdmin = []
const loadReports = async () => {
  const c = document.getElementById('admin-reports'); if (!c) return
  try {
    const d = await api('/api/mp/admin/reports')
    reportsAdmin = d.reports || []
    const badge = document.getElementById('reports-count')
    if (badge) { badge.textContent = String(num(d.open)); badge.classList.toggle('hidden', !num(d.open)) }
    if (!reportsAdmin.length) { c.innerHTML = '<p class="text-slate-400">No reports yet.</p>'; return }
    c.innerHTML = `<table class="dash-table"><thead><tr><th>Company</th><th>About</th><th>What is wrong</th><th>From</th><th>Sent</th><th>Status</th><th></th></tr></thead><tbody>${reportsAdmin.map(r => `<tr>
      <td class="text-sm font-medium">${esc(r.company)}</td>
      <td class="text-sm">${esc(r.topic)}</td>
      <td class="text-sm" style="max-width:360px;white-space:pre-wrap">${esc(r.message)}${r.reply ? `<div class="text-xs text-slate-400" style="margin-top:4px">Reply: ${esc(r.reply)}</div>` : ''}</td>
      <td class="text-xs">${esc(r.reported_by)}</td>
      <td class="text-xs text-slate-400">${fmtDate(r.created_at)}</td>
      <td>${r.status === 'resolved' ? '<span class="dash-badge dash-badge--green">Resolved</span>' : '<span class="dash-badge dash-badge--red">Open</span>'}</td>
      <td>${r.status === 'resolved'
        ? `<button class="mp-btn-secondary text-xs py-1 px-3" data-report-open="${num(r.id)}">Reopen</button>`
        : `<button class="mp-btn-primary text-xs py-1 px-3" data-report-resolve="${num(r.id)}">Mark resolved</button>`}</td></tr>`).join('')}</tbody></table>`
  } catch (err) { c.innerHTML = `<p class="text-rose-400">${esc(err.message)}</p>` }
}
main.addEventListener('click', async (e) => {
  const res = e.target.closest('[data-report-resolve]'), reo = e.target.closest('[data-report-open]')
  if (!res && !reo) return
  const id = num((res || reo).getAttribute(res ? 'data-report-resolve' : 'data-report-open'))
  let body = { status: 'open' }
  if (res) {
    const reply = prompt('Mark resolved. A short reply the exhibitor will see (optional):', '')
    if (reply === null) return
    body = { status: 'resolved', reply }
  }
  try { await api('/api/mp/admin/reports/' + id, { method: 'PATCH', body: JSON.stringify(body) }); showToast(res ? 'Marked resolved' : 'Reopened'); await loadReports() }
  catch (err) { showToast(err.message, true) }
})

// ── Stage talks ──
// Each exhibitor with a confirmed stand has one Innovation Talk & Showcase slot. They
// fill in the talk from their dashboard; the time is set here, one row at a time.
let stageRows = [], stageDays = []
const hhmm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
const minutesOf = (startsAt) => { const [h, m] = String(startsAt).slice(11, 16).split(':').map(Number); return h * 60 + m }

const loadStageTalks = async () => {
  const c = document.getElementById('admin-stage'); if (!c) return
  try {
    const d = await api('/api/mp/admin/stage-talks')
    stageDays = d.days || []
    if (!d.ready) { c.innerHTML = '<p class="text-slate-400">Stage talks start working once migration 0044 has been run on the database.</p>'; return }
    stageRows = d.talks || []
    const s = d.summary || {}
    const sum = document.getElementById('stage-summary')
    if (sum) sum.textContent = `${num(s.exhibitors)} exhibitors with a slot · ${num(s.with_details)} have sent their details · ${num(s.scheduled)} have a time · ${num(s.in_programme)} in the event app`
    if (!stageRows.length) { c.innerHTML = '<p class="text-slate-400">No confirmed stands yet.</p>'; return }
    c.innerHTML = `<div class="overflow-x-auto"><table class="dash-table"><thead><tr><th>Exhibitor</th><th>Talk</th><th>Time</th><th></th></tr></thead><tbody>${stageRows.map(stageRow).join('')}</tbody></table></div>`
  } catch (err) { c.innerHTML = `<p class="text-rose-400">${esc(err.message)}</p>` }
}

const stageRow = (t) => {
  const photo = safeUrl(t.speaker_photo_url)
  const talk = t.details_complete || t.topic || t.speaker_name
    ? `<p class="text-sm font-medium">${esc(t.topic || 'No topic yet')}</p>
       <div class="flex gap-2 items-center mt-1">${photo ? `<img src="${esc(photo)}" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover">` : ''}
         <p class="text-xs text-slate-500">${esc(t.speaker_name || 'No speaker yet')}${t.speaker_title ? `, ${esc(t.speaker_title)}` : ''}</p></div>
       ${t.showcase || t.speaker_bio ? `<details class="mt-1"><summary class="text-xs text-slate-400" style="cursor:pointer">Showcase and bio</summary>${t.showcase ? `<p class="text-xs mt-1" style="white-space:pre-wrap"><strong>Showcase:</strong> ${esc(t.showcase)}</p>` : ''}${t.speaker_bio ? `<p class="text-xs mt-1" style="white-space:pre-wrap"><strong>Bio:</strong> ${esc(t.speaker_bio)}</p>` : ''}</details>` : ''}`
    : '<span class="dash-badge dash-badge--yellow"><i class="fa-solid fa-clock"></i> Waiting for details</span>'
  const time = t.slot
    ? `<p class="text-sm">${esc(t.slot)}</p>${t.clashes.length ? `<p class="text-xs" style="color:#be123c"><i class="fas fa-exclamation-triangle"></i> Overlaps ${esc(t.clashes.join(', '))}</p>` : ''}${t.in_programme ? '' : '<p class="text-xs text-slate-500">Not in the app until the topic and speaker are in</p>'}`
    : '<span class="text-xs text-slate-500">Not set</span>'
  return `<tr data-stage-row="${num(t.exhibitor_id)}">
    <td class="text-sm"><p class="font-medium">${esc(t.company_name)}</p><p class="text-xs text-slate-500">${t.has_stand ? `Booth ${esc(t.booths.join(', '))} · ${esc(t.packages.join(', '))}` : 'No confirmed stand any more'}${t.minutes ? ` · ${num(t.minutes)} min` : ''}</p></td>
    <td>${talk}</td>
    <td>${time}</td>
    <td><button class="mp-btn-secondary text-sm py-2 px-4" style="white-space:nowrap" data-stage-edit="${num(t.exhibitor_id)}">${t.starts_at ? 'Change' : 'Set time'}</button></td>
  </tr>`
}

// A new slot starts where the programme currently ends, so filling the day is one
// Save after another. Falls to the second day once the first runs past 6 pm.
const nextFreeSlot = () => {
  for (const d of stageDays) {
    const ends = stageRows.filter(r => r.starts_at && r.starts_at.slice(0, 10) === d.date).map(r => minutesOf(r.starts_at) + num(r.minutes))
    const end = ends.length ? Math.max(...ends) : 10 * 60
    if (end < 18 * 60) return { date: d.date, time: hhmm(end) }
  }
  return { date: (stageDays[0] || {}).date || '', time: '10:00' }
}

const closeStageEditor = () => { const open = document.getElementById('stage-editor'); if (open) open.remove() }
const openStageEditor = (id) => {
  closeStageEditor()
  const t = stageRows.find(r => num(r.exhibitor_id) === id); if (!t) return
  const at = t.starts_at ? { date: t.starts_at.slice(0, 10), time: t.starts_at.slice(11, 16) } : nextFreeSlot()
  const row = document.querySelector(`[data-stage-row="${id}"]`); if (!row) return
  row.insertAdjacentHTML('afterend', `<tr id="stage-editor"><td colspan="4" style="background:#fff7ed">
    <div class="flex gap-3 items-end flex-wrap">
      <label class="text-xs text-slate-500">Day<select class="form-input mt-1" data-stage-day>${stageDays.map(d => `<option value="${esc(d.date)}"${d.date === at.date ? ' selected' : ''}>${esc(d.label)}</option>`).join('')}</select></label>
      <label class="text-xs text-slate-500">Starts<input type="time" class="form-input mt-1" data-stage-time value="${esc(at.time)}" step="300"></label>
      <label class="text-xs text-slate-500">Minutes<input type="number" class="form-input mt-1" data-stage-minutes min="1" max="120" value="${num(t.minutes) || ''}" style="width:90px"></label>
      <button class="mp-btn-primary text-sm py-2 px-4" data-stage-save="${id}">Save</button>
      ${t.starts_at ? `<button class="mp-btn-secondary text-sm py-2 px-4" data-stage-clear="${id}">Remove time</button>` : ''}
      <button class="mp-btn-secondary text-sm py-2 px-4" data-stage-cancel>Cancel</button>
    </div>
    ${t.minutes ? '' : '<p class="text-xs mt-2" style="color:#9a3412">This package has no talk length on the exhibition page. Enter the minutes you have agreed.</p>'}
  </td></tr>`)
}

const saveStageTime = async (btn) => {
  const box = document.getElementById('stage-editor'); if (!box) return
  const body = { date: box.querySelector('[data-stage-day]').value, time: box.querySelector('[data-stage-time]').value, minutes: num(box.querySelector('[data-stage-minutes]').value) }
  btn.disabled = true
  try {
    const r = await api(`/api/mp/admin/stage-talks/${num(btn.getAttribute('data-stage-save'))}`, { method: 'PATCH', body: JSON.stringify(body) })
    showToast(r.clashes && r.clashes.length ? `Saved, but it overlaps ${r.clashes.join(', ')}` : `Saved: ${r.slot}`, !!(r.clashes && r.clashes.length))
    await loadStageTalks()
  } catch (err) { showToast(err.message, true); btn.disabled = false }
}

const clearStageTime = async (btn) => {
  if (!confirm('Remove this talk from the programme? The exhibitor keeps their details and you can set a new time later.')) return
  btn.disabled = true
  try {
    await api(`/api/mp/admin/stage-talks/${num(btn.getAttribute('data-stage-clear'))}`, { method: 'PATCH', body: JSON.stringify({ clear: true }) })
    showToast('Time removed')
    await loadStageTalks()
  } catch (err) { showToast(err.message, true); btn.disabled = false }
}

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
  await Promise.all([loadStats(), loadAllListings(), loadPendingListings(), loadInquiries(), loadExhibitors(), loadStageTalks()])
  showToast('Refreshed')
})

// Logout
document.getElementById('dash-logout').addEventListener('click', async (e) => {
  if (e.currentTarget.dataset.back) { window.location.href = '/admin'; return }
  await api('/api/mp/auth/logout', { method:'POST' })
  window.location.href = '/marketplace'
})

initAdmin()
