/* 버전별 변경 안내 — 평가판·고객 두 다운로드 페이지가 함께 쓴다.
   내용은 releases.json 한 곳에만 있다.  페이지는 넣을 자리(#rcw-changes)와
   생김새(.rcw-chg-* CSS)만 준비하면 된다.

   한/영 전환은 페이지의 기존 장치를 그대로 탄다 — 만든 노드에 data-en 을 달고
   window.rcwLang.refresh() 를 부르면 현재 언어가 입혀진다.
   못 읽어오면 아무것도 그리지 않는다.  버전 안내가 없는 것보다 틀린 것이 나쁘다. */
(function () {
  var host = document.getElementById('rcw-changes');
  if (!host || !window.fetch) return;

  /* releases.json 에 있는 것을 <b>전부</b> 내놓는다(2026-08-14).
     맨 위 하나만 펼치고, 이전 버전은 <b>한 줄에 하나씩</b> 접어 둔다 — 눌러야 내용이 보인다.
     전에는 3개까지만 그렸는데, 그러면 "그때 무엇을 고쳤는지" 를 되짚을 수가 없었다.
     사용자는 어차피 다 읽지 않는다. 접혀 있으면 페이지는 짧고, 필요한 사람만 펼쳐 본다. */

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

  /* 최신버전: V5.0.14   2026-08-07
     "최신버전:" 은 맨 위 항목에만 붙인다 — 접혀 있는 이전 버전에까지 붙으면 거짓말이 된다.
     날짜는 언어와 무관하므로 data-en 을 달지 않는다. */
  function headNode(release, isLatest) {
    var p = el('p', 'rcw-chg-head');

    if (isLatest) {
      var label = el('span', 'rcw-chg-label');
      label.innerHTML = '최신버전:';
      label.setAttribute('data-en', 'Latest version:');
      p.appendChild(label);
    }

    var b = el('b', 'rcw-chg-ver');
    b.textContent = 'V' + (release.version || '');
    p.appendChild(b);

    var span = el('span', 'rcw-chg-date');
    span.textContent = release.date || '';
    p.appendChild(span);

    return p;
  }

  /* 접힌 이전 버전 한 줄: ▸ V5.1.1   2026-08-11 — 누르면 그 버전의 항목이 펼쳐진다. */
  function collapsedNode(release) {
    var det = el('details', 'rcw-chg-item');
    var sum = el('summary');

    var b = el('b', 'rcw-chg-ver');
    b.textContent = 'V' + (release.version || '');
    sum.appendChild(b);

    var span = el('span', 'rcw-chg-date');
    span.textContent = release.date || '';
    sum.appendChild(span);

    det.appendChild(sum);
    det.appendChild(listNode(release));
    return det;
  }

  function render(data) {
    var releases = (data && data.releases) || [];
    if (!releases.length) return;

    var box = el('section', 'rcw-chg');

    var title = el('h4', 'rcw-chg-title');
    title.innerHTML = '이번 버전에서 바뀐 것';
    title.setAttribute('data-en', "What's new in this version");
    box.appendChild(title);

    box.appendChild(headNode(releases[0], true));
    box.appendChild(listNode(releases[0]));

    /* 이전 버전은 버전마다 한 줄로 접어 둔다. 지금 받을지 판단하는 데 필요한 건 맨 위 하나이고,
       나머지는 "언제 무엇이 바뀌었나" 를 되짚을 때만 펼치면 된다. */
    if (releases.length > 1) {
      var prev = el('div', 'rcw-chg-prev');

      var head = el('p', 'rcw-chg-head');
      var label = el('span', 'rcw-chg-label');
      label.innerHTML = '이전 버전';
      label.setAttribute('data-en', 'Earlier versions');
      head.appendChild(label);
      prev.appendChild(head);

      for (var i = 1; i < releases.length; i++) prev.appendChild(collapsedNode(releases[i]));
      box.appendChild(prev);
    }

    host.appendChild(box);
    if (window.rcwLang) window.rcwLang.refresh();
  }

  /* 발행할 때마다 내용이 바뀌므로 오래된 사본을 쥐고 있으면 안 된다. */
  fetch('releases.json', { cache: 'no-cache' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d) return;
      /* 다운로드 기록에 "무슨 판을 받았나" 를 남기려면 페이지가 그 값을 알아야 한다.
         이 파일이 이미 releases.json 을 읽고 있으므로 여기서 한 번 내놓는다
         (customer.html 의 다운로드 기록이 쓴다). 못 읽으면 그냥 없는 값이고,
         서버가 비운 채 기록한다 — 안내를 못 그려도 다운로드는 되어야 하는 것과 같은 원칙. */
      var top = d.releases && d.releases[0];
      if (top && top.version) window.rcwLatestVersion = String(top.version);
      render(d);
    })
    .catch(function () { /* 안내를 못 그려도 다운로드는 되어야 한다 */ });
})();
