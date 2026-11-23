// /share on a phone (Pixel 7, Edge headless): "Share your Bharat AI moment".
// Its own small server: public/ from the repo, a programme of two talks and two
// panels, and one signed-in VIP (localStorage + /api/attendees/7), so it needs no
// worker build. Checks: signed out, the card draws and asks to sign in; signed in,
// the name, photo and VIP pass are on it; a speaker is found by typing; a talk and
// a panel are picked; the X words fit; Story is 1080x1920; the steps are counted;
// nothing scrolls sideways at 390px; no script error.
// Run:  node scripts/verify/browser-share.cjs
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium, devices } = require('./playwright.cjs');
const PUB = path.join(__dirname, '..', '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json' };

const PROGRAMME = {
  sessions: [
    { id: 116, title: 'Keynote', session_type: 'keynote', room: 'Homi J. Bhabha Hall', start_time: '2026-11-20 10:20', links: [{ speaker_id: 2, role: 'keynote' }] },
    { id: 145, title: 'Improving Learning Outcomes with AI: From Assessment to Measurable Impact', session_type: 'panel', room: 'Homi J. Bhabha Hall', start_time: '2026-11-21 16:30',
      links: [{ speaker_id: 1, role: 'panellist' }, { speaker_id: 3, role: 'panellist' }, { speaker_id: 4, role: 'moderator' }] },
    { id: 130, title: 'Human × AI: The Partnership Powering the Autonomous Enterprise', session_type: 'panel', room: 'Kalam Theatre', start_time: '2026-11-20 16:30',
      links: [{ speaker_id: 3, role: 'panellist' }, { speaker_id: 4, role: 'moderator' }] },
  ],
  speakers: [
    { id: 1, name: 'Dr. Abhijit Gangopadhyay', role: 'Dean', organisation: 'Aegis School of Data Science & AI', photo_url: '/images/speaker-abhijit-gangopadhyay.webp', topic: '' },
    { id: 2, name: 'Shri Praveen Pardeshi', role: 'CEO', organisation: 'MITRA', photo_url: '/images/speaker-praveen-pardeshi.webp', topic: 'AI for Viksit Maharashtra' },
    { id: 3, name: 'Dr. Lakshmi Mohan', role: 'Pro Vice Chancellor', organisation: 'ITM Skills University', photo_url: '/images/speaker-lakshmi-mohan-sq.webp', topic: '' },
    { id: 4, name: 'Dr. Saurabh N. Mehta', role: 'Chief Academic Officer', organisation: 'Vidyalankar Institute', photo_url: '/images/speaker-saurabh-mehta-sq.webp', topic: '' },
  ],
  talks: [
    { id: 26, company: 'NoBroker, ConvoZen', speaker_name: 'Akhil Gupta', speaker_title: 'Founder & CTPO', topic: 'Reimagining Marketplaces in the era of AI Agents', starts_at: '2026-11-20 12:30', hall: 'Aryabhata Theatre', photo_url: '/images/talks/akhil-gupta.webp' },
    { id: 35, company: 'Cloud Crane', speaker_name: 'Saumya Phor', speaker_title: 'CEO', topic: 'The next step of software distribution', starts_at: '2026-11-21 14:56', hall: 'Aryabhata Theatre', photo_url: '/images/talks/saumya-phor.webp' },
    { id: 36, company: 'Cloud Crane', speaker_name: 'Chirag Phor', speaker_title: 'CTO', topic: '', starts_at: '2026-11-21 14:56', hall: 'Aryabhata Theatre', photo_url: '/images/talks/chirag-phor.webp' },
  ],
};
const VIP = { id: 7, event_id: 1, name: 'Asha Rao', job_title: 'Head of Data', company: 'Example Ltd', badge_type: 'VIP Pass', role: 'attendee', avatar_url: '/images/talks/divyanshi-saxena.webp' };
const steps = [];

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (code, body, type) => { res.writeHead(code, { 'content-type': type || 'application/json' }); res.end(body); };
  if (u.pathname === '/api/events/1/programme') return send(200, JSON.stringify(PROGRAMME));
  const signedIn = /share_session=7/.test(req.headers.cookie || '');
  if (u.pathname === '/api/attendees/7') return signedIn ? send(200, JSON.stringify(VIP)) : send(401, '{"error":"sign in"}');
  if (u.pathname === '/api/attendees/7/connections') return signedIn ? send(200, JSON.stringify([{ status: 'accepted', other_name: 'Ravi Connection', other_company: 'Acme', other_job_title: 'CTO', other_avatar: '' }])) : send(401, '{}');
  if (u.pathname === '/api/attendees/7/track-step') { let b = ''; req.on('data', d => b += d); req.on('end', () => { steps.push(JSON.parse(b)); send(200, '{"ok":true}'); }); return; }
  let p = decodeURIComponent(u.pathname); if (p === '/share') p = '/share.html';
  const f = path.join(PUB, p);
  if (!f.startsWith(PUB)) return send(403, '');
  fs.readFile(f, (e, buf) => e ? send(404, 'nf') : send(200, buf, TYPES[path.extname(f)] || 'application/octet-stream'));
});

let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errs = [];
  const drawn = (pg) => pg.waitForFunction(() => !document.getElementById('shBusy').classList.contains('on') && document.getElementById('shImg').naturalWidth > 0, null, { timeout: 30000 });
  const size = (pg) => pg.$eval('#shImg', i => i.naturalWidth + 'x' + i.naturalHeight);
  try {
    // ---- signed out
    const c1 = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 } });
    const p1 = await c1.newPage();
    p1.on('pageerror', e => errs.push(e.message));
    await p1.goto(base + '/share');
    await drawn(p1);
    check('signed out: the "I attended" picture draws, 1080x1350', await size(p1) === '1080x1350', await size(p1));
    check('signed out: a Sign in button leads to the app and back', await p1.getAttribute('#shWho a', 'href') === '/app?action=share-moment', await p1.getAttribute('#shWho a', 'href'));
    check('signed out: no pass to tick (a pass is never chosen here)', await p1.isHidden('#shPassRow'), 'pass row shown');
    check('nothing scrolls sideways at 390px', await p1.evaluate(() => document.documentElement.scrollWidth <= innerWidth), await p1.evaluate(() => document.documentElement.scrollWidth));
    await c1.close();

    // ---- signed in as a VIP
    const c2 = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 } });
    await c2.addCookies([{ name: 'share_session', value: '7', url: base }]);
    await c2.addInitScript(() => { try { localStorage.setItem('agba_user', JSON.stringify({ id: 7 })); } catch (e) {} });
    const pg = await c2.newPage();
    pg.on('pageerror', e => errs.push(e.message));
    await pg.goto(base + '/share');
    await pg.waitForFunction(() => /Signed in as/.test(document.getElementById('shWho').textContent), null, { timeout: 20000 });
    await drawn(pg);
    const who = await pg.textContent('#shWho');
    check('signed in: name and the VIP pass shown', who.includes('Asha Rao') && who.includes('VIP PASS'), who);
    check('signed in: the pass can be left off', await pg.isVisible('#shMeFold') && (await pg.$eval('#shShowPass', i => i.checked)), 'toggle');
    let cap = await pg.inputValue('#shCap');
    check('LinkedIn words: "as a VIP guest", tag us, Powered by IDFC FIRST Bank', cap.includes('as a VIP guest') && cap.includes('@Bharat AI Innovation') && cap.includes('Powered by IDFC FIRST Bank'), cap);

    // who I met: type a speaker's name, pick them; a connection is found too
    await pg.click('[data-kind=met]');
    await pg.fill('#shPN0', 'abhij');
    await pg.waitForSelector('.sh-sugg li button', { timeout: 5000 });
    await pg.click('.sh-sugg li button');
    await drawn(pg);
    check('who I met: the speaker is picked with designation and organisation', await pg.inputValue('#shPT0') === 'Dean' && (await pg.inputValue('#shPC0')).startsWith('Aegis'), await pg.inputValue('#shPT0'));
    await pg.click('#shAddPerson');
    await pg.fill('#shPN1', 'ravi conn');
    await pg.waitForSelector('[data-i="1"] .sh-sugg li button', { timeout: 5000 });
    check('who I met: people connected in the app are suggested', (await pg.textContent('[data-i="1"] .sh-sugg li')).includes('Connection'), await pg.textContent('[data-i="1"] .sh-sugg li'));
    await pg.click('[data-i="1"] .sh-sugg li button');
    await drawn(pg);
    cap = await pg.inputValue('#shCap');
    check('who I met: both named in the words, with "@" to tag on LinkedIn', cap.includes('@Dr. Abhijit Gangopadhyay, Dean at Aegis') && cap.includes('@Ravi Connection, CTO at Acme'), cap);

    // a talk: the two Cloud Crane founders are one talk
    await pg.click('[data-kind=talk]');
    const opts = await pg.$$eval('#shTalk option', o => o.map(x => x.value));
    check('a talk: Innovation Talks and the keynote are listed, two founders as one talk', opts.join(',') === 's116,t26,t35', opts.join(','));
    await pg.selectOption('#shTalk', 't35');
    await drawn(pg);
    check('a talk: the topic comes from the programme', await pg.inputValue('#shTopic') === 'The next step of software distribution', await pg.inputValue('#shTopic'));
    await pg.click('[data-plat=x]');
    const xc = await pg.textContent('#shCapCount');
    check('X: the words fit in 280', /^\d+ \/ 280$/.test(xc) && Number(xc.split(' ')[0]) <= 280, xc);
    await pg.selectOption('#shTalk', 's116');
    await drawn(pg);
    check('a keynote titled only "Keynote" takes the speaker\'s topic', await pg.inputValue('#shTopic') === 'AI for Viksit Maharashtra', await pg.inputValue('#shTopic'));

    // a panel, in Story size
    await pg.click('[data-kind=panel]');
    await pg.selectOption('#shPanel', '145');
    await pg.click('[data-size=story]');
    await drawn(pg);
    check('a panel in Story size is 1080x1920', await size(pg) === '1080x1920', await size(pg));
    check('a panel: its own photo is offered first', await pg.getAttribute('#shBgs .sh-bg', 'data-bg') === 'panel', await pg.getAttribute('#shBgs .sh-bg', 'data-bg'));
    await pg.click('[data-plat=instagram]');
    cap = await pg.inputValue('#shCap');
    check('Instagram words: the real handle, every panellist, the moderator', cap.includes('@bharataiinnovation.ai') && cap.includes('Dr. Lakshmi Mohan') && cap.includes('Moderated by Dr. Saurabh N. Mehta'), cap);
    check('the address bar keeps the choice, to share or come back to', (await pg.evaluate(() => location.search)) === '?kind=panel&panel=145', await pg.evaluate(() => location.search));
    await pg.click('#shSave');
    await pg.waitForSelector('.sh-save img', { timeout: 5000 });
    check('Save picture on a phone shows it full screen to press and hold', await pg.isVisible('.sh-save img'), 'overlay');
    await pg.waitForTimeout(400);
    const kinds = steps.map(s => s.kind + '.' + s.step + ' ' + s.reason);
    check('the steps are counted: opened, each picture made, saved', ['moment.open attended', 'moment.made attended', 'moment.made met', 'moment.made talk', 'moment.made panel', 'moment.saved panel instagram'].every(k => kinds.includes(k)), kinds.join(' | '));
    await c2.close();
  } finally {
    check('no script error on the page', !errs.length, errs.join(' | '));
    await browser.close().catch(() => {});
    server.close();
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
