# Web version of the operator app (iPhone, browser) at https://operator.zhivaya-skazka.ru.
# No switches: read-only plan. -Apply -Archive prepared-v8/<release>/operator-web.tgz: publish.
# -Rollback: switch back to the previous release. Static files only: chat clients are not affected.
param(
  [switch]$Apply,
  [switch]$Rollback,
  [string]$Archive
)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$script=Join-Path $root 'ops/operator_web.py'
$ssh=@('-o','BatchMode=yes','-o','StrictHostKeyChecking=yes')
$extra=''
if ($Rollback) { $extra=' --rollback' }
elseif ($Apply) {
  if (-not $Archive) { throw 'Pass -Archive with operator-web.tgz from prepared-v8.' }
  $full=[IO.Path]::GetFullPath((Join-Path $root $Archive))
  if (-not $full.StartsWith($root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Archive must be inside this project.' }
  $hash=(Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLowerInvariant()
  $remote="/opt/alphabet-chat-api/.codex-v8-work/operator-web-$hash.tgz"
  scp @ssh $full "root@5.129.241.152:$remote" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Archive upload failed.' }
  $extra=" --apply --archive $remote --archive-sha $hash"
}
Get-Content -LiteralPath $script -Raw | ssh @ssh root@5.129.241.152 ('python3 -'+$extra)
if ($LASTEXITCODE -ne 0) { throw 'Operator web step failed.' }
