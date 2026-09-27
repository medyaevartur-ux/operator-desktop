param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-fA-F0-9]{64}$')]
  [string]$ExpectedRemoteSha,
  [string]$SourcePath = 'widget.js',
  [string]$BundlePath = 'widget.min.js'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$sourceFile = [IO.Path]::GetFullPath((Join-Path $root $SourcePath))
$bundleFile = [IO.Path]::GetFullPath((Join-Path $root $BundlePath))
foreach ($artifact in @($sourceFile, $bundleFile)) {
  if (-not $artifact.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetExtension($artifact) -ne '.js') {
    throw 'Widget artifact must be a JavaScript file inside this project.'
  }
}
$sourceSha = (Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash.ToLowerInvariant()
$bundleSha = (Get-FileHash -LiteralPath $bundleFile -Algorithm SHA256).Hash.ToLowerInvariant()
$requiresV8 = (Get-Content -LiteralPath $sourceFile -Raw).Contains('/api/widget/identity')
if ($requiresV8) {
  $probe = @'
import json, urllib.request
with urllib.request.urlopen('http://127.0.0.1:3010/api/chat-v8/meta', timeout=8) as response:
    meta = json.load(response)
if not meta.get('socket_auth_required') or not str(meta.get('version', '')).startswith('8.'):
    raise SystemExit('Activate the compatible v8 chat server before publishing its widget')
print('Compatible v8 backend confirmed')
'@
  $probe | ssh -o BatchMode=yes -o ConnectTimeout=12 -o StrictHostKeyChecking=yes root@5.129.241.152 'python3 -'
  if ($LASTEXITCODE -ne 0) { throw 'This widget requires the v8 backend. No files were uploaded.' }
}
$incoming = "/var/www/widget/.codex-$stamp"
scp -o BatchMode=yes -o ConnectTimeout=12 -o StrictHostKeyChecking=yes $sourceFile "root@5.129.241.152:${incoming}.source.js"
if ($LASTEXITCODE -ne 0) { throw 'Source upload failed.' }
scp -o BatchMode=yes -o ConnectTimeout=12 -o StrictHostKeyChecking=yes $bundleFile "root@5.129.241.152:${incoming}.min.js"
if ($LASTEXITCODE -ne 0) { throw 'Bundle upload failed.' }
$remoteScript = @'
import hashlib, json, os, pathlib, shutil, sys
stamp, expected, source_sha, bundle_sha = sys.argv[1:]
root = pathlib.Path('/var/www/widget')
incoming_source = root / ('.codex-' + stamp + '.source.js')
incoming_bundle = root / ('.codex-' + stamp + '.min.js')
digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
if digest(root / 'widget.min.js') != expected.lower():
    raise SystemExit('Remote widget changed since baseline; refusing to replace')
if digest(incoming_source) != source_sha or digest(incoming_bundle) != bundle_sha:
    raise SystemExit('Uploaded artifact digest mismatch')
backup = pathlib.Path('/var/backups/zhivaya-chat-codex') / (stamp + '-widget')
backup.mkdir(parents=True, mode=0o700)
for name in ('widget.js', 'widget.min.js'):
    shutil.copy2(root / name, backup / name)
manifest = {'before_sha256': expected.lower(), 'source_sha256': source_sha, 'bundle_sha256': bundle_sha}
(backup / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
try:
    os.chmod(incoming_source, 0o644)
    os.chmod(incoming_bundle, 0o644)
    os.replace(incoming_source, root / 'widget.js')
    os.replace(incoming_bundle, root / 'widget.min.js')
    if digest(root / 'widget.min.js') != bundle_sha:
        raise RuntimeError('Published digest mismatch')
except BaseException:
    for name in ('widget.js', 'widget.min.js'):
        shutil.copy2(backup / name, root / name)
    raise
print('BACKUP=' + str(backup))
print(json.dumps(manifest))
'@
$remoteScript | ssh -o BatchMode=yes -o ConnectTimeout=12 -o StrictHostKeyChecking=yes root@5.129.241.152 "python3 - $stamp $ExpectedRemoteSha $sourceSha $bundleSha"
if ($LASTEXITCODE -ne 0) { throw 'Widget deployment failed.' }
