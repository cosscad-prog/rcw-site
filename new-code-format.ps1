<#
  고객 코드 새 형식 발급 — RCW-XXXX-XXXX-XXXX

  왜 바꾸는가 (2026-08-24 사용자 결정)
    옛 고객 코드(V5KO-…)와 라이선스 파일 번호(V5KO-…)가 **같은 모양**이라 고객이
    무엇으로 로그인해야 하는지 구분할 수 없었다. 실제로 .lic 이름으로 로그인하는
    고객이 생겼다. 고객 코드를 RCW- 로 바꾸면 V5KO- 는 라이선스 전용이 되어 갈린다.

  ★ 옛 코드는 계속 통한다.
    이 스크립트가 만드는 SQL 은 옛 코드를 legacy_code_key 로 옮겨 둔다.
    api/customer-login.js 가 새 코드 → 없으면 옛 코드 순으로 찾는다.
    고객 메일함에는 옛 코드가 영원히 남으므로 지우지 않는다.

  ★ 글자 집합에서 0 O 1 I L 을 뺐다.
    전화로 불러 주거나 손으로 옮겨 적을 때 그 글자들이 사고를 낸다.
    남은 30자로도 12자리면 5.3e17 가지라 충분하다.

  쓰는 법
    # 1) 관리자 화면에서 내려받은 CSV 를 준다
    .\new-code-format.ps1 -CsvPath 'C:\std\XTemp_image\rcw-customers-2026-08-23.csv'

    # 2) 화면에 나오는 것
    #    · Supabase SQL Editor 에 붙여넣을 UPDATE 문
    #    · 고객별 대조표(회사·담당자·옛코드·새코드) — 메일 보낼 때 쓴다
    #    · 발급 원장(license-ledger.json) 갱신용 매핑

  ⚠ 시험용·개발용 줄은 건너뛴다(회사com1·회사com2·jcs). -All 을 주면 전부 처리한다.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $CsvPath,

    # 대조표를 파일로도 남긴다(메일 머지용).
    [string] $OutCsv,

    # 시험용·개발용 줄까지 전부 처리한다.
    [switch] $All
)

$ErrorActionPreference = 'Stop'

# 0 O 1 I L 을 뺀 30자. 코드를 눈으로 읽고 옮겨 적을 수 있어야 한다.
$Alphabet = '23456789ABCDEFGHJKMNPQRSTVWXYZ'.ToCharArray()
$Skip = @('회사com1', '회사com2', 'jcs')

function New-CustomerCode {
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes = New-Object byte[] 12
    $rng.GetBytes($bytes)
    $rng.Dispose()
    $chars = foreach ($b in $bytes) { $Alphabet[$b % $Alphabet.Length] }
    $s = -join $chars
    return 'RCW-' + $s.Substring(0, 4) + '-' + $s.Substring(4, 4) + '-' + $s.Substring(8, 4)
}

function Normalize([string] $code) {
    return ($code -replace '[^A-Za-z0-9]', '').ToUpperInvariant()
}

$rows = Import-Csv -LiteralPath $CsvPath
$made = @{}
$result = New-Object System.Collections.Generic.List[object]

foreach ($r in $rows) {
    $name = $r.'담당자'
    if (-not $All -and ($Skip -contains $name)) { continue }
    if ([string]::IsNullOrWhiteSpace($r.'코드')) { continue }

    # 같은 실행 안에서 겹치지 않게 한다(우연은 사실상 없지만 확인은 공짜다).
    do { $code = New-CustomerCode } while ($made.ContainsKey($code))
    $made[$code] = $true

    $result.Add([pscustomobject]@{
        회사     = $r.'회사'
        담당자   = $name
        옛코드   = $r.'코드'
        새코드   = $code
        옛키     = Normalize $r.'코드'
        새키     = Normalize $code
        기기코드 = $r.'기기코드'
    })
}

Write-Host "`n===== 1. Supabase SQL Editor 에 붙여넣기 =====" -ForegroundColor Cyan
Write-Host "-- 먼저 한 번만: 옛 코드를 담을 칸을 만든다" -ForegroundColor DarkGray
@"
alter table public.customers add column if not exists legacy_code_key text;
create index if not exists customers_legacy_code_key_idx on public.customers (legacy_code_key);
"@
Write-Host "`n-- 고객별 코드 교체 (옛 코드는 legacy_code_key 로 옮긴다)" -ForegroundColor DarkGray
foreach ($x in $result) {
    @"
update public.customers
   set legacy_code_key = coalesce(legacy_code_key, code_key),
       code_key        = '$($x.새키)',
       license_id      = '$($x.새코드)'
 where code_key = '$($x.옛키)';
"@
}
Write-Host "`n-- 확인" -ForegroundColor DarkGray
"select company, name, license_id, legacy_code_key from public.customers order by company, name;"

Write-Host "`n===== 2. 고객별 대조표 (메일용) =====`n" -ForegroundColor Cyan
$result | Format-Table 회사, 담당자, 옛코드, 새코드 -AutoSize

Write-Host "`n===== 3. 발급 원장 갱신용 매핑 =====`n" -ForegroundColor Cyan
Write-Host "license-ledger.json 의 CustomerCode 를 옛 값에서 새 값으로 바꾼다." -ForegroundColor DarkGray
foreach ($x in $result) { "  $($x.옛코드)  ->  $($x.새코드)   ($($x.회사) $($x.담당자))" }

if ($OutCsv) {
    $result | Export-Csv -LiteralPath $OutCsv -NoTypeInformation -Encoding UTF8
    Write-Host "`n대조표 저장: $OutCsv" -ForegroundColor Green
    Write-Warning "이 파일은 고객 접근수단입니다. 보관에 주의하십시오."
}

Write-Host "`n확인할 것" -ForegroundColor Yellow
"  · SQL 을 돌리기 전에 원장 백업이 있는가 (license-ledger.json.*.bak)"
"  · SQL 을 돌린 뒤 원장의 CustomerCode 도 같은 매핑으로 바꿨는가 — 안 바꾸면 1대 판정이 헛돈다"
"  · 옛 코드는 계속 통한다(legacy_code_key). 고객이 옛 메일을 봐도 들어올 수 있다"
