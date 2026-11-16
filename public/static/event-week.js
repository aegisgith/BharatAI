/* The event-week email (16 Nov 2026): Admin -> Overview -> Notification Status ->
 * "Get ready for 20 and 21 Nov".
 *
 * One email per person with a checklist (photo and details, the pass on the phone, the
 * LinkedIn badge, the app, meetings), each step a button that signs them in; the body
 * follows the pass they hold. Sent as a bulk run (campaign kind event_week) to one of
 * four audiences: paid passes and exhibitors, exhibitors only, the free passes, or
 * everyone. The strip shows who has not had it yet, the open run, and what came of it.
 *
 * The server side is src/routes/event-week.ts. Loaded before /admin.js; uses its globals
 * api, toast, openModal, closeModal, startCampaign, pauseCampaignFromList and
 * resumeCampaign at click time. The Overview is redrawn as one innerHTML, so the strip
 * draws itself whenever its #eventweek-strip appears (a MutationObserver), and nothing
 * in /admin.js has to call it. Buttons carry data-ew="<action>"; one listener per strip
 * or modal runs them, so no name is written into an onclick string. */
(function (global) {
  'use strict';

  var S = { d: null, audience: 'passes', kind: '', campaign: null, pv: null, loading: false };
  var AUD_ORDER = ['passes', 'exhibitors', 'free', 'all'];
  var AUD_WORD = { passes: 'Paid passes and exhibitors', exhibitors: 'Exhibitors only', free: 'Free Visitor Pass', all: 'Everyone' };
  var KIND_ORDER = ['exhibitor', 'paid', 'expo', 'unpaid', 'free', 'waitlisted'];

  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function $(id) { return document.getElementById(id); }
  function say(msg, kind) { if (typeof toast === 'function') toast(esc(msg), kind || 'success'); }
  function errText(e) { return (e && e.message && e.message !== 'unauthorized') ? e.message : 'That did not work. Try again.'; }
  function btn(action, label, solid, extra) {
    return '<button type="button" data-ew="' + action + '"' + (extra || '') + ' class="px-3 py-1.5 rounded-lg text-xs ' +
      (solid ? 'font-semibold bg-primary-700 text-white on-dark hover:bg-primary-800' : 'font-medium border border-white/10 text-gray-300 hover:bg-white/5') + '">' + label + '</button>';
  }

  // ---------- the strip on the Overview card ----------
  async function load() {
    var el = $('eventweek-strip'); if (!el || S.loading) return;
    S.loading = true;
    try {
      S.d = await api.get('/api/admin/event-week/status');
      if (S.d && S.d.error) throw new Error(S.d.error);
    } catch (e) {
      S.d = null;
      el.innerHTML = '<p class="text-[11px] text-gray-500 mt-3">The event-week email could not be loaded: ' + esc(errText(e)) + '</p>';
      S.loading = false; return;
    } finally { S.loading = false; }
    draw();
  }
  function draw() {
    var el = $('eventweek-strip'); if (!el) return;
    var d = S.d; if (!d || d.unavailable) { el.innerHTML = ''; return; }
    el.setAttribute('data-drawn', '1');
    var run = d.open_run, left = d.left || {}, k = d.kinds || {}, m = d.stats || {};
    var state;
    if (run) {
      state = '<span class="text-amber-300">A run is ' + esc(run.status) + '</span>: ' + run.sent + ' of ' + run.total + ' sent' + (run.failed ? ', ' + run.failed + ' failed' : '') + ' (' + esc(run.title || '') + ').';
    } else if (!left.all) {
      state = m.sent ? 'Everyone with an email address has had it.' : 'Nobody has had it yet, and nobody is waiting for it.';
    } else {
      state = (d.days ? '<span class="text-white font-semibold">' + esc(d.days) + '.</span> ' : '') + left.all + ' have not had it: ' +
        left.passes + ' on a paid or given pass' + (k.exhibitor ? ' (' + k.exhibitor + ' exhibitors)' : '') + ', ' + left.free + ' on a free pass' +
        (k.waitlisted ? ' (' + k.waitlisted + ' on the waiting list)' : '') + (k.unpaid ? ', ' + k.unpaid + ' who chose a paid pass and have not paid' : '') + '.';
    }
    var buttons = run
      ? btn('preview-run', 'Preview') + (run.status === 'running' ? btn('pause', 'Pause', true) : btn('resume', 'Resume', true))
      : (left.all ? btn('choose', 'Preview &amp; send', true) : '');
    el.innerHTML = '<div class="mt-4 pt-3 border-t border-white/10">' +
      '<div class="flex items-center justify-between gap-3 flex-wrap mb-2">' +
        '<div><h4 class="text-xs font-semibold text-gray-200"><i class="fas fa-calendar-check text-primary-400 mr-1.5"></i>&ldquo;Get ready for 20 and 21 Nov&rdquo; email</h4>' +
        '<p class="text-[11px] mt-0.5 text-gray-400">' + state + '</p></div>' +
        '<div class="flex gap-1.5">' + buttons + '</div></div>' +
      funnel(m) + '</div>';
    wire(el);
  }
  function funnel(m) {
    if (!m || !m.sent) return '';
    var row = function (label, n, of, tip) {
      var pct = of ? Math.round(n * 100 / of) : 0;
      return '<div class="flex items-center gap-2 text-xs" title="' + esc(tip) + '">' +
        '<span class="w-40 shrink-0 text-gray-400">' + label + '</span>' +
        '<div class="flex-1 h-2 bg-white/5 rounded-full overflow-hidden"><div class="h-full rounded-full bg-primary-500/60" style="width:' + pct + '%"></div></div>' +
        '<span class="w-24 text-right whitespace-nowrap font-semibold text-white">' + n + ' <span class="font-normal text-gray-500">of ' + of + '</span></span>' +
        '<span class="w-9 text-right text-gray-500">' + (of ? pct + '%' : '') + '</span></div>';
    };
    return '<div class="space-y-1.5">' +
      row('Opened the email', m.opened, m.tracked, 'A click counts as an open. Opens are approximate.') +
      row('Clicked into the app', m.clicked, m.tracked, "Counted when the app opens from one of the email's buttons.") +
      row('Downloaded their pass after', m.pass_after, m.sent, 'Downloaded the pass after their email went.') +
      row('Made their badge after', m.shared_after, m.sent, 'Made the LinkedIn badge after their email went.') +
      row('Asked to connect or meet', m.asked, m.sent, 'Sent a connection or meeting request after their email went.') +
      '</div>';
  }

  // ---------- the preview, then Send ----------
  async function openPreview(audience, kind, campaign) {
    S.audience = audience || S.audience; S.kind = kind || ''; S.campaign = campaign || null;
    openModal('<div class="py-10 text-center text-gray-400"><i class="fas fa-spinner fa-spin"></i></div>');
    var d;
    try {
      d = await api.get('/api/admin/event-week/preview?' + (S.campaign ? 'campaign=' + encodeURIComponent(S.campaign) : 'audience=' + encodeURIComponent(S.audience)) + (S.kind ? '&kind=' + encodeURIComponent(S.kind) : ''));
      if (d && d.error) throw new Error(d.error);
    } catch (e) {
      openModal('<p class="text-sm text-red-400">Could not build the preview: ' + esc(errText(e)) + '</p>'); return;
    }
    S.pv = d;
    var cnt = d.counts || {}, total = cnt.total || 0, left = (S.d && S.d.left) || {};
    var run = S.campaign && S.d && S.d.open_run && S.d.open_run.id === S.campaign ? S.d.open_run : null;
    var who = S.campaign ? '' : '<p class="text-xs text-gray-400 mb-2">Who gets it:</p><div class="flex gap-1.5 flex-wrap mb-3">' + AUD_ORDER.map(function (a) {
      var n = left[a] == null ? '' : ' (' + left[a] + ')', on = d.audience === a;
      return '<button type="button" data-ew="audience" data-aud="' + a + '"' + (left[a] === 0 ? ' disabled' : '') +
        ' class="px-3 py-1.5 rounded-lg text-xs font-semibold ' + (on ? 'bg-primary-600 text-white' : 'border border-white/10 text-gray-300 hover:bg-white/5') + (left[a] === 0 ? ' opacity-40' : '') + '">' + esc(AUD_WORD[a]) + n + '</button>';
    }).join('') + '</div>';
    var kinds = '<p class="text-xs text-gray-400 mb-3">' + (S.campaign ? (run && run.status === 'done' ? total + ' were on this run' : total + ' still to send on this run') : total + ' ' + (total === 1 ? 'person' : 'people') + ' in this run') +
      '. The email follows the pass each person holds; read each kind:</p>' +
      '<div class="flex gap-1.5 flex-wrap mb-3">' + KIND_ORDER.filter(function (x) { return cnt[x]; }).map(function (x) {
        var on = d.kind === x;
        return '<button type="button" data-ew="kind" data-kind="' + x + '" class="px-3 py-1.5 rounded-lg text-xs font-semibold ' + (on ? 'bg-amber-600 text-white' : 'border border-white/10 text-gray-300 hover:bg-white/5') + '">' +
          esc((d.kind_words || {})[x] || x) + ' (' + cnt[x] + ')</button>';
      }).join('') + '</div>';
    var body = d.sample
      ? '<p class="text-xs text-gray-400 mb-1">As ' + esc(d.sample.name) + ' (' + esc(d.sample.badge_type) + ') will get it. The buttons are not live in this preview.</p>' +
        '<p class="text-sm font-semibold text-white mb-2">Subject: ' + esc(d.subject) + '</p>' +
        '<iframe id="ew-prev-frame" sandbox="" title="Email preview" class="w-full rounded-xl bg-white" style="height:58vh;border:1px solid rgba(0,0,0,0.1);"></iframe>'
      : '<p class="text-sm text-gray-400 py-8 text-center">Nobody in this run holds that kind of pass.</p>';
    var act = S.campaign ? (run && run.status === 'running' ? 'Pause this run' : run && run.status === 'paused' ? 'Resume: send to ' + total : '')
      : 'Send to ' + total + ' ' + (total === 1 ? 'person' : 'people');
    openModal('<h3 class="text-lg font-bold mb-1"><i class="fas fa-calendar-check text-primary-400 mr-2"></i>' +
      (S.campaign ? esc((run && run.title) || d.title || 'Get ready for 20 and 21 Nov') + ': what it sends' : '&ldquo;Get ready for 20 and 21 Nov&rdquo;: check it before it goes') + '</h3>' +
      who + kinds + body +
      '<div class="flex gap-2 mt-4">' +
        '<button type="button" data-ew="close" class="flex-1 py-2.5 rounded-xl text-sm glass hover:bg-white/10">' + (act ? 'Cancel' : 'Close') + '</button>' +
        (act ? '<button type="button" data-ew="go"' + (total ? '' : ' disabled') + ' class="flex-1 py-2.5 rounded-xl text-sm bg-amber-600 hover:bg-amber-500 text-white font-semibold' + (total ? '' : ' opacity-40') + '">' + act + '</button>' : '') +
      '</div>' +
      (!act || (run && run.status === 'running') ? '' : '<p class="text-[11px] text-gray-500 mt-2">It goes ' + esc(d.window || '9am to 9pm IST') +
        ': the tab sends while this page is open, and the server&rsquo;s clock sends ten a minute when it is not, so a few thousand go in a day. Exhibitors and paid passes go first. Nobody is sent it twice.</p>'));
    var f = $('ew-prev-frame'); if (f) f.srcdoc = d.html;
    wire($('modal-box'));
  }
  async function go() {
    var run = S.campaign && S.d && S.d.open_run && S.d.open_run.id === S.campaign ? S.d.open_run : null;
    closeModal();
    if (S.campaign) {
      if (run && run.status === 'running') await pauseCampaignFromList(S.campaign);
      else if (run) await resumeCampaign(S.campaign);
    } else {
      await startCampaign('event_week', { audience: S.audience, title: (S.pv && S.pv.title) || 'Get ready for 20 and 21 Nov' });
    }
    load();
  }

  // ---------- buttons ----------
  function wire(root) {
    if (!root || root.getAttribute('data-ew-wired')) return;
    root.setAttribute('data-ew-wired', '1');
    root.addEventListener('click', async function (ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest('[data-ew]') : null;
      if (!b || !root.contains(b)) return;
      var a = b.getAttribute('data-ew'), run = S.d && S.d.open_run;
      if (a === 'choose') return openPreview('passes', '', null);
      if (a === 'preview-run' && run) return openPreview(null, '', run.id);
      if (a === 'pause' && run) { await pauseCampaignFromList(run.id); return load(); }
      if (a === 'resume' && run) { await resumeCampaign(run.id); return load(); }
      if (a === 'audience') return openPreview(b.getAttribute('data-aud'), '', null);
      if (a === 'kind') return openPreview(S.campaign ? null : S.audience, b.getAttribute('data-kind'), S.campaign);
      if (a === 'close') return closeModal();
      if (a === 'go') return go();
    });
  }

  // The Overview is one innerHTML: draw whenever the strip's element appears.
  function watch() {
    var seen = function () { var el = $('eventweek-strip'); if (el && !el.getAttribute('data-drawn') && !S.loading && typeof api !== 'undefined') load(); };
    try { new MutationObserver(seen).observe(document.documentElement, { childList: true, subtree: true }); } catch (e) { /* no observer: the button still works */ }
    seen();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();

  global.EventWeek = { load: load, openPreview: openPreview };
})(window);
