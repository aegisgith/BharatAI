// Integration: the automatic missing-details email to Innovation Talk speakers (12 Nov
// 2026), on the whole built worker and real SQLite with the 49 real talks, with this
// process's clock moved. The rules: off until switched on; one email a minute from the
// minute clock; only inside the sending hours (9 am to 9 pm India); only to a talk with
// something missing and an address to write to; nobody asked twice within 48 hours,
// by hand or by itself; three times at most; a failed send is not counted; company
// name is asked for like the rest; the switch, its summary and who may use it.
// Added the night of 12 Nov after the go-check: every government official is held back;
// a hand email from before the button existed does not start the wait; an exhibitor's
// hidden draft is never written to; two clocks send one email; "Ask everyone" and the
// clock never write twice within half an hour; a failed send waits an hour and gives up
// after three; a part of a name must be six letters; nothing by itself once the event begins.
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
check("a company's own Company Secretary is not, nor a CEO", flag('Saurabh Singh') === false && flag('Amritesh Kumar') === false && flag('Dipak Zope') === false);
// Every government official too (organiser, later on 12 Nov 2026): the four on the real
// list that the Minister/Secretary words did not catch.
check('an IFS officer, an IAS officer and two from the Principal Scientific Adviser\'s office are held back too',
  flag('Shri Vivek Khandekar (IFS)') === true && flag('Dr. Kunal Khemnar (IAS)') === true && flag('Srinivas Kancharla') === true && flag('Prashant Mehra') === true,
  ['Shri Vivek Khandekar (IFS)', 'Dr. Kunal Khemnar (IAS)', 'Srinivas Kancharla', 'Prashant Mehra'].map(n => [n, flag(n)]));
const OFFICIALS = ['Divyanshi Saxena', 'Ganesh Nagarajan', 'Hon’ble Shri Test Mantri', 'Shivendra Singh', 'Shri Vivek Khandekar (IFS)', 'Dr. Kunal Khemnar (IAS)', 'Srinivas Kancharla', 'Prashant Mehra'];

// ---- off ----
let r = await W.as('GET', '/api/admin/innovation-talks/auto?event_id=1');
check('off until someone turns it on, and it says who would get one', r.status === 200 && r.json.on === false && r.json.due === 3 && r.json.every_hours === 48 && r.json.max === 3, r.json);
check('the summary names the government officials left for a person, and does not count them', r.json.held.map(h => h.speaker).sort().join() === OFFICIALS.slice().sort().join() && !r.json.next.some(n => /Shivendra|Divyanshi|Mantri/.test(n.speaker)), r.json.held);
check('before the event the summary does not say it has stopped', r.json.closed === false, r.json.closed);
// Dr. K. Mahesh (Secretary, Delhi) left the talk list on 13 Nov 2026.
check('the real government Deputy Secretary on the talk list is among them (Ganesh Nagarajan), and Dr. K. Mahesh is gone', r.json.held.some(h => h.speaker === 'Ganesh Nagarajan') && !r.json.held.some(h => h.speaker === 'Dr. K. Mahesh'));
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
check('through every tick, over ten days, no government official was written to',!talkMails().some(x => /@gov\.test$/.test(x.Recipients.To[0])), talkMails().map(x => x.Recipients.To[0]));
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
// A second speaker with an address: a failed send must not hold them up.
W2.db.run("UPDATE innovation_talks SET speaker_email = 'next@x.test' WHERE speaker_name = 'Amritesh Kumar'");
r = await W2.hit('POST', '/api/cron/tick', {}, { Authorization: 'Bearer ' + ADMIN });
check('the next minute the next speaker goes; the failed one is not tried again at once', r.json.talk_requests.sent === 1 && W2.sent.filter(x => x.Recipients.To[0] === 'next@x.test').length === 1 && W2.sent.filter(x => x.Recipients.To[0] === 'fail@x.test').length === 0, r.json.talk_requests);
at('2026-11-13', '12:01');
r = await W2.hit('POST', '/api/cron/tick', {}, { Authorization: 'Bearer ' + ADMIN });
check('an hour later the failed one goes', r.json.talk_requests.sent === 1 && W2.sent.filter(x => x.Recipients.To[0] === 'fail@x.test').length === 1, r.json.talk_requests);
// A long outage of the email service (the review of 119a24e): every hour each talk is
// tried again, and once the service is back everyone still gets their email.
const W2b = await talksWorld({ times: true });
W2b.db.run("UPDATE innovation_talks SET speaker_email = 'bounce@x.test' WHERE speaker_name = 'Vineet Upadhayay'");
await W2b.as('POST', '/api/admin/innovation-talks/auto', { on: true });
W2b.setMailDown(true);
for (const hhmm of ['11:00', '12:01', '13:02', '14:03', '15:04']) { at('2026-11-13', hhmm); await W2b.hit('POST', '/api/cron/tick', {}, { Authorization: 'Bearer ' + ADMIN }); }
const vid = String(W2b.talk("speaker_name = 'Vineet Upadhayay'").id);
let blog = JSON.parse(W2b.rows("SELECT value FROM app_settings WHERE key = 'italk_auto_log'")[0].value);
check('five hours of failed sends: each counted as a failure, none as sent', blog[vid].fails === 5 && blog[vid].n === 0 && W2b.sent.length === 0, blog[vid]);
r = await W2b.as('GET', '/api/admin/innovation-talks/auto?event_id=1');
check('the tab is told which sends are waiting, and what the email service said', r.json.failing.length === 1 && r.json.failing[0].fails === 5 && r.json.failing[0].error.length > 0, r.json.failing);
W2b.setMailDown(false);
at('2026-11-13', '16:05');
r = await W2b.hit('POST', '/api/cron/tick', {}, { Authorization: 'Bearer ' + ADMIN });
blog = JSON.parse(W2b.rows("SELECT value FROM app_settings WHERE key = 'italk_auto_log'")[0].value);
check('when the service is back, it goes: no speaker is given up on', r.json.talk_requests.sent === 1 && W2b.sent.length === 1 && blog[vid].n === 1 && !blog[vid].fails, [r.json.talk_requests, blog[vid]]);
r = await W2b.as('GET', '/api/admin/innovation-talks/auto?event_id=1');
check('...and the tab no longer lists it as waiting', r.json.failing.length === 0, r.json.failing);
// A send by hand that fails puts the talk back as it was (it is marked before it goes).
W2b.setMailDown(true);
const vBefore = W2b.talk("speaker_name = 'Vineet Upadhayay'").details_requested_at;
at('2026-11-15', '18:00');
r = await W2b.as('POST', '/api/admin/innovation-talks/' + vid + '/request-details', { to: 'bounce@x.test', items: ['topic'], again: true });
check('a hand send that fails leaves the talk as it was', r.status === 502 && W2b.talk("speaker_name = 'Vineet Upadhayay'").details_requested_at === vBefore, [r.status, vBefore, W2b.talk("speaker_name = 'Vineet Upadhayay'").details_requested_at]);
W2b.setMailDown(false);

// ---- 12 Nov 2026 night: what the go-check found before the switch went on ----
at('2026-11-13', '10:00');
const W3 = await talksWorld({ times: true });
const tick3 = () => W3.hit('POST', '/api/cron/tick', {}, { Authorization: 'Bearer ' + ADMIN });
const T3 = (name) => W3.talk('speaker_name = ?', name);
const mails3 = () => W3.sent.filter(x => /Innovation Talk/.test(x.Content.Subject));
const auto3 = async () => (await W3.as('GET', '/api/admin/innovation-talks/auto?event_id=1')).json;
// The team emailed 42 talks by hand at 15:50 IST on 12 Nov, before the email had the button.
W3.db.run("UPDATE innovation_talks SET speaker_email = 'before@x.test', details_requested_at = '2026-11-12 10:20:03', details_requested_to = 'before@x.test' WHERE speaker_name = 'Amritesh Kumar'");
// Asked by hand after the button went live (19:55 IST = 14:25 UTC): that one waits 48 hours.
W3.db.run("UPDATE innovation_talks SET speaker_email = 'after@x.test', details_requested_at = '2026-11-12 15:00:00', details_requested_to = 'after@x.test' WHERE speaker_name = 'Raveesh Dewan'");
// An exhibitor's stage-talk draft with no time: the tab hides it; its company has a sheet talk.
W3.db.run("INSERT INTO exhibitors (id, event_id, company_name, contact_email) VALUES (41, 1, 'Joget', 'spoc@joget.test')");
W3.db.run("INSERT INTO innovation_talks (event_id, exhibitor_id, company, speaker_name, status, speaker_email) VALUES (1, 41, 'Joget', 'Draft Speaker', 'confirmed', 'draft@joget.test')");
// A designation typed short.
W3.db.run("UPDATE innovation_talks SET speaker_email = 'jtsecy@gov.test', speaker_title = 'Jt. Secy., MeitY' WHERE speaker_name = 'Ankit Kumar'");
let s3 = await auto3();
check('a hand email from before the button existed does not start the wait: that speaker is due now', s3.next.some(n => n.speaker === 'Amritesh Kumar'), s3.next);
check('a hand email after the button existed does: that speaker waits 48 hours', !s3.next.some(n => n.speaker === 'Raveesh Dewan'), s3.next);
check("an exhibitor's hidden stage-talk draft is not due (the tab does not list it)", !s3.next.some(n => n.speaker === 'Draft Speaker') && s3.due === 1, [s3.due, s3.next]);
check('a short designation, "Jt. Secy.", is held back', s3.held.some(h => h.speaker === 'Ankit Kumar'), s3.held.map(h => h.speaker));
await W3.as('POST', '/api/admin/innovation-talks/auto', { on: true, event_id: 1 });
const both = await Promise.all([tick3(), tick3()]);
check('two clocks in the same minute: one email, not two', mails3().length === 1 && mails3()[0].Recipients.To[0] === 'before@x.test', [both.map(b => b.json.talk_requests), mails3().map(x => x.Recipients.To[0])]);
const h3 = mails3()[0]?.Content.Body[0].Content || '';
check('the email has the button, and does not promise the website', /my-talk\?t=/.test(h3) && !/on the website/.test(h3), h3.slice(0, 200));
check('...and thanks anyone who has already sent them', /Already sent them\? Thank you, and please ignore this email\./.test(h3));
W3.db.run("UPDATE innovation_talks SET starts_at = '2026-11-21 15:00' WHERE speaker_name = 'Draft Speaker'");
s3 = await auto3();
check('once that talk is given a time it is on the tab, and is asked like any other', s3.next.some(n => n.speaker === 'Draft Speaker'), s3.next);
W3.db.run("UPDATE innovation_talks SET starts_at = NULL WHERE speaker_name = 'Draft Speaker'");
// "Ask everyone" and the clock never write to one talk twice within half an hour.
const am3 = T3('Amritesh Kumar');
let g = await W3.as('POST', '/api/admin/innovation-talks/' + am3.id + '/request-details', { to: 'before@x.test', items: ['topic'] });
check('"Ask everyone" just after the clock wrote to them: refused in words, nothing sent', g.status === 409 && /^Asked .* ago, so not sent again\.$/.test(g.json.error) && mails3().length === 1, [g.status, g.json]);
g = await W3.as('POST', '/api/admin/innovation-talks/' + am3.id + '/request-details', { to: 'before@x.test', items: ['topic'], again: true });
check("the envelope on the row (again: a person's own choice) still sends", g.status === 200 && mails3().length === 2, [g.status, g.json]);
at('2026-11-13', '10:20');
g = await W3.as('POST', '/api/admin/innovation-talks/' + am3.id + '/request-details', { to: 'before@x.test', items: ['topic'] });
check('twenty minutes after a hand email: refused too', g.status === 409, [g.status, g.json]);
g = await W3.as('POST', '/api/admin/innovation-talks/' + am3.id + '/request-details', { to: 'before@x.test', items: ['topic'], preview: true });
check('a preview is never refused', g.status === 200 && g.json.preview === true, g.status);
at('2026-11-13', '10:31');
g = await W3.as('POST', '/api/admin/innovation-talks/' + am3.id + '/request-details', { to: 'before@x.test', items: ['topic'] });
check('after half an hour it sends', g.status === 200 && mails3().length === 3, [g.status, g.json]);
// A government official is refused on the server too, unless it is the envelope.
const gn = T3('Ganesh Nagarajan');
g = await W3.as('POST', '/api/admin/innovation-talks/' + gn.id + '/request-details', { to: 'gn@gov.test', items: ['speaker_bio'] });
check('"Ask everyone" to a government official is refused by the server, in words', g.status === 409 && g.json.protocol === true && /^A government official/.test(g.json.error), [g.status, g.json]);
g = await W3.as('POST', '/api/admin/innovation-talks/' + gn.id + '/request-details', { to: 'gn@gov.test', items: ['speaker_bio'], again: true });
check('the envelope on his row still writes to him', g.status === 200, [g.status, g.json]);
// "Ask everyone" with "already asked" unticked: any earlier ask counts, whatever the page shows.
const rd3 = T3('Raveesh Dewan');
g = await W3.as('POST', '/api/admin/innovation-talks/' + rd3.id + '/request-details', { to: 'after@x.test', items: ['speaker_bio'], fresh: true });
check('"Ask everyone" (not again) to a talk asked yesterday: refused, saying when', g.status === 409 && /^Asked already, on 2026-11-12 at 20:30, so not sent again\.$/.test(g.json.error), [g.status, g.json]);
// Once held, always held: the speaker's own page can change the company or designation.
const sk = T3('Srinivas Kancharla');
W3.db.run("UPDATE innovation_talks SET speaker_email = 'sk@x.test', company = 'Science Office' WHERE id = ?", [sk.id]);
s3 = await auto3();
const heldIds = JSON.parse(W3.rows("SELECT value FROM app_settings WHERE key = 'italk_held_ids'")[0]?.value || '[]');
check('an official whose company was changed stays held back (remembered by id)', heldIds.includes(sk.id) && s3.held.some(h => h.speaker === 'Srinivas Kancharla') && !s3.next.some(n => n.speaker === 'Srinivas Kancharla'), [heldIds, s3.held.map(h => h.speaker)]);
W3.db.run("UPDATE innovation_talks SET speaker_title = 'Scientist, O/o PSA' WHERE speaker_name = 'Aditi Saini'");
W3.db.run("UPDATE innovation_talks SET speaker_title = 'Adviser, NITI Aayog' WHERE speaker_name = 'Dr. Anand Deshpande'");
W3.db.run("UPDATE innovation_talks SET speaker_name = 'Shri R. Kumar, I.A.S.' WHERE speaker_name = 'Harshal Wakharkar'");
const F3 = (await W3.as('GET', '/api/admin/innovation-talks/contacts?event_id=1')).json.contacts;
check('"O/o PSA", "NITI Aayog" and "I.A.S." with dots are held back too', F3[T3('Aditi Saini').id].protocol === true && F3[T3('Dr. Anand Deshpande').id].protocol === true && F3[T3('Shri R. Kumar, I.A.S.').id].protocol === true);
// The team-list name match needs six letters for a part of a name.
W3.db.run("INSERT INTO exhibitors (id, event_id, company_name, contact_email) VALUES (42, 1, 'OliAI', 'spoc@oli.test')");
W3.db.run("INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, email) VALUES (1, 42, 'Raj', '', 'raj@oli.test')");
W3.db.run("INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, email) VALUES (1, 42, 'Selva', 'Soorya', 'selva@oli.test')");
const C3 = (await W3.as('GET', '/api/admin/innovation-talks/contacts?event_id=1')).json.contacts;
check('a colleague called Raj is not taken for the speaker Aravind Raj (the booth contact is used)', C3[T3('Aravind Raj').id].email === 'spoc@oli.test' && C3[T3('Aravind Raj').id].source === 'booth', C3[T3('Aravind Raj').id]);
check('a full name still finds its own address on the team list', C3[T3('Selva Soorya').id].email === 'selva@oli.test' && C3[T3('Selva Soorya').id].source === 'team', C3[T3('Selva Soorya').id]);
// Nothing goes by itself from the event's first day.
at('2026-11-19', '20:30');
let r3 = await tick3();
check('the evening before the event it still sends', r3.json.talk_requests.sent === 1, r3.json.talk_requests);
at('2026-11-20', '09:30');
const n3 = mails3().length;
r3 = await tick3();
check('from the first day of the event nothing goes by itself', r3.json.talk_requests.sent === 0 && r3.json.talk_requests.waiting === 'the event has begun' && mails3().length === n3, r3.json.talk_requests);
s3 = await auto3();
check('...and the tab is told so', s3.closed === true && s3.due === 0, [s3.closed, s3.due]);
g = await W3.as('POST', '/api/admin/innovation-talks/' + am3.id + '/request-details', { to: 'before@x.test', items: ['topic'], again: true });
check('a person can still write by hand during the event', g.status === 200, g.status);

// ---- the switch, and who may use it ----
r = await W.as('POST', '/api/admin/innovation-talks/auto', { on: false });
await tick();
check('turned off: it stops at once', r.json.on === false && (await tick()).json.talk_requests.on === false);
check('no password: the switch and the summary are refused', (await W.hit('POST', '/api/admin/innovation-talks/auto', { on: true })).status === 401 && (await W.hit('GET', '/api/admin/innovation-talks/auto')).status === 401);
check('no clock password: the tick is refused', (await W.hit('POST', '/api/cron/tick', {})).status === 401);
r = await W.as('POST', '/api/admin/innovation-talks/' + T('Vineet Upadhayay').id + '/request-details', { to: 'v@p99.test', items: ['company'], preview: true });
check('"company name" can be asked for by hand too', r.status === 200 && /Your company name, as it should be shown/.test(r.json.html));
done();
