import { useEffect, useMemo, useState } from "react";
import { Clock, Inbox, ArrowRight, RefreshCw, Flag } from "lucide-react";
import { getQueueSessions, assignSession } from "@/features/inbox/inbox.api";
import { useInboxStore } from "@/store/inbox.store";
import { useAuthStore } from "@/store/auth.store";
import { useDeliveryStore } from "@/store/delivery.store";
import { useNavigationStore } from "@/store/navigation.store";
import { getSocket } from "@/lib/socket";
import { getSessionDisplayName } from "@/utils/avatar";
import { Avatar, Button, Select, toast } from "@/components/ui";
import type { ChatSession } from "@/types/chat";
import s from "./QueueScreen.module.css";
const wait=(session:ChatSession,now:number)=>Math.max(0,Math.floor((now-Date.parse(session.queued_at||session.created_at))/1000));
const duration=(seconds:number)=>seconds<60?`${seconds} сек.`:seconds<3600?`${Math.floor(seconds/60)} мин. ${seconds%60} сек.`:`${Math.floor(seconds/3600)} ч. ${Math.floor(seconds%3600/60)} мин.`;
export function QueueScreen() {
  const [queue,setQueue]=useState<ChatSession[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(""),[sort,setSort]=useState("wait"),[busy,setBusy]=useState("");
  const [now,setNow]=useState(Date.now());
  const operator=useAuthStore(state=>state.operator),limit=useDeliveryStore(state=>state.routing.escalation_minutes)*60;
  const load=async()=>{try{setQueue(await getQueueSessions());setError("")}catch{setError("Не удалось обновить очередь. Показываем последнее доступное состояние.")}finally{setLoading(false)}};
  useEffect(()=>{void load();const socket=getSocket();socket.on("queue_updated",load);socket.on("session_updated",load);socket.on("connect",load);const poll=setInterval(()=>void load(),30000),timer=setInterval(()=>setNow(Date.now()),1000);return()=>{clearInterval(poll);clearInterval(timer);socket.off("queue_updated",load);socket.off("session_updated",load);socket.off("connect",load)}},[]);
  const list=useMemo(()=>[...queue].sort((a,b)=>{const rank={urgent:3,high:2,normal:1,low:0};return sort==="priority"&&(rank[b.priority]||0)!==(rank[a.priority]||0)?(rank[b.priority]||0)-(rank[a.priority]||0):Date.parse(a.queued_at||a.created_at)-Date.parse(b.queued_at||b.created_at)}),[queue,sort]);
  const open=(session:ChatSession)=>{useInboxStore.getState().openSession(session);useNavigationStore.setState({screen:"inbox",mobileView:"chat-conversation"})};
  const claim=async(session:ChatSession)=>{if(!operator)return;setBusy(session.id);try{await assignSession(session.id,operator.id);await useInboxStore.getState().loadSessions();open(useInboxStore.getState().sessions.find(item=>item.id===session.id)||{...session,operator_id:operator.id,status:"with_operator"});await load()}catch(failure){toast.error(failure instanceof Error?failure.message:"Не удалось взять диалог");await load()}finally{setBusy("")}};
  return <section className={s.page}><header className={s.header}><div><h1>Очередь обращений</h1><p>Новые диалоги, которые ждут оператора.</p></div><Button variant="secondary" icon={<RefreshCw size={16}/>} onClick={()=>void load()}>Обновить</Button></header><div className={s.summary}><article><Inbox size={21}/><div><strong>{queue.length}</strong><span>ждут ответа</span></div></article><article><Clock size={21}/><div><strong>{queue.length?duration(Math.max(...queue.map(item=>wait(item,now)))):"—"}</strong><span>самое долгое ожидание</span></div></article><article><Flag size={21}/><div><strong>{queue.filter(item=>wait(item,now)>=limit).length}</strong><span>ждут дольше {Math.round(limit/60)} мин.</span></div></article></div>
    <div className={s.toolbar}><h2>Поможем по порядку</h2><Select value={sort} onChange={setSort} options={[{value:"wait",label:"Сначала дольше ждут"},{value:"priority",label:"Сначала срочные"}]}/></div>{error&&<p className={s.error} role="alert">{error}</p>}
    <div className={s.list}>{list.map((session,index)=>{const name=getSessionDisplayName(session.visitor_name,session.visitor_id),seconds=wait(session,now);return <article className={s.item} data-late={seconds>=limit} key={session.id}><span className={s.number}>{String(index+1).padStart(2,"0")}</span><Avatar name={name} size="md"/><button className={s.preview} onClick={()=>open(session)}><strong>{name}{session.is_vip&&<small>VIP</small>}</strong><p>{session.last_message_text||"Клиент запросил помощь оператора"}</p><span>{session.current_page_title||"На сайте Живой Сказки"}</span></button><div className={s.wait}><Clock size={13}/><span>{duration(seconds)}</span>{seconds>=limit&&<small>Ждёт ответа</small>}</div><Button disabled={!!busy} icon={<ArrowRight size={16}/>} onClick={()=>void claim(session)}>{busy===session.id?"Назначаем…":"Ответить"}</Button></article>})}{!list.length&&<div className={s.empty}><Circle/><h2>{loading?"Загружаем очередь…":error?"Очередь временно недоступна":"Каждый клиент услышан"}</h2><p>{loading?"":error?"Проверьте связь и обновите список.":"Сейчас нет обращений без оператора. Новые появятся здесь автоматически."}</p></div>}</div>
  </section>;
}
function Circle(){return <div className={s.emptyIcon}><Inbox size={28}/></div>}
