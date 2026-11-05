// UNIT level for the 5 Nov 2026 "already registered" fixes: each small function on
// its own, with nothing around it. No database, no route, no browser.
//   signinPayIntent  src/lib/signin-pay.ts, compiled here with esbuild
//   withHttps, rppAlreadyRegistered   lifted out of the /register page as served
//   codeSentSignIn                    lifted out of /app.js as served
// The other levels: smoke-already-registered.mjs (integration), pay-test.cjs section
// 7b (end to end), browser-already-registered.cjs (system).
// Run after `npm run build`:  node scripts/verify/unit-already-registered.mjs
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const same = (n, got, want) => check(n, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));

// ---- the pages exactly as the built worker serves them ----
const worker = (await import(new URL('../../dist/_worker.js?' + Date.now(), import.meta.url).href)).default;
const DB = { prepare: () => { const q = { bind: () => q, first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: {} }) }; return q; } };
const env = new Proxy({ ADMIN_SECRET: 'u', SESSION_SECRET: 'u', DB }, { get: (t, k) => (k in t ? t[k] : undefined) });
const page = async (p) => (await worker.fetch(new Request('https://bharataiinnovation.com' + p), env, { waitUntil() {}, passThroughOnException() {} })).text();
const register = await page('/register');
const appHtml = await page('/app');
const appJsUrl = (appHtml.match(/\/app\.js\?v=[0-9a-z]+/) || ['/app.js'])[0];
const appJs = await page(appJsUrl);

// One whole function, by counting braces from its header.
const lift = (text, name) => {
  const start = text.indexOf('function ' + name + '(');
  if (start < 0) throw new Error(name + ' is not on the page');
  let i = text.indexOf('{', start), depth = 0;
  for (; i < text.length; i++) { if (text[i] === '{') depth++; else if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1); }
  throw new Error(name + ' never closes');
};

// ---- signinPayIntent: which sign-in emails carry on to payment ----
const ts = readFileSync(new URL('../../src/lib/signin-pay.ts', import.meta.url), 'utf8');
const js = transformSync(ts, { loader: 'ts', format: 'esm' }).code;
const { signinPayIntent } = await import('data:text/javascript,' + encodeURIComponent(js));
same('delegate', signinPayIntent('pay', 'delegate'), { key: 'delegate', name: 'Delegate Pass' });
same('premium', signinPayIntent('pay', 'premium'), { key: 'premium', name: 'Premium Delegate Pass' });
same('vip', signinPayIntent('pay', 'vip'), { key: 'vip', name: 'VIP Pass' });
same('academic', signinPayIntent('pay', 'academic'), { key: 'academic', name: 'Academic Pass' });
same('capitals in the pass are the same pass', signinPayIntent('pay', 'VIP'), { key: 'vip', name: 'VIP Pass' });
const NONE = { key: '', name: '' };
for (const [label, a, p] of [
  ['no action, no pass', undefined, undefined], ['a pass but no action', undefined, 'vip'], ['the action but no pass', 'pay', undefined],
  ['another action', 'admin', 'vip'], ['a pass that is not one', 'pay', 'gold'], ['a full pass name', 'pay', 'VIP Pass'], ['an empty pass', 'pay', ''],
  ['a number', 'pay', 7], ['an object', 'pay', { toString: () => 'vip' }], ['an array', 'pay', ['vip']], ['null', null, null],
  ['constructor (an object key every object has)', 'pay', 'constructor'], ['__proto__', 'pay', '__proto__'], ['toString', 'pay', 'toString'],
  ['markup', 'pay', '<script>vip'], ['a link', 'pay', 'vip&action=admin'],
]) same('plain sign-in email for ' + label, signinPayIntent(a, p), NONE);

// ---- withHttps: what the LinkedIn box saves ----
const withHttps = vm.runInNewContext('(' + lift(register, 'withHttps') + ')');
for (const [typed, saved] of [
  ['linkedin.com/in/rahul', 'https://linkedin.com/in/rahul'], ['www.linkedin.com/in/rahul', 'https://www.linkedin.com/in/rahul'],
  ['  linkedin.com/in/rahul  ', 'https://linkedin.com/in/rahul'], ['https://linkedin.com/in/rahul', 'https://linkedin.com/in/rahul'],
  ['http://linkedin.com/in/rahul', 'http://linkedin.com/in/rahul'], ['HTTPS://LinkedIn.com/in/Rahul', 'HTTPS://LinkedIn.com/in/Rahul'],
  ['', ''], ['   ', ''],
]) same('withHttps(' + JSON.stringify(typed) + ')', withHttps(typed), saved);
same('withHttps of nothing', [withHttps(undefined), withHttps(null)], ['', '']);

// ---- a very small DOM: only what these two functions touch ----
const element = (id) => {
  const classes = new Set();
  const el = { id, style: {}, children: [], _text: '', scrolled: 0, innerHTMLWritten: false,
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), has: (c) => classes.has(c) },
    appendChild(c) { el.children.push(c); return c; },
    scrollIntoView() { el.scrolled++; },
    querySelector: () => el.submit || null,
    get textContent() { return el._text + el.children.map(c => c.textContent).join(' '); },
    set textContent(v) { el._text = String(v); el.children = []; },
    set innerHTML(v) { el._html = v; },
    get innerHTML() { return el._html || ''; },
  };
  return el;
};

// ---- rppAlreadyRegistered: the notice under the button ----
const rpp = (opts = {}) => {
  const box = opts.noBox ? null : element('rpp-notice');
  const asked = [], toasts = [];
  const sandbox = {
    document: { getElementById: (id) => (id === 'rpp-notice' ? box : null), createElement: () => element('') },
    fetch: opts.fetch || ((url, init) => { asked.push({ url, body: JSON.parse(init.body) }); return Promise.resolve({ ok: true }); }),
    showToast: (m, t) => toasts.push([m, t]),
    encodeURIComponent,
  };
  vm.runInNewContext("var _rppSigninSentTo = '';\n" + lift(register, 'rppAlreadyRegistered') + '\nthis.go = rppAlreadyRegistered;', sandbox);
  return { box, asked, toasts, go: sandbox.go };
};
const KNOWN = { error: 'verification_required', message: 'That email is already registered.' };
const MOBILE = { error: 'x', code: 'mobile_registered', message: 'This mobile number is already registered with as•••@gmail.com.' };
const linkOf = (b) => b.children[1];

{
  const t = rpp(); t.go(KNOWN, 'asha@example.com', 'Delegate Pass');
  check('a known address: the notice shows and is scrolled to', t.box.style.display === 'block' && t.box.scrolled === 1, JSON.stringify(t.box.style));
  check('it names the address and the pass, in plain words', /asha@example\.com is already registered with us/.test(t.box.textContent) && /Delegate Pass opens next/.test(t.box.textContent), t.box.textContent);
  check('it never shows the machine word', !/verification_required/.test(t.box.textContent), t.box.textContent);
  same('the button goes to the code step, carrying the pass', linkOf(t.box).href, '/app?signin=asha%40example.com&action=pay&pass=delegate');
  same('one sign-in email is asked for, carrying on to payment', t.asked, [{ url: '/api/events/1/attendees/send-magic-link', body: { email: 'asha@example.com', next_action: 'pay', pass: 'delegate' } }]);
  t.go(KNOWN, 'asha@example.com', 'Delegate Pass');
  check('pressing again does not send a second email', t.asked.length === 1, String(t.asked.length));
  check('and leaves one notice, not two', t.box.children.length === 2, String(t.box.children.length));
  t.go(KNOWN, 'asha@example.com', 'VIP Pass');
  check('choosing another pass sends a new email, for that pass', t.asked.length === 2 && t.asked[1].body.pass === 'vip' && /VIP Pass opens next/.test(t.box.textContent) && /pass=vip$/.test(linkOf(t.box).href), JSON.stringify(t.asked));
  t.go(KNOWN, 'ravi@example.com', 'VIP Pass');
  check('another address sends a new email, to it', t.asked.length === 3 && t.asked[2].body.email === 'ravi@example.com', JSON.stringify(t.asked[2]));
}
for (const [pass, key] of [['Delegate Pass', 'delegate'], ['Premium Delegate Pass', 'premium'], ['VIP Pass', 'vip'], ['Academic Pass', 'academic']]) {
  const t = rpp(); t.go(KNOWN, 'a@b.in', pass);
  check(pass + ' -> pass=' + key, t.asked[0].body.pass === key && linkOf(t.box).href.endsWith('pass=' + key), JSON.stringify(t.asked[0]));
}
{
  const t = rpp(); t.go(KNOWN, 'a+tag&x=1@b.in', 'VIP Pass');
  same('an address with + and & cannot change the link', linkOf(t.box).href, '/app?signin=a%2Btag%26x%3D1%40b.in&action=pay&pass=vip');
  const x = rpp(); x.go(KNOWN, '<img src=x onerror=alert(1)>@b.in', 'VIP Pass');
  check('what was typed is shown as text, never as markup', !x.box.innerHTML && !/innerHTML/.test(lift(register, 'rppAlreadyRegistered')) && x.box.textContent.includes('<img src=x'), x.box.innerHTML);
}
{
  const t = rpp(); t.go(MOBILE, 'other@example.com', 'VIP Pass');
  check('a known mobile: the server\'s sentence, masked address and all', /as•••@gmail\.com/.test(t.box.textContent) && t.box.style.display === 'block', t.box.textContent);
  check('no email to the address just typed: it is not the registered one', t.asked.length === 0, JSON.stringify(t.asked));
  same('the button opens sign-in, carrying the pass', linkOf(t.box).href, '/app?action=pay&pass=vip#login');
  check('and says what it does', /Sign in and pay for my VIP Pass/.test(linkOf(t.box).textContent), linkOf(t.box).textContent);
  const n = rpp(); n.go({ code: 'mobile_registered' }, 'x@y.in', 'Delegate Pass');
  check('with no sentence from the server there is still one', /already registered/.test(n.box.textContent), n.box.textContent);
}
{
  const t = rpp({ noBox: true }); t.go(KNOWN, 'a@b.in', 'VIP Pass');
  check('without the notice box (an old cached page) it falls back to the message', t.toasts.length === 1 && t.toasts[0][1] === 'error', JSON.stringify(t.toasts));
  const r = rpp({ fetch: () => Promise.reject(new Error('offline')) });
  let threw = false; try { r.go(KNOWN, 'a@b.in', 'VIP Pass'); } catch (e) { threw = true; }
  check('no network: the notice still shows and nothing throws', !threw && r.box.style.display === 'block', String(threw));
  const s = rpp({ fetch: () => { throw new Error('blocked'); } });
  threw = false; try { s.go(KNOWN, 'a@b.in', 'VIP Pass'); } catch (e) { threw = true; }
  check('fetch itself refusing: the same', !threw && s.box.style.display === 'block', String(threw));
}

// ---- codeSentSignIn: the sign-in box on the code step ----
{
  const els = {}; for (const id of ['signin-code-field', 'signin-note', 'signin-form']) els[id] = element(id);
  els['signin-code-field'].classList.add('hidden'); els['signin-note'].classList.add('hidden');
  const submit = element('btn'); els['signin-form'].querySelector = () => submit;
  let submitted = 0; els['signin-form'].requestSubmit = () => { submitted++; };
  const calls = [];
  const sandbox = {
    window: {}, document: { getElementById: (id) => els[id] || null, createElement: () => element('') },
    showRegistration: (e) => calls.push(['open', e]), switchAuthMode: (m) => calls.push(['mode', m]),
    resetSigninStep: () => { calls.push(['reset']); sandbox.window._signinCodeSent = false; },
  };
  vm.runInNewContext(lift(appJs, 'codeSentSignIn') + '\nthis.go = codeSentSignIn;', sandbox);
  sandbox.go('asha@example.com');
  same('the box opens on the address, on sign-in', calls, [['open', 'asha@example.com'], ['mode', 'signin']]);
  check('it waits for the code: the next press verifies, it does not send again', sandbox.window._signinCodeSent === true && /Verify code/.test(submit.innerHTML), submit.innerHTML);
  check('the code box and the note are showing', !els['signin-code-field'].classList.has('hidden') && !els['signin-note'].classList.has('hidden'), '');
  check('the note says what happened and what comes next', /already registered/.test(els['signin-note'].textContent) && /asha@example\.com/.test(els['signin-note'].textContent) && /Payment for your pass opens next/.test(els['signin-note'].textContent), els['signin-note'].textContent);
  const again = els['signin-note'].children[0];
  check('there is a way out if the email never comes', !!again && /Send it again/.test(again.textContent) && again.type === 'button', again && again.textContent);
  again.onclick();
  check('"Send it again" goes back a step and sends', sandbox.window._signinCodeSent === false && submitted === 1 && calls.some(c => c[0] === 'reset') && els['signin-note'].classList.has('hidden'), JSON.stringify({ submitted, calls }));
  check('the address is shown as text, never as markup', !/innerHTML\s*=[^=][^;]*email/.test(lift(appJs, 'codeSentSignIn')), lift(appJs, 'codeSentSignIn').slice(0, 200));
}

// ---- /register's price words follow the date (late prices start 00:00 IST, 6 Nov) ----
{
  const RealDate = Date;
  const at = (iso) => { const t = RealDate.parse(iso); globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [t])); } static now() { return t; } }; };
  const words = (html) => ({ chip: /STANDARD PRICES UNTIL 5 NOV/.test(html), described: /Delegate ₹4,999 \+ GST until 5 Nov/.test(html) });
  try {
    at('2026-11-05T23:59:00+05:30');
    const before = await page('/register');
    same('23:59 on 5 Nov: the standard-price words are up', words(before), { chip: true, described: true });
    check('and the page shows ₹4,999', before.includes('4,999'), 'no 4,999');
    at('2026-11-06T00:01:00+05:30');
    const after = await page('/register');
    same('00:01 on 6 Nov: both are gone by themselves', words(after), { chip: false, described: false });
    check('the header shows the date and place, and the page ₹8,999', after.includes('20–21 NOV 2026 · WTC MUMBAI') && after.includes('8,999'), 'missing');
    check('the description still says what the passes are', /Delegate with guaranteed entry, Premium Delegate/.test(after), 'missing');
  } finally { globalThis.Date = RealDate; }
}

console.log(fails ? `\n${fails} FAILED` : '\nall unit checks passed');
process.exit(fails ? 1 : 0);
