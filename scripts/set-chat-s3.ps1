# Настройки S3 для вложений чата на сервере: /opt/alphabet-chat-api/.env.chat-v8 (права 600).
#   .\scripts\set-chat-s3.ps1            спросить ключи (скрытый ввод) и записать адрес, регион, бакет и ключи
#   .\scripts\set-chat-s3.ps1 -Set s3    включить хранение вложений в S3
#   .\scripts\set-chat-s3.ps1 -Set local вернуть хранение на диск сервера
# Ключи идут на сервер через SSH во входном потоке — не попадают в историю команд, файлы проекта и журнал.
# Сервис не перезапускается: новые настройки начнут действовать после перезапуска.
param(
  [ValidateSet('keys', 's3', 'local')][string]$Set = 'keys',
  [string]$Bucket = '78b153a5-0492-4779-87b0-013279cbfb8f',
  [string]$Endpoint = 'https://s3.twcstorage.ru',
  [string]$Region = 'ru-1',
  [string]$Server = 'root@5.129.241.152'
)
$ErrorActionPreference = 'Stop'

if ($Set -eq 'keys') {
  $access = (Read-Host 'S3 Access Key (Timeweb: бакет -> Подключение)').Trim()
  $secure = Read-Host 'S3 Secret Access Key' -AsSecureString
  $secret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)).Trim()
  if (-not $access -or -not $secret) { throw 'Ключи не введены.' }
  if ("$access$secret" -match '[\s"''\\#=]') { throw 'В ключе есть пробел, кавычка, решётка, = или обратная косая черта — проверьте, что скопировали только ключ.' }
  $values = [ordered]@{ CHAT_S3_ENDPOINT = $Endpoint; CHAT_S3_REGION = $Region; CHAT_S3_BUCKET = $Bucket; CHAT_S3_PREFIX = 'chat-v8/'; CHAT_S3_ACCESS_KEY = $access; CHAT_S3_SECRET_KEY = $secret }
} else {
  $values = [ordered]@{ CHAT_FILE_STORE = $Set }
}

# Меняет только переданные строки файла, остальные сохраняет; запись атомарная, права 600.
$python = @'
import json, os, pathlib, sys, tempfile
target = pathlib.Path('/opt/alphabet-chat-api/.env.chat-v8')
updates = json.loads(sys.stdin.readline())
if any(not isinstance(v, str) or not v or any(c in v for c in '\r\n') for v in updates.values()): raise SystemExit('Unexpected value')
lines = target.read_text().splitlines() if target.exists() else []
seen, out = set(), []
for line in lines:
    name = line.split('=', 1)[0]
    if name in updates:
        out.append(name + '=' + updates[name]); seen.add(name)
    else:
        out.append(line)
out += [name + '=' + value for name, value in updates.items() if name not in seen]
descriptor, temp = tempfile.mkstemp(prefix='.chat-v8-', dir=str(target.parent))
try:
    os.fchmod(descriptor, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        stream.write('\n'.join(out) + '\n')
    os.replace(temp, target)
finally:
    if os.path.exists(temp): os.unlink(temp)
print(json.dumps({'file': str(target), 'mode': oct(target.stat().st_mode & 0o777), 'updated': list(updates), 'service_restart': False}))
'@
$encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($python))
($values | ConvertTo-Json -Compress) | ssh -o BatchMode=yes -o StrictHostKeyChecking=yes $Server "python3 -c `"import base64;exec(base64.b64decode('$encoded'))`""
if ($LASTEXITCODE -ne 0) { throw 'Сервер не принял настройки.' }
