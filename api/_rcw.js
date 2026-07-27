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
  findCustomerByCode
};
