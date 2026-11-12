// Integration: the Media & Influencer Pass (12 Nov 2026) through the built worker on real
// SQLite with the production schema (inquiry-world.mjs: email played, clock at 10:00 in
// India on 12 Nov 2026). The page; every refusal, matching the page's own checks
// (public/js/media-pass.js run in node:vm) box for box; a stored request with its answers
// in metadata; the two emails; the same address again; the rate limit and the hidden box;
// the admin list, its count and its guard; approve (a new person, a Visitor raised, a paid
// VIP kept, an unpaid Delegate raised, a Speaker kept, a mobile someone else holds left
// off, a contact-page request, one of our two passes moved to the other), the email and
// its sign-in link, approve twice, the email service down and the link sent again;
// decline with and without an email, and every refusal around it; the Inquiries desk
// still listing them. Run after `npm run build`.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { makeWorld, mail, mailTo, bodyOf, setMailDown, check, done } from './inquiry-world.mjs';

const W = makeWorld();
const { call, rows, insert, db } = W;
const sandbox = { URL, console }; sandbox.window = sandbox; vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL('../../public/js/media-pass.js', import.meta.url), 'utf8'), sandbox);
const pageCheck = sandbox.MediaPassForm._t.check;

let ipN = 0;
const freshIp = () => '10.0.0.' + (++ipN);
const apply = (body, ip = freshIp()) => call('/api/media-pass-application', { method: 'POST', body, ip });
const admin = (path, body) => call(path, body === undefined ? { admin: true, actor: 'Priya' } : { method: 'POST', body, admin: true, actor: 'Priya' });
const inq = (id) => rows('SELECT * FROM inquiries WHERE id = ?', [id])[0];
const att = (email) => rows('SELECT * FROM attendees WHERE lower(email) = ?', [email])[0];
const auditOf = (action, id) => rows("SELECT * FROM admin_audit WHERE action = ?" + (id == null ? '' : ' AND entity_id = ?') + ' ORDER BY id', id == null ? [action] : [action, String(id)]);
const clear = () => { mail.length = 0; };
const subj = (m) => m?.Content?.Subject || '';

const media = (o = {}) => ({ kind: 'media', name: 'Ravi Kumar', email: 'ravi@mumbainews.in', mobile: '+91 98200 11111', organisation: 'Mumbai News', designation: 'Senior Reporter', city: 'Mumbai',
  outlet: 'Mumbai News Online', beat: 'Technology', work_links: ['https://mumbainews.in/ai-story', 'www.mumbainews.in/second', ''], coverage: 'A story on AI in manufacturing and two interviews.', agree: true, website: '', ...o });
const infl = (o = {}) => ({ kind: 'influencer', name: 'Asha Rao', email: 'asha@creator.in', mobile: '9820012345', organisation: 'Asha Explains AI', designation: 'Creator', city: 'Pune',
  platforms: [{ platform: 'instagram', handle: '@asha.ai', followers: '45k' }, { platform: 'youtube', handle: 'https://www.youtube.com/@AshaExplains', followers: '1.2 lakh' }, { platform: 'linkedin', handle: '', followers: '' }, { platform: 'x', handle: '', followers: '' }, { platform: 'other', name: '', handle: '', followers: '' }],
  niche: 'AI explainers', audience: 'All India', formats: ['reels', 'live', 'stories'], before: 'A reel saying I will be there.', during: 'Live stories from the expo floor.', after: '', samples: ['www.instagram.com/reel/abc', 'https://youtu.be/xyz', ''], collabs: 'Two app launches', agree: true, website: '', ...o });

// ---------------------------------------------------------------- the page
let r = await call('/media-pass');
check('GET /media-pass is a page with the form', r.status === 200 && /<form class="mp-card" id="mp-form" novalidate>/.test(r.text) && /<h1>Media &amp; Influencer Pass<\/h1>/.test(r.text), r.status);
check('the page loads its own script, and has no script of its own beyond the site menu\'s one line', /<script src="\/js\/media-pass\.js\?v=\d+" defer><\/script>/.test(r.text) && (r.text.match(/<script>/g) || []).length === 1);
check('the page says the 2 working days and nothing more', /We review every request and reply by email within 2 working days\./.test(r.text) && !/24 hours|within one working day/i.test(r.text));
check('the page asks the influencer questions: platforms with followers, the plan, samples', ['pf-instagram-handle', 'pf-youtube-followers', 'pf-other-name', 'mp-format-live', 'mp-before', 'mp-during', 'mp-after', 'mp-sample-1', 'mp-collabs'].every((id) => r.text.includes('id="' + id + '"')));
check('the page asks the media questions: publication, beat, work links, plan', ['mp-outlet', 'mp-beat', 'mp-work-1', 'mp-work-3', 'mp-coverage'].every((id) => r.text.includes('id="' + id + '"')));
check('inputs are 16px and tap targets at least 50px (no zoom on a phone)', /font-size:16px;line-height:1\.4;min-height:50px/.test(r.text) && /\.mp-btn\{[^}]*min-height:54px/.test(r.text));
check('nothing is chosen until they choose, and both parts start hidden', !/id="mp-kind-media" checked|id="mp-kind-influencer" checked/.test(r.text) && /id="mp-media" hidden/.test(r.text) && /id="mp-influencer" hidden/.test(r.text));
r = await call('/media-pass?as=influencer');
check('?as=influencer opens on the influencer part', /id="mp-kind-influencer" checked/.test(r.text) && /<section class="mp-part" id="mp-influencer">/.test(r.text) && /id="mp-media" hidden/.test(r.text));
r = await call('/media-pass?as=<script>');
check('?as= with anything else opens on nothing', r.status === 200 && !/ checked/.test(r.text.slice(r.text.indexOf('mp-kind-box'), r.text.indexOf('About you'))));

// ---------------------------------------------------------------- refusals
r = await call('/api/media-pass-application', { method: 'POST', body: 'x' });
check('a body that is not a form is refused in words', r.status === 400 && /fill in the form/.test(r.json?.error || ''));
const refusals = [
  ['no kind', media({ kind: '' }), 'kind'], ['a kind of its own', media({ kind: 'celebrity' }), 'kind'],
  ['no name', media({ name: ' ' }), 'name'], ['a bad email', media({ email: 'ravi@' }), 'email'],
  ['a short mobile', media({ mobile: '12345' }), 'mobile'], ['no organisation', media({ organisation: '' }), 'organisation'],
  ['no designation', media({ designation: '' }), 'designation'], ['no city', media({ city: 'M' }), 'city'],
  ['media: no publication', media({ outlet: '' }), 'outlet'], ['media: no beat', media({ beat: '' }), 'beat'],
  ['media: no work link', media({ work_links: ['', '', ''] }), 'work_1'], ['media: a bad work link', media({ work_links: ['https://a.in/1', 'javascript:alert(1)'] }), 'work_2'],
  ['media: a short plan', media({ coverage: 'AI' }), 'coverage'], ['media: not agreed', media({ agree: false }), 'agree'], ['agree as a word', media({ agree: 'true' }), 'agree'],
  ['influencer: no platform', infl({ platforms: [] }), 'platforms'],
  ['influencer: followers in words', infl({ platforms: [{ platform: 'instagram', handle: '@a', followers: 'many' }] }), 'pf-instagram-followers'],
  ['influencer: no followers', infl({ platforms: [{ platform: 'x', handle: '@a', followers: '' }] }), 'pf-x-followers'],
  ['influencer: followers, no handle', infl({ platforms: [{ platform: 'youtube', handle: '', followers: '900' }] }), 'pf-youtube-handle'],
  ['influencer: a bad profile link', infl({ platforms: [{ platform: 'linkedin', handle: 'https://link edin.com', followers: '900' }] }), 'pf-linkedin-handle'],
  ['influencer: another platform with no name', infl({ platforms: [{ platform: 'other', name: '', handle: 'https://blog.in', followers: '10' }] }), 'pf-other-name'],
  ['influencer: no topic', infl({ niche: '' }), 'niche'], ['influencer: no audience', infl({ audience: '' }), 'audience'],
  ['influencer: nothing to make', infl({ formats: [] }), 'formats'], ['influencer: no plan', infl({ before: '', during: 'x', after: '' }), 'before'],
  ['influencer: no sample', infl({ samples: [] }), 'sample_1'], ['influencer: a bad sample', infl({ samples: ['https://ok.in', 'data:text/html,x'] }), 'sample_2'],
];
const before = rows('SELECT COUNT(*) AS n FROM inquiries')[0].n;
for (const [n, body, field] of refusals) {
  r = await apply(body);
  const page = pageCheck(JSON.parse(JSON.stringify(body)));
  check(`refused: ${n} (400, at ${field}, the same box and words as the page)`, r.status === 400 && r.json?.field === field && page && page.field === field && page.error === r.json.error, { server: r.json, page });
}
r = await apply(media({ email: 'ravi@gmail.con' }));
check('a mistyped email host is caught by the server, with the right address offered', r.status === 400 && r.json.field === 'email' && /ravi@gmail\.com/.test(r.json.error), r.json);
check('nothing refused was stored, and no email went', rows('SELECT COUNT(*) AS n FROM inquiries')[0].n === before && mail.length === 0, mail.length);

r = await apply(infl({ website: 'http://spam.example' }));
check('the hidden box filled in: thanked, nothing stored, nothing sent', r.status === 200 && r.json.ok && !r.json.id && rows('SELECT COUNT(*) AS n FROM inquiries')[0].n === before && mail.length === 0);

// ---------------------------------------------------------------- a request stored
r = await apply(infl(), '10.9.9.1');
const ashaId = r.json?.id;
check('an influencer request is taken: 200, its reference, the 2 working days', r.status === 200 && r.json.ok && r.json.ref === 'BHAI-INQ-' + String(ashaId).padStart(5, '0') && /2 working days/.test(r.json.message), r.json);
let q = inq(ashaId), meta = JSON.parse(q.metadata);
check('stored as a media enquiry, new, with the subject the desk reads', q.inquiry_type === 'media' && q.status === 'new' && q.subject === 'Media & Influencer Pass: Influencer - Asha Explains AI' && q.email === 'asha@creator.in' && q.phone === '9820012345' && q.organization === 'Asha Explains AI', q);
check('metadata: the kind, the form, designation and city', meta.source === 'media_pass_form' && meta.kind === 'influencer' && meta.designation === 'Creator' && meta.city === 'Pune' && !!meta.agreed_at);
check('metadata: platforms with numbers for followers, in all', meta.platforms.length === 2 && meta.platforms[0].followers === 45000 && meta.platforms[1].followers === 120000 && meta.followers_total === 165000, meta.platforms);
check('metadata: www. links gain https://, empty ones dropped', meta.samples.length === 2 && meta.samples[0] === 'https://www.instagram.com/reel/abc' && meta.platforms[1].handle === 'https://www.youtube.com/@AshaExplains');
check('metadata: what they will make and when, brand work', meta.formats.join() === 'reels,stories,live' && /reel saying/.test(meta.before) && /Live stories/.test(meta.during) && meta.after === '' && meta.collabs === 'Two app launches', meta.formats);
check('the words for the desk carry the platforms and followers', /Platforms: Instagram @asha\.ai \(45,000 followers\); YouTube https:\/\/www\.youtube\.com\/@AshaExplains \(1,20,000 followers\)/.test(q.message) && /Followers in all: 1,65,000/.test(q.message), q.message);
let me = mailTo('asha@creator.in'), team = mailTo('team@bharataiinnovation.com');
check('the applicant gets a copy from our sender, no unsubscribe footer', me.length === 1 && subj(me[0]) === 'We have your Influencer Pass request - Bharat AI Innovation 2026' && !/Unsubscribe from event updates/.test(bodyOf(me[0])), me.map(subj));
check('...it says the 2 working days, the reference, the answers, and to tag us', /We review every request and reply by email within 2 working days\./.test(bodyOf(me[0])) && bodyOf(me[0]).includes(r.json.ref) && /Reels or Shorts/.test(bodyOf(me[0])) && /@bharataiinnovation\.ai/.test(bodyOf(me[0])));
check('the team is told at the address in Settings, with the followers in the subject', team.length === 1 && subj(team[0]) === 'New Influencer Pass request: Asha Rao (Asha Explains AI, 1,65,000 followers)', team.map(subj));
check('...with every answer, the links clickable, and the way to Admin', /href="https:\/\/www\.instagram\.com\/reel\/abc"/.test(bodyOf(team[0])) && /Live stories from the expo floor/.test(bodyOf(team[0])) && /href="https:\/\/bharataiinnovation\.com\/admin#media"/.test(bodyOf(team[0])));
check('the request is in the history as from the public form', auditOf('media-pass.applied', ashaId).length === 1 && auditOf('media-pass.applied', ashaId)[0].actor === 'public form');

clear();
r = await apply(infl({ niche: 'AI for small business' }), '10.9.9.1');
check('the same address again while waiting: the same request takes the newest answers', r.status === 200 && r.json.id === ashaId && r.json.updated === true && JSON.parse(inq(ashaId).metadata).niche === 'AI for small business' && rows("SELECT COUNT(*) AS n FROM inquiries WHERE lower(email) = 'asha@creator.in'")[0].n === 1);
check('...both are told it is an update', /updated/i.test(subj(mailTo('asha@creator.in')[0])) && /^Updated Influencer Pass request/.test(subj(mailTo('team@bharataiinnovation.com')[0])));

clear();
r = await apply(media(), '10.9.9.2');
const raviId = r.json?.id;
q = inq(raviId); meta = JSON.parse(q.metadata);
check('a media request: its subject names the publication, its links and plan stored', r.status === 200 && q.subject === 'Media & Influencer Pass: Media - Mumbai News Online' && meta.kind === 'media' && meta.beat === 'Technology' && meta.work_links.join() === 'https://mumbainews.in/ai-story,https://www.mumbainews.in/second' && /manufacturing/.test(meta.coverage) && meta.platforms.length === 0);
check('...the copy says Media Pass, with "a"', subj(mailTo('ravi@mumbainews.in')[0]) === 'We have your Media Pass request - Bharat AI Innovation 2026' && /applying for a <strong>Media Pass<\/strong>/.test(bodyOf(mailTo('ravi@mumbainews.in')[0])));

// A hostile name reaches the team as text.
clear();
db.run("DELETE FROM app_settings WHERE key = 'inquiry_notify_email'");
r = await apply(media({ name: '<img src=x onerror=alert(1)>Mal', email: 'mal@evil.example', organisation: '<b>Evil</b> Co', work_links: ['https://evil.example/"><script>alert(1)</script>'] }), '10.9.9.3');
const malBody = bodyOf(mailTo('info@bharataiinnovation.com')[0]);
check('with no team address set, the team email goes to info@', mailTo('info@bharataiinnovation.com').length === 1, mail.map((m) => m.Recipients.To));
check('a hostile name and link reach the team as text', r.status === 200 && (!/<img src=x/.test(malBody) && !/<script>alert/.test(malBody) && /&lt;img src=x/.test(malBody)), r.status + ' ' + malBody.slice(0, 200));
db.run("INSERT INTO app_settings (key, value) VALUES ('inquiry_notify_email', 'team@bharataiinnovation.com')");

// The rate limit: five requests an hour from one connection.
let codes = [];
for (let i = 0; i < 6; i++) codes.push((await apply(media({ email: `burst${i}@news.in`, mobile: '98200 2000' + i }), '10.7.7.7')).status);
check('a sixth request in an hour from one connection is refused, in words', codes.join() === '200,200,200,200,200,429', codes);
r = await apply(media({ email: 'burst9@news.in' }), '10.7.7.8');
check('...another connection is not held back', r.status === 200);
const burstIds = rows("SELECT id FROM inquiries WHERE email LIKE 'burst%' ORDER BY id").map((x) => x.id);

// ---------------------------------------------------------------- the admin list
r = await call('/api/admin/media-pass');
check('the admin list needs the admin password', r.status === 401);
check('...so does the count', (await call('/api/admin/media-pass/count')).status === 401);
check('...and approve and decline', (await call('/api/admin/media-pass/' + ashaId + '/approve', { method: 'POST', body: {} })).status === 401 && (await call('/api/admin/media-pass/' + ashaId + '/decline', { method: 'POST', body: {} })).status === 401);
check('...and nothing changed', inq(ashaId).status === 'new' && !att('asha@creator.in'));

// Seed: a contact-page media enquiry, and people who already hold passes.
const legacyId = insert('inquiries', { event_id: 1, inquiry_type: 'media', name: 'Old Press', email: 'press@daily.in', phone: '9000000001', organization: 'Daily', subject: 'Media Pass for 20th Nov', message: 'I am a YouTube creator', metadata: '{}', status: 'new', created_at: W.ago(30) });
insert('inquiries', { event_id: 1, inquiry_type: 'speaking', name: 'Not Media', email: 'talk@x.in', subject: 'Talk', message: 'x', metadata: '{}' });
insert('attendees', { event_id: 1, name: 'Vip Person', email: 'vip@paid.in', badge_type: 'VIP Pass', payment_status: 'paid', role: 'attendee', lunch_inclusion: 'Yes' });
insert('attendees', { event_id: 1, name: 'Visitor Person', email: 'visitor@free.in', badge_type: 'Visitor Pass', payment_status: 'paid', role: 'attendee', lunch_inclusion: 'No', main_event: 0, company: '', job_title: '' });
insert('attendees', { event_id: 1, name: 'Unpaid Person', email: 'unpaid@pending.in', badge_type: 'Delegate Pass', payment_status: 'pending', role: 'attendee' });
insert('attendees', { event_id: 1, name: 'Spk Person', email: 'speaker@talks.in', badge_type: 'Speaker', payment_status: 'waived', role: 'Speaker' });
insert('attendees', { event_id: 1, name: 'Media Already', email: 'mediaalready@x.in', badge_type: 'Media Pass', payment_status: 'waived', role: 'Media', lunch_inclusion: 'Yes' });
insert('attendees', { event_id: 1, name: 'Mobile Holder', email: 'holder@x.in', badge_type: 'Visitor Pass', mobile: '+91 98111 22222' });

const ids = {};
for (const [k, b] of Object.entries({
  vip: media({ name: 'Vip Person', email: 'VIP@paid.in' }), visitor: media({ name: 'Visitor Person', email: 'visitor@free.in' }),
  unpaid: infl({ name: 'Unpaid Person', email: 'unpaid@pending.in' }), speaker: media({ name: 'Spk Person', email: 'speaker@talks.in' }),
  moveto: infl({ name: 'Media Already', email: 'mediaalready@x.in' }), held: infl({ name: 'New Creator', email: 'newcreator@x.in', mobile: '98111 22222' }),
  quiet: media({ name: 'Quiet Approve', email: 'quiet@x.in' }), down: infl({ name: 'Down Mail', email: 'down@x.in' }),
  no1: media({ name: 'Decline Mail', email: 'no1@x.in' }), no2: infl({ name: 'Decline Quiet', email: 'no2@x.in' }), no3: media({ name: 'Decline Down', email: 'no3@x.in' }),
})) { r = await apply(b); ids[k] = r.json?.id; if (r.status !== 200) console.log('seed failed', k, r.status, r.json); }

r = await admin('/api/admin/media-pass');
const list = r.json?.rows || [];
check('the list: every media request and no other type, newest first', r.status === 200 && r.json.ok && list.length === rows("SELECT COUNT(*) AS n FROM inquiries WHERE inquiry_type = 'media'")[0].n && list.every((x) => x.id !== undefined) && list[list.length - 1].id === legacyId && !list.some((x) => x.email === 'talk@x.in'), list.length);
check('the counts by state', r.json.counts.new === list.length && r.json.counts.approved === 0 && r.json.counts.all === list.length, r.json.counts);
check('the labels the screen uses come from the server', r.json.labels.platforms.youtube === 'YouTube' && r.json.labels.formats.reels === 'Reels or Shorts' && r.json.labels.passes.influencer === 'Influencer Pass');
const lrow = (id) => list.find((x) => x.id === id);
check('a form request carries its answers, kind and reference', lrow(ashaId).kind === 'influencer' && lrow(ashaId).from_form && lrow(ashaId).answers.followers_total === 165000 && lrow(ashaId).answers.platforms[0].handle === '@asha.ai' && lrow(ashaId).ref.startsWith('BHAI-INQ-'));
check('a contact-page request has no answers, its words kept', lrow(legacyId).answers === null && lrow(legacyId).kind === '' && lrow(legacyId).message === 'I am a YouTube creator');
check('the pass each person holds now, and who would keep theirs', lrow(ids.vip).keeps_pass === 'VIP Pass' && lrow(ids.visitor).keeps_pass === '' && lrow(ids.visitor).attendee.badge_type === 'Visitor Pass' && lrow(ids.unpaid).keeps_pass === '' && lrow(ids.unpaid).attendee.unpaid === true && lrow(ids.speaker).keeps_pass === 'Speaker' && lrow(ashaId).attendee === null);
r = await admin('/api/admin/media-pass/count');
check('the sidebar count is every request waiting', r.status === 200 && r.json.new === list.length, r.json);

// ---------------------------------------------------------------- approve
clear();
r = await admin('/api/admin/media-pass/' + ashaId + '/approve', { note: 'See you at the media desk.' });
let a = att('asha@creator.in');
check('approve a new person: an Influencer Pass, made in the Add Attendee shape', r.status === 200 && r.json.ok && r.json.created && r.json.pass === 'Influencer Pass' && a && a.badge_type === 'Influencer Pass' && a.role === 'Influencer', r.json);
check('...lunch, the conference, no money asked, from the media pass form', a.lunch_inclusion === 'Yes' && a.main_event === 1 && a.payment_status === 'waived' && a.registration_source === 'media_pass' && a.event_id === 1);
check('...their details from the request', a.name === 'Asha Rao' && a.company === 'Asha Explains AI' && a.job_title === 'Creator' && a.city === 'Pune' && a.mobile === '9820012345' && a.country === 'India');
q = inq(ashaId); meta = JSON.parse(q.metadata);
check('...the request is Won (approved), with the note added and the decision recorded', q.status === 'won' && /\[approved .* by Priya\] Influencer Pass issued, emailed the pass link\. See you at the media desk\./.test(q.admin_notes) && meta.decision.state === 'approved' && meta.decision.pass === 'Influencer Pass' && meta.decision.by === 'Priya' && meta.decision.attendee_id === a.id, q.admin_notes);
check('...the history: media-pass.approved and attendee.create', auditOf('media-pass.approved', ashaId).length === 1 && JSON.parse(auditOf('media-pass.approved', ashaId)[0].detail).pass === 'Influencer Pass' && auditOf('attendee.create', a.id).length === 1);
me = mailTo('asha@creator.in');
const okBody = bodyOf(me[0]);
const tok = (okBody.match(/token=([0-9a-f]{64})/) || [])[1];
check('...the email: "Your Influencer Pass is approved", the note, the pass button with a sign-in link', me.length === 1 && subj(me[0]) === 'Your Influencer Pass is approved - Bharat AI Innovation 2026' && /See you at the media desk\./.test(okBody) && /\?email=asha%40creator\.in&amp;action=download-pass&amp;token=[0-9a-f]{64}|\?email=asha%40creator\.in&action=download-pass&token=[0-9a-f]{64}/.test(okBody) && !!tok, okBody.slice(0, 300));
r = await call('/api/events/1/attendees/login', { method: 'POST', body: { email: 'asha@creator.in', token: tok } });
check('...the link signs them in, as an Influencer Pass', r.status === 200 && r.json?.badge_type === 'Influencer Pass', r.status + ' ' + JSON.stringify(r.json).slice(0, 200));
r = await admin('/api/admin/media-pass/' + ashaId + '/approve', {});
check('approve twice: refused, nothing sent again', r.status === 409 && mailTo('asha@creator.in').length === 1 && rows("SELECT COUNT(*) AS n FROM attendees WHERE email = 'asha@creator.in'")[0].n === 1);

clear();
r = await admin('/api/admin/media-pass/' + ids.visitor + '/approve', {});
a = att('visitor@free.in');
check('a free Visitor Pass is raised to a Media Pass, role Media, lunch, the conference', r.json.pass === 'Media Pass' && !r.json.created && !r.json.kept && a.badge_type === 'Media Pass' && a.role === 'Media' && a.lunch_inclusion === 'Yes' && a.main_event === 1 && a.payment_status === 'waived', a);
check('...blank details filled in, the row not duplicated', a.company === 'Mumbai News' && a.job_title === 'Senior Reporter' && rows("SELECT COUNT(*) AS n FROM attendees WHERE email = 'visitor@free.in'")[0].n === 1 && auditOf('attendee.media-pass', a.id).length === 1);
check('...the email names the Media Pass', subj(mailTo('visitor@free.in')[0]) === 'Your Media Pass is approved - Bharat AI Innovation 2026');

clear();
r = await admin('/api/admin/media-pass/' + ids.vip + '/approve', {});
a = att('vip@paid.in');
check('a paid VIP Pass is never lowered: kept, paid, the request approved', r.status === 200 && r.json.kept && r.json.pass === 'VIP Pass' && a.badge_type === 'VIP Pass' && a.payment_status === 'paid' && a.role === 'attendee' && inq(ids.vip).status === 'won', r.json);
check('...the email says they keep it', subj(mailTo('vip@paid.in')[0]) === 'Your request is approved - Bharat AI Innovation 2026' && /You already hold a <strong>VIP Pass<\/strong>.*you keep it/.test(bodyOf(mailTo('vip@paid.in')[0])) && /\[approved .*\] keeps their VIP Pass/.test(inq(ids.vip).admin_notes));

r = await admin('/api/admin/media-pass/' + ids.unpaid + '/approve', {});
a = att('unpaid@pending.in');
check('a Delegate Pass chosen and never paid for is raised to the Influencer Pass, no money owed', r.json.pass === 'Influencer Pass' && a.badge_type === 'Influencer Pass' && a.payment_status === 'waived' && a.role === 'Influencer', a);
r = await admin('/api/admin/media-pass/' + ids.speaker + '/approve', {});
a = att('speaker@talks.in');
check('a Speaker keeps the Speaker pass', r.json.kept && a.badge_type === 'Speaker' && a.role === 'Speaker');
r = await admin('/api/admin/media-pass/' + ids.moveto + '/approve', {});
a = att('mediaalready@x.in');
check('one of our two passes moves to the other when the request says so (Media Pass to Influencer Pass)', r.json.pass === 'Influencer Pass' && a.badge_type === 'Influencer Pass' && a.role === 'Influencer');
r = await admin('/api/admin/media-pass/' + ids.held + '/approve', {});
a = att('newcreator@x.in');
check('a mobile someone else holds is left off; the pass is still issued', r.status === 200 && a.badge_type === 'Influencer Pass' && (a.mobile || '') === '' && att('holder@x.in').mobile === '+91 98111 22222', a);

clear();
r = await admin('/api/admin/media-pass/' + legacyId + '/approve', { kind: 'influencer' });
a = att('press@daily.in');
check('a contact-page request, issued as the pass chosen on the screen', r.status === 200 && a.badge_type === 'Influencer Pass' && a.company === 'Daily' && JSON.parse(inq(legacyId).metadata).decision.kind === 'influencer');

clear();
r = await admin('/api/admin/media-pass/' + ids.quiet + '/approve', { email: false });
check('approve with Email them unticked: the pass, no email, and the note says so', r.json.ok && r.json.emailed === false && mailTo('quiet@x.in').length === 0 && att('quiet@x.in').badge_type === 'Media Pass' && /not emailed/.test(inq(ids.quiet).admin_notes));

clear();
setMailDown(true);
r = await admin('/api/admin/media-pass/' + ids.down + '/approve', {});
setMailDown(false);
check('the email service down: the pass is still issued and the screen is told the email did not go', r.status === 200 && r.json.emailed === false && /played: the email service is down/.test(r.json.email_error) && att('down@x.in').badge_type === 'Influencer Pass' && /the email could not be sent/.test(inq(ids.down).admin_notes));
check('...and the screen row says so', r.json.row && r.json.row.state === 'approved' && r.json.row.decision.emailed === false);
r = await admin('/api/admin/media-pass/' + ids.down + '/resend', {});
check('Email the pass link again: sent, with a new sign-in link, and recorded', r.status === 200 && mailTo('down@x.in').length === 1 && /action=download-pass/.test(bodyOf(mailTo('down@x.in')[0])) && auditOf('media-pass.resent', ids.down).length === 1 && /pass link sent again/.test(inq(ids.down).admin_notes));
r = await admin('/api/admin/media-pass/' + ids.no1 + '/resend', {});
check('a request not approved has no link to send again', r.status === 409);

// ---------------------------------------------------------------- decline
clear();
r = await admin('/api/admin/media-pass/' + ids.no1 + '/decline', { email: true, note: 'We are full for media this year.' });
q = inq(ids.no1);
check('decline with Email them: Closed, the note, the history', r.status === 200 && q.status === 'closed' && /\[declined .* by Priya\] emailed a polite no\. We are full for media this year\./.test(q.admin_notes) && auditOf('media-pass.declined', ids.no1).length === 1 && JSON.parse(q.metadata).decision.state === 'declined');
const noMail = mailTo('no1@x.in');
check('...a short, polite email: thanks, not this time, the note, the passes', noMail.length === 1 && subj(noMail[0]) === 'Your Media Pass request - Bharat AI Innovation 2026' && /this time we are not able to offer you a pass/.test(bodyOf(noMail[0])) && /We are full for media this year\./.test(bodyOf(noMail[0])) && /href="https:\/\/bharataiinnovation\.com\/passes"/.test(bodyOf(noMail[0])));
check('...no pass is made for them', !att('no1@x.in'));
r = await admin('/api/admin/media-pass/' + ids.no2 + '/decline', {});
check('decline with Email them unticked: closed, nobody emailed', r.status === 200 && inq(ids.no2).status === 'closed' && mailTo('no2@x.in').length === 0 && /not emailed/.test(inq(ids.no2).admin_notes));
setMailDown(true);
r = await admin('/api/admin/media-pass/' + ids.no3 + '/decline', { email: true });
setMailDown(false);
check('decline when the email cannot go: nothing changes, and the screen is told why', r.status === 502 && /Not declined/.test(r.json.error) && inq(ids.no3).status === 'new');
check('decline twice: refused', (await admin('/api/admin/media-pass/' + ids.no1 + '/decline', {})).status === 409);
check('decline an approved request: refused, the pass stays', (await admin('/api/admin/media-pass/' + ashaId + '/decline', { email: true })).status === 409 && att('asha@creator.in').badge_type === 'Influencer Pass' && inq(ashaId).status === 'won');
clear();
r = await admin('/api/admin/media-pass/' + ids.no2 + '/approve', {});
check('a declined request may still be approved', r.status === 200 && att('no2@x.in').badge_type === 'Influencer Pass' && inq(ids.no2).status === 'won' && mailTo('no2@x.in').length === 1);
const other = rows("SELECT id FROM inquiries WHERE inquiry_type = 'speaking'")[0].id;
check('another type of enquiry is not this screen\'s to approve (404)', (await admin('/api/admin/media-pass/' + other + '/approve', {})).status === 404 && (await admin('/api/admin/media-pass/999999/decline', {})).status === 404);

// ---------------------------------------------------------------- after
r = await admin('/api/admin/media-pass');
const c2 = r.json.counts;
check('the counts follow the decisions (11 approved, 1 declined)', c2.approved === 11 && c2.declined === 1 && c2.new === c2.all - 12, c2);
const s2 = (await admin('/api/admin/media-pass/count')).json.new;
check('...and the sidebar count with them', s2 === c2.new, s2);
r = await admin('/api/admin/inquiries?type=media');
check('the Inquiries desk still lists them, Won and Closed among them', r.status === 200 && JSON.stringify(r.json).includes('Media & Influencer Pass: Influencer - Asha Explains AI'), r.status);
check('the burst: the five let through and the one from another connection were stored, one row each', burstIds.length === 6, burstIds);

done();
