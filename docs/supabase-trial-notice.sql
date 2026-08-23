-- ============================================================
--  트라이얼 새 버전 안내 — 필요한 칸 (2026-08-24)
--
--  .github/scripts/trial_notice.py 가 쓰는 세 칸이다.
--  없으면 첫 실행이 PostgREST 400 으로 실패한다.
--
--  왜 필요한가
--    · notified_version — **중복 발송을 막는 유일한 장치**다. 이 값이 이번
--      버전과 같으면 건너뛴다. 없으면 워크플로를 두 번 돌릴 때마다 같은 분께
--      같은 메일이 또 간다
--    · unsubscribed_at — "그만 보내 주세요" 를 받았을 때 적는다. 적어 두지
--      않으면 다음 버전에 또 간다
--
--  실행: Supabase → SQL Editor 에 붙여넣고 Run
-- ============================================================

alter table public.trial_requests
  add column if not exists notified_version text,
  add column if not exists notified_at      timestamptz,
  add column if not exists unsubscribed_at  timestamptz;

comment on column public.trial_requests.notified_version is
  '마지막으로 안내한 버전. 같은 버전은 다시 보내지 않는다';
comment on column public.trial_requests.notified_at is
  '그 안내를 보낸 시각';
comment on column public.trial_requests.unsubscribed_at is
  '더 이상 안내를 원하지 않는다고 알려 오신 시각. 값이 있으면 발송에서 제외한다';


-- ------------------------------------------------------------
--  쓰는 법
-- ------------------------------------------------------------

-- 1) 누가 어느 버전까지 안내받았는가
--    select created_at, name, company, email, notified_version, notified_at
--      from public.trial_requests order by created_at desc;

-- 2) "그만 보내 주세요" 회신을 받았을 때
--    update public.trial_requests set unsubscribed_at = now()
--     where lower(email) = '그주소';

-- 3) 한 사람에게 다시 보내고 싶을 때 (안내가 스팸함으로 갔다는 연락을 받은 경우 등)
--    update public.trial_requests set notified_version = null
--     where lower(email) = '그주소';
