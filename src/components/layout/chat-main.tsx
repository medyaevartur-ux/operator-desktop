import { useEffect, useRef, useState, useCallback } from "react";
import { useInboxStore } from "@/store/inbox.store";
import { useNavigationStore } from "@/store/navigation.store";
import { useAuthStore } from "@/store/auth.store";
import { useInboxHotkeys } from "@/features/inbox/use-hotkeys";
import { toggleReaction, editMessage, deleteMessage } from "@/features/inbox/inbox.api";
import { ChatComposer } from "@/components/layout/chat-composer";
import { TypingPreview } from "@/components/layout/typing-preview";
import { Avatar, Button, Tooltip } from "@/components/ui";
import { SkeletonMessage } from "@/components/ui";
import { useConfirm } from "@/components/ui";
import { getSessionDisplayName, getAvatarGradient } from "@/utils/avatar";
import { motion, AnimatePresence } from "framer-motion";
import type { ChatMessage } from "@/types/chat";
import {
  Search,
  X,
  PanelRightOpen,
  PanelRightClose,
  UserCheck,
  XCircle,
  ArrowDown,
  SmilePlus,
  Reply,
  Pencil,
  Trash2,
  Check,
  Info,
} from "lucide-react";
import s from "./ChatMain.module.css";

/* ── helpers ── */

function formatTime(d: string) {
  return new Date(d).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function formatDateLabel(d: string) {
  const date = new Date(d);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Сегодня";
  if (date.toDateString() === yesterday.toDateString()) return "Вчера";
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

function senderLabel(sender: string) {
  if (sender === "visitor") return "Клиент";
  if (sender === "ai") return "AI-бот";
  if (sender === "operator") return "Оператор";
  return "";
}

function senderColor(sender: string) {
  if (sender === "visitor") return "var(--status-info)";
  if (sender === "ai") return "var(--accent)";
  if (sender === "operator") return "var(--status-online)";
  return "var(--text-muted)";
}

function isImageUrl(str: string): boolean {
  if (!str) return false;
  try {
    const url = new URL(str);
    return /\.(jpg|jpeg|png|webp|gif)$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function canEditOrDelete(msg: ChatMessage, operatorId: string | undefined): boolean {
  if (!operatorId) return false;
  if (msg.sender !== "operator" || msg.operator_id !== operatorId) return false;
  if (msg.is_deleted) return false;
  return Date.now() - new Date(msg.created_at).getTime() < 5 * 60 * 1000;
}

function statusLabel(status: string) {
  if (status === "ai") return "AI-бот";
  if (status === "with_operator") return "С оператором";
  if (status === "closed") return "Закрыт";
  return status;
}

const QUICK_REACTIONS = ["👍", "❤️", "🥇", "🔥", "✅", "👀"];

const bubbleVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
};

const bubbleTransition = { duration: 0.2, ease: [0.16, 1, 0.3, 1] as const };

/* ── Lightbox ── */

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className={s.lightbox} onClick={onClose} role="dialog" aria-modal="true">
      <img
        src={src}
        alt=""
        className={s.lightboxImg}
        onClick={(e) => e.stopPropagation()}
      />
      <button className={s.lightboxClose} onClick={onClose} type="button" aria-label="Закрыть">
        <X style={{ width: 24, height: 24 }} />
      </button>
    </div>
  );
}

/* ══════════════════════════════════
   ChatMain
   ══════════════════════════════════ */

export function ChatMain() {
  useInboxHotkeys();

  const activeSession = useInboxStore((st) => st.activeSession);
  const messages = useInboxStore((st) => st.messages);
  const isMessagesLoading = useInboxStore((st) => st.isMessagesLoading);
  const searchQuery = useInboxStore((st) => st.searchQuery);
  const searchInMessages = useInboxStore((st) => st.searchInMessages);
  const messageSearchResults = useInboxStore((st) => st.messageSearchResults);
  const isMessageSearching = useInboxStore((st) => st.isMessageSearching);
  const setSearchQuery = useInboxStore((st) => st.setSearchQuery);
  const assignActiveSession = useInboxStore((st) => st.assignActiveSession);
  const closeActiveSession = useInboxStore((st) => st.closeActiveSession);
  const loadMessages = useInboxStore((st) => st.loadMessages);

  const operator = useAuthStore((st) => st.operator);
  const isDetailsOpen = useNavigationStore((st) => st.isDetailsOpen);
  const toggleDetails = useNavigationStore((st) => st.toggleDetails);

  const { confirm } = useConfirm();
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [hoveredMsgId, setHoveredMsgId] = useState<string | null>(null);
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<string | null>(null);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const replyTo = useInboxStore((st) => st.replyTo);
  const setReplyTo = useInboxStore((st) => st.setReplyTo);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleScroll = () => {
      setShowScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight > 300);
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  const handleReaction = async (msgId: string, emoji: string) => {
    if (!operator?.id) return;
    await toggleReaction(msgId, operator.id, emoji);
    setReactionPickerMsgId(null);
    void loadMessages();
  };

  const handleEdit = async (msgId: string) => {
    if (!operator?.id || !editingText.trim()) return;
    await editMessage(msgId, editingText.trim(), operator.id);
    setEditingMsgId(null);
    setEditingText("");
    void loadMessages();
  };

  const handleDelete = async (msgId: string) => {
    if (!operator?.id) return;
    const ok = await confirm({
      title: "Удалить сообщение?",
      message: "Сообщение будет помечено как удалённое для всех участников.",
      confirmText: "Удалить",
      cancelText: "Отмена",
      danger: true,
    });
    if (!ok) return;
    await deleteMessage(msgId, operator.id);
    void loadMessages();
  };

  // Group messages by date
  const groupedMessages = messages.reduce<{ date: string; msgs: typeof messages }[]>((acc, msg) => {
    const d = new Date(msg.created_at).toDateString();
    const last = acc[acc.length - 1];
    if (last && last.date === d) last.msgs.push(msg);
    else acc.push({ date: d, msgs: [msg] });
    return acc;
  }, []);

  // Last operator msg for delivery receipt
  const lastOperatorMsg = [...messages].reverse().find((m) => m.sender === "operator");

  /* ── No session ── */
  if (!activeSession) {
    return (
      <main className={s.placeholder}>
        <div className={s.placeholderInner}>
          <div className={s.placeholderIcon}>
            <Search style={{ width: 32, height: 32 }} />
          </div>
          <div className={s.placeholderTitle}>Выберите диалог</div>
          <div className={s.placeholderDesc}>Откройте чат слева, чтобы начать общение с клиентом</div>
        </div>
      </main>
    );
  }

  const displayName = getSessionDisplayName(activeSession.visitor_name, activeSession.visitor_id);

  return (
    <main className={s.main}>
      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}

      {/* ── Header ── */}
      <header className={s.header}>
        <div className={s.headerLeft}>
          <Avatar name={displayName} size="md" />
          <div className={s.headerInfo}>
            <div className={s.headerName}>
              {activeSession.is_vip && <span className={s.headerVip}>VIP</span>}
              {displayName}
            </div>
            <div className={s.headerStatus}>{statusLabel(activeSession.status)}</div>
            {activeSession.current_page && (
              <div className={s.headerPageBadge} title={activeSession.current_page}>
                📄 {activeSession.current_page_title || activeSession.current_page}
              </div>
            )}            
          </div>
        </div>

        <div className={s.headerActions}>
          <Tooltip content="Забрать" side="bottom">
            <button type="button" className={s.ghostBtn} onClick={() => void assignActiveSession()}>
              <UserCheck style={{ width: 16, height: 16 }} />
            </button>
          </Tooltip>

          <Tooltip content="Закрыть диалог" side="bottom">
            <button
              type="button"
              className={s.ghostBtn}
              onClick={async () => {
                const ok = await confirm({
                  title: "Закрыть диалог?",
                  message: "Клиент не сможет продолжить переписку в этом чате.",
                  confirmText: "Закрыть",
                  danger: true,
                });
                if (ok) void closeActiveSession();
              }}
            >
              <XCircle style={{ width: 16, height: 16 }} />
            </button>
          </Tooltip>

          <div className={s.headerSearch}>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void searchInMessages();
                if (e.key === "Escape") setSearchQuery("");
              }}
              placeholder="Поиск..."
              className={s.headerSearchInput}
            />
            {searchQuery && (
              <button type="button" onClick={() => setSearchQuery("")} className={s.headerSearchClear}>
                <X style={{ width: 14, height: 14 }} />
              </button>
            )}
          </div>

          <Tooltip content={isDetailsOpen ? "Скрыть панель" : "Показать панель"} side="bottom">
            <button type="button" className={s.ghostBtn} onClick={toggleDetails}>
              {isDetailsOpen
                ? <PanelRightClose style={{ width: 16, height: 16 }} />
                : <PanelRightOpen style={{ width: 16, height: 16 }} />}
            </button>
          </Tooltip>
        </div>
      </header>

      {/* Search results banner */}
      {messageSearchResults.length > 0 && (
        <div className={s.searchBanner}>Найдено: {messageSearchResults.length} сообщений</div>
      )}
      {isMessageSearching && <div className={s.searchingBanner}>Ищем...</div>}

      {/* Reply bar */}
      {replyTo && (
        <div className={s.replyBar}>
          <Reply style={{ width: 16, height: 16, color: "var(--accent)" }} />
          <div className={s.replyInfo}>
            <div className={s.replySender}>{senderLabel(replyTo.sender)}</div>
            <div className={s.replyText}>{replyTo.message}</div>
          </div>
          <button type="button" onClick={() => setReplyTo(null)} className={s.replyClose}>
            <X style={{ width: 14, height: 14 }} />
          </button>
        </div>
      )}

      {/* ── Messages ── */}
      <div ref={containerRef} className={`${s.messages} scrollbar-thin`}>
        {/* Skeleton loading */}
        {isMessagesLoading && (
          <div className={s.loadingWrap}>
            <SkeletonMessage align="left" />
            <SkeletonMessage align="right" />
            <SkeletonMessage align="left" />
            <SkeletonMessage align="right" />
          </div>
        )}

        {!isMessagesLoading && messages.length === 0 && (
          <div className={s.placeholder} style={{ height: "auto", padding: 40 }}>
            <div className={s.placeholderDesc}>Нет сообщений</div>
          </div>
        )}

        {groupedMessages.map((group) => (
          <div key={group.date}>
            {/* Date separator */}
            <div className={s.dateSep}>
              <div className={s.dateLine} />
              <span className={s.dateLabel}>{formatDateLabel(group.msgs[0].created_at)}</span>
              <div className={s.dateLine} />
            </div>

            {group.msgs.map((msg, idx) => {
              const prev = idx > 0 ? group.msgs[idx - 1] : null;
              const showHeader = !prev || prev.sender !== msg.sender;
              const isHovered = hoveredMsgId === msg.id;
              const canModify = canEditOrDelete(msg, operator?.id);
              const isEditing = editingMsgId === msg.id;
              const isLastOperatorMsg = msg.id === lastOperatorMsg?.id;
              const isOperator = msg.sender === "operator";
              const isVisitor = msg.sender === "visitor";

              // System message
              if (msg.sender === "system") {
                const isAutoResponse = msg.message_type === "auto_response";
                return (
                  <div key={msg.id} className={`${s.systemMsg} ${isAutoResponse ? s.systemMsgAuto : ""}`}>
                    <div className={`${s.systemBubble} ${isAutoResponse ? s.systemBubbleAuto : ""}`}>
                      {isAutoResponse ? (
                        <span style={{ fontSize: 14 }}>⚡</span>
                      ) : (
                        <Info style={{ width: 14, height: 14 }} />
                      )}
                      {isAutoResponse && <span className={s.autoTag}>Автоответ</span>}
                      {msg.message}
                    </div>
                  </div>
                );
              }

              // Deleted message
              if (msg.is_deleted) {
                return (
                  <div key={msg.id} className={`${s.deletedMsg} ${isOperator ? s.deletedMsgRight : s.deletedMsgLeft}`} style={{ marginBottom: 8 }}>
                    <div className={s.deletedBubble}>
                      <Trash2 style={{ width: 14, height: 14 }} />
                      Сообщение удалено
                    </div>
                  </div>
                );
              }

              const messageIsImage = msg.message_type === "image" || isImageUrl(msg.message);
              const attachments: { url: string; filename?: string }[] = (() => {
                try {
                  if (msg.attachments && typeof msg.attachments === "string") return JSON.parse(msg.attachments);
                  if (Array.isArray(msg.attachments)) return msg.attachments;
                } catch { /* */ }
                return [];
              })();
              const imageUrl = messageIsImage ? (attachments[0]?.url || msg.message) : null;
              const replyRef = msg.reply_to_id
                ? (msg.reply_to_message
                  ? { sender: msg.reply_to_sender || "visitor", message: msg.reply_to_message }
                  : messages.find((m) => m.id === msg.reply_to_id))
                : null;

              return (
                <motion.div
                  key={msg.id}
                  variants={bubbleVariants}
                  initial="initial"
                  animate="animate"
                  transition={bubbleTransition}
                  className={`${s.msgRow} ${isOperator ? s.msgRowRight : s.msgRowLeft} ${showHeader ? s.msgRowSpaced : s.msgRowTight}`}
                  onMouseEnter={() => setHoveredMsgId(msg.id)}
                  onMouseLeave={() => {
                    setHoveredMsgId(null);
                    if (reactionPickerMsgId === msg.id) setReactionPickerMsgId(null);
                  }}
                >
                  {/* Message header */}
                  {showHeader && (
                    <div className={`${s.msgHeader} ${isOperator ? s.msgHeaderReverse : ""}`}>
                      <Avatar name={senderLabel(msg.sender)} size="sm" />
                      <span className={s.msgSender} style={{ color: senderColor(msg.sender) }}>
                        {senderLabel(msg.sender)}
                      </span>
                      <span className={s.msgTime}>{formatTime(msg.created_at)}</span>
                    </div>
                  )}

                  {/* Reply reference */}
                  {replyRef && (
                    <div className={s.replyRef}>
                      <span className={s.replyRefSender}>{senderLabel(replyRef.sender)}: </span>
                      {replyRef.message.slice(0, 100)}{replyRef.message.length > 100 ? "..." : ""}
                    </div>
                  )}

                  {/* Action bar on hover — positioned ABOVE bubble */}
                  {isHovered && !isEditing && (
                    <div className={`${s.actionBar} ${isOperator ? s.actionBarRight : s.actionBarLeft}`}>
                      <button type="button" className={s.msgAction} onClick={() => setReactionPickerMsgId(msg.id)}>
                        <SmilePlus style={{ width: 14, height: 14 }} />
                      </button>
                      <button type="button" className={s.msgAction} onClick={() => setReplyTo(msg)}>
                        <Reply style={{ width: 14, height: 14 }} />
                      </button>
                      {canModify && (
                        <>
                          <button
                            type="button"
                            className={s.msgAction}
                            onClick={() => { setEditingMsgId(msg.id); setEditingText(msg.message); }}
                          >
                            <Pencil style={{ width: 14, height: 14 }} />
                          </button>
                          <button
                            type="button"
                            className={`${s.msgAction} ${s.msgActionDanger}`}
                            onClick={() => void handleDelete(msg.id)}
                          >
                            <Trash2 style={{ width: 14, height: 14 }} />
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {/* Reaction picker */}
                  {reactionPickerMsgId === msg.id && (
                    <div className={s.reactionPicker}>
                      {QUICK_REACTIONS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          className={s.reactionBtn}
                          onClick={() => void handleReaction(msg.id, emoji)}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Image message */}
                  {imageUrl ? (
                    <div className={s.imageMsg} onClick={() => setLightboxSrc(imageUrl)}>
                      <img src={imageUrl} alt="Фото" className={s.imageMain} loading="lazy" />
                      {attachments.length > 1 && (
                        <div className={s.imageThumbs}>
                          {attachments.slice(1).map((att, ai) => (
                            <img
                              key={ai}
                              src={att.url}
                              alt=""
                              className={s.imageThumb}
                              onClick={(e) => { e.stopPropagation(); setLightboxSrc(att.url); }}
                              loading="lazy"
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ) : isEditing ? (
                    /* Edit mode */
                    <div className={s.editWrap}>
                      <textarea
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        autoFocus
                        className={s.editTextarea}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleEdit(msg.id); }
                          if (e.key === "Escape") { setEditingMsgId(null); setEditingText(""); }
                        }}
                      />
                      <div className={s.editActions}>
                        <Button variant="secondary" size="sm" onClick={() => { setEditingMsgId(null); setEditingText(""); }}>
                          Отмена
                        </Button>
                        <Button variant="primary" size="sm" onClick={() => void handleEdit(msg.id)}>
                          Сохранить
                        </Button>
                      </div>
                    </div>
                  ) : (
                    /* Text bubble */
                    <div
                      className={`${s.bubble} ${
                        isOperator ? s.bubbleOperator : isVisitor ? s.bubbleVisitor : s.bubbleAi
                      }`}
                    >
                      {msg.message}
                      {msg.is_edited && <span className={s.bubbleEdited}>(ред.)</span>}
                      {!showHeader && (
                        <div className={`${s.bubbleTimeSub} ${isOperator ? s.operator : s.other}`}>
                          {formatTime(msg.created_at)}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Reactions display */}
                  {msg.reactions && msg.reactions.length > 0 && (
                    <div className={`${s.reactionsRow} ${isOperator ? s.reactionsRight : s.reactionsLeft}`}>
                      {Object.entries(
                        msg.reactions.reduce<Record<string, { emoji: string; count: number; operators: string[]; hasOwn: boolean }>>((acc, r) => {
                          if (!acc[r.emoji]) acc[r.emoji] = { emoji: r.emoji, count: 0, operators: [], hasOwn: false };
                          acc[r.emoji].count++;
                          acc[r.emoji].operators.push(r.operator_name || "Оператор");
                          if (r.operator_id === operator?.id) acc[r.emoji].hasOwn = true;
                          return acc;
                        }, {})
                      ).map(([emoji, data]) => (
                        <button
                          key={emoji}
                          type="button"
                          className={`${s.reactionPill} ${data.hasOwn ? s.reactionPillActive : ""}`}
                          title={data.operators.join(", ")}
                          onClick={() => void handleReaction(msg.id, emoji)}
                        >
                          <span>{emoji}</span>
                          {data.count > 1 && <span className={s.reactionCount}>{data.count}</span>}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Delivery receipt — only "Доставлено" */}
                  {isOperator && (
                    <div className={s.receipt}>
                      {msg.status === "read" ? (
                        <>
                          <span className={s.receiptChecksRead}>✓✓</span>
                          <span className={s.receiptTextRead}>Прочитано</span>
                        </>
                      ) : msg.status === "delivered" ? (
                        <>
                          <span className={s.receiptChecks}>✓✓</span>
                          <span className={s.receiptText}>Доставлено</span>
                        </>
                      ) : isLastOperatorMsg ? (
                        <>
                          <Check style={{ width: 14, height: 14, color: "var(--text-disabled)" }} />
                          <span className={s.receiptText}>Отправлено</span>
                        </>
                      ) : null}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        ))}

        {/* Scroll-to-bottom (sticky inside scroll container) */}
        {showScrollBtn && (
          <button type="button" onClick={scrollToBottom} className={s.scrollBtn}>
            <ArrowDown style={{ width: 18, height: 18 }} />
          </button>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Typing preview ── */}
      {activeSession && <TypingPreview sessionId={activeSession.id} />}

      {/* ── Composer ── */}
      <div className={s.composerArea}>
        <ChatComposer />
      </div>
    </main>
  );
}