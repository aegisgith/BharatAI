// The website from the app, in one go (16 Nov 2026):
//
//   npm run sync:programme          pull the programme from the live app, then write the
//                                   schedule, the Tracks and the speaker grids
//   node scripts/sync-programme.mjs --from d1      read production D1 with wrangler instead
//
// `npm run build` runs this first with --ci-only: on Cloudflare Pages (CF_PAGES is set)
// or when PULL_PROGRAMME=1, so every deploy carries the programme as it is that minute;
// anywhere else it does nothing, so a local build never rewrites the pages under you.
// A pull that fails never fails the build: the committed files are used and a line says so.
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const ciOnly = args.includes('--ci-only')
if (ciOnly && !process.env.CF_PAGES && !process.env.PULL_PROGRAMME) {
  console.log('[sync-programme] not a Pages build: the committed programme is used (run npm run sync:programme to refresh it)')
  process.exit(0)
}
const pass = args.filter((a) => a !== '--ci-only')
const run = (script, extra = []) => spawnSync(process.execPath, [script, ...extra], { stdio: 'inherit' })
const pull = run('scripts/pull-programme.mjs', pass)
if (pull.status !== 0) {
  console.log('[sync-programme] the programme could not be pulled; the committed files stand')
  process.exit(0)
}
for (const script of ['scripts/gen-schedule.mjs', 'scripts/gen-speakers.mjs']) {
  const r = run(script)
  if (r.status !== 0) { console.log(`[sync-programme] ${script} failed`); process.exit(ciOnly ? 0 : 1) }
}
console.log('[sync-programme] the website now shows the programme as the app holds it')
