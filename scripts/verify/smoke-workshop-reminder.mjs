// Integration: workshop emails through the WHOLE built worker on real SQLite
// (conference-world.mjs, the production schema), 15 Nov 2026. Who may call it; who is
// on the list (a workshop in the pass, not unpaid or refunded, an email address); the
// two kinds ("Choose your workshop" with no seat, "Your workshop" with one); a preview
// that mints no sign-in link and sends nothing; a send that signs them in at the seat
// picker and is logged; no second email of the same kind within 12 hours unless asked;
// closed and full workshops left out; names escaped; the panel's script on /admin.
// The switch cut-off is set far ahead or far behind, never read from today's date.
// Run after `npm run build`:  node scripts/verify/smoke-workshop-reminder.mjs
import { makeWorld } from './conference-world.mjs';
import { sessionCookie } from './pay-db.mjs';

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 500))); if (!ok) fails++; };

const W = await makeWorld({ migrated: true });
const tokens = () => W.rows('SELECT COUNT(*) AS n FROM login_tokens')[0].n;
const audits = () => W.rows("SELECT entity_id, detail FROM admin_audit WHERE action = 'workshop.reminder' ORDER BY id");
const list = async () => (await W.call('GET', '/api/admin/workshop-reminders')).json;
const send = (id, body = {}) => W.call('POST', `/api/admin/attendees/${id}/workshop-reminder`, body);
const closes = (v) => W.db.run("INSERT INTO app_settings (key, value) VALUES ('workshop_choice_closes', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [v]);
const html = (i) => String((W.sent[i] || {}).bodyHtml || (W.sent[i] || {}).body_html || JSON.stringify(W.sent[i] || {}));

// ---- the world ----
const ws = (id, slug, title, speaker, start, end, room, cap, open) => W.db.run(
  'INSERT INTO workshops (id, event_id, slug, title, speaker, summary, starts_at, ends_at, room, capacity, is_open, sort_order) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  [id, slug, title, speaker, '', start, end, room, cap, open, id]);
ws(1, 'ibm-workshop', 'AI, Trust and Evolving Skills using IBM Bob', 'KrishnaKanth Naik, Program Manager, IBM Career Education', '2037-11-20 11:30', '2037-11-20 13:00', 'Raman Theatre', 100, 1);
ws(2, 'fde-workshop', 'From Prototype to Production', 'Dr. Ashish Tendulkar', '2037-11-20 14:00', '2037-11-20 15:30', 'Raman Theatre', 100, 1);
ws(3, 'closed-one', 'A Closed Workshop', 'Someone', '2037-11-21 10:00', '2037-11-21 11:00', 'Raman Theatre', 100, 0);
ws(4, 'full-one', 'A Full Workshop', 'Someone Else', '2037-11-21 12:00', '2037-11-21 13:00', 'Raman Theatre', 1, 1);
const at = (id, name, email, badge, pay, company = 'Acme', event = 1) => W.db.run(
  'INSERT INTO attendees (id, event_id, name, email, company, job_title, badge_type, payment_status, main_event) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)',
  [id, event, name, email, company, 'CTO', badge, pay]);
at(101, 'Asha Rao', 'Asha@Example.test', 'VIP Pass', 'paid');                 // no seat: choose
at(102, 'Dr. Bina Shah', 'bina@example.test', 'Premium Delegate Pass', 'waived'); // IBM seat: seat
at(103, 'Chetan Visitor', 'chetan@example.test', 'Visitor Pass', 'free');        // no workshop in the pass
at(104, 'Deepa Unpaid', 'deepa@example.test', 'VIP Pass', 'pending');           // not paid yet
at(105, 'Esha Student', 'esha@example.test', 'Student Pass', 'paid');           // no seat: choose
at(106, 'Farhan Refund', 'farhan@example.test', 'VIP Pass', 'refunded');        // refunded
at(107, 'Gita Noemail', '', 'Premium Delegate Pass', 'paid');                   // no address
at(108, 'Hari Delhi', 'hari@example.test', 'VIP Pass', 'paid', 'Acme', 2);     // another event
at(109, '<b>Bad</b> Name', 'bad@example.test', 'VIP Pass', 'paid', '<img src=x onerror=alert(1)>'); // escaping
at(110, 'Full Seat Holder', 'full@example.test', 'VIP Pass', 'paid');           // takes the full one's only seat
W.db.run('INSERT INTO workshop_seats (event_id, attendee_id, workshop_id) VALUES (1, 102, 1), (1, 110, 4)');
closes('2099-01-01 00:00');

// ---- who may call it ----
let r = await W.call('GET', '/api/admin/workshop-reminders', undefined, { admin: false });
check('nobody but an admin reads the list', r.status === 401 || r.status === 403, r.status);
r = await W.call('POST', '/api/admin/attendees/101/workshop-reminder', {}, { admin: false });
check('nobody but an admin sends one', (r.status === 401 || r.status === 403) && W.sent.length === 0, r.status);

// ---- the list ----
let d = await list();
const ids = (d.people || []).map(p => p.id).sort((a, b) => a - b);
check('the list: workshop passes, paid or complimentary, with an email, this event only', JSON.stringify(ids) === JSON.stringify([101, 102, 105, 109, 110]), ids);
const p = (id) => d.people.find(x => x.id === id);
check('no seat: "choose"; a seat: "seat" with its title', p(101).kind === 'choose' && p(102).kind === 'seat' && p(102).workshop === 'AI, Trust and Evolving Skills using IBM Bob', [p(101), p(102)]);
check('counts by kind', d.counts.choose === 3 && d.counts.seat === 2, d.counts);
check('nobody emailed yet', d.people.every(x => x.last === null));
check('the cut-off and that switching is still open', d.closes === '2099-01-01 00:00' && d.can_switch === true, d);

// ---- previews ----
const t0 = tokens();
r = await send(101, { preview: true });
check('a "choose" preview: subject and address', r.status === 200 && r.json.kind === 'choose' && r.json.subject === 'Your pass includes a workshop: choose your seat' && r.json.to === 'Asha@Example.test', r.json);
const h1 = r.json.html || '';
check('it lists the open workshops with day, time and room by its event name', h1.includes('AI, Trust and Evolving Skills using IBM Bob') && h1.includes('From Prototype to Production') && h1.includes('Friday 20 November, 11:30 am to 1:00 pm') && h1.includes('Raman Theatre, First Floor, Centre One, World Trade Center, Mumbai') && !h1.includes('Centrum Hall B'), h1.slice(0, 400));
check('it leaves out the closed workshop and the full one', !h1.includes('A Closed Workshop') && !h1.includes('A Full Workshop'));
check('it says what to bring to IBM’s', h1.includes('Bring a laptop with IBM Bob installed and signed in.'));
check('it names their pass and the cut-off', h1.includes('Your VIP Pass includes one hands-on workshop') && h1.includes('You can change your choice until Thursday 1 January, 12:00 am'), h1.match(/change your choice[^<]*/));
check('a preview mints no sign-in link and sends nothing', h1.includes('href="#preview"') && tokens() === t0 && W.sent.length === 0, { t: tokens(), t0, sent: W.sent.length });

r = await send(102, { preview: true });
const h2 = r.json.html || '';
check('a "seat" preview: their workshop by day in the subject', r.status === 200 && r.json.kind === 'seat' && r.json.subject === 'Your workshop on Friday: AI, Trust and Evolving Skills using IBM Bob', r.json.subject);
check('it gives the IBM Bob steps and both links', h2.includes('Your workshop seat is booked') && h2.includes('bob.ibm.com/trial') && h2.includes('bob.ibm.com/download') && h2.includes('/docs/ibm-bob-install-guide.pdf') && h2.includes('/training-workshop#ibm-workshop'));
check('it lists no other workshop', !h2.includes('From Prototype to Production'));
check('the greeting leaves out the title of address', h2.includes('Dear Bina,'));

r = await send(109, { preview: true });
check('a name and organisation are escaped', !r.json.html.includes('<b>Bad</b>') && r.json.html.includes('&lt;b&gt;Bad&lt;/b&gt;'), r.json.html.match(/Dear[^<]*/));

// ---- people who are not on the list ----
r = await send(103, {});
check('a Visitor Pass: refused, no workshop in it', r.status === 409 && /Visitor Pass with no workshop/.test(r.json.error), r.json);
r = await send(104, {});
check('an unpaid VIP Pass: refused, not paid yet', r.status === 409 && /not paid yet/.test(r.json.error), r.json);
r = await send(106, {});
check('a refunded pass: refused', r.status === 409 && /refunded/.test(r.json.error), r.json);
r = await send(107, {});
check('no email address: refused', r.status === 409 && /no email address for Gita Noemail/.test(r.json.error), r.json);
r = await send(108, {});
check('another event’s holder: refused', r.status === 409, r.json);
r = await send(9999, {});
check('nobody by that id: 404', r.status === 404, r.status);
check('none of those sent anything', W.sent.length === 0, W.sent.length);

// ---- sending ----
r = await send(101, {});
check('a "choose" email goes', r.status === 200 && r.json.success && r.json.kind === 'choose' && W.sent.length === 1, r.json);
const m1 = JSON.stringify(W.sent[0]);
check('to their address, with the subject', m1.includes('Asha@Example.test') && m1.includes('Your pass includes a workshop: choose your seat'), m1.slice(0, 300));
check('its button signs them in at the seat picker', /\?email=asha%40example\.test&(amp;)?action=workshop&(amp;)?token=[A-Za-z0-9_-]{16,}/.test(m1) && tokens() === t0 + 1, m1.match(/href=[^ ]*action=workshop[^ ]*/));
let a = audits();
check('the send is logged with its kind', a.length === 1 && a[0].entity_id === '101' && JSON.parse(a[0].detail).kind === 'choose', a);

r = await send(101, {});
check('the same email again within 12 hours: refused, nothing sent', r.status === 409 && r.json.already === true && W.sent.length === 1, r.json);
r = await send(101, { again: true });
check('...unless asked: it goes again', r.status === 200 && r.json.success && W.sent.length === 2, r.json);

r = await send(102, {});
const m3 = JSON.stringify(W.sent[2] || {});
check('a "seat" email goes with the steps and a button to the workshop in the app', r.status === 200 && r.json.kind === 'seat' && m3.includes('bob.ibm.com/trial') && /action=workshop/.test(m3), r.json);

d = await list();
check('the list says who was emailed, which kind and how often', p(101).last && p(101).last.kind === 'choose' && p(101).last.n === 2 && p(102).last.kind === 'seat' && p(105).last === null, [p(101), p(102)]);

// A seat taken after a "choose" email: the next one is "seat", not refused as a repeat.
W.db.run('INSERT INTO workshop_seats (event_id, attendee_id, workshop_id) VALUES (1, 101, 2)');
r = await send(101, {});
check('someone who chose after the reminder gets "Your workshop" (a different kind goes)', r.status === 200 && r.json.kind === 'seat' && r.json.subject === 'Your workshop on Friday: From Prototype to Production', r.json);
check('FDE has no "before you come" box', !JSON.stringify(W.sent[3] || {}).includes('Before you come'));

// ---- the cut-off passed; every workshop closed ----
closes('2000-01-01 00:00');
r = await send(105, { preview: true });
check('after the cut-off the email does not offer a change', r.status === 200 && !r.json.html.includes('change your choice'), r.json.html.match(/change[^<]*/));
W.db.run('UPDATE workshops SET is_open = 0');
r = await send(105, {});
check('every workshop closed: "choose" is refused and nothing goes', r.status === 409 && /full or closed/.test(r.json.error) && W.sent.length === 4, r.json);
d = await list();
check('the list says none is open', d.open_workshops === 0, d.open_workshops);

// ---- the panel is on the admin page ----
r = await W.call('GET', '/admin', undefined, { admin: false });
check('/admin loads the panel after /admin.js', r.status === 200 && /\/admin\.js\?v=[^"]+"><\/script>\s*<script src="\/static\/workshop-reminder\.js\?v=\d+"><\/script>/.test(r.text), r.status);

// ==================== automatic, 15 minutes after a workshop pass ====================
// A fresh world. Times are relative to SQLite's own clock, as the scheduler's are.
const V = await makeWorld({ migrated: true });
const tick = async () => (await V.call('POST', '/api/cron/tick', { max_seconds: 1 })).json;
const auto = () => V.rows("SELECT entity_id, action, actor, detail FROM admin_audit WHERE action LIKE 'workshop.reminder%' AND actor = 'scheduler' ORDER BY id");
const mailsTo = (addr) => V.sent.filter(m => JSON.stringify(m).toLowerCase().includes(addr) && JSON.stringify(m).includes('choose your seat')).length;
V.db.run("INSERT INTO workshops (id, event_id, slug, title, speaker, summary, starts_at, ends_at, room, capacity, is_open, sort_order) VALUES (1, 1, 'ibm-workshop', 'AI, Trust and Evolving Skills using IBM Bob', 'KrishnaKanth Naik', '', '2099-11-20 11:30', '2099-11-20 13:00', 'Raman Theatre', 100, 1, 1)");
const vat = (id, email, badge, pay, created) => V.db.run(
  `INSERT INTO attendees (id, event_id, name, email, company, job_title, badge_type, payment_status, main_event, created_at) VALUES (?, 1, ?, ?, 'Acme', 'CTO', ?, ?, 1, datetime('now', ?))`,
  [id, 'Person ' + id, email, badge, pay, created]);
const order = (id, aid, pass, status, paidAgo) => V.db.run(
  `INSERT INTO payment_orders (order_id, attendee_id, event_id, pass_type, base_paise, gst_paise, amount_paise, status, paid_at) VALUES (?, ?, 1, ?, 100, 18, 118, ?, ${paidAgo ? "datetime('now', ?)" : 'NULL'})`,
  paidAgo ? ['BAI' + id, aid, pass, status, paidAgo] : ['BAI' + id, aid, pass, status]);
vat(301, 'paid20@example.test', 'VIP Pass', 'paid', '-2 days');   order(1, 301, 'VIP Pass', 'paid', '-20 minutes');  // a Visitor who upgraded 20 min ago: due
vat(302, 'paid5@example.test', 'VIP Pass', 'paid', '-1 hours');   order(2, 302, 'VIP Pass', 'paid', '-5 minutes');   // paid 5 min ago: not yet
vat(303, 'free20@example.test', 'Premium Delegate Pass', 'waived', '-20 minutes');                                     // given free 20 min ago: due
vat(304, 'old@example.test', 'VIP Pass', 'paid', '-5 days');      order(4, 304, 'VIP Pass', 'paid', '-3 days');      // paid 3 days ago: the panel's
vat(305, 'seat@example.test', 'VIP Pass', 'paid', '-1 hours');    order(5, 305, 'VIP Pass', 'paid', '-20 minutes');  // chose already
V.db.run('INSERT INTO workshop_seats (event_id, attendee_id, workshop_id) VALUES (1, 305, 1)');
vat(306, 'told@example.test', 'VIP Pass', 'paid', '-1 hours');    order(6, 306, 'VIP Pass', 'paid', '-20 minutes');  // emailed from the panel already
V.db.run("INSERT INTO admin_audit (actor, action, entity, entity_id, detail) VALUES ('Harness', 'workshop.reminder', 'attendee', '306', '{\"kind\":\"choose\"}')");
vat(307, 'unpaid@example.test', 'VIP Pass', 'pending', '-1 hours'); order(7, 307, 'VIP Pass', 'created', null);    // not paid
vat(308, 'visitor@example.test', 'Visitor Pass', 'free', '-20 minutes');                                               // no workshop in the pass
vat(309, 'student@example.test', 'Student Pass', 'paid', '-1 hours'); order(9, 309, 'Student Pass', 'paid', '-16 minutes'); // due
vat(310, 'bad address', 'VIP Pass', 'paid', '-20 minutes');                                                             // unusable address

let t = await tick();
check('the clock reports the workshop email', t && t.workshop_mail && t.workshop_mail.on === true, t && t.workshop_mail);
const got = auto().filter(x => x.action === 'workshop.reminder').map(x => Number(x.entity_id)).sort((a, b) => a - b);
check('due: paid 20 min ago (an upgrade), given free 20 min ago, a Student Pass 16 min ago', JSON.stringify(got) === JSON.stringify([301, 303, 309]), got);
check('one email each, to the right people', mailsTo('paid20@example.test') === 1 && mailsTo('free20@example.test') === 1 && mailsTo('student@example.test') === 1, V.sent.length);
check('nobody else: paid 5 min ago, paid 3 days ago, a seat, already emailed, unpaid, a Visitor Pass', ['paid5@', 'old@', 'seat@', 'told@', 'unpaid@', 'visitor@'].every(a => mailsTo(a) === 0));
check('an unusable address is kept as a failure, not sent', auto().some(x => x.entity_id === '310' && x.action === 'workshop.reminder_error'), auto());
const autoMail = JSON.stringify(V.sent.find(m => JSON.stringify(m).includes('paid20@example.test')) || {});
check('it is the "Choose your workshop" email with a signed seat-picker button', autoMail.includes('Your pass includes a workshop: choose your seat') && /action=workshop&(amp;)?token=[A-Za-z0-9_-]{16,}/.test(autoMail), autoMail.slice(0, 300));
const n1 = V.sent.length;
t = await tick();
check('the next minute sends none of them again', V.sent.length === n1 && t.workshop_mail.sent === 0, t.workshop_mail);

// Paid 5 minutes ago becomes due ten minutes later.
V.db.run("UPDATE payment_orders SET paid_at = datetime('now', '-15 minutes') WHERE attendee_id = 302");
t = await tick();
check('15 minutes after paying, it goes', mailsTo('paid5@example.test') === 1, t.workshop_mail);

// The panel shows them as emailed automatically, and the count.
let dv = (await V.call('GET', '/api/admin/workshop-reminders')).json;
const pv = (id) => dv.people.find(x => x.id === id);
check('the panel marks them emailed automatically', pv(301).last && pv(301).last.auto === true && pv(301).last.kind === 'choose', pv(301));
check('the panel counts the automatic sends and the failure', dv.auto && dv.auto.on === true && dv.auto.sent === 4 && dv.auto.failed === 1 && dv.auto.after_minutes === 15, dv.auto);
r = await V.call('POST', '/api/admin/attendees/301/workshop-reminder', {});
check('the panel will not send them the same email again within 12 hours', r.status === 409 && r.json.already === true, r.json);

// Nothing to choose: not sent and not claimed, so it goes when a workshop opens again.
vat(311, 'later@example.test', 'VIP Pass', 'paid', '-1 hours'); order(11, 311, 'VIP Pass', 'paid', '-20 minutes');
V.db.run('UPDATE workshops SET is_open = 0');
t = await tick();
check('every workshop closed: nothing goes, nothing is claimed', mailsTo('later@example.test') === 0 && !auto().some(x => x.entity_id === '311') && t.workshop_mail.waiting === 1, t.workshop_mail);
V.db.run('UPDATE workshops SET is_open = 1');
t = await tick();
check('...and it goes once one opens', mailsTo('later@example.test') === 1, t.workshop_mail);

// The switch.
r = await V.call('POST', '/api/admin/workshop-reminders/auto', { on: false }, { admin: false });
check('nobody but an admin turns it off', r.status === 401 || r.status === 403, r.status);
r = await V.call('POST', '/api/admin/workshop-reminders/auto', { on: false });
check('an admin turns it off', r.status === 200 && r.json.auto.on === false, r.json);
vat(312, 'off@example.test', 'VIP Pass', 'paid', '-1 hours'); order(12, 312, 'VIP Pass', 'paid', '-20 minutes');
t = await tick();
check('off: nobody is emailed', mailsTo('off@example.test') === 0 && t.workshop_mail.on === false, t.workshop_mail);
r = await V.call('POST', '/api/admin/workshop-reminders/auto', { on: true });
t = await tick();
check('on again: the one who waited gets it', r.json.auto.on === true && mailsTo('off@example.test') === 1, t.workshop_mail);
const invitesTo = (addr) => V.sent.filter(m => JSON.stringify(m).toLowerCase().includes(addr) && JSON.stringify(m).includes('book your seat')).length;
check('automatic, a pass without a workshop: the Visitor registered 20 min ago got the invitation, once', invitesTo('visitor@example.test') === 1 && mailsTo('visitor@example.test') === 0, V.sent.length);
check('the panel counts automatic invitations', (await V.call('GET', '/api/admin/workshop-reminders')).json.auto.invited === 1);

// ==================== passes without a workshop: the invitation, and who tried ====================
const X = await makeWorld({ migrated: true });
// The send window and the pace read the clock: noon in India today, moved by hand.
const RealDate = Date;
let fakeMs = null;
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(fakeMs ?? RealDate.now()); }
  static now() { return fakeMs ?? RealDate.now(); }
};
const noonIst = () => { const d = new RealDate(); return RealDate.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 6, 30); };
X.db.run("INSERT INTO workshops (id, event_id, slug, title, speaker, summary, starts_at, ends_at, room, capacity, is_open, sort_order) VALUES (1, 1, 'ibm-workshop', 'AI, Trust and Evolving Skills using IBM Bob', 'KrishnaKanth Naik', '', '2037-11-20 11:30', '2037-11-20 13:00', 'Raman Theatre', 100, 1, 1), (2, 1, 'llm-fine-tuning', 'LLM Fine-Tuning, Hands-On', 'Someone', '', '2037-11-20 15:45', '2037-11-20 17:45', 'Raman Theatre', 40, 1, 2)");
const xat = (id, email, badge, pay, extra = {}) => X.db.run(
  `INSERT INTO attendees (id, event_id, name, email, mobile, company, job_title, badge_type, payment_status, main_event, unsubscribed_at, marketing_consent, last_login_at, created_at)
   VALUES (?, 1, ?, ?, '98200000' || ?, 'Acme', ?, ?, ?, ?, ?, ?, ?, datetime('now', '-10 days'))`,
  [id, 'Person ' + id, email, id, extra.title || 'Engineer', badge, pay, extra.main ?? 1, extra.unsub ? '2026-11-01 00:00:00' : null, extra.consent ?? null, extra.login ?? null]);
xat(401, 'v-old@example.test', 'Visitor Pass', 'paid');                                                        // never signed in
xat(402, 'v-ceo@example.test', 'Visitor Pass', 'paid', { title: 'CEO' });                                      // senior, never signed in
xat(403, 'v-active@example.test', 'Visitor Pass', 'paid', { login: new RealDate(RealDate.now() - 86400000).toISOString().slice(0, 19).replace('T', ' ') }); // in the app yesterday
xat(404, 'v-unsub@example.test', 'Visitor Pass', 'paid', { unsub: true });                                      // unsubscribed
xat(405, 'v-noconsent@example.test', 'Visitor Pass', 'paid', { consent: 0 });                                  // said no to email
xat(406, 'v-panel@example.test', 'Visitor Pass', 'paid', { main: 0 });                                        // campus panel only
xat(407, 'd-paid@example.test', 'Delegate Pass', 'paid');
xat(408, 'e-paid@example.test', 'Expo Pass', 'paid');
xat(409, 'd-pending@example.test', 'Delegate Pass', 'pending');                                               // not paid
xat(410, 'vip@example.test', 'VIP Pass', 'paid');                                                              // has a workshop
xat(411, 'not an address', 'Visitor Pass', 'paid');

let iv = (await X.call('GET', '/api/admin/workshop-invites')).json;
check('invitation groups: free Visitors (left out: unsubscribed, said no, campus panel only, no address)', iv.groups.free.count === 3, iv.groups);
check('invitation groups: Expo, Delegate and Academic (an unpaid Delegate left out)', iv.groups.paid.count === 2, iv.groups.paid);
let au = (await X.call('GET', '/api/admin/workshop-invites/audience?group=free')).json;
check('likeliest buyers first: in the app lately, then a CEO, then the rest', JSON.stringify(au.ids) === JSON.stringify([403, 402, 401]), au.ids);
r = await X.call('GET', '/api/admin/workshop-invites/audience?group=free', undefined, { admin: false });
check('nobody but an admin reads the audience', r.status === 401 || r.status === 403, r.status);

const xt0 = X.rows('SELECT COUNT(*) AS n FROM login_tokens')[0].n;
r = await X.call('POST', '/api/admin/workshop-invites/preview', { group: 'free' });
const ih = (r.json && r.json.html) || '';
check('the invitation: subject and workshops', r.status === 200 && r.json.subject === 'Hands-on AI workshops on Friday 20 November: book your seat' && ih.includes('AI, Trust and Evolving Skills using IBM Bob') && ih.includes('LLM Fine-Tuning, Hands-On') && ih.includes('See the workshops and book'), r.json && r.json.subject);
// "a free Hugging Face account" is what to bring to the fine-tuning workshop, and true.
const ihText = ih.replace(/<[^>]+>/g, ' ').replace(/a free Hugging Face account/g, '');
check('it says nothing untrue and names no pass or price', !/included|includes|free|your pass|premium|vip|student pass|delegate|&#8377;|₹|rs\.?\s?\d/i.test(ihText), ihText.match(/(included|includes|free|your pass|premium|vip|student pass|delegate|₹)/i));
check('the preview mints no sign-in link and sends nothing', ih.includes('href="#preview"') && X.rows('SELECT COUNT(*) AS n FROM login_tokens')[0].n === xt0 && X.sent.length === 0);

// A bulk run keeps the order it was given.
r = await X.call('POST', '/api/admin/campaigns', { kind: 'workshop_invite', audience: 'free', ids: au.ids, title: 'Workshop invitation: Free Visitor Pass' });
check('a workshop_invite run starts', r.status === 201 && r.json.total === 3, r.json);
const campId = r.json.id;
const runOrder = X.rows('SELECT attendee_id FROM campaign_recipients WHERE campaign_id = ? ORDER BY id', [campId]).map(x => x.attendee_id);
check('its people are in the order given, not by id', JSON.stringify(runOrder) === JSON.stringify([403, 402, 401]), runOrder);

// Outside 9am-9pm it waits; inside, one at a time at the pace.
fakeMs = noonIst() + 11 * 3600000; // 11 pm in India
r = await X.call('POST', '/api/admin/attendees/403/send-workshop-invite', {});
check('outside the sending window: waits, sends nothing', r.status === 409 && r.json.paused === true && X.sent.length === 0, r.json);
fakeMs = noonIst();
X.db.run("INSERT INTO app_settings (key, value) VALUES ('profile_reminder_gap_seconds', '30') ON CONFLICT(key) DO UPDATE SET value = '30'");
r = await X.call('POST', `/api/admin/campaigns/${campId}/pump`, { batch: 1 });
check('the run sends the first person (the one in the app lately)', X.sent.length === 1 && JSON.stringify(X.sent[0]).includes('v-active@example.test'), r.json);
const im = JSON.stringify(X.sent[0] || {});
check('the button signs them in at the workshops', /action=workshop&(amp;)?token=[A-Za-z0-9_-]{16,}/.test(im));
check('it carries the unsubscribe link', /unsubscribe/i.test(im));
r = await X.call('POST', `/api/admin/campaigns/${campId}/pump`, { batch: 1 });
check('the next one waits for the pace', X.sent.length === 1, r.json);
fakeMs += 31000;
r = await X.call('POST', `/api/admin/campaigns/${campId}/pump`, { batch: 1 });
check('...then goes', X.sent.length === 2 && JSON.stringify(X.sent[1]).includes('v-ceo@example.test'), r.json);
fakeMs += 31000;
r = await X.call('POST', '/api/admin/attendees/402/send-workshop-invite', {});
check('nobody is invited twice', r.status === 200 && r.json.skipped === true && X.sent.length === 2, r.json);
r = await X.call('POST', '/api/admin/attendees/410/send-workshop-invite', {});
check('a VIP Pass is not invited (it has a workshop)', r.json.skipped === true, r.json);
r = await X.call('POST', '/api/admin/attendees/404/send-workshop-invite', {});
check('an unsubscribed Visitor is not invited', r.json.skipped === true, r.json);
iv = (await X.call('GET', '/api/admin/workshop-invites')).json;
check('the panel: one free Visitor left, the run listed', iv.groups.free.count === 1 && iv.campaigns.length === 1 && iv.campaigns[0].sent === 2, iv);

// "Book this seat" on a pass without a workshop.
const asAtt = (id) => ({ admin: false, headers: { Cookie: sessionCookie('h', id) } });
fakeMs = null;
r = await X.call('POST', '/api/workshops/choose', { workshop_id: 1 }, asAtt(403));
check('a Visitor pressing Book: refused with need_pass, no seat', r.status === 403 && r.json.need_pass === true && X.rows('SELECT COUNT(*) AS n FROM workshop_seats')[0].n === 0, r.json);
r = await X.call('POST', '/api/workshops/choose', { workshop_id: 1 }, asAtt(403));
r = await X.call('POST', '/api/workshops/choose', { workshop_id: 2 }, asAtt(403));
r = await X.call('POST', '/api/workshops/choose', { workshop_id: 2 }, asAtt(407));
const tries = X.rows("SELECT entity_id, detail FROM admin_audit WHERE action = 'workshop.tried' ORDER BY id");
check('each try is kept: once per person and workshop in ten minutes', tries.length === 3 && tries.filter(x => x.entity_id === '403').length === 2, tries);
r = await X.call('POST', '/api/workshops/choose', { workshop_id: 1 }, asAtt(409));
check('an unpaid Delegate (no workshop in that pass either) is a try too: a lead', r.status === 403 && r.json.need_pass === true && X.rows("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'workshop.tried'")[0].n === 4, r.json);
r = await X.call('POST', '/api/workshops/choose', { workshop_id: 1 }, asAtt(410));
check('a VIP still books a seat as before', r.status === 200 && r.json.mine === 1, r.json);
let tl = (await X.call('GET', '/api/admin/workshop-tries')).json;
const t403 = tl.people.find(p => p.id === 403);
check('the call list: who, phone, both workshops, not bought yet', tl.counts.tried === 3 && t403 && t403.mobile === '98200000403' && t403.workshops.length === 2 && t403.now === 'Not bought yet' && t403.tries === 2, tl);
X.db.run("UPDATE attendees SET badge_type = 'Premium Delegate Pass' WHERE id = 403");
tl = (await X.call('GET', '/api/admin/workshop-tries')).json;
check('...and says when one has bought since', tl.people.find(p => p.id === 403).now === 'Bought a workshop pass' && tl.counts.bought === 1, tl.counts);
r = await X.call('GET', '/api/admin/workshop-tries', undefined, { admin: false });
check('nobody but an admin reads the call list', r.status === 401 || r.status === 403, r.status);
globalThis.Date = RealDate;

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
