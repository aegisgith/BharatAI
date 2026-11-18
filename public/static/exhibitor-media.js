// Admin: an exhibitor's logo and an Innovation Talk speaker's photo, chosen on the
// Edit (and Add exhibitor) screens and saved the moment they are chosen (18 Nov 2026).
// Server: src/routes/exhibitor-media.ts. The app shows the new picture at once; the
// website's exhibitor wall and talk cards follow within a minute: src/routes/site-live.ts
// draws them from the app on every request (scripts/lib/exhibit-site.mjs).
//
// Loaded after /admin.js, whose functions are globals: this file wraps
// openEditExhibitor, openCreateExhibitor, loadAdminExhibitors and editInnovationTalk.
(function () {
  if (typeof window.openEditExhibitor !== 'function') return;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
  function note(msg, kind) { try { toast(msg, kind); } catch (e) { /* no toast on this page */ } }
  function picture(url) {
    var u = String(url || '');
    return /^(https?:\/\/[^\s"'<>]+|\/(api\/uploads|images)\/[^\s"'<>]+)$/.test(u) ? u : '';
  }

  // Any image the browser can open, made a PNG (a logo keeps its see-through parts) or a
  // JPEG (a photo), at most `max` pixels on its long side, so it stays under the 2 MB limit.
  function shrink(file, max, type) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) { reject(new Error('Choose an image file (JPEG, PNG or WebP).')); return; }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * s));
        c.height = Math.max(1, Math.round(img.naturalHeight * s));
        var g = c.getContext('2d');
        if (type === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
        g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL(type, 0.9));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That file could not be opened as an image. iPhone HEIC photos: export as JPEG first.')); };
      img.src = url;
    });
  }

  function pickerHTML(id, label, current, hint, removable) {
    var p = picture(current);
    return '<div id="' + id + '" class="mb-3 p-3 rounded-lg" style="background:rgba(255,255,255,0.04);border:1px dashed rgba(255,255,255,0.15)">'
      + '<label class="text-xs text-gray-400 mb-2 block">' + esc(label) + '</label>'
      + '<div class="flex items-center gap-3 flex-wrap">'
      + '<span data-em="preview" class="inline-flex items-center justify-center rounded-lg" style="width:120px;height:60px;background:#fff;overflow:hidden">'
      + (p ? '<img src="' + esc(p) + '" alt="" style="max-width:112px;max-height:52px;object-fit:contain">' : '<span style="color:#888;font-size:11px">None yet</span>')
      + '</span>'
      + '<input data-em="file" type="file" accept="image/*" class="text-xs">'
      + (removable && p ? '<button type="button" data-em="remove" class="px-2 py-1 rounded text-xs bg-red-500/20 text-red-400">Remove</button>' : '')
      + '</div>'
      + '<p data-em="msg" class="text-[11px] text-gray-400 mt-2">' + esc(hint) + '</p></div>';
  }
  function setPreview(box, url) {
    var p = picture(url);
    box.querySelector('[data-em="preview"]').innerHTML = p ? '<img src="' + esc(p) + '" alt="" style="max-width:112px;max-height:52px;object-fit:contain">' : '<span style="color:#888;font-size:11px">None yet</span>';
  }
  function say(box, msg, bad) { var m = box.querySelector('[data-em="msg"]'); m.textContent = msg; m.style.color = bad ? '#f87171' : ''; }

  // ---- exhibitors ----
  var HINT_EX = 'Saved as soon as you choose it. Shows in the app at once and on the website within a minute.';

  async function uploadLogo(id, file, box) {
    say(box, 'Saving the logo...');
    var image = await shrink(file, 800, 'image/png');
    var r = await api.post('/api/admin/exhibitors/' + id + '/logo', { image: image });
    if (r && r.error) throw new Error(r.error);
    setPreview(box, r.logo_url);
    say(box, 'Logo saved. ' + HINT_EX);
    return r;
  }

  var origEdit = window.openEditExhibitor;
  window.openEditExhibitor = function (ex) {
    origEdit.apply(this, arguments);
    var form = document.getElementById('ef-form');
    if (!form || !ex || !ex.id) return;
    form.insertAdjacentHTML('afterbegin', pickerHTML('em-logo', 'Logo', ex.logo_url, HINT_EX, true));
    var box = document.getElementById('em-logo');
    box.querySelector('[data-em="file"]').addEventListener('change', async function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      try { await uploadLogo(ex.id, f, box); note('Logo saved'); loadAdminExhibitors(); }
      catch (err) { say(box, err.message, true); note('Logo not saved: ' + err.message, 'error'); }
    });
    var rm = box.querySelector('[data-em="remove"]');
    if (rm) rm.addEventListener('click', async function () {
      if (!confirm('Remove the logo of ' + (ex.company_name || 'this exhibitor') + '?')) return;
      try {
        var r = await api.del('/api/admin/exhibitors/' + ex.id + '/logo');
        if (r && r.error) throw new Error(r.error);
        setPreview(box, ''); rm.remove(); say(box, 'Logo removed.'); note('Logo removed'); loadAdminExhibitors();
      } catch (err) { say(box, err.message, true); }
    });
  };

  var origCreate = window.openCreateExhibitor;
  window.openCreateExhibitor = function () {
    origCreate.apply(this, arguments);
    var form = document.getElementById('ef-form');
    if (!form) return;
    form.insertAdjacentHTML('afterbegin', pickerHTML('em-logo', 'Logo', '', 'Uploaded when you press Save. Shows in the app at once and on the website within a minute.', false));
    var box = document.getElementById('em-logo');
    form.onsubmit = async function (e) {
      e.preventDefault();
      try {
        var r = await api.post('/api/admin/exhibitors', getExhibitorForm());
        if (r && r.error) throw new Error(r.error);
        var f = box.querySelector('[data-em="file"]').files[0];
        if (f && r && r.id) {
          try { await uploadLogo(r.id, f, box); }
          catch (err) { note('Exhibitor added, but the logo was not saved: ' + err.message + ' Open Edit to try again.', 'error'); }
        }
        closeModal(); note('Exhibitor added'); loadAdminExhibitors();
      } catch (err) { note('Could not add the exhibitor: ' + err.message, 'error'); }
    };
  };

  // Each exhibitor card shows its logo, so a missing one is plain to see.
  var origLoad = window.loadAdminExhibitors;
  window.loadAdminExhibitors = async function () {
    var r = await origLoad.apply(this, arguments);
    try {
      var list = await api.get('/api/events/' + EID + '/exhibitors');
      var byId = {};
      (Array.isArray(list) ? list : []).forEach(function (x) { byId[x.id] = x; });
      document.querySelectorAll('button[onclick^="deleteExhibitor("]').forEach(function (b) {
        var id = Number((b.getAttribute('onclick').match(/\d+/) || [])[0]);
        var card = b.closest('.glass');
        if (!card || card.querySelector('[data-em-logo]')) return;
        var p = picture(byId[id] && byId[id].logo_url);
        card.insertAdjacentHTML('afterbegin', '<div data-em-logo class="mb-2 inline-flex items-center justify-center rounded" style="height:40px;min-width:80px;padding:4px 8px;background:#fff">'
          + (p ? '<img src="' + esc(p) + '" alt="" style="max-height:32px;max-width:140px;object-fit:contain">' : '<span style="color:#b45309;font-size:11px">No logo</span>') + '</div>');
      });
    } catch (e) { /* the list still works without the pictures */ }
    return r;
  };

  // ---- Innovation Talk speakers ----
  if (typeof window.editInnovationTalk === 'function') {
    var origTalk = window.editInnovationTalk;
    window.editInnovationTalk = async function (id) {
      var r = await origTalk.apply(this, arguments);
      var form = document.getElementById('italk-form');
      var t = typeof italkFind === 'function' ? italkFind(id) : null;
      if (!form || !t) return r;
      form.insertAdjacentHTML('afterbegin', pickerHTML('em-photo', 'Speaker photo (head and shoulders)', t.speaker_photo_url,
        'Saved as soon as you choose it. Shows in the app at once and on the website within a minute.', false));
      var box = document.getElementById('em-photo');
      box.querySelector('[data-em="file"]').addEventListener('change', async function (e) {
        var f = e.target.files && e.target.files[0];
        if (!f) return;
        try {
          say(box, 'Saving the photo...');
          var image = await shrink(f, 900, 'image/jpeg');
          var res = await api.post('/api/admin/innovation-talks/' + id + '/photo', { image: image });
          if (res && res.error) throw new Error(res.error);
          t.speaker_photo_url = res.photo_url;
          setPreview(box, res.photo_url);
          say(box, 'Photo saved. Shows in the app at once and on the website within a minute.');
          note('Photo saved');
          if (typeof loadInnovationTalks === 'function') loadInnovationTalks();
        } catch (err) { say(box, err.message, true); note('Photo not saved: ' + err.message, 'error'); }
      });
      return r;
    };
  }
})();
