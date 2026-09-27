#!/usr/bin/env python3
"""Prepare only this chat app's private v8 configuration. No restart or migration."""
import argparse, json, os, pathlib, subprocess, tempfile
BASE=pathlib.Path('/opt/alphabet-chat-api')
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');parser.add_argument('--operator-origin',default='https://operator.zhivaya-skazka.ru');args=parser.parse_args()
    if BASE.resolve()!=BASE:raise SystemExit('Unexpected chat root')
    node='/usr/bin/node'
    code="const fs=require('fs'),d=require('/opt/alphabet-chat-api/node_modules/dotenv');process.stdout.write(JSON.stringify(d.parse(fs.readFileSync('/opt/alphabet-chat-api/.env'))))"
    legacy=json.loads(subprocess.check_output([node,'-e',code],text=True))
    target=BASE/'.env.chat-v8'
    existing={}
    if target.exists():
        code="const fs=require('fs'),d=require('/opt/alphabet-chat-api/node_modules/dotenv');process.stdout.write(JSON.stringify(d.parse(fs.readFileSync('/opt/alphabet-chat-api/.env.chat-v8'))))"
        existing=json.loads(subprocess.check_output([node,'-e',code],text=True))
    firebase=pathlib.Path(legacy.get('FIREBASE_SERVICE_ACCOUNT_PATH') or str(BASE/'firebase-service-account.json'))
    if not firebase.is_absolute():firebase=BASE/firebase
    if json.loads(firebase.read_text()).get('project_id')!='zhivaya-skazka-operator':raise SystemExit('Unexpected Firebase project')
    if len(legacy.get('JWT_SECRET',''))<32:raise SystemExit('Existing JWT secret is too short; review credentials separately')
    if args.operator_origin!='https://operator.zhivaya-skazka.ru':raise SystemExit('Review another operator origin before configuring it')
    complete=bool(existing.get('WEB_PUSH_PRIVATE_KEY') and existing.get('WEB_PUSH_PUBLIC_KEY'))
    if not args.apply:
        print(json.dumps({'file':str(target),'firebase_project_matches':True,'jwt_preserved':True,'vapid_keys_ready':complete,'would_create_keys':not complete,'service_restart':False}));return
    if not complete:
        keys=json.loads(subprocess.check_output([node,'-e',"process.stdout.write(JSON.stringify(require('/opt/alphabet-chat-api/.codex-v8-work/node_modules/web-push').generateVAPIDKeys()))"],text=True))
        existing.update(WEB_PUSH_PUBLIC_KEY=keys['publicKey'],WEB_PUSH_PRIVATE_KEY=keys['privateKey'])
    defaults={'PORT':'3010','HOST':'127.0.0.1','PUBLIC_ORIGIN':'https://zhivaya-skazka.ru','PRIVATE_UPLOAD_DIR':str(BASE/'private_uploads'),'FIREBASE_SERVICE_ACCOUNT_PATH':str(firebase),'WEB_PUSH_SUBJECT':'https://zhivaya-skazka.ru','CORS_ORIGINS':'https://zhivaya-skazka.ru,'+args.operator_origin+',http://tauri.localhost,https://tauri.localhost,tauri://localhost','PUSH_DRY_RUN':'false','ACCESS_TOKEN_MINUTES':'20','REFRESH_TOKEN_DAYS':'30'}
    for key,value in defaults.items():existing.setdefault(key,value)
    if any('\n' in value or '\r' in value for value in existing.values()):raise SystemExit('Unexpected multiline setting')
    descriptor,temp=tempfile.mkstemp(prefix='.chat-v8-',dir=BASE)
    try:
        os.fchmod(descriptor,0o600)
        with os.fdopen(descriptor,'w') as stream:stream.write('\n'.join(key+'='+value for key,value in sorted(existing.items()))+'\n')
        os.replace(temp,target)
    finally:
        if os.path.exists(temp):os.unlink(temp)
    print(json.dumps({'file':str(target),'mode':oct(target.stat().st_mode&0o777),'vapid_keys_ready':True,'jwt_preserved':True,'firebase_project_matches':True,'service_restart':False}))
if __name__=='__main__':main()
