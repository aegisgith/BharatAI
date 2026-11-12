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
  // What the picker starts on for one file: "logo:12", "talk:7", "speaker:3" or "".
  function defaultChoice(file, row) {
    var m = (row && row.matches) || {};
    var ex = (m.exhibitors || [])[0], tk = (m.talks || [])[0], sp = (m.speakers || [])[0];
    var use = String(file && file.use || '');
    var kind = String(row && row.kind || '');
    var mime = String(file && file.mime || '');
    if (mime === 'application/pdf') return '';
    var asLogo = use === 'logo' || (!use && kind === 'logo');
    var asPhoto = use === 'photo' || (!use && kind === 'photo');
    if (mime === 'image/svg+xml') { asLogo = true; asPhoto = false; }
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
    var choice = Object.prototype.hasOwnProperty.call(S.pick, key) ? S.pick[key] : defaultChoice(f, row);
    var used = usesOfFile(row, i);
    var h = '<div class="sb-file" data-file="' + i + '">' +
      '<a class="sb-thumb" data-photo="' + (photoLike ? 1 : 0) + '"' + (url ? ' href="' + esc(url) + '" target="_blank" rel="noopener"' : '') + ' title="Open the file">' + thumb + '</a>' +
      '<div><div class="sb-fname">' + esc(f.filename) + '</div>' +
      '<div class="sb-fmeta">' + esc(fmtSize(f.size)) + esc(dims) + '</div>';
    used.forEach(function (u) {
      h += '<div class="sb-row sb-done" style="margin-top:6px"><span>✓ ' + esc(u.text) + '</span>' +
        '<button class="sb-btn sb-btn-quiet" data-act="undo" data-id="' + row.id + '" data-index="' + u.index + '">Undo</button></div>';
    });
    if (row.status !== 'dismissed') {
      if (f.mime === 'application/pdf') {
        h += '<div class="sb-note" style="margin-top:6px">A PDF cannot be shown in the app. Open it and save the logo as a PNG, or keep it for the website.</div>';
      } else {
        h += '<div class="sb-use"><select data-pick="' + esc(key) + '" aria-label="What this file is">' + optionList(row, f) + '</select>' +
          '<div class="sb-row"><button class="sb-btn sb-btn-go" data-act="apply" data-id="' + row.id + '" data-file="' + i + '">' + (used.length ? 'Use it here too' : 'Use it') + '</button></div></div>';
      }
    }
    h += '</div></div>';
    return { html: h, key: key, choice: choice };
  }
  function peopleHtml(row) {
    var people = (row.matches && row.matches.people) || [];
    if (!people.length || row.status === 'dismissed') return '';
    var done = (row.applied || []).filter(function (e) { return e.what === 'team' && !e.undone; });
    var m = row.matches || {};
    var exFirst = (m.exhibitors || []).map(function (x) { return x.id; });
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
    h += '<div class="sb-people-note">People named in this email. Check each line, untick anyone who should not be added.</div>' +
      '<div class="sb-people-wrap"><table class="sb-people"><thead><tr><th></th><th>First name</th><th>Last name</th><th>Designation</th><th>Email</th><th>Mobile</th></tr></thead><tbody>';
    people.forEach(function (p, i) {
      h += '<tr data-person="' + i + '">' +
        '<td><input type="checkbox" data-p="on" checked aria-label="Add this person"></td>' +
        '<td><input data-p="first_name" value="' + esc(p.first_name) + '" aria-label="First name"></td>' +
        '<td><input data-p="last_name" value="' + esc(p.last_name) + '" aria-label="Last name"></td>' +
        '<td><input data-p="designation" value="' + esc(p.designation) + '" aria-label="Designation"></td>' +
        '<td><input data-p="email" type="email" value="' + esc(p.email) + '" aria-label="Email"></td>' +
        '<td><input data-p="mobile" value="' + esc(p.mobile) + '" aria-label="Mobile"></td></tr>';
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
    var line = function (label, list) {
      if (!list || !list.length) return;
      matchHtml += '<div class="sb-match">' + label + ': ' + list.slice(0, 3).map(function (x) {
        return '<b>' + esc(matchLine(x)) + '</b> <span class="' + (x.sure ? 'sb-sure' : 'sb-maybe') + '">' + esc(x.sure ? '✓ ' + x.how : 'likely, ' + x.how) + '</span>';
      }).join(' · ') + '</div>';
    };
    line('Exhibitor', m.exhibitors); line('Talk', m.talks); line('Speaker', m.speakers);
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
    if (a === 'team' || a === 'dismiss' || a === 'reopen') { act(a, id); return; }
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
      applyBody: applyBody, usesOfFile: usesOfFile, usedWords: usedWords, matchLine: matchLine, tabCount: tabCount }
  };
})(window);
