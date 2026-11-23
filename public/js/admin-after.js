/* Admin, After the Event (12 Nov 2026): the feedback survey and each exhibitor's results.
 *
 * Survey: preview the email, send a test, send it to everyone who checked in (a bulk
 * run of kind 'feedback', which skips anyone who has already answered), then read the
 * answers: the recommend score, the counts, who would come to Delhi, the one thing
 * each would fix, and a CSV of everything.
 * Exhibitor results: each exhibitor's badges scanned, meetings and app visits, a
 * preview, and one email per exhibitor to its booth contact, sent once unless sent
 * again on purpose.
 * Speaker photos (23 Nov 2026): each speaker's and Innovation Talk speaker's photos,
 * matched by face (src/routes/photos.ts), a preview, and one email each.
 *
 * The admin page loads this file the first time the section opens and calls
 * AfterDesk.mount(element, { api, toast, startCampaign, authHeaders }).
 * One global, AfterDesk.
 */
(function (w) {
  'use strict';

  var opts = null;
  var host = null;
  var survey = null;
  var exhibitors = [];
  var photos = null;
  var attendees = null;
  var findInfo = null;
  var booths = null;
  var busy = false;

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function num(n) { return Number(n || 0).toLocaleString('en-IN'); }
  function toast(msg, type) { if (opts && opts.toast) opts.toast(esc(msg), type || 'success'); }
  function hasStuff(r) { return (r.scanned + r.meetings + r.visits) > 0; }
  function emailOk(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '')); }

  function bars(list, total) {
    return '<div class="afd-bars">' + list.map(function (x) {
      var pct = total ? Math.round((x.n / total) * 100) : 0;
      return '<div class="afd-bar"><span class="afd-bar-label">' + esc(x.label) + '</span>'
        + '<span class="afd-bar-track"><span class="afd-bar-fill" style="width:' + pct + '%"></span></span>'
        + '<span class="afd-bar-n">' + num(x.n) + '</span></div>';
    }).join('') + '</div>';
  }

  function scoreWords(s) {
    if (s === null || s === undefined) return '';
    if (s >= 50) return 'excellent';
    if (s >= 20) return 'good';
    if (s >= 0) return 'fair';
    return 'needs work';
  }

  function surveyHtml() {
    var s = survey || {};
    var head = '<div class="afd-card-head"><h2><i class="fas fa-comments" aria-hidden="true"></i> Feedback survey</h2>'
      + '<p>Six questions, about two minutes. Send it on the evening of 21 Nov to everyone who checked in. Anyone who has already answered is skipped.</p></div>';
    var notReady = s.ready === false
      ? '<p class="afd-warn">The answers table is not in the database yet. Apply migration 0057 first; until then the survey page cannot save answers. You can still preview the email.</p>' : '';
    var came = Number(s.came || 0);
    var runs = (s.campaigns || []).map(function (k) {
      var st = k.status === 'done' ? 'finished' : k.status === 'paused' ? 'paused' : 'sending';
      return '<li>Run ' + esc(k.id) + ': ' + num(k.sent) + ' of ' + num(k.total) + ' sent' + (k.failed ? ', ' + num(k.failed) + ' failed' : '') + ' (' + st + ')</li>';
    }).join('');
    var rec = s.recommend || {};
    var stats = '<div class="afd-stats">'
      + '<div><b>' + num(came) + '</b><span>checked in</span></div>'
      + '<div><b>' + num(s.answered) + '</b><span>answered</span></div>'
      + '<div><b>' + (rec.score === null || rec.score === undefined ? '&ndash;' : esc(rec.score)) + '</b><span>recommend score' + (rec.score === null || rec.score === undefined ? '' : ', ' + esc(scoreWords(rec.score))) + '</span></div>'
      + '<div><b>' + (rec.average === null || rec.average === undefined ? '&ndash;' : esc(rec.average)) + '</b><span>average out of 10</span></div>'
      + '</div>';
    var actions = '<div class="afd-actions">'
      + '<button type="button" class="afd-btn" data-act="preview-survey"><i class="fas fa-eye" aria-hidden="true"></i> Preview the email</button>'
      + '<span class="afd-test"><label class="afd-sr" for="afd-test-to">Send a test to</label><input id="afd-test-to" type="email" placeholder="your@email" autocomplete="email">'
      + '<button type="button" class="afd-btn" data-act="test-survey">Send a test</button></span>'
      + '<button type="button" class="afd-btn afd-primary" data-act="send-survey"' + (came && s.ready !== false ? '' : ' disabled') + '>'
      + '<i class="fas fa-paper-plane" aria-hidden="true"></i> Send to everyone who checked in (' + num(came) + ')</button>'
      + '</div>'
      + (came ? '' : '<p class="afd-note">Nobody has checked in yet, so there is nobody to send it to.</p>')
      + (runs ? '<ul class="afd-runs">' + runs + '</ul><p class="afd-note">Keep this tab open while it sends; the server also sends one a minute if the tab is closed.</p>' : '');

    var results = '';
    if (s.ready && s.answered) {
      var by = rec.by || [];
      var max = Math.max.apply(null, by.concat([1]));
      var scale = '<div class="afd-scale" aria-label="Answers from 0 to 10">' + by.map(function (n, i) {
        var cls = i >= 9 ? 'pro' : i >= 7 ? 'pas' : 'det';
        return '<div class="afd-col"><span class="afd-col-n">' + num(n) + '</span><span class="afd-col-bar ' + cls + '" style="height:' + Math.round((n / max) * 60) + 'px"></span><span class="afd-col-i">' + i + '</span></div>';
      }).join('') + '</div>'
        + '<p class="afd-note">Score = people who gave 9 or 10 (' + num(rec.promoters) + ') minus people who gave 0 to 6 (' + num(rec.detractors) + '), as a share of everyone who answered.</p>';
      var delhi = (s.delhi_people || []);
      var comments = (s.comments || []);
      results = '<div class="afd-results">'
        + '<h3>How likely to recommend</h3>' + scale
        + '<div class="afd-grid2">'
        + '<div><h3>Most useful</h3>' + bars(s.useful || [], s.answered) + '</div>'
        + '<div><h3>Met someone to follow up</h3>' + bars(s.met || [], s.answered) + '</div>'
        + '<div><h3>Getting in and finding the way</h3>' + bars(s.entry || [], s.answered) + '</div>'
        + '<div><h3>Coming to Delhi 2027</h3>' + bars(s.delhi || [], s.answered) + '</div>'
        + '</div>'
        + '<h3>Said yes or maybe to Delhi (' + num(delhi.length) + ')</h3>'
        + (delhi.length ? '<div class="afd-table-wrap"><table class="afd-table"><thead><tr><th>Name</th><th>Organisation</th><th>Email</th><th>Delhi</th></tr></thead><tbody>'
          + delhi.map(function (p) { return '<tr><td>' + esc(p.name) + '<div class="afd-sub">' + esc(p.job_title) + '</div></td><td>' + esc(p.company) + '</td><td>' + esc(p.email) + '</td><td>' + (p.delhi === 'yes' ? 'Yes' : 'Maybe') + '</td></tr>'; }).join('')
          + '</tbody></table></div>' : '<p class="afd-note">Nobody yet.</p>')
        + '<h3>One thing to fix (' + num(comments.length) + ')</h3>'
        + (comments.length ? '<ul class="afd-comments">' + comments.map(function (x) {
          return '<li><p>' + esc(x.fix) + '</p><span>' + esc(x.name) + (x.company ? ', ' + esc(x.company) : '') + ' &middot; gave ' + esc(x.recommend) + '</span></li>';
        }).join('') + '</ul>' : '<p class="afd-note">No suggestions yet.</p>')
        + '<button type="button" class="afd-btn" data-act="csv"><i class="fas fa-download" aria-hidden="true"></i> Download all answers (CSV)</button>'
        + '</div>';
    } else if (s.ready) {
      results = '<p class="afd-note">No answers yet. They appear here as people send them.</p>';
    }
    return '<section class="afd-card">' + head + notReady + stats + actions + results + '</section>';
  }

  function exhibitorsHtml() {
    var ready = exhibitors.filter(function (r) { return !r.sent_count && emailOk(r.email) && hasStuff(r); });
    var head = '<div class="afd-card-head"><h2><i class="fas fa-handshake" aria-hidden="true"></i> Exhibitor results</h2>'
      + '<p>One email per exhibitor to its booth contact, from register@: badges scanned, meetings held, a link to its leads, and Delhi 2027. Send it after the doors close on 21 Nov.</p></div>';
    var actions = '<div class="afd-actions"><button type="button" class="afd-btn afd-primary" data-act="send-all-ex"' + (ready.length ? '' : ' disabled') + '>'
      + '<i class="fas fa-paper-plane" aria-hidden="true"></i> Send to all not yet sent (' + num(ready.length) + ')</button>'
      + '<span class="afd-note" id="afd-ex-progress" aria-live="polite"></span></div>'
      + '<p class="afd-note">"Send to all" leaves out exhibitors with nothing recorded and those without a contact email. You can still send to them one by one.</p>';
    if (!exhibitors.length) return '<section class="afd-card">' + head + '<p class="afd-note">No exhibitors for this event.</p></section>';
    var rows = exhibitors.map(function (r) {
      var rated = [r.hot ? r.hot + ' hot' : '', r.warm ? r.warm + ' warm' : '', r.cold ? r.cold + ' cold' : ''].filter(Boolean).join(', ');
      var contact = emailOk(r.email) ? esc(r.contact_name || '') + '<div class="afd-sub">' + esc(r.email) + '</div>' : '<span class="afd-bad">No contact email</span>';
      var sent = r.sent_count ? '<span class="afd-ok">Sent ' + esc(r.sent_at) + '</span>' + (r.sent_count > 1 ? '<div class="afd-sub">' + num(r.sent_count) + ' times</div>' : '') : (hasStuff(r) ? 'Not yet' : '<span class="afd-sub">Nothing recorded</span>');
      return '<tr data-id="' + esc(r.id) + '"><td><b>' + esc(r.company) + '</b>' + (r.booth ? '<div class="afd-sub">Stand ' + esc(r.booth) + '</div>' : '') + '</td>'
        + '<td>' + contact + '</td>'
        + '<td class="afd-n">' + num(r.scanned) + (rated ? '<div class="afd-sub">' + esc(rated) + '</div>' : '') + '</td>'
        + '<td class="afd-n">' + num(r.meetings) + '</td><td class="afd-n">' + num(r.visits) + '</td>'
        + '<td>' + sent + '</td>'
        + '<td class="afd-row-actions"><button type="button" class="afd-btn afd-small" data-act="preview-ex" data-id="' + esc(r.id) + '">Preview</button>'
        + '<button type="button" class="afd-btn afd-small" data-act="send-ex" data-id="' + esc(r.id) + '"' + (emailOk(r.email) ? '' : ' disabled') + '>' + (r.sent_count ? 'Send again' : 'Send') + '</button></td></tr>';
    }).join('');
    return '<section class="afd-card">' + head + actions
      + '<div class="afd-table-wrap"><table class="afd-table"><thead><tr><th>Exhibitor</th><th>Booth contact</th><th class="afd-n">Badges scanned</th><th class="afd-n">Meetings</th><th class="afd-n">App visits</th><th>Results email</th><th><span class="afd-sr">Actions</span></th></tr></thead><tbody>'
      + rows + '</tbody></table></div></section>';
  }

  // Speaker photos (23 Nov 2026): one email per speaker or Innovation Talk speaker with
  // the event photos they are in (matched by face, src/routes/photos.ts) and a link to
  // their own page. Sent once unless sent again on purpose; officials only on purpose.
  var PH_STATUS = {
    ready: 'Not sent yet', check: 'Look before sending: weaker match', panel: 'Waiting: check the session line-up above', sent: 'Sent', 'no-email': 'No email address', protocol: 'Official: through their office', 'no-photos': 'No photos found'
  };
  function photosHtml() {
    var head = '<div class="afd-card-head"><h2><i class="fas fa-images" aria-hidden="true"></i> Speaker photos</h2>'
      + '<p>One email per speaker and Innovation Talk speaker, from register@, with the event photos they are in and a link to their own page, where every photo downloads at full size. The photos were found by matching each speaker&rsquo;s photo on the site against the photographers&rsquo; photos.</p></div>';
    if (!photos) return '<section class="afd-card">' + head + '<p class="afd-note">Loading...</p></section>';
    if (photos.error) return '<section class="afd-card">' + head + '<p class="afd-warn">' + esc(photos.error) + '</p></section>';
    var rows = photos.rows || [];
    var ready = rows.filter(function (r) { return r.status === 'ready'; });
    var found = rows.filter(function (r) { return r.count > 0; });
    var c = photos.counts || {};
    var stats = '<p class="afd-note">' + num(found.length) + ' people found in the photos, ' + num(c.sent || 0) + ' sent, '
      + num(c.check || 0) + ' to look at before sending (a weaker match: open the preview and check the photos are them), '
      + num(c['no-email'] || 0) + ' without an email, ' + num(c.protocol || 0) + ' officials held back, ' + num(c['no-photos'] || 0) + ' not found in any photo.'
      + (photos.generated ? ' Matched ' + esc(photos.generated) + '.' : '') + '</p>';
    var actions = '<div class="afd-actions"><button type="button" class="afd-btn afd-primary" data-act="send-all-ph"' + (ready.length ? '' : ' disabled') + '>'
      + '<i class="fas fa-paper-plane" aria-hidden="true"></i> Send to all not yet sent (' + num(ready.length) + ')</button>'
      + '<span class="afd-note" id="afd-ph-progress" aria-live="polite"></span></div>';
    var body = rows.map(function (r) {
      var thumbs = (r.thumbs || []).map(function (u) { return '<img src="' + esc(u) + '" alt="" loading="lazy" width="40" height="40">'; }).join('');
      var pics = r.count ? '<b>' + num(r.count) + '</b><div class="afd-thumbs">' + thumbs + '</div>'
        + (r.page ? '<a class="afd-sub" href="' + esc(r.page) + '" target="_blank" rel="noopener">Open their page</a>' : '') : '<span class="afd-sub">None found</span>';
      var mail = r.email ? esc(r.email) + '<div class="afd-sub">' + esc(r.email_note || '') + '</div>' : '<span class="afd-bad">No email</span>';
      var st = r.status === 'sent' ? '<span class="afd-ok">Sent ' + esc(r.sent_at) + '</span>' + (r.sent_count > 1 ? '<div class="afd-sub">' + num(r.sent_count) + ' times</div>' : '')
        : r.status === 'ready' ? 'Not yet' : '<span class="afd-sub">' + esc(PH_STATUS[r.status] || r.status) + '</span>';
      var canSend = r.count > 0 && !!r.email;
      var word = r.sent_count ? 'Send again' : (r.protocol ? 'Send anyway' : 'Send');
      return '<tr><td><b>' + esc(r.name) + '</b><div class="afd-sub">' + esc([r.org].concat(r.kinds || []).filter(Boolean).join(' · ')) + '</div></td>'
        + '<td>' + pics + '</td><td>' + mail + '</td><td>' + st + '</td>'
        + '<td class="afd-row-actions"><button type="button" class="afd-btn afd-small" data-act="preview-ph" data-id="' + esc(r.key) + '"' + (r.count ? '' : ' disabled') + '>Preview</button>'
        + '<button type="button" class="afd-btn afd-small" data-act="send-ph" data-id="' + esc(r.key) + '"' + (canSend ? '' : ' disabled') + '>' + word + '</button></td></tr>';
    }).join('');
    return '<section class="afd-card">' + head + stats + panelsHtml() + actions
      + '<div class="afd-table-wrap"><table class="afd-table"><thead><tr><th>Person</th><th>Photos</th><th>Email</th><th>Photos email</th><th><span class="afd-sr">Actions</span></th></tr></thead><tbody>'
      + body + '</tbody></table></div></section>';
  }

  // Each session's line-up as the live programme has it, checked against the photos and the
  // badge desk: someone who may have dropped out, someone who may have replaced them. A
  // flagged session's speakers wait until the line-up is confirmed (or fixed in Admin ->
  // Conference, after which it is checked again).
  function panelsHtml() {
    var all = (photos && photos.panels) || [];
    var todo = all.filter(function (k) { return k.flagged && !k.confirmed; });
    var okN = all.filter(function (k) { return k.confirmed; }).length;
    var fine = all.length - todo.length - okN;
    var mark = function (p) {
      var seen = p.seen ? 'in ' + p.seen + ' of its photos' : (p.album ? 'in none of its photos' : 'no photo of them to look for');
      var came = p.present === true ? 'checked in that day' : p.present === false ? 'no check-in that day' : 'check-in not known';
      return '<li><b>' + esc(p.name) + '</b>' + (p.role ? ' &middot; ' + esc(p.role) : '') + (p.line ? '<div class="afd-sub">' + esc(p.line) + '</div>' : '')
        + '<div class="afd-sub">' + esc(seen) + ', ' + esc(came) + '</div></li>';
    };
    var cards = todo.map(function (k) {
      return '<div class="afd-panel"><div><b>' + esc(k.title) + '</b><div class="afd-sub">' + esc(k.when) + ' &middot; ' + esc(k.photos) + ' photos from it</div></div>'
        + '<ul class="afd-why">' + k.reasons.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>'
        + '<div class="afd-sub">On the programme now:</div><ul class="afd-people">' + k.people.map(mark).join('')
        + (k.typed || []).map(function (n) { return '<li><b>' + esc(n) + '</b><div class="afd-sub">typed into the programme, not on the speaker list</div></li>'; }).join('') + '</ul>'
        + (k.waiting && k.waiting.length ? '<div class="afd-sub">Waiting for this: ' + esc(k.waiting.join(', ')) + '</div>' : '')
        + '<div class="afd-actions"><button type="button" class="afd-btn afd-small" data-act="panel-ok" data-id="' + esc(k.id) + '" data-fp="' + esc(k.fp) + '">The line-up is right</button>'
        + '<span class="afd-sub">If someone dropped out or was replaced, fix the session in Admin &rarr; Conference; this list follows.</span></div></div>';
    }).join('');
    return '<h3>Session line-ups to check before sending (' + num(todo.length) + ')</h3>'
      + '<p class="afd-note">Each email shows the speaker&rsquo;s session and who was on it, from the live programme. ' + num(fine) + ' sessions look right from the photos and the badge desk; '
      + num(okN) + ' you have confirmed.' + (todo.length ? ' These ' + num(todo.length) + ' need a look: their speakers wait until you confirm.' : '') + '</p>'
      + cards;
  }

  // Attendee photos (23 Nov 2026): everyone registered with a profile photo in the app,
  // matched by face more strictly than speakers, by the organiser's order of priority. One
  // email each with only their own photos; on their page they can say "Not me" or "Don't
  // match my photos". No attendee is ever named to anyone else.
  var ATT_STATUS = { ready: 'Not sent yet', check: 'Look before sending: weaker match', sent: 'Sent', 'no-email': 'No email address', unsubscribed: 'Unsubscribed', 'opted-out': 'Asked not to be matched', 'no-photos': 'No photos left' };
  function attendeesHtml() {
    var head = '<div class="afd-card-head"><h2><i class="fas fa-users" aria-hidden="true"></i> Attendee photos</h2>'
      + '<p>Everyone registered with a profile photo in the app was matched, scanned at the badge desk or not, more strictly than speakers. One email each, from register@, with only their own photos and their page, where they can say &ldquo;Not me&rdquo; or &ldquo;Don&rsquo;t match my photos&rdquo;. No attendee is ever named to anyone else. Groups are in your order of priority.</p></div>';
    if (!attendees) return '<section class="afd-card">' + head + '<p class="afd-note">Loading...</p></section>';
    if (attendees.error) return '<section class="afd-card">' + head + '<p class="afd-warn">' + esc(attendees.error) + '</p></section>';
    var groups = (attendees.groups || []).map(function (g) {
      return '<tr><td><b>' + esc(g.name) + '</b></td><td class="afd-n">' + num(g.found) + '</td><td class="afd-n">' + num(g.ready) + '</td><td class="afd-n">' + num(g.check) + '</td><td class="afd-n">' + num(g.sent) + '</td><td class="afd-n">' + num(g.no_email + g.opted_out) + '</td>'
        + '<td class="afd-row-actions"><button type="button" class="afd-btn afd-small afd-primary" data-act="send-att-group" data-id="' + esc(g.group) + '"' + (g.ready ? '' : ' disabled') + '>Send to ' + num(g.ready) + ' ready</button></td></tr>';
    }).join('');
    var rows = (attendees.rows || []).map(function (r) {
      var thumbs = (r.thumbs || []).map(function (u) { return '<img src="' + esc(u) + '" alt="" loading="lazy" width="40" height="40">'; }).join('');
      var st = r.status === 'sent' ? '<span class="afd-ok">Sent ' + esc(r.sent_at) + '</span>' : r.status === 'ready' ? 'Not yet' : '<span class="afd-sub">' + esc(ATT_STATUS[r.status] || r.status) + '</span>';
      var can = r.count > 0 && ['ready', 'check', 'sent'].indexOf(r.status) >= 0;
      return '<tr><td><b>' + esc(r.name) + '</b><div class="afd-sub">' + esc([r.pass, r.company].filter(Boolean).join(' · ')) + (r.came ? '' : ' · not scanned at the desk') + '</div></td>'
        + '<td>' + esc(r.group_name) + '</td><td><b>' + num(r.count) + '</b><div class="afd-thumbs">' + thumbs + '</div><a class="afd-sub" href="' + esc(r.page) + '" target="_blank" rel="noopener">Open their page</a></td>'
        + '<td>' + (r.email ? esc(r.email) : '<span class="afd-bad">No email</span>') + '</td><td>' + st + '</td>'
        + '<td class="afd-row-actions"><button type="button" class="afd-btn afd-small" data-act="preview-att" data-id="' + esc(r.key) + '">Preview</button>'
        + '<button type="button" class="afd-btn afd-small" data-act="send-att" data-id="' + esc(r.key) + '"' + (can ? '' : ' disabled') + '>' + (r.sent_count ? 'Send again' : 'Send') + '</button></td></tr>';
    }).join('');
    return '<section class="afd-card">' + head
      + '<div class="afd-table-wrap"><table class="afd-table"><thead><tr><th>Group</th><th class="afd-n">Found</th><th class="afd-n">Ready</th><th class="afd-n">Look first</th><th class="afd-n">Sent</th><th class="afd-n">No email or opted out</th><th><span class="afd-sr">Send</span></th></tr></thead><tbody>' + groups + '</tbody></table></div>'
      + '<p class="afd-note">"Send to N ready" leaves out the weaker matches: open their preview and page first, then send them one by one. <span id="afd-att-progress" aria-live="polite"></span></p>'
      + findHtml()
      + '<div class="afd-table-wrap"><table class="afd-table"><thead><tr><th>Person</th><th>Group</th><th>Photos</th><th>Email</th><th>Photos email</th><th><span class="afd-sr">Actions</span></th></tr></thead><tbody>' + rows + '</tbody></table></div></section>';
  }

  // "Are you in the photos?" (23 Nov 2026): everyone registered and not found yet is asked to
  // add a clear photo of themselves in the app; the next matching run finds them and their
  // photos email follows. A bulk run of kind find_photos, sent by the minute clock.
  function findHtml() {
    var f = findInfo;
    if (!f) return '';
    if (f.error) return '<p class="afd-warn">' + esc(f.error) + '</p>';
    return '<div class="afd-panel"><b>Not found yet: ' + num(f.audience) + ' people</b>'
      + '<p class="afd-note">They registered for Mumbai but are in none of the photos we can match, mostly because they have no clear photo in the app. Email them &ldquo;' + esc(f.subject) + '&rdquo;: add a clear photo of yourself in the app and we will find your photos. After they add one, the matching is run again and their photos email follows here. Leaves out anyone found, unsubscribed or who asked not to be matched.</p>'
      + '<div class="afd-actions"><button type="button" class="afd-btn afd-small" data-act="preview-find">Preview</button>'
      + '<button type="button" class="afd-btn afd-small afd-primary" data-act="send-find"' + (f.audience ? '' : ' disabled') + '>Email ' + num(f.audience) + ' people</button></div></div>';
  }

  // Booth photos (23 Nov 2026): the photos each exhibitor's company name or logo is in, found
  // by reading the text in every photo (scripts/photos/exh_match.py), on its dashboard under
  // Booth photos. One email per company to its booth contact, with a sign-in button.
  var BOOTH_STATUS = { ready: 'Not yet', sent: 'Sent', 'no-email': 'No contact email', 'no-photos': 'No photos in the store yet' };
  function boothsHtml() {
    var head = '<div class="afd-card-head"><h2><i class="fas fa-images" aria-hidden="true"></i> Booth photos</h2>'
      + '<p>For every exhibitor, even when no face was matched: the photos their company&rsquo;s name or logo is in (booth, banner, screen, their own talk slide), read from the text in each photo. The stage&rsquo;s logo walls do not count. They see them on their exhibitor dashboard under Booth photos. One email per company to its booth contact, from register@.</p></div>';
    if (!booths) return '<section class="afd-card">' + head + '<p class="afd-note">Loading...</p></section>';
    if (booths.error) return '<section class="afd-card">' + head + '<p class="afd-warn">' + esc(booths.error) + '</p></section>';
    var list = booths.rows || [];
    var ready = list.filter(function (r) { return r.status === 'ready'; });
    var rows = list.map(function (r) {
      var thumbs = (r.thumbs || []).map(function (u) { return '<img src="' + esc(u) + '" alt="" loading="lazy" width="40" height="40">'; }).join('');
      var st = r.status === 'sent' ? '<span class="afd-ok">Sent ' + esc(r.sent_at) + '</span>' + (r.sent_count > 1 ? '<div class="afd-sub">' + num(r.sent_count) + ' times</div>' : '') : r.status === 'ready' ? 'Not yet' : '<span class="afd-sub">' + esc(BOOTH_STATUS[r.status] || r.status) + '</span>';
      var can = r.count > 0 && emailOk(r.email);
      return '<tr><td><b>' + esc(r.company) + '</b>' + (r.booth ? '<div class="afd-sub">Booth ' + esc(r.booth) + '</div>' : '') + '</td>'
        + '<td><b>' + num(r.count) + '</b><div class="afd-thumbs">' + thumbs + '</div></td>'
        + '<td>' + (emailOk(r.email) ? esc(r.email) : '<span class="afd-bad">No contact email</span>') + '</td><td>' + st + '</td>'
        + '<td class="afd-row-actions"><button type="button" class="afd-btn afd-small" data-act="preview-booth" data-id="' + esc(r.key) + '">Preview</button>'
        + '<button type="button" class="afd-btn afd-small" data-act="send-booth" data-id="' + esc(r.key) + '"' + (can ? '' : ' disabled') + '>' + (r.sent_count ? 'Send again' : 'Send') + '</button></td></tr>';
    }).join('');
    return '<section class="afd-card">' + head
      + '<p class="afd-note">' + num(list.length) + ' companies, ' + num(booths.photos) + ' photos.</p>'
      + '<div class="afd-actions"><button type="button" class="afd-btn afd-primary" data-act="send-all-booth"' + (ready.length ? '' : ' disabled') + '>'
      + '<i class="fas fa-paper-plane" aria-hidden="true"></i> Send to all not yet sent (' + num(ready.length) + ')</button>'
      + '<span class="afd-note" id="afd-booth-progress" aria-live="polite"></span></div>'
      + '<div class="afd-table-wrap"><table class="afd-table"><thead><tr><th>Exhibitor</th><th>Photos</th><th>Booth contact</th><th>Booth photos email</th><th><span class="afd-sr">Actions</span></th></tr></thead><tbody>' + rows + '</tbody></table></div></section>';
  }

  function draw() {
    host.innerHTML = '<div class="afd">' + photosHtml() + attendeesHtml() + surveyHtml() + exhibitorsHtml() + boothsHtml() + '</div>';
  }

  function preview(title, to, subject, html) {
    var old = document.getElementById('afd-preview');
    if (old) old.remove();
    var box = document.createElement('div');
    box.id = 'afd-preview';
    box.className = 'afd-modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', title);
    box.innerHTML = '<div class="afd-modal-card"><div class="afd-modal-head"><div><b>' + esc(title) + '</b>'
      + (to ? '<div class="afd-sub">To: ' + esc(to) + '</div>' : '') + '<div class="afd-sub">Subject: ' + esc(subject) + '</div></div>'
      + '<button type="button" class="afd-btn afd-small" data-close>Close</button></div><iframe title="Email preview" sandbox=""></iframe></div>';
    document.body.appendChild(box);
    box.querySelector('iframe').srcdoc = html;
    var close = function () { box.remove(); document.removeEventListener('keydown', onKey); };
    var onKey = function (e) { if (e.key === 'Escape') close(); };
    box.addEventListener('click', function (e) { if (e.target === box || e.target.hasAttribute('data-close')) close(); });
    document.addEventListener('keydown', onKey);
    box.querySelector('[data-close]').focus();
  }

  async function sendOne(id, again) {
    return opts.api.post('/api/admin/exhibitor-results/' + encodeURIComponent(id) + '/send', { again: !!again });
  }

  async function onClick(e) {
    var b = e.target.closest('[data-act]');
    if (!b || !host.contains(b) || b.disabled || busy) return;
    var act = b.getAttribute('data-act');
    var id = b.getAttribute('data-id');
    try {
      if (act === 'preview-survey') {
        var p = await opts.api.get('/api/admin/feedback/preview');
        preview('Feedback survey email', '', p.subject, p.html);
      } else if (act === 'test-survey') {
        var to = (document.getElementById('afd-test-to').value || '').trim();
        if (!emailOk(to)) { toast('Type the email address to send the test to.', 'error'); return; }
        busy = true; b.disabled = true;
        await opts.api.post('/api/admin/feedback/test', { to: to });
        toast('Test sent to ' + to + '.');
      } else if (act === 'send-survey') {
        var n = Number((survey && survey.came) || 0);
        if (!w.confirm('Send the feedback survey to everyone who checked in? That is up to ' + n.toLocaleString('en-IN') + ' people, one email each. Anyone who has already answered is skipped.')) return;
        await opts.startCampaign('feedback', { audience: 'checked_in', title: 'Feedback survey' });
        await refresh();
      } else if (act === 'csv') {
        var res = await fetch('/api/admin/feedback.csv', { headers: opts.authHeaders() });
        if (!res.ok) { var j = await res.json().catch(function () { return {}; }); throw new Error(j.error || 'The download did not work.'); }
        var blob = await res.blob();
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'feedback-bharat-ai-innovation-2026.csv';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      } else if (act === 'preview-ex') {
        var q = await opts.api.get('/api/admin/exhibitor-results/' + encodeURIComponent(id) + '/preview');
        preview('Results email', q.to, q.subject, q.html);
      } else if (act === 'send-ex') {
        var r = exhibitors.find(function (x) { return String(x.id) === String(id); });
        if (!r) return;
        var again = !!r.sent_count;
        var words = again
          ? 'Send the results email to ' + r.company + ' again, to ' + r.email + '? It was sent on ' + r.sent_at + '.'
          : 'Send the results email to ' + r.company + ', to ' + r.email + '?' + (hasStuff(r) ? '' : ' Nothing is recorded for them, so it will show zeros.');
        if (!w.confirm(words)) return;
        busy = true; b.disabled = true;
        await sendOne(r.id, again);
        toast('Results sent to ' + r.company + '.');
        await refresh();
      } else if (act === 'preview-find') {
        preview('Are you in the photos? email', '', findInfo.subject, findInfo.html);
      } else if (act === 'send-find') {
        var fn = Number((findInfo && findInfo.audience) || 0);
        if (!fn || !w.confirm('Email ' + fn.toLocaleString('en-IN') + ' people "' + findInfo.subject + '", asking them to add a clear photo in the app? It goes out at about 30 a minute.')) return;
        busy = true; b.disabled = true;
        await opts.startCampaign('find_photos', { audience: 'not_found', title: 'Are you in the photos?' });
        toast('Started. It goes out at about 30 a minute.');
        await refresh();
      } else if (act === 'preview-att') {
        var av = await opts.api.get('/api/admin/attendee-photos/' + encodeURIComponent(id) + '/preview');
        preview('Attendee photos email', av.to, av.subject, av.html);
      } else if (act === 'send-att') {
        var ar = ((attendees && attendees.rows) || []).find(function (x) { return String(x.key) === String(id); });
        if (!ar) return;
        var aw = ar.sent_count ? 'Send ' + ar.name + ' their photos again, to ' + ar.email + '?'
          : ar.status === 'check' ? 'The match for ' + ar.name + ' is weaker, so some photos may show someone else. Have you opened their page and checked? Send their ' + ar.count + ' photos to ' + ar.email + '?'
          : 'Send ' + ar.name + ' their ' + ar.count + ' photos, to ' + ar.email + '?';
        if (!w.confirm(aw)) return;
        busy = true; b.disabled = true;
        await opts.api.post('/api/admin/attendee-photos/' + encodeURIComponent(ar.key) + '/send', { again: !!ar.sent_count });
        toast('Photos sent to ' + ar.name + '.');
        await refresh();
      } else if (act === 'send-att-group') {
        var gi = Number(id);
        var gl = ((attendees && attendees.rows) || []).filter(function (x) { return x.group === gi && x.status === 'ready'; });
        var gname = (((attendees && attendees.groups) || [])[gi] || {}).name || 'this group';
        if (!gl.length) return;
        if (!w.confirm('Send ' + gl.length + ' people in ' + gname + ' their photos, one email each? Weaker matches, people already sent, without an email, unsubscribed or who asked not to be matched are left out.')) return;
        busy = true; b.disabled = true;
        var gok = 0, gfail = [];
        for (var gk = 0; gk < gl.length; gk++) {
          var gp = document.getElementById('afd-att-progress');
          if (gp) gp.textContent = 'Sending ' + (gk + 1) + ' of ' + gl.length + '...';
          try { await opts.api.post('/api/admin/attendee-photos/' + encodeURIComponent(gl[gk].key) + '/send', {}); gok++; }
          catch (err) { if (!(err && err.data && err.data.already)) gfail.push(gl[gk].name + ': ' + (err.message || 'failed')); }
        }
        toast(gok + ' sent' + (gfail.length ? ', ' + gfail.length + ' did not send: ' + gfail.slice(0, 3).join('; ') : '.'), gfail.length ? 'error' : 'success');
        await refresh();
      } else if (act === 'panel-ok') {
        busy = true; b.disabled = true;
        await opts.api.post('/api/admin/speaker-photos/panels/' + encodeURIComponent(id) + '/ok', { fp: b.getAttribute('data-fp') });
        toast('Line-up confirmed.');
        await refresh();
      } else if (act === 'preview-ph') {
        var pv = await opts.api.get('/api/admin/speaker-photos/' + encodeURIComponent(id) + '/preview');
        preview('Photos email', pv.to, pv.subject, pv.html);
      } else if (act === 'send-ph') {
        var pr = ((photos && photos.rows) || []).find(function (x) { return String(x.key) === String(id); });
        if (!pr) return;
        var phAgain = !!pr.sent_count;
        var phWords = phAgain
          ? 'Send ' + pr.name + ' their photos again, to ' + pr.email + '? They were sent on ' + pr.sent_at + '.'
          : pr.protocol
            ? pr.name + ' is a government official; their office usually handles this. Send them their ' + pr.count + ' photos anyway, to ' + pr.email + '?'
            : pr.status === 'check'
              ? 'The match for ' + pr.name + ' is weaker, so some photos may show someone else. Have you opened the preview and checked the photos are them? Send their ' + pr.count + ' photos to ' + pr.email + '?'
              : 'Send ' + pr.name + ' their ' + pr.count + ' photos, to ' + pr.email + '?';
        if (!w.confirm(phWords)) return;
        busy = true; b.disabled = true;
        await opts.api.post('/api/admin/speaker-photos/' + encodeURIComponent(pr.key) + '/send', { again: phAgain, anyway: !!pr.protocol });
        toast('Photos sent to ' + pr.name + '.');
        await refresh();
      } else if (act === 'send-all-ph') {
        var phList = ((photos && photos.rows) || []).filter(function (x) { return x.status === 'ready'; });
        if (!phList.length) return;
        if (!w.confirm('Send ' + phList.length + ' people their photos, one email each? Anyone already sent, officials, people with no email or no photos, and the weaker matches to look at first are left out.')) return;
        busy = true; b.disabled = true;
        var phOk = 0, phFailed = [];
        for (var k = 0; k < phList.length; k++) {
          var phProg = document.getElementById('afd-ph-progress');
          if (phProg) phProg.textContent = 'Sending ' + (k + 1) + ' of ' + phList.length + '...';
          try { await opts.api.post('/api/admin/speaker-photos/' + encodeURIComponent(phList[k].key) + '/send', {}); phOk++; }
          catch (err) { if (!(err && err.data && err.data.already)) phFailed.push(phList[k].name + ': ' + (err.message || 'failed')); }
        }
        toast(phOk + ' sent' + (phFailed.length ? ', ' + phFailed.length + ' did not send: ' + phFailed.slice(0, 3).join('; ') : '.'), phFailed.length ? 'error' : 'success');
        await refresh();
      } else if (act === 'preview-booth') {
        var bv = await opts.api.get('/api/admin/booth-photos/' + encodeURIComponent(id) + '/preview');
        preview('Booth photos email', bv.to, bv.subject, bv.html);
      } else if (act === 'send-booth') {
        var br = ((booths && booths.rows) || []).find(function (x) { return String(x.key) === String(id); });
        if (!br) return;
        var bw = br.sent_count ? 'Send ' + br.company + ' their booth photos again, to ' + br.email + '? They were sent on ' + br.sent_at + '.'
          : 'Send ' + br.company + ' their ' + br.count + ' booth photos, to ' + br.email + '?';
        if (!w.confirm(bw)) return;
        busy = true; b.disabled = true;
        await opts.api.post('/api/admin/booth-photos/' + encodeURIComponent(br.key) + '/send', { again: !!br.sent_count });
        toast('Booth photos sent to ' + br.company + '.');
        await refresh();
      } else if (act === 'send-all-booth') {
        var bl = ((booths && booths.rows) || []).filter(function (x) { return x.status === 'ready'; });
        if (!bl.length) return;
        if (!w.confirm('Send ' + bl.length + ' exhibitors their booth photos, one email each to the booth contact? Exhibitors already sent, without a contact email or with no photos are left out.')) return;
        busy = true; b.disabled = true;
        var bok = 0, bfail = [];
        for (var bk = 0; bk < bl.length; bk++) {
          var bp = document.getElementById('afd-booth-progress');
          if (bp) bp.textContent = 'Sending ' + (bk + 1) + ' of ' + bl.length + '...';
          try { await opts.api.post('/api/admin/booth-photos/' + encodeURIComponent(bl[bk].key) + '/send', {}); bok++; }
          catch (err) { if (!(err && err.data && err.data.already)) bfail.push(bl[bk].company + ': ' + (err.message || 'failed')); }
        }
        toast(bok + ' sent' + (bfail.length ? ', ' + bfail.length + ' did not send: ' + bfail.slice(0, 3).join('; ') : '.'), bfail.length ? 'error' : 'success');
        await refresh();
      } else if (act === 'send-all-ex') {
        var list = exhibitors.filter(function (x) { return !x.sent_count && emailOk(x.email) && hasStuff(x); });
        if (!list.length) return;
        if (!w.confirm('Send the results email to ' + list.length + ' exhibitors, one email each to their booth contact? Exhibitors already sent, with nothing recorded, or without a contact email are left out.')) return;
        busy = true; b.disabled = true;
        var ok = 0, failed = [];
        for (var i = 0; i < list.length; i++) {
          var prog = document.getElementById('afd-ex-progress');
          if (prog) prog.textContent = 'Sending ' + (i + 1) + ' of ' + list.length + '...';
          try { await sendOne(list[i].id, false); ok++; }
          catch (err) { if (!(err && err.data && err.data.already)) failed.push(list[i].company + ': ' + (err.message || 'failed')); }
        }
        toast(ok + ' sent' + (failed.length ? ', ' + failed.length + ' did not send: ' + failed.slice(0, 3).join('; ') : '.'), failed.length ? 'error' : 'success');
        await refresh();
      }
    } catch (err) {
      toast((err && err.message) || 'That did not work. Please try again.', 'error');
    } finally {
      busy = false;
      if (b.isConnected) b.disabled = false;
    }
  }

  async function refresh() {
    var out = await Promise.all([
      opts.api.get('/api/admin/feedback/summary').catch(function (e) { return { error: e.message }; }),
      opts.api.get('/api/admin/exhibitor-results').catch(function (e) { return { error: e.message, results: [] }; }),
      opts.api.get('/api/admin/speaker-photos').catch(function (e) { return { error: e.message, rows: [] }; }),
      opts.api.get('/api/admin/attendee-photos').catch(function (e) { return { error: e.message, rows: [], groups: [] }; }),
      opts.api.get('/api/admin/find-photos').catch(function (e) { return { error: e.message }; }),
      opts.api.get('/api/admin/booth-photos').catch(function (e) { return { error: e.message, rows: [] }; })
    ]);
    booths = out[5] || { rows: [] };
    survey = out[0] || {};
    exhibitors = (out[1] && out[1].results) || [];
    photos = out[2] || { rows: [] };
    attendees = out[3] || { rows: [], groups: [] };
    findInfo = out[4] || null;
    draw();
    if (out[0] && out[0].error) toast('The survey numbers did not load: ' + out[0].error, 'error');
    if (out[1] && out[1].error) toast('The exhibitor numbers did not load: ' + out[1].error, 'error');
  }

  async function mount(el, o) {
    opts = o;
    if (host !== el) {
      host = el;
      host.addEventListener('click', onClick);
    }
    if (!host.querySelector('.afd')) host.innerHTML = '<div class="afd"><p class="afd-note">Loading...</p></div>';
    await refresh();
  }

  w.AfterDesk = { mount: mount, _t: { esc: esc, scoreWords: scoreWords, hasStuff: hasStuff } };
})(window);
