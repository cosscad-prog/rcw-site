<#
  RCW5 — 설치 파일 하나(5.4.0 부터) 발행 스크립트
  계획: C:\std\RCW_V4_13.3\docs\development\SINGLE_INSTALLER_PLAN_2026-09-28.md

  하는 일 (이 순서가 중요하다)
    1. 사전 점검 — gh, 설치 파일, releases.json 맨 앞 = 이 버전
    2. 평가판 저장소(rcw-releases)  v<버전>-trial :  RCW5.exe  +  옛 평가판 이름 사본 4개
       고객 저장소(rcw-customer-releases) v<버전> :  옛 고객판 이름 사본 4개
       ★ 옛 이름 사본은 **같은 파일**이다(바이트·해시 동일 — 평판도 하나로 모인다).
         5.3.1 이하의 알림은 옛 이름으로만 찾고, 사이트의 옛 링크·캐시된 페이지도 옛 이름을 가리킨다.
         옛 판 사용자가 거의 없어질 때까지(관리 화면 사용 현황으로 판단) 계속 함께 올린다.
       ★ 설치기는 자기 이름과 무관하게 옛 설치본·저장된 고객 코드로 에디션을 미리 고른다.
    3. **파일이 모두 올라간 뒤에** releases.json 에 "installer" 항목을 넣고 푸시한다.
       이 항목 하나가 전환 스위치다 — 플러그인 알림(5.3.2+), 평가판 페이지, 고객 페이지가 함께 RCW5 로 넘어간다.
       먼저 넣으면 페이지가 아직 없는 파일을 가리키는 틈이 생긴다.
    4. trial.html 의 버전 문구 · 도움말 동기화 (옛 스크립트와 같다)

  사용
    .\publish-rcw5.ps1 -Version 5.4.0 -WhatIf     # 점검만
    .\publish-rcw5.ps1 -Version 5.4.0
  서명: 인증서가 없어 서명하지 않은 채 올린다(발행 방침). 서명이 생기면 올리기 전에 sign-installers 로.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string] $Version,

    [string] $SourceExe,
    [string] $TrialRepo    = 'cosscad-prog/rcw-releases',
    [string] $CustomerRepo = 'cosscad-prog/rcw-customer-releases'
)

$ErrorActionPreference = 'Stop'
if (-not $SourceExe) { $SourceExe = "C:\std\RCW_V4_13.3\artifacts\RCW5\RCW5_$Version.exe" }
$fileName = 'RCW5.exe'
$installerEntry = [ordered]@{ file = $fileName; repo = ($TrialRepo -split '/')[1] }

# 옛 이름 — 5.3.x 이하가 찾는 이름. 내용은 모두 RCW5.exe 와 같다.
$trialAliases    = 'RCW_V5_Core_Trial_Rhino7.exe', 'RCW_V5_Core_Trial_Rhino8.exe', 'RCW_V5_Standard_Trial_Rhino7.exe', 'RCW_V5_Standard_Trial_Rhino8.exe'
$customerAliases = 'RCW_V5_Core_Rhino7.exe', 'RCW_V5_Core_Rhino8.exe', 'RCW_V5_Standard_Rhino7.exe', 'RCW_V5_Standard_Rhino8.exe'

# --- 1. 사전 점검 --------------------------------------------------------
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'GitHub CLI(gh) 가 없습니다.' }
if (-not (Test-Path -LiteralPath $SourceExe)) { throw "설치 파일이 없습니다: $SourceExe  (build-rcw5-installer.ps1 을 먼저)" }
if ($SourceExe -match '_sandbox') { throw "흉내 설치용(_sandbox) 파일은 발행하지 않는다: $SourceExe" }

$notesFile = Join-Path $PSScriptRoot 'releases.json'
$releases = Get-Content -LiteralPath $notesFile -Raw | ConvertFrom-Json
if ($releases.releases[0].version -ne $Version) {
    throw "releases.json 의 맨 앞이 $($releases.releases[0].version) 입니다. $Version 항목을 먼저 넣으세요."
}

$item = Get-Item -LiteralPath $SourceExe
$sha = (Get-FileHash -LiteralPath $SourceExe -Algorithm SHA256).Hash
Write-Host "`n설치 파일" -ForegroundColor Cyan
'  {0}  {1:N1} MB  {2}' -f $item.Name, ($item.Length / 1MB), $item.LastWriteTime.ToString('yyyy-MM-dd HH:mm')
"  SHA-256 $sha"
Write-Host "`n올릴 이름" -ForegroundColor Cyan
"  $TrialRepo  v$Version-trial : $fileName, $($trialAliases -join ', ')"
"  $CustomerRepo  v$Version : $($customerAliases -join ', ')"
Write-Host "  (옛 이름은 모두 같은 파일 — 9개 업로드, 약 $([math]::Round($item.Length * 9 / 1MB)) MB)" -ForegroundColor DarkGray

$notes = @"
RCW5 $Version — 설치 파일 하나

Rhino 7 / 8 · 한국어 / 영어 · 에디션을 설치할 때 고릅니다.
- 정식판: 설치 중에 고객 코드(RCW-…)를 넣으면 에디션(Core / Standard)이 정해집니다
- 평가판: Core 90일 / Standard 30일 중에서 고릅니다
- 이미 설치된 RCW 는 설치기가 알아서 정리하고 넘겨받습니다

옛 이름(RCW_V5_…) 파일은 **같은 설치 파일**입니다 — 이전 판의 업데이트 알림이 그 이름으로 찾습니다.

설치 안내: https://www.beimptech.com/rcw/guide-ko.html
변경 안내: https://www.beimptech.com/rcw/trial
"@

function Publish-Release([string]$Repo, [string]$Tag, [string]$Title, [string[]]$Names) {
    if (-not $PSCmdlet.ShouldProcess($Repo, "릴리스 $Tag 발행 ($($Names.Count) 파일)")) { return }
    gh release view $Tag --repo $Repo 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { throw "태그 $Tag 로 된 릴리스가 이미 있습니다: $Repo" }
    # gh 는 경로의 '#' 에서 인자를 자른다 — 임시 폴더에 올릴 이름으로 복사해 올린다.
    $dir = Join-Path ([System.IO.Path]::GetTempPath()) "rcw5-upload-$([Guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Path $dir | Out-Null
    try {
        $files = foreach ($n in $Names) { $d = Join-Path $dir $n; Copy-Item -LiteralPath $SourceExe -Destination $d; $d }
        Write-Host "`n$Repo $Tag 발행 중..." -ForegroundColor Yellow
        gh release create $Tag @($files) --repo $Repo --title $Title --notes $notes --latest
        if ($LASTEXITCODE -ne 0) { throw "릴리스 발행 실패: $Repo $Tag" }
    }
    finally { Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue }
}

# --- 2. 올리기 -------------------------------------------------------------
Publish-Release -Repo $TrialRepo    -Tag "v$Version-trial" -Title "RCW5 $Version" -Names (@($fileName) + $trialAliases)
Publish-Release -Repo $CustomerRepo -Tag "v$Version"       -Title "RCW5 $Version" -Names $customerAliases

# --- 3. 전환 스위치: releases.json 의 installer 항목 ------------------------
Write-Host "`nreleases.json 전환 스위치" -ForegroundColor Cyan
$raw = Get-Content -LiteralPath $notesFile -Raw
if ($raw -match '"installer"\s*:') {
    "  이미 installer 항목이 있다 — 그대로 둔다."
}
elseif ($PSCmdlet.ShouldProcess('releases.json', "installer = $($installerEntry.file) ($($installerEntry.repo)) 넣고 push")) {
    # 파일 모양(들여쓰기·주석 칸)을 지키려고 _comment 줄 바로 뒤에 한 줄로 끼워 넣는다.
    $line = '  "installer": {"file": "' + $installerEntry.file + '", "repo": "' + $installerEntry.repo + '"},'
    $nl = if ($raw.Contains("`r`n")) { "`r`n" } else { "`n" }
    $m = [regex]::Match($raw, '^\s*"_comment"\s*:\s*".*?",\s*$', 'Multiline')
    if (-not $m.Success) { throw 'releases.json 에서 "_comment" 줄을 찾지 못했다 — 손으로 넣을 것.' }
    $new = $raw.Insert($m.Index + $m.Length, $nl + $line.TrimEnd())
    $null = $new | ConvertFrom-Json   # 깨진 JSON 을 올리지 않는다
    [System.IO.File]::WriteAllText($notesFile, $new, (New-Object System.Text.UTF8Encoding($false)))
    Push-Location $PSScriptRoot
    try {
        git pull -q --rebase
        git add -- releases.json
        git commit -q -m "RCW5 ${Version}: releases.json installer entry - pages and the update notice switch to one file"
        git push -q origin main
        if ($LASTEXITCODE -ne 0) { throw 'git push 실패 — releases.json 을 직접 push 하세요(파일은 이미 올라가 있다).' }
    }
    finally { Pop-Location }
    '  push 완료 — 몇 분 안에 평가판·고객 페이지와 플러그인 알림이 RCW5 로 넘어간다.'
}
else {
    "  (점검) installer 항목을 넣을 자리: `"_comment`" 줄 뒤"
}

# --- 4. 버전 문구 · 도움말 ------------------------------------------------
Write-Host "`n사이트 버전 안내 갱신" -ForegroundColor Cyan
. (Join-Path $PSScriptRoot '_site-links.ps1')
Update-SiteDownloadLinks -Version $Version -RelativePath 'trial.html' `
    -ConstantPrefix "var TRIAL_VERSION = '" -CommitMessage "Say the trial downloads are $Version"

Write-Host "`n도움말 동기화" -ForegroundColor Cyan
. (Join-Path $PSScriptRoot '_site-help.ps1')
try { Sync-SiteHelp -SiteRoot $PSScriptRoot -CommitMessage "Match the site help to $Version" }
catch {
    Write-Warning "도움말 동기화 실패: $_"
    Write-Warning '  릴리스는 정상입니다. 사이트 도움말만 옛 판입니다 — pwsh -File .\publish-help.ps1 -Commit'
}

Write-Host "`n발행 뒤 확인" -ForegroundColor Cyan
'  · 관리 화면 → 배포 현황: 평가판 저장소 RCW5.exe + 옛 이름 4, 고객 저장소 옛 이름 4, "맞습니다"'
'  · 평가판 페이지 버튼이 RCW5.exe 를 가리키는지 · 고객 페이지가 "Rhino 7 / 8" 한 칸인지'
"  · 받은 파일 SHA-256 = $sha"
