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
