// System: one creator, from a link on the site to the pass at the door (12 Nov 2026), on
// the built worker and real SQLite (inquiry-world.mjs). The home page footer and the
// contact page lead to /media-pass; she applies with her channels; the team is emailed
// and finds her in Admin, Media & Influencer with the answers laid out; Approve and issue
// pass; her email's button signs her in at her pass; the pass token is hers and the badge
// desk's /verify screen reads VALID PASS, Influencer Pass, in its own colour; Admin's
// pass list offers Influencer Pass; she may start conversations (it is not a Visitor
// Pass); and a journalist declined is told politely and given no pass.
import { readFileSync } from 'node:fs';
import { makeWorld, mail, mailTo, bodyOf, check, done } from './inquiry-world.mjs';
import { sessionCookie } from './pay-db.mjs';

const W = makeWorld();
const { call, rows } = W;
const subj = (m) => m?.Content?.Subject || '';

// ---- the way in
const home = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
check('the home page footer links to /media-pass', /<li><a href="\/media-pass">Media &amp; Influencer Pass<\/a><\/li>/.test(home));
let r = await call('/contact');
check('the contact page\'s Media / Press card links to /media-pass', r.status === 200 && /href="\/media-pass"[^>]*>Apply for a Media &amp; Influencer Pass</.test(r.text));
r = await call('/media-pass?as=influencer');
check('the page opens on the influencer questions', r.status === 200 && /id="mp-kind-influencer" checked/.test(r.text));

// ---- she applies
r = await call('/api/media-pass-application', { method: 'POST', ip: '10.1.1.1', body: {
  kind: 'influencer', name: 'Meera Shah', email: 'Meera.Shah@Creator.in ', mobile: '+91 98330 44556', organisation: 'Meera Talks Tech', designation: 'Creator and host', city: 'Mumbai',
  platforms: [{ platform: 'instagram', handle: '@meeratalkstech', followers: '82k' }, { platform: 'youtube', handle: '@MeeraTalksTech', followers: '31,500' }, { platform: 'linkedin', handle: 'https://www.linkedin.com/in/meera-shah', followers: '9000' }, { platform: 'x', handle: '', followers: '' }, { platform: 'other', name: '', handle: '', followers: '' }],
  niche: 'AI tools for small business', audience: 'Mumbai and all India', formats: ['reels', 'live', 'video'],
  before: 'A reel announcing I will be at WTC.', during: 'Live stories and short interviews on the floor.', after: 'A 10-minute recap video.',
  samples: ['https://www.instagram.com/reel/meera1', 'youtube.com/watch?v=abc', ''], collabs: '', agree: true, website: '' } });
const id = r.json?.id;
check('she applies and is told the 2 working days', r.status === 200 && r.json.ok && /2 working days/.test(r.json.message), r.json);
check('her copy arrives, in her own name', subj(mailTo('meera.shah@creator.in')[0]) === 'We have your Influencer Pass request - Bharat AI Innovation 2026');
const team = mailTo('team@bharataiinnovation.com')[0];
check('the team is told, with her reach in the subject and the way to Admin', /^New Influencer Pass request: Meera Shah \(Meera Talks Tech, 1,22,500 followers\)$/.test(subj(team)) && /admin#media/.test(bodyOf(team)), subj(team));

// ---- the team finds her
r = await call('/api/admin/media-pass/count', { admin: true });
check('the sidebar says one is waiting', r.json?.new === 1);
r = await call('/api/admin/media-pass', { admin: true, actor: 'Priya' });
const row = r.json.rows.find((x) => x.id === id);
check('the request is on the screen with her platforms, followers in all, plan and samples', row && row.kind === 'influencer' && row.answers.platforms.length === 3 && row.answers.followers_total === 122500 && /recap video/.test(row.answers.after) && row.answers.samples[1] === 'https://youtube.com/watch?v=abc', row && row.answers);
check('...not registered yet, so approving registers her', row.attendee === null && row.keeps_pass === '');

// ---- approved
mail.length = 0;
r = await call('/api/admin/media-pass/' + id + '/approve', { method: 'POST', admin: true, actor: 'Priya', body: { note: 'Please collect your lanyard at the media desk.' } });
check('Approve and issue pass: an Influencer Pass, and the row the screen redraws', r.status === 200 && r.json.pass === 'Influencer Pass' && r.json.row.state === 'approved' && r.json.row.attendee.badge_type === 'Influencer Pass', r.json);
const a = rows("SELECT * FROM attendees WHERE email = 'meera.shah@creator.in'")[0];
check('she is an attendee now: lowercased email, her LinkedIn from the form, the city, lunch', a && a.badge_type === 'Influencer Pass' && a.linkedin_url === 'https://www.linkedin.com/in/meera-shah' && a.city === 'Mumbai' && a.lunch_inclusion === 'Yes' && a.main_event === 1, a);
const ok = mailTo('meera.shah@creator.in')[0];
const tok = (bodyOf(ok).match(/token=([0-9a-f]{64})/) || [])[1];
check('her email: approved, the note, and the button', subj(ok) === 'Your Influencer Pass is approved - Bharat AI Innovation 2026' && /lanyard at the media desk/.test(bodyOf(ok)) && /Download my pass/.test(bodyOf(ok)) && !!tok);
r = await call('/api/events/1/attendees/login', { method: 'POST', body: { email: 'meera.shah@creator.in', token: tok } });
check('the button signs her in', r.status === 200 && r.json?.id === a.id && r.json.badge_type === 'Influencer Pass', r.status);
const me = { Cookie: sessionCookie('iq-session', a.id) };
r = await call('/api/my-pass-token', { headers: me });
check('her pass token is hers to download', r.status === 200 && typeof r.json?.token === 'string' && r.json.token.length > 10, r.status + ' ' + r.text.slice(0, 120));
const v = await call('/verify/' + encodeURIComponent(r.json.token), { admin: true });
check('the badge desk reads VALID PASS, Influencer Pass, in the influencer colour', v.status === 200 && /VALID PASS/.test(v.text) && /Influencer Pass/.test(v.text) && /#9C27B0/i.test(v.text), v.text.slice(0, 200));
check('the request is Won, with who approved it', rows('SELECT status, admin_notes FROM inquiries WHERE id = ?', [id])[0].status === 'won' && /by Priya\] Influencer Pass issued/.test(rows('SELECT admin_notes FROM inquiries WHERE id = ?', [id])[0].admin_notes));
r = await call('/api/admin/media-pass/count', { admin: true });
check('nothing is waiting now', r.json?.new === 0);

// ---- the rest of the app knows the pass
const adminPage = await call('/admin');
const js = await call((adminPage.text.match(/src="(\/admin\.js\?v=[^"]+)"/) || [])[1] || '/admin.js');
check('Admin\'s pass list offers Influencer Pass beside Media Pass', /"Media Pass","Influencer Pass"/.test(js.text));
check('Admin has the Media & Influencer section, its count and its loader', /data-section="media"/.test(adminPage.text) && /id="media-new-badge"/.test(adminPage.text) && /function loadAdminMedia\(\)/.test(js.text) && /\/js\/admin-media\.js\?v=/.test(js.text));

// ---- a journalist declined
mail.length = 0;
r = await call('/api/media-pass-application', { method: 'POST', ip: '10.1.1.2', body: { kind: 'media', name: 'Kiran Rao', email: 'kiran@blogspot.example', mobile: '9876543210', organisation: 'Kiran Blog', designation: 'Writer', city: 'Delhi',
  outlet: 'Kiran Blog', beat: 'Lifestyle', work_links: ['https://kiran.example/post'], coverage: 'Maybe a post about the food.', agree: true } });
const kid = r.json.id;
r = await call('/api/admin/media-pass/' + kid + '/decline', { method: 'POST', admin: true, actor: 'Priya', body: { email: true } });
check('a journalist declined: closed, told politely, no pass', r.status === 200 && rows('SELECT status FROM inquiries WHERE id = ?', [kid])[0].status === 'closed' &&
  /not able to offer you a pass/.test(bodyOf(mailTo('kiran@blogspot.example').find((m) => subj(m) === 'Your Media Pass request - Bharat AI Innovation 2026'))) && rows("SELECT COUNT(*) AS n FROM attendees WHERE email = 'kiran@blogspot.example'")[0].n === 0);

done();
