<#
  발행 스크립트가 플러그인 도움말을 사이트로 옮겨 커밋·푸시한다.

  설치본에는 도움말이 함께 들어간다. 그러니 새 버전을 발행하면 홈페이지의 도움말도
  그 버전의 것이어야 한다 — 손으로 맞추면 반드시 어긋나므로, 릴리스를 올린
  스크립트가 이어서 직접 옮긴다. (사이트는 push 가 곧 배포다.)

  ⚠ 원본은 플러그인 저장소의 help 폴더 하나뿐이다. 여기(rcw-site\help)는 사본이라
    robocopy /MIR 로 덮인다 — 손으로 고친 것은 다음 발행 때 사라진다.
#>

# 도움말 원본. 다른 PC 에서 돌린다면 RCW_HELP_SOURCE 환경변수로 덮어쓴다.
$script:DefaultHelpSource = if ($env:RCW_HELP_SOURCE) { $env:RCW_HELP_SOURCE } else { 'C:\std\RCW_V4_13.3\help' }

# 웹에 올리지 않는 것 — 실제 설치본 규칙(build-installers.ps1 의 Copy-PublicHelp)과 같다.
$script:HelpExcludedDirs  = @('editor', 'python', '__pycache__', 'Help_PDF')
$script:HelpExcludedFiles = @('*.py', '*.pyc', '*.bak', '*.md', '*.tsv', '*.txt', '*.pptx', '*.bat')

# /help 로 들어온 사람을 프레임으로 보낸다. 원본에 없는 파일이라 /MIR 뒤에 다시 만든다.
# ⚠ 절대경로로 보낼 것 — trailingSlash:false 라 /help 에는 슬래시가 없고,
#   상대경로는 사이트 루트로 풀려 404 가 된다.
$script:HelpRedirectHtml = @'
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>RCW Help</title>
<meta http-equiv="refresh" content="0; url=/help/Help_index.html">
<link rel="canonical" href="/help/Help_index.html">
<script>location.replace('/help/Help_index.html');</script>
</head>
<body><p><a href="/help/Help_index.html">RCW 도움말 열기</a></p></body>
</html>
'@

function Test-HelpSearchIndex {
    <#
      검색 인덱스(search_index.js)는 생성물이다. 편집기로 저장하면 자동으로 다시
      만들어지지만 문서를 손으로 고치면 낡은 채 남는다. 낡으면 사이트에서도
      설치본에서도 새 문서가 검색되지 않으므로, 몇 개가 앞서 있는지 세어 알린다.
    #>
    param([Parameter(Mandatory = $true)][string] $Source)

    $stale = @()
    foreach ($pair in @(
        @{ Name = '한글'; Root = $Source;                      Index = (Join-Path $Source 'search_index.js');         SkipEn = $true },
        @{ Name = '영문'; Root = (Join-Path $Source 'en');     Index = (Join-Path $Source 'en\search_index.js');      SkipEn = $false }
    )) {
        if (-not (Test-Path -LiteralPath $pair.Index)) {
            Write-Warning "검색 인덱스가 없다: $($pair.Index)"
            continue
        }
        $indexTime = (Get-Item -LiteralPath $pair.Index).LastWriteTimeUtc
        $enRoot = (Join-Path $Source 'en')
        # 폴더 이름은 정규식 대신 경로 조각으로 거른다 — 역슬래시가 든 정규식은
        # 파일에 기록되는 동안 깨지기 쉽다(실제로 한 번 깨졌다).
        $sep = [System.IO.Path]::DirectorySeparatorChar
        $pages = Get-ChildItem -LiteralPath $pair.Root -Recurse -File -Filter *.html -ErrorAction SilentlyContinue |
            Where-Object {
                $segments = $_.FullName.Split($sep)
                (@($segments | Where-Object { $script:HelpExcludedDirs -contains $_ }).Count -eq 0) -and
                (-not $pair.SkipEn -or -not $_.FullName.StartsWith($enRoot, [StringComparison]::OrdinalIgnoreCase))
            }
        $newer = @($pages | Where-Object { $_.LastWriteTimeUtc -gt $indexTime })
        Write-Host ("  {0} 문서 {1}개 · 인덱스보다 새 것 {2}개" -f $pair.Name, $pages.Count, $newer.Count) -ForegroundColor DarkGray
        if ($newer.Count -gt 0) { $stale += $pair.Name }
    }

    if ($stale.Count -gt 0) {
        Write-Warning ("검색 인덱스가 낡았다({0}). 도움말을 고치고 인덱스를 안 만든 것이다 — 새 문서가 검색되지 않는다." -f ($stale -join '·'))
        Write-Warning "  고치는 법:  python `"$Source\build_search_index.py`""
    }
    return ($stale.Count -eq 0)
}

function Sync-SiteHelp {
    <#
      .SYNOPSIS
      플러그인 도움말을 rcw-site\help 로 미러링하고, 바뀌었으면 커밋·푸시한다.
    #>
    [CmdletBinding(SupportsShouldProcess = $true)]
    param(
        [string] $Source = $script:DefaultHelpSource,
        [string] $SiteRoot = $PSScriptRoot,
        [string] $CommitMessage = '사이트 도움말을 플러그인 도움말과 맞춘다',

        # 복사만 하고 커밋하지 않는다(손으로 확인하고 싶을 때).
        [switch] $NoCommit
    )

    if (-not (Test-Path -LiteralPath (Join-Path $Source 'Help_index.html'))) {
        throw "도움말 원본을 찾지 못했다: $Source (Help_index.html 이 없다). RCW_HELP_SOURCE 로 경로를 지정할 수 있다."
    }

    $dest = Join-Path $SiteRoot 'help'
    Write-Host "  원본 $Source"
    Write-Host "  대상 $dest"

    [void](Test-HelpSearchIndex -Source $Source)

    # ⚠ 마지막 /XF 항목은 우리가 만드는 리다이렉트 문서다(원본에 없다).
    #   전체 경로로 적어야 폴더마다 있는 index.html 까지 같이 빠지지 않는다.
    #   빼지 않으면 /MIR 이 매번 지웠다가 다시 만들어 "바뀔 파일" 수가 늘 1 로 남는다.
    $redirectPath = Join-Path $dest 'index.html'
    $rcArgs = @($Source, $dest, '/MIR', '/NDL', '/NJH', '/NJS', '/nc', '/ns', '/np',
                '/XD') + $script:HelpExcludedDirs + @('/XF') + $script:HelpExcludedFiles + @($redirectPath)

    # 먼저 목록만 뽑아(/L) 몇 개가 바뀌는지 센다. "돌렸다" 가 아니라 "몇 개가 바뀌었다" 를 남긴다.
    $preview = @(& robocopy @($rcArgs + '/L') | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
    Write-Host ("  바뀔 파일 {0}개" -f $preview.Count) -ForegroundColor DarkGray

    if (-not $PSCmdlet.ShouldProcess($dest, "도움말 $($preview.Count)개 갱신")) { return }

    & robocopy @($rcArgs + '/NFL') | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy 실패 (exit $LASTEXITCODE)" }
    $currentRedirect = if (Test-Path -LiteralPath $redirectPath) { Get-Content -LiteralPath $redirectPath -Raw } else { '' }
    if ($currentRedirect.Trim() -ne $script:HelpRedirectHtml.Trim()) {
        Set-Content -LiteralPath $redirectPath -Value $script:HelpRedirectHtml -Encoding UTF8
        Write-Host "  /help 리다이렉트 문서 갱신" -ForegroundColor DarkGray
    }

    $files = @(Get-ChildItem -LiteralPath $dest -Recurse -File)
    $mb = [math]::Round(($files | Measure-Object Length -Sum).Sum / 1MB, 1)
    Write-Host ("  사본 파일 {0}개, {1} MB" -f $files.Count, $mb) -ForegroundColor Green

    if ($NoCommit) {
        Write-Host "  커밋하지 않았다(-NoCommit)." -ForegroundColor DarkGray
        return
    }

    Push-Location $SiteRoot
    try {
        $pending = @(git status --porcelain -- help)
        if (-not $pending) {
            Write-Host "  사이트 도움말은 이미 같다." -ForegroundColor DarkGray
            return
        }
        Write-Host ("  커밋할 변경 {0}건" -f $pending.Count) -ForegroundColor Green

        if (-not $PSCmdlet.ShouldProcess('cosscad-prog/rcw-site', "도움말 커밋·푸시 ($($pending.Count)건)")) { return }

        # 다른 작업 중인 변경까지 쓸어 담지 않도록 help 만 스테이징한다.
        git add -- help
        if ($LASTEXITCODE -ne 0) { throw "git add 실패" }
        git commit -q -m $CommitMessage
        if ($LASTEXITCODE -ne 0) { throw "git commit 실패" }

        # 이 저장소에는 백업 기록 같은 커밋이 자동으로 올라온다. 받아서 얹은 다음 올린다.
        git fetch -q origin
        if ($LASTEXITCODE -ne 0) { throw "git fetch 실패" }
        git rebase -q origin/main
        if ($LASTEXITCODE -ne 0) {
            git rebase --abort
            throw "git rebase 실패 — 사이트 저장소를 직접 정리한 뒤 push 하세요."
        }
        git push -q origin main
        if ($LASTEXITCODE -ne 0) { throw "git push 실패 — 사이트 도움말이 옛 판으로 남아 있습니다. 직접 push 하세요." }

        Write-Host "  사이트 push 완료 — Vercel 이 자동 배포합니다." -ForegroundColor Green
    }
    finally { Pop-Location }
}
