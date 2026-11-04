// End to end, the way it happened on 4 Nov 2026: Asha registers herself, the
// welcome email goes out, five minutes later the account-ready email by itself,
// ten minutes later the networking email, then the team sends her the steps, and
// she asks for a code at the sign-in box. Every one of those emails carries its
// own sign-in link, and every link must sign her in, in any order, for its full
// life - the newer emails used to kill the older emails' links. The built
// worker on real SQLite with the production schema, the minute clock ticked by
// hand, Elastic Email played here.
// Run after `npm run build`:  node scripts/verify/system-email-links.mjs
import { makeWorld, checker, ADMIN, CRON, sha, settle } from './login-world.mjs';

const W = await makeWorld();
const { db, hit, q, rows, sent, tokensIn, codeIn, to, subject } = W;
const { check, fails } = checker();

const EMAIL = 'asha@example.com';
const ageSelf = (id, mins) => db.run(`UPDATE admin_audit SET created_at = datetime('now', '-${mins} minutes') WHERE action = 'register.self' AND entity_id = ?`, [String(id)]);
// Older than two minutes, so each opening is hers and spends a use (a link opened
// within two minutes of being issued is taken for an email scanner's).
const ageLinks = () => db.run("UPDATE login_tokens SET created_at = datetime('now', '-3 minutes') WHERE email = ? AND created_at > datetime('now', '-3 minutes')", [EMAIL]);
const tick = async () => { const t = await hit('POST', '/api/cron/tick', {}, CRON); await settle(150); return t; };
const login = (body) => hit('POST', '/api/events/1/attendees/login', { email: EMAIL, ...body });
const link = (t) => q('SELECT uses, used_at, attempts FROM login_tokens WHERE token_hash = ?', sha(t))[0];
const reasons = (id) => rows('login.link_refused', id).map(r => JSON.parse(r.detail).reason);
const mailTo = () => sent.find(p => to(p) === EMAIL);
let r;

// ---- she registers on her phone ----
r = await hit('POST', '/api/events/1/attendees/register', { name: 'Asha Rao', email: EMAIL, mobile: '9820012345', company: 'Rao Labs', job_title: 'Founder', city: 'Pune', industry: 'Software & SaaS', badge_type: 'Visitor Pass' });
await settle(150);
const asha = Number(r.json?.id || 0);
check('register: Asha is in', (r.status === 200 || r.status === 201) && asha > 0, r.status + ' ' + r.text.slice(0, 200));
const welcome = mailTo(), welcomeTokens = welcome ? tokensIn(welcome) : [];
check('the welcome email went out with one sign-in link', !!welcome && welcomeTokens.length === 1, 'mails=' + sent.map(subject).join(' | ') + ' tokens=' + welcomeTokens.length);

// ---- five minutes later, the account-ready email by itself ----
ageSelf(asha, 6); sent.length = 0; r = await tick();
const ready = mailTo(), readyTokens = ready ? tokensIn(ready) : [];
check('5 minutes later: the account-ready email, with its own link', r.status === 200 && !!ready && readyTokens.length === 1 && readyTokens[0] !== welcomeTokens[0], r.status + ' mails=' + sent.map(subject).join(' | ') + ' tokens=' + readyTokens.length);

// ---- ten minutes later, the networking email by itself ----
ageSelf(asha, 11); sent.length = 0; r = await tick();
const net = mailTo(), netTokens = net ? tokensIn(net) : [];
check('10 minutes later: the networking email, with its own link', r.status === 200 && !!net && netTokens.length === 1 && !readyTokens.includes(netTokens[0]) && !welcomeTokens.includes(netTokens[0]), r.status + ' mails=' + sent.map(subject).join(' | ') + ' tokens=' + netTokens.length);

// ---- that evening she opens them in the order they arrived, on a phone never signed in ----
ageLinks();
r = await login({ token: welcomeTokens[0] });
check('the welcome email link signs her in, two newer emails later', r.status === 200 && r.json?.id === asha && link(welcomeTokens[0])?.uses === 1, r.status + ' ' + r.text.slice(0, 120) + ' ' + JSON.stringify(link(welcomeTokens[0])));
r = await login({ token: readyTokens[0] });
check('the account-ready link signs her in', r.status === 200 && link(readyTokens[0])?.uses === 1, r.status + ' ' + r.text.slice(0, 120));
r = await login({ token: netTokens[0] });
check('the networking link signs her in', r.status === 200 && link(netTokens[0])?.uses === 1, r.status + ' ' + r.text.slice(0, 120));
check('nothing was counted as a dead link', reasons(asha).length === 0, JSON.stringify(reasons(asha)));

// ---- the team sends her the steps by hand: a fourth link ----
sent.length = 0;
r = await hit('POST', '/api/admin/help-mail/send', { email: EMAIL, topic: 'app' }, ADMIN); await settle(150);
const help = mailTo(), helpTokens = help ? tokensIn(help) : [];
check('the help email carries its own link', r.status === 200 && helpTokens.length === 1, r.status + ' ' + r.text.slice(0, 120) + ' mails=' + sent.map(subject).join(' | '));
ageLinks();
const all = [welcomeTokens[0], readyTokens[0], netTokens[0], helpTokens[0]];
const again = []; for (const t of all) { r = await login({ token: t }); again.push(r.status); }
check("all four emails' links still sign her in", again.join() === '200,200,200,200', again.join());

// ---- she asks for a code at the sign-in box ----
sent.length = 0;
r = await hit('POST', '/api/events/1/attendees/send-magic-link', { email: EMAIL }); await settle(150);
const magic = mailTo(), code = magic ? codeIn(magic) : '';
check('the sign-in email carries a code and a one-use link', r.status === 200 && !!magic && /^\d{6}$/.test(code) && tokensIn(magic).length === 1, r.status + ' code=' + JSON.stringify(code) + ' mails=' + sent.map(subject).join(' | '));
r = await login({ code });
check('the code signs her in', r.status === 200, r.status + ' ' + r.text.slice(0, 120));
check('the code retired no email link', all.every(t => link(t) && !link(t).used_at), JSON.stringify(all.map(t => link(t))));
r = await login({ token: welcomeTokens[0] });
check('the welcome link works a third time (it has four)', r.status === 200 && link(welcomeTokens[0]).uses === 3, r.status + ' ' + JSON.stringify(link(welcomeTokens[0])));

// ---- the one dead link anyone can still have ----
r = await login({ token: 'a'.repeat(64) });
check('a made-up link is refused as expired and counted once; never "not correct"', r.status === 401 && reasons(asha).length === 1 && reasons(asha).every(x => /expired/.test(x)), r.status + ' ' + JSON.stringify(reasons(asha)));
check('and it cost the real links nothing', all.every(t => link(t).attempts === 0 && !link(t).used_at), JSON.stringify(all.map(t => link(t))));

console.log(fails() ? fails() + ' FAILED' : 'all email-link checks passed');
process.exit(fails() ? 1 : 0);
