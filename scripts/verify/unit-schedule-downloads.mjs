// Unit: the programme downloads in Admin -> Conference (12 Nov 2026): the PDF page with
// and without speaker photos, and the Excel workbook. The screen's own builders are
// loaded from public/static/conference-admin.js into a sandbox (no browser) and given
// a small programme. The workbook is then read back with the spreadsheet library the
// admin page ships (public/js/vendor/xlsx.full.min.js), so it is a file Excel opens.
// Run:  node scripts/verify/unit-schedule-downloads.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// The library is a browser script: run it as one and take the global it leaves.
const xbox = vm.createContext({ console, setTimeout, clearTimeout, Uint8Array, ArrayBuffer, DataView, TextDecoder, TextEncoder, Buffer });
xbox.window = xbox; xbox.self = xbox; xbox.globalThis = xbox;
vm.runInContext(readFileSync(new URL('../../public/js/vendor/xlsx.full.min.js', import.meta.url), 'utf8'), xbox);
const XLSX = xbox.XLSX;
const src = readFileSync(new URL('../../public/static/conference-admin.js', import.meta.url), 'utf8');
const win = {};
const box = vm.createContext({ window: win, TextEncoder, Uint8Array, Date, Math, JSON, String, Number, Array, Object, isNaN, parseInt, setTimeout, EID: 1 });
vm.runInContext(src, box);
const C = win.ConfDesk;

let fails = 0, passes = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 400))); if (ok) passes++; else fails++; };

const D1 = '2026-11-20', D2 = '2026-11-21';
const data = {
  words: { name: 'Bharat AI Innovation 2026', when: '20-21 November 2026', venue: 'World Trade Center, Mumbai', line: '20-21 November 2026 · World Trade Center, Mumbai' },
  days: [D1, D2],
  halls: [{ name: 'Homi J. Bhabha Hall', venue_room: 'Peacock Hall', location: 'Ground Floor, Centre One', sort_order: 1 }, { name: 'Aryabhata Theatre', venue_room: 'Expo Hall', location: 'On the exhibition floor', sort_order: 4 }],
  speakers: [{ id: 1, name: 'Shri. K.K. Singh', role: 'Joint Secretary', organisation: 'MeitY', photo_url: '/images/speaker-kk.webp', email: 'kk@private.test', phone: '9820011111' },
    { id: 2, name: 'Tarun Chugh', role: 'MD & CEO', organisation: 'Bajaj Life', photo_url: '' }, { id: 3, name: 'Shailesh Dhuri', role: 'CEO', organisation: 'Decimal Point', photo_url: 'https://cdn.example.test/s.jpg' }],
  sessions: [
    { id: 1, title: 'Registration', session_type: 'break', room: 'Homi J. Bhabha Hall', start_time: D1 + ' 08:30', end_time: D1 + ' 09:30', links: [], others: '', status: 'published' },
    { id: 2, title: 'AI for <Bharat> & "all"', session_type: 'keynote', room: 'Homi J. Bhabha Hall', start_time: D1 + ' 10:00', end_time: D1 + ' 10:10', links: [{ speaker_id: 1, role: 'keynote' }], others: '', status: 'published', track: 'Government' },
    { id: 3, title: 'AI in Banking', session_type: 'panel', room: 'Homi J. Bhabha Hall', start_time: D1 + ' 14:00', end_time: D1 + ' 15:00', links: [{ speaker_id: 2, role: 'panellist' }, { speaker_id: 3, role: 'moderator' }], others: 'Ratan Kesh (Bandhan Bank)', status: 'published' },
    { id: 4, title: 'Innovation Talk: Paisani', session_type: 'talk', room: 'Aryabhata Theatre', start_time: D1 + ' 11:30', end_time: D1 + ' 11:38', links: [], others: 'Dipak Zope', speaker_title: 'CEO, Paisani', status: 'published',
      talks: [{ id: 9, speaker_name: 'Dipak Zope', speaker_title: 'Chief Executive Officer', company: 'Paisani Technology Services', photo_url: '/images/talks/dipak-zope.webp' }] },
    { id: 5, title: 'Secret draft session', session_type: 'talk', room: 'Aryabhata Theatre', start_time: D1 + ' 12:00', end_time: D1 + ' 12:30', links: [{ speaker_id: 2, role: 'speaker' }], others: '', status: 'draft' },
    { id: 6, title: 'Day two talk', session_type: 'talk', room: 'Aryabhata Theatre', start_time: D2 + ' 11:00', end_time: D2 + ' 11:30', links: [], others: 'Asha Rao', speaker_title: 'Director, Somewhere', status: 'published' },
  ],
};

// ---- who is on stage ----
let p = C._peopleOf(data, data.sessions[2]);
check('a panel lists its speakers with the line under each, the moderator marked, and the hand-typed one', p.length === 3 && p[0].name === 'Tarun Chugh' && p[0].line === 'MD & CEO, Bajaj Life' && p[1].part === 'Moderator' && p[2].name === 'Ratan Kesh' && p[2].line === 'Bandhan Bank', p);
p = C._peopleOf(data, data.sessions[3]);
check("an Innovation Talk's speaker comes from the talks list, once, with the photo", p.length === 1 && p[0].name === 'Dipak Zope' && p[0].line === 'Chief Executive Officer, Paisani Technology Services' && p[0].photo === '/images/talks/dipak-zope.webp', p);
p = C._peopleOf(data, data.sessions[5]);
check('one hand-typed speaker keeps the line under the name', p.length === 1 && p[0].line === 'Director, Somewhere', p);

// ---- the PDF page ----
const withP = C._scheduleHtml(data, { photos: true, origin: 'https://example.test', asOf: 'Thu 12 Nov 2026', autoPrint: false });
const without = C._scheduleHtml(data, { photos: false, origin: 'https://example.test', asOf: 'Thu 12 Nov 2026', autoPrint: false });
check('it is one whole page with the event name, its dates and venue', /^<!doctype html>/.test(withP) && withP.includes('<h1>Bharat AI Innovation 2026</h1>') && withP.includes('20-21 November 2026 · World Trade Center, Mumbai'));
check('each day has its heading: Day 1, Friday 20 November 2026', withP.includes('<span>Day 1</span>Friday 20 November 2026') && withP.includes('<span>Day 2</span>Saturday 21 November 2026'));
check('each hall is named both ways, with where to find it', withP.includes('Homi J. Bhabha Hall <small>Peacock Hall, Ground Floor, Centre One</small>') && withP.includes('Aryabhata Theatre <small>Expo Hall, On the exhibition floor</small>'));
check('times read as people say them', withP.includes('<b>10:00 am</b><span>to 10:10 am</span>') && withP.includes('<b>2:00 pm</b>'));
check('a draft is left out, and counted in a note for the team', !withP.includes('Secret draft session') && withP.includes('1 drafts left out'));
check('text is escaped: a title with < > & " cannot break the page', withP.includes('AI for &lt;Bharat&gt; &amp; &quot;all&quot;') && !withP.includes('<Bharat>'));
check('with photos: a photo beside a speaker who has one, the full address', withP.includes('<img class="ph" src="https://example.test/images/speaker-kk.webp"') && withP.includes('<img class="ph" src="https://cdn.example.test/s.jpg"') && withP.includes('src="https://example.test/images/talks/dipak-zope.webp"'));
check('with photos: initials in a circle where there is none', withP.includes('<span class="ph is-none">T</span>') && withP.includes('<span class="ph is-none">R</span>'));
check('without photos: no speaker picture at all, the same words', !without.includes('class="ph') || !/<(img|span) class="ph/.test(without));
check('...and nothing else is lost', without.includes('Tarun Chugh') && without.includes('MD &amp; CEO, Bajaj Life') && without.includes('<em>Moderator</em>') && without.includes('Ratan Kesh'));
check('the only picture without photos is the logo', (without.match(/<img /g) || []).length === 1 && /logo-nav\.webp/.test(without));
check("no speaker's email or mobile is anywhere on either page", !/kk@private|9820011111/.test(withP + without));
check('it is made for A4 paper, keeps a row whole, and hides its button when printed', withP.includes('@page{size:A4') && withP.includes('tr{break-inside:avoid}') && withP.includes('@media print{body{background:#fff}.bar{display:none}'));
check('it asks the browser to print (Save as PDF) once loaded, unless told not to', C._scheduleHtml(data, { photos: true, origin: '' }).includes('window.print()},500)') && !/setTimeout\(function\(\)\{window\.print/.test(withP));
check('an empty programme says so instead of a blank page', C._scheduleHtml({ words: data.words, days: [D1], halls: [], speakers: [], sessions: [] }, { autoPrint: false, origin: '' }).includes('Nothing is on the programme yet.'));

// ---- the workbook ----
const sheets = C._programmeSheets(data);
check('two sheets: Programme and Speakers', sheets.length === 2 && sheets[0].name === 'Programme' && sheets[1].name === 'Speakers');
const bytes = C._xlsxBytes(sheets);
check('the file starts as a zip does', bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 3 && bytes[3] === 4 && bytes.length > 3000, bytes.length);
const wb = XLSX.read(Buffer.from(bytes), { type: 'buffer', cellStyles: true });
check('a spreadsheet program reads it: both sheets by name', wb.SheetNames.join() === 'Programme,Speakers', wb.SheetNames);
const P = XLSX.utils.sheet_to_json(wb.Sheets.Programme, { header: 1, defval: '' });
check('the title and the line under it', P[0][0] === 'Bharat AI Innovation 2026: programme' && /20-21 November 2026 · World Trade Center, Mumbai/.test(P[1][0]) && /times are India time/.test(P[1][0]), P.slice(0, 2));
check('the heading row', P[3].join('|') === 'Day|Date|Starts|Ends|Hall|Room at the venue|Type|Session|Speakers|Designation and organisation|Track', P[3]);
check('a band for each day', P[4][0] === 'Day 1  ·  Friday 20 November 2026' && P.some(r => r[0] === 'Day 2  ·  Saturday 21 November 2026'));
const key = P.find(r => /AI for/.test(r[7]));
check('a row: day, date, times, both hall names, type, title, speaker, their line, track', key.join('|') === 'Day 1|Fri 20 Nov 2026|10:00 am|10:10 am|Homi J. Bhabha Hall|Peacock Hall|Keynote|AI for <Bharat> & "all"|Shri. K.K. Singh|Joint Secretary, MeitY|Government', key);
const panel = P.find(r => r[7] === 'AI in Banking');
check('a panel: one speaker a line, the moderator marked, the lines matching', panel[8] === 'Tarun Chugh\nShailesh Dhuri (Moderator)\nRatan Kesh' && panel[9] === 'MD & CEO, Bajaj Life\nCEO, Decimal Point\nBandhan Bank', panel.slice(8, 10));
check('rows are in time order across halls, drafts left out', P.filter(r => r[0] === 'Day 1' ).map(r => r[2]).join() === '8:30 am,10:00 am,11:30 am,2:00 pm' && !P.some(r => /Secret draft/.test(r[7])));
const ws = wb.Sheets.Programme;
check('the heading stays in place when scrolling, and can be filtered', /ySplit="4"/.test(ws['!ref'] ? Buffer.from(bytes).toString('latin1') : '') && ws['!autofilter'] && ws['!autofilter'].ref === 'A4:K' + P.length, ws['!autofilter']);
check('the title and each day band run across the sheet', (ws['!merges'] || []).length === 4 && ws['!cols'].length === 11, [ws['!merges'], (ws['!cols'] || []).length]);
const raw = Buffer.from(bytes).toString('latin1');
check('the heading row is white on the brand colour; rows alternate a tint; text wraps', raw.includes('<fgColor rgb="FFC84F00"/>') && raw.includes('<color rgb="FFFFFFFF"/>') && raw.includes('<fgColor rgb="FFF7F8FC"/>') && raw.includes('wrapText="1"'));
check('it prints landscape, fitted to the page width', raw.includes('orientation="landscape" fitToWidth="1"'));
const Sp = XLSX.utils.sheet_to_json(wb.Sheets.Speakers, { header: 1, defval: '' });
check('Speakers: everyone on the programme once, by name, with where and when', Sp[3].join('|') === 'Speaker|Designation|Organisation|Sessions|When and where' && Sp.slice(4).map(r => r[0]).join() === 'Asha Rao,Dipak Zope,Shri. K.K. Singh,Ratan Kesh,Shailesh Dhuri,Tarun Chugh', Sp.slice(4).map(r => r[0]));
const kk = Sp.find(r => r[0] === 'Shri. K.K. Singh');
check('a speaker row: designation, organisation, how many sessions, the slot', kk[1] === 'Joint Secretary' && kk[2] === 'MeitY' && kk[3] === '1' && /Fri 20 Nov, 10:00 am, Homi J\. Bhabha Hall: AI for/.test(kk[4]), kk);
check("no email or mobile is in the workbook, and nobody from a draft", !/kk@private|9820011111/.test(raw) && !/Secret draft/.test(raw));
check('a name with an ampersand survives the round trip', P.find(r => r[7] === 'AI in Banking')[9].includes('MD & CEO'));
const big = C._xlsxBytes([{ name: 'A very long sheet name that goes past thirty-one characters', cols: [10], rows: [[{ v: 'x\u0001y', s: 4 }]], freeze: 0 }]);
const wb2 = XLSX.read(Buffer.from(big), { type: 'buffer' });
check('a sheet name is cut to what Excel allows, and a control character is dropped', wb2.SheetNames[0].length === 31 && XLSX.utils.sheet_to_json(wb2.Sheets[wb2.SheetNames[0]], { header: 1 })[0][0] === 'xy', wb2.SheetNames);

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
