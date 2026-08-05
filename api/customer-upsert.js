/* ------------------------------------------------------------------
   라이선스 발급기 → 고객 명부 등록 (RCWLicenseIssuer 가 호출한다)

   왜 이 엔드포인트가 필요한가
     발급기가 Supabase 를 직접 쓰려면 service key 를 데스크톱 exe 가 들고 있어야
     한다. 그 키는 RLS 를 우회해 모든 데이터를 읽고 지울 수 있으므로 프로그램 안에
     두면 안 된다. 대신 이 엔드포인트만 열고, 발급기에는 **여기에만 통하는 토큰**을
     준다. 토큰이 새더라도 할 수 있는 일은 고객 행 하나를 추가/갱신하는 것뿐이다.

   Vercel 환경변수
     CUSTOMER_ADMIN_TOKEN  발급기와 나눠 갖는 긴 무작위 문자열
     SUPABASE_URL / SUPABASE_SERVICE_KEY  (다른 함수와 공용)

   요청 : POST  헤더 x-rcw-admin-token
          { license_id, customer_code, edition, issued_to, machine_code,
            issued_on, expires_on, company, phone, email, note }

   ★ 명부의 열쇠는 **고객 코드**(customer_code)다 — 고객이 로그인할 때 쓰는 값.
   `license_id` 는 .lic 파일 자체의 번호이고 둘은 서로 다르다. 예전에는 license_id 로
   행을 찾아서, 수동 발급 한 번에 같은 사람이 명부에 **두 줄**로 생겼다
   (원래 줄 = 회신대기, .lic 번호로 새로 생긴 줄 = 발급됨). 2026-08-05 실제로 겪었다.
   customer_code 를 안 보내면 예전처럼 license_id 로 찾는다(옛 발급기 호환).
   응답 : 200 { ok:true, action:"inserted"|"updated" } | 401 | 400 | 500

   뒤의 네 칸(company·phone·email·note)은 **새로 만들 때만** 쓴다. 발급기의
   "신규 코드 발급" 이 고객 정보를 함께 보내는 용도이며, 이미 있는 행이면 무시한다.
   손으로 채워 둔 연락처를 라이선스 발급이 덮어쓰면 안 되기 때문이다.

   갱신 규칙
     같은 코드가 이미 있으면 라이선스에서 나오는 값(edition·machine_code·발급일)만
     덮어쓴다. 관리자가 나중에 채워 넣은 회사·전화·이메일은 건드리지 않는다.
------------------------------------------------------------------ */

const crypto = require('crypto');

function supabaseBase() {
  return String(process.env.SUPABASE_URL || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/rest\/v1$/i, '')
    .replace(/\/+$/, '');
}

/** 길이가 달라도 안전하게 비교한다(응답 시간으로 토큰을 추측하지 못하게). */
function tokenMatches(given) {
  const expected = String(process.env.CUSTOMER_ADMIN_TOKEN || '');
  if (!expected) return false;
  const a = Buffer.from(String(given || ''), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) {
    // 길이가 다르면 어차피 불일치지만, 비교 자체는 수행해 시간차를 줄인다
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function normalizeCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function db(path, init = {}) {
  const url = supabaseBase();
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY 환경변수가 없습니다.');

  const res = await fetch(url + '/rest/v1/' + path, {
    ...init,
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
  if (!res.ok) throw new Error('supabase ' + res.status + ' ' + (await res.text()));

  // Prefer: return=minimal 이면 INSERT 는 201 + 빈 본문, PATCH 는 204 를 준다.
  // 상태코드로 빈 본문을 가리려다 201 을 놓쳐서, 저장은 됐는데 500 을 돌려준 적이 있다.
  // 본문이 비었는지로 판단한다.
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (!tokenMatches(req.headers['x-rcw-admin-token'])) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const licenseId = String(body.license_id || '').trim();
  // 행을 찾는 열쇠는 고객 코드다. 없으면 옛 동작(라이선스 번호)으로 떨어진다.
  const customerCode = String(body.customer_code || '').trim();
  const codeKey = normalizeCode(customerCode || licenseId);
  const edition = String(body.edition || '').trim();
  const issuedTo = String(body.issued_to || '').trim();
  const machineCode = String(body.machine_code || '').trim();
  const issuedOn = String(body.issued_on || '').slice(0, 10);   // YYYY-MM-DD
  const expiresOn = String(body.expires_on || '').slice(0, 10) || null;

  if (codeKey.length < 8 || codeKey.length > 40) return res.status(400).json({ error: 'bad_license_id' });
  if (edition !== 'Core' && edition !== 'Standard') return res.status(400).json({ error: 'bad_edition' });
  if (issuedOn && !/^\d{4}-\d{2}-\d{2}$/.test(issuedOn)) return res.status(400).json({ error: 'bad_issued_on' });

  try {
    const existing = await db(`customers?select=id&code_key=eq.${encodeURIComponent(codeKey)}&limit=1`);

    if (Array.isArray(existing) && existing.length) {
      // 라이선스에서 나오는 값만 갱신한다. 손으로 채운 연락처는 그대로 둔다.
      const patch = {
        edition,
        machine_code: machineCode || null,
        issued_on: issuedOn || null,
        expires_on: expiresOn
      };
      // 고객 코드로 찾은 줄이면 license_id 는 건드리지 않는다. 그 칸에는 고객이 로그인에
      // 쓰는 코드가 들어 있고(고객 화면에 "라이선스" 로 보인다), .lic 번호로 덮으면
      // 자동 발급된 고객들과 표시가 어긋난다. 코드를 못 받았을 때만 예전처럼 채운다.
      if (!customerCode) patch.license_id = licenseId;
      await db(`customers?code_key=eq.${encodeURIComponent(codeKey)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(patch)
      });
      return res.status(200).json({ ok: true, action: 'updated' });
    }

    // 새로 만들 때만 받는 값들. 발급기의 "신규 코드 발급" 이 함께 보낸다.
    const trim = (v, max) => {
      const s = String(v == null ? '' : v).trim();
      return s ? s.slice(0, max) : null;
    };
    const company = trim(body.company, 200);
    const phone = trim(body.phone, 50);
    const email = trim(body.email, 200);
    const note = trim(body.note, 500);

    await db('customers', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        code_key: codeKey,
        license_id: licenseId,
        // 회사를 따로 받았으면 issued_to 는 담당자 이름으로 본다.
        // 회사만 있으면 이름 칸은 비워 두고 관리자나 고객이 채우게 한다.
        name: company ? (issuedTo && issuedTo !== company ? issuedTo : null) : (issuedTo || null),
        company,
        phone,
        email,
        note,
        edition,
        machine_code: machineCode || null,
        issued_on: issuedOn || null,
        expires_on: expiresOn,
        status: 'active'
      })
    });
    return res.status(200).json({ ok: true, action: 'inserted' });
  } catch (err) {
    console.error('[customer] 명부 등록 실패:', err.message);
    return res.status(500).json({ error: 'server_error' });
  }
};
