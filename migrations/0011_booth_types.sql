-- Booth Types Catalog
CREATE TABLE IF NOT EXISTS booth_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  size_label TEXT NOT NULL,          -- e.g. "1.5 × 1.2"
  width_m REAL NOT NULL,
  depth_m REAL NOT NULL,
  area_sqm REAL NOT NULL,
  area_sqft INTEGER NOT NULL,
  total_count INTEGER NOT NULL DEFAULT 0,
  total_area_sqm REAL NOT NULL DEFAULT 0,
  total_area_sqft INTEGER NOT NULL DEFAULT 0,
  price_inr INTEGER NOT NULL,
  available_count INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  features TEXT,                     -- JSON array of feature strings
  color TEXT DEFAULT '#4c6ef5',      -- theme color hex
  icon TEXT DEFAULT 'fa-store',      -- FontAwesome icon class
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Booth Requests
CREATE TABLE IF NOT EXISTS booth_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  booth_type_id INTEGER NOT NULL,
  attendee_id INTEGER,
  -- Company / Contact Info
  company_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  website TEXT,
  -- Company Details
  industry TEXT,
  company_size TEXT,
  company_description TEXT,
  -- Booth Preferences
  quantity INTEGER NOT NULL DEFAULT 1,
  preferred_zone TEXT,
  preferred_booth_numbers TEXT,
  special_requirements TEXT,
  -- Products / Services
  products_to_display TEXT,
  -- Financial
  total_price_inr INTEGER NOT NULL DEFAULT 0,
  gst_amount INTEGER NOT NULL DEFAULT 0,
  grand_total INTEGER NOT NULL DEFAULT 0,
  -- Payment Status
  payment_status TEXT NOT NULL DEFAULT 'pending',  -- pending, invoice_sent, paid, cancelled, refunded
  payment_reference TEXT,
  payment_date DATETIME,
  invoice_number TEXT,
  -- Request Status
  status TEXT NOT NULL DEFAULT 'submitted',  -- submitted, under_review, approved, rejected, confirmed, cancelled
  admin_notes TEXT,
  reviewed_by TEXT,
  reviewed_at DATETIME,
  -- Timestamps
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booth_type_id) REFERENCES booth_types(id),
  FOREIGN KEY (attendee_id) REFERENCES attendees(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_booth_requests_event ON booth_requests(event_id);
CREATE INDEX IF NOT EXISTS idx_booth_requests_status ON booth_requests(status);
CREATE INDEX IF NOT EXISTS idx_booth_requests_payment ON booth_requests(payment_status);
CREATE INDEX IF NOT EXISTS idx_booth_requests_email ON booth_requests(email);
CREATE INDEX IF NOT EXISTS idx_booth_requests_attendee ON booth_requests(attendee_id);
CREATE INDEX IF NOT EXISTS idx_booth_types_slug ON booth_types(slug);

-- Seed Booth Types
INSERT OR IGNORE INTO booth_types (slug, name, size_label, width_m, depth_m, area_sqm, area_sqft, total_count, total_area_sqm, total_area_sqft, price_inr, available_count, description, features, color, icon, sort_order) VALUES
('startup-pod', 'Startup Pod', '1.5 × 1.5', 1.5, 1.5, 2.25, 24, 40, 90, 968, 38000, 40,
  'Compact, high-visibility pod ideal for early-stage startups to showcase their MVP or pitch deck. Perfect for solo founders and small teams.',
  '["1 table + 1 chair","Power outlet","Wi-Fi access","Badge for 1 person","Basic signage panel","Event listing"]',
  '#22c55e', 'fa-seedling', 1),

('explorer-booth', 'Explorer Booth', '2 × 2', 2.0, 2.0, 4.0, 43, 35, 140, 1505, 129000, 35,
  'A great starter booth for growing companies ready to engage visitors with product demos and live interactions.',
  '["Branded backdrop panel","1 table + 2 chairs","Power strip (2 sockets)","Wi-Fi access","Badges for 2 persons","Shelf unit","Event app listing"]',
  '#3b82f6', 'fa-compass', 2),

('innovator-booth', 'Innovator Booth', '3 × 2', 3.0, 2.0, 6.0, 65, 20, 120, 1300, 195000, 20,
  'Mid-size booth designed for companies with live demos, interactive screens, and hands-on product experiences.',
  '["Full branded backdrop","Counter + 3 chairs","Power strip (4 sockets)","Monitor stand","Wi-Fi + Ethernet port","Badges for 3 persons","Spotlight lighting","Event app featured listing"]',
  '#8b5cf6', 'fa-lightbulb', 3),

('accelerator-booth', 'Accelerator Booth', '3 × 3', 3.0, 3.0, 9.0, 97, 15, 135, 1453, 291000, 15,
  'Premium booth for established companies wanting significant floor presence, ideal for product launches and investor meetings.',
  '["Custom wall graphics","Meeting area + 4 chairs","Power strip (6 sockets)","55\" display screen","Wi-Fi + Ethernet","Badges for 4 persons","Dedicated lighting rig","Storage cabinet","Event app premium listing","1 session speaking slot"]',
  '#f59e0b', 'fa-rocket', 4),

('enterprise-booth', 'Enterprise Booth', '4 × 2', 4.0, 2.0, 8.0, 86, 10, 80, 861, 258000, 10,
  'Large-format booth for enterprise companies seeking to make a strong brand statement with dedicated meeting space.',
  '["Full custom design walls","Executive meeting lounge","Power (10 sockets + UPS backup)","2× 55\" display screens","Dedicated internet line","Badges for 6 persons","Premium lighting package","Lockable storage room","Event app headline listing","2 session speaking slots","Dedicated host/hostess"]',
  '#ef4444', 'fa-building', 5),

('flagship-pavilion', 'Flagship Pavilion', '6 × 2', 6.0, 2.0, 12.0, 129, 8, 96, 1033, 387000, 8,
  'Marquee pavilion for industry leaders. A commanding presence with custom architecture, private zones, and VIP hospitality.',
  '["Fully custom pavilion design","Private meeting room","VIP lounge area","Power (15 sockets + UPS)","3× display screens (55\"+)","Dedicated fiber internet","Badges for 10 persons","Theatre-style lighting","PA system","Full storage facility","Event app title sponsor listing","3 keynote slots","Dedicated event coordinator","Catering for 20 guests/day"]',
  '#ec4899', 'fa-crown', 6),

('mega-pavilion', 'Mega Pavilion', '7 × 7.7', 7.0, 7.7, 53.90, 580, 4, 215, 2317, 1740000, 4,
  'The ultimate exhibition experience. A landmark installation for global brands with complete creative freedom, concierge services, and exclusive event integration.',
  '["Bespoke architectural pavilion","Multiple meeting rooms","VIP & press lounge","Full power infrastructure","5× display screens + LED wall","Dedicated fiber internet","Badges for 20 persons","Professional AV & lighting","Integrated PA system","Full back-office facility","Event app presenting partner","5 keynote / panel slots","Dedicated event manager","Premium catering package","Branding across venue signage","Priority placement at entrance"]',
  '#f97316', 'fa-gem', 7);
