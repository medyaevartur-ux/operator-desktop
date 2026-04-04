import {
  ArrowLeft,
  Send,
  Paperclip,
  MoreVertical,
  X,
  User,
  FileText,
  StickyNote,
  Phone,
  Mail,
  Globe,
  Check,
  CheckCheck,
  Reply,
  Download,
} from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import { useInboxStore } from "@/store/inbox.store";
import { useAuthStore } from "@/store/auth.store";
import { useNavigationStore } from "@/store/navigation.store";
import { useTypingIndicator } from "@/features/inbox/use-typing";
import { uploadMessageImage, toggleReaction } from "@/features/inbox/inbox.api";
import { Avatar } from "@/components/ui";
import { getSessionDisplayName } from "@/utils/avatar";
import { formatChatTime } from "@/features/inbox/inbox.utils";
import { API_BASE } from "@/lib/api";
import type { ChatMessage } from "@/types/chat";
import s from "./MobileChatView.module.css";

const EMOJI_LIST = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  if (isToday) return "Сегодня";
  if (isYesterday) return "Вчера";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function getStatusIcon(status?: string) {
  if (status === "read") return <CheckCheck size={12} />;
  if (status === "delivered") return <CheckCheck size={12} style={{ opacity: 0.5 }} />;
  return <Check size={12} style={{ opacity: 0.4 }} />;
}

function getAttachmentUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `${API_BASE}${path}`;
}

export function MobileChatView() {
  const {
    activeSession,
    messages,
    isMessagesLoading,
    sendMessage,
    replyTo,
    setReplyTo,
    assignActiveSession,
    closeActiveSession,
    changeActiveSessionStatus,
    notes,
    loadNotes,
    createNote,
    typingPreviews,
  } = useInboxStore();

  const operator = useAuthStore((s) => s.operator);
  const setMobileView = useNavigationStore((s) => s.setMobileView);
  const { isVisitorTyping, sendTyping } = useTypingIndicator();

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [showVisitorInfo, setShowVisitorInfo] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [noteInput, setNoteInput] = useState("");
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [menuMsg, setMenuMsg] = useState<{ msg: ChatMessage; x: number; y: number } | null>(null);
  const [showEmoji, setShowEmoji] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const displayName = activeSession
    ? getSessionDisplayName(activeSession.visitor_name, activeSession.visitor_id)
    : "";

  const typingPreview = activeSession?.id ? typingPreviews[activeSession.id] : null;

  // Scroll to bottom on new messages
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  // Load notes when panel opens
  useEffect(() => {
    if (showNotes && activeSession?.id) {
      void loadNotes(activeSession.id);
    }
  }, [showNotes, activeSession?.id]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput("");
    try {
      await sendMessage(text);
    } catch (e) {
      console.error("Send error:", e);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
    sendTyping();
  };

  // File upload
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeSession?.id || !operator?.id) return;
    e.target.value = "";

    try {
      setSending(true);
      await uploadMessageImage(activeSession.id, operator.id, file);
      await useInboxStore.getState().loadMessages(activeSession.id);
    } catch (err) {
      console.error("Upload error:", err);
    } finally {
      setSending(false);
    }
  };

  // Long press for context menu
  const handleTouchStart = useCallback((msg: ChatMessage, e: React.TouchEvent) => {
    const touch = e.touches[0];
    longPressTimer.current = setTimeout(() => {
      setMenuMsg({ msg, x: touch.clientX, y: touch.clientY });
    }, 500);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  // Reactions
  const handleReaction = async (messageId: string, emoji: string) => {
    if (!operator?.id) return;
    try {
      await toggleReaction(messageId, operator.id, emoji);
      await useInboxStore.getState().loadMessages(activeSession?.id);
    } catch (e) {
      console.error("Reaction error:", e);
    }
    setShowEmoji(null);
    setMenuMsg(null);
  };

  // Create note
  const handleCreateNote = async () => {
    const text = noteInput.trim();
    if (!text) return;
    setNoteInput("");
    await createNote(text);
  };

  // Session actions
  const handleTakeChat = async () => {
    setShowActions(false);
    await assignActiveSession();
    await useInboxStore.getState().loadSessions();
  };

  const handleCloseChat = async () => {
    setShowActions(false);
    await closeActiveSession();
    setMobileView("chat-list");
  };

  const handleReturnToAi = async () => {
    setShowActions(false);
    await changeActiveSessionStatus("ai");
  };

  // Group messages by date
  const groupedMessages: Array<{ type: "date"; label: string } | { type: "msg"; msg: ChatMessage }> = [];
  let lastDate = "";
  for (const msg of messages) {
    const dateKey = new Date(msg.created_at).toDateString();
    if (dateKey !== lastDate) {
      groupedMessages.push({ type: "date", label: formatDate(msg.created_at) });
      lastDate = dateKey;
    }
    groupedMessages.push({ type: "msg", msg });
  }

  const statusLabel =
    activeSession?.status === "with_operator"
      ? "Оператор"
      : activeSession?.status === "ai"
      ? "AI"
      : activeSession?.status === "waiting_operator"
      ? "В очереди"
      : activeSession?.status === "closed"
      ? "Закрыт"
      : activeSession?.status ?? "";

  return (
    <div className={s.container}>
      {/* ═══ Header ═══ */}
      <div className={s.header}>
        <button type="button" className={s.backBtn} onClick={() => setMobileView("chat-list")}>
          <ArrowLeft size={22} />
        </button>
        <Avatar name={displayName} size="sm" />
        <div className={s.headerInfo} onClick={() => setShowVisitorInfo(true)}>
          <div className={s.headerName}>{displayName}</div>
          <div className={s.headerStatus}>{statusLabel}</div>
        </div>
        <div className={s.headerActions}>
          <button type="button" className={s.headerActionBtn} onClick={() => { setShowNotes(true); }}>
            <StickyNote size={18} />
          </button>
          <button type="button" className={s.headerActionBtn} onClick={() => setShowActions(true)}>
            <MoreVertical size={18} />
          </button>
        </div>
      </div>

      {/* ═══ Messages ═══ */}
      <div className={s.messages} ref={listRef}>
        {isMessagesLoading && <div className={s.loadingText}>Загрузка...</div>}

        {groupedMessages.map((item, idx) => {
          if (item.type === "date") {
            return (
              <div key={`date-${idx}`} className={s.dateSeparator}>
                <span className={s.dateSeparatorText}>{item.label}</span>
              </div>
            );
          }

          const msg = item.msg;
          const isOperator = msg.sender === "operator";
          const isAi = msg.sender === "ai";
          const isSystem = msg.sender === "system";
          const isInternal = msg.is_internal;
          const isDeleted = msg.is_deleted;
          // Parse attachments — может быть массив, строка JSON или объект
          let parsedAttach: any = null;
          if (msg.attachments) {
            let att = msg.attachments;
            if (typeof att === "string") {
              try { att = JSON.parse(att); } catch { att = null; }
            }
            if (Array.isArray(att) && att.length > 0) {
              parsedAttach = att[0];
            } else if (att && typeof att === "object" && !Array.isArray(att)) {
              parsedAttach = att;
            }
          }

          const attachMime = parsedAttach?.mime_type || "";
          const isImage = msg.message_type === "image" || attachMime.startsWith("image/");
          const isFile = (msg.message_type === "file" || (parsedAttach && !attachMime.startsWith("image/"))) && !isImage;
          const attachUrl = parsedAttach?.url ? getAttachmentUrl(parsedAttach.url) : null;
          const fileName = parsedAttach?.filename || "Файл";

          let bubbleClass = s.bubbleVisitor;
          if (isSystem) bubbleClass = s.bubbleSystem;
          else if (isInternal) bubbleClass = s.bubbleInternal;
          else if (isDeleted) bubbleClass = s.bubbleDeleted;
          else if (isAi) bubbleClass = s.bubbleAi;
          else if (isOperator) bubbleClass = s.bubbleOperator;

          return (
            <div
              key={msg.id}
              className={`${s.bubble} ${bubbleClass}`}
              onTouchStart={(e) => handleTouchStart(msg, e)}
              onTouchEnd={handleTouchEnd}
              onTouchMove={handleTouchEnd}
            >
              {/* Reply preview */}
              {msg.reply_to_message && (
                <div className={`${s.bubbleReply} ${msg.sender === "visitor" ? s.bubbleReplyVisitor : ""}`}>
                  <div className={s.bubbleReplySender}>
                    {msg.reply_to_sender === "visitor" ? displayName : "Оператор"}
                  </div>
                  <div className={s.bubbleReplyText}>{msg.reply_to_message}</div>
                </div>
              )}

              {/* Image */}
              {isImage && attachUrl && (
                <img
                  src={attachUrl}
                  alt="Фото"
                  className={s.bubbleImage}
                  onClick={() => setLightboxUrl(attachUrl)}
                  loading="lazy"
                />
              )}

              {/* File */}
              {isFile && attachUrl && (
                <a href={attachUrl} target="_blank" rel="noopener noreferrer" className={s.bubbleFile}>
                  <FileText size={18} />
                  <span className={s.bubbleFileName}>{fileName}</span>
                  <Download size={16} />
                </a>
              )}

              {/* Text — не показываем URL если это вложение */}
              {msg.message && !isDeleted && !(isImage && attachUrl && msg.message === attachUrl) && (
                <div className={s.bubbleText}>{msg.message}</div>
              )}
              {isDeleted && (
                <div className={s.bubbleText}>Сообщение удалено</div>
              )}

              {/* Footer: time + status */}
              <div className={s.bubbleFooter}>
                <span className={s.bubbleTime}>{formatChatTime(msg.created_at)}</span>
                {isOperator && (
                  <span className={s.bubbleStatusIcon}>{getStatusIcon(msg.status)}</span>
                )}
              </div>

              {/* Reactions */}
              {msg.reactions && msg.reactions.length > 0 && (
                <div className={s.bubbleReactions}>
                  {msg.reactions.map((r) => (
                    <span
                      key={r.id}
                      className={s.reactionBadge}
                      onClick={() => handleReaction(msg.id, r.emoji)}
                      title={r.operator_name}
                    >
                      {r.emoji}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ═══ Typing indicator ═══ */}
      {isVisitorTyping && (
        <div className={s.typingIndicator}>
          <div className={s.typingDots}>
            <div className={s.typingDot} />
            <div className={s.typingDot} />
            <div className={s.typingDot} />
          </div>
          <span>{displayName} печатает...</span>
        </div>
      )}

      {/* Typing preview */}
      {typingPreview?.isTyping && typingPreview.text && (
        <div className={s.typingPreview}>💬 {typingPreview.text}</div>
      )}

      {/* ═══ Reply bar ═══ */}
      {replyTo && (
        <div className={s.replyBar}>
          <Reply size={16} style={{ color: "var(--accent)", flexShrink: 0 }} />
          <div className={s.replyBarContent}>
            <div className={s.replyBarSender}>
              {replyTo.sender === "visitor" ? displayName : "Оператор"}
            </div>
            <div className={s.replyBarText}>{replyTo.message}</div>
          </div>
          <button type="button" className={s.replyBarClose} onClick={() => setReplyTo(null)}>
            <X size={16} />
          </button>
        </div>
      )}

      {/* ═══ Composer ═══ */}
      <div className={s.composer}>
        <button
          type="button"
          className={s.composerAttachBtn}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip size={20} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.zip,.rar"
          style={{ display: "none" }}
          onChange={handleFileSelect}
        />
        <input
          type="text"
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Сообщение..."
          className={s.composerInput}
        />
        <button
          type="button"
          className={s.sendBtn}
          onClick={() => void handleSend()}
          disabled={!input.trim() || sending}
        >
          <Send size={20} />
        </button>
      </div>

      {/* ═══ Action Sheet ═══ */}
      {showActions && (
        <div className={s.actionSheet}>
          <div className={s.actionSheetOverlay} onClick={() => setShowActions(false)} />
          <div className={s.actionSheetContent}>
            <div className={s.actionSheetTitle}>Действия</div>

            {activeSession?.status !== "with_operator" && (
              <button type="button" className={s.actionSheetItem} onClick={handleTakeChat}>
                <User size={18} /> Взять чат
              </button>
            )}

            {activeSession?.status === "with_operator" && (
              <button type="button" className={s.actionSheetItem} onClick={handleReturnToAi}>
                <ArrowLeft size={18} /> Вернуть AI
              </button>
            )}

            <button type="button" className={s.actionSheetItem} onClick={() => { setShowActions(false); setShowVisitorInfo(true); }}>
              <User size={18} /> Информация о клиенте
            </button>

            <button type="button" className={s.actionSheetItem} onClick={() => { setShowActions(false); setShowNotes(true); }}>
              <StickyNote size={18} /> Заметки
            </button>

            {activeSession?.status !== "closed" && (
              <button type="button" className={`${s.actionSheetItem} ${s.actionSheetItemDanger}`} onClick={handleCloseChat}>
                <X size={18} /> Закрыть чат
              </button>
            )}

            <button type="button" className={s.actionSheetCancel} onClick={() => setShowActions(false)}>
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* ═══ Visitor Info Panel ═══ */}
      {showVisitorInfo && (
        <>
          <div className={s.visitorPanelOverlay} onClick={() => setShowVisitorInfo(false)} />
          <div className={s.visitorPanel}>
            <div className={s.visitorPanelHeader}>
              <span className={s.visitorPanelTitle}>Информация</span>
              <button type="button" className={s.visitorPanelClose} onClick={() => setShowVisitorInfo(false)}>
                <X size={18} />
              </button>
            </div>
            <div className={s.visitorPanelBody}>
              <div className={s.visitorField}>
                <span className={s.visitorFieldLabel}>Имя</span>
                <span className={s.visitorFieldValue}>{activeSession?.visitor_name || "—"}</span>
              </div>
              {activeSession?.visitor_email && (
                <div className={s.visitorField}>
                  <span className={s.visitorFieldLabel}><Mail size={12} /> Email</span>
                  <span className={s.visitorFieldValue}>{activeSession.visitor_email}</span>
                </div>
              )}
              {activeSession?.visitor_phone && (
                <div className={s.visitorField}>
                  <span className={s.visitorFieldLabel}><Phone size={12} /> Телефон</span>
                  <span className={s.visitorFieldValue}>{activeSession.visitor_phone}</span>
                </div>
              )}
              {activeSession?.current_page && (
                <div className={s.visitorField}>
                  <span className={s.visitorFieldLabel}><Globe size={12} /> Страница</span>
                  <span className={s.visitorFieldValue}>{activeSession.current_page}</span>
                </div>
              )}
              <div className={s.visitorField}>
                <span className={s.visitorFieldLabel}>Статус</span>
                <span className={s.visitorFieldValue}>{statusLabel}</span>
              </div>
              <div className={s.visitorField}>
                <span className={s.visitorFieldLabel}>Визит №</span>
                <span className={s.visitorFieldValue}>{activeSession?.visit_count || 1}</span>
              </div>
              <div className={s.visitorField}>
                <span className={s.visitorFieldLabel}>Приоритет</span>
                <span className={s.visitorFieldValue}>
                  {activeSession?.is_vip ? "⭐ VIP" : activeSession?.priority || "normal"}
                </span>
              </div>
              {activeSession?.city && (
                <div className={s.visitorField}>
                  <span className={s.visitorFieldLabel}>Город</span>
                  <span className={s.visitorFieldValue}>
                    {activeSession.city}{activeSession.country ? `, ${activeSession.country}` : ""}
                  </span>
                </div>
              )}
              {activeSession?.utm_source && (
                <div className={s.visitorField}>
                  <span className={s.visitorFieldLabel}>UTM Source</span>
                  <span className={s.visitorFieldValue}>{activeSession.utm_source}</span>
                </div>
              )}
              <div className={s.visitorField}>
                <span className={s.visitorFieldLabel}>Сообщений</span>
                <span className={s.visitorFieldValue}>{activeSession?.messages_count || 0}</span>
              </div>
              {activeSession?.rating && (
                <div className={s.visitorField}>
                  <span className={s.visitorFieldLabel}>Оценка</span>
                  <span className={s.visitorFieldValue}>{"⭐".repeat(activeSession.rating)}</span>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ═══ Notes Panel ═══ */}
      {showNotes && (
        <>
          <div className={s.visitorPanelOverlay} onClick={() => setShowNotes(false)} />
          <div className={s.notesPanel}>
            <div className={s.visitorPanelHeader}>
              <span className={s.visitorPanelTitle}>Заметки</span>
              <button type="button" className={s.visitorPanelClose} onClick={() => setShowNotes(false)}>
                <X size={16} />
              </button>
            </div>
            <div className={s.notesList}>
              {notes.length === 0 && (
                <div className={s.loadingText}>Нет заметок</div>
              )}
              {notes.map((note) => (
                <div key={note.id} className={s.noteItem}>
                  <div className={s.noteText}>{note.note}</div>
                  <div className={s.noteMeta}>
                    {new Date(note.created_at).toLocaleString("ru-RU")}
                  </div>
                </div>
              ))}
            </div>
            <div className={s.noteComposer}>
              <input
                type="text"
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void handleCreateNote(); }}
                placeholder="Новая заметка..."
                className={s.noteInput}
              />
              <button
                type="button"
                className={s.noteSendBtn}
                disabled={!noteInput.trim()}
                onClick={() => void handleCreateNote()}
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </>
      )}

      {/* ═══ Message Context Menu (long press) ═══ */}
      {menuMsg && (
        <>
          <div className={s.msgMenuOverlay} onClick={() => { setMenuMsg(null); setShowEmoji(null); }} />
          <div
            className={s.msgMenu}
            style={{
              top: Math.min(menuMsg.y, window.innerHeight - 280),
              left: Math.min(menuMsg.x, window.innerWidth - 200),
            }}
          >
            {/* Emoji row */}
            <div className={s.emojiRow}>
              {EMOJI_LIST.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className={s.emojiBtn}
                  onClick={() => handleReaction(menuMsg.msg.id, emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>

            <button
              type="button"
              className={s.msgMenuItem}
              onClick={() => { setReplyTo(menuMsg.msg); setMenuMsg(null); }}
            >
              <Reply size={16} /> Ответить
            </button>

            {menuMsg.msg.message && (
              <button
                type="button"
                className={s.msgMenuItem}
                onClick={() => {
                  navigator.clipboard.writeText(menuMsg.msg.message);
                  setMenuMsg(null);
                }}
              >
                <FileText size={16} /> Копировать
              </button>
            )}
          </div>
        </>
      )}

      {/* ═══ Image Lightbox ═══ */}
      {lightboxUrl && (
        <div className={s.lightbox} onClick={() => setLightboxUrl(null)}>
          <button type="button" className={s.lightboxClose} onClick={() => setLightboxUrl(null)}>
            <X size={20} />
          </button>
          <img src={lightboxUrl} alt="Просмотр" className={s.lightboxImg} />
        </div>
      )}
    </div>
  );
}