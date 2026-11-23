// "Powered by IDFC FIRST Bank" and the partners' logos above the footer of every Mumbai
// 2026 page of the site (the organiser, 23 Nov 2026: "sponsors need to see the post
// event visibility on all emails and all landing pages").
//
//   node scripts/gen-partners-strip.mjs           write the block into the pages
//   node scripts/gen-partners-strip.mjs --check   fail if a page is out of date
//
// The block is drawn by partnersStripHTML() in src/lib/partners.ts from
// src/data/partners.json, the same list the emails and the app use. It sits between
//   <!-- partners-strip:start --> ... <!-- partners-strip:end -->
// put just before the page's <footer> the first time (feedback.html, which has no footer,
// carries the markers by hand after </main>). Never hand-edit between the markers.
//
// Left out on purpose: index.html (its own partners section and the Powered-by line in
// the hero), the Delhi 2027 pages (another edition: its sponsors are not these), the
// redirect pages, 404 and live.html (the hall screen).
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const { build } = createRequire(join(ROOT, 'package.json'))('esbuild')
const out = await build({ entryPoints: [join(ROOT, 'src/lib/partners.ts')], bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent' })
const { partnersStripHTML } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))

export const PAGES = [
  'about', 'accommodation', 'ai-readiness', 'campus-djsanghvi', 'campus-jnu', 'campus-series', 'code-of-conduct',
  'conference', 'exhibition', 'feedback', 'gallery', 'government', 'insights', 'networking', 'partner', 'past-speakers',
  'privacy', 'refund', 'share', 'shipping', 'terms', 'training-workshop',
]
const START = '<!-- partners-strip:start -->', END = '<!-- partners-strip:end -->'
const check = process.argv.includes('--check')
const block = (eol) => [START, partnersStripHTML('/'), END].join(eol)

let stale = 0
for (const name of PAGES) {
  const file = join(ROOT, 'public', name + '.html')
  const src = readFileSync(file, 'utf8')
  const eol = src.includes('\r\n') ? '\r\n' : '\n'
  const want = block(eol).replace(/\r?\n/g, eol)
  let next
  const a = src.indexOf(START), b = src.indexOf(END)
  if (a >= 0 && b > a) next = src.slice(0, a) + want + src.slice(b + END.length)
  else {
    const f = src.search(/^[ \t]*<footer\b/m)
    if (f < 0) { console.error(`[partners-strip] ${name}.html has neither the markers nor a <footer>`); process.exitCode = 1; continue }
    next = src.slice(0, f) + want + eol + src.slice(f)
  }
  if (next === src) continue
  stale++
  if (check) console.error(`[partners-strip] ${name}.html is out of date: run node scripts/gen-partners-strip.mjs`)
  else { writeFileSync(file, next); console.log(`[partners-strip] wrote ${name}.html`) }
}
if (check && stale) process.exitCode = 1
else if (check) console.log(`[partners-strip] all ${PAGES.length} pages carry the current partners`)
