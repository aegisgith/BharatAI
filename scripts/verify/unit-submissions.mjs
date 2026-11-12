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

done();
