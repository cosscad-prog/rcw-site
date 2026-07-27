<#
  기존 고객 이전(마이그레이션)용 임시코드 생성기

  왜 필요한가
    기존 고객은 아직 V5KO 라이선스가 없다. 그런데 라이선스를 받으려면 새 버전을
    설치해 머신코드를 알려줘야 하고, 새 버전을 받으려면 고객 페이지에 코드로
    들어가야 한다 — 순환이다. 그래서 먼저 임시코드를 만들어 명부에 넣고 안내한다.

  ★ 코드는 고객별로 지정해야 한다.
    다운로드 페이지는 명부의 edition 값으로 보여줄 파일을 정한다. 익명 코드로는
    Core 인지 Standard 인지 알 수 없다. 그래서 이 스크립트는 "고객 목록"을 받아
    각자에게 코드를 하나씩 붙인다.

  쓰는 법
    1. customers.csv 를 만든다 (첫 줄은 그대로 두고 아래에 고객을 적는다)

         company,name,phone,email,edition
         (주)가나건설,홍길동,010-1111-2222,hong@gana.co.kr,Standard
         (주)다라창호,김철수,,,Core

       - edition 은 Core 또는 Standard (대소문자 정확히)
       - 모르는 값은 비워 둔다. 고객이 페이지에서 채운다.

    2. .\new-migration-codes.ps1 -CsvPath .\customers.csv

    3. 화면에 두 가지가 나온다
       - Supabase SQL Editor 에 붙여넣을 INSERT 문
       - 고객별 안내용 코드 목록 (메일에 넣을 값)

  ⚠ 만들어진 코드는 이 실행에서만 볼 수 있다. -OutCsv 로 파일에 남겨 두면
    누구에게 무엇을 보냈는지 나중에 확인할 수 있다. 그 파일은 고객 접근수단이므로
    메일 발송이 끝나면 지우는 편이 낫다.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $CsvPath,

    # 생성 결과를 남길 파일(선택). 메일 발송용 대조표.
    [string] $OutCsv,

    # Excel 에서 그냥 "CSV" 로 저장하면 한글이 UTF-8 이 아니라 949(ANSI)로 들어간다.
    # 그때 -Encoding ansi 를 준다. "CSV UTF-8" 로 저장했다면 기본값 그대로 둔다.
    # (PowerShell 7 에서 'Default' 는 ANSI 가 아니라 UTF-8 을 뜻하므로 쓰지 않는다.)
    [ValidateSet('UTF8', 'ansi', 'oem', 'Unicode')]
    [string] $Encoding = 'UTF8'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $CsvPath)) { throw "고객 목록 파일이 없습니다: $CsvPath" }

# 결과표를 입력 파일에 쓰면 고객 목록이 통째로 사라진다. 아무 일도 하기 전에 막는다.
if ($OutCsv) {
    $inFull  = (Resolve-Path -LiteralPath $CsvPath).Path
    $outFull = if ([System.IO.Path]::IsPathRooted($OutCsv)) { [System.IO.Path]::GetFullPath($OutCsv) }
               else { [System.IO.Path]::GetFullPath((Join-Path (Get-Location).Path $OutCsv)) }
    if ($inFull -eq $outFull) {
        throw "-OutCsv 가 입력 파일과 같습니다($OutCsv). 그대로 두면 고객 목록이 덮어써집니다. 다른 이름을 주세요 (예: .\보낸코드.csv)."
    }
}

$rows = @(Import-Csv -LiteralPath $CsvPath -Encoding $Encoding)

# 머리글 줄이 없으면 첫 고객이 열 이름으로 먹히고, 그 고객만 조용히 빠진다.
# 값이 이상하다는 오류보다 원인을 바로 알려주는 편이 낫다.
$requiredColumns = @('company', 'name', 'phone', 'email', 'edition')
$haveColumns = if ($rows.Count -gt 0) { @($rows[0].PSObject.Properties.Name) } else { @() }
$missingColumns = @($requiredColumns | Where-Object { $_ -notin $haveColumns })
if ($missingColumns.Count -gt 0) {
    throw "머리글 줄이 없거나 열 이름이 다릅니다(없는 열: $($missingColumns -join ', ')). 파일 맨 첫 줄에 정확히 이 한 줄을 넣으세요:`n`ncompany,name,phone,email,edition"
}

# 한글이 깨진 채 진행하면 명부에 깨진 이름이 들어간다. 먼저 잡는다.
$sample = ($rows | ForEach-Object { "$($_.company)$($_.name)" }) -join ''
if ($sample -match '[�]|[À-ÿ]{3,}') {
    throw "CSV 한글이 깨져 읽힙니다. Excel 이면 'CSV UTF-8' 로 다시 저장하거나 -Encoding ansi 를 주고 실행하세요."
}
if ($rows.Count -eq 0) { throw "고객 목록이 비어 있습니다." }

$plan = foreach ($r in $rows) {
    $edition = ($r.edition | ForEach-Object { $_ }) -as [string]
    $edition = $edition.Trim()
    if ($edition -ne 'Core' -and $edition -ne 'Standard') {
        throw "edition 은 Core 또는 Standard 여야 합니다. 회사='$($r.company)' 값='$edition'"
    }
    if ([string]::IsNullOrWhiteSpace($r.company) -and [string]::IsNullOrWhiteSpace($r.name)) {
        throw "회사명과 담당자가 모두 비어 있는 줄이 있습니다. 최소 하나는 적어 주세요."
    }

    # 발급기가 만드는 것과 같은 형식이라 고객이 헷갈리지 않는다. 48비트 무작위.
    $code = 'V5KO-' + ([Guid]::NewGuid().ToString('N').Substring(0, 12).ToUpperInvariant())

    [pscustomobject]@{
        Code    = $code
        Company = $r.company
        Name    = $r.name
        Phone   = $r.phone
        Email   = $r.email
        Edition = $edition
    }
}

function SqlText([string]$v) {
    if ([string]::IsNullOrWhiteSpace($v)) { return 'null' }
    return "'" + $v.Trim().Replace("'", "''") + "'"
}

$today = (Get-Date).ToString('yyyy-MM-dd')
$values = foreach ($p in $plan) {
    "  (upper(regexp_replace('$($p.Code)','[^A-Za-z0-9]','','g')), '$($p.Code)',
   $(SqlText $p.Name), $(SqlText $p.Company), $(SqlText $p.Phone), $(SqlText $p.Email),
   '$($p.Edition)', '$today', '마이그레이션 임시코드')"
}

Write-Host "`n===== 1. Supabase SQL Editor 에 붙여넣기 =====`n" -ForegroundColor Cyan
@"
insert into public.customers
  (code_key, license_id, name, company, phone, email, edition, issued_on, note)
values
$($values -join ",`n")
;

select license_id, company, name, edition, info_confirmed_at
  from public.customers
 where note like '마이그레이션%'
 order by company;
"@

Write-Host "`n===== 2. 고객별 안내 코드 =====`n" -ForegroundColor Cyan
$plan | Format-Table Company, Name, Edition, Code -AutoSize

Write-Host "안내 메일에는 그 고객의 코드 하나만 넣으십시오." -ForegroundColor DarkGray
Write-Host "고객 페이지: https://rcw-site.vercel.app/customer" -ForegroundColor DarkGray

if ($OutCsv) {
    $plan | Export-Csv -LiteralPath $OutCsv -NoTypeInformation -Encoding UTF8
    Write-Host "`n대조표 저장: $OutCsv" -ForegroundColor Green
    Write-Warning "이 파일은 고객 접근수단입니다. 메일 발송이 끝나면 지우십시오."
}
