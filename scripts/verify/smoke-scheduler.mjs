// Integration: the scheduler in Admin -> Conference (12 Nov 2026) on the WHOLE built
// worker and real SQLite (conference-world.mjs, migration 0054 applied):
//  - the one read now carries what needs attention, free time, the Innovation Talks
//    still to place, the events, and the event's own words;
//  - moving a session (drag and drop): only its time and hall change, the clash rule
//    and "anyway", every refusal;
//  - a session that is an Innovation Talk keeps the talks list in step;
//  - find a free slot;
//  - a second event: Delhi started once, its programme copied from Mumbai as drafts,
//    its own words in a speaker's email, nothing of it public;
//  - a speaker with email and mobile from one call, and their Speaker pass: made,
//    raised from a Visitor Pass, a paid pass kept, a held mobile left off.
// Run after `npm run build`:  node scripts/verify/smoke-scheduler.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeWorld, ROOT } from './conference-world.mjs';

let fails = 0, passes = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 400))); if (ok) passes++; else fails++; };
const BH = 'Homi J. Bhabha Hall', KA = 'Kalam Theatre', RA = 'Raman Theatre', AR = 'Aryabhata Theatre';
const D1 = '2026-11-20', D2 = '2026-11-21';
const world = async () => {
  const W = await makeWorld({ migrated: true });
  W.db.exec(readFileSync(join(ROOT, 'migrations', '0052_innovation_talk_details.sql'), 'utf8'));
  W.read = async (id = 1) => (await W.call('GET', '/api/admin/events/' + id + '/conference')).json;
  W.ses = (title) => W.rows('SELECT * FROM sessions WHERE title = ?', [title])[0];
  return W;
};

// ================= the one read =================
{
  const W = await world();
  const d = await W.read();
  check('the read carries the scheduler: issues, free time, windows, talks, events, words', Array.isArray(d.issues) && Array.isArray(d.free) && d.windows && d.talks && Array.isArray(d.events) && d.words && Array.isArray(d.event_days), Object.keys(d));
  check("the event's days are its own two", d.event_days.join() === D1 + ',' + D2);
  check('the words are Mumbai\'s', d.words.line === '20-21 November 2026 · World Trade Center, Mumbai');
  check('one event listed, with its number of sessions', d.events.length === 1 && Number(d.events[0].sessions) === 4, d.events);
  const kinds = d.issues.map(i => i.kind);
  check('the keynote titled only "Keynote" is noted as having no topic', d.issues.some(i => i.kind === 'no-topic' && /Keynote/.test(i.what)), kinds);
  check('the panellist typed by hand is noted', d.issues.some(i => i.kind === 'typed-people' && /Ratan Kumar Kesh/.test(i.what)));
  check('speakers on the programme with no photo are a "check"', d.issues.filter(i => i.kind === 'speaker-missing' && i.level === 'warn').length === 4, d.issues.filter(i => i.group === 'speaker').map(i => i.what));
  check('the hidden speaker with no session raises nothing', !d.issues.some(i => /Nilesh Shah/.test(i.what)));
  check('the free two hours in Bhabha Hall before lunch are found', d.free.some(f => f.day === D1 && f.hall === BH && f.start === '11:00' && f.end === '13:00' && f.minutes === 120) && d.issues.some(i => i.kind === 'free' && i.hall === BH && i.start === '11:00'), d.free.filter(f => f.hall === BH));
  check('a hall with nothing that day is one line', d.issues.filter(i => i.kind === 'empty-hall' && i.day === D1 && i.hall === KA).length === 1);
  check('nothing "cannot run" in the seed', !d.issues.some(i => i.level === 'bad'));
  check('the worst first: no note comes before a check', d.issues.findIndex(i => i.level === 'info') > d.issues.map(i => i.level).lastIndexOf('warn'));
  check('no password: the read is refused', (await W.call('GET', '/api/admin/events/1/conference', undefined, { admin: false })).status === 401);
  // The screen's file must be on the page before the admin page's own script runs: loaded
  // after it, a slow phone opened the old Sessions table instead (found 12 Nov 2026).
  const shell = (await W.call('GET', '/admin')).text;
  const mine = shell.indexOf('<script src="/static/conference-admin.js'), admin = shell.indexOf('<script src="/admin.js');
  check("the Conference screen's file loads before the admin page's own script", mine > 0 && admin > mine, [mine, admin]);
}

// ================= moving a session =================
{
  const W = await world();
  const key = W.ses('Keynote'), lunch = W.ses('Networking Lunch'), panel = W.ses('AI Democratizing and Driving Financial Inclusion');
  let r = await W.call('POST', '/api/admin/sessions/' + key.id + '/move', { start_time: D1 + ' 11:30', end_time: D1 + ' 11:45' });
  let now = W.ses('Keynote');
  check('a move saves the new time and answers with where it was', r.status === 200 && r.json.success && now.start_time === D1 + ' 11:30' && now.end_time === D1 + ' 11:45' && r.json.before.start_time === D1 + ' 10:50' && r.json.before.room === BH, r.json);
  check('only the time moved: the hall, title and speaker line are as they were', now.room === BH && now.title === 'Keynote' && now.speaker_name === key.speaker_name && now.speaker_title === key.speaker_title && now.session_type === 'keynote');
  r = await W.call('POST', '/api/admin/sessions/' + key.id + '/move', { start_time: D1 + ' 11:30', end_time: D1 + ' 11:45', room: KA });
  check('a move to another hall changes the hall', r.status === 200 && W.ses('Keynote').room === KA);
  r = await W.call('POST', '/api/admin/sessions/' + key.id + '/move', { start_time: D1 + ' 11:30', end_time: D1 + ' 11:45', room: '' });
  check('a move to "no hall yet" empties it', r.status === 200 && W.ses('Keynote').room === '');
  for (const [body, re] of [[{ start_time: D1 + ' 11:30' }, /start time and the end time/], [{ start_time: 'x', end_time: 'y' }, /start time and the end time/],
    [{ start_time: D1 + ' 12:00', end_time: D1 + ' 11:00' }, /end after it starts/], [{ start_time: D1 + ' 23:00', end_time: D2 + ' 00:30' }, /same day/]]) {
    r = await W.call('POST', '/api/admin/sessions/' + key.id + '/move', body);
    check('refused with a sentence: ' + JSON.stringify(body).slice(0, 70), r.status === 400 && re.test(r.json?.error || ''), r.json);
  }
  check('nothing refused moved it', W.ses('Keynote').start_time === D1 + ' 11:30');
  r = await W.call('POST', '/api/admin/sessions/999999/move', { start_time: D1 + ' 10:00', end_time: D1 + ' 10:30' });
  check('a session that is gone: 404 with a sentence', r.status === 404 && /not on the programme/.test(r.json.error));
  r = await W.call('POST', '/api/admin/sessions/' + key.id + '/move', { start_time: D1 + ' 10:00', end_time: D1 + ' 10:30' }, { admin: false });
  check('no password: a move is refused and nothing moves', r.status === 401 && W.ses('Keynote').start_time === D1 + ' 11:30');
  // the clash rule
  r = await W.call('POST', '/api/admin/sessions/' + key.id + '/move', { start_time: D1 + ' 13:10', end_time: D1 + ' 13:20', room: BH });
  check('onto another session in the same hall: 409, naming it, and nothing moves', r.status === 409 && r.json.clashes.length === 1 && r.json.clashes[0].kind === 'hall' && /Networking Lunch/.test(r.json.clashes[0].what) && W.ses('Keynote').start_time === D1 + ' 11:30', r.json);
  r = await W.call('POST', '/api/admin/sessions/' + key.id + '/move', { start_time: D1 + ' 13:10', end_time: D1 + ' 13:20', room: BH, force: true });
  check('"anyway" moves it', r.status === 200 && W.ses('Keynote').start_time === D1 + ' 13:10' && r.json.clashes.length === 1);
  let d = await W.read();
  check('and the attention list now says it cannot run, with both sessions', d.issues.some(i => i.kind === 'hall-clash' && i.level === 'bad' && [i.session_id, i.other_id].sort().join() === [key.id, lunch.id].sort().join()), d.issues.filter(i => i.level === 'bad'));
  check('the bad one is first on the list', d.issues[0].level === 'bad');
  // one person, two places
  const mk = await W.call('POST', '/api/admin/sessions', { event_id: 1, title: 'Second talk by the Joint Secretary', session_type: 'talk', room: RA, start_time: D1 + ' 16:00', end_time: D1 + ' 16:30', speakers: [{ speaker_id: 1, role: 'speaker' }] });
  r = await W.call('POST', '/api/admin/sessions/' + key.id + '/move', { start_time: D1 + ' 16:10', end_time: D1 + ' 16:20', room: KA });
  check('a move that puts its speaker in two places: 409 naming the speaker', mk.status === 201 && r.status === 409 && r.json.clashes.some(c => c.kind === 'speaker' && /K\.K\. Singh/.test(c.what)), r.json);
  r = await W.call('POST', '/api/admin/sessions/' + key.id + '/move', { start_time: D1 + ' 16:35', end_time: D1 + ' 16:45', room: KA });
  d = await W.read();
  check('five minutes to cross from Raman to Kalam is on the list as a "check"', r.status === 200 && d.issues.some(i => i.kind === 'tight-move' && /only 5 minutes/.test(i.what)), d.issues.filter(i => i.group === 'clash'));
  const audit = W.rows("SELECT * FROM admin_audit WHERE action = 'session.move'");
  check('every move is in the audit log with from and to', audit.length >= 5 && /"from"/.test(audit[0].detail) && /"to"/.test(audit[0].detail), audit.length);
  check('the panel was never touched', JSON.stringify(W.ses(panel.title)) === JSON.stringify(panel));
}

// ================= a session that is an Innovation Talk =================
{
  const W = await world();
  W.db.run("INSERT INTO innovation_talks (id, event_id, company, speaker_name, speaker_title, topic, status, time_slot) VALUES (71, 1, 'Sync Co Pvt Ltd', 'Syd Barrett', 'CEO', 'On time', 'confirmed', 'To be announced')");
  W.db.run("INSERT INTO innovation_talks (id, event_id, company, speaker_name, topic, status, time_slot) VALUES (72, 1, 'Later Labs', 'Lata', 'Soon', 'confirmed', 'To be announced')");
  W.db.run("INSERT INTO innovation_talks (id, event_id, company, speaker_name, topic, status, time_slot) VALUES (73, 1, 'Gone Co', 'G', 'x', 'cancelled', 'To be announced')");
  let d = await W.read();
  check('talks with no session are waiting to be placed (a cancelled one is not)', d.talks.total === 3 && d.talks.on_programme === 0 && d.talks.unplaced.map(t => t.id).join() === '71,72' && d.issues.some(i => i.kind === 'talks-unplaced' && /^2 Innovation Talks/.test(i.what)), d.talks);
  let r = await W.call('POST', '/api/admin/sessions', { event_id: 1, title: 'Innovation Talk: Sync Co', session_type: 'talk', room: AR, start_time: D1 + ' 16:00', end_time: D1 + ' 16:08', speakers: [], others: 'Syd Barrett', speaker_title: 'CEO, Sync Co' });
  let t = W.rows('SELECT * FROM innovation_talks WHERE id = 71')[0];
  check('placing it on the programme writes the time and hall on the talks list, in its own words', r.status === 201 && JSON.stringify(r.json.talk_synced) === '[71]' && t.starts_at === D1 + ' 16:00' && t.duration_min === 8 && t.time_slot === 'Fri 20 Nov · 4:00 – 4:08 PM' && t.session_type === 'Afternoon' && t.hall === AR, t);
  const sid = r.json.id;
  let row = W.rows('SELECT * FROM sessions WHERE id = ?', [sid])[0];
  check("the session shows the speaker's name with the line under it", row.speaker_name === 'Syd Barrett' && row.speaker_title === 'CEO, Sync Co', [row.speaker_name, row.speaker_title]);
  d = await W.read();
  const mine = d.sessions.find(s => s.id === sid);
  check('the read ties the session to its talk, and stops calling it unplaced', mine.talks && mine.talks[0].id === 71 && mine.talks[0].speaker_name === 'Syd Barrett' && d.talks.on_programme === 1 && d.talks.unplaced.map(t => t.id).join() === '72');
  check('a talk in step with the programme raises nothing; its speaker is not "typed by hand"', !d.issues.some(i => i.talk_id === 71) && !d.issues.some(i => i.kind === 'typed-people' && i.session_id === sid));
  r = await W.call('POST', '/api/admin/sessions/' + sid + '/move', { start_time: D1 + ' 11:30', end_time: D1 + ' 11:40', room: KA });
  t = W.rows('SELECT * FROM innovation_talks WHERE id = 71')[0];
  check('dragging it moves the talk too: morning, ten minutes, the other hall', r.status === 200 && JSON.stringify(r.json.talk_synced) === '[71]' && t.starts_at === D1 + ' 11:30' && t.duration_min === 10 && t.time_slot === 'Fri 20 Nov · 11:30 – 11:40 AM' && t.session_type === 'Morning' && t.hall === KA, t);
  W.db.run("UPDATE innovation_talks SET starts_at = '2026-11-20 13:00', time_slot = 'Fri 20 Nov · 1:00 – 1:10 PM' WHERE id = 71");
  d = await W.read();
  check('changed on the talks list alone: the difference is on the attention list, both times quoted', d.issues.some(i => i.kind === 'talk-differs' && i.talk_id === 71 && /programme says 11:30 to 11:40/.test(i.what) && /list says 13:00 to 13:10/.test(i.what)), d.issues.filter(i => i.group === 'talk'));
  r = await W.call('POST', '/api/admin/sessions/' + sid + '/move', { start_time: D1 + ' 11:30', end_time: D1 + ' 11:40', room: KA, force: true });
  d = await W.read();
  check('"use the programme\'s time" puts them back in step', r.status === 200 && W.rows('SELECT starts_at FROM innovation_talks WHERE id = 71')[0].starts_at === D1 + ' 11:30' && !d.issues.some(i => i.kind === 'talk-differs'));
  const before = JSON.stringify(W.rows('SELECT * FROM innovation_talks WHERE id IN (72, 73)'));
  r = await W.call('PUT', '/api/admin/sessions/' + sid, { title: 'Innovation Talk: Sync Co', session_type: 'talk', room: AR, start_time: D2 + ' 10:00', end_time: D2 + ' 10:08', speakers: [], others: 'Syd Barrett', speaker_title: 'CEO, Sync Co' });
  t = W.rows('SELECT * FROM innovation_talks WHERE id = 71')[0];
  check('saving it from the form moves the talk as well, and keeps the line under the name', r.status === 200 && t.starts_at === D2 + ' 10:00' && t.time_slot === 'Sat 21 Nov · 10:00 – 10:08 AM' && W.rows('SELECT speaker_title FROM sessions WHERE id = ?', [sid])[0].speaker_title === 'CEO, Sync Co', t);
  check('no other talk was touched', JSON.stringify(W.rows('SELECT * FROM innovation_talks WHERE id IN (72, 73)')) === before);
  const key = W.ses('Keynote');
  r = await W.call('POST', '/api/admin/sessions/' + key.id + '/move', { start_time: D1 + ' 09:00', end_time: D1 + ' 09:10' });
  check('a session that is not a talk syncs nothing', r.status === 200 && r.json.talk_synced === null);
}

// ================= find a free slot =================
{
  const W = await world();
  let r = await W.call('POST', '/api/admin/events/1/conference/suggest', { day: D1, minutes: 30, hall: BH });
  check('the first free half hour in Bhabha Hall is 11:00, after the keynote', r.status === 200 && r.json.slots[0].hall === BH && r.json.slots[0].start === '11:00' && r.json.slots[0].end === '11:30' && r.json.slots[0].free_until === '13:00', r.json.slots?.[0]);
  check('other halls are offered after it', r.json.slots.some(s => s.hall === KA) && r.json.slots.findIndex(s => s.hall === KA) > 0);
  r = await W.call('POST', '/api/admin/events/1/conference/suggest', { day: D1, minutes: 30, hall: KA, speaker_ids: [1] });
  check('a slot is never offered while its speaker is on stage (the keynote, 10:50 to 11:00)', r.json.slots.find(s => s.hall === KA).start === '11:00', r.json.slots.filter(s => s.hall === KA));
  const key = W.ses('Keynote');
  r = await W.call('POST', '/api/admin/events/1/conference/suggest', { day: D1, minutes: 10, hall: BH, speaker_ids: [1], except_id: key.id });
  check('the session being moved does not block itself', r.json.slots[0].start === '10:50' && r.json.slots[0].hall === BH, r.json.slots[0]);
  r = await W.call('POST', '/api/admin/events/1/conference/suggest', { day: D1, minutes: 600 });
  check('nothing fits: an empty list', r.status === 200 && r.json.slots.length === 0);
  check('no day: refused with a sentence', (await W.call('POST', '/api/admin/events/1/conference/suggest', { minutes: 30 })).status === 400);
  check('two minutes: refused with a sentence', /5 minutes or more/.test((await W.call('POST', '/api/admin/events/1/conference/suggest', { day: D1, minutes: 2 })).json.error));
  check('no password: refused', (await W.call('POST', '/api/admin/events/1/conference/suggest', { day: D1, minutes: 30 }, { admin: false })).status === 401);
}

// ================= a second event: Delhi, July 2027 =================
{
  const W = await world();
  const mumbaiBefore = JSON.stringify(W.rows('SELECT * FROM sessions WHERE event_id = 1 ORDER BY id'));
  let r = await W.call('POST', '/api/admin/conference/start-delhi', {});
  const ev = W.rows('SELECT * FROM events WHERE id = 2')[0];
  check('Delhi is started with the name, venue and dates its pass page uses', r.status === 200 && ev.title === 'Bharat AI Innovation Delhi 2027' && ev.venue === 'Bharat Mandapam, New Delhi' && ev.start_date === '2027-07-28' && ev.end_date === '2027-07-29', ev);
  W.db.run("UPDATE events SET venue = 'Bharat Mandapam, Pragati Maidan' WHERE id = 2");
  r = await W.call('POST', '/api/admin/conference/start-delhi', {});
  check('starting it again changes nothing', W.rows('SELECT COUNT(*) AS n FROM events')[0].n === 2 && W.rows('SELECT venue FROM events WHERE id = 2')[0].venue === 'Bharat Mandapam, Pragati Maidan');
  W.db.run("UPDATE events SET venue = 'Bharat Mandapam, New Delhi' WHERE id = 2");
  let d = await W.read(2);
  check('its programme opens empty: its own two days, no halls, no sessions', d.event.id === 2 && d.days.join() === '2027-07-28,2027-07-29' && d.halls.length === 0 && d.sessions.length === 0 && d.speakers.length === 0, [d.days, d.halls.length]);
  check('its words are its own', d.words.line === '28-29 July 2027 · Bharat Mandapam, New Delhi' && d.words.name === 'Bharat AI Innovation Delhi 2027');
  check('both events are listed for the switcher', d.events.map(e => e.id).join() === '1,2' && Number(d.events.find(e => e.id === 1).sessions) === 4);
  check('each empty day is noted', d.issues.filter(i => i.kind === 'empty-day').length === 2);
  r = await W.call('POST', '/api/admin/events/2/conference/copy-from/1', {});
  check("Mumbai's programme is copied: 4 sessions, 4 halls", r.status === 200 && r.json.sessions === 4 && r.json.halls === 4 && r.json.skipped === 0, r.json);
  const copied = W.rows('SELECT s.*, a.status, a.note FROM sessions s LEFT JOIN session_admin a ON a.session_id = s.id WHERE s.event_id = 2 ORDER BY s.start_time');
  check('every copy is a draft with no speaker', copied.length === 4 && copied.every(s => s.status === 'draft' && s.speaker_name === null && s.speaker_title === null), copied.map(s => [s.status, s.speaker_name]));
  check('on the same day number at the same time', copied.map(s => s.start_time).join() === '2027-07-28 10:50,2027-07-28 13:00,2027-07-28 14:00,2027-07-29 11:00' && copied[0].end_time === '2027-07-28 11:00', copied.map(s => s.start_time));
  check('each says where it came from, for the team only', copied.every(s => /Copied from Bharat AI Innovation 2026/.test(s.note)));
  const halls = W.rows('SELECT * FROM conference_halls WHERE event_id = 2 ORDER BY sort_order');
  check("the halls come with their event names and without Mumbai's room names", halls.length === 4 && halls[0].name === BH && halls.every(h => h.venue_room === null && h.location === null), halls.map(h => [h.name, h.venue_room]));
  check('no speaker links were copied', W.rows('SELECT COUNT(*) AS n FROM session_speakers ss JOIN sessions s ON s.id = ss.session_id WHERE s.event_id = 2')[0].n === 0);
  check("Mumbai's own programme is exactly as it was", JSON.stringify(W.rows('SELECT * FROM sessions WHERE event_id = 1 ORDER BY id')) === mumbaiBefore);
  r = await W.call('POST', '/api/admin/events/2/conference/copy-from/1', {});
  check('a second copy is refused: it is only for an empty programme', r.status === 409 && /already has 4 sessions/.test(r.json.error) && W.rows('SELECT COUNT(*) AS n FROM sessions WHERE event_id = 2')[0].n === 4, r.json);
  check('copying an event onto itself is refused', (await W.call('POST', '/api/admin/events/2/conference/copy-from/2', {})).status === 400);
  check('copying from an event that is not there is refused', (await W.call('POST', '/api/admin/events/1/conference/copy-from/9', {})).status === 404);
  check('no password: refused', (await W.call('POST', '/api/admin/events/2/conference/copy-from/1', {}, { admin: false })).status === 401 && (await W.call('POST', '/api/admin/conference/start-delhi', {}, { admin: false })).status === 401);
  d = await W.read(2);
  check('the copied drafts are on its attention list', d.issues.filter(i => i.kind === 'draft').length === 4 && d.issues.some(i => i.kind === 'no-speaker'));
  // nothing of it is public
  for (const p of ['/api/events/2/sessions', '/api/events/2/speakers', '/api/events/2']) {
    const pub = await W.call('GET', p, undefined, { admin: false });
    check('not public: ' + p + ' is refused', pub.status === 404 && !/Keynote|Bhabha/.test(pub.text), pub.status);
  }
  const mum = await W.call('GET', '/api/events/1/sessions', undefined, { admin: false });
  check("Mumbai's public programme still has its 4 sessions and none of Delhi's", mum.status === 200 && mum.json.length === 4 && mum.json.every(s => Number(s.event_id) === 1), mum.json?.length);
  // a Delhi speaker and their email
  r = await W.call('POST', '/api/admin/speakers', { event_id: 2, name: 'Dr. Asha Rao', role: 'Director', organisation: 'Delhi Lab', email: 'asha@delhi.test', phone: '98200 00001' });
  const sp = r.json.id;
  r = await W.call('PUT', '/api/admin/sessions/' + copied[0].id, { title: 'Opening keynote', session_type: 'keynote', room: BH, start_time: '2027-07-28 10:50', end_time: '2027-07-28 11:00', speakers: [{ speaker_id: sp, role: 'keynote' }], status: 'draft' });
  r = await W.call('POST', '/api/admin/speakers/' + sp + '/slot-email', { preview: true });
  check("a Delhi speaker's email names Delhi, 28-29 July 2027 and Bharat Mandapam, and never Mumbai", r.status === 200 && /Bharat AI Innovation Delhi 2027/.test(r.json.subject) && /28-29 July 2027/.test(r.json.html) && /Bharat Mandapam/.test(r.json.html) && !/Mumbai|World Trade|November/.test(r.json.html), r.json?.subject);
  r = await W.call('POST', '/api/admin/speakers/' + sp + '/pass', {});
  check('a pass for a Delhi speaker waits for its registration', r.status === 409 && /open when its registration does/.test(r.json.error) && W.rows("SELECT COUNT(*) AS n FROM attendees WHERE email = 'asha@delhi.test'")[0].n === 0, r.json);
  r = await W.call('POST', '/api/admin/speakers/1/slot-email', { preview: true });
  check("a Mumbai speaker's email is still Mumbai's", /Bharat AI Innovation 2026/.test(r.json.subject) && /20-21 November 2026/.test(r.json.html) && !/Delhi/.test(r.json.html));
}

// ================= a speaker with their details, and their pass =================
{
  const W = await world();
  let r = await W.call('POST', '/api/admin/speakers', { event_id: 1, name: 'Meera Nair', role: 'Chief Data Officer', organisation: 'Kerala Bank', email: ' Meera@Bank.Test ', phone: '98200 55555' });
  const row = W.rows('SELECT * FROM speakers WHERE id = ?', [r.json.id])[0];
  check('one call puts a speaker in the database with designation, organisation, email and mobile', r.status === 201 && row.name === 'Meera Nair' && row.role === 'Chief Data Officer' && row.organisation === 'Kerala Bank' && row.email === 'meera@bank.test' && /98200 ?55555/.test(row.phone), row);
  const again = await W.call('POST', '/api/admin/speakers', { event_id: 1, name: 'meera nair' });
  check('the same name again answers with who it is, so the form can use them', again.status === 409 && again.json.speaker_id === r.json.id);
  const meera = r.json.id;
  r = await W.call('POST', '/api/admin/speakers/' + meera + '/pass', {});
  let a = W.rows("SELECT * FROM attendees WHERE email = 'meera@bank.test'");
  check('their Speaker pass is made: one registration, Speaker, nothing to pay, for the conference', r.status === 200 && r.json.created === true && r.json.pass === 'Speaker' && a.length === 1 && a[0].badge_type === 'Speaker' && a[0].payment_status === 'waived' && Number(a[0].main_event) === 1 && a[0].name === 'Meera Nair' && a[0].company === 'Kerala Bank' && a[0].job_title === 'Chief Data Officer' && a[0].registration_source === 'speaker', a[0]);
  check('a Speaker pass includes lunch (organiser, 12 Nov 2026)', a[0].lunch_inclusion === 'Yes', a[0].lunch_inclusion);
  check('their mobile is on it', /98200 ?55555/.test(a[0].mobile || ''), a[0]?.mobile);
  r = await W.call('POST', '/api/admin/speakers/' + meera + '/pass', {});
  check('asked again: still one registration, nothing made or raised', r.status === 200 && r.json.created === false && r.json.raised === false && r.json.kept === false && W.rows("SELECT COUNT(*) AS n FROM attendees WHERE email = 'meera@bank.test'")[0].n === 1, r.json);
  let d = await W.read();
  check('the Conference read shows the pass on the speaker', d.speakers.find(s => s.id === meera).pass.badge_type === 'Speaker');
  r = await W.call('POST', '/api/admin/speakers/2/pass', {});
  check('no email: refused with what to do', r.status === 409 && /Add an email for Tarun Chugh first/.test(r.json.error), r.json);
  // someone already registered on a free pass
  W.db.run("INSERT INTO attendees (event_id, name, email, badge_type, payment_status, job_title, company, mobile, main_event, lunch_inclusion) VALUES (1, 'K K Singh', 'kk@example.test', 'Visitor Pass', '', 'Their own title', '', '', 1, 'No')");
  r = await W.call('POST', '/api/admin/speakers/1/pass', {});
  a = W.rows("SELECT * FROM attendees WHERE email = 'kk@example.test'")[0];
  check('a free Visitor Pass is raised to Speaker', r.status === 200 && r.json.raised === true && r.json.created === false && a.badge_type === 'Speaker' && a.payment_status === 'waived', a);
  check('...and gets lunch with it', a.lunch_inclusion === 'Yes', a.lunch_inclusion);
  check('what they wrote themselves is kept; only blanks are filled', a.job_title === 'Their own title' && /Ministry of Electronics/.test(a.company) && a.name === 'K K Singh');
  // a pass of their own
  W.db.run("UPDATE speakers SET email = 'tarun@bajaj.test' WHERE id = 2");
  W.db.run("INSERT INTO attendees (event_id, name, email, badge_type, payment_status, main_event, lunch_inclusion) VALUES (1, 'Tarun Chugh', 'tarun@bajaj.test', 'Delegate Pass', 'paid', 1, 'No')");
  r = await W.call('POST', '/api/admin/speakers/2/pass', {});
  check("a kept pass keeps its own lunch as it was: nothing is written", W.rows("SELECT lunch_inclusion FROM attendees WHERE email = 'tarun@bajaj.test'")[0].lunch_inclusion === 'No');
  check('a paid Delegate Pass is kept, and the reply says so', r.status === 200 && r.json.kept === true && r.json.pass === 'Delegate Pass' && W.rows("SELECT badge_type, payment_status FROM attendees WHERE email = 'tarun@bajaj.test'")[0].badge_type === 'Delegate Pass', r.json);
  W.db.run("UPDATE speakers SET email = 'saurabh@inst.test', phone = '9820012345' WHERE id = 4");
  W.db.run("INSERT INTO attendees (event_id, name, email, badge_type, payment_status, main_event) VALUES (1, 'Saurabh', 'saurabh@inst.test', 'VIP Pass', 'pending', 1)");
  W.db.run("INSERT INTO attendees (event_id, name, email, badge_type, mobile, main_event) VALUES (1, 'Number Holder', 'holder@else.test', 'Visitor Pass', '9820012345', 1)");
  r = await W.call('POST', '/api/admin/speakers/4/pass', {});
  a = W.rows("SELECT * FROM attendees WHERE email = 'saurabh@inst.test'")[0];
  check('a VIP Pass nobody paid for is raised to Speaker', r.status === 200 && r.json.raised === true && a.badge_type === 'Speaker' && a.payment_status === 'waived', a);
  check('a mobile somebody else holds is left off, and theirs is untouched', !String(a.mobile || '').trim() && W.rows("SELECT mobile FROM attendees WHERE email = 'holder@else.test'")[0].mobile === '9820012345');
  W.db.run("UPDATE attendees SET lunch_inclusion = 'No' WHERE email = 'shailesh@example.test'");
  r = await W.call('POST', '/api/admin/speakers/3/pass', {});
  check('someone who already holds a Speaker pass: the pass stays as it is', r.status === 200 && r.json.created === false && r.json.raised === false && r.json.pass === 'Speaker');
  check('...and a Speaker pass that had no lunch on it now has', W.rows("SELECT lunch_inclusion FROM attendees WHERE email = 'shailesh@example.test'")[0].lunch_inclusion === 'Yes');
  check('unknown speaker: 404', (await W.call('POST', '/api/admin/speakers/99999/pass', {})).status === 404);
  const n = W.rows('SELECT COUNT(*) AS n FROM attendees')[0].n;
  check('no password: refused, nobody registered', (await W.call('POST', '/api/admin/speakers/' + meera + '/pass', {}, { admin: false })).status === 401 && W.rows('SELECT COUNT(*) AS n FROM attendees')[0].n === n);
  check('each pass made or raised is in the audit log', W.rows("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'speaker.pass'")[0].n >= 5 && W.rows("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'attendee.speaker-pass'")[0].n === 2);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
