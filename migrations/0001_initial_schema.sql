-- Events table
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  event_type TEXT NOT NULL DEFAULT 'conference', -- conference, exhibition, awards, hybrid
  venue TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  banner_url TEXT,
  status TEXT NOT NULL DEFAULT 'upcoming', -- upcoming, live, completed
  max_attendees INTEGER DEFAULT 500,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Schedule / Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  speaker_name TEXT,
  speaker_title TEXT,
  speaker_avatar TEXT,
  session_type TEXT NOT NULL DEFAULT 'talk', -- talk, panel, workshop, keynote, break, networking
  track TEXT,
  room TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  capacity INTEGER DEFAULT 100,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

-- Attendees / Users table
CREATE TABLE IF NOT EXISTS attendees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT,
  job_title TEXT,
  bio TEXT,
  avatar_url TEXT,
  interests TEXT, -- comma-separated tags
  linkedin_url TEXT,
  twitter_url TEXT,
  website_url TEXT,
  role TEXT NOT NULL DEFAULT 'attendee', -- attendee, speaker, exhibitor, organizer, vip
  badge_type TEXT DEFAULT 'general', -- general, vip, speaker, exhibitor, press
  is_online INTEGER DEFAULT 0,
  last_seen TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id, email)
);

-- Connections / Networking table
CREATE TABLE IF NOT EXISTS connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  from_attendee_id INTEGER NOT NULL,
  to_attendee_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, accepted, declined
  message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (from_attendee_id) REFERENCES attendees(id),
  FOREIGN KEY (to_attendee_id) REFERENCES attendees(id),
  UNIQUE(event_id, from_attendee_id, to_attendee_id)
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  sender_id INTEGER NOT NULL,
  receiver_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  is_read INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (sender_id) REFERENCES attendees(id),
  FOREIGN KEY (receiver_id) REFERENCES attendees(id)
);

-- Meeting Requests table
CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  requester_id INTEGER NOT NULL,
  requestee_id INTEGER NOT NULL,
  title TEXT,
  meeting_time TEXT NOT NULL,
  duration_minutes INTEGER DEFAULT 15,
  location TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, accepted, declined, cancelled
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (requester_id) REFERENCES attendees(id),
  FOREIGN KEY (requestee_id) REFERENCES attendees(id)
);

-- Exhibitors / Booths table
CREATE TABLE IF NOT EXISTS exhibitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  company_name TEXT NOT NULL,
  description TEXT,
  logo_url TEXT,
  banner_url TEXT,
  booth_number TEXT,
  booth_size TEXT DEFAULT 'standard', -- standard, premium, platinum
  category TEXT,
  website_url TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  products TEXT, -- comma-separated product/service list
  social_links TEXT, -- JSON string
  visitor_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

-- Booth Visits (tracking)
CREATE TABLE IF NOT EXISTS booth_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exhibitor_id INTEGER NOT NULL,
  attendee_id INTEGER NOT NULL,
  event_id INTEGER NOT NULL,
  visited_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  interested INTEGER DEFAULT 0,
  FOREIGN KEY (exhibitor_id) REFERENCES exhibitors(id),
  FOREIGN KEY (attendee_id) REFERENCES attendees(id),
  FOREIGN KEY (event_id) REFERENCES events(id)
);

-- Award Categories table
CREATE TABLE IF NOT EXISTS award_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  voting_open INTEGER DEFAULT 1,
  max_votes_per_user INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

-- Award Nominees table
CREATE TABLE IF NOT EXISTS award_nominees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL,
  event_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  company TEXT,
  vote_count INTEGER DEFAULT 0,
  is_winner INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES award_categories(id),
  FOREIGN KEY (event_id) REFERENCES events(id)
);

-- Award Votes table
CREATE TABLE IF NOT EXISTS award_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nominee_id INTEGER NOT NULL,
  category_id INTEGER NOT NULL,
  attendee_id INTEGER NOT NULL,
  event_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (nominee_id) REFERENCES award_nominees(id),
  FOREIGN KEY (category_id) REFERENCES award_categories(id),
  FOREIGN KEY (attendee_id) REFERENCES attendees(id),
  FOREIGN KEY (event_id) REFERENCES events(id),
  UNIQUE(category_id, attendee_id)
);

-- Announcements / Live Feed table
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  announcement_type TEXT DEFAULT 'general', -- general, urgent, schedule_change, award_result
  author_name TEXT,
  pinned INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_sessions_event ON sessions(event_id);
CREATE INDEX IF NOT EXISTS idx_attendees_event ON attendees(event_id);
CREATE INDEX IF NOT EXISTS idx_attendees_email ON attendees(email);
CREATE INDEX IF NOT EXISTS idx_connections_event ON connections(event_id);
CREATE INDEX IF NOT EXISTS idx_connections_from ON connections(from_attendee_id);
CREATE INDEX IF NOT EXISTS idx_connections_to ON connections(to_attendee_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id);
CREATE INDEX IF NOT EXISTS idx_exhibitors_event ON exhibitors(event_id);
CREATE INDEX IF NOT EXISTS idx_award_nominees_category ON award_nominees(category_id);
CREATE INDEX IF NOT EXISTS idx_award_votes_nominee ON award_votes(nominee_id);
CREATE INDEX IF NOT EXISTS idx_announcements_event ON announcements(event_id);
