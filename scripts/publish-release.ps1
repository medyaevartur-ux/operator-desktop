<#
.SYNOPSIS
  Publish a release built by .github/workflows/release.yml to the update channel on the server.

.DESCRIPTION
  publish-release.ps1 -Tag v8.0.0-beta.9
      Read-only PLAN. Downloads the draft GitHub Release into a temp folder, verifies SHA256SUMS.txt, the versions,
      the updater signature and both manifests, asks the server for its current state (read-only) and prints what
      -Apply would do. Nothing is uploaded or changed.
  publish-release.ps1 -Tag v8.0.0-beta.9 -Apply
      Uploads the installers and the update packages to /var/www/updates/operator-desktop/ first, checks their SHA-256
      on the server, and switches latest.json and android-latest.json LAST (upload under a temp name, then atomic
      rename). The previous manifests stay next to them as latest.json.prev / android-latest.json.prev. Then the
      public update URLs are checked; if that fails the previous manifests are put back automatically.
  publish-release.ps1 -Tag v8.0.0-beta.9 -Rollback [-Apply]
      Restores the *.prev manifests (only those that still point at this tag). Without -Apply it only shows the plan.
      The uploaded installers stay on the server: their names carry the version, so they do no harm.

  Needs: GitHub CLI (gh, logged in) for the download, ssh/scp with the server key (same as deploy-operator-web.ps1).
  Works in Windows PowerShell 5.1 and PowerShell 7. Run it from anywhere; it finds the repository by its own location.
  Re-running -Apply is safe: files and manifests that are already identical on the server are skipped; an existing
  file with the same name but different content is never replaced (bump the version instead).

.PARAMETER Repo
  owner/name of the GitHub repository (default: the repository this script lives in).
.PARAMETER AssetsDir
  Use an already downloaded release folder instead of gh release download (it is not deleted afterwards).
.PARAMETER NoServer
  Plan only: do not contact the server.
#>
param(
  [Parameter(Mandatory=$true)][ValidatePattern('(?-i)^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$')][string]$Tag,
  [switch]$Apply,
  [switch]$Rollback,
  [string]$Repo = '',
  [string]$AssetsDir = '',
  [switch]$NoServer,
  [string]$Server = 'root@5.129.241.152'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 1.0

$Version = $Tag.Substring(1)
$Root = Split-Path -Parent $PSScriptRoot
$RemoteDir = '/var/www/updates/operator-desktop'
$IncomingName = ".incoming-$Tag"
$WindowsBaseUrl = 'https://zhivaya-skazka.ru/updates/operator-desktop'
$AndroidBaseUrl = 'https://zhivaya-skazka.ru/api/updater/download'
$SshOptions = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15')

# Runs on the server through "python3 -" (ASCII only: Windows PowerShell 5.1 pipes text as ASCII, and line endings may be CRLF).
# PUBLISH_UPDATES_DIR, PUBLISH_SITE and PUBLISH_SKIP_HTTP exist only so that this part can be tested against a local folder.
$RemoteScript = @'
import base64, hashlib, json, os, re, shutil, sys, urllib.error, urllib.request

BASE = os.environ.get('PUBLISH_UPDATES_DIR') or '/var/www/updates/operator-desktop'
SITE = os.environ.get('PUBLISH_SITE') or 'https://zhivaya-skazka.ru'
NAME_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]*$')
INCOMING_RE = re.compile(r'^\.incoming-v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$')

mode = sys.argv[1]
job = json.loads(base64.b64decode(sys.argv[2]).decode('ascii'))


def log(text):
    print('LOG ' + text)


def die(text):
    sys.stderr.write('ERROR: ' + text + '\n')
    sys.exit(2)


def path_of(name):
    if not NAME_RE.match(name):
        die('unsafe file name: ' + name)
    return os.path.join(BASE, name)


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b''):
            digest.update(chunk)
    return digest.hexdigest()


def read_manifest(name):
    # (parsed json or None, sha256 or None); an unreadable file gives ({'_broken': True}, sha256)
    path = path_of(name)
    if not os.path.isfile(path):
        return None, None
    digest = sha256_file(path)
    try:
        with open(path, 'rb') as handle:
            parsed = json.loads(handle.read().decode('utf-8'))
    except Exception:
        return {'_broken': True}, digest
    if not isinstance(parsed, dict):
        return {'_broken': True}, digest
    return parsed, digest


def fetch(url, method='GET'):
    request = urllib.request.Request(url, method=method, headers={'User-Agent': 'operator-publish-check/1', 'Cache-Control': 'no-cache'})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.headers, (response.read() if method == 'GET' else b'')
    except urllib.error.HTTPError as error:
        return error.code, error.headers, b''
    except Exception as error:
        return 0, {}, str(error).encode('ascii', 'replace')


def state():
    if not os.path.isdir(BASE):
        die('updates directory is missing: ' + BASE)
    stat = os.statvfs(BASE)
    result = {'free_bytes': stat.f_bavail * stat.f_frsize, 'manifests': {}, 'artifacts': {}}
    for item in job['manifests']:
        doc, digest = read_manifest(item['name'])
        prev_doc, _ = read_manifest(item['name'] + '.prev')
        result['manifests'][item['name']] = {
            'exists': doc is not None,
            'broken': bool(doc and doc.get('_broken')),
            'version': doc.get('version') if doc else None,
            'version_code': doc.get('version_code') if doc else None,
            'sha256': digest,
            'prev_version': prev_doc.get('version') if prev_doc else None,
        }
    for item in job['artifacts']:
        path = path_of(item['name'])
        present = os.path.isfile(path)
        result['artifacts'][item['name']] = {'exists': present, 'sha256': sha256_file(path) if present else None}
    return result


def place(source, target, uid, gid, mode_bits):
    os.chmod(source, mode_bits)
    try:
        os.chown(source, uid, gid)
    except OSError:
        pass
    os.replace(source, target)


def restore(name, had_previous):
    live = path_of(name)
    if not had_previous:
        os.remove(live)
        return
    temp = live + '.restore'
    shutil.copy2(live + '.prev', temp)
    live_stat = os.stat(live)
    try:
        os.chown(temp, live_stat.st_uid, live_stat.st_gid)
    except OSError:
        pass
    os.replace(temp, live)


def post_check():
    problems = []
    if os.environ.get('PUBLISH_SKIP_HTTP'):
        return problems
    for item in job['manifests']:
        try:
            if item['kind'] == 'windows':
                code, _, body = fetch(SITE + '/api/updater/check?target=windows&arch=x86_64&current_version=0.0.0')
                if code != 200:
                    problems.append('update check for Windows answered HTTP %s' % code)
                else:
                    doc = json.loads(body.decode('utf-8'))
                    platform = (doc.get('platforms') or {}).get('windows-x86_64') or {}
                    if doc.get('version') != job['version'] or platform.get('url') != item['url']:
                        problems.append('update check for Windows does not show the new release')
            else:
                code, _, body = fetch(SITE + '/api/updater/android?current_code=0')
                if code != 200:
                    problems.append('update check for Android answered HTTP %s (the server may have rejected android-latest.json)' % code)
                else:
                    doc = json.loads(body.decode('utf-8'))
                    if doc.get('version_code') != item['version_code'] or doc.get('url') != item['url'] or doc.get('sha256') != item['file_sha256']:
                        problems.append('update check for Android does not show the new release')
            code, headers, _ = fetch(item['url'], 'HEAD')
            length = headers.get('Content-Length')
            if code != 200 or (length is not None and int(length) != item['file_size']):
                problems.append('download URL answers HTTP %s (length %s, expected %s): %s' % (code, length, item['file_size'], item['url']))
        except Exception as error:
            problems.append('check of %s failed: %s' % (item['name'], error))
    return problems


def commit():
    if not INCOMING_RE.match(job['incoming']):
        die('bad upload folder name')
    base_stat = os.stat(BASE)
    incoming = os.path.join(BASE, job['incoming'])
    if not os.path.isdir(incoming):
        die('nothing was uploaded to ' + job['incoming'])
    items = job['artifacts'] + job['manifests']
    for item in items:
        if not NAME_RE.match(item['name']):
            die('unsafe file name: ' + item['name'])
        staged = os.path.join(incoming, item['name'])
        if not os.path.isfile(staged):
            die('not uploaded: ' + item['name'])
        if os.path.getsize(staged) != item['size'] or sha256_file(staged) != item['sha256']:
            die('uploaded file does not match the expected SHA-256: ' + item['name'])
    log('uploaded files verified: %d' % len(items))
    for item in job['artifacts']:
        target = path_of(item['name'])
        staged = os.path.join(incoming, item['name'])
        if os.path.exists(target):
            if sha256_file(target) != item['sha256']:
                die('refusing to replace the existing %s with different content (bump the version instead)' % item['name'])
            log('already on the server, unchanged: ' + item['name'])
            continue
        place(staged, target, base_stat.st_uid, base_stat.st_gid, 0o644)
        log('published file: ' + item['name'])
    switched = []
    try:
        for item in job['manifests']:
            live = path_of(item['name'])
            staged = os.path.join(incoming, item['name'])
            _, live_digest = read_manifest(item['name'])
            if live_digest == item['sha256']:
                log('manifest already live: ' + item['name'])
                continue
            if live_digest is None:
                place(staged, live, base_stat.st_uid, base_stat.st_gid, 0o644)
            else:
                keep = live + '.prev'
                shutil.copy2(live, keep + '.tmp')
                os.replace(keep + '.tmp', keep)
                live_stat = os.stat(live)
                place(staged, live, live_stat.st_uid, live_stat.st_gid, live_stat.st_mode & 0o777)
            switched.append((item['name'], live_digest is not None))
            log('manifest switched: ' + item['name'])
        problems = post_check()
        if problems:
            raise RuntimeError('; '.join(problems))
    except Exception as error:
        for name, had_previous in reversed(switched):
            restore(name, had_previous)
            log('previous manifest restored: ' + name)
        die('publish failed, the previous manifests are back in place: %s' % error)
    shutil.rmtree(incoming, ignore_errors=True)
    return {'switched': [name for name, _ in switched]}


def rollback():
    dry = bool(job.get('dry'))
    report = []
    for item in job['manifests']:
        doc, _ = read_manifest(item['name'])
        prev_doc, _ = read_manifest(item['name'] + '.prev')
        entry = {
            'name': item['name'],
            'live_version': doc.get('version') if doc else None,
            'prev_version': prev_doc.get('version') if prev_doc else None,
            'action': 'skip',
            'reason': '',
        }
        if prev_doc is None:
            entry['reason'] = 'there is no .prev file'
        elif doc is None:
            entry['reason'] = 'there is no live manifest'
        elif doc.get('version') != job['version']:
            entry['reason'] = 'the live manifest is not %s' % job['version']
        else:
            entry['action'] = 'restore'
        if entry['action'] == 'restore' and not dry:
            restore(item['name'], True)
            log('restored ' + item['name'])
        report.append(entry)
    return {'dry': dry, 'report': report}


if mode == 'plan':
    out = state()
elif mode == 'commit':
    out = commit()
elif mode == 'rollback':
    out = rollback()
else:
    die('unknown mode ' + mode)
print('RESULT ' + json.dumps(out))
'@

# ---------------------------------------------------------------- helpers

function Get-Sha256([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Format-Size([long]$Bytes) {
  $culture = [Globalization.CultureInfo]::InvariantCulture
  if ($Bytes -ge 1GB) { return ($Bytes / 1GB).ToString('0.0', $culture) + ' GB' }
  if ($Bytes -ge 1MB) { return ($Bytes / 1MB).ToString('0.0', $culture) + ' MB' }
  return ($Bytes / 1KB).ToString('0.0', $culture) + ' KB'
}
# File.ReadAllText reads UTF-8 (Get-Content in Windows PowerShell 5.1 would read the BOM-less manifests as ANSI).
function Read-Json([string]$Path) { [IO.File]::ReadAllText($Path) | ConvertFrom-Json }

function ConvertTo-SemVerParts([string]$Text) {
  $m = [regex]::Match($Text, '^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$')
  if (-not $m.Success) { throw "Not a semantic version: $Text" }
  [pscustomobject]@{ Major = [long]$m.Groups[1].Value; Minor = [long]$m.Groups[2].Value; Patch = [long]$m.Groups[3].Value; Pre = $m.Groups[4].Value }
}

# -1, 0 or 1 following semver.org precedence (what semver.gt on the server does).
function Compare-SemVer([string]$A, [string]$B) {
  $x = ConvertTo-SemVerParts $A
  $y = ConvertTo-SemVerParts $B
  foreach ($part in 'Major', 'Minor', 'Patch') {
    if ($x.$part -ne $y.$part) { if ($x.$part -lt $y.$part) { return -1 } else { return 1 } }
  }
  if ($x.Pre -ceq $y.Pre) { return 0 }
  if (-not $x.Pre) { return 1 }
  if (-not $y.Pre) { return -1 }
  $p = $x.Pre.Split('.')
  $q = $y.Pre.Split('.')
  for ($i = 0; $i -lt [math]::Min($p.Length, $q.Length); $i++) {
    $pNumeric = $p[$i] -match '^\d+$'
    $qNumeric = $q[$i] -match '^\d+$'
    if ($pNumeric -and $qNumeric) {
      if ([long]$p[$i] -ne [long]$q[$i]) { if ([long]$p[$i] -lt [long]$q[$i]) { return -1 } else { return 1 } }
    } elseif ($pNumeric) { return -1 }
    elseif ($qNumeric) { return 1 }
    else {
      $c = [string]::CompareOrdinal($p[$i], $q[$i])
      if ($c -ne 0) { if ($c -lt 0) { return -1 } else { return 1 } }
    }
  }
  if ($p.Length -eq $q.Length) { return 0 }
  if ($p.Length -lt $q.Length) { return -1 } else { return 1 }
}

# Runs a native command, returns Code and Lines (stdout and stderr merged). Safe with $ErrorActionPreference = 'Stop'
# in Windows PowerShell 5.1, where merged stderr would otherwise turn into terminating errors.
function Invoke-NativeCapture([string]$Exe, [string[]]$Arguments, [string]$InputText = '') {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    if ($InputText) { $lines = @($InputText | & $Exe @Arguments 2>&1 | ForEach-Object { "$_" }) }
    else { $lines = @(& $Exe @Arguments 2>&1 | ForEach-Object { "$_" }) }
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previous }
  [pscustomobject]@{ Code = $code; Lines = $lines }
}

# Exit code 255 is a lost ssh connection (the VPN does this now and then); anything else is a real answer.
function Invoke-WithSshRetry([scriptblock]$Action) {
  $result = $null
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    $result = & $Action
    if ($result.Code -ne 255) { return $result }
    Write-Host ("  ssh connection problem (exit 255), attempt {0} of 3" -f $attempt)
    Start-Sleep -Seconds 3
  }
  return $result
}

function Invoke-Remote([string]$Mode, $Job) {
  $json = $Job | ConvertTo-Json -Depth 8 -Compress
  $payload = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($json))
  $body = $script:RemoteScript.Replace("`r", '') + "`n# end`n"
  $result = Invoke-WithSshRetry { Invoke-NativeCapture 'ssh' ($SshOptions + @($Server, "python3 - $Mode $payload")) $body }
  $resultLine = $null
  foreach ($line in $result.Lines) {
    if ($line.StartsWith('LOG ')) { Write-Host ('  ' + $line.Substring(4)) }
    elseif ($line.StartsWith('RESULT ')) { $resultLine = $line.Substring(7) }
    elseif ($result.Code -ne 0) { Write-Host ('  ' + $line) }
  }
  if ($result.Code -ne 0) { throw "Server step '$Mode' failed (exit code $($result.Code))." }
  if (-not $resultLine) { throw "Server step '$Mode' returned no result." }
  return ($resultLine | ConvertFrom-Json)
}

function Send-Files([string[]]$Paths) {
  $made = Invoke-WithSshRetry { Invoke-NativeCapture 'ssh' ($SshOptions + @($Server, "mkdir -p $RemoteDir/$IncomingName")) }
  if ($made.Code -ne 0) { $made.Lines | ForEach-Object { Write-Host "  $_" }; throw 'Cannot create the upload folder on the server.' }
  $sent = Invoke-WithSshRetry { Invoke-NativeCapture 'scp' ($SshOptions + $Paths + @("${Server}:$RemoteDir/$IncomingName/")) }
  if ($sent.Code -ne 0) { $sent.Lines | ForEach-Object { Write-Host "  $_" }; throw 'Upload failed.' }
}

# ---------------------------------------------------------------- rollback

if ($Rollback) {
  if ($NoServer) { throw '-NoServer cannot be combined with -Rollback.' }
  $mode = 'plan only, add -Apply to execute'
  if ($Apply) { $mode = 'APPLY' }
  Write-Host ("Rollback of {0} on {1}: {2}" -f $Tag, $Server, $mode)
  $job = @{ tag = $Tag; version = $Version; dry = (-not $Apply.IsPresent); manifests = @(@{ name = 'latest.json' }, @{ name = 'android-latest.json' }) }
  $answer = Invoke-Remote 'rollback' $job
  foreach ($entry in $answer.report) {
    $note = ''
    if ($entry.reason) { $note = " ($($entry.reason))" }
    Write-Host ("  {0}: live {1}, previous {2} -> {3}{4}" -f $entry.name, $entry.live_version, $entry.prev_version, $entry.action, $note)
  }
  if (-not $Apply) { Write-Host 'PLAN ONLY: nothing was changed.' }
  return
}

# ---------------------------------------------------------------- get and verify the release

$cleanup = ''
try {
  if ($AssetsDir) {
    $dir = (Resolve-Path -LiteralPath $AssetsDir).Path
  } else {
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'GitHub CLI (gh) is not installed or not in PATH.' }
    $dir = Join-Path ([IO.Path]::GetTempPath()) ('operator-release-' + $Tag + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $dir | Out-Null
    $cleanup = $dir
    $ghArgs = @('release', 'download', $Tag, '--dir', $dir)
    if ($Repo) { $ghArgs += @('--repo', $Repo) }
    Push-Location $Root
    try { $download = Invoke-NativeCapture 'gh' $ghArgs } finally { Pop-Location }
    if ($download.Code -ne 0) {
      $download.Lines | ForEach-Object { Write-Host "  $_" }
      throw "gh release download $Tag failed. Is the draft release there and is gh logged in?"
    }
  }

  $problems = New-Object 'System.Collections.Generic.List[string]'
  $files = @(Get-ChildItem -LiteralPath $dir -File)
  if ($files.Count -eq 0) { throw "No files in $dir." }
  foreach ($f in $files) {
    if ($f.Name -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') { $problems.Add("unsafe asset name: $($f.Name)") }
  }

  # SHA256SUMS.txt must list exactly the other files, with matching hashes.
  $listed = @{}
  $sumsFile = @($files | Where-Object { $_.Name -ceq 'SHA256SUMS.txt' })
  if ($sumsFile.Count -ne 1) {
    $problems.Add('SHA256SUMS.txt is missing in the release')
  } else {
    foreach ($line in [IO.File]::ReadAllLines($sumsFile[0].FullName)) {
      if ($line.Trim().Length -eq 0) { continue }
      $m = [regex]::Match($line, '^([0-9a-fA-F]{64}) [ *](.+)$')
      if (-not $m.Success) { $problems.Add("bad line in SHA256SUMS.txt: $line"); continue }
      $listed[$m.Groups[2].Value] = $m.Groups[1].Value.ToLowerInvariant()
    }
    foreach ($f in $files) {
      if ($f.Name -ceq 'SHA256SUMS.txt') { continue }
      if (-not $listed.ContainsKey($f.Name)) { $problems.Add("not listed in SHA256SUMS.txt: $($f.Name)"); continue }
      if ((Get-Sha256 $f.FullName) -ne $listed[$f.Name]) { $problems.Add("SHA-256 does not match SHA256SUMS.txt: $($f.Name)") }
    }
    foreach ($name in $listed.Keys) {
      if (@($files | Where-Object { $_.Name -ceq $name }).Count -eq 0) { $problems.Add("listed in SHA256SUMS.txt but missing: $name") }
    }
  }

  function Find-One([string]$Pattern) {
    $found = @($files | Where-Object { $_.Name -clike $Pattern })
    if ($found.Count -ne 1) { $problems.Add("expected exactly one file like '$Pattern', found $($found.Count)"); return $null }
    return $found[0]
  }
  $zip = Find-One "*_${Version}_x64-setup.nsis.zip"
  $exe = Find-One "*_${Version}_x64-setup.exe"
  $apk = Find-One "operator-${Version}-arm64.apk"
  $windowsManifestFile = Find-One 'latest.json'
  $androidManifestFile = Find-One 'android-latest.json'
  $zipSig = $null
  $exeSig = $null
  if ($zip) {
    $zipSig = @($files | Where-Object { $_.Name -ceq ($zip.Name + '.sig') })
    if ($zipSig.Count -ne 1) { $problems.Add("updater signature is missing: $($zip.Name).sig"); $zipSig = $null }
    else { $zipSig = $zipSig[0] }
  }
  if ($exe) {
    $found = @($files | Where-Object { $_.Name -ceq ($exe.Name + '.sig') })
    if ($found.Count -eq 1) { $exeSig = $found[0] }
  }

  $windowsDoc = $null
  $androidDoc = $null
  if ($windowsManifestFile -and $zip -and $zipSig) {
    $windowsDoc = Read-Json $windowsManifestFile.FullName
    $signature = [IO.File]::ReadAllText($zipSig.FullName).Trim()
    if ($signature.Length -eq 0) { $problems.Add("$($zipSig.Name) is empty") }
    elseif ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($signature)) -notlike 'untrusted comment:*') { $problems.Add("$($zipSig.Name) is not a minisign signature") }
    if ($windowsDoc.version -cne $Version) { $problems.Add("latest.json has version '$($windowsDoc.version)', expected '$Version'") }
    $platformNames = @($windowsDoc.platforms.PSObject.Properties.Name)
    if ($platformNames.Count -ne 1 -or $platformNames[0] -cne 'windows-x86_64') { $problems.Add('latest.json must contain exactly the platform windows-x86_64') }
    else {
      $platform = $windowsDoc.platforms.'windows-x86_64'
      if ($platform.signature -cne $signature) { $problems.Add('latest.json signature differs from the .sig file') }
      if ($platform.url -cne "$WindowsBaseUrl/$($zip.Name)") { $problems.Add("latest.json url is '$($platform.url)', expected '$WindowsBaseUrl/$($zip.Name)'") }
    }
    if (-not $windowsDoc.notes) { $problems.Add('latest.json has no notes') }
  }
  if ($androidManifestFile -and $apk) {
    $androidDoc = Read-Json $androidManifestFile.FullName
    if ($androidDoc.version -cne $Version) { $problems.Add("android-latest.json has version '$($androidDoc.version)', expected '$Version'") }
    $code = 0L
    if (-not [long]::TryParse([string]$androidDoc.version_code, [ref]$code) -or $code -le 0 -or $code -gt 2100000000) { $problems.Add('android-latest.json version_code must be an integer from 1 to 2100000000') }
    if ($androidDoc.url -cne "$AndroidBaseUrl/$($apk.Name)") { $problems.Add("android-latest.json url is '$($androidDoc.url)', expected '$AndroidBaseUrl/$($apk.Name)'") }
    if ($androidDoc.sha256 -cne (Get-Sha256 $apk.FullName)) { $problems.Add('android-latest.json sha256 differs from the APK') }
    if ([long]$androidDoc.size -ne $apk.Length) { $problems.Add('android-latest.json size differs from the APK') }
    if ($apk.Length -gt 250MB) { $problems.Add('the APK is larger than the 250 MB updater limit') }
  }

  Write-Host ''
  Write-Host ("=== Release {0} (assets: {1}) ===" -f $Tag, $dir)
  foreach ($f in ($files | Sort-Object Name)) { Write-Host ("  {0,-70} {1,10}" -f $f.Name, (Format-Size $f.Length)) }
  if ($problems.Count -gt 0) {
    Write-Host ''
    Write-Host 'PROBLEMS - the release must not be published:'
    foreach ($p in $problems) { Write-Host "  - $p" }
    throw "The release $Tag failed verification ($($problems.Count) problem(s))."
  }
  Write-Host ("  checks passed: SHA256SUMS.txt (all {0} files), versions = {1}, updater signature present, manifests match the files" -f ($files.Count - 1), $Version)
  $firstLine = ([string]$windowsDoc.notes -split '\r?\n')[0]
  if ($firstLine.Length -gt 100) { $firstLine = $firstLine.Substring(0, 100) + '...' }
  Write-Host ("  update notes start with: {0}" -f $firstLine)

  # ---------------------------------------------------------------- the plan

  $artifacts = New-Object 'System.Collections.Generic.List[object]'
  foreach ($f in @($zip, $zipSig, $exe, $exeSig, $apk)) {
    if ($f) { $artifacts.Add(@{ name = $f.Name; sha256 = (Get-Sha256 $f.FullName); size = [long]$f.Length }) }
  }
  $manifests = @(
    @{ name = 'latest.json'; kind = 'windows'; sha256 = (Get-Sha256 $windowsManifestFile.FullName); size = [long]$windowsManifestFile.Length; version = $Version; version_code = 0
       url = $windowsDoc.platforms.'windows-x86_64'.url; file_size = [long]$zip.Length; file_sha256 = (Get-Sha256 $zip.FullName) },
    @{ name = 'android-latest.json'; kind = 'android'; sha256 = (Get-Sha256 $androidManifestFile.FullName); size = [long]$androidManifestFile.Length; version = $Version; version_code = [long]$androidDoc.version_code
       url = $androidDoc.url; file_size = [long]$apk.Length; file_sha256 = (Get-Sha256 $apk.FullName) }
  )
  $job = @{ tag = $Tag; version = $Version; incoming = $IncomingName; artifacts = $artifacts.ToArray(); manifests = $manifests }
  $totalBytes = [long]0
  foreach ($a in $artifacts) { $totalBytes += $a.size }
  foreach ($m in $manifests) { $totalBytes += $m.size }

  $blockers = New-Object 'System.Collections.Generic.List[string]'
  $state = $null
  Write-Host ''
  if ($NoServer) {
    Write-Host ("Server {0}: not queried (-NoServer)" -f $Server)
  } else {
    try { $state = Invoke-Remote 'plan' $job }
    catch {
      if ($Apply) { throw }
      Write-Host ("Server {0}: could not be queried (read-only plan is incomplete): {1}" -f $Server, $_.Exception.Message)
    }
  }
  if ($state) {
    Write-Host ("Server {0}, {1}:" -f $Server, $RemoteDir)
    Write-Host ("  free space {0}, this release needs {1}" -f (Format-Size $state.free_bytes), (Format-Size $totalBytes))
    if ($state.free_bytes -lt ($totalBytes * 2 + 200MB)) { $blockers.Add('not enough free space on the server') }
    foreach ($a in $artifacts) {
      $remote = $state.artifacts.($a.name)
      if (-not $remote.exists) { Write-Host ("  new file        {0}" -f $a.name) }
      elseif ($remote.sha256 -eq $a.sha256) { Write-Host ("  unchanged       {0} (already on the server)" -f $a.name) }
      else { Write-Host ("  CONFLICT        {0} exists with different content" -f $a.name); $blockers.Add("the server already has a different file named $($a.name); bump the version") }
    }
    foreach ($m in $manifests) {
      $live = $state.manifests.($m.name)
      if (-not $live.exists) { Write-Host ("  manifest {0}: none on the server yet -> new" -f $m.name); continue }
      if ($live.sha256 -eq $m.sha256) { Write-Host ("  manifest {0}: already live, unchanged" -f $m.name); continue }
      if ($live.broken) { Write-Host ("  manifest {0}: live file is unreadable and will be replaced (kept as .prev)" -f $m.name); continue }
      if ($m.kind -eq 'windows') {
        Write-Host ("  manifest {0}: live {1} -> {2}" -f $m.name, $live.version, $Version)
        try { $order = Compare-SemVer $Version ([string]$live.version) }
        catch { $blockers.Add("$($m.name): the live version '$($live.version)' is not a semantic version"); continue }
        if ($order -le 0) { $blockers.Add("$($m.name): $Version is not newer than the live $($live.version)") }
      } else {
        Write-Host ("  manifest {0}: live {1} (code {2}) -> {3} (code {4})" -f $m.name, $live.version, $live.version_code, $Version, $m.version_code)
        if ([long]$m.version_code -le [long]$live.version_code) { $blockers.Add("$($m.name): version_code $($m.version_code) is not greater than the live $($live.version_code)") }
      }
    }
  }
  Write-Host ''
  Write-Host 'With -Apply:'
  Write-Host ("  1. upload {0} files ({1}) to {2}/{3}/" -f ($artifacts.Count + 2), (Format-Size $totalBytes), $RemoteDir, $IncomingName)
  Write-Host '  2. verify their SHA-256 on the server and move the installers into place (existing files are never overwritten)'
  Write-Host '  3. keep latest.json / android-latest.json as *.prev and switch the two manifests last (atomic rename)'
  Write-Host '  4. check the public update URLs; on any failure the previous manifests are restored automatically'
  Write-Host ("  Roll back later with: powershell -NoProfile -File scripts/publish-release.ps1 -Tag {0} -Rollback -Apply" -f $Tag)
  if ($blockers.Count -gt 0) {
    Write-Host ''
    Write-Host 'BLOCKERS:'
    foreach ($b in $blockers) { Write-Host "  - $b" }
    throw "Cannot publish $Tag ($($blockers.Count) blocker(s))."
  }

  if (-not $Apply) {
    Write-Host ''
    Write-Host 'PLAN ONLY: nothing was uploaded or changed. Run again with -Apply to publish.'
    return
  }
  if ($NoServer) { throw '-Apply needs the server; do not combine it with -NoServer.' }

  # ---------------------------------------------------------------- apply

  Write-Host ''
  Write-Host 'APPLY'
  $paths = @()
  foreach ($a in $artifacts) { $paths += (Join-Path $dir $a.name) }
  $paths += $windowsManifestFile.FullName
  $paths += $androidManifestFile.FullName
  Write-Host ("  uploading {0} files ..." -f $paths.Count)
  Send-Files $paths
  Write-Host '  switching on the server ...'
  $done = Invoke-Remote 'commit' $job
  Write-Host ''
  if (@($done.switched).Count -eq 0) { Write-Host ("{0} was already live; nothing to switch." -f $Tag) }
  else { Write-Host ("Published {0}: switched {1}." -f $Tag, (@($done.switched) -join ', ')) }
  Write-Host 'The GitHub draft release was left as it is: publish or delete it there when you are done.'
} finally {
  if ($cleanup -and (Test-Path -LiteralPath $cleanup)) { Remove-Item -LiteralPath $cleanup -Recurse -Force -ErrorAction SilentlyContinue }
}
