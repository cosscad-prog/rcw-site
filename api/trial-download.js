/* ------------------------------------------------------------------
   트라이얼 다운로드 클릭 기록 (trial.html → 이 함수 → downloads)

   ★ 왜 서버로 옮겼는가 (2026-08-24)
     전에는 브라우저가 공개키로 downloads 에 직접 넣었다. 그런데 RLS 정책이
     빠져 있어 **2026-07-26 ~ 08-24 한 달간 한 줄도 들어가지 않았고**, fetch 가
     401 을 예외로 보지 않아 아무도 몰랐다. 서버가 넣으면
       · 실패가 500 으로 드러나고
       · 이름·전화 같은 개인정보를 브라우저가 들고 있을 이유가 없어진다
         (다시 받으러 온 사람은 애초에 그 값을 모른다).

   요청 : POST { request_id, file_name }
   응답 : 200 { ok: true } | 400 | 404 { error: 'not_found' } | 500
------------------------------------------------------------------ */

const { db, readBody } = require('./_rcw');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* 파일명에 버전이 들어갔다가(2026-07-29) 언어가 빠졌다(2026-07-30). 둘 다 선택으로
   두어 캐시된 옛 페이지에서 눌러도 기록이 남게 한다 — 예전 이름만 받는 정규식이라
   그 사이 기록이 통째로 빠진 적이 있다. */
const FILE_RE = /^RCW_V5_(Core|Standard)_Trial_Rhino([78])(?:_(ko-KR|en-US))?(?:_\d+\.\d+\.\d+)?\.exe$/;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = readBody(req);
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
    console.error('[trial-download] 기록 실패:', err.message);
    return res.status(500).json({ error: 'server_error' });
  }

  return res.status(200).json({ ok: true });
};
