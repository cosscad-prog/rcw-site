<#
  RCW V5 유료판 릴리스 발행 스크립트

  artifacts\RCW_V5 의 Core · Standard 설치 파일 4종(에디션 2 × Rhino 2)을
  하나의 GitHub 릴리스로 올린다. 언어는 설치할 때 고르므로 파일이 갈리지 않는다.
  파일 이름이 버전과 무관하게 고정이라 사이트는 손댈 일이 없다.

  ★ 평가판(publish-trial.ps1)과 저장소가 다르다.
      평가판  cosscad-prog/rcw-releases           (홈페이지에서 공개 안내)
      유료판  cosscad-prog/rcw-customer-releases  (어디에도 링크하지 않음)

  ★ 로컬 빌드 파일에는 버전이 붙지만(빌드끼리 덮어쓰지 않게), 업로드할 때는
    **버전을 뗀 이름**으로 올린다(2026-07-30 결정). 그래서
    releases/latest/download/<파일명> 링크가 고정되고 사이트를 고칠 일이 없다.
    고객 페이지는 버전을 GitHub 릴리스 태그에서 직접 읽어 표시한다(latestRelease()).

  ★ 저장소는 공개다.
    비공개 저장소의 릴리스 파일은 토큰 없이 내려받을 수 없어 링크가 동작하지 않는다.
    주소를 아는 사람은 받을 수 있지만, 라이선스가 없으면 실행되지 않는다.
    더 조이려면 R2 + 단기 서명 URL 로 바꾸고 api/customer-login.js 의 fileList() 를 고친다.

  사용:
    .\publish-customer.ps1 -Version 5.0.4
    .\publish-customer.ps1 -Version 5.0.4 -WhatIf     # 실제 발행 없이 점검만
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param(
    # 릴리스 버전. 태그는 v<Version> 형태가 된다
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string] $Version,

    [string] $SourceDir = 'C:\std\RCW_V4_13.3\artifacts\RCW_V5',
    [string] $Repo      = 'cosscad-prog/rcw-customer-releases',

    # 서명 없는 파일을 그대로 올린다. 인증서를 아직 못 받은 동안에만 쓴다.
    # 서명 없이 올리면 SmartScreen 평판이 릴리스마다 0 에서 다시 시작한다.
    [switch] $AllowUnsigned
)

$ErrorActionPreference = 'Stop'

# 에디션별 폴더와 파일 접두사. 파일 이름 = 접두사 + _Rhino<n>_<버전>.exe
# 언어는 이름에 없다 — 한 파일이 두 언어를 담고 설치할 때 고른다(2026-07-30).
$editions = @(
    @{ Folder = 'Core';     Prefix = 'RCW_V5_Core';     Label = 'Core' },
    @{ Folder = 'Standard'; Prefix = 'RCW_V5_Standard'; Label = 'Standard' }
)
$targets = @('Rhino7', 'Rhino8')

# --- 사전 점검 ---------------------------------------------------------
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "GitHub CLI(gh) 가 없습니다.  winget install GitHub.cli  로 설치한 뒤 gh auth login 을 실행하세요."
}

if (-not (Test-Path $SourceDir)) {
    throw "릴리스 폴더를 찾을 수 없습니다: $SourceDir"
}

# 고객 페이지도 releases.json 의 맨 앞 항목을 "이번 버전에서 바뀐 것" 으로 보여준다.
# 새 항목을 안 넣고 발행하면 새 파일에 옛 변경 안내가 붙는다.
$notesFile = Join-Path $PSScriptRoot 'releases.json'
if (-not (Test-Path $notesFile)) {
    throw "releases.json 을 찾을 수 없습니다: $notesFile"
}
$latestNote = (Get-Content -LiteralPath $notesFile -Raw | ConvertFrom-Json).releases[0]
if ($latestNote.version -ne $Version) {
    throw "releases.json 의 맨 앞이 $($latestNote.version) 입니다. $Version 항목을 먼저 넣으세요 — 두 다운로드 페이지가 이 파일을 그대로 보여줍니다."
}

# 커밋이 하나도 없는 저장소에는 릴리스를 만들 수 없다(태그가 가리킬 대상이 없어서).
# 800MB 를 올리고 나서 실패하지 않도록 먼저 본다.
gh api "repos/$Repo/commits?per_page=1" 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "저장소 $Repo 에 커밋이 없습니다. README 같은 파일을 하나 먼저 올린 뒤 다시 실행하세요."
}

$plan = foreach ($e in $editions) {
    foreach ($t in $targets) {
        $localName = "{0}_{1}_{2}.exe" -f $e.Prefix, $t, $Version
        $localPath = Join-Path (Join-Path $SourceDir $e.Folder) $localName
        if (-not (Test-Path $localPath)) { throw "설치 파일이 없습니다: $localPath" }
        $item = Get-Item $localPath
        [pscustomobject]@{
            Edition    = $e.Label
            UploadName = "{0}_{1}.exe" -f $e.Prefix, $t   # 올릴 때는 버전을 뗀다
            Path       = $item.FullName
            SizeMB     = [math]::Round($item.Length / 1MB, 1)
            Built      = $item.LastWriteTime
            Sha256     = (Get-FileHash -Path $item.FullName -Algorithm SHA256).Hash
            Signature  = (Get-AuthenticodeSignature -FilePath $item.FullName).Status
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

# 서명 확인. 서명 없이 올리면 SmartScreen 평판이 이 릴리스에서 0 으로 되돌아가고,
# 앞선 버전이 쌓아둔 평판은 이어지지 않는다. 800MB 를 올린 뒤에 알아차리면 늦다.
$unsigned = @($plan | Where-Object { $_.Signature -ne 'Valid' })
if ($unsigned.Count -gt 0) {
    Write-Host "`n서명되지 않은 파일 $($unsigned.Count) 개" -ForegroundColor Yellow
    $unsigned | ForEach-Object { '  {0,-42} {1}' -f $_.UploadName, $_.Signature }
    if (-not $AllowUnsigned) {
        throw @"
서명되지 않은 파일이 있습니다.

  먼저 서명하세요:  .\sign-installers.ps1 -Version $Version
  인증서가 아직 없으면:  .\publish-customer.ps1 -Version $Version -AllowUnsigned

서명 없이 올리면 이 릴리스는 SmartScreen 평판을 처음부터 다시 쌓아야 하며,
고객은 "Windows의 PC 보호" 경고를 그대로 만납니다.
"@
    }
    Write-Warning "-AllowUnsigned 로 서명 없이 발행합니다. 고객 안내 문구가 배포되어 있는지 확인하세요."
}

$tag = "v$Version"

$hashRows = ($plan | ForEach-Object { '| `{0}` | {1:N1} MB | `{2}` |' -f $_.UploadName, $_.SizeMB, $_.Sha256 }) -join "`n"
$notes = @"
RCW V5 $Version

기존 고객용 설치 파일입니다. 다운로드는 고객 페이지에서 안내됩니다.
https://rcw-site.vercel.app/customer

| 에디션 | 명령 범위 |
|---|---|
| Core | 프레임 · 유리 · 백패널 전 과정 |
| Standard | 전체 기능(Vent · Grill · BIM 데이터 추가) |

- Windows 전용 / Rhino 7 · Rhino 8
- 한국어 · 영어를 설치할 때 고릅니다(설치 파일 하나에 두 언어가 들어 있습니다)
- 업데이트 후에도 기존 라이선스가 그대로 동작합니다

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
    # 복사해 그 경로로 올린다. 끝나면(성공/실패 무관) 지운다.
    $uploadDir = Join-Path ([System.IO.Path]::GetTempPath()) "rcw-customer-upload-$([Guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Path $uploadDir | Out-Null
    try {
        $uploadFiles = foreach ($f in $plan) {
            $dest = Join-Path $uploadDir $f.UploadName
            Copy-Item -LiteralPath $f.Path -Destination $dest -Force
            $dest
        }

        gh release create $tag @($uploadFiles) `
            --repo  $Repo `
            --title "RCW V5 $Version" `
            --notes $notes `
            --latest

        if ($LASTEXITCODE -ne 0) { throw "릴리스 발행에 실패했습니다." }
    }
    finally {
        Remove-Item -LiteralPath $uploadDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    # 파일 이름이 고정이라 고객 페이지는 손댈 것이 없다. 표시되는 버전은
    # 페이지가 GitHub 릴리스 태그를 직접 읽어 온다.

    Write-Host "`n완료" -ForegroundColor Green
    Write-Host "  릴리스   https://github.com/$Repo/releases/tag/$tag"
    Write-Host "  고객페이지 https://rcw-site.vercel.app/customer"
}
