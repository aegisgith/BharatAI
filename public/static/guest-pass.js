/* The pass page for a guest the team registered with a mobile number only
 * (16 Nov 2026, src/routes/team-guests.ts). The link reaches them on WhatsApp.
 *
 * The pass is drawn by /js/pass-render.js, the same file the app and the admin panel
 * use, so the desk sees the pass it knows. The picture is built once; "Save the
 * picture" shares it on an iPhone (Save Image) and downloads it everywhere else.
 */
(function () {
  'use strict';
  var data = {};
  try { data = JSON.parse((document.getElementById('gp-data') || {}).textContent || '{}'); } catch (e) { data = {}; }
  var wait = document.getElementById('gp-wait');
  var img = document.getElementById('gp-img');
  var save = document.getElementById('gp-save');
  var hint = document.getElementById('gp-hint');
  if (!wait || !img || !save || !hint) return;

  var ua = navigator.userAgent || '';
  var iOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var result = null, file = null;

  function fail(msg) {
    wait.textContent = msg;
    wait.className = 'gp-wait gp-err';
    wait.hidden = false;
  }
  function say(msg) { hint.textContent = msg; hint.hidden = false; }

  if (!data.pass || !data.token || !window.BhaiPass) {
    fail('Your pass could not be drawn. Check your internet, then open the link again.');
    return;
  }

  window.BhaiPass.render(data.pass, { token: data.token }).then(function (res) {
    if (!res || res.qrFailed || !res.dataUrl) {
      fail('Your pass could not be drawn. Check your internet, then open the link again.');
      return;
    }
    result = res;
    img.src = res.dataUrl;
    img.hidden = false;
    wait.hidden = true;
    save.hidden = false;
    say(iOS ? 'Or press and hold the picture, then tap Save to Photos.' : 'Or press and hold the picture to save it.');
    // Made now, so the share sheet opens inside the tap: an iPhone refuses a share
    // that waits on anything after the tap.
    try {
      fetch(res.dataUrl).then(function (r) { return r.blob(); }).then(function (b) {
        try { file = new File([b], res.filename, { type: 'image/png' }); } catch (e) { file = null; }
      }).catch(function () {});
    } catch (e) { /* the download below still works */ }
  }).catch(function () {
    fail('Your pass could not be drawn. Check your internet, then open the link again.');
  });

  save.addEventListener('click', function () {
    if (!result) return;
    if (iOS && file && navigator.canShare && navigator.share) {
      var share = { files: [file], title: 'My Bharat AI Innovation pass' };
      try {
        if (navigator.canShare(share)) {
          navigator.share(share).catch(function () {});
          return;
        }
      } catch (e) { /* fall through to the download */ }
    }
    var a = document.createElement('a');
    a.href = result.dataUrl;
    a.download = result.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    say(iOS ? 'Saved to Files. To have it in Photos, press and hold the picture and tap Save to Photos.'
      : 'Saved to your phone’s downloads. Open it from your gallery or Files at the entry desk.');
  });
})();
