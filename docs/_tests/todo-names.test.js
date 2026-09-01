/* todo.html 안에서 **부르는데 어디에도 선언이 없는 이름**을 찾는다.
   실행: node docs/_tests/todo-names.test.js

   왜 있나 — 2026-09-01 에 백업 절을 지우면서 그 절 끝에 얹혀 있던 seed() 와 mk() 가
   같이 날아갔다. mk() 는 add() 가 부르는 것이라 "추가" 버튼이 아무 일도 안 하게 됐고,
   문법은 멀쩡해서 node --check 도 브라우저의 첫 화면도 아무 말을 안 했다.
   ReferenceError 는 그 줄을 지나야만 난다.

   ⚠️ 이것은 정규식이지 파서가 아니다. 스코프를 안 본다 —
      "어느 함수 안에 선언됐나"는 못 가린다(그건 todo-render.test.js 가 실제로 그려 보며 잡는다).
      여기서 잡는 것은 **아예 아무 데도 없는 이름** 하나뿐이다. */
const fs = require('fs');
const path = require('path');
const NL = String.fromCharCode(10);
const SITE = path.join(__dirname, '..', '..');
const page = fs.readFileSync(path.join(SITE, 'todo.html'), 'utf8');

const m = page.match(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/);
if (!m) { console.error('todo.html 에서 스크립트를 못 찾았다'); process.exit(1); }
let src = m[1];

// 주석과 문자열을 지운다 — 그 안의 낱말은 코드가 아니다
src = src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
  .replace(/'(?:[^'\\\n]|\\.)*'/g, "''");

const declared = new Set();
const add = re => { let x; while ((x = re.exec(src))) declared.add(x[1]); };
add(/\bfunction\s+([A-Za-z_$][\w$]*)/g);          // function foo(){}
add(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g); // var foo =
add(/\bvar\s+[^;\n]*?,\s*([A-Za-z_$][\w$]*)/g);   // var a, foo
add(/([A-Za-z_$][\w$]*)\s*=\s*function/g);        // foo = function
add(/function\s*\(([^)]*)\)/g);                   // 인자 목록(통째로 들어가므로 아래서 쪼갠다)
[...declared].forEach(d => { if (d.indexOf(',') >= 0 || d.indexOf(' ') >= 0) d.split(/[\s,]+/).forEach(x => x && declared.add(x)); });
(src.match(/function\s*[A-Za-z_$\w]*\s*\(([^)]*)\)/g) || []).forEach(sig => {
  (sig.match(/\(([^)]*)\)/)[1] || '').split(',').forEach(a => { a = a.trim(); if (a) declared.add(a); });
});

// 브라우저·언어가 주는 것들
const KNOWN = new Set(`if for while switch catch return typeof function new delete void instanceof
in of do else try finally throw case break continue class extends super yield await this
Math JSON Date String Number Boolean Array Object Promise Error RegExp Set Map WeakMap Blob URL
Intl Symbol Proxy Reflect BigInt
parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent encodeURI decodeURI
setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame
alert confirm prompt fetch console window document localStorage sessionStorage navigator
location history screen getComputedStyle matchMedia structuredClone queueMicrotask`.split(/\s+/));

/* 점 뒤(메서드 호출)와 선언부는 빼고, 이름 그대로 부르는 것만 모은다 */
const called = new Set();
let x;
const callRe = /(?<![.?\w$])([A-Za-z_$][\w$]*)\s*\(/g;
while ((x = callRe.exec(src))) called.add(x[1]);

const missing = [...called].filter(n => !declared.has(n) && !KNOWN.has(n)).sort();

if (missing.length) {
  console.log('부르는데 어디에도 선언이 없는 이름:');
  missing.forEach(n => {
    // 어디서 부르는지 한 줄 보여준다
    const line = src.split(NL).findIndex(l => new RegExp('(?<![.\\w$])' + n.replace(/\$/g, '\\$') + '\\s*\\(').test(l));
    console.log('  FAIL  ' + n + '()' + (line >= 0 ? '   (스크립트 ' + (line + 1) + '행 근처)' : ''));
  });
  console.log(NL + '실패 ' + missing.length + '개 — 지운 절에 딸려 나간 함수가 없는지 보라.');
  process.exit(1);
}
console.log('이름 확인: 부르는 것 ' + called.size + '개 모두 선언이 있다 (선언 ' + declared.size + '개).');
process.exit(0);
