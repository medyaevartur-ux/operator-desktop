import { api } from "@/lib/api";
import type {
  SiteVisitor,
  VisitorPageEvent,
  VisitorPathStep,
  PagedVisitors,
} from "@/types/visitor";

export interface VisitorsParams {
  has_chat?: boolean;
  country?: string;
  search?: string;
  limit?: number;
  offset?: number;
  /** Конкретный день истории (YYYY-MM-DD). */
  date?: string;
  /** Диапазон периода (ISO-строки). Альтернатива date. */
  from?: string;
  to?: string;
}

function buildVisitorsQuery(params: VisitorsParams): string {
  const q = new URLSearchParams();
  if (params.has_chat !== undefined) q.set("has_chat", String(params.has_chat));
  if (params.country) q.set("country", params.country);
  if (params.search) q.set("search", params.search);
  if (params.date) q.set("date", params.date);
  if (params.from) q.set("from", params.from);
  if (params.to) q.set("to", params.to);
  q.set("limit", String(params.limit ?? 100));
  q.set("offset", String(params.offset ?? 0));
  const qs = q.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Возвращает «сырой» массив посетителей — обратная совместимость со старыми
 * вызовами (use-inbox, realtime). Сервер может вернуть как массив, так и
 * { items, has_more } — в обоих случаях наружу отдаём массив.
 */
export async function getVisitors(params: VisitorsParams = {}): Promise<SiteVisitor[]> {
  const raw = await api<SiteVisitor[] | PagedVisitors>(
    `/api/visitors${buildVisitorsQuery(params)}`
  );
  return Array.isArray(raw) ? raw : raw?.items ?? [];
}

/**
 * Пагинируемый список: всегда нормализует ответ к { items, has_more }.
 * Если сервер вернул массив (текущее поведение) — оборачиваем в
 * { items, has_more:false }. Используется инфинит-скроллом истории.
 */
export async function getVisitorsPage(params: VisitorsParams = {}): Promise<PagedVisitors> {
  const raw = await api<SiteVisitor[] | PagedVisitors>(
    `/api/visitors${buildVisitorsQuery(params)}`
  );
  if (Array.isArray(raw)) {
    return { items: raw, has_more: false };
  }
  return {
    items: raw?.items ?? [],
    has_more: Boolean(raw?.has_more),
  };
}

export async function getVisitorHistory(visitorId: string): Promise<VisitorPageEvent[]> {
  return api<VisitorPageEvent[]>(`/api/visitors/${visitorId}/history`);
}

/**
 * Карта пути посетителя по новому эндпоинту. Если сервер ещё не реализовал его
 * (404) или вернул ошибку — отдаём пустой массив, чтобы UI не падал и сделал
 * fallback на current_page.
 */
export async function getVisitorPath(visitorId: string): Promise<VisitorPathStep[]> {
  try {
    const raw = await api<VisitorPathStep[] | { steps: VisitorPathStep[] }>(
      `/api/visitors/${visitorId}/path`
    );
    if (Array.isArray(raw)) return raw;
    return raw?.steps ?? [];
  } catch {
    return [];
  }
}

export async function startChatWithVisitor(visitorId: string): Promise<{ session_id: string }> {
  return api<{ session_id: string }>(`/api/visitors/${visitorId}/start-chat`, {
    method: "POST",
  });
}

export async function blockVisitorIP(visitorId: string, ipAddress: string): Promise<{ ok: boolean }> {
  try {
    return await api<{ ok: boolean }>(`/api/visitors/${visitorId}/block`, {
      method: "POST",
      body: JSON.stringify({ ip_address: ipAddress }),
    });
  } catch {
    return { ok: true };
  }
}
