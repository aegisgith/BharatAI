/* Admin, AI Agent Summit 2027 (event 3, 15 Nov 2026). The summit's own dashboard inside
 * the Bharat AI admin: headline numbers, who registered (with Confirm for Buyer and
 * Investor passes), showcase applications and partner enquiries.
 *
 * Data: GET /api/admin/agent-summit/overview; Confirm: POST /api/admin/agent-summit/passes/:id/confirm
 * (routes/agent-summit.ts). Applications and partner enquiries are worked on the
 * Inquiries desk; this screen lists them and opens the desk on their type.
 *
 * The admin page loads this file the first time the section opens and calls
 * SummitDesk.mount(element, { api, toast, openInquiries }). One global, SummitDesk.
 */
(function (w) {
  'use strict';

  var opts = null;
  var host = null;
  var data = null;
  var tab = 'passes';
  var q = '';
  var show = 'all';

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function rs(paise) { return '&#8377;' + (Number(paise || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 }); }
  function num(n) { return Number(n || 0).toLocaleString('en-IN'); }
  function toast(msg, type) { if (opts && opts.toast) opts.toast(esc(msg), type || 'success'); }
  function ist(s) {
    if (!s) return '';
    var d = new Date(String(s).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(s)) ? '' : 'Z'));
    if (isNaN(d)) return esc(s);
    return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  var STATUS = { 'new': 'New', responded: 'Replied', in_progress: 'In talks', won: 'Won', lost: 'Lost', closed: 'Closed', waitlisted: 'Waitlisted' };

  function passState(a) {
    var badge = String(a.badge_type || '');
    if (badge === 'Buyer Pass' || badge === 'Investor Pass') {
      return a.confirmed_at ? { key: 'confirmed', html: '<span class="asd-ok">Confirmed</span>' } : { key: 'check', html: '<span class="asd-warn">To confirm</span>' };
    }
    if (Number(a.paid_paise || 0) > 0) return { key: 'paid', html: '<span class="asd-ok">Paid ' + rs(a.paid_paise) + '</span>' };
    if (String(a.payment_status || '').toLowerCase() === 'pending') return { key: 'unpaid', html: '<span class="asd-off">Not paid' + (a.last_order ? ' (' + esc(a.last_order) + ')' : '') + '</span>' };
    return { key: 'free', html: '<span class="asd-muted">Free</span>' };
  }

  function tiles(s) {
    var t = [
      ['fa-users', num(s.registered), 'Registrations', 'all passes'],
      ['fa-indian-rupee-sign', rs(s.paise), 'Received online', num(s.passes_paid != null ? s.passes_paid : s.paid) + ' paid passes' + (s.packages_paid ? ', ' + num(s.packages_paid) + ' showcase packages' : '')],
      ['fa-user-check', num(s.review), 'To confirm', 'Buyer and Investor passes'],
      ['fa-robot', num(s.applications), 'Showcase applications', num(s.applications_new) + ' new'],
      ['fa-handshake', num(s.partners), 'Partner enquiries', 'Sponsorship'],
    ];
    return '<div class="asd-tiles">' + t.map(function (x) {
      return '<div class="asd-tile"><i class="fas ' + x[0] + '" aria-hidden="true"></i><b>' + x[1] + '</b><span>' + x[2] + '</span><small>' + x[3] + '</small></div>';
    }).join('') + '</div>';
  }

  function mix(passes) {
    var order = ['Visitor Pass', 'Delegate Pass', 'VIP Pass', 'Academic Pass', 'Buyer Pass', 'Investor Pass'];
    var by = {};
    passes.forEach(function (a) { by[a.badge_type] = (by[a.badge_type] || 0) + 1; });
    var max = Math.max.apply(null, order.map(function (k) { return by[k] || 0; }).concat([1]));
    return '<div class="asd-mix">' + order.map(function (k) {
      var n = by[k] || 0;
      return '<div class="asd-mixrow"><span>' + esc(k.replace(' Pass', '')) + '</span><i style="width:' + Math.round(n / max * 100) + '%"></i><b>' + num(n) + '</b></div>';
    }).join('') + '</div>';
  }

  function passesTable(passes) {
    var needle = q.toLowerCase();
    var rows = passes.filter(function (a) {
      var st = passState(a).key;
      if (show === 'check' && st !== 'check') return false;
      if (show === 'paid' && st !== 'paid') return false;
      if (show === 'unpaid' && st !== 'unpaid') return false;
      if (show.indexOf('pass:') === 0 && a.badge_type !== show.slice(5)) return false;
      if (!needle) return true;
      return [a.name, a.email, a.mobile, a.company, a.job_title, a.city].join(' ').toLowerCase().indexOf(needle) !== -1;
    });
    var filter = '<div class="asd-bar">'
      + '<input type="search" id="asd-q" placeholder="Search name, email, mobile, company" value="' + esc(q) + '">'
      + '<select id="asd-show">'
      + [['all', 'Everyone'], ['check', 'To confirm'], ['paid', 'Paid'], ['unpaid', 'Not paid yet'], ['pass:Visitor Pass', 'Visitor'], ['pass:Delegate Pass', 'Delegate'], ['pass:VIP Pass', 'VIP'], ['pass:Academic Pass', 'Academic'], ['pass:Buyer Pass', 'Buyer'], ['pass:Investor Pass', 'Investor']]
        .map(function (o) { return '<option value="' + esc(o[0]) + '"' + (show === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('')
      + '</select>'
      + '<span class="asd-count">' + num(rows.length) + ' of ' + num(passes.length) + '</span>'
      + '<button type="button" class="asd-btn" data-act="csv"><i class="fas fa-download" aria-hidden="true"></i> CSV</button>'
      + '</div>';
    if (!rows.length) return filter + '<p class="asd-empty">' + (passes.length ? 'Nobody matches.' : 'Nobody has registered for the AI Agent Summit yet. The form is at /ai-agent-summit/attend.') + '</p>';
    return filter + '<div class="asd-wrap"><table class="asd-table"><thead><tr><th>Person</th><th>Organisation</th><th>Pass</th><th>Status</th><th>Registered</th><th></th></tr></thead><tbody>'
      + rows.map(function (a) {
        var st = passState(a);
        return '<tr><td><b>' + esc(a.name) + '</b><div class="asd-sub">' + esc(a.email) + ' &middot; ' + esc(a.mobile) + '</div></td>'
          + '<td>' + esc(a.company) + (a.job_title ? '<div class="asd-sub">' + esc(a.job_title) + '</div>' : '') + (a.city ? '<div class="asd-sub">' + esc(a.city) + '</div>' : '') + '</td>'
          + '<td>' + esc(a.badge_type) + '</td><td>' + st.html + '</td><td class="asd-nowrap">' + ist(a.registration_date) + '</td>'
          + '<td>' + (st.key === 'check' ? '<button type="button" class="asd-btn asd-primary" data-act="confirm" data-id="' + Number(a.id) + '">Confirm</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  // How many of a package's slots are paid (a custom booth takes an Enterprise slot), or its rate.
  function slotText(pk, k) {
    var p = pk[k] || {};
    if (!p.slots) return p.per_sqft ? ' (Rs ' + num(p.per_sqft) + ' a sq ft)' : '';
    var sold = Number(p.sold) || 0;
    Object.keys(pk).forEach(function (o) { if (pk[o].shares === k) sold += Number(pk[o].sold) || 0; });
    return ' (' + num(sold) + ' of ' + num(p.slots) + ' paid)';
  }

  // Accept and send the pay link, send it again, or paid (26 Nov 2026). The package can be
  // changed before accepting: the select starts on the one they applied for (an application
  // for the old pod starts on the first package). A custom booth also takes its size.
  function payCell(r) {
    if (r.paid_at) return '<span class="asd-pill asd-s-won">Paid ' + rs(r.paid_paise) + '</span><div class="asd-sub">' + ist(r.paid_at) + '</div>';
    var pk = (data && data.packages) || {};
    var cur = r.accepted_package || r.package_key;
    if (!pk[cur]) cur = Object.keys(pk)[0];
    var sel = '<select class="asd-pkg" data-pkg-for="' + Number(r.id) + '" aria-label="Package for ' + esc(r.agent) + '">' + Object.keys(pk).map(function (k) {
      return '<option value="' + esc(k) + '"' + (k === cur ? ' selected' : '') + '>' + esc(pk[k].label + slotText(pk, k)) + '</option>';
    }).join('') + '</select>'
      + '<input type="number" class="asd-sqft" data-sqft-for="' + Number(r.id) + '" min="200" max="2000" step="1" value="' + (Number(r.sqft) || 200) + '" title="Booth size in sq ft" aria-label="Booth size in sq ft for ' + esc(r.agent) + '"' + (pk[cur] && pk[cur].per_sqft ? '' : ' hidden') + '>';
    var price = r.price_inr ? '<div class="asd-sub">&#8377;' + num(r.price_inr) + ' + GST</div>' : '';
    if (r.accepted_at) {
      return '<span class="asd-pill">Link sent</span><div class="asd-sub">' + ist(r.link_sent_at) + '</div>' + price + sel
        + '<button type="button" class="asd-btn" data-act="accept" data-id="' + Number(r.id) + '">Resend link</button>';
    }
    return price + sel + '<button type="button" class="asd-btn asd-primary" data-act="accept" data-id="' + Number(r.id) + '">Accept and send pay link</button>';
  }

  function appsTable(apps) {
    var head = '<div class="asd-bar"><span class="asd-count">' + num(apps.length) + ' applications</span>'
      + '<button type="button" class="asd-btn" data-act="desk" data-type="agent_showcase"><i class="fas fa-inbox" aria-hidden="true"></i> Work them on the Enquiries desk</button></div>';
    if (!apps.length) return head + '<p class="asd-empty">No showcase applications yet. The form is at /ai-agent-summit/showcase.</p>';
    return head + '<div class="asd-wrap"><table class="asd-table"><thead><tr><th>Agent</th><th>Package</th><th>Category and stage</th><th>Contact</th><th>Payment</th><th>Status</th><th>Received</th></tr></thead><tbody>'
      + apps.map(function (r) {
        return '<tr><td><b>' + esc(r.agent) + '</b><div class="asd-sub">' + esc(r.company) + '</div><div class="asd-sub asd-clip">' + esc(r.summary) + '</div>'
          + (r.demo_url ? '<a class="asd-link" href="' + esc(/^https?:/i.test(r.demo_url) ? r.demo_url : 'https://' + r.demo_url) + '" target="_blank" rel="noopener">Demo link</a>' : '') + '</td>'
          + '<td>' + esc(r.package) + (r.sqft ? '<div class="asd-sub">' + num(r.sqft) + ' sq ft</div>' : '') + '</td><td>' + esc(r.category) + '<div class="asd-sub">' + esc(r.stage) + '</div></td>'
          + '<td>' + esc(r.contact) + '<div class="asd-sub">' + esc(r.email) + '</div><div class="asd-sub">' + esc(r.phone) + '</div></td>'
          + '<td class="asd-pay">' + payCell(r) + '</td>'
          + '<td><span class="asd-pill asd-s-' + esc(r.status) + '">' + esc(STATUS[r.status] || r.status) + '</span></td><td class="asd-nowrap">' + ist(r.created_at) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function partnersTable(list) {
    var head = '<div class="asd-bar"><span class="asd-count">' + num(list.length) + ' partner enquiries</span>'
      + '<button type="button" class="asd-btn" data-act="desk" data-type="sponsorship"><i class="fas fa-inbox" aria-hidden="true"></i> Work them on the Enquiries desk</button></div>';
    if (!list.length) return head + '<p class="asd-empty">No partner enquiries yet. The form is at /ai-agent-summit/partners.</p>';
    return head + '<div class="asd-wrap"><table class="asd-table"><thead><tr><th>Who</th><th>Interested in</th><th>Contact</th><th>Status</th><th>Received</th></tr></thead><tbody>'
      + list.map(function (r) {
        return '<tr><td><b>' + esc(r.name) + '</b><div class="asd-sub">' + esc(r.company) + (r.job_title ? ', ' + esc(r.job_title) : '') + '</div></td>'
          + '<td>' + esc(r.tier) + '</td><td>' + esc(r.email) + '<div class="asd-sub">' + esc(r.phone) + '</div></td>'
          + '<td><span class="asd-pill asd-s-' + esc(r.status) + '">' + esc(STATUS[r.status] || r.status) + '</span></td><td class="asd-nowrap">' + ist(r.created_at) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function draw() {
    if (!host) return;
    var d = data || {};
    var s = d.sales || {};
    var passes = d.passes || [];
    var tabs = [['passes', 'Passes', num(passes.length)], ['apps', 'Showcase applications', num((d.applications || []).length)], ['partners', 'Partner enquiries', num((d.partners || []).length)]];
    host.innerHTML = '<div class="asd">'
      + '<div class="asd-card asd-head"><div><h2><i class="fas fa-robot" aria-hidden="true"></i> AI Agent Summit 2027</h2>'
      + '<p class="asd-lead">Friday 16 April 2027, World Trade Center Mumbai. Event 3 in this app: passes and payments run through the same checkout, receipts and invoices as Mumbai.</p></div>'
      + '<div class="asd-acts"><a class="asd-btn" href="/ai-agent-summit/" target="_blank" rel="noopener"><i class="fas fa-external-link-alt" aria-hidden="true"></i> Open the summit site</a>'
      + '<button type="button" class="asd-btn" data-act="reload"><i class="fas fa-rotate" aria-hidden="true"></i> Refresh</button></div></div>'
      + tiles(s)
      + '<div class="asd-card"><h3>Pass mix</h3>' + mix(passes) + '</div>'
      + '<div class="asd-card"><div class="asd-tabs" role="tablist">' + tabs.map(function (t) {
        return '<button type="button" role="tab" class="asd-tab' + (tab === t[0] ? ' on' : '') + '" aria-selected="' + (tab === t[0]) + '" data-tab="' + t[0] + '">' + esc(t[1]) + ' <span>' + t[2] + '</span></button>';
      }).join('') + '</div>'
      + (tab === 'passes' ? passesTable(passes) : tab === 'apps' ? appsTable(d.applications || []) : partnersTable(d.partners || []))
      + '</div></div>';
    var qi = host.querySelector('#asd-q');
    if (qi) qi.addEventListener('input', function () { q = qi.value; var pos = qi.selectionStart; draw(); var n = host.querySelector('#asd-q'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} } });
    var si = host.querySelector('#asd-show');
    if (si) si.addEventListener('change', function () { show = si.value; draw(); });
  }

  function csv() {
    var cols = ['name', 'email', 'mobile', 'company', 'job_title', 'city', 'industry', 'badge_type', 'payment_status', 'paid_paise', 'confirmed_at', 'registration_source', 'registration_date'];
    var cell = function (v) { var s = String(v == null ? '' : v); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    var body = [cols.join(',')].concat(((data && data.passes) || []).map(function (a) { return cols.map(function (k) { return cell(a[k]); }).join(','); })).join(String.fromCharCode(10));
    var link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([body], { type: 'text/csv' }));
    link.download = 'ai-agent-summit-2027-passes.csv';
    document.body.appendChild(link); link.click(); link.remove();
  }

  async function load() {
    try {
      data = await opts.api.get('/api/admin/agent-summit/overview');
      if (!data || !data.sales) throw new Error((data && data.error) || 'No answer');
      draw();
    } catch (e) {
      host.innerHTML = '<div class="asd"><div class="asd-card"><p class="asd-off">Could not load the AI Agent Summit numbers: ' + esc(e && e.message) + '</p><button type="button" class="asd-btn" data-act="reload">Try again</button></div></div>';
    }
  }

  async function onClick(ev) {
    var b = ev.target.closest('[data-act],[data-tab]');
    if (!b || !host.contains(b)) return;
    if (b.dataset.tab) { tab = b.dataset.tab; draw(); return; }
    var act = b.dataset.act;
    if (act === 'reload') { load(); return; }
    if (act === 'csv') { csv(); return; }
    if (act === 'desk') { if (opts.openInquiries) opts.openInquiries(b.dataset.type); return; }
    if (act === 'accept') {
      var aid = Number(b.dataset.id);
      var row = ((data && data.applications) || []).filter(function (x) { return Number(x.id) === aid; })[0] || {};
      var pick = host.querySelector('[data-pkg-for="' + aid + '"]');
      var pkg = pick ? pick.value : '';
      var chosen = ((data && data.packages) || {})[pkg] || {};
      var sizeEl = host.querySelector('[data-sqft-for="' + aid + '"]');
      var sqft = chosen.per_sqft && sizeEl ? Math.floor(Number(sizeEl.value) || 0) : 0;
      if (chosen.per_sqft && (sqft < 200 || sqft > 2000)) { toast('Enter the booth size, from 200 to 2,000 sq ft.', 'error'); return; }
      var label = (chosen.label || 'the package') + (sqft ? ', ' + num(sqft) + ' sq ft at Rs ' + num(sqft * chosen.per_sqft) + ' + GST' : '');
      var again = !!row.accepted_at;
      if (!w.confirm((again ? 'Send the payment link again for ' + (row.agent || 'this application') + ' (' + label + ')?' : 'Accept ' + (row.agent || 'this application') + ' for the ' + label + '?')
        + ' ' + (row.contact || 'The contact') + ' (' + (row.email || '') + ') is emailed a link to pay online.')) return;
      b.disabled = true;
      try {
        var x = await opts.api.post('/api/admin/agent-summit/applications/' + aid + '/accept', { package: pkg, sqft: sqft || undefined });
        if (x && x.paid) { toast('That one is paid already.'); load(); }
        else if (x && x.ok && x.link) {
          var copied = false;
          try { await navigator.clipboard.writeText(x.link); copied = true; } catch (e) { /* the email has it */ }
          toast((again ? 'Link sent again: ' : 'Accepted: ') + x.package + ', Rs ' + num(x.total_inr) + ' with GST. Emailed' + (copied ? ', and the link is copied to share on WhatsApp.' : '.'));
          load();
        } else { toast((x && x.error) || 'Could not accept.', 'error'); b.disabled = false; }
      } catch (e) { toast('Could not accept: ' + (e && e.message), 'error'); b.disabled = false; }
      return;
    }
    if (act === 'confirm') {
      var id = Number(b.dataset.id);
      var person = ((data && data.passes) || []).filter(function (a) { return Number(a.id) === id; })[0] || {};
      if (!w.confirm('Confirm the ' + (person.badge_type || 'pass') + ' for ' + (person.name || 'this person') + '? They are emailed that it is confirmed.')) return;
      b.disabled = true;
      try {
        var r = await opts.api.post('/api/admin/agent-summit/passes/' + id + '/confirm', {});
        if (r && (r.ok || r.already)) { toast(r.already ? 'Already confirmed.' : 'Confirmed. ' + (person.name || 'They') + ' has been emailed.'); load(); }
        else { toast((r && r.error) || 'Could not confirm.', 'error'); b.disabled = false; }
      } catch (e) { toast('Could not confirm: ' + (e && e.message), 'error'); b.disabled = false; }
    }
  }

  // The size box shows only for a package priced by the square foot (the custom booth).
  function onChange(ev) {
    var s = ev.target && ev.target.closest ? ev.target.closest('.asd-pkg') : null;
    if (!s || !host.contains(s)) return;
    var box = host.querySelector('[data-sqft-for="' + s.getAttribute('data-pkg-for') + '"]');
    if (box) box.hidden = !((((data && data.packages) || {})[s.value] || {}).per_sqft);
  }

  w.SummitDesk = {
    mount: async function (el, o) {
      opts = o || {};
      if (host !== el) { host = el; host.addEventListener('click', onClick); host.addEventListener('change', onChange); }
      if (!data) host.innerHTML = '<div class="text-center py-12 text-gray-500">Loading...</div>';
      await load();
    }
  };
})(window);
