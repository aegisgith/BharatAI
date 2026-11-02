// Built-worker checks for the public glimpse of the directory on /networking
// (2 Nov 2026), run against real SQLite (sql.js) loaded with the production schema,
// so the ranking and the exclusions are tested as SQL, not pattern-matched.
// A card may carry a cleaned job title, the industry, the city and goals, and
// nothing that names, pictures or locates a person: no name, company, photo, id.
// Run after `npm run build`:  node scripts/verify/smoke-glimpse.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');
const worker = (await import(new URL('../../dist/_worker.js?' + Date.now(), import.meta.url).href)).default;

const SQL = await initSqlJs();
const db = new SQL.Database();
db.exec(readFileSync(new URL('./prod-schema.sql', import.meta.url), 'utf8'));
const clean = (a) => a.map(v => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
const rows = (sql, args) => { const st = db.prepare(sql); st.bind(args); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; };
const D1 = {
  prepare(sql) {
    let args = [];
    const s = {
      bind(...a) { args = clean(a); return s; },
      async first() { return rows(sql, args)[0] || null; },
      async all() { return { results: rows(sql, args) }; },
      async run() { db.run(sql, args); return { meta: { changes: db.getRowsModified() } }; },
    };
    return s;
  },
  async batch(list) { return Promise.all(list.map(s => s.all())); },
};
const env = new Proxy({ ADMIN_SECRET: 'smoke-admin', SESSION_SECRET: 'smoke-session', DB: D1 }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };
const hit = async (path) => {
  const res = await worker.fetch(new Request('https://bharataiinnovation.com' + path), env, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, h: Object.fromEntries(res.headers), text, json };
};
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };

// ---- seed ----
for (const id of [1, 2, 3]) db.run('INSERT INTO events (id, title, start_date, end_date) VALUES (?, ?, ?, ?)', [id, 'Event ' + id, '2026-11-20', '2026-11-21']);
let nextId = 1;
const person = (event_id, name, extra = {}) => {
  const id = nextId++;
  const row = { id, event_id, name, email: 'p' + id + '@example.com', mobile: '98200' + String(id).padStart(5, '0'), company: 'Company' + id,
    job_title: 'Director', industry: 'Software & SaaS', city: 'Pune', avatar_url: '/api/uploads/avatars/' + id + '-1.jpg',
    badge_type: 'Visitor Pass', payment_status: 'paid', main_event: 1, role: 'attendee', ...extra };
  const cols = Object.keys(row);
  db.run(`INSERT INTO attendees (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, clean(cols.map(k => row[k])));
};

// Event 1: one of each case.
person(1, 'Asha Rao', { job_title: 'Chief Technology Officer', company: 'Acme Bank', industry: 'Banking & Financial Services', city: 'navi mumbai', networking_goals: 'hiring,buying,learning', badge_type: 'Delegate Pass' });
person(1, 'Vikram Nokia', { job_title: 'CTO at Nokia Networks', company: 'Nokia', industry: 'Telecom', city: 'Bengaluru' });
person(1, 'Meera Bosch', { job_title: 'Head of AI, Bosch India', company: 'Bosch Limited', industry: 'Manufacturing', city: 'Chennai' });
person(1, 'Ravi Acme', { job_title: 'founder & ceo | acme ai', company: 'Acme AI Labs', industry: 'Software & SaaS', city: 'Hyderabad' });
person(1, 'Neha Hdfc', { job_title: 'Director - Data Science, HDFC Bank', company: 'HDFC Bank', industry: 'Banking & Financial Services', city: 'Mumbai 400001' });
person(1, 'Karan Infy', { job_title: 'VP Engineering @ Infosys', company: 'Infosys', industry: 'Weird Industry', city: 'Mysuru' });
person(1, 'Anil Caps', { job_title: 'MANAGING DIRECTOR', company: 'Caps Pvt Ltd', industry: 'Insurance', city: 'Delhi' });
person(1, 'Long Title', { job_title: 'Senior Vice President and Global Head of Artificial Intelligence Research and Strategy', company: 'Longco', industry: 'IT Services & Consulting', city: 'Noida' });
person(1, 'No Photo', { job_title: 'Head of Sales', avatar_url: null, company: 'Nophoto', industry: 'Retail & E-commerce', city: 'Surat' });
// Left out:
person(1, 'Sam Student', { job_title: 'Student' });
person(1, 'Founder Student', { job_title: 'Founder, student at IIT' });
person(1, 'Panel Only', { job_title: 'Chief Data Officer', main_event: 0 });
person(1, 'Unsub Bed', { job_title: 'Chief Risk Officer', unsubscribed_at: '2026-10-01 10:00:00' });
person(1, 'No Marketing', { job_title: 'Chief Marketing Officer', marketing_consent: 0 });
person(1, 'Team Member', { job_title: 'Director of Operations', role: 'organiser' });
person(1, 'Desk Staff', { job_title: 'Head of Desk', role: 'staff' });
person(1, 'Hon Minister', { job_title: 'Chief Minister of a State' });
person(1, 'Link Person', { job_title: 'CEO www.linkco.com' });
person(1, 'Phone Person', { job_title: 'Director 9820012345' });
person(1, 'Twin One', { job_title: 'Founder', company: 'TwinA', industry: 'Telecom', city: 'Goa' });
person(1, 'Twin Two', { job_title: 'founder', company: 'TwinB', industry: 'Telecom', city: 'goa' });
person(1, 'Junior Dev', { job_title: 'Software Engineer' });
// Event 2: too few senior people to show a section.
person(2, 'Lone One', { job_title: 'Founder' });
person(2, 'Lone Two', { job_title: 'Director', city: 'Agra' });
// Event 3: more than enough, three without a photo.
for (let i = 0; i < 18; i++) person(3, 'Big ' + i, { job_title: 'Director ' + String.fromCharCode(65 + i), city: 'City' + 'abcdefghijklmnopqr'[i] });
for (let i = 0; i < 3; i++) person(3, 'Faceless ' + i, { job_title: 'Head Faceless ' + i, avatar_url: '' });

// ---- event 1 ----
let r = await hit('/api/events/1/glimpse');
const people = r.json?.people || [];
const byTitle = Object.fromEntries(people.map(p => [p.title, p]));
check('answers 200 with no sign-in', r.status === 200 && Array.isArray(r.json?.people), r.status + ' ' + r.text.slice(0, 160));
check('a card carries only title, industry, city and goals', people.length > 0 && people.every(p => Object.keys(p).sort().join(',') === 'city,goals,industry,title'), JSON.stringify(people[0]));
const leaks = ['Asha', 'Rao', 'Nokia', 'Bosch', 'Acme', 'HDFC', 'Infosys', 'Caps', 'Longco', 'Nophoto', '@example.com', '/api/uploads', 'avatar', 'Company', 'Twin'];
check('no name, company, email or photo anywhere in the answer', !leaks.some(w => r.text.includes(w)), leaks.filter(w => r.text.includes(w)).join(', '));
check('no id and no count in the answer or its headers', !/"id"|total|count/i.test(r.text) && !Object.keys(r.h).some(k => /count|total/i.test(k)), r.text.slice(0, 120) + ' ' + Object.keys(r.h).join(','));
check('kept by a browser for ten minutes', /public/.test(r.h['cache-control'] || '') && /max-age=600/.test(r.h['cache-control'] || ''), r.h['cache-control']);
check('a plain senior title is shown as typed', !!byTitle['Chief Technology Officer'], Object.keys(byTitle).join(' | '));
check('"CTO at Nokia Networks" loses the company', !!byTitle['CTO'], Object.keys(byTitle).join(' | '));
check('"Head of AI, Bosch India" loses the company', !!byTitle['Head of AI'], Object.keys(byTitle).join(' | '));
check('"founder & ceo | acme ai" loses the company and reads Founder & CEO', !!byTitle['Founder & CEO'], Object.keys(byTitle).join(' | '));
check('"Director - Data Science, HDFC Bank" loses the bank', !!byTitle['Director - Data Science'], Object.keys(byTitle).join(' | '));
check('"VP Engineering @ Infosys" loses the company', !!byTitle['VP Engineering'], Object.keys(byTitle).join(' | '));
check('a title in capitals is written normally', !!byTitle['Managing Director'], Object.keys(byTitle).join(' | '));
const long = people.find(p => p.title.startsWith('Senior Vice President'));
check('a long title is cut at a word with an ellipsis', !!long && long.title.length <= 57 && long.title.endsWith('…'), long && long.title);
check('a hand-typed city is tidied ("navi mumbai")', byTitle['Chief Technology Officer']?.city === 'Navi Mumbai', byTitle['Chief Technology Officer']?.city);
check('a city with a PIN code is left out', byTitle['Director - Data Science']?.city === '', JSON.stringify(byTitle['Director - Data Science']));
check('an industry outside the list is left out', byTitle['VP Engineering']?.industry === '', JSON.stringify(byTitle['VP Engineering']));
check('goals read in plain words, two at most, buyers first', JSON.stringify(byTitle['Chief Technology Officer']?.goals) === '["Buying","Hiring"]', JSON.stringify(byTitle['Chief Technology Officer']?.goals));
const shown = people.map(p => p.title.toLowerCase()).join(' | ');
check('students are left out', !/student/.test(shown), shown);
check('panel-only, unsubscribed and no-marketing people are left out', !/chief data officer|chief risk officer|chief marketing officer/.test(shown), shown);
check('the team and desk staff are left out', !/director of operations|head of desk/.test(shown), shown);
check('a minister, a link and a phone number are never shown', !/minister|www|linkco|98200/.test(shown), shown);
check('juniors are left out (senior titles only)', !/software engineer/.test(shown), shown);
check('two cards that read the same are shown once', people.filter(p => p.title === 'Founder').length === 1, people.filter(p => p.title === 'Founder').length);
check('people with a photo come before people without', people.findIndex(p => p.title === 'Head of Sales') === people.length - 1, shown);
check('a paid Delegate with a photo leads', people[0]?.title === 'Chief Technology Officer', people[0]?.title);

// ---- event 2: too few ----
r = await hit('/api/events/2/glimpse');
check('fewer than four good cards answers an empty list (the page hides the section)', r.status === 200 && Array.isArray(r.json?.people) && r.json.people.length === 0, r.text);

// ---- event 3: plenty ----
r = await hit('/api/events/3/glimpse');
const big = r.json?.people || [];
check('never more than twelve cards', big.length === 12, big.length);
check('nobody without a photo while people with one are left over', !big.some(p => /faceless/i.test(p.title)), big.map(p => p.title).join(' | '));

// ---- the page ----
const page = readFileSync(new URL('../../public/networking.html', import.meta.url), 'utf8');
check('the page asks this route for its cards', page.includes("fetch('/api/events/1/glimpse'"), 'fetch missing');
check('the page writes card text as text, never as HTML', /el\('span', 'nw-role', p\.title\)/.test(page) && !/innerHTML\s*=\s*[^;]*p\.(title|city|industry)/.test(page), 'innerHTML with card text');
check('the headline reads as the organiser wrote it', /Business meetings before you arrive at Bharat AI Innovation, <span class="nw-accent">not chance encounters<\/span>/.test(page), 'headline');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
