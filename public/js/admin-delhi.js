/* Admin, Delhi 2027 (12 Nov 2026): partner and discount codes for Delhi passes.
 *
 * Make a code (whose it is, the percentage off, 0 to only count sales, which passes,
 * the last day, how many paid uses), pause it, copy the partner's link (the form opens
 * with the code filled in), and see what each code has sold and who bought with it.
 * The server decides every price (GET /api/delhi/code, POST /api/delhi/pay).
 *
 * The admin page loads this file the first time the section opens and calls
 * DelhiDesk.mount(element, { api, toast }). One global, DelhiDesk.
 */
(function (w) {
  'use strict';

  var opts = null;
  var host = null;
  var data = null;
  var busy = false;
  var open = '';

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function rs(paise) { return '&#8377;' + (Number(paise || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
  function toast(msg, type) { if (opts && opts.toast) opts.toast(esc(msg), type || 'success'); }
  function short(p) { return String(p).replace(' Pass', '').replace('Premium Delegate', 'Premium'); }

  function formHtml(passes) {
    return '<form class="dld-form" id="dld-form" novalidate>'
      + '<div class="dld-grid">'
      + '<label>Code<input name="code" maxlength="24" autocomplete="off" spellcheck="false" placeholder="NASSCOM20" required></label>'
      + '<label>Whose code<input name="partner" maxlength="120" placeholder="Partner, community or campaign" required></label>'
      + '<label>% off<input name="percent" type="number" min="0" max="90" step="1" value="10"><small>0 only counts sales</small></label>'
      + '<label>Last day<input name="valid_until" type="date"><small>Empty: no end</small></label>'
      + '<label>Paid uses<input name="max_uses" type="number" min="0" step="1" value="0"><small>0: no limit</small></label>'
      + '<label class="dld-wide">Note<input name="note" maxlength="500" placeholder="For your team only"></label>'
      + '</div>'
      + '<fieldset class="dld-passes"><legend>Passes it works for (none ticked: all)</legend>'
      + passes.map(function (p) { return '<label><input type="checkbox" name="passes" value="' + esc(p) + '"> ' + esc(p) + '</label>'; }).join('')
      + '</fieldset>'
      + '<button type="submit" class="dld-btn dld-primary">Make the code</button>'
      + '</form>';
  }

  function draw() {
    var d = data || {};
    var codes = d.codes || [];
    var head = '<div class="dld-card"><h2><i class="fas fa-ticket" aria-hidden="true"></i> Codes for Delhi passes</h2>'
      + '<p class="dld-lead">A code takes a percentage off a Delhi pass, or nothing at all if you only want to count what a partner sells. Send the partner its link: the form opens with the code filled in. Codes are for new passes, not for moving up. The price is always worked out on the server.</p>'
      + (d.ready === false ? '<p class="dld-warn">The code tables are not in the database yet. Apply migration 0061 first.</p>' : formHtml(d.passes || []))
      + '</div>';
    var rows = codes.map(function (c) {
      var passes = String(c.passes || '') ? String(c.passes).split(',').map(short).join(', ') : 'All';
      var uses = Number(c.paid || 0) + (Number(c.max_uses) ? ' of ' + Number(c.max_uses) : '');
      var state = Number(c.active) ? '<span class="dld-ok">Active</span>' : '<span class="dld-off">Paused</span>';
      var row = '<tr><td><b>' + esc(c.code) + '</b><div class="dld-sub">' + esc(c.partner) + '</div>' + (c.note ? '<div class="dld-sub">' + esc(c.note) + '</div>' : '') + '</td>'
        + '<td class="dld-n">' + (Number(c.percent) ? Number(c.percent) + '%' : 'none') + '</td><td>' + esc(passes) + '</td><td>' + esc(c.valid_until || 'No end') + '</td>'
        + '<td class="dld-n">' + uses + '<div class="dld-sub">' + Number(c.started || 0) + ' started</div></td><td class="dld-n">' + rs(c.paid_paise) + '<div class="dld-sub">' + rs(c.discount_paise) + ' off</div></td>'
        + '<td>' + state + '</td>'
        + '<td class="dld-acts"><button type="button" class="dld-btn" data-act="copy" data-link="' + esc(c.link) + '" data-code="' + esc(c.code) + '">Copy link</button>'
        + '<button type="button" class="dld-btn" data-act="buyers" data-code="' + esc(c.code) + '">' + (open === c.code ? 'Hide buyers' : 'Buyers') + '</button>'
        + '<button type="button" class="dld-btn" data-act="toggle" data-code="' + esc(c.code) + '" data-active="' + (Number(c.active) ? '1' : '0') + '">' + (Number(c.active) ? 'Pause' : 'Start again') + '</button></td></tr>';
      if (open === c.code) row += '<tr class="dld-buyers"><td colspan="8" id="dld-buyers">Loading...</td></tr>';
      return row;
    }).join('');
    var table = codes.length
      ? '<div class="dld-wrap"><table class="dld-table"><thead><tr><th>Code</th><th class="dld-n">Off</th><th>Passes</th><th>Last day</th><th class="dld-n">Paid uses</th><th class="dld-n">Received</th><th>Status</th><th><span class="dld-sr">Actions</span></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      : (d.ready === false ? '' : '<p class="dld-note">No codes yet.</p>');
    host.innerHTML = '<div class="dld">' + head + table + '</div>';
    if (open) loadBuyers(open);
  }

  async function loadBuyers(code) {
    var cell = document.getElementById('dld-buyers');
    try {
      var r = await opts.api.get('/api/admin/delhi/codes/' + encodeURIComponent(code) + '/orders');
      var list = (r && r.results) || [];
      if (!cell || open !== code) return;
      cell.innerHTML = list.length
        ? '<table class="dld-inner"><thead><tr><th>Name</th><th>Organisation</th><th>Email</th><th>Pass</th><th>Order</th><th class="dld-n">Amount</th></tr></thead><tbody>'
          + list.map(function (o) { return '<tr><td>' + esc(o.name) + '</td><td>' + esc(o.company) + '</td><td>' + esc(o.email) + '</td><td>' + esc(o.pass_type) + '</td><td>' + esc(o.status === 'paid' ? 'Paid' : 'Not paid (' + o.status + ')') + '</td><td class="dld-n">' + rs(o.amount_paise) + '</td></tr>'; }).join('')
          + '</tbody></table>'
        : 'Nobody has used this code yet.';
    } catch (e) { if (cell) cell.textContent = 'The buyers did not load: ' + (e.message || ''); }
  }

  async function refresh() {
    try { data = await opts.api.get('/api/admin/delhi/codes'); }
    catch (e) { data = { codes: [] }; toast('The codes did not load: ' + (e.message || ''), 'error'); }
    draw();
  }

  async function onSubmit(e) {
    if (!e.target || e.target.id !== 'dld-form') return;
    e.preventDefault();
    if (busy) return;
    var f = e.target;
    var body = {
      code: f.code.value.trim().toUpperCase(), partner: f.partner.value.trim(), percent: Number(f.percent.value || 0),
      valid_until: f.valid_until.value, max_uses: Number(f.max_uses.value || 0), note: f.note.value.trim(),
      passes: Array.prototype.map.call(f.querySelectorAll('input[name="passes"]:checked'), function (x) { return x.value; })
    };
    if (!body.code) { toast('Type the code.', 'error'); f.code.focus(); return; }
    if (!body.partner) { toast('Say whose code it is.', 'error'); f.partner.focus(); return; }
    var words = body.percent ? body.percent + '% off' : 'no discount (it only counts sales)';
    if (!w.confirm('Make the code ' + body.code + ' for ' + body.partner + ', ' + words + '? Anyone who has it can use it on the Delhi form.')) return;
    busy = true;
    try {
      await opts.api.post('/api/admin/delhi/codes', body);
      toast('Code ' + body.code + ' is ready.');
      await refresh();
    } catch (err) { toast((err && err.message) || 'The code was not made.', 'error'); }
    busy = false;
  }

  async function onClick(e) {
    var b = e.target.closest('[data-act]');
    if (!b || !host.contains(b) || busy) return;
    var act = b.getAttribute('data-act');
    var code = b.getAttribute('data-code');
    if (act === 'copy') {
      var link = b.getAttribute('data-link');
      try { await navigator.clipboard.writeText(link); toast('Copied the link for ' + code + '.'); }
      catch (err) { w.prompt('Copy the link for ' + code + ':', link); }
    } else if (act === 'buyers') {
      open = open === code ? '' : code;
      draw();
    } else if (act === 'toggle') {
      var on = b.getAttribute('data-active') === '1';
      if (!w.confirm(on ? 'Pause ' + code + '? Nobody can use it until you start it again.' : 'Start ' + code + ' again?')) return;
      busy = true;
      try { await opts.api.put('/api/admin/delhi/codes/' + encodeURIComponent(code), { active: !on }); toast(code + (on ? ' is paused.' : ' works again.')); await refresh(); }
      catch (err) { toast((err && err.message) || 'That did not save.', 'error'); }
      busy = false;
    }
  }

  async function mount(el, o) {
    opts = o;
    if (host !== el) {
      host = el;
      host.addEventListener('click', onClick);
      host.addEventListener('submit', onSubmit);
    }
    if (!host.querySelector('.dld')) host.innerHTML = '<div class="dld"><p class="dld-note">Loading...</p></div>';
    await refresh();
  }

  w.DelhiDesk = { mount: mount, _t: { esc: esc, rs: rs } };
})(window);
