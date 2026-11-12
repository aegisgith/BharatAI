// The built worker on real SQLite with the production schema (login-world.mjs),
// with checkout switched on and the gateway played here, for the pass upgrade
// suites (5 Nov 2026): unit-upgrade-steps.mjs, integration-upgrade.mjs and
// system-upgrade-journey.mjs. The phone-browser level is pay-test.cjs, section 3b.
// Run after `npm run build`.
import vm from 'node:vm';
import { makeWorld, checker, ADMIN, CRON, SESSION_SECRET, settle } from './login-world.mjs';
import { SECRETS, kitEncrypt, kitDecrypt, gatewayAnswer } from './pay-db.mjs';
export { checker, ADMIN, CRON, settle };

// The price is dated, so every check says which day it is. These two instants
// are either side of the change: 15:30 IST on the last day of the standard
// price, and 15:30 IST on the first day of the late one.
export const STANDARD = '2026-11-05T10:00:00Z';
export const LATE = '2026-11-06T10:00:00Z';
// The organiser's figures, whole rupees before GST, written out here by hand on
// purpose: these suites fail if the table in the worker drifts from them.
export const LIST = {
  [STANDARD]: { 'Academic Pass': 999, 'Delegate Pass': 4999, 'Premium Delegate Pass': 9999, 'VIP Pass': 19999 },
  [LATE]: { 'Academic Pass': 3999, 'Delegate Pass': 8999, 'Premium Delegate Pass': 14999, 'VIP Pass': 24999 },
};
export const LADDER = ['Academic Pass', 'Delegate Pass', 'Premium Delegate Pass', 'VIP Pass'];
export const GST = 18;
// Paise, the way the order row holds them.
export const paise = (rupees) => { const base = rupees * 100, gst = Math.round(base * GST / 100); return { base, gst, total: base + gst }; };

export async function makeUpgradeWorld() {
  const W = await makeWorld();
  Object.assign(W.env, SECRETS);   // the three CCAvenue values: checkout is on
  // D1 answers a batch with each statement's result, row id included, and the
  // receipt code reads the new receipt's id from it. login-world's stand-in
  // answers a batch with empty results, which left the receipt made but never
  // emailed; here a batch answers the way D1 does.
  W.D1.batch = async (list) => { const out = []; for (const st of list) out.push(await st.run()); return out; };

  // Only Date.now moves: it is what the worker reads for the price of the day and
  // for a session's life. SQLite keeps real time, so an order is stamped with the
  // pinned instant when it is made (the hand-off page asks how old it is).
  const realNow = Date.now;
  let pinned = null;
  const at = (iso) => { pinned = iso; const t = Date.parse(iso); Date.now = () => t; };
  const realClock = () => { pinned = null; Date.now = realNow; };
  const stamp = (iso) => iso.slice(0, 19).replace('T', ' ');

  let nextMobile = 9820100000;
  const person = (id, over = {}) => {
    const a = { name: 'Person ' + id, email: 'p' + id + '@example.com', mobile: String(nextMobile++), badge_type: 'Visitor Pass', payment_status: 'paid',
      payment_amount: null, company: 'Org ' + id, job_title: 'Head of Data', city: 'Mumbai', industry: 'Software & SaaS', main_event: 1, ...over };
    W.db.run('INSERT INTO attendees (id, event_id, name, email, mobile, badge_type, payment_status, payment_amount, company, job_title, city, industry, main_event) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, a.name, a.email, a.mobile, a.badge_type, a.payment_status, a.payment_amount, a.company, a.job_title, a.city, a.industry, a.main_event]);
    return id;
  };
  const who = (id) => W.q('SELECT * FROM attendees WHERE id = ?', id)[0];
  const order = (orderId) => W.q('SELECT * FROM payment_orders WHERE order_id = ?', orderId)[0];
  const ordersOf = (id) => W.q('SELECT * FROM payment_orders WHERE attendee_id = ? ORDER BY id', id);

  // Step one, as the signed-in person: the order at the server's price.
  const start = async (id, pass, extra = {}) => {
    const r = await W.hit('POST', '/api/payments/ccavenue/start', { pass_type: pass, ...extra }, id ? W.as(id) : {});
    if (r.json?.order_id && pinned) W.db.run('UPDATE payment_orders SET created_at = ? WHERE order_id = ?', [stamp(pinned), r.json.order_id]);
    return r;
  };
  // Step two: the hand-off page, and what it would post to the gateway, decrypted
  // the way CCAvenue's kits do it.
  const handoff = async (payUrl) => {
    const r = await W.hit('GET', payUrl);
    const enc = (r.text.match(/name="encRequest" value="([0-9a-f]+)"/) || [])[1] || '';
    let asked = {};
    try { asked = Object.fromEntries(new URLSearchParams(kitDecrypt(enc))); } catch (e) { asked = {}; }
    return { ...r, asked };
  };
  // Step three: the gateway's answer, posted back the way the buyer's browser
  // carries it. `over` changes fields of the answer; `plain` replaces it whole.
  const answer = async (orderId, over = {}, plain) => {
    const o = order(orderId);
    const body = new URLSearchParams({ encResp: kitEncrypt(plain || gatewayAnswer(SESSION_SECRET, o, over)), orderNo: orderId }).toString();
    const res = await W.worker.fetch(new Request('https://bharataiinnovation.com/pay/ccavenue/return', {
      method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }), W.env, W.ctx);
    return { status: res.status, location: res.headers.get('location') || '' };
  };
  // Mail and receipts are sent after the answer returns: wait for what is expected.
  const until = async (ok, ms = 8000) => { const end = realNow() + ms; while (!ok() && realNow() < end) await new Promise((r) => setTimeout(r, 40)); return ok(); };
  // Start, hand off and pay in one go; returns the order as paid.
  const buy = async (id, pass) => {
    const s = await start(id, pass);
    if (s.status !== 201) return { start: s };
    const back = await answer(s.json.order_id);
    await until(() => (order(s.json.order_id) || {}).status === 'paid' && String((who(id) || {}).badge_type) === pass);
    return { start: s, back, order: order(s.json.order_id) };
  };

  const mailTo = (email) => W.sent.filter(p => W.to(p) === email);
  const setting = (key, value) => W.db.run('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, String(value)]);

  // The app's own arithmetic, lifted from the /app.js this build serves and run on
  // its own: the ladder, the difference, what a pass adds. No browser.
  const appFunctions = async (names) => {
    const js = (await W.hit('GET', '/app.js')).text;
    const src = (name) => {
      const m = js.match(new RegExp('\\n( *)(?:async )?function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\1\\}'));
      if (!m) throw new Error('/app.js has no function ' + name);
      return m[0];
    };
    const ladder = js.match(/var UPGRADE_LADDER = \[[^\]]*\];/);
    if (!ladder) throw new Error('/app.js has no UPGRADE_LADDER');
    const team = js.match(/var TEAM_PASSES_APP = \[[^\]]*\];/);
    if (!team) throw new Error('/app.js has no TEAM_PASSES_APP');
    const box = vm.createContext({ Number, Math, String, Array, Object, JSON });
    const helpers = ['offerSteps', 'offersEnd'].filter(n => !names.includes(n));
    vm.runInContext('var _ppPrices = null, _ppGst = 18, _ppOffers = null;\n' + ladder[0] + '\n' + team[0] + '\n' + [...helpers, ...names].map(src).join('\n'), box);
    return box;
  };

  return { ...W, at, realClock, person, who, order, ordersOf, start, handoff, answer, until, buy, mailTo, setting, appFunctions };
}
