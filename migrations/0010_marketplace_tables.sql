-- AI Marketplace tables for Bharat AI Innovation 2026
-- Companies that register to list products
CREATE TABLE IF NOT EXISTS mp_companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'company',
  -- Cross-link: if this company is also an exhibitor/attendee in the networking app
  exhibitor_id INTEGER,
  attendee_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert default admin account (password: admin123 — SHA-256 hash)
INSERT OR IGNORE INTO mp_companies (id, company_name, email, password_hash, role)
VALUES (1, 'Bharat AI Admin', 'admin@bharataiinnovation.com', '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', 'admin');

-- Product/AI tool listings
CREATE TABLE IF NOT EXISTS mp_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  company_name TEXT NOT NULL,
  company_slug TEXT,
  product_name TEXT NOT NULL,
  product_slug TEXT,
  description TEXT NOT NULL,
  target_customer TEXT,
  target_industry TEXT,
  target_functional_area TEXT,
  ai_category TEXT,
  ai_category_custom TEXT,
  tags TEXT,
  innovation TEXT,
  use_cases TEXT,
  pricing_type TEXT,
  pricing_details TEXT,
  product_image_url TEXT,
  logo_url TEXT,
  screenshot_urls TEXT,
  website_url TEXT,
  product_url TEXT,
  demo_url TEXT,
  video_url TEXT,
  founder_name TEXT,
  cto_name TEXT,
  contact_name TEXT,
  company_registration TEXT,
  company_phone TEXT,
  company_address TEXT,
  sales_contact_name TEXT,
  sales_contact_email TEXT,
  sales_contact_phone TEXT,
  current_customers TEXT,
  integration_requirements TEXT,
  supported_platforms TEXT,
  tech_stack TEXT,
  security_protocols TEXT,
  case_studies TEXT,
  certifications_compliance TEXT,
  access_info TEXT,
  support_offering TEXT,
  sla_details TEXT,
  onboarding_process TEXT,
  awards_rating INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  view_count INTEGER DEFAULT 0,
  -- Cross-link: if this company is also an exhibitor at the event
  exhibitor_id INTEGER,
  booth_number TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mp_listings_company ON mp_listings(company_id);
CREATE INDEX IF NOT EXISTS idx_mp_listings_status ON mp_listings(status);
CREATE INDEX IF NOT EXISTS idx_mp_listings_company_slug ON mp_listings(company_slug, product_slug);
CREATE INDEX IF NOT EXISTS idx_mp_listings_exhibitor ON mp_listings(exhibitor_id);

-- File uploads for listings (base64 data stored in D1 for simplicity)
CREATE TABLE IF NOT EXISTS mp_uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT,
  size INTEGER,
  data TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Buyer inquiries on specific listings
CREATE TABLE IF NOT EXISTS mp_inquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL,
  inquirer_name TEXT NOT NULL,
  inquirer_email TEXT NOT NULL,
  inquirer_company TEXT,
  inquirer_phone TEXT,
  inquirer_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (listing_id) REFERENCES mp_listings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mp_inquiries_listing ON mp_inquiries(listing_id);

-- Product reviews/ratings
CREATE TABLE IF NOT EXISTS mp_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL,
  company_id INTEGER NOT NULL,
  company_name TEXT,
  rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (listing_id) REFERENCES mp_listings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mp_reviews_listing ON mp_reviews(listing_id);
