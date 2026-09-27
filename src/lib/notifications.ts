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
