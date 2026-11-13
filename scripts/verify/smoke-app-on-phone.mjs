// "Save the app on your phone" (13 Nov 2026), on the built worker and real SQLite
// (login-world.mjs), with Elastic Email played and every message kept:
// - every email to a person carries the block once, above the unsubscribe line,
//   sent and previewed alike, through sendAdminEmail and through a sender that
//   calls Elastic Email itself (the sign-in email);
// - none to the team (our own domain, the notification address in Settings, an
//   Organiser pass holder), none for Delhi 2027 or after the event (the survey is
//   marked), none once Day 2 is over;
// - the app counts the card's steps (home.*) and Admin's Overview card reads them;
// - /app carries the card and /app.js the sheet and the ?action=save-app link.
// The clock is pinned to 15 Nov 2026, then moved past the event. Run after `npm run build`.
import { makeWorld, checker, ADMIN, settle } from './login-world.mjs';

const realNow = Date.now;
const at = (iso) => { const t = Date.parse(iso); Date.now = () => t; };
at('2026-11-15T06:30:00Z');

const W = await makeWorld();
const { db, sent, hit, rows, as, to, html } = W;
const { check, fails } = checker();

const people = [
  [9101, 'asha@example.com', 'Asha Rao', 'Visitor Pass'],
  [9102, 'ravi@bharataiinnovation.com', 'Ravi Team', 'Visitor Pass'],
  [9103, 'desk.team@gmail.com', 'Desk Team', 'Visitor Pass'],
  [9104, 'meera.org@gmail.com', 'Meera Organiser', 'Organiser'],
];
for (const [id, email, name, badge] of people) {
  db.run("INSERT INTO attendees (id, event_id, name, email, mobile, badge_type, payment_status, company) VALUES (?, 1, ?, ?, ?, ?, 'paid', 'Rao Labs')",
    [id, name, email, '98200' + id, badge]);
}
db.run("INSERT INTO app_settings (key, value) VALUES ('inquiry_notify_email', 'desk.team@gmail.com')");

const MARK = 'data-app-on-phone="1"';
const count = (s, part) => s.split(part).length - 1;
const last = () => sent[sent.length - 1];
const mailTo = (email) => sent.filter(p => to(p) === email).pop();

// ---- 1. The sign-in email: a sender that calls Elastic Email itself ----
let r = await hit('POST', '/api/events/1/attendees/send-magic-link', { email: 'asha@example.com' });
await settle();
let m = mailTo('asha@example.com');
let h = html(m);
check('sign-in email: sent', r.status === 200 && !!m, r.status + ' ' + r.text.slice(0, 160));
check('sign-in email: the block once, before </body>', count(h, MARK) === 1 && h.indexOf(MARK) < h.toLowerCase().lastIndexOf('</body>'), 'marks ' + count(h, MARK));
check('sign-in email: the words and both phones', /Save the Bharat AI app on your phone/.test(h) && /Add to Home screen/.test(h) && /Add to Home Screen/.test(h) && /6-digit code/.test(h), h.slice(-1500));
check('sign-in email: "Show me how" opens the steps in the app', /href="https:\/\/bharataiinnovation\.com\/app\?action=save-app"[^>]*>Show me how</.test(h), '');
check('sign-in email: the code and the sign-in button are still there', /Sign In Now|Sign in/.test(h) && /\d{6}/.test(h), '');
check('the block names nothing that is not true: no "offline", no "no signal"', !/offline|no signal|without internet/i.test(h.slice(h.indexOf(MARK))), '');

// ---- 2. Through sendAdminEmail: the help steps by hand, with the unsubscribe line ----
const help = async (email) => {
  sent.length = 0;
  const res = await hit('POST', '/api/admin/help-mail/send', { email, topic: 'pass' }, ADMIN);
  await settle();
  return { res, h: html(mailTo(email)), m: mailTo(email) };
};
let o = await help('asha@example.com');
check('help steps to Asha: sent', o.res.status === 200 && !!o.m, o.res.status + ' ' + o.res.text.slice(0, 160));
check('help steps to Asha: the block once, above the unsubscribe line', count(o.h, MARK) === 1 && /Unsubscribe from event updates/.test(o.h) && o.h.indexOf(MARK) < o.h.indexOf('Unsubscribe from event updates'),
  'marks ' + count(o.h, MARK) + ' unsub at ' + o.h.indexOf('Unsubscribe from event updates') + ' block at ' + o.h.indexOf(MARK));
for (const [email, why] of [['ravi@bharataiinnovation.com', 'our own domain'], ['desk.team@gmail.com', 'the notification address in Settings'], ['meera.org@gmail.com', 'an Organiser pass holder']]) {
  o = await help(email);
  check('help steps to ' + why + ': sent without the block', o.res.status === 200 && !!o.m && count(o.h, MARK) === 0, o.res.status + ' marks ' + count(o.h, MARK));
}

// ---- 3. Previews show what is sent ----
r = await hit('GET', '/api/admin/help-mail/preview?topic=pass&email=asha%40example.com', undefined, ADMIN);
check('help steps preview for Asha: the block once', r.status === 200 && count(r.json?.html || '', MARK) === 1, r.status + ' ' + count(r.json?.html || '', MARK));
r = await hit('GET', '/api/admin/help-mail/preview?topic=pass&email=ravi%40bharataiinnovation.com', undefined, ADMIN);
check('help steps preview for the team: no block', r.status === 200 && count(r.json?.html || '', MARK) === 0, r.status + ' ' + count(r.json?.html || '', MARK));
r = await hit('GET', '/api/admin/notify-preview?id=9101', undefined, ADMIN);
let ph = r.json?.html || '';
check('account-ready preview: the block once, above the unsubscribe line', r.status === 200 && count(ph, MARK) === 1 && ph.indexOf(MARK) < ph.indexOf('Unsubscribe from event updates'), r.status + ' ' + r.text.slice(0, 160));

// ---- 4. After the event: the survey is marked, never the block ----
sent.length = 0;
r = await hit('POST', '/api/admin/feedback/test', { to: 'asha@example.com' }, ADMIN);
await settle();
m = mailTo('asha@example.com');
check('survey test email: sent, marked, no block', r.status === 200 && !!m && count(html(m), MARK) === 0 && html(m).includes('data-app-on-phone="off"'), r.status + ' ' + r.text.slice(0, 160));

// ---- 5. Delhi 2027: its sign-in email gets none (its passes are not in this app) ----
db.run("INSERT INTO events (id, title, start_date, end_date) VALUES (2, 'Bharat AI Delhi', '2027-07-28', '2027-07-29')");
db.run("INSERT INTO attendees (id, event_id, name, email, mobile, badge_type, payment_status, company) VALUES (9201, 2, 'Kiran Shah', 'kiran@example.com', '9820077777', 'Delegate Pass', 'paid', 'Shah AI')");
sent.length = 0;
r = await hit('POST', '/api/events/2/attendees/send-magic-link', { email: 'kiran@example.com' });
await settle();
m = mailTo('kiran@example.com');
check('Delhi 2027: no app sign-in, so no email and no block', m ? count(html(m), MARK) === 0 : r.status === 404, r.status + ' ' + r.text.slice(0, 120));

// ---- 6. The app counts the card; Admin reads it ----
r = await hit('POST', '/api/attendees/9101/track-step', { kind: 'home', step: 'shown' }, as(9101));
check('track-step home.shown: counted', r.status === 200 && rows('home.shown', 9101).length === 1, r.status + ' ' + r.text);
r = await hit('POST', '/api/attendees/9101/track-step', { kind: 'home', step: 'opened' }, as(9101));
check('track-step home.opened: counted', r.status === 200 && rows('home.opened', 9101).length === 1, r.status + ' ' + r.text);
r = await hit('POST', '/api/attendees/9101/track-step', { kind: 'home', step: 'photo_fail' }, as(9101));
check('track-step: a pass step under home is refused', r.status === 400, String(r.status));
r = await hit('POST', '/api/attendees/9101/track-step', { kind: 'card', step: 'shown' }, as(9101));
check('track-step: a home step under card is refused', r.status === 400, String(r.status));
r = await hit('POST', '/api/attendees/9102/track-step', { kind: 'home', step: 'shown' }, as(9101));
check("track-step: nobody counts another person's step", r.status === 401 || r.status === 403, String(r.status));
r = await hit('GET', '/api/admin/help-stats', undefined, ADMIN);
const by = Object.fromEntries((r.json?.steps || []).map(s => [s.action, Number(s.people)]));
check('Admin help-stats: home.shown and home.opened, one person each', r.status === 200 && by['home.shown'] === 1 && by['home.opened'] === 1, JSON.stringify(by));

// ---- 7. The page: the card on /app, the sheet and the link in /app.js, Admin's block ----
r = await hit('GET', '/app');
check('/app: the card under the pass, hidden until drawn', r.status === 200 && /id="app-phone-card"/.test(r.text) && /Save this app on your phone/.test(r.text), String(r.status));
const js = await hit('GET', '/app.js');
check('/app.js: the card, the sheet, the account menu line and ?action=save-app', ['function renderAppOnPhoneCard', 'function openAppOnPhoneSteps', "item('fa-mobile-alt', 'Save the app on my phone'", "pendingAction === 'save-app'", "'beforeinstallprompt'"].every(s => js.text.includes(s)), '');
const adminJs = await hit('GET', '/admin.js');
check('/admin.js: "The app saved on the phone" on the Overview card', adminJs.text.includes('The app saved on the phone') && adminJs.text.includes("by['home.opened']"), '');

// ---- 8. Once Day 2 is over: no block anywhere ----
at('2026-11-22T03:00:00Z');
o = await help('asha@example.com');
check('after the event: the help steps go without the block', o.res.status === 200 && !!o.m && count(o.h, MARK) === 0, o.res.status + ' marks ' + count(o.h, MARK));
r = await hit('GET', '/api/admin/help-mail/preview?topic=pass&email=asha%40example.com', undefined, ADMIN);
check('after the event: the preview has none either', r.status === 200 && count(r.json?.html || '', MARK) === 0, String(r.status));

Date.now = realNow;
console.log(fails() ? `\n${fails()} FAILED` : '\nall passed');
process.exit(fails() ? 1 : 0);
