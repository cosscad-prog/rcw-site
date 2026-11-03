-- Rhino 9 를 받는다 (2026-11-03, 5.4.9)
--
-- 왜 — 5.4.9 설치기가 Rhino 9 를 고를 수 있게 되었다(Rhino 9 는 Rhino 8 빌드를 그대로 깐다).
--   플러그인은 5.4.0 부터 체크인 · 받기 기록 · 설치 알림에 rh=9 를 이미 보낼 수 있었는데(RcwUpdateInstaller.RhinoMajorVersion 7 ~ 9),
--   사이트 함수(lib/checkin.js · api/_rcw.js · lib/edition-check.js)와 아래 세 제약이 7 · 8 만 받아
--   Rhino 9 에서 쓰는 사람은 사용 현황에 잡히지 않았다(체크인 400).
--
-- 순서 — 이 SQL 을 먼저 돌리고, 그 다음 사이트 함수를 배포한다(함수가 9 를 넘겨도 표가 받게).
--   넓히기만 하므로 지금 있는 줄과 옛 함수에는 영향이 없다.
--
-- downloads(평가판 페이지 단추 기록)는 옛 에디션별 파일 이름(Rhino7 · Rhino8)에서 rhino 를 읽으므로 그대로 둔다.

alter table public.plugin_checkins  drop constraint if exists plugin_checkins_rhino_check;
alter table public.plugin_checkins  add  constraint plugin_checkins_rhino_check  check (rhino in ('7', '8', '9'));

alter table public.plugin_downloads drop constraint if exists plugin_downloads_rhino_check;
alter table public.plugin_downloads add  constraint plugin_downloads_rhino_check check (rhino is null or rhino in ('7', '8', '9'));

alter table public.customer_access  drop constraint if exists customer_access_rhino_check;
alter table public.customer_access  add  constraint customer_access_rhino_check  check (rhino in ('7', '8', '9'));
