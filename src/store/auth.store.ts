import { create } from "zustand";
import { api, setToken, removeToken, isTokenExpired } from "@/lib/api";
import type { ChatOperator } from "@/types/operator";

// Кэш оператора — чтобы при перезапуске/возврате в приложение сессия
// восстанавливалась мгновенно, без ожидания сети и без повторного логина.
const OPERATOR_KEY = "chat_operator";
function loadCachedOperator(): ChatOperator | null {
  try {
    const raw = localStorage.getItem(OPERATOR_KEY);
    return raw ? (JSON.parse(raw) as ChatOperator) : null;
  } catch {
    return null;
  }
}
function cacheOperator(op: ChatOperator) {
  try { localStorage.setItem(OPERATOR_KEY, JSON.stringify(op)); } catch { /* ignore quota */ }
}
function clearCachedOperator() {
  localStorage.removeItem(OPERATOR_KEY);
}

interface AuthUser {
  id: string;
  email: string;
  role: string;
}

interface AuthState {
  user: AuthUser | null;
  operator: ChatOperator | null;
  isLoading: boolean;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<void>;
  setOperator: (operator: ChatOperator | null) => void;
  updateOperatorStatus: (status: "online" | "away" | "dnd" | "offline") => Promise<void>;  
  setLoading: (value: boolean) => void;
  reset: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  operator: null,
  isLoading: true,
  token: localStorage.getItem("chat_token"),

  login: async (email, password) => {
    const data = await api<{
      token: string;
      operator: ChatOperator;
    }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    setToken(data.token);
    cacheOperator(data.operator);

    set({
      user: {
        id: data.operator.id,
        email: data.operator.email ?? "",
        role: data.operator.role ?? "operator",
      },
      operator: data.operator,
      token: data.token,
      isLoading: false,
    });

    // Регистрируем FCM токен для push-уведомлений (Android)
    import("@/lib/fcm").then(({ registerFcmToken }) => {
      registerFcmToken(data.operator.id);
    }).catch(() => {});    
  },

  logout: () => {
    // Send offline status before clearing token
    const operator = get().operator;
    if (operator?.id) {
      const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3010";
      // Try Tauri native (reliable even on close)
      import("@/lib/tauri-bridge").then(({ notifyOfflineNative }) => {
        notifyOfflineNative(API_URL, operator.id);
      }).catch(() => {});
      // Also try fetch as fallback
      navigator.sendBeacon?.(
        `${API_URL}/api/operators/${operator.id}/online`,
        JSON.stringify({ is_online: false }),
      );
    }
    // Удаляем FCM токен
    import("@/lib/fcm").then(({ unregisterFcmToken }) => {
      unregisterFcmToken();
    }).catch(() => {});
    removeToken();
    clearCachedOperator();
    set({
      user: null,
      operator: null,
      token: null,
      isLoading: false,
    });
  },

  checkAuth: async () => {
    const token = localStorage.getItem("chat_token");

    if (!token) {
      set({ user: null, operator: null, isLoading: false });
      return;
    }

    // Мгновенное восстановление сессии из кэша — приложение открывается сразу,
    // без ожидания сети. Серверная валидация идёт фоном ниже.
    const cached = loadCachedOperator();
    if (cached) {
      set({
        user: { id: cached.id, email: cached.email ?? "", role: cached.role ?? "operator" },
        operator: cached,
        token,
        isLoading: false,
      });
    }

    try {
      const data = await api<{ operator: ChatOperator }>("/api/auth/me");
      cacheOperator(data.operator);
      set({
        user: {
          id: data.operator.id,
          email: data.operator.email ?? "",
          role: data.operator.role ?? "operator",
        },
        operator: data.operator,
        token,
        isLoading: false,
      });
      // Регистрируем FCM токен для push-уведомлений (Android)
      import("@/lib/fcm").then(({ registerFcmToken }) => {
        registerFcmToken(data.operator.id);
      }).catch(() => {});
    } catch {
      // Выходим в логин ТОЛЬКО если токен реально истёк. Сетевой сбой /
      // недоступность сервера не должны разлогинивать — остаёмся в сессии.
      if (isTokenExpired(token)) {
        removeToken();
        clearCachedOperator();
        set({ user: null, operator: null, token: null, isLoading: false });
      } else {
        // Токен ещё валиден — снимаем индикатор загрузки и работаем с кэшем.
        set({ isLoading: false });
      }
    }
  },

  setOperator: (operator) => set({ operator }),
  updateOperatorStatus: async (status: "online" | "away" | "dnd" | "offline") => {
    const operator = get().operator;
    if (!operator?.id) return;

    const { changeOperatorStatus } = await import("@/features/operators/operators.api");
    await changeOperatorStatus(operator.id, status);

    set({
      operator: { ...operator, status, is_online: status !== "offline" },
    });
  },  

  setLoading: (value) => set({ isLoading: value }),

  reset: () => {
    removeToken();
    clearCachedOperator();
    set({ user: null, operator: null, token: null, isLoading: false });
  },
}));