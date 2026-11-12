/* Admin -> Conference (12 Nov 2026): the programme, the speakers, the halls, and
 * announcing a speaker, in the admin panel's Conference section (#sessions).
 *
 * One global, ConfDesk. It leans on the admin page's own globals: api, EID, toast,
 * openModal, closeModal, startCampaign and, for the speaker card, BhaiSocialCard.
 * The server side is src/routes/conference.ts; one read
 * (GET /api/admin/events/:id/conference) feeds every view here.
 *
 * Buttons carry data-cm="<action>" and one delegated listener runs them, so no
 * name or title is ever written into an onclick string. */
(function (global) {
  'use strict';

  var S = { d: null, tab: 'programme', day: '', view: 'board', hall: '', q: '', spk: 'all', spkQ: '', spkSort: 'order', listAll: false, drawer: null, wired: false };
  var PX = 2.2; // pixels per minute on the board
  var TYPE_WORD = { keynote: 'Keynote', talk: 'Talk', panel: 'Panel', workshop: 'Workshop', ceremony: 'Ceremony', exhibition: 'Exhibition', networking: 'Networking', break: 'Break' };
  var ROLE_WORD = { keynote: 'Keynote', speaker: 'Speaker', panellist: 'Panellist', moderator: 'Moderator', host: 'Host', chair: 'Chair' };
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // ---------- small helpers ----------
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function $(id) { return document.getElementById(id); }
  function val(id) { var e = $(id); return e ? e.value : ''; }
  function root() { return $('section-sessions'); }
  function say(msg, kind) { if (typeof toast === 'function') toast(esc(msg), kind || 'success'); }
  function dayLabel(d, long) {
    var x = new Date(String(d).slice(0, 10) + 'T00:00:00Z');
    if (isNaN(x.getTime())) return String(d || '');
    return DAYS[x.getUTCDay()] + ' ' + x.getUTCDate() + ' ' + MON[x.getUTCMonth()] + (long ? ' ' + x.getUTCFullYear() : '');
  }
  function clock(t) {
    var hm = String(t || '').slice(11, 16).split(':'); var h = parseInt(hm[0], 10);
    if (isNaN(h)) return '';
    return (h % 12 || 12) + ':' + (hm[1] || '00') + (h < 12 ? ' am' : ' pm');
  }
  function mins(t) { var hm = String(t || '').slice(11, 16).split(':'); return parseInt(hm[0], 10) * 60 + parseInt(hm[1], 10); }
  function hhmm(m) { m = Math.max(0, Math.min(1439, Math.round(m))); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
  function istNow() { var d = new Date(Date.now() + 330 * 60000); return d.toISOString().slice(0, 16).replace('T', ' '); }
  function initial(name) { var n = String(name || '').replace(/^(hon[’']?ble|shri\.?|smt\.?|dr\.?|mr\.?|ms\.?|mrs\.?|prof\.?)\s+/gi, ''); return (n.trim().charAt(0) || '?').toUpperCase(); }
  function ava(sp, cls) {
    var url = sp && sp.photo_url;
    if (url && /^(\/|https:\/\/)/.test(url)) return '<img class="cm-ava ' + (cls || '') + '" src="' + esc(url) + '" alt="" loading="lazy">';
    return '<span class="cm-ava ' + (cls || '') + '" aria-hidden="true">' + esc(initial(sp && sp.name)) + '</span>';
  }
  function speakerById(id) { var l = (S.d && S.d.speakers) || []; for (var i = 0; i < l.length; i++) if (Number(l[i].id) === Number(id)) return l[i]; return null; }
  function sessionById(id) { var l = (S.d && S.d.sessions) || []; for (var i = 0; i < l.length; i++) if (Number(l[i].id) === Number(id)) return l[i]; return null; }
  function hallByName(n) { var l = (S.d && S.d.halls) || []; for (var i = 0; i < l.length; i++) if (l[i].name === n) return l[i]; return null; }
  function sessionsOf(spId) { return ((S.d && S.d.sessions) || []).filter(function (s) { return (s.links || []).some(function (l) { return Number(l.speaker_id) === Number(spId); }); }); }
  function roleIn(s, spId) { var l = (s.links || []).filter(function (x) { return Number(x.speaker_id) === Number(spId); })[0]; return l ? l.role : 'speaker'; }
  function clashIds() {
    var set = {}; var c = (S.d && S.d.clashes) || { room: [], speaker: [] };
    (c.room || []).concat(c.speaker || []).forEach(function (x) { set[x.a.id] = 1; set[x.b.id] = 1; });
    return set;
  }
  function peopleLine(s) {
    var names = (s.links || []).map(function (l) { var sp = speakerById(l.speaker_id); return sp ? sp.name + (l.role === 'moderator' ? ' (Moderator)' : '') : ''; }).filter(Boolean);
    if (s.others) names.push(s.others);
    return names.join(', ');
  }
  function errText(e) { return (e && e.data && e.data.error) || (e && e.message) || 'Something went wrong.'; }

  // ---------- loading ----------
  async function load() {
    var el = root(); if (!el) return;
    wire();
    if (!S.d) el.innerHTML = '<div class="cm-wrap"><div class="cm-empty"><i class="fas fa-spinner fa-spin"></i>Loading the conference…</div></div>';
    try {
      var d = await api.get('/api/admin/events/' + EID + '/conference');
      if (!d || d.error || !Array.isArray(d.sessions)) throw new Error((d && d.error) || 'The server did not send the programme.');
      S.d = d;
    } catch (e) {
      if (e && e.message === 'unauthorized') return;
      el.innerHTML = '<div class="cm-wrap"><div class="cm-banner is-bad"><b>Could not load the conference.</b> ' + esc(errText(e)) +
        ' <button class="cm-btn is-small" data-cm="reload">Try again</button></div></div>';
      return;
    }
    var days = S.d.days || [];
    if (!S.day || days.indexOf(S.day) < 0) { var today = istNow().slice(0, 10); S.day = days.indexOf(today) >= 0 ? today : (days[0] || today); }
    render();
  }

  // ---------- the frame ----------
  function stats() {
    var d = S.d, sp = d.speakers || [], ss = d.sessions || [];
    var published = sp.filter(function (x) { return Number(x.is_published) === 1; });
    var onProg = published.filter(function (x) { return x.slots > 0; }).length;
    var drafts = ss.filter(function (s) { return s.status === 'draft'; }).length;
    var notAnn = published.filter(function (x) { return x.slots > 0 && !x.announced; }).length;
    var nClash = ((d.clashes && d.clashes.room) || []).length + ((d.clashes && d.clashes.speaker) || []).length;
    var tile = function (n, label, act, cls) { return '<button type="button" class="cm-stat ' + (cls || '') + '" data-cm="' + act + '"><b>' + n + '</b><span>' + label + '</span></button>'; };
    return '<div class="cm-stats">' +
      tile(ss.length - drafts, 'sessions on the programme' + (drafts ? ' · ' + drafts + ' draft' + (drafts === 1 ? '' : 's') : ''), 'stat-sessions') +
      tile(published.length, 'speakers shown to attendees', 'stat-speakers') +
      tile(published.length - onProg, 'speakers with no session yet', 'stat-noslot', published.length - onProg ? 'is-warn' : 'is-ok') +
      tile(notAnn, 'on the programme, not announced', 'stat-notann', notAnn ? 'is-warn' : 'is-ok') +
      tile(nClash, nClash === 1 ? 'clash to fix' : 'clashes to fix', 'stat-clash', nClash ? 'is-bad' : 'is-ok') +
    '</div>';
  }
  function banner() {
    var r = S.d.ready || {};
    var out = '';
    if (!r.all) {
      out += '<div class="cm-banner is-warn"><b>One step left for the organiser.</b> Speakers and sessions can be added and edited now. ' +
        'Halls, drafts and the record of who was announced start working once this runs, once, in the organiser\'s terminal:<br>' +
        '<code>' + esc(S.d.command) + '</code></div>';
    }
    var c = S.d.clashes || { room: [], speaker: [] };
    var list = (c.room || []).map(function (x) { return '<li><b>' + esc(x.room) + '</b>: ' + esc(x.a.title) + ' and ' + esc(x.b.title) + ' overlap (' + esc(dayLabel(x.a.start_time)) + ', ' + esc(clock(x.a.start_time)) + ')</li>'; })
      .concat((c.speaker || []).map(function (x) { return '<li><b>' + esc(x.speaker) + '</b> is in two places: ' + esc(x.a.title) + ' and ' + esc(x.b.title) + ' (' + esc(dayLabel(x.a.start_time)) + ', ' + esc(clock(x.a.start_time)) + ')</li>'; }));
    if (list.length && S.tab === 'programme') out += '<div class="cm-banner is-bad"><b>' + list.length + (list.length === 1 ? ' clash' : ' clashes') + ' on the programme.</b> Open a red-edged session to fix it.<ul>' + list.slice(0, 6).join('') + (list.length > 6 ? '<li>and ' + (list.length - 6) + ' more</li>' : '') + '</ul></div>';
    return out;
  }
  function render() {
    var el = root(); if (!el || !S.d) return;
    var tab = function (k, label, icon) { return '<button type="button" class="cm-tab ' + (S.tab === k ? 'is-on' : '') + '" data-cm="tab" data-k="' + k + '"><i class="fas ' + icon + ' mr-1.5"></i>' + label + '</button>'; };
    el.innerHTML = '<div class="cm-wrap">' + stats() + banner() +
      '<div class="cm-bar cm-no-print"><div class="cm-tabs" role="tablist">' +
        tab('programme', 'Programme', 'fa-calendar-day') + tab('speakers', 'Speakers', 'fa-microphone-lines') + tab('halls', 'Halls', 'fa-door-open') +
      '</div><span class="cm-spacer"></span>' +
        '<button type="button" class="cm-btn" data-cm="new-speaker"><i class="fas fa-user-plus"></i>Add speaker</button>' +
        '<button type="button" class="cm-btn is-primary" data-cm="new-session"><i class="fas fa-plus"></i>Add session</button>' +
      '</div><div id="cm-body"></div></div>';
    body();
  }
  function body() {
    var b = $('cm-body'); if (!b) return;
    if (S.tab === 'speakers') b.innerHTML = speakersView();
    else if (S.tab === 'halls') b.innerHTML = hallsView();
    else b.innerHTML = programmeView();
    if (S.tab === 'programme' && S.view === 'board') scrollBoardToNow();
  }

  // ---------- programme ----------
  function daySessions() {
    return (S.d.sessions || []).filter(function (s) { return S.listAll || String(s.start_time || '').slice(0, 10) === S.day; });
  }
  function activeHalls() {
    var used = {}; daySessions().forEach(function (s) { used[s.room || ''] = 1; });
    var hs = (S.d.halls || []).filter(function (h) { return Number(h.is_active) !== 0 || used[h.name]; });
    if (used['']) hs = hs.concat([{ id: null, name: '', short_name: 'No hall yet', venue_room: '', location: '', unlisted: true }]);
    return hs;
  }
  function programmeView() {
    var days = S.d.days || [];
    var pills = days.map(function (d, i) {
      var n = (S.d.sessions || []).filter(function (s) { return String(s.start_time || '').slice(0, 10) === d; }).length;
      return '<button type="button" class="cm-pill ' + (!S.listAll && S.day === d ? 'is-on' : '') + '" data-cm="day" data-k="' + esc(d) + '">Day ' + (i + 1) + ' · ' + esc(dayLabel(d)) + '<small>' + n + '</small></button>';
    }).join('');
    var bar = '<div class="cm-bar cm-no-print"><div class="cm-pills">' + pills +
      (S.view === 'list' ? '<button type="button" class="cm-pill ' + (S.listAll ? 'is-on' : '') + '" data-cm="day-all">Both days</button>' : '') + '</div>' +
      '<span class="cm-spacer"></span>' +
      (S.view === 'list' ? '<input class="cm-search" type="search" placeholder="Search sessions or speakers" value="' + esc(S.q) + '" data-cm-input="q" aria-label="Search sessions">' : '') +
      '<div class="cm-tabs"><button type="button" class="cm-tab ' + (S.view === 'board' ? 'is-on' : '') + '" data-cm="view" data-k="board"><i class="fas fa-columns mr-1"></i>Board</button>' +
      '<button type="button" class="cm-tab ' + (S.view === 'list' ? 'is-on' : '') + '" data-cm="view" data-k="list"><i class="fas fa-list mr-1"></i>List</button></div>' +
      '<button type="button" class="cm-btn" data-cm="runsheet"><i class="fas fa-clipboard-list"></i>Run sheet</button>' +
      '<button type="button" class="cm-btn" data-cm="csv-programme"><i class="fas fa-file-csv"></i>CSV</button></div>';
    return bar + (S.view === 'list' ? listView() : boardView());
  }
  function boardView() {
    if (S.listAll) S.listAll = false;
    var list = daySessions().filter(function (s) { return !isNaN(mins(s.start_time)) && !isNaN(mins(s.end_time)); });
    var halls = activeHalls();
    if (!halls.length) return '<div class="cm-empty"><i class="fas fa-door-open"></i>No halls yet. Add one in the Halls tab.</div>';
    var startM = 8 * 60, endM = 19 * 60;
    list.forEach(function (s) { startM = Math.min(startM, Math.floor(mins(s.start_time) / 60) * 60); endM = Math.max(endM, Math.ceil(mins(s.end_time) / 60) * 60); });
    var H = (endM - startM) * PX;
    var times = '';
    // The first hour's label would sit under the hall names, so it starts at the second.
    for (var m = startM + 60; m <= endM; m += 60) times += '<div class="cm-time" style="top:' + ((m - startM) * PX) + 'px">' + esc(clock('0000-00-00 ' + hhmm(m))) + '</div>';
    var clashes = clashIds();
    var nowLine = '';
    var now = istNow();
    if (now.slice(0, 10) === S.day && mins(now) >= startM && mins(now) <= endM) nowLine = '<div class="cm-now" style="top:' + ((mins(now) - startM) * PX) + 'px"></div>';
    var heads = '<div class="cm-head is-corner"></div>' + halls.map(function (h) {
      return '<div class="cm-head"><b>' + esc(h.short_name || h.name || 'No hall yet') + '</b><span>' + esc([h.venue_room, h.purpose].filter(Boolean).join(' · ') || h.name) + '</span></div>';
    }).join('');
    var lanes = halls.map(function (h) {
      var mine = list.filter(function (s) { return (s.room || '') === (h.name || ''); }).sort(function (a, b) { return a.start_time < b.start_time ? -1 : a.start_time > b.start_time ? 1 : 0; });
      // Sessions that overlap in one hall sit side by side, so neither hides the other.
      var cols = [], place = {};
      mine.forEach(function (s) {
        var c = 0; while (cols[c] && cols[c] > s.start_time) c++;
        cols[c] = s.end_time; place[s.id] = c;
      });
      var width = function (s) {
        var n = 1; mine.forEach(function (o) { if (o.start_time < s.end_time && s.start_time < o.end_time) n = Math.max(n, (place[o.id] || 0) + 1); });
        return n;
      };
      var blocks = mine.map(function (s) {
        var top = (mins(s.start_time) - startM) * PX, ht = Math.max(18, (mins(s.end_time) - mins(s.start_time)) * PX - 2);
        var n = width(s), c = place[s.id] || 0;
        var style = 'top:' + top + 'px;height:' + ht + 'px;left:calc(' + (c * 100 / n) + '% + 4px);right:auto;width:calc(' + (100 / n) + '% - 8px)';
        var people = peopleLine(s);
        var label = s.title + ', ' + clock(s.start_time) + ' to ' + clock(s.end_time) + (people ? ', ' + people : '');
        return '<div role="button" tabindex="0" class="cm-block cm-t-' + esc(s.session_type) + (s.status === 'draft' ? ' is-draft' : '') + (clashes[s.id] ? ' is-clash' : '') + '" style="' + style + '" data-cm="edit-session" data-id="' + s.id + '" title="' + esc(label) + '" aria-label="' + esc(label) + '">' +
          '<span class="t">' + (clashes[s.id] ? '<i class="fas fa-triangle-exclamation" style="color:#B42318"></i> ' : '') + (s.status === 'draft' ? '<span class="cm-chip is-warn" style="margin:0 4px 0 0;padding:0 6px">Draft</span>' : '') + esc(s.title) + '</span>' +
          (ht >= 30 ? '<span class="w">' + esc(clock(s.start_time)) + ' to ' + esc(clock(s.end_time)) + ' · ' + esc(TYPE_WORD[s.session_type] || s.session_type) + '</span>' : '') +
          (ht >= 48 && people ? '<span class="p">' + esc(people) + '</span>' : '') +
        '</div>';
      }).join('');
      return '<div class="cm-lane" style="height:' + H + 'px" data-cm="lane" data-hall="' + esc(h.name || '') + '" data-start="' + startM + '" title="Click an empty space to add a session here">' + blocks + nowLine + '</div>';
    }).join('');
    var legend = Object.keys(TYPE_WORD).filter(function (t) { return t !== 'networking'; }).map(function (t) { return '<span class="cm-chip"><span class="cm-dot cm-d-' + t + '"></span>' + TYPE_WORD[t] + '</span>'; }).join('');
    return '<div class="cm-help cm-no-print" style="margin:-4px 0 8px">Click a session to change it. Click an empty space in a hall to add one there. ' + legend + '<span class="cm-chip" style="border-style:dashed">Draft: not shown to attendees</span></div>' +
      '<div class="cm-board-wrap" id="cm-board-wrap"><div class="cm-board" style="--cm-cols:' + halls.length + ';--cm-hour:' + (60 * PX) + 'px">' + heads +
      '<div class="cm-times" style="height:' + H + 'px;position:relative">' + times + '</div>' + lanes + '</div></div>' +
      (list.length ? '' : '<div class="cm-empty" style="padding:20px"><i class="fas fa-calendar-plus"></i>Nothing on ' + esc(dayLabel(S.day, true)) + ' yet. Click a hall above to add the first session.</div>');
  }
  // Opens at the time now on an event day, else at the day's first session.
  function scrollBoardToNow() {
    var w = $('cm-board-wrap'); if (!w) return;
    var mark = w.querySelector('.cm-now');
    var top = mark ? mark.offsetTop : Infinity;
    if (!mark) w.querySelectorAll('.cm-block').forEach(function (b) { top = Math.min(top, b.offsetTop); });
    if (top !== Infinity) w.scrollTop = Math.max(0, top - 90);
  }
  function listView() {
    var q = S.q.trim().toLowerCase();
    var list = daySessions().filter(function (s) {
      if (!q) return true;
      return [s.title, s.room, s.session_type, s.track, peopleLine(s), s.note].join(' ').toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) { return a.start_time < b.start_time ? -1 : a.start_time > b.start_time ? 1 : String(a.room).localeCompare(String(b.room)); });
    if (!list.length) return '<div class="cm-table-wrap"><div class="cm-empty"><i class="fas fa-magnifying-glass"></i>' + (q ? 'No session matches "' + esc(S.q) + '".' : 'No sessions on this day yet.') + '</div></div>';
    var clashes = clashIds();
    return '<div class="cm-table-wrap"><table class="cm-table"><thead><tr><th>When</th><th>Hall</th><th>Session</th><th>Speakers</th><th>Status</th></tr></thead><tbody>' +
      list.map(function (s) {
        var h = hallByName(s.room);
        var chips = (s.links || []).map(function (l) { var sp = speakerById(l.speaker_id); return sp ? '<span class="cm-chip">' + esc(sp.name) + (l.role && l.role !== 'speaker' ? ' · ' + esc(ROLE_WORD[l.role] || l.role) : '') + '</span>' : ''; }).join('') +
          (s.others ? '<span class="cm-chip is-warn" title="Typed by hand: not on the speakers list">' + esc(s.others) + '</span>' : '');
        return '<tr class="is-clickable" data-cm="edit-session" data-id="' + s.id + '">' +
          '<td style="white-space:nowrap">' + (S.listAll ? '<span class="cm-muted">' + esc(dayLabel(s.start_time)) + '</span><br>' : '') + '<b>' + esc(clock(s.start_time)) + '</b><br><span class="cm-muted">to ' + esc(clock(s.end_time)) + '</span></td>' +
          '<td>' + esc(s.room || 'No hall yet') + (h && h.venue_room ? '<br><span class="cm-muted">' + esc(h.venue_room) + '</span>' : '') + '</td>' +
          '<td><span class="cm-dot cm-d-' + esc(s.session_type) + '"></span><b>' + esc(s.title) + '</b><br><span class="cm-muted">' + esc(TYPE_WORD[s.session_type] || s.session_type) + (s.track ? ' · ' + esc(s.track) : '') + '</span>' +
            (s.note ? '<div class="cm-help"><i class="fas fa-sticky-note"></i> ' + esc(s.note) + '</div>' : '') + '</td>' +
          '<td>' + (chips || '<span class="cm-muted">None</span>') + '</td>' +
          '<td>' + (s.status === 'draft' ? '<span class="cm-chip is-warn">Draft</span>' : '<span class="cm-chip is-ok">Published</span>') + (clashes[s.id] ? '<span class="cm-chip is-bad"><i class="fas fa-triangle-exclamation"></i>Clash</span>' : '') + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  // ---------- the session editor ----------
  var ED = null; // the session being edited: { id, people: [{speaker_id, role}], ... }
  function openSession(s, preset) {
    s = s || {};
    preset = preset || {};
    var day = String(s.start_time || '').slice(0, 10) || preset.day || S.day;
    var start = s.start_time ? String(s.start_time).slice(11, 16) : (preset.start || '10:00');
    var end = s.end_time ? String(s.end_time).slice(11, 16)
      : hhmm(parseInt(start.slice(0, 2), 10) * 60 + parseInt(start.slice(3, 5), 10) + (preset.duration || 30));
    ED = {
      id: s.id || null,
      people: (s.links || []).map(function (l) { return { speaker_id: Number(l.speaker_id), role: l.role || 'speaker' }; }).concat(preset.speaker_id ? [{ speaker_id: Number(preset.speaker_id), role: 'speaker' }] : []),
      pickQ: '', pickIdx: 0, force: false, clashes: [],
    };
    var r = S.d.ready || {};
    var halls = (S.d.halls || []).filter(function (h) { return h.name; });
    var hallNow = s.id ? (s.room || '') : (preset.hall != null ? preset.hall : (halls[0] ? halls[0].name : ''));
    var hallOpts = '<option value="">No hall yet</option>' + halls.map(function (h) { return '<option value="' + esc(h.name) + '"' + (h.name === hallNow ? ' selected' : '') + '>' + esc(h.name) + (h.venue_room ? ' · ' + esc(h.venue_room) : '') + '</option>'; }).join('');
    if (hallNow && !halls.some(function (h) { return h.name === hallNow; })) hallOpts += '<option value="' + esc(hallNow) + '" selected>' + esc(hallNow) + '</option>';
    var dayOpts = (S.d.days || []).map(function (d, i) { return '<option value="' + esc(d) + '"' + (d === day ? ' selected' : '') + '>Day ' + (i + 1) + ' · ' + esc(dayLabel(d, true)) + '</option>'; }).join('');
    var typeNow = s.session_type || preset.type || 'talk';
    var typeOpts = (S.d.session_types || Object.keys(TYPE_WORD)).map(function (t) { return '<option value="' + t + '"' + (t === typeNow ? ' selected' : '') + '>' + esc(TYPE_WORD[t] || t) + '</option>'; }).join('');
    var html =
      '<div id="cm-s-err"></div><div id="cm-s-clash"></div>' +
      '<div class="cm-f"><label for="cm-s-title">Title</label><input id="cm-s-title" class="cm-in" maxlength="200" value="' + esc(s.title || '') + '" placeholder="e.g. AI in Banking: from pilots to profit" autocomplete="off"></div>' +
      '<div class="cm-row"><div class="cm-f"><label for="cm-s-type">Type</label><select id="cm-s-type" class="cm-in" data-cm-input="s-check">' + typeOpts + '</select></div>' +
      '<div class="cm-f"><label for="cm-s-room">Hall</label><select id="cm-s-room" class="cm-in" data-cm-input="s-check">' + hallOpts + '</select></div></div>' +
      '<div class="cm-row3"><div class="cm-f"><label for="cm-s-day">Day</label><select id="cm-s-day" class="cm-in" data-cm-input="s-check">' + dayOpts + '</select></div>' +
      '<div class="cm-f"><label for="cm-s-start">Starts</label><input id="cm-s-start" type="time" step="300" class="cm-in" value="' + esc(start) + '" data-cm-input="s-check"></div>' +
      '<div class="cm-f"><label for="cm-s-end">Ends</label><input id="cm-s-end" type="time" step="300" class="cm-in" value="' + esc(end) + '" data-cm-input="s-check"></div></div>' +
      '<div class="cm-durs" style="margin:-8px 0 14px"><span class="cm-help" style="margin:4px 4px 0 0">Length:</span>' + [5, 8, 10, 15, 20, 30, 45, 60, 90, 120].map(function (m) { return '<button type="button" class="cm-dur" data-cm="dur" data-k="' + m + '">' + (m < 60 ? m + ' min' : (m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) : '')) + '</button>'; }).join('') + '</div>' +
      '<div class="cm-f"><span class="cm-lbl">Speakers <em>in the order the app should list them</em></span><div id="cm-s-people"></div>' +
        '<div class="cm-pick"><input id="cm-s-pick" class="cm-in" placeholder="Add a speaker: type a name or organisation" autocomplete="off" data-cm-input="pick" aria-label="Add a speaker"><div id="cm-s-pick-list"></div></div></div>' +
      '<div class="cm-f"><label for="cm-s-others">Also on stage <em>(not on the speakers list, written as the app shows them)</em></label><input id="cm-s-others" class="cm-in" value="' + esc(s.others || '') + '" placeholder="e.g. Asha Rao (Tata Capital), Vikram Shah (Moderator)" autocomplete="off">' +
        '<div class="cm-help">Each person as Name (Organisation), separated by commas. Better: add them as speakers, so they get a profile and their slot.</div></div>' +
      '<div class="cm-f"><label for="cm-s-desc">Description <em>(shown in the app)</em></label><textarea id="cm-s-desc" class="cm-in" maxlength="2000">' + esc(s.description || '') + '</textarea></div>' +
      '<div class="cm-row3"><div class="cm-f"><label for="cm-s-track">Track <em>(optional)</em></label><input id="cm-s-track" class="cm-in" value="' + esc(s.track || '') + '" placeholder="e.g. BFSI & FinTech AI" autocomplete="off"></div>' +
      '<div class="cm-f"><label for="cm-s-cap">Seats</label><input id="cm-s-cap" type="number" min="1" class="cm-in" value="' + esc(s.capacity || (hallByName(hallNow) && hallByName(hallNow).capacity) || 100) + '"></div>' +
      '<div class="cm-f"><label for="cm-s-icon">Icon</label><input id="cm-s-icon" class="cm-in" maxlength="4" value="' + esc(s.speaker_avatar || '') + '" placeholder="🎤"></div></div>' +
      '<label class="cm-toggle' + (r.drafts ? '' : ' cm-muted') + '" style="margin-bottom:14px"><input type="checkbox" id="cm-s-draft"' + (s.status === 'draft' ? ' checked' : '') + (r.drafts ? '' : ' disabled') + '>' +
        '<span><b>Keep as a draft</b><small>' + (r.drafts ? 'Attendees do not see it until you untick this.' : 'Drafts start working once the organiser runs migration 0054.') + '</small></span></label>' +
      '<div class="cm-f"><label for="cm-s-note">Team note <em>(never shown to attendees)</em></label><textarea id="cm-s-note" class="cm-in" maxlength="1000" placeholder="e.g. Waiting for the second panellist to confirm"' + (r.drafts ? '' : ' disabled') + '>' + esc(s.note || '') + '</textarea></div>';
    var foot = '<button type="button" class="cm-btn is-primary" data-cm="save-session" id="cm-s-save"><i class="fas fa-floppy-disk"></i>' + (s.id ? 'Save changes' : 'Add to the programme') + '</button>' +
      '<button type="button" class="cm-btn" data-cm="close">Cancel</button><span class="cm-spacer"></span>' +
      (s.id ? '<button type="button" class="cm-btn" data-cm="dup-session" data-id="' + s.id + '"><i class="fas fa-plus"></i>Copy</button><button type="button" class="cm-btn is-danger" data-cm="del-session" data-id="' + s.id + '"><i class="fas fa-trash"></i>Delete</button>' : '');
    drawer(s.id ? 'Change session' : 'Add a session', html, foot);
    drawPeople();
    liveCheck();
    setTimeout(function () { var t = $('cm-s-title'); if (t && !s.id) t.focus(); }, 60);
  }
  function drawPeople() {
    var box = $('cm-s-people'); if (!box || !ED) return;
    if (!ED.people.length) { box.innerHTML = '<div class="cm-help" style="margin:0 0 4px">No speakers yet.</div>'; return; }
    var roles = S.d.speaker_roles || Object.keys(ROLE_WORD);
    box.innerHTML = '<div class="cm-people">' + ED.people.map(function (p, i) {
      var sp = speakerById(p.speaker_id) || { name: 'Unknown speaker' };
      return '<div class="cm-person">' + ava(sp) + '<div class="n"><b>' + esc(sp.name) + (Number(sp.is_published) === 0 ? ' <span class="cm-chip is-warn" style="margin:0">Hidden</span>' : '') + '</b><span>' + esc([sp.role, sp.organisation].filter(Boolean).join(', ')) + '</span></div>' +
        '<select data-cm-input="role" data-i="' + i + '" aria-label="Their part">' + roles.map(function (r) { return '<option value="' + r + '"' + (r === p.role ? ' selected' : '') + '>' + esc(ROLE_WORD[r] || r) + '</option>'; }).join('') + '</select>' +
        '<button type="button" class="cm-ib" data-cm="p-up" data-i="' + i + '" title="Move up" aria-label="Move up"' + (i ? '' : ' disabled') + '><i class="fas fa-chevron-up"></i></button>' +
        '<button type="button" class="cm-ib" data-cm="p-del" data-i="' + i + '" title="Remove" aria-label="Remove ' + esc(sp.name) + '"><i class="fas fa-xmark"></i></button></div>';
    }).join('') + '</div>';
  }
  function pickList() {
    var box = $('cm-s-pick-list'); if (!box || !ED) return;
    var q = ED.pickQ.trim().toLowerCase();
    if (!q) { box.innerHTML = ''; return; }
    var chosen = {}; ED.people.forEach(function (p) { chosen[p.speaker_id] = 1; });
    var hits = (S.d.speakers || []).filter(function (sp) { return !chosen[sp.id] && [sp.name, sp.organisation, sp.role].join(' ').toLowerCase().indexOf(q) >= 0; }).slice(0, 8);
    ED.hits = hits;
    ED.pickIdx = Math.min(ED.pickIdx, Math.max(0, hits.length));
    box.innerHTML = '<div class="cm-pick-list" role="listbox">' + hits.map(function (sp, i) {
      return '<div class="cm-pick-item' + (i === ED.pickIdx ? ' is-active' : '') + '" role="option" data-cm="pick" data-id="' + sp.id + '">' + ava(sp) + '<div><b>' + esc(sp.name) + '</b><span>' + esc([sp.role, sp.organisation].filter(Boolean).join(', ')) + (sp.slots ? ' · ' + sp.slots + ' session' + (sp.slots === 1 ? '' : 's') : '') + '</span></div></div>';
    }).join('') +
      '<div class="cm-pick-item' + (ED.pickIdx === hits.length ? ' is-active' : '') + '" data-cm="pick-new"><span class="cm-ava"><i class="fas fa-plus"></i></span><div><b>Add "' + esc(ED.pickQ.trim()) + '" as a new speaker</b><span>You can add their photo and details afterwards</span></div></div></div>';
  }
  function readSession() {
    var day = val('cm-s-day'), st = val('cm-s-start'), en = val('cm-s-end');
    var draft = $('cm-s-draft');
    return {
      event_id: EID, title: val('cm-s-title').trim(), session_type: val('cm-s-type'), room: val('cm-s-room'),
      start_time: day && st ? day + ' ' + st : '', end_time: day && en ? day + ' ' + en : '',
      speakers: ED.people.map(function (p) { return { speaker_id: p.speaker_id, role: p.role }; }),
      others: val('cm-s-others').trim(), description: val('cm-s-desc').trim(), track: val('cm-s-track').trim(),
      capacity: Number(val('cm-s-cap')) || 100, speaker_avatar: val('cm-s-icon').trim(),
      status: draft && draft.checked ? 'draft' : 'published', note: val('cm-s-note').trim(),
    };
  }
  // The same clash rules the server applies, run as the form changes.
  function clashesNow(v) {
    if (!v.start_time || !v.end_time || v.end_time <= v.start_time) return [];
    var out = [];
    (S.d.sessions || []).forEach(function (o) {
      if (ED && Number(o.id) === Number(ED.id)) return;
      if (!(o.start_time < v.end_time && v.start_time < o.end_time)) return;
      if (v.room && o.room === v.room && o.session_type !== 'exhibition' && v.session_type !== 'exhibition') out.push(esc(v.room) + ' already has <b>' + esc(o.title) + '</b> from ' + esc(clock(o.start_time)) + ' to ' + esc(clock(o.end_time)) + '.');
      (v.speakers || []).forEach(function (p) {
        if ((o.links || []).some(function (l) { return Number(l.speaker_id) === Number(p.speaker_id); })) {
          var sp = speakerById(p.speaker_id); out.push('<b>' + esc(sp ? sp.name : 'A speaker') + '</b> is also in ' + esc(o.title) + ' (' + esc(o.room || 'no hall') + ', ' + esc(clock(o.start_time)) + ').');
        }
      });
    });
    return out;
  }
  function liveCheck() {
    if (!ED) return;
    var v = readSession();
    var box = $('cm-s-clash'); if (!box) return;
    var issues = [];
    if (v.start_time && v.end_time && v.end_time <= v.start_time) issues.push('It ends before it starts. Check the times.');
    var c = clashesNow(v);
    box.innerHTML = (issues.length ? '<div class="cm-err">' + issues.map(esc).join('<br>') + '</div>' : '') +
      (c.length ? '<div class="cm-clashes"><b><i class="fas fa-triangle-exclamation"></i> This slot clashes</b>' + c.join('<br>') + '</div>' : '');
  }
  async function saveSession(force) {
    var v = readSession();
    var err = $('cm-s-err');
    var bad = !v.title ? 'Give the session a title.' : (!v.start_time || !v.end_time) ? 'Choose the day, the start and the end.' : v.end_time <= v.start_time ? 'The session must end after it starts.' : '';
    if (bad) { err.innerHTML = '<div class="cm-err">' + esc(bad) + '</div>'; ($(v.title ? 'cm-s-start' : 'cm-s-title') || {}).focus && $(v.title ? 'cm-s-start' : 'cm-s-title').focus(); return; }
    if (force) v.force = true;
    var btn = $('cm-s-save'); if (btn) btn.disabled = true;
    try {
      var r = ED.id ? await api.put('/api/admin/sessions/' + ED.id, v) : await api.post('/api/admin/sessions', v);
      closeDrawer();
      say(ED && ED.id ? 'Session saved.' : 'Added to the programme.');
      S.day = v.start_time.slice(0, 10);
      await load();
      return r;
    } catch (e) {
      if (btn) btn.disabled = false;
      var data = e && e.data;
      if (data && data.clashes && data.clashes.length) {
        err.innerHTML = '<div class="cm-clashes"><b><i class="fas fa-triangle-exclamation"></i> This slot clashes with the programme</b>' + data.clashes.map(function (c) { return esc(c.what); }).join('<br>') +
          '<div style="margin-top:8px"><button type="button" class="cm-btn is-small is-danger" data-cm="save-session-force">Save anyway</button> <span class="cm-help">or change the hall or the time.</span></div></div>';
        return;
      }
      err.innerHTML = '<div class="cm-err">' + esc(errText(e)) + (data && data.command ? '<br><code>' + esc(data.command) + '</code>' : '') + '</div>';
    }
  }
  async function deleteSession(id) {
    var s = sessionById(id); if (!s) return;
    if (!confirm('Delete "' + s.title + '" (' + dayLabel(s.start_time) + ', ' + clock(s.start_time) + ')?\n\nIt leaves the app at once. Anyone who starred it loses the star.')) return;
    try { await api.del('/api/admin/sessions/' + id); closeDrawer(); say('Session deleted.'); await load(); }
    catch (e) { say(errText(e), 'error'); }
  }

  // ---------- speakers ----------
  function spkFilterList() {
    var list = (S.d.speakers || []).slice();
    var f = S.spk, q = S.spkQ.trim().toLowerCase();
    list = list.filter(function (sp) {
      var pub = Number(sp.is_published) === 1;
      if (f === 'hidden') { if (pub) return false; }
      else if (f !== 'all' && !pub) return false;
      if (f === 'slotted' && !sp.slots) return false;
      if (f === 'noslot' && sp.slots) return false;
      if (f === 'notann' && (sp.announced || !sp.slots)) return false;
      if (f === 'noemail' && sp.email) return false;
      if (f === 'nophoto' && sp.photo_url) return false;
      if (f === 'featured' && !Number(sp.is_featured)) return false;
      return !q || [sp.name, sp.role, sp.organisation, sp.topic, sp.email].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    if (S.spkSort === 'name') list.sort(function (a, b) { return initialSort(a.name).localeCompare(initialSort(b.name)); });
    else if (S.spkSort === 'org') list.sort(function (a, b) { return String(a.organisation || '').localeCompare(String(b.organisation || '')); });
    return list;
  }
  function initialSort(n) { return String(n || '').replace(/^(hon[’']?ble|shri\.?|smt\.?|dr\.?|mr\.?|ms\.?|mrs\.?|prof\.?)\s+/gi, '').trim().toLowerCase(); }
  function speakersView() {
    var all = S.d.speakers || [];
    var pub = all.filter(function (x) { return Number(x.is_published) === 1; });
    var count = function (fn) { return pub.filter(fn).length; };
    var chips = [
      ['all', 'Everyone', all.length], ['slotted', 'On the programme', count(function (x) { return x.slots > 0; })], ['noslot', 'No session yet', count(function (x) { return !x.slots; })],
      ['notann', 'Not announced', count(function (x) { return x.slots && !x.announced; })], ['noemail', 'No email', count(function (x) { return !x.email; })],
      ['nophoto', 'No photo', count(function (x) { return !x.photo_url; })], ['featured', 'Featured', count(function (x) { return Number(x.is_featured); })],
      ['hidden', 'Hidden', all.length - pub.length],
    ].map(function (c) { return '<button type="button" class="cm-pill ' + (S.spk === c[0] ? 'is-on' : '') + '" data-cm="spk-filter" data-k="' + c[0] + '">' + c[1] + '<small>' + c[2] + '</small></button>'; }).join('');
    var bar = '<div class="cm-bar cm-no-print"><input class="cm-search" type="search" placeholder="Search name, organisation, topic, email" value="' + esc(S.spkQ) + '" data-cm-input="spkq" aria-label="Search speakers">' +
      '<select class="cm-select" data-cm-input="spksort" aria-label="Sort"><option value="order"' + (S.spkSort === 'order' ? ' selected' : '') + '>In list order</option><option value="name"' + (S.spkSort === 'name' ? ' selected' : '') + '>By name</option><option value="org"' + (S.spkSort === 'org' ? ' selected' : '') + '>By organisation</option></select>' +
      '<span class="cm-spacer"></span><button type="button" class="cm-btn" data-cm="csv-speakers"><i class="fas fa-file-csv"></i>CSV</button></div>' +
      '<div class="cm-bar cm-no-print"><div class="cm-pills">' + chips + '</div></div>';
    var list = spkFilterList();
    if (!list.length) return bar + '<div class="cm-empty"><i class="fas fa-microphone-lines"></i>' + (S.spkQ ? 'No speaker matches "' + esc(S.spkQ) + '".' : 'Nobody here.') + '</div>';
    return bar + '<div class="cm-grid">' + list.map(speakerCard).join('') + '</div>';
  }
  function speakerCard(sp) {
    var pub = Number(sp.is_published) === 1;
    var ss = sessionsOf(sp.id).sort(function (a, b) { return a.start_time < b.start_time ? -1 : 1; });
    var slots = ss.length ? ss.slice(0, 2).map(function (s) {
      return '<div class="cm-slot" data-cm="edit-session" data-id="' + s.id + '"><b>' + esc(dayLabel(s.start_time)) + ', ' + esc(clock(s.start_time)) + '</b> · ' + esc(s.room || 'No hall yet') +
        (s.status === 'draft' ? ' <span class="cm-chip is-warn" style="margin:0">Draft</span>' : '') + '<small>' + esc(ROLE_WORD[roleIn(s, sp.id)] || 'Speaker') + ' · ' + esc(s.title) + '</small></div>';
    }).join('') + (ss.length > 2 ? '<div class="cm-help">and ' + (ss.length - 2) + ' more</div>' : '')
      : '<div class="cm-slot is-none" data-cm="slot-for" data-id="' + sp.id + '"><i class="fas fa-calendar-plus"></i> No session yet. Give them one</div>';
    var chips = (pub ? '' : '<span class="cm-chip is-warn"><i class="fas fa-eye-slash"></i>Hidden</span>') +
      (Number(sp.is_featured) ? '<span class="cm-chip is-brand"><i class="fas fa-star"></i>Featured</span>' : '') +
      (sp.announced ? '<span class="cm-chip is-ok" title="' + esc('Announced ' + sp.announced.n + ' time' + (sp.announced.n === 1 ? '' : 's')) + '"><i class="fas fa-bullhorn"></i>Announced ' + esc(dayLabel(sp.announced.last_at)) + '</span>' : (ss.length ? '<span class="cm-chip is-warn"><i class="fas fa-bullhorn"></i>Not announced</span>' : '')) +
      (sp.pass ? '<span class="cm-chip is-ok"><i class="fas fa-id-badge"></i>' + esc(sp.pass.badge_type || 'Pass') + '</span>' : (sp.email ? '<span class="cm-chip"><i class="fas fa-id-badge"></i>No pass</span>' : '')) +
      (sp.email ? '' : '<span class="cm-chip is-bad"><i class="fas fa-envelope"></i>No email</span>');
    return '<div class="cm-card' + (pub ? '' : ' is-hidden') + '">' +
      '<div class="cm-who" data-cm="edit-speaker" data-id="' + sp.id + '">' + ava(sp) + '<div style="min-width:0"><b>' + esc(sp.name) + '</b><span class="r">' + esc([sp.role, sp.organisation].filter(Boolean).join(', ') || 'No title yet') + '</span></div></div>' +
      '<div>' + chips + '</div>' + slots +
      '<div class="cm-actions">' +
        '<button type="button" class="cm-btn is-small" data-cm="edit-speaker" data-id="' + sp.id + '"><i class="fas fa-pen"></i>Edit</button>' +
        '<button type="button" class="cm-btn is-small" data-cm="announce" data-id="' + sp.id + '"' + (pub ? '' : ' disabled title="Show them to attendees first"') + '><i class="fas fa-bullhorn"></i>Announce</button>' +
        '<button type="button" class="cm-btn is-small" data-cm="slot-email" data-id="' + sp.id + '"' + (ss.length ? '' : ' disabled title="Give them a session first"') + '><i class="fas fa-envelope"></i>Email slot</button>' +
        '<button type="button" class="cm-btn is-small" data-cm="card" data-id="' + sp.id + '"' + (sp.photo_url ? '' : ' disabled title="Add a photo first"') + '><i class="fas fa-image"></i>Card</button>' +
        '<button type="button" class="cm-btn is-small" data-cm="toggle-pub" data-id="' + sp.id + '" title="' + (pub ? 'Take them off the app and keep everything' : 'Show them in the app again') + '"><i class="fas ' + (pub ? 'fa-eye-slash' : 'fa-eye') + '"></i>' + (pub ? 'Hide' : 'Show') + '</button>' +
      '</div></div>';
  }

  // ---------- the speaker editor ----------
  var SP = null;
  function openSpeaker(sp, preset) {
    sp = sp || {};
    preset = preset || {};
    SP = { id: sp.id || null, photo: null };
    var ss = sp.id ? sessionsOf(sp.id) : [];
    var html = '<div id="cm-p-err"></div>' +
      '<div class="cm-photo">' + '<span id="cm-p-ava">' + ava(sp) + '</span><div>' +
        '<label class="cm-btn" style="display:inline-flex"><i class="fas fa-camera"></i>' + (sp.photo_url ? 'Change photo' : 'Add a photo') + '<input type="file" id="cm-p-file" accept="image/jpeg,image/png,image/webp" style="display:none" data-cm-input="photo"></label>' +
        '<div class="cm-help">A head-and-shoulders photo. It is cropped to a square from the middle.</div></div></div>' +
      '<div class="cm-f"><label for="cm-p-name">Name <em>as it should be printed, with Shri, Dr. or Hon’ble if used</em></label><input id="cm-p-name" class="cm-in" maxlength="120" value="' + esc(sp.name || preset.name || '') + '" autocomplete="off"></div>' +
      '<div class="cm-row"><div class="cm-f"><label for="cm-p-role">Designation</label><input id="cm-p-role" class="cm-in" maxlength="200" value="' + esc(sp.role || '') + '" placeholder="e.g. Chief Technology Officer" autocomplete="off"></div>' +
      '<div class="cm-f"><label for="cm-p-org">Organisation</label><input id="cm-p-org" class="cm-in" maxlength="200" value="' + esc(sp.organisation || '') + '" placeholder="e.g. Bandhan Bank" autocomplete="off"></div></div>' +
      '<div class="cm-f"><label for="cm-p-topic">Speaking on <em>(shown on their profile in the app)</em></label><input id="cm-p-topic" class="cm-in" maxlength="200" value="' + esc(sp.topic || '') + '" autocomplete="off"></div>' +
      '<div class="cm-f"><label for="cm-p-bio">Short bio</label><textarea id="cm-p-bio" class="cm-in" maxlength="3000" rows="4">' + esc(sp.bio || '') + '</textarea></div>' +
      '<div class="cm-row"><div class="cm-f"><label for="cm-p-email">Email <em>(private: for their pass and slot email)</em></label><input id="cm-p-email" type="email" class="cm-in" maxlength="160" value="' + esc(sp.email || '') + '" autocomplete="off"></div>' +
      '<div class="cm-f"><label for="cm-p-phone">Mobile <em>(private)</em></label><input id="cm-p-phone" type="tel" class="cm-in" maxlength="20" value="' + esc(sp.phone || '') + '" autocomplete="off"></div></div>' +
      '<div class="cm-f"><label for="cm-p-li">LinkedIn</label><input id="cm-p-li" type="url" class="cm-in" maxlength="300" value="' + esc(sp.linkedin_url || '') + '" placeholder="https://www.linkedin.com/in/..." autocomplete="off"></div>' +
      '<div class="cm-row"><label class="cm-toggle"><input type="checkbox" id="cm-p-pub"' + (sp.id ? (Number(sp.is_published) === 1 ? ' checked' : '') : ' checked') + '><span><b>Shown to attendees</b><small>Untick to hide them and keep everything</small></span></label>' +
      '<label class="cm-toggle"><input type="checkbox" id="cm-p-feat"' + (Number(sp.is_featured) ? ' checked' : '') + '><span><b>Featured</b><small>First in the app’s speaker list</small></span></label></div>' +
      '<div class="cm-f" style="margin-top:14px"><label for="cm-p-order">Place in the list <em>(1 is first)</em></label><input id="cm-p-order" type="number" min="0" class="cm-in" style="max-width:140px" value="' + esc(sp.sort_order != null ? sp.sort_order : '') + '"></div>' +
      (sp.id ? '<div class="cm-f"><span class="cm-lbl">Their sessions</span>' + (ss.length ? ss.map(function (s) {
        return '<div class="cm-slot" style="margin-bottom:6px" data-cm="edit-session" data-id="' + s.id + '"><b>' + esc(dayLabel(s.start_time)) + ', ' + esc(clock(s.start_time)) + ' to ' + esc(clock(s.end_time)) + '</b> · ' + esc(s.room || 'No hall yet') + '<small>' + esc(ROLE_WORD[roleIn(s, sp.id)] || 'Speaker') + ' · ' + esc(s.title) + (s.status === 'draft' ? ' · draft' : '') + '</small></div>';
      }).join('') : '<div class="cm-help">Not on the programme yet.</div>') +
        '<button type="button" class="cm-btn is-small" data-cm="slot-for" data-id="' + sp.id + '" style="margin-top:6px"><i class="fas fa-calendar-plus"></i>Give them a session</button></div>' +
        (sp.announced ? '<div class="cm-help">Announced ' + sp.announced.n + ' time' + (sp.announced.n === 1 ? '' : 's') + ', last on ' + esc(dayLabel(sp.announced.last_at, true)) + '.</div>' : '') : '');
    var foot = '<button type="button" class="cm-btn is-primary" data-cm="save-speaker" id="cm-p-save"><i class="fas fa-floppy-disk"></i>' + (sp.id ? 'Save changes' : 'Add speaker') + '</button>' +
      '<button type="button" class="cm-btn" data-cm="close">Cancel</button><span class="cm-spacer"></span>' +
      (sp.id ? '<button type="button" class="cm-btn is-danger" data-cm="del-speaker" data-id="' + sp.id + '"><i class="fas fa-trash"></i>Delete</button>' : '');
    drawer(sp.id ? sp.name : 'Add a speaker', html, foot);
    setTimeout(function () { var t = $('cm-p-name'); if (t && !sp.id) t.focus(); }, 60);
  }
  function readSpeaker() {
    var order = val('cm-p-order').trim();
    var out = {
      event_id: EID, name: val('cm-p-name').trim(), role: val('cm-p-role').trim(), organisation: val('cm-p-org').trim(), topic: val('cm-p-topic').trim(), bio: val('cm-p-bio').trim(),
      email: val('cm-p-email').trim(), phone: val('cm-p-phone').trim(), linkedin_url: val('cm-p-li').trim(),
      is_published: $('cm-p-pub') && $('cm-p-pub').checked ? 1 : 0, is_featured: $('cm-p-feat') && $('cm-p-feat').checked ? 1 : 0,
    };
    if (order !== '') out.sort_order = Number(order);
    return out;
  }
  async function saveSpeaker(sameName) {
    var v = readSpeaker();
    var err = $('cm-p-err');
    if (!v.name) { err.innerHTML = '<div class="cm-err">Write the speaker’s name.</div>'; $('cm-p-name').focus(); return; }
    if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) { err.innerHTML = '<div class="cm-err">That email address does not look right.</div>'; $('cm-p-email').focus(); return; }
    if (sameName) v.allow_same_name = true;
    var btn = $('cm-p-save'); if (btn) btn.disabled = true;
    try {
      var id = SP.id;
      if (id) await api.put('/api/admin/speakers/' + id, v);
      else { var r = await api.post('/api/admin/speakers', v); id = r.id; }
      if (SP.photo) await uploadPhoto(id, SP.photo);
      closeDrawer();
      say(SP.id ? 'Speaker saved.' : 'Speaker added.');
      await load();
    } catch (e) {
      if (btn) btn.disabled = false;
      var data = e && e.data;
      err.innerHTML = '<div class="cm-err">' + esc(errText(e)) +
        (data && data.same_name ? ' <button type="button" class="cm-btn is-small" data-cm="save-speaker-same">Add a second person anyway</button>' : '') +
        (data && data.speaker_id && !data.same_name ? ' <button type="button" class="cm-btn is-small" data-cm="edit-speaker" data-id="' + Number(data.speaker_id) + '">Open them</button>' : '') + '</div>';
    }
  }
  // Square from the centre, 480px, JPEG: what the app and the cards draw.
  function squarePhoto(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) { reject(new Error('Choose a JPEG, PNG or WebP photo.')); return; }
      if (file.size > 15 * 1024 * 1024) { reject(new Error('That file is over 15 MB. Choose a smaller photo.')); return; }
      var fr = new FileReader();
      fr.onload = function () {
        var img = new Image();
        img.onload = function () {
          var side = Math.min(img.width, img.height), out = Math.min(480, side);
          var cv = document.createElement('canvas'); cv.width = out; cv.height = out;
          var ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, out, out);
          ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, out, out);
          resolve(cv.toDataURL('image/jpeg', 0.86));
        };
        img.onerror = function () { reject(new Error('That file could not be read as a photo.')); };
        img.src = fr.result;
      };
      fr.onerror = function () { reject(new Error('That file could not be read.')); };
      fr.readAsDataURL(file);
    });
  }
  async function uploadPhoto(id, dataUrl) {
    try { await api.post('/api/admin/speakers/' + id + '/photo', { image: dataUrl }); }
    catch (e) { say('Saved, but the photo did not upload: ' + errText(e), 'error'); }
  }
  async function togglePublished(id) {
    var sp = speakerById(id); if (!sp) return;
    var pub = Number(sp.is_published) === 1;
    if (pub && !confirm('Hide ' + sp.name + ' from attendees?\n\nThey leave the app’s speaker list. Their details and sessions are kept, and you can show them again.')) return;
    try { await api.put('/api/admin/speakers/' + id, { is_published: pub ? 0 : 1 }); say(pub ? sp.name + ' is hidden.' : sp.name + ' is shown again.'); await load(); }
    catch (e) { say(errText(e), 'error'); }
  }
  async function deleteSpeaker(id) {
    var sp = speakerById(id); if (!sp) return;
    var n = sessionsOf(id).length;
    var typed = prompt('Delete ' + sp.name + ' for good?' + (n ? '\n\nThey come off ' + n + ' session' + (n === 1 ? '' : 's') + '.' : '') + '\n\nTo keep their details, choose Hide instead.\n\nType DELETE to confirm.');
    if (typed == null) return;
    if (String(typed).trim().toUpperCase() !== 'DELETE') { say('Not deleted: type DELETE to confirm.', 'error'); return; }
    try { await api.del('/api/admin/speakers/' + id); closeDrawer(); say(sp.name + ' deleted.'); await load(); }
    catch (e) { say(errText(e), 'error'); }
  }

  // ---------- announcing ----------
  function announceText(sp, s) {
    var who = sp.name + ([sp.role, sp.organisation].filter(Boolean).length ? ', ' + [sp.role, sp.organisation].filter(Boolean).join(', ') : '');
    if (!s) return { title: sp.name + ' speaks at Bharat AI Innovation 2026', content: who + ', is speaking at Bharat AI Innovation 2026 on 20-21 November at the World Trade Center, Mumbai.' };
    var h = hallByName(s.room);
    // In a sentence the venue's name goes in brackets: "Aryabhata Theatre (Expo Hall)" (handbook §4).
    var where = s.room ? s.room + (h && h.venue_room && h.venue_room !== s.room ? ' (' + h.venue_room + ')' : '') : 'a hall we will confirm soon';
    var part = roleIn(s, sp.id);
    var as = part === 'moderator' ? 'moderates' : part === 'keynote' ? 'gives the keynote' : part === 'panellist' ? 'joins the panel' : 'speaks';
    return {
      title: sp.name + ' ' + (part === 'keynote' ? 'gives a keynote' : part === 'moderator' ? 'moderates a session' : 'speaks') + ' on ' + dayLabel(s.start_time),
      content: who + ', ' + as + ' at Bharat AI Innovation 2026: "' + s.title + '".\n\n' + dayLabel(s.start_time, true) + ', ' + clock(s.start_time) + ' to ' + clock(s.end_time) + ', ' + where + '.\n\nStar the session in your Conference Schedule so you do not miss it.',
    };
  }
  function openAnnounce(id) {
    var sp = speakerById(id); if (!sp) return;
    var ss = sessionsOf(id).filter(function (s) { return s.status !== 'draft'; });
    var first = ss[0] || null;
    var t = announceText(sp, first);
    var r = S.d.ready || {};
    openModal('<div class="cm-wrap"><h3 class="text-lg font-bold mb-1"><i class="fas fa-bullhorn mr-2" style="color:#C84F00"></i>Announce ' + esc(sp.name) + '</h3>' +
      '<p class="cm-help" style="margin-bottom:14px">Posted in the app’s announcements. You can change every word first.' + (sp.announced ? ' Already announced ' + sp.announced.n + ' time' + (sp.announced.n === 1 ? '' : 's') + '.' : '') + '</p>' +
      '<div id="cm-a-err"></div>' +
      (ss.length > 1 ? '<div class="cm-f"><label for="cm-a-session">About which session</label><select id="cm-a-session" class="cm-in" data-cm-input="a-session" data-id="' + sp.id + '">' + ss.map(function (s) { return '<option value="' + s.id + '">' + esc(dayLabel(s.start_time) + ', ' + clock(s.start_time) + ': ' + s.title) + '</option>'; }).join('') + '<option value="">No session: just that they are speaking</option></select></div>' : '<input type="hidden" id="cm-a-session" value="' + (first ? first.id : '') + '">') +
      '<div class="cm-f"><label for="cm-a-title">Headline</label><input id="cm-a-title" class="cm-in" maxlength="160" value="' + esc(t.title) + '"></div>' +
      '<div class="cm-f"><label for="cm-a-content">Message</label><textarea id="cm-a-content" class="cm-in" rows="6" maxlength="4000">' + esc(t.content) + '</textarea></div>' +
      '<label class="cm-toggle" style="margin-bottom:10px"><input type="checkbox" id="cm-a-pin"><span><b>Pin it to the top</b><small>It stays first in the app until you unpin it in Announcements</small></span></label>' +
      '<label class="cm-toggle" style="margin-bottom:6px"><input type="checkbox" id="cm-a-email" data-cm-input="a-email"><span><b>Also email it to attendees</b><small>A campaign: one email at a time, people who unsubscribed are left out</small></span></label>' +
      '<div id="cm-a-aud" style="display:none" class="cm-f"><select id="cm-a-audience" class="cm-in"><option value="all">Everyone with an email address</option><option value="confirmed">Only those who said they are coming</option><option value="checked_in">Only those checked in at the venue</option></select></div>' +
      (r.log ? '' : '<p class="cm-help">The record of who was announced starts once migration 0054 runs. The announcement itself posts now.</p>') +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px"><button type="button" class="cm-btn is-primary" data-cm="post-announce" data-id="' + sp.id + '" id="cm-a-post"><i class="fas fa-paper-plane"></i>Post it</button>' +
      '<button type="button" class="cm-btn" data-cm="copy-announce"><i class="fas fa-link"></i>Copy the words</button>' +
      '<button type="button" class="cm-btn" data-cm="modal-close">Cancel</button></div></div>');
  }
  async function postAnnounce(id) {
    var sp = speakerById(id); if (!sp) return;
    var title = val('cm-a-title').trim(), content = val('cm-a-content').trim();
    var emailIt = $('cm-a-email') && $('cm-a-email').checked;
    var audience = val('cm-a-audience') || 'all';
    if (!title || !content) { $('cm-a-err').innerHTML = '<div class="cm-err">Write the headline and the message.</div>'; return; }
    if (emailIt && !confirm('Post it in the app, then email it to ' + (audience === 'all' ? 'every attendee with an email address' : audience === 'confirmed' ? 'everyone who said they are coming' : 'everyone checked in') + '?\n\nKeep this tab open while it sends.')) return;
    var btn = $('cm-a-post'); if (btn) btn.disabled = true;
    try {
      var r = await api.post('/api/admin/speakers/' + id + '/announce', { title: title, content: content, session_id: Number(val('cm-a-session')) || null, pinned: $('cm-a-pin') && $('cm-a-pin').checked, email_it: !!emailIt });
      closeModal();
      say('Posted in the app.');
      if (emailIt && typeof startCampaign === 'function') await startCampaign('announcement', { ref_id: r.announcement_id, audience: audience, title: 'Speaker: ' + String(title).slice(0, 80) });
      await load();
    } catch (e) {
      if (btn) btn.disabled = false;
      $('cm-a-err').innerHTML = '<div class="cm-err">' + esc(errText(e)) + '</div>';
    }
  }
  function copyText(text) {
    try { navigator.clipboard.writeText(text).then(function () { say('Copied.'); }, function () { say('Could not copy. Select the text and copy it.', 'error'); }); }
    catch (e) { say('Could not copy. Select the text and copy it.', 'error'); }
  }

  // ---------- the slot email ----------
  var SLOT_NOTE = 'Please reach the hall 30 minutes before your session starts.';
  async function openSlotEmail(id) {
    var sp = speakerById(id); if (!sp) return;
    openModal('<div class="cm-wrap"><h3 class="text-lg font-bold mb-1"><i class="fas fa-envelope mr-2" style="color:#C84F00"></i>Email ' + esc(sp.name) + ' their slot</h3>' +
      '<p class="cm-help" style="margin-bottom:12px">' + (sp.email ? 'To ' + esc(sp.email) + ', from the event’s address. This is exactly what they get.' : '<b style="color:#B42318">No email address yet.</b> Add it on their page, then send.') + '</p>' +
      '<div id="cm-m-err"></div>' +
      '<div class="cm-f"><label for="cm-m-note">A line of your own <em>(optional)</em></label><textarea id="cm-m-note" class="cm-in" rows="2" maxlength="1500" data-cm-input="m-note" data-id="' + sp.id + '">' + esc(SLOT_NOTE) + '</textarea></div>' +
      '<div class="cm-f"><span class="cm-lbl" id="cm-m-subject">Subject: …</span><iframe id="cm-m-preview" class="cm-preview" title="Email preview" sandbox=""></iframe></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="cm-btn is-primary" data-cm="send-slot" data-id="' + sp.id + '" id="cm-m-send"' + (sp.email ? '' : ' disabled') + '><i class="fas fa-paper-plane"></i>Send it</button>' +
      '<button type="button" class="cm-btn" data-cm="modal-close">Cancel</button></div></div>');
    previewSlot(id);
  }
  var _pv = 0;
  async function previewSlot(id) {
    var my = ++_pv;
    try {
      var r = await api.post('/api/admin/speakers/' + id + '/slot-email', { preview: true, note: val('cm-m-note') });
      if (my !== _pv) return;
      var f = $('cm-m-preview'); if (f) f.srcdoc = r.html;
      var s = $('cm-m-subject'); if (s) s.textContent = 'Subject: ' + r.subject;
    } catch (e) { var er = $('cm-m-err'); if (er) er.innerHTML = '<div class="cm-err">' + esc(errText(e)) + '</div>'; }
  }
  async function sendSlot(id) {
    var sp = speakerById(id); if (!sp) return;
    if (!confirm('Send this email to ' + sp.name + ' (' + sp.email + ') now?')) return;
    var btn = $('cm-m-send'); if (btn) btn.disabled = true;
    try { await api.post('/api/admin/speakers/' + id + '/slot-email', { note: val('cm-m-note') }); closeModal(); say('Sent to ' + sp.email + '.'); }
    catch (e) { if (btn) btn.disabled = false; $('cm-m-err').innerHTML = '<div class="cm-err">' + esc(errText(e)) + '</div>'; }
  }

  // ---------- the speaker's own card ----------
  async function speakerCardImage(id) {
    var sp = speakerById(id); if (!sp) return;
    if (!global.BhaiSocialCard) { say('The card maker did not load. Reload the page.', 'error'); return; }
    say('Making ' + sp.name + '’s card…', 'info');
    try {
      var res = await global.BhaiSocialCard.download({ name: sp.name, job_title: sp.role || '', company: sp.organisation || '', avatar_url: sp.photo_url, role: 'speaker', badge_type: 'Speaker' }, { size: 'square', variant: 'speaker' });
      if (res && (res.photoFailed || !res.hasPhoto)) { say('Their photo would not load, so the card shows an initial. Not worth sending.', 'error'); return; }
      say('Card downloaded. Send it to ' + sp.name + ' to post.');
    } catch (e) { say('Could not make the card: ' + errText(e), 'error'); }
  }

  // ---------- halls ----------
  function hallsView() {
    var r = S.d.ready || {};
    var rows = (S.d.halls || []).map(function (h) {
      return '<tr' + (r.halls && h.id ? ' class="is-clickable" data-cm="edit-hall" data-id="' + h.id + '"' : '') + '>' +
        '<td><b>' + esc(h.name || '') + '</b>' + (h.short_name && h.short_name !== h.name ? '<br><span class="cm-muted">' + esc(h.short_name) + ' in the app</span>' : '') + (h.unlisted ? '<br><span class="cm-chip is-warn">Typed on a session, not a hall yet</span>' : '') + '</td>' +
        '<td>' + esc(h.venue_room || '') + '</td><td>' + esc(h.location || '') + '</td><td>' + esc(h.purpose || '') + '</td>' +
        '<td>' + (h.capacity ? Number(h.capacity) : '<span class="cm-muted">Not set</span>') + '</td><td>' + (h.sessions || 0) + '</td>' +
        '<td>' + (Number(h.is_active) === 0 ? '<span class="cm-chip">Not in use</span>' : '<span class="cm-chip is-ok">In use</span>') + '</td></tr>';
    }).join('');
    return '<div class="cm-bar cm-no-print"><span class="cm-help" style="margin:0">The hall name is what attendees see. The venue room is what the venue calls it, for signs and the run sheet.</span><span class="cm-spacer"></span>' +
      '<button type="button" class="cm-btn is-primary" data-cm="new-hall"' + (r.halls ? '' : ' disabled title="Needs migration 0054"') + '><i class="fas fa-plus"></i>Add hall</button></div>' +
      '<div class="cm-table-wrap"><table class="cm-table"><thead><tr><th>Hall</th><th>Venue room</th><th>Finding it</th><th>Used for</th><th>Seats</th><th>Sessions</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function openHall(h) {
    h = h || {};
    var html = '<div id="cm-h-err"></div>' +
      '<div class="cm-f"><label for="cm-h-name">Hall name <em>(what attendees see)</em></label><input id="cm-h-name" class="cm-in" maxlength="80" value="' + esc(h.name || '') + '" placeholder="e.g. Homi J. Bhabha Hall">' +
      (h.id && h.sessions ? '<div class="cm-help">Renaming moves its ' + h.sessions + ' session' + (h.sessions === 1 ? '' : 's') + ' with it.</div>' : '') + '</div>' +
      '<div class="cm-row"><div class="cm-f"><label for="cm-h-short">Short name <em>(the app’s hall tab)</em></label><input id="cm-h-short" class="cm-in" maxlength="40" value="' + esc(h.short_name || '') + '"></div>' +
      '<div class="cm-f"><label for="cm-h-room">Venue room</label><input id="cm-h-room" class="cm-in" maxlength="80" value="' + esc(h.venue_room || '') + '" placeholder="e.g. Peacock Hall"></div></div>' +
      '<div class="cm-f"><label for="cm-h-loc">How to find it</label><input id="cm-h-loc" class="cm-in" maxlength="200" value="' + esc(h.location || '') + '" placeholder="e.g. Ground floor, next to registration"></div>' +
      '<div class="cm-row3"><div class="cm-f"><label for="cm-h-purpose">Used for</label><input id="cm-h-purpose" class="cm-in" maxlength="120" value="' + esc(h.purpose || '') + '"></div>' +
      '<div class="cm-f"><label for="cm-h-cap">Seats</label><input id="cm-h-cap" type="number" min="0" class="cm-in" value="' + esc(h.capacity || '') + '"></div>' +
      '<div class="cm-f"><label for="cm-h-order">Order</label><input id="cm-h-order" type="number" min="0" class="cm-in" value="' + esc(h.sort_order != null ? h.sort_order : '') + '"></div></div>' +
      '<label class="cm-toggle"><input type="checkbox" id="cm-h-active"' + (h.id ? (Number(h.is_active) !== 0 ? ' checked' : '') : ' checked') + '><span><b>In use</b><small>Untick to take it off the board when it has no sessions</small></span></label>';
    var foot = '<button type="button" class="cm-btn is-primary" data-cm="save-hall" data-id="' + (h.id || '') + '"><i class="fas fa-floppy-disk"></i>' + (h.id ? 'Save changes' : 'Add hall') + '</button><button type="button" class="cm-btn" data-cm="close">Cancel</button><span class="cm-spacer"></span>' +
      (h.id ? '<button type="button" class="cm-btn is-danger" data-cm="del-hall" data-id="' + h.id + '"' + (h.sessions ? ' disabled title="Move its sessions first"' : '') + '><i class="fas fa-trash"></i>Delete</button>' : '');
    drawer(h.id ? h.name : 'Add a hall', html, foot);
  }
  async function saveHall(id) {
    var order = val('cm-h-order').trim();
    var v = { event_id: EID, name: val('cm-h-name').trim(), short_name: val('cm-h-short').trim(), venue_room: val('cm-h-room').trim(), location: val('cm-h-loc').trim(), purpose: val('cm-h-purpose').trim(), capacity: val('cm-h-cap').trim(), is_active: $('cm-h-active').checked ? 1 : 0 };
    if (order !== '') v.sort_order = Number(order);
    if (!v.name) { $('cm-h-err').innerHTML = '<div class="cm-err">Write the hall’s name.</div>'; return; }
    try {
      var r = id ? await api.put('/api/admin/halls/' + id, v) : await api.post('/api/admin/halls', v);
      closeDrawer(); say(r && r.sessions_moved ? 'Saved. ' + r.sessions_moved + ' session' + (r.sessions_moved === 1 ? '' : 's') + ' moved with it.' : 'Hall saved.'); await load();
    } catch (e) { $('cm-h-err').innerHTML = '<div class="cm-err">' + esc(errText(e)) + '</div>'; }
  }
  async function deleteHall(id) {
    var h = ((S.d.halls || []).filter(function (x) { return Number(x.id) === Number(id); }))[0]; if (!h) return;
    if (!confirm('Delete the hall "' + h.name + '"?')) return;
    try { await api.del('/api/admin/halls/' + id); closeDrawer(); say('Hall deleted.'); await load(); }
    catch (e) { say(errText(e), 'error'); }
  }

  // ---------- run sheet and exports ----------
  function runSheet() {
    var day = S.day;
    var list = (S.d.sessions || []).filter(function (s) { return String(s.start_time || '').slice(0, 10) === day; });
    var halls = activeHalls();
    var blocks = halls.map(function (h) {
      var mine = list.filter(function (s) { return (s.room || '') === (h.name || ''); }).sort(function (a, b) { return a.start_time < b.start_time ? -1 : 1; });
      if (!mine.length) return '';
      return '<section><h2>' + esc(h.name || 'No hall yet') + (h.venue_room ? ' <small>' + esc(h.venue_room) + (h.location ? ', ' + esc(h.location) : '') + '</small>' : '') + '</h2><table><thead><tr><th style="width:120px">Time</th><th>Session</th><th>On stage</th><th style="width:22%">Team note</th></tr></thead><tbody>' +
        mine.map(function (s) {
          var people = (s.links || []).map(function (l) { var sp = speakerById(l.speaker_id); return sp ? '<div><b>' + esc(sp.name) + '</b> <span>' + esc(ROLE_WORD[l.role] || '') + (sp.phone ? ' · ' + esc(sp.phone) : '') + '</span></div>' : ''; }).join('') + (s.others ? '<div>' + esc(s.others) + '</div>' : '');
          return '<tr><td><b>' + esc(clock(s.start_time)) + '</b><br>to ' + esc(clock(s.end_time)) + '</td><td><b>' + esc(s.title) + '</b><br><span>' + esc(TYPE_WORD[s.session_type] || s.session_type) + (s.status === 'draft' ? ' · DRAFT' : '') + '</span></td><td>' + (people || '<span>None</span>') + '</td><td>' + esc(s.note || '') + '</td></tr>';
        }).join('') + '</tbody></table></section>';
    }).join('');
    var w = window.open('', '_blank');
    if (!w) { say('Your browser blocked the new window. Allow pop-ups for this page.', 'error'); return; }
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Run sheet ' + esc(dayLabel(day, true)) + '</title><style>' +
      'body{font-family:Segoe UI,Roboto,Arial,sans-serif;color:#1E2140;margin:24px}h1{font-size:20px;margin:0 0 4px}p.s{color:#5B6178;margin:0 0 18px;font-size:13px}' +
      'section{break-inside:avoid-page;margin-bottom:22px}h2{font-size:16px;margin:0 0 8px;border-bottom:2px solid #C84F00;padding-bottom:4px}h2 small{font-weight:500;color:#5B6178;font-size:12px}' +
      'table{width:100%;border-collapse:collapse;font-size:12.5px}th{text-align:left;background:#F4F6FC;padding:6px 8px;border:1px solid #E4E7F2}td{padding:6px 8px;border:1px solid #E4E7F2;vertical-align:top}td span{color:#5B6178;font-size:11.5px}' +
      '@media print{body{margin:10mm}button{display:none}}</style></head><body>' +
      '<button onclick="window.print()" style="float:right;padding:8px 14px;border-radius:8px;border:1px solid #ccc;background:#fff;cursor:pointer">Print</button>' +
      '<h1>Run sheet: ' + esc(dayLabel(day, true)) + '</h1><p class="s">Bharat AI Innovation 2026, World Trade Center, Mumbai. Printed ' + esc(istNow()) + ' IST. Mobiles are private: for the stage team only.</p>' +
      (blocks || '<p>Nothing on this day.</p>') + '</body></html>');
    w.document.close();
  }
  function csvCell(v) { var s = String(v == null ? '' : v); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? '"' + s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""') + '"' : s; }
  function downloadCsv(name, rows) {
    var text = '﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function csvProgramme() {
    var rows = [['Day', 'Starts', 'Ends', 'Hall', 'Venue room', 'Session', 'Type', 'Track', 'Speakers', 'Status', 'Team note']];
    (S.d.sessions || []).slice().sort(function (a, b) { return a.start_time < b.start_time ? -1 : 1; }).forEach(function (s) {
      var h = hallByName(s.room);
      rows.push([String(s.start_time).slice(0, 10), String(s.start_time).slice(11, 16), String(s.end_time).slice(11, 16), s.room || '', h ? h.venue_room || '' : '', s.title, TYPE_WORD[s.session_type] || s.session_type, s.track || '',
        (s.links || []).map(function (l) { var sp = speakerById(l.speaker_id); return sp ? sp.name + ' (' + (ROLE_WORD[l.role] || l.role) + ')' : ''; }).filter(Boolean).concat(s.others ? [s.others] : []).join('; '), s.status, s.note || '']);
    });
    downloadCsv('programme-' + istNow().slice(0, 10) + '.csv', rows);
  }
  function csvSpeakers() {
    var rows = [['Name', 'Designation', 'Organisation', 'Speaking on', 'Email', 'Mobile', 'Sessions', 'Shown to attendees', 'Announced', 'Pass']];
    (S.d.speakers || []).forEach(function (sp) {
      rows.push([sp.name, sp.role || '', sp.organisation || '', sp.topic || '', sp.email || '', sp.phone || '',
        sessionsOf(sp.id).map(function (s) { return dayLabel(s.start_time) + ' ' + clock(s.start_time) + ' ' + (s.room || '') + ': ' + s.title; }).join('; '),
        Number(sp.is_published) === 1 ? 'Yes' : 'No', sp.announced ? 'Yes, ' + dayLabel(sp.announced.last_at) : 'No', sp.pass ? sp.pass.badge_type : '']);
    });
    downloadCsv('speakers-' + istNow().slice(0, 10) + '.csv', rows);
  }

  // ---------- the drawer ----------
  function drawer(title, html, foot) {
    var shade = $('cm-shade'), d = $('cm-drawer');
    if (!d) {
      shade = document.createElement('div'); shade.id = 'cm-shade'; shade.className = 'cm-shade'; shade.setAttribute('data-cm', 'close');
      d = document.createElement('aside'); d.id = 'cm-drawer'; d.className = 'cm-drawer'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true');
      document.body.appendChild(shade); document.body.appendChild(d);
    }
    d.setAttribute('aria-label', title);
    d.innerHTML = '<div class="cm-dh"><h3>' + esc(title) + '</h3><button type="button" class="cm-x" data-cm="close" aria-label="Close"><i class="fas fa-xmark"></i></button></div><div class="cm-db">' + html + '</div><div class="cm-df">' + foot + '</div>';
    S.drawer = document.activeElement;
    requestAnimationFrame(function () { shade.classList.add('is-open'); d.classList.add('is-open'); });
  }
  function closeDrawer() {
    var shade = $('cm-shade'), d = $('cm-drawer');
    if (shade) shade.classList.remove('is-open');
    if (d) d.classList.remove('is-open');
    ED = null;
    if (S.drawer && S.drawer.focus) { try { S.drawer.focus(); } catch (e) {} }
  }
  function drawerOpen() { var d = $('cm-drawer'); return !!(d && d.classList.contains('is-open')); }

  // ---------- one listener for everything ----------
  var ACT = {
    reload: function () { load(); },
    tab: function (el) { S.tab = el.getAttribute('data-k'); render(); },
    day: function (el) { S.day = el.getAttribute('data-k'); S.listAll = false; body(); },
    'day-all': function () { S.listAll = !S.listAll; body(); },
    view: function (el) { S.view = el.getAttribute('data-k'); body(); },
    'stat-sessions': function () { S.tab = 'programme'; S.view = 'list'; render(); },
    'stat-speakers': function () { S.tab = 'speakers'; S.spk = 'all'; render(); },
    'stat-noslot': function () { S.tab = 'speakers'; S.spk = 'noslot'; render(); },
    'stat-notann': function () { S.tab = 'speakers'; S.spk = 'notann'; render(); },
    'stat-clash': function () { S.tab = 'programme'; S.view = 'board'; var c = S.d.clashes || {}; var x = (c.room || [])[0] || (c.speaker || [])[0]; if (x) S.day = String(x.a.start_time).slice(0, 10); render(); },
    'new-session': function () { openSession(null, { day: S.day }); },
    'edit-session': function (el) { var s = sessionById(el.getAttribute('data-id')); if (s) openSession(s); },
    'dup-session': function (el) { var s = sessionById(el.getAttribute('data-id')); if (!s) return; var copy = JSON.parse(JSON.stringify(s)); delete copy.id; copy.title = s.title + ' (copy)'; openSession(copy); },
    'del-session': function (el) { deleteSession(el.getAttribute('data-id')); },
    'save-session': function () { saveSession(false); },
    'save-session-force': function () { saveSession(true); },
    lane: function (el, ev) {
      var rect = el.getBoundingClientRect();
      var m = Number(el.getAttribute('data-start')) + (ev.clientY - rect.top) / PX;
      m = Math.floor(m / 15) * 15;
      openSession(null, { day: S.day, hall: el.getAttribute('data-hall'), start: hhmm(m) });
    },
    dur: function (el) {
      var st = val('cm-s-start'); if (!st) return;
      var m = parseInt(st.slice(0, 2), 10) * 60 + parseInt(st.slice(3, 5), 10) + Number(el.getAttribute('data-k'));
      $('cm-s-end').value = hhmm(m); liveCheck();
    },
    pick: function (el) { addPerson(Number(el.getAttribute('data-id'))); },
    'pick-new': function () { quickSpeaker(); },
    'p-up': function (el) { var i = Number(el.getAttribute('data-i')); if (i > 0) { var p = ED.people.splice(i, 1)[0]; ED.people.splice(i - 1, 0, p); drawPeople(); } },
    'p-del': function (el) { ED.people.splice(Number(el.getAttribute('data-i')), 1); drawPeople(); liveCheck(); },
    'new-speaker': function () { openSpeaker(null); },
    'edit-speaker': function (el) { var sp = speakerById(el.getAttribute('data-id')); if (sp) openSpeaker(sp); },
    'save-speaker': function () { saveSpeaker(false); },
    'save-speaker-same': function () { saveSpeaker(true); },
    'del-speaker': function (el) { deleteSpeaker(el.getAttribute('data-id')); },
    'toggle-pub': function (el) { togglePublished(el.getAttribute('data-id')); },
    'slot-for': function (el) { openSession(null, { day: S.day, speaker_id: el.getAttribute('data-id'), hall: '' }); },
    'spk-filter': function (el) { S.spk = el.getAttribute('data-k'); body(); },
    announce: function (el) { openAnnounce(el.getAttribute('data-id')); },
    'post-announce': function (el) { postAnnounce(el.getAttribute('data-id')); },
    'copy-announce': function () { copyText(val('cm-a-title') + '\n\n' + val('cm-a-content') + '\n\nhttps://bharataiinnovation.com/app'); },
    'slot-email': function (el) { openSlotEmail(el.getAttribute('data-id')); },
    'send-slot': function (el) { sendSlot(el.getAttribute('data-id')); },
    card: function (el) { speakerCardImage(el.getAttribute('data-id')); },
    'new-hall': function () { openHall(null); },
    'edit-hall': function (el) { var h = (S.d.halls || []).filter(function (x) { return String(x.id) === el.getAttribute('data-id'); })[0]; if (h) openHall(h); },
    'save-hall': function (el) { saveHall(el.getAttribute('data-id') || null); },
    'del-hall': function (el) { deleteHall(el.getAttribute('data-id')); },
    runsheet: function () { runSheet(); },
    'csv-programme': function () { csvProgramme(); },
    'csv-speakers': function () { csvSpeakers(); },
    close: function () { closeDrawer(); },
    'modal-close': function () { closeModal(); },
  };
  function addPerson(id) {
    if (!ED || !id) return;
    var sp = speakerById(id);
    var type = val('cm-s-type');
    ED.people.push({ speaker_id: id, role: type === 'keynote' ? 'keynote' : type === 'panel' ? 'panellist' : 'speaker' });
    ED.pickQ = ''; ED.pickIdx = 0;
    var inp = $('cm-s-pick'); if (inp) { inp.value = ''; inp.focus(); }
    pickList(); drawPeople(); liveCheck();
    if (sp && Number(sp.is_published) === 0) say(sp.name + ' is hidden from attendees, so this session will not show them until you show them again.', 'info');
  }
  async function quickSpeaker() {
    var name = ED && ED.pickQ.trim(); if (!name) return;
    try {
      var r = await api.post('/api/admin/speakers', { event_id: EID, name: name });
      var d = await api.get('/api/admin/events/' + EID + '/conference');
      if (d && Array.isArray(d.speakers)) { S.d.speakers = d.speakers; }
      addPerson(Number(r.id));
      say(name + ' added as a speaker. Add their photo and title in Speakers.');
    } catch (e) {
      if (e && e.data && e.data.speaker_id) { addPerson(Number(e.data.speaker_id)); return; }
      say(errText(e), 'error');
    }
  }
  function wire() {
    if (S.wired) return;
    S.wired = true;
    document.addEventListener('click', function (ev) {
      var el = ev.target.closest && ev.target.closest('[data-cm]');
      if (!el) { var pl = $('cm-s-pick-list'); if (pl && !ev.target.closest('.cm-pick')) pl.innerHTML = ''; return; }
      if (!el.closest('#section-sessions, #cm-drawer, #cm-shade, #modal-box')) return;
      var fn = ACT[el.getAttribute('data-cm')];
      if (!fn || el.disabled) return;
      ev.preventDefault();
      fn(el, ev);
    });
    document.addEventListener('input', function (ev) {
      var el = ev.target; var k = el && el.getAttribute && el.getAttribute('data-cm-input'); if (!k) return;
      if (k === 'q') { S.q = el.value; var b = $('cm-body'); if (b) { var pos = el.selectionStart; body(); var n = document.querySelector('[data-cm-input="q"]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} } } }
      else if (k === 'spkq') { S.spkQ = el.value; var pos2 = el.selectionStart; body(); var n2 = document.querySelector('[data-cm-input="spkq"]'); if (n2) { n2.focus(); try { n2.setSelectionRange(pos2, pos2); } catch (e) {} } }
      else if (k === 'pick') { ED.pickQ = el.value; ED.pickIdx = 0; pickList(); }
      else if (k === 's-check') liveCheck();
      else if (k === 'm-note') { clearTimeout(S.mt); var id = el.getAttribute('data-id'); S.mt = setTimeout(function () { previewSlot(id); }, 400); }
    });
    document.addEventListener('change', function (ev) {
      var el = ev.target; var k = el && el.getAttribute && el.getAttribute('data-cm-input'); if (!k) return;
      if (k === 'spksort') { S.spkSort = el.value; body(); }
      else if (k === 's-check') liveCheck();
      else if (k === 'role') { ED.people[Number(el.getAttribute('data-i'))].role = el.value; }
      else if (k === 'a-email') { var a = $('cm-a-aud'); if (a) a.style.display = el.checked ? 'block' : 'none'; }
      else if (k === 'a-session') {
        var sp = speakerById(el.getAttribute('data-id')); var s = sessionById(el.value);
        var t = announceText(sp, s); $('cm-a-title').value = t.title; $('cm-a-content').value = t.content;
      } else if (k === 'photo') {
        var f = el.files && el.files[0]; if (!f || !SP) return;
        squarePhoto(f).then(function (dataUrl) {
          SP.photo = dataUrl;
          var a = $('cm-p-ava'); if (a) a.innerHTML = '<img class="cm-ava" src="' + dataUrl + '" alt="">';
          say('Photo ready. It uploads when you save.', 'info');
        }, function (e) { $('cm-p-err').innerHTML = '<div class="cm-err">' + esc(errText(e)) + '</div>'; });
      }
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && drawerOpen()) { closeDrawer(); return; }
      var t = ev.target;
      if (t && t.id === 'cm-s-pick' && ED) {
        var n = (ED.hits || []).length;
        if (ev.key === 'ArrowDown') { ED.pickIdx = Math.min(n, ED.pickIdx + 1); pickList(); ev.preventDefault(); }
        else if (ev.key === 'ArrowUp') { ED.pickIdx = Math.max(0, ED.pickIdx - 1); pickList(); ev.preventDefault(); }
        else if (ev.key === 'Enter') { ev.preventDefault(); if (ED.pickIdx < n) addPerson(Number(ED.hits[ED.pickIdx].id)); else if (ED.pickQ.trim()) quickSpeaker(); }
        return;
      }
      if ((ev.key === 'Enter' || ev.key === ' ') && t && t.classList && t.classList.contains('cm-block')) { ev.preventDefault(); var s = sessionById(t.getAttribute('data-id')); if (s) openSession(s); }
    });
  }

  global.ConfDesk = { load: load, _state: S };
})(window);
