import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { useTypingIndicator } from "@/features/inbox/use-typing";
import { uploadMessageImage } from "@/features/inbox/inbox.api";
import * as Popover from "@radix-ui/react-popover";
import {
  Paperclip,
  Languages,
  SendHorizonal,
  UserCheck,
  MessageSquareQuote,
  Image as ImageIcon,
  Loader2,
  Reply,
  X as XIcon,  
  Smile,
  Bold,
  Italic,
  Code,
  Eye,
  EyeOff,
} from "lucide-react";
import { useInboxStore } from "@/store/inbox.store";
import { useAuthStore } from "@/store/auth.store";
import { Tooltip } from "@/components/ui";
import { FileThumb } from "./FileThumb";
import s from "./ChatComposer.module.css";

/* ── Data ── */

const QUICK_REPLIES = [
  "Здравствуйте! Подскажите, пожалуйста, чем могу помочь?",
  "Передаю ваш запрос оператору. Обычно отвечаем в течение 2–3 минут.",
  "Спасибо за обращение! Уже уточняю информацию для вас.",
  "Подскажите, пожалуйста, ваш номер телефона для связи.",
  "Если удобно, опишите вопрос подробнее одним сообщением.",
];

const EMOJI_LIST = [
  "😊", "👍", "❤️", "🔥", "✅", "👋", "🙏", "🥇",
  "😂", "🤔", "👀", "🎉", "💡", "⚡", "📌", "🚀",
  "🍀", "🤝", "💪", "🎀", "🙌", "✨", "📎", "📗",
  "⏰", "📞", "💬", "📋", "🎯", "💰", "🏷️", "📢",
];

const MAX_CHARS = 2000;
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

/* ── Markdown preview ── */

function renderMarkdownPreview(text: string): string {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  html = html.replace(/```([\s\S]*?)```/g, '<code style="background:var(--accent-muted);padding:2px 6px;border-radius:6px;font-family:monospace;font-size:12px">$1</code>');
  html = html.replace(/`([^`]+)`/g, '<code style="background:var(--accent-muted);padding:1px 4px;border-radius:4px;font-family:monospace;font-size:12px">$1</code>');
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/@(\S+)/g, '<span style="color:var(--accent);font-weight:700;background:var(--accent-soft);padding:0 4px;border-radius:4px">@$1</span>');
  html = html.replace(/\n/g, "<br>");
  return html;
}

/* ══════════════════════════════════
   ChatComposer
   ══════════════════════════════════ */

export function ChatComposer() {
  const activeSession = useInboxStore((st) => st.activeSession);
  const assignActiveSession = useInboxStore((st) => st.assignActiveSession);
  const sendMessage = useInboxStore((st) => st.sendMessage);
  const operator = useAuthStore((st) => st.operator);
  const operators = useInboxStore((st) => st.operators);
  const messageCount = useInboxStore((st) => st.messages.length);
  const replyTo = useInboxStore((st) => st.replyTo);
  const setReplyTo = useInboxStore((st) => st.setReplyTo);
  const [value, setValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");

  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { isVisitorTyping, sendTyping } = useTypingIndicator();
  const typingThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isAssigned =
    !!activeSession?.operator_id &&
    !!operator?.id &&
    activeSession.operator_id === operator.id;

  const charCount = value.length;
  const isOverLimit = charCount > MAX_CHARS;

  const filteredReplies = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return QUICK_REPLIES;
    return QUICK_REPLIES.filter((r) => r.toLowerCase().includes(q));
  }, [value]);

  const filteredOperators = useMemo(() => {
    if (!mentionFilter) return operators.slice(0, 8);
    const q = mentionFilter.toLowerCase();
    return operators
      .filter((o) => (o.name ?? "").toLowerCase().includes(q) || (o.email ?? "").toLowerCase().includes(q))
      .slice(0, 8);
  }, [operators, mentionFilter]);

  /* ── Text helpers ── */

  const insertAtCursor = useCallback(
    (text: string) => {
      const ta = textareaRef.current;
      if (!ta) {
        setValue((prev) => prev + text);
        return;
      }
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newValue = value.substring(0, start) + text + value.substring(end);
      setValue(newValue);
      requestAnimationFrame(() => {
        ta.focus();
        ta.selectionStart = ta.selectionEnd = start + text.length;
      });
    },
    [value],
  );

  const wrapSelection = useCallback(
    (prefix: string, suffix: string) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const selected = value.substring(start, end);
      const wrapped = prefix + (selected || "текст") + suffix;
      setValue(value.substring(0, start) + wrapped + value.substring(end));
      requestAnimationFrame(() => {
        ta.focus();
        if (selected) {
          ta.selectionStart = start + prefix.length;
          ta.selectionEnd = end + prefix.length;
        } else {
          ta.selectionStart = start + prefix.length;
          ta.selectionEnd = start + prefix.length + 5;
        }
      });
    },
    [value],
  );

  /* ── Mention detection ── */

  const handleTextChange = useCallback(
    (newValue: string) => {
      setValue(newValue);
      const ta = textareaRef.current;
      if (ta) {
        const pos = ta.selectionStart;
        const textBefore = newValue.substring(0, pos);
        const atMatch = textBefore.match(/@(\S*)$/);
        if (atMatch) {
          setShowMentions(true);
          setMentionFilter(atMatch[1]);
        } else {
          setShowMentions(false);
          setMentionFilter("");
        }
      }
      if (!typingThrottleRef.current) {
        sendTyping();
        typingThrottleRef.current = setTimeout(() => {
          typingThrottleRef.current = null;
        }, 2000);
      }
    },
    [sendTyping],
  );

  const insertMention = useCallback(
    (name: string) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const pos = ta.selectionStart;
      const textBefore = value.substring(0, pos);
      const atMatch = textBefore.match(/@(\S*)$/);
      if (atMatch) {
        const start = pos - atMatch[0].length;
        const after = value.substring(pos);
        setValue(value.substring(0, start) + `@${name} ` + after);
        setShowMentions(false);
        requestAnimationFrame(() => {
          ta.focus();
          ta.selectionStart = ta.selectionEnd = start + name.length + 2;
        });
      }
    },
    [value],
  );

  /* ── File handling ── */

  const addFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (arr.length === 0) return;
    setPendingFiles((prev) => [...prev, ...arr].slice(0, 10));
  }, []);

  const removeFile = useCallback((index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) addFiles(e.target.files);
      e.target.value = "";
    },
    [addFiles],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const images: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          const file = items[i].getAsFile();
          if (file) images.push(file);
        }
      }
      if (images.length > 0) {
        e.preventDefault();
        addFiles(images);
      }
    },
    [addFiles],
  );

  /* ── Submit ── */

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!activeSession || !operator) return;
    if (isOverLimit) return;

    const trimmed = value.trim();
    const hasFiles = pendingFiles.length > 0;
    if (!trimmed && !hasFiles) return;
    if (isSending || isUploading) return;

    try {
      setErrorText("");
      if (hasFiles) {
        setIsUploading(true);
        for (const file of pendingFiles) {
          await uploadMessageImage(activeSession.id, operator.id, file);
        }
        setPendingFiles([]);
        setIsUploading(false);
      }
      if (trimmed) {
        setIsSending(true);
        await sendMessage(trimmed);
        setValue("");
        setIsPreviewMode(false);
      }
    } catch (error) {
      console.error("send error:", error);
      setErrorText(error instanceof Error ? error.message : "Не удалось отправить");
    } finally {
      setIsSending(false);
      setIsUploading(false);
    }
  };

  // Close mentions on outside click
  useEffect(() => {
    if (!showMentions) return;
    function handleClick() {
      setShowMentions(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showMentions]);

  if (!activeSession) return null;

  const busy = isSending || isUploading;
  const canSend = !busy && !isOverLimit && (!!value.trim() || pendingFiles.length > 0);

  return (
    <div
      className={s.wrapper}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        multiple
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      {/* ── Assign banner ── */}
      {!isAssigned && (
        <div className={s.assignBanner}>
          <div className={s.assignText}>
            Чат ещё не закреплён за тобой. При ответе он автоматически назначится.
          </div>
          <button type="button" className={s.assignBtn} onClick={() => void assignActiveSession()}>
            <UserCheck style={{ width: 15, height: 15 }} />
            Забрать
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className={s.form}>
        {/* ── Tabs: only "Чат" active, rest "скоро" ── */}
        <div className={s.tabBar}>
          <button type="button" className={`${s.tab} ${s.tabActive}`}>
            Чат
          </button>
          {["Email", "SMS", "Комментарии"].map((tab) => (
            <button key={tab} type="button" className={`${s.tab} ${s.tabSoon}`} disabled>
              {tab}
            </button>
          ))}
          <span className={s.tabCount}>(всего {messageCount})</span>
        </div>

        {/* ── Reply bar ── */}
        {replyTo && (
          <div className={s.replyBar}>
            <Reply style={{ width: 16, height: 16, color: "var(--accent)", flexShrink: 0 }} />
            <div className={s.replyBarInfo}>
              <div className={s.replyBarSender}>
                {replyTo.sender === "visitor" ? "Клиент" : replyTo.sender === "ai" ? "AI-бот" : "Оператор"}
              </div>
              <div className={s.replyBarText}>{replyTo.message}</div>
            </div>
            <button type="button" className={s.replyBarClose} onClick={() => setReplyTo(null)}>
              <XIcon style={{ width: 14, height: 14 }} />
            </button>
          </div>
        )}
        
        {/* ── Mention dropdown (inline) ── */}
        {showMentions && filteredOperators.length > 0 && (
          <div className={s.mentionContent} onMouseDown={(e) => e.stopPropagation()}>
            <div className={s.mentionLabel}>Упомянуть оператора</div>
            {filteredOperators.map((op) => (
              <button
                key={op.id}
                type="button"
                className={s.mentionItem}
                onClick={() => insertMention(op.name ?? op.email ?? "operator")}
              >
                <div className={s.mentionAvatar}>{(op.name ?? "?").charAt(0).toUpperCase()}</div>
                <div>
                  <div className={s.mentionName}>{op.name ?? op.email}</div>
                  <div className={s.mentionRole}>{op.role}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* ── Pending files ── */}
        {pendingFiles.length > 0 && (
          <div className={s.filesBar}>
            {pendingFiles.map((file, i) => (
              <FileThumb key={`${file.name}-${i}`} file={file} onRemove={() => removeFile(i)} />
            ))}
            {isUploading && (
              <div className={s.fileUploading}>
                <Loader2 style={{ width: 22, height: 22 }} className={s.spinIcon} />
              </div>
            )}
          </div>
        )}

        {/* ── Textarea / Preview ── */}
        <div className={s.textareaWrap}>
          {isPreviewMode ? (
            <div
              className={s.preview}
              dangerouslySetInnerHTML={{
                __html:
                  renderMarkdownPreview(value) ||
                  '<span style="color:var(--text-disabled)">Предпросмотр пуст</span>',
              }}
            />
          ) : (
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => handleTextChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              onPaste={handlePaste}
              placeholder="Введите ваше сообщение... (@имя для mention)"
              className={s.textarea}
            />
          )}

          {errorText && <div className={s.error}>{errorText}</div>}

          {/* ── Bottom toolbar ── */}
          <div className={s.toolbar}>
            <div className={s.toolGroup}>
              {/* Emoji Popover */}
              <Popover.Root>
                <Tooltip content="Эмодзи" side="top">
                  <Popover.Trigger asChild>
                    <button type="button" className={s.toolBtn}>
                      <Smile style={{ width: 18, height: 18 }} />
                    </button>
                  </Popover.Trigger>
                </Tooltip>
                <Popover.Portal>
                  <Popover.Content side="top" sideOffset={8} className={s.popoverContent}>
                    <div className={s.emojiGrid}>
                      {EMOJI_LIST.map((emoji) => (
                        <Popover.Close asChild key={emoji}>
                          <button
                            type="button"
                            className={s.emojiBtn}
                            onClick={() => insertAtCursor(emoji)}
                          >
                            {emoji}
                          </button>
                        </Popover.Close>
                      ))}
                    </div>
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>

              {/* Bold */}
              <Tooltip content="Жирный (**текст**)" side="top">
                <button type="button" className={s.toolBtn} onClick={() => wrapSelection("**", "**")}>
                  <Bold style={{ width: 16, height: 16 }} />
                </button>
              </Tooltip>

              {/* Italic */}
              <Tooltip content="Курсив (*текст*)" side="top">
                <button type="button" className={s.toolBtn} onClick={() => wrapSelection("*", "*")}>
                  <Italic style={{ width: 16, height: 16 }} />
                </button>
              </Tooltip>

              {/* Code */}
              <Tooltip content="Код (`текст`)" side="top">
                <button type="button" className={s.toolBtn} onClick={() => wrapSelection("`", "`")}>
                  <Code style={{ width: 16, height: 16 }} />
                </button>
              </Tooltip>

              {/* Preview toggle */}
              <Tooltip content={isPreviewMode ? "Редактор" : "Предпросмотр"} side="top">
                <button
                  type="button"
                  className={`${s.toolBtn} ${isPreviewMode ? s.toolBtnActive : ""}`}
                  onClick={() => setIsPreviewMode((p) => !p)}
                >
                  {isPreviewMode
                    ? <EyeOff style={{ width: 16, height: 16 }} />
                    : <Eye style={{ width: 16, height: 16 }} />}
                </button>
              </Tooltip>

              <div className={s.toolDivider} />

              {/* Translate */}
              <Tooltip content="Перевод" side="top">
                <button type="button" className={s.toolBtn}>
                  <Languages style={{ width: 18, height: 18 }} />
                </button>
              </Tooltip>

              {/* Attach */}
              <Tooltip content="Прикрепить файл" side="top">
                <button
                  type="button"
                  className={`${s.toolBtn} ${pendingFiles.length > 0 ? s.toolBtnActive : ""}`}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip style={{ width: 18, height: 18 }} />
                </button>
              </Tooltip>

              {/* Quick Replies Popover */}
              <Popover.Root>
                <Tooltip content="Шаблоны ответов" side="top">
                  <Popover.Trigger asChild>
                    <button type="button" className={s.toolBtn}>
                      <MessageSquareQuote style={{ width: 18, height: 18 }} />
                    </button>
                  </Popover.Trigger>
                </Tooltip>
                <Popover.Portal>
                  <Popover.Content side="top" sideOffset={8} className={s.popoverContent}>
                    <div className={s.quickReplies}>
                      {filteredReplies.length === 0 && (
                        <div className={s.quickReplyEmpty}>Шаблоны не найдены</div>
                      )}
                      {filteredReplies.map((reply) => (
                        <Popover.Close asChild key={reply}>
                          <button
                            type="button"
                            className={s.quickReplyBtn}
                            onClick={() => setValue(reply)}
                          >
                            {reply}
                          </button>
                        </Popover.Close>
                      ))}
                    </div>
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>

              {/* File count */}
              {pendingFiles.length > 0 && (
                <span className={s.fileCount}>
                  <ImageIcon style={{ width: 14, height: 14 }} />
                  {pendingFiles.length} фото
                </span>
              )}
            </div>

            {/* Right side */}
            <div className={s.toolRight}>
              {/* Char counter */}
              <span
                className={`${s.charCount} ${
                  isOverLimit ? s.charOver : charCount > MAX_CHARS * 0.9 ? s.charWarn : s.charNormal
                }`}
              >
                {charCount}/{MAX_CHARS}
              </span>

              {/* Typing indicator */}
              {isVisitorTyping && (
                <div className={s.typing}>
                  <span className={s.typingDots}>
                    {[0, 0.2, 0.4].map((d) => (
                      <span
                        key={d}
                        className={s.typingDot}
                        style={{ animationDelay: `${d}s` }}
                      />
                    ))}
                  </span>
                  Клиент печатает...
                </div>
              )}

              {/* Send button */}
              <button type="submit" disabled={!canSend} className={s.sendBtn}>
                {isUploading ? (
                  <Loader2 style={{ width: 16, height: 16 }} className={s.spinIcon} />
                ) : (
                  <SendHorizonal style={{ width: 16, height: 16 }} />
                )}
                {isUploading ? "Загрузка..." : isSending ? "Отправка..." : "Отправить"}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}