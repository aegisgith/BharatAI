// Playwright on an emulated Android phone against login-harness.mjs (the real
// built worker on real SQLite): Asha registers, the welcome email goes out, the
// clock sends the account-ready email at five minutes and the networking email
// at ten, and then she taps each email's button on a phone that was never signed
// in - oldest first, after the newer emails went out (4 Nov 2026: the newer
// emails used to kill the older links). Each opens the app signed in as her,
// spends one use, retires nothing and counts nothing as a dead link. A made-up
// link opens the sign-in box on her address with the note.
// Needs login-harness.mjs (HARNESS_PORT, default 8780).
const { chromium } = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8780);
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
const EMAIL = 'asha@example.com';
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const post = async (path, body, headers = {}) => {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const sql = async (s, args = []) => (await post('/__sql', { sql: s, args })).json;
const mail = async () => (await fetch(BASE + '/__mail')).json();
const to = (p) => (p?.Recipients?.To || [])[0] || '';
const body = (p) => p?.Content?.Body?.[0]?.Content || '';
const linkIn = (p) => ((body(p).match(/href="([^"]*token=[0-9a-f]{64}[^"]*)"/) || [])[1] || '').replace(/&amp;/g, '&');
const CRON = { Authorization: 'Bearer smoke-cron' };

(async () => {
  // ---- the three emails, exactly as the app and the clock send them ----
  let r = await post('/api/events/1/attendees/register', { name: 'Asha Rao', email: EMAIL, mobile: '9820012345', company: 'Rao Labs', job_title: 'Founder', city: 'Pune', industry: 'Software & SaaS', badge_type: 'Visitor Pass' });
  const asha = Number(r.json?.id || 0);
  check('register: Asha is in', (r.status === 200 || r.status === 201) && asha > 0, r.status + ' ' + JSON.stringify(r.json).slice(0, 160));
  await sleep(200);
  const age = (m) => sql(`UPDATE admin_audit SET created_at = datetime('now', '-${m} minutes') WHERE action = 'register.self' AND entity_id = ?`, [String(asha)]);
  await age(6); await post('/api/cron/tick', {}, CRON); await sleep(200);
  await age(11); await post('/api/cron/tick', {}, CRON); await sleep(200);
  const mails = (await mail()).filter(p => to(p) === EMAIL);
  const links = mails.map(p => ({ subject: p.Content.Subject, href: linkIn(p) }));
  check('three emails, each with a sign-in link to this harness', links.length === 3 && links.every(l => l.href.startsWith(BASE + '/app?')), JSON.stringify(links));
  // Older than two minutes, so each opening is hers and spends a use.
  await sql("UPDATE login_tokens SET created_at = datetime('now', '-3 minutes') WHERE email = ?", [EMAIL]);

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  // A phone that was never signed in opens one link.
  const open = async (href) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: UA, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(href, { waitUntil: 'domcontentloaded' });
    let user = null;
    try {
      await page.waitForFunction(() => { try { const u = JSON.parse(localStorage.getItem('agba_user') || 'null'); return !!(u && u.id); } catch (e) { return false; } }, null, { timeout: 15000 });
      user = await page.evaluate(() => JSON.parse(localStorage.getItem('agba_user')));
    } catch { /* not signed in: the sign-in box, below */ }
    await sleep(300);
    const note = await page.locator('#signin-note').textContent().catch(() => '');
    const out = { user, note: (note || '').trim(), url: page.url(), errors };
    await ctx.close();
    return out;
  };

  for (const [i, l] of links.entries()) {
    const o = await open(l.href);
    check(`phone: the "${l.subject.slice(0, 44)}" button opens the app signed in as Asha${i === 0 ? ', after two newer emails' : ''}`,
      !!o.user && o.user.id === asha && String(o.user.email).toLowerCase() === EMAIL && !/token=/.test(o.url),
      JSON.stringify({ user: o.user && o.user.id, url: o.url, note: o.note, errors: o.errors.slice(0, 2) }));
  }
  const used = await sql('SELECT uses, used_at, attempts FROM login_tokens WHERE email = ? AND max_uses > 1 ORDER BY id', [EMAIL]);
  check('each link spent one use; none retired; no wrong attempts', used.length === 3 && used.every(u => u.uses === 1 && !u.used_at && u.attempts === 0), JSON.stringify(used));
  let refused = await sql("SELECT detail FROM admin_audit WHERE action = 'login.link_refused' AND entity_id = ?", [String(asha)]);
  check('nothing counted as a dead link', refused.length === 0, JSON.stringify(refused));

  // ---- the welcome link a second time, from another phone ----
  const twice = await open(links[0].href);
  check('phone: the welcome button works again on another phone', !!twice.user && twice.user.id === asha, JSON.stringify({ user: twice.user && twice.user.id, note: twice.note }));

  // ---- a made-up link ----
  const dead = await open(BASE + '/app?email=' + encodeURIComponent(EMAIL) + '&action=social-card&token=' + 'a'.repeat(64));
  check('phone: a dead link opens the sign-in box on her address, with the note', !dead.user && /expired/i.test(dead.note), JSON.stringify({ user: dead.user && dead.user.id, note: dead.note, errors: dead.errors.slice(0, 2) }));
  refused = await sql("SELECT detail FROM admin_audit WHERE action = 'login.link_refused' AND entity_id = ?", [String(asha)]);
  check('the dead link is counted once, as expired, and cost the real links nothing', refused.length === 1 && /expired/.test(refused[0].detail) && (await sql('SELECT attempts FROM login_tokens WHERE email = ? AND max_uses > 1', [EMAIL])).every(u => u.attempts === 0), JSON.stringify(refused));

  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'all phone sign-in link checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
