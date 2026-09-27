import { signIn } from "@/lib/auth-session";
import { api } from "@/lib/api";
import type { ChatOperator } from "@/types/operator";
export const loginOperator = signIn;
export const getCurrentOperator = () => api<{ operator: ChatOperator }>("/api/auth/me");
