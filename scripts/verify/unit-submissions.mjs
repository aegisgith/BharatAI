// Unit: the Submissions screen's own rules, each alone (12 Nov 2026). The page script
// public/js/admin-submissions.js is run in node:vm as a browser would load it and its
// pure parts (SubDesk._t) are checked against a table of cases: what a file is offered
// as, the body sent for a choice, what was done in words, sizes and times, and that
// nothing from an email can become markup or a link. No worker, no database, no browser.
import { deskFunctions, check, done } from './submissions-world.mjs';

const T = deskFunctions();
const row = (o = {}) => ({ id: 1, kind: 'logo', status: 'new', matches: { exhibitors: [], talks: [], speakers: [], people: [] }, attachments: [], applied: [], ...o });
const M = (o) => ({ exhibitors: [], talks: [], speakers: [], people: [], ...o });

// ---- words that came from an email ----
check('escaping: a name with markup is shown, never run', T.esc('<img src=x onerror=alert(1)> "A" & \'B\'') === '&lt;img src=x onerror=alert(1)&gt; &quot;A&quot; &amp; &#39;B&#39;');
check('escaping: nothing and numbers', T.esc(null) === '' && T.esc(undefined) === '' && T.esc(0) === '0');
check('a link is only ever an https page', T.safeLink('https://aimailpilot.com/#inbox/abc') === 'https://aimailpilot.com/#inbox/abc' && T.safeLink('javascript:alert(1)') === '' && T.safeLink('http://x.in') === '' && T.safeLink(' data:text/html,x') === '' && T.safeLink(null) === '');
check('a file is only ever shown from the submissions folder', T.fileUrl('submissions/20261112-msg1/1-logo.png') === '/api/uploads/submissions/20261112-msg1/1-logo.png'
  && T.fileUrl('avatars/1.jpg') === '' && T.fileUrl('submissions/../secrets') === '' && T.fileUrl('submissions/a/b/c.png') === '' && T.fileUrl('submissions/a/"onerror=x.png') === '' && T.fileUrl('') === '');
check('pictures are pictures; a PDF is not', T.isPicture({ mime: 'image/png' }) && T.isPicture({ mime: 'image/svg+xml' }) && !T.isPicture({ mime: 'application/pdf' }) && !T.isPicture({ mime: 'text/html' }) && !T.isPicture(null));

// ---- sizes and times ----
check('size: bytes, KB, MB', T.fmtSize(512) === '512 bytes' && T.fmtSize(20480) === '20 KB' && T.fmtSize(2621440) === '2.5 MB' && T.fmtSize(null) === '0 bytes');
check('time: in India whatever the laptop clock, 12-hour', T.fmtWhen('2026-11-12T07:00:00.000Z') === '12 Nov, 12:30 pm' && T.fmtWhen('2026-11-12T18:35:00.000Z') === '13 Nov, 12:05 am' && T.fmtWhen('2026-11-12T00:00:00.000Z') === '12 Nov, 5:30 am');
check('time: nonsense is blank, not "Invalid Date"', T.fmtWhen('') === '' && T.fmtWhen('soon') === '' && T.fmtWhen(null) === '');

// ---- what a file is offered as ----
const acme = { id: 7, name: 'Acme Robotics', sure: true, how: 'the booth contact' };
const talk = { id: 3, name: 'Dr. Asha Rao', detail: 'Acme Robotics', sure: false, how: 'speaks for Acme Robotics' };
const spk = { id: 9, name: 'Neha Kapoor', detail: 'Bank of the North', sure: true, how: 'the speaker' };
check('a logo file from a known exhibitor starts on that exhibitor', T.defaultChoice({ use: 'logo', mime: 'image/png' }, row({ matches: M({ exhibitors: [acme], talks: [talk] }) })) === 'logo:7');
check('a photo file starts on the talk, the talk before the speaker', T.defaultChoice({ use: 'photo', mime: 'image/jpeg' }, row({ kind: 'photo', matches: M({ exhibitors: [acme], talks: [talk], speakers: [spk] }) })) === 'talk:3');
check('a photo file with no talk starts on the confirmed speaker', T.defaultChoice({ use: 'photo', mime: 'image/jpeg' }, row({ kind: 'photo', matches: M({ speakers: [spk] }) })) === 'speaker:9');
check('a file of no clear use follows what the email is about', T.defaultChoice({ use: '', mime: 'image/png' }, row({ kind: 'logo', matches: M({ exhibitors: [acme] }) })) === 'logo:7'
  && T.defaultChoice({ use: '', mime: 'image/png' }, row({ kind: 'photo', matches: M({ exhibitors: [acme], talks: [talk] }) })) === 'talk:3');
check('a photo is never offered as a logo by default, nor a logo as a photo', T.defaultChoice({ use: 'photo', mime: 'image/jpeg' }, row({ kind: 'logo', matches: M({ exhibitors: [acme] }) })) === ''
  && T.defaultChoice({ use: 'logo', mime: 'image/png' }, row({ kind: 'photo', matches: M({ talks: [talk] }) })) === '');
check('nobody known: nothing is chosen for the admin', T.defaultChoice({ use: 'logo', mime: 'image/png' }, row()) === '' && T.defaultChoice({ use: 'photo', mime: 'image/jpeg' }, row({ kind: 'photo' })) === '');
check('a PDF is never chosen; an SVG is only ever a logo', T.defaultChoice({ use: 'logo', mime: 'application/pdf' }, row({ matches: M({ exhibitors: [acme] }) })) === ''
  && T.defaultChoice({ use: 'photo', mime: 'image/svg+xml' }, row({ kind: 'photo', matches: M({ exhibitors: [acme], talks: [talk] }) })) === 'logo:7');
check('an "other" email with a file of no clear use chooses nothing', T.defaultChoice({ use: '', mime: 'image/png' }, row({ kind: 'other', matches: M({ exhibitors: [acme], talks: [talk] }) })) === '');

// ---- choosing and rejecting suggestions (13 Nov 2026) ----
const ex2 = { id: 8, name: 'Ai Vie Insights', sure: false, how: 'same company email' };
const ex3 = { id: 9, name: 'Cloud Crane', sure: false, how: 'named in the email' };
const both = (o) => row({ matches: M({ exhibitors: [ex2, ex3], talks: [talk], ...o }) });
check('suggestions: as they came when nobody has chosen', T.liveSuggestions(both(), 'exhibitor').map((x) => x.id).join() === '8,9');
check('suggestions: "No" takes one out for good', T.liveSuggestions(both({ rejected: { exhibitor: [8] } }), 'exhibitor').map((x) => x.id).join() === '9' && T.defaultChoice({ use: 'logo', mime: 'image/png' }, both({ rejected: { exhibitor: [8] } })) === 'logo:9');
check('suggestions: "Yes" puts the chosen one first, and the picker starts on it', T.liveSuggestions(both({ chosen: { exhibitor: 9 } }), 'exhibitor')[0].id === 9 && T.defaultChoice({ use: 'logo', mime: 'image/png' }, both({ chosen: { exhibitor: 9 } })) === 'logo:9');
check('suggestions: every one rejected leaves nothing chosen', T.defaultChoice({ use: 'logo', mime: 'image/png' }, both({ rejected: { exhibitor: [8, 9] } })) === '');
check('suggestions: ids as text from the server are the same ids', T.chosenId(both({ chosen: { talk: '3' } }), 'talk') === 3 && T.rejectedIds(both({ rejected: { talk: ['3'] } }), 'talk')[0] === 3 && T.chosenId(row(), 'talk') === null);
check('AI: a logo whose words name an exhibitor starts on that exhibitor, unless it was turned down', T.defaultChoice({ use: 'logo', mime: 'image/png', ai: { match: 9 } }, both()) === 'logo:9' && T.defaultChoice({ use: 'logo', mime: 'image/png', ai: { match: 9 } }, both({ rejected: { exhibitor: [9] } })) === 'logo:8');
check('AI: what it saw, in words', T.aiWords({ ai: { person: true, reads: '' } }) === 'AI: a person' && T.aiWords({ ai: { person: false, reads: 'SOLSYNCH' } }) === 'AI: reads “SOLSYNCH”' && T.aiWords({ ai: { person: false, reads: '' } }) === 'AI: no person, no name' && T.aiWords({ ai: { failed: true } }) === '' && T.aiWords({}) === '');
check('a rejected file is never offered', T.defaultChoice({ use: 'logo', mime: 'image/png', rejected: { by: 'Priya' } }, both()) === '');

// ---- what is sent for a choice ----
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
check('choice: a logo', same(T.applyBody('logo:7', 0), { what: 'logo', exhibitor_id: 7, file: 0 }));
check('choice: a talk photo, the second file', same(T.applyBody('talk:3', 1), { what: 'talk_photo', talk_id: 3, file: 1 }));
check('choice: a speaker photo', same(T.applyBody('speaker:9', 0), { what: 'speaker_photo', speaker_id: 9, file: 0 }));
check('choice: nothing chosen, or something this screen does not do, sends nothing', T.applyBody('', 0) === null && T.applyBody('logo:', 0) === null && T.applyBody('delete:5', 0) === null && T.applyBody('logo:abc', 0) === null && T.applyBody(null, 0) === null);

// ---- what was done, in words ----
check('done: a logo by a person', T.usedWords({ what: 'logo', target: 'Acme Robotics', by: 'Priya' }) === 'Logo of Acme Robotics, by Priya');
check('done: a photo, automatically', T.usedWords({ what: 'talk_photo', target: 'Dr. Asha Rao (Acme Robotics)', by: 'automatic' }) === 'Photo for the talk of Dr. Asha Rao (Acme Robotics), automatically');
check('done: a speaker photo, and people', T.usedWords({ what: 'speaker_photo', target: 'Neha Kapoor', by: 'Priya' }) === 'Photo of Neha Kapoor, by Priya'
  && T.usedWords({ what: 'team', target: 'Acme Robotics', by: 'Priya', people: [{}, {}] }) === '2 added to the team of Acme Robotics, by Priya');
const used = row({ applied: [
  { what: 'logo', target: 'Zenith', file: 0, by: 'Priya', undone: '2026-11-12T05:00:00Z' },
  { what: 'logo', target: 'Acme Robotics', file: 0, by: 'Priya' },
  { what: 'talk_photo', target: 'Dr. Asha Rao', file: 1, by: 'Anita' },
  { what: 'team', target: 'Acme Robotics', by: 'Priya', people: [{}] },
] });
const u0 = T.usesOfFile(used, 0), u1 = T.usesOfFile(used, 1);
check('done: each file lists its own uses, the undone one left out, with the place to undo', u0.length === 1 && u0[0].index === 1 && u0[0].text === 'Logo of Acme Robotics, by Priya' && u1.length === 1 && u1[0].index === 2 && T.usesOfFile(used, 5).length === 0, [u0, u1]);
check('done: a row with nothing done lists nothing', T.usesOfFile(row(), 0).length === 0 && T.usesOfFile(null, 0).length === 0);

// ---- small words ----
check('a match reads as name and company', T.matchLine({ name: 'Dr. Asha Rao', detail: 'Acme Robotics' }) === 'Dr. Asha Rao (Acme Robotics)' && T.matchLine({ name: 'Acme Robotics', detail: '' }) === 'Acme Robotics' && T.matchLine(null) === '');
check('tab counts: missing is nought', T.tabCount({ new: 4 }, 'new') === 4 && T.tabCount({ new: 4 }, 'applied') === 0 && T.tabCount(null, 'new') === 0);

// ---- 13 Nov 2026: search, a name for the website, the schedule, whose desk ----
const TG = {
  exhibitors: [{ id: 7, name: 'Acme Robotics Pvt Ltd', has: false }, { id: 8, name: 'Zenith Data Labs', has: true }, { id: 12, name: 'No Broker Technologies', has: false }],
  talks: [{ id: 3, name: 'Dr. Asha Rao', company: 'Acme Robotics Pvt Ltd', has: false }],
  speakers: [{ id: 9, name: 'Neha Kapoor', organisation: 'Bank of the North', has: true }],
  people: [{ name: 'Mahalakshmi AV', org: 'AWS' }, { name: 'Vishal Rally', org: 'Tata Tele Business Services' }],
  orgs: ['AWS', 'Tata Tele Business Services', 'Bank of the North'],
};
const pngF = { use: 'logo', mime: 'image/png' }, photoF = { use: 'photo', mime: 'image/jpeg' }, svgF = { use: 'logo', mime: 'image/svg+xml' }, pdfF = { use: '', mime: 'application/pdf' };
const hitsFor = (q, f, r = row()) => T.findHits(q, r, f, TG);
check('fold: case, accents, dots and titles do not matter', T.fold('Dr. Ásha  RAO') === 'asha rao' && T.fold("Hon’ble Shri Devendra Fadnavis") === 'devendra fadnavis' && T.fold(null) === '');
check('fit: the name exactly, its start, every word, with the company, run together, not at all',
  T.fitScore('zenith data labs', 'Zenith Data Labs') === 100 && T.fitScore('zen', 'Zenith Data Labs') === 80 && T.fitScore('labs zenith', 'Zenith Data Labs') === 60
  && T.fitScore('asha acme', 'Dr. Asha Rao', 'Acme Robotics') === 30 && T.fitScore('nobroker', 'No Broker Technologies') === 50 && T.fitScore('xyz', 'Zenith Data Labs') === 0 && T.fitScore('', 'Zenith') === 0);
let hh = hitsFor('acme', pngF);
check('search: a logo finds the exhibitor first (it changes the app), and the talk too', hh.hits[0].value === 'logo:7' && hh.hits[0].app === true && hh.hits.some((x) => x.value === 'talk:3'), hh);
hh = hitsFor('aws', pngF);
check('search: a company that is not an exhibitor is offered as a name for the website', hh.hits.some((x) => x.value === 'tag:logo:AWS' && !x.app) && hh.hits.some((x) => x.value === 'tag:photo:Mahalakshmi AV (AWS)'), hh);
check('search: in a photo, the person on the schedule is found by name', hitsFor('maha', photoF).hits[0].value === 'tag:photo:Mahalakshmi AV (AWS)', hitsFor('maha', photoF));
hh = hitsFor('neha', svgF);
check('search: a vector file is never offered as a photo', !hh.hits.some((x) => /^(talk|speaker|tag:photo):/.test(x.value)), hh);
hh = hitsFor('zenith', pdfF);
check('search: a PDF is named for the website, never put in the app', hh.hits.length > 0 && hh.hits.every((x) => !x.app && /^tag:logo:/.test(x.value)), hh);
check('search: a name typed exactly is marked, so "name it yourself" is not offered for it again', hitsFor('zenith data labs', pngF).exact === true && hitsFor('aws', pngF).exact === true && hitsFor('zen', pngF).exact === false && hitsFor('aw', pngF).exact === false);
const many = { ...TG, orgs: Array.from({ length: 20 }, (_, i) => 'Alpha ' + i) };
check('search: eight shown at most, the rest counted', T.findHits('alpha', row(), pngF, many).hits.length === 8 && T.findHits('alpha', row(), pngF, many).more === 12);
check('search: the email\'s own suggestion comes first among equals', T.findHits('technologies', row({ matches: M({ exhibitors: [{ id: 12, name: 'No Broker Technologies', how: 'x' }] }) }), pngF, { ...TG, exhibitors: [{ id: 30, name: 'Alpha Technologies' }, { id: 12, name: 'No Broker Technologies' }] }).hits[0].value === 'logo:12');
check('search: nothing typed finds nothing', hitsFor('', pngF).hits.length === 0 && hitsFor('   ', pngF).hits.length === 0);
check('team search: exhibitors only', T.teamHits('zen', row(), TG).hits[0].value === '8' && T.teamHits('asha', row(), TG).hits.length === 0 && T.teamHits('aws', row(), TG).hits.length === 0);
check('a name chosen: read back and cleaned; nothing is not a name', same(T.tagOf('tag:logo:  AWS  '), { as: 'logo', name: 'AWS' }) && same(T.tagOf('tag:photo:Mahalakshmi AV (AWS)'), { as: 'photo', name: 'Mahalakshmi AV (AWS)' })
  && T.tagOf('tag:logo: ') === null && T.tagOf('tag:video:x y') === null && T.tagOf('logo:7') === null && T.tagOf('tag:logo:a<script>b').name === 'a script b' && T.tagOf(null) === null);
check('choice: a name for the website', same(T.applyBody('tag:logo:Tata Tele Business Services', 2), { what: 'tag', as: 'logo', name: 'Tata Tele Business Services', file: 2 }) && T.applyBody('tag:logo:', 0) === null);
check('done: a name, in words', T.usedWords({ what: 'tag', as: 'photo', target: 'Mahalakshmi AV (AWS)', by: 'Priya' }) === 'Named: photo of Mahalakshmi AV (AWS), for the website, by Priya'
  && T.usedWords({ what: 'tag', as: 'logo', target: 'AWS', by: 'automatic' }) === 'Named: logo of AWS, for the website, automatically');
const mala = row({ from_name: '"A V, Mahalakshmi"' });
check('schedule: "A V, Mahalakshmi" is Mahalakshmi AV; nobody else is anybody', T.schedFor(mala, TG)?.name === 'Mahalakshmi AV' && T.schedFor(row({ from_name: 'Vishal Rally' }), TG)?.org === 'Tata Tele Business Services'
  && T.schedFor(row({ from_name: 'Someone Else' }), TG) === null && T.schedFor(row({ from_name: '' }), TG) === null && T.schedFor(row({ from_name: 'AV' }), TG) === null);
check('AI read a company we know', T.aiOrg({ ai: { reads: 'aws' } }, TG) === 'AWS' && T.aiOrg({ ai: { reads: 'Tata Tele Business Services.' } }, TG) === 'Tata Tele Business Services'
  && T.aiOrg({ ai: { reads: 'eurys' } }, TG) === '' && T.aiOrg({ ai: { failed: true, reads: 'AWS' } }, TG) === '' && T.aiOrg({}, TG) === '');
check('picker: a panellist\'s logo starts on their company, their photo on them', T.defaultChoice(pngF, mala, { sched: T.schedFor(mala, TG) }) === 'tag:logo:AWS'
  && T.defaultChoice(photoF, row({ kind: 'photo' }), { sched: T.schedFor(mala, TG) }) === 'tag:photo:Mahalakshmi AV (AWS)');
check('picker: an exhibitor suggestion still comes before the schedule and the AI', T.defaultChoice(pngF, row({ matches: M({ exhibitors: [acme] }) }), { sched: { name: 'X Y', org: 'AWS' }, org: 'AWS' }) === 'logo:7');
check('picker: a company the AI read', T.defaultChoice(pngF, row(), { org: 'AWS' }) === 'tag:logo:AWS' && T.defaultChoice(pngF, row()) === '');
check('words: an email\'s entities become the characters', T.plain('&#39;Bharat AI&#39; &lt;a@b.in&gt;') === "'Bharat AI' <a@b.in>" && T.plain('&amp;&#x41;&quot;') === '&A"' && T.plain('&#0; &bogus;') === '&#0; &bogus;' && T.plain(null) === '');
check('words: decoded, then escaped: never markup', T.esc(T.plain('&lt;img src=x onerror=alert(1)&gt;')) === '&lt;img src=x onerror=alert(1)&gt;');
check('sender: Outlook\'s quotes dropped', T.senderName({ from_name: '"Vijayan, Sunita"' }) === 'Vijayan, Sunita' && T.senderName({}) === '' && T.senderName(null) === '');
const teamNames = ['Anita Ram', 'Anita Rao', 'Puja Shah', 'Tushar Kale'];
check('me: the name on the team in any case, or a first name only one of them has', T.meOf('puja shah', teamNames) === 'Puja Shah' && T.meOf('Tushar', teamNames) === 'Tushar Kale'
  && T.meOf('Anita', teamNames) === null && T.meOf('', teamNames) === null && T.meOf('Priya', teamNames) === null && T.meOf('Puja', []) === null);
const ro = (name) => row({ owner: { name } });
check('views: everyone\'s, nobody\'s, one person\'s', T.whoMatches(ro(''), '') && T.whoMatches(ro('Puja Shah'), '') && T.whoMatches(ro(''), '-') && !T.whoMatches(ro('Puja Shah'), '-')
  && T.whoMatches(ro('Puja Shah'), 'puja shah') && !T.whoMatches(ro('Tushar Kale'), 'Puja Shah') && T.whoMatches(row(), '-'));
check('owner: why, in words', T.ownerHow({ name: 'Puja Shah', how: 'named', mailbox: 'puja@aegis.edu.in' }) === 'it came to puja@aegis.edu.in' && T.ownerHow({ name: 'Tushar Kale', how: 'set' }) === 'chosen for this email'
  && T.ownerHow({ name: '', how: '', mailbox: 'register@x.in' }) === 'nobody has register@x.in yet' && T.ownerHow({ name: '', how: 'shared', mailbox: 'register@x.in' }) === 'register@x.in is shared' && T.ownerHow({}) === 'not sent to a team mailbox');
const keynote = { ...TG, people: [{ name: 'Devendra Fadnavis', org: '', role: 'Chief Minister of Maharashtra' }] };
const kh = T.findHits('fadnavis', row(), photoF, keynote).hits[0];
check('search: a keynote\'s title is shown with them, never kept in the name for the website', kh.value === 'tag:photo:Devendra Fadnavis' && kh.text === 'Photo of Devendra Fadnavis, Chief Minister of Maharashtra', kh);
check('picker: a keynote speaker\'s logo never starts on their job title', T.defaultChoice(pngF, row(), { sched: { name: 'Shri Praveen Pardeshi', org: '', role: 'CEO, MITRA' } }) === '');
check('picker: a panellist whose company exhibits starts on that exhibitor\'s logo', T.defaultChoice(pngF, row(), { sched: { name: 'A B', org: 'Acme Robotics' }, schedEx: 7 }) === 'logo:7');
check('an exhibitor by its name, without Pvt Ltd', T.exhibitorNamed('Acme Robotics', TG) === 7 && T.exhibitorNamed('acme robotics private limited', TG) === 7 && T.exhibitorNamed('AWS', TG) === 0 && T.exhibitorNamed('', TG) === 0);
check('schedule: a name with a rank and a title in brackets is still the sender', T.schedFor(row({ from_name: 'Dr. Jadumani Jena' }), { people: [{ name: 'Cmde Dr. Jadumani Jena (retd.)', org: '', role: 'Former Commodore' }] })?.name === 'Cmde Dr. Jadumani Jena (retd.)');
check('a photo: a person in it, or called one; never a PDF or a vector', T.looksLikePhoto(photoF) && T.looksLikePhoto({ use: 'logo', mime: 'image/png', ai: { person: true } }) && !T.looksLikePhoto(pngF) && !T.looksLikePhoto({ use: 'photo', mime: 'image/svg+xml' }) && !T.looksLikePhoto(null));

done();
