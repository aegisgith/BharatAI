/* Motion on /app only: pauses what is off the screen, and moves the mark under the menu. Nothing in
   the app depends on this file. If it is blocked the app works and each menu link keeps its own
   mark. Credits and the licence are at the top of /css/app-motion.css. */
(function () {
  'use strict';

  // Nothing keeps moving where nobody can see it.
  if ('IntersectionObserver' in window) {
    var watcher = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { e.target.classList.toggle('ap-off', !e.isIntersecting); });
    });
    document.querySelectorAll('.ap-aurora, .ap-pass').forEach(function (el) { watcher.observe(el); });
  }

  var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var links = document.querySelector('.ap-nav-links');
  if (still || !links) return;

  // Spotlight Navbar. Hidden on a phone, where offsetWidth reads 0 and place() does nothing.
  var light = document.createElement('span');
  light.className = 'ap-light';
  light.setAttribute('aria-hidden', 'true');
  light.style.opacity = '0';
  links.appendChild(light);
  links.classList.add('ap-spot');

  function place() {
    var on = links.querySelector('.tab-active');
    if (!on || !on.offsetWidth) { light.style.opacity = '0'; return; }
    light.style.setProperty('--ap-x', (on.offsetLeft + on.offsetWidth / 2 - 8) + 'px');
    light.style.opacity = '1';
  }

  // switchTab() and the sign-in both change which link is active, and the menu's width changes
  // with them, so the class is what is watched rather than any one caller.
  if ('MutationObserver' in window) {
    var watch = new MutationObserver(place);
    links.querySelectorAll('.nav-btn').forEach(function (b) {
      watch.observe(b, { attributes: true, attributeFilter: ['class'] });
    });
  }
  var waiting = 0;
  window.addEventListener('resize', function () {
    clearTimeout(waiting);
    waiting = setTimeout(place, 150);
  }, { passive: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
  window.addEventListener('load', place);
  place();

  // A soft light follows a mouse. Touch screens never fire these.
  links.addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse') return;
    links.style.setProperty('--ap-mouse', (e.clientX - links.getBoundingClientRect().left) + 'px');
    links.style.setProperty('--ap-glow', '1');
  }, { passive: true });
  links.addEventListener('pointerleave', function () { links.style.setProperty('--ap-glow', '0'); });
})();
