# Trial 설치 파일 배포 — GitHub Releases

설치 파일은 웹사이트 저장소가 아니라 **별도의 공개 저장소**에 올린다.

| 저장소 | 공개 여부 | 용도 |
|---|---|---|
| `cosscad-prog/rcw-site` | **Private** | 웹사이트 소스 |
| `cosscad-prog/rcw-releases` | **Public** | 설치 파일만 |

Private 저장소의 릴리스 파일은 로그인해야 받을 수 있어 방문자가 다운로드할 수 없다.
그래서 파일 배포용 저장소만 공개로 분리한다. 소스 코드는 계속 비공개로 유지된다.

---

## 1단계 — 공개 저장소 만들기

GitHub → **New repository**

- Repository name: `rcw-releases`
- **Public 선택** ← 이번에는 공개다
- **Add a README file 체크** (빈 저장소면 릴리스를 만들 수 없다)
- Create repository

---

## 2단계 — 릴리스 만들기

저장소 페이지 우측 **Releases** → **Create a new release**

| 항목 | 값 |
|---|---|
| Choose a tag | `v5.0.0-trial` 입력 후 **Create new tag** 클릭 |
| Release title | `RCW V5 Trial` |
| Description | 아래 예시 참조 |

```
RCW V5 90일 트라이얼 (Core 기능 범위)

- Windows 전용
- Rhino 7 / Rhino 8 별도 설치 파일
- 한국어 / 영어 별도 설치 파일
- 트라이얼은 인증 코드가 필요 없습니다

설치 안내: https://rcw-site.vercel.app/guide-ko.html
```

### 파일 업로드

**Attach binaries by dropping them here or selecting them**
영역에 아래 4개 파일을 끌어다 놓는다.

```
C:\std\C#_Utils\RCW_V4_13.3\artifacts\RCW_V5\Trial\
├── RCW_V5_Trial_Rhino7_ko-KR.exe
├── RCW_V5_Trial_Rhino7_en-US.exe
├── RCW_V5_Trial_Rhino8_ko-KR.exe
└── RCW_V5_Trial_Rhino8_en-US.exe
```

합계 약 366MB라 업로드에 몇 분 걸린다. 4개가 모두 100% 되기를 기다린 뒤
**Publish release** 를 누른다.

---

## 3단계 — 주소 확인

`trial.html` 의 다운로드 버튼은 **태그가 아니라 "최신 릴리스"** 를 가리킨다.

```
https://github.com/cosscad-prog/rcw-releases/releases/latest/download/RCW_V5_Trial_Rhino8_ko-KR.exe
                                             ^^^^^^
```

GitHub 가 이 주소를 최신 릴리스의 같은 이름 파일로 자동 연결한다.
따라서 **새 버전을 올려도 웹사이트는 고칠 필요가 없다.**

지켜야 할 조건은 두 가지뿐이다.

1. **파일 이름을 바꾸지 않는다** — 이름이 바뀌면 링크가 끊긴다
2. 새 릴리스를 **latest 로 표시한다** — Pre-release 로 올리면 latest 가 되지 않는다

### ⚠ 자주 겪는 문제 — 태그가 Pre-release 로 자동 분류됨

태그 이름에 `v5.0.0-trial` 처럼 **하이픈 뒤 문자열**이 붙으면
버전 표기 규칙(semver)상 "정식 이전 버전"으로 해석되어
GitHub 이 자동으로 **Pre-release** 배지를 붙인다.

이 경우 `/releases/latest/` 가 해당 릴리스를 가리키지 않아
**사이트의 다운로드 버튼이 404 가 된다.**

발행 후 제목 옆 배지를 반드시 확인할 것.

| 배지 | 상태 |
|---|---|
| `Latest` | 정상 |
| `Pre-release` | 수정 필요 |

고치는 법: 릴리스 페이지 우측 상단 **연필 아이콘** →
**Release label** 을 `None` 으로 변경 → **Update release**

`publish-trial.ps1` 은 `--latest` 를 명시하므로 이 문제가 발생하지 않는다.

---

## 다음 버전을 낼 때 — 스크립트 사용 (권장)

매번 브라우저로 366MB 를 올리는 대신 명령 한 줄로 처리한다.

### 최초 1회 준비

```powershell
winget install GitHub.cli
gh auth login          # 브라우저로 GitHub 인증
```

### 발행

```powershell
cd C:\std\Web\rcw-site
.\publish-trial.ps1 -Version 5.0.1
```

스크립트가 하는 일

- `artifacts\RCW_V5\Trial` 에서 exe 4개를 찾아 존재 여부를 확인
- 파일 크기와 빌드 시각을 출력 (빌드 시각이 24시간 이상 벌어지면 경고 —
  이전 버전 파일이 섞여 올라가는 사고를 막는다)
- 같은 태그의 릴리스가 이미 있으면 중단
- 릴리스를 만들고 4개를 업로드한 뒤 latest 로 표시

실제 발행 없이 점검만 하려면 `-WhatIf` 를 붙인다.

```powershell
.\publish-trial.ps1 -Version 5.0.1 -WhatIf
```

발행이 끝나면 웹사이트는 자동으로 새 파일을 가리킨다. `git push` 도 필요 없다.

### 수동으로 할 경우

브라우저에서 **Draft a new release** → 새 태그(`v5.0.1-trial`) →
파일 4개 업로드 → **Set as the latest release** 체크 → Publish.

---

이전 릴리스는 그대로 남는다. 새 버전에 문제가 생기면 GitHub 에서
이전 릴리스를 다시 latest 로 지정하면 사이트도 즉시 되돌아간다.

---

## 코드 서명에 대해

**현재 트라이얼 설치 파일에는 코드 서명이 적용되어 있지 않다.** (2026-07 확인)

그래서 실행 시 Windows SmartScreen 이 **"Windows의 PC 보호"** 경고를 띄우고,
사용자는 *추가 정보 → 실행* 을 눌러야 설치를 진행할 수 있다.
이 단계에서 이탈하는 비율이 상당하므로, `trial.html` 다운로드 화면에
다음 내용을 명시한 안내 상자를 두었다.

- 트라이얼 배포 단계라 인증서가 아직 적용되지 않았다는 사실
- 서명이 없으면 내용과 무관하게 경고가 뜬다는 설명
- 진행 방법 (추가 정보 → 실행)
- SHA-256 대조로 직접 검증하는 방법

### 정식 출시 시

코드 서명 인증서를 적용하면 경고가 사라진다.

- **OV 인증서** — 저렴하지만 평판이 쌓이기 전까지 SmartScreen 경고가 이어질 수 있다
- **EV 인증서** — 발급 즉시 SmartScreen 평판이 인정된다. 비용이 높고 하드웨어 토큰이 필요하다

서명을 적용한 뒤에는 `trial.html` 의 `.warn` 상자를 삭제한다.

### 검증용 해시 확인

GitHub 릴리스 페이지는 각 파일의 SHA-256 을 자동으로 표시한다.
로컬 파일과 대조하려면

```powershell
Get-FileHash "C:\std\C#_Utils\RCW_V4_13.3\artifacts\RCW_V5\Trial\RCW_V5_Trial_Rhino8_ko-KR.exe"
```

---

## 다운로드 수 확인

`rcw-releases` → **Releases** → 각 파일 옆에 다운로드 횟수가 표시된다.
누가 받았는지는 Supabase `trial_requests` 테이블에서 확인한다.

파일 주소 자체는 공개이므로 폼을 거치지 않고 받는 것도 가능하다.
완전히 막으려면 서버를 두어야 하는데, 명단 수집이 목적이라면
현재 방식(폼 제출 → 다운로드 표시)으로 충분하다.
