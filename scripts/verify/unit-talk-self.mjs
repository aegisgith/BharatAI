// Unit: a speaker's own talk page (12 Nov 2026), each rule alone, no server. The link's
// signature and expiry, what the page accepts and refuses in plain words, what it
// never shows. src/routes/talk-self.ts is compiled in memory with esbuild.
// Run:  node scripts/verify/unit-talk-self.mjs
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../../src/routes/talk-self.ts', import.meta.url));
const out = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent', mainFields: ['module', 'main'] });
const T = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + (typeof d === 'string' ? d : JSON.stringify(d)))); if (!ok) fails++; };
const NOW = 1794470000;

// ---- the link ----
const tok = await T.signTalkToken('secret-1', 42, NOW + 3600);
check('a link names the talk and an expiry, and is signed', /^42\.\d{10}\.[0-9a-f]{32}$/.test(tok), tok);
let r = await T.readTalkToken('secret-1', tok, NOW);
check('our own link opens its talk', r.id === 42, r);
r = await T.readTalkToken('secret-1', tok.replace(/^42\./, '43.'), NOW);
check('another talk number in the same link is refused', r.error === 'bad', r);
const [id, exp, sig] = tok.split('.');
r = await T.readTalkToken('secret-1', `${id}.${Number(exp) + 86400 * 365}.${sig}`, NOW);
check('a link with its expiry pushed back is refused', r.error === 'bad', r);
r = await T.readTalkToken('secret-2', tok, NOW);
check('a link signed with another key is refused', r.error === 'bad', r);
r = await T.readTalkToken('secret-1', tok, NOW + 7200);
check('an expired link says so (not "bad")', r.error === 'expired', r);
for (const junk of ['', null, '42', '42.abc.def', `42.${NOW}.${'z'.repeat(32)}`, `<script>.${NOW}.${'a'.repeat(32)}`]) {
  r = await T.readTalkToken('secret-1', junk, NOW);
  check(`a malformed link is refused: ${JSON.stringify(junk).slice(0, 24)}`, r.error === 'bad', r);
}
r = await T.readTalkToken('', tok, NOW);
check('with no key set, nothing opens', r.error === 'bad', r);
check('a link lasts a month', T.LINK_DAYS === 30);

// ---- what may be saved ----
let c = T.cleanFields({ topic: '  Secure AI at scale  ', speaker_title: 'Engineering Manager', speaker_bio: 'Line one.\r\nLine two.', speaker_phone: '+91 98200 12345', showcase: '', company: 'Trust3 AI' });
check('the six things a speaker sends are kept, trimmed', c.set.topic === 'Secure AI at scale' && c.set.speaker_title === 'Engineering Manager' && c.set.company === 'Trust3 AI' && !c.error, c);
check('a mobile is kept as digits, with its + if it had one', c.set.speaker_phone === '+919820012345', c.set.speaker_phone);
check('Windows line breaks in the bio become plain ones', c.set.speaker_bio === 'Line one.\nLine two.', c.set.speaker_bio);
check('an empty optional box clears it', c.set.showcase === '');
c = T.cleanFields({ speaker_name: 'Someone Else', hall: 'Kalam Theatre', starts_at: '2026-11-20 09:00', time_slot: 'x', speaker_email: 'a@b.c', status: 'cancelled', exhibitor_id: 9, notes: 'x' });
check('name, hall, time, email, status and notes are never taken from the page', Object.keys(c.set).length === 0, c.set);
c = T.cleanFields({ company: '   ' });
check('a company cannot be blanked from a link', !('company' in c.set), c.set);
const refused = [
  [{ speaker_phone: '12345' }, 'speaker_phone', 'at least 10 digits'],
  [{ speaker_phone: '1'.repeat(16) }, 'speaker_phone', 'at least 10 digits'],
  [{ speaker_bio: 'See https://me.example' }, 'speaker_bio', 'plain text'],
  [{ speaker_bio: 'Hi <img src=x onerror=alert(1)>' }, 'speaker_bio', 'plain text'],
  [{ topic: 'x'.repeat(201) }, 'topic', 'at most 200'],
  [{ speaker_bio: 'x'.repeat(801) }, 'speaker_bio', 'at most 800'],
  [{ showcase: 'x'.repeat(1001) }, 'showcase', 'at most 1000'],
];
for (const [body, field, words] of refused) {
  c = T.cleanFields(body);
  check(`refused, ${field}: says so in plain words and names the box`, c.field === field && String(c.error).includes(words), c);
}
check('the limits are the Innovation Talks tab’s (topic 200, bio 800, showcase 1000, phone 30)', T.FIELDS.topic.max === 200 && T.FIELDS.speaker_bio.max === 800 && T.FIELDS.showcase.max === 1000 && T.FIELDS.speaker_phone.max === 30);

// ---- only what the speaker changed (the page sends every box on Save) ----
const stored = { topic: 'AI at Scale', speaker_bio: 'x'.repeat(750) + ' see https://site.example', speaker_phone: '98200 11111 / 98200 22222', showcase: '', company: 'Acme' };
let ch = T.changedOnly({ topic: 'AI at Scale', speaker_bio: stored.speaker_bio, speaker_phone: stored.speaker_phone, showcase: '', company: 'Acme', speaker_title: 'CTO' }, stored);
check('boxes left as the organisers wrote them are not checked or saved again', Object.keys(ch).join() === 'speaker_title', ch);
check('...so a long bio with a link and two numbers in the phone box never block a save', !T.cleanFields(ch).error && T.cleanFields(ch).set.speaker_title === 'CTO');
ch = T.changedOnly({ speaker_bio: stored.speaker_bio + ' more' }, stored);
check('a box they did change is checked in full', T.cleanFields(ch).field === 'speaker_bio', T.cleanFields(ch));
ch = T.changedOnly({ topic: ' AI at Scale \r\n' }, { topic: 'AI at Scale' });
check('spaces and line endings alone are not a change', Object.keys(ch).length === 0, ch);
ch = T.changedOnly({ speaker_title: 'CTO', speaker_name: 'X', hall: 'Y' }, {});
check('only the page’s own boxes are compared', Object.keys(ch).join() === 'speaker_title', ch);
check('nothing sent, nothing to save', Object.keys(T.cleanFields({}).set).length === 0 && Object.keys(T.cleanFields(null).set).length === 0);

// ---- what is missing, and what the page shows ----
const full = { topic: 'T', speaker_title: 'D', company: 'C', speaker_photo_url: '/api/uploads/talks/1.jpg', speaker_bio: 'B', speaker_phone: '+919820012345' };
check('a talk with everything is missing nothing', T.missingOf(full).length === 0);
check('the missing list is the tab’s, in its order', T.missingOf({ topic: 'T' }).join() === 'speaker_title,company,speaker_photo_url,speaker_bio,speaker_phone', T.missingOf({ topic: 'T' }));
const v = T.publicView({ ...full, id: 7, speaker_name: 'Sushil Sani', speaker_email: 'sushil@trust3.ai', details_requested_to: 'ashwini@trust3.ai', notes: 'internal', exhibitor_id: 3, hall: 'Aryabhata Theatre', starts_at: '2026-11-20 11:30', time_slot: 'Fri 20 Nov · 11:30 – 11:38 AM' }, (h) => h + ' (Expo Hall)');
check('the page never shows an email address, who was asked, or the team’s notes', !JSON.stringify(v).includes('@') && !('notes' in v) && !('exhibitor_id' in v), v);
check('the page says when and where, both hall names', v.when === 'Fri 20 Nov · 11:30 – 11:38 AM' && v.where === 'Aryabhata Theatre (Expo Hall)', v);
check('"To be announced" is not a time', T.publicView({ time_slot: 'To be announced', starts_at: null }).when === '');
check('a photo address that is not ours or https is not shown', T.publicView({ speaker_photo_url: 'javascript:alert(1)' }).speaker_photo_url === '' && T.publicView({ speaker_photo_url: 'http://x/y.jpg' }).speaker_photo_url === '');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
