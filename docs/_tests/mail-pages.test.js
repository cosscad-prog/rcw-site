/* docs/mail 의 문의 답변 문안 세 통을 **진짜 브라우저에서** 열어 본다.
   실행: node docs/_tests/mail-pages.test.js        (헤드리스 크롬 필요)

   이 문안은 손으로 고쳐 가며 쓰는 것이라, 고치다 스크립트가 깨져도
   화면은 멀쩡해 보인다 — 단추만 죽는다. 그것을 여기서 잡는다.

   보는 것: 예외 / 편지 구조 / 빈 칸 수 / 추천 행 / 단추 동작 / 링크가 실제 파일인가
   ⚠️ 못 잡는 것: 붙여넣은 메일이 실제로 어떻게 보이는가. 그건 한 번 보내 봐야 안다. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const DIR = path.join(__dirname, '..', 'mail');
const FILES = ['reply-1-stick-core.html', 'reply-2-unit-standard.html', 'reply-3-curved-professional.html'];

const CHROME = process.env.CHROME || [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome'
].find(function (p) { try { return fs.existsSync(p); } catch (e) { return false; } });

if (!CHROME) {
  console.log('크롬을 못 찾았습니다. CHROME 환경변수로 경로를 알려주세요. (건너뜀)');
  process.exit(0);
}

const PROBE = `
<script>
(function () {
  var out = {};
  try {
    out['제목'] = document.title;
    var L = document.getElementById('letter');
    out['편지 있음'] = !!L;
    out['절(h2) 수'] = L.querySelectorAll('h2').length;
    out['글자 수'] = L.innerText.replace(/\\s+/g,' ').trim().length;
    out['빈 칸'] = L.querySelectorAll('.fill').length;
    out['표 수'] = L.querySelectorAll('table').length;
    var pick = L.querySelectorAll('tr.pick');
    out['강조 행'] = [].map.call(pick, function (r) { return r.innerText.replace(/\\s+/g,' ').trim(); }).join(' // ');
    out['메일 제목'] = document.getElementById('subject-text').innerText.trim();
    out['링크'] = [].map.call(document.querySelectorAll('.tools nav a'), function (a) { return a.getAttribute('href'); }).join(',');

    // 단추 세 개를 실제로 눌러 본다
    document.getElementById('edit').click();
    out['편집 켜짐'] = L.getAttribute('contenteditable');
    document.getElementById('edit').click();
    out['편집 꺼짐'] = L.getAttribute('contenteditable');
    document.getElementById('marks').click();
    out['빈칸표시 끈 뒤 body'] = document.body.className;
    document.getElementById('marks').click();
    document.getElementById('copy').click();
    out['복사 뒤 class'] = document.body.className || '(없음)';
    out['안내문'] = document.getElementById('say').textContent;
    out['복사 뒤 선택된 글자'] = String(window.getSelection()).replace(/\\s+/g,' ').trim().length;
    // 복사가 막혔을 때는 선택을 남긴다. 다음 클릭·키에서 표시가 되돌아와야 한다.
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    out['다음 클릭 뒤 class'] = document.body.className || '(없음)';
    document.getElementById('subj').click();

    // 편지 안에 도구가 섞여 들어가지 않았나(복사하면 그대로 메일에 간다)
    out['편지 안 button'] = L.querySelectorAll('button').length;
    out['편지 안 no-copy'] = L.querySelectorAll('.tools,.meta').length;
  } catch (e) { out['예외'] = e.message; }
  var pre = document.createElement('pre');
  pre.id = 'probe-out';
  pre.textContent = JSON.stringify(out, null, 1);
  document.body.appendChild(pre);
})();
</script>
`;

const HEAD = `<script>window.__err=[];window.onerror=function(m,s,l){window.__err.push(m+' @'+l);};</script>`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rcw-mail-'));
let bad = 0;

FILES.forEach(function (f, i) {
  const src = fs.readFileSync(path.join(DIR, f), 'utf8');
  const probed = src.replace('</head>', HEAD + '</head>')
                    .replace(/<\/body>/i, PROBE + '</body>');
  const page = path.join(tmp, f);
  fs.writeFileSync(page, probed);

  const dom = execFileSync(CHROME, ['--headless', '--disable-gpu', '--no-sandbox', '--dump-dom',
    '--user-data-dir=' + path.join(tmp, 'p' + i), 'file:///' + page.replace(/\\/g, '/')],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });

  const m = /<pre id="probe-out">([\s\S]*?)<\/pre>/.exec(dom);
  console.log('\n== ' + f);
  if (!m) { console.log('   ✘ 프로브가 못 남겼다 — 스크립트가 그 전에 멎었다'); bad++; return; }
  const got = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
  Object.keys(got).forEach(k => console.log('   ' + k + ': ' + got[k]));

  // 링크가 실제 파일인가
  got['링크'].split(',').forEach(function (href) {
    if (!fs.existsSync(path.join(DIR, href))) { console.log('   ✘ 없는 파일로 링크: ' + href); bad++; }
  });
  if (got['예외']) { console.log('   ✘ 예외'); bad++; }
  if (got['편지 안 button'] !== 0 || got['편지 안 no-copy'] !== 0) { console.log('   ✘ 편지 안에 도구가 섞였다'); bad++; }
  if (got['편집 켜짐'] !== 'true' || got['편집 꺼짐'] !== 'false') { console.log('   ✘ 편집 토글 이상'); bad++; }
  if ((got["다음 클릭 뒤 class"]||"").indexOf("copying") >= 0) { console.log("   ✘ 클릭 뒤에도 copying 이 남았다"); bad++; }
  if (got["복사 뒤 선택된 글자"] < 500 && (got["안내문"]||"").indexOf("Ctrl") >= 0) { console.log("   ✘ 실패했는데 선택도 안 남았다"); bad++; }
  if (got['강조 행'].split('//').length !== 2) { console.log('   ✘ 강조 행이 하나가 아니다'); bad++; }
  if (got['글자 수'] < 1500) { console.log('   ✘ 편지가 너무 짧다'); bad++; }
});

// 원본 파일에 깨진 글자가 없나
FILES.forEach(function (f) {
  const s = fs.readFileSync(path.join(DIR, f), 'utf8');
  if (/[\uFFFD]/.test(s)) { console.log('✘ ' + f + ' 에 깨진 글자'); bad++; }
});

console.log('\n' + (bad ? '▶ ' + bad + '개 문제' : '▶ 전부 OK'));
process.exit(bad ? 1 : 0);
