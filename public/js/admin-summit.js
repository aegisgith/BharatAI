/* Admin, AI Agent Summit 2027 (event 3, 15 Nov 2026). The summit's own dashboard inside
 * the Bharat AI admin: headline numbers, who registered (with Confirm for Buyer and
 * Investor passes), showcase applications and partner enquiries.
 *
 * Data: GET /api/admin/agent-summit/overview; Confirm: POST /api/admin/agent-summit/passes/:id/confirm
 * (routes/agent-summit.ts). Applications and partner enquiries are worked on the
 * Inquiries desk; this screen lists them and opens the desk on their type.
 *
 * On the day (26 Nov 2026): tabs Problem board, On the day and Report, from
 * GET /api/admin/agent-summit/day and /report: publish buyers' problems, the running order
 * and the room's scoring, voting links, Break the agent, and the Agents of India report switch.
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
  var day = null;
  var rep = null;

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

  // ---- On the day (26 Nov 2026) ----
  function boardTab() {
    if (!day) return '<p class="asd-empty">Loading the problem board...</p>';
    var list = day.problems || [];
    var up = list.filter(function (p) { return p.published_at; }).length;
    var head = '<div class="asd-bar"><span class="asd-count">' + num(list.length) + ' problems sent, ' + num(up) + ' on the board</span>'
      + '<a class="asd-btn" href="/ai-agent-summit/problems#board" target="_blank" rel="noopener"><i class="fas fa-external-link-alt" aria-hidden="true"></i> See the board</a></div>'
      + '<p class="asd-sub">Tidy the words if you need to, then put a problem on the board. The sender is emailed the first time it goes up. Their company is named only if they said so.</p>';
    if (!list.length) return head + '<p class="asd-empty">No problems yet. Buyers send them at /ai-agent-summit/problems.</p>';
    return head + '<div class="asd-wrap"><table class="asd-table"><thead><tr><th>As sent</th><th>Words on the board</th><th>From</th><th>On the board</th></tr></thead><tbody>'
      + list.map(function (p) {
        return '<tr><td><div class="asd-sub">' + esc(p.sector) + '</div>' + esc(p.problem) + (p.volume ? '<div class="asd-sub">How often: ' + esc(p.volume) + '</div>' : '') + '<div class="asd-sub">' + ist(p.created_at) + '</div></td>'
          + '<td><textarea class="asd-text" data-board-text="' + Number(p.id) + '" rows="4" aria-label="Words on the board">' + esc(p.board_text || p.problem) + '</textarea></td>'
          + '<td>' + esc(p.name) + '<div class="asd-sub">' + esc(p.company) + (p.show_name ? ', may be named' : ', keep off the board') + '</div><div class="asd-sub">' + esc(p.email) + '</div></td>'
          + '<td class="asd-nowrap">' + (p.published_at
            ? '<span class="asd-ok">Since ' + ist(p.published_at) + '</span><div class="asd-acts2"><button type="button" class="asd-btn" data-act="pb-save" data-id="' + Number(p.id) + '">Save words</button><button type="button" class="asd-btn" data-act="pb-hide" data-id="' + Number(p.id) + '">Take it down</button></div>'
            : '<button type="button" class="asd-btn asd-primary" data-act="pb-publish" data-id="' + Number(p.id) + '">Put on the board</button>') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function dayTab() {
    if (!day) return '<p class="asd-empty">Loading...</p>';
    var v = day.voters || {};
    var out = '';
    if (!day.ready) {
      out += '<div class="asd-note"><b>Run migration 0067 first.</b> Until it runs, the running order, the scores and Break the agent cannot be saved. In a terminal, in the app folder:'
        + '<pre class="asd-pre">' + esc(day.migration) + '</pre></div>';
    }
    out += '<div class="asd-block"><h4>Voting links</h4><p class="asd-sub">' + num(v.eligible) + ' passes come with a vote (Delegate, VIP and Academic paid; Buyer and Investor confirmed). '
      + num(v.sent) + ' have been emailed their link. Each click emails up to ' + num(v.per_click) + ' more. People can also ask for their link on the voting page.</p>'
      + '<div class="asd-acts2"><button type="button" class="asd-btn asd-primary" data-act="vote-links"' + (v.eligible > v.sent ? '' : ' disabled') + '>' + (v.eligible > v.sent ? 'Email the next ' + num(Math.min(v.per_click, v.eligible - v.sent)) : v.eligible ? 'Everyone has their link' : 'No one with a vote yet') + '</button>'
      + '<a class="asd-btn" href="/ai-agent-summit/vote" target="_blank" rel="noopener">Open the voting page</a></div></div>';
    var slots = day.slots || [];
    out += '<div class="asd-block"><h4>Running order and scoring</h4><p class="asd-sub">Open scoring for a slot when its ten minutes end, and close it when the next one ends. A slot shows on the hall screen once '
      + num(day.min_votes) + ' people have scored it. <a class="asd-link" href="/ai-agent-summit/screen" target="_blank" rel="noopener">Open the hall screen</a></p>'
      + '<div class="asd-row"><textarea class="asd-text" id="asd-slot-lines" rows="3" placeholder="One per line: Company | Agent" aria-label="Companies to add"></textarea>'
      + '<button type="button" class="asd-btn" data-act="slots-add"' + (day.ready ? '' : ' disabled') + '>Add to the running order</button></div>';
    if (slots.length) {
      out += '<div class="asd-wrap"><table class="asd-table"><thead><tr><th>#</th><th>Company and agent</th><th>Scoring</th><th>Votes</th><th>Score</th><th></th></tr></thead><tbody>'
        + slots.map(function (s) {
          var st = s.state === 'open' ? '<span class="asd-ok">Open now</span>' : s.state === 'closed' ? '<span class="asd-muted">Closed</span>' : '<span class="asd-muted">Waiting</span>';
          var b = s.state === 'open'
            ? '<button type="button" class="asd-btn" data-act="slot-state" data-state="closed" data-id="' + Number(s.id) + '">Close scoring</button>'
            : '<button type="button" class="asd-btn asd-primary" data-act="slot-state" data-state="open" data-id="' + Number(s.id) + '">' + (s.state === 'closed' ? 'Reopen' : 'Open scoring') + '</button>';
          if (!Number(s.votes)) b += '<button type="button" class="asd-btn" data-act="slot-delete" data-id="' + Number(s.id) + '">Remove</button>';
          return '<tr><td>' + num(s.position) + '</td><td><b>' + esc(s.company) + '</b><div class="asd-sub">' + esc(s.agent) + '</div></td><td>' + st + '</td><td>' + num(s.votes) + '</td>'
            + '<td>' + (s.score != null ? Number(s.score).toFixed(2) : '') + '</td><td><div class="asd-acts2">' + b + '</div></td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    out += '</div>';
    var br = day.breaks || [];
    out += '<div class="asd-block"><h4>Break the agent</h4><p class="asd-sub">Record a break once the company at the booth has confirmed it. The hall screen shows who has the most.</p>'
      + '<div class="asd-row"><input class="asd-in" id="asd-br-who" placeholder="Who broke it (shown on screen)" maxlength="80" aria-label="Who broke it">'
      + '<input class="asd-in" id="asd-br-agent" placeholder="Which agent" maxlength="120" aria-label="Which agent">'
      + '<input class="asd-in" id="asd-br-what" placeholder="What it did, in one line" maxlength="200" aria-label="What it did">'
      + '<button type="button" class="asd-btn asd-primary" data-act="break-add"' + (day.ready ? '' : ' disabled') + '>Record the break</button></div>';
    if (br.length) {
      out += '<div class="asd-wrap"><table class="asd-table"><thead><tr><th>Who</th><th>Agent</th><th>What</th><th>When</th><th></th></tr></thead><tbody>'
        + br.map(function (b) {
          return '<tr><td><b>' + esc(b.breaker) + '</b></td><td>' + esc(b.agent) + '</td><td>' + esc(b.what) + '</td><td class="asd-nowrap">' + ist(b.created_at) + '</td>'
            + '<td><button type="button" class="asd-btn" data-act="break-del" data-id="' + Number(b.id) + '">Remove</button></td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    return out + '</div>';
  }

  function reportTab() {
    if (!rep) return '<p class="asd-empty">Loading the report...</p>';
    var t = function (title, list) {
      if (!list || !list.length) return '';
      return '<div class="asd-rp"><h4>' + esc(title) + '</h4>' + list.map(function (x) { return '<div class="asd-rp-row"><span>' + esc(x.label) + '</span><b>' + num(x.n) + '</b></div>'; }).join('') + '</div>';
    };
    return '<div class="asd-bar"><span class="asd-count">' + (rep.published ? '<span class="asd-ok">Public</span> at /ai-agent-summit/report' : 'Not public: the page says it launches on stage on 16 April') + '</span>'
      + '<div class="asd-acts2"><button type="button" class="asd-btn' + (rep.published ? '' : ' asd-primary') + '" data-act="report-toggle">' + (rep.published ? 'Take the report down' : 'Publish the report') + '</button>'
      + '<a class="asd-btn" href="/ai-agent-summit/report" target="_blank" rel="noopener">Open the page</a></div></div>'
      + '<p class="asd-sub">' + num(rep.applications) + ' showcase applications and ' + num(rep.teams) + ' challenge teams so far. A group smaller than ' + num(rep.min_group)
      + ' is left out of every table, here and on the page, so no company can be picked out.</p>'
      + '<div class="asd-rp-grid">' + t('What the agents do', rep.categories) + t('How far along', rep.stages) + t('Languages', rep.languages) + t('Cities', rep.cities)
      + t('Team size', rep.team_sizes) + t('Founded', rep.founded) + t('Challenge team size', rep.challenge_sizes) + '</div>';
  }

  async function loadDay() {
    try { day = await opts.api.get('/api/admin/agent-summit/day'); if (!day || !day.ok) throw new Error((day && day.error) || 'No answer'); }
    catch (e) { day = null; toast('Could not load On the day: ' + (e && e.message), 'error'); }
    draw();
  }
  async function loadReport() {
    try { rep = await opts.api.get('/api/admin/agent-summit/report'); if (!rep || !rep.ok) throw new Error((rep && rep.error) || 'No answer'); }
    catch (e) { rep = null; toast('Could not load the report: ' + (e && e.message), 'error'); }
    draw();
  }
  async function dayPost(path, body, okMsg, after) {
    try {
      var r = await opts.api.post(path, body || {});
      if (r && r.ok) { if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg); }
      else toast((r && r.error) || 'That did not work.', 'error');
    } catch (e) { toast('That did not work: ' + (e && e.message), 'error'); }
    if (after) await after(); else await loadDay();
  }

  function draw() {
    if (!host) return;
    var d = data || {};
    var s = d.sales || {};
    var passes = d.passes || [];
    var tabs = [['passes', 'Passes', num(passes.length)], ['apps', 'Showcase applications', num((d.applications || []).length)], ['partners', 'Partner enquiries', num((d.partners || []).length)],
      ['board', 'Problem board', day ? num((day.problems || []).length) : ''], ['day', 'On the day', ''], ['report', 'Report', '']];
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
      + (tab === 'passes' ? passesTable(passes) : tab === 'apps' ? appsTable(d.applications || []) : tab === 'partners' ? partnersTable(d.partners || [])
        : tab === 'board' ? boardTab() : tab === 'day' ? dayTab() : reportTab())
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
    if (b.dataset.tab) {
      tab = b.dataset.tab; draw();
      if ((tab === 'board' || tab === 'day') && !day) loadDay();
      if (tab === 'report' && !rep) loadReport();
      return;
    }
    var act = b.dataset.act;
    if (act === 'reload') { load(); if (day) loadDay(); if (rep) loadReport(); return; }
    var did = Number(b.dataset.id);
    if (act === 'pb-publish' || act === 'pb-save' || act === 'pb-hide') {
      var ta = host.querySelector('[data-board-text="' + did + '"]');
      if (act === 'pb-hide' && !w.confirm('Take this problem off the board?')) return;
      b.disabled = true;
      await dayPost('/api/admin/agent-summit/problems/' + did + '/publish', { publish: act !== 'pb-hide', text: ta ? ta.value : undefined },
        function (r) { return act === 'pb-hide' ? 'Taken off the board.' : act === 'pb-save' ? 'Words saved.' : 'On the board.' + (r.emailed ? ' The sender has been emailed.' : ''); });
      return;
    }
    if (act === 'vote-links') {
      if (!w.confirm('Email voting links to the next people with a vote?')) return;
      b.disabled = true;
      await dayPost('/api/admin/agent-summit/vote-links', {}, function (r) { return 'Emailed ' + num(r.sent) + (r.failed ? ', ' + num(r.failed) + ' failed' : '') + '. ' + num(r.left) + ' still to send.'; });
      return;
    }
    if (act === 'slots-add') {
      var lines = (host.querySelector('#asd-slot-lines') || {}).value || '';
      if (!lines.trim()) { toast('Write one company per line, as Company | Agent.', 'error'); return; }
      b.disabled = true;
      await dayPost('/api/admin/agent-summit/slots', { lines: lines }, function (r) { return 'Added ' + num(r.added) + ' to the running order.'; });
      return;
    }
    if (act === 'slot-state') {
      b.disabled = true;
      await dayPost('/api/admin/agent-summit/slots/' + did, { state: b.dataset.state }, b.dataset.state === 'open' ? 'Scoring is open. Voters see it within 15 seconds.' : 'Scoring closed.');
      return;
    }
    if (act === 'slot-delete') {
      if (!w.confirm('Remove this slot from the running order?')) return;
      await dayPost('/api/admin/agent-summit/slots/' + did, { delete: true }, 'Removed.');
      return;
    }
    if (act === 'break-add') {
      var who = (host.querySelector('#asd-br-who') || {}).value || '', ag = (host.querySelector('#asd-br-agent') || {}).value || '', wh = (host.querySelector('#asd-br-what') || {}).value || '';
      if (who.trim().length < 2 || ag.trim().length < 2) { toast('Write who broke it and which agent.', 'error'); return; }
      b.disabled = true;
      await dayPost('/api/admin/agent-summit/breaks', { breaker: who, agent: ag, what: wh }, 'Break recorded. It is on the hall screen.');
      return;
    }
    if (act === 'break-del') {
      if (!w.confirm('Remove this break from the leaderboard?')) return;
      await dayPost('/api/admin/agent-summit/breaks/' + did + '/delete', {}, 'Removed.');
      return;
    }
    if (act === 'report-toggle') {
      var on = !(rep && rep.published);
      if (!w.confirm(on ? 'Publish the Agents of India report? Anyone can then see it at /ai-agent-summit/report.' : 'Take the report down? The page goes back to saying it launches on 16 April.')) return;
      await dayPost('/api/admin/agent-summit/report', { publish: on }, on ? 'The report is public.' : 'The report is down.', loadReport);
      return;
    }
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
