/* ------------------------------------------------------------------
   발급기가 결과를 올린다 (RCWLicenseIssuer → 이 함수)

   요청 : POST  헤더 x-rcw-admin-token
          발급 : { request_id, license_id, license_file }
          보류 : { request_id, hold_reason }
   응답 : 200 { ok:true, status } | 400 | 401 | 404 | 500

   보류는 사람이 봐야 하는 건이다. 예를 들어 같은 고객이 다른 PC 로 다시 요청하면
   발급기가 자동으로 내주지 않고 이유를 붙여 보류한다(1고객 1대 원칙).
------------------------------------------------------------------ */

const { db, adminTokenMatches, readBody } = require('./_rcw');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (!adminTokenMatches(req.headers['x-rcw-admin-token'])) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const body = readBody(req);
  const requestId = String(body.request_id || '');
  if (!UUID_RE.test(requestId)) return res.status(400).json({ error: 'bad_request_id' });

  const holdReason = body.hold_reason ? String(body.hold_reason).slice(0, 500) : null;
  const licenseId = body.license_id ? String(body.license_id).slice(0, 60) : null;
  const licenseFile = body.license_file ? String(body.license_file) : null;

  if (!holdReason && (!licenseId || !licenseFile)) {
    return res.status(400).json({ error: 'license_or_hold_required' });
  }
  // 서명된 라이선스는 JSON 이다. 형태가 아니면 고객이 못 쓰는 파일이 저장된다.
  if (licenseFile) {
    try {
      const parsed = JSON.parse(licenseFile);
      if (!parsed || !parsed.signature || !parsed.machineCode) {
        return res.status(400).json({ error: 'bad_license_file' });
      }
    } catch {
      return res.status(400).json({ error: 'bad_license_file' });
    }
  }

  try {
    const rows = await db(
      `license_requests?select=id,customer_id,machine_code&id=eq.${encodeURIComponent(requestId)}&limit=1`
    );
    const request = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!request) return res.status(404).json({ error: 'not_found' });

    const patch = holdReason
      ? { status: 'held', hold_reason: holdReason }
      : { status: 'issued', license_id: licenseId, license_file: licenseFile,
          issued_at: new Date().toISOString(), hold_reason: null };

    await db(`license_requests?id=eq.${encodeURIComponent(requestId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(patch)
    });

    // 발급이 끝난 고객은 명부에도 기기코드를 남겨 관리자 화면에서 "발급됨" 으로 보이게 한다.
    if (!holdReason) {
      try {
        await db(`customers?id=eq.${encodeURIComponent(request.customer_id)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ machine_code: request.machine_code })
        });
      } catch (err) {
        console.error('[license] 명부 기기코드 갱신 실패:', err.message);
      }
    }

    return res.status(200).json({ ok: true, status: patch.status });
  } catch (err) {
    console.error('[license] 결과 반영 실패:', err.message);
    return res.status(500).json({ error: 'server_error' });
  }
};
