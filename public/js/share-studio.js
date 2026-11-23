/* /share: "Share your Bharat AI moment" (organiser, 23 Nov 2026).
 *
 * Draws the four after-the-event cards with js/moment-card.js and hands them to
 * the phone's share sheet with the words for each platform. Signed in to the app
 * (same site, same cookie), the person's name, photo and pass come from their
 * record; otherwise they type their name and the pass is left off (a pass is
 * never picked on this page). Photos chosen here stay on the phone.
 *
 * Reads: /api/events/1/programme (public), /api/attendees/:id and its
 * connections (only for the signed-in person). Writes: the step counter
 * (/api/attendees/:id/track-step, kind 'moment'), signed in only.
 */
(function () {
  'use strict';
  var MC = window.BhaiMomentCard;
  if (!MC) return;
  function $(id) { return document.getElementById(id); }
  function str(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var KINDS = ['attended', 'met', 'talk', 'panel'];
  var PLATFORMS = {
    linkedin: { name: 'LinkedIn', open: function (cap) { return 'https://www.linkedin.com/feed/?shareActive=true&text=' + encodeURIComponent(cap); } },
    instagram: { name: 'Instagram', open: function () { return 'https://www.instagram.com/'; } },
    facebook: { name: 'Facebook', open: function () { return 'https://www.facebook.com/'; } },
    x: { name: 'X', open: function (cap) { return 'https://x.com/intent/post?text=' + encodeURIComponent(cap); } },
    whatsapp: { name: 'WhatsApp', open: function (cap) { return 'https://wa.me/?text=' + encodeURIComponent(cap); } }
  };
  var TAKEAWAY = {
    attended: { label: 'Your biggest takeaway', ph: 'e.g. Agentic AI is moving from pilots to real work' },
    met: { label: 'What did you talk about?', ph: 'e.g. AI agents for customer support' },
    talk: { label: 'What did you learn?', ph: 'e.g. Start with one workflow, not ten' },
    panel: { label: 'What did you learn?', ph: 'e.g. Clean data matters more than the model' }
  };

  var state = {
    kind: 'attended', size: 'post', platform: 'linkedin',
    user: null, me: { name: '', title: '', company: '', photo: '', pass: '' }, showPass: false, mePhoto: null,
    talks: [], panels: [], talkId: '', panelId: '', topic: '', topicFor: '',
    people: [{ name: '', title: '', company: '', photo: '' }], suggestions: [],
    metPhoto: null, ownBg: null, bg: { attended: 'big-screen', met: 'big-screen', talk: 'on-stage', panel: 'panel' },
    takeaway: { attended: '', met: '', talk: '', panel: '' },
    caps: {}, edited: {}, file: null, blobUrl: '', seq: 0, made: {}
  };

  function isTouchPhone() {
    try { return (navigator.maxTouchPoints || 0) > 0 && Math.min(screen.width, screen.height) <= 900; } catch (e) { return false; }
  }
  function canShareFile(f) {
    try { return !!(f && navigator.share && navigator.canShare && navigator.canShare({ files: [f] })); } catch (e) { return false; }
  }
  var toastT;
  function toast(msg) {
    var t = $('shToast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('on'); }, 3600);
  }
  function copy(text, quiet) {
    var done = function () { if (!quiet) toast('Copied. Paste it into your post.'); };
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, fallback); return; } } catch (e) {}
    fallback();
    function fallback() {
      try {
        var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
        ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); ta.remove(); done();
      } catch (e) {}
    }
  }
  function track(step, reason) {
    if (!state.user || !state.user.id) return;
    try {
      fetch('/api/attendees/' + state.user.id + '/track-step', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'moment', step: step, reason: reason || state.kind + ' ' + state.platform }), keepalive: true }).catch(function () {});
    } catch (e) {}
  }

  // ---------------------------------------------------------------- dates
  function when(t) {
    var d = new Date(String(t || '').replace(' ', 'T') + ':00+05:30');
    if (isNaN(d)) return { day: '', time: '', dayLong: '' };
    return {
      day: d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }),
      dayLong: d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }),
      time: d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).replace(/\s?([ap])\.?m\.?/i, ' $1m').toLowerCase()
    };
  }

  // ---------------------------------------------------------------- the programme
  function buildProgramme(p) {
    var spBy = {};
    (p.speakers || []).forEach(function (s) { spBy[s.id] = s; });
    function fromLink(l) {
      var x = spBy[l.speaker_id];
      return x ? { name: x.name, title: x.role || '', company: x.organisation || '', photo: x.photo_url || '', moderator: l.role === 'moderator', topic: x.topic || '' } : null;
    }
    var talks = [], seen = {};
    // Innovation Talks: one entry per slot and company (two founders share a slot).
    (p.talks || []).forEach(function (t) {
      if (!t.starts_at || !str(t.speaker_name)) return;
      var key = t.starts_at + '|' + str(t.company).toLowerCase().split(/[\s,]/)[0];
      var g = seen[key];
      if (!g) {
        g = seen[key] = { id: 't' + t.id, kindWords: 'an Innovation Talk', start: t.starts_at, topic: '', company: str(t.company),
          speakers: [], hall: t.hall || 'Aryabhata Theatre' };
        talks.push(g);
      }
      if (!g.topic && str(t.topic)) g.topic = str(t.topic);
      if (g.speakers.length < 2) g.speakers.push({ name: t.speaker_name, title: t.speaker_title || '', company: t.company || '', photo: t.photo_url || '' });
    });
    // Keynotes and stage talks with a named speaker.
    (p.sessions || []).forEach(function (s) {
      if (['keynote', 'talk'].indexOf(s.session_type) < 0 || /^innovation talk/i.test(s.title || '')) return;
      var sp = (s.links || []).map(fromLink).filter(Boolean);
      if (!sp.length && str(s.speaker_name)) sp = [{ name: str(s.speaker_name), title: str(s.speaker_title), company: '', photo: '' }];
      if (!sp.length) return;
      var generic = /^(keynote|special address|welcome note|closing note|opening note)$/i.test(str(s.title));
      talks.push({ id: 's' + s.id, kindWords: s.session_type === 'keynote' ? 'a keynote' : 'a talk', start: s.start_time,
        topic: generic ? (sp[0].topic || '') : str(s.title), fallback: str(s.title), speakers: sp.slice(0, 2), hall: s.room || '' });
    });
    talks.sort(function (a, b) { return String(a.start).localeCompare(String(b.start)); });
    var panels = (p.sessions || []).filter(function (s) { return s.session_type === 'panel'; }).map(function (s) {
      var ppl = (s.links || []).map(fromLink).filter(Boolean);
      ppl.sort(function (a, b) { return (a.moderator ? 1 : 0) - (b.moderator ? 1 : 0); });
      return { id: String(s.id), topic: str(s.title), start: s.start_time, hall: s.room || '', people: ppl };
    }).filter(function (x) { return x.people.length; });
    panels.sort(function (a, b) { return String(a.start).localeCompare(String(b.start)); });
    // People someone may have met: every speaker and every Innovation Talk speaker.
    var sugg = [], names = {};
    function addS(o) {
      var k = str(o.name).toLowerCase().replace(/^(dr\.?|prof\.?|shri\.?|smt\.?|mr\.?|ms\.?|mrs\.?|hon’ble|hon'ble)\s+/g, '');
      if (!k || names[k]) return; names[k] = 1; sugg.push(o);
    }
    (p.speakers || []).forEach(function (x) { addS({ name: x.name, title: x.role || '', company: x.organisation || '', photo: x.photo_url || '', tag: 'Speaker' }); });
    (p.talks || []).forEach(function (t) { if (str(t.speaker_name)) addS({ name: t.speaker_name, title: t.speaker_title || '', company: t.company || '', photo: t.photo_url || '', tag: 'Innovation Talk' }); });
    state.talks = talks; state.panels = panels; state.suggestions = sugg.concat(state.suggestions.filter(function (s) { return s.tag === 'Connection'; }));
  }

  function fillSelects() {
    function groupBy(list, label) {
      var html = '', day = '';
      list.forEach(function (it) {
        var w = when(it.start);
        if (w.dayLong !== day) { if (day) html += '</optgroup>'; day = w.dayLong; html += '<optgroup label="' + esc(day) + '">'; }
        html += '<option value="' + esc(it.id) + '">' + esc(label(it, w)) + '</option>';
      });
      return html + (day ? '</optgroup>' : '');
    }
    $('shTalk').innerHTML = groupBy(state.talks, function (t, w) {
      var who = t.speakers.map(function (s) { return str(s.name); }).join(' & ');
      var co = t.company || (t.speakers[0] && t.speakers[0].company) || '';
      var what = t.topic || t.fallback || '';
      return w.time + ' · ' + who + (co ? ' (' + co.slice(0, 40) + ')' : '') + (what ? ': ' + what.slice(0, 70) + (what.length > 70 ? '…' : '') : '');
    });
    $('shPanel').innerHTML = groupBy(state.panels, function (p, w) { return w.time + ' · ' + p.topic; });
    if (!state.talkId || !findTalk(state.talkId)) state.talkId = state.talks[0] ? state.talks[0].id : '';
    if (!state.panelId || !findPanel(state.panelId)) state.panelId = state.panels[0] ? state.panels[0].id : '';
    $('shTalk').value = state.talkId; $('shPanel').value = state.panelId;
    syncTopic();
  }
  function findTalk(id) { return state.talks.filter(function (t) { return t.id === id; })[0] || null; }
  function findPanel(id) { return state.panels.filter(function (p) { return p.id === String(id); })[0] || null; }
  function syncTopic() {
    var t = findTalk(state.talkId);
    if (!t || state.topicFor === t.id) return;
    state.topicFor = t.id; state.topic = t.topic || '';
    $('shTopic').value = state.topic;
    $('shTopic').placeholder = t.topic ? '' : 'Type the topic of the talk';
    $('shTopicHelp').textContent = t.topic ? 'As in the programme. You can change it.' : 'The programme has no topic for this one. Type it if you remember it.';
  }

  // ---------------------------------------------------------------- the person
  async function loadUser() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem('agba_user') || 'null'); } catch (e) {}
    if (!saved || !saved.id) return null;
    try {
      var r = await fetch('/api/attendees/' + encodeURIComponent(saved.id), { credentials: 'same-origin' });
      if (!r.ok) return null;
      var u = await r.json();
      if (!u || String(u.id) !== String(saved.id)) return null;
      return u;
    } catch (e) { return null; }
  }
  async function loadConnections(id) {
    try {
      var r = await fetch('/api/attendees/' + encodeURIComponent(id) + '/connections', { credentials: 'same-origin' });
      if (!r.ok) return [];
      var list = await r.json();
      return (Array.isArray(list) ? list : []).filter(function (c) { return String(c.status || '').toLowerCase() === 'accepted' && str(c.other_name); })
        .map(function (c) { return { name: c.other_name, title: c.other_job_title || '', company: c.other_company || '', photo: c.other_avatar || '', tag: 'Connection' }; });
    } catch (e) { return []; }
  }

  function showWho() {
    var box = $('shWho'), u = state.user;
    box.hidden = false;
    if (u) {
      var P = MC.PASSES[state.me.pass];
      var chip = P && state.showPassAllowed ? ' <span class="sh-pass" style="background:' + P.c1 + (P.gold ? ';color:#2A1F05' : '') + '">' + esc(P.label) + '</span>' : '';
      box.innerHTML = (state.me.photo ? '<img src="' + esc(state.me.photo) + '" alt="">' : '') +
        '<p>Signed in as <strong>' + esc(state.me.name) + '</strong>' + chip + '. Your name, photo and pass are on the picture.</p>';
    } else {
      box.innerHTML = '<p>Signed in to the Bharat AI app? Your name, photo and pass go on the picture by themselves.</p>' +
        '<a href="/app?action=share-moment"><i class="fas fa-right-to-bracket" aria-hidden="true"></i> Sign in</a>';
    }
  }

  function placeMeFields() {
    var f = $('shMeFields');
    if (state.user) {
      $('shMeIn').appendChild(f); $('shMeFold').hidden = false;
      $('shMeSum').textContent = 'Your name on the picture: ' + (state.me.name || '');
    } else {
      $('shMeOpen').appendChild(f); $('shMeFold').hidden = true;
    }
    $('shName').value = state.me.name; $('shTitle').value = state.me.title; $('shCompany').value = state.me.company;
    $('shPassRow').hidden = !state.showPassAllowed;
    var P = MC.PASSES[state.me.pass];
    if (P) $('shPassText').textContent = 'Show my pass on the picture (' + P.label.toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); }).replace('Vip', 'VIP') + ')';
    refreshMePhoto();
  }
  function refreshMePhoto() {
    var src = state.mePhoto ? state.mePhoto.toDataURL('image/jpeg', 0.7) : state.me.photo;
    $('shMePhotoImg').hidden = !src; $('shMePhotoIcon').hidden = !!src;
    if (src) $('shMePhotoImg').src = src;
    $('shMePhotoTitle').textContent = src ? 'Change your photo' : 'Add your photo';
  }

  // ---------------------------------------------------------------- photos from the phone
  function readPhoto(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type || 'image/')) { reject(new Error('That is not a photo. Choose a JPG or PNG.')); return; }
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () {
        var w = im.naturalWidth, h = im.naturalHeight, s = Math.min(1, 2000 / Math.max(w, h));
        var c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); resolve(c);
      };
      im.onerror = function () { URL.revokeObjectURL(url); reject(new Error('This photo could not be opened. Try another one, or take a screenshot of it and choose that.')); };
      im.src = url;
    });
  }
  function pickPhoto(input, then) {
    input.onchange = function () {
      var f = input.files && input.files[0];
      input.value = '';
      if (!f) return;
      readPhoto(f).then(then, function (e) { toast(e.message); });
    };
    input.click();
  }

  // ---------------------------------------------------------------- backdrops
  function backdropList() {
    var list = [];
    if (state.kind === 'panel') {
      var p = findPanel(state.panelId), ph = p && MC.PANEL_PHOTOS[p.id];
      if (ph) list.push({ id: 'panel', src: ph.src, fx: ph.fx, fy: ph.fy, label: 'This panel' });
    }
    return list.concat(MC.BACKDROPS);
  }
  function currentBackdrop() {
    var sel = state.bg[state.kind];
    if (sel === 'own' && state.ownBg) return { img: state.ownBg, own: true };
    var list = backdropList();
    return list.filter(function (b) { return b.id === sel; })[0] || list[0];
  }
  function thumb(src) { return src.replace(/\.webp$/, '-720.webp'); }
  function drawBgs() {
    var sel = state.bg[state.kind], html = '';
    backdropList().forEach(function (b) {
      html += '<button type="button" class="sh-bg" data-bg="' + esc(b.id) + '" aria-pressed="' + (sel === b.id) + '" aria-label="' + esc(b.label) + '">' +
        '<img src="' + esc(thumb(b.src)) + '" alt="" loading="lazy" decoding="async"></button>';
    });
    if (state.kind !== 'met') {
      html += '<button type="button" class="sh-bg sh-bg-own' + (state.ownBg ? ' has' : '') + '" data-bg="own" aria-pressed="' + (sel === 'own') + '">' +
        (state.ownBg ? '<img src="' + state.ownBg.toDataURL('image/jpeg', 0.6) + '" alt="">' : '<i class="fas fa-camera" aria-hidden="true"></i>My own photo') + '</button>';
    }
    $('shBgs').innerHTML = html;
    $('shBgLabel').textContent = state.kind === 'met' ? 'Behind your photo' : state.kind === 'panel' ? 'Photo at the top' : 'Photo from the event';
    $('shBgHelp').textContent = state.kind === 'panel' ? 'The first one is this panel on stage. Or use your own photo of it.'
      : state.kind === 'met' ? 'A photo of the stage, with भारत एआई इनोवेशन on the screen.'
      : 'With भारत एआई इनोवेशन on the screen. Or use your own photo of the day.';
  }

  // ---------------------------------------------------------------- who I met
  function drawPeople() {
    var html = '';
    state.people.forEach(function (p, i) {
      html += '<div class="sh-person" data-i="' + i + '">' +
        '<div class="sh-person-h">' + (p.photo ? '<img src="' + esc(p.photo) + '" alt="">' : '') + '<strong>Person ' + (i + 1) + '</strong>' +
        (state.people.length > 1 ? '<button type="button" class="sh-x" data-remove="' + i + '" aria-label="Remove person ' + (i + 1) + '">&times;</button>' : '') + '</div>' +
        '<div class="sh-sugg"><label class="sh-help" for="shPN' + i + '">Name</label><input type="text" id="shPN' + i + '" data-f="name" value="' + esc(p.name) + '" autocomplete="off" maxlength="60" placeholder="Start typing a name"><ul hidden></ul></div>' +
        '<div class="sh-row2" style="margin-top:8px"><div><label class="sh-help" for="shPT' + i + '">Designation</label><input type="text" id="shPT' + i + '" data-f="title" value="' + esc(p.title) + '" maxlength="80"></div>' +
        '<div><label class="sh-help" for="shPC' + i + '">Organisation</label><input type="text" id="shPC' + i + '" data-f="company" value="' + esc(p.company) + '" maxlength="80"></div></div>' +
        '</div>';
    });
    $('shPeople').innerHTML = html;
    $('shAddPerson').hidden = state.people.length >= 3;
  }
  function matches(q) {
    q = q.toLowerCase().trim();
    if (q.length < 2) return [];
    var words = q.split(/\s+/);
    return state.suggestions.filter(function (s) {
      var hay = (s.name + ' ' + s.company).toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    }).slice(0, 7);
  }
  function showSugg(input, i) {
    var ul = input.parentNode.querySelector('ul'), list = matches(input.value);
    if (!list.length) { ul.hidden = true; ul.innerHTML = ''; return; }
    ul.innerHTML = list.map(function (s, j) {
      var ini = str(s.name).split(' ').filter(Boolean).map(function (w) { return w.charAt(0); }).slice(0, 2).join('').toUpperCase();
      return '<li><button type="button" data-pick="' + j + '">' + (s.photo ? '<img src="' + esc(s.photo) + '" alt="">' : '<span class="sh-ini">' + esc(ini) + '</span>') +
        '<span><b>' + esc(s.name) + '</b><small>' + esc([s.title, s.company].filter(Boolean).join(', ').slice(0, 90)) + '</small><em>' + esc(s.tag) + '</em></span></button></li>';
    }).join('');
    ul.hidden = false;
    ul.onclick = function (e) {
      var b = e.target.closest('button[data-pick]'); if (!b) return;
      var s = list[Number(b.getAttribute('data-pick'))];
      state.people[i] = { name: s.name, title: s.title, company: s.company, photo: s.photo };
      drawPeople(); changed();
    };
  }

  // ---------------------------------------------------------------- the card
  function cardData() {
    var me = { name: state.me.name, title: state.me.title, company: state.me.company, pass: state.me.pass,
      photo: state.mePhoto || state.me.photo };
    var d = { me: me, showPass: state.showPass && state.showPassAllowed, takeaway: state.takeaway[state.kind] };
    var bg = currentBackdrop();
    if (state.kind === 'met') {
      d.backdrop = bg.own ? MC.BACKDROPS[0] : bg;
      d.photo = state.metPhoto ? { img: state.metPhoto, own: true } : null;
      d.people = state.people.filter(function (p) { return str(p.name); });
    } else d.photo = bg;
    if (state.kind === 'talk') {
      var t = findTalk(state.talkId) || { speakers: [] }, w = when(t.start);
      d.talk = { kindWords: t.kindWords, topic: state.topic, fallback: t.fallback || (t.company ? 'Innovation Talk by ' + t.company : ''),
        speakers: t.speakers, day: w.day, time: w.time, hall: t.hall };
    }
    if (state.kind === 'panel') {
      var p = findPanel(state.panelId) || { people: [] }, w2 = when(p.start);
      d.panel = { topic: p.topic, people: p.people, day: w2.day, time: w2.time, hall: p.hall };
    }
    return d;
  }

  /* Anything changed: the picture on screen is now the old one, so Save and Share
   * wait for the new one (a tap in between would hand over the last picture). */
  var drawT;
  function changed() {
    clearTimeout(drawT);
    state.ready = false; busy(true);
    drawT = setTimeout(draw, 220);
    refreshCaption(false);
  }
  function notReady() {
    if (state.ready && state.file) return false;
    toast('One moment: your picture is still being drawn.');
    return true;
  }
  function busy(on) { $('shBusy').classList.toggle('on', !!on); }
  async function draw() {
    var my = ++state.seq;
    busy(true); $('shErr').classList.remove('on');
    try {
      if (state.kind === 'talk' && !state.talks.length) throw new Error('The programme is still loading.');
      var r = await MC.render(state.kind, cardData(), { size: state.size });
      if (my !== state.seq) return;
      var name = r.filename.replace(/\.png$/, '.jpg');
      r.canvas.toBlob(function (blob) {
        if (my !== state.seq || !blob) return;
        if (state.blobUrl) URL.revokeObjectURL(state.blobUrl);
        state.blobUrl = URL.createObjectURL(blob);
        state.file = new File([blob], name, { type: 'image/jpeg' });
        state.filename = name;
        $('shImg').src = state.blobUrl;
        state.ready = true;
        busy(false);
        refreshButtons();
        if (!state.made[state.kind]) { state.made[state.kind] = 1; track('made', state.kind); }
      }, 'image/jpeg', 0.93);
    } catch (e) {
      if (my !== state.seq) return;
      busy(false);
      $('shErr').textContent = (e && e.message) || 'The picture could not be drawn. Please reload the page.';
      $('shErr').classList.add('on');
    }
  }

  // ---------------------------------------------------------------- words and buttons
  function refreshCaption(force) {
    state.caps = MC.captions(state.kind, cardData());
    var key = state.kind + ':' + state.platform;
    if (force || !state.edited[key]) $('shCap').value = state.caps[state.platform];
    $('shCapReset').hidden = !state.edited[key];
    capCount();
    refreshButtons();
  }
  function capCount() {
    var v = $('shCap').value, el = $('shCapCount');
    if (state.platform === 'x') {
      var n = MC.xLength(v);
      el.textContent = n + ' / 280' + (n > 280 ? ': too long for X, shorten it' : '');
      el.style.color = n > 280 ? '#B42318' : '';
    } else { el.textContent = ''; el.style.color = ''; }
  }
  function refreshButtons() {
    var P = PLATFORMS[state.platform], phone = isTouchPhone(), share = phone && canShareFile(state.file);
    $('shShare').hidden = !share;
    $('shShareText').textContent = 'Share to ' + P.name;
    $('shSaveText').textContent = phone ? 'Save picture' : 'Download picture';
    $('shOpenText').textContent = 'Open ' + P.name;
    $('shOpen').href = P.open($('shCap').value);
    var steps;
    if (share) steps = ['Tap <strong>Share to ' + P.name + '</strong>. The words are copied as it opens.', 'Pick ' + P.name + ' in the list. If the words are not in the post, press and hold, then <strong>Paste</strong>.', 'Tag the people in it (below), then post.'];
    else if (state.platform === 'instagram') steps = [(phone ? 'Tap <strong>Save picture</strong>, then press and hold it to keep it.' : 'Download the picture and send it to your phone.'), 'Tap <strong>Copy the words</strong>.', 'In Instagram, tap <strong>+</strong>, choose the picture, paste the words, tag, and share.'];
    else if (state.platform === 'facebook') steps = [(phone ? 'Tap <strong>Save picture</strong>.' : 'Download the picture.'), 'Tap <strong>Copy the words</strong>.', 'In Facebook, start a post, add the picture, paste the words, tag, and post.'];
    else steps = [(phone ? 'Tap <strong>Save picture</strong>.' : 'Download the picture.'), 'Tap <strong>Open ' + P.name + '</strong>: the words are already in the post.', 'Add the picture (the photo button), tag the people in it, and post.'];
    $('shSteps').innerHTML = steps.map(function (s) { return '<li>' + s + '</li>'; }).join('');

    var names = [];
    if (state.kind === 'met') names = state.people.map(function (p) { return str(p.name); }).filter(Boolean);
    if (state.kind === 'talk') { var t = findTalk(state.talkId); names = t ? t.speakers.map(function (s) { return str(s.name); }) : []; }
    if (state.kind === 'panel') { var p = findPanel(state.panelId); names = p ? p.people.map(function (s) { return str(s.name); }) : []; }
    var us = state.platform === 'instagram' ? '<code>@bharataiinnovation.ai</code>' : state.platform === 'facebook' ? '<code>@BharatAIInnovation</code>'
      : state.platform === 'linkedin' ? '<code>Bharat AI Innovation</code>' : '';
    var how = state.platform === 'x' || state.platform === 'whatsapp'
      ? 'Mention people by their handle if you know it.'
      : 'Type <strong>@</strong> and start their name, then pick them from the list that appears. Names you paste do not tag anyone: on LinkedIn, delete the last letter of a pasted <code>@Name</code> and type it again, and the list appears.';
    $('shTag').innerHTML = '<strong class="sh-tag-h">Tag them: they see it, and they share it too</strong>' + how +
      (names.length ? '<br>On this picture: ' + names.map(esc).join(', ') + '.' : '') +
      (us ? '<br>Tag us too: ' + us + '.' : '');
  }

  function saveOverlay() {
    var o = document.createElement('div');
    o.className = 'sh-save'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true'); o.setAttribute('aria-label', 'Your picture');
    o.innerHTML = '<div class="sh-save-in"><div class="sh-save-h"><strong>Your picture</strong><button type="button" class="sh-x" aria-label="Close">&times;</button></div>' +
      '<img src="' + state.blobUrl + '" alt="Your picture"><p>Press and hold the picture, then tap <strong>Save to Photos</strong> or <strong>Download image</strong>.</p>' +
      '<button type="button" class="sh-btn sh-btn-main" data-a="share" hidden>Share it</button>' +
      '<button type="button" class="sh-btn" data-a="copy">Copy the words</button></div>';
    document.body.appendChild(o);
    var close = function () { o.remove(); };
    o.querySelector('.sh-x').onclick = close;
    o.querySelector('[data-a=copy]').onclick = function () { copy($('shCap').value); track('copied'); };
    var sb = o.querySelector('[data-a=share]');
    if (canShareFile(state.file)) { sb.hidden = false; sb.onclick = doShare; }
  }
  function doShare() {
    if (notReady()) return;
    var cap = $('shCap').value;
    copy(cap, true);
    navigator.share({ files: [state.file], text: cap }).then(function () {
      track('shared'); toast('Shared. Thank you!'); showNext();
    }).catch(function (e) { if (!e || e.name !== 'AbortError') toast('Sharing did not open. Tap Save picture instead.'); });
  }
  function doSave() {
    if (notReady()) return;
    track('saved');
    if (isTouchPhone()) { saveOverlay(); showNext(); return; }
    var a = document.createElement('a'); a.href = state.blobUrl; a.download = state.filename;
    document.body.appendChild(a); a.click(); a.remove();
    toast('Downloaded. Now copy the words and post it.');
    showNext();
  }
  function showNext() {
    var others = KINDS.filter(function (k) { return k !== state.kind; });
    var label = { attended: 'I attended', met: 'Who I met', talk: 'A talk', panel: 'A panel' };
    var icon = { attended: 'fa-id-badge', met: 'fa-handshake', talk: 'fa-microphone-lines', panel: 'fa-users' };
    $('shNextKinds').innerHTML = others.map(function (k) {
      return '<button type="button" class="sh-kind" data-next="' + k + '"><i class="fas ' + icon[k] + '" aria-hidden="true"></i><strong>' + label[k] + '</strong></button>';
    }).join('');
    $('shNext').hidden = false;
  }

  // ---------------------------------------------------------------- switching
  function setKind(k, scroll) {
    if (KINDS.indexOf(k) < 0) k = 'attended';
    state.kind = k;
    Array.prototype.forEach.call(document.querySelectorAll('#shKinds .sh-kind'), function (b) { b.setAttribute('aria-checked', String(b.getAttribute('data-kind') === k)); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-for]'), function (el) { el.hidden = el.getAttribute('data-for').split(' ').indexOf(k) < 0; });
    $('shTkLabel').textContent = TAKEAWAY[k].label;
    $('shTk').placeholder = TAKEAWAY[k].ph;
    $('shTk').value = state.takeaway[k];
    $('shTkCount').textContent = state.takeaway[k].length + ' / 140';
    $('shNext').hidden = true;
    drawBgs();
    if (k === 'met') drawPeople();
    try { history.replaceState(null, '', '/share?kind=' + k + (k === 'talk' && state.talkId ? '&talk=' + state.talkId : '') + (k === 'panel' && state.panelId ? '&panel=' + state.panelId : '')); } catch (e) {}
    changed();
    if (scroll) { var f = document.querySelector('.sh-form'); if (f) f.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }
  function setPlatform(p) {
    state.platform = p;
    Array.prototype.forEach.call(document.querySelectorAll('.sh-plat'), function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-plat') === p)); });
    refreshCaption(false);
  }
  function setSize(s) {
    state.size = s;
    Array.prototype.forEach.call(document.querySelectorAll('.sh-tab'), function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-size') === s)); });
    changed();
  }

  // ---------------------------------------------------------------- wiring
  function wire() {
    $('shKinds').addEventListener('click', function (e) { var b = e.target.closest('.sh-kind'); if (b) setKind(b.getAttribute('data-kind')); });
    $('shKinds').addEventListener('keydown', function (e) {
      if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].indexOf(e.key) < 0) return;
      e.preventDefault();
      var i = KINDS.indexOf(state.kind) + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1);
      setKind(KINDS[(i + KINDS.length) % KINDS.length]);
      var b = document.querySelector('#shKinds [data-kind="' + state.kind + '"]'); if (b) b.focus();
    });
    $('shNextKinds').addEventListener('click', function (e) { var b = e.target.closest('[data-next]'); if (b) setKind(b.getAttribute('data-next'), true); });
    document.querySelector('.sh-tabs').addEventListener('click', function (e) { var b = e.target.closest('.sh-tab'); if (b) setSize(b.getAttribute('data-size')); });
    document.querySelector('.sh-plats').addEventListener('click', function (e) { var b = e.target.closest('.sh-plat'); if (b) setPlatform(b.getAttribute('data-plat')); });

    $('shTalk').addEventListener('change', function () { state.talkId = this.value; syncTopic(); setKind('talk'); });
    $('shTopic').addEventListener('input', function () { state.topic = this.value; changed(); });
    $('shPanel').addEventListener('change', function () { state.panelId = this.value; if (state.bg.panel !== 'own') state.bg.panel = 'panel'; setKind('panel'); });
    $('shTk').addEventListener('input', function () { state.takeaway[state.kind] = this.value; $('shTkCount').textContent = this.value.length + ' / 140'; changed(); });
    ['shName', 'shTitle', 'shCompany'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        state.me[{ shName: 'name', shTitle: 'title', shCompany: 'company' }[id]] = this.value;
        if (state.user) $('shMeSum').textContent = 'Your name on the picture: ' + state.me.name;
        changed();
      });
    });
    $('shShowPass').addEventListener('change', function () { state.showPass = this.checked; changed(); });
    $('shMePhotoBtn').addEventListener('click', function () { pickPhoto($('shMePhoto'), function (c) { state.mePhoto = c; refreshMePhoto(); changed(); }); });
    $('shMetPhotoBtn').addEventListener('click', function () {
      pickPhoto($('shMetPhoto'), function (c) {
        state.metPhoto = c;
        $('shMetPhotoTitle').textContent = 'Photo added. Tap to change it';
        $('shMetPhotoNote').textContent = 'It stays on your phone.';
        $('shMetPhotoClear').hidden = false;
        changed();
      });
    });
    $('shMetPhotoClear').addEventListener('click', function () {
      state.metPhoto = null; this.hidden = true;
      $('shMetPhotoTitle').textContent = 'Choose a photo';
      $('shMetPhotoNote').textContent = 'No photo? Leave it: we put your two profile photos side by side.';
      changed();
    });
    $('shBgs').addEventListener('click', function (e) {
      var b = e.target.closest('.sh-bg'); if (!b) return;
      var id = b.getAttribute('data-bg');
      if (id === 'own') {
        pickPhoto($('shOwnBg'), function (c) { state.ownBg = c; state.bg[state.kind] = 'own'; drawBgs(); changed(); });
        return;
      }
      state.bg[state.kind] = id; drawBgs(); changed();
    });
    $('shPeople').addEventListener('input', function (e) {
      var inp = e.target, box = inp.closest('.sh-person'); if (!box) return;
      var i = Number(box.getAttribute('data-i')), f = inp.getAttribute('data-f');
      state.people[i][f] = inp.value;
      if (f === 'name') { state.people[i].photo = ''; var im = box.querySelector('.sh-person-h img'); if (im) im.remove(); showSugg(inp, i); }
      changed();
    });
    $('shPeople').addEventListener('focusout', function (e) {
      var inp = e.target; if (inp.getAttribute('data-f') !== 'name') return;
      setTimeout(function () { var ul = inp.parentNode && inp.parentNode.querySelector('ul'); if (ul && !ul.contains(document.activeElement)) ul.hidden = true; }, 180);
    });
    $('shPeople').addEventListener('click', function (e) {
      var b = e.target.closest('[data-remove]'); if (!b) return;
      state.people.splice(Number(b.getAttribute('data-remove')), 1); drawPeople(); changed();
    });
    $('shAddPerson').addEventListener('click', function () {
      if (state.people.length >= 3) return;
      state.people.push({ name: '', title: '', company: '', photo: '' }); drawPeople();
      var last = $('shPN' + (state.people.length - 1)); if (last) last.focus();
    });

    $('shCap').addEventListener('input', function () { state.edited[state.kind + ':' + state.platform] = true; $('shCapReset').hidden = false; capCount(); $('shOpen').href = PLATFORMS[state.platform].open(this.value); });
    $('shCapReset').addEventListener('click', function () { state.edited[state.kind + ':' + state.platform] = false; refreshCaption(true); });
    $('shShare').addEventListener('click', doShare);
    $('shSave').addEventListener('click', doSave);
    $('shCopy').addEventListener('click', function () { copy($('shCap').value); track('copied'); });
    $('shOpen').addEventListener('click', function () {
      copy($('shCap').value, true);
      track('opened');
      if (state.platform === 'instagram' || state.platform === 'facebook') toast('The words are copied: paste them into your post.');
    });
  }

  // ---------------------------------------------------------------- start
  async function start() {
    wire();
    var q = new URLSearchParams(location.search);
    if (q.get('talk')) state.talkId = q.get('talk');
    if (q.get('panel')) state.panelId = q.get('panel');
    setKind(q.get('kind') || 'attended');
    placeMeFields();

    var progP = fetch('/api/events/1/programme').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    var u = await loadUser();
    if (u) {
      state.user = u;
      state.me = { name: str(u.name), title: str(u.job_title), company: str(u.company), photo: /^(\/|https:\/\/)/.test(String(u.avatar_url || '')) || /^data:image\//.test(String(u.avatar_url || '')) ? u.avatar_url : '',
        pass: MC.passKey(u.badge_type, u.role) };
      // Only a Mumbai 2026 record carries its pass onto a Mumbai card.
      state.showPassAllowed = Number(u.event_id || 1) === 1 && !!MC.PASSES[state.me.pass];
      state.showPass = state.showPassAllowed;
      if (state.me.pass === 'speaker' || state.me.pass === 'exhibitor') $('shKindAttended').textContent = state.me.pass === 'speaker' ? 'I spoke at' : 'We exhibited at';
      loadConnections(u.id).then(function (list) { state.suggestions = state.suggestions.concat(list); });
      track('open', q.get('kind') || 'attended');
    }
    placeMeFields();
    showWho();
    var p = await progP;
    if (p) { buildProgramme(p); fillSelects(); }
    else { $('shTalk').innerHTML = '<option value="">The programme did not load. Reload the page.</option>'; $('shPanel').innerHTML = $('shTalk').innerHTML; }
    if (state.kind === 'panel' && q.get('panel')) state.bg.panel = 'panel';
    setKind(state.kind);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
