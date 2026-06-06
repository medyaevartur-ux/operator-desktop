// Минимальные утилиты для работы со звуком и системными уведомлениями.
// Основная логика — в src/store/notification.store.ts.

let audioCtx: AudioContext | null = null;

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    void audioCtx.resume();
  }
  return audioCtx;
}

export function unlockAudio() {
  getAudioCtx();
}

export function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    void Notification.requestPermission();
  }
  // Tauri-нативное разрешение запрашиваем заранее, пока окно видно —
  // иначе первый тост в трее может потеряться (разрешение ещё не выдано).
  try {
    if ((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
      void import("@tauri-apps/plugin-notification").then(async ({ isPermissionGranted, requestPermission }) => {
        const granted = await isPermissionGranted();
        if (!granted) await requestPermission();
      }).catch(() => {});
    }
  } catch { /* ignore */ }
  unlockAudio();
}
