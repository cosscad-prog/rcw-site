/* ------------------------------------------------------------------
   발급기가 대기 중인 요청을 가져간다 (RCWLicenseIssuer 자동 발급 대기 모드)

   요청 : POST  헤더 x-rcw-admin-token   (본문 없음)
   응답 : 200 { requests: [ { id, machine_code, created_at,
                              customer: { license_id, company, name, edition } } ] }
          401 | 500

   발급기가 꺼져 있으면 이 함수는 아무도 부르지 않고, 요청은 그대로 쌓인다.
   즉 "발급기를 켜 두는 동안만 발급된다" 가 이 구조의 잠금 장치다.
------------------------------------------------------------------ */

const { db, adminTokenMatches } = require('./_rcw');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (!adminTokenMatches(req.headers['x-rcw-admin-token'])) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    // PostgREST 의 埋め込み 조회로 고객 정보를 함께 가져온다(발급기가 이름을 보여줘야 한다).
    const rows = await db(
      'license_requests?select=id,machine_code,created_at,' +
      'customers(license_id,company,name,edition,status)' +
      '&status=eq.pending&order=created_at.asc&limit=50'
    );

    const requests = (rows || []).map(r => ({
      id: r.id,
      machine_code: r.machine_code,
      created_at: r.created_at,
      customer: r.customers || null
    }));

    return res.status(200).json({ requests });
  } catch (err) {
    console.error('[license] 대기목록 조회 실패:', err.message);
    return res.status(500).json({ error: 'server_error' });
  }
};
