param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$mode = if ($Apply) { 'apply' } else { 'preview' }
$remoteScript = @'
import datetime, difflib, hashlib, json, pathlib, shutil, subprocess, sys
mode = sys.argv[1]
config = pathlib.Path('/etc/nginx/sites-enabled/zhivaya-skazka.ru').resolve()
before = config.read_text()
anchor = '    # Widget API -> API 3010\n'
block = '''    # Operator Android push registration -> chat API only
    location /api/push/ {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

'''
if 'location /api/push/' in before:
    if block not in before:
        raise SystemExit('A different push route already exists; refusing to overwrite')
    print('Push route is already installed')
    raise SystemExit(0)
if before.count(anchor) != 1:
    raise SystemExit('Expected widget route anchor is not unique; refusing to edit')
after = before.replace(anchor, block + anchor, 1)
print(''.join(difflib.unified_diff(before.splitlines(True), after.splitlines(True), fromfile=str(config), tofile=str(config))))
if mode != 'apply':
    raise SystemExit(0)
subprocess.run(['nginx', '-t'], check=True)
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup = pathlib.Path('/var/backups/zhivaya-chat-codex') / (stamp + '-push-routing')
backup.mkdir(parents=True, mode=0o700)
shutil.copy2(config, backup / 'nginx.conf')
metadata = {'config': str(config), 'before_sha256': hashlib.sha256(before.encode()).hexdigest(), 'after_sha256': hashlib.sha256(after.encode()).hexdigest()}
(backup / 'manifest.json').write_text(json.dumps(metadata, indent=2) + '\n')
try:
    config.write_text(after)
    subprocess.run(['nginx', '-t'], check=True)
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
except BaseException:
    shutil.copy2(backup / 'nginx.conf', config)
    subprocess.run(['nginx', '-t'], check=True)
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
    raise
print('BACKUP=' + str(backup))
print(json.dumps(metadata))
'@
$remoteScript | ssh -o BatchMode=yes -o ConnectTimeout=12 -o StrictHostKeyChecking=yes root@5.129.241.152 "python3 - $mode"
if ($LASTEXITCODE -ne 0) { throw 'Push routing operation failed.' }
