import { useMemo } from "react";
import { ArrowRight, Eye, Hourglass, MessagesSquare } from "lucide-react";
import { useInboxStore } from "@/store/inbox.store";
import { useAuthStore } from "@/store/auth.store";
import { useVisitorsStore } from "@/store/visitors.store";
import { useNavigationStore } from "@/store/navigation.store";
import { groupConversations, queueCount } from "@/features/inbox/conversation-list";
import { pickConversation } from "@/lib/open-conversation";
import s from "./InboxHome.module.css";

function greeting(hour: number) {
  if (hour >= 5 && hour < 12) return "Доброе утро";
  if (hour >= 12 && hour < 17) return "Добрый день";
  if (hour >= 17 && hour < 23) return "Добрый вечер";
  return "Доброй ночи";
}

const plural = (n: number, one: string, few: string, many: string) => {
  const mod10 = n % 10, mod100 = n % 100;
  return mod10 === 1 && mod100 !== 11 ? one : mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20) ? few : many;
};

/** Экран без выбранного диалога: спокойная сводка вместо пустоты. */
export function InboxHome() {
  const operator = useAuthStore(state => state.operator);
  const sessions = useInboxStore(state => state.sessions);
  const online = useVisitorsStore(state => state.onlineCount);
  const setScreen = useNavigationStore(state => state.setScreen);
  const manager = operator?.role === "admin" || operator?.role === "supervisor";
  const firstName = operator?.name?.trim().split(/\s+/)[0];

  const { waiting, mine, queue } = useMemo(() => {
    const groups = groupConversations(sessions, { filter: "all", me: operator?.id });
    return {
      waiting: groups.find(group => group.key === "waiting")?.items ?? [],
      mine: groups.find(group => group.key === "mine")?.items ?? [],
      queue: queueCount(sessions),
    };
  }, [sessions, operator?.id]);

  const summary = waiting.length
    ? `${waiting.length} ${plural(waiting.length, "диалог ждёт", "диалога ждут", "диалогов ждут")} ответа`
    : mine.length ? `У вас в работе ${mine.length} ${plural(mine.length, "диалог", "диалога", "диалогов")}` : "Новых обращений пока нет";

  return (
    <section className={s.home} aria-labelledby="inbox-home-title">
      <img src="/book-mark.svg" alt="" className={s.mark} />
      <h1 id="inbox-home-title" className={s.title}>{greeting(new Date().getHours())}{firstName ? `, ${firstName}` : ""}</h1>
      <p className={s.summary}>{summary}</p>
      <div className={s.actions}>
        {waiting[0] && (
          <button type="button" className={s.action} onClick={() => pickConversation(waiting[0])}>
            <MessagesSquare /><span>Ответить тому, кто ждёт дольше всех</span><ArrowRight className={s.arrow} />
          </button>
        )}
        {mine[0] && (
          <button type="button" className={s.action} onClick={() => pickConversation(mine[0])}>
            <MessagesSquare /><span>Вернуться к диалогу в работе</span><ArrowRight className={s.arrow} />
          </button>
        )}
        <button type="button" className={s.action} onClick={() => setScreen("queue")}>
          <Hourglass /><span>Очередь</span><em>{queue}</em><ArrowRight className={s.arrow} />
        </button>
        {manager && (
          <button type="button" className={s.action} onClick={() => setScreen("visitors")}>
            <Eye /><span>Посетители на сайте</span><em>{online}</em><ArrowRight className={s.arrow} />
          </button>
        )}
      </div>
    </section>
  );
}
