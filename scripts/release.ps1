<#
.SYNOPSIS
  Выпуск новой версии Zhivaya-Skazka-Operator одной командой.
.DESCRIPTION
  1) проверяет ключ подписи; 2) бампит версию в package.json и tauri.conf.json;
  3) собирает tauri build; 4) копирует .zip+.sig в releases/;
  5) генерирует releases/latest.json и печатает команды деплоя на сервер.
.EXAMPLE
  powershell -NoProfile -File scripts\release.ps1 -Version 5.1.6 -Notes "Описание релиза"
#>
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$Notes
)
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
  $keyFile = Join-Path $root "src-tauri\keys\update.key"
  if (Test-Path $keyFile) {
    $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $keyFile -Raw
    if ($null -eq $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) { $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "" }
    Write-Host "Ключ подписи взят из src-tauri\keys\update.key" -ForegroundColor Yellow
  } else {
    throw "TAURI_SIGNING_PRIVATE_KEY не задан и нет файла src-tauri\keys\update.key — без ключа обновление не будет подписано."
  }
}
# гарантируем непустое (но возможно пустой пароль) значение, чтобы tauri не спрашивал интерактивно
if ($null -eq $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) { $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "" }

Write-Host "=== Релиз v$Version ===" -ForegroundColor Cyan

# 1. версия в package.json
$pkgPath = Join-Path $root "package.json"
$pkg = Get-Content $pkgPath -Raw
$pkg = $pkg -replace '("version":\s*")[0-9]+\.[0-9]+\.[0-9]+(")', "`${1}$Version`${2}"
[System.IO.File]::WriteAllText($pkgPath, $pkg, (New-Object System.Text.UTF8Encoding($false)))

# 2. версия в tauri.conf.json
$confPath = Join-Path $root "src-tauri\tauri.conf.json"
$conf = Get-Content $confPath -Raw
$conf = $conf -replace '("version":\s*")[0-9]+\.[0-9]+\.[0-9]+(")', "`${1}$Version`${2}"
[System.IO.File]::WriteAllText($confPath, $conf, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Версия проставлена в package.json и tauri.conf.json" -ForegroundColor Green

# 3. сборка
Write-Host "Сборка (npm run tauri build)…" -ForegroundColor Cyan
Push-Location $root
npm run tauri build
$buildExit = $LASTEXITCODE
Pop-Location
if ($buildExit -ne 0) { throw "tauri build завершился с ошибкой ($buildExit)" }

# 4. копирование артефактов
$bundle = Join-Path $root "src-tauri\target\release\bundle\nsis"
$zip = Get-ChildItem $bundle -Filter "*_${Version}_x64-setup.nsis.zip" | Select-Object -First 1
$sig = Get-ChildItem $bundle -Filter "*_${Version}_x64-setup.nsis.zip.sig" | Select-Object -First 1
if (-not $zip -or -not $sig) { throw "Не найдены артефакты сборки для версии $Version в $bundle" }
$rel = Join-Path $root "releases"
if (-not (Test-Path $rel)) { New-Item -ItemType Directory $rel | Out-Null }
Copy-Item $zip.FullName $rel -Force
Copy-Item $sig.FullName $rel -Force

# 5. latest.json
$signature = (Get-Content $sig.FullName -Raw).Trim()
$pub = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$json = @"
{
  "version": "$Version",
  "notes": "$Notes",
  "pub_date": "$pub",
  "platforms": {
    "windows-x86_64": {
      "signature": "$signature",
      "url": "https://zhivaya-skazka.ru/updates/operator-desktop/$($zip.Name)"
    }
  }
}
"@
$outJson = Join-Path $rel "latest.json"
[System.IO.File]::WriteAllText($outJson, $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "`n=== latest.json готов: $outJson ===" -ForegroundColor Green
Write-Host "`nДеплой на сервер (бэкап + загрузка):" -ForegroundColor Cyan
Write-Host "ssh root@5.129.241.152 'cp /var/www/updates/operator-desktop/latest.json /var/www/updates/operator-desktop/latest.json.bak'"
Write-Host "scp `"$($zip.FullName)`" `"$($sig.FullName)`" `"$outJson`" root@5.129.241.152:/var/www/updates/operator-desktop/"
Write-Host "`nПроверка:" -ForegroundColor Cyan
Write-Host "curl `"https://zhivaya-skazka.ru/api/updater/check?current_version=5.1.5`""
