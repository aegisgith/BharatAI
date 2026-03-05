# AGBA Summit 2026 - Event Networking Webapp

## Project Overview
- **Name**: AGBA Awards 2026 (17th Aegis Graham Bell Awards)
- **Event Date**: 27 February 2026, Hotel Ashoka, New Delhi
- **Goal**: A full-featured conference, exhibition, and award event networking webapp with admin dashboard
- **Tech Stack**: Hono + TypeScript + Cloudflare Pages + D1 SQLite + Tailwind CSS + Chart.js

## Live URLs
- **Production**: https://techconnect-summit.pages.dev
- **Admin Dashboard**: https://techconnect-summit.pages.dev/admin
- **Admin Password**: `admin123`

## Features

### Public App (/)

#### Dashboard (Home)
- Live event status with real-time stats
- Announcement live feed with pinned/urgent notifications
- Upcoming sessions quick view

#### Schedule
- Full event agenda with 12 sessions
- Session types: Inauguration, Exhibition, Innovation Talk, Awards Ceremony, Panel, Pitch, etc.

#### Networking Hub
- Browse 70+ attendees with online/offline status
- Search/filter by name, company, role
- Profile cards with unique color avatars (email-hash based)
- Connection requests, direct messaging, meeting scheduling

#### Exhibition Hall
- 3 real exhibitor booths (Castler, Quantum AI Global)
- Visit tracking and product listings

#### AGBA 2026 Awards Categories
- **33 award categories** across multiple innovation domains
- Each category shows icon, name, description, and nomination status
- Categories include: Agriculture, A.I, Automobile, FinTech, Climate Change, Retail, ConsumerTech, Digital Transformation, EV, Insurance, Social Good, Waste Management, Enterprise, Health, GovTech, Manufacturing, Lifescience, HR Tech, L&D, DeepTech, Digital Infra, Defence, IoT, CyberSecurity, Immersive Experience (AR/VR/MR/Meta), Supply Chain, Telecom/5G/6G, and 6 Gen AI sub-categories
- Nominations opening 28 Feb via bellaward.com/categories
- Live voting system with progress bars (when nominees added)

#### User Profile Features
- Photo upload (resize to 256px, store as Base64 in D1)
- Avatar priority: Uploaded photo > email-hash unique color initials
- Edit profile: name, company, bio, interests, social links (LinkedIn, Twitter, Website)
- Engagement score ring (0-100%)

#### Inbox
- Connection management (accept/decline)
- Meeting management with status filters

---

### Admin Dashboard (/admin)

#### Overview
- Real-time event statistics with 6 metric cards
- Interactive charts (Attendees by Role, Top Exhibitors)
- Recent registrations table
- Edit event details

#### Attendee Management
- Full attendee list with search/filter
- **Add single attendee** (modal with all fields)
- **Bulk upload** via CSV/Excel
- Edit attendee profiles (role, badge type, photo upload, bio, interests, social links)
- Photo upload per attendee (admin can upload via camera icon in edit modal)
- Send notification emails (individual or bulk via Elastic Email)
- Delete attendees

#### Session Management
- Full CRUD for sessions (title, speaker, type, track, room, time)

#### Exhibitor Management
- Full CRUD for exhibitor booths
- Auto-creates exhibitor records for exhibitor badge types

#### Awards Management
- CRUD 33 award categories (create, edit, delete)
- CRUD nominees (add, edit, delete per category)
- Toggle voting open/closed per category
- Declare winners with crown icon
- Reset votes per category

#### Announcements
- Full CRUD + Emergency Broadcast feature

#### Analytics & Reports
- Key metrics, charts, and Top 10 nominees leaderboard

#### Settings
- **Elastic Email Configuration**: API key, sender email (delegates@bellaward.com), sender display name
- Key verification and test email sending
- Setup guide with step-by-step instructions

## API Endpoints

### Public APIs
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/events/:id` | Event details |
| GET | `/api/events/:id/stats` | Event statistics |
| GET | `/api/events/:id/sessions` | Sessions |
| GET | `/api/events/:id/attendees` | Attendees |
| GET | `/api/attendees/:id` | Attendee profile |
| GET | `/api/attendees/:id/dashboard` | User dashboard |
| PUT | `/api/attendees/:id/profile` | Update profile |
| POST | `/api/attendees/:id/avatar` | Upload avatar photo |
| DELETE | `/api/attendees/:id/avatar` | Remove avatar photo |
| POST | `/api/events/:id/attendees/register` | Register/sign in |
| POST | `/api/events/:id/attendees/signin` | Sign in existing |
| GET | `/api/attendees/:id/connections` | User connections |
| POST | `/api/connections` | Send connection request |
| PUT | `/api/connections/:id` | Update connection status |
| GET | `/api/messages/:userId/:otherUserId` | Conversation |
| POST | `/api/messages` | Send message |
| GET | `/api/events/:id/exhibitors` | Exhibitors |
| POST | `/api/exhibitors/:id/visit` | Record booth visit |
| GET | `/api/events/:id/awards` | Awards with nominees |
| POST | `/api/awards/vote` | Cast vote |
| GET | `/api/awards/votes/:attendeeId` | User votes |
| GET | `/api/events/:id/announcements` | Announcements |

### Admin APIs
| Method | Endpoint | Description |
|--------|----------|-------------|
| PUT | `/api/admin/events/:id` | Update event |
| POST | `/api/admin/attendees` | Add single attendee |
| POST | `/api/admin/attendees/bulk` | Bulk upload attendees (CSV/Excel) |
| PUT | `/api/admin/attendees/:id` | Update attendee |
| DELETE | `/api/admin/attendees/:id` | Delete attendee |
| POST | `/api/admin/attendees/:id/notify` | Send notification email |
| POST | `/api/admin/attendees/notify-all` | Notify all attendees |
| POST | `/api/admin/sessions` | Create session |
| PUT | `/api/admin/sessions/:id` | Update session |
| DELETE | `/api/admin/sessions/:id` | Delete session |
| POST | `/api/admin/exhibitors` | Create exhibitor |
| PUT | `/api/admin/exhibitors/:id` | Update exhibitor |
| DELETE | `/api/admin/exhibitors/:id` | Delete exhibitor |
| POST | `/api/admin/award-categories` | Create award category |
| PUT | `/api/admin/award-categories/:id` | Update category |
| DELETE | `/api/admin/award-categories/:id` | Delete category |
| POST | `/api/admin/nominees` | Add nominee |
| PUT | `/api/admin/nominees/:id` | Update nominee |
| DELETE | `/api/admin/nominees/:id` | Delete nominee |
| POST | `/api/admin/awards/:categoryId/reset-votes` | Reset votes |
| POST | `/api/admin/announcements` | Create announcement |
| PUT | `/api/admin/announcements/:id` | Update announcement |
| DELETE | `/api/admin/announcements/:id` | Delete announcement |
| POST | `/api/admin/events/:id/broadcast` | Emergency broadcast |
| GET | `/api/admin/events/:id/analytics` | Full analytics data |
| GET | `/api/admin/settings` | Get app settings |
| PUT | `/api/admin/settings` | Update app settings |
| POST | `/api/admin/settings/verify-email` | Verify Elastic Email key |
| POST | `/api/admin/settings/test-email` | Send test email |

## Data Architecture
- **Database**: Cloudflare D1 (SQLite)
- **Production DB**: `techconnect-production` (ID: a73e8556-591a-4bc4-978d-8fff8ec21094)
- **Tables**: events, sessions, attendees, connections, messages, meetings, exhibitors, booth_visits, award_categories, award_nominees, award_votes, announcements, app_settings
- **Avatar Storage**: Base64 images stored in `avatar_url` column of attendees table
- **13 indexed tables** with foreign key relationships

## User Guide

### Public Users
1. Visit https://techconnect-summit.pages.dev and register with name + email
2. Browse event dashboard, schedule, and exhibition hall
3. Connect with other attendees and send messages
4. View AGBA 2026 Award Categories (nominations opening 28 Feb)
5. Upload your photo via Edit Profile for a personalized avatar
6. Manage connections and meetings in the Inbox
7. View engagement score in the "Me" tab

### Admins
1. Visit https://techconnect-summit.pages.dev/admin and enter password: `admin123`
2. Overview: See real-time stats, charts, and recent registrations
3. Add attendees individually or via bulk CSV upload
4. Upload attendee photos via Edit modal (camera icon)
5. Configure email settings in Settings tab (Elastic Email API key)
6. Send notification emails to attendees (individual or bulk)
7. Manage 33 award categories and nominees
8. Use Emergency Broadcast for urgent communications
9. View Analytics for deep engagement metrics

## Deployment
- **Platform**: Cloudflare Pages
- **Status**: Deployed
- **Production URL**: https://techconnect-summit.pages.dev
- **Project Name**: techconnect-summit
- **Last Updated**: 2026-02-20
