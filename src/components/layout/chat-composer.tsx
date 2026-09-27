import { useCallback, useMemo, useRef, useState, useEffect, type SetStateAction } from "react";
import { useTypingIndicator } from "@/features/inbox/use-typing";
import * as Popover from "@radix-ui/react-popover";
import {
  ArrowUp, Bold, Code, Eye, EyeOff, Italic, Loader2, LockKeyhole, MessageSquareQuote, Paperclip, Reply, Smile, Type,
  UserCheck, X as XIcon, Zap,
} from "lucide-react";
import { useInboxStore } from "@/store/inbox.store";
import { useAuthStore } from "@/store/auth.store";
import { useDraftsStore } from "@/store/drafts.store";
import { useTemplatesStore, applyTemplate, type QuickTemplate } from "@/store/templates.store";
import { richText } from "@/features/inbox/rich-text";
import { Tooltip } from "@/components/ui";
import { FileThumb } from "./FileThumb";
import s from "./ChatComposer.module.css";

/* ── Data ── */

const EMOJI_LIST = [
  "😊", "👍", "❤️", "🔥", "✅", "👋", "🙏", "🥇",
  "😂", "🤔", "👀", "🎉", "💡", "⚡", "📌", "🚀",
  "🍀", "🤝", "💪", "🎀", "🙌", "✨", "📎", "📗",
  "⏰", "📞", "💬", "📋", "🎯", "💰", "🏷️", "📢",
];

const MAX_CHARS = 10000;
const ACCEPT = ".jpg,.jpeg,.png,.webp,.gif,.pdf,.txt,.docx,.xlsx,.zip";

/* ══════════════════════════════════
   ChatComposer
   ══════════════════════════════════ */

export function ChatComposer() {
  const activeSession = useInboxStore((st) => st.activeSession);
  const assignActiveSession = useInboxStore((st) => st.assignActiveSession);
  const sendMessage = useInboxStore((st) => st.sendMessage);
  const sendFile = useInboxStore((st) => st.sendFile);
  const [internal, setInternal] = useState(false);
  const operator = useAuthStore((st) => st.operator);
  const operators = useInboxStore((st) => st.operators);
  const messageCount = useInboxStore((st) => st.messages.length);
  const replyTo = useInboxStore((st) => st.replyTo);
  const setReplyTo = useInboxStore((st) => st.setReplyTo);
  const setDraft = useDraftsStore((st) => st.setDraft);
  const getDraft = useDraftsStore((st) => st.getDraft);
  const clearDraft = useDraftsStore((st) => st.clearDraft);
  const templates = useTemplatesStore((st) => st.templates);
  const resolveTemplateBody = useTemplatesStore((st) => st.resolveBody);
  const searchTemplates = useTemplatesStore((st) => st.searchTemplates);
  const findByShortcut = useTemplatesStore((st) => st.findByShortcut);
  const [draftValues, setDraftValues] = useState(() => ({reply:getDraft(activeSession?.id || ""),internal:getDraft(`${activeSession?.id || ""}:internal`)}));
  const value = internal ? draftValues.internal : draftValues.reply;
  const setValue = useCallback((next: SetStateAction<string>) => setDraftValues(previous => {
    const key = internal ? "internal" : "reply";
    return {...previous,[key]:typeof next === "function" ? next(previous[key]) : next};
  }),[internal]);
  const [isSending, setIsSending] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [showSlash, setShowSlash] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);

  const [draftFiles,setDraftFiles] = useState<{reply:File[];internal:File[]}>({reply:[],internal:[]});
  const pendingFiles = internal ? draftFiles.internal : draftFiles.reply;
  const setPendingFiles = useCallback((next:SetStateAction<File[]>)=>setDraftFiles(previous=>{
    const key=internal?"internal":"reply";return {...previous,[key]:typeof next==="function"?next(previous[key]):next};
  }),[internal]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { isVisitorTyping, sendTyping } = useTypingIndicator();
  const typingThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── File handling ── */

  const addFiles = useCallback((files: FileList | File[]) => {
    const candidates = Array.from(files);
    const arr = candidates.filter(f => /\.(jpe?g|png|webp|gif|pdf|txt|docx|xlsx|zip)$/i.test(f.name) && f.size <= 10 * 1024 * 1024);
    if(arr.length !== candidates.length) setErrorText('Можно прикрепить фото, PDF, TXT, DOCX, XLSX или ZIP до 10 МБ.');
    if (arr.length === 0) return;
    setPendingFiles((prev) => [...prev, ...arr].slice(0, 10));
  }, [setPendingFiles]);

  const removeFile = useCallback((index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }, [setPendingFiles]);

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

  const activeSessionId = activeSession?.id ?? "";
  useEffect(() => {
    if(activeSessionId) setDraft(activeSessionId + (internal ? ":internal" : ""),value);
  },[activeSessionId,internal,value,setDraft]);
  useEffect(() => { if(replyTo?.is_internal) setInternal(true); },[replyTo?.id]);

  // Подписка на глобальное событие drag-and-drop файлов
  useEffect(() => {
    const handleAddFiles = (e: Event) => {
      const customEvent = e as CustomEvent<File[]>;
      if (customEvent.detail) {
        addFiles(customEvent.detail);
      }
    };
    window.addEventListener("zs-add-files-to-composer", handleAddFiles);
    return () => window.removeEventListener("zs-add-files-to-composer", handleAddFiles);
  }, [addFiles]);

  const isAssigned =
    !!activeSession?.operator_id &&
    !!operator?.id &&
    activeSession.operator_id === operator.id;

  const charCount = value.length;
  const isOverLimit = charCount > MAX_CHARS;

  // Единая точка применения шаблона: resolveBody + incrementUses.
  const applyTpl = useCallback(
    (tpl: QuickTemplate) => applyTemplate(tpl, activeSession, operator),
    [activeSession, operator],
  );

  // Превью resolved-текста для попапа/подсказок (без побочных эффектов).
  const previewTpl = useCallback(
    (tpl: QuickTemplate) =>
      resolveTemplateBody(tpl.body, {
        name: activeSession?.visitor_name ?? null,
        visitor_id: activeSession?.visitor_id ?? null,
        operator: operator?.name?.trim() || operator?.email?.trim() || null,
      }),
    [resolveTemplateBody, activeSession, operator],
  );

  // Кандидаты для «/»-автодополнения. Пустой токен «/» → показываем все шаблоны.
  const slashCandidates = useMemo(() => {
    if (!showSlash) return [];
    const token = slashFilter.replace(/^\//, "");
    const list = token ? searchTemplates(slashFilter) : templates;
    return [...list].sort((a, b) => b.uses - a.uses).slice(0, 8);
  }, [showSlash, slashFilter, searchTemplates, templates]);

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
    [value,setValue],
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
    [value,setValue],
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
        // «/»-автодополнение шаблонов: ловим /(\S*) в начале токена.
        const slashMatch = textBefore.match(/(?:^|\s)\/(\S*)$/);
        if (slashMatch) {
          setShowSlash(true);
          setSlashFilter(`/${slashMatch[1]}`);
          setSlashIndex(0);
        } else {
          setShowSlash(false);
          setSlashFilter("");
        }
      }
      if (!internal && !typingThrottleRef.current) {
        sendTyping();
        typingThrottleRef.current = setTimeout(() => {
          typingThrottleRef.current = null;
        }, 2000);
      }
    },
    [sendTyping,internal],
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
    [value,setValue],
  );

  // Вставка шаблона из «/»-автодополнения: убираем токен «/...», вставляем resolved-текст.
  const insertTemplate = useCallback(
    (tpl: QuickTemplate) => {
      const ta = textareaRef.current;
      const resolved = applyTpl(tpl);
      if (!ta) {
        setValue((prev) => prev + resolved);
        setShowSlash(false);
        return;
      }
      const pos = ta.selectionStart;
      const textBefore = value.substring(0, pos);
      const slashMatch = textBefore.match(/(^|\s)\/(\S*)$/);
      if (!slashMatch) {
        // На всякий случай — просто вставка по курсору.
        insertAtCursor(resolved);
        setShowSlash(false);
        return;
      }
      // Сохраняем ведущий разделитель (пробел/начало строки) из совпадения.
      const lead = slashMatch[1];
      const start = pos - slashMatch[0].length + lead.length;
      const after = value.substring(pos);
      const next = value.substring(0, start) + resolved + after;
      setValue(next);
      setShowSlash(false);
      setSlashFilter("");
      requestAnimationFrame(() => {
        ta.focus();
        ta.selectionStart = ta.selectionEnd = start + resolved.length;
      });
    },
    [value, applyTpl, insertAtCursor],
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
          await sendFile(file, internal, activeSession.id);
          setPendingFiles(prev => prev.filter(item => item !== file));
        }
        setPendingFiles([]);
        setIsUploading(false);
      }
      if (trimmed) {
        // Slash-команды: если пользователь напечатал «/команда» — заменяем на шаблон
        let finalText = trimmed;
        if (trimmed.startsWith("/")) {
          const tokenEnd = trimmed.search(/\s|$/);
          const token = trimmed.slice(0, tokenEnd);
          const rest = trimmed.slice(tokenEnd).trim();
          const tpl = findByShortcut(token);
          if (tpl) {
            const resolved = applyTpl(tpl);
            finalText = rest ? `${resolved}\n\n${rest}` : resolved;
          }
        }
        setIsSending(true);
        await sendMessage(finalText, internal, activeSession.id);
        setValue("");
        setIsPreviewMode(false);
        if (activeSession?.id) clearDraft(activeSession.id + (internal ? ":internal" : ""));
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

  // Close slash autocomplete on outside click
  useEffect(() => {
    if (!showSlash) return;
    function handleClick() {
      setShowSlash(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showSlash]);

  // Держим выделение в пределах списка кандидатов.
  useEffect(() => {
    if (slashIndex > slashCandidates.length - 1) setSlashIndex(0);
  }, [slashCandidates.length, slashIndex]);

  if (!activeSession) return null;

  const busy = isSending || isUploading;
  const canSend = activeSession.status !== "closed" && (internal || !activeSession.operator_id || isAssigned) && !busy && !isOverLimit && (!!value.trim() || pendingFiles.length > 0);
  const colleagueOwns = !!activeSession.operator_id && !isAssigned;
  const sortedTemplates = [...templates].sort((a, b) => b.uses - a.uses);

  return (
    <div
      className={s.wrapper}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer.files) addFiles(e.dataTransfer.files); }}
    >
      <input ref={fileInputRef} type="file" accept={ACCEPT} multiple hidden onChange={handleFileChange} />

      {!isAssigned && (
        <div className={s.assignHint}>
          <span>{colleagueOwns ? "С диалогом работает коллега. Вы можете оставить заметку команде." : "Диалог в общей очереди. Ваш первый ответ закрепит его за вами."}</span>
          {!colleagueOwns && (
            <button type="button" onClick={() => void assignActiveSession().catch(error => setErrorText(error.message))}>
              <UserCheck aria-hidden="true" />Взять себе
            </button>
          )}
        </div>
      )}

      {showMentions && filteredOperators.length > 0 && (
        <div className={s.popup} onMouseDown={(e) => e.stopPropagation()}>
          <div className={s.popupLabel}>Упомянуть коллегу</div>
          {filteredOperators.map((op) => (
            <button key={op.id} type="button" className={s.popupItem} onClick={() => insertMention(op.name ?? op.email ?? "operator")}>
              <span className={s.mentionAvatar}>{(op.name ?? "?").charAt(0).toUpperCase()}</span>
              <span className={s.popupText}><strong>{op.name ?? op.email}</strong><small>{op.role === "admin" ? "Администратор" : op.role === "supervisor" ? "Руководитель" : "Оператор"}</small></span>
            </button>
          ))}
        </div>
      )}

      {showSlash && slashCandidates.length > 0 && (
        <div className={s.popup} onMouseDown={(e) => e.stopPropagation()} role="listbox" aria-label="Быстрые ответы">
          <div className={s.popupLabel}>Быстрые ответы · ↑↓ выбрать, Enter вставить</div>
          {slashCandidates.map((tpl, i) => {
            const preview = previewTpl(tpl);
            return (
              <button key={tpl.id} type="button" role="option" aria-selected={i === slashIndex} className={s.popupItem} data-active={i === slashIndex || undefined}
                onMouseEnter={() => setSlashIndex(i)} onClick={() => insertTemplate(tpl)}>
                <span className={s.popupText}>
                  <strong>{tpl.title}{tpl.shortcut && <kbd>{tpl.shortcut}</kbd>}</strong>
                  <small>{preview.slice(0, 110)}{preview.length > 110 ? "…" : ""}</small>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <form onSubmit={handleSubmit} className={s.card} data-mode={internal ? "note" : "reply"}>
        {internal && <div className={s.noteBanner}><LockKeyhole aria-hidden="true" />Заметка для команды — клиент её не увидит</div>}

        {replyTo && (
          <div className={s.replyBar}>
            <Reply aria-hidden="true" />
            <div className={s.replyBarInfo}>
              <div className={s.replyBarSender}>{replyTo.sender === "visitor" ? "Ответ клиенту на сообщение" : replyTo.sender === "ai" ? "Ответ на сообщение помощника" : "Ответ на сообщение оператора"}</div>
              <div className={s.replyBarText}>{replyTo.message}</div>
            </div>
            <button type="button" className={s.replyBarClose} aria-label="Убрать цитату" onClick={() => setReplyTo(null)}><XIcon /></button>
          </div>
        )}

        {pendingFiles.length > 0 && (
          <div className={s.filesBar}>
            {pendingFiles.map((file, i) => <FileThumb key={`${file.name}-${i}`} file={file} onRemove={() => removeFile(i)} />)}
            {isUploading && <div className={s.fileUploading}><Loader2 className={s.spinIcon} /></div>}
          </div>
        )}

        {isPreviewMode ? (
          <div className={s.preview}>{value.trim() ? richText(value) : <span className={s.previewEmpty}>Предпросмотр пуст</span>}</div>
        ) : (
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={(e) => handleTextChange(e.target.value)}
            onKeyDown={(e) => {
              if (showSlash && slashCandidates.length > 0) {
                if (e.key === "ArrowDown") { e.preventDefault(); setSlashIndex((i) => (i + 1) % slashCandidates.length); return; }
                if (e.key === "ArrowUp") { e.preventDefault(); setSlashIndex((i) => (i - 1 + slashCandidates.length) % slashCandidates.length); return; }
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); const tpl = slashCandidates[slashIndex] ?? slashCandidates[0]; if (tpl) insertTemplate(tpl); return; }
                if (e.key === "Escape") { e.preventDefault(); setShowSlash(false); return; }
              }
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && (window.innerWidth >= 768 || e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            onPaste={handlePaste}
            aria-label={internal ? "Заметка команде" : "Сообщение клиенту"}
            placeholder={internal ? "Напишите коллегам: что важно знать по этому клиенту" : "Ответ клиенту… «/» — быстрые ответы"}
            className={s.textarea}
          />
        )}

        {errorText && <div role="alert" className={s.error}>{errorText}</div>}

        <div className={s.toolbar}>
          <div className={s.mode} role="radiogroup" aria-label="Кому адресовано сообщение">
            <button type="button" role="radio" aria-checked={!internal} onClick={() => setInternal(false)}>Клиенту</button>
            <button type="button" role="radio" aria-checked={internal} data-note onClick={() => setInternal(true)}><LockKeyhole aria-hidden="true" />Заметка</button>
          </div>

          <Tooltip content="Прикрепить файл до 10 МБ" side="top">
            <button type="button" className={s.tool} data-active={pendingFiles.length > 0 || undefined} onClick={() => fileInputRef.current?.click()} aria-label="Прикрепить файл"><Paperclip /></button>
          </Tooltip>

          <Popover.Root>
            <Tooltip content="Быстрые ответы" kbd="/" side="top">
              <Popover.Trigger asChild><button type="button" className={s.tool} aria-label="Быстрые ответы"><Zap /></button></Popover.Trigger>
            </Tooltip>
            <Popover.Portal>
              <Popover.Content side="top" align="start" sideOffset={8} className={s.popoverContent}>
                <div className={s.quickReplies}>
                  {sortedTemplates.length === 0 && (
                    <div className={s.quickReplyEmpty}>
                      <MessageSquareQuote aria-hidden="true" />
                      <strong>Пока нет быстрых ответов</strong>
                      <span>Добавьте их в разделе «Быстрые ответы», чтобы вставлять одним нажатием.</span>
                    </div>
                  )}
                  {sortedTemplates.map((tpl) => {
                    const resolved = previewTpl(tpl);
                    return (
                      <Popover.Close asChild key={tpl.id}>
                        <button type="button" className={s.quickReplyBtn} onClick={() => insertAtCursor(applyTpl(tpl))}>
                          <strong>{tpl.title}{tpl.shortcut && <kbd>{tpl.shortcut}</kbd>}</strong>
                          <span>{resolved.slice(0, 90)}{resolved.length > 90 ? "…" : ""}</span>
                        </button>
                      </Popover.Close>
                    );
                  })}
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>

          <Popover.Root>
            <Tooltip content="Эмодзи" side="top">
              <Popover.Trigger asChild><button type="button" className={s.tool} aria-label="Эмодзи"><Smile /></button></Popover.Trigger>
            </Tooltip>
            <Popover.Portal>
              <Popover.Content side="top" align="start" sideOffset={8} className={s.popoverContent}>
                <div className={s.emojiGrid}>
                  {EMOJI_LIST.map((emoji) => (
                    <Popover.Close asChild key={emoji}><button type="button" className={s.emojiBtn} onClick={() => insertAtCursor(emoji)}>{emoji}</button></Popover.Close>
                  ))}
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>

          <Popover.Root>
            <Tooltip content="Форматирование" side="top">
              <Popover.Trigger asChild><button type="button" className={s.tool} data-active={isPreviewMode || undefined} aria-label="Форматирование"><Type /></button></Popover.Trigger>
            </Tooltip>
            <Popover.Portal>
              <Popover.Content side="top" align="start" sideOffset={8} className={`${s.popoverContent} ${s.formatMenu}`}>
                <Popover.Close asChild><button type="button" onClick={() => wrapSelection("**", "**")}><Bold />Жирный<kbd>**текст**</kbd></button></Popover.Close>
                <Popover.Close asChild><button type="button" onClick={() => wrapSelection("*", "*")}><Italic />Курсив<kbd>*текст*</kbd></button></Popover.Close>
                <Popover.Close asChild><button type="button" onClick={() => wrapSelection("`", "`")}><Code />Код<kbd>`текст`</kbd></button></Popover.Close>
                <Popover.Close asChild><button type="button" onClick={() => setIsPreviewMode((p) => !p)}>{isPreviewMode ? <EyeOff /> : <Eye />}{isPreviewMode ? "Вернуться к тексту" : "Предпросмотр"}</button></Popover.Close>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>

          <span className={s.spacer} />

          {isVisitorTyping && (
            <span className={s.typing} aria-live="polite">
              <span className={s.typingDots}>{[0, 0.2, 0.4].map((d) => <span key={d} className={s.typingDot} style={{ animationDelay: `${d}s` }} />)}</span>
              печатает
            </span>
          )}
          {charCount > MAX_CHARS * 0.9 && <span className={s.count} data-over={isOverLimit || undefined}>{charCount}/{MAX_CHARS}</span>}

          {internal ? (
            <button type="submit" disabled={!canSend} className={s.saveNote} aria-label="Сохранить заметку для команды">
              {busy ? <Loader2 className={s.spinIcon} /> : <LockKeyhole aria-hidden="true" />}
              {isUploading ? "Загрузка…" : "В заметки"}
            </button>
          ) : (
            <Tooltip content={isUploading ? "Загружаем файлы…" : "Отправить клиенту"} kbd={window.innerWidth >= 768 ? "Enter" : "Ctrl Enter"} side="top">
              <button type="submit" disabled={!canSend} className={s.send} aria-label="Отправить сообщение клиенту">
                {busy ? <Loader2 className={s.spinIcon} /> : <ArrowUp />}
              </button>
            </Tooltip>
          )}
        </div>
      </form>
    </div>
  );
}
