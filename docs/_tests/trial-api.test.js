/* api/trial.js 를 실제 파일 그대로 불러 fetch 만 가짜로 두고 검증한다.
   실행: node docs/_tests/trial-api.test.js   (설치할 것 없음)   */
const path = require('path');
const SITE = path.join(__dirname, '..', '..');

process.env.SUPABASE_URL = 'https://example.supabase.co/rest/v1/';
process.env.SUPABASE_SERVICE_KEY = 'service-key';
process.env.TELEGRAM_BOT_TOKEN = 'BOTTOKEN';
process.env.TELEGRAM_CHAT_ID = '12345';

let calls = [];
let supabaseMode = 'ok';

global.fetch = async (url, init) => {
  calls.push({ url, init });
  if (String(url).includes('supabase')) {
    if (supabaseMode === 'fail') return { ok: false, status: 400, text: async () => 'boom' };
    return { ok: true, status: 201, text: async () => '' };     // return=minimal INSERT
  }
  return { ok: true, status: 200, text: async () => '{"ok":true}' };
};

const handler = require(path.join(SITE, 'api/trial.js'));

function mkRes() {
  const r = { code: 0, body: null, headers: {} };
  r.status = c => { r.code = c; return r; };
  r.json = b => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  return r;
}

const good = {
  id: '3f2b9c10-4d5e-4a7b-8c9d-0e1f2a3b4c5d',
  name: '김철수', company: '한빛건설', email: 'kim@hanbit.co.kr', phone: '010-2222-3333',
  project_scale: '중규모 (커튼월 1~3개 동)',
  purpose: '가공도 자동 작성이 실제 도면에 쓸 수 있는 수준인지 보고 싶습니다.'
};

async function run(label, body, method = 'POST') {
  calls = [];
  const res = mkRes();
  await handler({ method, headers: {}, body }, res);
  const sb = calls.filter(c => String(c.url).includes('supabase'));
  const tg = calls.filter(c => String(c.url).includes('telegram'));
  console.log(`\n== ${label}`);
  console.log(`   HTTP ${res.code} ${JSON.stringify(res.body)}  supabase=${sb.length} telegram=${tg.length}`);
  if (sb.length) console.log('   row:', sb[0].init.body);
  if (tg.length) console.log('   msg:\n' + JSON.parse(tg[0].init.body).text.split('\n').map(s => '     | ' + s).join('\n'));
  return { res, sb, tg };
}

(async () => {
  const a = await run('정상 신청', good);
  const storedId = JSON.parse(a.sb[0].init.body).id;
  console.log('   ▶ 보낸 id 와 저장 id 와 응답 id 가 같아야 함 →',
    (storedId === good.id && a.res.body.request_id === good.id) ? 'OK' : '실패');

  const b = await run('id 가 엉뚱한 값', { ...good, id: 'not-a-uuid' });
  const bid = JSON.parse(b.sb[0].init.body).id;
  console.log('   ▶ 저장 id == 응답 id (다운로드 연결 유지) →',
    (bid === b.res.body.request_id && /^[0-9a-f-]{36}$/.test(bid)) ? 'OK' : '실패');

  await run('honeypot(봇)', { ...good, _gotcha: 'x' });
  await run('연락처 누락(화면에서도 required)', { ...good, phone: '' });
  await run('이메일 형식 오류', { ...good, email: 'nope' });
  await run('GET', good, 'GET');
  await run('목적란 비움', { ...good, purpose: '' });

  supabaseMode = 'fail';
  const c = await run('Supabase 실패 → 500, 알림 없음', good);
  console.log('   ▶ 기대: 500 & telegram=0 →', (c.res.code === 500 && c.tg.length === 0) ? 'OK' : '실패');
  supabaseMode = 'ok';

  const d = await run('목적 2000자 초과', { ...good, purpose: '가'.repeat(3000) });
  const stored = JSON.parse(d.sb[0].init.body).purpose.length;
  const sent = JSON.parse(d.tg[0].init.body).text.length;
  console.log(`   ▶ 저장 ${stored}자(≤2000), 알림 ${sent}자(≤4096) →`,
    (stored <= 2000 && sent <= 4096) ? 'OK' : '실패');
})();
