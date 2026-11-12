/* Admin -> Conference (12 Nov 2026): the programme, the speakers, the halls, and
 * announcing a speaker, in the admin panel's Conference section (#sessions).
 *
 * One global, ConfDesk. It leans on the admin page's own globals: api, EID, toast,
 * openModal, closeModal, startCampaign and, for the speaker card, BhaiSocialCard.
 * The server side is src/routes/conference.ts; one read
 * (GET /api/admin/events/:id/conference) feeds every view here.
 *
 * Buttons carry data-cm="<action>" and one delegated listener runs them, so no
 * name or title is ever written into an onclick string.
 *
 * This file must be on the page BEFORE /admin.js (adminPageHTML's script tags): the
 * admin page opens its first section as soon as it runs, and without ConfDesk it
 * draws the old Sessions table instead. Nothing here runs until load() is called. */
(function (global) {
  'use strict';

  var S = { d: null, tab: 'programme', day: '', view: 'board', hall: '', q: '', spk: 'all', spkQ: '', spkSort: 'order', listAll: false, drawer: null, wired: false,
    // the scheduler (12 Nov 2026): which event, free time on the board, the attention list, the tray, undo
    eid: null, showFree: true, dim: false, att: 'all', attDay: '', attHidden: false, tray: false, undo: null, drag: null, flash: null, dragged: 0 };
  var PX = 2.2; // pixels per minute on the board (the zoom buttons change it)
  var ZOOMS = [1.5, 2.2, 3.2];
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

  // ---------- which event, and what needs attention ----------
  // The admin page is Mumbai's (EID). The scheduler can plan another event too
  // (Delhi, July 2027): everything here reads and writes eid().
  function eid() { return Number(S.eid || EID); }
  function live() { return eid() === Number(EID); }
  function words() { return (S.d && S.d.words) || { name: 'Bharat AI Innovation 2026', when: '20-21 November 2026', venue: 'World Trade Center, Mumbai', line: '' }; }
  // Notes a person has chosen not to see again, kept in this browser only.
  function hiddenKeys() { try { return JSON.parse(localStorage.getItem('cm_hidden_' + eid()) || '{}') || {}; } catch (e) { return {}; } }
  function setHidden(key, on) {
    var h = hiddenKeys(); if (on) h[key] = 1; else delete h[key];
    try { localStorage.setItem('cm_hidden_' + eid(), JSON.stringify(h)); } catch (e) {}
  }
  function allIssues() { return (S.d && S.d.issues) || []; }
  function issues() { var h = hiddenKeys(); return allIssues().filter(function (i) { return !h[i.key]; }); }
  function toFix() { return issues().filter(function (i) { return i.level !== 'info'; }); }
  function issuesOfSession(id) { return issues().filter(function (i) { return Number(i.session_id) === Number(id) || Number(i.other_id) === Number(id); }); }
  function span(m) { m = Math.round(m); return m >= 60 ? Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : m + ' min'; }
  function hm(t) { return clock('0000-00-00 ' + t); }
  function expoHall() {
    var hs = (S.d && S.d.halls) || [];
    var h = hs.filter(function (x) { return /innovation talk/i.test(x.purpose || '') || /expo/i.test(x.venue_room || ''); })[0] || hs[0];
    return h ? h.name : '';
  }
  function toPlace() {
    var sp = ((S.d && S.d.speakers) || []).filter(function (x) { return Number(x.is_published) === 1 && !x.slots; });
    var tk = (S.d && S.d.talks && S.d.talks.unplaced) || [];
    return { speakers: sp, talks: tk, n: sp.length + tk.length };
  }

  // ---------- loading ----------
  async function load() {
    var el = root(); if (!el) return;
    wire();
    if (!S.d) el.innerHTML = '<div class="cm-wrap"><div class="cm-empty"><i class="fas fa-spinner fa-spin"></i>Loading the conference…</div></div>';
    try {
      var d = await api.get('/api/admin/events/' + eid() + '/conference');
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
    var fix = toFix(), nBad = fix.filter(function (i) { return i.level === 'bad'; }).length;
    var freeMin = 0; (d.free || []).forEach(function (f) { freeMin += f.minutes; });
    var place = toPlace();
    var tile = function (n, label, act, cls, attrs) { return '<button type="button" class="cm-stat ' + (cls || '') + '" data-cm="' + act + '"' + (attrs || '') + '><b>' + n + '</b><span>' + label + '</span></button>'; };
    return '<div class="cm-stats">' +
      tile(ss.length - drafts, 'sessions on the programme' + (drafts ? ' · ' + drafts + ' draft' + (drafts === 1 ? '' : 's') : ''), 'stat-sessions') +
      tile(fix.length, fix.length ? (nBad ? nBad + ' cannot run as written · ' : '') + 'need a look' : 'nothing needs a look', 'stat-attention', nBad ? 'is-bad' : fix.length ? 'is-warn' : 'is-ok', ' data-bad="' + nBad + '"') +
      tile(freeMin ? span(freeMin) : '0', 'free in the halls, inside the programme', 'stat-free') +
      tile(place.n, place.n ? 'to place: ' + place.speakers.length + ' speaker' + (place.speakers.length === 1 ? '' : 's') + (place.talks.length ? ', ' + place.talks.length + ' Innovation Talk' + (place.talks.length === 1 ? '' : 's') : '') : 'everyone has a session', 'stat-place', place.n ? 'is-warn' : 'is-ok') +
      tile(published.length, 'speakers shown to attendees', 'stat-speakers') +
      (live() ? tile(notAnn, 'on the programme, not announced', 'stat-notann', notAnn ? 'is-warn' : 'is-ok') : '') +
    '</div>';
  }
  function eventPicker() {
    var evs = (S.d && S.d.events) || [];
    if (!evs.length) return '';
    var opts = evs.map(function (e) {
      return '<option value="' + e.id + '"' + (Number(e.id) === eid() ? ' selected' : '') + '>' + esc(e.title) + (e.start_date ? ' · ' + esc(dayLabel(e.start_date, true)) : '') + '</option>';
    }).join('');
    if (!evs.some(function (e) { return Number(e.id) === 2; })) opts += '<option value="start-delhi">＋ Start planning Delhi, July 2027</option>';
    return '<label class="cm-evt"><span>Event</span><select class="cm-select" data-cm-input="event" aria-label="Which event to plan">' + opts + '</select></label>';
  }
  function banner() {
    var r = S.d.ready || {};
    var out = '';
    if (!r.all) {
      out += '<div class="cm-banner is-warn"><b>One step left for the organiser.</b> Speakers and sessions can be added and edited now. ' +
        'Halls, drafts and the record of who was announced start working once this runs, once, in the organiser\'s terminal:<br>' +
        '<code>' + esc(S.d.command) + '</code></div>';
    }
    // Another event than the one the app shows: say so, and offer a way to begin.
    if (!live()) {
      var w = words(), ss = S.d.sessions || [], hs = (S.d.halls || []).filter(function (h) { return !h.unlisted; });
      var from = ((S.d.events || []).filter(function (e) { return Number(e.id) !== eid() && Number(e.sessions) > 0; })[0]);
      out += '<div class="cm-banner is-ok" id="cm-planning"><b>Planning ' + esc(w.name) + '</b>' + (w.line ? ' (' + esc(w.line) + ')' : '') + '. Attendees see nothing from here: this event has no app yet, so plan freely.' +
        (!ss.length ? '<div style="margin-top:8px">' +
          (from && r.all ? '<button type="button" class="cm-btn is-small is-primary" data-cm="copy-from" data-id="' + from.id + '"><i class="fas fa-layer-group"></i>Start from ' + esc(from.title) + '’s programme</button> <span class="cm-help" style="display:inline">Every session comes across as a draft with no speakers, on the same day number and time.</span>' : '') +
          (!hs.length ? ' <button type="button" class="cm-btn is-small" data-cm="tab" data-k="halls"><i class="fas fa-door-open"></i>Add the halls first</button>' : '') + '</div>' : '') +
        '</div>';
    }
    var c = S.d.clashes || { room: [], speaker: [] };
    var list = (c.room || []).map(function (x) { return '<li><b>' + esc(x.room) + '</b>: ' + esc(x.a.title) + ' and ' + esc(x.b.title) + ' overlap (' + esc(dayLabel(x.a.start_time)) + ', ' + esc(clock(x.a.start_time)) + ')</li>'; })
      .concat((c.speaker || []).map(function (x) { return '<li><b>' + esc(x.speaker) + '</b> is in two places: ' + esc(x.a.title) + ' and ' + esc(x.b.title) + ' (' + esc(dayLabel(x.a.start_time)) + ', ' + esc(clock(x.a.start_time)) + ')</li>'; }));
    if (list.length && S.tab === 'programme') out += '<div class="cm-banner is-bad"><b>' + list.length + (list.length === 1 ? ' clash' : ' clashes') + ' on the programme.</b> Open a red-edged session to fix it, or drag it to a free slot.<ul>' + list.slice(0, 6).join('') + (list.length > 6 ? '<li>and ' + (list.length - 6) + ' more</li>' : '') + '</ul></div>';
    return out;
  }
  function render() {
    var el = root(); if (!el || !S.d) return;
    var tab = function (k, label, icon, n, cls) { return '<button type="button" class="cm-tab ' + (S.tab === k ? 'is-on' : '') + '" data-cm="tab" data-k="' + k + '"><i class="fas ' + icon + ' mr-1.5"></i>' + label + (n ? ' <span class="cm-count ' + (cls || '') + '">' + n + '</span>' : '') + '</button>'; };
    var fix = toFix(), nBad = fix.filter(function (i) { return i.level === 'bad'; }).length;
    el.innerHTML = '<div class="cm-wrap">' + stats() + banner() +
      '<div class="cm-bar cm-no-print">' + eventPicker() + '<div class="cm-tabs" role="tablist">' +
        tab('programme', 'Programme', 'fa-calendar-day') + tab('attention', 'Needs attention', 'fa-triangle-exclamation', fix.length, nBad ? 'is-bad' : 'is-warn') +
        tab('speakers', 'Speakers', 'fa-microphone-lines') + tab('halls', 'Halls', 'fa-door-open') +
      '</div><span class="cm-spacer"></span>' +
        (global.SpeakerBrief && live() ? '<button type="button" class="cm-btn" data-cm="brief-list"><i class="fas fa-envelope"></i>Speaker briefs</button>' : '') +
        '<button type="button" class="cm-btn" data-cm="new-speaker"><i class="fas fa-user-plus"></i>Add speaker</button>' +
        '<button type="button" class="cm-btn is-primary" data-cm="new-session"><i class="fas fa-plus"></i>Add session</button>' +
      '</div><div id="cm-body"></div></div>';
    body();
  }
  function body() {
    var b = $('cm-body'); if (!b) return;
    if (S.tab === 'speakers') b.innerHTML = speakersView();
    else if (S.tab === 'halls') b.innerHTML = hallsView();
    else if (S.tab === 'attention') b.innerHTML = attentionView();
    else b.innerHTML = programmeView();
    if (S.tab === 'programme' && S.view === 'board') { if (S.flash) flashOnBoard(); else scrollBoardToNow(); }
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
      '<details class="cm-menu" id="cm-dl"><summary class="cm-btn"><i class="fas fa-download"></i>Download<i class="fas fa-chevron-down" style="font-size:10px"></i></summary><div class="cm-menu-list">' +
        '<button type="button" data-cm="dl-pdf-photos"><i class="fas fa-image"></i><span><b>PDF with speaker photos</b><small>The programme, a photo beside each speaker</small></span></button>' +
        '<button type="button" data-cm="dl-pdf"><i class="fas fa-file-lines"></i><span><b>PDF without photos</b><small>The same programme, names only</small></span></button>' +
        '<button type="button" data-cm="dl-xlsx"><i class="fas fa-file-excel"></i><span><b>Excel sheet</b><small>Programme and speakers; opens in Google Sheets too</small></span></button>' +
      '</div></details>' +
      '<button type="button" class="cm-btn" data-cm="runsheet"><i class="fas fa-clipboard-list"></i>Run sheet</button>' +
      '<button type="button" class="cm-btn" data-cm="csv-programme"><i class="fas fa-file-csv"></i>CSV</button></div>';
    var place = toPlace();
    var tools = S.view !== 'board' ? '' : '<div class="cm-bar cm-no-print cm-tools">' +
      '<label class="cm-check"><input type="checkbox" data-cm-input="show-free"' + (S.showFree ? ' checked' : '') + '> Show free time</label>' +
      '<label class="cm-check"><input type="checkbox" data-cm-input="dim"' + (S.dim ? ' checked' : '') + '> Only what needs a look</label>' +
      '<button type="button" class="cm-btn is-small' + (S.tray ? ' is-on' : '') + '" data-cm="tray" aria-expanded="' + (S.tray ? 'true' : 'false') + '"><i class="fas fa-user-plus"></i>To place <b>' + place.n + '</b></button>' +
      '<span class="cm-spacer"></span>' +
      '<span class="cm-help" style="margin:0">Drag a session to move it, its lower edge to change its length.</span>' +
      '<div class="cm-tabs" role="group" aria-label="Zoom">' + ZOOMS.map(function (z, i) { return '<button type="button" class="cm-tab ' + (PX === z ? 'is-on' : '') + '" data-cm="zoom" data-k="' + i + '">' + ['Fit more', 'Normal', 'Detail'][i] + '</button>'; }).join('') + '</div></div>';
    return bar + tools + undoBar() + (S.view === 'board' && S.tray ? trayView() : '') + (S.view === 'list' ? listView() : boardView());
  }
  // "Moved X to 10:15. Undo": the last drag, until the next one.
  function undoBar() {
    var u = S.undo; if (!u) return '';
    return '<div class="cm-banner is-ok cm-undo cm-no-print" id="cm-undo" role="status"><span>' + esc(u.what) + '</span> <button type="button" class="cm-btn is-small" data-cm="undo"><i class="fas fa-rotate-left"></i>Undo</button> <button type="button" class="cm-ib" data-cm="undo-clear" aria-label="Dismiss"><i class="fas fa-xmark"></i></button></div>';
  }
  // Who and what still has no place on the programme.
  function trayView() {
    var p = toPlace();
    var sp = p.speakers.map(function (x) {
      return '<button type="button" class="cm-place" data-cm="slot-for" data-id="' + x.id + '" title="Give ' + esc(x.name) + ' a session">' + ava(x, 'is-small') + '<span><b>' + esc(x.name) + '</b><small>' + esc([x.role, x.organisation].filter(Boolean).join(', ') || 'Speaker') + '</small></span></button>';
    }).join('');
    var tk = p.talks.map(function (t) {
      return '<button type="button" class="cm-place" data-cm="place-talk" data-id="' + t.id + '" title="Give this talk a time">' + ava({ name: t.speaker_name, photo_url: t.photo_url }, 'is-small') + '<span><b>' + esc(t.speaker_name || t.company) + '</b><small>' + esc([t.company, t.topic].filter(Boolean).join(' · ') || 'Innovation Talk') + '</small></span></button>';
    }).join('');
    return '<div class="cm-tray cm-no-print" id="cm-tray">' +
      (p.n ? '' : '<div class="cm-help" style="margin:0"><i class="fas fa-circle-check" style="color:var(--cm-ok)"></i> Everyone shown to attendees has a session, and every Innovation Talk has a time.</div>') +
      (sp ? '<div class="cm-tray-h">Speakers with no session yet <span>' + p.speakers.length + '</span></div><div class="cm-tray-list">' + sp + '</div>' : '') +
      (tk ? '<div class="cm-tray-h">Innovation Talks with no time yet <span>' + p.talks.length + '</span></div><div class="cm-tray-list">' + tk + '</div>' : '') +
      (p.n ? '<div class="cm-help">Click one, then press <b>Find a free slot</b> in the form.</div>' : '') + '</div>';
  }
  function boardView() {
    if (S.listAll) S.listAll = false;
    var list = daySessions().filter(function (s) { return !isNaN(mins(s.start_time)) && !isNaN(mins(s.end_time)); });
    var halls = activeHalls();
    if (!halls.length) return '<div class="cm-empty"><i class="fas fa-door-open"></i>No halls yet. Add one in the Halls tab.</div>';
    var startM = 8 * 60, endM = 19 * 60;
    list.forEach(function (s) { startM = Math.min(startM, Math.floor(mins(s.start_time) / 60) * 60); endM = Math.max(endM, Math.ceil(mins(s.end_time) / 60) * 60); });
    var frees = S.showFree ? ((S.d.free || []).filter(function (f) { return f.day === S.day; })) : [];
    var H = (endM - startM) * PX;
    var times = '';
    // The first hour's label would sit under the hall names, so it starts at the second.
    for (var m = startM + 60; m <= endM; m += 60) times += '<div class="cm-time" style="top:' + ((m - startM) * PX) + 'px">' + esc(clock('0000-00-00 ' + hhmm(m))) + '</div>';
    var clashes = clashIds();
    var nowLine = '';
    var now = istNow();
    if (now.slice(0, 10) === S.day && mins(now) >= startM && mins(now) <= endM) nowLine = '<div class="cm-now" style="top:' + ((mins(now) - startM) * PX) + 'px"></div>';
    var heads = '<div class="cm-head is-corner"></div>' + halls.map(function (h) {
      var mine = list.filter(function (s) { return (s.room || '') === (h.name || ''); });
      var look = {}; mine.forEach(function (s) { issuesOfSession(s.id).forEach(function (i) { if (i.level !== 'info') look[s.id] = 1; }); });
      var nLook = Object.keys(look).length, freeM = 0;
      (S.d.free || []).forEach(function (f) { if (f.day === S.day && f.hall === h.name) freeM += f.minutes; });
      var sum = mine.length + ' session' + (mine.length === 1 ? '' : 's') + (nLook ? ' · <i class="is-warn">' + nLook + ' to check</i>' : '') + (freeM ? ' · ' + span(freeM) + ' free' : '');
      return '<div class="cm-head"><b>' + esc(h.short_name || h.name || 'No hall yet') + '</b><span>' + esc([h.venue_room, h.purpose].filter(Boolean).join(' · ') || h.name) + '</span><em class="cm-head-sum">' + sum + '</em></div>';
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
        if (!people && s.talks && s.talks.length) people = s.talks.map(function (t) { return t.speaker_name; }).filter(Boolean).join(', ');
        var mineIssues = issuesOfSession(s.id);
        var warn = mineIssues.filter(function (i) { return i.level === 'warn'; }).length, bad = clashes[s.id] || mineIssues.some(function (i) { return i.level === 'bad'; });
        var label = s.title + ', ' + clock(s.start_time) + ' to ' + clock(s.end_time) + (people ? ', ' + people : '');
        var tip = label + (mineIssues.length ? '\n\n' + mineIssues.map(function (i) { return '• ' + i.what; }).join('\n') : '');
        var healthy = !bad && !warn;
        return '<div role="button" tabindex="0" class="cm-block cm-t-' + esc(s.session_type) + (s.status === 'draft' ? ' is-draft' : '') + (bad ? ' is-clash' : warn ? ' is-warn' : '') + (S.dim && healthy ? ' is-dim' : '') + '" style="' + style + '" data-cm="edit-session" data-id="' + s.id + '" data-hall="' + esc(s.room || '') + '" title="' + esc(tip) + '" aria-label="' + esc(label + (mineIssues.length ? '. ' + mineIssues.length + ' note' + (mineIssues.length === 1 ? '' : 's') : '')) + '">' +
          '<span class="t">' + (bad ? '<i class="fas fa-triangle-exclamation" style="color:#B42318"></i> ' : warn ? '<i class="fas fa-triangle-exclamation" style="color:#B45309"></i> ' : '') + (s.status === 'draft' ? '<span class="cm-chip is-warn" style="margin:0 4px 0 0;padding:0 6px">Draft</span>' : '') + esc(s.title) + '</span>' +
          (ht >= 30 ? '<span class="w">' + esc(clock(s.start_time)) + ' to ' + esc(clock(s.end_time)) + ' · ' + esc(TYPE_WORD[s.session_type] || s.session_type) + '</span>' : '') +
          (ht >= 48 && people ? '<span class="p">' + esc(people) + '</span>' : '') +
          '<span class="cm-rs" data-rs="1" aria-hidden="true"></span>' +
        '</div>';
      }).join('');
      // Free time in this hall, inside the day's programme: click one to fill it.
      var gaps = frees.filter(function (f) { return f.hall === (h.name || ''); }).map(function (f) {
        var a = mins('0000-00-00 ' + f.start), gh = Math.max(14, f.minutes * PX - 2);
        return '<div role="button" tabindex="0" class="cm-free" style="top:' + ((a - startM) * PX + 1) + 'px;height:' + gh + 'px" data-cm="free" data-hall="' + esc(f.hall) + '" data-start="' + esc(f.start) + '" data-min="' + f.minutes + '" title="' + esc(f.hall + ' is free from ' + hm(f.start) + ' to ' + hm(f.end) + '. Click to add a session here.') + '">' +
          '<span>' + (gh >= 26 ? 'Free · ' + span(f.minutes) : span(f.minutes) + ' free') + (gh >= 44 ? '<small>' + esc(hm(f.start)) + ' to ' + esc(hm(f.end)) + ' · click to add</small>' : '') + '</span></div>';
      }).join('');
      return '<div class="cm-lane" style="height:' + H + 'px" data-cm="lane" data-hall="' + esc(h.name || '') + '" data-start="' + startM + '" title="Click an empty space to add a session here">' + gaps + blocks + nowLine + '</div>';
    }).join('');
    var legend = Object.keys(TYPE_WORD).filter(function (t) { return t !== 'networking'; }).map(function (t) { return '<span class="cm-chip"><span class="cm-dot cm-d-' + t + '"></span>' + TYPE_WORD[t] + '</span>'; }).join('');
    return '<div class="cm-help cm-no-print" style="margin:-4px 0 8px">Click a session to change it. Click an empty space in a hall to add one there. ' + legend + '<span class="cm-chip" style="border-style:dashed">Draft: not shown to attendees</span><span class="cm-chip is-warn"><i class="fas fa-triangle-exclamation"></i>Needs a look</span>' + (S.showFree ? '<span class="cm-chip cm-chip-free">Free time</span>' : '') + '</div>' +
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
    return '<div class="cm-table-wrap"><table class="cm-table"><thead><tr><th>Day</th><th>Time</th><th>Hall</th><th>Session</th><th>Speakers</th><th>Status</th></tr></thead><tbody>' +
      list.map(function (s) {
        var h = hallByName(s.room);
        var chips = (s.links || []).map(function (l) { var sp = speakerById(l.speaker_id); return sp ? '<span class="cm-chip">' + esc(sp.name) + (l.role && l.role !== 'speaker' ? ' · ' + esc(ROLE_WORD[l.role] || l.role) : '') + '</span>' : ''; }).join('') +
          (s.others ? '<span class="cm-chip is-warn" title="Typed by hand: not on the speakers list">' + esc(s.others) + '</span>' : '');
        return '<tr class="is-clickable" data-cm="edit-session" data-id="' + s.id + '">' +
          '<td>' + dayChip(s.start_time) + '</td>' +
          '<td style="white-space:nowrap"><b class="cm-clock">' + esc(clock(s.start_time)) + '</b><br><span class="cm-muted">to ' + esc(clock(s.end_time)) + '</span></td>' +
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
      // The line under a hand-typed name ("CEO, Acme"): kept through a save.
      typedTitle: preset.typedTitle || s.speaker_title || '',
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
      '<div class="cm-f"><label for="cm-s-title">Title</label><input id="cm-s-title" class="cm-in" maxlength="200" value="' + esc(s.title || preset.title || '') + '" placeholder="e.g. AI in Banking: from pilots to profit" autocomplete="off"></div>' +
      '<div class="cm-row"><div class="cm-f"><label for="cm-s-type">Type</label><select id="cm-s-type" class="cm-in" data-cm-input="s-check">' + typeOpts + '</select></div>' +
      '<div class="cm-f"><label for="cm-s-room">Hall</label><select id="cm-s-room" class="cm-in" data-cm-input="s-check">' + hallOpts + '</select></div></div>' +
      '<div class="cm-row3"><div class="cm-f"><label for="cm-s-day">Day</label><select id="cm-s-day" class="cm-in" data-cm-input="s-check">' + dayOpts + '</select></div>' +
      '<div class="cm-f"><label for="cm-s-start">Starts</label><input id="cm-s-start" type="time" step="300" class="cm-in" value="' + esc(start) + '" data-cm-input="s-check"></div>' +
      '<div class="cm-f"><label for="cm-s-end">Ends</label><input id="cm-s-end" type="time" step="300" class="cm-in" value="' + esc(end) + '" data-cm-input="s-check"></div></div>' +
      '<div class="cm-durs" style="margin:-8px 0 14px"><span class="cm-help" style="margin:4px 4px 0 0">Length:</span>' + [5, 8, 10, 15, 20, 30, 45, 60, 90, 120].map(function (m) { return '<button type="button" class="cm-dur" data-cm="dur" data-k="' + m + '">' + (m < 60 ? m + ' min' : (m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) : '')) + '</button>'; }).join('') + '</div>' +
      '<div class="cm-f" style="margin-top:-6px"><button type="button" class="cm-btn is-small" data-cm="find-slot"><i class="fas fa-wand-magic-sparkles"></i>Find a free slot</button> <span class="cm-help" style="display:inline">A time when a hall is free and none of its speakers is on stage elsewhere.</span><div id="cm-s-slots"></div></div>' +
      '<div class="cm-f"><span class="cm-lbl">Speakers <em>in the order the app should list them</em></span><div id="cm-s-people"></div>' +
        '<div class="cm-pick"><input id="cm-s-pick" class="cm-in" placeholder="Add a speaker: type a name or organisation" autocomplete="off" data-cm-input="pick" aria-label="Add a speaker"><div id="cm-s-pick-list"></div></div>' +
        '<button type="button" class="cm-btn is-small" style="margin-top:8px" data-cm="new-in-session"><i class="fas fa-user-plus"></i>New speaker, with email and mobile</button><div id="cm-s-newsp"></div></div>' +
      '<div class="cm-f"><label for="cm-s-others">Or type everyone in one box <em>(shown in the app exactly as typed)</em></label><input id="cm-s-others" class="cm-in" value="' + esc(s.others || preset.others || '') + '" placeholder="e.g. Asha Rao (Tata Capital), Vikram Shah (Moderator)" autocomplete="off">' +
        '<div class="cm-help">Each person as Name (Organisation), separated by commas. People typed here have no profile, pass or slot email until they are speakers.</div>' +
        '<button type="button" class="cm-btn is-small" style="margin-top:6px" data-cm="others-to-speakers"><i class="fas fa-wand-magic-sparkles"></i>Turn these names into speakers</button> <span class="cm-help" style="display:inline">Each joins the speakers list and this session; add their email and mobile on their page.</span></div>' +
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
      '<div class="cm-pick-item' + (ED.pickIdx === hits.length ? ' is-active' : '') + '" data-cm="pick-new"><span class="cm-ava"><i class="fas fa-plus"></i></span><div><b>Add "' + esc(ED.pickQ.trim()) + '" as a new speaker</b><span>With their designation, organisation, email and mobile</span></div></div></div>';
  }
  function readSession() {
    var day = val('cm-s-day'), st = val('cm-s-start'), en = val('cm-s-end');
    var draft = $('cm-s-draft');
    return {
      event_id: eid(), title: val('cm-s-title').trim(), session_type: val('cm-s-type'), room: val('cm-s-room'), speaker_title: (ED && ED.typedTitle) || '',
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
      (sp.pass ? '<span class="cm-chip is-ok"><i class="fas fa-id-badge"></i>' + esc(sp.pass.badge_type || 'Pass') + '</span>' : (sp.email ? (live() ? '<button type="button" class="cm-chip cm-chip-btn" data-cm="give-pass" data-id="' + sp.id + '" title="Give ' + esc(sp.name) + ' a Speaker pass"><i class="fas fa-id-badge"></i>No pass · issue one</button>' : '<span class="cm-chip"><i class="fas fa-id-badge"></i>No pass</span>') : '<span class="cm-chip is-warn" title="A pass is kept under an email"><i class="fas fa-id-badge"></i>No email, so no pass</span>')) +
      (sp.email ? '' : '<span class="cm-chip is-bad"><i class="fas fa-envelope"></i>No email</span>');
    return '<div class="cm-card' + (pub ? '' : ' is-hidden') + '">' +
      '<div class="cm-who" data-cm="edit-speaker" data-id="' + sp.id + '">' + ava(sp) + '<div style="min-width:0"><b>' + esc(sp.name) + '</b><span class="r">' + esc([sp.role, sp.organisation].filter(Boolean).join(', ') || 'No title yet') + '</span></div></div>' +
      '<div>' + chips + '</div>' + slots +
      '<div class="cm-actions">' +
        '<button type="button" class="cm-btn is-small" data-cm="edit-speaker" data-id="' + sp.id + '"><i class="fas fa-pen"></i>Edit</button>' +
        '<button type="button" class="cm-btn is-small" data-cm="announce" data-id="' + sp.id + '"' + (pub ? '' : ' disabled title="Show them to attendees first"') + '><i class="fas fa-bullhorn"></i>Announce</button>' +
        '<button type="button" class="cm-btn is-small" data-cm="slot-email" data-id="' + sp.id + '"' + (ss.length ? '' : ' disabled title="Give them a session first"') + '><i class="fas fa-envelope"></i>Email slot</button>' +
        (global.SpeakerBrief && live() ? '<button type="button" class="cm-btn is-small" data-cm="brief" data-id="' + sp.id + '"><i class="fas fa-id-badge"></i>Brief</button>' : '') +
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
      event_id: eid(), name: val('cm-p-name').trim(), role: val('cm-p-role').trim(), organisation: val('cm-p-org').trim(), topic: val('cm-p-topic').trim(), bio: val('cm-p-bio').trim(),
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
    var W = words();
    if (!s) return live()
      ? { title: sp.name + ' speaks at Bharat AI Innovation 2026', content: who + ', is speaking at Bharat AI Innovation 2026 on 20-21 November at the World Trade Center, Mumbai.' }
      : { title: sp.name + ' speaks at ' + W.name, content: who + ', is speaking at ' + W.name + (W.when ? ' on ' + W.when : '') + (W.venue ? ' at ' + W.venue : '') + '.' };
    var h = hallByName(s.room);
    // In a sentence the venue's name goes in brackets: "Aryabhata Theatre (Expo Hall)" (handbook §4).
    var where = s.room ? s.room + (h && h.venue_room && h.venue_room !== s.room ? ' (' + h.venue_room + ')' : '') : 'a hall we will confirm soon';
    var part = roleIn(s, sp.id);
    var as = part === 'moderator' ? 'moderates' : part === 'keynote' ? 'gives the keynote' : part === 'panellist' ? 'joins the panel' : 'speaks';
    return {
      title: sp.name + ' ' + (part === 'keynote' ? 'gives a keynote' : part === 'moderator' ? 'moderates a session' : 'speaks') + ' on ' + dayLabel(s.start_time),
      content: who + ', ' + as + ' at ' + (live() ? 'Bharat AI Innovation 2026' : W.name) + ': "' + s.title + '".\n\n' + dayLabel(s.start_time, true) + ', ' + clock(s.start_time) + ' to ' + clock(s.end_time) + ', ' + where + '.\n\nStar the session in your Conference Schedule so you do not miss it.',
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
    var v = { event_id: eid(), name: val('cm-h-name').trim(), short_name: val('cm-h-short').trim(), venue_room: val('cm-h-room').trim(), location: val('cm-h-loc').trim(), purpose: val('cm-h-purpose').trim(), capacity: val('cm-h-cap').trim(), is_active: $('cm-h-active').checked ? 1 : 0 };
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
      '<h1>Run sheet: ' + esc(dayLabel(day, true)) + '</h1><p class="s">' + esc(live() ? 'Bharat AI Innovation 2026, World Trade Center, Mumbai' : words().name + (words().venue ? ', ' + words().venue : '')) + '. Printed ' + esc(istNow()) + ' IST. Mobiles are private: for the stage team only.</p>' +
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

  // ---------- downloads: the programme as a PDF page and as an Excel workbook ----------
  // The team asked (12 Nov 2026) for the schedule as a PDF with the speakers' photos, as
  // a PDF without, and as a professional Excel sheet. Drafts are left out of all three:
  // these are for sharing. Each function takes the loaded data, so the tests can call it.
  function plainName(n) { return String(n || '').toLowerCase().replace(/[^a-z]/g, ''); }
  function sharedSessions(d) {
    var order = {}; (d.halls || []).forEach(function (h, i) { order[h.name] = i; });
    return (d.sessions || []).filter(function (s) { return s.status !== 'draft' && s.start_time && s.end_time && s.start_time < s.end_time; })
      .sort(function (a, b) { return a.start_time < b.start_time ? -1 : a.start_time > b.start_time ? 1 : (order[a.room] == null ? 99 : order[a.room]) - (order[b.room] == null ? 99 : order[b.room]); });
  }
  // Everyone on stage in a session: listed speakers, an Innovation Talk's speaker, and
  // people typed by hand, each with the line under their name and a photo if there is one.
  function peopleOf(d, s) {
    var out = [], seen = {};
    var push = function (name, line, part, photo) {
      var k = plainName(name); if (!k || seen[k]) return; seen[k] = 1;
      out.push({ name: name, line: line || '', part: part || '', photo: photo && /^(\/|https:\/\/)/.test(photo) ? photo : '' });
    };
    var byId = {}; (d.speakers || []).forEach(function (x) { byId[x.id] = x; });
    (s.links || []).forEach(function (l) {
      var sp = byId[l.speaker_id]; if (!sp) return;
      push(sp.name, [sp.role, sp.organisation].filter(Boolean).join(', '), l.role === 'moderator' ? 'Moderator' : l.role === 'host' ? 'Host' : l.role === 'chair' ? 'Chair' : '', sp.photo_url);
    });
    (s.talks || []).forEach(function (t) { if (t.speaker_name) push(t.speaker_name, [t.speaker_title, t.company].filter(Boolean).join(', '), '', t.photo_url); });
    splitTyped(s.others).forEach(function (p) {
      var solo = !(s.links || []).length && splitTyped(s.others).length === 1;
      push(p.name, p.role ? '' : (p.info || (solo ? (s.speaker_title || '') : '')), p.role ? p.role.charAt(0).toUpperCase() + p.role.slice(1) : '', '');
    });
    return out;
  }
  function longDay(d) {
    var x = new Date(String(d).slice(0, 10) + 'T00:00:00Z'); if (isNaN(x.getTime())) return String(d || '');
    return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][x.getUTCDay()] + ' ' + x.getUTCDate() + ' ' +
      ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][x.getUTCMonth()] + ' ' + x.getUTCFullYear();
  }
  function fileStem(d) { return String((d.words && d.words.name) || 'Programme').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-programme'; }

  // The programme as a page made for paper: A4, one section a day, a table a hall. The
  // browser's own "Save as PDF" turns it into the file, with the text still text.
  function scheduleHtml(d, opt) {
    opt = opt || {};
    var W = d.words || words(), origin = opt.origin == null ? (global.location ? global.location.origin : '') : opt.origin;
    var list = sharedSessions(d), days = (d.days || []).filter(function (day) { return list.some(function (s) { return String(s.start_time).slice(0, 10) === day; }); });
    var drafts = (d.sessions || []).filter(function (s) { return s.status === 'draft'; }).length;
    var hallOf = {}; (d.halls || []).forEach(function (h) { hallOf[h.name] = h; });
    var face = function (p) {
      if (!opt.photos) return '';
      var small = opt.photoMap && opt.photoMap[p.photo];
      return p.photo ? '<img class="ph" src="' + esc(small || (/^\//.test(p.photo) ? origin + p.photo : p.photo)) + '" alt="">' : '<span class="ph is-none">' + esc(ownInitial(p.name)) + '</span>';
    };
    var body = days.map(function (day, i) {
      var today = list.filter(function (s) { return String(s.start_time).slice(0, 10) === day; });
      var rooms = []; today.forEach(function (s) { if (rooms.indexOf(s.room || '') < 0) rooms.push(s.room || ''); });
      rooms.sort(function (a, b) { var ha = hallOf[a], hb = hallOf[b]; return (ha ? Number(ha.sort_order) || 0 : 99) - (hb ? Number(hb.sort_order) || 0 : 99); });
      return '<section class="day"><h2><span>Day ' + ((d.days || []).indexOf(day) + 1) + '</span>' + esc(longDay(day)) + '</h2>' + rooms.map(function (room) {
        var h = hallOf[room] || {};
        var rows = today.filter(function (s) { return (s.room || '') === room; }).map(function (s) {
          var people = peopleOf(d, s);
          var who = people.map(function (p) {
            return '<div class="p">' + face(p) + '<div><b>' + esc(p.name) + '</b>' + (p.part ? ' <em>' + esc(p.part) + '</em>' : '') + (p.line ? '<span>' + esc(p.line) + '</span>' : '') + '</div></div>';
          }).join('');
          var quiet = s.session_type === 'break' || s.session_type === 'networking';
          return '<tr class="' + (quiet ? 'is-quiet' : '') + '"><td class="time"><b>' + esc(clock(s.start_time)) + '</b><span>to ' + esc(clock(s.end_time)) + '</span></td>' +
            '<td class="what"><span class="type t-' + esc(s.session_type) + '">' + esc(TYPE_WORD[s.session_type] || s.session_type) + '</span><b>' + esc(s.title) + '</b>' + (s.track ? '<span class="track">' + esc(s.track) + '</span>' : '') + '</td>' +
            '<td class="who' + (opt.photos ? ' has-ph' : '') + '">' + who + '</td></tr>';
        }).join('');
        return '<div class="hall"><h3>' + esc(room || 'Hall to be confirmed') + (h.venue_room ? ' <small>' + esc(h.venue_room) + (h.location ? ', ' + esc(h.location) : '') + '</small>' : '') + '</h3>' +
          '<table><thead><tr><th>Time</th><th>Session</th><th>Speakers</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
      }).join('') + '</section>';
    }).join('');
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(W.name) + ' programme</title><style>' +
      '*{box-sizing:border-box}body{font-family:"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1E2140;margin:0;background:#EEF0F6;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
      '.sheet{max-width:210mm;margin:0 auto;background:#fff;padding:14mm 13mm}' +
      '.bar{position:sticky;top:0;z-index:2;background:#1E2140;color:#fff;padding:10px 16px;display:flex;gap:12px;align-items:center;font-size:13px}' +
      '.bar button{background:#C84F00;color:#fff;border:0;border-radius:8px;padding:9px 16px;font-size:13px;font-weight:700;cursor:pointer}' +
      'header{display:flex;align-items:center;gap:14px;border-bottom:3px solid #C84F00;padding-bottom:12px;margin-bottom:6px}header img{height:46px}' +
      'h1{font-size:21px;margin:0;line-height:1.2}header p{margin:3px 0 0;color:#5B6178;font-size:12.5px}.asof{margin-left:auto;text-align:right;font-size:10.5px;color:#8A90A6;white-space:nowrap}' +
      'h2{font-size:16px;margin:20px 0 4px;color:#1E2140}h2 span{display:inline-block;background:#C84F00;color:#fff;border-radius:6px;padding:2px 9px;font-size:11px;margin-right:9px;vertical-align:2px;text-transform:uppercase;letter-spacing:.05em}' +
      '.hall{margin-top:12px}h3{font-size:13.5px;margin:0 0 5px;padding:6px 10px;background:#FFF1E8;border-left:4px solid #C84F00;border-radius:0 6px 6px 0;break-after:avoid}h3 small{font-weight:500;color:#5B6178;font-size:11.5px}' +
      'table{width:100%;border-collapse:collapse;font-size:11.5px}th{text-align:left;font-size:9.5px;text-transform:uppercase;letter-spacing:.05em;color:#8A90A6;padding:4px 8px;border-bottom:1px solid #E4E7F2}' +
      'td{padding:7px 8px;border-bottom:1px solid #EEF0F6;vertical-align:top}tr{break-inside:avoid}thead{display:table-header-group}' +
      'td.time{width:88px;white-space:nowrap}td.time b{display:block;font-size:12px}td.time span{color:#8A90A6;font-size:10.5px}' +
      'td.what{width:44%}td.what b{display:block;font-size:12.5px;line-height:1.3}.track{display:block;color:#8A90A6;font-size:10.5px;margin-top:2px}' +
      '.type{display:inline-block;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:1px 6px;border-radius:4px;margin-bottom:3px;background:#F4F6FC;color:#5B6178}' +
      '.t-keynote{background:#FFF1E8;color:#A44100}.t-panel{background:#EEF0FF;color:#3730A3}.t-talk{background:#E7F6FA;color:#0E7490}.t-workshop{background:#E9F7EE;color:#166534}.t-ceremony{background:#FEF7E0;color:#854D0E}' +
      'tr.is-quiet td{background:#FAFBFD;color:#5B6178}tr.is-quiet td.what b{font-weight:600}' +
      '.p{display:flex;gap:8px;align-items:center;margin-bottom:5px}.p:last-child{margin-bottom:0}.p b{font-size:11.5px}.p em{font-style:normal;font-size:9.5px;font-weight:700;color:#C84F00;text-transform:uppercase}.p span{display:block;color:#5B6178;font-size:10.5px;line-height:1.3}' +
      '.ph{width:34px;height:34px;border-radius:50%;object-fit:cover;flex:none;border:1px solid #E4E7F2}.ph.is-none{display:flex;align-items:center;justify-content:center;background:#F4F6FC;color:#8A90A6;font-weight:700;font-size:13px}' +
      'footer{margin-top:18px;padding-top:8px;border-top:1px solid #E4E7F2;font-size:10px;color:#8A90A6;display:flex;justify-content:space-between;gap:10px}' +
      '@page{size:A4;margin:11mm}@media print{body{background:#fff}.bar{display:none}.sheet{max-width:none;padding:0}}' +
      '</style></head><body>' +
      '<div class="bar"><button type="button" onclick="window.print()">Save as PDF</button><span>In the window that opens, choose <b>Save as PDF</b> as the printer, then Save.</span></div>' +
      '<div class="sheet"><header><img src="' + esc(origin) + '/images/logo-nav.webp" alt="" onerror="this.style.display=&quot;none&quot;"><div><h1>' + esc(W.name) + '</h1><p>' + esc(W.line || [W.when, W.venue].filter(Boolean).join(' · ')) + '</p></div>' +
      '<div class="asof">Programme<br>as of ' + esc(opt.asOf || dayLabel(istNow(), true)) + '</div></header>' +
      (body || '<p style="color:#5B6178">Nothing is on the programme yet.</p>') +
      '<footer><span>Times are India time. The programme can change: the event app has the latest.</span><span>bharataiinnovation.com</span></footer></div>' +
      (opt.autoPrint === false ? '' : '<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},500)})<\/script>') +
      '<!-- ' + list.length + ' sessions, ' + drafts + ' drafts left out --></body></html>';
  }
  // "Hon'ble Shri Chandrakant Patil" is C, not S: every title of address comes off first.
  function ownInitial(name) {
    var n = String(name || '').trim(), was;
    do { was = n; n = n.replace(/^(hon[’']?ble|shri\.?|smt\.?|dr\.?|mr\.?|ms\.?|mrs\.?|prof\.?|cmde\.?|capt\.?|col\.?|justice)\s+/i, ''); } while (n !== was);
    return (n.charAt(0) || '?').toUpperCase();
  }
  // A photo is drawn 34 pixels wide, so it is made small before the page is written:
  // the PDF of a full programme is then a few hundred KB, not nine MB. A picture from
  // another site cannot be read back, and is used as it is.
  function shrinkPhoto(url) {
    return new Promise(function (resolve) {
      var img = new Image(), done = false;
      var finish = function (v) { if (!done) { done = true; resolve(v); } };
      img.onload = function () {
        try {
          var n = 120, c = document.createElement('canvas'); c.width = n; c.height = n;
          var side = Math.min(img.naturalWidth, img.naturalHeight);
          // A tall portrait keeps its top, where the face is.
          c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) * 0.12, side, side, 0, 0, n, n);
          finish(c.toDataURL('image/jpeg', 0.88));
        } catch (e) { finish(''); }
      };
      img.onerror = function () { finish(''); };
      if (!/^\//.test(url)) img.crossOrigin = 'anonymous';
      img.src = url;
      setTimeout(function () { finish(''); }, 6000);
    });
  }
  async function openSchedule(photos) {
    var w = window.open('', '_blank');
    if (!w) { say('Your browser blocked the new window. Allow pop-ups for this page.', 'error'); return; }
    w.document.write('<!doctype html><title>Programme</title><p style="font-family:Segoe UI,Arial,sans-serif;padding:28px;color:#5B6178">Preparing the programme…</p>');
    w.document.close();
    var map = {};
    if (photos) {
      var urls = {};
      sharedSessions(S.d).forEach(function (s) { peopleOf(S.d, s).forEach(function (p) { if (p.photo) urls[p.photo] = 1; }); });
      var list = Object.keys(urls);
      var small = await Promise.all(list.map(shrinkPhoto));
      list.forEach(function (u, i) { if (small[i]) map[u] = small[i]; });
    }
    w.document.open();
    w.document.write(scheduleHtml(S.d, { photos: !!photos, photoMap: map }));
    w.document.close();
    var drafts = (S.d.sessions || []).filter(function (s) { return s.status === 'draft'; }).length;
    say('The programme is open in a new tab. Choose "Save as PDF" there.' + (drafts ? ' ' + drafts + ' draft' + (drafts === 1 ? ' is' : 's are') + ' left out.' : ''), 'info');
  }

  // The same programme as an Excel workbook: a Programme sheet and a Speakers sheet,
  // with a coloured heading row that stays in place, filters, and wrapped text.
  // Styles: 1 title, 2 subtitle, 3 heading, 4 cell, 5 cell on a tint, 6 bold cell, 7 bold on a tint, 8 day band.
  function programmeSheets(d) {
    var W = d.words || words();
    var list = sharedSessions(d), hallOf = {}; (d.halls || []).forEach(function (h) { hallOf[h.name] = h; });
    var c = function (v, s) { return { v: v == null ? '' : String(v), s: s }; };
    var head = ['Day', 'Date', 'Starts', 'Ends', 'Hall', 'Room at the venue', 'Type', 'Session', 'Speakers', 'Designation and organisation', 'Track'];
    var rows = [[c(W.name + ': programme', 1)], [c([W.line || [W.when, W.venue].filter(Boolean).join(' · '), 'as of ' + dayLabel(istNow(), true), 'times are India time'].filter(Boolean).join('  |  '), 2)], [], head.map(function (h) { return c(h, 3); })];
    var lastDay = '', n = 0;
    list.forEach(function (s) {
      var day = String(s.start_time).slice(0, 10), i = (d.days || []).indexOf(day);
      if (day !== lastDay) { lastDay = day; n = 0; rows.push([c('Day ' + (i + 1) + '  ·  ' + longDay(day), 8)].concat(head.slice(1).map(function () { return c('', 8); }))); }
      var tint = n++ % 2 === 1, body = tint ? 5 : 4, strong = tint ? 7 : 6;
      var people = peopleOf(d, s), h = hallOf[s.room] || {};
      rows.push([c('Day ' + (i + 1), body), c(dayLabel(day, true), body), c(clock(s.start_time), strong), c(clock(s.end_time), body), c(s.room || 'To be confirmed', body), c(h.venue_room || '', body),
        c(TYPE_WORD[s.session_type] || s.session_type, body), c(s.title, strong),
        c(people.map(function (p) { return p.name + (p.part ? ' (' + p.part + ')' : ''); }).join('\n'), body), c(people.map(function (p) { return p.line || '-'; }).join('\n'), body), c(s.track || '', body)]);
    });
    var lastRow = rows.length;
    var prog = { name: 'Programme', cols: [8, 14, 10, 10, 22, 18, 12, 46, 30, 44, 20], rows: rows, freeze: 4, merges: ['A1:K1', 'A2:K2'], filter: 'A4:K' + lastRow, landscape: true };
    rows.forEach(function (r, i) { if (r[0] && r[0].s === 8) prog.merges.push('A' + (i + 1) + ':K' + (i + 1)); });

    var sHead = ['Speaker', 'Designation', 'Organisation', 'Sessions', 'When and where'];
    var sRows = [[c(W.name + ': speakers', 1)], [c('Everyone on the programme, with their sessions', 2)], [], sHead.map(function (h) { return c(h, 3); })];
    var by = {}, names = [];
    list.forEach(function (s) {
      peopleOf(d, s).forEach(function (p) {
        var k = plainName(p.name); if (!by[k]) { by[k] = { p: p, at: [] }; names.push(k); }
        by[k].at.push(dayLabel(s.start_time) + ', ' + clock(s.start_time) + ', ' + (s.room || 'hall to be confirmed') + ': ' + s.title + (p.part ? ' (' + p.part + ')' : ''));
      });
    });
    var spBy = {}; (d.speakers || []).forEach(function (x) { spBy[plainName(x.name)] = x; });
    names.sort(function (a, b) { return initialSort(by[a].p.name).localeCompare(initialSort(by[b].p.name)); }).forEach(function (k, i) {
      var x = by[k], sp = spBy[k], body = i % 2 ? 5 : 4;
      sRows.push([c(x.p.name, i % 2 ? 7 : 6), c(sp ? sp.role || '' : x.p.line.split(', ')[0] || '', body), c(sp ? sp.organisation || '' : x.p.line.split(', ').slice(1).join(', '), body), c(String(x.at.length), body), c(x.at.join('\n'), body)]);
    });
    return [prog, { name: 'Speakers', cols: [30, 34, 36, 10, 80], rows: sRows, freeze: 4, merges: ['A1:E1', 'A2:E2'], filter: 'A4:E' + sRows.length, landscape: true }];
  }
  // A real .xlsx, written here: a zip (stored, not squeezed) of the few XML parts Excel
  // and Google Sheets need. No library: the one on this page cannot colour a cell.
  var CRC = null;
  function crc32(bytes) {
    if (!CRC) { CRC = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = CRC[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function xmlText(v) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function colName(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function sheetXml(sh) {
    var X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0" showGridLines="0">' +
      (sh.freeze ? '<pane ySplit="' + sh.freeze + '" topLeftCell="A' + (sh.freeze + 1) + '" activePane="bottomLeft" state="frozen"/>' : '') + '</sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/><cols>' + sh.cols.map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('') + '</cols><sheetData>';
    sh.rows.forEach(function (row, r) {
      if (!row.length) { X += '<row r="' + (r + 1) + '"/>'; return; }
      var tall = row[0] && (row[0].s === 1 ? ' ht="26" customHeight="1"' : row[0].s === 3 ? ' ht="22" customHeight="1"' : row[0].s === 8 ? ' ht="20" customHeight="1"' : '');
      X += '<row r="' + (r + 1) + '"' + (tall || '') + '>' + row.map(function (cell, i) {
        return '<c r="' + colName(i) + (r + 1) + '" s="' + (cell.s || 0) + '" t="inlineStr"><is><t xml:space="preserve">' + xmlText(cell.v) + '</t></is></c>';
      }).join('') + '</row>';
    });
    X += '</sheetData>' + (sh.filter ? '<autoFilter ref="' + sh.filter + '"/>' : '') +
      (sh.merges && sh.merges.length ? '<mergeCells count="' + sh.merges.length + '">' + sh.merges.map(function (m) { return '<mergeCell ref="' + m + '"/>'; }).join('') + '</mergeCells>' : '') +
      '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="' + (sh.landscape ? 'landscape' : 'portrait') + '" fitToWidth="1" fitToHeight="0"/></worksheet>';
    return X;
  }
  function xlsxBytes(sheets) {
    var NS = 'http://schemas.openxmlformats.org/', H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    var border = '<border><left style="thin"><color rgb="FFE4E7F2"/></left><right style="thin"><color rgb="FFE4E7F2"/></right><top style="thin"><color rgb="FFE4E7F2"/></top><bottom style="thin"><color rgb="FFE4E7F2"/></bottom><diagonal/></border>';
    var xf = function (font, fill, brd, align) { return '<xf numFmtId="0" fontId="' + font + '" fillId="' + fill + '" borderId="' + brd + '" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' + align + '</xf>'; };
    var top = '<alignment vertical="top" wrapText="1"/>', mid = '<alignment vertical="center"/>';
    var styles = H + '<styleSheet xmlns="' + NS + 'spreadsheetml/2006/main">' +
      '<fonts count="6"><font><sz val="10"/><color rgb="FF1E2140"/><name val="Calibri"/></font><font><b/><sz val="16"/><color rgb="FFC84F00"/><name val="Calibri"/></font>' +
        '<font><sz val="10"/><color rgb="FF5B6178"/><name val="Calibri"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="10"/><color rgb="FF1E2140"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF1E2140"/><name val="Calibri"/></font></fonts>' +
      '<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFC84F00"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF7F8FC"/><bgColor indexed="64"/></patternFill></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF1E8"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' + border + '</borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="9">' +
        xf(0, 0, 0, '<alignment vertical="top"/>') + xf(1, 0, 0, mid) + xf(2, 0, 0, mid) + xf(3, 2, 1, '<alignment vertical="center" wrapText="1"/>') +
        xf(0, 0, 1, top) + xf(0, 3, 1, top) + xf(4, 0, 1, top) + xf(4, 3, 1, top) + xf(5, 4, 1, mid) +
      '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
    var files = [
      ['[Content_Types].xml', H + '<Types xmlns="' + NS + 'package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets.map(function (s, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') + '</Types>'],
      ['_rels/.rels', H + '<Relationships xmlns="' + NS + 'package/2006/relationships"><Relationship Id="rId1" Type="' + NS + 'officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', H + '<workbook xmlns="' + NS + 'spreadsheetml/2006/main" xmlns:r="' + NS + 'officeDocument/2006/relationships"><sheets>' +
        sheets.map(function (s, i) { return '<sheet name="' + xmlText(String(s.name).slice(0, 31)).replace(/"/g, '&quot;') + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels', H + '<Relationships xmlns="' + NS + 'package/2006/relationships">' +
        sheets.map(function (s, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="' + NS + 'officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') +
        '<Relationship Id="rId' + (sheets.length + 1) + '" Type="' + NS + 'officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ['xl/styles.xml', styles],
    ].concat(sheets.map(function (s, i) { return ['xl/worksheets/sheet' + (i + 1) + '.xml', sheetXml(s)]; }));
    var enc = new TextEncoder(), parts = [], central = [], offset = 0;
    var u16 = function (n) { return [n & 255, (n >>> 8) & 255]; }, u32 = function (n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; };
    files.forEach(function (f) {
      var name = enc.encode(f[0]), data = enc.encode(f[1]), crc = crc32(data);
      var common = [].concat(u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      var local = new Uint8Array([0x50, 0x4B, 3, 4].concat(common));
      parts.push(local, name, data);
      central.push({ head: new Uint8Array([0x50, 0x4B, 1, 2].concat(u16(20), common, u16(0), u16(0), u16(0), u32(0), u32(offset))), name: name });
      offset += local.length + name.length + data.length;
    });
    var cdSize = 0; central.forEach(function (x) { parts.push(x.head, x.name); cdSize += x.head.length + x.name.length; });
    parts.push(new Uint8Array([0x50, 0x4B, 5, 6].concat(u16(0), u16(0), u16(files.length), u16(files.length), u32(cdSize), u32(offset), u16(0))));
    var total = 0; parts.forEach(function (p) { total += p.length; });
    var out = new Uint8Array(total), at = 0;
    parts.forEach(function (p) { out.set(p, at); at += p.length; });
    return out;
  }
  function downloadXlsx() {
    var bytes = xlsxBytes(programmeSheets(S.d));
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = fileStem(S.d) + '.xlsx';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    say('Downloaded. It opens in Excel, and in Google Sheets by uploading it to Drive.');
  }

  // ---------- needs attention: everything a person should look at, worst first ----------
  var GROUPS = [['all', 'Everything'], ['clash', 'Clashes'], ['session', 'Sessions'], ['speaker', 'Speakers'], ['talk', 'Innovation Talks'], ['free', 'Free time'], ['draft', 'Drafts']];
  function attentionView() {
    var hidden = hiddenKeys();
    var base = S.attHidden ? allIssues().filter(function (i) { return hidden[i.key]; }) : issues();
    var byDay = base.filter(function (i) { return !S.attDay || !i.day || i.day === S.attDay; });
    var count = function (g) { return byDay.filter(function (i) { return g === 'all' || i.group === g; }).length; };
    var list = byDay.filter(function (i) { return S.att === 'all' || i.group === S.att; });
    var chips = GROUPS.map(function (g) {
      var n = count(g[0]); if (!n && g[0] !== 'all' && S.att !== g[0]) return '';
      return '<button type="button" class="cm-pill ' + (S.att === g[0] ? 'is-on' : '') + '" data-cm="att" data-k="' + g[0] + '">' + g[1] + '<small>' + n + '</small></button>';
    }).join('');
    var days = S.d.days || [];
    var dayPills = days.length > 1 ? '<div class="cm-pills"><button type="button" class="cm-pill ' + (!S.attDay ? 'is-on' : '') + '" data-cm="att-day" data-k="">All days</button>' +
      days.map(function (d, i) { return '<button type="button" class="cm-pill ' + (S.attDay === d ? 'is-on' : '') + '" data-cm="att-day" data-k="' + esc(d) + '">Day ' + (i + 1) + ' · ' + esc(dayLabel(d)) + '</button>'; }).join('') + '</div>' : '';
    var nHidden = allIssues().filter(function (i) { return hidden[i.key]; }).length;
    var bar = '<div class="cm-bar cm-no-print"><div class="cm-pills">' + chips + '</div><span class="cm-spacer"></span>' + dayPills +
      (nHidden || S.attHidden ? '<button type="button" class="cm-btn is-small" data-cm="att-hidden">' + (S.attHidden ? 'Back to the list' : 'Hidden by you (' + nHidden + ')') + '</button>' : '') + '</div>';
    if (!list.length) {
      return bar + '<div class="cm-table-wrap"><div class="cm-empty"><i class="fas fa-circle-check" style="color:#86C79B"></i>' +
        (S.attHidden ? 'Nothing hidden.' : S.att === 'all' ? 'Nothing needs attention. The programme can run as written.' : 'Nothing here.') + '</div></div>';
    }
    return bar + '<div class="cm-table-wrap"><table class="cm-table cm-att"><thead><tr><th style="width:104px">How serious</th><th>What</th><th>When and where</th><th>What you can do</th></tr></thead><tbody>' +
      list.map(issueRow).join('') + '</tbody></table></div>' +
      '<div class="cm-help" style="margin-top:8px"><b>Cannot run</b>: two things in one place, or one person in two. <b>Check</b>: something is missing or doubtful. <b>Note</b>: worth knowing. Hide a note you have dealt with; it stays hidden in this browser only.</div>';
  }
  function issueRow(i) {
    var L = { bad: ['is-bad', 'Cannot run'], warn: ['is-warn', 'Check'], info: ['', 'Note'] }[i.level] || ['', 'Note'];
    var when = (i.day ? dayLabel(i.day) : '') + (i.start ? (i.day ? ', ' : '') + hm(i.start) + (i.end ? ' to ' + hm(i.end) : '') : '');
    var h = i.hall ? hallByName(i.hall) : null;
    var where = i.hall ? i.hall + (h && h.venue_room ? ' · ' + h.venue_room : '') : '';
    var b = function (act, label, icon, attrs, cls) { return '<button type="button" class="cm-btn is-small ' + (cls || '') + '" data-cm="' + act + '" ' + (attrs || '') + '><i class="fas ' + icon + '"></i>' + label + '</button>'; };
    var acts = [];
    if (i.kind === 'free' || i.kind === 'empty-hall') {
      var m = i.start && i.end ? mins('0000-00-00 ' + i.end) - mins('0000-00-00 ' + i.start) : 30;
      acts.push(b('free', 'Add a session here', 'fa-plus', 'data-day="' + esc(i.day) + '" data-hall="' + esc(i.hall) + '" data-start="' + esc(i.start) + '" data-min="' + m + '"', 'is-primary'));
      acts.push(b('show-on-board', 'Show on the board', 'fa-calendar-day', 'data-day="' + esc(i.day) + '" data-hall="' + esc(i.hall) + '" data-start="' + esc(i.start) + '"'));
    } else if (i.kind === 'empty-day') {
      acts.push(b('show-day', 'Open the day', 'fa-calendar-day', 'data-day="' + esc(i.day) + '"', 'is-primary'));
    } else if (i.kind === 'talk-not-on-programme') {
      acts.push(b('place-talk', 'Add to the programme', 'fa-plus', 'data-id="' + i.talk_id + '"', 'is-primary'));
      acts.push(b('go-talks', 'Innovation Talks', 'fa-microphone-lines'));
    } else if (i.kind === 'talks-unplaced') {
      acts.push(b('open-tray', 'Show them', 'fa-user-plus', '', 'is-primary'));
    } else if (i.group === 'speaker') {
      acts.push(b('edit-speaker', 'Open', 'fa-pen', 'data-id="' + i.speaker_id + '"', 'is-primary'));
      if (i.kind === 'speaker-no-session') acts.push(b('slot-for', 'Give a session', 'fa-calendar-plus', 'data-id="' + i.speaker_id + '"'));
    } else if (i.session_id) {
      if (i.kind === 'talk-differs') acts.push(b('talk-sync', 'Use the programme’s time', 'fa-check', 'data-id="' + i.session_id + '"', 'is-primary'));
      if (i.kind === 'hall-clash') acts.push(b('fix-slot', 'Find it a free slot', 'fa-wand-magic-sparkles', 'data-id="' + i.session_id + '"', 'is-primary'));
      acts.push(b('edit-session', 'Open', 'fa-pen', 'data-id="' + i.session_id + '"', i.kind === 'talk-differs' || i.kind === 'hall-clash' ? '' : 'is-primary'));
      if (i.other_id) acts.push(b('edit-session', 'Open the other', 'fa-pen', 'data-id="' + i.other_id + '"'));
      if (i.day) acts.push(b('show-on-board', 'Show on the board', 'fa-calendar-day', 'data-day="' + esc(i.day) + '" data-id="' + i.session_id + '"'));
      if (i.kind === 'talk-no-topic' || i.kind === 'talk-cancelled') acts.push(b('go-talks', 'Innovation Talks', 'fa-microphone-lines'));
    }
    if (i.level !== 'bad') acts.push(b('att-hide', S.attHidden ? 'Show again' : 'Hide', S.attHidden ? 'fa-eye' : 'fa-eye-slash', 'data-key="' + esc(i.key) + '" title="' + (S.attHidden ? 'Put this back on the list' : 'I have seen this: hide it in this browser') + '"'));
    return '<tr data-kind="' + esc(i.kind) + '"><td><span class="lv ' + L[0] + '">' + (i.level === 'info' ? '<i class="fas fa-circle-info"></i>' : '<i class="fas fa-triangle-exclamation"></i>') + L[1] + '</span></td>' +
      '<td>' + esc(i.what) + '</td>' +
      '<td>' + (when ? '<b style="white-space:nowrap">' + esc(when) + '</b>' : '') + (where ? '<br><span class="cm-muted">' + esc(where) + '</span>' : '') + (!when && !where ? '<span class="cm-muted">Whole event</span>' : '') + '</td>' +
      '<td><div class="do">' + acts.join('') + '</div></td></tr>';
  }
  // Brings a session or a free slot into view on the board and lights it up.
  function flashOnBoard() {
    var f = S.flash; S.flash = null;
    var w = $('cm-board-wrap'); if (!w || !f) return;
    var el = null;
    if (f.id) el = w.querySelector('.cm-block[data-id="' + Number(f.id) + '"]');
    else w.querySelectorAll('.cm-free').forEach(function (x) { if (!el && x.getAttribute('data-hall') === f.hall && x.getAttribute('data-start') === f.start) el = x; });
    if (!el) { scrollBoardToNow(); return; }
    var lane = el.closest('.cm-lane');
    w.scrollTop = Math.max(0, el.offsetTop - 70);
    if (lane) w.scrollLeft = Math.max(0, lane.offsetLeft - 90);
    el.classList.add('is-flash');
    try { el.focus({ preventScroll: true }); } catch (e) {}
    setTimeout(function () { el.classList.remove('is-flash'); }, 2600);
  }

  // ---------- moving a session: drag, the keyboard, undo ----------
  async function moveSession(id, v, force, isUndo) {
    var s = sessionById(id); if (!s) return;
    try {
      var r = await api.post('/api/admin/sessions/' + id + '/move', { start_time: v.start_time, end_time: v.end_time, room: v.room, force: !!force });
      var h = hallByName(v.room);
      S.undo = isUndo ? null : { id: id, before: r.before,
        what: 'Moved "' + s.title + '" to ' + clock(v.start_time) + ' to ' + clock(v.end_time) + (v.room ? ', ' + v.room + (h && h.venue_room ? ' · ' + h.venue_room : '') : ', no hall') + '.' + (r.talk_synced ? ' The Innovation Talks list now says the same.' : '') };
      if (isUndo) say('Put back where it was.');
      S.flash = { id: id };
      await load();
    } catch (e) {
      var data = e && e.data;
      if (data && data.clashes && data.clashes.length && !force) {
        if (confirm('That slot clashes with the programme:\n\n' + data.clashes.map(function (c) { return '• ' + c.what; }).join('\n') + '\n\nMove it there anyway?')) return moveSession(id, v, true, isUndo);
        body(); return;
      }
      say(errText(e), 'error'); body();
    }
  }
  function nudge(id, key, size) {
    var s = sessionById(id); if (!s) return;
    var a = mins(s.start_time), b = mins(s.end_time), day = String(s.start_time).slice(0, 10), room = s.room || '';
    if (key === 'ArrowUp' || key === 'ArrowDown') { var d = key === 'ArrowUp' ? -5 : 5; if (size) b += d; else { a += d; b += d; } }
    else {
      var hs = activeHalls().map(function (h) { return h.name || ''; });
      var i = hs.indexOf(room) + (key === 'ArrowLeft' ? -1 : 1);
      if (i < 0 || i >= hs.length) return;
      room = hs[i];
    }
    if (a < 0 || b > 1439 || b - a < 5) return;
    moveSession(id, { start_time: day + ' ' + hhmm(a), end_time: day + ' ' + hhmm(b), room: room });
  }
  function laneAt(x, y) { var el = document.elementFromPoint(x, y); return el && el.closest ? el.closest('.cm-lane') : null; }
  function dragStart(ev, block) {
    if (ev.button !== 0 || ev.pointerType === 'touch' || S.view !== 'board' || S.tab !== 'programme') return;
    var s = sessionById(block.getAttribute('data-id')); if (!s) return;
    var lane = block.closest('.cm-lane'); if (!lane) return;
    var r = block.getBoundingClientRect();
    S.drag = { id: s.id, block: block, lane: lane, home: lane, on: false, x: ev.clientX, y: ev.clientY, grab: ev.clientY - r.top,
      mode: ev.target && ev.target.getAttribute && ev.target.getAttribute('data-rs') ? 'size' : 'move',
      startM: Number(lane.getAttribute('data-start')), len: mins(s.end_time) - mins(s.start_time), from: mins(s.start_time), start: mins(s.start_time), end: mins(s.end_time) };
  }
  function dragMove(ev) {
    var g = S.drag; if (!g) return;
    if (!g.on) {
      if (Math.abs(ev.clientX - g.x) + Math.abs(ev.clientY - g.y) < 5) return;
      g.on = true;
      g.block.classList.add('is-dragging'); document.body.classList.add('cm-dragging');
      g.block.style.left = '4px'; g.block.style.width = 'calc(100% - 8px)';
      g.tip = document.createElement('span'); g.tip.className = 'cm-drag-tip'; g.block.appendChild(g.tip);
      try { window.getSelection().removeAllRanges(); } catch (e) {}
    }
    ev.preventDefault();
    var wrap = $('cm-board-wrap');
    if (wrap) { var wr = wrap.getBoundingClientRect(); if (ev.clientY > wr.bottom - 36) wrap.scrollTop += 14; else if (ev.clientY < wr.top + 90) wrap.scrollTop -= 14; }
    if (g.mode === 'move') {
      var lane = laneAt(ev.clientX, ev.clientY);
      if (lane && lane !== g.lane) { lane.appendChild(g.block); g.lane = lane; }
      var lr = g.lane.getBoundingClientRect();
      var m = Math.round((g.startM + (ev.clientY - lr.top - g.grab) / PX) / 5) * 5;
      m = Math.max(0, Math.min(1439 - g.len, m));
      g.start = m; g.end = m + g.len;
      g.block.style.top = ((m - g.startM) * PX) + 'px';
    } else {
      var br = g.block.getBoundingClientRect();
      var end = Math.round((g.from + (ev.clientY - br.top) / PX) / 5) * 5;
      end = Math.max(g.from + 5, Math.min(1439, end));
      g.start = g.from; g.end = end;
      g.block.style.height = Math.max(18, (end - g.from) * PX - 2) + 'px';
    }
    var hall = g.lane.getAttribute('data-hall') || '', hh = hallByName(hall);
    g.tip.textContent = hm(hhmm(g.start)) + ' to ' + hm(hhmm(g.end)) + (g.mode === 'move' && g.lane !== g.home ? ' · ' + ((hh && hh.short_name) || hall || 'No hall') : '');
  }
  function dragEnd() {
    var g = S.drag; if (!g) return;
    S.drag = null;
    document.body.classList.remove('cm-dragging');
    if (!g.on) return; // a plain click: the click listener opens the session
    S.dragged = Date.now();
    var s = sessionById(g.id); if (!s) { body(); return; }
    var day = String(s.start_time).slice(0, 10);
    var v = { start_time: day + ' ' + hhmm(g.start), end_time: day + ' ' + hhmm(g.end), room: g.mode === 'move' ? (g.lane.getAttribute('data-hall') || '') : (s.room || '') };
    if (v.start_time === s.start_time && v.end_time === s.end_time && v.room === (s.room || '')) { body(); return; }
    moveSession(g.id, v);
  }

  // ---------- find a free slot, place a talk ----------
  async function findSlot() {
    if (!ED) return;
    var v = readSession(), box = $('cm-s-slots'); if (!box) return;
    var day = val('cm-s-day');
    var minutes = v.start_time && v.end_time && v.end_time > v.start_time ? mins(v.end_time) - mins(v.start_time) : 30;
    box.innerHTML = '<div class="cm-help"><i class="fas fa-spinner fa-spin"></i> Looking for a free slot…</div>';
    try {
      var r = await api.post('/api/admin/events/' + eid() + '/conference/suggest', { day: day, minutes: minutes, hall: v.room, speaker_ids: v.speakers.map(function (p) { return p.speaker_id; }), except_id: ED.id });
      if (!ED || !$('cm-s-slots')) return;
      if (!r.slots || !r.slots.length) {
        box.innerHTML = '<div class="cm-err">No hall has ' + esc(span(minutes)) + ' free on ' + esc(dayLabel(day, true)) + ' inside the programme' + (v.speakers.length ? ' while ' + (v.speakers.length === 1 ? 'its speaker is' : 'all its speakers are') + ' free' : '') + '. Try a shorter length or another day.</div>';
        return;
      }
      box.innerHTML = '<div class="cm-slots" id="cm-s-slot-list">' + r.slots.map(function (x) {
        var h = hallByName(x.hall);
        return '<button type="button" class="cm-slotpick" data-cm="use-slot" data-hall="' + esc(x.hall) + '" data-start="' + esc(x.start) + '" data-end="' + esc(x.end) + '"><b>' + esc(hm(x.start)) + ' to ' + esc(hm(x.end)) + '</b><span>' + esc(x.hall) + (h && h.venue_room ? ' · ' + esc(h.venue_room) : '') + '</span><small>free until ' + esc(hm(x.free_until)) + '</small></button>';
      }).join('') + '</div>';
    } catch (e) { box.innerHTML = '<div class="cm-err">' + esc(errText(e)) + '</div>'; }
  }
  // An Innovation Talk from the talks list, given a place: the form opens filled in, and
  // saving it also writes the time and hall on the Innovation Talks list.
  function placeTalk(id) {
    var t = ((S.d.talks && S.d.talks.unplaced) || []).filter(function (x) { return Number(x.id) === Number(id); })[0];
    if (!t) { say('That talk is on the programme already. Reload the page.', 'info'); return; }
    var timed = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(t.starts_at || '');
    S.tab = 'programme'; S.view = 'board';
    openSession(null, { day: timed ? t.starts_at.slice(0, 10) : S.day, start: timed ? t.starts_at.slice(11, 16) : '', duration: t.duration_min || 8, hall: t.hall || expoHall(), type: 'talk',
      title: 'Innovation Talk: ' + (t.company || t.speaker_name), others: t.speaker_name, typedTitle: [t.speaker_title, t.company].filter(Boolean).join(', ') });
    if (!timed) setTimeout(findSlot, 150);
  }
  async function talkSync(id) {
    var s = sessionById(id); if (!s) return;
    try {
      await api.post('/api/admin/sessions/' + id + '/move', { start_time: s.start_time, end_time: s.end_time, room: s.room || '', force: true });
      say('The Innovation Talks list now has the programme’s time and hall.');
      await load();
    } catch (e) { say(errText(e), 'error'); }
  }

  // ---------- another event (Delhi, July 2027) ----------
  async function switchEvent(v) {
    if (v === 'start-delhi') {
      if (!confirm('Start planning Bharat AI Innovation Delhi 2027 (28-29 July 2027, Bharat Mandapam, New Delhi)?\n\nThis opens an empty programme for the team. Attendees see nothing.')) { render(); return; }
      try { await api.post('/api/admin/conference/start-delhi', {}); v = 2; }
      catch (e) { say(errText(e), 'error'); render(); return; }
    }
    S.eid = Number(v) === Number(EID) ? null : Number(v);
    S.d = null; S.day = ''; S.undo = null; S.tab = 'programme'; S.att = 'all'; S.attDay = ''; S.attHidden = false; S.tray = false;
    closeDrawer();
    await load();
  }
  async function copyFrom(src) {
    var from = ((S.d.events || []).filter(function (e) { return Number(e.id) === Number(src); })[0]) || { title: 'the other event' };
    if (!confirm('Copy ' + from.title + '’s programme into ' + words().name + '?\n\nEvery session arrives as a DRAFT with no speakers, on the same day number and at the same time. The halls keep their names until you rename them in the Halls tab.')) return;
    try {
      var r = await api.post('/api/admin/events/' + eid() + '/conference/copy-from/' + Number(src), {});
      say(r.sessions + ' sessions copied as drafts' + (r.halls ? ', with ' + r.halls + ' halls' : '') + (r.skipped ? '. ' + r.skipped + ' did not fit the days.' : '.'));
      await load();
    } catch (e) { say(errText(e), 'error'); }
  }

  // ---------- one listener for everything ----------
  var ACT = {
    // The speaker brief (public/static/speaker-brief.js, another module) opens from here when it is on the page.
    brief: function (el) { if (global.SpeakerBrief && global.SpeakerBrief.open) global.SpeakerBrief.open(Number(el.getAttribute('data-id'))); },
    'brief-list': function () { if (global.SpeakerBrief && global.SpeakerBrief.openList) global.SpeakerBrief.openList(); },
    'dl-pdf-photos': function () { var m = $('cm-dl'); if (m) m.removeAttribute('open'); openSchedule(true); },
    'dl-pdf': function () { var m = $('cm-dl'); if (m) m.removeAttribute('open'); openSchedule(false); },
    'dl-xlsx': function () { var m = $('cm-dl'); if (m) m.removeAttribute('open'); downloadXlsx(); },
    'stat-attention': function () { S.tab = 'attention'; S.att = 'all'; S.attHidden = false; render(); },
    'stat-free': function () { S.tab = 'attention'; S.att = 'free'; S.attHidden = false; render(); },
    'stat-place': function () { S.tab = 'programme'; S.view = 'board'; S.tray = true; render(); },
    att: function (el) { S.att = el.getAttribute('data-k'); body(); },
    'att-day': function (el) { S.attDay = el.getAttribute('data-k') || ''; body(); },
    'att-hidden': function () { S.attHidden = !S.attHidden; body(); },
    'att-hide': function (el) { setHidden(el.getAttribute('data-key'), !S.attHidden); render(); },
    free: function (el) {
      var m = Number(el.getAttribute('data-min')) || 30;
      S.tab = 'programme';
      openSession(null, { day: el.getAttribute('data-day') || S.day, hall: el.getAttribute('data-hall') || '', start: el.getAttribute('data-start') || '', duration: Math.min(30, m) });
    },
    'show-on-board': function (el) {
      S.tab = 'programme'; S.view = 'board'; S.listAll = false; S.day = el.getAttribute('data-day') || S.day;
      S.flash = el.getAttribute('data-id') ? { id: el.getAttribute('data-id') } : { hall: el.getAttribute('data-hall') || '', start: el.getAttribute('data-start') || '' };
      S.showFree = true;
      render();
    },
    'show-day': function (el) { S.tab = 'programme'; S.view = 'board'; S.listAll = false; S.day = el.getAttribute('data-day') || S.day; render(); },
    'fix-slot': function (el) { var s = sessionById(el.getAttribute('data-id')); if (!s) return; openSession(s); setTimeout(findSlot, 150); },
    'find-slot': function () { findSlot(); },
    'use-slot': function (el) {
      var room = $('cm-s-room'), hall = el.getAttribute('data-hall');
      if (room) { if (!Array.prototype.some.call(room.options, function (o) { return o.value === hall; })) { var o = document.createElement('option'); o.value = hall; o.textContent = hall; room.appendChild(o); } room.value = hall; }
      $('cm-s-start').value = el.getAttribute('data-start'); $('cm-s-end').value = el.getAttribute('data-end');
      var all = document.querySelectorAll('#cm-s-slot-list .cm-slotpick'); for (var i = 0; i < all.length; i++) all[i].classList.remove('is-on');
      el.classList.add('is-on');
      liveCheck();
    },
    tray: function () { S.tray = !S.tray; body(); },
    'open-tray': function () { S.tab = 'programme'; S.view = 'board'; S.tray = true; render(); },
    'place-talk': function (el) { placeTalk(el.getAttribute('data-id')); },
    'talk-sync': function (el) { talkSync(el.getAttribute('data-id')); },
    'go-talks': function () { if (typeof switchSection === 'function') switchSection('innovation'); },
    zoom: function (el) { PX = ZOOMS[Number(el.getAttribute('data-k'))] || 2.2; body(); },
    undo: function () { var u = S.undo; if (u) moveSession(u.id, u.before, true, true); },
    'undo-clear': function () { S.undo = null; body(); },
    'copy-from': function (el) { copyFrom(el.getAttribute('data-id')); },
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
    'pick-new': function () { openNewSpeaker(ED ? ED.pickQ.trim() : ''); },
    'new-in-session': function () { openNewSpeaker(''); },
    'save-new-speaker': function () { saveNewSpeaker(); },
    'cancel-new-speaker': function () { var b = $('cm-s-newsp'); if (b) b.innerHTML = ''; },
    'others-to-speakers': function () { othersToSpeakers(); },
    'give-pass': function (el) { givePass(el.getAttribute('data-id')); },
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
    announce: function (el) { if (!live()) { say('Announcements go to the event app, and ' + words().name + ' has no app yet.', 'info'); return; } openAnnounce(el.getAttribute('data-id')); },
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
  // The day as its own coloured label, apart from the time (the team, 12 Nov 2026).
  function dayChip(t) {
    var d = String(t || '').slice(0, 10), i = ((S.d && S.d.days) || []).indexOf(d);
    return '<span class="cm-daychip cm-day-' + (i < 0 ? 0 : (i % 3) + 1) + '"><b>' + (i < 0 ? 'Day' : 'Day ' + (i + 1)) + '</b>' + esc(dayLabel(d)) + '</span>';
  }

  // ---------- a new speaker from inside the session form ----------
  // Their details go on the speakers list (the database), they join this session, and
  // their Speaker pass can be issued in the same step.
  function openNewSpeaker(name) {
    var box = $('cm-s-newsp'); if (!box || !ED) return;
    var pl = $('cm-s-pick-list'); if (pl) pl.innerHTML = '';
    var pick = $('cm-s-pick'); if (pick) pick.value = '';
    ED.pickQ = '';
    box.innerHTML = '<div class="cm-newsp"><b>New speaker</b>' +
      '<div class="cm-row"><div class="cm-f"><label for="cm-n-name">Name</label><input id="cm-n-name" class="cm-in" maxlength="120" value="' + esc(name || '') + '" autocomplete="off"></div>' +
      '<div class="cm-f"><label for="cm-n-role">Designation</label><input id="cm-n-role" class="cm-in" maxlength="200" placeholder="e.g. Chief Technology Officer" autocomplete="off"></div></div>' +
      '<div class="cm-f"><label for="cm-n-org">Organisation</label><input id="cm-n-org" class="cm-in" maxlength="200" autocomplete="off"></div>' +
      '<div class="cm-row"><div class="cm-f"><label for="cm-n-email">Email</label><input id="cm-n-email" type="email" class="cm-in" maxlength="160" placeholder="name@company.com" autocomplete="off"></div>' +
      '<div class="cm-f"><label for="cm-n-phone">Mobile</label><input id="cm-n-phone" type="tel" class="cm-in" maxlength="20" placeholder="98200 12345" autocomplete="off"></div></div>' +
      (live() ? '<label class="cm-toggle" style="margin-bottom:10px"><input type="checkbox" id="cm-n-pass" checked><span><b>Issue their Speaker pass</b><small>Needs their email. A pass they already hold (a paid Delegate, a VIP) is kept.</small></span></label>' : '') +
      '<div id="cm-n-err"></div>' +
      '<button type="button" class="cm-btn is-primary is-small" data-cm="save-new-speaker" id="cm-n-save"><i class="fas fa-user-plus"></i>Add to the speakers list and to this session</button> ' +
      '<button type="button" class="cm-btn is-small" data-cm="cancel-new-speaker">Cancel</button></div>';
    setTimeout(function () { var f = $(name ? 'cm-n-role' : 'cm-n-name'); if (f) f.focus(); }, 30);
  }
  async function refreshSpeakers() {
    var d = await api.get('/api/admin/events/' + eid() + '/conference');
    if (d && Array.isArray(d.speakers)) S.d.speakers = d.speakers;
  }
  async function saveNewSpeaker() {
    var name = val('cm-n-name').trim(), email = val('cm-n-email').trim(), err = $('cm-n-err');
    if (!ED || !err) return;
    if (!name) { err.innerHTML = '<div class="cm-err">Type their name.</div>'; $('cm-n-name').focus(); return; }
    var passBox = $('cm-n-pass'), wantPass = !!(passBox && passBox.checked);
    var btn = $('cm-n-save'); if (btn) btn.disabled = true;
    try {
      var id = 0, already = false;
      try {
        var r = await api.post('/api/admin/speakers', { event_id: eid(), name: name, role: val('cm-n-role').trim(), organisation: val('cm-n-org').trim(), email: email, phone: val('cm-n-phone').trim() });
        id = Number(r.id);
      } catch (e) {
        if (e && e.data && e.data.speaker_id) { id = Number(e.data.speaker_id); already = true; } else throw e;
      }
      var note = already ? name + ' was already on the speakers list, and is now in this session.' : name + ' is on the speakers list and in this session.';
      if (wantPass && email && !already) {
        try { var p = await api.post('/api/admin/speakers/' + id + '/pass', {}); note += p.kept ? ' They keep the ' + p.pass + ' they already hold.' : ' Speaker pass issued.'; }
        catch (e2) { note += ' The pass was not issued: ' + errText(e2); }
      } else if (wantPass && !email && !already) note += ' No pass yet: add their email to issue one.';
      await refreshSpeakers();
      var box = $('cm-s-newsp'); if (box) box.innerHTML = '';
      addPerson(id);
      say(note);
    } catch (e) {
      if (btn) btn.disabled = false;
      err.innerHTML = '<div class="cm-err">' + esc(errText(e)) + '</div>';
    }
  }
  // "Asha Rao (Tata Capital), Vikram Shah (Moderator)" read the way the server reads it.
  function splitTyped(line) {
    var parts = [], depth = 0, cur = '';
    String(line || '').split('').forEach(function (ch) {
      if (ch === '(') depth++;
      if (ch === ')') depth = Math.max(0, depth - 1);
      if (ch === ',' && depth === 0) { if (cur.trim()) parts.push(cur.trim()); cur = ''; return; }
      cur += ch;
    });
    if (cur.trim()) parts.push(cur.trim());
    return parts.map(function (p) {
      var m = p.match(/^(.*?)\s*\(([^()]*)\)\s*$/), name = p, info = '';
      if (m && m[1].trim() && !/^(ias|ifs|ips|irs|phd)$/i.test(m[2].trim())) { name = m[1].trim(); info = m[2].trim(); }
      var low = info.toLowerCase();
      return { raw: p, name: name.trim(), info: info, role: low === 'moderator' ? 'moderator' : (low === 'host' || low === 'chair') ? low : '' };
    });
  }
  // The one text box, turned into speakers: each name joins the speakers list and this
  // session; "(Moderator)" becomes their part, anything else in brackets their organisation.
  async function othersToSpeakers() {
    var box = $('cm-s-others'); if (!box || !ED) return;
    var parts = splitTyped(box.value);
    if (!parts.length) { say('Type the names in the box first, separated by commas.', 'info'); box.focus(); return; }
    if (!confirm('Add ' + (parts.length === 1 ? parts[0].name : 'these ' + parts.length + ' people') + ' to the speakers list and to this session?\n\n' + parts.map(function (p) { return '• ' + p.name + (p.role ? ' (' + p.role + ')' : p.info ? ', ' + p.info : ''); }).join('\n'))) return;
    var type = val('cm-s-type'), made = 0, had = 0, failed = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i], id = 0;
      try { var r = await api.post('/api/admin/speakers', { event_id: eid(), name: p.name, organisation: p.role ? '' : p.info }); id = Number(r.id); made++; }
      catch (e) { if (e && e.data && e.data.speaker_id) { id = Number(e.data.speaker_id); had++; } else failed.push(p.raw); }
      if (id && ED && !ED.people.some(function (x) { return Number(x.speaker_id) === id; })) ED.people.push({ speaker_id: id, role: p.role || (type === 'keynote' ? 'keynote' : type === 'panel' ? 'panellist' : 'speaker') });
    }
    try { await refreshSpeakers(); } catch (e3) {}
    if (!ED) return;
    box.value = failed.join(', ');
    drawPeople(); liveCheck();
    say((made ? made + ' added to the speakers list' : 'Nobody new') + (had ? ', ' + had + ' already on it' : '') + (failed.length ? '. Could not add: ' + failed.join(', ') : '') + '. Save the session to keep them in it.', failed.length ? 'error' : 'success');
  }
  async function givePass(id) {
    var sp = speakerById(id); if (!sp) return;
    try {
      var p = await api.post('/api/admin/speakers/' + id + '/pass', {});
      say(p.kept ? sp.name + ' keeps the ' + p.pass + ' they already hold.' : sp.name + ' now has a Speaker pass.');
      await load();
    } catch (e) { say(errText(e), 'error'); }
  }

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
      var r = await api.post('/api/admin/speakers', { event_id: eid(), name: name });
      var d = await api.get('/api/admin/events/' + eid() + '/conference');
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
      // The click a drag ends with lands on the board: it is not a click on the session.
      // Only that one is dropped, so a quick click on Undo right after still counts.
      var onBoard = { 'edit-session': 1, lane: 1, free: 1 }[el.getAttribute('data-cm')];
      if (onBoard && Date.now() - S.dragged < 400) { ev.preventDefault(); return; }
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
      else if (k === 'event') switchEvent(el.value);
      else if (k === 'show-free') { S.showFree = el.checked; body(); }
      else if (k === 'dim') { S.dim = el.checked; body(); }
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
        else if (ev.key === 'Enter') { ev.preventDefault(); if (ED.pickIdx < n) addPerson(Number(ED.hits[ED.pickIdx].id)); else if (ED.pickQ.trim()) openNewSpeaker(ED.pickQ.trim()); }
        return;
      }
      // Alt + arrows move a session without a mouse; with Shift, up and down change its length.
      if (ev.altKey && /^Arrow/.test(ev.key) && t && t.classList && t.classList.contains('cm-block')) { ev.preventDefault(); nudge(t.getAttribute('data-id'), ev.key, ev.shiftKey); return; }
      if ((ev.key === 'Enter' || ev.key === ' ') && t && t.classList && t.classList.contains('cm-free')) { ev.preventDefault(); ACT.free(t); return; }
      if ((ev.key === 'Enter' || ev.key === ' ') && t && t.classList && t.classList.contains('cm-block')) { ev.preventDefault(); var s = sessionById(t.getAttribute('data-id')); if (s) openSession(s); }
    });
    // Drag with a mouse or a pen. A finger scrolls the board; on a phone, use the form.
    document.addEventListener('pointerdown', function (ev) {
      var b = ev.target.closest && ev.target.closest('.cm-block');
      if (b && b.closest('#section-sessions')) dragStart(ev, b);
    });
    document.addEventListener('pointermove', dragMove);
    document.addEventListener('pointerup', dragEnd);
    document.addEventListener('pointercancel', function () { if (S.drag) { var on = S.drag.on; S.drag = null; document.body.classList.remove('cm-dragging'); if (on) body(); } });
  }

  // The underscored ones are for the tests: the builders, called without a click.
  global.ConfDesk = { load: load, data: function () { return S.d; }, eventId: eid, _state: S, _scheduleHtml: scheduleHtml, _programmeSheets: programmeSheets, _xlsxBytes: xlsxBytes, _peopleOf: peopleOf };
})(window);
