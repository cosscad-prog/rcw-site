<#
  설치 파일 코드 서명

  artifacts\RCW_V5 의 Core · Standard 설치 파일 8종에 서명한다.
  publish-customer.ps1 로 올리기 **전에** 실행한다.

  ★ 서명하지 않으면 릴리스마다 평판이 0 에서 다시 시작한다.
    Microsoft 문서 기준, 서명 없는 파일은 이전 버전의 SmartScreen 평판을 물려받지
    못한다. 즉 5.0.5 가 평판을 쌓아도 5.0.6 을 내는 순간 경고가 처음부터 다시 뜬다.
    서명하면 평판이 인증서에 쌓여 다음 릴리스로 이어진다 — 그게 서명을 하는 이유다.

  ★ 인증서를 바꾸면 평판이 초기화된다.
    갱신할 때도 같은 조직 신원을 유지해야 한다. 매번 다른 인증서로 서명하면
    영원히 평판이 쌓이지 않는다.

  ★ 서명한 뒤에는 파일을 건드리지 않는다.
    한 바이트만 바뀌어도 서명이 깨진다. 서명 → 업로드 순서를 지킨다.

  쓰는 법
    # USB 토큰을 꽂고 (지문은 인증서 발급 때 받은 값)
    .\sign-installers.ps1 -Version 5.0.6 -Thumbprint AABBCC...

    # 지문을 매번 넣기 싫으면 환경변수에 둔다
    $env:RCW_SIGN_THUMBPRINT = 'AABBCC...'
    .\sign-installers.ps1 -Version 5.0.6

    # 무엇을 서명할지만 확인
    .\sign-installers.ps1 -Version 5.0.6 -WhatIf
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string] $Version,

    # 서명 인증서 지문(SHA-1). 토큰을 꽂으면 CurrentUser\My 에 보인다:
    #   Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.EnhancedKeyUsageList.FriendlyName -contains '코드 서명' }
    [string] $Thumbprint = $env:RCW_SIGN_THUMBPRINT,

    [string] $SourceDir = 'C:\std\RCW_V4_13.3\artifacts\RCW_V5',

    # 타임스탬프 서버. ★ 반드시 붙인다 — 없으면 인증서가 만료되는 날
    # 과거에 서명한 파일까지 전부 무효가 된다.
    [string] $TimestampUrl = 'http://timestamp.sectigo.com',

    # 이미 서명된 파일도 다시 서명한다(보통은 건너뛴다)
    [switch] $Force
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($Thumbprint)) {
    throw "인증서 지문이 없습니다. -Thumbprint 를 주거나 `$env:RCW_SIGN_THUMBPRINT 를 설정하세요."
}
$Thumbprint = $Thumbprint -replace '[^0-9A-Fa-f]', ''

# --- signtool 찾기 -----------------------------------------------------
# Windows SDK 를 설치하면 버전별 폴더가 여러 개 생긴다. 가장 최신 x64 를 쓴다.
$signtool = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\x64\\' } |
    Sort-Object { [version]($_.FullName -replace '.*\\bin\\([\d\.]+)\\.*', '$1') } -Descending |
    Select-Object -First 1 -ExpandProperty FullName
if (-not $signtool) {
    throw "signtool.exe 를 찾지 못했습니다. Windows SDK 의 'Windows SDK Signing Tools' 를 설치하세요."
}

# --- 인증서 확인 -------------------------------------------------------
$cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Thumbprint -eq $Thumbprint }
if (-not $cert) {
    throw "지문 $Thumbprint 인증서가 CurrentUser\My 에 없습니다. USB 토큰이 꽂혀 있는지, 토큰 드라이버가 설치되었는지 확인하세요."
}
if (-not $cert.HasPrivateKey) {
    throw "그 인증서에 개인키가 붙어 있지 않습니다. 서명할 수 없습니다."
}
$daysLeft = [int]($cert.NotAfter - (Get-Date)).TotalDays
Write-Host "`n서명 인증서" -ForegroundColor Cyan
"  주체    : $($cert.Subject)"
"  만료    : $($cert.NotAfter.ToString('yyyy-MM-dd'))  (${daysLeft}일 남음)"
"  signtool: $signtool"
if ($daysLeft -lt 30) {
    Write-Warning "인증서 만료가 30일 이내입니다. 갱신하더라도 **같은 조직 신원**을 유지해야 평판이 이어집니다."
}

# --- 대상 파일 --------------------------------------------------------
$editions = @(
    @{ Folder = 'Core';     Prefix = 'RCW_V5_Core' },
    @{ Folder = 'Standard'; Prefix = 'RCW_V5_Standard' }
)
$plan = foreach ($e in $editions) {
    foreach ($t in @('Rhino7', 'Rhino8')) {
        foreach ($l in @('ko-KR', 'en-US')) {
            $name = "{0}_{1}_{2}_{3}.exe" -f $e.Prefix, $t, $l, $Version
            $path = Join-Path (Join-Path $SourceDir $e.Folder) $name
            if (-not (Test-Path $path)) { throw "설치 파일이 없습니다: $path" }
            [pscustomobject]@{
                Name   = $name
                Path   = (Get-Item $path).FullName
                Status = (Get-AuthenticodeSignature $path).Status
            }
        }
    }
}

Write-Host "`n대상 파일 $($plan.Count) 개" -ForegroundColor Cyan
$plan | ForEach-Object { '  {0,-46} {1}' -f $_.Name, $_.Status }

# --- 서명 -------------------------------------------------------------
$signed = 0; $skipped = 0
foreach ($f in $plan) {
    if ($f.Status -eq 'Valid' -and -not $Force) {
        Write-Host "  건너뜀 (이미 서명됨)  $($f.Name)" -ForegroundColor DarkGray
        $skipped++
        continue
    }
    if (-not $PSCmdlet.ShouldProcess($f.Name, '코드 서명')) { continue }

    & $signtool sign `
        /sha1 $Thumbprint `
        /fd sha256 `
        /tr $TimestampUrl /td sha256 `
        /d 'RCW V5' `
        /q `
        $f.Path
    if ($LASTEXITCODE -ne 0) {
        throw "서명 실패: $($f.Name)  (signtool 종료코드 $LASTEXITCODE)"
    }
    Write-Host "  서명함  $($f.Name)" -ForegroundColor Green
    $signed++
}

if ($WhatIfPreference) { return }

# --- 검증 -------------------------------------------------------------
# signtool 이 성공했다고 끝이 아니다. 타임스탬프가 안 붙는 경우가 있어 따로 본다.
Write-Host "`n검증" -ForegroundColor Cyan
$bad = @()
foreach ($f in $plan) {
    $sig = Get-AuthenticodeSignature $f.Path
    $hasTs = $null -ne $sig.TimeStamperCertificate
    $ok = ($sig.Status -eq 'Valid') -and $hasTs
    '  {0,-46} {1,-8} 타임스탬프={2}' -f $f.Name, $sig.Status, $(if ($hasTs) { '있음' } else { '없음' })
    if (-not $ok) { $bad += $f.Name }
}

if ($bad) {
    throw "다음 파일이 올바르게 서명되지 않았습니다:`n  " + ($bad -join "`n  ")
}

Write-Host "`n완료 — 서명 $signed 개, 건너뜀 $skipped 개" -ForegroundColor Green
Write-Host "다음: .\publish-customer.ps1 -Version $Version" -ForegroundColor DarkGray
Write-Warning "지금부터 이 파일들을 수정하면 서명이 깨집니다. 그대로 업로드하세요."
