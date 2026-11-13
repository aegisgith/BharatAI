// The world the Submissions suites run in (12 Nov 2026): the enquiry desk's world (the
// built worker on real SQLite with the production schema, email played, the clock at
// 10:00 in India on 12 Nov 2026) plus what an emailed logo or photo needs: the uploads
// bucket played in memory, the export secret AImailPilot holds, exhibitor teams (0050),
// and 0055 itself, applied by the suite when it wants it. A few exhibitors, a talk, a
// confirmed speaker. Files are real PNG and JPEG headers so their sizes are read.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { makeWorld as baseWorld, check, done, mail, RealDate } from './inquiry-world.mjs';

export { check, done, mail, RealDate };
export const SECRET = 'sub-secret';

const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
// A PNG as far as its header: signature, IHDR with the size, then filler. seed makes
// two files of the same size differ.
export const png = (w, h, seed = 1, bytes = 600) => {
  const b = new Uint8Array(bytes).fill(seed & 255);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...be32(w), ...be32(h), 8, 6, 0, 0, 0]);
  return b;
};
// A JPEG as far as its size marker (SOF0).
export const jpeg = (w, h, seed = 1, bytes = 600) => {
  const b = new Uint8Array(bytes).fill(seed & 255);
  b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0x00, 0x11, 8, (h >> 8) & 255, h & 255, (w >> 8) & 255, w & 255, 3]);
  return b;
};
export const svg = (script = false) => new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120">' + (script ? '<script>window.__subXss=1</script>' : '') + '<rect width="400" height="120" fill="#C84F00"/>' + ' '.repeat(220) + '</svg>');
export const b64 = (bytes) => Buffer.from(bytes).toString('base64');
export const file = (filename, bytes, mime) => ({ filename, mime, data: b64(bytes) });

export function makeWorld({ table = true, teams = true, talkContacts = true } = {}) {
  const W = baseWorld();
  const bucket = new Map();
  W.env.UPLOADS = {
    async put(key, bytes, opts) { bucket.set(key, { bytes, type: opts?.httpMetadata?.contentType }); },
    async get(key) {
      const o = bucket.get(key); if (!o) return null;
      return { body: o.bytes, httpEtag: '"e"', writeHttpMetadata(h) { h.set('content-type', o.type || 'application/octet-stream'); } };
    },
    async delete(key) { bucket.delete(key); },
  };
  W.env.ATTENDEE_EXPORT_SECRET = SECRET;
  const sql = (name) => readFileSync(new URL('../../migrations/' + name, import.meta.url), 'utf8');
  const applyTable = () => W.db.exec(sql('0055_inbox_submissions.sql'));
  if (teams) W.db.exec(sql('0050_exhibitor_team.sql'));
  if (talkContacts) W.db.exec(sql('0052_innovation_talk_details.sql'));
  if (table) applyTable();

  const { insert } = W;
  // Acme Robotics: a booth with two passes, a booth contact, one person on the team.
  const acme = insert('exhibitors', { event_id: 1, company_name: 'Acme Robotics Pvt Ltd', contact_email: 'ravi@acmerobotics.in', website_url: 'https://www.acmerobotics.in', booth_number: '12' });
  const b1 = insert('booths', { event_id: 1, code: '12', type_key: 'innovator', name: 'Innovator Booth', sqm: 9, list_price_inr: 250000 });
  insert('booth_allocations', { event_id: 1, booth_id: b1, exhibitor_id: acme, company_name: 'Acme Robotics', contact_name: 'Ravi Kumar', email: 'accounts@acmerobotics.in', status: 'confirmed', amount_inr: 250000 });
  if (teams) insert('exhibitor_team', { event_id: 1, exhibitor_id: acme, first_name: 'Meera', last_name: 'Shah', email: 'meera@acmerobotics.in', company: 'Acme Robotics Pvt Ltd', added_by: 'sheet' });
  // Zenith Data Labs: contact on a free mail address, already has a logo.
  const zenith = insert('exhibitors', { event_id: 1, company_name: 'Zenith Data Labs', contact_email: 'zenith.founder@gmail.com', logo_url: 'https://bharataiinnovation.com/images/exhibitors/zenith-data-labs.webp' });
  // Global Solutions India: a name made only of words every company uses.
  const generic = insert('exhibitors', { event_id: 1, company_name: 'Global Solutions India', contact_email: '' });
  // An organiser's row (no exhibitor_id), so the app's public list shows it; it is tied
  // to Acme by the company name, as the talks from the organiser's sheet are.
  const talk = insert('innovation_talks', { event_id: 1, speaker_name: 'Dr. Asha Rao', company: 'Acme Robotics Pvt Ltd', topic: 'Robots that learn', status: 'confirmed',
    ...(talkContacts ? { speaker_email: 'asha.rao@acmerobotics.in' } : {}) });
  const talk2 = insert('innovation_talks', { event_id: 1, speaker_name: 'Vikram Iyer', company: 'Zenith Data Labs', topic: 'Data at scale', status: 'confirmed', speaker_photo_url: '/images/talks/vikram-iyer.webp' });
  const speaker = insert('speakers', { event_id: 1, slug: 'neha-kapoor', name: 'Neha Kapoor', role: 'Chief Data Officer', organisation: 'Bank of the North', email: 'neha.kapoor@bankofnorth.in', is_published: 1, sort_order: 5 });
  const hidden = insert('speakers', { event_id: 1, slug: 'old-speaker', name: 'Old Speaker', organisation: 'Gone Ltd', email: 'old@gone.in', is_published: 0 });

  let n = 0;
  // One email as AImailPilot posts it. Any field can be replaced.
  const push = (o = {}, { secret = SECRET } = {}) => W.call('/api/external/inbox-submissions', {
    method: 'POST', headers: secret ? { Authorization: 'Bearer ' + secret } : {},
    body: { source: 'aimailpilot', source_id: 'msg-' + (++n), thread_id: '', from_email: 'ravi@acmerobotics.in', from_name: 'Ravi Kumar', to_email: 'puja@aegis.edu.in',
      // Ten minutes apart, so two test emails are never taken for one email in two mailboxes.
      subject: 'Our logo', text: 'Hi Puja,\nPlease find our logo attached.\n\nRegards,\nRavi', received_at: new Date(Date.parse('2026-11-12T04:30:00.000Z') + n * 600000).toISOString(), link: 'https://aimailpilot.com/#inbox/msg-' + n, attachments: [], ...o },
  });
  const admin = (path, { method = 'GET', body, actor = 'Priya' } = {}) => W.call(path, { method, body, admin: true, actor });
  const sub = (id) => {
    const r = W.rows('SELECT * FROM inbox_submissions WHERE id = ?', [id])[0];
    if (!r) return null;
    return { ...r, attachments: JSON.parse(r.attachments), matches: JSON.parse(r.matches), applied: JSON.parse(r.applied) };
  };
  return { ...W, bucket, applyTable, push, admin, sub, ids: { acme, zenith, generic, talk, talk2, speaker, hidden } };
}

// The screen's page script, run as the browser would, without a browser.
export function deskFunctions() {
  const code = readFileSync(new URL('../../public/js/admin-submissions.js', import.meta.url), 'utf8');
  const sandbox = { URL, URLSearchParams, setTimeout, clearTimeout, console };
  sandbox.window = sandbox;
  sandbox.document = {};
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'admin-submissions.js' });
  return sandbox.SubDesk._t;
}
