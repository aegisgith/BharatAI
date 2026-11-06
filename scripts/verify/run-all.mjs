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
  { name: 'system: a paid Delhi pass, from the form through CCAvenue to the receipt and Admin, kept apart from Mumbai (real worker, real SQLite)', args: ['smoke-delhi-pay.mjs'] },
  { name: 'browser: a paid Delhi pass on a phone and a laptop, the form, the gateway played, the result page', args: ['browser-delhi-pay.cjs'], harness: 'delhi-harness.mjs', port: 8801, portEnv: true },
  { name: 'browser: Delhi 2027 on a phone and a laptop, the form on the real worker, the menu on every page, the home page\'s heading font', args: ['browser-delhi.cjs'], harness: 'delhi-harness.mjs', port: 8786, portEnv: true },
  { name: 'unit: the Government page (the rules of the nomination form, its words, the people it names, the Govt tab on every page), each alone', args: ['unit-government.mjs'] },
  { name: 'system: a nomination from a Ministry, from the link in a letter to Admin Enquiries (the script of the page, real worker, real SQLite, team email, the build)', args: ['smoke-government.mjs'] },
  { name: 'browser: the Government page on a phone and a laptop, the nomination on the real worker, the Govt tab', args: ['browser-government.cjs'], harness: 'delhi-harness.mjs', port: 8788, portEnv: true },
  { name: 'browser: the motion on the conference page on a phone and a laptop, with animations off, and without its files', args: ['browser-conference-motion.cjs'], harness: 'delhi-harness.mjs', port: 8799, portEnv: true },
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
  { name: 'browser: the price rise on a phone and a laptop (the old price really struck through, on the screen, the charge is the current price)', args: ['browser-price-rise.cjs'], harness: 'login-harness.mjs', port: 8796, portEnv: true },
  { name: 'browser: panel email as a server job (start, pace, stop, resume, done, the scheduler note)', args: ['pace-test.cjs'], harness: 'pace-harness.mjs', port: 8774 },
  { name: 'browser: buying a pass on a phone (checkout, result, retry, checkout off, invoice queues), and end to end a paid pass moving up for the difference (pass card, the sheet, the sum, the gateway, an email link)', args: ['pay-test.cjs'], harness: 'pay-harness.mjs', port: 8776 },
  { name: 'system: already registered, buying from an ad on another phone (real worker, real SQLite, the real emails, link, code, send again, known mobile, shared phone, unpaid pass, all the way to paid)', args: ['browser-already-registered.cjs'], harness: 'login-harness.mjs', port: 8784, portEnv: true },
  { name: 'browser: the redesigned AI Marketplace on a phone and a laptop: search, every filter, the bar that stays, sign-in buttons, a failed load, animations off, without its motion files', args: ['browser-marketplace-browse.cjs'], harness: 'mk-browse-harness.mjs', port: 8812, portEnv: true },
  { name: 'browser: the redesigned product page on a phone and a laptop: the inquiry on top and in the bar, folded sections, more like this, hostile text, not found, animations off', args: ['browser-marketplace-product.cjs'], harness: 'mk-browse-harness.mjs', port: 8814, portEnv: true },
  { name: 'browser: an exhibitor lists a product on the AI Marketplace (sign-in link, the form, plain domains, images, every way the button looked dead, dashboard edit, approval, public page, inquiry)', args: ['mp-test.cjs'], harness: 'mp-harness.mjs', port: 8779, portEnv: true },
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
