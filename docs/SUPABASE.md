# Supabase 설정 안내

문의와 Trial 신청을 데이터베이스에 기록하고, 새 접수가 있으면 메일로 알림을 받는다.

| 단계 | 내용 | 소요 |
|---|---|---|
| 1 | 프로젝트 생성 | 5분 |
| 2 | 테이블·보안정책 SQL 실행 | 2분 |
| 3 | URL·키 확인 | 2분 |
| 4 | 사이트 코드 연결 | (자동) |
| 5 | 메일 알림 연결 | 30분 |

---

## 1단계 — 프로젝트 생성

1. https://supabase.com → **Start your project** → GitHub 계정으로 로그인
2. **New project**
   - Name: `rcw-site`
   - **Database Password**: 강력한 값으로 자동 생성하고 **반드시 따로 보관**한다.
     분실하면 재설정해야 한다. 웹사이트 연결에는 쓰지 않지만 DB 직접 접속 시 필요하다.
   - Region: **Northeast Asia (Seoul)** — 한국 사용자 대상이므로 가장 가깝다
3. **Create new project** → 준비까지 1~2분 걸린다

---

## 2단계 — 테이블 만들기

1. 좌측 메뉴 **SQL Editor** → **New query**
2. `docs/supabase-setup.sql` 파일 내용을 전부 복사해 붙여넣기
3. **Run** (또는 Ctrl+Enter)

마지막에 확인 결과가 표로 나온다. 아래와 같아야 한다.

| table_name | rls_enabled | policy_count |
|---|---|---|
| contacts | true | 1 |
| trial_requests | true | 1 |

**`rls_enabled` 가 true 가 아니면 진행하지 말 것.** 보안 설정이 안 된 상태다.

좌측 **Table Editor** 에 들어가면 두 테이블이 보인다. 접수된 문의는 여기서 확인한다.

---

## 3단계 — URL과 키 확인

좌측 하단 **Project Settings → API**

두 값이 필요하다.

| 항목 | 형태 | 용도 |
|---|---|---|
| **Project URL** | `https://xxxxxxxx.supabase.co` | 접속 주소 |
| **anon public** 키 | `eyJhbGci...` 로 시작하는 긴 문자열 | 익명 접근용 |

### anon 키를 웹페이지에 넣어도 되는 이유

anon 키는 **공개를 전제로 만들어진 키**다. 이 키로 할 수 있는 일은
2단계에서 만든 RLS 정책이 허용한 범위 — 즉 **INSERT(쓰기)뿐**이다.
남의 문의를 읽거나 삭제할 수 없다.

### 절대 웹페이지에 넣으면 안 되는 것

같은 화면의 **`service_role`** 키는 RLS를 무시하고 모든 데이터에 접근한다.
이 키가 노출되면 전체 데이터가 열린다. 웹페이지·GitHub에 절대 넣지 말 것.

---

## 4단계 — 사이트 연결

3단계의 두 값을 알려주면 `contact.html` 과 `trial.html` 에 반영한다.

⚠️ **제품 문의와 Trial 신청은 2026-08-11부터 공개키로 넣지 않는다.**
브라우저 → `/api/contact` · `/api/trial`(Vercel 함수, service key) → 저장 → **텔레그램 알림** 순서다.
공개키가 아직 쓰이는 곳은 **`trial.html` 의 다운로드 클릭 기록(`downloads`)** 하나뿐이다.

> ⚠️ **2026-08-24 — 그 한 곳이 한 달 내내 막혀 있었다.** 표를 만든 2026-07-26 부터
> `downloads` 에 한 줄도 들어가지 않았다(`count = 0`). 막은 것이 둘이다 —
> ① INSERT 정책 누락(42501), ② `lang` 이 `NOT NULL` 인데 2026-07-30 부터 페이지가 늘 `null` 을 보냄.
> `fetch` 는 401 을 예외로 보지 않아 페이지에는 아무 흔적도 남지 않았다.
> 고침: `docs/supabase-downloads-fix.sql` 실행 + `trial.html` 이 `res.ok` 를 확인하도록 수정.
> **공개키로 쓰는 경로를 새로 만들면 실제로 한 줄 넣어 보고 응답 코드를 볼 것.**
`contacts` / `trial_requests` 의 anon INSERT 정책은 남겨 두었지만 이제 아무도 쓰지 않는다
(되돌릴 때를 위한 것).

---

## 5단계 — 알림

**제품 문의와 Trial 신청은 텔레그램으로 온다** (2026-08-11 적용). 설정은 라이선스 요청 알림과
같은 것을 그대로 쓴다 — Vercel 환경변수 `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` 둘뿐이고,
보내는 코드는 `api/_notify.js` 의 `notifyContact()` / `notifyTrialRequest()` 다.
자세한 것은 `docs/CUSTOMER_PORTAL.md`.

아래 Resend + Edge Function 방식은 **대안**이다(메일로 받고 싶을 때). 지금은 할 필요가 없다.

이 설정을 하지 않으면 Supabase 대시보드에 직접 들어가야 접수를 확인할 수 있다.

### 5-1. Resend 가입

1. https://resend.com → 가입
2. **API Keys** → **Create API Key** → 생성된 값 보관 (한 번만 표시됨)

도메인 인증 없이도 **본인 주소로 보내는 것**은 가능하다.
`rcw.co.kr` 같은 도메인을 나중에 구입하면 발신 주소를 그것으로 바꿀 수 있다.

### 5-2. Edge Function 배포

Supabase 대시보드 → **Edge Functions** → **Deploy a new function**
함수 이름 `notify`, 아래 코드를 붙여넣는다.

```ts
Deno.serve(async (req) => {
  const { record, table } = await req.json();

  const isTrial = table === "trial_requests";
  const subject = isTrial
    ? `[RCW] Trial 신청 — ${record.name}`
    : `[RCW] 제품 문의 — ${record.name}`;

  const rows = Object.entries(record)
    .filter(([k, v]) => v && !["id"].includes(k))
    .map(([k, v]) => `<tr><td><b>${k}</b></td><td>${v}</td></tr>`)
    .join("");

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "RCW <onboarding@resend.dev>",
      to: "beimptech@gmail.com",
      subject,
      html: `<table>${rows}</table>`,
    }),
  });

  return new Response("ok");
});
```

배포 후 **Edge Functions → notify → Secrets** 에서
`RESEND_API_KEY` 를 5-1에서 받은 값으로 등록한다.

### 5-3. 트리거 연결

**Database → Webhooks → Create a new hook**

- Name: `notify_contact`
- Table: `contacts`
- Events: **Insert** 만 체크
- Type: **Supabase Edge Functions** → `notify`

`trial_requests` 테이블에도 같은 방식으로 하나 더 만든다.

---

## 접수 확인하는 법

**Table Editor** → `contacts` 또는 `trial_requests`

- 신청일 역순 정렬은 인덱스가 있어 빠르다
- 우측 상단에서 **CSV 내보내기** 가 가능하다 (일괄 안내 메일 보낼 때)
- `trial_requests` 의 `contacted_at`, `note` 칸은 후속 관리용이다.
  연락한 날짜와 메모를 직접 적어 넣으면 된다

---

## 문제가 생겼을 때

**폼 제출은 되는데 데이터가 안 보임**
→ Table Editor 에서 필터가 걸려 있는지 확인. 또는 RLS 정책이 INSERT 를 막고 있는지 확인

**폼 제출 시 401 / 403 오류**
→ anon 키가 잘못됐거나 RLS 정책이 없다. 2단계 확인 쿼리를 다시 실행해 볼 것

**문의 텔레그램이 안 옴** (문의는 저장돼 있는 경우)
→ Vercel → 프로젝트 → **Logs** 에서 `/api/contact` 실행 기록을 본다. `[notify]` 줄에 이유가 남는다.
   ★환경변수를 **등록만 하고 Redeploy 를 안 하면** 함수가 값을 못 본다 — 라이선스 알림 때 실제로 걸렸다

**문의 자체가 안 들어옴**
→ `/api/contact` 가 500 이면 `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` 환경변수를 먼저 본다.
   화면에는 "전송 중 문제가 발생했습니다 + 메일 주소" 가 뜨므로 고객은 메일로 우회할 수 있다

**메일이 안 옴** (5단계 Resend 방식을 쓰는 경우)
→ Edge Functions → notify → **Logs** 에서 실행 기록과 오류를 확인.
   `RESEND_API_KEY` 가 등록되어 있는지 먼저 볼 것

**스팸이 들어옴**
→ `contact.html` 에는 이미 honeypot(숨김 필드) 이 있다.
   그래도 심하면 Cloudflare Turnstile 등 캡차 추가를 검토한다
