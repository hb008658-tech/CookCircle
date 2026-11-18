$ErrorActionPreference = 'Stop'
$configPath = Join-Path $PSScriptRoot '.cookcircle-delivery-config.dpapi'

function Read-SecretText([string]$prompt) {
    $secureValue = Read-Host -Prompt $prompt -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

Write-Host 'CookCircle real verification delivery setup'
Write-Host 'Credentials are stored encrypted for this Windows account using DPAPI.'
$settings = [ordered]@{
    GMAIL_SMTP_USER = ''
    GMAIL_SMTP_APP_PASSWORD = ''
    RESEND_API_KEY = ''
    COOKCIRCLE_EMAIL_FROM = ''
    TWILIO_ACCOUNT_SID = ''
    TWILIO_API_KEY_SID = ''
    TWILIO_API_KEY_SECRET = ''
    TWILIO_AUTH_TOKEN = ''
    TWILIO_MESSAGING_SERVICE_SID = ''
    TWILIO_FROM = ''
}

$gmailChoice = Read-Host 'Configure Gmail email delivery (no domain required) now? (Y/N)'
if ($gmailChoice -match '^(y|yes)$') {
    $settings.GMAIL_SMTP_USER = Read-Host 'Your Gmail address'
    $settings.GMAIL_SMTP_APP_PASSWORD = Read-SecretText 'Google app password (16 characters)'
    if ($settings.GMAIL_SMTP_USER -notmatch '^\S+@gmail\.com$' -or -not $settings.GMAIL_SMTP_APP_PASSWORD) { throw 'Gmail setup needs a Gmail address and an app password.' }
} else {
    $emailChoice = Read-Host 'Configure Resend email instead? (Y/N)'
    if ($emailChoice -match '^(y|yes)$') {
        $settings.RESEND_API_KEY = Read-SecretText 'Resend sending API key'
        $settings.COOKCIRCLE_EMAIL_FROM = Read-Host 'Verified sender, e.g. CookCircle <verify@your-domain.com>'
        if (-not $settings.RESEND_API_KEY -or -not $settings.COOKCIRCLE_EMAIL_FROM) { throw 'Resend setup needs both the API key and a verified sender address.' }
    }
}

$smsChoice = Read-Host 'Configure real mobile SMS delivery now? (Y/N)'
if ($smsChoice -match '^(y|yes)$') {
    $settings.TWILIO_ACCOUNT_SID = Read-Host 'Twilio Account SID'
    $settings.TWILIO_API_KEY_SID = Read-Host 'Twilio API Key SID (leave blank to use the Auth Token)'
    if ($settings.TWILIO_API_KEY_SID) { $settings.TWILIO_API_KEY_SECRET = Read-SecretText 'Twilio API Key secret' }
    else { $settings.TWILIO_AUTH_TOKEN = Read-SecretText 'Twilio Auth Token' }
    $settings.TWILIO_MESSAGING_SERVICE_SID = Read-Host 'Twilio Messaging Service SID (recommended; leave blank to use a sender number)'
    if (-not $settings.TWILIO_MESSAGING_SERVICE_SID) { $settings.TWILIO_FROM = Read-Host 'Twilio sender phone number in international format' }
    if (-not $settings.TWILIO_ACCOUNT_SID -or (-not $settings.TWILIO_AUTH_TOKEN -and (-not $settings.TWILIO_API_KEY_SID -or -not $settings.TWILIO_API_KEY_SECRET)) -or (-not $settings.TWILIO_MESSAGING_SERVICE_SID -and -not $settings.TWILIO_FROM)) { throw 'SMS setup needs Account SID, authentication, and a Messaging Service SID or sender number.' }
}

if (-not $settings.GMAIL_SMTP_USER -and -not $settings.RESEND_API_KEY -and -not $settings.TWILIO_ACCOUNT_SID) { throw 'Choose Y for Gmail, Resend, mobile, or a combination. No settings were saved.' }
$json = ConvertTo-Json -InputObject $settings -Compress
$secureJson = ConvertTo-SecureString -String $json -AsPlainText -Force
$protectedJson = ConvertFrom-SecureString -SecureString $secureJson
[IO.File]::WriteAllText($configPath, $protectedJson, [Text.Encoding]::ASCII)
try { (Get-Item -LiteralPath $configPath -Force).Attributes = 'Hidden' } catch {}
Write-Host 'Delivery settings saved encrypted for this Windows account.'
Write-Host 'Now start CookCircle with .\start-cookcircle.cmd. Re-run this setup script only to change provider settings.'