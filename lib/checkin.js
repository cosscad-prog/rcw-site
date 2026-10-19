/* ------------------------------------------------------------------
   플러그인 하루 1회 체크인 (5.4.0 — 설치 파일 하나 계획 5.1절 ③)

   요청 : POST { id, v, ed, rh, lang, code?, mc?, em? }
          id   설치 id(무작위 hex, 플러그인 Updates/install-id.txt)
          v    플러그인 버전 5.4.0
          ed   Core · Standard · Core_Trial · Standard_Trial
          rh   7 · 8
          lang ko-KR · en-US
          code 유료판(5.4.7~): 설치기가 저장한 고객 코드(Licensing\customer-code.txt)
          mc   유료판(5.4.7~): 고객 코드 파일이 없을 때 머신코드
          em   평가판(5.4.7~): 사용자가 플러그인에 넣은 신청 메일
   응답 : 204  |  200 { email: 'found' | 'not_found' | 'invalid' } (em 이 왔을 때)  |  400 { error }  |  500

   ★ IP 는 저장하지 않는다 — 셀 필요가 없다.
   ★ 사람과 잇기(2026-10-19, docs/supabase-plugin-checkins-link.sql) — code · mc · em 셋 중 하나로
     고객 명부나 평가판 신청을 찾아 그 id 와 그때의 회사 · 이름을 이 줄에 적는다. 코드 원문 · 머신코드는
     저장하지 않는다. 관리 화면은 같은 설치 번호의 자동 받기(plugin_downloads)를 이 줄을 거쳐 사람에게 붙인다.
     · 코드 · 머신코드로 못 찾으면 이어 둔 것을 지우지 않는다. 그리고 맞았는지 알려 주지 않는다(늘 204) —
       이 문으로 코드를 맞혀 볼 수 없게(설치 완료 알림 lib/edition-check.js 와 같다).
     · 메일은 못 찾아도 넣은 메일을 남기고 찾았는지 알려 준다 — 사용자가 잘못 넣었으면 고칠 수 있게.
       메일로 신청이 있는지는 평가판 페이지의 재방문 조회(api/trial.js)도 이미 알려 준다.
     · 찾다가 실패해도 체크인은 남긴다. 기록이 사용을 막아서는 안 된다.
   ★ 한 줄 = (설치 id, Rhino). 설치 id 는 Windows 사용자마다 하나이고 R7·R8 이 같은 값을 쓴다.
     에디션이 바뀌면(평가판 → 정식) 같은 줄에서 edition 만 바뀌고 first_edition 은 남는다 — 전환을 센다.
   ★ 플러그인은 실패를 조용히 넘긴다 — 여기서 무엇이 틀려도 사용자는 모른다. 그래서 형식이 틀리면
     조용히 버리지 말고 400 을 준다(로그로 알아볼 수 있게).
   ★ Cloudflare 전용(functions/api/checkin.js). api/ 에 두지 않는다 — Vercel 뒷문 함수 12개 한도.
------------------------------------------------------------------ */

const { db, normalizeCode, normalizeMachineCode, MACHINE_CODE_RE, readBody } = require('../api/_rcw');

const EDITIONS = ['Core', 'Standard', 'Core_Trial', 'Standard_Trial'];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function first(rows) { return Array.isArray(rows) && rows.length ? rows[0] : null; }

/** 유료판 — 고객 코드(새 RCW- → 옛 V5KO-), 없으면 머신코드로 명부를 찾는다. 못 찾으면 null. */
async function findCustomer(code, machineCode) {
  const select = 'customers?select=id,company,name';
  const key = normalizeCode(code);
  if (key.length >= 8 && key.length <= 40) {
    const found = first(await db(`${select}&code_key=eq.${encodeURIComponent(key)}&limit=1`)) ||
                  first(await db(`${select}&legacy_code_key=eq.${encodeURIComponent(key)}&limit=1`));
    if (found) return found;
  }
  if (MACHINE_CODE_RE.test(machineCode)) {
    return first(await db(`${select}&machine_code=eq.${encodeURIComponent(machineCode)}&limit=1`));
  }
  return null;
}

/** 평가판 — 신청을 메일로 찾는다. 같은 주소로 여러 번 신청했으면 가장 처음 것(api/trial.js 재방문과 같다).
    ★ ilike 는 _ 와 % 를 와일드카드로 읽는다 — 메일에 흔한 _ 가 아무 글자와 맞지 않게 글자 그대로로 막는다. */
async function findRequest(email) {
  const pattern = email.replace(/[\\%_]/g, '\\$&');
  return first(await db('trial_requests?select=id,company,name&email=ilike.' + encodeURIComponent(pattern) +
                        '&order=created_at.asc&limit=1'));
}

function clip(text, max) {
  const t = String(text || '').trim();
  return t ? t.slice(0, max) : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const b = (await readBody(req)) || {};
  const id = String(b.id || '').trim().toLowerCase();
  const version = String(b.v || '').trim();
  const edition = String(b.ed || '').trim();
  const rhino = String(b.rh || '').trim();
  const lang = String(b.lang || '').trim();

  if (!/^[0-9a-f]{8,64}$/.test(id) || !/^\d+\.\d+\.\d+$/.test(version) ||
      EDITIONS.indexOf(edition) < 0 || (rhino !== '7' && rhino !== '8')) {
    return res.status(400).json({ error: 'bad_request' });
  }
  const safeLang = lang === 'ko-KR' || lang === 'en-US' ? lang : null;
  const key = `install_id=eq.${encodeURIComponent(id)}&rhino=eq.${rhino}`;
  const now = new Date().toISOString();

  // 사람과 잇기 — 유료판은 코드 · 머신코드, 평가판은 메일만 본다(서로 다른 쪽 값은 버린다).
  const trial = /_Trial$/.test(edition);
  const code = trial ? '' : String(b.code || '').trim().slice(0, 60);
  const mc = trial ? '' : normalizeMachineCode(b.mc).slice(0, 60);
  const em = trial ? String(b.em || '').trim().toLowerCase() : '';
  let link = null;          // 이 줄에 덧쓸 칸 — 찾았을 때만(평가판은 못 찾아도 메일을 남긴다)
  let emailResult = null;   // em 이 왔을 때만 돌려준다

  try {
    if (em) {
      if (em.length > 200 || !EMAIL_RE.test(em)) {
        emailResult = 'invalid';
      } else {
        const r = await findRequest(em);
        emailResult = r ? 'found' : 'not_found';
        link = { customer_id: null, request_id: r ? r.id : null, link_email: em,
                 who_company: r ? clip(r.company, 200) : null, who_name: r ? clip(r.name, 100) : null, linked_at: now };
      }
    } else if (code || mc) {
      const c = await findCustomer(code, mc);
      if (c) {
        link = { customer_id: c.id, request_id: null, link_email: null,
                 who_company: clip(c.company, 200), who_name: clip(c.name, 100), linked_at: now };
      }
    }
  } catch (err) {
    console.error('[checkin] 사람 찾기 실패:', err.message);   // 체크인은 그대로 남긴다
    link = null;
    emailResult = null;
  }

  try {
    const rows = await db(`plugin_checkins?select=checkins&${key}&limit=1`);
    if (Array.isArray(rows) && rows.length) {
      await db(`plugin_checkins?${key}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ edition, version, lang: safeLang, last_seen: now, checkins: (rows[0].checkins || 0) + 1,
                               ...(link || {}) })
      });
    } else {
      await db('plugin_checkins', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ install_id: id, rhino, edition, first_edition: edition, version, lang: safeLang,
                               first_seen: now, last_seen: now, checkins: 1, ...(link || {}) })
      });
    }
    if (emailResult) return res.status(200).json({ email: emailResult });
    return res.status(204).end();
  } catch (err) {
    console.error('[checkin] 기록 실패:', err.message);
    return res.status(500).json({ error: 'server_error' });
  }
};
