<#
  publish-help.ps1 — 플러그인 도움말(help 폴더)을 홈페이지로 옮긴다.

  발행(publish-trial.ps1 / publish-customer.ps1)은 이것을 자동으로 부른다.
  이 스크립트는 도움말만 따로 고쳤을 때 손으로 올리는 용도다.

      pwsh -File .\publish-help.ps1              # 복사만(확인용)
      pwsh -File .\publish-help.ps1 -Commit      # 복사 + 커밋 + 푸시(= 배포)

  ⚠ 원본은 플러그인 저장소의 help 폴더 하나뿐이다. rcw-site\help 를 손으로 고치지 말 것 —
    robocopy /MIR 이라 다음 실행 때 사라진다.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string] $Source,
    [switch] $Commit
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_site-help.ps1')

$params = @{ SiteRoot = $PSScriptRoot }
if ($Source)   { $params.Source = $Source }
if (-not $Commit) { $params.NoCommit = $true }

Write-Host "도움말 동기화" -ForegroundColor Cyan
Sync-SiteHelp @params

if (-not $Commit) {
    Write-Host "배포하려면 -Commit 을 붙여 다시 실행한다." -ForegroundColor DarkGray
}
