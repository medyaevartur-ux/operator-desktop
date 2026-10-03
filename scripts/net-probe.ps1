# Checks the connection from this computer to the chat server every few seconds and writes a CSV.
# Run it on the same Wi-Fi as the phones: it shows the exact minute HTTPS to the server breaks and comes back,
# next to a plain TCP connect, plain HTTP on the same server and HTTPS to an unrelated site (github.com).
#   .\scripts\net-probe.ps1                      4 hours, every 10 s, log in %TEMP%\zs-net-probe.csv
#   .\scripts\net-probe.ps1 -Minutes 60 -Every 5
# A failed check shows 000 (no answer) or -1 (no TCP connection).
param([int]$Minutes = 240, [int]$Every = 10, [string]$Log = (Join-Path $env:TEMP 'zs-net-probe.csv'))
$server = '5.129.241.152'

function Connect-Ms([string]$address, [int]$port) {
  $client = [Net.Sockets.TcpClient]::new()
  $watch = [Diagnostics.Stopwatch]::StartNew()
  try { if ($client.ConnectAsync($address, $port).Wait(4000) -and $client.Connected) { return [int]$watch.ElapsedMilliseconds }; return -1 }
  catch { return -1 }
  finally { $client.Dispose() }
}
function Get-Code([string]$url, [string[]]$extra = @()) {
  $result = curl.exe -s -o NUL --max-time 6 -w '%{http_code} %{time_total}' @extra $url
  if ($result) { return $result } else { return '000 6' }
}

if (-not (Test-Path -LiteralPath $Log)) { 'time,tcp443_ms,operator_https,operator_s,server_http80,github_https' | Set-Content -LiteralPath $Log }
$until = (Get-Date).AddMinutes($Minutes)
while ((Get-Date) -lt $until) {
  $time = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  $tcp = Connect-Ms $server 443
  $operator = (Get-Code "https://operator.zhivaya-skazka.ru/manifest.webmanifest?probe=$([DateTime]::UtcNow.Ticks)") -split ' '
  $http80 = (Get-Code 'http://zhivaya-skazka.ru/') -split ' '
  $github = (Get-Code 'https://github.com/' @('-I')) -split ' '
  "$time,$tcp,$($operator[0]),$($operator[1]),$($http80[0]),$($github[0])" | Add-Content -LiteralPath $Log
  Start-Sleep -Seconds $Every
}
