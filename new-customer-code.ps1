<#
  고객 코드 만들기 (한 명)

  신규 고객이 생겼을 때 쓴다. 코드 하나를 만들고, 명부에 넣을 INSERT 문과
  메일에 넣을 코드를 보여준다.

  ★ 코드를 만드는 것이 곧 제품을 인도하는 것이다.
    이 코드 하나로 고객은 설치 파일을 받고, 머신코드를 올려 라이선스까지 자동으로
    받는다. 그러니 **입금이 확인된 뒤에** 만든다.

  ★ 에디션을 여기서 정한다.
    Core 를 산 고객에게 Standard 로 만들면 그 고객은 Standard 를 받고 Standard
    라이선스까지 발급된다. 뒤에서 막아주는 장치가 없다 — 여기가 유일한 관문이다.

  쓰는 법
    .\new-customer-code.ps1 -Company "(주)새고객" -Edition Standard
    .\new-customer-code.ps1 -Company "(주)새고객" -Name 홍길동 -Phone 010-1111-2222 `
                            -Email hong@x.co.kr -Edition Core

    여러 명을 한꺼번에 만들 때는 new-migration-codes.ps1 (CSV) 를 쓴다.
#>

[CmdletBinding()]
param(
    [string] $Company,

    [string] $Name,

    [string] $Phone,

    [string] $Email,

    [Parameter(Mandatory = $true)]
    [ValidateSet('Core', 'Standard')]
    [string] $Edition,

    # 명부의 note 칸. 나중에 "언제 어떤 경로로 들어온 고객인지" 구분하는 값이다.
    [string] $Note,

    # 만든 코드를 대조표에 덧붙인다(선택). 기존 파일이 있으면 줄만 추가한다.
    [string] $AppendCsv
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($Company) -and [string]::IsNullOrWhiteSpace($Name)) {
    throw "회사명이나 담당자 이름 중 최소 하나는 주셔야 합니다. -Company 또는 -Name"
}

# 고객 코드 형식: RCW-XXXX-XXXX-XXXX (2026-08-24 부터)
#   ★ 전에는 V5KO- 였는데 **라이선스 파일(.lic) 번호와 모양이 같아** 고객이
#     무엇으로 로그인하는지 구분하지 못했다. 실제로 .lic 이름으로 들어오는 고객이 생겼다.
#     이제 고객 코드는 RCW-, 라이선스 번호는 V5KO- 로 갈린다.
#   ★ 글자에서 0 O 1 I L 을 뺐다 — 전화로 불러 주거나 손으로 옮겨 적을 때 사고를 낸다.
$alphabet = '23456789ABCDEFGHJKMNPQRSTVWXYZ'.ToCharArray()
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = New-Object byte[] 12
$rng.GetBytes($bytes); $rng.Dispose()
$picked = -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
$code = 'RCW-' + $picked.Substring(0, 4) + '-' + $picked.Substring(4, 4) + '-' + $picked.Substring(8, 4)
$today = (Get-Date).ToString('yyyy-MM-dd')
if ([string]::IsNullOrWhiteSpace($Note)) { $Note = "신규 $today" }

function SqlText([string]$v) {
    if ([string]::IsNullOrWhiteSpace($v)) { return 'null' }
    return "'" + $v.Trim().Replace("'", "''") + "'"
}

Write-Host "`n===== 1. Supabase SQL Editor 에 붙여넣기 =====`n" -ForegroundColor Cyan
@"
insert into public.customers
  (code_key, license_id, name, company, phone, email, edition, issued_on, note)
values
  (upper(regexp_replace('$code','[^A-Za-z0-9]','','g')), '$code',
   $(SqlText $Name), $(SqlText $Company), $(SqlText $Phone), $(SqlText $Email),
   '$Edition', '$today', $(SqlText $Note));

select license_id, company, name, edition, note
  from public.customers
 where license_id = '$code';
"@

Write-Host "`n===== 2. 고객에게 보낼 코드 =====`n" -ForegroundColor Cyan
"  회사    : $(if ($Company) { $Company } else { '(없음)' })"
"  담당자  : $(if ($Name) { $Name } else { '(없음)' })"
"  에디션  : $Edition"
"  코드    : $code"
""
Write-Host "  고객 페이지: https://rcw-site.vercel.app/customer" -ForegroundColor DarkGray
Write-Host "  메일 문안  : docs\MIGRATION_EMAIL_ko.md" -ForegroundColor DarkGray

Write-Host "`n확인할 것" -ForegroundColor Yellow
"  · 입금이 확인된 고객인가"
"  · 에디션이 $Edition 가 맞는가 (이 값이 받게 될 파일과 라이선스를 정한다)"
"  · 고객이 머신코드를 올릴 때 발급기의 [자동 발급 대기] 가 켜져 있어야 한다"

if ($AppendCsv) {
    $row = [pscustomobject]@{
        Code = $code; Company = $Company; Name = $Name
        Phone = $Phone; Email = $Email; Edition = $Edition; Issued = $today
    }
    if (Test-Path -LiteralPath $AppendCsv) {
        $row | Export-Csv -LiteralPath $AppendCsv -NoTypeInformation -Encoding UTF8 -Append
    }
    else {
        $row | Export-Csv -LiteralPath $AppendCsv -NoTypeInformation -Encoding UTF8
    }
    Write-Host "`n대조표에 추가: $AppendCsv" -ForegroundColor Green
    Write-Warning "이 파일은 고객 접근수단입니다. 보관에 주의하십시오."
}
