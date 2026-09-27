const CANONICAL_API = "https://zhivaya-skazka.ru";
function configuredApi() {
  try {
    const url = new URL(import.meta.env.VITE_API_URL || CANONICAL_API);
    if(url.username||url.password||url.search||url.hash||!["","/"].includes(url.pathname)) return CANONICAL_API;
    if(url.origin===CANONICAL_API) return CANONICAL_API;
    if(import.meta.env.DEV&&url.protocol==="http:"&&["localhost","127.0.0.1"].includes(url.hostname)) return url.origin;
  } catch { /* Legacy or invalid environment: use this project's HTTPS API. */ }
  return CANONICAL_API;
}
export const API_BASE = configuredApi();
export const isNative = () => "__TAURI_INTERNALS__" in window;
export const isAndroid = () => isNative() && /android/i.test(navigator.userAgent);

/** Abort the entire request on either the caller's signal or the deadline. */
export async function fetchWithDeadline(path: string, options: RequestInit = {}, timeoutMs = 20000): Promise<Response> {
  if (!path.startsWith("/api/") || path.includes("..")) throw new Error("Недопустимый адрес запроса");
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  try {
    return await fetch(`${API_BASE}${path}`, { ...options, signal: controller.signal, credentials: options.credentials ?? "include", redirect: "error" });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); this.name = "ApiError"; }
}
