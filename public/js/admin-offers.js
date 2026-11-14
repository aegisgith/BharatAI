// Admin, Payments, "Last-week offers" (12 Nov 2026). One global, OffersDesk, mounted
// by loadOffersDesk() in adminPageScript into #offers-block. Server side: the
// LAST-WEEK OFFERS block in src/index.tsx (/api/admin/offers*). Only class names
// that already appear in src/index.tsx are used here (Tailwind does not scan
// public/js), the rest is inline style.
(function () {
  'use strict';
  var esc = function (v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  };
  var inr = function (n) { return Number(n || 0).toLocaleString('en-IN'); };
  var S = { host: null, api: null, d: null, people: null, open: false, msg: '', busy: false };
  var BTN = 'px-3 py-1.5 rounded-lg text-[11px] bg-primary-500/20 text-primary-300 hover:bg-primary-500/30';
  var GHOST = 'px-2.5 py-1.5 rounded-lg text-[11px] glass hover:bg-white/10 text-gray-300';
  // In the order to send them. always: not tied to the offers switch. upgrade: the
  // Student Pass email is the upgrade campaign's (kind 'upgrade', audience 'students').
  var AUD = {
    // 14 Nov 2026: first, because it has a deadline (the waiting list closes 16 Nov, 5 PM).
    waitlisted: { label: 'On the waiting list for a free pass', offer: 'free passes full: get a pass by 16 Nov, 5 PM', always: true },
    vip_delegates: { label: 'Paid Delegates and Premium Delegates', offer: 'VIP for the offer price' },
    exhibitors: { label: 'Exhibitor and Exhibition Speaker passes', offer: 'VIP at the booth price' },
    colleagues: { label: 'Paid Delegates, Premium Delegates and VIPs', offer: 'bring a colleague, 15% off' },
    speakers: { label: 'People who asked to speak (ticked below)', offer: 'a paid showcase slot' },
    students: { label: 'Students on a free Visitor Pass', offer: 'the Student Pass, &#8377;999 with a workshop', always: true, upgrade: true },
    groups: { label: 'Free visitors at companies with 3 or more registered', offer: 'group booking, up to 30% off', always: true },
    media: { label: 'Registered journalists, editors and creators', offer: 'apply for a Media or Influencer Pass', always: true },
  };

  function mount(host, api) {
    S.host = host; S.api = api;
    if (!host.getAttribute('data-offers')) {
      host.setAttribute('data-offers', '1');
      host.addEventListener('click', onClick);
      host.addEventListener('change', onChange);
    }
    load();
  }
  function load() {
    return S.api.get('/api/admin/offers').then(function (d) { S.d = d; draw(); })
      .catch(function (e) { S.host.innerHTML = box('<p class="text-red-400" style="font-size:12px;">' + esc(e.message) + '</p>'); });
  }
  function box(inner) { return '<div class="glass rounded-xl p-5 border border-white/5">' + inner + '</div>'; }
  function soldLine(d) {
    var by = {};
    (d.sold || []).forEach(function (r) {
      var k = r.pass_type === 'VIP Pass' ? (/Exhibit/.test(r.previous_badge) ? 'Exhibitor to VIP' : 'Delegate to VIP')
        : /Showcase/.test(r.pass_type) ? 'Showcase slots' : r.pass_type === 'Student Pass' ? 'Student Passes' : r.pass_type;
      by[k] = by[k] || { n: 0, paise: 0 };
      by[k].n += Number(r.n || 0); by[k].paise += Number(r.paise || 0);
    });
    // Colleague invitations are bookings on /group, counted apart (d.colleagues).
    var col = d.colleagues || {};
    if (col.bookings) by['Colleague invitations'] = { n: Number(col.passes || 0), paise: Number(col.paise || 0) };
    var keys = Object.keys(by);
    if (!keys.length) return 'Nothing sold through the offers yet.';
    var all = 0;
    var parts = keys.map(function (k) { all += by[k].paise; return esc(k) + ': ' + by[k].n + ' (&#8377;' + inr(Math.round(by[k].paise / 100)) + ')'; });
    return 'Since 12 Nov, paid online: ' + parts.join(' &middot; ') + '. In all &#8377;' + inr(Math.round(all / 100)) + ' including GST.';
  }
  function draw() {
    var d = S.d; if (!d) return;
    var p = d.prices || {}, sh = d.showcase || {};
    var pill = d.active
      ? '<span class="px-2 py-0.5 rounded-full text-[10px] bg-amber-500/15 text-amber-300">On until ' + esc(d.last_day_text) + '</span>'
      : '<span class="px-2 py-0.5 rounded-full text-[10px]" style="background:rgba(148,163,184,.15);color:#94a3b8;">' + (d.on ? 'Over (ended ' + esc(d.last_day_text) + ')' : 'Off') + '</span>';
    var slots = (d.slots || []).map(function (s) {
      return '<div class="flex flex-wrap items-center gap-3 py-3 border-b border-white/5">' +
        '<div style="flex:1;min-width:200px;"><div class="text-sm text-gray-200">' + esc(s.name) + (s.company ? ' &middot; ' + esc(s.company) : '') + '</div>' +
        '<div class="text-[11px] text-gray-500">' + esc(s.title) + '</div>' +
        '<div class="text-[11px] text-gray-500">' + esc(s.email) + (s.mobile ? ' &middot; ' + esc(s.mobile) : '') + ' &middot; ' + esc(s.order_id) + '</div></div>' +
        '<span class="px-2 py-0.5 rounded-full text-[10px] bg-amber-500/15 text-amber-300">' + (s.status === 'paid' ? 'Paid' + (s.with_vip ? ' + VIP' : '') : 'At checkout') + '</span>' +
        (s.amount_paise ? '<span class="text-[11px] text-gray-400">&#8377;' + inr(Math.round(Number(s.amount_paise) / 100)) + '</span>' : '') +
        (s.talk_id ? '<span class="text-[10px] text-green-400">talk #' + Number(s.talk_id) + ', no time yet</span>' : '') +
        '</div>';
    }).join('') || '<p class="text-gray-500 text-sm py-4">No slot booked yet.</p>';
    var aud = Object.keys(AUD).map(function (k) {
      var n = (d.audiences || {})[k] || 0;
      return '<div class="flex flex-wrap items-center gap-3 py-3 border-b border-white/5">' +
        '<div style="flex:1;min-width:200px;"><div class="text-sm text-gray-200">' + AUD[k].label + '</div>' +
        '<div class="text-[11px] text-gray-500">Offer: ' + AUD[k].offer + '. ' + n + ' still to write to (anyone already sent this offer is left out).' + (AUD[k].always ? ' Open to everyone, so it may go with the offers off.' : '') + '</div></div>' +
        '<button type="button" class="' + GHOST + '" data-act="preview" data-aud="' + k + '">Preview</button>' +
        '<button type="button" class="' + BTN + '" data-act="send" data-aud="' + k + '" data-n="' + n + '"' + ((!d.active && !AUD[k].always) || !n ? ' disabled style="opacity:.5;"' : '') + '>Send to ' + n + '</button>' +
        '</div>';
    }).join('');
    var people = '';
    if (S.open) {
      if (!S.people) people = '<p class="text-gray-500 text-sm py-4">Loading...</p>';
      else {
        var ticked = S.people.filter(function (x) { return x.ticked; }).length;
        people = '<p class="text-[11px] text-gray-500 mb-3">' + S.people.length + ' addresses asked to speak. Unticked by default: anyone already on a stage, with a booth, answered already, unsubscribed, or sent already. ' +
          '<span id="offers-ticked">' + ticked + '</span> ticked.</p>' +
          '<div class="max-h-96 overflow-y-auto pr-1">' + S.people.map(function (x, i) {
            var off = x.flags.indexOf('sent already') >= 0 || x.flags.indexOf('unsubscribed') >= 0 || x.flags.indexOf('has bought a slot') >= 0;
            return '<label class="flex flex-wrap items-center gap-3 py-3 border-b border-white/5" style="cursor:pointer;">' +
              '<input type="checkbox" data-person="' + i + '"' + (x.ticked ? ' checked' : '') + (off ? ' disabled' : '') + ' style="width:18px;height:18px;">' +
              '<span style="flex:1;min-width:200px;"><span class="text-sm text-gray-200">' + esc(x.name || x.email) + (x.organization ? ' &middot; ' + esc(x.organization) : '') + '</span>' +
              '<span class="text-[11px] text-gray-500" style="display:block;">' + esc(x.email) + (x.subject ? ' &middot; ' + esc(x.subject) : '') + '</span></span>' +
              (x.flags.length ? '<span class="px-2 py-0.5 rounded-full text-[10px] bg-amber-500/15 text-amber-300">' + esc(x.flags.join(', ')) + '</span>' : '') +
              '</label>';
          }).join('') + '</div>' +
          '<div style="margin-top:12px;"><button type="button" class="' + BTN + '" data-act="send-ticked"' + (!d.active ? ' disabled style="opacity:.5;"' : '') + '>Send the showcase offer to the ticked</button></div>';
      }
    }
    S.host.innerHTML = box(
      '<div class="flex flex-wrap items-center gap-3 mb-1"><h3 class="text-sm font-semibold text-white" style="margin:0;">Last-week offers</h3>' + pill +
        '<button type="button" class="' + BTN + '" data-act="toggle" style="margin-left:auto;">' + (d.on ? 'Turn off' : 'Turn on') + '</button></div>' +
      '<p class="text-[11px] text-gray-500 mb-3">All + 18% GST, until the last day of the event. Off, every price is as before. ' +
        'Delegate or Premium Delegate to VIP: &#8377;' + inr((p.vip_step || {})['Delegate Pass']) + '. ' +
        'Exhibitor pass to VIP: &#8377;' + inr((p.exhibitor_vip || {}).startup) + ' (Startup Pod, Explorer Booth) or &#8377;' + inr((p.exhibitor_vip || {}).other) + ' (any other booth). ' +
        '(Also new, not an offer: the Student Pass, &#8377;' + inr(p.student) + ' with one workshop, up to ' + Math.round((p.student_share || 0) * 100) + '% of each workshop.) ' +
        'Showcase slot &#8377;' + inr((p.showcase || {})['Innovation Showcase Slot']) + ', with a VIP Pass &#8377;' + inr((p.showcase || {})['Innovation Showcase Slot + VIP Pass']) + '. ' +
        'Booking page: <a href="/showcase-slot" target="_blank" class="text-primary-300">/showcase-slot</a>. ' +
        'Bring a colleague: each paid Delegate, Premium Delegate or VIP gets a personal link by email; through it even one pass is ' + Number(p.colleague_pct || 0) + '% off, for up to ' + Number(p.colleague_passes || 0) + ' passes per link, booked and paid on /group' +
        ((d.colleagues || {}).ready ? '.' : ' <span class="text-amber-300">(needs migration 0059 first)</span>.') + '</p>' +
      '<p class="text-[12px] text-gray-300 mb-3">' + soldLine(d) + '</p>' +
      '<div class="text-sm font-semibold text-white mb-1" style="margin-top:14px;">Showcase slots</div>' +
      (sh.ready
        ? '<p class="text-[11px] text-gray-500 mb-3">' + Number(sh.paid || 0) + ' paid, ' + Number(sh.held || 0) + ' at checkout, ' + Number(sh.left || 0) + ' left of ' + Number(sh.cap || 0) + '. A paid slot lands in Innovation Talks with no time: give it one in Conference. ' +
          '<label style="white-space:nowrap;">Slots on sale <input type="number" min="0" max="100" value="' + Number(sh.cap || 0) + '" id="offers-cap" style="width:64px;background:transparent;border:1px solid rgba(255,255,255,.2);border-radius:6px;padding:2px 6px;color:inherit;"></label> ' +
          '<button type="button" class="' + GHOST + '" data-act="cap">Save</button></p>' +
          '<div class="max-h-96 overflow-y-auto pr-1">' + slots + '</div>'
        : '<p class="text-[11px] text-amber-300 mb-3">Needs migration 0058 (showcase_slots). Until it runs the booking page says the slots open shortly.</p>') +
      '<div class="text-sm font-semibold text-white mb-1" style="margin-top:16px;">Offer emails</div>' +
      '<p class="text-[11px] text-gray-500 mb-1">From register@, one every ' + Number(d.gap_seconds || 0) + ' s between ' + esc(d.window || '') + ' IST, sent by the minute clock (progress under Settings, Bulk email). Pressed before 9am, they wait and start at 9am by themselves. Preview shows the email as the first person would get it.</p>' +
      aud +
      '<div style="margin-top:12px;"><button type="button" class="' + GHOST + '" data-act="people">' + (S.open ? 'Hide' : 'Show') + ' the people who asked to speak</button></div>' +
      (S.open ? '<div style="margin-top:12px;">' + people + '</div>' : '') +
      '<p class="text-[12px] mt-3" id="offers-msg" style="min-height:16px;color:#86efac;">' + esc(S.msg) + '</p>'
    );
  }
  function say(t, bad) { S.msg = t; var m = document.getElementById('offers-msg'); if (m) { m.textContent = t; m.style.color = bad ? '#fca5a5' : '#86efac'; } }
  function preview(aud) {
    var url = AUD[aud] && AUD[aud].upgrade ? '/api/admin/campaigns/upgrade-preview?audience=' + encodeURIComponent(aud) : '/api/admin/offers/preview?audience=' + encodeURIComponent(aud);
    S.api.get(url).then(function (r) {
      var wrap = document.createElement('div');
      wrap.setAttribute('style', 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px;');
      wrap.innerHTML = '<div style="background:#fff;border-radius:12px;max-width:680px;width:100%;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;">' +
        '<div style="padding:10px 14px;font:13px Arial,sans-serif;color:#1E2140;border-bottom:1px solid #E4E7F4;display:flex;gap:10px;align-items:center;"><span style="flex:1;"><b>Subject:</b> ' + esc(r.subject) + (r.to ? '<br><span style="color:#5E6585;">As the first of ' + Number(r.count || 0) + ' would get it: ' + esc(r.to) + '</span>' : '') + '</span>' +
        '<button type="button" style="border:0;background:#1E2140;color:#fff;border-radius:8px;padding:6px 12px;cursor:pointer;">Close</button></div>' +
        '<iframe style="border:0;width:100%;flex:1;min-height:60vh;" sandbox=""></iframe></div>';
      document.body.appendChild(wrap);
      wrap.querySelector('iframe').srcdoc = r.html;
      wrap.addEventListener('click', function (e) { if (e.target === wrap || e.target.tagName === 'BUTTON') wrap.remove(); });
    }).catch(function (e) { say(e.message, true); });
  }
  function start(aud, ids, n) {
    if (S.busy) return;
    if (!window.confirm('Send the ' + AUD[aud].offer + ' email to ' + n + ' people? Each person gets it once, from register@, paced by the minute clock.')) return;
    S.busy = true;
    S.api.post('/api/admin/campaigns', ids ? { kind: 'offer', audience: aud, inquiry_ids: ids } : { kind: AUD[aud].upgrade ? 'upgrade' : 'offer', audience: aud })
      .then(function (r) { S.busy = false; S.msg = 'Started: ' + Number(r.total || 0) + ' emails queued (run ' + Number(r.id) + '). They go one at a time between 9am and 9pm.'; S.people = null; return load().then(function () { if (S.open) loadPeople(); }); })
      .catch(function (e) { S.busy = false; say(e.message, true); });
  }
  function loadPeople() {
    S.api.get('/api/admin/offers/speakers').then(function (r) { S.people = r.people || []; draw(); }).catch(function (e) { say(e.message, true); });
  }
  function onChange(e) {
    var i = e.target && e.target.getAttribute('data-person');
    if (i === null || i === undefined || !S.people) return;
    S.people[Number(i)].ticked = !!e.target.checked;
    var t = document.getElementById('offers-ticked');
    if (t) t.textContent = String(S.people.filter(function (x) { return x.ticked; }).length);
  }
  function onClick(e) {
    var b = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!b || b.disabled) return;
    var act = b.getAttribute('data-act'), aud = b.getAttribute('data-aud');
    if (act === 'toggle') {
      var on = !S.d.on;
      if (on && !window.confirm('Turn the last-week offers on? Prices change at once on the site, the app and the emails.')) return;
      S.api.put('/api/admin/offers', { on: on }).then(function () { S.msg = on ? 'The offers are on.' : 'The offers are off.'; return load(); }).catch(function (er) { say(er.message, true); });
    } else if (act === 'cap') {
      var v = document.getElementById('offers-cap');
      S.api.put('/api/admin/offers', { cap: v ? v.value : '' }).then(function () { S.msg = 'Saved.'; return load(); }).catch(function (er) { say(er.message, true); });
    } else if (act === 'preview') {
      preview(aud);
    } else if (act === 'send') {
      if (aud === 'speakers' && S.people) {
        var ids = S.people.filter(function (x) { return x.ticked; }).map(function (x) { return x.id; });
        start('speakers', ids, ids.length);
      } else start(aud, null, Number(b.getAttribute('data-n') || 0));
    } else if (act === 'send-ticked') {
      var picked = (S.people || []).filter(function (x) { return x.ticked; }).map(function (x) { return x.id; });
      if (!picked.length) { say('Tick at least one person.', true); return; }
      start('speakers', picked, picked.length);
    } else if (act === 'people') {
      S.open = !S.open; draw();
      if (S.open && !S.people) loadPeople();
    }
  }
  window.OffersDesk = { mount: mount };
})();
