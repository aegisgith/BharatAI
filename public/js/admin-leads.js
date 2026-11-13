/* Admin, Booth Leads (13 Nov 2026).
 *
 * For every exhibitor: who can scan visitors' badges at the booth (people on the team
 * list with an account, how many have signed in to the app, the booth contact's
 * dashboard login), how many leads, today's, and the last scan. And the lead-scanning
 * guide: one email per person with their own sign-in button, previewed first, sent once
 * per exhibitor unless sent again. Sending gives out the team's passes first, as the
 * Teams "Ask" email does. The server is the BOOTH LEADS, FOR THE ORGANISERS block in
 * src/index.tsx.
 *
 * The admin page loads this file the first time the section opens and calls
 * LeadsDesk.mount(element, { api, toast }). One global, LeadsDesk.
 */
(function (w) {
  'use strict';

  var opts = null;
  var host = null;
  var data = null;
  var filter = 'all';
  var query = '';
  var open = 0;
  var busy = false;

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function toast(msg, type) { if (opts && opts.toast) opts.toast(esc(msg), type || 'success'); }
  function plural(n, one, many) { return Number(n) + ' ' + (Number(n) === 1 ? one : many); }
  function canScan(r) { return r.signed_in > 0 || r.dashboard > 0; }

  var FILTERS = [
    ['all', 'All'],
    ['noscan', 'Nobody can scan yet'],
    ['notoday', 'No leads today'],
    ['unsent', 'Guide not sent'],
  ];
  function shown() {
    var list = (data && data.exhibitors) || [];
    return list.filter(function (r) {
      if (filter === 'noscan' && canScan(r)) return false;
      if (filter === 'notoday' && r.today > 0) return false;
      if (filter === 'unsent' && r.guide_sent_count > 0) return false;
      if (!query) return true;
      return (r.company + ' ' + r.booth + ' ' + r.owner_name).toLowerCase().indexOf(query) >= 0;
    });
  }

  function draw() {
    var d = data || {}, t = d.totals || {}, list = d.exhibitors || [];
    var unsent = list.filter(function (r) { return !r.guide_sent_count; }).length;
    var head = '<div class="bld-card"><h2><i class="fas fa-id-card" aria-hidden="true"></i> Booth leads</h2>'
      + '<p class="bld-lead">Exhibitors scan the QR on a visitor&rsquo;s pass to save them as a lead. Anyone on their team list with an account can scan in the event app, and the booth contact can scan from the exhibitor dashboard. Send each exhibitor the guide before the event: every person gets their own email with a button that signs them in.</p>'
      + (d.ready === false ? '<p class="bld-warn">Badge scanning is not in the database yet. Apply migration 0051 first.</p>' : '')
      + (d.tags_ready === false ? '<p class="bld-warn">Apply migration 0062 to let exhibitors tick what a visitor wants (a demo, a price, a partnership). Scanning works without it.</p>' : '')
      + '<dl class="bld-totals">'
      + '<div><dt>Exhibitors</dt><dd>' + Number(t.exhibitors || 0) + '</dd></div>'
      + '<div><dt>Someone can scan</dt><dd>' + Number(t.can_scan || 0) + '</dd></div>'
      + '<div><dt>Guide sent</dt><dd>' + Number(t.guide_sent || 0) + '</dd></div>'
      + '<div><dt>Leads</dt><dd>' + Number(t.leads || 0) + '</dd></div>'
      + '<div><dt>Leads today</dt><dd>' + Number(t.today || 0) + '</dd></div>'
      + '<div><dt>Hot leads</dt><dd>' + Number(t.hot || 0) + '</dd></div>'
      + '</dl>'
      + '<div class="bld-tools">'
      + '<button type="button" class="bld-btn bld-primary" data-act="bulk"' + (unsent && !busy ? '' : ' disabled') + '>Send the guide to every exhibitor not sent yet (' + unsent + ')</button>'
      + '<button type="button" class="bld-btn" data-act="reload"' + (busy ? ' disabled' : '') + '>Refresh</button>'
      + '</div><p class="bld-progress" id="bld-progress" role="status"></p>'
      + '<div class="bld-tools" role="group" aria-label="Show">'
      + FILTERS.map(function (f) { return '<button type="button" class="bld-chip" data-filter="' + f[0] + '" aria-pressed="' + (filter === f[0]) + '">' + esc(f[1]) + '</button>'; }).join('')
      + '<input type="search" id="bld-q" placeholder="Search exhibitor, booth or owner" aria-label="Search exhibitors" value="' + esc(query) + '">'
      + '</div></div>';
    var rows = shown().map(function (r) {
      var team = r.team
        ? plural(r.team, 'person', 'people') + ' listed<div class="bld-sub">' + Number(r.with_account) + ' with an account, ' + Number(r.signed_in) + ' signed in'
          + (r.no_account_yet ? '<br>' + plural(r.no_account_yet, 'gets', 'get') + ' an account when the guide is sent' : '') + '</div>'
        : '<span class="bld-sub">No team listed</span>';
      var guide = r.guide_sent_count ? '<span class="bld-ok">Sent</span><div class="bld-sub">' + esc(r.guide_sent_at) + (r.guide_sent_count > 1 ? ' (' + r.guide_sent_count + ' times)' : '') + '</div>' : '<span class="bld-sub">Not sent</span>';
      var row = '<tr><td><b>' + esc(r.company) + '</b><div class="bld-sub">' + (r.booth ? 'Booth ' + esc(r.booth) : 'No booth number') + (r.owner_name ? ' &middot; ' + esc(r.owner_name) : '') + '</div></td>'
        + '<td>' + team + '</td>'
        + '<td>' + (r.dashboard ? '<span class="bld-ok">Yes</span>' : '<span class="bld-bad">No</span>') + '</td>'
        + '<td>' + (canScan(r) ? '<span class="bld-ok">Yes</span>' : '<span class="bld-bad">Not yet</span>') + '</td>'
        + '<td class="bld-n">' + Number(r.leads) + '<div class="bld-sub">' + Number(r.hot) + ' hot</div></td>'
        + '<td class="bld-n">' + Number(r.today) + '</td>'
        + '<td>' + (r.last_scan ? esc(r.last_scan) : '<span class="bld-sub">None</span>') + '</td>'
        + '<td>' + guide + '</td>'
        + '<td class="bld-acts"><button type="button" class="bld-btn" data-act="preview" data-id="' + r.id + '">' + (open === r.id ? 'Hide' : 'Preview') + '</button>'
        + '<button type="button" class="bld-btn' + (r.guide_sent_count ? '' : ' bld-primary') + '" data-act="send" data-id="' + r.id + '"' + (busy ? ' disabled' : '') + '>' + (r.guide_sent_count ? 'Send again' : 'Send guide') + '</button></td></tr>';
      if (open === r.id) row += '<tr class="bld-preview"><td colspan="9" id="bld-preview">Loading...</td></tr>';
      return row;
    }).join('');
    var table = list.length
      ? '<div class="bld-wrap"><table class="bld-table"><thead><tr><th>Exhibitor</th><th>Team</th><th>Dashboard login</th><th>Someone can scan</th><th class="bld-n">Leads</th><th class="bld-n">Today</th><th>Last scan</th><th>Guide</th><th><span class="bld-sr">Actions</span></th></tr></thead><tbody>'
        + (rows || '<tr><td colspan="9" class="bld-sub">No exhibitor matches.</td></tr>') + '</tbody></table></div>'
      : '<p class="bld-note">No exhibitors yet.</p>';
    host.innerHTML = '<div class="bld">' + head + table + '</div>';
    if (open) loadPreview(open);
  }

  async function load() {
    try { data = await opts.api.get('/api/admin/booth-leads'); }
    catch (err) { host.innerHTML = '<div class="bld"><div class="bld-card"><p class="bld-warn">Could not load booth leads: ' + esc(err.message) + '</p><button type="button" class="bld-btn" data-act="reload">Try again</button></div></div>'; return; }
    draw();
  }

  async function loadPreview(id) {
    var cell = document.getElementById('bld-preview');
    try {
      var r = await opts.api.get('/api/admin/booth-leads/' + id + '/guide');
      if (!cell || open !== id) return;
      var to = r.recipients || [];
      var ex = r.exhibitor || {};
      cell.innerHTML = '<p class="bld-note"><b>To:</b> ' + (to.length ? to.map(function (x) { return esc(x.email) + ' <span class="bld-sub">(' + (x.kind === 'contact' ? 'booth contact, dashboard' : 'team, event app') + ')</span>'; }).join(', ') : 'nobody yet') + '</p>'
        + (ex.no_account_yet ? '<p class="bld-note">' + plural(ex.no_account_yet, 'person on the list gets', 'people on the list get') + ' an account and a pass when you send, and then the email too.</p>' : '')
        + ((r.unsubscribed || []).length ? '<p class="bld-note">Left out, unsubscribed: ' + r.unsubscribed.map(esc).join(', ') + '</p>' : '')
        + '<p class="bld-note"><b>Subject:</b> ' + esc(r.subject) + '</p>'
        + '<form class="bld-test" data-id="' + id + '"><label for="bld-test-to">Send me a test</label><input id="bld-test-to" type="email" required placeholder="your@email" autocomplete="email"><button type="submit" class="bld-btn">Send test</button><span class="bld-sub">The test signs nobody in.</span></form>'
        + '<iframe class="bld-frame" sandbox="" title="Preview of the guide email"></iframe>';
      var frame = cell.querySelector('iframe');
      if (frame) frame.srcdoc = r.html || '';
    } catch (err) { if (cell) cell.textContent = 'Could not load the preview: ' + err.message; }
  }

  async function sendOne(id, again) {
    return opts.api.post('/api/admin/booth-leads/' + id + '/guide', again ? { again: true } : {});
  }
  function replace(ex) {
    if (!ex || !data || !data.exhibitors) return;
    data.exhibitors = data.exhibitors.map(function (r) { return r.id === ex.id ? ex : r; });
  }

  async function onSend(id) {
    var r = (data.exhibitors || []).filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    var again = !!r.guide_sent_count;
    var msg = again
      ? 'Send the lead-scanning guide to ' + r.company + ' again? It was sent on ' + r.guide_sent_at + '. Each person gets a new email.'
      : 'Send the lead-scanning guide to ' + r.company + '? Their team’s passes are given out first, then each person gets their own email.';
    if (!w.confirm(msg)) return;
    busy = true; draw();
    try {
      var res = await sendOne(id, again);
      replace(res.exhibitor);
      toast(r.company + ': sent to ' + plural(res.sent, 'person', 'people') + (res.failed ? ', ' + res.failed + ' failed' : '') + (res.unsubscribed ? ', ' + res.unsubscribed + ' unsubscribed left out' : ''));
    } catch (err) { toast(r.company + ': ' + err.message, 'error'); }
    busy = false;
    await load();
  }

  async function onBulk() {
    var list = (data.exhibitors || []).filter(function (r) { return !r.guide_sent_count; });
    if (!list.length) return;
    if (!w.confirm('Send the lead-scanning guide to ' + plural(list.length, 'exhibitor', 'exhibitors') + ' that have not had it? For each, their team’s passes are given out first, then every person gets their own email. This takes a minute or two; keep this page open.')) return;
    busy = true; draw();
    var done = 0, people = 0, failed = [];
    for (var i = 0; i < list.length; i++) {
      var p = document.getElementById('bld-progress');
      if (p) p.textContent = 'Sending ' + (i + 1) + ' of ' + list.length + ': ' + list[i].company + '...';
      try { var res = await sendOne(list[i].id, false); done++; people += Number(res.sent) || 0; replace(res.exhibitor); }
      catch (err) { failed.push(list[i].company + ' (' + err.message + ')'); }
    }
    busy = false;
    await load();
    var p2 = document.getElementById('bld-progress');
    if (p2) p2.textContent = 'Sent to ' + plural(done, 'exhibitor', 'exhibitors') + ', ' + plural(people, 'person', 'people') + '.' + (failed.length ? ' Not sent: ' + failed.join('; ') : '');
    toast('Guide sent to ' + plural(done, 'exhibitor', 'exhibitors') + (failed.length ? ', ' + failed.length + ' not sent' : ''), failed.length ? 'error' : 'success');
  }

  function wire() {
    host.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || !host.contains(b) || b.disabled) return;
      var act = b.getAttribute('data-act'), f = b.getAttribute('data-filter'), id = Number(b.getAttribute('data-id')) || 0;
      if (f) { filter = f; draw(); return; }
      if (act === 'reload') { load(); return; }
      if (act === 'bulk') { onBulk(); return; }
      if (act === 'preview') { open = open === id ? 0 : id; draw(); return; }
      if (act === 'send') { onSend(id); }
    });
    host.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'bld-q') {
        query = String(e.target.value || '').trim().toLowerCase();
        var pos = e.target.selectionStart;
        draw();
        var q = document.getElementById('bld-q');
        if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (err) {} }
      }
    });
    host.addEventListener('submit', async function (e) {
      var form = e.target.closest('.bld-test');
      if (!form) return;
      e.preventDefault();
      var to = form.querySelector('input').value;
      try { await opts.api.post('/api/admin/booth-leads/' + form.getAttribute('data-id') + '/guide/test', { to: to }); toast('Test sent to ' + to); }
      catch (err) { toast(err.message, 'error'); }
    });
  }

  w.LeadsDesk = {
    mount: async function (el, o) {
      opts = o || {};
      if (host !== el) { host = el; wire(); }
      await load();
    },
  };
})(window);
