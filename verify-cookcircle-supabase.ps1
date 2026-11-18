$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$caFile = Join-Path $root 'supabase-ca.crt'
if (-not (Test-Path -LiteralPath $caFile)) { throw 'supabase-ca.crt was not found beside the CookCircle files.' }

Write-Host 'This read-only check compares table totals. It does not change either database and does not need your CookCircle encryption keys.'
$connectionSecure = Read-Host 'Paste the full Supabase Session Pooler connection string (input hidden)' -AsSecureString
$connectionPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($connectionSecure)
$connectionString = $null
$result = 1
try {
    $connectionString = ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($connectionPointer)).Trim()
    if ($connectionString -notmatch '^postgres(?:ql)?://') { throw 'That does not look like a PostgreSQL connection string.' }
    if ($connectionString -match 'YOUR(?:[-_]DATABASE)?[-_]PASSWORD') { throw 'Replace the password placeholder with your Supabase database password first.' }
    $env:DATABASE_URL = $connectionString
    $env:COOKCIRCLE_DATABASE_CA_FILE = $caFile
    & node (Join-Path $root 'verify-sqlite-to-postgres.js')
    $result = $LASTEXITCODE
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($connectionPointer)
    $env:DATABASE_URL = $null
    $env:COOKCIRCLE_DATABASE_CA_FILE = $null
    $connectionString = $null
}
exit $result
