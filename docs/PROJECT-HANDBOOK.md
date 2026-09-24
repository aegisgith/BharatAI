# Bharat AI Innovation platform — handbook

Last updated **24 September 2026**. Read this before changing `src/index.tsx`, the campus pages, or anything that emails attendees. It records what exists, why, and how to verify it, so the next session does not have to rediscover it.

Secrets, claim codes and conference registration totals are deliberately **not** in this file (the repo is on GitHub, and the registration count is withheld from the public until it passes 5,000).

---

## 1. Where things live

| Surface | Where |
|---|---|
| Worker, all API routes, attendee app, admin panel | `src/index.tsx` (~34,000 lines, Hono). The attendee app is the template literal returned by `mainPageHTML()`, the admin panel is `adminPageHTML()`. Routes are `app.get/post(...)` above both. |
| Marketing site | `public/*.html` (served as-is). Campus pages: `public/campus-series.html`, `campus-djsanghvi.html`, `campus-jnu.html`. |
| Pass renderer | `public/js/pass-render.js` (loaded as `/js/pass-render.js?v=20260917` by both app and admin) |
| Social creative renderer | `public/js/social-card.js` (variants: attending, speaker, exhibitor, `panel`, `panel_attended`) |
| Service worker | `public/sw.js` — `VERSION = 'bhai-v10'` |
| Database | Cloudflare D1 `bharatai-production`; schema only via `migrations/*.sql` |
| Uploads | R2 bucket `bharatai-uploads`, served at `/api/uploads/...` |
| Email | Elastic Email v4 transactional API |
| Build guards | `scripts/check-inline-js.mjs`, `scripts/check-no-counts.mjs` (run by `npm run build`) |
| Campus tooling | `scripts/import-muni-panel.py`, `scripts/import-linkedin-panel.py`, `scripts/make-panel-claim-slide.py` |
| Verification | `scripts/verify/` (see §3) |

---

## 2. Rules that bite — read first

1. **`src/index.tsx` is CRLF on disk.** Edit with scripts that convert to LF, patch with exact-string asserts, and write back CRLF. Git blobs are LF.
2. **Inside `mainPageHTML()` / `adminPageHTML()` template literals:** backticks are `` \` ``, `${` is `\${`, and **never write `\'`** — the literal eats the backslash and the whole page script dies. Use `&quot;` in HTML attributes or double-quoted JS strings. A `//` comment inside the literal is served to the public.
3. **Every function in those page scripts is a global.** `grep -c "function <name>"` before adding one; a duplicate silently shadows the first.
4. **`npm run build` must end with** `check-inline-js … /app: 1 inline block(s) parse`, `/admin: 1 …`, and `public/*.html: N inline block(s) … parse`. Since 17 Sep the check also parses every inline script on the static site — a broken string in `campus-djsanghvi.html` took the panel registration form down for ~2 hours before that.
5. **Several Claude sessions work in this checkout at once.** The git index is shared: always `git commit --only -- <your paths>` and check `git diff --cached --stat` first. A plain `git commit` sweeps a peer's staged files. Announce which regions of `src/index.tsx` you are editing.
6. **Production D1 writes (migrations, imports) and `wrangler pages deploy` are refused by the Claude Code auto-mode classifier.** Hand the organiser the exact command to run in their terminal. Reads work: use `wrangler d1 execute ... --remote --command "SELECT ..." --json > file` (with `--file`, `--json` returns only a summary).
7. **Wrangler errors:** `Failed to fetch auth token: 400` = login expired → `npx wrangler login`. Error `7403` ("account not authorized") on 17 Sep was transient; the same login worked seconds later — retry.
8. **Subagents with `isolation: "worktree"` get the wrong repository** (`C:\Users\Bhupesh` is itself a git repo). Brief them to `git clone` this repo into their worktree folder, commit there, then `git fetch <clone> <branch>:<branch>` and merge. `public/css/tailwind.css` always conflicts (one minified line): take either side and rebuild.
9. **Bump versions when shipping cached assets:** `sw.js` `VERSION` when API caching changes; `?v=` on `/js/*.js` script tags when those files change.
10. **Icons:** `python scripts/build-fa-subset.py --check` must pass. Any argument other than `--check` **rebuilds** the subset files.
11. **Never show the word "RSVP" to students.** Use "Are you coming?", "I'm coming", "I can't make it". Code names may keep `rsvp`.
12. **Students are on phones.** Anything a student does (photo, creative, certificate, pass, answers) must work on a 390px phone and in in-app browsers. Verify with `phone-test.cjs`.

---

## 3. Deploy, database, verification

**Deploy:** `git push origin main` → Cloudflare Pages builds and deploys (usually 1–5 min; one build failed for no code reason on 17 Sep and the next succeeded). Check with `npx wrangler pages deployment list --project-name=bharatai-networking`.

**Migrations applied to production (all confirmed 17 Sep 2026):**

| Migration | Adds |
|---|---|
| 0040_panel_registrations | `panel_registrations` (one row per person per panel: source, confirmation, claim, certificate, card) |
| 0041_main_event_consent | `attendees.main_event` (1 = conference registrant, 0 = panel only / declined), `main_event_answered_at` |
| 0042_consent_and_hot_indexes | `attendees.marketing_consent`, `attendees.unsubscribed_at`, indexes on `(event_id, name, id)`, `unsubscribed_at`, `messages(receiver_id, is_read)` |
| 0043_panel_rsvp | `panel_registrations.rsvp_status`, `rsvp_at`, `reminder_sent_at`, `reminder_error` |

Take a backup before any migration: `npx wrangler d1 export bharatai-production --remote --output=backup-pre-XXXX-<date>.sql` (these files are gitignored; they contain PII and the email key).

**Verification — run all of it for any change that touches the app:**

```
npm run build          # must pass, including check-inline-js on public/*.html
npm run verify         # local: every suite, starts and stops its own harnesses
git push origin main   # deploy
npm run verify:prod    # production, read-only, no credentials
```

| Suite (`scripts/verify/`) | What it proves |
|---|---|
| `smoke-routes.mjs attendee` (36) | Built worker: admin + desk route guards, security batch, attendee routes, markers present |
| `smoke-directory-teaser.mjs` (24) | Free-pass teaser: 24 + 12 locked, no links, view tokens, profile rules, delegate/admin unchanged |
| `smoke-panel-answers.mjs` (25) | `/panel-rsvp` signatures and scanner safety, app answer route, reminder pump, CSVs, closed after start |
| `smoke-marketplace.mjs` | AI marketplace gates, pages and paced exhibitor invites (owned by the marketplace session) |
| `browser-delegate.cjs` via `app-harness.mjs` (18) | Delegate in `/app`: directory, chat, connect (apostrophe name), meet, Visitor gating, inbox, Back, Escape, no injected script runs |
| `phone-test.cjs` via `phone-harness.mjs` (50) | Emulated Android phone: photo upload, creative share sheet + caption, in-app fallback, "Are you coming?", panel certificate, pass, November question, email answers through the real `/panel-rsvp` routes, directory, admin Campus panels block |
| `prod-sweep.mjs` (33) | Production pages, headers, guards, caches, new routes |
| `live-phone-check.cjs` (8) | Production on a phone: new functions present, no JS errors, forged link refused, campus forms (POST intercepted) |

Any session may register a suite in `run-all.mjs`, so the total moves on its own: 153 on 17 Sep, then 193 and 192 within one morning on 24 Sep. The per-suite counts above are a rough guide, not a contract. Run the command and read what it prints rather than trusting a number written anywhere, including here.

Playwright comes from `scripts/verify/playwright.cjs` (local `playwright-core`, `$PLAYWRIGHT_CORE`, or the copy inside the global Playwright MCP install) and launches system Edge — no browser download needed.

**Harness gotchas:** `hasUploadedPhoto()` only accepts `data:`, `/api/uploads/` or `http(s)` URLs; the profile needs `recentConnections`; the admin overview needs `analytics.recentRegistrations` as an array and the real `/api/events/1` shape; the admin panel opens only with `localStorage.tc_admin = '1'` plus `sessionStorage.tc_admin_token`; `page.goto` to the same URL with only a new `#hash` does not reload; links built from `app_url` point at production unless the stand-in DB returns a local `app_url`.

---

## 4. Product rules decided (do not undo without the organiser)

| Rule | Decided | Enforced in |
|---|---|---|
| A campus-panel registration is **not** a conference registration; the conference is asked, never assumed | 17 Sep | `main_event` (0041); `mainEventClause()`; pass token, badge desk, directory, counts, conference creative |
| Conference numbers, charts, lunch and check-in stats count conference registrants only (sponsors must not see students inflating them) | 17 Sep | `mainEventClause()` in stats, analytics, growth, lunch, check-in, suggestions; admin grid defaults to "Conference registrants" |
| Initiating networking is paid; **receiving, accepting and replying stay free** | 11 Sep | `canInitiateNetworking()` on connections, messages, meetings |
| A free Visitor Pass sees a directory **teaser**, not the directory, and no contact links | 17 Sep | `directoryViewer()`, teaser branch of `GET /api/events/:id/attendees`, `GET /api/attendees/:id` |
| Registration count hidden from public and attendees until 5,000 | earlier | `mayRevealCount()`; `check-no-counts.mjs` |
| Campaign mail honours unsubscribes and "no" to marketing; transactional mail and urgent broadcasts do not | 17 Sep | `suppressionClause()` |
| Attendance at other colleges is **claimed** with a closing-slide code, never taken at a desk | 17 Sep | `/api/attendees/:id/panels/:slug/claim` |
| No government backing claims anywhere | 17 Sep | site copy (see memory `no-meity-backing-claims`) |
| Pass prices are **+ GST**; Innovation Talks are 8 minutes; the evening is "Bharat AI CXO Innovation Night" | 17 Sep | site copy, app copy, D1 `sessions` rows |

---

## 5. Campus Series panels

### Configuration
`CAMPUS_PANELS` in `src/index.tsx` (search `const CAMPUS_PANELS`). Each panel: `slug`, `title`, `titleShort`, `subtitle`, `host`, `hostShort`, `city`, `dateLabel`, `dateShort`, `timeLabel`, `venue`, `pageUrl`, `startsAt`/`endsAt`, `claimOpensAt`/`claimClosesAt` (ISO with `+05:30`), `hostLogo`, `speakers`, `hashtags`, `hostLike` (lower-case fragments of the host's name/email domain that mark a registrant as the host's own student; everyone else is a guest).

Live panels: `djsanghvi-21sep` (DJ Sanghvi, Mon 21 Sep 2026, 11:00–12:30 IST, claims closed 23:59 on 23 Sep) and `jnu-30sep` (JNU, Wed 30 Sep 2026, 15:00–16:30 IST, claims 16:00 30 Sep → 23:59 2 Oct; seven panellists set on 23 Sep, `hostLogo` and claim code still empty).

### Registrations
Every panel registrant is an `attendees` row tagged `registration_source = 'campus:<slug>'` (unless they registered for the conference first, which keeps their source) plus a `panel_registrations` row with `source` = `page` | `muni` | `linkedin`.

- **Panel page form** (`campus-*.html`) posts to `/api/events/1/attendees/register` with the campus tag → panel row + `main_event = 0`.
- **mUni Campus export (.xls):** `python scripts/import-muni-panel.py --xls "<file>" --panel <slug> --out import.sql [--new-code]`. mUni's .xls breaks xlrd's directory parser; the script reads the raw Workbook stream with `olefile`.
- **LinkedIn Lead Gen export:** `python scripts/import-linkedin-panel.py --file "<export>" --panel <slug> --out import-linkedin.sql` → also writes `import-linkedin.consent.sql` (apply after 0042). The form's marketing question is recorded in `marketing_consent`.
  - **Two live forms carry the same name.** "Registration form for Pre-Event of Bharat AI Innovation" exists twice: form `7503394077217042432` (imported to DJ Sanghvi on 17 Sep) and form `7503370180731846656` (imported to JNU on 24 Sep). Two downloads with the same file name can be different audiences, so read the `form_id` the script prints, not the file name.
  - The delimiter varies: LinkedIn's own download is comma-separated UTF-8, and a file that has been through Excel is tab-separated Windows-1252 with `event_id` mangled into `7.50339E+18`. The script sniffs the header, so pass the file as it came.
  - `--exclude-file <earlier export>` (repeatable) skips leads already imported, which is how to import only what a newer download added.
- Both scripts are `INSERT OR IGNORE` on email and safe to re-run on a fresh export. The organiser runs the SQL files.
- **Check any generated file before it is run:** `python scripts/verify/check-import-sql.py <import.sql>` applies it to a scratch database shaped like production, twice, and proves that each lead gets one attendee row and one panel row, that a person already in the database keeps their details and conference place, that nobody lands in the conference count, and that a second run changes nothing.

### Emails
- **Confirmation** — `sendPanelConfirmationEmail()`: brand header (`emailBrandHeader`), host logo band, topic/date/time/venue/panellists, a 7-day, 5-use sign-in link that lands on the creative, and "Would you like to come to the main conference too?" with yes/no deep links. Admin → Overview → Campus panels: **Preview email**, **Send confirmations** (pumped 5 at a time, **Stop** parks the rest server-side, **Resume** un-parks only paused rows).
- **Pace (24 Sep):** both sends go out **one email at a time**, with the gap chosen in the control beside the button (`paceControl`, `panelGapSeconds`, `panelWait`). Two minutes is the default and the choice is remembered in that browser. A burst of identical mail to the same few domains is what puts a sender in the spam folder. The progress line counts down and gives the finishing time; 129 emails at two minutes takes about four and a half hours and the tab has to stay open. Stop parks the rest on the server, Resume continues, and nobody is mailed twice.
- **"Are you coming?" reminder** — `sendPanelReminderEmail()`: two one-tap buttons, details, panellists; guests get "carry a government photo ID". Transactional (no unsubscribe footer). Admin: **Preview reminder** (as a guest), **Send "Are you coming?"** (only to people who have not answered), Stop / Resume, CSVs **Everyone's answers** and **Guests coming (for the college)**.

### "Are you coming?" answers
- Email buttons open `GET /panel-rsvp?a=&p=&r=&s=` (signature = HMAC of `panel-rsvp:<attendee>:<slug>:<answer>`), which shows a **self-submitting confirm page**; `POST /panel-rsvp` records. Mail scanners follow links but do not post forms, so they cannot answer for anyone. The result page links to change the answer. Answers close at `startsAt`.
- App: the panel card on My Profile shows the same two buttons (`panelComingBlock`, `POST /api/attendees/:id/panels/:slug/rsvp`).

### Attendance claim, certificate, creative
- The claim code lives in `app_settings` key `panel_claim_code:<slug>` (set by the import script's `--new-code`, never committed). The closing slide is drawn by `make-panel-claim-slide.py` (QR to `/app?panel=<slug>&claim=<code>`). 6 attempts per hour per registration. `checked_in_at` (WTC check-in) is never touched by a claim.
- After a claim: panel certificate (`generatePanelCertificate`) and the "I attended" creative (`panel_attended` variant).
- Before: the "I'm attending" panel creative; the conference creative is a second tab, shown only after the November yes.

### Runbook — the four steps for any panel
1. **Two days before, morning:** Admin → Overview → Campus panels → Preview reminder → Send "Are you coming?".
2. **The evening before:** download **Guests coming (for the college)** and send it to the host if they need names at the gate.
3. **On the day:** the moderator shows the closing slide (image kept outside the repo); claims open at `claimOpensAt`.
4. **`claimClosesAt`:** claims close; late claims come by email.

**What happened at DJ Sanghvi (21 Sep 2026):** 433 registrations (270 mUni, 158 LinkedIn, 5 from the page), all 433 confirmations sent, 426 asked "Are you coming?", 49 said yes and 15 said no, 51 signed in, 28 said yes to November. **Nobody claimed attendance and no certificate was issued**, and the claim window closed on 23 Sep. So the sending machinery works and the closing-slide step is the weak link. For JNU, have the code and the slide ready before the day; if DJ Sanghvi certificates are still wanted, push `claimClosesAt` out and mail the code to the list.

**Answers are stored as `yes` and `no`** in `panel_registrations.rsvp_status`, not `coming`. A query for `'coming'` returns zero and reads like nobody answered; that mistake was made on 24 Sep.

### Checklist — JNU (30 Sep 2026)
Done: seven panellists in `CAMPUS_PANELS`, the page and the home-page Pre-Event Speakers section, 127 LinkedIn leads prepared for import on 24 Sep.
Still to do: `hostLogo` (file in `public/images/campus/`); a claim code in `app_settings` (`panel_claim_code:jnu-30sep`) and the closing slide from `make-panel-claim-slide.py`; send confirmations after the import; send "Are you coming?" on 28 Sep.

---

## 6. Main-event consent (panel ≠ conference)
- `attendees.main_event`: 1 = conference registrant, 0 = panel only (or declined). Every `campus:` row started at 0; website/app registrants are 1.
- Asked in the panel email (yes/no deep links `?action=main-event-yes|no`) and by a card on My Profile (`mainEventCardHTML`, `answerMainEvent`, `POST /api/attendees/:id/main-event`). A "no" can be reversed.
- Until yes: no pass token (`/api/my-pass-token` 403 `main_event_consent`), badge desk shows red **NOT REGISTERED**, not in directory or suggestions, not counted, no conference creative. The app otherwise looks the same (sign-in, panel card, claim, panel certificate all work).

---

## 7. Free Visitor Pass directory teaser
- Full view: admin, any badge that `canInitiateNetworking()`, or role matching `DIRECTORY_FULL_ROLE` (speaker, exhibitor, organiser, jury, media, admin, staff).
- Free viewer: `TEASER_VISIBLE = 24` profiles ordered by `TEASER_QUALITY_SQL` (photo + senior title via `SENIOR_RANK_SQL` + company, students last), rotated daily (`((id * 7919 + istDay) % 1009)`), then `TEASER_LOCKED = 12` locked cards (`{locked, job_title, industry}`). Search or filters: `TEASER_SEARCH_VISIBLE = 3` then locked. Header `X-Directory-Limited: 1`; no paging, no counts.
- Visible rows are stripped by `teaserProfile()` (no LinkedIn/Twitter/website, bio cut to one line) and carry `view_token` (24 hex, HMAC of `view:<viewer>:<target>:<istDay>`, valid today or yesterday IST).
- `GET /api/attendees/:id` for a free viewer: full if self, exhibitor/speaker/organiser role, published speaker, or any connection/message/meeting between the two (`directoryAlwaysVisible`); stripped with a valid token; otherwise `403 {locked:true}` — unknown ids answer identically.
- Suggestions for free viewers: 8, stripped, with tokens. Client: locked cards say **See who this is** → `showUpgradeModal('directory')`.

---

## 8. Email: brand, unsubscribe, suppression
- Every attendee mail uses `emailBrandHeader()` (logo, tricolour wordmark, Hindi line).
- Campaign mail (`sendAdminEmail` default, notify, thank-you) carries a footer link and a `List-Unsubscribe` header to `GET /unsubscribe?e=&t=` (HMAC of `unsubscribe:<email>`), which sets `unsubscribed_at`.
- `suppressionClause()` = `unsubscribed_at IS NULL AND (marketing_consent IS NULL OR marketing_consent = 1)`, applied to: campaigns-table audiences, profile-reminder pump and its counter, notify-all, RSVP-chase, thank-you list, non-urgent broadcasts. Urgent broadcasts (hall change, closure) reach every pass holder. Transactional mail (sign-in, panel confirmation, "Are you coming?") is not suppressed.
- Conference RSVP links are signed (`rsvpSig`, HMAC of `rsvp:<event>:<email>:<status>`); the route answers identically for known, unknown and forged addresses.

---

## 9. Security and reliability (17 Sep 2026)
- **XSS:** attendee-supplied text is escaped everywhere it is rendered in the app and admin (`esc`, `escH`); profile links pass `safeUrl()`; announcement title/content/author escaped; card buttons use `data-act` attributes with one delegated handler.
- `GET /api/attendees/:id/exhibitor` requires the owner's session (was open).
- `POST /api/messages`: Visitor may only reply (existing thread started by the other person, or accepted connection); 4,000 characters; 20 per minute. `POST /api/meetings`: Visitor refused.
- `PUT /api/attendees/:id/profile` is patch-only (writes only keys sent) with length limits; the arrival prompt sends only `arrival_time`.
- Elastic Email key: `elasticKey()` reads the Worker secret `ELASTIC_EMAIL_API_KEY` first, then `app_settings`. `GET /api/admin/settings` masks secrets; `PUT` ignores masked echoes, validates key names and is audited.
- Finance staff are refused `/api/staff/lookup`.
- `app.onError` logs unhandled errors and returns JSON on `/api/*`; `GET /health` checks D1 (`SELECT 1`).
- Security headers (`nosniff`, `Referrer-Policy`, `X-Frame-Options: SAMEORIGIN`) from middleware and `public/_headers`. No CSP yet (needs a report-only phase).
- Announcements `LIMIT 20` + 30 s edge cache; `/api/events/:id/stats` 60 s cache except for admin; image proxy 8 s timeout, 3 MB cap.
- Service worker caches only successful public reads (sessions, announcements, speakers, exhibitors, the event); never attendee, message, connection, meeting or pass-token paths. `POST /api/attendees/logout` expires the cookie; sign-out clears data caches.
- `backup-*.sql` is gitignored.

## 10. Admin and badge desk (17 Sep 2026)
- `POST /api/admin/attendees/:id/checkin-reset` (audited) + row action.
- Desk: `POST /api/desk/walkin` (registers a Visitor walk-in, source `walkin`) and `POST /api/desk/reissue` (pass token by id / email / exact name), both gated on `deskActor()`; forms on `/staff/scan`.
- `GET /api/admin/checkin-stats` adds 15-minute arrival buckets (IST) and a per-desk tally; `GET /api/admin/events/:id/attendees/not-arrived.csv`.
- `payment_status` editable (pending | paid | refunded | waived; admin-created rows default `paid`), audited old → new.
- Audit on single attendee create/update/delete, CSV import, staff create/update, invoice create, exhibitor/session/announcement CRUD, inquiry delete (`changedFields()` for before/after).
- Staff list shows role and email; creating an `admin` account requires a signed-in admin session (`adminAccountSession`), not the shared password.
- Invoice numbers: `inv_next_number` is the next number, advanced in the same `DB.batch()` as the insert, one retry, friendly 409.
- One `BADGE_TYPES` list for every pass dropdown; bulk writes chunked at 90 ids (D1 parameter cap); CSV export via `fetch` + Blob (no secret in URLs).

## 11. Attendee app (17 Sep 2026)
- Inbox **Messages** tab (`GET /api/attendees/:id/threads`); open chat refreshes every 6 s.
- Failed writes surface via `apiFailed()`; timestamps via `parseDbTime()` (UTC stamps) and `parseVenueTime()` (session wall clock, IST); Upcoming Sessions really upcoming.
- Notification bell and sheet on phones; Back button inside the app (`history.pushState`); Escape closes the top modal; polling backs off when hidden.
- Booth visit asks before sharing contact details and is deduplicated.
- Directory chips for industry, city and "here to" goal.

## 12. Phones first: sharing and saving
- Helpers in `mainPageHTML()`: `isTouchPhone`, `dataUrlToFile`, `canShareFile`, `copyText`, `showImageToSave`, `deliverImage`.
- Creative: the PNG `File` is built when the card is drawn (`socialCard.file`) so the share sheet opens inside the tap; the caption is copied as it opens (LinkedIn drops shared text). Without file sharing (LinkedIn/Instagram in-app browsers): full-screen picture to press and hold, **Copy the caption**, **Open WhatsApp with the caption**. The Download button reads **Save picture** on phones.
- Conference certificate, panel certificate and the event pass use `deliverImage()` on phones (pass-render.js hands off when `window.deliverImage` exists; the admin page keeps a plain download).
- Photo upload already offers **Take a photo** (`capture="user"`) and **Choose a photo** and resizes client-side.

---

## 13. Open items (reviewed 17 Sep, not done)
- Cloudflare WAF rate-limit rules on registration, inquiries and booth requests (dashboard, not code).
- **`MP_SESSION_SECRET` is not set in production** (checked 24 Sep), so marketplace exhibitor sessions and sign-in links are signed with `ADMIN_SECRET`. Set it with `npx wrangler pages secret put MP_SESSION_SECRET --project-name bharatai-networking`. Setting it invalidates exhibitor cookies and any outstanding sign-in link, so do it before a batch of links goes out, not after.
- Move the Elastic Email key to a Worker secret (`npx wrangler pages secret put ELASTIC_EMAIL_API_KEY --project-name bharatai-networking`), then blank the `app_settings` row.
- Badge desk offline mode; in-page QR scanning on iPhones (no `BarcodeDetector`).
- Generate the pass QR locally instead of `api.qrserver.com` (a failure renders a pass without a QR).
- A return path from mUni Campus payments; invoice credit notes, search and GST export.
- Speaker admin UI; session capacity/attendance; soft delete instead of orphaning invoices/connections.
- A scheduled campaign sender (cron) so bulk sends do not depend on an open tab.
- Content-Security-Policy; revocable sessions (cookies are stateless for 60 days).
- Notification centre covers only announcements; no session feedback, reminders, calendar export, QR-to-connect or Web Push.
- Contrast of `text-gray-500/600` tokens; third-party avatar and favicon lookups; static Workshops tab.
- `src/index.tsx` is one ~34,000-line file with no unit tests beyond `scripts/verify/`.

## 14. Change log

**19–23 Sep 2026 (another session):** `815f518` `4eca44c` the 21 Sep creative · `5cc5f35` Nida Parkar off the DJ Sanghvi panel · `3ec52b3` `73a0290` `0796f22` site portraits · `900d201` a November speaker · `c9ffe7b` booth Innovation Talk slots · `7851712` the JNU seven-panellist line-up · `e538b57` the panel suites pick a panel that has not started · `12d9b3d` `70511f7` Pre-Event Speakers on the home and conference pages.

**24 Sep 2026:** JNU LinkedIn import (127 leads from the second form), the import script reads either delimiter and takes `--exclude-file`, and `scripts/verify/check-import-sql.py` proves a generated import before it is run.

**17 Sep 2026**
Campus: `cfb33f8` panel import, claim, card, certificate · `e8d43cf` panellist headshots · `a228a6b` branded panel email, Stop/Preview/Resume · `78f316e` panel ≠ conference consent · `003d30b` conference card waits for yes · `99f27ed` campus form fixed · `73e8b03` "Are you coming?".
Data separation and directory: `bf8dabc` conference-only numbers · `33ad421` free-pass directory teaser.
Security, admin, app: `24dd57a` backups ignored · `75c7846` (contains the security batch, committed under a site message) · `2b14a71` icon font · `7d473b7` admin/ops merge · `d88d3f3` attendee app merge · `dda6efc` suppression wired · `801223e` static-page script check · `cea6af9` phones first.
Site copy (another session): `458ccb9`, `b387e71`, `1fab289`, `9b0dda7`, `861218b`, `176c488`, `52de7b9`.
