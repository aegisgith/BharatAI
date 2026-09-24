// Marketplace HTML pages for Bharat AI Innovation 2026
// Rebranded from AGBA AI Marketplace → Bharat AI Marketplace

// Autocomplete policy (mirrors the note in src/index.tsx). A personal token is
// only used where the value is a detail of the person filling the form in, or
// of their own company: the login/signup pair, the primary contact, the vendor's
// own company name and website, the inquirer's own details. The rest of the
// vendor form is a directory record about the product and about colleagues -
// founder, CTO, the sales desk - so those are autocomplete="off"; offering the
// filler's own name there would be wrong data, not a shortcut. Product copy,
// tags, tech stack and read-only fields are "off" too.

// ── Shared head for marketplace pages ──
function mpSharedHead(title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Bharat AI Marketplace</title>
  <meta name="description" content="${title} - Bharat AI Innovation 2026 AI Marketplace. Discover, compare, and connect with India's leading AI solutions.">
  <link rel="canonical" href="https://bharataiinnovation.com/marketplace">
  <meta name="theme-color" content="#F8F9FF">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Bharat AI Innovation">
  <meta property="og:url" content="https://bharataiinnovation.com/marketplace">
  <meta property="og:title" content="Bharat AI Marketplace — Discover India's Leading AI Solutions">
  <meta property="og:description" content="Explore AI products and companies at Bharat AI Innovation 2026. Discover, compare, and connect with India's leading AI solutions. 20-21 Nov 2026, WTC Mumbai.">
  <meta property="og:image" content="https://bharataiinnovation.com/images/og-card.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Bharat AI Marketplace">
  <meta name="twitter:description" content="Discover India's leading AI solutions at Bharat AI Innovation 2026.">
  <meta name="twitter:image" content="https://bharataiinnovation.com/images/og-card.png">
  <!-- The two /css/ literals here are FA_CSS and TW_CSS from src/index.tsx,
       duplicated rather than imported because index.tsx imports this module.
       Bump each copy together. Load order is unchanged from the CDN days:
       Font Awesome first, marketplace.css last-but-one, Tailwind last. -->
  <link rel="stylesheet" href="/css/fa-subset.css?v=1">
  <link href="/static/marketplace.css?v=2" rel="stylesheet">
  <link rel="stylesheet" href="/css/tailwind.css?v=2">
</head>`
}

// ══════════════════════════════════════════
// MARKETPLACE MAIN PAGE
// ══════════════════════════════════════════
export function marketplacePageHTML(): string {
  const MASTER_INDUSTRIES = [
    'Industry Agnostic','Aerospace','Agriculture','Airline','Automotive','Banking',
    'Biotech','Chemicals','Construction','Consumer Goods','Cybersecurity','Defense',
    'Education','Energy','Entertainment','Financial Services','Food & Beverage',
    'Government','Healthcare','Hospitality','Insurance','Legal','Logistics',
    'Manufacturing','Media & Publishing','Mining','Non-Profit','Pharma',
    'Real Estate','Retail','Telecom','Transportation','Travel & Tourism',
    'Utilities','Other'
  ]

  const MASTER_AI_CATEGORIES = [
    'Sales Automation','Lead Generation Automation','CRM Automation',
    'Proposal / RFP Automation','Revenue Intelligence','Sales Forecasting','Inside Sales AI',
    'Social Media Automation','Content Generation','Performance Marketing Optimization',
    'SEO / SEM Automation','Personalization Engines','Campaign Automation','Brand Monitoring',
    'Customer Support Automation','AI Chatbots','Sentiment Analysis',
    'Customer Journey Analytics','Self-Service Portals',
    'Invoice Processing','Expense Management','Fraud Detection',
    'Financial Forecasting','Tax Automation','Audit Automation',
    'Recruitment Automation','Resume Screening','Employee Engagement',
    'Workforce Planning','Learning & Development AI','Compensation Intelligence',
    'Contract Analysis','Regulatory Monitoring','Legal Document Automation',
    'E-Discovery','Risk & Compliance Management',
    'Workflow Automation','Inventory Optimization','Procurement AI',
    'Demand Forecasting','Quality Control AI','Logistics / Route Optimization',
    'Code Generation / SDLC','DevOps Automation','Cybersecurity AI',
    'IT Service Management','Test Automation','Infrastructure Monitoring',
    'Product Analytics','Market Intelligence','Competitive Analysis',
    'Innovation Management','R&D Automation',
    'AI Agents','Agentic Automation','Generative AI','LLM-powered','Multimodal AI',
    'Computer Vision','Speech / Voice AI','Robotics','Edge AI','RAG','MLOps',
    'Model Training / Hosting','AI Safety / Guardrails','Observability / Monitoring'
  ]

  const industryCheckboxes = MASTER_INDUSTRIES.map(ind =>
    `<label class="checkbox-label"><input type="checkbox" name="target_industry" value="${ind}"> ${ind}</label>`
  ).join('\n')

  const categoryCheckboxes = MASTER_AI_CATEGORIES.map(cat =>
    `<label class="checkbox-label"><input type="checkbox" name="ai_category" value="${cat}"> ${cat}</label>`
  ).join('\n')

  return `${mpSharedHead('AI Marketplace')}
<body class="mp-body">
  <!-- Toast -->
  <div id="toast" class="mp-toast hidden"></div>

  <!-- Header -->
  <header class="mp-header">
    <div class="mp-header-inner">
      <a href="/marketplace" class="mp-logo-link">
        <img src="https://bharataiinnovation.com/images/Bharat%20AI%20Innovation%20Logo.png" alt="Bharat AI Innovation" loading="eager" class="mp-brand-logo">
      </a>
      <nav class="mp-nav">
        <a href="/app" class="mp-nav-link"><i class="fas fa-home mr-1"></i>Home</a>
        <a href="/app#schedule" class="mp-nav-link">Schedule</a>
        <a href="/marketplace" class="mp-nav-link" aria-current="page">AI Market</a>
        <a href="/inquiry" class="mp-nav-link">Book Booth</a>
        <a href="/marketplace/faq" class="mp-nav-link">FAQ</a>
        <a id="dashboard-link" href="/marketplace/dashboard" class="mp-nav-link hidden"><i class="fas fa-chart-pie mr-1"></i>Dashboard</a>
        <button id="login-button" class="mp-nav-btn"><i class="fas fa-sign-in-alt mr-1"></i>Exhibitor Login</button>
        <button id="logout-button" class="mp-nav-btn hidden"><i class="fas fa-sign-out-alt mr-1"></i>Logout</button>
      </nav>
    </div>
  </header>

  <!-- Hero -->
  <section class="mp-hero">
    <div class="mp-hero-inner">
      <div class="mp-hero-copy">
        <h1 class="mp-hero-title">India's Premier AI Solutions Marketplace</h1>
        <p class="mp-hero-sub">Find AI products by industry or use case, see who each one is built for, and contact the team behind it directly. Part of Bharat AI Innovation 2026.</p>
      </div>
      <div class="mp-hero-actions">
        <button id="open-listing-button" class="mp-hero-btn mp-hero-btn--primary" type="button"><i class="fas fa-plus" aria-hidden="true"></i> List your AI product</button>
      </div>
    </div>
  </section>

  <!-- Auth Section -->
  <section id="auth-section" class="mp-auth-section hidden">
    <div class="mp-auth-container">
      <div class="mp-auth-card">
        <h3><i class="fas fa-sign-in-alt mr-2"></i>Login</h3>
        <form id="login-form" class="mp-form">
          <input name="email" autocomplete="username" inputmode="email" autocapitalize="none" spellcheck="false" type="email" placeholder="Email address" required>
          <input name="password" autocomplete="current-password" type="password" placeholder="Password" required>
          <button type="submit" class="mp-btn-primary">Login</button>
        </form>
        <form id="link-form" class="mp-form mt-3">
          <p class="text-xs text-slate-500 mb-1">Exhibiting with us, or forgotten your password? We will email you a sign-in link &mdash; no password needed.</p>
          <input name="email" autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false" type="email" placeholder="Email address" required>
          <button type="submit" class="mp-btn-secondary">Email me a sign-in link</button>
        </form>
      </div>
      <div class="mp-auth-card">
        <h3><i class="fas fa-user-plus mr-2"></i>Register</h3>
        <form id="register-form" class="mp-form">
          <input name="company_name" autocomplete="organization" placeholder="Company name" required>
          <input name="email" autocomplete="username" inputmode="email" autocapitalize="none" spellcheck="false" type="email" placeholder="Email address" required>
          <input name="password" autocomplete="new-password" type="password" placeholder="Password (min 6 chars)" required minlength="6">
          <button type="submit" class="mp-btn-secondary">Create Account</button>
          <p class="text-xs text-slate-500 mt-2">Exhibiting at Bharat AI Innovation 2026? Use the email from your booth booking and your booth number is added to your listing automatically.</p>
        </form>
      </div>
    </div>
  </section>

  <!-- Search + filters. Options are filled from the approved listings. -->
  <section class="mk-toolbar" aria-label="Search and filter AI products">
    <div class="mk-toolbar-row">
      <label class="mk-search">
        <i class="fas fa-search" aria-hidden="true"></i>
        <span class="mp-sr">Search AI products</span>
        <input id="mk-search" type="search" autocomplete="off" spellcheck="false" enterkeyhint="search" placeholder="Search products, companies or use cases">
      </label>
      <div class="mk-selects">
        <select id="filter-industry" class="mk-select" aria-label="Filter by industry"><option value="">Industry</option></select>
        <select id="filter-category" class="mk-select" aria-label="Filter by AI category"><option value="">Category</option></select>
        <select id="filter-tag" class="mk-select" aria-label="Filter by tag"><option value="">Tag</option></select>
      </div>
      <div class="mk-view-toggle" role="group" aria-label="Layout">
        <button type="button" data-view="grid" class="view-btn view-active" aria-label="Grid view" aria-pressed="true"><i class="fas fa-th-large" aria-hidden="true"></i></button>
        <button type="button" data-view="list" class="view-btn" aria-label="List view" aria-pressed="false"><i class="fas fa-list" aria-hidden="true"></i></button>
      </div>
    </div>
    <div id="mk-status" class="mk-status" aria-live="polite"></div>
  </section>

  <!-- Listings -->
  <main class="mp-main">
    <div id="listings-container" class="listing-grid" aria-busy="true"><div class="listing-card listing-card--skeleton" aria-hidden="true"><div class="listing-body"><div class="listing-head"><div class="listing-logo sk"></div><div class="listing-names"><div class="sk sk-line sk-line--title"></div><div class="sk sk-line sk-line--short"></div></div></div><div class="sk-lines"><div class="sk sk-line"></div><div class="sk sk-line"></div><div class="sk sk-line sk-line--mid"></div></div></div></div><div class="listing-card listing-card--skeleton" aria-hidden="true"><div class="listing-body"><div class="listing-head"><div class="listing-logo sk"></div><div class="listing-names"><div class="sk sk-line sk-line--title"></div><div class="sk sk-line sk-line--short"></div></div></div><div class="sk-lines"><div class="sk sk-line"></div><div class="sk sk-line"></div><div class="sk sk-line sk-line--mid"></div></div></div></div><div class="listing-card listing-card--skeleton" aria-hidden="true"><div class="listing-body"><div class="listing-head"><div class="listing-logo sk"></div><div class="listing-names"><div class="sk sk-line sk-line--title"></div><div class="sk sk-line sk-line--short"></div></div></div><div class="sk-lines"><div class="sk sk-line"></div><div class="sk sk-line"></div><div class="sk sk-line sk-line--mid"></div></div></div></div><div class="listing-card listing-card--skeleton" aria-hidden="true"><div class="listing-body"><div class="listing-head"><div class="listing-logo sk"></div><div class="listing-names"><div class="sk sk-line sk-line--title"></div><div class="sk sk-line sk-line--short"></div></div></div><div class="sk-lines"><div class="sk sk-line"></div><div class="sk sk-line"></div><div class="sk sk-line sk-line--mid"></div></div></div></div><div class="listing-card listing-card--skeleton" aria-hidden="true"><div class="listing-body"><div class="listing-head"><div class="listing-logo sk"></div><div class="listing-names"><div class="sk sk-line sk-line--title"></div><div class="sk sk-line sk-line--short"></div></div></div><div class="sk-lines"><div class="sk sk-line"></div><div class="sk sk-line"></div><div class="sk sk-line sk-line--mid"></div></div></div></div><div class="listing-card listing-card--skeleton" aria-hidden="true"><div class="listing-body"><div class="listing-head"><div class="listing-logo sk"></div><div class="listing-names"><div class="sk sk-line sk-line--title"></div><div class="sk sk-line sk-line--short"></div></div></div><div class="sk-lines"><div class="sk sk-line"></div><div class="sk sk-line"></div><div class="sk sk-line sk-line--mid"></div></div></div></div></div>
  </main>

  <!-- Submit Listing Form -->
  <section id="listing-form-section" class="mp-form-section hidden">
    <div class="mp-form-container">
      <div class="mp-form-header">
        <h3><i class="fas fa-plus-circle mr-2"></i>Submit Your AI Product</h3>
        <p>Fill out the details below to list your product on the Bharat AI Marketplace.</p>
      </div>
      <form id="listing-form" class="mp-listing-form">
        <!-- Basic Info -->
        <details class="form-section" open>
          <summary><i class="fas fa-info-circle mr-2"></i>Basic Information</summary>
          <div class="form-grid">
            <div class="form-field">
              <label>Company Name</label>
              <input id="company-name" autocomplete="off" name="company_name" readonly>
            </div>
            <div class="form-field">
              <label>Product Name *</label>
              <input name="product_name" autocomplete="off" required placeholder="e.g. SmartBot AI Assistant">
            </div>
            <div class="form-field full-width">
              <label>Description *</label>
              <textarea name="description" autocomplete="off" required rows="3" placeholder="Brief description of your AI product..."></textarea>
            </div>
            <div class="form-field">
              <label>Target Customer</label>
              <input name="target_customer" autocomplete="off" placeholder="e.g. Enterprise CIOs, SMB owners">
            </div>
            <div class="form-field">
              <label>Innovation / Differentiation</label>
              <textarea name="innovation" autocomplete="off" rows="2" placeholder="What makes this product unique?"></textarea>
            </div>
            <div class="form-field full-width">
              <label>Use Cases</label>
              <textarea name="use_cases" autocomplete="off" rows="3" placeholder="One use case per line"></textarea>
            </div>
          </div>
        </details>

        <!-- Categories -->
        <details class="form-section">
          <summary><i class="fas fa-layer-group mr-2"></i>Categories & Industries</summary>
          <div class="form-grid">
            <div class="form-field full-width">
              <label>Target Industry</label>
              <div class="checkbox-grid">${industryCheckboxes}</div>
            </div>
            <div class="form-field full-width">
              <label>AI Category</label>
              <div class="checkbox-grid">${categoryCheckboxes}</div>
            </div>
            <div id="ai-category-custom" class="form-field full-width hidden">
              <label>Custom AI Category</label>
              <input name="ai_category_custom" autocomplete="off" placeholder="Describe your custom category">
            </div>
            <div class="form-field full-width">
              <label>Tags (comma-separated)</label>
              <input name="tags" autocomplete="off" placeholder="e.g. NLP, Healthcare, Automation">
            </div>
          </div>
        </details>

        <!-- Pricing -->
        <details class="form-section">
          <summary><i class="fas fa-tag mr-2"></i>Pricing & Access</summary>
          <div class="form-grid">
            <div class="form-field">
              <label>Pricing Model</label>
              <select name="pricing_type">
                <option value="">Select...</option>
                <option value="Free">Free</option>
                <option value="Freemium">Freemium</option>
                <option value="Paid">Paid</option>
                <option value="Enterprise">Enterprise</option>
                <option value="Usage-based">Usage-based</option>
                <option value="Custom">Custom</option>
              </select>
            </div>
            <div class="form-field">
              <label>Pricing Details</label>
              <input name="pricing_details" autocomplete="off" placeholder="e.g. From $99/month">
            </div>
            <div class="form-field full-width">
              <label>Access Information</label>
              <input name="access_info" autocomplete="off" placeholder="e.g. Self-serve signup, Request demo">
            </div>
          </div>
        </details>

        <!-- Media -->
        <details class="form-section">
          <summary><i class="fas fa-image mr-2"></i>Media & Links</summary>
          <div class="form-grid">
            <div class="form-field">
              <label>Company Logo</label>
              <div id="logo-upload-label" class="file-upload-area">
                <input type="file" name="logo_file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg" class="hidden">
                <p><i class="fas fa-cloud-upload-alt mr-1"></i> Upload logo (PNG, JPG, WebP or SVG)</p>
              </div>
              <div id="logo-preview" class="file-preview hidden">
                <img id="logo-preview-img" src="" alt="Logo preview">
                <button type="button" id="logo-remove" class="file-remove"><i class="fas fa-times"></i></button>
              </div>
            </div>
            <div class="form-field">
              <label>Product Image</label>
              <div id="product-img-upload" class="file-upload-area">
                <div id="product-img-label">
                  <input type="file" name="product_image_file" accept="image/png,image/jpeg,image/webp,image/gif" class="hidden">
                  <p><i class="fas fa-cloud-upload-alt mr-1"></i> Upload product image (large photos are resized for you)</p>
                </div>
              </div>
              <div id="product-img-preview" class="file-preview hidden">
                <img id="product-img-preview-img" src="" alt="Product preview">
                <p id="product-img-size" class="text-xs text-slate-400 mt-1"></p>
                <button type="button" id="product-img-remove" class="file-remove"><i class="fas fa-times"></i></button>
              </div>
            </div>
            <div class="form-field full-width">
              <label>Screenshots (max 3)</label>
              <div id="screenshots-label" class="file-upload-area">
                <input type="file" name="screenshot_files" accept="image/png,image/jpeg,image/webp,image/gif" multiple class="hidden">
                <p><i class="fas fa-images mr-1"></i> Upload screenshots (up to 3, resized for you)</p>
              </div>
              <div id="screenshots-preview" class="screenshots-grid"></div>
            </div>
            <div class="form-field">
              <label>Website URL</label>
              <input name="website_url" autocomplete="url" inputmode="url" autocapitalize="none" spellcheck="false" type="url" placeholder="https://example.com">
            </div>
            <div class="form-field">
              <label>Product URL</label>
              <input name="product_url" autocomplete="off" inputmode="url" autocapitalize="none" spellcheck="false" type="url" placeholder="https://example.com/product">
            </div>
            <div class="form-field">
              <label>Demo URL</label>
              <input name="demo_url" autocomplete="off" inputmode="url" autocapitalize="none" spellcheck="false" type="url" placeholder="https://example.com/demo">
            </div>
            <div class="form-field">
              <label>Video URL</label>
              <input name="video_url" autocomplete="off" inputmode="url" autocapitalize="none" spellcheck="false" type="url" placeholder="YouTube or Vimeo link">
            </div>
          </div>
        </details>

        <!-- Contact -->
        <details class="form-section">
          <summary><i class="fas fa-address-book mr-2"></i>Contact Information</summary>
          <div class="form-grid">
            <div class="form-field"><label>CEO / Founder</label><input name="founder_name" autocomplete="off" placeholder="Full name"></div>
            <div class="form-field"><label>CTO / Tech Lead</label><input name="cto_name" autocomplete="off" placeholder="Full name"></div>
            <div class="form-field"><label>Primary Contact</label><input name="contact_name" autocomplete="name" autocapitalize="words" placeholder="Full name"></div>
            <div class="form-field"><label>Company Registration / CIN</label><input name="company_registration" autocomplete="off" placeholder="Registration number"></div>
            <div class="form-field"><label>Company Phone</label><input name="company_phone" autocomplete="off" inputmode="tel" placeholder="+91 ..."></div>
            <div class="form-field full-width"><label>Company Address</label><input name="company_address" autocomplete="off" placeholder="Full address"></div>
            <div class="form-field"><label>Sales Contact Name</label><input name="sales_contact_name" autocomplete="off" placeholder="Full name"></div>
            <div class="form-field"><label>Sales Email</label><input name="sales_contact_email" autocomplete="off" type="email" placeholder="sales@example.com"></div>
            <div class="form-field"><label>Sales Phone</label><input name="sales_contact_phone" autocomplete="off" inputmode="tel" placeholder="+91 ..."></div>
          </div>
        </details>

        <!-- Technical -->
        <details class="form-section">
          <summary><i class="fas fa-cog mr-2"></i>Technical Details</summary>
          <div class="form-grid">
            <div class="form-field full-width"><label>Current Customers</label><input name="current_customers" autocomplete="off" placeholder="e.g. Reliance, TCS, Infosys"></div>
            <div class="form-field full-width"><label>Integration Requirements</label><textarea name="integration_requirements" autocomplete="off" rows="2" placeholder="API details, data formats, etc."></textarea></div>
            <div class="form-field"><label>Supported Platforms</label><input name="supported_platforms" autocomplete="off" placeholder="Web, iOS, Android, Cloud"></div>
            <div class="form-field"><label>Tech Stack</label><input name="tech_stack" autocomplete="off" placeholder="Python, TensorFlow, GPT-4"></div>
            <div class="form-field full-width"><label>Security Protocols</label><textarea name="security_protocols" autocomplete="off" rows="2" placeholder="Encryption, compliance, etc."></textarea></div>
            <div class="form-field full-width"><label>Case Studies</label><textarea name="case_studies" autocomplete="off" rows="2" placeholder="Client results and outcomes"></textarea></div>
            <div class="form-field full-width"><label>Certifications & Compliance</label><input name="certifications_compliance" autocomplete="off" placeholder="SOC 2, GDPR, ISO 27001, etc."></div>
            <div class="form-field full-width"><label>Support Offering</label><textarea name="support_offering" autocomplete="off" rows="2" placeholder="24/7, dedicated CSM, etc."></textarea></div>
            <div class="form-field"><label>SLA Details</label><input name="sla_details" autocomplete="off" placeholder="99.9% uptime, 2hr response"></div>
            <div class="form-field"><label>Onboarding Process</label><input name="onboarding_process" autocomplete="off" placeholder="Self-serve, white-glove, etc."></div>
          </div>
        </details>

        <div class="form-actions">
          <button type="submit" class="mp-btn-primary"><i class="fas fa-paper-plane mr-2"></i>Submit Listing for Review</button>
        </div>
      </form>
    </div>
  </section>

  <!-- Admin Section -->
  <section id="admin-section" class="mp-admin-section hidden">
    <div class="mp-admin-container">
      <h3><i class="fas fa-shield-alt mr-2"></i>Admin: Pending Submissions</h3>
      <div id="admin-listings"></div>
    </div>
  </section>

  <!-- Footer -->
  <footer class="mp-footer">
    <div class="mp-footer-inner">
      <div class="mp-footer-brand">
        <img src="https://bharataiinnovation.com/images/Bharat%20AI%20Innovation%20Logo.png" alt="BHAI" class="mp-footer-logo">
        <div>
          <h3>Bharat AI Marketplace</h3>
          <p>Part of Bharat AI Innovation 2026</p>
        </div>
      </div>
      <div class="mp-footer-links">
        <a href="/">Event App</a>
        <a href="/marketplace/faq">FAQ</a>
        <a href="/marketplace/dashboard">Dashboard</a>
        <a href="https://bharataiinnovation.com" target="_blank">Main Site</a>
      </div>
      <p class="mp-footer-copy">&copy; 2026 Bharat AI Innovation. All rights reserved.</p>
    </div>
  </footer>

  <script src="/static/marketplace-app.js?v=7"></script>
</body>
</html>`
}

// ══════════════════════════════════════════
// LISTING DETAIL PAGE
// ══════════════════════════════════════════
// The slugs come straight from the URL path, already percent-decoded, and are
// written into an inline <script>. Interpolated inside quotes, a path like
// /marketplace/listing/x";alert(1)//y ran as script on this origin. JSON-encode,
// and escape "<" so a value can never close the script element either.
const inlineJsString = (v: string) => JSON.stringify(String(v)).replace(/</g, '\\u003c')

export function marketplaceListingPageHTML(companySlug?: string, productSlug?: string, legacyId?: string): string {
  return `${mpSharedHead('AI Product Listing')}
<body class="mp-body">
  <div id="detail-toast" class="mp-toast hidden" role="status" aria-live="polite"></div>

  <header class="mp-header">
    <div class="mp-header-inner">
      <a href="/marketplace" class="mp-logo-link">
        <img src="https://bharataiinnovation.com/images/Bharat%20AI%20Innovation%20Logo.png" alt="Bharat AI Innovation" loading="eager" class="mp-brand-logo">
      </a>
      <nav class="mp-nav" aria-label="Marketplace">
        <a href="/marketplace" class="mp-nav-link">All AI products</a>
        <a href="/marketplace/faq" class="mp-nav-link">FAQ</a>
        <a href="/marketplace?submit=true" class="mp-nav-btn mp-hide-sm">List your product</a>
      </nav>
    </div>
  </header>

  <!-- Filled by marketplace-listing.js; the placeholders hold the layout until then. -->
  <section class="pd-hero" data-detail-hero>
    <div class="pd-hero-inner" aria-busy="true">
      <nav class="pd-crumbs" aria-label="Breadcrumb"><a href="/marketplace">AI Marketplace</a></nav>
      <div class="pd-hero-main">
        <div class="pd-logo sk" aria-hidden="true"></div>
        <div class="pd-title-block" aria-hidden="true">
          <div class="sk pd-sk-title"></div>
          <div class="sk pd-sk-line"></div>
          <div class="pd-sk-badges"><div class="sk"></div><div class="sk"></div></div>
        </div>
      </div>
    </div>
  </section>

  <main class="pd-layout" data-detail-layout>
    <div class="pd-main" data-detail-main>
      <section class="pd-section" aria-hidden="true">
        <div class="sk pd-sk-line pd-sk-heading"></div>
        <div class="sk pd-sk-block"></div><div class="sk pd-sk-block"></div><div class="sk pd-sk-block pd-sk-block--short"></div>
      </section>
    </div>
    <aside class="pd-aside" data-detail-aside aria-label="Product facts"></aside>

    <section class="pd-inquiry hidden" id="inquire" aria-labelledby="inquire-title">
      <h2 id="inquire-title" data-detail-inquiry-title>Send an inquiry</h2>
      <p class="pd-inquiry-sub" data-detail-inquiry-sub>Your message is emailed to the company with your contact details, so they can reply to you directly.</p>
      <div data-detail-sent></div>
      <form data-detail-form>
        <div class="pd-form-grid">
          <div class="pd-field">
            <label for="inq-name">Your name</label>
            <input id="inq-name" name="inquirer_name" autocomplete="name" autocapitalize="words" required>
          </div>
          <div class="pd-field">
            <label for="inq-email">Email</label>
            <input id="inq-email" name="inquirer_email" autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false" type="email" required>
          </div>
          <div class="pd-field">
            <label for="inq-company">Company <span class="pd-optional">(optional)</span></label>
            <input id="inq-company" name="inquirer_company" autocomplete="organization">
          </div>
          <div class="pd-field">
            <label for="inq-phone">Phone <span class="pd-optional">(optional)</span></label>
            <input id="inq-phone" name="inquirer_phone" autocomplete="tel" inputmode="tel" type="tel">
          </div>
          <div class="pd-field is-wide">
            <label for="inq-message">What would you like to know? <span class="pd-optional">(optional)</span></label>
            <textarea id="inq-message" name="inquirer_message" autocomplete="off" rows="4" placeholder="For example: pricing for a team of 20, or a demo next week"></textarea>
          </div>
        </div>
        <div class="pd-form-foot">
          <button type="submit" class="pd-btn pd-btn--primary"><i class="fas fa-paper-plane" aria-hidden="true"></i> Send inquiry</button>
        </div>
      </form>
    </section>
  </main>

  <footer class="mp-footer">
    <div class="mp-footer-inner">
      <p class="mp-footer-copy">&copy; 2026 Bharat AI Innovation. All rights reserved.</p>
    </div>
  </footer>

  <script>
    ${companySlug && productSlug
      ? `window.__LISTING_COMPANY_SLUG = ${inlineJsString(companySlug)}; window.__LISTING_PRODUCT_SLUG = ${inlineJsString(productSlug)};`
      : legacyId
        ? `window.__LISTING_LEGACY_ID = ${inlineJsString(legacyId)};`
        : ''}
  </script>
  <script src="/static/marketplace-listing.js?v=3"></script>
</body>
</html>`
}

// ══════════════════════════════════════════
// COMPANY DASHBOARD PAGE
// ══════════════════════════════════════════
export function marketplaceDashboardPageHTML(): string {
  return `${mpSharedHead('Dashboard')}
<body class="mp-body mp-dashboard-body">
  <div id="dash-toast" class="mp-toast hidden"></div>

  <!-- Sidebar -->
  <aside id="dash-sidebar" class="dash-sidebar">
    <div class="dash-sidebar-header">
      <img src="https://bharataiinnovation.com/images/Bharat%20AI%20Innovation%20Logo.png" alt="BHAI" class="dash-sidebar-logo">
      <div>
        <h2 class="text-sm font-bold">AI Marketplace</h2>
        <p class="text-[10px] text-slate-400">Company Dashboard</p>
      </div>
    </div>
    <nav class="dash-sidebar-nav">
      <button class="dash-sidebar-item dash-sidebar-active" data-section="overview"><i class="fas fa-chart-pie"></i> Overview</button>
      <button class="dash-sidebar-item" data-section="listings"><i class="fas fa-boxes"></i> My Listings</button>
      <button class="dash-sidebar-item hidden" data-section="stage" id="dash-nav-stage"><i class="fas fa-microphone-alt"></i> Stage Talk</button>
      <button class="dash-sidebar-item" data-section="inquiries"><i class="fas fa-envelope"></i> Inquiries</button>
      <button class="dash-sidebar-item" data-section="reviews"><i class="fas fa-star"></i> Reviews</button>
      <button class="dash-sidebar-item" data-section="profile"><i class="fas fa-user"></i> Profile</button>
    </nav>
    <div class="dash-sidebar-footer">
      <a href="/marketplace" class="dash-sidebar-link"><i class="fas fa-store mr-1"></i> Marketplace</a>
      <a href="/" class="dash-sidebar-link"><i class="fas fa-home mr-1"></i> Event App</a>
      <button id="dash-logout" class="dash-sidebar-link text-rose-400"><i class="fas fa-sign-out-alt mr-1"></i> Logout</button>
    </div>
  </aside>

  <!-- Main Content -->
  <div id="dash-main" class="dash-main">
    <!-- Topbar -->
    <div class="dash-topbar">
      <button id="dash-sidebar-toggle" class="dash-sidebar-toggle"><i class="fas fa-bars"></i></button>
      <div class="dash-topbar-info">
        <span class="text-sm font-medium" id="dash-topbar-name">Company</span>
      </div>
      <div class="dash-topbar-actions">
        <button id="dash-refresh-listings" class="mp-btn-sm"><i class="fas fa-sync mr-1"></i> Refresh</button>
        <a href="/marketplace?submit=true" class="mp-btn-sm mp-btn-sm--primary"><i class="fas fa-plus mr-1"></i> New Listing</a>
      </div>
    </div>

    <!-- Overview -->
    <section id="section-overview" class="dash-section">
      <div class="dash-welcome">
        <div id="dash-avatar" class="dash-avatar">C</div>
        <div>
          <h2 id="dash-company-name">Company</h2>
          <p class="text-sm text-slate-400">Welcome to your AI Marketplace Dashboard</p>
        </div>
      </div>
      <!-- Exhibitors only: the two things their booth includes, and how far they have got. -->
      <div id="dash-todo" class="dash-card hidden"></div>
      <div class="dash-stats-grid">
        <div class="dash-stat-card"><div class="dash-stat-icon"><i class="fas fa-boxes"></i></div><div><p class="dash-stat-label">Total Listings</p><p class="dash-stat-value" id="stat-total">0</p></div></div>
        <div class="dash-stat-card"><div class="dash-stat-icon text-emerald-400"><i class="fas fa-check-circle"></i></div><div><p class="dash-stat-label">Approved</p><p class="dash-stat-value" id="stat-approved">0</p></div></div>
        <div class="dash-stat-card"><div class="dash-stat-icon text-amber-400"><i class="fas fa-clock"></i></div><div><p class="dash-stat-label">Pending</p><p class="dash-stat-value" id="stat-pending">0</p></div></div>
        <div class="dash-stat-card"><div class="dash-stat-icon text-blue-400"><i class="fas fa-eye"></i></div><div><p class="dash-stat-label">Total Views</p><p class="dash-stat-value" id="stat-views">0</p></div></div>
        <div class="dash-stat-card"><div class="dash-stat-icon text-purple-400"><i class="fas fa-envelope"></i></div><div><p class="dash-stat-label">Inquiries</p><p class="dash-stat-value" id="stat-inquiries">0</p></div></div>
        <div class="dash-stat-card"><div class="dash-stat-icon text-amber-400"><i class="fas fa-star"></i></div><div><p class="dash-stat-label">Avg Rating</p><p class="dash-stat-value" id="stat-rating">—</p></div></div>
      </div>
      <div id="dash-complete" class="dash-card hidden" style="border:1px solid #fed7aa;background:#fff7ed"></div>
      <div class="dash-quick-actions">
        <button data-goto="listings" class="dash-quick-btn"><i class="fas fa-boxes mr-1"></i> View Listings</button>
        <button data-goto="inquiries" class="dash-quick-btn"><i class="fas fa-envelope mr-1"></i> Check Inquiries</button>
        <a href="/marketplace?submit=true" class="dash-quick-btn"><i class="fas fa-plus mr-1"></i> Submit New Listing</a>
      </div>
      <div class="dash-card">
        <h3><i class="fas fa-envelope mr-2"></i>Recent Inquiries</h3>
        <div id="dash-recent-inquiries"></div>
      </div>
    </section>

    <!-- Listings -->
    <section id="section-listings" class="dash-section hidden">
      <div class="dash-section-header">
        <h2><i class="fas fa-boxes mr-2"></i>My Listings</h2>
      </div>
      <div id="dash-listings-table"></div>
    </section>

    <!-- Stage talk (exhibitors with a confirmed stand) -->
    <section id="section-stage" class="dash-section hidden">
      <div class="dash-section-header"><h2><i class="fas fa-microphone-alt mr-2"></i>Stage Talk</h2></div>
      <div id="stage-slot" class="dash-card"></div>
      <form id="stage-form" class="dash-card mp-form">
        <h3>Your talk</h3>
        <div class="form-grid" style="padding:0">
          <div class="form-field full-width"><label for="stage-topic">Talk topic</label><input id="stage-topic" name="topic" maxlength="150" autocomplete="off" placeholder="e.g. Cutting loan approvals from days to minutes with AI"></div>
          <div class="form-field full-width"><label for="stage-showcase">What you will showcase</label><textarea id="stage-showcase" name="showcase" rows="3" maxlength="1000" autocomplete="off" placeholder="The product, demo or prototype you will show on stage"></textarea></div>
        </div>
        <h3 style="margin-top:20px">Speaker</h3>
        <div class="form-grid" style="padding:0">
          <div class="form-field full-width">
            <label for="stage-photo-file">Photo</label>
            <div class="flex gap-3 items-center">
              <img id="stage-photo-preview" alt="" class="hidden" style="width:64px;height:64px;object-fit:cover;border-radius:50%;border:1px solid #e5e7eb">
              <input id="stage-photo-file" type="file" accept="image/png,image/jpeg,image/webp" class="text-xs">
            </div>
          </div>
          <div class="form-field"><label for="stage-speaker">Name</label><input id="stage-speaker" name="speaker_name" maxlength="120" autocomplete="off"></div>
          <div class="form-field"><label for="stage-speaker-title">Designation</label><input id="stage-speaker-title" name="speaker_title" maxlength="120" autocomplete="off" placeholder="e.g. Co-founder &amp; CTO"></div>
          <div class="form-field full-width"><label for="stage-bio">Short bio (optional)</label><textarea id="stage-bio" name="speaker_bio" rows="3" maxlength="800" autocomplete="off" placeholder="Two or three lines the host can read out before the talk"></textarea></div>
        </div>
        <button type="submit" class="mp-btn-primary mt-4"><i class="fas fa-save mr-1"></i> Save</button>
      </form>
    </section>

    <!-- Inquiries -->
    <section id="section-inquiries" class="dash-section hidden">
      <div class="dash-section-header"><h2><i class="fas fa-envelope mr-2"></i>All Inquiries</h2></div>
      <div id="dash-inquiries"></div>
    </section>

    <!-- Reviews -->
    <section id="section-reviews" class="dash-section hidden">
      <div class="dash-section-header"><h2><i class="fas fa-star mr-2"></i>Reviews</h2></div>
      <div id="dash-reviews"></div>
    </section>

    <!-- Profile -->
    <section id="section-profile" class="dash-section hidden">
      <div class="dash-section-header"><h2><i class="fas fa-user mr-2"></i>Company Profile</h2></div>
      <div class="dash-card">
        <form id="dash-profile-form" class="mp-form">
          <div class="form-grid">
            <div class="form-field"><label>Company Name</label><input id="profile-company-name" autocomplete="organization" name="company_name" required></div>
            <div class="form-field"><label>Email</label><input id="profile-email" autocomplete="off" readonly></div>
            <div class="form-field"><label>Role</label><input id="profile-role" autocomplete="off" readonly></div>
            <div class="form-field"><label>Member Since</label><input id="profile-since" autocomplete="off" readonly></div>
          </div>
          <button type="submit" class="mp-btn-primary mt-4"><i class="fas fa-save mr-1"></i> Update Profile</button>
        </form>
      </div>
    </section>
  </div>

  <!-- Edit Listing Modal -->
  <div id="edit-listing-modal" class="mp-modal hidden">
    <div class="mp-modal-content">
      <div class="mp-modal-header">
        <h3>Edit Listing</h3>
        <button id="edit-modal-close" class="mp-modal-close"><i class="fas fa-times"></i></button>
      </div>
      <form id="edit-listing-form" class="mp-form">
        <input type="hidden" id="edit-listing-id" name="id">
        <div id="edit-missing" class="hidden" style="margin-bottom:12px;padding:10px 12px;border-radius:10px;border:1px solid #fed7aa;background:#fff7ed;color:#9a3412;font-size:13px"></div>
        <p id="edit-review-note" class="text-xs text-slate-500 mb-2 hidden">Saving sends this listing back for a quick review. It is hidden from the marketplace until approved again.</p>
        <div class="form-grid">
          <div class="form-field">
            <label>Company Logo</label>
            <div class="flex gap-2 items-center">
              <img id="edit-logo-preview" alt="" class="hidden" style="width:48px;height:48px;object-fit:contain;border-radius:8px;background:#fff;border:1px solid #e5e7eb">
              <input id="edit-logo-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg" class="text-xs">
            </div>
          </div>
          <div class="form-field">
            <label>Product Image</label>
            <div class="flex gap-2 items-center">
              <img id="edit-image-preview" alt="" class="hidden" style="width:72px;height:48px;object-fit:cover;border-radius:8px;border:1px solid #e5e7eb">
              <input id="edit-image-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" class="text-xs">
            </div>
          </div>
          <div class="form-field"><label>Product Name</label><input id="edit-product-name" autocomplete="off" name="product_name" required></div>
          <div class="form-field full-width"><label>Description</label><textarea id="edit-description" autocomplete="off" name="description" rows="3" required></textarea></div>
          <div class="form-field"><label>Target Customer</label><input id="edit-target-customer" autocomplete="off" name="target_customer"></div>
          <div class="form-field"><label>Pricing Type</label><input id="edit-pricing-type" autocomplete="off" name="pricing_type"></div>
          <div class="form-field"><label>Pricing Details</label><input id="edit-pricing-details" autocomplete="off" name="pricing_details"></div>
          <div class="form-field"><label>Tags</label><input id="edit-tags" autocomplete="off" name="tags"></div>
          <div class="form-field"><label>Target Industry</label><input id="edit-target-industry" autocomplete="off" name="target_industry"></div>
          <div class="form-field"><label>AI Category</label><input id="edit-ai-category" autocomplete="off" name="ai_category"></div>
          <div class="form-field"><label>Website URL</label><input id="edit-website-url" autocomplete="url" inputmode="url" autocapitalize="none" spellcheck="false" name="website_url"></div>
          <div class="form-field"><label>Product URL</label><input id="edit-product-url" autocomplete="off" inputmode="url" autocapitalize="none" spellcheck="false" name="product_url"></div>
          <div class="form-field"><label>Sales Contact</label><input id="edit-sales-name" autocomplete="off" name="sales_contact_name"></div>
          <div class="form-field"><label>Sales Email</label><input id="edit-sales-email" autocomplete="off" inputmode="email" autocapitalize="none" spellcheck="false" name="sales_contact_email"></div>
          <div class="form-field"><label>Sales Phone</label><input id="edit-sales-phone" autocomplete="off" inputmode="tel" name="sales_contact_phone"></div>
          <div class="form-field"><label>Demo URL</label><input id="edit-demo-url" autocomplete="off" inputmode="url" autocapitalize="none" spellcheck="false" name="demo_url" placeholder="https://"></div>
          <div class="form-field"><label>Video URL</label><input id="edit-video-url" autocomplete="off" inputmode="url" autocapitalize="none" spellcheck="false" name="video_url" placeholder="YouTube or Vimeo link"></div>
          <div class="form-field"><label>Access Information</label><input id="edit-access-info" autocomplete="off" name="access_info" placeholder="e.g. Self-serve signup, Request demo"></div>
          <div class="form-field full-width"><label>Use Cases</label><textarea id="edit-use-cases" autocomplete="off" name="use_cases" rows="3" placeholder="One use case per line"></textarea></div>
          <div class="form-field full-width"><label>Innovation / Differentiation</label><textarea id="edit-innovation" autocomplete="off" name="innovation" rows="2"></textarea></div>
        </div>
        <div class="mp-modal-actions">
          <button type="button" id="edit-cancel" class="mp-btn-secondary">Cancel</button>
          <button type="submit" class="mp-btn-primary">Save Changes</button>
        </div>
      </form>
    </div>
  </div>

  <script src="/static/marketplace-dashboard.js?v=4"></script>
</body>
</html>`
}

// ══════════════════════════════════════════
// SUPER ADMIN DASHBOARD (reuses marketplace admin tab)
// ══════════════════════════════════════════
export function marketplaceAdminPageHTML(): string {
  return `${mpSharedHead('Admin Dashboard')}
<body class="mp-body mp-dashboard-body">
  <div id="dash-toast" class="mp-toast hidden"></div>

  <aside id="dash-sidebar" class="dash-sidebar">
    <div class="dash-sidebar-header">
      <img src="https://bharataiinnovation.com/images/Bharat%20AI%20Innovation%20Logo.png" alt="BHAI" class="dash-sidebar-logo">
      <div>
        <h2 class="text-sm font-bold">AI Marketplace</h2>
        <p class="text-[10px] text-slate-400">Super Admin</p>
      </div>
    </div>
    <nav class="dash-sidebar-nav">
      <button class="dash-sidebar-item dash-sidebar-active" data-section="overview"><i class="fas fa-chart-pie"></i> Overview</button>
      <button class="dash-sidebar-item" data-section="listings"><i class="fas fa-boxes"></i> All Listings</button>
      <button class="dash-sidebar-item" data-section="pending"><i class="fas fa-clock"></i> Pending Review</button>
      <button class="dash-sidebar-item" data-section="inquiries"><i class="fas fa-envelope"></i> Inquiries</button>
      <button class="dash-sidebar-item" data-section="exhibitors"><i class="fas fa-store"></i> Exhibitors</button>
      <button class="dash-sidebar-item" data-section="stage"><i class="fas fa-microphone-alt"></i> Stage Talks</button>
      <button class="dash-sidebar-item" data-section="bulk"><i class="fas fa-upload"></i> Bulk Upload</button>
    </nav>
    <div class="dash-sidebar-footer">
      <a href="/marketplace" class="dash-sidebar-link"><i class="fas fa-store mr-1"></i> Marketplace</a>
      <a href="/admin" class="dash-sidebar-link"><i class="fas fa-cog mr-1"></i> Event Admin</a>
      <button id="dash-logout" class="dash-sidebar-link text-rose-400"><i class="fas fa-sign-out-alt mr-1"></i> Logout</button>
    </div>
  </aside>

  <div id="dash-main" class="dash-main">
    <div class="dash-topbar">
      <button id="dash-sidebar-toggle" class="dash-sidebar-toggle"><i class="fas fa-bars"></i></button>
      <div class="dash-topbar-info"><span class="text-sm font-medium">Marketplace Admin</span></div>
      <div class="dash-topbar-actions">
        <button id="admin-refresh" class="mp-btn-sm"><i class="fas fa-sync mr-1"></i> Refresh</button>
      </div>
    </div>

    <!-- Overview -->
    <section id="section-overview" class="dash-section">
      <h2 class="text-xl font-bold mb-4">Admin Overview</h2>
      <div class="dash-stats-grid">
        <div class="dash-stat-card"><div class="dash-stat-icon"><i class="fas fa-boxes"></i></div><div><p class="dash-stat-label">Total Listings</p><p class="dash-stat-value" id="stat-total">0</p></div></div>
        <div class="dash-stat-card"><div class="dash-stat-icon text-emerald-400"><i class="fas fa-check-circle"></i></div><div><p class="dash-stat-label">Approved</p><p class="dash-stat-value" id="stat-approved">0</p></div></div>
        <div class="dash-stat-card"><div class="dash-stat-icon text-amber-400"><i class="fas fa-clock"></i></div><div><p class="dash-stat-label">Pending</p><p class="dash-stat-value" id="stat-pending">0</p></div></div>
        <div class="dash-stat-card"><div class="dash-stat-icon text-rose-400"><i class="fas fa-times-circle"></i></div><div><p class="dash-stat-label">Rejected</p><p class="dash-stat-value" id="stat-rejected">0</p></div></div>
        <div class="dash-stat-card"><div class="dash-stat-icon text-blue-400"><i class="fas fa-building"></i></div><div><p class="dash-stat-label">Companies</p><p class="dash-stat-value" id="stat-companies">0</p></div></div>
        <div class="dash-stat-card"><div class="dash-stat-icon text-purple-400"><i class="fas fa-envelope"></i></div><div><p class="dash-stat-label">Inquiries</p><p class="dash-stat-value" id="stat-inquiries">0</p></div></div>
      </div>
    </section>

    <!-- All Listings -->
    <section id="section-listings" class="dash-section hidden">
      <div class="dash-section-header"><h2><i class="fas fa-boxes mr-2"></i>All Listings</h2></div>
      <div id="admin-all-listings"></div>
    </section>

    <!-- Pending -->
    <section id="section-pending" class="dash-section hidden">
      <div class="dash-section-header"><h2><i class="fas fa-clock mr-2"></i>Pending Review</h2></div>
      <div id="admin-pending-listings"></div>
    </section>

    <!-- Inquiries -->
    <section id="section-inquiries" class="dash-section hidden">
      <div class="dash-section-header"><h2><i class="fas fa-envelope mr-2"></i>All Inquiries</h2></div>
      <div id="admin-inquiries"></div>
    </section>

    <!-- Exhibitors -->
    <section id="section-exhibitors" class="dash-section hidden">
      <div class="dash-section-header"><h2><i class="fas fa-store mr-2"></i>Exhibitors</h2></div>
      <div class="dash-card">
        <p class="text-sm text-slate-400">A booth includes a free marketplace listing, and an account is made for each exhibitor from the booth record. <strong>Invite</strong> emails the full invitation with a one-click sign-in (once a week per exhibitor). <strong>Send sign-in links</strong> emails the short "your account is ready" note with the same one-click sign-in (once a day) &mdash; for anyone invited before accounts were made, or who has not got in. Anyone already listing or unsubscribed is skipped.</p>
        <div class="flex gap-3 items-center flex-wrap mt-3">
          <button id="invite-all" class="mp-btn-primary text-sm py-2 px-4"><i class="fas fa-paper-plane mr-1"></i> Invite everyone eligible</button>
          <button id="link-all" class="mp-btn-secondary text-sm py-2 px-4"><i class="fas fa-sign-in-alt mr-1"></i> Send sign-in links</button>
          <span id="invite-summary" class="text-sm text-slate-400"></span>
        </div>
      </div>
      <div id="admin-exhibitors" class="mt-3"></div>
    </section>

    <!-- Stage talks -->
    <section id="section-stage" class="dash-section hidden">
      <div class="dash-section-header"><h2><i class="fas fa-microphone-alt mr-2"></i>Stage Talks</h2></div>
      <div class="dash-card">
        <p class="text-sm text-slate-400">Every confirmed stand includes an Innovation Talk &amp; Showcase slot. Exhibitors add their topic and speaker from their own dashboard; you set the day and time here. A talk appears in the event app's Innovation Talks programme once it has a time, a topic and a speaker.</p>
        <p id="stage-summary" class="text-sm text-slate-400 mt-2"></p>
      </div>
      <div id="admin-stage" class="mt-3"></div>
    </section>

    <!-- Bulk Upload -->
    <section id="section-bulk" class="dash-section hidden">
      <div class="dash-section-header"><h2><i class="fas fa-upload mr-2"></i>Bulk Upload</h2></div>
      <div class="dash-card">
        <p class="text-sm text-slate-400 mb-4">Upload a CSV file with listing data. Required columns: product_name, company_name, description.</p>
        <div class="file-upload-area" id="bulk-upload-zone">
          <input type="file" id="bulk-file-input" accept=".csv,.xlsx" class="hidden">
          <p><i class="fas fa-cloud-upload-alt mr-1"></i> Drop CSV/XLSX file here or click to upload</p>
        </div>
        <div id="bulk-preview" class="mt-4 hidden">
          <h4 class="font-medium mb-2">Preview (<span id="bulk-count">0</span> listings)</h4>
          <div id="bulk-preview-table" class="overflow-x-auto"></div>
          <div class="flex gap-3 mt-4">
            <button id="bulk-upload-btn" class="mp-btn-primary"><i class="fas fa-upload mr-1"></i> Upload All</button>
            <button id="bulk-cancel-btn" class="mp-btn-secondary">Cancel</button>
          </div>
        </div>
        <div id="bulk-result" class="mt-4 hidden"></div>
      </div>
    </section>
  </div>

  <script src="/static/marketplace-admin.js?v=9"></script>
</body>
</html>`
}

// ══════════════════════════════════════════
// FAQ PAGE
// ══════════════════════════════════════════
export function marketplaceFaqPageHTML(): string {
  return `${mpSharedHead('FAQ')}
<body class="mp-body">
  <header class="mp-header">
    <div class="mp-header-inner">
      <a href="/marketplace" class="mp-logo-link">
        <img src="https://bharataiinnovation.com/images/Bharat%20AI%20Innovation%20Logo.png" alt="BHAI" class="mp-logo-img">
        <div>
          <h1 class="mp-logo-title">Bharat AI Marketplace</h1>
          <p class="mp-logo-sub">Frequently Asked Questions</p>
        </div>
      </a>
      <nav class="mp-nav">
        <a href="/marketplace" class="mp-nav-link"><i class="fas fa-arrow-left mr-1"></i>Back to Marketplace</a>
      </nav>
    </div>
  </header>

  <main class="mp-faq-main">
    <div class="mp-faq-container">
      <h2 class="mp-faq-title">Frequently Asked Questions</h2>

      <div class="faq-item">
        <h3><i class="fas fa-question-circle mr-2 text-primary-400"></i>What is the Bharat AI Marketplace?</h3>
        <p>The Bharat AI Marketplace is a curated directory of AI products and solutions showcased at Bharat AI Innovation 2026. It allows exhibitors and AI companies to list their products, and visitors/buyers to browse, compare, and send inquiries.</p>
      </div>

      <div class="faq-item">
        <h3><i class="fas fa-user-plus mr-2 text-primary-400"></i>Who can list products?</h3>
        <p>Any company can create a free marketplace account and list its AI products. If you are exhibiting at Bharat AI Innovation 2026, register with the same email address you used for your booth booking and your booth number is added to your listing automatically.</p>
      </div>

      <div class="faq-item">
        <h3><i class="fas fa-check-circle mr-2 text-emerald-400"></i>How does the approval process work?</h3>
        <p>Every submitted listing is reviewed by our team before it appears on the public marketplace, and we email you when it is approved. Editing a listing sends it back for review. You can track each listing's status from your dashboard.</p>
      </div>

      <div class="faq-item">
        <h3><i class="fas fa-search mr-2 text-blue-400"></i>How can buyers find my product?</h3>
        <p>Buyers can filter by industry, AI category, and tags. Each listing has a detailed page with overview, technical specs, case studies, and a contact form. Inquiries are emailed to your account address and also appear in your dashboard.</p>
      </div>

      <div class="faq-item">
        <h3><i class="fas fa-link mr-2 text-amber-400"></i>How is the marketplace connected to the event?</h3>
        <p>The marketplace is part of the Bharat AI Innovation 2026 event app. Approved listings from exhibiting companies show their booth number, so buyers can find you at the venue.</p>
      </div>

      <div class="faq-item">
        <h3><i class="fas fa-chart-pie mr-2 text-purple-400"></i>What analytics are available?</h3>
        <p>Your company dashboard shows listing views, inquiry count, average ratings, and review history. You can track how your products are performing on the marketplace in real time.</p>
      </div>

      <div class="faq-item">
        <h3><i class="fas fa-star mr-2 text-amber-400"></i>How does the rating system work?</h3>
        <p>Signed-in marketplace companies can rate and review approved listings on a 1-5 scale, one review per company per product. Companies cannot review their own listings.</p>
      </div>

      <div class="faq-item">
        <h3><i class="fas fa-money-bill mr-2 text-emerald-400"></i>Is there a cost to list?</h3>
        <p>Listing on the Bharat AI Marketplace is free for all exhibitors of Bharat AI Innovation 2026. Non-exhibitor companies may also list for free during the event period.</p>
      </div>
    </div>
  </main>

  <footer class="mp-footer">
    <div class="mp-footer-inner">
      <p class="mp-footer-copy">&copy; 2026 Bharat AI Innovation. All rights reserved.</p>
    </div>
  </footer>
</body>
</html>`
}
