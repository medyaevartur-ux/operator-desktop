import { useState } from "react";
import { History, MessageCircle, Star, User, X, Clock } from "lucide-react";
import { Avatar } from "@/components/ui";
import { formatChatTime, getSessionStatusLabel } from "@/features/inbox/inbox.utils";
import { getChatMessages } from "@/features/inbox/inbox.api";
import type { ChatSession, ChatMessage } from "@/types/chat";
import s from "./SessionHistory.module.css";

/* ── Session Preview Modal ── */

function SessionPreviewModal({
  session,
  onClose,
}: {
  session: ChatSession;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useState(() => {
    getChatMessages(session.id)
      .then(setMessages)
      .catch(() => setMessages([]))
      .finally(() => setIsLoading(false));
  });

  return (
    <div className={s.modalOverlay} onClick={onClose}>
      <div className={s.modal} onClick={(e) => e.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <div className={s.modalTitle}>
              Диалог от {new Date(session.created_at).toLocaleDateString("ru-RU")}
            </div>
            <div className={s.modalMeta}>
              {getSessionStatusLabel(session.status)} • {session.messages_count ?? 0} сообщений
              {session.rating && <> • ⭐ {session.rating}</>}
            </div>
          </div>
          <button type="button" className={s.modalClose} onClick={onClose}>
            <X style={{ width: 18, height: 18 }} />
          </button>
        </div>

        <div className={s.modalBody}>
          {isLoading && <div className={s.modalLoading}>Загрузка...</div>}

          {!isLoading && messages.length === 0 && (
            <div className={s.modalEmpty}>Нет сообщений</div>
          )}

          {messages.map((msg) => {
            if (msg.sender === "system") {
              return (
                <div key={msg.id} className={s.previewSystem}>
                  {msg.message}
                </div>
              );
            }

            const isOp = msg.sender === "operator";
            const isVisitor = msg.sender === "visitor";

            return (
              <div
                key={msg.id}
                className={`${s.previewMsg} ${isOp ? s.previewMsgRight : s.previewMsgLeft}`}
              >
                <div className={s.previewSender}>
                  {msg.sender === "ai" ? "AI" : isOp ? "Оператор" : "Клиент"}
                  <span className={s.previewTime}>
                    {new Date(msg.created_at).toLocaleTimeString("ru-RU", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <div
                  className={`${s.previewBubble} ${
                    isOp ? s.previewBubbleOp : isVisitor ? s.previewBubbleVisitor : s.previewBubbleAi
                  }`}
                >
                  {msg.is_deleted ? "Сообщение удалено" : msg.message}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── SessionHistoryList ── */

export function SessionHistoryList({
  sessions,
  currentSessionId,
}: {
  sessions: ChatSession[];
  currentSessionId: string;
}) {
  const [previewSession, setPreviewSession] = useState<ChatSession | null>(null);

  const pastSessions = sessions.filter((ses) => ses.id !== currentSessionId);

  if (pastSessions.length === 0) {
    return <div className={s.emptyHistory}>Первое обращение клиента</div>;
  }

  return (
    <>
      <div className={s.historyList}>
        {pastSessions.map((ses) => (
          <button
            key={ses.id}
            type="button"
            className={s.historyCard}
            onClick={() => setPreviewSession(ses)}
          >
            <div className={s.historyCardTop}>
              <span className={s.historyDate}>
                {new Date(ses.created_at).toLocaleDateString("ru-RU", {
                  day: "numeric",
                  month: "short",
                  year: ses.created_at.startsWith(String(new Date().getFullYear()))
                    ? undefined
                    : "numeric",
                })}
              </span>
              <span className={`${s.historyStatus} ${
                ses.status === "closed" ? s.historyStatusClosed :
                ses.status === "with_operator" ? s.historyStatusOp : s.historyStatusAi
              }`}>
                {getSessionStatusLabel(ses.status)}
              </span>
            </div>

            <div className={s.historyCardBottom}>
              <div className={s.historyMeta}>
                <MessageCircle style={{ width: 12, height: 12 }} />
                {ses.messages_count ?? 0}
              </div>
              {ses.rating && (
                <div className={s.historyMeta}>
                  <Star style={{ width: 12, height: 12 }} />
                  {ses.rating}
                </div>
              )}
              {(ses as any).operator_name && (
                <div className={s.historyMeta}>
                  <User style={{ width: 12, height: 12 }} />
                  {(ses as any).operator_name}
                </div>
              )}
            </div>
          </button>
        ))}
      </div>

      {previewSession && (
        <SessionPreviewModal
          session={previewSession}
          onClose={() => setPreviewSession(null)}
        />
      )}
    </>
  );
}