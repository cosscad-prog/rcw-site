<#
  RCW V5 Trial 릴리스 발행 스크립트

  artifacts\RCW_V5 의 Core Trial(90일) · Standard Trial(30일) 설치 파일 4종
  (에디션 2 × Rhino 2)을 하나의 GitHub 릴리스로 올린다. 언어는 설치할 때
  고르므로 파일이 갈리지 않는다(2026-07-30).

  ★ 로컬 빌드 파일에는 버전이 붙지만(RCW_V5_Core_Trial_Rhino8_5.0.7.exe — 빌드끼리
    덮어쓰지 않게), 업로드할 때는 **버전을 뗀 이름**으로 올린다(2026-07-30 결정).
    고객 화면에 버전 문자열이 파일명으로 보이는 것을 사용자가 원치 않았고,
    그러면 releases/latest/download/<파일명> 링크가 고정되어 사이트를 고칠 일도 없다.
    어느 빌드인지는 ①페이지의 버전 안내 ②릴리스 태그·노트의 SHA-256
    ③파일 속성의 "파일 버전"(5.0.7.0) 으로 확인한다.

  사전 준비 (최초 1회):
    winget install GitHub.cli
    gh auth login          # GitHub 계정 인증

  사용:
    .\publish-trial.ps1 -Version 5.0.4
    .\publish-trial.ps1 -Version 5.0.4 -WhatIf     # 실제 발행 없이 점검만
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param(
    # 릴리스 버전. 태그는 v<Version>-trial 형태가 된다
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string] $Version,

    [string] $SourceDir = 'C:\std\RCW_V4_13.3\artifacts\RCW_V5',
    [string] $Repo      = 'cosscad-prog/rcw-releases'
)

$ErrorActionPreference = 'Stop'

# 에디션별 폴더와 파일 접두사. 업로드 이름 = 접두사 + _Rhino<n>_<lang>.exe (버전 없음)
$editions = @(
    @{ Folder = 'Core_Trial';     Prefix = 'RCW_V5_Core_Trial';     Label = 'Core';     Days = 90 },
    @{ Folder = 'Standard_Trial'; Prefix = 'RCW_V5_Standard_Trial'; Label = 'Standard'; Days = 30 }
)
$targets = @('Rhino7', 'Rhino8')

# --- 사전 점검 ---------------------------------------------------------
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "GitHub CLI(gh) 가 없습니다.  winget install GitHub.cli  로 설치한 뒤 gh auth login 을 실행하세요."
}

if (-not (Test-Path $SourceDir)) {
    throw "릴리스 폴더를 찾을 수 없습니다: $SourceDir"
}

# 두 다운로드 페이지가 releases.json 의 맨 앞 항목을 "이번 버전에서 바뀐 것" 으로 보여준다.
# 새 항목을 안 넣고 발행하면 새 파일에 옛 변경 안내가 붙는다 — 안내가 없는 것보다 나쁘다.
$notesFile = Join-Path $PSScriptRoot 'releases.json'
if (-not (Test-Path $notesFile)) {
    throw "releases.json 을 찾을 수 없습니다: $notesFile"
}
$latestNote = (Get-Content -LiteralPath $notesFile -Raw | ConvertFrom-Json).releases[0]
if ($latestNote.version -ne $Version) {
    throw "releases.json 의 맨 앞이 $($latestNote.version) 입니다. $Version 항목을 먼저 넣으세요 — 두 다운로드 페이지가 이 파일을 그대로 보여줍니다."
}

# 업로드 이름에도 버전을 남긴다. 받는 사람의 다운로드 폴더에서 어느 빌드인지
# 보이지 않으면 지원할 때 파일을 특정할 수 없기 때문이다. 파일명이 릴리스마다
# 바뀌므로 사이트의 링크도 같이 고쳐야 하는데, 그 일은 이 스크립트가 아래에서
# 직접 한다(Update-SiteLinks).
$plan = foreach ($e in $editions) {
    foreach ($t in $targets) {
        $localName = "{0}_{1}_{2}.exe" -f $e.Prefix, $t, $Version
        $localPath = Join-Path (Join-Path $SourceDir $e.Folder) $localName
        if (-not (Test-Path $localPath)) { throw "설치 파일이 없습니다: $localPath" }
        $item = Get-Item $localPath
        [pscustomobject]@{
            Edition    = $e.Label
            Days       = $e.Days
            UploadName = "{0}_{1}.exe" -f $e.Prefix, $t   # 올릴 때는 버전을 뗀다
            Path       = $item.FullName
            SizeMB     = [math]::Round($item.Length / 1MB, 1)
            Built      = $item.LastWriteTime
            Sha256     = (Get-FileHash -Path $item.FullName -Algorithm SHA256).Hash
        }
    }
}

Write-Host "`n업로드할 파일" -ForegroundColor Cyan
foreach ($f in $plan) {
    '{0,-42} {1,7:N1} MB   {2}' -f $f.UploadName, $f.SizeMB, $f.Built.ToString('yyyy-MM-dd HH:mm')
}
Write-Host ("합계 {0:N0} MB" -f ($plan | Measure-Object SizeMB -Sum).Sum) -ForegroundColor Cyan

# 빌드된 지 오래된 파일이 섞여 있으면 경고 (이전 버전을 잘못 올리는 사고 방지)
$span = $plan | Measure-Object Built -Maximum -Minimum
if (($span.Maximum - $span.Minimum).TotalHours -gt 24) {
    Write-Warning "파일들의 빌드 시각이 24시간 이상 차이납니다. 모두 같은 버전이 맞는지 확인하세요."
}

<#
  트라이얼 설치본은 **빌드일로부터 30일** 이 지나면 신규 사용자에게 시작되지 않는다.
  CAdm_Check_Keys.cs 의 ValidateLicense() 첫 설치 분기 —

      TimeSpan sinceRelease = DateTime.Now - BuildInfo.BuildDate;
      if (sinceRelease.TotalDays > 30 ...) { ShowExpiredMessage(); return false; }

  이미 쓰고 있는 사람은 시작일이 박혀 있어 영향이 없다. **새로 받는 사람만** 막힌다.
  그래서 트라이얼은 최소 한 달에 한 번 새로 발행해야 신규 유입이 끊기지 않는다.
  발행 때마다 그 기한을 눈에 보이게 찍어 둔다 — 안 그러면 어느 날 조용히
  "설치가 안 된다" 는 문의로만 알게 된다.
#>
function Show-TrialShelfLife {
    $buildDateFile = $null
    foreach ($root in @($env:RCW_REPO, 'C:\std\RCW_V4_13.3')) {
        if (-not $root) { continue }
        $candidate = Join-Path $root 'BuildDate.cs'
        if (Test-Path -LiteralPath $candidate) { $buildDateFile = $candidate; break }
    }

    if (-not $buildDateFile) {
        Write-Warning "BuildDate.cs 를 찾지 못해 신규 설치 기한을 계산하지 못했습니다."
        Write-Host   "  플러그인 저장소 경로를 RCW_REPO 환경변수로 알려 주면 계산합니다." -ForegroundColor DarkGray
        return
    }

    $text = Get-Content -LiteralPath $buildDateFile -Raw
    if ($text -notmatch 'new\s+System\.DateTime\(\s*(\d{4})\s*,\s*(\d{1,2})\s*,\s*(\d{1,2})\s*\)') {
        Write-Warning "BuildDate.cs 에서 빌드일을 읽지 못했습니다: $buildDateFile"
        return
    }

    $buildDate = Get-Date -Year $Matches[1] -Month $Matches[2] -Day $Matches[3] -Hour 0 -Minute 0 -Second 0
    $deadline  = $buildDate.AddDays(30)
    $left      = [int]($deadline - (Get-Date).Date).TotalDays

    Write-Host "`n신규 사용자 설치 기한" -ForegroundColor Cyan
    Write-Host ("  빌드일   {0:yyyy-MM-dd}" -f $buildDate)
    Write-Host ("  기한     {0:yyyy-MM-dd}  (남은 {1}일)" -f $deadline, $left)
    Write-Host "  이 날짜가 지나면 이 설치본은 **처음 설치하는 사람에게** 시작되지 않습니다." -ForegroundColor DarkGray
    Write-Host "  이미 쓰고 있는 사람은 영향 없습니다 — 시작일이 이미 기록돼 있습니다." -ForegroundColor DarkGray

    if ($left -le 0) {
        Write-Warning "이미 기한이 지났습니다. 지금 받는 신규 사용자는 설치해도 시작되지 않습니다. 다시 빌드해서 발행하십시오."
    }
    elseif ($left -le 10) {
        Write-Warning "기한이 $left 일 남았습니다. 빌드가 오래된 상태로 발행하는 중입니다 — 새로 빌드하는 편이 낫습니다."
    }
}

$tag = "v$Version-trial"

<#
  릴리스 노트에 **이번 버전에서 바뀐 것**을 싣는다 (2026-08-24).

  전에는 여기에 SHA-256 표가 있었다. 뺀 이유 셋 —
    · GitHub 이 첨부 파일마다 다이제스트를 **자체 제공**한다(우리 표는 같은 값의 사본)
    · 사이트의 "SHA-256 과 대조하라" 안내는 **2026-07-26 에 이미 감췄다**
      ("국내 사용자에게 혼란만 주어"). 가리키는 곳이 없어진 표만 남아 있었다
    · 이 페이지에 오는 사람은 설치 파일을 받으러 온 실무자다. 표 넉 줄이 화면을
      차지하면서 아무 일도 하지 않았다
  해시 값 자체는 계속 만든다(docs\RCW_V5_INSTALLER_HASHES_*.md, GitHub API).
  기업 IT 가 서명 없는 exe 승인 전에 요구하면 그것을 드리면 된다.

  내용은 releases.json 에서 가져온다 — 사이트가 그리는 것과 **같은 글**이어야
  두 곳이 어긋나지 않는다. <br> 만 줄바꿈으로 바꾼다(<b> 는 GitHub 이 그린다).
#>
function Get-ChangeSection {
    param([Parameter(Mandatory)] $Note)

    if (-not $Note.items -or $Note.items.Count -eq 0) { return '' }

    $lines = foreach ($item in $Note.items) {
        $text = [string] $item.ko
        if (-not $text) { continue }
        $text = $text -replace '<br\s*/?>', "`n"
        $text = $text -replace "`n{3,}", "`n`n"
        $text.Trim()
    }

    return "## 이번 버전에서 바뀐 것`n`n" + (($lines | Where-Object { $_ }) -join "`n`n") + "`n"
}

$changeSection = Get-ChangeSection -Note $latestNote

# 해시는 노트에 싣지 않고 발행이 끝나면 화면에 찍는다(아래 Write-Host).
#
# ⚠️ "Core 를 끝까지 쓴 뒤에도 Standard 30일을 온전히 쓸 수 있다" 는 문장은 뺐다
#    (2026-08-24 사용자 결정). 사실이기는 하지만 **체험을 이어 붙이는 방법을 우리가
#    먼저 알려 주는 꼴**이다. 스스로 찾아서 하면 막지 않되 권하지는 않는다.
#    다시 넣지 말 것.
$notes = @"
RCW V5 $Version 트라이얼

| 에디션 | 명령 범위 | 사용 기간 |
|---|---|---|
| Core Trial | 프레임 · 유리 · 백패널 전 과정 | 90일 |
| Standard Trial | 전체 기능(Vent · Grill · BIM 데이터 추가) | 30일 |

한 번에 하나만 설치되며, 다른 쪽을 설치하면 교체됩니다(먼저 제거하지 않아도 됩니다).

- Windows 전용 / Rhino 7 · Rhino 8
- 한국어 · 영어를 설치할 때 고릅니다(설치 파일 하나에 두 언어가 들어 있습니다)
- 트라이얼은 인증 코드가 필요 없습니다

설치 안내: https://rcw-site.vercel.app/guide-ko.html

$changeSection
"@

if ($PSCmdlet.ShouldProcess("$Repo", "릴리스 $tag 발행")) {

    $existing = gh release view $tag --repo $Repo 2>$null
    if ($LASTEXITCODE -eq 0) {
        throw "태그 $tag 로 된 릴리스가 이미 있습니다. 버전을 올리거나 기존 릴리스를 삭제하세요."
    }

    Write-Host "`n릴리스 $tag 발행 중... (800MB 가까운 업로드라 몇 분 걸립니다)" -ForegroundColor Yellow

    # gh 는 경로에 '#' 가 들어가면 인자를 그 지점에서 잘라버린다. 업로드용 임시 폴더에
    # 복사해 그 경로로 올린다. 끝나면(성공/실패 무관) 지운다.
    $uploadDir = Join-Path ([System.IO.Path]::GetTempPath()) "rcw-trial-upload-$([Guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Path $uploadDir | Out-Null
    try {
        $uploadFiles = foreach ($f in $plan) {
            $dest = Join-Path $uploadDir $f.UploadName
            Copy-Item -LiteralPath $f.Path -Destination $dest -Force
            $dest
        }

        gh release create $tag @($uploadFiles) `
            --repo  $Repo `
            --title "RCW V5 Trial $Version" `
            --notes $notes `
            --latest

        if ($LASTEXITCODE -ne 0) { throw "릴리스 발행에 실패했습니다." }
    }
    finally {
        Remove-Item -LiteralPath $uploadDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    # 다운로드 링크는 이름이 고정이라 고칠 게 없다. 대신 페이지가 안내하는
    # 버전 문구를 맞춘다 — 받는 사람이 어느 빌드인지 알 길이 여기뿐이다.
    Write-Host "`n사이트 버전 안내 갱신" -ForegroundColor Cyan
    . (Join-Path $PSScriptRoot '_site-links.ps1')
    Update-SiteDownloadLinks -Version $Version `
        -RelativePath 'trial.html' `
        -ConstantPrefix "var TRIAL_VERSION = '" `
        -CommitMessage "Say the trial downloads are $Version"

    Write-Host "`n완료" -ForegroundColor Green
    Write-Host "  릴리스   https://github.com/$Repo/releases/tag/$tag"
    Write-Host "  사이트   https://rcw-site.vercel.app/trial"

    Show-TrialShelfLife

    Write-Host "`n첨부 파일 SHA-256" -ForegroundColor Cyan
    Write-Host "  릴리스 노트에는 싣지 않는다(GitHub 이 자체 제공). 발행 기록 문서에 옮겨 적을 것." -ForegroundColor DarkGray
    foreach ($f in $plan) { Write-Host ("  {0,-34} {1,6:N1} MB  {2}" -f $f.UploadName, $f.SizeMB, $f.Sha256) }
}
