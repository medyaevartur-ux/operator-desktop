import { sendOperatorMessage, uploadMessageImage } from "@/features/inbox/inbox.api";
import { useInboxStore } from "@/store/inbox.store";
import { getSession, authEpoch } from "./auth-session";
import { ApiError } from "./api";
import type { ChatMessage } from "@/types/chat";

export interface OfflineMessage {
  tempId: string;
  clientId?: string;
  sessionId: string;
  operatorId: string;
  message: string;
  replyToId?: string;
  isInternal?: boolean;
  file?: File;
  created_at: string;
  error?: string;
  /** Сколько раз сервер ответил ошибкой (сбои сети не считаются: ждём связи). */
  attempts?: number;
  lastError?: string;
}
const MAX_SERVER_ATTEMPTS = 8;
const changed = () => window.dispatchEvent(new Event("outbox-changed"));
export function pendingMessage(item: OfflineMessage): ChatMessage {
  return { id: item.tempId, client_message_id: item.clientId || item.tempId, session_id: item.sessionId, operator_id: item.operatorId,
    sender: "operator", message: item.message || item.file?.name || "Файл", reply_to_id: item.replyToId, is_internal: item.isInternal,
    is_read: false, isPending: true, sendError: item.error, created_at: item.created_at };
}
const DB_NAME = "zs_offline_db", STORE = "offline_messages";
export class OfflineQueueService {
  private db: Promise<IDBDatabase> | null = null;
  private isSyncing = false;
  private activeId: string | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryMs = 2000;
  private open(): Promise<IDBDatabase> {
    if (!this.db) this.db = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 2);
      request.onerror = () => { this.db = null; reject(request.error); };
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "tempId" });
        if (!request.result.objectStoreNames.contains("history")) request.result.createObjectStore("history", { keyPath: "key" });
      };
      request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); this.db = null; }; resolve(request.result); };
    });
    return this.db;
  }
  private async write(store: string, work: (target: IDBObjectStore) => void) {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(store, "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("Не удалось сохранить сообщение"));
      work(transaction.objectStore(store));
    });
  }
  async enqueue(item: OfflineMessage) { await this.write(STORE, store => store.put(item)); changed(); }
  async dequeue(id: string) { await this.write(STORE, store => store.delete(id)); changed(); }
  /** Сообщение, которое сейчас уходит на сервер (его нельзя отменить). */
  get sendingId() { return this.activeId; }
  async getAll(): Promise<OfflineMessage[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result || []); request.onerror = () => reject(request.error);
    });
  }
  async cacheHistory(operatorId: string, sessionId: string, messages: ChatMessage[]) {
    await this.write("history", store => {
      store.put({ key: `${operatorId}:${sessionId}`, updated: Date.now(), messages: messages.filter(m => !m.isPending).slice(-500) });
      const all = store.getAll();
      all.onsuccess = () => {
        for (const row of all.result.sort((a, b) => b.updated - a.updated).slice(100)) store.delete(row.key);
      };
    });
  }
  async history(operatorId: string, sessionId: string): Promise<ChatMessage[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction("history").objectStore("history").get(`${operatorId}:${sessionId}`);
      request.onsuccess = () => resolve(request.result?.messages || []); request.onerror = () => reject(request.error);
    });
  }
  async retry(id: string) {
    const message = (await this.getAll()).find(item => item.tempId === id && item.operatorId === getSession()?.operator.id);
    if (!message) return;
    await this.enqueue({ ...message, error: undefined, attempts: 0, lastError: undefined });
    useInboxStore.setState(state => ({ messages: state.messages.map(item => item.id === id ? { ...item, sendError: undefined } : item) }));
    await this.syncOfflineMessages();
  }
  async cancel(id: string) {
    if(this.activeId===id) throw new Error("Сообщение уже отправляется. Дождитесь подтверждения.");
    const message = (await this.getAll()).find(item => item.tempId === id && item.operatorId === getSession()?.operator.id);
    if (!message) return;
    await this.dequeue(id);
    useInboxStore.setState(state => ({ messages: state.messages.filter(item => item.id !== id) }));
  }
  async syncOfflineMessages(): Promise<void> {
    if (this.isSyncing || !navigator.onLine) return;
    const operatorId = getSession()?.operator.id, epoch = authEpoch();
    if (!operatorId) return;
    this.isSyncing = true;
    clearTimeout(this.retryTimer);
    let needsRetry = false;
    try {
      const queue = (await this.getAll()).filter(item => item.operatorId === operatorId && !item.error).sort((a, b) => a.created_at.localeCompare(b.created_at));
      // Порядок важен внутри диалога: сбой в одном чате придерживает только его, остальные уходят.
      const held = new Set<string>();
      for (const item of queue) {
        if (authEpoch() !== epoch) break;
        if (held.has(item.sessionId)) continue;
        // Upgrade old unsent v7 entries once; every retry uses the same UUID.
        if (!item.clientId) { item.clientId = crypto.randomUUID(); await this.enqueue(item); }
        this.activeId=item.tempId;
        try {
          const sent = item.file
            ? await uploadMessageImage(item.sessionId, operatorId, item.file, item.clientId, !!item.isInternal)
            : await sendOperatorMessage({ sessionId: item.sessionId, operatorId, message: item.message, replyToId: item.replyToId, clientId: item.clientId, isInternal: item.isInternal });
          await this.dequeue(item.tempId);
          if (authEpoch() === epoch && useInboxStore.getState().activeSession?.id === item.sessionId) {
            useInboxStore.setState(state => ({ messages: state.messages.filter(m => m.id !== item.tempId && m.id !== sent.id) }));
            useInboxStore.getState().appendMessage(sent);
          }
          this.retryMs = 2000;
        } catch (error) {
          if (authEpoch() !== epoch) break;
          if (error instanceof ApiError && error.status >= 400 && error.status < 500 && ![401, 408, 425, 429, 499].includes(error.status)) {
            const failed = { ...item, error: error.message };
            await this.enqueue(failed);
            useInboxStore.setState(state => ({ messages: state.messages.map(m => m.id === item.tempId ? pendingMessage(failed) : m) }));
            continue;
          }
          held.add(item.sessionId);
          if (error instanceof ApiError && error.status >= 500) {
            // Сервер отвечает ошибкой: после нескольких попыток решение за оператором (повторить или убрать).
            const attempts = (item.attempts ?? 0) + 1;
            const next: OfflineMessage = attempts >= MAX_SERVER_ATTEMPTS
              ? { ...item, attempts, lastError: error.message, error: "Сервер не принял сообщение. Повторите позже или уберите его." }
              : { ...item, attempts, lastError: error.message };
            await this.enqueue(next);
            if (next.error) useInboxStore.setState(state => ({ messages: state.messages.map(m => m.id === item.tempId ? pendingMessage(next) : m) }));
            else needsRetry = true;
            continue;
          }
          // Сети нет: ждём связи, ничего не помечая ошибкой.
          needsRetry = true;
          if (!navigator.onLine) break;
        }
      }
      if (authEpoch() === epoch) void useInboxStore.getState().loadSessions();
    } catch { needsRetry = true; }
    finally {
      this.activeId=null;
      this.isSyncing = false;
      if (needsRetry && authEpoch() === epoch) {
        this.retryTimer = setTimeout(() => void this.syncOfflineMessages(), this.retryMs);
        this.retryMs = Math.min(60000, this.retryMs * 2);
      } else if(authEpoch() === epoch) {
        // Entries created during a running flush were not in its snapshot.
        void this.getAll().then(items=>{
          if(authEpoch()===epoch && items.some(item=>item.operatorId===operatorId&&!item.error)) this.retryTimer=setTimeout(()=>void this.syncOfflineMessages(),250);
        }).catch(()=>undefined);
      }
    }
  }
}
export const offlineQueue = new OfflineQueueService();
window.addEventListener("online", () => void offlineQueue.syncOfflineMessages());
window.addEventListener("chat-device-ready", () => void offlineQueue.syncOfflineMessages());
document.addEventListener("visibilitychange", () => { if (!document.hidden) void offlineQueue.syncOfflineMessages(); });
