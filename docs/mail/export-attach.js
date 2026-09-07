/* 편지 HTML → **메일에 첨부할 파일** 로 뽑아낸다.
   실행:  node docs/mail/export-attach.js "docs/mail/컨설팅 문의_1.html"
          node docs/mail/export-attach.js "…" --title "RCW V5 안내" --force

   ★ 왜 이 단계가 필요한가
     작업용 파일에는 위쪽 도구 막대와 안내 상자가 들어 있다. 그 안에는
     "가격 두 칸이 아직 비어 있습니다" 같은 **우리끼리 보는 메모**가 적혀 있다.
     그대로 첨부하면 받는 분이 그것을 전부 읽는다. 여기서 떼어 낸다.

   ★ 떼어 내는 것
       .tools (도구 막대) · .meta (안내 상자) · .subject (메일 제목 칸) · <script>
       노란·파란 표시 색  → 글자만 남는다
   ★ 남기는 것
       편지 본문과 그 서식 전부. 글자는 한 자도 건드리지 않는다.

   ★ 안 채운 자리가 남아 있으면 **만들지 않고 멈춘다.**
     《   》 가 그대로 나간 메일은 되돌릴 수 없다. 일부러 보내려면 --force.

   결과는 원본 옆에 `첨부_<이름>.html` 로 만든다.
   (docs/mail 은 .gitignore 라 고객 이름이 든 파일이 저장소로 새지 않는다) */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const src = args.find(a => !a.startsWith('--'));
const force = args.includes('--force');
const titleIdx = args.indexOf('--title');
const newTitle = titleIdx >= 0 ? args[titleIdx + 1] : null;

if (!src) {
  console.log('쓰는 법: node export-attach.js "<편지.html>" [--title "제목"] [--force]');
  process.exit(2);
}

const full = path.resolve(src);
let html = fs.readFileSync(full, 'utf8');
const before = html.length;

/* ── 1. 우리끼리 보는 부분을 떼어 낸다 ─────────────────────── */
function cut(re, what) {
  const hit = html.match(re);
  html = html.replace(re, '');
  console.log('   ' + (hit ? '뺐다  ' : '없다  ') + what + (hit ? '  (' + hit[0].length + '자)' : ''));
  return !!hit;
}

console.log('\n== 떼어 내기');
cut(/<div class="tools">[\s\S]*?<\/div>\s*(?=<div class="wrap">)/, '도구 막대');
cut(/<div class="meta">[\s\S]*?<\/div>\s*(?=<div class="subject">|<article)/, '안내 상자');
cut(/<div class="subject">[\s\S]*?<\/div>\s*(?=<article)/, '메일 제목 칸');
cut(/<script>[\s\S]*?<\/script>\s*/g, '스크립트');

/* ── 2. 안 채운 자리가 남았나 ───────────────────────────────── */
const letter = (/<article[^>]*id="letter"[^>]*>([\s\S]*?)<\/article>/.exec(html) || [, ''])[1];
const plain = letter.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
const blanks = plain.match(/《[^》]*》/g) || [];

console.log('\n== 안 채운 자리');
if (blanks.length) {
  blanks.forEach(b => console.log('   ⚠ ' + b.replace(/\s+/g, ' ').trim()));
  if (!force) {
    console.log('\n▶ ' + blanks.length + '군데가 비어 있어 만들지 않았습니다.');
    console.log('  원본에서 채우신 뒤 다시 실행하시거나, 일부러 그대로 보내시려면 --force 를 붙이십시오.');
    process.exit(1);
  }
  console.log('   (--force 라 그대로 진행합니다)');
} else {
  console.log('   없음 — 다 채워져 있습니다');
}

/* ── 3. 첨부용으로 다듬는다 ─────────────────────────────────── */
// 화면에서만 쓰던 표시 색을 지운다. 글자는 그대로 둔다.
html = html.replace(/\.fill\s*\{[^}]*\}/g, '.fill { }')
           .replace(/\.chk\s*\{[^}]*\}/g, '.chk { }')
           .replace(/body\.plain[^}]*\}/g, '')
           .replace(/body\.copying[^}]*\}/g, '');

// 받는 분이 파일을 열면 편지 한 장만 보이면 된다. 여백을 조금 넉넉히.
html = html.replace(/\.wrap\s*\{[^}]*\}/,
  '.wrap { max-width:820px; margin:0 auto; padding:34px 18px 60px; }');

/* 없앤 부분의 모양자(CSS)도 지운다. 화면에는 아무 영향이 없지만, 받는 분이
   파일을 열어 소스를 보면 "도구 막대" 같은 것이 있었다는 흔적이 남는다. */
const deadSelectors = /(^|\n)[^\n{}]*(\.tools|\.meta|\.subject|\.btn|\.say)[^\n{}]*\{[^}]*\}/g;
let pruned = 0;
html = html.replace(deadSelectors, function (m, lead) { pruned++; return lead; });
// 남은 빈 줄과 설명 주석 정리
html = html.replace(/\/\*[^*]*(?:도구 막대|편집 안내)[^*]*\*\//g, '')
           .replace(/\n{3,}/g, '\n\n');
console.log('   뺐다  안 쓰는 모양자(CSS) ' + pruned + '개');

if (newTitle) {
  html = html.replace(/<title>[\s\S]*?<\/title>/, '<title>' + newTitle + '</title>');
}

// 파일 맨 위에 한 줄 남긴다 — 나중에 이 파일이 무엇인지 알아보기 위해서다.
html = html.replace(/<head>/,
  '<head>\n<!-- 첨부용으로 뽑은 파일 (' + new Date().toISOString().slice(0, 10) +
  '). 원본: ' + path.basename(full) + ' — 도구 막대와 내부 안내는 빠져 있다. -->');

const out = path.join(path.dirname(full), '첨부_' + path.basename(full));
fs.writeFileSync(out, html);

/* ── 4. 남은 것이 없나 한 번 더 본다 ───────────────────────── */
const check = fs.readFileSync(out, 'utf8');
const leftovers = [
  ['도구 막대', /class="tools"/],
  ['안내 상자', /class="meta"/],
  ['제목 칸',   /class="subject"/],
  ['스크립트',  /<script/i],
  ['내부 문구', /보내기 전에|메일용으로 복사|채울 곳|빈 칸 표시/],
  ['안 쓰는 CSS', /\.(tools|meta|subject|btn|say)[^\n{}]*\{/]
].filter(function (p) { return p[1].test(check); });

// 편지 본문은 한 글자도 줄지 않아야 한다 — 떼어 낸 것은 편지 밖에 있던 것뿐이다.
const outLetter = (/<article[^>]*id="letter"[^>]*>([\s\S]*?)<\/article>/.exec(check) || [, ''])[1];
if (outLetter.length !== letter.length) {
  console.log('   ✘ 편지 본문이 바뀌었다: ' + letter.length + '자 → ' + outLetter.length + '자');
  process.exit(1);
}
console.log('   ✔ 편지 본문 ' + outLetter.length + '자 — 한 글자도 안 바뀜');

console.log('\n== 결과');
console.log('   ' + out);
console.log('   ' + before + '자 → ' + check.length + '자');
if (leftovers.length) {
  console.log('   ✘ 아직 남아 있다: ' + leftovers.map(p => p[0]).join(', '));
  process.exit(1);
}
console.log('   ✔ 우리끼리 보던 부분은 남아 있지 않습니다');
console.log('\n▶ 이 파일을 메일에 첨부하십시오. 보내기 전에 한 번 열어 보시는 것을 권합니다.');
