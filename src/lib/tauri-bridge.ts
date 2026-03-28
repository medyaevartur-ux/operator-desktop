/**
 * Bridge between frontend and Tauri native APIs
 * Gracefully degrades to no-op when not in Tauri environment
 */

function isTauri(): boolean {
  return !!(window as any).__TAURI_INTERNALS__;
}

let invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;
let listen: ((event: string, handler: (event: any) => void) => Promise<() => void>) | null = null;

async function getInvoke() {
  if (invoke) return invoke;
  if (!isTauri()) return null;
  try {
    const mod = await import("@tauri-apps/api/core");
    invoke = mod.invoke;
    return invoke;
  } catch {
    return null;
  }
}

async function getListen() {
  if (listen) return listen;
  if (!isTauri()) return null;
  try {
    const mod = await import("@tauri-apps/api/event");
    listen = mod.listen;
    return listen;
  } catch {
    return null;
  }
}

// ═══ Badge ═══

export async function setBadgeCount(count: number): Promise<void> {
  const inv = await getInvoke();
  if (inv) {
    await inv("set_badge_count", { count });
  } else {
    // Browser fallback: update document title
    document.title = count > 0 ? `(${count}) Alphabet Chat` : "Alphabet Chat";
  }
}

// ═══ Close to Tray ═══

export async function getCloseToTray(): Promise<boolean> {
  const inv = await getInvoke();
  if (inv) {
    return (await inv("get_close_to_tray")) as boolean;
  }
  return false;
}

export async function setCloseToTray(value: boolean): Promise<void> {
  const inv = await getInvoke();
  if (inv) {
    await inv("set_close_to_tray", { value });
  }
}

// ═══ Notify Offline ═══

export async function notifyOfflineNative(apiUrl: string, operatorId: string): Promise<void> {
  const inv = await getInvoke();
  if (inv) {
    await inv("notify_offline", { apiUrl, operatorId });
  }
}

// ═══ Listen to app-closing event ═══

export async function onAppClosing(handler: () => void): Promise<() => void> {
  const lis = await getListen();
  if (lis) {
    return await lis("app-closing", () => handler());
  }
  return () => {};
}

// ═══ Notification with click ═══

export async function showNativeNotification(
  title: string,
  body: string,
  sessionId: string,
): Promise<void> {
  if (!isTauri()) {
    // Browser fallback
    if ("Notification" in window && Notification.permission === "granted") {
      const n = new Notification(title, {
        body,
        icon: "/icon.png",
        tag: `chat-${sessionId}`,
        silent: true,
      });
      n.onclick = () => {
        window.focus();
        window.dispatchEvent(new CustomEvent("open-chat", { detail: { sessionId } }));
        n.close();
      };
      setTimeout(() => n.close(), 6000);
    }
    return;
  }

  try {
    const { sendNotification, isPermissionGranted, requestPermission } = await import(
      "@tauri-apps/plugin-notification"
    );

    let granted = await isPermissionGranted();
    if (!granted) {
      const perm = await requestPermission();
      granted = perm === "granted";
    }

    if (granted) {
      sendNotification({ title, body });
      // Tauri v2 notification click brings window to front automatically
      // We also dispatch event so frontend navigates to the chat
      window.dispatchEvent(new CustomEvent("open-chat", { detail: { sessionId } }));
    }
  } catch {
    // Fallback to browser
    if ("Notification" in window && Notification.permission === "granted") {
      const n = new Notification(title, { body, silent: true });
      n.onclick = () => {
        window.focus();
        window.dispatchEvent(new CustomEvent("open-chat", { detail: { sessionId } }));
        n.close();
      };
    }
  }
}

// ═══ Focus window ═══

export async function focusMainWindow(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const win = getCurrentWebviewWindow();
    await win.show();
    await win.unminimize();
    await win.setFocus();
  } catch {}
}