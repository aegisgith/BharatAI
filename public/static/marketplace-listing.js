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
const getInitials = (n = '') => n.split(' ').filter(Boolean).slice(0,2).map(p => p[0]).join('').toUpperCase()
const api = async (path, opts = {}) => { const r = await fetch(path, { headers:{'Content-Type':'application/json'}, credentials:'same-origin', ...opts }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error||'Request failed'); return d }
const text = (v) => String(v == null ? '' : v).trim()
const sameText = (a, b) => text(a).toLowerCase() === text(b).toLowerCase()
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return '' } }
const externalLink = (href, label, cls = 'pd-link') => { const u = safeUrl(href); return u ? `<a class="${cls}" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : '' }

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

// Vendors write these fields as plain text with line breaks. Put into a single <p>,
// a six-paragraph description collapsed into one wall of text. Keep the structure
// they typed: each line a paragraph, "- " runs as a bulleted list, and runs of
// "Step — what happens" lines (how most use cases are written) as numbered steps.
// Everything goes through esc(); nothing here trusts the text.
const BULLET = /^(?:[-*•▪◦·]|\d{1,2}[.)])\s+/
const STEP = /^(.{2,48}?)\s[—–-]\s(.+)$/
const LEAD = /^([A-Z][A-Za-z ()/&]{1,24}):\s+(.+)$/
const proseHTML = (value) => {
  const lines = String(value || '').split(/\r?\n/).map(l => l.trim())
  const out = []
  const nextFilled = (i) => { while (i < lines.length && !lines[i]) i++; return i }
  let i = 0
  while ((i = nextFilled(i)) < lines.length) {
    const steps = []
    let j = i
    while (j < lines.length) {
      const k = nextFilled(j)
      const m = k < lines.length && lines[k].replace(BULLET, '').match(STEP)
      if (!m) break
      steps.push(m); j = k + 1
    }
    if (steps.length >= 2) {
      out.push(`<ol class="pd-steps">${steps.map(m => `<li><strong>${esc(m[1])}</strong>${esc(m[2])}</li>`).join('')}</ol>`)
      i = j; continue
    }
    if (BULLET.test(lines[i])) {
      const items = []
      while (i < lines.length && BULLET.test(lines[i])) items.push(lines[i++].replace(BULLET, ''))
      out.push(`<ul>${items.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`)
      continue
    }
    const lead = lines[i].match(LEAD)
    out.push(lead ? `<p><strong>${esc(lead[1])}:</strong> ${esc(lead[2])}</p>` : `<p>${esc(lines[i])}</p>`)
    i++
  }
  return out.length ? `<div class="pd-prose">${out.join('')}</div>` : ''
}

const slugCompany = window.__LISTING_COMPANY_SLUG || null
const slugProduct = window.__LISTING_PRODUCT_SLUG || null
const legacyId = window.__LISTING_LEGACY_ID || null

const heroEl = document.querySelector('[data-detail-hero]')
const mainEl = document.querySelector('[data-detail-main]')
const asideEl = document.querySelector('[data-detail-aside]')
const inquiryEl = document.getElementById('inquire')
const inquiryForm = document.querySelector('[data-detail-form]')
const inquirySent = document.querySelector('[data-detail-sent]')

const CHIP_LIMIT = 8
const chipGroup = (title, items) => {
  if (!items.length) return ''
  const chips = items.map((c, i) => `<span class="chip${i >= CHIP_LIMIT ? ' is-extra' : ''}">${esc(c)}</span>`).join('')
  const more = items.length > CHIP_LIMIT ? `<button type="button" class="pd-more" aria-expanded="false" data-more="${items.length - CHIP_LIMIT}">+${items.length - CHIP_LIMIT} more</button>` : ''
  return `<div class="pd-chip-group"><h3>${esc(title)}</h3><div class="pd-chips">${chips}${more}</div></div>`
}
const fact = (icon, label, valueHTML) => valueHTML ? `<div class="pd-fact"><dt><i class="fas fa-${icon}" aria-hidden="true"></i>${esc(label)}</dt><dd>${valueHTML}</dd></div>` : ''
const spec = (label, value) => { const v = text(value); return v ? `<div${v.length > 60 ? ' class="is-wide"' : ''}><dt>${esc(label)}</dt><dd>${esc(v)}</dd></div>` : '' }
const telHref = (v) => { const d = text(v).replace(/[^\d+]/g, ''); return d.length >= 6 ? `tel:${d}` : '' }
const contactValue = (v, kind) => {
  const t = text(v); if (!t) return ''
  if (kind === 'email' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return `<a class="pd-link" href="mailto:${esc(t)}">${esc(t)}</a>`
  if (kind === 'tel' && telHref(t)) return `<a class="pd-link" href="${esc(telHref(t))}">${esc(t)}</a>`
  return esc(t)
}

const renderDetail = (listing) => {
  const name = text(listing.product_name) || 'Untitled product'
  const company = text(listing.company_name)
  document.title = `${name} — Bharat AI Marketplace`

  const cats = toTagList(listing.ai_category), inds = toTagList(listing.target_industry), tags = toTagList(listing.tags)
  const certs = toTagList(listing.certifications_compliance)
  const screenshots = toTagList(listing.screenshot_urls).map(safeUrl).filter(Boolean)
  const videoEmbed = getVideoEmbedUrl(listing.video_url)
  const logo = safeUrl(listing.logo_url), image = safeUrl(listing.product_image_url)
  const website = safeUrl(listing.website_url), productUrl = safeUrl(listing.product_url), demoUrl = safeUrl(listing.demo_url), videoUrl = safeUrl(listing.video_url)
  const booth = text(listing.exhibitor_booth || listing.booth_number)
  const priceType = text(listing.pricing_type), priceDetails = text(listing.pricing_details)
  const ctaUrl = productUrl || website || demoUrl
  const ctaLabel = (productUrl || website) ? 'Visit website' : 'View demo'
  const siteForByline = website || productUrl

  // ── Hero
  const priceBadge = priceDetails && priceDetails.length <= 32
    ? `${priceType ? `${esc(priceType)} · ` : ''}${esc(priceDetails)}`
    : esc(priceType || 'Pricing on request')
  heroEl.innerHTML = `<div class="pd-hero-inner">
      <nav class="pd-crumbs" aria-label="Breadcrumb"><a href="/marketplace">AI Marketplace</a><i class="fas fa-chevron-right" aria-hidden="true"></i><span aria-current="page">${esc(name)}</span></nav>
      <div class="pd-hero-main">
        <div class="pd-logo${logo ? '' : ' pd-logo--initials'}">${logo ? `<img src="${esc(logo)}" alt="${esc(company || name)} logo">` : `<span aria-hidden="true">${esc(getInitials(name))}</span>`}</div>
        <div class="pd-title-block">
          <h1 class="pd-title">${esc(name)}</h1>
          <p class="pd-byline">${company && !sameText(company, name) ? `<span>by <strong>${esc(company)}</strong></span>` : ''}${siteForByline ? `<a href="${esc(siteForByline)}" target="_blank" rel="noopener noreferrer"><i class="fas fa-globe" aria-hidden="true"></i>${esc(hostOf(siteForByline))}</a>` : ''}</p>
          <div class="pd-badges">
            <span class="pd-badge pd-badge--price">${priceBadge}</span>
            ${booth ? `<span class="pd-badge pd-badge--booth"><i class="fas fa-location-dot" aria-hidden="true"></i>Booth ${esc(booth)} at Bharat AI Innovation 2026</span>` : ''}
            ${Number(listing.awards_rating) > 0 ? `<span class="pd-badge"><i class="fas fa-star" aria-hidden="true"></i>${esc(listing.awards_rating)} rating</span>` : ''}
          </div>
        </div>
        <div class="pd-actions">
          ${ctaUrl ? `<a class="pd-btn pd-btn--primary" href="${esc(ctaUrl)}" target="_blank" rel="noopener noreferrer">${ctaLabel} <i class="fas fa-arrow-up-right-from-square" aria-hidden="true"></i></a>` : ''}
          <a class="pd-btn ${ctaUrl ? 'pd-btn--ghost' : 'pd-btn--primary'}" href="#inquire"><i class="fas fa-envelope" aria-hidden="true"></i> Send inquiry</a>
        </div>
      </div>
    </div>`

  // ── Main column
  const sections = []
  const section = (id, title, body) => { if (body) sections.push(`<section class="pd-section" id="${id}" aria-labelledby="${id}-title"><h2 id="${id}-title">${esc(title)}</h2>${body}</section>`) }
  section('about', `About ${name}`,
    (image ? `<figure class="pd-product-image"><img src="${esc(image)}" alt="${esc(name)}"></figure>` : '') +
    (proseHTML(listing.description) || `<p class="pd-note">${esc(company || 'This company')} has not added a description yet.</p>`))
  section('audience', 'Who it’s for',
    proseHTML(listing.target_customer) +
    (text(listing.current_customers) ? `<h3 class="pd-subhead">Current customers</h3>${proseHTML(listing.current_customers)}` : ''))
  section('difference', 'What makes it different', proseHTML(listing.innovation))
  section('use-cases', 'Use cases', proseHTML(listing.use_cases))
  section('screenshots', 'Screenshots', screenshots.length
    ? `<div class="pd-media-grid">${screenshots.map((u, n) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer"><img src="${esc(u)}" alt="${esc(name)} screenshot ${n + 1}" loading="lazy"></a>`).join('')}</div>` : '')
  section('video', 'Demo video', videoEmbed
    ? `<div class="pd-video"><iframe src="${esc(videoEmbed)}" title="${esc(name)} demo video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`
    : videoUrl ? `<p class="pd-note">${externalLink(videoUrl, 'Watch the demo video')}</p>` : '')
  section('case-studies', 'Case studies', proseHTML(listing.case_studies))
  const specs = spec('Platforms', listing.supported_platforms) + spec('Tech stack', listing.tech_stack) + spec('Integration', listing.integration_requirements) + spec('Security', listing.security_protocols) + spec('Certifications', certs.join(', '))
  section('technical', 'Technical details', specs ? `<dl class="pd-specs">${specs}</dl>` : '')
  const support = spec('Support', listing.support_offering) + spec('Onboarding', listing.onboarding_process) + spec('SLA', listing.sla_details)
  section('support', 'Service and support', support ? `<dl class="pd-specs">${support}</dl>` : '')
  section('reviews', 'Reviews', '<div data-reviews><p class="pd-note">Loading reviews…</p></div>')
  mainEl.innerHTML = sections.join('')

  // ── Sidebar
  const price = priceDetails || priceType || 'Pricing on request'
  const pricePanel = `<section class="pd-panel" aria-labelledby="pd-pricing-title">
      <h2 class="pd-panel-title" id="pd-pricing-title">Pricing</h2>
      <p class="pd-price${price.length > 22 ? ' pd-price--long' : ''}">${esc(price)}</p>
      ${priceDetails && priceType ? `<p class="pd-price-type">${esc(priceType)}</p>` : ''}
      ${text(listing.access_info) ? `<div class="pd-access"><h3 class="pd-panel-title">How to get access</h3><p>${esc(listing.access_info)}</p></div>` : ''}
    </section>`

  const companyFacts = [
    fact('building', 'Name', sameText(company, name) ? '' : esc(company)),
    fact('building', 'Registration', esc(text(listing.company_registration))),
    fact('user-tie', 'Founder / CEO', esc(text(listing.founder_name))),
    fact('user-tie', 'CTO', esc(text(listing.cto_name))),
    fact('location-dot', 'Based in', esc(text(listing.company_address))),
    fact('globe', 'Website', website ? externalLink(website, hostOf(website)) : ''),
    fact('phone', 'Phone', contactValue(listing.company_phone, 'tel')),
  ].join('')
  const salesFacts = [
    fact('user-tie', 'Contact', esc(text(listing.sales_contact_name) || text(listing.contact_name))),
    fact('envelope', 'Email', contactValue(listing.sales_contact_email, 'email')),
    fact('phone', 'Phone', sameText(listing.sales_contact_phone, listing.company_phone) ? '' : contactValue(listing.sales_contact_phone, 'tel')),
  ].join('')
  const extraLinks = [
    productUrl && productUrl !== website ? fact('arrow-up-right-from-square', 'Product page', externalLink(productUrl, hostOf(productUrl))) : '',
    demoUrl ? fact('arrow-up-right-from-square', 'Demo', externalLink(demoUrl, hostOf(demoUrl))) : '',
  ].join('')
  const companyPanel = (companyFacts || salesFacts || extraLinks) ? `<section class="pd-panel" aria-labelledby="pd-company-title">
      <h2 class="pd-panel-title" id="pd-company-title">Company</h2>
      ${companyFacts || extraLinks ? `<dl class="pd-facts">${companyFacts}${extraLinks}</dl>` : ''}
      ${salesFacts ? `${companyFacts || extraLinks ? '<hr class="pd-panel-divider">' : ''}<h2 class="pd-panel-title">Sales contact</h2><dl class="pd-facts">${salesFacts}</dl>` : ''}
    </section>` : ''

  const chipsHTML = chipGroup('Industries', inds) + chipGroup('AI categories', cats) + chipGroup('Tags', tags)
  const chipsPanel = chipsHTML ? `<section class="pd-panel" aria-label="Industries and categories">${chipsHTML}</section>` : ''
  asideEl.innerHTML = pricePanel + companyPanel + chipsPanel
  asideEl.querySelectorAll('.pd-more').forEach(btn => btn.addEventListener('click', () => {
    const box = btn.closest('.pd-chips'); const open = box.classList.toggle('is-open')
    btn.setAttribute('aria-expanded', String(open))
    btn.textContent = open ? 'Show fewer' : `+${btn.dataset.more} more`
  }))

  // ── Inquiry
  document.querySelector('[data-detail-inquiry-title]').textContent = `Ask ${name} a question`
  document.querySelector('[data-detail-inquiry-sub]').textContent = `Your message is emailed to the ${company || name} team with your contact details, so they can reply to you directly.`
  inquiryEl.classList.remove('hidden')
  inquiryForm.addEventListener('submit', async (e) => {
    e.preventDefault()
    const btn = inquiryForm.querySelector('button[type="submit"]')
    const idle = btn.innerHTML
    btn.disabled = true; btn.textContent = 'Sending…'
    const p = Object.fromEntries(new FormData(inquiryForm).entries())
    try {
      await api('/api/mp/inquiries', { method:'POST', body:JSON.stringify({ listing_id:listing.id, inquirer_name:p.inquirer_name, inquirer_email:p.inquirer_email, inquirer_company:p.inquirer_company||'', inquirer_phone:p.inquirer_phone||'', inquirer_message:p.inquirer_message||'' }) })
      inquiryForm.reset(); inquiryForm.classList.add('hidden')
      inquirySent.innerHTML = `<div class="pd-sent" role="status"><i class="fas fa-circle-check" aria-hidden="true"></i><div><strong>Inquiry sent</strong><p>${esc(company || name)} will reply to ${esc(p.inquirer_email)}.</p><button type="button" data-send-another>Send another inquiry</button></div></div>`
      inquirySent.querySelector('[data-send-another]').addEventListener('click', () => { inquirySent.innerHTML = ''; inquiryForm.classList.remove('hidden'); inquiryForm.querySelector('input')?.focus() })
    } catch (err) { showToast(err.message, true) }
    finally { btn.disabled = false; btn.innerHTML = idle }
  })

  loadReviews(listing)
}

// ── Reviews: loaded with the page rather than behind a "Load reviews" button.
const stars = (rating) => {
  // A star lights up from x.75, so a 4.5 average shows four, not five.
  const r = Math.max(0, Math.min(5, Math.floor((Number(rating) || 0) + 0.25)))
  return `<span class="pd-stars" role="img" aria-label="${r} out of 5 stars">${[1,2,3,4,5].map(n => `<i class="fas fa-star${n > r ? ' is-off' : ''}" aria-hidden="true"></i>`).join('')}</span>`
}
const formatDate = (v) => { const d = new Date(String(v || '').replace(' ', 'T') + 'Z'); return isNaN(d) ? '' : d.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) }

const loadReviews = async (listing) => {
  const box = mainEl.querySelector('[data-reviews]'); if (!box) return
  const [reviewsRes, meRes] = await Promise.allSettled([
    api(`/api/mp/listings/${encodeURIComponent(listing.id)}/reviews`),
    api('/api/mp/auth/me'),
  ])
  const reviews = reviewsRes.status === 'fulfilled' ? (reviewsRes.value.reviews || []) : null
  const user = meRes.status === 'fulfilled' ? meRes.value.user : null

  let html = ''
  if (reviews === null) html = '<p class="pd-note">Reviews could not be loaded right now.</p>'
  else if (!reviews.length) html = '<p class="pd-note">No reviews yet.</p>'
  else {
    const avg = reviews.reduce((s, r) => s + (Number(r.rating) || 0), 0) / reviews.length
    html = `<div class="pd-rating"><span class="pd-rating-value">${avg.toFixed(1)}</span><div>${stars(avg)}<div class="pd-rating-count">${reviews.length} review${reviews.length === 1 ? '' : 's'}</div></div></div>` +
      reviews.map(r => `<article class="pd-review"><div class="pd-review-head"><strong>${esc(r.company_name)}</strong>${stars(r.rating)}</div>${text(r.comment) ? `<p>${esc(r.comment)}</p>` : ''}${formatDate(r.created_at) ? `<div class="pd-review-date">${esc(formatDate(r.created_at))}</div>` : ''}</article>`).join('')
  }

  if (!user) html += '<div class="pd-review-form"><p class="pd-note">Companies with a marketplace account can review products. <a href="/marketplace/dashboard">Sign in to your company account</a></p></div>'
  else if (Number(user.id) === Number(listing.company_id)) html += '<div class="pd-review-form"><p class="pd-note">This is your listing. You can update it from <a href="/marketplace/dashboard">your dashboard</a>.</p></div>'
  else html += `<form class="pd-review-form" data-review-form>
      <h3>Review ${esc(text(listing.product_name))}</h3>
      <fieldset class="pd-star-input"><legend>Your rating</legend>
        <div class="pd-star-row">${[5,4,3,2,1].map(n => `<input type="radio" id="rv-${n}" name="rating" value="${n}" required><label for="rv-${n}" title="${n} star${n === 1 ? '' : 's'}"><i class="fas fa-star" aria-hidden="true"></i><span class="mp-sr">${n} star${n === 1 ? '' : 's'}</span></label>`).join('')}</div>
      </fieldset>
      <div class="pd-field"><label for="rv-comment">Comment <span class="pd-optional">(optional)</span></label><textarea id="rv-comment" name="comment" rows="3" maxlength="2000"></textarea></div>
      <div><button type="submit" class="pd-btn pd-btn--ghost">Post review as ${esc(user.company_name)}</button></div>
    </form>`
  box.innerHTML = html

  const form = box.querySelector('[data-review-form]')
  if (form) form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const p = Object.fromEntries(new FormData(form).entries())
    const btn = form.querySelector('button[type="submit"]'); btn.disabled = true
    try {
      await api(`/api/mp/listings/${encodeURIComponent(listing.id)}/reviews`, { method:'POST', body:JSON.stringify({ rating:Number(p.rating), comment:p.comment||'' }) })
      showToast('Review posted'); loadReviews(listing)
    } catch (err) { btn.disabled = false; showToast(err.message === 'Login required' ? 'Sign in with a marketplace company account to review' : err.message, true) }
  })
}

const showNotFound = (message) => {
  document.title = 'Listing not available — Bharat AI Marketplace'
  heroEl.remove()
  const layout = document.querySelector('[data-detail-layout]')
  layout.className = ''
  layout.innerHTML = `<div class="pd-missing">
    <i class="fa-solid fa-store" aria-hidden="true"></i>
    <h1>We couldn’t find this listing</h1>
    <p>${esc(message)}</p>
    <a class="pd-btn pd-btn--primary" href="/marketplace">Browse all AI products</a>
  </div>`
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

loadListing()
