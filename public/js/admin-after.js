/* Admin, After the Event (12 Nov 2026): the feedback survey and each exhibitor's results.
 *
 * Survey: preview the email, send a test, send it to everyone who checked in (a bulk
 * run of kind 'feedback', which skips anyone who has already answered), then read the
 * answers: the recommend score, the counts, who would come to Delhi, the one thing
 * each would fix, and a CSV of everything.
 * Exhibitor results: each exhibitor's badges scanned, meetings and app visits, a
 * preview, and one email per exhibitor to its booth contact, sent once unless sent
 * again on purpose.
 *
 * The admin page loads this file the first time the section opens and calls
 * AfterDesk.mount(element, { api, toast, startCampaign, authHeaders }).
 * One global, AfterDesk.
 */
(function (w) {
  'use strict';

  var opts = null;
  var host = null;
  var survey = null;
  var exhibitors = [];
  var busy = false;

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function num(n) { return Number(n || 0).toLocaleString('en-IN'); }
  function toast(msg, type) { if (opts && opts.toast) opts.toast(esc(msg), type || 'success'); }
  function hasStuff(r) { return (r.scanned + r.meetings + r.visits) > 0; }
  function emailOk(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '')); }

  function bars(list, total) {
    return '<div class="afd-bars">' + list.map(function (x) {
      var pct = total ? Math.round((x.n / total) * 100) : 0;
      return '<div class="afd-bar"><span class="afd-bar-label">' + esc(x.label) + '</span>'
        + '<span class="afd-bar-track"><span class="afd-bar-fill" style="width:' + pct + '%"></span></span>'
        + '<span class="afd-bar-n">' + num(x.n) + '</span></div>';
    }).join('') + '</div>';
  }

  function scoreWords(s) {
    if (s === null || s === undefined) return '';
    if (s >= 50) return 'excellent';
    if (s >= 20) return 'good';
    if (s >= 0) return 'fair';
    return 'needs work';
  }

  function surveyHtml() {
    var s = survey || {};
    var head = '<div class="afd-card-head"><h2><i class="fas fa-comments" aria-hidden="true"></i> Feedback survey</h2>'
      + '<p>Six questions, about two minutes. Send it on the evening of 21 Nov to everyone who checked in. Anyone who has already answered is skipped.</p></div>';
    var notReady = s.ready === false
      ? '<p class="afd-warn">The answers table is not in the database yet. Apply migration 0057 first; until then the survey page cannot save answers. You can still preview the email.</p>' : '';
    var came = Number(s.came || 0);
    var runs = (s.campaigns || []).map(function (k) {
      var st = k.status === 'done' ? 'finished' : k.status === 'paused' ? 'paused' : 'sending';
      return '<li>Run ' + esc(k.id) + ': ' + num(k.sent) + ' of ' + num(k.total) + ' sent' + (k.failed ? ', ' + num(k.failed) + ' failed' : '') + ' (' + st + ')</li>';
    }).join('');
    var rec = s.recommend || {};
    var stats = '<div class="afd-stats">'
      + '<div><b>' + num(came) + '</b><span>checked in</span></div>'
      + '<div><b>' + num(s.answered) + '</b><span>answered</span></div>'
      + '<div><b>' + (rec.score === null || rec.score === undefined ? '&ndash;' : esc(rec.score)) + '</b><span>recommend score' + (rec.score === null || rec.score === undefined ? '' : ', ' + esc(scoreWords(rec.score))) + '</span></div>'
      + '<div><b>' + (rec.average === null || rec.average === undefined ? '&ndash;' : esc(rec.average)) + '</b><span>average out of 10</span></div>'
      + '</div>';
    var actions = '<div class="afd-actions">'
      + '<button type="button" class="afd-btn" data-act="preview-survey"><i class="fas fa-eye" aria-hidden="true"></i> Preview the email</button>'
      + '<span class="afd-test"><label class="afd-sr" for="afd-test-to">Send a test to</label><input id="afd-test-to" type="email" placeholder="your@email" autocomplete="email">'
      + '<button type="button" class="afd-btn" data-act="test-survey">Send a test</button></span>'
      + '<button type="button" class="afd-btn afd-primary" data-act="send-survey"' + (came && s.ready !== false ? '' : ' disabled') + '>'
      + '<i class="fas fa-paper-plane" aria-hidden="true"></i> Send to everyone who checked in (' + num(came) + ')</button>'
      + '</div>'
      + (came ? '' : '<p class="afd-note">Nobody has checked in yet, so there is nobody to send it to.</p>')
      + (runs ? '<ul class="afd-runs">' + runs + '</ul><p class="afd-note">Keep this tab open while it sends; the server also sends one a minute if the tab is closed.</p>' : '');

    var results = '';
    if (s.ready && s.answered) {
      var by = rec.by || [];
      var max = Math.max.apply(null, by.concat([1]));
      var scale = '<div class="afd-scale" aria-label="Answers from 0 to 10">' + by.map(function (n, i) {
        var cls = i >= 9 ? 'pro' : i >= 7 ? 'pas' : 'det';
        return '<div class="afd-col"><span class="afd-col-n">' + num(n) + '</span><span class="afd-col-bar ' + cls + '" style="height:' + Math.round((n / max) * 60) + 'px"></span><span class="afd-col-i">' + i + '</span></div>';
      }).join('') + '</div>'
        + '<p class="afd-note">Score = people who gave 9 or 10 (' + num(rec.promoters) + ') minus people who gave 0 to 6 (' + num(rec.detractors) + '), as a share of everyone who answered.</p>';
      var delhi = (s.delhi_people || []);
      var comments = (s.comments || []);
      results = '<div class="afd-results">'
        + '<h3>How likely to recommend</h3>' + scale
        + '<div class="afd-grid2">'
        + '<div><h3>Most useful</h3>' + bars(s.useful || [], s.answered) + '</div>'
        + '<div><h3>Met someone to follow up</h3>' + bars(s.met || [], s.answered) + '</div>'
        + '<div><h3>Getting in and finding the way</h3>' + bars(s.entry || [], s.answered) + '</div>'
        + '<div><h3>Coming to Delhi 2027</h3>' + bars(s.delhi || [], s.answered) + '</div>'
        + '</div>'
        + '<h3>Said yes or maybe to Delhi (' + num(delhi.length) + ')</h3>'
        + (delhi.length ? '<div class="afd-table-wrap"><table class="afd-table"><thead><tr><th>Name</th><th>Organisation</th><th>Email</th><th>Delhi</th></tr></thead><tbody>'
          + delhi.map(function (p) { return '<tr><td>' + esc(p.name) + '<div class="afd-sub">' + esc(p.job_title) + '</div></td><td>' + esc(p.company) + '</td><td>' + esc(p.email) + '</td><td>' + (p.delhi === 'yes' ? 'Yes' : 'Maybe') + '</td></tr>'; }).join('')
          + '</tbody></table></div>' : '<p class="afd-note">Nobody yet.</p>')
        + '<h3>One thing to fix (' + num(comments.length) + ')</h3>'
        + (comments.length ? '<ul class="afd-comments">' + comments.map(function (x) {
          return '<li><p>' + esc(x.fix) + '</p><span>' + esc(x.name) + (x.company ? ', ' + esc(x.company) : '') + ' &middot; gave ' + esc(x.recommend) + '</span></li>';
        }).join('') + '</ul>' : '<p class="afd-note">No suggestions yet.</p>')
        + '<button type="button" class="afd-btn" data-act="csv"><i class="fas fa-download" aria-hidden="true"></i> Download all answers (CSV)</button>'
        + '</div>';
    } else if (s.ready) {
      results = '<p class="afd-note">No answers yet. They appear here as people send them.</p>';
    }
    return '<section class="afd-card">' + head + notReady + stats + actions + results + '</section>';
  }

  function exhibitorsHtml() {
    var ready = exhibitors.filter(function (r) { return !r.sent_count && emailOk(r.email) && hasStuff(r); });
    var head = '<div class="afd-card-head"><h2><i class="fas fa-handshake" aria-hidden="true"></i> Exhibitor results</h2>'
      + '<p>One email per exhibitor to its booth contact, from register@: badges scanned, meetings held, a link to its leads, and Delhi 2027. Send it after the doors close on 21 Nov.</p></div>';
    var actions = '<div class="afd-actions"><button type="button" class="afd-btn afd-primary" data-act="send-all-ex"' + (ready.length ? '' : ' disabled') + '>'
      + '<i class="fas fa-paper-plane" aria-hidden="true"></i> Send to all not yet sent (' + num(ready.length) + ')</button>'
      + '<span class="afd-note" id="afd-ex-progress" aria-live="polite"></span></div>'
      + '<p class="afd-note">"Send to all" leaves out exhibitors with nothing recorded and those without a contact email. You can still send to them one by one.</p>';
    if (!exhibitors.length) return '<section class="afd-card">' + head + '<p class="afd-note">No exhibitors for this event.</p></section>';
    var rows = exhibitors.map(function (r) {
      var rated = [r.hot ? r.hot + ' hot' : '', r.warm ? r.warm + ' warm' : '', r.cold ? r.cold + ' cold' : ''].filter(Boolean).join(', ');
      var contact = emailOk(r.email) ? esc(r.contact_name || '') + '<div class="afd-sub">' + esc(r.email) + '</div>' : '<span class="afd-bad">No contact email</span>';
      var sent = r.sent_count ? '<span class="afd-ok">Sent ' + esc(r.sent_at) + '</span>' + (r.sent_count > 1 ? '<div class="afd-sub">' + num(r.sent_count) + ' times</div>' : '') : (hasStuff(r) ? 'Not yet' : '<span class="afd-sub">Nothing recorded</span>');
      return '<tr data-id="' + esc(r.id) + '"><td><b>' + esc(r.company) + '</b>' + (r.booth ? '<div class="afd-sub">Stand ' + esc(r.booth) + '</div>' : '') + '</td>'
        + '<td>' + contact + '</td>'
        + '<td class="afd-n">' + num(r.scanned) + (rated ? '<div class="afd-sub">' + esc(rated) + '</div>' : '') + '</td>'
        + '<td class="afd-n">' + num(r.meetings) + '</td><td class="afd-n">' + num(r.visits) + '</td>'
        + '<td>' + sent + '</td>'
        + '<td class="afd-row-actions"><button type="button" class="afd-btn afd-small" data-act="preview-ex" data-id="' + esc(r.id) + '">Preview</button>'
        + '<button type="button" class="afd-btn afd-small" data-act="send-ex" data-id="' + esc(r.id) + '"' + (emailOk(r.email) ? '' : ' disabled') + '>' + (r.sent_count ? 'Send again' : 'Send') + '</button></td></tr>';
    }).join('');
    return '<section class="afd-card">' + head + actions
      + '<div class="afd-table-wrap"><table class="afd-table"><thead><tr><th>Exhibitor</th><th>Booth contact</th><th class="afd-n">Badges scanned</th><th class="afd-n">Meetings</th><th class="afd-n">App visits</th><th>Results email</th><th><span class="afd-sr">Actions</span></th></tr></thead><tbody>'
      + rows + '</tbody></table></div></section>';
  }

  function draw() {
    host.innerHTML = '<div class="afd">' + surveyHtml() + exhibitorsHtml() + '</div>';
  }

  function preview(title, to, subject, html) {
    var old = document.getElementById('afd-preview');
    if (old) old.remove();
    var box = document.createElement('div');
    box.id = 'afd-preview';
    box.className = 'afd-modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', title);
    box.innerHTML = '<div class="afd-modal-card"><div class="afd-modal-head"><div><b>' + esc(title) + '</b>'
      + (to ? '<div class="afd-sub">To: ' + esc(to) + '</div>' : '') + '<div class="afd-sub">Subject: ' + esc(subject) + '</div></div>'
      + '<button type="button" class="afd-btn afd-small" data-close>Close</button></div><iframe title="Email preview" sandbox=""></iframe></div>';
    document.body.appendChild(box);
    box.querySelector('iframe').srcdoc = html;
    var close = function () { box.remove(); document.removeEventListener('keydown', onKey); };
    var onKey = function (e) { if (e.key === 'Escape') close(); };
    box.addEventListener('click', function (e) { if (e.target === box || e.target.hasAttribute('data-close')) close(); });
    document.addEventListener('keydown', onKey);
    box.querySelector('[data-close]').focus();
  }

  async function sendOne(id, again) {
    return opts.api.post('/api/admin/exhibitor-results/' + encodeURIComponent(id) + '/send', { again: !!again });
  }

  async function onClick(e) {
    var b = e.target.closest('[data-act]');
    if (!b || !host.contains(b) || b.disabled || busy) return;
    var act = b.getAttribute('data-act');
    var id = b.getAttribute('data-id');
    try {
      if (act === 'preview-survey') {
        var p = await opts.api.get('/api/admin/feedback/preview');
        preview('Feedback survey email', '', p.subject, p.html);
      } else if (act === 'test-survey') {
        var to = (document.getElementById('afd-test-to').value || '').trim();
        if (!emailOk(to)) { toast('Type the email address to send the test to.', 'error'); return; }
        busy = true; b.disabled = true;
        await opts.api.post('/api/admin/feedback/test', { to: to });
        toast('Test sent to ' + to + '.');
      } else if (act === 'send-survey') {
        var n = Number((survey && survey.came) || 0);
        if (!w.confirm('Send the feedback survey to everyone who checked in? That is up to ' + n.toLocaleString('en-IN') + ' people, one email each. Anyone who has already answered is skipped.')) return;
        await opts.startCampaign('feedback', { audience: 'checked_in', title: 'Feedback survey' });
        await refresh();
      } else if (act === 'csv') {
        var res = await fetch('/api/admin/feedback.csv', { headers: opts.authHeaders() });
        if (!res.ok) { var j = await res.json().catch(function () { return {}; }); throw new Error(j.error || 'The download did not work.'); }
        var blob = await res.blob();
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'feedback-bharat-ai-innovation-2026.csv';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      } else if (act === 'preview-ex') {
        var q = await opts.api.get('/api/admin/exhibitor-results/' + encodeURIComponent(id) + '/preview');
        preview('Results email', q.to, q.subject, q.html);
      } else if (act === 'send-ex') {
        var r = exhibitors.find(function (x) { return String(x.id) === String(id); });
        if (!r) return;
        var again = !!r.sent_count;
        var words = again
          ? 'Send the results email to ' + r.company + ' again, to ' + r.email + '? It was sent on ' + r.sent_at + '.'
          : 'Send the results email to ' + r.company + ', to ' + r.email + '?' + (hasStuff(r) ? '' : ' Nothing is recorded for them, so it will show zeros.');
        if (!w.confirm(words)) return;
        busy = true; b.disabled = true;
        await sendOne(r.id, again);
        toast('Results sent to ' + r.company + '.');
        await refresh();
      } else if (act === 'send-all-ex') {
        var list = exhibitors.filter(function (x) { return !x.sent_count && emailOk(x.email) && hasStuff(x); });
        if (!list.length) return;
        if (!w.confirm('Send the results email to ' + list.length + ' exhibitors, one email each to their booth contact? Exhibitors already sent, with nothing recorded, or without a contact email are left out.')) return;
        busy = true; b.disabled = true;
        var ok = 0, failed = [];
        for (var i = 0; i < list.length; i++) {
          var prog = document.getElementById('afd-ex-progress');
          if (prog) prog.textContent = 'Sending ' + (i + 1) + ' of ' + list.length + '...';
          try { await sendOne(list[i].id, false); ok++; }
          catch (err) { if (!(err && err.data && err.data.already)) failed.push(list[i].company + ': ' + (err.message || 'failed')); }
        }
        toast(ok + ' sent' + (failed.length ? ', ' + failed.length + ' did not send: ' + failed.slice(0, 3).join('; ') : '.'), failed.length ? 'error' : 'success');
        await refresh();
      }
    } catch (err) {
      toast((err && err.message) || 'That did not work. Please try again.', 'error');
    } finally {
      busy = false;
      if (b.isConnected) b.disabled = false;
    }
  }

  async function refresh() {
    var out = await Promise.all([
      opts.api.get('/api/admin/feedback/summary').catch(function (e) { return { error: e.message }; }),
      opts.api.get('/api/admin/exhibitor-results').catch(function (e) { return { error: e.message, results: [] }; })
    ]);
    survey = out[0] || {};
    exhibitors = (out[1] && out[1].results) || [];
    draw();
    if (out[0] && out[0].error) toast('The survey numbers did not load: ' + out[0].error, 'error');
    if (out[1] && out[1].error) toast('The exhibitor numbers did not load: ' + out[1].error, 'error');
  }

  async function mount(el, o) {
    opts = o;
    if (host !== el) {
      host = el;
      host.addEventListener('click', onClick);
    }
    if (!host.querySelector('.afd')) host.innerHTML = '<div class="afd"><p class="afd-note">Loading...</p></div>';
    await refresh();
  }

  w.AfterDesk = { mount: mount, _t: { esc: esc, scoreWords: scoreWords, hasStuff: hasStuff } };
})(window);
