// Logo files the certificate draws (public/js/cert-render.js and the /certificate check
// page), made the way scripts/social/lib.mjs makes them (24 Nov 2026):
//  - bharat-on-dark.png: the Bharat AI Innovation logo without its white background and
//    without the English tagline (the Hindi line in tricolour is drawn under it instead),
//    its dark grey lettering turned cream so it reads on the ink panel;
//  - mark-on-dark.png: the mark alone, for the round seal;
//  - aegis.png: the Aegis School of Data Science and AI logo trimmed to its edges, on a
//    clear background (it sits on the white page).
// Run: node scripts/cert/prep-logos.mjs
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sharp = createRequire(join(REPO, 'package.json'))('sharp');
const OUT = join(REPO, 'public/images/cert');
const { data, info } = await sharp(join(REPO, 'public/images/Bharat AI Innovation Logo.png'))
  .extract({ left: 0, top: 0, width: 900, height: 262 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const make = async (name, markOnly) => {
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], x = (i / 4) % info.width, inMark = x < 268;
    const sat = Math.max(r, g, b) - Math.min(r, g, b), lum = (r + g + b) / 3;
    let R, G, B, A8;
    if (inMark && sat < 14 && lum > 228 && lum < 254.5) { const a = Math.min(1, (255 - lum) / 9); R = G = B = 255; A8 = Math.round(a * 255); }
    else {
      const a = Math.max(255 - r, 255 - g, 255 - b) / 255;
      if (a <= 0.004) { R = G = B = 0; A8 = 0; } else {
        R = (r - (1 - a) * 255) / a; G = (g - (1 - a) * 255) / a; B = (b - (1 - a) * 255) / a; A8 = Math.round(a * 255);
        const usat = Math.max(R, G, B) - Math.min(R, G, B);
        if (!inMark && usat < 40 && Math.max(R, G, B) < 120) { R = 242; G = 237; B = 227; }
      }
    }
    if (markOnly && !inMark) A8 = 0;
    out[i] = Math.max(0, Math.min(255, Math.round(R))); out[i + 1] = Math.max(0, Math.min(255, Math.round(G)));
    out[i + 2] = Math.max(0, Math.min(255, Math.round(B))); out[i + 3] = A8;
  }
  await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).trim({ threshold: 1 }).png({ compressionLevel: 9 }).toFile(join(OUT, name));
};
await make('bharat-on-dark.png', false);
await make('mark-on-dark.png', true);
await sharp(join(REPO, 'public/images/passes/aegis.png')).trim({ threshold: 1 }).png({ compressionLevel: 9 }).toFile(join(OUT, 'aegis.png'));
for (const f of ['bharat-on-dark.png', 'mark-on-dark.png', 'aegis.png']) { const m = await sharp(join(OUT, f)).metadata(); console.log(f, m.width + 'x' + m.height); }
