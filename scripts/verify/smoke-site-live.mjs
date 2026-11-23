// Integration: the website drawn live from the app (16 Nov 2026; /exhibition, the home page,
// /partner and the talk cards since 18 Nov 2026), through the WHOLE built
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

// ---- the talks list drives the Innovation Talk sessions (Raveesh Dewan, 16 Nov 2026) ----
W.db.run("INSERT INTO sessions (event_id, title, description, speaker_name, speaker_title, session_type, room, start_time, end_time, capacity) VALUES (1, 'Innovation Talk: Acme', 'Speaker to be announced.', 'Tarun Chugh', 'MD & CEO, Bajaj Life Insurance', 'talk', 'Aryabhata Theatre', '2026-11-21 15:00', '2026-11-21 15:20', 1000)");
const acme = W.rows("SELECT id FROM sessions WHERE title = 'Innovation Talk: Acme'")[0].id;
W.db.run("INSERT INTO session_speakers (session_id, speaker_id, role, sort_order) VALUES (?, 2, 'speaker', 0)", [acme]);
W.db.run("INSERT INTO innovation_talks (event_id, slot_no, session_type, time_slot, speaker_name, company, topic, status, speaker_title, starts_at, duration_min) VALUES (1, 1, 'Afternoon', 'Sat 21 Nov · 3:00 – 3:20 PM', 'Dr. Saurabh N. Mehta', 'Acme Pvt Ltd', 'Robots at work', 'confirmed', 'Director', '2026-11-21 15:00', 20)");
r = await W.call('GET', '/api/admin/events/1/conference');
const acmeS = r.json.sessions.find((s) => s.id === acme);
check('an Innovation Talk session takes its speaker and topic from the talks list the moment Admin reads it', acmeS && acmeS.speaker_name === 'Dr. Saurabh N. Mehta' && acmeS.links.map((l) => l.speaker_id).join() === '4' && acmeS.description === 'Robots at work', acmeS && [acmeS.speaker_name, acmeS.links, acmeS.description]);
check('the old speaker’s link is gone, so their brief no longer lists the talk', !W.rows('SELECT 1 FROM session_speakers WHERE session_id = ? AND speaker_id = 2', [acme]).length);
r = await W.call('GET', '/conference', undefined, anon);
check('...and the website names the talk’s speaker', /Innovation Talk: Acme<\/h4>[\s\S]{0,700}Dr\. Saurabh N\. Mehta/.test(r.text), (r.text.match(/Innovation Talk: Acme[\s\S]{0,400}/) || [''])[0]);
const talkId = W.rows("SELECT id FROM innovation_talks WHERE company = 'Acme Pvt Ltd'")[0].id;
r = await W.call('DELETE', '/api/admin/innovation-talks/' + talkId);
check('the talk deleted in Admin -> Innovation Talks', r.status === 200, r);
const afterDel = W.rows('SELECT speaker_name, speaker_title, description FROM sessions WHERE id = ?', [acme])[0];
check('...leaves its session with no speaker and no link', afterDel.speaker_name === null && afterDel.speaker_title === null && afterDel.description === 'Speaker to be announced.' && !W.rows('SELECT 1 FROM session_speakers WHERE session_id = ?', [acme]).length, afterDel);
r = await W.call('POST', '/api/admin/innovation-talks', { event_id: 1, speaker_name: 'Dr. Saurabh N. Mehta', company: 'Acme Pvt Ltd', topic: 'Robots again', starts_at: '2026-11-21 15:00', duration_min: 20, hall: 'Aryabhata Theatre' });
check('a talk added back in Admin', r.status === 200 && r.json.success, r);
check('...is on its session at once', W.rows('SELECT speaker_name FROM sessions WHERE id = ?', [acme])[0].speaker_name === 'Dr. Saurabh N. Mehta');

// ---- a speaker's photo from their pass (Reny Varghese, Vishal Deo, 16 Nov 2026) ----
W.db.run("INSERT INTO attendees (event_id, name, email, badge_type, payment_status, main_event, avatar_url) VALUES (1, 'Tarun Chugh', 'tarun@example.test', 'Speaker', 'waived', 1, '/api/uploads/avatars/77-1.jpg')");
r = await W.call('GET', '/api/events/1/programme', undefined, anon);
const tc = r.json.speakers.find((s) => s.name === 'Tarun Chugh');
check('a speaker with no photo of their own shows the photo on their Speaker pass, found by name', tc && tc.photo_url === '/api/uploads/avatars/77-1.jpg' && !('email' in tc), tc);
r = await W.call('GET', '/api/admin/events/1/conference');
check('...in Admin too (the session dialog lists speakers from here)', r.json.speakers.find((s) => s.id === 2)?.photo_url === '/api/uploads/avatars/77-1.jpg', r.json.speakers.find((s) => s.id === 2));
r = await W.call('GET', '/conference', undefined, anon);
check('...and on the website', /Tarun Chugh[\s\S]{0,300}/.test(r.text) && r.text.includes('src="/api/uploads/avatars/77-1.jpg"'));

// ---- the exhibitor wall and the talk cards, live (18 Nov 2026) ----
// Dipti Agrawal's photo went on her pass after her talk was added, and Tudip's logo was
// uploaded in Admin: neither reached the website, which changed only when rebuilt.
const PAGES = { '/exhibition': 'exhibition.html', '/partner': 'partner.html', '/mumbai': 'mumbai.html' };
const page = (f) => readFileSync(join(ROOT, 'public', f), 'utf8').replace(/^﻿/, '');
const conferenceAssets = W.env.ASSETS;
W.env.ASSETS = { fetch: async (req) => {
  const u = new URL(req.url);
  if (PAGES[u.pathname]) return new Response(page(PAGES[u.pathname]), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  return conferenceAssets.fetch(req);
} };
// A PNG 400 x 100, as the Admin screen sends a logo (a data URL).
const png = new Uint8Array(300);
png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 144, 0, 0, 0, 100, 8, 6, 0, 0, 0]);
const pngUrl = 'data:image/png;base64,' + Buffer.from(png).toString('base64');

// The company team tables (0050): the public exhibitor list shows a company with a settings row.
W.db.exec(readFileSync(join(ROOT, 'migrations', '0050_exhibitor_team.sql'), 'utf8'));
// The talk's hall and the speaker's email (0052 and after), as production has them.
for (const col of ['hall TEXT', "speaker_email TEXT DEFAULT ''"]) { try { W.db.run('ALTER TABLE innovation_talks ADD COLUMN ' + col); } catch { /* already there */ } }
W.db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('exhibitor_directory_public', '1')");
W.db.run("INSERT INTO exhibitors (event_id, company_name, booth_number) VALUES (1, 'CGI', '5')");
const cgi = W.rows("SELECT id FROM exhibitors WHERE company_name = 'CGI'")[0].id;
W.db.run('INSERT INTO exhibitor_team_settings (exhibitor_id) VALUES (?)', [cgi]);
W.db.run("INSERT INTO exhibitors (event_id, company_name) VALUES (1, 'Tudip Technologies Pvt Ltd')");
const tudip = W.rows("SELECT id FROM exhibitors WHERE company_name = 'Tudip Technologies Pvt Ltd'")[0].id;
W.db.run("INSERT INTO innovation_talks (event_id, slot_no, session_type, time_slot, speaker_name, company, topic, status, speaker_title, starts_at, duration_min, hall, speaker_email) VALUES (1, 2, 'Afternoon', 'Sat 21 Nov', 'Dipti Agrawal', 'Tudip Technologies Pvt Ltd', 'From Data to Decisions', 'confirmed', 'Co-Founder and CEO', '2026-11-21 12:20', 20, 'Aryabhata Theatre', 'dipti@tudip.test')");
W.db.run("INSERT INTO attendees (event_id, name, email, badge_type, payment_status, main_event, avatar_url) VALUES (1, 'Dipti Agrawal', 'dipti@tudip.test', 'Exhibition Speaker', 'waived', 1, '/api/uploads/avatars/4147-1794979882967.jpg')");

r = await W.call('GET', '/api/events/1/programme', undefined, anon);
const dipti = r.json.talks.find((t) => t.speaker_name === 'Dipti Agrawal');
check('a talk with no photo of its own shows the photo on the speaker’s pass, found by email', dipti && dipti.photo_url === '/api/uploads/avatars/4147-1794979882967.jpg' && !('speaker_email' in dipti), dipti);
r = await W.call('GET', '/api/events/1/innovation-talks', undefined, anon);
const diptiApp = (r.json || []).find((t) => t.speaker_name === 'Dipti Agrawal');
check('...in the app’s Innovation Talks tab too', diptiApp && diptiApp.speaker_photo_url === '/api/uploads/avatars/4147-1794979882967.jpg' && !('speaker_email' in diptiApp), diptiApp);
r = await W.call('GET', '/api/events/1/innovation-talks');
check('...and in Admin', (r.json || []).find((t) => t.speaker_name === 'Dipti Agrawal')?.speaker_photo_url === '/api/uploads/avatars/4147-1794979882967.jpg');
const tpTalk = W.rows("SELECT id FROM innovation_talks WHERE speaker_name = 'Dr. Saurabh N. Mehta'")[0];
W.db.run("UPDATE innovation_talks SET speaker_photo_url = '/images/talks/own.webp', speaker_email = 'saurabh@example.test' WHERE id = ?", [tpTalk.id]);
W.db.run("INSERT INTO attendees (event_id, name, email, badge_type, payment_status, main_event, avatar_url) VALUES (1, 'Dr. Saurabh N. Mehta', 'saurabh@example.test', 'Exhibition Speaker', 'waived', 1, '/api/uploads/avatars/99-2.jpg')");
r = await W.call('GET', '/api/events/1/programme', undefined, anon);
check('a photo chosen for the talk itself still wins over the pass photo', r.json.talks.find((t) => t.speaker_name === 'Dr. Saurabh N. Mehta')?.photo_url === '/images/talks/own.webp');

r = await W.call('GET', '/exhibition', undefined, anon);
const card = (html, name) => (html.match(new RegExp('<div class="speaker-card[^"]*"[^>]*>(?:(?!<div class="speaker-card)[\\s\\S])*?<h4>' + name + '</h4>[\\s\\S]*?</div>')) || [''])[0];
check('/exhibition is drawn live', r.status === 200 && r.headers.get('x-site-live') === 'live' && r.headers.get('cache-control') === 'public, max-age=0, must-revalidate', [r.status, r.headers.get('x-site-live'), r.headers.get('cache-control')]);
check('...its talk card shows Dipti’s pass photo, not initials', card(r.text, 'Dipti Agrawal').includes('src="/api/uploads/avatars/4147-1794979882967.jpg"'), card(r.text, 'Dipti Agrawal'));
check('...the page keeps its shell', r.text.includes('<title>') && r.text.includes('<!-- talks:start') && r.text.includes('<!-- exhibitors:start') && r.text.includes('</html>'));
check('...the wall is the app’s list: CGI, with its name until a logo is uploaded', /<li class="exh-card" data-featured>[\s\S]{0,400}CGI/.test(r.text));
check('...a company that is not on the public list is not on the wall', !/exh-name">Tudip/.test(r.text));

r = await W.call('POST', '/api/admin/exhibitors/' + tudip + '/logo', { image: pngUrl });
check('Tudip’s logo uploaded in Admin', r.status === 200 && /\/api\/uploads\/exhibitors\//.test(r.json.logo_url), r);
r = await W.call('POST', '/api/admin/exhibitors/' + cgi + '/logo', { image: pngUrl });
check('CGI’s logo uploaded in Admin', r.status === 200, r);
const cgiLogo = W.rows('SELECT logo_url FROM exhibitors WHERE id = ?', [cgi])[0].logo_url.replace(/^https?:\/\/[^/]+/, '');
r = await W.call('GET', '/exhibition', undefined, anon);
const diptiCard = card(r.text, 'Dipti Agrawal');
check('...Dipti’s talk card carries Tudip’s new logo at once, sized from the file', /class="talk-logo"/.test(diptiCard) && /width="400" height="100"[^>]*src="\/api\/uploads\/exhibitors\//.test(diptiCard), diptiCard);
check('...the wall shows CGI’s new logo at once, with its real size', r.text.includes(`src="${cgiLogo}" width="400" height="100"`), (r.text.match(/exh-logo">[\s\S]{0,200}/) || [''])[0]);
r = await W.call('GET', '/mumbai', undefined, anon);
check('/mumbai (the home page until 24 Nov 2026) is drawn live and its strip shows the new logo', r.status === 200 && r.headers.get('x-site-live') === 'live' && r.text.includes(`src="${cgiLogo}" width="400" height="100"`) && r.text.includes('<!-- speakers:start'), [r.status, r.headers.get('x-site-live')]);
check('...its speaker grid is the app’s', /<!-- speakers:start[\s\S]*?Tarun Chugh[\s\S]*?<!-- speakers:end/.test(r.text) && !/<!-- speakers:start[\s\S]*?Nilesh Shah[\s\S]*?<!-- speakers:end/.test(r.text));
r = await W.call('GET', '/partner', undefined, anon);
check('/partner too', r.status === 200 && r.text.includes(`src="${cgiLogo}"`));
r = await W.call('GET', '/conference', undefined, anon);
check('/conference’s talk cards follow as well', /<!-- talks:start[\s\S]*?Dipti Agrawal[\s\S]*?<!-- talks:end/.test(r.text) && card(r.text.slice(r.text.indexOf('<!-- talks:start')), 'Dipti Agrawal').includes('src="/api/uploads/avatars/4147-1794979882967.jpg"'));
r = await W.call('GET', '/exhibition', undefined, anon);
check('nothing unfinished is printed', !/undefined|NaN|\[object/.test(r.text.slice(r.text.indexOf('<!-- talks:start'), r.text.indexOf('<!-- talks:end'))) && !/undefined|NaN|\[object/.test(r.text.slice(r.text.indexOf('<!-- exhibitors:start'), r.text.indexOf('<!-- exhibitors:end'))));

W.db.run("INSERT INTO app_settings (key, value) VALUES ('site_live_pages', 'off')");
r = await W.call('GET', '/exhibition', undefined, anon);
check('switched off (site_live_pages = off): the page as built', r.status === 200 && r.text === page('exhibition.html') && r.headers.get('x-site-live') === 'static', [r.status, r.headers.get('x-site-live')]);
W.db.run("DELETE FROM app_settings WHERE key = 'site_live_pages'");

// ---- a broken database never breaks the page ----
const goodDB = W.env.DB;
W.env.DB = { prepare() { return { bind() { return this; }, async first() { throw new Error('boom'); }, async all() { throw new Error('boom'); }, async run() { throw new Error('boom'); } }; } };
r = await W.call('GET', '/conference', undefined, anon);
check('with the database down: the page as built, status 200', r.status === 200 && r.text === template, [r.status, r.text.length]);
r = await W.call('GET', '/exhibition', undefined, anon);
check('...and /exhibition as built, status 200', r.status === 200 && r.text === page('exhibition.html'), [r.status, r.headers.get('x-site-live')]);
r = await W.call('GET', '/mumbai', undefined, anon);
check('...and /mumbai as built, status 200', r.status === 200 && r.text === page('mumbai.html'), [r.status, r.headers.get('x-site-live')]);
W.env.DB = goodDB;

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
