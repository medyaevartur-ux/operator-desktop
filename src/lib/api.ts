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

/**
 * Истёк ли JWT по полю exp. Если exp нет или токен нечитаем — считаем НЕ истёкшим
 * (не выкидываем оператора из-за нестандартного токена/сетевых причин).
 */
export function isTokenExpired(token: string | null): boolean {
  if (!token) return true;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    if (!payload || typeof payload.exp !== "number") return false;
    return payload.exp * 1000 <= Date.now();
  } catch {
    return false;
  }
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
    // Выкидываем в логин ТОЛЬКО если токен действительно истёк.
    // Транзиентный 401 от отдельного эндпоинта не должен сбрасывать всю сессию —
    // оператор остаётся в приложении до реального истечения или явного выхода.
    if (isTokenExpired(token)) {
      removeToken();
      const { useAuthStore } = await import("@/store/auth.store");
      useAuthStore.getState().reset();
    }
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