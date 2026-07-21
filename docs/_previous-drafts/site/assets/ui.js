/* RCW V5 — UI behaviors: sticky nav, mobile menu, scroll reveal, stat counters */
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* sticky nav shadow + mobile toggle */
  function nav() {
    var el = document.querySelector('.nav');
    if (!el) return;
    var onScroll = function () { el.classList.toggle('scrolled', window.scrollY > 8); };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    var burger = el.querySelector('.burger');
    if (burger) {
      burger.addEventListener('click', function () {
        el.classList.toggle('open');
        burger.setAttribute('aria-expanded', el.classList.contains('open') ? 'true' : 'false');
      });
      // close after tapping a link
      document.querySelectorAll('.mobile-menu a').forEach(function (a) {
        a.addEventListener('click', function () { el.classList.remove('open'); });
      });
    }
  }

  /* scroll reveal */
  function reveal() {
    var items = document.querySelectorAll('[data-reveal]');
    if (!items.length) return;
    if (reduce || !('IntersectionObserver' in window)) {
      items.forEach(function (i) { i.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    items.forEach(function (i) { io.observe(i); });
  }

  /* animated counters — element carries data-count="90" data-suffix="%" */
  function counters() {
    var els = document.querySelectorAll('[data-count]');
    if (!els.length) return;
    var run = function (el) {
      var end = parseFloat(el.getAttribute('data-count'));
      var suffix = el.getAttribute('data-suffix') || '';
      var prefix = el.getAttribute('data-prefix') || '';
      if (reduce) { el.textContent = prefix + end + suffix; return; }
      var start = null, dur = 1300;
      var tick = function (t) {
        if (start === null) start = t;
        var p = Math.min((t - start) / dur, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        var val = end % 1 === 0 ? Math.round(end * eased) : (end * eased).toFixed(1);
        el.textContent = prefix + val + suffix;
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    if (!('IntersectionObserver' in window)) { els.forEach(run); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { run(e.target); io.unobserve(e.target); }
      });
    }, { threshold: 0.5 });
    els.forEach(function (e) { io.observe(e); });
  }

  function init() { nav(); reveal(); counters(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
