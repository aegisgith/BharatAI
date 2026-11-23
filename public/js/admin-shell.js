/* Admin shell (24 Nov 2026): the parts of /admin that are about finding your way,
 * not about any one screen. One global, AdminShell. Loaded after /admin.js, whose
 * globals it uses by name (api, EID, escH, switchSection, authHeaders,
 * handleAuthFailure, currentSection, openMobileSidebar, daysToGoLabel).
 *
 *   Ask       Ctrl+K / Cmd+K, the Ask button in the top bar or the middle of the
 *             phone's bottom bar. Goes to any screen as you type; a question is
 *             answered by POST /api/admin/assist (src/routes/admin-assist.ts) from
 *             the dashboard's own totals, or, when the AI is not there or its answer
 *             has a number the totals do not hold, by those totals themselves.
 *   Nav       the sidebar's groups fold and unfold (remembered in as_nav_closed);
 *             the group of the screen you are on always opens.
 *   Tab bar   phones and small tablets: Home, Attendees, Ask, Inbox, Menu.
 *   Overview  "Today at a glance" (#ov-brief) and the "Jump to" bar (#ov-jump).
 *
 * If this file fails to load, the dashboard works exactly as before: every sidebar
 * button, title and section is in the page itself. Nothing here saves anything.
 */
(function () {
  'use strict';
  if (window.AdminShell) return;

  // ---------- helpers ----------
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); };
  var num = function (n) { return Number(n || 0).toLocaleString('en-IN'); };
  var inr = function (paise) { return '₹' + Math.round(Number(paise || 0) / 100).toLocaleString('en-IN'); };
  var nowHHMM = function () { var d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  var reduceMotion = function () { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } };
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
  };
  var signedIn = function () { try { return typeof adminSignedIn === 'function' ? adminSignedIn() : true; } catch (_) { return true; } };
  var section = function () { try { return typeof currentSection !== 'undefined' ? currentSection : 'overview'; } catch (_) { return 'overview'; } };

  // ---------- the screens, read from the sidebar itself ----------
  // Words people type for a screen that its name does not contain.
  var WORDS = {
    overview: 'home dashboard today board waiting summary numbers glance',
    attendees: 'people registrations registered delegates visitors list search export csv add person pass passes edit',
    sessions: 'conference programme program agenda schedule speakers halls talks panels',
    exhibitors: 'companies stalls booths exhibitor list',
    'booth-requests': 'booth booking requests applications stall',
    'floor-plan': 'stands map layout sold held stalls',
    sponsorship: 'sponsors branding packages revenue',
    awards: 'nominees categories winners',
    announcements: 'feed notices broadcast push news',
    innovation: 'stage talks showcase speakers expo hall',
    'startup-pitch': 'startups pitch investors',
    inquiries: 'enquiries enquiry inquiry leads inbox sales contact form delegation speaker requests',
    submissions: 'emails logos photos team lists files attachments',
    media: 'press journalists influencers creators media pass',
    marketplace: 'listings products approve marketplace',
    payments: 'money revenue invoices invoice gst receipts paid unpaid ccavenue checkout offers refunds sales',
    workshops: 'seats workshop ibm training',
    'badge-desk': 'check-in checkin checked entry scan qr desk staff arrivals door',
    boothleads: 'leads scans scanner booth visitors',
    analytics: 'reports charts graphs stats statistics',
    rooms: 'boardrooms meeting rooms bookings',
    after: 'feedback survey photos thank you results certificates',
    whatsapp: 'messages chat whatsapp templates replies',
    liveqa: 'questions q&a qa moderator hall screen',
    delhi2027: 'delhi 2027 codes discount partner',
    agentsummit: 'summit agent april 2027 event 3',
    settings: 'email setup switches waitlist waiting list staff accounts keys config configuration',
  };
  var screensCache = null;
  function screens() {
    if (screensCache) return screensCache;
    screensCache = $$('#sidebar .sidebar-btn').map(function (b) {
      var id = b.getAttribute('data-section') || (/marketplace/.test(b.getAttribute('href') || '') ? 'marketplace' : '');
      var lab = b.querySelector('.sidebar-label');
      var label = lab && lab.firstChild ? String(lab.firstChild.textContent || '').trim() : String(b.textContent || '').trim();
      var icon = b.querySelector('i');
      var group = b.closest('.as-nav-group');
      var gl = group ? group.querySelector('.as-group-label span') : null;
      return {
        id: id, label: label, href: b.getAttribute('href') || '',
        icon: icon ? (String(icon.className).match(/fa-[a-z0-9-]+/g) || []).filter(function (c) { return c !== 'fa-fw'; }).pop() || 'fa-circle' : 'fa-circle',
        desc: b.getAttribute('title') || '', group: gl ? gl.textContent.trim() : '',
        words: WORDS[id] || '',
      };
    }).filter(function (s) { return s.id && s.label; });
    return screensCache;
  }
  function screenById(id) { return screens().filter(function (s) { return s.id === id; })[0] || null; }
  function go(id) {
    var s = screenById(id);
    if (s && s.href) { location.href = s.href; return; }
    if (typeof switchSection === 'function') switchSection(id);
  }

  // Things to do, not places to go. Each opens a form or a list; none saves anything.
  var ACTIONS = [
    { label: 'Add an attendee', icon: 'fa-user-plus', words: 'new person register add attendee', run: function () { go('attendees'); setTimeout(function () { if (typeof openAddAttendee === 'function') openAddAttendee(); }, 50); } },
    { label: 'Bulk upload attendees', icon: 'fa-file-upload', words: 'import csv excel upload many', run: function () { go('attendees'); setTimeout(function () { if (typeof openBulkUploadModal === 'function') openBulkUploadModal(); }, 50); } },
    { label: 'Find duplicate attendees', icon: 'fa-user-friends', words: 'duplicates same mobile merge', run: function () { go('attendees'); setTimeout(function () { if (typeof findDuplicates === 'function') findDuplicates(); }, 50); } },
    { label: 'Edit the event details', icon: 'fa-edit', words: 'event title venue dates edit', run: function () { go('overview'); setTimeout(function () { if (typeof openEditEvent === 'function') openEditEvent(); }, 50); } },
    { label: 'Free Visitor Pass waiting list', icon: 'fa-clock', words: 'waitlist waiting list free pass', run: function () { if (typeof openWaitlist === 'function') openWaitlist(); } },
    { label: 'Open the public website', icon: 'fa-external-link-alt', words: 'site website public home', run: function () { window.open('/', '_blank', 'noopener'); } },
  ];

  // ---------- matching ----------
  var STOP = { the: 1, and: 1, for: 1, how: 1, many: 1, much: 1, what: 1, who: 1, are: 1, have: 1, has: 1, did: 1, does: 1, our: 1, with: 1, from: 1, this: 1, that: 1, today: 0, show: 1, tell: 1, give: 1, any: 1, all: 1, was: 1, were: 1, been: 1, there: 1, they: 1, them: 1, can: 1, you: 1, please: 1, about: 1, into: 1, out: 1, still: 1, not: 0 };
  function words(q) { return String(q || '').toLowerCase().replace(/[^a-z0-9&ऀ-ॿ ]+/g, ' ').split(/\s+/).filter(function (w) { return w.length > 1; }); }
  function looksLikeQuestion(q) {
    var t = String(q || '').trim().toLowerCase();
    if (!t) return false;
    if (t.indexOf('?') >= 0) return true;
    if (/^(how|what|who|whom|which|when|where|why|is|are|do|does|did|can|should|could|will|shall|show|tell|list|give|any|summari[sz]e|brief|explain|compare|whats|what's)\b/.test(t)) return true;
    return words(t).length >= 4;
  }
  function scoreText(token, text) {
    text = text.toLowerCase();
    if (!text) return 0;
    if (text === token) return 100;
    if (text.indexOf(token) === 0) return 70;
    if ((' ' + text).indexOf(' ' + token) >= 0) return 50;
    if (token.length >= 3 && text.indexOf(token) >= 0) return 25;
    return 0;
  }
  function matchScreens(q) {
    var toks = words(q);
    if (!toks.length) return [];
    return screens().map(function (s) {
      var total = 0, missed = 0;
      toks.forEach(function (t) {
        var best = Math.max(scoreText(t, s.label) * 1.4, scoreText(t, s.words), scoreText(t, s.desc) * 0.5, scoreText(t, s.group) * 0.4);
        if (best > 0) total += best; else missed++;
      });
      if (missed) total -= missed * 40;
      return { s: s, score: total };
    }).filter(function (x) { return x.score > 20; }).sort(function (a, b) { return b.score - a.score; }).slice(0, 6).map(function (x) { return x.s; });
  }
  function matchActions(q) {
    var toks = words(q);
    if (!toks.length) return [];
    return ACTIONS.filter(function (a) {
      return toks.every(function (t) { return scoreText(t, a.label) || scoreText(t, a.words); });
    }).slice(0, 3);
  }

  // ---------- the dashboard's own totals ----------
  var state = { board: null, boardAt: 0, event: null, stats: null, statsAt: 0 };
  function badgeCount(id) { var el = document.getElementById(id); return el ? (parseInt(el.textContent, 10) || 0) : 0; }
  function waitingItems(b) {
    var t = (b && b.todo) || {};
    var byType = function (type) { return (t.inquiries || []).reduce(function (s, r) { return s + (r.type === type ? Number(r.n || 0) : 0); }, 0); };
    var wp = byType('workshop_partner'), md = byType('media');
    var inqTypes = (t.inquiries || []).filter(function (r) { return r.type !== 'workshop_partner' && r.type !== 'media'; }).slice(0, 4)
      .map(function (r) { return r.n + ' ' + String(r.type).replace(/_/g, ' '); }).join(', ');
    // The same lines and the same "in all" as the board's "Waiting on you" card (boardHTML).
    return [
      { n: t.not_paid || 0, short: 'to remind to pay', label: 'chose a paid pass and have not paid: remind them to pay', go: 'payments' },
      { n: t.invoice_due || 0, short: 'GST invoices to raise', label: 'paid online, GST invoice still to raise', go: 'payments' },
      { n: (t.inquiries_new || 0) - wp - md, short: 'enquiries to answer', label: 'new enquiries to answer' + (inqTypes ? ' (' + inqTypes + ')' : ''), go: 'inquiries' },
      { n: wp, short: 'workshop partner ideas', label: 'workshop partner ideas to read', go: 'inquiries' },
      { n: md, short: 'media pass requests', label: 'Media & Influencer Pass requests to decide', go: 'media' },
      { n: t.booths_submitted || 0, short: 'booth requests', label: 'booth requests to review', go: 'booth-requests' },
      { n: t.listings_pending || 0, short: 'listings to approve', label: 'AI Marketplace listings to approve', go: 'marketplace' },
      { n: t.rooms_held || 0, short: 'boardrooms on hold', label: 'boardroom bookings on hold, to confirm or refuse', go: 'rooms' },
      { n: t.workshop_unchosen || 0, short: 'without a workshop seat', label: 'Premium or VIP holders who have not chosen a workshop seat', go: 'workshops' },
      { n: t.photos_flagged || 0, short: 'flagged photos', label: 'photos the desk flagged as not matching the person', go: 'attendees' },
    ];
  }
  function waitingTotal(b) {
    var t = (b && b.todo) || {};
    return (t.not_paid || 0) + (t.invoice_due || 0) + (t.inquiries_new || 0) + (t.booths_submitted || 0) + (t.listings_pending || 0) + (t.rooms_held || 0) + (t.workshop_unchosen || 0) + (t.photos_flagged || 0);
  }
  function factsFrom(b, ev, st) {
    var lines = [];
    var add = function (k, v, s) { if (v === '' || v == null) return; lines.push({ k: k, v: v, s: s || '' }); };
    var passes = (b && b.passes) || [];
    var sum = function (f) { return passes.reduce(function (s, p) { return s + Number(p[f] || 0); }, 0); };
    add('Registered for the conference, everyone', sum('total'), 'attendees');
    add('Registered today (India time)', sum('today'), 'attendees');
    add('Registered in the last 7 days', sum('week'), 'attendees');
    add('Checked in at the badge desk', sum('checked_in'), 'badge-desk');
    passes.forEach(function (p) {
      var parts = [num(p.total) + ' hold it'];
      if (p.not_paid) parts.push(num(p.not_paid) + ' chose it and have not paid');
      if (p.complimentary) parts.push(num(p.complimentary) + ' given free');
      if (p.checked_in) parts.push(num(p.checked_in) + ' checked in');
      if (p.today) parts.push(num(p.today) + ' registered today');
      if (p.week) parts.push(num(p.week) + ' in the last 7 days');
      if (p.price) parts.push('price ' + inr(p.price * 100) + ' + GST');
      add('Pass: ' + p.pass, parts.join('; '), 'attendees');
    });
    var m = (b && b.money) || {};
    var sold = m.sold || [];
    var s2 = function (f) { return sold.reduce(function (s, x) { return s + Number(x[f] || 0); }, 0); };
    add('Online checkout', m.online ? 'on' : 'off: nobody can pay on the site right now', 'payments');
    add('Passes paid online', num(s2('n')) + ' passes, ' + inr(s2('total')) + ' with GST (' + inr(s2('gst')) + ' of it GST)', 'payments');
    add('Paid online today', num(s2('today_n')) + ' passes, ' + inr(s2('today_paise')), 'payments');
    add('Paid online in the last 7 days', num(s2('week_n')) + ' passes, ' + inr(s2('week_paise')), 'payments');
    sold.forEach(function (x) { add('Paid online: ' + x.pass, num(x.n) + ' passes, ' + inr(x.total) + ' with GST', 'payments'); });
    var hand = m.by_hand || [];
    if (hand.length) add('Confirmed by hand (paid another way)', hand.map(function (h) { return h.pass + ' ' + num(h.n) + ' (' + inr(h.recorded_paise) + ' recorded' + (h.no_amount ? ', ' + num(h.no_amount) + ' with no amount' : '') + ')'; }).join('; '), 'payments');
    add('Tried to pay online and never got through (people)', m.tried_not_paid || 0, 'payments');
    add('Chose a paid pass and have not paid (people)', m.not_paid_people || 0, 'payments');
    add('What those unpaid choices would bring at today’s prices', inr(m.not_paid_value || 0), 'payments');
    if (m.invoices) add('GST invoices raised', num(m.invoices.n) + ', ' + inr(m.invoices.total) + ' in all', 'payments');
    waitingItems(b).forEach(function (w) { add('Waiting on you: ' + w.label, w.n, w.go); });
    add('Waiting on you, in all', waitingTotal(b), 'overview');
    add('Emailed logos, photos or team lists waiting for a decision', badgeCount('sub-new-badge'), 'submissions');
    var t = (b && b.todo) || {};
    if (t.delhi_passes) add('Delhi 2027: people waitlisted for a free pass', num(t.delhi_passes.total) + ' (' + num(t.delhi_passes.today) + ' today, ' + num(t.delhi_passes.week) + ' in 7 days)', 'delhi2027');
    if (t.delhi_sales) add('Delhi 2027 passes', num(t.delhi_sales.paid) + ' paid, ' + num(t.delhi_sales.unpaid) + ' not paid, ' + inr(t.delhi_sales.paise) + ' received online', 'delhi2027');
    var ss = t.summit_sales;
    if (ss) add('AI Agent Summit 2027', num(ss.registered) + ' registered, ' + num(ss.paid) + ' paid, ' + inr(ss.paise) + ' received, ' + num(ss.review) + ' to check, ' + num(ss.applications) + ' showcase applications (' + num(ss.applications_new) + ' new), ' + num(ss.partners) + ' partner enquiries', 'agentsummit');
    var wl = t.waitlist;
    if (wl && wl.ready) add('Free Visitor Pass waiting list', (wl.on ? 'free passes are full, new free registrations join the list' : 'free passes are open') + '; ' + num(wl.total) + ' waiting (' + num(wl.today) + ' today), ' + num(wl.confirmed) + ' let in', 'settings');
    if (st) {
      add('Downloaded their pass', st.passDownloaded || 0, 'attendees');
      add('Shared their social card', st.cardDownloaded || 0, 'attendees');
      add('Sessions in the programme', st.sessions || 0, 'sessions');
      add('Exhibitors', st.exhibitors || 0, 'exhibitors');
      add('Connections made in the app', st.connections || 0, 'overview');
      add('Award categories', st.categories || 0, 'awards');
    }
    var evText = ev ? [ev.title, ev.venue, (ev.start_date || '') + ' to ' + (ev.end_date || ''), (typeof daysToGoLabel === 'function' ? daysToGoLabel(ev) : '')].filter(Boolean).join(', ') : '';
    return { asOf: (b && b.as_of) || nowHHMM(), event: evText, lines: lines };
  }
  function getFacts() {
    var fresh = state.board && (Date.now() - state.boardAt < 180000);
    var need = [];
    need.push(fresh ? Promise.resolve(state.board) : api.get('/api/admin/events/' + EID + '/board'));
    need.push(state.event ? Promise.resolve(state.event) : api.get('/api/events/' + EID));
    need.push(state.stats && Date.now() - state.statsAt < 180000 ? Promise.resolve(state.stats) : api.get('/api/events/' + EID + '/stats').catch(function () { return null; }));
    return Promise.all(need).then(function (r) {
      if (!r[0] || !Array.isArray(r[0].passes)) throw new Error('The dashboard numbers did not load.');
      state.board = r[0]; state.boardAt = Date.now(); state.event = r[1]; state.stats = r[2]; state.statsAt = Date.now();
      return factsFrom(r[0], r[1], r[2]);
    });
  }
  // The lines that answer a question best, for when the AI cannot.
  function matchLines(q, facts) {
    var toks = words(q).filter(function (w) { return !STOP[w]; });
    var scored = facts.lines.map(function (l) {
      var s = screenById(l.s);
      var hay = (l.k + ' ' + l.v + ' ' + (s ? s.label + ' ' + s.words : '')).toLowerCase();
      var sc = 0;
      toks.forEach(function (t) { if (hay.indexOf(t) >= 0) sc += (l.k.toLowerCase().indexOf(t) >= 0 ? 3 : 1); });
      return { l: l, sc: sc };
    }).filter(function (x) { return x.sc > 0; }).sort(function (a, b) { return b.sc - a.sc; });
    if (scored.length) return scored.slice(0, 6).map(function (x) { return x.l; });
    return facts.lines.filter(function (l) { return /^Waiting on you/.test(l.k) && Number(l.v) > 0; }).slice(0, 6);
  }
  function askServer(mode, q, facts) {
    return fetch('/api/admin/assist', { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ mode: mode, q: q, facts: facts }) })
      .then(function (r) {
        if (r.status === 401) { if (typeof handleAuthFailure === 'function') handleAuthFailure(); throw new Error('unauthorized'); }
        return r.json().catch(function () { return { ok: false, error: 'The answer could not be read.' }; }).then(function (j) { if (!r.ok) throw new Error((j && j.error) || ('The server said ' + r.status)); return j; });
      });
  }

  // ---------- the Ask box ----------
  var pal = null, palInput = null, palList = null, palBody = null, palOpener = null, items = [], cursor = 0, asking = 0;
  var SUGGEST = ['What needs me today?', 'How much have we taken online today?', 'How many people chose a paid pass and have not paid?', 'How many have checked in?'];
  function buildPalette() {
    if (pal) return;
    pal = document.createElement('div');
    pal.id = 'as-palette';
    pal.setAttribute('hidden', '');
    pal.innerHTML =
      '<div class="as-pal-scrim" data-as-close></div>' +
      '<div class="as-pal-box" role="dialog" aria-modal="true" aria-label="Ask AI or go to a screen">' +
        '<div class="as-pal-top">' +
          '<i class="fas fa-wand-magic-sparkles as-pal-spark" aria-hidden="true"></i>' +
          '<input id="as-pal-input" type="text" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="go" ' +
            'placeholder="Ask about the event, or type a screen’s name" role="combobox" aria-expanded="true" aria-controls="as-pal-list" aria-autocomplete="list">' +
          '<button type="button" class="as-pal-x" data-as-close aria-label="Close"><i class="fas fa-xmark"></i></button>' +
        '</div>' +
        '<div class="as-pal-body" id="as-pal-body"><div id="as-pal-answer"></div><div id="as-pal-list" role="listbox" aria-label="Results"></div></div>' +
        '<div class="as-pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span>' +
          '<span class="as-pal-privacy"><i class="fas fa-lock"></i> The AI is given totals only: never a name, an email or a phone number.</span></div>' +
      '</div>';
    document.body.appendChild(pal);
    palInput = $('#as-pal-input', pal);
    palList = $('#as-pal-list', pal);
    palBody = $('#as-pal-answer', pal);
    pal.addEventListener('click', function (e) {
      if (e.target.closest('[data-as-close]')) { close(); return; }
      var opt = e.target.closest('[data-as-i]');
      if (opt) { choose(Number(opt.getAttribute('data-as-i'))); return; }
      var q = e.target.closest('[data-as-q]');
      if (q) { palInput.value = q.getAttribute('data-as-q'); ask(palInput.value); return; }
      var g = e.target.closest('[data-as-go]');
      if (g) { close(); go(g.getAttribute('data-as-go')); }
    });
    palInput.addEventListener('input', function () { palBody.innerHTML = ''; renderList(); });
    palInput.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(cursor); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    // Keep Tab inside the box while it is open.
    pal.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var f = $$('button, input, [href], [tabindex]:not([tabindex="-1"])', pal).filter(function (x) { return x.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }
  function optionHTML(it, i) {
    var badge = it.kind === 'ask' ? '<span class="as-opt-kind as-opt-ai">AI</span>' : it.kind === 'action' ? '<span class="as-opt-kind">Do</span>' : '<span class="as-opt-kind">Go</span>';
    return '<div class="as-opt' + (i === cursor ? ' is-on' : '') + '" role="option" id="as-opt-' + i + '" aria-selected="' + (i === cursor) + '" data-as-i="' + i + '">' +
      '<span class="as-opt-icon' + (it.kind === 'ask' ? ' is-ai' : '') + '"><i class="fas ' + esc(it.icon) + '"></i></span>' +
      '<span class="as-opt-text"><b>' + esc(it.title) + '</b>' + (it.sub ? '<small>' + esc(it.sub) + '</small>' : '') + '</span>' +
      (it.count ? '<span class="as-opt-count">' + esc(it.count) + '</span>' : '') + badge + '</div>';
  }
  function renderList() {
    var q = palInput.value.trim();
    items = [];
    var html = '';
    if (!q) {
      html += '<div class="as-pal-sec">Ask</div><div class="as-chips">' + SUGGEST.map(function (s) { return '<button type="button" class="as-chip" data-as-q="' + esc(s) + '"><i class="fas fa-wand-magic-sparkles"></i>' + esc(s) + '</button>'; }).join('') + '</div>';
      var waiting = state.board ? waitingItems(state.board).filter(function (w) { return w.n > 0; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 5) : [];
      if (waiting.length) {
        html += '<div class="as-pal-sec">Waiting on you</div>';
        waiting.forEach(function (w) { var s = screenById(w.go); items.push({ kind: 'go', id: w.go, icon: s ? s.icon : 'fa-circle', title: w.label.charAt(0).toUpperCase() + w.label.slice(1), sub: s ? s.label : '', count: num(w.n) }); });
        html += items.map(optionHTML).join('');
      }
      var recent = store.get('as_recent', []).filter(function (id) { return screenById(id) && id !== section(); }).slice(0, 4);
      if (recent.length) {
        var from = items.length;
        recent.forEach(function (id) { var s = screenById(id); items.push({ kind: 'go', id: id, icon: s.icon, title: s.label, sub: s.group || 'Recent' }); });
        html += '<div class="as-pal-sec">Recent</div>' + items.slice(from).map(function (it, j) { return optionHTML(it, from + j); }).join('');
      }
      var start = items.length;
      screens().forEach(function (s) { if (recent.indexOf(s.id) < 0) items.push({ kind: 'go', id: s.id, icon: s.icon, title: s.label, sub: s.group }); });
      html += '<div class="as-pal-sec">All screens</div>' + items.slice(start).map(function (it, j) { return optionHTML(it, start + j); }).join('');
    } else {
      var qItem = { kind: 'ask', q: q, icon: 'fa-wand-magic-sparkles', title: 'Ask AI: “' + q + '”', sub: 'Answered from the dashboard’s own numbers' };
      var sc = matchScreens(q).map(function (s) { return { kind: 'go', id: s.id, icon: s.icon, title: s.label, sub: s.desc && s.desc !== s.label ? s.desc : s.group }; });
      var ac = matchActions(q).map(function (a) { return { kind: 'action', run: a.run, icon: a.icon, title: a.label }; });
      // A question asks first; a screen's name goes first.
      items = looksLikeQuestion(q) || !sc.length ? [qItem].concat(sc, ac) : sc.concat(ac, [qItem]);
      html = items.map(optionHTML).join('');
    }
    // Nothing is chosen until an arrow is pressed on the empty box, so Enter there
    // does not jump somewhere by itself; with words typed the first line is chosen.
    cursor = q && items.length ? 0 : -1;
    palList.innerHTML = html;
    highlight();
  }
  function highlight() {
    $$('.as-opt', palList).forEach(function (el) {
      var on = Number(el.getAttribute('data-as-i')) === cursor;
      el.classList.toggle('is-on', on);
      el.setAttribute('aria-selected', String(on));
      if (on) { palInput.setAttribute('aria-activedescendant', el.id); if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); }
    });
  }
  function move(d) { if (!items.length) return; cursor = cursor < 0 ? (d > 0 ? 0 : items.length - 1) : (cursor + d + items.length) % items.length; highlight(); }
  function choose(i) {
    var it = i >= 0 ? items[i] : null;
    if (!it) { if (palInput.value.trim()) ask(palInput.value.trim()); return; }
    if (it.kind === 'ask') { ask(it.q); return; }
    close();
    if (it.kind === 'action') it.run();
    else go(it.id);
  }
  function linesHTML(lines) {
    return '<ul class="as-lines">' + lines.map(function (l) {
      var s = screenById(l.s);
      return '<li><span class="as-line-k">' + esc(l.k) + '</span><span class="as-line-v">' + esc(typeof l.v === 'number' ? num(l.v) : l.v) + '</span>' +
        (s ? '<button type="button" class="as-line-go" data-as-go="' + esc(s.id) + '" aria-label="Open ' + esc(s.label) + '"><i class="fas fa-chevron-right"></i></button>' : '') + '</li>';
    }).join('') + '</ul>';
  }
  function openButtons(ids) {
    var seen = {};
    var list = (ids || []).filter(function (id) { if (seen[id] || !screenById(id)) return false; seen[id] = 1; return true; }).slice(0, 3);
    if (!list.length) return '';
    return '<div class="as-open">' + list.map(function (id) { var s = screenById(id); return '<button type="button" class="as-open-btn" data-as-go="' + esc(id) + '"><i class="fas ' + esc(s.icon) + '"></i>Open ' + esc(s.label) + '<i class="fas fa-arrow-right"></i></button>'; }).join('') + '</div>';
  }
  function ask(q) {
    q = String(q || '').trim();
    if (!q) return;
    var mine = ++asking;
    palList.innerHTML = '';
    items = [];
    palBody.innerHTML = '<div class="as-answer is-loading" aria-live="polite"><div class="as-answer-q">' + esc(q) + '</div><div class="as-dots"><span></span><span></span><span></span></div><p class="as-answer-meta">Reading the dashboard…</p></div>';
    var facts = null;
    getFacts().then(function (f) { facts = f; return askServer('ask', q, f); }).then(function (r) {
      if (mine !== asking) return;
      if (r && r.ai && r.answer) {
        palBody.innerHTML = '<div class="as-answer" aria-live="polite"><div class="as-answer-q">' + esc(q) + '</div>' +
          '<div class="as-answer-text">' + esc(r.answer).replace(/\n+/g, '<br>') + '</div>' + openButtons(r.open) +
          '<p class="as-answer-meta"><i class="fas fa-wand-magic-sparkles"></i> Written by AI from the dashboard’s numbers as of ' + esc(facts.asOf) + '. Every number in it was checked against them.</p></div>';
      } else {
        var why = r && r.why === 'unchecked_numbers' ? 'The AI’s answer had a number the dashboard does not show, so it is not shown. These are the dashboard’s own numbers:'
          : 'The AI is not reachable right now. These are the dashboard’s own numbers for that:';
        var lines = matchLines(q, facts);
        var ids = (r && r.open || []).concat(lines.map(function (l) { return l.s; }));
        palBody.innerHTML = '<div class="as-answer" aria-live="polite"><div class="as-answer-q">' + esc(q) + '</div><p class="as-answer-why">' + why + '</p>' + linesHTML(lines) + openButtons(ids) +
          '<p class="as-answer-meta">As of ' + esc(facts.asOf) + '.</p></div>';
      }
    }).catch(function (err) {
      if (mine !== asking || (err && err.message === 'unauthorized')) return;
      palBody.innerHTML = '<div class="as-answer"><div class="as-answer-q">' + esc(q) + '</div><p class="as-answer-why is-err"><i class="fas fa-exclamation-triangle"></i> ' + esc((err && err.message) || 'That did not work.') + '</p>' +
        '<button type="button" class="as-open-btn" data-as-q="' + esc(q) + '"><i class="fas fa-rotate-right"></i>Try again</button></div>';
    });
  }
  function open(q) {
    if (!signedIn()) return;
    buildPalette();
    palOpener = document.activeElement;
    pal.removeAttribute('hidden');
    document.documentElement.classList.add('as-pal-open');
    palBody.innerHTML = '';
    palInput.value = q || '';
    cursor = 0;
    renderList();
    // Focused now, not on the next tick: a key pressed straight after Ctrl+K must land here.
    try { palInput.focus({ preventScroll: true }); } catch (_) { palInput.focus(); }
    if (q) ask(q);
    // Warm the numbers so the first question does not wait for them.
    if (!state.board || Date.now() - state.boardAt > 180000) getFacts().then(function () { if (!palInput.value) renderList(); }).catch(function () {});
  }
  function close() {
    if (!pal || pal.hasAttribute('hidden')) return;
    asking++;
    pal.setAttribute('hidden', '');
    document.documentElement.classList.remove('as-pal-open');
    if (palOpener && palOpener.focus && document.body.contains(palOpener)) { try { palOpener.focus(); } catch (_) {} }
  }
  function isOpen() { return !!pal && !pal.hasAttribute('hidden'); }

  // ---------- sidebar groups ----------
  function navInit() {
    var closed = store.get('as_nav_closed', []);
    $$('#sidebar .as-nav-group').forEach(function (g) {
      var id = g.getAttribute('data-group');
      if (closed.indexOf(id) >= 0 && !g.querySelector('.sidebar-active')) setGroup(g, false);
    });
    var sb = document.getElementById('sidebar');
    if (sb) sb.addEventListener('click', function (e) {
      var lab = e.target.closest('.as-group-label');
      if (!lab) return;
      var g = lab.closest('.as-nav-group');
      var nowOpen = g.classList.contains('as-closed');
      setGroup(g, nowOpen);
      var list = store.get('as_nav_closed', []).filter(function (x) { return x !== g.getAttribute('data-group'); });
      if (!nowOpen) list.push(g.getAttribute('data-group'));
      store.set('as_nav_closed', list);
    });
  }
  function setGroup(g, on) {
    g.classList.toggle('as-closed', !on);
    var lab = g.querySelector('.as-group-label');
    if (lab) lab.setAttribute('aria-expanded', String(on));
  }

  // ---------- phone tab bar ----------
  var TABS = { overview: 1, attendees: 1, inquiries: 1 };
  function markTabs(sec) {
    $$('#as-tabbar [data-as-tab]').forEach(function (b) {
      var t = b.getAttribute('data-as-tab');
      var on = t === sec || (t === 'menu' && !TABS[sec]);
      b.classList.toggle('is-active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  }
  function setInboxCount(n) {
    var el = document.getElementById('as-tab-inbox-n');
    if (!el) return;
    el.textContent = n > 99 ? '99+' : String(n);
    el.hidden = !(n > 0);
  }

  // ---------- the Overview ----------
  var brief = (function () { try { return JSON.parse(sessionStorage.getItem('as_brief') || 'null'); } catch (_) { return null; } })();
  var briefBusy = false, briefFailedAt = 0;
  var BRIEF_FOR = 15 * 60000;
  function briefPlain(b) {
    var w = waitingItems(b).filter(function (x) { return x.n > 0; }).sort(function (a, c) { return c.n - a.n; });
    var total = waitingTotal(b);
    var passes = (b && b.passes) || [];
    var today = passes.reduce(function (s, p) { return s + Number(p.today || 0); }, 0);
    var sold = ((b && b.money && b.money.sold) || []);
    var paidN = sold.reduce(function (s, x) { return s + Number(x.today_n || 0); }, 0);
    var paidP = sold.reduce(function (s, x) { return s + Number(x.today_paise || 0); }, 0);
    var first = total ? (num(total) + (total === 1 ? ' thing is' : ' things are') + ' waiting on you. The biggest: ' + w.slice(0, 2).map(function (x) { return num(x.n) + ' ' + x.short; }).join(' and ') + '.')
      : 'Nothing is waiting on you right now.';
    var second = 'Today so far: ' + num(today) + ' registered' + (paidN ? ', ' + num(paidN) + ' paid online (' + inr(paidP) + ')' : '') + '.';
    return first + ' ' + second;
  }
  function briefChips(b) {
    return waitingItems(b).filter(function (x) { return x.n > 0; }).sort(function (a, c) { return c.n - a.n; }).slice(0, 4).map(function (x) {
      return '<button type="button" class="as-brief-chip" data-as-go="' + esc(x.go) + '"><b>' + num(x.n) + '</b> ' + esc(x.short) + '<i class="fas fa-chevron-right"></i></button>';
    }).join('');
  }
  function renderBrief() {
    var el = document.getElementById('ov-brief');
    if (!el) return;
    var b = state.board;
    var card = el.querySelector('.as-brief');
    var useAi = brief && brief.ai && brief.day === new Date().toDateString() && Date.now() - brief.at < BRIEF_FOR * 2;
    var text = useAi ? brief.text : (b ? briefPlain(b) : '');
    var meta = useAi ? '<i class="fas fa-wand-magic-sparkles"></i> Written by AI at ' + esc(brief.hhmm) + ' from the numbers below; every number checked'
      : (b ? 'From the numbers below, as of ' + esc(b.as_of || nowHHMM()) + (briefBusy ? ' · the AI is writing a summary…' : '') : 'Reading the dashboard…');
    var textHTML = text ? '<p class="as-brief-text">' + esc(text) + '</p>' : '<div class="as-dots"><span></span><span></span><span></span></div>';
    if (card) {
      card.querySelector('.as-brief-meta').innerHTML = meta;
      card.querySelector('.as-brief-body').innerHTML = textHTML;
      card.querySelector('.as-brief-chips').innerHTML = b ? briefChips(b) : '';
      return;
    }
    el.innerHTML =
      '<section class="as-brief" aria-label="Today at a glance">' +
        '<div class="as-brief-head"><span class="as-brief-icon" aria-hidden="true"><i class="fas fa-wand-magic-sparkles"></i></span>' +
          '<div class="as-brief-title"><h3>Today at a glance</h3><p class="as-brief-meta">' + meta + '</p></div>' +
          '<button type="button" class="as-brief-again" data-as-brief-again title="Ask the AI to write it again" aria-label="Write the summary again"><i class="fas fa-sync-alt"></i></button></div>' +
        '<div class="as-brief-body" aria-live="polite">' + textHTML + '</div>' +
        '<div class="as-brief-chips">' + (b ? briefChips(b) : '') + '</div>' +
        '<form class="as-brief-ask" data-as-brief-form role="search"><i class="fas fa-wand-magic-sparkles" aria-hidden="true"></i>' +
          '<input type="text" name="q" autocomplete="off" enterkeyhint="send" aria-label="Ask about the event" placeholder="Ask about the event, e.g. How much came in today?">' +
          '<button type="submit">Ask</button></form>' +
      '</section>';
  }
  function refreshBrief(force) {
    var b = state.board;
    if (!b || briefBusy) return;
    var fresh = brief && brief.ai && brief.day === new Date().toDateString() && Date.now() - brief.at < BRIEF_FOR;
    if (!force && (fresh || Date.now() - briefFailedAt < BRIEF_FOR)) return;
    briefBusy = true;
    renderBrief();
    askServer('brief', '', factsFrom(b, state.event, state.stats)).then(function (r) {
      if (r && r.ai && r.answer) {
        brief = { ai: true, text: r.answer, at: Date.now(), hhmm: nowHHMM(), day: new Date().toDateString() };
        try { sessionStorage.setItem('as_brief', JSON.stringify(brief)); } catch (_) {}
      } else { briefFailedAt = Date.now(); }
    }).catch(function () { briefFailedAt = Date.now(); }).then(function () { briefBusy = false; renderBrief(); });
  }
  var JUMPS = [
    ['Waiting on you', function () { return headingCard('#ov-board', /Waiting on you/); }],
    ['Passes', function () { return document.getElementById('ov-board'); }],
    ['Money', function () { return headingCard('#ov-board', /Money/); }],
    ['Stuck people', function () { return document.getElementById('help-funnel'); }],
    ['Audience', function () { return document.getElementById('ov-audience'); }],
    ['Organisations', function () { return document.getElementById('ov-orgs'); }],
    ['Sources & campus', function () { return document.getElementById('ov-sources'); }],
    ['Lunch & emails', function () { return document.getElementById('ov-lunch'); }],
    ['Engagement', function () { return document.getElementById('ov-engagement'); }],
    ['RSVP', function () { return document.getElementById('ov-rsvp'); }],
    ['Thank-you email', function () { var e = document.getElementById('ov-thanks'); return e && !e.hidden ? e : null; }],
    ['Recent', function () { return document.getElementById('ov-recent'); }],
  ];
  function headingCard(root, re) {
    var r = $(root);
    if (!r) return null;
    var h = $$('h3', r).filter(function (x) { return re.test(x.textContent || ''); })[0];
    return h ? (h.closest('.glass') || h) : null;
  }
  function renderJump() {
    var el = document.getElementById('ov-jump');
    if (!el) return;
    // The thank-you card is on the page but hidden until the event is over: no button to it then.
    var thanks = document.getElementById('ov-thanks');
    el.innerHTML = '<span class="as-jump-lab">Jump to</span>' + JUMPS.map(function (j, i) {
      if (j[0] === 'Thank-you email' && (!thanks || thanks.hidden)) return '';
      return '<button type="button" class="as-jump-btn" data-as-jump="' + i + '">' + esc(j[0]) + '</button>';
    }).join('');
  }
  function jump(i) {
    var j = JUMPS[i];
    var t = j && j[1]();
    if (!t) { if (typeof toast === 'function') toast('That part has not loaded yet', 'info'); return; }
    t.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
  }

  // ---------- keyboard and clicks, once ----------
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
      if (!signedIn()) return;
      e.preventDefault();
      if (isOpen()) close(); else open();
    } else if (e.key === 'Escape' && isOpen()) {
      e.preventDefault();
      close();
    }
  });
  document.addEventListener('click', function (e) {
    var o = e.target.closest('[data-as-open]');
    if (o) { e.preventDefault(); open(); return; }
    var g = e.target.closest('#ov-brief [data-as-go]');
    if (g) { go(g.getAttribute('data-as-go')); return; }
    var j = e.target.closest('[data-as-jump]');
    if (j) { jump(Number(j.getAttribute('data-as-jump'))); return; }
    if (e.target.closest('[data-as-brief-again]')) { briefFailedAt = 0; refreshBrief(true); }
  });
  document.addEventListener('submit', function (e) {
    var f = e.target.closest('[data-as-brief-form]');
    if (!f) return;
    e.preventDefault();
    var q = (f.querySelector('input') || {}).value || '';
    if (q.trim()) open(q.trim());
  });
  // The header's height, so the Overview's "Jump to" bar can stick just under it.
  function measure() {
    var h = document.querySelector('#main-content > header');
    if (h) document.documentElement.style.setProperty('--as-header-h', h.offsetHeight + 'px');
  }
  window.addEventListener('resize', measure);

  window.AdminShell = {
    open: open,
    close: close,
    ask: function (q) { open(q); },
    openMenu: function () { if (typeof openMobileSidebar === 'function') openMobileSidebar(); },
    // Called by switchSection() on every move.
    onSection: function (sec) {
      markTabs(sec);
      var btn = document.querySelector('#sidebar [data-section="' + sec + '"]');
      var g = btn && btn.closest('.as-nav-group');
      if (g && g.classList.contains('as-closed')) setGroup(g, true);
      var r = store.get('as_recent', []).filter(function (x) { return x !== sec; });
      r.unshift(sec);
      store.set('as_recent', r.slice(0, 6));
      if (isOpen()) close();
    },
    // Called by loadOverview() each time it draws, and by loadBoard() with the board.
    onOverview: function (st) { if (st) { state.stats = st; state.statsAt = Date.now(); } measure(); renderBrief(); renderJump(); },
    gotBoard: function (b, ev) {
      if (!b || !Array.isArray(b.passes)) return;
      state.board = b; state.boardAt = Date.now();
      if (ev) state.event = ev;
      var t = b.todo || {};
      setInboxCount(Number(t.inquiries_new || 0));
      renderBrief();
      refreshBrief(false);
    },
    gotStats: function (st) { if (st) { state.stats = st; state.statsAt = Date.now(); } },
    // For the tests: the same rules the page uses, without the page.
    _test: { looksLikeQuestion: looksLikeQuestion, matchScreens: function (q) { return matchScreens(q).map(function (s) { return s.id; }); }, factsFrom: factsFrom, matchLines: matchLines, briefPlain: briefPlain, waitingTotal: waitingTotal },
  };

  navInit();
  measure();
  // A Mac's key is Cmd: say so on the top bar's hint (both keys work everywhere).
  try {
    if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '')) {
      var kbd = document.querySelector('#as-ask-btn kbd');
      if (kbd) kbd.textContent = '⌘K';
    }
  } catch (_) {}
  markTabs(section());
  if (document.getElementById('ov-brief')) window.AdminShell.onOverview();
})();
