import { useDeliveryStore } from "@/store/delivery.store";
import { useInboxStore } from "@/store/inbox.store";
import { useNavigationStore } from "@/store/navigation.store";
import { useVisitorsStore } from "@/store/visitors.store";
import { useNotificationStore } from "@/store/notification.store";
import { create } from "zustand";
import { api } from "@/lib/api";
import { signIn, signOut, restoreSession, onSessionChange, type AuthSession } from "@/lib/auth-session";
import type { ChatOperator } from "@/types/operator";
import { disconnectSocket } from "@/lib/socket";
import { stopDeviceRegistration, startDeviceRegistration } from "@/lib/fcm";

interface AuthState {
  user: { id: string; email: string; role: string } | null;
  operator: ChatOperator | null;
  isLoading: boolean;
  token: string | null;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  setOperator: (operator: ChatOperator | null) => void;
  updateOperatorStatus: (status: "online" | "away" | "dnd" | "offline") => Promise<void>;
  setLoading: (value: boolean) => void;
  reset: () => void;
}
function sessionState(session: AuthSession | null) {
  return {
    user: session ? { id: session.operator.id, email: session.operator.email ?? "", role: session.operator.role ?? "operator" } : null,
    operator: session?.operator ?? null, token: session?.token ?? null, isLoading: false,
  };
}
export const useAuthStore = create<AuthState>((set, get) => ({
  user: null, operator: null, token: null, isLoading: true, error: null,
  login: async (email, password) => { set({ error: null }); await signIn(email, password); },
  logout: async () => {
    try { await signOut(); }
    catch { set({ error: "Вы вышли из приложения. Сервер недоступен: завершите этот сеанс в разделе «Устройства», когда восстановится связь." }); }
  },
  checkAuth: async () => {
    try {
      const session = await restoreSession();
      set({ ...sessionState(session), error: null });
      if (session) {
        void api<{ operator: ChatOperator }>("/api/auth/me").then(data => {
          if (get().operator?.id === data.operator.id) set({ operator: data.operator });
        }).catch(() => undefined);
      }
    } catch {
      set({ isLoading: false, error: "Не удалось восстановить вход. Проверьте подключение и повторите попытку." });
    }
  },
  setOperator: operator => set({ operator }),
  updateOperatorStatus: async status => {
    const operator = get().operator;
    if (!operator) return;
    await api(`/api/operators/${operator.id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
    if (get().operator?.id === operator.id) set({ operator: { ...operator, status, is_online: status !== "offline" } });
  },
  setLoading: isLoading => set({ isLoading }),
  reset: () => { void get().logout(); },
}));

onSessionChange(session => {
  const previous = useAuthStore.getState().operator?.id;
  const next = session?.operator.id;
  if (previous !== next) {
    stopDeviceRegistration();
    disconnectSocket();
    // Clear account data, including pending navigation, before another operator opens it.
    useInboxStore.setState(useInboxStore.getInitialState());
    useNavigationStore.setState(useNavigationStore.getInitialState());
    useVisitorsStore.setState(useVisitorsStore.getInitialState());
    useNotificationStore.getState().clearAll();
    useDeliveryStore.setState(useDeliveryStore.getInitialState());
  }
  useAuthStore.setState({ ...sessionState(session), error: null });
  if (session && previous !== next) void startDeviceRegistration(session.operator.id);
});
