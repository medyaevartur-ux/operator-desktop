export const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3010";

function getToken(): string | null {
  return localStorage.getItem("chat_token");
}

export function setToken(token: string) {
  localStorage.setItem("chat_token", token);
}

export function removeToken() {
  localStorage.removeItem("chat_token");
}

export async function api<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const hasBody = !!options.body;

  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  if (hasBody) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...headers,
      ...options.headers,
    },
  });

  if (res.status === 401) {
    removeToken();
    const { useAuthStore } = await import("@/store/auth.store");
    useAuthStore.getState().reset();
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `API error ${res.status}`);
  }

  const text = await res.text();
  if (!text) return {} as T;

  return JSON.parse(text);
}