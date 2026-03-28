import { api } from "@/lib/api";
import type { ChatOperator } from "@/types/operator";

export async function loginOperator(email: string, password: string) {
  return api<{ token: string; operator: ChatOperator }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function getCurrentOperator() {
  return api<{ operator: ChatOperator }>("/api/auth/me");
}