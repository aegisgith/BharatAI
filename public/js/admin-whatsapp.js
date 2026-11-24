/* Admin, WhatsApp (23 Nov 2026): send from the event's own WhatsApp Business number.
 *
 * Send:     photos (each person's own), a pass, or a picture / announcement the team
 *           wrote; who gets it, how it reads, a test to your own phone, then the send.
 * Replies:  everyone who wrote back; answer them (free for 24 hours after they write).
 * Sent:     every message with its state: waiting, sent, delivered, read, tapped, failed.
 * Messages: the words WhatsApp must approve before we may send them, and writing a new one.
 * Setup:    the five values from Meta, the webhook, the connection check, the limits.
 *
 * The server is src/routes/whatsapp.ts. The admin page loads this file the first time
 * the section opens and calls WaDesk.mount(element, { api, toast, authHeaders }).
 * One global, WaDesk.
 */
(function (w) {
  'use strict';

  var opts = null, host = null, D = null;
  var tab = 'send', busy = false, timer = null;
  var draft = { kind: 'photos', template: '', audience: 'everyone', event: 1, pass: '', list: '', number: '', name: '', only_new: true };
  var aud = null, audError = '', audKey = '';
  var inbox = null, thread = null, log = null, logStatus = '', logBatch = 0, logQ = '', own = null, ownShow = false;
  var inboxFilter = 'all', inboxQ = '', quickEdit = false, pickTpl = '';
  var mcpNew = null; // the key's command, shown once after it is made
  var form = null, testTo = '', checkResult = null, first = true;
  try { testTo = w.localStorage.getItem('wa_test_to') || ''; } catch (e) { testTo = ''; }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function num(n) { return Number(n || 0).toLocaleString('en-IN'); }
  function toast(msg, type) { if (opts && opts.toast) opts.toast(esc(msg), type || 'success'); }
  function people(n) { return n === 1 ? '1 person' : num(n) + ' people'; }
  function onPhone() { return /Android|iPhone|iPad|iPod/i.test(w.navigator.userAgent || ''); }

  // SQLite's UTC stamp as a time in India: 23 Nov, 4:05 pm.
  function when(s) {
    if (!s) return '';
    var d = new Date(String(s).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(s)) ? '' : 'Z'));
    if (isNaN(d.getTime())) return '';
    try { return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); } catch (e) { return d.toISOString().slice(0, 16).replace('T', ' '); }
  }

  var STATUS = {
    queued: ['Waiting', 'wait'], sending: ['Sending', 'wait'], sent: ['Sent', 'sent'], delivered: ['Delivered', 'good'], read: ['Read', 'good'],
    failed: ['Not delivered', 'bad'], skipped: ['Left out', 'muted'], cancelled: ['Cancelled', 'muted'], received: ['Received', 'sent']
  };
  var TPL_STATUS = {
    draft: ['Not sent to WhatsApp yet', 'muted'], PENDING: ['Waiting for WhatsApp to approve', 'wait'], APPROVED: ['Approved', 'good'],
    REJECTED: ['Refused by WhatsApp', 'bad'], PAUSED: ['Paused by WhatsApp', 'bad'], DISABLED: ['Switched off by WhatsApp', 'bad'],
    IN_APPEAL: ['Being looked at again', 'wait'], LIMIT_EXCEEDED: ['Too many messages on the account', 'bad'], ARCHIVED: ['Archived', 'muted'], DELETED: ['Deleted', 'muted'], PENDING_DELETION: ['Being deleted', 'muted']
  };
  function chip(pair, text) { return '<span class="wad-chip wad-' + pair[1] + '">' + esc(text || pair[0]) + '</span>'; }
  function statusChip(s) { return chip(STATUS[s] || [s, 'muted']); }
  function tplChip(s) { return chip(TPL_STATUS[s] || [s, 'muted']); }
  function kindWords(k) { return { photos: 'Photos', pass: 'Pass', custom: 'Announcement', reply: 'Reply', auto: 'Automatic' }[k] || k; }
  // Meta says PENDING (or anything but CONNECTED) until the number is registered for the Cloud API.
  function notRegistered(ck) { return !!(ck && ck.number_status && String(ck.number_status).toUpperCase() !== 'CONNECTED'); }
  function categoryWords(c) { return String(c).toUpperCase() === 'UTILITY' ? 'Service message (lower cost)' : 'Marketing message'; }

  // How a batch stands, from its counts.
  function batchNumbers(b) {
    var c = b.counts || {};
    var gone = (c.sent || 0) + (c.delivered || 0) + (c.read || 0);
    return { total: Number(b.total || 0), waiting: (c.queued || 0) + (c.sending || 0), gone: gone, delivered: (c.delivered || 0) + (c.read || 0), read: c.read || 0,
      failed: c.failed || 0, left: (c.skipped || 0) + (c.cancelled || 0), taps: Number(b.taps || 0), replied: Number(b.replied || 0),
      looked: Number(b.looked_after || 0), saved: Number(b.saved_after || 0),
      pct: b.total ? Math.round(((gone + (c.failed || 0) + (c.skipped || 0) + (c.cancelled || 0)) / b.total) * 100) : 0 };
  }
  function batchStatusWords(b) {
    if (b.status === 'running') return ['Sending', 'wait'];
    if (b.status === 'paused') return [b.note ? 'Stopped' : 'Paused', b.note ? 'bad' : 'muted'];
    if (b.status === 'cancelled') return ['Cancelled', 'muted'];
    return ['Finished', 'good'];
  }

  // The message as it looks on a phone: what is on top, the words, the STOP line, the buttons.
  var BTN_ICON = { url: 'fa-arrow-up-right-from-square', phone: 'fa-phone', reply: 'fa-reply' };
  function bubble(p) {
    if (!p) return '';
    var h = p.header || {};
    var top = p.image || (h.type === 'image' && h.url) ? '<img src="' + esc(p.image || h.url) + '" alt="" loading="lazy">'
      : h.type === 'video' ? '<div class="wad-media"><i class="fas fa-play" aria-hidden="true"></i><span>' + esc(h.filename || 'Video') + '</span></div>'
      : h.type === 'document' ? '<div class="wad-media wad-media-doc"><i class="fas fa-file" aria-hidden="true"></i><span>' + esc(h.filename || 'Document.pdf') + '</span></div>'
      : h.type === 'text' && h.text ? '<b class="wad-bubble-top">' + esc(h.text) + '</b>' : '';
    var btns = p.buttons && p.buttons.length ? p.buttons : (p.button ? [{ type: 'url', text: p.button }] : []);
    return '<div class="wad-phone"><div class="wad-bubble">' + top
      + '<p>' + esc(p.text).replace(/\n/g, '<br>') + '</p>'
      + (p.footer ? '<small>' + esc(p.footer) + '</small>' : '')
      + btns.map(function (b) { return '<span class="wad-bubble-btn"><i class="fas ' + (BTN_ICON[b.type] || BTN_ICON.url) + '" aria-hidden="true"></i> ' + esc(b.text || '...') + '</span>'; }).join('')
      + '</div></div>';
  }
  var FIELD_SAMPLE = { name: 'Asha', pass: 'Delegate Pass', event: 'Bharat AI Innovation 2026' };
  var FOOTER_FOR = { en: 'Reply STOP to stop these messages', hi: 'ये संदेश बंद करने के लिए STOP लिखें' };
  function sortButtons(list) {
    return list.filter(function (b) { return b.type === 'reply'; }).concat(list.filter(function (b) { return b.type === 'url'; }), list.filter(function (b) { return b.type === 'phone'; }));
  }

  // ---------- top ----------

  function headHtml() {
    var d = D || {};
    if (d.ready === false) {
      return '<div class="wad-card"><p class="wad-warn">One step is left before this screen works: the WhatsApp tables are not in the database yet. Run this once in the project folder, then press Refresh.</p>'
        + '<pre class="wad-code">' + esc(d.command || '') + '</pre><div class="wad-actions"><button class="wad-btn" data-act="reload">Refresh</button></div></div>';
    }
    var ck = d.checked || {};
    var line = d.connected
      ? '<span class="wad-dot wad-dot-on"></span> Connected' + (ck.number ? ': sending from <b>' + esc(ck.number) + '</b>' + (ck.name ? ' (' + esc(ck.name) + ')' : '') : '. Press &ldquo;Check the connection&rdquo; in Setup to see the number.')
        + (notRegistered(ck) ? ' <b class="wad-bad">Nothing can be sent yet: the number is not registered with WhatsApp.</b> <button class="wad-link" data-act="tab" data-tab="setup">Register it in Setup</button>.' : '')
      : '<span class="wad-dot"></span> Not connected to WhatsApp yet. <button class="wad-link" data-act="tab" data-tab="setup">Open Setup</button> and follow the steps.';
    var t = d.totals || {}, s = d.settings || {};
    var tiles = [
      ['Waiting', (t.queued || 0) + (t.sending || 0)], ['Sent', (t.sent || 0) + (t.delivered || 0) + (t.read || 0)], ['Delivered', (t.delivered || 0) + (t.read || 0)],
      ['Read', t.read || 0], ['Tapped the button', t.taps || 0], ['Not delivered', t.failed || 0]
    ].map(function (x) { return '<div><b>' + num(x[1]) + '</b><span>' + x[0] + '</span></div>'; }).join('');
    var extra = d.connected ? '<p class="wad-note">Today: ' + num(d.used_today) + ' of ' + num(s.daily_limit) + ' people (WhatsApp&rsquo;s limit for our number in 24 hours). Bulk sends go between '
      + hour(s.hours_from) + ' and ' + hour(s.hours_to) + ' in India, ' + num(s.per_minute) + ' a minute.'
      + (s.sending === 'off' ? ' <b class="wad-bad">Sending is switched off in Setup.</b>' : (d.open_now ? '' : ' <b>It is outside those hours now, so bulk sends wait.</b>')) + '</p>' : '';
    return '<div class="wad-card"><p class="wad-status">' + line + '</p>' + (d.connected || (t.sent || t.delivered || t.read) ? '<div class="wad-stats">' + tiles + '</div>' : '') + extra + '</div>';
  }
  function hour(h) { h = Number(h); return (h % 12 === 0 ? 12 : h % 12) + (h < 12 || h === 24 ? ' am' : ' pm'); }

  function tabsHtml() {
    var list = [['send', 'Send'], ['replies', 'Replies' + (D && D.unread ? ' (' + num(D.unread) + ')' : '')], ['sent', 'Sent'], ['auto', 'Automatic'], ['messages', 'Messages'], ['setup', 'Setup']];
    return '<div class="wad-tabs" role="tablist">' + list.map(function (x) {
      return '<button role="tab" aria-selected="' + (tab === x[0]) + '" class="wad-tab' + (tab === x[0] ? ' wad-tab-on' : '') + '" data-act="tab" data-tab="' + x[0] + '">' + esc(x[1]) + '</button>';
    }).join('') + '</div>';
  }

  // ---------- Send ----------

  function templatesOf(kind) { return ((D && D.templates) || []).filter(function (t) { return t.kind === kind; }); }
  function chosenTemplate() {
    if (draft.kind !== 'custom') return templatesOf(draft.kind)[0] || null;
    var all = templatesOf('custom');
    return all.filter(function (t) { return t.name === draft.template; })[0] || null;
  }
  function specOf() {
    var a = draft.audience === 'pass' ? 'pass:' + draft.pass : draft.audience;
    return { kind: draft.kind, template: draft.template, event: Number(draft.event) || 1, audience: a, list: draft.list, number: draft.number, name: draft.name, only_new: !!draft.only_new };
  }
  function needsMore() {
    if (draft.kind === 'custom' && !draft.template) return 'Choose the message to send.';
    if (draft.kind === 'custom' && draft.audience === 'pass' && !draft.pass) return 'Type the name of the pass, for example Delegate Pass.';
    if (draft.kind === 'custom' && draft.audience === 'list' && !draft.list.trim()) return 'Paste the mobile numbers, one on each line.';
    if (draft.kind === 'custom' && draft.audience === 'one' && !draft.number.trim()) return 'Type the mobile number.';
    return '';
  }

  function sendHtml() {
    var kinds = [
      ['photos', 'fa-images', 'Photos', 'Each person found in the event photos gets one photo of themselves and a button to their own album.'],
      ['pass', 'fa-ticket', 'Pass', 'Tells each person their pass is ready, with a button that opens it.'],
      ['custom', 'fa-image', 'Picture or announcement', 'A creative, a date, a thank-you. You write it once in Messages; WhatsApp approves it; then it can go to many.']
    ].map(function (k) {
      return '<label class="wad-pick' + (draft.kind === k[0] ? ' wad-pick-on' : '') + '"><input type="radio" name="wad-kind" value="' + k[0] + '"' + (draft.kind === k[0] ? ' checked' : '') + ' data-field="kind">'
        + '<i class="fas ' + k[1] + '" aria-hidden="true"></i><b>' + k[2] + '</b><span>' + k[3] + '</span></label>';
    }).join('');
    var who = '';
    var events = ((D && D.events) || []);
    var eventPick = events.length > 1 ? '<label class="wad-field"><span>Which event</span><select data-field="event">' + events.map(function (e) {
      return '<option value="' + e.id + '"' + (Number(draft.event) === Number(e.id) ? ' selected' : '') + '>' + esc(e.title) + '</option>';
    }).join('') + '</select></label>' : '';
    var onlyNew = '<label class="wad-check"><input type="checkbox" data-field="only_new"' + (draft.only_new ? ' checked' : '') + '> Leave out anyone who was already sent this</label>';
    if (draft.kind === 'photos') {
      who = '<p class="wad-sub">Goes to everyone found in the Mumbai photos who has a mobile number on their registration. Speakers and guests of honour got theirs by email.</p>' + onlyNew;
    } else if (draft.kind === 'pass') {
      who = eventPick + '<p class="wad-sub">Goes to everyone holding a confirmed pass for that event. A pass still waiting for payment is left out.</p>' + onlyNew;
    } else {
      var all = templatesOf('custom');
      var options = all.map(function (t) {
        return '<option value="' + esc(t.name) + '"' + (t.name === draft.template ? ' selected' : '') + (t.status === 'APPROVED' ? '' : ' disabled') + '>' + esc(t.title) + (t.status === 'APPROVED' ? '' : ' (' + esc((TPL_STATUS[t.status] || [t.status])[0].toLowerCase()) + ')') + '</option>';
      }).join('');
      var auds = [['everyone', 'Everyone registered'], ['came', 'Everyone who came'], ['not_came', 'Registered but did not come'], ['pass', 'Holders of one pass'], ['said_yes', 'Everyone who ticked “Send me updates on WhatsApp”' + (D && D.said_yes ? ' (' + num(D.said_yes) + ')' : '')], ['list', 'A list of numbers I paste'], ['one', 'One number']];
      who = (all.length ? '<label class="wad-field"><span>Which message</span><select data-field="template"><option value="">Choose...</option>' + options + '</select></label>'
          : '<p class="wad-warn">Nothing is written yet. <button class="wad-link" data-act="tab" data-tab="messages">Open Messages</button> and write your picture or announcement first.</p>')
        + eventPick
        + '<fieldset class="wad-radios"><legend>Who gets it</legend>' + auds.map(function (a) {
          return '<label><input type="radio" name="wad-aud" value="' + a[0] + '"' + (draft.audience === a[0] ? ' checked' : '') + ' data-field="audience"> ' + a[1] + '</label>';
        }).join('') + '</fieldset>'
        + (draft.audience === 'pass' ? '<label class="wad-field"><span>Pass name, exactly as on the pass</span><input type="text" data-field="pass" value="' + esc(draft.pass) + '" placeholder="Delegate Pass"></label>' : '')
        + (draft.audience === 'list' ? '<label class="wad-field"><span>One on each line: name, mobile number</span><textarea rows="6" data-field="list" placeholder="Asha Mehta, 98765 43210">' + esc(draft.list) + '</textarea></label>' : '')
        + (draft.audience === 'one' ? '<div class="wad-two"><label class="wad-field"><span>Mobile number</span><input type="tel" data-field="number" value="' + esc(draft.number) + '" placeholder="98765 43210"></label>'
          + '<label class="wad-field"><span>Their name</span><input type="text" data-field="name" value="' + esc(draft.name) + '" placeholder="Asha Mehta"></label></div>' : '')
        + (draft.audience === 'one' ? '' : onlyNew);
    }
    return '<div class="wad-card"><div class="wad-card-head"><h2>1. What do you want to send?</h2></div><div class="wad-picks">' + kinds + '</div></div>'
      + '<div class="wad-card"><div class="wad-card-head"><h2>2. Who gets it?</h2></div>' + who
      + '<div class="wad-actions"><button class="wad-btn wad-primary" data-act="count"' + (busy ? ' disabled' : '') + '>Show me who gets it</button>'
      + (draft.kind === 'photos' ? '<button class="wad-btn" data-act="own">Or send one by one from my own WhatsApp</button>' : '') + '</div>'
      + (audError ? '<p class="wad-bad">' + esc(audError) + '</p>' : '') + '</div>'
      + (ownShow ? ownHtml() : '') + reviewHtml() + batchesHtml();
  }

  function reviewHtml() {
    if (!aud) return '';
    var single = draft.kind === 'custom' && draft.audience === 'one';
    var skipped = (aud.skipped || []).length ? '<ul class="wad-skips">' + aud.skipped.map(function (s) { return '<li><b>' + num(s.n) + '</b> ' + esc(s.words) + '</li>'; }).join('') + '</ul>' : '';
    var approved = aud.status === 'APPROVED';
    var blockers = [];
    if (!D.connected) blockers.push('WhatsApp is not connected yet. <button class="wad-link" data-act="tab" data-tab="setup">Open Setup</button>.');
    if (!approved) blockers.push('WhatsApp has not approved this message yet (' + esc((TPL_STATUS[aud.status] || [aud.status])[0].toLowerCase()) + '). <button class="wad-link" data-act="tab" data-tab="messages">Open Messages</button> to send it for approval.');
    var days = aud.count > aud.daily_limit ? '<p class="wad-note">WhatsApp lets our number reach ' + num(aud.daily_limit) + ' people in 24 hours, so this will take about ' + aud.days + ' days. It carries on by itself each day.</p>' : '';
    var cost = '<p class="wad-note">' + esc(categoryWords(aud.category)) + '. Meta charges for each message delivered: a service message costs about 12 to 15 paise, a marketing message about 80 paise to Rs 1.10. Meta&rsquo;s bill is the true figure.</p>';
    var canSend = D.connected && approved && aud.count > 0;
    return '<div class="wad-card"><div class="wad-card-head"><h2>3. Check it, test it, send it</h2></div>'
      + '<div class="wad-review"><div>'
      + '<p class="wad-count"><b>' + num(aud.count) + '</b> ' + (aud.count === 1 ? 'person gets it' : 'people get it') + '</p>'
      + ((aud.sample || []).length && !single ? '<p class="wad-sub">The first few: ' + aud.sample.map(function (p) { return esc(p.name || 'No name') + ' ' + esc(p.number); }).join(', ') + '</p>' : '')
      + (skipped ? '<p class="wad-sub">Left out:</p>' + skipped : '') + days + cost
      + (blockers.length ? '<p class="wad-warn">' + blockers.join('<br>') + '</p>' : '')
      + '<div class="wad-test"><label class="wad-field"><span>Send a test to my own phone first</span><input type="tel" data-field="testTo" value="' + esc(testTo) + '" placeholder="98765 43210"></label>'
      + '<button class="wad-btn" data-act="test"' + (canSend && !busy ? '' : ' disabled') + '>Send test</button></div>'
      + '<div class="wad-actions"><button class="wad-btn wad-primary wad-big" data-act="send"' + (canSend && !busy ? '' : ' disabled') + '><i class="fas fa-paper-plane" aria-hidden="true"></i> Send to ' + people(aud.count) + '</button></div>'
      + '</div><div><p class="wad-sub">How it reads for ' + esc(aud.preview && aud.preview.name ? aud.preview.name : 'each person') + ':</p>' + bubble(aud.preview) + '</div></div></div>';
  }

  function batchesHtml() {
    var list = (D && D.batches) || [];
    if (!list.length) return '';
    return '<div class="wad-card"><div class="wad-card-head"><h2>Sends</h2><p>Each one carries on by itself, even with this page closed.</p></div>' + list.map(function (b) {
      var n = batchNumbers(b), st = batchStatusWords(b);
      var buttons = (b.status === 'running' ? '<button class="wad-btn wad-small" data-act="batch" data-what="pause" data-id="' + b.id + '">Pause</button>' : '')
        + (b.status === 'paused' ? '<button class="wad-btn wad-small wad-primary" data-act="batch" data-what="resume" data-id="' + b.id + '">Carry on</button>' : '')
        + (b.status === 'running' || b.status === 'paused' ? '<button class="wad-btn wad-small" data-act="batch" data-what="cancel" data-id="' + b.id + '">Cancel the rest</button>' : '')
        + '<button class="wad-btn wad-small" data-act="batch-list" data-id="' + b.id + '">See everyone</button>';
      var bits = [[n.waiting, 'waiting'], [n.gone, 'sent'], [n.delivered, 'delivered'], [n.read, 'read'], [n.taps, 'tapped the button'], [n.looked, 'looked at their photos since'], [n.saved, 'saved photos since'], [n.replied, 'replied'], [n.failed, 'not delivered'], [n.left, 'left out']]
        .filter(function (x) { return x[0] > 0; }).map(function (x) { return '<b>' + num(x[0]) + '</b> ' + x[1]; }).join(' &middot; ');
      // Out of everyone WhatsApp was asked to deliver to (sent or refused).
      var base = n.gone + n.failed;
      var rate = function (a) { return base ? Math.round((a * 100) / base) + '%' : '-'; };
      var rateList = [[n.delivered, 'delivered'], [n.read, 'read'], [n.taps, 'tapped the button']]
        .concat(b.kind === 'photos' ? [[n.looked, 'looked at their photos'], [n.saved, 'saved photos']] : []).concat([[n.replied, 'replied'], [n.failed, 'not delivered']]);
      var rates = base ? '<div class="wad-rates">' + rateList
        .map(function (x) { return '<span><b>' + rate(x[0]) + '</b>' + x[1] + '</span>'; }).join('') + '</div>' : '';
      var reasons = (b.reasons || []).length ? '<details class="wad-reasons"><summary>Why ' + num(n.failed) + ' did not arrive</summary><ul>'
        + b.reasons.map(function (r) {
          return '<li><b>' + num(r.n) + '</b> ' + esc(r.words)
            + (r.retry && b.status !== 'cancelled' ? ' <button class="wad-btn wad-small" data-act="batch" data-what="retry" data-n="' + num(r.n) + '" data-id="' + b.id + '"' + (busy ? ' disabled' : '') + '>Try again for these ' + num(r.n) + '</button>' : '') + '</li>';
        }).join('') + '</ul></details>' : '';
      return '<div class="wad-batch"><div class="wad-batch-top"><b>' + esc(b.title || kindWords(b.kind)) + '</b> ' + chip(st) + '<span class="wad-sub">' + people(n.total) + ' &middot; started ' + esc(when(b.created_at)) + (b.created_by ? ' by ' + esc(b.created_by) : '') + '</span></div>'
        + '<div class="wad-bar"><span style="width:' + n.pct + '%"></span></div>' + rates + '<p class="wad-sub">' + (bits || 'Nothing sent yet') + '</p>' + reasons
        + (b.note ? '<p class="wad-warn">' + esc(b.note) + '</p>' : '') + '<div class="wad-actions">' + buttons + '<button class="wad-btn wad-small" data-act="report" data-id="' + b.id + '"><i class="fas fa-download" aria-hidden="true"></i> Download report</button></div></div>';
    }).join('') + '</div>';
  }

  function ownHtml() {
    if (!own) return '<div class="wad-card"><p class="wad-sub">Loading the list...</p></div>';
    var left = own.rows.filter(function (r) { return !r.sent; }).length;
    return '<div class="wad-card"><div class="wad-card-head"><h2>One by one, from my own WhatsApp</h2>'
      + '<p>This works today, before Meta is connected. Press a name: WhatsApp opens with the message and their own album link already written. Press Send there, then come back for the next one. ' + num(left) + ' left of ' + num(own.rows.length) + '.</p></div>'
      + '<div class="wad-own">' + own.rows.map(function (r) {
        return '<div class="wad-own-row' + (r.sent ? ' wad-own-done' : '') + '"><span><b>' + esc(r.name) + '</b><small>' + esc(r.number) + ' &middot; ' + esc(r.photos) + '</small></span>'
          + (r.sent ? '<span class="wad-ok">Sent</span><button class="wad-btn wad-small" data-act="own-undo" data-id="' + r.attendee_id + '">Undo</button>'
            : '<a class="wad-btn wad-small wad-primary" target="_blank" rel="noopener" href="' + esc(onPhone() ? r.wa_url : r.web_url) + '" data-act="own-open" data-id="' + r.attendee_id + '">Open WhatsApp</a>') + '</div>';
      }).join('') + '</div></div>';
  }

  // ---------- Replies ----------

  function payWords(p) { return { paid: 'Paid', waived: 'Complimentary', pending: 'Not paid yet', failed: 'Payment failed', refunded: 'Refunded' }[p] || (p ? p : ''); }
  // The approved messages that can go to this one person now.
  function threadChoices() {
    var p = thread && thread.person, out = [];
    ((D && D.templates) || []).forEach(function (t) {
      if (t.status !== 'APPROVED') return;
      if (t.kind === 'custom') out.push(['custom:' + t.name, t.title]);
      else if (t.kind === 'pass' && p && (p.payment === 'paid' || p.payment === 'waived')) out.push(['pass', 'Their pass (' + (p.pass || 'pass') + ')']);
      else if (t.kind === 'photos' && p) out.push(['photos', 'Their event photos']);
    });
    return out;
  }
  function repliesHtml() {
    if (!inbox) return '<div class="wad-card"><p class="wad-sub">Loading...</p></div>';
    if (!inbox.length) return '<div class="wad-card"><p class="wad-sub">Nobody has written back yet. When someone replies to a message, it shows here and you can answer.</p></div>';
    var q = inboxQ.toLowerCase(), digits = inboxQ.replace(/\D/g, '');
    var nUnread = inbox.filter(function (r) { return r.unread; }).length, nWaiting = inbox.filter(function (r) { return r.waiting; }).length;
    var rows = inbox.filter(function (r) {
      if (inboxFilter === 'unread' && !r.unread) return false;
      if (inboxFilter === 'waiting' && !r.waiting) return false;
      if (!q) return true;
      return String(r.name).toLowerCase().indexOf(q) >= 0 || String(r.last).toLowerCase().indexOf(q) >= 0 || (digits.length >= 3 && r.number.indexOf(digits) >= 0);
    });
    var tools = '<div class="wad-filters">' + [['all', 'All', inbox.length], ['waiting', 'Waiting for our reply', nWaiting], ['unread', 'Unread', nUnread]].map(function (x) {
      return '<button class="wad-filter' + (inboxFilter === x[0] ? ' wad-filter-on' : '') + '" data-act="inbox-filter" data-filter="' + x[0] + '">' + x[1] + ' <span class="wad-n">' + num(x[2]) + '</span></button>';
    }).join('') + '<input type="search" data-field="inboxQ" value="' + esc(inboxQ) + '" placeholder="Name, number or words" aria-label="Find a chat"></div>';
    var list = '<div class="wad-inbox">' + (rows.length ? rows.map(function (r) {
      return '<button class="wad-inbox-row' + (thread && thread.number === r.number ? ' wad-inbox-on' : '') + '" data-act="thread" data-number="' + esc(r.number) + '">'
        + '<span><b>' + esc(r.name || r.shown) + '</b>' + (r.unread ? ' <i class="wad-unread">' + num(r.unread) + '</i>' : '') + (r.waiting ? ' ' + chip(['Waiting for us', 'wait']) : '') + (r.stopped ? ' ' + chip(['Stopped', 'bad']) : '') + '</span>'
        + '<small>' + esc(r.last || '') + '</small><small>' + esc(when(r.last_in_at)) + '</small></button>';
    }).join('') : '<p class="wad-sub">No chat matches.</p>') + '</div>';
    var right = '<p class="wad-sub">Choose a person to read what they wrote.</p>';
    if (thread) {
      var p = thread.person;
      var who = p ? '<div class="wad-person"><b>' + esc(p.name) + '</b>'
        + '<span>' + esc([p.pass, p.event].filter(Boolean).join(' · ')) + '</span>'
        + '<span>' + esc([payWords(p.payment), p.came ? 'Came to the event' : ''].filter(Boolean).join(' · ')) + '</span>'
        + (p.email ? '<span>' + esc(p.email) + '</span>' : '') + '</div>'
        : '<p class="wad-sub">This number is not on any registration.</p>';
      var quick = (D && D.quick) || [];
      var chips = '<div class="wad-quick">' + quick.map(function (x, i) {
        return '<span class="wad-quick-item"><button class="wad-quick-btn" data-act="quick-use" data-i="' + i + '" title="' + esc(x.text) + '">' + esc(x.title) + '</button>'
          + (quickEdit ? '<button class="wad-quick-del" data-act="quick-del" data-i="' + i + '" aria-label="Delete ' + esc(x.title) + '">&times;</button>' : '') + '</span>';
      }).join('') + (quick.length ? '<button class="wad-link" data-act="quick-edit">' + (quickEdit ? 'Done' : 'Edit') + '</button>' : '') + '</div>';
      var choices = threadChoices();
      var picker = choices.length ? '<div class="wad-test"><label class="wad-field"><span>' + (thread.open ? 'Or send an approved message' : 'Send an approved message') + '</span><select data-field="pickTpl"><option value="">Choose...</option>'
        + choices.map(function (x) { return '<option value="' + esc(x[0]) + '"' + (pickTpl === x[0] ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join('') + '</select></label>'
        + '<button class="wad-btn" data-act="thread-send"' + (busy || thread.stopped ? ' disabled' : '') + '>Send it</button></div>' : '';
      right = '<div class="wad-thread-head"><b>' + esc(thread.name || (p && p.name) || thread.shown) + '</b> <span class="wad-sub">' + esc(thread.shown) + '</span>'
        + '<button class="wad-btn wad-small" data-act="stop" data-number="' + esc(thread.number) + '" data-on="' + (thread.stopped ? '0' : '1') + '">' + (thread.stopped ? 'Allow messages again' : 'Stop messages to this person') + '</button></div>'
        + who
        + '<div class="wad-thread">' + thread.messages.map(function (m) {
          return '<div class="wad-msg ' + (m.out ? 'wad-msg-out' : 'wad-msg-in') + '">' + (m.image ? '<img src="' + esc(m.image) + '" alt="" loading="lazy">' : '') + '<p>' + esc(m.text).replace(/\n/g, '<br>') + '</p>'
            + '<small>' + esc(when(m.at)) + (m.out ? ' &middot; ' + esc((STATUS[m.status] || [m.status])[0]) + (m.by ? ' &middot; ' + esc(m.by) : '') : '') + '</small>' + (m.error ? '<small class="wad-bad">' + esc(m.error) + '</small>' : '') + '</div>';
        }).join('') + '</div>'
        + (thread.stopped ? '<p class="wad-note">This person said STOP, so nothing can be sent to them until they write START.</p>'
          : thread.open
            ? chips + '<div class="wad-reply"><textarea rows="2" data-field="replyText" placeholder="Type your reply"></textarea><button class="wad-btn wad-primary" data-act="reply"' + (busy ? ' disabled' : '') + '>Send</button></div>'
              + '<p class="wad-sub"><button class="wad-link" data-act="quick-save">Save what I typed as a quick reply</button></p>'
            : '<p class="wad-note">More than 24 hours have passed since they last wrote, so WhatsApp only allows an approved message. They can also write again.</p>')
        + (thread.stopped ? '' : picker);
    }
    return '<div class="wad-card">' + tools + '<div class="wad-split"><div>' + list + '</div><div>' + right + '</div></div></div>';
  }

  // ---------- Sent ----------

  function sentHtml() {
    var chips = [['', 'All'], ['queued', 'Waiting'], ['sent', 'Sent'], ['delivered', 'Delivered'], ['read', 'Read'], ['tapped', 'Tapped'], ['failed', 'Not delivered'], ['skipped', 'Left out']].map(function (x) {
      return '<button class="wad-filter' + (logStatus === x[0] ? ' wad-filter-on' : '') + '" data-act="log-status" data-status="' + x[0] + '">' + x[1] + '</button>';
    }).join('');
    var top = '<div class="wad-filters">' + chips + '<input type="search" data-field="logQ" value="' + esc(logQ) + '" placeholder="Name or number" aria-label="Find by name or number">'
      + '<button class="wad-btn wad-small" data-act="log-find">Find</button>' + (logBatch ? '<button class="wad-btn wad-small" data-act="log-all">Show every send</button>' : '') + '</div>';
    if (!log) return '<div class="wad-card">' + top + '<p class="wad-sub">Loading...</p></div>';
    if (!log.length) return '<div class="wad-card">' + top + '<p class="wad-sub">Nothing here.</p></div>';
    return '<div class="wad-card">' + top + '<div class="wad-table"><table><thead><tr><th>Who</th><th>What</th><th>State</th><th>When</th></tr></thead><tbody>' + log.map(function (r) {
      var last = r.read_at || r.delivered_at || r.sent_at || r.created_at;
      return '<tr><td><b>' + esc(r.name || 'No name') + '</b><small>' + esc(r.number) + '</small></td>'
        + '<td>' + esc(kindWords(r.kind)) + (r.test ? ' <span class="wad-sub">(test)</span>' : '') + (r.own ? ' <span class="wad-sub">(own WhatsApp)</span>' : '') + '</td>'
        + '<td>' + statusChip(r.status) + (r.clicked_at ? ' ' + chip(['Tapped', 'good']) : '')
        + (r.looked_after ? ' ' + chip(['Looked at their photos', 'good']) : '') + (r.saved_after ? ' ' + chip(['Saved ' + num(r.saved) + ' photo' + (r.saved === 1 ? '' : 's'), 'good']) : '')
        + (r.error ? '<small class="wad-bad">' + esc(r.error) + '</small>' : '') + '</td>'
        + '<td><small>' + esc(when(last)) + '</small></td></tr>';
    }).join('') + '</tbody></table></div><p class="wad-sub">The newest 200 are shown.</p></div>';
  }

  // ---------- Automatic ----------

  function autoHtml() {
    var rules = (D && D.auto) || [];
    var head = '<div class="wad-card"><div class="wad-card-head"><h2>Messages that send themselves</h2>'
      + '<p>Each one goes by itself, once per person, when something happens on the site. They are off until you switch them on, and only what happens after you switch one on gets a message: nobody from the past is surprised. Anyone who said STOP is left out. Meta has to approve each message first.</p></div></div>';
    if (!rules.length) return head;
    return head + rules.map(function (r) {
      var t = ((D && D.templates) || []).filter(function (x) { return x.name === r.template; })[0] || {};
      var approved = r.status === 'APPROVED';
      var state = r.on ? chip(['On', 'good']) : chip(['Off', 'muted']);
      var act = !approved
        ? (r.status === 'draft' ? '<button class="wad-btn wad-primary" data-act="tpl-submit" data-name="' + esc(r.template) + '"' + (busy ? ' disabled' : '') + '>Send the message to WhatsApp for approval</button>'
          : '<p class="wad-note">' + (r.status === 'PENDING' || r.status === 'IN_APPEAL' ? 'Meta is checking it. ' : 'Meta has not approved it; see Messages for the reason. ') + 'It can be switched on once Meta approves it.</p>')
        : '<button class="wad-btn' + (r.on ? '' : ' wad-primary') + '" data-act="auto-toggle" data-key="' + esc(r.key) + '" data-on="' + (r.on ? '0' : '1') + '"' + (busy ? ' disabled' : '') + '>' + (r.on ? 'Switch off' : 'Switch on') + '</button>';
      var stats = r.sent || r.failed ? '<p class="wad-sub"><b>' + num(r.sent) + '</b> sent' + (r.failed ? ' &middot; <b>' + num(r.failed) + '</b> not delivered' : '') + (r.last_at ? ' &middot; last ' + esc(when(r.last_at)) : '') + '</p>' : '';
      return '<div class="wad-card wad-tpl"><div><b>' + esc(r.title) + '</b> ' + state + ' ' + tplChip(r.status)
        + '<p class="wad-sub">When: ' + esc(r.when) + '</p>'
        + (r.on && r.since ? '<p class="wad-sub">On since ' + esc(when(r.since)) + '.</p>' : '') + stats
        + '<div class="wad-actions">' + act + '</div></div>'
        + '<div>' + bubble({ text: t.preview || '', header: t.header, image: t.image_url, footer: t.footer, buttons: t.buttons, button: t.button }) + '</div></div>';
    }).join('');
  }

  // ---------- Messages ----------

  function messagesHtml() {
    var list = (D && D.templates) || [];
    var cards = list.map(function (t) {
      var act = '';
      if (t.status === 'draft') act = '<button class="wad-btn wad-small wad-primary" data-act="tpl-submit" data-name="' + esc(t.name) + '"' + (busy ? ' disabled' : '') + '>Send to WhatsApp for approval</button>'
        + (t.builtin ? '' : '<button class="wad-btn wad-small" data-act="tpl-edit" data-name="' + esc(t.name) + '">Change</button><button class="wad-btn wad-small" data-act="tpl-delete" data-name="' + esc(t.name) + '">Delete</button>');
      else if (t.status === 'PENDING' || t.status === 'IN_APPEAL') act = '<button class="wad-btn wad-small" data-act="tpl-refresh">Ask WhatsApp again</button>';
      else if (!t.builtin) act = (t.status === 'REJECTED' ? '<button class="wad-btn wad-small" data-act="tpl-copy" data-name="' + esc(t.name) + '">Copy and change</button>' : '')
        + '<button class="wad-btn wad-small" data-act="tpl-delete" data-name="' + esc(t.name) + '">Delete</button>';
      return '<div class="wad-tpl"><div><b>' + esc(t.title) + '</b> ' + tplChip(t.status) + (t.builtin ? ' <span class="wad-sub">built in</span>' : '')
        + (t.what ? '<p class="wad-sub">' + esc(t.what) + '</p>' : '')
        + '<p class="wad-sub">' + esc(categoryWords(t.meta_category || t.category)) + '</p>'
        + (t.rejected_reason ? '<p class="wad-bad">WhatsApp&rsquo;s reason: ' + esc(t.rejected_reason) + '</p>' : '')
        + '<div class="wad-actions">' + act + '</div></div>'
        + (t.lang === 'hi' ? '<p class="wad-sub">हिन्दी</p>' : '')
        + '<div>' + bubble({ text: t.preview, header: t.header, image: t.image_url, footer: t.footer, buttons: t.buttons, button: t.button }) + '</div></div>';
    }).join('');
    return '<div class="wad-card"><div class="wad-card-head"><h2>Messages WhatsApp must approve</h2>'
      + '<p>WhatsApp only lets a business start a conversation with words it has approved. Send each one for approval once; it usually takes a few minutes, sometimes a few hours. After that it can be sent as often as you like.</p></div>'
      + '<div class="wad-actions"><button class="wad-btn wad-primary" data-act="tpl-new">Write a new message</button><button class="wad-btn" data-act="tpl-refresh">Ask WhatsApp for the latest</button></div>'
      + (form ? formHtml() : '') + cards + '</div>';
  }

  // The message builder. form.header: { type, url, filename, text }; form.buttons: [{ type, text, url, phone }].
  var TOPS = [['none', 'Nothing'], ['image', 'Picture'], ['video', 'Video'], ['document', 'PDF'], ['text', 'Words']];
  var TOP_FILE = { image: ['image/jpeg,image/png', 'A JPG or PNG picture, 5 MB at most'], video: ['video/mp4', 'An MP4 video, 16 MB at most. Short and vertical works best for reels.'], document: ['application/pdf', 'A PDF, 15 MB at most: a deck, a brochure, an agenda'] };
  function formHtml() {
    var f = form, h = f.header || { type: 'none' }, hi = f.lang === 'hi';
    var top = '<div class="wad-field"><span>On top of the message</span><div class="wad-seg" role="radiogroup" aria-label="On top of the message">' + TOPS.map(function (x) {
      return '<button type="button" role="radio" aria-checked="' + (h.type === x[0]) + '" class="wad-seg-btn' + (h.type === x[0] ? ' wad-seg-on' : '') + '" data-act="form-top" data-top="' + x[0] + '">' + x[1] + '</button>';
    }).join('') + '</div></div>';
    if (TOP_FILE[h.type]) {
      top += h.url
        ? '<p class="wad-sub wad-added"><i class="fas ' + (h.type === 'image' ? 'fa-image' : h.type === 'video' ? 'fa-play' : 'fa-file') + '" aria-hidden="true"></i> ' + esc(h.filename || 'Added') + ' <button type="button" class="wad-link" data-act="form-nofile">Remove</button></p>'
          + (h.type === 'document' ? '<label class="wad-field"><span>The file name people see</span><input type="text" maxlength="60" data-form-field="header.filename" value="' + esc(h.filename || '') + '" placeholder="Bharat AI Innovation sponsorship deck.pdf"></label>' : '')
        : '<label class="wad-field"><span>' + esc(TOP_FILE[h.type][1]) + '</span><input type="file" accept="' + TOP_FILE[h.type][0] + '" data-form-field="headerFile"' + (f.uploading ? ' disabled' : '') + '></label>'
          + (f.uploading ? '<p class="wad-sub">Adding the file...</p>' : '');
    } else if (h.type === 'text') {
      top += '<label class="wad-field"><span>Words on top, in bold (60 letters at most)</span><input type="text" maxlength="60" data-form-field="header.text" value="' + esc(h.text || '') + '" placeholder="Delhi 2027 is coming"></label>';
    }
    var btns = f.buttons || [];
    var nUrl = btns.filter(function (b) { return b.type === 'url'; }).length, nPhone = btns.filter(function (b) { return b.type === 'phone'; }).length;
    var rows = btns.map(function (b, i) {
      return '<div class="wad-btn-row"><select data-form-field="btn.' + i + '.type" aria-label="Kind of button ' + (i + 1) + '">'
        + [['reply', 'Quick reply'], ['url', 'Link'], ['phone', 'Call']].map(function (o) { return '<option value="' + o[0] + '"' + (b.type === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>'
        + '<input type="text" maxlength="25" data-form-field="btn.' + i + '.text" value="' + esc(b.text || '') + '" placeholder="' + (b.type === 'reply' ? (hi ? 'हाँ, मैं आऊँगा' : 'Yes, I am coming') : b.type === 'phone' ? 'Call us' : 'See Delhi 2027') + '" aria-label="Button ' + (i + 1) + ' words">'
        + (b.type === 'url' ? '<input type="url" data-form-field="btn.' + i + '.url" value="' + esc(b.url || '') + '" placeholder="https://bharataiinnovation.com/delhi" aria-label="Button ' + (i + 1) + ' link">'
          : b.type === 'phone' ? '<input type="tel" data-form-field="btn.' + i + '.phone" value="' + esc(b.phone || '') + '" placeholder="+91 91373 69984" aria-label="Button ' + (i + 1) + ' number">' : '<span class="wad-sub">Their tap comes back to Replies as their answer.</span>')
        + '<button type="button" class="wad-quick-del" data-act="form-btn-del" data-i="' + i + '" aria-label="Remove button ' + (i + 1) + '">&times;</button></div>';
    }).join('');
    return '<form class="wad-form" data-form="tpl"><h3>' + (f.replace ? 'Change this message' : 'A new message') + '</h3>'
      + '<div class="wad-review"><div>'
      + '<label class="wad-field"><span>A short name for it (only you see this)</span><input type="text" data-form-field="title" maxlength="60" value="' + esc(f.title) + '" placeholder="Delhi 2027 dates"></label>'
      + '<div class="wad-two"><label class="wad-field"><span>Language</span><select data-form-field="lang"><option value="en"' + (hi ? '' : ' selected') + '>English</option><option value="hi"' + (hi ? ' selected' : '') + '>हिन्दी (Hindi)</option></select></label>'
      + '<label class="wad-field"><span>What kind of message is it?</span><select data-form-field="category">'
      + '<option value="MARKETING"' + (f.category === 'MARKETING' ? ' selected' : '') + '>News, an invitation or an offer</option>'
      + '<option value="UTILITY"' + (f.category === 'UTILITY' ? ' selected' : '') + '>About their own registration, pass or booking</option></select></label></div>'
      + top
      + '<label class="wad-check"><input type="checkbox" data-form-field="greet"' + (f.greet ? ' checked' : '') + '> Start with &ldquo;' + (hi ? 'नमस्ते' : 'Hello') + '&rdquo; and their name</label>'
      + '<label class="wad-field"><span>The message (' + (900 - f.body.length) + ' letters left)</span><textarea rows="6" maxlength="900" data-form-field="body" placeholder="' + (hi ? 'मुंबई में भारत AI इनोवेशन 2026 का हिस्सा बनने के लिए धन्यवाद।' : 'Thank you for being part of Bharat AI Innovation 2026 in Mumbai. The next edition is in Delhi.') + '">' + esc(f.body) + '</textarea></label>'
      + '<div class="wad-insert"><span class="wad-sub">Put in, for each person:</span>' + [['[Name]', 'Their name'], ['[Pass]', 'Their pass'], ['[Event]', 'The event']].map(function (x) {
        return '<button type="button" class="wad-filter" data-act="form-insert" data-token="' + x[0] + '"><i class="fas fa-plus" aria-hidden="true"></i> ' + x[1] + '</button>';
      }).join('') + '</div>'
      + '<div class="wad-field"><span>Buttons (optional): quick replies, up to two links and one call; ten in all</span>' + rows
      + '<div class="wad-actions">' + [['reply', 'Quick reply', btns.length < 10], ['url', 'Link', btns.length < 10 && nUrl < 2], ['phone', 'Call', btns.length < 10 && nPhone < 1]].map(function (x) {
        return '<button type="button" class="wad-btn wad-small" data-act="form-btn-add" data-type="' + x[0] + '"' + (x[2] ? '' : ' disabled') + '><i class="fas fa-plus" aria-hidden="true"></i> ' + x[1] + '</button>';
      }).join('') + '</div></div>'
      + '<p class="wad-sub">WhatsApp decides the kind in the end. Calling an invitation a service message gets it refused. Every message ends with &ldquo;' + esc(FOOTER_FOR[f.lang] || FOOTER_FOR.en) + '&rdquo;.</p>'
      + '<div class="wad-actions"><button type="submit" class="wad-btn wad-primary"' + (busy || f.uploading ? ' disabled' : '') + '>Save</button><button type="button" class="wad-btn" data-act="form-cancel">Cancel</button></div>'
      + '</div><div><p class="wad-sub">How it will read:</p><div data-form-preview>' + formPreview() + '</div></div></div></form>';
  }
  function formPreview() {
    var f = form || {}, hi = f.lang === 'hi';
    var words = (f.body || (hi ? 'आपका संदेश यहाँ दिखेगा।' : 'Your message shows here.')).replace(/\[(name|pass|event)\]/gi, function (_m, k) { return FIELD_SAMPLE[k.toLowerCase()]; });
    return bubble({ header: f.header, text: (f.greet ? (hi ? 'नमस्ते Asha,\n\n' : 'Hello Asha,\n\n') : '') + words, footer: FOOTER_FOR[f.lang] || FOOTER_FOR.en, buttons: sortButtons(f.buttons || []) });
  }

  // ---------- Setup ----------

  function setupHtml() {
    var d = D || {}, c = d.config || {}, from = d.config_from || {}, s = d.settings || {}, ck = checkResult || d.checked;
    function box(field, label, hint, type) {
      var has = c[field];
      return '<label class="wad-field"><span>' + label + ' ' + (has ? '<i class="wad-ok">saved' + (from[{ token: 'token', phone_id: 'phoneId', waba_id: 'wabaId', app_secret: 'appSecret', app_id: 'appId' }[field]] === 'secret' ? ' as a server secret' : '') + '</i>' : '<i class="wad-bad">missing</i>') + '</span>'
        + '<input type="' + (type || 'text') + '" autocomplete="off" data-cfg="' + field + '" placeholder="' + (has ? 'Leave empty to keep the one saved' : hint) + '"></label>';
    }
    var steps = [
      'Open <a href="https://business.facebook.com" target="_blank" rel="noopener">business.facebook.com</a> and sign in with your Facebook account. Use the business you already have there, or create one named for the event.',
      'Open <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener">developers.facebook.com/apps</a>, press <b>Create app</b>, choose the <b>WhatsApp</b> use case and your business.',
      'In the app, open <b>WhatsApp &rarr; API Setup</b>. Add the phone number we will send from: a number that is <b>not</b> on WhatsApp on any phone right now (Meta sends it a code by SMS or a call). Give it the display name <b>Bharat AI Innovation</b>. On the same page, copy the <b>Phone number ID</b> and the <b>WhatsApp Business Account ID</b>.',
      'Open <b>App settings &rarr; Basic</b>. Copy the <b>App ID</b> and the <b>App secret</b> (press Show).',
      'For a key that does not run out: in <a href="https://business.facebook.com/settings/system-users" target="_blank" rel="noopener">Business settings &rarr; Users &rarr; System users</a>, add one (Admin), give it the app and the WhatsApp account with full control, press <b>Generate token</b>, choose the app, expiry <b>Never</b>, tick <b>whatsapp_business_messaging</b> and <b>whatsapp_business_management</b>, and copy the long key.',
      'Paste the five values below, press <b>Save</b>, then <b>Check the connection</b>. If it says <b>Not registered</b>, choose a 6-digit PIN in <b>Register our number</b> (it appears below) and keep the PIN safe: WhatsApp asks for it if the number ever moves.',
      'Back in the app, open <b>WhatsApp &rarr; Configuration</b>. Paste the Callback URL and the Verify token from below, press <b>Verify and save</b>, then switch on <b>messages</b> (and <b>message_template_status_update</b>). This is what brings delivered, read and replies back to us.',
      'In <b>WhatsApp Manager &rarr; Payment settings</b>, add a card. Then open <b>Messages</b> here and send each message for approval.',
      'Later: verify the business in Meta&rsquo;s <b>Security Centre</b>. It raises the limit from 250 people a day to 2000.'
    ];
    var check = ck ? '<div class="wad-stats">'
      + '<div><b>' + esc(ck.number || '-') + '</b><span>Our number</span></div><div><b>' + esc(ck.name || '-') + '</b><span>Name people see</span></div>'
      + '<div><b>' + esc(ck.number_status ? (notRegistered(ck) ? 'Not registered' : 'Ready') : '-') + '</b><span>Can send</span></div>'
      + '<div><b>' + esc({ GREEN: 'Good', YELLOW: 'At risk', RED: 'Poor', UNKNOWN: 'Not rated yet' }[ck.quality] || ck.quality || '-') + '</b><span>Number health</span></div>'
      + '<div><b>' + (ck.daily_limit ? num(ck.daily_limit) : '-') + '</b><span>People a day</span></div>'
      + '<div><b>' + esc(ck.webhook === 'subscribed' ? 'On' : ck.webhook ? 'Look below' : '-') + '</b><span>Delivery reports</span></div></div>'
      + (ck.webhook && ck.webhook !== 'subscribed' ? '<p class="wad-warn">Delivery reports: ' + esc(ck.webhook) + '</p>' : '')
      + (ck.templates_error ? '<p class="wad-warn">Messages could not be read from WhatsApp: ' + esc(ck.templates_error) + '</p>' : '') : '';
    return '<div class="wad-card"><div class="wad-card-head"><h2>Connect our WhatsApp number</h2><p>About 30 minutes, once. It needs your own Facebook sign-in and a code sent to the phone number, so only you can do it. Meta moves its menus now and then: the names below are the ones to look for.</p></div>'
      + '<ol class="wad-steps">' + steps.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ol></div>'
      + '<div class="wad-card"><div class="wad-card-head"><h2>The five values from Meta</h2><p>They are kept on the server and never shown again, here or anywhere.</p></div>'
      + '<div class="wad-two">' + box('phone_id', 'Phone number ID', 'Digits, from API Setup') + box('waba_id', 'WhatsApp Business Account ID', 'Digits, from API Setup') + '</div>'
      + '<div class="wad-two">' + box('app_id', 'App ID', 'Digits, from App settings') + box('app_secret', 'App secret', '32 letters and numbers', 'password') + '</div>'
      + box('token', 'Access key (token)', 'The long key from the system user', 'password')
      + '<div class="wad-actions"><button class="wad-btn wad-primary" data-act="cfg-save"' + (busy ? ' disabled' : '') + '>Save</button><button class="wad-btn" data-act="cfg-check"' + (busy || !d.connected ? ' disabled' : '') + '>Check the connection</button></div>' + check + '</div>'
      + (d.connected && notRegistered(ck) ? '<div class="wad-card"><div class="wad-card-head"><h2>Register our number</h2><p>Meta says our number is not registered for sending yet (' + esc(ck.number_status) + '), so every message is refused. This is done once. Choose a 6-digit PIN: it becomes the number&rsquo;s two-step PIN, so write it down. If the number already has one, type that. It goes to Meta and is kept nowhere here. Meta allows 10 tries in 3 days.</p></div>'
        + '<div class="wad-test"><label class="wad-field"><span>6-digit PIN</span><input type="password" inputmode="numeric" autocomplete="off" maxlength="6" data-field="regPin" placeholder="6 digits"></label>'
        + '<button class="wad-btn wad-primary" data-act="register"' + (busy ? ' disabled' : '') + '>Register</button></div></div>' : '')
      + '<div class="wad-card"><div class="wad-card-head"><h2>For step 7: the webhook</h2></div>'
      + copyRow('Callback URL', d.webhook_url) + copyRow('Verify token', d.verify_token)
      + (c.app_secret ? '' : '<p class="wad-warn">Until the App secret is saved above, nothing Meta tells us is believed: messages still go, but they stay at &ldquo;Sent&rdquo; and replies do not arrive.</p>') + '</div>'
      + mcpHtml(d.mcp || {}) + ampHtml(d.aimailpilot || {})
      + '<div class="wad-card"><div class="wad-card-head"><h2>How fast, and when</h2></div>'
      + '<div class="wad-two"><label class="wad-field"><span>Messages a minute (1 to 60)</span><input type="number" min="1" max="60" data-set="per_minute" value="' + esc(s.per_minute) + '"></label>'
      + '<label class="wad-field"><span>People in 24 hours (WhatsApp&rsquo;s limit for us)</span><input type="number" min="1" data-set="daily_limit" value="' + esc(s.daily_limit) + '"></label></div>'
      + '<div class="wad-two"><label class="wad-field"><span>Bulk sends start at (hour, India)</span><input type="number" min="0" max="23" data-set="hours_from" value="' + esc(s.hours_from) + '"></label>'
      + '<label class="wad-field"><span>and stop at</span><input type="number" min="1" max="24" data-set="hours_to" value="' + esc(s.hours_to) + '"></label></div>'
      + '<label class="wad-check"><input type="checkbox" data-set="sending"' + (s.sending === 'off' ? '' : ' checked') + '> Sending is on (untick to hold everything)</label>'
      + '<div class="wad-actions"><button class="wad-btn" data-act="set-save"' + (busy ? ' disabled' : '') + '>Save</button></div></div>'
      + '<div class="wad-card"><div class="wad-card-head"><h2>Someone asked us to stop</h2><p>Anyone who replies STOP is taken off by itself. If someone asks on a call, type their number here.</p></div>'
      + '<div class="wad-test"><label class="wad-field"><span>Mobile number</span><input type="tel" data-field="stopNumber" placeholder="98765 43210"></label>'
      + '<button class="wad-btn" data-act="stop-typed" data-on="1">Stop messages</button><button class="wad-btn" data-act="stop-typed" data-on="0">Allow again</button></div></div>';
  }
  // Claude's own way in (an MCP server on this desk), switched on with a key made here.
  function mcpHtml(m) {
    var head = '<div class="wad-card"><div class="wad-card-head"><h2>Let Claude use WhatsApp</h2><p>Claude (in Claude Code on your computer) can then check sends and replies, count who a message reaches, send a test, answer a chat and start a send, with the same rules as this screen: approved messages only, STOP respected, the sending hours and pace, and a send to many only with the count you agreed. Everything it does is in the log as &ldquo;Claude (MCP)&rdquo;.</p></div>';
    if (mcpNew) {
      return head + '<p class="wad-warn">Copy this now: the key is shown only once. Paste it in a terminal in the project folder and press Enter. Then start a new Claude chat.</p>'
        + copyRow('Command', mcpNew.command)
        + '<div class="wad-actions"><button class="wad-btn" data-act="mcp-hide">I have copied it</button></div></div>';
    }
    if (m.on) {
      return head + '<p class="wad-status"><span class="wad-dot wad-dot-on"></span> Switched on' + (m.created_at ? ': key made ' + esc(when(m.created_at)) + (m.created_by ? ' by ' + esc(m.created_by) : '') : '') + (m.last_used_at ? '. Last used ' + esc(when(m.last_used_at)) : '. Not used yet') + '.</p>'
        + '<div class="wad-actions"><button class="wad-btn" data-act="mcp-make"' + (busy ? ' disabled' : '') + '>Make a new key (the old one stops)</button><button class="wad-btn" data-act="mcp-off"' + (busy ? ' disabled' : '') + '>Switch off</button></div></div>';
    }
    return head + '<div class="wad-actions"><button class="wad-btn wad-primary" data-act="mcp-make"' + (busy ? ' disabled' : '') + '>Make a key for Claude</button></div></div>';
  }
  // AImailPilot sends through this number (routes/whatsapp.ts, /api/external/whatsapp/*).
  function ampHtml(a) {
    var head = '<div class="wad-card"><div class="wad-card-head"><h2>Let AImailPilot send through this number</h2><p>The team can then send WhatsApp from AImailPilot: one person, or a campaign to a list. It all goes through here, so STOP, the day&rsquo;s number, the sending hours and the reports stay in one place, and each send shows in Sent as &ldquo;AImailPilot: &hellip;&rdquo;. Only messages approved here can be used. A promotional message goes only to people who said yes to WhatsApp.</p></div>';
    if (!a.linked) return head + '<p class="wad-warn">The link with AImailPilot is not set up on this server (the shared key AImailPilot uses for the attendee list is missing).</p></div>';
    return head + (a.on ? '<p class="wad-status"><span class="wad-dot wad-dot-on"></span> Switched on.</p><div class="wad-actions"><button class="wad-btn" data-act="amp-off"' + (busy ? ' disabled' : '') + '>Switch off</button></div></div>'
      : '<div class="wad-actions"><button class="wad-btn wad-primary" data-act="amp-on"' + (busy ? ' disabled' : '') + '>Switch on</button></div></div>');
  }
  function copyRow(label, value) {
    return '<div class="wad-copy"><span>' + esc(label) + '</span><code>' + esc(value || 'Not available on this server') + '</code>' + (value ? '<button class="wad-btn wad-small" data-act="copy" data-copy="' + esc(value) + '">Copy</button>' : '') + '</div>';
  }

  // ---------- drawing ----------

  function bodyHtml() {
    if (D && D.ready === false) return '';
    if (tab === 'replies') return repliesHtml();
    if (tab === 'sent') return sentHtml();
    if (tab === 'messages') return messagesHtml();
    if (tab === 'auto') return autoHtml();
    if (tab === 'setup') return setupHtml();
    return sendHtml();
  }
  var drawing = false;
  function draw() {
    // Replacing the page can blur a box, and a blur can fire an event that draws again.
    if (!host || drawing) return;
    drawing = true;
    try { drawNow(); } finally { drawing = false; }
  }
  function drawNow() {
    var keep = w.document.activeElement && host.contains(w.document.activeElement) ? w.document.activeElement.getAttribute('data-field') || w.document.activeElement.getAttribute('data-form-field') : '';
    host.innerHTML = '<div class="wad">' + headHtml() + (D && D.ready === false ? '' : tabsHtml()) + '<div class="wad-body">' + bodyHtml() + '</div></div>';
    if (keep) { var el = host.querySelector('[data-field="' + keep + '"], [data-form-field="' + keep + '"]'); if (el && el.focus) { try { el.focus(); if (el.setSelectionRange && el.type !== 'number') el.setSelectionRange(el.value.length, el.value.length); } catch (e) { /* a field that cannot take a cursor */ } } }
  }
  function fail(err) { toast((err && err.message) || 'That did not work. Try again.', 'error'); }
  async function work(fn) {
    if (busy) return;
    busy = true; draw();
    try { await fn(); } catch (err) { fail(err); }
    busy = false; draw();
  }
  function take(d) { if (d && d.config) D = d; }

  async function load() {
    try { D = await opts.api.get('/api/admin/whatsapp'); } catch (err) { D = D || { ready: true, templates: [], batches: [], totals: {}, settings: {}, config: {} }; fail(err); }
    if (first && D && D.ready !== false && !D.connected && !(D.batches || []).length) tab = 'setup';
    first = false;
    draw();
    loadTab();
  }
  async function loadTab() {
    try {
      if (tab === 'replies') { inbox = (await opts.api.get('/api/admin/whatsapp/inbox')).rows; draw(); }
      if (tab === 'sent') { await loadLog(); }
    } catch (err) { fail(err); }
  }
  async function loadLog() {
    log = null; draw();
    var q = '?status=' + encodeURIComponent(logStatus) + (logBatch ? '&batch=' + logBatch : '') + (logQ ? '&q=' + encodeURIComponent(logQ) : '');
    log = (await opts.api.get('/api/admin/whatsapp/messages' + q)).rows;
    draw();
  }
  async function count() {
    var more = needsMore();
    aud = null; audError = more;
    if (more) { draw(); return; }
    var spec = specOf();
    audKey = JSON.stringify(spec);
    try { aud = await opts.api.post('/api/admin/whatsapp/audience', spec); } catch (err) { audError = (err && err.message) || 'That did not work.'; }
    draw();
  }

  // The page pushes the queue along while a send is running and the section is on screen.
  function pump() {
    if (timer) return;
    timer = w.setInterval(async function () {
      if (!host || host.offsetParent === null || busy) return;
      var running = ((D && D.batches) || []).some(function (b) { return b.status === 'running'; });
      if (!running || !D.connected) return;
      try { var d = await opts.api.post('/api/admin/whatsapp/tick', {}); take(d); if (tab === 'send' && !form) draw(); } catch (e) { /* the minute clock still sends */ }
    }, 20000);
  }

  function readPicture(file) {
    return new Promise(function (resolve, reject) {
      if (!file) { resolve(''); return; }
      if (!/^image\/(jpeg|png)$/.test(file.type)) { reject(new Error('The picture must be a JPG or a PNG.')); return; }
      var r = new w.FileReader();
      r.onerror = function () { reject(new Error('That picture could not be read.')); };
      r.onload = function () {
        var img = new w.Image();
        img.onerror = function () { reject(new Error('That picture could not be opened.')); };
        img.onload = function () {
          var max = 1600, k = Math.min(1, max / Math.max(img.width, img.height));
          var c = w.document.createElement('canvas');
          c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          var x = c.getContext('2d');
          x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height);
          x.drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.9));
        };
        img.src = r.result;
      };
      r.readAsDataURL(file);
    });
  }

  function val(sel) { var el = host.querySelector(sel); return el ? el.value : ''; }

  async function onClick(e) {
    var t = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!t || !host.contains(t)) return;
    var act = t.getAttribute('data-act');
    if (act === 'own-open') { markOwn(t.getAttribute('data-id'), false); return; } // the link itself opens WhatsApp
    e.preventDefault();
    if (act === 'tab') { tab = t.getAttribute('data-tab'); thread = null; form = null; draw(); loadTab(); return; }
    if (act === 'reload') { load(); return; }
    if (act === 'count') { await work(count); return; }
    if (act === 'own') { ownShow = !ownShow; draw(); if (ownShow && !own) { try { own = await opts.api.get('/api/admin/whatsapp/own'); } catch (err) { ownShow = false; fail(err); } draw(); } return; }
    if (act === 'own-undo') { await markOwn(t.getAttribute('data-id'), true); return; }
    if (act === 'copy') { try { await w.navigator.clipboard.writeText(t.getAttribute('data-copy')); toast('Copied.'); } catch (err) { toast('Select it and copy by hand.', 'error'); } return; }
    if (act === 'test') {
      testTo = val('[data-field="testTo"]').trim();
      try { w.localStorage.setItem('wa_test_to', testTo); } catch (err) { /* private window */ }
      await work(async function () { var r = await opts.api.post('/api/admin/whatsapp/test', Object.assign(specOf(), { to: testTo })); toast('Test sent to ' + r.to + '. Look at your phone.'); });
      return;
    }
    if (act === 'send') {
      if (!aud || JSON.stringify(specOf()) !== audKey) { toast('Something changed. Press "Show me who gets it" again.', 'error'); return; }
      if (!w.confirm('Send this on WhatsApp to ' + people(aud.count) + '?\n\nIt cannot be taken back once it is on their phone.')) return;
      await work(async function () {
        try {
          var r = await opts.api.post('/api/admin/whatsapp/send', Object.assign(specOf(), { expect: aud.count }));
          toast(r.batch ? 'Started: ' + people(r.count) + '. It carries on by itself.' : 'Sent to ' + (r.to || 'them') + '.');
          aud = null;
          take(await opts.api.post('/api/admin/whatsapp/tick', {}));
        } catch (err) { if (err && err.data && err.data.changed) { await count(); } throw err; }
      });
      return;
    }
    if (act === 'batch') {
      var what = t.getAttribute('data-what');
      if (what === 'cancel' && !w.confirm('Cancel everyone still waiting in this send? The ones already sent stay sent.')) return;
      if (what === 'retry' && !w.confirm('Send it again to the ' + t.getAttribute('data-n') + ' people WhatsApp held back? WhatsApp suggests waiting a day or two first; if it is too soon, it may hold them back again (that costs nothing).')) return;
      await work(async function () {
        var rr = await opts.api.post('/api/admin/whatsapp/batches/' + t.getAttribute('data-id') + '/' + what, {});
        take(rr);
        if (what === 'retry') toast('Trying again for ' + num(rr.retried) + ' people. They go 20 a minute.');
      });
      return;
    }
    if (act === 'batch-list') { logBatch = Number(t.getAttribute('data-id')); logStatus = ''; logQ = ''; tab = 'sent'; draw(); loadTab(); return; }
    if (act === 'report') {
      await work(async function () {
        var res = await w.fetch('/api/admin/whatsapp/batches/' + encodeURIComponent(t.getAttribute('data-id')) + '/report', { headers: opts.authHeaders ? opts.authHeaders() : {} });
        if (!res.ok) { var j = await res.json().catch(function () { return {}; }); throw new Error(j.error || 'The report could not be made.'); }
        var blob = await res.blob();
        var name = ((res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/) || [])[1] || 'whatsapp-report.csv';
        var a = w.document.createElement('a');
        a.href = w.URL.createObjectURL(blob); a.download = name;
        w.document.body.appendChild(a); a.click(); a.remove();
        w.setTimeout(function () { w.URL.revokeObjectURL(a.href); }, 4000);
        toast('Downloaded. It opens in Excel or Google Sheets.');
      });
      return;
    }
    if (act === 'inbox-filter') { inboxFilter = t.getAttribute('data-filter'); draw(); return; }
    if (act === 'auto-toggle') {
      var turnOn = t.getAttribute('data-on') === '1';
      await work(async function () { take(await opts.api.post('/api/admin/whatsapp/auto', { key: t.getAttribute('data-key'), on: turnOn })); toast(turnOn ? 'Switched on. From now on it goes by itself.' : 'Switched off.'); });
      return;
    }
    if (act === 'mcp-make' || act === 'mcp-off') {
      if (act === 'mcp-make' && D && D.mcp && D.mcp.on && !w.confirm('Make a new key? The one Claude uses now stops working.')) return;
      if (act === 'mcp-off' && !w.confirm('Switch off Claude\'s access to WhatsApp?')) return;
      await work(async function () {
        var r = await opts.api.post('/api/admin/whatsapp/mcp-key', act === 'mcp-off' ? { off: true } : {});
        D.mcp = r.mcp;
        mcpNew = act === 'mcp-make' ? { command: r.command } : null;
        toast(act === 'mcp-off' ? 'Switched off.' : 'Key made. Copy the command now.');
      });
      return;
    }
    if (act === 'mcp-hide') { mcpNew = null; draw(); return; }
    if (act === 'amp-on' || act === 'amp-off') {
      var ampOn = act === 'amp-on';
      if (!w.confirm(ampOn ? 'Let the team send WhatsApp from AImailPilot through this number?' : 'Stop AImailPilot sending through this number? Its sends already waiting still go; pause them in Sent if needed.')) return;
      await work(async function () { take(await opts.api.post('/api/admin/whatsapp/aimailpilot', { on: ampOn })); toast(ampOn ? 'AImailPilot can send now.' : 'Switched off.'); });
      return;
    }
    if (act === 'quick-use') {
      var qr = ((D && D.quick) || [])[Number(t.getAttribute('data-i'))];
      var box = host.querySelector('[data-field="replyText"]');
      if (qr && box) { box.value = box.value.trim() ? box.value.replace(/\s*$/, '\n') + qr.text : qr.text; box.focus(); }
      return;
    }
    if (act === 'quick-edit') { quickEdit = !quickEdit; draw(); return; }
    if (act === 'quick-save' || act === 'quick-del') {
      var listQ = ((D && D.quick) || []).slice();
      if (act === 'quick-save') {
        var said = val('[data-field="replyText"]').trim();
        if (!said) { toast('Type the reply first, then save it.', 'error'); return; }
        listQ.push({ title: said.replace(/\s+/g, ' ').slice(0, 40), text: said });
      } else listQ.splice(Number(t.getAttribute('data-i')), 1);
      var keepText = val('[data-field="replyText"]');
      await work(async function () { var r = await opts.api.post('/api/admin/whatsapp/quick-replies', { list: listQ }); D.quick = r.quick; toast(act === 'quick-save' ? 'Saved. It is one tap away now.' : 'Deleted.'); });
      var again = host.querySelector('[data-field="replyText"]'); if (again) again.value = keepText;
      return;
    }
    if (act === 'thread-send') {
      if (!thread || !pickTpl) { toast('Choose the message to send.', 'error'); return; }
      var pp = thread.person || {};
      var body = pickTpl.indexOf('custom:') === 0 ? { kind: 'custom', template: pickTpl.slice(7), audience: 'one', number: '+' + thread.number, name: thread.name || pp.name || '' }
        : { kind: pickTpl, event: pp.event_id || 1, attendee_id: pp.attendee_id, only_new: false };
      await work(async function () {
        var r = await opts.api.post('/api/admin/whatsapp/send', body);
        toast('Sent to ' + (r.to || 'them') + '.');
        pickTpl = '';
        thread = await opts.api.get('/api/admin/whatsapp/thread/' + encodeURIComponent(thread.number));
      });
      return;
    }
    if (act === 'log-status') { logStatus = t.getAttribute('data-status'); try { await loadLog(); } catch (err) { fail(err); } return; }
    if (act === 'log-find') { logQ = val('[data-field="logQ"]').trim(); try { await loadLog(); } catch (err) { fail(err); } return; }
    if (act === 'log-all') { logBatch = 0; try { await loadLog(); } catch (err) { fail(err); } return; }
    if (act === 'thread') { try { thread = await opts.api.get('/api/admin/whatsapp/thread/' + encodeURIComponent(t.getAttribute('data-number'))); inbox.forEach(function (r) { if (r.number === thread.number) { D.unread = Math.max(0, (D.unread || 0) - r.unread); r.unread = 0; } }); } catch (err) { fail(err); } draw(); var box = host.querySelector('.wad-thread'); if (box) box.scrollTop = box.scrollHeight; return; }
    if (act === 'reply') {
      var text = val('[data-field="replyText"]').trim();
      if (!text) { toast('Type your reply.', 'error'); return; }
      await work(async function () { await opts.api.post('/api/admin/whatsapp/reply', { number: thread.number, text: text }); thread = await opts.api.get('/api/admin/whatsapp/thread/' + encodeURIComponent(thread.number)); toast('Sent.'); });
      return;
    }
    if (act === 'stop' || act === 'stop-typed') {
      var number = act === 'stop' ? t.getAttribute('data-number') : val('[data-field="stopNumber"]').trim();
      var on = t.getAttribute('data-on') === '1';
      if (!number) { toast('Type the mobile number.', 'error'); return; }
      await work(async function () {
        await opts.api.post('/api/admin/whatsapp/stop', { number: number, on: on });
        toast(on ? 'Done. No more WhatsApp messages go to that number.' : 'Done. That number can get messages again.');
        if (thread) thread.stopped = on;
      });
      return;
    }
    if (act === 'tpl-new') { form = { title: '', lang: 'en', body: '', greet: true, header: { type: 'none' }, buttons: [], category: 'MARKETING', replace: '', uploading: false }; draw(); return; }
    if (act === 'tpl-edit' || act === 'tpl-copy') {
      var src = ((D && D.templates) || []).filter(function (x) { return x.name === t.getAttribute('data-name'); })[0];
      if (!src) return;
      var hd = src.header || (src.image_url ? { type: 'image', url: src.image_url } : { type: 'none' });
      form = { title: src.title, lang: src.lang || 'en', body: src.body != null ? src.body : src.text.replace(/^(Hello|नमस्ते) \{\{1\}\},\n\n/, ''), greet: src.greet !== false,
        header: { type: hd.type || 'none', url: hd.url || '', filename: hd.filename || (hd.type === 'image' ? 'Picture' : ''), text: hd.text || '' },
        buttons: (src.buttons || (src.button ? [{ type: 'url', text: src.button, url: src.button_url }] : [])).map(function (b) { return { type: b.type, text: b.text || '', url: b.url || '', phone: b.phone || '' }; }),
        category: src.category, replace: act === 'tpl-edit' ? src.name : '', uploading: false };
      draw(); return;
    }
    if (act === 'form-cancel') { form = null; draw(); return; }
    if (act === 'form-top') { form.header = { type: t.getAttribute('data-top'), url: '', filename: '', text: form.header && form.header.type === 'text' ? form.header.text : '' }; draw(); return; }
    if (act === 'form-nofile') { form.header.url = ''; form.header.filename = ''; draw(); return; }
    if (act === 'form-insert') {
      var ta = host.querySelector('[data-form-field="body"]'), tok = t.getAttribute('data-token');
      if (!ta) return;
      var at = typeof ta.selectionStart === 'number' ? ta.selectionStart : ta.value.length, endAt = typeof ta.selectionEnd === 'number' ? ta.selectionEnd : at;
      var before = ta.value.slice(0, at), pad = before && !/\s$/.test(before) ? ' ' : '';
      ta.value = before + pad + tok + ' ' + ta.value.slice(endAt);
      form.body = ta.value;
      ta.focus(); var caret = (before + pad + tok + ' ').length; try { ta.setSelectionRange(caret, caret); } catch (err) { /* old browser */ }
      var pv = host.querySelector('[data-form-preview]'); if (pv) pv.innerHTML = formPreview();
      return;
    }
    if (act === 'form-btn-add') { form.buttons = (form.buttons || []).concat([{ type: t.getAttribute('data-type'), text: '', url: '', phone: '' }]); draw(); return; }
    if (act === 'form-btn-del') { form.buttons.splice(Number(t.getAttribute('data-i')), 1); draw(); return; }
    if (act === 'tpl-submit') {
      await work(async function () { var r = await opts.api.post('/api/admin/whatsapp/templates/' + encodeURIComponent(t.getAttribute('data-name')) + '/submit', {}); D.templates = r.templates; toast(r.status === 'APPROVED' ? 'Approved. It can be sent now.' : 'Sent to WhatsApp. It usually answers within minutes; press "Ask WhatsApp for the latest" to see.'); });
      return;
    }
    if (act === 'tpl-refresh') { await work(async function () { var r = await opts.api.get('/api/admin/whatsapp/templates?refresh=1'); D.templates = r.templates; if (r.error) toast(r.error, 'error'); else toast('Up to date.'); }); return; }
    if (act === 'tpl-delete') {
      if (!w.confirm('Delete this message? Sends already made with it are kept.')) return;
      await work(async function () {
        var res = await w.fetch('/api/admin/whatsapp/templates/' + encodeURIComponent(t.getAttribute('data-name')), { method: 'DELETE', headers: opts.authHeaders ? opts.authHeaders() : {} });
        var j = await res.json().catch(function () { return {}; });
        if (!res.ok) throw new Error(j.error || 'That did not work.');
        D.templates = j.templates;
      });
      return;
    }
    if (act === 'cfg-save') {
      var body = {};
      host.querySelectorAll('[data-cfg]').forEach(function (el) { if (el.value.trim()) body[el.getAttribute('data-cfg')] = el.value.trim(); });
      await work(async function () { take(await opts.api.post('/api/admin/whatsapp/config', body)); toast('Saved. Now press "Check the connection".'); });
      return;
    }
    if (act === 'cfg-check') { await work(async function () { var r = await opts.api.post('/api/admin/whatsapp/check', {}); checkResult = r.check; take(r); toast('Connected: ' + (r.check.number || 'the number answered') + '.'); }); return; }
    if (act === 'register') {
      var pin = val('[data-field="regPin"]').replace(/\s+/g, '');
      if (!/^\d{6}$/.test(pin)) { toast('The PIN is 6 digits.', 'error'); return; }
      await work(async function () {
        var r = await opts.api.post('/api/admin/whatsapp/register', { pin: pin });
        if (checkResult) checkResult.number_status = r.number_status;
        take(r);
        toast(r.already ? 'Our number was already registered. You can send.' : 'Registered. Our number can send now: try the test again.');
      });
      return;
    }
    if (act === 'set-save') {
      var set = { sending: host.querySelector('[data-set="sending"]').checked ? 'on' : 'off' };
      ['per_minute', 'daily_limit', 'hours_from', 'hours_to'].forEach(function (k) { set[k] = val('[data-set="' + k + '"]'); });
      await work(async function () { take(await opts.api.post('/api/admin/whatsapp/settings', set)); toast('Saved.'); });
      return;
    }
  }
  async function markOwn(id, undo) {
    try { await opts.api.post('/api/admin/whatsapp/own/mark', { attendee_id: Number(id), undo: !!undo }); (own.rows || []).forEach(function (r) { if (String(r.attendee_id) === String(id)) r.sent = !undo; }); } catch (err) { fail(err); }
    w.setTimeout(draw, undo ? 0 : 600);
  }

  function onChange(e) {
    var el = e.target;
    var f = el.getAttribute && el.getAttribute('data-field');
    if (f && Object.prototype.hasOwnProperty.call(draft, f)) {
      draft[f] = el.type === 'checkbox' ? el.checked : el.value;
      if (f === 'kind') { draft.audience = 'everyone'; ownShow = false; }
      aud = null; audError = '';
      if (el.type === 'radio' || el.type === 'checkbox' || el.tagName === 'SELECT') draw();
      return;
    }
    if (f === 'testTo') { testTo = el.value; return; }
    // Typing redraws the list; the "change" that follows when the box loses focus must not.
    if (f === 'inboxQ') { if (e.type === 'input') { inboxQ = el.value; draw(); } return; }
    if (f === 'pickTpl') { pickTpl = el.value; return; }
    var ff = el.getAttribute && el.getAttribute('data-form-field');
    if (ff && form) {
      if (ff === 'headerFile') { if (e.type === 'change') addHeaderFile(el.files && el.files[0]); return; }
      var val1 = el.type === 'checkbox' ? el.checked : el.value;
      var bm = /^btn\.(\d+)\.(type|text|url|phone)$/.exec(ff), hm = /^header\.(text|filename)$/.exec(ff);
      if (bm) {
        var bb = form.buttons[Number(bm[1])];
        if (!bb) return;
        bb[bm[2]] = val1;
        // A new kind of button shows other boxes; typing only changes the preview.
        if (bm[2] === 'type') { if (e.type === 'change') draw(); return; }
      } else if (hm) form.header[hm[1]] = val1;
      else {
        form[ff] = val1;
        if ((ff === 'lang' || ff === 'greet') && e.type === 'change') { draw(); return; }
      }
      var p = host.querySelector('[data-form-preview]');
      if (p) p.innerHTML = formPreview();
    }
  }
  // A picture, video or PDF goes to the server as the file itself; a picture is made a
  // sensible size first. The form keeps only where it is stored.
  var MAX_BYTES = { video: 16 * 1024 * 1024, document: 15 * 1024 * 1024 };
  async function addHeaderFile(file) {
    if (!file || !form) return;
    var kind = form.header.type;
    try {
      var body = file, type = file.type;
      if (kind === 'image') { var data = await readPicture(file); body = await (await w.fetch(data)).blob(); type = 'image/jpeg'; }
      else if (kind === 'video' && type !== 'video/mp4') throw new Error('The video must be an MP4.');
      else if (kind === 'document' && type !== 'application/pdf') throw new Error('Choose a PDF.');
      if (MAX_BYTES[kind] && file.size > MAX_BYTES[kind]) throw new Error(kind === 'video' ? 'The video is over 16 MB, WhatsApp’s limit. Make it shorter or smaller.' : 'The PDF is over 15 MB. Use a smaller one.');
      form.uploading = true; draw();
      var res = await w.fetch('/api/admin/whatsapp/media', { method: 'POST', headers: Object.assign({}, opts.authHeaders ? opts.authHeaders() : {}, { 'Content-Type': type, 'X-File-Name': encodeURIComponent(file.name || '') }), body: body });
      var j = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(j.error || 'The file could not be added.');
      if (form && form.header.type === kind) { form.header.url = j.url; form.header.filename = kind === 'document' ? (j.filename || 'Document.pdf') : (j.filename || (kind === 'video' ? 'Video' : 'Picture')); }
      toast('Added.');
    } catch (err) { fail(err); }
    if (form) form.uploading = false;
    draw();
  }
  async function onSubmit(e) {
    if (!e.target.getAttribute || e.target.getAttribute('data-form') !== 'tpl') return;
    e.preventDefault();
    var h = form.header || { type: 'none' };
    if ((h.type === 'image' || h.type === 'video' || h.type === 'document') && !h.url) { toast('Add the ' + (h.type === 'image' ? 'picture' : h.type === 'video' ? 'video' : 'PDF') + ', or choose Nothing on top.', 'error'); return; }
    await work(async function () {
      var r = await opts.api.post('/api/admin/whatsapp/templates', { title: form.title, lang: form.lang, body: form.body, greet: !!form.greet, category: form.category, replace: form.replace,
        header: { type: h.type, url: h.url || '', filename: h.filename || '', text: h.text || '' },
        buttons: (form.buttons || []).map(function (b) { return { type: b.type, text: b.text, url: b.url, phone: b.phone }; }) });
      D.templates = r.templates; form = null;
      toast('Saved. Press "Send to WhatsApp for approval" on it when you are happy with it.');
    });
  }

  async function mount(el, o) {
    opts = o || {};
    if (host !== el) {
      host = el;
      host.addEventListener('click', onClick);
      host.addEventListener('change', onChange);
      host.addEventListener('input', onChange);
      host.addEventListener('submit', onSubmit);
    }
    if (!D) host.innerHTML = '<div class="wad"><div class="wad-card"><p class="wad-sub">Loading...</p></div></div>';
    await load();
    pump();
  }

  w.WaDesk = { mount: mount, _t: { esc: esc, when: when, hour: hour, people: people, batchNumbers: batchNumbers, batchStatusWords: batchStatusWords, bubble: bubble, categoryWords: categoryWords } };
})(window);
