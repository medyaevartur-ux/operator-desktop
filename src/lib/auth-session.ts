import type { ChatOperator } from "@/types/operator";
import { API_BASE, ApiError, fetchWithDeadline, isNative, isAndroid } from "./api-config";

export interface AuthSession {
  api_base: string;
  token: string;
  installation_id: string;
  operator: ChatOperator;
  expires_at: number;
}
interface TokenPair { installation_id?: string; token: string; refresh_token?: string; operator: ChatOperator; expires_in: number }
const INSTALLATION_KEY = "chat_v8_installation";
let current: AuthSession | null = null;
let epoch = 0;
let refreshWork: Promise<AuthSession | null> | null = null;
let writes: Promise<unknown> = Promise.resolve();
let locallySignedOut = localStorage.getItem("chat_v8_logged_out") === "true";
const listeners = new Set<(session: AuthSession | null) => void>();
const channel = typeof BroadcastChannel !== "undefined" && !isNative() ? new BroadcastChannel("chat-v8-auth") : null;

// Version 7 credentials were stored in browser storage. A one-time new login
// creates a revocable v8 session; do not silently keep the old bearer token.
for (const key of ["chat_token", "chat_operator", "fcm_token_sent", "fcm_registration"]) {
  try { localStorage.removeItem(key); } catch { /* Restricted browser storage. */ }
}

export function installationId(): string {
  let value: string | null = null;
  try { value = localStorage.getItem(INSTALLATION_KEY); } catch { /* See fallback below. */ }
  if (value && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)) return value;
  value = crypto.randomUUID();
  // An installation identifier is not a credential. Persisting it is required
  // for a cookie session to survive reloads and for device revocation to work.
  try { localStorage.setItem(INSTALLATION_KEY, value); }
  catch { throw new Error("Разрешите локальное хранилище для входа в приложение."); }
  return value;
}
export const clientName = () => isAndroid() ? "Android · Живая Сказка" : isNative() ? "Windows · Живая Сказка" : "Браузер · Живая Сказка";
export const authEpoch = () => epoch;
export const getSession = () => current;
export function onSessionChange(listener: (session: AuthSession | null) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function publish(session: AuthSession | null) {
  current = session;
  for (const listener of listeners) listener(session);
}
async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return (await import("@tauri-apps/api/core")).invoke<T>(command, args);
}
function serialize<T>(work: () => Promise<T>): Promise<T> {
  const result = writes.then(work);
  writes = result.catch(() => undefined);
  return result;
}
function publicPair(pair: TokenPair, id: string): AuthSession {
  if (!pair.token || !pair.operator?.id || !Number.isFinite(pair.expires_in)) {
    throw new Error("Сервер ещё не обновлён до версии 8. Обратитесь к администратору.");
  }
  return { api_base: API_BASE, token: pair.token, installation_id: pair.installation_id || id, operator: pair.operator, expires_at: Date.now() + pair.expires_in * 1000 };
}
async function parsePair(response: Response): Promise<TokenPair> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(body.error || "Не удалось выполнить вход", response.status);
  return body;
}

export async function signIn(email: string, password: string): Promise<AuthSession> {
  return serialize(async () => {
    await refreshWork?.catch(() => undefined);
    const attempt = ++epoch;
    locallySignedOut = true;
    const id = installationId();
    const response = await fetchWithDeadline("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Chat-Client": isNative() ? "native" : "web" },
      body: JSON.stringify({ email, password, installation_id: id, client_name: clientName() }),
    });
    const pair = await parsePair(response);
    let session = publicPair(pair, id);
    if (attempt !== epoch) throw new ApiError("Вход отменён", 499);
    if (isNative()) {
      if (!pair.refresh_token) throw new Error("Сервер не вернул защищённый сеанс");
      session = await invoke<AuthSession>("auth_save_session", { data: JSON.stringify({ ...session, refresh_token: pair.refresh_token }) });
    }
    if (attempt !== epoch) throw new ApiError("Вход отменён", 499);
    locallySignedOut = false;
    localStorage.setItem(INSTALLATION_KEY,session.installation_id);
    publish(session);
    localStorage.removeItem("chat_v8_logged_out");
    channel?.postMessage({ type: "signed-in" });
    return session;
  });
}

/** Access tokens live only in memory; refresh stays in an OS vault or HttpOnly cookie. */
export async function restoreSession(force = false): Promise<AuthSession | null> {
  if (locallySignedOut) return null;
  if (!force && current && current.expires_at > Date.now() + 60000) return current;
  if (refreshWork) return refreshWork;
  const attempt = epoch;
  const run = async () => {
    try {
      let session: AuthSession | null;
      if (isNative()) {
        session = await invoke<AuthSession | null>("auth_get_session", { force });
        if (session && session.api_base.replace(/\/$/, "") !== API_BASE) throw new Error("Адрес сохранённого сеанса не совпадает с приложением");
        if (session) localStorage.setItem(INSTALLATION_KEY, session.installation_id);
      } else {
        const refresh = async () => publicPair(await parsePair(await fetchWithDeadline("/api/chat-v8/auth/refresh", {
          method: "POST", headers: { "Content-Type": "application/json", "X-Chat-Client": "web" },
          body: JSON.stringify({ installation_id: installationId() }),
        })), installationId());
        session = navigator.locks ? await navigator.locks.request("chat-v8-refresh", refresh) : await refresh();
      }
      if (attempt !== epoch) return current;
      if (!session) { ++epoch; publish(null); } else publish(session);
      return session;
    } catch (error) {
      if (attempt !== epoch) return current;
      if (error instanceof ApiError && error.status === 401) { ++epoch; publish(null); return null; }
      // A network failure does not revoke the operator's local session.
      if (!force && current) return current;
      throw error;
    }
  };
  refreshWork = run().finally(() => { refreshWork = null; });
  return refreshWork;
}
export async function accessToken(force = false): Promise<string> {
  const session = await restoreSession(force);
  if (!session) throw new ApiError("Сеанс завершён. Войдите снова.", 401);
  return session.token;
}

export function signOut(): Promise<void> {
  locallySignedOut = true;
  localStorage.setItem("chat_v8_logged_out", "true");
  ++epoch;
  publish(null);
  channel?.postMessage({ type: "signed-out" });
  return serialize(async () => {
    if (isNative()) await invoke("auth_clear_session");
    else {
      await writesForBrowserLogout();
    }
  });
}
async function writesForBrowserLogout() {
  // Let an already-running cookie refresh finish before clearing that cookie.
  await refreshWork?.catch(() => undefined);
  const response = await fetchWithDeadline("/api/chat-v8/auth/logout", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Chat-Client": "web" }, body: "{}",
  });
  if (!response.ok && response.status !== 401) throw new ApiError("Не удалось завершить сеанс на сервере", response.status);
}
export function expireSession() { ++epoch; locallySignedOut = true; publish(null); }
channel?.addEventListener("message", event => {
  if (event.data?.type === "signed-out") expireSession();
  if (event.data?.type === "signed-in") { ++epoch; locallySignedOut = false; publish(null); void restoreSession(true).catch(() => undefined); }
});
