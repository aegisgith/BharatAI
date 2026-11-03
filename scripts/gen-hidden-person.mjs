// The stand-in pictures the networking email draws where a person's photo would go
// (organiser, 3 Nov 2026: no real faces in a mass email). A soft, blurred head and
// shoulders in three tints, nobody's photo. Writes public/images/email/person-hidden-<n>.png
// at 120 px (shown at 40 px), with the corners transparent so mail apps that ignore
// border-radius still show a circle.
// Usage: node scripts/gen-hidden-person.mjs
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const pw = require('./verify/playwright.cjs');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const TINTS = [
  ['#FFE6D2', '#F0A36C'], // orange
  ['#D4EFEC', '#6FBAB3'], // teal
  ['#DEE1F8', '#8E97E0'], // indigo
];
const browser = await pw.chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 200, height: 200 }, deviceScaleFactor: 1 });
for (const [i, [bg, fg]] of TINTS.entries()) {
  await page.setContent(`<html><body style="margin:0;background:transparent;">
    <div id="p" style="width:120px;height:120px;border-radius:50%;overflow:hidden;background:${bg};position:relative;">
      <div style="position:absolute;inset:-12px;filter:blur(6px);">
        <div style="position:absolute;left:46px;top:30px;width:52px;height:52px;border-radius:50%;background:${fg};"></div>
        <div style="position:absolute;left:24px;top:92px;width:96px;height:80px;border-radius:48px 48px 0 0;background:${fg};"></div>
      </div>
    </div></body></html>`);
  const out = path.join(root, 'public', 'images', 'email', `person-hidden-${i + 1}.png`);
  await page.locator('#p').screenshot({ path: out, omitBackground: true });
  console.log('wrote', path.relative(root, out));
}
await browser.close();
