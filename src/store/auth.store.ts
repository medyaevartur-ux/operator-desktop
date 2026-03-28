import { create } from "zustand";
import { api, setToken, removeToken } from "@/lib/api";
import type { ChatOperator } from "@/types/operator";

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
  },

  logout: () => {
    removeToken();
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

    try {
      const data = await api<{ operator: ChatOperator }>("/api/auth/me");

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
    } catch {
      removeToken();
      set({ user: null, operator: null, token: null, isLoading: false });
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
    set({ user: null, operator: null, token: null, isLoading: false });
  },
}));