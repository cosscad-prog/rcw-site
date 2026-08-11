# 기존 고객 다운로드 페이지

구매 고객이 라이선스 코드로 들어와 최신 설치 파일을 받는 페이지다.
주소는 `https://rcw-site.vercel.app/customer` 이며, 검색에는 노출되지 않는다(`noindex`).

## 어떻게 동작하나

```
고객 ─ V5KO-XXXXXXXXXXXX 입력 ─▶ /api/customer-login ─▶ Supabase customers
                                        │  (service key, 서버에서만)
                                        ▼
                                  다운로드 링크 반환
```

로그인 조건은 **라이선스 코드 하나**다. 이름·회사·전화번호는 로그인 조건이 아니라
로그인한 뒤 "본인 정보가 맞는지" 확인하도록 화면에 보여주는 값이다.

그렇게 한 이유:

- 이름·회사·전화는 비밀이 아니다. 네 개를 모두 맞춰야 들어갈 수 있게 하면 보안은
  그대로인 채 `(주)○○` 대 `○○`, `010-1234-5678` 대 `01012345678`, 담당자 퇴사 같은
  이유로 **정작 고객이 못 들어오는 일**만 생긴다.
- 코드는 `V5KO-` + 12자리 16진수 = 48비트 무작위(`RCWLicenseIssuer/Program.cs`)라
  자격증명으로 충분히 강하다.
- 받은 설치 파일도 라이선스 없이는 동작하지 않는다. 진짜 관문은 라이선스 쪽이다.

입력값은 영숫자만 남기고 대문자로 바꿔 비교하므로 대소문자·띄어쓰기·하이픈이 달라도 된다.

## 신규 고객 (평상시 절차)

기존 고객 이전용으로 만든 흐름이 그대로 신규 판매 절차다.

```
입금 확인 → 코드 발급·전달 → 고객: 코드 입력 → 정보 확인 → 다운로드
          → 설치 → 머신코드 붙여넣기 → 몇 분 뒤 라이선스 자동 수령
```

손대는 곳은 코드를 만들어 보내는 한 번뿐이다.

```powershell
cd C:\std\Web\rcw-site
.\new-customer-code.ps1 -Company "(주)새고객" -Name 홍길동 -Email hong@x.co.kr -Edition Standard
```

INSERT 문과 코드가 나온다. INSERT 는 Supabase 에 붙여넣고, 코드는 고객에게 보낸다
(메일 문안 `MIGRATION_EMAIL_ko.md`). `-AppendCsv 보낸코드.csv` 를 주면 대조표에 줄이
쌓인다.

### 코드를 만드는 것이 곧 제품을 인도하는 것이다

그 코드 하나로 고객은 설치 파일을 받고 라이선스까지 자동으로 받는다. **입금이 확인된
뒤에** 만든다.

### 에디션은 여기서만 정해진다

Core 를 산 고객에게 Standard 로 코드를 만들면 그 고객은 Standard 를 받고 Standard
라이선스까지 발급된다. 뒤에서 막아주는 장치가 없다.

### 자동 발급이 도는 조건

고객이 머신코드를 올릴 때 **발급기의 [자동 발급 대기] 가 켜져 있어야 한다.** 꺼져
있으면 요청은 쌓이기만 하고 고객 화면은 "발급을 준비하고 있습니다" 에 머문다.
서명 개인키가 발급 PC 밖으로 나가지 않기 때문이며, 그래서 창을 닫는 것이 곧 잠금이다.

## 기존 고객 이전 (마이그레이션)

기존 고객은 아직 V5KO 라이선스가 없다. 그런데 **라이선스를 받으려면 새 버전을 설치해
머신코드를 알려줘야 하고, 새 버전을 받으려면 코드로 로그인해야 한다** — 순환이다.
그래서 임시코드를 먼저 만들어 명부에 넣고 안내한다.

```
사장님 : 고객별 임시코드 생성 → 명부 등록 → 각자에게 메일
고객   : 코드 입력 → (처음이면) 정보 확인 화면 → 저장 → 다운로드 → 설치
         → 머신코드 전달
사장님 : .lic 발급 → 발급기가 정식 V5KO 코드로 행을 하나 더 만든다
         (임시코드·정식코드 둘 다 동작)
```

### 코드는 고객별로 지정해야 한다

다운로드 페이지는 명부의 `edition` 값으로 보여줄 파일을 정한다. **익명 코드를 뿌리면
그 사람이 Core 인지 Standard 인지 알 수 없다.** 고객에게 고르게 하면 모두 Standard 를
고른다. 그래서 코드를 만들 때 누구에게 줄지와 에디션을 함께 정한다.

### 만드는 법

`customers.csv` 를 만들고(첫 줄은 그대로):

```
company,name,phone,email,edition
(주)가나건설,홍길동,010-1111-2222,hong@gana.co.kr,Standard
(주)다라창호,김철수,,,Core
```

모르는 값은 비워 둔다 — 고객이 확인 화면에서 채운다.

```powershell
cd C:\std\Web\rcw-site
.\new-migration-codes.ps1 -CsvPath .\customers.csv -OutCsv .\보낸코드.csv
```

INSERT 문과 고객별 코드 목록이 나온다. INSERT 는 Supabase SQL Editor 에 붙여넣고,
코드는 **각 고객에게 자기 것 하나만** 보낸다. `-OutCsv` 로 남긴 대조표는 고객 접근수단
이므로 발송이 끝나면 지운다.

### 정보 확인 화면

`info_confirmed_at` 이 비어 있는 고객은 다운로드 전에 한 번 이 화면을 본다. 알고 있는
값은 미리 채워 두므로 고객은 틀린 것만 고치면 된다. 이메일만 필수다 — 라이선스 파일을
보낼 곳이라 이게 없으면 다음 단계가 막힌다. 저장하면 시각이 찍히고, 다음 방문부터는
바로 다운로드로 간다.

### 누가 아직 안 받아갔나

```sql
select company, name, edition, license_id
  from public.customers
 where info_confirmed_at is null
 order by company;
```

## 최초 설정 (한 번만)

### 1. 테이블 만들기

Supabase → SQL Editor → `docs/supabase-customers.sql` 전체를 붙여넣고 Run.

마지막 확인 결과가 아래와 같아야 한다. **anon 정책이 보이면 잘못된 것이다** —
고객 명부는 브라우저에서 접근할 수 없어야 한다.

| table_name | rls_enabled | policies |
|---|---|---|
| customers | true | admin can read customers |
| customer_access | true | admin can read customer access |

### 2. Vercel 환경변수

Vercel → 프로젝트 → Settings → Environment Variables. 세 개를 Production 에 등록한다.

| 이름 | 값 | 비고 |
|---|---|---|
| `SUPABASE_URL` | `https://xxxxxxxx.supabase.co` | Supabase → Settings → API |
| `SUPABASE_SERVICE_KEY` | `service_role` 키 | ★ 웹페이지·GitHub 에 절대 넣지 말 것 |
| `CUSTOMER_RELEASE_REPO` | `cosscad-prog/rcw-customer-releases` | 생략하면 이 값이 기본 |

`service_role` 키는 RLS 를 우회한다. 서버리스 함수 안에서만 쓰이고 브라우저로는
내려가지 않는다. 등록 후 **재배포해야** 값이 반영된다.

### 3. 유료판 릴리스 저장소

평가판(`rcw-releases`)과 **별도 저장소**를 만들고, 어디에도 링크하지 않는다.

파일명은 트라이얼과 같은 규칙으로 **버전을 붙인 이름**으로 올린다(2026-07-29). 받는
사람이 어느 빌드인지 알 수 있어야 하기 때문이고, 그래서 릴리스마다 바뀌는
`releases/latest/download/<파일명>` 링크는 `publish-customer.ps1` 이 발행 직후
`api/customer-login.js` 의 `RELEASE_VERSION` 을 고쳐 커밋·푸시한다.

언어는 파일을 가르지 않는다(2026-07-30). 설치 파일 하나가 한국어·영어를 모두 담고
설치할 때 고르므로, 에디션 2 × Rhino 2 = **4개**다.

```
RCW_V5_Core_Rhino7_<버전>.exe        RCW_V5_Standard_Rhino7_<버전>.exe
RCW_V5_Core_Rhino8_<버전>.exe        RCW_V5_Standard_Rhino8_<버전>.exe
```

이 저장소의 릴리스는 공개 상태여야 링크가 열린다. 즉 **주소를 아는 사람은 받을 수
있다.** 그래도 라이선스가 실사용을 막으므로 이 정도로 둔다. 더 조이려면
Cloudflare R2 + 10분짜리 서명 URL 로 바꾸면 되고, 함수의 `fileList()` 한 곳만 고치면 된다.

### 4. 라이선스 요청 알림 (텔레그램)

발급기는 **켜 두는 동안에만** 발급한다(그게 잠금이다). 그래서 요청이 언제 들어오는지
모르면 고객이 하염없이 기다린다. 요청이 우편함에 들어온 순간 휴대폰으로 알림이 가게 해 둔다.

**봇 만들기** — 텔레그램에서 `@BotFather` 와 대화

1. `/newbot` → 이름과 사용자명(끝이 `bot`) 입력 → **토큰**을 받는다 (`8123456789:AAE...`)
2. 방금 만든 봇을 찾아 **아무 말이나 한 번 보낸다** (이걸 해야 봇이 나에게 말을 걸 수 있다)
3. 브라우저에서 `https://api.telegram.org/bot<토큰>/getUpdates` 를 연다 →
   `"chat":{"id":123456789` 의 숫자가 **chat id**

**Vercel 환경변수** (Settings → Environment Variables, Production)

| 이름 | 값 |
|---|---|
| `TELEGRAM_BOT_TOKEN` | BotFather 가 준 토큰 |
| `TELEGRAM_CHAT_ID` | 위에서 확인한 숫자 |

등록 후 **재배포해야** 반영된다.

**동작** — `api/license-request.js` 가 우편함에 넣은 직후 `api/_notify.js` 를 부른다.

- 두 환경변수가 **없으면 조용히 아무것도 안 한다.** 알림만 없고 접수는 정상이다
- 텔레그램이 죽거나 느려도(4초 타임아웃) **고객의 요청은 정상 접수된다** — 예외를 안에서 삼킨다
- 라이선스 코드·머신코드는 **가려서** 보낸다(`V5KO497E…9694`). 알림은 휴대폰에 남기 때문이다
- 이미 다른 PC 가 등록된 고객이면 "**보류됩니다**" 로 문구가 바뀐다 — 발급기를 켜도
  자동 발급되지 않는 건이라 켜기 전에 알고 있어야 한다

## 고객 등록 — 발급기가 자동으로 한다

`RCWLicenseIssuer` 가 라이선스를 만들고 원장에 기록한 뒤, `/api/customer-upsert` 를
호출해 명부에도 올린다. 발급 화면 마지막 줄에 결과가 나온다.

```
Created perpetual license: V5KO-…
C:\Users\…\V5KO-….lic
Customer portal: customer added.
```

### 왜 발급기가 Supabase 를 직접 쓰지 않나

그러려면 service key 가 데스크톱 exe 안에 있어야 한다. 그 키는 RLS 를 우회해 모든
데이터를 읽고 지울 수 있다. 대신 등록 전용 엔드포인트만 열고, 발급기에는 거기에만
통하는 토큰을 준다. 토큰이 새더라도 할 수 있는 일은 고객 행 하나를 추가·갱신하는
것뿐이다.

### 설정 (한 번만)

**1) 토큰 만들기** — 아무 긴 무작위 문자열이면 된다.

```powershell
[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

**2) Vercel 환경변수**에 `CUSTOMER_ADMIN_TOKEN` 으로 등록하고 재배포한다.

**3) 발급기 옆에 `portal-config.json`** 을 만든다. `RCW_V5_License_Issuer.exe` 와
같은 폴더다.

```json
{
  "endpoint": "https://rcw-site.vercel.app/api/customer-upsert",
  "adminToken": "2단계에서 만든 그 값"
}
```

이 파일은 발급 PC 에만 둔다. 소스에는 토큰이 들어 있지 않고, 파일이 없으면 발급기는
등록을 건너뛰고 그렇게 알려 준다(발급 자체는 정상 진행된다).

### 실패했을 때

사이트가 닫혀 있거나 토큰이 틀리면 발급 화면에 이유가 뜬다. **라이선스 발급은 그대로
끝난 것이다** — 파일도 원장도 남는다. 명부만 나중에 손으로 채우면 된다.
`docs/supabase-customers.sql` 맨 아래에 그대로 쓸 수 있는 INSERT 예시가 있다.

### 갱신 규칙

같은 코드가 이미 있으면 **라이선스에서 나오는 값만** 덮어쓴다(에디션·기기코드·발급일).
관리자가 채워 넣은 회사·전화·이메일은 건드리지 않는다.

발급기는 "받는 사람 또는 회사" 한 칸만 받으므로 그 값이 `name` 에 들어간다.

### 빈 정보를 채우는 법 — `/admin` 고객 탭 [고치기]

코드를 먼저 뿌리고 사람이 나중에 배정되는 경우, 명부에 **코드만 있고 연락처가 빈 줄**이
남는다. 고객 탭의 각 행 오른쪽 **[고치기]** 로 회사·담당자·연락처·이메일·메모를 채운다.
쓰기 권한은 `docs/supabase-customer-edit.sql` 을 SQL Editor 에서 한 번 실행해야 열린다.

★ 코드·에디션·기기코드는 **일부러 열지 않았다**. 라이선스 장부에서 나오는 값이라
화면에서 고치면 실제 `.lic` 과 어긋난다. 정책이 아니라 **컬럼 단위 grant** 로 막으므로
브라우저 콘솔에서 직접 PATCH 를 던져도 통하지 않는다.

고객이 스스로 채우게 하려면 그 행의 `info_confirmed_at` 을 `null` 로 지운다. 다음
로그인 때 정보 확인 화면이 다시 뜬다(`api/customer-login.js` 의 `needs_info`).

### 영구인지 구독인지

고객 탭의 **영구/구독 열**(에디션과 내려받음 사이). 기준은 `paid_through`(청구 만료일)
하나다 — 비어 있으면 영구 고객이고 `renewal_watch` 뷰에서 통째로 빠진다.

| 보이는 것 | 뜻 |
|---|---|
| `영구` | `paid_through` 없음. 갱신 안내 대상이 아니다 |
| `구독 ~2027-07-31` | `paid_through` 있음. 갱신 탭에도 함께 나온다 |
| `기한 있음 · 청구일 미기재` | `expires_on` 만 있다 ⚠️ |

⚠️ 마지막 줄이 위험한 상태다. `.lic` 에는 만료일이 걸려 있는데 청구일이 없어
**갱신 안내가 나가지 않은 채 고객이 어느 날 잠긴다.** `paid_through` 를 채워 넣을 것
(`supabase-renewals.sql` 맨 아래에 예시 UPDATE 가 있다). 청구일은 [고치기] 로는
못 바꾼다 — 돈이 걸린 값이라 일부러 SQL 에만 두었다.

메모는 표에 나오지 않고 **담당자 칸에 마우스를 올렸을 때만** 뜬다(값은 [고치기]·CSV·검색에 그대로).
마이그레이션 임시코드처럼 알맹이 없는 문구가 줄마다 깔려 화면만 복잡해졌던 것을 2026-08-05 에 뺐다.

### 어느 Rhino 를 받아 갔는지

고객 탭의 **내려받음** 열. 따로 저장하는 값이 아니라 `customer_access` 의 다운로드
기록에서 파일명(`RCW_V5_<에디션>_Rhino<7|8>.exe`)을 읽어 보여 준다. 둘 다 받았으면
둘 다 표시하고 최근 것이 앞에 온다. 태그에 마우스를 올리면 마지막으로 받은 시각이 뜬다.

⚠️ **받아 간 기록이지 설치 결과가 아니다.** 플러그인은 서버로 아무것도 보내지 않으므로
실제 설치 여부는 알 수 없고, 카톡·메일로 직접 보낸 고객은 `—` 로 남는다.

### 라이선스를 교체했을 때

새 기기로 재발급하면 원장의 옛 항목은 `Replaced` 가 되지만, **명부의 옛 행은 그대로
둔다.** 같은 고객이므로 옛 코드로 들어와도 받을 수 있게 하는 편이 낫다. 정말 막아야
하면 그 행의 `status` 를 `suspended` 로 바꾼다.

중지하려면 `status` 를 `suspended` 로 바꾼다. 로그인은 되지만 다운로드 버튼이 사라지고
문의 안내가 뜬다.

## 확인하는 법

- 누가 언제 들어왔는지 / 무엇을 받았는지: `customer_access` 테이블
- 실패한 시도: 같은 테이블의 `action = 'login_failed'`, `code_tried` 에 입력값이 남는다
- 같은 IP 에서 10분 안에 10번 실패하면 그 IP 는 10분간 막힌다

## 검증해 둔 것

`api/customer-login.js` 는 Supabase·GitHub 없이 스텁으로 16개 항목을 통과했다
(정상 로그인, 표기 흔들림 흡수, 없는 코드 401, 짧은 입력은 DB 조회 없이 거절,
실패 누적 429, 중지 고객 파일 0개, GET 405). 페이지 스크립트도 문법 검사를 마쳤다.

**남은 검증은 실제 배포 뒤에만 가능하다** — 환경변수가 붙은 상태에서 실제 코드로
로그인해 보는 것. 그 전까지 페이지는 "일시적인 오류" 를 띄운다.
