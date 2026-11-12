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
  if (!toast) return
  toast.textContent = msg; toast.classList.remove('hidden')
  toast.classList.toggle('border-rose-500', isError); toast.classList.toggle('border-slate-700', !isError)
  // An earlier toast's timer used to hide the next one early.
  clearTimeout(showToast.t); showToast.t = setTimeout(() => toast.classList.add('hidden'), isError ? 6000 : 3500)
}
// Errors carry the HTTP status (401 = the sign-in ran out) and a request that never
// reached the server says so.
const failure = (message, status) => { const e = new Error(message); e.status = status; return e }
const api = async (path, opts = {}) => {
  let r
  try { r = await fetch(path, { headers:{'Content-Type':'application/json'}, credentials:'same-origin', ...opts }) }
  catch { throw failure('Could not reach the server. Check your connection and try again.', 0) }
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw failure(d.error || `Request failed (HTTP ${r.status})`, r.status)
  return d
}
const toSlug = (t) => (t||'').toLowerCase().trim().replace(/&/g,'and').replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,80)
// The database writes "YYYY-MM-DD HH:MM:SS" in UTC. Read as it stood, the browser
// took it for local time (a listing sent at 1 AM in India showed the day before),
// and older iPhone Safari could not read it at all ("Invalid Date").
const parseDbTime = (d) => { const s = String(d || '').trim(); const t = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s.replace(' ', 'T') : s.replace(' ', 'T') + 'Z'); return isNaN(t) ? null : t }
const fmtDate = (d) => { const t = parseDbTime(d); return t ? t.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : '—' }
const fmtDateTime = (d) => { const t = parseDbTime(d); return t ? t.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—' }
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
      main.innerHTML = `<section class="dash-section"><div class="dash-login-required"><i class="fas fa-lock"></i><h2>Sign in to see your dashboard</h2><p>Exhibitors: use <strong>Email me a sign-in link</strong> with the email from your booth booking. No password needed.</p><a href="/marketplace?signin=1" class="dash-btn-primary">Sign in</a></div></section>`
      return
    }
    if (d.user.role === 'admin') { window.location.href = '/marketplace/admin'; return }
    const name = d.user.company_name || 'Company'
    dashCompanySlug = toSlug(name)
    document.getElementById('dash-company-name').textContent = name
    const tn = document.getElementById('dash-topbar-name'); if (tn) tn.textContent = name
    const av = document.getElementById('dash-avatar'); if (av) av.textContent = name.charAt(0).toUpperCase()
    await Promise.all([loadStats(), loadListings(), loadStage(), loadTeam(), loadBooth(), loadLeads(), loadReports(), loadInquiries(), loadReviews(), loadProfile(), loadRecentInquiries(), loadDelhi()])
    // The "add your team" email signs in to /marketplace/dashboard#team.
    if (location.hash === '#team' && teamInfo && teamInfo.eligible) switchSection('team')
    if (location.hash === '#leads' && leadsInfo && leadsInfo.exhibitor) switchSection('leads')
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
    if (!ls.length) { c.innerHTML = `<div class="dash-empty"><i class="fas fa-box-open"></i><p>No listings yet</p><p class="text-xs text-slate-500"><a href="/marketplace?submit=true" class="text-emerald-400">List your AI product</a>: it takes about five minutes.</p></div>`; return }
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
  let r
  try { r = await fetch('/api/mp/uploads', { method: 'POST', body: fd, credentials: 'same-origin' }) }
  catch { throw failure(`${file.name}: the upload did not reach the server. Check your connection and try again.`, 0) }
  const d = await r.json().catch(() => ({}))
  if (r.status === 401) throw failure('Login required', 401)
  if (!r.ok) throw failure(`${file.name}: ${d.error || 'upload failed. Please try again.'}`, r.status)
  return d.url
}
// The same link rule as the listing form and the server: "example.com" is fine.
const isWebUrl = (v) => { try { const u = new URL(v); return u.protocol === 'https:' || u.protocol === 'http:' } catch { return false } }
const cleanLink = (raw) => {
  const s = String(raw || '').trim()
  if (!s) return ''
  if (isWebUrl(s)) return s
  if (/^[\w-]+(\.[\w-]+)+([/?#]\S*)?$/.test(s) && isWebUrl('https://' + s)) return 'https://' + s
  return null
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
  const img = document.getElementById('stage-photo-preview'), u = safeImageUrl(s.speaker_photo_url) || safeTeamPhoto(s.speaker_photo_url)
  if (u) { img.src = u; img.classList.remove('hidden') } else { img.removeAttribute('src'); img.classList.add('hidden') }
  // With speakers ticked on the team list, who speaks is set there: show it, hide the boxes.
  const fromTeam = Number(s.team_speakers) > 0
  ;['stage-photo-file', 'stage-speaker', 'stage-speaker-title'].forEach(id => { const f = document.getElementById(id); const box = f && f.closest('.form-field'); if (box) box.style.display = fromTeam ? 'none' : '' })
  const note = document.getElementById('stage-from-team')
  if (note) {
    note.hidden = !fromTeam
    note.innerHTML = fromTeam ? `<p style="margin:0"><strong>${esc(s.speaker_name || '')}</strong>${s.speaker_title ? `, ${esc(s.speaker_title)}` : ''}</p>
      <p class="text-xs text-slate-500" style="margin:4px 0 8px">From Your Team: the people ticked "On stage". To change who speaks, or their photo, edit them there.</p>
      <button type="button" class="mp-btn-secondary text-sm" data-goto-team>Open Your Team</button>` : ''
    const go = note.querySelector('[data-goto-team]'); if (go) go.addEventListener('click', () => switchSection('team'))
  }
}

// Exhibitors see what their booth includes as two steps, so nothing depends on
// finding the right menu item.
const renderTodo = () => {
  const box = document.getElementById('dash-todo'); if (!box) return
  const stageOn = !!(stageInfo && stageInfo.eligible), teamOn = !!(teamInfo && teamInfo.eligible)
  if ((!stageOn && !teamOn) || dashListings === null) { box.classList.add('hidden'); return }
  const s = stageOn ? stageInfo : {}, listed = dashListings.length > 0, live = dashListings.some(l => l.status === 'approved')
  const people = teamOn ? teamInfo.members : [], noPhoto = people.filter(m => !m.photo_url).length
  const step = (done, title, note, action) => `<div class="flex gap-3 items-center justify-between flex-wrap" style="padding:12px 0;border-top:1px solid #e5e7eb">
      <div class="flex gap-3 items-center" style="flex:1;min-width:200px"><i class="fas ${done ? 'fa-check-circle' : 'fa-circle'}" style="font-size:20px;color:${done ? '#059669' : '#cbd5e1'}"></i>
        <div><p class="font-medium text-sm">${title}</p><p class="text-xs text-slate-500">${note}</p></div></div>
      ${action}</div>`
  box.innerHTML = '<h3><i class="fas fa-clipboard-list mr-2"></i>Your exhibitor to-do list</h3>'
    + step(listed, 'List your AI product',
      live ? 'Live on the AI Marketplace.' : listed ? 'In review. We email you as soon as it is live.' : 'Free with your booth. Takes about five minutes.',
      listed ? '' : '<a href="/marketplace?submit=true" class="mp-btn-primary text-sm py-2 px-4" style="display:inline-block;text-decoration:none">List your product</a>')
    + (teamOn ? step(people.length > 0 && !noPhoto, 'Add your team and their photos',
      people.length ? `${people.length} ${people.length === 1 ? 'person' : 'people'} added${noPhoto ? `. ${noPhoto} ${noPhoto === 1 ? 'photo is' : 'photos are'} missing.` : '.'}` : 'Who is coming: at the booth, on stage, or both. Passes are issued from this list.',
      `<button type="button" class="${people.length && !noPhoto ? 'mp-btn-secondary' : 'mp-btn-primary'} text-sm py-2 px-4" data-goto="team">${people.length ? 'Open' : 'Add your team'}</button>`) : '')
    + (!stageOn ? '' : step(s.details_complete, `Add your stage talk${s.minutes ? ` (${esc(s.minutes)} minutes)` : ''}`,
      s.slot ? `On stage ${esc(s.slot)}.` : s.details_complete ? 'Details saved. Your time on stage will show here.' : 'Your topic, what you will showcase, and the speaker with a photo.',
      `<button type="button" class="${s.details_complete ? 'mp-btn-secondary' : 'mp-btn-primary'} text-sm py-2 px-4" data-goto="stage">${s.details_complete ? 'Edit' : 'Add details'}</button>`))
    // Shown to a contact who holds a pass (theirs, or from being on the team).
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

// ── Your team ──
// Who is coming from the company, at the booth, on stage, or both. Passes are issued
// from this list, up to the number the booth includes; past that, each extra person
// needs a Delegate Pass (organiser, 11 Nov 2026). The server applies every rule again.
let teamInfo = null
let editingMember = null
const safeTeamPhoto = (u) => (/^\/api\/mp\/uploads\/\d+$/.test(String(u || '')) || /^\/images\/talks\/[a-z0-9-]+\.webp$/.test(String(u || ''))) ? u : ''
const fullName = (m) => `${m.first_name || ''} ${m.last_name || ''}`.trim()
const initials = (m) => ((m.first_name || '').charAt(0) + (m.last_name || '').charAt(0)).toUpperCase() || '?'
const hasPass = (m) => !!(m.pass && !/visitor/i.test(m.pass))
const passText = (m) => !hasPass(m) ? 'No pass yet' : m.own_pass ? `Has a ${m.pass}` : m.pass === 'Exhibition Speaker' ? 'Speaker pass issued' : 'Exhibitor pass issued'
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

const loadTeam = async () => {
  try { teamInfo = await api('/api/mp/dashboard/team') } catch { teamInfo = null }
  const on = !!(teamInfo && teamInfo.eligible)
  const nav = document.getElementById('dash-nav-team'); if (nav) nav.classList.toggle('hidden', !on)
  if (on) renderTeam()
  renderBranding()
  renderConnect()
  renderTodo()
}

// Who the artwork goes to: the exhibitor's contact at Bharat AI Innovation.
const artworkWho = (a) => {
  a = a || {}
  if (a.name && a.email) return `${esc(a.name)} at <strong>${esc(a.email)}</strong>`
  if (a.email) return `<strong>${esc(a.email)}</strong>`
  return a.name ? `${esc(a.name)}, your contact at Bharat AI Innovation,` : 'your contact at Bharat AI Innovation'
}
// The branding sizes for this booth's type, as the organisers revised them.
const renderConnect = () => {
  const on = !!(teamInfo && teamInfo.eligible)
  const nav = document.getElementById('dash-nav-connect'); if (nav) nav.classList.toggle('hidden', !on)
  const box = document.getElementById('connect-team'); if (!box || !on) return
  const ms = (teamInfo.members || []).filter(m => m.email)
  const inCount = ms.filter(m => m.app_signed_in).length
  box.innerHTML = `<h3>Your team in the app</h3>
    ${ms.length ? `<p class="text-sm" style="margin:0 0 8px">${inCount} of ${ms.length} signed in so far.</p>
    <ul class="connect-people">${ms.map(m => `<li><span>${esc(fullName(m))}</span><span class="${m.app_signed_in ? 'pay-paid' : 'pay-pending'}"><i class="fas ${m.app_signed_in ? 'fa-check-circle' : 'fa-circle'}"></i> ${m.app_signed_in ? 'Signed in' : 'Not signed in yet'}</span></li>`).join('')}</ul>`
      : '<p class="text-sm" style="margin:0">Add your team first. Each person then signs in with the email you gave for them.</p>'}`
}
const renderBranding = () => {
  const b = teamInfo && teamInfo.eligible ? teamInfo.branding : null
  const nav = document.getElementById('dash-nav-branding'); if (nav) nav.classList.toggle('hidden', !b)
  const card = document.getElementById('branding-card'); if (!card || !b) return
  card.innerHTML = `<h3>Branding sizes for your ${esc(b.booth)}</h3>
    <p class="text-sm" style="margin:0 0 12px;line-height:1.6">Revised on 11 November 2026. Please use these sizes for your artwork.</p>
    <table class="dash-table"><tbody>${(b.rows || []).map(([k, v]) => `<tr><td class="text-sm" style="color:var(--mp-muted)">${esc(k)}</td><td class="text-sm"><strong>${esc(v)}</strong></td></tr>`).join('')}</tbody></table>
    <p class="text-sm" style="margin:12px 0 0;line-height:1.6">Please email your final artwork to ${artworkWho(b.artwork)} and mark <strong>${esc((b.artwork && b.artwork.cc) || 'register@bharataiinnovation.com')}</strong> in CC. Send a high-resolution PDF, Adobe Illustrator (AI), CorelDRAW (CDR) or PNG file, with your company logo and the font files used. Once artwork goes for printing, it cannot be changed.</p>`
}

const renderTeam = () => {
  const t = teamInfo
  const pkg = (t.packages || []).length === 1 ? `your ${esc(t.packages[0])}` : 'your booth'
  document.getElementById('team-intro').innerHTML = `
    <p class="text-sm" style="margin:0 0 8px;line-height:1.6">Add everyone coming from <strong>${esc(t.company_name)}</strong>: at the booth, on stage for your Innovation Talk &amp; Showcase, or both. We issue their passes from this list.</p>
    ${t.passes === null || t.passes === undefined
      ? '<p class="team-pass-meter">The organisers will confirm how many passes your booth includes. You can add your team now.</p>'
      : `<p class="team-pass-meter">${pkg.charAt(0).toUpperCase() + pkg.slice(1)} includes <strong>${plural(t.passes, 'pass', 'passes')}</strong>. Issued so far: <strong>${esc(t.issued)}</strong>.</p>
         ${t.used > t.passes ? `<p class="team-missing" style="font-size:13px">You have listed ${plural(t.used, 'person', 'people')} for ${plural(t.passes, 'pass', 'passes')}. Please remove ${t.used - t.passes === 1 ? 'one person' : `${t.used - t.passes} people`}, or buy a Delegate Pass for ${t.used - t.passes === 1 ? 'them' : 'each of them'}.</p>` : ''}`}
    ${t.deadline ? `<p class="team-pass-meter">Please complete this by <strong>${esc(t.deadline)}</strong>, so the passes and lanyards can be printed.</p>` : ''}
    <p class="text-xs text-slate-500" style="margin:8px 0 0;line-height:1.6">You, as the contact person, get a pass only if you add yourself. Each person sees their pass by signing in at bharataiinnovation.com/app with their own email.</p>`
  const list = document.getElementById('team-list')
  const ms = t.members || []
  list.innerHTML = ms.length ? ms.map(m => {
    const photo = safeTeamPhoto(m.photo_url)
    return `<div class="team-card" data-member="${esc(m.id)}">
      ${photo ? `<img class="team-photo" src="${esc(photo)}" alt="">` : `<div class="team-photo team-photo--empty" aria-hidden="true">${esc(initials(m))}</div>`}
      <div style="min-width:0">
        <p class="team-name">${esc(fullName(m))}</p>
        <p class="team-sub">${esc([m.designation, m.company].filter(Boolean).join(' · '))}</p>
        <p class="team-sub">${esc([m.email, m.mobile].filter(Boolean).join(' · '))}</p>
        <div class="team-chips">${m.at_booth ? '<span class="team-chip"><i class="fas fa-store"></i> At the booth</span>' : ''}${m.speaker ? '<span class="team-chip"><i class="fas fa-microphone-alt"></i> On stage</span>' : ''}<span class="team-chip ${hasPass(m) ? 'team-chip--pass' : 'team-chip--wait'}">${esc(passText(m))}</span></div>
        ${(m.missing || []).length ? `<p class="team-missing">Still needed: ${esc(m.missing.join(', '))}</p>` : ''}
        ${!hasPass(m) && m.pass_note ? `<p class="team-missing">${esc(m.pass_note)}</p>` : ''}
        <div class="team-card-actions">${hasPass(m) && !m.own_pass ? `<button type="button" class="mp-btn-secondary" data-team-pass="${esc(m.id)}"><i class="fas fa-id-badge mr-1"></i> Pass</button><button type="button" class="mp-btn-secondary" data-team-social="${esc(m.id)}"><i class="fas fa-share-alt mr-1"></i> Social card</button>` : ''}<button type="button" class="mp-btn-secondary" data-team-edit="${esc(m.id)}"><i class="fas fa-pen mr-1"></i> Edit</button><button type="button" class="mp-btn-secondary" data-team-remove="${esc(m.id)}"><i class="fas fa-trash-alt mr-1"></i> Remove</button></div>
      </div></div>`
  }).join('') : '<div class="dash-card dash-empty" style="padding:24px"><i class="fas fa-users"></i><p>Nobody added yet.</p></div>'
  list.querySelectorAll('[data-team-edit]').forEach(b => b.addEventListener('click', () => openTeamForm(ms.find(m => String(m.id) === b.getAttribute('data-team-edit')))))
  list.querySelectorAll('[data-team-remove]').forEach(b => b.addEventListener('click', () => removeMember(ms.find(m => String(m.id) === b.getAttribute('data-team-remove')))))
  list.querySelectorAll('[data-team-pass]').forEach(b => b.addEventListener('click', () => downloadFor(ms.find(m => String(m.id) === b.getAttribute('data-team-pass')), b, 'pass')))
  list.querySelectorAll('[data-team-social]').forEach(b => b.addEventListener('click', () => downloadFor(ms.find(m => String(m.id) === b.getAttribute('data-team-social')), b, 'social')))
  if (t.can_add) hideTeamFull()
}

// Past the booth's passes: a Delegate Pass for each extra person, at today's price.
let delegatePrice = null
const delegatePriceText = async () => {
  if (delegatePrice === null) {
    try { const cfg = await api('/api/payments/config'); const p = cfg.passes && cfg.passes['Delegate Pass']; delegatePrice = p ? `₹${Number(p.base).toLocaleString('en-IN')} + GST` : '' } catch { delegatePrice = '' }
  }
  return delegatePrice
}
const showTeamFull = async () => {
  const box = document.getElementById('team-full'), n = teamInfo ? teamInfo.passes : 0
  const price = await delegatePriceText()
  box.innerHTML = `<p style="margin:0"><strong>Your booth includes ${plural(n, 'pass', 'passes')}, and all are in use.</strong></p>
    <p style="margin:6px 0 0">To bring someone else, please buy them a Delegate Pass${price ? ` (${esc(price)})` : ''}. It covers both days of the conference, lunch and networking in the event app. Use their own name and email when you buy it.</p>
    <a class="mp-btn-primary" href="/register?source=exhibitor_extra#delegate" target="_blank" rel="noopener">Buy a Delegate Pass</a>
    <p style="margin:12px 0 0">Do they already have a pass of their own, such as the Delegate Pass you just bought? Then you can add them to your team list.</p>
    <button type="button" class="mp-btn-secondary" data-team-add-own style="margin-top:8px;min-height:44px">Add someone who has a pass</button>
    <p class="text-xs" style="margin:10px 0 0">If you think your booth should include more passes, reply to the organisers' email.</p>`
  const own = box.querySelector('[data-team-add-own]'); if (own) own.addEventListener('click', () => openTeamForm(null))
  box.hidden = false
  closeTeamForm()
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}
const hideTeamFull = () => { const box = document.getElementById('team-full'); if (box) { box.hidden = true; box.innerHTML = '' } }

const teamForm = document.getElementById('team-form')
const teamErr = document.getElementById('team-form-error')
const showTeamError = (html) => { teamErr.innerHTML = html; teamErr.hidden = false; teamErr.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }
const clearTeamError = () => { teamErr.hidden = true; teamErr.innerHTML = '' }
const tf = (id) => document.getElementById(id)

const openTeamForm = (m) => {
  editingMember = m || null
  clearTeamError(); hideTeamFull()
  tf('team-form-title').textContent = m ? `Edit ${fullName(m)}` : 'Add a person'
  tf('team-id').value = m ? m.id : ''
  tf('team-at-booth').checked = m ? !!m.at_booth : true
  tf('team-speaker').checked = m ? !!m.speaker : false
  tf('team-first').value = m ? m.first_name || '' : ''
  tf('team-last').value = m ? m.last_name || '' : ''
  tf('team-designation').value = m ? m.designation || '' : ''
  tf('team-company').value = m ? m.company || '' : (teamInfo ? teamInfo.company_name || '' : '')
  tf('team-email').value = m ? m.email || '' : ''
  tf('team-mobile').value = m ? m.mobile || '' : ''
  tf('team-linkedin').value = m ? m.linkedin_url || '' : ''
  tf('team-photo-file').value = ''
  const pv = tf('team-photo-preview'), u = m ? safeTeamPhoto(m.photo_url) : ''
  if (u) { pv.src = u; pv.hidden = false } else { pv.removeAttribute('src'); pv.hidden = true }
  teamForm.hidden = false
  teamForm.scrollIntoView({ behavior: 'smooth', block: 'start' })
  setTimeout(() => { try { tf(m ? 'team-designation' : 'team-first').focus({ preventScroll: true }) } catch {} }, 300)
}
const closeTeamForm = () => { teamForm.hidden = true; editingMember = null; clearTeamError() }

document.getElementById('team-add-btn').addEventListener('click', () => {
  if (teamInfo && !teamInfo.can_add) { showTeamFull(); return }
  openTeamForm(null)
})
document.getElementById('team-cancel').addEventListener('click', closeTeamForm)
tf('team-photo-file').addEventListener('change', () => {
  const input = tf('team-photo-file'), f = input.files[0]; if (!f) return
  const problem = checkImageFile(f, 'avatar')
  if (problem) { showTeamError(esc(problem)); input.value = ''; return }
  const pv = tf('team-photo-preview'); pv.src = URL.createObjectURL(f); pv.hidden = false
})

// The server's rules, checked here first so the box is named and focused.
const teamProblem = () => {
  const val = (id) => tf(id).value.trim()
  if (!tf('team-at-booth').checked && !tf('team-speaker').checked) return ['team-at-booth', 'Please choose their role: at the booth, on stage, or both.']
  if (!val('team-first')) return ['team-first', 'Please enter their first name.']
  if (!val('team-designation')) return ['team-designation', 'Please enter their designation, for example Sales Manager. It is printed on the pass.']
  if (!val('team-company')) return ['team-company', 'Please enter their company name.']
  if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(val('team-email'))) return ['team-email', 'Please enter their email address. Their pass is sent to it.']
  const mob = val('team-mobile'), digits = mob.replace(/\D/g, '')
  if (mob && (digits.length < 10 || digits.length > 15 || !/^[+\d][\d\s()-]*$/.test(mob))) return ['team-mobile', 'Mobile number: please enter a 10-digit number, with the country code if it is not an Indian number.']
  const li = cleanLink(val('team-linkedin'))
  let host = ''; try { host = li ? new URL(li).hostname.toLowerCase() : '' } catch { host = '' }
  if (li === null || (li && !/(^|\.)linkedin\.com$/.test(host))) return ['team-linkedin', 'LinkedIn: please paste the link to their LinkedIn profile, such as linkedin.com/in/name.']
  return null
}

teamForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  clearTeamError()
  const problem = teamProblem()
  if (problem) { showTeamError(`<strong>Not saved.</strong> ${esc(problem[1])}`); tf(problem[0]).focus(); return }
  const btn = teamForm.querySelector('button[type="submit"]'), html = btn.innerHTML
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Saving...'
  try {
    const body = {
      at_booth: tf('team-at-booth').checked, speaker: tf('team-speaker').checked,
      first_name: tf('team-first').value, last_name: tf('team-last').value, designation: tf('team-designation').value,
      company: tf('team-company').value, email: tf('team-email').value.trim(), mobile: tf('team-mobile').value,
      linkedin_url: cleanLink(tf('team-linkedin').value) || '', photo_url: editingMember ? editingMember.photo_url || '' : '',
    }
    const file = tf('team-photo-file').files[0]
    if (file) body.photo_url = await uploadImage(file, 'avatar')
    const id = tf('team-id').value
    const name = `${body.first_name} ${body.last_name}`.trim()
    teamInfo = await api(id ? `/api/mp/dashboard/team/${encodeURIComponent(id)}` : '/api/mp/dashboard/team', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) })
    closeTeamForm(); renderTeam(); renderTodo(); loadBooth()
    const saved = (teamInfo.members || []).find(m => m.email === body.email.toLowerCase())
    showToast(saved && hasPass(saved) ? `Saved. ${name}: ${passText(saved).toLowerCase()}.` : `Saved ${name}.`)
    if (body.speaker || (editingMember && editingMember.speaker)) loadStage()
  } catch (err) {
    if (err.status === 401) showTeamError('<strong>Not saved: your sign-in has run out.</strong> <a href="/marketplace?signin=1" target="_blank" rel="noopener" style="color:inherit;font-weight:600">Sign in again</a> (it opens in a new tab; use <em>Email me a sign-in link</em>), then come back to this tab and press Save once more. What you typed is kept.')
    else if (err.status === 409 && /all are in use/.test(err.message)) { await loadTeam(); showTeamFull() }
    else showTeamError(`<strong>Not saved.</strong> ${esc(err.message)}`)
  } finally { btn.disabled = false; btn.innerHTML = html }
})

const removeMember = async (m) => {
  if (!m) return
  if (!confirm(`Remove ${fullName(m)} from your team?${hasPass(m) && !m.own_pass ? ' Their pass from your booth is cancelled.' : ''}`)) return
  try {
    teamInfo = await api(`/api/mp/dashboard/team/${encodeURIComponent(m.id)}`, { method: 'DELETE' })
    closeTeamForm(); renderTeam(); renderTodo(); loadBooth()
    showToast(`${fullName(m)} removed`)
    if (m.speaker) loadStage()
  } catch (err) { showToast(err.message, true) }
}

// ── The company's booth at a glance (Overview) ──
// Which event, the booth and its size, the passes, the stage slot, and what has been
// paid and what is pending, from the booth record the organisers keep.
let boothInfo = null
const inr = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const ymd = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? { y: +m[1], mo: +m[2] - 1, d: +m[3] } : null }
const dayRange = (a, b) => {
  const x = ymd(a), y = ymd(b); if (!x) return ''
  if (!y || (x.y === y.y && x.mo === y.mo && x.d === y.d)) return `${x.d} ${MONTHS[x.mo]} ${x.y}`
  return x.y === y.y && x.mo === y.mo ? `${x.d}–${y.d} ${MONTHS[x.mo]} ${x.y}` : `${x.d} ${MONTHS[x.mo]} – ${y.d} ${MONTHS[y.mo]} ${y.y}`
}
// ── The Delhi edition ──
// Every dashboard account sees it on the first screen while the organisers keep it on
// (Marketplace admin, Shown in the app). The words come from the server; the link is
// one of ours and is checked again here.
const loadDelhi = async () => {
  const box = document.getElementById('dash-delhi'); if (!box) return
  let d = null
  try { d = (await api('/api/app-partners')).delhi } catch { d = null }
  if (!d || !d.ex_title) { box.classList.add('hidden'); box.innerHTML = ''; return }
  const href = /^\/delhi([?#]|$)/.test(d.ex_url || '') ? d.ex_url : '/delhi'
  box.innerHTML = `<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
      <img src="/images/delhi/mandapam-dusk-phone.webp" alt="Bharat Mandapam, New Delhi" loading="lazy" width="132" height="88" style="width:132px;height:88px;object-fit:cover;border-radius:12px;flex:none">
      <div style="flex:1 1 240px;min-width:0">
        <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#C84F00">Delhi 2027</p>
        <h3 style="margin:4px 0 0">${esc(d.ex_title)}</h3>
        <p class="text-sm text-slate-400" style="margin:4px 0 0">${esc(d.ex_text)}</p>
      </div>
      <a class="mp-btn-primary text-sm py-2 px-4" href="${esc(href)}" target="_blank" rel="noopener" data-delhi-open>${esc(d.ex_cta)} <i class="fas fa-arrow-right ml-1"></i></a>
    </div>`
  box.classList.remove('hidden')
  const a = box.querySelector('[data-delhi-open]')
  if (a) a.addEventListener('click', () => {
    try { fetch('/api/app-promo/delhi-open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ from: 'exhibitor' }), keepalive: true }).catch(() => {}) } catch { /* the link still opens */ }
  })
}

const loadBooth = async () => {
  try { boothInfo = await api('/api/mp/dashboard/booth') } catch { boothInfo = null }
  renderBooth()
}
const renderBooth = () => {
  const box = document.getElementById('dash-booth'); if (!box) return
  const b = boothInfo
  if (!b || !b.company_name) { box.classList.add('hidden'); box.innerHTML = ''; return }
  const ev = b.event, pay = b.payment
  const when = ev ? [dayRange(ev.start_date, ev.end_date), ev.venue].filter(Boolean).join(' · ') : ''
  const go = (section, label) => `<button type="button" class="booth-go" data-goto="${section}">${label} <i class="fas fa-arrow-right"></i></button>`
  const row = (label, value, action) => `<div class="booth-row"><dt>${label}</dt><dd><span>${value}</span>${action || ''}</dd></div>`
  const invoices = pay ? pay.booths.filter(x => x.invoice).map(x => esc(x.invoice)).join(', ') : ''
  box.innerHTML = `<p class="booth-eyebrow">Your booth at</p>
    <h3 class="booth-title">${esc(ev ? ev.title : 'Bharat AI Innovation')}</h3>
    ${when ? `<p class="booth-when">${esc(when)}</p>` : ''}
    <dl class="booth-list">
      ${row('Booth', esc([b.booth ? 'No. ' + b.booth : '', b.label].filter(Boolean).join(' · ') || 'The organisers will confirm it'), b.label ? go('branding', 'Branding sizes') : '')}
      ${row('Passes', b.passes === null || b.passes === undefined ? 'The organisers will confirm how many' : `${esc(b.issued)} of ${esc(b.passes)} issued${b.photos_missing ? ` · ${esc(b.photos_missing)} photo${b.photos_missing === 1 ? '' : 's'} missing` : ''}`, go('team', 'Your Team'))}
      ${b.stage ? row('Stage talk', esc(`${b.stage.minutes ? b.stage.minutes + ' minutes' : 'Innovation Talk & Showcase'} · ${b.stage.slot || 'time to be announced'}`), go('stage', 'Stage Talk')) : ''}
      ${leadsInfo && leadsInfo.exhibitor ? row('Leads', esc(`${leadsInfo.summary.total} so far${leadsInfo.summary.hot ? ` · ${leadsInfo.summary.hot} hot` : ''}`), go('leads')) : ''}
      ${pay
        ? row('Payment', `<b class="pay-paid">Paid ${inr(pay.paid)}</b> · <b class="${pay.pending ? 'pay-pending' : 'pay-paid'}">${pay.pending ? 'Pending ' + inr(pay.pending) : 'Nothing pending'}</b><br><small>Total ${inr(pay.total)} including GST${invoices ? ' · Invoice ' + invoices : ''}</small>`)
        : row('Payment', 'Shown here once our accounts team records it')}
    </dl>
    <p class="booth-note">Something here wrong? <button type="button" class="booth-go" data-goto="report">Report a problem <i class="fas fa-arrow-right"></i></button></p>
    ${pay && pay.pending ? '<p class="booth-note">Paid after deducting TDS? That part shows as pending until we receive your TDS certificate. Please send it in reply to our email.</p>' : ''}`
  box.classList.remove('hidden')
  box.querySelectorAll('[data-goto]').forEach(btn => btn.addEventListener('click', () => switchSection(btn.getAttribute('data-goto'))))
  // For an exhibitor this page is the company's home for the event, not only the marketplace.
  const sub = document.querySelector('.dash-welcome p'); if (sub && ev) sub.textContent = 'Your exhibitor page for ' + ev.title
}

// ── Each person's pass and social card ──
// Drawn by the same files the event app uses, so they look the same as the pass the
// person downloads themselves. Loaded only when first asked for.
const loadScript = (src) => new Promise((resolve, reject) => {
  if (document.querySelector(`script[src="${src}"]`)) { resolve(); return }
  const el = document.createElement('script'); el.src = src
  el.onload = () => resolve(); el.onerror = () => reject(new Error('Could not load the pass designer. Check your connection and try again.'))
  document.head.appendChild(el)
})
const downloadFor = async (m, btn, kind) => {
  if (!m) return
  if (kind === 'social' && !m.photo_url) { showToast(`Add ${fullName(m)}'s photo first: the social card shows their face.`, true); return }
  const html = btn.innerHTML
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Preparing...'
  try {
    const d = await api(`/api/mp/dashboard/team/${encodeURIComponent(m.id)}/pass`)
    if (kind === 'pass') {
      await loadScript('/js/vendor/qrcode-generator.js?v=20261029'); await loadScript('/js/pass-render.js?v=20261112b')
      const res = await window.BhaiPass.download(d.user, { token: d.token })
      if (res && (res.photoFailed || res.qrFailed)) throw new Error(res.photoFailed ? `${fullName(m)}'s photo could not be loaded. Upload it again, then try.` : 'The QR code could not be drawn. Please try again.')
      showToast(`${fullName(m)}'s pass is downloaded`)
    } else {
      await loadScript('/js/social-card.js?v=20261102')
      const res = await window.BhaiSocialCard.download(d.user, { variant: d.variant, booth: d.booth })
      if (!res || res.photoFailed || !res.hasPhoto) throw new Error(`${fullName(m)}'s photo could not be loaded. Upload it again, then try.`)
      showToast(`${fullName(m)}'s social card is downloaded`)
    }
  } catch (err) { showToast(err.message, true) }
  finally { btn.disabled = false; btn.innerHTML = html }
}

// ── Leads ──
// Badges the team scanned at the booth (rated hot, warm or cold, with a note), and
// visitors who tapped Visit Booth in the app. The scanning itself is /exhibitor/scan.
let leadsInfo = null
const loadLeads = async () => {
  try { leadsInfo = await api('/api/exhibitor/leads') } catch { leadsInfo = null }
  const on = !!(leadsInfo && leadsInfo.exhibitor)
  const nav = document.getElementById('dash-nav-leads'); if (nav) nav.classList.toggle('hidden', !on)
  if (on) renderLeads()
  renderBooth()
}
const leadDay = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ''); return m ? `${+m[3]} ${MONTHS[+m[2] - 1]}` : d }
const renderLeads = () => {
  const s = leadsInfo.summary || {}, ls = leadsInfo.leads || []
  const days = (s.by_day || []).map(d => `${leadDay(d.day)}: ${d.n}`).join(' · ')
  document.getElementById('leads-summary').innerHTML = ls.length
    ? `<strong>${esc(s.total)}</strong> ${s.total === 1 ? 'lead' : 'leads'} · ${esc(s.scanned || 0)} scanned at your booth · ${esc(s.hot || 0)} hot · ${esc(s.warm || 0)} warm · ${esc(s.cold || 0)} cold${days ? `<br><span class="text-xs text-slate-500">By day: ${esc(days)}</span>` : ''}`
    : (leadsInfo.can_scan ? 'No leads yet. They appear here as soon as a badge is scanned.' : 'Badge scanning is being switched on. Leads will appear here.')
  const list = document.getElementById('leads-list')
  list.innerHTML = ls.map(l => `<div class="team-card" style="grid-template-columns:1fr">
      <div style="min-width:0">
        <p class="team-name">${esc(l.name)}</p>
        <p class="team-sub">${esc([l.job_title, l.company].filter(Boolean).join(' · '))}</p>
        <p class="team-sub">${esc(l.email || '')}</p>
        <div class="team-chips"><span class="team-chip">${l.source === 'scan' ? 'Badge scanned' : 'Visited in the app'}</span>${l.scanned_by ? `<span class="team-chip">by ${esc(l.scanned_by)}</span>` : ''}<span class="team-chip">${esc(fmtDateTime(l.visited_at))}</span></div>
        ${l.note ? `<p class="team-sub" style="margin-top:8px"><strong>Our note:</strong> ${esc(l.note)}</p>` : ''}
        ${l.notes ? `<p class="team-sub" style="margin-top:4px"><strong>Their note:</strong> ${esc(l.notes)}</p>` : ''}
        ${l.lead_id ? `<div class="team-card-actions">${['hot', 'warm', 'cold'].map(r => `<button type="button" class="${l.rating === r ? 'mp-btn-primary' : 'mp-btn-secondary'}" aria-pressed="${l.rating === r}" data-lead-rate="${esc(l.lead_id)}" data-rating="${r}">${r.charAt(0).toUpperCase() + r.slice(1)}</button>`).join('')}<button type="button" class="mp-btn-secondary" data-lead-note="${esc(l.lead_id)}"><i class="fas fa-pen mr-1"></i> ${l.note ? 'Edit note' : 'Add note'}</button></div>` : ''}
      </div></div>`).join('')
  const save = async (id, body) => {
    try { await api('/api/exhibitor/leads/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(body) }); await loadLeads(); showToast('Saved') }
    catch (err) { showToast(err.message, true) }
  }
  list.querySelectorAll('[data-lead-rate]').forEach(b => b.addEventListener('click', () => {
    const cur = ls.find(l => String(l.lead_id) === b.getAttribute('data-lead-rate'))
    save(b.getAttribute('data-lead-rate'), { rating: cur && cur.rating === b.getAttribute('data-rating') ? '' : b.getAttribute('data-rating') })
  }))
  list.querySelectorAll('[data-lead-note]').forEach(b => b.addEventListener('click', () => {
    const cur = ls.find(l => String(l.lead_id) === b.getAttribute('data-lead-note'))
    const note = prompt('Your note on this lead:', cur ? cur.note || '' : '')
    if (note !== null) save(b.getAttribute('data-lead-note'), { note })
  }))
}
const leadsCsvBtn = document.getElementById('leads-csv')
if (leadsCsvBtn) leadsCsvBtn.addEventListener('click', () => {
  const ls = (leadsInfo && leadsInfo.leads) || []
  if (!ls.length) { showToast('No leads to download yet'); return }
  // A cell that begins like a formula is quoted so a spreadsheet does not run it.
  const cell = (v) => { let t = String(v == null ? '' : v); if (/^[=+@\t\r-]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"' }
  const rows = [['Name', 'Email', 'Company', 'Designation', 'Pass', 'How', 'Rating', 'Our note', 'Their note', 'Scanned by', 'When (UTC)']]
    .concat(ls.map(l => [l.name, l.email, l.company, l.job_title, l.badge_type, l.source === 'scan' ? 'Badge scanned' : 'Visited in the app', l.rating, l.note, l.notes, l.scanned_by, l.visited_at]))
  const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' }))
  const a = document.createElement('a'); a.href = url; a.download = 'booth-leads.csv'; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
})

// ── Report a problem ──
// Lands on Marketplace admin → Reports and with the exhibitor's contact on our side.
let reportInfo = null
const loadReports = async () => {
  try { reportInfo = await api('/api/mp/dashboard/reports') } catch { reportInfo = null }
  const on = !!(reportInfo && reportInfo.eligible)
  const nav = document.getElementById('dash-nav-report'); if (nav) nav.classList.toggle('hidden', !on)
  if (on) renderReports()
}
const renderReports = () => {
  const box = document.getElementById('report-list'); if (!box) return
  const rs = (reportInfo && reportInfo.reports) || []
  box.innerHTML = '<h3>What you have reported</h3>' + (rs.length ? rs.map(r => `<div class="report-item">
      <div class="report-head"><strong>${esc(r.topic)}</strong><span class="team-chip ${r.status === 'resolved' ? 'team-chip--pass' : 'team-chip--wait'}">${r.status === 'resolved' ? 'Resolved' : 'Open'}</span></div>
      <p class="report-msg">${esc(r.message)}</p>
      ${r.reply ? `<p class="report-reply"><strong>Our reply:</strong> ${esc(r.reply)}</p>` : ''}
      <p class="text-xs text-slate-500" style="margin:4px 0 0">Sent ${fmtDateTime(r.created_at)}</p></div>`).join('')
    : '<p class="text-sm" style="margin:0">Nothing reported yet.</p>')
}
const reportForm = document.getElementById('report-form')
if (reportForm) reportForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  const err = document.getElementById('report-error'); err.hidden = true
  const topic = document.getElementById('report-topic').value, message = document.getElementById('report-message').value.trim()
  const fail = (t, id) => { err.innerHTML = '<strong>Not sent.</strong> ' + esc(t); err.hidden = false; if (id) document.getElementById(id).focus() }
  if (!topic) return fail('Please choose what the problem is about.', 'report-topic')
  if (message.length < 10) return fail('Please tell us what is wrong, in a sentence or two.', 'report-message')
  const btn = reportForm.querySelector('button[type="submit"]'), html = btn.innerHTML
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Sending...'
  try {
    reportInfo = { ...(reportInfo || {}), eligible: true, ...(await api('/api/mp/dashboard/reports', { method: 'POST', body: JSON.stringify({ topic, message }) })) }
    reportForm.reset(); renderReports()
    showToast('Sent. The Bharat AI Innovation team will look into it.')
  } catch (ex) { fail(ex.message) }
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

// What stopped a save, kept at the top of the form until the next try; a toast
// alone is gone in seconds, and on a phone it sits behind the keyboard.
const editError = document.createElement('div')
editError.hidden = true
editError.setAttribute('role', 'alert')
editError.setAttribute('data-edit-error', '')
editError.style.cssText = 'margin-bottom:12px;padding:10px 12px;border-radius:10px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;font-size:13px;line-height:1.6'
editForm.prepend(editError)
const showEditError = (html) => { editError.innerHTML = html; editError.hidden = false; editError.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }
const clearEditError = () => { editError.hidden = true; editError.innerHTML = '' }
const EDIT_LINKS = [['edit-website-url', 'Website URL'], ['edit-product-url', 'Product URL'], ['edit-demo-url', 'Demo URL'], ['edit-video-url', 'Video URL']]

const openEditModal = async (id) => {
  clearEditError()
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
  clearEditError()
  const id = document.getElementById('edit-listing-id').value
  // Links are checked here first, the way the listing form does, so the box is
  // named and what is sent is what is on screen.
  for (const [elId, label] of EDIT_LINKS) {
    const el = document.getElementById(elId); if (!el) continue
    const cleaned = cleanLink(el.value)
    if (cleaned === null) { showEditError(`<strong>Not saved.</strong> ${esc(label)}: please enter a web address, such as example.com or https://example.com.`); el.focus(); return }
    el.value = cleaned
  }
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
  } catch (err) {
    showToast(err.message, true)
    // A new tab, so this one keeps the edit: signing in there sets the cookie this tab sends.
    if (err.status === 401) showEditError('<strong>Not saved: your sign-in has run out.</strong> <a href="/marketplace?signin=1" target="_blank" rel="noopener" style="color:inherit;font-weight:600">Sign in again</a> (it opens in a new tab; exhibitors: use <em>Email me a sign-in link</em>), then come back to this tab and press Save once more. Your changes are kept.')
    else showEditError(`<strong>Not saved.</strong> ${esc(err.message)} Fix this and press Save again.`)
  }
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
  await Promise.all([loadStats(), loadListings(), loadStage(), loadTeam(), loadBooth(), loadLeads(), loadReports(), loadInquiries(), loadReviews(), loadRecentInquiries(), loadDelhi()])
  showToast('Refreshed')
})

document.getElementById('dash-logout').addEventListener('click', async () => {
  await api('/api/mp/auth/logout', { method:'POST' })
  window.location.href = '/marketplace'
})

initDashboard()
