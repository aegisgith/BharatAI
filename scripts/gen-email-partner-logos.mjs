// The partner logos for EMAIL: PNG (Outlook on Windows cannot show WebP), each on the
// same 240 x 120 tile (shown at 120 x 60), so the grid under every email is even.
// White tiles; a logo drawn on black (dark: true) keeps a black tile. The IDFC FIRST Bank
// "Powered by" logo keeps its own maroon plate, 360 px wide (shown at 180).
//
//   node scripts/gen-email-partner-logos.mjs
//
// Reads src/data/partners.json; writes public/images/email/partners/*.png.
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = JSON.parse(readFileSync(join(ROOT, 'src/data/partners.json'), 'utf8'))
const pub = (p) => join(ROOT, 'public', p.replace(/^\//, ''))

mkdirSync(pub('/images/email/partners'), { recursive: true })

const W = 240, H = 120, PAD_X = 22, PAD_Y = 20
for (const p of DATA.partners) {
  const bg = p.dark ? { r: 0, g: 0, b: 0, alpha: 1 } : { r: 255, g: 255, b: 255, alpha: 1 }
  const logo = await sharp(pub(p.logo)).flatten({ background: bg })
    .resize(W - 2 * PAD_X, H - 2 * PAD_Y, { fit: 'inside', withoutEnlargement: false }).png().toBuffer()
  const m = await sharp(logo).metadata()
  await sharp({ create: { width: W, height: H, channels: 4, background: bg } })
    .composite([{ input: logo, left: Math.round((W - m.width) / 2), top: Math.round((H - m.height) / 2) }])
    .flatten({ background: bg }).png({ compressionLevel: 9 })
    .toFile(pub(p.email_logo))
  console.log('wrote', p.email_logo, `${m.width}x${m.height} inside ${W}x${H}`)
}

const pb = DATA.powered_by
await sharp(pub(pb.logo)).resize({ width: 360 }).png({ compressionLevel: 9 }).toFile(pub(pb.email_logo))
console.log('wrote', pb.email_logo)
