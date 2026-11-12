// Unit: the organising team (12 Nov 2026), each rule on its own. src/lib/team.ts is
// compiled in memory with esbuild and called directly against a bare SQLite
// (sql.js) holding only the two tables it reads; public/js/pass-render.js is loaded
// as the browser loads it and its tiers are read without drawing.
//   - the team is everyone holding the Organiser pass for the event, by name, once;
//   - an owner is a name: cleaned, kept with the team member's email, cleared by '';
//   - the same name again is not a change; a row the code did not write is ignored;
//   - the Organiser pass is black and saffron; Student and Influencer print as themselves.
// Run:  node scripts/verify/unit-organiser-team.mjs
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const entry = fileURLToPath(new URL('../../src/lib/team.ts', import.meta.url));
const out = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent' });
const T = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + (typeof d === 'string' ? d : JSON.stringify(d)))); if (!ok) fails++; };

// ---- a database with just what the module reads ----
const SQL = await require('sql.js')();
const db = new SQL.Database();
db.exec(`CREATE TABLE attendees (id INTEGER PRIMARY KEY, event_id INTEGER, name TEXT, email TEXT, badge_type TEXT);
         CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);`);
const rows = (sql, args = []) => { const st = db.prepare(sql); st.bind(args); const o = []; while (st.step()) o.push(st.getAsObject()); st.free(); return o; };
const D1 = { prepare(sql) { let a = []; const s = { bind(...x) { a = x; return s; }, async first() { return rows(sql, a)[0] || null; }, async all() { return { results: rows(sql, a) }; }, async run() { db.run(sql, a); return { meta: {} }; } }; return s; } };

// ---- names ----
check('a name is cleaned: one space between words, ends trimmed', T.cleanOwnerName('  Aswin \t  Kumar \n') === 'Aswin Kumar');
check('a name is cut at 80 characters, the width assigned_to has always had', T.cleanOwnerName('x'.repeat(120)).length === 80);
check('nothing, null and spaces are no name', T.cleanOwnerName(null) === '' && T.cleanOwnerName(undefined) === '' && T.cleanOwnerName('   ') === '');
check('only speakers and sessions keep their owner here', T.isOwnerKind('speaker') && T.isOwnerKind('session') && !T.isOwnerKind('exhibitor') && !T.isOwnerKind('') && !T.isOwnerKind('owner:session'));

// ---- the team ----
db.run("INSERT INTO attendees VALUES (1, 1, 'Ujwala Jangam', 'Ujwala@Team.Example.Test', 'Organiser')");
db.run("INSERT INTO attendees VALUES (2, 1, '  Aswin   Kumar ', 'aswin@team.example.test', 'Organiser')");
db.run("INSERT INTO attendees VALUES (3, 1, 'ujwala jangam', 'second@team.example.test', 'Organiser')");
db.run("INSERT INTO attendees VALUES (4, 1, 'Puja Deka', 'puja@team.example.test', 'Visitor Pass')");
db.run("INSERT INTO attendees VALUES (5, 2, 'Delhi Organiser', 'delhi@team.example.test', 'Organiser')");
db.run("INSERT INTO attendees VALUES (6, 1, 'Organiser Lookalike', 'x@team.example.test', 'Organiser Pass')");
db.run("INSERT INTO attendees VALUES (7, 1, '', 'blank@team.example.test', 'Organiser')");
const team = await T.organiserTeam(D1);
check('the team is the Organiser pass holders of the event, sorted by name', JSON.stringify(team.map(m => m.name)) === JSON.stringify(['Aswin Kumar', 'Ujwala Jangam']), team);
check('a Visitor, another event’s Organiser, a look-alike badge and a blank name are not on it', !team.some(m => /Puja|Delhi|Lookalike/.test(m.name)) && team.every(m => m.name));
check('the same name twice is listed once, the first row kept', team.filter(m => /ujwala/i.test(m.name)).length === 1 && team.find(m => /ujwala/i.test(m.name)).id === 1);
check('each carries their email, lower case', team.find(m => m.id === 1).email === 'ujwala@team.example.test');
check('another event has its own team', JSON.stringify((await T.organiserTeam(D1, 2)).map(m => m.name)) === '["Delhi Organiser"]');
check('a database that cannot answer gives no team, not an error', JSON.stringify(await T.organiserTeam({ prepare() { throw new Error('no such table'); } })) === '[]');
check('a team member is found by name, whatever the case and spacing', T.teamMemberNamed(team, ' aswin  KUMAR ')?.id === 2 && T.teamMemberNamed(team, 'Aswin') === null && T.teamMemberNamed(team, '') === null);

// ---- owners ----
let r = await T.setOwner(D1, 'speaker', 10, ' ujwala   JANGAM ', team);
check('giving a speaker to a team member stores their name as the team writes it, and their email', r.changed && r.before === null && r.after.name === 'Ujwala Jangam' && r.after.email === 'ujwala@team.example.test', r);
check('...as one settings row, owner:speaker:<id>', rows("SELECT key FROM app_settings").map(x => x.key).join() === 'owner:speaker:10');
r = await T.setOwner(D1, 'speaker', 10, 'Ujwala Jangam', team);
check('the same owner again is not a change (nothing for the audit log)', r.changed === false && r.after.name === 'Ujwala Jangam');
r = await T.setOwner(D1, 'speaker', 10, 'Aswin Kumar', team);
check('a new owner replaces the old, and says who it was', r.changed && r.before.name === 'Ujwala Jangam' && r.after.name === 'Aswin Kumar' && rows("SELECT COUNT(*) AS n FROM app_settings")[0].n === 1);
r = await T.setOwner(D1, 'session', 10, 'A Volunteer', team);
check('a name not on the team is kept as typed, with no email', r.changed && r.after.name === 'A Volunteer' && r.after.email === '');
check('a speaker and a session with the same number are different owners', (await T.ownerOf(D1, 'speaker', 10)).name === 'Aswin Kumar' && (await T.ownerOf(D1, 'session', 10)).name === 'A Volunteer');
await T.setOwner(D1, 'session', 11, 'Ujwala Jangam', team);
const sessions = await T.ownersOf(D1, 'session');
check('every owner of a kind in one read', sessions.size === 2 && sessions.get(10).name === 'A Volunteer' && sessions.get(11).name === 'Ujwala Jangam' && !sessions.has(12));
check('...and only that kind', (await T.ownersOf(D1, 'speaker')).size === 1);
db.run("INSERT INTO app_settings (key, value) VALUES ('owner:session:12', 'not json'), ('owner:session:abc', '{\"name\":\"X\"}'), ('owner:session:13', '{\"name\":\"   \"}'), ('owner_session_14', '{\"name\":\"Y\"}')");
const again = await T.ownersOf(D1, 'session');
check('rows it did not write are skipped: bad JSON, a bad number, a blank name, a lookalike key', again.size === 2 && !again.has(12) && !again.has(13), [...again.keys()]);
r = await T.setOwner(D1, 'session', 11, '   ', team);
check('an empty name gives it to nobody and removes the row', r.changed && r.after === null && (await T.ownerOf(D1, 'session', 11)) === null);
r = await T.setOwner(D1, 'session', 99, '', team);
check('nobody to nobody is not a change', r.changed === false && r.before === null);
await T.clearOwner(D1, 'speaker', 10);
check('a deleted speaker leaves no owner row', (await T.ownerOf(D1, 'speaker', 10)) === null && (await T.ownerOf(D1, 'session', 10)).name === 'A Volunteer');
check('the owner with a quote, an ampersand and angle brackets survives as text', (await T.setOwner(D1, 'speaker', 20, 'O’Neil & <Co> "x"', team)).after.name === 'O’Neil & <Co> "x"' && (await T.ownerOf(D1, 'speaker', 20)).name === 'O’Neil & <Co> "x"');

// ---- the passes ----
const sandbox = { window: {}, document: {}, Image: function () {}, console };
sandbox.window = sandbox;
vm.runInNewContext(readFileSync(fileURLToPath(new URL('../../public/js/pass-render.js', import.meta.url)), 'utf8'), sandbox);
const P = sandbox.BhaiPass;
const tier = (badge, role) => P.TIERS[P.tierFor({ badge_type: badge, role: role || 'attendee' })];
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const org = tier('Organiser');
check('an Organiser prints ORGANISER, with आयोजक under it', org.label === 'ORGANISER' && org.hi === 'आयोजक');
check('the Organiser band is black, edged in saffron', org.ink === true && lum(org.c1) < 0.03 && lum(org.c2) < 0.01 && org.edge.toUpperCase() === '#FF7A00', org);
check('no other pass is dark: the Organiser cannot be taken for one', Object.keys(P.TIERS).filter(k => k !== 'organiser').every(k => P.TIERS[k].gold || lum(P.TIERS[k].c1) > 0.05), Object.keys(P.TIERS).map(k => k + ':' + lum(P.TIERS[k].c1).toFixed(3)));
check('white words on the black band read easily (over 7:1)', contrast('#FFFFFF', org.c1) > 7 && contrast('#FFB066', org.c2) > 7);
check('it used to be indigo, close to Visitor and Academic: no longer', org.c1 !== '#5C6BC0');
check('a Student Pass prints STUDENT PASS, not VISITOR PASS', tier('Student Pass').label === 'STUDENT PASS');
check('...in raspberry, nothing like the Premium Delegate teal', tier('Student Pass').c1 === '#AD1457' && tier('Premium Delegate Pass').c1 === '#0B7A75' && contrast('#FFFFFF', '#AD1457') > 4.5);
check('an Influencer Pass prints INFLUENCER PASS, not MEDIA PASS', tier('Influencer Pass').label === 'INFLUENCER PASS' && tier('Media Pass').label === 'MEDIA PASS');
const before = { 'Visitor Pass': 'VISITOR PASS', 'Delegate Pass': 'DELEGATE PASS', 'Premium Delegate Pass': 'PREMIUM DELEGATE', 'VIP Pass': 'V I P', 'VIP Guest': 'V I P', 'Academic Pass': 'ACADEMIC PASS', 'Exhibitor': 'EXHIBITOR PASS', 'Speaker': 'SPEAKER PASS', 'Jury': 'JURY', 'Support Staff': 'SUPPORT STAFF', 'Investor': 'INVESTOR PASS', 'Startup Pitcher': 'STARTUP PASS', '': 'VISITOR PASS' };
const moved = Object.keys(before).filter(b => tier(b).label !== before[b]);
check('every other pass prints as it did', !moved.length, moved);
check('a speaker by role still prints SPEAKER PASS on a Visitor badge', tier('Visitor Pass', 'Speaker').label === 'SPEAKER PASS');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
