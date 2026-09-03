/* RCW 도움말 검색 - 한글/영문 프레임 공용.
 *
 * 쓰는 법 (프레임 HTML 에서):
 *   <script src="search_index.js"></script>
 *   <script src="search.js"></script>          (영문 프레임은 ../search.js)
 *   <script>RcwSearch.init({lang:'ko', resolve:getLangPath});</script>
 *
 * 인덱스(search_index.js)가 없으면 검색창을 아예 만들지 않는다.
 * 인덱스는 help/build_search_index.py 가 생성한다.
 *
 * 한국어는 형태소 분석기 없이 공백 토큰화를 하면 "노치"로 "노치가공"을 못 찾는다.
 * 그래서 토크나이저를 쓰지 않고 부분문자열(substring) 매칭을 한다.
 */
var RcwSearch = (function () {
  'use strict';

  var MAX_RESULTS = 40;
  var SNIPPET_BEFORE = 40;
  var SNIPPET_AFTER = 100;

  var TEXT = {
    ko: {
      placeholder: '도움말 검색 (명령어 · 본문)',
      hint: '검색',
      none: '검색 결과가 없습니다.',
      count: function (n) { return n + '개 결과'; },
      more: function (n) { return '외 ' + n + '개 더 (검색어를 좁혀 보세요)'; },
      clear: '지우기'
    },
    en: {
      placeholder: 'Search help (commands · text)',
      hint: 'Search',
      none: 'No results found.',
      count: function (n) { return n + (n === 1 ? ' result' : ' results'); },
      more: function (n) { return n + ' more (try a narrower query)'; },
      clear: 'Clear'
    }
  };

  var CSS = [
    '.rcw-search{margin-top:9px;position:relative}',
    '.rcw-search input{width:100%;padding:6px 26px 6px 28px;border:1px solid #cbd5e1;border-radius:6px;',
    'background:#fff url("data:image/svg+xml;charset=utf8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%2394a3b8\' stroke-width=\'2.4\' stroke-linecap=\'round\'%3E%3Ccircle cx=\'11\' cy=\'11\' r=\'7\'/%3E%3Cpath d=\'M20 20l-3.6-3.6\'/%3E%3C/svg%3E") no-repeat 7px center;',
    'background-size:13px 13px;font-size:12px;font-family:inherit;color:#0f172a;outline:none}',
    '.rcw-search input:focus{border-color:#2563eb;box-shadow:0 0 0 2px rgba(37,99,235,.15)}',
    '.rcw-search input::placeholder{color:#94a3b8}',
    '.rcw-search-clear{position:absolute;right:4px;top:50%;transform:translateY(-50%);width:18px;height:18px;',
    'border:0;border-radius:4px;background:transparent;color:#94a3b8;font-size:14px;line-height:1;cursor:pointer;',
    'display:none;font-family:inherit;padding:0}',
    '.rcw-search-clear:hover{background:#e2e8f0;color:#475569}',
    '.rcw-search.has-text .rcw-search-clear{display:block}',
    '.rcw-results{display:none;padding:4px 0 18px}',
    '.rcw-results.open{display:block}',
    '.rcw-results-count{padding:6px 12px;font-size:11px;font-weight:700;color:#64748b;letter-spacing:.2px}',
    '.rcw-hit{display:block;width:100%;text-align:left;border:0;background:transparent;cursor:pointer;',
    'padding:7px 12px 8px;border-left:3px solid transparent;font-family:inherit}',
    '.rcw-hit:hover,.rcw-hit.sel{background:#eff6ff;border-left-color:#2563eb}',
    '.rcw-hit-top{display:flex;align-items:baseline;gap:6px}',
    '.rcw-hit-title{font-size:12.5px;font-weight:700;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}',
    '.rcw-hit-cmd{flex:0 0 auto;font-family:Consolas,monospace;font-size:10.5px;font-weight:700;color:#003d80;',
    'background:#e8f0ff;border:1px solid #b9cdf0;border-radius:3px;padding:0 4px;max-width:46%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.rcw-hit-crumb{font-size:10.5px;color:#94a3b8;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.rcw-hit-snip{font-size:11px;color:#64748b;line-height:1.5;margin-top:3px;',
    'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
    '.rcw-hit mark{background:#fde68a;color:#78350f;padding:0 1px;border-radius:2px}',
    '.rcw-empty{padding:14px 12px;font-size:12px;color:#94a3b8}',
    '.rcw-more{padding:6px 12px 0;font-size:11px;color:#94a3b8}',
    '.rcw-nav-hidden{display:none !important}'
  ].join('');

  var pages = null;      // 인덱스 레코드 (소문자 캐시 포함)
  var txt = TEXT.ko;
  var resolve = function (p) { return p; };
  var input = null, box = null, results = null, nav = null, frame = null;
  var hits = [], sel = -1;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* 폴더 경로를 "Frame Modeling / Make Fab Dwg" 꼴로.
     사이드바 폭이 좁아 전체를 쓰면 앞만 보이고 끝이 잘린다.
     즉시 알아볼 수 있는 것은 바로 위 두 단계라 그만 남긴다. */
  var CRUMB_DEPTH = 2;

  function crumb(path) {
    var parts = path.split('/');
    parts.pop();
    if (!parts.length) return '';
    var cut = parts.slice(-CRUMB_DEPTH).map(function (p) {
      return p.replace(/^\d+[._-]?/, '').replace(/[_.]/g, ' ').trim() || p;
    });
    return (parts.length > CRUMB_DEPTH ? '… / ' : '') + cut.join(' / ');
  }

  function prepare() {
    var raw = window.RCW_SEARCH_INDEX;
    if (!raw || !raw.pages || !raw.pages.length) return false;
    pages = raw.pages.map(function (r) {
      var cmds = r.c || [];
      return {
        p: r.p,
        t: r.t || '',
        c: cmds,
        b: r.b || '',
        lt: (r.t || '').toLowerCase(),
        lc: cmds.join(' ').toLowerCase(),
        lh: (r.h || []).join(' ').toLowerCase(),
        lb: (r.b || '').toLowerCase()
      };
    });
    return true;
  }

  /* 한 term 이 한 페이지에서 얻는 점수. 0 이면 그 페이지는 탈락. */
  function scoreTerm(rec, term) {
    var s = 0, i;
    if (rec.lc) {
      for (i = 0; i < rec.c.length; i++) {
        var lc = rec.c[i].toLowerCase();
        if (lc === term) { s += 400; break; }
        if (lc.indexOf(term) === 0) { s += 250; break; }
        if (lc.indexOf(term) !== -1) { s += 150; break; }
      }
    }
    if (rec.lt.indexOf(term) === 0) s += 120;
    else if (rec.lt.indexOf(term) !== -1) s += 80;
    if (rec.lh.indexOf(term) !== -1) s += 30;
    i = rec.lb.indexOf(term);
    if (i !== -1) {
      var n = 0, at = i;
      while (at !== -1 && n < 6) { n++; at = rec.lb.indexOf(term, at + term.length); }
      s += 8 + n * 2;
    }
    return s;
  }

  function search(query) {
    var terms = query.toLowerCase().split(/\s+/).filter(function (t) { return t.length > 0; });
    if (!terms.length) return [];
    var out = [];
    for (var i = 0; i < pages.length; i++) {
      var rec = pages[i], total = 0, ok = true;
      for (var j = 0; j < terms.length; j++) {
        var s = scoreTerm(rec, terms[j]);
        if (!s) { ok = false; break; }
        total += s;
      }
      if (ok) out.push({ rec: rec, score: total });
    }
    out.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.rec.t.length - b.rec.t.length;
    });
    return { list: out, terms: terms };
  }

  /* 매칭 위치 주변을 잘라내고 검색어를 <mark> 로 감싼다. */
  function snippet(rec, terms) {
    var body = rec.b, lb = rec.lb, at = -1, hitTerm = '', i;
    for (i = 0; i < terms.length; i++) {
      var k = lb.indexOf(terms[i]);
      if (k !== -1 && (at === -1 || k < at)) { at = k; hitTerm = terms[i]; }
    }
    if (at === -1) return esc(body.slice(0, 120));
    var from = Math.max(0, at - SNIPPET_BEFORE);
    var to = Math.min(body.length, at + hitTerm.length + SNIPPET_AFTER);
    var cut = body.slice(from, to), lcut = lb.slice(from, to);

    // 잘라낸 조각 안에서 term 이 나타나는 구간을 모은 뒤 겹침을 합친다.
    // 구간을 먼저 구하고 나중에 조립해야, 이미 넣은 <mark> 태그 문자열을
    // 다음 term 이 다시 매칭하는 사고가 없다.
    var spans = [];
    for (i = 0; i < terms.length; i++) {
      var t = terms[i], at2 = lcut.indexOf(t);
      while (at2 !== -1) {
        spans.push([at2, at2 + t.length]);
        at2 = lcut.indexOf(t, at2 + t.length);
      }
    }
    spans.sort(function (a, b) { return a[0] - b[0]; });
    var merged = [];
    for (i = 0; i < spans.length; i++) {
      var last = merged[merged.length - 1];
      if (last && spans[i][0] <= last[1]) { if (spans[i][1] > last[1]) last[1] = spans[i][1]; }
      else merged.push([spans[i][0], spans[i][1]]);
    }

    var html = '', pos = 0;
    for (i = 0; i < merged.length; i++) {
      html += esc(cut.slice(pos, merged[i][0]));
      html += '<mark>' + esc(cut.slice(merged[i][0], merged[i][1])) + '</mark>';
      pos = merged[i][1];
    }
    html += esc(cut.slice(pos));
    return (from > 0 ? '…' : '') + html + (to < body.length ? '…' : '');
  }

  function render(res) {
    var list = res.list, terms = res.terms;
    hits = list.slice(0, MAX_RESULTS);
    sel = -1;
    if (!list.length) {
      results.innerHTML = '<div class="rcw-empty">' + esc(txt.none) + '</div>';
      return;
    }
    var html = '<div class="rcw-results-count">' + esc(txt.count(list.length)) + '</div>';
    for (var i = 0; i < hits.length; i++) {
      var rec = hits[i].rec;
      var cmd = rec.c.length ? '<span class="rcw-hit-cmd">' + esc(rec.c[0]) + '</span>' : '';
      var cr = crumb(rec.p);
      html += '<button type="button" class="rcw-hit" data-i="' + i + '">'
        + '<span class="rcw-hit-top"><span class="rcw-hit-title">' + esc(rec.t) + '</span>' + cmd + '</span>'
        + (cr ? '<span class="rcw-hit-crumb">' + esc(cr) + '</span>' : '')
        + '<span class="rcw-hit-snip">' + snippet(rec, terms) + '</span>'
        + '</button>';
    }
    if (list.length > MAX_RESULTS) {
      html += '<div class="rcw-more">' + esc(txt.more(list.length - MAX_RESULTS)) + '</div>';
    }
    results.innerHTML = html;
  }

  function findCtrl(folderId) {
    var btns = document.querySelectorAll('.folder-toggle');
    for (var i = 0; i < btns.length; i++) {
      if ((btns[i].getAttribute('onclick') || '').indexOf("'" + folderId + "'") !== -1) return btns[i];
    }
    return null;
  }

  function expandAncestors(el) {
    var node = el.parentNode;
    while (node && node !== document) {
      if (node.nodeType === 1 && node.classList && node.classList.contains('folder-items') && node.id) {
        node.classList.remove('collapsed');
        var cb = findCtrl(node.id);
        if (cb) cb.classList.remove('collapsed');
      }
      node = node.parentNode;
    }
  }

  /* 사이드바 트리에서 해당 페이지를 찾아 펼치고 활성 표시한다.
     리프 링크 -> 폴더 index 버튼 -> 상위 폴더 순으로 넓혀 가며 찾는다. */
  function revealInNav(path) {
    var i, links = nav.querySelectorAll('a[href]');
    for (i = 0; i < links.length; i++) {
      if (links[i].getAttribute('href') === path) {
        if (window.setActive) window.setActive(links[i]);
        expandAncestors(links[i]);
        links[i].scrollIntoView({ block: 'nearest' });
        return;
      }
    }
    var btns = nav.querySelectorAll('.folder-toggle[data-index]'), btn = null, best = 0;
    for (i = 0; i < btns.length; i++) {
      if (btns[i].getAttribute('data-index') === path) { btn = btns[i]; break; }
    }
    if (!btn) {
      var dir = path.replace(/[^\/]+$/, '');
      for (i = 0; i < btns.length; i++) {
        var d = btns[i].getAttribute('data-index').replace(/[^\/]+$/, '');
        if (dir.indexOf(d) === 0 && d.length > best) { btn = btns[i]; best = d.length; }
      }
    }
    if (!btn) return;
    if (window.setActive) window.setActive(btn);
    var m = (btn.getAttribute('onclick') || '').match(/toggleGroup\('([^']+)'/);
    if (m) {
      var fEl = document.getElementById(m[1]);
      if (fEl) fEl.classList.remove('collapsed');
      var cb = findCtrl(m[1]);
      if (cb) cb.classList.remove('collapsed');
    }
    btn.classList.remove('collapsed');
    expandAncestors(btn);
    btn.scrollIntoView({ block: 'nearest' });
  }

  function open(i) {
    if (i < 0 || i >= hits.length) return;
    var path = hits[i].rec.p;
    if (frame) frame.src = resolve(path);
    close();
    revealInNav(path);
  }

  function highlight(i) {
    var els = results.querySelectorAll('.rcw-hit');
    for (var k = 0; k < els.length; k++) els[k].classList.remove('sel');
    if (i >= 0 && i < els.length) {
      els[i].classList.add('sel');
      els[i].scrollIntoView({ block: 'nearest' });
    }
    sel = i;
  }

  function close() {
    input.value = '';
    box.classList.remove('has-text');
    results.classList.remove('open');
    results.innerHTML = '';
    nav.classList.remove('rcw-nav-hidden');
    hits = []; sel = -1;
  }

  function onInput() {
    var q = input.value.trim();
    box.classList.toggle('has-text', input.value.length > 0);
    if (!q) {
      results.classList.remove('open');
      results.innerHTML = '';
      nav.classList.remove('rcw-nav-hidden');
      hits = []; sel = -1;
      return;
    }
    render(search(q));
    results.classList.add('open');
    nav.classList.add('rcw-nav-hidden');
  }

  function onKey(e) {
    if (e.key === 'Escape') { close(); input.blur(); return; }
    if (!hits.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight(sel + 1 >= hits.length ? 0 : sel + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(sel - 1 < 0 ? hits.length - 1 : sel - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); open(sel < 0 ? 0 : sel); }
  }

  function build() {
    var brand = document.querySelector('.brand');
    nav = document.querySelector('.nav');
    frame = document.querySelector('iframe[name="content"]');
    if (!brand || !nav) return false;

    var style = document.createElement('style');
    style.id = 'rcw-search-style';
    style.textContent = CSS;
    document.head.appendChild(style);

    box = document.createElement('div');
    box.className = 'rcw-search';
    input = document.createElement('input');
    input.type = 'text';
    input.id = 'rcw-search-input';
    input.setAttribute('placeholder', txt.placeholder);
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    var clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'rcw-search-clear';
    clear.title = txt.clear;
    clear.innerHTML = '×';
    box.appendChild(input);
    box.appendChild(clear);
    brand.appendChild(box);

    results = document.createElement('div');
    results.className = 'rcw-results';
    nav.parentNode.insertBefore(results, nav);

    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKey);
    clear.addEventListener('click', function () { close(); input.focus(); });
    results.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.rcw-hit') : null;
      if (btn) open(parseInt(btn.getAttribute('data-i'), 10));
    });
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault(); input.focus(); input.select();
      }
    });
    return true;
  }

  function init(opts) {
    opts = opts || {};
    txt = TEXT[opts.lang] || TEXT.ko;
    if (typeof opts.resolve === 'function') resolve = opts.resolve;
    function go() {
      if (!prepare()) return;   // 인덱스 없음 -> 검색창 자체를 만들지 않는다
      build();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
    else go();
  }

  // _test 는 브라우저 없이(node) 검색 로직만 검증하기 위한 통로다.
  return { init: init, _test: { prepare: prepare, search: search, snippet: snippet, crumb: crumb } };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RcwSearch;
