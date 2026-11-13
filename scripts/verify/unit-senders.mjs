// Unit: who an admin email is sent from (13 Nov 2026). The event's own address by
// default; one of the organising team when picked, only on our own domain; a typed or
// forged address refused; a blind copy to the event's address when sent as a person.
// src/lib/senders.ts is compiled in memory with esbuild.
// Run:  node scripts/verify/unit-senders.mjs
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../../src/lib/senders.ts', import.meta.url));
const out = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent', mainFields: ['module', 'main'] });
const S = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + (typeof d === 'string' ? d : JSON.stringify(d)))); if (!ok) fails++; };

const OWN = { email: 'register@bharataiinnovation.com', name: 'Bharat AI Innovation Conference & Exhibition 2026' };
const TEAM = [
  { id: 108, name: 'Anita Ram', email: 'Anita.R@BharatAIInnovation.com ' },
  { id: 368, name: 'Ayesha Ahmed', email: 'ayesha.a@bharataiinnovation.com' },
  { id: 531, name: 'Rohit Outside', email: 'rohit@gmail.com' },
  { id: 1102, name: 'No Mail', email: '' },
  { id: 1200, name: 'Anita R (second pass)', email: 'anita.r@bharataiinnovation.com' },
  { id: 1201, name: 'Look Alike', email: 'x@bharataiinnovation.com.evil.io' },
  { id: 1202, name: 'Register Desk', email: 'register@bharataiinnovation.com' },
];

// ---- our domain ----
check('an address on our domain may send', S.onOurDomain('anita.r@bharataiinnovation.com') && S.onOurDomain(' Anita.R@BharatAIInnovation.com '));
for (const bad of ['rohit@gmail.com', 'x@bharataiinnovation.com.evil.io', 'x@evilbharataiinnovation.com', 'bharataiinnovation.com', '@bharataiinnovation.com', '', null, 'a b@bharataiinnovation.com', 'x@sub.bharataiinnovation.com.'])
  check(`not ours: ${JSON.stringify(bad)}`, !S.onOurDomain(bad));

// ---- the list ----
const { senders, outside } = S.senderList(OWN, TEAM);
check('the event’s own address comes first and is the default', senders[0].email === OWN.email && senders[0].default === true && senders.filter(s => s.default).length === 1, senders[0]);
check('team members on our domain are listed, lower-cased', senders.some(s => s.email === 'anita.r@bharataiinnovation.com' && s.person === 'Anita Ram') && senders.some(s => s.email === 'ayesha.a@bharataiinnovation.com'), senders);
check('one address is listed once (a second pass with the same address is not)', senders.filter(s => s.email === 'anita.r@bharataiinnovation.com').length === 1);
check('a team member holding the event’s own address does not list it twice', senders.filter(s => s.email === OWN.email).length === 1);
check('a person is shown with the event: "Anita Ram, Bharat AI Innovation"', senders.find(s => s.person === 'Anita Ram').name === 'Anita Ram, Bharat AI Innovation');
check('the list is exactly own + 2 team members', senders.length === 3, senders.map(s => s.email));
check('an outside address is listed apart, with the reason', outside.some(o => o.name === 'Rohit Outside' && /cannot be sent as them/.test(o.reason)), outside);
check('a look-alike domain is outside', outside.some(o => o.name === 'Look Alike'), outside);
check('no address on the pass says so', outside.some(o => o.name === 'No Mail' && /No email address/.test(o.reason)), outside);
check('nobody on the team: just the event’s own address', S.senderList(OWN, []).senders.length === 1);

// ---- picking ----
check('nothing picked = the default', S.pickFrom(senders, '').email === OWN.email && S.pickFrom(senders, null).email === OWN.email && S.pickFrom(senders, undefined).email === OWN.email);
check('a listed person is picked by address, any case', S.pickFrom(senders, ' ANITA.R@bharataiinnovation.com').person === 'Anita Ram');
check('a typed address that is not on the list is refused', S.pickFrom(senders, 'ceo@bharataiinnovation.com') === null);
check('an outside team member cannot be picked', S.pickFrom(senders, 'rohit@gmail.com') === null);

// ---- the envelope ----
let e = S.sendAs(OWN, null, 'speaker@company.com');
check('no sender picked: exactly the old From, no copy', e.ok && e.from === 'Bharat AI Innovation Conference & Exhibition 2026 <register@bharataiinnovation.com>' && e.bcc.length === 0, e);
e = S.sendAs(OWN, { email: 'REGISTER@bharataiinnovation.com', name: 'whatever' }, 'speaker@company.com');
check('the event’s own address picked: the old From, no copy', e.ok && e.from.startsWith('Bharat AI Innovation Conference') && e.bcc.length === 0, e);
e = S.sendAs(OWN, { email: 'anita.r@bharataiinnovation.com', name: 'Anita Ram, Bharat AI Innovation' }, 'speaker@company.com');
check('as a person: their quoted name and address', e.ok && e.from === '"Anita Ram, Bharat AI Innovation" <anita.r@bharataiinnovation.com>', e);
check('as a person: a blind copy to the event’s own address', e.ok && e.bcc.join() === 'register@bharataiinnovation.com', e);
e = S.sendAs(OWN, { email: 'anita.r@bharataiinnovation.com', name: 'Anita Ram' }, 'Register@bharataiinnovation.com');
check('no copy when the email is to the event’s own address anyway', e.ok && e.bcc.length === 0, e);
e = S.sendAs(OWN, { email: 'rohit@gmail.com', name: 'Rohit' }, 'speaker@company.com');
check('an outside address is refused, in plain words', !e.ok && /only be sent from an @bharataiinnovation.com address/.test(e.error), e);
e = S.sendAs(OWN, { email: 'anita.r@bharataiinnovation.com', name: 'Evil" <x@evil.io>\r\nBcc: all@x.com' }, 'speaker@company.com');
check('a name cannot break out of the From header', e.ok && !/[\r\n]/.test(e.from) && (e.from.match(/"/g) || []).length === 2 && (e.from.match(/</g) || []).length === 1 && e.from.endsWith('<anita.r@bharataiinnovation.com>'), e);
check('a long name is cut to 70 characters', S.headerName('x'.repeat(200)).length === 70);
check('Dr. and commas stay inside the quotes', S.fromHeader({ email: 'a@bharataiinnovation.com', name: 'Dr. K. Rao, Bharat AI Innovation' }) === '"Dr. K. Rao, Bharat AI Innovation" <a@bharataiinnovation.com>');

// ---- through a database ----
const db = { prepare: (sql) => ({ bind: (...args) => ({ all: async () => { check('the team is read for the event asked about', args[0] === 2 && /badge_type/.test(sql), args); return { results: TEAM }; } }) }) };
const r = await S.sendersFor(db, 2, OWN);
check('sendersFor reads the team and builds the list', r.senders.length === 3 && r.outside.length >= 3, r);
const p = await S.pickSender(db, 2, OWN, 'ayesha.a@bharataiinnovation.com');
check('pickSender finds a team member', p && p.person === 'Ayesha Ahmed', p);
const none = await S.pickSender({ prepare: () => { throw new Error('no read needed'); } }, 2, OWN, '');
check('pickSender with nothing picked needs no read and gives the default', none && none.default === true, none);
const broken = await S.pickSender({ prepare: () => { throw new Error('db down'); } }, 2, OWN, 'anita.r@bharataiinnovation.com');
check('with the team unreadable, a person is refused (never sent as somebody unchecked)', broken === null, broken);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
