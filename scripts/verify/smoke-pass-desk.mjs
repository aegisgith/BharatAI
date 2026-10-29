// Built-worker checks for the pass QR and the badge desk: the signed token, the
// verification screen in every state, check-in, lookup and reissue tokens, the
// scan page's two readers, and a QR drawn by the bundled encoder read back by the
// bundled decoder. Run after `npm run build`:  node scripts/verify/smoke-pass-desk.mjs
//
// The database is a stand-in with just enough rows for these routes. Production
// signs with ADMIN_SECRET alone (no PASS_SECRET or SESSION_SECRET is set there),
// and the last block checks that shape too.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { sessionCookie, staffCookie } from './pay-db.mjs';
const worker = (await import(new URL('../../dist/_worker.js?' + Date.now(), import.meta.url).href)).default;
const ROOT = new URL('../../', import.meta.url);
// The vendored files are classic UMD scripts; under this package's "type":
// "module" a require() would read them as ESM and get nothing, so they are run
// the way a browser runs them, with a module object to export into.
const loadUmd = (rel) => { const m = { exports: {} }; vm.runInNewContext(readFileSync(new URL(rel, ROOT), 'utf8'), { module: m, exports: m.exports }); return m.exports; };

const SECRET = 'smoke-pass-secret', ADMIN = 'smoke-admin';
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };

const state = { attendees: {}, staff: {}, audits: [] };
const person = (id, over = {}) => (state.attendees[id] = { id, event_id: 1, name: 'Asha Rao', email: `a${id}@example.com`, mobile: '98200 1234' + id,
  company: 'Acme AI', job_title: 'CTO', badge_type: 'Delegate Pass', payment_status: 'paid', avatar_url: '', main_event: 1,
  checked_in_at: null, checked_in_by: null, photo_flagged_at: null, photo_flagged_by: null, flagged_avatar_url: null, ...over });
person(7);
person(8, { name: 'Panel Only', main_event: 0 });
person(9, { name: 'Not Paid Yet', payment_status: 'pending' });
person(10, { name: 'Free Visitor', badge_type: 'Visitor Pass' });
state.staff[1] = { id: 1, name: 'Desk One', username: 'desk1', active: 1, role: 'desk' };
state.staff[2] = { id: 2, name: 'Accounts', username: 'finance', active: 1, role: 'finance' };

const DB = {
  prepare(sql) {
    let args = [];
    const flat = sql.replace(/\s+/g, ' ').trim();
    const stmt = {
      bind(...a) { args = a; return stmt; },
      async first() {
        if (/^PRAGMA table_info\(/.test(flat)) return null;
        if (/^SELECT id FROM (workshops|workshop_seats|photo_flags) LIMIT 1$/.test(flat)) throw new Error('no such table');
        if (/FROM staff WHERE id = \?$/.test(flat)) { const s = state.staff[Number(args[0])]; return s ? { ...s } : null; }
        if (/FROM attendees WHERE id = \?$/.test(flat)) { const a = state.attendees[Number(args[0])]; return a ? { ...a } : null; }
        if (/^SELECT payment_status FROM attendees LIMIT 1$/.test(flat)) return null;
        return null;
      },
      async all() {
        if (/^PRAGMA table_info\(staff\)$/.test(flat)) return { results: ['id', 'name', 'username', 'password_hash', 'active', 'role', 'email', 'failed_attempts', 'last_failed_at'].map(name => ({ name })) };
        if (/^PRAGMA table_info\(attendees\)$/.test(flat)) return { results: Object.keys(state.attendees[7]).map(name => ({ name })) };
        if (/FROM attendees WHERE id = \? OR lower\(name\) LIKE/.test(flat)) {
          const id = Number(args[0]), like = String(args[1]).replace(/%/g, '').toLowerCase();
          return { results: Object.values(state.attendees).filter(a => a.id === id || (like && a.name.toLowerCase().includes(like))) };
        }
        return { results: [] };
      },
      async run() {
        if (/^UPDATE attendees SET checked_in_at = datetime\('now'\), checked_in_by = \? WHERE id = \?$/.test(flat)) {
          const a = state.attendees[Number(args[1])];
          if (a) { a.checked_in_at = new Date().toISOString().slice(0, 19).replace('T', ' '); a.checked_in_by = args[0]; }
          return { meta: { changes: a ? 1 : 0 } };
        }
        if (/^INSERT INTO admin_audit/.test(flat)) { state.audits.push({ action: args[2], entity_id: args[4], actor: args[0] }); return { meta: { changes: 1 } }; }
        return { meta: { changes: 1, last_row_id: 1 } };
      },
    };
    return stmt;
  },
  async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
};
const envFor = (over = {}) => new Proxy({ ADMIN_SECRET: ADMIN, SESSION_SECRET: SECRET, DB, ...over }, { get: (t, k) => (k in t ? t[k] : undefined) });
const env = envFor();
const ctx = { waitUntil() {}, passThroughOnException() {} };
const hit = async (path, init = {}, e = env) => {
  const r = await worker.fetch(new Request('https://bharataiinnovation.com' + path, init), e, ctx);
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* html */ }
  return { status: r.status, text, json, headers: r.headers };
};
const desk = { headers: { Cookie: staffCookie(SECRET, 1) } };
const finance = { headers: { Cookie: staffCookie(SECRET, 2) } };
const attendee = (id) => ({ headers: { Cookie: sessionCookie(SECRET, id) } });
const post = (init = {}) => ({ ...init, method: 'POST', headers: { 'Content-Type': 'application/json', ...(init.headers || {}) }, body: '{}' });

// ---- the signed token ----
let r = await hit('/api/my-pass-token');
check('pass token refuses without a sign-in', r.status === 401, r.status + ' ' + r.text.slice(0, 80));
r = await hit('/api/my-pass-token', attendee(7));
const tok7 = r.json && r.json.token;
check('a signed-in attendee gets <id>.<24 hex> (signed, no personal data)', r.status === 200 && /^7\.[0-9a-f]{24}$/.test(tok7 || ''), r.status + ' ' + r.text.slice(0, 80));
r = await hit('/api/my-pass-token', attendee(8));
check('a panel-only registrant (main_event 0) gets no pass token', r.status === 403 && r.json && r.json.error === 'main_event_consent', r.status + ' ' + r.text.slice(0, 80));
r = await hit('/api/my-pass-token', attendee(9));
check('an unpaid Delegate Pass gets no pass token (402, with the Pay now hint)', r.status === 402 && r.json && r.json.error === 'payment_pending' && /Pay now/.test(r.json.message || ''), r.status + ' ' + r.text.slice(0, 120));
r = await hit('/api/my-pass-token', attendee(10));
check('a free Visitor Pass gets a token', r.status === 200 && /^10\.[0-9a-f]{24}$/.test((r.json && r.json.token) || ''), r.status + ' ' + r.text.slice(0, 80));
r = await hit('/api/my-pass-token?id=8', { headers: { Authorization: 'Bearer ' + ADMIN } });
const tok8 = r.json && r.json.token;
check('admin may mint for anyone, panel-only included (the desk issues by hand)', r.status === 200 && /^8\.[0-9a-f]{24}$/.test(tok8 || ''), r.status + ' ' + r.text.slice(0, 80));
r = await hit('/api/my-pass-token?id=9', { headers: { Authorization: 'Bearer ' + ADMIN } });
const tok9 = r.json && r.json.token;
r = await hit('/api/my-pass-token?id=8', attendee(7));
check('?id= without admin is ignored: an attendee only ever gets their own', r.status === 200 && r.json && r.json.token === tok7, r.status + ' ' + r.text.slice(0, 80));

// ---- the verification screen ----
r = await hit('/verify/' + tok7);
check('a stranger scanning a pass sees no name, no tier, no Check in button', r.status === 200 && /Badge desk staff only/.test(r.text) && !/Asha Rao/.test(r.text) && !/id="ci"/.test(r.text), r.status + ' ' + r.text.replace(/\s+/g, ' ').slice(0, 120));
r = await hit('/verify/' + tok7, desk);
check('the desk sees VALID PASS, the name, the tier and Check in', r.status === 200 && /VALID PASS/.test(r.text) && /Asha Rao/.test(r.text) && /Delegate Pass/.test(r.text) && /id="ci"/.test(r.text), r.status + ' ' + r.text.replace(/\s+/g, ' ').slice(0, 160));
check('no photo on file: the desk is told to check the name on an ID', /NO PHOTO/.test(r.text) && /government photo ID/.test(r.text), 'banner');
const flipped = tok7.slice(0, -1) + (tok7.endsWith('0') ? '1' : '0');
r = await hit('/verify/' + flipped, desk);
check('one wrong character in the signature: NOT VALID, no name, no button', /NOT VALID/.test(r.text) && !/Asha Rao/.test(r.text) && !/id="ci"/.test(r.text), r.text.replace(/\s+/g, ' ').slice(0, 120));
r = await hit('/verify/8.' + tok7.split('.')[1], desk);
check('a valid signature moved onto another id: NOT VALID', /NOT VALID/.test(r.text) && !/Panel Only/.test(r.text), r.text.replace(/\s+/g, ' ').slice(0, 120));
r = await hit('/verify/7', desk);
check('a bare id is NOT VALID', /NOT VALID/.test(r.text), r.text.replace(/\s+/g, ' ').slice(0, 120));
r = await hit('/verify/' + tok8, desk);
check('panel-only: NOT REGISTERED, no Check in button', /NOT REGISTERED/.test(r.text) && !/id="ci"/.test(r.text), r.text.replace(/\s+/g, ' ').slice(0, 160));
r = await hit('/verify/' + tok9, desk);
check('unpaid tier: PAYMENT PENDING banner', /PAYMENT PENDING/.test(r.text) && /Do not admit without checking/.test(r.text), r.text.replace(/\s+/g, ' ').slice(0, 160));
r = await hit('/verify/' + tok7 + '</script><script>alert(1)</script>', desk);
check('a crafted token cannot close the script block', !/<script>alert/.test(r.text), 'raw </script> in page');

// ---- check-in ----
r = await hit('/api/verify/' + tok7 + '/checkin', post());
check('check-in refuses without a desk session', r.status === 401, r.status + ' ' + r.text.slice(0, 80));
r = await hit('/api/verify/' + tok7 + '/checkin', post(finance));
check('a finance login cannot check anyone in', r.status === 401, r.status + ' ' + r.text.slice(0, 80));
r = await hit('/api/verify/' + flipped + '/checkin', post(desk));
check('a tampered token cannot be checked in', r.status === 400, r.status + ' ' + r.text.slice(0, 80));
r = await hit('/api/verify/' + tok8 + '/checkin', post(desk));
check('a panel-only pass cannot be checked in', r.status === 400 && /campus panel/.test(r.text), r.status + ' ' + r.text.slice(0, 80));
r = await hit('/api/verify/' + tok7 + '/checkin', post(desk));
check('the desk checks the holder in, attributed to the desk account', r.status === 200 && r.json && r.json.success === true && state.attendees[7].checked_in_by === 'Desk One', r.status + ' ' + r.text.slice(0, 80) + ' by=' + state.attendees[7].checked_in_by);
r = await hit('/api/verify/' + tok7 + '/checkin', post(desk));
check('a second scan says already, with the IST time, and does not re-stamp', r.status === 200 && r.json && r.json.already === true && /IST$/.test(r.json.at_ist || ''), r.status + ' ' + r.text.slice(0, 120));
r = await hit('/verify/' + tok7, desk);
check('the screen then shows Already checked in and an Undo', /Already checked in/.test(r.text) && /id="undo"/.test(r.text) && !/id="ci"/.test(r.text), r.text.replace(/\s+/g, ' ').slice(0, 160));

// ---- lookup and reissue mint the same token the app would ----
r = await hit('/api/staff/lookup?q=BHAI-2026-00010', desk);
const found = r.json && r.json.results && r.json.results[0];
check('lookup by BHAI number finds the person and hands back a token, no email or mobile', r.status === 200 && found && found.ref === 'BHAI-2026-00010' && /^10\.[0-9a-f]{24}$/.test(found.token) && !('email' in found) && !('mobile' in found), r.status + ' ' + r.text.slice(0, 160));
r = await hit('/verify/' + (found ? found.token : 'x'), desk);
check('the lookup token opens a VALID PASS screen', /VALID PASS/.test(r.text) && /Free Visitor/.test(r.text), r.text.replace(/\s+/g, ' ').slice(0, 120));
r = await hit('/api/staff/lookup?q=BHAI-2026-00010', finance);
check('finance cannot look attendees up', r.status === 403, r.status + ' ' + r.text.slice(0, 80));
r = await hit('/api/desk/reissue', { ...post(desk), body: JSON.stringify({ id: 7 }) });
check('reissue by id mints the very token the app drew (deterministic signature)', r.status === 200 && r.json && r.json.token === tok7 && r.json.verify_url === '/verify/' + tok7, r.status + ' ' + r.text.slice(0, 120));
check('the reissue is audited to the desk account', state.audits.some(a => a.action === 'desk.reissue' && a.actor === 'Desk One'), JSON.stringify(state.audits));
r = await hit('/api/desk/reissue', { ...post(desk), body: JSON.stringify({ id: 8 }) });
check('reissue refuses a panel-only registrant', r.status === 400, r.status + ' ' + r.text.slice(0, 80));

// ---- the scan page: two readers, same-origin navigation, parses ----
r = await hit('/staff/scan', { redirect: 'manual' });
check('/staff/scan without a session redirects to sign-in', r.status === 302, r.status);
r = await hit('/staff/scan', { ...desk, redirect: 'manual' });
check('/staff/scan loads the bundled decoder for phones without BarcodeDetector', r.status === 200 && /<script src="\/js\/vendor\/jsQR\.js\?v=\d+"><\/script>/.test(r.text), r.status + ' ' + r.text.slice(0, 80));
const scanScript = (r.text.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/) || [])[1] || '';
let parses = true; try { new Function(scanScript); } catch (e) { parses = false; }
check('the scan page script parses', parses && scanScript.length > 1000, parses ? 'short' : 'syntax error');
check('BarcodeDetector first, jsQR when it is missing, lists no qr_code, or throws', /useJs=!\('BarcodeDetector' in window\)/.test(scanScript) && /catch\(err\)\{ useJs=true; \}/.test(scanScript) && /getSupportedFormats/.test(scanScript) && /jsQR\(img\.data,w,h/.test(scanScript), 'reader logic');
check('a scanned code is never followed as a URL: the token goes to /verify/ on this origin', /location\.href='\/verify\/'\+m\[1\]/.test(scanScript) && !/location\.href=url/.test(scanScript) && !/\\/.test(scanScript), 'navigation');
check('a camera that will not start offers a Start the camera button (iOS)', /id="cam"/.test(r.text) && /camBtn\.style\.display='block'/.test(scanScript), 'no retry');
const VERIFY = new RegExp('/verify/([A-Za-z0-9._%-]+)');
check('the token regex takes exactly the token from a pass QR', (VERIFY.exec('https://bharataiinnovation.com/verify/' + tok7) || [])[1] === tok7 && !VERIFY.exec('https://evil.example/verif/x'), 'regex');
r = await hit('/staff/scan', { ...finance, redirect: 'manual' });
check('finance is sent away from the scanner', r.status === 302 && /\/finance/.test(r.headers.get('location') || ''), r.status + ' ' + r.headers.get('location'));

// ---- the pass draws its own QR, and refuses without one ----
const passJs = readFileSync(new URL('public/js/pass-render.js', ROOT), 'utf8');
check('pass-render.js draws the QR with the bundled encoder, qrserver only as fallback', /global\.qrcode\(0, 'M'\)/.test(passJs) && passJs.indexOf("global.qrcode(0, 'M')") < passJs.indexOf("proxy('https://api.qrserver.com"), 'order');
check('pass-render.js reports qrFailed and download() refuses on it', /qrFailed: qrFailed/.test(passJs) && /res\.photoFailed \|\| res\.qrFailed/.test(passJs), 'flags');
for (const [page, name] of [['/app', 'app'], ['/admin', 'admin']]) {
  r = await hit(page);
  const vendor = r.text.indexOf('/js/vendor/qrcode-generator.js?v='), render = r.text.indexOf('/js/pass-render.js?v=20261029');
  check(`${name} page loads the encoder before pass-render.js?v=20261029`, r.status === 200 && vendor > 0 && render > vendor, r.status + ' vendor@' + vendor + ' render@' + render);
}
r = await hit('/app.js');
check('the app refuses to draw a pass without a token, and says why', /if \(!passToken\) \{/.test(r.text) && /Could not prepare the QR code for your pass/.test(r.text) && /passRes\.qrFailed/.test(r.text), 'generateEventPass');
r = await hit('/admin.js');
check('the admin refuses to draw a pass without a token or a QR', /Could not get a pass token for/.test(r.text) && /res\.qrFailed/.test(r.text), 'adminDownloadPass');
const sw = readFileSync(new URL('public/sw.js', ROOT), 'utf8');
check('the service worker precaches the encoder and the new renderer (venue WiFi) under a new VERSION', /'\/js\/vendor\/qrcode-generator\.js\?v=20261029'/.test(sw) && /'\/js\/pass-render\.js\?v=20261029'/.test(sw) && !/bhai-v16'/.test(sw), 'sw precache');

// ---- a QR from the encoder, read by the decoder, yields the token ----
const qrcode = loadUmd('public/js/vendor/qrcode-generator.js');
const jsQR = loadUmd('public/js/vendor/jsQR.js');
check('the vendored encoder and decoder load as the browser will see them', typeof qrcode === 'function' && typeof jsQR === 'function', typeof qrcode + ' ' + typeof jsQR);
const url = 'https://bharataiinnovation.com/verify/' + tok7;
const code = qrcode(0, 'M'); code.addData(url); code.make();
const n = code.getModuleCount();
for (const cell of [3, 9]) {
  const margin = 4, size = (n + margin * 2) * cell, px = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const mx = Math.floor(x / cell) - margin, my = Math.floor(y / cell) - margin;
    const dark = mx >= 0 && my >= 0 && mx < n && my < n && code.isDark(my, mx);
    const i = (y * size + x) * 4; px[i] = px[i + 1] = px[i + 2] = dark ? 0 : 255; px[i + 3] = 255;
  }
  const d = jsQR(px, size, size);
  check(`a ${n}-module code at ${cell}px per module decodes to the verify link and its token`, !!d && d.data === url && (VERIFY.exec(d.data) || [])[1] === tok7, d ? d.data : 'no decode');
}

// ---- production's shape: ADMIN_SECRET alone signs passes and desk sessions ----
const prodEnv = envFor({ SESSION_SECRET: undefined });
r = await hit('/api/my-pass-token?id=7', { headers: { Authorization: 'Bearer ' + ADMIN } }, prodEnv);
const tokProd = r.json && r.json.token;
check('with only ADMIN_SECRET set (production), passes are signed with it', r.status === 200 && /^7\.[0-9a-f]{24}$/.test(tokProd || '') && tokProd !== tok7, r.status + ' ' + r.text.slice(0, 80));
r = await hit('/verify/' + tokProd, { headers: { Cookie: staffCookie(ADMIN, 1) } }, prodEnv);
check('...and a desk session signed with it opens VALID PASS', /VALID PASS/.test(r.text) && /Asha Rao/.test(r.text), r.text.replace(/\s+/g, ' ').slice(0, 120));
r = await hit('/verify/' + tokProd, { headers: { Cookie: staffCookie('rotated-admin-secret', 1) } }, envFor({ SESSION_SECRET: undefined, ADMIN_SECRET: 'rotated-admin-secret' }));
check('rotating ADMIN_SECRET makes every issued pass NOT VALID (set PASS_SECRET first - handbook §10)', /NOT VALID/.test(r.text), r.text.replace(/\s+/g, ' ').slice(0, 120));
r = await hit('/verify/' + tokProd, { headers: { Cookie: staffCookie(ADMIN, 1) } }, envFor({ SESSION_SECRET: undefined, ADMIN_SECRET: 'rotated-admin-secret', PASS_SECRET: ADMIN }));
check('PASS_SECRET set to the old value keeps every pass and desk session valid through a rotation', /VALID PASS/.test(r.text) && /Asha Rao/.test(r.text), r.text.replace(/\s+/g, ' ').slice(0, 120));

console.log(fails ? `\n${fails} FAILED` : '\nall pass + badge desk checks passed');
process.exit(fails ? 1 : 0);
