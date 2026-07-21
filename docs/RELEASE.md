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

발행하면 각 파일의 다운로드 주소는 다음 형태가 된다.

```
https://github.com/cosscad-prog/rcw-releases/releases/download/v5.0.0-trial/RCW_V5_Trial_Rhino8_ko-KR.exe
```

`trial.html` 에 이미 이 주소로 버튼 4개가 들어가 있다.
**태그 이름을 `v5.0.0-trial` 이외의 값으로 만들면 링크가 깨진다.**
다른 태그를 쓰려면 `trial.html` 의 주소도 함께 고쳐야 한다.

---

## 다음 버전을 낼 때

1. 새 설치 파일 빌드
2. `rcw-releases` 에서 **Draft a new release**
3. 새 태그 (예: `v5.0.1-trial`)
4. 파일 업로드 → Publish
5. `trial.html` 의 다운로드 주소 4곳에서 태그 부분을 새 값으로 변경
6. `git commit` → `git push`

이전 릴리스는 그대로 남으므로, 문제가 생기면 이전 버전 주소로 되돌릴 수 있다.

---

## 코드 서명에 대해

설치 파일에 코드 서명이 없으면 실행 시 Windows SmartScreen 이
**"Windows의 PC 보호"** 경고를 띄운다. 사용자는 *추가 정보 → 실행* 을
눌러야 진행할 수 있는데, 여기서 이탈하는 비율이 상당하다.

`trial.html` 성공 화면에 이 경고에 대한 안내 문구를 넣어두었다.
코드 서명(EV 인증서 등)을 적용했다면 그 문구는 지워도 된다.

---

## 다운로드 수 확인

`rcw-releases` → **Releases** → 각 파일 옆에 다운로드 횟수가 표시된다.
누가 받았는지는 Supabase `trial_requests` 테이블에서 확인한다.

파일 주소 자체는 공개이므로 폼을 거치지 않고 받는 것도 가능하다.
완전히 막으려면 서버를 두어야 하는데, 명단 수집이 목적이라면
현재 방식(폼 제출 → 다운로드 표시)으로 충분하다.
