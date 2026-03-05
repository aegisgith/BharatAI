// Bharat AI Marketplace — Listing Detail JS
const toast = document.getElementById('detail-toast')
const showToast = (msg, isError = false) => { toast.textContent = msg; toast.classList.remove('hidden'); toast.classList.toggle('border-rose-500', isError); toast.classList.toggle('border-slate-700', !isError); setTimeout(() => toast.classList.add('hidden'), 3000) }
const toTagList = (v) => (v||'').split(',').map(i => i.trim()).filter(Boolean)
const renderTagRow = (items) => items.length ? items.map(i => `<span class="detail-pill">${i}</span>`).join('') : '<span class="detail-pill muted">—</span>'
const getInitials = (n = '') => n.split(' ').filter(Boolean).slice(0,2).map(p => p[0]).join('').toUpperCase()
const api = async (path, opts = {}) => { const r = await fetch(path, { headers:{'Content-Type':'application/json'}, credentials:'same-origin', ...opts }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error||'Request failed'); return d }

const getVideoEmbedUrl = (url) => {
  const t = (url||'').trim(); if (!t) return ''
  if (t.includes('youtube.com/embed/') || t.includes('player.vimeo.com/video/')) return t
  const wm = t.match(/youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})/); if (wm) return `https://www.youtube.com/embed/${wm[1]}`
  const sm = t.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/); if (sm) return `https://www.youtube.com/embed/${sm[1]}`
  const shm = t.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/); if (shm) return `https://www.youtube.com/embed/${shm[1]}`
  const vm = t.match(/vimeo\.com\/(\d+)/); if (vm) return `https://player.vimeo.com/video/${vm[1]}`
  return ''
}

const demoListings = [
  { id:'demo-1', product_name:'Bharat Insight Copilot', company_name:'NovaSigma AI', description:'Agentic AI copilot that automates policy research, drafting, and compliance workflows.', target_customer:'Enterprise compliance leaders', target_industry:'Banking, Insurance, Financial Services', ai_category:'Risk & Compliance Management, Contract Analysis, AI Agents, LLM-powered, RAG', product_image_url:'https://placehold.co/1200x630/0f172a/34d399?text=Insight+Copilot', tags:'Risk, Compliance, Regulatory', current_customers:'Axis Trust, Meridian Capital', sales_contact_name:'Aisha Khan', sales_contact_email:'sales@novasigma.ai', sales_contact_phone:'+91 98765 43210', innovation:'Combines multi-agent reasoning with regulatory knowledge graphs.', pricing_type:'Enterprise', pricing_details:'Custom annual contract', contact_name:'Priya Rao', founder_name:'Arjun Menon', access_info:'Private pilot program', website_url:'https://example.com', product_url:'https://example.com/product', demo_url:'https://example.com/demo', video_url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ', logo_url:'https://placehold.co/96x96?text=AI', screenshot_urls:'https://placehold.co/800x450?text=Screenshot+1, https://placehold.co/800x450?text=Screenshot+2', awards_rating:5, company_registration:'CIN U72200MH2021PTC123456', company_phone:'+91 22 6789 0000', company_address:'WeWork BKC, Mumbai 400051', cto_name:'Dr. Vikram Sharma', use_cases:'Automated regulatory compliance checks\nPolicy document drafting\nReal-time risk scoring\nAudit trail generation', integration_requirements:'REST API with OAuth 2.0', supported_platforms:'Web, Cloud (AWS, Azure, GCP)', security_protocols:'AES-256 encryption, SOC 2 Type II', tech_stack:'Python, LangChain, GPT-4, Neo4j', case_studies:'Axis Trust reduced compliance review time by 68%.', certifications_compliance:'SOC 2, GDPR, ISO 27001', support_offering:'24/7 dedicated support', sla_details:'99.95% uptime', onboarding_process:'White-glove 4-week implementation' },
  { id:'demo-2', product_name:'Orbit GenAI Studio', company_name:'Helios Labs', description:'Generative AI platform for marketing and brand content.', target_customer:'CMOs', target_industry:'Retail, Consumer Goods', ai_category:'Content Generation, Campaign Automation, Generative AI', product_image_url:'https://placehold.co/1200x630/0f172a/818cf8?text=Orbit+GenAI', tags:'Brand, Campaigns', innovation:'Realtime brand guardrails.', pricing_type:'Paid', pricing_details:'From $1,200/month', awards_rating:4, logo_url:'https://placehold.co/96x96?text=AI' },
  { id:'demo-3', product_name:'Atlas Code Pilot', company_name:'VertexOps', description:'AI dev assistant for SDLC automation.', target_industry:'Software, Telecom', ai_category:'Code Generation / SDLC, DevOps Automation', product_image_url:'https://placehold.co/1200x630/0f172a/fbbf24?text=Atlas+Code', tags:'DevOps, QA', pricing_type:'Paid', awards_rating:4, logo_url:'https://placehold.co/96x96?text=AI' },
  { id:'demo-4', product_name:'Quanta Support Grid', company_name:'Nimbus AI Systems', description:'AI service desk with multilingual voice/chat automation.', target_industry:'Telecom, Utilities', ai_category:'Customer Support Automation, AI Chatbots, Speech / Voice AI', product_image_url:'https://placehold.co/1200x630/0f172a/f472b6?text=Quanta+Support', tags:'Voice AI, Automation', pricing_type:'Paid', awards_rating:4, logo_url:'https://placehold.co/96x96?text=AI' },
  { id:'demo-5', product_name:'Lumina Health AI', company_name:'CareSense', description:'Clinical decision support with secure AI agents.', target_industry:'Healthcare, Pharma', ai_category:'RAG, AI Safety / Guardrails, LLM-powered', product_image_url:'https://placehold.co/1200x630/0f172a/34d399?text=Lumina+Health', tags:'Clinical, Triage', pricing_type:'Enterprise', awards_rating:5, logo_url:'https://placehold.co/96x96?text=AI' }
]

const slugCompany = window.__LISTING_COMPANY_SLUG || null
const slugProduct = window.__LISTING_PRODUCT_SLUG || null
const legacyId = window.__LISTING_LEGACY_ID || null
const listingId = window.location.pathname.split('/').pop()

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

const renderDetail = (listing, isDemo) => {
  document.title = `${listing.product_name} — Bharat AI Marketplace`
  const cats = toTagList(listing.ai_category), inds = toTagList(listing.target_industry), tags = toTagList(listing.tags), screenshots = toTagList(listing.screenshot_urls)
  const videoEmbed = getVideoEmbedUrl(listing.video_url)

  heroLogo.innerHTML = listing.logo_url ? `<img src="${listing.logo_url}" alt="">` : getInitials(listing.product_name)
  heroCompany.textContent = listing.company_name
  heroTitle.textContent = listing.product_name
  heroMeta.innerHTML = `<span><i class="fas fa-star"></i> ${listing.awards_rating||'—'} Rating</span><span>·</span><span>${listing.pricing_type||'Pricing on request'} ${listing.pricing_details||''}</span>${listing.booth_number ? `<span>·</span><span class="listing-booth-badge"><i class="fas fa-map-marker-alt"></i> Booth ${listing.booth_number}</span>` : ''}`

  if (listing.product_url) heroCta.addEventListener('click', () => window.open(listing.product_url, '_blank'))
  else if (listing.demo_url) heroCta.addEventListener('click', () => window.open(listing.demo_url, '_blank'))
  else heroCta.textContent = 'Contact sales'

  salesInfo.textContent = `Sales: ${listing.sales_contact_name||'—'} · ${listing.sales_contact_email||'—'} · ${listing.sales_contact_phone||'—'}`

  // Overview tab
  const overview = document.querySelector('[data-tab-panel="overview"]')
  overview.innerHTML = `
    ${listing.product_image_url ? `<div class="detail-card detail-product-image"><img src="${listing.product_image_url}" alt=""></div>` : ''}
    <div class="detail-card"><h4>Overview</h4><p>${listing.description||'—'}</p></div>
    <div class="detail-card"><h4>Targeting & Categories</h4>
      <div class="detail-tags">
        <div><p class="meta-label">Industries</p><div class="tag-row">${renderTagRow(inds)}</div></div>
        <div><p class="meta-label">AI Categories</p><div class="tag-row">${renderTagRow(cats)}</div></div>
        <div><p class="meta-label">Tags</p><div class="tag-row">${renderTagRow(tags)}</div></div>
      </div>
    </div>
    <div class="detail-card"><h4>Commercial Details</h4>
      <div class="detail-grid">
        <div><p class="meta-label">Target Customer</p><p class="meta-value">${listing.target_customer||'—'}</p></div>
        <div><p class="meta-label">Current Customers</p><p class="meta-value">${listing.current_customers||'—'}</p></div>
        <div><p class="meta-label">Pricing</p><p class="meta-value">${listing.pricing_type||'—'} ${listing.pricing_details||''}</p></div>
        <div><p class="meta-label">Access</p><p class="meta-value">${listing.access_info||'—'}</p></div>
      </div>
    </div>
    <div class="detail-card"><h4>Innovation</h4><p>${listing.innovation||'—'}</p></div>
    ${listing.use_cases ? `<div class="detail-card"><h4>Use Cases</h4><ul class="detail-list">${listing.use_cases.split('\n').filter(Boolean).map(u => `<li>${u.trim()}</li>`).join('')}</ul></div>` : ''}
    ${(listing.supported_platforms || listing.tech_stack || listing.integration_requirements || listing.security_protocols) ? `<div class="detail-card"><h4>Technical Specifications</h4><div class="detail-grid">${listing.supported_platforms ? `<div><p class="meta-label">Platforms</p><p class="meta-value">${listing.supported_platforms}</p></div>` : ''}${listing.tech_stack ? `<div><p class="meta-label">Tech Stack</p><p class="meta-value">${listing.tech_stack}</p></div>` : ''}</div>${listing.integration_requirements ? `<div class="mt-3"><p class="meta-label">Integration</p><p class="meta-value mt-1">${listing.integration_requirements}</p></div>` : ''}${listing.security_protocols ? `<div class="mt-3"><p class="meta-label">Security</p><p class="meta-value mt-1">${listing.security_protocols}</p></div>` : ''}</div>` : ''}
    ${listing.case_studies ? `<div class="detail-card"><h4>Case Studies</h4><p>${listing.case_studies}</p></div>` : ''}
    ${listing.certifications_compliance ? `<div class="detail-card"><h4>Certifications</h4><div class="tag-row">${listing.certifications_compliance.split(',').map(c => c.trim()).filter(Boolean).map(c => `<span class="detail-pill">${c}</span>`).join('')}</div></div>` : ''}
    ${(listing.support_offering || listing.sla_details) ? `<div class="detail-card"><h4>Service & Support</h4><div class="detail-grid">${listing.sla_details ? `<div><p class="meta-label">SLA</p><p class="meta-value">${listing.sla_details}</p></div>` : ''}${listing.onboarding_process ? `<div><p class="meta-label">Onboarding</p><p class="meta-value">${listing.onboarding_process}</p></div>` : ''}</div>${listing.support_offering ? `<div class="mt-3"><p class="meta-label">Support</p><p class="meta-value mt-1">${listing.support_offering}</p></div>` : ''}</div>` : ''}
    ${screenshots.length ? `<div class="detail-card"><h4>Screenshots</h4><div class="detail-media-grid">${screenshots.map(u => `<img src="${u}" alt="Screenshot">`).join('')}</div></div>` : ''}
    ${videoEmbed ? `<div class="detail-card detail-media"><h4>Demo Video</h4><iframe src="${videoEmbed}" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe></div>` : listing.video_url ? `<div class="detail-card"><h4>Demo Video</h4><a class="link" target="_blank" href="${listing.video_url}">${listing.video_url}</a></div>` : ''}`

  // Details tab
  const details = document.querySelector('[data-tab-panel="details"]')
  details.innerHTML = `
    <div class="detail-card"><h4>Company Details</h4><div class="detail-grid">
      <div><p class="meta-label">Company</p><p class="meta-value">${listing.company_name||'—'}</p></div>
      <div><p class="meta-label">Registration</p><p class="meta-value">${listing.company_registration||'—'}</p></div>
      <div><p class="meta-label">Founder/CEO</p><p class="meta-value">${listing.founder_name||'—'}</p></div>
      <div><p class="meta-label">CTO</p><p class="meta-value">${listing.cto_name||'—'}</p></div>
      <div><p class="meta-label">Contact</p><p class="meta-value">${listing.contact_name||'—'}</p></div>
      <div><p class="meta-label">Phone</p><p class="meta-value">${listing.company_phone||'—'}</p></div>
      <div style="grid-column:1/-1"><p class="meta-label">Address</p><p class="meta-value">${listing.company_address||'—'}</p></div>
    </div></div>
    <div class="detail-card"><h4>Sales</h4><div class="detail-grid">
      <div><p class="meta-label">Sales Contact</p><p class="meta-value">${listing.sales_contact_name||'—'}</p></div>
      <div><p class="meta-label">Email</p><p class="meta-value">${listing.sales_contact_email||'—'}</p></div>
      <div><p class="meta-label">Phone</p><p class="meta-value">${listing.sales_contact_phone||'—'}</p></div>
    </div></div>
    <div class="detail-card"><h4>Links</h4><div class="detail-links">
      ${listing.website_url ? `<a class="link" target="_blank" href="${listing.website_url}">Website</a>` : ''}
      ${listing.product_url ? `<a class="link" target="_blank" href="${listing.product_url}">Product</a>` : ''}
      ${listing.demo_url ? `<a class="link" target="_blank" href="${listing.demo_url}">Demo</a>` : ''}
      ${listing.video_url ? `<a class="link" target="_blank" href="${listing.video_url}">Video</a>` : ''}
    </div></div>`

  // Reviews tab
  const reviews = document.querySelector('[data-tab-panel="reviews"]')
  if (isDemo) {
    reviews.innerHTML = '<p class="text-sm text-slate-400 p-4">Reviews available for approved listings only.</p>'
  } else {
    reviews.innerHTML = `<div class="detail-card"><button class="text-sm text-emerald-400" type="button" id="load-reviews">Load reviews</button><div id="review-list" class="review-list"></div><form id="review-form" class="review-form"><input class="form-input" type="number" name="rating" min="1" max="5" placeholder="Rating 1-5" required><input class="form-input" name="comment" placeholder="Write a review"><button class="review-submit">Send</button></form></div>`
    document.getElementById('load-reviews').addEventListener('click', async () => {
      const d = await api(`/api/mp/listings/${listing.id}/reviews`); const rl = document.getElementById('review-list'); rl.innerHTML = ''
      if (!d.reviews.length) { rl.textContent = 'No reviews yet.'; return }
      d.reviews.forEach(r => { const i = document.createElement('div'); i.className = 'review-item'; i.textContent = `${r.company_name}: ${r.rating}/5 ${r.comment||''}`; rl.appendChild(i) })
    })
    document.getElementById('review-form').addEventListener('submit', async (e) => {
      e.preventDefault(); const fd = new FormData(e.target); const p = Object.fromEntries(fd.entries())
      await api(`/api/mp/listings/${listing.id}/reviews`, { method:'POST', body:JSON.stringify({rating:Number(p.rating),comment:p.comment||''}) })
      showToast('Review submitted'); e.target.reset()
    })
  }

  // Inquiry form
  inquiryForm.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (isDemo) { showToast('Inquiries for approved listings only.', true); return }
    const fd = new FormData(inquiryForm); const p = Object.fromEntries(fd.entries())
    await api('/api/mp/inquiries', { method:'POST', body:JSON.stringify({ listing_id:listing.id, inquirer_name:p.inquirer_name, inquirer_email:p.inquirer_email, inquirer_company:p.inquirer_company||'', inquirer_phone:p.inquirer_phone||'', inquirer_message:p.inquirer_message||'' }) })
    inquiryForm.reset(); showToast('Inquiry sent! Sales team will contact you.')
  })
}

const loadListing = async () => {
  try {
    const demoId = legacyId || listingId
    if (demoId && demoId.startsWith('demo-')) { const d = demoListings.find(i => i.id === demoId); if (!d) throw new Error('Not found'); renderDetail(d, true); return }
    if (slugCompany && slugProduct) {
      const mkSlug = t => (t||'').toLowerCase().trim().replace(/&/g,'and').replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'')
      const dbs = demoListings.find(i => mkSlug(i.company_name) === slugCompany && mkSlug(i.product_name) === slugProduct)
      if (dbs) { renderDetail(dbs, true); return }
    }
    let data
    if (slugCompany && slugProduct) data = await api(`/api/mp/listings/by-slug/${slugCompany}/${slugProduct}`)
    else data = await api(`/api/mp/listings/${legacyId || listingId}`)
    if (!data || !data.listing) throw new Error('Empty')
    renderDetail(data.listing, false)
  } catch (err) {
    heroTitle.textContent = 'Unable to load listing'; heroCompany.textContent = 'Error'
    const op = document.querySelector('[data-tab-panel="overview"]')
    if (op) op.innerHTML = `<div class="detail-card"><h4>Error</h4><p>${err.message}</p><p class="text-sm mt-2"><a href="/marketplace" class="text-emerald-400">Back to marketplace</a></p></div>`
    showToast('Unable to load listing', true)
  }
}

setTabs('overview')
loadListing()
