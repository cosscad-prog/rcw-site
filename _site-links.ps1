<#
  발행 스크립트가 사이트의 다운로드 링크를 새 버전으로 고쳐 커밋·푸시한다.

  설치 파일 이름에 패치 버전이 들어가므로(예: RCW_V5_Core_Trial_Rhino8_5.0.7.exe)
  릴리스마다 사이트의 링크도 같이 바뀌어야 한다. 손으로 고치면 빠뜨린 링크가
  404 가 되므로, 파일을 올린 스크립트가 이어서 직접 고친다.

  사이트는 Vercel 이 main 브랜치에서 자동 배포하므로 push 가 곧 반영이다.
#>

function Update-SiteDownloadLinks {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param(
        [Parameter(Mandatory = $true)][string] $Version,

        # 고칠 파일의 사이트 루트 기준 상대 경로
        [Parameter(Mandatory = $true)][string[]] $RelativePath,

        # 파일 이름에서 버전 앞까지의 고정 부분.
        # 예: 'RCW_V5_(?:Core|Standard)_Trial_Rhino[78]'
        [Parameter(Mandatory = $true, ParameterSetName = 'FileName')]
        [string] $NamePattern,

        # 파일명이 아니라 코드 안의 버전 상수를 고칠 때 쓴다.
        # 예: "const RELEASE_VERSION = '"
        [Parameter(Mandatory = $true, ParameterSetName = 'Constant')]
        [string] $ConstantPrefix,

        [Parameter(Mandatory = $true)][string] $CommitMessage,

        [string] $SiteRoot = $PSScriptRoot
    )

    if ($PSCmdlet.ParameterSetName -eq 'FileName') {
        # 버전이 이미 붙어 있든(재발행) 아직 없든(최초 전환) 양쪽 다 잡아야 한다.
        $find = "($NamePattern)(?:_\d+\.\d+\.\d+)?\.exe"
        $replace = "`${1}_$Version.exe"
    }
    else {
        $find = "($([regex]::Escape($ConstantPrefix)))\d+\.\d+\.\d+"
        $replace = "`${1}$Version"
    }

    $changed = @()
    foreach ($rel in $RelativePath) {
        $path = Join-Path $SiteRoot $rel
        if (-not (Test-Path -LiteralPath $path)) { throw "사이트 파일을 찾을 수 없습니다: $path" }

        $original = Get-Content -LiteralPath $path -Raw
        $updated = [regex]::Replace($original, $find, $replace)

        if ($updated -eq $original) {
            Write-Host "  변경 없음  $rel" -ForegroundColor DarkGray
            continue
        }

        $hits = ([regex]::Matches($original, $find)).Count
        if ($PSCmdlet.ShouldProcess($rel, "$hits 곳을 $Version 으로 갱신")) {
            Set-Content -LiteralPath $path -Value $updated -Encoding utf8 -NoNewline
        }
        Write-Host ("  갱신 {0,-28} {1} 곳" -f $rel, $hits) -ForegroundColor Green
        $changed += $rel
    }

    if (-not $changed) {
        Write-Host "  사이트 링크는 이미 $Version 입니다." -ForegroundColor DarkGray
        return
    }

    if (-not $PSCmdlet.ShouldProcess('cosscad-prog/rcw-site', "커밋·푸시 ($($changed -join ', '))")) { return }

    Push-Location $SiteRoot
    try {
        # 다른 작업 중인 변경까지 쓸어 담지 않도록 고친 파일만 스테이징한다.
        git add -- $changed
        if ($LASTEXITCODE -ne 0) { throw "git add 실패" }

        git commit -q -m $CommitMessage
        if ($LASTEXITCODE -ne 0) { throw "git commit 실패" }

        # 이 저장소에는 백업 기록 같은 커밋이 자동으로 올라오므로, 발행할 때마다
        # 원격이 앞서 있을 수 있다. 받아서 얹은 다음 올린다.
        git fetch -q origin
        if ($LASTEXITCODE -ne 0) { throw "git fetch 실패" }

        git rebase -q origin/main
        if ($LASTEXITCODE -ne 0) {
            git rebase --abort
            throw "git rebase 실패 — 사이트 저장소를 직접 정리한 뒤 push 하세요."
        }

        git push -q origin main
        if ($LASTEXITCODE -ne 0) { throw "git push 실패 — 사이트가 옛 링크를 가리킨 채 남아 있습니다. 직접 push 하세요." }

        Write-Host "  사이트 push 완료 — Vercel 이 자동 배포합니다." -ForegroundColor Green
    }
    finally {
        Pop-Location
    }
}
