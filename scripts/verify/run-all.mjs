// One command for the local verification suite. Needs a fresh `npm run build` first.
//   npm run verify            (or: node scripts/verify/run-all.mjs)
// Starts each harness it needs, runs the suite, stops the harness, prints a summary,
// and exits non-zero if anything failed. Production checks are separate: npm run verify:prod
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
  { name: 'server: campus panel "Are you coming?"', args: ['smoke-panel-answers.mjs'] },
  { name: 'server: AI marketplace gates, pages and exhibitor invites', args: ['smoke-marketplace.mjs'] },
  { name: 'browser: delegate app (chat, connect, meet, inbox, back, XSS)', args: ['browser-delegate.cjs'], harness: 'app-harness.mjs', port: 8770 },
  { name: 'browser: phone journey and admin Campus panels block', args: ['phone-test.cjs'], harness: 'phone-harness.mjs', port: 8772 },
];

const run = (args, opts = {}) => new Promise((resolve) => {
  const p = spawn(process.execPath, args, { cwd: here, stdio: opts.quiet ? 'ignore' : ['ignore', 'pipe', 'pipe'] });
  let out = '';
  if (!opts.quiet) {
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += d; });
  }
  if (opts.background) return resolve(p);
  p.on('close', code => resolve({ code, out }));
});

const waitForPort = async (port, ms = 30000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { const r = await fetch(`http://localhost:${port}/app`); if (r.ok) return true; } catch (e) { /* not up yet */ }
    await new Promise(r => setTimeout(r, 400));
  }
  return false;
};

let failed = 0;
const summary = [];
for (const s of SUITES) {
  let harness = null;
  if (s.harness) {
    harness = await run([s.harness], { background: true, quiet: true });
    if (!(await waitForPort(s.port))) {
      summary.push(`FAIL  ${s.name}: harness ${s.harness} did not start on :${s.port}`);
      failed++; harness.kill(); continue;
    }
  }
  const { code, out } = await run(s.args);
  if (harness) harness.kill();
  const passes = (out.match(/^PASS /gm) || []).length;
  const fails = out.split('\n').filter(l => /^FAIL |crashed/.test(l));
  if (code === 0) summary.push(`ok    ${s.name} (${passes} checks)`);
  else { failed++; summary.push(`FAIL  ${s.name} (${passes} passed)\n        ` + fails.slice(0, 6).join('\n        ')); }
}
console.log('\n' + summary.join('\n'));
console.log(failed ? `\n${failed} suite(s) failed` : '\nall local verification suites passed');
process.exit(failed ? 1 : 0);
