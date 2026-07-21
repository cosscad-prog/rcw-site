# 자동 백업 · 일시정지 방지

## 왜 필요한가

Supabase 무료 플랜은 **7일간 API 요청이 없으면 프로젝트를 자동 일시정지**한다.
데이터는 보존되지만 프로젝트가 응답하지 않으므로,
그 사이에 방문자가 문의나 Trial 신청을 제출하면 **실패한다.**

방문자가 적을수록 이 문제가 자주 발생한다. 커튼월처럼 대상이 좁은 제품은
몇 주씩 조용한 기간이 생기기 쉬우므로, 어쩌다 온 한 명을 놓치지 않으려면
프로젝트를 깨워 두어야 한다.

또한 무료 플랜에는 **자동 백업이 없다.** 신청자 명단은 직접 챙겨야 한다.

## 무엇을 하는가

`.github/workflows/backup.yml` 이 **3일마다** 실행되며 세 가지를 한다.

1. Supabase 에 API 요청 → 일시정지 타이머 초기화
2. `contacts`, `trial_requests` 를 CSV 로 내려받아 아티팩트로 보관 (90일)
3. 실행 기록(`docs/_backup-status.md`)을 갱신해 커밋

3번이 필요한 이유: GitHub 은 **60일간 커밋이 없는 저장소의 예약 워크플로를
자동 비활성화**한다. 그러면 백업도 일시정지 방지도 멈춘다.
개인정보가 없는 건수 요약만 커밋해 저장소 활동을 유지한다.

### CSV 를 저장소에 커밋하지 않는 이유

이름·이메일·회사가 담긴 파일을 git 에 커밋하면 **이력에 영구히 남는다.**
나중에 삭제 요청을 받아도 커밋 이력에서 지우기 어렵다.
아티팩트는 90일 뒤 자동 삭제되므로 이쪽이 안전하다.

장기 보관이 필요하면 아티팩트를 내려받아 로컬이나 개인 드라이브에 두면 된다.

---

## 설정 (최초 1회)

### 1. 시크릿 등록

`rcw-site` 저장소 → **Settings → Secrets and variables → Actions**
→ **New repository secret** 으로 두 개 등록한다.

| 이름 | 값 |
|---|---|
| `SUPABASE_URL` | `https://hzqbhxewftjkolwebkgy.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Supabase → Project Settings → API → **Secret keys** 의 `sb_secret_...` |

⚠️ `SUPABASE_SERVICE_KEY` 는 RLS 를 무시하고 모든 데이터에 접근하는 키다.
전체 조회가 필요하므로 여기서만 사용한다.
**웹페이지나 코드에는 절대 넣지 말 것.** GitHub Secrets 는 암호화 저장되고
실행 로그에도 마스킹된다.

키 값은 Supabase → Project Settings → API → Secret keys 에서
눈 모양 아이콘을 눌러 확인한다.

### 2. 동작 확인

저장소 **Actions** 탭 → **Supabase 백업** → **Run workflow**
로 즉시 한 번 실행해 본다.

성공하면 실행 화면 하단 **Artifacts** 에 `supabase-backup-1` 이 생긴다.
내려받아 CSV 두 개가 들어 있는지 확인한다.

---

## 명단 확인하는 법

| 방법 | 위치 |
|---|---|
| 즉시 확인 | Supabase → Table Editor → `trial_requests` |
| CSV 내려받기 | GitHub → Actions → 최근 실행 → Artifacts |
| 건수만 빠르게 | `docs/_backup-status.md` |

---

## 실패했을 때

Actions 탭에서 실패한 실행을 열어 로그를 본다.

| 증상 | 원인 |
|---|---|
| `시크릿이 설정되지 않았습니다` | 1번 단계를 하지 않았거나 이름 오타 |
| `조회 실패 (HTTP 401)` | `SUPABASE_SERVICE_KEY` 값이 잘못됨 |
| `조회 실패 (HTTP 404)` | 테이블 이름이 다르거나 SQL 이 실행되지 않음 |
| 오래 방치 후 첫 실행 실패 | 이미 일시정지된 상태일 수 있다. Supabase 대시보드에서 재개 후 다시 실행 |

## 프로젝트가 이미 정지되었다면

Supabase 대시보드에 들어가면 **Restore project** 버튼이 보인다.
눌러서 재개하면 데이터는 그대로 살아난다. 재개까지 1~2분 걸린다.

---

## 유료 전환을 고려할 시점

Pro 플랜(월 $25)은 자동 일시정지가 없고 일 단위 백업이 제공된다.
아래에 해당하면 전환을 검토한다.

- 신청·문의가 꾸준히 들어와 명단의 가치가 커졌을 때
- 정지로 인해 실제로 제출 실패가 발생했을 때
- 결제를 붙여 매출이 발생하기 시작했을 때
