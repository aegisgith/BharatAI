/* Innovation Talk briefs (16 Nov 2026): Admin -> Innovation Talks -> "Time & hall briefs".
 *
 * One email per Innovation Talk & Showcase speaker with the day and time, the hall, how
 * long they have, the topic as the programme has it, calendar links, their pass when
 * they hold one, and the saved note (where to report, slides, who to call). Preview any
 * one; send one, or tick several and send them in turn. The list says who is ready, who
 * has no time or no email, who was sent one, and whose slot changed after it went
 * ("Send update"). Government officials are not emailed from the list: copy their
 * details for WhatsApp instead, or send to one on purpose.
 *
 * The server side is src/routes/talk-brief.ts. Loaded before /admin.js; uses its globals
 * api, toast, openModal and closeModal at click time, and EID for the event. Buttons
 * carry data-tb="<action>"; one listener on the modal runs them, so no name is written
 * into an onclick string. */
(function (global) {
  'use strict';

  var S = { d: null, filter: 'todo', sel: {}, busy: false, one: null, pv: null, noteSaved: '' };
  var STATUS = {
    ready: { word: 'Not sent yet', cls: 'bg-amber-500/15 text-amber-300' },
    changed: { word: 'Changed since sent', cls: 'bg-red-500/15 text-red-300' },
    sent: { word: 'Sent', cls: 'bg-green-500/15 text-green-300' },
    'no-email': { word: 'No email address', cls: 'bg-white/5 text-gray-400' },
    'no-time': { word: 'No time or hall yet', cls: 'bg-white/5 text-gray-400' },
    protocol: { word: 'Official: through their office', cls: 'bg-white/5 text-blue-300' }
  };
  var FILTERS = [
    ['todo', 'To send', function (t) { return t.status === 'ready' || t.status === 'changed'; }],
    ['changed', 'Changed', function (t) { return t.status === 'changed'; }],
    ['sent', 'Sent', function (t) { return t.status === 'sent'; }],
    ['no-email', 'No email', function (t) { return t.status === 'no-email'; }],
    ['no-time', 'No time', function (t) { return t.status === 'no-time'; }],
    ['protocol', 'Officials', function (t) { return t.status === 'protocol'; }],
    ['all', 'Everyone', function () { return true; }]
  ];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var BTN = 'px-3 py-1.5 rounded-lg text-xs font-semibold ';
  var PRIMARY = BTN + 'bg-primary-500/20 text-primary-300 hover:bg-primary-500/30';
  var PLAIN = BTN + 'glass text-gray-300 hover:bg-white/10';

  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function $(id) { return document.getElementById(id); }
  function say(msg, kind) { if (typeof toast === 'function') toast(esc(msg), kind || 'success'); }
  function errText(e) { return (e && e.message && e.message !== 'unauthorized') ? e.message : 'That did not work. Try again.'; }
  function eid() { return (typeof EID !== 'undefined' && EID) ? EID : 1; }
  function when(t) {
    if (!t.starts_at) return t.time_slot || 'No time yet';
    var x = new Date(String(t.starts_at).slice(0, 10) + 'T00:00:00Z'); var hm = String(t.starts_at).slice(11, 16).split(':'); var h = parseInt(hm[0], 10);
    return DAYS[x.getUTCDay()] + ' ' + x.getUTCDate() + ' ' + MON[x.getUTCMonth()] + ', ' + (h % 12 || 12) + ':' + hm[1] + (h < 12 ? ' am' : ' pm') + (t.duration_min ? ' (' + t.duration_min + ' min)' : '');
  }
  function stamp(t) { // admin_audit keeps UTC; show IST
    var d = new Date(String(t || '').replace(' ', 'T') + 'Z'); if (isNaN(d.getTime())) return '';
    var x = new Date(d.getTime() + 330 * 60000);
    return x.getUTCDate() + ' ' + MON[x.getUTCMonth()] + ', ' + ((x.getUTCHours() % 12) || 12) + ':' + String(x.getUTCMinutes()).padStart(2, '0') + (x.getUTCHours() < 12 ? ' am' : ' pm');
  }
  function chip(text, cls) { return '<span class="px-2 py-0.5 rounded-full text-[10px] ' + cls + '">' + esc(text) + '</span>'; }
  function byId(id) { return ((S.d && S.d.talks) || []).find(function (t) { return t.id === Number(id); }) || null; }
  function sendable(t) { return t.status === 'ready' || t.status === 'changed'; }
  function shown() { var f = FILTERS.find(function (x) { return x[0] === S.filter; }) || FILTERS[0]; return ((S.d && S.d.talks) || []).filter(f[2]); }
  function ticked() { return shown().filter(function (t) { return S.sel[t.id] && sendable(t); }); }

  // ---------- the list ----------
  async function openList() {
    S.filter = 'todo'; S.sel = {}; S.one = null;
    openModal('<div class="py-10 text-center text-gray-400"><i class="fas fa-spinner fa-spin"></i></div>');
    await load();
  }
  async function load() {
    try {
      S.d = await api.get('/api/admin/events/' + eid() + '/talk-briefs');
      if (S.d && S.d.error) throw new Error(S.d.error);
      S.noteSaved = S.d.note || '';
      var keep = {}; Object.keys(S.sel).forEach(function (k) { var t = byId(k); if (t && sendable(t)) keep[k] = 1; }); S.sel = keep;
      drawList();
    } catch (e) {
      openModal('<p class="text-sm text-red-400">Could not load the talks: ' + esc(errText(e)) + '</p>');
    }
  }
  function row(t) {
    var st = STATUS[t.status] || STATUS.ready;
    var last = t.last ? 'Sent ' + stamp(t.last.at) + (t.last.kind === 'update' ? ' (update)' : '') + (t.last.n > 1 ? ', ' + t.last.n + ' times' : '') + ' to ' + esc(t.last.to) : '';
    var to = t.email ? esc(t.email) + (t.source === 'booth' ? ' <span class="text-amber-300">(booth contact, asked to pass it on)</span>' : t.source === 'team' ? ' (team list)' : '') : '<span class="text-gray-500">no email on file</span>';
    var pass = t.source === 'booth' ? '' : (t.pass ? chip(t.pass.badge_type || 'Pass', 'bg-green-500/15 text-green-300') : chip('No pass yet', 'bg-white/5 text-gray-400'));
    return '<div class="flex flex-wrap items-start gap-3 py-2.5 border-b border-white/5">' +
      '<input type="checkbox" data-tb="tick" data-id="' + t.id + '"' + (S.sel[t.id] ? ' checked' : '') + (sendable(t) ? '' : ' disabled') + ' class="mt-1" aria-label="Tick ' + esc(t.speaker) + '">' +
      '<div class="flex-1 min-w-[200px]"><div class="text-sm text-gray-200">' + esc(t.speaker) + (t.company ? ' <span class="text-gray-500">&middot; ' + esc(t.company) + '</span>' : '') + '</div>' +
        '<div class="text-[11px] text-gray-400">' + esc(t.topic || 'Topic to be announced') + '</div>' +
        '<div class="text-[11px] text-gray-500 mt-0.5">' + esc(when(t)) + (t.hall ? ' &middot; ' + esc(t.hall) : '') + '</div>' +
        '<div class="text-[11px] text-gray-500">' + to + '</div>' +
        (last ? '<div class="text-[11px] text-gray-500">' + last + '</div>' : '') + '</div>' +
      '<div class="flex flex-wrap gap-1 pt-1">' + chip(st.word, st.cls) + pass + '</div>' +
      '<div class="flex gap-1.5 pt-0.5">' +
        (t.status !== 'no-time' ? '<button type="button" data-tb="preview" data-id="' + t.id + '" class="' + PLAIN + '">Preview</button>' : '') +
        (sendable(t) ? '<button type="button" data-tb="send" data-id="' + t.id + '" class="' + PRIMARY + '">' + (t.status === 'changed' ? 'Send update' : 'Send') + '</button>' : '') +
      '</div></div>';
  }
  function drawList() {
    var list = (S.d && S.d.talks) || [];
    var counts = {}; FILTERS.forEach(function (f) { counts[f[0]] = list.filter(f[2]).length; });
    if (!counts[S.filter] && S.filter !== 'all') S.filter = counts.todo ? 'todo' : 'all';
    var rows = shown();
    var n = ticked().length;
    openModal('<h3 class="text-lg font-bold mb-1"><i class="fas fa-clock text-primary-400 mr-2"></i>Time &amp; hall briefs for the Innovation Talks</h3>' +
      '<p class="text-xs text-gray-400 mb-3">One email per speaker: day and time, hall, how long they have, the topic as the programme has it, calendar links and their pass. Preview any one before it goes. Officials are not emailed from here.</p>' +
      '<div class="flex gap-1.5 flex-wrap mb-3">' + FILTERS.map(function (f) {
        return '<button type="button" data-tb="filter" data-f="' + f[0] + '" class="px-3 py-1.5 rounded-lg text-xs font-semibold ' + (S.filter === f[0] ? 'bg-primary-600 text-white' : 'border border-white/10 text-gray-300 hover:bg-white/5') + '">' + f[1] + ' (' + counts[f[0]] + ')</button>';
      }).join('') + '</div>' +
      '<details class="mb-3"' + (S.noteSaved ? '' : ' open') + '><summary class="text-xs text-gray-300 cursor-pointer">The note every brief carries' + (S.noteSaved ? ' <span class="text-gray-500">(saved)</span>' : ' <span class="text-amber-300">(none yet)</span>') + '</summary>' +
        '<textarea id="tb-note" rows="3" class="w-full mt-2 text-xs rounded-lg bg-white/5 border border-white/10 p-2 text-gray-200" placeholder="For example: Please be at the stage 15 minutes before your slot. Bring your slides as a PDF on a USB drive and keep a copy on your phone. On the day, call Akshay on 98xxx.">' + esc(S.noteSaved) + '</textarea>' +
        '<div class="flex gap-2 mt-1"><button type="button" data-tb="save-note" class="' + PRIMARY + '">Save the note</button></div></details>' +
      '<div class="max-h-[46vh] overflow-y-auto pr-1">' + (rows.length ? rows.map(row).join('') : '<p class="text-sm text-gray-400 py-6 text-center">Nobody here.</p>') + '</div>' +
      '<div class="flex gap-2 mt-4 items-center flex-wrap">' +
        '<button type="button" data-tb="tick-all" class="' + PLAIN + '">Tick all shown</button>' +
        '<button type="button" data-tb="send-ticked"' + (n ? '' : ' disabled') + ' class="' + PRIMARY + (n ? '' : ' opacity-40') + '">Send to ticked (' + n + ')</button>' +
        '<span id="tb-progress" class="text-[11px] text-gray-400"></span>' +
        '<button type="button" data-tb="close" class="ml-auto px-4 py-2 rounded-xl text-sm glass hover:bg-white/10">Close</button>' +
      '</div>');
    wire();
  }

  // ---------- one talk: preview, then send ----------
  async function openOne(id) {
    var t = byId(id); if (!t) return;
    S.one = t;
    openModal('<div class="py-10 text-center text-gray-400"><i class="fas fa-spinner fa-spin"></i></div>');
    var d;
    try {
      d = await api.post('/api/admin/innovation-talks/' + id + '/brief', { preview: true });
      if (d && d.error) throw new Error(d.error);
    } catch (e) { say(errText(e), 'error'); drawList(); return; }
    S.pv = d;
    var needsTo = !d.to;
    openModal('<h3 class="text-lg font-bold mb-1">' + esc(t.speaker) + (t.company ? ' <span class="text-gray-400 font-normal">&middot; ' + esc(t.company) + '</span>' : '') + '</h3>' +
      '<p class="text-xs text-gray-400 mb-2">' + (d.to ? 'To ' + esc(d.to) + (d.source === 'booth' ? ' (the booth contact, asked to pass it on)' : d.source === 'team' ? ' (from the team list)' : '') : 'No email address on file.') +
        (d.protocol ? ' <span class="text-blue-300">A government official: their office handles protocol.</span>' : '') +
        (d.pass ? ' Pass: ' + esc(d.pass.badge_type) + '.' : d.source === 'booth' ? '' : ' <span class="text-amber-300">No pass under this address yet; the email says how to get one.</span>') + '</p>' +
      (needsTo || d.source === 'booth' ? '<div class="flex gap-2 items-center mb-2"><label class="text-xs text-gray-400" for="tb-to">Send to another address:</label><input id="tb-to" type="email" class="flex-1 text-xs rounded-lg bg-white/5 border border-white/10 p-2 text-gray-200" placeholder="speaker@company.com"></div>' : '') +
      '<p class="text-sm font-semibold text-white mb-2">Subject: ' + esc(d.subject) + '</p>' +
      '<iframe id="tb-prev-frame" sandbox="" title="Email preview" class="w-full rounded-xl bg-white" style="height:52vh;border:1px solid rgba(0,0,0,0.1);"></iframe>' +
      '<div class="flex gap-2 mt-4 flex-wrap">' +
        '<button type="button" data-tb="back" class="px-4 py-2.5 rounded-xl text-sm glass hover:bg-white/10">Back</button>' +
        '<button type="button" data-tb="copy" class="px-4 py-2.5 rounded-xl text-sm glass hover:bg-white/10">Copy for WhatsApp</button>' +
        '<button type="button" data-tb="send-one" class="ml-auto px-4 py-2.5 rounded-xl text-sm bg-amber-600 hover:bg-amber-500 text-white font-semibold">' + (d.protocol ? 'Send anyway' : d.update ? 'Send update' : 'Send') + '</button>' +
      '</div>');
    var f = $('tb-prev-frame'); if (f) f.srcdoc = d.html;
    wire();
  }
  async function sendOne(id, opts) {
    var r = await api.post('/api/admin/innovation-talks/' + id + '/brief', opts || {});
    if (r && r.error) throw new Error(r.error);
    return r;
  }
  async function sendTicked() {
    var list = ticked(); if (!list.length || S.busy) return;
    if (!confirm('Send the brief to ' + list.length + ' speaker' + (list.length === 1 ? '' : 's') + ' now?')) return;
    S.busy = true;
    var ok = 0, bad = [];
    for (var i = 0; i < list.length; i++) {
      var p = $('tb-progress'); if (p) p.textContent = 'Sending ' + (i + 1) + ' of ' + list.length + ': ' + list[i].speaker;
      try { await sendOne(list[i].id); ok++; } catch (e) { bad.push(list[i].speaker + ': ' + errText(e)); }
      if (!S.busy) break;
    }
    S.busy = false; S.sel = {};
    say(ok + ' sent' + (bad.length ? ', ' + bad.length + ' not: ' + bad.join('; ') : ''), bad.length ? 'error' : 'success');
    await load();
  }
  async function saveNote() {
    var ta = $('tb-note'); if (!ta) return;
    try {
      var r = await api.put('/api/admin/talk-briefs/note', { note: ta.value });
      if (r && r.error) throw new Error(r.error);
      S.noteSaved = r.note || ''; say('Saved. Every brief sent from now carries it.');
    } catch (e) { say(errText(e), 'error'); }
  }

  // ---------- buttons ----------
  function wire() {
    var box = $('modal-box'); if (!box || box.getAttribute('data-tb-wired')) return;
    box.setAttribute('data-tb-wired', '1');
    box.addEventListener('click', async function (ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest('[data-tb]') : null;
      if (!b) return;
      var a = b.getAttribute('data-tb'), id = b.getAttribute('data-id');
      if (a === 'filter') { S.filter = b.getAttribute('data-f'); drawList(); }
      else if (a === 'tick') { if (b.checked) S.sel[id] = 1; else delete S.sel[id]; var n = ticked().length; var sb = box.querySelector('[data-tb="send-ticked"]'); if (sb) { sb.disabled = !n; sb.classList.toggle('opacity-40', !n); sb.textContent = 'Send to ticked (' + n + ')'; } }
      else if (a === 'tick-all') { shown().forEach(function (t) { if (sendable(t)) S.sel[t.id] = 1; }); drawList(); }
      else if (a === 'send-ticked') sendTicked();
      else if (a === 'save-note') saveNote();
      else if (a === 'preview') openOne(id);
      else if (a === 'send') {
        var t = byId(id); if (!t) return;
        if (!confirm('Send the brief to ' + t.speaker + ' (' + t.email + ') now?')) return;
        try { var r = await sendOne(id); say('Sent to ' + r.to + '.'); await load(); } catch (e) { say(errText(e), 'error'); }
      }
      else if (a === 'back') { S.one = null; drawList(); }
      else if (a === 'copy') {
        try { await navigator.clipboard.writeText((S.pv && S.pv.text) || ''); say('Copied. Paste it into WhatsApp.'); } catch (e) { say('Could not copy; select the text in the preview instead.', 'error'); }
      }
      else if (a === 'send-one') {
        var one = S.one, pv = S.pv; if (!one || !pv) return;
        var toEl = $('tb-to'), to = toEl && toEl.value ? toEl.value.trim() : '';
        if (!pv.to && !to) { say('Type an email address first.', 'error'); return; }
        if (!confirm('Send the brief to ' + (to || pv.to) + ' now?')) return;
        try { var r2 = await sendOne(one.id, { anyway: !!pv.protocol, to: to || undefined }); say('Sent to ' + r2.to + '.'); S.one = null; await load(); } catch (e) { say(errText(e), 'error'); }
      }
      else if (a === 'close') closeModal();
    });
  }

  global.TalkBrief = { openList: openList, openOne: openOne };
})(window);
