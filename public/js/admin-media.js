/* Admin, Media & Influencer: pass requests from /media-pass (12 Nov 2026).
 *
 * Journalists and creators apply on /media-pass. Each request is an enquiry of type
 * 'media' with the answers in its metadata (MEDIA & INFLUENCER PASS in src/index.tsx);
 * a media enquiry from the contact page is listed too, with its words. This screen shows
 * one card per request, newest first: who they are, the pass they hold now, and the
 * qualifying answers laid out (platforms and followers, sample links, the plan). Approve
 * and issue pass gives a Media Pass or an Influencer Pass and emails the link to it; a
 * paid pass of their own is kept. Decline closes it, with a polite email if ticked.
 *
 * The admin page loads this file the first time the section opens and calls
 * MediaDesk.mount(element, { api, toast, operator, onCount }). One global, MediaDesk.
 * MediaDesk._t holds the parts that need no page, for the tests.
 */
(function (w) {
  'use strict';

  var TABS = [
    { key: 'new', label: 'Waiting' },
    { key: 'approved', label: 'Approved' },
    { key: 'declined', label: 'Declined' },
    { key: 'all', label: 'All' }
  ];
  var KINDS = [{ key: '', label: 'Everyone' }, { key: 'media', label: 'Media' }, { key: 'influencer', label: 'Influencers' }];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var IST_MS = 330 * 60000;
  var PAID = ['Delegate Pass', 'Premium Delegate Pass', 'VIP Pass', 'Academic Pass', 'Student Pass'];

  var S = { el: null, deps: null, tab: 'new', kind: '', rows: [], counts: {}, labels: { platforms: {}, formats: {}, kinds: {}, passes: {} }, error: '', loading: false, busy: {}, notes: {}, picks: {}, mail: {}, keep: {} };

  // ---------------------------------------------------------------- pure parts
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Only a web page is ever put in an href.
  function safeLink(u) {
    var v = String(u == null ? '' : u).trim();
    return /^https?:\/\/[^\s"'<>]+$/i.test(v) ? v : '';
  }
  // A handle typed as @name becomes the profile address where that is certain.
  function handleLink(platform, handle) {
    var h = String(handle == null ? '' : handle).trim();
    if (/^https?:\/\//i.test(h)) return safeLink(h);
    var n = h.replace(/^@/, '');
    if (!/^[A-Za-z0-9._-]{1,60}$/.test(n)) return '';
    if (platform === 'instagram') return 'https://www.instagram.com/' + n + '/';
    if (platform === 'youtube') return 'https://www.youtube.com/@' + n;
    if (platform === 'x') return 'https://x.com/' + n;
    return '';
  }
  function num(n) { return (Number(n) || 0).toLocaleString('en-IN'); }
  // "12 Nov, 10:30 am" in India. SQLite's "2026-11-12 05:00:00" is UTC.
  function fmtWhen(v) {
    var raw = String(v || '');
    if (!raw) return '';
    var iso = raw.indexOf('T') > 0 ? raw : raw.replace(' ', 'T') + 'Z';
    var ms = new Date(iso).getTime();
    if (isNaN(ms)) return '';
    var d = new Date(ms + IST_MS);
    var h = d.getUTCHours(), m = d.getUTCMinutes();
    var ap = h >= 12 ? 'pm' : 'am';
    h = h % 12; if (h === 0) h = 12;
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ', ' + h + ':' + (m < 10 ? '0' : '') + m + ' ' + ap;
  }
  // keep: requests decided in this sitting, which stay where they were (with what was
  // done and the resend button) until the tab changes or the list is read again.
  function visible(rows, tab, kind, keep) {
    return (rows || []).filter(function (r) {
      if (tab !== 'all' && r.state !== tab && !(keep && keep[r.id])) return false;
      if (kind && kindOf(r) !== kind) return false;
      return true;
    });
  }
  function kindOf(r) { return r.kind || (/influenc|creator|youtub|instagram/i.test(String(r.subject || '') + ' ' + String(r.message || '')) ? 'influencer' : 'media'); }
  function passName(kind) { return kind === 'influencer' ? 'Influencer Pass' : 'Media Pass'; }
  // The pass they hold now, in words.
  function passLine(r) {
    var a = r.attendee;
    if (!a) return 'Not registered yet. Approving registers them with the pass.';
    var b = a.badge_type || 'no pass';
    if (r.keeps_pass) return 'Holds a ' + b + (PAID.indexOf(b) >= 0 ? (a.payment_status === 'waived' ? ' (complimentary)' : ' (paid)') : '') + '. Approving keeps it.';
    if (a.unpaid) return 'Chose a ' + b + ' and has not paid. Approving gives the pass instead.';
    return 'Registered with a ' + b + '.';
  }
  function decisionLine(r) {
    var d = r.decision || {};
    var who = d.by ? ' by ' + d.by : '';
    var when = d.at ? ', ' + fmtWhen(d.at) : '';
    if (r.state === 'approved') {
      return 'Approved' + who + when + ': ' + (d.kept ? 'keeps their ' + (d.pass || 'pass') : (d.pass || 'pass') + ' issued') +
        (d.emailed === false ? '. The email did not go: press Email the pass link again.' : d.emailed ? ', the pass link emailed.' : '.');
    }
    if (r.state === 'declined') return 'Declined' + who + when + (d.emailed ? ', told by email.' : '.');
    return '';
  }
  function lines(text) { return esc(text).replace(/\n/g, '<br>'); }

  // ---------------------------------------------------------------- drawing
  function linkList(list) {
    var out = (list || []).map(function (u) {
      var href = safeLink(u);
      return href ? '<li><a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(u) + '</a></li>' : '<li>' + esc(u) + '</li>';
    }).join('');
    return out ? '<ul class="md-links">' + out + '</ul>' : '<span class="md-none">none</span>';
  }
  function row(label, html) { return html ? '<div class="md-q"><dt>' + esc(label) + '</dt><dd>' + html + '</dd></div>' : ''; }
  function platformsHtml(a) {
    var L = S.labels.platforms || {};
    var list = a.platforms || [];
    if (!list.length) return '';
    var total = 0;
    var body = list.map(function (p) {
      total += Number(p.followers) || 0;
      var word = p.platform === 'other' ? (p.name || 'Other') : (L[p.platform] || p.platform);
      var href = handleLink(p.platform, p.handle);
      var handle = href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(p.handle) + '</a>' : esc(p.handle);
      return '<tr><td>' + esc(word) + '</td><td class="md-h">' + handle + '</td><td class="md-n">' + num(p.followers) + '</td></tr>';
    }).join('');
    return '<div class="md-tablewrap"><table class="md-plat"><thead><tr><th>Platform</th><th>Handle or link</th><th class="md-n">Followers</th></tr></thead><tbody>' + body +
      (list.length > 1 ? '<tr class="md-total"><td>In all</td><td></td><td class="md-n">' + num(total) + '</td></tr>' : '') + '</tbody></table></div>';
  }
  function answersHtml(r) {
    var a = r.answers;
    if (!a) {
      return '<dl class="md-qs">' + row('Subject', esc(r.subject || '(none)')) + row('Their message', lines(r.message || '(empty)')) +
        '</dl><p class="md-hint">Sent from the contact page, so there are no qualifying answers. Choose the pass below.</p>';
    }
    var F = S.labels.formats || {};
    var h = '<dl class="md-qs">';
    if (r.kind === 'media') {
      h += row('Publication', esc(a.outlet)) + row('Covers', esc(a.beat)) + row('Recent work', linkList(a.work_links)) + row('Plans to cover', lines(a.coverage));
    } else {
      h += '</dl>' + platformsHtml(a) + '<dl class="md-qs">' +
        row('Topic', esc(a.niche)) + row('Audience', esc(a.audience)) +
        row('Will make', (a.formats || []).map(function (k) { return '<span class="md-chip">' + esc(F[k] || k) + '</span>'; }).join(' ')) +
        row('Before the event', a.before ? lines(a.before) : '') + row('During the event', a.during ? lines(a.during) : '') + row('After the event', a.after ? lines(a.after) : '') +
        row('Samples', linkList(a.samples)) + row('Brand work', a.collabs ? lines(a.collabs) : '');
    }
    return h + '</dl>';
  }
  function actionsHtml(r) {
    var id = r.id;
    if (r.state === 'approved') {
      var a = r.attendee;
      return '<div class="md-done">✓ ' + esc(decisionLine(r)) + '</div>' +
        (a ? '<div class="md-hint">' + (a.pass_downloaded_at ? 'Pass downloaded ' + esc(fmtWhen(a.pass_downloaded_at)) + '.' : 'Pass not downloaded yet.') +
          (a.last_login_at ? ' Last in the app ' + esc(fmtWhen(a.last_login_at)) + '.' : '') + '</div>' : '') +
        '<div class="md-row"><button type="button" class="md-btn" data-act="resend" data-id="' + id + '">Email the pass link again</button><span class="md-err" data-err="' + id + '"></span></div>';
    }
    var pick = S.picks[id] || kindOf(r);
    var note = S.notes[id] || '';
    var mail = Object.prototype.hasOwnProperty.call(S.mail, id) ? S.mail[id] : true;
    var keeps = r.keeps_pass;
    return (r.state === 'declined' ? '<div class="md-off">' + esc(decisionLine(r)) + '</div>' : '') +
      '<div class="md-act">' +
        '<label class="md-lab">Issue as<select data-pick="' + id + '"' + (keeps ? ' disabled' : '') + '>' +
          '<option value="media"' + (pick === 'media' ? ' selected' : '') + '>Media Pass</option>' +
          '<option value="influencer"' + (pick === 'influencer' ? ' selected' : '') + '>Influencer Pass</option></select></label>' +
        '<label class="md-lab md-grow">A note for them (optional, goes in the email)<textarea data-note="' + id + '" rows="2" maxlength="600">' + esc(note) + '</textarea></label>' +
      '</div>' +
      '<div class="md-row">' +
        '<button type="button" class="md-btn md-go" data-act="approve" data-id="' + id + '">' + (keeps ? 'Approve (they keep their ' + esc(keeps) + ')' : 'Approve and issue pass') + '</button>' +
        (r.state === 'declined' ? '' : '<button type="button" class="md-btn md-quiet" data-act="decline" data-id="' + id + '">Decline</button>') +
        '<label class="md-tick"><input type="checkbox" data-mail="' + id + '"' + (mail ? ' checked' : '') + '> Email them</label>' +
        '<span class="md-err" data-err="' + id + '"></span>' +
      '</div>';
  }
  function cardHtml(r) {
    var kind = kindOf(r);
    var K = S.labels.kinds || {};
    var a = r.answers || {};
    var contact = [
      r.email ? '<a href="mailto:' + esc(r.email) + '">' + esc(r.email) + '</a>' : '',
      r.phone ? '<a href="tel:' + esc(String(r.phone).replace(/[^\d+]/g, '')) + '">' + esc(r.phone) + '</a>' : '',
      a.designation ? esc(a.designation) : '', a.city ? esc(a.city) : ''
    ].filter(Boolean).join(' · ');
    var followers = r.kind === 'influencer' && a.followers_total ? '<span class="md-reach">' + num(a.followers_total) + ' followers</span>' : '';
    return '<article class="md-card" data-row="' + r.id + '" data-state="' + esc(r.state) + '" data-kind="' + esc(kind) + '">' +
      '<header class="md-top">' +
        '<span class="md-kind" data-kind="' + esc(kind) + '">' + esc(r.kind ? (K[r.kind] || r.kind) : (kind === 'influencer' ? 'Influencer?' : 'Media?')) + '</span>' +
        '<b class="md-name">' + esc(r.name) + '</b>' +
        (r.organization ? '<span class="md-org">' + esc(r.organization) + '</span>' : '') + followers +
        '<span class="md-when">' + esc(fmtWhen(r.created_at)) + ' · ' + esc(r.ref || ('#' + r.id)) + (r.assigned_to ? ' · ' + esc(r.assigned_to) : '') + '</span>' +
      '</header>' +
      (contact ? '<div class="md-contact">' + contact + '</div>' : '') +
      '<div class="md-pass' + (r.keeps_pass ? ' md-pass-keep' : '') + '">' + esc(passLine(r)) + '</div>' +
      answersHtml(r) +
      (r.admin_notes ? '<details class="md-notes"><summary>Team notes</summary><div>' + lines(r.admin_notes) + '</div></details>' : '') +
      '<footer class="md-foot">' + actionsHtml(r) + '</footer>' +
    '</article>';
  }
  function draw() {
    var el = S.el; if (!el) return;
    var list = visible(S.rows, S.tab, S.kind, S.keep);
    var h = '<div class="mdd"><div class="md-head">' +
      '<p>Requests from journalists and creators on <a href="/media-pass" target="_blank" rel="noopener">/media-pass</a>, newest first. Read the answers, then approve and issue the pass, or decline. They were told: we reply by email within 2 working days.</p>' +
      '<div class="md-tabs" role="tablist">' + TABS.map(function (t) {
        return '<button type="button" class="md-tab" role="tab" data-tab="' + t.key + '" aria-selected="' + (S.tab === t.key) + '">' + t.label + '<b>' + (Number(S.counts[t.key]) || 0) + '</b></button>';
      }).join('') + '</div>' +
      '<label class="md-filter">Show<select data-kindfilter="1">' + KINDS.map(function (k) {
        return '<option value="' + k.key + '"' + (S.kind === k.key ? ' selected' : '') + '>' + k.label + '</option>';
      }).join('') + '</select></label></div>';
    if (S.error) h += '<div class="md-empty md-err">' + esc(S.error) + ' <button type="button" class="md-btn" data-act="reload">Try again</button></div>';
    else if (S.loading && !S.rows.length) h += '<div class="md-empty">Loading…</div>';
    else if (!list.length) {
      h += '<div class="md-empty">' + (S.tab === 'new' ? 'Nothing is waiting. New requests from /media-pass appear here, and the team is emailed for each one.'
        : S.tab === 'approved' ? 'Nothing approved yet.' : S.tab === 'declined' ? 'Nothing declined.' : 'No requests yet.') + '</div>';
    }
    h += list.map(cardHtml).join('') + '</div>';
    el.innerHTML = h;
  }

  // ---------------------------------------------------------------- doing
  function api() { return S.deps.api; }
  // The admin page's toast() writes HTML, and these carry names from a public form.
  function say(msg, bad) { try { S.deps.toast(esc(msg), bad ? 'error' : 'success'); } catch (e) { /* no toast */ } }
  function rowOf(id) { for (var i = 0; i < S.rows.length; i++) if (String(S.rows[i].id) === String(id)) return S.rows[i]; return null; }
  function errText(err) { return (err && err.data && err.data.error) || (err && err.message) || 'That did not work. Try again.'; }
  function showErr(id, msg) { var e = S.el && S.el.querySelector('[data-err="' + id + '"]'); if (e) e.textContent = msg || ''; }
  function recount() {
    var c = { new: 0, approved: 0, declined: 0, all: S.rows.length };
    S.rows.forEach(function (r) { c[r.state] = (c[r.state] || 0) + 1; });
    S.counts = c;
    if (S.deps.onCount) S.deps.onCount(c.new);
  }
  async function load() {
    S.loading = true; S.error = ''; S.keep = {};
    draw();
    try {
      var r = await api().get('/api/admin/media-pass');
      if (!r || !r.ok) throw new Error((r && r.error) || 'The list could not be read.');
      S.rows = r.rows || []; S.labels = r.labels || S.labels;
      recount();
    } catch (err) { S.error = errText(err); }
    S.loading = false;
    draw();
  }
  function replaceRow(row) {
    if (!row) return;
    for (var i = 0; i < S.rows.length; i++) if (S.rows[i].id === row.id) S.rows[i] = row;
  }
  async function act(kind, id) {
    var r = rowOf(id);
    if (!r || S.busy[id]) return;
    var note = (S.el.querySelector('[data-note="' + id + '"]') || {}).value || '';
    var box = S.el.querySelector('[data-mail="' + id + '"]');
    var mail = box ? !!box.checked : true;
    var pickEl = S.el.querySelector('[data-pick="' + id + '"]');
    var pick = pickEl ? pickEl.value : kindOf(r);
    var question = kind === 'approve'
      ? (r.keeps_pass ? 'Approve ' + r.name + '? They keep their ' + r.keeps_pass + '.' : 'Approve ' + r.name + ' and issue a ' + passName(pick) + '?') +
        (mail ? ' We email them the link to their pass.' : ' No email is sent.')
      : kind === 'decline' ? 'Decline the request from ' + r.name + '?' + (mail ? ' We email them a short, polite no.' : ' No email is sent.')
      : 'Email ' + r.name + ' the link to their pass again?';
    if (w.confirm && !w.confirm(question)) return;
    S.busy[id] = 1;
    showErr(id, '');
    var btn = S.el.querySelector('[data-act="' + kind + '"][data-id="' + id + '"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Working…'; }
    try {
      var res;
      if (kind === 'approve') {
        res = await api().post('/api/admin/media-pass/' + id + '/approve', { kind: pick, note: note, email: mail });
        say(res.kept ? r.name + ' keeps their ' + res.pass + '. Request approved.' : res.pass + ' issued to ' + r.name + '.' + (mail ? (res.emailed ? ' The link is emailed.' : ' The email did not go: ' + (res.email_error || 'unknown reason')) : ''), mail && !res.emailed);
      } else if (kind === 'decline') {
        res = await api().post('/api/admin/media-pass/' + id + '/decline', { kind: pick, note: note, email: mail });
        say('Declined.' + (mail ? ' They are told by email.' : ''));
      } else {
        res = await api().post('/api/admin/media-pass/' + id + '/resend', {});
        say('The pass link is emailed again.');
      }
      delete S.notes[id];
      S.keep[id] = 1;
      replaceRow(res && res.row);
      recount();
      draw();
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = kind === 'approve' ? 'Approve and issue pass' : kind === 'decline' ? 'Decline' : 'Email the pass link again'; }
      showErr(id, errText(err));
      say(errText(err), true);
    } finally { delete S.busy[id]; }
  }
  function onClick(ev) {
    var t = ev.target.closest('[data-act],[data-tab]');
    if (!t || !S.el.contains(t)) return;
    if (t.hasAttribute('data-tab')) { S.tab = t.getAttribute('data-tab'); S.keep = {}; draw(); return; }
    var a = t.getAttribute('data-act'), id = t.getAttribute('data-id');
    if (a === 'reload') { load(); return; }
    if (a === 'approve' || a === 'decline' || a === 'resend') act(a, id);
  }
  function onInput(ev) {
    var t = ev.target;
    if (t.hasAttribute('data-note')) S.notes[t.getAttribute('data-note')] = t.value;
  }
  function onChange(ev) {
    var t = ev.target;
    if (t.hasAttribute('data-kindfilter')) { S.kind = t.value; draw(); return; }
    if (t.hasAttribute('data-pick')) { S.picks[t.getAttribute('data-pick')] = t.value; return; }
    if (t.hasAttribute('data-mail')) { S.mail[t.getAttribute('data-mail')] = t.checked; return; }
  }

  function mount(el, deps) {
    if (!el) return Promise.resolve();
    S.deps = deps || {};
    if (S.el !== el) {
      S.el = el;
      el.addEventListener('click', onClick);
      el.addEventListener('input', onInput);
      el.addEventListener('change', onChange);
    }
    return load();
  }

  w.MediaDesk = {
    mount: mount,
    _t: { esc: esc, safeLink: safeLink, handleLink: handleLink, num: num, fmtWhen: fmtWhen, visible: visible, kindOf: kindOf, passLine: passLine, decisionLine: decisionLine, cardHtml: cardHtml, S: S }
  };
})(window);
