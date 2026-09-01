-- ============================================================
-- RCW V5 홈페이지 — 할 일(todo.html) 저장소
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 [Run] 실행.
-- 한 번만 하면 된다. 다시 실행해도 안전하게 썼다.
--
-- 화면 하나에 줄 하나. 로그인한 사람의 목록 전체를 jsonb 로 통째 저장한다.
-- (항목을 행으로 쪼개지 않는다 — 순서·접힘·분할비율까지 화면 상태가 통째로
--  한 덩어리라, 쪼개면 저장할 때마다 여러 행을 맞춰야 한다.)
-- ============================================================

create table if not exists public.todo_state (
  user_id    uuid        primary key references auth.users(id) on delete cascade,
  data       jsonb       not null,
  updated_at timestamptz not null default now()
);

comment on table public.todo_state is '할 일(todo.html) — 계정당 한 줄, 목록 전체를 jsonb 로';


-- ------------------------------------------------------------
-- 보안 — RLS
--
--   todo.html 에 박아 둔 키는 공개 키다(브라우저에 그대로 보인다).
--   남의 할 일을 못 읽는 것은 키가 비밀이라서가 아니라 아래 정책 때문이다:
--   로그인한 본인의 줄(auth.uid() = user_id)만 읽고 쓴다.
--   로그인하지 않은 anon 에게는 정책이 하나도 없으므로 전부 막힌다.
--
--   ★ using 과 with check 를 둘 다 써야 한다. with check 를 빠뜨리면
--     읽기는 되는데 저장이 조용히 막힌다(예전에 다운로드 기록에서 겪은 그것).
-- ------------------------------------------------------------
alter table public.todo_state enable row level security;

drop policy if exists "own todo row only" on public.todo_state;

create policy "own todo row only"
  on public.todo_state
  for all
  to authenticated
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ------------------------------------------------------------
-- 확인 — 로그인한 뒤 todo.html 을 한 번 쓰고 나서 실행하면 한 줄이 보인다.
--   select user_id, updated_at, jsonb_array_length(data->'items') as items
--   from public.todo_state;
-- ------------------------------------------------------------


-- ============================================================
-- 2026-09-01 추가 — 3단계 저장
--
--   1단계  todo_state    지금 목록. 고칠 때마다 덮어쓴다. (위)
--   2단계  todo_day      하루에 한 줄 = 그날의 마지막 상태. 30일치만 남긴다.
--   3단계  todo_archive  30일 지난 하루치를 한 줄에 몰아 둔다. 계정당 한 줄.
--
--   왜 나누나 — 동기화는 백업이 아니다. 잘못 지우면 1단계는 즉시 덮어써지고
--   모든 기기에서 같이 사라진다. 되돌릴 곳이 2·3단계다.
--
--   정리(30일 지난 것을 3단계로 옮기기)는 서버가 아니라 **페이지가** 한다 —
--   하루 한 번, 열 때. 크론도 함수도 안 쓴다(Vercel Hobby 함수 상한 때문).
-- ============================================================

-- ------------------------------------------------------------
-- 2단계 — 하루치
-- ------------------------------------------------------------
create table if not exists public.todo_day (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  day        date        not null,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

comment on table public.todo_day is '할 일 — 하루에 한 줄(그날의 마지막 상태). 30일 지나면 todo_archive 로 옮겨진다';

create index if not exists todo_day_user_day_idx on public.todo_day (user_id, day desc);

alter table public.todo_day enable row level security;
drop policy if exists "own day rows only" on public.todo_day;
create policy "own day rows only"
  on public.todo_day
  for all
  to authenticated
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ------------------------------------------------------------
-- 3단계 — 전체 보관 (계정당 한 줄)
--
--   data = { "days": [ { "day": "2026-07-03", "data": {...} }, ... ] }
--   날짜 오름차순. 같은 day 가 두 번 들어가지 않게 페이지가 걸러 넣는다
--   (정리 도중 끊겨도 다음 번에 다시 넣으면 되도록 — 지우기는 넣기 뒤에 한다).
-- ------------------------------------------------------------
create table if not exists public.todo_archive (
  user_id    uuid        primary key references auth.users(id) on delete cascade,
  data       jsonb       not null default '{"days":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.todo_archive is '할 일 — 30일 지난 하루치를 한 줄에 몰아 둔 것';

alter table public.todo_archive enable row level security;
drop policy if exists "own archive row only" on public.todo_archive;
create policy "own archive row only"
  on public.todo_archive
  for all
  to authenticated
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ------------------------------------------------------------
-- 확인 — 며칠치가 어디에 있나
--   select 'day' as 단계, count(*) from public.todo_day
--   union all
--   select 'archive', jsonb_array_length(data->'days') from public.todo_archive;
-- ------------------------------------------------------------
