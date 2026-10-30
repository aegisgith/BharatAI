// An exhibitor listing a product on the AI Marketplace, on a phone, in a real
// browser, against mp-harness.mjs (:8779): the sign-in link, the form, a web address
// typed without https://, the images, "Submit Listing for Review", the two emails;
// then every way the button used to look dead (an empty required box inside a
// collapsed section, a bad link, a sign-in that ran out, the same product twice) and
// what the person is shown instead; then the dashboard edit, the admin approval, the
// public page and a buyer's inquiry.
//
// 30 Oct 2026: an exhibitor wrote that "Submit for review" did nothing after filling
// in every detail. The browser's own validation refused a website typed as
// www.example.com (type="url") and, with the box in a collapsed section, showed
// nothing. The form now checks the server's rules itself and opens the section.
const path = require('path');
const { chromium } = require('./playwright.cjs');

const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8779);
let fails = 0;
const check = (label, ok, detail = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (ok ? '' : '   ' + detail)); if (!ok) fails++; };
const getState = async () => (await fetch(BASE + '/api/__state')).json();
const setState = (body) => fetch(BASE + '/api/__state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' };
// A 1x1 PNG: enough for the form (it keeps small images as they are) and the server (which reads the bytes).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const png = (name) => ({ name, mimeType: 'image/png', buffer: PNG });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = [];
  const phone = async (signedIn = true) => {
    const ctx = await browser.newContext(PHONE);
    if (signedIn) {
      const { cookie } = await (await fetch(BASE + '/api/__session?company=7')).json();
      await ctx.addCookies([{ name: 'mp_session', value: cookie, url: BASE }]);
    }
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e)));
    page.on('dialog', d => d.accept());
    return { ctx, page };
  };
  const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);
  const text = (page, sel) => page.locator(sel).first().innerText().catch(() => '');
  const openSection = async (page, title) => { const d = page.locator('#listing-form details', { has: page.locator('summary', { hasText: title }) }).first(); if (!(await d.evaluate(e => e.open))) await d.locator('summary').click(); };
  const sectionOpen = (page, title) => page.locator('#listing-form details', { has: page.locator('summary', { hasText: title }) }).first().evaluate(e => e.open);
  const fillBasics = async (page, name, desc = 'Finds the right tutor for every student and plans their week with AI.') => {
    await openSection(page, 'Basic Information');
    await page.fill('#listing-form [name="product_name"]', name);
    await page.fill('#listing-form [name="description"]', desc);
  };
  const submit = (page) => page.click('#listing-form button[type="submit"]');
  const formError = (page) => text(page, '#listing-form [data-form-error]');

  await setState({ reset: true });

  // ---- 1. the sign-in link from the invitation lands on the form, signed in ----
  {
    const { url } = await (await fetch(BASE + '/api/__signin?company=7')).json();
    const { ctx, page } = await phone(false);
    await page.goto(url);
    await page.waitForSelector('#listing-form-section:not(.hidden)', { timeout: 10000 }).catch(() => {});
    check('sign-in link lands on the listing form', page.url().includes('/marketplace?submit=true') && await visible(page, '#listing-form-section'), page.url());
    check('the company name is filled in from the account', (await page.inputValue('#company-name')) === 'Daten Intelligenz', await page.inputValue('#company-name'));
    check('the form has no browser-side validation (novalidate)', await page.locator('#listing-form').evaluate(f => f.noValidate), 'the browser would refuse a plain domain silently');
    check('the page fits a phone', await fits(page));
    await ctx.close();
  }

  // ---- 2. the full form, with a website typed as www.example.com, the images, Submit ----
  {
    const { ctx, page } = await phone();
    await page.goto(BASE + '/marketplace?submit=true');
    await page.waitForSelector('#listing-form-section:not(.hidden)');
    await fillBasics(page, 'AIGyan Tutor');
    await page.fill('#listing-form [name="use_cases"]', 'Tutor matching\nWeekly study plans');
    await openSection(page, 'Categories');
    await page.check('#listing-form input[name="target_industry"][value="Education"]');
    await page.check('#listing-form input[name="ai_category"][value="AI Agents"]');
    await page.fill('#listing-form [name="ai_category_custom"]', 'Tutor matching');
    await openSection(page, 'Pricing');
    await page.selectOption('#listing-form [name="pricing_type"]', 'Paid');
    await openSection(page, 'Media');
    await page.setInputFiles('#listing-form input[name="logo_file"]', png('logo.png'));
    await page.setInputFiles('#listing-form input[name="product_image_file"]', png('product.png'));
    await page.setInputFiles('#listing-form input[name="screenshot_files"]', [png('s1.png'), png('s2.png')]);
    await page.fill('#listing-form [name="website_url"]', 'www.datenintelligenz.com');
    await page.fill('#listing-form [name="video_url"]', 'youtu.be/dQw4w9WgXcQ');
    await openSection(page, 'Contact');
    await page.fill('#listing-form [name="sales_contact_email"]', 'sales@datenintelligenz.com');
    await submit(page);
    await page.waitForSelector('.listing-success-panel', { timeout: 15000 }).catch(() => {});
    check('a filled form submits in one press and says so', (await text(page, '.listing-success-panel')).includes('Listing Submitted'), await formError(page));
    const st = await getState();
    const l = st.listings[0] || {};
    check('the listing is pending review with the exhibitor booth', st.listings.length === 1 && l.status === 'pending' && l.booth_number === 'B12' && l.exhibitor_id === 42, JSON.stringify({ n: st.listings.length, status: l.status, booth: l.booth_number }));
    check('www.example.com was sent as https://www.example.com', l.website_url === 'https://www.datenintelligenz.com', l.website_url);
    check('a bare video link got its https:// too', l.video_url === 'https://youtu.be/dQw4w9WgXcQ', l.video_url);
    check('logo, product image and both screenshots were uploaded and attached', /^\/api\/mp\/uploads\/\d+$/.test(l.logo_url || '') && /^\/api\/mp\/uploads\/\d+$/.test(l.product_image_url || '') && (l.screenshot_urls || '').split(', ').length === 2 && st.uploads.length === 4, JSON.stringify({ logo: l.logo_url, img: l.product_image_url, shots: l.screenshot_urls, uploads: st.uploads.length }));
    check('the typed-in category joins the category list', l.ai_category === 'AI Agents, Tutor matching', l.ai_category);
    check('the company gets "we received your listing"', st.mail.some(m => m.to === 'shishir@example.com' && /received your listing: AIGyan Tutor/.test(m.subject)), st.mail.map(m => m.to + ': ' + m.subject).join(' | '));
    check('the team is told a listing waits for review', st.mail.some(m => m.to !== 'shishir@example.com' && /New AI Marketplace listing: AIGyan Tutor/.test(m.subject)), st.mail.map(m => m.to + ': ' + m.subject).join(' | '));
    await ctx.close();
  }

  // ---- 3. the "missing details" step says it has NOT been sent, and the second press sends ----
  {
    const { ctx, page } = await phone();
    await page.goto(BASE + '/marketplace?submit=true');
    await page.waitForSelector('#listing-form-section:not(.hidden)');
    await fillBasics(page, 'AIGyan Lite');
    await submit(page);
    await page.waitForTimeout(400);
    const notice = await text(page, '#listing-form [role="status"]');
    check('the first press shows "Not submitted yet" with what is missing', /Not submitted yet/.test(notice) && /Company logo/.test(notice) && /Sales contact email/.test(notice), notice.slice(0, 120));
    check('the button now reads "Submit anyway"', /Submit anyway/.test(await text(page, '#listing-form button[type="submit"]')));
    check('nothing was sent on the first press', (await getState()).listings.length === 1);
    await submit(page);
    await page.waitForSelector('.listing-success-panel', { timeout: 15000 }).catch(() => {});
    const done = await text(page, '.listing-success-panel');
    check('"Submit anyway" sends it and lists what is still missing', /Listing Submitted/.test(done) && /still missing/.test(done), done.slice(0, 160));
    check('the second listing is pending', (await getState()).listings.length === 2);
    await ctx.close();
  }

  // ---- 4. an empty required box inside a collapsed section: shown, named, opened ----
  {
    const { ctx, page } = await phone();
    await page.goto(BASE + '/marketplace?submit=true');
    await page.waitForSelector('#listing-form-section:not(.hidden)');
    await page.fill('#listing-form [name="description"]', 'Only a description.');
    await page.locator('#listing-form details', { has: page.locator('summary', { hasText: 'Basic Information' }) }).first().locator('summary').click();   // collapse it
    check('(setup) Basic Information is collapsed', !(await sectionOpen(page, 'Basic Information')));
    await submit(page);
    await page.waitForTimeout(500);
    const err = await formError(page);
    check('an empty product name is named on screen, not refused silently', await visible(page, '#listing-form [data-form-error]') && /product name/i.test(err), err);
    check('the collapsed section is opened for it', await sectionOpen(page, 'Basic Information'));
    check('the box is focused and marked invalid', await page.evaluate(() => document.activeElement && document.activeElement.name === 'product_name' && document.activeElement.getAttribute('aria-invalid') === 'true'));
    check('nothing was sent', (await getState()).listings.length === 2);
    await ctx.close();
  }

  // ---- 5. a link that is not a web address: named, section opened; fixed, it goes through ----
  {
    const { ctx, page } = await phone();
    await page.goto(BASE + '/marketplace?submit=true');
    await page.waitForSelector('#listing-form-section:not(.hidden)');
    await fillBasics(page, 'AIGyan Pro');
    await openSection(page, 'Media');
    await page.fill('#listing-form [name="website_url"]', 'not a link at all!!');
    await page.locator('#listing-form details', { has: page.locator('summary', { hasText: 'Media' }) }).first().locator('summary').click();   // collapse it again
    await submit(page);
    await page.waitForTimeout(500);
    const err = await formError(page);
    check('a bad website is named with an example of what works', /Website URL/.test(err) && /example\.com/.test(err), err);
    check('the Media section is opened for it', await sectionOpen(page, 'Media'));
    await page.fill('#listing-form [name="website_url"]', 'aigyan.in');
    await submit(page);                 // missing-details step
    await page.waitForTimeout(300);
    check('the earlier error is cleared on the next press', !(await visible(page, '#listing-form [data-form-error]')));
    await submit(page);                 // submit anyway
    await page.waitForSelector('.listing-success-panel', { timeout: 15000 }).catch(() => {});
    const st = await getState();
    check('fixed, it submits and the link is stored with https://', st.listings.length === 3 && st.listings[2].website_url === 'https://aigyan.in', JSON.stringify(st.listings.map(l => l.website_url)));
    await ctx.close();
  }

  // ---- 6. the same product twice: refused with the way to the dashboard ----
  {
    const { ctx, page } = await phone();
    await page.goto(BASE + '/marketplace?submit=true');
    await page.waitForSelector('#listing-form-section:not(.hidden)');
    await fillBasics(page, 'aigyan tutor');
    await submit(page); await page.waitForTimeout(300); await submit(page);
    await page.waitForSelector('#listing-form [data-form-error]:not([hidden])', { timeout: 10000 }).catch(() => {});
    const err = await formError(page);
    check('a duplicate name is refused on screen', /already have a listing/.test(err), err);
    check('with a link to the dashboard', await page.locator('#listing-form [data-form-error] a[href="/marketplace/dashboard"]').count() === 1);
    check('the button is usable again', !(await page.locator('#listing-form button[type="submit"]').isDisabled()));
    check('nothing was added', (await getState()).listings.length === 3);
    await ctx.close();
  }

  // ---- 7. the sign-in ran out while the form was open: nothing typed is lost ----
  {
    const { ctx, page } = await phone();
    await page.goto(BASE + '/marketplace?submit=true');
    await page.waitForSelector('#listing-form-section:not(.hidden)');
    await fillBasics(page, 'Late Night Build');
    await openSection(page, 'Media');
    await page.setInputFiles('#listing-form input[name="logo_file"]', png('logo.png'));
    await ctx.clearCookies();
    await submit(page); await page.waitForTimeout(300); await submit(page);
    await page.waitForSelector('#listing-form [data-form-error]:not([hidden])', { timeout: 10000 }).catch(() => {});
    const err = await formError(page);
    check('a sign-in that ran out is explained, not "Login required"', /sign-in has run out/.test(err) && /Everything you typed is kept/.test(err), err);
    check('the sign-in box is shown', await visible(page, '#auth-section'));
    check('the form keeps what was typed', (await page.inputValue('#listing-form [name="product_name"]')) === 'Late Night Build');
    check('the form is still on the page', await visible(page, '#listing-form'));
    // Signing in again (here: the cookie a sign-in link would set, in any tab) and pressing once more.
    const { cookie } = await (await fetch(BASE + '/api/__session?company=7')).json();
    await ctx.addCookies([{ name: 'mp_session', value: cookie, url: BASE }]);
    await submit(page);
    await page.waitForSelector('.listing-success-panel', { timeout: 15000 }).catch(() => {});
    const st = await getState();
    check('signed in again, the same press sends the same form', st.listings.length === 4 && st.listings[3].product_name === 'Late Night Build' && /^\/api\/mp\/uploads\/\d+$/.test(st.listings[3].logo_url || ''), JSON.stringify({ n: st.listings.length, logo: (st.listings[3] || {}).logo_url }));
    await ctx.close();
  }

  // ---- 8. the dashboard: the listing is there, and an edit with a plain domain saves ----
  {
    const { ctx, page } = await phone();
    await page.goto(BASE + '/marketplace/dashboard');
    await page.waitForSelector('#dash-listings-table table', { timeout: 10000 }).catch(() => {});
    const table = await text(page, '#dash-listings-table');
    check('the dashboard lists the listing as pending', /AIGyan Tutor/.test(table) && /Pending/.test(table), table.slice(0, 120));
    const tutorId = (await getState()).listings.find(l => l.product_name === 'AIGyan Tutor').id;
    await page.click('[data-goto="listings"]');            // the overview's "View Listings"
    await page.waitForSelector('#section-listings:not(.hidden)');
    await page.click(`#dash-listings-table .dash-actions [data-edit-id="${tutorId}"]`);
    await page.waitForSelector('#edit-listing-modal:not(.hidden)');
    check('the edit form shows the stored website', (await page.inputValue('#edit-website-url')) === 'https://www.datenintelligenz.com', await page.inputValue('#edit-website-url'));
    await page.fill('#edit-website-url', 'daten.ai');
    await page.fill('#edit-demo-url', 'nope nope');
    await page.click('#edit-listing-form button[type="submit"]');
    await page.waitForTimeout(400);
    const err = await text(page, '#edit-listing-form [data-edit-error]');
    check('a bad link in the edit form is named on screen', /Not saved/.test(err) && /Demo URL/.test(err), err);
    await page.fill('#edit-demo-url', '');
    await page.click('#edit-listing-form button[type="submit"]');
    await page.waitForSelector('#edit-listing-modal.hidden', { timeout: 10000 }).catch(() => {});
    const st = await getState();
    check('the edit saved daten.ai as https://daten.ai and kept the listing pending', st.listings[0].website_url === 'https://daten.ai' && st.listings[0].status === 'pending', JSON.stringify({ web: st.listings[0].website_url, status: st.listings[0].status }));
    await ctx.close();
  }

  // ---- 9. approval by the event admin, then the public page and a buyer's inquiry ----
  {
    const tutorId = (await getState()).listings.find(l => l.product_name === 'AIGyan Tutor').id;
    const r = await fetch(BASE + '/api/mp/admin/listings/' + tutorId, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer h-admin' }, body: JSON.stringify({ status: 'approved' }) });
    let st = await getState();
    check('the event admin can approve it', r.status === 200 && st.listings[0].status === 'approved', r.status + ' ' + st.listings[0].status);
    check('the company is told it is live', st.mail.some(m => m.to === 'shishir@example.com' && /live|approved/i.test(m.subject)), st.mail.map(m => m.subject).join(' | '));
    check('the approval is in the audit log', st.audits.some(a => a.action === 'marketplace.listing-approved'));
    const { ctx, page } = await phone(false);
    await page.goto(BASE + '/marketplace');
    await page.waitForSelector('.listing-card:not(.listing-card--skeleton)', { timeout: 10000 }).catch(() => {});
    const card = await text(page, '.listing-card');
    check('the approved listing is on the public marketplace with its booth', /AIGyan Tutor/.test(card) && /Booth B12/.test(card), card.slice(0, 120));
    check('the other three (pending) listings are not shown', await page.locator('.listing-card:not(.listing-card--skeleton)').count() === 1);
    await page.click('.listing-card');
    await page.waitForSelector('[data-detail-form]', { timeout: 10000 }).catch(() => {});
    check('the public listing page opens by company and product', /\/marketplace\/listing\/daten-intelligenz\/aigyan-tutor/.test(page.url()), page.url());
    await page.fill('[data-detail-form] [name="inquirer_name"]', 'Meera Nair');
    await page.fill('[data-detail-form] [name="inquirer_email"]', 'meera@example.org');
    await page.fill('[data-detail-form] [name="inquirer_message"]', 'Can we see a demo at the stand?');
    await page.click('[data-detail-form] button[type="submit"]');
    await page.waitForSelector('[data-detail-sent] .pd-sent', { timeout: 10000 }).catch(() => {});
    check('a buyer can send an inquiry', /Inquiry sent/.test(await text(page, '[data-detail-sent]')));
    st = await getState();
    check('the inquiry reaches the exhibitor by email', st.inquiries.length === 1 && st.mail.some(m => m.to === 'shishir@example.com' && /New inquiry about AIGyan Tutor from Meera Nair/.test(m.subject)), st.mail.map(m => m.subject).join(' | '));
    check('the listing page fits a phone', await fits(page));
    await ctx.close();
  }

  check('no page errors anywhere', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} check(s) failed` : '\nall marketplace checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('crashed', e); process.exit(1); });
