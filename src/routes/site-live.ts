import { Hono } from 'hono'
import { publicProgramme, siteLiveOn } from './conference'
// @ts-ignore: plain JavaScript shared with the build-time generators (scripts/gen-schedule.mjs).
import { programmeFromApp, makeDirectory, resolvePeople, renderConference, renderSpeakers, fillBlock, fillFaq, fillPerformers, hasBlock, slugOf, norm } from '../../scripts/lib/programme.mjs'
// @ts-ignore: plain JavaScript shared with scripts/gen-exhibitor-logos.mjs and scripts/gen-innovation-talks.mjs.
import { slugOf as exSlug, byName, matchWall, sizeWall, renderWall, fillWall, talksFromApp, talkLogoFiles, sizeTalkLogo, renderTalks, fillTalks, imageSize, same, key, sitePath } from '../../scripts/lib/exhibit-site.mjs'
// @ts-ignore: the exhibitor looks, plain JavaScript.
import { EXHIBITORS, MEDIA_PARTNER } from '../../scripts/data/exhibitor-looks.mjs'
import PEOPLE from '../../scripts/data/schedule-people.json'
import TRACKS from '../../scripts/data/tracks.json'
import TALKS from '../../scripts/data/innovation-talks.json'
import MANIFEST from '../../public/images/sched/manifest.json'
import IMAGES from '../../scripts/data/site-images.json'

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
async function staticPage(c: any, paths: string[] = ['/conference', '/conference.html']): Promise<Response | null> {
  if (!c.env?.ASSETS) return null
  const origin = new URL(c.req.url).origin
  for (const path of paths) {
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
  const r = renderConference(S, { tracks: (TRACKS as any).tracks, pictures, logoOf: (f: string) => logos[f] || null })
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
    // The Innovation Talk cards too (18 Nov 2026): photos and logos as the app holds them.
    let html = renderLivePage(template, programme)
    try { if (!(await livePagesOff(c))) { const ex = siteHooks.exhibitors ? await siteHooks.exhibitors(c).catch(() => null) : null; html = await drawLivePage(c, html, [fillTalkCards('conference')], { programme, shown: ex?.shown || null, companies: ex?.all || [] }) } } catch { /* the cards as built */ }
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

// ==================== THE EXHIBITOR WALL AND TALK CARDS, LIVE (18 Nov 2026) ====================
//
// The organiser, when a logo and a talk photo uploaded in Admin never reached the
// website: "if we update upload photos logos, any thing it needs to update". The wall
// and the cards were written only when the website was rebuilt, and nothing asked for
// a rebuild (the secret SITE_BUILD_HOOK was never set). Now the Worker answers
// /exhibition, the home page and /partner, and fills /conference's talk cards, from D1
// on every request, with the generators' own markup (scripts/lib/exhibit-site.mjs):
// - the exhibitor wall: the app's public exhibitor list, each logo an Admin upload (its
//   baked copy once a build has made one) or the site's own file;
// - the Innovation Talk cards: the app's talks, each photo the talk's own or, failing
//   that, the one on the speaker's pass (withTalkPhotos), each logo the company's
//   Admin upload or the wall's file;
// - the home page's speaker grid, as /conference's.
// A page is kept for a minute at each edge location, then redrawn while the kept copy
// is still served, so no visitor waits on the database. Anything that fails serves the
// static page as it was built. app_settings.site_live_pages = 'off' turns it all off.

type SiteHooks = { exhibitors?: (c: any) => Promise<{ shown: any[] | null; all: any[] }> }
let siteHooks: SiteHooks = {}
export function configureSiteLive(h: SiteHooks) { siteHooks = { ...siteHooks, ...h } }

const DIMS: Record<string, [number, number]> = (IMAGES as any).dims || {}
const BAKED: Record<string, string> = (IMAGES as any).baked || {}
const dimsOf = (f: string): { w: number; h: number } | null => { const d = DIMS[String(f || '').replace(/^\//, '')]; return d ? { w: d[0], h: d[1] } : null }
// A baked copy keeps its file name when a new upload replaces it, and phones keep /images
// files for a day (public/_headers): the upload's own number makes each copy a new address.
const bakedSrc = (file: string, upload: string) => file + '?v=' + ((String(upload).match(/(\d{6,})(?!.*\d{6,})/) || [])[1] || String(upload.length))

// An upload's size, from the first 64 KB of the file in the bucket.
async function uploadSize(c: any, url: string): Promise<{ w: number; h: number } | null> {
  const k = url.replace(/^\/api\/uploads\//, '')
  if (k === url || !c.env?.UPLOADS) return null
  try {
    const obj = await c.env.UPLOADS.get(k, { range: { offset: 0, length: 65536 } })
    if (!obj) return null
    const s = imageSize(new Uint8Array(await obj.arrayBuffer()))
    return s && s.w > 0 && s.h > 0 ? s : null
  } catch { return null }
}

// A logo as the app holds it: the baked copy of an upload, the upload itself, or a site file.
async function logoFrom(c: any, url: string): Promise<{ src: string; w: number; h: number } | null> {
  const u = sitePath(url)
  if (/^\/api\/uploads\//.test(u)) {
    const b = BAKED[u]
    const d = b ? dimsOf(b) : null
    if (d) return { src: '/' + bakedSrc(b, u), ...d }
    return { src: u, ...((await uploadSize(c, u)) || { w: 300, h: 150 }) }
  }
  if (/^\/images\//.test(u)) { const d = dimsOf(u); return d ? { src: u, ...d } : null }
  return null
}

const looks = () => [...(EXHIBITORS as any[])].sort(byName).map((e: any) => ({ ...e, slug: exSlug(e.name) }))

async function liveWall(c: any, rows: any[]) {
  const { list } = matchWall(rows, looks())
  await Promise.all(list.map(async (e: any) => {
    const l = e.logoUrl ? await logoFrom(c, e.logoUrl) : null
    if (l) { e.src = l.src; e.w = l.w; e.h = l.h; return }
    const d = dimsOf(`images/exhibitors/${e.slug}.webp`)
    if (d) { e.w = d.w; e.h = d.h }
  }))
  list.sort(byName)
  sizeWall(list)
  const mslug = exSlug((MEDIA_PARTNER as any).name)
  return renderWall(list, { ...(MEDIA_PARTNER as any), slug: mslug, ...(dimsOf(`images/exhibitors/${mslug}.webp`) || {}) })
}

async function liveTalks(c: any, programme: any, companies: any[]) {
  const talks = talksFromApp(programme.talks || [], TALKS as any[])
  const lk = looks()
  await Promise.all(talks.map(async (t: any) => {
    // The talk's photo (or the one on the speaker's pass), its baked copy when a build
    // made one, else the site's own file for this speaker.
    const p = String(t.photoSrc || '')
    let photo = ''
    if (/^api\/uploads\//.test(p)) { const b = BAKED['/' + p]; photo = b && dimsOf(b) ? bakedSrc(b, p) : '/' + p }
    else if (/^https?:\/\//.test(p)) photo = p
    else if (p && dimsOf(p)) photo = p
    if (!photo && dimsOf(`images/talks/${t.slug}.webp`)) photo = `images/talks/${t.slug}.webp`
    t.photoSrc = photo
    // The company's logo uploaded in Admin first, then the wall's file.
    const row = companies.find((r: any) => /\/api\/uploads\//.test(String(r.logo_url || '')) && same(key(r.company_name), key(t.company)))
    let logo = row ? await logoFrom(c, row.logo_url) : null
    if (!logo) { const f = talkLogoFiles(t, lk).find((x: string) => dimsOf(x)); const d = f ? dimsOf(f) : null; if (f && d) logo = { src: f, ...d } }
    if (logo) sizeTalkLogo(t, { file: logo.src, w: logo.w, h: logo.h })
  }))
  return renderTalks(talks)
}

function homeSpeakers(src: string, programme: any): string {
  if (!hasBlock(src, 'speakers')) return src
  const directory = makeDirectory((PEOPLE as any).people)
  const photoOf = (sp: any) => {
    const u = String(sp.photo_url || '')
    if (!u) return null
    if (/^\/api\//.test(u)) { const b = BAKED[u]; const d = b ? dimsOf(b) : null; return d ? { src: bakedSrc(b, u), ...d } : { src: u, w: 400, h: 400 } }
    if (/^https?:/.test(u)) return { src: u, w: 400, h: 400 }
    const f = u.replace(/^\//, '')
    return { src: f, ...(dimsOf(f) || { w: 400, h: 400 }) }
  }
  const logoOf = (sp: any) => { const f = directory.get(norm(sp.name))?.logo; const d = f ? dimsOf(f) : null; return d ? { src: f, ...d } : null }
  const r = renderSpeakers(programme.speakers || [], { photoOf, logoOf })
  return fillPerformers(fillBlock(src, 'speakers', r.home), r.performers)
}

async function livePagesOff(c: any): Promise<boolean> {
  try { const r = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'site_live_pages'").first() as any; return String(r?.value || '').trim().toLowerCase() === 'off' } catch { return false }
}

// What the live pages are drawn from, read once per drawing.
async function liveData(c: any) {
  const [programme, ex] = await Promise.all([
    publicProgramme(c, 1),
    siteHooks.exhibitors ? siteHooks.exhibitors(c).catch(() => null) : Promise.resolve(null),
  ])
  return { programme, shown: ex?.shown || null, companies: ex?.all || [] }
}

// The blocks each page carries, filled on LF text. A block a page lacks is skipped.
type Fill = (c: any, src: string, d: any) => Promise<string>
const fillExhibitionWall: Fill = async (c, src, d) => (d.shown && d.shown.length && src.includes('<!-- exhibitors:start') ? fillWall(src, (await liveWall(c, d.shown)).grid) : src)
const fillHomeWall: Fill = async (c, src, d) => (d.shown && d.shown.length && src.includes('<!-- exhibitors:start') ? fillWall(src, (await liveWall(c, d.shown)).home) : src)
const fillTalkCards = (which: 'exhibition' | 'conference'): Fill => async (c, src, d) => {
  if (!d.programme.live || !(d.programme.talks || []).length || !src.includes('<!-- talks:start')) return src
  return fillTalks(src, (await liveTalks(c, d.programme, d.companies))[which])
}
const fillHomeSpeakers: Fill = async (_c, src, d) => (d.programme.live && (d.programme.speakers || []).length ? homeSpeakers(src, d.programme) : src)

// Exported so the tests can draw a page without an edge.
export async function drawLivePage(c: any, template: string, fills: Fill[], data?: any): Promise<string> {
  const d = data || await liveData(c)
  const eol = template.includes('\r\n') ? '\r\n' : '\n'
  let out = lfOnly(template)
  for (const f of fills) out = await f(c, out, d)
  return out.replace(/\n/g, eol)
}

const FRESH_MS = 60 * 1000
const toBrowser = (r: Response, state: string) => {
  const h = new Headers(r.headers)
  h.set('Cache-Control', 'public, max-age=0, must-revalidate')
  h.set('X-Site-Live', state)
  return new Response(r.body, { status: 200, headers: h })
}

async function serveLive(c: any, path: string, files: string[], fills: Fill[]) {
  const origin = new URL(c.req.url).origin
  const key = new Request(origin + '/__site-live' + path, { method: 'GET' })
  let cache: Cache | null = null
  try { cache = (caches as any).default || null } catch { cache = null }
  const draw = async (): Promise<Response | null> => {
    const page = await staticPage(c, files)
    if (!page) return null
    try {
      if (await livePagesOff(c)) return null
      const html = await drawLivePage(c, await page.text(), fills)
      const h = new Headers(page.headers)
      for (const k of ['content-length', 'content-encoding', 'etag', 'last-modified']) h.delete(k)
      h.set('Content-Type', 'text/html; charset=utf-8')
      // Kept a day at the edge; served fresh for a minute, then redrawn behind the scenes.
      h.set('Cache-Control', 'public, max-age=86400')
      h.set('X-Rendered-At', String(Date.now()))
      return new Response(html, { status: 200, headers: h })
    } catch { return null }
  }
  const keep = (r: Response) => { if (cache) { try { c.executionCtx.waitUntil(cache.put(key, r)) } catch { /* a test has no execution context */ } } }
  if (cache) {
    try {
      const hit = await cache.match(key)
      if (hit) {
        if (Date.now() - Number(hit.headers.get('X-Rendered-At') || 0) > FRESH_MS) {
          try { c.executionCtx.waitUntil(draw().then((r) => (r && cache ? cache.put(key, r) : undefined)).catch(() => undefined)) } catch { /* no execution context */ }
        }
        return toBrowser(hit, 'live (kept)')
      }
    } catch { /* no cache here */ }
  }
  const fresh = await draw()
  if (fresh) { keep(fresh.clone()); return toBrowser(fresh, 'live') }
  const page = await staticPage(c, files)
  if (!page) return c.notFound()
  return toBrowser(page, 'static')
}

live.get('/exhibition', (c) => serveLive(c, '/exhibition', ['/exhibition', '/exhibition.html'], [fillExhibitionWall, fillTalkCards('exhibition')]))
live.get('/partner', (c) => serveLive(c, '/partner', ['/partner', '/partner.html'], [fillHomeWall]))
live.get('/', (c) => serveLive(c, '/', ['/', '/index.html'], [fillHomeWall, fillHomeSpeakers]))

export default live
