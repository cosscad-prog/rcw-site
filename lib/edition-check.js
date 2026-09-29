/* ------------------------------------------------------------------
   설치기가 고객 코드로 에디션을 묻는다 (RCW5 설치 파일 하나 — 5.4.0 예정)

   요청 : POST { code: "RCW-XXXX-XXXX-XXXX" }        (옛 V5KO- 코드도 받는다)
          POST { event: "installed", v, rh, ed, code? }   설치가 끝났다는 알림(아래 installed())
   응답 : 200 { edition: "Core" | "Standard" }
          401 { error: "invalid_code" }             명부에 없다
          403 { error: "suspended" }                 중지된 고객
          429 { error: "too_many_attempts" }
          500 { error: "server_error" }

   ★ 돌려주는 것은 <b>에디션 하나</b>뿐이다. 회사·이름·연락처는 주지 않는다 —
     설치기는 그것이 필요 없고, 코드 하나로 남의 정보를 읽는 길이 되면 안 된다.
   ★ Cloudflare 전용이다(functions/api/edition-check.js 가 이 파일을 연다).
     api/ 에 두지 않는다 — Vercel 뒷문(옛 주소)은 함수 12개 한도가 있고, 이 요청은
     새 설치기만 새 주소로 보낸다(2026-09-28 계획 docs/development/SINGLE_INSTALLER_PLAN).
   ★ "설치 완료" 알림(2026-09-29): 설치기가 파일 복사를 마친 뒤 한 번 보낸다 — 처음 설치·새 버전 알림·
     조용한 설치 모두. customer_access 에 'installer_installed' 한 줄(회사·이름·버전·Rhino·에디션).
     평가판은 코드 없이 온다(익명 한 줄). 코드 원문은 저장하지 않는다. 응답은 언제나 204 —
     코드가 맞는지 알려 주지 않는다(이 길로 코드를 맞혀 볼 수 없게). 설치는 이미 끝났으니 설치기도 결과를 보지 않는다.
     "설치했다" 까지만 안다 — 지웠는지·쓰는지는 모른다(사용자 확인 2026-09-29).
   ★ 막는 기준은 고객 페이지 로그인과 같다(같은 IP 10분에 10번 실패).
     실패는 customer_access 에 'installer_check_failed' 로 남기고, 로그인 실패와 함께 센다.
------------------------------------------------------------------ */

const { db, normalizeCode, clientIp, userAgent, readBody } = require('../api/_rcw');

const FAIL_WINDOW_MIN = 10;
const FAIL_LIMIT = 10;
const EDITIONS = ['Core', 'Standard', 'Core_Trial', 'Standard_Trial'];

async function log(row) {
  try {
    await db('customer_access', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(row)
    });
  } catch (err) {
    console.error('[edition-check] 기록 실패:', err.message);   // 기록 실패가 설치를 막지 않는다
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const ip = clientIp(req);
  const agent = userAgent(req);
  const body = await readBody(req);
  if (body && body.event === 'installed') return installed(req, res, body, ip, agent);
  const codeKey = normalizeCode(body && body.code);
  if (codeKey.length < 8 || codeKey.length > 40) {
    return res.status(401).json({ error: 'invalid_code' });
  }

  try {
    const since = new Date(Date.now() - FAIL_WINDOW_MIN * 60000).toISOString();
    const recent = await db(
      `customer_access?select=id&action=in.(login_failed,installer_check_failed)&ip=eq.${encodeURIComponent(ip)}` +
      `&created_at=gte.${encodeURIComponent(since)}&limit=${FAIL_LIMIT}`
    );
    if (Array.isArray(recent) && recent.length >= FAIL_LIMIT) {
      return res.status(429).json({ error: 'too_many_attempts', retry_after_min: FAIL_WINDOW_MIN });
    }

    // 새 코드(code_key) → 없으면 옛 코드(legacy_code_key). 고객 페이지 로그인과 같은 순서다.
    const select = 'customers?select=id,company,name,edition,status';
    let rows = await db(`${select}&code_key=eq.${encodeURIComponent(codeKey)}&limit=1`);
    if (!(Array.isArray(rows) && rows.length)) {
      try { rows = await db(`${select}&legacy_code_key=eq.${encodeURIComponent(codeKey)}&limit=1`); }
      catch { rows = null; }
    }
    const customer = Array.isArray(rows) && rows.length ? rows[0] : null;

    if (!customer) {
      await log({ action: 'installer_check_failed', code_tried: codeKey.slice(0, 60), ip, user_agent: agent });
      return res.status(401).json({ error: 'invalid_code' });
    }

    await log({ action: 'installer_check', customer_id: customer.id, company: customer.company || null,
                name: customer.name || null, ip, user_agent: agent });

    if (customer.status !== 'active') {
      return res.status(403).json({ error: 'suspended' });
    }
    if (customer.edition !== 'Core' && customer.edition !== 'Standard') {
      // 명부의 에디션 칸이 비었거나 모르는 값이면 설치기가 추측하지 않게 서버 오류로 돌려준다.
      console.error('[edition-check] 명부 에디션 값이 이상하다:', customer.id, customer.edition);
      return res.status(500).json({ error: 'server_error' });
    }
    return res.status(200).json({ edition: customer.edition });
  } catch (err) {
    console.error('[edition-check] 처리 실패:', err.message);
    return res.status(500).json({ error: 'server_error' });
  }
};

// 설치 완료 알림 — 무엇이 와도 204. 형식이 틀린 값은 적지 않는다.
async function installed(req, res, body, ip, agent) {
  const version = /^\d+\.\d+\.\d+$/.test(String(body.v || '')) ? String(body.v) : null;
  const rhino = body.rh === '7' || body.rh === '8' ? body.rh : null;
  const edition = EDITIONS.includes(body.ed) ? body.ed : null;
  if (!version || !rhino || !edition) return res.status(204).end();

  const row = { action: 'installer_installed', version, rhino, edition, ip, user_agent: agent };
  const codeKey = normalizeCode(body.code);
  if (!/_Trial$/.test(edition) && codeKey.length >= 8 && codeKey.length <= 40) {
    try {
      const select = 'customers?select=id,company,name';
      let rows = await db(`${select}&code_key=eq.${encodeURIComponent(codeKey)}&limit=1`);
      if (!(Array.isArray(rows) && rows.length)) {
        rows = await db(`${select}&legacy_code_key=eq.${encodeURIComponent(codeKey)}&limit=1`);
      }
      const c = Array.isArray(rows) && rows.length ? rows[0] : null;
      if (c) { row.customer_id = c.id; row.company = c.company || null; row.name = c.name || null; }
    } catch (err) {
      console.error('[edition-check] 설치 완료 — 고객 조회 실패:', err.message);   // 고객 없이라도 한 줄은 남긴다
    }
  }
  await log(row);
  return res.status(204).end();
}
