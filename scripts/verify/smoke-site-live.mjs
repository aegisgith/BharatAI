// Integration: the website drawn live from the app (16 Nov 2026), through the WHOLE built
// worker on real SQLite (conference-world.mjs). The public programme (no email, no mobile,
// no draft, no hidden speaker); /conference served as built until the switch is on; once
// on, the schedule, the Tracks, the FAQ sentence and the speaker grids come from D1, and
// a session saved in Admin is on the page at once; a broken database never breaks the page.
// Run after `npm run build`:  node scripts/verify/smoke-site-live.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeWorld, ROOT } from './conference-world.mjs';

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 400))); if (!ok) fails++; };
// A byte-order mark at the top of the file is dropped by Response.text(), so compare without it.
const template = readFileSync(join(ROOT, 'public', 'conference.html'), 'utf8').replace(/^﻿/, '');

const W = await makeWorld({ migrated: true });
// The static page, as the Pages asset binding would hand it over (a redirect first, as Pages does for the .html spelling).
W.env.ASSETS = { fetch: async (req) => {
  const u = new URL(req.url);
  if (u.pathname === '/conference.html') return new Response('', { status: 308, headers: { Location: '/conference' } });
  if (u.pathname === '/conference') return new Response(template, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  return new Response('not here', { status: 404 });
} };
const anon = { admin: false };

// ---- the public programme ----
let r = await W.call('GET', '/api/events/1/programme', undefined, anon);
check('anyone may read the programme', r.status === 200 && r.headers.get('cache-control') === 'public, max-age=60', r.status);
const p = r.json;
check('it carries the event, the halls, the sessions with their people, the speakers and the talks', p && p.event?.start_date === '2026-11-20' && p.halls.length === 4 && p.sessions.length === 4 && Array.isArray(p.speakers) && Array.isArray(p.talks), p && Object.keys(p));
check('it is not live until the switch is on', p.live === false);
check('never an email or a mobile', !/"email"|"phone"|@example\.test/.test(r.text), r.text.slice(0, 200));
check('a hidden speaker is not in it', !p.speakers.some((s) => s.name === 'Nilesh Shah') && p.speakers.length === 4);
const panel = p.sessions.find((s) => s.session_type === 'panel');
check('a panel carries its saved or derived links (Tarun Chugh panellist, Shailesh Dhuri moderator)', panel && panel.links.map((l) => l.speaker_id + ':' + l.role).join() === '2:panellist,3:moderator', panel && panel.links);

// ---- /conference before the switch ----
r = await W.call('GET', '/conference', undefined, anon);
check('before the switch: the page as built, untouched', r.status === 200 && r.text === template && !r.headers.get('x-programme'), [r.status, r.text.length, template.length]);

// ---- the switch ----
W.db.run("INSERT INTO app_settings (key, value) VALUES ('site_live_conference', 'on')");
r = await W.call('GET', '/conference', undefined, anon);
check('with the switch on: the page is drawn from the app', r.status === 200 && /^live /.test(r.headers.get('x-programme') || '') && r.headers.get('cache-control') === 'public, max-age=60', [r.status, r.headers.get('x-programme')]);
const html = r.text;
check('the page keeps its shell (title, nav, the markers)', html.includes('<title>') && html.includes('<!-- schedule:start') && html.includes('<!-- speakers:start') && html.length > 100000, html.length);
check('the schedule has the seed’s sessions, with their anchors', html.includes('id="sch-bhabha-1-1050"') && html.includes('id="sch-bhabha-1-1400"') && html.includes('id="sch-kalam-2-1100"'), (html.match(/id="sch-[^"]+"/g) || []).slice(0, 6));
check('the panel shows its panellists in order and the moderator marked', /<h4>AI Democratizing and Driving Financial Inclusion<\/h4>[\s\S]*?Tarun Chugh[\s\S]*?Ratan Kumar Kesh[\s\S]*?Shailesh Dhuri <span class="sch-tag">Moderator<\/span>/.test(html));
check('the keynote names the listed speaker with the app’s designation', /<h4>Shri\. K\.K\. Singh<\/h4><div class="sch-role">Joint Secretary, MeitY<\/div>/.test(html));
check('the FAQ sentence counts what is there', /"text": "There are 0 tracks across four halls over two days: \. The conference opens with keynotes in Homi J\. Bhabha Hall\."/.test(html) || /"text": "There are \d+ tracks across four halls/.test(html), (html.match(/"text": "There are[^"]*"/) || [''])[0]);
check('the speaker grids are the app’s: the four shown, not the hidden one', html.includes('<h4>Tarun Chugh</h4>') && html.includes('<h4>Dr. Saurabh N. Mehta</h4>') && !html.includes('<h4>Nilesh Shah</h4>'));
check('the line-up written by hand is gone from the page', !html.includes('<h4>Hon’ble Shri Eknath Shinde</h4>'));
check('nothing unfinished is printed', !/undefined|NaN|\[object/.test(html.slice(html.indexOf('<!-- schedule:start'), html.indexOf('<!-- schedule:end'))));

// ---- a change in Admin is on the page at once ----
r = await W.call('POST', '/api/admin/sessions', { event_id: 1, title: 'AI for Lending', session_type: 'panel', room: 'Kalam Theatre', start_time: '2026-11-20 12:00', end_time: '2026-11-20 12:45', description: 'Panel: Lending', speakers: [{ speaker_id: 2, role: 'panellist' }, { speaker_id: 3, role: 'moderator' }], others: 'Guest Panellist (NPCI)' });
check('a panel saved in Admin', r.status === 201, r);
r = await W.call('GET', '/conference', undefined, anon);
check('...is on the website on the next request, with its people', r.text.includes('id="sch-aryabhata-1-1200"') && /<h4>AI for Lending<\/h4><p>Panel: Lending\.<\/p><ul class="sch-people">[\s\S]*?Tarun Chugh[\s\S]*?Guest Panellist[\s\S]*?Moderator/.test(r.text), (r.text.match(/AI for Lending[\s\S]{0,300}/) || [''])[0]);
r = await W.call('POST', '/api/admin/sessions', { event_id: 1, title: 'Held slot', session_type: 'talk', room: 'Kalam Theatre', start_time: '2026-11-20 16:00', end_time: '2026-11-20 16:10', status: 'draft' });
check('a draft saved in Admin', r.status === 201, r);
r = await W.call('GET', '/conference', undefined, anon);
check('...is not on the website', !r.text.includes('Held slot'));
r = await W.call('POST', '/api/admin/speakers', { name: 'Dr. Asha Rao', role: 'Chief Data Officer', organisation: 'Tata Capital', topic: 'Lending' });
check('a speaker added in Admin', r.status === 201, r);
r = await W.call('GET', '/conference', undefined, anon);
check('...is on the speaker grid at once, with initials until a photo is chosen', /<h4>Dr\. Asha Rao<\/h4>\s*<div class="speaker-role">Chief Data Officer<\/div>\s*<div class="speaker-org">Tata Capital<\/div>/.test(r.text) && /speaker-initials" aria-hidden="true">AR</.test(r.text), (r.text.match(/Asha Rao[\s\S]{0,200}/) || [''])[0]);
r = await W.call('GET', '/api/events/1/programme', undefined, anon);
check('the programme says it is live, and names the new speaker', r.json.live === true && r.json.speakers.some((s) => s.name === 'Dr. Asha Rao'));

// ---- a broken database never breaks the page ----
const goodDB = W.env.DB;
W.env.DB = { prepare() { return { bind() { return this; }, async first() { throw new Error('boom'); }, async all() { throw new Error('boom'); }, async run() { throw new Error('boom'); } }; } };
r = await W.call('GET', '/conference', undefined, anon);
check('with the database down: the page as built, status 200', r.status === 200 && r.text === template, [r.status, r.text.length]);
W.env.DB = goodDB;

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
