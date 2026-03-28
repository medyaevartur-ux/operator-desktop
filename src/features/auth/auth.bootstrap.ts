import { useAuthStore } from "@/store/auth.store";

export async function bootstrapAuth() {
  try {
    await useAuthStore.getState().checkAuth();
  } catch (error) {
    console.error("bootstrapAuth error:", error);
    useAuthStore.getState().reset();
  }
}

export function bindAuthListener() {
  // Не нужен — JWT без подписки на события
  return () => {};
}