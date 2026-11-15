/* Workshop emails (15 Nov 2026): Admin -> Workshops -> "Email about workshops".
 *
 * Everyone whose pass includes a workshop (paid or complimentary Premium Delegate,
 * VIP and Student Passes), each with what they would get now:
 *   - no seat yet: "Choose your workshop", every open workshop with its time, room
 *     and what to bring, and a button that signs them in at the seat picker;
 *   - a seat: "Your workshop", its time and room and what to do before the day.
 * Preview any one; send one, or tick several and send them in turn. Nobody is ticked
 * for you (test records, our own team and government guests are on the same list).
 * Someone emailed the same kind in the last 12 hours is not sent it again unless you
 * say so on their own row.
 *
 * The server side is src/routes/workshop-reminder.ts. Loaded after /admin.js; uses its
 * globals api, toast, openModal and closeModal, and wraps loadAdminWorkshops so the
 * panel is drawn each time the Workshops screen is. Buttons carry data-wsr="<action>";
 * one listener per panel runs them, so no name is written into an onclick string. */
(function (global) {
  'use strict';

  var S = { d: null, filter: 'choose', sel: {}, busy: false };
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var KIND = { choose: 'Choose your workshop', seat: 'Your workshop' };
  var BTN = 'px-3 py-1.5 rounded-lg text-xs font-semibold ';
  var PRIMARY = BTN + 'bg-primary-500/20 text-primary-300 hover:bg-primary-500/30';
  var PLAIN = BTN + 'glass text-gray-300 hover:bg-white/10';

  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function $(id) { return document.getElementById(id); }
  function say(msg, kind) { if (typeof toast === 'function') toast(esc(msg), kind || 'success'); }
  function errText(e) { return (e && e.message && e.message !== 'unauthorized') ? e.message : 'That did not work. Try again.'; }
  function stamp(t) { // admin_audit keeps UTC; show IST
    var d = new Date(String(t || '').replace(' ', 'T') + 'Z'); if (isNaN(d.getTime())) return '';
    var x = new Date(d.getTime() + 330 * 60000);
    return x.getUTCDate() + ' ' + MON[x.getUTCMonth()] + ', ' + ((x.getUTCHours() % 12) || 12) + ':' + String(x.getUTCMinutes()).padStart(2, '0') + (x.getUTCHours() < 12 ? ' am' : ' pm');
  }
  function chip(text, tone) {
    var cls = { amber: 'bg-amber-500/15 text-amber-300', green: 'bg-green-500/15 text-green-300', red: 'bg-red-500/15 text-red-300' }[tone] || 'bg-white/5 text-gray-400';
    return '<span class="px-2 py-0.5 rounded-full text-[10px] ' + cls + '">' + esc(text) + '</span>';
  }
  function person(id) { return ((S.d && S.d.people) || []).find(function (p) { return p.id === id; }) || null; }
  function shown() {
    var all = (S.d && S.d.people) || [];
    return S.filter === 'all' ? all : all.filter(function (p) { return p.kind === S.filter; });
  }
  function ticked() { return shown().filter(function (p) { return S.sel[p.id]; }); }

  // ---------- drawing ----------
  function row(p) {
    var last = p.last ? 'Emailed ' + stamp(p.last.at) + ' (' + (KIND[p.last.kind] || p.last.kind) + (p.last.auto ? ', automatic' : '') + ')' + (p.last.n > 1 ? ', ' + p.last.n + ' times' : '') : 'Not emailed yet';
    var flags = [chip(p.badge_type, 'amber')];
    if (String(p.payment_status).toLowerCase() === 'waived') flags.push(chip('Complimentary'));
    if (p.unsubscribed) flags.push(chip('Unsubscribed from email', 'red'));
    return '<div class="flex flex-wrap items-center gap-3 py-2 border-b border-white/5">' +
      '<input type="checkbox" data-wsr="tick" data-id="' + p.id + '"' + (S.sel[p.id] ? ' checked' : '') + ' aria-label="Tick ' + esc(p.name) + '">' +
      '<div class="flex-1 min-w-[180px]"><div class="text-sm text-gray-200">' + esc(p.name) + '</div>' +
        '<div class="text-[11px] text-gray-500">' + esc(p.email) + (p.company ? ' &middot; ' + esc(p.company) : '') + (p.job_title ? ' &middot; ' + esc(p.job_title) : '') + '</div></div>' +
      '<div class="flex flex-wrap gap-1">' + flags.join('') + '</div>' +
      '<div class="min-w-[160px] text-[11px]">' + (p.kind === 'seat' ? '<span class="text-green-300">Seat: ' + esc(p.workshop || 'a workshop') + '</span>' : '<span class="text-amber-300">No seat yet</span>') +
        '<div class="text-gray-500">' + esc(last) + '</div></div>' +
      '<button data-wsr="preview" data-id="' + p.id + '" class="' + PLAIN + '">Preview</button>' +
      '<button data-wsr="send" data-id="' + p.id + '" class="' + PRIMARY + '">Send</button>' +
    '</div>';
  }

  function draw() {
    var box = $('wsr-panel');
    if (!box) return;
    var d = S.d;
    if (!d) { box.innerHTML = '<p class="text-sm text-gray-400">Loading the workshop emails&hellip;</p>'; return; }
    var all = d.people || [];
    var count = function (k) { return k === 'all' ? all.length : all.filter(function (p) { return p.kind === k; }).length; };
    var tab = function (k, label) {
      return '<button data-wsr="filter" data-k="' + k + '" class="' + (S.filter === k ? PRIMARY : PLAIN) + '">' + esc(label) + ' (' + count(k) + ')</button>';
    };
    var list = shown();
    var n = ticked().length;
    var au = d.auto || null;
    var autoLine = !au ? '' : '<div class="flex flex-wrap items-center gap-2 mb-3 text-xs">' +
      chip(au.on ? 'Automatic: on' : 'Automatic: off', au.on ? 'green' : 'red') +
      '<span class="text-gray-400">' + (au.on
        ? esc(au.after_minutes) + ' minutes after any pass is paid for (or given free): &ldquo;Choose your workshop&rdquo; if the pass includes one and no seat is chosen, otherwise the workshop invitation (below). Once each. ' +
          esc(au.sent) + ' &ldquo;Choose&rdquo; and ' + esc(au.invited || 0) + ' invitations sent this way' + (au.failed ? ', ' + esc(au.failed) + ' failed' : '') + '.'
        : 'Nobody gets it by themselves. Send it from this list.') + '</span>' +
      (au.on && !au.clock_running ? '<span class="text-red-300">The minute clock is not running, so nothing goes by itself right now.</span>' : '') +
      '<button data-wsr="auto" data-on="' + (au.on ? '0' : '1') + '" class="' + PLAIN + '">' + (au.on ? 'Turn off' : 'Turn on') + '</button>' +
    '</div>';
    box.innerHTML =
      '<h3 class="font-bold text-base mb-1">Email about workshops</h3>' +
      '<p class="text-xs text-gray-400 mb-3">People with no seat get <strong>Choose your workshop</strong>: every open workshop with its time, room and what to bring, and a button that signs them in to choose. ' +
        'People with a seat get <strong>Your workshop</strong>: its time and room, and what to do before the day (for IBM&rsquo;s, installing IBM Bob). Times and rooms come from the cards below. ' +
        'Preview first. Nobody is ticked for you: leave out test records, your own team, and guests who should get a personal note.</p>' +
      autoLine +
      (d.open_workshops ? '' : '<p class="text-xs text-red-300 mb-3">Every workshop is full or closed, so &ldquo;Choose your workshop&rdquo; cannot go.</p>') +
      '<div class="flex flex-wrap gap-2 mb-3">' + tab('choose', 'No seat yet') + tab('seat', 'Have a seat') + tab('all', 'Everyone') + '</div>' +
      (list.map(row).join('') || '<p class="text-gray-500 text-sm py-2">Nobody here.</p>') +
      '<div class="flex flex-wrap items-center gap-2 mt-4">' +
        '<button data-wsr="tick-new" class="' + PLAIN + '">Tick everyone here not emailed yet</button>' +
        '<button data-wsr="clear" class="' + PLAIN + '">Clear ticks</button>' +
        '<button data-wsr="send-ticked" class="' + PRIMARY + '"' + (n ? '' : ' disabled') + '>Send to ' + n + ' ticked</button>' +
        '<span id="wsr-progress" class="text-xs text-gray-400"></span>' +
      '</div>' +
      inviteSection() + triesSection();
  }

  // ---------- passes without a workshop ----------
  function inviteSection() {
    var v = S.inv;
    if (!v || !v.groups) return '';
    var grp = function (k) {
      var x = v.groups[k] || { label: k, count: 0 };
      return '<div class="flex flex-wrap items-center gap-2 py-2 border-b border-white/5">' +
        '<div class="flex-1 min-w-[180px] text-sm text-gray-200">' + esc(x.label) + ' <span class="text-[11px] text-gray-500">' + esc(x.count) + ' not invited yet</span></div>' +
        '<button data-wsr="inv-preview" data-g="' + k + '" class="' + PLAIN + '"' + (x.count ? '' : ' disabled') + '>Preview</button>' +
        '<button data-wsr="inv-send" data-g="' + k + '" class="' + PRIMARY + '"' + (x.count && v.open_workshops ? '' : ' disabled') + '>Send to ' + esc(x.count) + '</button>' +
      '</div>';
    };
    var runs = (v.campaigns || []).map(function (cp) {
      return '<div class="text-[11px] text-gray-400">' + esc(cp.title) + ': ' + esc(cp.sent || 0) + ' of ' + esc(cp.total) + ' sent' +
        (cp.failed ? ', ' + esc(cp.failed) + ' failed' : '') + ' &middot; ' + esc(cp.status) + '</div>';
    }).join('');
    return '<div class="mt-6 pt-4 border-t border-white/10">' +
      '<h3 class="font-bold text-base mb-1">Invite passes without a workshop</h3>' +
      '<p class="text-xs text-gray-400 mb-3">One email each: the open workshops with their time, room and what to bring, and a button that signs them in to book. It does not mention passes or price. ' +
        'When someone presses <strong>Book this seat</strong>, the app shows which passes include a workshop and the price, and they appear under <strong>Tried to book</strong> below. ' +
        'Sent one at a time, 9 am to 9 pm, likeliest buyers first (in the app lately, then senior titles). Anyone who unsubscribed is left out. Pause or resume under Settings, Bulk email.</p>' +
      (v.open_workshops ? '' : '<p class="text-xs text-red-300 mb-2">Every workshop is full or closed, so there is nothing to invite people to.</p>') +
      grp('free') + grp('paid') +
      (runs ? '<div class="mt-3">' + runs + '</div>' : '') +
    '</div>';
  }

  function triesSection() {
    var t = S.tries;
    if (!t || !t.counts) return '';
    var rows = (t.people || []).map(function (p) {
      var tone = p.now === 'Not bought yet' ? 'red' : p.now === 'Started paying' ? 'amber' : 'green';
      return '<div class="flex flex-wrap items-center gap-3 py-2 border-b border-white/5">' +
        '<div class="flex-1 min-w-[180px]"><div class="text-sm text-gray-200">' + esc(p.name) + '</div>' +
          '<div class="text-[11px] text-gray-500">' + esc(p.mobile || 'No mobile') + ' &middot; ' + esc(p.email) + (p.company ? ' &middot; ' + esc(p.company) : '') + (p.job_title ? ' &middot; ' + esc(p.job_title) : '') + '</div></div>' +
        '<div class="min-w-[160px] text-[11px] text-gray-400">' + esc((p.workshops || []).join(', ')) +
          '<div class="text-gray-500">' + esc(stamp(p.last)) + (p.tries > 1 ? ', ' + esc(p.tries) + ' times' : '') + '</div></div>' +
        '<div class="flex flex-wrap gap-1">' + chip(p.badge_type, 'amber') + chip(p.now, tone) + '</div>' +
      '</div>';
    }).join('');
    return '<div class="mt-6 pt-4 border-t border-white/10">' +
      '<div class="flex flex-wrap items-center justify-between gap-2 mb-1"><h3 class="font-bold text-base">Tried to book a workshop (' + esc(t.counts.tried) + ')</h3>' +
        '<button data-wsr="tries-csv" class="' + PLAIN + '"' + ((t.people || []).length ? '' : ' disabled') + '>Download for calls (CSV)</button></div>' +
      '<p class="text-xs text-gray-400 mb-2">People whose pass has no workshop who pressed Book this seat, latest first, with what they hold now. ' + esc(t.counts.bought) + ' have bought a workshop pass since.</p>' +
      (rows || '<p class="text-gray-500 text-sm py-2">Nobody yet.</p>') +
    '</div>';
  }

  async function invitePreview(group) {
    try {
      var r = await api.post('/api/admin/workshop-invites/preview', { group: group });
      openModal(
        '<div class="flex items-start justify-between gap-3 mb-3"><div class="min-w-0">' +
          '<div class="text-xs text-gray-400">Workshop invitation &middot; as ' + esc(r.name || 'the first person') + ' would get it</div>' +
          '<h3 class="font-bold text-base">' + esc(r.subject) + '</h3>' +
        '</div><button data-wsr="close" class="' + PLAIN + '">Close</button></div>' +
        '<iframe id="wsr-frame" title="Email preview" sandbox="" style="width:100%;height:60vh;border:0;border-radius:12px;background:#fff"></iframe>' +
        '<p class="text-[11px] text-gray-500 mt-2">In the preview the button goes nowhere. The real email&rsquo;s button signs each person in at the workshops.</p>');
      var f = $('wsr-frame');
      if (f) f.srcdoc = r.html;
      var mb = $('modal-box');
      if (mb && !mb.__wsr) { mb.__wsr = true; mb.addEventListener('click', onClick); }
    } catch (e) { say((e && e.data && e.data.error) || errText(e), 'error'); }
  }

  async function inviteSend(group) {
    if (S.busy) return;
    var x = (S.inv && S.inv.groups && S.inv.groups[group]) || null;
    if (!x || !x.count) return;
    S.busy = true;
    try {
      var a = await api.get('/api/admin/workshop-invites/audience?group=' + encodeURIComponent(group));
      var ids = (a && a.ids) || [];
      if (!ids.length) { say('Nobody left to invite in that group.', 'error'); return; }
      if (!global.confirm('Send the workshop invitation to ' + ids.length + ' people (' + x.label + ')?\n\n' +
        'Real email, one at a time, only between 9 am and 9 pm, likeliest buyers first. It carries on by itself on the server, even with this page closed. ' +
        'Pause it under Settings, Bulk email. Nobody is sent two.')) return;
      var r = await api.post('/api/admin/campaigns', { kind: 'workshop_invite', audience: group, ids: ids, title: 'Workshop invitation: ' + x.label });
      say('Started: ' + (r.total || ids.length) + ' to send. Progress is shown here and under Settings, Bulk email.');
    } catch (e) { say((e && e.data && e.data.error) || errText(e), 'error'); }
    finally { S.busy = false; }
    await load();
  }

  function triesCsv() {
    var t = S.tries;
    if (!t || !(t.people || []).length) return;
    var cell = function (v) { var s = String(v == null ? '' : v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    var lines = [['Name', 'Mobile', 'Email', 'Organisation', 'Job title', 'City', 'Pass', 'Workshops tried', 'Times', 'First tried (IST)', 'Last tried (IST)', 'Now'].join(',')];
    t.people.forEach(function (p) {
      lines.push([p.name, p.mobile, p.email, p.company, p.job_title, p.city, p.badge_type, (p.workshops || []).join('; '), p.tries, stamp(p.first), stamp(p.last), p.now].map(cell).join(','));
    });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv' }));
    a.download = 'tried-to-book-a-workshop.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }

  async function load() {
    try {
      var got = await Promise.all([
        api.get('/api/admin/workshop-reminders'),
        api.get('/api/admin/workshop-invites').catch(function () { return null; }),
        api.get('/api/admin/workshop-tries').catch(function () { return null; })
      ]);
      var d = got[0];
      if (!d || d.error || !Array.isArray(d.people)) throw new Error((d && d.error) || 'The workshop email list came back in an unexpected shape.');
      S.d = d;
      S.inv = got[1] && !got[1].error ? got[1] : null;
      S.tries = got[2] && !got[2].error ? got[2] : null;
      var ids = {};
      d.people.forEach(function (p) { ids[p.id] = true; });
      Object.keys(S.sel).forEach(function (k) { if (!ids[k]) delete S.sel[k]; });
      draw();
    } catch (e) {
      var box = $('wsr-panel');
      if (box) box.innerHTML = '<p class="text-sm text-red-300">The workshop emails did not load: ' + esc(errText(e)) + '</p>';
    }
  }

  // ---------- actions ----------
  async function preview(id) {
    var p = person(id);
    try {
      var r = await api.post('/api/admin/attendees/' + id + '/workshop-reminder', { preview: true });
      if (!r || r.error) { say((r && r.error) || 'The preview did not load.', 'error'); return; }
      openModal(
        '<div class="flex items-start justify-between gap-3 mb-3"><div class="min-w-0">' +
          '<div class="text-xs text-gray-400">' + esc(KIND[r.kind] || r.kind) + ' &middot; to ' + esc(r.to) + '</div>' +
          '<h3 class="font-bold text-base">' + esc(r.subject) + '</h3>' +
          (r.last ? '<div class="text-[11px] text-amber-300">Last emailed ' + esc(stamp(r.last.at)) + ' (' + esc(KIND[r.last.kind] || r.last.kind) + ')</div>' : '') +
          (r.unsubscribed ? '<div class="text-[11px] text-red-300">They unsubscribed from email. This one is about the workshop in the pass they paid for.</div>' : '') +
        '</div><button data-wsr="close" class="' + PLAIN + '">Close</button></div>' +
        '<iframe id="wsr-frame" title="Email preview" sandbox="" style="width:100%;height:60vh;border:0;border-radius:12px;background:#fff"></iframe>' +
        '<p class="text-[11px] text-gray-500 mt-2">In the preview the button goes nowhere. The real email&rsquo;s button signs ' + esc((p && p.name) || 'them') + ' in.</p>' +
        '<div class="flex justify-end gap-2 mt-3"><button data-wsr="close" class="' + PLAIN + '">Close</button>' +
        '<button data-wsr="send" data-id="' + Number(id) + '" class="' + PRIMARY + '">Send this one</button></div>');
      var f = $('wsr-frame');
      if (f) f.srcdoc = r.html;
      var mb = $('modal-box');
      if (mb && !mb.__wsr) { mb.__wsr = true; mb.addEventListener('click', onClick); }
    } catch (e) { say(errText(e), 'error'); }
  }

  // One person. again: send the same kind again within 12 hours.
  // api.post throws on a refusal and hangs the server's answer on e.data: the
  // "already sent" answer is needed whole, so it comes back as a value here.
  async function sendOne(id, again) {
    try {
      var r = await api.post('/api/admin/attendees/' + id + '/workshop-reminder', again ? { again: true } : {});
      return r || { error: 'No answer from the server.' };
    } catch (e) {
      if (e && e.data && typeof e.data === 'object') return e.data;
      throw e;
    }
  }

  async function sendFromRow(id) {
    if (S.busy) return;
    var p = person(id);
    if (!p) return;
    if (!global.confirm('Send "' + (KIND[p.kind] || 'the workshop email') + '" to ' + p.name + ' (' + p.email + ') now?')) return;
    S.busy = true;
    try {
      var r = await sendOne(id, false);
      if (r.already && global.confirm(r.error + ' Send it again anyway?')) r = await sendOne(id, true);
      if (r.success) { say('Sent to ' + r.to); if (typeof closeModal === 'function') closeModal(); }
      else if (!r.already) say(r.error || 'It did not go.', 'error');
    } catch (e) { say(errText(e), 'error'); }
    S.busy = false;
    await load();
  }

  async function sendTicked() {
    if (S.busy) return;
    var list = ticked();
    if (!list.length) return;
    var choose = list.filter(function (p) { return p.kind === 'choose'; }).length;
    var msg = 'Send ' + list.length + ' email' + (list.length === 1 ? '' : 's') + ' now?\n\n' +
      (choose ? choose + ' get "Choose your workshop".\n' : '') +
      (list.length - choose ? (list.length - choose) + ' get "Your workshop".\n' : '') +
      '\nAnyone emailed the same one in the last 12 hours is skipped.';
    if (!global.confirm(msg)) return;
    S.busy = true;
    var ok = 0, skipped = [], failed = [];
    for (var i = 0; i < list.length; i++) {
      var pr = $('wsr-progress');
      if (pr) pr.textContent = 'Sending ' + (i + 1) + ' of ' + list.length + '...';
      try {
        var r = await sendOne(list[i].id, false);
        if (r.success) { ok++; delete S.sel[list[i].id]; }
        else if (r.already) skipped.push(list[i].name);
        else failed.push(list[i].name + ': ' + (r.error || 'not sent'));
      } catch (e) { failed.push(list[i].name + ': ' + errText(e)); if (e && e.message === 'unauthorized') break; }
    }
    S.busy = false;
    await load();
    var pr2 = $('wsr-progress');
    var parts = [ok + ' sent'];
    if (skipped.length) parts.push(skipped.length + ' skipped (emailed in the last 12 hours: ' + skipped.join(', ') + ')');
    if (failed.length) parts.push(failed.length + ' not sent (' + failed.join('; ') + ')');
    if (pr2) pr2.textContent = parts.join('. ') + '.';
    say(parts.join('. ') + '.', failed.length ? 'error' : 'success');
  }

  // The automatic email's switch.
  async function setAuto(on) {
    if (!on && !global.confirm('Turn off the automatic "Choose your workshop" email? New buyers will then only get it if you send it from this list.')) return;
    try {
      var r = await api.post('/api/admin/workshop-reminders/auto', { on: on });
      if (r && r.error) { say(r.error, 'error'); return; }
      say(on ? 'Automatic email turned on' : 'Automatic email turned off');
    } catch (e) { say(errText(e), 'error'); }
    await load();
  }

  function onClick(e) {
    var b = e.target.closest ? e.target.closest('[data-wsr]') : null;
    if (!b) return;
    var act = b.getAttribute('data-wsr');
    var id = Number(b.getAttribute('data-id'));
    if (act === 'tick') { if (b.checked) S.sel[id] = true; else delete S.sel[id]; draw(); return; }
    if (act === 'filter') { S.filter = b.getAttribute('data-k') || 'choose'; draw(); return; }
    if (act === 'tick-new') { shown().forEach(function (p) { if (!p.last) S.sel[p.id] = true; }); draw(); return; }
    if (act === 'clear') { S.sel = {}; draw(); return; }
    if (act === 'preview') { preview(id); return; }
    if (act === 'send') { sendFromRow(id); return; }
    if (act === 'send-ticked') { sendTicked(); return; }
    if (act === 'auto') { setAuto(b.getAttribute('data-on') === '1'); return; }
    if (act === 'inv-preview') { invitePreview(b.getAttribute('data-g')); return; }
    if (act === 'inv-send') { inviteSend(b.getAttribute('data-g')); return; }
    if (act === 'tries-csv') { triesCsv(); return; }
    if (act === 'close' && typeof closeModal === 'function') closeModal();
  }

  // ---------- on the Workshops screen ----------
  function mount() {
    var host = $('section-workshops');
    if (!host || typeof _adminWs === 'undefined' || !_adminWs || !_adminWs.ready) return;
    var old = $('wsr-panel');
    if (old) old.remove();
    var box = document.createElement('div');
    box.id = 'wsr-panel';
    box.className = 'glass rounded-2xl p-5 mb-5';
    box.addEventListener('click', onClick);
    // After the cut-off bar, above the workshop cards.
    var first = host.firstElementChild;
    if (first && first.nextSibling) host.insertBefore(box, first.nextSibling); else host.appendChild(box);
    draw();
    load();
  }

  function wrap() {
    var orig = global.loadAdminWorkshops;
    if (typeof orig !== 'function' || orig.__wsr) return;
    var wrapped = async function () {
      var r = await orig.apply(this, arguments);
      try { mount(); } catch (e) { /* the seats screen still works without the panel */ }
      return r;
    };
    wrapped.__wsr = true;
    global.loadAdminWorkshops = wrapped;
  }
  wrap();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wrap);

  global.WorkshopReminder = { reload: load };
})(window);
