import { Hono } from 'hono'
import { isProtocol } from './speaker-brief'
import { dearName } from './talk-brief'
import { MUMBAI_WORDS, normName, adminReady, sessionsWithSpeakers, ROLE_WORD } from './conference'
import { linksForDrive, downloadLimit, downloadsUsed } from './photo-store'
import ALBUMS from '../data/speaker-photos.json'
import ATTENDEES from '../data/attendee-photos.json'

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
// Photos come from our own copies in R2 (routes/photo-store.ts, linksForDrive): small and
// large views, and full-size saves counted per person (50 for a speaker's album). A photo
// not in R2 yet is shown from Google Drive (lh3.googleusercontent.com), which needs the
// Drive folder at "Anyone with the link: Viewer"; once every photo is in R2 the folder can
// be Restricted. Every /api/admin/* route here is behind the admin middleware in index.tsx.

type Contact = { email: string; source: string; note: string; protocol?: boolean }
type Hooks = {
  sendEmail?: (c: any, to: string, subject: string, html: string) => Promise<{ ok: boolean; error?: string }>
  audit?: (c: any, action: string, entity?: string, entityId?: any, detail?: any, actor?: { actor: string; kind: string }) => Promise<void>
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
// guest: someone not on the programme whom the organiser named (scripts/photos/guests.json,
// key g<id>), e.g. a special guest; their details come from that file, not from D1.
type Guest = { name: string; title: string; role?: string; email?: string }
type Person = { key: string; name: string; speakers: number[]; talks: number[]; photos: string[]; best: string[]; focus?: Record<string, [number, number]>; check?: boolean; guest?: Guest; attendee?: { group: number; came: boolean } }
// photos[id] = [day 'YYYY-MM-DD', time 'HH:MM' or '' when unknown, 1 if taken upright, 1 if a camera RAW file]
// who[id] = everyone the face match found in that photo: [album key, face x %, score vs their own photo %, match score %].
type Albums = { generated: string; folder: string; photos: Record<string, [string, string, number, number?]>; people: Person[]; who?: Record<string, [string, number, number, number][]> }
const DATA = ALBUMS as unknown as Albums
// Attendees' albums (scripts/photos/att_match.py, 23 Nov 2026): attendee ids and Drive ids
// only; names and emails are read from D1. group = the organiser's order of priority.
type AttAlbum = { group: number; came: boolean; check: boolean; photos: string[]; best: string[]; focus: Record<string, [number, number]> }
const ATT = ATTENDEES as unknown as { generated: string; groups: string[]; photos: Record<string, [string, string, number, number?]>; albums: Record<string, AttAlbum> }
// Every photo's day, time, upright and RAW flags, speakers' and attendees' alike.
const META: Record<string, [string, string, number, number?]> = { ...(ATT.photos || {}), ...(DATA.photos || {}) }

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
for (const [k, a] of Object.entries(ATT.albums || {})) BY_KEY.set(k, { key: k, name: '', speakers: [], talks: [], photos: a.photos, best: a.best, focus: a.focus, check: a.check, attendee: { group: a.group, came: a.came } })
export function personFor(key: string): Person | null { return BY_KEY.get(String(key || '')) || null }
export const isAttendee = (key: string) => /^a\d+$/.test(String(key || ''))
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
// Our own copies (routes/photo-store.ts, R2, since 23 Nov 2026): s 600 px, m 1600 px, o the
// original, each link signed for one person and one photo; saving an o is counted (50 for a
// speaker's album). A photo not in R2 yet falls back to Drive, below.
export type Got = Record<string, { s: string; m: string; o: string }>
export function isRaw(id: string): boolean { return !!(META[id] && META[id][3]) }
export function downloadUrl(id: string): string {
  return isRaw(id) ? `https://lh3.googleusercontent.com/d/${encodeURIComponent(id)}=s0` : `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`
}

const DAY_WORDS: Record<string, string> = { '2026-11-20': 'Friday 20 November', '2026-11-21': 'Saturday 21 November' }

// The photos of one person grouped by day, in the order they were taken.
export function byDay(ids: string[]): { day: string; words: string; ids: string[] }[] {
  const seen = new Set<string>()
  const list = ids.filter(id => META[id] && !seen.has(id) && seen.add(id))
  list.sort((a, b) => {
    const x = META[a], y = META[b]
    return (x[0] + (x[1] || '99:99')).localeCompare(y[0] + (y[1] || '99:99')) || a.localeCompare(b)
  })
  const out: { day: string; words: string; ids: string[] }[] = []
  for (const id of list) {
    const d = META[id][0] || ''
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
    forSpeaker: boolean; company?: string; got?: Got; guest?: boolean; lineup?: string; attendee?: boolean }): { subject: string; html: string } {
  const words = MUMBAI_WORDS
  // "Dear Dr. Rajkumar," / "Dear Shri Sachin Itkar," (the organiser, 23 Nov 2026).
  const first = dearName(a.name)
  const n = a.count
  const photosWord = n === 1 ? '1 photo' : `${n} photos`
  const subject = a.forSpeaker ? `Your photos from ${words.name}` : `Photos of ${a.name} from ${words.name}`
  const greeting = a.forSpeaker ? `Dear ${first},` : `Dear ${a.company ? a.company + ' team' : 'team'},`
  const thanks = a.attendee
    ? `Thank you for coming to ${words.name} in Mumbai. We found ${photosWord} of you by matching the profile photo you added in the event app. Here are a few of them.`
    : a.guest
    ? `Thank you for joining ${words.name} in Mumbai as our special guest. Our photographers took ${photosWord} of you. Here are a few of them.`
    : a.forSpeaker
    ? `Thank you for ${a.talk ? 'your Innovation Talk' : 'speaking'} at ${words.name} in Mumbai. Our photographers took ${photosWord} of you. Here are a few of them.`
    : `Here are the photos of ${a.name} from ${a.talk ? 'their Innovation Talk' : 'their session'} at ${words.name} in Mumbai: ${photosWord} in all. Please pass this email on to ${first}.`
  // Whole photos, two a row: a square crop of a wide panel shot can leave them out of it.
  const pics = a.best.slice(0, 6)
  // Only the small size (s) ever goes in an email: mail scanners open links, and an
  // original (o) would spend the person's saves.
  const cell = (id: string) => `<td width="50%" style="padding:3px;vertical-align:top"><a href="${escH(a.href)}"><img src="${escH(a.got?.[id]?.s || wideUrl(id, 560))}" width="268" alt="Photo of ${escH(a.name)}" style="display:block;width:100%;max-width:268px;height:auto;border:0;border-radius:8px"></a></td>`
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
      ${a.lineup || ''}
      <p style="font-size:14px;line-height:1.65;margin:0 0 12px">Each photo downloads at full size. You are welcome to use and share them. If you post them on LinkedIn, please tag Bharat AI Innovation.</p>
      <p style="font-size:13px;line-height:1.6;margin:0 0 12px;color:#6b7280">A computer found these photos by matching faces, so one or two may show someone else.${a.attendee ? ' On your page, tap &quot;Not me&quot; on any photo that is not you, or &quot;Don&rsquo;t match my photos&quot; if you would rather we did not match your photos at all.' : ' Just skip those.'}</p>
      <p style="font-size:14px;line-height:1.65;margin:16px 0 0">See you at Bharat AI Innovation, New Delhi: 28 and 29 July 2027 at Bharat Mandapam. <a href="${SITE}/delhi" style="color:#C84F00;font-weight:bold">See the Delhi edition</a></p>
      <p style="margin:22px 0 24px;font-size:14px;color:#555">Team Bharat AI Innovation<br>
        <span style="color:#888">${escH(words.line).replace(' · ', ' &middot; ')}</span></p>
    </div>
  </div></body></html>`
  return { subject, html }
}

// Their page. Everything it needs is in the page: the photo ids sit in a JSON block
// that the small script below reads (no inline handlers, no quotes to escape).
// got: our own signed links per Drive id (a photo missing from it is shown from Drive);
// saves: how many originals they may save and have saved, when the photos come from R2.
// lineup: their session(s) from the live programme (lineupHTML); names: per Drive id, the
// people named in that photo, left to right ([name, "Designation, Organisation", LinkedIn, 1 = them]).
export function albumPageHTML(a: { name: string; org: string; ids: string[]; focus?: Record<string, [number, number]>; got?: Got;
    saves?: { limit: number; used: number } | null; lineup?: string; names?: Record<string, [string, string, string, number][]>;
    me?: { key: string; k: string; order: string[] } }): string {
  const got = a.got || {}
  const names = a.names || {}
  // An attendee's page (me): "Not me" on each photo and "Don't match my photos". A photo is
  // named to the server by its place in their album (me.order), never by an id.
  const me = a.me || null
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
    return `<button type="button" class="ph" data-i="${n}" aria-label="Open photo ${n + 1} of ${total}"><img src="${escH(got[id]?.s || wideUrl(id, 700))}" alt="" loading="${n < 8 ? 'eager' : 'lazy'}" width="250" height="250"${at(id)}></button>`
  }).join('')}</div></section>`).join('')
  // Per photo: the large view and the full-size save.
  const data = JSON.stringify(flat.map(id => [got[id]?.m || bigUrl(id), got[id]?.o || downloadUrl(id), names[id] || [], me ? me.order.indexOf(id) : -1])).replace(/</g, '\\u003c')
  const meData = JSON.stringify(me ? { key: me.key, k: me.k } : null).replace(/</g, '\\u003c')
  const s = a.saves
  const savesLine = s ? (s.used >= s.limit
    ? `You have saved ${s.limit} photos at full size, the most each person can. You can still look at all of them here.`
    : `You can save up to ${s.limit} of your photos at full size${s.used ? ` (${s.used} saved so far)` : ''}.`) : ''
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
.btn.sm{min-height:38px;padding:0 12px;font-size:13px}
.lb-who{color:#fff;padding:8px 14px 0;font-size:14px;line-height:1.5;text-align:center}
.lb-who a{color:#ffb680}
.lb-acts{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:8px}
.lu{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:18px 0 0}
.lu-k{font-size:12px;font-weight:700;color:var(--brand);text-transform:uppercase;letter-spacing:.4px}
.lu-t{font-size:17px;font-weight:700;margin:4px 0 2px}
.lu-w{color:var(--sub);font-size:14px;margin:0 0 8px}
.lu ul{margin:0;padding:0 0 0 18px;font-size:14px;line-height:1.6}
.lu a{color:var(--brand);font-weight:600}
.optout{margin:10px 0;padding:8px 14px;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--sub);font-size:14px;cursor:pointer}
</style></head><body>
<header><div class="wrap"><a class="brand" href="${SITE}/">${escH(MUMBAI_WORDS.name)}</a>
<h1>${escH(title)}</h1>
<p class="lead">${total === 1 ? '1 photo' : total + ' photos'}${a.org ? ' · ' + escH(a.org) : ''} · ${escH(MUMBAI_WORDS.line).replace(' · ', ' &middot; ')}</p></div></header>
<main class="wrap">${a.lineup || ''}${sections || '<p class="note">No photos here yet.</p>'}
<p class="note">Tap a photo to see it large and download it at full size.${savesLine ? ' ' + escH(savesLine) : ''} You are welcome to use and share these photos; if you post them on LinkedIn, please tag Bharat AI Innovation.<br>
A computer found these photos by matching faces, so one or two may show someone else.${me ? ' We matched the profile photo you added in the event app. Tap &quot;Not me&quot; on a photo that is not you.' : ''}<br>
${me ? '<button type="button" class="optout" data-go="optout">Don&rsquo;t match my photos</button><br>' : ''}Next: <a href="${SITE}/delhi">Bharat AI Innovation, New Delhi, 28 and 29 July 2027</a>.</p></main>
<dialog id="lb" aria-label="Photo"><div class="lb">
<div class="lb-top"><span id="lb-n"></span><button type="button" class="btn" data-go="close">Close</button></div>
<div class="lb-img"><img id="lb-img" alt=""></div>
<div class="lb-who" id="lb-who" aria-live="polite"></div>
<div class="lb-bot"><button type="button" class="btn" data-go="prev">Previous</button><a class="btn main" id="lb-dl" href="#" rel="noopener">Download full size</a><button type="button" class="btn" data-go="next">Next</button></div>
</div></dialog>
<script type="application/json" id="ids">${data}</script>
<script type="application/json" id="me">${meData}</script>
<script>
(function(){
  var ids = JSON.parse(document.getElementById('ids').textContent || '[]');
  var lb = document.getElementById('lb'), img = document.getElementById('lb-img'), n = document.getElementById('lb-n'), dl = document.getElementById('lb-dl');
  var at = 0;
  function show(i){
    at = (i + ids.length) % ids.length;
    img.src = ids[at][0];
    n.textContent = 'Photo ' + (at + 1) + ' of ' + ids.length;
    dl.href = ids[at][1];
    who(ids[at][2] || []);
  }
  // Who else is in this photo (only other speakers and guests the organiser named, checked
  // against the live programme), a caption for LinkedIn, and a way to say a name is wrong.
  var box = document.getElementById('lb-who');
  function el(tag, cls, text){ var x = document.createElement(tag); if (cls) x.className = cls; if (text) x.textContent = text; return x; }
  function who(list){
    box.textContent = '';
    var others = list.filter(function(x){ return !x[3]; });
    if (list.length > 1 && others.length < list.length) box.appendChild(el('div', '', 'From left: ' + list.map(function(x){ return x[0] + (x[3] ? ' (you)' : ''); }).join(', ')));
    else if (others.length) box.appendChild(el('div', '', 'Also in this photo: ' + others.map(function(x){ return x[0]; }).join(', ')));
    var cap = (others.length ? 'With ' + others.map(function(x){ return x[0] + (x[1] ? ' (' + x[1] + ')' : ''); }).join(', ') + ' at ' : 'At ')
      + 'Bharat AI Innovation 2026, Mumbai. #BharatAIInnovation';
    var acts = el('div', 'lb-acts');
    var copy = el('button', 'btn sm', 'Copy LinkedIn caption'); copy.type = 'button';
    copy.addEventListener('click', function(){
      var done = function(){ copy.textContent = 'Copied'; setTimeout(function(){ copy.textContent = 'Copy LinkedIn caption'; }, 2000); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(cap).then(done, function(){ window.prompt('Copy this caption:', cap); });
      else window.prompt('Copy this caption:', cap);
    });
    acts.appendChild(copy);
    others.forEach(function(x){ if (!x[2]) return; var a = el('a', 'btn sm', x[0] + ' on LinkedIn'); a.href = x[2]; a.target = '_blank'; a.rel = 'noopener'; acts.appendChild(a); });
    var bad = el('a', 'btn sm', 'Wrong name? Tell us');
    bad.href = 'mailto:register@bharataiinnovation.com?subject=' + encodeURIComponent('Wrong name on a photo') + '&body='
      + encodeURIComponent('Page: ' + location.pathname + ' / Photo ' + (at + 1) + ' of ' + ids.length + (list.length ? ' / Names shown: ' + list.map(function(x){ return x[0]; }).join(', ') : '') + ' / What is wrong: ');
    if (list.length) acts.appendChild(bad);
    if (ME && ids[at][3] >= 0) {
      var notme = el('button', 'btn sm', 'Not me'); notme.type = 'button';
      notme.addEventListener('click', function(){
        var n = ids[at][3], i = at;
        notme.disabled = true;
        post('/api/photos/not-me', { key: ME.key, k: ME.k, n: n }, function(ok){
          if (!ok) { notme.disabled = false; notme.textContent = 'Did not work, try again'; return; }
          var tile = document.querySelector('[data-i="' + i + '"]'); if (tile) tile.style.display = 'none';
          notme.textContent = 'Removed from your photos';
        });
      });
      acts.appendChild(notme);
    }
    box.appendChild(acts);
  }
  var ME = JSON.parse(document.getElementById('me').textContent || 'null');
  function post(url, body, done){
    try {
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function(r){ done(r.ok); }, function(){ done(false); });
    } catch (e) { done(false); }
  }
  document.addEventListener('click', function(e){
    var t = e.target.closest ? e.target.closest('[data-go="optout"]') : null;
    if (!t || !ME) return;
    if (!window.confirm('Stop matching your face in the event photos? This page will be emptied and we will not match you again.')) return;
    t.disabled = true;
    post('/api/photos/opt-out', { key: ME.key, k: ME.k }, function(ok){
      if (!ok) { t.disabled = false; t.textContent = 'Did not work, try again'; return; }
      var m = document.querySelector('main'); if (m) { m.textContent = ''; m.appendChild(el('p', 'note', 'Done. We have removed your photos from this page and will not match your face again.')); }
    });
  });
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

// ---------- the live programme: line-ups, drop-outs, who else is in a photo ----------
//
// The organiser (23 Nov 2026): "add the panel line-up and the names of other people in each
// photo ... some speakers dropped and we replaced them with other speakers, so be careful in
// using old data of panelists". So everything about a person here is read from D1 when the
// page or email is made: the published sessions and their speaker links (Admin -> Conference),
// each speaker's name, designation, organisation and LinkedIn, the Innovation Talks, and the
// badge-desk check-ins. From the photo data only one thing is used: who the face match found
// in which photo (DATA.who), never a name.

export type LivePerson = { key: string | null; name: string; title: string; org: string; linkedin: string; role: string; official: boolean }
export type LiveSession = { id: string; title: string; day: string; start: string; end: string; room: string; people: LivePerson[]; typed: string[]; talk: boolean }
export type Live = { sessions: LiveSession[]; info: Map<string, LivePerson>; byKey: Map<string, LiveSession[]>; presence: (key: string, day: string) => boolean | null }

const PAD = 10 // minutes either side of a session that its photos may be from
const mins = (t: any) => { const m = /(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : -1 }
const linkedinOf = (u: any) => { const s = String(u || '').trim(); return /^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/[^\s"<>]+$/i.test(s) ? s : '' }
const WHO = (id: string): [string, number, number, number][] => ((DATA as any).who && (DATA as any).who[id]) || []
const PHOTO_TIMES: [string, string, number][] = Object.keys(DATA.photos || {}).map(id => [id, DATA.photos[id][0], mins(DATA.photos[id][1])])
const inSession = (s: LiveSession, day: string, t: number) => t >= 0 && day === s.day && t >= mins(s.start) - PAD && t <= mins(s.end) + PAD

export async function liveProgramme(c: any): Promise<Live> {
  const info = new Map<string, LivePerson>()
  const sessions: LiveSession[] = []
  const emailOf = new Map<string, string>() // album key -> the address their attendee row is under
  try {
    const r = await adminReady(c)
    const speakers = await all(c, 'SELECT id, name, role, organisation, email, linkedin_url, is_published, sort_order FROM speakers WHERE event_id = 1 ORDER BY sort_order, id')
    const byId = new Map(speakers.map((s: any) => [Number(s.id), s]))
    const asPerson = (sp: any, role = ''): LivePerson => ({ key: personFor('s' + sp.id)?.key || null, name: String(sp.name || '').trim(), title: String(sp.role || '').trim(),
      org: String(sp.organisation || '').trim(), linkedin: linkedinOf(sp.linkedin_url), role, official: isProtocol(sp) })
    for (const sp of speakers) {
      const p = asPerson(sp)
      if (p.key && !info.has(p.key)) info.set(p.key, p)
      if (p.key && String(sp.email || '').trim()) emailOf.set(p.key, String(sp.email).trim().toLowerCase())
    }
    const list = (await sessionsWithSpeakers(c, 1, speakers, r)).filter((s: any) => s.status !== 'draft' && s.start_time)
    for (const s of list) {
      const people = (s.links || []).map((l: any) => byId.get(Number(l.speaker_id)) ? asPerson(byId.get(Number(l.speaker_id)), ROLE_WORD[l.role] || '') : null).filter(Boolean) as LivePerson[]
      const typed = (s.others || []).map((o: any) => String((o && (o.name || o)) || '').trim()).filter(Boolean)
      if (!people.length && !typed.length) continue
      sessions.push({ id: 's' + s.id, title: String(s.title || ''), day: String(s.start_time).slice(0, 10), start: String(s.start_time).slice(11, 16),
        end: String(s.end_time || s.start_time).slice(11, 16), room: String(s.room || ''), people, typed, talk: false })
    }
  } catch { /* no programme tables here: no line-ups */ }
  try {
    for (const t of await all(c, 'SELECT * FROM innovation_talks WHERE event_id = 1')) {
      if (String(t.status || '') === 'cancelled') continue
      const p: LivePerson = { key: personFor('t' + t.id)?.key || null, name: String(t.speaker_name || '').trim(), title: String(t.speaker_title || '').trim(),
        org: String(t.company || '').trim(), linkedin: '', role: '', official: isProtocol({ name: t.speaker_name, role: t.speaker_title }) }
      if (p.key && !info.has(p.key)) info.set(p.key, p)
      const st = String(t.starts_at || '')
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(st) && Number(t.duration_min) > 0) {
        const end = mins(st.slice(11)) + Number(t.duration_min)
        sessions.push({ id: 't' + t.id, title: String(t.topic || '').trim() || 'Innovation Talk', day: st.slice(0, 10), start: st.slice(11, 16),
          end: `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`, room: String(t.hall || ''), people: [p], typed: [], talk: true })
      }
    }
  } catch { /* no talks table */ }
  for (const p of albumPeople()) if (p.guest && !info.has(p.key)) {
    info.set(p.key, { key: p.key, name: p.guest.name, title: p.guest.title || '', org: '', linkedin: '', role: '', official: isProtocol({ name: p.guest.name, role: p.guest.title }) })
    if (String(p.guest.email || '').trim()) emailOf.set(p.key, String(p.guest.email).trim().toLowerCase())
  }
  // Check-ins at the badge desk, through the attendee row under their email. null = we
  // cannot tell (no attendee row under that address, or no check-ins table here).
  const days = new Map<string, Set<string>>()
  try {
    const emails = [...new Set(emailOf.values())]
    const idsBy = new Map<string, number[]>()
    for (let i = 0; i < emails.length; i += 90) {
      const ch = emails.slice(i, i + 90)
      for (const a of await all(c, `SELECT id, lower(trim(email)) AS email FROM attendees WHERE event_id = 1 AND lower(trim(email)) IN (${ch.map(() => '?').join(',')})`, ...ch))
        idsBy.set(a.email, [...(idsBy.get(a.email) || []), Number(a.id)])
    }
    const aids = [...idsBy.values()].flat()
    const dayBy = new Map<number, string[]>()
    for (let i = 0; i < aids.length; i += 90) {
      const ch = aids.slice(i, i + 90)
      for (const k of await all(c, `SELECT attendee_id, day FROM checkins WHERE attendee_id IN (${ch.map(() => '?').join(',')})`, ...ch))
        dayBy.set(Number(k.attendee_id), [...(dayBy.get(Number(k.attendee_id)) || []), String(k.day)])
    }
    for (const [key, email] of emailOf) {
      const ids = idsBy.get(email); if (!ids) continue
      days.set(key, new Set(ids.flatMap(id => dayBy.get(id) || [])))
    }
  } catch { days.clear() }
  const byKey = new Map<string, LiveSession[]>()
  for (const s of sessions) for (const p of s.people) if (p.key) byKey.set(p.key, [...(byKey.get(p.key) || []), s])
  return { sessions, info, byKey, presence: (key, day) => (days.has(key) ? days.get(key)!.has(day) : null) }
}

// "2:15 pm"
const ampm = (hhmm: string) => { const t = mins(hhmm); if (t < 0) return ''; const h = Math.floor(t / 60), m = t % 60; return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}` }
export function whenWords(s: LiveSession): string { return `${DAY_WORDS[s.day] || s.day}, ${ampm(s.start)} to ${ampm(s.end)}${s.room ? ' · ' + s.room : ''}` }

// Their session(s), as the programme has them now: title, day, time, hall, and each person
// with their designation and organisation, the moderator marked, LinkedIn when we have it.
// Never anyone's email or phone. `email` draws it with inline styles for an email.
export function lineupHTML(list: LiveSession[], email: boolean): string {
  if (!list.length) return ''
  const blocks = list.slice().sort((a, b) => (a.day + a.start).localeCompare(b.day + b.start)).map(s => {
    const who = s.people.map(p => {
      const line = [p.title, p.org].filter(Boolean).join(', ')
      const li = p.linkedin ? ` <a href="${escH(p.linkedin)}"${email ? ' style="color:#C84F00;font-weight:bold"' : ''}>LinkedIn</a>` : ''
      return `<li><strong>${escH(p.name)}</strong>${line ? ' &middot; ' + escH(line) : ''}${p.role === 'Moderator' ? ' &middot; <em>Moderator</em>' : ''}${li}</li>`
    }).concat(s.typed.map(n => `<li><strong>${escH(n)}</strong></li>`))
    const kind = s.talk ? 'Your Innovation Talk' : s.people.length + s.typed.length > 1 ? 'Your session and who was on it' : 'Your session'
    if (email) return `<div style="border:1px solid #e7e9f5;border-radius:12px;padding:14px 16px;margin:0 0 14px;background:#fbfcff">
      <div style="font-size:12px;font-weight:bold;color:#C84F00;text-transform:uppercase;letter-spacing:0.4px">${escH(kind)}</div>
      <div style="font-size:16px;font-weight:bold;margin:4px 0 2px;color:#1e2140">${escH(s.title)}</div>
      <div style="font-size:13px;color:#6b7280;margin:0 0 8px">${escH(whenWords(s))}</div>
      <ul style="margin:0;padding:0 0 0 18px;font-size:14px;line-height:1.6;color:#1e2140">${who.join('')}</ul></div>`
    return `<section class="lu"><div class="lu-k">${escH(kind)}</div><div class="lu-t">${escH(s.title)}</div><div class="lu-w">${escH(whenWords(s))}</div><ul>${who.join('')}</ul></section>`
  })
  return blocks.join('')
}

// Is the line-up still right? Before any email: a listed person who is in none of the
// session's photos and has no check-in that day (or none we can see) may have dropped out;
// someone else who is in many of the session's photos may have replaced them. Flagged, never
// dropped: the organiser confirms the line-up (or fixes it in Admin -> Conference).
export type PanelCheck = { id: string; title: string; when: string; talk: boolean; photos: number; flagged: boolean; reasons: string[]; fp: string;
  people: { name: string; role: string; line: string; seen: number; present: boolean | null; album: boolean }[]; typed: string[]; others: { name: string; n: number }[] }
const fnv = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 } return h.toString(16) }
export function checkSession(s: LiveSession, live: Live): PanelCheck {
  const keys = new Set(s.people.map(p => p.key).filter(Boolean) as string[])
  const ph = PHOTO_TIMES.filter(([id, d, t]) => inSession(s, d, t) && WHO(id).some(w => keys.has(w[0]) && w[2] < 80)).map(x => x[0])
  const reasons: string[] = []
  const people = s.people.map(p => {
    const seen = p.key ? ph.filter(id => WHO(id).some(w => w[0] === p.key)).length : 0
    const present = p.key ? live.presence(p.key, s.day) : null
    if (!seen && present !== true) reasons.push(`${p.name} is in none of this session's photos${present === false ? ' and did not check in that day' : !p.key ? ' (we have no usable photo of them to look for)' : ''}.`)
    return { name: p.name, role: p.role, line: [p.title, p.org].filter(Boolean).join(', '), seen, present, album: !!p.key }
  })
  // Someone not on it, in a good share of its photos, and not on a session running then.
  const busy = new Set(live.sessions.filter(o => o.id !== s.id && o.day === s.day && mins(o.start) < mins(s.end) + PAD && mins(o.end) > mins(s.start) - PAD).flatMap(o => o.people.map(p => p.key).filter(Boolean) as string[]))
  const n = new Map<string, number>()
  for (const id of ph) for (const w of WHO(id)) if (!keys.has(w[0]) && !busy.has(w[0]) && w[2] < 80) n.set(w[0], (n.get(w[0]) || 0) + 1)
  const others = [...n].filter(([k, c]) => c >= Math.max(3, Math.ceil(ph.length * 0.25)) && !personFor(k)?.check)
    .map(([k, c]) => ({ name: live.info.get(k)?.name || personFor(k)?.name || k, n: c })).sort((a, b) => b.n - a.n)
  for (const o of others) reasons.push(`${o.name} is in ${o.n} of its ${ph.length} photos but not on the programme for it: a replacement?`)
  const fp = fnv(JSON.stringify([s.title, s.day, s.start, s.people.map(p => [p.name, p.role]), s.typed]))
  return { id: s.id, title: s.title, when: whenWords(s), talk: s.talk, photos: ph.length, flagged: reasons.length > 0, reasons, fp, people, typed: s.typed, others }
}

// The line-ups the organiser has confirmed (admin_audit 'photos.panel_ok', session id -> fp).
export const PANEL_OK = 'photos.panel_ok'
async function confirmedPanels(c: any): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  try {
    for (const r of await all(c, "SELECT entity_id, detail FROM admin_audit WHERE action = ? ORDER BY id", PANEL_OK)) {
      try { out.set(String(r.entity_id), String(JSON.parse(r.detail || '{}').fp || '')) } catch { /* not JSON */ }
    }
  } catch { /* no audit table */ }
  return out
}
// Sessions of this person whose line-up is flagged and not confirmed as it is now.
function waitingFor(key: string, live: Live, checks: Map<string, PanelCheck>, ok: Map<string, string>): PanelCheck[] {
  return (live.byKey.get(key) || []).map(s => checks.get(s.id)!).filter(k => k && k.flagged && ok.get(k.id) !== k.fp)
}

// Who to name in one of `owner`'s photos, left to right, them included. Another person is
// named only when the match is confident (not a "look before sending" person), not the stage
// screen showing their portrait, and they were on a session running then (or, not an
// official, the match is very strong); never someone the badge desk did not see that day.
export const STRONG = 65
export function namesIn(id: string, owner: string, live: Live): [string, string, string, number][] {
  const meta = DATA.photos[id]; if (!meta) return []
  const day = meta[0], t = mins(meta[1])
  const out: [string, string, string, number][] = []
  for (const w of WHO(id).slice().sort((a, b) => a[1] - b[1])) {
    const k = w[0], per = personFor(k), p = live.info.get(k)
    if (!per || !p || !p.name) continue
    const line = [p.title, p.org].filter(Boolean).join(', ')
    if (k === owner) { out.push([p.name, line, p.linkedin, 1]); continue }
    if (per.check) continue
    if (w[2] >= 80 && !per.guest) continue
    const onStage = (live.byKey.get(k) || []).some(s => inSession(s, day, t))
    if (p.official ? !onStage : !(onStage || w[3] >= STRONG)) continue
    if (live.presence(k, day) === false) continue
    if (out.some(x => x[0] === p.name)) continue
    out.push([p.name, line, p.linkedin, 0])
  }
  return out
}

// ---------- reading who gets what ----------

type Row = { key: string; name: string; org: string; kinds: string[]; count: number; best: string[]; email: string; email_source: string;
  email_note: string; protocol: boolean; status: string; sent_at: string; sent_count: number; talk: boolean; company: string; for_speaker: boolean; guest: boolean }

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

// waiting: album keys whose session line-up is flagged and not yet confirmed (status 'panel').
async function rowsFor(c: any, eventId = 1, waiting: Set<string> = new Set()): Promise<Row[]> {
  const [speakers, talks, contacts, sent] = await Promise.all([
    all(c, 'SELECT id, name, role, organisation, email, is_published FROM speakers WHERE event_id = ?', eventId).catch(() => [] as any[]),
    all(c, 'SELECT id, speaker_name, speaker_title, company, status FROM innovation_talks WHERE event_id = ?', eventId).catch(() => [] as any[]),
    hooks.talkContacts ? hooks.talkContacts(c, eventId).catch(() => ({} as Record<string, Contact>)) : Promise.resolve({} as Record<string, Contact>),
    sentLog(c)])
  const spBy = new Map(speakers.map((s: any) => [Number(s.id), s]))
  const tBy = new Map(talks.map((t: any) => [Number(t.id), t]))
  const rows: Row[] = []
  const covered = new Set<string>()
  const build = (key: string, name: string, sIds: number[], tIds: number[], photos: string[], best: string[], check = false, guest: Guest | null = null) => {
    const sps = sIds.map(id => spBy.get(id)).filter(Boolean) as any[]
    const tks = tIds.map(id => tBy.get(id)).filter(Boolean) as any[]
    if (!sps.length && !tks.length && !guest) return // no longer on the programme
    const gEmail = guest ? String(guest.email || '').trim().toLowerCase() : ''
    for (const s of sps) covered.add('s' + s.id)
    for (const t of tks) covered.add('t' + t.id)
    const spEmail = sps.map(s => String(s.email || '').trim().toLowerCase()).find(Boolean) || ''
    const tc = tks.map(t => contacts[String(t.id)]).find(x => x && x.email) || null
    const email = spEmail || (tc ? String(tc.email).trim().toLowerCase() : '') || gEmail
    const source = spEmail ? 'speaker' : tc ? tc.source : gEmail ? 'guest' : 'none'
    const protocol = sps.some(s => isProtocol(s)) || tks.some(t => !!(contacts[String(t.id)] || {}).protocol) || (!!guest && isProtocol({ name: guest.name, role: guest.title }))
    const s = sent.get(key)
    const count = byDay(photos).reduce((n, g) => n + g.ids.length, 0)
    const status = !count ? 'no-photos' : protocol ? 'protocol' : !email ? 'no-email' : s ? 'sent' : waiting.has(key) ? 'panel' : check ? 'check' : 'ready'
    const isGuest = !!guest && !sps.length && !tks.length
    rows.push({ key, name: sps[0]?.name || tks[0]?.speaker_name || guest?.name || name, org: sps[0]?.organisation || tks[0]?.company || guest?.title || '',
      kinds: [...(sps.length ? ['Speaker'] : []), ...(tks.length ? ['Innovation Talk'] : []), ...(isGuest ? [guest!.role || 'Guest'] : [])], count, best: best.slice(0, 3),
      email, email_source: source, email_note: spEmail ? "The speaker's own email" : tc ? tc.note : gEmail ? 'From the guest list' : 'No email on file', protocol, status,
      sent_at: s ? s.at : '', sent_count: s ? s.n : 0, talk: !sps.length && tks.length > 0, company: tks[0]?.company || sps[0]?.organisation || '',
      for_speaker: isGuest || source === 'speaker' || source === 'team', guest: isGuest })
  }
  for (const p of albumPeople()) build(p.key, p.name, p.speakers || [], p.talks || [], p.photos || [], p.best || [], !!p.check, p.guest || null)
  // Everyone on the programme with no photo found, so the list shows who is missing.
  // The same person under both lists is one row (matched by name).
  const named = new Map<string, { s: number[]; t: number[]; name: string }>()
  for (const s of speakers) if (!covered.has('s' + s.id) && Number(s.is_published ?? 1)) { const k = normName(s.name); const g = named.get(k) || { s: [], t: [], name: s.name }; g.s.push(Number(s.id)); named.set(k, g) }
  for (const t of talks) if (!covered.has('t' + t.id) && String(t.status || '') !== 'cancelled') { const k = normName(t.speaker_name); const g = named.get(k) || { s: [], t: [], name: t.speaker_name }; g.t.push(Number(t.id)); named.set(k, g) }
  for (const g of named.values()) build(g.s.length ? 's' + g.s[0] : 't' + g.t[0], g.name, g.s, g.t, [], [])
  const order: Record<string, number> = { ready: 0, check: 1, panel: 2, sent: 3, 'no-email': 4, protocol: 5, 'no-photos': 6 }
  rows.sort((a, b) => (order[a.status] - order[b.status]) || a.name.localeCompare(b.name))
  return rows
}

async function mailFor(c: any, r: Row, live: Live | null = null) {
  const p = personFor(r.key)
  const lv = live || await liveProgramme(c)
  const lineup = lineupHTML(lv.byKey.get(r.key) || [], true)
  const href = await pageUrl(c, r.key)
  const header = hooks.emailHeader ? hooks.emailHeader('Your photos', MUMBAI_WORDS.line) : ''
  const best = p ? p.best : []
  // Signed for this person (the album key), the small size only.
  const got = best.length ? await linksForDrive(c, r.key, best) : {}
  return photosEmailHTML({ name: r.name, count: r.count, best, href, header, talk: r.talk, forSpeaker: r.for_speaker, company: r.company, got, guest: r.guest, lineup })
}

// The live programme, every session's line-up check, the organiser's confirmations, and
// who is waiting for one, in one go (one D1 round of reads).
async function panelState(c: any) {
  const live = await liveProgramme(c)
  const checks = new Map(live.sessions.map(s => [s.id, checkSession(s, live)] as [string, PanelCheck]))
  const ok = await confirmedPanels(c)
  const waiting = new Set<string>()
  for (const k of live.byKey.keys()) if (waitingFor(k, live, checks, ok).length) waiting.add(k)
  return { live, checks, ok, waiting }
}

// ---------- routes ----------

ph.get('/api/admin/speaker-photos', async (c) => {
  const st = await panelState(c)
  const rows = await rowsFor(c, 1, st.waiting)
  // The small pictures on the list, from R2 as the organiser ('admin', never counted).
  const got = await linksForDrive(c, 'admin', [...new Set(rows.flatMap(r => r.best))])
  const withLinks = await Promise.all(rows.map(async r => ({ ...r, page: r.count ? await pageUrl(c, r.key) : '', thumbs: r.best.map(id => got[id]?.s || thumbUrl(id, 120)) })))
  const counts: Record<string, number> = {}
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1
  // Every session with a line-up to check: flagged ones first, then the rest (for a look).
  const panels = [...st.checks.values()].filter(k => k.people.length + k.typed.length > 0)
    .map(k => ({ ...k, confirmed: st.ok.get(k.id) === k.fp, confirmed_before: st.ok.has(k.id) && st.ok.get(k.id) !== k.fp,
      waiting: rows.filter(r => (st.live.byKey.get(r.key) || []).some(s => s.id === k.id) && r.status === 'panel').map(r => r.name) }))
    .sort((a, b) => Number(b.flagged && !b.confirmed) - Number(a.flagged && !a.confirmed) || a.when.localeCompare(b.when))
  return c.json({ generated: DATA.generated, folder: DATA.folder, rows: withLinks, counts, photos: Object.keys(DATA.photos || {}).length, panels })
})

ph.get('/api/admin/speaker-photos/:key/preview', async (c) => {
  const key = c.req.param('key')
  const st = await panelState(c)
  const r = (await rowsFor(c, 1, st.waiting)).find(x => x.key === key)
  if (!r) return c.json({ error: 'That person is not on the list any more.' }, 404)
  if (!r.count) return c.json({ error: 'No photos of ' + r.name + ' were found.' }, 409)
  const mail = await mailFor(c, r, st.live)
  return c.json({ to: r.email, subject: mail.subject, html: mail.html, page: await pageUrl(c, r.key), status: r.status })
})

ph.post('/api/admin/speaker-photos/:key/send', async (c) => {
  const b = await c.req.json().catch(() => ({})) as any
  const key = c.req.param('key')
  const st = await panelState(c)
  const r = (await rowsFor(c, 1, st.waiting)).find(x => x.key === key)
  if (!r) return c.json({ error: 'That person is not on the list any more.' }, 404)
  if (!r.count) return c.json({ error: 'No photos of ' + r.name + ' were found.' }, 409)
  if (r.status === 'panel') return c.json({ error: 'Check the line-up of ' + r.name + '’s session first (Panels to check, above), so the email names the right people.', panel: true }, 409)
  if (!r.email) return c.json({ error: 'There is no email address for ' + r.name + '.' }, 409)
  if (r.protocol && !b.anyway) return c.json({ error: r.name + ' is a government official: their office handles protocol. Send anyway from their row if you are sure.' }, 409)
  if (r.sent_count && !b.again) return c.json({ error: r.name + ' was already sent their photos on ' + r.sent_at + '.', already: true }, 409)
  if (!secretOf(c)) return c.json({ error: 'Photo links cannot be signed on this server.' }, 503)
  if (!hooks.sendEmail) return c.json({ error: 'Email is not set up on this server.' }, 503)
  const mail = await mailFor(c, r, st.live)
  const sent = await hooks.sendEmail(c, r.email, mail.subject, mail.html)
  if (!sent.ok) return c.json({ error: sent.error || 'The email did not go.' }, 502)
  if (hooks.audit) {
    try { await hooks.audit(c, AUDIT_ACTION, 'photo_album', r.key, { name: r.name, to: r.email, source: r.email_source, count: r.count, again: !!b.again }) }
    catch { /* the audit log never fails a send */ }
  }
  return c.json({ success: true, to: r.email, count: r.count })
})

// The organiser confirms a session's line-up as it is now (fp = its fingerprint then). If
// the programme changes afterwards, it is checked again.
ph.post('/api/admin/speaker-photos/panels/:id/ok', async (c) => {
  const id = c.req.param('id')
  const b = await c.req.json().catch(() => ({})) as any
  const st = await panelState(c)
  const k = st.checks.get(id)
  if (!k) return c.json({ error: 'That session is not on the programme any more.' }, 404)
  if (String(b.fp || '') !== k.fp) return c.json({ error: 'The line-up changed since this page loaded. Look at it again.', changed: true }, 409)
  if (hooks.audit) await hooks.audit(c, PANEL_OK, 'session', id, { fp: k.fp, title: k.title, people: k.people.map(p => p.name), reasons: k.reasons })
  return c.json({ success: true, id, fp: k.fp })
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
  let org = '', name = p!.name
  try {
    if (p!.speakers.length) org = String(((await c.env.DB.prepare('SELECT organisation FROM speakers WHERE id = ?').bind(p!.speakers[0]).first()) as any)?.organisation || '')
    else if (p!.talks.length) org = String(((await c.env.DB.prepare('SELECT company FROM innovation_talks WHERE id = ?').bind(p!.talks[0]).first()) as any)?.company || '')
    else if (p!.guest) org = p!.guest.title || ''
    else if (p!.attendee) {
      const a = (await c.env.DB.prepare('SELECT name, company FROM attendees WHERE id = ? AND event_id = 1').bind(Number(p!.key.slice(1))).first()) as any
      name = String(a?.name || '').trim() || 'you'; org = String(a?.company || '').trim()
    }
  } catch { /* the page shows without it */ }
  // An attendee who said "Don't match my photos" sees no photos, and "Not me" photos are gone.
  const mine = p!.attendee ? await attendeeChoices(c, p!.key) : { optedOut: false, notMe: new Set<string>() }
  if (mine.optedOut) return new Response(albumPageHTML({ name, org, ids: [] }).replace('No photos here yet.', 'You asked us not to match your photos, so there are none here.'), { headers: head })
  const ids = p!.photos.filter(id => !mine.notMe.has(id))
  // Links signed for the album's own key, so every way into this person's page shares
  // one count of full-size saves.
  const got = await linksForDrive(c, p!.key, ids)
  const saves = Object.keys(got).length ? { limit: await downloadLimit(c, p!.key), used: await downloadsUsed(c, p!.key) } : null
  // Their session(s) and who else is in each photo, from the live programme. Only speakers
  // and named guests are ever named; an attendee never is.
  const live = await liveProgramme(c)
  const names: Record<string, [string, string, string, number][]> = {}
  for (const id of ids) names[id] = namesIn(id, p!.key, live)
  return new Response(albumPageHTML({ name, org, ids, focus: p!.focus, got, saves, lineup: lineupHTML(live.byKey.get(p!.key) || [], false), names,
    me: p!.attendee ? { key: p!.key, k: String(c.req.query('k') || ''), order: p!.photos } : undefined }), { headers: head })
})

// ---------- attendees: their own choices ----------
// Recorded in admin_audit (entity 'photo_album', the album key), as the attendee:
// 'photos.not_me' (detail.photo = the Drive id) and 'photos.opt_out'. The next matching run
// leaves an opted-out person out (read these first).
export const NOT_ME = 'photos.not_me', OPT_OUT = 'photos.opt_out'
async function attendeeChoices(c: any, key: string): Promise<{ optedOut: boolean; notMe: Set<string> }> {
  const notMe = new Set<string>(); let optedOut = false
  try {
    for (const r of await all(c, "SELECT action, detail FROM admin_audit WHERE entity = 'photo_album' AND entity_id = ? AND action IN (?, ?)", key, NOT_ME, OPT_OUT)) {
      if (r.action === OPT_OUT) optedOut = true
      else { try { const d = JSON.parse(r.detail || '{}'); if (d.photo) notMe.add(String(d.photo)) } catch { /* not JSON */ } }
    }
  } catch { /* no audit table */ }
  return { optedOut, notMe }
}
async function signedAttendee(c: any, b: any): Promise<Person | null> {
  const key = String(b?.key || '')
  if (!isAttendee(key)) return null
  const p = personFor(key)
  return p && sameText(await photoSig(c, key), String(b?.k || '')) ? p : null
}
ph.post('/api/photos/not-me', async (c) => {
  const b = await c.req.json().catch(() => ({})) as any
  const p = await signedAttendee(c, b)
  if (!p) return c.json({ error: 'This link is not complete.' }, 403)
  const id = p.photos[Number(b.n)]
  if (!Number.isInteger(Number(b.n)) || !id) return c.json({ error: 'No such photo.' }, 404)
  if (hooks.audit) await hooks.audit(c, NOT_ME, 'photo_album', p.key, { photo: id }, { actor: p.key, kind: 'attendee' })
  // The photo store's own record too, when the photo is in R2 (migration 0064).
  try { await c.env.DB.prepare("INSERT INTO photo_matches (photo_id, person, source, state, updated_at) SELECT id, ?, 'face', 'not_me', CURRENT_TIMESTAMP FROM event_photos WHERE drive_id = ? ON CONFLICT (photo_id, person) DO UPDATE SET state = 'not_me', updated_at = CURRENT_TIMESTAMP").bind(p.key, id).run() } catch { /* no 0064 here */ }
  return c.json({ success: true })
})
ph.post('/api/photos/opt-out', async (c) => {
  const b = await c.req.json().catch(() => ({})) as any
  const p = await signedAttendee(c, b)
  if (!p) return c.json({ error: 'This link is not complete.' }, 403)
  if (hooks.audit) await hooks.audit(c, OPT_OUT, 'photo_album', p.key, { photos: p.photos.length }, { actor: p.key, kind: 'attendee' })
  try { await c.env.DB.prepare("UPDATE photo_matches SET state = 'removed', updated_at = CURRENT_TIMESTAMP WHERE person = ?").bind(p.key).run() } catch { /* no 0064 here */ }
  return c.json({ success: true })
})

// ---------- attendees: Admin -> After the Event -> Attendee photos ----------
export const ATT_SENT = 'attendee.photos'
type AttRow = { key: string; id: number; name: string; email: string; company: string; pass: string; group: number; group_name: string; came: boolean; check: boolean;
  count: number; best: string[]; status: string; sent_at: string; sent_count: number }
async function attendeeRows(c: any): Promise<AttRow[]> {
  const keys = Object.keys(ATT.albums || {})
  const ids = keys.map(k => Number(k.slice(1)))
  const people = new Map<number, any>()
  for (let i = 0; i < ids.length; i += 90) {
    const ch = ids.slice(i, i + 90)
    try { for (const a of await all(c, `SELECT id, name, email, company, badge_type, unsubscribed_at FROM attendees WHERE event_id = 1 AND id IN (${ch.map(() => '?').join(',')})`, ...ch)) people.set(Number(a.id), a) } catch { /* no attendees table */ }
  }
  const sent = new Map<string, { at: string; n: number }>(); const choices = new Map<string, { out: boolean; notMe: Set<string> }>()
  try {
    for (const r of await all(c, "SELECT action, entity_id, detail, created_at FROM admin_audit WHERE action IN (?, ?, ?) ORDER BY id", ATT_SENT, NOT_ME, OPT_OUT)) {
      const k = String(r.entity_id)
      if (r.action === ATT_SENT) { const w = sent.get(k); sent.set(k, { at: String(r.created_at || ''), n: (w ? w.n : 0) + 1 }); continue }
      const ch = choices.get(k) || { out: false, notMe: new Set<string>() }
      if (r.action === OPT_OUT) ch.out = true; else { try { const d = JSON.parse(r.detail || '{}'); if (d.photo) ch.notMe.add(String(d.photo)) } catch { /* not JSON */ } }
      choices.set(k, ch)
    }
  } catch { /* no audit table */ }
  const rows: AttRow[] = []
  for (const k of keys) {
    const al = ATT.albums[k], a = people.get(Number(k.slice(1)))
    if (!a) continue // no longer registered
    const ch = choices.get(k)
    const count = al.photos.filter(id => !(ch && ch.notMe.has(id))).length
    const email = String(a.email || '').trim().toLowerCase()
    const s = sent.get(k)
    const status = ch && ch.out ? 'opted-out' : !count ? 'no-photos' : a.unsubscribed_at ? 'unsubscribed' : !email || /@no-email\.invalid$/.test(email) ? 'no-email' : s ? 'sent' : al.check ? 'check' : 'ready'
    rows.push({ key: k, id: Number(a.id), name: String(a.name || ''), email, company: String(a.company || ''), pass: String(a.badge_type || ''), group: al.group,
      group_name: (ATT.groups || [])[al.group] || '', came: al.came, check: al.check, count, best: al.best.filter(id => !(ch && ch.notMe.has(id))).slice(0, 6),
      status, sent_at: s ? s.at : '', sent_count: s ? s.n : 0 })
  }
  const order: Record<string, number> = { ready: 0, check: 1, sent: 2, 'no-email': 3, unsubscribed: 4, 'opted-out': 5, 'no-photos': 6 }
  rows.sort((x, y) => x.group - y.group || order[x.status] - order[y.status] || x.name.localeCompare(y.name))
  return rows
}
async function attendeeMail(c: any, r: AttRow) {
  const href = await pageUrl(c, r.key)
  const header = hooks.emailHeader ? hooks.emailHeader('Your photos', MUMBAI_WORDS.line) : ''
  const got = r.best.length ? await linksForDrive(c, r.key, r.best) : {}
  // No line-up and no one else's name: an attendee's email is only their own photos.
  return photosEmailHTML({ name: r.name, count: r.count, best: r.best, href, header, talk: false, forSpeaker: true, got, attendee: true })
}
ph.get('/api/admin/attendee-photos', async (c) => {
  const rows = await attendeeRows(c)
  const got = await linksForDrive(c, 'admin', [...new Set(rows.flatMap(r => r.best.slice(0, 3)))])
  const out = await Promise.all(rows.map(async r => ({ ...r, page: await pageUrl(c, r.key), thumbs: r.best.slice(0, 3).map(id => got[id]?.s || thumbUrl(id, 120)) })))
  const groups = (ATT.groups || []).map((g, i) => {
    const mine = rows.filter(r => r.group === i), n = (st: string) => mine.filter(r => r.status === st).length
    return { group: i, name: g, found: mine.length, ready: n('ready'), check: n('check'), sent: n('sent'), no_email: n('no-email') + n('unsubscribed'), opted_out: n('opted-out'), not_scanned: mine.filter(r => !r.came).length }
  })
  return c.json({ generated: ATT.generated, groups, rows: out })
})
ph.get('/api/admin/attendee-photos/:key/preview', async (c) => {
  const r = (await attendeeRows(c)).find(x => x.key === c.req.param('key'))
  if (!r) return c.json({ error: 'That person is not on the list.' }, 404)
  const mail = await attendeeMail(c, r)
  return c.json({ to: r.email, subject: mail.subject, html: mail.html, page: await pageUrl(c, r.key), status: r.status })
})
ph.post('/api/admin/attendee-photos/:key/send', async (c) => {
  const b = await c.req.json().catch(() => ({})) as any
  const r = (await attendeeRows(c)).find(x => x.key === c.req.param('key'))
  if (!r) return c.json({ error: 'That person is not on the list.' }, 404)
  if (r.status === 'opted-out') return c.json({ error: r.name + ' asked us not to match their photos.' }, 409)
  if (r.status === 'unsubscribed') return c.json({ error: r.name + ' unsubscribed from our emails.' }, 409)
  if (!r.count) return c.json({ error: 'No photos of ' + r.name + ' are left.' }, 409)
  if (r.status === 'no-email') return c.json({ error: 'There is no email address for ' + r.name + '.' }, 409)
  if (r.sent_count && !b.again) return c.json({ error: r.name + ' was already sent their photos on ' + r.sent_at + '.', already: true }, 409)
  if (!secretOf(c)) return c.json({ error: 'Photo links cannot be signed on this server.' }, 503)
  if (!hooks.sendEmail) return c.json({ error: 'Email is not set up on this server.' }, 503)
  const mail = await attendeeMail(c, r)
  const sent = await hooks.sendEmail(c, r.email, mail.subject, mail.html)
  if (!sent.ok) return c.json({ error: sent.error || 'The email did not go.' }, 502)
  if (hooks.audit) { try { await hooks.audit(c, ATT_SENT, 'photo_album', r.key, { to: r.email, count: r.count, group: r.group_name, again: !!b.again }) } catch { /* never fails a send */ } }
  return c.json({ success: true, to: r.email, count: r.count })
})

export default ph
