/* Speaker briefs (12 Nov 2026): Admin -> Conference -> "Speaker briefs" (the list)
 * and "Brief" on a speaker's card (one speaker).
 *
 * One email per speaker with their sessions, their panel (moderator and the other
 * panellists, names and organisations only), add-to-calendar links and a button to
 * their pass. Preview any one before it goes; send one, or tick several and send them
 * in turn. The list says who is ready, who has no email or no session, who was sent
 * one, and whose details changed after it went ("Send update"). Ministers are not
 * emailed from the list: copy their details for WhatsApp to their office instead.
 *
 * The server side is src/routes/speaker-brief.ts. Uses the admin page's globals api
 * and toast, and ConfDesk (conference-admin.js) for the event and to refresh it.
 * Buttons carry data-sb="<action>"; one delegated listener runs them, so no name is
 * ever written into an onclick string. */
(function (global) {
  'use strict';

  var V = '20261116c';
  var S = { d: null, filter: 'todo', sel: {}, busy: false, one: null, pv: 0, timer: null, noteSaved: '', lastFocus: null, wired: false, usual: { subject: '', greeting: '', opening: '' }, noteAtOpen: '', contact: null, ccSaved: '', fromSaved: '', senders: null, outside: [] };
  var STATUS = {
    ready: { word: 'Not sent yet', cls: 'is-ready' },
    changed: { word: 'Changed since sent', cls: 'is-changed' },
    sent: { word: 'Sent', cls: 'is-sent' },
    'no-email': { word: 'No email address', cls: 'is-muted' },
    'no-session': { word: 'No session yet', cls: 'is-muted' },
    protocol: { word: 'Minister: through their office', cls: 'is-protocol' }
  };
  var FILTERS = [
    ['todo', 'To send', function (s) { return s.status === 'ready' || s.status === 'changed'; }],
    ['changed', 'Changed', function (s) { return s.status === 'changed'; }],
    ['sent', 'Sent', function (s) { return s.status === 'sent'; }],
    ['no-email', 'No email', function (s) { return s.status === 'no-email'; }],
    ['protocol', 'Ministers', function (s) { return s.status === 'protocol'; }],
    ['no-session', 'No session', function (s) { return s.status === 'no-session'; }],
    ['all', 'Everyone', function () { return true; }]
  ];
  var ROLE = { keynote: 'Keynote', speaker: 'Speaker', panellist: 'Panellist', moderator: 'Moderator', host: 'Host', chair: 'Chair' };
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // ---------- small helpers ----------
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function $(id) { return document.getElementById(id); }
  function say(msg, kind) { if (typeof toast === 'function') toast(esc(msg), kind || 'success'); }
  function errText(e) { return (e && e.message && e.message !== 'unauthorized') ? e.message : 'That did not work. Try again.'; }
  function eid() {
    try { if (global.ConfDesk && typeof global.ConfDesk.eventId === 'function' && global.ConfDesk.eventId()) return global.ConfDesk.eventId(); } catch (e) { /* fall through */ }
    return (typeof EID !== 'undefined' && EID) ? EID : 1;
  }
  function day(t) { var x = new Date(String(t).slice(0, 10) + 'T00:00:00Z'); return isNaN(x.getTime()) ? '' : DAYS[x.getUTCDay()] + ' ' + x.getUTCDate() + ' ' + MON[x.getUTCMonth()]; }
  function clock(t) { var hm = String(t || '').slice(11, 16).split(':'); var h = parseInt(hm[0], 10); return isNaN(h) ? '' : (h % 12 || 12) + ':' + (hm[1] || '00') + (h < 12 ? ' am' : ' pm'); }
  function stamp(t) { // admin_audit keeps UTC; show IST
    var d = new Date(String(t || '').replace(' ', 'T') + 'Z'); if (isNaN(d.getTime())) return '';
    var x = new Date(d.getTime() + 330 * 60000);
    return x.getUTCDate() + ' ' + MON[x.getUTCMonth()] + ', ' + ((x.getUTCHours() % 12) || 12) + ':' + String(x.getUTCMinutes()).padStart(2, '0') + (x.getUTCHours() < 12 ? ' am' : ' pm');
  }
  function hall(s) { return s.venue_room && s.venue_room !== s.room ? s.room + ' · ' + s.venue_room : (s.room || 'Hall to be confirmed'); }
  function initial(name) { var n = String(name || '').replace(/^(hon[’']?ble|shri\.?|smt\.?|dr\.?|mr\.?|ms\.?|mrs\.?|prof\.?)\s+/gi, ''); return (n.trim().charAt(0) || '?').toUpperCase(); }
  function ava(sp) {
    var u = sp && sp.photo_url;
    if (u && /^(\/|https:\/\/)/.test(u)) return '<img class="sb-ava" src="' + esc(u) + '" alt="" loading="lazy">';
    return '<span class="sb-ava" aria-hidden="true">' + esc(initial(sp && sp.name)) + '</span>';
  }
  function byId(id) { var l = (S.d && S.d.speakers) || []; for (var i = 0; i < l.length; i++) if (l[i].id === Number(id)) return l[i]; return null; }
  function sendable(s) { return s.status === 'ready' || s.status === 'changed'; }
  // "Send from": the event's address (value '') or one of the organising team on our
  // domain (GET /api/admin/events/:id/senders). An address saved earlier that is no
  // longer on the list stays visible, marked, so the organiser sees why a send fails.
  function fromOptions(cur) {
    var seen = false;
    var html = (S.senders || []).map(function (s) {
      var v = s.default ? '' : s.email; if (v === cur) seen = true;
      var label = s.default ? 'The event’s address (' + s.email + ')' : (s.person || s.name) + ' (' + s.email + ')';
      return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(label) + '</option>';
    }).join('');
    if (cur && !seen) html += '<option value="' + esc(cur) + '" selected>' + esc(cur) + ' (not on the team list now)</option>';
    return html;
  }
  function fromField(id, cur, kind, o) {
    o = o || {};
    var out = o.outside && S.outside && S.outside.length
      ? ' <span class="sb-help">Not on the list: ' + S.outside.map(function (x) { return esc(x.name) + ' (' + esc(String(x.reason || '').replace(/\.$/, '')) + ')'; }).join('; ') + '.</span>' : '';
    if ((S.senders || []).length < 2 && !cur) return '<span class="sb-help">The event’s address.</span>' + out;
    return '<select id="' + id + '" class="sb-in' + (o.inline ? ' is-inline' : '') + '" data-sb-input="' + kind + '"' + (o.disabled ? ' disabled' : '') + '>' + fromOptions(cur) + '</select>' + out;
  }
  async function loadSenders() {
    if (S.senders !== null) return;
    try { var sd = await api.get('/api/admin/events/' + eid() + '/senders'); S.senders = (sd && sd.senders) || []; S.outside = (sd && sd.outside) || []; }
    catch (e) { S.senders = []; S.outside = []; } // briefs still go, from the event's address
  }
  function fromWord(v) {
    if (!v) return 'the event’s address';
    var l = S.senders || []; for (var i = 0; i < l.length; i++) if (l[i].email === v) return (l[i].person || l[i].name) + ' (' + v + ')';
    return v;
  }
  function ensureCss() {
    if ($('sb-css')) return;
    var l = document.createElement('link'); l.id = 'sb-css'; l.rel = 'stylesheet'; l.href = '/static/speaker-brief.css?v=' + V;
    document.head.appendChild(l);
  }

  // ---------- the layer (list drawer + one-speaker sheet) ----------
  function layer() {
    var r = $('sb-root');
    if (!r) {
      r = document.createElement('div');
      r.id = 'sb-root'; r.className = 'sb-root';
      r.innerHTML = '<div class="sb-scrim" data-sb="close-all"></div>' +
        '<section id="sb-list" class="sb-drawer" role="dialog" aria-modal="true" aria-labelledby="sb-title" hidden></section>' +
        '<section id="sb-one" class="sb-sheet" role="dialog" aria-modal="true" aria-labelledby="sb-one-title" hidden></section>';
      document.body.appendChild(r);
      wire(r);
    }
    return r;
  }
  function show(which) {
    var r = layer();
    S.lastFocus = S.lastFocus || document.activeElement;
    r.classList.add('is-open');
    document.body.classList.add('sb-lock');
    $(which).hidden = false;
  }
  function hideOne(sent) {
    if (!sent && !leaveOk()) return;
    var o = $('sb-one'); if (o) { o.hidden = true; o.innerHTML = ''; } S.one = null; if ($('sb-list').hidden) closeAll(); else focusIn($('sb-list'));
  }
  function closeAll() {
    var r = $('sb-root'); if (!r) return;
    if (!$('sb-one').hidden && !leaveOk()) return;
    if (S.busy && !confirm('Briefs are still being sent. Stop after the one going now?')) return;
    S.busy = false;
    r.classList.remove('is-open'); document.body.classList.remove('sb-lock');
    $('sb-list').hidden = true; $('sb-one').hidden = true; $('sb-one').innerHTML = ''; S.one = null;
    if (S.lastFocus && S.lastFocus.focus) { try { S.lastFocus.focus(); } catch (e) { /* gone */ } }
    S.lastFocus = null;
  }
  function focusIn(el) { if (!el) return; var f = el.querySelector('[data-sb-first]') || el.querySelector('button, textarea, input, a[href]'); if (f) f.focus(); }

  // ---------- the list ----------
  async function openList() {
    ensureCss(); show('sb-list');
    S.filter = 'todo'; // a fresh look starts with what still needs sending
    var box = $('sb-list');
    box.innerHTML = head('Speaker briefs', 'sb-title') + '<div class="sb-body"><p class="sb-help"><i class="fas fa-spinner fa-spin"></i> Loading the speakers…</p></div>';
    focusIn(box);
    await load();
    if (!box.hidden && !(S.one && !$('sb-one').hidden)) focusIn(box);
  }
  async function load() {
    try {
      S.d = await api.get('/api/admin/events/' + eid() + '/speaker-briefs');
      if (S.d && S.d.error) throw new Error(S.d.error);
      S.noteSaved = S.d.note || ''; S.ccSaved = S.d.cc || ''; S.fromSaved = S.d.from || '';
      await loadSenders();
      var keep = {}; Object.keys(S.sel).forEach(function (k) { var s = byId(k); if (s && sendable(s)) keep[k] = 1; }); S.sel = keep;
      if (!$('sb-list').hidden) drawList();
    } catch (e) {
      var b = $('sb-list'); if (b && !b.hidden) b.innerHTML = head('Speaker briefs', 'sb-title') + '<div class="sb-body"><div class="sb-err">' + esc(errText(e)) + '</div></div>';
    }
  }
  function head(title, id, sub) {
    return '<header class="sb-head"><div><h2 id="' + id + '" class="sb-h">' + esc(title) + '</h2>' + (sub ? '<p class="sb-sub">' + sub + '</p>' : '') + '</div>' +
      '<button type="button" class="sb-x" data-sb="' + (id === 'sb-title' ? 'close-all' : 'close-one') + '" aria-label="Close"><i class="fas fa-xmark"></i></button></header>';
  }
  function drawList() {
    var box = $('sb-list'); if (!box || !S.d) return;
    var list = S.d.speakers || [];
    var counts = {}; FILTERS.forEach(function (f) { counts[f[0]] = list.filter(f[2]).length; });
    if (!counts[S.filter] && S.filter !== 'all') S.filter = counts.todo ? 'todo' : 'all';
    var f = FILTERS.filter(function (x) { return x[0] === S.filter; })[0] || FILTERS[0];
    var shown = list.filter(f[2]);
    var nSel = Object.keys(S.sel).length;
    var noteDirty = ($('sb-note') ? $('sb-note').value : S.noteSaved) !== S.noteSaved;
    var noteVal = $('sb-note') ? $('sb-note').value : S.noteSaved;
    var ccVal = $('sb-cc') ? $('sb-cc').value : S.ccSaved; noteDirty = noteDirty || ccVal !== S.ccSaved;
    var fromVal = $('sb-from') ? $('sb-from').value : S.fromSaved; noteDirty = noteDirty || fromVal !== S.fromSaved;
    box.innerHTML = head('Speaker briefs', 'sb-title', 'One email per speaker: their session, their panel and their pass. Preview any one before it goes.') +
      '<div class="sb-body">' +
      '<div class="sb-card">' +
        '<label for="sb-note" class="sb-lbl">What every speaker should know</label>' +
        '<p class="sb-help">Goes at the end of every brief. For example: what time to arrive, where the speaker lounge is, slides (format and by when), a contact number on the day.</p>' +
        '<textarea id="sb-note" class="sb-in" rows="3" maxlength="1500" data-sb-input="note" data-sb-first placeholder="Please reach the hall 30 minutes before your session.">' + esc(noteVal) + '</textarea>' +
        '<label for="sb-cc" class="sb-lbl">Copy every brief to (CC)</label>' +
        '<p class="sb-help">A colleague who should see each brief, or a speaker’s office. Up to 5 addresses, with commas. The sheet for one speaker can change it for that email.</p>' +
        '<input id="sb-cc" class="sb-in" type="text" maxlength="400" data-sb-input="note" placeholder="colleague@bharataiinnovation.com, office@example.com" value="' + esc(ccVal) + '">' +
        '<label for="sb-from" class="sb-lbl">Send from</label>' +
        '<p class="sb-help">Who the speaker sees the brief from; their reply goes to that address. A brief sent as a team member is also copied to the event’s address. The sheet for one speaker can change it for that email.</p>' +
        fromField('sb-from', fromVal, 'note', { outside: true }) +
        '<div class="sb-row"><button type="button" class="sb-btn" data-sb="save-note"' + (noteDirty ? '' : ' disabled') + ' id="sb-note-save"><i class="fas fa-floppy-disk"></i>Save for every brief</button>' +
        '<span class="sb-help" id="sb-note-state">' + (noteDirty ? 'Not saved yet.' : (S.noteSaved ? 'Saved.' : 'Nothing saved yet: briefs go without it.')) + '</span></div>' +
      '</div>' +
      '<div class="sb-chips" role="tablist" aria-label="Show">' + FILTERS.map(function (x) {
        return '<button type="button" role="tab" aria-selected="' + (x[0] === S.filter) + '" class="sb-chip' + (x[0] === S.filter ? ' is-on' : '') + '" data-sb="filter" data-f="' + x[0] + '">' + esc(x[1]) + ' <b>' + counts[x[0]] + '</b></button>';
      }).join('') + '</div>' +
      '<div class="sb-bulk">' +
        '<button type="button" class="sb-btn is-small" data-sb="select-todo"' + (counts.todo ? '' : ' disabled') + '>Tick all to send (' + counts.todo + ')</button>' +
        (nSel ? '<button type="button" class="sb-btn is-small" data-sb="select-none">Clear ticks</button>' : '') +
        '<span class="sb-grow"></span>' +
        '<button type="button" class="sb-btn is-primary" data-sb="send-many" id="sb-send-many"' + (nSel && !S.busy ? '' : ' disabled') + '><i class="fas fa-paper-plane"></i>' + (nSel ? 'Send ' + nSel + ' brief' + (nSel === 1 ? '' : 's') : 'Tick speakers to send') + '</button>' +
      '</div>' +
      '<div id="sb-progress" aria-live="polite"></div>' +
      (shown.length ? '<ul class="sb-list">' + shown.map(rowHTML).join('') + '</ul>' : '<p class="sb-help sb-empty">Nobody here.</p>') +
      '</div>';
  }
  function rowHTML(sp) {
    var st = STATUS[sp.status] || STATUS.ready;
    var when = sp.status === 'sent' && sp.last ? ' ' + esc(stamp(sp.last.at)) : '';
    var pass = sp.pass ? '<span class="sb-tag">' + esc(String(sp.pass.badge_type || 'Pass').replace(/\s*pass$/i, '')) + ' pass</span>'
      : (sp.email ? '<span class="sb-tag is-soft">Pass made when sent</span>' : '');
    var slots = (sp.slots || []).map(function (s) {
      return '<li>' + esc(day(s.start_time) + ', ' + clock(s.start_time) + ' · ' + hall(s) + ' · ' + (ROLE[s.my_role] || 'Speaker')) + '<br><span class="sb-t">' + esc(s.title) + '</span></li>';
    }).join('');
    var box = sendable(sp)
      ? '<input type="checkbox" class="sb-check" data-sb-check="' + sp.id + '" aria-label="Tick ' + esc(sp.name) + '"' + (S.sel[sp.id] ? ' checked' : '') + (S.busy ? ' disabled' : '') + '>'
      : '<span class="sb-check is-none" aria-hidden="true"></span>';
    return '<li class="sb-item' + (S.sel[sp.id] ? ' is-sel' : '') + '">' + box + ava(sp) +
      '<div class="sb-who"><div class="sb-name">' + esc(sp.name) + '</div>' +
        '<div class="sb-org">' + esc([sp.role, sp.organisation].filter(Boolean).join(', ')) + '</div>' +
        contactHTML(sp) +
        (slots ? '<ul class="sb-slots">' + slots + '</ul>' : '') +
        '<div class="sb-tags"><span class="sb-status ' + st.cls + '">' + esc(st.word) + when + '</span>' + pass +
          (sp.status === 'changed' && sp.last ? '<span class="sb-help">Last sent ' + esc(stamp(sp.last.at)) + '</span>' : '') + '</div>' +
      '</div>' +
      '<div class="sb-acts">' +
        '<button type="button" class="sb-btn is-small" data-sb="open" data-id="' + sp.id + '"' + (sp.slots.length ? '' : ' disabled title="Give them a session first"') + '><i class="fas fa-eye"></i>Preview</button>' +
        '<button type="button" class="sb-btn is-small" data-sb="copy" data-id="' + sp.id + '"' + (sp.slots.length ? '' : ' disabled') + '><i class="fas fa-clipboard-list"></i>Copy for WhatsApp</button>' +
      '</div></li>';
  }

  // The address the brief goes to, and a form to add or change it and the mobile (it
  // goes on their pass). Registrations under the same name are offered, never assumed.
  function contactHTML(sp) {
    var open = S.contact === sp.id;
    var line = '<div class="sb-org sb-contact-line">' + (sp.email ? esc(sp.email) + (sp.phone ? ' · ' + esc(sp.phone) : '') : '<b class="sb-bad">No email address</b>') +
      ' <button type="button" class="sb-link" data-sb="contact" data-id="' + sp.id + '">' + (sp.email ? 'Change' : 'Add email &amp; mobile') + '</button></div>';
    if (!open) return line;
    var found = (sp.found || []).map(function (f) {
      return '<div class="sb-found">Registered as <b>' + esc(f.email) + '</b>' + (f.mobile ? ' · ' + esc(f.mobile) : '') + (f.company || f.job_title ? ' · ' + esc([f.job_title, f.company].filter(Boolean).join(', ')) : '') +
        ' <button type="button" class="sb-btn is-small" data-sb="use-found" data-id="' + sp.id + '" data-email="' + esc(f.email) + '" data-mobile="' + esc(f.mobile) + '">Use this</button></div>';
    }).join('');
    return line + '<div class="sb-card sb-contact" id="sb-contact-' + sp.id + '">' + found +
      '<div class="sb-row"><input id="sb-ct-email-' + sp.id + '" class="sb-in" type="email" maxlength="200" placeholder="Email address" value="' + esc(sp.email || '') + '" data-sb-first>' +
      '<input id="sb-ct-mobile-' + sp.id + '" class="sb-in" type="tel" maxlength="30" placeholder="Mobile (for their pass)" value="' + esc(sp.phone || '') + '"></div>' +
      '<div class="sb-row"><button type="button" class="sb-btn is-small is-primary" data-sb="contact-save" data-id="' + sp.id + '"><i class="fas fa-floppy-disk"></i>Save</button>' +
      '<button type="button" class="sb-btn is-small" data-sb="contact-cancel">Cancel</button><span class="sb-help" id="sb-ct-state-' + sp.id + '"></span></div></div>';
  }
  // Saves the email and mobile on the speaker's record (the PUT the Speakers page uses),
  // then redraws: the row becomes "Not sent yet" and the sheet gets its To.
  async function saveContact(id, emailEl, mobileEl, stateEl, inSheet) {
    var email = emailEl ? emailEl.value.trim() : '', mobile = mobileEl ? mobileEl.value.trim() : '';
    if (!email && !mobile) { if (stateEl) stateEl.textContent = 'Type an email address.'; return; }
    var body = {}; if (email) body.email = email; if (mobile) body.phone = mobile;
    if (stateEl) stateEl.textContent = 'Saving…';
    try {
      var r = await api.put('/api/admin/speakers/' + id, body);
      if (r && r.error) throw new Error(r.error);
      S.contact = null;
      say('Saved.');
      await load();
      if (inSheet && S.one === Number(id)) open(id);
      refreshDesk();
    } catch (e) { if (stateEl) stateEl.textContent = errText(e); else say(errText(e), 'error'); }
  }

  // ---------- one speaker ----------
  async function open(id) {
    ensureCss(); show('sb-one');
    S.one = Number(id);
    var box = $('sb-one');
    box.innerHTML = head('Speaker brief', 'sb-one-title') + '<div class="sb-body"><p class="sb-help"><i class="fas fa-spinner fa-spin"></i> Making the preview…</p></div>';
    focusIn(box);
    try {
      var both = await Promise.all([api.post('/api/admin/speakers/' + id + '/brief', { preview: true }), loadSenders()]);
      var r = both[0];
      if (S.one !== Number(id)) return;
      drawOne(id, r);
    } catch (e) {
      box.innerHTML = head('Speaker brief', 'sb-one-title') + '<div class="sb-body"><div class="sb-err">' + esc(errText(e)) + '</div>' +
        '<button type="button" class="sb-btn" data-sb="close-one">Close</button></div>';
    }
  }
  function drawOne(id, r) {
    var box = $('sb-one'); if (!box) return;
    S.usual = r.usual || { subject: r.subject || '', greeting: '', opening: '' };
    S.noteAtOpen = r.note || '';
    var st = STATUS[r.status] || STATUS.ready;
    var passLine = !r.to ? '' : r.pass && r.pass.badge_type
      ? (r.pass.will_change ? 'Their free Visitor Pass becomes a Speaker pass when this goes.' : 'They have a ' + esc(String(r.pass.badge_type).replace(/\s*pass$/i, '')) + ' pass; the button opens it.')
      : 'A Speaker pass is made for this address when this goes; the button opens it.';
    var label = r.protocol ? 'Send anyway' : r.update ? 'Send update' : r.status === 'sent' ? 'Send again' : 'Send brief';
    box.innerHTML = head('Brief for ' + (r.name || 'this speaker'), 'sb-one-title') +
      '<div class="sb-body">' +
      '<div class="sb-meta">' +
        '<div><span class="sb-k">To</span> ' + (r.to ? esc(r.to) : '<b class="sb-bad">No email address yet.</b> Add it below, or copy the details for WhatsApp.') +
          ' <button type="button" class="sb-link" data-sb="one-contact">' + (r.to ? 'Change' : 'Add email &amp; mobile') + '</button></div>' +
        '<div class="sb-card sb-contact" id="sb-one-contact"' + (r.to ? ' hidden' : '') + '>' +
          '<div class="sb-row"><input id="sb-one-ct-email" class="sb-in" type="email" maxlength="200" placeholder="Email address" value="' + esc(r.to || '') + '">' +
          '<input id="sb-one-ct-mobile" class="sb-in" type="tel" maxlength="30" placeholder="Mobile (for their pass)" value="' + esc((byId(id) || {}).phone || '') + '"></div>' +
          '<div class="sb-row"><button type="button" class="sb-btn is-small is-primary" data-sb="one-contact-save" data-id="' + id + '"><i class="fas fa-floppy-disk"></i>Save</button><span class="sb-help" id="sb-one-ct-state"></span></div></div>' +
        '<div><span class="sb-k">From</span> ' + fromField('sb-one-from', r.from || '', 'one-from', { inline: true, disabled: !r.to }) +
          (r.from_error ? ' <b class="sb-bad">' + esc(r.from_error) + '</b>' : '') + '</div>' +
        '<div><span class="sb-k">CC</span> <input id="sb-one-cc" class="sb-in is-inline" type="text" maxlength="400" placeholder="Copy to: assistant@example.com, colleague@…" value="' + esc(r.cc || '') + '"' + (r.to ? '' : ' disabled') + '> <span class="sb-help">Up to 5, with commas.</span></div>' +
        '<div><span class="sb-k">Status</span> <span class="sb-status ' + st.cls + '">' + esc(st.word) + (r.last && r.last.at ? ' ' + esc(stamp(r.last.at)) : '') + '</span>' +
          (r.update ? ' <span class="sb-help">The subject starts with “Updated:”.</span>' : '') + '</div>' +
        (passLine ? '<div><span class="sb-k">Pass</span> ' + passLine + '</div>' : '') +
        (r.protocol ? '<div class="sb-warn"><i class="fas fa-triangle-exclamation"></i> A minister: their office usually handles this. Copy the details for WhatsApp, or send anyway.</div>' : '') +
      '</div>' +
      '<div id="sb-one-err"></div>' +
      '<div class="sb-card sb-words">' +
        '<div class="sb-row sb-words-head"><h3 class="sb-lbl">Edit the email</h3>' +
          '<button type="button" class="sb-btn is-small" data-sb="reset-words" id="sb-one-reset" hidden><i class="fas fa-rotate-left"></i>Put back the usual words</button></div>' +
        '<p class="sb-help">Change the words for this one email; the preview below follows as you type. Their session, hall, panel, calendar links and pass button are always filled in from the programme. Leave a box empty to use the usual words.</p>' +
        '<label for="sb-one-subj" class="sb-lbl">Subject</label>' +
        '<input id="sb-one-subj" class="sb-in" type="text" maxlength="200" data-sb-input="one-edit" data-id="' + id + '" value="' + esc(S.usual.subject) + '">' +
        '<label for="sb-one-greet" class="sb-lbl">Greeting</label>' +
        '<input id="sb-one-greet" class="sb-in" type="text" maxlength="120" data-sb-input="one-edit" data-id="' + id + '" value="' + esc(S.usual.greeting) + '">' +
        '<label for="sb-one-open" class="sb-lbl">Opening words</label>' +
        '<textarea id="sb-one-open" class="sb-in" rows="3" maxlength="1500" data-sb-input="one-edit" data-id="' + id + '">' + esc(S.usual.opening) + '</textarea>' +
        '<label for="sb-one-note" class="sb-lbl">Note at the end <span class="sb-help">(the saved note for every brief is filled in; a change here is for this email only)</span></label>' +
        '<textarea id="sb-one-note" class="sb-in" rows="3" maxlength="1500" data-sb-input="one-edit" data-id="' + id + '">' + esc(r.note || '') + '</textarea>' +
      '</div>' +
      '<p class="sb-lbl">Preview</p>' +
      '<iframe id="sb-one-preview" class="sb-preview" title="Email preview" sandbox=""></iframe>' +
      '<div class="sb-row sb-foot">' +
        '<button type="button" class="sb-btn is-primary" data-sb="send-one" data-id="' + id + '" id="sb-one-send"' + (r.to ? '' : ' disabled') + ' data-sb-first><i class="fas fa-paper-plane"></i>' + label + '</button>' +
        '<button type="button" class="sb-btn" data-sb="copy" data-id="' + id + '"><i class="fas fa-clipboard-list"></i>Copy for WhatsApp</button>' +
        '<button type="button" class="sb-btn" data-sb="close-one">Close</button>' +
      '</div></div>';
    box.dataset.protocol = r.protocol ? '1' : '';
    box.dataset.update = r.update ? '1' : '';
    var f = $('sb-one-preview'); if (f) f.srcdoc = r.html;
    focusIn(box);
  }
  // The organiser's words for this one email. A box still holding the usual words is
  // left out, so the server fills in fresh ones (a hall that moved meanwhile shows).
  var WORD_BOXES = [['subject', 'sb-one-subj'], ['greeting', 'sb-one-greet'], ['opening', 'sb-one-open']];
  function wordsOf() {
    var out = { note: $('sb-one-note') ? $('sb-one-note').value : '' };
    WORD_BOXES.forEach(function (w) { var el = $(w[1]); if (el && el.value.trim() !== String(S.usual[w[0]] || '').trim()) out[w[0]] = el.value; });
    return out;
  }
  function wordsChanged() {
    if (!$('sb-one-subj')) return false;
    var w = wordsOf(); return !!(w.subject !== undefined || w.greeting !== undefined || w.opening !== undefined || w.note.trim() !== S.noteAtOpen.trim());
  }
  function wordsState() { var b = $('sb-one-reset'); if (b) b.hidden = !wordsChanged(); }
  function resetWords(id) {
    WORD_BOXES.forEach(function (w) { var el = $(w[1]); if (el) el.value = S.usual[w[0]] || ''; });
    var n = $('sb-one-note'); if (n) n.value = S.noteAtOpen;
    wordsState(); repreview(id);
    var s = $('sb-one-subj'); if (s) s.focus();
  }
  function leaveOk() { return !wordsChanged() || confirm('Close this email? Your changes to its words will be lost.'); }
  async function repreview(id) {
    var my = ++S.pv;
    try {
      var body = wordsOf(); body.preview = true;
      var r = await api.post('/api/admin/speakers/' + id + '/brief', body);
      if (my !== S.pv || S.one !== Number(id)) return;
      var f = $('sb-one-preview'); if (f) f.srcdoc = r.html;
      var er = $('sb-one-err'); if (er) er.innerHTML = '';
    } catch (e) { var er2 = $('sb-one-err'); if (er2) er2.innerHTML = '<div class="sb-err">' + esc(errText(e)) + '</div>'; }
  }
  async function sendOne(id) {
    var box = $('sb-one'); var protocol = box && box.dataset.protocol === '1';
    var sp = byId(id);
    var name = sp ? sp.name : 'this speaker';
    var frEl = $('sb-one-from');
    if (!confirm((protocol ? 'This is a minister. ' : '') + 'Send this email to ' + name + ' now, from ' + fromWord(frEl ? frEl.value : '') + '?')) return;
    var btn = $('sb-one-send'); if (btn) btn.disabled = true;
    try {
      var body = wordsOf(); body.anyway = protocol;
      var ccEl = $('sb-one-cc'); if (ccEl) body.cc = ccEl.value;
      if (frEl) body.from = frEl.value;
      var r = await api.post('/api/admin/speakers/' + id + '/brief', body);
      say((r.kind === 'update' ? 'Update sent to ' : 'Brief sent to ') + r.to + (r.from ? ' from ' + r.from : '') + (r.cc && r.cc.length ? ', copied to ' + r.cc.join(', ') : '') + '.');
      hideOne(true);
      if (S.d) await load();
      refreshDesk();
    } catch (e) { if (btn) btn.disabled = false; var er = $('sb-one-err'); if (er) er.innerHTML = '<div class="sb-err">' + esc(errText(e)) + '</div>'; }
  }

  // ---------- many ----------
  async function sendMany() {
    var ids = Object.keys(S.sel).map(Number).filter(function (id) { var s = byId(id); return s && sendable(s); });
    if (!ids.length) return;
    var n = ids.length;
    var note = $('sb-note') ? $('sb-note').value : S.noteSaved;
    var ccNow = $('sb-cc') ? $('sb-cc').value : S.ccSaved;
    var fromNow = $('sb-from') ? $('sb-from').value : S.fromSaved;
    if (note !== S.noteSaved || ccNow !== S.ccSaved || fromNow !== S.fromSaved) {
      if (!confirm('Your note, CC or Send from has changes that are not saved. Save them and use them in these briefs?')) return;
      if (!(await saveNote())) return;
    }
    if (!confirm('Send the speaker brief to ' + n + ' speaker' + (n === 1 ? '' : 's') + ' now? Each gets their own email from ' + fromWord(S.fromSaved) + '.')) return;
    S.busy = true; drawList();
    var ok = 0, bad = [];
    for (var i = 0; i < ids.length; i++) {
      if (!S.busy) break;
      var sp = byId(ids[i]);
      progress('Sending ' + (i + 1) + ' of ' + n + ': ' + (sp ? sp.name : ''));
      try { await api.post('/api/admin/speakers/' + ids[i] + '/brief', {}); ok++; delete S.sel[ids[i]]; }
      catch (e) { bad.push((sp ? sp.name : '#' + ids[i]) + ': ' + errText(e)); }
      await new Promise(function (res) { setTimeout(res, 350); });
    }
    var stopped = !S.busy;
    S.busy = false;
    await load();
    progress((stopped ? 'Stopped. ' : '') + 'Sent ' + ok + ' of ' + n + '.', bad);
    refreshDesk();
    if (ok) say('Sent ' + ok + ' brief' + (ok === 1 ? '' : 's') + '.');
  }
  function progress(text, bad) {
    var p = $('sb-progress'); if (!p) return;
    p.innerHTML = '<div class="sb-progress">' + esc(text) +
      (bad && bad.length ? '<div class="sb-err">' + bad.length + ' did not go:<ul>' + bad.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul></div>' : '') + '</div>';
  }
  async function saveNote() {
    var el = $('sb-note'); if (!el) return false;
    try {
      var cc = $('sb-cc'), fr = $('sb-from');
      var r = await api.put('/api/admin/speaker-briefs/note', { note: el.value, cc: cc ? cc.value : S.ccSaved, from: fr ? fr.value : S.fromSaved });
      if (r && r.error) throw new Error(r.error);
      S.noteSaved = r.note || ''; S.ccSaved = r.cc || ''; S.fromSaved = r.from || '';
      if (S.d) { S.d.note = S.noteSaved; S.d.cc = S.ccSaved; S.d.from = S.fromSaved; }
      el.value = S.noteSaved; if (cc) cc.value = S.ccSaved; if (fr) fr.value = S.fromSaved;
      noteState();
      say('Saved. Every brief now carries it.');
      return true;
    } catch (e) { say(errText(e), 'error'); return false; }
  }
  function noteState() {
    var el = $('sb-note'), b = $('sb-note-save'), s = $('sb-note-state'); if (!el) return;
    var cc = $('sb-cc'), fr = $('sb-from');
    var dirty = el.value !== S.noteSaved || (!!cc && cc.value !== S.ccSaved) || (!!fr && fr.value !== S.fromSaved);
    if (b) b.disabled = !dirty;
    if (s) s.textContent = dirty ? 'Not saved yet.' : (S.noteSaved ? 'Saved.' : 'Nothing saved yet: briefs go without it.');
  }

  // ---------- copy for WhatsApp ----------
  async function copyFor(id) {
    try {
      var note = (S.one === Number(id) && $('sb-one-note')) ? $('sb-one-note').value : undefined;
      var body = { preview: true }; if (note !== undefined) body.note = note;
      var r = await api.post('/api/admin/speakers/' + id + '/brief', body);
      copyText(r.text);
    } catch (e) { say(errText(e), 'error'); }
  }
  function copyText(text) {
    var done = function () { say('Copied. Paste it into WhatsApp.'); };
    var fallback = function () {
      var t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      t.remove();
      if (ok) done(); else say('Could not copy. Open Preview and copy from there.', 'error');
    };
    try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback(); }
    catch (e) { fallback(); }
  }

  function refreshDesk() { try { if (global.ConfDesk && typeof global.ConfDesk.load === 'function') global.ConfDesk.load(); } catch (e) { /* the desk redraws on its own later */ } }

  // ---------- wiring ----------
  var ACT = {
    'close-all': function () { closeAll(); },
    'close-one': function () { hideOne(); },
    filter: function (el) { var f = el.getAttribute('data-f'); S.filter = f; drawList(); var again = document.querySelector('#sb-list [data-sb="filter"][data-f="' + f + '"]'); if (again) again.focus(); },
    'select-todo': function () { (S.d.speakers || []).forEach(function (s) { if (sendable(s)) S.sel[s.id] = 1; }); drawList(); var b = $('sb-send-many'); if (b) b.focus(); },
    'select-none': function () { S.sel = {}; drawList(); var b = document.querySelector('#sb-list [data-sb="select-todo"]'); if (b) b.focus(); },
    'send-many': function () { sendMany(); },
    'save-note': function () { saveNote(); },
    open: function (el) { open(el.getAttribute('data-id')); },
    copy: function (el) { copyFor(el.getAttribute('data-id')); },
    'send-one': function (el) { sendOne(el.getAttribute('data-id')); },
    'reset-words': function () { if (S.one != null) resetWords(S.one); },
    contact: function (el) { var id = Number(el.getAttribute('data-id')); S.contact = S.contact === id ? null : id; drawList(); var f = $('sb-ct-email-' + id); if (f) f.focus(); },
    'contact-cancel': function () { S.contact = null; drawList(); },
    'use-found': function (el) { var id = el.getAttribute('data-id'); var e = $('sb-ct-email-' + id), m = $('sb-ct-mobile-' + id); if (e) e.value = el.getAttribute('data-email') || ''; if (m && !m.value) m.value = el.getAttribute('data-mobile') || ''; if (e) e.focus(); },
    'contact-save': function (el) { var id = el.getAttribute('data-id'); saveContact(id, $('sb-ct-email-' + id), $('sb-ct-mobile-' + id), $('sb-ct-state-' + id), false); },
    'one-contact': function () { var f = $('sb-one-contact'); if (f) { f.hidden = !f.hidden; if (!f.hidden && $('sb-one-ct-email')) $('sb-one-ct-email').focus(); } },
    'one-contact-save': function (el) { saveContact(el.getAttribute('data-id'), $('sb-one-ct-email'), $('sb-one-ct-mobile'), $('sb-one-ct-state'), true); }
  };
  function wire(r) {
    r.addEventListener('click', function (ev) {
      var el = ev.target.closest('[data-sb]'); if (!el || el.disabled) return;
      var f = ACT[el.getAttribute('data-sb')]; if (f) { ev.preventDefault(); f(el); }
    });
    r.addEventListener('change', function (ev) {
      var el = ev.target; if (!el.matches || !el.matches('[data-sb-check]')) return;
      var id = Number(el.getAttribute('data-sb-check'));
      if (el.checked) S.sel[id] = 1; else delete S.sel[id];
      drawList();
      var again = r.querySelector('[data-sb-check="' + id + '"]'); if (again) again.focus();
    });
    r.addEventListener('input', function (ev) {
      var el = ev.target, k = el.getAttribute && el.getAttribute('data-sb-input');
      if (k === 'note') noteState();
      if (k === 'one-edit') { wordsState(); clearTimeout(S.timer); var id = el.getAttribute('data-id'); S.timer = setTimeout(function () { repreview(id); }, 400); }
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape' || !$('sb-root') || !$('sb-root').classList.contains('is-open')) return;
      if (!$('sb-one').hidden) hideOne(); else closeAll();
    });
  }

  global.SpeakerBrief = { open: open, openList: openList, reload: load };
})(window);
