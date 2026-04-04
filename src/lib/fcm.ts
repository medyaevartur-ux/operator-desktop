import { api } from "@/lib/api";

export async function registerFcmToken(operatorId: string): Promise<void> {
  let attempts = 0;
  const maxAttempts = 15;

  const tryRegister = async () => {
    attempts++;
    console.log(`[fcm] Attempt ${attempts}/${maxAttempts} to get token...`);

    try {
      // Читаем токен, инжектированный из Kotlin через evaluateJavascript
      const token = (window as any).__FCM_TOKEN;
      if (!token) {
        console.log("[fcm] __FCM_TOKEN not set yet");
        if (attempts < maxAttempts) {
          setTimeout(tryRegister, 2000);
        } else {
          console.error("[fcm] Gave up waiting for FCM token");
        }
        return;
      }

      // Проверяем не отправляли ли уже
      const sentToken = localStorage.getItem("fcm_token_sent");
      if (sentToken === token) {
        console.log("[fcm] Token already registered, skip");
        return;
      }

      console.log("[fcm] Got token:", token.substring(0, 20) + "..., sending to server...");

      await api("/api/push/register", {
        method: "POST",
        body: JSON.stringify({
          operator_id: operatorId,
          token: token,
          platform: "android",
        }),
      });

      localStorage.setItem("fcm_token_sent", token);
      console.log("[fcm] Token registered on server successfully!");
    } catch (e) {
      console.error("[fcm] Error:", e);
      if (attempts < maxAttempts) {
        setTimeout(tryRegister, 2000);
      }
    }
  };

  setTimeout(tryRegister, 3000);
}

export async function unregisterFcmToken(): Promise<void> {
  try {
    const token = localStorage.getItem("fcm_token_sent");
    if (!token) return;

    await api("/api/push/unregister", {
      method: "POST",
      body: JSON.stringify({ token }),
    });

    localStorage.removeItem("fcm_token_sent");
    console.log("[fcm] Token unregistered");
  } catch (e) {
    console.error("[fcm] unregisterFcmToken error:", e);
  }
}