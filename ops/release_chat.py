#!/usr/bin/env python3
"""Scoped release for alphabet-chat-api. Default is a read-only plan.

Apply only after operators and the website loader are ready for v8. Never run a
DB down migration on rollback: preserve messages received during the cutover.
--widget-only publishes a new widget and swaps the reviewed loader filename in
nginx without touching the chat service, its release directory or the database.
"""
import argparse, datetime, difflib, hashlib, json, os, pathlib, re, shutil, subprocess, tarfile, time, urllib.request, urllib.error
from urllib.parse import urlparse, unquote
BASE=pathlib.Path('/opt/alphabet-chat-api')
SERVICE='alphabet-chat-api'
NGINX=pathlib.Path('/etc/nginx/sites-enabled/zhivaya-skazka.ru')
DROPIN=pathlib.Path('/etc/systemd/system/alphabet-chat-api.service.d/90-codex-v8.conf')
WIDGET=pathlib.Path('/var/www/widget')
BACKUPS=pathlib.Path('/var/backups/zhivaya-chat-codex')
STOREFRONT='https://zhivaya-skazka.ru'
TABLES=['auto_response_rules','chat_operators','chat_session_tags','chat_settings','chat_tags','client_notes','message_reactions','operator_activity_logs','proactive_invitations','push_tokens','site_visitors','visitor_page_views','widget_ab_results','widget_blocked_visitors','widget_chat_messages','widget_chat_sessions','widget_offline_leads','widget_scenario_states','widget_scenarios','chat_v8_migrations','chat_v8_auth_sessions','chat_v8_devices','chat_v8_events','chat_v8_deliveries','chat_v8_notification_preferences','chat_v8_templates','chat_v8_routing_settings','chat_v8_files']
LOADER_NAME=r'loader\.v8-[a-f0-9]{16}\.js'
def execute(args, **kwargs):
    return subprocess.run(args,check=True,**kwargs)
def sha(path):return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()
def confined(path):
    resolved=pathlib.Path(path).resolve()
    if resolved!=BASE and BASE not in resolved.parents:raise RuntimeError('Path is outside this chat project')
    return resolved
def tree_digest(root):
    entries=[]
    for file in sorted((root/'src').rglob('*')):
        if file.is_file():entries.append((str(file.relative_to(root)),sha(file)))
    for name in ['package.json','package-lock.json','tsconfig.json']:
        if (root/name).is_file():entries.append((name,sha(root/name)))
    return hashlib.sha256('\n'.join(name+' '+digest for name,digest in sorted(entries)).encode()).hexdigest()
def current():
    values={}
    for line in subprocess.check_output(['systemctl','show',SERVICE,'-p','WorkingDirectory','-p','MainPID','-p','ActiveState','-p','NRestarts'],text=True).splitlines():
        key,value=line.split('=',1);values[key]=value
    directory=confined(values['WorkingDirectory']);values['source_tree_sha256']=tree_digest(directory)
    values['nginx_sha256']=sha(NGINX);return directory,values
def env_file(path,node,module_root):
    code="const fs=require('fs'),dotenv=require(process.argv[1]+'/node_modules/dotenv');process.stdout.write(JSON.stringify(dotenv.parse(fs.readFileSync(process.argv[2]))));"
    # Secret-bearing output stays in this process, never in the release log.
    return json.loads(subprocess.check_output([node,'-e',code,str(module_root),str(path)],text=True))
def status(url):
    try:
        with urllib.request.urlopen(url,timeout=8) as response:return response.status,response.read(512000)
    except urllib.error.HTTPError as error:return error.code,b''
def loader_block(loader):
    """The exact storefront block the first v8 release installed; upgrades change only the filename."""
    script='<script data-chat-widget="v8" defer src="/widget/'+loader+'"></script>'
    return '    # Codex v8 widget loader\n        proxy_set_header Accept-Encoding "";\n        sub_filter_once on;\n        sub_filter_last_modified off;\n        sub_filter \'</head>\' \''+script+'</head>\';\n'
_head,_tail=loader_block('|').split('|')
LOADER_BLOCK=re.compile(re.escape(_head)+'('+LOADER_NAME+')'+re.escape(_tail))
def install_routes(text,loader=None):
    additions=[]
    for route in ['/api/chat-v8/','/api/invitations']:
        if re.search(r'location\s+(?:\^~\s+)?'+re.escape(route)+r'\s*\{',text):continue
        additions.append('    location '+route+' {\n        proxy_pass http://127.0.0.1:3010;\n        proxy_http_version 1.1;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;\n    }\n')
    anchor='    # Widget API -> API 3010\n'
    if additions and text.count(anchor)!=1:raise RuntimeError('Nginx anchor changed; review the exact routing diff')
    result=text.replace(anchor,'    # Operator v8 API only\n'+''.join(additions)+'\n'+anchor,1) if additions else text
    if loader:
        if not re.fullmatch(LOADER_NAME,loader):raise RuntimeError('Unexpected widget loader filename')
        marker='    # Codex v8 widget loader\n'
        if marker in result:
            # Reviewed upgrade: the whole installed block must be intact; only its versioned loader changes.
            found=LOADER_BLOCK.findall(result)
            if len(found)!=1 or result.count(marker)!=1:raise RuntimeError('The v8 loader block no longer matches the reviewed shape; review nginx by hand')
            return result.replace(loader_block(found[0]),loader_block(loader),1)
        root_anchor='    location / {\n'
        if result.count(root_anchor)!=1:raise RuntimeError('Storefront proxy anchor changed')
        result=result.replace(root_anchor,root_anchor+loader_block(loader),1)
        static=''
        for name in ['widget.js','widget.min.js']:
            static+='    location = /widget/'+name+' {\n        alias /var/www/widget/'+name+';\n        add_header Cache-Control "no-cache" always;\n        add_header Access-Control-Allow-Origin "*" always;\n    }\n'
        result=result.replace('    # Widget files\n','    # Versioned v8 loader owns lazy initialization; stable SDK URLs revalidate.\n'+static+'\n    # Widget files\n',1)
    return result

def unpack_widget(archive,expected,destination):
    if sha(archive)!=expected:raise RuntimeError('Widget archive digest mismatch')
    destination.mkdir()
    with tarfile.open(archive) as pack:
        entries=pack.getmembers()
        if sum(item.size for item in entries)>3000000:raise RuntimeError('Widget archive exceeds expected size')
        for item in entries:
            name=pathlib.PurePosixPath(item.name)
            if name.is_absolute() or '..' in name.parts or item.issym() or item.islnk() or (not item.isfile() and not item.isdir()):raise RuntimeError('Unsafe widget archive entry')
        pack.extractall(destination,filter='data')
    manifest=json.loads((destination/'widget-release.json').read_text())
    if manifest['source_file']!='widget.js':raise RuntimeError('Unexpected widget source')
    if not re.fullmatch(r'widget\.v8-[a-f0-9]{16}\.min\.js',manifest['bundle_file']):raise RuntimeError('Unexpected widget bundle')
    if not re.fullmatch(LOADER_NAME,manifest['loader_file']):raise RuntimeError('Unexpected widget loader')
    if set(manifest['files'])!={manifest['source_file'],manifest['bundle_file'],manifest['loader_file']}:raise RuntimeError('Unexpected widget manifest')
    if {str(p.relative_to(destination)) for p in destination.rglob('*') if p.is_file()}!=set(manifest['files'])|{'widget-release.json'}:raise RuntimeError('Unexpected extra widget files')
    for name,digest in manifest['files'].items():
        if sha(destination/name)!=digest:raise RuntimeError('Widget file digest mismatch: '+name)
    return manifest

def publish_widget(widget,source):
    """Hashed bundle/loader are immutable; the stable widget.js/widget.min.js URLs are replaced atomically."""
    for name in [widget['bundle_file'],widget['loader_file']]:
        target=WIDGET/name
        if target.exists() and sha(target)!=widget['files'][name]:raise RuntimeError('Immutable widget asset conflict')
        shutil.copyfile(source/name,target);os.chmod(target,0o644)
    for name,target in [('widget.js','widget.js'),(widget['bundle_file'],'widget.min.js')]:
        temporary=WIDGET/('.v8-incoming-'+target)
        shutil.copyfile(source/name,temporary);os.chmod(temporary,0o644);os.replace(temporary,WIDGET/target)

def storefront_serves(loader):
    # Reload acknowledges the signal before new nginx workers accept connections.
    for _ in range(15):
        code,body=status(STOREFRONT+'/')
        if code==200 and loader.encode() in body:return True
        time.sleep(1)
    return False

def release_widget(args):
    """Widget-only release on top of a live v8: new files plus the loader filename in nginx."""
    import fcntl
    if not all([args.widget_archive,args.widget_archive_sha,args.expected_nginx_sha,args.expected_widget_sha]):raise RuntimeError('Exact widget archive and live digests are required')
    with open(BASE/'.v8-release.lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        if sha(NGINX)!=args.expected_nginx_sha.lower() or sha(WIDGET/'widget.min.js')!=args.expected_widget_sha.lower():raise RuntimeError('Live nginx or widget changed; refusing to overwrite it')
        if not LOADER_BLOCK.search(NGINX.read_text()):raise RuntimeError('No reviewed v8 loader in nginx yet; use the full release first')
        code,body=status('http://127.0.0.1:3010/api/chat-v8/meta')
        if code!=200 or not str(json.loads(body or b'{}').get('version','')).startswith('8.'):raise RuntimeError('The widget needs the live v8 chat server')
        execute(['nginx','-t'],stdout=subprocess.DEVNULL)
        stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        staging=BASE/'releases'/('widget-'+stamp)
        widget=unpack_widget(confined(args.widget_archive),args.widget_archive_sha.lower(),staging)
        candidate=install_routes(NGINX.read_text(),widget['loader_file'])
        backup=BACKUPS/(stamp+'-widget');backup.mkdir(mode=0o700,parents=True)
        shutil.copy2(NGINX,backup/'nginx.conf')
        (backup/'widget').mkdir()
        for name in ['widget.js','widget.min.js']:shutil.copy2(WIDGET/name,backup/'widget'/name)
        record={'kind':'widget','staging':str(staging),'archive_sha256':args.widget_archive_sha.lower(),'manifest':widget,
                'before':{'nginx_sha256':sha(NGINX),'widget':{name:sha(WIDGET/name) for name in ['widget.js','widget.min.js']}}}
        (backup/'manifest.json').write_text(json.dumps(record,indent=2)+'\n')
        try:
            publish_widget(widget,staging)
            NGINX.write_text(candidate);execute(['nginx','-t'],stdout=subprocess.DEVNULL)
            execute(['systemctl','reload','nginx'])
            if not storefront_serves(widget['loader_file']):raise RuntimeError('Storefront widget loader probe failed')
            for name in [widget['loader_file'],widget['bundle_file']]:
                if status(STOREFRONT+'/widget/'+name)[0]!=200:raise RuntimeError('Widget asset probe failed: '+name)
        except BaseException:
            shutil.copy2(backup/'nginx.conf',NGINX)
            for name in ['widget.js','widget.min.js']:shutil.copy2(backup/'widget'/name,WIDGET/name)
            execute(['nginx','-t'],stdout=subprocess.DEVNULL);execute(['systemctl','reload','nginx'])
            print(json.dumps({'rollback':True,'backup':str(backup)}),flush=True)
            raise
        record['after']={'nginx_sha256':sha(NGINX),'widget_sha256':sha(WIDGET/'widget.min.js')}
        (backup/'manifest.json').write_text(json.dumps(record,indent=2)+'\n')
        print(json.dumps({'released':True,'widget_only':True,'backup':str(backup),'widget_sha256':record['after']['widget_sha256'],'loader':widget['loader_file']}),flush=True)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--archive');parser.add_argument('--archive-sha');parser.add_argument('--expected-live-sha');parser.add_argument('--expected-nginx-sha');parser.add_argument('--widget-archive');parser.add_argument('--widget-archive-sha');parser.add_argument('--expected-widget-sha');parser.add_argument('--loader',help='plan only: show the nginx diff for this loader file');parser.add_argument('--widget-only',action='store_true');parser.add_argument('--clients-ready',action='store_true');parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    directory,live=current();print(json.dumps({'service':SERVICE,'directory':str(directory),'live':live,'widget_sha256':sha(WIDGET/'widget.min.js'),'new_routes':['/api/chat-v8/','/api/invitations'],'apply':args.apply}),flush=True)
    if not args.apply:
        if args.loader:
            text=NGINX.read_text()
            print(''.join(difflib.unified_diff(text.splitlines(True),install_routes(text,args.loader).splitlines(True),'nginx/live','nginx/candidate')) or 'nginx: no change',flush=True)
        return
    if args.widget_only:return release_widget(args)
    import fcntl
    if not args.clients_ready:raise RuntimeError('Updated operator clients and website loader must be ready before the strict server is switched')
    if not all([args.archive,args.archive_sha,args.expected_live_sha,args.expected_nginx_sha,args.widget_archive,args.widget_archive_sha,args.expected_widget_sha]):raise RuntimeError('Exact server/widget archives and live digests are required')
    archive=confined(args.archive)
    if sha(archive)!=args.archive_sha.lower():raise RuntimeError('Archive digest mismatch')
    env_path=BASE/'.env.chat-v8'
    if not env_path.is_file() or env_path.stat().st_mode&0o077:raise RuntimeError('Prepare private .env.chat-v8 with mode 0600 first')
    with open(BASE/'.v8-release.lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        directory,live=current()
        if live['source_tree_sha256']!=args.expected_live_sha.lower() or live['nginx_sha256']!=args.expected_nginx_sha.lower():raise RuntimeError('Live state changed; refusing to overwrite it')
        if sha(WIDGET/'widget.min.js')!=args.expected_widget_sha.lower():raise RuntimeError('Live widget changed')
        if '--with-http_sub_module' not in subprocess.run(['nginx','-V'],capture_output=True,text=True,check=True).stderr:raise RuntimeError('Nginx widget loader filter unavailable')
        execute(['nginx','-t'],stdout=subprocess.DEVNULL)
        stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        release=BASE/'releases'/('v8-'+stamp);release.mkdir(parents=True,exist_ok=False)
        with tarfile.open(archive) as package:
            for member in package.getmembers():
                name=pathlib.PurePosixPath(member.name)
                if name.is_absolute() or '..' in name.parts or member.issym() or member.islnk():raise RuntimeError('Unsafe archive entry')
                if any(part in ['.env','.env.chat-v8','firebase-service-account.json','node_modules','private_uploads','uploads','.git'] for part in name.parts):raise RuntimeError('Unexpected private archive entry')
            package.extractall(release,filter='data')
        manifest=json.loads((release/'build-manifest.json').read_text())
        for entry in manifest['files']:
            file=release/entry['path']
            if release not in file.resolve().parents or sha(file)!=entry['sha256']:raise RuntimeError('Release contents do not match the reviewed manifest')
        widget=unpack_widget(confined(args.widget_archive),args.widget_archive_sha,release/'widget-release')
        candidate=install_routes(NGINX.read_text(),widget['loader_file'])
        node='/usr/bin/node'
        if int(subprocess.check_output([node,'-p','process.versions.node.split(".")[0]'],text=True).strip())<22:raise RuntimeError('Use the reviewed Node 22+ runtime')
        with open(release/'dependencies.log','w') as log:execute(['/usr/bin/npm','ci','--omit=dev'],cwd=release,stdout=log,stderr=subprocess.STDOUT)
        (release/'.env').symlink_to(BASE/'.env')
        (release/'uploads').symlink_to(BASE/'uploads',target_is_directory=True)
        environment={**os.environ,**env_file(BASE/'.env',node,release),**env_file(env_path,node,release)}
        if environment.get('PUBLIC_ORIGIN')!='https://zhivaya-skazka.ru' or len(environment.get('JWT_SECRET',''))<32:raise RuntimeError('Unexpected application environment')
        storage=confined(environment['PRIVATE_UPLOAD_DIR']);storage.mkdir(mode=0o700,exist_ok=True)
        # Preserve database state on the same server. Only chat-owned tables are included.
        backup=BACKUPS/(stamp+'-v8');backup.mkdir(mode=0o700,parents=True)
        url=urlparse(environment['DATABASE_URL'])
        pg_env={**os.environ,'PGHOST':url.hostname or '127.0.0.1','PGPORT':str(url.port or 5432),'PGDATABASE':unquote(url.path.lstrip('/')),'PGUSER':unquote(url.username or ''),'PGPASSWORD':unquote(url.password or '')}
        execute(['pg_dump','--format=custom','--file='+str(backup/'chat-before.dump')]+['--table=public.'+table for table in TABLES],env=pg_env,stdout=subprocess.DEVNULL)
        os.chmod(backup/'chat-before.dump',0o600)
        shutil.copy2(NGINX,backup/'nginx.conf')
        (backup/'widget').mkdir()
        for name in ['widget.js','widget.min.js']:shutil.copy2(WIDGET/name,backup/'widget'/name)
        previous=DROPIN.read_bytes() if DROPIN.exists() else None
        if previous is not None:(backup/'previous-dropin.conf').write_bytes(previous)
        with open(backup/'previous-source.tgz','wb') as output:execute(['tar','-czf','-','-C',str(directory),'src','package.json','package-lock.json','tsconfig.json'],stdout=output)
        record={'before':live,'before_directory':str(directory),'release':str(release),'archive_sha256':args.archive_sha,'version':manifest['version'],'dropin_existed':previous is not None,'database_backup':str(backup/'chat-before.dump')}
        record['widget']={'before':{name:sha(WIDGET/name) for name in ['widget.js','widget.min.js']},'manifest':widget,'archive_sha256':args.widget_archive_sha}
        (backup/'manifest.json').write_text(json.dumps(record,indent=2)+'\n')
        with open(backup/'migrations.log','w') as log:execute([node,'scripts/migrate.mjs','--apply'],cwd=release,env=environment,stdout=log,stderr=subprocess.STDOUT)
        if sha(NGINX)!=args.expected_nginx_sha or sha(WIDGET/'widget.min.js')!=args.expected_widget_sha:raise RuntimeError('Live configuration changed during preparation')
        DROPIN.parent.mkdir(parents=True,exist_ok=True)
        widget_changed=False
        try:
            DROPIN.write_text('[Service]\nWorkingDirectory='+str(release)+'\nEnvironmentFile='+str(env_path)+'\nExecStart=\nExecStart='+node+' '+str(release/'dist/server.js')+'\n')
            NGINX.write_text(candidate);execute(['nginx','-t'],stdout=subprocess.DEVNULL)
            execute(['systemctl','daemon-reload']);execute(['systemctl','restart',SERVICE])
            ready=False
            for _ in range(30):
                try:
                    code,body=status('http://127.0.0.1:3010/health')
                    if code==200 and json.loads(body).get('service')=='zhivaya-chat-v8':ready=True;break
                except Exception:pass
                time.sleep(1)
            if not ready:raise RuntimeError('Chat health check failed')
            widget_changed=True
            publish_widget(widget,release/'widget-release')
            execute(['systemctl','reload','nginx'])
            external_code=0
            for _ in range(15):
                external_code=status(STOREFRONT+'/api/chat-v8/devices')[0]
                if external_code==401:break
                time.sleep(1)
            if external_code!=401:raise RuntimeError('Authenticated route check failed: HTTP '+str(external_code))
            if not storefront_serves(widget['loader_file']):raise RuntimeError('Storefront widget loader probe failed')
            if status(STOREFRONT+'/ws/socket.io.min.js')[0]!=200:raise RuntimeError('Widget Socket.IO library probe failed')
        except BaseException:
            if previous is None:DROPIN.unlink(missing_ok=True)
            else:DROPIN.write_bytes(previous)
            shutil.copy2(backup/'nginx.conf',NGINX)
            if widget_changed:
                for name in ['widget.js','widget.min.js']:shutil.copy2(backup/'widget'/name,WIDGET/name)
            execute(['systemctl','daemon-reload']);execute(['systemctl','restart',SERVICE]);execute(['nginx','-t'],stdout=subprocess.DEVNULL);execute(['systemctl','reload','nginx'])
            print(json.dumps({'rollback':True,'backup':str(backup),'database_restored':False}),flush=True)
            raise
        record['after']={'nginx_sha256':sha(NGINX),'dropin_sha256':sha(DROPIN),'source_tree_sha256':tree_digest(release),'widget_sha256':sha(WIDGET/'widget.min.js')}
        (backup/'manifest.json').write_text(json.dumps(record,indent=2)+'\n')
        print(json.dumps({'released':True,'version':manifest['version'],'directory':str(release),'backup':str(backup),'archive_sha256':args.archive_sha,'widget_sha256':record['after']['widget_sha256'],'loader':widget['loader_file'],'native_clients_required':True}),flush=True)
if __name__=='__main__':main()
