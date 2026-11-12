// One command for the local verification suite. Needs a fresh `npm run build` first.
//   npm run verify            (or: node scripts/verify/run-all.mjs)
//   node scripts/verify/run-all.mjs --only phone     (suites whose name contains "phone")
// Starts each harness it needs, runs the suite, stops the harness, prints a summary,
// and exits non-zero if anything failed. Production checks are separate: npm run verify:prod
//
// A harness port that is already answering is a FAIL, not a head start: on 29 Oct
// 2026 a pace-harness from the morning was still on :8774 and a stale phone
// harness on :8772 served an old /app, so the phone suite judged new code
// against an old page and failed for a reason that was not in the code.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
if (!existsSync(join(root, 'dist', '_worker.js'))) {
  console.error('dist/_worker.js is missing: run `npm run build` first.');
  process.exit(2);
}

const SUITES = [
  { name: 'server: admin, desk, security and attendee routes', args: ['smoke-routes.mjs', 'attendee'] },
  { name: 'server: free-pass directory teaser', args: ['smoke-directory-teaser.mjs'] },
  { name: 'server: the public glimpse on /networking (titles only, no name, photo or company), on real SQLite', args: ['smoke-glimpse.mjs'] },
  { name: 'server: an unpaid paid pass is not shown as that pass (directory, connections, leads, admin counts), on real SQLite', args: ['smoke-unpaid-pass.mjs'] },
  { name: 'server: the Overview board (who holds which pass, money from passes, what is waiting on a person), on real SQLite', args: ['smoke-board.mjs'] },
  { name: 'server: networking write rules (who may answer a request or meeting, known statuses, meeting checks, no emails in connection lists, read marks, scanner and the one-use sign-in email, booth text), on real SQLite', args: ['smoke-networking-guards.mjs'] },
  { name: 'server: meetings on the day (no two accepted meetings at once on a request, an acceptance or a new time; busy times without names; one reminder to both about 15 minutes before), on real SQLite', args: ['smoke-meeting-slots.mjs'] },
  { name: 'server: after the event (the survey link signed per person, opening saves nothing, answers checked and replaced, the bulk run skips people who answered, the score, the CSV, exhibitor results sent once with a signed Leads link), on real SQLite', args: ['smoke-after-event.mjs'] },
  { name: 'server: one person, one registration (same email or mobile refused)', args: ['smoke-register-dupes.mjs'] },
  { name: 'unit: already registered and buying again (the pass rule, the LinkedIn box, the notice, the code step), each function alone', args: ['unit-already-registered.mjs'] },
  { name: 'server: already registered and buying again (the refusal counted, the sign-in email that carries on to payment), on real SQLite', args: ['smoke-already-registered.mjs'] },
  { name: 'server: duplicates finder and merge, on real SQLite with the production schema', args: ['smoke-merge-dupes.mjs'] },
  { name: 'server: account-ready email opened / clicked / profile marks and the Notification Status counts', args: ['smoke-notify-funnel.mjs'] },
  { name: 'server: account-ready email by itself 5 minutes after registering (or paying), once, the skips, the switch, before the networking email', args: ['smoke-notify-auto.mjs'] },
  { name: 'server: networking app email (one subject, body by pass, the phone of people /networking may name, preview, run order, skips, marks, counts), on real SQLite', args: ['smoke-netmail.mjs'] },
  { name: 'server: help email to people stuck on the way in, the badge or the pass (steps counted, startup report, dead links, the clock, by hand, /app.js caching)', args: ['smoke-help.mjs'] },
  { name: 'server: sign-in token rules (expiry, uses, two live links, a stale one, codes and attempts, a new code retires codes only, a new email link retires nothing)', args: ['unit-login-tokens.mjs'] },
  { name: "server: every email's sign-in link keeps working end to end (welcome, account-ready at 5 min, networking at 10, the help steps, the code), on real SQLite", args: ['system-email-links.mjs'] },
  { name: 'server: campus panel "Are you coming?"', args: ['smoke-panel-answers.mjs'] },
  { name: 'server: AI marketplace gates, pages and exhibitor invites', args: ['smoke-marketplace.mjs'] },
  { name: 'server: exhibitor teams (passes by booth type, the Delegate Pass past them, an exception by the organisers, the contact gets no pass unless listed, the email, the CSV), on real SQLite', args: ['smoke-exhibitor-team.mjs'] },
  // Innovation Talks: hall, time, the speaker's details, the missing-details email and
  // Announce (12 Nov 2026), at four levels.
  { name: 'unit: Innovation Talks, each rule alone (the time in words and every refusal, the time file agreeing with the server, what is missing, where an email comes from, the form, the clash warning, the announcement with both hall names)', args: ['unit-innovation-talks.mjs'] },
  { name: 'integration: Innovation Talks on real SQLite (the 49 talks and the time file, public and admin lists, add and edit, contacts, the missing-details email, no password, before and after 0052)', args: ['smoke-innovation-talks.mjs'] },
  { name: 'system: Innovation Talks, one talk from no time to complete (a time and hall, the booth contact emailed, the reply typed in, the app list, the announcement, Ask everyone once)', args: ['system-innovation-talks.mjs'] },
  { name: 'browser: Innovation Talks on a laptop (by day, both hall names, filters, the edit form, a time given, the email previewed and sent, Announce) and the app tab on a phone', args: ['browser-innovation-talks.cjs'], harness: 'talks-harness.mjs', port: 8863, portEnv: true },
  { name: 'integration: the missing-details email to Innovation Talk speakers by itself (off until switched on, one a minute, the sending hours, 48 hours between asks by hand or by itself, three at most, a failed send, the switch), on real SQLite with the clock moved', args: ['smoke-talk-auto.mjs'] },
  // The scheduler in Admin -> Conference (12 Nov 2026), at four levels.
  { name: 'unit: the scheduler, each rule alone (the hours of a day, free time in a hall, where a session fits, which session is which Innovation Talk, every note on the attention list, an event in words)', args: ['unit-scheduler.mjs'] },
  { name: 'unit: the programme downloads from the scheduler (the PDF page with and without speaker photos, drafts left out, text escaped, no email or mobile; the Excel workbook read back: two sheets, the coloured heading that stays in place, filters, one speaker a line)', args: ['unit-schedule-downloads.mjs'] },
  { name: 'integration: the scheduler on real SQLite (the read, moving a session and its refusals, an Innovation Talk kept in step, find a free slot, Delhi started and copied as drafts and never public, a speaker with details and their Speaker pass)', args: ['smoke-scheduler.mjs'] },
  { name: 'system: the scheduler, one planner across the programme, the Innovation Talks list, the app and passes (a talk placed, a clash made and fixed, a new speaker with a pass, Delhi private, the email by itself)', args: ['system-scheduler.mjs'] },
  { name: 'browser: the scheduler on a laptop (needs attention, free time, find a free slot, a new speaker with email and pass, names in one box, drag and Undo, zoom, day apart from time, Delhi) and the attention list on a phone', args: ['browser-scheduler.cjs'], harness: 'conference-harness.mjs', port: 8871, portEnv: true },
  { name: 'server: booth leads by badge scan (who may scan, the lead screen, ratings and notes, the list for the whole team) and the exhibitor list in the app (real exhibitors only, no internal notes), on real SQLite', args: ['smoke-booth-leads.mjs'] },
  { name: 'server: the badge desk over two days (one check-in per person per day, check in on scan, undo, a scan made offline, stats by day, the saved list), on real SQLite with the clock moved', args: ['smoke-desk-days.mjs'] },
  { name: 'server: checkout on this site (CCAvenue), the switch, the answer, the queues', args: ['smoke-payments.mjs'] },
  // A paid pass moving up for the difference, at four levels (5 Nov 2026). The
  // fourth, a phone in a real browser, is section 3b of pay-test.cjs below.
  { name: "unit: pass upgrade (the app's own ladder and difference, the server's rule for every holder and every pass on both sides of the dated price change, and the two agreeing), on real SQLite", args: ['unit-upgrade-steps.mjs'] },
  { name: 'integration: pass upgrade (the order for the difference, hand-off, the answer, the pass and what was paid in all, receipt, emails, the same answer twice, cancel, wrong amount, forged answer, a badge set by hand, midnight, prompts counted, the pages), on real SQLite', args: ['integration-upgrade.mjs'] },
  { name: 'system: one person from a free registration to Delegate, Premium Delegate and VIP across the price change (the gates, the workshop seat, the account email link, three receipts, the payments queue, "What sells", the Overview board), on real SQLite', args: ['system-upgrade-journey.mjs'] },
  // A pass set by hand, at four levels; the fourth, a real browser, is further down.
  { name: 'unit: the hand-written pages after the price rise (the current price beside the old one struck through, no countdown, what search engines are told)', args: ['unit-price-rise.mjs'] },
  { name: 'unit: a pass set by hand (who is asked, what an answer writes, the same four passes as the server)', args: ['unit-pass-answer.mjs'] },
  { name: 'integration: a pass set by hand (Full Edit, the inline cell, Set pass and Add Attendee, each answer, money on record, nobody else touched)', args: ['integration-pass-answer.mjs'] },
  { name: 'system: a pass set by hand, then what the person can do (the pass, an upgrade, Pay now) and how the Overview counts it', args: ['system-pass-answer.mjs'] },
  { name: 'server: Campus Series insights reports (gated PDF, /insights form, reports email, admin pump)', args: ['smoke-reports.mjs'] },
  { name: 'server: panel email as server jobs (scheduler door, claim, stop, resume, done, failures)', args: ['smoke-mail-jobs.mjs'] },
  { name: 'server: workshop seats (who may choose, the seat limit, switching cut-off, admin, door scan)', args: ['smoke-workshops.mjs'] },
  { name: 'server: pass QR and badge desk (signed token, verify screen states, check-in, lookup, reissue, scanner, encoder round trip)', args: ['smoke-pass-desk.mjs'] },
  { name: 'browser: badge desk scanner (fake camera, iPhone without BarcodeDetector, native reader failing, hostile QR)', args: ['browser-scan-page.mjs'] },
  { name: 'unit: the Delhi 2027 page (form rules, calendar file, facts, the tab on every page, one stylesheet version), each alone', args: ['unit-delhi.mjs'] },
  { name: 'system: Delhi 2027 from an advert to Admin Enquiries (the page\'s own script, real worker, real SQLite, team email, the build)', args: ['smoke-delhi.mjs'] },
  { name: 'unit: the Delhi 2027 passes form (its rules, its figures against the server), each alone', args: ['unit-delhi-pay.mjs'] },
  { name: 'booth applications, Mumbai and Delhi: the Delhi page\'s rules, the route on real SQLite (every answer, both emails, refusals, limits), the saved replies', args: ['smoke-booth-apply.mjs'] },
  { name: 'system: a paid Delhi pass, from the form through CCAvenue to the receipt and Admin, kept apart from Mumbai (real worker, real SQLite)', args: ['smoke-delhi-pay.mjs'] },
  { name: 'browser: a paid Delhi pass on a phone and a laptop, the form, the gateway played, the result page', args: ['browser-delhi-pay.cjs'], harness: 'delhi-harness.mjs', port: 8801, portEnv: true },
  { name: 'browser: Delhi 2027 on a phone and a laptop, the form on the real worker, the menu on every page, the home page\'s heading font', args: ['browser-delhi.cjs'], harness: 'delhi-harness.mjs', port: 8786, portEnv: true },
  { name: 'unit: the Government page (the rules of the nomination form, its words, the people it names, the Govt tab on every page), each alone', args: ['unit-government.mjs'] },
  { name: 'system: a nomination from a Ministry, from the link in a letter to Admin Enquiries (the script of the page, real worker, real SQLite, team email, the build)', args: ['smoke-government.mjs'] },
  { name: 'browser: the Government page on a phone and a laptop, the nomination on the real worker, the Govt tab', args: ['browser-government.cjs'], harness: 'delhi-harness.mjs', port: 8788, portEnv: true },
  { name: 'browser: the motion on the conference page on a phone and a laptop, with animations off, and without its files', args: ['browser-conference-motion.cjs'], harness: 'delhi-harness.mjs', port: 8799, portEnv: true },
  { name: 'unit: the people on the conference schedule (the list of who is who, the markup, small pictures, the app\'s SQL untouched, the generator in step with the JSON)', args: ['unit-schedule-people.mjs'] },
  { name: 'browser: the people on the conference schedule on a phone, a small phone and a laptop (photo, designation, department, logo; no hall on either day widens the page)', args: ['browser-schedule.cjs'], harness: 'delhi-harness.mjs', port: 8869, portEnv: true },
  { name: 'browser: the redesigned workshops page on a phone and a laptop: no words lost, every effect, animations off, without its motion files', args: ['browser-workshop-redesign.cjs'], harness: 'delhi-harness.mjs', port: 8807, portEnv: true },
  { name: 'unit: the call for workshop partners (every rule of the form, what it sends, its words, Admin label and Overview line), each alone', args: ['unit-workshop-partner.mjs'] },
  { name: 'system: a workshop idea from a shared link to Admin Enquiries and the Overview board (the page\'s own script, real worker, real SQLite, team email)', args: ['smoke-workshop-partner.mjs'] },
  { name: 'browser: the redesigned partner page on a phone and a laptop: every price and word kept, each Enquire button carried into the form, an enquiry on the real worker, the bar, animations off, without its motion files', args: ['browser-partner-redesign.cjs'], harness: 'delhi-harness.mjs', port: 8817, portEnv: true },
  { name: 'browser: the call for workshop partners on a phone and a laptop, the form on the real worker', args: ['browser-workshop-partner.cjs'], harness: 'delhi-harness.mjs', port: 8790, portEnv: true },
  { name: 'browser: delegate app (chat, connect, meet, inbox, back, XSS)', args: ['browser-delegate.cjs'], harness: 'app-harness.mjs', port: 8770 },
  // portEnv: the harness and the test read HARNESS_PORT, so a busy :8772 (another
  // session's run) moves this suite to :9772 instead of failing it.
  { name: 'browser: phone journey and admin Campus panels block', args: ['phone-test.cjs'], harness: 'phone-harness.mjs', port: 8772, portEnv: true },
  { name: 'browser: stuck on the way in (startup check, refresh, steps, slow), a dead link, and the badge and pass steps counted', args: ['browser-help.cjs'], harness: 'phone-harness.mjs', port: 8778, portEnv: true },
  { name: "browser: a phone opens each email's sign-in button, oldest first after newer emails went out, on the real worker and real SQLite; a dead link opens the sign-in box", args: ['browser-login-links.cjs'], harness: 'login-harness.mjs', port: 8780, portEnv: true },
  { name: 'browser: the admin Overview board (who holds which pass, money from passes, waiting on you, days to go) on the real worker and real SQLite, desktop and phone', args: ['browser-board.cjs'], harness: 'board-harness.mjs', port: 8782, portEnv: true },
  { name: 'browser: the admin Attendees search (typing a whole name with the cursor kept, any word order, mobiles, best first, nothing found, keys) on the real worker and real SQLite', args: ['browser-admin-search.cjs'], harness: 'board-harness.mjs', port: 8798, portEnv: true },
  { name: 'browser: a pass set by hand (the question on all four Admin screens, cancelling, the amount, then the person on a phone)', args: ['browser-pass-answer.cjs'], harness: 'login-harness.mjs', port: 8794, portEnv: true },
  { name: 'browser: an urgent notice stays until closed; a meeting is a day and a time with busy times greyed, on a phone', args: ['browser-meeting-slots.cjs'], harness: 'login-harness.mjs', port: 8794, portEnv: true },
  { name: 'browser: the survey on a phone (from the email, missed question, broken link, 390 and 320 px) and Admin, After the Event with its previews', args: ['browser-after-event.cjs'], harness: 'login-harness.mjs', port: 8794, portEnv: true },
  { name: 'unit: the free-pass waiting list, each rule alone (the switch, the entry rule as a table, the roster codes, the sanitiser, the words on /register and /passes, the admin page functions, a database without 0056)', args: ['unit-waitlist.mjs'] },
  { name: 'server: the free-pass waiting list (register with the switch off and on, the two emails, no pass, the desk, the admin decision, the bulk run, the board), on real SQLite with 0056', args: ['smoke-waitlist.mjs'] },
  { name: 'system: free passes full: the switch thrown, a person joins the waiting list, is confirmed with a slot by the minute clock and gets in, someone registered before is untouched, the switch off again', args: ['system-waitlist.mjs'] },
  { name: 'browser: free passes full on a phone: /register says waiting list, a real registration lands on the waiting-list screen with the Delegate band, the app pass card says so and opens the Delegate steps', args: ['browser-waitlist.cjs'], harness: 'login-harness.mjs', port: 8846, portEnv: true },
  { name: 'unit: /register and /inquiry each rule alone (one list of booths, against /exhibition: size, price, passes, talk; the small functions; prices by date; every box labelled; nothing required in a folded part; movement only with animations on)', args: ['unit-booking-pages.mjs'] },
  { name: 'integration: /register and /inquiry, the script of each page against the real routes on real SQLite (the row, the email, refusals, no signal)', args: ['smoke-booking-pages.mjs'] },
  { name: 'system: a buyer from /passes through the gateway to Admin, a visitor moving up, someone already registered, an exhibitor from /exhibition to the team', args: ['system-booking-journey.cjs'], harness: 'login-harness.mjs', port: 8842, portEnv: true },
  { name: 'browser: the redesigned /register and /inquiry on a phone, a small phone and a laptop: no words lost, the free and paid choice, the paid form, booths to scale, a real registration and enquiry, every effect, animations off, without the motion files, without any script', args: ['browser-booking-redesign.cjs'], harness: 'login-harness.mjs', port: 8844, portEnv: true },
  { name: 'browser: the redesigned passes page on a phone, a small phone and a laptop: no words lost, every price, every buy button reaches the paid form, the bar with no script, animations off, without its motion files', args: ['browser-passes-redesign.cjs'], harness: 'login-harness.mjs', port: 8821, portEnv: true },
  { name: 'browser: the price rise on a phone and a laptop (the old price really struck through, on the screen, the charge is the current price)', args: ['browser-price-rise.cjs'], harness: 'login-harness.mjs', port: 8796, portEnv: true },
  { name: 'browser: panel email as a server job (start, pace, stop, resume, done, the scheduler note)', args: ['pace-test.cjs'], harness: 'pace-harness.mjs', port: 8774 },
  { name: 'browser: buying a pass on a phone (checkout, result, retry, checkout off, invoice queues), and end to end a paid pass moving up for the difference (pass card, the sheet, the sum, the gateway, an email link)', args: ['pay-test.cjs'], harness: 'pay-harness.mjs', port: 8776 },
  { name: 'system: already registered, buying from an ad on another phone (real worker, real SQLite, the real emails, link, code, send again, known mobile, shared phone, unpaid pass, all the way to paid)', args: ['browser-already-registered.cjs'], harness: 'login-harness.mjs', port: 8784, portEnv: true },
  { name: 'browser: the redesigned AI Marketplace on a phone and a laptop: search, every filter, the bar that stays, sign-in buttons, a failed load, animations off, without its motion files', args: ['browser-marketplace-browse.cjs'], harness: 'mk-browse-harness.mjs', port: 8812, portEnv: true },
  { name: 'browser: the redesigned product page on a phone and a laptop: the inquiry on top and in the bar, folded sections, more like this, hostile text, not found, animations off', args: ['browser-marketplace-product.cjs'], harness: 'mk-browse-harness.mjs', port: 8814, portEnv: true },
  { name: 'unit: the app in the same design as the website (the same colours, every movement stoppable and cheap, nothing un-hides what sign-in hides, versions, the speed budget, Conference Schedule)', args: ['unit-app-design.mjs'] },
  { name: 'integration: the app in the same design as the website, through the built worker (every id once, a button per tab per screen, the footer links, the page no heavier)', args: ['integration-app-design.mjs'] },
  { name: 'system: one person through the redesigned app as their pass changes (free, paid, unpaid, every kind of pass, the directory note, the schedule buttons, signing out)', args: ['system-app-design.cjs'], harness: 'phone-harness.mjs', port: 8837, portEnv: true },
  { name: 'browser: the redesigned app on a phone and a laptop: the bars, five tabs that fit, each moved button, words readable, the menu at every width, animations off, without its files', args: ['browser-app-redesign.cjs'], harness: 'phone-harness.mjs', port: 8835, portEnv: true },
  { name: 'browser: an exhibitor lists a product on the AI Marketplace (sign-in link, the form, plain domains, images, every way the button looked dead, dashboard edit, approval, public page, inquiry)', args: ['mp-test.cjs'], harness: 'mp-harness.mjs', port: 8779, portEnv: true },
  { name: 'browser: exhibitor teams on a phone (the emailed link, the form, a photo, the pass, the Delegate Pass prompt, branding, the stage talk) and Teams & Passes on a laptop', args: ['browser-exhibitor-team.cjs'], harness: 'team-harness.mjs', port: 8851, portEnv: true },
  { name: 'browser: Badge Desk as an app (the manifest and icons, the scanner opening with the network cut, a pass check and the sign-in page never from a copy, signing out forgetting the copy)', args: ['browser-desk-app.cjs'], harness: 'team-harness.mjs', port: 8853, portEnv: true },
  { name: 'unit: the enquiry desk, each rule alone (money in lakhs, reply fields, safe spreadsheets, search, smart views, insights, advice, notes, history in words)', args: ['unit-inquiry-desk.mjs'] },
  { name: 'integration: the enquiry desk on real SQLite (owners by type, the automatic acknowledgement and its limits, who each sender already is, scores and suggested types, changes one and many, notes, replies, settings, the morning summary from the clock, 0053 before and after)', args: ['smoke-inquiry-desk.mjs'] },
  { name: 'system: one booth buyer from the enquiry form to Won (acknowledgement, owner, Hot, the summary chasing, the saved reply, value and follow-up, booth and pass, Won in Insights)', args: ['system-inquiry-journey.mjs'] },
  { name: 'browser: Admin Inquiries on a laptop and a phone (views, search, keys, one enquiry, many at once, Pipeline by dragging, Insights, Automation, export, a link from an email)', args: ['browser-inquiry-desk.cjs'], harness: 'inquiry-harness.mjs', port: 8861, portEnv: true },
  // Admin -> Conference: programme, speakers, halls, announcing (12 Nov 2026), at four levels.
  { name: 'unit: Admin Conference, each rule alone (one person however the agenda spells them, the speaker line the app splits, clashes, times in words, both hall names, the slot email and its escaping)', args: ['unit-conference.mjs'] },
  { name: 'integration: Admin Conference on real SQLite before and after 0054 (who may call it, speakers refused, added, renamed, hidden, deleted, sessions writing the line, clashes, drafts, halls, announce, slot email, photo, the real agenda)', args: ['smoke-conference.mjs'] },
  { name: 'browser: Admin Conference on a laptop and a phone (the board, a session by clicking a hall, a clash, a draft, a speaker with a photo given a slot, announce, slot email, hide, halls, list, CSV, run sheet) and the app on a phone (When and where, both hall names, nothing typed runs)', args: ['browser-conference.cjs'], harness: 'conference-harness.mjs', port: 8857, portEnv: true },
  // A speaker fills in their own Innovation Talk details from the email's link (12 Nov 2026), at four levels.
  { name: 'unit: a speaker\'s own talk page, each rule alone (the signed link, altered and expired, what may be saved and what never, refusals in plain words, what the page never shows)', args: ['unit-talk-self.mjs'] },
  { name: 'integration: a speaker\'s own talk page on real SQLite (the page, the link opening its talk and no other, a save and what it never touches, refusals, the audit log, a photo, the email with the button for a speaker and a booth contact, the automatic email previewed, before 0052)', args: ['smoke-talk-self.mjs'] },
  { name: 'system: one speaker from "please add your details" to a complete talk (the email that went, its link, everything filled in, the tab, the automatic email no longer counting her, the public list, the audit trail)', args: ['system-talk-self.mjs'] },
  { name: 'browser: a speaker\'s own talk page on a phone and a laptop (the link from the email, Needed and In, a short mobile named, a photo, saved and back again, expired and altered links) and Admin\'s "Preview the email" for the automatic email', args: ['browser-talk-self.cjs'], harness: 'talk-self-harness.mjs', port: 8881, portEnv: true },
];

const run = (args, opts = {}) => new Promise((resolve) => {
  const p = spawn(process.execPath, args, { cwd: here, stdio: opts.quiet ? 'ignore' : ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...(opts.env || {}) } });
  let out = '';
  if (!opts.quiet) {
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += d; });
  }
  if (opts.background) return resolve(p);
  p.on('close', code => resolve({ code, out }));
});

const portAnswers = async (port) => {
  try { const r = await fetch(`http://localhost:${port}/app`); return r.ok; } catch (e) { return false; }
};
const waitForPort = async (port, ms = 30000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await portAnswers(port)) return true;
    await new Promise(r => setTimeout(r, 400));
  }
  return false;
};

const onlyArg = process.argv.indexOf('--only');
const only = onlyArg > 0 ? String(process.argv[onlyArg + 1] || '').toLowerCase() : '';
const suites = only ? SUITES.filter(s => s.name.toLowerCase().includes(only)) : SUITES;
if (!suites.length) { console.error(`no suite name contains "${only}"`); process.exit(2); }

let failed = 0;
const summary = [];
for (const s of suites) {
  // A harness that reads HARNESS_PORT is always told its port: two suites share
  // phone-harness.mjs on different ports, and its own default is the phone suite's.
  let harness = null, port = s.port, env = s.portEnv ? { HARNESS_PORT: String(s.port) } : {};
  if (s.harness) {
    if (await portAnswers(port)) {
      if (!s.portEnv || await portAnswers(port + 1000)) {
        summary.push(`FAIL  ${s.name}: something is already listening on :${port} (a stale ${s.harness}, or another session's run? stop it, then run again)`);
        failed++; continue;
      }
      port = port + 1000; env = { HARNESS_PORT: String(port) };
      console.log(`:${s.port} is busy, running ${s.harness} on :${port}`);
    }
    harness = await run([s.harness], { background: true, quiet: true, env });
    if (!(await waitForPort(port))) {
      summary.push(`FAIL  ${s.name}: harness ${s.harness} did not start on :${port}`);
      failed++; harness.kill(); continue;
    }
  }
  const { code, out } = await run(s.args, { env });
  if (harness) harness.kill();
  const passes = (out.match(/^PASS /gm) || []).length;
  const fails = out.split('\n').filter(l => /^FAIL |crashed/.test(l));
  if (code === 0) summary.push(`ok    ${s.name} (${passes} checks)`);
  else { failed++; summary.push(`FAIL  ${s.name} (${passes} passed)\n        ` + fails.slice(0, 6).join('\n        ')); }
}
console.log('\n' + summary.join('\n'));
console.log(failed ? `\n${failed} suite(s) failed` : '\nall local verification suites passed');
process.exit(failed ? 1 : 0);
