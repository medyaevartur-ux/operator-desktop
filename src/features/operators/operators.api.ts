import { api, API_BASE } from "@/lib/api";
import type { ChatOperator } from "@/types/operator";

export async function getOperators(): Promise<ChatOperator[]> {
  return api<ChatOperator[]>("/api/operators");
}

export async function getOperator(id: string): Promise<ChatOperator> {
  return api<ChatOperator>(`/api/operators/${id}`);
}

export async function createOperator(data: {
  email: string;
  name: string;
  password: string;
  role?: string;
  max_concurrent_chats?: number;
}) {
  return api<ChatOperator>("/api/operators", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateOperator(id: string, data: Record<string, any>) {
  return api(`/api/operators/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteOperator(id: string) {
  return api(`/api/operators/${id}`, { method: "DELETE" });
}

export async function uploadAvatar(id: string, file: File): Promise<{ avatar_url: string }> {
  const formData = new FormData();
  formData.append("file", file);

  const token = localStorage.getItem("chat_token");
  const res = await fetch(`${API_BASE}/api/operators/${id}/avatar`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (!res.ok) throw new Error("Upload failed");
  return res.json();
}

export async function changeOperatorStatus(
  operatorId: string,
  status: "online" | "away" | "dnd" | "offline"
) {
  return api(`/api/operators/${operatorId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}


// === Activity ===

export interface OperatorActivity {
  operator_id: string;
  period: { from: string; to: string };
  summary: {
    chats_handled: number;
    messages_sent: number;
    avg_first_response_sec: number;
  };
  daily: Array<{ date: string; chats: number; messages: number }>;
  recent_sessions: Array<{
    id: string;
    visitor_name: string | null;
    status: string;
    created_at: string;
    closed_at: string | null;
    operator_messages: number;
  }>;
}

export async function getOperatorActivity(
  operatorId: string,
  from?: string,
  to?: string
): Promise<OperatorActivity> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  return api<OperatorActivity>(`/api/operators/${operatorId}/activity${qs ? `?${qs}` : ""}`);
}