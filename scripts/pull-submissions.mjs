// Brings the logos and photos that Admin -> Submissions has put in the app down to
// this computer, so the website can follow.
//
// The app shows an emailed logo or photo the moment someone presses "Use it". The
// public website is built from files in this repo (the logo wall, the Innovation Talks
// cards, the speaker grids), so it changes only when those files do. This script asks
// the server for every file in use (GET /api/admin/inbox-submissions/export), saves
// each under a folder OUTSIDE the repo, named for who it belongs to, and prints the
// step that puts each one on the site.
//
//   $env:ADMIN_SECRET = "<the admin password>"         (PowerShell; never typed into a file)
//   node scripts/pull-submissions.mjs                       everything in use
//   node scripts/pull-submissions.mjs --since 2026-11-12    used on or after that day
//   node scripts/pull-submissions.mjs --out "C:\somewhere"  another folder
//   node scripts/pull-submissions.mjs --base http://localhost:8865   a test harness
//
// It only reads. Nothing in the repo, the app or the database is changed.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, fallback = '') => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const BASE = opt('base', 'https://bharataiinnovation.com').replace(/\/+$/, '');
const SINCE = opt('since');
const today = new Date().toISOString().slice(0, 10);
const OUT = resolve(opt('out', join(homedir(), 'Downloads', 'bharatai-submissions-' + today)));
const SECRET = process.env.ADMIN_SECRET || '';
const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)));

const fail = (msg) => { console.error(msg); process.exit(1); };
if (!SECRET) fail('Set ADMIN_SECRET to the admin password first (in PowerShell:  $env:ADMIN_SECRET = "..." ).');
if (SINCE && !/^\d{4}-\d{2}-\d{2}/.test(SINCE)) fail('--since takes a day like 2026-11-12.');
// These are other people's pictures and names: never into the repo, which is on GitHub.
if ((OUT + sep).toLowerCase().startsWith((REPO + sep).toLowerCase())) fail('Choose a folder outside the repo: ' + OUT);

// A name a person can read and Windows can keep.
const safeName = (s) => String(s || 'unnamed').replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').replace(/[. ]+$/, '').trim().slice(0, 80) || 'unnamed';
const FOLDER = { logo: 'logos', talk_photo: 'talk-photos', speaker_photo: 'speaker-photos' };
const NEXT = {
  logo: 'Logo wall (home, /exhibition, llms.txt): put the file in the logo source folder under the name its EXHIBITORS entry uses in scripts/gen-exhibitor-logos.mjs, then  node scripts/gen-exhibitor-logos.mjs "<folder>"',
  talk_photo: 'Innovation Talk cards (/exhibition, /conference): set "photo" for that speaker in scripts/data/innovation-talks.json to the file name, then  node scripts/gen-innovation-talks.mjs "<folder>"',
  speaker_photo: 'Confirmed speaker grids (home, /conference): make the 400px square  public/images/speaker-<slug>-sq.webp  and re-run  python scripts/gen-site-photo-fingerprints.py',
};

const res = await fetch(BASE + '/api/admin/inbox-submissions/export' + (SINCE ? '?since=' + encodeURIComponent(SINCE) : ''), { headers: { Authorization: 'Bearer ' + SECRET } });
if (res.status === 401) fail('The admin password was refused.');
const body = await res.json().catch(() => null);
if (!res.ok || !body?.ok) fail('The server answered ' + res.status + ': ' + (body?.error || 'no list'));
const files = body.files || [];
if (!files.length) { console.log('Nothing in use' + (SINCE ? ' since ' + SINCE : '') + '. Use something in Admin -> Submissions first.'); process.exit(0); }

const saved = [];
const taken = new Set();
for (const f of files) {
  const folder = FOLDER[f.what];
  if (!folder) continue;
  // Only this site's own uploads are fetched, whatever the list says.
  const path = String(f.url || '').replace(/^https?:\/\/[^/]+/, '');
  if (!/^\/api\/uploads\/submissions\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(path) || path.includes('..')) { console.warn('skipped (not a submissions file): ' + f.url); continue; }
  const ext = (String(f.filename || path).toLowerCase().match(/\.(png|jpe?g|webp|svg)$/) || ['', 'png'])[1].replace('jpeg', 'jpg');
  let name = safeName(f.target), n = 1;
  while (taken.has((folder + '/' + name + '.' + ext).toLowerCase())) name = safeName(f.target) + ' (' + (++n) + ')';
  taken.add((folder + '/' + name + '.' + ext).toLowerCase());
  const r = await fetch(BASE + path);
  if (!r.ok) { console.warn('could not download (' + r.status + '): ' + path); continue; }
  const dir = join(OUT, folder);
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, name + '.' + ext);
  writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
  saved.push({ ...f, saved_as: dest });
}
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'submissions.json'), JSON.stringify(saved, null, 2));

console.log('\nSaved ' + saved.length + ' file' + (saved.length === 1 ? '' : 's') + ' to ' + OUT + '\n');
for (const what of Object.keys(FOLDER)) {
  const mine = saved.filter((s) => s.what === what);
  if (!mine.length) continue;
  console.log(FOLDER[what] + ' (' + mine.length + ')');
  for (const s of mine) console.log('  ' + s.target + '   <- ' + s.from_email + ', used ' + String(s.at || '').slice(0, 10) + ' by ' + s.by);
  console.log('  Next: ' + NEXT[what] + '\n');
}
console.log('Then: npm run build, look at the page, commit only those paths, push.');
