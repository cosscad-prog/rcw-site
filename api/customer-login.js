/* ------------------------------------------------------------------
   기존 고객 로그인 (customer.html → 이 함수 → Supabase)

   왜 서버에서 하는가
     고객 명부를 브라우저가 직접 조회하게 만들면, 페이지에 넣는 공개키로
     남의 명단까지 읽을 수 있게 된다. 그래서 customers 테이블에는 anon 권한을
     하나도 주지 않고(docs/supabase-customers.sql), RLS 를 우회하는 service key 를
     이 함수 안에서만 쓴다. 키는 Vercel 환경변수에 두고 코드에는 넣지 않는다.

   Vercel 환경변수 (Project Settings → Environment Variables)
     SUPABASE_URL          https://xxxxxxxx.supabase.co
     SUPABASE_SERVICE_KEY  service_role 키 ★절대 공개 금지
     CUSTOMER_RELEASE_REPO cosscad-prog/rcw-customer-releases (기본값 있음)

   요청 : POST { code: "V5KO-497E84809694" }
   응답 : 200 { customer, files, release }  |  401 { error }  |  429 { error }
------------------------------------------------------------------ */

const RELEASE_REPO = process.env.CUSTOMER_RELEASE_REPO || 'cosscad-prog/rcw-customer-releases';

// 같은 IP 에서 이 시간(분) 안에 이만큼 실패하면 잠시 막는다.
// 코드가 48비트 무작위라 대입은 사실상 불가능하지만, 로그를 더럽히는 시도는 막는다.
const FAIL_WINDOW_MIN = 10;
const FAIL_LIMIT = 10;

/** 고객이 어떻게 입력하든 같은 값으로 맞춘다. 'v5ko-497e 8480 9694' → 'V5KO497E84809694' */
function normalizeCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim().slice(0, 60);
  return (req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : '').slice(0, 60);
}

/** Supabase REST 호출. service key 라 RLS 를 통과한다. */
async function db(path, init = {}) {
  const url = process.env.SUPABASE_URL;
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
  return res.status === 204 ? null : res.json();
}

/** 기록은 실패해도 로그인을 막지 않는다. 기록 때문에 고객이 못 들어가면 본말전도다. */
async function log(row) {
  try {
    await db('customer_access', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(row)
    });
  } catch (err) {
    console.error('[customer] 기록 실패:', err.message);
  }
}

/** 최신 릴리스 태그를 보여주기 위한 조회. 실패해도 다운로드는 되어야 하므로 무시한다. */
async function latestRelease() {
  try {
    const res = await fetch('https://api.github.com/repos/' + RELEASE_REPO + '/releases/latest', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'rcw-site' },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) return null;
    const r = await res.json();
    return { tag: r.tag_name, name: r.name, published_at: r.published_at, url: r.html_url };
  } catch (err) {
    console.error('[customer] 릴리스 조회 실패:', err.message);
    return null;
  }
}

/**
 * 고객 에디션에 맞는 설치 파일 목록.
 * 트라이얼과 같은 방식으로 "최신 릴리스의 버전 없는 파일명"을 가리키므로,
 * 새 버전을 올려도 이 코드는 손대지 않는다.
 */
function fileList(edition) {
  const out = [];
  for (const rhino of ['8', '7']) {
    for (const lang of ['ko-KR', 'en-US']) {
      const name = `RCW_V5_${edition}_Rhino${rhino}_${lang}.exe`;
      out.push({
        rhino,
        lang,
        file_name: name,
        url: `https://github.com/${RELEASE_REPO}/releases/latest/download/${name}`
      });
    }
  }
  return out;
}

// 저장소에 package.json 이 없어 Vercel 은 이 파일을 CommonJS 로 읽는다.
// export default 로 쓰면 배포 후 함수가 호출되지 않는다.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const ip = clientIp(req);
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 300);

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const codeKey = normalizeCode(body && body.code);

  if (codeKey.length < 8 || codeKey.length > 40) {
    return res.status(401).json({ error: 'invalid_code' });
  }

  try {
    // 무차별 대입 차단 — 같은 IP 의 최근 실패 횟수
    const since = new Date(Date.now() - FAIL_WINDOW_MIN * 60000).toISOString();
    const recent = await db(
      `customer_access?select=id&action=eq.login_failed&ip=eq.${encodeURIComponent(ip)}` +
      `&created_at=gte.${encodeURIComponent(since)}&limit=${FAIL_LIMIT}`
    );
    if (Array.isArray(recent) && recent.length >= FAIL_LIMIT) {
      return res.status(429).json({ error: 'too_many_attempts', retry_after_min: FAIL_WINDOW_MIN });
    }

    const rows = await db(
      'customers?select=id,license_id,name,company,phone,email,edition,issued_on,expires_on,status' +
      `&code_key=eq.${encodeURIComponent(codeKey)}&limit=1`
    );
    const customer = Array.isArray(rows) && rows.length ? rows[0] : null;

    if (!customer) {
      await log({ action: 'login_failed', code_tried: codeKey.slice(0, 60), ip, user_agent: userAgent });
      return res.status(401).json({ error: 'invalid_code' });
    }

    await log({ action: 'login', customer_id: customer.id, ip, user_agent: userAgent });

    // 중지된 고객은 로그인은 되지만 파일을 주지 않는다. 화면에 문의 안내가 뜬다.
    const suspended = customer.status !== 'active';
    const release = await latestRelease();

    return res.status(200).json({
      customer: {
        id: customer.id,
        license_id: customer.license_id,
        name: customer.name,
        company: customer.company,
        phone: customer.phone,
        email: customer.email,
        edition: customer.edition,
        issued_on: customer.issued_on,
        expires_on: customer.expires_on,
        status: customer.status
      },
      files: suspended ? [] : fileList(customer.edition),
      release
    });
  } catch (err) {
    console.error('[customer] 로그인 처리 실패:', err.message);
    return res.status(500).json({ error: 'server_error' });
  }
};
