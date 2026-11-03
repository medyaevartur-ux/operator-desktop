# One-time setup of the secrets and variables used by .github/workflows/release.yml.
# Values are read from the local key files and piped straight into gh, which trims the trailing
# line break; nothing is printed. Run: powershell -NoProfile -File scripts/set-github-secrets.ps1
$ErrorActionPreference = 'Stop'
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
Set-Location (Split-Path -Parent $PSScriptRoot)
$props = 'src-tauri/gen/android/keystore.properties'

function Prop([string]$Name) {
  $match = Select-String -LiteralPath $props -Pattern ('^' + $Name + '=(.*)$')
  if (-not $match) { throw "$Name is missing in $props" }
  return $match.Matches[0].Groups[1].Value.TrimEnd()
}

function Put([string]$Kind, [string]$Name, [string]$Value) {
  if (-not $Value) { throw "$Name is empty" }
  $Value | gh $Kind set $Name
  if ($LASTEXITCODE -ne 0) { throw "gh $Kind set $Name failed" }
  Write-Output "set $Kind $Name"
}

Put 'secret' 'TAURI_SIGNING_PRIVATE_KEY' (Get-Content -Raw -LiteralPath 'src-tauri/keys/update.key').Trim()
Put 'secret' 'ANDROID_KEYSTORE_PASSWORD' (Prop 'storePassword')
Put 'secret' 'ANDROID_KEY_PASSWORD' (Prop 'keyPassword')
Put 'variable' 'ANDROID_KEY_ALIAS' (Prop 'keyAlias')
# Public fingerprint of the certificate that signed the APKs already installed (checked with apksigner on beta.8).
Put 'variable' 'ANDROID_CERT_SHA256' 'f597838848896c60c23e1bb9f4df1e55b8286e7f0fd96d48f0969135d7b16b32'
