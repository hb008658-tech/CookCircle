$ErrorActionPreference = 'Stop'
$documentKeyFile = Join-Path $PSScriptRoot '.cookcircle-document-key.dpapi'
$documentKey = $null

if (Test-Path -LiteralPath $documentKeyFile) {
    try {
        $protectedKey = Get-Content -LiteralPath $documentKeyFile -Raw
        $secureKey = ConvertTo-SecureString -String $protectedKey
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
        try { $documentKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    } catch {
        throw 'Could not unlock the saved CookCircle key for this Windows account. Do not delete the key file; restore the same Windows account or saved key.'
    }
} elseif ($env:COOKCIRCLE_DOCUMENT_KEY -match '^[a-fA-F0-9]{64}$') {
    $documentKey = $env:COOKCIRCLE_DOCUMENT_KEY
} else {
    $documentKey = (& node -p "require('node:crypto').randomBytes(32).toString('hex')").Trim()
    if ($documentKey -notmatch '^[a-fA-F0-9]{64}$') { throw 'Could not generate a CookCircle document key.' }
}

if (-not (Test-Path -LiteralPath $documentKeyFile)) {
    $secureKey = ConvertTo-SecureString -String $documentKey -AsPlainText -Force
    $protectedKey = ConvertFrom-SecureString -SecureString $secureKey
    [System.IO.File]::WriteAllText($documentKeyFile, $protectedKey, [System.Text.Encoding]::ASCII)
    try { (Get-Item -LiteralPath $documentKeyFile -Force).Attributes = 'Hidden' } catch {}
}

$env:COOKCIRCLE_DOCUMENT_KEY = $documentKey
$deliveryConfigPath = Join-Path $PSScriptRoot '.cookcircle-delivery-config.dpapi'
if (Test-Path -LiteralPath $deliveryConfigPath) {
    try {
        $secureDeliveryConfig = ConvertTo-SecureString -String (Get-Content -LiteralPath $deliveryConfigPath -Raw)
        $deliveryPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureDeliveryConfig)
        try { $deliveryJson = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($deliveryPointer) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($deliveryPointer) }
        $deliveryConfig = ConvertFrom-Json -InputObject $deliveryJson
        foreach ($name in @('GMAIL_SMTP_USER','GMAIL_SMTP_APP_PASSWORD','RESEND_API_KEY','COOKCIRCLE_EMAIL_FROM','TWILIO_ACCOUNT_SID','TWILIO_API_KEY_SID','TWILIO_API_KEY_SECRET','TWILIO_AUTH_TOKEN','TWILIO_MESSAGING_SERVICE_SID','TWILIO_FROM')) {
            $value = $deliveryConfig.PSObject.Properties[$name].Value
            Set-Item -Path ('Env:' + $name) -Value ([string]$value)
        }
    } catch { throw 'Could not unlock CookCircle email/SMS settings for this Windows account. Run configure-cookcircle-delivery.ps1 again as this account.' }
}

Set-Location -LiteralPath $PSScriptRoot
Write-Host 'Starting CookCircle at http://localhost:3000'
Write-Host 'The encryption key is saved for this Windows account and is not displayed.'
Write-Host 'Backend mode: local SQLite by default; PostgreSQL when DATABASE_URL is configured.'
node .\cookcircle-server.js
