-- Inquiries table for collecting all types of inquiries
CREATE TABLE IF NOT EXISTS inquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL DEFAULT 1,
  inquiry_type TEXT NOT NULL DEFAULT 'general',
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT DEFAULT '',
  organization TEXT DEFAULT '',
  subject TEXT DEFAULT '',
  message TEXT DEFAULT '',
  metadata TEXT DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'new',
  admin_notes TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_inquiries_event ON inquiries(event_id);
CREATE INDEX IF NOT EXISTS idx_inquiries_type ON inquiries(inquiry_type);
CREATE INDEX IF NOT EXISTS idx_inquiries_status ON inquiries(status);
CREATE INDEX IF NOT EXISTS idx_inquiries_email ON inquiries(email);
