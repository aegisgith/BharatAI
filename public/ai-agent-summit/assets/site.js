/* AI Agent Summit 2027: site behaviour (no dependencies) */
(function () {
  'use strict';
  document.documentElement.classList.add('js');
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var EVENT_START = new Date('2027-04-16T09:00:00+05:30').getTime();
  var EVENT_END = new Date('2027-04-16T19:00:00+05:30').getTime();

  /* ---------- Mobile nav ---------- */
  var nav = document.querySelector('.nav');
  var toggle = document.querySelector('.nav-toggle');
  if (nav && toggle) {
    var setOpen = function (open) {
      nav.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    };
    toggle.addEventListener('click', function () { setOpen(!nav.classList.contains('open')); });
    nav.querySelectorAll('.nav-links a').forEach(function (a) { a.addEventListener('click', function () { setOpen(false); }); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('open')) { setOpen(false); toggle.focus(); }
    });
  }

  /* ---------- Reveal on scroll (IntersectionObserver, no scroll listeners) ---------- */
  var revealEls = document.querySelectorAll('.reveal');
  if (!reduceMotion && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('in'); });
  }

  /* ---------- Countdown to 9:00 IST, 16 April 2027 ---------- */
  var cd = document.querySelector('[data-countdown]');
  if (cd) {
    var dEl = cd.querySelector('[data-d]');
    var hEl = cd.querySelector('[data-h]');
    var mEl = cd.querySelector('[data-m]');
    var label = document.querySelector('[data-countdown-label]');
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var paint = function () {
      var now = Date.now();
      if (now >= EVENT_START) {
        cd.hidden = true;
        if (label) label.textContent = now <= EVENT_END ? 'Happening today at WTC Mumbai' : 'Thank you for joining us';
        return false;
      }
      var s = Math.floor((EVENT_START - now) / 1000);
      dEl.textContent = Math.floor(s / 86400);
      hEl.textContent = pad(Math.floor((s % 86400) / 3600));
      mEl.textContent = pad(Math.floor((s % 3600) / 60));
      return true;
    };
    if (paint()) setInterval(paint, 20000);
  }

  // Calls back with true when the element is on screen, false when it leaves (always true without IntersectionObserver).
  var watchOnScreen = function (el, cb) {
    if (!('IntersectionObserver' in window)) { cb(true); return; }
    new IntersectionObserver(function (en) { cb(en[0].isIntersecting); }, { threshold: 0.15 }).observe(el);
  };
  var whenLoaded = function (fn) { if (document.readyState === 'complete') fn(); else window.addEventListener('load', fn); };
  var loadImg = function (img) {
    var src = img && img.getAttribute('data-src');
    if (src) { img.src = src; img.removeAttribute('data-src'); }
  };

  /* ---------- Hero photos: one stage after another (26 Nov 2026) ----------
     The fill of the current bar is a CSS animation; when it ends, the next photo comes in.
     Pausing (the button, the hero off screen, the tab hidden) pauses that animation,
     so the timing stops with it. With reduced motion nothing moves on its own. */
  var show = document.querySelector('[data-slideshow]');
  if (show) {
    var slides = show.querySelectorAll('.show-slide');
    var ticks = show.querySelectorAll('.tick');
    var ambs = document.querySelectorAll('.hero-amb img');
    var cap = show.querySelector('[data-show-cap]');
    var pauseBtn = show.querySelector('.show-pause');
    var cur = 0, userPaused = false, showVisible = true;
    var syncPause = function () { show.classList.toggle('is-paused', userPaused || !showVisible || document.hidden); };
    var go = function (n) {
      n = (n + slides.length) % slides.length;
      if (n === cur) return;
      loadImg(slides[n].querySelector('img'));
      loadImg(slides[(n + 1) % slides.length].querySelector('img'));
      slides.forEach(function (s, i) {
        s.classList.toggle('is-out', i === cur);
        s.classList.toggle('is-on', i === n);
        s.setAttribute('aria-hidden', i === n ? 'false' : 'true');
      });
      ticks.forEach(function (t, i) {
        t.classList.toggle('is-on', i === n);
        t.classList.toggle('is-done', i < n);
        if (i === n) t.setAttribute('aria-current', 'true'); else t.removeAttribute('aria-current');
      });
      ambs.forEach(function (a, i) { loadImg(a); a.classList.toggle('is-on', i === n); });
      if (cap) cap.textContent = slides[n].getAttribute('data-caption') || '';
      cur = n;
    };
    ticks.forEach(function (t, i) { t.addEventListener('click', function () { go(i); }); });
    show.addEventListener('animationend', function (e) { if (e.animationName === 'tick-fill') go(cur + 1); });
    if (pauseBtn) {
      pauseBtn.addEventListener('click', function () {
        userPaused = !userPaused;
        pauseBtn.setAttribute('aria-pressed', userPaused ? 'true' : 'false');
        pauseBtn.setAttribute('aria-label', userPaused ? 'Play the photos' : 'Pause the photos');
        syncPause();
      });
    }
    watchOnScreen(show, function (on) { showVisible = on; syncPause(); });
    document.addEventListener('visibilitychange', syncPause);
    // The first photo is in the page; the second and the small backdrops come after the page has loaded.
    whenLoaded(function () { loadImg(slides[1] && slides[1].querySelector('img')); ambs.forEach(loadImg); });
  }

  /* ---------- Hero agent card: an example agent works through its task ----------
     The page arrives with the first example finished, so nothing flashes; the script
     holds it, then plays the next example step by step. The clock counts down a
     seven-minute demo, the way the timer on stage does. */
  var run = document.querySelector('[data-run]');
  if (run) {
    var cases = run.querySelectorAll('.run-case');
    var tabs = run.querySelectorAll('.run-tabs button');
    var clockEl = run.querySelector('[data-run-clock]');
    var ci = 0, si = 0, runTimer = null, runVisible = false, left = 7 * 60;
    var stepsOf = function (c) { return c.querySelectorAll('.run-steps li'); };
    var resetCase = function (c) {
      stepsOf(c).forEach(function (li) { li.classList.remove('doing', 'ok'); });
      c.querySelector('.run-out').classList.remove('on');
    };
    var finishCase = function (c) {
      stepsOf(c).forEach(function (li) { li.classList.remove('doing'); li.classList.add('ok'); });
      c.querySelector('.run-out').classList.add('on');
    };
    var showCase = function (n) {
      cases.forEach(function (c, i) { c.classList.toggle('is-on', i === n); c.setAttribute('aria-hidden', i === n ? 'false' : 'true'); });
      tabs.forEach(function (t, i) { t.setAttribute('aria-pressed', i === n ? 'true' : 'false'); });
      ci = n;
    };
    var step = function () {
      runTimer = null;
      if (!runVisible || document.hidden) return;
      var c = cases[ci], steps = stepsOf(c);
      if (si < steps.length) {
        if (si > 0) { steps[si - 1].classList.remove('doing'); steps[si - 1].classList.add('ok'); }
        steps[si].classList.add('doing');
        si++;
        runTimer = setTimeout(step, 1000 + Math.round(Math.random() * 600));
        return;
      }
      if (si === steps.length) { finishCase(c); si++; runTimer = setTimeout(step, 3600); return; }
      var n = (ci + 1) % cases.length;
      resetCase(cases[n]); showCase(n); si = 0;
      runTimer = setTimeout(step, 650);
    };
    var resume = function (delay) { if (!runTimer && runVisible && !document.hidden) runTimer = setTimeout(step, delay); };

    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () {
        if (runTimer) { clearTimeout(runTimer); runTimer = null; }
        if (reduceMotion) { showCase(i); return; }
        resetCase(cases[i]); showCase(i); si = 0;
        resume(350);
      });
    });

    if (!reduceMotion) {
      finishCase(cases[0]);
      si = stepsOf(cases[0]).length + 1; // the first example is shown finished: hold it, then move on
      run.classList.add('is-live');
      watchOnScreen(run, function (on) { runVisible = on; if (on) resume(2600); });
      document.addEventListener('visibilitychange', function () { if (!document.hidden) resume(400); });
      setInterval(function () {
        if (!runVisible || document.hidden) return;
        left = left > 0 ? left - 1 : 7 * 60;
        var m = Math.floor(left / 60), s = left % 60;
        clockEl.textContent = '0' + m + ':' + (s < 10 ? '0' : '') + s;
      }, 1000);
    }
  }

  /* ---------- Networking app: five steps, the phone plays each one ----------
     As with the hero photos, the bar under the current step is a CSS animation and its end
     moves to the next step, so pausing the animation pauses the tour. */
  var appSteps = document.querySelector('[data-app-steps]');
  var appScreen = document.querySelector('[data-app-screen]');
  if (appSteps && appScreen) {
    var aBtns = appSteps.querySelectorAll('button');
    var aNow = document.querySelector('[data-app-now]');
    var aCur = 0, aVisible = true;
    var aGo = function (n) {
      n = (n + aBtns.length) % aBtns.length;
      aBtns.forEach(function (b, i) { b.classList.toggle('is-on', i === n); b.setAttribute('aria-pressed', i === n ? 'true' : 'false'); });
      appScreen.setAttribute('data-step', String(n + 1));
      if (aNow) aNow.textContent = 'Step ' + (n + 1) + ' of ' + aBtns.length + ': ' + aBtns[n].querySelector('b').firstChild.textContent.trim();
      aCur = n;
    };
    aBtns.forEach(function (b, i) { b.addEventListener('click', function () { aGo(i); }); });
    appSteps.addEventListener('animationend', function (e) { if (e.animationName === 'app-fill') aGo(aCur + 1); });
    var aSync = function () { appSteps.classList.toggle('is-paused', !aVisible || document.hidden); };
    watchOnScreen(appScreen, function (on) { aVisible = on; aSync(); });
    document.addEventListener('visibilitychange', aSync);
  }

  /* ---------- Five kinds of agent: each drawing plays its items in order, holds, and plays again ----------
     Items carry data-s; the container carries data-seq (data-tick = ms between items).
     Items are only hidden once a play begins, so without the script, or with reduced motion,
     every drawing simply shows its finished state. */
  document.querySelectorAll('[data-seq]').forEach(function (root) {
    if (reduceMotion) return;
    var items = root.querySelectorAll('[data-s]');
    var gap = parseInt(root.getAttribute('data-tick'), 10) || 900;
    var k = 0, t = null, visible = false, started = false;
    var next = function () {
      t = null;
      if (!visible || document.hidden) return;
      if (k < items.length) { items[k].classList.add('on'); k++; t = setTimeout(next, gap); return; }
      root.classList.add('done');
      t = setTimeout(function () {
        // Fade the whole drawing out, clear it without transitions, fade the empty frame back, play again.
        root.classList.add('fade');
        t = setTimeout(function () {
          root.classList.add('snap');
          items.forEach(function (el) { el.classList.remove('on'); });
          root.classList.remove('done');
          void root.offsetWidth;
          root.classList.remove('snap', 'fade');
          k = 0;
          t = setTimeout(next, 500);
        }, 320);
      }, 5200);
    };
    watchOnScreen(root, function (on) {
      visible = on;
      root.classList.toggle('live', on);
      if (on && !started) {
        // Clear the finished drawing at once (no fade) as it comes into view, then play it.
        started = true;
        root.classList.add('snap', 'seq');
        void root.offsetWidth;
        root.classList.remove('snap');
        t = setTimeout(next, 250);
        return;
      }
      if (on && !t) t = setTimeout(next, 250);
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden && visible && !t) t = setTimeout(next, 250); });
  });

  /* ---------- Forms ---------- */
  var params = new URLSearchParams(window.location.search);

  document.querySelectorAll('form[data-endpoint]').forEach(function (form) {
    var endpoint = form.getAttribute('data-endpoint');
    var statusEl = form.querySelector('.form-status');
    var submit = form.querySelector('button[type="submit"]');
    var success = document.getElementById(form.getAttribute('data-success'));

    // Preselect from the URL, e.g. /showcase?package=growth or /attend?pass=buyer
    ['package', 'pass', 'kind', 'tier'].forEach(function (name) {
      var val = params.get(name);
      if (!val || !/^[a-z0-9-]{1,40}$/i.test(val)) return;
      var radio = form.querySelector('input[type="radio"][name="' + name + '"][value="' + val + '"]');
      if (radio) { radio.checked = true; return; }
      var sel = form.querySelector('select[name="' + name + '"]');
      if (sel && sel.querySelector('option[value="' + val + '"]')) sel.value = val;
    });

    // A field that belongs to one choice, e.g. data-when="package=custom": shown, enabled
    // and required only while that choice is picked (a disabled field is not sent).
    var whens = form.querySelectorAll('[data-when]');
    var syncWhen = function () {
      whens.forEach(function (box) {
        var kv = box.getAttribute('data-when').split('=');
        var picked = form.querySelector('input[name="' + kv[0] + '"]:checked');
        var on = !!picked && picked.value === kv[1];
        box.hidden = !on;
        box.querySelectorAll('input, select, textarea').forEach(function (el) { el.disabled = !on; el.required = on; });
      });
    };
    if (whens.length) { form.addEventListener('change', syncWhen); syncWhen(); }

    form.querySelectorAll('textarea[maxlength]').forEach(function (ta) {
      var c = ta.parentNode.querySelector('.counter');
      if (!c) return;
      var max = ta.getAttribute('maxlength');
      var upd = function () { c.textContent = ta.value.length + ' / ' + max; };
      ta.addEventListener('input', upd); upd();
    });

    form.addEventListener('input', function (e) {
      var f = e.target.closest('.field');
      if (f) f.classList.remove('invalid');
    });
    form.addEventListener('change', function (e) {
      var f = e.target.closest('.field');
      if (f) f.classList.remove('invalid');
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      form.querySelectorAll('.field.invalid').forEach(function (f) { f.classList.remove('invalid'); });
      if (statusEl) { statusEl.className = 'form-status'; statusEl.textContent = ''; }

      var firstBad = null;
      form.querySelectorAll('input, select, textarea').forEach(function (el) {
        if (el.closest('.hp') || el.checkValidity()) return;
        var group = el.closest('.field');
        if (group && !group.classList.contains('invalid')) showError(group, el.getAttribute('data-msg') || el.validationMessage);
        if (!firstBad) firstBad = el;
      });
      if (firstBad) {
        firstBad.focus({ preventScroll: true });
        firstBad.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
        return;
      }

      var data = {};
      new FormData(form).forEach(function (value, key) {
        if (key in data) data[key] = [].concat(data[key], value);
        else data[key] = value;
      });

      submit.setAttribute('aria-busy', 'true');
      var original = submit.innerHTML;
      submit.textContent = 'Sending';

      fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(data),
      })
        .then(function (res) { return res.json().catch(function () { return { ok: false, error: 'Unexpected response from the server (' + res.status + ').' }; }); })
        .then(function (out) {
          if (out && out.ok) {
            // A paid pass: the server made the order; secure checkout opens on bharataiinnovation.com.
            if (out.pay_url) { submit.textContent = 'Opening secure checkout'; window.location.href = out.pay_url; return; }
            if (success) {
              var msg = success.querySelector('[data-msg]');
              var ref = success.querySelector('[data-ref]');
              if (msg) msg.textContent = out.message || '';
              if (ref) ref.textContent = out.reference ? 'Reference ' + out.reference : '';
              form.hidden = true;
              success.classList.add('show');
              success.setAttribute('tabindex', '-1');
              success.focus({ preventScroll: true });
              success.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
            }
            return;
          }
          var focusEl = null;
          ((out && out.errors) || []).forEach(function (er) {
            var el = form.querySelector('[name="' + er.field + '"]');
            var group = el && el.closest('.field');
            if (group) { showError(group, er.message); if (!focusEl) focusEl = el; }
          });
          if (statusEl) {
            statusEl.className = 'form-status error';
            statusEl.textContent = (out && out.error) || 'Something went wrong. Please try again.';
          }
          if (focusEl) focusEl.focus();
        })
        .catch(function () {
          if (statusEl) {
            statusEl.className = 'form-status error';
            statusEl.textContent = 'We could not reach the server. Check your connection and try again, or email info@bharataiinnovation.com.';
          }
        })
        .then(function () {
          submit.removeAttribute('aria-busy');
          submit.innerHTML = original;
        });
    });
  });

  function showError(group, message) {
    group.classList.add('invalid');
    var err = group.querySelector('.err');
    if (!err) { err = document.createElement('span'); err.className = 'err'; err.setAttribute('role', 'alert'); group.appendChild(err); }
    err.textContent = message;
  }

  /* ---------- Thanks page (target of the no-JavaScript form fallback) ---------- */
  var thanksRef = document.querySelector('[data-thanks-ref]');
  if (thanksRef) {
    var r = params.get('ref');
    if (r && /^AAS27-[A-Z]-[A-Z0-9]{6}$/.test(r)) thanksRef.textContent = 'Reference ' + r;
  }
})();
