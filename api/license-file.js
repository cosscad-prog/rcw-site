/* ------------------------------------------------------------------
   고객이 발급된 .lic 파일을 내려받는다 (customer.html → 이 함수)

   요청 : POST { code, request_id }
   응답 : 200 라이선스 JSON 본문 (파일 첨부)  | 401 | 404 | 500

   ★ 자기 것만 받을 수 있어야 한다. request_id 만으로 찾지 않고
     "그 코드의 고객이 소유한 요청" 인지 함께 대조한다.
------------------------------------------------------------------ */

const { db, readBody, findCustomerByCode } = require('./_rcw');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = readBody(req);
  const requestId = String(body.request_id || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
    return res.status(404).json({ error: 'not_found' });
  }

  try {
    const customer = await findCustomerByCode(body.code, 'id');
    if (!customer) return res.status(401).json({ error: 'invalid_code' });

    const rows = await db(
      'license_requests?select=license_id,license_file,status' +
      `&id=eq.${encodeURIComponent(requestId)}` +
      `&customer_id=eq.${encodeURIComponent(customer.id)}&limit=1`
    );
    const row = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!row || row.status !== 'issued' || !row.license_file) {
      return res.status(404).json({ error: 'not_found' });
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition',
      'attachment; filename="' + (row.license_id || 'RCW_V5') + '.lic"');
    return res.status(200).send(row.license_file);
  } catch (err) {
    console.error('[license] 파일 내려주기 실패:', err.message);
    return res.status(500).json({ error: 'server_error' });
  }
};
