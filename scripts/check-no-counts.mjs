// Post-build guard: no live headcount may ship inside the served bundle.
//
// WHY THIS EXISTS. The whole client-side app and the whole admin panel are built
// as TypeScript template literals. Anything written inside one of those literals
// is string content, not source - so a `//` comment in there is NOT stripped by
// the bundler. It is served, verbatim, to anyone who opens View Source on /app or
// /admin. Both of those pages are public; only their APIs are guarded.
//
// That is how the exact registration total, the pass-tier split, the photo count
// and the incomplete-profile count all ended up published in code comments, while
// the product deliberately withholds that number until it crosses
// PUBLIC_COUNT_THRESHOLD. It is an easy mistake to repeat - two of the four
// offending comments were written on the same day this check was added - and it
// is invisible in review, because the source looks like an ordinary comment.
//
// The rule: a comma-formatted or tilde-approximated number near a people-word is
// a headcount and must not be in the bundle. Put it in a `//` comment OUTSIDE the
// template literal instead, where esbuild strips it.

import { readFileSync, existsSync } from 'node:fs'

const BUNDLE = 'dist/_worker.js'
if (!existsSync(BUNDLE)) {
  console.error(`[check-no-counts] ${BUNDLE} not found - run the build first.`)
  process.exit(1)
}

const src = readFileSync(BUNDLE, 'utf8')

// A number that reads like a population: 1,363 / ~1,000 / 1,279.
//
// The lookarounds are what keep this usable. Without them the same shape matches
// rgba(255,255,255,0.06), slice(0,300) and every colour and byte cap in the file:
//   - not preceded by a digit, comma, dot or "(" -> skips the 2nd/3rd channel of
//     an rgba() and anything already inside a numeric argument list
//   - a leading 1-9 -> skips slice(0,300) and friends
//   - not followed by a digit or comma -> skips the 1st channel of an rgba()
const NUMBER = String.raw`(?<![\d,.(])~?[1-9]\d{0,2},\d{3}(?![\d,])`
// Words that make such a number a headcount rather than a price or a timeout.
const SUBJECT = String.raw`attendees?|people|persons?|records?|rows?|profiles?|registrations?|registered|signed up|delegates?|visitors?`
// Money is the main legitimate use of comma-formatted numbers in this codebase
// (booth rates, invoices), so anything quoting rupees is allowed through.
const MONEY = /(?:Rs|INR|₹|&#8377;|&#x20B9;|sqm|sq ft|GST|per hour|\/hr|price|invoice|amount)/i

const WINDOW = 90
const rx = new RegExp(`(?:(${SUBJECT})[^\\n]{0,${WINDOW}}?(${NUMBER}))|(?:(${NUMBER})[^\\n]{0,${WINDOW}}?(${SUBJECT}))`, 'gi')

const hits = []
for (const m of src.matchAll(rx)) {
  const from = Math.max(0, m.index - 70)
  const context = src.slice(from, m.index + m[0].length + 70).replace(/\s+/g, ' ')
  if (MONEY.test(context)) continue
  hits.push(context)
}

const unique = [...new Set(hits)]

if (unique.length) {
  console.error('\n[check-no-counts] A live headcount is about to ship to the browser.\n')
  for (const h of unique.slice(0, 20)) console.error('  ...' + h.slice(0, 170) + '...')
  if (unique.length > 20) console.error(`  ...and ${unique.length - 20} more`)
  console.error(`
  These strings are inside a page template literal, so they are served to anyone
  who views source on /app or /admin - both public pages. The app deliberately
  withholds the registration count until it crosses PUBLIC_COUNT_THRESHOLD.

  Fix: remove the figure from the comment, or move the comment OUTSIDE the
  template literal (a // comment in ordinary TypeScript is stripped by the build).
  If the match is a false positive - a price, a capacity, a byte size - mention
  the unit (Rs, sqm, GST) in the same sentence and it will be allowed through.
`)
  process.exit(1)
}

console.log('[check-no-counts] no headcount found in the served bundle')
