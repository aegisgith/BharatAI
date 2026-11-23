// Built-worker checks for the photos email marks (23 Nov 2026, src/routes/photo-tracking.ts):
// the photos email carries one small picture that marks it opened; the person's own page
// reports a visit (never the organiser's "Open their page"); full-size saves come from the
// photo store; Admin -> After the Event shows all three under each "Sent". Nothing is sent:
// the mail service is answered here.
// Run after `npm run build`:  node scripts/verify/smoke-photo-tracking.mjs
import { createHmac } from 'node:crypto';
import vm from 'node:vm';
import { talksWorld, checker, ADMIN } from './talks-world.mjs';

const W = await talksWorld({ times: true });
const { db, rows, sent, hit, as, fetchRaw, read } = W;
const { check, done } = checker();
const DATA = JSON.parse(read('src/data/speaker-photos.json'));
const ATT = JSON.parse(read('src/data/attendee-photos.json'));
const sig = (key) => createHmac('sha256', ADMIN).update('photos:' + key).digest('hex').slice(0, 32);
const SITE = 'https://bharataiinnovation.com';

const A = DATA.people.find(p => p.speakers.length && p.photos.length >= 3 && !p.check);
db.run('INSERT INTO speakers (id, event_id, slug, name, role, organisation, email, is_published) VALUES (?, 1, ?, ?, ?, ?, ?, 1)',
  [A.speakers[0], 'sp-' + A.speakers[0], A.name, 'Founder', 'Example Co', 'a.speaker@example.com']);
const K1 = Object.keys(ATT.albums).find(k => !ATT.albums[k].check && ATT.albums[k].photos.length >= 2);
db.run("INSERT INTO attendees (id, event_id, name, email, company, badge_type) VALUES (?, 1, 'Asha Attendee', 'asha@example.com', 'Asha Co', 'Delegate Pass')", [Number(K1.slice(1))]);

const req = (method, path) => fetchRaw(new Request(SITE + path, { method }));
const marks = (action, key) => rows("SELECT entity_id, detail, actor_kind FROM admin_audit WHERE action = ? AND entity_id = ?", [action, key]);

// ---- the page reports a visit from its own script ----
let r = await req('GET', `/photos/${A.key}?k=${sig(A.key)}`);
const html = await r.text();
const scripts = [...html.matchAll(/<script(?![^>]*application\/json)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
let parses = true; try { scripts.forEach(s => new Function(s)); } catch (e) { parses = String(e); }
check('the page still opens, noindex, with one script that parses and now reports a visit', r.status === 200 && /noindex/.test(r.headers.get('X-Robots-Tag') || '')
  && scripts.length === 1 && parses === true && scripts[0].includes('sendBeacon') && scripts[0].includes("'/seen'") && /by=admin/.test(scripts[0]), { status: r.status, scripts: scripts.length, parses });
check('the page keeps its own headers (private, noindex) and no stale length', /private/.test(r.headers.get('Cache-Control') || '') && /noindex/.test(r.headers.get('X-Robots-Tag') || '') && !r.headers.get('content-length'), [...r.headers].join(' | '));
r = await req('GET', `/photos/${A.key}`);
check('an unsigned page is still refused, untouched', r.status === 404 && !(await r.text()).includes('sendBeacon'), r.status);

// The beacon as a browser runs it: once on screen, it posts to /photos/<key>/seen with the same signature.
const beaconCalls = [];
const runPage = (search) => {
  const timers = [];
  const ctx = { location: { pathname: `/photos/${A.key}`, search }, document: { visibilityState: 'visible', addEventListener() {}, querySelectorAll: () => [], getElementById: () => null, querySelector: () => null },
    navigator: { sendBeacon: (u) => { beaconCalls.push(u); return true; } }, setTimeout: (f) => timers.push(f), fetch: () => Promise.resolve(), window: {}, console };
  try { vm.runInNewContext(scripts[0], ctx); } catch { /* the page's own code may want more of a browser; the beacon is wrapped on its own */ }
  timers.forEach(f => { try { f(); } catch { /* page timers */ } });
};
runPage(`?k=${sig(A.key)}`);
check('in a browser the page posts one visit to its own /seen address', beaconCalls.filter(u => u === `/photos/${A.key}/seen?k=${sig(A.key)}`).length === 1, beaconCalls);
beaconCalls.length = 0;
runPage(`?k=${sig(A.key)}&by=admin`);
check("the organiser's \"Open their page\" (by=admin) posts nothing", beaconCalls.length === 0, beaconCalls);

r = await req('POST', `/photos/${A.key}/seen?k=${sig(A.key)}`);
check('a visit is recorded once per person, as a public mark', r.status === 204 && marks('photos.visited', A.key).length === 1 && JSON.parse(marks('photos.visited', A.key)[0].detail).n === 1
  && marks('photos.visited', A.key)[0].actor_kind === 'public', JSON.stringify(marks('photos.visited', A.key)));
await req('POST', `/photos/${A.key}/seen?k=${sig(A.key)}`);
check('a second visit counts up on the same row', marks('photos.visited', A.key).length === 1 && JSON.parse(marks('photos.visited', A.key)[0].detail).n === 2, JSON.stringify(marks('photos.visited', A.key)));
r = await req('POST', `/photos/${A.key}/seen?k=${sig(A.key)}&by=admin`);
check('a visit marked by=admin is not counted', r.status === 204 && JSON.parse(marks('photos.visited', A.key)[0].detail).n === 2, '');
r = await req('POST', `/photos/${A.key}/seen?k=${'0'.repeat(32)}`);
check('a wrong signature records nothing', r.status === 404 && JSON.parse(marks('photos.visited', A.key)[0].detail).n === 2, r.status);

// ---- the email carries one small picture; the preview does not ----
let p = await as('GET', `/api/admin/speaker-photos/${A.key}/preview`);
check('the preview has no open picture (opening a preview is not their open)', p.status === 200 && !(p.json?.html || '').includes('o.gif'), p.status);
check('nothing is counted before an email carries the picture', !rows("SELECT value FROM app_settings WHERE key = 'photo_open_marks_from'").length, '');
let s = await as('POST', `/api/admin/speaker-photos/${A.key}/send`, {});
const body = sent[0]?.Content?.Body?.[0]?.Content || '';
const pix = `${SITE}/photos/${A.key}/o.gif?k=${sig(A.key)}`;
check('the sent email has the page link and one open picture for this person', s.status === 200 && body.includes(`/photos/${A.key}?k=${sig(A.key)}`) && body.split(pix).length === 2, s.status + ' ' + (body.match(/<img[^>]*o\.gif[^>]*>/) || ['no picture'])[0]);
check('the first email with the picture sets when opens began to count', rows("SELECT value FROM app_settings WHERE key = 'photo_open_marks_from'").length === 1, '');

r = await req('GET', `/photos/${A.key}/o.gif?k=${'f'.repeat(32)}`);
check('a wrong signature still gets the picture but marks nothing', r.status === 200 && r.headers.get('Content-Type') === 'image/gif' && !marks('photos.opened', A.key).length, r.status);
r = await req('GET', `/photos/${A.key}/o.gif?k=${sig(A.key)}`);
const gif = new Uint8Array(await r.arrayBuffer());
check('the picture: a real GIF, never cached, and the open is marked', r.status === 200 && r.headers.get('Content-Type') === 'image/gif' && /no-store/.test(r.headers.get('Cache-Control') || '')
  && gif[0] === 0x47 && gif[1] === 0x49 && gif[2] === 0x46 && marks('photos.opened', A.key).length === 1, r.status + ' ' + gif.length);
await req('GET', `/photos/${A.key}/o.gif?k=${sig(A.key)}`);
check('opening again counts up', JSON.parse(marks('photos.opened', A.key)[0].detail).n === 2, marks('photos.opened', A.key)[0]?.detail);
r = await req('GET', `/photos/z1/o.gif?k=${sig('z1')}`);
check('an album that does not exist marks nothing', r.status === 200 && !rows("SELECT id FROM admin_audit WHERE entity_id = 'z1'").length, '');

// The attendee's email carries their own picture too.
const before = sent.length;
s = await as('POST', `/api/admin/attendee-photos/${K1}/send`, {});
const abody = sent[before]?.Content?.Body?.[0]?.Content || '';
check("an attendee's email carries the picture for their own album", s.status === 200 && abody.includes(`${SITE}/photos/${K1}/o.gif?k=${sig(K1)}`), s.status + ' ' + JSON.stringify(s.json));

// The lists as Admin reads them (before the store exists here, so the photos come from Drive).
const L = await as('GET', '/api/admin/speaker-photos'), AL = await as('GET', '/api/admin/attendee-photos');

// ---- saves come from the photo store ----
db.exec(read('migrations/0064_event_photos.sql'));
db.run("INSERT INTO photo_downloads (person, photo_id, times) VALUES (?, 1, 2), (?, 2, 1), ('admin', 3, 1)", [A.key, A.key]);

// ---- the Admin list ----
check('the marks need admin', (await hit('GET', '/api/admin/photo-tracking')).status === 401, '');
let t = await as('GET', '/api/admin/photo-tracking');
const mA = t.json?.people?.[A.key], mK = t.json?.people?.[K1];
check('for the speaker: opened twice, looked twice, two photos downloaded, opens counted for this send', t.status === 200 && mA && mA.opened === 2 && mA.visits === 2 && mA.saved === 2 && mA.open_tracked === true
  && !!mA.opened_last && !!mA.visited_last, JSON.stringify(mA));
check('for the attendee: sent with the picture, not opened yet', mK && mK.open_tracked === true && mK.opened === 0 && mK.visits === 0, JSON.stringify(mK));
check('both start times are given, and the organiser\'s own saves are not anyone\'s', !!t.json?.open_from && !!t.json?.visit_from && !t.json?.people?.admin, JSON.stringify({ o: t.json?.open_from, v: t.json?.visit_from }));
const alias = A.talks && A.talks.length ? 't' + A.talks[0] : '';
if (alias && alias !== A.key) {
  await req('POST', `/photos/${alias}/seen?k=${sig(alias)}`);
  t = await as('GET', '/api/admin/photo-tracking');
  check('a visit by their other key counts for the same person', t.json?.people?.[A.key]?.visits === 3, JSON.stringify(t.json?.people?.[A.key]));
}

// ---- the After the Event screen draws them ----
const src = read('public/js/admin-after.js');
const answers = { '/api/admin/speaker-photos': L.json, '/api/admin/attendee-photos': AL.json, '/api/admin/photo-tracking': t.json, '/api/admin/feedback/summary': {}, '/api/admin/exhibitor-results': { results: [] }, '/api/admin/find-photos': {}, '/api/admin/booth-photos': { rows: [] } };
const host = { innerHTML: '', addEventListener() {}, querySelector: () => null };
const win = {};
vm.runInNewContext(src, { window: win, document: { getElementById: () => null }, console, Date, isNaN, Number, String, Promise, JSON });
await win.AfterDesk.mount(host, { api: { get: async (u) => answers[u] || {} }, toast() {}, authHeaders: () => ({}) });
const out = host.innerHTML;
check('Admin: under "Sent", opened, looked and downloaded in plain words', out.includes('Opened the email') && out.includes('Looked at their photos') && out.includes('Downloaded 2 photos'), out.length);
check('Admin: the attendee sent with the picture reads "Not opened yet"', out.includes('Not opened yet') && out.includes('Not looked at their photos yet') && out.includes('Downloaded none yet'), '');
check('Admin: a summary of the sent, and when counting began', /Of 1 sent:<\/b> 1 looked at their photos, 1 downloaded at least one, 1 of 1 opened the email/.test(out) && /Opens are counted only for emails sent from/.test(out), (out.match(/<b>Of [^<]*<\/b>[^<]*/g) || []).join(' || '));
check("Admin: \"Open their page\" says it is the organiser, so it is never counted", out.includes(`/photos/${A.key}?k=${sig(A.key)}&amp;by=admin`) && !new RegExp(`/photos/${A.key}\\?k=${sig(A.key)}"`).test(out), (out.match(/href="[^"]*photos\/[^"]*"/) || [''])[0]);

done();
