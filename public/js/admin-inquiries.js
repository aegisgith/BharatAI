/* Admin, Inquiries: the enquiry desk (12 Nov 2026).
 *
 * Four tabs. Inbox: the work, most valuable first, with smart views, search, bulk
 * actions and one enquiry open at a time on the right. Pipeline: deals from New to
 * Won, dragged or chosen. Insights: what is happening and what to do about it.
 * Automation: owners by type, saved replies, the automatic acknowledgement and the
 * morning summary.
 *
 * The admin page loads this file the first time Inquiries opens and calls
 * InqDesk.mount(element, { api, toast, operator, initialType }). The server sends
 * each enquiry with its score, its reasons in words, what its sender already holds
 * and a suggested type (GET /api/admin/inquiries); this file draws and asks.
 * One global, InqDesk. InqDesk._t holds the parts that need no page, for the tests.
 */
(function (w) {
  'use strict';

  var TYPES = {
    sponsorship:        { label: 'Sponsorship', icon: 'fa-handshake', group: 'revenue' },
    booth_inquiry:      { label: 'Booth', icon: 'fa-store-alt', group: 'revenue' },
    exhibition:         { label: 'Exhibition', icon: 'fa-store', group: 'revenue' },
    group_registration: { label: 'Group registration', icon: 'fa-users', group: 'revenue' },
    government:         { label: 'Government', icon: 'fa-building-columns', group: 'revenue' },
    pass_upgrade:       { label: 'Pass upgrade', icon: 'fa-arrow-up-right-from-square', group: 'revenue' },
    workshop_partner:   { label: 'Workshop partner', icon: 'fa-graduation-cap', group: 'programme' },
    speaking:           { label: 'Speaking', icon: 'fa-microphone-alt', group: 'programme' },
    media:              { label: 'Media', icon: 'fa-newspaper', group: 'programme' },
    meeting_room:       { label: 'Boardroom', icon: 'fa-door-open', group: 'other' },
    general:            { label: 'General', icon: 'fa-question-circle', group: 'other' },
    other:              { label: 'Other', icon: 'fa-ellipsis-h', group: 'other' },
    delhi_pass:         { label: 'Delhi free pass', icon: 'fa-ticket', group: 'other' }
  };
  var TYPE_ORDER = ['sponsorship', 'booth_inquiry', 'exhibition', 'group_registration', 'government', 'pass_upgrade',
    'workshop_partner', 'speaking', 'media', 'meeting_room', 'general', 'other'];
  var STATUS = {
    'new': 'New', responded: 'Replied', in_progress: 'In talks', won: 'Won', lost: 'Lost', closed: 'Closed', waitlisted: 'Waitlisted'
  };
  var STATUS_ORDER = ['new', 'responded', 'in_progress', 'won', 'lost', 'closed'];
  var OPEN = { 'new': 1, responded: 1, in_progress: 1 };
  var GROUPS = [
    { key: 'revenue', label: 'Sales: booths, sponsors, groups', cls: 'iq-seg-1', color: 'var(--iq-series-1)' },
    { key: 'programme', label: 'Programme: speakers, media, workshops', cls: 'iq-seg-2', color: 'var(--iq-series-2)' },
    { key: 'other', label: 'Questions and other', cls: 'iq-seg-3', color: 'var(--iq-series-3)' }
  ];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var PAGE = 100;
  var IST_MS = 330 * 60000;

  var S = {
    el: null, deps: null, mounted: false,
    rows: [], byId: {}, owners: [], settings: null, pipelineReady: false, pipelineHint: '', typeCounts: [],
    today: '', clockSkew: 0, loadedAt: 0, error: '',
    tab: 'inbox', view: 'needs_reply', q: '', type: '', status: '', owner: '', sort: 'priority',
    shown: PAGE, sel: {}, focusId: null, openId: null, drawerMode: '', activity: {},
    delhi: null, boardAll: false, insTable: false, tplEdit: null, bulkSending: false
  };

  // ---------------------------------------------------------------- pure parts
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function parseTs(v) {
    if (!v) return NaN;
    var raw = String(v).replace(' ', 'T');
    if (!/Z$|[+-]\d\d:?\d\d$/.test(raw)) raw += 'Z';
    return new Date(raw).getTime();
  }
  function hoursSince(v, now) { var t = parseTs(v); return isNaN(t) ? 0 : Math.max(0, (now - t) / 3600000); }
  function fmtAge(h) {
    if (h < 1) return 'just now';
    if (h < 24) return Math.round(h) + ' h';
    var d = Math.floor(h / 24);
    return d === 1 ? '1 day' : d + ' days';
  }
  function fmtHours(h) {
    if (h == null || isNaN(h)) return '—';
    if (h < 1) return Math.max(1, Math.round(h * 60)) + ' min';
    if (h < 48) return (Math.round(h * 10) / 10) + ' h';
    return (Math.round(h / 2.4) / 10) + ' days';
  }
  function indian(n) {
    var s = String(Math.round(Math.abs(Number(n) || 0)));
    if (s.length <= 3) return s;
    return s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + s.slice(-3);
  }
  function inr(n) {
    n = Number(n) || 0;
    if (!n) return '—';
    var r1 = function (x) { return String(Math.round(x * 10) / 10); };
    if (n >= 1e7) return '₹' + r1(n / 1e7) + ' Cr';
    if (n >= 1e5) return '₹' + r1(n / 1e5) + ' L';
    return '₹' + indian(n);
  }
  function istDay(ms) { return new Date(ms + IST_MS).toISOString().slice(0, 10); }
  function shortDate(v) {
    var t = parseTs(v);
    if (isNaN(t)) return '';
    var d = new Date(t + IST_MS);
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()];
  }
  function shortDateTime(v) {
    var t = parseTs(v);
    if (isNaN(t)) return '';
    var d = new Date(t + IST_MS), h = d.getUTCHours();
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ', ' + (h % 12 || 12) + ':' + String(d.getUTCMinutes()).padStart(2, '0') + (h < 12 ? ' am' : ' pm');
  }
  function dayLabel(ymd) {
    var p = String(ymd || '').split('-');
    return p.length === 3 ? Number(p[2]) + ' ' + MONTHS[Number(p[1]) - 1] : '';
  }
  function median(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function isOpen(r) { return !!OPEN[r.status || 'new']; }
  function ownerOf(r) { return String(r.assigned_to || '').trim(); }
  function groupOf(type) { return (TYPES[type] || TYPES.other).group; }
  function firstReplyHours(r) {
    if (!r.responded_at) return null;
    var a = parseTs(r.created_at), b = parseTs(r.responded_at);
    if (isNaN(a) || isNaN(b) || b < a) return null;
    return (b - a) / 3600000;
  }
  function isLate(r, now, sla) { return (r.status || 'new') === 'new' && hoursSince(r.created_at, now) >= sla; }
  function isDue(r, today) { return isOpen(r) && !!r.next_action_at && String(r.next_action_at) <= today; }

  // The same fields the server fills in (inqMerge), for the preview under a reply.
  function merge(text, r, owner) {
    var name = String((r && r.name) || '').trim();
    return String(text || '')
      .replace(/\{first_name\}/g, name.split(/\s+/)[0] || 'there')
      .replace(/\{name\}/g, name || 'there')
      .replace(/\{organi[sz]ation\}/g, String((r && r.organization) || '').trim() || 'your organisation')
      .replace(/\{owner\}/g, owner || 'Team Bharat AI Innovation')
      .replace(/\{ref\}/g, 'BHAI-INQ-' + String((r && r.id) != null ? r.id : '').padStart(5, '0'));
  }

  // A spreadsheet must not run what someone typed into a form: a cell starting with
  // = + - @ or a tab is a formula to Excel, so it is read as text instead.
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function toCsv(rows) {
    var head = ['Ref', 'Received (India)', 'Type', 'Status', 'Priority', 'Score', 'Why', 'Name', 'Organisation', 'Email', 'Phone',
      'Subject', 'Message', 'Owner', 'Value (Rs)', 'Follow-up', 'Next step', 'Lost reason', 'Pass', 'Booth', 'Other enquiries', 'Notes'];
    var lines = [head.map(csvCell).join(',')];
    rows.forEach(function (r) {
      lines.push([
        'BHAI-INQ-' + String(r.id).padStart(5, '0'), shortDateTime(r.created_at), (TYPES[r.inquiry_type] || TYPES.other).label,
        STATUS[r.status || 'new'] || r.status, r.band === 'done' ? '' : r.band, r.score, (r.why || []).join('; '), r.name, r.organization,
        r.email, r.phone, r.subject, r.message, r.assigned_to, r.value_inr || '', r.next_action_at || '', r.next_action || '',
        r.lost_reason || '', r.pass ? r.pass + (r.pass_payment ? ' (' + r.pass_payment + ')' : '') : '',
        r.booth_code ? r.booth_code + ' (' + r.booth_status + ')' : '', r.dup_count || 0, r.admin_notes
      ].map(csvCell).join(','));
    });
    return '﻿' + lines.join('\r\n');
  }

  function haystack(r) {
    return [r.name, r.email, r.organization, r.phone, r.subject, r.message, r.admin_notes, r.assigned_to,
      '#' + r.id, 'bhai-inq-' + String(r.id).padStart(5, '0'), (TYPES[r.inquiry_type] || TYPES.other).label].join(' ').toLowerCase();
  }
  // Every word must be there, in any order; a run of digits also matches a phone
  // number written with spaces or a +91.
  function matchesSearch(r, q) {
    var words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    var hay = r._hay || haystack(r);
    var digits = null;
    for (var i = 0; i < words.length; i++) {
      var wd = words[i];
      if (hay.indexOf(wd) >= 0) continue;
      if (/^\+?\d[\d\s-]*$/.test(wd)) {
        if (digits === null) digits = String(r.phone || '').replace(/\D/g, '');
        var want = wd.replace(/\D/g, '');
        if (want.length >= 4 && digits.indexOf(want) >= 0) continue;
      }
      return false;
    }
    return true;
  }

  var VIEWS = [
    { key: 'needs_reply', label: 'Needs a reply', test: function (r) { return (r.status || 'new') === 'new'; } },
    { key: 'late', label: 'Waiting too long', alert: true, test: function (r, c) { return isLate(r, c.now, c.sla); } },
    { key: 'hot', label: 'Hot', alert: true, test: function (r) { return r.band === 'hot'; } },
    { key: 'due', label: 'Follow-ups due', alert: true, needsPipeline: true, test: function (r, c) { return isDue(r, c.today); } },
    { key: 'unowned', label: 'No owner', test: function (r) { return isOpen(r) && !ownerOf(r); } },
    { key: 'mine', label: 'Mine', needsMe: true, test: function (r, c) { return isOpen(r) && !!c.me && ownerOf(r).toLowerCase() === c.me.toLowerCase(); } },
    { key: 'suggested', label: 'Wrong type?', test: function (r) { return !!r.suggested_type && isOpen(r); } },
    { key: 'dups', label: 'Wrote more than once', test: function (r) { return r.dup_count > 0 && isOpen(r); } },
    { key: 'open', label: 'All open', test: isOpen },
    { key: 'all', label: 'Everything', test: function () { return true; } }
  ];
  function viewByKey(k) { for (var i = 0; i < VIEWS.length; i++) if (VIEWS[i].key === k) return VIEWS[i]; return VIEWS[0]; }

  var SORTS = {
    priority: function (a, b) {
      return (b.score - a.score) || ((isOpen(b) ? 1 : 0) - (isOpen(a) ? 1 : 0)) ||
        (isOpen(a) ? parseTs(a.created_at) - parseTs(b.created_at) : parseTs(b.created_at) - parseTs(a.created_at)) || (b.id - a.id);
    },
    newest: function (a, b) { return (parseTs(b.created_at) - parseTs(a.created_at)) || (b.id - a.id); },
    oldest: function (a, b) { return (parseTs(a.created_at) - parseTs(b.created_at)) || (a.id - b.id); },
    value: function (a, b) { return ((b.value_inr || 0) - (a.value_inr || 0)) || (b.score - a.score); }
  };

  function filterRows(rows, f, c) {
    var view = viewByKey(f.view);
    var searching = !!String(f.q || '').trim();
    var out = rows.filter(function (r) {
      if (!searching && f.view !== 'delhi' && !view.test(r, c)) return false;
      if (f.type && r.inquiry_type !== f.type) return false;
      if (f.status && (r.status || 'new') !== f.status) return false;
      if (f.owner === '__none' && ownerOf(r)) return false;
      if (f.owner && f.owner !== '__none' && ownerOf(r).toLowerCase() !== f.owner.toLowerCase()) return false;
      return matchesSearch(r, f.q);
    });
    return out.sort(SORTS[f.sort] || SORTS.priority);
  }

  // Everything Insights shows, from the rows alone.
  function computeInsights(rows, now, today, sla) {
    var d30 = rows.filter(function (r) { return hoursSince(r.created_at, now) <= 720; });
    var replyHours = [];
    var inSla = 0;
    d30.forEach(function (r) {
      var h = firstReplyHours(r);
      if (h != null) { replyHours.push(h); if (h <= sla) inSla++; }
    });
    var won = rows.filter(function (r) { return r.status === 'won'; });
    var lost = rows.filter(function (r) { return r.status === 'lost'; });
    var sum = function (list) { return list.reduce(function (s, r) { return s + (Number(r.value_inr) || 0); }, 0); };
    var openRevenue = rows.filter(function (r) { return isOpen(r) && groupOf(r.inquiry_type) === 'revenue'; });

    // Ten weeks, Monday to Sunday in India.
    var todayDay = Math.floor((now + IST_MS) / 86400000);
    var thisWeek = todayDay - ((todayDay + 3) % 7);
    var weeks = [];
    for (var i = 9; i >= 0; i--) weeks.push({ start: thisWeek - i * 7, revenue: 0, programme: 0, other: 0, total: 0 });
    rows.forEach(function (r) {
      var t = parseTs(r.created_at);
      if (isNaN(t)) return;
      var day = Math.floor((t + IST_MS) / 86400000);
      var wk = day - ((day + 3) % 7);
      var idx = (wk - weeks[0].start) / 7;
      if (idx >= 0 && idx < weeks.length) { weeks[idx][groupOf(r.inquiry_type)]++; weeks[idx].total++; }
    });
    weeks.forEach(function (wk) {
      var d = new Date(wk.start * 86400000);
      wk.label = d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()];
    });

    var funnel = {};
    GROUPS.forEach(function (g) {
      var list = rows.filter(function (r) { return groupOf(r.inquiry_type) === g.key && r.status !== 'waitlisted'; });
      funnel[g.key] = {
        received: list.length,
        replied: list.filter(function (r) { return (r.status || 'new') !== 'new'; }).length,
        talking: list.filter(function (r) { return r.status === 'in_progress' || r.status === 'won' || r.status === 'lost'; }).length,
        won: list.filter(function (r) { return r.status === 'won'; }).length
      };
    });

    var byType = {};
    rows.forEach(function (r) {
      var t = r.inquiry_type || 'other';
      var b = byType[t] || (byType[t] = { type: t, total: 0, waiting: 0, hours: [], won: 0 });
      b.total++;
      if ((r.status || 'new') === 'new') b.waiting++;
      if (r.status === 'won') b.won++;
      var h = firstReplyHours(r);
      if (h != null) b.hours.push(h);
    });
    var types = Object.keys(byType).map(function (k) {
      var b = byType[k];
      return { type: k, total: b.total, waiting: b.waiting, won: b.won, median: median(b.hours), replied: b.hours.length };
    }).sort(function (a, b) { return b.total - a.total; });

    var aging = [
      { label: 'Under a day', min: 0, max: 24, n: 0 },
      { label: '1 to 3 days', min: 24, max: 72, n: 0 },
      { label: '3 to 7 days', min: 72, max: 168, n: 0 },
      { label: 'Over a week', min: 168, max: Infinity, n: 0 }
    ];
    rows.forEach(function (r) {
      if ((r.status || 'new') !== 'new') return;
      var h = hoursSince(r.created_at, now);
      for (var j = 0; j < aging.length; j++) if (h >= aging[j].min && h < aging[j].max) { aging[j].n++; break; }
    });

    var sources = {};
    rows.forEach(function (r) {
      var m = {};
      try { m = typeof r.metadata === 'object' && r.metadata ? r.metadata : JSON.parse(r.metadata || '{}') || {}; } catch (e) { m = {}; }
      var s = m.utm_source || m.source || m.source_page || m.page || '';
      if (!s && m.booth_type && m.estimated_total !== undefined) s = 'Booth form (/inquiry)';
      s = String(s || 'Contact form').slice(0, 40);
      sources[s] = (sources[s] || 0) + 1;
    });
    var sourceList = Object.keys(sources).map(function (k) { return { label: k, n: sources[k] }; }).sort(function (a, b) { return b.n - a.n; });

    var owners = {};
    rows.forEach(function (r) {
      var o = ownerOf(r) || 'Nobody';
      var b = owners[o] || (owners[o] = { owner: o, open: 0, late: 0, replied7: 0, hours: [], won: 0, wonValue: 0 });
      if (isOpen(r)) b.open++;
      if (isLate(r, now, sla)) b.late++;
      if (r.responded_at && hoursSince(r.responded_at, now) <= 168) b.replied7++;
      var h = firstReplyHours(r);
      if (h != null) b.hours.push(h);
      if (r.status === 'won') { b.won++; b.wonValue += Number(r.value_inr) || 0; }
    });
    var ownerList = Object.keys(owners).map(function (k) {
      var b = owners[k];
      return { owner: b.owner, open: b.open, late: b.late, replied7: b.replied7, median: median(b.hours), won: b.won, wonValue: b.wonValue };
    }).sort(function (a, b) { return (a.owner === 'Nobody') - (b.owner === 'Nobody') || b.open - a.open; });

    var senders = {}, customers = {};
    rows.forEach(function (r) {
      var e = String(r.email || '').toLowerCase();
      if (!e) return;
      senders[e] = 1;
      if (r.known_paid || r.booth_code) customers[e] = 1;
    });
    var lostReasons = {};
    lost.forEach(function (r) { var k = r.lost_reason || 'No reason given'; lostReasons[k] = (lostReasons[k] || 0) + 1; });

    return {
      received30: d30.length,
      replied30: replyHours.length,
      medianReply: median(replyHours),
      inSlaPct: replyHours.length ? Math.round(inSla / replyHours.length * 100) : null,
      waiting: rows.filter(function (r) { return (r.status || 'new') === 'new'; }).length,
      late: rows.filter(function (r) { return isLate(r, now, sla); }).length,
      won: won.length, wonValue: sum(won), lost: lost.length,
      winRate: won.length + lost.length ? Math.round(won.length / (won.length + lost.length) * 100) : null,
      pipelineValue: sum(openRevenue), pipelineValued: openRevenue.filter(function (r) { return r.value_inr > 0; }).length,
      openRevenue: openRevenue.length,
      weeks: weeks, funnel: funnel, types: types, aging: aging, sources: sourceList, owners: ownerList,
      senders: Object.keys(senders).length, customers: Object.keys(customers).length,
      lostReasons: Object.keys(lostReasons).map(function (k) { return { label: k, n: lostReasons[k] }; }).sort(function (a, b) { return b.n - a.n; })
    };
  }

  // What to do now, in order of money and urgency. Each line carries one action.
  function advise(rows, c) {
    var out = [];
    var hotNew = rows.filter(function (r) { return r.band === 'hot' && (r.status || 'new') === 'new'; });
    if (hotNew.length) {
      var v = hotNew.reduce(function (s, r) { return s + (Number(r.value_inr) || 0); }, 0);
      out.push({ key: 'hot', n: hotNew.length, action: 'view:hot', label: 'Show them',
        html: '<strong>' + hotNew.length + ' hot ' + (hotNew.length === 1 ? 'lead has' : 'leads have') + ' no reply yet</strong>' + (v ? ', worth about ' + esc(inr(v)) : '') + '. Reply to these first.' });
    }
    var due = rows.filter(function (r) { return isDue(r, c.today); });
    if (due.length) out.push({ key: 'due', n: due.length, action: 'view:due', label: 'Show them',
      html: '<strong>' + due.length + ' follow-up' + (due.length === 1 ? ' is' : 's are') + ' due</strong> today or earlier.' });
    var sugg = rows.filter(function (r) { return r.suggested_type && isOpen(r); });
    if (sugg.length) out.push({ key: 'suggested', n: sugg.length, action: 'move-all', label: 'Move all ' + sugg.length,
      html: '<strong>' + sugg.length + ' General ' + (sugg.length === 1 ? 'enquiry looks' : 'enquiries look') + ' like another type</strong> (speaking, booth, sponsorship). Move them so they reach the right person.' });
    var unowned = rows.filter(function (r) { return isOpen(r) && !ownerOf(r); });
    var rules = (c.settings && c.settings.routing) || {};
    var routable = unowned.filter(function (r) { return rules[r.inquiry_type]; });
    if (routable.length) out.push({ key: 'route', n: routable.length, action: 'apply-routing', label: 'Give them owners',
      html: '<strong>' + routable.length + ' open ' + (routable.length === 1 ? 'enquiry has' : 'enquiries have') + ' no owner</strong> but a rule says who should have ' + (routable.length === 1 ? 'it' : 'them') + '.' });
    else if (unowned.length >= 10 && !Object.keys(rules).length) out.push({ key: 'owners', n: unowned.length, action: 'tab:automation', label: 'Set owners',
      html: '<strong>' + unowned.length + ' open enquiries have no owner.</strong> Name one person for each type and new ones are given to them as they arrive.' });
    var speakNew = rows.filter(function (r) { return r.inquiry_type === 'speaking' && (r.status || 'new') === 'new'; });
    if (speakNew.length >= 10) out.push({ key: 'speaking', n: speakNew.length, action: 'select-speaking', label: 'Select them',
      html: '<strong>' + speakNew.length + ' speaking requests are unanswered.</strong> One saved reply can answer all of them at once, each with their own name.' });
    var dupGroups = {};
    rows.forEach(function (r) { if (r.dup_count > 0 && isOpen(r)) dupGroups[String(r.email).toLowerCase()] = 1; });
    var nd = Object.keys(dupGroups).length;
    if (nd) out.push({ key: 'dups', n: nd, action: 'view:dups', label: 'Show them',
      html: '<strong>' + nd + (nd === 1 ? ' person wrote' : ' people wrote') + ' more than once.</strong> Answer one and close the rest, so nobody gets two replies.' });
    return out.slice(0, 5);
  }

  // Notes are kept as lines "[replied <when> by <who>] text" or "[note ...] text";
  // anything else is an older free note. A line that does not start a new entry
  // belongs to the one above it.
  function parseNotes(text) {
    var out = [];
    String(text || '').split('\n').forEach(function (line) {
      var m = /^\[(replied|note) ([^\]]*)\]\s?([\s\S]*)$/.exec(line);
      if (m) out.push({ kind: m[1], meta: m[2], text: m[3] });
      else if (out.length && line.trim() !== '' && !/^\[/.test(line)) out[out.length - 1].text += '\n' + line;
      else if (line.trim()) out.push({ kind: 'old', meta: '', text: line });
    });
    return out;
  }

  // ---------------------------------------------------------------- state helpers
  function now() { return Date.now() + S.clockSkew; }
  function ctx() {
    return { now: now(), today: S.today || istDay(now()), sla: (S.settings && S.settings.sla_hours) || 24, me: me(), settings: S.settings };
  }
  function me() {
    try { return String((S.deps && S.deps.operator && S.deps.operator()) || '').trim(); } catch (e) { return ''; }
  }
  // The admin page's toast() writes its message as HTML, and these messages carry
  // names and emails typed into a public form: escaped here, every one.
  function toast(msg, kind) {
    try { if (S.deps && S.deps.toast) { S.deps.toast(esc(msg), kind === 'error' ? 'error' : 'success'); return; } } catch (e) { /* fall through */ }
    if (kind === 'error') w.alert(msg);
  }
  function api() { return S.deps.api; }
  function $(sel) { return S.el ? S.el.querySelector(sel) : null; }
  function part(name) { return $('[data-part="' + name + '"]'); }
  function visible() { return !!(S.el && S.el.offsetParent !== null); }
  function selectedIds() { return Object.keys(S.sel).filter(function (k) { return S.sel[k]; }).map(Number); }
  function typeOptions(current, withAny) {
    return (withAny ? '<option value="">All types</option>' : '') + TYPE_ORDER.map(function (t) {
      return '<option value="' + t + '"' + (current === t ? ' selected' : '') + '>' + esc(TYPES[t].label) + '</option>';
    }).join('');
  }
  function statusOptions(current, includeWaitlist) {
    var list = STATUS_ORDER.slice();
    if (includeWaitlist || current === 'waitlisted') list.push('waitlisted');
    return list.map(function (s) { return '<option value="' + s + '"' + (current === s ? ' selected' : '') + '>' + STATUS[s] + '</option>'; }).join('');
  }
  function ownerOptions(current, opts) {
    opts = opts || {};
    var names = S.owners.slice();
    var m = me();
    if (m && names.indexOf(m) < 0) names.unshift(m);
    if (current && names.indexOf(current) < 0) names.unshift(current);
    return '<option value="">' + (opts.anyLabel || 'Nobody') + '</option>' +
      (opts.filter ? '<option value="__none"' + (current === '__none' ? ' selected' : '') + '>Nobody yet</option>' : '') +
      names.map(function (n) { return '<option value="' + esc(n) + '"' + (current === n ? ' selected' : '') + '>' + esc(n) + (n === m ? ' (me)' : '') + '</option>'; }).join('') +
      (opts.filter ? '' : '<option value="__other">Someone else…</option>');
  }
  function templatesFor(type) {
    var all = (S.settings && S.settings.templates) || [];
    var mine = all.filter(function (t) { return t.type === type; });
    var rest = all.filter(function (t) { return t.type !== type; });
    return { mine: mine, rest: rest };
  }
  function templateOptions(type) {
    var t = templatesFor(type);
    var opt = function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.name) + '</option>'; };
    return '<option value="">Start from a saved reply…</option>' +
      (t.mine.length ? '<optgroup label="For ' + esc((TYPES[type] || TYPES.other).label) + '">' + t.mine.map(opt).join('') + '</optgroup>' : '') +
      (t.rest.length ? '<optgroup label="Others">' + t.rest.map(opt).join('') + '</optgroup>' : '');
  }
  function templateById(id) {
    var all = (S.settings && S.settings.templates) || [];
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  // ---------------------------------------------------------------- loading
  async function load(quiet) {
    if (!quiet && !S.rows.length) {
      S.el.innerHTML = '<div class="iqd"><div class="iq-empty"><strong>Loading enquiries…</strong></div></div>';
    }
    try {
      var data = await api().get('/api/admin/inquiries');
      if (!data || !Array.isArray(data.inquiries)) throw new Error((data && data.error) || 'Inquiries came back in an unexpected shape.');
      take(data);
      S.error = '';
      if (S.view === 'delhi') await loadDelhi();
    } catch (e) {
      S.error = (e && e.message) || 'Could not load the enquiries.';
      if (!S.rows.length) {
        S.el.innerHTML = '<div class="iqd"><div class="iq-empty"><strong>The enquiries could not load.</strong>' + esc(S.error) +
          '<div style="margin-top:12px"><button class="iq-btn" data-act="reload">Try again</button></div></div></div>';
        wire();
        return;
      }
      toast('Could not refresh the enquiries: ' + S.error, 'error');
    }
    render();
  }
  function take(data) {
    var t = parseTs(data.now);
    S.clockSkew = isNaN(t) ? 0 : t - Date.now();
    S.today = data.today || istDay(now());
    S.rows = data.inquiries;
    S.byId = {};
    S.rows.forEach(function (r) { r._hay = haystack(r); r.why = r.why || []; S.byId[r.id] = r; });
    S.owners = data.owners || [];
    S.settings = data.settings || S.settings || { templates: [], routing: {}, sla_hours: 24 };
    S.pipelineReady = !!data.pipeline_ready;
    S.pipelineHint = data.pipeline_hint || '';
    S.typeCounts = data.typeCounts || [];
    S.loadedAt = Date.now();
    Object.keys(S.sel).forEach(function (k) { if (!S.byId[k]) delete S.sel[k]; });
  }
  async function loadDelhi() {
    var data = await api().get('/api/admin/inquiries?type=delhi_pass');
    S.delhi = (data && data.inquiries) || [];
    S.delhi.forEach(function (r) { r._hay = haystack(r); r.why = r.why || []; S.byId[r.id] = r; });
  }
  function delhiCount() {
    for (var i = 0; i < S.typeCounts.length; i++) if (S.typeCounts[i].inquiry_type === 'delhi_pass') return Number(S.typeCounts[i].count) || 0;
    return 0;
  }

  // ---------------------------------------------------------------- render: shell
  function render() {
    if (!S.el) return;
    var c = ctx();
    var newCount = S.rows.filter(function (r) { return (r.status || 'new') === 'new'; }).length;
    var deals = S.rows.filter(function (r) { return isOpen(r) && groupOf(r.inquiry_type) === 'revenue'; }).length;
    var tab = function (key, icon, word, count) {
      return '<button class="iq-tab" role="tab" data-act="tab" data-tab="' + key + '" aria-selected="' + (S.tab === key) + '">' +
        '<i class="fas ' + icon + '" aria-hidden="true"></i><span class="iq-tab-word">' + word + '</span>' +
        (count != null ? '<span class="iq-count">' + count + '</span>' : '') + '</button>';
    };
    var html = '<div class="iqd">' +
      '<div class="iq-top"><div class="iq-tabs" role="tablist" aria-label="Inquiries">' +
        tab('inbox', 'fa-inbox', 'Inbox', newCount) + tab('pipeline', 'fa-columns', 'Pipeline', deals) +
        tab('insights', 'fa-chart-line', 'Insights', null) + tab('automation', 'fa-robot', 'Automation', null) +
      '</div><div class="iq-top-right"><span class="iq-updated" data-part="updated">Updated ' + esc(shortDateTime(new Date(S.loadedAt).toISOString())) + '</span></div></div>' +
      '<div data-part="body"></div>' +
      '<div class="iq-bulk" data-part="bulk" hidden></div>' +
      '<div data-part="drawer"></div>' +
      '<div class="iq-tip" data-part="tip" hidden></div>' +
    '</div>';
    // The open panel is moved across, not redrawn: a reply half typed in it survives
    // a refresh of the list behind it.
    var keepDrawer = S.openId != null || S.drawerMode ? part('drawer') : null;
    S.el.innerHTML = html;
    if (keepDrawer) { var ph = part('drawer'); if (ph) ph.parentNode.replaceChild(keepDrawer, ph); }
    renderBody(c);
    renderBulk();
    wire();
  }
  function renderBody(c) {
    var body = part('body');
    if (!body) return;
    c = c || ctx();
    if (S.tab === 'pipeline') body.innerHTML = pipelineHtml(c);
    else if (S.tab === 'insights') body.innerHTML = insightsHtml(c);
    else if (S.tab === 'automation') body.innerHTML = automationHtml(c);
    else body.innerHTML = inboxHtml(c);
  }

  // ---------------------------------------------------------------- inbox
  function kpi(key, label, value, sub, cls, icon) {
    return '<button class="iq-kpi ' + (cls || '') + '" data-act="kpi" data-kpi="' + key + '" aria-pressed="' + (S.view === key && S.tab === 'inbox') + '">' +
      '<span class="iq-kpi-label">' + (icon ? '<i class="fas ' + icon + '" aria-hidden="true"></i>' : '') + esc(label) + '</span>' +
      '<span><span class="iq-kpi-value">' + value + '</span>' + (sub ? '<span class="iq-kpi-sub" style="display:block">' + sub + '</span>' : '') + '</span></button>';
  }
  function inboxHtml(c) {
    var rows = S.rows;
    var ins = computeInsights(rows, c.now, c.today, c.sla);
    var needs = rows.filter(function (r) { return (r.status || 'new') === 'new'; }).length;
    var hot = rows.filter(function (r) { return r.band === 'hot'; }).length;
    var due = rows.filter(function (r) { return isDue(r, c.today); }).length;
    var unowned = rows.filter(function (r) { return isOpen(r) && !ownerOf(r); }).length;
    var kpis = '<div class="iq-kpis">' +
      kpi('needs_reply', 'Needs a reply', needs, ins.late ? ins.late + ' waiting over ' + c.sla + ' h' : 'none waiting too long', '', 'fa-inbox') +
      kpi('late', 'Waiting too long', ins.late, 'no reply after ' + c.sla + ' h', ins.late ? 'iq-kpi-bad' : 'iq-kpi-good', 'fa-clock') +
      kpi('hot', 'Hot and open', hot, 'most likely to pay', '', 'fa-fire') +
      (S.pipelineReady ? kpi('due', 'Follow-ups due', due, 'today or earlier', due ? 'iq-kpi-bad' : '', 'fa-calendar-day')
        : kpi('unowned', 'No owner', unowned, 'open, nobody on it', '', 'fa-user-plus')) +
      kpi('pipeline', 'Open sales', ins.openRevenue, ins.pipelineValue ? inr(ins.pipelineValue) + ' where the value is known' : 'booths, sponsors, groups', '', 'fa-indian-rupee-sign') +
      kpi('insights', 'Typical first reply', fmtHours(ins.medianReply), ins.inSlaPct != null ? ins.inSlaPct + '% within ' + c.sla + ' h (30 days)' : 'no replies yet', '', 'fa-chart-line') +
    '</div>';

    var advice = advise(rows, c);
    var adviceHtml = '<section class="iq-advice" aria-label="What to do now"><h3><i class="fas fa-lightbulb" aria-hidden="true"></i>What to do now</h3>' +
      (advice.length ? '<ol>' + advice.map(function (a) {
        return '<li><span>' + a.html + '</span><button class="iq-btn iq-btn-sm" data-act="advice" data-do="' + esc(a.action) + '">' + esc(a.label) + '</button></li>';
      }).join('') + '</ol>' : '<p class="iq-advice-empty">Nothing is urgent. Every enquiry has an answer or an owner.</p>') + '</section>';

    var chips = VIEWS.filter(function (v) { return (!v.needsPipeline || S.pipelineReady) && (!v.needsMe || c.me); }).map(function (v) {
      var n = rows.filter(function (r) { return v.test(r, c); }).length;
      return '<button class="iq-chip' + (v.alert && n ? ' iq-chip-alert' : '') + '" data-act="view" data-view="' + v.key + '" aria-pressed="' + (S.view === v.key) + '">' +
        esc(v.label) + ' <span class="iq-n">' + n + '</span></button>';
    }).join('');
    var dn = delhiCount();
    if (dn) chips += '<button class="iq-chip" data-act="view" data-view="delhi" aria-pressed="' + (S.view === 'delhi') + '"><i class="fas fa-ticket" aria-hidden="true"></i>Delhi waitlist <span class="iq-n">' + dn + '</span></button>';

    var filters = '<div class="iq-filters">' +
      '<label class="iq-search"><span class="iq-sr">Search enquiries</span><i class="fas fa-search" aria-hidden="true"></i>' +
        '<input type="search" data-f="q" value="' + esc(S.q) + '" placeholder="Search name, company, email, phone, words or #573" autocomplete="off"></label>' +
      '<select class="iq-select" data-f="type" aria-label="Type">' + typeOptions(S.type, true) + '</select>' +
      '<select class="iq-select" data-f="status" aria-label="Status"><option value="">Any status</option>' + statusOptions(S.status, true) + '</select>' +
      '<select class="iq-select" data-f="owner" aria-label="Owner">' + ownerOptions(S.owner, { filter: true, anyLabel: 'Any owner' }) + '</select>' +
      '<select class="iq-select" data-f="sort" aria-label="Order">' +
        '<option value="priority"' + (S.sort === 'priority' ? ' selected' : '') + '>Most important first</option>' +
        '<option value="oldest"' + (S.sort === 'oldest' ? ' selected' : '') + '>Waiting longest first</option>' +
        '<option value="newest"' + (S.sort === 'newest' ? ' selected' : '') + '>Newest first</option>' +
        '<option value="value"' + (S.sort === 'value' ? ' selected' : '') + '>Highest value first</option></select>' +
      '<button class="iq-btn" data-act="export" title="Download this list as a spreadsheet"><i class="fas fa-download" aria-hidden="true"></i>Export</button>' +
    '</div>';
    return kpis + adviceHtml + '<div class="iq-views" role="group" aria-label="Views">' + chips + '</div>' + filters +
      '<div data-part="list">' + listHtml(c) + '</div>';
  }

  function currentList(c) {
    var base = S.view === 'delhi' ? (S.delhi || []) : S.rows;
    return filterRows(base, { view: S.view, q: S.q, type: S.type, status: S.status, owner: S.owner, sort: S.sort }, c || ctx());
  }
  function listHtml(c) {
    c = c || ctx();
    if (S.view === 'delhi' && !S.delhi) return '<div class="iq-list"><div class="iq-empty"><strong>Loading the Delhi waitlist…</strong></div></div>';
    var list = currentList(c);
    var shown = list.slice(0, S.shown);
    var allTicked = shown.length && shown.every(function (r) { return S.sel[r.id]; });
    var result = '<p class="iq-result" data-part="result"><span>' + (S.q.trim() ? 'Searching every enquiry: ' : '') + list.length + ' shown</span>' +
      '<span class="iq-keys">Keys: <kbd>j</kbd> <kbd>k</kbd> move, <kbd>Enter</kbd> open, <kbd>x</kbd> tick, <kbd>r</kbd> reply, <kbd>/</kbd> search</span></p>';
    if (!list.length) {
      var why = S.q.trim() ? 'Nothing matches "' + esc(S.q.trim()) + '". Try fewer words, or a phone number.' :
        S.view === 'needs_reply' ? 'Every enquiry has had a reply. Well done.' : 'Nothing in this view.';
      return result + '<div class="iq-list"><div class="iq-empty"><strong>' + (S.view === 'needs_reply' && !S.q.trim() ? 'All answered' : 'Nothing here') + '</strong>' + why + '</div></div>';
    }
    var head = '<div class="iq-head"><span><input type="checkbox" class="iq-check" data-act="tick-all" aria-label="Tick every enquiry shown"' + (allTicked ? ' checked' : '') + '></span>' +
      '<span>Priority</span><span>Enquiry</span><span>From</span><span>Waiting</span><span>Owner</span><span>Status</span><span></span></div>';
    var body = shown.map(function (r) { return rowHtml(r, c); }).join('');
    var more = list.length > shown.length ? '<div class="iq-more"><button class="iq-btn" data-act="more">Show ' + Math.min(PAGE, list.length - shown.length) + ' more of ' + (list.length - shown.length) + '</button></div>' : '';
    return result + '<div class="iq-list" aria-label="Enquiries">' + head + body + more + '</div>';
  }

  function bandHtml(r) {
    var b = r.band || 'cold';
    var label = b === 'hot' ? 'Hot' : b === 'warm' ? 'Warm' : b === 'cold' ? 'Cold' : (STATUS[r.status] || 'Done');
    return '<span class="iq-band iq-band-' + b + '" title="' + esc((r.why || []).join(', ') || 'No reply needed') + '">' + label + '</span>' +
      (b !== 'done' ? '<span class="iq-score">score ' + (r.score || 0) + '</span>' : '');
  }
  function tagsHtml(r, c) {
    var t = TYPES[r.inquiry_type] || TYPES.other;
    var tags = '<span class="iq-tag iq-tag-type"><i class="fas ' + t.icon + '" aria-hidden="true"></i>' + esc(t.label) + '</span>';
    if (r.suggested_type && isOpen(r)) {
      tags += '<button class="iq-tag iq-tag-suggest" data-act="move" data-id="' + r.id + '" data-type="' + esc(r.suggested_type) + '" title="Move it to ' + esc((TYPES[r.suggested_type] || TYPES.other).label) + '">Looks like ' + esc((TYPES[r.suggested_type] || TYPES.other).label) + ': move</button>';
    }
    if (r.pass) {
      var paid = r.known_paid;
      tags += '<span class="iq-tag ' + (paid ? 'iq-tag-paid' : '') + '" title="On the attendee list">' + (paid ? 'Paid ' : 'Registered: ') + esc(r.pass) + (!paid && r.pass_payment === 'pending' ? ' (not paid)' : '') + '</span>';
    }
    if (r.booth_code) tags += '<span class="iq-tag iq-tag-booth">Booth ' + esc(r.booth_code) + ' · ' + esc(r.booth_status === 'confirmed' ? 'booked' : 'held') + '</span>';
    if (r.value_inr) tags += '<span class="iq-tag iq-tag-money" title="' + (r.value_estimated ? 'The price the booth form quoted' : 'Set by the team') + '">' + (r.value_estimated ? 'about ' : '') + esc(inr(r.value_inr)) + '</span>';
    if (r.dup_count) tags += '<button class="iq-tag iq-tag-dup" data-act="same-sender" data-email="' + esc(r.email) + '">Wrote ' + (r.dup_count + 1) + ' times</button>';
    if (r.next_action_at && isOpen(r)) {
      var late = String(r.next_action_at) <= c.today;
      tags += '<span class="iq-tag ' + (late ? 'iq-tag-due' : '') + '">Follow up ' + (String(r.next_action_at) === c.today ? 'today' : esc(dayLabel(r.next_action_at))) + '</span>';
    }
    return '<div class="iq-tags">' + tags + '</div>';
  }
  function ageHtml(r, c) {
    var st = r.status || 'new';
    if (st === 'new') {
      var h = hoursSince(r.created_at, c.now);
      return '<span class="iq-age' + (h >= c.sla ? ' iq-age-late' : '') + '">' + fmtAge(h) + '</span><span class="iq-age-sub">since ' + esc(shortDate(r.created_at)) + '</span>';
    }
    var fr = firstReplyHours(r);
    return '<span class="iq-age">' + (fr != null ? 'replied in ' + fmtHours(fr) : esc(STATUS[st] || st)) + '</span><span class="iq-age-sub">came ' + esc(shortDate(r.created_at)) + '</span>';
  }
  function rowHtml(r, c) {
    var st = r.status || 'new';
    var cls = 'iq-row' + (S.sel[r.id] ? ' is-selected' : '') + (S.focusId === r.id ? ' is-focus' : '') + (!isOpen(r) && st !== 'waitlisted' ? ' is-done' : '');
    var snippet = r.message ? esc(String(r.message).slice(0, 400)) : '<em>No message</em>';
    return '<div class="' + cls + '" tabindex="-1" data-row="' + r.id + '">' +
      '<span class="iq-c-chk"><input type="checkbox" class="iq-check" data-act="tick" data-id="' + r.id + '" aria-label="Tick enquiry ' + r.id + '"' + (S.sel[r.id] ? ' checked' : '') + '></span>' +
      '<span class="iq-c-band">' + bandHtml(r) + '</span>' +
      '<span class="iq-c-main"><span class="iq-subject">' + esc(r.subject || r.name || 'No subject') + '</span><span class="iq-snippet">' + snippet + '</span>' + tagsHtml(r, c) + '</span>' +
      '<span class="iq-c-from iq-from"><span class="iq-from-name">' + esc(r.name) + '</span>' +
        (r.organization ? '<span class="iq-from-sub" style="display:block">' + esc(r.organization) + '</span>' : '') +
        '<span class="iq-from-sub" style="display:block">' + esc(r.email) + '</span>' +
        (r.phone ? '<span class="iq-from-sub" style="display:block">' + esc(r.phone) + '</span>' : '') + '</span>' +
      '<span class="iq-c-meta">' +
        '<span class="iq-c-age">' + ageHtml(r, c) + '</span>' +
        '<span class="iq-c-owner"><select class="iq-inline" data-act="owner" data-id="' + r.id + '" aria-label="Owner of enquiry ' + r.id + '">' + ownerOptions(ownerOf(r)) + '</select></span>' +
        '<span class="iq-c-status"><select class="iq-inline iq-status-' + st + '" data-act="status" data-id="' + r.id + '" aria-label="Status of enquiry ' + r.id + '">' + statusOptions(st) + '</select></span>' +
        '<span class="iq-c-acts iq-acts"><button class="iq-icon iq-icon-accent" data-act="reply" data-id="' + r.id + '" title="Reply by email" aria-label="Reply to ' + esc(r.name) + '"><i class="fas fa-reply" aria-hidden="true"></i></button>' +
        '<button class="iq-icon" data-act="open" data-id="' + r.id + '" title="Open" aria-label="Open enquiry ' + r.id + '"><i class="fas fa-arrow-right" aria-hidden="true"></i></button></span>' +
      '</span></div>';
  }
  function refreshList() {
    var el = part('list');
    if (el) el.innerHTML = listHtml();
    renderBulk();
  }

  // ---------------------------------------------------------------- bulk bar
  function renderBulk() {
    var bar = part('bulk');
    if (!bar) return;
    var ids = selectedIds();
    if (!ids.length || S.tab !== 'inbox') { bar.hidden = true; bar.innerHTML = ''; return; }
    var list = currentList();
    bar.hidden = false;
    bar.innerHTML = '<strong>' + ids.length + ' ticked</strong>' +
      (list.length > ids.length ? '<button class="iq-btn iq-btn-sm" data-act="tick-list">Tick all ' + list.length + ' in this list</button>' : '') +
      '<button class="iq-btn iq-btn-sm iq-btn-primary" data-act="bulk-reply"><i class="fas fa-paper-plane" aria-hidden="true"></i>Reply to all</button>' +
      '<select class="iq-select" data-act="bulk-owner" aria-label="Give the ticked ones an owner"><option value="">Give to…</option>' + ownerOptions('').replace('<option value="">Nobody</option>', '<option value="__nobody">Nobody</option>') + '</select>' +
      '<select class="iq-select" data-act="bulk-status" aria-label="Set the status of the ticked ones"><option value="">Set status…</option>' + statusOptions('').replace(' selected', '') + '</select>' +
      '<select class="iq-select" data-act="bulk-type" aria-label="Move the ticked ones to a type"><option value="">Move to type…</option>' + typeOptions('', false) + '</select>' +
      '<button class="iq-btn iq-btn-sm" data-act="bulk-export"><i class="fas fa-download" aria-hidden="true"></i>Export</button>' +
      '<button class="iq-btn iq-btn-sm" data-act="clear-ticks">Clear</button>';
  }

  // ---------------------------------------------------------------- drawer: one enquiry
  function openDrawer(id, focusReply) {
    var r = S.byId[id];
    if (!r) { toast('That enquiry is not in the list any more. Press Refresh.', 'error'); return; }
    S.openId = r.id; S.drawerMode = 'one'; S.focusId = r.id;
    part('drawer').innerHTML = drawerHtml(r);
    loadActivity(r.id);
    var target = focusReply ? $('[data-f="reply-body"]') : $('.iq-drawer [data-act="close"]');
    if (target) setTimeout(function () { try { target.focus(); } catch (e) { /* ignore */ } }, 0);
    markFocusRow();
  }
  function closeDrawer() {
    S.openId = null; S.drawerMode = ''; S.tplEdit = null;
    var d = part('drawer');
    if (d) d.innerHTML = '';
    var row = S.focusId != null ? $('[data-row="' + S.focusId + '"]') : null;
    if (row) try { row.focus(); } catch (e) { /* ignore */ }
  }
  function drawerShell(title, sub, body, nav) {
    return '<div class="iq-scrim" data-act="close"></div><aside class="iq-drawer" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
      '<div class="iq-drawer-head"><div style="flex:1;min-width:0"><h2>' + esc(title) + '</h2>' + (sub ? '<p>' + sub + '</p>' : '') + '</div>' +
      (nav || '') + '<button class="iq-icon" data-act="close" aria-label="Close"><i class="fas fa-times" aria-hidden="true"></i></button></div>' +
      '<div class="iq-drawer-body">' + body + '</div></aside>';
  }
  function metaRows(r) {
    var m = {};
    try { m = typeof r.metadata === 'object' && r.metadata ? r.metadata : JSON.parse(r.metadata || '{}') || {}; } catch (e) { m = {}; }
    var keys = Object.keys(m).filter(function (k) { return m[k] !== '' && m[k] != null && m[k] !== false; });
    if (!keys.length) return '';
    return '<dl class="iq-kv" style="margin-top:10px">' + keys.map(function (k) {
      var v = m[k];
      var shown = k === 'estimated_total' && Number(v) ? inr(Number(v)) + ' before GST' : String(v);
      var link = /^https?:\/\//i.test(shown) ? '<a href="' + esc(shown) + '" target="_blank" rel="noopener">' + esc(shown) + '</a>' : esc(shown);
      return '<dt>' + esc(k.replace(/_/g, ' ')) + '</dt><dd>' + link + '</dd>';
    }).join('') + '</dl>';
  }
  function notesInner(r) {
    var notes = parseNotes(r.admin_notes);
    return notes.length ? notes.map(function (n) {
      var label = n.kind === 'replied' ? 'Reply sent ' + n.meta : n.kind === 'note' ? 'Note ' + n.meta : 'Earlier note';
      var text = n.kind === 'replied' && n.text.length > 220 ? n.text.slice(0, 220) + '…' : n.text;
      return '<div class="iq-note"><span class="iq-note-meta">' + esc(label) + '</span>' + esc(text) + '</div>';
    }).join('') : '<p class="iq-hint" style="margin:0">No notes yet.</p>';
  }
  // The Decide card on its own, so a saved change redraws it and nothing else.
  function decideHtml(r) {
    var st = r.status || 'new';
    var p = S.pipelineReady;
    var whyTags = (r.why || []).map(function (x) { return '<span class="iq-tag">' + esc(x) + '</span>'; }).join('');
    return '<h3><i class="fas fa-sliders-h" aria-hidden="true"></i>Decide</h3>' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' + bandHtml(r) + '</div>' +
      (whyTags ? '<div class="iq-why">' + whyTags + '</div>' : '') +
      '<div class="iq-grid2" style="margin-top:10px">' +
        '<label class="iq-field"><span>Status</span><select data-dr="status">' + statusOptions(st) + '</select></label>' +
        '<label class="iq-field"><span>Owner</span><select data-dr="assigned_to">' + ownerOptions(ownerOf(r)) + '</select></label>' +
        '<label class="iq-field"><span>Type</span><select data-dr="inquiry_type"' + (r.inquiry_type === 'delhi_pass' ? ' disabled' : '') + '>' + (r.inquiry_type === 'delhi_pass' ? '<option>Delhi free pass</option>' : typeOptions(r.inquiry_type, false)) + '</select></label>' +
        (p ? '<label class="iq-field"><span>Priority</span><select data-dr="priority">' +
          '<option value=""' + (!r.priority ? ' selected' : '') + '>By score</option><option value="hot"' + (r.priority === 'hot' ? ' selected' : '') + '>Hot</option>' +
          '<option value="warm"' + (r.priority === 'warm' ? ' selected' : '') + '>Warm</option><option value="cold"' + (r.priority === 'cold' ? ' selected' : '') + '>Cold</option></select></label>' +
          '<label class="iq-field"><span>Deal value, Rs before GST</span><input data-dr="deal_value_inr" inputmode="numeric" value="' + esc(r.deal_value_inr != null ? r.deal_value_inr : '') + '" placeholder="' + (r.value_estimated ? 'form quoted ' + esc(indian(r.value_inr)) : 'e.g. 150000') + '"></label>' +
          '<label class="iq-field"><span>Follow up on</span><input type="date" data-dr="next_action_at" value="' + esc(r.next_action_at || '') + '"></label>' +
          '<label class="iq-field" style="grid-column:1/-1"><span>Next step</span><input data-dr="next_action" maxlength="200" value="' + esc(r.next_action || '') + '" placeholder="e.g. Call to confirm the booth size"></label>' +
          '<label class="iq-field" style="grid-column:1/-1' + (st === 'lost' ? '' : ';display:none') + '" data-part="lost"><span>Why it was lost</span><select data-dr="lost_reason"><option value="">Choose a reason</option>' +
            ((S.settings && S.settings.lost_reasons) || []).map(function (x) { return '<option' + (r.lost_reason === x ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select></label>'
        : '') +
      '</div>' +
      (p ? '' : '<p class="iq-locked" style="margin-top:10px">Deal value, follow-up day and priority need one step from the organiser, once: <code>' + esc(S.pipelineHint.replace(/^.*Run: /, '')) + '</code></p>') +
      '<p class="iq-msgline" data-part="dr-saved" aria-live="polite"></p>';
  }

  function drawerHtml(r) {
    var t = TYPES[r.inquiry_type] || TYPES.other;
    var st = r.status || 'new';
    var c = ctx();
    var list = currentList(c);
    var idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i].id === r.id) { idx = i; break; }
    var nav = '<button class="iq-icon" data-act="prev" aria-label="Previous enquiry" title="Previous (k)"' + (idx <= 0 ? ' disabled' : '') + '><i class="fas fa-arrow-left" aria-hidden="true"></i></button>' +
      '<button class="iq-icon" data-act="next" aria-label="Next enquiry" title="Next (j)"' + (idx < 0 || idx >= list.length - 1 ? ' disabled' : '') + '><i class="fas fa-arrow-right" aria-hidden="true"></i></button>';
    var sub = '<i class="fas ' + t.icon + '" aria-hidden="true"></i> ' + esc(t.label) + ' · BHAI-INQ-' + String(r.id).padStart(5, '0') + ' · came ' + esc(shortDateTime(r.created_at));
    var phoneDigits = String(r.phone || '').replace(/\D/g, '');
    var wa = phoneDigits.length >= 10 ? 'https://wa.me/' + (phoneDigits.length === 10 ? '91' + phoneDigits : phoneDigits) : '';

    var message = '<section class="iq-card"><h3><i class="fas fa-envelope" aria-hidden="true"></i>Their message</h3>' +
      '<div class="iq-msg">' + (r.message ? esc(r.message) : '<em>No message</em>') + '</div>' + metaRows(r) + '</section>';

    var who = '<section class="iq-card"><h3><i class="fas fa-id-badge" aria-hidden="true"></i>Who they are</h3><dl class="iq-kv">' +
      '<dt>Name</dt><dd>' + esc(r.name) + '</dd>' +
      (r.organization ? '<dt>Organisation</dt><dd>' + esc(r.organization) + '</dd>' : '') +
      '<dt>Email</dt><dd><a href="mailto:' + esc(r.email) + '">' + esc(r.email) + '</a></dd>' +
      (r.phone ? '<dt>Phone</dt><dd><a href="tel:' + esc(phoneDigits) + '">' + esc(r.phone) + '</a>' + (wa ? ' · <a href="' + esc(wa) + '" target="_blank" rel="noopener">WhatsApp</a>' : '') + '</dd>' : '') +
      '<dt>Pass</dt><dd>' + (r.pass ? esc(r.pass) + (r.known_paid ? ' · paid' : r.pass_payment === 'pending' ? ' · not paid yet' : '') : 'Not registered for the conference') + '</dd>' +
      (r.booth_code ? '<dt>Booth</dt><dd>' + esc(r.booth_code) + ' · ' + (r.booth_status === 'confirmed' ? 'booked' : 'held') + (r.booth_company ? ' for ' + esc(r.booth_company) : '') + '</dd>' : '') +
      '</dl><div data-part="dr-who"></div></section>';

    var decide = '<section class="iq-card" data-part="dr-decide">' + decideHtml(r) + '</section>';

    var tplOpts = templateOptions(r.inquiry_type);
    var reply = '<section class="iq-card"><h3><i class="fas fa-reply" aria-hidden="true"></i>Reply by email</h3>' +
      '<label class="iq-field"><span>Saved reply</span><select data-f="reply-tpl">' + tplOpts + '</select></label>' +
      '<label class="iq-field" style="margin-top:8px"><span>Subject</span><input data-f="reply-subject" value="Re: your enquiry - Bharat AI Innovation 2026"></label>' +
      '<label class="iq-field" style="margin-top:8px"><span>Message (we add "Dear ' + esc(r.name || 'Sir/Madam') + '," above and the team’s sign-off below)</span>' +
        '<textarea data-f="reply-body" rows="8" placeholder="Type the reply, or start from a saved reply"></textarea></label>' +
      '<div class="iq-composer-bar"><span class="iq-hint">Fields: {first_name} {organisation} {owner} {ref}</span>' +
        '<span style="display:flex;gap:8px"><button class="iq-btn iq-btn-sm" data-act="preview-reply">Preview</button>' +
        '<button class="iq-btn iq-btn-primary" data-act="send-reply" data-id="' + r.id + '"><i class="fas fa-paper-plane" aria-hidden="true"></i>Send</button></span></div>' +
      '<div data-part="reply-preview"></div><p class="iq-msgline" data-part="reply-msg" aria-live="polite"></p></section>';

    var notesHtml = '<section class="iq-card"><h3><i class="fas fa-sticky-note" aria-hidden="true"></i>Notes</h3><div data-part="dr-notes">' + notesInner(r) + '</div>' +
      '<label class="iq-field" style="margin-top:10px"><span class="iq-sr">New note</span><textarea data-f="note" rows="2" placeholder="Add a note for the team (who called, what was agreed)"></textarea></label>' +
      '<div class="iq-composer-bar"><span class="iq-hint">Notes are kept with your name and the time.</span><button class="iq-btn iq-btn-sm" data-act="add-note" data-id="' + r.id + '">Add note</button></div></section>';

    var history = '<section class="iq-card"><h3><i class="fas fa-clock" aria-hidden="true"></i>History</h3><div data-part="dr-history"><p class="iq-hint" style="margin:0">Loading…</p></div></section>' +
      '<div style="display:flex;justify-content:flex-end"><button class="iq-btn iq-btn-sm iq-btn-danger" data-act="delete" data-id="' + r.id + '"><i class="fas fa-trash" aria-hidden="true"></i>Delete this enquiry</button></div>';

    return drawerShell(r.subject || r.name || 'Enquiry', sub, decide + reply + message + who + notesHtml + history, nav);
  }
  function auditWords(e) {
    var d = {};
    try { d = JSON.parse(e.detail || '{}') || {}; } catch (x) { d = {}; }
    var names = { status: 'status', inquiry_type: 'type', assigned_to: 'owner', priority: 'priority', deal_value_inr: 'value', next_action_at: 'follow-up', next_action: 'next step', lost_reason: 'lost reason' };
    var changes = Object.keys(d).filter(function (k) { return names[k]; }).map(function (k) {
      var v = d[k];
      if (k === 'status') v = STATUS[v] || v;
      if (k === 'inquiry_type') v = (TYPES[v] || TYPES.other).label;
      if (k === 'deal_value_inr') v = v ? inr(v) : 'none';
      return names[k] + ' to ' + v;
    });
    switch (e.action) {
      case 'inquiry.update': return 'Changed ' + (changes.join(', ') || 'details');
      case 'inquiry.bulk': return 'Changed ' + (changes.join(', ') || 'details') + (d.bulk ? ' (with ' + (d.bulk - 1) + ' others)' : '');
      case 'inquiry.routing': return 'Given to ' + (d.assigned_to || '') + ' by the rule for this type';
      case 'inquiry.reply': return 'Reply emailed' + (d.subject ? ': ' + d.subject : '') + (d.bulk ? ' (one of ' + d.bulk + ')' : '');
      case 'inquiry.reply-failed': return 'Reply could not be sent: ' + (d.error || '');
      case 'inquiry.note': return 'Note added';
      case 'inquiry.autoack': return 'Automatic "we have your enquiry" email sent';
      case 'inquiry.autoack-failed': return 'Automatic acknowledgement could not be sent';
      case 'delhi.register': return 'Joined the Delhi waitlist';
      default: return e.action;
    }
  }
  async function loadActivity(id) {
    try {
      var a = await api().get('/api/admin/inquiries/' + id + '/activity');
      S.activity[id] = a;
      if (S.openId !== id) return;
      var hist = $('[data-part="dr-history"]');
      if (hist) {
        var ev = (a && a.events) || [];
        hist.innerHTML = ev.length ? '<ol class="iq-timeline">' + ev.map(function (e) {
          return '<li><span>' + esc(auditWords(e)) + '<time>' + esc(shortDateTime(e.created_at)) + ' · ' + esc(e.actor || '') + '</time></span></li>';
        }).join('') + '</ol>' : '<p class="iq-hint" style="margin:0">Nothing done yet.</p>';
      }
      var whoEl = $('[data-part="dr-who"]');
      if (whoEl) {
        var bits = '';
        if (a.person) bits += '<p class="iq-hint" style="margin:8px 0 0">On the attendee list since ' + esc(shortDate(a.person.registration_date)) + (a.person.job_title ? ', ' + esc(a.person.job_title) : '') + (a.person.checked_in_at ? '. Came to the event.' : '.') + '</p>';
        if (a.others && a.others.length) {
          bits += '<p class="iq-hint" style="margin:8px 0 4px">Their other enquiries:</p><div class="iq-tags">' + a.others.map(function (o) {
            return '<button class="iq-tag" data-act="open" data-id="' + o.id + '">#' + o.id + ' ' + esc((TYPES[o.inquiry_type] || TYPES.other).label) + ' · ' + esc(STATUS[o.status] || o.status) + '</button>';
          }).join('') + '</div>';
        }
        whoEl.innerHTML = bits;
      }
    } catch (e) {
      var h = $('[data-part="dr-history"]');
      if (h && S.openId === id) h.innerHTML = '<p class="iq-hint" style="margin:0">The history could not load.</p>';
    }
  }
  function markFocusRow() {
    if (!S.el) return;
    S.el.querySelectorAll('.iq-row.is-focus').forEach(function (n) { n.classList.remove('is-focus'); });
    var row = S.focusId != null ? $('[data-row="' + S.focusId + '"]') : null;
    if (row) { row.classList.add('is-focus'); if (row.scrollIntoView) try { row.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ } }
  }

  // ---------------------------------------------------------------- drawer: many at once
  function openBulkReply(ids) {
    ids = ids || selectedIds();
    if (!ids.length) return;
    var rows = ids.map(function (id) { return S.byId[id]; }).filter(Boolean);
    var types = {};
    rows.forEach(function (r) { types[r.inquiry_type] = (types[r.inquiry_type] || 0) + 1; });
    var main = Object.keys(types).sort(function (a, b) { return types[b] - types[a]; })[0] || 'general';
    var names = rows.slice(0, 6).map(function (r) { return esc(r.name); }).join(', ') + (rows.length > 6 ? ' and ' + (rows.length - 6) + ' more' : '');
    S.drawerMode = 'bulk'; S.openId = null;
    part('drawer').innerHTML = drawerShell('Reply to ' + rows.length + (rows.length === 1 ? ' person' : ' people'), names,
      '<section class="iq-card"><p class="iq-hint" style="margin:0 0 8px">Each person gets their own email with their own name in it. New ones become Replied; the rest keep their status.</p>' +
      '<label class="iq-field"><span>Saved reply</span><select data-f="reply-tpl">' + templateOptions(main) + '</select></label>' +
      '<label class="iq-field" style="margin-top:8px"><span>Subject</span><input data-f="reply-subject" value="Re: your enquiry - Bharat AI Innovation 2026"></label>' +
      '<label class="iq-field" style="margin-top:8px"><span>Message</span><textarea data-f="reply-body" rows="10" placeholder="Type the reply, or start from a saved reply"></textarea></label>' +
      '<div class="iq-composer-bar"><span class="iq-hint">Fields: {first_name} {organisation} {owner} {ref}</span>' +
        '<span style="display:flex;gap:8px"><button class="iq-btn iq-btn-sm" data-act="preview-reply">Preview for ' + esc(rows[0].name) + '</button>' +
        '<button class="iq-btn iq-btn-primary" data-act="send-bulk"><i class="fas fa-paper-plane" aria-hidden="true"></i>Send to ' + rows.length + '</button></span></div>' +
      '<div data-part="reply-preview"></div><p class="iq-msgline" data-part="reply-msg" aria-live="polite"></p></section>');
    S.bulkIds = rows.map(function (r) { return r.id; });
    var t = $('[data-f="reply-tpl"]');
    if (t) setTimeout(function () { try { t.focus(); } catch (e) { /* ignore */ } }, 0);
  }

  // ---------------------------------------------------------------- pipeline
  function pipelineHtml(c) {
    var cols = ['new', 'responded', 'in_progress', 'won', 'lost'];
    var rows = S.rows.filter(function (r) { return cols.indexOf(r.status || 'new') >= 0 && (S.boardAll || groupOf(r.inquiry_type) === 'revenue'); });
    var top = '<div class="iq-filters"><span class="iq-hint">Drag a card to another column, or choose its status. ' +
      (S.boardAll ? 'Showing every type.' : 'Showing sales: booths, sponsorship, groups, government, upgrades.') + '</span>' +
      '<button class="iq-btn iq-btn-sm" data-act="board-all">' + (S.boardAll ? 'Sales only' : 'Show every type') + '</button></div>' +
      (S.pipelineReady ? '' : '<p class="iq-locked" style="margin:0 0 10px">Deal values and follow-ups appear here once the organiser runs, once: <code>' + esc(S.pipelineHint.replace(/^.*Run: /, '')) + '</code></p>');
    var board = cols.map(function (s) {
      var list = rows.filter(function (r) { return (r.status || 'new') === s; }).sort(SORTS.priority);
      var value = list.reduce(function (t, r) { return t + (Number(r.value_inr) || 0); }, 0);
      var cards = list.slice(0, 80).map(function (r) {
        var t = TYPES[r.inquiry_type] || TYPES.other;
        return '<div class="iq-deal" draggable="true" data-deal="' + r.id + '">' +
          '<strong>' + esc(r.organization || r.name) + '</strong>' +
          '<span class="iq-deal-sub" style="display:block">' + esc(t.label) + ' · ' + esc(r.organization ? r.name : r.email) + '</span>' +
          '<div class="iq-deal-foot">' + (s === 'won' || s === 'lost' ? '<span class="iq-hint">' + esc(r.lost_reason || '') + '</span>' : bandHtml(r).replace(/<span class="iq-score">[^<]*<\/span>/, '')) +
            '<span style="font-weight:700;font-variant-numeric:tabular-nums">' + (r.value_inr ? esc((r.value_estimated ? '~' : '') + inr(r.value_inr)) : '') + '</span></div>' +
          '<div class="iq-deal-foot"><span class="iq-hint">' + esc(ownerOf(r) || 'No owner') + '</span>' +
            '<select data-act="status" data-id="' + r.id + '" aria-label="Status of ' + esc(r.name) + '">' + statusOptions(s) + '</select></div></div>';
      }).join('');
      return '<section class="iq-col" data-col="' + s + '" aria-label="' + STATUS[s] + '"><div class="iq-col-head"><strong>' + STATUS[s] + ' · ' + list.length + '</strong>' +
        '<span>' + (value ? inr(value) + ' known value' : 'no value set') + '</span></div>' +
        '<div class="iq-col-body">' + (cards || '<p class="iq-hint" style="margin:6px">None</p>') + (list.length > 80 ? '<p class="iq-hint" style="margin:6px">and ' + (list.length - 80) + ' more in the Inbox</p>' : '') + '</div></section>';
    }).join('');
    return top + '<div class="iq-board">' + board + '</div>';
  }

  // ---------------------------------------------------------------- insights
  function bars(list, opts) {
    var max = Math.max.apply(null, list.map(function (x) { return x.n; }).concat([1]));
    return '<div class="iq-bars">' + list.map(function (x) {
      var pct = Math.round(x.n / max * 100);
      return '<div class="iq-bar"><span class="iq-bar-label" title="' + esc(x.label) + '">' + esc(x.label) + '</span>' +
        '<span class="iq-bar-track"><span class="iq-bar-fill" style="display:block;width:' + Math.max(pct, x.n ? 2 : 0) + '%' + (opts && opts.color ? ';background:' + opts.color : '') + '"></span></span>' +
        '<span class="iq-bar-val">' + esc(x.shown != null ? x.shown : x.n) + '</span></div>';
    }).join('') + '</div>';
  }
  function insightsHtml(c) {
    var ins = computeInsights(S.rows, c.now, c.today, c.sla);
    var tiles = '<div class="iq-kpis">' +
      kpi('needs_reply', 'Came in, last 30 days', ins.received30, ins.replied30 + ' answered from the panel', '', 'fa-inbox') +
      kpi('insights', 'Typical first reply', fmtHours(ins.medianReply), 'half are faster than this', '', 'fa-clock') +
      kpi('late', 'Replied within ' + c.sla + ' h', ins.inSlaPct != null ? ins.inSlaPct + '%' : '—', 'of those answered, last 30 days', ins.inSlaPct != null && ins.inSlaPct < 60 ? 'iq-kpi-bad' : 'iq-kpi-good', 'fa-check') +
      kpi('pipeline', 'Won', ins.won, ins.wonValue ? inr(ins.wonValue) + ' known value' : 'mark deals Won as they close', 'iq-kpi-good', 'fa-trophy') +
      kpi('pipeline', 'Win rate', ins.winRate != null ? ins.winRate + '%' : '—', ins.won + ' won, ' + ins.lost + ' lost', '', 'fa-chart-bar') +
      kpi('all', 'Already customers', ins.senders ? Math.round(ins.customers / ins.senders * 100) + '%' : '—', ins.customers + ' of ' + ins.senders + ' senders hold a paid pass or a booth', '', 'fa-user-check') +
    '</div>';

    var maxWeek = Math.max.apply(null, ins.weeks.map(function (wk) { return wk.total; }).concat([1]));
    var weekly = '<section class="iq-card iq-ins-wide"><h3>Enquiries each week</h3><p class="iq-lede">Last ten weeks, Monday to Sunday, by what they are about.</p>' +
      (S.insTable ? '<table class="iq-table"><thead><tr><th>Week of</th>' + GROUPS.map(function (g) { return '<th class="iq-num">' + esc(g.label.split(':')[0]) + '</th>'; }).join('') + '<th class="iq-num">All</th></tr></thead><tbody>' +
          ins.weeks.map(function (wk) { return '<tr><td>' + esc(wk.label) + '</td>' + GROUPS.map(function (g) { return '<td class="iq-num">' + wk[g.key] + '</td>'; }).join('') + '<td class="iq-num">' + wk.total + '</td></tr>'; }).join('') + '</tbody></table>'
        : '<div class="iq-cols" role="img" aria-label="Enquiries each week for the last ten weeks">' + ins.weeks.map(function (wk) {
            var tip = 'Week of ' + wk.label + ': ' + wk.total + ' in all<br>' + GROUPS.map(function (g) { return esc(g.label.split(':')[0]) + ' ' + wk[g.key]; }).join('<br>');
            var segs = GROUPS.map(function (g) {
              return wk[g.key] ? '<span class="iq-seg ' + g.cls + '" style="height:' + (wk[g.key] / maxWeek * 130) + 'px;display:block"></span>' : '';
            }).join('');
            return '<div class="iq-colw" data-tip="' + esc(tip) + '" tabindex="0"><span class="iq-col-total">' + (wk.total || '') + '</span><span class="iq-stack">' + segs + '</span></div>';
          }).join('') + '</div><div class="iq-col-x">' + ins.weeks.map(function (wk) { return '<span>' + esc(wk.label) + '</span>'; }).join('') + '</div>') +
      '<div class="iq-legend">' + GROUPS.map(function (g) { return '<span><i style="background:' + g.color + '"></i>' + esc(g.label) + '</span>'; }).join('') +
        '<button class="iq-btn iq-btn-sm iq-btn-quiet" data-act="ins-table" style="margin-left:auto">' + (S.insTable ? 'Show as chart' : 'Show as table') + '</button></div></section>';

    var funnelSteps = [['received', 'Came in'], ['replied', 'Replied'], ['talking', 'In talks or decided'], ['won', 'Won']];
    var ramp = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab'];
    var funnel = '<section class="iq-card"><h3>From enquiry to sale</h3><p class="iq-lede">Sales enquiries: booths, sponsorship, groups, government, upgrades.</p><div class="iq-funnel">' +
      funnelSteps.map(function (s, i) {
        var f = ins.funnel.revenue, n = f[s[0]], base = f.received || 1;
        return '<div class="iq-fun-row"><span>' + s[1] + '</span><span class="iq-bar-track" style="height:22px"><span class="iq-fun-fill" style="display:block;width:' + Math.max(n ? 2 : 0, Math.round(n / base * 100)) + '%;background:' + ramp[i] + '"></span></span>' +
          '<span class="iq-bar-val">' + n + (i ? ' · ' + Math.round(n / base * 100) + '%' : '') + '</span></div>';
      }).join('') + '</div>' +
      (ins.funnel.revenue.received && !ins.funnel.revenue.won ? '<p class="iq-hint" style="margin:10px 0 0">No sale is marked Won yet. Mark deals Won or Lost as they close and this shows what converts.</p>' : '') + '</section>';

    var aging = '<section class="iq-card"><h3>How long the unanswered have waited</h3><p class="iq-lede">' + ins.waiting + ' with no reply. The older, the colder.</p>' +
      bars(ins.aging.map(function (a) { return { label: a.label, n: a.n }; })) + '</section>';

    var byType = '<section class="iq-card iq-ins-wide"><h3>By type</h3><p class="iq-lede">What comes in, what is still waiting, and how fast each gets a first reply.</p>' +
      '<table class="iq-table"><thead><tr><th>Type</th><th class="iq-num">All</th><th class="iq-num">Waiting</th><th class="iq-num">Typical first reply</th><th class="iq-num">Won</th><th></th></tr></thead><tbody>' +
      ins.types.map(function (t) {
        return '<tr><td>' + esc((TYPES[t.type] || TYPES.other).label) + '</td><td class="iq-num">' + t.total + '</td><td class="iq-num">' + (t.waiting ? '<strong>' + t.waiting + '</strong>' : 0) + '</td>' +
          '<td class="iq-num">' + (t.replied ? fmtHours(t.median) : '—') + '</td><td class="iq-num">' + t.won + '</td>' +
          '<td class="iq-num">' + (t.waiting ? '<button class="iq-btn iq-btn-sm" data-act="show-type" data-type="' + esc(t.type) + '">Open the ' + t.waiting + '</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></section>';

    var owners = '<section class="iq-card iq-ins-wide"><h3>Owners</h3><p class="iq-lede">Who has what, and who is behind.</p>' +
      '<table class="iq-table"><thead><tr><th>Owner</th><th class="iq-num">Open</th><th class="iq-num">Waiting over ' + c.sla + ' h</th><th class="iq-num">Replies, last 7 days</th><th class="iq-num">Typical first reply</th><th class="iq-num">Won</th></tr></thead><tbody>' +
      ins.owners.map(function (o) {
        return '<tr><td>' + esc(o.owner) + '</td><td class="iq-num">' + o.open + '</td><td class="iq-num">' + (o.late ? '<strong style="color:var(--iq-hot)">' + o.late + '</strong>' : 0) + '</td>' +
          '<td class="iq-num">' + o.replied7 + '</td><td class="iq-num">' + fmtHours(o.median) + '</td><td class="iq-num">' + o.won + (o.wonValue ? ' · ' + inr(o.wonValue) : '') + '</td></tr>';
      }).join('') + '</tbody></table></section>';

    var sources = '<section class="iq-card"><h3>Where they come from</h3><p class="iq-lede">The page or campaign the form was sent from, when it said.</p>' +
      bars(ins.sources.slice(0, 8).map(function (s) { return { label: s.label, n: s.n }; })) + '</section>';
    var lost = ins.lostReasons.length ? '<section class="iq-card"><h3>Why deals were lost</h3><p class="iq-lede">From the reason chosen when a deal is marked Lost.</p>' +
      bars(ins.lostReasons.map(function (s) { return { label: s.label, n: s.n }; })) + '</section>' : '';

    return tiles + '<div class="iq-ins">' + weekly + funnel + aging + byType + owners + sources + lost + '</div>';
  }

  // ---------------------------------------------------------------- automation
  function automationHtml(c) {
    var st = S.settings || {};
    var routing = st.routing || {};
    var toggle = function (key, on) {
      return '<span class="iq-toggle"><input type="checkbox" data-act="switch" data-key="' + key + '"' + (on ? ' checked' : '') + ' aria-label="' + (key === 'autoack' ? 'Automatic reply to the sender' : 'Morning summary for the team') + '"><span></span></span>';
    };
    var datalist = '<datalist id="iq-owner-names">' + S.owners.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>';
    var ack = '<section class="iq-card"><div class="iq-switch"><div><strong>Automatic "we have your enquiry" email</strong>' +
      '<p>Everyone who sends the form gets a short email at once: their reference number, who will reply, and a useful link for their type. Once per address a day.</p></div>' + toggle('autoack', st.autoack) + '</div>' +
      '<div class="iq-filters" style="margin:10px 0 0"><select class="iq-select" data-f="ack-type" aria-label="Type to preview">' + typeOptions('booth_inquiry', false) + '</select>' +
      '<button class="iq-btn iq-btn-sm" data-act="ack-preview">See the email</button></div><div data-part="ack-preview"></div></section>';
    var digest = '<section class="iq-card"><div class="iq-switch"><div><strong>Morning summary for the team</strong>' +
      '<p>Every day from 9 am India time, one email to ' + esc(st.team_email || 'the team') + ': what came in, what has waited too long (most valuable first), follow-ups due, and what was won.' +
      (st.digest_last_day ? ' Last sent ' + esc(dayLabel(st.digest_last_day)) + '.' : '') + '</p></div>' + toggle('digest', st.digest) + '</div>' +
      '<div class="iq-filters" style="margin:10px 0 0"><button class="iq-btn iq-btn-sm" data-act="digest-preview">See today’s summary</button>' +
      '<button class="iq-btn iq-btn-sm" data-act="digest-send">Send it now</button></div><div data-part="digest-preview"></div></section>';
    var route = '<section class="iq-card"><strong>Owners by type</strong><p class="iq-hint" style="margin:2px 0 10px">A new enquiry of this type is given to this person as it arrives. Leave a box empty for no rule.</p>' +
      datalist + '<div class="iq-route">' + TYPE_ORDER.map(function (t) {
        return '<label for="iq-route-' + t + '">' + esc(TYPES[t].label) + '</label><input id="iq-route-' + t + '" data-route="' + t + '" list="iq-owner-names" maxlength="80" value="' + esc(routing[t] || '') + '" placeholder="Nobody">';
      }).join('') + '</div><div class="iq-composer-bar"><button class="iq-btn iq-btn-sm" data-act="apply-routing">Give open ones without an owner their owner now</button>' +
      '<button class="iq-btn iq-btn-primary iq-btn-sm" data-act="save-routing">Save owners</button></div></section>';
    var sla = '<section class="iq-card"><strong>Time allowed for a first reply</strong><p class="iq-hint" style="margin:2px 0 10px">After this an enquiry counts as waiting too long, turns red, and leads the morning summary.</p>' +
      '<div class="iq-filters" style="margin:0"><label class="iq-field" style="max-width:160px"><span>Hours</span><input type="number" min="1" max="168" data-f="sla" value="' + esc(st.sla_hours || 24) + '"></label>' +
      '<button class="iq-btn iq-btn-sm" data-act="save-sla" style="align-self:flex-end">Save</button></div></section>';
    var tpls = (st.templates || []);
    var templates = '<section class="iq-card iq-ins-wide" style="grid-column:1/-1"><div class="iq-switch"><div><strong>Saved replies</strong><p>Start a reply from one of these, to one person or to many ticked at once. {first_name}, {organisation}, {owner} and {ref} are filled in for each person.</p></div>' +
      '<button class="iq-btn iq-btn-sm iq-btn-primary" data-act="tpl-new"><i class="fas fa-plus" aria-hidden="true"></i>New</button></div>' +
      (tpls.length ? tpls.map(function (t) {
        return '<div class="iq-tpl"><span><strong>' + esc(t.name) + '</strong><small>' + esc(t.type ? (TYPES[t.type] || TYPES.other).label : 'Any type') + ' · ' + esc(String(t.body).slice(0, 110)) + (String(t.body).length > 110 ? '…' : '') + '</small></span>' +
          '<span style="display:flex;gap:6px"><button class="iq-btn iq-btn-sm" data-act="tpl-edit" data-tpl="' + esc(t.id) + '">Edit</button><button class="iq-btn iq-btn-sm iq-btn-danger" data-act="tpl-delete" data-tpl="' + esc(t.id) + '">Delete</button></span></div>';
      }).join('') : '<p class="iq-hint">No saved replies.</p>') +
      '<div class="iq-composer-bar"><span></span><button class="iq-btn iq-btn-sm iq-btn-quiet" data-act="tpl-reset">Bring back the starter replies</button></div></section>';
    return '<div class="iq-auto">' + ack + digest + route + sla + templates + '</div>';
  }
  function openTemplateEditor(id) {
    var t = id ? templateById(id) : { id: '', name: '', type: '', subject: 'Re: your enquiry - Bharat AI Innovation 2026', body: '' };
    if (!t) return;
    S.tplEdit = t.id || '__new'; S.drawerMode = 'tpl'; S.openId = null;
    part('drawer').innerHTML = drawerShell(id ? 'Edit saved reply' : 'New saved reply', 'Used from the Reply box and from Reply to all',
      '<section class="iq-card"><label class="iq-field"><span>Name (what the team sees)</span><input data-f="tpl-name" maxlength="80" value="' + esc(t.name) + '"></label>' +
      '<label class="iq-field" style="margin-top:8px"><span>Shown first for</span><select data-f="tpl-type"><option value="">Any type</option>' + typeOptions(t.type, false) + '</select></label>' +
      '<label class="iq-field" style="margin-top:8px"><span>Subject</span><input data-f="tpl-subject" maxlength="200" value="' + esc(t.subject) + '"></label>' +
      '<label class="iq-field" style="margin-top:8px"><span>Message (we add "Dear name," above and the sign-off below)</span><textarea data-f="tpl-body" rows="12">' + esc(t.body) + '</textarea></label>' +
      '<div class="iq-composer-bar"><span class="iq-hint">Fields: {first_name} {organisation} {owner} {ref}</span><button class="iq-btn iq-btn-primary" data-act="tpl-save">Save</button></div>' +
      '<p class="iq-msgline" data-part="tpl-msg" aria-live="polite"></p></section>');
  }

  // ---------------------------------------------------------------- actions
  async function patchOne(id, body, quietMsg) {
    var r = S.byId[id];
    try {
      await api().patch('/api/admin/inquiries/' + id, body);
      if (r) Object.keys(body).forEach(function (k) { r[k] = body[k]; });
      if (!quietMsg) toast('Saved');
      await load(true);
      return true;
    } catch (e) {
      toast((e && e.message) || 'Could not save that.', 'error');
      await load(true);
      return false;
    }
  }
  async function bulkSet(ids, set, doneMsg) {
    if (!ids.length) return;
    try {
      var out = { changed: 0 };
      for (var i = 0; i < ids.length; i += 300) {
        var r = await api().post('/api/admin/inquiries/bulk', { ids: ids.slice(i, i + 300), set: set });
        out.changed += (r && r.changed) || 0;
      }
      toast(doneMsg || ('Changed ' + ids.length));
      await load(true);
    } catch (e) {
      toast((e && e.message) || 'Could not change them.', 'error');
    }
  }
  function pickOwner(sel) {
    if (sel.value !== '__other') return sel.value;
    var who = w.prompt('Give it to (a name the team uses):', '');
    if (who === null || !who.trim()) { sel.value = ''; return null; }
    return who.trim().slice(0, 80);
  }
  async function moveAllSuggested() {
    var by = {};
    S.rows.forEach(function (r) { if (r.suggested_type && isOpen(r)) (by[r.suggested_type] = by[r.suggested_type] || []).push(r.id); });
    var keys = Object.keys(by);
    if (!keys.length) return;
    var total = keys.reduce(function (s, k) { return s + by[k].length; }, 0);
    var words = keys.map(function (k) { return by[k].length + ' to ' + (TYPES[k] || TYPES.other).label; }).join(', ');
    if (!w.confirm('Move ' + total + ' enquiries: ' + words + '?')) return;
    for (var i = 0; i < keys.length; i++) {
      try { await api().post('/api/admin/inquiries/bulk', { ids: by[keys[i]], set: { inquiry_type: keys[i] } }); }
      catch (e) { toast((e && e.message) || 'Could not move them.', 'error'); break; }
    }
    toast('Moved ' + total);
    await load(true);
  }
  async function applyRouting() {
    try {
      var r = await api().post('/api/admin/inquiries/apply-routing', {});
      toast(r && r.changed ? 'Gave ' + r.changed + ' enquiries their owner' : 'Every open enquiry with a rule already has an owner');
      await load(true);
    } catch (e) { toast((e && e.message) || 'Could not apply the rules.', 'error'); }
  }
  async function saveSettings(patch, msg) {
    try {
      var r = await api().put('/api/admin/inquiry-settings', patch);
      if (r && r.settings) S.settings = r.settings;
      toast(msg || 'Saved');
      return true;
    } catch (e) { toast((e && e.message) || 'Could not save.', 'error'); return false; }
  }
  function fillFromTemplate(sel) {
    var t = templateById(sel.value);
    if (!t) return;
    var body = $('[data-f="reply-body"]'), subj = $('[data-f="reply-subject"]');
    if (body && body.value.trim() && body.value.trim() !== (S.lastTplBody || '') && !w.confirm('Replace what you have typed with "' + t.name + '"?')) { sel.value = ''; return; }
    if (body) body.value = t.body;
    if (subj && t.subject) subj.value = t.subject;
    S.lastTplBody = t.body;
    S.lastTplId = t.id;
    var pv = part('reply-preview');
    if (pv) pv.innerHTML = '';
  }
  function previewReply() {
    var body = ($('[data-f="reply-body"]') || {}).value || '';
    var subj = ($('[data-f="reply-subject"]') || {}).value || '';
    var r = S.drawerMode === 'bulk' ? S.byId[(S.bulkIds || [])[0]] : S.byId[S.openId];
    if (!r) return;
    var owner = ownerOf(r) || me();
    var pv = part('reply-preview');
    if (pv) pv.innerHTML = '<div class="iq-note" style="margin-top:10px"><span class="iq-note-meta">' + esc(r.email) + ' will read</span><strong>' + esc(merge(subj, r, owner)) + '</strong>\n\nDear ' + esc(r.name || 'Sir/Madam') + ',\n\n' + esc(merge(body, r, owner)) + '\n\nWarm regards,\nTeam Bharat AI Innovation</div>';
  }
  async function sendReply(id, btn) {
    var body = ($('[data-f="reply-body"]') || {}).value || '';
    var subj = ($('[data-f="reply-subject"]') || {}).value || '';
    var msg = part('reply-msg');
    if (!body.trim()) { if (msg) msg.textContent = 'The reply is empty.'; return; }
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      await api().post('/api/admin/inquiries/' + id + '/reply', { message: body, subject: subj, template_id: S.lastTplId || '' });
      toast('Reply sent to ' + ((S.byId[id] || {}).email || 'them'));
      S.lastTplBody = ''; S.lastTplId = '';
      await load(true);
      if (S.openId === id) openDrawer(id);
    } catch (e) {
      if (msg) msg.textContent = (e && e.message) || 'Could not send the reply.';
      btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane" aria-hidden="true"></i>Send';
    }
  }
  async function sendBulk(btn) {
    var ids = (S.bulkIds || []).slice();
    var body = ($('[data-f="reply-body"]') || {}).value || '';
    var subj = ($('[data-f="reply-subject"]') || {}).value || '';
    var msg = part('reply-msg');
    if (!body.trim()) { if (msg) msg.textContent = 'The reply is empty.'; return; }
    if (!w.confirm('Email this reply to ' + ids.length + (ids.length === 1 ? ' person' : ' people') + ' now? Each gets their own copy.')) return;
    btn.disabled = true;
    var sent = 0, failed = [];
    for (var i = 0; i < ids.length; i += 100) {
      btn.textContent = 'Sending ' + Math.min(i + 100, ids.length) + ' of ' + ids.length + '…';
      try {
        var r = await api().post('/api/admin/inquiries/bulk-reply', { ids: ids.slice(i, i + 100), subject: subj, message: body, template_id: S.lastTplId || '' });
        sent += (r && r.sent) || 0;
        failed = failed.concat((r && r.failed) || []);
      } catch (e) {
        failed.push({ id: 0, error: (e && e.message) || 'The send stopped.' });
        break;
      }
    }
    S.lastTplBody = ''; S.lastTplId = '';
    if (failed.length) {
      if (msg) msg.textContent = 'Sent ' + sent + '. Not sent: ' + failed.map(function (f) { return (f.id ? '#' + f.id + ' ' : '') + f.error; }).join('; ');
      btn.disabled = false; btn.textContent = 'Send to ' + ids.length;
    } else {
      toast('Sent ' + sent + (sent === 1 ? ' reply' : ' replies'));
      S.sel = {};
      closeDrawer();
    }
    await load(true);
  }
  function download(name, text) {
    try {
      var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      var href = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = href; a.download = name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(href); }, 1000);
    } catch (e) { toast('Could not make the file.', 'error'); }
  }
  async function previewInto(partName, getter) {
    var box = part(partName);
    if (!box) return;
    box.innerHTML = '<p class="iq-hint">Loading…</p>';
    try {
      var r = await getter();
      box.innerHTML = '<p class="iq-hint" style="margin:10px 0 6px"><strong>Subject:</strong> ' + esc(r.subject) + (r.to ? ' · <strong>to</strong> ' + esc(r.to) : '') + '</p><iframe class="iq-preview" sandbox="" title="Email preview"></iframe>';
      box.querySelector('iframe').srcdoc = r.html;
    } catch (e) { box.innerHTML = '<p class="iq-msgline">' + esc((e && e.message) || 'Could not load the preview.') + '</p>'; }
  }

  // ---------------------------------------------------------------- events
  function wire() {
    if (!S.el || S.el._iqWired) return;
    S.el._iqWired = true;
    S.el.addEventListener('click', onClick);
    S.el.addEventListener('change', onChange);
    S.el.addEventListener('input', onInput);
    S.el.addEventListener('dragstart', function (e) {
      var card = e.target.closest && e.target.closest('[data-deal]');
      if (!card) return;
      e.dataTransfer.setData('text/plain', card.getAttribute('data-deal'));
      e.dataTransfer.effectAllowed = 'move';
    });
    S.el.addEventListener('dragover', function (e) {
      var col = e.target.closest && e.target.closest('[data-col]');
      if (!col) return;
      e.preventDefault();
      S.el.querySelectorAll('.iq-col.is-over').forEach(function (n) { if (n !== col) n.classList.remove('is-over'); });
      col.classList.add('is-over');
    });
    S.el.addEventListener('dragleave', function (e) {
      var col = e.target.closest && e.target.closest('[data-col]');
      if (col && !col.contains(e.relatedTarget)) col.classList.remove('is-over');
    });
    S.el.addEventListener('drop', function (e) {
      var col = e.target.closest && e.target.closest('[data-col]');
      if (!col) return;
      e.preventDefault();
      col.classList.remove('is-over');
      var id = Number(e.dataTransfer.getData('text/plain'));
      var to = col.getAttribute('data-col');
      var r = S.byId[id];
      if (!r || (r.status || 'new') === to) return;
      setStatus(id, to);
    });
    S.el.addEventListener('mouseover', function (e) {
      var t = e.target.closest && e.target.closest('[data-tip]');
      var tip = part('tip');
      if (!tip) return;
      if (!t) { tip.hidden = true; return; }
      tip.innerHTML = t.getAttribute('data-tip');
      tip.hidden = false;
      placeTip(tip, e.clientX, e.clientY);
    });
    S.el.addEventListener('mousemove', function (e) {
      var tip = part('tip');
      if (tip && !tip.hidden) placeTip(tip, e.clientX, e.clientY);
    });
    S.el.addEventListener('focusin', function (e) {
      var t = e.target.closest && e.target.closest('[data-tip]');
      var tip = part('tip');
      if (!tip) return;
      if (!t) { tip.hidden = true; return; }
      var b = t.getBoundingClientRect();
      tip.innerHTML = t.getAttribute('data-tip');
      tip.hidden = false;
      placeTip(tip, b.left + b.width / 2, b.top);
    });
  }
  function placeTip(tip, x, y) {
    var r = tip.getBoundingClientRect();
    var left = Math.min(w.innerWidth - r.width - 8, Math.max(8, x + 12));
    var top = y - r.height - 12 < 8 ? y + 16 : y - r.height - 12;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }
  async function setStatus(id, to) {
    var r = S.byId[id];
    if (to === 'lost' && S.pipelineReady) {
      await patchOne(id, { status: 'lost' }, true);
      toast('Marked Lost. Choose why in the enquiry.');
      openDrawer(id);
      return;
    }
    await patchOne(id, { status: to }, true);
    toast((r ? r.name + ': ' : '') + (STATUS[to] || to));
  }

  async function onClick(e) {
    var t = e.target.closest && e.target.closest('[data-act]');
    var rowEl = e.target.closest && e.target.closest('[data-row]');
    if (!t) {
      if (rowEl && !(e.target.closest('select,input,textarea,a,button'))) openDrawer(Number(rowEl.getAttribute('data-row')));
      return;
    }
    var act = t.getAttribute('data-act');
    var id = Number(t.getAttribute('data-id'));
    if (t.tagName === 'SELECT' || (t.tagName === 'INPUT' && t.type !== 'button' && act !== 'tick' && act !== 'tick-all' && act !== 'switch')) return;
    switch (act) {
      case 'reload': S.rows.length ? load(true) : load(); break;
      case 'tab': S.tab = t.getAttribute('data-tab'); render(); break;
      case 'kpi': {
        var k = t.getAttribute('data-kpi');
        if (k === 'pipeline') S.tab = 'pipeline';
        else if (k === 'insights') S.tab = 'insights';
        else { S.tab = 'inbox'; S.view = k; S.shown = PAGE; S.q = ''; }
        render(); break;
      }
      case 'view': {
        S.view = t.getAttribute('data-view'); S.shown = PAGE; S.q = '';
        if (S.view === 'delhi' && !S.delhi) { render(); try { await loadDelhi(); } catch (x) { S.delhi = []; toast('Could not load the Delhi waitlist.', 'error'); } }
        render(); break;
      }
      case 'advice': {
        var d = t.getAttribute('data-do');
        if (d.indexOf('view:') === 0) { S.view = d.slice(5); S.tab = 'inbox'; S.q = ''; S.shown = PAGE; render(); }
        else if (d.indexOf('tab:') === 0) { S.tab = d.slice(4); render(); }
        else if (d === 'move-all') moveAllSuggested();
        else if (d === 'apply-routing') applyRouting();
        else if (d === 'select-speaking') {
          S.view = 'needs_reply'; S.type = 'speaking'; S.q = ''; S.shown = PAGE; S.sel = {};
          currentList().forEach(function (r) { S.sel[r.id] = true; });
          render();
          toast('Ticked ' + selectedIds().length + ' speaking requests. Press Reply to all.');
        }
        break;
      }
      case 'more': S.shown += PAGE; refreshList(); break;
      case 'tick': S.sel[id] = t.checked; var re = $('[data-row="' + id + '"]'); if (re) re.classList.toggle('is-selected', t.checked); renderBulk(); break;
      case 'tick-all': currentList().slice(0, S.shown).forEach(function (r) { S.sel[r.id] = t.checked; }); refreshList(); break;
      case 'tick-list': currentList().forEach(function (r) { S.sel[r.id] = true; }); refreshList(); break;
      case 'clear-ticks': S.sel = {}; refreshList(); break;
      case 'bulk-reply': openBulkReply(); break;
      case 'bulk-export': download('enquiries-ticked.csv', toCsv(selectedIds().map(function (x) { return S.byId[x]; }).filter(Boolean))); break;
      case 'export': download('enquiries-' + (S.view || 'list') + '.csv', toCsv(currentList())); break;
      case 'open': openDrawer(id); break;
      case 'reply': openDrawer(id, true); break;
      case 'close': closeDrawer(); break;
      case 'prev': case 'next': {
        var list = currentList();
        var i = -1;
        for (var j = 0; j < list.length; j++) if (list[j].id === S.openId) { i = j; break; }
        var nx = list[i + (act === 'next' ? 1 : -1)];
        if (nx) openDrawer(nx.id);
        break;
      }
      case 'move': {
        var to = t.getAttribute('data-type');
        await patchOne(id, { inquiry_type: to }, true);
        toast('Moved to ' + (TYPES[to] || TYPES.other).label);
        break;
      }
      case 'same-sender': S.q = t.getAttribute('data-email'); S.view = 'all'; S.shown = PAGE; S.tab = 'inbox'; render(); break;
      case 'preview-reply': previewReply(); break;
      case 'send-reply': sendReply(id, t); break;
      case 'send-bulk': sendBulk(t); break;
      case 'add-note': {
        var box = $('[data-f="note"]');
        var text = box ? box.value.trim() : '';
        if (!text) { if (box) box.focus(); return; }
        t.disabled = true;
        try {
          var nr = await api().post('/api/admin/inquiries/' + id + '/note', { text: text });
          if (S.byId[id] && nr) S.byId[id].admin_notes = nr.admin_notes;
          toast('Note added');
          box.value = '';
          t.disabled = false;
          var notesEl = part('dr-notes');
          if (notesEl && S.byId[id]) notesEl.innerHTML = notesInner(S.byId[id]);
          load(true).then(function () { if (S.openId === id) loadActivity(id); });
        } catch (x) { toast((x && x.message) || 'Could not add the note.', 'error'); t.disabled = false; }
        break;
      }
      case 'delete': {
        var r = S.byId[id];
        if (!r || !w.confirm('Delete enquiry #' + id + ' from ' + r.name + '? This cannot be undone. To keep it but take it off the list, set it to Closed instead.')) return;
        try { await api().del('/api/admin/inquiries/' + id); toast('Deleted'); closeDrawer(); await load(true); }
        catch (x) { toast((x && x.message) || 'Could not delete it.', 'error'); }
        break;
      }
      case 'board-all': S.boardAll = !S.boardAll; renderBody(); break;
      case 'ins-table': S.insTable = !S.insTable; renderBody(); break;
      case 'show-type': S.tab = 'inbox'; S.view = 'needs_reply'; S.type = t.getAttribute('data-type'); S.q = ''; S.shown = PAGE; render(); break;
      case 'apply-routing': applyRouting(); break;
      case 'save-routing': {
        var routing = {};
        S.el.querySelectorAll('[data-route]').forEach(function (inp) { if (inp.value.trim()) routing[inp.getAttribute('data-route')] = inp.value.trim(); });
        if (await saveSettings({ routing: routing }, 'Owners saved. New enquiries go to them from now on.')) { await load(true); }
        break;
      }
      case 'save-sla': {
        var h = Number(($('[data-f="sla"]') || {}).value);
        if (await saveSettings({ sla_hours: h }, 'Saved: ' + h + ' hours')) await load(true);
        break;
      }
      case 'switch': {
        var key = t.getAttribute('data-key');
        var on = t.checked;
        var ask = key === 'autoack'
          ? (on ? 'Turn on the automatic email? From now on everyone who sends the form gets it at once.' : 'Turn off the automatic email?')
          : (on ? 'Turn on the morning summary? It goes to ' + ((S.settings && S.settings.team_email) || 'the team') + ' every day from 9 am.' : 'Turn off the morning summary?');
        if (!w.confirm(ask)) { t.checked = !on; return; }
        var patch = {}; patch[key] = on;
        if (!(await saveSettings(patch, (key === 'autoack' ? 'Automatic email ' : 'Morning summary ') + (on ? 'on' : 'off')))) t.checked = !on;
        break;
      }
      case 'ack-preview': {
        var ty = ($('[data-f="ack-type"]') || {}).value || 'booth_inquiry';
        previewInto('ack-preview', function () { return api().get('/api/admin/inquiries/ack-preview?type=' + encodeURIComponent(ty)); });
        break;
      }
      case 'digest-preview': previewInto('digest-preview', function () { return api().post('/api/admin/inquiries/digest', { send: false }); }); break;
      case 'digest-send': {
        if (!w.confirm('Send today’s summary to ' + ((S.settings && S.settings.team_email) || 'the team') + ' now?')) return;
        try { await api().post('/api/admin/inquiries/digest', { send: true }); toast('Summary sent'); }
        catch (x) { toast((x && x.message) || 'Could not send it.', 'error'); }
        break;
      }
      case 'tpl-new': openTemplateEditor(''); break;
      case 'tpl-edit': openTemplateEditor(t.getAttribute('data-tpl')); break;
      case 'tpl-delete': {
        var tid = t.getAttribute('data-tpl');
        var tp = templateById(tid);
        if (!tp || !w.confirm('Delete the saved reply "' + tp.name + '"?')) return;
        if (await saveSettings({ templates: S.settings.templates.filter(function (x) { return x.id !== tid; }) }, 'Deleted')) renderBody();
        break;
      }
      case 'tpl-reset': {
        if (!w.confirm('Bring back the starter replies? Your own saved replies are replaced by them.')) return;
        if (await saveSettings({ templates: 'reset' }, 'The starter replies are back')) renderBody();
        break;
      }
      case 'tpl-save': {
        var name = (($('[data-f="tpl-name"]') || {}).value || '').trim();
        var body = (($('[data-f="tpl-body"]') || {}).value || '').trim();
        var m = part('tpl-msg');
        if (!name || !body) { if (m) m.textContent = 'A saved reply needs a name and a message.'; return; }
        var item = { id: S.tplEdit === '__new' ? '' : S.tplEdit, name: name, type: ($('[data-f="tpl-type"]') || {}).value || '', subject: (($('[data-f="tpl-subject"]') || {}).value || '').trim(), body: body };
        var list2 = (S.settings.templates || []).slice();
        var at = -1;
        for (var q = 0; q < list2.length; q++) if (list2[q].id === item.id) at = q;
        if (at >= 0) list2[at] = item; else list2.push(item);
        if (await saveSettings({ templates: list2 }, 'Saved reply kept')) { closeDrawer(); renderBody(); }
        break;
      }
    }
  }

  async function onChange(e) {
    var t = e.target;
    var act = t.getAttribute('data-act');
    var f = t.getAttribute('data-f');
    var dr = t.getAttribute('data-dr');
    var id = Number(t.getAttribute('data-id'));
    if (f === 'type' || f === 'status' || f === 'owner' || f === 'sort') {
      S[f] = t.value; S.shown = PAGE; refreshList(); return;
    }
    if (f === 'reply-tpl') { fillFromTemplate(t); return; }
    if (act === 'status') { await setStatus(id, t.value); return; }
    if (act === 'owner') {
      var who = pickOwner(t);
      if (who === null) return;
      await patchOne(id, { assigned_to: who }, true);
      toast(who ? 'Given to ' + who : 'Owner cleared');
      return;
    }
    if (act === 'bulk-owner' || act === 'bulk-status' || act === 'bulk-type') {
      var ids = selectedIds();
      var v = t.value;
      if (!v || !ids.length) return;
      if (act === 'bulk-owner') {
        var name = v === '__nobody' ? '' : v === '__other' ? (w.prompt('Give them to:', '') || '').trim() : v;
        if (v === '__other' && !name) { t.value = ''; return; }
        await bulkSet(ids, { assigned_to: name }, name ? 'Gave ' + ids.length + ' to ' + name : 'Cleared the owner of ' + ids.length);
      } else if (act === 'bulk-status') {
        await bulkSet(ids, { status: v }, ids.length + ' set to ' + STATUS[v]);
      } else {
        if (!w.confirm('Move ' + ids.length + ' enquiries to ' + (TYPES[v] || TYPES.other).label + '?')) { t.value = ''; return; }
        await bulkSet(ids, { inquiry_type: v }, 'Moved ' + ids.length + ' to ' + (TYPES[v] || TYPES.other).label);
      }
      return;
    }
    if (dr && S.openId != null) {
      var rid = S.openId;
      var val = t.value;
      if (dr === 'assigned_to') { val = pickOwner(t); if (val === null) return; }
      var body = {}; body[dr] = val;
      var saved = part('dr-saved');
      if (saved) saved.textContent = 'Saving…';
      var ok = await patchOne(rid, body, true);
      if (saved) { saved.style.color = ok ? 'var(--iq-good)' : ''; saved.textContent = ok ? 'Saved.' : 'Not saved.'; }
      // Only the Decide card is redrawn (new score, reasons, the lost-reason box);
      // a reply or a note being typed further down is left alone.
      var card = part('dr-decide');
      if (ok && card && S.openId === rid && S.byId[rid]) {
        card.innerHTML = decideHtml(S.byId[rid]);
        var back = $('[data-dr="' + dr + '"]');
        if (back) try { back.focus(); } catch (x) { /* ignore */ }
        var s2 = part('dr-saved');
        if (s2) { s2.style.color = 'var(--iq-good)'; s2.textContent = 'Saved.'; }
      }
    }
  }

  var searchTimer = null;
  function onInput(e) {
    var t = e.target;
    if (t.getAttribute('data-f') !== 'q') return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { S.q = t.value; S.shown = PAGE; refreshList(); }, 150);
  }

  function onKey(e) {
    if (!S.el || !visible() || S.tab !== 'inbox' && !S.drawerMode) return;
    var tag = (e.target && e.target.tagName) || '';
    var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable);
    if (e.key === 'Escape') {
      if (S.drawerMode) { e.preventDefault(); closeDrawer(); return; }
      if (typing && e.target.getAttribute('data-f') === 'q') { e.target.value = ''; S.q = ''; refreshList(); return; }
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    var modal = document.getElementById('modal-container');
    if (modal && !modal.classList.contains('hidden')) return;
    if (S.drawerMode && S.drawerMode !== 'one') return;
    var list = currentList();
    var i = -1;
    for (var j = 0; j < list.length; j++) if (list[j].id === (S.openId != null ? S.openId : S.focusId)) { i = j; break; }
    if (e.key === 'j' || e.key === 'k') {
      e.preventDefault();
      var nx = list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'j' ? 1 : -1)))];
      if (!nx) return;
      if (list.indexOf(nx) >= S.shown) { S.shown = list.indexOf(nx) + 1; refreshList(); }
      S.focusId = nx.id;
      if (S.drawerMode === 'one') openDrawer(nx.id); else markFocusRow();
    } else if ((e.key === 'Enter' || e.key === 'o') && S.focusId != null && !S.drawerMode) {
      e.preventDefault(); openDrawer(S.focusId);
    } else if (e.key === 'r' && (S.focusId != null || S.openId != null)) {
      e.preventDefault(); openDrawer(S.openId != null ? S.openId : S.focusId, true);
    } else if (e.key === 'x' && S.focusId != null && !S.drawerMode) {
      e.preventDefault(); S.sel[S.focusId] = !S.sel[S.focusId]; refreshList(); markFocusRow();
    } else if (e.key === '/' && !S.drawerMode) {
      var q = $('[data-f="q"]');
      if (q) { e.preventDefault(); q.focus(); q.select(); }
    }
  }

  // ---------------------------------------------------------------- mount
  async function mount(el, deps) {
    var fresh = S.el !== el;
    S.el = el; S.deps = deps || S.deps;
    if (fresh) { el._iqWired = false; }
    if (!S.mounted) { document.addEventListener('keydown', onKey); S.mounted = true; }
    var want = deps && deps.initialType;
    if (want) {
      S.tab = 'inbox'; S.q = ''; S.shown = PAGE;
      if (want === 'delhi_pass') { S.view = 'delhi'; S.type = ''; }
      else { S.view = 'open'; S.type = want; }
    }
    var params = null;
    try { params = new URLSearchParams(w.location.search); } catch (x) { params = null; }
    var deep = params ? Number(params.get('inq')) : 0;
    await load(!fresh && S.rows.length > 0);
    if (deep && S.byId[deep]) {
      S.tab = 'inbox'; render(); openDrawer(deep);
      try { params.delete('inq'); var qs = params.toString(); w.history.replaceState(null, '', w.location.pathname + (qs ? '?' + qs : '') + w.location.hash); } catch (x) { /* ignore */ }
    }
  }

  w.InqDesk = {
    mount: mount,
    reload: function () { return load(true); },
    _t: {
      esc: esc, parseTs: parseTs, hoursSince: hoursSince, fmtAge: fmtAge, fmtHours: fmtHours, indian: indian, inr: inr, istDay: istDay,
      median: median, isOpen: isOpen, isLate: isLate, isDue: isDue, firstReplyHours: firstReplyHours, merge: merge,
      csvCell: csvCell, toCsv: toCsv, matchesSearch: matchesSearch, filterRows: filterRows, computeInsights: computeInsights,
      advise: advise, parseNotes: parseNotes, auditWords: auditWords, VIEWS: VIEWS, TYPES: TYPES, STATUS: STATUS
    }
  };
})(window);
