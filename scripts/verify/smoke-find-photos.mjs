// Built-worker checks for "Are you in the photos?" (23 Nov 2026, src/routes/find-photos.ts):
// who it is for (registered, not found in the photos, not unsubscribed, not opted out), the
// preview, one send with the sign-in link that opens their profile, the skips, and the bulk
// run of kind find_photos. Nothing is sent: the mail service is answered here.
// Run after `npm run build`:  node scripts/verify/smoke-find-photos.mjs
import { talksWorld, checker } from './talks-world.mjs';

const { db, rows, sent, hit, as, read } = await talksWorld({ seedTalks: false });
const { check, done } = checker();
const ATT = JSON.parse(read('src/data/attendee-photos.json'));
const foundId = Number(Object.keys(ATT.albums)[0].slice(1));
const add = (id, name, email, extra = '') => db.run(`INSERT INTO attendees (id, event_id, name, email, badge_type${extra ? ', unsubscribed_at' : ''}) VALUES (?, 1, ?, ?, 'Visitor Pass'${extra ? ', ?' : ''})`, extra ? [id, name, email, extra] : [id, name, email]);
add(990001, 'Neha Notfound', 'neha@example.com');
add(990002, 'Ravi Unsub', 'ravi@example.com', '2026-11-22 10:00:00');
add(990003, 'Opted Out', 'out@example.com');
add(foundId, 'Already Found', 'found@example.com');
db.run("INSERT INTO admin_audit (actor, actor_kind, action, entity, entity_id, detail) VALUES ('a990003', 'attendee', 'photos.opt_out', 'photo_album', 'a990003', '{}')");
const before = rows("SELECT COUNT(*) AS n FROM attendees WHERE event_id = 1 AND email IS NOT NULL AND TRIM(email) != ''")[0].n;

let r = await as('GET', '/api/admin/find-photos');
check('the preview: how many it is for (not found, not unsubscribed, not opted out) and the email', r.status === 200 && r.json?.audience === before - 3
  && r.json?.subject === 'Are you in the Bharat AI Innovation 2026 photos?' && /Add my photo/.test(r.json?.html || '') && /#preview/.test(r.json?.html || ''), JSON.stringify({ a: r.json?.audience, before }));
check('without admin it is refused', (await hit('GET', '/api/admin/find-photos')).status === 401, '');

r = await as('POST', '/api/admin/attendees/990001/send-find-photos', {});
const mail = sent[0];
const body = mail?.Content?.Body?.[0]?.Content || '';
check('one send: to them, the button signs them in at their profile', r.status === 200 && sent.length === 1 && JSON.stringify(mail.Recipients.To) === '["neha@example.com"]'
  && /action=complete-profile/.test(body) && /Dear Neha/.test(body), r.status + ' ' + JSON.stringify(r.json));
for (const [id, why] of [[990002, 'Unsubscribed'], [990003, 'Asked not to be matched'], [foundId, 'Already found']]) {
  r = await as('POST', `/api/admin/attendees/${id}/send-find-photos`, {});
  check(`skipped, not sent: ${why}`, r.status === 200 && r.json?.skipped === true && r.json?.reason.startsWith(why) && sent.length === 1, JSON.stringify(r.json));
}

r = await as('POST', '/api/admin/campaigns', { kind: 'find_photos', audience: 'not_found', title: 'Are you in the photos?' });
const camp = r.json?.campaign || r.json;
const ids = rows('SELECT attendee_id FROM campaign_recipients WHERE campaign_id = ?', [camp?.id]).map(x => x.attendee_id);
check('the bulk run takes exactly the people the preview counted', (r.status === 200 || r.status === 201) && ids.includes(990001) && !ids.includes(990002) && !ids.includes(990003) && !ids.includes(foundId), JSON.stringify({ status: r.status, n: ids.length }));
done();
