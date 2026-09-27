# Prepare a reviewable release without creating native installers.
param([string]$OutputDirectory = 'prepared-v8')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$target = [IO.Path]::GetFullPath((Join-Path $root $OutputDirectory))
if (-not $target.StartsWith($root + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Output must stay inside this project.' }
Push-Location $root
try {
  & npm.cmd run test:reliability
  if ($LASTEXITCODE -ne 0) { throw 'Client regression checks failed.' }
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
  & npm.cmd --prefix server run build
  if ($LASTEXITCODE -ne 0) { throw 'Server build failed.' }
  & npm.cmd --prefix server run test:unit
  if ($LASTEXITCODE -ne 0) { throw 'Server policy checks failed.' }
  & node scripts/package-prepared-release.mjs $target
  if ($LASTEXITCODE -ne 0) { throw 'Packaging failed.' }
} finally { Pop-Location }
