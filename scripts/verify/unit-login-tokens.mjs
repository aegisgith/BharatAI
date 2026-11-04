// The sign-in token rules on their own (4 Nov 2026), against the built worker on
// real SQLite with the production schema: a link is found by its own hash among
// the live rows (expired, used up, a budget of uses, two live links, a stale one),
// a code is the newest code row (wrong attempts, too many, a link minted after
// it), a new code retires the codes before it and no link, a new email link
// retires nothing, the two-minute rule and the rate window are as before.
// Run after `npm run build`:  node scripts/verify/unit-login-tokens.mjs
import { makeWorld, checker, ADMIN, sha, hex, settle } from './login-world.mjs';

const W = await makeWorld();
const { db, hit, q, rows, sent, codeIn } = W;
const { check, fails } = checker();

const EMAIL = 'unit@example.com', ID = 21;
db.run("INSERT INTO attendees (id, event_id, name, email, mobile, badge_type, payment_status, company) VALUES (?, 1, 'Unit Person', ?, '9820000021', 'Visitor Pass', 'paid', '')", [ID, EMAIL]);
const door = (hash, codeHash, uses, ago, ttl) =>
  db.run("INSERT INTO login_tokens (event_id, email, token_hash, code_hash, expires_at, max_uses, created_at) VALUES (1, ?, ?, ?, datetime('now', ?), ?, datetime('now', ?))", [EMAIL, hash, codeHash, ttl, uses, ago]);
const login = (body) => hit('POST', '/api/events/1/attendees/login', { email: EMAIL, ...body });
const tok = (t) => q('SELECT attempts, uses, used_at FROM login_tokens WHERE token_hash = ?', sha(t))[0];
const byHash = (h) => q('SELECT attempts, uses, used_at FROM login_tokens WHERE token_hash = ?', h)[0];
const codeRow = () => q('SELECT id, attempts, used_at FROM login_tokens WHERE email = ? AND max_uses = 1 ORDER BY id DESC LIMIT 1', EMAIL)[0];
const liveLinks = () => q("SELECT COUNT(*) AS n FROM login_tokens WHERE email = ? AND max_uses > 1 AND used_at IS NULL AND expires_at > datetime('now')", EMAIL)[0].n;
const refused = () => rows('login.link_refused', ID).length;
let r;

// ---- a link is found by its own hash ----
r = await login({ token: hex() });
check('no live row: refused as expired, and counted against the owner', r.status === 401 && /expired/.test(r.text) && refused() === 1, r.status + ' ' + r.text);
const EXP = hex(); door(sha(EXP), 'x', 6, '-8 days', '-1 day');
r = await login({ token: EXP });
check('an expired link is refused', r.status === 401 && /expired/.test(r.text), r.status + ' ' + r.text);
const USED = hex(); door(sha(USED), 'x', 1, '-30 minutes', '+1 day');
db.run("UPDATE login_tokens SET used_at = datetime('now') WHERE token_hash = ?", [sha(USED)]);
r = await login({ token: USED });
check('a used-up link is refused', r.status === 401 && /expired/.test(r.text), r.status + ' ' + r.text);
const THREE = hex(); door(sha(THREE), 'x', 3, '-30 minutes', '+1 day');
const got = []; for (let i = 0; i < 4; i++) { r = await login({ token: THREE }); got.push(r.status); }
// The last use retires the row (used_at) instead of counting it, as it always has.
check('a three-use link signs in three times, then is spent', got.join() === '200,200,200,401' && tok(THREE).uses === 2 && !!tok(THREE).used_at, got.join() + ' ' + JSON.stringify(tok(THREE)));
const OLDER = hex(), NEWER = hex();
door(sha(OLDER), 'x', 6, '-30 minutes', '+6 days'); door(sha(NEWER), 'x', 6, '-25 minutes', '+7 days');
r = await login({ token: OLDER });
check('the older of two live links signs in', r.status === 200 && r.json?.id === ID && tok(OLDER).uses === 1 && tok(NEWER).uses === 0, r.status + ' ' + JSON.stringify(tok(OLDER)));
r = await login({ token: NEWER });
check('and so does the newer', r.status === 200 && tok(NEWER).uses === 1 && tok(OLDER).uses === 1, r.status + ' ' + JSON.stringify(tok(NEWER)));
r = await login({ token: hex() });
check('a stale token is refused as expired and touches no attempts on the live links', r.status === 401 && /expired/.test(r.text) && tok(OLDER).attempts === 0 && tok(NEWER).attempts === 0, r.status + ' ' + JSON.stringify([tok(OLDER), tok(NEWER)]));

// ---- a code is the newest code row ----
door('c-a', sha('111111'), 1, '-5 minutes', '+15 minutes');
for (let i = 0; i < 4; i++) r = await login({ code: '000000' });
check('four wrong codes: four attempts, the code still live, none counted as a dead link', r.status === 401 && /not correct/.test(r.text) && codeRow().attempts === 4 && !codeRow().used_at && refused() === 1, r.status + ' ' + JSON.stringify(codeRow()) + ' refused=' + refused());
r = await login({ code: '000000' });
check('the fifth wrong code is the last one answered "not correct"', r.status === 401 && /not correct/.test(r.text) && codeRow().attempts === 5 && !codeRow().used_at, r.status + ' ' + r.text + ' ' + JSON.stringify(codeRow()));
r = await login({ code: '111111' });
check('after five wrong ones even the right code is "too many attempts", and the code is retired', r.status === 401 && /Too many/.test(r.text) && !!codeRow().used_at, r.status + ' ' + r.text);
check('wrong codes never touch the links', tok(OLDER).attempts === 0 && tok(NEWER).attempts === 0 && !tok(OLDER).used_at && !tok(NEWER).used_at, JSON.stringify([tok(OLDER), tok(NEWER)]));
door('c-b', sha('222222'), 1, '-4 minutes', '+15 minutes');
const AFTER = hex(); door(sha(AFTER), 'x', 6, '-3 minutes', '+7 days');
r = await login({ code: '222222' });
check('a typed code is checked against the code row even when a link was minted after it, and is spent on first use', r.status === 200 && !!codeRow().used_at, r.status + ' ' + JSON.stringify(codeRow()));
check('the link minted after it is untouched', tok(AFTER).uses === 0 && !tok(AFTER).used_at && tok(AFTER).attempts === 0, JSON.stringify(tok(AFTER)));

// ---- minting: a new code retires the codes before it, a new email link retires nothing ----
door('c-c', sha('333333'), 1, '-20 minutes', '+15 minutes');
const linksBefore = liveLinks();
r = await hit('POST', '/api/events/1/attendees/send-magic-link', { email: EMAIL }); await settle();
check('a new sign-in code retires the live code before it and no link', r.status === 200 && !!byHash('c-c').used_at && liveLinks() === linksBefore, r.status + ' c-c=' + JSON.stringify(byHash('c-c')) + ' links=' + liveLinks() + '/' + linksBefore);
const code = codeIn(sent[sent.length - 1]);
check('the sign-in email shows the new code', /^\d{6}$/.test(code), 'code=' + JSON.stringify(code) + ' mails=' + sent.length);
r = await login({ code });
check('the new code signs in, once', r.status === 200 && !!codeRow().used_at, r.status + ' ' + r.text.slice(0, 120));
door('c-d', sha('444444'), 1, '-19 minutes', '+15 minutes');
r = await hit('POST', '/api/admin/help-mail/send', { email: EMAIL, topic: 'app' }, ADMIN); await settle();
check('a new email link (the help steps) retires neither the live code nor any link', r.status === 200 && !byHash('c-d').used_at && liveLinks() === linksBefore + 1, r.status + ' ' + r.text.slice(0, 120) + ' c-d=' + JSON.stringify(byHash('c-d')) + ' links=' + liveLinks());
r = await login({ code: '444444' });
check('and that code still signs in', r.status === 200, r.status + ' ' + r.text.slice(0, 120));

// ---- unchanged: the two-minute rule; the rate window now counts codes, not the emails' links ----
const FRESH = hex(); door(sha(FRESH), 'x', 6, '-1 minute', '+7 days');
r = await login({ token: FRESH });
check('a multi-use link opened within two minutes of being issued signs in and spends nothing (scanners open on arrival)', r.status === 200 && tok(FRESH).uses === 0 && !tok(FRESH).used_at, r.status + ' ' + JSON.stringify(tok(FRESH)));
const minted = () => q('SELECT COUNT(*) AS n FROM login_tokens WHERE email = ?', EMAIL)[0].n;
const inWindow = (where) => q(`SELECT COUNT(*) AS n FROM login_tokens WHERE email = ? AND created_at > datetime('now', '-15 minutes')${where}`, EMAIL)[0].n;
let n0 = minted();
const codesBefore = inWindow(' AND max_uses = 1'), rowsBefore = inWindow('');
r = await hit('POST', '/api/events/1/attendees/send-magic-link', { email: EMAIL }); await settle();
check('the rate window counts codes, not emailed links: three codes among more than four rows in fifteen minutes still mint one', codesBefore === 3 && rowsBefore > 4 && r.status === 200 && minted() === n0 + 1, r.status + ' codes=' + codesBefore + ' rows=' + rowsBefore + ' minted=' + minted() + '/' + n0);
n0 = minted();
r = await hit('POST', '/api/events/1/attendees/send-magic-link', { email: EMAIL }); await settle();
check('the fifth code in fifteen minutes: the neutral answer, nothing minted', r.status === 200 && /on their way/.test(r.text) && minted() === n0, r.status + ' ' + r.text.slice(0, 120) + ' rows=' + minted() + '/' + n0);
check('dead links are counted once an hour per person, wrong codes never', refused() === 1, 'refused=' + refused());

console.log(fails() ? fails() + ' FAILED' : 'all sign-in token checks passed');
process.exit(fails() ? 1 : 0);
