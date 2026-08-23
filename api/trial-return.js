/* ------------------------------------------------------------------
   이미 신청한 사람이 **다시 받으러** 왔을 때 (trial.html → 이 함수)

   왜 필요한가
     새 버전이 나오면 기존 트라이얼 사용자에게 다시 받으라고 안내해야 하는데,
     신청 폼을 처음부터 다시 채워야 했다. 설치 파일 주소는 어차피 공개라
     (github releases/latest/download/…) 폼은 잠금장치가 아니라 접수창구다.
     막을 것이 없으니 다시 오는 길을 열어 준다.

   두 가지 길
     ① 안내 메일의 개인 링크  /trial?r=<신청번호>   → 입력 0회
     ② 링크를 잃었을 때        메일 주소 한 칸

   ★ 개인정보는 브라우저로 돌려주지 않는다. 신청 번호만 준다.
     ②는 남의 메일 주소를 넣어 볼 수 있으므로, 이름·전화가 나가면 안 된다.
     다운로드 기록에 넣을 이름·회사는 기록할 때 서버가 직접 읽는다
     (api/trial-download.js).

   요청 : POST { request_id } | { email }
   응답 : 200 { ok: true, request_id } | 404 { error: 'not_found' } | 400 | 500
------------------------------------------------------------------ */

const { db, readBody } = require('./_rcw');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = readBody(req);
  const id    = String(body.request_id || '').trim();
  const email = String(body.email || '').trim().toLowerCase();

  let query = null;
  if (UUID_RE.test(id)) {
    query = 'trial_requests?select=id&id=eq.' + encodeURIComponent(id.toLowerCase()) + '&limit=1';
  } else if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    // 같은 주소로 여러 번 신청했으면 가장 처음 것으로 잇는다. 그래야 그 사람의
    // 다운로드가 한 줄에 모이고 관리자 화면의 회차 표시가 맞는다.
    // ★ eq 가 아니라 ilike 다. 저장된 값은 사람이 친 그대로라 대소문자가 섞여 있고
    //   (실제로 'Test@gmail.com' 이 들어와 있었다), eq 는 대소문자를 가린다.
    //   와일드카드 없는 ilike 가 곧 대소문자 무시 일치다.
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
    console.error('[trial-return] 조회 실패:', err.message);
    return res.status(500).json({ error: 'server_error' });
  }
};
