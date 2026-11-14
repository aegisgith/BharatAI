// Built-worker checks for the Expo Pass (14 Nov 2026), on real SQLite (sql.js) with the
// production schema, the payment routes and the CCAvenue answer played back:
//  - Rs 999 + GST at any date, the same in the config the pages read;
//  - someone on a free Visitor Pass (on the waiting list, too) buys it: the order at
//    Rs 999 + GST, paid, they hold an Expo Pass, no lunch, and are no longer waitlisted;
//  - an Expo Pass bought but not paid is an unpaid pass, not a pass that admits;
//  - a confirmed Expo Pass moves up to Delegate for the difference (Rs 8,999 - 999),
//    and is refused the same pass again;
//  - the pages: /passes sells it (~~Free~~ Rs 999) in place of the free Visitor Pass,
//    the comparison shows an Expo column, /register offers it, the app's sheet has it.
// Run after `npm run build`:  node scripts/verify/smoke-expo-pass.mjs
import { readFileSync } from 'node:fs';
import { makeUpgradeWorld, checker, LATE, paise } from './upgrade-world.mjs';
const { check, fails } = checker();
const W = await makeUpgradeWorld();
W.at(LATE);

// ---- the price ----
const cfg = await W.hit('GET', '/api/payments/config');
const want = paise(999);
check('the config lists the Expo Pass at Rs 999 + GST', cfg.status === 200 && cfg.json.passes?.['Expo Pass']?.base === 999 && cfg.json.passes['Expo Pass'].total === want.total / 100, cfg.json.passes?.['Expo Pass']);

// ---- a free Visitor on the waiting list buys it ----
W.db.exec(readFileSync(new URL('../../migrations/0056_free_pass_waitlist.sql', import.meta.url), 'utf8'));
const asha = W.person(501, { badge_type: 'Visitor Pass', payment_status: 'paid' });
W.db.run("UPDATE attendees SET entry_status = 'waitlisted' WHERE id = ?", [asha]);
let r = await W.buy(asha, 'Expo Pass');
check('the order is Rs 999 + GST, and it is paid', r.start?.status === 201 && r.order?.base_paise === want.base && r.order.amount_paise === want.total && r.order.status === 'paid', r.order || r.start?.json);
const a = W.who(asha);
check('they now hold an Expo Pass, paid, with no lunch', a.badge_type === 'Expo Pass' && a.payment_status === 'paid' && a.lunch_inclusion === 'No', JSON.stringify(a));
const tok = await W.hit('GET', '/api/my-pass-token?id=' + asha, undefined, W.as(asha));
check('no longer on the waiting list: the pass is issued', tok.status === 200 && !!tok.json?.token, tok.json);
check('the record says it was the free Visitor Pass before', r.order.previous_badge === 'Visitor Pass');

// ---- moving up, and the same pass again ----
r = await W.start(asha, 'Expo Pass');
check('the same pass again is refused, nothing charged', r.status === 409 && /already confirmed/.test(r.json?.error || ''), r.json);
r = await W.start(asha, 'Delegate Pass');
const diff = paise(8999 - 999);
check('to Delegate for the difference, Rs 8,000 + GST', r.status === 201 && W.order(r.json.order_id).base_paise === diff.base && W.order(r.json.order_id).amount_paise === diff.total, r.json);

// ---- chosen on a form and not paid ----
const ravi = W.person(502, { badge_type: 'Expo Pass', payment_status: 'pending' });
const t2 = await W.hit('GET', '/api/my-pass-token?id=' + ravi, undefined, W.as(ravi));
check('an Expo Pass not paid for is not a pass that admits', t2.status !== 200 || !t2.json?.token, t2.json);
r = await W.start(ravi, 'Expo Pass');
check('and may pay for it, at the full price', r.status === 201 && W.order(r.json.order_id).amount_paise === want.total, r.json);

// ---- the pages ----
const passes = (await W.hit('GET', '/passes')).text;
check('/passes sells the Expo Pass, ~~Free~~ Rs 999, in place of the free Visitor Pass', passes.includes('id="expo"') && /<s[^>]*>Free<\/s> &#8377;999/.test(passes) && !passes.includes('Get the free Visitor Pass') && passes.includes('/register?source=passes-card#expo'));
check('the Expo column has no AI Innovation Talk and Showcase (14 Nov 2026), and every other pass has it', (() => { const row = passes.slice(passes.indexOf('<th scope="row">AI Innovation Talk and Showcase')); const cells = row.slice(0, row.indexOf('</tr>')).match(/<td>[\s\S]*?<\/td>/g) || []; return cells.length === 6 && /Not included/.test(cells[0]) && cells.slice(1).every((c) => /Included/.test(c) && !/Not included/.test(c)); })());
check('the comparison has an Expo column and no free Visitor column', /color:#BF360C;">Expo<span>/.test(passes) && !/>Visitor<span>Free<\/span>/.test(passes));
const reg = (await W.hit('GET', '/register')).text;
check('/register offers it on the pass choice and in the paid form', reg.includes('<li data-pass="Expo Pass">') && reg.includes('value="Expo Pass"') && reg.includes("expo: 'Expo Pass'"));
const appPage = (await W.hit('GET', '/app')).text, app = (await W.hit('GET', '/app.js')).text;
check('the app knows it: its sheet, its link, its ladder', appPage.includes('name="pp-pass" value="Expo Pass"') && app.includes("expo: 'Expo Pass'") && app.includes("var UPGRADE_LADDER = ['Expo Pass',"));

// ---- the deep check of 14 Nov 2026 ----
check('the paid form in the app offers the Student Pass too (every student email lands there)', appPage.includes('name="pp-pass" value="Student Pass"'));
check('/register says the Expo Pass has no conference, on the pass choice and above the comparison', reg.includes('All but the Expo Pass include the full conference.') && reg.includes('all but the Expo Pass include the full conference') && !reg.includes('the full conference and the networking app.</p>'));
check('/register: a workshop comes with the Student Pass too', reg.includes('A workshop comes with the Student, Premium Delegate and VIP passes') && !reg.includes('Workshops come only with Premium Delegate and VIP'));
check('/register: the showcase buttons open the paid form every time, closing the dialog first', (reg.match(/onclick="return nwPay\('(Delegate|Expo) Pass'\)"/g) || []).length === 4 && reg.includes('function nwPay(pass)') && reg.includes("history.replaceState(null, '', location.pathname + location.search)"));
check('the app: an Expo Pass sees the sessions locked, its own welcome, no showcase slot', app.includes("isVisitorPass() || String(currentUser.badge_type || '') === 'Expo Pass'") && app.includes("label: 'Expo Pass', icon: 'fa-ticket-alt'") && app.includes("b === 'Student Pass' || b === 'Expo Pass') { el.classList.add('hidden')"));

console.log(fails() ? fails() + ' FAILED' : 'all Expo Pass checks passed');
process.exit(fails() ? 1 : 0);
