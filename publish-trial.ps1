<#
  RCW V5 Trial 릴리스 발행 스크립트

  artifacts\RCW_V5 의 Core Trial(90일) · Standard Trial(30일) 설치 파일 8종을
  하나의 GitHub 릴리스로 올린다.

  사이트(trial.html)는 항상 "최신 릴리스"의 고정 파일명을 가리키므로,
  이 스크립트를 실행하고 나면 웹사이트는 손대지 않아도 된다.

  ★ 로컬 빌드 파일에는 버전이 붙어 있지만(RCW_V5_Core_Trial_Rhino8_ko-KR_5.0.4.exe),
    업로드할 때는 버전을 뗀 이름으로 올린다. releases/latest/download/<파일명> 링크가
    동작하려면 파일명이 버전마다 바뀌면 안 되기 때문이다. 어느 빌드인지는 태그와
    릴리스 노트의 SHA-256 으로 확인한다.

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
$langs   = @('ko-KR', 'en-US')

# --- 사전 점검 ---------------------------------------------------------
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "GitHub CLI(gh) 가 없습니다.  winget install GitHub.cli  로 설치한 뒤 gh auth login 을 실행하세요."
}

if (-not (Test-Path $SourceDir)) {
    throw "릴리스 폴더를 찾을 수 없습니다: $SourceDir"
}

# 로컬 파일(버전 포함) → 업로드 이름(버전 제거) 대응표
$plan = foreach ($e in $editions) {
    foreach ($t in $targets) {
        foreach ($l in $langs) {
            $localName = "{0}_{1}_{2}_{3}.exe" -f $e.Prefix, $t, $l, $Version
            $localPath = Join-Path (Join-Path $SourceDir $e.Folder) $localName
            if (-not (Test-Path $localPath)) { throw "설치 파일이 없습니다: $localPath" }
            $item = Get-Item $localPath
            [pscustomobject]@{
                Edition    = $e.Label
                Days       = $e.Days
                UploadName = "{0}_{1}_{2}.exe" -f $e.Prefix, $t, $l
                Path       = $item.FullName
                SizeMB     = [math]::Round($item.Length / 1MB, 1)
                Built      = $item.LastWriteTime
                Sha256     = (Get-FileHash -Path $item.FullName -Algorithm SHA256).Hash
            }
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

$tag = "v$Version-trial"

# 릴리스 노트 — 사이트가 "릴리스 페이지의 SHA-256 과 대조하라"고 안내하므로 반드시 싣는다
$hashRows = ($plan | ForEach-Object { '| `{0}` | {1:N1} MB | `{2}` |' -f $_.UploadName, $_.SizeMB, $_.Sha256 }) -join "`n"
$notes = @"
RCW V5 $Version 트라이얼

| 에디션 | 명령 범위 | 사용 기간 |
|---|---|---|
| Core Trial | Core 기능 범위 | 90일 |
| Standard Trial | 전체 기능(Vent · Grill · BackPanel 포함) | 30일 |

두 트라이얼은 시작일을 따로 기록하므로, Core 를 끝까지 써 본 뒤에도 Standard 30일을 온전히 사용하실 수 있습니다.
한 번에 하나만 설치되며, 다른 쪽을 설치하면 교체됩니다(먼저 제거하지 않아도 됩니다).

- Windows 전용 / Rhino 7 · Rhino 8
- 한국어 · 영어 설치 파일 별도 제공
- 트라이얼은 인증 코드가 필요 없습니다

설치 안내: https://rcw-site.vercel.app/guide-ko.html

## 파일 검증 (SHA-256)

PowerShell 에서 ``Get-FileHash 파일이름.exe`` 로 확인하실 수 있습니다.

| 파일 | 크기 | SHA-256 |
|---|---:|---|
$hashRows
"@

if ($PSCmdlet.ShouldProcess("$Repo", "릴리스 $tag 발행")) {

    $existing = gh release view $tag --repo $Repo 2>$null
    if ($LASTEXITCODE -eq 0) {
        throw "태그 $tag 로 된 릴리스가 이미 있습니다. 버전을 올리거나 기존 릴리스를 삭제하세요."
    }

    Write-Host "`n릴리스 $tag 발행 중... (800MB 가까운 업로드라 몇 분 걸립니다)" -ForegroundColor Yellow

    # gh 는 경로에 '#' 가 들어가면 인자를 그 지점에서 잘라버린다. 업로드용 임시 폴더에
    # 버전을 뗀 이름으로 복사해 그 경로로 올린다. 끝나면(성공/실패 무관) 지운다.
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

    Write-Host "`n완료" -ForegroundColor Green
    Write-Host "  릴리스   https://github.com/$Repo/releases/tag/$tag"
    Write-Host "  사이트   https://rcw-site.vercel.app/trial"
    Write-Host "`n사이트는 항상 최신 릴리스를 가리키므로 별도 수정이 필요 없습니다." -ForegroundColor DarkGray
}
