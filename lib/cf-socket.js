/* ------------------------------------------------------------------
   Cloudflare 소켓(`cloudflare:sockets`)을 Node 의 tls 소켓 모양으로 감싼다.

   api/_mail.js 의 SMTP 대화는 Node 소켓을 전제로 짜여 있다
   (on('data'|'error'|'close'), setEncoding, setTimeout, write, end, destroy).
   Workers 에는 Node 의 tls.connect 가 없고 대신 이 API 가 있다.
   대화 로직은 한 줄도 안 고치고, 통로만 이것으로 바꿔 끼운다.

   ★ 되는지 먼저 판별했다(2026-09-23): CF 엣지 → smtp.gmail.com:465 암묵 TLS,
     220 인사 + EHLO 250(AUTH LOGIN PLAIN) 3회 연속, 약 0.8초.
     막힌 것은 25번 포트뿐이다. "CF 는 SMTP 불가" 는 틀린 기록이었다.

   setTimeout 은 Node 와 같은 뜻(유휴 시간)이다 — 읽거나 쓸 때마다 다시 잰다.
------------------------------------------------------------------ */

import { connect } from 'cloudflare:sockets';

export function cfTlsConnect({ host, port }) {
  const sock = connect({ hostname: host, port: port }, { secureTransport: 'on' });
  const writer = sock.writable.getWriter();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const listeners = { data: [], error: [], close: [] };
  let timeoutMs = 0;
  let timeoutCb = null;
  let timer = null;
  let closed = false;

  function emit(ev, arg) { for (const f of listeners[ev] || []) f(arg); }
  function clearTimer() { if (timer) { clearTimeout(timer); timer = null; } }
  function armTimer() {
    clearTimer();
    if (timeoutMs && timeoutCb && !closed) timer = setTimeout(timeoutCb, timeoutMs);
  }

  (async function pump() {
    const reader = sock.readable.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        armTimer();
        emit('data', decoder.decode(value, { stream: true }));
      }
    } catch (err) {
      if (!closed) emit('error', err);
    }
    closed = true;
    clearTimer();
    emit('close');
  })();

  const api = {
    setEncoding() { return api; },               // 언제나 utf8 문자열로 넘긴다
    setTimeout(ms, cb) { timeoutMs = ms; timeoutCb = cb; armTimer(); return api; },
    on(ev, f) { (listeners[ev] = listeners[ev] || []).push(f); return api; },
    write(s) {
      armTimer();
      writer.write(encoder.encode(String(s))).catch((err) => { if (!closed) emit('error', err); });
      return true;
    },
    // Node 의 end() — 쌓인 쓰기를 다 내보낸 뒤 닫는다(writer 는 순서대로 처리한다).
    end() { clearTimer(); writer.close().catch(() => {}); return api; },
    destroy() { closed = true; clearTimer(); sock.close().catch(() => {}); return api; }
  };
  return api;
}
