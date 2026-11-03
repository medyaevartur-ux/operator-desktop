<#
.SYNOPSIS
  Сброс пароля оператора чата, когда войти не получается (пароль забыт или набран с опечаткой).

.DESCRIPTION
  Запускает владелец в своём терминале:
    powershell -NoProfile -File scripts/reset-operator-password.ps1
  Почта и новый пароль (дважды) вводятся здесь. Пароль не виден на экране, не пишется в файлы и журналы и уходит
  только на сервер внутри SSH. Сервер хэширует его как приложение (bcrypt, 10) и, как смена пароля в приложении,
  закрывает все входы оператора и выключает его push-устройства (после входа они включаются снова).
  Подключение к базе сервер берёт так же, как служба (.env.chat-v8, затем .env), и нигде его не выводит.
#>
param([string]$Server = 'root@5.129.241.152')
$ErrorActionPreference = 'Stop'
$OutputEncoding = New-Object System.Text.UTF8Encoding $false

# Runs on the server as CommonJS from a temp file, with the live release as the working directory.
# OPERATOR_ENV_FILE exists only so that this part can be tested against a local database.
$NodeScript = @'
const fs = require('fs'), path = require('path'), { createRequire } = require('module'), { pathToFileURL } = require('url');
const local = createRequire(path.join(process.cwd(), 'package.json'));
const dotenv = local('dotenv'), bcrypt = local('bcryptjs');
async function main() {
  // Same environment as the service: systemd EnvironmentFile first, then the app's own dotenv (.env, no override).
  const service = dotenv.parse(fs.readFileSync(process.env.OPERATOR_ENV_FILE || '/opt/alphabet-chat-api/.env.chat-v8'));
  for (const [key, value] of Object.entries(service)) if (process.env[key] === undefined) process.env[key] = value;
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const input = JSON.parse(Buffer.from(raw.trim(), 'base64').toString('utf8'));
  const email = String(input.email || '').trim(), password = String(input.password || '');
  if (!email.includes('@') || password.length < 8 || password.length > 128) { console.log('BAD_INPUT'); return 2; }
  const { pool, transaction } = await import(pathToFileURL(path.join(process.cwd(), 'dist', 'db.js')).href);
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await transaction(async client => {
      const found = await client.query('SELECT id FROM chat_operators WHERE lower(email)=lower($1) AND is_active=true FOR UPDATE', [email]);
      if (found.rowCount !== 1) return found.rowCount ? 'AMBIGUOUS' : 'NOT_FOUND';
      const id = found.rows[0].id;
      await client.query('UPDATE chat_operators SET password_hash=$1, updated_at=now() WHERE id=$2', [hash, id]);
      // Same as invalidateOperator() in server/src/routes/operators.ts.
      await client.query('UPDATE chat_v8_auth_sessions SET revoked_at=now(),rotation_envelope=NULL WHERE operator_id=$1 AND revoked_at IS NULL', [id]);
      await client.query('UPDATE chat_v8_devices SET enabled=false WHERE operator_id=$1', [id]);
      return 'OK';
    });
    console.log(result);
    return result === 'OK' ? 0 : 3;
  } finally { await pool.end(); }
}
main().then(code => { process.exitCode = code; }, error => { console.log('FAILED ' + ((error && (error.code || error.message)) || error)); process.exitCode = 1; });
'@

function Read-Secret([string]$Prompt) {
  $secure = Read-Host -Prompt $Prompt -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

Write-Host 'Сброс пароля оператора чата «Живая Сказка».'
$email = (Read-Host -Prompt 'Почта для входа (Enter — admin@alphabet.ru)').Trim()
if (-not $email) { $email = 'admin@alphabet.ru' }
if ($email -notmatch '^[^@\s]+@[^@\s]+$') { throw 'Это не похоже на почту. Ничего не изменено.' }
$first = Read-Secret 'Новый пароль (от 8 символов, на экране не виден)'
$second = Read-Secret 'Повторите новый пароль'
if ($first -cne $second) { throw 'Пароли не совпали. Ничего не изменено — запустите ещё раз.' }
if ($first.Length -lt 8 -or $first.Length -gt 128) { throw 'Нужно от 8 до 128 символов. Ничего не изменено.' }
# Base64 keeps the stream ASCII: Windows PowerShell 5.1 would turn non-ASCII characters of a password into '?'.
$payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((@{ email = $email; password = $first } | ConvertTo-Json -Compress)))
$first = $null; $second = $null

$code = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($NodeScript.Replace("`r", '')))
# No double quotes in the remote command: Windows PowerShell 5.1 mangles them on the way to ssh.exe.
$remote = 'umask 077; f=$(mktemp); echo ' + $code + ' | base64 -d > $f; cd $(systemctl show alphabet-chat-api -p WorkingDirectory --value) && /usr/bin/node $f; s=$?; rm -f $f; exit $s'

$answer = @()
$exit = 255
# Exit code 255 is a lost ssh connection (the VPN does this now and then).
for ($attempt = 1; $attempt -le 3 -and $exit -eq 255; $attempt++) {
  if ($attempt -gt 1) { Write-Host "Нет связи с сервером, попытка $attempt из 3…"; Start-Sleep -Seconds 3 }
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $answer = @($payload | ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15 $Server $remote 2>&1 | ForEach-Object { "$_" }) }
  finally { $ErrorActionPreference = $previous }
  $exit = $LASTEXITCODE
}
$payload = $null

$result = ($answer | Where-Object { $_ -match '^(OK|NOT_FOUND|AMBIGUOUS|BAD_INPUT|FAILED)' } | Select-Object -Last 1)
switch -Regex ($result) {
  '^OK$' { Write-Host "Готово: пароль для $email изменён. Войдите с новым паролем на телефоне и на компьютере (прежние входы закрыты, уведомления включатся после входа)."; exit 0 }
  '^NOT_FOUND$' { Write-Host "Активного оператора с почтой $email нет. Ничего не изменено: проверьте почту (её видно в приложении в «Настройках»)."; exit 3 }
  '^AMBIGUOUS$' { Write-Host "Почта $email есть у нескольких операторов. Ничего не изменено."; exit 3 }
  default {
    Write-Host 'Пароль не изменён. Ответ сервера:'
    $answer | ForEach-Object { Write-Host "  $_" }
    exit 1
  }
}
