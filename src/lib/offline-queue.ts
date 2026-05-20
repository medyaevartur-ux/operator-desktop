// c:\Users\Medya\Projects\operator-desktop\src\lib\offline-queue.ts
/**
 * Сервис управления оффлайн-очередью сообщений на базе IndexedDB.
 * Обеспечивает работу чата при нестабильном интернет-соединении, сохраняя
 * неотправленные сообщения оператора локально и отправляя их автоматически
 * при восстановлении сети.
 */

import { sendOperatorMessage } from "@/features/inbox/inbox.api";
import { useInboxStore } from "@/store/inbox.store";

export interface OfflineMessage {
  tempId: string;
  sessionId: string;
  operatorId: string;
  message: string;
  replyToId?: string;
  created_at: string;
}

const DB_NAME = "zs_offline_db";
const DB_VERSION = 1;
const STORE_NAME = "offline_messages";

class OfflineQueueService {
  private db: IDBDatabase | null = null;
  private isSyncing = false;

  constructor() {
    // Инициализируем IndexedDB при создании сервиса
    if (typeof window !== "undefined") {
      this.initDb();
      this.setupNetworkListeners();
    }
  }

  /**
   * Инициализация базы данных IndexedDB
   */
  private initDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (this.db) {
        resolve(this.db);
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error("[OfflineQueue] Ошибка открытия базы данных IndexedDB");
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log("[OfflineQueue] IndexedDB успешно инициализирована");
        resolve(request.result);
      };

      request.onupgradeneeded = (event) => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "tempId" });
        }
      };
    });
  }

  /**
   * Слушатели для автоматической синхронизации при переходе в онлайн
   */
  private setupNetworkListeners() {
    window.addEventListener("online", () => {
      console.log("[OfflineQueue] Сеть восстановлена! Запуск синхронизации...");
      void this.syncOfflineMessages();
    });

    // На случай, если приложение загрузилось в онлайне и есть зависшие сообщения
    setTimeout(() => {
      if (navigator.onLine) {
        void this.syncOfflineMessages();
      }
    }, 5000);
  }

  /**
   * Добавление сообщения в оффлайн-очередь в IndexedDB
   */
  public async enqueue(msg: OfflineMessage): Promise<void> {
    const db = await this.initDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(msg);

      request.onsuccess = () => {
        console.log(`[OfflineQueue] Сообщение ${msg.tempId} добавлено в оффлайн-очередь`);
        resolve();
      };

      request.onerror = () => {
        console.error("[OfflineQueue] Ошибка при сохранении сообщения в IndexedDB", request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Удаление сообщения из оффлайн-очереди
   */
  public async dequeue(tempId: string): Promise<void> {
    const db = await this.initDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(tempId);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * Получение всех неотправленных сообщений
   */
  public async getAll(): Promise<OfflineMessage[]> {
    const db = await this.initDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result || []);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * Синхронизация сохраненных оффлайн-сообщений с сервером
   */
  public async syncOfflineMessages(): Promise<void> {
    if (this.isSyncing) return;
    if (!navigator.onLine) return;

    const messages = await this.getAll();
    if (messages.length === 0) return;

    console.log(`[OfflineQueue] Обнаружено ${messages.length} сообщений для отправки.`);
    this.isSyncing = true;

    const store = useInboxStore.getState();

    // Сортируем по дате создания, чтобы соблюдать хронологию
    const sortedMessages = [...messages].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    for (const msg of sortedMessages) {
      try {
        console.log(`[OfflineQueue] Отправка сообщения ${msg.tempId}...`);
        const sentMsg = await sendOperatorMessage({
          sessionId: msg.sessionId,
          operatorId: msg.operatorId,
          message: msg.message,
          replyToId: msg.replyToId,
        });

        // Удаляем из оффлайн очереди
        await this.dequeue(msg.tempId);

        // Обновляем сообщения в Zustand сторе
        // Нам нужно заменить временное pending-сообщение на реальное, пришедшее с сервера
        const currentMessages = useInboxStore.getState().messages;
        const updatedMessages = currentMessages.map((m) =>
          m.id === msg.tempId ? { ...sentMsg } : m
        );
        
        // Перезаписываем сообщения в Zustand
        useInboxStore.setState({ messages: updatedMessages });
        console.log(`[OfflineQueue] Сообщение ${msg.tempId} успешно отправлено и заменено в сторе`);
      } catch (err) {
        console.error(`[OfflineQueue] Ошибка при отправке сообщения ${msg.tempId}:`, err);
        // Прерываем цикл, так как, возможно, сеть пропала снова или упал бэкенд
        break;
      }
    }

    this.isSyncing = false;

    // После синхронизации перезагружаем сессии для обновления последнего сообщения в списке
    await store.loadSessions();
  }
}

export const offlineQueue = new OfflineQueueService();
