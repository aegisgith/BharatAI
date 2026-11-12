// Unit: the enquiry desk's own rules, each alone (12 Nov 2026). The page script
// public/js/admin-inquiries.js is run in node:vm as a browser would load it, and its
// pure parts (InqDesk._t) are checked against a table of cases: money in lakhs, ages,
// reply fields, spreadsheet safety, search, the smart views, the insights and the
// advice, notes and history in words. No worker, no database, no browser.
import { deskFunctions, check, done, RealDate } from './inquiry-world.mjs';

const T = deskFunctions();
const NOW = RealDate.parse('2026-11-12T10:00:00+05:30');            // Thursday
const iso = (hoursAgo) => new RealDate(NOW - hoursAgo * 3600000).toISOString().slice(0, 19).replace('T', ' ');
const C = { now: NOW, today: '2026-11-12', sla: 24, me: 'Priya', settings: { routing: {} } };
const r = (o) => ({ id: 1, inquiry_type: 'general', status: 'new', name: 'Asha Rao', email: 'asha@x.in', organization: '', phone: '', subject: '', message: '', admin_notes: '', assigned_to: null, score: 10, band: 'cold', why: [], dup_count: 0, suggested_type: '', value_inr: 0, created_at: iso(1), metadata: '{}', ...o });

// ---- money, time, words ----
check('rupees: Indian grouping', T.indian(150000) === '1,50,000' && T.indian(25000000) === '2,50,00,000' && T.indian(999) === '999' && T.indian(48000) === '48,000');
check('rupees: lakhs and crores the way the team says them', T.inr(150000) === '₹1.5 L' && T.inr(48000) === '₹48,000' && T.inr(25000000) === '₹2.5 Cr' && T.inr(0) === '—');
check('age: just now, hours, one day, days', T.fmtAge(0.5) === 'just now' && T.fmtAge(5) === '5 h' && T.fmtAge(30) === '1 day' && T.fmtAge(100) === '4 days');
check('reply time: minutes, hours, days', T.fmtHours(0.25) === '15 min' && T.fmtHours(5.04) === '5 h' && T.fmtHours(72) === '3 days' && T.fmtHours(null) === '—');
check('a SQLite time with no zone is read as UTC', T.parseTs('2026-11-12 04:30:00') === NOW && T.hoursSince('2026-11-12 03:30:00', NOW) === 1);
check('escaping: a name with markup is shown, never run', T.esc('<img src=x onerror=alert(1)> "A" & \'B\'') === '&lt;img src=x onerror=alert(1)&gt; &quot;A&quot; &amp; &#39;B&#39;');

// ---- saved-reply fields, as the server fills them ----
check('fields: first name, organisation, owner and reference', T.merge('Hi {first_name} of {organisation}, {owner}, {ref}', r({ id: 573, name: 'Asha Rao', organization: 'Tata AI' }), 'Priya') === 'Hi Asha of Tata AI, Priya, BHAI-INQ-00573');
check('fields: nothing known reads naturally', T.merge('{first_name} {organization} {owner}', r({ name: '', organization: '' }), '') === 'there your organisation Team Bharat AI Innovation');

// ---- spreadsheets ----
check('csv: a cell that would be a formula is made text', T.csvCell('=HYPERLINK("x")') === '"\'=HYPERLINK(""x"")"' && T.csvCell('+91 98200') === '"\'+91 98200"' && T.csvCell('-1') === '"\'-1"' && T.csvCell('@cmd') === '"\'@cmd"');
check('csv: plain text untouched, quotes doubled', T.csvCell('He said "hi"') === '"He said ""hi"""' && T.csvCell(null) === '""');
const csv = T.toCsv([r({ id: 7, message: '=1+1', why: ['company email', 'waiting 3 days'], band: 'hot', score: 72 })]);
check('csv: opens in Excel as Unicode, with a header and the reference', csv.charCodeAt(0) === 0xfeff && csv.slice(1).split('\r\n')[0].startsWith('"Ref","Received (India)"') && csv.includes('"BHAI-INQ-00007"') && csv.includes('"\'=1+1"') && csv.includes('"company email; waiting 3 days"'));

// ---- search ----
const s1 = r({ id: 573, name: 'Rida Dange', email: 'ridadange2408@gmail.com', phone: '+91 99204 32519', organization: 'Aegis', message: 'want to ask about events' });
check('search: every word, any order', T.matchesSearch(s1, 'events rida') && T.matchesSearch(s1, 'AEGIS dange') && !T.matchesSearch(s1, 'rida booth'));
check('search: a phone number however it is typed', T.matchesSearch(s1, '9920432519') && T.matchesSearch(s1, '99204 32519') && !T.matchesSearch(s1, '1234'));
check('search: by number and by reference', T.matchesSearch(s1, '#573') && T.matchesSearch(s1, 'bhai-inq-00573') && T.matchesSearch(s1, ''));

// ---- views ----
const rows = [
  r({ id: 1, band: 'hot', score: 80, inquiry_type: 'sponsorship', created_at: iso(30), assigned_to: 'Priya' }),
  r({ id: 2, band: 'cold', score: 10, created_at: iso(2) }),
  r({ id: 3, band: 'warm', score: 40, status: 'responded', created_at: iso(50), responded_at: iso(45) }),
  r({ id: 4, band: 'done', score: 0, status: 'won', created_at: iso(400) }),
  r({ id: 5, band: 'cold', score: 12, suggested_type: 'speaking', created_at: iso(5), dup_count: 1 }),
  r({ id: 6, band: 'warm', score: 50, status: 'in_progress', next_action_at: '2026-11-11', assigned_to: 'Anita' }),
];
const view = (v, extra = {}) => T.filterRows(rows, { view: v, q: '', type: '', status: '', owner: '', sort: 'priority', ...extra }, C).map((x) => x.id);
check('view: Needs a reply is the New ones', JSON.stringify(view('needs_reply')) === '[1,5,2]', view('needs_reply'));
check('view: Waiting too long is New past the time allowed', JSON.stringify(view('late')) === '[1]');
check('view: Hot, No owner, Mine', JSON.stringify(view('hot')) === '[1]' && JSON.stringify(view('unowned').sort()) === '[2,3,5]' && JSON.stringify(view('mine')) === '[1]', [view('unowned'), view('mine')]);
check('view: Follow-ups due today or earlier', JSON.stringify(view('due')) === '[6]');
check('view: Wrong type?, Wrote more than once, All open, Everything', JSON.stringify(view('suggested')) === '[5]' && JSON.stringify(view('dups')) === '[5]' && view('open').length === 5 && view('all').length === 6);
check('order: most important first, then the oldest waiting', JSON.stringify(view('all')) === '[1,6,3,5,2,4]', view('all'));
check('order: newest, oldest, highest value', view('all', { sort: 'newest' })[0] === 6 && view('all', { sort: 'oldest' })[0] === 4);
check('search looks at everything, whatever the view', JSON.stringify(view('needs_reply', { q: 'asha won' })) === '[]' && view('hot', { q: 'asha' }).length === 6);
check('filters: type, status and nobody as owner', JSON.stringify(view('all', { type: 'sponsorship' })) === '[1]' && JSON.stringify(view('all', { status: 'won' })) === '[4]' && view('all', { owner: '__none' }).length === 4 && JSON.stringify(view('all', { owner: 'priya' })) === '[1]');

// ---- insights ----
const ins = T.computeInsights([
  ...rows,
  r({ id: 7, inquiry_type: 'booth_inquiry', status: 'won', value_inr: 150000, created_at: iso(200), responded_at: iso(190), known_paid: true, email: 'won@co.in' }),
  r({ id: 8, inquiry_type: 'booth_inquiry', status: 'lost', lost_reason: 'Price', created_at: iso(300), responded_at: iso(260), email: 'lost@co.in' }),
  r({ id: 9, inquiry_type: 'speaking', created_at: '2026-11-08 18:29:00', email: 'sun@x.in' }),   // Sunday 23:59 India: last week
  r({ id: 10, inquiry_type: 'speaking', created_at: '2026-11-08 18:31:00', email: 'mon@x.in' }),  // Monday 00:01 India: this week
], NOW, '2026-11-12', 24);
check('insights: ten weeks, Monday to Sunday in India', ins.weeks.length === 10 && ins.weeks[9].label === '9 Nov' && ins.weeks[8].label === '2 Nov', ins.weeks.map((w) => w.label));
check('insights: a minute either side of midnight on Sunday falls in the right week', ins.weeks[9].programme === 1 && ins.weeks[8].programme >= 1, [ins.weeks[8], ins.weeks[9]]);
check('insights: the typical first reply (median) and the share within the time allowed', Math.abs(ins.medianReply - 10) < 0.01 && ins.inSlaPct === 67, [ins.medianReply, ins.inSlaPct]);
check('insights: won and lost, value and win rate', ins.won === 2 && ins.lost === 1 && ins.wonValue === 150000 && ins.winRate === 67, [ins.won, ins.lost, ins.wonValue, ins.winRate]);
check('insights: from enquiry to sale for the sales types', ins.funnel.revenue.received === 3 && ins.funnel.revenue.replied === 2 && ins.funnel.revenue.talking === 2 && ins.funnel.revenue.won === 1, ins.funnel.revenue);
check('insights: how long the unanswered have waited (2 h and 5 h; 30 h; the two from Sunday night)', JSON.stringify(ins.aging.map((a) => a.n)) === '[2,1,2,0]', ins.aging);
check('insights: owners, with Nobody last', ins.owners[ins.owners.length - 1].owner === 'Nobody' && ins.owners.find((o) => o.owner === 'Priya').late === 1);
check('insights: already customers counted once per sender', ins.customers === 1 && ins.senders === 5, [ins.customers, ins.senders]);
check('insights: why deals were lost', ins.lostReasons[0].label === 'Price' && ins.lostReasons[0].n === 1);
check('insights: where they come from, a form that did not say is the contact form', ins.sources[0].label === 'Contact form');

// ---- advice ----
const many = Array.from({ length: 12 }, (_, i) => r({ id: 100 + i, inquiry_type: 'speaking', email: 'sp' + i + '@x.in' }));
const adv = T.advise([...rows, ...many], C);
check('advice: hot leads first, with what they are worth', adv[0].key === 'hot' && adv[0].action === 'view:hot');
check('advice: people who wrote more than once, when there is room for it', T.advise([r({ dup_count: 1, assigned_to: 'Priya' })], C).some((a) => a.key === 'dups' && a.action === 'view:dups'));
check('advice: follow-ups due, wrong types to move, speaking requests to answer at once', ['due', 'suggested', 'speaking'].every((k) => adv.some((a) => a.key === k)) && adv.find((a) => a.key === 'suggested').action === 'move-all', adv.map((a) => a.key));
check('advice: with no rules and many without an owner, it says to set owners', adv.some((a) => a.key === 'owners' && a.action === 'tab:automation'));
const adv2 = T.advise([...rows, ...many], { ...C, settings: { routing: { speaking: 'Anita' } } });
check('advice: with a rule, it offers to give them their owner', adv2.some((a) => a.key === 'route' && a.action === 'apply-routing') && !adv2.some((a) => a.key === 'owners'));
check('advice: never more than five lines, and nothing when all is well', adv.length <= 5 && T.advise([r({ status: 'responded', assigned_to: 'Priya', band: 'cold' })], C).length === 0);

// ---- notes and history ----
const notes = T.parseNotes('old free note\n[replied 12 Nov 2026, 10:01 am IST by Priya] Dear Asha\nsecond line of the reply\n[note 12 Nov 2026, 11:00 am IST] Called');
check('notes: an old note, a reply over two lines, a note', notes.length === 3 && notes[0].kind === 'old' && notes[1].kind === 'replied' && notes[1].text === 'Dear Asha\nsecond line of the reply' && notes[1].meta.includes('by Priya') && notes[2].kind === 'note', JSON.stringify(notes));
check('history in words: a change, one of many, a reply, the automatic email',
  T.auditWords({ action: 'inquiry.update', detail: '{"status":"won","assigned_to":"Priya"}' }) === 'Changed status to Won, owner to Priya' &&
  T.auditWords({ action: 'inquiry.bulk', detail: '{"inquiry_type":"speaking","bulk":12}' }) === 'Changed type to Speaking (with 11 others)' &&
  T.auditWords({ action: 'inquiry.reply', detail: '{"subject":"Your booth"}' }) === 'Reply emailed: Your booth' &&
  T.auditWords({ action: 'inquiry.autoack', detail: '{}' }).startsWith('Automatic'));

done();
