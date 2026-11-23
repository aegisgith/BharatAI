// Built-worker checks for Ask in Admin (24 Nov 2026, src/routes/admin-assist.ts): the
// route behind Ctrl+K and "Today at a glance", with Workers AI played here so what the
// model is given and what the organiser is shown can both be read back exactly.
// Covers: admin only; refusals (no question, a long one, no numbers); no AI binding;
// the model given totals only (a line with an address in it dropped, control characters
// and tags gone, at most 90 lines), the screens it may point to, the question or the
// briefing; an answer whose every number is in the totals shown, Indian grouping and
// dates read as numbers; an answer with a number the totals do not hold held back; the
// second model when the first fails, nothing when both do; a reply in plain words, as an
// object, with markdown; and the page carrying the shell (groups, bottom bar, script).
// Run after `npm run build`:  node scripts/verify/smoke-admin-assist.mjs
import { talksWorld, checker, ADMIN } from './talks-world.mjs';

const { check, done } = checker();
const W = await talksWorld({ seedTalks: false });
const { hit, as, env } = W;

const FACTS = {
  asOf: '24 Nov 2026, 1:28 am IST',
  event: 'Bharat AI Innovation 2026, World Trade Center, Mumbai, 2026-11-20 to 2026-11-21',
  lines: [
    { k: 'Registered for the conference, everyone', v: 2793, s: 'attendees' },
    { k: 'Checked in at the badge desk', v: 612, s: 'badge-desk' },
    { k: 'Passes paid online', v: '34 passes, ₹4,51,900 with GST (₹68,935 of it GST)', s: 'payments' },
    { k: 'Waiting on you: chose a paid pass and have not paid: remind them to pay', v: 24, s: 'payments' },
    { k: 'Waiting on you: new enquiries to answer', v: 4, s: 'inquiries' },
    { k: 'Waiting on you, in all', v: 72, s: 'overview' },
    { k: 'A line with a person in it', v: 'rajib@technocracy.sg', s: 'attendees' },
    { k: 'Odd <b>markup</b>\u0007 here', v: 5, s: 'not-a-screen' },
  ],
};

// ---------- Workers AI, played ----------
let calls = [];
let reply = null; // what the next run answers; a function gets (model, input)
const AI = { run: async (model, input) => { calls.push({ model, input }); const r = typeof reply === 'function' ? reply(model, input) : reply; if (r instanceof Error) throw r; return r; } };
const ask = (body) => as('POST', '/api/admin/assist', body);

// ---------- who may ask, and what is refused ----------
let r = await hit('POST', '/api/admin/assist', { q: 'hi', facts: FACTS });
check('signed out: 401', r.status === 401, r.status + ' ' + r.text);
r = await ask({ q: '', facts: FACTS });
check('no question: 400 in words', r.status === 400 && /question/i.test(r.json?.error), r.text);
r = await ask({ q: 'x'.repeat(301), facts: FACTS });
check('a question over 300 characters: 400', r.status === 400 && /300/.test(r.json?.error), r.text);
r = await ask({ q: 'How many came?', facts: { lines: [] } });
check('no numbers sent with it: 400', r.status === 400 && /numbers/i.test(r.json?.error), r.text);
r = await ask({ q: 'How many came?', facts: { lines: [{ k: 'only an address', v: 'a@b.co' }] } });
check('a line that is only an address is not a number to answer from: 400', r.status === 400, r.text);

// ---------- no AI binding: the page answers from the totals ----------
r = await ask({ q: 'How many came?', facts: FACTS });
check('without Workers AI: ok, ai false, said why', r.status === 200 && r.json?.ok === true && r.json?.ai === false && r.json?.why === 'not_configured', r.text);

env.AI = AI;

// ---------- an answer that holds ----------
reply = { response: JSON.stringify({ answer: '612 people have checked in so far, out of 2,793 registered. Paid online: ₹4,51,900 for 34 passes.', open: ['badge-desk', 'nonsense', 'payments', 'badge-desk'] }) };
calls = [];
r = await ask({ q: 'How many have checked in?', facts: FACTS });
check('an answer whose numbers are all in the totals is shown', r.status === 200 && r.json?.ai === true && /612 people have checked in/.test(r.json?.answer), r.text);
check('...its screens kept only when real, once each, in order', JSON.stringify(r.json?.open) === '["badge-desk","payments"]', JSON.stringify(r.json?.open));
check('...the first model asked first, with a low temperature', calls.length === 1 && calls[0].model === '@cf/meta/llama-3.3-70b-instruct-fp8-fast' && calls[0].input.temperature <= 0.2 && r.json?.model === calls[0].model, JSON.stringify(calls.map(c => c.model)));
const sys = calls[0].input.messages[0].content, user = calls[0].input.messages[1].content;
check('the model is told to use only the totals and to copy numbers', /ONLY from the FACTS/.test(sys) && /Copy every number exactly/.test(sys) && /Reply with JSON only/.test(sys), sys.slice(0, 300));
check('...and the screens it may point to', /badge-desk = Badge Desk/.test(sys) && /marketplace = AI Marketplace/.test(sys) && /settings = Settings/.test(sys));
check('the model is given the totals and the question', /Checked in at the badge desk: 612 \[screen: badge-desk\]/.test(user) && /QUESTION: How many have checked in\?/.test(user) && /As of: 24 Nov 2026/.test(user), user.slice(0, 400));
check('no address reaches the model: the line with one is dropped', !/@/.test(user) && !/rajib/.test(user), user);
check('tags and control characters are gone, and an unknown screen is not passed on', /Odd b markup \/b here: 5/.test(user) && !/<b>/.test(user) && !/\u0007/.test(user) && !/not-a-screen/.test(user), user.match(/Odd[^\n]*/)?.[0]);

// ---------- numbers the totals do not hold ----------
reply = { response: JSON.stringify({ answer: 'About ₹5,00,000 came in online.', open: ['payments'] }) };
r = await ask({ q: 'How much came in?', facts: FACTS });
check('an answer with a number the totals do not hold is held back', r.json?.ai === false && r.json?.why === 'unchecked_numbers' && !('answer' in r.json) && JSON.stringify(r.json?.open) === '["payments"]', r.text);
reply = { response: JSON.stringify({ answer: '22% of people checked in.', open: [] }) };
r = await ask({ q: 'What share checked in?', facts: FACTS });
check('a percentage worked out by the model is held back', r.json?.ai === false && r.json?.why === 'unchecked_numbers', r.text);
reply = { response: JSON.stringify({ answer: 'Two things lead: 24 people to remind to pay and 4 enquiries; 72 in all. The event ran on 20 and 21 Nov 2026.', open: ['overview'] }) };
r = await ask({ q: 'What is waiting?', facts: FACTS });
check('counts up to ten, dates from the event line and the totals pass', r.json?.ai === true, r.text);
reply = { response: JSON.stringify({ answer: 'You asked about 3000 people: 2,793 are registered.', open: [] }) };
r = await ask({ q: 'Do we have 3000 people?', facts: FACTS });
check('a number from the question itself may be repeated', r.json?.ai === true, r.text);
reply = { response: JSON.stringify({ answer: '15 people are on the waiting list.', open: [] }) };
r = await ask({ q: 'Who waits?', facts: FACTS });
check('a number over ten that the totals do not hold (15) is held back', r.json?.ai === false, r.text);

// ---------- the models ----------
calls = [];
reply = (model) => model.includes('70b') ? new Error('model not found') : { response: '{"answer":"612 have checked in.","open":["badge-desk"]}' };
r = await ask({ q: 'Checked in?', facts: FACTS });
check('the first model failing: the second is asked', r.json?.ai === true && calls.length === 2 && calls[1].model === '@cf/meta/llama-3.1-8b-instruct' && r.json?.model === calls[1].model, JSON.stringify(calls.map(c => c.model)));
reply = () => new Error('down');
r = await ask({ q: 'Checked in?', facts: FACTS });
check('both failing: ok, ai false, unavailable', r.status === 200 && r.json?.ai === false && r.json?.why === 'unavailable', r.text);
reply = { response: '612 people have **checked in**.' };
r = await ask({ q: 'Checked in?', facts: FACTS });
check('a reply in plain words is used, its markdown gone, no screens', r.json?.ai === true && r.json?.answer === '612 people have checked in.' && JSON.stringify(r.json?.open) === '[]', r.text);
reply = { response: { answer: '72 things wait on you.', open: ['overview'] } };
r = await ask({ q: 'Waiting?', facts: FACTS });
check('a reply that is already an object is read', r.json?.ai === true && r.json?.answer === '72 things wait on you.', r.text);
reply = { response: '' };
r = await ask({ q: 'Waiting?', facts: FACTS });
check('an empty reply: ai false', r.json?.ai === false, r.text);

// ---------- the briefing ----------
calls = [];
reply = { response: '{"answer":"72 things are waiting: 24 to remind to pay first.","open":["payments"]}' };
r = await ask({ mode: 'brief', facts: FACTS });
check('the briefing needs no question and asks for at most three sentences of what is waiting', r.json?.ai === true && /briefing/.test(calls[0].input.messages[1].content) && /at most three short sentences/.test(calls[0].input.messages[1].content), r.text);

// ---------- many lines ----------
calls = [];
const many = { asOf: 'now', lines: Array.from({ length: 200 }, (_, i) => ({ k: 'Line ' + i, v: i })) };
reply = { response: '{"answer":"Line 5 is 5.","open":[]}' };
r = await ask({ q: 'Lines?', facts: many });
const given = (calls[0]?.input.messages[1].content.match(/^- Line/gm) || []).length;
check('at most 90 lines reach the model', given === 90, given);

// ---------- the page ----------
delete env.AI;
const page = (await hit('GET', '/admin')).text;
const js = (await as('GET', '/admin.js')).text;
check('the page loads the shell after Tailwind and after /admin.js', page.indexOf('/css/admin-shell.css?v=') > page.indexOf('tailwind') && page.indexOf('/js/admin-shell.js?v=') > page.indexOf('/admin.js?v='), '');
const sections = [...page.matchAll(/class="sidebar-btn[^"]*"[^>]*data-section="([^"]+)"/g)].map(m => m[1]);
check('all 26 screens are still in the sidebar, each once', sections.length === 26 && new Set(sections).size === 26 && sections.includes('settings') && sections.includes('boothleads'), sections.join(','));
check('...in six groups that can fold, with Overview first and Settings last', (page.match(/class="as-nav-group"/g) || []).length === 6 && sections[0] === 'overview' && sections[25] === 'settings' && /aria-expanded="true"><span>People<\/span>/.test(page), '');
check('...and every section has its place on the page', sections.every(s => page.includes('id="section-' + s + '"')), sections.filter(s => !page.includes('id="section-' + s + '"')).join(','));
check('the bottom bar for phones: Home, Attendees, Ask, Inbox, Menu', /id="as-tabbar"/.test(page) && /data-as-tab="overview"[^>]*>.*Home/.test(page) && /class="as-tab-ask" data-as-open/.test(page) && /data-as-tab="inquiries"/.test(page) && /data-as-tab="menu" onclick="openMobileSidebar\(\)"/.test(page), '');
const bar = page.slice(page.indexOf('id="as-tabbar"'), page.indexOf('</nav>', page.indexOf('id="as-tabbar"')));
check('no bottom-bar button carries data-section, so the sidebar stays the first match', bar.length > 100 && !bar.includes('data-section'), bar.slice(0, 200));
check('the Ask button in the top bar', /id="as-ask-btn" class="as-askbar" data-as-open/.test(page), '');
check('the page script tells the shell where you are and hands it the board', /if \(window\.AdminShell\) AdminShell\.onSection\(sec\);/.test(js) && /if \(window\.AdminShell\) AdminShell\.gotBoard\(b, ev\);/.test(js) && /if \(window\.AdminShell\) AdminShell\.onOverview\(stats\);/.test(js), '');
check('Booth Leads has a title of its own', /boothleads:'Booth Leads'/.test(js), '');
check('the Overview has the briefing, the jump bar and an id for each part', ['id="ov-brief"', 'id="ov-jump"', 'id="ov-audience"', 'id="ov-orgs"', 'id="ov-sources"', 'id="ov-lunch"', 'id="ov-engagement"', 'id="ov-rsvp"', 'id="ov-thanks"', 'id="ov-recent"', 'ov-kpis'].every(m => js.includes(m)), '');
check('the minute refresh leaves someone typing a question alone', /closest\('#ov-brief, #ov-jump'\)\) return;/.test(js), '');

done();
