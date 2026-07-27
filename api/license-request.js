/* ------------------------------------------------------------------
   고객이 머신코드를 올린다 (customer.html → 이 함수 → Supabase)

   ★ 여기서 라이선스를 만들지 않는다. 서명 개인키는 발급 PC 밖으로 나가지 않는다.
   이 함수는 요청을 우편함(license_requests)에 넣어둘 뿐이고, 발급 PC 의 발급기가
   대기 모드에서 가져가 로컬에서 서명한다. 발급기가 꺼져 있으면 아무것도 발급되지
   않는다 — 그게 잠금 장치다.

   요청 : POST { code, machine_code }
   응답 : 200 { status: 'pending'|'issued'|'held' }
          400 { error: 'bad_machine_code'|'edition_mismatch' } | 401 | 500
------------------------------------------------------------------ */

const {
  db, normalizeMachineCode, MACHINE_CODE_RE, editionOfMachineCode,
  clientIp, userAgent, readBody, findCustomerByCode
} = require('./_rcw');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = readBody(req);
  const machineCode = normalizeMachineCode(body.machine_code);

  if (!MACHINE_CODE_RE.test(machineCode)) {
    return res.status(400).json({ error: 'bad_machine_code' });
  }

  try {
    const customer = await findCustomerByCode(body.code, 'id,edition,status');
    if (!customer) return res.status(401).json({ error: 'invalid_code' });
    if (customer.status !== 'active') return res.status(403).json({ error: 'suspended' });

    // Core 고객이 Standard 설치본의 머신코드를 올리는 경우를 막는다.
    // 그대로 두면 발급기가 만들 수 없는 조합이라 나중에 조용히 막힌다.
    const machineEdition = editionOfMachineCode(machineCode);
    if (machineEdition !== customer.edition) {
      return res.status(400).json({
        error: 'edition_mismatch',
        expected: customer.edition,
        found: machineEdition
      });
    }

    // 같은 PC 로 이미 넣었으면 그 상태를 그대로 알려준다(줄을 늘리지 않는다).
    const existing = await db(
      'license_requests?select=id,status' +
      `&customer_id=eq.${encodeURIComponent(customer.id)}` +
      `&machine_code=eq.${encodeURIComponent(machineCode)}&limit=1`
    );
    if (Array.isArray(existing) && existing.length) {
      return res.status(200).json({ status: existing[0].status });
    }

    await db('license_requests', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        customer_id: customer.id,
        machine_code: machineCode,
        status: 'pending',
        ip: clientIp(req),
        user_agent: userAgent(req)
      })
    });

    return res.status(200).json({ status: 'pending' });
  } catch (err) {
    console.error('[license] 요청 접수 실패:', err.message);
    return res.status(500).json({ error: 'server_error' });
  }
};
