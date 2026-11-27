// The home-page hero test on aiagentssummit.org (27 Nov 2026): A ("Arena") against C ("Signal").
// On the built worker with real SQLite and the production schema:
//  - before migration 0069 a count is quietly dropped and the results name the migration;
//  - a count is one of hero a or c and one of six steps, from the summit's own site only;
//    anything else adds nothing; counts fall on the IST day;
//  - the results need an admin, and apply the rule fixed in advance: at least 14 days, then
//    2,000 visitors a hero or 8 January 2027; a winner only at p < 0.05, otherwise keep A;
//  - the page picks the hero before it paints, has both heroes, and counts from site.js.
// Run after `npm run build`:  node scripts/verify/smoke-hero-test.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');

const RealDate = Date;
let fakeNow = null;
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0 && fakeNow !== null) super(fakeNow); else super(...a); }
  static now() { return fakeNow !== null ? fakeNow : RealDate.now(); }
}
globalThis.Date = FakeDate;
const at = (iso) => { fakeNow = RealDate.parse(iso); };

const worker = (await import(new URL('../../dist/_worker.js?' + RealDate.now(), import.meta.url).href)).default;
const SQL = await initSqlJs();
const db = new SQL.Database();
db.exec(readFileSync(new URL('./prod-schema.sql', import.meta.url), 'utf8'));
const clean = (a) => a.map(v => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
const rows = (sql, args = []) => { const st = db.prepare(sql); st.bind(args); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; };
const D1 = {
  prepare(sql) {
    let args = [];
    const s = {
      sql,
      bind(...a) { args = clean(a); return s; },
      async first() { return rows(sql, args)[0] || null; },
      async all() { return { results: rows(sql, args) }; },
      async run() { db.run(sql, args); return { meta: { changes: db.getRowsModified() } }; },
    };
    return s;
  },
  async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; },
};
const ADMIN = 'smoke-admin';
const env = new Proxy({ ADMIN_SECRET: ADMIN, SESSION_SECRET: 'smoke-session', DB: D1 }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };

const SITE = 'https://aiagentssummit.org';
const call = async (method, path, { body, headers = {} } = {}) => {
  const r = await worker.fetch(new Request(SITE + path, { method, headers, body }), env, ctx);
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, text, json, type: r.headers.get('content-type') || '' };
};
const count = (v, e, origin = SITE) => call('POST', '/api/summit/hero-test', { body: JSON.stringify({ v, e }), headers: origin ? { origin, 'content-type': 'text/plain;charset=UTF-8' } : { 'content-type': 'text/plain;charset=UTF-8' } });
const results = (q = '') => call('GET', '/api/admin/summit-hero-test' + q, { headers: { authorization: 'Bearer ' + ADMIN } });
const total = (v, s) => rows('SELECT COALESCE(SUM(n), 0) AS n FROM summit_hero_test WHERE variant = ? AND step = ?', [v, s])[0].n;

// ---- before migration 0069 ----
at('2026-11-27T06:00:00Z');
let r = await count('a', 'seen');
check('before 0069 a count is not kept and says so (503), so the browser tries again later', r.status === 503, r.status + ' ' + r.text);
r = await results();
check('before 0069 the results say ready: false and name the migration', r.status === 200 && r.json?.ready === false && /0069_summit_hero_test/.test(r.json?.migration || ''), r.text);

const MIG = readFileSync(new URL('../../migrations/0069_summit_hero_test.sql', import.meta.url), 'utf8');
db.exec(MIG); db.exec(MIG);
check('migration 0069 runs twice without error', true);

// ---- counting ----
r = await count('a', 'seen');
check('a count from aiagentssummit.org is kept', r.status === 204 && total('a', 'seen') === 1, JSON.stringify(rows('SELECT * FROM summit_hero_test')));
await count('a', 'seen');
check('the same step again adds one (the browser, not the server, counts a visitor once)', total('a', 'seen') === 2);
await count('c', 'cta', 'https://www.aiagentssummit.org');
check('www.aiagentssummit.org counts too', total('c', 'cta') === 1);
await count('c', 'applied', '');
check('a request without an Origin header counts (some browsers send none)', total('c', 'applied') === 1);
const before = rows('SELECT COALESCE(SUM(n), 0) AS n FROM summit_hero_test')[0].n;
const refused = [
  (await count('b', 'seen')).status, (await count('a', 'bought')).status,
  (await count('a', 'seen', 'https://example.com')).status, (await count('a', 'seen', 'https://bharataiinnovation.com')).status,
  (await call('POST', '/api/summit/hero-test', { body: '{not json', headers: { origin: SITE } })).status,
  (await call('POST', '/api/summit/hero-test', { body: JSON.stringify({ v: 'a', e: 'seen', pad: 'x'.repeat(300) }), headers: { origin: SITE } })).status,
];
check('another hero, another step, another site, bad JSON or a long body add nothing, and none answers 204', rows('SELECT COALESCE(SUM(n), 0) AS n FROM summit_hero_test')[0].n === before && refused.join() === '400,400,403,403,400,400', refused.join());
at('2026-11-27T20:00:00Z'); // 01:30 on 28 November in Mumbai
await count('a', 'pass');
check('a count falls on the IST day', rows("SELECT n FROM summit_hero_test WHERE day = '2026-11-28' AND variant = 'a' AND step = 'pass'")[0]?.n === 1, JSON.stringify(rows('SELECT * FROM summit_hero_test')));
check('no person, email or IP is stored: the table is day, hero, step and a number', rows('PRAGMA table_info(summit_hero_test)').map(c => c.name).join(',') === 'day,variant,step,n');

// ---- results and the rule ----
r = await call('GET', '/api/admin/summit-hero-test');
check('the results need an admin', r.status !== 200 && !r.json?.totals, r.status + ' ' + r.text.slice(0, 120));
db.exec('DELETE FROM summit_hero_test');
const put = (day, v, s, n) => db.run('INSERT INTO summit_hero_test (day, variant, step, n) VALUES (?, ?, ?, ?)', [day, v, s, n]);
put('2026-11-27', 'a', 'seen', 2000); put('2026-11-27', 'a', 'cta', 200); put('2026-11-27', 'a', 'apply', 120); put('2026-11-27', 'a', 'pass', 80); put('2026-11-27', 'a', 'applied', 9); put('2026-11-27', 'a', 'registered', 31);
put('2026-11-28', 'c', 'seen', 2000); put('2026-11-28', 'c', 'cta', 260); put('2026-11-28', 'c', 'apply', 150); put('2026-11-28', 'c', 'pass', 110);

at('2026-12-01T06:00:00Z');
r = await results();
check('on day 5 the test is still running, however big the gap', r.json?.ready === true && r.json.days === 5 && r.json.due === false && r.json.winner === null && /Still running, day 5/.test(r.json.verdict), r.text.slice(0, 400));
check('the totals add up by hero and step', r.json?.totals?.a?.seen === 2000 && r.json.totals.c.cta === 260 && r.json.totals.a.registered === 31 && r.json.totals.c.applied === 0, JSON.stringify(r.json?.totals));
check('the main measure is clicks to apply or a pass over visitors', Math.abs(r.json.rate_a - 0.10) < 1e-9 && Math.abs(r.json.rate_c - 0.13) < 1e-9, r.json.rate_a + ' ' + r.json.rate_c);

at('2026-12-15T06:00:00Z');
r = await results();
// pooled p = 0.115, se = 0.010088, z = 2.974, two-sided p = 0.0029
check('after 14 days with 2,000 a hero, a 10% against 13% gap is a win for C (p about 0.003)', r.json.due === true && r.json.winner === 'c' && Math.abs(r.json.z - 2.974) < 0.01 && Math.abs(r.json.p - 0.0029) < 0.0004 && /^C \(Signal\) wins/.test(r.json.verdict), JSON.stringify({ z: r.json.z, p: r.json.p, v: r.json.verdict }));
check('the 95% range of the gap is given and excludes zero', r.json.range95[0] > 0 && r.json.range95[1] > r.json.range95[0] && Math.abs((r.json.range95[0] + r.json.range95[1]) / 2 - 0.03) < 1e-9, JSON.stringify(r.json.range95));

db.exec('DELETE FROM summit_hero_test');
put('2026-11-27', 'a', 'seen', 400); put('2026-11-27', 'a', 'cta', 40); put('2026-11-27', 'c', 'seen', 410); put('2026-11-27', 'c', 'cta', 44);
at('2026-12-20T06:00:00Z');
r = await results();
check('after 14 days but short of 2,000 a hero and before 8 January, still running', r.json.due === false && /Still running/.test(r.json.verdict), r.json.verdict);
at('2027-01-08T06:00:00Z');
r = await results();
check('on 8 January 2027 it is decided, and a small gap keeps A', r.json.due === true && r.json.winner === null && /No clear difference/.test(r.json.verdict) && /Keep A/.test(r.json.verdict), r.json.verdict);
r = await results('?view=page');
check('the results page is readable HTML with the counts, the verdict, the rule and the preview links', r.status === 200 && /text\/html/.test(r.type) && /Home-page hero test/.test(r.text) && /Keep A/.test(r.text) && /2,000 visitors/.test(r.text) && /\?hero=c/.test(r.text) && !/—/.test(r.text), r.text.slice(0, 200));

// ---- the page ----
const page = readFileSync(new URL('../../public/ai-agent-summit/index.html', import.meta.url), 'utf8');
const head = page.slice(0, page.indexOf('</head>'));
const body = page.slice(page.indexOf('</head>'));
check('the hero is picked in <head>, before anything paints, half each, kept in the browser', /aas_hero/.test(head) && /Math\.random\(\) < 0\.5/.test(head) && /setAttribute\('data-hero', v\)/.test(head));
check('a preview link (?hero=a or c) shows that hero and takes the browser out of the count', /hero=\(\[ac\]\)/.test(head) && /aas_hero_off/.test(head));
check('the page has both heroes, each with its own heading', /class="hero-signal" aria-labelledby="hero-h-c"/.test(body) && /class="hero-arena" aria-labelledby="hero-h"/.test(body) && (body.match(/id="hero-h"/g) || []).length === 1 && (body.match(/id="hero-h-c"/g) || []).length === 1);
check('C lists kinds of agent as examples, finance first, and "And hundreds more"', /aria-label="Examples of agents that can apply"/.test(body) && /<span>Loan agents<\/span><span>Claims agents<\/span>/.test(body) && /And hundreds more/.test(body));
const css = readFileSync(new URL('../../public/ai-agent-summit/assets/site.css', import.meta.url), 'utf8');
check('without the head script (or with hero A) only A shows; with C only C', /\.hero-signal \{ display: none; \}/.test(css) && /html\[data-hero="c"\] \.hero-arena \{ display: none; \}/.test(css) && /html\[data-hero="c"\] \.hero-signal \{ display: flex; \}/.test(css));
const js = readFileSync(new URL('../../public/ai-agent-summit/assets/site.js', import.meta.url), 'utf8');
check('site.js counts once per visitor and step, skips previews and automated browsers', /aas_hero_off/.test(js) && /navigator\.webdriver/.test(js) && /'aas_hero_' \+ step/.test(js) && /\/api\/summit\/hero-test/.test(js));
check('a visit is marked counted only on 204, and later steps count only for counted visits', /r\.status === 204/.test(js) && /if \(!localStorage\.getItem\('aas_hero_seen'\)\) return;/.test(js));
check('a finished form counts: a showcase application or a pass, not a repeat', /heroDone\(out\);/.test(js) && /out\.already/.test(js) && /AAS27-A\\d\+\$/.test(js));
for (const f of ['index.html', 'showcase.html', 'attend.html']) {
  const s = readFileSync(new URL('../../public/ai-agent-summit/' + f, import.meta.url), 'utf8');
  check(f + ' loads the new CSS and JS (v=20261127c), so returning browsers do not keep the old', /site\.css\?v=20261127c/.test(s) && /site\.js\?v=20261127c/.test(s));
}

console.log(fails ? `\n${fails} hero test check(s) failed` : '\nall hero test checks passed');
process.exit(fails ? 1 : 0);
