/* ------------------------------------------------------------------
   고객이 자기 라이선스 상태를 본다 (customer.html → 이 함수)

   요청 : POST { code }
   응답 : 200 { requests: [ { machine_code, status, license_id, issued_at, hold_reason } ] }
          401 | 500

   .lic 본문은 여기서 주지 않는다. 목록이 커지고, 화면에는 필요도 없다.
   실제 파일은 license-file.js 가 한 건씩 내려준다.
------------------------------------------------------------------ */

const { db, readBody, findCustomerByCode } = require('./_rcw');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const customer = await findCustomerByCode(readBody(req).code, 'id');
    if (!customer) return res.status(401).json({ error: 'invalid_code' });

    const rows = await db(
      'license_requests?select=id,machine_code,status,license_id,issued_at,hold_reason,created_at' +
      `&customer_id=eq.${encodeURIComponent(customer.id)}&order=created_at.desc&limit=20`
    );

    return res.status(200).json({ requests: rows || [] });
  } catch (err) {
    console.error('[license] 상태 조회 실패:', err.message);
    return res.status(500).json({ error: 'server_error' });
  }
};
