// System: one booth buyer from the enquiry form to Won, across every part that must
// agree (12 Nov 2026). The organiser sets owners and switches on the acknowledgement
// and the summary; Ravi sends the booth form; the team email, his acknowledgement and
// the owner rule agree; the desk scores him Hot; the morning summary chases him when
// he waits; Priya answers with the saved booth reply; the deal moves to In talks with
// a value and a follow-up (0053); the summary chases the follow-up; Ravi books his
// booth and buys a pass; Priya marks it Won; and Insights, run on what the desk was
// sent, counts the sale. Built worker, real SQLite, the clock moved.
// Run after `npm run build`:  node scripts/verify/system-inquiry-journey.mjs
import { at, mail, mailTo, bodyOf, makeWorld, deskFunctions, check, done } from './inquiry-world.mjs';

const W = makeWorld({ pipeline: true });
const T = deskFunctions();
const PRIYA = { admin: true, actor: 'Priya' };
const ORG = { admin: true, actor: 'Organiser' };
const team = () => mailTo('team@bharataiinnovation.com');
const summaries = () => team().filter((m) => m.Content.Subject.startsWith('Enquiries:'));
const tick = () => W.call('/api/cron/tick', { method: 'POST', body: {}, headers: { Authorization: 'Bearer iq-admin' } });
const deskRows = async () => (await W.call('/api/admin/inquiries', { admin: true })).json;

// 1. The organiser sets the rules.
at('2026-11-12', '09:30');
const set = await W.call('/api/admin/inquiry-settings', { method: 'PUT', body: { routing: { booth_inquiry: 'Priya', sponsorship: 'Priya' }, autoack: true, digest: true }, ...ORG });
check('1. the organiser names Priya for booths and switches on the acknowledgement and the summary', set.status === 200 && set.json.settings.autoack && set.json.settings.digest && set.json.settings.routing.booth_inquiry === 'Priya');
// Something to compete with: a plain question that came in earlier.
W.insert('inquiries', { event_id: 1, inquiry_type: 'general', name: 'Curious', email: 'curious@gmail.com', message: 'what time does it open?', status: 'new', metadata: '{}', created_at: W.ago(1) });

// 2. Ravi sends the booth form, as /inquiry sends it.
at('2026-11-12', '10:00');
mail.length = 0;
const sent = await W.call('/api/inquiries', { method: 'POST', ip: '49.36.1.2', body: {
  inquiry_type: 'booth_inquiry', name: 'Ravi Kumar', email: 'ravi@acme.in', phone: '+91 98200 11111', organization: 'Acme Robotics',
  subject: 'Booth Inquiry: explorer', message: 'We want to show our warehouse robot.',
  metadata: { booth_type: 'explorer', booth_quantity: 1, preferred_zone: '', estimated_total: 150000, designation: 'CEO', website: 'https://acme.in', industry: 'Manufacturing', products_to_showcase: 'Robot' },
} });
const id = sent.json.id;
const teamMail = team()[0];
const ack = mailTo('ravi@acme.in')[0];
check('2. the enquiry is saved and given to Priya by the rule', sent.status === 201 && W.rows('SELECT assigned_to FROM inquiries WHERE id = ?', [id])[0].assigned_to === 'Priya');
check('2. the team email names Priya and its button opens this very enquiry', bodyOf(teamMail).includes('Priya') && bodyOf(teamMail).includes(`admin?inq=${id}#inquiries`));
check('2. Ravi gets his reference at once, told Priya will reply, with the floor plan', ack && ack.Content.Subject.includes('BHAI-INQ-' + String(id).padStart(5, '0')) && bodyOf(ack).includes('Priya from our team') && bodyOf(ack).includes('/exhibition'));

// 3. The desk puts him first.
let d = await deskRows();
let ravi = d.inquiries.find((r) => r.id === id);
check('3. the desk scores him Hot, and says why: booth, company email, about Rs 1.5 lakh', ravi.band === 'hot' && ['Booth', 'company email', 'about Rs 1.5 lakh'].every((w) => ravi.why.includes(w)), JSON.stringify(ravi.why));
const ctx = (now, today) => ({ now, today, sla: d.settings.sla_hours, me: 'Priya', settings: d.settings });
let now = Date.now();
const needs = T.filterRows(d.inquiries, { view: 'needs_reply', q: '', type: '', status: '', owner: '', sort: 'priority' }, ctx(now, d.today));
check('3. in Needs a reply he comes before the older plain question', needs[0].id === id && needs.length === 2);
check('3. Mine, for Priya, has him', T.filterRows(d.inquiries, { view: 'mine', q: '', type: '', status: '', owner: '', sort: 'priority' }, ctx(now, d.today)).map((r) => r.id).join() === String(id));
check('3. the advice starts with the hot lead and what it is worth', /1 hot lead has no reply yet<\/strong>, worth about ₹1\.5 L/.test(T.advise(d.inquiries, ctx(now, d.today))[0].html), T.advise(d.inquiries, ctx(now, d.today))[0]?.html);

// 4. Nobody answers. The next morning is too soon; the one after, he leads the summary.
at('2026-11-13', '09:00');
await tick();
const first = bodyOf(summaries()[0]);
const firstWaiting = first.includes('Waiting for a first reply') ? first.slice(first.indexOf('Waiting for a first reply')) : '';
check('4. next morning: the summary goes; the question from 24.5 hours ago is late, Ravi (23 hours) not yet', summaries().length === 1 && firstWaiting.includes('Curious') && !firstWaiting.includes('Ravi Kumar'), firstWaiting.slice(0, 300));
at('2026-11-14', '09:00');
await tick();
const chase = bodyOf(summaries()[1]);
check('4. the morning after: Ravi leads "Waiting for a first reply", worth chasing first', summaries().length === 2 && chase.includes('Waiting for a first reply') && chase.indexOf('Ravi Kumar') > -1 && chase.indexOf('Ravi Kumar') < (chase.indexOf('Curious') < 0 ? Infinity : chase.indexOf('Curious')), chase.slice(0, 200));

// 5. Priya answers with the saved booth reply.
at('2026-11-14', '10:00');
const tpl = d.settings.templates.find((t) => t.id === 'booth');
mail.length = 0;
const rep = await W.call(`/api/admin/inquiries/${id}/reply`, { method: 'POST', body: { subject: tpl.subject, message: tpl.body, template_id: 'booth' }, ...PRIYA });
const replyMail = mailTo('ravi@acme.in')[0];
check('5. the saved booth reply reaches Ravi with his company in it, and the floor plan link', rep.status === 200 && bodyOf(replyMail).includes('hold it for Acme Robotics') && bodyOf(replyMail).includes('https://bharataiinnovation.com/exhibition') && bodyOf(replyMail).includes('Dear Ravi Kumar'));
d = await deskRows();
ravi = d.inquiries.find((r) => r.id === id);
check('5. he is Replied, and his first reply took two days', ravi.status === 'responded' && Math.round(T.firstReplyHours(ravi)) === 48, T.firstReplyHours(ravi));

// 6. They talk. Priya records the deal.
const upd = await W.call(`/api/admin/inquiries/${id}`, { method: 'PATCH', body: { status: 'in_progress', deal_value_inr: '1,80,000', next_action_at: '2026-11-16', next_action: 'Send the invoice' }, ...PRIYA });
d = await deskRows();
ravi = d.inquiries.find((r) => r.id === id);
check('6. In talks, worth Rs 1,80,000 (his figure, not the form estimate), follow up on 16 Nov', upd.status === 200 && ravi.status === 'in_progress' && ravi.value_inr === 180000 && !ravi.value_estimated && ravi.next_action_at === '2026-11-16');

// 7. On the 16th the summary chases the follow-up.
at('2026-11-16', '09:05');
mail.length = 0;
await tick();
const follow = bodyOf(summaries()[0]);
check('7. the morning of the 16th, the summary lists him under follow-ups due', follow.includes('Follow-ups due today or earlier') && follow.includes('Ravi Kumar') && follow.includes('follow-up due today'), follow.slice(0, 200));
d = await deskRows();
now = Date.now();
check('7. and the desk shows him under Follow-ups due', T.filterRows(d.inquiries, { view: 'due', q: '', type: '', status: '', owner: '', sort: 'priority' }, ctx(now, d.today)).some((r) => r.id === id));

// 8. Ravi books the booth and buys a Delegate Pass.
const booth = W.insert('booths', { event_id: 1, code: '27', type_key: 'explorer', name: 'Explorer', sqm: 9, list_price_inr: 180000 });
W.insert('booth_allocations', { event_id: 1, booth_id: booth, company_name: 'Acme Robotics', email: 'Ravi@Acme.in', status: 'confirmed', amount_inr: 180000 });
W.insert('attendees', { event_id: 1, name: 'Ravi Kumar', email: 'ravi@acme.in', badge_type: 'Delegate Pass', payment_status: 'paid' });
d = await deskRows();
ravi = d.inquiries.find((r) => r.id === id);
check('8. the desk now knows him: booth 27 booked and a paid Delegate Pass', ravi.booth_code === '27' && ravi.booth_status === 'confirmed' && ravi.known_paid === true && ravi.pass === 'Delegate Pass');

// 9. Won.
await W.call(`/api/admin/inquiries/${id}`, { method: 'PATCH', body: { status: 'won' }, ...PRIYA });
d = await deskRows();
ravi = d.inquiries.find((r) => r.id === id);
const ins = T.computeInsights(d.inquiries, Date.now(), d.today, d.settings.sla_hours);
check('9. Won, dated, out of every work list', ravi.status === 'won' && !!ravi.closed_at && ravi.band === 'done' && !T.filterRows(d.inquiries, { view: 'open', q: '', type: '', status: '', owner: '', sort: 'priority' }, ctx(Date.now(), d.today)).some((r) => r.id === id));
check('9. Insights counts the sale: one won, Rs 1.8 lakh, the sales funnel, Priya\'s row', ins.won === 1 && ins.wonValue === 180000 && ins.funnel.revenue.won === 1 && ins.owners.find((o) => o.owner === 'Priya').won === 1 && ins.customers === 1);
at('2026-11-17', '09:00');
mail.length = 0;
await tick();
check('9. the next summary reports the win and its value', /Won since yesterday: 1<\/strong>, worth Rs 1\.8 lakh/.test(bodyOf(summaries()[0])), bodyOf(summaries()[0]).slice(0, 100));

// 10. The history tells the story in order.
const hist = (await W.call(`/api/admin/inquiries/${id}/activity`, { admin: true })).json.events.map((e) => e.action).reverse();
check('10. history: acknowledged automatically, replied, updated twice', hist.join(' > ') === 'inquiry.autoack > inquiry.reply > inquiry.update > inquiry.update', hist.join(' > '));
check('10. and in words, as the desk shows it', T.auditWords((await W.call(`/api/admin/inquiries/${id}/activity`, { admin: true })).json.events[0]) === 'Changed status to Won');

done();
