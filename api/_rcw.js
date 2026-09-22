/* ------------------------------------------------------------------
   고객 포털 서버 함수들이 함께 쓰는 조각.

   같은 코드를 네 파일에 복사해 두었더니, Supabase 의 빈 응답 처리를 고칠 때
   한 곳을 빠뜨려 "저장은 됐는데 500" 이 났다. 그래서 한곳으로 모은다.
------------------------------------------------------------------ */

const crypto = require('crypto');

/**
 * Supabase 대시보드의 "API URL" 은 .../rest/v1/ 까지 붙어 있어 그대로 복사하기 쉽다.
 * 그걸 그대로 쓰면 /rest/v1/rest/v1/... 이 되어 404 인데 화면에는 "일시적 오류" 로만
 * 보인다. 어느 형태를 넣어도 동작하게 잘라낸다.
 */
function supabaseBase() {
  return String(process.env.SUPABASE_URL || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/rest\/v1$/i, '')
    .replace(/\/+$/, '');
}

/** Supabase REST 호출. service key 라 RLS 를 통과한다. */
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

  // Prefer: return=minimal 이면 INSERT 는 201 + 빈 본문, PATCH 는 204 다.
  // 상태코드로 빈 본문을 가리려다 201 을 놓친 적이 있다. 본문 유무로 판단한다.
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** 고객이 어떻게 입력하든 같은 값으로 맞춘다. 'v5ko-497e 8480 9694' → 'V5KO497E84809694' */
function normalizeCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** 머신코드는 대문자·하이픈 형식이 정해져 있다. 공백만 털어 대문자로 맞춘다. */
function normalizeMachineCode(raw) {
  return String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
}

const MACHINE_CODE_RE = /^RCW5-(CO|ST)-[A-F0-9]{32}$/;

function editionOfMachineCode(machineCode) {
  if (!MACHINE_CODE_RE.test(machineCode)) return null;
  return machineCode.startsWith('RCW5-CO-') ? 'Core' : 'Standard';
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim().slice(0, 60);
  return (req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : '').slice(0, 60);
}

function userAgent(req) {
  return String(req.headers['user-agent'] || '').slice(0, 300);
}

/** 길이가 달라도 안전하게 비교한다(응답 시간으로 토큰을 추측하지 못하게). */
function adminTokenMatches(given) {
  const expected = String(process.env.CUSTOMER_ADMIN_TOKEN || '');
  if (!expected) return false;
  const a = Buffer.from(String(given || ''), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) {
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function readBody(req) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  return body || {};
}

/** 코드로 고객을 찾는다. 없으면 null. */
async function findCustomerByCode(rawCode, select) {
  const codeKey = normalizeCode(rawCode);
  if (codeKey.length < 8 || codeKey.length > 40) return null;
  const rows = await db(
    `customers?select=${encodeURIComponent(select)}&code_key=eq.${encodeURIComponent(codeKey)}&limit=1`
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/* ── 플러그인이 스스로 받아 갈 때 ────────────────────────────────────
   RCW V5 알림창에서 [예] 를 누르면 플러그인이 여기로 온다. 기록을 남기고
   GitHub 릴리스로 넘긴다(302).

   ★ 왜 브라우저를 안 거치게 하는가 — 브라우저가 붙이는 '인터넷에서 왔다'는 표식
     때문에 크롬 경고와 SmartScreen 이 뜬다. 프로그램이 직접 받으면 둘 다 안 뜬다
     (2026-09-22 실측). 그래서 이 문은 <b>받는 길</b>이지 페이지가 아니다.

   ★ 기록이 업데이트를 막아서는 안 된다. Supabase 가 죽어 있어도 302 는 나간다.
     (플러그인 쪽에도 같은 원칙의 보호가 하나 더 있다 — 이 주소가 통째로 실패하면
      GitHub 으로 바로 간다.)

   ★ 넘기는 주소는 <b>우리가 짓는다.</b> 요청에 들어온 값을 그대로 Location 에
     쓰지 않는다 — 그러면 이 주소가 아무 데로나 보내 주는 발판이 된다.
     파일 이름이 정해진 형태가 아니면 400 으로 끊는다.
──────────────────────────────────────────────────────────────────── */
const PLUGIN_FILE_RE = /^RCW_V5_(Core|Standard)(_Trial)?_Rhino([78])\.exe$/;

const RELEASE_REPO = {
  customer: 'https://github.com/cosscad-prog/rcw-customer-releases',
  trial:    'https://github.com/cosscad-prog/rcw-releases'
};

async function pluginDownload(req, res, kind) {
  const query = req.query || {};
  const fileName = String(query.file || '').trim();
  const match = PLUGIN_FILE_RE.exec(fileName);

  // 평가판 파일은 _Trial 이 있고 유료판 파일은 없다. 엇갈리면 엉뚱한 저장소를
  // 가리키게 되므로 여기서 끊는다.
  const isTrialFile = Boolean(match && match[2]);
  if (!match || isTrialFile !== (kind === 'trial')) {
    return res.status(400).json({ error: 'bad_file' });
  }

  const installId = /^[0-9a-f]{8,64}$/i.test(String(query.id || '')) ? String(query.id) : null;
  const version   = /^\d+\.\d+\.\d+$/.test(String(query.v || '')) ? String(query.v) : null;

  try {
    await db('plugin_downloads', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        kind,
        install_id: installId,
        edition: match[1],
        rhino: match[3],
        version,
        file_name: fileName,
        ip: clientIp(req),
        user_agent: userAgent(req)
      })
    });
  } catch (err) {
    console.error('[plugin] 다운로드 기록 실패:', err.message);
  }

  const target = RELEASE_REPO[kind] + '/releases/latest/download/' + fileName;

  // 받는 주소는 판마다 달라진다. 중간에 끼는 것들이 옛 주소를 물고 있으면
  // 새 판이 나와도 옛 설치본이 내려간다.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Location', target);
  return res.status(302).end();
}

module.exports = {
  supabaseBase,
  db,
  normalizeCode,
  normalizeMachineCode,
  MACHINE_CODE_RE,
  editionOfMachineCode,
  clientIp,
  userAgent,
  adminTokenMatches,
  readBody,
  findCustomerByCode,
  pluginDownload
};
