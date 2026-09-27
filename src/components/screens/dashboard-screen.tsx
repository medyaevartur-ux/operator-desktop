import { useEffect, useState } from "react";
import { BarChart3, RefreshCw, Clock, MessagesSquare, Star, CircleCheck } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Select } from "@/components/ui";
import s from "./DashboardScreen.module.css";
interface Stats { days:number;summary:{total:number;closed:number;response_seconds:number|null;rating:string|null;ratings:number};daily:Array<{day:string;chats:number;closed:number}>;operators:Array<{id:string;name:string;status:string;is_online:boolean;handled:number;active:number;rating:string|null}>;queue:{waiting:number;longest_wait_seconds:number} }
const duration=(seconds:number|null)=>seconds==null?"—":seconds<60?`${seconds} сек.`:`${Math.round(seconds/60)} мин.`;
export function DashboardScreen() {
  const [days,setDays]=useState("7"),[data,setData]=useState<Stats|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(true);
  const load=async()=>{setLoading(true);setError("");try{setData(await api<Stats>(`/api/chat-v8/stats?days=${days}`))}catch{setError("Не удалось загрузить статистику. Попробуйте ещё раз.")}finally{setLoading(false)}};
  useEffect(()=>{void load()},[days]);
  const maximum=Math.max(1,...(data?.daily.map(item=>item.chats)||[]));
  return <section className={s.page}><header className={s.header}><div><h1>Статистика команды</h1><p>Реальные обращения, время ответа и оценки.</p></div><Select value={days} onChange={setDays} options={[{value:"7",label:"Последние 7 дней"},{value:"30",label:"Последние 30 дней"},{value:"90",label:"Последние 90 дней"}]}/><Button variant="secondary" icon={<RefreshCw size={16}/>} onClick={()=>void load()} disabled={loading}>Обновить</Button></header>
    {error&&<p className={s.error} role="alert">{error}</p>}
    <div className={s.metrics}>{[{label:"Обращений",value:data?.summary.total??"—",icon:MessagesSquare},{label:"Завершено",value:data?.summary.closed??"—",icon:CircleCheck},{label:"Первый ответ",value:duration(data?.summary.response_seconds??null),icon:Clock},{label:"Оценка клиентов",value:data?.summary.rating?`${data.summary.rating} / 5`:"Пока нет оценок",icon:Star}].map(item=><article key={item.label}><item.icon size={19}/><span>{item.label}</span><strong>{item.value}</strong></article>)}</div>
    <div className={s.grid}><section className={s.chart}><h2>Обращения по дням</h2><p>Даты по Екатеринбургу · завершённые выделены тёмным</p>{data?.daily.length?<div className={s.bars}>{data.daily.map(item=><div key={item.day} className={s.bar} title={`${item.day}: ${item.chats} обращений, ${item.closed} завершено`}><span>{item.chats}</span><div style={{height:`${Math.max(3,item.chats/maximum*160)}px`}}><i style={{height:`${item.chats?item.closed/item.chats*100:0}%`}}/></div><small>{item.day.slice(8)}.{item.day.slice(5,7)}</small></div>)}</div>:<div className={s.empty}><BarChart3 size={30}/>{loading?"Загружаем данные…":"За этот период обращений пока нет"}</div>}</section><aside className={s.queue}><Clock size={24}/><h2>Сейчас в очереди</h2><strong>{data?.queue.waiting??"—"}</strong><p>{data?.queue.waiting?`Самое долгое ожидание — ${duration(data.queue.longest_wait_seconds)}`:"Все текущие обращения распределены"}</p><small>Ожидание считается по незакреплённым диалогам.</small></aside></div>
    <section className={s.team}><h2>Работа операторов</h2><div className={s.tableWrap}><table><thead><tr><th>Оператор</th><th>Обработано</th><th>Активных</th><th>Оценка</th></tr></thead><tbody>{data?.operators.map(item=><tr key={item.id}><td><i data-online={item.is_online}/>{item.name}</td><td>{item.handled}</td><td>{item.active}</td><td>{item.rating||"—"}</td></tr>)}</tbody></table></div>{!data?.operators.length&&!loading&&<p className={s.empty}>Данные появятся после первых ответов.</p>}</section>
  </section>;
}
