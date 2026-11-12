// System: one speaker from the email to a complete talk, on the WHOLE built worker and
// real SQLite (talk-self-world.mjs), 12 Nov 2026. The team sends "please add your
// details" for real (not a preview); the link is read out of the email that went; the
// speaker opens it and fills in everything, photo included; the Innovation Talks tab
// then shows nothing missing, the automatic email no longer counts them, and the
// public talk list carries what they wrote.
// Run after `npm run build`:  node scripts/verify/system-talk-self.mjs
import { makeWorld } from './talk-self-world.mjs';

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 400))); if (!ok) fails++; };
const W = await makeWorld();
const admin = { headers: { Authorization: 'Bearer h-admin', 'X-Admin-Actor': 'Harness' } };

let r = await W.call('GET', '/api/admin/innovation-talks/auto?event_id=1', undefined, admin);
const dueBefore = r.json.due;
check('before: Asha Rao is due an automatic email', dueBefore >= 1 && r.json.next.some(n => n.speaker === 'Asha Rao'), r.json);

r = await W.call('POST', '/api/admin/innovation-talks/9/request-details', { to: 'asha@example.test', items: ['topic', 'speaker_title', 'speaker_photo_url', 'speaker_bio', 'speaker_phone'], to_speaker: true }, admin);
check('the team sends the email for real', r.status === 200 && W.sent.length === 1, r.json);
const mail = JSON.stringify(W.sent[0]);
const m = mail.match(/\/app\/my-talk\?t=(9\.\d+\.[0-9a-f]{32})/);
check('the email that went has her own link and the button', !!m && /Add my details/.test(mail) && /please add your details/.test(mail), mail.slice(0, 300));
const tok = m ? m[1] : '';

r = await W.call('GET', '/api/talk-self/' + tok);
check('the link opens her talk with everything missing', r.status === 200 && r.json.talk.speaker_name === 'Asha Rao' && r.json.talk.missing.join() === 'topic,speaker_title,speaker_photo_url,speaker_bio,speaker_phone', r.json.talk);
r = await W.call('PUT', '/api/talk-self/' + tok, { topic: 'Agents that close the books', speaker_title: 'Founder & CEO', speaker_bio: 'Asha founded Example Labs to automate finance operations.', speaker_phone: '9820011111', showcase: 'A live month-end close in eight minutes.' });
check('she saves her details', r.status === 200 && r.json.talk.missing.join() === 'speaker_photo_url', r.json);
r = await W.call('POST', '/api/talk-self/' + tok + '/photo', { image: 'data:image/jpeg;base64,' + Buffer.alloc(6000, 3).toString('base64') });
check('and her photo', r.status === 200 && /^\/api\/uploads\/talks\/9-/.test(r.json.speaker_photo_url), r.json);

r = await W.call('GET', '/api/events/1/innovation-talks', undefined, admin); // the tab reads this list, with more for an admin
const list = Array.isArray(r.json) ? r.json : (r.json?.talks || r.json?.results || []);
const t9 = list.find(t => Number(t.id) === 9);
check('the Innovation Talks tab now has all she sent', t9 && t9.speaker_title === 'Founder & CEO' && (t9.speaker_phone === undefined || t9.speaker_phone === '9820011111') && /Example Labs to automate/.test(t9.speaker_bio) && /^\/api\/uploads\/talks\/9-/.test(t9.speaker_photo_url), t9);
r = await W.call('GET', '/api/admin/innovation-talks/auto?event_id=1', undefined, admin);
check('the automatic email no longer counts her: nothing is missing', !r.json.next.some(n => n.speaker === 'Asha Rao') && r.json.due === dueBefore - 1, r.json);
r = await W.call('GET', '/api/events/1/innovation-talks');
const pub = (Array.isArray(r.json) ? r.json : (r.json?.talks || [])).find(t => t.speaker_name === 'Asha Rao');
check('attendees see her title and topic in the app’s talk list', pub && pub.topic === 'Agents that close the books', pub);
check('the public list never carries her mobile or email', !JSON.stringify(r.json || {}).includes('9820011111') && !JSON.stringify(r.json || {}).includes('asha@example.test'));
const audit = W.rows("SELECT action, actor FROM admin_audit WHERE entity_id = '9' OR entity_id = 9 ORDER BY id").map(a => a.action + ' by ' + a.actor);
check('the audit log tells the story: asked by the team, filled in by her own link', audit.some(a => /request_details by Harness/.test(a)) && audit.some(a => /self_update by Asha Rao \(own link\)/.test(a)) && audit.some(a => /self_photo by Asha Rao/.test(a)), audit);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
