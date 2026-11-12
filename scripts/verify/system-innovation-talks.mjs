// System check for the Innovation Talks tab (12 Nov 2026): one talk's whole journey
// across the parts that must agree, on the real built worker and real SQLite. The
// admin page's own code (lifted from /admin.js) drives the server, as the tab does.
//  1. the organiser's two files: migration 0052, then the talk times;
//  2. a talk with no time gets Day 2, a time and a hall from the admin form;
//  3. the tab finds its booth contact, says what is missing, and emails them for it;
//  4. the reply's details are typed in: the talk is complete;
//  5. the app's list shows it under its day with both hall names, and no private details;
//  6. "Announce" puts it in the app's announcements with the same words;
//  7. "Ask everyone" emails each speaker still missing something, once, skipping those
//     already asked unless told otherwise.
// Run after `npm run build`:  node scripts/verify/system-innovation-talks.mjs
import { talksWorld, checker } from './talks-world.mjs';
const { check, done } = checker();
const W = await talksWorld({ times: true });

// The admin page's code, talking to the real worker.
const fields = {};
const el = (id) => (fields[id] = fields[id] || { id, value: '', checked: false, textContent: '', style: {}, disabled: false, innerHTML: '', classList: { add() {}, remove() {} } });
const api = {
  get: async (u) => { const r = await W.as('GET', u); if (r.status >= 400) throw new Error(r.json?.error || 'HTTP ' + r.status); return r.json; },
  post: async (u, d) => { const r = await W.as('POST', u, d); if (r.status >= 400) throw new Error(r.json?.error || 'HTTP ' + r.status); return r.json; },
  patch: async (u, d) => { const r = await W.as('PATCH', u, d); if (r.status >= 400) throw new Error(r.json?.error || 'HTTP ' + r.status); return r.json; },
};
let announceOpened = 0;
const F = await W.adminTalkFunctions({
  api, badList: () => null, sectionLoading() {}, sectionError() {}, setTimeout: (fn) => fn(),
  openCreateAnnouncement: () => { announceOpened++; },
  document: { getElementById: (id) => (id === 'section-innovation' ? null : el(id)) },
});
const reload = async () => { await F.loadInnovationTalks(); return F.italkList; };
const form = (v) => ({ elements: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, { value: x }])) });
const formOf = (t, over = {}) => form({ speaker_name: t.speaker_name || '', speaker_title: t.speaker_title || '', company: t.company || '', topic: t.topic || '', hall: t.hall || '', status: t.status || 'confirmed', speaker_email: t.speaker_email || '', speaker_phone: t.speaker_phone || '', speaker_bio: t.speaker_bio || '', showcase: t.showcase || '', notes: t.notes || '', day: t.starts_at ? t.starts_at.slice(0, 10) : '', start: t.starts_at ? t.starts_at.slice(11, 16) : '', end: '', ...over });

// The booth list, as production has it: P99Soft's contact, nobody for most others.
W.db.run("INSERT INTO exhibitors (id, event_id, company_name, contact_email, booth_number) VALUES (21, 1, 'P99SOFT', 'spoc@p99soft.test', '69')");
W.db.run("INSERT INTO exhibitors (id, event_id, company_name, contact_email, booth_number) VALUES (22, 1, 'Joget INC', 'spoc@joget.test', '10')");

// ---- 1 + 2 ----
let list = await reload();
check('the tab loads all 48 talks, 21 with a time', list.length === 48 && list.filter(F.italkTimed).length === 21, list.length);
let t = list.find(x => x.speaker_name === 'Vineet Upadhayay');
check('P99Soft has no time yet: "time" is missing', t && F.italkMissing(t).indexOf('time') === 0, t && F.italkMissing(t));
const body = F.italkReadForm(formOf(t, { day: '2026-11-21', start: '12:00', end: '12:08', hall: 'Aryabhata Theatre' }), t);
await api.patch('/api/admin/innovation-talks/' + t.id, body);
list = await reload();
t = list.find(x => x.id === t.id);
check('the admin form gives it Sat 21 Nov · 12:00 – 12:08 PM in Aryabhata Theatre', t.time_slot === 'Sat 21 Nov · 12:00 – 12:08 PM' && t.hall === 'Aryabhata Theatre' && t.starts_at === '2026-11-21 12:00' && t.duration_min === 8, t);

// ---- 3 ----
const em = F.italkEmailFor(t);
check("the tab offers P99Soft's booth contact, and says it is one", em.email === 'spoc@p99soft.test' && em.source === 'booth', em);
const gaps = F.italkSpeakerGaps(t);
check('what P99Soft still owes: bio and mobile (topic, designation and photo are in)', JSON.stringify(gaps) === '["speaker_bio","speaker_phone"]', gaps);
await api.post('/api/admin/innovation-talks/' + t.id + '/request-details', { to: em.email, items: gaps, to_speaker: em.source !== 'booth', save_email: false });
const mail = W.sent[0]?.Content.Body[0].Content || '';
check('the booth contact gets one email from register@', W.sent.length === 1 && W.sent[0].Recipients.To[0] === 'spoc@p99soft.test' && /register@/.test(W.sent[0].Content.From));
check('it says the time and both hall names the tab shows', mail.includes('Sat 21 Nov · 12:00 – 12:08 PM') && mail.includes('Aryabhata Theatre (Expo Hall'));
check('it asks for exactly what the tab says is missing', /Two or three lines about you/.test(mail) && /Your mobile number/.test(mail) && !/The title of your talk/.test(mail) && !/Your designation/.test(mail));
list = await reload();
t = list.find(x => x.id === t.id);
check('the tab now shows when it was asked', !!t.details_requested_at && t.details_requested_to === 'spoc@p99soft.test');

// ---- 4 ----
const reply = F.italkReadForm(formOf(t, { speaker_bio: 'Leads AI at P99Soft.', speaker_phone: '+91 98200 33333', speaker_email: 'vineet@p99soft.test', end: '12:08' }), t);
check('the form sends only the three new details', reply && JSON.stringify(Object.keys(reply).sort()) === '["speaker_bio","speaker_email","speaker_phone"]', reply);
await api.patch('/api/admin/innovation-talks/' + t.id, reply);
list = await reload();
t = list.find(x => x.id === t.id);
check('nothing is missing any more', F.italkMissing(t).length === 0, F.italkMissing(t));
check("the speaker's own email now comes first", F.italkEmailFor(t).source === 'speaker' && F.italkEmailFor(t).email === 'vineet@p99soft.test');

// ---- 5 ----
const pub = (await W.hit('GET', '/api/events/1/innovation-talks')).json;
const p = pub.find(x => x.id === t.id);
check('the app list has it with its day, time and hall', p && p.starts_at === '2026-11-21 12:00' && p.time_slot === 'Sat 21 Nov · 12:00 – 12:08 PM' && p.hall === 'Aryabhata Theatre', p);
check("the app list does not carry the mobile, the email or the bio", !('speaker_phone' in p) && !('speaker_email' in p) && !('speaker_bio' in p));
const app = await W.pageBlock('/app.js', '// ==================== INNOVATION TALK & SHOWCASE ====================', '// ==================== INBOX ====================');
check("the app's tab names both halls (Aryabhata Theatre · Expo Hall) and lists by day", app.includes("'Aryabhata Theatre': 'Expo Hall'") && app.includes('Saturday 21 November') && !app.includes('10:00 – 11:30 AM'));

// ---- 6 ----
F.italkAnnounce(t.id);
check('Announce opens the Announcements form, filled in', announceOpened === 1 && /Aryabhata Theatre \(Expo Hall\)/.test(el('af-content').value));
await api.post('/api/admin/announcements', { event_id: 1, title: el('af-title').value, content: el('af-content').value, announcement_type: el('af-type').value, author_name: 'Event Team', pinned: false });
const anns = (await W.hit('GET', '/api/events/1/announcements')).json;
const ann = (Array.isArray(anns) ? anns : anns.announcements || []).find(a => /Innovation Talk:/.test(a.title));
check("the announcement is in the app's list with the time and both hall names", ann && ann.content.includes('Sat 21 Nov · 12:00 – 12:08 PM') && ann.content.includes('Aryabhata Theatre (Expo Hall)') && ann.title === 'Innovation Talk: AI Governance - Observability and Security', ann);

// ---- 7 ----
W.sent.length = 0;
await reload();
const expected = F.italkList.filter(x => x.status !== 'cancelled' && F.italkSpeakerGaps(x).length && F.italkEmailFor(x).email && !x.details_requested_at);
el('italk-all-again').checked = false;
await F.italkAskAllRun();
check('"Ask everyone" emails each speaker with something missing and an address, once', W.sent.length === expected.length && expected.length >= 1, [W.sent.length, expected.map(x => x.speaker_name)]);
check('it skipped P99Soft, complete and already asked', !W.sent.some(s => s.Recipients.To[0].includes('p99soft')));
check('Joget went to its booth contact, asking only what Joget is missing', W.sent.some(s => s.Recipients.To[0] === 'spoc@joget.test'));
check('the progress line says how many went', /sent/.test(el('italk-all-progress').textContent), el('italk-all-progress').textContent);
W.sent.length = 0;
await F.italkAskAllRun();
check('a second run sends nothing: everyone with an address was asked', W.sent.length === 0 && /asked already/.test(el('italk-all-progress').textContent), el('italk-all-progress').textContent);
el('italk-all-again').checked = true;
await F.italkAskAllRun();
// Since 12 Nov 2026 (night): never twice within half an hour, so Ask everyone and the
// minute clock cannot both write to one speaker minutes apart.
check('ticking "already asked" a minute later: nobody is written to twice within half an hour, and it says so', W.sent.length === 0 && /left out because they were asked already/.test(el('italk-all-progress').textContent), [W.sent.length, el('italk-all-progress').textContent]);
W.db.run("UPDATE innovation_talks SET details_requested_at = datetime('now', '-1 hour') WHERE details_requested_at IS NOT NULL");
await reload();
await F.italkAskAllRun();
check('ticking "already asked" an hour later sends them again', W.sent.length === expected.length, W.sent.length);
done();
