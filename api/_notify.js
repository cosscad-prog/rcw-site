/* ------------------------------------------------------------------
   운영자 알림 (텔레그램)

   발급기는 요청이 들어와도 스스로 켜지지 않는다. 서명 개인키가 발급 PC 밖으로
   나가지 않게 하려고 "발급기를 닫는 것이 곧 잠금" 으로 설계했기 때문이다
   (docs/CUSTOMER_PORTAL.md). 그래서 요청이 우편함에 들어온 그 순간 사람에게
   알려야 발급기를 켤 수 있다. 이 파일이 그 알림을 보낸다.

   ★ 알림 실패가 고객의 요청 접수를 막으면 안 된다.
     여기서 모든 예외를 삼키고, 부르는 쪽은 결과를 보지 않는다.
     환경변수가 없으면 조용히 아무것도 하지 않는다(로컬·미설정 환경에서 정상 동작).

   환경변수
     TELEGRAM_BOT_TOKEN   @BotFather 로 만든 봇 토큰
     TELEGRAM_CHAT_ID     알림을 받을 대화 id (봇에게 아무 말이나 보낸 뒤
                          https://api.telegram.org/bot<토큰>/getUpdates 에서 확인)
------------------------------------------------------------------ */

const TIMEOUT_MS = 4000;

/**
 * 라이선스 코드는 고객의 자격증명이다. 알림은 휴대폰에 남으므로 전부 적지 않는다.
 * 누구인지 알아볼 만큼만 남기고 가운데를 가린다.  V5KO497E84809694 → V5KO-497E…9694
 */
function maskCode(code) {
  const s = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length < 12) return s || '-';
  return s.slice(0, 8) + '…' + s.slice(-4);
}

/** 머신코드도 32자리라 그대로 쓰면 알림이 두 줄로 밀린다. 앞뒤만 남긴다. */
function maskMachine(machineCode) {
  const s = String(machineCode || '');
  if (s.length <= 20) return s || '-';
  return s.slice(0, 12) + '…' + s.slice(-4);
}

/** 서버는 UTC 로 돈다. 보는 사람 기준(KST)으로 적는다. */
function kstStamp(date) {
  const d = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
         `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** 텔레그램 HTML 파스모드에서 의미를 갖는 세 글자만 막는다. */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendTelegram(text) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = String(process.env.TELEGRAM_CHAT_ID || '').trim();
  if (!token || !chatId) return false;   // 미설정 = 알림 없음. 오류가 아니다.

  // 텔레그램이 느릴 때 고객의 요청 응답까지 붙잡고 있으면 안 된다.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      }),
      signal: ac.signal
    });
    if (!res.ok) {
      console.error('[notify] 텔레그램 ' + res.status + ' ' + (await res.text()).slice(0, 200));
      return false;
    }
    return true;
  } catch (err) {
    console.error('[notify] 텔레그램 전송 실패:', err.message);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 라이선스 요청이 우편함에 들어왔다고 알린다.
 *
 * @param {object} info
 *   company, name      고객 표시용
 *   licenseCode        고객이 입력한 코드(가려서 보낸다)
 *   edition            Core | Standard
 *   machineCode        이번에 올라온 기기코드
 *   heldLikely         이미 다른 PC 가 등록돼 있어 발급기가 보류할 것으로 보이는지
 *   pendingCount       현재 대기 중인 총 건수(모르면 생략)
 */
async function notifyLicenseRequest(info) {
  try {
    const who = [info.company, info.name].filter(Boolean).join('  ') || '(이름 미기재)';

    const lines = [
      '🔔 <b>RCW 라이선스 요청</b>',
      '',
      `고객   ${esc(who)}`,
      `코드   <code>${esc(maskCode(info.licenseCode))}</code>`,
      `에디션 ${esc(info.edition || '-')}`,
      `기기   <code>${esc(maskMachine(info.machineCode))}</code>`,
      `접수   ${kstStamp(new Date())} KST`,
      ''
    ];

    if (info.heldLikely) {
      // 발급기를 켜도 자동 발급되지 않는 건이다. 켜기 전에 알고 있어야 한다.
      lines.push('⚠️ <b>다른 PC 가 이미 등록돼 있습니다</b> — 자동 발급되지 않고 보류됩니다. 사람이 판단해야 합니다.');
    } else if (Number.isFinite(info.pendingCount) && info.pendingCount > 1) {
      lines.push(`대기 ${info.pendingCount}건 → <b>발급기를 켜 주세요</b>`);
    } else {
      lines.push('→ <b>발급기를 켜 주세요</b>');
    }

    await sendTelegram(lines.join('\n'));
  } catch (err) {
    // 알림은 부가 기능이다. 여기서 던지면 고객 요청이 500 이 된다.
    console.error('[notify] 알림 생성 실패:', err.message);
  }
}

/**
 * 홈페이지 제품 문의가 들어왔다고 알린다 (api/contact.js).
 *
 * 라이선스 알림과 달리 연락처를 가리지 않는다. 이 알림을 보고 바로 답장·전화를
 * 해야 하는데 가려 놓으면 결국 대시보드를 열어야 하기 때문이다.
 *
 * @param {object} info  name, company, phone, email, message, source_page
 */
async function notifyContact(info) {
  try {
    const who = [info.company, info.name].filter(Boolean).join('  ') || '(이름 미기재)';

    // 텔레그램 메시지 상한은 4096자다. 본문은 5000자까지 받으므로 여기서 줄인다.
    const raw = String(info.message || '').trim();
    const message = raw.length > 1200 ? raw.slice(0, 1200) + ' …(생략)' : raw;

    const lines = [
      '✉️ <b>RCW 제품 문의</b>',
      '',
      `보낸이 ${esc(who)}`,
      `메일   ${esc(info.email || '-')}`
    ];
    if (info.phone) lines.push(`연락처 ${esc(info.phone)}`);
    lines.push(`접수   ${kstStamp(new Date())} KST`);
    if (info.source_page && info.source_page !== '/contact') {
      lines.push(`경로   ${esc(info.source_page)}`);
    }
    // 본문은 태그로 감싸지 않는다. 파스모드에서 처리 못 하는 태그가 하나라도 있으면
    // 텔레그램이 400 을 돌려주고 알림이 통째로 사라진다(로그에만 남는다).
    lines.push('', '─────────────', esc(message));

    await sendTelegram(lines.join('\n'));
  } catch (err) {
    console.error('[notify] 문의 알림 생성 실패:', err.message);
  }
}

module.exports = { notifyLicenseRequest, notifyContact, maskCode, maskMachine, kstStamp };
