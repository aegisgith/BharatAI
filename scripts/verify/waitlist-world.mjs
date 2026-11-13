// A world for the free-pass waiting list checks (0056, 12 Nov 2026): the WHOLE built
// worker on real SQLite (sql.js) with the production schema and, unless asked not to,
// migration 0056 (which also turns the switch on); Elastic Email played here and every
// message kept. Built on login-world's makeWorld, so the sessions, the admin bearer and
// the cron bearer are the ones every other suite uses.
// Used by unit-, smoke- and system-waitlist.mjs.
import { readFileSync } from 'node:fs';
import { makeWorld, ADMIN, CRON, settle } from './login-world.mjs';
export { ADMIN, CRON, settle };

// The organiser's words (12 Nov 2026), as the server carries them.
export const WAITLIST_TEXT = 'Free Visitor Passes are full for now. You are on the waiting list. If the wait list gets over, we will inform you.';
export const WAITLIST_UPSELL = 'Want to be sure of entry on both days? Get a Delegate Pass.';
export const WAITLIST_PROFILE_TEXT = 'While you wait, finish your profile: add your photo and your LinkedIn, and check your organisation, designation and city. We confirm places only for people who have finished their profile.';
export const DESK_TEXT = 'On the waiting list for a Free Visitor Pass: entry not confirmed. Do not admit on this pass. Send them to the registration desk for a Delegate Pass.';

export async function waitlistWorld({ migrate = true, on = null } = {}) {
  const W = await makeWorld();
  if (migrate) W.db.exec(readFileSync(new URL('../../migrations/0056_free_pass_waitlist.sql', import.meta.url), 'utf8'));
  if (on === false) W.db.run("UPDATE app_settings SET value = '0' WHERE key = 'free_pass_waitlist'");
  if (on === true) W.db.run("INSERT INTO app_settings (key, value) VALUES ('free_pass_waitlist', '1') ON CONFLICT(key) DO UPDATE SET value = '1'");
  let n = 0;
  // The free form on /register, as its own script posts it.
  const register = (over = {}) => {
    n++;
    return W.hit('POST', '/api/events/1/attendees/register', {
      name: 'Asha Rao', company: 'Rao Labs', job_title: 'Founder', city: 'Pune', industry: 'Software & SaaS', badge_type: 'Visitor Pass',
      email: 'asha' + n + '@gmail.com', mobile: '+91 98200 ' + String(20000 + n), registration_source: 'website', bio: '', interests: '', linkedin_url: '', ...over,
    });
  };
  const setSwitch = (v) => W.hit('PUT', '/api/admin/settings', { free_pass_waitlist: v ? '1' : '0' }, ADMIN);
  // A row written straight into the table, the way imports and the desk make them.
  const person = (id, extra = {}) => {
    const row = { id, event_id: 1, name: 'Person ' + id, email: 'p' + id + '@example.com', mobile: '98100' + String(id).padStart(5, '0'), company: 'Co ' + id,
      job_title: 'Director', badge_type: 'Visitor Pass', payment_status: 'paid', main_event: 1, ...extra };
    const cols = Object.keys(row);
    W.db.run(`INSERT INTO attendees (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map(k => (row[k] === undefined ? null : row[k])));
    return id;
  };
  const row = (id) => W.q('SELECT * FROM attendees WHERE id = ?', id)[0] || null;
  const admin = (method, path, body) => W.hit(method, path, body, ADMIN);
  const token = async (id) => (await admin('GET', '/api/my-pass-token?id=' + id)).json?.token || '';
  const scan = async (id) => (await admin('POST', '/api/staff/scan', { token: await token(id) })).json;
  const mailTo = (email) => W.sent.filter(m => (m.Recipients?.To || []).includes(email));
  const body = (m) => String(m?.Content?.Body?.[0]?.Content || '');
  return { ...W, register, setSwitch, person, row, admin, token, scan, mailTo, body };
}
