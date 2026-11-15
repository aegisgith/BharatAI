/* AI Agent Summit 2027: site behaviour (no dependencies) */
(function () {
  'use strict';
  document.documentElement.classList.add('js');
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var EVENT_START = new Date('2027-04-17T09:00:00+05:30').getTime();
  var EVENT_END = new Date('2027-04-17T19:00:00+05:30').getTime();

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

  /* ---------- Countdown to 9:00 IST, 17 April 2027 ---------- */
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

  /* ---------- Hero console: the agent works through its steps, then replays ---------- */
  var consoleEl = document.querySelector('[data-console]');
  if (consoleEl) {
    var steps = Array.prototype.slice.call(consoleEl.querySelectorAll('.trace li'));
    if (reduceMotion || !steps.length) {
      steps.forEach(function (li) { li.classList.add('on'); });
    } else {
      var shown = 0, onScreen = true, holdTicks = 0;
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (en) { onScreen = en[0].isIntersecting; }).observe(consoleEl);
      }
      setInterval(function () {
        if (!onScreen || document.hidden) return;
        if (shown < steps.length) { steps[shown].classList.add('on'); shown++; return; }
        holdTicks++;
        if (holdTicks >= 9) { // about 8 seconds on the finished trace, then run again
          steps.forEach(function (li) { li.classList.remove('on'); });
          shown = 0; holdTicks = 0;
        }
      }, 900);
    }
  }

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
