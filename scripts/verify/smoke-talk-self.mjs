// Integration: a speaker's own talk page through the WHOLE built worker on real SQLite
// (talk-self-world.mjs), 12 Nov 2026. The page, the link opening its talk and no other,
// an expired or altered link, what a save writes and what it never touches, refusals in
// plain words, the audit log, a photo, and the same before 0052.
// Run after `npm run build`:  node scripts/verify/smoke-talk-self.mjs
import { makeWorld, tokenMaker } from './talk-self-world.mjs';

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 400))); if (!ok) fails++; };
const T = await tokenMaker();
const now = Math.floor(Date.now() / 1000);
const link = (id, exp = now + 86400) => T.signTalkToken('h', id, exp); // the harness's SESSION_SECRET is 'h'

{
  const W = await makeWorld();
  const page = await W.call('GET', '/app/my-talk?t=x');
  check('the page answers under the app, holds no data and is kept out of search', page.status === 200 && /talk-self\.js/.test(page.text) && !/Sushil/.test(page.text) && page.headers.get('x-robots-tag') === 'noindex' && /no-store/.test(page.headers.get('cache-control') || ''), page.status);

  const tok7 = await link(7);
  let r = await W.call('GET', '/api/talk-self/' + tok7);
  check('the link opens its talk: name, company, topic', r.status === 200 && r.json.talk.speaker_name === 'Sushil Sani' && r.json.talk.company === 'Trust3 AI' && r.json.talk.topic === 'Trust3AI Security Governance', r.json);
  check('it says what is still missing', r.json.talk.missing.join() === 'speaker_title,speaker_photo_url,speaker_bio,speaker_phone', r.json.talk.missing);
  check('"To be announced" reads as no time yet', r.json.talk.when === '');
  check('it never shows an email address, who was asked, or the team’s notes', !/@|Team only/.test(r.text), r.text.slice(0, 300));
  check('nobody keeps a copy on the way', /no-store/.test(r.headers.get('cache-control') || ''));
  r = await W.call('GET', '/api/talk-self/' + (await link(8)));
  check('another link opens the other talk, with both hall names', r.json.talk.speaker_name === 'Dr. Vishal Deo' && r.json.talk.where.startsWith('Homi J. Bhabha Hall (Peacock Hall') && r.json.talk.when.startsWith('Fri 20 Nov'), r.json.talk);

  const tampered = tok7.replace(/^7\./, '8.');
  r = await W.call('GET', '/api/talk-self/' + tampered);
  check('a link changed to another talk is refused, with what to do', r.status === 404 && /Open it again from the email/.test(r.json.error), r);
  r = await W.call('PUT', '/api/talk-self/' + tampered, { topic: 'Hijacked' });
  check('...and cannot write either', r.status === 404 && W.rows('SELECT topic FROM innovation_talks WHERE id = 8')[0].topic === 'PrAImaan');
  r = await W.call('GET', '/api/talk-self/' + (await link(7, now - 60)));
  check('an expired link says so and how to get a new one', r.status === 410 && r.json.expired && /expired/.test(r.json.error), r);
  r = await W.call('GET', '/api/talk-self/' + (await link(99)));
  check('a link to a talk taken off the programme says so', r.status === 404 && /no longer on the programme/.test(r.json.error), r);

  // ---- a save ----
  r = await W.call('PUT', '/api/talk-self/' + tok7, { speaker_title: 'Engineering Manager', speaker_bio: 'Sushil leads engineering at Trust3 AI.', speaker_phone: '+91 98200 12345',
    speaker_name: 'Someone Else', hall: 'Raman Theatre', starts_at: '2026-11-20 09:00', speaker_email: 'evil@x.test', status: 'cancelled', notes: '' });
  let row = W.rows('SELECT * FROM innovation_talks WHERE id = 7')[0];
  check('a save writes what the speaker sent', r.status === 200 && row.speaker_title === 'Engineering Manager' && row.speaker_bio === 'Sushil leads engineering at Trust3 AI.' && row.speaker_phone === '+919820012345', row);
  check('...and never the name, hall, time, email, status or notes', row.speaker_name === 'Sushil Sani' && row.hall === '' && row.starts_at === null && row.speaker_email === 'sushil@trust3.ai' && row.status === 'confirmed' && row.notes === 'Team only: chase via Sandeep', row);
  check('the tab can see when the speaker last changed it', !!row.details_updated_at);
  check('the answer says what is still missing (the photo)', r.json.talk.missing.join() === 'speaker_photo_url' && r.json.changed.length === 3, r.json);
  const a = W.rows("SELECT * FROM admin_audit WHERE action = 'innovation_talk.self_update' ORDER BY id DESC LIMIT 1")[0];
  check('the change is in the audit log, by the speaker’s own link', a && /Sushil Sani \(own link\)/.test(a.actor) && a.actor_kind === 'speaker-link' && /speaker_title/.test(a.detail), a);

  const bad = async (body, field, words) => {
    const x = await W.call('PUT', '/api/talk-self/' + tok7, body);
    check(`refused, ${field}: says so and names the box`, x.status === 400 && x.json.field === field && String(x.json.error).includes(words), x.json);
  };
  await bad({ speaker_phone: '98200' }, 'speaker_phone', 'at least 10 digits');
  await bad({ speaker_bio: 'Visit https://evil.example' }, 'speaker_bio', 'plain text');
  await bad({ topic: 'x'.repeat(201) }, 'topic', 'at most 200');
  check('a refused save changes nothing', W.rows('SELECT speaker_phone FROM innovation_talks WHERE id = 7')[0].speaker_phone === '+919820012345');
  r = await W.call('PUT', '/api/talk-self/' + tok7, { company: '' });
  check('the company cannot be blanked from a link', W.rows('SELECT company FROM innovation_talks WHERE id = 7')[0].company === 'Trust3 AI', r.json);

  // ---- what the organisers typed never blocks the speaker (the page sends every box) ----
  W.db.run("UPDATE innovation_talks SET speaker_bio = ?, speaker_phone = ?, showcase = ? WHERE id = 8", ['y'.repeat(760) + ' more at https://icmr.example', '98200 11111 / 98200 22222', 'z'.repeat(900)]);
  const tok8 = await link(8);
  const before8 = W.rows('SELECT * FROM innovation_talks WHERE id = 8')[0];
  r = await W.call('PUT', '/api/talk-self/' + tok8, { topic: before8.topic, speaker_title: 'Scientist-D', company: before8.company, speaker_bio: before8.speaker_bio, speaker_phone: before8.speaker_phone, showcase: before8.showcase });
  const after8 = W.rows('SELECT * FROM innovation_talks WHERE id = 8')[0];
  check('a speaker changing one box saves, even with a long bio, a link and two numbers the organisers typed', r.status === 200 && after8.speaker_title === 'Scientist-D' && r.json.changed.join() === 'speaker_title', r.json);
  check('...and those boxes are left exactly as the organisers wrote them', after8.speaker_bio === before8.speaker_bio && after8.speaker_phone === before8.speaker_phone && after8.showcase === before8.showcase);
  r = await W.call('PUT', '/api/talk-self/' + tok8, { speaker_bio: before8.speaker_bio + ' Also see https://two.example' });
  check('if they change that bio, it is checked like any other', r.status === 400 && r.json.field === 'speaker_bio', r.json);

  // ---- a photo ----
  const jpeg = 'data:image/jpeg;base64,' + Buffer.alloc(5000, 9).toString('base64');
  r = await W.call('POST', '/api/talk-self/' + tok7 + '/photo', { image: jpeg });
  const url = r.json?.speaker_photo_url || '';
  check('a photo is stored and the talk points at it', r.status === 200 && /^\/api\/uploads\/talks\/7-\d+\.jpg$/.test(url) && W.rows('SELECT speaker_photo_url FROM innovation_talks WHERE id = 7')[0].speaker_photo_url === url, r);
  check('...and anyone can load it, like every speaker photo', (await W.call('GET', url)).status === 200);
  r = await W.call('POST', '/api/talk-self/' + tok7 + '/photo', { image: jpeg });
  check('a new photo replaces the old file instead of leaving it behind', r.status === 200 && W.bucket.size === 1, [...W.bucket.keys()]);
  r = await W.call('POST', '/api/talk-self/' + tok7 + '/photo', { image: 'data:text/html;base64,PHNjcmlwdD4=' });
  check('only a photo is accepted', r.status === 400);
  r = await W.call('POST', '/api/talk-self/' + tampered + '/photo', { image: jpeg });
  check('an altered link cannot change the photo', r.status === 404);
  r = await W.call('GET', '/api/talk-self/' + tok7);
  check('with everything in, nothing is missing', r.json.talk.missing.length === 0, r.json.talk.missing);
  check('nothing was emailed by any of this', W.sent.length === 0);
}

{
  // ---- the "a few details we need" email now sends them to their own page ----
  const W = await makeWorld();
  const admin = { headers: { Authorization: 'Bearer h-admin', 'X-Admin-Actor': 'Harness' } };
  let r = await W.call('POST', '/api/admin/innovation-talks/7/request-details', { to: 'sushil@trust3.ai', items: ['speaker_title', 'speaker_photo_url', 'speaker_bio', 'speaker_phone'], to_speaker: true, preview: true }, admin);
  const html = r.json?.html || '';
  const href = (html.match(/href="([^"]*\/app\/my-talk\?t=[^"]+)"/) || [])[1] || '';
  check('the email’s preview has the speaker’s own link', r.status === 200 && /\/app\/my-talk\?t=7\.\d+\.[0-9a-f]{32}$/.test(href.replace(/&amp;/g, '&')), href || r.json);
  check('...and asks them to add the details themselves, with a reply only as the fallback', /Add my details/.test(html) && /Please add them yourself/.test(html) && /Just reply to this email with the details instead/.test(html) && !/please reply to this email with:/.test(html));
  check('...the subject says so', r.json.subject === 'Your Innovation Talk at Bharat AI Innovation 2026: please add your details', r.json.subject);
  check('...the photo is chosen on the page, so it no longer says "attach it to your reply"', /A clear photo of you/.test(html) && !/attach it to your reply/.test(html));
  check('...and the preview sent nothing', W.sent.length === 0);
  const tokenInMail = href.replace(/&amp;/g, '&').split('t=')[1];
  r = await W.call('GET', '/api/talk-self/' + tokenInMail);
  check('the link in the email opens that talk', r.status === 200 && r.json.talk.speaker_name === 'Sushil Sani', r.json);
  r = await W.call('POST', '/api/admin/innovation-talks/7/request-details', { to: 'ashwini@trust3.ai', items: ['speaker_bio'], to_speaker: false, preview: true }, admin);
  check('to a booth contact: pass it on, the button works for whoever opens it', /pass this on to them: the button below works for whoever opens it/.test(r.json.html) && /Add the details/.test(r.json.html) && r.json.subject === 'Innovation Talk by Sushil Sani: please add the details', r.json.subject);
  r = await W.call('GET', '/api/admin/innovation-talks/auto/preview?event_id=1', undefined, admin);
  check('the automatic email can be previewed: who it goes to next, the subject, the link', r.status === 200 && (r.json.none || (/my-talk\?t=/.test(r.json.html) && r.json.to && /please add/.test(r.json.subject))), r.json);
  check('...and previewing it sends nothing', W.sent.length === 0);
  r = await W.call('GET', '/api/admin/innovation-talks/auto/preview?event_id=1');
  check('only an admin can preview it', r.status === 401 || r.status === 403, r.status);
}

{
  const W = await makeWorld({ with0052: false });
  const tok = await link(7);
  const r = await W.call('PUT', '/api/talk-self/' + tok, { speaker_title: 'Engineering Manager', speaker_phone: '+919820012345' });
  check('before 0052 a save still keeps the rest (there is no mobile column yet)', r.status === 200 && W.rows('SELECT speaker_title FROM innovation_talks WHERE id = 7')[0].speaker_title === 'Engineering Manager', r.json || r.text);
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
