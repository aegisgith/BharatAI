// Integration: Admin -> Conference through the WHOLE built worker on real SQLite
// (conference-world.mjs), before and after migration 0054 (12 Nov 2026). Who may
// call it; speakers added, refused, edited, renamed, hidden, deleted; sessions with
// chosen speakers writing the line the app reads; clashes refused until "save anyway";
// drafts kept from attendees; halls renamed with their sessions; a speaker announced;
// their slot emailed; a photo stored; and the real agenda read the way the screen
// reads it. Run after `npm run build`:  node scripts/verify/smoke-conference.mjs
import { makeWorld } from './conference-world.mjs';

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 400))); if (!ok) fails++; };

// ================= before 0054 =================
{
  const W = await makeWorld();
  const conf = async () => (await W.call('GET', '/api/admin/events/1/conference')).json;

  const anon = await W.call('GET', '/api/admin/events/1/conference', undefined, { admin: false });
  check('nobody but an admin reads the conference', anon.status === 401 || anon.status === 403, anon.status);
  const anonSave = await W.call('POST', '/api/admin/speakers', { name: 'Mallory' }, { admin: false });
  check('nobody but an admin adds a speaker', (anonSave.status === 401 || anonSave.status === 403) && !W.rows("SELECT id FROM speakers WHERE name = 'Mallory'").length, anonSave.status);

  let d = await conf();
  check('before 0054: it loads and says the migration is still to run, with the command', d && d.ready && d.ready.all === false && /0054_conference_manager\.sql/.test(d.command), d && d.ready);
  check('before 0054: the four halls are there to choose from', d.halls.filter(h => !h.unlisted).map(h => h.name).join() === 'Homi J. Bhabha Hall,Kalam Theatre,Raman Theatre,Aryabhata Theatre', d.halls.map(h => h.name));
  check('the two days of the event, and nothing else', d.days.join() === '2026-11-20,2026-11-21', d.days);
  const panel = d.sessions.find(s => s.session_type === 'panel');
  check('a session made from SQL finds its speakers by name (Tarun Chugh panellist, Shailesh Dhuri moderator)', panel.links.map(l => l.speaker_id + ':' + l.role).join() === '2:panellist,3:moderator', panel.links);
  check('someone typed on it who is not a speaker is kept as typed', panel.others === 'Ratan Kumar Kesh (Bandhan Bank)', panel.others);
  check('"Shri K.K. Singh" in the agenda is "Shri. K.K. Singh" on the speakers list', d.sessions.find(s => s.title === 'Keynote').links[0]?.speaker_id === 1);
  const shailesh = d.speakers.find(s => s.id === 3);
  check('a speaker shows how many sessions they have, and the pass under their email', shailesh.slots === 1 && shailesh.pass && shailesh.pass.badge_type === 'Speaker', shailesh);
  check('hidden speakers are in Admin’s list, marked hidden', d.speakers.find(s => s.id === 5)?.is_published === 0);
  check('no clashes in this agenda', d.clashes.room.length === 0 && d.clashes.speaker.length === 0, d.clashes);
  const pub0 = await W.call('GET', '/api/events/1/sessions', undefined, { admin: false });
  check('before 0054: attendees get each session’s hall by its venue name too (Peacock Hall)', pub0.status === 200 && pub0.json.every(x => x.room !== 'Homi J. Bhabha Hall' || x.venue_room === 'Peacock Hall') && pub0.json.some(x => x.venue_room === 'Peacock Hall'), pub0.json.map(x => x.room + '/' + x.venue_room));

  // ---- speakers: what is refused, in plain words ----
  const bad = async (body, words, code = 400) => { const r = await W.call('POST', '/api/admin/speakers', body); check(`refused: ${words}`, r.status === code && String(r.json?.error || '').toLowerCase().includes(words.toLowerCase()), r); };
  await bad({ name: '   ' }, 'name');
  await bad({ name: 'Asha Rao', email: 'asha@' }, 'email address');
  await bad({ name: 'Asha Rao', linkedin_url: 'https://evil.example/in/asha' }, 'linkedin');
  await bad({ name: 'Asha Rao', phone: '12345' }, '10 digits');
  await bad({ name: 'Asha Rao', photo_url: 'javascript:alert(1)' }, 'photo');
  await bad({ name: 'Asha Rao', email: 'KK@example.test' }, 'already on', 409);
  let r = await W.call('POST', '/api/admin/speakers', { name: 'Dr. Asha Rao', role: 'Chief Data Officer', organisation: 'Tata Capital', email: 'Asha@Example.test', phone: '+91 98200 11111', linkedin_url: 'https://www.linkedin.com/in/asha' });
  check('a speaker is added with every detail', r.status === 201 && r.json.slug === 'asha-rao', r);
  const asha = r.json.id;
  const row = W.rows('SELECT * FROM speakers WHERE id = ?', [asha])[0];
  check('their email is kept in lower case, the mobile as digits, shown to attendees, last in the list', row.email === 'asha@example.test' && row.phone === '+919820011111' && row.is_published === 1 && row.sort_order === 6, row);
  r = await W.call('POST', '/api/admin/speakers', { name: 'dr. asha rao' });
  check('the same name again is questioned, not added', r.status === 409 && r.json.same_name === true && r.json.speaker_id === asha, r);
  r = await W.call('POST', '/api/admin/speakers', { name: 'Dr. Asha Rao', allow_same_name: true });
  check('a second person with that name can be added on purpose, with their own slug', r.status === 201 && r.json.slug === 'asha-rao-2', r);
  const asha2 = r.json.id;
  check('each add is in the audit log', W.rows("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'speaker.create'")[0].n === 2);

  // ---- sessions before 0054 ----
  r = await W.call('POST', '/api/admin/sessions', { event_id: 1, title: 'Held slot', session_type: 'talk', room: 'Kalam Theatre', start_time: '2026-11-20 16:00', end_time: '2026-11-20 16:10', status: 'draft' });
  check('before 0054: a draft is refused with the command, nothing saved', r.status === 409 && r.json.needs_migration && !W.rows("SELECT id FROM sessions WHERE title = 'Held slot'").length, r);
  const badS = async (body, words) => { const x = await W.call('POST', '/api/admin/sessions', { event_id: 1, session_type: 'talk', room: 'Kalam Theatre', title: 'T', start_time: '2026-11-20 16:00', end_time: '2026-11-20 16:10', ...body }); check(`session refused: ${words}`, x.status === 400 && String(x.json?.error || '').toLowerCase().includes(words.toLowerCase()), x); };
  await badS({ title: ' ' }, 'title');
  await badS({ end_time: '2026-11-20 15:50' }, 'end after it starts');
  await badS({ end_time: '2026-11-21 10:00' }, 'same day');
  await badS({ start_time: 'soon' }, 'start time');
  r = await W.call('POST', '/api/admin/sessions', { event_id: 1, title: 'x', session_type: 'talk', room: 'Kalam Theatre', start_time: '2026-11-20 16:00', end_time: '2026-11-20 16:10', speakers: [{ speaker_id: 999 }] });
  check('a speaker who is not on the list is refused', r.status === 400 && /not on the speakers list/.test(r.json.error), r);

  r = await W.call('POST', '/api/admin/sessions', { event_id: 1, title: 'AI for Lending', session_type: 'panel', room: 'Aryabhata Theatre', start_time: '2026-11-20 12:00', end_time: '2026-11-20 12:45',
    speakers: [{ speaker_id: asha, role: 'panellist' }, { speaker_id: 2, role: 'panellist' }, { speaker_id: 3, role: 'moderator' }], others: 'Guest Panellist (NPCI)' });
  check('before 0054: a session with chosen speakers is saved', r.status === 201, r);
  const lend = r.json.id;
  let s = W.rows('SELECT * FROM sessions WHERE id = ?', [lend])[0];
  check('...and the line the app reads is written from them, typed guest kept', s.speaker_name === 'Dr. Asha Rao (Tata Capital), Tarun Chugh (Bajaj Life Insurance), Shailesh Dhuri (Moderator), Guest Panellist (NPCI)', s.speaker_name);

  // ---- clashes ----
  r = await W.call('POST', '/api/admin/sessions', { event_id: 1, title: 'Overlap', session_type: 'talk', room: 'Homi J. Bhabha Hall', start_time: '2026-11-20 14:30', end_time: '2026-11-20 14:40' });
  check('a second session in a busy hall is refused, naming what is there', r.status === 409 && r.json.clashes[0].kind === 'hall' && /AI Democratizing/.test(r.json.clashes[0].what), r);
  check('...and nothing was saved', !W.rows("SELECT id FROM sessions WHERE title = 'Overlap'").length);
  r = await W.call('POST', '/api/admin/sessions', { event_id: 1, title: 'Elsewhere', session_type: 'talk', room: 'Raman Theatre', start_time: '2026-11-20 14:15', end_time: '2026-11-20 14:30', speakers: [{ speaker_id: 3 }] });
  check('a speaker booked in two halls at once is refused, naming the other session', r.status === 409 && r.json.clashes.some(c => c.kind === 'speaker' && /Shailesh Dhuri/.test(c.what)), r);
  r = await W.call('POST', '/api/admin/sessions', { event_id: 1, title: 'Overlap', session_type: 'talk', room: 'Homi J. Bhabha Hall', start_time: '2026-11-20 14:30', end_time: '2026-11-20 14:40', force: true });
  check('"Save anyway" saves it and says what it clashes with', r.status === 201 && r.json.clashes.length === 1, r);
  const overlap = r.json.id;
  check('the clash shows on the programme afterwards', (await conf()).clashes.room.length === 1);
  r = await W.call('PUT', '/api/admin/sessions/' + overlap, { title: 'Overlap', session_type: 'talk', room: 'Kalam Theatre', start_time: '2026-11-20 14:30', end_time: '2026-11-20 14:40' });
  check('moving it to a free hall clears the clash', r.status === 200 && (await conf()).clashes.room.length === 0, r);

  r = await W.call('POST', '/api/admin/halls', { event_id: 1, name: 'Board Room' });
  check('before 0054: a new hall waits for the migration', r.status === 409 && r.json.needs_migration, r);

  // Remove the second Asha for the next part.
  r = await W.call('DELETE', '/api/admin/speakers/' + asha2);
  check('a speaker with no sessions is deleted', r.status === 200 && !W.rows('SELECT id FROM speakers WHERE id = ?', [asha2]).length);

  // ================= 0054 runs =================
  W.applyMigration();
  let again = true; try { W.applyMigration(); } catch { again = false; }
  check('0054 can run twice without an error', again);
  d = await conf();
  check('after 0054: ready, with the halls from the table (venue rooms and all)', d.ready.all === true && d.halls.find(h => h.name === 'Homi J. Bhabha Hall')?.venue_room === 'Peacock Hall' && d.halls.find(h => h.name === 'Homi J. Bhabha Hall').id > 0, d.ready);
  check('after 0054: sessions saved before it still find their speakers by name', d.sessions.find(x => x.id === lend).links.length === 3);

  // ---- saved links, drafts, notes ----
  r = await W.call('PUT', '/api/admin/sessions/' + lend, { title: 'AI for Lending', session_type: 'panel', room: 'Aryabhata Theatre', start_time: '2026-11-20 12:00', end_time: '2026-11-20 12:45',
    speakers: [{ speaker_id: 3, role: 'moderator' }, { speaker_id: asha, role: 'panellist' }], others: '', status: 'draft', note: 'Tarun to confirm' });
  check('after 0054: a session is saved as a draft with a team note', r.status === 200, r);
  const links = W.rows('SELECT speaker_id, role, sort_order FROM session_speakers WHERE session_id = ? ORDER BY sort_order', [lend]);
  check('its speakers are saved as links, in the order chosen', links.map(l => l.speaker_id + ':' + l.role).join() === '3:moderator,' + asha + ':panellist', links);
  s = W.rows('SELECT speaker_name FROM sessions WHERE id = ?', [lend])[0];
  check('the line is rewritten in that order, and the typed guest removed as asked', s.speaker_name === 'Shailesh Dhuri (Moderator), Dr. Asha Rao (Tata Capital)', s.speaker_name);
  const pub = await W.call('GET', '/api/events/1/sessions', undefined, { admin: false });
  check('attendees do not see a draft', pub.status === 200 && !pub.json.some(x => x.id === lend) && pub.json.length === 5, pub.json.map(x => x.title));
  d = await conf();
  check('after 0054: the venue name comes from the halls table', pub.json.find(x => x.room === 'Aryabhata Theatre')?.venue_room === 'Expo Hall', pub.json.map(x => x.room + '/' + x.venue_room));
  check('Admin sees the draft, with its note', d.sessions.find(x => x.id === lend).status === 'draft' && d.sessions.find(x => x.id === lend).note === 'Tarun to confirm');
  const spkPub = await W.call('GET', '/api/events/1/speakers');
  const ashaPub = spkPub.json.find(x => x.id === asha);
  check('a speaker whose only session is a draft shows no slot to attendees', ashaPub && ashaPub.sessions.length === 0, ashaPub);
  await W.call('PUT', '/api/admin/sessions/' + lend, { title: 'AI for Lending', session_type: 'panel', room: 'Aryabhata Theatre', start_time: '2026-11-20 12:00', end_time: '2026-11-20 12:45', speakers: [{ speaker_id: 3, role: 'moderator' }, { speaker_id: asha, role: 'panellist' }], status: 'published' });
  const ashaPub2 = (await W.call('GET', '/api/events/1/speakers')).json.find(x => x.id === asha);
  check('published: the speaker’s profile in the app says when and where, with the venue room', ashaPub2.sessions.length === 1 && ashaPub2.sessions[0].room === 'Aryabhata Theatre' && ashaPub2.sessions[0].venue_room === 'Expo Hall' && ashaPub2.sessions[0].role === 'panellist' && ashaPub2.sessions[0].start_time === '2026-11-20 12:00', ashaPub2.sessions);
  check('the attendee list never carries a speaker’s email or mobile', !JSON.stringify(spkPub.json).includes('asha@example.test') && !JSON.stringify(spkPub.json).includes('9820011111'));
  check('a hidden speaker is not in the attendee list', !spkPub.json.some(x => x.id === 5));

  // ---- renaming and changing a speaker rewrites their sessions ----
  r = await W.call('PUT', '/api/admin/speakers/3', { name: 'Shailesh Dhuri (PhD)', organisation: 'Decimal Point Analytics Pvt Ltd' });
  check('a speaker is renamed', r.status === 200, r);
  s = W.rows("SELECT speaker_name FROM sessions WHERE title = 'AI Democratizing and Driving Financial Inclusion'")[0];
  check('a session that found them by name gets the new name, and not the old one too', s.speaker_name === 'Tarun Chugh (Bajaj Life Insurance), Shailesh Dhuri (Moderator), Ratan Kumar Kesh (Bandhan Bank)' && (s.speaker_name.match(/Shailesh/g) || []).length === 1, s.speaker_name);
  check('...and still finds them', (await conf()).sessions.find(x => x.title.startsWith('AI Democratizing')).links.some(l => l.speaker_id === 3));
  r = await W.call('PUT', '/api/admin/speakers/' + asha, { organisation: 'Tata Capital Ltd' });
  s = W.rows('SELECT speaker_name FROM sessions WHERE id = ?', [lend])[0];
  check('a changed organisation reaches the line of a session with saved links', s.speaker_name === 'Shailesh Dhuri (Moderator), Dr. Asha Rao (Tata Capital Ltd)', s.speaker_name);
  r = await W.call('PUT', '/api/admin/speakers/2', { email: 'kk@example.test' });
  check('an email already on another speaker is refused on edit', r.status === 409, r);

  // ---- hide, then delete ----
  r = await W.call('PUT', '/api/admin/speakers/2', { is_published: 0 });
  check('hiding keeps the speaker and their sessions', r.status === 200 && W.rows('SELECT is_published FROM speakers WHERE id = 2')[0].is_published === 0 && /Tarun Chugh/.test(W.rows("SELECT speaker_name FROM sessions WHERE title LIKE 'AI Democratizing%'")[0].speaker_name));
  r = await W.call('DELETE', '/api/admin/speakers/2');
  s = W.rows("SELECT speaker_name FROM sessions WHERE title LIKE 'AI Democratizing%'")[0];
  check('deleting a speaker takes them off their sessions and leaves everyone else', r.status === 200 && s.speaker_name === 'Shailesh Dhuri (Moderator), Ratan Kumar Kesh (Bandhan Bank)', s.speaker_name);

  // ---- halls ----
  r = await W.call('POST', '/api/admin/halls', { event_id: 1, name: 'Board Room', venue_room: 'Level 2, Room 4', capacity: '40', location: 'Take the lift to Level 2' });
  check('after 0054: a hall is added', r.status === 201, r);
  const board = r.json.id;
  r = await W.call('POST', '/api/admin/halls', { event_id: 1, name: 'Board Room' });
  check('two halls with one name are refused', r.status === 409, r);
  const kalam = (await conf()).halls.find(h => h.name === 'Kalam Theatre');
  r = await W.call('PUT', '/api/admin/halls/' + kalam.id, { name: 'Kalam Stage' });
  check('renaming a hall moves its sessions with it', r.status === 200 && r.json.sessions_moved === 1 && W.rows("SELECT room FROM sessions WHERE id = ?", [overlap])[0].room === 'Kalam Stage', r);
  const moved = (await W.call('GET', '/api/events/1/sessions', undefined, { admin: false })).json.find(x => x.id === overlap);
  check('a renamed hall keeps its venue name for attendees', moved && moved.room === 'Kalam Stage' && moved.venue_room === 'Centrum Hall A', moved);
  r = await W.call('DELETE', '/api/admin/halls/' + kalam.id);
  check('a hall with sessions cannot be deleted', r.status === 409 && /Move them/.test(r.json.error), r);
  r = await W.call('DELETE', '/api/admin/halls/' + board);
  check('an empty hall can', r.status === 200 && !W.rows('SELECT id FROM conference_halls WHERE id = ?', [board]).length);

  // ---- announcing ----
  r = await W.call('POST', '/api/admin/speakers/' + asha + '/announce', { title: '', content: 'x' });
  check('an announcement needs a headline', r.status === 400, r);
  r = await W.call('POST', '/api/admin/speakers/' + asha + '/announce', { title: 'Dr. Asha Rao speaks on Fri 20 Nov', content: 'Dr. Asha Rao joins the panel.', session_id: lend, pinned: true });
  check('a speaker is announced', r.status === 201 && r.json.logged === true, r);
  const ann = W.rows('SELECT * FROM announcements WHERE id = ?', [r.json.announcement_id])[0];
  check('...as an announcement in the app, pinned', ann && ann.title === 'Dr. Asha Rao speaks on Fri 20 Nov' && ann.pinned === 1 && ann.announcement_type === 'general', ann);
  const feed = await W.call('GET', '/api/events/1/announcements', undefined, { admin: false });
  check('...that attendees get in their announcements', feed.json.some(a => a.id === ann.id));
  d = await conf();
  check('the speaker now shows as announced, and the log says who', d.speakers.find(x => x.id === asha).announced?.n === 1 && W.rows('SELECT created_by FROM speaker_announcements')[0].created_by === 'Harness', d.speakers.find(x => x.id === asha).announced);

  // ---- the slot email ----
  r = await W.call('POST', '/api/admin/speakers/4/slot-email', { preview: true, note: 'Come early.' });
  check('the preview is the email: subject with day, time and hall', r.status === 200 && r.json.subject === 'Your session at Bharat AI Innovation 2026: Saturday 21 November, 11:00 am, Aryabhata Theatre' && r.json.html.includes('Aryabhata Theatre · Expo Hall') && r.json.html.includes('Come early.'), r.json?.subject);
  r = await W.call('POST', '/api/admin/speakers/4/slot-email', { note: '' });
  check('with no email on file it is not sent, and says why', r.status === 409 && /no email address/i.test(r.json.error) && W.sent.length === 0, r);
  r = await W.call('POST', '/api/admin/speakers/' + asha + '/slot-email', { note: 'Please reach 30 minutes early.' });
  check('it is sent to the speaker’s address, once', r.status === 200 && W.sent.length === 1 && JSON.stringify(W.sent[0]).includes('asha@example.test'), W.sent);
  check('the email sent names the session and the hall', JSON.stringify(W.sent[0]).includes('AI for Lending') && JSON.stringify(W.sent[0]).includes('Aryabhata Theatre'));
  const loner = (await W.call('POST', '/api/admin/speakers', { name: 'No Slot Person', email: 'ns@example.test' })).json.id;
  r = await W.call('POST', '/api/admin/speakers/' + loner + '/slot-email', { preview: true });
  check('someone with no session gets no slot email', r.status === 409 && /not on the programme/.test(r.json.error), r);

  // ---- photos ----
  const jpeg = 'data:image/jpeg;base64,' + Buffer.alloc(4000, 7).toString('base64');
  r = await W.call('POST', '/api/admin/speakers/' + asha + '/photo', { image: jpeg });
  const url = r.json?.photo_url || '';
  check('a photo is stored and the speaker points at it', r.status === 200 && /^\/api\/uploads\/speakers\/\d+-\d+\.jpg$/.test(url) && W.rows('SELECT photo_url FROM speakers WHERE id = ?', [asha])[0].photo_url === url, r);
  const got = await W.call('GET', url, undefined, { admin: false });
  check('...and anyone can load it, as with every speaker photo', got.status === 200);
  r = await W.call('POST', '/api/admin/speakers/' + asha + '/photo', { image: jpeg });
  check('a new photo replaces the old file instead of leaving it behind', r.status === 200 && W.bucket.size === 1, [...W.bucket.keys()]);
  r = await W.call('POST', '/api/admin/speakers/' + asha + '/photo', { image: 'data:text/html;base64,PHNjcmlwdD4=' });
  check('only a photo is accepted', r.status === 400, r);

  // ---- order, and the session delete ----
  r = await W.call('POST', '/api/admin/speakers/reorder', { ids: [asha, 3, 1] });
  check('the list order is saved as dragged', r.status === 200 && W.rows('SELECT sort_order FROM speakers WHERE id = ?', [asha])[0].sort_order === 1);
  r = await W.call('DELETE', '/api/admin/sessions/' + lend);
  check('deleting a session takes its links and its draft row too', r.status === 200 && !W.rows('SELECT 1 FROM session_speakers WHERE session_id = ?', [lend]).length && !W.rows('SELECT 1 FROM session_admin WHERE session_id = ?', [lend]).length);
  r = await W.call('POST', '/api/admin/events/1/conference/link-speakers');
  check('the name matches can be saved as links in one go', r.status === 200 && r.json.made >= 2, r.json);
  const audit = W.rows('SELECT DISTINCT action FROM admin_audit').map(x => x.action);
  check('every kind of change is in the audit log', ['speaker.create', 'speaker.update', 'speaker.delete', 'session.create', 'session.update', 'session.delete', 'hall.create', 'hall.update', 'hall.delete', 'speaker.announce', 'speaker.slot_email', 'speaker.photo', 'speaker.reorder'].every(a => audit.includes(a)), audit);
}

// ================= the real agenda and line-up =================
{
  const W = await makeWorld({ seed: 'real', migrated: true });
  const d = (await W.call('GET', '/api/admin/events/1/conference')).json;
  const timed = d.sessions.length;
  const withSpeakers = d.sessions.filter(s => s.speaker_name).length;
  const linked = d.sessions.filter(s => s.links.length).length;
  console.log(`  real agenda: ${timed} sessions, ${withSpeakers} name someone, ${linked} matched to the speakers list; ${d.speakers.length} speakers (0033 only), ${d.speakers.filter(s => s.slots).length} on the programme`);
  check('the real agenda loads in Admin', timed > 50 && d.ready.all, timed);
  check('the real keynotes find their speakers (K.K. Singh, Pardeshi, Patil)', ['k-k-singh', 'praveen-pardeshi', 'shrikant-patil'].every(slug => { const sp = d.speakers.find(x => x.slug === slug); return sp && sp.slots >= 1; }), d.speakers.filter(s => s.slots).map(s => s.slug));
  check('every session sits in one of the four halls', d.halls.filter(h => h.unlisted).length === 0, d.halls.filter(h => h.unlisted).map(h => h.name));
  console.log('  real agenda clashes: ' + d.clashes.room.length + ' hall, ' + d.clashes.speaker.length + ' speaker' +
    d.clashes.room.slice(0, 5).map(c => '\n    hall ' + c.room + ': ' + c.a.title + ' / ' + c.b.title + ' at ' + c.a.start_time).join('') +
    d.clashes.speaker.slice(0, 5).map(c => '\n    speaker ' + c.speaker + ': ' + c.a.title + ' / ' + c.b.title + ' at ' + c.a.start_time).join(''));
  const pub = await W.call('GET', '/api/events/1/sessions', undefined, { admin: false });
  check('with no drafts, attendees see every session', pub.json.length === timed);
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
