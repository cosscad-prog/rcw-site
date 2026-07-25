-- ============================================================
-- RCW V5 홈페이지 — 다운로드 기록 + 관리자 조회 설정
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 [Run] 실행
-- 한 번만 실행하면 되고, 다시 실행해도 안전하다.
--
-- 이 스크립트가 하는 일
--   1. trial_requests 에 전화번호 열 추가
--   2. downloads 테이블 생성 (다운로드 버튼 클릭 1건 = 1행)
--   3. 익명은 "기록만", 로그인한 관리자만 "조회" 하도록 RLS 정책 정리
-- ============================================================


-- ------------------------------------------------------------
-- 1. 전화번호 (2026-07-26 추가)
--    폼에서 필수로 받지만 DB 는 nullable 로 둔다.
--    이 열이 생기기 전에 들어온 신청 기록이 이미 있어서,
--    NOT NULL 을 걸면 없는 값을 지어내야 하기 때문이다.
-- ------------------------------------------------------------
alter table public.trial_requests
  add column if not exists phone text check (char_length(phone) <= 50);


-- ------------------------------------------------------------
-- 2. 다운로드 기록
--    이름·회사·전화·이메일을 여기에도 복사해 둔다(스냅샷).
--    관리자 화면이 조인 없이 한 번에 읽히고, 신청 정보가 나중에
--    수정되어도 "그때 그 사람이 받았다"는 기록이 그대로 남는다.
-- ------------------------------------------------------------
create table if not exists public.downloads (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),

  -- 어느 신청에서 눌렀는지. 신청이 지워져도 다운로드 이력은 남긴다.
  request_id  uuid        references public.trial_requests(id) on delete set null,

  name        text        not null check (char_length(name)    between 1 and 100),
  company     text                 check (char_length(company) <= 200),
  phone       text                 check (char_length(phone)   <= 50),
  email       text        not null check (char_length(email)   between 3 and 200),

  edition     text        not null check (edition in ('Core', 'Standard')),
  rhino       text        not null check (rhino   in ('7', '8')),
  lang        text        not null check (lang    in ('ko-KR', 'en-US')),
  file_name   text        not null check (char_length(file_name) <= 200)
);

comment on table  public.downloads is 'RCW V5 트라이얼 다운로드 버튼 클릭 기록';
comment on column public.downloads.request_id is '같은 방문에서 제출한 trial_requests 행';

-- 관리자 화면은 항상 최신순으로 읽고, 재다운로드 판정은 이메일로 한다
create index if not exists downloads_created_at_idx on public.downloads (created_at desc);
create index if not exists downloads_email_idx      on public.downloads (lower(email));


-- ------------------------------------------------------------
-- 3. 접근 권한
--    브라우저에 들어 있는 공개 키(anon)로는 "쓰기"만 된다.
--    조회는 로그인한 관리자(authenticated)만 가능하다.
--    ★ service key 는 절대 웹페이지에 넣지 말 것 — 전체 삭제까지 가능하다.
-- ------------------------------------------------------------
alter table public.downloads enable row level security;

drop policy if exists "anon can record download" on public.downloads;
create policy "anon can record download"
  on public.downloads
  for insert
  to anon
  with check (true);

drop policy if exists "admin can read downloads" on public.downloads;
create policy "admin can read downloads"
  on public.downloads
  for select
  to authenticated
  using (true);

-- 신청 명단도 관리자 화면에서 봐야 하므로 조회 정책을 추가한다
-- (기존 "anon can submit trial" 삽입 정책은 그대로 둔다)
drop policy if exists "admin can read trial requests" on public.trial_requests;
create policy "admin can read trial requests"
  on public.trial_requests
  for select
  to authenticated
  using (true);

drop policy if exists "admin can read contacts" on public.contacts;
create policy "admin can read contacts"
  on public.contacts
  for select
  to authenticated
  using (true);


-- ------------------------------------------------------------
-- 4. 확인
-- ------------------------------------------------------------
select
  c.relname                        as table_name,
  c.relrowsecurity                 as rls_enabled,
  coalesce(string_agg(p.polname, ', ' order by p.polname), '(없음)') as policies
from pg_class c
left join pg_policy p on p.polrelid = c.oid
where c.relname in ('contacts', 'trial_requests', 'downloads')
group by c.relname, c.relrowsecurity;

-- ============================================================
-- 관리자 계정 만들기 (대시보드에서 한 번만)
--   Authentication → Users → Add user
--     Email        : 관리자 이메일
--     Password     : 충분히 긴 비밀번호
--     Auto Confirm : 켬  (확인 메일 없이 바로 로그인 가능)
--
--   이 계정으로 https://rcw-site.vercel.app/admin 에 로그인한다.
--   가입 페이지는 만들지 않으므로 이 계정 외에는 조회할 수 없다.
--   Authentication → Providers → Email 에서 "Enable sign ups" 를 꺼 두면
--   외부에서 계정을 새로 만드는 경로까지 막힌다.
-- ============================================================
