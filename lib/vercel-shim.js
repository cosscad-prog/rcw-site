/* ------------------------------------------------------------------
   Cloudflare Pages Functions 위에서 Vercel 함수를 그대로 돌리는 어댑터.

   api/*.js 의 함수들은 전부 `module.exports = async function handler(req, res) {}`
   모양이다(Vercel 서버리스 규격). CF Pages Functions 는 다른 모양을 요구한다:
     export function onRequest(context) { ... return Response }

   ★ 왜 함수 11개를 다시 쓰지 않았나
     이미 검증된 핸들러 본문(Supabase·텔레그램·인증 로직)은 그대로 두고,
     CF ↔ Vercel 모양 차이만 이 한 파일에 모은다. 여러 자리를 고치면 반드시
     하나를 빠뜨린다(2026-09-23 곡선 transom 에서 실제로 겪음) — 그래서 길목 하나.

   req 가 흉내 내는 것: method, headers(소문자 키), query, body(이미 파싱된 객체),
     socket(항상 null — CF 에는 없다. IP 는 cf-connecting-ip 를 x-forwarded-for 로 얹어 대신한다)
   res 가 흉내 내는 것: setHeader, status(code), json(obj), send(payload), end(payload)
     — 전부 체이닝 가능하고, 마지막으로 불린 것이 실제 Response 를 만든다.
------------------------------------------------------------------ */

function wrap(handler) {
  return async function onRequest(context) {
    const { request, env } = context;

    // api/*.js 는 process.env.X 를 직접 읽는다. CF 는 context.env 로 준다.
    // ★ nodejs_compat 가 이미 만들어 둔 process.env 는 값을 못 얹는다(조용히 실패 —
    //   기존 토큰 검증이 항상 401 이 나서 잡았다, 2026-09-23). 기존 객체에 얹지 않고
    //   process 자체를 매 요청 새로 만든다.
    globalThis.process = { env: { ...env } };

    const url = new URL(request.url);

    const headers = {};
    for (const [k, v] of request.headers) headers[k.toLowerCase()] = v;
    // clientIp() 는 x-forwarded-for 만 본다. CF 가 주는 진짜 접속 IP 를 그 자리에 얹는다.
    if (!headers['x-forwarded-for'] && headers['cf-connecting-ip']) {
      headers['x-forwarded-for'] = headers['cf-connecting-ip'];
    }

    const query = {};
    for (const [k, v] of url.searchParams) query[k] = v;

    // Vercel 은 JSON 본문을 미리 객체로 파싱해 req.body 에 넣어 준다.
    // readBody() 도, 직접 req.body 를 읽는 핸들러도 이 모양을 기대한다.
    let body = {};
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const raw = await request.text();
      if (raw) {
        try { body = JSON.parse(raw); } catch { body = raw; }
      }
    }

    const req = { method: request.method, headers, query, body, socket: null };

    let statusCode = 200;
    const resHeaders = new Headers();
    let responded = false;
    let resolveResponse;
    const donePromise = new Promise((resolve) => { resolveResponse = resolve; });

    function finish(payload) {
      if (responded) return; // 이미 끝난 뒤 또 부르면(중복 호출) 무시 — 첫 응답만 유효
      responded = true;
      resolveResponse(new Response(payload == null ? null : payload, {
        status: statusCode,
        headers: resHeaders
      }));
    }

    const res = {
      setHeader(name, value) { resHeaders.set(name, String(value)); return res; },
      status(code) { statusCode = code; return res; },
      json(obj) {
        if (!resHeaders.has('content-type')) {
          resHeaders.set('Content-Type', 'application/json; charset=utf-8');
        }
        finish(JSON.stringify(obj));
        return res;
      },
      send(payload) { finish(payload); return res; },
      end(payload) { finish(payload); return res; }
    };

    try {
      await handler(req, res);
    } catch (err) {
      // 핸들러 안 try/catch 가 놓친 예외. 응답이 아직 안 나갔으면 500 을 만들어 준다.
      console.error('[shim] 처리되지 않은 예외:', err && err.message);
      if (!responded) {
        resHeaders.set('Content-Type', 'application/json; charset=utf-8');
        finish(JSON.stringify({ error: 'server_error' }));
      }
    }

    return donePromise;
  };
}

export { wrap };
