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
  { name: 'server: one person, one registration (same email or mobile refused)', args: ['smoke-register-dupes.mjs'] },
  { name: 'server: duplicates finder and merge, on real SQLite with the production schema', args: ['smoke-merge-dupes.mjs'] },
  { name: 'server: account-ready email opened / clicked / profile marks and the Notification Status counts', args: ['smoke-notify-funnel.mjs'] },
  { name: 'server: help email to people stuck on the way in, the badge or the pass (steps counted, startup report, dead links, the clock, by hand, /app.js caching)', args: ['smoke-help.mjs'] },
  { name: 'server: campus panel "Are you coming?"', args: ['smoke-panel-answers.mjs'] },
  { name: 'server: AI marketplace gates, pages and exhibitor invites', args: ['smoke-marketplace.mjs'] },
  { name: 'server: checkout on this site (CCAvenue), the switch, the answer, the queues', args: ['smoke-payments.mjs'] },
  { name: 'server: Campus Series insights reports (gated PDF, /insights form, reports email, admin pump)', args: ['smoke-reports.mjs'] },
  { name: 'server: panel email as server jobs (scheduler door, claim, stop, resume, done, failures)', args: ['smoke-mail-jobs.mjs'] },
  { name: 'server: workshop seats (who may choose, the seat limit, switching cut-off, admin, door scan)', args: ['smoke-workshops.mjs'] },
  { name: 'server: pass QR and badge desk (signed token, verify screen states, check-in, lookup, reissue, scanner, encoder round trip)', args: ['smoke-pass-desk.mjs'] },
  { name: 'browser: badge desk scanner (fake camera, iPhone without BarcodeDetector, native reader failing, hostile QR)', args: ['browser-scan-page.mjs'] },
  { name: 'browser: delegate app (chat, connect, meet, inbox, back, XSS)', args: ['browser-delegate.cjs'], harness: 'app-harness.mjs', port: 8770 },
  // portEnv: the harness and the test read HARNESS_PORT, so a busy :8772 (another
  // session's run) moves this suite to :9772 instead of failing it.
  { name: 'browser: phone journey and admin Campus panels block', args: ['phone-test.cjs'], harness: 'phone-harness.mjs', port: 8772, portEnv: true },
  { name: 'browser: stuck on the way in (startup check, refresh, steps, slow), a dead link, and the badge and pass steps counted', args: ['browser-help.cjs'], harness: 'phone-harness.mjs', port: 8778, portEnv: true },
  { name: 'browser: panel email as a server job (start, pace, stop, resume, done, the scheduler note)', args: ['pace-test.cjs'], harness: 'pace-harness.mjs', port: 8774 },
  { name: 'browser: buying a pass on a phone (checkout, result, retry, checkout off, invoice queues)', args: ['pay-test.cjs'], harness: 'pay-harness.mjs', port: 8776 },
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
