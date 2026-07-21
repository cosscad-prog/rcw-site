-- ============================================================
-- RCW V5 홈페이지 — Supabase 초기 설정
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 [Run] 실행
-- 한 번만 실행하면 된다. 다시 실행해도 안전하도록 작성했다.
-- ============================================================


-- ------------------------------------------------------------
-- 1. 제품 문의 (contact.html)
-- ------------------------------------------------------------
create table if not exists public.contacts (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text        not null check (char_length(name)     between 1 and 100),
  company     text                 check (char_length(company)  <= 200),
  phone       text                 check (char_length(phone)    <= 50),
  email       text        not null check (char_length(email)    between 3 and 200),
  message     text        not null check (char_length(message)  between 1 and 5000),
  -- 유입 경로 추적용. 나중에 "어느 페이지에서 문의했나" 확인할 때 쓴다
  source_page text                 check (char_length(source_page) <= 200)
);

comment on table public.contacts is 'RCW V5 홈페이지 제품 문의';


-- ------------------------------------------------------------
-- 2. Trial 신청 (trial.html)
-- ------------------------------------------------------------
create table if not exists public.trial_requests (
  id            uuid        primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  name          text        not null check (char_length(name)    between 1 and 100),
  company       text                 check (char_length(company) <= 200),
  email         text        not null check (char_length(email)   between 3 and 200),
  -- 선택 항목: 어떤 규모/목적의 사용자가 관심을 보이는지 파악용
  project_scale text                 check (char_length(project_scale) <= 100),
  purpose       text                 check (char_length(purpose) <= 2000),
  -- 후속 관리용 (직접 수정하며 쓰는 칸)
  contacted_at  timestamptz,
  note          text
);

comment on table public.trial_requests is 'RCW V5 Trial 다운로드 신청자';


-- ------------------------------------------------------------
-- 3. 조회 성능 (신청일 역순 정렬이 기본 조회 패턴)
-- ------------------------------------------------------------
create index if not exists contacts_created_at_idx
  on public.contacts (created_at desc);

create index if not exists trial_requests_created_at_idx
  on public.trial_requests (created_at desc);


-- ------------------------------------------------------------
-- 4. 보안 — RLS(Row Level Security)
--
--    핵심: 웹페이지에 넣는 anon 키는 누구나 볼 수 있다.
--    따라서 익명 사용자에게는 "쓰기"만 허용하고 "읽기"는 막는다.
--    정책을 만들지 않으면 그 동작은 차단된다 —
--    select 정책이 없으므로 남의 문의를 읽어갈 수 없다.
--
--    본인은 Supabase 대시보드(Table Editor)로 확인한다.
--    대시보드는 service_role 로 접근하므로 RLS 를 우회한다.
-- ------------------------------------------------------------
alter table public.contacts       enable row level security;
alter table public.trial_requests enable row level security;

-- 재실행해도 오류가 나지 않도록 기존 정책을 먼저 제거
drop policy if exists "anon can submit contact"     on public.contacts;
drop policy if exists "anon can submit trial"       on public.trial_requests;

create policy "anon can submit contact"
  on public.contacts
  for insert
  to anon
  with check (true);

create policy "anon can submit trial"
  on public.trial_requests
  for insert
  to anon
  with check (true);


-- ------------------------------------------------------------
-- 5. 확인
--    아래를 실행하면 두 테이블 모두
--    rls_enabled = true, insert 정책 1개씩 이어야 한다.
-- ------------------------------------------------------------
select
  c.relname                        as table_name,
  c.relrowsecurity                 as rls_enabled,
  count(p.polname)                 as policy_count,
  coalesce(string_agg(p.polname, ', '), '(없음)') as policies
from pg_class c
left join pg_policy p on p.polrelid = c.oid
where c.relname in ('contacts', 'trial_requests')
group by c.relname, c.relrowsecurity;
