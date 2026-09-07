/* api/_mail.js 를 실제 파일 그대로 불러, 가짜 SMTP 서버에 한 통 보내 본다.
   실행: node docs/_tests/mail-smtp.test.js   (설치할 것 없음, 밖으로 나가는 연결 없음)

   보는 것 — "메일이 갔다" 가 아니라 **무엇을 말했는가** 다.
   대화 한 줄이 어긋나면 Gmail 은 그냥 끊고, 로그에는 코드 세 자리만 남는다.  */

const net = require('net');
const path = require('path');
const SITE = path.join(__dirname, '..', '..');
const mail = require(path.join(SITE, 'api/_mail.js'));

let fails = 0;
function ok(label, cond, detail) {
  console.log('   ' + (cond ? '✔' : '✘ 실패') + ' ' + label + (detail ? '  → ' + detail : ''));
  if (!cond) fails++;
}

/* ── 가짜 SMTP 서버 ────────────────────────────────────────────────
   평문 TCP 다. 인증서를 만들 수 없어 TLS 는 흉내내지 않고, 대신 붙는 방법을
   시험에서 갈아 끼운다(smtpSend 의 connect). 운영 경로는 언제나 tls.connect 다. */
function fakeSmtp(opts) {
  opts = opts || {};
  const said = [];              // 클라이언트가 보낸 줄 전부
  let dataMode = false;
  let mailText = [];
  let sawClose;
  // ★ 대화를 검사하기 전에 여기서 기다린다. smtpSend 가 resolve 한 순간에는
  //   마지막 줄(QUIT)이 아직 날아가는 중이라, 바로 보면 없는 것처럼 보인다.
  const closed = new Promise(function (r) { sawClose = r; });

  const server = net.createServer(function (sock) {
    sock.on('close', sawClose);
    sock.setEncoding('utf8');
    sock.write('220 fake.smtp ESMTP\r\n');
    let buf = '';
    sock.on('data', function (chunk) {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);

        if (dataMode) {
          if (line === '.') { dataMode = false; sock.write('250 2.0.0 OK queued\r\n'); }
          else mailText.push(line);
          continue;
        }

        said.push(line);
        const cmd = line.split(' ')[0].toUpperCase();
        if (cmd === 'EHLO')      sock.write('250-fake.smtp Hello\r\n250-SIZE 35882577\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (cmd === 'AUTH') sock.write((opts.authReply || '235 2.7.0 Accepted') + '\r\n');
        else if (cmd === 'MAIL') sock.write('250 2.1.0 OK\r\n');
        else if (cmd === 'RCPT') sock.write('250 2.1.5 OK\r\n');
        else if (cmd === 'DATA') { dataMode = true; sock.write('354 Go ahead\r\n'); }
        else if (cmd === 'QUIT') { sock.write('221 Bye\r\n'); sock.end(); }
        else sock.write('502 5.5.2 Unrecognized\r\n');
      }
    });
    sock.on('error', function () {});
  });

  return new Promise(function (res) {
    server.listen(0, '127.0.0.1', function () {
      res({
        port: server.address().port,
        said: said,
        text: function () { return mailText.join('\r\n'); },
        // 연결이 닫히거나 1초가 지나면 돌아온다(안 닫혀도 시험이 매달리지 않게)
        settle: function () {
          return Promise.race([closed, new Promise(function (r) { setTimeout(r, 1000); })]);
        },
        close: function () { server.close(); }
      });
    });
  });
}

/** 받은 원문에서 헤더 한 줄을 꺼낸다(접힌 줄까지 이어 붙인다). */
function header(raw, name) {
  const lines = raw.split('\r\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '') break;                                  // 헤더 끝
    if (lines[i].toLowerCase().indexOf(name.toLowerCase() + ':') === 0) {
      let v = lines[i].slice(name.length + 1).trim();
      while (i + 1 < lines.length && /^[ \t]/.test(lines[i + 1])) v += lines[++i].trim();
      out.push(v);
    }
  }
  return out;
}

/** =?UTF-8?B?…?= 를 원래 글자로 되돌린다. */
function decodeWords(s) {
  return String(s).replace(/=\?UTF-8\?B\?([^?]*)\?=/gi, function (_, b) {
    return Buffer.from(b, 'base64').toString('utf8');
  });
}

/** 본문(base64)을 되돌린다. */
function decodeBody(raw) {
  const at = raw.indexOf('\r\n\r\n');
  return Buffer.from(raw.slice(at + 4).replace(/\r\n/g, ''), 'base64').toString('utf8');
}

const MESSAGE = 'Core 와 Standard 차이가 궁금합니다.\n줄바꿈도 그대로 와야 합니다.\n특수문자 & < > "';

(async function () {
  /* ── 1. 정상 한 통 ─────────────────────────────────────────── */
  console.log('\n== 정상 발송 — 대화와 원문');
  const s1 = await fakeSmtp();
  const message = mail.buildMessage({
    from: 'beimptech@gmail.com',
    to: 'beimptech+rcw@gmail.com',
    subject: '[RCW 문의] (주)테스트 홍길동',
    text: MESSAGE,
    replyToName: '홍길동',
    replyToEmail: 'customer@example.com'
  });
  await mail.smtpSend({
    user: 'beimptech@gmail.com', pass: 'appp asswo rdxx xxxx',
    from: 'beimptech@gmail.com', to: 'beimptech+rcw@gmail.com',
    message: message,
    connect: function () { return net.connect(s1.port, '127.0.0.1'); }
  });

  await s1.settle();
  console.log(s1.said.map(function (l) {
    return '     | ' + (l.indexOf('AUTH PLAIN') === 0 ? 'AUTH PLAIN <가림>' : l);
  }).join('\n'));

  const cmds = s1.said.map(function (l) { return l.split(' ')[0].toUpperCase(); });
  ok('대화 순서 EHLO→AUTH→MAIL→RCPT→DATA→QUIT',
     cmds.join(',') === 'EHLO,AUTH,MAIL,RCPT,DATA,QUIT', cmds.join(','));

  // 여러 줄 응답(250-SIZE…)을 한 응답으로 읽었는지 — 못 읽으면 여기서 어긋난다
  ok('여러 줄 250- 응답을 한 덩어리로 처리', cmds.filter(function (c) { return c === 'MAIL'; }).length === 1);

  const NUL = String.fromCharCode(0);
  const auth = Buffer.from(s1.said[1].slice('AUTH PLAIN '.length), 'base64').toString('utf8');
  ok('AUTH PLAIN 이 NUL 로 나뉜 아이디·비밀번호',
     auth === NUL + 'beimptech@gmail.com' + NUL + 'appp asswo rdxx xxxx',
     JSON.stringify(auth.split(NUL).join('[NUL]')));

  const raw = s1.text();
  ok('제목이 되살아난다', decodeWords(header(raw, 'Subject')[0]) === '[RCW 문의] (주)테스트 홍길동',
     decodeWords(header(raw, 'Subject')[0]));
  ok('본문이 한 글자도 안 틀리고 되살아난다', decodeBody(raw) === MESSAGE);
  ok('Reply-To 가 문의자', decodeWords(header(raw, 'Reply-To')[0]) === '홍길동 <customer@example.com>',
     decodeWords(header(raw, 'Reply-To')[0]));
  ok('보내는 사람은 우리 계정', header(raw, 'From').length === 1 &&
     header(raw, 'From')[0].indexOf('<beimptech@gmail.com>') > 0);
  ok('base64 줄이 76자를 안 넘는다',
     raw.slice(raw.indexOf('\r\n\r\n') + 4).split('\r\n').every(function (l) { return l.length <= 76; }));
  s1.close();

  /* ── 2. 헤더 주입 ───────────────────────────────────────────
     이름·메일은 문의자가 적는다. 개행을 넣어 헤더를 지어내지 못해야 한다. */
  console.log('\n== 헤더 주입 시도');
  const evil = mail.buildMessage({
    from: 'beimptech@gmail.com', to: 'beimptech+rcw@gmail.com',
    subject: '제목\r\nBcc: victim@example.com',
    text: '본문',
    replyToName: '홍길동\r\nBcc: victim@example.com',
    replyToEmail: 'customer@example.com'
  });
  const head = evil.slice(0, evil.indexOf('\r\n\r\n'));
  ok('Bcc 가 새로 생기지 않는다', head.toLowerCase().indexOf('\r\nbcc:') === -1);
  ok('헤더 줄 수가 늘지 않는다', head.split('\r\n').filter(function (l) { return /^[A-Za-z-]+:/.test(l); }).length === 9,
     head.split('\r\n').filter(function (l) { return /^[A-Za-z-]+:/.test(l); }).length + '줄');

  // 주소 형태가 아니면 Reply-To 를 아예 안 붙인다
  const noReply = mail.buildMessage({
    from: 'beimptech@gmail.com', to: 'x@y.com', subject: 's', text: 't',
    replyToName: '아무개', replyToEmail: 'not-an-email'
  });
  ok('메일 형식이 아니면 Reply-To 를 안 붙인다', header(noReply, 'Reply-To').length === 0);

  /* ── 3. 인증 실패 ───────────────────────────────────────────
     Gmail 앱 비밀번호가 틀리면 535 가 온다. 접수까지 500 이 되면 안 된다. */
  console.log('\n== 인증 실패(535)');
  const s3 = await fakeSmtp({ authReply: '535 5.7.8 Username and Password not accepted' });
  let threw = null;
  try {
    await mail.smtpSend({
      user: 'u@example.com', pass: 'bad', from: 'u@example.com', to: 'x@y.com',
      message: 'From: u@example.com\r\n\r\ndGVzdA==',
      connect: function () { return net.connect(s3.port, '127.0.0.1'); }
    });
  } catch (e) { threw = e; }
  ok('smtpSend 는 실패를 던진다', !!threw, threw && threw.message);
  ok('오류 문구에 비밀번호가 안 들어간다', !threw || threw.message.indexOf('bad') === -1);
  s3.close();

  /* ── 4. 설정이 없으면 조용히 안 보낸다 ───────────────────── */
  console.log('\n== 환경변수 미설정');
  delete process.env.MAIL_USERNAME;
  delete process.env.MAIL_APP_PASSWORD;
  ok('mailConfig() 가 null', mail.mailConfig() === null);
  const sent = await mail.sendMail({ subject: 's', text: 't' });
  ok('sendMail 이 던지지 않고 false', sent === false);

  /* ── 5. 받는 곳 기본값 ───────────────────────────────────── */
  process.env.MAIL_USERNAME = 'beimptech@gmail.com';
  process.env.MAIL_APP_PASSWORD = 'abcd efgh ijkl mnop';
  const cfg = mail.mailConfig();
  ok('기본 수신 주소', cfg.to === 'beimptech+rcw@gmail.com', cfg.to);
  ok('앱 비밀번호의 공백을 턴다', cfg.pass === 'abcdefghijklmnop', cfg.pass);
  ok('기본 서버', cfg.host === 'smtp.gmail.com' && cfg.port === 465, cfg.host + ':' + cfg.port);
  ok('MAIL_FROM 을 안 넣으면 보낸사람 = 계정', cfg.from === 'beimptech@gmail.com', cfg.from);

  /* ── 6. MAIL_FROM — 보이는 주소와 봉투 주소는 다른 것이다 ──
     받은 편지함의 보낸사람 칸은 헤더 From 이고, 서버가 인증을 보는 것은 봉투(MAIL FROM)다.
     MAIL_FROM 을 바꿔도 봉투는 계정 그대로여야 한다 — 봉투를 바꾸면 Gmail 이 거부한다. */
  console.log('\n== MAIL_FROM 으로 보낸사람 바꾸기');
  process.env.MAIL_FROM = 'beimptech+rcw@gmail.com';
  const s6 = await fakeSmtp();
  const sent6 = await mail.sendMail(
    { subject: '[RCW 문의] 회사 이름', text: '본문', replyToName: '이름', replyToEmail: 'c@example.com' },
    function () { return net.connect(s6.port, '127.0.0.1'); }
  );
  await s6.settle();
  const raw6 = s6.text();
  const envelope = (s6.said.find(function (l) { return l.indexOf('MAIL FROM') === 0; }) || '');
  const rcpt = (s6.said.find(function (l) { return l.indexOf('RCPT TO') === 0; }) || '');
  console.log('     | ' + envelope + '\n     | ' + rcpt + '\n     | From: ' + header(raw6, 'From')[0]);
  ok('sendMail 이 true', sent6 === true);
  ok('보이는 보낸사람 = MAIL_FROM',
     header(raw6, 'From')[0].indexOf('<beimptech+rcw@gmail.com>') > 0, header(raw6, 'From')[0]);
  ok('봉투는 계정 그대로', envelope === 'MAIL FROM:<beimptech@gmail.com>', envelope);
  ok('받는 곳은 그대로', rcpt === 'RCPT TO:<beimptech+rcw@gmail.com>', rcpt);
  s6.close();
  delete process.env.MAIL_FROM;

  console.log('\n' + (fails ? '▶ ' + fails + '개 실패' : '▶ 전부 OK'));
  process.exit(fails ? 1 : 0);
})();
