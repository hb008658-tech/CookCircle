$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$currentKeyFile = Join-Path $root '.cookcircle-hosted-document-key.dpapi'
$nextKeyFile = Join-Path $root '.cookcircle-hosted-document-key-next.dpapi'
$previousKeyFile = Join-Path $root '.cookcircle-hosted-document-key-previous.dpapi'
$caFile = Join-Path $root 'supabase-ca.crt'
$nodeFile = Join-Path $root 'rotate-cookcircle-hosted-key.js'

if (-not (Test-Path -LiteralPath $currentKeyFile)) { throw 'The current hosted key was not found on this Windows account.' }
if (-not (Test-Path -LiteralPath $caFile)) { throw 'supabase-ca.crt is missing from the CookCircle folder.' }
if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules\pg'))) { throw 'PostgreSQL support is not installed in this folder. Open PowerShell here and run npm install first.' }
if (Test-Path -LiteralPath $previousKeyFile) { throw 'A previous hosted key backup already exists. Do not overwrite it; ask for help before rotating again.' }

Write-Host 'This safely replaces the hosted encryption key for CookCircle cook photos, contact details, and identity documents.'
Write-Host 'Keep your Render service stopped or not yet deployed during this step. Never send the connection string or keys in chat.'
$confirm = Read-Host 'Type ROTATE to continue'
if ($confirm -cne 'ROTATE') { Write-Host 'Cancelled; Supabase was not changed.'; exit 2 }

$backupDir = Join-Path $env:USERPROFILE ('Documents\CookCircle-Key-Rotation-Backups\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$backupFile = Join-Path $backupDir 'encrypted-records-before-rotation.json'
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
try {
    $acl = Get-Acl -LiteralPath $backupDir
    $acl.SetAccessRuleProtection($true, $false)
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $backupDir -AclObject $acl
} catch { Write-Host 'Could not set a private backup-folder permission; it remains in your Windows Documents folder.' }

$connectionSecure = Read-Host 'Paste your full Supabase Session Pooler connection string (hidden input)' -AsSecureString
$connectionPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($connectionSecure)
$connection = $null
$oldKey = $null
$newKey = $null
try {
    $connection = ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($connectionPointer)).Trim()
    if ($connection -notmatch '^postgres(?:ql)?://') { throw 'That does not look like a PostgreSQL connection string.' }
    if ($connection -match 'YOUR(?:[-_]DATABASE)?[-_]PASSWORD') { throw 'Replace the password placeholder with your real Supabase database password.' }

    $oldProtected = Get-Content -LiteralPath $currentKeyFile -Raw
    $oldSecure = ConvertTo-SecureString -String $oldProtected
    $oldPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($oldSecure)
    try { $oldKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($oldPointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($oldPointer) }
    if ($oldKey -notmatch '^[a-fA-F0-9]{64}$') { throw 'The saved current hosted key could not be unlocked on this Windows account.' }

    $newKey = (& node -p "require('node:crypto').randomBytes(32).toString('hex')" 2>$null).Trim()
    if ($LASTEXITCODE -ne 0 -or $newKey -notmatch '^[a-fA-F0-9]{64}$' -or $newKey -eq $oldKey) { throw 'Could not create a fresh hosted key. Make sure Node.js is installed.' }
    $newSecure = ConvertTo-SecureString -String $newKey -AsPlainText -Force
    $newProtected = ConvertFrom-SecureString -SecureString $newSecure
    [System.IO.File]::WriteAllText($nextKeyFile, $newProtected, [System.Text.Encoding]::ASCII)
    try { (Get-Item -LiteralPath $nextKeyFile -Force).Attributes = 'Hidden' } catch {}

    $env:DATABASE_URL = $connection
    $env:COOKCIRCLE_OLD_DOCUMENT_KEY = $oldKey
    $env:COOKCIRCLE_NEW_DOCUMENT_KEY = $newKey
    $env:COOKCIRCLE_KEY_ROTATION_BACKUP = $backupFile
    $env:COOKCIRCLE_DATABASE_CA_FILE = $caFile
    & node $nodeFile
    if ($LASTEXITCODE -ne 0) { throw 'Rotation did not complete. The database transaction was rolled back; leave Render on the current key and ask for help.' }

    Copy-Item -LiteralPath $currentKeyFile -Destination $previousKeyFile
    Move-Item -LiteralPath $nextKeyFile -Destination $currentKeyFile -Force
    try { Set-Clipboard -Value $newKey; Write-Host 'The fresh key is copied to Clipboard. Paste it into Render COOKCIRCLE_DOCUMENT_KEY, then save and redeploy.' }
    catch { Write-Host 'Rotation succeeded. Clipboard was unavailable; run copy-cookcircle-hosted-key.cmd to copy the fresh key.' }
    Write-Host "Keep the old encrypted-record backup and old DPAPI key safe. Backup folder: $backupDir"
    Write-Host 'COOKCIRCLE_PHONE_HASH_KEY is unchanged; keep its existing Render value.'
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($connectionPointer)
    $env:DATABASE_URL = $null
    $env:COOKCIRCLE_OLD_DOCUMENT_KEY = $null
    $env:COOKCIRCLE_NEW_DOCUMENT_KEY = $null
    $env:COOKCIRCLE_KEY_ROTATION_BACKUP = $null
    $env:COOKCIRCLE_DATABASE_CA_FILE = $null
    $connection = $null; $oldKey = $null; $newKey = $null
}
