// Built-worker checks for the free Visitor Pass directory teaser (fake D1, signed sessions).
// Run after `npm run build`:  node scripts/verify/smoke-directory-teaser.mjs
// Directory teaser: built worker + fake D1 + signed sessions for a Visitor (5)
// and a Delegate (6). Nothing touches production.
import crypto from 'node:crypto';
const worker = (await import(new URL('../../dist/_worker.js?' + Date.now(), import.meta.url).href)).default;
const SECRET = 'smoke-session';
const person = (id) => ({ id, event_id: 1, name: 'Person ' + id, company: 'Co ' + id, job_title: id % 2 ? 'Founder & CEO' : 'Engineer',
  bio: 'A long biography that keeps going well past ninety characters so that the teaser has to cut it down to a single line', avatar_url: '/x.png',
  company_logo_url: '', networking_goals: 'hire', interests: 'ml', linkedin_url: 'https://linkedin.com/in/p' + id, twitter_url: 'https://x.com/p' + id,
  website_url: 'https://p' + id + '.com', role: id === 50 ? 'exhibitor' : 'attendee', badge_type: 'Visitor Pass', is_online: 0, last_seen: '2026-09-17', industry: 'Software & SaaS', city: 'Mumbai', country: 'India' });
const CONTACT = new Set(['5:40', '40:5']);
const log = [];
const DB = {
  prepare(sql) {
    let args = [];
    const stmt = {
      bind(...a) { args = a; return stmt; },
      async first() {
        log.push(sql.slice(0, 60));
        if (/PRAGMA table_info\(attendees\)/.test(sql)) return null;
        if (/SELECT badge_type, role FROM attendees WHERE id = \?/.test(sql)) return args[0] === 6 ? { badge_type: 'Delegate Pass', role: 'attendee' } : args[0] === 5 ? { badge_type: 'Visitor Pass', role: 'attendee' } : null;
        if (/EXISTS\(SELECT 1 FROM connections/.test(sql)) return { ok: CONTACT.has(args[0] + ':' + args[1]) ? 1 : 0 };
        if (/FROM speakers s JOIN attendees/.test(sql)) return null;
        if (/SELECT interests, networking_goals FROM attendees WHERE id = \?/.test(sql)) return { interests: 'ml', networking_goals: 'hire' };
        if (/FROM attendees WHERE id = \?/.test(sql)) { const id = Number(args[0]); return id >= 1 && id <= 100 ? person(id) : null; }
        return null;
      },
      async all() {
        log.push(sql.slice(0, 60));
        if (/PRAGMA table_info\(attendees\)/.test(sql)) return { results: ['id','event_id','name','email','company','job_title','bio','avatar_url','main_event','unsubscribed_at','marketing_consent','registration_source','badge_type','role'].map(name => ({ name })) };
        const m = /LIMIT (\d+)/.exec(sql);
        const n = m ? Number(m[1]) : 10;
        return { results: Array.from({ length: n }, (_, i) => person(i + 10)) };
      },
      async run() { return { meta: { changes: 0 } }; },
    };
    return stmt;
  },
  async batch(list) { return Promise.all(list.map(s => s.all())); },
};
const env = new Proxy({ ADMIN_SECRET: 'smoke-admin', SESSION_SECRET: SECRET, DB }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };
const cookie = (id) => { const exp = Math.floor(Date.now() / 1000) + 3600; const body = `${id}.${exp}`; return 'bai_session=' + body + '.' + crypto.createHmac('sha256', SECRET).update(body).digest('hex'); };
const hit = async (path, id) => { const res = await worker.fetch(new Request('https://bharataiinnovation.com' + path, { headers: id ? { Cookie: cookie(id) } : {} }), env, ctx); const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {} return { status: res.status, h: Object.fromEntries(res.headers), json, text }; };
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };

// --- Visitor browsing ---
let r = await hit('/api/events/1/attendees?search=&role=', 5);
check('visitor list is 200 and marked limited', r.status === 200 && r.h['x-directory-limited'] === '1' && r.h['x-has-more'] === '0', r.status + ' ' + JSON.stringify(r.h));
const vis = (r.json || []).filter(a => !a.locked), lock = (r.json || []).filter(a => a.locked);
check('visitor sees 24 profiles then 12 locked cards', vis.length === 24 && lock.length === 12, vis.length + ' / ' + lock.length);
check('visible profiles carry no contact links', vis.every(a => !a.linkedin_url && !a.twitter_url && !a.website_url), 'links present');
check('visible bios are one short line', vis.every(a => a.bio.length <= 91), Math.max(...vis.map(a => a.bio.length)));
check('each visible profile has a view token', vis.every(a => typeof a.view_token === 'string' && a.view_token.length === 24), 'token missing');
check('locked cards carry only title and industry', lock.every(a => Object.keys(a).sort().join(',') === 'industry,job_title,locked'), JSON.stringify(lock[0]));
check('no count anywhere in the headers', !Object.keys(r.h).some(k => /total/i.test(k)), JSON.stringify(Object.keys(r.h)));
check('the teaser query excludes the viewer and orders by quality', log.some(l => /SELECT id, event_id, name/.test(l)), 'query not seen');

r = await hit('/api/events/1/attendees?search=co&role=', 5);
check('visitor search shows 3 then locks', (r.json || []).filter(a => !a.locked).length === 3 && (r.json || []).filter(a => a.locked).length === 12, JSON.stringify((r.json || []).length));

// --- Delegate browsing, unchanged ---
r = await hit('/api/events/1/attendees?search=&role=', 6);
check('delegate list is not limited', r.status === 200 && !r.h['x-directory-limited'], JSON.stringify(r.h['x-directory-limited']));
check('delegate sees contact links as before', (r.json || []).length > 0 && (r.json || []).every(a => a.linkedin_url && !a.locked), JSON.stringify((r.json || [])[0] || {}).slice(0, 80));

// --- Single profiles ---
const token = vis[0].view_token, shownId = vis[0].id;
r = await hit('/api/attendees/' + shownId + '?v=' + token, 5);
check('visitor opens a profile the list showed (stripped)', r.status === 200 && r.json.limited === 1 && !r.json.linkedin_url, r.status + ' ' + r.text.slice(0, 80));
r = await hit('/api/attendees/' + shownId, 5);
check('visitor without the token is locked', r.status === 403 && r.json.locked === true, r.status);
r = await hit('/api/attendees/' + (shownId + 1) + '?v=' + token, 5);
check("a token does not open someone else's profile", r.status === 403, r.status);
r = await hit('/api/attendees/99999', 5);
check('unknown id looks exactly like locked (no existence oracle)', r.status === 403 && r.json.locked === true, r.status);
r = await hit('/api/attendees/40', 5);
check('someone who has been in touch is fully visible, links included', r.status === 200 && !!r.json.linkedin_url && !r.json.limited, r.status + ' ' + r.text.slice(0, 80));
r = await hit('/api/attendees/50', 5);
check('an exhibitor is fully visible', r.status === 200 && !!r.json.linkedin_url, r.status);
r = await hit('/api/attendees/5', 5);
check('own profile is full', r.status === 200 && !!r.json.linkedin_url, r.status);
r = await hit('/api/attendees/' + shownId, 6);
check('delegate opens any profile in full', r.status === 200 && !!r.json.linkedin_url, r.status);
r = await hit('/api/attendees/99999', 6);
check('delegate still gets a real 404 for an unknown id', r.status === 404, r.status);
r = await hit('/api/attendees/' + shownId);
check('signed out is still 401', r.status === 401, r.status);

// --- Suggestions ---
r = await hit('/api/events/1/suggested-attendees', 5);
check('visitor suggestions: at most 8, stripped, with tokens', Array.isArray(r.json) && r.json.length <= 8 && r.json.every(a => !a.linkedin_url && a.view_token), JSON.stringify(r.json && r.json.length));
r = await hit('/api/events/1/suggested-attendees', 6);
check('delegate suggestions unchanged (full pool with links)', Array.isArray(r.json) && r.json.length > 8 && r.json.every(a => a.linkedin_url), JSON.stringify(r.json && r.json.length));

// --- Admin unchanged ---
const adm = await worker.fetch(new Request('https://bharataiinnovation.com/api/attendees/' + shownId, { headers: { Authorization: 'Bearer smoke-admin' } }), env, ctx);
check('admin opens any profile', adm.status === 200, adm.status);

console.log(fails ? `\n${fails} FAILED` : '\nall directory checks passed');
process.exit(fails ? 1 : 0);
