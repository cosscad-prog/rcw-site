-- ============================================================
--  받아 간 것으로 손으로 표시하기 — 2026-08-24
--
--  왜 필요한가
--    2026-07-26 ~ 08-24 사이에는 다운로드 클릭 기록이 아예 남지 않았다
--    (docs/supabase-downloads-fix.sql 참조). 그 기간 신청자 4명은 실제로
--    받아 갔다고 판단되지만 기록이 없어 화면에는 "안 받아 감" 으로 뜬다.
--
--  왜 downloads 에 줄을 만들지 않는가
--    downloads 는 edition(Core/Standard) 과 rhino(7/8) 가 NOT NULL 이다.
--    우리는 그 둘을 모른다. 지어내면 다운로드 집계·CSV 가 그대로 오염되고,
--    나중에 "이 줄은 진짜인가" 를 가릴 방법이 없어진다.
--    대신 신청 행에 "손으로 확인했다" 는 표시만 남긴다. 화면은 받아 감 으로
--    바뀌지만 집계는 실제 클릭 기록만 센다.
--
--  실행: Supabase → SQL Editor 에 붙여넣고 Run
-- ============================================================

alter table public.trial_requests
  add column if not exists downloaded_manual_at timestamptz;

comment on column public.trial_requests.downloaded_manual_at is
  '클릭 기록이 없지만 받아 간 것으로 사람이 확인한 시각. 다운로드 집계에는 넣지 않는다';

-- 기록이 비어 있던 기간의 신청 4건. 신청 시각을 그대로 쓴다.
update public.trial_requests
   set downloaded_manual_at = coalesce(downloaded_manual_at, created_at)
 where email in ('tjdwls4205@naver.com',
                 'shinds0402@naver.com',
                 'lps@aluko.com',
                 'tkfkdgo7909@gmail.com');

-- 확인 — 4줄에 시각이 찍혀야 한다
select created_at, name, company, email, downloaded_manual_at
  from public.trial_requests
 order by created_at desc;
