/* Motion on /register and /inquiry only: the credits, the licence and how to remove it are at the
   top of css/booking-motion.css. With animations off this file does nothing at all, and every form
   and button works without it. */
(function () {
  'use strict';
  if (!window.matchMedia || !window.IntersectionObserver) return;
  if (!matchMedia('(prefers-reduced-motion: no-preference)').matches) return;

  var each = function (sel, fn) { Array.prototype.slice.call(document.querySelectorAll(sel)).forEach(fn); };

  // The rows settle one after another.
  each('.bk-list li, .rg-tiers li', function (li) {
    li.style.setProperty('--i', Array.prototype.indexOf.call(li.parentNode.children, li));
  });

  // A soft light follows a mouse across the sizes.
  if (matchMedia('(hover: hover)').matches) {
    each('.bk-pkg', function (card) {
      card.addEventListener('pointermove', function (e) {
        var r = card.getBoundingClientRect();
        card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        card.style.setProperty('--my', (e.clientY - r.top) + 'px');
      }, { passive: true });
    });
  }

  // The turning edge stops when it is off the screen.
  var away = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { e.target.classList.toggle('rg-off', !e.isIntersecting); });
  });
  each('.rg-tier--lead', function (t) { away.observe(t); });
})();
