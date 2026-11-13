// System: one speaker from "Send brief" to standing at the badge desk with their pass
// (12 Nov 2026), through the WHOLE built worker on real SQLite (conference-world.mjs).
// A speaker with no pass is sent their brief; the email's button is followed the way
// the app follows it (POST /api/events/1/attendees/login with the link's email and
// token); they are signed in as a Speaker under that address; the link works again
// (people click twice); a tampered token is refused; the calendar link in the same
// email answers with their session; the session then moves and the update carries a
// fresh link that also signs them in.
// Run after `npm run build`:  node scripts/verify/system-speaker-brief.mjs
import { makeWorld } from './conference-world.mjs';

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 500))); if (!ok) fails++; };

const W = await makeWorld({ migrated: true });
// Asha Rao: a panellist with an email and no pass, on the seeded financial-inclusion panel.
W.db.run("INSERT INTO speakers (id, event_id, slug, name, role, organisation, email, is_published, sort_order) VALUES (40, 1, 'asha-rao', 'Dr. Asha Rao', 'Chief Data Officer', 'Tata Capital', 'asha@example.test', 1, 40)");
const panelId = W.rows("SELECT id FROM sessions WHERE session_type = 'panel'")[0].id;
W.db.run("UPDATE sessions SET speaker_name = speaker_name || ', Dr. Asha Rao (Tata Capital)' WHERE id = ?", [panelId]);
check('before: no pass under her email', W.rows("SELECT COUNT(*) AS n FROM attendees WHERE lower(email) = 'asha@example.test'")[0].n === 0);

const linkIn = (m) => {
  const s = JSON.stringify(m).replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
  const x = /app\?email=([^&"\\]+)&action=download-pass(?:&token=([A-Za-z0-9_.~-]+))?/.exec(s);
  return x ? { email: decodeURIComponent(x[1]), token: x[2] || '' } : null;
};
const login = (email, token) => W.call('POST', '/api/events/1/attendees/login', { email, token }, { admin: false });

// ---- the brief goes ----
let r = await W.call('POST', '/api/admin/speakers/40/brief', {});
check('the brief is sent to her', r.status === 200 && r.json.to === 'asha@example.test' && W.sent.length === 1, r.json);
check('her Speaker pass was made on the way', r.json.pass && r.json.pass.created === true && r.json.pass.pass === 'Speaker', r.json.pass);
const mail = JSON.stringify(W.sent[0]);
check('the email names her panel, her moderator and the others on it', mail.includes('Tarun Chugh (Bajaj Life Insurance)') && mail.includes('Shailesh Dhuri (Decimal Point Analytics)') && mail.includes('Ratan Kumar Kesh (Bandhan Bank)'));
const link = linkIn(W.sent[0]);
check('the email carries a sign-in link to her pass', link && link.email === 'asha@example.test' && link.token.length >= 16, link);

// ---- she taps it ----
r = await login(link.email, link.token);
check('the link signs her in', r.status === 200 && r.json && String(r.json.email).toLowerCase() === 'asha@example.test', [r.status, r.json && r.json.error]);
check('...as a Speaker, with her pass at the event', r.json.badge_type === 'Speaker' && Number(r.json.event_id) === 1, r.json && r.json.badge_type);
r = await login(link.email, link.token);
check('tapping it a second time still works', r.status === 200 && r.json.badge_type === 'Speaker', [r.status, r.json && r.json.error]);
r = await login(link.email, link.token.slice(0, -2) + (link.token.endsWith('aa') ? 'bb' : 'aa'));
check('a changed token is refused', r.status === 401 || r.status === 403, r.status);
r = await login('someone@example.test', link.token);
check('her token does not sign in anyone else', r.status !== 200, r.status);

// ---- the calendar link in the same email ----
const ics = /api\/sessions\/(\d+)\/calendar\.ics/.exec(mail);
r = await W.call('GET', '/api/sessions/' + (ics && ics[1]) + '/calendar.ics', undefined, { admin: false });
check('the email’s calendar link answers with her session', r.status === 200 && r.text.includes('AI Democratizing and Driving Financial Inclusion') && r.text.includes('Homi J. Bhabha Hall (Peacock Hall)'), [r.status, r.text.slice(0, 120)]);

// ---- the session moves; the update ----
W.db.run("UPDATE sessions SET room = 'Kalam Theatre' WHERE id = ?", [panelId]);
const d = (await W.call('GET', '/api/admin/events/1/speaker-briefs')).json;
check('the list notices she was told the old hall', d.speakers.find(s => s.id === 40).status === 'changed');
r = await W.call('POST', '/api/admin/speakers/40/brief', {});
const upd = JSON.stringify(W.sent[1] || {});
check('the update goes, with the new hall by both names', r.status === 200 && r.json.kind === 'update' && upd.includes('Updated: Your session') && upd.includes('Kalam Theatre') && upd.includes('Centrum Hall A'), r.json);
check('her pass was kept, not made twice', r.json.pass && r.json.pass.created === false && W.rows("SELECT COUNT(*) AS n FROM attendees WHERE lower(email) = 'asha@example.test'")[0].n === 1, r.json.pass);
const link2 = linkIn(W.sent[1]);
r = link2 ? await login(link2.email, link2.token) : { status: 0 };
check('the update’s link signs her in too', r.status === 200 && r.json.badge_type === 'Speaker', r.status);
r = await login(link.email, link.token);
check('and the first email’s link still works (links live on their own)', r.status === 200, r.status);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
