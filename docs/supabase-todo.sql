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


-- ============================================================
-- 2026-09-01 개정 — 2·3단계를 브라우저에서 DB 안으로 옮긴다
--
--   전에는 페이지가 23:50 에 타이머로 썼다. 그러면 그 시각에 브라우저가
--   꺼져 있으면 그날이 안 남고, 그것을 메우려고 코드가 늘었다.
--   이제 todo_state 가 바뀔 때마다 **DB 안에서** 그날 줄을 갱신한다.
--   브라우저는 아무것도 하지 않는다.
--
--   자정이 지나면 그 줄은 더 이상 안 바뀌므로 **그날의 마지막 상태로 굳는다.**
--   23:50 에 쓰는 것과 결과가 같고, 23:55 에 고친 것까지 담긴다.
--
--   ★ 하루가 바뀌어 줄이 **새로 생길 때만** 30일 지난 것을 보관으로 옮긴다.
--     그래서 정리는 자연히 하루에 한 번이다. 크론도 확장기능도 필요 없다.
--   ★ 트리거는 한 트랜잭션 안에서 돈다 — 보관에 넣기와 하루치 지우기가
--     같이 되거나 같이 안 된다. 브라우저에서 하던 "순서" 걱정이 사라진다.
-- ============================================================

-- 날짜는 한국 시간 기준. DB 는 UTC 로 도니 여기서 한 번만 바꾼다.
create or replace function public.todo_state_snapshot()
returns trigger
language plpgsql
security definer                       -- todo_day/todo_archive 에 대신 써 준다
set search_path = public, pg_temp
as $$
declare
  keep_days constant int := 30;        -- 2단계에 남기는 날수
  d          date;
  existed    boolean;
  moved      jsonb;
begin
  d := (now() at time zone 'Asia/Seoul')::date;

  select exists(select 1 from public.todo_day
                 where user_id = new.user_id and day = d)
    into existed;

  -- 2단계 — 오늘 줄을 지금 내용으로
  insert into public.todo_day (user_id, day, data, updated_at)
  values (new.user_id, d, new.data, now())
  on conflict (user_id, day) do update
    set data = excluded.data, updated_at = now();

  -- 3단계 — 날이 바뀌어 오늘 줄이 처음 생겼을 때만 (= 하루 한 번)
  if not existed then
    select coalesce(
             jsonb_agg(jsonb_build_object('day', to_char(t.day,'YYYY-MM-DD'),
                                          'data', t.data) order by t.day),
             '[]'::jsonb)
      into moved
      from public.todo_day t
     where t.user_id = new.user_id
       and t.day < d - keep_days;

    if jsonb_array_length(moved) > 0 then
      insert into public.todo_archive (user_id, data, updated_at)
      values (new.user_id, jsonb_build_object('days', moved), now())
      on conflict (user_id) do update
        set data = jsonb_build_object(
              'days',
              coalesce(todo_archive.data -> 'days', '[]'::jsonb) || (excluded.data -> 'days')
            ),
            updated_at = now();

      delete from public.todo_day
       where user_id = new.user_id and day < d - keep_days;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.todo_state_snapshot is
  '할 일 — todo_state 가 바뀌면 그날 줄(todo_day)을 갱신하고, 날이 바뀌면 30일 지난 것을 todo_archive 로 몰아 둔다';

drop trigger if exists todo_state_snapshot_trg on public.todo_state;
create trigger todo_state_snapshot_trg
  after insert or update on public.todo_state
  for each row execute function public.todo_state_snapshot();


-- ------------------------------------------------------------
-- 확인 — 할 일을 하나 고친 뒤 실행하면 오늘 줄이 보인다.
--   select day, jsonb_array_length(data->'items') as 항목수, updated_at
--     from public.todo_day order by day desc;
--
--   select jsonb_array_length(data->'days') as 보관된_날수 from public.todo_archive;
--
-- 트리거가 걸렸나:
--   select tgname, tgenabled from pg_trigger where tgrelid = 'public.todo_state'::regclass;
-- ------------------------------------------------------------


-- ============================================================
-- 자체시험 — 통째로 되돌려진다(rollback). 실제 데이터는 하나도 안 바뀐다.
-- 위 트리거를 만든 뒤 이 블록을 그대로 붙여넣고 Run 하면 표가 하나 나온다.
-- 세 줄 모두 결과 = 기대 여야 한다.
-- ============================================================
begin;

  -- 오늘 줄을 지우고 시작한다(트리거가 "날이 바뀌었다"고 보게)
  delete from public.todo_day
   where day = (now() at time zone 'Asia/Seoul')::date;

  -- 40일 전 하루치를 하나 심는다 — 이것이 보관으로 옮겨져야 한다
  insert into public.todo_day (user_id, day, data)
  select user_id, (now() at time zone 'Asia/Seoul')::date - 40, '{"items":[]}'::jsonb
    from public.todo_state
   limit 1
  on conflict (user_id, day) do nothing;

  -- 트리거를 때린다 (내용은 그대로 두고 건드리기만)
  update public.todo_state set data = data;

  select * from (values
    ('오늘 줄이 생겼나',
     (select count(*)::int from public.todo_day
       where day = (now() at time zone 'Asia/Seoul')::date), 1),
    ('40일 전 줄이 치워졌나',
     (select count(*)::int from public.todo_day
       where day = (now() at time zone 'Asia/Seoul')::date - 40), 0),
    ('보관으로 옮겨졌나',
     (select coalesce(jsonb_array_length(data -> 'days'), 0)
        from public.todo_archive limit 1), 1)
  ) t(검사, 결과, 기대);

rollback;
