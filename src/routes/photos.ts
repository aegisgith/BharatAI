import { Hono } from 'hono'
import { isProtocol } from './speaker-brief'
import { firstName } from './talk-brief'
import { MUMBAI_WORDS, normName } from './conference'
import ALBUMS from '../data/speaker-photos.json'

// ==================== SPEAKER PHOTOS (23 Nov 2026) ====================
//
// The organiser, after Mumbai: "share relevant photo to exhibitors and speakers,
// innovation talk, participants ... match face and show relevant photos in emails ...
// lets start with speakers". The event photographers' 4,615 photos sit in one Google
// Drive folder by day and camera ("Nov 2026_Bharat AI_Mumbai"), named by camera.
//
// Who is in which photo was worked out once, on the organiser's computer, by matching
// each speaker's photo on the site against every face in the event photos
// (scripts/photos/, OpenCV YuNet + SFace; no face data leaves that computer and none
// is stored here). The result is src/data/speaker-photos.json: for each person, the
// Drive ids of the photos they are in, and the six best for the email.
//
// - GET /photos/:key?k=<sig>  their own page: every photo of them, by day, each one to
//   open large and download full size from Drive. Signed, noindex.
// - Admin -> After the Event -> "Speaker photos" (public/js/admin-after.js): the list,
//   a preview, send one, or send to all not yet sent. One email per person, from the
//   event's address. A person who is both a conference speaker and an Innovation Talk
//   speaker is one row and gets one email. Ministers are held back (their offices
//   handle protocol); { anyway: true } sends to one.
// - Sent = an admin_audit row (action 'speaker.photos', entity 'photo_album', the key).
//
// Photos are shown straight from Google Drive (lh3.googleusercontent.com), so the
// Drive folder must stay "Anyone with the link: Viewer". Every /api/admin/* route here
// is behind the admin middleware in index.tsx.

type Contact = { email: string; source: string; note: string; protocol?: boolean }
type Hooks = {
  sendEmail?: (c: any, to: string, subject: string, html: string) => Promise<{ ok: boolean; error?: string }>
  audit?: (c: any, action: string, entity?: string, entityId?: any, detail?: any) => Promise<void>
  emailHeader?: (title: string, subtitle: string) => string
  // Who to write to for each Innovation Talk (index.tsx italkContactsAll, the same order
  // the talk briefs use: the talk's own speaker email, the team list, the booth contact).
  talkContacts?: (c: any, eventId: number) => Promise<Record<string, Contact>>
}
let hooks: Hooks = {}
export function configurePhotos(h: Hooks) { hooks = { ...hooks, ...h } }

// focus[id] = where their face is in that photo, [percent across, percent down].
// check: no in-person photo matched their site photo strongly (under 0.60), so the
// photos may show a lookalike: Admin leaves them out of "send to all" until looked at.
type Person = { key: string; name: string; speakers: number[]; talks: number[]; photos: string[]; best: string[]; focus?: Record<string, [number, number]>; check?: boolean }
// photos[id] = [day 'YYYY-MM-DD', time 'HH:MM' or '' when unknown, 1 if taken upright, 1 if a camera RAW file]
type Albums = { generated: string; folder: string; photos: Record<string, [string, string, number, number?]>; people: Person[] }
const DATA = ALBUMS as unknown as Albums

const ph = new Hono<{ Bindings: any }>()
const SITE = 'https://bharataiinnovation.com'
export const AUDIT_ACTION = 'speaker.photos'
const all = async (c: any, sql: string, ...args: any[]) => (((await c.env.DB.prepare(sql).bind(...args).all()) as any).results || []) as any[]
const escH = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ---------- pure helpers (scripts/verify/smoke-speaker-photos.mjs checks them) ----------

// Every key a person can be reached by: s<speaker id> and t<talk id>, all to one person.
const BY_KEY = new Map<string, Person>()
for (const p of DATA.people || []) {
  BY_KEY.set(p.key, p)
  for (const id of p.speakers || []) BY_KEY.set('s' + id, p)
  for (const id of p.talks || []) BY_KEY.set('t' + id, p)
}
export function personFor(key: string): Person | null { return BY_KEY.get(String(key || '')) || null }
export function albumPeople(): Person[] { return DATA.people || [] }

// Drive serves any size of a shared photo: =s360-c is a 360px square crop, =w2000 the
// long side 2000px. Download goes through Drive's own download link (the original file),
// except a camera RAW file (.CR3, 114 of them from one camera), which phones cannot open:
// that downloads as Drive's full-size JPEG of it (=s0, 6000 x 4000).
export function thumbUrl(id: string, size = 600): string { return `https://lh3.googleusercontent.com/d/${encodeURIComponent(id)}=s${size}-c` }
export function bigUrl(id: string): string { return `https://lh3.googleusercontent.com/d/${encodeURIComponent(id)}=w2000` }
// The whole photo, not cropped: the email shows it as it is; the page crops it square
// itself, around their face.
export function wideUrl(id: string, width = 600): string { return `https://lh3.googleusercontent.com/d/${encodeURIComponent(id)}=w${width}` }
export function isRaw(id: string): boolean { return !!(DATA.photos[id] && DATA.photos[id][3]) }
export function downloadUrl(id: string): string {
  return isRaw(id) ? `https://lh3.googleusercontent.com/d/${encodeURIComponent(id)}=s0` : `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`
}

const DAY_WORDS: Record<string, string> = { '2026-11-20': 'Friday 20 November', '2026-11-21': 'Saturday 21 November' }

// The photos of one person grouped by day, in the order they were taken.
export function byDay(ids: string[]): { day: string; words: string; ids: string[] }[] {
  const seen = new Set<string>()
  const list = ids.filter(id => DATA.photos[id] && !seen.has(id) && seen.add(id))
  list.sort((a, b) => {
    const x = DATA.photos[a], y = DATA.photos[b]
    return (x[0] + (x[1] || '99:99')).localeCompare(y[0] + (y[1] || '99:99')) || a.localeCompare(b)
  })
  const out: { day: string; words: string; ids: string[] }[] = []
  for (const id of list) {
    const d = DATA.photos[id][0] || ''
    let g = out.find(x => x.day === d)
    if (!g) { g = { day: d, words: DAY_WORDS[d] || 'At the event', ids: [] }; out.push(g) }
    g.ids.push(id)
  }
  return out
}

async function hmacHex(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder()
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const s = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)))
  return Array.from(s.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join('')
}
function secretOf(c: any): string { return String(c.env?.PHOTO_SECRET || c.env?.ADMIN_SECRET || '') }
export async function photoSig(c: any, key: string): Promise<string> {
  const s = secretOf(c)
  return s ? hmacHex(s, 'photos:' + key) : ''
}
export async function pageUrl(c: any, key: string): Promise<string> {
  return `${SITE}/photos/${encodeURIComponent(key)}?k=${await photoSig(c, key)}`
}
function sameText(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

// The email. `forSpeaker` false: it goes to the company's booth contact, who is asked
// to pass it on to the speaker.
export function photosEmailHTML(a: { name: string; count: number; best: string[]; href: string; header: string; talk: boolean;
    forSpeaker: boolean; company?: string }): { subject: string; html: string } {
  const words = MUMBAI_WORDS
  const first = firstName(a.name)
  const n = a.count
  const photosWord = n === 1 ? '1 photo' : `${n} photos`
  const subject = a.forSpeaker ? `Your photos from ${words.name}` : `Photos of ${a.name} from ${words.name}`
  const greeting = a.forSpeaker ? `Dear ${first},` : `Dear ${a.company ? a.company + ' team' : 'team'},`
  const thanks = a.forSpeaker
    ? `Thank you for ${a.talk ? 'your Innovation Talk' : 'speaking'} at ${words.name} in Mumbai. Our photographers took ${photosWord} of you. Here are a few of them.`
    : `Here are the photos of ${a.name} from ${a.talk ? 'their Innovation Talk' : 'their session'} at ${words.name} in Mumbai: ${photosWord} in all. Please pass this email on to ${first}.`
  // Whole photos, two a row: a square crop of a wide panel shot can leave them out of it.
  const pics = a.best.slice(0, 6)
  const cell = (id: string) => `<td width="50%" style="padding:3px;vertical-align:top"><a href="${escH(a.href)}"><img src="${escH(wideUrl(id, 560))}" width="268" alt="Photo of ${escH(a.name)}" style="display:block;width:100%;max-width:268px;height:auto;border:0;border-radius:8px"></a></td>`
  const rows: string[] = []
  for (let i = 0; i < pics.length; i += 2) rows.push('<tr>' + pics.slice(i, i + 2).map(cell).join('') + (pics.length - i === 1 ? '<td width="50%"></td>' : '') + '</tr>')
  const grid = pics.length ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 18px">${rows.join('')}</table>` : ''
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f6f7fb;padding:24px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1e2140">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e7e9f5">
    ${a.header}
    <div style="padding:26px 26px 8px">
      <p style="font-size:15px;line-height:1.65;margin:0 0 14px">${escH(greeting)}</p>
      <p style="font-size:15px;line-height:1.65;margin:0 0 18px">${escH(thanks)}</p>
      ${grid}
      <p style="margin:0 0 20px;text-align:center"><a href="${escH(a.href)}" style="display:inline-block;padding:13px 26px;background:#C84F00;color:#fff;text-decoration:none;border-radius:10px;font-weight:bold;font-size:15px">See and download all ${escH(photosWord)}</a></p>
      <p style="font-size:14px;line-height:1.65;margin:0 0 12px">Each photo downloads at full size. You are welcome to use and share them. If you post them on LinkedIn, please tag Bharat AI Innovation.</p>
      <p style="font-size:13px;line-height:1.6;margin:0 0 12px;color:#6b7280">A computer found these photos by matching faces, so one or two may show someone else. Just skip those.</p>
      <p style="font-size:14px;line-height:1.65;margin:16px 0 0">See you at Bharat AI Innovation, New Delhi: 28 and 29 July 2027 at Bharat Mandapam. <a href="${SITE}/delhi" style="color:#C84F00;font-weight:bold">See the Delhi edition</a></p>
      <p style="margin:22px 0 24px;font-size:14px;color:#555">Team Bharat AI Innovation<br>
        <span style="color:#888">${escH(words.line).replace(' · ', ' &middot; ')}</span></p>
    </div>
  </div></body></html>`
  return { subject, html }
}

// Their page. Everything it needs is in the page: the photo ids sit in a JSON block
// that the small script below reads (no inline handlers, no quotes to escape).
export function albumPageHTML(a: { name: string; org: string; ids: string[]; focus?: Record<string, [number, number]> }): string {
  const groups = byDay(a.ids)
  const total = groups.reduce((n, g) => n + g.ids.length, 0)
  const flat = groups.flatMap(g => g.ids)
  let i = 0
  // Square thumbnails cut from the whole photo around their face, so a wide panel shot
  // still shows them (focus from the match; the middle when it is not known).
  const at = (id: string) => {
    const f = a.focus && a.focus[id]
    const pc = (v: any) => Math.max(0, Math.min(100, Math.round(Number(v))))
    return f && f.length === 2 ? ` style="object-position:${pc(f[0])}% ${pc(f[1])}%"` : ''
  }
  const sections = groups.map(g => `<section><h2>${escH(g.words)} <span>${g.ids.length}</span></h2><div class="grid">${g.ids.map(id => {
    const n = i++
    return `<button type="button" class="ph" data-i="${n}" aria-label="Open photo ${n + 1} of ${total}"><img src="${escH(wideUrl(id, 700))}" alt="" loading="${n < 8 ? 'eager' : 'lazy'}" width="250" height="250"${at(id)}></button>`
  }).join('')}</div></section>`).join('')
  const data = JSON.stringify(flat.map(id => [id, downloadUrl(id)])).replace(/</g, '\\u003c')
  const title = `Photos of ${a.name}`
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${escH(title)} · ${escH(MUMBAI_WORDS.name)}</title>
<link rel="icon" href="/favicon.ico">
<style>
:root{--ink:#1e2140;--sub:#5b6076;--line:#e7e9f5;--bg:#f6f7fb;--brand:#C84F00}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif}
header{background:#fff;border-bottom:1px solid var(--line);padding:18px 16px}
.wrap{max-width:1100px;margin:0 auto}
.brand{font-size:13px;font-weight:700;color:var(--brand);letter-spacing:.3px;text-transform:uppercase;text-decoration:none}
h1{font-size:26px;line-height:1.25;margin:6px 0 4px}
.lead{margin:0;color:var(--sub);font-size:15px;line-height:1.5}
main{padding:8px 16px 40px}
h2{font-size:17px;margin:26px 0 10px}h2 span{color:var(--sub);font-weight:400;font-size:14px;margin-left:4px}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}
@media(min-width:640px){.grid{grid-template-columns:repeat(3,1fr)}}@media(min-width:960px){.grid{grid-template-columns:repeat(4,1fr)}}
.ph{display:block;padding:0;border:0;background:#e9ebf3;border-radius:10px;overflow:hidden;cursor:zoom-in;aspect-ratio:1/1}
.ph img{display:block;width:100%;height:100%;object-fit:cover}
.ph:focus-visible{outline:3px solid var(--brand);outline-offset:2px}
.note{color:var(--sub);font-size:14px;line-height:1.6;margin:28px 0 0}
.note a{color:var(--brand);font-weight:600}
dialog{border:0;padding:0;margin:0;width:100vw;height:100dvh;max-width:100vw;max-height:100dvh;background:#0b0c12}
dialog::backdrop{background:#0b0c12}
.lb{display:flex;flex-direction:column;height:100%}
.lb-top{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;color:#fff;font-size:14px}
.lb-img{flex:1;display:flex;align-items:center;justify-content:center;min-height:0;padding:0 8px}
.lb-img img{max-width:100%;max-height:100%;object-fit:contain}
.lb-bot{display:flex;gap:8px;justify-content:center;padding:12px;flex-wrap:wrap}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 18px;border-radius:10px;border:1px solid rgba(255,255,255,.25);background:transparent;color:#fff;font-size:15px;font-weight:600;text-decoration:none;cursor:pointer}
.btn.main{background:var(--brand);border-color:var(--brand)}
</style></head><body>
<header><div class="wrap"><a class="brand" href="${SITE}/">${escH(MUMBAI_WORDS.name)}</a>
<h1>${escH(title)}</h1>
<p class="lead">${total === 1 ? '1 photo' : total + ' photos'}${a.org ? ' · ' + escH(a.org) : ''} · ${escH(MUMBAI_WORDS.line).replace(' · ', ' &middot; ')}</p></div></header>
<main class="wrap">${sections || '<p class="note">No photos here yet.</p>'}
<p class="note">Tap a photo to see it large and download it at full size. You are welcome to use and share these photos; if you post them on LinkedIn, please tag Bharat AI Innovation.<br>
A computer found these photos by matching faces, so one or two may show someone else.<br>
Next: <a href="${SITE}/delhi">Bharat AI Innovation, New Delhi, 28 and 29 July 2027</a>.</p></main>
<dialog id="lb" aria-label="Photo"><div class="lb">
<div class="lb-top"><span id="lb-n"></span><button type="button" class="btn" data-go="close">Close</button></div>
<div class="lb-img"><img id="lb-img" alt=""></div>
<div class="lb-bot"><button type="button" class="btn" data-go="prev">Previous</button><a class="btn main" id="lb-dl" href="#" rel="noopener">Download full size</a><button type="button" class="btn" data-go="next">Next</button></div>
</div></dialog>
<script type="application/json" id="ids">${data}</script>
<script>
(function(){
  var ids = JSON.parse(document.getElementById('ids').textContent || '[]');
  var lb = document.getElementById('lb'), img = document.getElementById('lb-img'), n = document.getElementById('lb-n'), dl = document.getElementById('lb-dl');
  var at = 0;
  function show(i){
    at = (i + ids.length) % ids.length;
    img.src = 'https://lh3.googleusercontent.com/d/' + encodeURIComponent(ids[at][0]) + '=w2000';
    n.textContent = 'Photo ' + (at + 1) + ' of ' + ids.length;
    dl.href = ids[at][1];
  }
  document.addEventListener('click', function(e){
    var t = e.target.closest ? e.target.closest('[data-i],[data-go]') : null;
    if (!t) return;
    if (t.hasAttribute('data-i')) { show(Number(t.getAttribute('data-i'))); if (lb.showModal) lb.showModal(); else lb.setAttribute('open', ''); return; }
    var go = t.getAttribute('data-go');
    if (go === 'close') lb.close(); else if (go === 'next') show(at + 1); else if (go === 'prev') show(at - 1);
  });
  document.addEventListener('keydown', function(e){
    if (!lb.open) return;
    if (e.key === 'ArrowRight') show(at + 1); else if (e.key === 'ArrowLeft') show(at - 1);
  });
  var x0 = null;
  lb.addEventListener('touchstart', function(e){ x0 = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', function(e){ if (x0 === null) return; var dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 50) show(at + (dx < 0 ? 1 : -1)); });
})();
</script></body></html>`
}

// ---------- reading who gets what ----------

type Row = { key: string; name: string; org: string; kinds: string[]; count: number; best: string[]; email: string; email_source: string;
  email_note: string; protocol: boolean; status: string; sent_at: string; sent_count: number; talk: boolean; company: string; for_speaker: boolean }

async function sentLog(c: any): Promise<Map<string, { at: string; n: number; to: string }>> {
  const out = new Map<string, { at: string; n: number; to: string }>()
  try {
    const rows = await all(c, "SELECT entity_id, detail, created_at FROM admin_audit WHERE action = ? ORDER BY id", AUDIT_ACTION)
    for (const r of rows) {
      let d: any = {}
      try { d = JSON.parse(r.detail || '{}') } catch { /* not JSON */ }
      const k = String(r.entity_id)
      const was = out.get(k)
      out.set(k, { at: String(r.created_at || ''), n: (was ? was.n : 0) + 1, to: String(d.to || '') })
    }
  } catch { /* no audit table: nothing sent as far as anyone can tell */ }
  return out
}

async function rowsFor(c: any, eventId = 1): Promise<Row[]> {
  const [speakers, talks, contacts, sent] = await Promise.all([
    all(c, 'SELECT id, name, role, organisation, email, is_published FROM speakers WHERE event_id = ?', eventId).catch(() => [] as any[]),
    all(c, 'SELECT id, speaker_name, speaker_title, company, status FROM innovation_talks WHERE event_id = ?', eventId).catch(() => [] as any[]),
    hooks.talkContacts ? hooks.talkContacts(c, eventId).catch(() => ({} as Record<string, Contact>)) : Promise.resolve({} as Record<string, Contact>),
    sentLog(c)])
  const spBy = new Map(speakers.map((s: any) => [Number(s.id), s]))
  const tBy = new Map(talks.map((t: any) => [Number(t.id), t]))
  const rows: Row[] = []
  const covered = new Set<string>()
  const build = (key: string, name: string, sIds: number[], tIds: number[], photos: string[], best: string[], check = false) => {
    const sps = sIds.map(id => spBy.get(id)).filter(Boolean) as any[]
    const tks = tIds.map(id => tBy.get(id)).filter(Boolean) as any[]
    if (!sps.length && !tks.length) return // no longer on the programme
    for (const s of sps) covered.add('s' + s.id)
    for (const t of tks) covered.add('t' + t.id)
    const spEmail = sps.map(s => String(s.email || '').trim().toLowerCase()).find(Boolean) || ''
    const tc = tks.map(t => contacts[String(t.id)]).find(x => x && x.email) || null
    const email = spEmail || (tc ? String(tc.email).trim().toLowerCase() : '')
    const source = spEmail ? 'speaker' : (tc ? tc.source : 'none')
    const protocol = sps.some(s => isProtocol(s)) || tks.some(t => !!(contacts[String(t.id)] || {}).protocol)
    const s = sent.get(key)
    const count = byDay(photos).reduce((n, g) => n + g.ids.length, 0)
    const status = !count ? 'no-photos' : protocol ? 'protocol' : !email ? 'no-email' : s ? 'sent' : check ? 'check' : 'ready'
    rows.push({ key, name: sps[0]?.name || tks[0]?.speaker_name || name, org: sps[0]?.organisation || tks[0]?.company || '',
      kinds: [...(sps.length ? ['Speaker'] : []), ...(tks.length ? ['Innovation Talk'] : [])], count, best: best.slice(0, 3),
      email, email_source: source, email_note: spEmail ? "The speaker's own email" : (tc ? tc.note : 'No email on file'), protocol, status,
      sent_at: s ? s.at : '', sent_count: s ? s.n : 0, talk: !sps.length && tks.length > 0, company: tks[0]?.company || sps[0]?.organisation || '',
      for_speaker: source === 'speaker' || source === 'team' })
  }
  for (const p of albumPeople()) build(p.key, p.name, p.speakers || [], p.talks || [], p.photos || [], p.best || [], !!p.check)
  // Everyone on the programme with no photo found, so the list shows who is missing.
  // The same person under both lists is one row (matched by name).
  const named = new Map<string, { s: number[]; t: number[]; name: string }>()
  for (const s of speakers) if (!covered.has('s' + s.id) && Number(s.is_published ?? 1)) { const k = normName(s.name); const g = named.get(k) || { s: [], t: [], name: s.name }; g.s.push(Number(s.id)); named.set(k, g) }
  for (const t of talks) if (!covered.has('t' + t.id) && String(t.status || '') !== 'cancelled') { const k = normName(t.speaker_name); const g = named.get(k) || { s: [], t: [], name: t.speaker_name }; g.t.push(Number(t.id)); named.set(k, g) }
  for (const g of named.values()) build(g.s.length ? 's' + g.s[0] : 't' + g.t[0], g.name, g.s, g.t, [], [])
  const order: Record<string, number> = { ready: 0, check: 1, sent: 2, 'no-email': 3, protocol: 4, 'no-photos': 5 }
  rows.sort((a, b) => (order[a.status] - order[b.status]) || a.name.localeCompare(b.name))
  return rows
}

async function mailFor(c: any, r: Row) {
  const p = personFor(r.key)
  const href = await pageUrl(c, r.key)
  const header = hooks.emailHeader ? hooks.emailHeader('Your photos', MUMBAI_WORDS.line) : ''
  return photosEmailHTML({ name: r.name, count: r.count, best: p ? p.best : [], href, header, talk: r.talk, forSpeaker: r.for_speaker, company: r.company })
}

// ---------- routes ----------

ph.get('/api/admin/speaker-photos', async (c) => {
  const rows = await rowsFor(c, 1)
  const withLinks = await Promise.all(rows.map(async r => ({ ...r, page: r.count ? await pageUrl(c, r.key) : '', thumbs: r.best.map(id => thumbUrl(id, 120)) })))
  const counts: Record<string, number> = {}
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1
  return c.json({ generated: DATA.generated, folder: DATA.folder, rows: withLinks, counts, photos: Object.keys(DATA.photos || {}).length })
})

ph.get('/api/admin/speaker-photos/:key/preview', async (c) => {
  const key = c.req.param('key')
  const r = (await rowsFor(c, 1)).find(x => x.key === key)
  if (!r) return c.json({ error: 'That person is not on the list any more.' }, 404)
  if (!r.count) return c.json({ error: 'No photos of ' + r.name + ' were found.' }, 409)
  const mail = await mailFor(c, r)
  return c.json({ to: r.email, subject: mail.subject, html: mail.html, page: await pageUrl(c, r.key), status: r.status })
})

ph.post('/api/admin/speaker-photos/:key/send', async (c) => {
  const b = await c.req.json().catch(() => ({})) as any
  const key = c.req.param('key')
  const r = (await rowsFor(c, 1)).find(x => x.key === key)
  if (!r) return c.json({ error: 'That person is not on the list any more.' }, 404)
  if (!r.count) return c.json({ error: 'No photos of ' + r.name + ' were found.' }, 409)
  if (!r.email) return c.json({ error: 'There is no email address for ' + r.name + '.' }, 409)
  if (r.protocol && !b.anyway) return c.json({ error: r.name + ' is a government official: their office handles protocol. Send anyway from their row if you are sure.' }, 409)
  if (r.sent_count && !b.again) return c.json({ error: r.name + ' was already sent their photos on ' + r.sent_at + '.', already: true }, 409)
  if (!secretOf(c)) return c.json({ error: 'Photo links cannot be signed on this server.' }, 503)
  if (!hooks.sendEmail) return c.json({ error: 'Email is not set up on this server.' }, 503)
  const mail = await mailFor(c, r)
  const sent = await hooks.sendEmail(c, r.email, mail.subject, mail.html)
  if (!sent.ok) return c.json({ error: sent.error || 'The email did not go.' }, 502)
  if (hooks.audit) {
    try { await hooks.audit(c, AUDIT_ACTION, 'photo_album', r.key, { name: r.name, to: r.email, source: r.email_source, count: r.count, again: !!b.again }) }
    catch { /* the audit log never fails a send */ }
  }
  return c.json({ success: true, to: r.email, count: r.count })
})

ph.get('/photos/:key', async (c) => {
  const key = c.req.param('key')
  const p = personFor(key)
  const want = p ? await photoSig(c, key) : ''
  const ok = !!p && sameText(want, String(c.req.query('k') || ''))
  const head = { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'private, max-age=300', 'Referrer-Policy': 'no-referrer' }
  if (!ok) {
    return new Response(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Photos</title></head>
<body style="font-family:Segoe UI,Roboto,Arial,sans-serif;max-width:560px;margin:60px auto;padding:0 16px;color:#1e2140"><h1 style="font-size:22px">This photo link is not complete</h1>
<p style="line-height:1.6">Please open the link from your email again, all of it. If it still does not work, reply to that email and we will send it again.</p>
<p><a href="${SITE}/" style="color:#C84F00;font-weight:bold">Bharat AI Innovation</a></p></body></html>`, { status: 404, headers: head })
  }
  let org = ''
  try {
    if (p!.speakers.length) org = String(((await c.env.DB.prepare('SELECT organisation FROM speakers WHERE id = ?').bind(p!.speakers[0]).first()) as any)?.organisation || '')
    else if (p!.talks.length) org = String(((await c.env.DB.prepare('SELECT company FROM innovation_talks WHERE id = ?').bind(p!.talks[0]).first()) as any)?.company || '')
  } catch { /* the page shows without it */ }
  return new Response(albumPageHTML({ name: p!.name, org, ids: p!.photos, focus: p!.focus }), { headers: head })
})

export default ph
