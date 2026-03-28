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
  getChatMessages,
  getChatSessions,
  getClientNotes,
  getSessionTags,
  markChatSessionRead,
  markChatSessionUnread,
  searchMessages,
  sendOperatorMessage,
  transferOperatorToSession,
  updateClientNote,
} from "@/features/inbox/inbox.api";
import { getOperators } from "@/features/operators/operators.api";
import { useAuthStore } from "@/store/auth.store";

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
  loadSessions: () => Promise<void>;
  loadMessages: (sessionId?: string | null) => Promise<void>;
  loadNotes: (sessionId?: string | null) => Promise<void>;
  loadTags: (sessionId?: string | null) => Promise<void>;
  loadOperators: () => Promise<void>;
  assignActiveSession: () => Promise<void>;
  transferActiveSession: (operatorId: string) => Promise<void>;
  closeActiveSession: () => Promise<void>;
  changeActiveSessionStatus: (status: string) => Promise<void>;  
  markActiveSessionRead: () => Promise<void>;
  markActiveSessionUnread: () => Promise<void>;
  sendMessage: (message: string) => Promise<void>;
  createNote: (noteText: string) => Promise<void>;
  updateNote: (noteId: string, noteText: string) => Promise<void>;
  deleteNote: (noteId: string) => Promise<void>;
  createTagAndAttach: (name: string, color: string) => Promise<void>;
  attachExistingTag: (tagId: string) => Promise<void>;
  detachSessionTag: (sessionTagId: string) => Promise<void>;
  messageSearchQuery: string;
  messageSearchResults: ChatMessage[];
  isMessageSearching: boolean;
  setMessageSearchQuery: (value: string) => void;
  searchInMessages: () => Promise<void>;
  clearMessageSearch: () => void;
  goToSearchResult: (message: ChatMessage) => void;  
  updateMessageStatuses: (updates: Array<{ id: string; status: "delivered" | "read"; delivered_at?: string; read_at?: string }>) => void;  
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
  isNotesLoading: false,
  isTagsLoading: false,
  isOperatorsLoading: false,
  filter: "all",
  searchQuery: "",
  typingPreviews: {},
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

  setFilter: (filter) => set({ filter }),

  setSearchQuery: (value) => set({ searchQuery: value }),
  setMessageSearchQuery: (value) => set({ messageSearchQuery: value }),

  searchInMessages: async () => {
    const query = get().messageSearchQuery;

    if (!query.trim()) {
      set({ messageSearchResults: [], isMessageSearching: false });
      return;
    }

    try {
      set({ isMessageSearching: true });
      const results = await searchMessages(query);
      set({ messageSearchResults: results });
    } catch (error) {
      console.error("searchInMessages error:", error);
      set({ messageSearchResults: [] });
    } finally {
      set({ isMessageSearching: false });
    }
  },

  clearMessageSearch: () => {
    set({
      messageSearchQuery: "",
      messageSearchResults: [],
      isMessageSearching: false,
    });
  },

  goToSearchResult: (message) => {
    const sessions = get().sessions;
    const target = sessions.find((s) => s.id === message.session_id);

    if (target) {
      set({ activeSession: target });
      get().clearMessageSearch();
    }
  },  

  setActiveSession: (session) => set({ activeSession: session }),

  loadSessions: async () => {
    try {
      set({ isSessionsLoading: true });

      const sessions = await getChatSessions();
      const currentActiveId = get().activeSession?.id;

      let nextActiveSession: ChatSession | null = null;

      if (currentActiveId) {
        nextActiveSession = sessions.find((session) => session.id === currentActiveId) ?? null;
      }

      if (!nextActiveSession) {
        nextActiveSession = sessions[0] ?? null;
      }

      set({
        sessions,
        activeSession: nextActiveSession,
      });
    } catch (error) {
      console.error("loadSessions error:", error);
    } finally {
      set({ isSessionsLoading: false });
    }
  },

  loadMessages: async (sessionId) => {
    const targetSessionId = sessionId ?? get().activeSession?.id;

    if (!targetSessionId) {
      set({ messages: [] });
      return;
    }

    try {
      set({ isMessagesLoading: true });
      const messages = await getChatMessages(targetSessionId);
      set({ messages });
    } catch (error) {
      console.error("loadMessages error:", error);
    } finally {
      set({ isMessagesLoading: false });
    }
  },

  loadNotes: async (sessionId) => {
    const targetSessionId = sessionId ?? get().activeSession?.id;

    if (!targetSessionId) {
      set({ notes: [] });
      return;
    }

    try {
      set({ isNotesLoading: true });
      const notes = await getClientNotes(targetSessionId);
      set({ notes });
    } catch (error) {
      console.error("loadNotes error:", error);
      set({ notes: [] });
    } finally {
      set({ isNotesLoading: false });
    }
  },

  loadTags: async (sessionId) => {
    const targetSessionId = sessionId ?? get().activeSession?.id;

    try {
      set({ isTagsLoading: true });

      const [allTags, sessionTags] = await Promise.all([
        getAllChatTags(),
        targetSessionId ? getSessionTags(targetSessionId) : Promise.resolve([]),
      ]);

      set({
        allTags,
        sessionTags,
      });
    } catch (error) {
      console.error("loadTags error:", error);
      set({
        allTags: [],
        sessionTags: [],
      });
    } finally {
      set({ isTagsLoading: false });
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

  transferActiveSession: async (operatorId) => {
    const activeSession = get().activeSession;

    if (!activeSession?.id || !operatorId) {
      return;
    }

    const currentOperatorId = useAuthStore.getState().operator?.id;
    await transferOperatorToSession(activeSession.id, operatorId, currentOperatorId);
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

  sendMessage: async (message) => {
    const activeSession = get().activeSession;
    const operator = useAuthStore.getState().operator;

    if (!activeSession?.id || !operator?.id) {
      throw new Error("Нет активного чата или оператора");
    }

    if (!activeSession.operator_id || activeSession.operator_id !== operator.id) {
      await assignOperatorToSession(activeSession.id, operator.id);
    }

    const newMessage = await sendOperatorMessage({
      sessionId: activeSession.id,
      operatorId: operator.id,
      message,
    });

    // Добавляем с реальным id — dedupe защитит от дубля через realtime
    get().appendMessage(newMessage);
    await get().loadSessions();
  },

  createNote: async (noteText) => {
    const activeSession = get().activeSession;
    const operator = useAuthStore.getState().operator;

    console.log("=== CREATE NOTE DEBUG ===");
    console.log("activeSession.id:", activeSession?.id);
    console.log("operator:", JSON.stringify(operator, null, 2));
    console.log("noteText:", noteText);

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

    console.log("=== CREATE TAG DEBUG ===");
    console.log("activeSession.id:", activeSession?.id);
    console.log("name:", name, "color:", color);

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

  appendMessage: (message) => {
    const existing = get().messages;
    const isDuplicate = existing.some((m) => m.id === message.id);

    if (isDuplicate) {
      return;
    }

    set({ messages: [...existing, message] });
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