param(
  [switch]$Apply,
  [switch]$ClientsReady,
  # Widget-only release on top of a live v8: new widget files and the loader filename in nginx.
  [switch]$WidgetOnly,
  [string]$Archive,
  [string]$WidgetArchive,
  [ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedWidgetSha,
  [ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedLiveSha,
  [ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedNginxSha
)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$script=Join-Path $root 'ops/release_chat.py'
$ssh=@('-o','BatchMode=yes','-o','StrictHostKeyChecking=yes')
function Resolve-Inside([string]$Path,[string]$What) {
  $full=[IO.Path]::GetFullPath((Join-Path $root $Path))
  if (-not $full.StartsWith($root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw "$What must be inside this project." }
  return $full
}
function Send-Archive([string]$Path,[string]$What,[string]$Prefix) {
  $resolved=Resolve-Inside $Path $What
  $hash=(Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToLowerInvariant()
  $remote='/opt/alphabet-chat-api/.codex-v8-work/'+$Prefix+'-'+$hash+'.tgz'
  scp @ssh $resolved "root@5.129.241.152:$remote" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "$What upload failed." }
  return @($remote,$hash)
}
if (-not $Apply) {
  $planArgs=''
  if ($WidgetArchive) {
    # The plan stays read-only: only the loader filename leaves this machine, to print the nginx diff.
    $manifest=((tar -xOf (Resolve-Inside $WidgetArchive 'Widget archive') widget-release.json) -join "`n") | ConvertFrom-Json
    if ($manifest.loader_file -notmatch '^loader\.v8-[a-f0-9]{16}\.js$') { throw 'Unexpected loader in the widget archive.' }
    $planArgs=' --loader '+$manifest.loader_file
  }
  Get-Content -LiteralPath $script -Raw | ssh @ssh root@5.129.241.152 ('python3 -'+$planArgs)
  if ($LASTEXITCODE -ne 0) { throw 'Release plan failed.' }
  return
}
if ($WidgetOnly) {
  if (-not $WidgetArchive -or -not $ExpectedWidgetSha -or -not $ExpectedNginxSha) { throw 'Review the plan with -WidgetArchive first, then pass the widget and nginx digests it printed.' }
  $widgetRemote,$widgetHash=Send-Archive $WidgetArchive 'Widget archive' 'widget'
  Get-Content -LiteralPath $script -Raw | ssh @ssh root@5.129.241.152 "python3 - --apply --widget-only --widget-archive $widgetRemote --widget-archive-sha $widgetHash --expected-widget-sha $ExpectedWidgetSha --expected-nginx-sha $ExpectedNginxSha"
  if ($LASTEXITCODE -ne 0) { throw 'Widget release failed; inspect rollback output.' }
  return
}
if (-not $ClientsReady -or -not $Archive -or -not $WidgetArchive -or -not $ExpectedWidgetSha -or -not $ExpectedLiveSha -or -not $ExpectedNginxSha) { throw 'Review the release plan and prepare the v8 clients and widget first.' }
$widgetRemote,$widgetHash=Send-Archive $WidgetArchive 'Widget archive' 'widget'
$remote,$hash=Send-Archive $Archive 'Archive' 'release'
Get-Content -LiteralPath $script -Raw | ssh @ssh root@5.129.241.152 "python3 - --apply --clients-ready --archive $remote --archive-sha $hash --widget-archive $widgetRemote --widget-archive-sha $widgetHash --expected-widget-sha $ExpectedWidgetSha --expected-live-sha $ExpectedLiveSha --expected-nginx-sha $ExpectedNginxSha"
if ($LASTEXITCODE -ne 0) { throw 'Release failed; inspect rollback output.' }
