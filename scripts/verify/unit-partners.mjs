// "Powered by IDFC FIRST Bank" and the partners' logos on every email, every Mumbai page,
// the app's Home tab and the exhibitor dashboard (the organiser, 23 Nov 2026).
//   node scripts/verify/unit-partners.mjs
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const { build } = createRequire(join(ROOT, 'package.json'))('esbuild')
const out = await build({ entryPoints: [join(ROOT, 'src/lib/partners.ts')], bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent' })
const L = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))
const DATA = JSON.parse(readFileSync(join(ROOT, 'src/data/partners.json'), 'utf8'))

let failed = 0
const check = (name, ok, detail) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  <- ' + String(detail ?? '').slice(0, 300))); if (!ok) failed++ }
const onDisk = (p) => existsSync(join(ROOT, 'public', p.replace(/^\//, '')))

// The list
check('seven partners, in the home page order, and IDFC FIRST Bank as Powered by',
  DATA.partners.length === 7 && DATA.partners[0].name === 'Aegis Superintelligence Lab' && DATA.partners[6].name === 'EXENI' && DATA.powered_by.name === 'IDFC FIRST Bank')
const home = readFileSync(join(ROOT, 'public/index.html'), 'utf8')
check('every label is the one the home page strip shows', DATA.partners.every(p => home.includes('ptile-role">' + p.label.replace(/&/g, '&amp;') + '<')),
  DATA.partners.filter(p => !home.includes('ptile-role">' + p.label.replace(/&/g, '&amp;') + '<')).map(p => p.label))
check('every logo (site and email) is a file on the site', [DATA.powered_by.logo, DATA.powered_by.email_logo, ...DATA.partners.flatMap(p => [p.logo, p.email_logo])].every(onDisk),
  [DATA.powered_by.logo, DATA.powered_by.email_logo, ...DATA.partners.flatMap(p => [p.logo, p.email_logo])].filter(p => !onDisk(p)))
check('email logos are PNG (Outlook cannot show WebP)', [DATA.powered_by, ...DATA.partners].every(p => /\.png$/.test(p.email_logo)))

// The email block
const block = L.partnersEmailHTML()
check('the email block names IDFC FIRST Bank as Powered by and shows all seven, with their labels',
  block.includes('Powered by') && block.includes('alt="IDFC FIRST Bank"') && DATA.partners.every(p => block.includes('alt="' + p.name.replace(/&/g, '&amp;') + '"')) && block.includes('Assessment OS Partner &amp; Panel Host'))
check('its pictures are full https addresses, PNG only', !/src="(?!https:\/\/bharataiinnovation\.com\/images\/email\/partners\/)/.test(block) && !block.includes('.webp'))
check('it is tables, no <style> or class (mail apps drop them)', !block.includes('<style') && !/\sclass=/.test(block) && block.includes('role="presentation"'))
const doc = '<html><body><p>Hello</p></body></html>'
const once = L.withPartners(doc)
check('withPartners puts it just before </body>', once.indexOf(L.PARTNERS_MARK) > once.indexOf('<p>Hello</p>') && once.trimEnd().endsWith('</body></html>'))
check('...only once, however often it runs', L.withPartners(once) === once && once.split(L.PARTNERS_MARK).length === 2)
check('a fragment gets it at the end', L.withPartners('<div>hi</div>').startsWith('<div>hi</div>') && L.withPartners('<div>hi</div>').includes(L.PARTNERS_MARK))
check('an empty body stays empty', L.withPartners('') === '' && L.withPartners('   ') === '   ')

// What goes to Elastic Email
const payload = (parts) => JSON.stringify({ Recipients: { To: ['a@example.test'] }, Content: { Body: parts, From: 'x@bharataiinnovation.com', Subject: 'S' } })
const sent = JSON.parse(L.elasticBodyWithPartners(payload([{ ContentType: 'HTML', Content: doc, Charset: 'utf-8' }, { ContentType: 'PlainText', Content: 'Hello' }])))
check('the HTML part sent to Elastic Email carries the block', sent.Content.Body[0].Content.includes(L.PARTNERS_MARK))
check('...the plain-text part, the recipients and the subject are untouched', sent.Content.Body[1].Content === 'Hello' && sent.Recipients.To[0] === 'a@example.test' && sent.Content.Subject === 'S')
const already = payload([{ ContentType: 'HTML', Content: once }])
check('a body that already has it is sent byte for byte', L.elasticBodyWithPartners(already) === already)
check('anything it cannot read goes on unchanged', L.elasticBodyWithPartners('not json') === 'not json' && L.elasticBodyWithPartners(undefined) === undefined && L.elasticBodyWithPartners('{"Content":{}}') === '{"Content":{}}')

// Every sender goes through elasticFetch
const src = readFileSync(join(ROOT, 'src/index.tsx'), 'utf8')
const rawSends = (src.match(/[^A-Za-z]fetch\('https:\/\/api\.elasticemail\.com\/v4\/emails\/transactional'/g) || []).length
const wrapped = (src.match(/elasticFetch\('https:\/\/api\.elasticemail\.com\/v4\/emails\/transactional'/g) || []).length
check('no email is sent to Elastic Email except through elasticFetch', rawSends === 0 && wrapped >= 11, { rawSends, wrapped })
let routesSend = ''
try { routesSend = execFileSync('git', ['grep', '-l', 'api.elasticemail.com', '--', 'src/routes', 'src/lib'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { routesSend = '' } // exit 1: none found
check('no route file calls Elastic Email itself (they send through sendAdminEmail)', routesSend === '', routesSend)
check('sendAdminEmail puts the block above the unsubscribe line', /withAppOnPhoneFor\(c, html, to\)[^\n]*\r?\n\s*html = withPartners\(html\)/.test(src))
check('admin previews get the same block', src.includes("if (!c.req.path.includes('/admin/') || c.res.status !== 200) return") && src.includes('d.html = withPartners(d.html)'))

// The site
const strip = L.partnersStripHTML('/')
check('the site block: Powered by IDFC FIRST Bank and seven tiles with labels', strip.includes('alt="IDFC FIRST Bank"') && (strip.match(/<li/g) || []).length === 7 && strip.includes('pstrip-dark'))
let genOk = true, genOut = ''
try { genOut = execFileSync(process.execPath, [join(ROOT, 'scripts/gen-partners-strip.mjs'), '--check'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) } catch (e) { genOk = false; genOut = String(e.stderr || e.message) }
check('every Mumbai page of the site carries the current block (gen-partners-strip --check)', genOk, genOut)
for (const page of ['conference', 'exhibition', 'feedback', 'partner']) {
  const h = readFileSync(join(ROOT, 'public', page + '.html'), 'utf8')
  check(`${page}.html shows it once`, h.split(L.PARTNERS_MARK).length === 2 && h.includes('alt="IDFC FIRST Bank"'))
}
for (const page of ['delhi', 'delhi-hi', 'delhi-register', 'index']) {
  const h = readFileSync(join(ROOT, 'public', page + '.html'), 'utf8')
  check(`${page}.html is left alone`, !h.includes(L.PARTNERS_MARK))
}
check('the pages the worker draws (/register, /passes, contact...) get it in their shared footer', /function sharedFooterHTML\(\): string \{\r?\n\s*return `\$\{partnersStripHTML\('\/'\)\}<footer/.test(src))
check('the photo album page shows it', readFileSync(join(ROOT, 'src/routes/photos.ts'), 'utf8').includes("</script>${partnersStripHTML('/')}</body></html>`"))

// The app and the exhibitor dashboard
const LOGO_RE = /^\/(images\/[A-Za-z0-9/_.%-]+\.(webp|png|jpe?g|svg)|api\/mp\/uploads\/\d+)$/
const def = L.defaultAppPartners()
check('the app list, when the organisers typed none, is the seven, each one the admin form would accept',
  def.length === 7 && def.every(p => p.name && p.name.length <= 80 && p.label.length <= 60 && LOGO_RE.test(p.logo) && p.url === ''))
check('Powered by for the app names the bank and the edition', L.poweredByForApp().name === 'IDFC FIRST Bank' && L.poweredByForApp().edition === 'Mumbai 2026')
const mp = readFileSync(join(ROOT, 'src/routes/marketplace.ts'), 'utf8')
check('/api/app-partners falls back to them and sends powered_by', mp.includes('return list.length ? list : defaultAppPartners()') && mp.includes('powered_by: poweredByForApp()'))
check('the app Home tab draws Powered by', src.includes('id="app-powered"') && src.includes("pbox.style.display = 'flex'"))
const dash = readFileSync(join(ROOT, 'public/static/marketplace-dashboard.js'), 'utf8')
check('the exhibitor dashboard draws them', dash.includes('renderDashPartners(all)') && readFileSync(join(ROOT, 'src/routes/marketplace-pages.ts'), 'utf8').includes('<div id="dash-partners" class="dash-card hidden"></div>'))

console.log(failed ? `${failed} FAILED` : 'all partner checks passed')
process.exitCode = failed ? 1 : 0
