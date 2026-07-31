# 구독 갱신 관리

연 1회 수동 갱신 모델에서 **"오늘 누구에게 전화할지"** 를 알려주는 장치다.
고객에게 나가는 안내 메일 자동 발송은 아직 없다 — 지금은 관리자 알림까지다.

## 날짜가 두 개다 (제일 헷갈리는 부분)

| | 컬럼 | 뜻 | 누가 아는가 |
|---|---|---|---|
| **청구 만료일** | `customers.paid_through` | **돈을 내야 하는 날.** 모든 안내의 기준 | 서버·사람 |
| 라이선스 만료일 | `customers.expires_on` | `.lic` 파일이 죽는 날 = 청구 만료일 **+ 30일**(유예) | 플러그인·고객 |

고객 화면에 뜨는 날짜는 **`expires_on` 쪽**이다. 청구일보다 30일 뒤라서
"왜 날짜가 다르냐"는 문의가 올 수 있다. 유예를 파일 날짜에 녹여 넣었기 때문이고,
그래야 입금이 늦어도 작업이 안 멈춘다.

`paid_through` 가 **비어 있으면 영구 고객**이라 갱신 파이프라인에서 완전히 빠진다.
영구 고객에게 갱신 독촉이 가는 것이 이 기능 최악의 사고라, 뷰의 `where` 절에서 막았다.

## 처음 한 번 — SQL 실행 ★

**이걸 하기 전에는 `/admin` 갱신 탭이 "뷰가 없습니다" 만 띄운다.**

Supabase → SQL Editor → `docs/supabase-renewals.sql` 전체를 붙여넣고 Run.

마지막 확인 쿼리 두 개가 이렇게 나와야 한다:
- 컬럼 6개(`paid_through`·`cancelled_at`·`renewal_stage`·`renewal_stage_at`·`last_contact_at`·`contact_note`)
- `authenticated` 의 UPDATE 권한이 **딱 3칸**(`last_contact_at`·`contact_note`·`cancelled_at`)
  ⚠️ 여기에 `license_id`·`status` 가 보이면 잘못된 것이다. 관리자 화면에서 장부를 고칠 수 있게 된다.

## 단계와 우선순위

계산은 `renewal_watch` 뷰 **한 곳에만** 있다. 화면(`admin.html`)과 아침 알림
(`renewal_alert.py`)이 각자 계산하면 반드시 어긋나기 때문이다.

| 남은 일수 | `stage_now` | `priority` | 할 일 |
|---:|---|---:|---|
| 31일~ | `ok` | 0 | 아직 없음 |
| 30~8일 | `d30` | 1 | 갱신 안내 메일 |
| 7~0일 | `d7` | 2 | 확인 전화 |
| −1~−15일 | `due` | 3 | 전화·문자. 세금계산서 확인 |
| −16~−30일 | `grace` | 4 | 전화. 곧 잠김 |
| −31일~ | `locked` | 5 | **즉시 전화.** 이미 작업이 멈춰 있다 |

## 매일 아침 하는 일

`.github/workflows/renewal-alert.yml` 이 **09:00 KST** 에 두 가지를 순서대로 한다.

1. **고객 안내 메일** (`renewal_notice.py`) — 단계가 올라간 고객에게만
2. **관리자 알림** (`renewal_alert.py`) — 오늘 챙길 고객을 우선순위대로

순서가 중요하다. 안내를 먼저 보내야 관리자 알림에 "방금 보냄"이 반영된다.
안내 발송이 실패해도 관리자 알림은 나간다(`if: always()`).

Secrets 는 `daily-report` 워크플로가 쓰던 것을 그대로 쓴다(새로 등록할 것 없음).
수동 실행은 Actions 탭 → "구독 갱신 안내·알림" → Run workflow.

### ★★ 고객 메일은 기본으로 나가지 않는다

저장소 **Settings → Secrets and variables → Actions → Variables** 에
`SEND_CUSTOMER_MAIL = true` 를 넣어야 실제로 발송한다.
그전까지는 *"이런 메일이 나갈 예정"* 미리보기만 관리자에게 온다.
고객에게 잘못 나간 메일은 되돌릴 수 없어서 확인 단계를 일부러 두었다.

**켜기 전에 할 일**: 미리보기 메일에서 대상과 제목이 맞는지 보고,
Actions 탭에서 수동 실행해 본인 주소로 실제 문구를 한 번 받아 볼 것.

| Variable | 기본 | 뜻 |
|---|---|---|
| `SEND_CUSTOMER_MAIL` | (없음=미리보기) | `true` 여야 고객에게 실제 발송 |
| `MAX_SEND` | 20 | 한 번에 보낼 최대 통수. **넘으면 아무것도 안 보내고 실패한다** |
| `REPLY_TO`(Secret) | `MAIL_USERNAME` | 고객이 답장할 주소 |

`MAX_SEND` 는 데이터 실수를 막는 장치다. 날짜를 잘못 넣어 전 고객이
갑자기 만료 대상이 되면, 메일이 나가기 전에 실패로 멈춘다.

### 중복 발송을 막는 법

`renewal_stage` 에 **어디까지 보냈는지**를 남기고, 단계가 올라갔을 때만 보낸다
(`d30 → d7 → due → grace`). 이 기록이 없으면 cron 이 매일 돌면서
같은 고객에게 같은 메일을 매일 보낸다.

기록은 **발송에 성공한 뒤에** 한다. 순서를 바꾸면 기록만 되고 메일은 안 나간
고객이 생겨 영영 안내를 못 받는다. 반대 방향(하루 더 가는 것)이 덜 나쁘다.

`locked`(이미 잠긴 고객)에게는 자동 메일을 보내지 않는다 — 전화가 맞다.
이메일 주소가 없는 고객도 관리자 요약에 "직접 연락 필요"로 따로 나온다.

⚠️ 다운로드 요약(`daily-report`)은 밤 9시, 갱신 알림은 아침 9시다.
갱신은 "오늘 전화할 곳" 목록이라 업무 시작 전에 와야 쓸모가 있다.

## `/admin` 갱신 탭

로그인하면 **갱신 탭이 먼저 열린다.** 급한 순으로 정렬되고, `연락함` 버튼으로
통화 기록을 남기면 그 고객은 **7일 동안 아침 알림에서 뒤로 밀린다**
(`contacted_recently`). CSV 로 내려받아 전화 돌릴 때 옆에 두고 봐도 된다.

## 자주 쓰는 SQL

```sql
-- 구독 고객으로 전환 (이 순간부터 파이프라인에 들어온다)
update public.customers
   set paid_through = '2027-07-31',
       expires_on   = '2027-08-30'          -- paid_through + 유예 30일
 where license_id = 'V5KO-497E84809694';

-- 갱신 완료 (1년 연장 + 안내 단계 초기화)
update public.customers
   set paid_through     = paid_through + interval '1 year',
       expires_on       = paid_through + interval '1 year' + 30,
       renewal_stage    = null,
       renewal_stage_at = null
 where license_id = 'V5KO-497E84809694';

-- 해지 통보 (남은 기간은 그대로 두고 독촉만 멈춘다)
update public.customers set cancelled_at = now() where license_id = '...';
```

## 전체 흐름 (D = 청구 만료일)

| 시점 | 고객 | 관리자 |
|---|---|---|
| **D-30** | 안내 메일 (`d30`) | 알림 시작 |
| D-25 | Rhino 명령창 경고 시작 | |
| D-15 | Rhino 팝업 (세션당 1회) | |
| D-7 | 안내 메일 (`d7`) | 알림 |
| **D+0** | 안내 메일 (`due`). 여유 기간 시작 | 알림 |
| D+15 | 안내 메일 (`grace`) | 알림 |
| **D+30** | 잠금 | 알림(`locked`, 자동메일 대신 전화) |

메일이 제품 경고보다 5일 먼저 간다. 담당자가 먼저 알고, 실무자는 그다음에 본다.

## 아직 안 한 것

- **구독 자체가 아직 구현 전이다.** 발급기가 `.lic` 의 `expiresUtc` 를 채우기
  시작해야 실제로 돌아간다. 그전까지 모든 고객은 `paid_through` 가 비어 있어
  이 파이프라인은 아무 일도 하지 않는다.
- 전화·문자 자동 발송은 **하지 않는다.** 명단만 뽑고 거는 것은 사람이 한다.
