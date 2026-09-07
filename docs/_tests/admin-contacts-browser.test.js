/* admin.html 의 [문의] 탭을 **진짜 브라우저에서** 한 번 돌려 본다.
   실행: node docs/_tests/admin-contacts-browser.test.js      (헤드리스 크롬 필요)
   크롬 위치를 못 찾으면  CHROME="C:\\...\\chrome.exe" node ...  로 알려준다.

   왜 필요한가 — admin-ids.test.js 는 이름만 본다. 이름이 다 맞아도 render 안에서
   예외가 하나 나면 목록이 통째로 비고, 화면에는 아무 표시가 안 난다(todo.html 에서
   실제로 그랬다). 여기서는 로그인한 척하고 가짜 Supabase 응답을 물려 준 뒤
   **몇 줄이 그려졌는지 숫자로** 본다.

   ⚠️ 못 잡는 것: 진짜 로그인, RLS 정책, 실제 Supabase 응답 형태.
      "admin can read contacts" 정책이 적용됐는지는 브라우저에서 실제로 열어야 안다. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SITE = path.join(__dirname, '..', '..');

const CHROME = process.env.CHROME || [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome'
].find(p => { try { return fs.existsSync(p); } catch (_) { return false; } });

if (!CHROME) {
  console.log('크롬을 못 찾았습니다. CHROME 환경변수로 경로를 알려주세요. (건너뜀)');
  process.exit(0);
}

/* 가짜 문의 3건. 하나는 줄바꿈·쉼표·따옴표가 든 긴 본문,
   하나는 회사·전화가 빈 것, 하나는 메일 주소가 깨진 것(=[답장] 이 없어야 한다). */
const ROWS = [
  { id: 'c1', created_at: new Date().toISOString(), name: '홍길동', company: '(주)테스트',
    phone: '010-1234-5678', email: 'hong@example.com', source_page: '/contact',
    message: 'Core 와 Standard 차이가 궁금합니다.\n견적도 부탁드립니다, "빠른" 답변 감사합니다.\n' + '길게 '.repeat(80) },
  { id: 'c2', created_at: new Date(Date.now() - 3 * 86400000).toISOString(), name: '김유리',
    company: null, phone: null, email: 'kim@example.com', source_page: '/modeling',
    message: '유리 두께 설정이 안 됩니다.' },
  { id: 'c3', created_at: new Date(Date.now() - 40 * 86400000).toISOString(), name: '주소이상',
    company: '없음', phone: '02-000-0000', email: 'broken-at-example', source_page: null,
    message: '메일 주소가 형식에 안 맞는 줄' }
];

const HEAD_STUB = `
<script>
window.__err = [];
window.onerror = function (m, s, l) { window.__err.push(m + ' @' + l); };
try { sessionStorage.setItem('rcw_admin_token', 'FAKE-TOKEN'); } catch (e) {}
(function () {
  var ROWS = ${JSON.stringify(ROWS)};
  function J(o) { return { ok: true, status: 200, json: function () { return Promise.resolve(o); },
                           text: function () { return Promise.resolve(JSON.stringify(o)); } }; }
  window.fetch = function (url) {
    var u = String(url);
    if (u.indexOf('/rest/v1/contacts') >= 0) return Promise.resolve(J(ROWS));
    if (u.indexOf('releases.json') >= 0) return Promise.resolve(J({ latest: '5.3.0' }));
    if (u.indexOf('api.github.com') >= 0) return Promise.resolve(J({ tag_name: 'v5.3.0', assets: [] }));
    return Promise.resolve(J([]));          // 나머지 표는 빈 목록
  };
})();
</script>
`;

const PROBE = `
<script>
(function () {
  var out = {};
  function push(k, v) { out[k] = v; }
  try {
    document.getElementById('tab-contact').click();
    push('탭 제목', document.getElementById('view-title').textContent);
    push('문의 화면이 보이나', getComputedStyle(document.getElementById('view-contact')).display);
    push('탭 옆 숫자', document.getElementById('tab-contact-n').textContent);
    push('전체 카드', document.getElementById('m-total').textContent);
    push('오늘 카드', document.getElementById('m-today').textContent);
    push('7일 카드', document.getElementById('m-week').textContent);

    var rows = document.querySelectorAll('#mrows tr');
    push('그려진 줄', rows.length);
    push('빈 목록 문구', document.querySelectorAll('#mrows .empty').length);
    push('답장 단추', document.querySelectorAll('#mrows a.btn').length);

    var a = document.querySelector('#mrows a.btn');
    push('답장 링크 앞부분', a ? a.getAttribute('href').slice(0, 60) : '(없음)');
    push('본문 상자', document.querySelectorAll('#mrows .msg').length);

    // 펼치기
    var box = document.querySelector('#mrows .msg');
    box.click();
    push('누른 뒤 open', box.classList.contains('open'));
    box.click();
    push('다시 누르면 접힘', !box.classList.contains('open'));

    // 검색 — 내용으로도 걸려야 한다
    var q = document.getElementById('mq');
    q.value = '유리 두께';
    q.dispatchEvent(new Event('input'));
    push('내용 검색 결과', document.querySelectorAll('#mrows tr').length);
    q.value = '없는말zzz';
    q.dispatchEvent(new Event('input'));
    push('없는 말 검색', document.querySelectorAll('#mrows .empty').length ? '빈 목록 문구' : '이상');
    q.value = '';
    q.dispatchEvent(new Event('input'));
    push('검색 지운 뒤', document.querySelectorAll('#mrows tr').length);

    // CSV — 줄바꿈·쉼표·따옴표가 든 본문이 한 칸 안에 그대로 들어가야 한다
    var grabbed = null;
    var RealBlob = window.Blob;
    window.Blob = function (parts, o) { grabbed = parts.join(''); return new RealBlob(parts, o); };
    window.URL.createObjectURL = function () { return 'blob:fake'; };
    window.URL.revokeObjectURL = function () {};
    HTMLAnchorElement.prototype.click = function () {};      // 진짜로 내려받지 않게
    document.getElementById('csv-btn').click();
    window.Blob = RealBlob;
    push('CSV 첫 줄', grabbed ? grabbed.split('\\r\\n')[0].replace(/^\\uFEFF/, '') : '(안 만들어짐)');
    push('CSV 글자 수', grabbed ? grabbed.length : 0);
    push('CSV 에 따옴표로 감싼 칸', grabbed ? /,"[^"]*\\n/.test(grabbed) : false);
    push('CSV 에 세 사람 다', grabbed ?
      (grabbed.indexOf('hong@example.com') > 0 && grabbed.indexOf('kim@example.com') > 0 &&
       grabbed.indexOf('broken-at-example') > 0) : false);

    // 다른 탭이 망가지지 않았나
    document.getElementById('tab-renew').click();
    push('갱신 탭으로 돌아감', document.getElementById('view-title').textContent);
  } catch (e) {
    push('예외', e.message);
  }
  out['onerror 로 잡힌 것'] = window.__err.length ? window.__err.join(' | ') : '없음';
  var pre = document.createElement('pre');
  pre.id = 'probe-out';
  pre.textContent = JSON.stringify(out, null, 1);
  document.body.appendChild(pre);
})();
</script>
`;

// ── 프로브를 끼운 사본 만들기 ─────────────────────────────────────
const html = fs.readFileSync(path.join(SITE, 'admin.html'), 'utf8');
const probeHtml = html.replace('</head>', HEAD_STUB + '</head>').replace(/<\/body>/i, PROBE + '</body>');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rcw-admin-'));
const page = path.join(tmp, 'admin-probe.html');
fs.writeFileSync(page, probeHtml);

// 끼워 넣은 것이 실제로 들어갔는지 눈으로 확인한다(치환이 조용히 실패한 적이 있다)
const wrote = fs.readFileSync(page, 'utf8');
console.log('\n== 프로브 사본: ' + page);
console.log('   head 스텁 ' + (wrote.indexOf('FAKE-TOKEN') > 0 ? '들어감' : '★안 들어감') +
            ' / 프로브 ' + (wrote.indexOf('probe-out') > 0 ? '들어감' : '★안 들어감') +
            ' / 가짜 문의 ' + ROWS.length + '건');

const dom = execFileSync(CHROME, [
  '--headless', '--disable-gpu', '--no-sandbox', '--dump-dom',
  '--user-data-dir=' + path.join(tmp, 'profile'),      // 실행마다 새 프로필
  'file:///' + page.replace(/\\/g, '/')
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });

const m = /<pre id="probe-out">([\s\S]*?)<\/pre>/.exec(dom);
if (!m) {
  console.log('\n▶ 실패 — 프로브가 아무것도 못 남겼다(스크립트가 그 전에 멎었다는 뜻).');
  process.exit(1);
}
const got = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
console.log('');
Object.keys(got).forEach(k => console.log('   ' + k + ': ' + got[k]));

let fails = 0;
function want(label, cond) {
  console.log('   ' + (cond ? '✔' : '✘ 실패') + ' ' + label);
  if (!cond) fails++;
}
console.log('');
want('예외 없음', !got['예외'] && got['onerror 로 잡힌 것'] === '없음');
want('문의 화면이 열린다', got['문의 화면이 보이나'] === 'block');
want('제목이 문의 탭', String(got['탭 제목']).indexOf('문의') === 0);
want('3건 다 그려졌다', got['그려진 줄'] === 3 && got['빈 목록 문구'] === 0);
want('카드 숫자 = 3건 · 오늘 1 · 7일 2', got['전체 카드'] === '3' && got['오늘 카드'] === '1' && got['7일 카드'] === '2');
want('탭 옆에 (3)', got['탭 옆 숫자'] === '(3)');
want('답장 단추는 주소가 성한 2건만', got['답장 단추'] === 2);
want('답장 링크가 mailto', String(got['답장 링크 앞부분']).indexOf('mailto:hong@example.com?subject=') === 0);
want('본문 상자 3개', got['본문 상자'] === 3);
want('눌러 펼치고 다시 접힌다', got['누른 뒤 open'] === true && got['다시 누르면 접힘'] === true);
want('내용으로 검색된다(1건)', got['내용 검색 결과'] === 1);
want('없는 말은 빈 목록', got['없는 말 검색'] === '빈 목록 문구');
want('검색을 지우면 3건', got['검색 지운 뒤'] === 3);
want('CSV 머리글', got['CSV 첫 줄'] === '접수,이름,회사,전화번호,이메일,어느 페이지,문의 내용');
want('CSV 가 비어 있지 않다(500자 이상)', got['CSV 글자 수'] > 500);
want('줄바꿈 든 본문이 따옴표 안에 있다', got['CSV 에 따옴표로 감싼 칸'] === true);
want('CSV 에 세 건 다 들어갔다', got['CSV 에 세 사람 다'] === true);
want('다른 탭도 멀쩡', String(got['갱신 탭으로 돌아감']).indexOf('갱신') === 0);

console.log('\n' + (fails ? '▶ ' + fails + '개 실패' : '▶ 전부 OK'));
process.exit(fails ? 1 : 0);
