# 코드 서명 — OV 인증서 신청과 적용

설치 파일에 서명이 없어 고객이 설치할 때 경고를 만난다. 그 경고를 없애는 절차다.

## 왜 OV 인가 (EV 가 아니라)

EV 는 예전에 SmartScreen 평판이 즉시 붙었지만 **2024년에 그 동작이 없어졌다.**
Microsoft 문서에 명시되어 있다:

> EV 인증서는 더 이상 SmartScreen 을 우회하지 않는다. … SmartScreen 경고를 피하려는
> 목적만으로 EV 프리미엄을 지불하는 것은 더 이상 정당화되지 않는다.
> — [SmartScreen reputation for Windows app developers](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)

EV 가 필요한 경우는 **커널 드라이버 서명**뿐이다. RCW 는 Rhino 플러그인이라 해당 없다.
**OV 로 충분하고, 35만원쯤 아낀다.**

Azure Artifact Signing(구 Trusted Signing)은 월 $10 로 가장 싸지만 **한국 사업자는 신청할
수 없다.** Public Trust 인증서는 미국·캐나다·EU·영국 조직에만 제공된다.

## 서명이 실제로 해주는 일

첫 배포의 경고는 OV 든 EV 든 뜬다. 서명의 값어치는 다른 데 있다.

| | 서명 없음 | 서명 있음 |
|---|---|---|
| 평판 축적 | **릴리스마다 0 에서 다시 시작** | 인증서에 쌓여 다음 버전으로 이어짐 |
| 게시자 이름 | "알 수 없음" | 검증된 회사명 표시 |
| Smart App Control (Win11) | **실행 자체 차단** | 통과 |
| 백신 오진 | 잦음 | 크게 줄고, 오진 신고 처리도 빨라짐 |

서명하지 않으면 5.0.5 가 평판을 쌓아도 5.0.6 을 내는 순간 처음으로 돌아간다.
**영원히 경고가 뜬다는 뜻이다.**

## 신청 절차

### 1. 제품 선택

| 제품 | 대략 가격 |
|---|---|
| Sectigo OV Code Signing | 60만원대 |
| DigiCert OV Code Signing | 더 비쌈 |

부가세·USB 토큰·배송 포함가로 안내된다. 2023년 6월부터 **파일 형태 발급이 폐지**되어
모든 OV 인증서가 USB 토큰 또는 클라우드 HSM 으로만 나온다(CA/B Forum 규정 —
개인키를 FIPS 140-2 Level 2 이상 하드웨어에 보관해야 한다). 그래서 토큰 값이 15만원쯤
붙는다.

국내 리셀러: 코리아SSL, SecureSign 등. 실제 견적은 문의해야 한다.

### 2. 토큰이냐 클라우드 HSM 이냐 — 먼저 정한다

| | USB 토큰 | 클라우드 HSM |
|---|---|---|
| 서명 위치 | 토큰 꽂힌 PC 에서만 | 어디서든 |
| 배송 | 해외 1~2주 | 없음 |
| 자동화 | 사람이 꽂아야 함 | 스크립트에서 바로 |
| 비용 | 토큰 값 1회 | 매년 추가 |

`publish-customer.ps1` 로 8개를 한 번에 올리는 지금 방식에는 **클라우드 HSM 이 낫다.**
다만 발급기 서명키를 이 PC 인증서 저장소에 두는 것과 같은 방식이 익숙하다면 토큰도 무방하다.
`sign-installers.ps1` 은 토큰(인증서 저장소) 기준으로 되어 있으므로, 클라우드 HSM 을
선택하면 서명 명령 부분을 그 업체 방식으로 바꿔야 한다.

### 3. 준비할 서류

- 사업자등록증
- 법인등기부등본 (법인인 경우)
- 대표번호가 **공개 DB에 등재**되어 있을 것 ← **여기서 가장 많이 막힌다**

CA 가 공개된 번호로 전화를 걸어 실체를 확인한다. 회사 대표번호가 조회되지 않으면
등재부터 해야 하고, 그것만으로 며칠이 더 걸린다. **주문 전에 먼저 확인할 것.**

### 4. 발급까지

```
주문·결제 → 서류 제출 → 조직 실체 확인 → 전화 확인 → 토큰 배송 → 수령·드라이버 설치
```

전체 2~3주. 서류가 깔끔하면 더 빠르고, 전화 확인에서 막히면 더 걸린다.

### 5. 받은 뒤 할 일

토큰을 꽂고 지문을 확인한다.

```powershell
Get-ChildItem Cert:\CurrentUser\My |
  Where-Object { $_.EnhancedKeyUsageList.FriendlyName -contains '코드 서명' } |
  Select-Object Subject, Thumbprint, NotAfter
```

지문을 환경변수에 넣어 두면 매번 입력하지 않아도 된다.

```powershell
[Environment]::SetEnvironmentVariable('RCW_SIGN_THUMBPRINT', 'AABBCC…', 'User')
```

## 서명하고 발행하기

```powershell
cd C:\std\Web\rcw-site

# 1) 서명 (토큰을 꽂은 상태)
.\sign-installers.ps1 -Version 5.0.6

# 2) 발행
.\publish-customer.ps1 -Version 5.0.6
```

`publish-customer.ps1` 은 서명되지 않은 파일이 있으면 **업로드 전에 멈춘다.**
인증서를 아직 못 받았으면 `-AllowUnsigned` 를 준다(경고와 함께 진행된다).

평가판은 `publish-trial.ps1` 이 별도 저장소로 올린다. 평가판도 같은 이유로 서명해야
하며, 오히려 더 급하다 — 유료 고객은 막히면 전화하지만 평가판 사용자는 조용히 이탈한다.

## 지켜야 할 세 가지

1. **모든 릴리스를 같은 인증서로 서명한다.** 인증서를 바꾸면 게시자 신뢰 신호가 초기화되어
   평판이 처음부터 다시 쌓인다. 갱신할 때도 같은 조직 신원을 유지한다.
2. **타임스탬프를 반드시 붙인다.** `sign-installers.ps1` 이 자동으로 붙이지만, 다른 방법으로
   서명한다면 잊지 말 것. 없으면 인증서 만료일에 **과거 서명까지 전부 무효**가 된다.
3. **서명한 뒤 파일을 수정하지 않는다.** 한 바이트만 바뀌어도 서명이 깨진다.

## 서명을 붙인 뒤에 할 일

- 고객 안내 문구를 걷어낸다 — `trial.html`, `customer.html`, `guide-ko.html`,
  `guide-en.html`, `docs/기존 고객 등록 요청 이메일 알림장.md`
- 평판이 쌓이기 전 몇 주 동안은 경고가 남으므로, **바로 지우지 말고** 몇 번의 릴리스를
  지켜본 뒤 지운다

## 그때까지 — 백신 오진 신고

서명과 별개로, 백신이 잡는 건은 각 백신사에 따로 신고해야 한다. 릴리스마다, 백신사마다
반복해야 한다.

| 백신 | 제조사 |
|---|---|
| V3 / V3 Lite | 안랩 |
| 알약 | 이스트시큐리티 |
| Windows Defender | Microsoft ([파일 제출](https://www.microsoft.com/wdsi/filesubmission)) |

어느 백신이 잡는지 알려면 고객이 알려줘야 한다. 그래서 안내 문구 끝에
"막히면 사용 중인 백신 이름과 함께 연락 주십시오" 를 넣어 두었다.
