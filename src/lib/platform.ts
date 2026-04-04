export function isMobile(): boolean {
  // Tauri Android/iOS
  if ('__TAURI_INTERNALS__' in window) {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('android') || ua.includes('iphone') || ua.includes('ipad')) {
      return true;
    }
  }
  // Fallback: экран меньше 768px
  return window.innerWidth < 768;
}