// Built-worker checks for the speaker photos (23 Nov 2026, src/routes/photos.ts) on the
// talks world (real SQLite, the production schema): a photo page opens only with its
// signed link and is noindex, its script parses, a RAW photo downloads as Drive's JPEG;
// Admin -> After the Event's list, a preview that sends nothing, a send with its audit
// row, "already sent" refused unless sent again on purpose, an official held back, no
// email. Nothing is sent: the mail service is answered here.
// Run after `npm run build`:  node scripts/verify/smoke-speaker-photos.mjs
import { createHmac } from 'node:crypto';
import { talksWorld, checker, ADMIN } from './talks-world.mjs';

const W = await talksWorld({ times: true });
const { db, rows, sent, hit, as, fetchRaw, read, env } = W;
const { check, done } = checker();
const DATA = JSON.parse(read('src/data/speaker-photos.json'));
const sig = (key) => createHmac('sha256', ADMIN).update('photos:' + key).digest('hex').slice(0, 32);

const withSp = DATA.people.filter(p => p.speakers.length && p.photos.length >= 3 && !p.check);
const weak = DATA.people.find(p => p.speakers.length && p.photos.length && p.check);
check('the data file has people with photos, each with a few best ones for the email', withSp.length >= 2 && withSp.every(p => p.best.length >= 1 && p.best.every(id => p.photos.includes(id))), `${DATA.people.length} people`);
const [A, B] = withSp;
// Put A and B on the programme (the world has no conference speakers of its own).
const addSpeaker = (p, email, role = 'Founder') => db.run('INSERT INTO speakers (id, event_id, slug, name, role, organisation, email, is_published) VALUES (?, 1, ?, ?, ?, ?, ?, 1)',
  [p.speakers[0], 'sp-' + p.speakers[0], p.name, role, 'Example Co', email]);
addSpeaker(A, 'a.speaker@example.com');
addSpeaker(B, '');

// ---- the page ----
const page = (key, k) => fetchRaw(new Request(`https://bharataiinnovation.com/photos/${key}` + (k === undefined ? '' : `?k=${k}`)));
let r = await page(A.key);
check('the page without its signature is refused, noindex', r.status === 404 && /noindex/.test(r.headers.get('X-Robots-Tag') || ''), r.status);
r = await page(A.key, sig(A.key).replace(/^./, c => (c === 'a' ? 'b' : 'a')));
check('a wrong signature is refused', r.status === 404, r.status);
r = await page(A.key, sig(A.key));
const html = await r.text();
check('the signed page opens, noindex, with their name and every photo', r.status === 200 && /noindex/.test(r.headers.get('X-Robots-Tag') || '') && html.includes('Photos of ' + A.name.replace(/&/g, '&amp;'))
  && A.photos.every(id => html.includes(id)), r.status);
const focused = A.focus ? Object.entries(A.focus)[0] : null;
check('the square thumbnails keep their face in view', !!focused && html.includes(`style="object-position:${focused[1][0]}% ${focused[1][1]}%"`), focused);
const scripts = [...html.matchAll(/<script(?![^>]*application\/json)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
let parses = true; try { scripts.forEach(s => new Function(s)); } catch (e) { parses = String(e); }
check('the page script parses', scripts.length === 1 && parses === true, parses);
const ids = JSON.parse((html.match(/<script type="application\/json" id="ids">([\s\S]*?)<\/script>/) || [])[1] || '[]');
check('each photo carries its download link (Drive download for a JPG)', ids.length === A.photos.length && ids.every(x => /^https:\/\/(drive\.google\.com\/uc\?export=download&id=|lh3\.googleusercontent\.com\/d\/[^=]+=s0$)/.test(x[1])), ids[0]);
const raw = Object.entries(DATA.photos).find(([, m]) => m[3]);
if (raw) {
  const holder = DATA.people.find(p => p.photos.includes(raw[0]));
  const rp = holder ? await (await page(holder.key, sig(holder.key))).text() : '';
  check('a camera RAW photo downloads as Drive\'s full-size JPEG, not the .CR3', !holder || rp.includes(`https://lh3.googleusercontent.com/d/${raw[0]}=s0`), holder && holder.name);
}
r = await page(B.speakers.length ? 's' + B.speakers[0] : B.key, sig(B.key));
check('the same person by another key needs that key\'s own signature', B.key === 's' + B.speakers[0] ? true : r.status === 404, r.status);

// ---- the admin list ----
check('without admin the list is refused', (await hit('GET', '/api/admin/speaker-photos')).status === 401, '');
let l = await as('GET', '/api/admin/speaker-photos');
const row = (key) => (l.json?.rows || []).find(x => x.key === key);
check('the list: A ready with their email, B with no email', l.status === 200 && row(A.key)?.status === 'ready' && row(A.key)?.email === 'a.speaker@example.com' && row(B.key)?.status === 'no-email', JSON.stringify(l.json?.counts));
check('each row has its count, small pictures and a signed page link', row(A.key)?.count === A.photos.length && row(A.key)?.thumbs?.length >= 1 && row(A.key)?.page?.endsWith('?k=' + sig(A.key)), JSON.stringify(row(A.key)).slice(0, 300));
const talksRows = (l.json?.rows || []).filter(x => (x.kinds || []).includes('Innovation Talk'));
check('Innovation Talk speakers are on the list too', talksRows.length >= 10, talksRows.length);

// ---- preview and send ----
let p = await as('GET', `/api/admin/speaker-photos/${A.key}/preview`);
check('a preview: subject, whole photos (not cropped), the page link, nothing sent', p.status === 200 && p.json?.subject === 'Your photos from Bharat AI Innovation 2026' && p.json?.html.includes('=w560') && !p.json?.html.includes('-c"')
  && p.json?.html.includes(`/photos/${A.key}?k=${sig(A.key)}`) && p.json?.html.includes('See and download all') && sent.length === 0, p.status);
let s = await as('POST', `/api/admin/speaker-photos/${A.key}/send`, {});
const mail = sent[0];
check('send: one email to them, with the photos and their page', s.status === 200 && sent.length === 1 && JSON.stringify(mail?.Recipients?.To) === JSON.stringify(['a.speaker@example.com'])
  && mail?.Content?.Body?.[0]?.Content.includes(`/photos/${A.key}?k=${sig(A.key)}`), s.status + ' ' + JSON.stringify(s.json));
const au = rows("SELECT entity, entity_id, detail FROM admin_audit WHERE action = 'speaker.photos'");
check('the send is recorded', au.length === 1 && au[0].entity === 'photo_album' && String(au[0].entity_id) === A.key && JSON.parse(au[0].detail).to === 'a.speaker@example.com', JSON.stringify(au));
l = await as('GET', '/api/admin/speaker-photos');
check('the list now says sent', row(A.key)?.status === 'sent' && row(A.key)?.sent_count === 1, row(A.key)?.status);
s = await as('POST', `/api/admin/speaker-photos/${A.key}/send`, {});
check('a second send is refused unless asked for again', s.status === 409 && s.json?.already === true && sent.length === 1, s.status);
s = await as('POST', `/api/admin/speaker-photos/${A.key}/send`, { again: true });
check('sent again on purpose', s.status === 200 && sent.length === 2, s.status);
s = await as('POST', `/api/admin/speaker-photos/${B.key}/send`, {});
check('no email: refused, nothing sent', s.status === 409 && sent.length === 2, s.status);
// A copy to the person who looks after them (their PR), the organiser, 24 Nov 2026.
s = await as('POST', `/api/admin/speaker-photos/${B.key}/send`, { to: 'not-an-address' });
check('a copy to an incomplete address is refused', s.status === 400 && sent.length === 2, s.status);
s = await as('POST', `/api/admin/speaker-photos/${B.key}/send`, { to: 'PR.Person@Example.com' });
const copy = sent[2];
check('a copy goes to their PR as the "please pass this on" email, with their page and no original',
  s.status === 200 && s.json?.copy === true && sent.length === 3 && JSON.stringify(copy?.Recipients?.To) === JSON.stringify(['pr.person@example.com'])
  && /^Photos of /.test(copy?.Content?.Subject || '') && /Please pass this email on/.test(copy?.Content?.Body?.[0]?.Content || '')
  && (copy?.Content?.Body?.[0]?.Content || '').includes(`/photos/${B.key}?k=${sig(B.key)}`) && !/\/o\.jpg/.test(copy?.Content?.Body?.[0]?.Content || ''), s.status + ' ' + JSON.stringify(s.json));
l = await as('GET', '/api/admin/speaker-photos');
check('...recorded as a copy, and their own photos email still counts as not sent',
  rows("SELECT 1 FROM admin_audit WHERE action = 'speaker.photos_copy' AND entity_id = ?", [B.key]).length === 1 && row(B.key)?.status === 'no-email' && !row(B.key)?.sent_count, row(B.key)?.status);

// ---- a weaker match: looked at before sending, not in "send to all" ----
if (weak) {
  addSpeaker(weak, 'weak.match@example.com');
  l = await as('GET', '/api/admin/speaker-photos');
  check('a weaker match waits for a look ("check"), not "ready"', row(weak.key)?.status === 'check', row(weak.key)?.status);
  const n = sent.length;
  s = await as('POST', `/api/admin/speaker-photos/${weak.key}/send`, {});
  check('...and sends one by one once looked at', s.status === 200 && sent.length === n + 1, s.status);
  db.run("DELETE FROM admin_audit WHERE action = 'speaker.photos' AND entity_id = ?", [weak.key]);
}

// ---- a guest not on the programme (scripts/photos/guests.json, key g<id>) ----
const G = DATA.people.find(p => p.guest && p.photos.length);
if (G) {
  l = await as('GET', '/api/admin/speaker-photos');
  const gr = row(G.key);
  check('a named guest is on the list with their role and title, from the guest list (not D1)', !!gr && gr.kinds.includes(G.guest.role || 'Guest') && gr.org === G.guest.title && gr.count === G.photos.length, gr);
  check('a guest gets the same statuses: a minister held for their office, a weaker match looked at first', gr?.status === (/minister/i.test(G.guest.title) ? 'protocol' : !G.guest.email ? 'no-email' : G.check ? 'check' : 'ready'), gr?.status);
  const gp = await page(G.key, sig(G.key));
  const gh = await gp.text();
  check("the guest's page opens with their title", gp.status === 200 && gh.includes('Photos of ' + G.name) && gh.includes(G.guest.title.replace(/&/g, '&amp;')), gp.status);
  const gv = await as('GET', `/api/admin/speaker-photos/${G.key}/preview`);
  const thanks = /organis/i.test(G.guest.role || '') ? /everything you did to make/ : /as our special guest/;
  check('the guest email thanks them for their part (an organiser for their work, a guest as our special guest)', gv.status === 200 && thanks.test(gv.json?.html || '') && gv.json?.subject === 'Your photos from Bharat AI Innovation 2026', gv.status);
}

// ---- an official ----
db.run("UPDATE speakers SET email = 'office@example.gov.in', role = 'Minister of State, IT' WHERE id = ?", [B.speakers[0]]);
l = await as('GET', '/api/admin/speaker-photos');
check('a minister is held for their office', row(B.key)?.status === 'protocol', row(B.key)?.status);
const before = sent.length;
s = await as('POST', `/api/admin/speaker-photos/${B.key}/send`, {});
check('...and not sent unless "anyway"', s.status === 409 && sent.length === before, s.status);
s = await as('POST', `/api/admin/speaker-photos/${B.key}/send`, { anyway: true });
check('...sent when the organiser says so', s.status === 200 && sent.length === before + 1, s.status);

// ---- the session line-up and the names in a photo, from the live programme ----
db.exec(read('migrations/0054_conference_manager.sql'));
const P = (k) => DATA.people.find(x => x.key === k);
const fine = (k) => { const p = P(k); return p && p.speakers.length && !p.check && !p.guest && ![A.key, B.key, weak && weak.key].includes(k); };
let pair = null;
for (const [id, list] of Object.entries(DATA.who || {})) {
  const m = DATA.photos[id]; if (!m || !m[1]) continue;
  const ks = list.filter(w => w[2] < 80 && fine(w[0]));
  if (ks.length >= 2 && ks[0][0] !== ks[1][0]) { pair = { id, day: m[0], time: m[1], x: P(ks[0][0]), y: P(ks[1][0]) }; break; }
}
check('the data has a photo with two speakers in it, at a known time', !!pair, '');
if (pair) {
  const { x: X, y: Y } = pair;
  db.run('INSERT INTO speakers (id, event_id, slug, name, role, organisation, email, is_published, linkedin_url) VALUES (?, 1, ?, ?, ?, ?, ?, 1, ?)', [X.speakers[0], 'x' + X.speakers[0], X.name, 'Founder', 'Org X', 'x.speaker@example.com', '']);
  db.run('INSERT INTO speakers (id, event_id, slug, name, role, organisation, email, is_published, linkedin_url) VALUES (?, 1, ?, ?, ?, ?, ?, 1, ?)', [Y.speakers[0], 'y' + Y.speakers[0], Y.name, 'Chief Executive', 'Org Y', 'y.speaker@example.com', 'https://www.linkedin.com/in/y-test']);
  db.run("INSERT INTO speakers (id, event_id, slug, name, role, organisation, email, is_published) VALUES (99001, 1, 'gone', 'Dropped Out Person', 'Director', 'Org Z', '', 1)");
  const t0 = Number(pair.time.slice(0, 2)) * 60 + Number(pair.time.slice(3, 5));
  const at = (t) => `${pair.day} ${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  db.run("INSERT INTO sessions (id, event_id, title, session_type, room, start_time, end_time) VALUES (9001, 1, 'Test panel on AI', 'panel', 'Homi J. Bhabha Hall', ?, ?)", [at(t0 - 20), at(t0 + 20)]);
  db.run("INSERT INTO session_speakers (session_id, speaker_id, role, sort_order) VALUES (9001, ?, 'moderator', 1), (9001, ?, 'panellist', 2), (9001, 99001, 'panellist', 3)", [X.speakers[0], Y.speakers[0]]);
  // Earlier that day, a session naming people typed by hand only (no speaker row): their names
  // reach the line-up code as text. Read as a list, that threw and lost every line-up after
  // it, so all speaker emails went without one (23-24 Nov 2026).
  db.run("INSERT INTO sessions (id, event_id, title, session_type, room, start_time, end_time, speaker_name) VALUES (9000, 1, 'Typed-only talk', 'talk', 'Kalam Theatre', ?, ?, 'Typed Person (Org T), Another Typed')", [at(t0 - 200), at(t0 - 180)]);
  const xp = await (await page(X.key, sig(X.key))).text();
  check("their page shows the session's line-up as the programme has it now", xp.includes('Test panel on AI') && xp.includes(Y.name) && xp.includes('Chief Executive, Org Y') && xp.includes('<em>Moderator</em>')
    && xp.includes('https://www.linkedin.com/in/y-test') && xp.includes('Dropped Out Person'), (xp.match(/<section class="lu">[\s\S]*?<\/section>/) || [''])[0].slice(0, 300));
  const xids = JSON.parse((xp.match(/<script type="application\/json" id="ids">([\s\S]*?)<\/script>/) || [])[1] || '[]');
  const named = xids.map(x => x[2] || []).find(n => n.some(e => e[0] === Y.name));
  check('in the photo they share, the other speaker is named, left to right, with designation and LinkedIn', !!named && named.some(e => e[0] === X.name && e[3] === 1)
    && named.some(e => e[0] === Y.name && e[1] === 'Chief Executive, Org Y' && e[2] === 'https://www.linkedin.com/in/y-test' && e[3] === 0), named);
  l = await as('GET', '/api/admin/speaker-photos');
  const panel = (l.json?.panels || []).find(k => k.id === 's9001');
  check('a listed panellist in none of its photos flags the session for a look', !!panel && panel.flagged && panel.reasons.some(r => r.includes('Dropped Out Person')) && row(X.key)?.status === 'panel', { panel: panel && panel.reasons, status: row(X.key)?.status });
  const typedS = (l.json?.panels || []).find(k => k.id === 's9000');
  check('a session with names typed by hand only keeps them, as typed, and the line-ups after it are not lost', !!typedS && typedS.typed.join('|') === 'Typed Person (Org T)|Another Typed' && !!panel, typedS && typedS.typed);
  const firstSection = (xp.match(/<section><h2>([\s\S]*?)<\/section>/) || ['', ''])[0];
  const pinned = [...firstSection.matchAll(/\/d\/([A-Za-z0-9_-]+)=w700/g)].map(m => m[1]);
  const both = (id) => { const ks = new Set((DATA.who[id] || []).filter(w => w[2] < 80).map(w => w[0])); return ks.has(X.key) && ks.has(Y.key); };
  check("their panel's group shots (photos with both panellists recognised) are pinned at the top of their page, at most three",
    firstSection.includes('Your panel, all together') && pinned.length >= 1 && pinned.length <= 3 && pinned.every(both), { pinned: pinned.length });
  const pv3 = await as('GET', `/api/admin/speaker-photos/${X.key}/preview`);
  check('...and they come first in their email', pinned.every(id => (pv3.json?.html || '').includes(id)), '');
  check('the email carries the line-up too (and no email or phone of anyone)', pv3.json?.html.includes('Test panel on AI') && pv3.json?.html.includes('Chief Executive, Org Y') && !pv3.json?.html.includes('y.speaker@example.com'), pv3.status);
  let sx = await as('POST', `/api/admin/speaker-photos/${X.key}/send`, {});
  check("their email waits until the line-up is confirmed", sx.status === 409 && sx.json?.panel === true, sx.status);
  sx = await as('POST', '/api/admin/speaker-photos/panels/s9001/ok', { fp: 'stale' });
  check('confirming a line-up that changed since is refused', sx.status === 409 && sx.json?.changed === true, sx.status);
  sx = await as('POST', '/api/admin/speaker-photos/panels/s9001/ok', { fp: panel.fp });
  l = await as('GET', '/api/admin/speaker-photos');
  check('once confirmed, they are ready to send', sx.status === 200 && row(X.key)?.status === 'ready', row(X.key)?.status);
  // "Your panel": the line-up and group shots for those whose photos email went before the
  // line-up fix (24 Nov 2026). X's photos email "went" on 23 Nov; Y's goes now, with a line-up.
  db.run("INSERT INTO admin_audit (actor, action, entity, entity_id, detail, created_at) VALUES ('test', 'speaker.photos', 'photo_album', ?, '{}', '2026-11-23 10:00:00')", [X.key]);
  db.run("INSERT INTO admin_audit (actor, action, entity, entity_id, detail, created_at) VALUES ('test', 'speaker.photos', 'photo_album', ?, '{}', '2026-11-24 05:00:00')", [Y.key]);
  let pn = await as('GET', '/api/admin/panel-note');
  const pnRow = (k) => (pn.json?.rows || []).find(r => r.key === k);
  check('the panel email list: the one emailed before the fix is ready, the one emailed after had the line-up already', pnRow(X.key)?.status === 'ready' && pnRow(Y.key)?.status === 'had-lineup', pn.json?.rows);
  const pnv = await as('GET', `/api/admin/panel-note/${X.key}/preview`);
  const pnh = pnv.json?.html || '';
  check('its preview: the line-up with designations and LinkedIn, the group shots, no email or phone of anyone, no original-size link',
    pnv.status === 200 && pnh.includes('Test panel on AI') && pnh.includes('Chief Executive, Org Y') && pnh.includes('https://www.linkedin.com/in/y-test')
    && pinned.every(id => pnh.includes(id)) && !pnh.includes('y.speaker@example.com') && !/\/o\.jpg/.test(pnh), pnv.status);
  const beforeNote = sent.length;
  let pns = await as('POST', `/api/admin/panel-note/${X.key}/send`, {});
  check('sent once, and recorded', pns.status === 200 && sent.length === beforeNote + 1 && rows("SELECT 1 FROM admin_audit WHERE action = 'photos.panel_note' AND entity_id = ?", [X.key]).length === 1, pns.status);
  pns = await as('POST', `/api/admin/panel-note/${X.key}/send`, {});
  const pny = await as('POST', `/api/admin/panel-note/${Y.key}/send`, {});
  check('never twice, and not to someone whose photos email had the line-up', pns.status === 409 && pns.json?.already === true && pny.status === 409 && sent.length === beforeNote + 1, [pns.status, pny.status]);
  db.run("DELETE FROM admin_audit WHERE action IN ('speaker.photos', 'photos.panel_note') AND entity_id IN (?, ?)", [X.key, Y.key]);
  db.run("INSERT INTO session_speakers (session_id, speaker_id, role, sort_order) VALUES (9001, ?, 'panellist', 4)", [A.speakers[0]]);
  l = await as('GET', '/api/admin/speaker-photos');
  check('a change to the line-up after it was confirmed asks again', row(X.key)?.status === 'panel', row(X.key)?.status);
  db.run('DELETE FROM session_speakers WHERE session_id = 9001 AND speaker_id = ?', [A.speakers[0]]);
  // An official is named only when the programme puts them on a session running then.
  db.run("UPDATE speakers SET role = 'Minister of State, Electronics and IT' WHERE id = ?", [Y.speakers[0]]);
  db.run('DELETE FROM session_speakers WHERE session_id = 9001 AND speaker_id = ?', [Y.speakers[0]]);
  const xp2 = await (await page(X.key, sig(X.key))).text();
  const ids3 = JSON.parse((xp2.match(/<script type="application\/json" id="ids">([\s\S]*?)<\/script>/) || [])[1] || '[]');
  check('an official not on a session at that time is not named', !ids3.some(x => (x[2] || []).some(e => e[0] === Y.name)), '');
  // On two panels: a heading and that panel's own group shots for each (the organiser, 24 Nov
  // 2026, on Bhupesh Daheria's page: his three were all his first panel's). Someone seen with one
  // speaker, and hours later (or another day) with another: two panels of two.
  db.run('DELETE FROM session_speakers WHERE session_id = 9001');
  const hm = (s) => Number(String(s).slice(0, 2)) * 60 + Number(String(s).slice(3, 5));
  const ok2 = (k) => { const p = P(k); return p && p.speakers.length && !p.check && !p.guest; };
  const seen = new Map();
  let two = null;
  for (const [id, list] of Object.entries(DATA.who || {})) {
    const m = DATA.photos[id]; if (!m || !m[1]) continue;
    const ks = [...new Set(list.filter(w => w[2] < 80 && ok2(w[0])).map(w => w[0]))];
    for (const k of ks) for (const z of ks) {
      if (k === z) continue;
      const here = { day: m[0], t: hm(m[1]), z };
      const prev = (seen.get(k) || []).find(o => o.z !== z && (o.day !== here.day || Math.abs(o.t - here.t) >= 100));
      if (prev) { two = { k, a: prev, b: here }; break; }
      seen.set(k, [...(seen.get(k) || []), here]);
    }
    if (two) break;
  }
  check('the data has someone photographed with two other speakers, hours apart', !!two, '');
  if (two) {
    const K = P(two.k), Z1 = P(two.a.z), Z2 = P(two.b.z), added = [];
    for (const p of [K, Z1, Z2]) if (!rows('SELECT 1 FROM speakers WHERE id = ?', [p.speakers[0]]).length) { addSpeaker(p, ''); added.push(p.speakers[0]); }
    const hhmm = (d, t) => `${d} ${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    db.run("INSERT INTO sessions (id, event_id, title, session_type, room, start_time, end_time) VALUES (9002, 1, 'First of two panels', 'panel', 'Kalam Theatre', ?, ?)", [hhmm(two.a.day, two.a.t - 20), hhmm(two.a.day, two.a.t + 20)]);
    db.run("INSERT INTO sessions (id, event_id, title, session_type, room, start_time, end_time) VALUES (9003, 1, 'Second of two panels', 'panel', 'Raman Theatre', ?, ?)", [hhmm(two.b.day, two.b.t - 20), hhmm(two.b.day, two.b.t + 20)]);
    db.run("INSERT INTO session_speakers (session_id, speaker_id, role, sort_order) VALUES (9002, ?, 'panellist', 1), (9002, ?, 'panellist', 2), (9003, ?, 'panellist', 1), (9003, ?, 'panellist', 2)",
      [K.speakers[0], Z1.speakers[0], K.speakers[0], Z2.speakers[0]]);
    const kp = await (await page(K.key, sig(K.key))).text();
    const allSecs = [...kp.matchAll(/<section><h2>[\s\S]*?<\/section>/g)].map(m => m[0]).join('');
    const secs = [...kp.matchAll(/<section><h2>All together: ([^<]*?) <span>\d+<\/span><\/h2>([\s\S]*?)<\/section>/g)].map(m => ({ title: m[1], ids: [...m[2].matchAll(/\/d\/([A-Za-z0-9_-]+)=w700/g)].map(x => x[1]) }));
    const with2 = (id, x, y) => { const ks = new Set((DATA.who[id] || []).filter(w => w[2] < 80).map(w => w[0])); return ks.has(x) && ks.has(y); };
    const s1 = secs.find(s => s.title === 'First of two panels'), s2 = secs.find(s => s.title === 'Second of two panels');
    const order = (two.a.day + hhmm('', two.a.t)) < (two.b.day + hhmm('', two.b.t)) ? 'First of two panels|Second of two panels' : 'Second of two panels|First of two panels';
    check('on two panels, each has its own heading and group shots, in programme order',
      !!s1 && !!s2 && s1.ids.length >= 1 && s2.ids.length >= 1 && s1.ids.length <= 3 && s2.ids.length <= 3
      && s1.ids.every(id => with2(id, K.key, Z1.key)) && s2.ids.every(id => with2(id, K.key, Z2.key)) && secs.map(s => s.title).join('|') === order,
      secs.map(s => s.title + ':' + s.ids.length));
    check('...no "Your panel" heading then, and no group shot shown twice', !kp.includes('Your panel, all together') && !!s1 && !!s2
      && [...s1.ids, ...s2.ids].every(id => (allSecs.match(new RegExp(id + '=w700', 'g')) || []).length === 1), '');
    const pv4 = await as('GET', `/api/admin/speaker-photos/${K.key}/preview`);
    check('their email still has at most three group shots in all, and no original-size link', pv4.status === 200 && !!s1 && !!s2
      && [...s1.ids, ...s2.ids].filter(id => (pv4.json?.html || '').includes(id)).length <= 3 && !/\/o\.jpg/.test(pv4.json?.html || ''), pv4.status);
    db.run('DELETE FROM session_speakers WHERE session_id IN (9002, 9003)'); db.run('DELETE FROM sessions WHERE id IN (9002, 9003)');
    for (const id of added) db.run('DELETE FROM speakers WHERE id = ?', [id]);
  }
  db.run('DELETE FROM session_speakers WHERE session_id = 9001'); db.run('DELETE FROM sessions WHERE id IN (9000, 9001)');
}

// ---- attendees (src/data/attendee-photos.json): only their own photos, never named ----
const ATT = JSON.parse(read('src/data/attendee-photos.json'));
const akeys = Object.keys(ATT.albums).filter(k => !ATT.albums[k].check && ATT.albums[k].photos.length >= 2);
check('attendee albums are by attendee id only, with a group and no names', akeys.length >= 2 && !/"name"|"email"/.test(read('src/data/attendee-photos.json')), akeys.length);
const [K1, K2] = akeys;
db.run("INSERT INTO attendees (id, event_id, name, email, company, badge_type) VALUES (?, 1, 'Asha Attendee', 'asha@example.com', 'Asha Co', 'Delegate Pass')", [Number(K1.slice(1))]);
db.run("INSERT INTO attendees (id, event_id, name, email, company, badge_type, unsubscribed_at) VALUES (?, 1, 'Unsub Person', 'unsub@example.com', '', 'Visitor Pass', '2026-11-22 10:00:00')", [Number(K2.slice(1))]);
let al = await as('GET', '/api/admin/attendee-photos');
const arow = (k) => (al.json?.rows || []).find(r => r.key === k);
check('the Attendee photos list: each found person with their group, from D1', al.status === 200 && arow(K1)?.name === 'Asha Attendee' && arow(K1)?.status === 'ready' && arow(K1)?.group_name === ATT.groups[ATT.albums[K1].group]
  && (al.json.groups || []).length === ATT.groups.length, JSON.stringify(arow(K1)).slice(0, 200));
check('someone who unsubscribed is not sent', arow(K2)?.status === 'unsubscribed', arow(K2)?.status);
check('without admin the attendee list is refused', (await hit('GET', '/api/admin/attendee-photos')).status === 401, '');
const ap = await (await page(K1, sig(K1))).text();
check("an attendee's page says how they were matched and offers Not me and Don't match my photos", ap.includes('Photos of Asha Attendee') && ap.includes('We matched the profile photo you added in the event app')
  && ap.includes('data-go="optout"') && ap.includes(`"key":"${K1}"`), (ap.match(/<p class="note">[\s\S]*?<\/p>/) || [''])[0].slice(0, 200));
const apv = await as('GET', `/api/admin/attendee-photos/${K1}/preview`);
check("their email: their own photos, how we matched, no session line-up and no one else's details", apv.status === 200 && /matching the profile photo you added in the event app/.test(apv.json?.html || '')
  && !/Your session/.test(apv.json?.html || '') && /Not me/.test(apv.json?.html || ''), apv.status);
let as1 = await as('POST', `/api/admin/attendee-photos/${K1}/send`, {});
check('send: one email to them, recorded', as1.status === 200 && rows("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'attendee.photos' AND entity_id = ?", [K1])[0].n === 1, as1.status);
as1 = await as('POST', `/api/admin/attendee-photos/${K1}/send`, {});
check('...not twice unless sent again on purpose', as1.status === 409 && as1.json?.already === true, as1.status);
check('an unsubscribed person is refused', (await as('POST', `/api/admin/attendee-photos/${K2}/send`, {})).status === 409, '');
const first = ATT.albums[K1].photos[0];
check('"Not me" needs their own signed link', (await hit('POST', '/api/photos/not-me', { key: K1, k: 'x'.repeat(32), n: 0 })).status === 403, '');
check('...and works with it', (await hit('POST', '/api/photos/not-me', { key: K1, k: sig(K1), n: 0 })).status === 200, '');
const ap2 = await (await page(K1, sig(K1))).text();
check('the photo they said is not them is gone from their page, the others stay', !ap2.includes(first) && ap2.includes(ATT.albums[K1].photos[1]), first);
al = await as('GET', '/api/admin/attendee-photos');
check('...and from their count', arow(K1)?.count === ATT.albums[K1].photos.length - 1, arow(K1)?.count);
check("\"Don't match my photos\" needs their signed link", (await hit('POST', '/api/photos/opt-out', { key: K1, k: 'bad' })).status === 403, '');
check('...and works with it', (await hit('POST', '/api/photos/opt-out', { key: K1, k: sig(K1) })).status === 200, '');
const ap3 = await (await page(K1, sig(K1))).text();
al = await as('GET', '/api/admin/attendee-photos');
check('after opting out: no photos on their page, Admin says so, no more emails', ap3.includes('You asked us not to match your photos') && arow(K1)?.status === 'opted-out'
  && (await as('POST', `/api/admin/attendee-photos/${K1}/send`, { again: true })).status === 409, arow(K1)?.status);

// ---- our own copies in R2 (routes/photo-store.ts) ----
// Until a photo is in event_photos everything above came from Drive. Now two of A's
// photos are in R2 (one of them in A's email six), the rest still only in Drive.
db.exec(read('migrations/0064_event_photos.sql'));
const store = new Map();
env.UPLOADS = { async get(key) { const b = store.get(key); return b ? { body: new Response(b).body, size: b.length, httpEtag: '"e"', writeHttpMetadata() {} } : null; } };
const inR2 = [A.best[0], ...A.photos.filter(id => id !== A.best[0]).slice(0, 2)];
const pidOf = {};
inR2.forEach((drive, i) => {
  const pid = ('R2pid' + i + 'abcdefghij').slice(0, 12); pidOf[drive] = pid;
  db.run("INSERT INTO event_photos (event_id, pid, drive_id, title, day, taken_at, camera, hall, width, height, bytes, raw) VALUES (1, ?, ?, ?, '2026-11-20', '2026-11-20T05:00:00Z', 'Cam 1', '', 6000, 4000, 3, 0)", [pid, drive, 'IMG' + i + '.JPG']);
  for (const part of ['s', 'm', 'o']) store.set(`event-photos/1/${pid}/${part}.jpg`, new Uint8Array([0xff, 0xd8, i]));
});
const html2 = await (await page(A.key, sig(A.key))).text();
const ids2 = JSON.parse((html2.match(/<script type="application\/json" id="ids">([\s\S]*?)<\/script>/) || [])[1] || '[]');
const r2 = (part, drive) => `/photo/${pidOf[drive]}/${part}.jpg?u=${encodeURIComponent(A.key)}`;
check('the page shows a photo in R2 from our own link, signed for this album', inR2.every(d => html2.includes(r2('s', d))), inR2);
check('...its large view and full-size save are ours too; with the store present nothing comes from Drive', inR2.every(d => ids2.some(x => x[0].includes(r2('m', d)) && x[1].includes(r2('o', d))))
  && ids2.length === inR2.length && !ids2.some(x => /googleusercontent|drive\.google/.test(x[0] + x[1])), ids2.length);
check('each photo on the page carries its store id and size, for saving several as a ZIP', ids2.every(x => /^[A-Za-z0-9_-]{12}$/.test(x[4]) && x[5] === 3), ids2.map(x => [x[4], x[5]]));
check('the page offers Save all, Choose photos and Share, and asks for the event tags', html2.includes(`Save all ${ids2.length} photos`) && html2.includes('data-go="pick"')
  && html2.includes('data-go="shareone"') && html2.includes('data-go="sharepicked"') && html2.includes('#BharatAIInnovation @bharataiinnovation.ai'), '');
check('...and says nothing about a save limit any more', !/You can save up to|the most each person can|full-size photos\. You can still/.test(html2), (html2.match(/You (have|can) save[^.]*\./) || [])[0]);
const cfg2 = JSON.parse((html2.match(/<script type="application\/json" id="cfg">([\s\S]*?)<\/script>/) || [])[1] || '{}');
check('the page knows how big one ZIP may be (100 photos, 900 MB)', cfg2.max === 100 && cfg2.bytes === 900000000 && /BharatAIInnovation/.test(cfg2.tags || ''), cfg2);
const pv2 = await as('GET', `/api/admin/speaker-photos/${A.key}/preview`);
check('the email shows its photo in R2 by our small link, and never a full-size link', pv2.json?.html.includes(r2('s', A.best[0])) && !/\/o\.jpg/.test(pv2.json?.html || ''), (pv2.json?.html.match(/\/photo\/[^"]+/) || [])[0]);
l = await as('GET', '/api/admin/speaker-photos');
check('the Admin list shows its small pictures from R2 as the organiser (never counted)', (row(A.key)?.thumbs || []).some(t => t.includes(`/photo/${pidOf[A.best[0]]}/s.jpg?u=admin`)), row(A.key)?.thumbs);
// Saves: no limit (the organiser, 23 Nov 2026: "dont limit to 50 max rule"), each one recorded.
const saved = (person) => rows('SELECT COALESCE(SUM(times), 0) AS n FROM photo_downloads WHERE person = ?', [person])[0].n;
const o = (d) => ids2.find(x => x[1].includes(r2('o', d)))[1].replace('https://bharataiinnovation.com', '');
const gots = [];
for (const d of inR2) gots.push(await W.fetchRaw(new Request('https://bharataiinnovation.com' + o(d))));
check('a speaker saves every photo at full size, one by one, with no limit, each save recorded', gots.every(g => g.status === 200 && /attachment/.test(g.headers.get('Content-Disposition') || '')) && saved(A.key) === 3, [gots.map(g => g.status), saved(A.key)]);

// Save all / save chosen: one ZIP of the originals, only ever of photos on their own page.
const T = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; T[n] = c; }
const crc = (b) => { let c = -1; for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
// Reads a ZIP by its central directory, as Windows and macOS do; null when it is not a whole ZIP.
const unzip = (b) => {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength), e = b.length - 22;
  if (e < 0 || v.getUint32(e, true) !== 0x06054b50) return null;
  const n = v.getUint16(e + 10, true), cdSize = v.getUint32(e + 12, true), cdAt = v.getUint32(e + 16, true);
  if (cdAt + cdSize !== e) return null;
  const out = []; let p = cdAt;
  for (let i = 0; i < n; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) return null;
    const c = v.getUint32(p + 16, true), size = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), off = v.getUint32(p + 42, true);
    if (v.getUint32(off, true) !== 0x04034b50) return null;
    const at = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true);
    const data = b.subarray(at, at + size);
    out.push({ name: new TextDecoder().decode(b.subarray(p + 46, p + 46 + nl)), data: [...data], crcOk: crc(data) === c, stored: v.getUint16(p + 10, true) === 0 });
    p += 46 + nl + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
  }
  return out;
};
const zipOf = (key, k, pids, extra = '') => W.fetchRaw(new Request(`https://bharataiinnovation.com/photos/${key}/save?k=${k}&p=${pids.join('.')}${extra}`));
const allPids = ids2.map(x => x[4]);
const before0 = saved(A.key);
let z = await zipOf(A.key, sig(A.key), allPids);
let zb = new Uint8Array(await z.arrayBuffer());
let zf = unzip(zb);
check('Save all: one ZIP file, downloaded as an attachment, its length told up front', z.status === 200 && z.headers.get('Content-Type') === 'application/zip'
  && /attachment; filename="Bharat-AI-Innovation-2026-photos\.zip"/.test(z.headers.get('Content-Disposition') || '') && Number(z.headers.get('Content-Length')) === zb.length, [z.status, z.headers.get('Content-Disposition'), z.headers.get('Content-Length'), zb.length]);
check('...holding each original whole, stored as it is, every CRC right, a clear name each', !!zf && zf.length === 3 && zf.every(f => f.crcOk && f.stored && /^BharatAI-Mumbai-2026-IMG\d\.jpg$/.test(f.name))
  && inR2.every((d, i) => zf.some(f => f.name === `BharatAI-Mumbai-2026-IMG${i}.jpg` && f.data.join() === [0xff, 0xd8, i].join())), zf && zf.map(f => [f.name, f.crcOk]));
check('...and every photo in it is recorded as saved', saved(A.key) === before0 + 3, saved(A.key) - before0);
z = await zipOf(A.key, sig(A.key), allPids.slice(0, 2), '&n=1&of=2');
zf = unzip(new Uint8Array(await z.arrayBuffer()));
check('Save chosen: a ZIP of just those two, named as part 1 of 2 when the page splits a big choice', z.status === 200 && zf && zf.length === 2
  && /photos-part-1-of-2\.zip"/.test(z.headers.get('Content-Disposition') || ''), [z.status, z.headers.get('Content-Disposition')]);
// A photo in the store that is not on A's page is never put in A's ZIP.
const other = 'drive-photo-not-in-any-album';
db.run("INSERT INTO event_photos (event_id, pid, drive_id, title, day, taken_at, camera, hall, width, height, bytes, raw) VALUES (1, 'OtherPhoto01', ?, 'OTHER.JPG', '2026-11-20', '', 'Cam 1', '', 6000, 4000, 3, 0)", [other]);
store.set('event-photos/1/OtherPhoto01/o.jpg', new Uint8Array([0xff, 0xd8, 9]));
z = await zipOf(A.key, sig(A.key), [allPids[0], 'OtherPhoto01']);
zf = unzip(new Uint8Array(await z.arrayBuffer()));
check("a photo that is not on their page is left out of their ZIP", z.status === 200 && zf && zf.length === 1 && !zf.some(f => /OTHER/.test(f.name)), zf && zf.map(f => f.name));
z = await zipOf(A.key, sig(A.key), ['OtherPhoto01']);
check('...and a ZIP of only such photos is refused', z.status === 404 && /no longer available/.test(await z.text()), z.status);
z = await zipOf(A.key, sig(B.key), allPids);
check("another person's page link cannot open this album's ZIP", z.status === 404 && /not complete/.test(await z.text()), z.status);
z = await zipOf(A.key, sig(A.key), Array.from({ length: 101 }, (_, i) => ('Many' + i + 'abcdefghijk').slice(0, 12)));
check('more than 100 photos in one go is refused, in words (the page asks in parts)', z.status === 413 && /up to 100 photos/.test(await z.text()), z.status);
z = await zipOf(A.key, sig(A.key), []);
check('a ZIP link that names no photos is refused', z.status === 404, z.status);
// A photo whose stored size is wrong must fail the download, never give a broken ZIP.
db.run('UPDATE event_photos SET bytes = 9 WHERE pid = ?', [allPids[1]]);
z = await zipOf(A.key, sig(A.key), allPids);
let broke = false; try { await z.arrayBuffer(); } catch { broke = true; }
check('a photo of the wrong size stops the ZIP download rather than giving a broken file', z.status === 200 && broke, { status: z.status, broke });
db.run('UPDATE event_photos SET bytes = 3 WHERE pid = ?', [allPids[1]]);
// A photo the organiser hides in Admin (event_photos.hidden) is gone everywhere, never shown from Drive instead.
db.run('UPDATE event_photos SET hidden = 1 WHERE pid = ?', [pidOf[A.best[0]]]);
const html4 = await (await page(A.key, sig(A.key))).text();
l = await as('GET', '/api/admin/speaker-photos');
const pv4 = await as('GET', `/api/admin/speaker-photos/${A.key}/preview`);
check('a hidden photo is gone from their page, their count and their email, and not shown from Drive', !html4.includes(pidOf[A.best[0]]) && !html4.includes(A.best[0])
  && row(A.key)?.count === A.photos.length - 1 && !(pv4.json?.html || '').includes(pidOf[A.best[0]]) && !(pv4.json?.html || '').includes(A.best[0]), { count: row(A.key)?.count, of: A.photos.length });
z = await zipOf(A.key, sig(A.key), allPids);
zf = unzip(new Uint8Array(await z.arrayBuffer()));
check('...and from their ZIP', z.status === 200 && zf && zf.length === 2 && !zf.some(f => f.name === 'BharatAI-Mumbai-2026-IMG0.jpg'), zf && zf.map(f => f.name));

done();
