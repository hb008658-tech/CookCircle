$ErrorActionPreference = 'Stop'
$keyFile = Join-Path $PSScriptRoot '.cookcircle-document-key.dpapi'

if (-not (Test-Path -LiteralPath $keyFile)) {
    throw 'CookCircle key file was not found. Run start-cookcircle.cmd once on this Windows account first.'
}

$protectedKey = Get-Content -LiteralPath $keyFile -Raw
$secureKey = ConvertTo-SecureString -String $protectedKey
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
    $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if ($key -notmatch '^[a-fA-F0-9]{64}$') { throw 'The saved CookCircle key is not a valid 64-character key.' }
    Set-Clipboard -Value $key
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $key = $null
    $secureKey = $null
}

Write-Host 'Previous CookCircle key copied to Clipboard. For an imported database, use it only as Render COOKCIRCLE_PHONE_HASH_KEY; the migration creates a new COOKCIRCLE_DOCUMENT_KEY.'
