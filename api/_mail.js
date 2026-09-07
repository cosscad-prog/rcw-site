/* ------------------------------------------------------------------
   운영자 메일 알림 (Gmail SMTP 직접)

   문의는 2026-08-11부터 텔레그램으로만 알렸다. 휴대폰에서 바로 보이는 것은
   좋지만 남는 곳이 거기뿐이라, 알림을 놓치면 Supabase 대시보드를 열기 전에는
   문의가 온 줄을 모른다. 메일함에도 한 통 남긴다 — 검색이 되고, 답장이 그대로
   문의자에게 가고(Reply-To), 지운 뒤에도 되찾을 수 있다.

   ★ 라이브러리를 안 쓰는 이유
     이 저장소에는 package.json 이 없다. 정적 파일과 Vercel 함수뿐이라 빌드 단계가
     아예 없고, 그 덕에 배포가 파일 복사 수준으로 단순하다. nodemailer 하나 때문에
     그 구조를 바꾸지 않는다. 필요한 것은 "한 통 보내기" 뿐이라 SMTP 를 직접 말한다.

   ★ 이 파일은 `_` 로 시작한다 = Vercel 함수가 아니라 그냥 모듈이다.
     (Hobby 요금제는 함수 12개가 상한이고 지금 11개다. 늘리면 조용히 배포가 막힌다.)

   환경변수 (Vercel → Settings → Environment Variables)
     MAIL_USERNAME      보내는 Gmail 주소            예) beimptech@gmail.com
     MAIL_APP_PASSWORD  Gmail 앱 비밀번호 16자리     (계정 비밀번호가 아니다.
                        구글이 4자리씩 띄어 보여주므로 공백째 붙여넣어도 되게 턴다)
     MAIL_TO            받는 주소                   생략하면 아래 DEFAULT_TO
     MAIL_HOST/MAIL_PORT  시험용. 생략하면 smtp.gmail.com:465

   GitHub Actions 의 하루 요약 메일(.github/workflows/daily-report.yml)이 쓰는
   비밀값과 같은 이름이다. 같은 계정·같은 앱 비밀번호를 Vercel 에도 넣으면 된다.
------------------------------------------------------------------ */

const tls = require('tls');

/** 받는 곳. `+rcw` 는 Gmail 에 그대로 도착하고, 그 주소로 필터·라벨을 걸 수 있다. */
const DEFAULT_TO = 'beimptech+rcw@gmail.com';

/* 접수 응답을 붙잡고 있으면 안 된다. Gmail 은 보통 1~2초에 끝나고,
   막히면 8초에 포기한다(텔레그램 4초와 나란히 돌므로 최악이 8초다). */
const TIMEOUT_MS = 8000;

function env(name) { return String(process.env[name] == null ? '' : process.env[name]).trim(); }

/** 설정이 없으면 메일은 없다. 오류가 아니다(로컬·미설정 환경에서 정상 동작). */
function mailConfig() {
  const user = env('MAIL_USERNAME');
  // 구글은 앱 비밀번호를 "abcd efgh ijkl mnop" 로 보여준다. 그대로 붙여넣어도 되게 한다.
  const pass = env('MAIL_APP_PASSWORD').replace(/\s+/g, '');
  if (!user || !pass) return null;
  return {
    user: user,
    pass: pass,
    to:   env('MAIL_TO') || DEFAULT_TO,
    host: env('MAIL_HOST') || 'smtp.gmail.com',
    port: Number(env('MAIL_PORT') || 465)
  };
}

/* ── 메일 한 통 만들기 ─────────────────────────────────────────────
   제목과 본문에 한글이 들어가므로 7비트로 감싸야 한다.
   제목은 RFC2047(=?UTF-8?B?…?=), 본문은 base64 다.                */

function b64(s) { return Buffer.from(String(s), 'utf8').toString('base64'); }

/** 헤더 한 줄에 들어갈 값에서 줄바꿈을 없앤다.
    ★ 문의자가 적은 이름·메일이 헤더로 들어간다. 줄바꿈을 그대로 두면
      이름 칸에 개행을 넣어 헤더를 통째로 지어낼 수 있다(헤더 주입). */
function oneLine(s) {
  return String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim();
}

/** 아스키면 그대로, 아니면 인코딩한다. 인코딩 워드는 75자 제한이라 나눠 담는다. */
function encodeWord(raw) {
  const s = oneLine(raw);
  if (!s) return '';
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  // base64 로 늘어나는 것을 감안해 원문 15자씩 자른다(한글 3바이트 × 15 → 60바이트 → 80자).
  const parts = [];
  for (let i = 0; i < s.length; i += 15) parts.push('=?UTF-8?B?' + b64(s.slice(i, i + 15)) + '?=');
  return parts.join('\r\n ');
}

/** `표시이름 <주소>` 형태. 주소가 형식에 안 맞으면 통째로 버린다(주입 방지). */
function addr(name, email) {
  const mail = oneLine(email);
  if (!/^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$/.test(mail)) return '';
  const who = encodeWord(name);
  return who ? who + ' <' + mail + '>' : mail;
}

/** base64 본문은 한 줄 76자로 접는다(RFC 2045). */
function wrap76(s) {
  return s.replace(/(.{1,76})/g, '$1\r\n').trim();
}

/** SMTP 서버 시계를 믿지 않는다. Date 헤더는 우리가 KST 로 적는다. */
function rfc2822Date(d) {
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const k = new Date(d.getTime() + 9 * 60 * 60 * 1000);   // 서버는 UTC 로 돈다
  const p = n => String(n).padStart(2, '0');
  return DAY[k.getUTCDay()] + ', ' + p(k.getUTCDate()) + ' ' + MON[k.getUTCMonth()] + ' ' +
         k.getUTCFullYear() + ' ' + p(k.getUTCHours()) + ':' + p(k.getUTCMinutes()) + ':' +
         p(k.getUTCSeconds()) + ' +0900';
}

/**
 * 보낼 메일 원문(헤더 + 본문)을 만든다.
 * @param {object} m  from, fromName, to, subject, text, replyToName, replyToEmail, date
 */
function buildMessage(m) {
  const date = m.date || new Date();
  const headers = [
    'From: ' + addr(m.fromName || 'RCW 홈페이지', m.from),
    'To: ' + oneLine(m.to),
    'Subject: ' + encodeWord(m.subject),
    'Date: ' + rfc2822Date(date),
    'Message-ID: <' + date.getTime().toString(36) + '.' +
      Math.random().toString(36).slice(2, 10) + '@rcw-site>',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64'
  ];

  // 답장 단추를 누르면 문의자에게 바로 가야 한다. 이것이 메일로 받는 가장 큰 이유다.
  const reply = addr(m.replyToName, m.replyToEmail);
  if (reply) headers.splice(2, 0, 'Reply-To: ' + reply);

  // 본문은 base64 다. base64 문자에는 '.' 이 없으므로 점 하나짜리 줄(=DATA 끝)이
  // 만들어질 수 없다. 그래서 dot-stuffing 을 따로 하지 않는다.
  return headers.join('\r\n') + '\r\n\r\n' + wrap76(b64(m.text));
}

/* ── SMTP 대화 ─────────────────────────────────────────────────── */

/**
 * 한 통 보내고 끊는다.
 * @param {object} o  host, port, user, pass, from, to, message
 * @param {function} [o.connect]  시험용 이음매. 없으면 TLS 로 붙는다.
 *                                운영 경로는 언제나 tls.connect 다 —
 *                                평문으로 붙는 길을 코드에 두지 않는다.
 */
function smtpSend(o) {
  return new Promise(function (resolve, reject) {
    const sock = (o.connect || function () {
      return tls.connect({ host: o.host, port: o.port, servername: o.host });
    })();

    let settled = false;
    function finish(err) {
      if (settled) return;
      settled = true;
      // 성공이면 end() 다 — 아직 안 나간 QUIT 를 흘려보내고 정상으로 끊는다.
      // destroy() 로 끊으면 마지막 줄이 나가기 전에 잘려 서버 로그에 중단으로 남는다.
      try { if (err) sock.destroy(); else sock.end(); } catch (_) {}
      if (err) reject(err); else resolve(true);
    }

    sock.setEncoding('utf8');
    sock.setTimeout(TIMEOUT_MS, function () {
      finish(new Error('SMTP 응답 없음(' + TIMEOUT_MS + 'ms)'));
      try { sock.destroy(); } catch (_) {}     // 이미 끝난 뒤라도 연결은 확실히 닫는다
    });
    sock.on('error', finish);
    sock.on('close', function () { finish(new Error('SMTP 연결이 먼저 끊겼습니다')); });

    // 응답은 여러 줄일 수 있다: "250-SIZE…\r\n250 AUTH…\r\n".
    // 마지막 줄만 코드 뒤가 공백이다. 그 줄이 와야 한 응답이 끝난 것이다.
    const waiting = [];
    let buffer = '';
    let lines = [];
    sock.on('data', function (chunk) {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        lines.push(line);
        if (/^\d{3} /.test(line)) {
          const reply = { code: parseInt(line.slice(0, 3), 10), text: lines.join(' / ') };
          lines = [];
          const w = waiting.shift();
          if (w) w(reply);
        }
      }
    });

    function expect(codes) {
      return new Promise(function (res, rej) {
        waiting.push(function (reply) {
          if (codes.indexOf(reply.code) === -1) rej(new Error('SMTP ' + reply.text.slice(0, 200)));
          else res(reply);
        });
      });
    }
    function send(line) { sock.write(line + '\r\n'); }

    (async function () {
      await expect([220]);
      send('EHLO rcw-site');
      await expect([250]);
      // AUTH PLAIN 은 NUL user NUL pass 를 base64 로 한 줄에 보낸다. TLS 안이라 노출이 없다.
      send('AUTH PLAIN ' + b64('\0' + o.user + '\0' + o.pass));
      await expect([235]);
      send('MAIL FROM:<' + o.from + '>');
      await expect([250]);
      send('RCPT TO:<' + o.to + '>');
      await expect([250, 251]);
      send('DATA');
      await expect([354]);
      sock.write(o.message + '\r\n.\r\n');
      await expect([250]);
      // 250 을 받은 시점에 서버가 받아 간 것이다. QUIT 응답까지 기다리지 않는다.
      send('QUIT');
      finish(null);
    })().catch(finish);
  });
}

/**
 * 메일 한 통. 실패해도 던지지 않는다 — 부르는 쪽(알림)은 부가 기능이다.
 * @param {object} m  subject, text, replyToName, replyToEmail
 * @returns {Promise<boolean>} 보냈으면 true, 설정이 없거나 실패하면 false
 */
async function sendMail(m) {
  const cfg = mailConfig();
  if (!cfg) return false;                    // 미설정 = 메일 없음. 오류가 아니다.
  try {
    const message = buildMessage({
      from: cfg.user, to: cfg.to,
      subject: m.subject, text: m.text,
      replyToName: m.replyToName, replyToEmail: m.replyToEmail
    });
    await smtpSend({
      host: cfg.host, port: cfg.port, user: cfg.user, pass: cfg.pass,
      from: cfg.user, to: cfg.to, message: message
    });
    return true;
  } catch (err) {
    // 비밀번호는 절대 찍지 않는다. 서버가 준 문구만 남긴다.
    console.error('[mail] 발송 실패:', err.message);
    return false;
  }
}

module.exports = { sendMail, buildMessage, smtpSend, mailConfig, DEFAULT_TO };
