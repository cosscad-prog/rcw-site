# Cloudflare Pages(rcw-site) 에 비밀값 5개를 넣는다 — Production 과 Preview 둘 다.
# 값은 화면에 안 보이게 입력받는다. 빈칸으로 Enter 하면 그 항목은 건너뛴다(다시 실행하면 된다).
#
# ★ 파이프(`$v | wrangler ...`)로 넘기지 않는다 — Windows PowerShell 은 끝에 줄바꿈을 붙이고,
#   그게 키 끝에 섞여 들어가면 인증이 조용히 실패한다. 줄바꿈 없는 JSON 파일로 `secret bulk`
#   에 넘기고, 그 파일은 끝나자마자 지운다.
#
# 값 찾는 곳:
#   SUPABASE_SERVICE_KEY  Supabase 대시보드 → Project Settings → API Keys → service_role (secret)
#   CUSTOMER_ADMIN_TOKEN  발급기 옆 portal-config.json 의 토큰 (Vercel 에 넣었던 것과 같은 값)
#   TELEGRAM_BOT_TOKEN    텔레그램 @BotFather → 봇 선택 → API Token
#   TELEGRAM_CHAT_ID      알림 받는 대화방 id (숫자, Vercel 에 넣었던 것)
#   MAIL_APP_PASSWORD     Gmail 앱 비밀번호 16자리. 다시 볼 수 없으면 myaccount.google.com/apppasswords
#                         에서 새로 만든다 — 그 경우 GitHub Actions 비밀값 MAIL_APP_PASSWORD 도 새 값으로 바꿀 것

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$names = 'SUPABASE_SERVICE_KEY', 'CUSTOMER_ADMIN_TOKEN', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'MAIL_APP_PASSWORD'
$values = @{}

# 관리자 토큰은 발급기 설정 파일에 이미 있다 — 있으면 그걸 쓰고 묻지 않는다.
$portalCfg = 'C:\std\RCW_V4_13.3\artifacts\RCW_V5\LicenseIssuer\portal-config.json'
if (Test-Path $portalCfg) {
    $tok = [string](Get-Content $portalCfg -Raw -Encoding UTF8 | ConvertFrom-Json).adminToken
    if ($tok.Trim()) {
        $values['CUSTOMER_ADMIN_TOKEN'] = $tok.Trim()
        $names = $names | Where-Object { $_ -ne 'CUSTOMER_ADMIN_TOKEN' }
        Write-Host "CUSTOMER_ADMIN_TOKEN — 발급기 설정 파일에서 읽음 ($($tok.Trim().Length)자)"
    }
}

foreach ($name in $names) {
    $secure = Read-Host "$name (빈칸=건너뜀)" -AsSecureString
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)).Trim()
    if ($plain) { $values[$name] = $plain } else { Write-Host "  - 건너뜀" }
}
if ($values.Count -eq 0) { Write-Host '넣을 것이 없다.'; exit 0 }

$tmp = Join-Path $env:TEMP ("cfsec-" + [guid]::NewGuid().ToString('N') + '.json')
try {
    # BOM 없는 UTF-8, 줄바꿈 없이
    [IO.File]::WriteAllText($tmp, ($values | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
    foreach ($envName in 'production', 'preview') {
        $out = npx wrangler pages secret bulk $tmp --project-name rcw-site --env $envName 2>&1 | Out-String
        if ($out -match 'Success|Finished') { Write-Host "  ✔ $($values.Count)개 → $envName" }
        else { Write-Host "  ✖ $envName 실패:`n$out" }
    }
} finally {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    $values.Clear()
}

Write-Host "`n지금 들어가 있는 이름 (preview) — 값은 안 보인다:"
npx wrangler pages secret list --project-name rcw-site --env preview 2>&1 | Select-String ':'
