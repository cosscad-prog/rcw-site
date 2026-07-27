-- ============================================================
-- RCW V5 홈페이지 — 기존 고객 다운로드 페이지(customer.html) 설정
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 [Run] 실행
-- 한 번만 실행하면 되고, 다시 실행해도 안전하다.
--
-- 이 스크립트가 하는 일
--   1. customers        고객 명부 (라이선스 코드 = 로그인 자격증명)
--   2. customer_access  로그인 시도와 다운로드 클릭 기록
--   3. 익명(anon)에게는 아무 권한도 주지 않는다 ★
--
-- ★ 다른 테이블과 다른 점
--   contacts / trial_requests / downloads 는 브라우저가 공개키로 직접 INSERT 한다.
--   고객 명부는 그러면 안 된다. 브라우저에 들어가는 공개키로 조회가 열리면
--   고객 전체 명단이 유출된다. 그래서 이 두 테이블에는 anon 정책을 하나도 만들지
--   않고, 서버리스 함수(api/customer-login.js)가 service key 로만 접근한다.
--   service key 는 RLS 를 우회하므로 정책 없이도 서버에서는 동작한다.
-- ============================================================


-- ------------------------------------------------------------
-- 1. 고객 명부
--
--    code_key = 로그인 조회용 정규화 키.
--    고객이 'v5ko-497e 8480 9694' 처럼 입력해도 찾히도록,
--    영숫자만 남기고 대문자로 바꾼 값을 넣는다. (V5KO497E84809694)
--    화면에 보여주거나 안내할 때는 license_id(V5KO-497E84809694)를 쓴다.
-- ------------------------------------------------------------
create table if not exists public.customers (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),

  code_key    text        not null unique
              check (code_key ~ '^[A-Z0-9]{8,40}$'),
  license_id  text        not null check (char_length(license_id) between 4 and 60),

  -- 로그인 조건이 아니라, 로그인한 고객에게 "본인 정보가 맞는지" 보여주는 값이다.
  name        text                 check (char_length(name)    <= 100),
  company     text                 check (char_length(company) <= 200),
  phone       text                 check (char_length(phone)   <= 50),
  email       text                 check (char_length(email)   <= 200),

  edition     text        not null check (edition in ('Core', 'Standard')),

  issued_on   date,
  expires_on  date,                          -- null = 기간 제한 없음
  status      text        not null default 'active'
              check (status in ('active', 'suspended')),

  note        text
);

comment on table  public.customers            is 'RCW V5 유료 고객 명부. 라이선스 코드로 다운로드 페이지에 로그인한다';
comment on column public.customers.code_key   is '조회용 정규화 코드(영숫자 대문자). 입력값도 같은 방식으로 정규화해 비교한다';
comment on column public.customers.license_id is '표시용 원본 코드 V5KO-XXXXXXXXXXXX';
comment on column public.customers.status     is 'suspended 면 로그인은 되지만 다운로드를 막고 안내 문구를 띄운다';


-- ------------------------------------------------------------
-- 2. 접근 기록
--    로그인 성공/실패와 다운로드 클릭을 한 테이블에 남긴다.
--    실패 기록은 무차별 대입을 막는 근거로도 쓰인다(같은 IP 의 최근 실패 횟수).
-- ------------------------------------------------------------
create table if not exists public.customer_access (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),

  customer_id uuid        references public.customers(id) on delete set null,
  action      text        not null check (action in ('login', 'login_failed', 'download')),

  -- 실패한 시도는 어떤 코드가 들어왔는지 남긴다(오타인지 공격인지 구분).
  -- 성공한 시도는 customer_id 로 알 수 있으므로 비워 둔다.
  code_tried  text                 check (char_length(code_tried) <= 60),
  ip          text                 check (char_length(ip)         <= 60),
  user_agent  text                 check (char_length(user_agent) <= 300),
  file_name   text                 check (char_length(file_name)  <= 200)
);

comment on table public.customer_access is '고객 페이지 로그인·다운로드 기록';

create index if not exists customer_access_created_at_idx on public.customer_access (created_at desc);
create index if not exists customer_access_customer_idx   on public.customer_access (customer_id, created_at desc);
-- 무차별 대입 판정: 같은 IP 의 최근 실패만 빠르게 센다
create index if not exists customer_access_fail_idx
  on public.customer_access (ip, created_at desc) where action = 'login_failed';


-- ------------------------------------------------------------
-- 3. 접근 권한
--
--    anon 정책 없음 = 브라우저의 공개키로는 아무것도 못 한다(조회도 등록도).
--    서버리스 함수만 service key 로 접근한다.
--    관리자(authenticated)는 admin 화면에서 조회만 한다.
-- ------------------------------------------------------------
alter table public.customers      enable row level security;
alter table public.customer_access enable row level security;

drop policy if exists "admin can read customers" on public.customers;
create policy "admin can read customers"
  on public.customers
  for select
  to authenticated
  using (true);

drop policy if exists "admin can read customer access" on public.customer_access;
create policy "admin can read customer access"
  on public.customer_access
  for select
  to authenticated
  using (true);


-- ------------------------------------------------------------
-- 4. 확인
--    customers 와 customer_access 는 rls_enabled = true 이고
--    정책이 "admin can read ..." 하나씩만 있어야 한다.
--    anon 정책이 보이면 잘못된 것이니 지울 것.
-- ------------------------------------------------------------
select
  c.relname                        as table_name,
  c.relrowsecurity                 as rls_enabled,
  coalesce(string_agg(p.polname, ', ' order by p.polname), '(없음)') as policies
from pg_class c
left join pg_policy p on p.polrelid = c.oid
where c.relname in ('customers', 'customer_access')
group by c.relname, c.relrowsecurity;


-- ============================================================
-- 고객 등록하는 법
--
-- 라이선스를 발급할 때마다 아래를 실행한다.
-- code_key 는 license_id 에서 영숫자만 남기고 대문자로 바꾼 값이다.
-- (아래 예시처럼 식으로 넣으면 손으로 만들 필요가 없다)
--
--   insert into public.customers
--     (code_key, license_id, name, company, phone, email, edition, issued_on, expires_on)
--   values
--     (upper(regexp_replace('V5KO-497E84809694', '[^A-Za-z0-9]', '', 'g')),
--      'V5KO-497E84809694',
--      '홍길동', '(주)베임텍', '010-1234-5678', 'name@company.com',
--      'Standard', '2026-07-17', null);
--
-- 코드를 잘못 넣었을 때는 code_key 로 찾아 고친다.
--   update public.customers set company = '...' where license_id = 'V5KO-497E84809694';
--
-- 해지·중지
--   update public.customers set status = 'suspended' where license_id = '...';
-- ============================================================
