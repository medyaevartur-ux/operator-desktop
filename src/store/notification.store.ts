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

/**
 * Мягкая нота с плавной огибающей: короткий attack (linearRamp вверх),
 * затем экспоненциальный decay. Приятнее «щелчка» от мгновенного gain.
 */
function playSoftNote(
  freq: number,
  duration: number,
  vol: number,
  type: OscillatorType = "sine",
  startTime = 0,
) {
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = ctx.currentTime + startTime;
  const attack = Math.min(0.02, duration * 0.25);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(vol, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration);
}

const SYNTH_SOUNDS = {
  new_message: (vol: number) => {
    // Приятный перезвон C5 → E5 → G5 (мажорное трезвучие) с мягкой огибающей.
    playSoftNote(523.25, 0.28, vol * 0.32, "sine", 0);
    playSoftNote(659.25, 0.28, vol * 0.3, "sine", 0.1);
    playSoftNote(783.99, 0.42, vol * 0.34, "triangle", 0.2);
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
  new_visitor: (vol: number) => {
    playTone(523.25, 0.08, vol * 0.25, "sine", 0);
    playTone(659.25, 0.12, vol * 0.25, "sine", 0.06);
  },
  operator_request: (vol: number) => {
    // Эскалация: настойчивый, заметный паттерн (восходящая сирена с повтором).
    playSoftNote(659.25, 0.16, vol * 0.55, "triangle", 0);
    playSoftNote(880.0, 0.16, vol * 0.55, "triangle", 0.16);
    playSoftNote(1046.5, 0.2, vol * 0.6, "triangle", 0.32);
    playSoftNote(880.0, 0.16, vol * 0.55, "triangle", 0.56);
    playSoftNote(1046.5, 0.16, vol * 0.55, "triangle", 0.72);
    playSoftNote(1318.5, 0.32, vol * 0.62, "triangle", 0.88);
  },
};

type SoundType = keyof typeof SYNTH_SOUNDS;

/* ═══ Повторяющийся звук-напоминание ═══
 * Пока есть непрочитанные/pending — каждые REPEAT_MS повторяем мягкий
 * перезвон new_message, чтобы оператор не пропустил ожидающие чаты.
 * Уважает DND/настройки (через обычный playSound, не critical). */
const REPEAT_MS = 18000;
let repeatTimer: ReturnType<typeof setInterval> | null = null;

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

  // SLA: эскалация чатов без ответа оператора
  slaEnabled: boolean;
  slaWarnMinutes: number;
  slaOverdueMinutes: number;
  setSlaEnabled: (v: boolean) => void;
  setSlaWarnMinutes: (v: number) => void;
  setSlaOverdueMinutes: (v: number) => void;

  addNotification: (sessionId: string, visitorName: string, message: string, soundType?: SoundType) => void;
  clearNotifications: (sessionId: string) => void;
  clearAll: () => void;

  // Повторяющийся звук-напоминание, пока есть pending.
  startRepeatLoop: () => void;
  stopRepeatLoop: () => void;

  /**
   * @param type  Тип звука.
   * @param critical  Критический звук (эскалация) — играет ПОВЕРХ
   *   soundEnabled/per-sound toggles/DND. Обычные звуки уважают настройки.
   */
  playSound: (type?: SoundType, critical?: boolean) => void;
  previewSound: (type: SoundType) => void;
  showDesktopNotification: (sessionId: string) => void;
  closeToTray: boolean;
  showMessagePreview: boolean;
  setCloseToTray: (v: boolean) => void;
  setShowMessagePreview: (v: boolean) => void;
  syncBadge: () => void;  
  customSound: string | null;
  customSoundName: string | null;
  setCustomSound: (base64: string | null, name: string | null) => void;
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
  closeToTray: loadBool("notif_close_tray", true),
  showMessagePreview: loadBool("notif_msg_preview", true),
  slaEnabled: loadBool("notif_sla", true),
  slaWarnMinutes: loadNumber("notif_sla_warn", 0),
  slaOverdueMinutes: loadNumber("notif_sla_overdue", 1),
  customSound: localStorage.getItem("notif_custom_sound") || null,
  customSoundName: localStorage.getItem("notif_custom_sound_name") || null,
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
  setCloseToTray: (v) => {
    saveBool("notif_close_tray", v);
    set({ closeToTray: v });
    import("@/lib/tauri-bridge").then(({ setCloseToTray }) => setCloseToTray(v)).catch(() => {});
  },
  setShowMessagePreview: (v) => { saveBool("notif_msg_preview", v); set({ showMessagePreview: v }); },
  setSlaEnabled: (v) => { saveBool("notif_sla", v); set({ slaEnabled: v }); },
  setSlaWarnMinutes: (v) => { saveNumber("notif_sla_warn", v); set({ slaWarnMinutes: v }); },
  setSlaOverdueMinutes: (v) => { saveNumber("notif_sla_overdue", v); set({ slaOverdueMinutes: v }); },
  setCustomSound: (base64, name) => {
    try {
      if (base64) {
        localStorage.setItem("notif_custom_sound", base64);
        localStorage.setItem("notif_custom_sound_name", name || "custom.mp3");
      } else {
        localStorage.removeItem("notif_custom_sound");
        localStorage.removeItem("notif_custom_sound_name");
      }
    } catch (e) {
      console.error("Failed to save custom sound", e);
    }
    set({ customSound: base64, customSoundName: name });
  },
  syncBadge: () => {
    const total = get().totalUnread;
    import("@/lib/tauri-bridge").then(({ setBadgeCount }) => setBadgeCount(total)).catch(() => {});
  },  
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
  addNotification: (sessionId, visitorName, message, soundType = "new_message") => {
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

    // Sync badge (Tauri taskbar + document title)
    import("@/lib/tauri-bridge").then(({ setBadgeCount }) => setBadgeCount(totalUnread)).catch(() => {
      if (totalUnread > 0) document.title = `(${totalUnread}) Живая Сказка`;
    });

    if (get().soundEnabled) {
      get().playSound(soundType);
    }

    if (get().desktopEnabled) {
      get().showDesktopNotification(sessionId);
    }

    get().startRepeatLoop();
  },

  clearNotifications: (sessionId) => {
    const pending = { ...get().pending };
    delete pending[sessionId];
    const totalUnread = Object.values(pending).reduce((sum, p) => sum + p.count, 0);
    import("@/lib/tauri-bridge").then(({ setBadgeCount }) => setBadgeCount(totalUnread)).catch(() => {
      document.title = totalUnread > 0 ? `(${totalUnread}) Живая Сказка` : "Живая Сказка — Оператор";
    });
    set({ pending, totalUnread });
    if (Object.keys(pending).length === 0) get().stopRepeatLoop();
  },

  clearAll: () => {
    import("@/lib/tauri-bridge").then(({ setBadgeCount }) => setBadgeCount(0)).catch(() => {
      document.title = "Живая Сказка — Оператор";
    });
    set({ pending: {}, totalUnread: 0 });
    get().stopRepeatLoop();
  },

  startRepeatLoop: () => {
    if (repeatTimer) return; // уже запущен
    repeatTimer = setInterval(() => {
      const st = get();
      if (Object.keys(st.pending).length === 0) {
        st.stopRepeatLoop();
        return;
      }
      // Обычный (не critical) звук — уважает DND и настройки.
      st.playSound("new_message");
    }, REPEAT_MS);
  },

  stopRepeatLoop: () => {
    if (repeatTimer) {
      clearInterval(repeatTimer);
      repeatTimer = null;
    }
  },

  playSound: (type = "new_message", critical = false) => {
    const st = get();
    // Критический звук (эскалация) игнорирует soundEnabled / per-sound toggles / DND.
    if (!critical) {
      if (!st.soundEnabled) return;
      if (st.isDndNow()) return;
      // Check per-sound toggle
      if (type === "new_message" && !st.soundNewMessage) return;
      if (type === "new_chat" && !st.soundNewChat) return;
      if (type === "mention" && !st.soundMention) return;
      if (type === "chat_closed" && !st.soundChatClosed) return;
    }

    // Кастомный звук уместен только для обычных уведомлений; эскалация
    // должна звучать настойчивым синт-паттерном operator_request.
    if (st.customSound && !critical) {
      try {
        const audio = new Audio(st.customSound);
        audio.volume = st.soundVolume;
        audio.play();
        return;
      } catch (e) {
        console.error("Custom sound play failed, falling back to synth", e);
      }
    }

    try {
      SYNTH_SOUNDS[type](st.soundVolume);
    } catch { /* ignore */ }
  },

  previewSound: (type) => {
    const st = get();
    if (st.customSound) {
      try {
        const audio = new Audio(st.customSound);
        audio.volume = st.soundVolume;
        audio.play();
        return;
      } catch (e) {
        console.error("Custom sound play failed, falling back to synth", e);
      }
    }
    try {
      const vol = get().soundVolume;
      SYNTH_SOUNDS[type](vol);
    } catch { /* ignore */ }
  },

  showDesktopNotification: (sessionId) => {
    const state = get();
    const pending = state.pending[sessionId];
    if (!pending) return;

    const title = pending.count > 1
      ? `${pending.count} новых от ${pending.visitorName}`
      : `Сообщение от ${pending.visitorName}`;

    const body = state.showMessagePreview
      ? pending.lastMessage.slice(0, 120)
      : "Новое сообщение в чате";

    import("@/lib/tauri-bridge").then(({ showNativeNotification }) => {
      showNativeNotification(title, body, sessionId);
    }).catch(() => {});
  },
}));