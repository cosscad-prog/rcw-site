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
    const ok = /^RCW_V5_(Core|Standard)_Rhino[78]_(ko-KR|en-US)\.exe$/.test(fileName);
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(customerId || ''));

    if (ok && isUuid) {
      const url = supabaseBase();
      const key = process.env.SUPABASE_SERVICE_KEY;
      if (url && key) {
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
            file_name: fileName,
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
