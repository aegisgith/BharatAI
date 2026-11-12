/* Admin, Live Q&A (12 Nov 2026): every session of an event with its questions, and the
 * two links to hand out. The moderator's link opens /live on a phone (questions, most
 * votes first; answered, hide, show again). The hall link is the same with view=stage,
 * for the projector. One link per session, shared by whoever moderates it.
 *
 * The admin page loads this file the first time the section opens and calls
 * QaDesk.mount(element, { api, toast }). One global, QaDesk.
 */
(function (w) {
  'use strict';

  var opts = null;
  var host = null;
  var eventId = 1;
  var data = null;

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function toast(msg, type) { if (opts && opts.toast) opts.toast(esc(msg), type || 'success'); }
  function time(v) {
    var m = String(v || '').match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    if (!m) return '';
    var h = parseInt(m[4], 10);
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return parseInt(m[3], 10) + ' ' + months[parseInt(m[2], 10) - 1] + ', ' + ((h + 11) % 12 + 1) + ':' + m[5] + (h < 12 ? ' am' : ' pm');
  }
  function hall(s) { return s.venue_room && s.venue_room !== s.room ? s.room + ' (' + s.venue_room + ')' : s.room; }

  function draw() {
    var d = data || {};
    var list = d.sessions || [];
    var asked = list.reduce(function (n, s) { return n + s.live + s.answered + s.hidden; }, 0);
    var head = '<div class="aqd-head"><h2><i class="fas fa-comments" aria-hidden="true"></i> Questions from the room</h2>'
      + '<p>Attendees ask and vote in the app, under each session&rsquo;s <b>Questions</b> button. Send each session&rsquo;s moderator its link (WhatsApp is fine): it opens on a phone with the questions, most votes first, and they mark each one answered or hide it. Open the hall link on the projector if the room should see the top questions; it shows no names.</p>'
      + '<div class="aqd-bar"><label for="aqd-event">Event</label><select id="aqd-event"><option value="1"' + (eventId === 1 ? ' selected' : '') + '>Mumbai, 20&ndash;21 Nov 2026</option><option value="2"' + (eventId === 2 ? ' selected' : '') + '>Delhi, 28&ndash;29 Jul 2027</option></select>'
      + '<span class="aqd-note">' + list.length + ' sessions &middot; ' + asked + ' questions asked</span></div></div>';
    var warn = d.ready === false ? '<p class="aqd-warn">The questions tables are not in the database yet. Apply migration 0060 first; until then the app says questions open shortly.</p>' : '';
    if (!list.length) return host.innerHTML = '<div class="aqd">' + head + warn + '<p class="aqd-note">No sessions for this event yet.</p></div>';
    var rows = list.map(function (s) {
      return '<tr><td class="aqd-nowrap">' + esc(time(s.start_time)) + '</td><td>' + esc(hall(s)) + '</td><td><b>' + esc(s.title) + '</b></td>'
        + '<td class="aqd-n">' + s.live + '</td><td class="aqd-n">' + s.answered + '</td><td class="aqd-nowrap aqd-sub">' + esc(s.last_at || '') + '</td>'
        + '<td class="aqd-acts"><button type="button" class="aqd-btn" data-copy="' + esc(s.moderator_url) + '" data-label="moderator link for ' + esc(s.title) + '"><i class="fas fa-link" aria-hidden="true"></i> Copy moderator link</button>'
        + '<a class="aqd-btn" href="' + esc(s.moderator_url) + '" target="_blank" rel="noopener">Open</a>'
        + '<a class="aqd-btn" href="' + esc(s.stage_url) + '" target="_blank" rel="noopener">Hall screen</a></td></tr>';
    }).join('');
    host.innerHTML = '<div class="aqd">' + head + warn
      + '<div class="aqd-wrap"><table class="aqd-table"><thead><tr><th>When</th><th>Hall</th><th>Session</th><th class="aqd-n">Waiting</th><th class="aqd-n">Answered</th><th>Last asked</th><th><span class="aqd-sr">Links</span></th></tr></thead><tbody>'
      + rows + '</tbody></table></div></div>';
  }

  async function copy(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied the ' + label + '.');
    } catch (e) {
      w.prompt('Copy the ' + label + ':', text);
    }
  }

  async function refresh() {
    try {
      data = await opts.api.get('/api/admin/session-questions?event=' + eventId);
    } catch (e) {
      data = { sessions: [] };
      toast('The sessions did not load: ' + (e.message || ''), 'error');
    }
    draw();
  }

  function onClick(e) {
    var b = e.target.closest('[data-copy]');
    if (b && host.contains(b)) copy(b.getAttribute('data-copy'), b.getAttribute('data-label') || 'link');
  }
  function onChange(e) {
    if (e.target && e.target.id === 'aqd-event') { eventId = parseInt(e.target.value, 10) || 1; refresh(); }
  }

  async function mount(el, o) {
    opts = o;
    if (host !== el) {
      host = el;
      host.addEventListener('click', onClick);
      host.addEventListener('change', onChange);
    }
    if (!host.querySelector('.aqd')) host.innerHTML = '<div class="aqd"><p class="aqd-note">Loading...</p></div>';
    await refresh();
  }

  w.QaDesk = { mount: mount, _t: { esc: esc, time: time } };
})(window);
