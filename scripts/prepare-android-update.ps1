# Inspect an already signed APK and prepare its update metadata; never builds, installs or publishes.
param(
  [Parameter(Mandatory=$true)][string]$ApkPath,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9:]{64,95}$')][string]$ExpectedCertificateSha256,
  [string]$Notes=''
)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$apk=(Resolve-Path -LiteralPath $ApkPath).Path
if (-not $apk.StartsWith($root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetExtension($apk) -ne '.apk') { throw 'Choose an existing APK inside this project.' }
$buildTools=Join-Path $env:LOCALAPPDATA 'Android/Sdk/build-tools'
$androidTools=Get-ChildItem -LiteralPath $buildTools -Directory | Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' } | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (-not $androidTools) { throw 'Android build-tools are missing.' }
$badging=& (Join-Path $androidTools.FullName 'aapt.exe') dump badging $apk
if ($LASTEXITCODE -ne 0) { throw 'APK metadata cannot be read.' }
$match=[regex]::Match(($badging -join "`n"),"package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'")
if (-not $match.Success -or $match.Groups[1].Value -ne 'ru.zhivaya_skazka.operator') { throw 'Wrong Android application ID.' }
$config=Get-Content (Join-Path $root 'src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json
$version=$match.Groups[3].Value
$code=[long]$match.Groups[2].Value
if ($version -ne $config.version -or $code -ne $config.bundle.android.versionCode) { throw 'APK version does not match reviewed source.' }
$certificates=& (Join-Path $androidTools.FullName 'apksigner.bat') verify --print-certs $apk 2>&1
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
$found=[regex]::Matches(($certificates -join "`n"),'certificate SHA-256 digest:\s*([a-fA-F0-9]+)')
$expected=$ExpectedCertificateSha256.Replace(':','').ToLowerInvariant()
if ($found.Count -ne 1 -or $found[0].Groups[1].Value.ToLowerInvariant() -ne $expected) { throw 'APK was not signed by the expected existing release certificate.' }
$size=(Get-Item -LiteralPath $apk).Length
if ($size -gt 250MB) { throw 'APK exceeds updater size limit.' }
$release=Join-Path $root "releases/$version"
New-Item -ItemType Directory -Path $release -Force | Out-Null
$name="operator-$version-arm64.apk"
Copy-Item -LiteralPath $apk -Destination (Join-Path $release $name) -Force
$manifest=@{version=$version;version_code=$code;size=$size;sha256=(Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant();url="https://zhivaya-skazka.ru/updates/operator-desktop/$name";notes=$Notes}
[IO.File]::WriteAllText((Join-Path $release 'android-latest.json'),($manifest | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
Write-Output "Prepared Android manifest: $release. Nothing installed or published."
