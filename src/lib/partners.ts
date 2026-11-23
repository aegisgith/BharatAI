// ==================== OUR PARTNERS, EVERYWHERE (23 Nov 2026) ====================
// The organiser: "in all emails going out put logos of all the partners and put Powered
// by IDFC FIRST Bank. Sponsors need to see the post event visibility on all emails and
// all landing pages, inside the dashboard as well of each user, each delegate when they
// login into account. Maximum visibility so they come back as sponsors."
//
// One list, src/data/partners.json (the home page strip's names, labels and order),
// drawn three ways:
//  - partnersEmailHTML(): tables and PNG logos for mail; withPartners() puts it once
//    before the end of every email (elasticFetch() in index.tsx calls it for every
//    send to Elastic Email, so no sender can leave it out).
//  - partnersStripHTML(): the site block above the footer (scripts/gen-partners-strip.mjs
//    writes it into public/*.html) and on the pages the worker draws.
//  - defaultAppPartners(): the app's Home tab and the exhibitor dashboard when the
//    organisers have not typed their own list in Marketplace admin.
import DATA from '../data/partners.json'

export type Partner = { name: string; label: string; logo: string; email_logo: string; dark?: boolean }
export const PARTNERS: Partner[] = (DATA as any).partners
export const POWERED_BY: { name: string; logo: string; email_logo: string } = (DATA as any).powered_by
export const PARTNERS_EDITION: string = (DATA as any).edition || 'Mumbai 2026'
export const PARTNERS_MARK = 'data-partners-block'

const SITE = 'https://bharataiinnovation.com'
const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ---------- email ----------
export function partnersEmailHTML(origin = SITE): string {
  const font = 'font-family:Arial,Helvetica,sans-serif;'
  const cap = (t: string, extra = '') => `<p style="margin:0;font-size:11px;line-height:1.4;font-weight:bold;letter-spacing:2px;color:#6B7080;text-transform:uppercase;${font}${extra}">${t}</p>`
  const cell = (p: Partner, w: string) => `<td width="${w}" align="center" valign="top" style="padding:6px 4px 10px;">
          <img src="${esc(origin + p.email_logo)}" width="120" height="60" alt="${esc(p.name)}" style="display:block;margin:0 auto;width:120px;max-width:100%;height:auto;border:1px solid #E3E6EF;border-radius:8px;">
          <p style="margin:6px 0 0;font-size:9px;line-height:1.3;font-weight:bold;letter-spacing:0.6px;color:#3B3F8F;text-transform:uppercase;${font}">${esc(p.label)}</p>
        </td>`
  // Four a row, the rest centred under them.
  const rows: string[] = []
  for (let i = 0; i < PARTNERS.length; i += 4) {
    const row = PARTNERS.slice(i, i + 4)
    const pct = row.length * 25
    rows.push(`<table role="presentation" width="${pct}%" align="center" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 auto;"><tr>${row.map(p => cell(p, Math.floor(100 / row.length) + '%')).join('')}</tr></table>`)
  }
  return `<table role="presentation" ${PARTNERS_MARK}="1" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
  <tr><td align="center" style="padding:8px 12px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;border-collapse:separate;background:#ffffff;border:1px solid #E3E6EF;border-radius:12px;">
      <tr><td align="center" style="padding:20px 16px 4px;">
        ${cap('Bharat AI Innovation ' + esc(PARTNERS_EDITION) + ' &middot; Powered by')}
        <img src="${esc(origin + POWERED_BY.email_logo)}" width="180" alt="${esc(POWERED_BY.name)}" style="display:block;margin:10px auto 0;width:180px;max-width:70%;height:auto;border:0;border-radius:6px;">
      </td></tr>
      <tr><td align="center" style="padding:18px 16px 6px;">${cap('Our partners')}</td></tr>
      <tr><td style="padding:2px 8px 12px;">${rows.join('')}</td></tr>
    </table>
  </td></tr>
</table>`
}

// Before the last </body>, or at the end of a fragment.
function beforeBodyEnd(html: string, piece: string): string {
  const i = html.toLowerCase().lastIndexOf('</body>')
  return i < 0 ? html + piece : html.slice(0, i) + piece + html.slice(i)
}
// Once per email: a second pass (a resend, a preview sent on) leaves it as it is.
export function withPartners(html: string, origin = SITE): string {
  const s = String(html ?? '')
  if (!s.trim() || s.includes(PARTNERS_MARK)) return s
  return beforeBodyEnd(s, partnersEmailHTML(origin))
}
// The body Elastic Email is sent (v4 transactional: Content.Body[] parts), with the block
// in every HTML part. Anything it cannot read goes on unchanged: a partner block must
// never stop an email.
export function elasticBodyWithPartners(body: any): any {
  if (typeof body !== 'string') return body
  try {
    const o = JSON.parse(body)
    const parts = o && o.Content && o.Content.Body
    if (!Array.isArray(parts)) return body
    let changed = false
    for (const p of parts) {
      if (p && String(p.ContentType || '').toUpperCase() === 'HTML' && typeof p.Content === 'string') {
        const next = withPartners(p.Content)
        if (next !== p.Content) { p.Content = next; changed = true }
      }
    }
    return changed ? JSON.stringify(o) : body
  } catch { return body }
}

// ---------- the site ----------
// Self-contained (its own <style>, class names pstrip-*), light ground, white tiles like
// the home page strip: seven in one row from 1024 px, four a row on a tablet, two on a
// phone, the odd last one centred.
export const PARTNERS_STRIP_CSS = `.pstrip,.pstrip *{box-sizing:border-box}
.pstrip{background:#F6F7FB;border-top:1px solid #E6E8F0;padding:44px 16px 48px;font-family:inherit}
.pstrip-in{max-width:1200px;margin:0 auto;text-align:center}
.pstrip-cap{margin:0;font-size:12px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#5B6078}
.pstrip-powered{display:flex;align-items:center;justify-content:center;gap:14px;flex-wrap:wrap;margin:0 0 30px}
.pstrip-powered img{height:56px;width:auto;border-radius:8px;display:block}
.pstrip-list{list-style:none;margin:16px 0 0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.pstrip-list li{background:#fff;border:1px solid #E3E6EF;border-radius:14px;padding:14px 10px 12px;display:flex;flex-direction:column;align-items:center;justify-content:space-between;gap:10px;min-height:118px;min-width:0;overflow:hidden}
.pstrip-list li.pstrip-dark{background:#05060a;border-color:#05060a}
.pstrip-list li.pstrip-dark .pstrip-role{color:#C9CCE0}
.pstrip-list img{max-height:52px;max-width:100%;width:auto;height:auto;object-fit:contain;display:block;margin:auto 0}
.pstrip-role{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#3B3F8F;line-height:1.3}
.pstrip-list li:last-child:nth-child(odd){grid-column:1/-1;max-width:calc(50% - 6px);width:100%;justify-self:center}
@media (min-width:640px){.pstrip-list{grid-template-columns:repeat(4,minmax(0,1fr))}.pstrip-list li:last-child:nth-child(odd){grid-column:auto;max-width:none}}
@media (min-width:1024px){.pstrip-list{grid-template-columns:repeat(${PARTNERS.length},minmax(0,1fr))}}`

// `root`: '' for a page at the site root that writes relative paths ("images/..."), '/' for
// pages the worker draws at any depth.
export function partnersStripHTML(root = '/'): string {
  const src = (p: string) => esc(root === '/' ? p : p.replace(/^\//, ''))
  const tiles = PARTNERS.map(p => `<li${p.dark ? ' class="pstrip-dark"' : ''}><img src="${src(p.logo)}" alt="${esc(p.name)}" loading="lazy" decoding="async"><span class="pstrip-role">${esc(p.label)}</span></li>`).join('')
  return `<section class="pstrip" ${PARTNERS_MARK}="1" aria-label="Partners of Bharat AI Innovation ${esc(PARTNERS_EDITION)}">
<style>${PARTNERS_STRIP_CSS}</style>
<div class="pstrip-in">
<div class="pstrip-powered"><span class="pstrip-cap">Bharat AI Innovation ${esc(PARTNERS_EDITION)} &middot; Powered by</span><img src="${src(POWERED_BY.logo)}" alt="${esc(POWERED_BY.name)}" width="169" height="56" loading="lazy" decoding="async"></div>
<p class="pstrip-cap">Our partners</p>
<ul class="pstrip-list">${tiles}</ul>
</div>
</section>`
}

// ---------- the app and the exhibitor dashboard ----------
export function defaultAppPartners(): { name: string; label: string; logo: string; url: string }[] {
  return PARTNERS.map(p => ({ name: p.name, label: p.label, logo: p.logo, url: '' }))
}
export function poweredByForApp(): { name: string; logo: string; edition: string } {
  return { name: POWERED_BY.name, logo: POWERED_BY.logo, edition: PARTNERS_EDITION }
}
