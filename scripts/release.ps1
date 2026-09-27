<# Build signed Windows packages only after the user resumes installer work. #>
param(
  [Parameter(Mandatory=$true)][string]$Version,
  [Parameter(Mandatory=$true)][string]$Notes,
  [switch]$BuildInstallers
)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
if (-not $BuildInstallers) { throw 'Installers are deferred. Use prepare-release.ps1, or explicitly pass -BuildInstallers after resuming native packaging.' }
$pkg=Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$config=Get-Content (Join-Path $root 'src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json
$server=Get-Content (Join-Path $root 'server/package.json') -Raw | ConvertFrom-Json
if ($Version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$' -or $Version -ne $pkg.version -or $Version -ne $config.version -or $Version -ne $server.version) { throw 'Set and review matching versions in the source first. This script never silently bumps versions.' }
if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
  $keyFile=Join-Path $root 'src-tauri/keys/update.key'
  if (-not (Test-Path -LiteralPath $keyFile)) { throw 'Existing updater signing key is required.' }
  $env:TAURI_SIGNING_PRIVATE_KEY=[IO.File]::ReadAllText($keyFile)
}
if ($null -eq $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) { $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD='' }
$env:CARGO_BUILD_JOBS='1'
$env:VITE_API_URL='https://zhivaya-skazka.ru'
Push-Location $root
try {
  & npm.cmd run test:reliability
  if ($LASTEXITCODE -ne 0) { throw 'Reliability checks failed.' }
  & npm.cmd run tauri -- build --bundles nsis
  if ($LASTEXITCODE -ne 0) { throw 'Native Windows build failed.' }
  $bundle=Join-Path $root 'src-tauri/target/release/bundle/nsis'
  $zip=Get-ChildItem -LiteralPath $bundle -Filter "*_${Version}_x64-setup.nsis.zip" | Select-Object -First 1
  if (-not $zip) { throw 'Expected updater ZIP is missing.' }
  $signaturePath=$zip.FullName+'.sig'
  if (-not (Test-Path -LiteralPath $signaturePath)) { throw 'Updater signature is missing.' }
  $release=Join-Path $root "releases/$Version"
  New-Item -ItemType Directory -Path $release -Force | Out-Null
  Copy-Item -LiteralPath $zip.FullName,$signaturePath -Destination $release -Force
  $manifest=@{version=$Version;notes=$Notes;pub_date=[DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ');platforms=@{'windows-x86_64'=@{signature=([IO.File]::ReadAllText($signaturePath)).Trim();url="https://zhivaya-skazka.ru/updates/operator-desktop/$($zip.Name)"}}}
  [IO.File]::WriteAllText((Join-Path $release 'latest.json'),($manifest | ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
  $exe=Get-ChildItem -LiteralPath $bundle -Filter "*_${Version}_x64-setup.exe" | Select-Object -First 1
  if ($exe) {
    Copy-Item -LiteralPath $exe.FullName -Destination $release -Force
    if (Test-Path -LiteralPath ($exe.FullName+'.sig')) { Copy-Item -LiteralPath ($exe.FullName+'.sig') -Destination $release -Force }
  }
  Get-ChildItem -LiteralPath $release -File | Get-FileHash -Algorithm SHA256 | Select-Object Path,Hash
  Write-Output "Prepared only: $release. No upload or update channel publication was performed."
} finally { Pop-Location }
