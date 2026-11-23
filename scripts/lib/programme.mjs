// The conference programme and the speakers, as the app holds them (Admin -> Conference,
// D1), turned into what the website shows. One module, two callers (16 Nov 2026):
//
//   - scripts/gen-schedule.mjs and scripts/gen-speakers.mjs run it in Node at build time
//     and write public/conference.html, public/mumbai.html and public/llms.txt;
//   - the worker runs it on every request for /conference (src/routes/site-live.ts), so a
//     change made in Admin is on the website within a minute, before any build.
//
// So: plain JavaScript, no Node imports, nothing read from disk. Pictures (the small
// photos and logos in public/images/sched/) are given by the caller: Node bakes them with
// sharp, the worker reads the manifest the generator wrote.
//
// Two shapes:
//   programme (programme.json): what GET /api/events/:id/programme answers: the event, its
//     halls, every published session with its people, the published speakers, the talks.
//   S (schedule.json): the website's own shape, one entry per schedule item with hall key,
//     day, start, end, type, label, title, speaker / panel / moderator, company, track.
//     programmeFromApp() turns the first into the second.

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// One name, however it is written: "Shri. K.K. Singh", "Shri K.K. Singh (IAS)" and
// "Hon’ble Shri K.K. Singh" are the same person.
export const norm = (n) => String(n ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\(\s*(ias|ifs|ips|irs|phd|ph\.?\s?d\.?|retd\.?|retired)\s*\)/g, ' ')
  .replace(/hon[’'`]?ble/g, ' ')
  .replace(/[‘’'`]/g, '')
  .replace(/\b(shri|shree|smt|sushri|mr|mrs|ms|miss|dr|prof|professor|cmde|col|capt|lt|gen|adv|er)\b\.?/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ').trim()
export const slugOf = (name) => String(name ?? '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
export const personSlug = (name) => norm(name).replace(/ /g, '-')
export const initials = (name) => { const w = norm(name).split(' ').filter(Boolean); return ((w[0]?.[0] || '') + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase() }
// A company, however it is written: "NoBroker.com", "NoBroker" and "Nobroker Pvt Ltd" match.
export const coKey = (v) => String(v || '').toLowerCase().replace(/&/g, ' and ').replace(/\b(pvt|private|ltd|limited|llp|inc|com)\b/g, ' ').replace(/[^a-z0-9]+/g, '')

// "A (Org), B (Org), C (Moderator)" -> [{name, info, role}], as src/routes/conference.ts
// splits it: commas inside brackets do not split; a trailing bracket is the person's
// organisation, or their part; "(IAS)" and the like are part of the name.
export function splitSpeakerLine(line) {
  const parts = []
  let depth = 0, cur = ''
  for (const ch of String(line || '')) {
    if (ch === '(') depth++
    if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) { if (cur.trim()) parts.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts.map((p) => {
    let name = p, info = ''
    const m = p.match(/^(.*?)\s*\(([^()]*)\)\s*$/)
    if (m && m[1].trim() && !/^(ias|ifs|ips|irs|phd)$/i.test(m[2].trim())) { name = m[1].trim(); info = m[2].trim() }
    const low = info.toLowerCase()
    const role = low === 'moderator' ? 'moderator' : (low === 'host' || low === 'chair') ? low : ''
    return { name: name.trim(), info, role }
  })
}

// ---- halls ----
// The keys name the venue's ROOMS, not the event's hall names: on 12 Nov 2026 Kalam and
// Aryabhata swapped names but kept their keys, and every #sch-<key>-... anchor since
// then uses them. A hall added in Admin gets a key from its name.
export const HALL_KEYS = { 'Homi J. Bhabha Hall': 'bhabha', 'Aryabhata Theatre': 'kalam', 'Raman Theatre': 'raman', 'Kalam Theatre': 'aryabhata' }
const HALL_EXTRAS = { bhabha: { icon: '🏛️' }, kalam: { icon: '🚀', about: 'Innovation Talks by exhibitors' }, raman: { icon: '🔬', about: 'Workshops' }, aryabhata: { icon: '🎭' } }
export const hallKey = (name) => HALL_KEYS[String(name || '').trim()] || slugOf(name) || 'hall'

// ---- dates ----
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const dateOf = (ymd) => new Date(String(ymd).slice(0, 10) + 'T00:00:00Z')
// Every day from the event's first to its last, 'YYYY-MM-DD'.
export function eventDays(event) {
  const a = dateOf(event?.start_date || '2026-11-20'), b = dateOf(event?.end_date || event?.start_date || '2026-11-21')
  const out = []
  for (let t = a.getTime(); t <= b.getTime() && out.length < 7; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10))
  return out.length ? out : ['2026-11-20', '2026-11-21']
}
const dayTabText = (ymd, n) => { const d = dateOf(ymd); return `Day ${n} — ${MON[d.getUTCMonth()]} ${d.getUTCDate()}` }
const dayShortText = (ymd) => { const d = dateOf(ymd); return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}` }
export const dayLongText = (ymd) => { const d = dateOf(ymd); return `${d.getUTCDate()} ${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}` }

// ---- the app's programme -> the website's schedule (S) ----

const TYPE_MAP = { keynote: 'keynote', talk: 'talk', panel: 'panel', workshop: 'workshop', break: 'break', networking: 'networking', ceremony: 'keynote', exhibition: 'break' }
const firstSentence = (s) => { const m = String(s || '').match(/^(.*?[.!?])(\s+|$)([\s\S]*)$/); return m ? [m[1].trim(), m[3].trim()] : [String(s || '').trim(), ''] }

// "Powered by EXENI." anywhere in a session's description (Admin -> Conference) names the
// session's sponsor (19 Nov 2026). The sentence leaves the note; the schedule draws
// "Powered by" with the sponsor's logo (images/org-logos/<slug>.webp, else the exhibitor
// wall's images/exhibitors/<slug>.webp), or its name in words.
export function poweredBy(desc) {
  const text = String(desc || '').trim()
  const m = text.match(/(^|[.!?]\s+)Powered by\s+([^.!?]+?)\s*(?:[.!?]|$)/i)
  if (!m) return { name: '', rest: text }
  const rest = (text.slice(0, m.index) + (m[1] ? m[1].trim() : '') + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim()
  return { name: m[2].trim(), rest }
}
export const poweredLogoFiles = (name) => [`images/org-logos/${slugOf(name)}.webp`, `images/exhibitors/${slugOf(name)}.webp`]

// What kind of item it is, in the website's words: the label the schedule prints for
// breaks and networking ("Lunch", "Evening"), and for a panel its subject ("Panel: BFSI").
export function labelFor(s, type, desc) {
  const t = String(s.title || '')
  if (type === 'break') {
    if (/registration/i.test(t)) return 'Registration'
    if (/lunch/i.test(t)) return 'Lunch'
    if (/tea|coffee/i.test(t)) return 'Tea'
    if (/exhibition|floor/i.test(t)) return 'Exhibition'
    return 'Break'
  }
  if (type === 'networking') return /round ?table/i.test(t) ? 'Round Table' : /evening|gala|night|dinner/i.test(t) ? 'Evening' : 'Networking'
  if (type === 'workshop') return 'Workshop'
  if (type === 'keynote') {
    if (/^welcome/i.test(t)) return 'Welcome'
    if (/inaugur/i.test(t)) return 'Inauguration'
    if (/^closing/i.test(t)) return 'Closing'
    if (/special address/i.test(t)) return 'Special Address'
    if (/^keynotes$/i.test(t)) return 'Keynotes'
    return 'Keynote'
  }
  // A panel or a talk: the description's first sentence names the kind when it was
  // written that way ("Panel: Governance", "Leadership Talk", "Product Demonstration").
  const [first] = firstSentence(desc)
  if (type === 'panel') return /^panel\b/i.test(first) ? first.replace(/\.$/, '') : 'Panel'
  if (/^(innovation talk|leadership talk|product demonstration|fireside chat|talk)\b/i.test(first)) return first.replace(/\.$/, '')
  if (/product demonstration/i.test(t)) return 'Product Demonstration'
  if (/leadership talk|leaders speaking/i.test(t)) return 'Leadership Talk'
  return 'Innovation Talk'
}

// The people in a session, in the order the typed line names them, each found on the
// speakers list by name when they are on it (role, organisation, photo), otherwise as
// typed. `links` (saved or derived in the app) say who is the moderator.
export function peopleOf(s, speakersByNorm) {
  const links = new Map((s.links || []).map((l) => [Number(l.speaker_id), l.role || '']))
  const parts = splitSpeakerLine(s.speaker_name)
  const out = []
  const seen = new Set()
  for (const p of parts) {
    const k = norm(p.name)
    if (!k || seen.has(k)) continue
    seen.add(k)
    const sp = speakersByNorm.get(k)
    const part = p.role || (sp && links.get(Number(sp.id))) || ''
    if (sp) out.push({ speaker_id: Number(sp.id), name: sp.name, role: sp.role || '', organisation: sp.organisation || '', photo_url: sp.photo_url || '', part })
    else out.push({ speaker_id: null, name: p.name, info: p.info, part })
  }
  // A saved link whose person the line does not name (it should, the app rewrites the
  // line on every save, but a hand-run SQL may not have): still shown, after the rest.
  for (const [id, part] of links) {
    const sp = [...speakersByNorm.values()].find((x) => Number(x.id) === id)
    if (sp && !seen.has(norm(sp.name))) { seen.add(norm(sp.name)); out.push({ speaker_id: id, name: sp.name, role: sp.role || '', organisation: sp.organisation || '', photo_url: sp.photo_url || '', part }) }
  }
  return out
}

// programme (the app) -> S (the website's schedule.json shape). The app's words win;
// what is not in the app (hall icons, the "everyone gathers in the main hall" rows for
// the other halls) is added here.
export function programmeFromApp(programme) {
  const days = eventDays(programme.event)
  const dayNo = new Map(days.map((d, i) => [d, i + 1]))
  const speakersByNorm = new Map()
  for (const sp of programme.speakers || []) { const k = norm(sp.name); if (k && !speakersByNorm.has(k)) speakersByNorm.set(k, sp) }
  // Halls: the app's list (active, in its order), plus any room a session names.
  const halls = []
  const addHall = (name, extra = {}) => {
    const key = hallKey(name)
    if (halls.some((h) => h.key === key)) return
    halls.push({ key, name: String(name).trim(), venue: extra.location || '', icon: HALL_EXTRAS[key]?.icon || '🎤', ...(HALL_EXTRAS[key]?.about ? { about: HALL_EXTRAS[key].about } : extra.purpose && !/keynote|panel/i.test(extra.purpose) ? { about: extra.purpose } : {}) })
  }
  for (const h of programme.halls || []) if (h && h.name && Number(h.is_active) !== 0) addHall(h.name, h)
  for (const s of programme.sessions || []) if (s.room) addHall(s.room)
  if (!halls.length) addHall('Homi J. Bhabha Hall')
  // Talks by company, for the Expo Hall rows ("Innovation Talk: <company>").
  const talks = (programme.talks || []).filter((t) => (t.status || 'confirmed') === 'confirmed')
  const talkByCo = new Map()
  for (const t of talks) { const k = coKey(t.company); if (k && !talkByCo.has(k)) talkByCo.set(k, t) }
  const talkByName = new Map()
  for (const t of talks) { const k = norm(t.speaker_name); if (k && !talkByName.has(k)) talkByName.set(k, t) }

  const sessions = []
  for (const s of programme.sessions || []) {
    if (s.status === 'draft') continue
    const day = dayNo.get(String(s.start_time || '').slice(0, 10))
    if (!day) continue
    const type = TYPE_MAP[s.session_type] || 'talk'
    const sponsor = poweredBy(s.description)
    const desc = sponsor.rest
    const label = labelFor(s, type, desc)
    const item = { hall: hallKey(s.room), day, start: String(s.start_time).slice(11, 16), end: String(s.end_time).slice(11, 16), type, label, id: Number(s.id) }
    if (s.track) item.track = s.track
    if (sponsor.name) item.poweredBy = sponsor.name
    const title = String(s.title || '').trim()
    const co = title.match(/^innovation talk\s*[:\-–]\s*(.+)$/i)
    const people = s.people || peopleOf(s, speakersByNorm)
    if (co) {
      // An exhibitor's or a department's talk on the Innovation Talks stage.
      item.company = co[1].trim()
      const t = talkByCo.get(coKey(item.company)) || (people[0] ? talkByName.get(norm(people[0].name)) : null)
      if (t) item.talk = { name: t.speaker_name, title: t.speaker_title || '', company: item.company, topic: t.topic || '', photo: t.photo_url || '', hall: t.hall || '' }
      else if (people[0]) item.speaker = people[0].speaker_id
        ? { name: people[0].name, role: people[0].role || '', org: people[0].organisation || item.company, photo: people[0].photo_url || '', listed: true }
        : { name: people[0].name, role: s.speaker_title || people[0].info || '', org: '', photo: '' }
      if (desc && !/to be announced/i.test(desc) && !t) item.note = desc
      else if (!t && !people[0]) item.note = 'Speaker to be announced.'
      // The topic: the talk's own; the words written for the website when the app has none.
      if (t && !t.topic && desc && !/to be announced/i.test(desc)) item.talk.topic = desc
    } else {
      // The title is the item's own unless it only repeats the kind ("Keynote").
      if (title && !(type === 'keynote' && /^keynotes?$/i.test(title))) item.title = title
      // The description: the kind of panel or talk first, then the note.
      let note = desc
      if (['panel', 'talk'].includes(type)) {
        const [first, rest] = firstSentence(desc)
        if (first && (first.replace(/\.$/, '') === label || /^(panel|innovation talk|leadership talk|product demonstration|fireside chat)\b/i.test(first))) note = rest
      }
      if (note) item.note = note
      const mod = people.find((p) => p.part === 'moderator')
      const rest = people.filter((p) => p.part !== 'moderator')
      if (type === 'panel' || people.length > 1) {
        const panellist = (p) => ({ name: p.name, org: p.organisation || p.info || '', role: p.role || '', photo: p.photo_url || '', ...(p.speaker_id ? { listed: true } : {}) })
        item.panel = rest.map(panellist)
        if (mod) item.moderator = panellist(mod)
      } else if (mod) {
        // Only a moderator so far: shown as the moderator, not as the speaker.
        item.moderator = { name: mod.name, org: mod.organisation || mod.info || '', role: mod.role || '', photo: mod.photo_url || '', ...(mod.speaker_id ? { listed: true } : {}) }
      } else if (people.length === 1) {
        // A listed speaker: the designation and organisation Admin holds. Someone typed
        // by hand: the title line as typed ("Designation, Organisation").
        const p = people[0]
        item.speaker = p.speaker_id
          ? { name: p.name, role: p.role || '', org: p.organisation || '', photo: p.photo_url || '', listed: true }
          : { name: p.name, role: s.speaker_title || p.info || '', org: '', photo: '' }
      }
    }
    sessions.push(item)
  }
  // The other halls, while everyone is in the main hall for the opening keynotes.
  const main = halls[0]
  for (const day of dayNo.values()) {
    const inMain = sessions.filter((x) => x.hall === main.key && x.day === day && x.type !== 'break').sort((a, b) => (a.start < b.start ? -1 : 1))
    const firstOther = inMain.find((x) => x.type !== 'keynote')
    const opening = inMain.filter((x) => x.type === 'keynote' && (!firstOther || x.start < firstOther.start))
    if (!opening.length) continue
    const start = opening[0].start, end = opening[opening.length - 1].end
    const inaug = opening.some((x) => x.label === 'Inauguration')
    for (const h of halls.slice(1)) {
      if (sessions.some((x) => x.hall === h.key && x.day === day && x.type !== 'break' && x.start < end && start < x.end)) continue
      sessions.push({ hall: h.key, day, start, end, type: 'elsewhere', label: inaug ? 'Inauguration' : 'Welcome', title: `${inaug ? 'Inauguration' : 'Welcome'} and keynotes in ${main.name}`, note: `Everyone gathers in ${main.name}.` })
    }
  }
  const order = (a, b) => a.day - b.day || (a.start < b.start ? -1 : a.start > b.start ? 1 : 0) || halls.findIndex((h) => h.key === a.hall) - halls.findIndex((h) => h.key === b.hall)
  sessions.sort(order)
  return { source: `the app (Admin → Conference), ${programme.generated_at || ''}`.trim(), days, halls, sessions }
}

// ---- the people on the schedule, with their pictures ----

// A directory of who is who on the website (scripts/data/schedule-people.json): the
// photo, the logo and a crop for a face that is off-centre, and the words to use when
// the app has none (someone typed on a panel who is not a listed speaker).
export function makeDirectory(people) {
  const directory = new Map()
  for (const p of people || []) {
    const k = norm(p.name)
    if (directory.has(k)) throw new Error(`schedule-people.json names ${p.name} twice`)
    directory.set(k, p)
  }
  return directory
}

// Resolves every person named in S.sessions: the app's words first, the directory's
// pictures, then what the talks list knows. `resolve.talkFiles(talk)` says where an
// exhibitor speaker's photo and the company's logo are.
export function resolvePeople(S, { directory = new Map(), talkFiles = () => ({}), onDisk = () => true } = {}) {
  const used = new Set(), unknown = new Set()
  const pick = (...xs) => xs.find((x) => x && onDisk(x)) || ''
  function person(name, given = {}, known = null) {
    const k = norm(name)
    const d = known || directory.get(k) || null
    if (d && directory.get(k) === d) used.add(k)
    if (!d && !given.role && !given.org) unknown.add(name)
    // An uploaded photo (chosen in Admin) wins over the website's file; a website file in
    // the app and one in the directory are the same picture, cropped by the directory.
    const uploaded = /^\/api\/uploads\//.test(String(given.photo || '')) ? given.photo : ''
    const photo = uploaded || pick(d?.photo, given.photo ? String(given.photo).replace(/^\//, '') : '')
    // A listed speaker: the app's designation and organisation. Someone typed on a panel
    // (or the subject of a talk) who is not on the speakers list: the directory's words,
    // which split "Scientist-C, ICMR-NIRDH" into a designation and an organisation; the
    // typed words only when the directory does not know them.
    const role = given.listed ? given.role || '' : d?.role || given.role || ''
    const org = given.listed ? given.org || '' : d?.org || given.org || ''
    return { name, slug: personSlug(name), role, org, photo, logo: pick(d?.logo), crop: d?.crop || null, tag: '' }
  }
  for (const s of S.sessions) {
    const out = []
    if (s.talk) {
      const f = talkFiles(s.talk) || {}
      const known = { role: s.talk.title || '', org: s.company || s.talk.company, photo: f.photo || '', logo: f.logo || '', crop: f.crop || null }
      out.push(person(s.talk.name, { photo: s.talk.photo, listed: true, role: known.role, org: known.org }, known))
    } else {
      const listed = (p) => !!(p.listed || p.org || (p.role && p.photo))
      if (s.speaker) out.push(person(s.speaker.name, { role: s.speaker.role, org: s.speaker.org, photo: s.speaker.photo, listed: listed(s.speaker) }))
      for (const p of s.panel || []) out.push(person(p.name, { org: p.org, role: p.role, photo: p.photo, listed: listed(p) && !!p.role }))
      if (s.moderator) out.push({ ...person(s.moderator.name, { org: s.moderator.org, role: s.moderator.role, photo: s.moderator.photo, listed: listed(s.moderator) && !!s.moderator.role }), tag: 'Moderator' })
    }
    s.people = out
  }
  return { used, unknown }
}

// ---- the schedule and the tracks on /conference ----

const BADGE = { keynote: 'badge-keynote', panel: 'badge-panel', talk: 'badge-workshop', workshop: 'badge-workshop', break: 'badge-break', networking: 'badge-keynote', elsewhere: 'badge-break' }
const badgeText = (s) => ({ keynote: 'Keynote', panel: 'Panel', talk: 'Talk', workshop: 'Workshop', elsewhere: 'All halls' })[s.type] || s.label
const heading = (s) => s.title || (s.speaker ? `${s.label}: ${s.speaker.name}` : s.talk ? `Innovation Talk: ${s.company}` : s.label)
const time = (s) => (s.start ? `${s.start} – ${s.end}` : 'Time to be announced')
const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))
const indent = (s, n) => s.replace(/^(?=.)/gm, ' '.repeat(n))
const listWords = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

// Renders the schedule block, the Tracks block and the FAQ sentence. `pictures(p)` gives
// a person's small photo {src,w,h} as `thumb` and logo {src,w,h,lw,lh} as `mark`, or
// nothing; S.sessions must have been through resolvePeople().
export function renderConference(S, { tracks = [], pictures = () => ({}), logoOf = () => null } = {}) {
  const days = S.days || ['2026-11-20', '2026-11-21']
  const dayNos = days.map((_, i) => i + 1)
  const hall = (key) => S.halls.find((x) => x.key === key) || { key, name: key }
  for (const s of S.sessions) {
    s.title = s.title || (s.company ? `Innovation Talk: ${s.company}` : s.title)
    if (s.company) s.track = s.track || 'Innovation Talks'
    if (s.talk) s.topic = s.talk.topic || ''
    for (const p of s.people || []) { const pic = pictures(p) || {}; p.thumb = pic.thumb || null; p.mark = pic.mark || null }
  }

  const face = (p) => p.thumb
    ? `<img class="sch-photo" width="48" height="48" loading="lazy" decoding="async" src="${esc(p.thumb.src)}" alt="">`
    : `<span class="sch-photo sch-initials" aria-hidden="true">${esc(initials(p.name))}</span>`
  const mark = (p) => (p.mark ? `<img class="sch-logo" width="${p.mark.w}" height="${p.mark.h}" loading="lazy" decoding="async" src="${esc(p.mark.src)}" alt="" style="--lw:${p.mark.lw};--lh:${p.mark.lh}">` : '')
  const who = (p, nameTag) => [
    `<${nameTag}${nameTag === 'h4' ? '' : ' class="sch-name"'}>${esc(p.name)}${p.tag ? ` <span class="sch-tag">${esc(p.tag)}</span>` : ''}</${nameTag}>`,
    p.role ? `<div class="sch-role">${esc(p.role.replace(/[.]$/, ''))}</div>` : '',
    p.org ? `<div class="sch-org">${esc(p.org)}</div>` : '',
  ].join('')
  const card = (p, tag, nameTag, cls = '') => `<${tag} class="sch-person${cls}">${face(p)}<div class="sch-who">${mark(p)}${who(p, nameTag)}</div></${tag}>`
  function words(s) {
    const out = []
    if (s.title && s.label && ['panel', 'talk'].includes(s.type) && !s.title.includes(s.label) && !s.company) out.push(esc(s.label))
    if (s.topic) out.push(`&ldquo;${esc(s.topic.replace(/[.]$/, ''))}&rdquo;`)
    return out
  }
  const sentence = (tag, ls, cls = '') => (ls.length || tag ? `<p${cls ? ` class="${cls}"` : ''}>${tag}${ls.join('. ')}${ls.length ? '.' : ''}</p>` : '')
  // The sponsor's logo at 48px high (the baked copy is 80px), or its name.
  const powered = (s) => {
    if (!s.poweredBy) return ''
    const m = poweredLogoFiles(s.poweredBy).map((f) => logoOf(f)).find(Boolean)
    const mark = m && m.src && m.w && m.h
      ? `<img width="${Math.round((48 * m.w) / m.h)}" height="48" loading="lazy" decoding="async" src="${esc(m.src)}" alt="${esc(s.poweredBy)}">`
      : `<b>${esc(s.poweredBy)}</b>`
    return `<p class="sch-powered"><span>Powered by</span>${mark}</p>`
  }
  const item = (s, tag = '', id = '') => {
    const ppl = s.people || []
    const note = s.note ? [esc(s.note.replace(/\.$/, ''))] : []
    const info = []
    if (!ppl.length) {
      info.push(`<h4>${esc(heading(s))}</h4>`, sentence(tag, [...words(s), ...note]), powered(s))
    } else if (!s.title && ppl.length === 1) {
      info.push(card(ppl[0], 'div', 'h4', ' sch-lead'), sentence(tag, [...words(s), ...note], 'sch-note'), powered(s))
    } else {
      info.push(`<h4>${esc(heading(s))}</h4>`, sentence(tag, words(s)), powered(s))
      info.push(`<ul class="sch-people">${ppl.map((p) => card(p, 'li', 'div')).join('')}</ul>`)
      info.push(sentence('', note, 'sch-note'))
    }
    return [
      `<div${id ? ` id="${id}"` : ''} class="schedule-item${!ppl.length ? '' : !s.title && ppl.length === 1 ? ' has-lead' : ' has-people'}">`,
      `    <div class="schedule-time">${time(s)}</div>`,
      `    <div class="schedule-info">${info.filter(Boolean).join('')}</div>`,
      `    <span class="schedule-badge ${BADGE[s.type]}">${esc(badgeText(s))}</span>`,
      '</div>',
    ].join('\n')
  }
  const byTime = (a, b) => (a.start || '99') < (b.start || '99') ? -1 : (a.start || '99') > (b.start || '99') ? 1 : 0
  const dayTabs = (id) => ['<div class="schedule-tabs">', ...dayNos.map((n, i) => `    <button class="schedule-tab${i === 0 ? ' active' : ''}" onclick="switchDay('${id}', ${i})">${dayTabText(days[i], n)}</button>`), '</div>'].join('\n')
  const dayPanel = (day, items, empty) => [
    `<div class="schedule-panel${day === 1 ? ' active' : ''}">`,
    '    <div class="schedule-list">',
    (items.length ? items : [`<p style="color:var(--dark-grey);margin:0;">${empty}</p>`]).map((h) => h.replace(/^/gm, '        ')).join('\n'),
    '    </div>',
    '</div>',
  ].join('\n')

  // Each session's place in its hall's tab: #sch-<hall key>-<day>-<hhmm>, unique.
  const anchors = new Set()
  for (const s of S.sessions) {
    const base = `sch-${s.hall}-${s.day}-${s.start ? s.start.replace(':', '') : 'tba'}`
    let a = base
    for (let n = 2; anchors.has(a); n++) a = `${base}-${n}`
    anchors.add(a)
    s.anchor = a
  }

  const html = []
  html.push('<!-- Hall Selector -->', '<div class="hall-tabs">')
  S.halls.forEach((h, i) => html.push(`    <button class="hall-tab${i === 0 ? ' active' : ''}" onclick="switchHall(${i})">${esc(h.name)}</button>`))
  html.push(`    <button class="hall-tab" onclick="switchHall(${S.halls.length})" style="background:linear-gradient(135deg,#FF6B00,#138808);color:white;border-color:transparent;">Full Schedule</button>`, '</div>', '')
  S.halls.forEach((h, i) => {
    const id = `hall-${i}`
    html.push(`<!-- ${h.name.toUpperCase()} -->`, `<div class="hall-panel${i === 0 ? ' active' : ''}" id="${id}">`)
    if (h.about) html.push(indent(`<p class="hall-venue" style="font-size:0.86rem;color:var(--dark-grey);margin:0 0 1rem;">${esc(h.about)}</p>`, 4))
    html.push(indent(dayTabs(id), 4))
    for (const day of dayNos) {
      const items = S.sessions.filter((s) => s.hall === h.key && s.day === day).sort(byTime).map((s) => item(s, '', s.anchor))
      html.push(indent(dayPanel(day, items, 'Sessions to be announced.'), 4))
    }
    html.push('</div>', '')
  })
  // Full Schedule: every hall in time order. Breaks and registration come from the
  // main hall only, and a run of short Expo Hall talks shows as one block.
  const full = S.halls.length
  html.push('<!-- FULL SCHEDULE (all halls) -->', `<div class="hall-panel" id="hall-${full}">`)
  html.push(indent(dayTabs(`hall-${full}`), 4))
  for (const day of dayNos) {
    const rows = []
    const list = S.sessions.filter((s) => s.day === day && s.type !== 'elsewhere' && (s.type !== 'break' || s.hall === S.halls[0].key)).sort(byTime)
    const runs = []
    for (const s of list) {
      if (s.company && s.start) {
        const run = runs[runs.length - 1]
        const gap = run ? mins(s.start) - mins(run.end) : 99
        if (run && gap <= 30 && run.hall === s.hall) { run.end = s.end > run.end ? s.end : run.end; run.names.push(s.company); continue }
        const r = { hall: s.hall, day, start: s.start, end: s.end, names: [s.company], run: true }
        runs.push(r)
        rows.push(r)
      } else rows.push(s)
    }
    const out = rows.map((s) => {
      const h = hall(s.hall)
      const tag = s.label === 'Registration'
        ? '<span class="hall-label hl-all">All halls</span>'
        : `<span class="hall-label hl-${h.key}">${esc(h.name)}</span>`
      if (s.run) return item({ type: 'talk', label: 'Innovation Talks', title: 'Innovation Talks', start: s.start, end: s.end, note: s.names.join(', ') }, tag)
      return item(s, tag)
    })
    html.push(indent(dayPanel(day, out, 'Sessions to be announced.'), 4))
  }
  html.push('</div>')

  // ---- Tracks ----
  const KIND = { keynote: ['Keynote', 'Keynotes'], panel: ['Panel', 'Panels'], talk: ['Talk', 'Talks'], workshop: ['Workshop', 'Workshops'] }
  const groupOf = (s) => {
    if (['break', 'elsewhere', 'networking'].includes(s.type)) return null
    if (s.track) return s.track
    return s.type === 'keynote' ? '@keynotes' : null
  }
  const whenWhere = (day, start, end, h) => `${dayShortText(days[day - 1])} · ${start ? `${start} – ${end}` : 'time to be announced'} · ${esc(h.name)}`
  const mergeable = (s) => (s.company && s.start) || (!s.track && s.type === 'keynote' && s.start)
  function linesOf(list) {
    const out = []
    const tail = (l) => l.sessions[l.sessions.length - 1]
    for (const s of list) {
      if (mergeable(s)) {
        const run = [...out].reverse().find((l) => mergeable(tail(l)) && !!tail(l).company === !!s.company && tail(l).day === s.day && tail(l).hall === s.hall)
        if (run && mins(s.start) - mins(tail(run).end) <= (s.company ? 30 : 5)) { run.sessions.push(s); continue }
      }
      out.push({ sessions: [s] })
    }
    return out.map(({ sessions }) => {
      const s = sessions[0], z = sessions[sessions.length - 1], h = hall(s.hall)
      const line = { anchor: s.anchor, type: s.type, when: whenWhere(s.day, s.start, z.end, h) }
      if (sessions.length > 1) {
        line.kind = (KIND[s.type] || ['Session', 'Sessions'])[1]
        if (s.company) {
          line.title = `${sessions.length} Innovation Talks`
          line.sub = esc(listWords(sessions.map((x) => x.company)))
        } else {
          const has = (l) => sessions.some((x) => x.label === l)
          line.title = has('Inauguration') ? 'Welcome, inauguration and keynotes' : has('Welcome') ? 'Welcome and keynotes' : 'Keynotes'
          const names = sessions.flatMap((x) => x.people.map((p) => p.name))
          const open = sessions.some((x) => !x.people.length)
          line.sub = esc(names.join(', ') + (open ? (names.length ? ', and more to be announced' : 'Speakers to be announced') : ''))
        }
        return line
      }
      line.kind = (KIND[s.type] || ['Session', 'Sessions'])[0]
      line.title = heading(s)
      const note = s.note ? esc(s.note.replace(/\.$/, '')) : ''
      if (s.panel) {
        const orgs = [...new Set(s.panel.map((p) => p.org).filter(Boolean))]
        line.sub = `Panellists from ${esc(listWords(orgs))}${note ? `. ${note}` : ''}`
      } else if (s.people.length) {
        const p = s.people[0]
        line.sub = [esc(`${p.name}, ${p.org || p.role}`), s.topic ? `&ldquo;${esc(s.topic.replace(/[.]$/, ''))}&rdquo;` : '', note].filter(Boolean).join('. ')
      } else line.sub = note
      return line
    })
  }
  const trkLine = (l) => `<li class="trk-s"><span class="trk-kind k-${l.type}">${l.kind}</span><a class="trk-title" href="#${l.anchor}">${esc(l.title)}</a>${l.sub ? `<span class="trk-sub">${l.sub}</span>` : ''}<span class="trk-when">${l.when}</span></li>`
  const groups = new Map()
  for (const s of S.sessions) { const g = groupOf(s); if (g) (groups.get(g) || groups.set(g, []).get(g)).push(s) }
  const unknownTracks = [...groups.keys()].filter((k) => !tracks.some((t) => t.key === k))
  const trackList = [...tracks, ...unknownTracks.map((key) => ({ key, name: key }))].filter((t) => groups.has(t.key))
  const byDayTime = (a, b) => a.day - b.day || byTime(a, b)
  function trackRow(t) {
    const list = groups.get(t.key).sort(byDayTime)
    const timed = list.filter((s) => s.start)
    const types = [...new Set(timed.map((s) => s.type))]
    const noun = types.length === 1 && types[0] !== 'keynote' ? (KIND[types[0]] || ['session', 'sessions']) : ['session', 'sessions']
    const count = `${timed.length} ${(timed.length === 1 ? noun[0] : noun[1]).toLowerCase()}`
    const ds = new Set(list.map((s) => s.day))
    const when = ds.size > 1 ? 'Both days' : dayShortText(days[[...ds][0] - 1])
    const seen = new Map()
    for (const s of list) for (const p of s.people) if (!seen.has(p.slug)) seen.set(p.slug, p)
    const everyone = [...seen.values()]
    const shown = everyone.filter((p) => p.thumb).slice(0, 6)
    const more = everyone.length - shown.length
    const faces = shown.map((p) => `<img src="${esc(p.thumb.src)}" width="34" height="34" loading="lazy" decoding="async" alt="" title="${esc(p.name)}">`).join('') + (more > 0 ? `<span class="trk-more">+${more}</span>` : '')
    const label = `Speakers include ${listWords([...shown.map((p) => p.name), ...(more > 0 ? [`${more} more`] : [])])}`
    const lines = linesOf(list)
    const each = t.list ? timed.map((s) => trkLine(linesOf([s])[0])) : []
    return [
      '<div class="conf-track-row trk">',
      '    <div class="trk-head">',
      `        <h3 class="ctr-name">${esc(t.name)}</h3>`,
      `        <p class="trk-count">${count} · ${when}</p>`,
      everyone.length ? `        <div class="trk-faces" role="img" aria-label="${esc(label)}">${faces}</div>` : '',
      '    </div>',
      '    <div class="trk-body">',
      t.about ? `        <p class="ctr-desc">${esc(t.about)}${t.for ? ` <em>For: ${esc(t.for)}</em>` : ''}</p>` : '',
      `        <ul class="trk-sessions">${lines.map(trkLine).join('')}</ul>`,
      each.length > lines.length ? `        <details class="trk-all"><summary>All ${each.length} talks and their topics</summary><ul class="trk-sessions">${each.join('')}</ul></details>` : '',
      t.link ? `        <a class="trk-link" href="${esc(t.link.href)}">${esc(t.link.text)} <span aria-hidden="true">&rarr;</span></a>` : '',
      '    </div>',
      '</div>',
    ].filter(Boolean).join('\n')
  }
  const subjectTracks = trackList.filter((t) => t.key !== '@keynotes')
  const HALLS_IN_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'][S.halls.length] || String(S.halls.length)
  const tracksHtml = [
    '<div class="section-header reveal">',
    `    <h2 class="section-title"><span class="accent">${subjectTracks.length}</span> Specialised Tracks</h2>`,
    `    <p class="section-subtitle">${HALLS_IN_WORDS} halls over two days, straight from the agenda. Choose a session to see it in the schedule.</p>`,
    '</div>',
    '<div class="conf-tracks-list trk-list reveal-stagger">',
    ...trackList.map((t) => indent(trackRow(t), 4)),
    '</div>',
  ].join('\n')
  const faq = `There are ${subjectTracks.length} tracks across ${HALLS_IN_WORDS.toLowerCase()} halls over two days: ${listWords(subjectTracks.map((t) => t.name))}. The conference opens with keynotes in ${S.halls[0].name}.`
  return { schedule: html.join('\n'), tracks: tracksHtml, faq, unknownTracks }
}

// ---- the speaker grids: /conference, the home page, the Event's JSON-LD, llms.txt ----

// A minister's role OPENS with the title (Minister, Minister of State, Deputy Chief
// Minister, Chief Minister). The word elsewhere is not one: "Joint Secretary, Chief
// Minister's Secretariat" and "Chief Advisor to the Chief Minister" are officers and
// belong in the speakers' grid at their rank (the organiser, 16 Nov 2026).
export const isMinister = (sp) => /^(?:(?:deputy\s+)?chief\s+|union\s+|cabinet\s+|state\s+)?minister\b/i.test(String(sp.role || '').trim()) || /^hon[’'`]?ble\b/i.test(String(sp.name || ''))
const isGovernment = (sp) => isMinister(sp) || /\b(government|govt|ministry|department|dept|directorate|secretariat|commission|authority|niti|uidai|ias|ifs|ips|office of the)\b/i.test(String(sp.organisation || '') + ' ' + String(sp.role || '') + ' ' + String(sp.name || ''))
const siteFile = (url) => String(url || '').replace(/^\//, '')

// Renders every surface that lists the speakers. `photoOf(sp)` -> {src, w, h} (a site
// file, or the uploaded photo as it is), `logoOf(sp)` -> {src, w, h} or nothing.
export function renderSpeakers(speakers, { photoOf = (sp) => ({ src: siteFile(sp.photo_url), w: 400, h: 400 }), logoOf = () => null, origin = 'https://bharataiinnovation.com' } = {}) {
  const shown = (speakers || []).filter((sp) => Number(sp.is_published) !== 0 && sp.name).slice().sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) || Number(a.id) - Number(b.id))
  const ministers = shown.filter(isMinister), others = shown.filter((sp) => !isMinister(sp))
  const alt = (sp) => [sp.name, sp.role, sp.organisation].filter(Boolean).join(', ')
  const delay = (i) => ` reveal-delay-${1 + (i % 3)}`
  const img = (sp, w, h) => { const p = photoOf(sp); return p && p.src ? `<img width="${p.w || w}" height="${p.h || h}" loading="lazy" decoding="async" src="${esc(p.src)}" alt="${esc(alt(sp))}">` : `<span class="speaker-initials" aria-hidden="true">${esc(initials(sp.name))}</span>` }
  const logo = (sp) => { const l = logoOf(sp); return l && l.src ? `<img class="speaker-logo" width="${l.w}" height="${l.h}" loading="lazy" decoding="async" src="${esc(l.src)}" alt="">` : '' }
  const chip = (sp, style = '') => (sp.topic ? `<span class="speaker-topic${isGovernment(sp) ? ' topic-policy' : ''}"${style}>${esc(sp.topic)}</span>` : '')
  // /conference: the ministers' grid, then the speakers' grid, in the markup the page has.
  const confCard = (sp, i) => [
    `<div class="speaker-card reveal${delay(i)}">`,
    `    <div class="speaker-avatar">${img(sp, 400, 400)}</div>`,
    `    <h4>${esc(sp.name)}</h4>`,
    sp.role ? `    <div class="speaker-role">${esc(sp.role)}</div>` : '',
    sp.organisation ? `    <div class="speaker-org">${esc(sp.organisation)}</div>` : '',
    logo(sp) ? `    ${logo(sp)}` : '',
    chip(sp) ? `    ${chip(sp)}` : '',
    '</div>',
  ].filter(Boolean).join('\n')
  const conference = [
    ministers.length ? '<h3 class="reveal" style="font-family:var(--font-display);font-size:1.25rem;font-weight:700;color:var(--charcoal);text-align:center;margin:0 0 1.25rem;">Inauguration &amp; Keynote Addresses</h3>' : '',
    ministers.length ? '<div class="speakers-grid ministers-grid" style="margin-bottom:3rem;">' : '',
    ...ministers.map((sp, i) => indent(confCard(sp, i), 4)),
    ministers.length ? '</div>' : '',
    '<h3 class="reveal" style="font-family:var(--font-display);font-size:1.25rem;font-weight:700;color:var(--charcoal);text-align:center;margin:0 0 1.25rem;">Speakers</h3>',
    '<div class="speakers-grid">',
    ...others.map((sp, i) => indent(confCard(sp, i), 4)),
    '</div>',
  ].filter(Boolean).join('\n')
  // The home page's grid (#spkGrid): everyone who is not a minister (the ministers have
  // their own row above it, written by hand).
  const homeCard = (sp, i) => {
    const p = photoOf(sp) || {}
    const l = logoOf(sp)
    return [
      `<!-- ${esc(sp.name)} -->`,
      `<div class="speaker-card reveal${delay(i)}" style="text-align:center;align-items:center;">`,
      p.src ? `    <img width="${p.w || 400}" height="${p.h || 400}" loading="lazy" decoding="async" src="${esc(p.src)}" alt="${esc(alt(sp))}" class="speaker-photo" style="aspect-ratio:1;border-radius:50%;width:160px;height:160px;margin:0 auto;">`
        : `    <span class="speaker-photo speaker-initials" aria-hidden="true" style="aspect-ratio:1;border-radius:50%;width:160px;height:160px;margin:0 auto;display:grid;place-items:center;background:var(--off-white);font-weight:700;">${esc(initials(sp.name))}</span>`,
      `    <h4>${esc(sp.name)}</h4>`,
      sp.role ? `    <p style="font-size:0.82rem;color:var(--saffron);font-weight:600;margin:0;">${esc(sp.role)}</p>` : '',
      sp.organisation ? `    <p class="spk-org" style="font-size:0.78rem;">${l && l.src ? `<img width="${l.w}" height="${l.h}" class="spk-logo" src="${esc(l.src)}" alt="" loading="lazy">` : ''}${esc(sp.organisation)}</p>` : '',
      sp.topic ? `    <span class="speaker-topic" style="margin-top:0.5rem;">${esc(sp.topic)}</span>` : '',
      '</div>',
    ].filter(Boolean).join('\n')
  }
  const home = others.map((sp, i) => homeCard(sp, i)).join('\n\n')
  // The Event's performers (JSON-LD on the home page).
  const performers = shown.map((sp) => {
    const p = photoOf(sp) || {}
    const o = { '@type': 'Person', name: sp.name }
    if (sp.role) o.jobTitle = sp.role
    if (sp.organisation) o.worksFor = { '@type': isGovernment(sp) ? 'GovernmentOrganization' : 'Organization', name: sp.organisation }
    if (p.src) o.image = /^https?:/.test(p.src) ? p.src : origin + '/' + siteFile(p.src)
    return o
  })
  // llms.txt: one line a person.
  const llms = shown.map((sp) => `- **${sp.name}**${sp.role || sp.organisation ? ' — ' + [sp.role, sp.organisation].filter(Boolean).join(', ') : ''}${sp.topic ? ` (${sp.topic})` : ''}`).join('\n')
  return { conference, home, performers, llms, ministers, others }
}

// ---- putting the text into a page ----

// Replaces the text between <!-- name:start ... --> and <!-- name:end -->, keeping the
// start line as it is and the file's indentation; LF in, LF out.
export function fillBlock(src, name, body) {
  const a = src.indexOf(`<!-- ${name}:start`), b = src.indexOf(`<!-- ${name}:end -->`)
  if (a < 0 || b < 0 || b < a) throw new Error(`${name} markers missing`)
  const lineStart = src.lastIndexOf('\n', a) + 1
  const ind = src.slice(lineStart, a)
  const startLine = src.slice(a, src.indexOf('\n', a) + 1)
  const text = body + '\n'
  return src.slice(0, lineStart) + ind + startLine + text.split('\n').map((l) => (l ? ind + l : l)).join('\n') + ind + src.slice(b)
}
export const hasBlock = (src, name) => src.includes(`<!-- ${name}:start`) && src.includes(`<!-- ${name}:end -->`)

// The FAQ answer on how many tracks there are (the page's JSON-LD).
export function fillFaq(src, text) {
  const faq = /("name": "How many conference tracks[^"]*",\s*"acceptedAnswer": \{ "@type": "Answer", "text": ")[^"]*(")/
  if (!faq.test(src)) throw new Error('the FAQ answer on tracks is missing')
  return src.replace(faq, (m, a, b) => a + text.replace(/"/g, "'") + b)
}

// The Event's "performer" array in the home page's JSON-LD.
export function fillPerformers(src, performers) {
  const a = src.indexOf('"performer": [')
  if (a < 0) throw new Error('the performer list is missing')
  const b = src.indexOf('\n      ],', a)
  if (b < 0) throw new Error('the performer list has no end')
  const lines = performers.map((p) => '        ' + JSON.stringify(p).replace(/"@type":/g, '"@type": ').replace(/,"/g, ', "').replace(/":"/g, '": "').replace(/":\{/g, '": {').replace(/\{"/g, '{ "').replace(/"\}/g, '" }'))
  return src.slice(0, a) + '"performer": [\n' + lines.join(',\n') + src.slice(b)
}
