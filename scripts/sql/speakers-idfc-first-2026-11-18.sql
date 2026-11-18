-- Two speakers from IDFC FIRST Bank's New Economy Group (organiser, 18 Nov 2026), on the
-- speakers list with no session yet. Email and mobile are added later in Admin.
-- Girish Malhotra was already on the list (added in Admin with a photo, no bio): his bio
-- is filled only where it is empty. Ashish Sharma is added, with no photo yet (upload it
-- in Admin -> Conference -> Speakers). Safe to run twice.
UPDATE speakers SET bio = 'Girish Malhotra brings 35+ years of experience in banking and financial services, including a 16-year stint with Citibank in India and leadership roles abroad in Vietnam and Dubai. Currently, he heads the New Economy Group at IDFC FIRST Bank, strategically empowering the startup, VC, and PE ecosystem.', updated_at = CURRENT_TIMESTAMP
WHERE event_id = 1 AND slug = 'girish-malhotra' AND COALESCE(bio, '') = '';
INSERT INTO speakers (event_id, slug, name, role, organisation, photo_url, bio, is_featured, is_published, sort_order)
SELECT 1, 'ashish-sharma', 'Ashish Sharma', 'Head - Product, Program & Strategy, New Economy Group', 'IDFC FIRST Bank', '',
  'Ashish Sharma is a banking and fintech leader with 15+ years of experience in building new businesses and driving innovation across India’s startup ecosystem. He currently leads Product, Program & Strategy for the New Economy Group at IDFC FIRST Bank, overseeing the bank’s engagement with startups, digital-first enterprises, and the VC/PE ecosystem.

Known for his focus on innovation and ecosystem building, Ashish has been instrumental in creating high-impact platforms and enabling sustainable growth across India’s new-age economy.',
  0, 1, 84
WHERE NOT EXISTS (SELECT 1 FROM speakers WHERE event_id = 1 AND (slug = 'ashish-sharma' OR lower(name) = 'ashish sharma'));
