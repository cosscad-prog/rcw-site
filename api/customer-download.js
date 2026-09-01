/* ------------------------------------------------------------------
   고객 다운로드 클릭 기록 (customer.html → 이 함수 → Supabase)

   customers 와 customer_access 에는 anon 권한이 없으므로 트라이얼 페이지처럼
   브라우저가 직접 INSERT 할 수 없다. 그래서 기록도 서버를 거친다.

   요청 : POST { customer_id, file_name }
   응답 : 204 (항상). 기록 실패가 다운로드를 막아서는 안 된다.
------------------------------------------------------------------ */

/** customer-login.js 와 같은 이유로, .../rest/v1/ 까지 붙은 값도 받아들인다. */
function supabaseBase() {
  return String(process.env.SUPABASE_URL || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/rest\/v1$/i, '')
    .replace(/\/+$/, '');
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim().slice(0, 60);
  return (req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : '').slice(0, 60);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

    const customerId = body && body.customer_id;
    const fileName = String((body && body.file_name) || '').slice(0, 200);

    // 파일명은 정해진 형태만 받는다. 아무 문자열이나 기록에 남지 않게 한다.
    // 버전은 2026-07-29 에 들어왔고 언어는 2026-07-30 에 빠졌다. 둘 다 선택으로 두어
    // 캐시된 옛 페이지에서 눌러도 기록이 남게 한다(예전 형태만 받다가 그 사이 기록이
    // 통째로 빠졌었다).
    const ok = /^RCW_V5_(Core|Standard)_Rhino[78](?:_(?:ko-KR|en-US))?(?:_\d+\.\d+\.\d+)?\.exe$/.test(fileName);
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(customerId || ''));

    // 버전은 화면이 알려 준다. 있으면 좋은 값이지 필수가 아니다 — 형식이 어긋나거나
    // 캐시된 옛 페이지가 안 보내면 비운 채 기록한다(기록이 통째로 빠지는 것보다 낫다).
    const rawVer  = String((body && body.version) || '').trim();
    const version = /^\d+\.\d+\.\d+$/.test(rawVer) ? rawVer : null;

    if (ok && isUuid) {
      const url = supabaseBase();
      const key = process.env.SUPABASE_SERVICE_KEY;
      if (url && key) {
        // 회사·이름을 명부에서 베껴 둔다. 표만 보고 누가 받아 갔는지 알 수 있어야 하고,
        // 명부가 나중에 바뀌어도 그때 누구였는지가 남아야 한다(트라이얼 downloads 와 같은 원칙).
        // 조회 실패는 무시한다 — 이름 두 칸 때문에 다운로드 기록 자체를 잃는 것이 더 나쁘다.
        let company = null, name = null;
        try {
          const who = await fetch(url + '/rest/v1/customers?select=company,name&id=eq.' +
                                  encodeURIComponent(customerId) + '&limit=1',
                                  { headers: { apikey: key, Authorization: 'Bearer ' + key } });
          if (who.ok) {
            const rows = await who.json();
            if (Array.isArray(rows) && rows.length) {
              company = rows[0].company || null;
              name    = rows[0].name    || null;
            }
          }
        } catch { /* 이름 없이라도 기록은 남긴다 */ }

        await fetch(url + '/rest/v1/customer_access', {
          method: 'POST',
          headers: {
            apikey: key,
            Authorization: 'Bearer ' + key,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal'
          },
          body: JSON.stringify({
            action: 'download',
            customer_id: customerId,
            company,
            name,
            file_name: fileName,
            version,
            ip: clientIp(req),
            user_agent: String(req.headers['user-agent'] || '').slice(0, 300)
          })
        });
      }
    }
  } catch (err) {
    console.error('[customer] 다운로드 기록 실패:', err.message);
  }

  return res.status(204).end();
};
