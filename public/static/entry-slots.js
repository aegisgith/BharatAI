/* Entry times for the Free Visitor Pass (17 Nov 2026): Admin -> Overview -> Notification
 * Status, under the "Get ready" email strip.
 *
 * Every free pass holder gets one entry time (Friday morning for the keen local ones,
 * either day for those far away, the rest shared over Friday afternoon, Saturday morning and
 * Saturday afternoon), then one email each, sent as a bulk run (campaign kind entry_slot).
 * The waiting list is let in by its own button (the organiser: on the morning of the 19th),
 * and their email goes on the same run with "a place has opened up".
 *
 * The server side is src/routes/entry-slots.ts. Loaded before /admin.js; uses its globals
 * api, toast, openModal, closeModal, startCampaign, pauseCampaignFromList and resumeCampaign
 * at click time. The Overview is redrawn as one innerHTML, so the strip draws itself
 * whenever its #entryslots-strip appears. Buttons carry data-es="<action>". */
(function (global) {
  'use strict';

  var S = { d: null, slot: '', pv: null, loading: false, busy: false };
  var TITLE = 'Free Visitor Pass: your entry time';

  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function $(id) { return document.getElementById(id); }
  function say(msg, kind) { if (typeof toast === 'function') toast(esc(msg), kind || 'success'); }
  function errText(e) { return (e && e.message && e.message !== 'unauthorized') ? e.message : 'That did not work. Try again.'; }
  function btn(action, label, solid) {
    return '<button type="button" data-es="' + action + '" class="px-3 py-1.5 rounded-lg text-xs ' +
      (solid ? 'font-semibold bg-primary-700 text-white on-dark hover:bg-primary-800' : 'font-medium border border-white/10 text-gray-300 hover:bg-white/5') + '">' + label + '</button>';
  }
  function sum(list, k) { var n = 0; (list || []).forEach(function (s) { n += Number(s[k] || 0); }); return n; }

  // ---------- the strip ----------
  async function load() {
    var el = $('entryslots-strip'); if (!el || S.loading) return;
    S.loading = true;
    try {
      S.d = await api.get('/api/admin/entry-slots/status');
      if (S.d && S.d.error) throw new Error(S.d.error);
    } catch (e) {
      S.d = null;
      el.innerHTML = '<p class="text-[11px] text-gray-500 mt-3">Entry times could not be loaded: ' + esc(errText(e)) + '</p>';
      S.loading = false; return;
    } finally { S.loading = false; }
    draw();
  }
  function draw() {
    var el = $('entryslots-strip'); if (!el) return;
    var d = S.d; if (!d || d.unavailable) { el.innerHTML = ''; return; }
    el.setAttribute('data-drawn', '1');
    var run = d.open_run, given = sum(d.slots, 'given');
    var state;
    if (run) state = '<span class="text-amber-300">The email run is ' + esc(run.status) + '</span>: ' + run.sent + ' of ' + run.total + ' sent' + (run.failed ? ', ' + run.failed + ' failed' : '') + '.';
    else if (d.without) state = d.without + ' free pass holders have no entry time yet.' + (given ? ' ' + given + ' have one.' : '');
    else if (d.to_send) state = given + ' have an entry time; ' + d.to_send + ' have not had the email yet.';
    else state = given ? 'Everyone with an entry time has had the email.' : 'No free pass holders to give an entry time to.';
    var rows = (d.slots || []).map(function (s) {
      var plus = [];
      if (s.planned) plus.push('+' + s.planned + ' to give');
      if (s.waitlist) plus.push('+' + s.waitlist + ' from the waiting list');
      return '<tr class="border-t border-white/5"><td class="py-1 pr-3 text-gray-300 whitespace-nowrap">' + esc(s.short) + '</td>' +
        '<td class="py-1 pr-3 text-gray-500 hidden sm:table-cell">' + esc(s.text) + '</td>' +
        '<td class="py-1 pr-3 text-right font-semibold text-white">' + s.given + '</td>' +
        '<td class="py-1 pr-3 text-right text-gray-400">' + s.sent + '</td>' +
        '<td class="py-1 pr-3 text-right font-semibold text-green-300">' + (s.yes_now || 0) + '</td>' +
        '<td class="py-1 pr-3 text-right text-gray-400">' + (s.no_now || 0) + '</td>' +
        '<td class="py-1 text-gray-500 text-[11px]">' + esc(plus.join(', ')) + '</td></tr>';
    }).join('');
    var yesAll = sum(d.slots, 'yes_now'), noAll = sum(d.slots, 'no_now');
    var fresh = d.asked_since ? ' Since the email went: <span class="text-green-300 font-semibold">' + yesAll + '</span> said yes, ' + noAll + ' can&rsquo;t.' : '';
    var buttons = '';
    if (d.without) buttons += btn('assign', 'Give entry times to ' + d.without, true);
    if (run) buttons += btn('preview-run', 'Preview') + (run.status === 'running' ? btn('pause', 'Pause', true) : btn('resume', 'Resume', true));
    else if (d.to_send) buttons += btn('preview', 'Preview &amp; send to ' + d.to_send, !d.without);
    if (d.waiting) buttons += btn('letin', 'Let the waiting list in (' + d.waiting + ')');
    el.innerHTML = '<div class="mt-4 pt-3 border-t border-white/10">' +
      '<div class="flex items-center justify-between gap-3 flex-wrap mb-2">' +
        '<div><h4 class="text-xs font-semibold text-gray-200"><i class="fas fa-clock text-primary-400 mr-1.5"></i>Entry times for the Free Visitor Pass</h4>' +
        '<p class="text-[11px] mt-0.5 text-gray-400">' + state + (d.waiting ? ' ' + d.waiting + ' are on the waiting list.' : '') + (d.let_in ? ' ' + d.let_in + ' were let in from it.' : '') + fresh + '</p></div>' +
        '<div class="flex gap-1.5 flex-wrap">' + buttons + '</div></div>' +
      '<table class="w-full text-xs"><thead><tr class="text-[10px] uppercase tracking-wide text-gray-500"><th class="text-left font-medium pb-1">Entry time</th><th class="text-left font-medium pb-1 hidden sm:table-cell"></th>' +
        '<th class="text-right font-medium pb-1 pr-3">Given</th><th class="text-right font-medium pb-1 pr-3">Emailed</th><th class="text-right font-medium pb-1 pr-3" title="Tapped Yes, I\'m coming in the email or the app since the email went">Yes</th><th class="text-right font-medium pb-1 pr-3" title="Tapped I can\'t make it since the email went">Can&rsquo;t</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="text-[11px] text-gray-500 mt-2">Friday morning: Mumbai and Thane side who said "I&rsquo;m coming" or saved the pass, with their colleagues. Either day: those who live outside Mumbai. The rest share the other three half-days, colleagues together. The email asks "Are you coming?": Yes and Can&rsquo;t count answers given since it went, not older ones. The desk shows the time on the scan; it does not turn anyone away.</p>' +
      '</div>';
    wire(el);
  }

  // ---------- give the entry times ----------
  function openAssign() {
    var d = S.d || {}, list = (d.slots || []).filter(function (s) { return s.planned; });
    openModal('<h3 class="text-lg font-bold mb-2"><i class="fas fa-clock text-primary-400 mr-2"></i>Give entry times to ' + d.without + ' people</h3>' +
      '<p class="text-xs text-gray-400 mb-3">Only free pass holders without an entry time. Nobody is emailed yet: that is the next step, after a preview.</p>' +
      '<ul class="text-sm space-y-1 mb-4">' + list.map(function (s) { return '<li><span class="font-semibold text-white">' + s.planned + '</span> &middot; ' + esc(s.text) + '</li>'; }).join('') + '</ul>' +
      '<div class="flex gap-2"><button type="button" data-es="close" class="flex-1 py-2.5 rounded-xl text-sm glass hover:bg-white/10">Cancel</button>' +
      '<button type="button" data-es="assign-go" class="flex-1 py-2.5 rounded-xl text-sm bg-amber-600 hover:bg-amber-500 text-white font-semibold">Give the entry times</button></div>');
    wire($('modal-box'));
  }
  async function assign() {
    if (S.busy) return; S.busy = true;
    try {
      var r = await api.post('/api/admin/entry-slots/assign', {});
      if (r && r.error) throw new Error(r.error);
      closeModal(); say(r.assigned + ' entry times given. Now preview the email and send it.');
    } catch (e) { say('Could not give the entry times: ' + errText(e), 'error'); }
    S.busy = false; await load();
  }

  // ---------- the waiting list ----------
  function openLetIn() {
    var d = S.d || {}, list = (d.slots || []).filter(function (s) { return s.waitlist; });
    openModal('<h3 class="text-lg font-bold mb-2"><i class="fas fa-user-check text-primary-400 mr-2"></i>Let the waiting list in (' + d.waiting + ')</h3>' +
      '<p class="text-xs text-gray-400 mb-3">Each gets a confirmed Free Visitor Pass with this entry time. Their pass works at the desk from now. Then press Preview &amp; send: their email says a place has opened up.</p>' +
      '<ul class="text-sm space-y-1 mb-4">' + list.map(function (s) { return '<li><span class="font-semibold text-white">' + s.waitlist + '</span> &middot; ' + esc(s.text) + '</li>'; }).join('') + '</ul>' +
      '<div class="flex gap-2"><button type="button" data-es="close" class="flex-1 py-2.5 rounded-xl text-sm glass hover:bg-white/10">Cancel</button>' +
      '<button type="button" data-es="letin-go" class="flex-1 py-2.5 rounded-xl text-sm bg-amber-600 hover:bg-amber-500 text-white font-semibold">Let them in</button></div>');
    wire($('modal-box'));
  }
  async function letIn() {
    if (S.busy) return; S.busy = true;
    try {
      var r = await api.post('/api/admin/entry-slots/let-in-waitlist', {});
      if (r && r.error) throw new Error(r.error);
      closeModal(); say(r.let_in + ' let in from the waiting list. Now preview the email and send it.');
    } catch (e) { say('Could not let them in: ' + errText(e), 'error'); }
    S.busy = false; await load();
  }

  // ---------- the preview, then Send ----------
  async function openPreview(slot) {
    S.slot = slot || '';
    openModal('<div class="py-10 text-center text-gray-400"><i class="fas fa-spinner fa-spin"></i></div>');
    var d;
    try {
      d = await api.get('/api/admin/entry-slots/preview' + (S.slot ? '?slot=' + encodeURIComponent(S.slot) : ''));
      if (d && d.error) throw new Error(d.error);
    } catch (e) { openModal('<p class="text-sm text-red-400">Could not build the preview: ' + esc(errText(e)) + '</p>'); return; }
    S.pv = d;
    var cnt = d.counts || {}, total = cnt.total || 0, run = S.d && S.d.open_run;
    var chips = '<div class="flex gap-1.5 flex-wrap mb-3">' + (d.slots || []).filter(function (s) { return cnt[s.key]; }).map(function (s) {
      var on = d.slot === s.key;
      return '<button type="button" data-es="slot" data-slot="' + s.key + '" class="px-3 py-1.5 rounded-lg text-xs font-semibold ' + (on ? 'bg-amber-600 text-white' : 'border border-white/10 text-gray-300 hover:bg-white/5') + '">' +
        esc(s.short) + ' (' + cnt[s.key] + ')</button>';
    }).join('') + '</div>';
    var body = d.sample
      ? '<p class="text-xs text-gray-400 mb-1">As ' + esc(d.sample.name) + (d.sample.from_waitlist ? ' (let in from the waiting list)' : '') + ' will get it. The buttons are not live in this preview.</p>' +
        '<p class="text-sm font-semibold text-white mb-2">Subject: ' + esc(d.subject) + '</p>' +
        '<iframe id="es-prev-frame" sandbox="" title="Email preview" class="w-full rounded-xl bg-white" style="height:56vh;border:1px solid rgba(0,0,0,0.1);"></iframe>'
      : '<p class="text-sm text-gray-400 py-8 text-center">Nobody is waiting for this email.</p>';
    var act = run ? '' : (total ? 'Send to ' + total + ' ' + (total === 1 ? 'person' : 'people') : '');
    openModal('<h3 class="text-lg font-bold mb-1"><i class="fas fa-clock text-primary-400 mr-2"></i>&ldquo;Your entry time&rdquo;: check it before it goes</h3>' +
      '<p class="text-xs text-gray-400 mb-3">' + total + ' to send. Read each entry time:</p>' + chips + body +
      '<div class="flex gap-2 mt-4">' +
        '<button type="button" data-es="close" class="flex-1 py-2.5 rounded-xl text-sm glass hover:bg-white/10">' + (act ? 'Cancel' : 'Close') + '</button>' +
        (act ? '<button type="button" data-es="go" class="flex-1 py-2.5 rounded-xl text-sm bg-amber-600 hover:bg-amber-500 text-white font-semibold">' + act + '</button>' : '') +
      '</div>' +
      (act ? '<p class="text-[11px] text-gray-500 mt-2">It goes ' + esc(d.window || '9am to 9pm IST') + ', Friday morning first: this tab sends while the page is open, and the server&rsquo;s clock sends ten a minute when it is not. Nobody is sent it twice.</p>' : '') +
      (run ? '<p class="text-[11px] text-amber-300 mt-2">A run is already ' + esc(run.status) + ': pause or resume it from the strip.</p>' : ''));
    var f = $('es-prev-frame'); if (f) f.srcdoc = d.html;
    wire($('modal-box'));
  }
  async function go() {
    closeModal();
    await startCampaign('entry_slot', { audience: 'all', title: TITLE });
    load();
  }

  // ---------- buttons ----------
  function wire(root) {
    if (!root || root.getAttribute('data-es-wired')) return;
    root.setAttribute('data-es-wired', '1');
    root.addEventListener('click', async function (ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest('[data-es]') : null;
      if (!b || !root.contains(b)) return;
      var a = b.getAttribute('data-es'), run = S.d && S.d.open_run;
      if (a === 'assign') return openAssign();
      if (a === 'assign-go') return assign();
      if (a === 'letin') return openLetIn();
      if (a === 'letin-go') return letIn();
      if (a === 'preview') return openPreview('');
      if (a === 'preview-run') return openPreview('');
      if (a === 'slot') return openPreview(b.getAttribute('data-slot'));
      if (a === 'pause' && run) { await pauseCampaignFromList(run.id); return load(); }
      if (a === 'resume' && run) { await resumeCampaign(run.id); return load(); }
      if (a === 'close') return closeModal();
      if (a === 'go') return go();
    });
  }

  function watch() {
    var seen = function () { var el = $('entryslots-strip'); if (el && !el.getAttribute('data-drawn') && !S.loading && typeof api !== 'undefined') load(); };
    try { new MutationObserver(seen).observe(document.documentElement, { childList: true, subtree: true }); } catch (e) { /* no observer */ }
    seen();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();

  global.EntrySlots = { load: load, openPreview: openPreview };
})(window);
