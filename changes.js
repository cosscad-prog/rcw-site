/* 버전별 변경 안내 — 평가판·고객 두 다운로드 페이지가 함께 쓴다.
   내용은 releases.json 한 곳에만 있다.  페이지는 넣을 자리(#rcw-changes)와
   생김새(.rcw-chg-* CSS)만 준비하면 된다.

   한/영 전환은 페이지의 기존 장치를 그대로 탄다 — 만든 노드에 data-en 을 달고
   window.rcwLang.refresh() 를 부르면 현재 언어가 입혀진다.
   못 읽어오면 아무것도 그리지 않는다.  버전 안내가 없는 것보다 틀린 것이 나쁘다. */
(function () {
  var host = document.getElementById('rcw-changes');
  if (!host || !window.fetch) return;

  function el(tag, cls) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  /* 항목 한 줄. 한국어를 본문에 넣고 영어는 data-en 으로 달아 둔다. */
  function itemNode(item) {
    var li = el('li');
    li.innerHTML = item.ko || '';
    if (item.en) li.setAttribute('data-en', item.en);
    return li;
  }

  function listNode(release) {
    var ul = el('ul', 'rcw-chg-list');
    var items = release.items || [];
    for (var i = 0; i < items.length; i++) ul.appendChild(itemNode(items[i]));
    return ul;
  }

  /* 5.0.14 · 2026-08-07 — 날짜는 언어와 무관하므로 data-en 을 달지 않는다. */
  function headNode(release) {
    var b = el('b', 'rcw-chg-ver');
    b.textContent = release.version || '';
    var span = el('span', 'rcw-chg-date');
    span.textContent = release.date ? ' · ' + release.date : '';
    var p = el('p', 'rcw-chg-head');
    p.appendChild(b);
    p.appendChild(span);
    return p;
  }

  function render(data) {
    var releases = (data && data.releases) || [];
    if (!releases.length) return;

    var box = el('section', 'rcw-chg');

    var title = el('h4', 'rcw-chg-title');
    title.innerHTML = '이번 버전에서 바뀐 것';
    title.setAttribute('data-en', "What's new in this version");
    box.appendChild(title);

    box.appendChild(headNode(releases[0]));
    box.appendChild(listNode(releases[0]));

    /* 이전 버전은 접어 둔다 — 지금 받을지 판단하는 데 필요한 건 맨 위 하나다. */
    if (releases.length > 1) {
      var det = el('details', 'rcw-chg-prev');
      var sum = el('summary');
      sum.innerHTML = '이전 버전';
      sum.setAttribute('data-en', 'Earlier versions');
      det.appendChild(sum);
      for (var i = 1; i < releases.length; i++) {
        det.appendChild(headNode(releases[i]));
        det.appendChild(listNode(releases[i]));
      }
      box.appendChild(det);
    }

    host.appendChild(box);
    if (window.rcwLang) window.rcwLang.refresh();
  }

  /* 발행할 때마다 내용이 바뀌므로 오래된 사본을 쥐고 있으면 안 된다. */
  fetch('releases.json', { cache: 'no-cache' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) { if (d) render(d); })
    .catch(function () { /* 안내를 못 그려도 다운로드는 되어야 한다 */ });
})();
