<#
  publish-help.ps1 — 플러그인 도움말(help 폴더)을 홈페이지로 복사한다.

  도움말의 원본은 언제나 플러그인 저장소의 help 폴더 하나뿐이다.
  이 스크립트는 그것을 rcw-site\help 로 그대로 미러링해서 누구나 웹에서 볼 수 있게 한다.
  ⚠ rcw-site\help 를 손으로 고치지 말 것 — 다음 실행 때 /MIR 로 지워진다.
     고칠 것이 있으면 원본(help 편집기)에서 고치고 이 스크립트를 다시 돌린다.

  쓰는 법:
      pwsh -File .\publish-help.ps1              # 복사만
      pwsh -File .\publish-help.ps1 -Commit      # 복사 + 커밋 + 푸시(= 배포)
#>
[CmdletBinding()]
param(
  [string] $Source = 'C:\std\RCW_V4_13.3\help',
  [switch] $Commit
)

$ErrorActionPreference = 'Stop'
$siteRoot = $PSScriptRoot
$dest     = Join-Path $siteRoot 'help'

if (-not (Test-Path (Join-Path $Source 'Help_index.html'))) {
  throw "도움말 원본을 찾지 못했다: $Source (Help_index.html 이 없다)"
}

Write-Host "원본 : $Source"
Write-Host "대상 : $dest"

# 웹에 올리지 않는 것
#  - editor / help_editor.py / *.bat : 도움말 편집기(로컬 전용)
#  - python                          : 편집기가 쓰는 임베디드 파이썬 22MB
#  - *.md / *.tsv / *.txt            : 집필 지침·작업 메모 등 내부 문서
#  - *.bak                           : 편집기가 남긴 저장 백업
#  - *.pptx                          : 이미지 편집 원본
$xd = @('editor','python','__pycache__')
$xf = @('*.py','*.bat','*.md','*.bak','*.pptx','*.tsv','*.txt')

$rcArgs = @($Source, $dest, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/nc', '/ns', '/np',
          '/XD') + $xd + @('/XF') + $xf
& robocopy @rcArgs | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy 실패 (exit $LASTEXITCODE)" }

# /help 로 들어와도 도움말이 열리도록 하는 안내 문서.
# 원본에는 없는 파일이라 /MIR 뒤에 매번 다시 만든다.
# ⚠ 절대경로로 보낸다 — Vercel 은 trailingSlash:false 라 /help 에는 슬래시가 없고,
#    상대경로("Help_index.html")는 사이트 루트로 풀려 404 가 된다.
$redirect = @'
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
Set-Content -Path (Join-Path $dest 'index.html') -Value $redirect -Encoding UTF8

$files = (Get-ChildItem -Path $dest -Recurse -File)
$mb    = [math]::Round(($files | Measure-Object Length -Sum).Sum / 1MB, 1)
Write-Host ("복사 완료 — 파일 {0}개, {1} MB" -f $files.Count, $mb)

if (-not $Commit) {
  Write-Host "커밋하지 않았다. 배포하려면 -Commit 을 붙여 다시 실행한다."
  return
}

Push-Location $siteRoot
try {
  & git add help
  $staged = & git diff --cached --name-only
  if (-not $staged) { Write-Host "바뀐 것이 없다."; return }
  & git commit -m "Sync the plug-in help onto the site"
  & git push
  Write-Host "푸시 완료 — Vercel 이 자동 배포한다."
} finally { Pop-Location }
