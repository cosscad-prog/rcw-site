-- 플러그인이 스스로 받아 간 기록 (2026-09-22)
--
-- 왜 새 표인가 — 기존 두 표에 넣을 수 없다.
--   · downloads       : name·email·edition·rhino 가 NOT NULL 이다. 플러그인은 이름과
--                       이메일을 모른다. 지어 넣으면 트라이얼 집계가 오염되고, 나중에
--                       진짜 신청과 구분할 수 없게 된다.
--   · customer_access : customer_id 로 사람을 가리키는 표다. 플러그인은 누구인지 모른다.
--                       (배포판에는 고객 코드가 없다 — 2026-09-22 rhp 실측)
-- 그래서 "누가" 가 아니라 "몇 대가 무엇을 받아 갔나" 만 담는 표를 따로 둔다.
-- 기존 두 표의 숫자는 여전히 '사람이 페이지에서 받아 간 것' 을 뜻한다.
--
-- install_id 는 사람이 아니라 <설치>를 가리킨다. 플러그인이 처음 확인할 때 만들어
-- 그 PC 에 적어 두는 무작위 값이고, 이름·회사·머신코드·라이선스와 아무 관계가 없다.
-- 지워도 다음에 새로 생길 뿐이라 같은 PC 가 두 대로 보일 수 있다 — 정밀한 대수가
-- 아니라 흐름을 보는 값이다.

create table if not exists public.plugin_downloads (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),

  -- 어느 저장소에서 받아 갔나. 유료판과 평가판은 파일도 저장소도 다르다.
  kind        text not null check (kind in ('customer', 'trial')),

  -- 그 PC 의 설치 번호. 못 적은 PC 도 있을 수 있어 비워 둘 수 있다.
  install_id  text check (install_id is null or char_length(install_id) between 8 and 64),

  -- 파일 이름에서 갈라 둔다. 나중에 이름 규칙이 바뀌어도 집계가 살아 있게 하려는 것.
  edition     text check (edition is null or edition in ('Core', 'Standard')),
  rhino       text check (rhino   is null or rhino   in ('7', '8')),
  version     text,

  file_name   text not null,
  ip          text,
  user_agent  text
);

create index if not exists plugin_downloads_created_at_idx
  on public.plugin_downloads (created_at desc);

create index if not exists plugin_downloads_install_idx
  on public.plugin_downloads (install_id);

comment on table public.plugin_downloads is
  'RCW V5 플러그인이 알림창에서 직접 받아 간 기록. 사람이 아니라 설치를 센다.';

-- 브라우저에서 직접 읽거나 쓰지 못하게 한다. 서버 함수(service key)만 다룬다.
alter table public.plugin_downloads enable row level security;

-- 관리자 화면이 읽을 수 있게 한다. 다른 표(downloads · contacts · customer_access)와
-- 같은 모양이다: 로그인한 관리자만 SELECT, 쓰기는 서버 함수(service key)만.
-- anon 에게는 아무것도 열지 않는다 — 이 표는 브라우저가 직접 쓸 일이 없다.
create policy "admin can read plugin downloads"
  on public.plugin_downloads
  for select
  to authenticated
  using (true);
