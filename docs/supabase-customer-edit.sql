-- ============================================================
-- RCW V5 관리자 화면 — 고객 정보 직접 수정 권한
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 [Run] 실행
-- 한 번만 실행하면 되고, 다시 실행해도 안전하다.
--
-- 왜 필요한가
--   발급기는 코드를 만들 때만 회사·전화를 함께 보낸다(api/customer-upsert.js).
--   그래서 코드만 먼저 뿌리고 나중에 사람이 배정되는 경우, 명부에 코드만 있고
--   연락처가 빈 줄이 남는다. 지금까지는 Supabase Table Editor 를 열어야만
--   채울 수 있었는데, 그 화면에서는 장부 칸(license_id·edition·status)도 함께
--   열려 있어 실수로 고칠 여지가 있다. admin 화면에서 안전한 칸만 고치게 한다.
--
-- ★ 여전히 못 고치는 칸 (그대로 두는 것이 안전장치다)
--   license_id · code_key · edition · status · machine_code · issued_on · expires_on
--   → 라이선스 장부에서 나오는 값이다. 화면에서 고치면 실제 .lic 파일과 어긋난다.
--     바꿔야 한다면 발급기나 SQL Editor 에서 근거를 남기고 할 일이다.
-- ============================================================


-- ------------------------------------------------------------
-- 1. 정책 — 어느 "행" 을 고칠 수 있는가
--    supabase-renewals.sql 이 이미 만들어 둔 것과 같은 정책이다.
--    (이름을 그대로 쓰므로 어느 파일을 나중에 실행해도 정책은 하나만 남는다)
-- ------------------------------------------------------------
drop policy if exists "admin can update contact fields" on public.customers;
create policy "admin can update contact fields"
  on public.customers
  for update
  to authenticated
  using (true)
  with check (true);


-- ------------------------------------------------------------
-- 2. 권한 — 그 행의 어느 "칸" 을 고칠 수 있는가
--
--    ★ 정책은 행을 고르고, 이 grant 가 칸을 정한다. Postgres 는 둘 다 확인하므로
--      정책만 열면 authenticated 세션이 장부 칸까지 고칠 수 있다.
--
--    ★★ 이 목록은 supabase-renewals.sql 에도 똑같이 적혀 있다.
--        revoke 가 먼저 나오기 때문에, 한쪽만 고쳐 두면 다른 쪽을 다시 실행하는
--        순간 권한이 조용히 사라진다. 칸을 늘리거나 줄일 때는 두 파일을 함께 고칠 것.
-- ------------------------------------------------------------
revoke update on public.customers from authenticated;
grant  update (
         -- 갱신 관리("연락함" 버튼)
         last_contact_at, contact_note, cancelled_at,
         -- 고객 정보 수정(고객 탭 [고치기] 버튼)
         company, name, phone, email, note
       )
  on public.customers to authenticated;


-- ------------------------------------------------------------
-- 3. 확인 — 아래 8개가 나와야 한다
--    cancelled_at, company, contact_note, email, last_contact_at, name, note, phone
-- ------------------------------------------------------------
select column_name
  from information_schema.column_privileges
 where table_schema = 'public' and table_name = 'customers'
   and grantee = 'authenticated' and privilege_type = 'UPDATE'
 order by column_name;
