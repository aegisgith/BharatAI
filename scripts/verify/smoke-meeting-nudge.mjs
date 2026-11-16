// Integration: a meeting request nobody has answered for two days gets one nudge email
// from the minute clock (16 Nov 2026), through the WHOLE built worker on real SQLite.
// A fresh request waits; a request for a time already gone is left alone; the nudge
// goes once, to the person asked, naming who asked and when; the networking emails
// switch holds it back. Run after `npm run build`:  node scripts/verify/smoke-meeting-nudge.mjs
import { makeWorld } from './conference-world.mjs';

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 400))); if (!ok) fails++; };
const W = await makeWorld();
const att = (name, email, company) => { W.db.run("INSERT INTO attendees (event_id, name, email, company, job_title, badge_type, payment_status, main_event) VALUES (1, ?, ?, ?, 'CTO', 'Delegate Pass', 'paid', 1)", [name, email, company]); return W.rows('SELECT id FROM attendees WHERE email = ?', [email])[0].id; };
const asha = att('Asha Rao', 'asha@example.test', 'Tata Capital');
const ravi = att('Ravi Kumar', 'ravi@example.test', 'NPCI');
const meeting = (from, to, time, status, agoDays) => { W.db.run("INSERT INTO meetings (event_id, requester_id, requestee_id, title, meeting_time, duration_minutes, location, status, created_at) VALUES (1, ?, ?, 'AI in lending', ?, 15, 'Networking lounge', ?, datetime('now', ?))", [from, to, time, status, '-' + agoDays + ' days']); return W.db.exec('SELECT last_insert_rowid()')[0].values[0][0]; };
const old = meeting(asha, ravi, '2099-11-20 11:00', 'pending', 3);
const fresh = meeting(asha, ravi, '2099-11-20 12:00', 'pending', 1);
const gone = meeting(ravi, asha, '2020-01-01 10:00', 'pending', 5);
const accepted = meeting(ravi, asha, '2099-11-21 10:00', 'accepted', 4);
const tick = () => W.call('POST', '/api/cron/tick', { max_seconds: 1 });

let r = await tick();
check('the clock answers, with the nudges counted', r.status === 200 && r.json && r.json.meeting_nudges && r.json.meeting_nudges.sent === 1, r.json && r.json.meeting_nudges);
const mail = W.sent.find((m) => /Still waiting/.test(String(m.Subject || (m.Content && m.Content.Subject) || '')));
check('one nudge went, to the person asked, naming who asked and the time', !!mail && JSON.stringify(mail).includes('ravi@example.test') && /Asha Rao/.test(JSON.stringify(mail)) && /2099/.test(JSON.stringify(mail)), mail && JSON.stringify(mail).slice(0, 300));
check('the fresh request, the one for a time gone by and the accepted one were left alone', W.sent.length === 1 && !W.rows("SELECT 1 FROM app_settings WHERE key IN (?, ?, ?)", ['meeting_nudge:' + fresh, 'meeting_nudge:' + gone, 'meeting_nudge:' + accepted]).length, W.sent.length);
check('the nudge is recorded against the meeting', W.rows("SELECT 1 FROM app_settings WHERE key = ?", ['meeting_nudge:' + old]).length === 1 && W.rows("SELECT 1 FROM admin_audit WHERE action = 'meeting.nudged' AND entity_id = ?", [String(old)]).length === 1);
r = await tick();
check('the next minute sends nothing more', r.json.meeting_nudges.sent === 0 && W.sent.length === 1, r.json.meeting_nudges);
W.db.run("UPDATE meetings SET created_at = datetime('now', '-3 days') WHERE id = ?", [fresh]);
W.db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('networking_emails', 'off')");
r = await tick();
check('with networking emails off, the nudge is held (claimed, not sent)', r.status === 200 && W.sent.length === 1, W.sent.length);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
