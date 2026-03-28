import { create } from "zustand";

/* ═══ Web Audio Synthesizer ═══ */

let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function playTone(freq: number, duration: number, vol: number, type: OscillatorType = "sine", startTime = 0) {
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(vol, ctx.currentTime + startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime + startTime);
  osc.stop(ctx.currentTime + startTime + duration);
}

const SYNTH_SOUNDS = {
  new_message: (vol: number) => {
    playTone(880, 0.12, vol * 0.4, "sine");
  },
  new_chat: (vol: number) => {
    playTone(523, 0.15, vol * 0.35, "sine", 0);
    playTone(659, 0.15, vol * 0.35, "sine", 0.12);
    playTone(784, 0.2, vol * 0.4, "sine", 0.24);
  },
  mention: (vol: number) => {
    playTone(740, 0.1, vol * 0.4, "triangle", 0);
    playTone(740, 0.1, vol * 0.4, "triangle", 0.15);
  },
  chat_closed: (vol: number) => {
    playTone(660, 0.15, vol * 0.3, "sine", 0);
    playTone(440, 0.25, vol * 0.3, "sine", 0.12);
  },
};

type SoundType = keyof typeof SYNTH_SOUNDS;

/* ═══ localStorage persistence ═══ */

function loadBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return v === "true";
  } catch { return fallback; }
}

function loadNumber(key: string, fallback: number): number {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    const n = Number(v);
    return Number.isNaN(n) ? fallback : n;
  } catch { return fallback; }
}

function saveBool(key: string, v: boolean) {
  try { localStorage.setItem(key, String(v)); } catch { /* */ }
}

function saveNumber(key: string, v: number) {
  try { localStorage.setItem(key, String(v)); } catch { /* */ }
}

/* ═══ Types ═══ */

interface PendingNotification {
  sessionId: string;
  visitorName: string;
  count: number;
  lastMessage: string;
  timestamp: number;
}

interface NotificationState {
  soundEnabled: boolean;
  desktopEnabled: boolean;
  soundVolume: number;

  // Per-sound toggles
  soundNewMessage: boolean;
  soundNewChat: boolean;
  soundMention: boolean;
  soundChatClosed: boolean;

  pending: Record<string, PendingNotification>;
  totalUnread: number;

  setSoundEnabled: (v: boolean) => void;
  setDesktopEnabled: (v: boolean) => void;
  setSoundVolume: (v: number) => void;
  setSoundNewMessage: (v: boolean) => void;
  setSoundNewChat: (v: boolean) => void;
  setSoundMention: (v: boolean) => void;
  setSoundChatClosed: (v: boolean) => void;
  dndScheduleEnabled: boolean;
  dndFrom: string;
  dndTo: string;
  setDndScheduleEnabled: (v: boolean) => void;
  setDndFrom: (v: string) => void;
  setDndTo: (v: string) => void;
  isDndNow: () => boolean;
  addNotification: (sessionId: string, visitorName: string, message: string) => void;
  clearNotifications: (sessionId: string) => void;
  clearAll: () => void;

  playSound: (type?: SoundType) => void;
  previewSound: (type: SoundType) => void;
  showDesktopNotification: (sessionId: string) => void;
}

/* ═══ Store ═══ */

export const useNotificationStore = create<NotificationState>((set, get) => ({
  soundEnabled: loadBool("notif_sound", true),
  desktopEnabled: loadBool("notif_desktop", true),
  soundVolume: loadNumber("notif_volume", 0.7),
  soundNewMessage: loadBool("notif_s_msg", true),
  soundNewChat: loadBool("notif_s_chat", true),
  soundMention: loadBool("notif_s_mention", true),
  soundChatClosed: loadBool("notif_s_closed", true),
  dndScheduleEnabled: loadBool("notif_dnd_schedule", false),
  dndFrom: localStorage.getItem("notif_dnd_from") || "22:00",
  dndTo: localStorage.getItem("notif_dnd_to") || "08:00",  
  pending: {},
  totalUnread: 0,

  setSoundEnabled: (v) => { saveBool("notif_sound", v); set({ soundEnabled: v }); },
  setDesktopEnabled: (v) => { saveBool("notif_desktop", v); set({ desktopEnabled: v }); },
  setSoundVolume: (v) => { saveNumber("notif_volume", v); set({ soundVolume: v }); },
  setSoundNewMessage: (v) => { saveBool("notif_s_msg", v); set({ soundNewMessage: v }); },
  setSoundNewChat: (v) => { saveBool("notif_s_chat", v); set({ soundNewChat: v }); },
  setSoundMention: (v) => { saveBool("notif_s_mention", v); set({ soundMention: v }); },
  setSoundChatClosed: (v) => { saveBool("notif_s_closed", v); set({ soundChatClosed: v }); },
  setDndScheduleEnabled: (v) => { saveBool("notif_dnd_schedule", v); set({ dndScheduleEnabled: v }); },
  setDndFrom: (v) => { try { localStorage.setItem("notif_dnd_from", v); } catch {} set({ dndFrom: v }); },
  setDndTo: (v) => { try { localStorage.setItem("notif_dnd_to", v); } catch {} set({ dndTo: v }); },
  isDndNow: () => {
    const st = get();
    if (!st.dndScheduleEnabled) return false;
    const now = new Date();
    const hh = now.getHours();
    const mm = now.getMinutes();
    const current = hh * 60 + mm;
    const [fh, fm] = st.dndFrom.split(":").map(Number);
    const [th, tm] = st.dndTo.split(":").map(Number);
    const from = fh * 60 + fm;
    const to = th * 60 + tm;
    if (from <= to) return current >= from && current < to;
    return current >= from || current < to; // overnight
  },
  addNotification: (sessionId, visitorName, message) => {
    // DND schedule check
    if (get().isDndNow()) return;    
    const pending = { ...get().pending };
    const existing = pending[sessionId];

    if (existing) {
      pending[sessionId] = {
        ...existing,
        count: existing.count + 1,
        lastMessage: message,
        timestamp: Date.now(),
      };
    } else {
      pending[sessionId] = {
        sessionId,
        visitorName,
        count: 1,
        lastMessage: message,
        timestamp: Date.now(),
      };
    }

    const totalUnread = Object.values(pending).reduce((sum, p) => sum + p.count, 0);
    set({ pending, totalUnread });

    if (totalUnread > 0) {
      document.title = `(${totalUnread}) Alphabet Chat`;
    }

    if (get().soundEnabled) {
      get().playSound("new_message");
    }

    if (get().desktopEnabled) {
      get().showDesktopNotification(sessionId);
    }
  },

  clearNotifications: (sessionId) => {
    const pending = { ...get().pending };
    delete pending[sessionId];
    const totalUnread = Object.values(pending).reduce((sum, p) => sum + p.count, 0);
    document.title = totalUnread > 0 ? `(${totalUnread}) Alphabet Chat` : "Alphabet Chat";
    set({ pending, totalUnread });
  },

  clearAll: () => {
    document.title = "Alphabet Chat";
    set({ pending: {}, totalUnread: 0 });
  },

  playSound: (type = "new_message") => {
    const st = get();
    if (!st.soundEnabled) return;
    if (get().isDndNow()) return;
    // Check per-sound toggle
    if (type === "new_message" && !st.soundNewMessage) return;
    if (type === "new_chat" && !st.soundNewChat) return;
    if (type === "mention" && !st.soundMention) return;
    if (type === "chat_closed" && !st.soundChatClosed) return;

    try {
      SYNTH_SOUNDS[type](st.soundVolume);
    } catch { /* ignore */ }
  },

  previewSound: (type) => {
    try {
      const vol = get().soundVolume;
      SYNTH_SOUNDS[type](vol);
    } catch { /* ignore */ }
  },

  showDesktopNotification: (sessionId) => {
    const state = get();
    const pending = state.pending[sessionId];
    if (!pending) return;

    // Try Tauri native first
    try {
      if ((window as any).__TAURI_INTERNALS__) {
        import("@tauri-apps/plugin-notification").then(({ sendNotification, isPermissionGranted, requestPermission }) => {
          isPermissionGranted().then((granted) => {
            const send = () => {
              const title = pending.count > 1
                ? `${pending.count} новых от ${pending.visitorName}`
                : `Сообщение от ${pending.visitorName}`;
              sendNotification({ title, body: pending.lastMessage.slice(0, 100) });
            };
            if (granted) { send(); }
            else { requestPermission().then((p) => { if (p === "granted") send(); }); }
          });
        }).catch(() => {});
        return;
      }
    } catch { /* fallback to browser */ }

    // Browser fallback
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") { Notification.requestPermission(); return; }
    if (Notification.permission !== "granted") return;

    const title = pending.count > 1
      ? `${pending.count} новых сообщений от ${pending.visitorName}`
      : `Сообщение от ${pending.visitorName}`;

    const notification = new Notification(title, {
      body: pending.lastMessage.slice(0, 120),
      icon: "/icon.png",
      tag: `chat-${sessionId}`,
      silent: true,
    });

    notification.onclick = () => {
      window.focus();
      window.dispatchEvent(new CustomEvent("open-chat", { detail: { sessionId } }));
      notification.close();
    };

    setTimeout(() => notification.close(), 5000);
  },
}));