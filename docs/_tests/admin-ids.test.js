/* admin.html — 부르는 요소가 실제로 문서에 있나.
   실행: node docs/_tests/admin-ids.test.js   (설치할 것 없음)

   한 가지만 본다. `document.getElementById('없는-id')` 는 null 을 돌려주고,
   그 다음 줄에서 예외가 난다. 스크립트 전체가 거기서 멎으므로 화면은
   "일부가 안 나온다" 가 아니라 **로그인 뒤 아무것도 안 움직인다** 가 된다.
   탭을 하나 더할 때 markup 이나 배열 한 곳을 빠뜨리면 정확히 이 모양이 된다.

   ⚠️ 못 잡는 것 — 이름이 맞기만 하면 통과한다. 값이 제대로 채워지는지,
      RLS 로 조회가 막혔는지는 브라우저에서 실제로 로그인해야 안다. */

const fs = require('fs');
const path = require('path');
const SITE = path.join(__dirname, '..', '..');

const html = fs.readFileSync(path.join(SITE, 'admin.html'), 'utf8');

/** 문서에 있는 id 전부 */
const ids = new Set();
const idRe = /\sid="([^"]+)"/g;
let m;
while ((m = idRe.exec(html))) ids.add(m[1]);

/** 스크립트가 부르는 id — 리터럴만 본다(문자열을 이어 붙여 만든 것은 아래에서 따로). */
const wanted = [];
const getRe = /getElementById\('([^']+)'\)/g;
while ((m = getRe.exec(html))) wanted.push(m[1]);

/* 이어 붙여 만드는 이름: 'view-' + name, 'tab-' + name.
   VIEWS 배열이 원본이므로 그 배열에서 이름을 꺼내 조합한다. */
const viewsLine = /var VIEWS = \[([^\]]+)\]/.exec(html);
const views = viewsLine ? viewsLine[1].split(',').map(s => s.trim().replace(/'/g, '')) : [];
views.forEach(v => { wanted.push('view-' + v); wanted.push('tab-' + v); });

let fails = 0;
console.log('\n== admin.html — id ' + ids.size + '개, 부르는 곳 ' + wanted.length + '군데');
console.log('   탭: ' + (views.length ? views.join(', ') : '(VIEWS 배열을 못 찾음)'));

if (!views.length) { console.log('   ✘ 실패 VIEWS 배열을 못 찾았다 — 이름이 바뀌었나?'); fails++; }

const missing = [...new Set(wanted)].filter(id => !ids.has(id));
if (missing.length) {
  fails += missing.length;
  missing.forEach(id => console.log('   ✘ 실패 문서에 없는 id: ' + id));
} else {
  console.log('   ✔ 부르는 id 가 모두 문서에 있다');
}

/* TITLES 는 배열과 짝이 맞아야 한다. 없으면 탭 제목이 undefined 로 뜬다
   (예외가 안 나서 조용히 틀린다 — 그래서 따로 본다). */
const titleBlock = /var TITLES = \{([\s\S]*?)\};/.exec(html);
const titled = titleBlock ? (titleBlock[1].match(/(\w+):/g) || []).map(s => s.slice(0, -1)) : [];
const noTitle = views.filter(v => titled.indexOf(v) === -1);
if (noTitle.length) {
  fails += noTitle.length;
  noTitle.forEach(v => console.log('   ✘ 실패 TITLES 에 빠진 탭: ' + v));
} else if (views.length) {
  console.log('   ✔ 탭마다 TITLES 가 있다 (' + titled.join(', ') + ')');
}

console.log('\n' + (fails ? '▶ ' + fails + '개 실패' : '▶ 전부 OK'));
process.exit(fails ? 1 : 0);
