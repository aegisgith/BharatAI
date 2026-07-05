// Post-build: generate dist/_routes.json for Cloudflare Pages.
//
// Why this exists: @hono/vite-build's cloudflare-pages plugin only writes
// _routes.json when one doesn't already exist, and it excludes exact
// filenames only (/conference.html) — not the clean-URL form (/conference)
// that Pages also serves. After merging the marketing site into public/, we
// need EVERY static path served by Pages (not intercepted by the Hono
// Worker), including clean URLs. This script writes the file deterministically.
//
// Rule: the Worker (include "/*") handles everything EXCEPT the exclude list.
// We exclude:
//   - every top-level directory in dist/ (assets: css, js, images, img, cdn, static)
//   - every top-level static file (*.html and SEO files)
//   - the extensionless clean-URL twin of every *.html page (/conference, etc.)
// The Hono app keeps owning dynamic routes (/app, /register, /admin, /api/*,
// /marketplace, /contact) because those have no matching static file/dir.

import { readdirSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DIST = 'dist'
const WORKER = '_worker.js'
const ROUTES = '_routes.json'

// Routes the Hono Worker MUST keep handling even though a same-named static
// file exists. /contact and /register are app routes; their marketing stubs
// were intentionally not copied, but guard here in case they reappear.
const FORCE_DYNAMIC = new Set(['/contact', '/register'])

const entries = readdirSync(DIST)
const exclude = new Set()

for (const name of entries) {
  if (name === WORKER || name === ROUTES) continue
  const full = join(DIST, name)
  if (statSync(full).isDirectory()) {
    exclude.add(`/${name}/*`)
  } else {
    exclude.add(`/${name}`)
    // Add the clean-URL twin for HTML pages: /conference.html -> /conference
    if (name.endsWith('.html')) {
      const base = name.slice(0, -'.html'.length)
      // index.html is the site root: exclude "/" so Pages serves the
      // marketing home there instead of the Worker (which no longer has a
      // "/" route — the app landing moved to /app).
      const clean = base === 'index' ? '/' : `/${base}`
      if (!FORCE_DYNAMIC.has(clean)) exclude.add(clean)
    }
  }
}

// Cloudflare Pages allows max 100 exclude rules; we are far under.
const routes = { version: 1, include: ['/*'], exclude: [...exclude].sort() }
writeFileSync(join(DIST, ROUTES), JSON.stringify(routes, null, 2) + '\n')

console.log(`[gen-routes] wrote ${ROUTES} with ${routes.exclude.length} exclude rules`)
