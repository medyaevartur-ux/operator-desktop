#!/usr/bin/env python3
"""Restore only the chat unit and its reviewed nginx backup; never restore the DB.

A <UTC>-v8 backup restores the previous service release, nginx and widget.
A <UTC>-widget backup (release_chat.py --widget-only) restores nginx and the widget only.
Roll back newer releases first: each backup refuses to run once live files moved on.
"""
import argparse, hashlib, json, pathlib, shutil, subprocess
BASE=pathlib.Path('/opt/alphabet-chat-api')
BACKUPS=pathlib.Path('/var/backups/zhivaya-chat-codex')
DROPIN=pathlib.Path('/etc/systemd/system/alphabet-chat-api.service.d/90-codex-v8.conf')
NGINX=pathlib.Path('/etc/nginx/sites-enabled/zhivaya-skazka.ru')
WIDGET=pathlib.Path('/var/www/widget')
WIDGET_FILES=['widget.js','widget.min.js']
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def run(*args):subprocess.run(args,check=True)
def rollback_widget(backup,record,apply):
    import fcntl
    if record.get('kind')!='widget':raise SystemExit('Legacy widget backup from deploy-widget.ps1: restore its two files by hand after review')
    after=record.get('after') or {}
    print(json.dumps({'backup':str(backup),'widget_from':after.get('widget_sha256'),'widget_to':record['before']['widget']['widget.min.js'],'nginx_restored':True,'apply':apply}),flush=True)
    if not apply:return
    with open(BASE/'.v8-release.lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        if not after:raise SystemExit('This widget release did not complete; it already restored itself')
        if sha(NGINX)!=after.get('nginx_sha256') or sha(WIDGET/'widget.min.js')!=after.get('widget_sha256'):raise SystemExit('Live nginx or widget changed; refusing to overwrite it')
        nginx_now=NGINX.read_bytes();widget_now={name:(WIDGET/name).read_bytes() for name in WIDGET_FILES}
        try:
            shutil.copy2(backup/'nginx.conf',NGINX)
            for name in WIDGET_FILES:shutil.copy2(backup/'widget'/name,WIDGET/name)
            run('nginx','-t');run('systemctl','reload','nginx')
        except BaseException:
            NGINX.write_bytes(nginx_now)
            for name,data in widget_now.items():(WIDGET/name).write_bytes(data)
            run('nginx','-t');run('systemctl','reload','nginx')
            raise
        print(json.dumps({'rolled_back':True,'widget_sha256':sha(WIDGET/'widget.min.js')}))
def main():
    import fcntl
    parser=argparse.ArgumentParser();parser.add_argument('--backup',required=True);parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    backup=pathlib.Path(args.backup).resolve()
    if backup.parent!=BACKUPS or not backup.name.endswith(('-v8','-widget')):raise SystemExit('Choose a chat v8 or widget release backup')
    record=json.loads((backup/'manifest.json').read_text())
    if backup.name.endswith('-widget'):return rollback_widget(backup,record,args.apply)
    release=pathlib.Path(record['release']).resolve()
    previous=pathlib.Path(record['before_directory']).resolve()
    if BASE not in release.parents or (previous!=BASE and BASE not in previous.parents):raise SystemExit('Unexpected release paths')
    print(json.dumps({'backup':str(backup),'from':str(release),'to':str(previous),'database_restored':False,'apply':args.apply}),flush=True)
    if not args.apply:return
    with open(BASE/'.v8-release.lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        current=subprocess.check_output(['systemctl','show','alphabet-chat-api','-p','WorkingDirectory','--value'],text=True).strip()
        if pathlib.Path(current).resolve()!=release:raise SystemExit('The live release changed; review before rollback')
        after=record.get('after',{})
        if sha(NGINX)!=after.get('nginx_sha256') or not DROPIN.exists() or sha(DROPIN)!=after.get('dropin_sha256'):raise SystemExit('Live routing or unit changed; refusing to overwrite it')
        if record.get('widget') and sha(WIDGET/'widget.min.js')!=after.get('widget_sha256'):raise SystemExit('Live widget changed; refusing to overwrite it')
        nginx_now=NGINX.read_bytes();unit_now=DROPIN.read_bytes()
        widget_now={name:(WIDGET/name).read_bytes() for name in WIDGET_FILES} if record.get('widget') else {}
        try:
            if record['dropin_existed']:shutil.copy2(backup/'previous-dropin.conf',DROPIN)
            else:DROPIN.unlink()
            shutil.copy2(backup/'nginx.conf',NGINX)
            for name in widget_now:shutil.copy2(backup/'widget'/name,WIDGET/name)
            run('nginx','-t');run('systemctl','daemon-reload');run('systemctl','restart','alphabet-chat-api');run('systemctl','reload','nginx')
            run('systemctl','is-active','--quiet','alphabet-chat-api')
        except BaseException:
            NGINX.write_bytes(nginx_now);DROPIN.write_bytes(unit_now)
            for name,data in widget_now.items():(WIDGET/name).write_bytes(data)
            run('nginx','-t');run('systemctl','daemon-reload');run('systemctl','restart','alphabet-chat-api');run('systemctl','reload','nginx')
            raise
        print(json.dumps({'rolled_back':True,'directory':str(previous),'database_restored':False}))
if __name__=='__main__':main()
