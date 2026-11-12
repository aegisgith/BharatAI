// Unit: the Media & Influencer Pass (12 Nov 2026), each rule alone, on the two page
// scripts run as a browser would, without a browser (node:vm): public/js/media-pass.js
// (the form's checks, which mirror checkMediaPass() on the server) and
// public/js/admin-media.js (the admin screen's drawing: links, handles, words, escaping).
// No worker, no database. Run: node scripts/verify/unit-media-pass.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let fails = 0, passes = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 500))); if (ok) passes++; else fails++; };
const load = (file, global) => {
  const sandbox = { URL, console, setTimeout, clearTimeout };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(new URL('../../public/js/' + file, import.meta.url), 'utf8'), sandbox, { filename: file });
  return sandbox[global];
};

// ---------------------------------------------------------------- the form
const F = load('media-pass.js', 'MediaPassForm');
check('the form script starts without a page and exposes its rules', !!(F && F._t && F._t.check));
const { check: rule, cleanUrl, followers, boxId } = F._t;

const fol = [['12000', 12000], ['12,000', 12000], ['12k', 12000], ['12K', 12000], ['1.2M', 1200000], ['1.5 lakh', 150000], ['2 crore', 20000000], ['45000+', 45000], ['0', 0], [' 7 ', 7]];
for (const [v, n] of fol) check(`followers: "${v}" is ${n}`, followers(v) === n, followers(v));
check('followers: empty is null', followers('') === null && followers('   ') === null && followers(undefined) === null);
check('followers: words are not a number', followers('lots') === -1 && followers('12 thousand people') === -1 && followers('1e9') === -1);
check('followers: more than two billion is refused', followers('3000000000') === -1);

check('link: https kept', cleanUrl('https://example.com/post/1') === 'https://example.com/post/1');
check('link: www. gains https://', cleanUrl('www.instagram.com/reel/abc') === 'https://www.instagram.com/reel/abc');
check('link: a bare domain with a path gains https://', cleanUrl('youtu.be/xyz') === 'https://youtu.be/xyz');
check('link: empty is empty', cleanUrl('') === '' && cleanUrl('  ') === '');
check('link: javascript:, a word, spaces and no domain are refused', [ 'javascript:alert(1)', 'my reel', 'https://exa mple.com', 'http://localhost/x', 'ftp://x.com/a', 'instagram' ].every((v) => cleanUrl(v) === null));

const media = () => ({ kind: 'media', name: 'Ravi Kumar', email: 'ravi@news.in', mobile: '+91 98200 11111', organisation: 'Mumbai News', designation: 'Reporter', city: 'Mumbai',
  outlet: 'Mumbai News Online', beat: 'Technology', work_links: ['https://news.in/a', '', ''], coverage: 'A story on AI in manufacturing', agree: true });
const infl = () => ({ kind: 'influencer', name: 'Asha Rao', email: 'asha@creator.in', mobile: '9820012345', organisation: 'Asha Explains AI', designation: 'Creator', city: 'Pune',
  platforms: [{ platform: 'instagram', handle: '@asha.ai', followers: '45k' }, { platform: 'youtube', handle: '', followers: '' }, { platform: 'linkedin', handle: '', followers: '' }, { platform: 'x', handle: '', followers: '' }, { platform: 'other', name: '', handle: '', followers: '' }],
  niche: 'AI explainers', audience: 'All India', formats: ['reels', 'live'], before: 'A reel saying I will be there', during: '', after: '', samples: ['https://www.instagram.com/reel/abc', '', ''], agree: true });
check('a full media request passes', rule(media()) === null, rule(media()));
check('a full influencer request passes', rule(infl()) === null, rule(infl()));

// The first mistake is named, in order, with the box it belongs to.
const cases = [
  ['no kind', (b) => { b.kind = ''; }, 'kind'],
  ['a one-letter name', (b) => { b.name = 'R'; }, 'name'],
  ['an email with no domain', (b) => { b.email = 'ravi@news'; }, 'email'],
  ['a 9-digit mobile', (b) => { b.mobile = '98200 1111'; }, 'mobile'],
  ['no organisation', (b) => { b.organisation = ' '; }, 'organisation'],
  ['no designation', (b) => { b.designation = ''; }, 'designation'],
  ['no city', (b) => { b.city = ''; }, 'city'],
  ['media: no publication', (b) => { b.outlet = ''; }, 'outlet'],
  ['media: no beat', (b) => { b.beat = ''; }, 'beat'],
  ['media: no work link', (b) => { b.work_links = ['', '', '']; }, 'work_1'],
  ['media: a bad second link', (b) => { b.work_links = ['https://news.in/a', 'not a link', '']; }, 'work_2'],
  ['media: a plan too short', (b) => { b.coverage = 'AI'; }, 'coverage'],
  ['media: not agreed', (b) => { b.agree = false; }, 'agree'],
];
for (const [n, f, field] of cases) { const b = media(); f(b); const r = rule(b); check('media form names ' + n + ' at ' + field, r && r.field === field, r); }
const icases = [
  ['no platform at all', (b) => { b.platforms.forEach((p) => { p.handle = ''; p.followers = ''; }); }, 'platforms'],
  ['followers with no handle', (b) => { b.platforms[1].followers = '2k'; }, 'pf-youtube-handle'],
  ['a handle with no followers', (b) => { b.platforms[0].followers = ''; }, 'pf-instagram-followers'],
  ['followers in words', (b) => { b.platforms[0].followers = 'many'; }, 'pf-instagram-followers'],
  ['a broken profile link', (b) => { b.platforms[2].handle = 'https://linked in.com/x'; b.platforms[2].followers = '900'; }, 'pf-linkedin-handle'],
  ['another platform with no name', (b) => { b.platforms[4].handle = 'https://blog.in'; b.platforms[4].followers = '100'; }, 'pf-other-name'],
  ['no topic', (b) => { b.niche = ''; }, 'niche'],
  ['no audience', (b) => { b.audience = ''; }, 'audience'],
  ['nothing ticked to make', (b) => { b.formats = []; }, 'formats'],
  ['a format that is not on the list', (b) => { b.formats = ['tiktok']; }, 'formats'],
  ['no plan', (b) => { b.before = 'soon'; }, 'before'],
  ['no sample', (b) => { b.samples = ['', '', '']; }, 'sample_1'],
  ['a bad third sample', (b) => { b.samples = ['https://a.in/1', '', 'javascript:alert(1)']; }, 'sample_3'],
  ['not agreed', (b) => { b.agree = 'yes'; }, 'agree'],
];
for (const [n, f, field] of icases) { const b = infl(); f(b); const r = rule(b); check('influencer form names ' + n + ' at ' + field, r && r.field === field, r); }
check('every sentence is short and asks nicely',
  [...cases.map(([, f]) => { const b = media(); f(b); return rule(b); }), ...icases.map(([, f]) => { const b = infl(); f(b); return rule(b); })].every((r) => /^Please |^Link \d does not/.test(r.error) && r.error.length < 140));
check('the other platform is fine once it has a name, a link and followers', (() => { const b = infl(); Object.assign(b.platforms[4], { name: 'Blog', handle: 'https://blog.in', followers: '1,200' }); return rule(b) === null; })());
check('the plan may be in any of the three boxes', (() => { const b = infl(); b.before = ''; b.after = 'A recap video within a week'; return rule(b) === null; })());

check('box ids: a field key finds its box on the page', boxId('name') === 'mp-name' && boxId('work_2') === 'mp-work-2' && boxId('sample_1') === 'mp-sample-1' &&
  boxId('pf-x-followers') === 'pf-x-followers' && boxId('platforms') === 'pf-instagram-handle' && boxId('formats') === 'mp-format-posts' && boxId('kind') === 'mp-kind-media' && boxId('before') === 'mp-before');

// Every box id the rules can name exists in the page the server renders (read from the source).
const src = readFileSync(new URL('../../src/index.tsx', import.meta.url), 'utf8');
const pageFn = src.slice(src.indexOf('function mediaPassPageHTML('), src.indexOf("app.get('/media-pass'"));
const ids = ['mp-kind-media', 'mp-kind-influencer', 'mp-name', 'mp-email', 'mp-mobile', 'mp-organisation', 'mp-designation', 'mp-city', 'mp-outlet', 'mp-beat', 'mp-coverage', 'mp-niche', 'mp-audience', 'mp-before', 'mp-during', 'mp-after', 'mp-collabs', 'mp-agree', 'mp-website', 'mp-go', 'mp-msg', 'mp-done', 'mp-media', 'mp-influencer'];
check('the page function names each fixed box the script looks for', ids.every((id) => pageFn.includes('id="' + id + '"') || pageFn.includes("field('" + id.slice(3) + "'") || pageFn.includes("area('" + id.slice(3) + "'")), ids.filter((id) => !(pageFn.includes('id="' + id + '"') || pageFn.includes("field('" + id.slice(3) + "'") || pageFn.includes("area('" + id.slice(3) + "'"))));
check('the page uses novalidate, so the browser never refuses silently in its own words', /<form class="mp-card" id="mp-form" novalidate>/.test(pageFn));
check('the page promises only the 2 working days', (pageFn.match(/MEDIA_PASS_REPLY/g) || []).length >= 2 && !/24 hours|guarantee|free entry/i.test(pageFn));
check('the server asks the same questions with the same words', [...cases, ...icases].every(([, f], i) => {
  const b = i < cases.length ? media() : infl(); f(b); const r = rule(b); return src.includes("'" + r.error + "'") || /Link ' \+ \(i \+ 1\) \+ ' does not look like a web address/.test(src);
}));

// ---------------------------------------------------------------- the admin screen
const D = load('admin-media.js', 'MediaDesk');
check('the admin script starts and exposes its parts', !!(D && D.mount && D._t));
const T = D._t;
check('esc: every markup character', T.esc('<b a="1">\'&') === '&lt;b a=&quot;1&quot;&gt;&#39;&amp;');
check('safeLink: only http(s) pages', T.safeLink('https://a.in/x') === 'https://a.in/x' && T.safeLink('javascript:alert(1)') === '' && T.safeLink('https://a.in/"onmouseover=x') === '' && T.safeLink('data:text/html,x') === '');
check('handles: @name becomes the profile on Instagram, YouTube and X', T.handleLink('instagram', '@asha.ai') === 'https://www.instagram.com/asha.ai/' && T.handleLink('youtube', '@AshaAI') === 'https://www.youtube.com/@AshaAI' && T.handleLink('x', 'asha_ai') === 'https://x.com/asha_ai');
check('handles: a LinkedIn name or an odd handle is not guessed', T.handleLink('linkedin', 'asha') === '' && T.handleLink('instagram', '@a"><img') === '' && T.handleLink('other', '@me') === '');
check('handles: a typed link is used as it is, if it is a web page', T.handleLink('linkedin', 'https://www.linkedin.com/in/asha') === 'https://www.linkedin.com/in/asha' && T.handleLink('x', 'javascript:alert(1)') === '');
check('numbers in the Indian way', T.num(150000) === '1,50,000' && T.num('45000') === '45,000');
check('times in India from SQLite and ISO', T.fmtWhen('2026-11-12 05:00:00') === '12 Nov, 10:30 am' && T.fmtWhen('2026-11-12T13:45:00.000Z') === '12 Nov, 7:15 pm' && T.fmtWhen('') === '');
const rows = [{ state: 'new', kind: 'media' }, { state: 'approved', kind: 'influencer' }, { state: 'new', kind: '', subject: 'YouTube creator wants a pass', message: '' }, { state: 'declined', kind: 'media' }];
check('tabs and the kind filter', T.visible(rows, 'new', '').length === 2 && T.visible(rows, 'all', 'influencer').length === 2 && T.visible(rows, 'declined', 'media').length === 1);
rows.forEach((r, i) => { r.id = i + 1; });
check('a request decided in this sitting stays on the tab it was on', T.visible(rows, 'new', '', { 2: 1 }).length === 3 && T.visible(rows, 'new', '', {}).length === 2);
check('a contact-page request is guessed from its words', T.kindOf({ kind: '', subject: 'Media Pass for 20th Nov', message: '' }) === 'media' && T.kindOf({ kind: '', subject: '', message: 'I am an Instagram creator' }) === 'influencer');
check('the pass now, in words', /Not registered yet/.test(T.passLine({ attendee: null })) &&
  /Holds a VIP Pass \(paid\)\. Approving keeps it/.test(T.passLine({ attendee: { badge_type: 'VIP Pass', payment_status: 'paid' }, keeps_pass: 'VIP Pass' })) &&
  /complimentary/.test(T.passLine({ attendee: { badge_type: 'VIP Pass', payment_status: 'waived' }, keeps_pass: 'VIP Pass' })) &&
  /has not paid/.test(T.passLine({ attendee: { badge_type: 'Delegate Pass', unpaid: true } })) &&
  /Registered with a Visitor Pass/.test(T.passLine({ attendee: { badge_type: 'Visitor Pass' } })));
check('the decision, in words', /Approved by Priya, 12 Nov, 10:30 am: Influencer Pass issued, the pass link emailed/.test(T.decisionLine({ state: 'approved', decision: { by: 'Priya', at: '2026-11-12T05:00:00Z', pass: 'Influencer Pass', emailed: true } })) &&
  /keeps their VIP Pass/.test(T.decisionLine({ state: 'approved', decision: { kept: true, pass: 'VIP Pass' } })) &&
  /did not go/.test(T.decisionLine({ state: 'approved', decision: { pass: 'Media Pass', emailed: false } })) && /^Declined/.test(T.decisionLine({ state: 'declined', decision: {} })));

// A request whose every answer is an attack draws as text.
T.S.labels = { platforms: { instagram: 'Instagram', other: 'Other' }, formats: { reels: 'Reels or Shorts' }, kinds: { influencer: 'Influencer / creator' }, passes: {} };
const evil = '<img src=x onerror="window.__mp=1">';
const html = T.cardHtml({ id: 7, ref: 'BHAI-INQ-00007', state: 'new', kind: 'influencer', name: evil, email: 'a@b.in"><script>', phone: evil, organization: evil, subject: evil, message: evil, admin_notes: evil, assigned_to: evil,
  answers: { designation: evil, city: evil, platforms: [{ platform: 'instagram', handle: '@x"onclick=1', followers: 1200 }, { platform: 'other', name: evil, handle: 'javascript:alert(1)', followers: 5 }], followers_total: 1205,
    niche: evil, audience: evil, formats: ['reels', evil], before: evil, during: '', after: '', samples: ['javascript:alert(2)', 'https://ok.in/a'], collabs: evil }, attendee: null, keeps_pass: '' });
check('an attacking request draws no tag or attribute of its own (all of it is text)', !/<img|<script|onerror="|"onclick=/i.test(html) && /&lt;img src=x onerror=&quot;/.test(html), html.slice(0, 400));
check('...and no link to javascript:', !/href="javascript/i.test(html));
check('...the safe sample is still a link, opening in a new tab without the opener', /<a href="https:\/\/ok\.in\/a" target="_blank" rel="noopener noreferrer">/.test(html));
check('...the followers add up and are shown', /1,205 followers/.test(html) && />1,200</.test(html));
check('...and it has the two buttons and the email tick', /data-act="approve"/.test(html) && /data-act="decline"/.test(html) && /data-mail="7" checked/.test(html));
const kept = T.cardHtml({ id: 8, state: 'new', kind: 'media', name: 'P', email: 'p@x.in', attendee: { badge_type: 'VIP Pass', payment_status: 'paid' }, keeps_pass: 'VIP Pass', answers: { work_links: [], platforms: [], formats: [], samples: [] } });
check('a paid pass holder: the button says they keep it, the pass choice is locked', /Approve \(they keep their VIP Pass\)/.test(kept) && /data-pick="8" disabled/.test(kept));
const done = T.cardHtml({ id: 9, state: 'approved', kind: 'media', name: 'D', email: 'd@x.in', decision: { pass: 'Media Pass', emailed: true }, attendee: { badge_type: 'Media Pass', pass_downloaded_at: null }, answers: null, subject: 's', message: 'm' });
check('an approved request: no approve button, the resend button, whether the pass was downloaded', !/data-act="approve"/.test(done) && /data-act="resend"/.test(done) && /Pass not downloaded yet/.test(done));
check('a contact-page request shows its words and says there are no answers', /Sent from the contact page/.test(T.cardHtml({ id: 10, state: 'new', kind: '', name: 'X', email: 'x@y.in', subject: 'Media Pass', message: 'Hello', answers: null, attendee: null })));

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
