/* Admin, Submissions: what clients sent by email, ready to use (12 Nov 2026).
 *
 * Every team mailbox lands in AImailPilot. Each email there that carries a logo, a
 * speaker's photo or a list of the people coming to a booth is filed by the server
 * (INBOX SUBMISSIONS in src/index.tsx) with its files and its best guess of who it is
 * from and what it is for. This screen shows one card per email: the words, the files,
 * and one button per file. Nothing changes until a button is pressed, unless the
 * "without asking" switches are on. A logo or photo is undone with one click.
 *
 * The admin page loads this file the first time Submissions opens and calls
 * SubDesk.mount(element, { api, toast, operator, onCount }). One global, SubDesk.
 * SubDesk._t holds the parts that need no page, for the tests.
 */
(function (w) {
  'use strict';

  var KIND = { logo: 'Logo', photo: 'Photo', team: 'Team list', details: 'Details', other: 'Other' };
  var TABS = [
    { key: 'new', label: 'Waiting' },
    { key: 'applied', label: 'Used' },
    { key: 'dismissed', label: 'Set aside' }
  ];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var IST_MS = 330 * 60000;

  var S = {
    el: null, deps: null, tab: 'new', rows: [], counts: {}, targets: { exhibitors: [], talks: [], speakers: [], people: [], orgs: [] },
    auto: { logo: false, photo: false }, error: '', notYet: '', loading: false, busy: {}, open: {}, pick: {}, teamPick: {},
    // find: what is typed in each search box ("<row>:<file>", "team:<row>"). desks: the team and
    // their mailboxes. who: whose emails are shown ('' everyone's, '-' nobody's, or a name).
    find: {}, desks: { team: [], mailboxes: [] }, who: null,
    // edits: what was typed or unticked in a team list, by row and person, kept across redraws.
    edits: {}
  };
  var WHO_KEY = 'sub_desk_who';

  // ---------------------------------------------------------------- pure parts
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtSize(n) {
    n = Number(n) || 0;
    if (n >= 1048576) return (Math.round(n / 104857.6) / 10) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n + ' bytes';
  }
  // "12 Nov, 12:30 pm" in India, whatever clock the laptop keeps.
  function fmtWhen(iso) {
    var t = new Date(String(iso || '')).getTime();
    if (isNaN(t)) return '';
    var d = new Date(t + IST_MS);
    var h = d.getUTCHours(), m = d.getUTCMinutes();
    var ap = h >= 12 ? 'pm' : 'am';
    h = h % 12; if (h === 0) h = 12;
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ', ' + h + ':' + (m < 10 ? '0' : '') + m + ' ' + ap;
  }
  // Only a link to a web page is ever put in an href.
  function safeLink(u) {
    var v = String(u == null ? '' : u).trim();
    return /^https:\/\//i.test(v) ? v : '';
  }
  // The address the browser shows a stored file from. Keys are made by the server from
  // letters, digits, dots, dashes and slashes; anything else is refused here too.
  function fileUrl(key) {
    var k = String(key || '');
    return /^submissions\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(k) && k.indexOf('..') < 0 ? '/api/uploads/' + k : '';
  }
  function isPicture(f) { return /^image\/(png|jpeg|webp|svg\+xml)$/.test(String(f && f.mime || '')); }
  // A suggestion the team said "No" to is never offered again for that email; the one they said
  // "Yes" to comes first. type: exhibitor | talk | speaker.
  var LIST_OF = { exhibitor: 'exhibitors', talk: 'talks', speaker: 'speakers' };
  function rejectedIds(row, type) {
    var r = (row && row.matches && row.matches.rejected) || {};
    return Array.isArray(r[type]) ? r[type].map(Number) : [];
  }
  function chosenId(row, type) {
    var c = (row && row.matches && row.matches.chosen) || {};
    return c[type] != null && c[type] !== '' ? Number(c[type]) : null;
  }
  function liveSuggestions(row, type) {
    var list = (((row && row.matches) || {})[LIST_OF[type]] || []).slice();
    var rej = rejectedIds(row, type), ch = chosenId(row, type);
    list = list.filter(function (x) { return rej.indexOf(Number(x.id)) < 0; });
    if (ch != null) list.sort(function (a, b) { return (Number(b.id) === ch ? 1 : 0) - (Number(a.id) === ch ? 1 : 0); });
    return list;
  }
  // What the picker starts on for one file: "logo:12", "talk:7", "speaker:3", a name for the
  // website ("tag:logo:AWS") or "". extra (optional): { sched, org } from schedFor() and aiOrg().
  function defaultChoice(file, row, extra) {
    if (file && file.rejected) return '';
    var x = extra || {};
    var ex = liveSuggestions(row, 'exhibitor')[0], tk = liveSuggestions(row, 'talk')[0], sp = liveSuggestions(row, 'speaker')[0];
    var use = String(file && file.use || '');
    var kind = String(row && row.kind || '');
    var mime = String(file && file.mime || '');
    if (mime === 'application/pdf') return '';
    var asLogo = use === 'logo' || (!use && kind === 'logo');
    var asPhoto = use === 'photo' || (!use && kind === 'photo');
    if (mime === 'image/svg+xml') { asLogo = true; asPhoto = false; }
    // The AI read an exhibitor's name in this logo: start there, unless that one was turned down.
    var aiMatch = file && file.ai && file.ai.match ? Number(file.ai.match) : 0;
    if (asLogo && aiMatch && rejectedIds(row, 'exhibitor').indexOf(aiMatch) < 0) return 'logo:' + aiMatch;
    if (asLogo && ex) return 'logo:' + ex.id;
    if (asPhoto && tk) return 'talk:' + tk.id;
    if (asPhoto && sp) return 'speaker:' + sp.id;
    // The sender is on the conference schedule for a company that exhibits: that exhibitor's logo.
    if (asLogo && x.schedEx) return 'logo:' + x.schedEx;
    // Not an exhibitor, a talk or a speaker in the app: the company the AI read, or the sender's
    // company on the conference schedule (13 Nov 2026: AWS's logo from a panellist), named for the
    // website. A keynote's job title is never taken for a company (sched.org is brackets only).
    if (asLogo && x.org) return 'tag:logo:' + x.org;
    if (asLogo && x.sched && x.sched.org) return 'tag:logo:' + x.sched.org;
    if (asPhoto && x.sched) return 'tag:photo:' + x.sched.name + (x.sched.org ? ' (' + x.sched.org + ')' : '');
    return '';
  }
  // The body the server takes for one choice.
  function applyBody(choice, fileIndex) {
    var tg = tagOf(choice);
    if (tg) return { what: 'tag', as: tg.as, name: tg.name, file: fileIndex };
    var p = String(choice || '').split(':');
    var id = parseInt(p[1], 10);
    if (!id) return null;
    if (p[0] === 'logo') return { what: 'logo', exhibitor_id: id, file: fileIndex };
    if (p[0] === 'talk') return { what: 'talk_photo', talk_id: id, file: fileIndex };
    if (p[0] === 'speaker') return { what: 'speaker_photo', speaker_id: id, file: fileIndex };
    return null;
  }
  // What was done with a file, in words, newest first, the undone ones left out.
  function usesOfFile(row, fileIndex) {
    var out = [];
    var a = (row && row.applied) || [];
    for (var i = a.length - 1; i >= 0; i--) {
      var e = a[i];
      if (!e || e.undone || e.file !== fileIndex) continue;
      out.push({ index: i, text: usedWords(e) });
    }
    return out;
  }
  function usedWords(e) {
    var who = e.by === 'automatic' ? 'automatically' : ('by ' + (e.by || 'admin'));
    if (e.what === 'logo') return 'Logo of ' + e.target + ', ' + who;
    if (e.what === 'talk_photo') return 'Photo for the talk of ' + e.target + ', ' + who;
    if (e.what === 'speaker_photo') return 'Photo of ' + e.target + ', ' + who;
    if (e.what === 'team') return (e.people || []).length + ' added to the team of ' + e.target + ', ' + who;
    if (e.what === 'tag') return 'Named: ' + (e.as === 'photo' ? 'photo of ' : 'logo of ') + e.target + ', for the website, ' + who;
    return '';
  }
  function matchLine(m) {
    if (!m) return '';
    return (m.name || '') + (m.detail ? ' (' + m.detail + ')' : '');
  }
  // The few lines a card shows before "Show all".
  function snippet(body) {
    var s = String(body || '').replace(/\n{2,}/g, '\n').trim();
    return s;
  }
  function tabCount(counts, key) { return Number((counts || {})[key]) || 0; }
  // What the AI saw in a picture, in words: a person, and the name written in it.
  function aiWords(f) {
    var a = f && f.ai;
    if (!a || a.failed) return '';
    var bits = [];
    if (a.person === true) bits.push('a person');
    if (a.reads) bits.push('reads “' + String(a.reads).slice(0, 60) + '”');
    if (!bits.length && a.person === false) bits.push('no person, no name');
    return bits.length ? 'AI: ' + bits.join(', ') : '';
  }
  function aiLine(f) { var t = aiWords(f); return t ? '<div class="sb-ai">' + esc(t) + '</div>' : ''; }

  // Words stored before 13 Nov 2026 can still carry an email's entities (&#39;, &lt;). Decoded
  // for showing only; esc() makes the result safe again.
  function plain(s) {
    var cp = function (n, m) { return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; };
    return String(s == null ? '' : s)
      .replace(/&#(\d{1,7});/g, function (m, d) { return cp(Number(d), m); })
      .replace(/&#x([0-9a-f]{1,6});/gi, function (m, h) { return cp(parseInt(h, 16), m); })
      .replace(/&(nbsp|lt|gt|quot|apos|amp);/g, function (m, k) { return { nbsp: ' ', lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }[k]; });
  }
  // The sender's name without the quotes Outlook wraps it in ("Vijayan, Sunita").
  function senderName(row) { return plain(row && row.from_name).replace(/^[\s"']+|[\s"']+$/g, ''); }

  // ---------------------------------------------------------------- search (13 Nov 2026)
  // Words compared the way a person reads them: no case, no accents, no dots, no titles.
  var TITLES_RE = / (dr|mr|mrs|ms|prof|shri|sri|smt|honble|hon|cmde|capt|col|gen|maj|brig|adm|cdr) /g;
  function fold(s) {
    var t = String(s == null ? '' : s).toLowerCase();
    try { t = t.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* kept with its accents */ }
    t = ' ' + t.replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ') + ' ';
    return t.replace(TITLES_RE, ' ').replace(TITLES_RE, ' ').replace(/\s+/g, ' ').trim();
  }
  // How well the words typed fit a name and its company: 0 not at all, 100 the name exactly.
  function fitScore(q, name, extra) {
    var qq = fold(q), n = fold(name), x = fold(extra);
    if (!qq || !n) return 0;
    if (n === qq) return 100;
    if (n.indexOf(qq) === 0) return 80;
    var nw = n.split(' '), xw = x ? x.split(' ') : [], qw = qq.split(' ');
    var inName = 0, ok = true;
    for (var i = 0; i < qw.length && ok; i++) {
      var w = qw[i];
      var starts = function (v) { return v.indexOf(w) === 0; };
      if (nw.some(starts) || (w.length >= 3 && n.indexOf(w) >= 0)) inName++;
      else if (!(xw.some(starts) || (w.length >= 3 && x.indexOf(w) >= 0))) ok = false;
    }
    if (ok) return inName === qw.length ? 60 : 30;
    // Typed without the spaces: "nobroker" for No Broker, "tatatele" for Tata Tele.
    var sq = qq.replace(/ /g, '');
    if (sq.length >= 3 && n.replace(/ /g, '').indexOf(sq) >= 0) return 50;
    if (sq.length >= 3 && x && x.replace(/ /g, '').indexOf(sq) >= 0) return 20;
    return 0;
  }
  // A name typed by a person, as the server keeps it.
  function cleanName(s) { return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120); }
  // A choice that names a file for the website: "tag:logo:AWS", "tag:photo:Mahalakshmi AV (AWS)".
  function tagOf(choice) {
    var m = /^tag:(logo|photo):([\s\S]+)$/.exec(String(choice || ''));
    var name = m ? cleanName(m[2]) : '';
    return name.length >= 2 ? { as: m[1], name: name } : null;
  }
  function tagWords(t) { return (t.as === 'photo' ? 'Photo of ' : 'Logo of ') + t.name; }
  // A picture with a person in it, or one the email or the name calls a photo.
  function looksLikePhoto(file) {
    var mime = String(file && file.mime || '');
    if (mime === 'application/pdf' || mime === 'image/svg+xml') return false;
    return !!file && (file.use === 'photo' || !!(file.ai && file.ai.person === true));
  }
  var HITS_SHOWN = 8;
  function byScore(a, b) { return b.score - a.score || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0); }
  // What the words typed in a file's search box can mean, best first: an exhibitor's logo, a
  // talk's or a speaker's photo (these change the app), or a person or a company that is not in
  // the app (on the conference schedule, a speaker's company: named, for the website only). The
  // email's own suggestions and the kind of file break ties. exact: the words are a name we know.
  function findHits(q, row, file, targets) {
    var t = targets || {};
    var mime = String(file && file.mime || '');
    var pdf = mime === 'application/pdf', svg = mime === 'image/svg+xml', photoOk = !pdf && !svg;
    var personish = looksLikePhoto(file);
    var ids = function (type) { return liveSuggestions(row, type).map(function (x) { return Number(x.id); }); };
    var sx = ids('exhibitor'), st = ids('talk'), ss = ids('speaker');
    var out = [], exact = false;
    var add = function (score, isPhoto, inMail, hit) {
      if (!score) return;
      // Typed exactly as a name we know: that result is the one, so it is not offered again as typed.
      if (score >= 100) exact = true;
      hit.score = score + (inMail ? 5 : 0) + (isPhoto === personish ? 3 : 0);
      out.push(hit);
    };
    (t.exhibitors || []).forEach(function (e) {
      var s = fitScore(q, e.name, ''), mine = sx.indexOf(Number(e.id)) >= 0;
      if (pdf) add(s, false, mine, { value: 'tag:logo:' + e.name, text: 'Logo of ' + e.name, note: 'exhibitor; a PDF is named for the website only', app: false });
      else add(s, false, mine, { value: 'logo:' + e.id, text: 'Logo of ' + e.name, note: 'exhibitor' + (e.has ? ', has a logo now' : '') + ': shows in the app', app: true });
    });
    if (photoOk) {
      (t.talks || []).forEach(function (x) {
        add(fitScore(q, x.name, x.company), true, st.indexOf(Number(x.id)) >= 0, { value: 'talk:' + x.id, text: 'Photo for the talk of ' + x.name + (x.company ? ', ' + x.company : ''), note: 'Innovation Talk' + (x.has ? ', has a photo now' : '') + ': shows in the app', app: true });
      });
      (t.speakers || []).forEach(function (x) {
        add(fitScore(q, x.name, x.organisation), true, ss.indexOf(Number(x.id)) >= 0, { value: 'speaker:' + x.id, text: 'Photo of ' + x.name + (x.organisation ? ', ' + x.organisation : ''), note: 'speaker' + (x.has ? ', has a photo now' : '') + ': shows in the app', app: true });
      });
      (t.people || []).forEach(function (x) {
        // org: a company in brackets on the schedule; role: a keynote's title, or Moderator.
        var detail = x.org || x.role || '';
        add(fitScore(q, x.name, (x.org || '') + ' ' + (x.role || '')), true, false, { value: 'tag:photo:' + x.name + (x.org ? ' (' + x.org + ')' : ''), text: 'Photo of ' + x.name + (detail ? ', ' + detail : ''), note: 'on the conference schedule: named for the website', app: false });
      });
    }
    (t.orgs || []).forEach(function (o) {
      add(fitScore(q, o, ''), false, false, { value: 'tag:logo:' + o, text: 'Logo of ' + o, note: 'not an exhibitor: named for the website', app: false });
    });
    out.sort(byScore);
    return { hits: out.slice(0, HITS_SHOWN), more: Math.max(0, out.length - HITS_SHOWN), exact: exact };
  }
  // The exhibitors the words typed in a team list's search box can mean.
  function teamHits(q, row, targets) {
    var sx = liveSuggestions(row, 'exhibitor').map(function (x) { return Number(x.id); });
    var out = [];
    ((targets || {}).exhibitors || []).forEach(function (e) {
      var s = fitScore(q, e.name, '');
      if (s) out.push({ value: String(e.id), text: e.name, note: 'exhibitor', score: s + (sx.indexOf(Number(e.id)) >= 0 ? 5 : 0) });
    });
    out.sort(byScore);
    return { hits: out.slice(0, HITS_SHOWN), more: Math.max(0, out.length - HITS_SHOWN) };
  }
  // The sender, when they are on the conference schedule: "A V, Mahalakshmi" is Mahalakshmi AV.
  // Only one person may fit; two is nobody.
  function schedFor(row, targets) {
    var name = senderName(row);
    if (!name) return null;
    var parts = name.split(',');
    var forms = parts.length === 2 ? [name, parts[1] + ' ' + parts[0]] : [name];
    var flat = forms.map(function (n) { return fold(n).replace(/ /g, ''); }).filter(function (k) { return k.length >= 5; });
    var sorted = forms.map(function (n) { return fold(n).split(' ').sort().join(' '); }).filter(function (k) { return k.indexOf(' ') > 0; });
    var found = ((targets && targets.people) || []).filter(function (p) {
      var f = fold(String(p.name || '').replace(/\s*\([^()]*\)\s*$/, ''));
      return flat.indexOf(f.replace(/ /g, '')) >= 0 || sorted.indexOf(f.split(' ').sort().join(' ')) >= 0;
    });
    return found.length === 1 ? found[0] : null;
  }
  // The exhibitor a company name is, without "Pvt Ltd" and the like: its id, or 0.
  function orgKey(s) { return fold(s).replace(/\b(pvt|private|ltd|limited|inc|llp|llc|corp|corporation|company|the)\b/g, ' ').replace(/ /g, ''); }
  function exhibitorNamed(name, targets) {
    var k = orgKey(name);
    if (k.length < 2) return 0;
    var list = (targets && targets.exhibitors) || [];
    for (var i = 0; i < list.length; i++) if (orgKey(list[i].name) === k) return Number(list[i].id) || 0;
    return 0;
  }
  // A company the AI read in a logo that is not an exhibitor but is known (the schedule's, a speaker's).
  function aiOrg(file, targets) {
    var r = file && file.ai && !file.ai.failed ? fold(file.ai.reads).replace(/ /g, '') : '';
    if (r.length < 2) return '';
    var orgs = (targets && targets.orgs) || [];
    for (var i = 0; i < orgs.length; i++) if (fold(orgs[i]).replace(/ /g, '') === r) return orgs[i];
    return '';
  }

  // ---------------------------------------------------------------- whose desk (13 Nov 2026)
  // Who is looking: the name at the top right of Admin as it is on the team, or a first name only
  // one of the team has. null when it is not on the team.
  function meOf(operator, team) {
    var o = String(operator || '').replace(/\s+/g, ' ').trim().toLowerCase();
    var list = team || [];
    if (!o) return null;
    for (var i = 0; i < list.length; i++) if (String(list[i]).toLowerCase() === o) return list[i];
    var fits = list.filter(function (n) { var l = String(n).toLowerCase(); return l.split(' ')[0] === o || l.indexOf(o + ' ') === 0; });
    return fits.length === 1 ? fits[0] : null;
  }
  function ownerName(row) { return String((row && row.owner && row.owner.name) || ''); }
  // Is a row in the view: '' everyone's, '-' nobody's, or one person's.
  function whoMatches(row, who) {
    if (!who) return true;
    if (who === '-') return !ownerName(row);
    return ownerName(row).toLowerCase() === String(who).toLowerCase();
  }
  // Why an email is someone's, in words.
  function ownerHow(o) {
    o = o || {};
    if (o.how === 'set') return 'chosen for this email';
    if (o.name) return o.mailbox ? 'it came to ' + o.mailbox : '';
    if (o.how === 'shared') return o.mailbox + ' is shared';
    return o.mailbox ? 'nobody has ' + o.mailbox + ' yet' : 'not sent to a team mailbox';
  }

  // ---------------------------------------------------------------- drawing
  function optionList(row, file, choice) {
    var t = S.targets, m = row.matches || {};
    var first = function (list, ids) {
      var top = [], rest = [];
      list.forEach(function (x) { (ids.indexOf(x.id) >= 0 ? top : rest).push(x); });
      top.sort(function (a, b) { return ids.indexOf(a.id) - ids.indexOf(b.id); });
      return top.concat(rest);
    };
    var ids = function (list) { return (list || []).map(function (x) { return x.id; }); };
    m = { exhibitors: liveSuggestions(row, 'exhibitor'), talks: liveSuggestions(row, 'talk'), speakers: liveSuggestions(row, 'speaker') };
    var pdf = file.mime === 'application/pdf';
    var svg = file.mime === 'image/svg+xml';
    var h = '<option value="">' + (pdf ? 'Type whose logo it is, above' : 'Choose what this is…') + '</option>';
    // A name for the website, chosen in the search box: the one option that says it.
    var tg = tagOf(choice);
    if (tg) h += '<optgroup label="Named for the website (the app does not change)"><option value="' + esc(choice) + '">' + esc(tagWords(tg)) + '</option></optgroup>';
    if (!pdf) {
      h += '<optgroup label="Logo of an exhibitor">' + first(t.exhibitors, ids(m.exhibitors)).map(function (e) {
        return '<option value="logo:' + e.id + '">' + esc(e.name) + (e.has ? ' (has a logo)' : '') + '</option>';
      }).join('') + '</optgroup>';
    }
    if (!pdf && !svg) {
      h += '<optgroup label="Photo for an Innovation Talk">' + first(t.talks, ids(m.talks)).map(function (x) {
        return '<option value="talk:' + x.id + '">' + esc(x.name) + (x.company ? ', ' + esc(x.company) : '') + (x.has ? ' (has a photo)' : '') + '</option>';
      }).join('') + '</optgroup>';
      h += '<optgroup label="Photo of a confirmed speaker">' + first(t.speakers, ids(m.speakers)).map(function (x) {
        return '<option value="speaker:' + x.id + '">' + esc(x.name) + (x.organisation ? ', ' + esc(x.organisation) : '') + (x.has ? ' (has a photo)' : '') + '</option>';
      }).join('') + '</optgroup>';
    }
    return h;
  }
  // A search box and what it found, under it. key: "<row>:<file>" or "team:<row>".
  function findHtml(key, placeholder) {
    return '<div class="sb-find"><input type="search" data-find="' + esc(key) + '" value="' + esc(S.find[key] || '') + '" placeholder="' + esc(placeholder) + '" aria-label="' + esc(placeholder) + '" autocomplete="off" spellcheck="false">' +
      '<div class="sb-hits" data-hits="' + esc(key) + '">' + hitsHtml(key) + '</div></div>';
  }
  function hitsHtml(key) {
    var q = cleanName(S.find[key] || '');
    if (!q) return '';
    var team = key.indexOf('team:') === 0;
    var row = rowOf(team ? key.slice(5) : key.split(':')[0]);
    if (!row) return '';
    var btn = function (h) {
      return '<button type="button" class="sb-hit" data-act="' + (team ? 'team-hit' : 'hit') + '" data-key="' + esc(key) + '" data-value="' + esc(h.value) + '"' + (h.app ? ' data-app="1"' : '') + '>' +
        esc(h.text) + '<small>' + esc(h.note) + '</small></button>';
    };
    var more = function (n) { return n ? '<div class="sb-none">' + n + ' more: type more of the name.</div>' : ''; };
    if (team) {
      var r = teamHits(q, row, S.targets);
      return r.hits.map(btn).join('') + more(r.more) +
        (r.hits.length ? '' : '<div class="sb-none">No exhibitor called “' + esc(q) + '”. People can only join an exhibitor’s team: add the company under Exhibitors first.</div>');
    }
    var file = (row.attachments || [])[parseInt(key.split(':')[1], 10)];
    if (!file) return '';
    var f = findHits(q, row, file, S.targets);
    var h = f.hits.map(btn).join('') + more(f.more);
    if (!f.hits.length) h += '<div class="sb-none">Nobody called “' + esc(q) + '” on our lists.</div>';
    if (!f.exact && !tagOf('tag:logo:' + q)) h += '<div class="sb-none">Type at least two letters to name it yourself.</div>';
    else if (!f.exact) {
      var mime = String(file.mime || '');
      var photoOk = mime !== 'application/pdf' && mime !== 'image/svg+xml';
      var own = function (as) {
        return '<button type="button" class="sb-btn sb-btn-own" data-act="hit" data-key="' + esc(key) + '" data-value="' + esc('tag:' + as + ':' + q) + '">' + esc((as === 'photo' ? 'Photo of “' : 'Logo of “') + q + '”') + '</button>';
      };
      h += '<div class="sb-own"><span class="sb-note">' + (f.hits.length ? 'None of these? ' : '') + 'Name it yourself, for the website:</span>' +
        (looksLikePhoto(file) ? own('photo') + own('logo') : own('logo') + (photoOk ? own('photo') : '')) + '</div>';
    }
    return h;
  }
  function uploadHtml(row) {
    return '<label class="sb-upload" title="PNG, JPEG, WebP, SVG or PDF, up to 8 MB">' +
      '<input type="file" data-upload="' + row.id + '" accept="image/png,image/jpeg,image/webp,image/svg+xml,application/pdf">' +
      '<span>⬆ Upload a better logo or photo</span></label>';
  }
  function ownerHtml(row) {
    var o = row.owner || {};
    var team = ((S.desks && S.desks.team) || []).slice();
    if (!team.length && !o.name) return '';
    if (o.name && team.indexOf(o.name) < 0) team.unshift(o.name);
    return '<div class="sb-owner"><label><span>Owner</span><select data-owner="' + row.id + '" aria-label="Whose email this is">' +
      '<option value="">Nobody</option>' + team.map(function (n) { return '<option value="' + esc(n) + '"' + (n === o.name ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') +
      '</select></label><span class="sb-note">' + esc(ownerHow(o)) + '</span></div>';
  }
  function fileHtml(row, f, i) {
    var url = fileUrl(f.key);
    var photoLike = f.use === 'photo';
    var thumb = isPicture(f) && url
      ? '<img src="' + esc(url) + '" alt="" loading="lazy">'
      : '<span>' + (f.mime === 'application/pdf' ? 'PDF' : 'FILE') + '</span>';
    var dims = f.w && f.h ? ' · ' + f.w + ' × ' + f.h : '';
    var key = row.id + ':' + i;
    var live = row.status !== 'dismissed';
    if (f.rejected) {
      // Rejected: kept small and crossed out, with the way back.
      return { key: key, choice: '', html: '<div class="sb-file sb-file-off" data-file="' + i + '" data-rejected="1">' +
        '<span class="sb-thumb sb-thumb-sm">' + thumb + '</span>' +
        '<div><div class="sb-fname"><s>' + esc(f.filename) + '</s></div>' +
        '<div class="sb-note">Rejected' + (f.rejected.everywhere ? ' everywhere' : '') + (f.rejected.by ? ' by ' + esc(f.rejected.by) : '') + '</div>' +
        (live ? '<div class="sb-row"><button class="sb-btn sb-btn-quiet" data-act="file-undo" data-id="' + row.id + '" data-file="' + i + '">Undo</button></div>' : '') +
        '</div></div>' };
    }
    var sched = schedFor(row, S.targets);
    var choice = Object.prototype.hasOwnProperty.call(S.pick, key) ? S.pick[key]
      : defaultChoice(f, row, { sched: sched, schedEx: sched && sched.org ? exhibitorNamed(sched.org, S.targets) : 0, org: aiOrg(f, S.targets) });
    var used = usesOfFile(row, i);
    var h = '<div class="sb-file" data-file="' + i + '">' +
      '<a class="sb-thumb" data-photo="' + (photoLike ? 1 : 0) + '"' + (url ? ' href="' + esc(url) + '" target="_blank" rel="noopener"' : '') + ' aria-label="Open the file">' + thumb + '</a>' +
      '<div><div class="sb-fname">' + esc(f.filename) + '</div>' +
      '<div class="sb-fmeta">' + esc(fmtSize(f.size)) + esc(dims) + '</div>' +
      (f.uploaded ? '<div class="sb-note">Uploaded by ' + esc(f.uploaded.by || 'admin') + '</div>' : '') + aiLine(f);
    used.forEach(function (u) {
      h += '<div class="sb-row sb-done" style="margin-top:6px"><span>✓ ' + esc(u.text) + '</span>' +
        '<button class="sb-btn sb-btn-quiet" data-act="undo" data-id="' + row.id + '" data-index="' + u.index + '">Undo</button></div>';
    });
    if (live) {
      // Reject: this email only. Reject everywhere: this picture in every email, and never again.
      var rejectBtns = used.length ? '' :
        '<button class="sb-btn sb-btn-quiet sb-btn-no" data-act="file-reject" data-id="' + row.id + '" data-file="' + i + '" title="Not this file">✕ Reject</button>' +
        (isPicture(f) ? '<button class="sb-btn sb-btn-quiet" data-act="file-reject-all" data-id="' + row.id + '" data-file="' + i + '" title="This picture in every email, and never filed again (a signature, our own logo)">Reject everywhere</button>' : '');
      var pdf = f.mime === 'application/pdf';
      h += (pdf ? '<div class="sb-note" style="margin-top:6px">A PDF cannot be shown in the app. Name whose logo it is, for the website, or upload it again as a PNG.</div>' : '') +
        '<div class="sb-use">' + findHtml(key, pdf ? 'Whose logo is this? Type the company' : 'Search a company or person') +
        '<select data-pick="' + esc(key) + '" aria-label="What this file is">' + optionList(row, f, choice) + '</select>' +
        '<div class="sb-row"><button class="sb-btn sb-btn-go" data-act="apply" data-id="' + row.id + '" data-file="' + i + '">' + (used.length ? 'Use it here too' : 'Use it') + '</button>' + rejectBtns + '</div></div>';
    }
    h += '</div></div>';
    return { html: h, key: key, choice: choice };
  }
  function peopleHtml(row) {
    var people = (row.matches && row.matches.people) || [];
    if (row.status === 'dismissed') return '';
    if (!people.length) {
      // Nobody read out of this email: a way to read it again with today's rules.
      return /@/.test(String(row.body || '')) ? '<div class="sb-team sb-team-empty"><span class="sb-note">No names were found in this email.</span> ' +
        '<button class="sb-link" data-act="reread" data-id="' + row.id + '">Read the names again</button></div>' : '';
    }
    var done = (row.applied || []).filter(function (e) { return e.what === 'team' && !e.undone; });
    var exFirst = liveSuggestions(row, 'exhibitor').map(function (x) { return x.id; });
    var exs = S.targets.exhibitors.slice().sort(function (a, b) {
      var ai = exFirst.indexOf(a.id), bi = exFirst.indexOf(b.id);
      if (ai >= 0 || bi >= 0) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
      return 0;
    });
    var chosen = S.teamPick[row.id] != null ? S.teamPick[row.id] : (exFirst[0] || '');
    var h = '<section class="sb-team" data-team="' + row.id + '">';
    done.forEach(function (e) {
      h += '<div class="sb-done sb-people-note">✓ ' + esc(usedWords(e)) + ': ' + esc((e.people || []).map(function (p) { return p.name; }).join(', ')) +
        (e.skipped && e.skipped.length ? ' <span class="sb-note">(' + esc(e.skipped.join('; ')) + ')</span>' : '') + '</div>';
    });
    h += '<div class="sb-people-note">People named in this email. Check each line; ✕ leaves a person out for good, the tick only for this time.</div>' +
      '<div class="sb-row sb-people-tools"><button class="sb-link" data-act="tick-all" data-id="' + row.id + '">Tick all</button>' +
      '<button class="sb-link" data-act="tick-none" data-id="' + row.id + '">Untick all</button>' +
      '<button class="sb-link" data-act="reread" data-id="' + row.id + '">Read the names again</button></div>' +
      '<div class="sb-people-wrap"><table class="sb-people"><thead><tr><th></th><th>First name</th><th>Last name</th><th>Designation</th><th>Email</th><th>Mobile</th><th></th></tr></thead><tbody>';
    var ed = S.edits[row.id] || {};
    people.forEach(function (p, i) {
      var off = !!p.rejected;
      var dis = off ? ' disabled' : '';
      // What the person typed or unticked here wins over what was read from the email.
      var e = ed[i] || {};
      var val = function (k) { return Object.prototype.hasOwnProperty.call(e, k) ? e[k] : p[k]; };
      var on = !off && (Object.prototype.hasOwnProperty.call(e, 'on') ? !!e.on : true);
      h += '<tr data-person="' + i + '"' + (off ? ' data-off="1"' : '') + '>' +
        '<td><input type="checkbox" data-p="on"' + (on ? ' checked' : '') + dis + ' aria-label="Add this person"></td>' +
        '<td><input data-p="first_name" value="' + esc(val('first_name')) + '"' + dis + ' aria-label="First name"></td>' +
        '<td><input data-p="last_name" value="' + esc(val('last_name')) + '"' + dis + ' aria-label="Last name"></td>' +
        '<td><input data-p="designation" value="' + esc(val('designation')) + '"' + dis + ' aria-label="Designation"></td>' +
        '<td><input data-p="email" type="email" value="' + esc(val('email')) + '"' + dis + ' aria-label="Email"></td>' +
        '<td><input data-p="mobile" value="' + esc(val('mobile')) + '"' + dis + ' aria-label="Mobile"></td>' +
        '<td>' + (off
          ? '<button class="sb-link" data-act="person" data-do="undo" data-id="' + row.id + '" data-index="' + i + '">Undo</button>'
          : '<button class="sb-mini sb-mini-no" data-act="person" data-do="reject" data-id="' + row.id + '" data-index="' + i + '" title="Not a person to add" aria-label="Leave this person out">✕</button>') + '</td></tr>';
    });
    h += '</tbody></table></div>' +
      '<div class="sb-use">' + findHtml('team:' + row.id, 'Search the exhibitor') +
      '<select data-team-pick="' + row.id + '" aria-label="Which exhibitor they belong to"><option value="">Choose the exhibitor…</option>' +
      exs.map(function (e) { return '<option value="' + e.id + '"' + (String(chosen) === String(e.id) ? ' selected' : '') + '>' + esc(e.name) + '</option>'; }).join('') + '</select>' +
      '<div class="sb-row"><button class="sb-btn sb-btn-go" data-act="team" data-id="' + row.id + '">Add them to the team</button>' +
      '<span class="sb-note">Each person with an email gets the pass their booth includes.</span></div></div></section>';
    return h;
  }
  function cardHtml(row) {
    var m = row.matches || {};
    var files = row.attachments || [];
    var picks = [];
    var filesHtml = files.map(function (f, i) { var r = fileHtml(row, f, i); picks.push(r); return r.html; }).join('');
    var matchHtml = '';
    var live = row.status !== 'dismissed';
    // Each suggestion with Yes (the one to use) and No (never offered again for this email).
    var line = function (label, type) {
      var list = m[LIST_OF[type]] || [];
      if (!list.length) return;
      var rej = rejectedIds(row, type), ch = chosenId(row, type);
      var btn = function (cls, what, x, text, title) {
        return '<button class="' + cls + '" data-act="match" data-do="' + what + '" data-type="' + type + '" data-target="' + Number(x.id) + '" data-id="' + row.id + '" title="' + title + '">' + text + '</button>';
      };
      matchHtml += '<div class="sb-match"><span class="sb-mlabel">' + label + ':</span> ' + list.slice(0, 4).map(function (x) {
        var id = Number(x.id);
        if (rej.indexOf(id) >= 0) {
          return '<span class="sb-chip" data-off="1"><s>' + esc(matchLine(x)) + '</s> <span class="sb-note">not this</span>' + (live ? ' ' + btn('sb-link', 'clear', x, 'Undo', 'Offer it again') : '') + '</span>';
        }
        if (ch === id) {
          return '<span class="sb-chip" data-on="1"><b>' + esc(matchLine(x)) + '</b> <span class="sb-sure">✓ chosen</span>' + (live ? ' ' + btn('sb-link', 'clear', x, 'Undo', 'Not chosen any more') : '') + '</span>';
        }
        return '<span class="sb-chip"><b>' + esc(matchLine(x)) + '</b> <span class="' + (x.sure ? 'sb-sure' : 'sb-maybe') + '">' + esc(x.sure ? '✓ ' + x.how : 'likely, ' + x.how) + '</span>' +
          (live ? ' ' + btn('sb-mini sb-mini-yes', 'choose', x, '✓ Yes', 'This is the right one') + btn('sb-mini sb-mini-no', 'reject', x, '✕ No', 'Not this one') : '') + '</span>';
      }).join(' ') + '</div>';
    };
    line('Exhibitor', 'exhibitor'); line('Talk', 'talk'); line('Speaker', 'speaker');
    var sched = schedFor(row, S.targets);
    if (sched) matchHtml += '<div class="sb-match"><span class="sb-mlabel">On the conference schedule:</span> <span class="sb-chip"><b>' + esc(sched.name + ((sched.org || sched.role) ? ' (' + (sched.org || sched.role) + ')' : '')) + '</b> <span class="sb-maybe">the sender</span></span></div>';
    if (!matchHtml) matchHtml = '<div class="sb-match sb-maybe">The sender is not on any list yet. Search for who this is for, or name it yourself.</div>';
    var body = snippet(plain(row.body));
    var open = !!S.open[row.id];
    var link = safeLink(row.link);
    var team = peopleHtml(row);
    var h = '<article class="sb-card" data-row="' + row.id + '" data-status="' + esc(row.status) + '" data-files="' + files.length + '">' +
      '<div>' +
        '<div class="sb-who"><span class="sb-kind" data-kind="' + esc(row.kind) + '">' + esc(KIND[row.kind] || 'Other') + '</span>' +
        '<b>' + esc(senderName(row) || row.from_email) + '</b><span class="sb-mail">' + esc(row.from_email) + '</span>' +
        '<span class="sb-when">' + esc(fmtWhen(row.received_at)) + (row.to_email ? ' · to ' + esc(row.to_email) : '') + '</span></div>' +
        ownerHtml(row) +
        '<div class="sb-subject">' + esc(plain(row.subject) || '(no subject)') + '</div>' + matchHtml +
        (body ? '<div class="sb-body" data-open="' + (open ? 1 : 0) + '">' + esc(body) + '</div>' +
          (body.length > 320 || body.split('\n').length > 5 ? '<button class="sb-more" data-act="more" data-id="' + row.id + '">' + (open ? 'Show less' : 'Show all') + '</button>' : '') : '') +
        '<div class="sb-links">' + (link ? '<a href="' + esc(link) + '" target="_blank" rel="noopener">Open the email</a>' : '') + (live && !files.length ? uploadHtml(row) : '') + '</div>' +
      '</div>' +
      (files.length ? '<div class="sb-files">' + filesHtml + (live ? '<div class="sb-upload-row">' + uploadHtml(row) + '</div>' : '') + '</div>' : '') + team +
      '<div class="sb-foot">' +
        (row.status === 'dismissed'
          ? '<span class="sb-note">Set aside' + (row.decided_by ? ' by ' + esc(row.decided_by) : '') + '.</span><button class="sb-btn" data-act="reopen" data-id="' + row.id + '">Bring back</button>'
          : '<button class="sb-btn sb-btn-quiet" data-act="dismiss" data-id="' + row.id + '">' + (row.status === 'applied' ? 'Done, hide it' : 'Not needed, set aside') + '</button>') +
        '<span class="sb-err" data-err="' + row.id + '"></span>' +
      '</div></article>';
    return { html: h, picks: picks };
  }
  function operatorName() {
    try { return String((S.deps && S.deps.operator && S.deps.operator()) || '').trim(); } catch (e) { return ''; }
  }
  // Mine, each of the team who has something here, nobody's: one press shows only those.
  function whoBar() {
    var team = (S.desks && S.desks.team) || [];
    if (!team.length) return '';
    var me = meOf(operatorName(), team);
    var count = function (who) { return S.rows.filter(function (r) { return whoMatches(r, who); }).length; };
    var chip = function (who, label) {
      return '<button class="sb-who-chip" data-act="who" data-who="' + esc(who) + '" aria-pressed="' + (S.who === who) + '">' + esc(label) + '<b>' + count(who) + '</b></button>';
    };
    var h = '<div class="sb-whos" role="group" aria-label="Whose emails to show">' + chip('', 'Everyone’s') + (me ? chip(me, 'Mine') : '');
    team.forEach(function (n) { if (n !== me && (count(n) || S.who === n)) h += chip(n, n); });
    h += chip('-', 'Nobody’s') + '</div>';
    if (!me) {
      // Admin does not know who is looking (one shared password): one choice here tells it.
      h += '<div class="sb-who-hint"><label>Who are you? <select data-me aria-label="Your name on the team"><option value="">Choose your name…</option>' +
        team.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('') + '</select></label>' +
        '<span class="sb-note">Then Mine shows the emails that came to your mailbox, and your changes are recorded under your name.</span></div>';
    }
    return h;
  }
  // Whose each team mailbox is. Worked out from the name on it; set once here, and every email
  // to that address follows.
  function boxesHtml() {
    var list = (S.desks && S.desks.mailboxes) || [], team = (S.desks && S.desks.team) || [];
    if (!list.length || !team.length) return '';
    var unknown = list.filter(function (b) { return !b.owner && b.given == null; }).length;
    var h = '<details class="sb-boxes"' + (S.boxesOpen ? ' open' : '') + '><summary>✉ Whose mailbox is whose' +
      (unknown ? ': ' + unknown + ' with nobody' : '') + '</summary>' +
      '<div class="sb-note">Each email goes to the person whose mailbox it came to, worked out from the name on the mailbox. Set one here and every email to that address follows; the Owner on a card changes one email only.</div><div class="sb-box-list">';
    list.forEach(function (b) {
      var v = b.given == null ? 'auto' : b.given;
      var opt = function (val, text) { return '<option value="' + esc(val) + '"' + (v === val ? ' selected' : '') + '>' + esc(text) + '</option>'; };
      h += '<label class="sb-box"><span class="sb-box-mail">' + esc(b.email) + (b.waiting ? ' <b>' + b.waiting + ' waiting</b>' : '') + '</span>' +
        '<select data-mailbox="' + esc(b.email) + '" aria-label="' + esc('Whose mailbox ' + b.email + ' is') + '">' +
        opt('auto', 'Automatic: ' + (b.auto || 'nobody')) + opt('', 'Nobody: a shared mailbox') +
        team.map(function (n) { return opt(n, n); }).join('') + '</select></label>';
    });
    return h + '</div></details>';
  }
  function draw() {
    var el = S.el; if (!el) return;
    var h = '<div class="sbd"><div class="sb-head">' +
      '<p>Logos, photos and team lists that exhibitors and speakers sent by email. Check each one and press the button. Nothing changes until you do.</p>' +
      '<div class="sb-tabs" role="tablist">' +
      TABS.map(function (t) {
        return '<button class="sb-tab" role="tab" data-tab="' + t.key + '" aria-selected="' + (S.tab === t.key) + '">' + t.label + '<b>' + tabCount(S.counts, t.key) + '</b></button>';
      }).join('') + '</div></div>';
    if (S.notYet) {
      h += '<div class="sb-empty">This screen needs one database step before it can receive anything.<code>' + esc(S.notYet.replace(/^.*Run:\s*/, '')) + '</code></div></div>';
      el.innerHTML = h; return;
    }
    h += '<details class="sb-auto"' + (S.auto.logo || S.auto.photo ? ' open' : '') + '><summary>⚙ Use without asking' +
      (S.auto.logo || S.auto.photo ? ': on for ' + [S.auto.logo ? 'logos' : '', S.auto.photo ? 'photos' : ''].filter(Boolean).join(' and ') : ': off') + '</summary>' +
      '<label><input type="checkbox" data-auto="logo"' + (S.auto.logo ? ' checked' : '') + '><span>Logos<small>When the booth contact or someone on the team sends exactly one logo, put it on their exhibitor card straight away.</small></span></label>' +
      '<label><input type="checkbox" data-auto="photo"' + (S.auto.photo ? ' checked' : '') + '><span>Speaker photos<small>When a speaker sends exactly one photo from the address we hold for them, use it straight away.</small></span></label>' +
      '<div class="sb-note">Anything used this way still appears under Used, where it can be undone. Team lists always wait for you.</div></details>' +
      boxesHtml() + whoBar();
    var shown = S.rows.filter(function (r) { return whoMatches(r, S.who); });
    if (S.error) h += '<div class="sb-empty sb-err">' + esc(S.error) + ' <button class="sb-btn" data-act="reload">Try again</button></div>';
    else if (S.loading && !S.rows.length) h += '<div class="sb-empty">Loading…</div>';
    else if (!S.rows.length) {
      h += '<div class="sb-empty">' + (S.tab === 'new'
        ? 'Nothing is waiting. New emails with a logo, a photo or a team list appear here within about half an hour of arriving.'
        : S.tab === 'applied' ? 'Nothing has been used yet.' : 'Nothing has been set aside.') + '</div>';
    } else if (!shown.length) {
      h += '<div class="sb-empty">' + esc(S.who === '-' ? 'Every email here has an owner.' : 'Nothing here for ' + S.who + '.') +
        ' <button class="sb-btn" data-act="who" data-who="">Show everyone’s</button></div>';
    }
    var picks = [];
    shown.forEach(function (r) { var c = cardHtml(r); h += c.html; picks = picks.concat(c.picks); });
    h += '</div>';
    el.innerHTML = h;
    // A select's value is set after it is drawn: the option lists are long.
    picks.forEach(function (p) {
      var sel = el.querySelector('select[data-pick="' + p.key + '"]');
      if (sel && p.choice) sel.value = p.choice;
    });
  }

  // ---------------------------------------------------------------- doing
  function api() { return S.deps.api; }
  // The admin page's toast() writes its message as HTML, and these messages carry
  // names that came from an email, so they are escaped here.
  function say(msg, bad) { try { S.deps.toast(esc(msg), bad ? 'error' : 'success'); } catch (e) { /* no toast on this page */ } }
  function rowOf(id) { for (var i = 0; i < S.rows.length; i++) if (String(S.rows[i].id) === String(id)) return S.rows[i]; return null; }
  function showErr(id, msg) {
    var e = S.el && S.el.querySelector('[data-err="' + id + '"]');
    if (e) e.textContent = msg || '';
  }
  function errText(err) { return (err && err.data && err.data.error) || (err && err.message) || 'That did not work. Try again.'; }
  async function load() {
    S.loading = true; S.error = '';
    draw();
    try {
      var r = await fetchList();
      S.rows = r.rows || []; S.counts = r.counts || {}; S.targets = r.targets || S.targets; S.auto = (r.settings && r.settings.auto) || S.auto; S.notYet = '';
      S.desks = r.desks || { team: [], mailboxes: [] };
      S.who = startWho(S.who);
      if (S.deps.onCount) S.deps.onCount(tabCount(S.counts, 'new'));
    } catch (err) {
      if (err && err.notYet) S.notYet = err.message; else S.error = errText(err);
    }
    S.loading = false;
    draw();
  }
  // The page's own helper hands back the server's JSON whatever the status, so a table
  // that is not there yet (503, not_yet) and any other refusal are told apart here.
  async function fetchList() {
    var r = await api().get('/api/admin/inbox-submissions?status=' + encodeURIComponent(S.tab));
    if (r && r.not_yet) { var e = new Error(String(r.error || '')); e.notYet = true; throw e; }
    if (!r || r.error || !r.ok) throw new Error((r && r.error) || 'The list could not be read.');
    return r;
  }
  // Whose emails show: what this person last chose on this computer, else theirs when their name
  // is on the team, else everyone's. A name that has left the team falls back to everyone's.
  function startWho(cur) {
    var team = (S.desks && S.desks.team) || [];
    var ok = function (v) { return v === '' || v === '-' || team.indexOf(v) >= 0; };
    if (cur != null && ok(cur)) return cur;
    var saved = null;
    try { saved = w.localStorage.getItem(WHO_KEY); } catch (e) { /* no storage here */ }
    if (saved != null && ok(saved)) return saved;
    return meOf(operatorName(), team) || '';
  }
  function setWho(v) {
    S.who = v;
    try { w.localStorage.setItem(WHO_KEY, v); } catch (e) { /* remembered for this visit only */ }
    draw();
  }
  // Rows the server sends after an action carry no owner (only the list and the owner route
  // work it out): the one already on screen is kept.
  function replaceRow(row) {
    if (!row) return;
    if (!row.owner) { var old = rowOf(row.id); if (old && old.owner) row.owner = old.owner; }
    var keep = row.status === S.tab;
    var at = -1;
    for (var i = 0; i < S.rows.length; i++) if (S.rows[i].id === row.id) at = i;
    if (at >= 0) { if (keep) S.rows[at] = row; else S.rows.splice(at, 1); }
    // An applied row stays on screen in Waiting until the page is reloaded, so the Undo
    // is right there; it is counted under Used.
    if (at >= 0 && !keep && S.tab === 'new' && row.status === 'applied') S.rows.splice(at, 0, row);
  }
  async function recount() {
    try {
      var c = await api().get('/api/admin/inbox-submissions/count');
      S.counts.new = Number(c && c.new) || 0;
      if (S.deps.onCount) S.deps.onCount(S.counts.new);
    } catch (e) { /* the badge catches up on the next load */ }
  }
  async function act(kind, id, extra) {
    var row = rowOf(id);
    if (!row || S.busy[id]) return;
    S.busy[id] = 1;
    try {
      var res;
      if (kind === 'apply') {
        var sel = S.el.querySelector('select[data-pick="' + id + ':' + extra.file + '"]');
        var body = applyBody(sel && sel.value, extra.file);
        if (!body) {
          showErr(id, 'Choose what this file is first: search above, or pick from the list.');
          var box = S.el.querySelector('input[data-find="' + id + ':' + extra.file + '"]');
          if (box) box.focus(); else if (sel) sel.focus();
          return;
        }
        res = await api().post('/api/admin/inbox-submissions/' + id + '/apply', body);
        say('Done: ' + usedWords(res.entry));
      } else if (kind === 'team') {
        var box = S.el.querySelector('[data-team="' + id + '"]');
        var ex = box.querySelector('select[data-team-pick]').value;
        if (!ex) { showErr(id, 'Choose the exhibitor these people belong to.'); return; }
        var people = [];
        box.querySelectorAll('tr[data-person]').forEach(function (tr) {
          if (!tr.querySelector('[data-p="on"]').checked) return;
          var g = function (k) { return tr.querySelector('[data-p="' + k + '"]').value.trim(); };
          people.push({ first_name: g('first_name'), last_name: g('last_name'), designation: g('designation'), email: g('email'), mobile: g('mobile') });
        });
        if (!people.length) { showErr(id, 'Tick at least one person.'); return; }
        res = await api().post('/api/admin/inbox-submissions/' + id + '/apply', { what: 'team', exhibitor_id: parseInt(ex, 10), people: people });
        delete S.edits[id];
        say('Done: ' + usedWords(res.entry));
      } else if (kind === 'undo') {
        res = await api().post('/api/admin/inbox-submissions/' + id + '/undo', { index: extra.index });
        say('Undone.');
      } else if (kind === 'dismiss') {
        res = await api().post('/api/admin/inbox-submissions/' + id + '/dismiss', {});
      } else if (kind === 'reopen') {
        res = await api().post('/api/admin/inbox-submissions/' + id + '/reopen', {});
      } else if (kind === 'file-reject' || kind === 'file-undo') {
        res = await api().post('/api/admin/inbox-submissions/' + id + '/files/' + extra.file, { rejected: kind === 'file-reject' });
        say(kind === 'file-reject' ? 'Rejected.' : 'Back.');
      } else if (kind === 'file-reject-all') {
        if (!w.confirm('Reject this picture in every email, and never file it again?')) return;
        res = await api().post('/api/admin/inbox-submissions/ignore-picture', { id: Number(id), file: extra.file });
        say('Rejected in ' + res.emails + ' email' + (res.emails === 1 ? '' : 's') + (res.set_aside ? '; ' + res.set_aside + ' left with nothing set aside' : '') + '.');
        await load();
        recount();
        return;
      } else if (kind === 'match') {
        res = await api().post('/api/admin/inbox-submissions/' + id + '/match', { type: extra.type, target_id: extra.target, action: extra.do });
        // The pickers start again from the new choice.
        Object.keys(S.pick).forEach(function (k) { if (k.indexOf(id + ':') === 0) delete S.pick[k]; });
        delete S.teamPick[id];
      } else if (kind === 'person') {
        res = await api().post('/api/admin/inbox-submissions/' + id + '/people/' + extra.index, { rejected: extra.do === 'reject' });
      } else if (kind === 'reread') {
        res = await api().post('/api/admin/inbox-submissions/' + id + '/reread', {});
        delete S.edits[id];
        say(res.people ? res.people + ' name' + (res.people === 1 ? '' : 's') + ' found.' : 'No names found in this email.', !res.people);
      } else if (kind === 'owner') {
        res = await api().post('/api/admin/inbox-submissions/' + id + '/owner', { name: extra.name });
        say(res.row && res.row.owner && res.row.owner.name ? 'Now ' + res.row.owner.name + '’s.' : 'Now nobody’s.');
      } else if (kind === 'upload') {
        var data = await fileData(extra.file);
        res = await api().post('/api/admin/inbox-submissions/' + id + '/upload', { filename: extra.file.name, data: data });
        // The new file starts with its own picker, nothing chosen from an earlier one.
        delete S.pick[id + ':' + res.file];
        S.find[id + ':' + res.file] = '';
        say('Uploaded. Search who it is for, then press Use it.');
      }
      if (res && res.row) {
        if (kind === 'dismiss' || kind === 'reopen') { S.rows = S.rows.filter(function (r) { return r.id !== res.row.id; }); }
        else replaceRow(res.row);
      }
      draw();
      if (kind === 'upload' && res) { var nb = S.el.querySelector('input[data-find="' + id + ':' + res.file + '"]'); if (nb) nb.focus(); }
      recount();
    } catch (err) {
      // A choice that did not save is put back as it was.
      if (kind === 'owner') draw();
      showErr(id, errText(err));
      say(errText(err), true);
    } finally { delete S.busy[id]; }
  }
  // A file from this computer, as the base64 the server takes.
  function fileData(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result || '').replace(/^data:[^,]*,/, '')); };
      r.onerror = function () { reject(new Error('That file could not be read. Try again.')); };
      r.readAsDataURL(file);
    });
  }
  // A result chosen in a search box: the picker below it takes it, and the button is next. Only
  // that picker changes: a redraw would lose what is being typed or unticked elsewhere.
  function pickHit(kind, key, value) {
    var team = kind === 'team-hit';
    var id = team ? key.slice(5) : key.split(':')[0];
    var row = rowOf(id);
    if (team) S.teamPick[id] = value; else S.pick[key] = value;
    S.find[key] = '';
    var input = S.el.querySelector('input[data-find="' + key + '"]'), box = S.el.querySelector('[data-hits="' + key + '"]');
    if (input) input.value = '';
    if (box) box.innerHTML = '';
    var sel = S.el.querySelector(team ? 'select[data-team-pick="' + id + '"]' : 'select[data-pick="' + key + '"]');
    var file = !team && row ? (row.attachments || [])[parseInt(key.split(':')[1], 10)] : null;
    // A name for the website is an option of its own: the list is drawn again with it.
    if (sel && file) sel.innerHTML = optionList(row, file, value);
    if (sel) sel.value = value;
    showErr(id, '');
    var go = team ? S.el.querySelector('[data-team="' + id + '"] [data-act="team"]')
      : S.el.querySelector('[data-act="apply"][data-id="' + id + '"][data-file="' + key.split(':')[1] + '"]');
    if (go && go.focus) go.focus();
  }
  function onClick(ev) {
    var t = ev.target.closest('[data-act],[data-tab]');
    if (!t || !S.el.contains(t)) return;
    if (t.hasAttribute('data-tab')) { S.tab = t.getAttribute('data-tab'); S.rows = []; load(); return; }
    var a = t.getAttribute('data-act'), id = t.getAttribute('data-id');
    if (a === 'who') { setWho(t.getAttribute('data-who') || ''); return; }
    if (a === 'hit' || a === 'team-hit') { pickHit(a, t.getAttribute('data-key'), t.getAttribute('data-value')); return; }
    if (a === 'reload') { load(); return; }
    if (a === 'more') { S.open[id] = !S.open[id]; draw(); return; }
    if (a === 'apply') { act('apply', id, { file: parseInt(t.getAttribute('data-file'), 10) }); return; }
    if (a === 'undo') { act('undo', id, { index: parseInt(t.getAttribute('data-index'), 10) }); return; }
    if (a === 'team' || a === 'dismiss' || a === 'reopen' || a === 'reread') { act(a, id); return; }
    if (a === 'file-reject' || a === 'file-undo' || a === 'file-reject-all') { act(a, id, { file: parseInt(t.getAttribute('data-file'), 10) }); return; }
    if (a === 'match') { act('match', id, { type: t.getAttribute('data-type'), target: parseInt(t.getAttribute('data-target'), 10), do: t.getAttribute('data-do') }); return; }
    if (a === 'person') { act('person', id, { index: parseInt(t.getAttribute('data-index'), 10), do: t.getAttribute('data-do') }); return; }
    if (a === 'tick-all' || a === 'tick-none') {
      var box = S.el.querySelector('[data-team="' + id + '"]');
      if (box) box.querySelectorAll('input[data-p="on"]:not([disabled])').forEach(function (c) { c.checked = a === 'tick-all'; rememberPerson(c); });
      return;
    }
  }
  async function onChange(ev) {
    var t = ev.target;
    if (t.hasAttribute('data-p')) { rememberPerson(t); return; }
    if (t.hasAttribute('data-me')) {
      var nm = t.value;
      if (!nm) return;
      // The same name Admin records changes under (Settings, "Who changed what").
      if (S.deps.setOperator) S.deps.setOperator(nm);
      else { try { w.localStorage.setItem('tc_admin_operator', nm); } catch (e) { /* this visit only */ } }
      try { if (typeof w.loadIdentity === 'function') w.loadIdentity(); } catch (e) { /* the header catches up on reload */ }
      setWho(nm);
      say('You are ' + nm + '. Mine shows the emails that came to your mailbox.');
      return;
    }
    if (t.hasAttribute('data-pick')) { S.pick[t.getAttribute('data-pick')] = t.value; return; }
    if (t.hasAttribute('data-team-pick')) { S.teamPick[t.getAttribute('data-team-pick')] = t.value; return; }
    if (t.hasAttribute('data-owner')) { act('owner', t.getAttribute('data-owner'), { name: t.value }); return; }
    if (t.hasAttribute('data-upload')) {
      var file = t.files && t.files[0], rid = t.getAttribute('data-upload');
      t.value = '';
      if (!file) return;
      if (file.size > 8 * 1048576) { showErr(rid, 'That file is larger than 8 MB. Make it smaller first.'); say('That file is larger than 8 MB.', true); return; }
      act('upload', rid, { file: file });
      return;
    }
    if (t.hasAttribute('data-mailbox')) {
      var mb = t.getAttribute('data-mailbox'), v = t.value;
      S.boxesOpen = true;
      try {
        await api().put('/api/admin/inbox-submissions/mailboxes', { email: mb, name: v === 'auto' ? null : v });
        say(v === 'auto' ? 'Emails to ' + mb + ' are worked out from its name again.' : v ? 'Emails to ' + mb + ' now go to ' + v + '.' : mb + ' is shared: its emails are nobody’s.');
        await load();
      } catch (err) { say(errText(err), true); draw(); }
      return;
    }
    if (t.hasAttribute('data-auto')) {
      var next = { logo: S.auto.logo, photo: S.auto.photo };
      next[t.getAttribute('data-auto')] = t.checked;
      try {
        var r = await api().put('/api/admin/inbox-submissions/settings', { auto: next });
        S.auto = r.auto || next;
        say(t.checked ? 'On. New ones of this kind are used as they arrive.' : 'Off. Everything waits for you.');
      } catch (err) { t.checked = !t.checked; say(errText(err), true); }
      draw();
    }
  }
  // A change in a team list's table, kept so a redraw draws it again.
  function rememberPerson(t) {
    var tr = t.closest && t.closest('tr[data-person]'), box = t.closest && t.closest('[data-team]');
    if (!tr || !box) return;
    var id = box.getAttribute('data-team'), i = tr.getAttribute('data-person'), k = t.getAttribute('data-p');
    var ed = S.edits[id] || (S.edits[id] = {});
    var e = ed[i] || (ed[i] = {});
    e[k] = k === 'on' ? !!t.checked : t.value;
  }
  // Typing in a search box redraws only what it found, so the box keeps its focus.
  function onInput(ev) {
    var t = ev.target;
    if (t && t.hasAttribute && t.hasAttribute('data-p')) { rememberPerson(t); return; }
    if (!t || !t.hasAttribute || !t.hasAttribute('data-find')) return;
    var key = t.getAttribute('data-find');
    S.find[key] = t.value;
    var box = S.el.querySelector('[data-hits="' + key + '"]');
    if (box) box.innerHTML = hitsHtml(key);
  }
  // Enter takes the first result, Escape clears the box, the down arrow goes into the results.
  function onKey(ev) {
    var t = ev.target;
    if (!t || !t.hasAttribute || !t.hasAttribute('data-find')) return;
    var key = t.getAttribute('data-find');
    var box = S.el.querySelector('[data-hits="' + key + '"]');
    if (ev.key === 'Enter') {
      ev.preventDefault();
      var first = box && (box.querySelector('.sb-hit') || box.querySelector('.sb-btn-own'));
      if (first) first.click();
    } else if (ev.key === 'Escape' && t.value) {
      ev.preventDefault();
      t.value = ''; S.find[key] = '';
      if (box) box.innerHTML = '';
    } else if (ev.key === 'ArrowDown') {
      var b = box && box.querySelector('button');
      if (b) { ev.preventDefault(); b.focus(); }
    }
  }
  // The mailbox panel stays as the person left it, open or shut, across redraws.
  function onToggle(ev) {
    var t = ev.target;
    if (t && t.classList && t.classList.contains('sb-boxes')) S.boxesOpen = !!t.open;
  }
  function mount(el, deps) {
    S.deps = deps || {};
    if (S.el !== el) {
      if (S.el) { S.el.removeEventListener('click', onClick); S.el.removeEventListener('change', onChange); S.el.removeEventListener('input', onInput); S.el.removeEventListener('keydown', onKey); S.el.removeEventListener('toggle', onToggle, true); }
      S.el = el;
      el.addEventListener('click', onClick);
      el.addEventListener('change', onChange);
      el.addEventListener('input', onInput);
      el.addEventListener('keydown', onKey);
      // toggle does not bubble: caught on the way down.
      el.addEventListener('toggle', onToggle, true);
    }
    return load();
  }

  w.SubDesk = {
    mount: mount,
    _t: { esc: esc, fmtSize: fmtSize, fmtWhen: fmtWhen, safeLink: safeLink, fileUrl: fileUrl, isPicture: isPicture, defaultChoice: defaultChoice,
      applyBody: applyBody, usesOfFile: usesOfFile, usedWords: usedWords, matchLine: matchLine, tabCount: tabCount,
      liveSuggestions: liveSuggestions, rejectedIds: rejectedIds, chosenId: chosenId, aiWords: aiWords,
      plain: plain, senderName: senderName, fold: fold, fitScore: fitScore, cleanName: cleanName, tagOf: tagOf, findHits: findHits, teamHits: teamHits,
      schedFor: schedFor, aiOrg: aiOrg, exhibitorNamed: exhibitorNamed, meOf: meOf, whoMatches: whoMatches, ownerHow: ownerHow, looksLikePhoto: looksLikePhoto }
  };
})(window);
