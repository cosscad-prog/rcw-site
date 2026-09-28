/* ------------------------------------------------------------------
   플러그인 하루 1회 체크인 (5.4.0 — 설치 파일 하나 계획 5.1절 ③)

   요청 : POST { id, v, ed, rh, lang }
          id   설치 id(무작위 hex, 플러그인 Updates/install-id.txt)
          v    플러그인 버전 5.4.0
          ed   Core · Standard · Core_Trial · Standard_Trial
          rh   7 · 8
          lang ko-KR · en-US
   응답 : 204  |  400 { error }  |  500

   ★ 받는 것은 위 다섯뿐이다. 머신코드·라이선스·도면·이름은 없다(고지와 같은 약속).
     IP 도 저장하지 않는다 — 셀 필요가 없다.
   ★ 한 줄 = (설치 id, Rhino). 설치 id 는 Windows 사용자마다 하나이고 R7·R8 이 같은 값을 쓴다.
     에디션이 바뀌면(평가판 → 정식) 같은 줄에서 edition 만 바뀌고 first_edition 은 남는다 — 전환을 센다.
   ★ 플러그인은 실패를 조용히 넘긴다 — 여기서 무엇이 틀려도 사용자는 모른다. 그래서 형식이 틀리면
     조용히 버리지 말고 400 을 준다(로그로 알아볼 수 있게).
   ★ Cloudflare 전용(functions/api/checkin.js). api/ 에 두지 않는다 — Vercel 뒷문 함수 12개 한도.
------------------------------------------------------------------ */

const { db, readBody } = require('../api/_rcw');

const EDITIONS = ['Core', 'Standard', 'Core_Trial', 'Standard_Trial'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const b = (await readBody(req)) || {};
  const id = String(b.id || '').trim().toLowerCase();
  const version = String(b.v || '').trim();
  const edition = String(b.ed || '').trim();
  const rhino = String(b.rh || '').trim();
  const lang = String(b.lang || '').trim();

  if (!/^[0-9a-f]{8,64}$/.test(id) || !/^\d+\.\d+\.\d+$/.test(version) ||
      EDITIONS.indexOf(edition) < 0 || (rhino !== '7' && rhino !== '8')) {
    return res.status(400).json({ error: 'bad_request' });
  }
  const safeLang = lang === 'ko-KR' || lang === 'en-US' ? lang : null;
  const key = `install_id=eq.${encodeURIComponent(id)}&rhino=eq.${rhino}`;

  try {
    const rows = await db(`plugin_checkins?select=checkins&${key}&limit=1`);
    const now = new Date().toISOString();
    if (Array.isArray(rows) && rows.length) {
      await db(`plugin_checkins?${key}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ edition, version, lang: safeLang, last_seen: now, checkins: (rows[0].checkins || 0) + 1 })
      });
    } else {
      await db('plugin_checkins', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ install_id: id, rhino, edition, first_edition: edition, version, lang: safeLang,
                               first_seen: now, last_seen: now, checkins: 1 })
      });
    }
    return res.status(204).end();
  } catch (err) {
    console.error('[checkin] 기록 실패:', err.message);
    return res.status(500).json({ error: 'server_error' });
  }
};
