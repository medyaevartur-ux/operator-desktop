import { useRef, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { Button, Modal, toast } from "@/components/ui";
interface AndroidRelease { version:string;version_code:number;size:number;notes:string }
export function AndroidUpdate() {
  const [release,setRelease]=useState<AndroidRelease|null>(null),[busy,setBusy]=useState(false),[downloaded,setDownloaded]=useState(false);
  const cancelled=useRef(false);
  const invoke=async<T,>(name:string,args?:Record<string,unknown>)=>(await import('@tauri-apps/api/core')).invoke<T>(name,args);
  const check=async()=>{setBusy(true);try{const next=await invoke<AndroidRelease|null>('android_update_check');setRelease(next);setDownloaded(false);if(!next)toast.success('Обновлений пока нет')}catch{toast.error('Не удалось проверить обновление. Попробуйте позже.')}finally{setBusy(false)}};
  const download=async()=>{setBusy(true);cancelled.current=false;try{const verified=await invoke<AndroidRelease>('android_update_download');if(!cancelled.current){setRelease(verified);setDownloaded(true)}}catch{if(!cancelled.current)toast.error('Не удалось скачать или проверить файл. Текущая версия сохранена.')}finally{setBusy(false)}};
  const install=async()=>{if(!release)return;try{const result=await invoke<{status:string}>('android_update_install',{versionCode:release.version_code});if(result.status==='permission_required')toast.info('Разрешите обновления из этого приложения, вернитесь и нажмите «Установить».')}catch{toast.error('Android не открыл установку. Проверьте разрешение и повторите.')}};
  const cancel=()=>{cancelled.current=true;void invoke('android_update_cancel').catch(()=>undefined);setRelease(null)};
  return <><Button variant="secondary" icon={<RefreshCw size={16}/>} disabled={busy} onClick={()=>void check()}>Проверить обновление Android</Button><Modal open={!!release} onClose={busy?cancel:()=>setRelease(null)} title={`Обновление ${release?.version||''}`} footer={<><Button variant="secondary" onClick={busy?cancel:()=>setRelease(null)}>{busy?'Отменить загрузку':'Позже'}</Button><Button icon={<Download size={16}/>} disabled={busy} onClick={()=>void(downloaded?install():download())}>{busy?'Скачиваем и проверяем…':downloaded?'Установить':'Скачать обновление'}</Button></>}>{release&&<div style={{fontSize:13,lineHeight:1.8}}><p>{Math.round(release.size/1024/1024)} МБ · проверка целостности и подписи приложения</p><p style={{whiteSpace:'pre-wrap',marginTop:12}}>{release.notes||'Улучшения приложения и исправления.'}</p>{downloaded&&<p>Файл проверен. Android запросит подтверждение установки.</p>}</div>}</Modal></>;
}
