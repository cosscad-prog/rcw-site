/* api/contact.js 를 실제 파일 그대로 불러 fetch 만 가짜로 두고 검증한다.
   실행: node docs/_tests/contact-api.test.js   (설치할 것 없음)   */
const path = require('path');
const SITE = path.join(__dirname, '..', '..');

process.env.SUPABASE_URL = 'https://example.supabase.co/rest/v1/';   // 끝에 /rest/v1 붙은 형태(함정3)
process.env.SUPABASE_SERVICE_KEY = 'service-key';
process.env.TELEGRAM_BOT_TOKEN = 'BOTTOKEN';
process.env.TELEGRAM_CHAT_ID = '12345';

let calls = [];
let supabaseMode = 'ok';      // ok | fail
let telegramMode = 'ok';      // ok | fail

global.fetch = async (url, init) => {
  calls.push({ url, init });
  if (String(url).includes('supabase')) {
    if (supabaseMode === 'fail') return { ok: false, status: 400, text: async () => 'boom' };
    // Prefer: return=minimal INSERT = 201 + 빈 본문 (함정2)
    return { ok: true, status: 201, text: async () => '' };
  }
  if (telegramMode === 'fail') return { ok: false, status: 400, text: async () => 'chat not found' };
  return { ok: true, status: 200, text: async () => '{"ok":true}' };
};

const handler = require(path.join(SITE, 'api/contact.js'));

function mkRes() {
  const r = { code: 0, body: null, headers: {} };
  r.status = c => { r.code = c; return r; };
  r.json = b => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  return r;
}

const good = {
  name: '  홍길동  ', company: '(주)테스트', phone: '010-1234-5678',
  email: 'test@example.com', message: 'Core 와 Standard 차이가 궁금합니다.\n<b>태그</b> & 특수문자',
  source_page: '/contact'
};

async function run(label, body, method = 'POST') {
  calls = [];
  const res = mkRes();
  await handler({ method, headers: {}, body }, res);
  const sb = calls.filter(c => String(c.url).includes('supabase'));
  const tg = calls.filter(c => String(c.url).includes('telegram'));
  console.log(`\n== ${label}`);
  console.log(`   HTTP ${res.code} ${JSON.stringify(res.body)}  supabase=${sb.length} telegram=${tg.length}`);
  if (sb.length) console.log('   url:', sb[0].url, '\n   row:', sb[0].init.body);
  if (tg.length) console.log('   msg:\n' + JSON.parse(tg[0].init.body).text.split('\n').map(s => '     | ' + s).join('\n'));
  return { res, sb, tg };
}

(async () => {
  await run('정상 문의', good);
  await run('honeypot(봇)', { ...good, _gotcha: 'http://spam' });
  await run('이메일 형식 오류', { ...good, email: 'nope' });
  await run('필수 누락(message 공백)', { ...good, message: '   ' });
  await run('GET 요청', good, 'GET');

  telegramMode = 'fail';
  const a = await run('텔레그램 실패 → 접수는 성공해야 함', good);
  console.log('   ▶ 기대: HTTP 200 →', a.res.code === 200 ? 'OK' : '실패');
  telegramMode = 'ok';

  supabaseMode = 'fail';
  const b = await run('Supabase 실패 → 500, 알림 없음', good);
  console.log('   ▶ 기대: 500 & telegram=0 →', (b.res.code === 500 && b.tg.length === 0) ? 'OK' : '실패');
  supabaseMode = 'ok';

  const long = await run('본문 5000자 초과', { ...good, message: 'ㄱ'.repeat(6000) });
  const stored = JSON.parse(long.sb[0].init.body).message.length;
  const sent = JSON.parse(long.tg[0].init.body).text.length;
  console.log(`   ▶ 저장 ${stored}자(≤5000), 알림 ${sent}자(≤4096) →`,
    (stored <= 5000 && sent <= 4096) ? 'OK' : '실패');
})();
