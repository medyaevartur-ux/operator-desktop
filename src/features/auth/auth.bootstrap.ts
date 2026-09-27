import { useAuthStore } from "@/store/auth.store";
export async function bootstrapAuth() { await useAuthStore.getState().checkAuth(); }
export function bindAuthListener() { return () => {}; }
