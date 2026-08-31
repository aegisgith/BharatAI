-- Tax invoices for paid passes.
--
-- Delegate and VIP passes are bought by people who expense them. Payment happens on
-- mUni Campus through CCAvenue, which issues a payment receipt, not a GST invoice --
-- so a buyer's finance team has nothing to reimburse against. Every request for one
-- was being answered by hand.
--
-- Money is stored in paise as integers. A rupee amount held as a float eventually
-- prints a total that does not match what the card was charged, and an invoice whose
-- total disagrees with the payment is worse than no invoice.
--
-- The seller's own details (legal name, GSTIN, address) live in app_settings rather
-- than here, because they belong to the organisation and not to any one invoice.

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT NOT NULL UNIQUE,
  attendee_id INTEGER,

  buyer_name TEXT NOT NULL,
  buyer_email TEXT NOT NULL,
  buyer_company TEXT,
  buyer_gstin TEXT,
  buyer_address TEXT,
  buyer_phone TEXT,

  item_desc TEXT NOT NULL,
  order_ref TEXT,
  payment_ref TEXT,
  paid_at DATETIME,

  currency TEXT NOT NULL DEFAULT 'INR',
  gst_rate INTEGER NOT NULL DEFAULT 18,
  taxable_paise INTEGER NOT NULL,
  cgst_paise INTEGER NOT NULL DEFAULT 0,
  sgst_paise INTEGER NOT NULL DEFAULT 0,
  igst_paise INTEGER NOT NULL DEFAULT 0,
  total_paise INTEGER NOT NULL,
  place_of_supply TEXT,

  emailed_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invoices_email ON invoices(buyer_email);
CREATE INDEX IF NOT EXISTS idx_invoices_attendee ON invoices(attendee_id);
