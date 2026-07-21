# 배포 안내 — GitHub + Vercel

사이트를 인터넷에 올리는 절차. 처음 한 번만 하면 되고, 이후에는 `git push`만 하면 자동 반영된다.

로컬 준비는 끝나 있다. `rcw-site` 폴더는 이미 git 저장소이고 커밋 2개가 들어가 있다.

---

## 1단계 — GitHub 저장소 만들기

브라우저에서 진행한다.

1. https://github.com 로그인 (계정이 없으면 가입)
2. 우측 상단 **`+` → New repository**
3. 입력값
   - Repository name: `rcw-site`
   - **Private 선택** (공개할 이유가 없다. Vercel은 Private도 배포 가능)
   - **"Add a README file" 등 초기화 옵션은 모두 체크 해제** ← 중요
     체크하면 이미 있는 커밋과 충돌한다
4. **Create repository**

만들고 나면 나오는 주소를 복사해 둔다. 형태:

    https://github.com/<사용자명>/rcw-site.git

---

## 2단계 — 코드 올리기

`C:\std\Web\rcw-site` 에서 터미널을 연다.

```bash
git remote add origin https://github.com/<사용자명>/rcw-site.git
git push -u origin main
```

로그인을 물으면 GitHub 계정으로 인증한다.
비밀번호를 요구하는 경우, GitHub 계정 비밀번호가 아니라
**Personal Access Token**이 필요하다 (Settings → Developer settings →
Personal access tokens → Generate new token, `repo` 권한 체크).

업로드 용량은 약 19MB라 1~2분 걸릴 수 있다.

### 확인
GitHub 저장소 페이지를 새로고침해 `index.html`, `img/`, `docs/` 가 보이면 성공.

---

## 3단계 — Vercel 연결

1. https://vercel.com → **Continue with GitHub** 로 로그인
2. **Add New → Project**
3. 목록에서 `rcw-site` 옆 **Import**
   - 목록에 없으면 *Adjust GitHub App Permissions* 에서 저장소 접근을 허용
4. 설정 화면에서 확인할 것 — **아무것도 바꿀 필요 없다**

   | 항목 | 값 |
   |---|---|
   | Framework Preset | `Other` |
   | Root Directory | `./` |
   | Build Command | 비움 |
   | Output Directory | 비움 |

   빌드 도구를 쓰지 않는 정적 HTML이라 Vercel이 파일을 그대로 서빙한다.
5. **Deploy** 클릭 → 30초~1분

끝나면 `rcw-site-xxxx.vercel.app` 형태의 주소가 나온다.

---

## 4단계 — 확인

배포된 주소에서 아래를 점검한다. 휴대폰으로도 열어볼 것.

- [ ] 4개 페이지 이동 (전체 소개 / 모델링 / 산출물 / 문의)
- [ ] 이미지 20장 표시 — 특히 GIF 데모
- [ ] ENGLISH 버튼 → 영문 전환, 페이지를 옮겨도 유지되는지
- [ ] 휴대폰 폭에서 레이아웃 깨짐 없는지
- [ ] `vercel.json`의 cleanUrls 동작 — `/modeling` 로도 열리는지

**아직 안 되는 것 (정상)**
- 문의 폼 전송 → Supabase 연결 전이라 실패한다. 실패 시 메일 주소가 안내된다
- Trial 버튼 → 현재 메일 작성으로 임시 연결되어 있다

---

## 이후 사이트 수정하는 법

```bash
# 1. rcw-site 폴더에서 파일 수정

# 2. 로컬에서 확인
python -m http.server 8000
#    → 브라우저에서 http://localhost:8000

# 3. 반영
git add .
git commit -m "수정 내용 요약"
git push
```

push하면 Vercel이 자동으로 감지해 1분 내에 사이트에 반영된다.
Vercel 대시보드에서 배포 이력을 볼 수 있고, 문제가 생기면
이전 배포로 **Rollback** 할 수 있다.

---

## 도메인 연결 (나중에)

`rcw.co.kr` 같은 주소를 쓰려면 도메인을 구입한 뒤
Vercel 프로젝트 → **Settings → Domains** 에서 추가하고,
안내되는 DNS 레코드를 도메인 업체 관리 화면에 입력하면 된다.
HTTPS 인증서는 Vercel이 자동 발급한다.

---

## 참고

- `.gitignore` — `img/` 폴더에 236개 파일이 있으나 사이트가 쓰는 20개만 git에 올라간다
- `.vercelignore` — `docs/` 와 `README.md` 는 git에는 남기되 공개 사이트에는 배포하지 않는다
- 무료 플랜 조건은 서비스 정책에 따라 달라지므로 가입 시점에 직접 확인할 것
