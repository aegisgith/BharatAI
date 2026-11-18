import { Hono } from 'hono'
import { pokeSiteBuild } from './conference'

// ==================== EXHIBITOR LOGOS AND TALK PHOTOS FROM ADMIN (18 Nov 2026) ====================
//
// The organiser: "we should be able to upload the logo of exhibitor from admin as well and
// it should be updated on app and website. delete, edit all options", and the same for an
// Innovation Talk speaker's photo and topic.
//
// - POST   /api/admin/exhibitors/:id/logo          { image: data URL } -> exhibitors.logo_url
// - DELETE /api/admin/exhibitors/:id/logo          clears it
// - POST   /api/admin/innovation-talks/:id/photo   { image: data URL } -> speaker_photo_url
//
// The app reads these columns directly. The website follows on its next build:
// scripts/gen-exhibitor-logos.mjs --from-app and scripts/gen-innovation-talks.mjs
// --from-app (run by scripts/sync-programme.mjs) draw the exhibitor wall and the talk
// cards from the app, baking a copy of an uploaded file. Every Admin write to an
// exhibitor or a talk asks for that build (pokeSiteBuild: a Pages deploy hook, at most
// once in ten minutes, when the secret SITE_BUILD_HOOK is set).
//
// A company added in Admin also gets an exhibitor_team_settings row, the mark the app's
// public exhibitor list (DIRECTORY_SHOWN_SQL) looks for; without it a company typed into
// Admin never showed anywhere.
//
// Mounted after the /api/admin/* guard and before the routes in index.tsx, so its
// middleware sees their answers.

type Hooks = { audit?: (c: any, action: string, kind: string, id: any, detail: any) => Promise<any> }
let hooks: Hooks = {}
export function configureExhibitorMedia(h: Hooks) { hooks = { ...hooks, ...h } }

const em = new Hono<{ Bindings: any }>()

const siteChanged = (c: any) => { try { c.executionCtx.waitUntil(pokeSiteBuild(c)) } catch { /* no execution context in a test */ } }

for (const path of ['/api/admin/exhibitors', '/api/admin/exhibitors/*', '/api/admin/innovation-talks', '/api/admin/innovation-talks/*']) {
  em.use(path, async (c, next) => {
    await next()
    if (c.req.method === 'GET' || !c.res || c.res.status >= 300) return
    if (c.req.method === 'POST' && c.req.path === '/api/admin/exhibitors') {
      try {
        const j = await c.res.clone().json() as any
        if (Number(j?.id)) await c.env.DB.prepare('INSERT OR IGNORE INTO exhibitor_team_settings (exhibitor_id) VALUES (?)').bind(Number(j.id)).run()
      } catch { /* before migration 0050 the list shows everyone anyway */ }
    }
    siteChanged(c)
  })
}

// A logo or photo as the Admin screen sends it: a data URL, JPEG, PNG or WebP, up to 2 MB.
function readImage(b: any): { bytes: Uint8Array; type: string; ext: string } | { error: string; status: number } {
  const m = String(b?.image || '').match(/^data:(image\/(jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/)
  if (!m) return { error: 'Choose a JPEG, PNG or WebP image.', status: 400 }
  const bin = atob(m[3])
  if (bin.length > 2 * 1024 * 1024) return { error: 'That image is larger than 2 MB. Choose a smaller one.', status: 413 }
  if (bin.length < 200) return { error: 'That file is too small to be an image.', status: 400 }
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { bytes, type: m[1], ext: m[2] === 'jpeg' ? 'jpg' : m[2] }
}

async function store(c: any, folder: string, id: number, b: any): Promise<{ url: string } | { error: string; status: number }> {
  if (!c.env.UPLOADS) return { error: 'File storage is not set up on this server, so the image was not saved.', status: 503 }
  const img = readImage(b)
  if ('error' in img) return img
  const key = folder + '/' + id + '-' + Date.now() + '.' + img.ext
  await c.env.UPLOADS.put(key, img.bytes, { httpMetadata: { contentType: img.type, cacheControl: 'public, max-age=31536000' } })
  return { url: '/api/uploads/' + key }
}

// Only a file this screen uploaded is removed from storage; a site file stays.
async function forget(c: any, prevUrl: string, folder: string) {
  const prev = prevUrl.replace(/^https?:\/\/[^/]+/, '')
  if (prev.startsWith('/api/uploads/' + folder + '/')) { try { await c.env.UPLOADS.delete(prev.slice('/api/uploads/'.length)) } catch { /* an orphan file costs nothing */ } }
}

em.post('/api/admin/exhibitors/:id/logo', async (c) => {
  const id = Number(c.req.param('id'))
  const ex = await c.env.DB.prepare('SELECT id, company_name, logo_url FROM exhibitors WHERE id = ?').bind(id).first() as any
  if (!ex) return c.json({ error: 'That exhibitor is not on the list any more.' }, 404)
  const r = await store(c, 'exhibitors', id, await c.req.json().catch(() => ({})))
  if ('error' in r) return c.json({ error: r.error }, r.status as any)
  // A full address: the app's exhibitor card shows a logo only through safeUrl (http/https).
  const url = new URL(c.req.url).origin + r.url
  await c.env.DB.prepare('UPDATE exhibitors SET logo_url = ? WHERE id = ?').bind(url, id).run()
  await forget(c, String(ex.logo_url || ''), 'exhibitors')
  if (hooks.audit) await hooks.audit(c, 'exhibitor.logo', 'exhibitor', id, { company_name: ex.company_name })
  return c.json({ success: true, logo_url: url })
})

em.delete('/api/admin/exhibitors/:id/logo', async (c) => {
  const id = Number(c.req.param('id'))
  const ex = await c.env.DB.prepare('SELECT id, company_name, logo_url FROM exhibitors WHERE id = ?').bind(id).first() as any
  if (!ex) return c.json({ error: 'That exhibitor is not on the list any more.' }, 404)
  await c.env.DB.prepare("UPDATE exhibitors SET logo_url = '' WHERE id = ?").bind(id).run()
  await forget(c, String(ex.logo_url || ''), 'exhibitors')
  if (hooks.audit) await hooks.audit(c, 'exhibitor.logo_removed', 'exhibitor', id, { company_name: ex.company_name })
  return c.json({ success: true })
})

em.post('/api/admin/innovation-talks/:id/photo', async (c) => {
  const id = Number(c.req.param('id'))
  const t = await c.env.DB.prepare('SELECT id, speaker_name, company, speaker_photo_url FROM innovation_talks WHERE id = ?').bind(id).first() as any
  if (!t) return c.json({ error: 'That talk is not on the list any more.' }, 404)
  const r = await store(c, 'talks', id, await c.req.json().catch(() => ({})))
  if ('error' in r) return c.json({ error: r.error }, r.status as any)
  await c.env.DB.prepare('UPDATE innovation_talks SET speaker_photo_url = ? WHERE id = ?').bind(r.url, id).run()
  await forget(c, String(t.speaker_photo_url || ''), 'talks')
  if (hooks.audit) await hooks.audit(c, 'italk.photo', 'innovation_talk', id, { speaker_name: t.speaker_name, company: t.company })
  return c.json({ success: true, photo_url: r.url })
})

export default em
