/* ------------------------------------------------------------------
   Trial 신청 접수 (trial.html → 이 함수 → Supabase + 텔레그램)

   제품 문의(api/contact.js)와 같은 이유로 서버를 거친다 — 접수된 것을 사람이
   바로 알아야 후속 연락을 할 수 있다.

   ★ 신청 행의 id 는 브라우저가 만들어 보낸다. 그 id 로 나중에 다운로드 클릭을
     같은 신청과 엮기 때문이다(trial.html 의 recordDownload). 그래서 여기서
     새로 만들지 않고 **받은 값을 검사해서 쓰고, 응답으로 되돌려 준다**.
     형식이 어긋나면 서버가 하나 만들어 돌려준다(그래도 연결이 유지된다).

   요청 : POST { id, name, company, email, phone, project_scale, purpose, _gotcha }
   응답 : 200 { ok: true, request_id } | 400 { error: 'bad_request' } | 500
------------------------------------------------------------------ */

const crypto = require('crypto');
const { db, readBody } = require('./_rcw');
const { notifyTrialRequest } = require('./_notify');

// DB 의 check 제약과 같은 한도. 여기서 잘라야 초과 입력이 500 이 아니라 정상 접수가 된다.
const LIMITS = { name: 100, company: 200, email: 200, phone: 50, project_scale: 100, purpose: 2000 };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // honeypot 은 화면에서도 거르지만 봇은 화면을 거치지 않는다. 봇에게 실패를 알려주면
  // 형식을 바꿔 다시 오므로, 성공처럼 응답하고 저장하지 않는다.
  if (field(body._gotcha, 200)) {
    return res.status(200).json({ ok: true, request_id: crypto.randomUUID() });
  }

  const requestId = UUID_RE.test(String(body.id || '')) ? String(body.id).toLowerCase()
                                                        : crypto.randomUUID();

  const row = {
    id:            requestId,
    name:          field(body.name, LIMITS.name),
    company:       field(body.company, LIMITS.company),
    email:         field(body.email, LIMITS.email),
    phone:         field(body.phone, LIMITS.phone),
    project_scale: field(body.project_scale, LIMITS.project_scale),
    purpose:       field(body.purpose, LIMITS.purpose)
  };

  // 화면의 required 와 같은 조건(이름·이메일·연락처).
  if (!row.name || !row.email || !row.phone ||
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) {
    return res.status(400).json({ error: 'bad_request' });
  }

  try {
    await db('trial_requests', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(row)
    });
  } catch (err) {
    console.error('[trial] 신청 저장 실패:', err.message);
    return res.status(500).json({ error: 'server_error' });
  }

  // 저장된 뒤에 알린다. 알림 실패는 접수에 영향을 주지 않는다.
  await notifyTrialRequest(row);

  return res.status(200).json({ ok: true, request_id: requestId });
};
