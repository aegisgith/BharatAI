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

  /* ---------- Home hero: one stage photo after another, every seven seconds (27 Nov 2026) ----------
     The first photo is in the page; each next one loads a slide ahead. Off screen or in a
     hidden tab nothing changes, and with reduced motion the first photo stays. */
  // A slide marked data-wide is too busy at phone size, so phones skip it.
  var arenaNarrow = window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
  var arenaSlides = [].filter.call(document.querySelectorAll('.arena-slide'), function (s) { return !(arenaNarrow && s.hasAttribute('data-wide')); });
  if (arenaSlides.length > 1 && !reduceMotion) {
    var arenaCap = document.querySelector('.arena-cap');
    var arenaCur = 0, arenaOn = true, arenaTimer = null;
    var arenaLoad = function (s) {
      s.querySelectorAll('img[data-src]').forEach(function (i) { i.src = i.getAttribute('data-src'); i.removeAttribute('data-src'); });
    };
    var arenaNext = function () {
      var prev = arenaSlides[arenaCur];
      arenaCur = (arenaCur + 1) % arenaSlides.length;
      var s = arenaSlides[arenaCur];
      arenaLoad(arenaSlides[(arenaCur + 1) % arenaSlides.length]);
      prev.classList.remove('is-on'); prev.classList.add('is-out');
      s.classList.remove('is-out'); s.classList.add('is-on');
      setTimeout(function () { prev.classList.remove('is-out'); }, 1800);
      if (arenaCap) arenaCap.textContent = s.getAttribute('data-cap');
    };
    var arenaTick = function () { arenaTimer = setTimeout(function () { if (arenaOn && !document.hidden) arenaNext(); arenaTick(); }, 7000); };
    whenLoaded(function () { arenaLoad(arenaSlides[1]); arenaTick(); });
    watchOnScreen(document.querySelector('.hero-arena'), function (on) { arenaOn = on; });
  }

  /* ---------- Home: the menu sits clear over the hero photo until the page scrolls (27 Nov 2026) ---------- */
  if (nav && document.querySelector('.hero-arena')) {
    var clearNav = function () { nav.classList.toggle('is-clear', window.scrollY < 24); };
    clearNav();
    window.addEventListener('scroll', clearNav, { passive: true });
  }

  /* ---------- Agent card (beside the stage photo in "What a selected company gets") ----------
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
  /* ---------- On the day (26 Nov 2026): the problem board, the voting page, the hall screen, the report ---------- */
  var getJSON = function (url) {
    return fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' }).then(function (r) { return r.json(); });
  };
  var escH = function (v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; });
  };

  // The board shows the problems the team has published; until there are any, the examples stay.
  var board = document.querySelector('[data-board]');
  var boardList = document.querySelector('[data-board-list]');
  if (board || boardList) {
    getJSON('/api/agent-summit/problems').then(function (j) {
      var list = (j && j.problems) || [];
      if (boardList) boardList.innerHTML = list.map(function (p) { return '<option value="' + escH(String(p.text).slice(0, 190)) + '">'; }).join('');
      if (!board || !list.length) return;
      board.innerHTML = list.map(function (p) {
        return '<article class="pcard"><p class="pcard-top"><span>' + escH(p.sector) + '</span>' + (p.company ? '<em class="co">' + escH(p.company) + '</em>' : '') + '</p><p class="pcard-task">' + escH(p.text) + '</p></article>';
      }).join('');
      var lede = document.querySelector('[data-board-lede]');
      if (lede) lede.textContent = list.length === 1 ? 'One problem is on the board so far. Pick it for your demo or your challenge entry.' : list.length + ' problems are on the board so far. Pick one for your demo or your challenge entry.';
    }).catch(function () { /* the examples stay */ });
  }

  // The voting page: the link from the email carries a signed token, kept on this phone so
  // the page works all day without the email. What the voter has picked survives the refresh.
  var vote = document.querySelector('[data-vote]');
  if (vote) {
    var VKEY = 'aas27-vote';
    var stateEl = vote.querySelector('[data-vote-state]');
    var slotsEl = vote.querySelector('[data-vote-slots]');
    var askEl = vote.querySelector('[data-vote-ask]');
    var tok = params.get('t');
    try {
      if (tok) { localStorage.setItem(VKEY, tok); history.replaceState(null, '', window.location.pathname); }
      else tok = localStorage.getItem(VKEY);
    } catch (e) { /* private mode: the link still works while the page is open */ }
    var picks = {};
    var shownIds = null;
    var QS = [['worked', 'Did it work?'], ['would_use', 'Would I use it?'], ['clear', 'Was it clear?']];
    var renderSlots = function (open) {
      var ids = open.map(function (s) { return s.id; }).join(',');
      if (ids === shownIds) return;
      shownIds = ids;
      slotsEl.innerHTML = open.map(function (s) {
        var mine = s.mine || {};
        return '<form class="card vote-card" data-slot="' + s.id + '" novalidate><p class="vote-co">' + escH(s.company) + '</p>' + (s.agent ? '<h2>' + escH(s.agent) + '</h2>' : '')
          + QS.map(function (q) {
            var cur = (picks[s.id] && picks[s.id][q[0]]) || mine[q[0]] || 0;
            return '<fieldset class="vote-q"><legend>' + q[1] + '</legend><div class="vote-scale">' + [1, 2, 3, 4, 5].map(function (n) {
              var id = 'v' + s.id + '-' + q[0] + '-' + n;
              return '<input type="radio" id="' + id + '" name="' + q[0] + '" value="' + n + '"' + (Number(cur) === n ? ' checked' : '') + '><label for="' + id + '">' + n + '</label>';
            }).join('') + '</div></fieldset>';
          }).join('')
          + '<div class="vote-foot"><span class="vote-hint">1 is poor, 5 is excellent</span><button type="submit" class="btn btn-primary">' + (s.mine ? 'Update my score' : 'Send my score') + '</button></div><p class="vote-msg" role="status"></p></form>';
      }).join('');
    };
    var paintVote = function () {
      if (!tok) { askEl.hidden = false; return; }
      getJSON('/api/agent-summit/vote?t=' + encodeURIComponent(tok)).then(function (j) {
        if (!j || !j.ok) {
          try { localStorage.removeItem(VKEY); } catch (e) { /* nothing kept */ }
          tok = null; shownIds = null; slotsEl.innerHTML = '';
          stateEl.innerHTML = '<p class="vote-hello">' + escH((j && j.error) || 'This voting link is not valid.') + '</p>';
          askEl.hidden = false;
          return;
        }
        askEl.hidden = true;
        var open = j.open || [];
        stateEl.innerHTML = '<p class="vote-hello">Hi ' + escH(j.name) + '. Your ' + escH(j.pass) + ' comes with a vote'
          + (j.scored ? ', and you have scored ' + j.scored + (j.scored === 1 ? ' demo' : ' demos') : '') + '.</p>'
          + (open.length ? '' : '<p class="vote-none">' + (j.ready ? 'Nothing to score right now. When a slot ends, it appears here on its own.' : 'Scoring opens on 16 April. Keep this page: the same link works all day.') + '</p>');
        renderSlots(open);
      }).catch(function () {
        stateEl.innerHTML = '<p class="vote-hello">We could not reach the server. Check your connection; this page tries again on its own.</p>';
      });
    };
    slotsEl.addEventListener('change', function (e) {
      var f = e.target.closest('[data-slot]');
      if (!f) return;
      var sid = f.getAttribute('data-slot');
      picks[sid] = picks[sid] || {};
      picks[sid][e.target.name] = Number(e.target.value);
    });
    slotsEl.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target.closest('[data-slot]');
      if (!f) return;
      var body = { t: tok, slot_id: Number(f.getAttribute('data-slot')) };
      var missing = false;
      QS.forEach(function (q) { var ch = f.querySelector('input[name="' + q[0] + '"]:checked'); if (ch) body[q[0]] = Number(ch.value); else missing = true; });
      var msg = f.querySelector('.vote-msg');
      var btn = f.querySelector('button[type="submit"]');
      if (missing) { msg.textContent = 'Give each question a score from 1 to 5.'; msg.className = 'vote-msg err'; return; }
      btn.setAttribute('aria-busy', 'true');
      fetch('/api/agent-summit/vote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j && j.ok) { msg.textContent = 'Saved. You can change it until scoring closes.'; msg.className = 'vote-msg ok'; btn.textContent = 'Update my score'; }
          else { msg.textContent = (j && j.error) || 'Could not save. Try again.'; msg.className = 'vote-msg err'; if (j && j.closed) { shownIds = null; paintVote(); } }
        })
        .catch(function () { msg.textContent = 'Could not reach the server. Try again.'; msg.className = 'vote-msg err'; })
        .then(function () { btn.removeAttribute('aria-busy'); });
    });
    paintVote();
    setInterval(function () { if (!document.hidden && tok) paintVote(); }, 15000);
  }

  // The hall screens: scores and Break the agent, one after the other, refreshed every 10 seconds.
  var screenEl = document.querySelector('[data-screen]');
  if (screenEl) {
    var scViews = screenEl.querySelectorAll('.sc-view');
    var scIndex = 0;
    var drawScreen = function (j) {
      var ag = (j && j.agents) || [];
      screenEl.querySelector('[data-sc-scores]').innerHTML = ag.length ? ag.map(function (a, i) {
        return '<li><span class="sc-rank">' + (i + 1) + '</span><span class="sc-name"><b>' + escH(a.agent || a.company) + '</b>' + (a.agent ? '<small>' + escH(a.company) + '</small>' : '') + '</span>'
          + '<span class="sc-bar"><i style="width:' + Math.round(a.score / 5 * 100) + '%"></i></span><span class="sc-score">' + Number(a.score).toFixed(1) + '<small>' + a.votes + ' votes</small></span></li>';
      }).join('') : '<li class="sc-empty">The first scores appear after the first slot.</li>';
      var bk = (j && j.breakers) || [];
      screenEl.querySelector('[data-sc-breakers]').innerHTML = bk.length ? bk.map(function (b, i) {
        return '<li><span class="sc-rank">' + (i + 1) + '</span><span class="sc-name"><b>' + escH(b.breaker) + '</b></span><span class="sc-score">' + b.breaks + '<small>' + (b.breaks === 1 ? 'break' : 'breaks') + '</small></span></li>';
      }).join('') : '<li class="sc-empty">No agent has been broken yet.</li>';
      screenEl.querySelector('[data-sc-recent]').innerHTML = ((j && j.recent) || []).map(function (r) {
        return '<li><b>' + escH(r.breaker) + '</b> broke <b>' + escH(r.agent) + '</b>' + (r.what ? '<span>' + escH(r.what) + '</span>' : '') + '</li>';
      }).join('');
      var vn = (j && j.voting_now) || [];
      screenEl.querySelector('[data-sc-now]').textContent = vn.length ? 'Scoring now: ' + vn.map(function (v) { return v.agent ? v.agent + ', ' + v.company : v.company; }).join(' · ') : '';
    };
    var pullScreen = function () { getJSON('/api/agent-summit/leaderboard').then(drawScreen).catch(function () { /* keep the last numbers */ }); };
    pullScreen();
    setInterval(pullScreen, 10000);
    setInterval(function () {
      scIndex = (scIndex + 1) % scViews.length;
      scViews.forEach(function (v, i) { v.hidden = i !== scIndex; });
    }, 20000);
  }

  // Agents of India 2027: drawn from the totals once the team has made the report public.
  var reportEl = document.querySelector('[data-report]');
  if (reportEl) {
    getJSON('/api/agent-summit/report').then(function (j) {
      if (!j || !j.published) return;
      var bars = function (title, list) {
        if (!list || !list.length) return '';
        var max = Math.max.apply(null, list.map(function (x) { return x.n; }));
        return '<section class="rp-block"><h3>' + escH(title) + '</h3><ul class="rp-bars">' + list.map(function (x) {
          return '<li><span class="rp-l">' + escH(x.label) + '</span><span class="rp-b"><i style="width:' + Math.max(4, Math.round(x.n / max * 100)) + '%"></i></span><span class="rp-n">' + x.n + '</span></li>';
        }).join('') + '</ul></section>';
      };
      var body = reportEl.querySelector('[data-report-body]');
      body.innerHTML = '<div class="rp-head"><div class="rp-num"><b>' + j.applications + '</b><span>showcase applications</span></div><div class="rp-num"><b>' + j.teams + '</b><span>AI Agent Challenge teams</span></div>'
        + '<button type="button" class="btn btn-primary" data-print>Download as PDF</button></div>'
        + '<div class="rp-grid">' + bars('What the agents do', j.categories) + bars('How far along they are', j.stages) + bars('Languages they work in', j.languages)
        + bars('Where they are built', j.cities) + bars('Team size', j.team_sizes) + bars('When the company started', j.founded) + bars('Challenge team size', j.challenge_sizes) + '</div>'
        + '<p class="fine">Totals from every showcase application and AI Agent Challenge entry received by ' + new Date(j.as_of).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
        + '. Groups smaller than ' + j.min_group + ' are left out, so no company can be picked out.</p>';
      body.hidden = false;
      reportEl.querySelector('[data-report-wait]').hidden = true;
      body.querySelector('[data-print]').addEventListener('click', function () { window.print(); });
    }).catch(function () { /* the launch note stays */ });
  }
})();
