#!/usr/bin/env python3
"""
RCW V5 — 하루 다운로드 요약 메일

Supabase 에서 '오늘'(한국 시간 기준) 들어온 트라이얼 신청과 다운로드를 읽어
관리자 메일로 보낸다. GitHub Actions 에서 매일 실행한다.

필요한 환경변수 (전부 GitHub Secrets)
  SUPABASE_URL          https://xxxx.supabase.co
  SUPABASE_SERVICE_KEY  service_role(secret) 키 — RLS 를 우회해 전체 조회
  MAIL_USERNAME         보내는 Gmail 주소
  MAIL_APP_PASSWORD     Gmail 앱 비밀번호 (일반 비밀번호 아님)
  MAIL_TO               받는 주소. 비어 있으면 MAIL_USERNAME 으로 보낸다

선택
  SEND_WHEN_EMPTY=true  활동이 없는 날에도 메일을 보낸다 (기본은 보내지 않음)
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

EDITION_DAYS = {"Core": 90, "Standard": 30}
LANG_LABEL = {"ko-KR": "한국어", "en-US": "English"}


def env(name, required=True, default=""):
    value = os.environ.get(name, default).strip()
    if required and not value:
        sys.exit("::error::환경변수 %s 가 비어 있습니다." % name)
    return value


def fetch(base_url, key, table, since_utc):
    query = urllib.parse.urlencode({
        "select": "*",
        "created_at": "gte." + since_utc,
        "order": "created_at.asc",
    })
    request = urllib.request.Request(
        "%s/rest/v1/%s?%s" % (base_url.rstrip("/"), table, query),
        headers={"apikey": key, "Authorization": "Bearer " + key},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def to_kst(iso_text):
    # Supabase 는 '2026-07-26T03:44:12.345+00:00' 형태로 준다
    cleaned = iso_text.replace("Z", "+00:00")
    return datetime.fromisoformat(cleaned).astimezone(KST)


def describe(row):
    edition = row.get("edition", "?")
    days = EDITION_DAYS.get(edition, "?")
    return "%s Trial(%s일) · Rhino %s · %s" % (
        edition, days, row.get("rhino", "?"),
        LANG_LABEL.get(row.get("lang"), row.get("lang", "?")),
    )


def build_body(day_label, downloads, signups, repeat_emails):
    lines = ["RCW V5 트라이얼 — %s 요약" % day_label, ""]
    lines.append("다운로드 %d건 · 신청 %d건 · 받아간 사람 %d명"
                 % (len(downloads), len(signups),
                    len({(d.get("email") or "").lower() for d in downloads})))
    lines.append("")

    if downloads:
        lines.append("── 다운로드 ──")
        for row in downloads:
            when = to_kst(row["created_at"]).strftime("%H:%M")
            mark = "  [재다운로드]" if (row.get("email") or "").lower() in repeat_emails else ""
            lines.append("%s  %s / %s / %s / %s%s"
                         % (when, row.get("name") or "-", row.get("company") or "-",
                            row.get("phone") or "-", row.get("email") or "-", mark))
            lines.append("       %s" % describe(row))
        lines.append("")

    # 신청만 하고 받지 않은 사람은 따로 보여준다 — 후속 연락 대상이다
    downloaded = {(d.get("email") or "").lower() for d in downloads}
    pending = [s for s in signups if (s.get("email") or "").lower() not in downloaded]
    if pending:
        lines.append("── 신청했지만 아직 받지 않음 ──")
        for row in pending:
            when = to_kst(row["created_at"]).strftime("%H:%M")
            lines.append("%s  %s / %s / %s / %s"
                         % (when, row.get("name") or "-", row.get("company") or "-",
                            row.get("phone") or "-", row.get("email") or "-"))
        lines.append("")

    lines.append("전체 기록: " + ADMIN_URL)
    return "\n".join(lines)


def main():
    base_url = env("SUPABASE_URL")
    key = env("SUPABASE_SERVICE_KEY")
    user = env("MAIL_USERNAME")
    password = env("MAIL_APP_PASSWORD")
    to_addr = env("MAIL_TO", required=False) or user
    send_when_empty = env("SEND_WHEN_EMPTY", required=False).lower() == "true"

    now_kst = datetime.now(KST)
    start_kst = now_kst.replace(hour=0, minute=0, second=0, microsecond=0)
    since_utc = start_kst.astimezone(timezone.utc).isoformat()
    day_label = start_kst.strftime("%Y-%m-%d")

    downloads = fetch(base_url, key, "downloads", since_utc)
    signups = fetch(base_url, key, "trial_requests", since_utc)

    # 오늘 받은 사람 중, 오늘 이전에도 받은 적이 있는 사람을 표시한다
    repeat_emails = set()
    if downloads:
        emails = {(d.get("email") or "").lower() for d in downloads}
        earlier = fetch(base_url, key, "downloads", "1970-01-01T00:00:00+00:00")
        for row in earlier:
            address = (row.get("email") or "").lower()
            if address in emails and to_kst(row["created_at"]) < start_kst:
                repeat_emails.add(address)

    print("%s — 다운로드 %d건, 신청 %d건" % (day_label, len(downloads), len(signups)))

    if not downloads and not signups and not send_when_empty:
        print("활동이 없어 메일을 보내지 않습니다. (SEND_WHEN_EMPTY=true 로 바꾸면 매일 보냅니다)")
        return

    subject = "[RCW] %s 다운로드 %d건 · 신청 %d건" % (day_label, len(downloads), len(signups))
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = user
    message["To"] = to_addr
    message.set_content(build_body(day_label, downloads, signups, repeat_emails))

    context = ssl.create_default_context()
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=context, timeout=30) as server:
        server.login(user, password)
        server.send_message(message)

    print("메일 발송 완료 → %s" % to_addr)


if __name__ == "__main__":
    main()
