// Marketplace HTML pages for Bharat AI Innovation 2026
// Rebranded from AGBA AI Marketplace → Bharat AI Marketplace

// ── Shared head for marketplace pages ──
function mpSharedHead(title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Bharat AI Marketplace</title>
  <meta name="description" content="${title} - Bharat AI Innovation 2026 AI Marketplace. Discover, compare, and connect with India's leading AI solutions.">
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <link href="/static/marketplace.css" rel="stylesheet">
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            primary: { 50:'#f0f4ff',100:'#dbe4ff',200:'#bac8ff',300:'#91a7ff',400:'#748ffc',500:'#5c7cfa',600:'#4c6ef5',700:'#4263eb',800:'#3b5bdb',900:'#364fc7' },
            accent: { 50:'#fff3e0',100:'#ffe0b2',200:'#ffcc80',300:'#ffb74d',400:'#ffa726',500:'#ff9800',600:'#fb8c00',700:'#f57c00',800:'#ef6c00',900:'#e65100' }
          }
        }
      }
    }
  </script>
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
        <img src="https://bharatai.blob.core.windows.net/aidata/Bharat%20AI%20Innovation%20Logo.png" alt="BHAI" class="mp-logo-img">
        <div>
          <h1 class="mp-logo-title">Bharat AI Marketplace</h1>
          <p class="mp-logo-sub">Discover & Connect with India's Leading AI Solutions</p>
        </div>
      </a>
      <nav class="mp-nav">
        <a href="/" class="mp-nav-link"><i class="fas fa-home mr-1"></i>Event App</a>
        <a href="/marketplace/faq" class="mp-nav-link">FAQ</a>
        <a id="dashboard-link" href="/marketplace/dashboard" class="mp-nav-link hidden"><i class="fas fa-chart-pie mr-1"></i>Dashboard</a>
        <button id="login-button" class="mp-nav-btn"><i class="fas fa-sign-in-alt mr-1"></i>Login</button>
        <button id="logout-button" class="mp-nav-btn hidden"><i class="fas fa-sign-out-alt mr-1"></i>Logout</button>
      </nav>
    </div>
  </header>

  <!-- Hero -->
  <section class="mp-hero">
    <div class="mp-hero-inner">
      <div class="mp-hero-badge"><i class="fas fa-robot mr-1"></i> Bharat AI Innovation 2026</div>
      <h2 class="mp-hero-title">India's Premier AI Solutions Marketplace</h2>
      <p class="mp-hero-sub">Browse, compare, and connect with cutting-edge AI products. Exhibitors can list their AI solutions directly from the event.</p>
      <div class="mp-hero-actions">
        <button id="open-listing-button" class="mp-hero-btn mp-hero-btn--primary"><i class="fas fa-plus mr-1"></i> List Your AI Product</button>
        <button id="refresh-button" class="mp-hero-btn mp-hero-btn--secondary"><i class="fas fa-sync mr-1"></i> Refresh</button>
        <div class="mp-view-toggle">
          <button data-view="grid" class="view-btn view-active"><i class="fas fa-th"></i></button>
          <button data-view="list" class="view-btn"><i class="fas fa-list"></i></button>
        </div>
      </div>
    </div>
  </section>

  <!-- Auth Section -->
  <section id="auth-section" class="mp-auth-section hidden">
    <div class="mp-auth-container">
      <div class="mp-auth-card">
        <h3><i class="fas fa-sign-in-alt mr-2"></i>Login</h3>
        <form id="login-form" class="mp-form">
          <input name="email" type="email" placeholder="Email address" required>
          <input name="password" type="password" placeholder="Password" required>
          <button type="submit" class="mp-btn-primary">Login</button>
        </form>
      </div>
      <div class="mp-auth-card">
        <h3><i class="fas fa-user-plus mr-2"></i>Register</h3>
        <form id="register-form" class="mp-form">
          <input name="company_name" placeholder="Company name" required>
          <input name="email" type="email" placeholder="Email address" required>
          <input name="password" type="password" placeholder="Password (min 6 chars)" required minlength="6">
          <button type="submit" class="mp-btn-secondary">Create Account</button>
        </form>
      </div>
    </div>
  </section>

  <!-- Filters -->
  <section class="mp-filters">
    <div class="mp-filters-inner">
      <div class="mp-filter-group">
        <h4><i class="fas fa-tags mr-1"></i> Tags</h4>
        <div id="filter-tags"></div>
      </div>
      <div class="mp-filter-group">
        <h4><i class="fas fa-industry mr-1"></i> Industries</h4>
        <div id="filter-industries"></div>
      </div>
      <div class="mp-filter-group">
        <h4><i class="fas fa-brain mr-1"></i> AI Categories</h4>
        <div id="filter-categories"></div>
      </div>
    </div>
  </section>

  <!-- Listings -->
  <main class="mp-main">
    <div id="listings-container" class="listing-grid"></div>
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
              <input id="company-name" name="company_name" readonly>
            </div>
            <div class="form-field">
              <label>Product Name *</label>
              <input name="product_name" required placeholder="e.g. SmartBot AI Assistant">
            </div>
            <div class="form-field full-width">
              <label>Description *</label>
              <textarea name="description" required rows="3" placeholder="Brief description of your AI product..."></textarea>
            </div>
            <div class="form-field">
              <label>Target Customer</label>
              <input name="target_customer" placeholder="e.g. Enterprise CIOs, SMB owners">
            </div>
            <div class="form-field">
              <label>Innovation / Differentiation</label>
              <textarea name="innovation" rows="2" placeholder="What makes this product unique?"></textarea>
            </div>
            <div class="form-field full-width">
              <label>Use Cases</label>
              <textarea name="use_cases" rows="3" placeholder="One use case per line"></textarea>
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
              <input name="ai_category_custom" placeholder="Describe your custom category">
            </div>
            <div class="form-field full-width">
              <label>Tags (comma-separated)</label>
              <input name="tags" placeholder="e.g. NLP, Healthcare, Automation">
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
              <input name="pricing_details" placeholder="e.g. From $99/month">
            </div>
            <div class="form-field full-width">
              <label>Access Information</label>
              <input name="access_info" placeholder="e.g. Self-serve signup, Request demo">
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
                <input type="file" name="logo_file" accept="image/*" class="hidden">
                <p><i class="fas fa-cloud-upload-alt mr-1"></i> Upload logo (max 5MB)</p>
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
                  <input type="file" name="product_image_file" accept="image/*" class="hidden">
                  <p><i class="fas fa-cloud-upload-alt mr-1"></i> Upload product image (max 5MB)</p>
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
                <input type="file" name="screenshot_files" accept="image/*" multiple class="hidden">
                <p><i class="fas fa-images mr-1"></i> Upload screenshots (max 5MB each)</p>
              </div>
              <div id="screenshots-preview" class="screenshots-grid"></div>
            </div>
            <div class="form-field">
              <label>Website URL</label>
              <input name="website_url" type="url" placeholder="https://example.com">
            </div>
            <div class="form-field">
              <label>Product URL</label>
              <input name="product_url" type="url" placeholder="https://example.com/product">
            </div>
            <div class="form-field">
              <label>Demo URL</label>
              <input name="demo_url" type="url" placeholder="https://example.com/demo">
            </div>
            <div class="form-field">
              <label>Video URL</label>
              <input name="video_url" type="url" placeholder="YouTube or Vimeo link">
            </div>
          </div>
        </details>

        <!-- Contact -->
        <details class="form-section">
          <summary><i class="fas fa-address-book mr-2"></i>Contact Information</summary>
          <div class="form-grid">
            <div class="form-field"><label>CEO / Founder</label><input name="founder_name" placeholder="Full name"></div>
            <div class="form-field"><label>CTO / Tech Lead</label><input name="cto_name" placeholder="Full name"></div>
            <div class="form-field"><label>Primary Contact</label><input name="contact_name" placeholder="Full name"></div>
            <div class="form-field"><label>Company Registration / CIN</label><input name="company_registration" placeholder="Registration number"></div>
            <div class="form-field"><label>Company Phone</label><input name="company_phone" placeholder="+91 ..."></div>
            <div class="form-field full-width"><label>Company Address</label><input name="company_address" placeholder="Full address"></div>
            <div class="form-field"><label>Sales Contact Name</label><input name="sales_contact_name" placeholder="Full name"></div>
            <div class="form-field"><label>Sales Email</label><input name="sales_contact_email" type="email" placeholder="sales@example.com"></div>
            <div class="form-field"><label>Sales Phone</label><input name="sales_contact_phone" placeholder="+91 ..."></div>
          </div>
        </details>

        <!-- Technical -->
        <details class="form-section">
          <summary><i class="fas fa-cog mr-2"></i>Technical Details</summary>
          <div class="form-grid">
            <div class="form-field full-width"><label>Current Customers</label><input name="current_customers" placeholder="e.g. Reliance, TCS, Infosys"></div>
            <div class="form-field full-width"><label>Integration Requirements</label><textarea name="integration_requirements" rows="2" placeholder="API details, data formats, etc."></textarea></div>
            <div class="form-field"><label>Supported Platforms</label><input name="supported_platforms" placeholder="Web, iOS, Android, Cloud"></div>
            <div class="form-field"><label>Tech Stack</label><input name="tech_stack" placeholder="Python, TensorFlow, GPT-4"></div>
            <div class="form-field full-width"><label>Security Protocols</label><textarea name="security_protocols" rows="2" placeholder="Encryption, compliance, etc."></textarea></div>
            <div class="form-field full-width"><label>Case Studies</label><textarea name="case_studies" rows="2" placeholder="Client results and outcomes"></textarea></div>
            <div class="form-field full-width"><label>Certifications & Compliance</label><input name="certifications_compliance" placeholder="SOC 2, GDPR, ISO 27001, etc."></div>
            <div class="form-field full-width"><label>Support Offering</label><textarea name="support_offering" rows="2" placeholder="24/7, dedicated CSM, etc."></textarea></div>
            <div class="form-field"><label>SLA Details</label><input name="sla_details" placeholder="99.9% uptime, 2hr response"></div>
            <div class="form-field"><label>Onboarding Process</label><input name="onboarding_process" placeholder="Self-serve, white-glove, etc."></div>
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
        <img src="https://bharatai.blob.core.windows.net/aidata/Bharat%20AI%20Innovation%20Logo.png" alt="BHAI" class="mp-footer-logo">
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

  <script src="/static/marketplace-app.js"></script>
</body>
</html>`
}

// ══════════════════════════════════════════
// LISTING DETAIL PAGE
// ══════════════════════════════════════════
export function marketplaceListingPageHTML(companySlug?: string, productSlug?: string, legacyId?: string): string {
  return `${mpSharedHead('AI Product Listing')}
<body class="mp-body">
  <div id="detail-toast" class="mp-toast hidden"></div>

  <header class="mp-header">
    <div class="mp-header-inner">
      <a href="/marketplace" class="mp-logo-link">
        <img src="https://bharatai.blob.core.windows.net/aidata/Bharat%20AI%20Innovation%20Logo.png" alt="BHAI" class="mp-logo-img">
        <div>
          <h1 class="mp-logo-title">Bharat AI Marketplace</h1>
          <p class="mp-logo-sub">AI Solutions Directory</p>
        </div>
      </a>
      <nav class="mp-nav">
        <a href="/marketplace/faq" class="mp-nav-link">FAQ</a>
        <a href="/marketplace" class="mp-nav-link"><i class="fas fa-arrow-left mr-1"></i>Back to listings</a>
      </nav>
    </div>
  </header>

  <main class="mp-listing-detail">
    <!-- Hero Section -->
    <section class="detail-hero">
      <div class="detail-hero-inner">
        <div class="detail-hero-logo" data-detail-logo></div>
        <div class="detail-hero-info">
          <p class="detail-hero-company" data-detail-company>Loading...</p>
          <h2 class="detail-hero-title" data-detail-title>Loading...</h2>
          <div class="detail-hero-meta" data-detail-meta></div>
        </div>
        <div class="detail-hero-actions">
          <button class="mp-btn-primary" data-detail-cta>Get it now</button>
          <button class="mp-btn-secondary" data-detail-inquire>Inquire</button>
        </div>
      </div>
      <p class="detail-hero-sales" data-detail-sales></p>
    </section>

    <!-- Tabs -->
    <div class="detail-tabs">
      <button class="detail-tab" data-tab="overview">Overview</button>
      <button class="detail-tab" data-tab="details">Details</button>
      <button class="detail-tab" data-tab="reviews">Reviews</button>
    </div>

    <!-- Tab Panels -->
    <div class="detail-panels">
      <div data-tab-panel="overview"></div>
      <div data-tab-panel="details" class="hidden"></div>
      <div data-tab-panel="reviews" class="hidden"></div>
    </div>

    <!-- Inquiry Form -->
    <section class="detail-inquiry">
      <h3><i class="fas fa-envelope mr-2"></i>Send an Inquiry</h3>
      <form data-detail-form class="mp-form detail-inquiry-form">
        <div class="form-grid">
          <input name="inquirer_name" placeholder="Your name *" required>
          <input name="inquirer_email" type="email" placeholder="Email *" required>
          <input name="inquirer_company" placeholder="Your company">
          <input name="inquirer_phone" placeholder="Phone number">
        </div>
        <textarea name="inquirer_message" rows="3" placeholder="Your message..."></textarea>
        <button type="submit" class="mp-btn-primary"><i class="fas fa-paper-plane mr-1"></i>Send Inquiry</button>
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
      ? `window.__LISTING_COMPANY_SLUG = "${companySlug}"; window.__LISTING_PRODUCT_SLUG = "${productSlug}";`
      : legacyId
        ? `window.__LISTING_LEGACY_ID = "${legacyId}";`
        : ''}
  </script>
  <script src="/static/marketplace-listing.js"></script>
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
      <img src="https://bharatai.blob.core.windows.net/aidata/Bharat%20AI%20Innovation%20Logo.png" alt="BHAI" class="dash-sidebar-logo">
      <div>
        <h2 class="text-sm font-bold">AI Marketplace</h2>
        <p class="text-[10px] text-slate-400">Company Dashboard</p>
      </div>
    </div>
    <nav class="dash-sidebar-nav">
      <button class="dash-sidebar-item dash-sidebar-active" data-section="overview"><i class="fas fa-chart-pie"></i> Overview</button>
      <button class="dash-sidebar-item" data-section="listings"><i class="fas fa-boxes"></i> My Listings</button>
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
      <div class="dash-stats-grid">
        <div class="dash-stat-card"><div class="dash-stat-icon"><i class="fas fa-boxes"></i></div><div><p class="dash-stat-label">Total Listings</p><p class="dash-stat-value" id="stat-total">0</p></div></div>
        <div class="dash-stat-card"><div class="dash-stat-icon text-emerald-400"><i class="fas fa-check-circle"></i></div><div><p class="dash-stat-label">Approved</p><p class="dash-stat-value" id="stat-approved">0</p></div></div>
        <div class="dash-stat-card"><div class="dash-stat-icon text-amber-400"><i class="fas fa-clock"></i></div><div><p class="dash-stat-label">Pending</p><p class="dash-stat-value" id="stat-pending">0</p></div></div>
        <div class="dash-stat-card"><div class="dash-stat-icon text-blue-400"><i class="fas fa-eye"></i></div><div><p class="dash-stat-label">Total Views</p><p class="dash-stat-value" id="stat-views">0</p></div></div>
        <div class="dash-stat-card"><div class="dash-stat-icon text-purple-400"><i class="fas fa-envelope"></i></div><div><p class="dash-stat-label">Inquiries</p><p class="dash-stat-value" id="stat-inquiries">0</p></div></div>
        <div class="dash-stat-card"><div class="dash-stat-icon text-amber-400"><i class="fas fa-star"></i></div><div><p class="dash-stat-label">Avg Rating</p><p class="dash-stat-value" id="stat-rating">—</p></div></div>
      </div>
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
            <div class="form-field"><label>Company Name</label><input id="profile-company-name" name="company_name" required></div>
            <div class="form-field"><label>Email</label><input id="profile-email" readonly></div>
            <div class="form-field"><label>Role</label><input id="profile-role" readonly></div>
            <div class="form-field"><label>Member Since</label><input id="profile-since" readonly></div>
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
        <div class="form-grid">
          <div class="form-field"><label>Product Name</label><input id="edit-product-name" name="product_name" required></div>
          <div class="form-field full-width"><label>Description</label><textarea id="edit-description" name="description" rows="3" required></textarea></div>
          <div class="form-field"><label>Target Customer</label><input id="edit-target-customer" name="target_customer"></div>
          <div class="form-field"><label>Pricing Type</label><input id="edit-pricing-type" name="pricing_type"></div>
          <div class="form-field"><label>Pricing Details</label><input id="edit-pricing-details" name="pricing_details"></div>
          <div class="form-field"><label>Tags</label><input id="edit-tags" name="tags"></div>
          <div class="form-field"><label>Target Industry</label><input id="edit-target-industry" name="target_industry"></div>
          <div class="form-field"><label>AI Category</label><input id="edit-ai-category" name="ai_category"></div>
          <div class="form-field"><label>Website URL</label><input id="edit-website-url" name="website_url"></div>
          <div class="form-field"><label>Product URL</label><input id="edit-product-url" name="product_url"></div>
          <div class="form-field"><label>Sales Contact</label><input id="edit-sales-name" name="sales_contact_name"></div>
          <div class="form-field"><label>Sales Email</label><input id="edit-sales-email" name="sales_contact_email"></div>
        </div>
        <div class="mp-modal-actions">
          <button type="button" id="edit-cancel" class="mp-btn-secondary">Cancel</button>
          <button type="submit" class="mp-btn-primary">Save Changes</button>
        </div>
      </form>
    </div>
  </div>

  <script src="/static/marketplace-dashboard.js"></script>
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
      <img src="https://bharatai.blob.core.windows.net/aidata/Bharat%20AI%20Innovation%20Logo.png" alt="BHAI" class="dash-sidebar-logo">
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

  <script src="/static/marketplace-admin.js"></script>
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
        <img src="https://bharatai.blob.core.windows.net/aidata/Bharat%20AI%20Innovation%20Logo.png" alt="BHAI" class="mp-logo-img">
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
        <p>Any registered company can list their AI products. Exhibitors at Bharat AI Innovation 2026 can directly access the marketplace from their exhibitor dashboard — no separate registration needed. Their booth information is automatically linked.</p>
      </div>

      <div class="faq-item">
        <h3><i class="fas fa-check-circle mr-2 text-emerald-400"></i>How does the approval process work?</h3>
        <p>All submitted listings go through an admin review process. Once approved, they appear on the public marketplace. You can track your listing status from your dashboard.</p>
      </div>

      <div class="faq-item">
        <h3><i class="fas fa-search mr-2 text-blue-400"></i>How can buyers find my product?</h3>
        <p>Buyers can search and filter by industry, AI category, and tags. Each listing has a detailed page with overview, technical specs, case studies, and a contact form for sending inquiries directly to you.</p>
      </div>

      <div class="faq-item">
        <h3><i class="fas fa-link mr-2 text-amber-400"></i>How is the marketplace connected to the event?</h3>
        <p>The marketplace is fully integrated with the Bharat AI Innovation 2026 networking app. Exhibitors can list products directly from their exhibitor profile. Approved listings show a "Meet at Booth" badge if the company has a booth at the event.</p>
      </div>

      <div class="faq-item">
        <h3><i class="fas fa-chart-pie mr-2 text-purple-400"></i>What analytics are available?</h3>
        <p>Your company dashboard shows listing views, inquiry count, average ratings, and review history. You can track how your products are performing on the marketplace in real time.</p>
      </div>

      <div class="faq-item">
        <h3><i class="fas fa-star mr-2 text-amber-400"></i>How does the rating system work?</h3>
        <p>Registered users can rate and review approved listings. Ratings are on a 1-5 scale. The Bharat AI Rating reflects the product's overall quality and market readiness as assessed by our review team and community.</p>
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
