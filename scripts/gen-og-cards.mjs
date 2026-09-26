// Link-preview cards: one 1200x630 JPG per page in public/images/og/, the
// picture WhatsApp, LinkedIn, X and Slack show when someone pastes a link.
//
//   node scripts/gen-og-cards.mjs            # every card
//   node scripts/gen-og-cards.mjs home partner   # just these
//
// Edit the copy in CARDS below and re-run; the page heads point at
// /images/og/<slug>.jpg and never need touching. After changing a card that is
// already live, expect WhatsApp and LinkedIn to keep showing the old picture
// for a while: they cache per URL. Facebook's Sharing Debugger (Scrape Again)
// refreshes Meta's copy, which WhatsApp shares.
//
// Rules the copy follows (docs/PROJECT-HANDBOOK.md): B2B framing, not
// footfall; no "largest"; no government-backing claim; pass and booth prices
// carry "+ GST". Keep a headline to two lines and the sub-line to three.
//
// Rendering uses the repo's playwright-core shim with Edge (no browser
// download). WhatsApp drops images much above 300 KB, so every card is checked.

import { createRequire } from 'node:module'
import { mkdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const require = createRequire(import.meta.url)
const { chromium } = require('./verify/playwright.cjs')

const OUT = 'public/images/og'
const MAX_BYTES = 300 * 1024
const WHEN = '20–21 Nov 2026'
const WHERE = 'WTC Mumbai'

// accent: the part of the headline painted in the site's sunset gradient.
export const CARDS = {
  home: {
    path: '',
    label: 'Conference · Exhibition · Business meetings',
    headline: "India's B2B platform for AI",
    accent: 'for AI',
    sub: 'The organisations running AI in production, the companies providing it and the policymakers shaping it. Two days at World Trade Center Mumbai.',
    chips: ['Enterprise buyers', 'AI builders', 'Policymakers'],
  },
  conference: {
    path: '/conference',
    label: 'Conference',
    headline: 'Two days. Five halls. 10+ tracks.',
    accent: '10+ tracks.',
    sub: 'Generative AI, LLMs, agentic AI and AI governance, plus AI for BFSI, healthcare, manufacturing, agriculture and retail.',
    chips: ['CXO panels', 'Innovation Stage', '09:00–18:00 IST'],
  },
  exhibition: {
    path: '/exhibition',
    label: 'Exhibition',
    headline: '93 booths. 8 industry zones.',
    accent: '8 industry zones.',
    sub: 'Show your AI to enterprise buyers, government departments and investors on the exhibition floor.',
    chips: ['Startup Pod from ₹48,000 + GST', 'Innovation Stage talks'],
  },
  partner: {
    path: '/partner',
    label: 'Partnership & Sponsorship',
    headline: 'Put your brand in front of AI buyers',
    accent: 'AI buyers',
    sub: 'CIOs, CTOs, government decision-makers and funded founders: the people who approve enterprise AI spending, in one room for two days.',
    chips: ['Title · Powered · Associate', 'AI Leadership Panels'],
  },
  about: {
    path: '/about',
    label: 'About',
    headline: "Accelerating India's AI revolution",
    accent: 'AI revolution',
    sub: "Bharat AI Innovation is India's B2B AI conference and exhibition, organised by Aegis Knowledge Trust.",
    chips: ['Organised by Aegis Knowledge Trust'],
  },
  'ai-readiness': {
    path: '/ai-readiness',
    label: 'Aegis Graham Bell Awards · AI Readiness',
    headline: 'How AI-ready is your organisation?',
    accent: 'AI-ready',
    sub: "An independent AI-maturity rating, mapped to ISO/IEC 42001, the NIST AI RMF, the EU AI Act and India's DPDP Act.",
    chips: ['6 pillars', '25 metrics', 'Assessor-verified'],
  },
  'training-workshop': {
    path: '/training-workshop',
    label: 'Training Workshops',
    headline: 'Build real AI applications, hands-on',
    accent: 'hands-on',
    sub: 'Workshops led by practitioners on generative AI, agentic AI, LLM fine-tuning, RAG and prompt engineering.',
    chips: ['Generative AI', 'Agentic AI', 'RAG'],
  },
  'startup-pitch': {
    path: '/startup-pitch',
    label: 'Startup Pitch',
    headline: 'Pitch your AI startup to investors',
    accent: 'to investors',
    sub: 'Present to VCs, corporate venture arms and industry leaders at Bharat AI Innovation 2026.',
    chips: ['VCs', 'Corporate venture arms'],
  },
  accommodation: {
    path: '/accommodation',
    label: 'Hotels & Accommodation',
    headline: 'Stay minutes from WTC Mumbai',
    accent: 'WTC Mumbai',
    sub: 'Hotels in Cuffe Parade, Colaba and Marine Drive for attendees and exhibitors at Bharat AI Innovation 2026.',
    chips: ['Cuffe Parade', 'Colaba', 'Marine Drive'],
  },
  'past-speakers': {
    path: '/past-speakers',
    label: 'Data Science Congress archive',
    headline: 'The stage before this one',
    accent: 'this one',
    sub: "91+ leaders who have shaped India's data science and AI conversation, from Union Ministers to chief data scientists.",
    chips: ['91+ past speakers', 'Data Science Congress'],
  },
  'campus-series': {
    path: '/campus-series',
    label: 'Campus Series',
    headline: 'AI and Employability, on campus',
    accent: 'on campus',
    sub: 'Free pre-event panel discussions at universities across India, on the road to WTC Mumbai.',
    chips: ['Mumbai · 21 Sep', 'New Delhi · 30 Sep'],
  },
  register: {
    path: '/register',
    label: 'Register',
    headline: 'Get your free Visitor Pass',
    accent: 'free Visitor Pass',
    sub: 'Register in 30 seconds. Choose a Delegate or VIP pass for networking and 1:1 business meetings.',
    chips: ['Free Visitor Pass', 'Delegate', 'VIP'],
  },
  contact: {
    path: '/contact',
    label: 'Contact',
    headline: 'Talk to the Bharat AI Innovation team',
    accent: 'team',
    sub: 'Registration, sponsorship, exhibition and press enquiries.',
    chips: ['Sponsorship', 'Exhibition', 'Press'],
  },
  inquiry: {
    path: '/inquiry',
    label: 'Exhibit',
    headline: 'Book your booth',
    accent: 'booth',
    sub: '93 booths across 8 industry zones, in front of enterprise buyers, government departments and investors.',
    chips: ['Startup Pod from ₹48,000 + GST'],
  },
  marketplace: {
    path: '/marketplace',
    label: 'Bharat AI Marketplace',
    headline: "Discover India's AI solutions",
    accent: 'AI solutions',
    sub: 'Browse, compare and connect with the AI products and companies at Bharat AI Innovation 2026.',
    chips: ['AI products', 'Companies', 'Direct enquiries'],
  },
  app: {
    path: '/app',
    label: 'Bharat AI Innovation app',
    headline: 'Your pass, schedule and meetings',
    accent: 'meetings',
    sub: 'The schedule, the attendee and exhibitor directory, and your pass, in one app.',
    chips: ['Schedule', 'Directory', 'Your pass'],
  },
  'code-of-conduct': {
    path: '/code-of-conduct',
    label: 'Policy',
    headline: 'Code of Conduct',
    accent: 'Conduct',
    sub: 'Expected behaviour, unacceptable behaviour and how to report a concern at Bharat AI Innovation 2026.',
    chips: ['Bharat AI Innovation 2026'],
  },
  privacy: {
    path: '/privacy',
    label: 'Policy',
    headline: 'Privacy Policy',
    accent: 'Privacy',
    sub: "What data we collect, how we use it, and your rights under India's DPDP Act 2023.",
    chips: ['Bharat AI Innovation 2026'],
  },
  refund: {
    path: '/refund',
    label: 'Policy',
    headline: 'Refund & Cancellation Policy',
    accent: 'Refund',
    sub: 'Transfer rules, the refund schedule and cancellation terms for Bharat AI Innovation 2026 passes.',
    chips: ['Bharat AI Innovation 2026'],
  },
  shipping: {
    path: '/shipping',
    label: 'Policy',
    headline: 'Shipping & Delivery Policy',
    accent: 'Delivery',
    sub: 'How passes, invoices and exhibitor entitlements are delivered, and badge collection at WTC Mumbai.',
    chips: ['Bharat AI Innovation 2026'],
  },
  terms: {
    path: '/terms',
    label: 'Policy',
    headline: 'Terms of Service',
    accent: 'Terms',
    sub: 'The terms for registering for and attending Bharat AI Innovation Conference & Exhibition 2026.',
    chips: ['Bharat AI Innovation 2026'],
  },
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function headlineHTML({ headline, accent }) {
  const i = accent ? headline.lastIndexOf(accent) : -1
  if (i < 0) return esc(headline)
  return esc(headline.slice(0, i)) + '<span class="accent">' + esc(accent) + '</span>' + esc(headline.slice(i + accent.length))
}

// The logo file carries a tagline under the wordmark; crop to the mark and
// wordmark, trim the white margin, and inline it so the page needs no server.
async function logoDataURI() {
  const src = 'public/images/Bharat AI Innovation Logo.png'
  const cropped = await sharp(src).extract({ left: 0, top: 0, width: 900, height: 262 }).png().toBuffer()
  const buf = await sharp(cropped).trim({ background: '#ffffff', threshold: 20 }).png().toBuffer()
  return 'data:image/png;base64,' + buf.toString('base64')
}

function cardHTML(card, logo) {
  const url = 'bharataiinnovation.com' + card.path
  const long = card.headline.length > 30
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Manrope:wght@500;600;700&display=block" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1200px;height:630px;overflow:hidden}
body{font-family:'Manrope',sans-serif;color:#fff;background:#0D0F1E;position:relative}
.bg{position:absolute;inset:0;
  background:
    radial-gradient(620px 420px at 1040px 40px, rgba(255,107,0,.34), transparent 70%),
    radial-gradient(560px 460px at 80px 640px, rgba(57,73,171,.55), transparent 70%),
    radial-gradient(420px 320px at 760px 600px, rgba(200,80,192,.20), transparent 70%),
    linear-gradient(135deg,#0D0F1E 0%,#131849 55%,#0D1B4B 100%)}
.grid{position:absolute;inset:0;opacity:.13;
  background-image:radial-gradient(circle at 1px 1px,#fff 1.2px,transparent 1.6px);background-size:34px 34px;
  -webkit-mask-image:linear-gradient(100deg,transparent 0%,transparent 45%,#000 80%);mask-image:linear-gradient(100deg,transparent 0%,transparent 45%,#000 80%)}
.wrap{position:absolute;inset:0;padding:54px 72px 58px;display:flex;flex-direction:column}
.top{display:flex;align-items:center;justify-content:space-between}
.logo{background:#fff;border-radius:18px;padding:12px 20px;display:flex;align-items:center;box-shadow:0 8px 30px rgba(0,0,0,.35)}
.logo img{height:62px;width:auto;display:block}
.when{font-weight:700;font-size:21px;letter-spacing:.14em;text-transform:uppercase;color:#FFB27A;
  border:1.5px solid rgba(255,140,56,.45);border-radius:999px;padding:11px 22px;background:rgba(255,107,0,.08)}
.main{margin-top:auto;margin-bottom:auto;padding-top:14px}
.label{font-weight:700;font-size:21px;letter-spacing:.16em;text-transform:uppercase;color:#FF8C38;margin-bottom:14px}
h1{font-family:'Bricolage Grotesque',sans-serif;font-weight:800;letter-spacing:-.03em;line-height:1.0;
  font-size:${long ? 70 : 78}px;max-width:1040px}
.accent{background:linear-gradient(120deg,#FF6B00 0%,#FF8C38 30%,#FF6B6B 70%,#C850C0 100%);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent}
.sub{margin-top:20px;font-size:27px;line-height:1.38;color:#CDD1EA;font-weight:500;max-width:1000px}
.bottom{display:flex;align-items:center;justify-content:space-between;gap:24px}
.chips{display:flex;gap:12px;flex-wrap:nowrap;min-width:0}
.chip{font-size:20px;font-weight:600;color:#E6E8F5;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);
  border-radius:999px;padding:10px 18px;white-space:nowrap}
.url{flex-shrink:0;font-weight:700;font-size:22px;color:#fff;border-radius:999px;padding:12px 24px;
  background:linear-gradient(135deg,#FF6B00,#FF8C38);box-shadow:0 8px 28px rgba(255,107,0,.35);white-space:nowrap}
.flag{position:absolute;left:0;right:0;bottom:0;height:8px;display:flex}
.flag i{flex:1}.flag i:nth-child(1){background:#FF9933}.flag i:nth-child(2){background:#FFFFFF}.flag i:nth-child(3){background:#138808}
</style></head><body>
<div class="bg"></div><div class="grid"></div>
<div class="wrap">
  <div class="top">
    <div class="logo"><img src="${logo}" alt=""></div>
    <div class="when">${esc(WHEN)} · ${esc(WHERE)}</div>
  </div>
  <div class="main">
    <div class="label">${esc(card.label)}</div>
    <h1>${headlineHTML(card)}</h1>
    <p class="sub">${esc(card.sub)}</p>
  </div>
  <div class="bottom">
    <div class="chips">${card.chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>
    <div class="url">${esc(url)}</div>
  </div>
</div>
<div class="flag"><i></i><i></i><i></i></div>
</body></html>`
}

// Imported (for the alt text and page list) it only exports CARDS.
if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] || '')) await main()

async function main() {
const only = process.argv.slice(2)
const slugs = only.length ? only : Object.keys(CARDS)
for (const s of slugs) if (!CARDS[s]) { console.error(`unknown card: ${s}`); process.exit(1) }

mkdirSync(OUT, { recursive: true })
const logo = await logoDataURI()
const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
let failed = 0
for (const slug of slugs) {
  const card = CARDS[slug]
  await page.setContent(cardHTML(card, logo), { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  // Nothing may spill: a headline over two lines or chips wider than the row
  // would be cut off in the picture without any error.
  const fit = await page.evaluate(() => {
    const h1 = document.querySelector('h1')
    const lines = Math.round(h1.getBoundingClientRect().height / parseFloat(getComputedStyle(h1).lineHeight))
    const sub = document.querySelector('.sub')
    const subLines = Math.round(sub.getBoundingClientRect().height / parseFloat(getComputedStyle(sub).lineHeight))
    const bottom = document.querySelector('.bottom')
    const chips = document.querySelector('.chips')
    const main = document.querySelector('.main').getBoundingClientRect()
    const top = document.querySelector('.top').getBoundingClientRect()
    const bot = bottom.getBoundingClientRect()
    return { lines, subLines, chipsOverflow: chips.scrollWidth > chips.clientWidth + 1, overlap: main.top < top.bottom || main.bottom > bot.top }
  })
  const file = join(OUT, `${slug}.jpg`)
  const png = await page.screenshot({ type: 'png' })
  await sharp(png).jpeg({ quality: 84, mozjpeg: true, chromaSubsampling: '4:4:4' }).toFile(file)
  const bytes = statSync(file).size
  const problems = []
  if (fit.lines > 2) problems.push(`headline ${fit.lines} lines`)
  if (fit.subLines > 3) problems.push(`sub-line ${fit.subLines} lines`)
  if (fit.chipsOverflow) problems.push('chips overflow')
  if (fit.overlap) problems.push('text overlaps header/footer')
  if (bytes > MAX_BYTES) problems.push(`${Math.round(bytes / 1024)} KB > 300 KB`)
  if (problems.length) failed++
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${file}  ${Math.round(bytes / 1024)} KB${problems.length ? '  ' + problems.join(', ') : ''}`)
}
await browser.close()
if (failed) { console.error(`${failed} card(s) need shorter copy`); process.exit(1) }
}
