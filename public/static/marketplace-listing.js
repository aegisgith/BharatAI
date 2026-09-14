// Bharat AI Marketplace — Listing Detail JS

// Every listing field is vendor-typed and was interpolated into innerHTML raw, so
// once a listing was approved its text ran as script for every visitor.
const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
// Only our own upload URLs and http(s) links may reach a src, href or window.open.
const safeUrl = (v) => {
  const s = String(v == null ? '' : v).trim()
  if (/^\/api\/mp\/uploads\/\d+$/.test(s)) return s
  try { const u = new URL(s); return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : '' } catch { return '' }
}

const toast = document.getElementById('detail-toast')
const showToast = (msg, isError = false) => { toast.textContent = msg; toast.classList.remove('hidden'); toast.classList.toggle('border-rose-500', isError); toast.classList.toggle('border-slate-700', !isError); clearTimeout(showToast.t); showToast.t = setTimeout(() => toast.classList.add('hidden'), isError ? 6000 : 3500) }
const toTagList = (v) => (v||'').split(',').map(i => i.trim()).filter(Boolean)
const renderTagRow = (items) => items.length ? items.map(i => `<span class="detail-pill">${esc(i)}</span>`).join('') : '<span class="detail-pill muted">—</span>'
const getInitials = (n = '') => n.split(' ').filter(Boolean).slice(0,2).map(p => p[0]).join('').toUpperCase()
const api = async (path, opts = {}) => { const r = await fetch(path, { headers:{'Content-Type':'application/json'}, credentials:'same-origin', ...opts }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error||'Request failed'); return d }
const link = (href, label) => { const u = safeUrl(href); return u ? `<a class="link" target="_blank" rel="noopener noreferrer" href="${esc(u)}">${esc(label)}</a>` : '' }
const metaItem = (label, value, extra = '') => `<div${extra}><p class="meta-label">${esc(label)}</p><p class="meta-value">${esc(value || '—')}</p></div>`

const getVideoEmbedUrl = (url) => {
  const t = (url||'').trim(); if (!t) return ''
  const em = t.match(/^https:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/embed\/([a-zA-Z0-9_-]{11})/); if (em) return `https://www.youtube.com/embed/${em[1]}`
  const pv = t.match(/^https:\/\/player\.vimeo\.com\/video\/(\d+)/); if (pv) return `https://player.vimeo.com/video/${pv[1]}`
  const wm = t.match(/youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})/); if (wm) return `https://www.youtube.com/embed/${wm[1]}`
  const sm = t.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/); if (sm) return `https://www.youtube.com/embed/${sm[1]}`
  const shm = t.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/); if (shm) return `https://www.youtube.com/embed/${shm[1]}`
  const vm = t.match(/vimeo\.com\/(\d+)/); if (vm) return `https://player.vimeo.com/video/${vm[1]}`
  return ''
}

// The five invented demo listings that lived here (NovaSigma AI, Helios Labs...)
// were still reachable by URL, with made-up sales names, emails and phone numbers
// shown as real. Removed: a listing page shows an approved listing or nothing.

const slugCompany = window.__LISTING_COMPANY_SLUG || null
const slugProduct = window.__LISTING_PRODUCT_SLUG || null
const legacyId = window.__LISTING_LEGACY_ID || null

const heroLogo = document.querySelector('[data-detail-logo]')
const heroCompany = document.querySelector('[data-detail-company]')
const heroTitle = document.querySelector('[data-detail-title]')
const heroMeta = document.querySelector('[data-detail-meta]')
const heroCta = document.querySelector('[data-detail-cta]')
const heroInquire = document.querySelector('[data-detail-inquire]')
const salesInfo = document.querySelector('[data-detail-sales]')
const inquiryForm = document.querySelector('[data-detail-form]')
const tabButtons = document.querySelectorAll('[data-tab]')
const tabPanels = document.querySelectorAll('[data-tab-panel]')

const setTabs = (active) => {
  tabButtons.forEach(b => b.classList.toggle('tab-active', b.dataset.tab === active))
  tabPanels.forEach(p => p.classList.toggle('hidden', p.dataset.tabPanel !== active))
}
tabButtons.forEach(b => b.addEventListener('click', () => setTabs(b.dataset.tab)))
heroInquire.addEventListener('click', () => inquiryForm.scrollIntoView({ behavior:'smooth' }))

const renderDetail = (listing) => {
  document.title = `${listing.product_name} — Bharat AI Marketplace`
  const cats = toTagList(listing.ai_category), inds = toTagList(listing.target_industry), tags = toTagList(listing.tags)
  const screenshots = toTagList(listing.screenshot_urls).map(safeUrl).filter(Boolean)
  const videoEmbed = getVideoEmbedUrl(listing.video_url)
  const logo = safeUrl(listing.logo_url), image = safeUrl(listing.product_image_url)
  const booth = listing.exhibitor_booth || listing.booth_number
  const pricing = [listing.pricing_type, listing.pricing_details].filter(Boolean).join(' ')

  heroLogo.innerHTML = logo ? `<img src="${esc(logo)}" alt="">` : esc(getInitials(listing.product_name))
  heroCompany.textContent = listing.company_name
  heroTitle.textContent = listing.product_name
  const rating = Number(listing.awards_rating) > 0 ? `<span><i class="fas fa-star"></i> ${esc(listing.awards_rating)} Rating</span><span>·</span>` : ''
  heroMeta.innerHTML = `${rating}<span>${esc(pricing || 'Pricing on request')}</span>${booth ? `<span>·</span><span class="listing-booth-badge"><i class="fas fa-map-marker-alt"></i> Booth ${esc(booth)}</span>` : ''}`

  const ctaUrl = safeUrl(listing.product_url) || safeUrl(listing.demo_url)
  if (ctaUrl) heroCta.addEventListener('click', () => window.open(ctaUrl, '_blank', 'noopener'))
  else { heroCta.textContent = 'Contact sales'; heroCta.addEventListener('click', () => inquiryForm.scrollIntoView({ behavior:'smooth' })) }

  salesInfo.textContent = `Sales: ${listing.sales_contact_name||'—'} · ${listing.sales_contact_email||'—'} · ${listing.sales_contact_phone||'—'}`

  // Overview tab
  const overview = document.querySelector('[data-tab-panel="overview"]')
  const useCases = String(listing.use_cases || '').split('\n').map(u => u.trim()).filter(Boolean)
  const certs = toTagList(listing.certifications_compliance)
  overview.innerHTML = `
    ${image ? `<div class="detail-card detail-product-image"><img src="${esc(image)}" alt=""></div>` : ''}
    <div class="detail-card"><h4>Overview</h4><p>${esc(listing.description || '—')}</p></div>
    <div class="detail-card"><h4>Targeting & Categories</h4>
      <div class="detail-tags">
        <div><p class="meta-label">Industries</p><div class="tag-row">${renderTagRow(inds)}</div></div>
        <div><p class="meta-label">AI Categories</p><div class="tag-row">${renderTagRow(cats)}</div></div>
        <div><p class="meta-label">Tags</p><div class="tag-row">${renderTagRow(tags)}</div></div>
      </div>
    </div>
    <div class="detail-card"><h4>Commercial Details</h4>
      <div class="detail-grid">
        ${metaItem('Target Customer', listing.target_customer)}
        ${metaItem('Current Customers', listing.current_customers)}
        ${metaItem('Pricing', pricing)}
        ${metaItem('Access', listing.access_info)}
      </div>
    </div>
    <div class="detail-card"><h4>Innovation</h4><p>${esc(listing.innovation || '—')}</p></div>
    ${useCases.length ? `<div class="detail-card"><h4>Use Cases</h4><ul class="detail-list">${useCases.map(u => `<li>${esc(u)}</li>`).join('')}</ul></div>` : ''}
    ${(listing.supported_platforms || listing.tech_stack || listing.integration_requirements || listing.security_protocols) ? `<div class="detail-card"><h4>Technical Specifications</h4><div class="detail-grid">${listing.supported_platforms ? metaItem('Platforms', listing.supported_platforms) : ''}${listing.tech_stack ? metaItem('Tech Stack', listing.tech_stack) : ''}</div>${listing.integration_requirements ? `<div class="mt-3"><p class="meta-label">Integration</p><p class="meta-value mt-1">${esc(listing.integration_requirements)}</p></div>` : ''}${listing.security_protocols ? `<div class="mt-3"><p class="meta-label">Security</p><p class="meta-value mt-1">${esc(listing.security_protocols)}</p></div>` : ''}</div>` : ''}
    ${listing.case_studies ? `<div class="detail-card"><h4>Case Studies</h4><p>${esc(listing.case_studies)}</p></div>` : ''}
    ${certs.length ? `<div class="detail-card"><h4>Certifications</h4><div class="tag-row">${certs.map(c => `<span class="detail-pill">${esc(c)}</span>`).join('')}</div></div>` : ''}
    ${(listing.support_offering || listing.sla_details || listing.onboarding_process) ? `<div class="detail-card"><h4>Service & Support</h4><div class="detail-grid">${listing.sla_details ? metaItem('SLA', listing.sla_details) : ''}${listing.onboarding_process ? metaItem('Onboarding', listing.onboarding_process) : ''}</div>${listing.support_offering ? `<div class="mt-3"><p class="meta-label">Support</p><p class="meta-value mt-1">${esc(listing.support_offering)}</p></div>` : ''}</div>` : ''}
    ${screenshots.length ? `<div class="detail-card"><h4>Screenshots</h4><div class="detail-media-grid">${screenshots.map(u => `<img src="${esc(u)}" alt="Screenshot" loading="lazy">`).join('')}</div></div>` : ''}
    ${videoEmbed ? `<div class="detail-card detail-media"><h4>Demo Video</h4><iframe src="${esc(videoEmbed)}" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe></div>` : safeUrl(listing.video_url) ? `<div class="detail-card"><h4>Demo Video</h4>${link(listing.video_url, listing.video_url)}</div>` : ''}`

  // Details tab
  const details = document.querySelector('[data-tab-panel="details"]')
  details.innerHTML = `
    <div class="detail-card"><h4>Company Details</h4><div class="detail-grid">
      ${metaItem('Company', listing.company_name)}
      ${metaItem('Registration', listing.company_registration)}
      ${metaItem('Founder/CEO', listing.founder_name)}
      ${metaItem('CTO', listing.cto_name)}
      ${metaItem('Contact', listing.contact_name)}
      ${metaItem('Phone', listing.company_phone)}
      ${metaItem('Address', listing.company_address, ' style="grid-column:1/-1"')}
    </div></div>
    <div class="detail-card"><h4>Sales</h4><div class="detail-grid">
      ${metaItem('Sales Contact', listing.sales_contact_name)}
      ${metaItem('Email', listing.sales_contact_email)}
      ${metaItem('Phone', listing.sales_contact_phone)}
    </div></div>
    <div class="detail-card"><h4>Links</h4><div class="detail-links">
      ${link(listing.website_url, 'Website')}${link(listing.product_url, 'Product')}${link(listing.demo_url, 'Demo')}${link(listing.video_url, 'Video')}
    </div></div>`

  // Reviews tab
  const reviews = document.querySelector('[data-tab-panel="reviews"]')
  reviews.innerHTML = `<div class="detail-card"><button class="text-sm text-emerald-400" type="button" id="load-reviews">Load reviews</button><div id="review-list" class="review-list"></div><form id="review-form" class="review-form"><input class="form-input" type="number" name="rating" min="1" max="5" placeholder="Rating 1-5" required><input class="form-input" name="comment" placeholder="Write a review"><button class="review-submit">Send</button></form></div>`
  document.getElementById('load-reviews').addEventListener('click', async () => {
    const rl = document.getElementById('review-list')
    try {
      const d = await api(`/api/mp/listings/${encodeURIComponent(listing.id)}/reviews`); rl.innerHTML = ''
      if (!d.reviews.length) { rl.textContent = 'No reviews yet.'; return }
      d.reviews.forEach(r => { const i = document.createElement('div'); i.className = 'review-item'; i.textContent = `${r.company_name}: ${r.rating}/5 ${r.comment||''}`; rl.appendChild(i) })
    } catch (err) { showToast(err.message, true) }
  })
  document.getElementById('review-form').addEventListener('submit', async (e) => {
    e.preventDefault(); const p = Object.fromEntries(new FormData(e.target).entries())
    try {
      await api(`/api/mp/listings/${encodeURIComponent(listing.id)}/reviews`, { method:'POST', body:JSON.stringify({rating:Number(p.rating),comment:p.comment||''}) })
      showToast('Review submitted'); e.target.reset()
    } catch (err) { showToast(err.message === 'Login required' ? 'Log in with a marketplace company account to review' : err.message, true) }
  })

  // Inquiry form
  inquiryForm.addEventListener('submit', async (e) => {
    e.preventDefault()
    const btn = inquiryForm.querySelector('button[type="submit"]'); if (btn) btn.disabled = true
    const p = Object.fromEntries(new FormData(inquiryForm).entries())
    try {
      await api('/api/mp/inquiries', { method:'POST', body:JSON.stringify({ listing_id:listing.id, inquirer_name:p.inquirer_name, inquirer_email:p.inquirer_email, inquirer_company:p.inquirer_company||'', inquirer_phone:p.inquirer_phone||'', inquirer_message:p.inquirer_message||'' }) })
      inquiryForm.reset(); showToast('Inquiry sent! The company will contact you.')
    } catch (err) { showToast(err.message, true) }
    finally { if (btn) btn.disabled = false }
  })
}

const showNotFound = (message) => {
  heroTitle.textContent = 'Listing not available'; heroCompany.textContent = ''
  heroCta.classList.add('hidden'); heroInquire.classList.add('hidden')
  document.querySelector('.detail-inquiry')?.classList.add('hidden')
  document.querySelector('.detail-tabs')?.classList.add('hidden')
  const op = document.querySelector('[data-tab-panel="overview"]')
  if (op) op.innerHTML = `<div class="detail-card"><h4>We couldn't find this listing</h4><p>${esc(message)}</p><p class="text-sm mt-2"><a href="/marketplace" class="text-emerald-400">Back to marketplace</a></p></div>`
}

const loadListing = async () => {
  try {
    const data = (slugCompany && slugProduct)
      ? await api(`/api/mp/listings/by-slug/${encodeURIComponent(slugCompany)}/${encodeURIComponent(slugProduct)}`)
      : await api(`/api/mp/listings/${encodeURIComponent(legacyId || window.location.pathname.split('/').pop())}`)
    if (!data || !data.listing) throw new Error('Listing not found')
    renderDetail(data.listing)
  } catch (err) {
    showNotFound(err.message === 'Listing not found' ? 'It may not be approved yet, or it may have been removed.' : err.message)
  }
}

setTabs('overview')
loadListing()
