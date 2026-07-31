#!/usr/bin/env python3
"""
RCW V5 — 구독 갱신 안내를 고객에게 보낸다

renewal_watch 뷰를 읽어 단계가 올라간 고객에게만 안내 메일을 보내고,
보낸 단계를 customers.renewal_stage 에 기록한다.

★ 기본은 보내지 않는다 (SEND_CUSTOMER_MAIL 이 'true' 일 때만 실제 발송).
  꺼져 있으면 "이런 메일이 나갈 예정" 목록을 관리자에게만 보낸다.
  고객에게 잘못 나간 메일은 되돌릴 수 없으므로, 켜기 전에 미리보기로
  대상과 문구를 확인하는 단계를 일부러 두었다.

★ 중복 발송을 막는 것이 이 스크립트의 핵심이다.
  cron 이 매일 도는데 기록이 없으면 같은 고객에게 같은 메일이 매일 간다.
  renewal_stage 에 "어디까지 보냈는지" 를 남기고, 단계가 올라갔을 때만 보낸다.
  ⚠️ 발송 성공 뒤에 기록한다. 기록에 실패하면 다음 날 한 번 더 갈 수 있지만,
     그 반대(기록만 되고 발송 실패)보다 낫다 — 안내를 못 받는 쪽이 더 나쁘다.

★ 영구 고객에게는 절대 가지 않는다.
  renewal_watch 뷰가 paid_through is null 을 이미 걸러낸다.

필요한 환경변수 (전부 GitHub Secrets — daily-report 와 같은 값)
  SUPABASE_URL · SUPABASE_SERVICE_KEY · MAIL_USERNAME · MAIL_APP_PASSWORD · MAIL_TO

선택
  SEND_CUSTOMER_MAIL=true  실제로 고객에게 보낸다 (기본: 미리보기만)
  MAX_SEND=20              한 번에 보낼 수 있는 최대 통수. 넘으면 아무것도 안 보내고 실패한다
  REPLY_TO                 고객이 답장할 주소 (기본: MAIL_USERNAME)
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

# 뒤로 갈수록 급하다. 이 순서로 "단계가 올라갔는지" 를 판단한다.
STAGE_ORDER = ["d30", "d7", "due", "grace", "locked"]

# 고객에게 보내는 단계별 문구. locked 는 넣지 않는다 —
# 이미 멈춘 고객에게 자동 메일을 보내는 것보다 전화가 맞다.
STAGE_MAIL = {
    "d30": (
        "[RCW] {company} 구독 만료 {left}일 전 안내",
        "구독 만료일이 {paid_through} 입니다.\n"
        "계속 사용하시려면 갱신 절차를 진행해 주시기 바랍니다.",
    ),
    "d7": (
        "[RCW] {company} 구독 만료 {left}일 전 — 갱신 확인 부탁드립니다",
        "구독 만료일이 {paid_through} 로 얼마 남지 않았습니다.\n"
        "갱신 의사를 알려주시면 새 라이선스 파일을 준비해 드리겠습니다.",
    ),
    "due": (
        "[RCW] {company} 구독 만료일이 지났습니다",
        "구독 만료일 {paid_through} 이 지났습니다.\n"
        "지금은 여유 기간이라 프로그램은 정상 동작합니다.",
    ),
    "grace": (
        "[RCW] {company} 구독 — 곧 사용이 중지됩니다",
        "구독 만료일 {paid_through} 이 지나 여유 기간도 얼마 남지 않았습니다.\n"
        "기간이 끝나면 RCW 명령을 사용하실 수 없게 됩니다.",
    ),
}

BODY = """{company} {name}님, 안녕하세요.

{lead}

  라이선스   {license_id}
  제품       RCW V5 {edition}
  구독 만료   {paid_through}
  사용 가능   {expires_on} 까지 (만료 후 {grace}일 여유 기간 포함)

갱신하시면 새 라이선스 파일을 보내 드립니다.
고객 페이지에서 내려받아 Rhino 에서 RCWLicense 명령으로 등록하시면 됩니다.
  https://rcw-site.vercel.app/customer

★ 기간이 끝나도 작성하신 도면(3dm)은 그대로 열립니다.
   RCW 명령만 사용할 수 없게 됩니다.

이 메일에 답장하시거나 아래로 연락 주십시오.
  {reply_to}

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


def fetch_watch(base_url, key):
    query = urllib.parse.urlencode({
        "select": "*",
        "priority": "gte.1",
        "cancelled_at": "is.null",
        "order": "priority.desc,paid_through.asc",
    })
    return api(base_url, key, "renewal_watch?" + query) or []


def is_newer_stage(stage_now, already_sent):
    """지금 단계가 이미 보낸 단계보다 뒤인가. 뒤일 때만 보낸다."""
    if stage_now not in STAGE_ORDER:
        return False
    if not already_sent:
        return True
    if already_sent not in STAGE_ORDER:
        return True           # 모르는 값이면 보낸 적 없다고 본다
    return STAGE_ORDER.index(stage_now) > STAGE_ORDER.index(already_sent)


def pick(rows):
    """보낼 대상과, 보낼 수 없는 대상을 갈라 돌려준다."""
    due, skipped = [], []
    for row in rows:
        stage = row.get("stage_now")
        if stage not in STAGE_MAIL:
            # locked 는 자동 메일 대상이 아니다. 전화로 처리한다.
            if stage == "locked":
                skipped.append((row, "잠김 — 자동 메일 대신 전화"))
            continue
        if not is_newer_stage(stage, row.get("renewal_stage")):
            continue
        if not (row.get("email") or "").strip():
            skipped.append((row, "이메일 주소 없음"))
            continue
        due.append(row)
    return due, skipped


def build_customer_mail(row, grace_days, reply_to):
    stage = row["stage_now"]
    subject_tpl, lead_tpl = STAGE_MAIL[stage]
    left = row.get("days_left")
    fields = {
        "company": row.get("company") or "고객",
        "name": row.get("name") or "담당자",
        "left": abs(left) if left is not None else "?",
        "paid_through": row.get("paid_through") or "?",
        "expires_on": row.get("expires_on") or "?",
        "edition": row.get("edition") or "",
        "license_id": row.get("license_id") or "",
        "grace": grace_days,
        "reply_to": reply_to,
    }
    fields["lead"] = lead_tpl.format(**fields)
    return subject_tpl.format(**fields), BODY.format(**fields)


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
    really_send = env("SEND_CUSTOMER_MAIL", required=False).lower() == "true"
    max_send = int(env("MAX_SEND", required=False) or "20")
    grace_days = 30          # .lic 은 청구 만료일 + 30일까지 산다

    rows = fetch_watch(base_url, key)
    due, skipped = pick(rows)

    print("감시 대상 %d명 · 보낼 대상 %d명 · 못 보냄 %d명"
          % (len(rows), len(due), len(skipped)))

    if not due and not skipped:
        print("보낼 안내가 없습니다.")
        return

    # 데이터 실수(예: 날짜를 잘못 넣어 전원이 'due' 가 되는 경우)로
    # 고객 전체에게 메일이 나가는 것을 막는다. 넘으면 아무것도 보내지 않는다.
    if len(due) > max_send:
        sys.exit("::error::보낼 대상이 %d명으로 상한(%d)을 넘었습니다. "
                 "데이터를 확인하세요. 아무것도 보내지 않았습니다." % (len(due), max_send))

    lines = ["RCW 구독 갱신 안내 — %s" % datetime.now(KST).strftime("%Y-%m-%d"), ""]
    lines.append("실제 발송: %s" % ("예" if really_send else "아니오 (미리보기)"))
    lines.append("")

    # 미리보기여도 관리자 요약은 나가야 하므로 어느 쪽이든 접속한다.
    context = ssl.create_default_context()
    server = None
    try:
        server = smtplib.SMTP_SSL("smtp.gmail.com", 465, context=context, timeout=30)
        server.login(user, password)

        sent, failed = 0, 0
        for row in due:
            subject, body = build_customer_mail(row, grace_days, reply_to)
            target = row["email"].strip()

            if not really_send:
                lines.append("[보낼 예정] %s / %s → %s" % (row.get("company"), row.get("name"), target))
                lines.append("    %s" % subject)
                continue

            try:
                send(server, user, target, reply_to, subject, body)
            except Exception as error:            # noqa: 한 명 실패가 나머지를 막으면 안 된다
                failed += 1
                lines.append("[발송 실패] %s → %s  (%s)" % (row.get("company"), target, error))
                continue

            # ★ 발송에 성공한 뒤에 기록한다. 순서를 바꾸면
            #   기록만 되고 메일은 안 간 고객이 생겨 영영 안내를 못 받는다.
            try:
                api(base_url, key,
                    "customers?id=eq." + urllib.parse.quote(row["id"]),
                    method="PATCH",
                    payload={"renewal_stage": row["stage_now"],
                             "renewal_stage_at": datetime.now(timezone.utc).isoformat()})
            except Exception as error:
                lines.append("[기록 실패] %s — 메일은 나갔으나 단계 기록에 실패했습니다. "
                             "내일 한 번 더 갈 수 있습니다. (%s)" % (row.get("company"), error))

            sent += 1
            lines.append("[발송] %s / %s → %s  (%s)"
                         % (row.get("company"), row.get("name"), target, row["stage_now"]))

        if skipped:
            lines.append("")
            lines.append("── 자동으로 못 보낸 고객 (직접 연락 필요) ──")
            for row, why in skipped:
                lines.append("%s / %s / %s — %s"
                             % (row.get("company") or "-", row.get("name") or "-",
                                row.get("phone") or "-", why))

        lines.append("")
        lines.append("관리 화면: https://rcw-site.vercel.app/admin")

        subject = ("[RCW 갱신] 안내 %d통 발송%s" % (sent, (" · 실패 %d" % failed) if failed else "")
                   if really_send else "[RCW 갱신] 미리보기 — 보낼 안내 %d통" % len(due))
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
