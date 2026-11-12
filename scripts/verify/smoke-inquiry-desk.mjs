// Integration: the enquiry desk's routes on the built worker and real SQLite with the
// production schema (12 Nov 2026). The form's route with owners by type and the
// automatic acknowledgement; the list told who each sender already is, with its score
// and a suggested type; changes one at a time and many at once; notes that add up;
// replies with saved-reply fields; the history; the settings; the morning summary
// from the minute clock; and the commercial fields before and after 0053.
// Run after `npm run build`:  node scripts/verify/smoke-inquiry-desk.mjs
import { at, mail, mailTo, bodyOf, setMailDown, makeWorld, check, done } from './inquiry-world.mjs';

const W = makeWorld();
const { call, rows, insert, ago, db } = W;
const A = { admin: true, actor: 'Priya' };
const row = (id) => rows('SELECT * FROM inquiries WHERE id = ?', [id])[0];
const audits = (id, action) => rows("SELECT * FROM admin_audit WHERE entity = 'inquiry' AND entity_id = ? AND action = ? ORDER BY id", [String(id), action]);
const send = (body, ip) => call('/api/inquiries', { method: 'POST', body, ip });
const desk = async (q = '') => (await call('/api/admin/inquiries' + q, { admin: true })).json;
const find = (list, id) => (list.inquiries || []).find((r) => r.id === id);

// ---- people the senders already are ----
insert('attendees', { event_id: 1, name: 'Asha Paid', email: 'asha@tatai.com', badge_type: 'Delegate Pass', payment_status: 'paid' });
insert('attendees', { event_id: 1, name: 'Vik Free', email: 'vik@gmail.com', badge_type: 'Visitor Pass', payment_status: 'paid' });
insert('attendees', { event_id: 1, name: 'Pen Ding', email: 'Pending@Corp.in', badge_type: 'VIP Pass', payment_status: 'pending' });
const boothId = insert('booths', { event_id: 1, code: '12', type_key: 'explorer', name: 'Explorer', sqm: 9, list_price_inr: 150000 });
insert('booth_allocations', { event_id: 1, booth_id: boothId, company_name: 'Booth Co', email: 'buyer@boothco.in', status: 'confirmed', amount_inr: 150000 });
insert('staff', { name: 'Anita Ram', username: 'anita', password_hash: 'x', role: 'admin' });
insert('staff', { name: 'Desk One', username: 'desk1', password_hash: 'x', role: 'desk' });

// ======== the form's route ========
{
  mail.length = 0;
  check('form: a name and email are required', (await send({ inquiry_type: 'general', email: 'a@b.co' })).status === 400);
  check('form: an unknown type is refused, Delhi free pass included (it has its own route)',
    (await send({ inquiry_type: 'nope', name: 'X', email: 'x@y.co' })).status === 400 && (await send({ inquiry_type: 'delhi_pass', name: 'X', email: 'x@y.co' })).status === 400);
  const r = await send({ inquiry_type: 'booth_inquiry', name: 'Ravi Kumar', email: 'Ravi@Acme.in', organization: 'Acme', subject: 'Booth Inquiry: explorer', message: 'Need a booth', metadata: { booth_type: 'explorer', estimated_total: 150000 } });
  const saved = row(r.json?.id);
  check('form: saved, email lowercased, no owner while there is no rule', r.status === 201 && saved?.email === 'ravi@acme.in' && !saved.assigned_to, JSON.stringify(saved));
  check('form: one email, to the team, and none to the sender while the switch is off', mail.length === 1 && mailTo('team@bharataiinnovation.com').length === 1, mail.map((m) => m.Recipients.To));
  check('form: the team email keeps its subject and links straight to this enquiry in Admin',
    mail[0].Content.Subject === 'New booth inquiry enquiry — Ravi Kumar' && bodyOf(mail[0]).includes('/admin?inq=' + saved.id + '#inquiries'), mail[0].Content.Subject);

  // Owners by type.
  const put = await call('/api/admin/inquiry-settings', { method: 'PUT', body: { routing: { booth_inquiry: 'Priya', bogus: 'X', speaking: '  ' } }, ...A });
  check('settings: owners by type keep known types and names only', put.status === 200 && JSON.stringify(put.json.settings.routing) === '{"booth_inquiry":"Priya"}', put.text);
  mail.length = 0;
  const r2 = await send({ inquiry_type: 'booth_inquiry', name: 'Meera Shah', email: 'meera@zeta.ai', organization: 'Zeta' });
  check('form: a new booth enquiry is given to the owner its type names', row(r2.json.id).assigned_to === 'Priya', JSON.stringify(row(r2.json.id)));
  check('form: the team email says who owns it', bodyOf(mail[0]).includes('Owner') && bodyOf(mail[0]).includes('Priya'));
  const r3 = await send({ inquiry_type: 'media', name: 'No Rule', email: 'press@paper.in' });
  check('form: a type with no rule stays without an owner', !row(r3.json.id).assigned_to);

  // The automatic acknowledgement.
  await call('/api/admin/inquiry-settings', { method: 'PUT', body: { autoack: true }, ...A });
  mail.length = 0;
  const r4 = await send({ inquiry_type: 'booth_inquiry', name: 'Kiran Rao', email: 'kiran@nova.in', organization: 'Nova' }, '10.0.0.1');
  const ack = mailTo('kiran@nova.in');
  const ref = 'BHAI-INQ-' + String(r4.json.id).padStart(5, '0');
  check('ack: switched on, the sender gets one email and the team still gets theirs', ack.length === 1 && mailTo('team@bharataiinnovation.com').length === 1, mail.map((m) => m.Recipients.To));
  check('ack: it gives the reference, names the owner and links the floor plan', ack[0].Content.Subject.includes(ref) && bodyOf(ack[0]).includes(ref) && bodyOf(ack[0]).includes('Priya from our team') && bodyOf(ack[0]).includes('/exhibition'), ack[0].Content.Subject);
  check('ack: a reply to their own request carries no unsubscribe footer', !/unsubscribe/i.test(bodyOf(ack[0])));
  check('ack: written in the history as automatic', audits(r4.json.id, 'inquiry.autoack').length === 1 && audits(r4.json.id, 'inquiry.autoack')[0].actor === 'automatic');
  mail.length = 0;
  await send({ inquiry_type: 'general', name: 'Kiran Rao', email: 'KIRAN@nova.in', message: 'one more thing' }, '10.0.0.1');
  check('ack: once per address a day (a second enquiry gets no second acknowledgement)', mailTo('kiran@nova.in').length === 0 && mail.length === 1, mail.map((m) => m.Recipients.To));
  mail.length = 0;
  for (let i = 0; i < 21; i++) await send({ inquiry_type: 'general', name: 'Flood ' + i, email: `flood${i}@spam.example` }, '10.9.9.9');
  check('ack: one connection sets off at most 20 an hour (the 21st enquiry is saved but not acknowledged)', mail.filter((m) => /spam\.example/.test(m.Recipients.To[0])).length === 20 && rows("SELECT COUNT(*) AS n FROM inquiries WHERE email LIKE '%spam.example'")[0].n === 21);
  setMailDown(true);
  const r5 = await send({ inquiry_type: 'sponsorship', name: 'Down Time', email: 'down@time.in' }, '10.0.0.2');
  setMailDown(false);
  check('ack: the email service failing never fails the enquiry, and the failure is written down', r5.status === 201 && audits(r5.json.id, 'inquiry.autoack-failed').length === 1);
  await call('/api/admin/inquiry-settings', { method: 'PUT', body: { autoack: false }, ...A });
}

// ======== seed for the list ========
const mk = (o) => insert('inquiries', { event_id: 1, status: 'new', metadata: '{}', ...o });
const id = {
  sponsorPaid: mk({ inquiry_type: 'sponsorship', name: 'Asha Paid', email: 'asha@tatai.com', organization: 'Tata AI', created_at: ago(1) }),
  generalQ: mk({ inquiry_type: 'general', name: 'Rida Dange', email: 'rida@gmail.com', subject: 'Rida Dange', message: 'want to ask about events', created_at: ago(2) }),
  generalOld: mk({ inquiry_type: 'general', name: 'Old Q', email: 'old@gmail.com', message: 'hello?', created_at: ago(100) }),
  speakerAsGeneral: mk({ inquiry_type: 'general', name: 'Vishweshwar Joshi', email: 'vj@startupsgurukul.com', organization: 'startupsgurukul', subject: 'Looking for speaker opportunity', message: 'Hi Team I have submitted my details as speaker', created_at: ago(70) }),
  sponsorAsGeneral: mk({ inquiry_type: 'general', name: 'S G', email: 'sg@brand.in', message: 'We would like to sponsor the lunch', created_at: ago(3) }),
  stallAsOther: mk({ inquiry_type: 'other', name: 'Stall', email: 'st@stall.in', message: 'Can we book a stall for two days?', created_at: ago(3) }),
  speaking: mk({ inquiry_type: 'speaking', name: 'Ashutosh', email: 'ash@gmail.com', subject: 'Speaking Opportunity / Panel Talk', created_at: ago(30) }),
  booth: mk({ inquiry_type: 'booth_inquiry', name: 'Big Booth', email: 'big@bigco.in', organization: 'BigCo', metadata: JSON.stringify({ estimated_total: 300000 }), created_at: ago(1) }),
  repliedSponsor: mk({ inquiry_type: 'sponsorship', name: 'Replied', email: 'rep@corp.in', organization: 'Corp', status: 'responded', responded_at: ago(5), created_at: ago(20) }),
  won: mk({ inquiry_type: 'booth_inquiry', name: 'Won Co', email: 'won@won.in', organization: 'Won', status: 'won', created_at: ago(200) }),
  visitor: mk({ inquiry_type: 'group_registration', name: 'Vik Free', email: 'vik@gmail.com', metadata: JSON.stringify({ group_size: '25' }), created_at: ago(1) }),
  pending: mk({ inquiry_type: 'pass_upgrade', name: 'Pen Ding', email: 'pending@corp.in', created_at: ago(1) }),
  boothBuyer: mk({ inquiry_type: 'booth_inquiry', name: 'Buyer', email: 'buyer@boothco.in', organization: 'Booth Co', created_at: ago(1) }),
  dup1: mk({ inquiry_type: 'speaking', name: 'Dup', email: 'dup@x.in', created_at: ago(10) }),
  dup2: mk({ inquiry_type: 'general', name: 'Dup', email: 'DUP@x.in', created_at: ago(9) }),
  dup3: mk({ inquiry_type: 'media', name: 'Dup', email: 'dup@x.in', created_at: ago(8) }),
  delhi: mk({ inquiry_type: 'delhi_pass', name: 'Delhi', email: 'd@delhi.in', status: 'waitlisted' }),
  room: mk({ inquiry_type: 'meeting_room', name: 'Room', email: 'room@r.in', created_at: ago(1) }),
};

// ======== the list ========
{
  for (const [path, method] of [['/api/admin/inquiries', 'GET'], [`/api/admin/inquiries/${id.generalQ}/activity`, 'GET'], [`/api/admin/inquiries/${id.generalQ}/note`, 'POST'],
    ['/api/admin/inquiries/bulk', 'POST'], ['/api/admin/inquiries/bulk-reply', 'POST'], ['/api/admin/inquiry-settings', 'GET'], ['/api/admin/inquiry-settings', 'PUT'],
    ['/api/admin/inquiries/apply-routing', 'POST'], ['/api/admin/inquiries/digest', 'POST'], ['/api/admin/inquiries/ack-preview', 'GET'], [`/api/admin/inquiries/${id.generalQ}`, 'PATCH']]) {
    const r = await call(path, { method, body: method === 'GET' ? undefined : {} });
    check(`guard: ${method} ${path.replace(/\d+/, ':id')} needs the admin password`, r.status === 401, r.status);
  }
  const d = await desk();
  const by = (k) => find(d, id[k]);
  check('list: Delhi free passes are left out unless asked for', !by('delhi') && (await desk('?type=delhi_pass')).inquiries.every((r) => r.inquiry_type === 'delhi_pass') && (await desk('?type=delhi_pass')).inquiries.length === 1);
  check('list: a sender with a paid Delegate Pass is shown as paid', by('sponsorPaid').pass === 'Delegate Pass' && by('sponsorPaid').known_paid === true, JSON.stringify(by('sponsorPaid')));
  check('list: a free Visitor Pass is registered, not paid', by('visitor').pass === 'Visitor Pass' && by('visitor').known_paid === false);
  check('list: a VIP not paid for reads not paid (email matched whatever its capitals)', by('pending').pass === 'VIP Pass' && by('pending').pass_payment === 'pending' && by('pending').known_paid === false, JSON.stringify(by('pending')));
  check('list: a sender with a booked booth shows the booth', by('boothBuyer').booth_code === '12' && by('boothBuyer').booth_status === 'confirmed');
  check('list: three enquiries from one address each say two others (capitals ignored)', [by('dup1'), by('dup2'), by('dup3')].every((r) => r.dup_count === 2) && by('generalQ').dup_count === 0);
  check('list: "Looking for speaker opportunity" filed as General is suggested as Speaking', by('speakerAsGeneral').suggested_type === 'speaking');
  check('list: sponsor and stall words suggest Sponsorship and Booth, from General and Other', by('sponsorAsGeneral').suggested_type === 'sponsorship' && by('stallAsOther').suggested_type === 'booth_inquiry');
  check('list: a plain question gets no suggestion, and a typed type is never second-guessed', by('generalQ').suggested_type === '' && by('speaking').suggested_type === '');
  check('list: sponsorship from a company email is Hot, with its reasons in words', by('sponsorPaid').band === 'hot' && by('sponsorPaid').why.includes('Sponsorship') && by('sponsorPaid').why.includes('company email') && by('sponsorPaid').why.includes('paid for a pass'), JSON.stringify(by('sponsorPaid')));
  check('list: a booth quoted at Rs 3 lakh is Hot and says so', by('booth').band === 'hot' && by('booth').why.includes('about Rs 3 lakh') && by('booth').value_inr === 300000 && by('booth').value_estimated === true, JSON.stringify(by('booth').why));
  check('list: a fresh question from a Gmail address is Cold', by('generalQ').band === 'cold' && by('generalQ').score < 35, by('generalQ').score);
  check('list: a question waiting four days says so', by('generalOld').why.includes('waiting 4 days'), JSON.stringify(by('generalOld').why));
  check('list: a General that is really a booth request is scored as one', by('stallAsOther').score > by('generalQ').score + 30, [by('stallAsOther').score, by('generalQ').score]);
  check('list: a replied sponsorship drops to Warm (the next move is theirs)', by('repliedSponsor').band === 'warm', by('repliedSponsor').score);
  check('list: a group of 25 is noted', by('visitor').why.includes('group of 25'));
  check('list: a Won enquiry has no score and no band', by('won').band === 'done' && by('won').score === 0);
  check('list: a boardroom enquiry counts under its own type', (d.typeCounts || []).some((t) => t.inquiry_type === 'meeting_room'));
  check('list: owners are the admin accounts, the owners in use and the rules (no desk logins)', d.owners.includes('Anita Ram') && d.owners.includes('Priya') && !d.owners.includes('Desk One'), JSON.stringify(d.owners));
  check('list: before 0053 the desk is told the commercial fields need it, and how', d.pipeline_ready === false && d.pipeline_hint.includes('0053_inquiry_pipeline.sql'));
  check('list: the settings ride along (starter replies, both switches off, 24 h)', d.settings.templates.length === 11 && d.settings.autoack === false && d.settings.digest === false && d.settings.sla_hours === 24, JSON.stringify(d.settings).slice(0, 200));
  check('list: today in India and the server clock come with it', d.today === '2026-11-12' && !!d.now);
}

// ======== one at a time ========
{
  const p = (iid, body, o = A) => call('/api/admin/inquiries/' + iid, { method: 'PATCH', body, ...o });
  check('change: an unknown status is refused', (await p(id.generalQ, { status: 'maybe' })).status === 400);
  check('change: an unknown type is refused', (await p(id.generalQ, { inquiry_type: 'nope' })).status === 400);
  check('change: no such enquiry is a 404', (await p(999999, { status: 'won' })).status === 404);
  const w1 = await p(id.repliedSponsor, { status: 'won' });
  check('change: Won is a status', w1.status === 200 && row(id.repliedSponsor).status === 'won');
  const hist = audits(id.repliedSponsor, 'inquiry.update');
  check('change: the history names who did it and what', hist.length === 1 && hist[0].actor === 'Priya' && JSON.parse(hist[0].detail).status === 'won', JSON.stringify(hist));
  await p(id.speakerAsGeneral, { inquiry_type: 'speaking' });
  check('change: moved to Speaking', row(id.speakerAsGeneral).inquiry_type === 'speaking');
  check('change: a Delhi free pass keeps its type', (await p(id.delhi, { inquiry_type: 'general' })).status === 400 && row(id.delhi).inquiry_type === 'delhi_pass');
  await p(id.generalQ, { assigned_to: 'Anita Ram' });
  await p(id.generalQ, { assigned_to: '' });
  check('change: an owner set and cleared (empty is nobody)', row(id.generalQ).assigned_to === null);
  await p(id.speaking, { status: 'responded' });
  check('change: Replied by hand starts the reply clock', !!row(id.speaking).responded_at);
  const pr = await p(id.generalQ, { priority: 'hot' });
  check('change: before 0053 priority, value and follow-up are refused with the command', pr.status === 409 && pr.json.error.includes('0053_inquiry_pipeline.sql') && row(id.generalQ).status === 'new', pr.text);
  await p(id.generalOld, { admin_notes: 'legacy whole note' });
  check('change: an older caller may still set the notes whole', row(id.generalOld).admin_notes === 'legacy whole note');
}

// ======== notes ========
{
  const n = (text, actor = 'Priya') => call(`/api/admin/inquiries/${id.generalQ}/note`, { method: 'POST', body: { text }, admin: true, actor });
  check('note: an empty note is refused', (await n('  ')).status === 400);
  await n('Called her, will send the agenda');
  const r = await n('Agenda sent', 'Anita Ram');
  const notes = row(id.generalQ).admin_notes;
  check('note: notes add up, each with who and when', notes.includes('Called her, will send the agenda') && notes.includes('Agenda sent') && /\[note \d+ Nov 2026, [^\]]+ by Priya\]/.test(notes) && /by Anita Ram\]/.test(notes) && r.json.admin_notes === notes, notes);
}

// ======== replies ========
{
  mail.length = 0;
  const target = mk({ inquiry_type: 'booth_inquiry', name: 'Neha Iyer', email: 'neha@orbit.ai', organization: 'Orbit', created_at: ago(26) });
  const r = await call(`/api/admin/inquiries/${target}/reply`, { method: 'POST', body: { subject: 'Your booth, {first_name}', message: 'Hello {first_name} of {organisation}, ref {ref}. {owner} here.' }, ...A });
  const m = mailTo('neha@orbit.ai')[0];
  const after = row(target);
  check('reply: sent, with the saved-reply fields filled in for this person', r.status === 200 && m && m.Content.Subject === 'Your booth, Neha' && bodyOf(m).includes('Hello Neha of Orbit, ref BHAI-INQ-' + String(target).padStart(5, '0') + '. Priya here.'), bodyOf(m).slice(0, 900));
  check('reply: New becomes Replied, the reply time is kept, and the replier becomes the owner', after.status === 'responded' && !!after.responded_at && after.assigned_to === 'Priya', JSON.stringify(after));
  check('reply: a copy is kept in the notes, with who sent it', /\[replied [^\]]+ by Priya\] Hello Neha/.test(after.admin_notes), after.admin_notes);
  await call(`/api/admin/inquiries/${target}`, { method: 'PATCH', body: { status: 'won' }, ...A });
  await call(`/api/admin/inquiries/${target}/reply`, { method: 'POST', body: { message: 'Thank you' }, ...A });
  check('reply: a Won enquiry stays Won after another reply', row(target).status === 'won');
  const t2 = mk({ inquiry_type: 'general', name: 'No Owner', email: 'no@owner.in' });
  await call(`/api/admin/inquiries/${t2}/reply`, { method: 'POST', body: { message: 'Hi' }, admin: true });
  check('reply: the shared password without a name makes nobody the owner', row(t2).assigned_to === null && row(t2).status === 'responded');
  setMailDown(true);
  const t3 = mk({ inquiry_type: 'general', name: 'Fail', email: 'fail@x.in' });
  const f = await call(`/api/admin/inquiries/${t3}/reply`, { method: 'POST', body: { message: 'Hi' }, ...A });
  setMailDown(false);
  check('reply: when the email service fails, nothing changes and the failure is written down', f.status === 502 && row(t3).status === 'new' && audits(t3, 'inquiry.reply-failed').length === 1, f.text);
  check('reply: an empty reply is refused', (await call(`/api/admin/inquiries/${t3}/reply`, { method: 'POST', body: { message: ' ' }, ...A })).status === 400);
}

// ======== many at once ========
{
  const ids = [mk({ inquiry_type: 'speaking', name: 'Anil Rao', email: 'anil@a.in' }), mk({ inquiry_type: 'speaking', name: 'Bela Sen', email: 'bela@b.in', status: 'in_progress' }), mk({ inquiry_type: 'speaking', name: 'Chetan', email: 'chetan' })];
  const b = (body) => call('/api/admin/inquiries/bulk', { method: 'POST', body, ...A });
  check('bulk: nothing ticked, too many, nothing to change and a bad status are refused',
    (await b({ ids: [], set: { status: 'closed' } })).status === 400 && (await b({ ids: Array.from({ length: 301 }, (_, i) => i + 1), set: { status: 'closed' } })).status === 400 &&
    (await b({ ids, set: {} })).status === 400 && (await b({ ids, set: { status: 'nope' } })).status === 400);
  const r = await b({ ids, set: { assigned_to: 'Anita Ram' } });
  check('bulk: three given an owner in one go', r.status === 200 && r.json.changed === 3 && ids.every((x) => row(x).assigned_to === 'Anita Ram'), r.text);
  check('bulk: each gets its own history line saying it was one of three', ids.every((x) => audits(x, 'inquiry.bulk').length === 1 && JSON.parse(audits(x, 'inquiry.bulk')[0].detail).bulk === 3));
  mail.length = 0;
  const rr = await call('/api/admin/inquiries/bulk-reply', { method: 'POST', body: { ids, subject: 'Speaking at Bharat AI', message: 'Dear {first_name}, thank you.' }, ...A });
  check('bulk reply: each person gets their own email with their own name', rr.json.sent === 2 && bodyOf(mailTo('anil@a.in')[0]).includes('Dear Anil, thank you.') && bodyOf(mailTo('bela@b.in')[0]).includes('Dear Bela, thank you.'), rr.text);
  check('bulk reply: an address that is not one is listed, the rest go', rr.json.failed.length === 1 && rr.json.failed[0].id === ids[2] && rr.json.success === false);
  check('bulk reply: New became Replied, In talks stayed In talks', row(ids[0]).status === 'responded' && row(ids[1]).status === 'in_progress');
  check('bulk reply: more than 100 at once is refused', (await call('/api/admin/inquiries/bulk-reply', { method: 'POST', body: { ids: Array.from({ length: 101 }, (_, i) => i + 1), message: 'x' }, ...A })).status === 400);
}

// ======== history ========
{
  const a = (await call(`/api/admin/inquiries/${id.dup1}/activity`, { admin: true })).json;
  check('history: the other enquiries from the same address are listed', a.others.length === 2 && a.others.every((o) => [id.dup2, id.dup3].includes(o.id)), JSON.stringify(a.others));
  const g = (await call(`/api/admin/inquiries/${id.generalQ}/activity`, { admin: true })).json;
  check('history: notes and changes are in it, newest first', g.events.length >= 4 && g.events[0].action === 'inquiry.note' && g.events.some((e) => e.action === 'inquiry.update'), JSON.stringify(g.events.map((e) => e.action)));
  const pa = (await call(`/api/admin/inquiries/${id.sponsorPaid}/activity`, { admin: true })).json;
  check('history: who they are on the attendee list', pa.person?.badge_type === 'Delegate Pass');
  const bo = (await call(`/api/admin/inquiries/${id.boothBuyer}/activity`, { admin: true })).json;
  check('history: and their booth', bo.booth?.code === '12' && bo.booth?.status === 'confirmed');
}

// ======== settings ========
{
  const s = (body) => call('/api/admin/inquiry-settings', { method: 'PUT', body, ...A });
  check('settings: a saved reply needs a name and a message', (await s({ templates: [{ name: '', body: 'x' }] })).status === 400 && (await s({ templates: [{ name: 'X', body: '' }] })).status === 400);
  const t = await s({ templates: [{ id: 'one', name: 'One', body: 'b1', type: 'bogus' }, { id: 'one', name: 'Two', body: 'b2', type: 'media' }] });
  check('settings: two replies with one id are kept apart, and an unknown type means any type', t.status === 200 && t.json.settings.templates.length === 2 && t.json.settings.templates[0].id !== t.json.settings.templates[1].id && t.json.settings.templates[0].type === '' && t.json.settings.templates[1].type === 'media', JSON.stringify(t.json?.settings?.templates));
  const back = await s({ templates: 'reset' });
  check('settings: the starter replies come back', back.json.settings.templates.length === 11 && back.json.settings.templates.some((x) => x.id === 'speaking-booth'));
  check('settings: the time for a first reply is 1 to 168 hours', (await s({ sla_hours: 0 })).status === 400 && (await s({ sla_hours: 200 })).status === 400 && (await s({ sla_hours: 48 })).json.settings.sla_hours === 48);
  await s({ sla_hours: 24 });
  check('settings: nothing to save is said so', (await s({})).status === 400);
  const prev = (await call('/api/admin/inquiries/ack-preview?type=sponsorship', { admin: true })).json;
  check('settings: the acknowledgement can be looked at for a type', prev.html.includes('We have your enquiry') && prev.html.includes('/partner'));

  const open = mk({ inquiry_type: 'booth_inquiry', name: 'Route Me', email: 'r@me.in' });
  const owned = mk({ inquiry_type: 'booth_inquiry', name: 'Mine', email: 'm@me.in', assigned_to: 'Anita Ram' });
  const closed = mk({ inquiry_type: 'booth_inquiry', name: 'Closed', email: 'c@me.in', status: 'closed' });
  const ap = await call('/api/admin/inquiries/apply-routing', { method: 'POST', body: {}, ...A });
  check('rules now: an open booth enquiry with no owner gets Priya; one with an owner and a closed one are left alone',
    ap.status === 200 && row(open).assigned_to === 'Priya' && row(owned).assigned_to === 'Anita Ram' && row(closed).assigned_to === null && audits(open, 'inquiry.routing').length === 1, ap.text);
}

// ======== the morning summary ========
{
  const tick = () => call('/api/cron/tick', { method: 'POST', body: {}, headers: { Authorization: 'Bearer iq-admin' } });
  const summaries = () => mailTo('team@bharataiinnovation.com').filter((m) => m.Content.Subject.startsWith('Enquiries:'));
  const pv = (await call('/api/admin/inquiries/digest', { method: 'POST', body: { send: false }, ...A })).json;
  check('summary: looked at, not sent; it links each enquiry and counts what waits', mail.length >= 0 && pv.html.includes('/admin?inq=') && pv.counts.late >= 2 && pv.to === 'team@bharataiinnovation.com' && /^Enquiries: \d+ new, \d+ waiting over 24 h, \d+ hot$/.test(pv.subject), pv.subject);
  mail.length = 0;
  at('2026-11-13', '09:30');
  let t = await tick();
  check('summary: off by default, the clock sends nothing', t.json.inquiry_digest?.skipped === 'off' && summaries().length === 0, JSON.stringify(t.json.inquiry_digest));
  await call('/api/admin/inquiry-settings', { method: 'PUT', body: { digest: true }, ...A });
  at('2026-11-13', '08:40');
  t = await tick();
  check('summary: switched on, nothing before 9 in the morning in India', t.json.inquiry_digest?.skipped === 'before 9' && summaries().length === 0);
  at('2026-11-13', '09:01');
  t = await tick();
  check('summary: at 9 it goes to the team, once', t.json.inquiry_digest?.sent === true && summaries().length === 1, JSON.stringify(t.json.inquiry_digest));
  at('2026-11-13', '09:02');
  t = await tick();
  check('summary: the next minute knows it was sent today', t.json.inquiry_digest?.skipped === 'sent today' && summaries().length === 1);
  at('2026-11-14', '09:00');
  await tick();
  check('summary: the next morning it goes again', summaries().length === 2);
  const body = bodyOf(summaries()[1]);
  const waitBlock = body.slice(body.indexOf('Waiting for a first reply'));
  const firstLink = (waitBlock.match(/admin\?inq=(\d+)/) || [])[1];
  check('summary: the waiting ones, most valuable first (the Rs 3 lakh booth leads), ten at most, with an Open Inquiries button',
    Number(firstLink) === id.booth && /and \d+ more waiting/.test(waitBlock) && body.includes('Open Inquiries'), firstLink + ' ' + waitBlock.slice(0, 300));
  const sentRow = rows("SELECT * FROM admin_audit WHERE action = 'inquiry.digest' ORDER BY id DESC LIMIT 1")[0];
  check('summary: written in the history as automatic, with its counts', sentRow?.actor === 'automatic' && JSON.parse(sentRow.detail).late >= 2);
  const by = await call('/api/admin/inquiries/digest', { method: 'POST', body: { send: true }, ...A });
  check('summary: Send it now sends one more by hand', by.status === 200 && summaries().length === 3);
  at('2026-11-12', '10:00');
}

// ======== with 0053 ========
{
  const P = makeWorld({ pipeline: true });
  const pid = P.insert('inquiries', { event_id: 1, inquiry_type: 'booth_inquiry', name: 'Ravi', email: 'ravi@acme.in', organization: 'Acme', status: 'new', metadata: '{}', created_at: P.ago(2) });
  const pid2 = P.insert('inquiries', { event_id: 1, inquiry_type: 'general', name: 'Q', email: 'q@gmail.com', status: 'new', metadata: '{}', created_at: P.ago(2) });
  const p = (iid, body) => P.call('/api/admin/inquiries/' + iid, { method: 'PATCH', body, ...A });
  const get = async (iid) => ((await P.call('/api/admin/inquiries', { admin: true })).json.inquiries || []).find((r) => r.id === iid);
  check('0053: the desk knows the table is there', (await P.call('/api/admin/inquiries', { admin: true })).json.pipeline_ready === true);
  check('0053: a value that is not rupees and a day that is not a day are refused', (await p(pid, { deal_value_inr: 'lots' })).status === 400 && (await p(pid, { next_action_at: '15/11/2026' })).status === 400 && (await p(pid, { priority: 'urgent' })).status === 400);
  await p(pid, { deal_value_inr: '1,80,000', next_action_at: '2026-11-12', next_action: 'Send the invoice' });
  let r = await get(pid);
  check('0053: the value typed with Indian commas is kept as rupees, and replaces any estimate', r.deal_value_inr === 180000 && r.value_inr === 180000 && r.value_estimated === false, JSON.stringify(r));
  check('0053: a follow-up due today raises the score and says so', r.why.includes('follow-up due today') && r.next_action === 'Send the invoice', JSON.stringify(r.why));
  await p(pid2, { priority: 'hot' });
  r = await get(pid2);
  check('0053: marked hot by hand is Hot, and the reason says it was a person', r.band === 'hot' && r.why[0] === 'marked hot', JSON.stringify(r));
  await p(pid, { status: 'won' });
  const won = P.rows('SELECT * FROM inquiry_pipeline WHERE inquiry_id = ?', [pid])[0];
  check('0053: Won is dated', !!won.closed_at && won.deal_value_inr === 180000, JSON.stringify(won));
  await p(pid, { status: 'in_progress' });
  check('0053: opened again, the date is cleared', P.rows('SELECT closed_at FROM inquiry_pipeline WHERE inquiry_id = ?', [pid])[0].closed_at === null);
  await p(pid, { status: 'lost', lost_reason: 'Price' });
  check('0053: Lost keeps its reason', P.rows('SELECT lost_reason, closed_at FROM inquiry_pipeline WHERE inquiry_id = ?', [pid])[0].lost_reason === 'Price');
  const bk = await P.call('/api/admin/inquiries/bulk', { method: 'POST', body: { ids: [pid, pid2], set: { priority: 'cold' } }, ...A });
  check('0053: many marked cold at once', bk.status === 200 && P.rows("SELECT COUNT(*) AS n FROM inquiry_pipeline WHERE priority = 'cold'")[0].n === 2);
  await P.call('/api/admin/inquiries/' + pid2, { method: 'DELETE', admin: true });
  check('0053: deleting an enquiry deletes its commercial row', P.rows('SELECT COUNT(*) AS n FROM inquiry_pipeline WHERE inquiry_id = ?', [pid2])[0].n === 0);
  let twice = true;
  try { P.db.exec((await import('node:fs')).readFileSync(new URL('../../migrations/0053_inquiry_pipeline.sql', import.meta.url), 'utf8')); } catch { twice = false; }
  check('0053: the migration is safe to run twice', twice);
  const pid3 = P.insert('inquiries', { event_id: 1, inquiry_type: 'sponsorship', name: 'Due', email: 'due@co.in', organization: 'Co', status: 'in_progress', metadata: '{}', created_at: P.ago(50) });
  await p(pid3, { next_action_at: '2026-11-11' });
  const dg = (await P.call('/api/admin/inquiries/digest', { method: 'POST', body: {}, ...A })).json;
  check('0053: the summary lists follow-ups due today or earlier', dg.counts.due === 1 && dg.html.includes('Follow-ups due today or earlier') && dg.html.includes('follow-up overdue'), JSON.stringify(dg.counts));
}

done();
