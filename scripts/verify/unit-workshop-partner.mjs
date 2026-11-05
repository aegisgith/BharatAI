// Unit: the call for workshop partners on /training-workshop, each rule on its own, no
// browser and no server (5 Nov 2026). The form's own script runs in node:vm
// (workshop-partner-world.mjs); the page's words and Admin's label are read from the files.
// Run:  node scripts/verify/unit-workshop-partner.mjs
import { GOOD, openPage, read } from './workshop-partner-world.mjs';

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };

// ---- what the form refuses, with the words the person sees, under the box ----
const refusals = [
  ['no topic', { topic: '  ' }, 'idea or topic', 'wp-topic', 'wp-topic'],
  ['no brief', { brief: '' }, 'short brief', 'wp-brief', 'wp-brief'],
  ['no format', { format: '' }, 'hands-on or pure theory', 'wp-format-hands', 'wp-format-set'],
  ['no shortest time', { min: '' }, 'shortest time', 'wp-min', 'wp-min'],
  ['shortest time not a number', { min: 'one hour' }, 'shortest time', 'wp-min', 'wp-min'],
  ['shortest time zero', { min: '0' }, 'shortest time', 'wp-min', 'wp-min'],
  ['no longest time', { max: '' }, 'longest time', 'wp-max', 'wp-max'],
  ['longest shorter than shortest', { min: '120', max: '90' }, 'cannot be less', 'wp-max', 'wp-max'],
  ['no target audience', { audience: '' }, 'target audience', 'wp-audience', 'wp-audience'],
  ['no who should attend', { attend: '' }, 'who should attend', 'wp-attend', 'wp-attend'],
  ['not said individual or company', { as: '' }, 'an individual or an AI company', 'wp-as-person', 'wp-as-set'],
  ['a company with no name', { company: ' ' }, 'company name', 'wp-company', 'wp-company'],
  ['no salutation', { salutation: '' }, 'salutation', 'wp-salutation', 'wp-salutation'],
  ['no first name', { first: '' }, 'first name', 'wp-first', 'wp-first'],
  ['no last name', { last: '' }, 'last name', 'wp-last', 'wp-last'],
  ['no email', { email: '' }, 'email address', 'wp-email', 'wp-email'],
  ['email without a domain', { email: 'asha@' }, 'email address', 'wp-email', 'wp-email'],
  ['no mobile', { mobile: '' }, 'mobile number', 'wp-mobile', 'wp-mobile'],
  ['a short mobile', { mobile: '12345' }, 'at least 10 digits', 'wp-mobile', 'wp-mobile'],
];
for (const [what, change, words, focus, under] of refusals) {
  const p = openPage();
  const r = await p.submit({ ...GOOD, ...change });
  check(`refused, ${what}: says so, sends nothing`, r.error.includes(words) && !r.done && p.sent.length === 0 && p.focused.id === focus, JSON.stringify(r));
  check(`refused, ${what}: the message stands under the right box`, p.moved()?.under === under && under in p.els && p.els[under].attrs['aria-invalid'] === 'true', JSON.stringify(p.moved()));
}
{
  const p = openPage();
  await p.submit({ ...GOOD, first: '' });
  const r = await p.submit(GOOD);
  check('fixing the box clears the mark and sends', r.done && !('aria-invalid' in p.els['wp-first'].attrs) && p.sent.length === 1, JSON.stringify(r));
}

// ---- what it allows ----
{
  const r = await openPage().submit({ ...GOOD, as: 'Individual', company: '' });
  check('an individual needs no company', r.done && r.body.organization === '' && r.body.metadata.applying_as === 'Individual', JSON.stringify(r));
}
{
  const r = await openPage().submit({ ...GOOD, prereq: '', setup: '' });
  check('prerequisites and setup can be empty, and say None', r.done && r.body.message.includes('Prerequisites: None') && r.body.message.includes('Setup requirements: None'), r.body?.message);
}
{
  const r = await openPage().submit({ ...GOOD, min: '90', max: '90' });
  check('the same shortest and longest time reads as one', r.done && r.body.metadata.duration === '90 minutes', JSON.stringify(r.body?.metadata));
}
{
  const r = await openPage().submit({ ...GOOD, format: 'Pure theory' });
  check('pure theory is carried as chosen', r.done && r.body.metadata.format === 'Pure theory' && r.body.message.includes('Hands-on or pure theory: Pure theory'), JSON.stringify(r.body?.metadata));
}

// ---- what it sends ----
{
  const p = openPage();
  const r = await p.submit({ ...GOOD, email: ' asha@vaanilabs.example ', company: ' Vaani Labs ' });
  const b = r.body;
  check('filed as a workshop partner enquiry, to the enquiries route', r.done && b.inquiry_type === 'workshop_partner' && p.sent[0].url === '/api/inquiries', JSON.stringify(b));
  check('the subject names the topic', b.subject === 'Workshop · Speech models for Indian languages', b.subject);
  check('name with salutation, company, email and mobile, spaces trimmed', b.name === 'Dr. Asha Rao' && b.organization === 'Vaani Labs' && b.email === 'asha@vaanilabs.example' && b.phone === GOOD.mobile, JSON.stringify(b));
  for (const [what, words] of [
    ['the topic', 'Workshop idea or topic: Speech models'],
    ['the brief', 'Brief: Build a working voice bot'],
    ['hands-on or theory', 'Hands-on or pure theory: Hands-on'],
    ['the time, shortest to longest', 'Time needed: 60 to 90 minutes'],
    ['the target audience', 'Target audience: Enterprise teams and startups'],
    ['who should attend', 'Who should attend: Software developers'],
    ['the prerequisites', 'Prerequisites: Basic Python'],
    ['the setup requirements', 'Setup requirements: Projector, internet, GPU access'],
    ['individual or company', 'Applying as: AI company'],
  ]) check(`the message carries ${what}`, b.message.includes(words), b.message);
  const m = b.metadata;
  check('Admin can read the details beside it', m.applying_as === 'AI company' && m.format === 'Hands-on' && m.duration === '60 to 90 minutes' && m.salutation === 'Dr.' && m.first_name === 'Asha' && m.last_name === 'Rao' && m.page === '/training-workshop', JSON.stringify(m));
  check('the thank-you names the person and the email, and the form goes', p.els['wp-done-text'].textContent.includes('Dr. Asha Rao') && p.els['wp-done-text'].textContent.includes('asha@vaanilabs.example') && p.els['wp-form'].hidden === true, p.els['wp-done-text'].textContent);
}
{
  const p = openPage();
  const r = await p.submit({ ...GOOD, website: 'http://spam.example' });
  check('a bot filling the hidden box sees success and nothing is sent', r.done && p.sent.length === 0, JSON.stringify(r));
}
{
  const m = (await openPage({ search: '?utm_source=mail&utm_campaign=trainers&junk=1' }).submit(GOOD)).body.metadata;
  check('where the visitor came from travels with it, and nothing else', m.utm_source === 'mail' && m.utm_campaign === 'trainers' && !('junk' in m), JSON.stringify(m));
}

// ---- it never fails silently ----
{
  const p = openPage({ fetch: async () => ({ ok: false, json: async () => ({ error: 'Invalid inquiry type' }) }) });
  const r = await p.submit(GOOD);
  check('a server refusal is shown in its words, the form stays, the button comes back', r.error === 'Invalid inquiry type' && !r.done && p.els['wp-submit'].disabled === false && p.els['wp-submit'].innerHTML.includes('Send my workshop idea') && p.moved()?.under === 'the button', JSON.stringify(r));
}
{
  const p = openPage({ fetch: async () => { throw new Error('Failed to fetch'); } });
  const r = await p.submit(GOOD);
  check('no internet: says so in plain words and the form stays', r.error.includes('check your internet') && !r.done && p.els['wp-submit'].disabled === false, JSON.stringify(r));
}

// ---- the page and the other files ----
const page = read('public/training-workshop.html');
check('the page calls for individuals and AI companies', page.includes('Call for Workshop') && page.includes('individuals and AI companies'));
check('the top of the page links to the call', page.includes('href="#workshop-partners"') && page.includes('id="workshop-partners"'));
for (const box of Object.values({ a: 'wp-topic', b: 'wp-brief', c: 'wp-company', d: 'wp-salutation', e: 'wp-first', f: 'wp-last', g: 'wp-email', h: 'wp-mobile', i: 'wp-audience', j: 'wp-attend', k: 'wp-prereq', l: 'wp-min', m: 'wp-max', n: 'wp-setup' })) {
  check(`${box} has its label`, page.includes(`<label for="${box}">`));
}
for (const value of ['Hands-on', 'Pure theory', 'Individual', 'AI company']) check(`the choice "${value}" is on the form`, page.includes(`value="${value}"`));
check('the page offers no fee and no promise of a slot', !/guarantee|honorarium|revenue share/i.test(page.slice(page.indexOf('id="workshop-partners"'), page.indexOf('<!-- CTA -->'))));
const src = read('src/index.tsx');
check('the worker accepts the type', /validTypes = \[[^\]]*'workshop_partner'/.test(src));
check('Admin labels the type', src.includes("workshop_partner: { icon: 'fa-graduation-cap', color: 'teal', label: 'Workshop Partner' }"));
check('the icon exists in the font subset', read('public/css/fa-subset.css').includes('.fa-graduation-cap'));
for (const c of ['bg-teal-500/20', 'text-teal-300', 'border-teal-500/30']) check(`Admin's colour ${c} is in the stylesheet`, read('public/css/tailwind.css').includes(c.replace('/', '\\/')));
check('the Overview has a line for it, opening Enquiries on that type', src.includes('workshop partner ideas to read') && src.includes('openEnquiriesOfType(&quot;workshop_partner&quot;)'));
check('only one openEnquiriesOfType in the admin script', (src.match(/function openEnquiriesOfType/g) || []).length === 1);

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
