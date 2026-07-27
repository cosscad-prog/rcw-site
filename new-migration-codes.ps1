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
    [string] $OutCsv
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $CsvPath)) { throw "고객 목록 파일이 없습니다: $CsvPath" }

$rows = @(Import-Csv -LiteralPath $CsvPath)
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
