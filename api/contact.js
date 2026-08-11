/* ------------------------------------------------------------------
   제품 문의 접수 (contact.html → 이 함수 → Supabase + 텔레그램)

   예전에는 브라우저가 공개키로 contacts 에 직접 INSERT 했다. 저장은 됐지만
   Supabase 대시보드를 열어 보기 전에는 문의가 온 줄을 몰랐다. 라이선스 요청과
   같은 이유로(사람이 알아야 다음 동작을 한다) 서버를 한 단계 거치게 하고,
   접수 직후 텔레그램으로 알린다.

   ★ 알림 실패가 접수를 막지 않는다. _notify 가 예외를 안에서 삼킨다.
     환경변수가 없으면 알림만 없고 저장은 정상이다.

   요청 : POST { name, company, phone, email, message, source_page, _gotcha }
   응답 : 200 { ok: true } | 400 { error: 'bad_request' } | 500 { error: 'server_error' }
------------------------------------------------------------------ */

const { db, readBody } = require('./_rcw');
const { notifyContact } = require('./_notify');

// DB 의 check 제약과 같은 한도. 여기서 잘라야 초과 입력이 500 이 아니라 정상 접수가 된다.
const LIMITS = { name: 100, company: 200, phone: 50, email: 200, message: 5000, source_page: 200 };

function field(raw, max) {
  const s = String(raw == null ? '' : raw).trim();
  return s ? s.slice(0, max) : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = readBody(req);

  // honeypot 은 화면에서도 거르지만 봇은 화면을 거치지 않는다. 여기서 한 번 더 본다.
  // 봇에게 실패를 알려주면 형식을 바꿔 다시 온다 → 성공처럼 응답하고 저장하지 않는다.
  if (field(body._gotcha, 200)) return res.status(200).json({ ok: true });

  const row = {
    name:        field(body.name, LIMITS.name),
    company:     field(body.company, LIMITS.company),
    phone:       field(body.phone, LIMITS.phone),
    email:       field(body.email, LIMITS.email),
    message:     field(body.message, LIMITS.message),
    source_page: field(body.source_page, LIMITS.source_page)
  };

  // 화면의 required 와 같은 조건. 여기서 걸러야 DB 의 not null 위반이 500 으로 새지 않는다.
  if (!row.name || !row.email || !row.message || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) {
    return res.status(400).json({ error: 'bad_request' });
  }

  try {
    await db('contacts', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(row)
    });
  } catch (err) {
    console.error('[contact] 문의 저장 실패:', err.message);
    return res.status(500).json({ error: 'server_error' });
  }

  // 저장된 뒤에 알린다. 알림은 부가 기능이라 실패해도 접수는 이미 끝난 것으로 응답한다.
  await notifyContact(row);

  return res.status(200).json({ ok: true });
};
