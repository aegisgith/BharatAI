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
    el: null, deps: null, tab: 'new', rows: [], counts: {}, targets: { exhibitors: [], talks: [], speakers: [] },
    auto: { logo: false, photo: false }, error: '', notYet: '', loading: false, busy: {}, open: {}, pick: {}, teamPick: {}
  };

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
  // What the picker starts on for one file: "logo:12", "talk:7", "speaker:3" or "".
  function defaultChoice(file, row) {
    if (file && file.rejected) return '';
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
    return '';
  }
  // The body the server takes for one choice.
  function applyBody(choice, fileIndex) {
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

  // ---------------------------------------------------------------- drawing
  function optionList(row, file) {
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
    var h = '<option value="">Choose what this is…</option>';
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
    var choice = Object.prototype.hasOwnProperty.call(S.pick, key) ? S.pick[key] : defaultChoice(f, row);
    var used = usesOfFile(row, i);
    var h = '<div class="sb-file" data-file="' + i + '">' +
      '<a class="sb-thumb" data-photo="' + (photoLike ? 1 : 0) + '"' + (url ? ' href="' + esc(url) + '" target="_blank" rel="noopener"' : '') + ' title="Open the file">' + thumb + '</a>' +
      '<div><div class="sb-fname">' + esc(f.filename) + '</div>' +
      '<div class="sb-fmeta">' + esc(fmtSize(f.size)) + esc(dims) + '</div>' + aiLine(f);
    used.forEach(function (u) {
      h += '<div class="sb-row sb-done" style="margin-top:6px"><span>✓ ' + esc(u.text) + '</span>' +
        '<button class="sb-btn sb-btn-quiet" data-act="undo" data-id="' + row.id + '" data-index="' + u.index + '">Undo</button></div>';
    });
    if (live) {
      // Reject: this email only. Reject everywhere: this picture in every email, and never again.
      var rejectBtns = used.length ? '' :
        '<button class="sb-btn sb-btn-quiet sb-btn-no" data-act="file-reject" data-id="' + row.id + '" data-file="' + i + '" title="Not this file">✕ Reject</button>' +
        (isPicture(f) ? '<button class="sb-btn sb-btn-quiet" data-act="file-reject-all" data-id="' + row.id + '" data-file="' + i + '" title="This picture in every email, and never filed again (a signature, our own logo)">Reject everywhere</button>' : '');
      if (f.mime === 'application/pdf') {
        h += '<div class="sb-note" style="margin-top:6px">A PDF cannot be shown in the app. Open it and save the logo as a PNG, or keep it for the website.</div>' +
          (rejectBtns ? '<div class="sb-row" style="margin-top:6px">' + rejectBtns + '</div>' : '');
      } else {
        h += '<div class="sb-use"><select data-pick="' + esc(key) + '" aria-label="What this file is">' + optionList(row, f) + '</select>' +
          '<div class="sb-row"><button class="sb-btn sb-btn-go" data-act="apply" data-id="' + row.id + '" data-file="' + i + '">' + (used.length ? 'Use it here too' : 'Use it') + '</button>' + rejectBtns + '</div></div>';
      }
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
    people.forEach(function (p, i) {
      var off = !!p.rejected;
      var dis = off ? ' disabled' : '';
      h += '<tr data-person="' + i + '"' + (off ? ' data-off="1"' : '') + '>' +
        '<td><input type="checkbox" data-p="on"' + (off ? '' : ' checked') + dis + ' aria-label="Add this person"></td>' +
        '<td><input data-p="first_name" value="' + esc(p.first_name) + '"' + dis + ' aria-label="First name"></td>' +
        '<td><input data-p="last_name" value="' + esc(p.last_name) + '"' + dis + ' aria-label="Last name"></td>' +
        '<td><input data-p="designation" value="' + esc(p.designation) + '"' + dis + ' aria-label="Designation"></td>' +
        '<td><input data-p="email" type="email" value="' + esc(p.email) + '"' + dis + ' aria-label="Email"></td>' +
        '<td><input data-p="mobile" value="' + esc(p.mobile) + '"' + dis + ' aria-label="Mobile"></td>' +
        '<td>' + (off
          ? '<button class="sb-link" data-act="person" data-do="undo" data-id="' + row.id + '" data-index="' + i + '">Undo</button>'
          : '<button class="sb-mini sb-mini-no" data-act="person" data-do="reject" data-id="' + row.id + '" data-index="' + i + '" title="Not a person to add" aria-label="Leave this person out">✕</button>') + '</td></tr>';
    });
    h += '</tbody></table></div>' +
      '<div class="sb-use"><select data-team-pick="' + row.id + '" aria-label="Which exhibitor they belong to"><option value="">Choose the exhibitor…</option>' +
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
    if (!matchHtml) matchHtml = '<div class="sb-match sb-maybe">The sender is not on any list yet. Choose who this is for.</div>';
    var body = snippet(row.body);
    var open = !!S.open[row.id];
    var link = safeLink(row.link);
    var team = peopleHtml(row);
    var h = '<article class="sb-card" data-row="' + row.id + '" data-status="' + esc(row.status) + '" data-files="' + files.length + '">' +
      '<div>' +
        '<div class="sb-who"><span class="sb-kind" data-kind="' + esc(row.kind) + '">' + esc(KIND[row.kind] || 'Other') + '</span>' +
        '<b>' + esc(row.from_name || row.from_email) + '</b><span class="sb-mail">' + esc(row.from_email) + '</span>' +
        '<span class="sb-when">' + esc(fmtWhen(row.received_at)) + (row.to_email ? ' · to ' + esc(row.to_email) : '') + '</span></div>' +
        '<div class="sb-subject">' + esc(row.subject || '(no subject)') + '</div>' + matchHtml +
        (body ? '<div class="sb-body" data-open="' + (open ? 1 : 0) + '">' + esc(body) + '</div>' +
          (body.length > 320 || body.split('\n').length > 5 ? '<button class="sb-more" data-act="more" data-id="' + row.id + '">' + (open ? 'Show less' : 'Show all') + '</button>' : '') : '') +
        '<div class="sb-links">' + (link ? '<a href="' + esc(link) + '" target="_blank" rel="noopener">Open the email</a>' : '') + '</div>' +
      '</div>' +
      (files.length ? '<div class="sb-files">' + filesHtml + '</div>' : '') + team +
      '<div class="sb-foot">' +
        (row.status === 'dismissed'
          ? '<span class="sb-note">Set aside' + (row.decided_by ? ' by ' + esc(row.decided_by) : '') + '.</span><button class="sb-btn" data-act="reopen" data-id="' + row.id + '">Bring back</button>'
          : '<button class="sb-btn sb-btn-quiet" data-act="dismiss" data-id="' + row.id + '">' + (row.status === 'applied' ? 'Done, hide it' : 'Not needed, set aside') + '</button>') +
        '<span class="sb-err" data-err="' + row.id + '"></span>' +
      '</div></article>';
    return { html: h, picks: picks };
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
      '<div class="sb-note">Anything used this way still appears under Used, where it can be undone. Team lists always wait for you.</div></details>';
    if (S.error) h += '<div class="sb-empty sb-err">' + esc(S.error) + ' <button class="sb-btn" data-act="reload">Try again</button></div>';
    else if (S.loading && !S.rows.length) h += '<div class="sb-empty">Loading…</div>';
    else if (!S.rows.length) {
      h += '<div class="sb-empty">' + (S.tab === 'new'
        ? 'Nothing is waiting. New emails with a logo, a photo or a team list appear here within about half an hour of arriving.'
        : S.tab === 'applied' ? 'Nothing has been used yet.' : 'Nothing has been set aside.') + '</div>';
    }
    var picks = [];
    S.rows.forEach(function (r) { var c = cardHtml(r); h += c.html; picks = picks.concat(c.picks); });
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
  function replaceRow(row) {
    if (!row) return;
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
        if (!body) { showErr(id, 'Choose what this file is first.'); if (sel) sel.focus(); return; }
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
        say(res.people ? res.people + ' name' + (res.people === 1 ? '' : 's') + ' found.' : 'No names found in this email.', !res.people);
      }
      if (res && res.row) {
        if (kind === 'dismiss' || kind === 'reopen') { S.rows = S.rows.filter(function (r) { return r.id !== res.row.id; }); }
        else replaceRow(res.row);
      }
      draw();
      recount();
    } catch (err) {
      showErr(id, errText(err));
      say(errText(err), true);
    } finally { delete S.busy[id]; }
  }
  function onClick(ev) {
    var t = ev.target.closest('[data-act],[data-tab]');
    if (!t || !S.el.contains(t)) return;
    if (t.hasAttribute('data-tab')) { S.tab = t.getAttribute('data-tab'); S.rows = []; load(); return; }
    var a = t.getAttribute('data-act'), id = t.getAttribute('data-id');
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
      if (box) box.querySelectorAll('input[data-p="on"]:not([disabled])').forEach(function (c) { c.checked = a === 'tick-all'; });
      return;
    }
  }
  async function onChange(ev) {
    var t = ev.target;
    if (t.hasAttribute('data-pick')) { S.pick[t.getAttribute('data-pick')] = t.value; return; }
    if (t.hasAttribute('data-team-pick')) { S.teamPick[t.getAttribute('data-team-pick')] = t.value; return; }
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
  function mount(el, deps) {
    S.deps = deps || {};
    if (S.el !== el) {
      if (S.el) { S.el.removeEventListener('click', onClick); S.el.removeEventListener('change', onChange); }
      S.el = el;
      el.addEventListener('click', onClick);
      el.addEventListener('change', onChange);
    }
    return load();
  }

  w.SubDesk = {
    mount: mount,
    _t: { esc: esc, fmtSize: fmtSize, fmtWhen: fmtWhen, safeLink: safeLink, fileUrl: fileUrl, isPicture: isPicture, defaultChoice: defaultChoice,
      applyBody: applyBody, usesOfFile: usesOfFile, usedWords: usedWords, matchLine: matchLine, tabCount: tabCount,
      liveSuggestions: liveSuggestions, rejectedIds: rejectedIds, chosenId: chosenId, aiWords: aiWords }
  };
})(window);
