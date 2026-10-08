# Bharat AI Innovation platform — handbook

Last updated **4 October 2026**. Read this before changing `src/index.tsx`, the campus pages, anything that emails attendees, or anything that takes money (§15). It records what exists, why, and how to verify it, so the next session does not have to rediscover it.

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
| Checkout (CCAvenue) | `src/lib/ccavenue.ts` (the wire format, nothing else) and the `ONLINE PAYMENTS` block in `src/index.tsx`; table `payment_orders` (0045). See §15 |
| Build guards | `scripts/check-inline-js.mjs`, `scripts/check-no-counts.mjs` (run by `npm run build`) |
| Campus tooling | `scripts/import-muni-panel.py`, `scripts/import-linkedin-panel.py`, `scripts/make-panel-claim-slide.py` |
| Panel email scheduler | `cron/` (a one-file Worker, `bharatai-mail-cron`, every minute → `POST /api/cron/tick`); the `PANEL MAIL JOBS` block in `src/index.tsx`; jobs are `mail_job:<kind>:<slug>` rows in `app_settings`. See §17 |
| Campus Series insights reports | PDFs in `public/reports/` (served only by `GET /reports/:file` with a signed link), page `public/insights.html`, the `CAMPUS SERIES INSIGHTS REPORTS` block in `src/index.tsx` (`INSIGHTS_REPORTS`, `sendReportsEmail`, the admin pump), table `report_downloads` (0047). See §16 |
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

**Migrations applied to production (0040–0043 confirmed 17 Sep 2026, 0044 applied 24 Sep):**

| Migration | Adds |
|---|---|
| 0040_panel_registrations | `panel_registrations` (one row per person per panel: source, confirmation, claim, certificate, card) |
| 0041_main_event_consent | `attendees.main_event` (1 = conference registrant, 0 = panel only / declined), `main_event_answered_at` |
| 0042_consent_and_hot_indexes | `attendees.marketing_consent`, `attendees.unsubscribed_at`, indexes on `(event_id, name, id)`, `unsubscribed_at`, `messages(receiver_id, is_read)` |
| 0043_panel_rsvp | `panel_registrations.rsvp_status`, `rsvp_at`, `reminder_sent_at`, `reminder_error` |
| 0044_exhibitor_stage_talks | `innovation_talks.exhibitor_id`, `speaker_title`, `speaker_bio`, `speaker_photo_url`, `showcase`, `duration_min`, `starts_at`, `details_updated_at`, and `idx_innovation_talks_exhibitor` (one talk per exhibitor). **Do not run it again**: `ADD COLUMN` is not idempotent, so a second run errors at its first line. Backup taken just before: `backup-pre-0044-2026-09-24.sql` |

| 0045_payment_orders | `payment_orders`, one row per attempt sent to the payment gateway. Applied 4 Oct 2026 (backup `backup-pre-0045-2026-10-04.sql`). `IF NOT EXISTS` throughout, so it is safe to run twice, and it was |
| 0046_checkout_leads | `checkout_leads`: what the paid form was given by people who closed it before Proceed, and the "finish paying" reminder record for everyone. Applied 4 Oct 2026 (backup `backup-pre-0046-2026-10-04.sql`), and a live capture checked straight after. `IF NOT EXISTS` throughout |
| 0047_report_downloads | `report_downloads`: who has the Campus Series insights reports (asked on `/insights`, or mailed from the admin Campus panels block), the "your reports" email record and the opens. Applied 8 Oct 2026 with `d1 execute --file` (not recorded in `d1_migrations`). `IF NOT EXISTS` throughout. See §16 |
| 0048_report_events | `report_events`: one row per act, a report opened or a recording started, with the person when known. **Not yet applied** (written 8 Oct 2026): until it runs, opens are still counted on `report_downloads` and plays are not recorded; the admin block hides the watch numbers. `IF NOT EXISTS` throughout. See §16 |

**`npx wrangler d1 migrations apply bharatai-production --remote` does not work on production any more** (found 8 Oct 2026). Wrangler's ledger, the `d1_migrations` table, stops at `0043_panel_rsvp.sql`: 0044, 0045 and 0046 were applied with `d1 execute --file` and never recorded, so `migrations apply` tries 0044 again and fails on its first `ADD COLUMN` (`duplicate column name: exhibitor_id`), and nothing after it runs. Apply a new migration directly, `npx wrangler d1 execute bharatai-production --remote --file=./migrations/<file>.sql`, and then record it, `npx wrangler d1 execute bharatai-production --remote --command "INSERT OR IGNORE INTO d1_migrations (name) VALUES ('<file>.sql')"`. Recording 0044 to 0047 the same way makes `migrations apply` usable again.

The "no such column" fallback in `GET /api/events/:id/innovation-talks` stays even though 0044 is applied: it is what keeps a database that is a migration behind (a fresh copy, a half-run file) answering instead of failing.

**One-off SQL that writes to production is attacked before it is run**, against a scratch database shaped like the real one, twice, with the awkward rows seeded: `scripts/verify/check-import-sql.py` for a generated panel import, `scripts/verify/check-speaker-sql.py` for the speaker passes. Two real defects were caught that way on 24 Sep, neither visible on a reading. An `INSERT ... SELECT` without `OR IGNORE` aborts **the whole statement** when two source rows carry the same email, so one shared address means nobody gets a pass and the rest of the file never runs. An `UPDATE ... WHERE email IN (SELECT ...)` that does not constrain `event_id` reaches across events. Seed the duplicate address, the mixed case, the already-paid row and a second event, then run the file twice.

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
| `smoke-payments.mjs` (159) | Checkout on this site: the switch, our price on the order, the request decrypting with CCAvenue's kit algorithm, every answer that must not be believed, a paid order being final, the admin and finance queues, the "what is it waiting for" readout, no trace of a mUni Campus link, and the follow-up: forms kept, the list, every reason not to remind, the three reminder emails and their links (email service played by the test) |
| `pay-test.cjs` via `pay-harness.mjs` (54) | Buying a pass on a phone in a real browser: /register to the gateway (played by the test) to the result page to the app signed in, "Pay now" for a pending pass, cancel and retry, being told so when checkout is off, the invoice form on /admin and /finance, and stopping part-way three ways, a bulk reminder from Admin, and each person coming back through their own link and paying |
| `check-payment-sql.py` (34, run by hand) | Migrations 0045 and 0046 and every payment and follow-up statement the worker sends, on a real SQLite engine. Usage is in its header |
| `prod-sweep.mjs` (33) | Production pages, headers, guards, caches, new routes |
| `live-phone-check.cjs` (8) | Production on a phone: new functions present, no JS errors, forged link refused, campus forms (POST intercepted) |

Any session may register a suite in `run-all.mjs`, so the total moves on its own: 153 on 17 Sep, then 193 and 192 within one morning on 24 Sep. The per-suite counts above are a rough guide, not a contract. Run the command and read what it prints rather than trusting a number written anywhere, including here.

Playwright comes from `scripts/verify/playwright.cjs` (local `playwright-core`, `$PLAYWRIGHT_CORE`, or the copy inside the global Playwright MCP install) and launches system Edge — no browser download needed.

**Two suites cannot run when no campus panel is ahead of today.** `smoke-panel-answers.mjs` and `phone-test.cjs` pick a panel that has not started, and stop with "every campus panel in CAMPUS_PANELS has already started" when there is none (the case since 30 Sep 2026). They show as `FAIL (0 passed)` in `npm run verify`; that is the missing panel, not a regression. They run again once a future panel is added to `CAMPUS_PANELS`.

**Run the suite on its own.** The browser suites drive real Edge windows, and a second heavy job beside them (another Playwright run, a build, a big node script) makes `page.goto` time out after 30 s. That shows up as a suite with **0 passed** and `crashed: page.goto: Timeout`, which reads like a regression and is not one. Seen 24 Sep. Re-run it alone before believing it.

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
| **The insights reports email goes to every panel registrant who has not unsubscribed**, including those who said no to marketing on the LinkedIn form (77 at DJ Sanghvi, 96 at JNU): it is the follow-up of the panel they registered for. For them the November ask is left out of the email. Someone who unsubscribes is never mailed | 8 Oct | `unsubscribedClause()`, `noMarketing` in `sendReportsEmail()` |
| Attendance at other colleges is **claimed** with a closing-slide code, never taken at a desk | 17 Sep | `/api/attendees/:id/panels/:slug/claim` |
| No government backing claims anywhere | 17 Sep | site copy (see memory `no-meity-backing-claims`) |
| Pass prices are **+ GST**; Innovation Talks are 8 minutes; the evening is "Bharat AI CXO Innovation Night" | 17 Sep | site copy, app copy, D1 `sessions` rows |
| **Every pass includes an AI Marketplace listing** (organiser's model: Exhibitor = delegate + stage talk + listing; Delegate = networking app + listing; Visitor = visitor pass + listing; VIP = delegate + networking + listing + VIP lounge). Signed in to the app = signed in to the marketplace, but an app session never opens a marketplace account made any other way: the inbox gets a sign-in link instead | 24 Sep | `POST /api/mp/auth/from-app`, `sessionAttendee()`, `signInFromApp()` in marketplace-app.js; pass cards in `mainPageHTML` |
| **Every exhibitor is also a delegate** (badge Exhibitor, payment waived, `main_event` 1, lunch Yes; a Visitor Pass on the booth email is raised) and gets an **Innovation Talk & Showcase slot** of the package length (Pod 8 … Mega 40; Premium unknown). The exhibitor writes topic, showcase, speaker, photo and bio in the marketplace dashboard; the organisers set day and time in Marketplace admin → Stage Talks; the talk joins the app programme once it has a time, a topic and a speaker | 24 Sep | `ensureExhibitorDelegate()`, `STAGE_MINUTES` and `/api/mp/dashboard/stage-talk` + `/api/mp/admin/stage-talks` in routes/marketplace.ts, migration 0044, `GET /api/events/:id/innovation-talks` |
| A pre-made (password-less) marketplace account is never claimed by "Create account": the inbox is emailed a sign-in link. Exhibitors-tab "Signed in" = used a link or set a password | 24 Sep | `POST /api/mp/auth/register`, audit action `marketplace.signed-in` |
| **Speaker = delegate + speaker + networking app** (organiser, 24 Sep, reversing 14 Sep): every published speaker with an email gets a Speaker pass (payment waived, conference registrant). **Never ministers**, nor the two officials hidden from the Network tab. Speakers had no emails on 24 Sep; the organiser sends them later, then add them (`UPDATE speakers SET email = … WHERE slug = …`) and run the script, which is safe to re-run | 24 Sep | `scripts/sql/speaker-delegate-passes.sql` (organiser runs it) |
| **A paid pass that is not paid for is not a paid pass.** Choosing Delegate, VIP or Academic on a form records the choice (`payment_status = 'pending'`); until the payment lands it works like a Visitor Pass (directory teaser, reply only, no meetings, no pass), and nobody is told "you are registered": the welcome goes out with the receipt. Before this an unpaid Delegate had full networking, and the welcome said "Your registration is confirmed" to people who never paid (organiser spotted it on their own test, 4 Oct) | 4 Oct | `unpaidPaidPass()` in `directoryViewer`, `POST /api/connections`, `/api/messages`, `/api/meetings`, `/api/my-pass-token`; `passAwaitingPayment()` in the app; the register route skips `sendRegistrationEmail` for an unpaid paid tier and `sendPaymentEmails` sends it with the receipt |
| **CCAvenue, on this site, is the only way to buy a pass.** Nobody is sent to mUni Campus to pay any more; if checkout is off the buyer is told so and nothing else happens | 4 Oct | `startOnlinePayment()` in both paid forms, `onlinePaymentsOn()`; `smoke-payments.mjs` and `pay-test.cjs` fail if a `municampus.com` link comes back |
| Exhibitor and speaker passes **count as conference registrants and get lunch**, like any delegate (organiser said yes, 24 Sep, after being told it moves the count sponsors see and the lunch-pack count) | 24 Sep | `ensureExhibitorDelegate()`, the speaker script |

---

## 5. Campus Series panels

### Configuration
`CAMPUS_PANELS` in `src/index.tsx` (search `const CAMPUS_PANELS`). Each panel: `slug`, `title`, `titleShort`, `subtitle`, `host`, `hostShort`, `city`, `dateLabel`, `dateShort`, `timeLabel`, `venue`, `pageUrl`, `startsAt`/`endsAt`, `claimOpensAt`/`claimClosesAt` (ISO with `+05:30`), `hostLogo`, `speakers`, `hashtags`, `hostLike` (lower-case fragments of the host's name/email domain that mark a registrant as the host's own student; everyone else is a guest).

Live panels: `djsanghvi-21sep` (DJ Sanghvi, Mon 21 Sep 2026, 11:00–12:30 IST, claims closed 23:59 on 23 Sep) and `jnu-30sep` (JNU, Wed 30 Sep 2026, 15:00–16:30 IST, claims 16:00 30 Sep → 23:59 2 Oct; seven panellists set on 23 Sep, `hostLogo` and claim code still empty).

### Registrations
Every panel registrant is an `attendees` row tagged `registration_source = 'campus:<slug>'` (unless they registered for the conference first, which keeps their source) plus a `panel_registrations` row with `source` = `page` | `muni` | `linkedin`.

- **Panel page form** (`campus-*.html`) posts to `/api/events/1/attendees/register` with the campus tag → panel row + `main_event = 0`.
  - **Panel registrants are mostly working professionals, not the host's students** (26 Sep: 162 of 166 JNU registrants had job titles like Founder, CTO, Manager; 2 gave JNU as their organisation). So `campus-jnu.html` asks **"I am"**: working professional / student / faculty. That choice renames the last two fields (Organisation + Job title, College + Course & year, Institution + Designation), fills in the host only for students and faculty, and shows an **Industry** list only to professionals. The register endpoint refuses a new row without an industry (`missingRegistrationFields`); students and faculty send Education & Academia. The page's list is the server's `INDUSTRIES`, so keep the two in step. Copy the form from this page for the next panel page.
  - **Someone already registered who uses a panel page** (a conference registrant, a DJ Sanghvi registrant) is put on that panel's list: panel row only, no change to their profile, pass or `main_event`, and no email; the admin **Send confirmations** pump picks them up. Before 26 Sep the page told them "you are set for this panel" and the server dropped them. Checked in `smoke-panel-answers.mjs`.
- **mUni Campus export (.xls):** `python scripts/import-muni-panel.py --xls "<file>" --panel <slug> --out import.sql [--new-code]`. mUni's .xls breaks xlrd's directory parser; the script reads the raw Workbook stream with `olefile`.
- **LinkedIn Lead Gen export:** `python scripts/import-linkedin-panel.py --file "<export>" --panel <slug> --out import-linkedin.sql` → also writes `import-linkedin.consent.sql` (apply after 0042). The form's marketing question is recorded in `marketing_consent`.
  - **Two live forms carry the same name.** "Registration form for Pre-Event of Bharat AI Innovation" exists twice: form `7503394077217042432` (imported to DJ Sanghvi on 17 Sep) and form `7503370180731846656` (imported to JNU on 24 Sep). Two downloads with the same file name can be different audiences, so read the `form_id` the script prints, not the file name.
  - The delimiter varies: LinkedIn's own download is comma-separated UTF-8, and a file that has been through Excel is tab-separated Windows-1252 with `event_id` mangled into `7.50339E+18`. The script sniffs the header, so pass the file as it came.
  - `--exclude-file <earlier export>` (repeatable) skips leads already imported, which is how to import only what a newer download added.
- Both scripts are `INSERT OR IGNORE` on email and safe to re-run on a fresh export. The organiser runs the SQL files.
- **Check any generated file before it is run:** `python scripts/verify/check-import-sql.py <import.sql>` applies it to a scratch database shaped like production, twice, and proves that each lead gets one attendee row and one panel row, that a person already in the database keeps their details and conference place, that nobody lands in the conference count, and that a second run changes nothing.

### Emails
- **Confirmation** — `sendPanelConfirmationEmail()`: brand header (`emailBrandHeader`), host logo band, topic/date/time/venue/panellists, a 7-day, 5-use sign-in link that lands on the creative, and "Would you like to come to the main conference too?" with yes/no deep links. Admin → Overview → Campus panels: **Preview email**, **Send confirmations** (pumped 5 at a time, **Stop** parks the rest server-side, **Resume** un-parks only paused rows).
- **Since 8 Oct the run is a job on the server (§17)**: Send writes it, the scheduler Worker and any open admin page tick it, and closing the laptop does not stop it once the Worker is deployed. What follows describes the pace, which is unchanged.
- **Pace (24 Sep):** both sends go out **one email at a time**, with the gap chosen in the control beside the button (`paceControl`, `panelGapSeconds`; the job's `gap`). One minute is the default since 29 Sep and the choice is remembered in that browser. The run lives in the tab: the Overview redraws the block every 60 s, and the redraw shows Stop and the last progress line while a run is going, so a second press starts nothing. The wait works to a clock deadline, because a background tab's timers are slowed to about one tick a minute and a tick count would stretch the gap. `scripts/verify/pace-test.cjs` covers all of this. A burst of identical mail to the same few domains is what puts a sender in the spam folder. The progress line counts down and gives the finishing time; 129 emails at two minutes takes about four and a half hours and the tab has to stay open. Stop parks the rest on the server, Resume continues, and nobody is mailed twice.
- **"Are you coming?" reminder** — `sendPanelReminderEmail()`: two one-tap buttons, details, panellists; guests get "carry a government photo ID". Transactional (no unsubscribe footer). Admin: **Preview reminder** (as a guest), **Send "Are you coming?"** (only to people who have not answered), Stop / Resume, CSVs **Everyone's answers** and **Guests coming (for the college)**.

### Every number opens its list (29 Sep)
On Admin, Overview, Campus panels, each non-zero number is a button that opens the people behind it, with a CSV. `GET /api/admin/panels/:slug/people?metric=<key>` serves them from `PANEL_PEOPLE_METRICS`, whose nineteen conditions are copies of the ones `GET /api/admin/panels` counts with. **Change a count, change its list in the same commit**, then run `node scripts/verify/check-panel-drilldown.mjs` (after `npm run build` and a one-off `npm i --no-save sql.js`), which compares every list with its number on a real SQLite engine.

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
- **`MP_SESSION_SECRET` is set in production** (24 Sep, before any exhibitor sign-in link went out; the redeploy that attached it is `0646ece`). Marketplace sessions and sign-in links are signed with it, no longer with `ADMIN_SECRET`. Changing it again signs every exhibitor out and voids every sign-in link already emailed, so do not rotate it casually; a secret only reaches deployments made after it is set.
- Move the Elastic Email key to a Worker secret (`npx wrangler pages secret put ELASTIC_EMAIL_API_KEY --project-name bharatai-networking`), then blank the `app_settings` row.
- Badge desk offline mode; in-page QR scanning on iPhones (no `BarcodeDetector`).
- Generate the pass QR locally instead of `api.qrserver.com` (a failure renders a pass without a QR).
- Checkout on this site (§15) is the only way to pay since 4 Oct 2026. Still open: refunds are made in the CCAvenue dashboard and then marked `refunded` here by hand; booth and sponsorship payments are not on the gateway; a payment whose buyer never comes back to the site (closed tab, dead battery) stays pending until someone confirms it from the CCAvenue report, because their status API wants a fixed server IP that Workers do not have.
- Invoice credit notes, search and GST export.
- Speaker admin UI; session capacity/attendance; soft delete instead of orphaning invoices/connections.
- ~~A scheduled campaign sender (cron) so bulk sends do not depend on an open tab.~~ Done for the three panel emails on 8 Oct (§17). The profile-reminder campaign (`pumpProfileReminder`) and the upgrade campaign are still driven from the tab.
- Content-Security-Policy; revocable sessions (cookies are stateless for 60 days).
- Notification centre covers only announcements; no session feedback, reminders, calendar export, QR-to-connect or Web Push.
- Contrast of `text-gray-500/600` tokens; third-party avatar and favicon lookups; static Workshops tab.
- `src/index.tsx` is one ~34,000-line file with no unit tests beyond `scripts/verify/`.

## 14. Change log

**8 Oct 2026 (evening):** panel email as server jobs (§17): Send writes `mail_job:<kind>:<slug>`, `POST /api/cron/tick` and the admin page's own tick send what is due with a compare-and-swap claim, Stop and Resume on the job, five failures in a row stop it, the scheduler Worker in `cron/` (deployed by the organiser), the page says whether the scheduler is alive. The three tab pumps are gone. `smoke-mail-jobs.mjs` (66 checks), `pace-test.cjs` rewritten, four production checks.

**8 Oct 2026 (afternoon):** the reports email reaches panel registrants who said no to marketing (without the November ask; unsubscribes still left out), and tracking of who opened which report and who watched which recording: `/r/` and `/w/` link pages, `public/js/watch-track.js` on the four pages with players, `POST /api/reports/watch`, the people lists on the admin block, migration 0048 (not yet applied). `smoke-reports.mjs` now 105 checks.

**8 Oct 2026:** the Campus Series insights reports (§16): two PDFs behind a signed link, `/insights` with a contact form that hands out both links and emails them, the "your reports" email with a paced admin pump per panel, the two recordings embedded on `/insights`, `/campus-series`, `/campus-djsanghvi` and `/campus-jnu`, migration 0047 (not yet applied), `scripts/verify/smoke-reports.mjs`, and seven more production checks in `prod-sweep.mjs`.

**4 Oct 2026:** checkout on this site through the event's own CCAvenue account (§15): `src/lib/ccavenue.ts`, the `ONLINE PAYMENTS` block, migration 0045, "Pay now" on the app's pass card, "Paid online: invoice to raise" on /admin Payments and /finance, and three new checks (`smoke-payments.mjs`, `pay-test.cjs`, `check-payment-sql.py`). The same day the organiser made it the **only** gateway: every mUni Campus checkout path was removed, the secrets were set, 0045 was applied, and Admin → Payments gained a readout of what checkout is waiting for. Found on the way and **not** fixed: `python scripts/build-fa-subset.py --check` fails on `fa-unlock` (the "See who this is" button on locked directory cards draws no icon); the subset needs rebuilding and `FA_CSS` / `sw.js` bumping with it.

**28 Sep 2026:** `/contact` shows the organiser's office address (Kukreja Centre, 11th Floor, B Wing, Plot 13, Sector 11, CBD Belapur, Navi Mumbai 400614) in an "Our office" card beside an "Event venue" card, each with a maps link; the venue chip left the quick-info bar. `contactPageHTML()` only.

**19–23 Sep 2026 (another session):** `815f518` `4eca44c` the 21 Sep creative · `5cc5f35` Nida Parkar off the DJ Sanghvi panel · `3ec52b3` `73a0290` `0796f22` site portraits · `900d201` a November speaker · `c9ffe7b` booth Innovation Talk slots · `7851712` the JNU seven-panellist line-up · `e538b57` the panel suites pick a panel that has not started · `12d9b3d` `70511f7` Pre-Event Speakers on the home and conference pages.

**24 Sep 2026:** JNU LinkedIn import (127 leads from the second form), the import script reads either delimiter and takes `--exclude-file`, and `scripts/verify/check-import-sql.py` proves a generated import before it is run.

**17 Sep 2026**
Campus: `cfb33f8` panel import, claim, card, certificate · `e8d43cf` panellist headshots · `a228a6b` branded panel email, Stop/Preview/Resume · `78f316e` panel ≠ conference consent · `003d30b` conference card waits for yes · `99f27ed` campus form fixed · `73e8b03` "Are you coming?".
Data separation and directory: `bf8dabc` conference-only numbers · `33ad421` free-pass directory teaser.
Security, admin, app: `24dd57a` backups ignored · `75c7846` (contains the security batch, committed under a site message) · `2b14a71` icon font · `7d473b7` admin/ops merge · `d88d3f3` attendee app merge · `dda6efc` suppression wired · `801223e` static-page script check · `cea6af9` phones first.
Site copy (another session): `458ccb9`, `b387e71`, `1fab289`, `9b0dda7`, `861218b`, `176c488`, `52de7b9`.

---

## 15. Online payments (CCAvenue), built 4 Oct 2026

Until now a paid pass was bought on mUni Campus (their CCAvenue account) and nothing came back: a Delegate stayed `pending` until somebody found the payment in a report and raised the invoice. The event now has its own CCAvenue merchant account, so checkout starts on this site and the answer lands on it.

### How it works
1. The paid form (on `/register` and in the app) saves the registration as before, then calls `POST /api/payments/ccavenue/start`. That writes a `payment_orders` row at **our** price and returns a signed link.
2. `/pay/ccavenue/<link>` encrypts the request and posts the buyer to CCAvenue in the same tab (no popup, so nothing for a phone's popup blocker to swallow).
3. CCAvenue posts the buyer back to `/pay/ccavenue/return` for a payment and a cancellation alike. A believed "Success" marks the order `paid`, sets the badge to the pass bought, `payment_status = 'paid'`, `payment_amount`, and `main_event = 1`, writes `payment.received` to the audit log, emails the buyer and emails the team. The buyer's email is the welcome ("Payment received", photo, profile, pass) with the receipt and the GST-invoice note in it; nobody who chose a paid pass is sent a welcome before this.
4. `/pay/result` tells the buyer what happened. A failed or cancelled payment offers **Try again**; a pending pass shows **Pay now** on the app's pass card.
5. The GST invoice is **not** raised automatically. The paid order appears under **Paid online: invoice to raise** on /admin Payments and on /finance, with the order number, the CCAvenue reference and the amount filled in. Raising the invoice is what takes it off that list (matched on `invoices.order_ref`).

### It is the only gateway, and it needs three things to be on
The organiser decided on 4 Oct 2026 that CCAvenue is the only way to pay. The mUni Campus checkout link, the second tab it opened and the "pass upgrade" enquiry that went with it are gone from both forms.

`GET /api/payments/config` answers `{"gateway":"ccavenue"}` when the three Worker secrets are set, migration 0045 has run, and `app_settings.payment_gateway` is not `off`. Otherwise it answers `off`: the form still saves the buyer's details, then tells them online payment is not available just now. **Admin → Payments shows which piece is missing** (one line per condition: ok, missing, or "set, but not the usual shape"; never a value).

What went wrong on go-live day, so it is recognised next time: all three names were in `secret list`, the table existed, the site was redeployed, and it still answered off. The terminal showed the first `secret put` confirmed as `Enter a secret value: ...` with **no asterisks** after it, where the next one showed eighteen, so the likely cause is a merchant ID saved empty (nobody can read a secret back to be sure). An empty secret counts as missing, and its name is listed all the same. Setting all three again fixed it. Piping the value in avoids it: `printf '%s' 'VALUE' | npx wrangler pages secret put NAME --project-name bharatai-networking`.

CCAvenue issues one access code and one working key **per registered URL**. The pair in use is the row for `https://bharataiinnovation.com/`; a code from one row with a key from another fails every request (their error 10002).

**Setting it up from nothing, in this order (done on 4 Oct 2026):**
```
# 1. The three values are on the CCAvenue dashboard: Settings, API Keys, for the
#    website URL https://bharataiinnovation.com. Each command asks for the value.
npx wrangler pages secret put CCAVENUE_MERCHANT_ID  --project-name bharatai-networking
npx wrangler pages secret put CCAVENUE_ACCESS_CODE  --project-name bharatai-networking
npx wrangler pages secret put CCAVENUE_WORKING_KEY  --project-name bharatai-networking

# 2. Backup, then the table.
npx wrangler d1 export bharatai-production --remote --output=backup-pre-0045-2026-10-04.sql
npx wrangler d1 execute bharatai-production --remote --file=migrations/0045_payment_orders.sql

# 3. A secret only reaches deployments made after it is set: redeploy
#    (push a commit, or "Retry deployment" in the Cloudflare dashboard).

# 4. Check, then buy one Academic Pass (Rs 1,178.82) with your own card and
#    refund it from the CCAvenue dashboard.
curl https://bharataiinnovation.com/api/payments/config
```
**To switch it off without a deploy** (buyers are told online payment is not available; a payment already at the gateway is still accepted when it comes back):
```
npx wrangler d1 execute bharatai-production --remote --command "INSERT INTO app_settings (key, value, updated_at) VALUES ('payment_gateway', 'off', datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
```
Set the value to `on` to switch it back. (The older value `muni` still means off; it no longer sends anyone anywhere.) `CCAVENUE_ENV=test` (a fourth, optional secret) sends checkout to `test.ccavenue.com`; it needs the sandbox's own keys.

### Rules that hold
- **The price is decided on the server.** `PASS_PRICES_INR` (whole rupees before GST) plus `PASS_GST_RATE` is the one figure the gateway is asked for and the one the payments queue calls "expected". The prices printed on the forms, the upgrade modal and the welcome email are still hand-written copies: change them together.
- **The gateway's answer travels through the buyer's browser, so it is checked, not trusted.** It must decrypt to clean text, name an order of ours, carry the signature sent with that order (`merchant_param1`, an HMAC of order and amount), and report the same amount in INR. "Success" for another amount sets the order to `mismatch`, unlocks nothing, and emails the team. Every answer that cannot be believed gets the same reply (`303 /pay/result`), whatever was wrong with it. Do not add a more helpful error there: a different reply for bad padding is a padding oracle.
- **A paid order is final.** The `UPDATE` carries `AND status <> 'paid'`, and only the request that changed the row unlocks the pass and sends mail, so a refresh or a second tab does nothing.
- **Who may pay:** a free pass (any paid tier), or a paid tier that is `pending` or `refunded`. A confirmed paid pass, and every pass the organisers hand out (Speaker, Exhibitor, Media and so on), is refused with a sentence. If the badge was set by hand between the order and the payment, the payment is recorded and the badge left alone; the team email says so.
- Ten orders per person per hour. A checkout link is good for one attempt, for an hour.
- The working key is only ever a Worker secret. It is not in the repo, the database, the settings screen or any page.
- Order statuses: `created`, `paid`, `failed`, `aborted`, `awaited`, `mismatch`.

### The ways a Visitor upgrades (fixed 4 Oct 2026)
A free Visitor can reach a paid pass from four places. Two of them were broken until 4 Oct, found while looking for revenue gaps:
- **The `/register` success screen's Upgrade buttons** linked to `/register#delegate` on the same page, which changes only the hash, so nothing opened. They now call `upgradeFromSuccess()`, which opens the paid form on that pass filled in from the free form; the page also listens for `hashchange`.
- **The welcome email's Upgrade buttons** linked to `/register#delegate`, which for an existing Visitor in any browser without their session ends at "That email is already registered". They now go to the app signed in (`?action=pay&pass=…&token=`), sharing the card link's token (a second `createLoginToken` would cancel the first), and `resumePayment()` opens the paid form filled in.
- The app's own upgrade prompts, and "Remind to pay", were already fine.

Both paid forms now show the amount charged, **"You pay ₹5,898.82 in total (₹4,999 + 18% GST)"**, above the button. Before this the GST-inclusive figure first appeared on CCAvenue's page. The figures come from `GET /api/payments/config` (`passes`), built from `passAmounts()`, so the form cannot disagree with the charge. The listener is on the capture phase because a pass chosen in code fires a `change` that does not bubble.

### Upgrade campaign (built 4 Oct 2026)
Admin → Payments → **Upgrade campaign**: one email to each free Visitor, with a button that signs them in and opens the paid form on the pass that fits (`?action=pay&pass=`, `resumePayment()` in the app).

| Audience | Rule | Offer |
|---|---|---|
| Senior Visitors | `SENIOR_RANK_SQL = 1 AND STUDENT_RANK_SQL = 0`, the rules the directory teaser ranks by | Delegate Pass, ₹5,898.82 incl. GST |
| Students, interns, scholars | `STUDENT_RANK_SQL = 1` | Academic Pass, ₹1,178.82 incl. GST, "bring your student or faculty ID" |

- It is a campaign of kind `upgrade` on the existing bulk email campaigns (0028): one row per person, the shared send gap (`profile_reminder_gap_seconds`, 90 s by default), only 9am–9pm IST, Pause in the monitor, Resume and Retry under Settings → Bulk email. No new table.
- Only conference Visitors (`main_event = 1`, `badge_type = 'Visitor Pass'`), never anyone unsubscribed or who said no to email, and **never anyone already on an upgrade campaign** (pending, sending or sent), so a second run cannot send twice. A failed send can be included in a later run. The two audiences cannot overlap.
- The send re-checks the person: a paid pass by then, unsubscribed, or panel-only means skipped, not sent.
- No discount (organiser had not chosen one); the price is `passAmounts()`. The offer rides in `campaigns.ref_id` (1 Delegate, 2 Academic) so "Retry those" keeps it.
- The email claims only what the site's own pages say for each pass. The Delegate email lists sessions, workshops, lunch and the directory. The Academic email lists the concessionary rate, networking, select workshops and the ID check.
- Tests: `smoke-payments.mjs` (audiences, preview, the gap, the window, no second send, skips, other campaign kinds untouched), `pay-test.cjs` (the Payments block, Preview, Send), `check-payment-sql.py` (both audiences on real SQLite with the awkward rows).

### People who stop part-way, and "Remind to pay" (live 4 Oct 2026)
The organiser asked for abandoned checkouts to be captured and followed up. Three ways to stop, all on Admin → Payments under **Didn't finish paying**:

| Stopped | What is kept | The reminder's button goes to |
|---|---|---|
| Filled in the paid form on `/register` and closed it before Proceed | the fields typed so far, as they are typed (`checkout_leads`, page `register`) | `/register?resume=<signed id>`: the form opens filled in. The link is good for 14 days and is taken out of the address bar on arrival |
| Holds a free pass and closed the app's upgrade form | the same (page `app`) | the app, signed in (`?action=pay&pass=<tier>`): the paid form opens on that tier, filled in from their profile |
| Registered for a paid pass and did not pay: left the CCAvenue page, pressed Cancel there, or the payment failed | the registration and its orders | the app, signed in, straight to the CCAvenue page |

- **The forms say it:** "We keep what you type here as you go, so you can finish later if checkout is interrupted." A lead is not a registration, counts nowhere, and has no pass.
- An order nobody answered for an hour is shown as **left the CCAvenue page**, the same as pressing Cancel.
- **Never reminded** (the row says why): anyone unsubscribed or who said no to email; someone on the CCAvenue page right now; a bank still confirming; an amount mismatch; a lead active in the last hour (they may still be typing); anyone reminded in the last 24 hours.
- **One reminder each** from the bulk button, which skips anyone already reminded; a row's "Remind again" is allowed after a day. The run goes one email at a time with the gap chosen beside the button, lives in the tab, and Stop pauses it.
- Someone who registered for a paid pass **before 4 Oct** and never tried online may have paid on mUni Campus: they are left out of the bulk send unless "Everyone, older ones too" is chosen, and their email says to reply instead of paying again.
- It is campaign mail: the unsubscribe footer is on it.
- The capture endpoint (`POST /api/payments/checkout-lead`) is public, answers `{"ok":true}` whatever it did (so it reveals nobody's registration), and keeps no more than 30 new addresses an hour from one IP.

0046 was applied on 4 Oct 2026. The three test registrations made while proving checkout live (#2697, #2698, #2699, with their 4 orders and sign-in tokens) were deleted the same day after a backup. By then two real buyers had already reached CCAvenue without paying (an Academic and a VIP); they are the first entries under "Didn't finish paying". A real successful payment had still not been made at the end of that day.

**Proven live on 7 Oct 2026:** the first two real payments, a VIP Pass (₹17,698.82) and a Delegate Pass (₹5,898.82), both by credit card. Each order was recorded `paid` with CCAvenue's amount matching ours, the badge, `payment_status`, `payment_amount` and `main_event` were set, and `payment.received` was audited. The VIP buyer was one of the two who had abandoned at CCAvenue on 4 Oct and came back on his own. On 8 Oct the organiser enabled more payment methods in CCAvenue; the payment page now offers Credit Card, Debit Cards, Net Banking, Wallet, UPI ("Pay By Any UPI App", which opens the buyer's UPI app on a phone) and EMI Options. This was checked with two test registrations, deleted straight after.

### Decisions the organiser has not been asked yet (built to the cautious answer)
- **Invoices stay a person's step.** They use the accountant's number series and need the buyer's GSTIN; issuing one per payment automatically would be quick to add once the CA agrees.
- **A confirmed Delegate cannot buy a VIP upgrade here.** They would be charged the full VIP price on top; the price of an upgrade is a commercial decision.
- **The mUni Campus event page is still open on their side.** This site no longer links to it, but anyone holding the old link can still pay there, and that payment would arrive with no word to this database. Closing it is a request to mUni, not a change here.

---

## 16. Campus Series insights reports (built 8 Oct 2026)

Two PDFs, one per panel, given out for contact details: `public/reports/djsce-ai-and-employability-insights-report.pdf` ("Beyond the Fear", DJ Sanghvi, 21 Sep, 20 pages, 10 MB) and `public/reports/jnu-ai-and-employability-insights-report.pdf` ("AI and Employability", JNU, 30 Sep, 22 pages, 6 MB). The two recordings are `fIPXB3mTNOM` (DJ Sanghvi) and `6tlYBxAPw3g` (JNU), both on the Bharat AI Innovation channel; the JNU keynote is `Vfr3Rhr2RKI`. All of this is `INSIGHTS_REPORTS` in `src/index.tsx`.

### How a PDF is served
- `scripts/gen-routes.mjs` keeps `/reports/*` **with the worker** (`FORCE_DYNAMIC_DIRS`); every other top-level folder is served by Pages directly. `GET /reports/:file` checks the token on `?t=`, then reads the file through `env.ASSETS` (the Pages static-asset binding, typed on `Bindings`) and streams it with `Cache-Control: private, no-store`, `X-Robots-Tag: noindex` and `Content-Disposition: inline`. Without a valid token, an unknown name and a bad or stale token all get the same `302` to `/insights?link=expired#get`.
- A token is `<subject>.<expiry>.<24 hex>`: subject `l<row id>` for someone who asked on the page, `a<attendee id>` for a panel registrant; HMAC of `report:<slug>:<subject>:<expiry>` with `passTokenSecret()`; `REPORT_LINK_DAYS = 90`. A link is good for anyone who has it for those 90 days: the gate is contact details, not DRM.
- `public/sw.js` never caches `/reports/` (no VERSION bump was needed: nothing stale had to be purged).
- A link that is opened is written to the row as `downloads + 1`, `last_download_at`, `last_report`.

### The two doors
1. **`/insights`** (`public/insights.html`, the `ir-*` classes plus `campus-panel.css`): name, email, mobile, "I am" (professional / student / faculty, which renames the organisation and title fields and shows the industry list only to professionals, like the JNU form), organisation, an optional job title and city, and an unticked "keep me posted" box. `POST /api/reports/request` validates (`400 {missing:[...]}` names every empty field), caps **30 rows an hour per address**, upserts `report_downloads` (never wiping a detail given earlier, never un-ticking consent), answers with both links at once, and emails the same links (`sendReportsEmail`) **once per address** (a repeat visit shows the links but does not mail again). The page keeps the links in `localStorage` for 60 days ("Welcome back"), forgets them when `?link=expired` brings someone back, and builds the thank-you with DOM calls, not markup. **Asking for the reports registers nobody**: the row is not an attendee, counts nowhere, and the November Visitor Pass stays a separate choice (a button after the links).
2. **Admin → Overview → Campus panels → "Send the reports"** (per panel, the orange button under "Insights reports"): `POST /api/admin/panels/:slug/send-next-reports` mails the panel's registrants one at a time at the chosen pace (`paceControl`, same gap setting as the other two pumps), Stop parks the rest on the server (`pause-reports`, which also creates parked rows for people without one), Resume un-parks only paused rows, "Retry N failed" clears errors (`resume-reports`), **Preview reports email** renders it for a sample registrant. The queue is `LEFT JOIN report_downloads` on the lower-cased email, so a registrant of both panels, or one who already asked on the page, is mailed once. Since 8 Oct it leaves out **unsubscribes only** (`unsubscribedClause()`): people who said no to marketing on the LinkedIn form are mailed too, on the organiser's word, and their email has no November ask (§4). The block shows unsubscribes as "not mailed (unsubscribed)". The email carries the unsubscribe footer. People who answered "I can't make it" were never left out: the queue does not look at the answer. Migration 0047 must be applied first; the pump answers `409` naming it, and the block says so.

### The email (`sendReportsEmail`)
Brand header, "Thank you for registering for the Campus Series panel at <host>" (or "Here are the two reports you asked for" from the page), a card per report with its cover (`public/images/reports/*-cover.jpg`, page 1 rendered with PyMuPDF), the two recordings, "Use them, share them" with the 90-day note, and the November ask: a **Register free** button, or "You are registered, see you there" when `attendees.main_event = 1`. Subject: "Your AI and Employability insights reports (Campus Series)".

### Who opened what, who watched what (built 8 Oct 2026, needs 0048)
- **Every link in the email is counted, and a mail scanner cannot fake it.** The report buttons point at `/r/<slug>?t=`, the video links at `/w/<slug>?t=`. Either opens a small page that posts itself (`reportHopPage`); only the post records the act (`recordReportAct`) and then sends the browser on, to the PDF (`/reports/<file>?t=&via=1`, which does not count again) or to YouTube. Scanners follow links but do not post forms, the same reasoning as `/panel-rsvp`. A broken or expired `/w/` link still plays the video, uncounted.
- **Plays on the website are counted from YouTube's own "playing" signal.** Every embedded player has `?enablejsapi=1` and `data-report="djsce|jnu"`, and `public/js/watch-track.js` (loaded on `/insights`, `/campus-series`, `/campus-djsanghvi`, `/campus-jnu`) posts `POST /api/reports/watch` once per recording per page view. The play is put against a person only when that phone asked for the reports on `/insights` (the link kept in `localStorage` carries a valid token); otherwise it is counted with nobody's name.
- `/insights` links carry `&from=site`, so an open is recorded as "on the website" rather than "from the email". The first emails of 8 Oct, sent before this, carried direct `/reports/` and YouTube links: their PDF opens are counted as `link` (and a scanner can inflate those), their video taps are not counted.
- An act is one row of `report_events`: the same person repeating the same act within 30 minutes is one act, and one address writes at most 120 rows an hour.
- Admin: on each panel's Insights reports line, **opened a report** and **watched a recording** open the people behind them (`reportPeople`, `GET /api/admin/reports/people?what=opened|watched&panel=<slug>`, with CSV). Under the panels: **Who opened a report**, **Who watched**, plays on the website, DJ Sanghvi plays, JNU plays. **Everyone, as CSV** gains `reports_opened` and `videos_watched`. YouTube Studio still has the full view counts, anonymous ones included.

### Numbers
- Per panel on the Campus panels block (`panelReportStats`, in `GET /api/admin/panels`): have the reports email, opened a report, watched a recording, to send, not mailed (unsubscribed), failed. These count rows of `report_downloads` and `report_events` joined by email, not the panel list, so the two clickable ones use their own lists (`reportPeople`), not `panelPeople`, and `PANEL_PEOPLE_METRICS` has no copy of them; `check-panel-drilldown.mjs` is unaffected.
- Under the panel rows (`renderReportSummary`, `GET /api/admin/reports/summary`): everyone who has the links, asked on the website, emailed, opened, opens in all, said yes to updates, with **Everyone, as CSV** (`GET /api/admin/reports/leads.csv`, audited).

### Where the recordings and the reports appear on the site
`/insights` (both, with the keynote link), `/campus-series` ("Watch the panels, read the reports" after the panel cards, plus a "Watch & Read the Report" button on each card), `/campus-djsanghvi` and `/campus-jnu` ("Watch the panel, read the report" straight after the hero; the concluded notice and the hero button now lead there), and an "Insights Reports & Recordings" button in the home-page Campus Series strip. Embeds use `youtube-nocookie.com`, `loading="lazy"`, in a `.yt` 16:9 box (`campus-panel.css?v=20261008`). The og card is `images/og/insights.jpg` from `gen-og-cards.mjs`; `/insights` is in `sitemap.xml` and `llms.txt`.

### Verify
`scripts/verify/smoke-reports.mjs` (in `npm run verify`): the gate (no link, forged, wrong report, expired, unknown file, no Pages binding), the form (what is missing, both links, the row, the email with signed absolute links and both recordings and the unsubscribe header, no second email, the registered-attendee wording, the per-address cap, before 0047), the admin side (auth, batch of one, lower-casing, suppression in the SQL, audit, Stop/Resume/Retry SQL, preview, numbers, CSV, before 0047, markers on `/admin`), and what is built (`_routes.json`, both PDFs in `dist/`, the page, the service worker, the campus embeds). `prod-sweep.mjs` checks `/insights`, the gate, the empty form, the admin guards and the embeds on production.

### To go live
0. **0048, for who opened and who watched:** `npx wrangler d1 execute bharatai-production --remote --file=./migrations/0048_report_events.sql`, then record 0044 to 0048 in the ledger (§3).
1. Push (the PDFs and covers are in the repo; nothing to upload by hand).
2. Organiser: `npx wrangler d1 export bharatai-production --remote --output=backup-pre-0047-<date>.sql` then `npx wrangler d1 execute bharatai-production --remote --file=./migrations/0047_report_downloads.sql` (it is `IF NOT EXISTS`, safe to run twice). **Not `migrations apply`**: it was tried on 8 Oct and failed on 0044, see §3.
3. Admin → Overview → Campus panels → **Preview reports email**, then **Send the reports** on each panel (one email a minute by default; about 433 for DJ Sanghvi, a little under 7½ hours with the tab open; Stop and Resume as needed).

---

## 17. Panel email runs on the server (built 8 Oct 2026)

Until 8 Oct the three panel emails (confirmation, "Are you coming?", the insights reports) went out from a timer in the admin tab: one email, a wait, the next. Closing the laptop stopped the run. Now a send is a **job on the server**, and the organiser can close the page once the scheduler Worker is deployed.

### How it works
- **The job** is one row in `app_settings`, `mail_job:<kind>:<slug>` (kind = `confirmations` | `reminders` | `reports`), as JSON: `status` (running | paused | done | failed), `gap` seconds, `next_at` (epoch ms the next email is due), `sent`, `failed`, `remaining`, `fails_in_a_row`, `started_by`, `last_error`, `finished_at`. No migration: the table has always been there.
- **A tick sends what is due.** `tickMailJobs(c, maxSeconds, fromCron)`: for every running job, if `next_at` has passed it **claims** the next email by swapping the job's JSON for one with `next_at = now + gap` (`UPDATE app_settings SET value = ? WHERE key = ? AND value = ?`), and only the ticker whose swap landed sends. Two tickers at once therefore send one email, never two; nobody is mailed twice. For up to `maxSeconds` the tick also waits for the next email inside its window and sends that, so a scheduler that knocks once a minute still honours a 30-second gap, and "no gap" runs at full speed.
- **Two tickers.** `POST /api/cron/tick` (bearer `CRON_SECRET`, or `ADMIN_SECRET` while no `CRON_SECRET` is set on the site; records `cron_last_tick`) is for the scheduler Worker, which knocks every minute with `max_seconds: 50`. `POST /api/admin/mail-jobs/tick` (admin, `max_seconds` capped at 10) is the admin page's own, every 10 seconds while a job is running, which keeps a run going before the Worker is deployed and keeps the progress line live.
- **Send / Resume / Try again** are one door, `POST /api/admin/mail-jobs/:kind/:slug/start {gap_seconds}`: a paused job keeps its counts and its parked rows are freed (`unparkPanelMail(paused_only)`); a done or failed job starts afresh. **Stop** (`/stop`) sets the job paused and **parks the rows** as the old Stop did, so a page still running the old script cannot carry on either. **Pace** (`/pace`) changes the gap mid-run; a shorter gap takes effect at once.
- **It stops itself** on a hard error (a migration missing, "Are you coming?" for a panel that has started) and after **five failed sends in a row**, with the reason on the job, rather than burning through the list marking everyone failed. The admin line shows the reason and offers Try again.
- **The three send functions** (`sendNextPanelConfirmations`, `sendNextPanelReminders`, `sendNextPanelReports`) are shared by the jobs and by the old `send-next-*` routes, which still answer the same, so an admin page on the old script keeps working until it is refreshed.
- **The admin page** (`renderCampusPanels`, `mailButtons`, `mailJobLine`, `startMailJob`, `stopMailJob`, `setMailJobPace`, `mailJobsTick`) is a window onto the job. A line at the top of the Campus panels block says either "Sending runs on the server (scheduler seen N s ago): you can close this page" or, in amber, "The scheduler is not running, so sending stops when this page is closed". That is decided from `cron_last_tick` being under three minutes old, so it is honest: a Worker that stopped knocking shows within three minutes.

### Deploying the scheduler Worker (organiser, once)
Cloudflare Pages cannot run on a timer, so `cron/` is a separate one-file Worker with a cron trigger. From the repo root:
```
npx wrangler deploy --config cron/wrangler.jsonc
echo "<the admin password>" | npx wrangler secret put CRON_SECRET --config cron/wrangler.jsonc
```
Pipe the value in (a `wrangler secret put` that is answered at the prompt can save an empty value). The site accepts the admin secret at `/api/cron/tick` while it has no `CRON_SECRET` of its own; to use a dedicated secret instead, set it on both (`npx wrangler pages secret put CRON_SECRET --project-name bharatai-networking` plus the Worker) and redeploy the site, since a Pages secret reaches only deployments made after it is set. Check it is alive: start a send and the block says "scheduler seen N s ago" within a minute; `npx wrangler tail --config cron/wrangler.jsonc` shows every knock. A 401 in that log means the two secrets differ.

### Verify
`scripts/verify/smoke-mail-jobs.mjs` (in `npm run verify`): the doors, start, the tick, the wait inside a window, two tickers at once, Stop, Resume, pace, done, five failures, a started panel, a missing migration, the old routes, the page markers, the Worker's config. `pace-test.cjs` drives the admin page on `pace-harness.mjs`, whose job endpoints mirror the worker's. `prod-sweep.mjs` checks the doors on production.
