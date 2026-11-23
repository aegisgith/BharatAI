// Built-worker checks for exhibitors' booth photos (23 Nov 2026, src/routes/exhibitor-photos.ts):
// the photos a company's name or logo is in (src/data/exhibitor-photos.json), on its exhibitor
// dashboard with links signed for that company, and one email to the booth contact from
// Admin -> After the Event. Nothing is sent: the mail service is answered here.
// Run after `npm run build`:  node scripts/verify/smoke-booth-photos.mjs
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { talksWorld, checker } from './talks-world.mjs';

const { db, rows, sent, hit, as, read, fetchRaw, env } = await talksWorld({ seedTalks: false });
const { check, done } = checker();
const mpAs = (companyId) => ({ Cookie: 'mp_session=' + companyId + '.' + crypto.createHmac('sha256', 'talks-mp').update(String(companyId)).digest('hex') });
const DATA = JSON.parse(read('src/data/exhibitor-photos.json'));
const [KEY, CO] = Object.entries(DATA.companies).find(([, c]) => c.photos.length >= 4 && c.best.length >= 4 && c.ids.length === 1);
const EX = CO.ids[0];
const [KEY2, CO2] = Object.entries(DATA.companies).find(([k, c]) => k !== KEY && c.photos.length >= 1);

check('the data: every company has its exhibitor ids, photos and an even number of email photos, all landscape picks from its own photos',
  Object.values(DATA.companies).every(c => c.ids.length && c.photos.length && c.best.every(b => c.photos.includes(b)) && (c.best.length % 2 === 0 || c.best.length === 1) && c.best.length <= 6)
  && Object.values(DATA.companies).every(c => c.photos.every(p => DATA.photos[p])), Object.keys(DATA.companies).length);
const owners = new Map();
for (const c of Object.values(DATA.companies)) for (const id of c.ids) owners.set(id, (owners.get(id) || 0) + 1);
check('no exhibitor row belongs to two companies', [...owners.values()].every(n => n === 1), [...owners].filter(x => x[1] > 1));

// ---- seed: the exhibitor, its dashboard account, and three of its photos in the store (one hidden) ----
db.exec(read('migrations/0064_event_photos.sql'));
db.run("INSERT INTO events (id, title, start_date, end_date) VALUES (2, 'Bharat AI Delhi', '2027-07-28', '2027-07-29')");
db.run("INSERT INTO exhibitors (id, event_id, company_name, contact_email, booth_number) VALUES (?, 1, ?, 'spoc@ex.test', '21')", [EX, CO.name]);
db.run("INSERT INTO exhibitor_team_settings (exhibitor_id, contact_name) VALUES (?, 'Asha Rao')", [EX]);
db.run("INSERT INTO exhibitors (id, event_id, company_name, contact_email, booth_number) VALUES (?, 1, ?, '', '')", [CO2.ids[0], CO2.name]);
db.run("INSERT INTO exhibitors (id, event_id, company_name, contact_email) VALUES (990500, 2, 'Delhi Only', 'delhi@ex.test')");
db.run("INSERT INTO exhibitors (id, event_id, company_name, contact_email) VALUES (990600, 1, 'Not In Any Photo', 'none@ex.test')");
db.run("INSERT INTO mp_companies (id, company_name, email, password_hash, exhibitor_id) VALUES (7001, ?, 'spoc@ex.test', '', ?)", [CO.name, EX]);
db.run("INSERT INTO mp_companies (id, company_name, email, password_hash, exhibitor_id) VALUES (7002, 'Just A Company', 'plain@ex.test', '', NULL)");
db.run("INSERT INTO mp_companies (id, company_name, email, password_hash, exhibitor_id) VALUES (7003, 'Delhi Only', 'delhi@ex.test', '', 990500)");
db.run("INSERT INTO mp_companies (id, company_name, email, password_hash, exhibitor_id) VALUES (7004, 'Not In Any Photo', 'none@ex.test', '', 990600)");
const three = CO.photos.slice(0, 3);
three.forEach((drive, i) => db.run("INSERT INTO event_photos (event_id, pid, drive_id, title, day, taken_at, camera, hall, width, height, bytes, raw, hidden) VALUES (1, ?, ?, ?, '2026-11-20', '', 'Cam 3', '', 6000, 4000, 3, 0, ?)",
  ['BoothPhoto' + String(i).padStart(2, '0'), drive, 'B' + i + '.JPG', i === 2 ? 1 : 0]));

// ---- the exhibitor's dashboard ----
const API = '/api/mp/dashboard/booth-photos';
let r = await hit('GET', API);
check('nobody signed in: 401', r.status === 401, r.status);
r = await hit('GET', API, undefined, mpAs(7002));
check('a company that is not an exhibitor: 401, so the dashboard shows no Booth photos tab', r.status === 401, r.status + ' ' + r.text);
r = await hit('GET', API, undefined, mpAs(7003));
check('a Delhi exhibitor: not eligible (these are the Mumbai photos)', r.status === 200 && r.json?.eligible === false && !(r.json?.photos || []).length, r.text);
r = await hit('GET', API, undefined, mpAs(7004));
check('a Mumbai exhibitor we found in no photo: the tab shows, with no photos', r.status === 200 && r.json?.eligible === true && r.json?.photos.length === 0 && r.json?.company === 'Not In Any Photo', r.text);
r = await hit('GET', API, undefined, mpAs(7001));
const ph = r.json?.photos || [];
check('its own account: the photos that are in the store and not hidden, in the album order', r.status === 200 && r.json?.eligible === true && r.json?.company === CO.name && ph.length === 2 && ph[0].id === three[0] && ph[1].id === three[1], r.status + ' ' + ph.length);
check('each photo is ours, signed for this company, never from Drive', ph.every(p => [p.s, p.m, p.o].every(u => /^https:\/\/bharataiinnovation\.com\/photo\/BoothPhoto0\d\/[smo]\.jpg\?u=x\d+&e=\d+&k=[0-9a-f]{32}$/.test(u) && u.includes('u=x' + EX + '&')))
  && !/googleusercontent|drive\.google/.test(JSON.stringify(ph)), ph[0]);
r = await hit('GET', '/marketplace/dashboard');
check('the dashboard page has the Booth photos tab, hidden until it has an answer, and its script', /id="dash-nav-photos"/.test(r.text) && /data-section="photos"/.test(r.text) && /id="section-photos"/.test(r.text) && /\/static\/booth-photos\.js\?v=/.test(r.text), r.status);

// ---- "Save all N photos (ZIP)" (24 Nov 2026: on once photo-store.ts has photosByPid + photosZip) ----
// Real-sized originals of odd lengths, handed over by the bucket in uneven pieces, so the
// CRC's eight-bytes-at-a-time loop, its tail and the joins between pieces are all crossed.
const T = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; T[n] = c; }
const crc = (b) => { let c = -1; for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
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
    out.push({ name: new TextDecoder().decode(b.subarray(p + 46, p + 46 + nl)), data, crc: c, crcOk: crc(data) === c, stored: v.getUint16(p + 10, true) === 0 });
    p += 46 + nl + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
  }
  return out;
};
const bucket = new Map();
const sizes = [100003, 65541, 7];
sizes.forEach((n, i) => {
  const b = crypto.randomBytes(n); b[0] = 0xff; b[1] = 0xd8;
  bucket.set(`event-photos/1/BoothPhoto${String(i).padStart(2, '0')}/o.jpg`, new Uint8Array(b));
  db.run('UPDATE event_photos SET bytes = ? WHERE pid = ?', [n, 'BoothPhoto' + String(i).padStart(2, '0')]);
});
const piecewise = (u8) => new ReadableStream({ start(ctl) { for (let i = 0; i < u8.length; i += 4099) ctl.enqueue(u8.slice(i, Math.min(u8.length, i + 4099))); ctl.close(); } });
env.UPLOADS = { async get(key) { const b = bucket.get(key); return b ? { body: piecewise(b), size: b.length, httpEtag: '"e"', writeHttpMetadata() {} } : null; } };
r = await hit('GET', API, undefined, mpAs(7001));
check('the dashboard is told where its ZIP is', r.json?.zip === '/api/mp/dashboard/booth-photos/zip', r.json?.zip);
let z = await fetchRaw(new Request('https://bharataiinnovation.com/api/mp/dashboard/booth-photos/zip', { headers: mpAs(7001) }));
const zb = new Uint8Array(await z.arrayBuffer());
const zf = unzip(zb);
check('Save all: one ZIP, an attachment named for the company, its length told up front', z.status === 200 && z.headers.get('Content-Type') === 'application/zip'
  && /attachment; filename="bharat-ai-innovation-2026-[a-z0-9-]+\.zip"/.test(z.headers.get('Content-Disposition') || '') && Number(z.headers.get('Content-Length')) === zb.length, [z.status, z.headers.get('Content-Disposition'), z.headers.get('Content-Length'), zb.length]);
check('...its two shown photos whole and byte for byte, stored as they are, every CRC right; the hidden one left out', !!zf && zf.length === 2 && zf.every(f => f.crcOk && f.stored)
  && zf.every((f, i) => Buffer.compare(Buffer.from(f.data), Buffer.from(bucket.get(`event-photos/1/BoothPhoto0${i}/o.jpg`))) === 0), zf && zf.map(f => [f.name, f.data.length, f.crcOk]));
check('...the CRC matches Node\'s own zlib too', !!zf && zf.every(f => typeof zlib.crc32 !== 'function' || zlib.crc32(f.data) === f.crc), zf && zf.map(f => f.crc));
z = await fetchRaw(new Request('https://bharataiinnovation.com/api/mp/dashboard/booth-photos/zip'));
check('the ZIP needs the dashboard sign-in', z.status === 401, z.status);
z = await fetchRaw(new Request('https://bharataiinnovation.com/api/mp/dashboard/booth-photos/zip', { headers: mpAs(7004) }));
check('a Mumbai exhibitor in no photo gets no ZIP', z.status === 404, z.status);

// ---- Admin -> After the Event -> Booth photos ----
check('the list needs admin', (await hit('GET', '/api/admin/booth-photos')).status === 401, '');
r = await as('GET', '/api/admin/booth-photos');
const row = (r.json?.rows || []).find(x => x.key === KEY), row2 = (r.json?.rows || []).find(x => x.key === KEY2);
check('the list: one row a company, its photos in the store, the booth contact, ready', r.status === 200 && r.json?.rows.length === Object.keys(DATA.companies).length
  && row && row.count === 2 && row.email === 'spoc@ex.test' && row.booth === '21' && row.status === 'ready' && row.thumbs.length === 2, JSON.stringify(row));
check('a company with none of its photos in the store yet waits: no photos', row2 && row2.count === 0 && row2.status === 'no-photos', JSON.stringify(row2));

r = await as('GET', `/api/admin/booth-photos/${KEY}/preview`);
const pv = r.json?.html || '';
check('the preview: to the booth contact, by name, the company and the count; it sends nothing', r.status === 200 && r.json?.to === 'spoc@ex.test' && r.json?.subject === `${CO.name} in the Bharat AI Innovation 2026 photos`
  && /Dear Asha,/.test(pv) && pv.includes('See and save all 2 photos') && sent.length === 0, r.json?.subject);
check('the email shows small photos only, never a full-size link', (pv.match(/\/m\.jpg\?u=x/g) || []).length === 2 && !/\/o\.jpg/.test(pv) && !/googleusercontent/.test(pv), (pv.match(/\.jpg/g) || []).length);
check('an unknown company: 404', (await as('GET', '/api/admin/booth-photos/no-such-company/preview')).status === 404, '');

r = await as('POST', `/api/admin/booth-photos/${KEY}/send`, {});
const body = sent[0]?.Content?.Body?.[0]?.Content || '';
const link = (body.match(/https:\/\/[^"]*\/marketplace\/signin\?t=[^"]+/) || [''])[0].replace(/&amp;/g, '&');
check('one send: to the booth contact, with a button that signs them in', r.status === 200 && sent.length === 1 && JSON.stringify(sent[0].Recipients.To) === '["spoc@ex.test"]' && /go=photos/.test(link), r.status + ' ' + JSON.stringify(r.json));
const audit = rows("SELECT entity_id, detail FROM admin_audit WHERE action = 'booth_photos.sent'");
check('the send is recorded against the company', audit.length === 1 && audit[0].entity_id === KEY && JSON.parse(audit[0].detail).photos === 2, JSON.stringify(audit));
const go = await fetchRaw(new Request(link, { redirect: 'manual' }));
check('the button signs the contact in and lands on Booth photos', go.status === 302 && go.headers.get('location') === '/marketplace/dashboard#photos' && /mp_session=7001\./.test(go.headers.get('set-cookie') || ''), go.status + ' ' + go.headers.get('location'));
r = await as('POST', `/api/admin/booth-photos/${KEY}/send`, {});
check('already sent is refused, unless again', r.status === 409 && r.json?.already === true && sent.length === 1, r.status);
r = await as('POST', `/api/admin/booth-photos/${KEY}/send`, { again: true });
check('send again goes', r.status === 200 && sent.length === 2, r.status);
r = await as('POST', `/api/admin/booth-photos/${KEY2}/send`, {});
check('no contact email or no photos: refused in words, nothing sent', r.status === 400 && /contact email|photo store/.test(r.json?.error || '') && sent.length === 2, r.status + ' ' + r.text);
r = await as('GET', '/api/admin/booth-photos');
check('the list then shows it as sent', (r.json?.rows || []).find(x => x.key === KEY)?.status === 'sent' && (r.json?.rows || []).find(x => x.key === KEY)?.sent_count === 2, '');
done();
