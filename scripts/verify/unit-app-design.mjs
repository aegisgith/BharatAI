// Unit: the /app design's own rules, read from the files, with no browser and no server. The sheets name
// the website's colours, every movement is behind prefers-reduced-motion, nothing that JS hides can be
// un-hidden by a display rule, the versions agree across the page and the service worker, and the budgets
// that keep the app fast. 6 Nov 2026.
import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
let failed = 0, passed = 0;
const check = (name, ok, detail) => { if (ok) passed++; else failed++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  <- ' + detail)); };

const design = read('public/css/app-design.css');
const motion = read('public/css/app-motion.css');
const script = read('public/js/app-motion.js');
const site = read('public/css/style.css');
const sw = read('public/sw.js');
const src = read('src/index.tsx').replace(/\r\n/g, '\n');
const main = src.slice(src.indexOf('function mainPageHTML'), src.indexOf('function mainPageScript'));
const appScript = src.slice(src.indexOf('function mainPageScript'), src.indexOf('function adminPageHTML'));

// The same colours as the website, or the two drift apart again.
const siteHero = /--grad-hero:\s*linear-gradient\(135deg,\s*#0D0F1E 0%,\s*#1A237E 50%,\s*#0D1B4B 100%\)/.test(site);
check('the website\'s hero gradient is still the one this sheet copies', siteHero, 'style.css --grad-hero changed');
check('the app\'s hero is that gradient', design.includes('--ap-hero: linear-gradient(135deg, #0D0F1E 0%, #1A237E 50%, #0D1B4B 100%)'), 'no --ap-hero');
check('the app\'s bar is the website\'s dark bar colour', design.includes('rgba(13, 15, 30, 0.97)') && /\.navbar\.dark-nav\.scrolled\s*{\s*background:\s*rgba\(13,15,30,0\.97\)/.test(site), 'bar colour differs');
check('the app\'s squares are the website\'s squares', design.includes('background-size: 50px 50px') && /background-size:\s*50px 50px/.test(site), 'grid differs');
check('the bar is the website\'s height once scrolled (66px)', design.includes('--ap-nav-h: 66px') && /\.navbar\.scrolled\s*{[^}]*height:\s*66px/.test(site), 'height differs');
check('headings use the website\'s heading font', /font-family: 'Bricolage Grotesque'/.test(design) && site.includes("--font-display: 'Bricolage Grotesque'"), 'font differs');

// The bug this sheet nearly shipped: a class later in the cascade beats Tailwind's .hidden, so a
// signed-in person saw Register Free. Whatever JS hides must never be given a display here.
const gated = [...main.matchAll(/class="([^"]*\b(?:signed-out-only|signed-in-only)\b[^"]*)"/g)]
  .flatMap((m) => m[1].split(/\s+/)).filter((c) => c.startsWith('ap-'));
check('the elements sign-in hides are known', gated.length >= 3, gated.join(','));
for (const c of new Set(gated)) {
  const rule = new RegExp('\\.' + c + '\\s*\\{[^}]*\\bdisplay\\s*:').test(design) || new RegExp('\\.' + c + '\\s*\\{[^}]*\\bdisplay\\s*:').test(motion);
  check('.' + c + ' never sets display, so .hidden keeps working', !rule, 'has a display rule');
}
check('no rule styles every child of the menu, so the moving mark is not styled as a link', !/\.ap-nav-links\s*>\s*\*/.test(design), 'selector > * found');

// Movement. Everything that runs for ever has to be stoppable and cheap.
const noPref = motion.indexOf('@media (prefers-reduced-motion: no-preference)');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const css = strip(motion);
const anims = [...css.matchAll(/animation(?:-name)?\s*:\s*([^;]+);/g)].map((m) => m.index);
const blockStart = css.indexOf('@media (prefers-reduced-motion: no-preference)');
const blockEnd = css.indexOf('@keyframes ap-drift');
check('every animation sits inside prefers-reduced-motion: no-preference', noPref > 0 && anims.length >= 3 && anims.every((i) => i > blockStart && i < blockEnd), anims.join(','));
const keyframes = [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?\})\s*\}/g)];
check('there are keyframes to check', keyframes.length >= 3, String(keyframes.length));
for (const [, name, body] of keyframes) {
  const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
  check('@keyframes ' + name + ' moves only transform and opacity', props.length > 0 && props.every((p) => p === 'transform' || p === 'opacity'), props.join(','));
}
check('the blur is only for larger screens, so a phone does not pay for it', /@media \(min-width: 768px\)\s*\{\s*\.ap-aurora i \{[^}]*filter: blur/.test(css) && !/^\.ap-aurora i \{[^}]*filter/m.test(css), 'blur outside the media query');
check('what moves is paused off the screen', css.includes('.ap-aurora.ap-off i { animation-play-state: paused; }') && css.includes('.ap-pass.ap-off::before { animation-play-state: paused; }') && script.includes("classList.toggle('ap-off'"), 'no pause');
check('the coloured edge turns a clipped square, so it cannot widen the page', /\.ap-pass \{ overflow: hidden;/.test(css), 'not clipped');
check('the script leaves no globals', /^\/\*[\s\S]*?\*\/\s*\(function \(\) \{/.test(script) && script.trimEnd().endsWith('})();'), 'not wrapped');
check('the script is defer, so it never blocks the page', main.includes('<script src="/js/app-motion.js?v=20261106" defer></script>'), 'not deferred');

// Licences. The free Skiper UI licence asks for a credit; Vengeance UI is MIT.
check('the motion sheet carries the MIT notice and names both libraries', motion.includes('MIT License') && motion.includes('Copyright (c) 2025-2026 Ashutoshx7') && motion.includes('skiper-ui.com'), 'notice missing');
check('the app\'s footer credits both', main.includes('href="https://skiper-ui.com"') && main.includes('href="https://github.com/Ashutoshx7/VengeanceUI"'), 'credit missing');

// The picture has to live in a media query, or a phone downloads it.
const beforeMq = design.slice(0, design.indexOf('@media (min-width: 1024px)'));
check('the hero picture is only named inside the 1024px rule', !beforeMq.includes('/images/gallery/') && design.includes("url('/images/gallery/7C2A3159.webp')") && !main.includes('7C2A3159'), 'named elsewhere');
check('the picture is on disk', existsSync(join(ROOT, 'public/images/gallery/7C2A3159.webp')), 'missing');

// Versions: a hand-written file under one ?v= everywhere (handbook rule 9).
for (const [file, tag] of [['/css/app-design.css', 'link'], ['/css/app-motion.css', 'link'], ['/js/app-motion.js', 'script']]) {
  const v = new RegExp(file.replace(/[.\/]/g, '\\$&') + '\\?v=([\\w.]+)');
  const inPage = v.exec(main), inSw = v.exec(sw);
  check(file + ' (' + tag + ') has the same ?v= in the page and the service worker', !!inPage && !!inSw && inPage[1] === inSw[1], (inPage || [])[1] + ' / ' + (inSw || [])[1]);
}
const swVersion = /const VERSION = 'bhai-v(\d+)'/.exec(sw);
check('the service worker moved on so a returning phone gets the new files', !!swVersion && +swVersion[1] >= 29, swVersion && swVersion[0]);
const order = ['${TW_CSS}', '/css/app-design.css', '/css/app-motion.css'].map((x) => main.indexOf(x));
check('the sheets load after Tailwind, design then motion', order.every((n) => n > 0) && order[0] < order[1] && order[1] < order[2], order.join(','));

// The speed budget. Numbers are what a phone downloads, compressed.
const gz = (s) => gzipSync(Buffer.from(s)).length;
for (const [name, text, max] of [['app-design.css', design, 6500], ['app-motion.css', motion, 3200], ['app-motion.js', script, 1300]]) {
  check(name + ' stays under ' + max + ' bytes compressed (' + gz(text) + ')', gz(text) <= max, String(gz(text)));
}
check('the old drawn globe is gone from the page, which more than pays for the footer', !main.includes('id="glb"') && !main.includes('blur-[140px]'), 'still there');

// The word.
for (const [what, needle] of [
  ['phone tab', '<span>Conference Schedule</span>'],
  ['laptop tab', 'onclick="switchTab(\'schedule\')">Conference Schedule</button>'],
  ['tab heading', '>Conference</span></span> <span class="ap-w"><span class="ap-hl" style="--i:1;">Schedule</span>'],
  ['home column', '<i class="fas fa-calendar-day text-primary-400 mr-2"></i>Conference Schedule</h2>'],
]) check('"Conference Schedule" on the ' + what, main.includes(needle), needle);
check('the menu on the other worker pages says it too', src.includes("pill('/app#schedule', 'Conference Schedule', 'schedule')"), 'pill');
check('no bare "Schedule" names this tab any more', !/>Schedule<\/(?:button|a|div|h2)>/.test(main) && !main.includes('<span>Schedule</span>') && !appScript.includes("A('Schedule',"), 'found one');
check('"Event Schedule" is gone from the app', !main.includes('Event Schedule'), 'found');

// The two behaviour fixes.
check('switchTab marks every button for the tab, not just the first (the phone\'s)', appScript.includes('document.querySelectorAll(\\`.nav-btn[data-tab="\\${tab}"]\\`)') && !appScript.includes('const tabBtn = document.querySelector(\\`[data-tab='), 'still querySelector');
check('"All halls" prints its name on a wider screen', appScript.includes('${h.key || h.short}'), 'still h.key');

// Handbook rule 2: this literal eats a backslash-quote, and the whole page script dies.
check('no backslash-quote anywhere in the page literal', !main.includes("\\'"), 'found one');
check('no backslash-quote in what this design added to the script', !/heroBand\.classList\.toggle\(\\'/.test(appScript), 'found one');

console.log(`\nunit-app-design: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
