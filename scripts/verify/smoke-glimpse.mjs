// Built-worker checks for the public "how it works" section on /networking
// (2 Nov 2026), run against real SQLite (sql.js) loaded with the production schema,
// so the ranking and the exclusions are tested as SQL, not pattern-matched.
// A named card (name, photo, title, company) only for someone who downloaded their
// "I'm attending" social card; everyone else is a locked card (title, industry,
// city, goals) and nothing that names, pictures or locates them. Never an id.
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
for (const id of [1, 3, 4]) db.run('INSERT INTO events (id, title, start_date, end_date) VALUES (?, ?, ?, ?)', [id, 'Event ' + id, '2026-11-20', '2026-11-21']);
let nextId = 1;
const ids = {};
const person = (event_id, name, extra = {}) => {
  const id = nextId++;
  ids[name] = id;
  const row = { id, event_id, name, email: 'p' + id + '@example.com', mobile: '98200' + String(id).padStart(5, '0'), company: 'Company' + id,
    job_title: 'Director', industry: 'Software & SaaS', city: 'Pune', avatar_url: '/api/uploads/avatars/' + id + '-1.jpg',
    badge_type: 'Visitor Pass', payment_status: 'paid', main_event: 1, role: 'attendee', ...extra };
  const cols = Object.keys(row);
  db.run(`INSERT INTO attendees (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, clean(cols.map(k => row[k])));
};
const SHARED = '2026-10-30 10:00:00';

// Event 1. Shared their social card (named):
person(1, 'Ratan Kesh', { job_title: 'Executive Director & COO at Bandhan Bank', company: 'Bandhan Bank', industry: 'Banking & Financial Services', city: 'kolkata', networking_goals: 'buying,partner', badge_type: 'Delegate Pass', social_card_downloaded_at: SHARED });
person(1, 'meera iyer', { job_title: 'Head of AI', company: 'BOSCH INDIA', industry: 'Manufacturing', city: 'Bengaluru', social_card_downloaded_at: SHARED });
person(1, 'Junior Analyst', { job_title: 'Data Analyst', company: 'Smallco', social_card_downloaded_at: SHARED });
person(1, 'Self Person', { job_title: 'Founder', company: 'Self', social_card_downloaded_at: SHARED });
person(1, 'Inline Photo', { job_title: 'Chief Data Officer', avatar_url: 'data:image/png;base64,AAAA', social_card_downloaded_at: SHARED });
person(1, 'Flagged Photo', { job_title: 'Chief Risk Officer', photo_flagged_at: '2026-10-29 10:00:00', social_card_downloaded_at: SHARED });
person(1, 'Asked Off', { job_title: 'Chief Executive Officer', company: 'Hiddenco', social_card_downloaded_at: SHARED });
person(1, 'Panel Sharer', { job_title: 'Chief Strategy Officer', main_event: 0, social_card_downloaded_at: SHARED });
person(1, 'Unsub Sharer', { job_title: 'Chief Growth Officer', unsubscribed_at: '2026-10-01 10:00:00', social_card_downloaded_at: SHARED });
// 14 Nov 2026 (organiser): the public showcase names people from companies only.
person(1, 'Dean Sharer', { job_title: 'Dean', company: 'Sri Sri University', industry: 'Education & Academia', social_card_downloaded_at: SHARED });
person(1, 'Prof Sharer', { job_title: 'Professor of AI', company: 'Acme Labs', social_card_downloaded_at: SHARED });
person(1, 'IIT Sharer', { job_title: 'Head of Research', company: 'IIT Bombay', social_card_downloaded_at: SHARED });
person(1, 'Student Sharer', { job_title: 'Analyst', company: 'Somewhere', badge_type: 'Student Pass', social_card_downloaded_at: SHARED });
person(1, 'Principal Sharer', { job_title: 'Principal Engineer', company: 'Corporate Co', social_card_downloaded_at: SHARED });
// Did not share their card (locked at most):
person(1, 'Vikram Secret', { job_title: 'CTO at Nokia Networks', company: 'Nokia', industry: 'Telecom', city: 'Bengaluru', networking_goals: 'hiring' });
person(1, 'Neha Secret', { job_title: 'Director - Data Science, HDFC Bank', company: 'HDFC Bank', industry: 'Banking & Financial Services', city: 'Mumbai 400001' });
person(1, 'Karan Secret', { job_title: 'VP Engineering @ Infosys', company: 'Infosys', industry: 'Other', city: 'Mysuru' });
person(1, 'Sam Student', { job_title: 'Student' });
person(1, 'Team Member', { job_title: 'Director of Operations', role: 'organiser' });
person(1, 'Hon Minister', { job_title: 'Chief Minister of a State' });
person(1, 'Phone Person', { job_title: 'Director 9820012345' });
person(1, 'Junior Dev', { job_title: 'Software Engineer' });
db.run("INSERT INTO app_settings (key, value) VALUES ('glimpse_hide', ?)", [' ' + ids['Asked Off'] + ', 999 ']);
// Event 4: too few for a section. (Event 2 is Delhi 2027, which every public route refuses.)
person(4, 'Lone One', { job_title: 'Founder' });
person(4, 'Lone Two', { job_title: 'Director', city: 'Agra' });
// Event 3: plenty, three of the sharers without a senior title.
for (let i = 0; i < 15; i++) person(3, 'Big Sharer ' + i, { job_title: 'Director ' + String.fromCharCode(65 + i), social_card_downloaded_at: SHARED });
for (let i = 0; i < 3; i++) person(3, 'Plain Sharer ' + i, { job_title: 'Associate ' + i, social_card_downloaded_at: SHARED });
for (let i = 0; i < 10; i++) person(3, 'Big Quiet ' + i, { job_title: 'Head ' + String.fromCharCode(65 + i), city: 'City' + 'abcdefghij'[i] });

// ---- event 1 ----
let r = await hit('/api/events/1/glimpse');
const people = r.json?.people || [], locked = r.json?.locked || [];
const named = Object.fromEntries(people.map(p => [p.name, p]));
check('answers 200 with no sign-in', r.status === 200 && Array.isArray(r.json?.people) && Array.isArray(r.json?.locked), r.status + ' ' + r.text.slice(0, 160));
check('a named card carries name, photo, title, company, industry, city and goals only', people.length > 0 && people.every(p => Object.keys(p).sort().join(',') === 'city,company,goals,industry,name,photo,title'), JSON.stringify(people[0]));
check('corporate only: a dean, a professor, an IIT and a Student Pass who shared are not named', !/Dean Sharer|Prof Sharer|IIT Sharer|Student Sharer/.test(people.map(p => p.name).join(' | ')), people.map(p => p.name).join(' | '));
check('and a Principal Engineer at a company is', people.some(p => p.name === 'Principal Sharer'), people.map(p => p.name).join(' | '));
check('a locked card carries title, industry, city and goals only', locked.length > 0 && locked.every(p => Object.keys(p).sort().join(',') === 'city,goals,industry,title'), JSON.stringify(locked[0]));
check('no id and no count in the answer or its headers', !/"id"|total|count/i.test(r.text) && !Object.keys(r.h).some(k => /count|total/i.test(k)), r.text.slice(0, 120));
check('kept by a browser for ten minutes', /public/.test(r.h['cache-control'] || '') && /max-age=600/.test(r.h['cache-control'] || ''), r.h['cache-control']);
check('people who shared their card are named, top titles first', people[0]?.name === 'Ratan Kesh' && !!named['Meera Iyer'], people.map(p => p.name).join(' | '));
check('a sharer without a senior title is still shown, after the seniors', people.findIndex(p => p.name === 'Junior Analyst') > people.findIndex(p => p.name === 'Meera Iyer'), people.map(p => p.name).join(' | '));
check('the title loses the company, the company stands on its own', named['Ratan Kesh']?.title === 'Executive Director & COO' && named['Ratan Kesh']?.company === 'Bandhan Bank', JSON.stringify(named['Ratan Kesh']));
check('a name or company typed in one case is written normally', !!named['Meera Iyer'] && named['Meera Iyer'].company === 'Bosch India', JSON.stringify(named['Meera Iyer']));
check('"Self" is not shown as a company', named['Self Person']?.company === '', JSON.stringify(named['Self Person']));
check('a named photo is one stored here', people.every(p => p.photo.startsWith('/api/uploads/')), people.map(p => p.photo).join(' '));
const shownNames = people.map(p => p.name).join(' | ');
check('an inline photo, a flagged photo and an id in glimpse_hide are never named', !/Inline Photo|Flagged Photo|Asked Off/.test(shownNames), shownNames);
check('a sharer asked off is not a locked card either', !locked.some(p => /chief executive officer/i.test(p.title)) && !r.text.includes('Hiddenco'), JSON.stringify(locked));
check('panel-only and unsubscribed sharers are left out', !/Panel Sharer|Unsub Sharer/.test(shownNames) && !locked.some(p => /strategy|growth/i.test(p.title)), shownNames);
const secrets = ['Vikram', 'Neha', 'Karan', 'Nokia', 'HDFC', 'Infosys', '@example.com', 'Secret'];
check('nobody who did not share their card is named, pictured or given a company', !secrets.some(w => r.text.includes(w)), secrets.filter(w => r.text.includes(w)).join(', '));
const lockedTitles = locked.map(p => p.title).join(' | ');
check('locked cards are senior titles with the company cut off', /(^| \| )CTO( \| |$)/.test(lockedTitles) && lockedTitles.includes('Director - Data Science') && lockedTitles.includes('VP Engineering'), lockedTitles);
check('a named person is not also a locked card', !locked.some(p => /executive director|head of ai/i.test(p.title)), lockedTitles);
check('students, juniors, the team, a minister and a phone number are not locked cards', !/student|software engineer|operations|minister|98200/i.test(lockedTitles), lockedTitles);
check('a city with a PIN code and an "Other" industry are left blank', locked.find(p => p.title === 'Director - Data Science')?.city === '' && locked.find(p => p.title === 'VP Engineering')?.industry === '', JSON.stringify(locked));
check('goals read in plain words, buyers first', JSON.stringify(named['Ratan Kesh']?.goals) === '["Buying","Finding partners"]', JSON.stringify(named['Ratan Kesh']?.goals));

// ---- event 2: too few ----
r = await hit('/api/events/4/glimpse');
check('fewer than four cards in all answers empty lists (the page hides the section)', r.status === 200 && r.json?.people?.length === 0 && r.json?.locked?.length === 0, r.text);

// ---- event 3: plenty ----
r = await hit('/api/events/3/glimpse');
const bigP = r.json?.people || [], bigL = r.json?.locked || [];
check('never more than twelve named and six locked', bigP.length === 12 && bigL.length === 6, bigP.length + ' / ' + bigL.length);
check('seniors who shared come before sharers without a senior title', !bigP.some(p => /Plain Sharer/.test(p.name)), bigP.map(p => p.name).join(' | '));
check('the locked cards are people who did not share', bigL.every(p => /^Head /.test(p.title)), bigL.map(p => p.title).join(' | '));

// ---- the page ----
// The page and, since 14 Nov 2026, its showcase script and style, shared with /register.
const page = ['../../public/networking.html', '../../public/js/nw-glimpse.js', '../../public/css/nw-glimpse.css'].map((f) => readFileSync(new URL(f, import.meta.url), 'utf8')).join(String.fromCharCode(10));
check('the page asks this route for its cards', page.includes("fetch('/api/events/1/glimpse'"), 'fetch missing');
check('the page draws only people with a photo: no locked cards (14 Nov 2026)', page.includes('var locked = [];') && page.includes('if (people.length < 4) { section.hidden = true; return; }'), 'locked drawn');
check('the page writes names and titles as text, never as HTML', /el\('span', 'nw-pc-name', p\.name\)/.test(page) && /el\('span', 'nw-lc-title', p\.title\)/.test(page) && !/innerHTML\s*=\s*[^;]*p\.(name|title|company|city|industry)/.test(page), 'innerHTML with card text');
check('the phone plays the app\'s own screens: list, Requested, Schedule Meeting, chat, Tell your network', ['Networking Hub', 'Requested', 'Schedule Meeting', 'Send Meeting Request', 'Type a message', 'Tell your network', 'Share to LinkedIn or WhatsApp'].every(s => page.includes(s)), 'phone screen markers');
check('the card in the share step is drawn by the app\'s renderer', page.includes("'/js/social-card.js?v=") && page.includes('window.BhaiSocialCard') && /R\.render\(\{ name: p\.name/.test(page), 'renderer');
check('a band of real "I\'m attending" cards, drawn once each and shared with the phone', page.includes('id="nw-cards"') && page.includes('fillCards(people)') && /function cardFor\(p\)/.test(page) && page.includes('gold edition'), 'cards band');
check('in person: lunch with the passes that include it, the VIP lounge and the CXO evening as VIP only, the schedule\'s time, no price', page.includes('id="cxo-night"') &&
  page.includes('Networking lunch comes with the Delegate, Premium Delegate and VIP passes') && page.includes('No other pass includes it') && page.includes('href="/register#vip"') && !/VIP lunch/i.test(page) &&
  page.includes('6:30 pm to 8:00 pm') && !page.includes('8:30 pm') && !/id="cxo-night"[\s\S]*?&#8377;[\s\S]*?BHARAT AI CONNECT, THE NETWORKING APP/.test(page), 'cxo night block');
check('five steps, online and at the venue', (page.match(/data-step="[1-5]"/g) || []).length >= 5 && page.includes('At WTC Mumbai') && page.includes('Share your card on LinkedIn'), 'steps');
check('the headline reads as the organiser wrote it', /Business meetings before you arrive at Bharat AI Innovation, <span class="nw-accent">not chance encounters<\/span>/.test(page), 'headline');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
