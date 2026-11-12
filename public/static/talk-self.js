/* /app/my-talk: a speaker fills in their own Innovation Talk details (12 Nov 2026).
 * The link in the "a few details we need" email carries ?t=<signed token>; the server
 * is src/routes/talk-self.ts. No sign-in: the token names the talk, so the link still
 * works when the booth contact forwards the email to the speaker. */
(function () {
  'use strict';
  var root = document.getElementById('ts-root');
  var token = '';
  try { token = new URLSearchParams(location.search).get('t') || ''; } catch (e) {}
  var S = { talk: null, photo: null, saved: false };

  // The same words the email uses (ITALK_ASK in src/index.tsx), so the two agree.
  var ASK = [
    { k: 'speaker_photo_url', label: 'A clear photo of you', why: 'Head and shoulders. It is shown beside your talk in the event app.' },
    { k: 'topic', label: 'The title of your talk', why: 'It goes in the programme and in the event app.', max: 200 },
    { k: 'speaker_title', label: 'Your designation', why: 'It is shown under your name in the programme.', max: 120 },
    { k: 'company', label: 'Your company name, as it should be shown', why: 'It is shown with your talk in the programme and on your pass.', max: 120 },
    { k: 'speaker_bio', label: 'Two or three lines about you', why: 'The host reads this out to introduce you on stage.', max: 800, area: true },
    { k: 'speaker_phone', label: 'Your mobile number', why: 'We use it only on the day, if your time or stage changes.', max: 30, tel: true },
    { k: 'showcase', label: 'What you will show on stage', why: 'A line or two about the product or demo you will present. Optional.', max: 1000, area: true, optional: true },
  ];

  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function $(id) { return document.getElementById(id); }
  function initial(n) { return (String(n || '').replace(/^(dr|mr|mrs|ms|prof|shri|smt)\.?\s+/i, '').trim().charAt(0) || '?').toUpperCase(); }

  function fail(msg) {
    root.innerHTML = '<div class="ts-card"><p class="ts-kicker">Your Innovation Talk</p><h1>We could not open this page</h1><p class="ts-sub">' + esc(msg) + '</p></div>';
  }

  async function load() {
    if (!token) { fail('This link is not complete. Open it again from the email, or reply to the email for a new one.'); return; }
    var r, j;
    try { r = await fetch('/api/talk-self/' + encodeURIComponent(token), { cache: 'no-store' }); j = await r.json(); }
    catch (e) { fail('There is no connection just now. Please try again in a moment.'); return; }
    if (!r.ok) { fail((j && j.error) || 'This link is not right.'); return; }
    S.talk = j.talk;
    render();
  }

  function progress(t) {
    var need = ['speaker_photo_url', 'topic', 'speaker_title', 'company', 'speaker_bio', 'speaker_phone'];
    var have = need.filter(function (k) { return String(t[k] || '').trim(); }).length;
    return { have: have, of: need.length };
  }

  function render() {
    var t = S.talk;
    var p = progress(t);
    var missing = t.missing || [];
    var head =
      '<div class="ts-card"><p class="ts-kicker">Your Innovation Talk</p>' +
      '<h1>' + esc(t.speaker_name || 'Your talk') + '</h1>' +
      '<p class="ts-sub">' + esc([t.speaker_title, t.company].filter(Boolean).join(', ')) + '</p>' +
      '<dl class="ts-facts">' +
        '<dt>Talk</dt><dd>' + (t.topic ? esc(t.topic) : '<span class="ts-later">Your title, below</span>') + '</dd>' +
        '<dt>When</dt><dd>' + (t.when ? esc(t.when) : '<span class="ts-later">We will send you the time soon</span>') + '</dd>' +
        '<dt>Where</dt><dd>' + (t.where ? esc(t.where) : '<span class="ts-later">We will confirm the stage soon</span>') + '</dd>' +
      '</dl>' +
      '<div class="ts-progress" aria-label="' + p.have + ' of ' + p.of + ' details in"><div class="ts-bar"><i style="width:' + Math.round(p.have * 100 / p.of) + '%"></i></div><b>' + p.have + ' of ' + p.of + ' details in</b></div>' +
      '</div>';
    var done = S.saved
      ? '<div class="ts-done" role="status"><b>Thank you, it is saved.</b> ' + (missing.length ? 'It is in the programme now. ' + missing.length + ' thing' + (missing.length === 1 ? ' is' : 's are') + ' still to fill in below.' : 'Everything is in. You can come back to this page to change anything until the event.') + '</div>'
      : (missing.length ? '' : '<div class="ts-done">Everything is in. Thank you. You can change anything here until the event.</div>');
    var form = '<form id="ts-form" class="ts-card" novalidate><div id="ts-formerr"></div>' + ASK.map(field).join('') +
      '<button type="submit" class="ts-save" id="ts-save">Save my details</button>' +
      '<p class="ts-small">It goes straight into the programme. Time and stage are set by the organisers.</p></form>';
    root.innerHTML = head + done + form;
    $('ts-form').addEventListener('submit', function (e) { e.preventDefault(); save(); });
    var file = $('ts-file');
    if (file) file.addEventListener('change', function () { pickPhoto(file.files && file.files[0]); });
    ASK.forEach(function (a) {
      var el = $('ts-' + a.k);
      if (el && a.max) el.addEventListener('input', function () { var c = $('ts-c-' + a.k); if (c) c.textContent = el.value.length + ' / ' + a.max; el.removeAttribute('aria-invalid'); var m = $('ts-m-' + a.k); if (m) m.textContent = ''; });
    });
  }

  function badge(a) {
    var has = a.k === 'speaker_photo_url' ? !!(S.photo || S.talk.speaker_photo_url) : !!String(S.talk[a.k] || '').trim();
    if (a.optional) return '';
    return has ? '<span class="ts-have">In</span>' : '<span class="ts-need">Needed</span>';
  }

  function field(a) {
    var t = S.talk;
    if (a.k === 'speaker_photo_url') {
      var src = S.photo || t.speaker_photo_url;
      return '<div class="ts-f"><span class="ts-lbl">' + esc(a.label) + ' ' + badge(a) + '</span><p class="ts-why">' + esc(a.why) + '</p>' +
        '<div class="ts-photo"><span id="ts-ava">' + (src ? '<img class="ts-ava" src="' + esc(src) + '" alt="Your photo">' : '<span class="ts-ava" aria-hidden="true">' + esc(initial(t.speaker_name)) + '</span>') + '</span>' +
        '<label class="ts-filebtn">' + (src ? 'Change photo' : 'Choose a photo') + '<input type="file" id="ts-file" accept="image/jpeg,image/png,image/webp"></label></div>' +
        '<div class="ts-fieldmsg" id="ts-m-speaker_photo_url"></div></div>';
    }
    var v = t[a.k] || '';
    var input = a.area
      ? '<textarea class="ts-in" id="ts-' + a.k + '" name="' + a.k + '" maxlength="' + a.max + '" rows="4">' + esc(v) + '</textarea>'
      : '<input class="ts-in" id="ts-' + a.k + '" name="' + a.k + '" maxlength="' + a.max + '" value="' + esc(v) + '"' + (a.tel ? ' type="tel" inputmode="tel" autocomplete="tel"' : ' type="text"') + '>';
    return '<div class="ts-f"><label for="ts-' + a.k + '">' + esc(a.label) + ' ' + badge(a) + '</label><p class="ts-why">' + esc(a.why) + '</p>' + input +
      (a.area ? '<div class="ts-count" id="ts-c-' + a.k + '">' + String(v).length + ' / ' + a.max + '</div>' : '') +
      '<div class="ts-fieldmsg" id="ts-m-' + a.k + '"></div></div>';
  }

  // Square from the centre, 600px, JPEG: what the app and the website draw.
  function squarePhoto(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) { reject(new Error('Choose a JPEG, PNG or WebP photo.')); return; }
      if (file.size > 20 * 1024 * 1024) { reject(new Error('That file is over 20 MB. Choose a smaller photo.')); return; }
      var fr = new FileReader();
      fr.onload = function () {
        var img = new Image();
        img.onload = function () {
          var side = Math.min(img.width, img.height), out = Math.min(600, side);
          if (out < 200) { reject(new Error('That photo is too small. Choose one at least 200 pixels across.')); return; }
          var cv = document.createElement('canvas'); cv.width = out; cv.height = out;
          var ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, out, out);
          ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, out, out);
          resolve(cv.toDataURL('image/jpeg', 0.86));
        };
        img.onerror = function () { reject(new Error('That file could not be read as a photo.')); };
        img.src = fr.result;
      };
      fr.onerror = function () { reject(new Error('That file could not be read.')); };
      fr.readAsDataURL(file);
    });
  }
  function pickPhoto(file) {
    var m = $('ts-m-speaker_photo_url');
    squarePhoto(file).then(function (dataUrl) {
      S.photo = dataUrl;
      $('ts-ava').innerHTML = '<img class="ts-ava" src="' + dataUrl + '" alt="Your photo">';
      if (m) { m.style.color = '#15803D'; m.textContent = 'Ready. Press Save my details to send it.'; }
    }, function (e) { if (m) { m.style.color = ''; m.textContent = e.message; } });
  }

  function values() {
    var out = {};
    ASK.forEach(function (a) { var el = $('ts-' + a.k); if (el && a.k !== 'speaker_photo_url') out[a.k] = el.value; });
    return out;
  }
  // Only the boxes they changed are checked: what the organisers typed is not theirs to fix.
  function changed(v, k) { return String(v[k] || '').replace(/\r\n/g, '\n').trim() !== String(S.talk[k] || '').trim(); }
  function check(v) {
    var digits = String(v.speaker_phone || '').replace(/\D/g, '');
    if (changed(v, 'speaker_phone') && v.speaker_phone && (digits.length < 10 || digits.length > 15)) return { k: 'speaker_phone', msg: 'Type a mobile number with at least 10 digits.' };
    if (changed(v, 'speaker_bio') && /https?:\/\/|<\s*\w/i.test(String(v.speaker_bio || ''))) return { k: 'speaker_bio', msg: 'Please write the lines about you as plain text, with no links.' };
    return null;
  }
  function showFieldError(k, msg) {
    var el = $('ts-' + k), m = $('ts-m-' + k);
    if (el) { el.setAttribute('aria-invalid', 'true'); el.focus(); }
    if (m) m.textContent = msg;
  }

  async function save() {
    var v = values();
    var bad = check(v);
    if (bad) { showFieldError(bad.k, bad.msg); return; }
    var btn = $('ts-save'); btn.disabled = true; btn.textContent = 'Saving…';
    var err = $('ts-formerr');
    try {
      var r = await fetch('/api/talk-self/' + encodeURIComponent(token), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok) {
        btn.disabled = false; btn.textContent = 'Save my details';
        if (j.field) showFieldError(j.field, j.error); else err.innerHTML = '<div class="ts-err">' + esc(j.error || 'It did not save. Please try again.') + '</div>';
        return;
      }
      if (S.photo) {
        var pr = await fetch('/api/talk-self/' + encodeURIComponent(token) + '/photo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: S.photo }) });
        var pj = await pr.json().catch(function () { return {}; });
        if (!pr.ok) {
          S.talk = j.talk; S.saved = true; render();
          $('ts-formerr').innerHTML = '<div class="ts-err">Your details are saved, but the photo was not: ' + esc(pj.error || 'please try it again.') + '</div>';
          return;
        }
        j.talk.speaker_photo_url = pj.speaker_photo_url;
        j.talk.missing = (j.talk.missing || []).filter(function (k) { return k !== 'speaker_photo_url'; });
        S.photo = null;
      }
      S.talk = j.talk; S.saved = true;
      render();
      window.scrollTo(0, 0);
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Save my details';
      err.innerHTML = '<div class="ts-err">There is no connection just now. Nothing was lost: press Save again in a moment.</div>';
    }
  }

  load();
})();
