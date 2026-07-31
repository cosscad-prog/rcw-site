#!/usr/bin/env python3
"""
RCW V5 — 구독 갱신, 오늘 챙길 고객 알림 (관리자용)

Supabase 의 renewal_watch 뷰를 읽어 갱신이 다가오거나 지난 고객을 우선순위대로
메일로 보낸다. GitHub Actions 에서 매일 아침 실행한다.

★ 이 스크립트는 고객에게 메일을 보내지 않는다. 관리자 한 사람에게만 간다.
  고객 안내 자동 발송은 다음 단계이고, 그때 renewal_stage 를 기록하게 된다.
  지금은 renewal_stage 를 읽기만 하므로, 수동으로 안내를 보냈다면
  admin 화면에서 기록해 두어야 여기 "안내함"으로 보인다.

★ 영구 고객은 renewal_watch 뷰에서 이미 빠져 있다(paid_through is null).
  영구 고객에게 갱신 독촉이 가는 것이 이 기능 최악의 사고라 뷰에서 막았다.

필요한 환경변수 (전부 GitHub Secrets — daily_report 와 같은 값을 쓴다)
  SUPABASE_URL          https://xxxx.supabase.co
  SUPABASE_SERVICE_KEY  service_role(secret) 키 — RLS 를 우회해 전체 조회
  MAIL_USERNAME         보내는 Gmail 주소
  MAIL_APP_PASSWORD     Gmail 앱 비밀번호 (일반 비밀번호 아님)
  MAIL_TO               받는 주소. 비어 있으면 MAIL_USERNAME 으로 보낸다

선택
  SEND_WHEN_EMPTY=true  챙길 고객이 없어도 메일을 보낸다 (기본은 보내지 않음)
"""

import json
import os
import smtplib
import ssl
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

KST = timezone(timedelta(hours=9))
ADMIN_URL = "https://rcw-site.vercel.app/admin"

# 급한 순서대로. stage 값은 뷰의 stage_now 와 글자까지 같아야 한다.
# (key, 짧은 이름, 제목, 오늘 할 일) — 짧은 이름은 맨 위 요약 줄에 쓴다.
# 제목에서 잘라 쓰지 않는 이유: 제목 문구를 고치면 요약이 조용히 깨진다.
STAGES = [
    ("locked", "잠김", "\U0001F534 잠김 — 작업이 멈춰 있음",
     "즉시 전화. 결제 확인되면 발급기를 켜서 재발급한다"),
    ("grace",  "유예후반", "\U0001F7E0 유예 후반 — 곧 잠김",
     "전화. 남은 날짜를 알리고 결제 일정을 확정한다"),
    ("due",    "청구일지남", "\U0001F7E1 청구일 지남 — 유예 중",
     "전화 또는 문자. 세금계산서가 나갔는지 확인한다"),
    ("d7",     "D-7", "⚠ D-7",
     "확인 전화. 갱신 의사를 못 받았으면 지금 받아 둔다"),
    ("d30",    "D-30", "\U0001F4C5 D-30",
     "갱신 안내 메일을 보낸다"),
]


def env(name, required=True, default=""):
    value = os.environ.get(name, default).strip()
    if required and not value:
        sys.exit("::error::환경변수 %s 가 비어 있습니다." % name)
    return value


def fetch_watch(base_url, key):
    # 뷰가 우선순위를 계산한다. 여기서 다시 계산하지 않는다 —
    # admin 화면과 계산이 어긋나는 것을 막으려고 뷰 하나로 모았다.
    query = urllib.parse.urlencode({
        "select": "*",
        "priority": "gte.1",          # ok(0) 는 아직 챙길 때가 아니다
        "cancelled_at": "is.null",    # 해지 통보받은 고객은 독촉하지 않는다
        "order": "priority.desc,paid_through.asc",
    })
    request = urllib.request.Request(
        "%s/rest/v1/renewal_watch?%s" % (base_url.rstrip("/"), query),
        headers={"apikey": key, "Authorization": "Bearer " + key},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def days_ago(iso_text, today):
    if not iso_text:
        return None
    cleaned = iso_text.replace("Z", "+00:00")
    when = datetime.fromisoformat(cleaned).astimezone(KST).date()
    return (today - when).days


def describe_left(days_left):
    """남은 일수를 사람이 읽는 말로. 음수는 '지남'이다."""
    if days_left is None:
        return "?"
    if days_left > 0:
        return "%d일 남음" % days_left
    if days_left == 0:
        return "오늘 만료"
    return "%d일 지남" % abs(days_left)


def build_body(rows, today):
    label = today.strftime("%Y-%m-%d")
    by_stage = {}
    for row in rows:
        by_stage.setdefault(row.get("stage_now"), []).append(row)

    counts = ["%s %d" % (short, len(by_stage[key]))
              for key, short, _, _ in STAGES if by_stage.get(key)]

    lines = ["RCW 구독 갱신 — %s 기준" % label, ""]
    lines.append("챙길 고객 %d명%s" % (len(rows), ("  (" + " · ".join(counts) + ")") if counts else ""))
    lines.append("")

    for key, _, heading, todo in STAGES:  # noqa: 짧은 이름은 위 요약에서만 쓴다
        group = by_stage.get(key)
        if not group:
            continue
        lines.append("── %s ──" % heading)
        for row in group:
            company = row.get("company") or "-"
            person = row.get("name") or "-"
            phone = row.get("phone") or "-"
            email = row.get("email") or "-"
            lines.append("%s / %s / %s" % (company, person, phone))
            lines.append("    청구 만료 %s (%s) · %s · %s"
                         % (row.get("paid_through") or "?",
                            describe_left(row.get("days_left")),
                            row.get("edition") or "?", email))

            # 안내를 보냈는지, 사람이 통화했는지 — 둘 다 있어야 판단이 된다
            sent = row.get("renewal_stage")
            lines.append("    안내 %s · 마지막 연락 %s"
                         % ("%s 단계까지 보냄" % sent if sent else "아직 없음",
                            ("%d일 전" % days_ago(row.get("last_contact_at"), today))
                            if row.get("last_contact_at") else "없음"))

            note = (row.get("contact_note") or "").strip()
            if note:
                first_line = note.splitlines()[0]
                lines.append("    메모: %s" % (first_line[:80] + ("…" if len(first_line) > 80 else "")))

            # 최근에 통화했으면 오늘 또 걸 필요는 없다
            if row.get("contacted_recently"):
                lines.append("    → 최근 연락함. 회신을 기다리는 중이면 넘어가도 된다")
            else:
                lines.append("    → %s" % todo)
            lines.append("")
        lines.append("")

    lines.append("전체 명단·연락 기록: " + ADMIN_URL)
    return "\n".join(lines)


def main():
    base_url = env("SUPABASE_URL")
    key = env("SUPABASE_SERVICE_KEY")
    user = env("MAIL_USERNAME")
    password = env("MAIL_APP_PASSWORD")
    to_addr = env("MAIL_TO", required=False) or user
    send_when_empty = env("SEND_WHEN_EMPTY", required=False).lower() == "true"

    today = datetime.now(KST).date()
    rows = fetch_watch(base_url, key)

    urgent = sum(1 for r in rows if (r.get("priority") or 0) >= 3)
    print("%s — 챙길 고객 %d명 (급함 %d명)" % (today, len(rows), urgent))

    if not rows and not send_when_empty:
        print("챙길 고객이 없어 메일을 보내지 않습니다. (SEND_WHEN_EMPTY=true 로 바꾸면 매일 보냅니다)")
        return

    # 제목만 보고도 오늘 전화를 걸어야 하는지 알 수 있어야 한다
    if urgent:
        subject = "[RCW 갱신] 급함 %d명 · 전체 %d명" % (urgent, len(rows))
    else:
        subject = "[RCW 갱신] 챙길 고객 %d명" % len(rows)

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = user
    message["To"] = to_addr
    message.set_content(build_body(rows, today))

    context = ssl.create_default_context()
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=context, timeout=30) as server:
        server.login(user, password)
        server.send_message(message)

    print("메일 발송 완료 → %s" % to_addr)


if __name__ == "__main__":
    main()
