// UNIT level for the redesigned /register and /inquiry (6 Nov 2026): each rule on its own, on the pages
// exactly as the built worker serves them, with no database and no browser. /inquiry's facts are read
// against /exhibition, which prints the same packages by hand. The other levels:
//   smoke-booking-pages.mjs       integration: the pages' own scripts, the real routes, real SQLite
//   system-booking-journey.cjs    system: a buyer and an exhibitor, from another page to the organiser's screen
//   browser-booking-redesign.cjs  end to end: phones and a laptop in a real browser
// Run after `npm run build`:  node scripts/verify/unit-booking-pages.mjs
import vm from 'node:vm';
import { existsSync, readFileSync } from 'node:fs';

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const same = (n, got, want) => check(n, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

const worker = (await import(new URL('../../dist/_worker.js?' + Date.now(), import.meta.url).href)).default;
const DB = { prepare: () => { const q = { bind: () => q, first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: {} }) }; return q; } };
const env = new Proxy({ ADMIN_SECRET: 'u', SESSION_SECRET: 'u', DB }, { get: (t, k) => (k in t ? t[k] : undefined) });
const page = async (p) => (await worker.fetch(new Request('https://bharataiinnovation.com' + p), env, { waitUntil() {}, passThroughOnException() {} })).text();

// Anything dated pins its own clock. The day after the price rise, unless a test says otherwise.
const RealDate = Date;
const at = (iso) => { const t = RealDate.parse(iso); globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [t])); } static now() { return t; } }; };
at('2026-11-07T10:00:00+05:30');
const register = await page('/register');
const inquiry = await page('/inquiry');
const passes = await page('/passes');
globalThis.Date = RealDate;

const noScripts = (h) => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '');
const bodyOf = (h) => noScripts(h.slice(h.indexOf('<body')));
const lift = (text, name) => {
  const start = text.indexOf('function ' + name + '(');
  if (start < 0) throw new Error(name + ' is not on the page');
  let i = text.indexOf('{', start), depth = 0;
  for (; i < text.length; i++) { if (text[i] === '{') depth++; else if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1); }
  throw new Error(name + ' never closes');
};

// ======== /inquiry: one list of packages, and it agrees with /exhibition ========
const booths = JSON.parse((inquiry.match(/var BOOTH_PRICES = (\{.*?\});\s*\n/) || [])[1] || '{}');
const keys = Object.keys(booths);
check('seven packages reach the script', keys.length === 7, keys.join(' | '));
const body = bodyOf(inquiry);
same('the cards, in that order', [...body.matchAll(/class="booth-pkg bk-pkg" data-booth="([^"]+)"/g)].map((m) => m[1]), keys);
same('the drawings in the hero, in that order', [...body.matchAll(/class="bk-foot" data-booth="([^"]+)"/g)].map((m) => m[1]), keys);
same('the list in the form, in that order, and Not sure last', [...body.matchAll(/<select id="iq-booth-type"[\s\S]*?<\/select>/g)][0][0].match(/value="[^"]*"/g).map((v) => v.slice(7, -1)), ['', ...keys, 'Undecided']);
for (const k of keys) {
  check('each card presses its own package: ' + k, inquiry.includes(`onclick="selectBooth(this, '${k}')"`), 'no onclick');
  const m = k.match(/^(.+) - ([\d.]+)x([\d.]+)m - Rs\.([\d,]+)$/);
  const b = booths[k];
  check('the stored key keeps its spelling and says what the row says: ' + k, m && Number(m[4].replace(/,/g, '')) === b.price && Number(m[2]) === b.w && Number(m[3]) === b.d, JSON.stringify(b));
  check('the area is width times depth: ' + k, Math.abs(b.w * b.d - parseFloat(b.sqm)) < 0.011, b.w + ' x ' + b.d + ' ' + b.sqm);
}
// /exhibition's own cards
const exhibition = read('public/exhibition.html');
const cards = [...exhibition.matchAll(/<div class="package-name">([^<]+)<\/div>\s*<div class="package-size">([^<]+)<\/div>\s*<div class="package-price"[^>]*>([\s\S]*?)<\/div>\s*<ul class="package-features">([\s\S]*?)<\/ul>/g)];
same('/exhibition sells the same seven, in the same order', cards.map((c) => c[1]), keys.map((k) => k.split(' - ')[0]));
cards.forEach((c, i) => {
  const b = booths[keys[i]];
  const name = c[1];
  check(name + ': the same size as /exhibition', c[2].replace(/ × /, ' x ').startsWith(b.size + ' (' + b.sqm), c[2] + ' / ' + b.size + ' ' + b.sqm);
  const price = Number(c[3].replace(/<s[\s\S]*?<\/s>/, '').match(/₹([\d,]+)/)[1].replace(/,/g, ''));
  check(name + ': the same price as /exhibition', price === b.price, price + ' / ' + b.price);
  const passesThere = (c[4].match(/(\d+) exhibitor pass/) || [])[1];
  check(name + ': the same number of exhibitor passes as /exhibition', passesThere === b.passes.match(/\d+/)[0], passesThere + ' / ' + b.passes);
  const talkThere = (c[4].match(/Innovation Talk &amp; Showcase \((\d+) min\)/) || [])[1];
  check(name + ': the same length of talk as /exhibition', Number(talkThere) === b.talk, talkThere + ' / ' + b.talk);
});
check('the Startup Pod is struck through as the organiser chose, and the list in the form stays plain', /&#x20B9;38,000<\/s> &#x20B9;48,000/.test(body) && !/<select id="iq-booth-type"[\s\S]*?38,000[\s\S]*?<\/select>/.test(body));
const zonesHere = [...body.match(/<select id="iq-zone"[\s\S]*?<\/select>/)[0].matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
check('eight zones in the form', zonesHere.length === 8, zonesHere.join());
for (const z of zonesHere) check('the zone is one /exhibition names: ' + z, exhibition.includes(z.replace('&', '&amp;')) || exhibition.includes(z), z);
for (const s of ['10,000+', '200+', '50+', 'Countries', 'Expected Visitors', '2 exhibitor badges', 'Main Hall', 'Innovation Hub', 'Startup Alley', 'Enterprise Zone', 'Wi-Fi', 'BHAI 2026', 'MeitY']) {
  check('gone from /inquiry: ' + s, !body.includes(s), s);
}
check('the hole in the old form has gone: no empty box in the grid', !/<div>\s*<\/div>/.test(body), 'empty div');

// The drawings: the numbers on the screen are the numbers in the row.
for (const k of keys) {
  const b = booths[k];
  check('the drawing on the card is the size on the card: ' + k, body.includes(`<span class="bk-plan" aria-hidden="true"><i style="--w:${b.w};--d:${b.d};"></i></span>`), JSON.stringify(b));
}

// ---- the small functions ----
{
  const { iqLink } = vm.runInNewContext(`${lift(inquiry, 'iqLink')}; ({ iqLink })`);
  for (const [typed, want] of [['', ''], ['   ', ''], ['www.example.com', 'https://www.example.com'], ['example.com', 'https://example.com'], ['https://example.com', 'https://example.com'], ['http://example.com', 'http://example.com'], ['HTTPS://EXAMPLE.COM', 'HTTPS://EXAMPLE.COM'], ['  example.com  ', 'https://example.com']]) {
    same('a website typed as "' + typed + '"', iqLink(typed), want);
  }
}
{
  // markBooth and updatePriceSummary with a stand-in page.
  const cls = () => { const s = new Set(['hidden']); return { add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c), toggle: (c, on) => (on ? s.add(c) : s.delete(c)) }; };
  const el = (attrs = {}) => ({ value: '', textContent: '', classList: cls(), style: { props: {}, setProperty(k, v) { this.props[k] = v; } }, attrs, getAttribute(k) { return this.attrs[k]; }, setAttribute(k, v) { this.attrs[k] = v; } });
  const els = {}; const get = (id) => (els[id] = els[id] || el());
  const cardsEl = keys.map((k) => el({ 'data-booth': k })), feet = keys.map((k) => el({ 'data-booth': k }));
  const sb = { document: { getElementById: get, querySelectorAll: (s) => (s === '.booth-pkg' ? cardsEl : feet) } };
  vm.runInNewContext(`var BOOTH_PRICES = ${JSON.stringify(booths)}; ${lift(inquiry, 'markBooth')} ${lift(inquiry, 'updatePriceSummary')} this.u = updatePriceSummary;`, sb);
  get('iq-booth-type').value = keys[3];
  sb.u();
  check('a size chosen: its card is pressed and no other', cardsEl.map((c) => c.attrs['aria-pressed']).join() === 'false,false,false,true,false,false,false' && cardsEl[3].classList.contains('is-on') && !cardsEl[0].classList.contains('is-on'));
  check('its drawing in the hero is lit and no other', feet[3].classList.contains('is-on') && feet.filter((f) => f.classList.contains('is-on')).length === 1);
  check('the summary shows it, with the price + GST and what it gets', !get('iq-price-summary').classList.contains('hidden') && get('iq-summary-type').textContent === 'Accelerator Booth (3 x 3 m)' && /^₹2,91,000 \+ GST$/.test(get('iq-summary-price').textContent) && get('iq-summary-more').textContent === '9 sqm · 5 exhibitor passes · 20-minute talk on stage', get('iq-summary-price').textContent + ' / ' + get('iq-summary-more').textContent);
  check('and its drawing at its size', get('iq-summary-plan').style.props['--w'] === 3 && get('iq-summary-plan').style.props['--d'] === 3, JSON.stringify(get('iq-summary-plan').style.props));
  get('iq-booth-type').value = 'Undecided';
  sb.u();
  check('Not sure yet: no price, nothing pressed, nothing lit', get('iq-price-summary').classList.contains('hidden') && cardsEl.every((c) => c.attrs['aria-pressed'] === 'false') && feet.every((f) => !f.classList.contains('is-on')));
}

// ======== /register ========
const regBody = bodyOf(register);
for (const [hash, pass, was, is] of [['delegate', 'Delegate Pass', '4,999', '8,999'], ['premium', 'Premium Delegate Pass', '9,999', '14,999'], ['vip', 'VIP Pass', '19,999', '24,999'], ['academic', 'Academic Pass', '999', '3,999']]) {
  const row = (regBody.match(new RegExp(`<a class="rg-tier[^"]*"[^>]*href="#${hash}"[^>]*>[\\s\\S]*?</a>`)) || [''])[0];
  check(pass + ': a row beside the form that opens the paid form on it', row.includes(`onclick="return upgradeFromSuccess('${pass}')"`), row.slice(0, 120));
  check(pass + ': the old price struck through and the new one, + GST', row.includes(`&#8377;${was}</s> &#8377;${is} <small>+ GST</small>`), row.slice(-300));
  check(pass + ': one card in the paid form, at the same price', new RegExp(`value="${pass}" onchange="[^"]*rppApplyPassFields\\(this.value\\)">\\s*<div data-rpp-card>[\\s\\S]*?&#8377;${was.replace(',', ',')}</s> &#8377;${is} <small>\\+ GST</small>`).test(regBody), pass);
}
check('the switch has two real radio buttons, free chosen', /id="rg-view-free" autocomplete="off" checked/.test(regBody) && /id="rg-view-paid" autocomplete="off">/.test(regBody));
check('the free form says entry by slot in the organiser\'s softer words, once', (regBody.match(/entry by time slot on 20 and 21 Nov, as available, confirmed by email/g) || []).length === 1);
check('the chart still says the whole sentence on entry', regBody.includes('Entry on a free Visitor Pass is not guaranteed: it depends on slot availability on 20 and 21 Nov, a half-day slot or none.'));
{
  const cls = () => { const s = new Set(); return { toggle: (c, on) => (on ? s.add(c) : s.delete(c)), contains: (c) => s.has(c) }; };
  const els = {}; const get = (id) => (els[id] = els[id] || { value: 'kept', style: {}, classList: cls(), textContent: '', required: true, placeholder: '' });
  const sb = { document: { getElementById: get } };
  vm.runInNewContext(`${lift(register, 'rppApplyPassFields')}; this.f = rppApplyPassFields;`, sb);
  sb.f('Academic Pass');
  check('Academic: a college name, no designation, and City takes the whole row', get('rpp-company-label').textContent === 'College name' && get('rpp-designation').required === false && get('rpp-designation').value === '' && get('rpp-designation-field').style.display === 'none' && get('rpp-row-designation').classList.contains('rg-one'));
  sb.f('Delegate Pass');
  check('back on Delegate: organisation and designation again, two boxes in the row', get('rpp-company-label').textContent === 'Organization' && get('rpp-designation').required === true && get('rpp-designation-field').style.display === '' && !get('rpp-row-designation').classList.contains('rg-one'));
}
{
  at('2026-11-05T23:59:00+05:30');
  const before = bodyOf(await page('/register'));
  globalThis.Date = RealDate;
  check('23:59 on 5 Nov the page still reads as it did: the standard price, nothing struck, the date it rises', before.includes('STANDARD PRICES UNTIL 5 NOV') && !before.includes('</s> &#8377;8,999') && before.includes('&#8377;4,999 <small>+ GST</small>') && /Prices rise on 6 Nov/.test(before), 'wording');
}

// ======== both pages ========
for (const [name, html] of [['/register', register], ['/inquiry', inquiry]]) {
  const b = bodyOf(html);
  const ids = [...b.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  check(name + ': every id once', dup.length === 0, dup.join());
  const labels = [...b.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map((m) => m[1]);
  check(name + ': every label has its box', labels.length > 5 && labels.every((f) => ids.includes(f)), labels.filter((f) => !ids.includes(f)).join());
  const fields = [...b.matchAll(/<(?:input|select|textarea)\b[^>]*\sid="([^"]+)"/g)].map((m) => m[1]).filter((id) => !/^rg-view|^rpp-pass-type$/.test(id));
  check(name + ': every box has a label', fields.every((f) => labels.includes(f)), fields.filter((f) => !labels.includes(f)).join());
  const folded = [...b.matchAll(/<details[\s\S]*?<\/details>/g)].map((m) => m[0]).join('');
  check(name + ': nothing required, and no box the browser would refuse, in a folded part', folded.length > 100 && !/\srequired\b/.test(folded) && !/type="(url|email)"/.test(folded), 'folded');
  check(name + ': no box the browser refuses with a bubble for a plain website', !/type="url"/.test(b), 'type=url');
  check(name + ': the site\'s own menu', (b.match(/<nav class="ps-nav"[\s\S]*?<\/nav>/) || [''])[0].split('<a ').length - 1 === 14);
  check(name + ': the credit the free Skiper UI licence asks for, in the open', /Motion effects from <a [^>]*skiper-ui\.com[^>]*>Skiper UI<\/a> and <a [^>]*VengeanceUI[^>]*>Vengeance UI<\/a>, and small details after <a [^>]*uiverse\.io[^>]*>Uiverse<\/a>\./.test(b), 'credit');
  for (const f of ['css/passes-design.css', 'css/booking-design.css', 'css/passes-motion.css', 'css/booking-motion.css', 'js/passes-motion.js', 'js/booking-motion.js']) {
    check(name + ': names ' + f + ' and it is on disk', html.includes('/' + f + '?v=') && existsSync(new URL('../../public/' + f, import.meta.url)), f);
  }
  check(name + ': never the word RSVP, and no count of people', !/rsvp/i.test(b) && !/\b\d[\d,]* (seats left|seats taken|registered|attendees|delegates|exhibitors)\b/i.test(b), 'count');
}
same('/register sits under Passes in the menu', (regBody.match(/<a href="([^"]+)" aria-current="page"/) || [])[1], '/passes');
same('/inquiry sits under Exhibition in the menu', (body.match(/<a href="([^"]+)" aria-current="page"/) || [])[1], '/exhibition');
same('/passes reads the same menu', (bodyOf(passes).match(/<nav class="ps-nav"[\s\S]*?<\/nav>/) || [''])[0], (regBody.match(/<nav class="ps-nav"[\s\S]*?<\/nav>/) || [''])[0]);

// ======== the movement ========
const design = read('public/css/booking-design.css');
const motion = read('public/css/booking-motion.css');
const script = read('public/js/booking-motion.js');
{
  const start = motion.indexOf('@media (prefers-reduced-motion: no-preference)');
  let i = motion.indexOf('{', start), depth = 0;
  for (; i < motion.length; i++) { if (motion[i] === '{') depth++; else if (motion[i] === '}' && --depth === 0) break; }
  const inside = motion.slice(start, i), outside = motion.slice(0, start) + motion.slice(i);
  check('every animation and transition is only for people with animations on', start > 0 && /animation:/.test(inside) && !/\banimation:/.test(outside.replace(/\/\*[\s\S]*?\*\//g, '')) && !/transition:(?!\s*opacity)/.test(outside.replace(/\/\*[\s\S]*?\*\//g, '')), 'outside the block');
  check('and only cheap things move, apart from the small tints', !/@keyframes[^{]*\{[^}]*(width|height|top|left|margin)\s*:/.test(motion), 'keyframes');
}
check('the script stops at once with animations off', script.indexOf("prefers-reduced-motion: no-preference") > 0 && /if \(!matchMedia\('\(prefers-reduced-motion: no-preference\)'\)\.matches\) return;/.test(script));
check('the design file does not need the movement file', !/rg-off|ps-turn|rg-shine/.test(design));
check('the movement file carries the MIT notice and says where each effect is from', motion.includes('Permission is hereby granted, free of charge') && motion.includes('Copyright (c) 2025-2026 Ashutoshx7') && motion.includes('Uiverse.io') && motion.includes('skiper-ui.com'));
check('no gradient text and no coloured side-stripe', !/background-clip:\s*text/.test(design + motion) && !/border-left:\s*[2-9]px/.test(design + motion));
check('a hidden thing stays hidden: nothing here gives a toggled box a display of its own', /\.bk-sum:not\(\.hidden\)/.test(design) && !/^\.bk-sum \{/m.test(design) && !/#reg-form\s*\{[^}]*display/.test(design));
check('the tick on a filled box needs no script, and neither does the switch', /:user-valid/.test(design) && /:has\(#rg-view-paid:checked\)/.test(design));

console.log(fails ? `\n${fails} FAILED` : '\nall unit checks passed');
process.exit(fails ? 1 : 0);
