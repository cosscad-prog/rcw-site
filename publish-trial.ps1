<#
  RCW V5 Trial 릴리스 발행 스크립트

  artifacts\RCW_V5\Trial 의 설치 파일 4종을 GitHub Releases 에 올린다.
  사이트(trial.html)는 항상 "최신 릴리스"를 가리키므로,
  이 스크립트를 실행하고 나면 웹사이트는 손대지 않아도 된다.

  사전 준비 (최초 1회):
    winget install GitHub.cli
    gh auth login          # GitHub 계정 인증

  사용:
    .\publish-trial.ps1 -Version 5.0.1
    .\publish-trial.ps1 -Version 5.0.1 -WhatIf     # 실제 발행 없이 점검만
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param(
    # 릴리스 버전. 태그는 v<Version>-trial 형태가 된다
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string] $Version,

    [string] $SourceDir = 'C:\std\RCW_V4_13.3\artifacts\RCW_V5\Trial',
    [string] $Repo      = 'cosscad-prog/rcw-releases'
)

$ErrorActionPreference = 'Stop'

$expected = @(
    'RCW_V5_Trial_Rhino7_ko-KR.exe',
    'RCW_V5_Trial_Rhino7_en-US.exe',
    'RCW_V5_Trial_Rhino8_ko-KR.exe',
    'RCW_V5_Trial_Rhino8_en-US.exe'
)

# --- 사전 점검 ---------------------------------------------------------
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "GitHub CLI(gh) 가 없습니다.  winget install GitHub.cli  로 설치한 뒤 gh auth login 을 실행하세요."
}

if (-not (Test-Path $SourceDir)) {
    throw "설치 파일 폴더를 찾을 수 없습니다: $SourceDir"
}

$files = foreach ($name in $expected) {
    $path = Join-Path $SourceDir $name
    if (-not (Test-Path $path)) { throw "설치 파일이 없습니다: $name" }
    Get-Item $path
}

Write-Host "`n업로드할 파일" -ForegroundColor Cyan
foreach ($f in $files) {
    '{0,-38} {1,7:N1} MB   {2}' -f $f.Name, ($f.Length / 1MB), $f.LastWriteTime.ToString('yyyy-MM-dd HH:mm')
}
$totalMB = ($files | Measure-Object Length -Sum).Sum / 1MB
Write-Host ("합계 {0:N0} MB" -f $totalMB) -ForegroundColor Cyan

# 빌드된 지 오래된 파일이 섞여 있으면 경고 (이전 버전을 잘못 올리는 사고 방지)
$span = ($files | Measure-Object LastWriteTime -Maximum -Minimum)
if (($span.Maximum - $span.Minimum).TotalHours -gt 24) {
    Write-Warning "파일들의 빌드 시각이 24시간 이상 차이납니다. 모두 같은 버전이 맞는지 확인하세요."
}

$tag = "v$Version-trial"

if ($PSCmdlet.ShouldProcess("$Repo", "릴리스 $tag 발행")) {

    $existing = gh release view $tag --repo $Repo 2>$null
    if ($LASTEXITCODE -eq 0) {
        throw "태그 $tag 로 된 릴리스가 이미 있습니다. 버전을 올리거나 기존 릴리스를 삭제하세요."
    }

    $notes = @"
RCW V5 90일 트라이얼 — Core 기능 범위

- Windows 전용 / Rhino 7 · Rhino 8
- 한국어 · 영어 설치 파일 별도 제공
- 트라이얼은 인증 코드가 필요 없습니다

설치 안내: https://rcw-site.vercel.app/guide-ko.html
"@

    Write-Host "`n릴리스 $tag 발행 중... (수백 MB 업로드라 몇 분 걸립니다)" -ForegroundColor Yellow

    # gh 는 경로에 '#' 가 들어가면 인자를 그 지점에서 잘라버린다. 지금 SourceDir 은
    # '#' 이 없지만, 방어적으로 업로드 직전에 '#' 없는 임시 폴더로 복사해 그 경로로
    # 올린다. 발행이 끝나면(성공/실패 무관) 임시 폴더는 지운다.
    $uploadDir = Join-Path ([System.IO.Path]::GetTempPath()) "rcw-trial-upload-$([Guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Path $uploadDir | Out-Null
    try {
        $uploadFiles = foreach ($f in $files) {
            $dest = Join-Path $uploadDir $f.Name
            Copy-Item -LiteralPath $f.FullName -Destination $dest -Force
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
