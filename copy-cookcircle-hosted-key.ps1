$ErrorActionPreference = 'Stop'
$keyFile = Join-Path $PSScriptRoot '.cookcircle-hosted-document-key.dpapi'
if (-not (Test-Path -LiteralPath $keyFile)) { throw 'The hosted key is created only after the migration succeeds.' }
$secureKey = ConvertTo-SecureString -String (Get-Content -LiteralPath $keyFile -Raw)
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
    $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if ($key -notmatch '^[a-fA-F0-9]{64}$') { throw 'The saved hosted key is invalid.' }
    Set-Clipboard -Value $key
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $key = $null; $secureKey = $null
}
Write-Host 'New hosted CookCircle document key copied to Clipboard. Paste it only into Render COOKCIRCLE_DOCUMENT_KEY.'
