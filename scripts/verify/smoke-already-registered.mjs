// Someone whose address already holds a pass fills in a form again (5 Nov 2026).
// The /register paid form used to answer them with a message that left after four
// seconds, and nothing counted how often it happened. Now: the refusal is counted
// when it comes from a form, and the paid form asks for a sign-in email whose
// link carries on to payment for the pass they chose. The built worker on real
// SQLite with the production schema, Elastic Email played here.
// Run after `npm run build`:  node scripts/verify/smoke-already-registered.mjs
import { makeWorld, checker, settle } from './login-world.mjs';

const W = await makeWorld();
const { db, hit, q, rows, sent, tokensIn, codeIn, to, subject, html } = W;
const { check, fails } = checker();

const REGISTER = '/api/events/1/attendees/register', ASK = '/api/events/1/attendees/send-magic-link', LOGIN = '/api/events/1/attendees/login';
const FORM = { name: 'Asha Rao', mobile: '9820012345', company: 'Rao Labs', job_title: 'Founder', city: 'Pune', industry: 'Software & SaaS' };
const EMAIL = 'asha@example.com';
const mailTo = (e) => sent.find(p => to(p) === e);
let r;

r = await hit('POST', REGISTER, { ...FORM, email: EMAIL, badge_type: 'Visitor Pass' });
await settle(150);
const asha = Number(r.json?.id || 0);
check('Asha registers for a free Visitor Pass', (r.status === 200 || r.status === 201) && asha > 0, r.status + ' ' + r.text.slice(0, 200));

// ---- the /register paid form, in a browser that is not signed in as her ----
r = await hit('POST', REGISTER, { ...FORM, email: 'Asha@Example.com ', badge_type: 'Delegate Pass', registration_source: 'home-hero' });
check('the paid form with her address is refused in a sentence, not a machine word alone',
  r.status === 403 && r.json?.error === 'verification_required' && /already registered/.test(r.json?.message || ''), r.status + ' ' + r.text.slice(0, 200));
let counted = rows('register.already_registered', asha);
const detail = counted[0] ? JSON.parse(counted[0].detail) : {};
check('and it is counted, with what she wanted, what she holds and where she came from',
  counted.length === 1 && detail.wanted === 'Delegate Pass' && detail.holds === 'Visitor Pass' && detail.source === 'home-hero' && counted[0].actor_kind === 'public', JSON.stringify(counted));
const pass = q('SELECT badge_type, payment_status FROM attendees WHERE id = ?', asha)[0] || {};
check('her pass is untouched and there is still one of her', pass.badge_type === 'Visitor Pass' && pass.payment_status === 'paid' && q('SELECT COUNT(*) AS n FROM attendees')[0].n === 1, JSON.stringify(pass));

// ---- the app re-posting on load with a sign-in that ran out: no mobile, so not a form ----
r = await hit('POST', REGISTER, { name: 'Asha Rao', email: EMAIL, company: 'Rao Labs', job_title: 'Founder' });
counted = rows('register.already_registered', asha);
check('the app refreshing on load is refused but not counted as a second try', r.status === 403 && counted.length === 1, r.status + ' counted=' + counted.length);

// ---- the sign-in email the paid form asks for ----
sent.length = 0;
r = await hit('POST', ASK, { email: EMAIL, next_action: 'pay', pass: 'delegate' }); await settle(150);
const mail = mailTo(EMAIL), tok = mail ? tokensIn(mail) : [], body = mail ? html(mail) : '';
check('the sign-in email says what it is for', r.status === 200 && !!mail && subject(mail) === 'Sign in to pay for your Delegate Pass'
  && /opens payment for your <strong>Delegate Pass<\/strong>/.test(body) && /Sign in and pay/.test(body), r.status + ' ' + subject(mail) + ' ' + body.slice(0, 120));
check('its link signs her in and carries on to payment for that pass', tok.length === 1 && body.includes('?email=' + encodeURIComponent(EMAIL) + '&action=pay&pass=delegate&token=' + tok[0]) && !/magic-login/.test(body), 'tokens=' + tok.length);
check('it still carries the 6-digit code for the sign-in box', /^\d{6}$/.test(mail ? codeIn(mail) : ''), mail ? codeIn(mail) : 'no mail');
check('the reply does not say whether the address is registered', r.json?.success === true && !/pay|Delegate/i.test(r.json?.message || ''), r.text.slice(0, 160));
// A link opened within two minutes of being issued is taken for an email scanner's.
db.run("UPDATE login_tokens SET created_at = datetime('now', '-3 minutes') WHERE email = ?", [EMAIL]);
r = await hit('POST', LOGIN, { email: EMAIL, token: tok[0] });
check('the link signs her in', r.status === 200 && r.json?.id === asha, r.status + ' ' + r.text.slice(0, 120));

// ---- anything else is the plain sign-in email, as before ----
r = await hit('POST', REGISTER, { ...FORM, name: 'Ravi Kumar', email: 'ravi@example.com', mobile: '9820012346', badge_type: 'Visitor Pass' });
await settle(150);
for (const [label, extra] of [['a pass that is not one', { next_action: 'pay', pass: 'gold' }], ['a made-up action', { next_action: 'admin', pass: 'delegate' }], ['no extras', {}]]) {
  sent.length = 0;
  r = await hit('POST', ASK, { email: 'ravi@example.com', ...extra }); await settle(150);
  const m = mailTo('ravi@example.com'), b = m ? html(m) : '';
  check('the plain sign-in email for ' + label, r.status === 200 && !!m && subject(m) === 'Sign In to Bharat AI Innovation 2026' && /action=magic-login&token=[0-9a-f]{64}/.test(b) && !/action=pay/.test(b) && /Sign In Now/.test(b),
    r.status + ' ' + subject(m) + ' ' + b.slice(0, 100));
}
sent.length = 0;
r = await hit('POST', ASK, { email: 'nobody@example.com', next_action: 'pay', pass: 'vip' }); await settle(150);
check('an address that is not registered is sent nothing and told the same', r.status === 200 && sent.length === 0 && r.json?.success === true, r.status + ' sent=' + sent.length);

console.log(fails() ? fails() + ' FAILED' : 'all already-registered checks passed');
process.exit(fails() ? 1 : 0);
