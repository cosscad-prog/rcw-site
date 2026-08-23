-- ============================================================
--  downloads 기록 복구 — 2026-08-24
--
--  무슨 일이 있었나
--    2026-07-26 에 표를 만든 뒤 downloads 에 **한 줄도 들어가지 않았다**(count = 0).
--    트라이얼 신청은 4건 들어왔는데 다운로드 기록만 통째로 비어 있었다.
--
--  막고 있던 것 두 가지 — 하나만 고치면 여전히 안 들어간다
--    ① INSERT 정책이 없다.
--       공개키로 넣어 보면 42501 "new row violates row-level security policy".
--       supabase-downloads.sql 의 "anon can record download" 가 적용되지 않은 상태다.
--    ② lang 이 NOT NULL 이다.
--       2026-07-30 에 설치 파일 이름에서 언어를 뺐다(한 파일에 두 언어를 담기로 했다).
--       그래서 trial.html 은 그때부터 lang 을 늘 null 로 보낸다 — NOT NULL 위반.
--
--  ★ 페이지 쪽은 실패해도 아무 말이 없었다. fetch 는 401 을 예외로 보지 않아
--    .catch 가 걸리지 않는다. trial.html 을 같은 날 함께 고쳤다(res.ok 확인).
--
--  실행: Supabase → SQL Editor 에 통째로 붙여넣고 Run
-- ============================================================

-- ① 공개키(anon)로 기록만 할 수 있게 한다. 읽기·수정·삭제는 주지 않는다.
alter table public.downloads enable row level security;

drop policy if exists "anon can record download" on public.downloads;
create policy "anon can record download"
  on public.downloads
  for insert
  to anon
  with check (true);

-- 정책이 있어도 테이블 권한이 없으면 "permission denied" 로 막힌다. 함께 확인해 둔다.
grant insert on public.downloads to anon;

-- ② 언어는 이제 알 수 없는 값이다. 옛 기록에는 남아 있으므로 열은 그대로 두고
--    비어 있어도 되게만 바꾼다. check 는 NULL 을 막지 않으므로 손대지 않는다.
alter table public.downloads alter column lang drop not null;


-- ============================================================
--  확인 — 아래 세 줄의 결과를 보고 끝났는지 판단한다
-- ============================================================

-- 1) 정책이 붙었는가 (insert / anon / with_check = true 한 줄이 보여야 한다)
select polname, polcmd, pg_get_expr(polwithcheck, polrelid) as with_check
  from pg_policy
 where polrelid = 'public.downloads'::regclass;

-- 2) lang 이 nullable 이 되었는가 (is_nullable = YES)
select column_name, is_nullable
  from information_schema.columns
 where table_schema = 'public' and table_name = 'downloads' and column_name = 'lang';

-- 3) 실제로 들어가는가 — 넣어 보고 바로 지운다
insert into public.downloads
       (request_id, name, company, phone, email, edition, rhino, lang, file_name)
values (null, '__점검__', '__점검__', '-', 'check@example.com',
        'Core', '8', null, 'RCW_V5_Core_Trial_Rhino8.exe');

delete from public.downloads where name = '__점검__';

-- ⚠ 위 3) 은 관리자 권한으로 넣는 것이라 RLS 를 지나치지 않는다.
--    정책까지 확인하려면 트라이얼 페이지에서 실제로 버튼을 눌러 보는 것이 확실하다.
--    누른 뒤: select count(*) from public.downloads;
