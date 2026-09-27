import { create } from "zustand";
import type { ChatMessage, ChatSession } from "@/types/chat";
import type { InboxFilter } from "@/features/inbox/inbox.utils";
import type { ClientNote } from "@/types/note";
import type { ChatTag, ChatSessionTag } from "@/types/tag";
import type { ChatOperator } from "@/types/operator";
import {
  assignOperatorToSession,
  attachTagToSession,
  closeChatSession,
  changeSessionStatus,  
  createChatTag,
  createClientNote,
  deleteClientNote,
  detachTagFromSession,
  getAllChatTags,
  getMessagePage,
  getChatSessions,
  getChatSession,
  getClientNotes,
  getSessionTags,
  markChatSessionRead,
  markChatSessionUnread,
  searchMessagePage,
  transferOperatorToSession,
  updateClientNote,
  setSessionPriority,
} from "@/features/inbox/inbox.api";
import { getOperators } from "@/features/operators/operators.api";
import { useAuthStore } from "@/store/auth.store";
import { offlineQueue, pendingMessage } from "@/lib/offline-queue";
import { authEpoch } from "@/lib/auth-session";
let messagesRequest = 0, sessionsRequest = 0, notesRequest = 0, tagsRequest = 0, searchRequest = 0, searchOpenRequest = 0;

interface InboxState {
  sessions: ChatSession[];
  activeSession: ChatSession | null;
  messages: ChatMessage[];
  notes: ClientNote[];
  allTags: ChatTag[];
  sessionTags: ChatSessionTag[];
  operators: ChatOperator[];
  isSessionsLoading: boolean;
  isMessagesLoading: boolean;
  olderCursor: string | null;
  isLoadingOlder: boolean;
  messagesFromCache: boolean;
  messagesError: string | null;
  focusedMessageId: string | null;
  readingLatest: boolean;
  loadOlderMessages: () => Promise<void>;
  isNotesLoading: boolean;
  isTagsLoading: boolean;
  isOperatorsLoading: boolean;
  filter: InboxFilter;
  searchQuery: string;
  typingPreviews: Record<string, { text: string; isTyping: boolean; updatedAt: number }>;
  setTypingPreview: (sessionId: string, text: string, isTyping: boolean) => void;  
  setFilter: (filter: InboxFilter) => void;
  setSearchQuery: (value: string) => void;
  setActiveSession: (session: ChatSession | null) => void;
  openSession: (session: ChatSession) => void;
  loadSessions: () => Promise<void>;
  loadMessages: (sessionId?: string | null) => Promise<void>;
  loadNotes: (sessionId?: string | null) => Promise<void>;
  loadTags: (sessionId?: string | null) => Promise<void>;
  loadOperators: () => Promise<void>;
  assignActiveSession: () => Promise<void>;
  transferActiveSession: (operatorId: string, comment?: string) => Promise<void>;
  closeActiveSession: () => Promise<void>;
  changeActiveSessionStatus: (status: string) => Promise<void>;  
  changeActiveSessionPriority: (priority: "urgent" | "high" | "normal" | "low") => Promise<void>;
  markActiveSessionRead: () => Promise<void>;
  markActiveSessionUnread: () => Promise<void>;
  sendMessage: (message: string, isInternal?: boolean, sessionId?: string) => Promise<void>;
  sendFile: (file: File, isInternal?: boolean, sessionId?: string) => Promise<void>;
  createNote: (noteText: string) => Promise<void>;
  updateNote: (noteId: string, noteText: string) => Promise<void>;
  deleteNote: (noteId: string) => Promise<void>;
  createTagAndAttach: (name: string, color: string) => Promise<void>;
  attachExistingTag: (tagId: string) => Promise<void>;
  detachSessionTag: (sessionTagId: string) => Promise<void>;
  messageSearchQuery: string;
  messageSearchResults: ChatMessage[];
  isMessageSearching: boolean;
  messageSearchTotal: number;
  messageSearchPage: number;
  messageSearchPages: number;
  messageSearchError: string | null;
  hasMessageSearch: boolean;
  setMessageSearchQuery: (value: string) => void;
  searchInMessages: (more?: boolean) => Promise<void>;
  clearMessageSearch: () => void;
  goToSearchResult: (message: ChatMessage) => void;  
  updateMessageStatuses: (updates: Array<{ id: string; status: "delivered" | "read"; delivered_at?: string; read_at?: string }>) => void; 
  replyTo: ChatMessage | null;
  setReplyTo: (msg: ChatMessage | null) => void;   
  appendMessage: (message: ChatMessage) => void;
  prependMessage: (message: ChatMessage) => void;
  upsertSession: (session: ChatSession) => void;
}

export const useInboxStore = create<InboxState>((set, get) => ({
  sessions: [],
  activeSession: null,
  messages: [],
  notes: [],
  allTags: [],
  sessionTags: [],
  operators: [],
  isSessionsLoading: true,
  isMessagesLoading: false,
  olderCursor: null, isLoadingOlder: false, messagesFromCache: false, messagesError: null, focusedMessageId: null, readingLatest: true,
  isNotesLoading: false,
  isTagsLoading: false,
  isOperatorsLoading: false,
  filter: "all",
  searchQuery: "",
  typingPreviews: {},
  replyTo: null,
  setReplyTo: (msg) => set({ replyTo: msg }),  
  setTypingPreview: (sessionId, text, isTyping) =>
    set((state) => ({
      typingPreviews: {
        ...state.typingPreviews,
        [sessionId]: { text, isTyping, updatedAt: Date.now() },
      },
    })),  
  messageSearchQuery: "",
  messageSearchResults: [],
  isMessageSearching: false,  
  messageSearchTotal: 0, messageSearchPage: 0, messageSearchPages: 0, messageSearchError: null, hasMessageSearch: false,

  setFilter: (filter) => set({ filter }),

  setSearchQuery: (value) => set({ searchQuery: value }),
  setMessageSearchQuery: (value) => { get().clearMessageSearch(); set({ messageSearchQuery: value }); },

  searchInMessages: async (more = false) => {
    const query = get().messageSearchQuery;
    const request = ++searchRequest, epoch = authEpoch();

    if (!query.trim()) {
      set({ messageSearchResults: [], isMessageSearching: false });
      return;
    }

    try {
      set({ isMessageSearching: true, messageSearchError: null });
      const results = await searchMessagePage(query, more ? get().messageSearchPage + 1 : 1);
      if (request !== searchRequest || epoch !== authEpoch()) return;
      const existing = more ? get().messageSearchResults : [];
      set({ messageSearchResults: [...existing, ...results.messages.filter(message => !existing.some(item => item.id === message.id))], messageSearchTotal: results.total, messageSearchPage: results.page, messageSearchPages: results.pages, hasMessageSearch: true });
    } catch (error) {
      console.error("searchInMessages error:", error);
      if (request === searchRequest && epoch === authEpoch()) set({ messageSearchError: "Не удалось выполнить поиск. Попробуйте ещё раз." });
    } finally {
      if (request === searchRequest && epoch === authEpoch()) set({ isMessageSearching: false });
    }
  },

  clearMessageSearch: () => {
    searchRequest++;
    set({
      messageSearchQuery: "",
      messageSearchResults: [],
      isMessageSearching: false,
      messageSearchTotal: 0, messageSearchPage: 0, messageSearchPages: 0, messageSearchError: null, hasMessageSearch: false,
    });
  },

  goToSearchResult: async (message) => {
    const request = ++searchOpenRequest, epoch = authEpoch(), activeId = get().activeSession?.id;
    try {
      const target = get().sessions.find((s) => s.id === message.session_id) || await getChatSession(message.session_id);
      if (request !== searchOpenRequest || epoch !== authEpoch() || get().activeSession?.id !== activeId) return;
      get().upsertSession(target);
      get().setActiveSession(target);
      get().clearMessageSearch();
      set({focusedMessageId:message.id,readingLatest:false});
      void get().loadMessages(target.id);
    } catch {
      if (epoch === authEpoch() && request === searchOpenRequest) set({messagesError:"Не удалось открыть найденный диалог. Повторите поиск."});
    }
  },  

  setActiveSession: session => {
    if(get().activeSession?.id !== session?.id) {
      messagesRequest++;
      set({activeSession:session,messages:[],notes:[],sessionTags:[],replyTo:null,olderCursor:null,isLoadingOlder:false,messagesError:null,messagesFromCache:false,focusedMessageId:null,readingLatest:true});
    } else set({activeSession:session});
  },
  // Viewing a conversation does not claim it. Explicit claim or sending does.
  openSession: session => get().setActiveSession(session),

  loadSessions: async () => {
    const request=++sessionsRequest,epoch=authEpoch();
    try {
      set({ isSessionsLoading: true });

      const sessions = await getChatSessions();
      if(request!==sessionsRequest||epoch!==authEpoch())return;
      // Диалог, открытый из поиска или уведомления, может не входить в список:
      // обновление списка не должно закрывать его у оператора.
      const active = get().activeSession;
      set({
        sessions,
        activeSession: active ? sessions.find((session) => session.id === active.id) ?? active : null,
      });
    } catch (error) {
      console.error("loadSessions error:", error);
    } finally {
      if(request===sessionsRequest&&epoch===authEpoch())set({ isSessionsLoading: false });
    }
  },

  loadMessages: async sessionId => {
    const target = sessionId ?? get().activeSession?.id;
    const operatorId = useAuthStore.getState().operator?.id;
    if (!target || !operatorId) return;
    const request = ++messagesRequest, epoch = authEpoch();
    const current = () => epoch === authEpoch() && request === messagesRequest && get().activeSession?.id === target;
    set({isMessagesLoading:true,messagesError:null});
    try {
      const page = await getMessagePage(target, null, get().focusedMessageId || undefined);
      const queued = (await offlineQueue.getAll()).filter(item => item.sessionId === target && item.operatorId === operatorId);
      if(!current()) return;
      const retained = get().messages.filter(item => !item.isPending && !page.messages.some(next => next.id === item.id));
      const messages = [...retained,...page.messages];
      for(const item of queued) if(!messages.some(m => m.client_message_id === item.clientId)) messages.push(pendingMessage(item));
      messages.sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at));
      set({messages,olderCursor:retained.length?get().olderCursor:page.next_cursor,messagesFromCache:false});
      void offlineQueue.cacheHistory(operatorId,target,messages).catch(()=>undefined);
    } catch(error) {
      if(!current()) return;
      const cached = await offlineQueue.history(operatorId,target).catch(()=>[]);
      const queued = await offlineQueue.getAll().catch(()=>[]);
      if(!current()) return;
      const messages = get().messages.length?get().messages:cached;
      const missing = queued.filter(item=>item.operatorId===operatorId&&item.sessionId===target&&!messages.some(m=>m.id===item.tempId||m.client_message_id===item.clientId));
      set({messages:[...messages,...missing.map(pendingMessage)],messagesFromCache:true,messagesError:'История сохранена на устройстве. Обновим её при восстановлении связи.'});
    } finally { if(current()) set({isMessagesLoading:false}); }
  },
  loadOlderMessages: async () => {
    const {activeSession,olderCursor,isLoadingOlder}=get();
    if(!activeSession||!olderCursor||isLoadingOlder) return;
    set({isLoadingOlder:true});
    try {
      const page=await getMessagePage(activeSession.id,olderCursor);
      if(get().activeSession?.id!==activeSession.id) return;
      set(state=>({messages:[...page.messages.filter(m=>!state.messages.some(x=>x.id===m.id)),...state.messages],olderCursor:page.next_cursor}));
    } catch { if(get().activeSession?.id===activeSession.id) set({messagesError:'Не удалось загрузить ранние сообщения. Попробуйте ещё раз.'}); }
    finally { if(get().activeSession?.id===activeSession.id) set({isLoadingOlder:false}); }
  },

  loadNotes: async (sessionId) => {
    const request=++notesRequest,epoch=authEpoch();
    const targetSessionId = sessionId ?? get().activeSession?.id;

    if (!targetSessionId) {
      set({ notes: [] });
      return;
    }

    try {
      set({ isNotesLoading: true });
      const notes = await getClientNotes(targetSessionId);
      if(request===notesRequest&&epoch===authEpoch()&&get().activeSession?.id === targetSessionId) set({ notes });
    } catch (error) {
      if(request===notesRequest&&epoch===authEpoch()&&get().activeSession?.id===targetSessionId) console.warn("[notes] Reload deferred");
    } finally {
      if(request===notesRequest&&epoch===authEpoch())set({ isNotesLoading: false });
    }
  },

  loadTags: async (sessionId) => {
    const request=++tagsRequest,epoch=authEpoch();
    const targetSessionId = sessionId ?? get().activeSession?.id;

    try {
      set({ isTagsLoading: true });

      const [allTags, sessionTags] = await Promise.all([
        getAllChatTags(),
        targetSessionId ? getSessionTags(targetSessionId) : Promise.resolve([]),
      ]);

      if(request===tagsRequest&&epoch===authEpoch())set({allTags,...(get().activeSession?.id===targetSessionId?{sessionTags}:{})});
    } catch (error) {
      if(request===tagsRequest&&epoch===authEpoch())console.warn("[tags] Reload deferred");
    } finally {
      if(request===tagsRequest&&epoch===authEpoch())set({ isTagsLoading: false });
    }
  },

  loadOperators: async () => {
    try {
      set({ isOperatorsLoading: true });
      const operators = await getOperators();
      set({ operators });
    } catch (error) {
      console.error("loadOperators error:", error);
      set({ operators: [] });
    } finally {
      set({ isOperatorsLoading: false });
    }
  },

  assignActiveSession: async () => {
    const activeSession = get().activeSession;
    const operator = useAuthStore.getState().operator;

    if (!activeSession?.id || !operator?.id) {
      return;
    }

    await assignOperatorToSession(activeSession.id, operator.id);
    await get().loadSessions();
  },

  transferActiveSession: async (operatorId, comment) => {
    const activeSession = get().activeSession;

    if (!activeSession?.id || !operatorId) {
      return;
    }

    const currentOperatorId = useAuthStore.getState().operator?.id;
    await transferOperatorToSession(activeSession.id, operatorId, currentOperatorId, comment);
    await get().loadSessions();
  },

  closeActiveSession: async () => {
    const activeSession = get().activeSession;
    const operator = useAuthStore.getState().operator;

    if (!activeSession?.id) {
      return;
    }

    await closeChatSession(activeSession.id, operator?.id);
    await get().loadSessions();
  },

  changeActiveSessionStatus: async (status) => {
    const activeSession = get().activeSession;
    const operator = useAuthStore.getState().operator;

    if (!activeSession?.id) {
      return;
    }

    await changeSessionStatus(activeSession.id, status, operator?.id);
    await get().loadSessions();
  },

  changeActiveSessionPriority: async (priority) => {
    const activeSession = get().activeSession;
    const operator = useAuthStore.getState().operator;

    if (!activeSession?.id) {
      return;
    }

    await setSessionPriority(activeSession.id, priority, activeSession.is_vip, operator?.id || undefined);
    await get().loadSessions();
  },

  markActiveSessionRead: async () => {
    const activeSession = get().activeSession;

    if (!activeSession?.id) {
      return;
    }

    await markChatSessionRead(activeSession.id);
    await get().loadSessions();
  },

  markActiveSessionUnread: async () => {
    const activeSession = get().activeSession;

    if (!activeSession?.id) {
      return;
    }

    await markChatSessionUnread(activeSession.id);
    await get().loadSessions();
  },

  sendMessage: async (message, isInternal=false, sessionId) => {
    const activeSession = sessionId ? get().sessions.find(s=>s.id===sessionId) : get().activeSession;
    const operator = useAuthStore.getState().operator;
    if(!activeSession||!operator) throw new Error('Нет активного диалога');
    if(activeSession.status==='closed') throw new Error('Сначала откройте диалог снова');
    if(!message.trim()||message.length>10000) throw new Error('Сообщение должно содержать от 1 до 10 000 символов');
    const id=crypto.randomUUID();
    const item={tempId:id,clientId:id,sessionId:activeSession.id,operatorId:operator.id,message:message.trim(),replyToId:get().replyTo?.isPending?undefined:get().replyTo?.id,isInternal,created_at:new Date().toISOString()};
    await offlineQueue.enqueue(item);
    if(get().activeSession?.id===activeSession.id) { get().appendMessage(pendingMessage(item));set({replyTo:null}); }
    void offlineQueue.syncOfflineMessages();
  },
  sendFile: async (file,isInternal=false,sessionId) => {
    const activeSession = sessionId ? get().sessions.find(s=>s.id===sessionId) : get().activeSession;
    const operator=useAuthStore.getState().operator;
    if(!activeSession||!operator) throw new Error('Нет активного диалога');
    if(activeSession.status==='closed') throw new Error('Сначала откройте диалог снова');
    if(file.size>10*1024*1024) throw new Error('Максимальный размер файла — 10 МБ');
    const id=crypto.randomUUID(),item={tempId:id,clientId:id,sessionId:activeSession.id,operatorId:operator.id,message:'',file,isInternal,created_at:new Date().toISOString()};
    await offlineQueue.enqueue(item);
    if(get().activeSession?.id===activeSession.id) get().appendMessage(pendingMessage(item));
    void offlineQueue.syncOfflineMessages();
  },

  createNote: async (noteText) => {
    const activeSession = get().activeSession;
    const operator = useAuthStore.getState().operator;

    if (!activeSession?.id || !operator?.id || !noteText.trim()) {
      return;
    }

    await createClientNote({
      sessionId: activeSession.id,
      operatorId: operator.id,
      noteText: noteText.trim(),
    });

    await get().loadNotes(activeSession.id);
  },

  updateNote: async (noteId, noteText) => {
    if (!noteId || !noteText.trim()) {
      return;
    }

    await updateClientNote(noteId, noteText.trim());
    await get().loadNotes();
  },

  deleteNote: async (noteId) => {
    if (!noteId) {
      return;
    }

    await deleteClientNote(noteId);
    await get().loadNotes();
  },

  createTagAndAttach: async (name, color) => {
    const activeSession = get().activeSession;

    if (!activeSession?.id || !name.trim()) {
      return;
    }

    const tag = await createChatTag({
      name: name.trim(),
      color,
    });

    await attachTagToSession({
      sessionId: activeSession.id,
      tagId: tag.id,
    });

    await get().loadTags(activeSession.id);
  },

  attachExistingTag: async (tagId) => {
    const activeSession = get().activeSession;

    if (!activeSession?.id || !tagId) {
      return;
    }

    await attachTagToSession({
      sessionId: activeSession.id,
      tagId,
    });

    await get().loadTags(activeSession.id);
  },

  detachSessionTag: async (tagId) => {
    const activeSession = get().activeSession;

    if (!activeSession?.id || !tagId) {
      return;
    }

    await detachTagFromSession(activeSession.id, tagId);
    await get().loadTags(activeSession.id);
  },

  updateMessageStatuses: (updates) => {
    const messages = get().messages;
    const updatedMessages = messages.map((msg) => {
      const update = updates.find((u) => u.id === msg.id);
      if (!update) return msg;
      return {
        ...msg,
        status: update.status,
        delivered_at: update.delivered_at ?? msg.delivered_at,
        read_at: update.read_at ?? msg.read_at,
      };
    });
    set({ messages: updatedMessages });
  },

  appendMessage: message => {
    if(get().activeSession?.id!==message.session_id) return;
    set(state=>{
      const index=state.messages.findIndex(item=>item.id===message.id||!!(message.client_message_id&&item.client_message_id===message.client_message_id));
      const messages=[...state.messages];if(index>=0)messages[index]=message;else messages.push(message);
      return {messages:messages.sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at))};
    });
  },

  prependMessage: (message) => {
    const current = get().messages;

    if (current.some((item) => item.id === message.id)) {
      return;
    }

    set({
      messages: [...current, message],
    });
  },

  upsertSession: (session) => {
    const sessions = get().sessions;
    const existingIndex = sessions.findIndex((item) => item.id === session.id);

    let nextSessions = [...sessions];

    if (existingIndex >= 0) {
      nextSessions[existingIndex] = session;
    } else {
      nextSessions.unshift(session);
    }

    nextSessions = nextSessions.sort((a, b) => {
      const aTime = new Date(a.last_message_at ?? a.created_at).getTime();
      const bTime = new Date(b.last_message_at ?? b.created_at).getTime();

      return bTime - aTime;
    });

    const activeSession = get().activeSession;
    const nextActive =
      activeSession?.id === session.id
        ? session
        : nextSessions.find((item) => item.id === activeSession?.id) ?? activeSession;

    set({
      sessions: nextSessions,
      activeSession: nextActive ?? null,
    });
  },
}));
