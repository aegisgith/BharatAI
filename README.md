# Bharat AI Innovation 2026 - Networking App

## Project Overview
- **Name**: Bharat AI Innovation 2026 Networking & Registration Platform
- **Goal**: Full-stack networking app for India's largest AI conference & exhibition
- **Event**: Bharat AI Innovation Conference & Exhibition 2026
- **Dates**: 2-3 June 2026
- **Venue**: World Trade Center, Mumbai, Cuffe Parade
- **Organizer**: Aegis Knowledge Trust (also organizer of Data Science Congress & Aegis Graham Bell Awards)

## URLs
- **Production**: https://bharatai-networking.pages.dev
- **Admin Panel**: https://bharatai-networking.pages.dev/admin
- **Main Website**: https://bharataiinnovation.com
- **Future subdomain**: networking.bharataiinnovation.com (needs DNS CNAME setup)

## Features (Completed)

### Attendee Portal
- Email magic-link authentication (passwordless sign-in)
- Event dashboard with real-time stats, venue card (WTC Mumbai with Google Maps link)
- RSVP system (Confirm / Maybe / Decline)
- Delegate pass generation (canvas-based, downloadable PNG with QR code)
- Arrival time setting
- 2-day schedule viewer with Day 1 / Day 2 tabs and track filters
- Networking module (attendee directory, connection requests, messaging)
- Exhibition floor with exhibitor profiles
- Award categories browser
- Innovation talks showcase
- Profile management with avatar upload

### Admin Panel (`/admin`)
- Password-protected access (default: `admin123` - CHANGE FOR PRODUCTION)
- Attendee management (CRUD, CSV bulk upload, editable inline fields)
- Column customization (show/hide, width presets, drag-to-resize, localStorage persistence)
- Duplicate detection with visual flagging and grouping
- Column sorting with ascending/descending toggles
- Email notifications via Elastic Email API v4
- Bulk notify all attendees / Resend to non-responders
- Post-ceremony thank-you email with progress bar
- Innovation Talks management (22 speaker slots, Morning/Afternoon)
- Session management, exhibitor management
- Award categories and nominees management
- Analytics dashboard (RSVP stats, registration trends, engagement tracking)
- App settings (app URL, Elastic Email API key, sender email/name)

### Pass Types
| Pass | Price | Includes |
|------|-------|----------|
| Visitor | FREE | Exhibition access, keynotes |
| Delegate | ₹5,000 | Full conference, all tracks, workshops, meals |
| VIP | ₹14,999 | Everything + gala dinner, VIP lounge, priority seating |

## Data Architecture
- **Database**: Cloudflare D1 (SQLite) - `bharatai-production`
- **Tables**: events, attendees, sessions, exhibitors, award_categories, nominees, connections, messages, meetings, announcements, app_settings, innovation_talks, engagement_events
- **Storage**: All data in D1; images via external URLs

## API Endpoints

### Public
- `GET /` - Attendee portal SPA
- `GET /admin` - Admin panel
- `GET /api/events/:id` - Event details
- `GET /api/events/:id/sessions` - Sessions (filterable by date, track)
- `GET /api/events/:id/sessions/tracks` - Available tracks
- `POST /api/register` - Self-registration
- `POST /api/auth/magic-link` - Send magic link email
- `GET /api/auth/verify` - Verify magic link token
- `POST /api/attendees/:id/rsvp` - Submit RSVP

### Admin (password-protected)
- `GET/POST /api/admin/events/:id/attendees` - Manage attendees
- `POST /api/admin/attendees/bulk-upload` - CSV bulk upload
- `POST /api/admin/attendees/:id/notify` - Send notification email
- `POST /api/admin/attendees/notify-all` - Bulk notify
- `POST /api/admin/attendees/resend-non-responders` - Resend to non-RSVP
- `POST /api/admin/attendees/thankyou-list` - Get thank-you email list
- `POST /api/admin/attendees/:id/send-thankyou` - Send thank-you email
- `GET /api/admin/events/:id/attendees/duplicates` - Detect duplicates
- `GET/PUT /api/admin/settings` - App settings

## Tech Stack
- **Backend**: Hono (TypeScript) on Cloudflare Workers
- **Frontend**: Vanilla JS + Tailwind CSS (CDN)
- **Database**: Cloudflare D1 (SQLite)
- **Hosting**: Cloudflare Pages
- **Email**: Elastic Email API v4
- **Auth**: Email magic link (passwordless)

## Schedule (2-Day Event)

### Day 1 - 2 June 2026
- 08:00-09:00 Registration & Welcome Coffee
- 09:00-10:00 Opening Ceremony & Inaugural Keynote
- 10:00-11:00 India's AI Superpower Journey
- 10:00-18:00 AI Exhibition & Innovation Stage
- 11:30-13:00 Generative AI Panel
- 14:00-15:30 Parallel Tracks (Healthcare AI, FinTech AI, AgriTech AI, Manufacturing AI)
- 15:30-17:00 AI Workshops & AI for Governance
- 18:30-21:00 Gala Networking Evening

### Day 2 - 3 June 2026
- 09:00-10:00 Day 2 Opening Keynote
- 10:00-11:30 AI Policy & Governance Roundtable
- 12:00-14:00 Research Paper Presentations
- 14:00-15:00 Lunch & Startup Pitches
- 15:00-16:30 Parallel Tracks (AI Ethics, Education AI, Mobility AI)
- 15:00-17:00 GenAI & Agentic AI Workshop
- 17:00-18:30 Closing Keynote & Valedictory
- 19:00-22:00 Bharat AI Innovation Gala Dinner

## Deployment
- **Platform**: Cloudflare Pages
- **Project**: `bharatai-networking`
- **D1 Database**: `bharatai-production` (ID: c660e94a-ccd1-4819-a202-7814eec6404d)
- **Status**: Active
- **Last Updated**: 2026-03-05

## Setup for Production

### DNS Setup (for subdomain)
Add CNAME record in Cloudflare DNS:
```
networking.bharataiinnovation.com -> bharatai-networking.pages.dev
```

### Change Admin Password
In `src/index.tsx`, find `ADMIN_PASS = 'admin123'` and change to a strong password.

### Configure Elastic Email
1. Go to `/admin` > Settings tab
2. Enter your Elastic Email API key
3. Set sender email (verify in Elastic Email dashboard)
4. Set sender name: "Bharat AI Innovation"
5. Set app URL: `https://networking.bharataiinnovation.com`

### Local Development
```bash
npm install
npm run build
npm run db:reset  # Reset local D1 + apply migrations + seed
pm2 start ecosystem.config.cjs
# Visit http://localhost:3000
```
