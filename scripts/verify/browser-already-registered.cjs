// SYSTEM level for the 5 Nov 2026 "already registered" fixes: everything real except
// the two outside companies. The built worker on real SQLite with the production
// schema (login-harness.mjs), a real browser on an emulated phone, the real emails
// read back and their real links and codes used. Elastic Email is played by the
// harness and CCAvenue here, by intercepting secure.ccavenue.com.
// One person at a time, the way it goes in life: they registered free some time
// ago, see an ad or an email on another phone, and try to buy.
// Needs login-harness.mjs (HARNESS_PORT, default 8784).
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('./playwright.cjs');

const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8784);
// The browser inside Instagram, on Android.
const UA = 'Mozilla/5.0 (Linux; Android 14; SM-A546E; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.0.0 Mobile Safari/537.36 Instagram 350.0.0.0.0 Android';
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const post = async (p, body) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const sql = async (s, args = []) => (await post('/__sql', { sql: s, args })).json;
const mail = async () => (await fetch(BASE + '/__mail')).json();
const to = (p) => (p?.Recipients?.To || [])[0] || '';
const subject = (p) => p?.Content?.Subject || '';
const body = (p) => p?.Content?.Body?.[0]?.Content || '';
const linkIn = (p) => ((body(p).match(/href="([^"]*token=[0-9a-f]{64}[^"]*)"/) || [])[1] || '').replace(/&amp;/g, '&');
const codeIn = (p) => (body(p).match(/>\s*(\d{6})\s*</) || [])[1] || '';
const person = async (email) => (await sql('SELECT * FROM attendees WHERE email = ?', [email]))[0];
const count = async (email) => (await sql('SELECT COUNT(*) AS n FROM attendees WHERE email = ?', [email]))[0].n;
const orders = async (id) => sql('SELECT status, pass_type FROM payment_orders WHERE attendee_id = ?', [id]);
const signinMails = async (email) => (await mail()).filter(p => to(p) === email && /^Sign in to pay|^Sign In to/.test(subject(p)));
const already = async (id) => sql("SELECT detail FROM admin_audit WHERE action = 'register.already_registered' AND entity_id = ?", [String(id)]);
// A link opened within two minutes of being issued is taken for an email scanner's.
const ageLinks = (email) => sql("UPDATE login_tokens SET created_at = datetime('now', '-3 minutes') WHERE email = ?", [email]);

const FORM = { company: 'Rao Labs', job_title: 'Founder', city: 'Pune', industry: 'Software & SaaS' };
const seed = async (name, email, mobile, over = {}) => {
  const r = await post('/api/events/1/attendees/register', { ...FORM, name, email, mobile, badge_type: 'Visitor Pass', ...over });
  await sleep(120);
  return Number(r.json?.id || 0);
};

(async () => {
  const { kitEncrypt, kitDecrypt, gatewayAnswer } = await import(pathToFileURL(path.join(__dirname, 'pay-db.mjs')).href);
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = [];
  const gw = { reply: 'Success', seen: [] };

  const phone = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: UA, serviceWorkers: 'block' });
    await ctx.route('https://secure.ccavenue.com/**', async (route) => {
      const form = new URLSearchParams(route.request().postData() || '');
      const sent = Object.fromEntries(new URLSearchParams(kitDecrypt(form.get('encRequest') || '')));
      gw.seen.push(sent);
      const order = { order_id: sent.order_id, amount_paise: Math.round(Number(sent.amount) * 100), pass_type: sent.merchant_param2 };
      const over = gw.reply === 'Success' ? {} : { order_status: gw.reply, tracking_id: 'null', status_message: 'N' };
      const encResp = kitEncrypt(gatewayAnswer('smoke-session', order, { merchant_param1: sent.merchant_param1, ...over }));
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body><form method="post" action="' + sent.redirect_url + '"><input type="hidden" name="encResp" value="' + encResp + '"></form><script>document.forms[0].submit()</script></body></html>' });
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e)));
    page.on('dialog', d => d.accept());
    return { ctx, page };
  };
  const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  // The paid pop-up on /register, typed by hand, then Proceed to Payment.
  const buy = async (page, hash, email, mobile) => {
    await page.goto(BASE + '/register?source=home-hero#' + hash, { waitUntil: 'load' });
    await page.waitForFunction(() => { const m = document.getElementById('reg-paid-pass-modal'); return m && !m.classList.contains('hidden'); }, null, { timeout: 15000 });
    await page.fill('#rpp-name', 'Typed Again');
    await page.fill('#rpp-email', email);
    await page.fill('#rpp-phone', mobile);
    await page.fill('#rpp-company', 'Rao Labs');
    await page.selectOption('#rpp-industry', 'Software & SaaS');
    await page.fill('#rpp-designation', 'Founder');
    await page.fill('#rpp-city', 'Pune');
    await page.evaluate(() => document.getElementById('rpp-submit-btn').scrollIntoView({ block: 'center' }));
    await page.click('#rpp-submit-btn');
    await page.waitForFunction(() => { const n = document.getElementById('rpp-notice'); return n && n.style.display !== 'none'; }, null, { timeout: 15000 }).catch(() => {});
  };
  const paidFormOpen = (page) => page.waitForFunction(() => { const m = document.getElementById('paid-pass-modal'); return m && !m.classList.contains('hidden'); }, null, { timeout: 25000 }).then(() => true).catch(() => false);
  const payFromApp = async (page) => {
    gw.reply = 'Success';
    await page.evaluate(() => document.getElementById('pp-submit-btn').scrollIntoView({ block: 'center' }));
    await page.click('#pp-submit-btn');
    await page.waitForURL(/\/pay\/result/, { timeout: 30000, waitUntil: 'domcontentloaded' }).catch(() => {});
    return /Payment received/.test(await page.textContent('body'));
  };
  const enterCode = async (page, code) => {
    await page.fill('#signin-code', code);
    await page.click('#signin-form button[type=submit]');
  };

  // ---- 1. Asha registers free, on the real form, with LinkedIn typed as the hint shows ----
  {
    const { ctx, page } = await phone();
    await page.goto(BASE + '/register?source=home-hero-free', { waitUntil: 'load' });
    await page.fill('#rf-name', 'Asha Rao');
    await page.fill('#rf-email', 'asha@example.com');
    await page.fill('#rf-phone', '9820011111');
    await page.fill('#rf-company', 'Rao Labs');
    await page.fill('#rf-title', 'Founder');
    await page.fill('#rf-city', 'Pune');
    await page.selectOption('#rf-industry', 'Software & SaaS');
    await page.fill('#rf-linkedin', 'linkedin.com/in/asha-rao');
    await page.click('#rf-submit');
    await page.waitForFunction(() => { const s = document.getElementById('reg-success'); return s && !s.classList.contains('hidden'); }, null, { timeout: 15000 }).catch(() => {});
    check('free form: LinkedIn typed as its hint shows no longer stops it', await page.isVisible('#reg-success'));
    const a = await person('asha@example.com');
    check('and the database has one Asha, on the free pass, with a working link, from the right button', !!a && a.badge_type === 'Visitor Pass' && a.linkedin_url === 'https://linkedin.com/in/asha-rao' && a.registration_source === 'home-hero-free', JSON.stringify(a));
    await ctx.close();
  }

  // ---- 2. Later, on another phone, she buys. The code from the email takes her to paying ----
  {
    const asha = await person('asha@example.com');
    const { ctx, page } = await phone();
    await buy(page, 'delegate', 'asha@example.com', '9820011111');
    await sleep(4800);   // the old message had gone by now
    const n = await page.evaluate(() => { const b = document.getElementById('rpp-notice'), r = b.getBoundingClientRect(); return { shown: b.style.display !== 'none' && r.height > 0, inView: r.top >= 0 && r.bottom <= innerHeight, text: b.textContent }; });
    check('Proceed to Payment: a notice that stays, on screen, in plain words', n.shown && n.inView && /already registered with us/.test(n.text) && /Delegate Pass opens next/.test(n.text), JSON.stringify(n));
    check('it fits a phone', await fits(page));
    const seen = await already(asha.id);
    const d = seen[0] ? JSON.parse(seen[0].detail) : {};
    check('Admin can count it: what she wanted, what she holds, which button', seen.length === 1 && d.wanted === 'Delegate Pass' && d.holds === 'Visitor Pass' && d.source === 'home-hero', JSON.stringify(seen));
    const a = await person('asha@example.com');
    check('nothing changed on her registration, no second row, no order', a.badge_type === 'Visitor Pass' && a.name === 'Asha Rao' && (await count('asha@example.com')) === 1 && (await orders(asha.id)).length === 0, JSON.stringify(a));
    const m = await signinMails('asha@example.com');
    check('one real email: subject, the pass, a link that carries on to payment, a code', m.length === 1 && subject(m[0]) === 'Sign in to pay for your Delegate Pass' && /action=pay&pass=delegate&token=/.test(linkIn(m[0])) && /^\d{6}$/.test(codeIn(m[0])), JSON.stringify(m.map(subject)));
    await page.click('#rpp-notice-link');
    await page.waitForFunction(() => { const f = document.getElementById('signin-code-field'); return f && !f.classList.contains('hidden'); }, null, { timeout: 25000 }).catch(() => {});
    const box = await page.evaluate(() => ({ email: document.getElementById('signin-email').value, note: document.getElementById('signin-note').textContent, url: location.pathname + location.search }));
    check('the button: the sign-in box, her address in it, ready for the code, nothing left in the address bar', box.email === 'asha@example.com' && /already registered/.test(box.note) && box.url === '/app', JSON.stringify(box));
    const refused = await sql("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'login.link_refused'");
    check('arriving like that is not counted as a dead sign-in link', refused[0].n === 0, JSON.stringify(refused));
    check('the sign-in box fits a phone', await fits(page));
    await enterCode(page, '000000');
    await sleep(900);
    check('a wrong code says so and stays on the code step', await page.isVisible('#signin-code') && /not|incorrect|invalid/i.test(await page.textContent('#signin-error')), await page.textContent('#signin-error'));
    await enterCode(page, codeIn(m[0]));
    const open = await paidFormOpen(page);
    const f = await page.evaluate(() => ({ pass: document.getElementById('pp-pass-type').value, name: document.getElementById('pp-name').value, email: document.getElementById('pp-email').value, phone: document.getElementById('pp-phone').value, city: document.getElementById('pp-city').value }));
    check('the right code: the paid form on Delegate, filled in from her real registration, not what was typed', open && f.pass === 'Delegate Pass' && f.name === 'Asha Rao' && f.email === 'asha@example.com' && f.phone === '9820011111', JSON.stringify(f));
    const paid = await payFromApp(page);
    const after = await person('asha@example.com');
    const os = await orders(asha.id);
    check('she pays: Payment received, a paid Delegate Pass on the same registration, one paid order', paid && after.id === asha.id && after.badge_type === 'Delegate Pass' && after.payment_status === 'paid' && (await count('asha@example.com')) === 1 && os.length === 1 && os[0].status === 'paid', JSON.stringify({ paid, after: after.badge_type, os }));
    await ctx.close();
  }

  // ---- 3. Ravi taps the link in the email instead, in the browser of his mail app ----
  {
    const id = await seed('Ravi Kumar', 'ravi@example.com', '9820022222');
    const a = await phone();
    await buy(a.page, 'vip', 'ravi@example.com', '9820022222');
    await sleep(500);
    await a.ctx.close();
    const m = await signinMails('ravi@example.com');
    await ageLinks('ravi@example.com');
    const b = await phone();
    await b.page.goto(linkIn(m[0]), { waitUntil: 'domcontentloaded' });
    const open = await paidFormOpen(b.page);
    const f = await b.page.evaluate(() => ({ pass: document.getElementById('pp-pass-type').value, url: location.search }));
    check('the emailed link on a phone never signed in: signed in, the paid form on VIP, the token gone from the address bar', open && f.pass === 'VIP Pass' && !/token=/.test(f.url), JSON.stringify(f));
    check('and it pays', await payFromApp(b.page) && (await person('ravi@example.com')).badge_type === 'VIP Pass' && (await orders(id)).length === 1, JSON.stringify(await person('ravi@example.com')));
    await b.ctx.close();
  }

  // ---- 4. The email never comes: Priya asks for it again and it still leads to paying ----
  {
    await seed('Priya Shah', 'priya@example.com', '9820033333');
    const { ctx, page } = await phone();
    await buy(page, 'premium', 'priya@example.com', '9820033333');
    await page.click('#rpp-notice-link');
    await page.waitForFunction(() => !!document.getElementById('signin-send-again'), null, { timeout: 25000 }).catch(() => {});
    await sleep(300);
    const first = await signinMails('priya@example.com');
    await page.click('#signin-send-again');
    await page.waitForFunction(() => window._signinCodeSent === true && /6-digit code/.test((document.getElementById('signin-error') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
    await sleep(300);
    const all = await signinMails('priya@example.com');
    const latest = all[all.length - 1];
    check('"Send it again": a second email, for the same pass', first.length === 1 && all.length === 2 && subject(latest) === 'Sign in to pay for your Premium Delegate Pass' && /action=pay&pass=premium&token=/.test(linkIn(latest)), JSON.stringify(all.map(subject)));
    await enterCode(page, codeIn(latest));
    const open = await paidFormOpen(page);
    check('its code opens the paid form on Premium Delegate', open && (await page.inputValue('#pp-pass-type')) === 'Premium Delegate Pass', await page.inputValue('#pp-pass-type').catch(() => 'closed'));
    await ctx.close();
  }

  // ---- 5. A mobile already on the list, under a new email ----
  {
    const neha = await seed('Neha Iyer', 'neha@example.com', '9820044444');
    const { ctx, page } = await phone();
    await buy(page, 'vip', 'neha.work@example.com', '+91 98200 44444');
    await sleep(4800);
    const n = await page.evaluate(() => { const b = document.getElementById('rpp-notice'), a = document.getElementById('rpp-notice-link'); return { shown: b.style.display !== 'none', text: b.textContent, href: a && a.getAttribute('href') }; });
    check('the notice stays, naming the masked address that holds the number', n.shown && /already registered with ne•••@example\.com/.test(n.text) && /Sign in and pay for my VIP Pass/.test(n.text), JSON.stringify(n));
    check('no second registration, and no email to the address just typed', !(await person('neha.work@example.com')) && (await signinMails('neha.work@example.com')).length === 0, '');
    await page.click('#rpp-notice-link');
    await page.waitForFunction(() => { const m = document.getElementById('registration-modal'); return m && !m.classList.contains('hidden'); }, null, { timeout: 25000 }).catch(() => {});
    await page.fill('#signin-email', 'neha@example.com');
    await page.click('#signin-form button[type=submit]');
    await page.waitForFunction(() => window._signinCodeSent === true, null, { timeout: 15000 }).catch(() => {});
    await sleep(300);
    const m = await signinMails('neha@example.com');
    check('signing in with the right address: the email is for the VIP Pass too', m.length === 1 && subject(m[0]) === 'Sign in to pay for your VIP Pass' && /action=pay&pass=vip&token=/.test(linkIn(m[0])), JSON.stringify(m.map(subject)));
    await enterCode(page, codeIn(m[0]));
    const open = await paidFormOpen(page);
    check('and the code opens the paid form on VIP, on the registered Neha', open && neha > 0 && (await page.inputValue('#pp-pass-type')) === 'VIP Pass' && (await page.inputValue('#pp-email')) === 'neha@example.com', '');
    await ctx.close();
  }

  // ---- 6. A shared phone, signed in as someone else: the payment must land on the one typed ----
  {
    const meera = await seed('Meera Nair', 'meera@example.com', '9820055555');
    const other = await seed('Omar Sait', 'omar@example.com', '9820066666');
    const { ctx, page } = await phone();
    const om = await signinMailsAfterAsk('omar@example.com');
    await page.goto(BASE + '/register', { waitUntil: 'load' });
    const login = await page.evaluate(async ([email, code]) => {
      const r = await fetch('/api/events/1/attendees/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code }) });
      const user = await r.json();
      if (r.ok) localStorage.setItem('agba_user', JSON.stringify(user));
      return { status: r.status, id: user.id };
    }, ['omar@example.com', codeIn(om)]);
    check('this phone is signed in as Omar', login.status === 200 && login.id === other, JSON.stringify(login));
    await buy(page, 'delegate', 'meera@example.com', '9820055555');
    await page.click('#rpp-notice-link');
    await page.waitForFunction(() => { const f = document.getElementById('signin-code-field'); return f && !f.classList.contains('hidden'); }, null, { timeout: 25000 }).catch(() => {});
    const m = await signinMails('meera@example.com');
    await enterCode(page, codeIn(m[0]));
    const open = await paidFormOpen(page);
    check('signed in as Omar, buying for Meera: the form opens on Meera', open && (await page.inputValue('#pp-email')) === 'meera@example.com', await page.inputValue('#pp-email').catch(() => 'closed'));
    const paid = await payFromApp(page);
    const os = await orders(meera), omar = await orders(other);
    check('and the money lands on Meera, never on Omar', paid && os.length === 1 && os[0].status === 'paid' && omar.length === 0 && (await person('omar@example.com')).badge_type === 'Visitor Pass', JSON.stringify({ paid, os, omar }));
    await ctx.close();
  }

  // ---- 7. Registered for a paid pass and never paid: after the code, straight to the payment page ----
  {
    const id = await seed('Tara Menon', 'tara@example.com', '9820077777', { badge_type: 'Delegate Pass' });
    const { ctx, page } = await phone();
    await buy(page, 'delegate', 'tara@example.com', '9820077777');
    await page.click('#rpp-notice-link');
    await page.waitForFunction(() => { const f = document.getElementById('signin-code-field'); return f && !f.classList.contains('hidden'); }, null, { timeout: 25000 }).catch(() => {});
    const m = await signinMails('tara@example.com');
    gw.reply = 'Success';
    await enterCode(page, codeIn(m[0]));
    await page.waitForURL(/\/pay\/result/, { timeout: 40000, waitUntil: 'domcontentloaded' }).catch(() => {});
    const t = await person('tara@example.com');
    check('an unpaid Delegate Pass goes to payment with no form, and is paid', t.id === id && t.payment_status === 'paid' && t.badge_type === 'Delegate Pass' && (await orders(id)).length === 1, JSON.stringify({ url: page.url(), pay: t.payment_status }));
    await ctx.close();
  }

  // ---- 7b. Someone new buys from the ad: the sale can be traced to where it came from ----
  // Until 5 Nov 2026 the paid form sent no source, so every paid registration read
  // 'networking_app' whichever button or ad brought the buyer.
  {
    const { ctx, page } = await phone();
    gw.reply = 'Success';
    await page.goto(BASE + '/register?utm_source=instagram&utm_campaign=delegate-nov#delegate', { waitUntil: 'load' });
    await page.waitForFunction(() => { const m = document.getElementById('reg-paid-pass-modal'); return m && !m.classList.contains('hidden'); }, null, { timeout: 15000 });
    await page.fill('#rpp-name', 'Zoya Khan');
    await page.fill('#rpp-email', 'zoya@example.com');
    await page.fill('#rpp-phone', '9820088888');
    await page.fill('#rpp-company', 'Khan Co');
    await page.selectOption('#rpp-industry', 'Software & SaaS');
    await page.fill('#rpp-designation', 'CTO');
    await page.fill('#rpp-city', 'Mumbai');
    await page.evaluate(() => document.getElementById('rpp-submit-btn').scrollIntoView({ block: 'center' }));
    await page.click('#rpp-submit-btn');
    await page.waitForURL(/\/pay\/result/, { timeout: 30000, waitUntil: 'domcontentloaded' }).catch(() => {});
    const z = await person('zoya@example.com');
    check('a new buyer from an Instagram ad link: paid, and the row says where she came from', !!z && z.payment_status === 'paid' && z.badge_type === 'Delegate Pass' && /instagram/.test(z.registration_source || ''), JSON.stringify(z && { pay: z.payment_status, source: z.registration_source }));
    await ctx.close();
    const b = await phone();
    await b.page.goto(BASE + '/register?source=home-hero#academic', { waitUntil: 'load' });
    await b.page.waitForFunction(() => { const m = document.getElementById('reg-paid-pass-modal'); return m && !m.classList.contains('hidden'); }, null, { timeout: 15000 });
    await b.page.fill('#rpp-name', 'Dev Student');
    await b.page.fill('#rpp-email', 'dev.student@example.com');
    await b.page.fill('#rpp-phone', '9820099999');
    await b.page.fill('#rpp-company', 'IIT Bombay');
    await b.page.selectOption('#rpp-industry', 'Education & Academia');
    await b.page.fill('#rpp-city', 'Mumbai');
    await b.page.evaluate(() => document.getElementById('rpp-submit-btn').scrollIntoView({ block: 'center' }));
    await b.page.click('#rpp-submit-btn');
    await b.page.waitForURL(/\/pay\/result/, { timeout: 30000, waitUntil: 'domcontentloaded' }).catch(() => {});
    const dv = await person('dev.student@example.com');
    check('and a tagged home button is kept too', !!dv && dv.registration_source === 'home-hero' && dv.badge_type === 'Academic Pass', JSON.stringify(dv && { source: dv.registration_source, badge: dv.badge_type }));
    await b.ctx.close();
  }

  // ---- 8. The free form with an address already on the list, and the app's own Register tab ----
  {
    const { ctx, page } = await phone();
    await page.goto(BASE + '/register', { waitUntil: 'load' });
    await page.fill('#rf-name', 'Asha Again');
    await page.fill('#rf-email', 'asha@example.com');
    await page.fill('#rf-phone', '9820011111');
    await page.fill('#rf-company', 'Rao Labs');
    await page.fill('#rf-title', 'Founder');
    await page.fill('#rf-city', 'Pune');
    await page.selectOption('#rf-industry', 'Software & SaaS');
    await page.click('#rf-submit');
    await page.waitForFunction(() => { const n = document.getElementById('rf-notice'); return n && !n.classList.contains('hidden'); }, null, { timeout: 15000 }).catch(() => {});
    const t = await page.textContent('#rf-notice');
    check('free form: the lasting notice with a way to sign in still works', /already registered/.test(t) && !!(await page.$('#rf-notice a[href*="login"]')), t);
    await ctx.close();
  }
  {
    const { ctx, page } = await phone();
    await page.goto(BASE + '/app#register', { waitUntil: 'load' });
    await page.waitForFunction(() => { const f = document.getElementById('register-form'); return f && !f.classList.contains('hidden'); }, null, { timeout: 25000 }).catch(() => {});
    const ok = await page.evaluate(() => {
      const box = document.getElementById('reg-linkedin');
      box.value = 'linkedin.com/in/app-person';
      return box.checkValidity();
    });
    check("the app's Register tab: LinkedIn typed as a plain address is accepted too", ok === true, String(ok));
    await ctx.close();
  }

  check('no page threw a script error, on any phone', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall system checks passed');
  process.exit(fails ? 1 : 0);

  // Asks for a plain sign-in email and returns it.
  async function signinMailsAfterAsk(email) {
    await post('/api/events/1/attendees/send-magic-link', { email });
    await sleep(120);
    const all = await signinMails(email);
    return all[all.length - 1];
  }
})().catch(e => { console.log('crashed: ' + (e && e.stack || e)); process.exit(1); });
