import { api } from "@/lib/api";
import type { SiteVisitor, VisitorPageEvent } from "@/types/visitor";

export interface VisitorsParams {
  has_chat?: boolean;
  country?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function getVisitors(params: VisitorsParams = {}): Promise<SiteVisitor[]> {
  const q = new URLSearchParams();
  if (params.has_chat !== undefined) q.set("has_chat", String(params.has_chat));
  if (params.country) q.set("country", params.country);
  if (params.search) q.set("search", params.search);
  q.set("limit", String(params.limit ?? 100));
  q.set("offset", String(params.offset ?? 0));

  const qs = q.toString();
  return api<SiteVisitor[]>(`/api/visitors${qs ? `?${qs}` : ""}`);
}

export async function getVisitorHistory(visitorId: string): Promise<VisitorPageEvent[]> {
  return api<VisitorPageEvent[]>(`/api/visitors/${visitorId}/history`);
}

export async function startChatWithVisitor(visitorId: string): Promise<{ session_id: string }> {
  return api<{ session_id: string }>(`/api/visitors/${visitorId}/start-chat`, {
    method: "POST",
  });
}