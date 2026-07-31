-- ============================================================
-- RCW V5 — 구독 갱신 관리
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 [Run] 실행
-- 여러 번 실행해도 안전하다(전부 if not exists / or replace).
--
-- 이 스크립트가 하는 일
--   1. customers 에 갱신 관리 컬럼 6개 추가
--   2. renewal_watch 뷰 — 우선순위 계산을 한 곳에 둔다 ★
--   3. 관리자가 "연락함" 기록만 남길 수 있도록 컬럼 단위 update 권한
--
-- ★ 왜 뷰를 만드나
--   같은 우선순위 계산을 admin.html(자바스크립트)과 renewal_alert.py(파이썬)가
--   각자 구현하면 반드시 어긋난다. 화면에서는 급한데 메일에는 안 나오는 식이다.
--   계산은 여기 한 곳에만 두고 둘 다 이 뷰를 읽는다.
-- ============================================================


-- ------------------------------------------------------------
-- 1. 갱신 관리 컬럼
--
--    ★ paid_through 가 이 파이프라인의 유일한 기준이다.
--      null = 영구 고객 → 갱신 안내에서 완전히 빠진다.
--      영구 고객에게 갱신 독촉이 가는 것이 이 기능 최악의 사고라,
--      뷰의 where 절에서 null 을 먼저 걸러낸다.
--
--    ★ expires_on 과 헷갈리지 말 것 — 둘은 30일 차이나는 다른 날짜다.
--        paid_through : 청구 만료일 (돈을 내야 하는 날). 사람과 서버가 쓴다.
--        expires_on   : .lic 파일의 만료일 = paid_through + 30일(유예).
--                       플러그인이 아는 유일한 날짜이고 고객 화면에 뜨는 값이다.
-- ------------------------------------------------------------
alter table public.customers
  add column if not exists paid_through date;

comment on column public.customers.paid_through is
  '구독 청구 만료일. null 이면 영구 고객이라 갱신 파이프라인에서 제외된다. .lic 의 expires_on 은 이 날짜 + 유예 30일이다';

-- 해지 통보를 받은 고객. 남은 기간은 그대로 쓰게 두되 갱신 독촉은 멈춘다.
alter table public.customers
  add column if not exists cancelled_at timestamptz;

comment on column public.customers.cancelled_at is
  '고객이 갱신하지 않겠다고 통보한 시각. 남은 기간은 유지하고 안내만 중단한다';

-- 어느 단계까지 안내를 보냈는지. 이게 없으면 cron 이 매일 돌면서
-- 같은 고객에게 같은 메일을 매일 보낸다(가장 흔한 사고).
alter table public.customers
  add column if not exists renewal_stage text
  check (renewal_stage in ('d30', 'd7', 'due', 'grace', 'locked'));

alter table public.customers
  add column if not exists renewal_stage_at timestamptz;

comment on column public.customers.renewal_stage is
  '마지막으로 발송한 안내 단계. 같은 단계는 다시 보내지 않는다';

-- 전화·문자로 직접 연락한 기록. 사람이 admin 화면에서 남긴다.
alter table public.customers
  add column if not exists last_contact_at timestamptz;

alter table public.customers
  add column if not exists contact_note text
  check (char_length(contact_note) <= 2000);

comment on column public.customers.last_contact_at is
  '전화·문자 등으로 마지막에 연락한 시각. 최근 연락한 고객은 알림에서 뒤로 밀린다';

-- 갱신 대상 조회가 매일 돈다. 건수가 적어도 인덱스가 있으면 계획이 안정적이다.
create index if not exists customers_paid_through_idx
  on public.customers (paid_through) where paid_through is not null;


-- ------------------------------------------------------------
-- 2. 갱신 감시 뷰
--
--    security_invoker = true ★
--      뷰는 기본적으로 소유자 권한으로 돌아 RLS 를 통과해 버린다.
--      그러면 공개키로도 명부가 열릴 수 있다. invoker 로 두면 밑에 깔린
--      customers 의 정책("admin can read customers", authenticated 전용)이
--      그대로 적용된다. service key 는 어차피 RLS 를 우회하므로
--      서버 스크립트는 영향받지 않는다.
--
--    stage_now  지금 있어야 할 단계 (renewal_stage 는 "이미 보낸" 단계)
--    priority   숫자가 클수록 급하다. 화면·메일 정렬 기준
-- ------------------------------------------------------------
create or replace view public.renewal_watch
with (security_invoker = true) as
select
  c.id,
  c.license_id,
  c.company,
  c.name,
  c.phone,
  c.email,
  c.edition,
  c.status,
  c.paid_through,
  c.expires_on,
  c.cancelled_at,
  c.renewal_stage,
  c.renewal_stage_at,
  c.last_contact_at,
  c.contact_note,

  (c.paid_through - current_date) as days_left,

  case
    when c.paid_through - current_date >  30 then 'ok'
    when c.paid_through - current_date >=  8 then 'd30'
    when c.paid_through - current_date >=  0 then 'd7'
    when c.paid_through - current_date >= -15 then 'due'
    when c.paid_through - current_date >= -30 then 'grace'
    else 'locked'
  end as stage_now,

  -- 잠긴 고객이 가장 급하다. 이미 작업이 멈춰 있기 때문이다.
  case
    when c.paid_through - current_date >  30 then 0
    when c.paid_through - current_date >=  8 then 1
    when c.paid_through - current_date >=  0 then 2
    when c.paid_through - current_date >= -15 then 3
    when c.paid_through - current_date >= -30 then 4
    else 5
  end as priority,

  -- 최근 7일 안에 통화했으면 다시 전화할 필요가 적다.
  (c.last_contact_at is not null
     and c.last_contact_at > now() - interval '7 days') as contacted_recently

from public.customers c
where c.paid_through is not null;      -- ★ 영구 고객은 여기서 완전히 빠진다

comment on view public.renewal_watch is
  '구독 고객의 갱신 상태. 우선순위 계산은 여기 한 곳에만 두고 admin 화면과 일일 알림이 함께 읽는다';


-- ------------------------------------------------------------
-- 3. 권한
--
--    관리자는 원래 조회만 했다(customers 정책이 select 뿐).
--    갱신 관리에는 "연락함" 기록이 필요하므로 update 를 열되,
--    ★ 컬럼 단위로 좁게 연다. 정책만 열면 authenticated 세션이
--      license_id·status·edition 같은 장부까지 고칠 수 있다.
--      Postgres 는 정책과 컬럼 권한을 모두 확인하므로 둘 다 걸어야 한다.
-- ------------------------------------------------------------
drop policy if exists "admin can update contact fields" on public.customers;
create policy "admin can update contact fields"
  on public.customers
  for update
  to authenticated
  using (true)
  with check (true);

-- 정책은 행을 고르고, 아래 grant 가 고칠 수 있는 칸을 정한다.
revoke update on public.customers from authenticated;
grant  update (last_contact_at, contact_note, cancelled_at)
  on public.customers to authenticated;

grant select on public.renewal_watch to authenticated;


-- ------------------------------------------------------------
-- 4. 확인
--
--    ⓐ 컬럼 6개가 생겼는지
--    ⓑ authenticated 가 고칠 수 있는 칸이 딱 3개인지
--       (여기에 license_id·status 가 보이면 잘못된 것이다)
-- ------------------------------------------------------------
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'customers'
   and column_name in ('paid_through', 'cancelled_at', 'renewal_stage',
                       'renewal_stage_at', 'last_contact_at', 'contact_note')
 order by column_name;

select grantee, column_name, privilege_type
  from information_schema.column_privileges
 where table_schema = 'public' and table_name = 'customers'
   and grantee = 'authenticated' and privilege_type = 'UPDATE'
 order by column_name;


-- ============================================================
-- 쓰는 법
--
-- 구독 고객으로 전환 (청구 만료일을 넣는 순간 파이프라인에 들어온다)
--   update public.customers
--      set paid_through = '2027-07-31',
--          expires_on   = '2027-08-30'      -- paid_through + 유예 30일
--    where license_id = 'V5KO-497E84809694';
--
-- 갱신 완료 (1년 연장 + 안내 단계 초기화)
--   update public.customers
--      set paid_through     = paid_through + interval '1 year',
--          expires_on       = paid_through + interval '1 year' + 30,
--          renewal_stage    = null,
--          renewal_stage_at = null
--    where license_id = 'V5KO-497E84809694';
--
-- 해지 통보 (남은 기간은 그대로, 독촉만 멈춤)
--   update public.customers set cancelled_at = now() where license_id = '...';
--
-- 지금 챙길 고객
--   select company, name, phone, days_left, stage_now, last_contact_at
--     from public.renewal_watch
--    where priority >= 1 and cancelled_at is null
--    order by priority desc, paid_through;
-- ============================================================
