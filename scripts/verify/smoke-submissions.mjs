// Integration: emailed logos, photos and team lists, on the built worker and real
// SQLite with the production schema (12 Nov 2026). The route AImailPilot posts to (who
// may call it, what it files, what it leaves alone, the same picture twice), who an
// email is from and for (sure, likely, nobody), people read out of the words, the
// Admin routes (apply a logo, a talk photo, a speaker photo, a team; undo; set aside),
// the "without asking" switches, the export for the website script, the sender list
// AImailPilot listens for, an SVG that cannot run as a page, and before 0055 / 0052.
// Run after `npm run build`:  node scripts/verify/smoke-submissions.mjs
import { makeWorld, check, done, png, jpeg, svg, file, SECRET } from './submissions-world.mjs';

const ORIGIN = 'https://bharataiinnovation.com';

// ======== before 0055: nothing breaks, and the screen says what to run ========
{
  const W = makeWorld({ table: false });
  const r = await W.push({ attachments: [file('Acme logo.png', png(600, 200), 'image/png')] });
  check('before 0055: the route answers 503 with the command, and stores no file', r.status === 503 && /0055_inbox_submissions\.sql/.test(r.json?.error || '') && W.bucket.size === 0, r.text);
  const l = await W.admin('/api/admin/inbox-submissions');
  check('before 0055: Admin is told the same, marked not_yet', l.status === 503 && l.json?.not_yet === true && /wrangler d1 execute/.test(l.json?.error || ''), l.text);
  const c = await W.admin('/api/admin/inbox-submissions/count');
  check('before 0055: the sidebar count is nought, not an error', c.status === 200 && c.json?.new === 0, c.text);
  W.applyTable(); W.applyTable();
  const again = await W.push({ source_id: 'after', attachments: [file('Acme logo.png', png(600, 200), 'image/png')] });
  check('0055 is safe to run twice, and the same email is then filed', again.status === 201 && again.json?.status === 'stored', again.text);
}

const W = makeWorld();
const { push, admin, sub, rows, ids, bucket } = W;
const audits = (id, action) => rows("SELECT * FROM admin_audit WHERE entity = 'submission' AND entity_id = ? AND action = ? ORDER BY id", [String(id), action]);
const exRow = (id) => rows('SELECT * FROM exhibitors WHERE id = ?', [id])[0];
const count = () => rows('SELECT COUNT(*) AS n FROM inbox_submissions')[0].n;

// ======== who may call ========
{
  check('no secret: refused', (await push({}, { secret: '' })).status === 401);
  check('a wrong secret: refused', (await push({}, { secret: 'nope' })).status === 401);
  check('the admin password is not the secret', (await W.call('/api/external/inbox-submissions', { method: 'POST', body: { source_id: 'x' }, admin: true })).status === 401);
  check('nothing was filed by any of them', count() === 0 && bucket.size === 0);
  check('an email with no id is refused', (await push({ source_id: '' })).status === 400);
  const bad = await W.worker.fetch(new Request(ORIGIN + '/api/external/inbox-submissions', { method: 'POST', headers: { Authorization: 'Bearer ' + SECRET, 'Content-Type': 'application/json' }, body: '{not json' }), W.env, W.ctx);
  check('a body that is not JSON is refused', bad.status === 400);
  delete W.env.ATTENDEE_EXPORT_SECRET;
  check('with no secret set on the server, nobody gets in', (await push({})).status === 500);
  W.env.ATTENDEE_EXPORT_SECRET = SECRET;
}

// ======== a logo from the booth contact ========
let logoId;
{
  const r = await push({ source_id: 'logo-1', thread_id: 'th-acme', attachments: [file('Acme logo.png', png(600, 200, 1), 'image/png')] });
  logoId = r.json?.id;
  const s = sub(logoId);
  check('logo: filed, called a logo', r.status === 201 && r.json.status === 'stored' && r.json.kind === 'logo' && s?.kind === 'logo' && s.status === 'new', r.text);
  const f = s.attachments[0];
  check('logo: the file is kept with its name, kind, size in pixels and use', s.attachments.length === 1 && f.filename === 'Acme logo.png' && f.mime === 'image/png' && f.w === 600 && f.h === 200 && f.use === 'logo' && f.size === 600 && /^[0-9a-f]{64}$/.test(f.hash), f);
  check('logo: the key is plain letters under submissions/', /^submissions\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(f.key) && bucket.has(f.key), f.key);
  const ex = s.matches.exhibitors[0];
  check('logo: the sender is the booth contact, for certain', ex?.id === ids.acme && ex.sure === true && ex.how === 'the booth contact', s.matches.exhibitors);
  check('logo: their own stage talk is offered too, as likely', s.matches.talks.some((t) => t.id === ids.talk && t.sure === false), s.matches.talks);
  check('logo: the email is kept: who, to whom, subject, words, link, time', s.from_email === 'ravi@acmerobotics.in' && s.from_name === 'Ravi Kumar' && s.to_email === 'puja@aegis.edu.in' && s.subject === 'Our logo' && /logo attached/.test(s.body) && s.link === 'https://aimailpilot.com/#inbox/msg-' + s.link.split('msg-')[1] && /^2026-11-1[23]T\d\d:\d\d:00\.000Z$/.test(s.received_at), s);
  const got = await W.worker.fetch(new Request(ORIGIN + '/api/uploads/' + f.key), W.env, W.ctx);
  check('logo: the file is served as the picture it is, with no page rules needed', got.status === 200 && got.headers.get('content-type') === 'image/png' && !got.headers.get('content-security-policy') && (await got.arrayBuffer()).byteLength === 600);
  check('logo: arrival is in the history', audits(logoId, 'submission.received').length === 1);

  const dup = await push({ source_id: 'logo-1', attachments: [file('Acme logo.png', png(600, 200, 1), 'image/png')] });
  check('the same email again is not filed twice', dup.status === 200 && dup.json.status === 'duplicate' && dup.json.id === logoId && count() === 1 && bucket.size === 1, dup.text);
  const sig = await push({ source_id: 'logo-2', thread_id: 'th-acme', subject: 'RE: Our logo', text: 'Thanks Puja.', attachments: [file('image001.png', png(600, 200, 1), 'image/png')] });
  check('the same picture in a later email (a signature, a quoted reply) is not filed again', sig.status === 200 && sig.json.status === 'ignored' && count() === 1 && bucket.size === 1, sig.text);
  const two = await push({ source_id: 'logo-3', subject: 'Logo, new version', text: 'Updated logo attached.', attachments: [file('image001.png', png(600, 200, 1), 'image/png'), file('acme-logo-v2.png', png(900, 300, 2), 'image/png'), file('acme-logo-v2-copy.png', png(900, 300, 2), 'image/png')] });
  check('a new picture beside the old one: only the new one is filed, once', two.status === 201 && sub(two.json.id).attachments.length === 1 && sub(two.json.id).attachments[0].filename === 'acme-logo-v2.png', sub(two.json?.id)?.attachments);
}

// ======== who it is from: sure, likely, nobody ========
let photoId, colleagueId, namedId, strangerId;
{
  let r = await push({ source_id: 'photo-1', from_email: 'Asha.Rao@AcmeRobotics.in', from_name: 'Asha Rao', subject: 'My photo for the talk', text: 'Hello, please find my photograph attached.', attachments: [file('IMG_2231.jpg', jpeg(800, 1000, 3), 'image/jpeg')] });
  photoId = r.json?.id;
  let s = sub(photoId);
  check('photo: called a photo, the file read as one (taller than wide)', r.json?.kind === 'photo' && s.attachments[0].use === 'photo' && s.attachments[0].w === 800 && s.attachments[0].h === 1000, s?.attachments);
  check('photo: the address is lowercased and is the speaker on file, for certain', s.from_email === 'asha.rao@acmerobotics.in' && s.matches.talks[0]?.id === ids.talk && s.matches.talks[0].sure === true && s.matches.talks[0].how === 'the speaker', s.matches.talks);
  check('photo: and so the company they speak for is known', s.matches.exhibitors[0]?.id === ids.acme && s.matches.exhibitors[0].sure === true, s.matches.exhibitors);

  r = await push({ source_id: 'col-1', from_email: 'newperson@acmerobotics.in', from_name: 'New Person', subject: 'Logo in vector', text: 'Sharing the logo.', attachments: [file('brandmark.svg', svg(true), 'image/svg+xml')] });
  colleagueId = r.json?.id; s = sub(colleagueId);
  check('a colleague not on any list: the company is likely, by its email domain', s.matches.exhibitors[0]?.id === ids.acme && s.matches.exhibitors[0].sure === false && s.matches.exhibitors[0].how === 'same company email', s.matches.exhibitors);
  check('an SVG is filed as a logo', s.kind === 'logo' && s.attachments[0].mime === 'image/svg+xml' && s.attachments[0].use === 'logo');
  const got = await W.worker.fetch(new Request(ORIGIN + '/api/uploads/' + s.attachments[0].key), W.env, W.ctx);
  check('an SVG opened on its own is sandboxed, so a script inside cannot act as this site', got.status === 200 && /sandbox/.test(got.headers.get('content-security-policy') || '') && got.headers.get('x-content-type-options') === 'nosniff', got.headers.get('content-security-policy'));

  r = await push({ source_id: 'named-1', from_email: 'someone.else@gmail.com', from_name: 'Agency Person', subject: 'Logo for Zenith Data Labs', text: 'On behalf of the client.', attachments: [file('final.png', png(500, 160, 4), 'image/png')] });
  namedId = r.json?.id; s = sub(namedId);
  check('a free-mail sender naming the company: likely, because it is named', s.matches.exhibitors.length === 1 && s.matches.exhibitors[0].id === ids.zenith && s.matches.exhibitors[0].sure === false && s.matches.exhibitors[0].how === 'named in the email', s.matches.exhibitors);
  check('a shared free-mail domain never links two people', !sub(namedId).matches.exhibitors.some((e) => e.how.includes('same company')));

  r = await push({ source_id: 'stranger-1', from_email: 'hello@unknown-vendor.com', from_name: 'Vendor', subject: 'Our global solutions for India', text: 'We offer technology solutions and services across India.', attachments: [file('brochure-logo.png', png(400, 100, 5), 'image/png')] });
  strangerId = r.json?.id; s = sub(strangerId);
  check('a stranger: nobody is guessed, even when their words are every company\'s words', s.matches.exhibitors.length === 0 && s.matches.talks.length === 0 && s.matches.speakers.length === 0, s.matches);

  r = await push({ source_id: 'spk-1', from_email: 'assistant@bankofnorth.in', from_name: 'EA to Neha', subject: 'Photo of Ms Neha Kapoor', text: 'Please use the attached headshot.', attachments: [file('Neha Kapoor headshot.jpg', jpeg(1200, 1200, 6), 'image/jpeg')] });
  s = sub(r.json?.id);
  check('a confirmed speaker\'s office: the speaker is likely (same organisation, and named)', s.kind === 'photo' && s.matches.speakers[0]?.id === ids.speaker && s.matches.speakers[0].sure === false, s.matches.speakers);
  check('a speaker taken off the list is never offered', !s.matches.speakers.some((x) => x.id === ids.hidden));
}

// ======== what is left alone ========
{
  const before = count();
  let r = await push({ source_id: 'none-1', subject: 'Thank you', text: 'See you at the event.' });
  check('an email with no file and no list is left in the inbox', r.status === 200 && r.json.status === 'ignored' && count() === before, r.text);
  r = await push({ source_id: 'doc-1', subject: 'Agreement', text: 'Signed copy attached.', attachments: [file('agreement.docx', png(10, 10, 7), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), file('notes.zip', png(10, 10, 8), 'application/zip')] });
  check('a document or a zip is not a kind of file this screen uses', r.json.status === 'ignored' && count() === before, r.text);
  r = await push({ source_id: 'tiny-1', subject: 'Logo', text: 'logo', attachments: [file('dot.png', png(1, 1, 9, 120), 'image/png')] });
  check('a picture of a few bytes (a tracking dot) is dropped', r.json.status === 'ignored' && count() === before, r.text);
  r = await push({ source_id: 'ext-1', subject: 'Logo', text: 'Our logo.', attachments: [file('company logo.PNG', png(640, 200, 10), 'application/octet-stream')] });
  check('a picture sent with no proper type is known by its ending', r.status === 201 && sub(r.json.id).attachments[0].mime === 'image/png', r.text);
  r = await push({ source_id: 'big-1', subject: 'Logo', text: 'Our logo.', attachments: [file('huge.png', png(4000, 4000, 11, 8 * 1024 * 1024 + 10), 'image/png')] });
  check('a file over 8 MB is refused, and nothing of that email is kept', r.status === 413 && !rows("SELECT id FROM inbox_submissions WHERE source_id = 'big-1'").length, r.text);
  const many = Array.from({ length: 11 }, (_, i) => file('photo-' + i + '.jpg', jpeg(600, 800, 20 + i), 'image/jpeg'));
  r = await push({ source_id: 'many-1', subject: 'Team photos', text: 'Photos attached.', attachments: many });
  check('at most eight files of one email are kept', r.status === 201 && sub(r.json.id).attachments.length === 8, sub(r.json?.id)?.attachments.length);
  r = await push({ source_id: 'name-1', subject: 'Logo', text: 'x', attachments: [file('../../etc/<b>x</b> "q".png', png(300, 100, 40), 'image/png')] });
  const f = sub(r.json.id).attachments[0];
  check('a file name cannot climb out of its folder or carry markup into the key', /^submissions\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(f.key) && !/[<>"]/.test(f.filename) && !f.key.includes('..'), f);
}

// ======== people named in the words ========
let teamId;
{
  const text = [
    'Hi Team,', 'Thanks for your mail yesterday.', 'Please find the names of our team members for the exhibitor passes:', '',
    '1. Priya Nair - Marketing Head - priya.nair@acmerobotics.in - 98200 12345',
    '2. Arjun Mehta, Sales Manager, arjun@acmerobotics.in, +91 9820098200',
    '3) Kiran Rao | CTO | kiran@acmerobotics.in',
    '4. Anne-Marie Dsouza - Designer',
    'Looking forward, see you there', '',
    'Thanks,', 'Ravi Kumar', 'Director, Acme Robotics', '+91 98765 43210', '',
    'On Tue, Nov 10, 2026 at 10:55 PM Puja Deka <puja@aegis.edu.in> wrote:', '> 1. Old Person - Quoted Role - old@acmerobotics.in',
  ].join('\n');
  const r = await push({ source_id: 'team-1', subject: 'Team members for passes', text });
  teamId = r.json?.id;
  const s = sub(teamId);
  const p = s.matches.people;
  check('team: filed as a team list though it has no file', r.status === 201 && s.kind === 'team' && s.attachments.length === 0, r.text);
  check('team: four people, in order', p.length === 4 && p.map((x) => x.first_name + ' ' + x.last_name).join('|') === 'Priya Nair|Arjun Mehta|Kiran Rao|Anne-Marie Dsouza', p.map((x) => x.first_name + ' ' + x.last_name));
  check('team: designation, email and mobile read from a dashed line', p[0].designation === 'Marketing Head' && p[0].email === 'priya.nair@acmerobotics.in' && p[0].mobile === '9820012345', p[0]);
  check('team: from a comma line with +91, and from a line with bars', p[1].designation === 'Sales Manager' && p[1].mobile === '9820098200' && p[2].designation === 'CTO' && p[2].email === 'kiran@acmerobotics.in' && p[2].mobile === '', [p[1], p[2]]);
  check('team: a hyphen inside a name is part of the name', p[3].first_name === 'Anne-Marie' && p[3].last_name === 'Dsouza' && p[3].designation === 'Designer' && p[3].email === '', p[3]);
  check('team: the greeting, a sentence with a comma, the signature and the quoted email are not people', !p.some((x) => /Hi|Looking|Ravi|Old|Thanks/.test(x.first_name)), p.map((x) => x.first_name));
  check('team: "Thanks for your mail" at the top does not end the email', p.length === 4);

  const html = '<html><body><p>Dear Puja,</p><p>Our delegates:</p><table><tr><th>Name</th><th>Designation</th><th>Email</th></tr><tr><td>Sunil Verma</td><td>VP &amp; Head</td><td>sunil@acmerobotics.in</td></tr><tr><td>Fatima Sheikh</td><td>Engineer</td><td>fatima@acmerobotics.in</td></tr></table><style>p{color:red}</style><script>alert(1)</script></body></html>';
  const h = await push({ source_id: 'team-2', subject: 'Delegates', text: html });
  const hs = sub(h.json?.id);
  check('team: a table pasted from a sheet (HTML) reads the same way, markup and scripts gone', hs.kind === 'team' && hs.matches.people.length === 2 && hs.matches.people[0].first_name === 'Sunil' && hs.matches.people[0].designation === 'VP & Head' && hs.matches.people[1].email === 'fatima@acmerobotics.in' && !/<|alert|color:red/.test(hs.body), [hs.matches.people, hs.body]);
}

// ======== Admin: the list ========
{
  const noAuth = await W.call('/api/admin/inbox-submissions');
  check('the list is for Admin only', noAuth.status === 401);
  const l = (await admin('/api/admin/inbox-submissions')).json;
  check('the list: everything waiting, newest first, parsed', l.ok && l.rows.length === count() && Array.isArray(l.rows[0].attachments) && typeof l.rows[0].matches === 'object' && l.counts.new === count(), l.counts);
  check('the list: the pickers, saying who already has a logo or a photo', l.targets.exhibitors.some((e) => e.id === ids.zenith && e.has) && l.targets.exhibitors.some((e) => e.id === ids.acme && !e.has)
    && l.targets.talks.some((t) => t.id === ids.talk2 && t.has) && l.targets.speakers.length === 1 && l.targets.speakers[0].id === ids.speaker, l.targets);
  check('the list: both switches off to begin with', l.settings.auto.logo === false && l.settings.auto.photo === false);
  check('the sidebar count is what waits', (await admin('/api/admin/inbox-submissions/count')).json.new === count());
}

// ======== Admin: a logo, used and undone ========
{
  const s0 = sub(logoId);
  let r = await admin(`/api/admin/inbox-submissions/${logoId}/apply`, { method: 'POST', body: { what: 'logo', exhibitor_id: ids.acme, file: 0 } });
  const url = ORIGIN + '/api/uploads/' + s0.attachments[0].key;
  check('logo used: the exhibitor carries it as a full web address (the app trusts only those)', r.status === 200 && exRow(ids.acme).logo_url === url, exRow(ids.acme).logo_url);
  check('logo used: the row says so, by whom, with what was there before', r.json.row.status === 'applied' && r.json.entry.by === 'Priya' && r.json.entry.prev === '' && r.json.entry.target === 'Acme Robotics Pvt Ltd' && r.json.row.decided_by === 'Priya', r.json.entry);
  check('logo used: in the history', audits(logoId, 'submission.apply').length === 1);

  r = await admin(`/api/admin/inbox-submissions/${namedId}/apply`, { method: 'POST', body: { what: 'logo', exhibitor_id: ids.zenith, file: 0 } });
  check('a logo that replaces one keeps the old address', r.json.entry.prev === 'https://bharataiinnovation.com/images/exhibitors/zenith-data-labs.webp' && exRow(ids.zenith).logo_url.includes('/api/uploads/submissions/'));
  r = await admin(`/api/admin/inbox-submissions/${namedId}/undo`, { method: 'POST', body: { index: 0 } });
  check('undo puts the old logo back and the email waits again', r.status === 200 && exRow(ids.zenith).logo_url === 'https://bharataiinnovation.com/images/exhibitors/zenith-data-labs.webp' && r.json.row.status === 'new' && r.json.row.applied[0].undone, r.text);
  check('undo twice is refused', (await admin(`/api/admin/inbox-submissions/${namedId}/undo`, { method: 'POST', body: { index: 0 } })).status === 400);

  r = await admin(`/api/admin/inbox-submissions/${namedId}/apply`, { method: 'POST', body: { what: 'logo', exhibitor_id: ids.zenith, file: 0 } });
  W.db.run("UPDATE exhibitors SET logo_url = 'https://bharataiinnovation.com/images/exhibitors/newer.webp' WHERE id = ?", [ids.zenith]);
  r = await admin(`/api/admin/inbox-submissions/${namedId}/undo`, { method: 'POST', body: { index: 1 } });
  check('undo never overwrites a logo somebody changed since', r.status === 200 && exRow(ids.zenith).logo_url === 'https://bharataiinnovation.com/images/exhibitors/newer.webp');

  const refusals = [
    [{ what: 'logo', exhibitor_id: ids.acme, file: 9 }, 400, 'a file that is not there'],
    [{ what: 'logo', exhibitor_id: 99999, file: 0 }, 400, 'an exhibitor that is not there'],
    [{ what: 'logo', file: 0 }, 400, 'no exhibitor chosen'],
    [{ what: 'delete_everything', file: 0 }, 400, 'something this screen does not do'],
    [{}, 400, 'nothing at all'],
  ];
  for (const [body, status, name] of refusals) {
    const x = await admin(`/api/admin/inbox-submissions/${logoId}/apply`, { method: 'POST', body });
    check('refused: ' + name, x.status === status && !!x.json?.error, x.text);
  }
  check('refused: an email that is not there', (await admin('/api/admin/inbox-submissions/99999/apply', { method: 'POST', body: { what: 'logo', exhibitor_id: ids.acme, file: 0 } })).status === 404);
  check('refused: without the admin password', (await W.call(`/api/admin/inbox-submissions/${logoId}/apply`, { method: 'POST', body: { what: 'logo', exhibitor_id: ids.acme, file: 0 } })).status === 401);
}

// ======== Admin: photos ========
{
  const key = sub(photoId).attachments[0].key;
  let r = await admin(`/api/admin/inbox-submissions/${photoId}/apply`, { method: 'POST', body: { what: 'talk_photo', talk_id: ids.talk, file: 0 } });
  const talk = rows('SELECT * FROM innovation_talks WHERE id = ?', [ids.talk])[0];
  check('talk photo used: the talk carries the path the app shows', r.status === 200 && talk.speaker_photo_url === '/api/uploads/' + key, talk.speaker_photo_url);
  const pub = (await W.call('/api/events/1/innovation-talks')).json;
  check('talk photo used: the app\'s own list hands it out, and no email or mobile with it', Array.isArray(pub) && pub.find((t) => t.id === ids.talk)?.speaker_photo_url === '/api/uploads/' + key && !JSON.stringify(pub).includes('asha.rao@'), pub?.[0]);
  r = await admin(`/api/admin/inbox-submissions/${photoId}/apply`, { method: 'POST', body: { what: 'speaker_photo', speaker_id: ids.speaker, file: 0 } });
  check('the same file can also be a confirmed speaker\'s photo', r.status === 200 && rows('SELECT photo_url FROM speakers WHERE id = ?', [ids.speaker])[0].photo_url === '/api/uploads/' + key && r.json.row.applied.length === 2);
  r = await admin(`/api/admin/inbox-submissions/${photoId}/undo`, { method: 'POST', body: { index: 1 } });
  check('undoing one use leaves the other, and the email stays Used', rows('SELECT photo_url FROM speakers WHERE id = ?', [ids.speaker])[0].photo_url === null && rows('SELECT speaker_photo_url FROM innovation_talks WHERE id = ?', [ids.talk])[0].speaker_photo_url === '/api/uploads/' + key && r.json.row.status === 'applied');
  r = await admin(`/api/admin/inbox-submissions/${colleagueId}/apply`, { method: 'POST', body: { what: 'talk_photo', talk_id: ids.talk, file: 0 } });
  check('an SVG is refused as a photo, in words', r.status === 400 && /JPEG, PNG or WebP/.test(r.json.error), r.text);
  const pdf = await push({ source_id: 'pdf-1', subject: 'Logo PDF', text: 'Logo in PDF.', attachments: [file('logo.pdf', png(10, 10, 60, 900), 'application/pdf')] });
  r = await admin(`/api/admin/inbox-submissions/${pdf.json.id}/apply`, { method: 'POST', body: { what: 'logo', exhibitor_id: ids.acme, file: 0 } });
  check('a PDF is filed but refused as an app logo, in words', pdf.status === 201 && sub(pdf.json.id).attachments[0].use === 'logo' && r.status === 400 && /PDF/.test(r.json.error), r.text);
}

// ======== Admin: people onto the team ========
{
  const people = sub(teamId).matches.people;
  let r = await admin(`/api/admin/inbox-submissions/${teamId}/apply`, { method: 'POST', body: { what: 'team', exhibitor_id: ids.acme, people: [people[0], people[1], { first_name: 'Bad', last_name: 'Mail', email: 'not-an-email' }, { first_name: 'Meera', last_name: 'Again', email: 'MEERA@acmerobotics.in' }, { first_name: '', email: 'x@y.in' }] } });
  const team = rows('SELECT * FROM exhibitor_team WHERE exhibitor_id = ? ORDER BY id', [ids.acme]);
  check('team: the two good ones are on the team, marked as from the inbox by this admin', r.status === 200 && team.length === 3 && team[1].first_name === 'Priya' && team[1].email === 'priya.nair@acmerobotics.in' && team[1].mobile === '9820012345' && team[1].designation === 'Marketing Head' && team[1].company === 'Acme Robotics Pvt Ltd' && team[1].added_by === 'inbox:Priya', team.map((t) => t.email));
  check('team: a bad email and someone already on a team are said, not added', r.json.entry.people.length === 2 && r.json.entry.skipped.length === 2 && /email does not look right/.test(r.json.entry.skipped.join(' ')) && /already on a team/.test(r.json.entry.skipped.join(' ')), r.json.entry.skipped);
  const passes = rows("SELECT name, email, badge_type FROM attendees WHERE email IN ('priya.nair@acmerobotics.in', 'arjun@acmerobotics.in', 'meera@acmerobotics.in') ORDER BY email");
  const withPass = team.filter((t) => t.pass && !/visitor/i.test(t.pass)).length;
  check('team: passes are settled the way the exhibitor\'s own dashboard does it (two with this booth, the third told why not)', withPass === 2 && team.every((t) => t.pass || t.pass_note) && passes.length >= 2, [team.map((t) => [t.email, t.pass, t.pass_note]), passes]);
  check('team: the email is Used', sub(teamId).status === 'applied' && audits(teamId, 'submission.apply').length === 1);
  r = await admin(`/api/admin/inbox-submissions/${teamId}/undo`, { method: 'POST', body: { index: 0 } });
  check('team: people are not removed by Undo here; the words say where', r.status === 400 && /Teams & Passes/.test(r.json.error), r.text);
  r = await admin(`/api/admin/inbox-submissions/${teamId}/apply`, { method: 'POST', body: { what: 'team', exhibitor_id: ids.acme, people: [] } });
  check('team: nobody ticked is refused', r.status === 400 && /Tick at least one/.test(r.json.error), r.text);
  r = await admin(`/api/admin/inbox-submissions/${teamId}/apply`, { method: 'POST', body: { what: 'team', people: [people[2]] } });
  check('team: no exhibitor chosen is refused', r.status === 400 && /Choose the exhibitor/.test(r.json.error), r.text);
}

// ======== Admin: set aside, bring back ========
{
  let r = await admin(`/api/admin/inbox-submissions/${strangerId}/dismiss`, { method: 'POST', body: {} });
  check('set aside: gone from Waiting, kept under Set aside, by whom', r.json.row.status === 'dismissed' && r.json.row.decided_by === 'Priya' && !(await admin('/api/admin/inbox-submissions')).json.rows.some((x) => x.id === strangerId)
    && (await admin('/api/admin/inbox-submissions?status=dismissed')).json.rows.some((x) => x.id === strangerId));
  r = await admin(`/api/admin/inbox-submissions/${strangerId}/reopen`, { method: 'POST', body: {} });
  check('bring back: waiting again', r.json.row.status === 'new');
  r = await admin(`/api/admin/inbox-submissions/${logoId}/dismiss`, { method: 'POST', body: {} });
  const back = await admin(`/api/admin/inbox-submissions/${logoId}/reopen`, { method: 'POST', body: {} });
  check('a used one set aside and brought back is Used again, and its logo was never touched', back.json.row.status === 'applied' && exRow(ids.acme).logo_url.includes('/api/uploads/submissions/'));
}

// ======== without asking ========
{
  W.db.run('UPDATE exhibitors SET logo_url = NULL WHERE id = ?', [ids.acme]);
  let r = await push({ source_id: 'auto-0', subject: 'Logo final', text: 'Logo attached.', attachments: [file('acme-logo-final.png', png(1000, 300, 70), 'image/png')] });
  check('switch off: a logo from the booth contact still waits', r.json.status === 'stored' && exRow(ids.acme).logo_url === null);
  check('the switches are for Admin only', (await W.call('/api/admin/inbox-submissions/settings', { method: 'PUT', body: { auto: { logo: true } } })).status === 401);
  r = await admin('/api/admin/inbox-submissions/settings', { method: 'PUT', body: { auto: { logo: true } } });
  check('logos on, photos still off', r.json.auto.logo === true && r.json.auto.photo === false && (await admin('/api/admin/inbox-submissions')).json.settings.auto.logo === true);

  r = await push({ source_id: 'auto-1', from_email: 'meera@acmerobotics.in', from_name: 'Meera Shah', subject: 'Company logo', text: 'Our logo, high resolution.', attachments: [file('acme-logo-hires.png', png(2000, 600, 71), 'image/png')] });
  const a1 = sub(r.json.id);
  check('switch on: one logo from someone on the team is used on arrival', r.status === 201 && r.json.status === 'applied' && a1.status === 'applied' && a1.applied[0].by === 'automatic' && a1.decided_by === 'automatic' && exRow(ids.acme).logo_url === ORIGIN + '/api/uploads/' + a1.attachments[0].key, r.text);
  check('switch on: the history says it was automatic', JSON.parse(audits(a1.id, 'submission.apply')[0].detail || '{}').company_name === 'Acme Robotics Pvt Ltd' && audits(a1.id, 'submission.apply')[0].actor === 'automatic', audits(a1.id, 'submission.apply')[0]);
  r = await admin(`/api/admin/inbox-submissions/${a1.id}/undo`, { method: 'POST', body: { index: 0 } });
  check('switch on: an automatic one is undone like any other', r.status === 200 && exRow(ids.acme).logo_url === null);

  r = await push({ source_id: 'auto-sig', subject: 'Booth set-up timing', text: 'What time can we set up on the 19th?\n\nRegards,\nRavi', attachments: [file('image001.png', png(900, 250, 79), 'image/png')] });
  check('switch on: a wide picture in an email that never mentions a logo (a signature) waits', r.json.status === 'stored' && sub(r.json.id).kind === 'logo' && exRow(ids.acme).logo_url === null, r.text);
  r = await push({ source_id: 'auto-2', from_email: 'newperson@acmerobotics.in', subject: 'Logo', text: 'Logo attached.', attachments: [file('acme-logo-x.png', png(1100, 300, 72), 'image/png')] });
  check('switch on: a likely sender (same company email only) still waits', r.json.status === 'stored' && exRow(ids.acme).logo_url === null);
  r = await push({ source_id: 'auto-3', subject: 'Two logos', text: 'Both logos attached.', attachments: [file('acme-logo-dark.png', png(1200, 300, 73), 'image/png'), file('acme-logo-light.png', png(1200, 300, 74), 'image/png')] });
  check('switch on: two logos in one email wait for a person to choose', r.json.status === 'stored' && exRow(ids.acme).logo_url === null);
  r = await push({ source_id: 'auto-4', subject: 'Logo', text: 'Logo attached as PDF.', attachments: [file('acme-logo.pdf', png(10, 10, 75, 900), 'application/pdf')] });
  check('switch on: a PDF waits', r.json.status === 'stored' && exRow(ids.acme).logo_url === null);
  r = await push({ source_id: 'auto-5', from_email: 'neha.kapoor@bankofnorth.in', from_name: 'Neha Kapoor', subject: 'My photo', text: 'My photo attached.', attachments: [file('neha-portrait.jpg', jpeg(900, 1200, 76), 'image/jpeg')] });
  check('photos off: a speaker\'s own photo waits', r.json.status === 'stored' && rows('SELECT photo_url FROM speakers WHERE id = ?', [ids.speaker])[0].photo_url === null);
  await admin('/api/admin/inbox-submissions/settings', { method: 'PUT', body: { auto: { logo: true, photo: true } } });
  r = await push({ source_id: 'auto-6', from_email: 'neha.kapoor@bankofnorth.in', from_name: 'Neha Kapoor', subject: 'A better photo', text: 'Please use this photo.', attachments: [file('neha-portrait-2.jpg', jpeg(900, 1200, 77), 'image/jpeg')] });
  check('photos on: the speaker\'s own photo, from the address on file, is used on arrival', r.json.status === 'applied' && rows('SELECT photo_url FROM speakers WHERE id = ?', [ids.speaker])[0].photo_url === '/api/uploads/' + sub(r.json.id).attachments[0].key, r.text);
  r = await push({ source_id: 'auto-7', from_email: 'assistant@bankofnorth.in', subject: 'Photo of Neha Kapoor', text: 'Photo attached.', attachments: [file('neha-3.jpg', jpeg(900, 1200, 78), 'image/jpeg')] });
  check('photos on: from her office, not her own address, it waits', r.json.status === 'stored');
  const tl = await push({ source_id: 'auto-8', subject: 'Team', text: '1. Zed Person - Lead - zed@acmerobotics.in\n2. Yan Person - Lead - yan@acmerobotics.in' });
  check('a team list always waits, whatever the switches', tl.json.status === 'stored' && !rows("SELECT id FROM exhibitor_team WHERE email = 'zed@acmerobotics.in'").length);
  await admin('/api/admin/inbox-submissions/settings', { method: 'PUT', body: { auto: {} } });
  check('both off again', (await admin('/api/admin/inbox-submissions')).json.settings.auto.logo === false && rows("SELECT action FROM admin_audit WHERE action = 'submission.settings'").length === 3);
}

// ======== for the website script, and for AImailPilot ========
{
  const e = await admin('/api/admin/inbox-submissions/export');
  const files = e.json.files;
  check('export: every file in use, with its address and who it is for; undone ones left out', e.status === 200 && files.length >= 3 && files.every((f) => f.url && f.target && f.what) && files.some((f) => f.what === 'talk_photo' && f.talk_id === ids.talk) && !files.some((f) => f.exhibitor_id === ids.zenith), files.map((f) => [f.what, f.target]));
  check('export: for Admin only', (await W.call('/api/admin/inbox-submissions/export')).status === 401);

  check('senders: the secret is needed', (await W.call('/api/external/submission-senders')).status === 401 && (await W.call('/api/external/submission-senders', { admin: true })).status === 401);
  const s = (await W.call('/api/external/submission-senders?event_id=1', { headers: { Authorization: 'Bearer ' + SECRET } })).json;
  const has = (x) => s.emails.includes(x);
  check('senders: booth contacts, booth buyers, teams, talk speakers and confirmed speakers', has('ravi@acmerobotics.in') && has('accounts@acmerobotics.in') && has('meera@acmerobotics.in') && has('asha.rao@acmerobotics.in') && has('neha.kapoor@bankofnorth.in') && has('zenith.founder@gmail.com'), s.emails);
  check('senders: nobody taken off the list', !has('old@gone.in'));
  check('senders: company domains, and never a free-mail one', s.domains.includes('acmerobotics.in') && s.domains.includes('bankofnorth.in') && !s.domains.includes('gmail.com') && s.keywords.includes('bharat ai'), s.domains);
}

// ======== 13 Nov 2026: what the first day of real mail taught ========
{
  // Our own team: never filed, never on the sender list, whatever else they say.
  let r = await push({ source_id: 'own-1', from_email: 'puja@aegis.edu.in', from_name: 'Puja', subject: 'Bharat AI logo for the stage', text: 'Logo attached.', attachments: [file('bharat-ai-logo.png', png(900, 300, 120), 'image/png')] });
  check('own domain: an email from our own team is not filed', r.status === 200 && r.json.status === 'ignored' && r.json.reason === 'our own team' && !rows("SELECT id FROM inbox_submissions WHERE source_id = 'own-1'").length, r.text);
  W.insert('exhibitors', { event_id: 1, company_name: 'Aegis School of Data Science', contact_email: 'booth@aegis.edu.in' });
  let se = (await W.call('/api/external/submission-senders', { headers: { Authorization: 'Bearer ' + SECRET } })).json;
  check('own domain: never on the sender list, even as an exhibitor contact', !se.emails.includes('booth@aegis.edu.in') && !se.domains.includes('aegis.edu.in') && se.emails.includes('ravi@acmerobotics.in'), se.domains);
  W.db.run("INSERT INTO app_settings (key, value) VALUES ('inbox_submissions_own_domains', 'ownco.in, other-own.org')");
  r = await push({ source_id: 'own-2', from_email: 'staff@ownco.in', subject: 'Logo', text: 'logo', attachments: [file('x.png', png(700, 200, 121), 'image/png')] });
  const r2 = await push({ source_id: 'own-3', from_email: 'puja@aegis.edu.in', subject: 'Photos for Bharat AI', text: 'Photo attached.', attachments: [file('p.jpg', jpeg(800, 1000, 122), 'image/jpeg')] });
  check('own domain: the list can be set in Settings (app_settings), and then replaces the default', r.json.status === 'ignored' && r2.status === 201, [r.text, r2.text]);
  W.db.run("DELETE FROM app_settings WHERE key = 'inbox_submissions_own_domains'");

  // The same email in two team mailboxes.
  const at = '2026-11-13T05:41:54.000Z';
  const before = bucket.size;
  r = await push({ source_id: 'twin-a', from_email: 'neha.kapoor@bankofnorth.in', from_name: 'Neha Kapoor', subject: 'Attendee details - Bank of the North', text: '1. Asha Iyer - Analyst - asha@bankofnorth.in\n2. Ravi Menon - Lead - ravi.m@bankofnorth.in', received_at: at, attachments: [file('team.jpg', jpeg(600, 800, 123), 'image/jpeg')] });
  const r3 = await push({ source_id: 'twin-b', from_email: 'Neha.Kapoor@bankofnorth.in', from_name: 'Neha Kapoor', subject: 'Attendee details - Bank of the North', text: '1. Asha Iyer - Analyst - asha@bankofnorth.in\n2. Ravi Menon - Lead - ravi.m@bankofnorth.in', received_at: '2026-11-13T05:42:30.000Z', attachments: [file('team.jpg', jpeg(600, 800, 123), 'image/jpeg')] });
  check('twin: the same email from a second team mailbox is the first one, and no file is stored again', r.status === 201 && r3.status === 200 && r3.json.status === 'duplicate' && r3.json.id === r.json.id && bucket.size === before + 1 && !rows("SELECT id FROM inbox_submissions WHERE source_id = 'twin-b'").length, [r.text, r3.text]);
  const r4 = await push({ source_id: 'twin-c', from_email: 'neha.kapoor@bankofnorth.in', subject: 'Attendee details - Bank of the North', text: 'One more: 3. Kiran Shah - Designer - kiran@bankofnorth.in\n4. Om Rao - Lead - om@bankofnorth.in', received_at: '2026-11-13T06:10:00.000Z' });
  check('twin: the same subject half an hour later is a new email', r4.status === 201, r4.text);

  // A picture several companies send: a signature, or our own logo quoted back.
  const sig = png(248, 94, 124);
  r = await push({ source_id: 'sig-1', from_email: 'founder@first-co.com', subject: 'Re: Booth details for Bharat AI', text: 'Thanks, noted.', attachments: [file('image001.png', sig, 'image/png')] });
  check('shared picture: the first company that sends it is filed (nobody can know yet)', r.status === 201, r.text);
  r = await push({ source_id: 'sig-2', subject: 'Re: Bharat AI logo request', text: 'Our new logo attached.', attachments: [file('image001.png', sig, 'image/png'), file('acme-logo-2027.png', png(1200, 320, 125), 'image/png')] });
  const s2 = sub(r.json.id);
  check('shared picture: a second company sending it keeps only its own real file', r.status === 201 && s2.attachments.length === 1 && s2.attachments[0].filename === 'acme-logo-2027.png', s2?.attachments);
  r = await push({ source_id: 'sig-3', from_email: 'ops@third-co.in', subject: 'Re: Lunch for Bharat AI', text: 'Confirmed.', attachments: [file('image001.png', sig, 'image/png')] });
  check('shared picture: an email carrying only that picture is not filed', r.status === 200 && r.json.status === 'ignored', r.text);

  // An everyday word never names a company.
  W.insert('exhibitors', { event_id: 1, company_name: 'Image Infosystem', contact_email: 'hello@imageinfosystems.com' });
  r = await push({ source_id: 'img-1', from_email: 'pr@unrelated-agency.com', subject: 'Re: Speaker confirmation for Bharat AI', text: 'Please find the photo.', attachments: [file('image.png', jpeg(900, 1200, 126), 'image/jpeg')] });
  check('everyday words: a pasted picture called image.png does not suggest Image Infosystem', !sub(r.json.id).matches.exhibitors.some((e) => e.name === 'Image Infosystem'), sub(r.json.id).matches.exhibitors);
  r = await push({ source_id: 'img-2', from_email: 'pr@unrelated-agency.com', subject: 'Logo for Image Infosystem', text: 'On behalf of Image Infosystem, their logo.', attachments: [file('ii.png', png(800, 200, 127), 'image/png')] });
  check('everyday words: the company named in full is still found', sub(r.json.id).matches.exhibitors[0]?.name === 'Image Infosystem', sub(r.json.id).matches.exhibitors);
  check('everyday words: a one-word company is still found by its name', (await push({ source_id: 'img-3', from_email: 'x@agency-two.com', subject: 'Zenith logo', text: 'For Zenith, the logo.', attachments: [file('z.png', png(700, 210, 128), 'image/png')] })).json && sub(rows("SELECT id FROM inbox_submissions WHERE source_id = 'img-3'")[0].id).matches.exhibitors.some((e) => e.id === ids.zenith));
}

// ======== the tidy: what was already waiting gets the same rules ========
{
  const old = (o) => W.insert('inbox_submissions', { event_id: 1, source: 'aimailpilot', status: 'new', applied: '[]', matches: JSON.stringify({ exhibitors: [], talks: [], speakers: [], people: [] }), body: '', ...o });
  const f = (hash, name = 'image001.png', w = 248, h = 94) => ({ key: 'submissions/old/' + hash.slice(0, 6) + '-' + name, filename: name, mime: 'image/png', size: 4000, w, h, use: 'logo', hash });
  const H = (c) => c.repeat(64);
  const ownRow = old({ source_id: 't-own', from_email: 'staff@aegis.edu.in', subject: 'Re: Bharat AI', received_at: '2026-11-13T05:00:00.000Z', kind: 'logo', attachments: JSON.stringify([f(H('1'), 'real.png', 900, 300)]) });
  const twinA = old({ source_id: 't-twin-a', from_email: 'hr@rightangle.example', subject: 'Attendee Details - Rightangle', received_at: '2026-11-13T05:10:00.000Z', kind: 'team', attachments: '[]', matches: JSON.stringify({ exhibitors: [], talks: [], speakers: [], people: [{ first_name: 'Manoj', last_name: 'A', designation: 'CEO', email: 'm@rightangle.example', mobile: '', line: '' }] }) });
  const twinB = old({ source_id: 't-twin-b', from_email: 'hr@rightangle.example', subject: 'Attendee Details - Rightangle', received_at: '2026-11-13T05:10:40.000Z', kind: 'team', attachments: '[]', matches: JSON.stringify({ exhibitors: [], talks: [], speakers: [], people: [{ first_name: 'Manoj', last_name: 'A', designation: 'CEO', email: 'm@rightangle.example', mobile: '', line: '' }] }) });
  const sigOnly = old({ source_id: 't-sig', from_email: 'a@vendor-one.com', subject: 'Re: Quotation', received_at: '2026-11-13T05:20:00.000Z', kind: 'logo', attachments: JSON.stringify([f(H('2'))]) });
  const sigPlus = old({ source_id: 't-sigplus', from_email: 'b@vendor-two.com', subject: 'Re: Our logo for Bharat AI', received_at: '2026-11-13T05:21:00.000Z', kind: 'logo', attachments: JSON.stringify([f(H('2')), f(H('3'), 'vendor-two-logo.png', 1200, 300)]) });
  const wrong = old({ source_id: 't-wrong', from_email: 'pr@other-agency.com', subject: 'Re: Speaker photo', received_at: '2026-11-13T05:30:00.000Z', kind: 'photo', body: 'Photo attached.', attachments: JSON.stringify([f(H('4'), 'image.png', 900, 1200)]), matches: JSON.stringify({ exhibitors: [{ id: 999, name: 'Image Infosystem', detail: '', how: 'named in the email', sure: false }], talks: [], speakers: [], people: [] }) });
  const kept = old({ source_id: 't-kept', from_email: 'staff2@aegis.edu.in', subject: 'Brought back', received_at: '2026-11-13T05:40:00.000Z', kind: 'logo', attachments: '[]', decided_by: 'Priya' });
  const used = old({ source_id: 't-used', from_email: 'c@vendor-three.com', subject: 'Used one', received_at: '2026-11-13T05:50:00.000Z', kind: 'logo', attachments: JSON.stringify([f(H('2'))]), applied: JSON.stringify([{ what: 'logo', target: 'X', exhibitor_id: 1, file: 0, url: 'u', prev: '', at: 'now', by: 'Priya' }]) });
  check('tidy: for Admin only', (await W.call('/api/admin/inbox-submissions/tidy', { method: 'POST' })).status === 401);
  let r = await admin('/api/admin/inbox-submissions/tidy', { method: 'POST' });
  const st = (id) => sub(id);
  check('tidy: answers what it did, in words', r.status === 200 && r.json.ok && r.json.set_aside['our own team'] >= 1 && r.json.set_aside['the same email twice'] >= 1 && r.json.set_aside['only a picture other companies sent too'] >= 1 && r.json.pictures_removed >= 1, r.text);
  check('tidy: our own team set aside, saying why', st(ownRow).status === 'dismissed' && st(ownRow).decided_by === 'automatic tidy (our own team)', st(ownRow).decided_by);
  check('tidy: the second copy of one email set aside, naming the first', st(twinA).status === 'new' && st(twinB).status === 'dismissed' && st(twinB).decided_by === `automatic tidy (the same email in another mailbox, #${twinA})`, st(twinB).decided_by);
  check('tidy: an email with only a shared picture set aside', st(sigOnly).status === 'dismissed' && /only a picture other companies sent too/.test(st(sigOnly).decided_by));
  check('tidy: the shared picture taken off an email that has its own file too, which stays', st(sigPlus).status === 'new' && st(sigPlus).attachments.length === 1 && st(sigPlus).attachments[0].filename === 'vendor-two-logo.png', st(sigPlus).attachments);
  check('tidy: a wrong guess re-matched by today\'s rules', st(wrong).status === 'new' && !st(wrong).matches.exhibitors.some((e) => e.name === 'Image Infosystem'), st(wrong).matches.exhibitors);
  check('tidy: one a person brought back, and one something was used from, are left exactly as they were', st(kept).status === 'new' && st(kept).decided_by === 'Priya' && st(used).status === 'new' && st(used).attachments.length === 1);
  check('tidy: in the history', rows("SELECT id FROM admin_audit WHERE action = 'submission.tidy'").length >= 1);
  r = await admin('/api/admin/inbox-submissions/tidy', { method: 'POST' });
  check('tidy: running it again changes nothing', r.json.rematched === 0 && r.json.pictures_removed === 0 && Object.keys(r.json.set_aside).length === 0, r.text);
  // AImailPilot's ten-minute call runs it too.
  const late = old({ source_id: 't-late', from_email: 'new.staff@bharataiinnovation.com', subject: 'Late own', received_at: '2026-11-13T07:00:00.000Z', kind: 'logo', attachments: '[]' });
  await W.call('/api/external/submission-senders', { headers: { Authorization: 'Bearer ' + SECRET } });
  check('tidy: AImailPilot\'s sender-list call tidies what is waiting', st(late).status === 'dismissed', st(late).status);
  const back = await admin(`/api/admin/inbox-submissions/${late}/reopen`, { method: 'POST', body: {} });
  await W.call('/api/external/submission-senders', { headers: { Authorization: 'Bearer ' + SECRET } });
  check('tidy: Bring back is a person\'s decision, and the tidy leaves it alone after', back.json.row.status === 'new' && st(late).status === 'new' && st(late).decided_by === 'Priya', st(late));
}

// ======== a database without 0052 or 0050 ========
{
  const O = makeWorld({ talkContacts: false, teams: false });
  let r = await O.push({ source_id: 'o-1', from_email: 'someone@gmail.com', from_name: 'Asha', subject: 'Photo of Dr. Asha Rao', text: 'Photo for her talk.', attachments: [file('asha.jpg', jpeg(700, 900, 90), 'image/jpeg')] });
  const s = O.sub(r.json.id);
  check('before 0052: the talk is still found by the speaker\'s name', r.status === 201 && s.matches.talks[0]?.id === O.ids.talk && s.matches.talks[0].sure === false, s.matches);
  const se = (await O.call('/api/external/submission-senders', { headers: { Authorization: 'Bearer ' + SECRET } })).json;
  check('before 0052 and 0050: the sender list still answers with what is known', se.ok && se.emails.includes('ravi@acmerobotics.in') && se.emails.includes('neha.kapoor@bankofnorth.in'), se);
  const t = await O.push({ source_id: 'o-2', subject: 'Team', text: '1. Zed Person - Lead - zed@acmerobotics.in\n2. Yan Person - Lead - yan@acmerobotics.in' });
  r = await O.admin(`/api/admin/inbox-submissions/${t.json.id}/apply`, { method: 'POST', body: { what: 'team', exhibitor_id: O.ids.acme, people: O.sub(t.json.id).matches.people } });
  check('before 0050: adding people says teams are not set up, and adds nobody', r.status === 409 && /migration 0050/.test(r.json.error), r.text);
}

done();
