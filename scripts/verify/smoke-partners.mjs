// The partners block through the real worker (after npm run build): an admin email
// preview shows it, the email Elastic Email is sent carries it once, the photo album page
// and the pages the worker draws show it, and the app gets the seven with Powered by.
//   node scripts/verify/smoke-partners.mjs
import { createHmac } from 'node:crypto';
import { talksWorld, checker, ADMIN } from './talks-world.mjs';

const W = await talksWorld({ times: true });
const { db, sent, hit, as, fetchRaw, read } = W;
const { check, done } = checker();
const MARK = 'data-partners-block';
const count = (s) => String(s || '').split(MARK).length - 1;

const DATA = JSON.parse(read('src/data/speaker-photos.json'));
const A = DATA.people.find(p => p.speakers.length && p.photos.length >= 3 && !p.check);
db.run('INSERT INTO speakers (id, event_id, slug, name, role, organisation, email, is_published) VALUES (?, 1, ?, ?, ?, ?, ?, 1)',
  [A.speakers[0], 'sp-' + A.speakers[0], 'Dr. ' + A.name.replace(/^(Dr\.?|Shri|Mr\.?|Ms\.?)\s+/i, ''), 'Founder', 'Example Co', 'partners.check@example.com']);

// An admin preview: the same block the sent email will carry, and the greeting with the title.
const p = await as('GET', `/api/admin/speaker-photos/${A.key}/preview`);
check('an admin email preview shows Powered by IDFC FIRST Bank and the partners, once', p.status === 200 && count(p.json?.html) === 1 && p.json.html.includes('alt="IDFC FIRST Bank"') && p.json.html.includes('alt="Jade Global"'), p.status);
check('...and greets "Dear Dr. <first name>,"', /Dear Dr\. [A-Z][a-z]+,/.test(p.json?.html || ''), (p.json?.html || '').match(/Dear [^<]{0,40}/)?.[0]);

// The send: what reaches Elastic Email.
const s = await as('POST', `/api/admin/speaker-photos/${A.key}/send`, {});
const body = sent.at(-1)?.Content?.Body?.[0]?.Content || '';
check('the email sent to Elastic Email carries the block exactly once', s.status === 200 && count(body) === 1, s.status + ' ' + count(body));
check('...above the unsubscribe line when it has one', !/unsubscribe/i.test(body) || body.indexOf(MARK) < body.toLowerCase().lastIndexOf('unsubscribe'));
check('...with PNG logos on the live site', /src="https:\/\/bharataiinnovation\.com\/images\/email\/partners\/idfc-first-bank\.png"/.test(body) && !/partners\/[a-z-]+\.webp/.test(body));

// Pages the worker draws.
const sig = createHmac('sha256', ADMIN).update('photos:' + A.key).digest('hex').slice(0, 32);
const album = await (await fetchRaw(new Request(`https://bharataiinnovation.com/photos/${A.key}?k=${sig}`))).text();
check('the photo album page shows the partners once, after its scripts', count(album) === 1 && album.indexOf(MARK) > album.lastIndexOf('<script'));
for (const path of ['/contact', '/inquiry']) {
  const r = await hit('GET', path);
  check(`${path} shows the partners once, above the footer`, r.status === 200 && count(r.text) === 1 && r.text.indexOf(MARK) < r.text.indexOf('<footer'), r.status + ' ' + count(r.text));
}

// The app and the exhibitor dashboard read this.
const ap = await hit('GET', '/api/app-partners');
check('the app gets the seven partners and Powered by IDFC FIRST Bank', ap.status === 200 && ap.json?.partners?.length === 7 && ap.json?.powered_by?.name === 'IDFC FIRST Bank' && ap.json?.powered_by?.edition === 'Mumbai 2026', ap.text.slice(0, 200));
const app = await hit('GET', '/app');
check('the app page has the Powered-by slot on Home', app.status === 200 && (app.text.includes('id="app-powered"') || read('src/index.tsx').includes('id="app-powered"')));

done();
