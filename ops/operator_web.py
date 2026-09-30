#!/usr/bin/env python3
"""Web version of the operator app (iPhone, browser) at operator.zhivaya-skazka.ru: static files only, no API.
Default: read-only plan. --apply publishes a prepared operator-web.tgz; the first run also obtains the
Let's Encrypt certificate (webroot, nginx reloads itself on renewal) and writes the nginx site.
--rollback switches back to the previous release. nginx is reloaded only when the site changed and
`nginx -t` passes; a rejected site is restored to the previous file."""
import argparse, datetime, hashlib, json, os, pathlib, shutil, socket, subprocess, tarfile, tempfile

DOMAIN = 'operator.zhivaya-skazka.ru'
SERVER_IP = '5.129.241.152'
BASE = pathlib.Path('/var/www/operator')
RELEASES, CURRENT, ACME = BASE / 'releases', BASE / 'current', BASE / 'acme'
SITE = pathlib.Path('/etc/nginx/sites-available') / DOMAIN
ENABLED = pathlib.Path('/etc/nginx/sites-enabled') / DOMAIN
LIVE = pathlib.Path('/etc/letsencrypt/live') / DOMAIN
ACCOUNTS = pathlib.Path('/etc/letsencrypt/accounts/acme-v02.api.letsencrypt.org/directory')
REQUIRED = {'index.html', 'sw.js', 'manifest.webmanifest', 'apple-touch-icon.png'}
KEEP = 5

# Internal tool: never indexed, framed only by itself (widget preview), HTTPS only.
SECURITY = ['add_header X-Robots-Tag "noindex, nofollow" always;', 'add_header X-Content-Type-Options "nosniff" always;',
            'add_header X-Frame-Options "SAMEORIGIN" always;', 'add_header Referrer-Policy "same-origin" always;',
            'add_header Strict-Transport-Security "max-age=31536000" always;']

def security(indent):
    return ('\n' + ' ' * indent).join(SECURITY)

def http_server(rest):
    return f'''server {{
    listen 80;
    server_name {DOMAIN};
    location /.well-known/acme-challenge/ {{ root {ACME}; }}
    location / {{ {rest} }}
}}
'''

HTTP_ONLY = http_server('return 404;')
FULL = http_server(f'return 301 https://{DOMAIN}$request_uri;') + f'''
server {{
    listen 443 ssl;
    server_name {DOMAIN};
    ssl_certificate {LIVE}/fullchain.pem;
    ssl_certificate_key {LIVE}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    root {CURRENT};
    index index.html;
    gzip_vary on;
    gzip_types text/css application/javascript text/javascript application/json application/manifest+json image/svg+xml;
    {security(4)}
    # Everything revalidates (ETag, 304), so a release reaches the phone on the next launch.
    add_header Cache-Control "no-cache" always;
    # The app has no URL routes: unknown paths are 404, not the app shell.
    location / {{ try_files $uri $uri/ =404; }}
    location = /manifest.webmanifest {{ default_type application/manifest+json; }}
    # Hashed build files never change.
    location /assets/ {{
        {security(8)}
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }}
}}
'''

def run(*command):
    return subprocess.run(command, capture_output=True, text=True)

def releases():
    return sorted(path for path in RELEASES.iterdir() if path.is_dir() and not path.name.startswith('.')) if RELEASES.exists() else []

def current():
    return CURRENT.resolve() if CURRENT.is_symlink() else None

def switch(target):
    temp = BASE / '.current-next'
    if temp.is_symlink() or temp.exists(): temp.unlink()
    temp.symlink_to(target, target_is_directory=True)
    os.replace(temp, CURRENT)

def unapplied_nginx_edits():
    """Config files edited after nginx last started or reloaded: our reload would apply them too (the shop included)."""
    log = run('journalctl', '-u', 'nginx', '--no-pager', '-o', 'short-unix')
    loaded = [float(line.split(' ', 1)[0]) for line in log.stdout.splitlines() if ' Reloaded ' in line or ' Started ' in line]
    if not loaded: return None
    return sorted(str(path) for path in pathlib.Path('/etc/nginx').rglob('*') if path.is_file() and path.stat().st_mtime > loaded[-1])

def write_site(text):
    """Write the nginx site and reload only when it changed; restore the previous file if nginx rejects it."""
    previous = SITE.read_text() if SITE.exists() else None
    if previous == text and ENABLED.is_symlink(): return
    SITE.write_text(text)
    if not ENABLED.is_symlink(): ENABLED.symlink_to(SITE)
    test = run('nginx', '-t')
    if test.returncode != 0:
        if previous is None: ENABLED.unlink(); SITE.unlink()
        else: SITE.write_text(previous)
        raise SystemExit('nginx rejected the site, previous configuration restored: ' + test.stderr[-400:])
    reload = run('systemctl', 'reload', 'nginx')
    if reload.returncode != 0: raise SystemExit('nginx reload failed: ' + reload.stderr[-400:])

def unpack(archive, digest):
    if hashlib.sha256(archive.read_bytes()).hexdigest() != digest: raise SystemExit('Archive SHA256 mismatch')
    with tarfile.open(archive, 'r:gz') as bundle:
        members = bundle.getmembers()
        for member in members:
            name = pathlib.PurePosixPath(member.name)
            if name.is_absolute() or '..' in name.parts or not (member.isfile() or member.isdir()):
                raise SystemExit('Unexpected archive entry: ' + member.name)
        missing = REQUIRED - {str(pathlib.PurePosixPath(member.name)) for member in members if member.isfile()}
        if missing: raise SystemExit('Archive lacks ' + ', '.join(sorted(missing)))
        staging = pathlib.Path(tempfile.mkdtemp(prefix='.staging-', dir=RELEASES))
        bundle.extractall(staging, filter='data')
    for path in [staging, *staging.rglob('*')]: os.chmod(path, 0o755 if path.is_dir() else 0o644)
    target = RELEASES / datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    staging.rename(target)
    return target

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true'); parser.add_argument('--rollback', action='store_true')
    parser.add_argument('--archive'); parser.add_argument('--archive-sha')
    args = parser.parse_args()
    try: resolved = socket.gethostbyname(DOMAIN)
    except OSError: resolved = None
    live = current()
    state = {'domain': DOMAIN, 'dns': resolved, 'dns_ok': resolved == SERVER_IP,
             'site': 'current' if SITE.exists() and SITE.read_text() == FULL else 'differs' if SITE.exists() else 'absent',
             'certificate': (LIVE / 'fullchain.pem').exists(), 'acme_accounts': len(list(ACCOUNTS.iterdir())) if ACCOUNTS.exists() else 0,
             'current': live.name if live else None, 'releases': [path.name for path in releases()],
             'disk_free_mb': shutil.disk_usage('/').free // 2**20, 'nginx_unapplied_edits': unapplied_nginx_edits(),
             'mode': 'apply' if args.apply else 'rollback' if args.rollback else 'plan'}
    if args.rollback:
        previous = [path for path in releases() if live is None or path.name < live.name]
        if not previous: raise SystemExit('No earlier release to roll back to')
        switch(previous[-1]); state['current'] = previous[-1].name
    elif args.apply:
        if not state['dns_ok']: raise SystemExit(f'{DOMAIN} does not point to {SERVER_IP} yet')
        if not args.archive or not args.archive_sha: raise SystemExit('--apply needs --archive and --archive-sha')
        if state['nginx_unapplied_edits'] != [] and state['site'] != 'current':
            raise SystemExit('nginx has edits it has not loaded yet (or no reload history); review them first: ' + json.dumps(state['nginx_unapplied_edits']))
        for path in (RELEASES, ACME): path.mkdir(parents=True, exist_ok=True)
        release = unpack(pathlib.Path(args.archive), args.archive_sha)
        switch(release)
        if not state['certificate']:
            write_site(HTTP_ONLY)
            issued = run('certbot', 'certonly', '--webroot', '-w', str(ACME), '-d', DOMAIN, '--non-interactive',
                         '--keep-until-expiring', '--deploy-hook', 'systemctl reload nginx')
            if issued.returncode != 0: raise SystemExit('certbot failed: ' + (issued.stderr or issued.stdout)[-600:])
        write_site(FULL)
        for old in releases()[:-KEEP]:
            if old != release: shutil.rmtree(old)
        pathlib.Path(args.archive).unlink(missing_ok=True)
        state.update(current=release.name, site='current', certificate=True, releases=[path.name for path in releases()])
    print(json.dumps(state, ensure_ascii=False, indent=1))

if __name__ == '__main__':
    main()
