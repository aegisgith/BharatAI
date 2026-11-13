// Integration: announcing a whole panel (13 Nov 2026), through the WHOLE built worker
// on real SQLite (conference-world.mjs). One post in the app's announcements; every
// speaker shown on the session is recorded as announced; a hidden speaker is not; a
// draft is refused; only an admin may; it works before 0054 with nothing recorded.
// Also: the app's announcement list keeps the message's line breaks.
// Run after `npm run build`:  node scripts/verify/smoke-panel-announce.mjs
import { makeWorld } from './conference-world.mjs';

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 400))); if (!ok) fails++; };
const WORDS = { title: 'Panel discussion on Fri 20 Nov: AI Democratizing and Driving Financial Inclusion',
  content: '"AI Democratizing and Driving Financial Inclusion"\nFri 20 Nov 2026, 2:00 pm to 3:00 pm, Homi J. Bhabha Hall (Peacock Hall).\n\nModerator:\n• Shailesh Dhuri\n\nPanellists:\n• Tarun Chugh' };

{
  const W = await makeWorld({ migrated: true });
  const panel = W.rows("SELECT id FROM sessions WHERE session_type = 'panel'")[0].id;
  const talk = W.rows("SELECT id FROM sessions WHERE title = 'AI in Education'")[0].id;

  let r = await W.call('POST', `/api/admin/sessions/${panel}/announce`, WORDS, { admin: false });
  check('nobody but an admin may announce', r.status === 401 || r.status === 403, r.status);
  check('...and nothing was posted', W.rows('SELECT COUNT(*) AS n FROM announcements')[0].n === 0);

  r = await W.call('POST', `/api/admin/sessions/${panel}/announce`, { title: ' ', content: 'x' });
  check('no headline: refused in plain words', r.status === 400 && /headline and the message/.test(r.json.error), r.json);
  r = await W.call('POST', '/api/admin/sessions/99999/announce', WORDS);
  check('a session taken off the programme: says so', r.status === 404 && /not on the programme/.test(r.json.error), r.json);

  // The panel as the old SQL wrote it: no saved links, the speakers matched by name.
  r = await W.call('POST', `/api/admin/sessions/${panel}/announce`, { ...WORDS, pinned: true });
  check('the panel is announced', r.status === 201 && r.json.success && r.json.speakers === 2 && r.json.logged === true, r.json);
  const a = W.rows('SELECT * FROM announcements ORDER BY id DESC LIMIT 1')[0];
  check('one post in the app, pinned, with the words as written, line breaks kept', a && a.event_id === 1 && a.pinned === 1 && a.title === WORDS.title && a.content === WORDS.content && a.content.includes('\nPanellists:\n• Tarun Chugh'), a);
  const logged = W.rows('SELECT speaker_id, session_id, announcement_id, created_by FROM speaker_announcements ORDER BY speaker_id');
  check('both speakers on it (moderator and panellist) are recorded as announced, for this session', logged.map(x => x.speaker_id).join() === '2,3' && logged.every(x => x.session_id === panel && x.announcement_id === a.id && x.created_by === 'Harness'), logged);
  const au = W.rows("SELECT * FROM admin_audit WHERE action = 'session.announce'")[0];
  check('it is in the audit log with who was named', au && /Tarun Chugh/.test(au.detail) && /Shailesh Dhuri/.test(au.detail) && /Harness/.test(au.actor), au);

  r = await W.call('GET', '/api/admin/events/1/conference');
  const sp = (id) => (r.json.speakers || []).find(x => Number(x.id) === id);
  check('their cards now say announced', sp(2) && sp(2).announced && sp(3) && sp(3).announced && !(sp(4) && sp(4).announced), [sp(2), sp(3), sp(4)]);

  // Saved links with a hidden speaker on the panel: not recorded, not counted.
  W.db.run('INSERT INTO session_speakers (session_id, speaker_id, role, sort_order) VALUES (?, 2, ?, 1), (?, 5, ?, 2), (?, 3, ?, 3)', [panel, 'panellist', panel, 'panellist', panel, 'moderator']);
  r = await W.call('POST', `/api/admin/sessions/${panel}/announce`, WORDS);
  check('a speaker hidden from attendees is not recorded as announced', r.status === 201 && r.json.speakers === 2 && W.rows('SELECT COUNT(*) AS n FROM speaker_announcements WHERE speaker_id = 5')[0].n === 0, r.json);

  W.db.run("INSERT INTO session_admin (session_id, status) VALUES (?, 'draft')", [talk]);
  r = await W.call('POST', `/api/admin/sessions/${talk}/announce`, { title: 'x', content: 'y' });
  check('a draft is refused, with what to do', r.status === 409 && /draft/.test(r.json.error) && /Keep as a draft/.test(r.json.error), r.json);

  // The app's announcement list keeps line breaks, so a list of panellists reads as a list.
  const js = await W.call('GET', '/app.js', undefined, { admin: false });
  const appJs = js.status === 200 ? js.text : (await W.call('GET', '/app', undefined, { admin: false })).text;
  check('the app shows an announcement with its line breaks', /white-space:pre-line"?>\$\{linkify\(esc\(a\.content\)\)\}/.test(appJs) || /white-space:pre-line[^>]*>\$\{linkify\(esc\(a\.content\)\)\}/.test(appJs), js.status);
  const admin = await W.call('GET', '/admin', undefined, { admin: false });
  check('the admin page loads the new Conference screen, before /admin.js', /conference-admin\.js\?v=20261113"/.test(admin.text) && admin.text.indexOf('conference-admin.js') < admin.text.indexOf('/admin.js?v='), '');
}

{
  // Before 0054: the announcement still posts; there is nowhere to record who.
  const W = await makeWorld({ migrated: false });
  const panel = W.rows("SELECT id FROM sessions WHERE session_type = 'panel'")[0].id;
  const r = await W.call('POST', `/api/admin/sessions/${panel}/announce`, WORDS);
  check('before 0054: posted, nothing recorded, says so', r.status === 201 && r.json.logged === false && W.rows('SELECT COUNT(*) AS n FROM announcements')[0].n === 1, r.json);
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
