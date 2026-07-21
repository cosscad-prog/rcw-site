/* RCW V5 — Korean / English toggle
   Any element carrying data-en swaps its text content.
   Korean text lives in the markup; English lives in data-en. */
(function () {
  var KEY = 'rcw-lang';

  function apply(lang) {
    var nodes = document.querySelectorAll('[data-en]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.dataset.ko === undefined) el.dataset.ko = el.textContent;
      el.textContent = (lang === 'en') ? el.dataset.en : el.dataset.ko;
    }
    document.documentElement.lang = (lang === 'en') ? 'en' : 'ko';
    var btns = document.querySelectorAll('[data-lang-toggle]');
    for (var j = 0; j < btns.length; j++) {
      btns[j].textContent = (lang === 'en') ? '한국어' : 'ENGLISH';
      btns[j].setAttribute('aria-label', lang === 'en' ? 'Switch to Korean' : 'Switch to English');
    }
    try { localStorage.setItem(KEY, lang); } catch (e) {}
  }

  function current() {
    try { return localStorage.getItem(KEY) || 'ko'; } catch (e) { return 'ko'; }
  }

  function init() {
    apply(current());
    document.addEventListener('click', function (ev) {
      var t = ev.target.closest ? ev.target.closest('[data-lang-toggle]') : null;
      if (!t) return;
      ev.preventDefault();
      apply(current() === 'ko' ? 'en' : 'ko');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
