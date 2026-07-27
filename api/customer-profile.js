/* ------------------------------------------------------------------
   고객 정보 확인·저장 (customer.html 의 확인 화면 → 이 함수 → Supabase)

   기존 고객 이전(마이그레이션) 때 쓴다. 임시코드로 처음 들어온 고객에게
   알고 있는 정보를 미리 채워 보여주고, 고친 값을 여기에 저장한 뒤 다운로드로 넘긴다.
   저장되면 info_confirmed_at 이 찍히고, 다음 방문부터는 이 화면을 건너뛴다.

   자격 확인은 로그인과 같다 — **코드를 다시 받아 서버에서 대조한다.**
   화면에서 넘어온 customer_id 를 믿고 쓰면, 남의 id 를 넣어 정보를 덮어쓸 수 있다.

   요청 : POST { code, company, name, phone, email }
   응답 : 200 { ok:true } | 400 { error, field } | 401 | 500
------------------------------------------------------------------ */

function supabaseBase() {
  return String(process.env.SUPABASE_URL || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/rest\/v1$/i, '')
    .replace(/\/+$/, '');
}

function normalizeCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim().slice(0, 60);
  return (req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : '').slice(0, 60);
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

  // Prefer: return=minimal 이면 INSERT 201 + 빈 본문, PATCH 204. 본문 유무로 판단한다.
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** 화면에서 지운 칸은 null 로 저장한다(빈 문자열이 아니라). */
function trimOrNull(value, max) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return null;
  return v.slice(0, max);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const codeKey = normalizeCode(body.code);
  if (codeKey.length < 8 || codeKey.length > 40) return res.status(401).json({ error: 'invalid_code' });

  const company = trimOrNull(body.company, 200);
  const name = trimOrNull(body.name, 100);
  const phone = trimOrNull(body.phone, 50);
  const email = trimOrNull(body.email, 200);

  // 이메일만 필수다. 라이선스 파일을 보낼 곳이라 이게 없으면 다음 단계가 막힌다.
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'bad_email', field: 'email' });
  }
  if (!company && !name) {
    return res.status(400).json({ error: 'company_or_name_required', field: 'company' });
  }

  try {
    const rows = await db(`customers?select=id&code_key=eq.${encodeURIComponent(codeKey)}&limit=1`);
    const customer = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!customer) return res.status(401).json({ error: 'invalid_code' });

    await db(`customers?code_key=eq.${encodeURIComponent(codeKey)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        company,
        name,
        phone,
        email,
        info_confirmed_at: new Date().toISOString()
      })
    });

    try {
      await db('customer_access', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          action: 'profile',
          customer_id: customer.id,
          ip: clientIp(req),
          user_agent: String(req.headers['user-agent'] || '').slice(0, 300)
        })
      });
    } catch (err) {
      // 기록 실패가 저장을 되돌리게 두지 않는다.
      console.error('[customer] 정보확인 기록 실패:', err.message);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[customer] 정보 저장 실패:', err.message);
    return res.status(500).json({ error: 'server_error' });
  }
};
