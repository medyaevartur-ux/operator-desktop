import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import {
  ArrowDown, ArrowLeft, ArrowRightLeft, Ban, Check, CheckCheck, CircleCheck, FileText, Flag, LockKeyhole, LogOut,
  MessageCircle, MoreHorizontal, PanelRight, Pencil, Reply, RotateCcw, Search, SmilePlus, Trash2, UserCheck, X,
} from "lucide-react";
import { useInboxStore } from "@/store/inbox.store";
import { useAuthStore } from "@/store/auth.store";
import { useNavigationStore } from "@/store/navigation.store";
import { useVisitorsStore } from "@/store/visitors.store";
import { useNotificationStore } from "@/store/notification.store";
import { editMessage, deleteMessage, toggleReaction, leaveChatSession, blockVisitorBySession, markChatSessionRead } from "@/features/inbox/inbox.api";
import { waitingLabel, waitingMinutes } from "@/features/inbox/conversation-list";
import { autoMessageSender } from "@/features/inbox/inbox.utils";
import { richText } from "@/features/inbox/rich-text";
import { closeConversation, reopenConversation } from "@/lib/open-conversation";
import { API_BASE } from "@/lib/api";
import { offlineQueue } from "@/lib/offline-queue";
import { Avatar, Button, Modal, Select, toast, useConfirm } from "@/components/ui";
import { ChatComposer } from "./chat-composer";
import { ChatDetails } from "./chat-details";
import { TypingPreview } from "./typing-preview";
import { getSessionDisplayName } from "@/utils/avatar";
import type { ChatMessage, ChatSession } from "@/types/chat";
import s from "./ChatMain.module.css";

const EMOJIS = ["👍", "❤️", "😊", "🔥", "✅", "👀"];
const RUN_GAP_MS = 5 * 60 * 1000;
const PRIORITIES = [["urgent", "Срочный"], ["high", "Высокий"], ["normal", "Обычный"], ["low", "Низкий"]] as const;

function safeUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try { const url = new URL(value, API_BASE); return /^https?:$/.test(url.protocol) ? url.href : null; } catch { return null; }
}
function attachments(message: ChatMessage): Array<{ url: string; filename?: string; mime_type?: string }> {
  try {
    const list = typeof message.attachments === "string" ? JSON.parse(message.attachments) : message.attachments;
    if (Array.isArray(list)) return list.filter(item => safeUrl(item?.url)).map(item => ({ ...item, url: safeUrl(item.url)! }));
  } catch { /* старые метаданные вложений могут быть повреждены */ }
  return message.message_type === "image" && safeUrl(message.message) ? [{ url: safeUrl(message.message)!, mime_type: "image/legacy" }] : [];
}
function dateLabel(value: string) {
  const date = new Date(value), today = new Date(), yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  return date.toDateString() === today.toDateString() ? "Сегодня" : date.toDateString() === yesterday.toDateString() ? "Вчера" : date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}
const messageTime = (value: string) => new Date(value).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
const sameDay = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString();

/** Подпись показываем в начале серии: другой автор, другой тип или пауза больше 5 минут. */
function startsRun(messages: ChatMessage[], index: number) {
  if (index === 0) return true;
  const prev = messages[index - 1], cur = messages[index];
  return prev.sender !== cur.sender || prev.operator_id !== cur.operator_id || !!prev.is_internal !== !!cur.is_internal
    || prev.sender === "system" || !sameDay(prev.created_at, cur.created_at) || Date.parse(cur.created_at) - Date.parse(prev.created_at) > RUN_GAP_MS;
}

function statusLine(session: ChatSession, mine: boolean) {
  if (session.status === "closed") return "Завершён";
  const wait = waitingMinutes(session);
  if (!session.operator_id) return wait ? `Ждёт ответа · ${waitingLabel(wait).replace("ждёт ", "")}` : session.status === "ai" ? "Отвечает помощник" : "Ждёт ответа";
  if (mine) return "Вы отвечаете";
  return session.operator_name ? `Отвечает ${session.operator_name}` : "У коллеги";
}

function AttachmentImage({ src, label, refresh, open }: { src: string; label: string; refresh: () => void; open: () => void }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return failed
    ? <button type="button" className={s.linkButton} onClick={refresh}>Ссылка на вложение устарела — обновить</button>
    : <button type="button" className={s.image} onClick={open}><img src={src} alt={label} loading="lazy" onError={() => setFailed(true)} /></button>;
}

export function ChatMain({ mobile = false }: { mobile?: boolean }) {
  const state = useInboxStore();
  const { activeSession: session, messages, operators } = state;
  const operator = useAuthStore(st => st.operator);
  const nav = useNavigationStore();
  const visitorOnline = useVisitorsStore(st => !!session && st.visitors.some(item => item.visitor_id === session.visitor_id && item.is_online));
  const { confirm } = useConfirm();
  const [details, setDetails] = useState(false), [search, setSearch] = useState(false), [transfer, setTransfer] = useState(false);
  const [target, setTarget] = useState(""), [comment, setComment] = useState(""), [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<ChatMessage | null>(null), [editText, setEditText] = useState("");
  const [image, setImage] = useState<string | null>(null), [below, setBelow] = useState(false), [drop, setDrop] = useState(false);
  const scroller = useRef<HTMLDivElement>(null), nearBottom = useRef(true), prependHeight = useRef<number | null>(null);
  const previous = useRef({ session: "", last: "" });
  const run = useCallback(async (action: () => Promise<unknown>) => {
    try { await action(); } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось выполнить действие"); }
  }, []);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prependHeight.current !== null) { el.scrollTop += el.scrollHeight - prependHeight.current; prependHeight.current = null; }
    else if (previous.current.session !== session?.id || nearBottom.current) el.scrollTop = el.scrollHeight;
    else if (previous.current.last !== messages[messages.length - 1]?.id) setBelow(true);
    previous.current = { session: session?.id || "", last: messages[messages.length - 1]?.id || "" };
  }, [messages, session?.id]);
  useEffect(() => { const open = () => setTransfer(true); window.addEventListener("chat-transfer-request", open); return () => window.removeEventListener("chat-transfer-request", open); }, []);
  useEffect(() => { setSearch(false); setDetails(false); setTransfer(false); setBelow(false); nearBottom.current = true; }, [session?.id]);
  useEffect(() => { if (state.focusedMessageId) document.getElementById(`message-${state.focusedMessageId}`)?.scrollIntoView({ block: "center" }); }, [state.focusedMessageId, state.isMessagesLoading]);
  useEffect(() => {
    const read = () => {
      if (!session?.id || !document.hasFocus() || document.hidden) return;
      // Оператор смотрит этот диалог: строка «Открыть» над ним и повтор звука больше не нужны.
      useNotificationStore.getState().clearNotifications(session.id);
      if (!state.focusedMessageId && nearBottom.current && (session.unread_count || 0) > 0) {
        void markChatSessionRead(session.id).then(() => state.loadSessions()).catch(() => undefined);
      }
    };
    read(); window.addEventListener("focus", read); document.addEventListener("visibilitychange", read);
    return () => { window.removeEventListener("focus", read); document.removeEventListener("visibilitychange", read); };
  }, [session?.id, session?.unread_count, messages.length, state.readingLatest, state.focusedMessageId]);

  if (!session) return <section className={s.placeholder}><img src="/book-mark.svg" alt="" /><h2>Выберите диалог</h2><p>Переписка откроется здесь.</p></section>;

  const name = getSessionDisplayName(session.visitor_name, session.visitor_id);
  const mine = session.operator_id === operator?.id;
  const manager = ["admin", "supervisor"].includes(operator?.role || "");
  const canManage = mine || !session.operator_id || manager;
  const closed = session.status === "closed";
  const cardOpen = mobile ? details : nav.isDetailsOpen;
  const toggleCard = () => (mobile ? setDetails(true) : nav.toggleDetails());
  const scrollDown = () => { if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; nearBottom.current = true; setBelow(false); };
  const remove = async (message: ChatMessage) => {
    if (await confirm({ title: "Удалить сообщение?", message: "В переписке останется отметка об удалении.", confirmText: "Удалить", danger: true })) {
      await deleteMessage(message.id, operator!.id); await state.loadMessages();
    }
  };
  const react = (message: ChatMessage, emoji: string) => void run(async () => { await toggleReaction(message.id, operator!.id, emoji); await state.loadMessages(); });

  const primary = closed
    ? <Button size="sm" variant="secondary" icon={<RotateCcw size={15} />} onClick={() => void reopenConversation(session.id)}>Открыть снова</Button>
    : !session.operator_id
      ? <Button size="sm" icon={<UserCheck size={15} />} onClick={() => void run(state.assignActiveSession)}>Взять диалог</Button>
      : canManage ? <Button size="sm" variant="secondary" icon={<CircleCheck size={15} />} onClick={() => void closeConversation(session)}>Завершить</Button> : null;

  return (
    <section
      className={`${s.main} ${mobile ? s.mobile : ""}`}
      aria-label={`Диалог: ${name}`}
      onDragOver={e => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDrop(true); } }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(false); }}
      onDrop={e => { e.preventDefault(); setDrop(false); window.dispatchEvent(new CustomEvent("zs-add-files-to-composer", { detail: Array.from(e.dataTransfer.files) })); }}
    >
      <header className={s.header}>
        {mobile && <button type="button" className={s.icon} aria-label="К диалогам" onClick={() => nav.setMobileView("chat-list")}><ArrowLeft /></button>}
        <button type="button" className={s.identity} onClick={toggleCard} aria-label="Открыть карточку клиента">
          <Avatar name={name} size="sm" status={visitorOnline ? "online" : undefined} />
          <span className={s.identityText}>
            <span className={s.name}>{name}</span>
            <span className={s.status} data-state={closed ? "closed" : !session.operator_id ? "waiting" : mine ? "mine" : "other"}>{statusLine(session, mine)}{!closed && <span className={s.presence} data-online={visitorOnline || undefined}>{visitorOnline ? " · на сайте" : " · не на сайте"}</span>}</span>
          </span>
        </button>
        <div className={s.headerActions}>
          {!mobile && primary}
          <button type="button" className={s.icon} aria-label="Поиск по переписке" aria-pressed={search} onClick={() => setSearch(!search)}><Search /></button>
          <button type="button" className={s.icon} aria-label="Карточка клиента" aria-pressed={cardOpen} onClick={toggleCard}><PanelRight /></button>
          <Dropdown.Root>
            <Dropdown.Trigger asChild><button type="button" className={s.icon} aria-label="Действия с диалогом"><MoreHorizontal /></button></Dropdown.Trigger>
            <Dropdown.Portal>
              <Dropdown.Content className={s.menu} align="end" sideOffset={6}>
                {!session.operator_id && !closed && <Dropdown.Item onSelect={() => void run(state.assignActiveSession)}><UserCheck />Взять диалог</Dropdown.Item>}
                {canManage && !closed && <Dropdown.Item onSelect={() => setTransfer(true)}><ArrowRightLeft />Передать коллеге</Dropdown.Item>}
                {canManage && !closed && <Dropdown.Item onSelect={() => void closeConversation(session)}><CircleCheck />Завершить диалог</Dropdown.Item>}
                {closed && <Dropdown.Item onSelect={() => void reopenConversation(session.id)}><RotateCcw />Открыть снова</Dropdown.Item>}
                <Dropdown.Item onSelect={() => void run(state.markActiveSessionUnread)}><MessageCircle />Отметить непрочитанным</Dropdown.Item>
                {canManage && (
                  <Dropdown.Sub>
                    <Dropdown.SubTrigger><Flag />Приоритет</Dropdown.SubTrigger>
                    <Dropdown.Portal>
                      <Dropdown.SubContent className={s.menu} sideOffset={4}>
                        {PRIORITIES.map(([value, label]) => <Dropdown.Item key={value} onSelect={() => void run(() => state.changeActiveSessionPriority(value))}>{label}{session.priority === value && <Check className={s.menuCheck} />}</Dropdown.Item>)}
                      </Dropdown.SubContent>
                    </Dropdown.Portal>
                  </Dropdown.Sub>
                )}
                {mine && !closed && <Dropdown.Item onSelect={() => void run(async () => { await leaveChatSession(session.id); await state.loadSessions(); })}><LogOut />Вернуть в очередь</Dropdown.Item>}
                <Dropdown.Separator />
                <Dropdown.Item className={s.danger} onSelect={() => void run(async () => {
                  if (await confirm({ title: "Заблокировать посетителя?", message: "Он не сможет писать с этого устройства. Историю диалога это не удалит.", confirmText: "Заблокировать", danger: true })) {
                    await blockVisitorBySession(session.visitor_id); await state.loadSessions();
                  }
                })}><Ban />Заблокировать спам</Dropdown.Item>
              </Dropdown.Content>
            </Dropdown.Portal>
          </Dropdown.Root>
        </div>
      </header>

      {mobile && primary && (closed || !session.operator_id) && <div className={s.mobileAction}>{primary}</div>}

      {search && (
        <form className={s.search} onSubmit={e => { e.preventDefault(); void state.searchInMessages(); }}>
          <Search aria-hidden="true" />
          <input autoFocus aria-label="Поиск по переписке" placeholder="Слово, фраза или номер заказа" value={state.messageSearchQuery} onChange={e => state.setMessageSearchQuery(e.target.value)} />
          <Button size="sm" variant="secondary" type="submit" loading={state.isMessageSearching}>Найти</Button>
          <button className={s.icon} type="button" aria-label="Закрыть поиск" onClick={() => { setSearch(false); state.clearMessageSearch(); }}><X /></button>
        </form>
      )}
      {search && state.messageSearchError && <div role="alert" className={s.notice}>{state.messageSearchError}</div>}
      {search && state.hasMessageSearch && (
        <div className={s.results}>
          <p className={s.searchSummary}>{state.messageSearchTotal ? `Найдено сообщений: ${state.messageSearchTotal}` : "По этой фразе ничего не найдено"}</p>
          {state.messageSearchResults.map(result => (
            <button type="button" key={result.id} onClick={() => { void state.goToSearchResult(result); setSearch(false); }}>
              <span>{messageTime(result.created_at)} · {dateLabel(result.created_at)}</span><p>{result.message}</p>
            </button>
          ))}
          {state.messageSearchPage < state.messageSearchPages && <button type="button" disabled={state.isMessageSearching} onClick={() => void state.searchInMessages(true)}>{state.isMessageSearching ? "Загружаем…" : "Показать ещё"}</button>}
        </div>
      )}
      {state.focusedMessageId && <div className={s.notice}>Вы смотрите найденное сообщение в истории<button type="button" onClick={() => { useInboxStore.setState({ focusedMessageId: null, messages: [], olderCursor: null }); void state.loadMessages(); }}>К последним сообщениям</button></div>}
      {state.messagesError && <div className={s.notice} role="status">{state.messagesError}<button type="button" onClick={() => void state.loadMessages()}>Обновить</button></div>}

      <div className={s.timelineWrap}>
        <div
          className={`${s.timeline} scrollbar-thin`}
          ref={scroller}
          onScroll={e => {
            const el = e.currentTarget;
            nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
            if (useInboxStore.getState().readingLatest !== nearBottom.current) useInboxStore.setState({ readingLatest: nearBottom.current });
            if (nearBottom.current) setBelow(false);
          }}
        >
          <div className={s.thread}>
            {state.olderCursor && <button type="button" className={s.older} disabled={state.isLoadingOlder} onClick={() => { prependHeight.current = scroller.current?.scrollHeight || null; void state.loadOlderMessages(); }}>{state.isLoadingOlder ? "Загружаем…" : "Показать предыдущие сообщения"}</button>}
            {!messages.length && <div className={s.empty}>{state.isMessagesLoading ? "Загружаем переписку…" : "Сообщений пока нет"}</div>}
            {messages.map((message, index) => {
              const own = message.sender === "operator", system = message.sender === "system", files = attachments(message);
              const internal = !!message.is_internal;
              // Автосообщение сайта — от нашей стороны, под тем именем, которое видел посетитель.
              const autoFrom = autoMessageSender(message);
              const author = own ? (message.operator_id === operator?.id ? "Вы" : operators.find(item => item.id === message.operator_id)?.name || "Оператор") : message.sender === "visitor" ? name : autoFrom ? `Автосообщение · ${autoFrom}` : "Помощник";
              const day = index === 0 || !sameDay(messages[index - 1].created_at, message.created_at);
              const first = startsRun(messages, index);
              const canEdit = own && message.operator_id === operator?.id && !message.isPending && !message.is_deleted && Date.now() - Date.parse(message.created_at) < 5 * 60 * 1000;
              const side = own || internal || autoFrom ? "out" : "in";
              return (
                <div key={message.id} id={`message-${message.id}`} className={s.entry} data-focused={state.focusedMessageId === message.id || undefined}>
                  {day && <div className={s.day}><span>{dateLabel(message.created_at)}</span></div>}
                  {system ? <div className={s.system}>{message.message}<time dateTime={message.created_at}>{messageTime(message.created_at)}</time></div> : (
                    <div className={s.message} data-side={side} data-kind={internal ? "note" : message.sender} data-first={first || undefined}>
                      {first && (
                        <div className={s.meta}>
                          {internal && <LockKeyhole aria-hidden="true" />}
                          <span>{internal ? `Заметка для команды · ${author}` : author}</span>
                          <time dateTime={message.created_at}>{messageTime(message.created_at)}</time>
                        </div>
                      )}
                      <div className={s.bubbleRow}>
                        <div className={s.bubble} title={first ? undefined : messageTime(message.created_at)}>
                          {message.reply_to_id && (
                            <button type="button" className={s.quote} onClick={() => document.getElementById(`message-${message.reply_to_id}`)?.scrollIntoView({ block: "center" })}>
                              <Reply aria-hidden="true" />{message.reply_to_message || messages.find(item => item.id === message.reply_to_id)?.message || "Ответ на сообщение"}
                            </button>
                          )}
                          {message.is_deleted ? <span className={s.deleted}>Сообщение удалено</span> : <>
                            {files.map((file, i) => file.mime_type?.startsWith("image/") || message.message_type === "image"
                              ? <AttachmentImage key={i} src={file.url} label={file.filename || "Вложение"} refresh={() => void state.loadMessages()} open={() => setImage(file.url)} />
                              : <a key={i} className={s.file} href={`${file.url}${file.url.includes("?") ? "&" : "?"}download=1`} target="_blank" rel="noreferrer noopener"><FileText /><span>{file.filename || "Документ"}<small>Открыть файл</small></span></a>)}
                            {(!files.length || message.message_type === "text") && message.message && <div className={s.text}>{richText(message.message)}</div>}
                          </>}
                          {own && !internal && !message.is_deleted && (
                            <span className={s.receipt} title={message.isPending ? "Ожидает отправки" : message.status === "read" ? "Прочитано" : message.status === "delivered" ? "Доставлено" : "Отправлено"}>
                              {message.is_edited && <span>изменено</span>}
                              {message.isPending ? <span>в очереди</span> : message.status === "read" ? <CheckCheck className={s.read} /> : message.status === "delivered" ? <CheckCheck /> : <Check />}
                            </span>
                          )}
                        </div>
                        {!message.isPending && !message.is_deleted && (
                          <Dropdown.Root>
                            <Dropdown.Trigger asChild><button type="button" className={s.messageMore} aria-label="Действия с сообщением"><MoreHorizontal /></button></Dropdown.Trigger>
                            <Dropdown.Portal>
                              <Dropdown.Content className={s.menu} sideOffset={4} align={side === "out" ? "end" : "start"}>
                                <Dropdown.Item onSelect={() => state.setReplyTo(message)}><Reply />Ответить</Dropdown.Item>
                                <Dropdown.Sub>
                                  <Dropdown.SubTrigger><SmilePlus />Реакция</Dropdown.SubTrigger>
                                  <Dropdown.Portal><Dropdown.SubContent className={`${s.menu} ${s.emojiMenu}`} sideOffset={4}>{EMOJIS.map(emoji => <Dropdown.Item key={emoji} onSelect={() => react(message, emoji)}>{emoji}</Dropdown.Item>)}</Dropdown.SubContent></Dropdown.Portal>
                                </Dropdown.Sub>
                                {canEdit && <Dropdown.Item onSelect={() => { setEditing(message); setEditText(message.message); }}><Pencil />Редактировать</Dropdown.Item>}
                                {canEdit && <Dropdown.Item className={s.danger} onSelect={() => void run(() => remove(message))}><Trash2 />Удалить</Dropdown.Item>}
                              </Dropdown.Content>
                            </Dropdown.Portal>
                          </Dropdown.Root>
                        )}
                      </div>
                      {message.sendError && (
                        <div className={s.sendError} role="status">
                          {message.sendError}
                          <button type="button" onClick={() => void run(() => offlineQueue.retry(message.id))}>Повторить</button>
                          <button type="button" onClick={() => void run(() => offlineQueue.cancel(message.id))}>Убрать</button>
                        </div>
                      )}
                      {!!message.reactions?.length && (
                        <div className={s.reactions}>
                          {Array.from(new Set(message.reactions.map(item => item.emoji))).map(emoji => (
                            <button type="button" key={emoji} onClick={() => react(message, emoji)}>{emoji} {message.reactions!.filter(item => item.emoji === emoji).length}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {below && <button type="button" className={s.down} onClick={scrollDown}><ArrowDown />Новые сообщения</button>}
      </div>

      <footer className={s.composer}>
        <div className={s.composerInner}>
          <TypingPreview sessionId={session.id} />
          {closed
            ? <div className={s.closed}><CircleCheck aria-hidden="true" /><span>Диалог завершён. Клиент может написать снова — диалог вернётся в работу.</span><Button size="sm" variant="secondary" onClick={() => void reopenConversation(session.id)}>Открыть снова</Button></div>
            : <ChatComposer key={session.id} />}
        </div>
      </footer>

      {drop && <div className={s.drop}><FileText />Отпустите файлы здесь<span>Фото и документы до 10 МБ</span></div>}

      <Modal open={transfer} onClose={() => setTransfer(false)} title="Передать диалог" footer={<Button disabled={!target || busy} loading={busy} onClick={() => void run(async () => { setBusy(true); try { await state.transferActiveSession(target, comment); setTransfer(false); setTarget(""); setComment(""); } finally { setBusy(false); } })}>Передать</Button>}>
        <div className={s.transfer}>
          <p>Коллега получит переписку и ваш комментарий. Клиент комментарий не увидит.</p>
          <Select value={target} onChange={setTarget} options={operators.filter(item => item.is_active && item.id !== session.operator_id).map(item => ({ value: item.id, label: `${item.name || item.email}${item.status === "online" ? " · на связи" : item.status === "away" ? " · отошёл" : ""}` }))} placeholder="Выберите коллегу" label="Кому передать" />
          <label>Комментарий для коллеги<textarea value={comment} maxLength={2000} onChange={e => setComment(e.target.value)} placeholder="Что уже обсудили и чем нужно помочь" /></label>
        </div>
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Изменить сообщение" footer={<Button disabled={!editText.trim()} onClick={() => void run(async () => { await editMessage(editing!.id, editText, operator!.id); setEditing(null); await state.loadMessages(); })}>Сохранить</Button>}>
        <textarea className={s.edit} aria-label="Текст сообщения" value={editText} maxLength={10000} onChange={e => setEditText(e.target.value)} />
      </Modal>
      <Modal open={!!image} onClose={() => setImage(null)} title="Вложение" width={860}>{image && <img className={s.fullImage} src={image} alt="Вложение в переписке" />}</Modal>
      <Modal open={details && mobile} onClose={() => setDetails(false)} title="Карточка клиента" width={520}><div className={s.mobileDetails}><ChatDetails key={session.id} /></div></Modal>
    </section>
  );
}
