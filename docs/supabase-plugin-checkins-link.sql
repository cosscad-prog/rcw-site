-- 체크인을 사람에게 잇는다 (2026-10-19, 5.4.7)
--
-- 왜 — 관리 화면의 평가판 사람 줄에는 페이지에서 누른 다운로드만 보였다. 새 버전 알림으로
--   플러그인이 스스로 받아 간 것(plugin_downloads)과 지금 쓰는 판(plugin_checkins)은 설치 번호만
--   있고 이름이 없어서, 그 사람이 어느 판을 쓰는지 알 수 없었다(사용자 지적 2026-10-19).
--
-- 무엇으로 잇나 — 체크인(lib/checkin.js)이 함께 보내는 값 하나로.
--   · 유료판  : 설치기가 저장한 고객 코드(Licensing\customer-code.txt). 없으면 머신코드.
--               둘 다 customers 명부에 있다. 사용자가 넣을 것은 없다.
--   · 평가판  : 사용자가 넣은 신청 메일. trial_requests 에서 찾는다(가장 처음 신청).
--               못 찾아도 넣은 메일은 남긴다 — 신청 없이 파일만 받아 쓰는 사람을 알 수 있다.
--   코드 원문 · 머신코드는 저장하지 않는다. 찾은 고객의 id 와 그때의 회사 · 이름만 남긴다.
--
-- 같은 설치 번호의 plugin_downloads 줄은 이 표를 거쳐 사람에게 이어진다(관리 화면에서).
-- 모두 비워 둘 수 있는 칸이다 — 5.4.6 이하 플러그인은 아무것도 보내지 않고 지금처럼 남는다.

alter table public.plugin_checkins
  add column if not exists customer_id uuid references public.customers(id) on delete set null,
  add column if not exists request_id  uuid references public.trial_requests(id) on delete set null,
  add column if not exists link_email  text check (link_email is null or char_length(link_email) <= 200),
  add column if not exists who_company text check (who_company is null or char_length(who_company) <= 200),
  add column if not exists who_name    text check (who_name is null or char_length(who_name) <= 100),
  add column if not exists linked_at   timestamptz;

comment on column public.plugin_checkins.customer_id is '유료판: 체크인이 보낸 고객 코드(없으면 머신코드)로 찾은 고객';
comment on column public.plugin_checkins.request_id  is '평가판: 사용자가 넣은 메일로 찾은 신청(가장 처음 것). 못 찾으면 비어 있다';
comment on column public.plugin_checkins.link_email  is '평가판: 사용자가 플러그인에 넣은 메일(소문자). 신청에 없어도 남긴다';
comment on column public.plugin_checkins.who_company is '이은 때의 회사(고객 명부 또는 신청서에서 베낌)';
comment on column public.plugin_checkins.who_name    is '이은 때의 이름(고객 명부 또는 신청서에서 베낌)';
comment on column public.plugin_checkins.linked_at   is '마지막으로 사람과 이은 때';
