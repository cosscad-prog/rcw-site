#!/usr/bin/env python3
"""
RCW V5 — 새 버전이 나오면 트라이얼 사용자에게 안내한다

trial_requests 를 읽어 아직 이 버전을 안내받지 않은 분에게만 메일을 보내고,
보낸 버전을 trial_requests.notified_version 에 기록한다.

★ 왜 자동인가
  버전은 계속 나온다. 그때마다 손으로 명단을 뽑아 한 통씩 보내면 언젠가
  건너뛰게 되고, 그러면 사용자는 옛 버전에 머문 채 "고쳐졌다는 그 문제"를
  계속 겪는다. 보내는 일이 발행 절차의 일부여야 한다.

★ 개인 링크로 보낸다
  본문의 링크는 /trial?r=<신청번호> 다. 누르면 신청 폼 없이 바로 받는다.
  ⚠️ 그래서 이 메일은 **한 사람에게 한 통씩** 나간다. 참조로 묶으면 남의
  이름으로 다운로드 기록이 쌓인다.

★ 기본은 보내지 않는다 (SEND_TRIAL_MAIL 이 true 일 때만 실제 발송).
  꺼져 있으면 "이런 메일이 나갈 예정" 목록을 관리자에게만 보낸다.
  고객에게 잘못 나간 메일은 되돌릴 수 없다 — renewal_notice.py 와 같은 이유다.

★ 중복 발송을 막는 것이 핵심이다.
  notified_version 이 이번 버전과 같으면 건너뛴다. 발송 성공 뒤에 기록한다 —
  기록만 되고 발송이 실패하면 그 사람은 이 버전 안내를 영영 못 받는다.

필요한 환경변수 (전부 GitHub Secrets — renewal-alert 와 같은 값)
  SUPABASE_URL · SUPABASE_SERVICE_KEY · MAIL_USERNAME · MAIL_APP_PASSWORD · MAIL_TO

선택
  VERSION                버전. 비우면 releases.json 의 맨 앞 항목을 쓴다
  SEND_TRIAL_MAIL=true   실제로 보낸다 (기본: 미리보기만)
  MAX_SEND=50            한 번에 보낼 수 있는 최대 통수. 넘으면 아무것도 안 보내고 실패
  REPLY_TO               답장 받을 주소 (기본: MAIL_USERNAME)

선행 조건
  docs/supabase-trial-notice.sql 을 SQL Editor 에서 한 번 실행해
  notified_version · notified_at · unsubscribed_at 칸이 있어야 한다.
"""

import html
import json
import os
import re
import smtplib
import ssl
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

KST = timezone(timedelta(hours=9))
SITE = "https://rcw-site.vercel.app"
RELEASES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "releases.json")

SUBJECT = "[RCW] 트라이얼 {version} 안내 — 링크만 누르시면 됩니다"

BODY = """{who}님, 안녕하십니까.

RCW 트라이얼을 사용해 주셔서 감사합니다.
새 버전 {version} 이 나와 안내드립니다.


■ 이번 버전에서 바뀐 것

{changes}

■ 받으시는 곳 — 아래 링크만 누르시면 됩니다

  {link}

  정보를 다시 입력하지 않으셔도 됩니다. 링크를 누르시면 바로 받으실 수 있습니다.
  기존 버전 위에 그대로 설치하시면 되고, 따로 지우지 않으셔도 됩니다.


■ 체험 기간은 그대로입니다

  새로 설치하셔도 체험 기간이 다시 시작되지는 않습니다.
  남으신 기간을 그대로 이어서 사용하시게 됩니다.


불편하신 점이나 궁금하신 것이 있으시면 이 메일로 회신해 주십시오.
안내를 원하지 않으시면 회신으로 알려 주시면 더 보내지 않겠습니다.

감사합니다.
"""


def env(name, required=True, default=""):
    value = os.environ.get(name, default).strip()
    if required and not value:
        sys.exit("::error::환경변수 %s 가 비어 있습니다." % name)
    return value


def api(base_url, key, path, method="GET", payload=None):
    request = urllib.request.Request(
        "%s/rest/v1/%s" % (base_url.rstrip("/"), path),
        method=method,
        data=json.dumps(payload).encode("utf-8") if payload is not None else None,
        headers={
            "apikey": key,
            "Authorization": "Bearer " + key,
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read().decode("utf-8")
        # Supabase 는 return=minimal 일 때 INSERT 에 201+빈 본문, PATCH 에 204 를 준다.
        # 상태코드가 아니라 본문이 비었는지로 판단해야 한다.
        return json.loads(raw) if raw.strip() else None


def load_release(version):
    """releases.json 에서 그 버전 항목을 찾는다. 사이트·릴리스 페이지와 같은 글이어야 한다."""
    with open(os.path.normpath(RELEASES), encoding="utf-8") as handle:
        notes = json.load(handle)["releases"]
    if not notes:
        sys.exit("::error::releases.json 에 항목이 없습니다.")
    if not version:
        return notes[0]
    for note in notes:
        if note.get("version") == version:
            return note
    sys.exit("::error::releases.json 에 %s 항목이 없습니다. 발행 전이 아닌지 확인하세요." % version)


def to_text(markup):
    """releases.json 의 항목은 화면용 HTML 이다. 메일은 평문이라 태그를 푼다."""
    text = re.sub(r"<br\s*/?>", "\n", markup or "")
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def summary_of(item):
    """항목의 한 줄 요약.

    releases.json 의 각 항목은 **첫 문장을 <b> 로 감싸 요약**하고 그 뒤에 자세한
    설명을 붙이는 형식이다(사이트 화면이 그렇게 읽히도록 쓴 글). 메일에는 그
    요약만 싣는다 — 받는 분이 알고 싶은 것은 "받아야 할 이유" 한 줄이고,
    자세한 내용은 링크를 눌러 다운로드 페이지에서 보시면 된다.

    <b> 로 시작하지 않는 옛 항목이 있을 수 있으므로 첫 문장으로 물러선다.
    """
    markup = item.get("ko") or ""
    match = re.search(r"<b>(.*?)</b>", markup, re.S)
    text = to_text(match.group(1)) if match else to_text(markup).split("\n")[0]
    text = " ".join(text.split())
    if not match:
        # 첫 문장까지만. 자르는 자리를 못 찾으면 길이로 자른다.
        cut = text.find("다. ")
        text = text[:cut + 2] if cut > 0 else text[:120].rstrip() + ("…" if len(text) > 120 else "")
    return text


def format_changes(note):
    lines = []
    for item in note.get("items", []):
        text = summary_of(item)
        if text:
            lines.append("  · " + text)
    if not lines:
        return "  (변경 내용이 기록되어 있지 않습니다)\n"
    return "\n".join(lines) + "\n\n  자세한 내용은 아래 페이지에서 보실 수 있습니다.\n"


def fetch_people(base_url, key):
    query = urllib.parse.urlencode({
        "select": "id,name,company,email,created_at,notified_version,unsubscribed_at",
        "order": "created_at.desc",
    })
    return api(base_url, key, "trial_requests?" + query) or []


def pick(rows, version):
    """보낼 대상과, 보낼 수 없는 대상을 갈라 돌려준다."""
    due, skipped = [], []
    for row in rows:
        if row.get("unsubscribed_at"):
            skipped.append((row, "안내 중단을 요청하신 분"))
            continue
        if not (row.get("email") or "").strip():
            skipped.append((row, "이메일 주소 없음"))
            continue
        if (row.get("notified_version") or "") == version:
            continue                      # 이미 이 버전을 안내했다
        due.append(row)
    return due, skipped


def build_mail(row, note):
    who = " ".join(x for x in [(row.get("company") or "").strip(),
                               (row.get("name") or "").strip()] if x) or "고객"
    return (
        SUBJECT.format(version=note["version"]),
        BODY.format(
            who=who,
            version=note["version"],
            changes=format_changes(note),
            link="%s/trial?r=%s" % (SITE, row["id"]),
        ),
    )


def send(server, sender, to_addr, reply_to, subject, body):
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = sender
    message["To"] = to_addr
    message["Reply-To"] = reply_to
    message.set_content(body)
    server.send_message(message)


def main():
    base_url = env("SUPABASE_URL")
    key = env("SUPABASE_SERVICE_KEY")
    user = env("MAIL_USERNAME")
    password = env("MAIL_APP_PASSWORD")
    admin_to = env("MAIL_TO", required=False) or user
    reply_to = env("REPLY_TO", required=False) or user
    really_send = env("SEND_TRIAL_MAIL", required=False).lower() == "true"
    max_send = int(env("MAX_SEND", required=False) or "50")

    note = load_release(env("VERSION", required=False))
    version = note["version"]

    rows = fetch_people(base_url, key)
    due, skipped = pick(rows, version)

    print("트라이얼 신청 %d명 · 보낼 대상 %d명 · 못 보냄 %d명"
          % (len(rows), len(due), len(skipped)))

    if not due and not skipped:
        print("보낼 안내가 없습니다. (모두 %s 안내를 받으셨습니다)" % version)
        return

    # 버전 문자열을 잘못 넣어 전원이 대상이 되는 사고를 막는다. 넘으면 아무것도 안 보낸다.
    if len(due) > max_send:
        sys.exit("::error::보낼 대상이 %d명으로 상한(%d)을 넘었습니다. "
                 "아무것도 보내지 않았습니다." % (len(due), max_send))

    lines = ["RCW 트라이얼 %s 안내 — %s" % (version, datetime.now(KST).strftime("%Y-%m-%d")), ""]
    lines.append("실제 발송: %s" % ("예" if really_send else "아니오 (미리보기)"))
    lines.append("")

    context = ssl.create_default_context()
    server = None
    try:
        server = smtplib.SMTP_SSL("smtp.gmail.com", 465, context=context, timeout=30)
        server.login(user, password)

        sent, failed = 0, 0
        for row in due:
            subject, body = build_mail(row, note)
            target = row["email"].strip()
            who = "%s / %s" % (row.get("company") or "-", row.get("name") or "-")

            if not really_send:
                lines.append("[보낼 예정] %s → %s" % (who, target))
                lines.append("    지난 안내: %s" % (row.get("notified_version") or "없음"))
                continue

            try:
                send(server, user, target, reply_to, subject, body)
            except Exception as error:            # noqa: 한 명 실패가 나머지를 막으면 안 된다
                failed += 1
                lines.append("[발송 실패] %s → %s  (%s)" % (who, target, error))
                continue

            # ★ 발송에 성공한 뒤에 기록한다. 순서를 바꾸면 기록만 되고 메일은 안 간
            #   사람이 생겨 이 버전 안내를 영영 못 받는다.
            try:
                api(base_url, key,
                    "trial_requests?id=eq." + urllib.parse.quote(row["id"]),
                    method="PATCH",
                    payload={"notified_version": version,
                             "notified_at": datetime.now(timezone.utc).isoformat()})
            except Exception as error:
                lines.append("[기록 실패] %s — 메일은 나갔으나 기록에 실패했습니다. "
                             "다음 실행에서 한 번 더 갈 수 있습니다. (%s)" % (who, error))

            sent += 1
            lines.append("[발송] %s → %s" % (who, target))

        if skipped:
            lines.append("")
            lines.append("── 자동으로 못 보낸 분 ──")
            for row, why in skipped:
                lines.append("%s / %s / %s — %s"
                             % (row.get("company") or "-", row.get("name") or "-",
                                row.get("email") or "-", why))

        lines.append("")
        lines.append("관리 화면: %s/admin" % SITE)

        subject = ("[RCW 트라이얼] %s 안내 %d통 발송%s"
                   % (version, sent, (" · 실패 %d" % failed) if failed else "")
                   if really_send else
                   "[RCW 트라이얼] 미리보기 — %s 안내 %d통 예정" % (version, len(due)))
        summary = EmailMessage()
        summary["Subject"] = subject
        summary["From"] = user
        summary["To"] = admin_to
        summary.set_content("\n".join(lines))
        server.send_message(summary)
        print(subject)
    finally:
        if server is not None:
            server.quit()


if __name__ == "__main__":
    main()
