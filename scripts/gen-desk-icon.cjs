// Draws the Badge Desk home-screen icon (public/images/icon-desk-192.png and -512.png).
// Same family as the attendee app's icon (the B on an orange glow), inside a scanner
// frame with the word DESK, so the two can be told apart on one phone. Everything sits
// inside the middle 80% of the square, so Android can crop it to a circle (maskable).
// Run:  node scripts/gen-desk-icon.cjs
const path = require('path');
const { chromium } = require('./verify/playwright.cjs');

const html = (size) => `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden}
  .tile{position:relative;width:100%;height:100%;background:
    radial-gradient(circle at 30% 22%, rgba(255,107,0,.95) 0%, rgba(255,107,0,.45) 22%, rgba(255,107,0,0) 52%),
    linear-gradient(160deg,#16193f 0%,#0a0e1f 70%);
    font-family:Arial Black,Arial,Helvetica,sans-serif}
  .frame{position:absolute;left:50%;top:44%;width:46%;height:46%;transform:translate(-50%,-50%)}
  .c{position:absolute;width:30%;height:30%;border:${size * 0.035}px solid #fff}
  .tl{left:0;top:0;border-right:0;border-bottom:0;border-top-left-radius:${size * 0.07}px}
  .tr{right:0;top:0;border-left:0;border-bottom:0;border-top-right-radius:${size * 0.07}px}
  .bl{left:0;bottom:0;border-right:0;border-top:0;border-bottom-left-radius:${size * 0.07}px}
  .br{right:0;bottom:0;border-left:0;border-top:0;border-bottom-right-radius:${size * 0.07}px}
  .b{position:absolute;left:0;top:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;
     color:#FFD2AE;font-weight:900;font-size:${size * 0.3}px;line-height:1}
  .word{position:absolute;left:0;right:0;top:73%;text-align:center;color:#fff;font-weight:900;
     font-size:${size * 0.098}px;letter-spacing:${size * 0.018}px;padding-left:${size * 0.018}px}
</style></head><body><div class="tile">
  <div class="frame"><span class="c tl"></span><span class="c tr"></span><span class="c bl"></span><span class="c br"></span><div class="b">B</div></div>
  <div class="word">DESK</div>
</div></body></html>`;

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const size of [192, 512]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(html(size));
    const out = path.join(__dirname, '..', 'public', 'images', 'icon-desk-' + size + '.png');
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
    console.log('wrote ' + out);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
