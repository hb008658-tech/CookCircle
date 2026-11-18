$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$oldKeyFile = Join-Path $root '.cookcircle-document-key.dpapi'
$newKeyFile = Join-Path $root '.cookcircle-hosted-document-key.dpapi'
$sourceDb = Join-Path $root 'cookcircle.sqlite'
$caFile = Join-Path $root 'supabase-ca.crt'

if (-not (Test-Path -LiteralPath $sourceDb)) { throw 'The local cookcircle.sqlite database was not found.' }
if (-not (Test-Path -LiteralPath $oldKeyFile)) { throw 'The saved local encryption key was not found. Do not delete it; migration needs it to decrypt existing cook data.' }
if (-not (Test-Path -LiteralPath $caFile)) { throw 'Download the Supabase CA certificate from Project Settings - Database - SSL Configuration, save it as supabase-ca.crt in this outputs folder, then run this file again.' }
if (-not (Select-String -LiteralPath $caFile -Pattern '-----BEGIN CERTIFICATE-----' -Quiet)) { throw 'supabase-ca.crt must be the PEM certificate downloaded from Supabase Database SSL Configuration.' }

Write-Host 'This copies your local CookCircle records to the empty Supabase database.'
Write-Host 'Close the CookCircle server first. Do not share the connection string or either key.'
$confirmation = Read-Host 'Type MIGRATE to continue'
if ($confirmation -cne 'MIGRATE') { Write-Host 'Cancelled; no data was copied.'; exit 2 }

$backupRoot = Join-Path $env:USERPROFILE 'Documents\CookCircle-Backups'
$backupFolder = Join-Path $backupRoot (Get-Date -Format 'yyyyMMdd-HHmmss')
New-Item -ItemType Directory -Path $backupFolder -Force | Out-Null
foreach ($file in @($sourceDb, "$sourceDb-wal", "$sourceDb-shm")) {
    if (Test-Path -LiteralPath $file) { Copy-Item -LiteralPath $file -Destination $backupFolder -Force }
}
Write-Host "Private SQLite backup saved in: $backupFolder"

$connectionSecure = Read-Host 'Paste the full Supabase Session Pooler connection string (input hidden)' -AsSecureString
$connectionPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($connectionSecure)
$connectionString = $null
$oldKey = $null
$newKey = $null
try {
    $connectionString = ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($connectionPointer)).Trim()
    if ($connectionString -notmatch '^postgres(?:ql)?://') { throw 'That does not look like a PostgreSQL connection string.' }
    if ($connectionString -match 'YOUR(?:[-_]DATABASE)?[-_]PASSWORD') { throw 'Replace the password placeholder with your Supabase database password before running migration.' }

    $protectedOldKey = Get-Content -LiteralPath $oldKeyFile -Raw
    $secureOldKey = ConvertTo-SecureString -String $protectedOldKey
    $oldPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureOldKey)
    try { $oldKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($oldPointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($oldPointer) }
    if ($oldKey -notmatch '^[a-fA-F0-9]{64}$') { throw 'The saved local key could not be unlocked.' }

    if (Test-Path -LiteralPath $newKeyFile) {
        $newProtected = Get-Content -LiteralPath $newKeyFile -Raw
        $newSecure = ConvertTo-SecureString -String $newProtected
        $newPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($newSecure)
        try { $newKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($newPointer) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($newPointer) }
    } else {
        $newKey = (& node -p "require('node:crypto').randomBytes(32).toString('hex')").Trim()
        if ($newKey -notmatch '^[a-fA-F0-9]{64}$') { throw 'Could not create a replacement encryption key.' }
        $newSecure = ConvertTo-SecureString -String $newKey -AsPlainText -Force
        $newProtected = ConvertFrom-SecureString -SecureString $newSecure
        [System.IO.File]::WriteAllText($newKeyFile, $newProtected, [System.Text.Encoding]::ASCII)
        try { (Get-Item -LiteralPath $newKeyFile -Force).Attributes = 'Hidden' } catch {}
    }
    if ($newKey -notmatch '^[a-fA-F0-9]{64}$' -or $newKey -eq $oldKey) { throw 'Could not create a replacement encryption key.' }

    $env:DATABASE_URL = $connectionString
    $env:COOKCIRCLE_OLD_DOCUMENT_KEY = $oldKey
    $env:COOKCIRCLE_DOCUMENT_KEY = $newKey
    $env:COOKCIRCLE_PHONE_HASH_KEY = $oldKey
    $env:COOKCIRCLE_SOURCE_DB = $sourceDb
    $env:COOKCIRCLE_DATABASE_CA_FILE = $caFile
    & node (Join-Path $root 'migrate-sqlite-to-postgres.js')
    if ($LASTEXITCODE -ne 0) { throw 'Migration did not complete. The local database is unchanged; check the message above and ask for help before retrying.' }

    try { Set-Clipboard -Value $newKey; Write-Host 'The NEW hosted document key is copied to Clipboard for Render.' }
    catch { Write-Host 'Migration succeeded. Clipboard access was unavailable; run copy-cookcircle-hosted-key.cmd when entering Render settings.' }
    Write-Host 'Use the existing local key for Render COOKCIRCLE_PHONE_HASH_KEY to keep existing mobile logins working.'
    Write-Host 'The local cookcircle.sqlite file and its original key were not changed.'
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($connectionPointer)
    $env:DATABASE_URL = $null
    $env:COOKCIRCLE_OLD_DOCUMENT_KEY = $null
    $env:COOKCIRCLE_DOCUMENT_KEY = $null
    $env:COOKCIRCLE_PHONE_HASH_KEY = $null
    $env:COOKCIRCLE_SOURCE_DB = $null
    $env:COOKCIRCLE_DATABASE_CA_FILE = $null
    $connectionString = $null; $oldKey = $null; $newKey = $null
}
