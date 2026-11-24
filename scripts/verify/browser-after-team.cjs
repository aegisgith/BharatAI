// Admin -> After the Event -> Booth photos, everyone at each company (24 Nov 2026, the
// organiser: "build send all"). A real browser on the real public/js/admin-after.js and its
// stylesheet, desktop and phone, with the Admin API played here: "Team" on a row (who
// represents the company, how each was found, which of the two emails each has had, send to
// those who have not, look at the account email first), and the two "send to every team"
// buttons (they count first, ask, send each company its own list, and nobody twice).
// Needs no harness and no build.  node scripts/verify/browser-after-team.cjs
const fs = require('fs');
const path = require('path');
const pw = require('./playwright.cjs');
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const js = fs.readFileSync(path.join(__dirname, '../../public/js/admin-after.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../../public/css/admin-after.css'), 'utf8');
const PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="host"></div><script>
window.calls = []; window.toasts = []; window.confirms = [];
window.confirm = function (t) { window.confirms.push(t); return window.sayYes !== false; };
var sentLink = { acme: { 'spoc@acme.test': true }, beta: {} }, sentAcct = { acme: {}, beta: {} };
var team = {
  acme: [{ email: 'spoc@acme.test', name: 'Asha Rao', why: ['booth contact', 'dashboard account'], mobile: '+91 98200 00001' }, { email: 'ravi@acme.test', name: 'Ravi Kumar', why: ['team list'], mobile: '' }, { email: 'una@acme.test', name: 'Una Sub', why: ['same email domain'], mobile: '', unsubscribed: true }],
  beta: [{ email: 'b1@beta.test', name: 'Bina Shah', why: ['company name'], mobile: '' }]
};
function would(key, sent) { return (team[key] || []).filter(function (p) { return !p.unsubscribed && !sent[key][p.email]; }); }
var api = {
  get: async function (u) {
    window.calls.push(['GET', u]);
    if (u === '/api/admin/booth-photos') return { rows: [
      { key: 'acme', company: 'Acme AI', booth: 'B12', email: 'spoc@acme.test', count: 7, thumbs: [], sent_at: '2026-11-23 16:00:00', sent_count: 1, team_sent: Object.keys(sentLink.acme).length - 1, status: 'sent' },
      { key: 'beta', company: 'Beta Labs', booth: '', email: '', count: 3, thumbs: [], sent_at: '', sent_count: 0, team_sent: Object.keys(sentLink.beta).length, status: 'no-email' },
      { key: 'x137', company: 'No Photos Co', booth: '', email: 'n@n.test', count: 0, thumbs: [], sent_at: '', sent_count: 0, team_sent: 0, status: 'no-photos' }], companies: 3, photos: 10 };
    var m = u.match(/booth-photos\\/([^/]+)\\/people$/);
    if (m) return { company: m[1] === 'acme' ? 'Acme AI' : 'Beta Labs', page: 'https://bharataiinnovation.com/photos/x1?k=abc', domains: m[1] === 'acme' ? ['acme.test'] : [], people: (team[m[1]] || []).map(function (p) { return Object.assign({}, p, { sent: !!sentLink[m[1]][p.email], unsubscribed: !!p.unsubscribed }); }) };
    if (u === '/api/admin/whatsapp/photo-status') return null;
    return { rows: [], results: [], groups: [] };
  },
  post: async function (u, b) {
    window.calls.push(['POST', u, JSON.parse(JSON.stringify(b || {}))]);
    var m = u.match(/booth-photos\\/([^/]+)\\/(send-team|send-account)$/);
    if (!m) return {};
    var key = m[1], sent = m[2] === 'send-team' ? sentLink : sentAcct;
    if (key === 'x137') { var e = new Error('No photos of this company yet.'); e.data = { error: e.message }; throw e; }
    var refused = [];
    (b && b.extra || []).forEach(function (x) {
      if (key !== 'acme' || x.email.slice(-10) !== '@acme.test') { refused.push({ email: x.email, why: 'This address is not at the company’s own email domain (acme.test). Add them to the company’s team list first.' }); return; }
      if (!team[key].some(function (q) { return q.email === x.email; })) team[key].push({ email: x.email, name: x.name, why: ['added by the team'], mobile: '' });
    });
    var list = would(key, sent);
    if (b && b.extra) { var done0 = []; list.forEach(function (q) { if ((b.only || []).indexOf(q.email) >= 0) { sent[key][q.email] = true; done0.push(q.email); } }); return { ok: true, sent: done0, failed: [], skipped: [], refused: refused }; }
    if (b && b.dry) return { company: key, count: 7, would: list.map(function (p) { return { email: p.email, name: p.name, why: p.why }; }), skipped: [], subject: 'Your photos are in your account', html: b.html ? '<p>Dear Asha, your photos are in your account.</p>' : undefined };
    var only = b && b.only ? b.only : list.map(function (p) { return p.email; });
    var done = [];
    list.forEach(function (p) { if (only.indexOf(p.email) >= 0) { sent[key][p.email] = true; done.push(p.email); } });
    return { ok: true, sent: done, failed: [], skipped: [] };
  }
};
</script><script>${js.replace(/<\/script>/g, '<\\/script>')}</script><script>
window.ready = AfterDesk.mount(document.getElementById('host'), { api: api, toast: function (t, k) { window.toasts.push([t, k || 'success']); }, startCampaign: async function () {}, authHeaders: function () { return {}; } });
</script></body></html>`;

(async () => {
  const browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      const ctx = await browser.newContext({ viewport: vp });
      const p = await ctx.newPage();
      p.setDefaultTimeout(30000);
      const errors = [];
      p.on('pageerror', (e) => errors.push(e.message));
      // A real address: an email preview (an iframe with srcdoc) cannot open inside about:blank.
      await p.route('http://afd.test/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE }));
      await p.goto('http://afd.test/');
      await p.evaluate(() => window.ready);
      const tag = vp.width + 'px: ';
      check(tag + 'every row has a Team button, and the card has the two send-to-every-team buttons', await p.locator('[data-act="team-booth"]').count() === 3 && await p.locator('[data-act="send-all-team"]').count() === 2, '');

      // ---- Team on a row ----
      await p.locator('[data-act="team-booth"]').first().click();
      await p.waitForSelector('#afd-preview .afd-modal-body table');
      const body = await p.locator('#afd-preview').innerText();
      check(tag + 'Team shows everyone found, how, and which email each has had', /Everyone at Acme AI/.test(body) && /3 people found/.test(body) && /Asha Rao/.test(body) && /booth contact, dashboard account/.test(body)
        && /Ravi Kumar/.test(body) && /team list/.test(body) && /Unsubscribed/.test(body) && /Open their photos page/.test(body), body.slice(0, 300));
      check(tag + 'the buttons count who has not had each: the link 1 (Ravi), the account email 2 (Asha and Ravi), never the unsubscribed',
        /Send the photos link to the 1 person who has not had it/.test(body) && /Send the account email to the 2 people who have not had it/.test(body), body.slice(-300));
      const fits = await p.evaluate(() => { const c = document.querySelector('#afd-preview .afd-modal-card').getBoundingClientRect(), bd = document.querySelector('#afd-preview .afd-modal-body'); return [c.right <= window.innerWidth + 1 && c.left >= -1, bd.scrollWidth <= bd.clientWidth + 1]; });
      check(tag + 'the box fits the screen, and its list does not scroll sideways', fits[0] && fits[1], JSON.stringify(fits));
      check(tag + 'its buttons are big enough to tap', await p.evaluate(() => [...document.querySelectorAll('#afd-preview .afd-team-actions .afd-btn')].every(b => b.getBoundingClientRect().height >= 40)), '');
      if (process.env.SHOTS_DIR) await p.screenshot({ path: path.join(process.env.SHOTS_DIR, 'after-team-' + vp.width + '.png') });
      await p.evaluate(() => { window.calls.length = 0; window.confirms.length = 0; });
      await p.locator('[data-team-send="team"]').click();
      await p.waitForFunction(() => window.toasts.length > 0);
      const c1 = await p.evaluate(() => ({ calls: window.calls, confirms: window.confirms, toasts: window.toasts }));
      const sendCall = c1.calls.find(c => c[0] === 'POST' && /acme\/send-team$/.test(c[1]) && !c[2].dry);
      check(tag + 'sending the link asks first, then goes only to the person shown', /to 1 person at Acme AI/.test(c1.confirms[0] || '') && JSON.stringify(sendCall && sendCall[2]) === '{"only":["ravi@acme.test"]}' && /1 sent/.test(c1.toasts[0][0]), JSON.stringify([c1.confirms, sendCall]));
      await p.waitForSelector('#afd-preview .afd-modal-body table');
      check(tag + 'the box comes back showing nobody left for the link', /Send the photos link to the 0 people who/.test(await p.locator('#afd-preview').innerText()) && await p.locator('[data-team-send="team"]').isDisabled(), '');
      // ---- someone else at this company ----
      const boxWords = await p.locator('#afd-preview').innerText();
      check(tag + 'the box says which email domain a named person must be at', boxWords.includes('Someone else at this company') && boxWords.includes('own email domain (acme.test)'), '');
      await p.evaluate(() => { window.calls.length = 0; window.confirms.length = 0; window.toasts.length = 0; });
      await p.locator('[data-team-name]').fill('A Friend');
      await p.locator('[data-team-email]').fill('friend@elsewhere.test');
      await p.locator('[data-team-add]').click();
      await p.waitForFunction(() => window.toasts.length > 0);
      let ca = await p.evaluate(() => ({ toasts: window.toasts, confirms: window.confirms }));
      check(tag + 'an address at another domain is refused in words, and the box stays open', ca.toasts[0][0].includes('own email domain (acme.test)') && ca.toasts[0][1] === 'error'
        && ca.confirms[0].includes('A Friend, friend@elsewhere.test, at Acme AI') && await p.locator('#afd-preview [data-team-add]').count() === 1, JSON.stringify(ca));
      await p.evaluate(() => { window.calls.length = 0; window.toasts.length = 0; });
      await p.locator('[data-team-name]').fill('Cora Coordinator');
      await p.locator('[data-team-email]').fill('Cora@acme.test');
      await p.locator('[data-team-add]').click();
      await p.waitForFunction(() => window.toasts.length > 0);
      ca = await p.evaluate(() => ({ toasts: window.toasts, calls: window.calls }));
      const addCall = ca.calls.find(c => c[0] === 'POST' && c[2].extra);
      check(tag + 'an address at the company’s own domain is sent the link, only them', ca.toasts[0][0].includes('Sent to cora@acme.test')
        && JSON.stringify(addCall && addCall[2]) === JSON.stringify({ extra: [{ email: 'cora@acme.test', name: 'Cora Coordinator' }], only: ['cora@acme.test'] }), JSON.stringify(addCall));
      await p.waitForSelector('#afd-preview .afd-modal-body table');
      const boxAfter = await p.locator('#afd-preview').innerText();
      check(tag + 'the box comes back with them on the list', boxAfter.includes('Cora Coordinator') && boxAfter.includes('added by the team'), '');
      await p.locator('[data-team-preview]').click();
      await p.waitForSelector('#afd-preview iframe');
      check(tag + '"Look at the account email" shows it before anything is sent', /Your photos are in your account/.test(await p.locator('#afd-preview .afd-modal-head').innerText())
        && (await p.evaluate(() => window.calls)).filter(c => c[0] === 'POST' && /send-account$/.test(c[1]) && !c[2].dry).length === 0, '');
      await p.locator('#afd-preview [data-close]').click();

      // ---- Send to every team ----
      await p.evaluate(() => { window.calls.length = 0; window.confirms.length = 0; window.toasts.length = 0; window.sayYes = false; });
      await p.locator('[data-act="send-all-team"][data-kind="account"]').click();
      await p.waitForFunction(() => window.confirms.length > 0);
      await p.waitForTimeout(200);
      let c2 = await p.evaluate(() => ({ calls: window.calls, confirms: window.confirms }));
      check(tag + 'send to every team counts first: one dry run a company, the one with no photos left out, and says how many',
        c2.calls.filter(c => c[0] === 'POST' && c[2].dry).length === 3 && /to 4 people at 2 companies/.test(c2.confirms[0]) && /Acme AI \(3\), Beta Labs \(1\)/.test(c2.confirms[0]), c2.confirms[0]);
      check(tag + 'saying no sends nothing', c2.calls.filter(c => c[0] === 'POST' && !c[2].dry).length === 0, '');
      await p.evaluate(() => { window.calls.length = 0; window.confirms.length = 0; window.sayYes = true; });
      await p.locator('[data-act="send-all-team"][data-kind="account"]').click();
      await p.waitForFunction(() => window.toasts.length > 0);
      c2 = await p.evaluate(() => ({ calls: window.calls, toasts: window.toasts }));
      const sends = c2.calls.filter(c => c[0] === 'POST' && !c[2].dry);
      check(tag + 'saying yes sends each company its own list, by name, and reports the total', sends.length === 2 && sends.every(c => /send-account$/.test(c[1]) && Array.isArray(c[2].only))
        && JSON.stringify(sends.find(c => /acme/.test(c[1]))[2].only.sort()) === '["cora@acme.test","ravi@acme.test","spoc@acme.test"]' && /4 sent/.test(c2.toasts[0][0]), JSON.stringify(sends));
      await p.evaluate(() => { window.toasts.length = 0; window.confirms.length = 0; });
      await p.locator('[data-act="send-all-team"][data-kind="account"]').click();
      await p.waitForFunction(() => window.toasts.length > 0);
      const c3 = await p.evaluate(() => ({ toasts: window.toasts, confirms: window.confirms }));
      check(tag + 'pressed again: nobody is left, nothing is asked, nothing goes twice', /already had/.test(c3.toasts[0][0]) && c3.confirms.length === 0, JSON.stringify(c3));
      await p.locator('[data-act="send-all-team"][data-kind="team"]').click();
      await p.waitForFunction(() => window.confirms.length > 0);
      const c4 = await p.evaluate(() => window.confirms);
      check(tag + 'the photos link button keeps its own count, in plain words (1 person at 1 company)', /photos link email to 1 person at 1 company,/.test(c4[0]) && /Beta Labs \(1\)/.test(c4[0]), c4[0]);
      check(tag + 'no page error', errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(fails ? fails + ' FAILED' : 'all passed');
  process.exit(fails ? 1 : 0);
})();
