import { useNotificationStore } from "@/store/notification.store";
import { useAuthStore } from "@/store/auth.store";

// ── Web Audio beep ──
let audioCtx: AudioContext | null = null;

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    void audioCtx.resume();
  }
  return audioCtx;
}

function playBeep(freq: number, duration: number, type: OscillatorType = "sine") {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = 0.18;

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.stop(ctx.currentTime + duration);
  } catch (e) {
    console.warn("[notifications] beep error:", e);
  }
}

function playNewChatSound() {
  playBeep(880, 0.15, "sine");
  setTimeout(() => playBeep(1100, 0.2, "sine"), 160);
  setTimeout(() => playBeep(1320, 0.25, "sine"), 360);
}

function playNewMessageSound() {
  playBeep(660, 0.12, "sine");
}

// ── Desktop notification ──
async function showDesktopNotification(title: string, body: string) {
  try {
    if (!("Notification" in window)) return;

    if (Notification.permission === "default") {
      await Notification.requestPermission();
    }

    if (Notification.permission === "granted") {
      new Notification(title, {
        body,
        silent: true,
      });
    }
  } catch (e) {
    console.warn("[notifications] desktop error:", e);
  }
}

// ── Public API ──
export function notifyNewChat(visitorName: string) {
  console.log("[notify] newChat:", visitorName);

  const operator = useAuthStore.getState().operator;
  if (operator?.status === "dnd") return;

  const { soundEnabled, desktopEnabled } = useNotificationStore.getState();

  if (soundEnabled) playNewChatSound();
  if (desktopEnabled) void showDesktopNotification("Новый чат", `${visitorName} начал диалог`);
}

export function notifyNewMessage(senderName: string, messageText: string, senderId?: string) {
  console.log("[notify] newMessage from:", senderName, "senderId:", senderId);

  const operator = useAuthStore.getState().operator;
  if (operator?.status === "dnd") return;

  // Не уведомлять о своих сообщениях
  if (senderId && senderId === operator?.id) return;

  const { soundEnabled, desktopEnabled } = useNotificationStore.getState();

  if (soundEnabled) playNewMessageSound();

  if (desktopEnabled) {
    const preview = messageText.length > 80 ? messageText.slice(0, 80) + "…" : messageText;
    void showDesktopNotification(senderName, preview);
  }
}

// Разблокировать AudioContext по клику
export function unlockAudio() {
  getAudioCtx();
}

export function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    void Notification.requestPermission();
  }
  // Пытаемся разблокировать аудио
  unlockAudio();
}