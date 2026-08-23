/* ------------------------------------------------------------------
   Trial 창구 하나 (trial.html → 이 함수 → Supabase + 텔레그램)

     action 없음    신청 접수        → trial_requests + 텔레그램
     action=return  다시 받으러 옴   → 신청 번호만 확인
     action=download 다운로드 클릭   → downloads 기록

   ★ 왜 파일 하나에 셋을 넣었나 (2026-08-24)
     Vercel Hobby 는 **한 배포에 서버리스 함수 12개**까지다. 이미 11개였는데
     trial-return.js · trial-download.js 를 따로 두었더니 13개가 되어 **배포가
     통째로 실패**했다. 실패해도 옛 배포가 계속 서비스되므로 화면은 멀쩡해
     보이고, 새 기능만 조용히 없다. 함수를 새로 만들 때는 개수를 먼저 셀 것.

   제품 문의(api/contact.js)와 같은 이유로 서버를 거친다 — 접수된 것을 사람이
   바로 알아야 후속 연락을 할 수 있다.

   ★ 신청 행의 id 는 브라우저가 만들어 보낸다. 그 id 로 나중에 다운로드 클릭을
     같은 신청과 엮기 때문이다(trial.html 의 recordDownload). 그래서 여기서
     새로 만들지 않고 **받은 값을 검사해서 쓰고, 응답으로 되돌려 준다**.
     형식이 어긋나면 서버가 하나 만들어 돌려준다(그래도 연결이 유지된다).

   요청 : POST { id, name, company, email, phone, project_scale, purpose, _gotcha }
          POST { action: 'return',   request_id } | { action: 'return', email }
          POST { action: 'download', request_id, file_name }
   응답 : 200 { ok: true, request_id } | 400 | 404 | 500
------------------------------------------------------------------ */

const crypto = require('crypto');
const { db, readBody } = require('./_rcw');
const { notifyTrialRequest } = require('./_notify');

// DB 의 check 제약과 같은 한도. 여기서 잘라야 초과 입력이 500 이 아니라 정상 접수가 된다.
const LIMITS = { name: 100, company: 200, email: 200, phone: 50, project_scale: 100, purpose: 2000 };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* 파일명에 버전이 들어갔다가(2026-07-29) 언어가 빠졌다(2026-07-30). 둘 다 선택으로
   두어 캐시된 옛 페이지에서 눌러도 기록이 남게 한다 — 예전 이름만 받는 정규식이라
   그 사이 기록이 통째로 빠진 적이 있다. */
const FILE_RE = /^RCW_V5_(Core|Standard)_Trial_Rhino([78])(?:_(ko-KR|en-US))?(?:_\d+\.\d+\.\d+)?\.exe$/;

function field(raw, max) {
  const s = String(raw == null ? '' : raw).trim();
  return s ? s.slice(0, max) : null;
}

/* ── 다시 받으러 온 사람 ──────────────────────────────────────────────
   ① 안내 메일의 개인 링크  /trial?r=<신청번호>   → 입력 0회
   ② 링크를 잃었을 때        메일 주소 한 칸

   ★ 개인정보는 돌려주지 않는다. 신청 번호만 준다 — ②는 남의 메일 주소를
     넣어 볼 수 있으므로 이름·전화가 나가면 안 된다. 기록에 넣을 이름·회사는
     기록할 때 서버가 직접 읽는다(아래 handleDownload). */
async function handleReturn(body, res) {
  const id    = String(body.request_id || '').trim();
  const email = String(body.email || '').trim().toLowerCase();

  let query;
  if (UUID_RE.test(id)) {
    query = 'trial_requests?select=id&id=eq.' + encodeURIComponent(id.toLowerCase()) + '&limit=1';
  } else if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    // ★ eq 가 아니라 ilike 다. 저장된 값은 사람이 친 그대로라 대소문자가 섞여 있다
    //   (실제로 'Test@gmail.com' 이 들어와 있었다). 와일드카드 없는 ilike 가
    //   곧 대소문자 무시 일치다.
    //   같은 주소로 여러 번 신청했으면 가장 처음 것으로 잇는다 — 그래야 그 사람의
    //   다운로드가 한 줄에 모이고 관리자 화면의 회차 표시가 맞는다.
    query = 'trial_requests?select=id&email=ilike.' + encodeURIComponent(email) +
            '&order=created_at.asc&limit=1';
  } else {
    return res.status(400).json({ error: 'bad_request' });
  }

  try {
    const rows = await db(query);
    if (!rows || !rows.length) return res.status(404).json({ error: 'not_found' });
    return res.status(200).json({ ok: true, request_id: rows[0].id });
  } catch (err) {
    console.error('[trial] 재방문 조회 실패:', err.message);
    return res.status(500).json({ error: 'server_error' });
  }
}

/* ── 다운로드 클릭 기록 ───────────────────────────────────────────────
   ★ 왜 서버가 넣는가 (2026-08-24)
     전에는 브라우저가 공개키로 downloads 에 직접 넣었다. RLS 정책이 빠져 있어
     **2026-07-26 ~ 08-24 한 달간 한 줄도 들어가지 않았고**, fetch 가 401 을
     예외로 보지 않아 아무도 몰랐다. 서버가 넣으면 실패가 500 으로 드러나고,
     다시 받으러 온 사람처럼 자기 이름을 모르는 경우에도 기록이 온전하다. */
async function handleDownload(body, res) {
  const id = String(body.request_id || '').trim().toLowerCase();
  const m  = FILE_RE.exec(String(body.file_name || '').trim());
  if (!UUID_RE.test(id) || !m) return res.status(400).json({ error: 'bad_request' });

  try {
    // 이름·회사·전화는 신청 행에서 그대로 베낀다. 신청 정보가 나중에 바뀌어도
    // 그때 누가 받았는지가 기록에 남아야 한다.
    const rows = await db('trial_requests?select=id,name,company,phone,email&id=eq.' +
                          encodeURIComponent(id) + '&limit=1');
    if (!rows || !rows.length) return res.status(404).json({ error: 'not_found' });

    const r = rows[0];
    await db('downloads', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        request_id: r.id,
        name:       r.name,
        company:    r.company,
        phone:      r.phone,
        email:      r.email,
        edition:    m[1],
        rhino:      m[2],
        lang:       m[3] || null,   // 설치할 때 고르므로 파일명으로는 알 수 없다
        file_name:  String(body.file_name).trim()
      })
    });
  } catch (err) {
    console.error('[trial] 다운로드 기록 실패:', err.message);
    return res.status(500).json({ error: 'server_error' });
  }

  return res.status(200).json({ ok: true });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = readBody(req);

  // 갈래를 먼저 정한다. 아래 honeypot 은 **신청 전용**이라 그 앞에 둔다.
  const action = String(body.action || '').trim();
  if (action === 'return')   return handleReturn(body, res);
  if (action === 'download') return handleDownload(body, res);

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
