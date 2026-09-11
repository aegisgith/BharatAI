// Parses the inline <script> of every page the worker serves.
//
// This exists because of an outage. A `\'` written inside one of the *PageHTML
// template literals is consumed by the template literal itself, so the source
// looks right, tsc is happy, vite builds, and the emitted page contains
// `onclick="f('' + x + '')"` — a SyntaxError that kills the ENTIRE inline script.
// Not one handler: the whole app. Sign-in, tabs, everything, on every page that
// block serves. Nothing in the build caught it and nothing could, because the
// broken string is only assembled when the page is rendered.
//
// So the check renders the pages the way a browser gets them and parses what
// comes back. It needs no database: these routes return HTML before touching D1.
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const PAGES = ['/app', '/admin']
const worker = (await import('../dist/_worker.js')).default

// Enough of an environment to render HTML. Anything that reaches for D1 or R2
// here is a bug in its own right — these routes must not need them.
const env = new Proxy({}, { get: () => undefined })
const ctx = { waitUntil() {}, passThroughOnException() {} }

let failed = 0
for (const path of PAGES) {
  let html
  try {
    const res = await worker.fetch(new Request('https://bharataiinnovation.com' + path), env, ctx)
    html = await res.text()
  } catch (e) {
    console.error(`[check-inline-js] ${path} did not render: ${e.message}`)
    failed++
    continue
  }

  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)]
  let checked = 0
  for (const [, attrs, body] of blocks) {
    // JSON-LD and friends are data, not script.
    if (/type\s*=\s*["'](?!text\/javascript|module)/i.test(attrs)) continue
    if (!body.trim()) continue
    try {
      new vm.Script(body)
      checked++
    } catch (e) {
      const line = Number((/(\d+)/.exec(e.stack?.split('\n')[0] ?? '') || [])[1])
      const near = body.split('\n')[(line || 1) - 1] ?? ''
      console.error(`[check-inline-js] ${path}: ${e.message}`)
      console.error(`   near: ${near.trim().slice(0, 140)}`)
      failed++
    }
  }
  if (!failed) console.log(`[check-inline-js] ${path}: ${checked} inline block(s) parse`)
}

if (failed) {
  console.error('[check-inline-js] FAILED — a page would ship with dead JavaScript.')
  process.exit(1)
}
