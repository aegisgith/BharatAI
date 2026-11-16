import { Hono } from 'hono'
import { publicProgramme, siteLiveOn } from './conference'
// @ts-ignore: plain JavaScript shared with the build-time generators (scripts/gen-schedule.mjs).
import { programmeFromApp, makeDirectory, resolvePeople, renderConference, renderSpeakers, fillBlock, fillFaq, hasBlock, slugOf, norm } from '../../scripts/lib/programme.mjs'
import PEOPLE from '../../scripts/data/schedule-people.json'
import TRACKS from '../../scripts/data/tracks.json'
import TALKS from '../../scripts/data/innovation-talks.json'
import MANIFEST from '../../public/images/sched/manifest.json'

// ==================== THE WEBSITE, LIVE FROM THE APP (16 Nov 2026) ====================
//
// The organiser: "any speaker or panel discussion update in app should be reflected on
// front end website automatically". Until now /conference was a static page written by
// a generator from a hand-kept JSON, so the team's work in Admin -> Conference never
// reached it.
//
// Now the Worker answers GET /conference: it takes the static page (the template, built
// from the last pull of the programme) and rewrites its schedule, its Tracks, its FAQ
// sentence on tracks and its speaker grids from D1, with the same code the generator
// uses (scripts/lib/programme.mjs). Cached for a minute per edge location. Anything
// that fails falls back to the static page, so the website is never worse than before.
//
// Pictures: the generator bakes a small photo and logo for everyone it knew at build
// time and lists them in public/images/sched/manifest.json; someone added in Admin since
// shows with their full photo (the app's own file) until the next build.
//
// The switch: app_settings.site_live_conference = 'on' (set by the organiser's SQL of
// 16 Nov 2026, once the app held the website's agenda). Anything else serves the static
// page as it was built, so the website is never behind until the app is ahead.

const CACHE_SECONDS = 60
const live = new Hono<{ Bindings: any }>()

const lfOnly = (t: string) => t.split('\r').join('')

// The static page as Cloudflare Pages holds it. The asset binding may answer the clean
// URL, or redirect it; either way the file is what we want.
async function staticPage(c: any): Promise<Response | null> {
  if (!c.env?.ASSETS) return null
  const origin = new URL(c.req.url).origin
  for (const path of ['/conference', '/conference.html']) {
    try {
      let r = await c.env.ASSETS.fetch(new Request(origin + path))
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) r = await c.env.ASSETS.fetch(new Request(new URL(r.headers.get('location')!, origin).toString()))
      if (r.ok) return r
    } catch { /* try the other spelling */ }
  }
  return null
}

const talkJsonByName = new Map<string, any>()
const talkJsonByCo = new Map<string, any>()
for (const t of TALKS as any[]) { if (!talkJsonByName.has(norm(t.name))) talkJsonByName.set(norm(t.name), t); if (!talkJsonByCo.has(t.company)) talkJsonByCo.set(t.company, t) }
const photos: Record<string, any> = (MANIFEST as any).photos || {}
const logos: Record<string, any> = (MANIFEST as any).logos || {}
// Who is who for the pictures: the directory, then the exhibitors' presenters (an
// exhibitor's speaker who also talks in a hall), as far as the manifest has their pictures.
function directoryWithTalks() {
  const directory = makeDirectory((PEOPLE as any).people)
  for (const t of TALKS as any[]) {
    const k = norm(t.name)
    if (!k || directory.has(k)) continue
    const logo = [t.logoFile, `images/exhibitors/${slugOf(t.company)}.webp`].find((f) => f && logos[f]) || ''
    directory.set(k, { name: t.name, role: t.title || '', org: t.company, photo: photos[t.slug] ? `images/talks/${t.slug}.webp` : '', logo })
  }
  return directory
}

// Where an exhibitor speaker's photo and the company's logo are, as far as the manifest
// knows; a photo the app holds is used as it is.
function talkFiles(talk: any) {
  const j = talkJsonByName.get(norm(talk.name)) || talkJsonByCo.get(talk.company)
  const slug = talk.slug || j?.slug || slugOf(talk.name)
  const photo = photos[slug] ? `images/talks/${slug}.webp` : String(talk.photo || '').replace(/^\/(?!api\/)/, '')
  const logoFile = [talk.logoFile, j?.logoFile, `images/exhibitors/${slugOf(talk.company)}.webp`].find((f) => f && logos[f]) || ''
  return { photo, logo: logoFile, crop: null }
}
const pictures = (p: any) => {
  const baked = photos[p.slug]
  const thumb = baked ? baked : p.photo ? { src: /^\//.test(p.photo) || /^https?:/.test(p.photo) ? p.photo : '/' + p.photo, w: 144, h: 144 } : null
  const mark = p.logo && logos[p.logo] ? logos[p.logo] : null
  return { thumb, mark }
}

// Renders the page from the programme. Exported so the tests can run it without an edge.
export function renderLivePage(template: string, programme: any): string {
  const S = programmeFromApp(programme)
  const directory = directoryWithTalks()
  resolvePeople(S, { directory, talkFiles, onDisk: (f: string) => !!f })
  const r = renderConference(S, { tracks: (TRACKS as any).tracks, pictures })
  const eol = template.includes('\r\n') ? '\r\n' : '\n'
  let out = lfOnly(template)
  out = fillBlock(out, 'schedule', r.schedule)
  out = fillBlock(out, 'tracks', r.tracks)
  out = fillFaq(out, r.faq)
  if (hasBlock(out, 'speakers')) {
    const byNorm = new Map<string, any>(((PEOPLE as any).people as any[]).map((p) => [norm(p.name), p]))
    const grids = renderSpeakers(programme.speakers, {
      photoOf: (sp: any) => (sp.photo_url ? { src: sp.photo_url, w: 400, h: 400 } : null),
      logoOf: (sp: any) => { const d = byNorm.get(norm(sp.name)); const l = d?.logo && logos[d.logo]; return l ? { src: l.src, w: l.w, h: l.h } : null },
    })
    out = fillBlock(out, 'speakers', grids.conference)
  }
  return out.replace(/\n/g, eol)
}

live.get('/conference', async (c) => {
  const page = await staticPage(c)
  if (!page) return c.notFound()
  if (!(await siteLiveOn(c))) return page
  const key = new Request(new URL(c.req.url).origin + '/conference', { method: 'GET' })
  let cache: Cache | null = null
  try { cache = (caches as any).default || null } catch { cache = null }
  if (cache) { try { const hit = await cache.match(key); if (hit) return hit } catch { /* no cache here */ } }
  try {
    const [template, programme] = await Promise.all([page.text(), publicProgramme(c, 1)])
    const html = renderLivePage(template, programme)
    const res = new Response(html, { status: 200, headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': `public, max-age=${CACHE_SECONDS}`,
      'X-Programme': 'live ' + programme.generated_at,
    } })
    if (cache) { try { c.executionCtx.waitUntil(cache.put(key, res.clone())) } catch { /* a test has no execution context */ } }
    return res
  } catch (e: any) {
    // The static page, as it was built: never a blank conference page.
    const fallback = await staticPage(c)
    if (!fallback) return c.text('The conference page is not available right now.', 503)
    const h = new Headers(fallback.headers); h.set('X-Programme', 'static (' + String(e?.message || e).slice(0, 80) + ')')
    return new Response(fallback.body, { status: 200, headers: h })
  }
})

export default live
