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

// Logos come as square icons, long wordmarks, or a small mark on a big empty
// canvas. Trim the empty border so the mark fills its tile, and let a wide logo
// widen the tile instead of shrinking to a sliver. A logo on its own coloured
// square is kept whole. Same trim as the browse cards (marketplace-app.js).
const trimLogo = (img) => {
  const w = img.naturalWidth, h = img.naturalHeight
  const s = Math.min(1, 320 / Math.max(w, h))
  const cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s))
  const c = document.createElement('canvas'); c.width = cw; c.height = ch
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, cw, ch)
  const px = ctx.getImageData(0, 0, cw, ch).data
  const at = (x, y) => (y * cw + x) * 4
  const clear = (i) => px[i + 3] < 24
  const white = (i) => px[i] > 238 && px[i + 1] > 238 && px[i + 2] > 238
  const corners = [at(0, 0), at(cw - 1, 0), at(0, ch - 1), at(cw - 1, ch - 1)]
  const empty = corners.every(clear) ? clear : corners.every(i => clear(i) || white(i)) ? (i) => clear(i) || white(i) : null
  if (!empty) return { w, h, tile: true }
  let x0 = cw, y0 = ch, x1 = -1, y1 = -1, ink = 0, light = 0
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const i = at(x, y)
    if (empty(i)) continue
    ink++; if (px[i] > 200 && px[i + 1] > 200 && px[i + 2] > 200) light++
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
  }
  if (x1 < 0) return { w, h }
  // A white logo on a clear background (the version made for dark pages) vanishes
  // on a white tile: it gets a dark one.
  const dark = empty === clear && light / ink > 0.5
  const sx = Math.max(0, (x0 - 1) / s), sy = Math.max(0, (y0 - 1) / s)
  const sw = Math.min(w - sx, (x1 - x0 + 3) / s), sh = Math.min(h - sy, (y1 - y0 + 3) / s)
  if (sw * sh > 0.9 * w * h) return { w, h, dark }
  const k = Math.min(1, 640 / Math.max(sw, sh))
  const out = document.createElement('canvas'); out.width = Math.max(1, Math.round(sw * k)); out.height = Math.max(1, Math.round(sh * k))
  out.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, out.width, out.height)
  return { w: sw, h: sh, dark, src: out.toDataURL('image/png') }
}
const watchHeroLogo = (img, initials) => {
  const box = img.parentElement
  img.addEventListener('error', () => {
    box.classList.add('pd-logo--initials')
    box.innerHTML = `<span aria-hidden="true">${esc(initials)}</span>`
  }, { once: true })
  const fit = () => {
    let r = null
    try { r = trimLogo(img) } catch {} // a logo on another site cannot be read: shown as it is
    if (r && r.tile) return
    if (r && r.src) img.src = r.src
    if (r && r.dark) box.classList.add('pd-logo--dark')
    const w = (r && r.w) || img.naturalWidth, h = (r && r.h) || img.naturalHeight
    const wide = w / h > 1.6
    box.classList.add(wide ? 'pd-logo--wide' : 'pd-logo--fitted')
    // On a phone a wide logo takes its own line, so the title keeps the width.
    if (wide && box.parentElement) box.parentElement.classList.add('pd-hero-main--wide-logo')
  }
  if (img.complete && img.naturalWidth) fit()
  else img.addEventListener('load', fit, { once: true })
}
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
// A use case per line, which is how the form asks for them, reads as a list.
const asList = (value) => {
  const lines = String(value || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  return lines.length >= 2 ? lines.map(l => '- ' + l.replace(BULLET, '')).join('\n') : value
}
// Web addresses typed into a field become links. Everything else stays plain, escaped text.
const linkified = (value) => String(value == null ? '' : value).split(/(https?:\/\/[^\s,;)]+)/).map((part, i) => {
  if (i % 2 === 0) return esc(part)
  const u = safeUrl(part)
  return u ? `<a class="pd-link" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(hostOf(u) + new URL(u).pathname.replace(/\/$/, ''))}</a>` : esc(part)
}).join('')
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
  // Asking here comes first: the inquiry reaches the exhibitor, while the website takes the
  // buyer off the page.
  const askButton = `<a class="pd-btn pd-btn--primary" href="#inquire"><i class="fas fa-envelope" aria-hidden="true"></i> Send inquiry</a>`
  const siteButton = ctaUrl ? `<a class="pd-btn pd-btn--ghost" href="${esc(ctaUrl)}" target="_blank" rel="noopener noreferrer">${ctaLabel} <i class="fas fa-arrow-up-right-from-square" aria-hidden="true"></i></a>` : ''
  // Some exhibitors typed the same word in both boxes: "Freemium · Freemium" says it once.
  const priceBadge = priceDetails && priceDetails.length <= 60 && !sameText(priceDetails, priceType)
    ? `${priceType ? `${esc(priceType)} · ` : ''}${esc(priceDetails)}`
    : esc(priceType || 'Pricing on request')
  // Each word of the title rises on its own (marketplace-motion.css). The words stay real text.
  const titleWords = name.split(/\s+/).map((w, i) => `<span class="mk-w"><span style="--i:${Math.min(i, 8)}">${esc(w)}</span></span>`).join(' ')
  heroEl.innerHTML = `<div class="mk-aurora" aria-hidden="true"><i></i></div><div class="pd-hero-inner">
      <nav class="pd-crumbs" aria-label="Breadcrumb"><a href="/marketplace">AI Marketplace</a><i class="fas fa-chevron-right" aria-hidden="true"></i><span aria-current="page">${esc(name)}</span></nav>
      <div class="pd-hero-main">
        <div class="pd-logo${logo ? '' : ' pd-logo--initials'}">${logo ? `<img src="${esc(logo)}" alt="${esc(company || name)} logo">` : `<span aria-hidden="true">${esc(getInitials(name))}</span>`}</div>
        <div class="pd-title-block">
          <h1 class="pd-title${name.length > 34 ? ' pd-title--long' : ''}">${titleWords}</h1>
          <p class="pd-byline">${company && !sameText(company, name) ? `<span>by <strong>${esc(company)}</strong></span>` : ''}${siteForByline ? `<a href="${esc(siteForByline)}" target="_blank" rel="noopener noreferrer"><i class="fas fa-globe" aria-hidden="true"></i>${esc(hostOf(siteForByline))}</a>` : ''}</p>
          <div class="pd-badges">
            <span class="pd-badge pd-badge--price">${priceBadge}</span>
            ${booth ? `<span class="pd-badge pd-badge--booth"><i class="fas fa-location-dot" aria-hidden="true"></i>Booth ${esc(booth)} at Bharat AI Innovation 2026</span>` : ''}
            ${Number(listing.awards_rating) > 0 ? `<span class="pd-badge"><i class="fas fa-star" aria-hidden="true"></i>${esc(listing.awards_rating)} rating</span>` : ''}
          </div>
        </div>
        <div class="pd-actions">
          ${askButton}
          ${siteButton}
        </div>
      </div>
    </div>`
  const heroLogo = heroEl.querySelector('.pd-logo img')
  if (heroLogo) watchHeroLogo(heroLogo, getInitials(name))

  // ── Main column
  const sections = []
  const section = (id, title, body) => { if (body) sections.push(`<section class="pd-section" id="${id}" aria-labelledby="${id}-title"><h2 id="${id}-title">${esc(title)}</h2>${body}</section>`) }
  // Folded: the long reference parts. Closed on a phone, open on a laptop.
  const folded = (id, title, body, always) => { if (body) sections.push(`<details class="pd-section pd-fold" id="${id}"${always ? '' : ' data-fold'}><summary><h2 id="${id}-title">${esc(title)}</h2></summary><div class="pd-fold-body">${body}</div></details>`) }
  section('about', name.length > 34 ? 'About this product' : `About ${name}`,
    (image ? `<figure class="pd-product-image"><img src="${esc(image)}" alt="${esc(name)}"></figure>` : '') +
    (listing.description && text(listing.description) ? `<div class="pd-clamp">${proseHTML(listing.description)}</div><button type="button" class="pd-more-text" aria-expanded="false">Read more</button>` : `<p class="pd-note">${esc(company || 'This company')} has not added a description yet.</p>`))
  section('audience', 'Who it’s for',
    proseHTML(listing.target_customer) +
    (text(listing.current_customers) ? `<h3 class="pd-subhead">Current customers</h3>${proseHTML(listing.current_customers)}` : ''))
  section('difference', 'What makes it different', proseHTML(listing.innovation))
  section('use-cases', 'Use cases', proseHTML(asList(listing.use_cases)))
  section('screenshots', 'Screenshots', screenshots.length
    ? `<div class="pd-media-grid">${screenshots.map((u, n) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer"><img src="${esc(u)}" alt="${esc(name)} screenshot ${n + 1}" loading="lazy"></a>`).join('')}</div>` : '')
  section('video', 'Demo video', videoEmbed
    ? `<div class="pd-video"><iframe src="${esc(videoEmbed)}" title="${esc(name)} demo video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`
    : videoUrl ? `<p class="pd-note">${externalLink(videoUrl, 'Watch the demo video')}</p>` : '')
  section('case-studies', 'Case studies', proseHTML(listing.case_studies))
  const specs = spec('Platforms', listing.supported_platforms) + spec('Tech stack', listing.tech_stack) + spec('Integration', listing.integration_requirements) + spec('Security', listing.security_protocols) + spec('Certifications', certs.join(', '))
  folded('technical', 'Technical details', specs ? `<dl class="pd-specs">${specs}</dl>` : '')
  const support = spec('Support', listing.support_offering) + spec('Onboarding', listing.onboarding_process) + spec('SLA', listing.sla_details)
  folded('support', 'Service and support', support ? `<dl class="pd-specs">${support}</dl>` : '')
  folded('reviews', 'Reviews', '<div data-reviews><p class="pd-note">Loading reviews…</p></div>', true)
  mainEl.innerHTML = sections.join('')
  if (window.matchMedia && matchMedia('(min-width: 1001px)').matches) mainEl.querySelectorAll('details[data-fold]').forEach(d => { d.open = true })
  // Read more appears only when the description really is cut off.
  const clamp = mainEl.querySelector('.pd-clamp'), more = mainEl.querySelector('.pd-more-text')
  if (clamp && more) {
    if (clamp.scrollHeight > clamp.clientHeight + 8) more.classList.add('is-needed')
    more.addEventListener('click', () => {
      const open = clamp.classList.toggle('is-open')
      more.textContent = open ? 'Show less' : 'Read more'
      more.setAttribute('aria-expanded', String(open))
    })
  }

  // ── Sidebar
  const price = priceDetails || priceType || 'Pricing on request'
  const pricePanel = `<section class="pd-panel" aria-labelledby="pd-pricing-title">
      <h2 class="pd-panel-title" id="pd-pricing-title">Pricing</h2>
      <p class="pd-price${price.length > 22 ? ' pd-price--long' : ''}">${linkified(price)}</p>
      ${priceDetails && priceType ? `<p class="pd-price-type">${esc(priceType)}</p>` : ''}
      ${text(listing.access_info) ? `<div class="pd-access"><h3 class="pd-panel-title">How to get access</h3><p>${linkified(listing.access_info)}</p></div>` : ''}
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
  const ctaPanel = `<section class="pd-panel pd-cta" aria-label="Contact this company"><h2>Interested in ${esc(name)}?</h2>${askButton}${siteButton}</section>`
  asideEl.innerHTML = pricePanel + companyPanel + chipsPanel + ctaPanel
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
  loadRelated(listing)
  watchBar(askButton, ctaUrl ? siteButton.replace(/ ?<i [^>]*><\/i>/, '') : '')
}

// ── The bar on a phone ──
// Up once the hero's buttons have scrolled away, down again when the form is on the screen.
const watchBar = (ask, site) => {
  const bar = document.getElementById('pd-bar'), actions = heroEl.querySelector('.pd-actions')
  if (!bar || !actions || !window.IntersectionObserver) return
  bar.innerHTML = ask + site
  bar.hidden = false
  let heroSeen = true, formSeen = false
  const panel = asideEl.querySelector('.pd-cta')
  const sync = () => {
    bar.classList.toggle('is-up', !heroSeen && !formSeen)
    if (panel) panel.classList.toggle('is-at-form', formSeen)
  }
  new IntersectionObserver(([e]) => { heroSeen = e.isIntersecting; sync() }).observe(actions)
  new IntersectionObserver(([e]) => { formSeen = e.isIntersecting; sync() }).observe(inquiryEl)
}

// ── More like this ──
// Scored by the categories two products share. A product that ticked twenty categories would
// otherwise come first on every page, so a share counts for less the more it ticked.
const keyOf = (v) => text(v).toLowerCase()
const relatedLogoHeight = (w, h) => { const ratio = Math.min(10, Math.max(0.6, w / h)); return Math.min(48, Math.round(48 * Math.pow(ratio, -0.35)), Math.floor(168 / ratio)) }
const fitRelatedLogo = (img) => {
  const place = () => {
    let r = null
    try { r = trimLogo(img) } catch {}
    const w = (r && r.w) || img.naturalWidth || 1, h = (r && r.h) || img.naturalHeight || 1
    if (r && r.tile) img.classList.add('is-tile')
    if (r && r.dark) img.classList.add('is-dark')
    if (r && r.src) img.src = r.src
    img.style.setProperty('--logo-h', (r && r.tile ? Math.min(48, Math.floor(168 / (w / h))) : relatedLogoHeight(w, h)) + 'px')
    img.classList.add('is-ready')
  }
  img.addEventListener('error', () => {
    const tile = document.createElement('span'); tile.className = 'listing-logo listing-logo--initials'; tile.textContent = img.dataset.initials || ''
    img.replaceWith(tile)
  }, { once: true })
  if (img.complete && img.naturalWidth) place(); else img.addEventListener('load', place, { once: true })
}
const relatedCard = (l) => {
  const name = text(l.product_name) || 'Untitled product', company = text(l.company_name), logo = safeUrl(l.logo_url), initials = getInitials(name)
  const booth = text(l.exhibitor_booth || l.booth_number)
  const href = l.company_slug && l.product_slug ? `/marketplace/listing/${encodeURIComponent(l.company_slug)}/${encodeURIComponent(l.product_slug)}` : `/marketplace/listing/${encodeURIComponent(l.id)}`
  return `<a class="listing-card" href="${esc(href)}"><div class="listing-body">
      <div class="listing-head">
        <div class="listing-brand">${logo ? `<img class="listing-logo-img" src="${esc(logo)}" alt="" loading="lazy" data-initials="${esc(initials)}">` : `<span class="listing-logo listing-logo--initials">${esc(initials)}</span>`}</div>
        <div class="listing-names"><h3 class="listing-title">${esc(name)}</h3>${company && !sameText(company, name) ? `<p class="listing-company">${esc(company)}</p>` : ''}</div>
      </div>
      ${l.description ? `<p class="listing-desc">${esc(l.description)}</p>` : ''}
      <div class="listing-foot">
        <span class="listing-price"><span>${esc(l.pricing_type || 'Pricing on request')}</span>${booth ? `<span class="listing-booth-badge"><i class="fas fa-location-dot" aria-hidden="true"></i> Booth ${esc(booth)}</span>` : ''}</span>
        <span class="listing-view">View details <i class="fas fa-arrow-right" aria-hidden="true"></i></span>
      </div>
    </div></a>`
}
const loadRelated = async (listing) => {
  const box = document.getElementById('pd-related'), grid = document.getElementById('pd-related-grid')
  if (!box || !grid) return
  try {
    const d = await api('/api/mp/listings')
    const mine = new Set(toTagList(listing.ai_category).map(keyOf))
    const picks = (d.listings || [])
      .filter(l => String(l.id) !== String(listing.id))
      .map(l => {
        const theirs = toTagList(l.ai_category).map(keyOf)
        const shared = theirs.filter(c => mine.has(c)).length
        return { l, score: shared / Math.sqrt(Math.max(1, theirs.length)) }
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
    if (!picks.length) return
    grid.innerHTML = picks.map(x => relatedCard(x.l)).join('')
    grid.querySelectorAll('.listing-card').forEach((c, i) => c.style.setProperty('--n', i))
    grid.querySelectorAll('img').forEach(fitRelatedLogo)
    box.hidden = false
  } catch {} // A page without this row is still the whole page.
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
  const fold = box.closest('details'), title = fold && fold.querySelector('summary h2')
  if (fold && reviews && reviews.length) { fold.open = true; if (title) title.textContent = `Reviews (${reviews.length})` }

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
    const gone = /not found/i.test(err.message)
    const offline = err instanceof TypeError
    showNotFound(gone ? 'It may not be approved yet, or it may have been removed.' : offline ? 'The page did not load. Check your connection and try again.' : err.message)
  }
}

loadListing()
