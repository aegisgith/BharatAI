// Integration: the automatic missing-details email to Innovation Talk speakers (12 Nov
// 2026), on the whole built worker and real SQLite with the 49 real talks, with this
// process's clock moved. The rules: off until switched on; one email a minute from the
// minute clock; only inside the sending hours (9 am to 9 pm India); only to a talk with
// something missing and an address to write to; nobody asked twice within 48 hours,
// by hand or by itself; three times at most; a failed send is not counted; company
// name is asked for like the rest; the switch, its summary and who may use it.
// Run after `npm run build`:  node scripts/verify/smoke-talk-auto.mjs
const Real = Date;
let off = 0;
globalThis.Date = class extends Real {
  constructor(...a) { if (a.length) super(...a); else super(Real.now() + off); }
  static now() { return Real.now() + off; }
};
const at = (day, hhmm) => { off = Real.parse(`${day}T${hhmm}:00+05:30`) - Real.now(); };
at('2026-11-13', '11:00');

const { talksWorld, checker, ADMIN } = await import('./talks-world.mjs');
const { check, done } = checker();
const W = await talksWorld({ times: true });
const tick = () => W.hit('POST', '/api/cron/tick', {}, { Authorization: 'Bearer ' + ADMIN });
const talkMails = () => W.sent.filter(m => /Innovation Talk/.test(m.Content.Subject));
const T = (name) => W.talk('speaker_name = ?', name);

// Two speakers with an address of their own, one complete, one with a booth contact.
const ok = { topic: 'T', speaker_title: 'CEO', company: 'Co', speaker_photo_url: '/images/talks/x.webp', speaker_bio: 'Bio', speaker_phone: '+91 98200 00000' };
W.db.run("UPDATE innovation_talks SET speaker_email = 'amritesh@phoebetal.test' WHERE speaker_name = 'Amritesh Kumar'");
W.db.run("UPDATE innovation_talks SET speaker_email = 'raveesh@joget.test', speaker_bio = '', speaker_phone = '' WHERE speaker_name = 'Raveesh Dewan'");
W.db.run(`UPDATE innovation_talks SET speaker_email = 'done@complete.test', topic = ?, speaker_title = ?, company = ?, speaker_photo_url = ?, speaker_bio = ?, speaker_phone = ? WHERE speaker_name = 'Dipak Zope'`,
  [ok.topic, ok.speaker_title, ok.company, ok.speaker_photo_url, ok.speaker_bio, ok.speaker_phone]);
W.db.run("INSERT INTO exhibitors (id, event_id, company_name, contact_email) VALUES (31, 1, 'Xtant Tech', 'spoc@xtant.test')");
W.db.run("UPDATE innovation_talks SET status = 'cancelled', speaker_email = 'cancelled@x.test' WHERE speaker_name = 'Shashank KP'");

// Ministers, Secretaries and Joint Secretaries (organiser, 12 Nov 2026): each of these
// has an address and something missing, and must never be written to by itself.
W.db.run("UPDATE innovation_talks SET speaker_email = 'js@gov.test', speaker_title = 'Joint Secretary, MeitY' WHERE speaker_name = 'Shivendra Singh'");
W.db.run("UPDATE innovation_talks SET speaker_email = 'sec@gov.test', speaker_title = 'Secretary, Department of IT' WHERE speaker_name = 'Divyanshi Saxena'");
W.db.run("UPDATE innovation_talks SET speaker_email = 'min@gov.test', speaker_name = 'Hon’ble Shri Test Mantri', speaker_title = 'Minister of Information Technology' WHERE speaker_name = 'Shishir Sharan'");
W.db.run("UPDATE innovation_talks SET speaker_title = 'Company Secretary' WHERE speaker_name = 'Saurabh Singh'");
const flags = (await W.as('GET', '/api/admin/innovation-talks/contacts?event_id=1')).json.contacts;
const flag = (name) => flags[T(name).id].protocol;
check('a Joint Secretary, a Secretary and a Minister are marked for a person to write to', flag('Shivendra Singh') === true && flag('Divyanshi Saxena') === true && flag('Hon’ble Shri Test Mantri') === true);
check('a Deputy Secretary too (any rank of Secretary)', flag('Ganesh Nagarajan') === true, T('Ganesh Nagarajan').speaker_title);
check("a company's own Company Secretary is not, nor a CEO, nor someone merely from a Ministry", flag('Saurabh Singh') === false && flag('Amritesh Kumar') === false && flag('Dipak Zope') === false);

// ---- off ----
let r = await W.as('GET', '/api/admin/innovation-talks/auto?event_id=1');
check('off until someone turns it on, and it says who would get one', r.status === 200 && r.json.on === false && r.json.due === 3 && r.json.every_hours === 48 && r.json.max === 3, r.json);
check('the summary names the Ministers and Secretaries left for a person, and does not count them', r.json.held.map(h => h.speaker).sort().join() === ['Divyanshi Saxena', 'Dr. K. Mahesh', 'Ganesh Nagarajan', 'Hon’ble Shri Test Mantri', 'Shivendra Singh'].sort().join() && !r.json.next.some(n => /Shivendra|Divyanshi|Mantri/.test(n.speaker)), r.json.held);
check('the two real government secretaries on the talk list are among them (Dr. K. Mahesh, Ganesh Nagarajan)', r.json.held.some(h => h.speaker === 'Dr. K. Mahesh' && /^Secretary/.test(h.title)) && r.json.held.some(h => h.speaker === 'Ganesh Nagarajan'));
check('the would-be list names them, worst-waiting first, with what is missing', r.json.next.length === 3 && r.json.next.every(n => n.missing.length > 0) && !r.json.next.some(n => /Dipak|Shashank/.test(n.speaker)), r.json.next);
r = await tick();
check('off: the clock sends nothing, and says so', r.status === 200 && r.json.talk_requests.on === false && talkMails().length === 0, r.json.talk_requests);

// ---- on ----
r = await W.as('POST', '/api/admin/innovation-talks/auto', { on: true, event_id: 1 });
check('turned on: the switch answers with the new state', r.status === 200 && r.json.on === true && r.json.due === 3);
check('turning it on is in the audit log', W.rows("SELECT * FROM admin_audit WHERE action = 'innovation_talk.auto_request'").length === 1);
r = await tick();
let m = talkMails();
check('one minute: exactly one email', r.json.talk_requests.sent === 1 && m.length === 1, r.json.talk_requests);
const first = m[0];
const firstTo = first.Recipients.To[0];
check('from register@, with no unsubscribe footer', /register@bharataiinnovation\.com/.test(first.Content.From) && !/Unsubscribe/i.test(first.Content.Body[0].Content));
const asked = W.rows("SELECT * FROM innovation_talks WHERE details_requested_to = ?", [firstTo])[0];
check('the talk records when and to whom', asked && String(asked.details_requested_at).startsWith('2026-11-13 05:30'), asked && [asked.details_requested_at, asked.details_requested_to]);
check('the email asks only for what that talk is missing', asked && ['topic', 'speaker_title', 'company', 'speaker_photo_url', 'speaker_bio', 'speaker_phone'].every(k => {
  const has = String(asked[k] ?? '').trim().length > 0;
  const label = { topic: 'The title of your talk', speaker_title: 'Your designation', company: 'Your company name', speaker_photo_url: 'A clear photo of you', speaker_bio: 'Two or three lines about you', speaker_phone: 'Your mobile number' }[k];
  return has !== first.Content.Body[0].Content.includes(label);
}), asked);
check("the audit log marks it as sent by itself", W.rows("SELECT * FROM admin_audit WHERE action = 'innovation_talk.request_details'").some(a => /"automatic":true/.test(a.detail) && a.actor === 'automatic'));
r = await tick(); r = await tick();
m = talkMails();
const tos = m.map(x => x.Recipients.To[0]);
check('three minutes: three different people, one each', m.length === 3 && new Set(tos).size === 3, tos);
check('the booth contact is written to when there is no own address, as "Hello"', tos.includes('spoc@xtant.test') && /Hello,/.test(m.find(x => x.Recipients.To[0] === 'spoc@xtant.test').Content.Body[0].Content));
check('the own address is greeted by name', /Dear Amritesh Kumar,/.test(m.find(x => x.Recipients.To[0] === 'amritesh@phoebetal.test').Content.Body[0].Content));
check('the complete talk and the cancelled one are never written to', !tos.includes('done@complete.test') && !tos.includes('cancelled@x.test'));
r = await tick();
check('a fourth minute: nobody is due, nothing goes', r.json.talk_requests.sent === 0 && r.json.talk_requests.due === 0 && talkMails().length === 3, r.json.talk_requests);

// ---- the wait, the hours, the limit ----
at('2026-11-14', '11:00');
r = await tick();
check('a day later: still nobody (48 hours between asks)', r.json.talk_requests.sent === 0 && talkMails().length === 3);
at('2026-11-15', '22:30');
r = await tick();
check('two days later but at 10:30 pm: waits for the morning', r.json.talk_requests.sent === 0 && /outside/.test(r.json.talk_requests.waiting || ''), r.json.talk_requests);
at('2026-11-15', '11:30');
await tick(); await tick(); await tick();
check('two days later inside the hours: each is reminded once', talkMails().length === 6);
// Someone asked by hand an hour ago is left for 48 hours from then.
at('2026-11-17', '12:00');
const am = T('Amritesh Kumar');
await W.as('POST', '/api/admin/innovation-talks/' + am.id + '/request-details', { to: 'amritesh@phoebetal.test', items: ['topic'] });
const handCount = talkMails().length;
at('2026-11-17', '13:00');
await tick(); await tick(); await tick();
const after = talkMails().slice(handCount).map(x => x.Recipients.To[0]);
check('a speaker asked by hand an hour ago is not asked again by itself', !after.includes('amritesh@phoebetal.test') && after.length === 2, after);
at('2026-11-19', '13:00');
const c19 = talkMails().length;
await tick(); await tick(); await tick();
const on19 = talkMails().slice(c19).map(x => x.Recipients.To[0]);
const log = JSON.parse(W.rows("SELECT value FROM app_settings WHERE key = 'italk_auto_log'")[0].value);
check('48 hours after the hand-sent email, that speaker gets the third; the other two have had three and get none', on19.length === 1 && on19[0] === 'amritesh@phoebetal.test', on19);
check('three times by itself at most', Object.values(log).length === 3 && Object.values(log).every(x => x.n === 3), log);
// Details arrive: no more emails.
W.db.run(`UPDATE innovation_talks SET topic = ?, speaker_title = ?, company = ?, speaker_photo_url = ?, speaker_bio = ?, speaker_phone = ? WHERE speaker_name = 'Amritesh Kumar'`,
  [ok.topic, ok.speaker_title, ok.company, ok.speaker_photo_url, ok.speaker_bio, ok.speaker_phone]);
at('2026-11-23', '11:00');
const before = talkMails().length;
await tick(); await tick(); await tick();
check('through every tick, over ten days, no Minister or Secretary was written to', !talkMails().some(x => /@gov\.test$/.test(x.Recipients.To[0])), talkMails().map(x => x.Recipients.To[0]));
r = await W.as('POST', '/api/admin/innovation-talks/' + T('Shivendra Singh').id + '/request-details', { to: 'js@gov.test', items: ['topic'], preview: true });
check('a person can still write to one by hand, with the envelope', r.status === 200 && r.json.preview === true);
check('once a talk has everything, it is never written to again', !talkMails().slice(before).some(x => x.Recipients.To[0] === 'amritesh@phoebetal.test'));

// ---- a failed send ----
const W2 = await talksWorld({ times: true });
W2.db.run("UPDATE innovation_talks SET speaker_email = 'fail@x.test' WHERE speaker_name = 'Vineet Upadhayay'");
await W2.as('POST', '/api/admin/innovation-talks/auto', { on: true });
at('2026-11-13', '11:00');
W2.setMailDown(true);
r = await W2.hit('POST', '/api/cron/tick', {}, { Authorization: 'Bearer ' + ADMIN });
check('mail service down: an error, nothing counted, nothing recorded on the talk', r.json.talk_requests.sent === 0 && !!r.json.talk_requests.error
  && !W2.rows("SELECT value FROM app_settings WHERE key = 'italk_auto_log'").some(x => /"n":1/.test(x.value)) && !W2.talk("speaker_name = 'Vineet Upadhayay'").details_requested_at, r.json.talk_requests);
W2.setMailDown(false);
r = await W2.hit('POST', '/api/cron/tick', {}, { Authorization: 'Bearer ' + ADMIN });
check('the next minute it goes', r.json.talk_requests.sent === 1 && W2.sent.filter(x => x.Recipients.To[0] === 'fail@x.test').length === 1);

// ---- the switch, and who may use it ----
r = await W.as('POST', '/api/admin/innovation-talks/auto', { on: false });
await tick();
check('turned off: it stops at once', r.json.on === false && (await tick()).json.talk_requests.on === false);
check('no password: the switch and the summary are refused', (await W.hit('POST', '/api/admin/innovation-talks/auto', { on: true })).status === 401 && (await W.hit('GET', '/api/admin/innovation-talks/auto')).status === 401);
check('no clock password: the tick is refused', (await W.hit('POST', '/api/cron/tick', {})).status === 401);
r = await W.as('POST', '/api/admin/innovation-talks/' + T('Vineet Upadhayay').id + '/request-details', { to: 'v@p99.test', items: ['company'], preview: true });
check('"company name" can be asked for by hand too', r.status === 200 && /Your company name, as it should be shown/.test(r.json.html));
done();
