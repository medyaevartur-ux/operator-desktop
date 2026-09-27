import { ApiError, fetchWithDeadline } from "./api-config";
import { accessToken, authEpoch, expireSession, getSession } from "./auth-session";
export { API_BASE, ApiError } from "./api-config";

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const epoch = authEpoch();
  const token = await accessToken();
  const send = (bearer: string) => {
    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${bearer}`);
    if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    return fetchWithDeadline(path, { ...options, headers });
  };
  let response = await send(token);
  if (epoch !== authEpoch()) throw new ApiError("Учётная запись изменилась", 499);
  if (response.status === 401) {
    const latest = getSession()?.token;
    response = await send(latest && latest !== token ? latest : await accessToken(true));
  }
  if (epoch !== authEpoch()) throw new ApiError("Учётная запись изменилась", 499);
  if (response.status === 401) expireSession();
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(typeof body.error === "string" ? body.error : `Ошибка сервера (${response.status})`, response.status, body.code);
  }
  const text = await response.text();
  if (epoch !== authEpoch()) throw new ApiError("Учётная запись изменилась", 499);
  return (text ? JSON.parse(text) : {}) as T;
}
