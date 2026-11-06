// Integration: the /app design through the built worker. What the worker really serves has every id the
// page script needs exactly once (the phone's Inbox, Alerts and Me moved), one button for each tab on each
// size of screen, every link in the new footer answering, the same menu word on the other worker pages,
// and the page no heavier than it was. Needs `npm run build`. 6 Nov 2026.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const worker = (await import(pathToFileURL(join(ROOT, 'dist', '_worker.js')).href + '?' + Date.now())).default;
const env = new Proxy({ ADMIN_SECRET: 'h', SESSION_SECRET: 'h' }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };
const get = async (p) => { const r = await worker.fetch(new Request('https://bharataiinnovation.com' + p), env, ctx); return { status: r.status, text: await r.text(), type: r.headers.get('content-type') || '' }; };

let failed = 0, passed = 0;
const check = (name, ok, detail) => { if (ok) passed++; else failed++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  <- ' + detail)); };

const app = await get('/app');
check('/app answers', app.status === 200 && app.text.includes('id="main-nav"'), String(app.status));
const html = app.text;
const jsMatch = /src="(\/app\.js\?v=[^"]+)"/.exec(html);
check('/app names its script', !!jsMatch, 'no /app.js');
const js = jsMatch ? (await get(jsMatch[1])).text : '';
check('/app.js answers', js.length > 100000, String(js.length));

// Everything moved keeps its id, once. The page script finds these by id.
const ids = ['nav-mobile-me', 'nav-mobile-avatar', 'nav-mobile-me-icon', 'nav-notif-btn-mobile', 'notif-badge-mobile', 'unread-badge-mobile', 'nav-signin-btn', 'nav-signin-btn-desktop',
  'nav-avatar-btn', 'nav-avatar-img', 'nav-avatar-name', 'nav-logout-btn', 'nav-notif-btn', 'notif-badge', 'unread-badge', 'notif-dropdown', 'notif-list',
  'hero-band', 'hero-inner', 'event-desc', 'hero-wordmark', 'hero-venue-dates', 'event-venue', 'event-dates', 'event-title',
  'pass-card-cta', 'pcc-pass-name', 'pcc-pass-state', 'pcc-pass-note', 'pcc-workshop', 'pcc-upgrade', 'pcc-pay-btn', 'pcc-download-btn', 'pcc-guarantee-btn', 'pcc-upgrade-btn', 'pcc-card-btn',
  'my-agenda-toggle', 'agenda-count', 'sched-day-selector', 'sched-hall-tabs', 'sched-track-filter', 'attendee-search', 'visitor-network-banner', 'vnb-title', 'vnb-copy', 'vnb-go',
  'tab-dashboard', 'tab-schedule', 'tab-networking', 'tab-workshops', 'tab-exhibition', 'tab-inbox', 'tab-myprofile', 'tab-venue', 'content', 'app-topbar'];
for (const id of ids) {
  const n = html.split('id="' + id + '"').length - 1;
  check('id "' + id + '" is on the page exactly once', n === 1, 'found ' + n);
}
// Any id repeated anywhere on the page would mean the patch left a copy behind.
const allIds = [...html.slice(html.indexOf('<body')).matchAll(/\sid="([^"$\\]+)"/g)].map((m) => m[1]);
const dupes = [...new Set(allIds.filter((x, i) => allIds.indexOf(x) !== i))];
check('no id is repeated anywhere on the page', dupes.length === 0, dupes.join(','));

// One button per tab per screen size, which is what the fixed switchTab relies on.
const navOpen = html.indexOf('<nav id="main-nav"');
const nav = html.slice(navOpen, html.indexOf('</nav>', navOpen));
const topOpen = html.indexOf('<header id="app-topbar"');
const top = html.slice(topOpen, html.indexOf('</header>', topOpen));
const count = (s, tab) => (s.match(new RegExp('data-tab="' + tab + '"', 'g')) || []).length;
for (const tab of ['dashboard', 'schedule', 'networking', 'workshops']) check('tab "' + tab + '" has a phone button and a laptop button', count(nav, tab) === 2 && count(top, tab) === 0, count(nav, tab) + '/' + count(top, tab));
check('Inbox: one in the phone\'s top bar, one in the laptop\'s', count(top, 'inbox') === 1 && count(nav, 'inbox') === 1, count(top, 'inbox') + '/' + count(nav, 'inbox'));
check('Me: one in the phone\'s top bar, one on the laptop', count(top, 'myprofile') === 1 && count(nav, 'myprofile') === 1, count(top, 'myprofile') + '/' + count(nav, 'myprofile'));
check('the top bar buttons have names a screen reader can read', ['aria-label="Inbox"', 'aria-label="Notifications"', 'aria-label="Your account"'].every((x) => top.includes(x)), 'label missing');
check('the phone bar keeps its Sign In', nav.includes('id="nav-signin-btn"'), 'gone');
check('and the top bar has one too, for someone signed out', top.includes('js-signin-btn'), 'gone');

// The script still drives what it always drove.
check('/app.js marks every button for a tab', js.includes('.nav-btn[data-tab="${tab}"]') && !js.includes('const tabBtn = document.querySelector(`[data-tab='), 'old switchTab');
check('/app.js tells the hero who is signed in', js.includes("heroBand.classList.toggle('ap-in', signedIn)"), 'no ap-in');
// A returning person is laid out from what this device saved, before the server answers, and only then.
const init = js.slice(js.indexOf('expectingSavedUser = !!was;'));
check('/app.js lays out for the saved person before drawing the app', init.indexOf('expectingSavedUser = !!was;') === 0 && init.indexOf('showPublicApp();') > 0 && init.indexOf('showPublicApp();') < 200, String(init.indexOf('showPublicApp();')));
check('/app.js stops expecting them as soon as the server has answered', init.indexOf('expectingSavedUser = false;') > 0 && init.indexOf('expectingSavedUser = false;') < init.indexOf('resp.status >= 400'), 'order');
check('/app.js takes the saved person off the screen if the sign-in ran out', /removeItem\('agba_user'\);\s*\/\/ Home was drawn[^\n]*\n\s*updateNavForAuth\(\);\s*renderPassAndCardCta\(\);/.test(js), 'not found');
check('/app.js does not ask for the workshop seat twice on one open', js.includes('if (!pending && !early) loadWorkshopSeat();') && js.includes('renderPassAndCardCta(true)'), 'not found');
check('/app.js prints "All halls"', js.includes('${h.key || h.short}'), 'old chip');
check('/app.js has no bare "Schedule" action', !js.includes("A('Schedule',") && !js.includes("A('My schedule',") && !js.includes("A('Live schedule',"), 'found');

// Words a person relies on are still on the page.
for (const t of ['Register Free', 'Learn More', 'Download my pass', 'Guarantee both days', 'Upgrade my pass', 'Pay now', 'Invite a colleague', 'Tell your network', 'Download my LinkedIn / WhatsApp creative',
  'Networking', 'Hub', 'Connect with fellow attendees, speakers, and exhibitors', 'Exhibition', 'Explore booths, book your exhibition space, and connect with exhibitors',
  'Your connections, messages, and meetings', 'Venue &amp;', 'World Trade Center, Cuffe Parade, Mumbai 400005', 'Hands-On Training', '>Training<', '>Workshops<', 'Intensive hands-on workshops led by industry experts',
  'My Agenda', 'Add to calendar', 'Main Site', 'Book Booth', 'Contact', 'AI Market', 'Log In / Register', 'Log Out', 'Finish your profile', 'Confirm Your Attendance']) {
  check('still on the page: ' + t, html.includes(t), 'missing');
}
check('the page shows the event description the same as the seed text, so the hero does not jump', html.includes('id="event-desc">India&rsquo;s B2B platform for AI'), 'desc');
check('the word RSVP is not on what a person reads in the hero', !html.slice(html.indexOf('id="hero-band"'), html.indexOf('id="stats-section"')).includes('RSVP'), 'found');

// Every link in the new footer goes somewhere real.
const footOpen = html.indexOf('<footer class="ap-foot');
const foot = html.slice(footOpen, html.indexOf('</footer>', footOpen));
const links = [...foot.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]);
check('the footer has its links', links.length >= 12, String(links.length));
const STATIC = { '/': 'index', '/conference': 'conference', '/exhibition': 'exhibition', '/networking': 'networking', '/training-workshop': 'training-workshop', '/privacy': 'privacy', '/terms': 'terms', '/refund': 'refund', '/contact': 'contact', '/inquiry': 'inquiry' };
for (const l of [...new Set(links)]) {
  if (STATIC[l] && existsSync(join(ROOT, 'public', STATIC[l] + '.html'))) { check('footer link ' + l + ' is a page on the site', true); continue; }
  const r = await get(l);
  check('footer link ' + l + ' answers', r.status >= 200 && r.status < 400, String(r.status));
}
check('the footer credits both libraries', foot.includes('skiper-ui.com') && foot.includes('VengeanceUI'), 'credit');
check('the footer names the organiser as the website does', foot.includes('Organized by Aegis Knowledge Trust') && readFileSync(join(ROOT, 'public/training-workshop.html'), 'utf8').includes('Organized by Aegis Knowledge Trust'), 'wording');

// The menu on the worker's other pages.
for (const p of ['/register', '/inquiry']) {
  const r = await get(p);
  check(p + ' says Conference Schedule in its menu, and still links to the tab', r.status === 200 && r.text.includes('Conference Schedule') && r.text.includes('/app#schedule'), String(r.status));
}

// Files the page and the service worker name are on disk, and the service worker's list is well formed.
const sw = readFileSync(join(ROOT, 'public/sw.js'), 'utf8');
for (const f of ['/css/app-design.css?v=20261106', '/css/app-motion.css?v=20261106', '/js/app-motion.js?v=20261106']) {
  check(f + ' is named by the page', html.includes(f), 'page');
  check(f + ' is on the offline list', sw.includes("'" + f + "'"), 'sw');
  check(f + ' is on disk', existsSync(join(ROOT, 'public', f.split('?')[0])), 'disk');
}
check('nothing on the page comes from another site in its head', !/<(?:link|script)[^>]+(?:href|src)="https?:\/\/(?!bharataiinnovation\.com)/.test(html.slice(0, html.indexOf('</head>'))), 'outside request');

// The page itself must not have got heavier: the old inline globe came out, the footer went in.
const BASELINE_GZ = 48413; // measured from the build before this design, 6 Nov 2026
const gz = gzipSync(Buffer.from(html)).length;
check('/app compressed is within the size it was before this design (' + gz + ' bytes, was about ' + BASELINE_GZ + ')', gz <= BASELINE_GZ * 1.03, String(gz));

console.log(`\nintegration-app-design: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
